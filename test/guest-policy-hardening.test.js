import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import express from 'express';
import { ASK_REQUESTS_PER_MINUTE, AiPolicy } from '../src/services/security/ai-policy.js';
import {
  guestAskPerMinuteLimit,
  guestAskIpPerMinuteLimit,
  guestBuildPerMinuteLimit,
  guestBuildIpPerMinuteLimit,
  validateSecurityConfig,
} from '../src/services/security/config.js';
import { GUEST_RESTRICTION_NOTICES } from '../src/services/ai/prompts.js';
import { createAskExecutionGuard } from '../src/http/ask-execution-guard.js';
import { createCapabilityRouter } from '../src/http/capability-router.js';
import { createPlannerRouter } from '../src/http/planner-router.js';
import { createStrategyRouter } from '../src/http/strategy-router.js';

async function fixture(t, { redis = null, env = {}, storedChat = null } = {}) {
  const policy = new AiPolicy({
    redis,
    env: { GUEST_ASK_RATE_LIMIT_PER_MINUTE: '10', GUEST_BUILD_RATE_LIMIT_PER_MINUTE: '8', ...env },
  });
  const app = express();
  let providers = 0, storageCalls = 0;
  const blockedStorage = new Proxy({}, {
    get() {
      return () => {
        storageCalls++;
        throw new Error('Guest must not reach storage');
      };
    },
  });
  app.use(express.json());
  app.use((req, res, next) => {
    req.ownerId = `guest_${req.get('X-Test-Owner') || 'fixture'}`;
    req.securityContext = { providerStarted: false };
    next();
  });
  app.get('/api/auth/guest-status', policy.guestQuotaHandler());
  app.use(policy.middleware());
  app.use('/api/planner', createPlannerRouter(blockedStorage));
  app.use('/api/strategy', createStrategyRouter(blockedStorage));
  app.use('/api/ask', createAskExecutionGuard({ allowGuest: true }), createCapabilityRouter({
    allowGuestChat: true,
    registry: { get() {}, reference() {}, resolve() { return []; } },
    chats: { async getById() { return storedChat; } },
    artifacts: blockedStorage, strategies: blockedStorage, planner: blockedStorage,
  }));
  // Deterministic provider stand-in after the same policy, guard, and strict Ask router as production.
  app.post('/api/ask', (req, res) => {
    if (req.body.messages.at(-1).content === 'reject-before-provider') {
      return res.status(400).json({ code: 'REJECTED' });
    }
    req.securityContext.providerStarted = true;
    providers++;
    const reply = 'Tam cavab.';
    const payload = { done: true, reply, remainingGuestMessages: null };
    if (req.body.stream) {
      res.type('text/event-stream');
      res.write(`data: ${JSON.stringify({ chunk: reply })}\n\n`);
      return res.end(`data: ${JSON.stringify(payload)}\n\n`);
    }
    res.json(payload);
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  const ask = (body = {}, owner = 'fixture') => fetch(`${base}/api/ask`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID(), 'X-Test-Owner': owner },
    body: JSON.stringify({ messages: [{ role: 'user', content: 'Salam' }], ...body }),
  });
  return { policy, base, ask, providers: () => providers, storageCalls: () => storageCalls };
}

test('guest HTTP: more than 5 answers succeed without daily limit or CTA, and per-minute security limit blocks excess', async t => {
  const f = await fixture(t, { env: { GUEST_ASK_RATE_LIMIT_PER_MINUTE: '7', GUEST_ASK_IP_RATE_LIMIT_PER_MINUTE: '14' } });
  for (let i = 1; i <= 7; i++) {
    const stream = i % 2 === 1;
    const response = await f.ask({ stream });
    assert.equal(response.status, 200);
    const text = await response.text();
    const events = stream ? text.trim().split('\n\n').map(line => JSON.parse(line.slice(6))) : null;
    const data = stream ? events.at(-1) : JSON.parse(text);
    assert.equal(data.remainingGuestMessages, null);
    assert.equal(data.reply, 'Tam cavab.');
    assert.ok(!data.reply.includes('Qeyd: Qonaq rejimində'));
    assert.ok(!data.reply.includes('Diqqət: Cəmi'));
  }
  const rateLimited = await f.ask();
  assert.equal(rateLimited.status, 429);
  assert.ok(Number(rateLimited.headers.get('retry-after')) >= 1);
  assert.equal((await rateLimited.json()).code, 'RATE_LIMITED');
  assert.equal(f.providers(), 7);
  const quota = await (await fetch(`${f.base}/api/auth/guest-status`)).json();
  assert.equal(quota.isGuest, true);
  assert.equal(quota.limit, 5);
  assert.equal(quota.remaining, 5);
  assert.equal(quota.askPerMinuteLimit, 7);
});

