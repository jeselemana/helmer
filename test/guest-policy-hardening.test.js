import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { AiPolicy, guestMessageBalance } from '../src/services/security/ai-policy.js';
import { guestDailyLimit, validateSecurityConfig } from '../src/services/security/config.js';
import { GUEST_RESTRICTION_NOTICES, GUEST_EXHAUSTED_MESSAGE, formatGuestAnswerWithCta, getGuestCtaNotice, createGuestAnswerStream } from '../src/services/ai/prompts.js';
import { createAskExecutionGuard } from '../src/http/ask-execution-guard.js';
import { createCapabilityRouter } from '../src/http/capability-router.js';
import { createPlannerRouter } from '../src/http/planner-router.js';
import { createStrategyRouter } from '../src/http/strategy-router.js';

async function fixture(t, { redis = null, env = {}, storedChat = null } = {}) {
  const policy = new AiPolicy({ redis, env: { GUEST_AI_DAILY_LIMIT: '5', ...env } });
  const app = express();
  let providers = 0, storageCalls = 0;
  const blockedStorage = new Proxy({}, { get() { return () => { storageCalls++; throw new Error('Guest must not reach storage'); }; } });
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
  // Deterministic provider stand-in, after the same policy, guard and strict Ask router as production.
  app.post('/api/ask', (req, res) => {
    const balance = guestMessageBalance(req);
    if (req.body.messages.at(-1).content === 'reject-before-provider') return res.status(400).json({ code: 'REJECTED' });
    req.securityContext.providerStarted = true;
    providers++;
    const reply = formatGuestAnswerWithCta('Tam cavab.', balance.available);
    const payload = { done: true, reply, remainingGuestMessages: balance.remaining };
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
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID(), 'X-Test-Owner': owner },
    body: JSON.stringify({ messages: [{ role: 'user', content: 'Salam' }], ...body }),
  });
  return { policy, base, ask, providers: () => providers, storageCalls: () => storageCalls };
}

test('guest HTTP: all five reservations produce full answers, including SSE; sixth is blocked', async t => {
  const f = await fixture(t);
  for (let available = 5; available >= 1; available--) {
    const stream = available % 2 === 1;
    const response = await f.ask({ stream });
    assert.equal(response.status, 200);
    const text = await response.text();
    const events = stream ? text.trim().split('\n\n').map(line => JSON.parse(line.slice(6))) : null;
    const data = stream ? events.at(-1) : JSON.parse(text);
    assert.equal(data.remainingGuestMessages, available - 1);
    assert.equal(data.reply, formatGuestAnswerWithCta('Tam cavab.', available));
    assert.ok(data.reply.includes('Tam cavab.'));
    assert.equal(data.reply.split(getGuestCtaNotice(available)).length, 2);
    if (stream) assert.equal(events.filter(event => event.chunk).map(event => event.chunk).join(''), data.reply);
  }
  const exhausted = await f.ask();
  assert.equal(exhausted.status, 429);
  assert.equal((await exhausted.json()).reply, GUEST_EXHAUSTED_MESSAGE);
  assert.equal(f.providers(), 5);
  const quota = await (await fetch(`${f.base}/api/auth/guest-status`)).json();
  assert.equal(quota.remaining, 0);
});

test('guest HTTP: direct Planner and saved strategy routes stop before storage and quota', async t => {
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
  assert.equal(f.storageCalls(), 0);
  assert.equal((await f.policy.getGuestQuota({ ownerId: 'guest_fixture', ip: '127.0.0.1' })).used, 0);
});

