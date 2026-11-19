import { createHash, createHmac, randomUUID } from 'node:crypto';
import net from 'node:net';
import { BUILD_OUTPUT_RESERVATIONS, isValidBuildOutputReservation } from '../ai/build-config.js';
import {
  guestAskPerMinuteLimit,
  guestAskIpPerMinuteLimit,
  guestBuildPerMinuteLimit,
  guestBuildIpPerMinuteLimit,
} from './config.js';
import { GUEST_RESTRICTION_NOTICES, detectGuestFunctionalRestriction } from '../ai/prompts.js';
import { resolveAskThinkingLevel } from '../ai/ask-routing.js';
import {
  ASK_BARRIER,
  LEASE_MS,
  acquireLocalOwnerExecutionLease,
  acquireSharedAskLease,
  createSharedAskLeaseHandle,
} from './owner-execution-lease.js';
import { requestFingerprint } from './request-fingerprint.js';

const fail = (code, status = 503) => Object.assign(new Error(code), { code, status });
export const CONCURRENT_PAUSE_CHECK_SYMBOL = Symbol('helmer.aiPolicy.concurrentPauseCheck');
export const ASK_REQUESTS_PER_MINUTE = 15;
const ASK_IP_REQUESTS_PER_MINUTE = 60;
const ASK_RATE_WINDOW_MS = 60000;
const LOCAL_ASK_REPLAY_TTL_MS = 15 * 60 * 1000;
const LOCAL_ASK_REPLAY_LIMIT = 512;
const LOCAL_ASK_REPLAY_MAX_BYTES = 32 * 1024;

function reserveMinuteRate(redis, keys, limits, token, windowMs = ASK_RATE_WINDOW_MS) {
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
    keys,
    arguments: [token, String(windowMs), ...limits.map(String)],
  });
}

function reserveAskRate(redis, actor, ip, token) {
  return reserveMinuteRate(
    redis,
    [`security:ask-minute:${actor}`, `security:ask-minute-ip:${ip}`],
    [ASK_REQUESTS_PER_MINUTE, ASK_IP_REQUESTS_PER_MINUTE],
    token,
  );
}

/**
 * Atomically verifies the AI kill switch, claims an idempotency key (or returns an existing record),
 * reserves rolling per-owner and per-IP minute rate limits, and acquires a shared Ask execution lease
 * in a single Redis RTT without mutating rate or lease keys on any rejection path.
 */
function admitSharedAskAtomic(redis, { requestKey, candidate, actor, ip, token }) {
  const ownerKey = `security:owner-execution:${actor}`;
  return redis.eval(`
    if redis.call('get', KEYS[1]) == '1' then return {'PAUSED'} end
    local existing = redis.call('get', KEYS[2])
    if existing then return {'EXISTS', existing} end
    local t = redis.call('TIME')
    local now = t[1] * 1000 + math.floor(t[2] / 1000)
    local window = tonumber(ARGV[3])
    local limits = { tonumber(ARGV[4]), tonumber(ARGV[5]) }
    local retry = 0
    for idx = 1, 2 do
      local rk = KEYS[idx + 2]
      redis.call('zremrangebyscore', rk, '-inf', now - window)
      if redis.call('zcard', rk) >= limits[idx] then
        local oldest = redis.call('zrange', rk, 0, 0, 'WITHSCORES')
        retry = math.max(retry, tonumber(oldest[2]) + window - now)
      end
    end
    if retry > 0 then return {'RATE_LIMITED', tostring(math.ceil(retry / 1000))} end
    local owner = redis.call('get', KEYS[5])
    if owner and owner ~= ARGV[6] then return {'BUSY'} end
    redis.call('set', KEYS[2], ARGV[1], 'EX', 900)
    for idx = 3, 4 do
      redis.call('zadd', KEYS[idx], now, ARGV[2])
      redis.call('pexpire', KEYS[idx], window)
    end
    local leaseMs = tonumber(ARGV[7])
    redis.call('zremrangebyscore', KEYS[6], '-inf', now)
    redis.call('zadd', KEYS[6], now + leaseMs, ARGV[2])
    redis.call('pexpire', KEYS[6], leaseMs)
    redis.call('set', KEYS[5], ARGV[6], 'PX', leaseMs)
    return {'OK'}
  `, {
    keys: [
      'security:ai-paused',
      requestKey,
      `security:ask-minute:${actor}`,
      `security:ask-minute-ip:${ip}`,
      ownerKey,
      `${ownerKey}:ask-leases`,
    ],
    arguments: [
      candidate,
      token,
      String(ASK_RATE_WINDOW_MS),
      String(ASK_REQUESTS_PER_MINUTE),
      String(ASK_IP_REQUESTS_PER_MINUTE),
      ASK_BARRIER,
      LEASE_MS,
    ],
  });
}

export const DEFAULT_MODEL_PRICING = Object.freeze({
  get 'gemini-4-carbon'() {
    return Date.now() < Date.UTC(2026, 11, 1)
      ? { input: 2.00, output: 10.00, search: 0.014 }
      : { input: 4.00, output: 20.00, search: 0.014 };
  },
  'gemini-4-hydrogen': { input: 1.50, output: 7.50, search: 0.035 },
  'gemini-3.5-flash-lite': { input: 0.30, output: 2.50, search: 0.035 },
  'gemini-decision-1': { input: 0.10, output: 0.00, search: 0 },
  'gpt-5.6-luna': { input: 0.25, output: 1.00, search: 0.030 },
  'gpt-6-luna': { input: 0.25, output: 1.00, search: 0.030 },
  'gpt-5.6-terra': { input: 1.25, output: 5.00, search: 0.035 },
  'gpt-6-sol': { input: 2.00, output: 10.00, search: 0.050 },
  'gpt-6.1-sol': { input: 2.00, output: 10.00, search: 0.050 },
  'gpt-4o': { input: 2.50, output: 10.00, search: 0.035 },
  'default': { input: 2.50, output: 10.00, search: 0.035 },
});