test('guest HTTP: direct Planner, saved strategy, UP, research, user, and artifacts routes stop before storage', async t => {
  const f = await fixture(t);
  for (const [path, method, feature] of [
    ['/api/planner', 'GET', 'planner'], ['/api/planner', 'POST', 'planner'],
    ['/api/planner/batch', 'POST', 'planner'], ['/api/planner/completed', 'DELETE', 'planner'],
    ['/api/planner/summarize', 'POST', 'planner'], ['/api/planner/prioritize', 'POST', 'planner'],
    [`/api/planner/${randomUUID()}`, 'PATCH', 'planner'], [`/api/planner/${randomUUID()}`, 'DELETE', 'planner'],
    ['/api/strategy', 'GET', 'strategy'], ['/api/strategy/save', 'POST', 'strategy'],
    [`/api/strategy/${randomUUID()}`, 'GET', 'strategy'], [`/api/strategy/${randomUUID()}`, 'PATCH', 'strategy'],
    [`/api/strategy/${randomUUID()}`, 'DELETE', 'strategy'], ['/api/strategy/refine', 'POST', 'strategy'],
  ]) {
    const response = await fetch(f.base + path, { method });
    assert.equal(response.status, 401, `${method} ${path}`);
    assert.equal((await response.json()).error, GUEST_RESTRICTION_NOTICES[feature]);
  }
  for (const [path, method] of [
    ['/api/up/challenges', 'GET'],
    ['/api/user/memory', 'GET'],
    ['/api/artifacts', 'POST'],
    ['/api/ask/research', 'POST'],
  ]) {
    const response = await fetch(f.base + path, { method });
    assert.equal(response.status, 401, `${method} ${path}`);
    assert.equal((await response.json()).code, 'AUTH_REQUIRED');
  }
  assert.equal(f.storageCalls(), 0);
});

test('guest HTTP: explicit and automatic Thinking, files and context are rejected without calling provider or spending rate quota', async t => {
  const f = await fixture(t, { env: { GUEST_ASK_RATE_LIMIT_PER_MINUTE: '2', GUEST_ASK_IP_RATE_LIMIT_PER_MINUTE: '4' } });
  for (const [body, feature] of [
    [{ thinkingLevel: 'high' }, 'thinking'], [{ thinkingLevel: 'medium' }, 'thinking'],
    [{ messages: [{ role: 'user', content: 'SWOT analizi' }] }, 'thinking'],
    [{ messages: [{ role: 'user', content: 'unit economics' }] }, 'thinking'],
    [{ messages: [{ role: 'user', content: 'Salam', file: { name: 'note.txt', size: 1, type: 'text/plain', textContent: 'x' } }] }, 'file'],
    [{ strategyId: randomUUID() }, 'strategy'], [{ taskId: randomUUID() }, 'planner'],
  ]) {
    const response = await f.ask(body);
    assert.equal(response.status, 401);
    assert.equal((await response.json()).reply, GUEST_RESTRICTION_NOTICES[feature]);
  }
  assert.equal(f.providers(), 0);
  // Both allowed Ask requests must still succeed since blocked features did not burn rate quota
  assert.equal((await f.ask({})).status, 200);
  assert.equal((await f.ask({})).status, 200);
  assert.equal(f.providers(), 2);
});

test('guest HTTP: legacy chat context is blocked without querying strategy or artifact storage', async t => {
  const id = randomUUID();
  const f = await fixture(t, { storedChat: { id, strategyId: randomUUID(), messages: [], revision: 1 } });
  const response = await f.ask({ chatId: id });
  assert.equal(response.status, 401);
  assert.equal((await response.json()).reply, GUEST_RESTRICTION_NOTICES.strategy);
  assert.equal(f.providers(), 0);
  assert.equal(f.storageCalls(), 0);
});

