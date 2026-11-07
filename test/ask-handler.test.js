import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import express from 'express';
import { createAskHandler } from '../src/http/ask-handler.js';
import { createAskService } from '../src/services/ai/ask-service.js';
import { sanitizeAskGroundingMetadata } from '../src/services/ai/ask-grounding.js';
import { createAskExecutionGuard } from '../src/http/ask-execution-guard.js';
import { createCapabilityRouter } from '../src/http/capability-router.js';
import { AiPolicy } from '../src/services/security/ai-policy.js';
import { PrivacyPolicy } from '../src/services/security/privacy-policy.js';
import { configureProviderPolicy, wrapProvider } from '../src/services/security/provider-policy.js';
import { FileChatRepository } from '../src/repositories/file-chat-repository.js';
import { GUEST_RESTRICTION_NOTICES } from '../src/services/ai/prompts.js';
import { createPluginRegistry } from '../src/services/plugins/registry.js';
import { acquireOwnerExecutionLease } from '../src/services/security/owner-execution-lease.js';

const sse = text => text.split(/\r?\n\r?\n/).filter(line => line.startsWith('data: ')).map(line => JSON.parse(line.slice(6)));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
class RedisFixture {
  isReady = true;
  values = new Map();
  beforeCompletion = async () => {};
  now = 100000;
  async get(key) { return this.values.get(key) || null; }
  async set(key, value, options = {}) {
    if (options.NX && this.values.has(key)) return null;
    this.values.set(key, value); return 'OK';
  }
  async zRem() {}
  async eval(script, { keys, arguments: args }) {
    if (keys[0].startsWith('security:ask-minute:')) {
      const window = Number(args[1]);
      const buckets = keys.map(key => (this.values.get(key) || []).filter(time => time > this.now - window));
      const retry = Math.max(0, ...buckets.map((bucket, index) =>
        bucket.length >= Number(args[index + 2]) ? bucket[0] + window - this.now : 0));
      if (retry) return Math.ceil(retry / 1000);
      keys.forEach((key, index) => this.values.set(key, [...buckets[index], this.now]));
      return 0;
    }
    if (args[0] === 'ask-shared-v2') {
      const owner = this.values.get(keys[0]);
      const leases = this.values.get(keys[1]) || new Map();
      if (script.includes("redis.call('set', KEYS[1]")) {
        if (owner && owner !== args[0]) return 0;
        this.values.set(keys[0], args[0]);
        this.values.set(keys[1], leases);
        leases.set(args[1], this.now + Number(args[2]));
        return 1;
      }
      if (owner !== args[0]) return 0;
      if (script.includes("redis.call('zrem',")) {
        leases.delete(args[1]);
        if (!leases.size) { this.values.delete(keys[0]); this.values.delete(keys[1]); }
        return 1;
      }
      if ((leases.get(args[1]) || 0) <= this.now) return 0;
      if (script.includes("redis.call('zadd'")) leases.set(args[1], this.now + Number(args[2]));
      return 1;
    }
    if (script.includes("redis.call('set',KEYS[1],ARGV[2]")) {
      if (JSON.parse(args[1]).state === 'completed') await this.beforeCompletion();
      if (this.values.get(keys[0]) !== args[0]) return 0;
      this.values.set(keys[0], args[1]); return 1;
    }
    if (script.includes("redis.call('zremrangebyscore'") || script.includes("redis.call('zscore'") || script.includes("redis.call('incr',k)")) return 1;
    if (script.includes("redis.call('pexpire'")) return this.values.get(keys[0]) === args[0] ? 1 : 0;
    if (script.includes("redis.call('del'")) {
      if (this.values.get(keys[0]) !== args[0]) return 0;
      this.values.delete(keys[0]); return 1;
    }
    throw new Error('Unexpected fixture Redis operation');
  }
}
async function fixture(t, { redis = null, limits, parallel = false } = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'helmer-ask-http-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const ownerA = randomUUID(), ownerB = randomUUID();
  const user = id => ({ id, status: 'active', emailVerifiedAt: 'now', authVersion: 1, settings: { modelImprovement: false, personalIntelligence: false } });
  const users = new Map([[ownerA, user(ownerA)], [ownerB, user(ownerB)]]);
  const chatRepository = new FileChatRepository(path.join(directory, 'chats.json'), null, { cloud: false });
  const learning = [], telemetry = [], calls = [];
  let releaseCount = 0, strategyOwner = ownerA, backgroundOwner = null;
  const strategyId = randomUUID(), taskId = randomUUID();
  const f = { ownerA, ownerB, users, strategyId, taskId, chatRepository, learning, telemetry, calls,
    response: async () => ({ text: 'Tam cavab.', candidates: [{}] }),
    stream: async function* () { yield await f.response(); },
    releases: () => releaseCount, setStrategyOwner: value => { strategyOwner = value; },
    setBackgroundOwner: value => { backgroundOwner = value; },
  };
  const policy = new AiPolicy({ redis, allowParallelAskChats: parallel, env: { GUEST_AI_DAILY_LIMIT: '5' } });
  configureProviderPolicy({ assertEnabled: () => policy.assertEnabled(), reserveProvider: async (context, params) => {
    const release = await policy.reserveProvider(context, params);
    return async () => { releaseCount++; await release(); };
  } });
  t.after(() => configureProviderPolicy(undefined));
  const client = wrapProvider({ models: {
    generateContent: async params => { calls.push(params); return f.response(params); },
    generateContentStream: async params => { calls.push(params); return f.stream(params); },
  } }, 'gemini');
  const strategyRepository = { getById: async (id, owner) => id === strategyId && owner === strategyOwner ? { id, ownerId: owner, title: 'Private strategy', strategy: { secret: 'Tenant strategy' } } : null };
  const plannerRepository = { list: async owner => owner === ownerA ? [{ id: taskId, ownerId: owner, text: 'Private task' }] : [] };
  const app = express(); app.use(express.json());
  // Fixture identities replace only session login. Production privacy, AI policy,
  // tenant guard, strict capability router, Ask handler and file repository run.
  app.use((req, _res, next) => {
    req.ownerId = req.get('X-Test-Owner') || ownerA;
    req.user = users.get(req.ownerId); req.auth = { user: req.user }; next();
  });
  app.use(new PrivacyPolicy({ findById: async id => users.get(id) }).middleware());
  app.use(policy.middleware());
  const guards = Array.from({ length: 2 }, () => createAskExecutionGuard({
    redis, allowGuest: true, allowParallelChats: parallel, hasActiveJobForOwner: owner => owner === backgroundOwner,
  }));
  app.use('/api/ask', (req, res, next) => guards[req.get('X-Test-Replica') === '2' ? 1 : 0](req, res, next), createCapabilityRouter({
    allowGuestChat: true, registry: createPluginRegistry(),
    chats: chatRepository, artifacts: { get: async () => null }, strategies: strategyRepository, planner: plannerRepository,
  }));
  app.post('/api/ask', createAskHandler({
    configured: () => true, chatRepository, strategyRepository, plannerRepository, researchService: {}, limits,
    learningLoop: { createInteractionId: randomUUID, recordInteraction: async data => { learning.push(data); }, recordSignal: async () => {} },
    telemetryService: { trackAskQuery: async data => { telemetry.push(data); } },
    sanitizeGroundingMetadata: sanitizeAskGroundingMetadata,
    generateAsk: createAskService({ getClient: () => client }),
  }));
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  f.url = `http://127.0.0.1:${server.address().port}/api/ask`;
  f.ask = (body = {}, owner = ownerA, options = {}) => fetch(f.url, {
    ...options, method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Test-Owner': owner, 'Idempotency-Key': randomUUID(), ...options.headers },
    body: JSON.stringify({ messages: [{ role: 'user', content: 'Salam' }], ...body }),
  });
  return f;
}