export function resolveEffectiveModelPricing(model, env = process.env) {
  let prices = {};
  try {
    if (env?.AI_MODEL_PRICING) {
      prices = JSON.parse(env.AI_MODEL_PRICING);
    }
  } catch {
    prices = {};
  }
  const modelKey = model || 'default';
  const price = prices[modelKey] ||
    prices[String(modelKey).toLowerCase()] ||
    DEFAULT_MODEL_PRICING[modelKey] ||
    DEFAULT_MODEL_PRICING[String(modelKey).toLowerCase()] ||
    DEFAULT_MODEL_PRICING.default;
  if (!price || !Number.isFinite(price.input) || !Number.isFinite(price.output) || price.input < 0 || price.output < 0) {
    return null;
  }
  const search = Number.isFinite(price.search) ? Number(price.search) : 0.035;
  return {
    input: Number(price.input),
    output: Number(price.output),
    search,
    searchMicros: Math.round(search * 1_000_000),
  };
}

function normalizeRequestPath(path) {
  return String(path || '').replace(/\/{2,}/g, '/');
}

export function isAiRequest(req) {
  const reqPath = normalizeRequestPath(req.path);
  return req.method === 'POST' && (
    /^\/api\/ask(?:\/research)?\/?$/i.test(reqPath) ||
    /^\/api\/strategy\/(?:estimate|assess|generate|generate-stream|refine|[^/]+\/refine)\/?$/i.test(reqPath) ||
    /^\/api\/planner\/(?:summarize|prioritize)\/?$/i.test(reqPath) ||
    /^\/api\/up\/challenges(?:\/[0-9a-f-]{36}\/(?:submit|retry))?\/?$/i.test(reqPath)
  );
}

export function aiRequestTimeoutMs(req) {
  if (req.method === 'POST') {
    const reqPath = normalizeRequestPath(req.path);
    if (/^\/api\/strategy\/estimate\/?$/i.test(reqPath)) return 45000;
    if (/^\/api\/strategy\/assess\/?$/i.test(reqPath)) return 90000;
    if (/^\/api\/strategy\/(?:generate|generate-stream|refine|[0-9a-f-]{36}\/refine)\/?$/i.test(reqPath)) return 600000;
  }
  return 180000;
}

function canonicalRequestRoute(path) {
  return normalizeRequestPath(path).toLowerCase().replace(/\/$/, '');
}

export function createReplayResourceCheck({ chatRepository, strategyRepository, getResearchJob }) {
  return async (req, result) => {
    const route = canonicalRequestRoute(req.path);
    if (route === '/api/ask' || route === '/api/ask/research') {
      const chat = result.chatId && await chatRepository.getById(result.chatId, req.ownerId, { coalesce: false });
      if (!chat) return false;
      if (result.jobId) return Boolean(await getResearchJob(result.jobId, req.ownerId));
      return (chat.revision || 1) === result.chatRevision &&
        chat.messages.length === result.chat?.messages?.length;
    }
    const refine = /^\/api\/strategy\/([0-9a-f-]{36})\/refine$/.exec(route);
    const generation = route === '/api/strategy/generate' || route === '/api/strategy/generate-stream';
    if (refine || (generation && result.savedId)) {
      const cached = result.savedStrategy || result.strategy;
      const current = await strategyRepository.getById(refine?.[1] || result.savedId, req.ownerId, { coalesce: false });
      return Boolean(current && typeof cached?.updatedAt === 'string' && cached.updatedAt === current.updatedAt &&
        cached.versions?.length === current.versions?.length);
    }
    return true;
  };
}

