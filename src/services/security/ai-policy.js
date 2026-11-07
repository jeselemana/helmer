import { createHash, createHmac, randomUUID } from 'node:crypto';
import net from 'node:net';
import { BUILD_OUTPUT_RESERVATIONS, isValidBuildOutputReservation } from '../ai/build-config.js';
import { guestDailyLimit, guestBuildDailyLimit } from './config.js';
import { GUEST_EXHAUSTED_MESSAGE, GUEST_BUILD_EXHAUSTED_MESSAGE, GUEST_RESTRICTION_NOTICES, detectGuestFunctionalRestriction } from '../ai/prompts.js';
import { resolveAskThinkingLevel } from '../ai/ask-routing.js';
import { acquireSharedAskLease } from './owner-execution-lease.js';
import { requestFingerprint } from './request-fingerprint.js';

const fail = (code, status = 503) => Object.assign(new Error(code), { code, status });
export const ASK_REQUESTS_PER_MINUTE = 15;
const ASK_IP_REQUESTS_PER_MINUTE = 60;
const ASK_RATE_WINDOW_MS = 60000;

function reserveAskRate(redis, actor, ip, token) {
  return redis.eval(`
    local t = redis.call('TIME')
    local now = t[1] * 1000 + math.floor(t[2] / 1000)
    local window = tonumber(ARGV[2])
    local retry = 0
    for i, key in ipairs(KEYS) do
      redis.call('zremrangebyscore', key, '-inf', now - window)
      if redis.call('zcard', key) >= tonumber(ARGV[i + 2]) then
        local oldest = redis.call('zrange', key, 0, 0, 'WITHSCORES')
        retry = math.max(retry, tonumber(oldest[2]) + window - now)
      end
    end
    if retry > 0 then return math.ceil(retry / 1000) end
    for _, key in ipairs(KEYS) do
      redis.call('zadd', key, now, ARGV[1])
      redis.call('pexpire', key, window)
    end
    return 0
  `, {
    keys: [`security:ask-minute:${actor}`, `security:ask-minute-ip:${ip}`],
    arguments: [token, String(ASK_RATE_WINDOW_MS), String(ASK_REQUESTS_PER_MINUTE), String(ASK_IP_REQUESTS_PER_MINUTE)],
  });
}

export const DEFAULT_MODEL_PRICING = Object.freeze({
  get 'gemini-4-argon'() {
    return Date.now() < Date.UTC(2026, 11, 1) ? { input: 2.20, output: 11.00 } : { input: 4.40, output: 22.00 };
  },
  'gemini-3.8-flash': { input: 0.75, output: 3.75, search: 0.035 },
  'gemini-3.8-flash-high': { input: 0.75, output: 3.75, search: 0.035 },
  'gpt-5.6-luna': { input: 0.25, output: 1.00, search: 0.030 },
  'gpt-6-luna': { input: 0.25, output: 1.00, search: 0.030 },
  'gpt-5.6-terra': { input: 1.25, output: 5.00, search: 0.035 },
  'gpt-6-sol': { input: 2.00, output: 10.00, search: 0.050 },
  'gpt-6.1-sol': { input: 2.00, output: 10.00, search: 0.050 },
  'gpt-4o': { input: 2.50, output: 10.00, search: 0.035 },
  'default': { input: 2.50, output: 10.00, search: 0.035 },
});

// The available balance includes this reserved message; remaining is the post-request balance.
export function guestMessageBalance(req) {
  const available = req.guestMessagesAvailable;
  const remaining = req.remainingGuestMessages;
  if (!Number.isSafeInteger(available) || available <= 0 || !Number.isSafeInteger(remaining) || remaining < 0 || available !== remaining + 1) {
    throw fail('EXECUTION_UNAVAILABLE');
  }
  return { available, remaining };
}

export function guestBriefBalance(req) {
  const available = req.guestBriefsAvailable;
  const remaining = req.remainingGuestBriefs;
  if (!Number.isSafeInteger(available) || available <= 0 || !Number.isSafeInteger(remaining) || remaining < 0 || (available !== remaining + 1 && available !== remaining)) {
    throw fail('EXECUTION_UNAVAILABLE');
  }
  return { available, remaining };
}

export function isAiRequest(req) {
  return req.method === 'POST' && (
    /^\/api\/ask(?:\/research)?\/?$/i.test(req.path) ||
    /^\/api\/strategy\/(?:estimate|assess|generate|generate-stream|refine|[^/]+\/refine)\/?$/i.test(req.path) ||
    /^\/api\/planner\/(?:summarize|prioritize)\/?$/i.test(req.path) ||
    /^\/api\/up\/challenges(?:\/[0-9a-f-]{36}\/(?:submit|retry))?\/?$/i.test(req.path)
  );
}