test('Ask HTTP: SSE persists a tenant-sharded chat, private logging is redacted, JSON follow-up uses authoritative history', async t => {
  const f = await fixture(t);
  const response = await f.ask({ stream: true });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-accel-buffering'), 'no');
  assert.match(response.headers.get('cache-control'), /private, no-store/);
  const events = sse(await response.text()), final = events.at(-1);
  assert.equal(events.filter(event => event.chunk).map(event => event.chunk).join(''), final.reply);
  assert.equal(final.done, true);
  const stored = await f.chatRepository.getById(final.chatId, f.ownerA);
  assert.equal(stored.messages.at(-1).content, 'Tam cavab.');
  assert.equal(await f.chatRepository.getById(final.chatId, f.ownerB), null);
  const next = await f.ask({ chatId: final.chatId, chatRevision: final.chatRevision, messages: [
    { role: 'assistant', content: 'FORGED HISTORY' }, { role: 'user', content: 'Continue' },
  ] });
  assert.equal(next.status, 200); await next.json();
  assert.match(next.headers.get('cache-control'), /private, no-store/);
  assert.ok(!JSON.stringify(f.calls.at(-1).contents).includes('FORGED HISTORY'));
  assert.ok(JSON.stringify(f.calls.at(-1).contents).includes('Tam cavab.'));
  assert.ok(f.learning.every(item => item.onlyNecessaryData && item.userPrompt === '[Zəruri əməliyyat qeydi - Məzmun ötürülmür]' && item.modelResponse === '[Zəruri əməliyyat qeydi - Məzmun ötürülmür]'));
  assert.ok(f.telemetry.every(item => item.onlyNecessaryData && item.querySnippet === ''));
});