test('guest HTTP: changing the guest cookie cannot evade the IP per-minute rate limit', async t => {
  const f = await fixture(t, { env: { GUEST_ASK_RATE_LIMIT_PER_MINUTE: '5', GUEST_ASK_IP_RATE_LIMIT_PER_MINUTE: '2' } });
  assert.equal((await f.ask({}, 'first-cookie')).status, 200);
  assert.equal((await f.ask({}, 'second-cookie')).status, 200);
  const blocked = await f.ask({}, 'third-cookie');
  assert.equal(blocked.status, 429);
  assert.ok(Number(blocked.headers.get('retry-after')) >= 1);
  assert.equal((await blocked.json()).code, 'RATE_LIMITED');
  assert.equal(f.providers(), 2);
});

test('guest HTTP: finish plus close aborts request signal cleanly', async t => {
  const policy = new AiPolicy({ redis: null, env: { GUEST_ASK_RATE_LIMIT_PER_MINUTE: '3' } });
  const req = { method: 'POST', path: '/api/ask', ownerId: 'guest_signal_test', ip: '127.0.0.1', body: {}, securityContext: {}, get: () => 'guest-signal-fixture-key' };
  const res = new EventEmitter();
  res.json = () => {};
  await policy.middleware()(req, res, () => {});
  res.emit('finish'); res.emit('close');
  assert.equal(req.securityContext.signal.aborted, true);
});

test('guest quota HTTP: Redis outage is sanitized and fails closed without inventing status', async t => {
  const f = await fixture(t, { redis: { isReady: false } });
  const response = await fetch(`${f.base}/api/auth/guest-status`);
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const data = await response.json();
  assert.equal(data.code, 'EXECUTION_UNAVAILABLE');
  assert.equal(data.askPerMinuteLimit, undefined);
});

test('production requires Redis at startup when configured, quota reads, admission and provider reservation', async () => {
  assert.throws(() => validateSecurityConfig({ NODE_ENV: 'production', REQUIRE_REDIS: 'true', SESSION_SECRET: 'fixture', AUTH_SECRET: 'fixture', APP_URL: 'https://example.com' }), /REDIS_URL/);
  const policy = new AiPolicy({ redis: null, env: { NODE_ENV: 'production', REQUIRE_REDIS: 'true' } });
  await assert.rejects(policy.getGuestQuota({ ownerId: 'guest_test' }), { code: 'EXECUTION_UNAVAILABLE' });
  await assert.rejects(policy.reserveProvider({}, {}), { code: 'EXECUTION_UNAVAILABLE' });
  let status;
  await policy.middleware()({ method: 'POST', path: '/api/ask', body: {}, securityContext: {} }, { status(value) { status = value; return this; }, json() {} }, () => assert.fail('Production must fail closed'));
  assert.equal(status, 503);
});

test('guest per-minute limit configuration rejects zero, negative, non-integer, unsafe values and stays stricter than registered users', () => {
  for (const value of ['0', '-1', '3abc', '3.5', 'NaN', 'Infinity', '', '9007199254740992']) {
    assert.throws(() => guestAskPerMinuteLimit({ GUEST_ASK_RATE_LIMIT_PER_MINUTE: value }));
    assert.throws(() => guestAskIpPerMinuteLimit({ GUEST_ASK_IP_RATE_LIMIT_PER_MINUTE: value }));
    assert.throws(() => guestBuildPerMinuteLimit({ GUEST_BUILD_RATE_LIMIT_PER_MINUTE: value }));
    assert.throws(() => guestBuildIpPerMinuteLimit({ GUEST_BUILD_IP_RATE_LIMIT_PER_MINUTE: value }));
  }
  assert.equal(guestAskPerMinuteLimit({}), 10);
  assert.equal(guestAskIpPerMinuteLimit({}), 20);
  assert.equal(guestBuildPerMinuteLimit({}), 8);
  assert.equal(guestBuildIpPerMinuteLimit({}), 16);
  assert.ok(guestAskPerMinuteLimit({}) < ASK_REQUESTS_PER_MINUTE);
  assert.equal(guestAskPerMinuteLimit({ GUEST_ASK_RATE_LIMIT_PER_MINUTE: '6' }), 6);
  assert.equal(guestAskIpPerMinuteLimit({ GUEST_ASK_RATE_LIMIT_PER_MINUTE: '6' }), 20);
  assert.equal(guestAskIpPerMinuteLimit({ GUEST_ASK_IP_RATE_LIMIT_PER_MINUTE: '12' }), 12);
});

test('guest HTTP: malformed Thinking values return sanitized validation errors', async t => {
  const f = await fixture(t);
  for (const thinkingLevel of [{ toString: null }, [], null, 1, 'invalid']) {
    const response = await f.ask({ thinkingLevel });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).code, 'VALIDATION_ERROR');
  }
  assert.equal(f.providers(), 0);
});