test('guest HTTP: explicit and automatic Thinking, files and context are rejected without spending quota', async t => {
  const f = await fixture(t);
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
  assert.equal((await f.policy.getGuestQuota({ ownerId: 'guest_fixture', ip: '127.0.0.1' })).remaining, 5);
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

test('guest HTTP: validation and pre-provider failures refund both owner and IP reservations', async t => {
  const f = await fixture(t);
  assert.equal((await f.ask({ unknown: 'forbidden' })).status, 400);
  assert.equal((await f.ask({ messages: [{ role: 'user', content: 'reject-before-provider' }] })).status, 400);
  const quota = await (await fetch(`${f.base}/api/auth/guest-status`)).json();
  assert.equal(quota.remaining, 5);
  assert.equal(quota.used, 0);
  assert.equal(f.providers(), 0);
});

test('guest HTTP: changing the guest cookie cannot evade the IP daily quota', async t => {
  const f = await fixture(t, { env: { GUEST_AI_DAILY_LIMIT: '1' } });
  assert.equal((await f.ask({}, 'first-cookie')).status, 200);
  const response = await f.ask({}, 'new-cookie');
  assert.equal(response.status, 429);
  assert.equal(f.providers(), 1);
});

test('guest quotas: finish plus close refunds only once and uses reservation day across midnight', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-20T23:59:59Z') });
  const policy = new AiPolicy({ redis: null, env: { GUEST_AI_DAILY_LIMIT: '3' } });
  const req = { method: 'POST', path: '/api/ask', ownerId: 'guest_refund', ip: '127.0.0.1', body: {}, securityContext: {}, get: () => 'guest-refund-fixture-key' };
  const res = new EventEmitter();
  res.json = () => {};
  await policy.middleware()(req, res, () => {});
  const keys = [...req.guestMemoryQuotaKeys];
  t.mock.timers.tick(2000);
  res.emit('finish'); res.emit('close');
  for (const key of keys) assert.equal(policy.inMemoryGuestUsage.get(key), 0);
  assert.equal(req.securityContext.signal.aborted, true);
});

test('guest quota HTTP: Redis outage is sanitized and never reports an invented balance', async t => {
  const f = await fixture(t, { redis: { isReady: true, async mGet() { throw new Error('private Redis error'); } } });
  const response = await fetch(`${f.base}/api/auth/guest-status`);
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const data = await response.json();
  assert.equal(data.code, 'EXECUTION_UNAVAILABLE');
  assert.equal(data.remaining, undefined);
  assert.ok(!JSON.stringify(data).includes('private Redis error'));
});

test('guest quotas: Redis uses the larger owner/IP count and rejects corrupt counters', async () => {
  const req = { ownerId: 'guest_fixture', ip: '127.0.0.1' };
  const policy = new AiPolicy({ redis: { isReady: true, async mGet() { return ['1', '4']; } }, env: {} });
  assert.equal((await policy.getGuestQuota(req)).remaining, 1);
  policy.redis.mGet = async () => ['broken', '0'];
  await assert.rejects(policy.getGuestQuota(req), { code: 'EXECUTION_UNAVAILABLE' });
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

test('guest limit configuration rejects silent truncation, zero, negative and unsafe values', () => {
  for (const value of ['0', '-1', '3abc', '3.5', 'NaN', 'Infinity', '', '9007199254740992']) {
    assert.throws(() => guestDailyLimit({ GUEST_AI_DAILY_LIMIT: value }));
  }
  assert.equal(guestDailyLimit({}), 5);
  assert.equal(guestDailyLimit({ GUEST_AI_DAILY_LIMIT: '8' }), 8);
  assert.throws(() => guestMessageBalance({}), { code: 'EXECUTION_UNAVAILABLE' });
  assert.throws(() => guestMessageBalance({ guestMessagesAvailable: 3, remainingGuestMessages: 4 }), { code: 'EXECUTION_UNAVAILABLE' });
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

test('guest SSE: short answers appear before completion without leaking partial CTA markers', () => {
  for (const count of [5, 2, 1]) {
    const chunks = [];
    const stream = createGuestAnswerStream(count, chunk => chunks.push(chunk));
    stream.push('Salam!');
    assert.equal(chunks.join(''), 'Salam!', 'The first short chunk must appear immediately');
    stream.push(' Sizə necə kömək edə bilərəm?');
    const body = 'Salam! Sizə necə kömək edə bilərəm?';
    assert.equal(chunks.join(''), body);
    const tail = '\n\n**' + getGuestCtaNotice(4) + '**';
    for (const character of tail) {
      stream.push(character);
      assert.equal(chunks.join(''), body, 'Incomplete or stale model CTA must stay private');
    }
    const final = stream.finish();
    assert.equal(chunks.join(''), formatGuestAnswerWithCta(body, count));
    assert.equal(chunks.join(''), final);
  }
});

test('guest SSE: ambiguous suffixes are released when they turn out to be answer text', () => {
  const chunks = [];
  const stream = createGuestAnswerStream(5, chunk => chunks.push(chunk));
  const body = ' **Keyfiyyət** və Qeydiyyat faydalıdır. Diqqətli olun.';
  for (const character of body) stream.push(character);
  assert.equal(chunks.join(''), body.trim());
  assert.equal(stream.finish(), formatGuestAnswerWithCta(body, 5));
});

test('guest SSE: streams the body progressively and publishes one authoritative CTA across chunk boundaries', () => {
  for (const count of [5, 2, 1]) {
    const body = '  ' + 'Biznes cavabı. '.repeat(150) + '\n\n';
    // Duplicate and stale model-authored notices must not escape into the stream.
    const text = body + getGuestCtaNotice(4) + '\n\n**' + getGuestCtaNotice(1) + '**  ';
    const chunks = [];
    const stream = createGuestAnswerStream(count, chunk => chunks.push(chunk));
    for (let i = 0; i < text.length; i += 7) stream.push(text.slice(i, i + 7));
    assert.ok(chunks.length > 1, 'Body should appear before generation finishes');
    assert.ok(!chunks.join('').includes('Qeyd:'));
    assert.ok(!chunks.join('').includes('Diqqət:'));
    const final = stream.finish(text.trim());
    assert.equal(chunks.join(''), final);
    assert.equal(final, formatGuestAnswerWithCta(body, count));
  }
  const chunks = [];
  const exhausted = createGuestAnswerStream(0, chunk => chunks.push(chunk));
  exhausted.push('Must never appear. '.repeat(100));
  assert.equal(chunks.length, 0);
  exhausted.finish('Must never appear');
  assert.deepEqual(chunks, [GUEST_EXHAUSTED_MESSAGE]);
});

// Deterministic Redis command adapter. Each eval executes without yielding, matching
// Redis Lua atomicity; tests exercise the production middleware and key lifecycle.
class QuotaRedis {
  async get(key) { return this.values.get(key) || null; }
  isReady = true;
  values = new Map();
  async set(key, value, options = {}) {
    if (options.NX && this.values.has(key)) return null;
    this.values.set(key, value);
    return 'OK';
  }
  async mGet(keys) { return keys.map(key => this.values.has(key) ? String(this.values.get(key)) : null); }
  async eval(script, { keys, arguments: args = [] }) {
    const number = key => Number(this.values.get(key) || 0);
    if (script.includes("redis.call('set',KEYS[1],ARGV[2]")) {
      if (this.values.get(keys[0]) !== args[0]) return 0;
      this.values.set(keys[0], args[1]); return 1;
    }
    if (script.includes("redis.call('decr',k)")) {
      for (const key of keys) if (number(key) > 0) this.values.set(key, number(key) - 1);
      return 1;
    }
    if (script.includes("redis.call('incr',k)")) {
      if (keys.some(key => number(key) >= Number(args[0]))) return 0;
      for (const key of keys) this.values.set(key, number(key) + 1);
      return script.includes('local res = 0') ? Math.max(...keys.map(number)) : 1;
    }
    if (script.includes("redis.call('del', KEYS[1])")) {
      if (this.values.get(keys[0]) !== args[0]) return 0;
      this.values.delete(keys[0]); return 1;
    }
    if (script.includes("redis.call('pexpire'")) return this.values.get(keys[0]) === args[0] ? 1 : 0;
    throw new Error('Unexpected Redis script');
  }
}

test('production Redis HTTP: fifth answer succeeds, sixth blocks, and validation refunds quota', async t => {
  const redis = new QuotaRedis();
  const f = await fixture(t, { redis, env: { NODE_ENV: 'production' } });
  assert.equal((await f.ask({ unknown: true })).status, 400);
  for (let i = 0; i < 5; i++) {
    const response = await f.ask({ stream: i === 4 });
    assert.equal(response.status, 200);
    await response.text();
    await new Promise(resolve => setImmediate(resolve));
  }
  const blocked = await f.ask();
  assert.equal(blocked.status, 429);
  assert.equal((await blocked.json()).reply, GUEST_EXHAUSTED_MESSAGE);
  assert.equal(f.providers(), 5);
  assert.equal((await f.policy.getGuestQuota({ ownerId: 'guest_fixture', ip: '127.0.0.1' })).remaining, 0);
  assert.equal([...redis.values.keys()].filter(key => key.startsWith('security:owner-execution:')).length, 0);
});

test('production Redis: concurrent owner rejection refunds its reservation and duplicate idempotency cannot consume quota', async () => {
  const redis = new QuotaRedis();
  const policy = new AiPolicy({ redis, env: { NODE_ENV: 'production', GUEST_AI_DAILY_LIMIT: '3' } });
  const request = key => ({ method: 'POST', path: '/api/ask', ownerId: 'guest_same', ip: '127.0.0.1', body: {}, securityContext: {}, get: () => key });
  const response = () => Object.assign(new EventEmitter(), { status(value) { this.statusCode = value; return this; }, json(value) { this.body = value; } });
  const first = request('first-idempotency-key');
  const firstRes = response();
  await policy.middleware()(first, firstRes, () => {});
  const secondRes = response();
  await policy.middleware()(request('second-idempotency-key'), secondRes, () => assert.fail('Concurrent owner must be blocked'));
  assert.equal(secondRes.body.code, 'EXECUTION_BUSY');
  assert.equal((await policy.getGuestQuota(first)).used, 1);
  const duplicate = response();
  await policy.middleware()(request('first-idempotency-key'), duplicate, () => assert.fail('Duplicate must be blocked'));
  assert.equal(duplicate.body.code, 'REQUEST_ALREADY_SUBMITTED');
  assert.equal((await policy.getGuestQuota(first)).used, 1);
  firstRes.emit('finish'); firstRes.emit('close');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal((await policy.getGuestQuota(first)).used, 0);
  assert.equal(first.securityContext.signal.aborted, true);
});