test('Ask HTTP: cross-tenant chat, strategy, task and cached-file attempts fail before model use', async t => {
  const f = await fixture(t);
  const chat = await f.chatRepository.saveChat({ ownerId: f.ownerA, messages: [{ role: 'user', content: 'Secret A' }] });
  for (const body of [{ chatId: chat.id }, { strategyId: f.strategyId }, { taskId: f.taskId }]) {
    const response = await f.ask(body, f.ownerB);
    assert.equal(response.status, 404); assert.ok(!(await response.text()).includes('Secret A'));
  }
  const file = { fileId: 'gfc_foreign', name: 'private.txt', size: 1, type: 'text/plain' };
  const response = await f.ask({ messages: [{ role: 'user', content: 'Read', file }] }, f.ownerB);
  assert.equal(response.status, 400); assert.equal(f.calls.length, 0);
});

test('Ask HTTP: explicit Web with High and TXT context requires verified sources and saves grounding', async t => {
  const f = await fixture(t);
  const input = {
    stream: true, thinkingLevel: 'high', pluginIds: ['web'],
    messages: [{ role: 'user', content: 'Compare the two options', file: {
      name: 'context.txt', size: 13, type: 'text/plain', textContent: 'pilot marker',
    } }],
  };
  const missing = sse(await (await f.ask(input)).text());
  assert.equal(missing.at(-1).code, 'GROUNDING_UNAVAILABLE');
  assert.ok(!missing.some(event => event.chunk || event.done));
  assert.equal((await f.chatRepository.list(f.ownerA)).length, 0);
  f.response = async () => ({ text: 'Grounded comparison.', candidates: [{ groundingMetadata: {
    groundingChunks: [{ web: { uri: 'https://example.com/market', title: 'Market data' } }],
    webSearchQueries: ['market data'],
  } }] });
  const events = sse(await (await f.ask(input)).text());
  const final = events.at(-1);
  assert.equal(final.done, true);
  assert.deepEqual(f.calls.at(-1).config.tools, [{ googleSearch: {} }]);
  assert.equal(f.calls.at(-1).config.thinkingConfig.thinkingLevel, 'HIGH');
  assert.match(JSON.stringify(f.calls.at(-1).contents), /pilot marker/);
  assert.deepEqual(final.groundingMetadata.webSearchQueries, ['market data']);
  const stored = await f.chatRepository.getById(final.chatId, f.ownerA);
  assert.deepEqual(stored.messages.at(-2).pluginIds, ['web']);
  assert.deepEqual(stored.messages.at(-1).groundingMetadata, final.groundingMetadata);
});