// Deterministic Redis command adapter matching Redis Lua atomicity for request locks, execution leases, and sorted-set minute rate limits.
class QuotaRedis {
  isReady = true;
  values = new Map();
  zsets = new Map();
  async get(key) { return this.values.get(key) || null; }
  async set(key, value, options = {}) {
    if (options.NX && this.values.has(key)) return null;
    this.values.set(key, value);
    return 'OK';
  }
  async eval(script, { keys, arguments: args = [] }) {
    if (script.includes("redis.call('set',KEYS[1],ARGV[2]")) {
      if (this.values.get(keys[0]) !== args[0]) return 0;
      this.values.set(keys[0], args[1]); return 1;
    }
    if (script.includes("redis.call('zremrangebyscore'")) {
      const now = Date.now();
      const windowMs = Number(args[1]);
      let retry = 0;
      keys.forEach((key, idx) => {
        const limit = Number(args[idx + 2]);
        const entries = (this.zsets.get(key) || []).filter(entry => entry.score > now - windowMs);
        this.zsets.set(key, entries);
        if (entries.length >= limit) {
          retry = Math.max(retry, entries[0].score + windowMs - now);
        }
      });
      if (retry > 0) return Math.ceil(retry / 1000);
      for (const key of keys) {
        const entries = this.zsets.get(key) || [];
        entries.push({ member: args[0], score: now });
        this.zsets.set(key, entries);
      }
      return 0;
    }
    if (script.includes("redis.call('del', KEYS[1])")) {
      if (this.values.get(keys[0]) !== args[0]) return 0;
      this.values.delete(keys[0]); return 1;
    }
    if (script.includes("redis.call('pexpire'")) return this.values.get(keys[0]) === args[0] ? 1 : 0;
    throw new Error('Unexpected Redis script');
  }
}

test('production Redis HTTP: guest can send >5 requests without daily exhaustion, per-minute sliding window blocks excess and releases leases', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-11-18T12:00:00Z') });
  const redis = new QuotaRedis();
  const f = await fixture(t, {
    redis,
    env: { NODE_ENV: 'production', GUEST_ASK_RATE_LIMIT_PER_MINUTE: '6', GUEST_ASK_IP_RATE_LIMIT_PER_MINUTE: '12' },
  });
  for (let i = 0; i < 6; i++) {
    const response = await f.ask({ stream: i === 5 });
    assert.equal(response.status, 200);
    await response.text();
    await new Promise(resolve => setImmediate(resolve));
  }
  const blocked = await f.ask();
  assert.equal(blocked.status, 429);
  assert.ok(Number(blocked.headers.get('retry-after')) >= 1);
  assert.equal((await blocked.json()).code, 'RATE_LIMITED');
  assert.equal(f.providers(), 6);
  assert.equal([...redis.values.keys()].filter(key => key.startsWith('security:owner-execution:')).length, 0);

  // Sliding window resets after 61 seconds
  t.mock.timers.tick(61000);
  const recovered = await f.ask();
  assert.equal(recovered.status, 200);
  assert.equal(f.providers(), 7);
});

test('production Redis: concurrent owner rejection and duplicate idempotency work without legacy daily counter', async () => {
  const redis = new QuotaRedis();
  const policy = new AiPolicy({ redis, env: { NODE_ENV: 'production', GUEST_ASK_RATE_LIMIT_PER_MINUTE: '5' } });
  const request = key => ({ method: 'POST', path: '/api/ask', ownerId: 'guest_same', ip: '127.0.0.1', body: {}, securityContext: {}, get: () => key });
  const response = () => Object.assign(new EventEmitter(), {
    setHeader() {},
    status(value) { this.statusCode = value; return this; },
    json(value) { this.body = value; },
  });
  const first = request('first-idempotency-key');
  const firstRes = response();
  await policy.middleware()(first, firstRes, () => {});
  const secondRes = response();
  await policy.middleware()(request('second-idempotency-key'), secondRes, () => assert.fail('Concurrent owner must be blocked'));
  assert.equal(secondRes.body.code, 'EXECUTION_BUSY');
  const duplicate = response();
  await policy.middleware()(request('first-idempotency-key'), duplicate, () => assert.fail('Duplicate must be blocked'));
  assert.equal(duplicate.body.code, 'REQUEST_ALREADY_SUBMITTED');
  firstRes.emit('finish'); firstRes.emit('close');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(first.securityContext.signal.aborted, true);
});