export class AiPolicy {
  constructor({ redis, env = process.env, fetcher = fetch, allowParallelAskChats = false, canReplay = null }) {
    Object.assign(this, { redis, env, fetcher, allowParallelAskChats, canReplay });
    this.localAskRequests = new Map();
    this.releasingOwnerLocks = new Map();
  }
  async sendReplay(req, res, result) {
    try {
      const visible = await this.canReplay?.(req, result.body);
      await req.securityContext?.assertAuthorized?.();
      res.setHeader?.('Cache-Control', 'private, no-store');
      if (visible === false) return res.status(409).json({ code: 'RESULT_UNAVAILABLE', error: 'Əvvəlki nəticə artıq əlçatan deyil.' });
      return res.status(result.status).json(result.body);
    } catch {
      return res.status(503).json({ code: 'EXECUTION_UNAVAILABLE', error: 'Əvvəlki nəticəni yoxlamaq mümkün olmadı.' });
    }
  }
  async admitLocalAsk(req, res, idempotencyKey) {
    const route = canonicalRequestRoute(req.path);
    const key = createHash('sha256').update(`${req.ownerId}:${route}:${idempotencyKey}`).digest('hex');
    const fingerprint = requestFingerprint(req.body);
    const now = Date.now();
    for (const [storedKey, entry] of this.localAskRequests) {
      if (entry.expiresAt <= now) this.localAskRequests.delete(storedKey);
    }
    const previous = this.localAskRequests.get(key);
    if (previous) {
      if (previous.fingerprint !== fingerprint) {
        res.status(409).json({ code: 'IDEMPOTENCY_CONFLICT', error: 'Eyni sorğu açarı fərqli parametrlərlə istifadə edilib.' });
      } else if (previous.result) {
        await this.sendReplay(req, res, previous.result);
      } else {
        res.status(409).json({ code: 'REQUEST_ALREADY_SUBMITTED', error: 'Eyni sorğu artıq göndərilib.' });
      }
      return false;
    }
    if (this.localAskRequests.size >= LOCAL_ASK_REPLAY_LIMIT) {
      res.status(503).json({ code: 'EXECUTION_UNAVAILABLE', error: 'Sorğu başlana bilmədi.' });
      return false;
    }
    const entry = { fingerprint, expiresAt: now + LOCAL_ASK_REPLAY_TTL_MS };
    this.localAskRequests.set(key, entry);
    const context = req.securityContext;
    context.markMutationPending = () => { context.mutationPending = true; };
    context.recordIdempotentResult = (status, body) => {
      context.mutationCommitted = true;
      context.mutationPending = false;
      if (Buffer.byteLength(JSON.stringify(body)) <= LOCAL_ASK_REPLAY_MAX_BYTES) entry.result = { status, body };
    };
    const json = res.json.bind(res);
    res.json = body => {
      if (res.statusCode >= 200 && res.statusCode < 300 && !context.mutationCommitted) {
        context.recordIdempotentResult(res.statusCode, body);
      }
      return json(body);
    };
    const finish = () => {
      if (context._askBackgroundActive) return;
      if (!context.mutationPending && !context.mutationCommitted && this.localAskRequests.get(key) === entry) {
        this.localAskRequests.delete(key);
      }
    };
    context._finishLocalAsk = () => {
      context._askBackgroundActive = false;
      finish();
    };
    res.once('finish', finish);
    res.once('close', finish);
    return true;
  }
  async assertEnabled({ maxStaleMs = 0 } = {}) {
    this.ready();
    if (this.env.AI_EXECUTION_DISABLED === 'true') throw fail('EXECUTION_DISABLED');
    if (this.redis?.isReady && this.redis.get) {
      const now = Date.now();
      if (maxStaleMs > 0 && this._lastEnabledOkAt && (now - this._lastEnabledOkAt < maxStaleMs)) {
        if (now - this._lastEnabledOkAt >= 250 && !this._inFlightPauseCheck) {
          this._inFlightPauseCheck = Promise.resolve(this.redis.get('security:ai-paused'))
            .then(value => {
              this._lastEnabledOkAt = value === '1' ? 0 : Date.now();
              return value;
            }, err => {
              this._lastEnabledOkAt = 0;
              throw err;
            })
            .finally(() => { this._inFlightPauseCheck = null; });
          this._inFlightPauseCheck.catch(() => {});
        }
        return;
      }
      if (!this._inFlightPauseCheck) {
        this._inFlightPauseCheck = Promise.resolve(this.redis.get('security:ai-paused'))
          .then(value => {
            this._lastEnabledOkAt = value === '1' ? 0 : Date.now();
            return value;
          }, err => {
            this._lastEnabledOkAt = 0;
            throw err;
          })
          .finally(() => { this._inFlightPauseCheck = null; });
      }
      if (await this._inFlightPauseCheck === '1') throw fail('EXECUTION_DISABLED');
    } else {
      this._lastEnabledOkAt = 0;
    }
  }
  ready() {
    if ((this.env.NODE_ENV === 'production' || this.redis) && !this.redis?.isReady) throw fail('EXECUTION_UNAVAILABLE');
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
    const isProd = this.env.NODE_ENV === 'production';
    const allowedHosts = isProd
      ? new Set([appHost, 'helmeros.com', 'www.helmeros.com'])
      : new Set([appHost, 'helmeros.com', 'www.helmeros.com', 'localhost', '127.0.0.1']);
    const actionMatches = isProd ? result?.action === 'guest-ai' : (!result?.action || result.action === 'guest-ai');
    const hostMatches = isProd ? (Boolean(result?.hostname) && allowedHosts.has(result.hostname)) : (!result?.hostname || allowedHosts.has(result.hostname));
    if (!result?.success || !actionMatches || !hostMatches) throw fail('BOT_VERIFICATION_FAILED', 403);
  }
  ipKey(req) {
    let ip = String(req.ip || req.socket?.remoteAddress || '').replace(/^::ffff:/, '');
    if (net.isIP(ip) === 6) ip = ip.split(':').slice(0, 4).join(':');
    return createHmac('sha256', this.env.SESSION_SECRET || this.env.AUTH_SECRET || 'local-only').update(ip).digest('hex');
  }
  middleware() {
    return async (req, res, next) => {
      const reqPath = normalizeRequestPath(req.path);
      if (!/^\/api\/(?:ask|strategy|planner|up|user|artifacts)(?:\/|$)/i.test(reqPath)) return next();
      if (req.user?.status && req.user.status !== 'active') return res.status(403).json({ code: 'ACCOUNT_UNAVAILABLE', error: 'Hesab aktiv deyil.' });
      if (req.user && !req.user.emailVerifiedAt) return res.status(403).json({ code: 'EMAIL_VERIFICATION_REQUIRED', error: 'E-poçtunu təsdiqlə.' });
      const previousAuthorization = req.securityContext?.assertAuthorized;
      const guest = !req.user;
      if (req.securityContext) {
        req.securityContext.ipKey = this.ipKey(req);
        req.securityContext.isGuest = guest;
        req.securityContext.assertAuthorized = async (options = {}) => {
          await Promise.all([this.assertEnabled(options), req.securityContext.assertLease?.(options), previousAuthorization?.(options)]);
        };
      }
      if (guest && (/^\/api\/(?:up|user|artifacts)(?:\/|$)/i.test(reqPath) || /^\/api\/ask\/research(?:\/|$)/i.test(reqPath))) return res.status(401).json({ code: 'AUTH_REQUIRED' });
      if (guest) {
        let notice;
        if (/^\/api\/planner(?:\/|$)/i.test(reqPath)) notice = GUEST_RESTRICTION_NOTICES.planner;
        if (/^\/api\/strategy(?:\/|$)/i.test(reqPath) && !(req.method === 'POST' && /^\/api\/strategy\/(?:estimate|assess|generate|generate-stream)\/?$/i.test(reqPath))) notice = GUEST_RESTRICTION_NOTICES.strategy;
        if (req.method === 'POST' && /^\/api\/ask\/?$/i.test(reqPath)) {
          const body = req.body || {};
          if (body.thinkingLevel !== undefined && (typeof body.thinkingLevel !== 'string' || !['low', 'medium', 'high', 'off', 'auto'].includes(body.thinkingLevel))) {
            return res.status(400).json({ code: 'VALIDATION_ERROR', error: 'Düşünmə səviyyəsi düzgün deyil.' });
          }
          const messages = Array.isArray(body.messages) ? body.messages : [];
          const lastUserMsg = typeof messages.at(-1)?.content === 'string' ? messages.at(-1).content : '';
          notice = detectGuestFunctionalRestriction({
            lastUserMsg,
            hasAttachment: messages.some(message => Boolean(message?.file)),
            hasStrategyContext: Boolean(body.strategyId || body.briefId), hasTaskContext: Boolean(body.taskId),
            rawThinkingLevel: resolveAskThinkingLevel({ requestedThinkingLevel: body.thinkingLevel, lastUserMsg }),
            explicitLowThinking: body.thinkingLevel === 'low',
          }) || notice;
        }
        if (notice) return res.status(401).json({ code: 'AUTH_REQUIRED', error: notice, reply: notice });
      }
      if (!isAiRequest(req)) return next();
      const isAsk = /^\/api\/ask\/?$/i.test(reqPath);
      const isResearch = /^\/api\/ask\/research\/?$/i.test(reqPath);
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
      const token = randomUUID();
      let preClaimedRequest = null;
      let preAdmittedSharedAsk = null;
      const preId = (!guest && this.redis?.isReady && typeof req.get === 'function') ? req.get('Idempotency-Key') : '';
      const preBodyId = typeof req.body?.idempotencyKey === 'string' ? req.body.idempotencyKey.trim() : '';
      const canOverlapEnableAndIdempotency =
        !guest &&
        this.redis?.isReady &&
        preId &&
        /^[A-Za-z0-9_-]{16,100}$/.test(preId) &&
        (!preBodyId || preBodyId === preId);
      const supportsAtomicLua = Boolean(
        this.redis?.isReady &&
        typeof this.redis.eval === 'function' &&
        (typeof this.redis.sendCommand === 'function' || this.redis.supportsAtomicLua === true)
      );
      if (sharedAsk && canOverlapEnableAndIdempotency && supportsAtomicLua && this.env.AI_EXECUTION_DISABLED !== 'true' && !this.releasingOwnerLocks.get(req.ownerId)) {
        const key = `security:request:${createHash('sha256').update(`${req.ownerId}:${canonicalRequestRoute(reqPath)}:${preId}`).digest('hex')}`;
        const fp = requestFingerprint(req.body);
        const candidate = JSON.stringify({ state: 'reserved', fingerprint: fp, token });
        const actor = req.ownerId;
        const ip = this.ipKey(req);
        try {
          let outcome = await admitSharedAskAtomic(this.redis, { requestKey: key, candidate, actor, ip, token });
          if (outcome?.[0] === 'BUSY' && !req.aborted && !res.destroyed) {
            await new Promise((resolve) => setTimeout(resolve, 150));
            if (!req.aborted && !res.destroyed) {
              outcome = await admitSharedAskAtomic(this.redis, { requestKey: key, candidate, actor, ip, token });
            }
          }
          const tag = outcome?.[0];
          if (tag === 'PAUSED') {
            return res.status(503).json({ code: 'EXECUTION_DISABLED', error: 'Sorğu icra edilə bilmədi.' });
          }
          if (tag === 'RATE_LIMITED') {
            res.setHeader('Retry-After', String(Math.max(1, Number(outcome?.[1]) || 1)));
            return res.status(429).json({ code: 'RATE_LIMITED', error: this._rateLimitErrorMessage(req) });
          }
          if (tag === 'BUSY') {
            return res.status(429).json({ code: 'EXECUTION_BUSY', error: 'Hazırda başqa tapşırıq icra olunur. Bir az sonra yenidən cəhd edin.' });
          }
          this._lastEnabledOkAt = Date.now();
          if (tag === 'EXISTS') {
            preClaimedRequest = { key, fp, candidate, nxResult: { ok: true, value: null }, existingValue: outcome?.[1] ?? null };
          } else if (tag === 'OK') {
            preClaimedRequest = { key, fp, candidate, nxResult: { ok: true, value: 'OK' } };
            preAdmittedSharedAsk = { sharedAskLease: createSharedAskLeaseHandle(this.redis, actor, token) };
          } else {
            return res.status(503).json({ code: 'EXECUTION_UNAVAILABLE', error: 'Sorğu icra edilə bilmədi.' });
          }
        } catch {
          return res.status(503).json({ code: 'EXECUTION_UNAVAILABLE', error: 'Sorğu icra edilə bilmədi.' });
        }
      } else if (canOverlapEnableAndIdempotency) {
        const key = `security:request:${createHash('sha256').update(`${req.ownerId}:${canonicalRequestRoute(reqPath)}:${preId}`).digest('hex')}`;
        const fp = requestFingerprint(req.body);
        const candidate = JSON.stringify({ state: 'reserved', fingerprint: fp, token });
        const [enabledError, nxResult] = await Promise.all([
          this.assertEnabled().then(() => null, error => error),
          this.redis.set(key, candidate, { NX: true, EX: 900 }).then(
            value => ({ ok: true, value }),
            error => ({ ok: false, error }),
          ),
        ]);
        if (enabledError) {
          if (nxResult.ok && nxResult.value) {
            await this.redis.eval("if redis.call('get',KEYS[1]) == ARGV[1] then return redis.call('del',KEYS[1]) end; return 0", { keys: [key], arguments: [candidate] }).catch(() => {});
          }
          return res.status(503).json({ code: enabledError.code === 'EXECUTION_DISABLED' ? 'EXECUTION_DISABLED' : 'EXECUTION_UNAVAILABLE', error: 'Sorğu icra edilə bilmədi.' });
        }
        preClaimedRequest = { key, fp, candidate, nxResult };
      } else {
        try { await this.assertEnabled(); }
        catch (error) { return res.status(error.code === 'EXECUTION_DISABLED' ? 503 : 503).json({ code: error.code === 'EXECUTION_DISABLED' ? 'EXECUTION_DISABLED' : 'EXECUTION_UNAVAILABLE', error: 'Sorğu icra edilə bilmədi.' }); }
      }
      let controller;
      if (!this.redis?.isReady) {
        if (this.env.NODE_ENV === 'production') {
          return res.status(503).json({ code: 'EXECUTION_UNAVAILABLE', error: 'Sorğu icra edilə bilmədi.' });
        }
        const askKey = (isAsk || isResearch) && req.get?.('Idempotency-Key');
        if ((isAsk || isResearch) && !/^[A-Za-z0-9_-]{16,100}$/.test(askKey || '')) {
          return res.status(400).json({ code: 'IDEMPOTENCY_KEY_REQUIRED', error: 'Etibarlı sorğu açarı tələb olunur.' });
        }
        try {
          if (guest) await this.turnstile(req);
        } catch (error) {
          return res.status(error.status || 403).json({ code: error.code || 'BOT_VERIFICATION_FAILED', error: 'Sorğu başlana bilmədi.' });
        }
        if ((isAsk || isResearch) && !await this.admitLocalAsk(req, res, askKey)) return;
        if (guest) {
          const spec = this._guestMinuteRateSpec(req);
          const retryAfter = this._reserveLocalMinuteRate(spec.keys, spec.limits);
          if (retryAfter > 0) {
            res.setHeader('Retry-After', String(retryAfter));
            return res.status(429).json({ code: 'RATE_LIMITED', error: this._rateLimitErrorMessage(req) });
          }
          req.remainingGuestMessages = null;
          req.remainingGuestBriefs = null;
        }
        const route = canonicalRequestRoute(reqPath);
        const refineKey = /^\/api\/strategy\/(?:[0-9a-f-]{36}\/)?refine$/.test(route) && req.get?.('Idempotency-Key')?.trim();
        const shareKey = /^[A-Za-z0-9_-]{16,100}$/.test(refineKey || '') ? `${route}:${refineKey}` : null;
        let lease;
        try {
          lease = acquireLocalOwnerExecutionLease(req.ownerId, shareKey);
        } catch (error) {
          return res.status(error.status).json({ code: error.code, error: 'Hazırda başqa tapşırıq icra olunur. Bir az sonra yenidən cəhd edin.' });
        }
        controller = new AbortController();
        req.securityContext.route = reqPath;
        req.securityContext.controller = controller;
        req.securityContext.signal = controller.signal;
        req.securityContext.assertLease = lease.assertOwned;
        let memoryTimer;
        const releaseLease = async () => {
          clearTimeout(memoryTimer);
          controller.abort();
          await lease.release();
        };
        const requestTimeout = aiRequestTimeoutMs(req);
        if (requestTimeout !== null) {
          memoryTimer = setTimeout(() => {
            controller.abort(fail('EXECUTION_TIMEOUT'));
            endTimedOutRequest();
          }, requestTimeout);
          memoryTimer.unref?.();
        }
        let askBackgroundActive = false;
        req.securityContext.enableAskBackgroundCompletion = (timeoutMs = null) => {
          askBackgroundActive = true;
          req.securityContext._askBackgroundActive = true;
          if (timeoutMs && Number.isFinite(Number(timeoutMs))) {
            clearTimeout(memoryTimer);
            memoryTimer = setTimeout(() => {
              controller.abort(fail('EXECUTION_TIMEOUT'));
              endTimedOutRequest();
            }, Number(timeoutMs));
            memoryTimer.unref?.();
          }
          return async () => {
            askBackgroundActive = false;
            await releaseLease();
            req.securityContext?._finishLocalAsk?.();
          };
        };
        req.securityContext.transferToBackground = () => {
          req.securityContext.isBackgroundJob = true;
          lease.allowSubscribers();
          clearTimeout(memoryTimer);
          memoryTimer = setTimeout(() => controller.abort(fail('EXECUTION_TIMEOUT')), 10 * 60 * 1000);
          memoryTimer.unref?.();
          return {
            signal: controller.signal,
            assertOwned: lease.assertOwned,
            release: releaseLease,
          };
        };
        const finishRequest = () => {
          if (!req.securityContext.isBackgroundJob && !askBackgroundActive) void releaseLease();
        };
        res.once('finish', finishRequest);
        res.once('close', finishRequest);
        if (req.aborted || res.destroyed || res.writableEnded) return finishRequest();
        return next();
      }
      let requestKey, requestRecord, previousRequest, lock, sharedAskLease, fingerprint;
      let replayResult;
      const isUpRequest = /^\/api\/up\/challenges(?:\/|$)/i.test(reqPath);
      const isDurableStrategyRequest = /^\/api\/strategy\/(?:generate|[0-9a-f-]{36}\/refine)\/?$/i.test(reqPath);
      let finished = false, handlerEntered = false, idempotentPersisted = false;
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
        if (/^\/api\/ask(?:\/research)?\/?$/i.test(reqPath)) req.securityContext.persistIdempotentResult = async () => {
          controller.signal.throwIfAborted();
          if (!requestKey || !requestRecord || !replayResult) throw fail('EXECUTION_UNAVAILABLE');
          const completed = JSON.stringify({ state: 'completed', fingerprint, result: replayResult });
          try {
            const saved = await this.redis.eval("if redis.call('get',KEYS[1]) ~= ARGV[1] then return 0 end; redis.call('set',KEYS[1],ARGV[2],'EX',900); return 1", {
              keys: [requestKey], arguments: [requestRecord, completed],
            });
            if (saved !== 1) throw fail('EXECUTION_UNAVAILABLE');
            requestRecord = completed;
            idempotentPersisted = true;
          } catch { throw fail('EXECUTION_UNAVAILABLE'); }
        };
      }
      const finish = async () => {
        if (finished) return; finished = true;
        clearTimeout(timer);
        controller?.abort();
        const canRetryAfterPreCommitFailure =
          handlerEntered &&
          !replayResult &&
          (res.statusCode >= 500 || req.securityContext?.preCommitFailure || req.securityContext?.explicitCancel || (isAsk && (req.securityContext?.askTerminalFailure || res.destroyed || req.aborted))) &&
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
        if (requestKey && requestRecord && !(idempotentPersisted && replayResult)) await this.redis.eval("if redis.call('get',KEYS[1]) ~= ARGV[1] then return 0 end; redis.call('set',KEYS[1],ARGV[2],'EX',900); return 1", { keys: [requestKey], arguments: [requestRecord, JSON.stringify({ state: finalState, fingerprint, result: replayResult })] }).catch(() => {});
        const releaseOps = [];
        if (lock) releaseOps.push(this.redis.eval("if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) end; return 0", { keys: [lock], arguments: [token] }).catch(() => {}));
        if (sharedAskLease) releaseOps.push(sharedAskLease.release().catch(() => {}));
        if (releaseOps.length) {
          const ownerKey = req.ownerId;
          const releasePromise = Promise.all(releaseOps).finally(() => {
            if (ownerKey && this.releasingOwnerLocks.get(ownerKey) === releasePromise) {
              this.releasingOwnerLocks.delete(ownerKey);
            }
          });
          if (ownerKey) this.releasingOwnerLocks.set(ownerKey, releasePromise);
          await releasePromise;
        }
      };
      let timer;
      try {
        if (guest) await this.turnstile(req);
        this.ready();
        let nxClaimed;
        let candidate;
        if (preClaimedRequest) {
          requestKey = preClaimedRequest.key;
          fingerprint = preClaimedRequest.fp;
          candidate = preClaimedRequest.candidate;
          if (!preClaimedRequest.nxResult.ok) throw preClaimedRequest.nxResult.error;
          nxClaimed = preClaimedRequest.nxResult.value;
        } else {
          const id = req.get('Idempotency-Key');
          if (!id || !/^[A-Za-z0-9_-]{16,100}$/.test(id)) throw fail('IDEMPOTENCY_KEY_REQUIRED', 400);
          const bodyId = typeof req.body?.idempotencyKey === 'string' ? req.body.idempotencyKey.trim() : '';
          if (bodyId && bodyId !== id) throw fail('IDEMPOTENCY_CONFLICT', 409);
          requestKey = `security:request:${createHash('sha256').update(`${req.ownerId}:${canonicalRequestRoute(reqPath)}:${id}`).digest('hex')}`;
          fingerprint = requestFingerprint(req.body);
          candidate = JSON.stringify({ state: 'reserved', fingerprint, token });
          nxClaimed = await this.redis.set(requestKey, candidate, { NX: true, EX: 900 });
        }
        if (nxClaimed) requestRecord = candidate;
        else {
          previousRequest = preClaimedRequest?.existingValue ?? await this.redis.get(requestKey);
          const existing = JSON.parse(previousRequest || 'null');
          if (!existing || existing.fingerprint !== fingerprint) { requestKey = null; throw fail('IDEMPOTENCY_CONFLICT', 409); }
          if (existing.state === 'completed' && existing.result) { requestKey = null; return this.sendReplay(req, res, existing.result); }
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
        const actor = req.ownerId, ip = this.ipKey(req);
        if (preAdmittedSharedAsk) {
          sharedAskLease = preAdmittedSharedAsk.sharedAskLease;
        } else {
          const pendingOwnerRelease = this.releasingOwnerLocks.get(actor);
          if (pendingOwnerRelease && !req.aborted && !res.destroyed) {
            await Promise.race([pendingOwnerRelease, new Promise((resolve) => setTimeout(resolve, 300))]);
          }
          if (sharedAsk) {
            const [rateResult, leaseResult] = await Promise.allSettled([
              reserveAskRate(this.redis, actor, ip, token),
              acquireSharedAskLease(this.redis, actor, token),
            ]);
            if (leaseResult.status === 'fulfilled') sharedAskLease = leaseResult.value;
            if (rateResult.status === 'rejected') throw rateResult.reason;
            if (rateResult.value > 0) {
              res.setHeader('Retry-After', String(rateResult.value));
              throw fail('RATE_LIMITED', 429);
            }
            if (leaseResult.status === 'rejected') throw leaseResult.reason;
            if (!sharedAskLease && !req.aborted && !res.destroyed) {
              await new Promise((resolve) => setTimeout(resolve, 150));
              if (!req.aborted && !res.destroyed) {
                sharedAskLease = await acquireSharedAskLease(this.redis, actor, token);
              }
            }
            if (!sharedAskLease) throw fail('EXECUTION_BUSY', 429);
          } else if (guest) {
            const spec = this._guestMinuteRateSpec(req);
            const retryAfter = await reserveMinuteRate(this.redis, spec.keys, spec.limits, token);
            if (retryAfter > 0) {
              res.setHeader('Retry-After', String(retryAfter));
              throw fail('RATE_LIMITED', 429);
            }
            req.remainingGuestMessages = null;
            req.remainingGuestBriefs = null;
          } else {
            const keys = [`security:rate:${actor}`, `security:rate-ip:${ip}`];
            const allowed = await this.redis.eval("for _,k in ipairs(KEYS) do if tonumber(redis.call('get',k) or '0') >= tonumber(ARGV[1]) then return 0 end end; for _,k in ipairs(KEYS) do local n = redis.call('incr',k); if n == 1 then redis.call('expire',k,600) end end; return 1", { keys, arguments: ['60'] });
            if (!allowed) throw fail('RATE_LIMITED', 429);
          }
          if (!sharedAsk) {
            lock = `security:owner-execution:${actor}`;
            let locked = await this.redis.set(lock, token, { NX: true, PX: 180000 });
            if (!locked && !req.aborted && !res.destroyed) {
              await new Promise((resolve) => setTimeout(resolve, 150));
              if (!req.aborted && !res.destroyed) {
                locked = await this.redis.set(lock, token, { NX: true, PX: 180000 });
              }
            }
            if (!locked) { lock = null; throw fail('EXECUTION_BUSY', 429); }
          }
        }
        if (previousRequest) {
          const candidate = JSON.stringify({ state: 'reserved', fingerprint, token });
          const claimed = await this.redis.eval("if redis.call('get',KEYS[1]) ~= ARGV[1] then return 0 end; redis.call('set',KEYS[1],ARGV[2],'EX',900); return 1", { keys: [requestKey], arguments: [previousRequest, candidate] });
          if (!claimed) throw fail('REQUEST_ALREADY_SUBMITTED', 409);
          requestRecord = candidate;
        }
        controller = new AbortController();
        let lastLeaseOkAt = Date.now();
        let inFlightLeaseCheck = null;
        req.securityContext.assertLease = async ({ maxStaleMs = 0 } = {}) => {
          const now = Date.now();
          const checkOwned = () => sharedAskLease
            ? sharedAskLease.isOwned()
            : (this.redis.isReady ? Promise.resolve(this.redis.get(lock)).then(v => v === token) : Promise.resolve(false));
          if (maxStaleMs > 0 && lastLeaseOkAt && (now - lastLeaseOkAt < maxStaleMs)) {
            if (now - lastLeaseOkAt >= 250 && !inFlightLeaseCheck) {
              inFlightLeaseCheck = checkOwned()
                .then(owned => {
                  lastLeaseOkAt = owned ? Date.now() : 0;
                  return owned;
                })
                .catch(() => {
                  lastLeaseOkAt = 0;
                  return false;
                })
                .finally(() => { inFlightLeaseCheck = null; });
            }
            return;
          }
          if (!inFlightLeaseCheck) {
            inFlightLeaseCheck = checkOwned()
              .then(owned => {
                lastLeaseOkAt = owned ? Date.now() : 0;
                return owned;
              }, err => {
                lastLeaseOkAt = 0;
                throw err;
              })
              .finally(() => { inFlightLeaseCheck = null; });
          }
          const owned = await inFlightLeaseCheck;
          if (!owned) throw fail('EXECUTION_LOCK_LOST');
        };
        req.securityContext.route = reqPath;
        req.securityContext.controller = controller; req.securityContext.signal = controller.signal;
        const renewal = setInterval(async () => {
          try {
            const ok = sharedAskLease ? await sharedAskLease.renew() : await this.redis.eval("if redis.call('get',KEYS[1]) ~= ARGV[1] then return 0 end; return redis.call('pexpire',KEYS[1],180000)", { keys: [lock], arguments: [token] });
            if (!ok) controller.abort(fail('EXECUTION_LOCK_LOST'));
          } catch { controller.abort(fail('EXECUTION_UNAVAILABLE')); }
        }, 30000); renewal.unref();
        const requestTimeout = aiRequestTimeoutMs(req);
        if (requestTimeout !== null) {
          timer = setTimeout(() => { clearInterval(renewal); controller.abort(fail('EXECUTION_TIMEOUT')); endTimedOutRequest(); }, requestTimeout);
          timer.unref?.();
        }
        let askBackgroundActive = false;
        req.securityContext.enableAskBackgroundCompletion = (timeoutMs = null) => {
          askBackgroundActive = true;
          if (timeoutMs && Number.isFinite(Number(timeoutMs))) {
            clearTimeout(timer);
            timer = setTimeout(() => { clearInterval(renewal); controller.abort(fail('EXECUTION_TIMEOUT')); endTimedOutRequest(); }, Number(timeoutMs));
            timer.unref?.();
          }
          return async () => {
            askBackgroundActive = false;
            clearInterval(renewal);
            await finish();
          };
        };
        req.securityContext.transferToBackground = () => {
          req.securityContext.isBackgroundJob = true;
          clearTimeout(timer);
          timer = setTimeout(() => controller.abort(fail('EXECUTION_TIMEOUT')), 10 * 60 * 1000);
          timer.unref();
          return { signal: controller.signal, assertOwned: req.securityContext.assertLease, release: async () => { clearInterval(renewal); await finish(); } };
        };
        const finishRequest = () => {
          if (!req.securityContext.isBackgroundJob && !askBackgroundActive) { clearInterval(renewal); void finish(); }
        };
        res.once('finish', finishRequest);
        res.once('close', finishRequest);
        if (req.aborted || res.destroyed || res.writableEnded) return finishRequest();
        handlerEntered = true;
        next();
      } catch (error) {
        await finish();
        if (error.code === 'RATE_LIMITED') {
          return res.status(429).json({ code: 'RATE_LIMITED', error: this._rateLimitErrorMessage(req) });
        }
        res.status(error.status || 503).json({ code: error.code || 'EXECUTION_UNAVAILABLE', error: 'Sorğu başlana bilmədi.' });
      }
    };
  }
  async reserveProvider(context, params, reservation = {}) {
    if (!reservation?.[CONCURRENT_PAUSE_CHECK_SYMBOL]) await this.assertEnabled();
    this.ready();
    const modelKey = params?.model || 'default';
    const price = resolveEffectiveModelPricing(modelKey, this.env);
    if (!price) throw fail('MODEL_PRICING_UNAVAILABLE');
    const tools = params?.tools || params?.config?.tools || [];
    const searching = tools.some(tool => tool.googleSearch || /web_search/.test(tool.type || ''));
    const searchPrice = price.search;
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
    const guestIpLimit = Number(this.env.AI_GUEST_IP_DAILY_USD || userLimit);
    if (!(Number.isFinite(userLimit) && Number.isFinite(globalLimit) && Number.isFinite(guestIpLimit) && userLimit > 0 && globalLimit > 0 && guestIpLimit > 0)) throw fail('BUDGET_CONFIGURATION_INVALID');
    const isGuestOwner = Boolean(context?.isGuest || context?.guest || /^guest_/.test(String(context?.ownerId || '')));
    const ipBudgetKey = isGuestOwner && context?.ipKey ? `security:budget:${day}:guest-ip:${context.ipKey}` : null;
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
      const ipCur = ipBudgetKey ? (this.inMemoryBudgets.get(ipBudgetKey) || 0) : 0;
      if (userCur + micros > Math.floor(userLimit * 1000000) || globalCur + micros > Math.floor(globalLimit * 1000000) || (ipBudgetKey && ipCur + micros > Math.floor(guestIpLimit * 1000000))) {
        throw fail('DAILY_BUDGET_EXCEEDED', 429);
      }
      const budgetKeys = ipBudgetKey ? [...keys, ipBudgetKey] : keys;
      this.inMemoryBudgets.set(keys[0], userCur + micros);
      this.inMemoryBudgets.set(keys[1], globalCur + micros);
      if (ipBudgetKey) this.inMemoryBudgets.set(ipBudgetKey, ipCur + micros);
      this.inMemorySlots.set(token, now + 180000);
      let recorded = false, released = false;
      const release = async ({ retainReservation = false } = {}) => {
        if (released) return;
        released = true;
        this.inMemorySlots.delete(token);
        if (!recorded && !retainReservation) await release.refund();
      };
      release.recordUsage = async usage => {
        if (recorded) return;
        recorded = true;
        const observedMicros = Math.ceil(usage.inputTokens * price.input + usage.outputTokens * price.output + (usage.searchUsageKnown === false ? Math.max(searchCalls, usage.searchCalls) : usage.searchCalls) * searchPrice * 1000000);
        const delta = observedMicros - micros;
        const floor = Math.max(0, observedMicros);
        for (const key of budgetKeys) {
          const cur = this.inMemoryBudgets.get(key) ?? 0;
          this.inMemoryBudgets.set(key, Math.max(floor, cur + delta));
        }
      };
      release.refund = async () => {
        if (recorded) return;
        recorded = true;
        for (const key of budgetKeys) {
          const cur = this.inMemoryBudgets.get(key) ?? 0;
          this.inMemoryBudgets.set(key, Math.max(0, cur - micros));
        }
      };
      return release;
    }
    let guestIpReserved = false;
    if (ipBudgetKey) {
      const guestIpOk = await this.redis.eval(
        "if tonumber(redis.call('get',KEYS[1]) or '0') + tonumber(ARGV[1]) > tonumber(ARGV[2]) then return 0 end; redis.call('incrby',KEYS[1],ARGV[1]); redis.call('expire',KEYS[1],172800); return 1",
        { keys: [ipBudgetKey], arguments: [String(micros), String(Math.floor(guestIpLimit * 1000000))] }
      );
      if (guestIpOk !== 1) throw fail('DAILY_BUDGET_EXCEEDED', 429);
      guestIpReserved = true;
    }
    let accepted;
    try {
      accepted = await this.redis.eval(`redis.call('zremrangebyscore',KEYS[3],'-inf',ARGV[4]); if redis.call('zcard',KEYS[3]) >= ${maxSlots} then return -1 end; if tonumber(redis.call('get',KEYS[1]) or '0') + tonumber(ARGV[1]) > tonumber(ARGV[2]) or tonumber(redis.call('get',KEYS[2]) or '0') + tonumber(ARGV[1]) > tonumber(ARGV[3]) then return 0 end; for i=1,2 do redis.call('incrby',KEYS[i],ARGV[1]); redis.call('expire',KEYS[i],172800) end; redis.call('zadd',KEYS[3],ARGV[5],ARGV[6]); return 1`, { keys: [...keys, 'security:provider-slots'], arguments: [String(micros), String(Math.floor(userLimit * 1000000)), String(Math.floor(globalLimit * 1000000)), String(now), String(now + 180000), token] });
    } catch (err) {
      if (guestIpReserved) {
        await this.redis.eval(
          "local cur = tonumber(redis.call('get',KEYS[1]) or '0'); local next = math.max(0, cur - tonumber(ARGV[1])); redis.call('set',KEYS[1],tostring(next),'EX',172800); return 1",
          { keys: [ipBudgetKey], arguments: [String(micros)] }
        ).catch(() => {});
      }
      throw err;
    }
    if (accepted !== 1) {
      if (guestIpReserved) {
        await this.redis.eval(
          "local cur = tonumber(redis.call('get',KEYS[1]) or '0'); local next = math.max(0, cur - tonumber(ARGV[1])); redis.call('set',KEYS[1],tostring(next),'EX',172800); return 1",
          { keys: [ipBudgetKey], arguments: [String(micros)] }
        ).catch(() => {});
      }
      throw fail(accepted === -1 ? 'EXECUTION_BUSY' : 'DAILY_BUDGET_EXCEEDED', 429);
    }
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
      if (ipBudgetKey) {
        await this.redis.eval(
          "if redis.call('exists',KEYS[2]) == 1 then return 0 end; redis.call('set',KEYS[2],1,'EX',172800); local cur = tonumber(redis.call('get',KEYS[1])); local delta = tonumber(ARGV[1]) or 0; local floor = math.max(0, tonumber(ARGV[2]) or 0); local next = cur and math.max(floor, cur + delta) or floor; redis.call('set',KEYS[1],tostring(next),'EX',172800); return 1",
          { keys: [ipBudgetKey, `security:usage-record:${token}:guest-ip`], arguments: [String(observedMicros - micros), String(Math.max(0, observedMicros))] }
        );
      }
    };
    release.refund = async () => {
      if (recorded) return;
      await release.recordUsage({ inputTokens: 0, outputTokens: 0, searchCalls: 0, searchUsageKnown: true });
    };
    return release;
  }
  _guestMinuteRateSpec(req) {
    const actor = req.ownerId || 'guest_unknown';
    const ip = this.ipKey(req);
    const reqPath = normalizeRequestPath(req.path);
    const isBuild = /^\/api\/strategy\/(?:estimate|assess|generate|generate-stream)\/?$/i.test(reqPath);
    if (isBuild) {
      return {
        isBuild: true,
        keys: [`security:guest-build-minute:${actor}`, `security:guest-build-minute-ip:${ip}`],
        limits: [guestBuildPerMinuteLimit(this.env), guestBuildIpPerMinuteLimit(this.env)],
      };
    }
    return {
      isBuild: false,
      keys: [`security:guest-ask-minute:${actor}`, `security:guest-ask-minute-ip:${ip}`],
      limits: [guestAskPerMinuteLimit(this.env), guestAskIpPerMinuteLimit(this.env)],
    };
  }
  _rateLimitErrorMessage(req) {
    const reqPath = normalizeRequestPath(req.path);
    if (/^\/api\/strategy\/(?:estimate|assess|generate|generate-stream)\/?$/i.test(reqPath)) {
      return 'Build üçün dəqiqəlik sorğu limiti dolub. Bir qədər sonra yenidən cəhd edin.';
    }
    if (/^\/api\/ask\/?$/i.test(reqPath)) {
      return 'Ask üçün dəqiqəlik sorğu limiti dolub. Bir qədər sonra yenidən cəhd edin.';
    }
    return 'Sorğu limiti dolub. Bir qədər sonra yenidən cəhd edin.';
  }
  _reserveLocalMinuteRate(keys, limits, windowMs = ASK_RATE_WINDOW_MS) {
    if (!this.inMemoryMinuteRates) this.inMemoryMinuteRates = new Map();
    const now = Date.now();
    const cutoff = now - windowMs;
    let retryMs = 0;
    const activeBuckets = keys.map((key, index) => {
      const recent = (this.inMemoryMinuteRates.get(key) || []).filter(ts => ts > cutoff);
      if (recent.length > 0) this.inMemoryMinuteRates.set(key, recent);
      else this.inMemoryMinuteRates.delete(key);
      if (recent.length >= limits[index]) {
        retryMs = Math.max(retryMs, recent[0] + windowMs - now);
      }
      return recent;
    });
    if (retryMs > 0) return Math.ceil(retryMs / 1000);
    keys.forEach((key, index) => {
      this.inMemoryMinuteRates.set(key, [...activeBuckets[index], now]);
    });
    if (this.inMemoryMinuteRates.size > 10000) {
      for (const [k, list] of this.inMemoryMinuteRates) {
        if (!list.length || list.at(-1) <= cutoff) this.inMemoryMinuteRates.delete(k);
      }
    }
    return 0;
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
    if (!isGuest) {
      return {
        isGuest: false,
        limit: null,
        used: 0,
        remaining: null,
        buildLimit: null,
        buildUsed: 0,
        buildRemaining: null,
        askPerMinuteLimit: null,
        buildPerMinuteLimit: null,
      };
    }
    this.ready();
    return {
      isGuest: true,
      limit: null,
      used: 0,
      remaining: null,
      buildLimit: null,
      buildUsed: 0,
      buildRemaining: null,
      askPerMinuteLimit: guestAskPerMinuteLimit(this.env),
      buildPerMinuteLimit: guestBuildPerMinuteLimit(this.env),
    };
  }
}