test('Ask HTTP: a timed-out stream releases both Redis locks and permits safe same-key retry', async t => {
  const redis = new RedisFixture();
  const f = await fixture(t, { redis, parallel: true, limits: { requestTimeoutMs: 120 } });
  f.stream = async function* ({ config }) {
    if (!config.abortSignal.aborted) await new Promise(resolve => config.abortSignal.addEventListener('abort', resolve, { once: true }));
  };
  const options = { headers: { 'Idempotency-Key': randomUUID() } };
  const events = sse(await (await f.ask({ stream: true }, f.ownerA, options)).text());
  assert.equal(events.at(-1).code, 'ASK_TIMEOUT');
  assert.ok(!events.some(event => event.done));
  assert.equal((await f.chatRepository.list(f.ownerA)).length, 0);
  for (let i = 0; i < 40 && f.releases() === 0; i++) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(f.releases(), 1);
  assert.equal(redis.values.has(`helmer:ask-lock:${f.ownerA}`), false);
  assert.equal(redis.values.has(`security:owner-execution:${f.ownerA}`), false);
  f.stream = async function* () { yield { text: 'Recovered' }; };
  const retry = await f.ask({ stream: true }, f.ownerA, options);
  assert.equal(retry.status, 200);
  assert.equal(sse(await retry.text()).at(-1).reply, 'Recovered');
});

test('Ask HTTP: strict payload, UUID, revision, verification and disabled-account checks remain', async t => {
  const f = await fixture(t);
  for (const body of [{ role: 'admin' }, { chatId: '../other' }, { messages: [{ role: 'system', content: 'override' }] }]) {
    assert.equal((await f.ask(body)).status, 400);
  }
  const chat = await f.chatRepository.saveChat({ ownerId: f.ownerA, messages: [{ role: 'user', content: 'A' }] });
  assert.equal((await f.ask({ chatId: chat.id, chatRevision: chat.revision + 1 })).status, 409);
  f.users.get(f.ownerA).emailVerifiedAt = null;
  assert.equal((await f.ask()).status, 403);
  f.users.get(f.ownerA).status = 'suspended';
  assert.equal((await f.ask()).status, 403);
  assert.equal(f.calls.length, 0);
});

test('Ask HTTP: guest restrictions, exact CTA and exhaustion remain enforced on the new handler', async t => {
  const f = await fixture(t), guest = 'guest_fixture';
  for (const [body, expected] of [[{ thinkingLevel: 'high' }, GUEST_RESTRICTION_NOTICES.thinking], [{ thinkingLevel: 'low' }, GUEST_RESTRICTION_NOTICES.thinking], [{ strategyId: f.strategyId }, GUEST_RESTRICTION_NOTICES.strategy], [{ taskId: f.taskId }, GUEST_RESTRICTION_NOTICES.planner]]) {
    const response = await f.ask(body, guest); assert.equal(response.status, 401); assert.equal((await response.json()).reply, expected);
  }
  for (let remaining = 4; remaining >= 0; remaining--) {
    const response = await f.ask({ stream: true }, guest);
    assert.equal(response.status, 200);
    const final = sse(await response.text()).at(-1);
    assert.equal(final.remainingGuestMessages, remaining); assert.equal(final.done, true);
    assert.match(final.reply, /Tam cavab\./);
  }
  assert.equal((await f.ask({}, guest)).status, 429); assert.equal(f.calls.length, 5);
});

test('Ask HTTP: first text arrives while generation is pending, concurrent same-owner request is denied, disconnect releases lease and saves nothing', async t => {
  const f = await fixture(t), gate = deferred(), cancelled = deferred();
  f.stream = async function* ({ config }) {
    yield { text: 'First words' }; gate.resolve();
    await new Promise(resolve => {
      if (config.abortSignal.aborted) resolve();
      else config.abortSignal.addEventListener('abort', resolve, { once: true });
    });
    cancelled.resolve(); config.abortSignal.throwIfAborted();
  };
  const controller = new AbortController();
  const response = await f.ask({ stream: true }, f.ownerA, { signal: controller.signal });
  const reader = response.body.getReader(); const first = await reader.read();
  assert.match(new TextDecoder().decode(first.value), /First words/); await gate.promise;
  assert.equal((await f.ask()).status, 429);
  controller.abort(); await reader.cancel().catch(() => {}); await cancelled.promise;
  for (let i = 0; i < 20 && f.releases() === 0; i++) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(f.releases(), 1); assert.equal((await f.chatRepository.list(f.ownerA)).length, 0);
});