export function aiRequestTimeoutMs(req) {
  if (req.method === 'POST') {
    if (/^\/api\/strategy\/estimate\/?$/i.test(req.path)) return 45000;
    if (/^\/api\/strategy\/assess\/?$/i.test(req.path)) return 90000;
    if (/^\/api\/strategy\/(?:generate|generate-stream|refine|[0-9a-f-]{36}\/refine)\/?$/i.test(req.path)) return 600000;
  }
  return 180000;
}
export class AiPolicy {
  constructor({ redis, env = process.env, fetcher = fetch, allowParallelAskChats = false }) {
    Object.assign(this, { redis, env, fetcher, allowParallelAskChats });
  }
  async assertEnabled() {
    this.ready();
    if (this.env.AI_EXECUTION_DISABLED === 'true' || (this.redis?.isReady && this.redis.get && await this.redis.get('security:ai-paused') === '1')) throw fail('EXECUTION_DISABLED');
  }
  ready() {
    if (this.env.NODE_ENV === 'production' && (this.env.REDIS_URL || this.env.REQUIRE_REDIS === 'true') && !this.redis?.isReady) throw fail('EXECUTION_UNAVAILABLE');
    if (this.redis && !this.redis.isReady) throw fail('EXECUTION_UNAVAILABLE');
  }
  async turnstile(req) {
    if (!this.env.TURNSTILE_SECRET_KEY) return;
    const token = req.get('X-Helmer-Turnstile-Token');
    if (!token || token.length > 2048) throw fail('BOT_VERIFICATION_REQUIRED', 403);
    const response = await this.fetcher('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(5000),
      body: JSON.stringify({ secret: this.env.TURNSTILE_SECRET_KEY, response: token, remoteip: req.ip || req.socket?.remoteAddress }),
    });
    const result = await response.json();
    let appHost = 'helmeros.com';
    try {
      if (this.env.APP_URL) appHost = new URL(this.env.APP_URL).hostname;
    } catch {}
    const allowedHosts = new Set([appHost, 'helmeros.com', 'www.helmeros.com', 'localhost', '127.0.0.1']);
    if (!result.success || (result.action && result.action !== 'guest-ai') || (result.hostname && !allowedHosts.has(result.hostname))) throw fail('BOT_VERIFICATION_FAILED', 403);
  }
  ipKey(req) {
    let ip = String(req.ip || req.socket?.remoteAddress || '').replace(/^::ffff:/, '');
    if (net.isIP(ip) === 6) ip = ip.split(':').slice(0, 4).join(':');
    return createHmac('sha256', this.env.SESSION_SECRET || this.env.AUTH_SECRET || 'local-only').update(ip).digest('hex');
  }
  middleware() {
    return async (req, res, next) => {
      if (!/^\/api\/(?:ask|strategy|planner|up|user|artifacts)(?:\/|$)/i.test(req.path)) return next();
      if (req.user?.status && req.user.status !== 'active') return res.status(403).json({ code: 'ACCOUNT_UNAVAILABLE', error: 'Hesab aktiv deyil.' });
      if (req.user && !req.user.emailVerifiedAt) return res.status(403).json({ code: 'EMAIL_VERIFICATION_REQUIRED', error: 'E-poçtunu təsdiqlə.' });
      const previousAuthorization = req.securityContext?.assertAuthorized;
      if (req.securityContext) req.securityContext.assertAuthorized = async () => {
        await Promise.all([this.assertEnabled(), req.securityContext.assertLease?.(), previousAuthorization?.()]);
      };
      const guest = !req.user;
      if (guest && (/^\/api\/(?:up|user|artifacts)(?:\/|$)/i.test(req.path) || /^\/api\/ask\/research(?:\/|$)/i.test(req.path))) return res.status(401).json({ code: 'AUTH_REQUIRED' });
      if (guest) {
        let notice;
        if (/^\/api\/planner(?:\/|$)/i.test(req.path)) notice = GUEST_RESTRICTION_NOTICES.planner;
        if (/^\/api\/strategy(?:\/|$)/i.test(req.path) && !(req.method === 'POST' && /^\/api\/strategy\/(?:estimate|assess|generate|generate-stream)\/?$/i.test(req.path))) notice = GUEST_RESTRICTION_NOTICES.strategy;
        if (req.method === 'POST' && /^\/api\/ask\/?$/i.test(req.path)) {
          const body = req.body || {};
          if (body.thinkingLevel !== undefined && (typeof body.thinkingLevel !== 'string' || !['low', 'medium', 'high', 'off', 'auto'].includes(body.thinkingLevel))) {
            return res.status(400).json({ code: 'VALIDATION_ERROR', error: 'Düşünmə səviyyəsi düzgün deyil.' });
          }
          const messages = Array.isArray(body.messages) ? body.messages : [];
          const lastUserMsg = typeof messages.at(-1)?.content === 'string' ? messages.at(-1).content : '';
          notice = detectGuestFunctionalRestriction({
            lastUserMsg,
            hasAttachment: messages.some(message => Boolean(message?.file)),
            hasStrategyContext: Boolean(body.strategyId), hasTaskContext: Boolean(body.taskId),
            rawThinkingLevel: resolveAskThinkingLevel({ requestedThinkingLevel: body.thinkingLevel, lastUserMsg }),
            explicitLowThinking: body.thinkingLevel === 'low',
          }) || notice;
        }
        if (notice) return res.status(401).json({ code: 'AUTH_REQUIRED', error: notice, reply: notice });
      }
      if (!isAiRequest(req)) return next();
      const isAsk = /^\/api\/ask\/?$/i.test(req.path);
      const sharedAsk = this.allowParallelAskChats && isAsk && !guest && req.body?.mode !== 'research';
      const endTimedOutRequest = () => {
        if (res.destroyed || res.writableEnded) return;
        if (!res.headersSent) return res.status(504).json({ code: 'EXECUTION_TIMEOUT' });
        if (isAsk && String(res.getHeader('Content-Type')).startsWith('text/event-stream')) {
          req.securityContext.askTerminalFailure = true;
          return res.end('data: {"code":"EXECUTION_TIMEOUT","error":"Sorğunu tamamlamaq mümkün olmadı."}\n\n');
        }
        res.end();
      };
      try { await this.assertEnabled(); }
      catch (error) { return res.status(503).json({ code: error.code === 'EXECUTION_DISABLED' ? 'EXECUTION_DISABLED' : 'EXECUTION_UNAVAILABLE', error: 'Sorğu icra edilə bilmədi.' }); }
      let controller;
      if (!this.redis?.isReady) {
        if (this.env.NODE_ENV === 'production' && (this.env.REDIS_URL || this.env.REQUIRE_REDIS === 'true')) {
          return res.status(503).json({ code: 'EXECUTION_UNAVAILABLE', error: 'Sorğu icra edilə bilmədi.' });
        }
        try {
          if (guest) await this.turnstile(req);
        } catch (error) {
          return res.status(error.status || 403).json({ code: error.code || 'BOT_VERIFICATION_FAILED', error: 'Sorğu başlana bilmədi.' });
        }
        controller = new AbortController();
        req.securityContext.route = req.path;
        req.securityContext.controller = controller;
        req.securityContext.signal = controller.signal;
        let memoryTimer;
        const requestTimeout = aiRequestTimeoutMs(req);
        if (requestTimeout !== null) {
          memoryTimer = setTimeout(() => {
            controller.abort(fail('EXECUTION_TIMEOUT'));
            endTimedOutRequest();
          }, requestTimeout);
          memoryTimer.unref?.();
        }
        req.securityContext.transferToBackground = () => {
          req.securityContext.isBackgroundJob = true;
          clearTimeout(memoryTimer);
          memoryTimer = setTimeout(() => controller.abort(fail('EXECUTION_TIMEOUT')), 10 * 60 * 1000);
          memoryTimer.unref?.();
          return {
            signal: controller.signal,
            assertOwned: async () => {},
            release: async () => { clearTimeout(memoryTimer); controller.abort(); },
          };
        };
        if (!guest) {
          const finishRequest = () => {
            if (!req.securityContext.isBackgroundJob) {
              clearTimeout(memoryTimer);
              controller.abort();
            }
          };
          res.once('finish', finishRequest);
          res.once('close', finishRequest);
        }
        if (guest) {
          try {
            const isBuildRequest = /^\/api\/strategy\/(?:estimate|assess|generate|generate-stream)\/?$/i.test(req.path);
            const isBuildGenerate = /^\/api\/strategy\/(?:generate|generate-stream)\/?$/i.test(req.path);
            if (isBuildRequest) {
              const dailyLimit = guestBuildDailyLimit(this.env);
              if (isBuildGenerate) {
                const used = this._trackInMemoryGuestUsage(req, dailyLimit, true);
                req.guestBuildUsageCount = used;
                req.guestBuildDailyLimit = dailyLimit;
                req.remainingGuestBriefs = Math.max(0, dailyLimit - used);
                req.guestBriefsAvailable = req.remainingGuestBriefs + 1;
              } else {
                const used = this._getInMemoryGuestUsage(req, true);
                if (used >= dailyLimit) throw fail('GUEST_DAILY_LIMIT', 429);
                req.guestBuildUsageCount = used;
                req.guestBuildDailyLimit = dailyLimit;
                req.remainingGuestBriefs = Math.max(0, dailyLimit - used);
                req.guestBriefsAvailable = req.remainingGuestBriefs;
              }
            } else {
              const dailyLimit = guestDailyLimit(this.env);
              const used = this._trackInMemoryGuestUsage(req, dailyLimit, false);
              req.guestUsageCount = used;
              req.guestDailyLimit = dailyLimit;
              req.remainingGuestMessages = Math.max(0, dailyLimit - used);
              req.guestMessagesAvailable = req.remainingGuestMessages + 1;
            }
            let released = false;
            const release = () => {
              if (released) return;
              released = true;
              clearTimeout(memoryTimer);
              controller.abort();
              if (!req.securityContext?.providerStarted && req.guestMemoryQuotaKeys) for (const key of req.guestMemoryQuotaKeys) {
                this.inMemoryGuestUsage.set(key, Math.max(0, (this.inMemoryGuestUsage.get(key) || 0) - 1));
              }
            };
            res.once('finish', release);
            res.once('close', release);
          } catch (error) {
            clearTimeout(memoryTimer);
            const isBuildRequest = /^\/api\/strategy\/(?:estimate|assess|generate|generate-stream)\/?$/i.test(req.path);
            const exhaustedMsg = isBuildRequest ? GUEST_BUILD_EXHAUSTED_MESSAGE : GUEST_EXHAUSTED_MESSAGE;
            return res.status(error.status || 429).json({ code: error.code || 'GUEST_DAILY_LIMIT', error: exhaustedMsg, reply: exhaustedMsg });
          }
        }
        return next();
      }
      let quotaKeys = [], requestKey, requestRecord, previousRequest, lock, sharedAskLease, fingerprint;
      let replayResult;
      const isUpRequest = /^\/api\/up\/challenges(?:\/|$)/i.test(req.path);
      const isDurableStrategyRequest = /^\/api\/strategy\/(?:generate|[0-9a-f-]{36}\/refine)\/?$/i.test(req.path);
      const token = randomUUID();
      let finished = false, handlerEntered = false;
      if (req.securityContext) {
        req.securityContext.markMutationPending = () => {
          req.securityContext.mutationPending = true;
        };
        req.securityContext.recordIdempotentResult = (first, second = 200) => {
          const isStatusFirst = typeof first === 'number';
          const status = isStatusFirst ? first : (typeof second === 'number' ? second : 200);
          const body = isStatusFirst ? second : first;
          replayResult = { status, body };
          req.securityContext.mutationCommitted = true;
          req.securityContext.mutationPending = false;
        };
        if (/^\/api\/ask\/?$/i.test(req.path)) req.securityContext.persistIdempotentResult = async () => {
          controller.signal.throwIfAborted();
          if (!requestKey || !requestRecord || !replayResult) throw fail('EXECUTION_UNAVAILABLE');
          const completed = JSON.stringify({ state: 'completed', fingerprint, result: replayResult });
          try {
            const saved = await this.redis.eval("if redis.call('get',KEYS[1]) ~= ARGV[1] then return 0 end; redis.call('set',KEYS[1],ARGV[2],'EX',900); return 1", {
              keys: [requestKey], arguments: [requestRecord, completed],
            });
            if (saved !== 1) throw fail('EXECUTION_UNAVAILABLE');
            requestRecord = completed;
          } catch { throw fail('EXECUTION_UNAVAILABLE'); }
        };
      }
      const finish = async () => {
        if (finished) return; finished = true;
        clearTimeout(timer);
        controller?.abort();
        if (!req.securityContext?.providerStarted && quotaKeys.length) await this.redis.eval("for _,k in ipairs(KEYS) do local n = tonumber(redis.call('get', k) or '0'); if n > 0 then redis.call('decr',k) end end; return 1", { keys: quotaKeys }).catch(() => {});
        const canRetryAfterPreCommitFailure =
          handlerEntered &&
          !replayResult &&
          (res.statusCode >= 500 || (isAsk && req.securityContext?.askTerminalFailure)) &&
          !req.securityContext?.mutationPending &&
          !req.securityContext?.mutationCommitted &&
          !req.securityContext?.isBackgroundJob;
        const finalState = replayResult
          ? 'completed'
          : !handlerEntered
            ? 'rejected'
            : canRetryAfterPreCommitFailure
              ? 'retryable'
              : 'started';
        if (requestKey && requestRecord) await this.redis.eval("if redis.call('get',KEYS[1]) ~= ARGV[1] then return 0 end; redis.call('set',KEYS[1],ARGV[2],'EX',900); return 1", { keys: [requestKey], arguments: [requestRecord, JSON.stringify({ state: finalState, fingerprint, result: replayResult })] }).catch(() => {});
        if (lock) await this.redis.eval("if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) end; return 0", { keys: [lock], arguments: [token] }).catch(() => {});
        if (sharedAskLease) await sharedAskLease.release().catch(() => {});
      };
      let timer;
      try {
        if (guest) await this.turnstile(req);
        this.ready();
        const id = req.get('Idempotency-Key');
        if (!id || !/^[A-Za-z0-9_-]{16,100}$/.test(id)) throw fail('IDEMPOTENCY_KEY_REQUIRED', 400);
        requestKey = `security:request:${createHash('sha256').update(`${req.ownerId}:${req.path}:${id}`).digest('hex')}`;
        fingerprint = requestFingerprint(req.body);
        const candidate = JSON.stringify({ state: 'reserved', fingerprint, token });
        if (await this.redis.set(requestKey, candidate, { NX: true, EX: 900 })) requestRecord = candidate;
        else {
          previousRequest = await this.redis.get(requestKey);
          const existing = JSON.parse(previousRequest || 'null');
          if (!existing || existing.fingerprint !== fingerprint) { requestKey = null; throw fail('IDEMPOTENCY_CONFLICT', 409); }
          if (existing.state === 'completed' && existing.result) { requestKey = null; return res.status(existing.result.status).json(existing.result.body); }
          // UP and durable strategy routes can reconcile ambiguous 'started' state against durable repository state.
          // Pre-commit failures ('rejected' or 'retryable') may be retried safely once the owner lock is acquired.
          // Generic operations with ambiguous in-flight or post-mutation 'started' state remain blocked.
          const canProceed = existing.state === 'rejected' || existing.state === 'retryable' || (existing.state === 'started' && (isUpRequest || isDurableStrategyRequest));
          if (!canProceed) { requestKey = null; throw fail('REQUEST_ALREADY_SUBMITTED', 409); }
        }
        req.securityContext.operationKey = requestKey;
        req.securityContext.operationFingerprint = fingerprint;
        const json = res.json.bind(res);
        res.json = body => {
          if (res.statusCode >= 200 && res.statusCode < 300 && !replayResult) replayResult = { status: res.statusCode, body };
          return json(body);
        };
        const actor = req.ownerId, ip = this.ipKey(req), day = new Date().toISOString().slice(0, 10);
        if (sharedAsk) {
          const retryAfter = await reserveAskRate(this.redis, actor, ip, token);
          if (retryAfter > 0) {
            res.setHeader('Retry-After', String(retryAfter));
            throw fail('RATE_LIMITED', 429);
          }
        } else {
          const keys = [`security:rate:${actor}`, `security:rate-ip:${ip}`];
          const allowed = await this.redis.eval("for _,k in ipairs(KEYS) do if tonumber(redis.call('get',k) or '0') >= tonumber(ARGV[1]) then return 0 end end; for _,k in ipairs(KEYS) do local n = redis.call('incr',k); if n == 1 then redis.call('expire',k,600) end end; return 1", { keys, arguments: ['60'] });
          if (!allowed) throw fail('RATE_LIMITED', 429);
        }
        if (guest) {
          const isBuildRequest = /^\/api\/strategy\/(?:estimate|assess|generate|generate-stream)\/?$/i.test(req.path);
          const isBuildGenerate = /^\/api\/strategy\/(?:generate|generate-stream)\/?$/i.test(req.path);
          if (isBuildRequest) {
            const dailyLimit = guestBuildDailyLimit(this.env);
            quotaKeys = [`security:guest-build-day:${day}:${actor}`, `security:guest-build-ip-day:${day}:${ip}`];
            if (isBuildGenerate) {
              const admitted = await this.redis.eval(
                "for _,k in ipairs(KEYS) do if tonumber(redis.call('get',k) or '0') >= tonumber(ARGV[1]) then return 0 end end; local res = 0; for _,k in ipairs(KEYS) do local n = redis.call('incr',k); redis.call('expire',k,172800); if n > res then res = n end end; return res",
                { keys: quotaKeys, arguments: [String(dailyLimit)] }
              );
              if (!admitted) { quotaKeys = []; throw fail('GUEST_DAILY_LIMIT', 429); }
              req.guestBuildUsageCount = admitted;
              req.guestBuildDailyLimit = dailyLimit;
              req.remainingGuestBriefs = Math.max(0, dailyLimit - admitted);
              req.guestBriefsAvailable = req.remainingGuestBriefs + 1;
            } else {
              const vals = await this.redis.mGet(quotaKeys);
              const used = Math.max(0, ...vals.map(v => Number(v || 0)));
              if (used >= dailyLimit) { quotaKeys = []; throw fail('GUEST_DAILY_LIMIT', 429); }
              quotaKeys = [];
              req.guestBuildUsageCount = used;
              req.guestBuildDailyLimit = dailyLimit;
              req.remainingGuestBriefs = Math.max(0, dailyLimit - used);
              req.guestBriefsAvailable = req.remainingGuestBriefs;
            }
          } else {
            const dailyLimit = guestDailyLimit(this.env);
            quotaKeys = [`security:guest-day:${day}:${actor}`, `security:guest-ip-day:${day}:${ip}`];
            const admitted = await this.redis.eval(
              "for _,k in ipairs(KEYS) do if tonumber(redis.call('get',k) or '0') >= tonumber(ARGV[1]) then return 0 end end; local res = 0; for _,k in ipairs(KEYS) do local n = redis.call('incr',k); redis.call('expire',k,172800); if n > res then res = n end end; return res",
              { keys: quotaKeys, arguments: [String(dailyLimit)] }
            );
            if (!admitted) { quotaKeys = []; throw fail('GUEST_DAILY_LIMIT', 429); }
            req.guestUsageCount = admitted;
            req.guestDailyLimit = dailyLimit;
            req.remainingGuestMessages = Math.max(0, dailyLimit - admitted);
            req.guestMessagesAvailable = req.remainingGuestMessages + 1;
          }
        }
        if (sharedAsk) {
          sharedAskLease = await acquireSharedAskLease(this.redis, actor, token);
          if (!sharedAskLease) throw fail('EXECUTION_BUSY', 429);
        } else {
          lock = `security:owner-execution:${actor}`;
          if (!await this.redis.set(lock, token, { NX: true, PX: 180000 })) { lock = null; throw fail('EXECUTION_BUSY', 429); }
        }
        if (previousRequest) {
          const candidate = JSON.stringify({ state: 'reserved', fingerprint, token });
          const claimed = await this.redis.eval("if redis.call('get',KEYS[1]) ~= ARGV[1] then return 0 end; redis.call('set',KEYS[1],ARGV[2],'EX',900); return 1", { keys: [requestKey], arguments: [previousRequest, candidate] });
          if (!claimed) throw fail('REQUEST_ALREADY_SUBMITTED', 409);
          requestRecord = candidate;
        }
        controller = new AbortController();
        req.securityContext.assertLease = async () => {
          const owned = sharedAskLease ? await sharedAskLease.isOwned() : this.redis.isReady && await this.redis.get(lock) === token;
          if (!owned) throw fail('EXECUTION_LOCK_LOST');
        };
        req.securityContext.route = req.path;
        req.securityContext.controller = controller; req.securityContext.signal = controller.signal;
        const renewal = setInterval(async () => {
          try {
            const ok = sharedAskLease ? await sharedAskLease.renew() : await this.redis.eval("if redis.call('get',KEYS[1]) ~= ARGV[1] then return 0 end; return redis.call('pexpire',KEYS[1],180000)", { keys: [lock], arguments: [token] });
            if (!ok) controller.abort(fail('EXECUTION_LOCK_LOST'));
          } catch { controller.abort(fail('EXECUTION_UNAVAILABLE')); }
        }, 30000); renewal.unref();
        const requestTimeout = aiRequestTimeoutMs(req);
        if (requestTimeout !== null) timer = setTimeout(() => { clearInterval(renewal); controller.abort(fail('EXECUTION_TIMEOUT')); endTimedOutRequest(); }, requestTimeout);
        req.securityContext.transferToBackground = () => {
          req.securityContext.isBackgroundJob = true;
          clearTimeout(timer);
          timer = setTimeout(() => controller.abort(fail('EXECUTION_TIMEOUT')), 10 * 60 * 1000);
          timer.unref();
          return { signal: controller.signal, assertOwned: req.securityContext.assertLease, release: async () => { clearInterval(renewal); await finish(); } };
        };
        const finishRequest = () => {
          if (!req.securityContext.isBackgroundJob) { clearInterval(renewal); void finish(); }
        };
        res.once('finish', finishRequest);
        res.once('close', finishRequest);
        if (req.aborted || res.destroyed || res.writableEnded) return finishRequest();
        handlerEntered = true;
        next();
      } catch (error) {
        await finish();
        if (sharedAsk && error.code === 'RATE_LIMITED') {
          return res.status(429).json({ code: 'RATE_LIMITED', error: 'Ask üçün dəqiqəlik sorğu limiti dolub. Bir qədər sonra yenidən cəhd edin.' });
        }
        const isBuild = /^\/api\/strategy\/(?:estimate|assess|generate|generate-stream)\/?$/i.test(req.path);
        const exhaustedMsg = isBuild ? GUEST_BUILD_EXHAUSTED_MESSAGE : GUEST_EXHAUSTED_MESSAGE;
        res.status(error.status || 503).json({ code: error.code || 'EXECUTION_UNAVAILABLE', error: error.code === 'GUEST_DAILY_LIMIT' ? exhaustedMsg : 'Sorğu başlana bilmədi.', ...(error.code === 'GUEST_DAILY_LIMIT' ? { reply: exhaustedMsg } : {}) });
      }
    };
  }
  async reserveProvider(context, params, reservation = {}) {
    await this.assertEnabled();
    this.ready();
    let prices = {};
    try {
      if (this.env.AI_MODEL_PRICING) {
        prices = JSON.parse(this.env.AI_MODEL_PRICING);
      }
    } catch {
      prices = {};
    }
    const modelKey = params?.model || 'default';
    const price = prices[modelKey] ||
                  prices[String(modelKey).toLowerCase()] ||
                  DEFAULT_MODEL_PRICING[modelKey] ||
                  DEFAULT_MODEL_PRICING[String(modelKey).toLowerCase()] ||
                  DEFAULT_MODEL_PRICING.default;
    if (!price || !Number.isFinite(price.input) || !Number.isFinite(price.output) || price.input < 0 || price.output <= 0) throw fail('MODEL_PRICING_UNAVAILABLE');
    const tools = params?.tools || params?.config?.tools || [];
    const searching = tools.some(tool => tool.googleSearch || /web_search/.test(tool.type || ''));
    const searchPrice = Number.isFinite(price.search) ? price.search : 0.035;
    if (searching && (!Number.isFinite(searchPrice) || searchPrice < 0)) throw fail('TOOL_PRICING_UNAVAILABLE');
    let inlineBase64Chars = 0;
    const serialized = JSON.stringify(params, (key, value) => {
      if (key === 'data' && typeof value === 'string' && value.length > 4096) {
        inlineBase64Chars += value.length;
        return `[inlineData:${value.length}]`;
      }
      return value;
    });
    if (reservation?.outputTokenReservation !== undefined && !isValidBuildOutputReservation(modelKey, reservation.outputTokenReservation)) throw fail('BUDGET_CONFIGURATION_INVALID');
    const input = Buffer.byteLength(serialized || '') + Math.ceil(inlineBase64Chars / 750);
    const output = reservation?.outputTokenReservation ?? Math.min(params?.max_output_tokens || params?.max_completion_tokens || params?.max_tokens || params?.config?.maxOutputTokens || 16384, 16384);
    const searchCalls = searching ? (Number.isSafeInteger(params?.max_tool_calls) && params.max_tool_calls > 0 ? params.max_tool_calls : 1) : 0;
    const micros = Math.ceil(input * price.input + output * price.output + searchCalls * searchPrice * 1000000);
    const day = new Date().toISOString().slice(0, 10), keys = [`security:budget:${day}:${context?.ownerId}`, `security:budget:${day}:global`];
    const userLimit = Number(this.env.AI_USER_DAILY_USD || 5), globalLimit = Number(this.env.AI_PLATFORM_DAILY_USD || 100);
    if (!(Number.isFinite(userLimit) && Number.isFinite(globalLimit) && userLimit > 0 && globalLimit > 0)) throw fail('BUDGET_CONFIGURATION_INVALID');
    const maxSlots = Math.max(8, Number.parseInt(this.env.AI_MAX_PROVIDER_SLOTS || '64', 10) || 64);
    const token = randomUUID(), now = Date.now();
    if (!this.redis?.isReady) {
      if (!this.inMemoryBudgets) this.inMemoryBudgets = new Map();
      if (!this.inMemorySlots) this.inMemorySlots = new Map();
      for (const [slotToken, expiry] of this.inMemorySlots) {
        if (expiry <= now) this.inMemorySlots.delete(slotToken);
      }
      if (this.inMemorySlots.size >= maxSlots) throw fail('EXECUTION_BUSY', 429);
      const userCur = this.inMemoryBudgets.get(keys[0]) || 0;
      const globalCur = this.inMemoryBudgets.get(keys[1]) || 0;
      if (userCur + micros > Math.floor(userLimit * 1000000) || globalCur + micros > Math.floor(globalLimit * 1000000)) {
        throw fail('DAILY_BUDGET_EXCEEDED', 429);
      }
      this.inMemoryBudgets.set(keys[0], userCur + micros);
      this.inMemoryBudgets.set(keys[1], globalCur + micros);
      this.inMemorySlots.set(token, now + 180000);
      let recorded = false, released = false;
      const release = async () => {
        if (released) return;
        released = true;
        this.inMemorySlots.delete(token);
        if (!recorded) await release.refund();
      };
      release.recordUsage = async usage => {
        if (recorded) return;
        recorded = true;
        const observedMicros = Math.ceil(usage.inputTokens * price.input + usage.outputTokens * price.output + (usage.searchUsageKnown === false ? Math.max(searchCalls, usage.searchCalls) : usage.searchCalls) * searchPrice * 1000000);
        const delta = observedMicros - micros;
        const floor = Math.max(0, observedMicros);
        for (const key of keys) {
          const cur = this.inMemoryBudgets.get(key) ?? 0;
          this.inMemoryBudgets.set(key, Math.max(floor, cur + delta));
        }
      };
      release.refund = async () => {
        if (recorded) return;
        recorded = true;
        for (const key of keys) {
          const cur = this.inMemoryBudgets.get(key) ?? 0;
          this.inMemoryBudgets.set(key, Math.max(0, cur - micros));
        }
      };
      return release;
    }
    const accepted = await this.redis.eval(`redis.call('zremrangebyscore',KEYS[3],'-inf',ARGV[4]); if redis.call('zcard',KEYS[3]) >= ${maxSlots} then return -1 end; if tonumber(redis.call('get',KEYS[1]) or '0') + tonumber(ARGV[1]) > tonumber(ARGV[2]) or tonumber(redis.call('get',KEYS[2]) or '0') + tonumber(ARGV[1]) > tonumber(ARGV[3]) then return 0 end; for i=1,2 do redis.call('incrby',KEYS[i],ARGV[1]); redis.call('expire',KEYS[i],172800) end; redis.call('zadd',KEYS[3],ARGV[5],ARGV[6]); return 1`, { keys: [...keys, 'security:provider-slots'], arguments: [String(micros), String(Math.floor(userLimit * 1000000)), String(Math.floor(globalLimit * 1000000)), String(now), String(now + 180000), token] });
    if (accepted !== 1) throw fail(accepted === -1 ? 'EXECUTION_BUSY' : 'DAILY_BUDGET_EXCEEDED', 429);
    const heartbeat = setInterval(async () => {
      try {
        await this.assertEnabled();
        if (!this.redis.isReady || !await this.redis.eval("local expiry = redis.call('zscore',KEYS[1],ARGV[1]); if not expiry or tonumber(expiry) <= tonumber(ARGV[2]) then return 0 end; redis.call('zadd',KEYS[1],ARGV[3],ARGV[1]); return 1", { keys: ['security:provider-slots'], arguments: [token, String(Date.now()), String(Date.now() + 180000)] })) throw fail('EXECUTION_LOCK_LOST');
      }
      catch (error) { context.controller?.abort(error); }
    }, 30000); heartbeat.unref();
    let recorded = false, released = false;
    const release = async () => { if (released) return; released = true; clearInterval(heartbeat); await this.redis.zRem('security:provider-slots', token).catch(() => {}); };
    release.recordUsage = async usage => {
      if (recorded) return;
      recorded = true;
      const observedMicros = Math.ceil(usage.inputTokens * price.input + usage.outputTokens * price.output + (usage.searchUsageKnown === false ? Math.max(searchCalls, usage.searchCalls) : usage.searchCalls) * searchPrice * 1000000);
      const modelHash = createHash('sha256').update(modelKey).digest('hex');
      const usageKeys = keys.map(key => `${key}:usage:${modelHash}`);
      // Settle reported usage once; retain reserved search spend when the provider does not report billable search units.
      await this.redis.eval("if redis.call('exists',KEYS[5]) == 1 then return 0 end; redis.call('set',KEYS[5],1,'EX',172800); for i=1,2 do local cur = tonumber(redis.call('get',KEYS[i])); local delta = tonumber(ARGV[1]) or 0; local floor = math.max(0, tonumber(ARGV[5]) or 0); local next = cur and math.max(floor, cur + delta) or floor; redis.call('set',KEYS[i],tostring(next),'EX',172800) end; for i=3,4 do redis.call('hincrby',KEYS[i],'inputTokens',ARGV[2]); redis.call('hincrby',KEYS[i],'outputTokens',ARGV[3]); redis.call('hincrby',KEYS[i],'searchCalls',ARGV[4]); redis.call('hincrby',KEYS[i],'estimatedMicros',ARGV[5]); redis.call('hincrby',KEYS[i],'calls',1); redis.call('expire',KEYS[i],172800) end; return 1", { keys: [...keys, ...usageKeys, `security:usage-record:${token}`], arguments: [String(observedMicros - micros), String(usage.inputTokens), String(usage.outputTokens), String(usage.searchCalls), String(observedMicros)] });
    };
    release.refund = async () => {
      if (recorded) return;
      await release.recordUsage({ inputTokens: 0, outputTokens: 0, searchCalls: 0, searchUsageKnown: true });
    };
    return release;
  }
  _trackInMemoryGuestUsage(req, limit, isBuild = false) {
    if (!this.inMemoryGuestUsage) this.inMemoryGuestUsage = new Map();
    const actor = req.ownerId || 'guest_unknown';
    const day = new Date().toISOString().slice(0, 10);
    const prefix = isBuild ? `${day}:build` : day;
    const keys = [`${prefix}:owner:${actor}`, `${prefix}:ip:${this.ipKey(req)}`];
    const prev = Math.max(...keys.map(key => this.inMemoryGuestUsage.get(key) || 0));
    if (prev >= limit) throw fail('GUEST_DAILY_LIMIT', 429);
    for (const key of keys) this.inMemoryGuestUsage.set(key, (this.inMemoryGuestUsage.get(key) || 0) + 1);
    req.guestMemoryQuotaKeys = keys;
    const next = prev + 1;
    if (this.inMemoryGuestUsage.size > 10000) {
      for (const [k] of this.inMemoryGuestUsage) {
        if (!k.startsWith(day)) this.inMemoryGuestUsage.delete(k);
      }
    }
    return next;
  }
  _getInMemoryGuestUsage(req, isBuild = false) {
    if (!this.inMemoryGuestUsage) return 0;
    const actor = req.ownerId || 'guest_unknown';
    const day = new Date().toISOString().slice(0, 10);
    const prefix = isBuild ? `${day}:build` : day;
    const keys = [`${prefix}:owner:${actor}`, `${prefix}:ip:${this.ipKey(req)}`];
    return Math.max(...keys.map(key => this.inMemoryGuestUsage.get(key) || 0));
  }
  guestQuotaHandler() {
    return async (req, res) => {
      res.set('Cache-Control', 'no-store');
      try {
        res.json(await this.getGuestQuota(req));
      } catch (error) {
        console.error('Guest quota unavailable', error.code || error.name);
        res.status(503).json({ code: 'EXECUTION_UNAVAILABLE', error: 'Mesaj limitini yoxlamaq mümkün olmadı.' });
      }
    };
  }
  async getGuestQuota(req) {
    const isGuest = !req.user;
    const limit = guestDailyLimit(this.env);
    const buildLimit = guestBuildDailyLimit(this.env);
    if (!isGuest) {
      return {
        isGuest: false,
        limit: null,
        used: 0,
        remaining: null,
        buildLimit: null,
        buildUsed: 0,
        buildRemaining: null,
      };
    }
    this.ready();
    const actor = req.ownerId || 'guest_unknown';
    const day = new Date().toISOString().slice(0, 10);
    let used = 0;
    let buildUsed = 0;
    if (this.redis?.isReady) {
      const ip = this.ipKey(req);
      const keys = [
        `security:guest-day:${day}:${actor}`,
        `security:guest-ip-day:${day}:${ip}`,
        `security:guest-build-day:${day}:${actor}`,
        `security:guest-build-ip-day:${day}:${ip}`,
      ];
      try {
        const vals = await this.redis.mGet(keys);
        if ((vals.length !== 2 && vals.length !== 4) || vals.some(value => value !== null && (!/^\d+$/.test(String(value)) || !Number.isSafeInteger(Number(value))))) throw fail('EXECUTION_UNAVAILABLE');
        used = Math.max(0, ...vals.slice(0, 2).map(value => Number(value || 0)));
        if (vals.length === 4) {
          buildUsed = Math.max(0, ...vals.slice(2, 4).map(value => Number(value || 0)));
        }
      } catch { throw fail('EXECUTION_UNAVAILABLE'); }
    } else if (this.inMemoryGuestUsage) {
      used = Math.max(this.inMemoryGuestUsage.get(`${day}:owner:${actor}`) || 0, this.inMemoryGuestUsage.get(`${day}:ip:${this.ipKey(req)}`) || 0);
      buildUsed = Math.max(this.inMemoryGuestUsage.get(`${day}:build:owner:${actor}`) || 0, this.inMemoryGuestUsage.get(`${day}:build:ip:${this.ipKey(req)}`) || 0);
    }
    return {
      isGuest: true,
      limit,
      used,
      remaining: Math.max(0, limit - used),
      buildLimit,
      buildUsed,
      buildRemaining: Math.max(0, buildLimit - buildUsed),
      resetsAt: new Date(`${day}T00:00:00.000Z`).getTime() + 86400000,
    };
  }
}