test('Ask HTTP: resource revocation during a stream blocks the next chunk and persistence', async t => {
  const f = await fixture(t);
  f.stream = async function* () {
    yield { text: 'Authorized text' };
    f.setStrategyOwner(f.ownerB);
    yield { text: 'LEAK AFTER REVOCATION' };
  };
  const response = await f.ask({ stream: true, strategyId: f.strategyId });
  const events = sse(await response.text());
  assert.ok(!JSON.stringify(events).includes('LEAK AFTER REVOCATION'));
  assert.equal(events.at(-1).code, 'EXECUTION_REVOKED');
  assert.equal(events.some(event => event.done), false);
  assert.equal((await f.chatRepository.list(f.ownerA)).length, 0);
});

test('Ask HTTP: rolling rate replaces the parallel cap across replica guards, with one writer per chat', async t => {
  const redis = new RedisFixture();
  const f = await fixture(t, { redis, parallel: true });
  const existing = await f.chatRepository.saveChat({ ownerId: f.ownerA, messages: [{ role: 'user', content: 'Existing' }] });
  const firstGate = deferred(), secondGate = deferred();
  const firstStarted = deferred(), secondStarted = deferred();
  t.after(() => { firstGate.resolve(); secondGate.resolve(); });
  f.stream = async function* ({ contents }) {
    const isFirst = contents.at(-1).parts.some(part => part.text === 'First chat');
    const gate = isFirst ? firstGate : secondGate;
    (isFirst ? firstStarted : secondStarted).resolve();
    yield { text: 'Started' };
    await gate.promise;
    yield { text: ' and completed' };
  };
  const chat = { stream: true, chatId: existing.id, chatRevision: existing.revision, messages: [{ role: 'user', content: 'First chat' }] };
  const replicaTwo = { headers: { 'X-Test-Replica': '2' } };
  const first = await f.ask(chat);
  assert.equal(first.status, 200);
  await firstStarted.promise;
  const duplicate = await f.ask(chat, f.ownerA, replicaTwo);
  assert.equal(duplicate.status, 429);
  assert.equal((await duplicate.json()).code, 'EXECUTION_BUSY');
  const second = await f.ask({ stream: true }, f.ownerA, replicaTwo);
  assert.equal(second.status, 200);
  await secondStarted.promise;
  assert.equal(f.calls.length, 2);
  await assert.rejects(acquireOwnerExecutionLease(redis, f.ownerA, new AbortController()), { code: 'EXECUTION_BUSY' });
  const further = await Promise.all(Array.from({ length: 12 }, () => f.ask({ stream: true }, f.ownerA, replicaTwo)));
  assert.ok(further.every(response => response.status === 200));
  const overflow = await f.ask({ stream: true });
  assert.equal(overflow.status, 429);
  assert.equal(overflow.headers.get('Retry-After'), '60');
  assert.equal((await overflow.json()).code, 'RATE_LIMITED');
  redis.now += 59000;
  const nearlyReset = await f.ask();
  assert.equal(nearlyReset.status, 429);
  assert.equal(nearlyReset.headers.get('Retry-After'), '1');
  await nearlyReset.text();
  redis.now += 1000;
  firstGate.resolve();
  const firstDone = sse(await first.text()).at(-1);
  await assert.rejects(acquireOwnerExecutionLease(redis, f.ownerA, new AbortController()), { code: 'EXECUTION_BUSY' });
  secondGate.resolve();
  const secondDone = sse(await second.text()).at(-1);
  for (const response of further) assert.equal(sse(await response.text()).at(-1).done, true);
  assert.equal(firstDone.chatId, existing.id);
  assert.notEqual(secondDone.chatId, existing.id);
  assert.equal(firstDone.done, true);
  assert.equal(secondDone.done, true);
  const exclusive = await acquireOwnerExecutionLease(redis, f.ownerA, new AbortController());
  const blocked = await f.ask();
  assert.equal(blocked.status, 429);
  await blocked.text();
  await exclusive.release();
  const recovered = await f.ask();
  assert.equal(recovered.status, 200);
  await recovered.text();
});

test('Ask HTTP: raw provider errors and unknown codes never reach client or telemetry', async t => {
  const f = await fixture(t);
  f.response = async () => { throw Object.assign(new Error('api-key=SECRET /private/path'), { status: 400, code: 'SECRET_TOKEN' }); };
  for (const stream of [false, true]) {
    const response = await f.ask({ stream });
    const text = await response.text();
    assert.ok(!text.includes('SECRET')); assert.ok(!text.includes('/private')); assert.match(text, /ASK_ERROR/);
  }
  assert.ok(!JSON.stringify(f.telemetry).includes('SECRET'));
});

test('Ask HTTP: uploads survive follow-up as owner-scoped references and explicit Thinking is preserved', async t => {
  const f = await fixture(t);
  const first = await f.ask({ thinkingLevel: 'high', messages: [{ role: 'user', content: 'Summarize this file',
    file: { name: 'notes.txt', type: 'text/plain', size: 12, textContent: 'PRIVATE_FILE_TEXT' },
  }] });
  assert.equal(first.status, 200);
  const data = await first.json();
  assert.equal(f.calls[0].config.thinkingConfig.thinkingLevel, 'HIGH');
  const storedFile = data.chat.messages[0].file;
  assert.ok(storedFile.fileId); assert.equal(storedFile.textContent, undefined); assert.equal(storedFile.data, undefined);
  const followup = await f.ask({ chatId: data.chatId, chatRevision: data.chatRevision, messages: [{ role: 'user', content: 'Explain the same file' }] });
  assert.equal(followup.status, 200); await followup.json();
  assert.ok(JSON.stringify(f.calls.at(-1).contents).includes('PRIVATE_FILE_TEXT'));
  assert.equal(f.calls.at(-1).config.cachedContent, undefined);
});

test('Ask HTTP: persistence failure never sends done or raw storage errors', async t => {
  const f = await fixture(t);
  f.chatRepository.saveChat = async () => { throw new Error('DATABASE_SECRET /private/store'); };
  const response = await f.ask({ stream: true });
  const text = await response.text(), events = sse(text);
  assert.ok(events.some(event => event.chunk)); assert.ok(!events.some(event => event.done));
  assert.equal(events.at(-1).code, 'ASK_ERROR'); assert.ok(!text.includes('DATABASE_SECRET'));
});

test('Ask HTTP: active background research blocks only its owner before generation', async t => {
  const f = await fixture(t);
  f.setBackgroundOwner(f.ownerA);
  const blocked = await f.ask();
  assert.equal(blocked.status, 429);
  assert.equal((await blocked.json()).code, 'EXECUTION_BUSY');
  assert.equal(f.calls.length, 0);
  const other = await f.ask({}, f.ownerB);
  assert.equal(other.status, 200); await other.json();
  f.setBackgroundOwner(null);
  const resumed = await f.ask();
  assert.equal(resumed.status, 200); await resumed.json();
});

test('Ask HTTP: missing, malformed and oversized idempotency keys never reach the provider', async t => {
  const f = await fixture(t);
  for (const key of ['', 'short', 'invalid:key-with-punctuation', 'x'.repeat(101)]) {
    const response = await f.ask({}, f.ownerA, { headers: { 'Idempotency-Key': key } });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).code, 'IDEMPOTENCY_KEY_REQUIRED');
  }
  assert.equal(f.calls.length, 0);
});

test('Ask HTTP: done waits for durable replay; immediate retry replays once and fingerprints are owner-scoped', async t => {
  const redis = new RedisFixture(), entered = deferred(), committed = deferred();
  redis.beforeCompletion = async () => { entered.resolve(); await committed.promise; };
  const f = await fixture(t, { redis });
  t.after(() => committed.resolve());
  const key = randomUUID(), options = { headers: { 'Idempotency-Key': key } };
  const response = await f.ask({ stream: true }, f.ownerA, options);
  const reader = response.body.getReader(), decoder = new TextDecoder();
  const first = await reader.read();
  let text = decoder.decode(first.value, { stream: true });
  await entered.promise;
  assert.match(text, /Tam cavab/); assert.ok(!text.includes('"done":true'));
  assert.equal([...redis.values.values()].some(value => value.includes('"state":"completed"')), false);
  committed.resolve();
  while (true) {
    const next = await reader.read(); if (next.done) break;
    text += decoder.decode(next.value, { stream: true });
  }
  reader.releaseLock();
  const final = sse(text).at(-1);
  assert.equal(final.done, true);
  const replay = await f.ask({ stream: true }, f.ownerA, options);
  assert.equal(replay.status, 200);
  assert.equal((await replay.json()).chatId, final.chatId);
  assert.equal(f.calls.length, 1);
  const conflict = await f.ask({ stream: true, messages: [{ role: 'user', content: 'Different question' }] }, f.ownerA, options);
  assert.equal(conflict.status, 409); assert.equal((await conflict.json()).code, 'IDEMPOTENCY_CONFLICT');
  const other = await f.ask({ stream: true }, f.ownerB, options);
  assert.equal(other.status, 200);
  assert.notEqual(sse(await other.text()).at(-1).chatId, final.chatId);
  assert.equal(f.calls.length, 2);
});

test('Ask HTTP: replay-store failure after chat commit never reports done or repeats generation', async t => {
  const redis = new RedisFixture();
  redis.beforeCompletion = async () => { throw new Error('PRIVATE_REDIS_FAILURE'); };
  const f = await fixture(t, { redis });
  const options = { headers: { 'Idempotency-Key': randomUUID() } };
  const response = await f.ask({ stream: true }, f.ownerA, options);
  const text = await response.text(), events = sse(text);
  assert.equal(events.at(-1).code, 'EXECUTION_UNAVAILABLE');
  assert.ok(!events.some(event => event.done)); assert.ok(!text.includes('PRIVATE_REDIS_FAILURE'));
  assert.equal((await f.chatRepository.list(f.ownerA)).length, 1);
  const retry = await f.ask({ stream: true }, f.ownerA, options);
  assert.equal(retry.status, 409); await retry.text();
  assert.equal(f.calls.length, 1);
});

test('Ask retains production CSRF rejection for foreign, missing and insecure origins', async t => {
  const vm = await import('node:vm');
  const source = await fs.readFile(new URL('../server.js', import.meta.url), 'utf8');
  const definitionsStart = source.indexOf('function normalizeOrigin(');
  const definitionsEnd = source.indexOf('app.use((req, res, next) => {', definitionsStart);
  const guardStart = source.indexOf('app.use((req, res, next) => {\n  if (!["POST"');
  const guardEnd = source.indexOf('// 🔍 SEO', guardStart);
  assert.ok(definitionsStart >= 0 && guardStart >= 0 && guardEnd > guardStart);
  const app = express();
  vm.runInNewContext(source.slice(definitionsStart, definitionsEnd) + source.slice(guardStart, guardEnd), {
    app, URL, Set, process: { env: { NODE_ENV: 'production' } }, APP_URL: 'https://helmer.example',
  });
  app.post('/api/ask', (_req, res) => res.json({ ok: true }));
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const url = `http://127.0.0.1:${server.address().port}/api/ask`;
  for (const headers of [{}, { Origin: 'https://evil.example' }, { Origin: 'http://helmer.example' }, { Origin: 'https://helmer.example', 'Sec-Fetch-Site': 'cross-site' }]) {
    assert.equal((await fetch(url, { method: 'POST', headers })).status, 403);
  }
  assert.equal((await fetch(url, { method: 'POST', headers: { Origin: 'https://helmer.example', 'Sec-Fetch-Site': 'same-origin' } })).status, 200);
});
