import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import express from 'express';
import { EventEmitter } from 'node:events';
import { PrivacyPolicy, privacySnapshot, executionContext } from '../src/services/security/privacy-policy.js';
import { configureProviderPolicy, wrapProvider } from '../src/services/security/provider-policy.js';
import { AiPolicy } from '../src/services/security/ai-policy.js';
import { createAskHandler } from '../src/http/ask-handler.js';
import { createHelmerDecisionRouter } from '../src/services/ai/decision-router.js';
import { FileUserRepository } from '../src/repositories/file-user-repository.js';
import { FilePlannerRepository } from '../src/repositories/file-planner-repository.js';
import { FileChatRepository } from '../src/repositories/file-chat-repository.js';

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

async function listen(t, app) {
  const server = app.listen(0, '127.0.0.1');
  if (!server.listening) {
    await new Promise((resolve) => server.once('listening', resolve));
  }
  t.after(() => {
    server.closeAllConnections?.();
    return new Promise((resolve) => server.close(resolve));
  });
  return `http://127.0.0.1:${server.address().port}`;
}

test('execution authorization reads account, scoped resources and every context reference concurrently and freshly', async () => {
  const user = { id: 'owner', status: 'active', authVersion: 1, privacyEpoch: 0 };
  const account = deferred(), resources = deferred(), firstReference = deferred(), secondReference = deferred();
  const started = [];
  const policy = new PrivacyPolicy({ findById: async ownerId => {
    assert.equal(ownerId, user.id); started.push('account'); await account.promise; return user;
  } });
  let firstExists = true, secondExists = true, checks = 0;
  const context = {
    ownerId: user.id, guest: false, privacySnapshot: privacySnapshot(user),
    assertResources: async () => { started.push('resources'); await resources.promise; },
    resourceChecks: [
      async () => { checks++; started.push('first'); await firstReference.promise; return firstExists; },
      async () => { checks++; started.push('second'); await secondReference.promise; return secondExists; },
    ],
  };
  const pending = policy.assertExecution(context);
  assert.deepEqual(started, ['account', 'resources', 'first', 'second'], 'No authoritative read may wait for another cloud read');
  account.resolve(); resources.resolve(); firstReference.resolve(); secondReference.resolve(); await pending;
  secondExists = false;
  await assert.rejects(policy.assertExecution(context), { code: 'EXECUTION_REVOKED' });
  secondExists = true; firstExists = false;
  await assert.rejects(policy.assertExecution(context), { code: 'EXECUTION_REVOKED' });
  assert.equal(checks, 6, 'Every reference must be checked again on each streaming boundary');
  firstExists = true;
  for (const change of [{ status: 'suspended' }, { scheduledDeletionAt: 'now' }, { privacyEpoch: 1 }, { authVersion: 2 }]) {
    const original = { ...user }; Object.assign(user, change);
    await assert.rejects(policy.assertExecution(context), { code: 'EXECUTION_REVOKED' });
    for (const key of Object.keys(user)) delete user[key]; Object.assign(user, original);
  }
});

test('provider streaming awaits parallel platform and account checks before each chunk and releases on revocation', async t => {
  const enabledGate = deferred(), accountGate = deferred();
  let streaming = false, revoked = false, releases = 0, reservations = 0;
  const entered = [];
  configureProviderPolicy({
    assertEnabled: async () => { if (streaming) { entered.push('platform'); await enabledGate.promise; } },
    reserveProvider: async () => { reservations++; return async () => { releases++; }; },
  });
  t.after(() => configureProviderPolicy(undefined));
  const controller = new AbortController();
  const context = {
    ownerId: 'owner', signal: controller.signal, controller,
    assertAuthorized: async () => {
      if (streaming) { entered.push('account'); await accountGate.promise; }
      if (revoked) throw Object.assign(new Error('Revoked'), { code: 'EXECUTION_REVOKED' });
    },
  };
  const client = wrapProvider({ models: { generateContentStream: async () => (async function* () {
    streaming = true; yield { text: 'First' }; yield { text: 'Must remain private' };
  })() } }, 'gemini');
  await executionContext.run(context, async () => {
    const iterator = await client.models.generateContentStream({ model: 'gemini-3.8-flash', config: {} });
    const pending = iterator.next();
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(entered, ['platform', 'account']);
    enabledGate.resolve(); accountGate.resolve();
    assert.equal((await pending).value.text, 'First');
    revoked = true;
    await assert.rejects(iterator.next(), { code: 'EXECUTION_REVOKED' });
  });
  assert.deepEqual(entered, ['platform', 'account', 'platform', 'account']);
  assert.equal(reservations, 1); assert.equal(releases, 1);
});

test('overlapping tenant cloud reads share one fetch without retaining stale data or crossing owners', async t => {
  const fs = await import('node:fs/promises');
  const os = await import('node:os');
  const path = await import('node:path');
  const { randomUUID } = await import('node:crypto');
  const { FileChatRepository } = await import('../src/repositories/file-chat-repository.js');
  const { FileStrategyRepository } = await import('../src/repositories/file-strategy-repository.js');
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'helmer-read-flight-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  for (const Repository of [FileChatRepository, FileStrategyRepository]) {
    const gate = deferred(); let reads = 0;
    const ownerA = randomUUID(), ownerB = randomUUID(), idA = randomUUID(), idB = randomUUID();
    const records = new Map();
    const repo = new Repository(path.join(directory, Repository.name), null, {
      cloud: true,
      readCloud: async key => { reads++; await gate.promise; return { record: structuredClone(records.get(key) || []), etag: 'fixture' }; },
    });
    repo._migrationPromise = Promise.resolve();
    records.set(repo.tenantKey(ownerA), [{ id: idA, ownerId: ownerA, messages: [], title: 'A' }]);
    records.set(repo.tenantKey(ownerB), [{ id: idB, ownerId: ownerB, messages: [], title: 'B' }]);
    const pending = [repo.getById(idA, ownerA), repo.getById(idA, ownerA), repo.getById(idB, ownerB)];
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(reads, 2, 'Only overlapping reads for the same tenant may be shared');
    gate.resolve();
    const [first, second, otherOwner] = await Promise.all(pending);
    assert.equal(first.ownerId, ownerA); assert.equal(otherOwner.ownerId, ownerB);
    first.title = 'Modified'; assert.equal(second.title, 'A', 'Callers must not share mutable records');
    assert.equal(repo.inFlightTenantReads.size, 0);
    records.set(repo.tenantKey(ownerA), []);
    assert.equal(await repo.getById(idA, ownerA), null, 'Deletion must be visible on the very next check');
    assert.equal(reads, 3);
    assert.equal(await repo.getById(idB, ownerA), null, 'A raw ID must never cross tenant ownership');
  }
});

test('overlapping account reads share the cloud request but each later authorization sees revocation', async t => {
  const fs = await import('node:fs/promises');
  const os = await import('node:os');
  const path = await import('node:path');
  const { randomUUID } = await import('node:crypto');
  const { FileUserRepository } = await import('../src/repositories/file-user-repository.js');
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'helmer-account-flight-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const gate = deferred(); let reads = 0;
  const id = randomUUID();
  const user = { id, status: 'active', username: 'fixture', email: 'fixture@example.com', settings: { personalIntelligence: true }, authVersion: 1 };
  const repo = new FileUserRepository(path.join(directory, 'users.json'), null, {
    cloud: true,
    readCloud: async () => { reads++; await gate.promise; return { record: { users: [structuredClone(user)] } }; },
  });
  const first = repo.findById(id), second = repo.findById(id);
  assert.equal(reads, 1); gate.resolve();
  const [left, right] = await Promise.all([first, second]);
  left.settings.personalIntelligence = false;
  assert.equal(right.settings.personalIntelligence, true);
  assert.equal(repo.inFlightStoreRead, null);
  user.status = 'pending_deletion';
  assert.equal((await repo.findById(id)).status, 'pending_deletion');
  assert.equal(reads, 2);
});

test('a fresh tenant read never joins an older snapshot waiting on a local mirror write', async t => {
  const fs = await import('node:fs/promises');
  const os = await import('node:os');
  const path = await import('node:path');
  const { randomUUID } = await import('node:crypto');
  const { FileChatRepository } = await import('../src/repositories/file-chat-repository.js');
  const { FileStrategyRepository } = await import('../src/repositories/file-strategy-repository.js');
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'helmer-fresh-read-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  for (const Repository of [FileChatRepository, FileStrategyRepository]) {
    let reads = 0;
    const mirrorGate = deferred(), mirrorEntered = deferred();
    const ownerId = randomUUID(), id = randomUUID();
    let records = [{ id, ownerId, messages: [] }];
    const repo = new Repository(path.join(directory, Repository.name), null, {
      cloud: true, readCloud: async () => { reads++; return { record: structuredClone(records), etag: String(reads) }; },
    });
    repo._migrationPromise = Promise.resolve();
    repo.writeLocalTenant = async () => { mirrorEntered.resolve(); await mirrorGate.promise; };
    const earlierRead = repo.getById(id, ownerId);
    await mirrorEntered.promise;
    records = [];
    const freshRead = repo.getById(id, ownerId);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(reads, 2, 'A completed cloud fetch must not be reused while its local mirror is pending');
    mirrorGate.resolve();
    await earlierRead;
    assert.equal(await freshRead, null);
  }
});

test('grounded prelude validates every private event concurrently before yielding source metadata', async t => {
  let streaming = false, validations = 0, releases = 0;
  const gate = deferred();
  configureProviderPolicy({ reserveProvider: async () => async () => { releases++; } });
  t.after(() => configureProviderPolicy(undefined));
  const context = { ownerId: 'owner', assertAuthorized: async () => { if (streaming) { validations++; await gate.promise; } } };
  const events = [
    { text: 'Buffered first. ' }, { text: 'Buffered second.' },
    { text: '', candidates: [{ groundingMetadata: { groundingChunks: [{ web: { uri: 'https://example.com/source' } }] } }] },
  ];
  const client = wrapProvider({ models: { generateContentStream: async () => (async function* () {
    streaming = true; for (const event of events) yield event;
  })() } }, 'gemini');
  await executionContext.run(context, async () => {
    const iterator = await client.models.generateContentStream({ model: 'gemini-3.8-flash', config: { tools: [{ googleSearch: {} }] } }, { bufferGroundingPrelude: true });
    const first = iterator.next();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(validations, events.length, 'Source metadata must be pulled without serial cloud waits; every event still needs authorization');
    gate.resolve();
    const actual = [(await first).value];
    for await (const event of iterator) actual.push(event);
    assert.deepEqual(actual, events);
  });
  assert.equal(releases, 1);
});

test('grounded prelude passes streamChunk staleness budget to policy checks without skipping per-event authorization', async t => {
  let streaming = false, enabledStales = [], authStales = [], releases = 0;
  configureProviderPolicy({
    assertEnabled: async (opts = {}) => { if (streaming) enabledStales.push(opts.maxStaleMs ?? 0); },
    reserveProvider: async () => async () => { releases++; },
  });
  t.after(() => configureProviderPolicy(undefined));
  const context = {
    ownerId: 'owner',
    assertAuthorized: async (opts = {}) => { if (streaming) authStales.push(opts.maxStaleMs ?? 0); },
  };
  const events = [
    { text: 'Chunk 1. ' },
    { text: 'Chunk 2. ' },
    { text: '', candidates: [{ groundingMetadata: { groundingChunks: [{ web: { uri: 'https://example.com/source' } }] } }] },
  ];
  const client = wrapProvider({ models: { generateContentStream: async () => (async function* () {
    streaming = true; for (const event of events) yield event;
  })() } }, 'gemini');
  await executionContext.run(context, async () => {
    const iterator = await client.models.generateContentStream({ model: 'gemini-4-hydrogen', config: { tools: [{ googleSearch: {} }] } }, { bufferGroundingPrelude: true });
    for await (const _event of iterator) {}
  });
  assert.deepEqual(enabledStales, [2500, 2500, 2500]);
  assert.deepEqual(authStales, [2500, 2500, 2500]);
  assert.equal(releases, 1);
});

test('a failed grounded prelude check publishes no buffered events and releases the provider lease', async t => {
  let streaming = false, validations = 0, releases = 0;
  const controller = new AbortController();
  configureProviderPolicy({ reserveProvider: async () => async () => { releases++; } });
  t.after(() => configureProviderPolicy(undefined));
  const context = {
    ownerId: 'owner', signal: controller.signal, controller,
    assertAuthorized: async () => {
      if (streaming && ++validations === 2) throw Object.assign(new Error('Revoked'), { code: 'EXECUTION_REVOKED' });
    },
  };
  const client = wrapProvider({ models: { generateContentStream: async () => (async function* () {
    streaming = true; yield { text: 'Private' }; yield { text: 'Must not escape' }; yield { text: '' };
  })() } }, 'gemini');
  await executionContext.run(context, async () => {
    const iterator = await client.models.generateContentStream({ model: 'gemini-3.8-flash', config: { tools: [{ googleSearch: {} }] } }, { bufferGroundingPrelude: true });
    await assert.rejects(iterator.next(), { code: 'EXECUTION_REVOKED' });
  });
  assert.equal(controller.signal.aborted, true); assert.equal(releases, 1);
});

test('AiPolicy coalesces stream-chunk pause checks within maxStaleMs while keeping fresh kill-switch enforcement', async () => {
  let redisGets = 0;
  let paused = '0';
  const redis = {
    isReady: true,
    get: async key => {
      assert.equal(key, 'security:ai-paused');
      redisGets++;
      return paused;
    },
  };
  const policy = new AiPolicy({ redis, env: {} });
  await policy.assertEnabled();
  assert.equal(redisGets, 1);

  await Promise.all([
    policy.assertEnabled({ maxStaleMs: 1000 }),
    policy.assertEnabled({ maxStaleMs: 1000 }),
    policy.assertEnabled({ maxStaleMs: 1000 }),
  ]);
  assert.equal(redisGets, 1, 'stream-chunk checks inside maxStaleMs reuse fresh verification without per-chunk Redis RTT');

  paused = '1';
  await assert.rejects(() => policy.assertEnabled(), { code: 'EXECUTION_DISABLED' });
  assert.equal(redisGets, 2, 'fresh checks (maxStaleMs=0) always observe kill switch immediately');
});

test('wrapProvider parallel pre-flight cleanly refunds and releases reservation when authorization rejects', async t => {
  let refunded = 0, released = 0, calledProvider = false;
  configureProviderPolicy({
    assertEnabled: async () => {},
    reserveProvider: async () => {
      const release = async () => { released++; };
      release.refund = async () => { refunded++; };
      return release;
    },
  });
  t.after(() => configureProviderPolicy(undefined));

  const controller = new AbortController();
  const context = {
    ownerId: 'owner',
    signal: controller.signal,
    controller,
    assertAuthorized: async () => {
      throw Object.assign(new Error('Revoked'), { code: 'EXECUTION_REVOKED' });
    },
  };
  const client = wrapProvider({
    models: {
      generateContent: async () => {
        calledProvider = true;
        return { text: 'should not execute' };
      },
    },
  }, 'gemini');

  await executionContext.run(context, async () => {
    await assert.rejects(
      () => client.models.generateContent({ model: 'gemini-4-hydrogen', contents: 'hi', config: {} }),
      { code: 'EXECUTION_REVOKED' },
    );
  });
  assert.equal(calledProvider, false);
  assert.equal(refunded, 1);
  assert.equal(released, 1);
});

test('HelmerDecisionRouter uses 0 ms fast-path only for ungrounded pure greetings', async () => {
  let vertexCalls = 0;
  const router = createHelmerDecisionRouter({
    env: { GEMINI_API_KEY: 'AQ.vertex-express', GEMINI_USE_VERTEX: 'true' },
    hasDecisionApiConfigFn: () => false,
    getVertexClientFn: () => ({
      models: {
        generateContent: async () => {
          vertexCalls++;
          return {
            text: JSON.stringify({ s: true, r: false }),
          };
        },
      },
    }),
  });

  const greeting = await router.routeAsk({ prompt: 'Salam!' });
  assert.equal(greeting.routerSource, 'fast_path');
  assert.equal(greeting.enableSearch, false);
  assert.equal(greeting.latencyMs, 0);
  assert.equal(vertexCalls, 0);

  const afterGrounded = await router.routeAsk({
    prompt: 'Yaxşı',
    hasGroundedHistory: true,
  });
  assert.equal(vertexCalls, 1);
  assert.equal(afterGrounded.routerSource, 'vertex_flash_lite');

  const explicitSearch = await router.routeAsk({ prompt: 'Araşdır' });
  assert.equal(explicitSearch.routerSource, 'fast_path');
  assert.equal(explicitSearch.enableSearch, true);
  assert.equal(explicitSearch.latencyMs, 0);
  assert.equal(vertexCalls, 1);

  const groundedVerify = await router.routeAsk({
    prompt: 'Dəqiq?',
    hasGroundedHistory: true,
  });
  assert.equal(groundedVerify.routerSource, 'local_rules');
  assert.equal(groundedVerify.enableSearch, true);
  assert.equal(vertexCalls, 1);
});

test('FileUserRepository.findById isolates a single registered user, invalidates on update, and forwards raw/clone flags to cloud', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'helmer-user-latency-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const filePath = path.join(dir, 'users.json');
  const repo = new FileUserRepository(filePath, null, { cloud: false });

  const userA = await repo.create({
    email: 'registered.a@example.com',
    username: 'registered_a',
    passwordHash: 'hash_a',
    fullName: 'User A',
  });
  await repo.create({
    email: 'registered.b@example.com',
    username: 'registered_b',
    passwordHash: 'hash_b',
    fullName: 'User B',
  });

  const firstRead = await repo.findById(userA.id);
  const secondRead = await repo.findById(userA.id);
  assert.ok(firstRead && secondRead);
  assert.notEqual(firstRead, secondRead);
  firstRead.settings.displayName = 'Mutated Locally';
  assert.notEqual((await repo.findById(userA.id)).settings?.displayName, 'Mutated Locally');

  await repo.update(userA.id, { fullName: 'User A Updated' });
  const afterUpdate = await repo.findById(userA.id);
  assert.equal(afterUpdate.fullName, 'User A Updated');

  const cloudCalls = [];
  const rawStore = JSON.parse(await fs.readFile(filePath, 'utf8'));
  const cloudRepo = new FileUserRepository(filePath, null, {
    cloud: true,
    readCloud: async opts => {
      cloudCalls.push(opts);
      return { record: rawStore, etag: '"etag-1"', notFound: false, isCloud: true };
    },
  });
  const cloudUser = await cloudRepo.findById(userA.id);
  assert.equal(cloudUser.fullName, 'User A Updated');
  const rawStoreView = await cloudRepo.readStore({ force: true, clone: false, raw: true });
  assert.equal(cloudRepo.extractUserById(rawStoreView, userA.id).fullName, 'User A Updated');
  assert.deepEqual(cloudCalls, [
    { force: true, clone: false },
    { force: true, clone: false },
  ]);
});

test('FilePlannerRepository.getById enforces tenant isolation and coalesces cloud reads with clone: false', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'helmer-planner-latency-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const ownerA = randomUUID(), ownerB = randomUUID();
  const repo = new FilePlannerRepository(dir, null, { cloud: false });

  const [taskA] = await repo.addBatch(ownerA, [{ text: 'Registered owner task' }]);
  assert.equal((await repo.getById(taskA.id, ownerA))?.text, 'Registered owner task');
  assert.equal(await repo.getById(taskA.id, ownerB), null);
  assert.equal(await repo.getById(randomUUID(), ownerA), null);

  let cloudReads = 0;
  const seenOptions = [];
  const cloudRepo = new FilePlannerRepository(dir, null, {
    cloud: true,
    readCloud: async (_ownerId, opts) => {
      cloudReads++;
      seenOptions.push(opts);
      await new Promise(resolve => setTimeout(resolve, 15));
      return { record: [taskA], etag: '"planner-etag-1"', notFound: false, isCloud: true };
    },
  });

  const [r1, r2] = await Promise.all([
    cloudRepo.getById(taskA.id, ownerA),
    cloudRepo.getById(taskA.id, ownerA),
  ]);
  assert.equal(cloudReads, 1);
  assert.equal(seenOptions[0].clone, false);
  assert.notEqual(r1, r2);
  assert.equal(r1.text, 'Registered owner task');
});

test('PrivacyPolicy.assertExecution caches remote auth checks within maxStaleMs while maxStaleMs: 0 runs fresh with force: true', async () => {
  const user = { id: 'owner-cache-test', status: 'active', authVersion: 1, privacyEpoch: 0 };
  const findCalls = [];
  const policy = new PrivacyPolicy({
    cloud: true,
    findById: async (ownerId, opts) => {
      findCalls.push({ ownerId, opts });
      return user;
    },
  });
  const context = {
    ownerId: user.id,
    guest: false,
    privacySnapshot: privacySnapshot(user),
  };

  await policy.assertExecution(context, { maxStaleMs: 2500 });
  assert.equal(findCalls.length, 1);
  assert.equal(findCalls[0].opts.force, false);

  await policy.assertExecution(context, { maxStaleMs: 2500 });
  assert.equal(findCalls.length, 1, 'cached remote authorization within maxStaleMs must skip duplicate R2 read');

  await policy.assertExecution(context);
  assert.equal(findCalls.length, 2, 'default maxStaleMs=0 must run fresh authorization');
  assert.equal(findCalls[1].opts.force, true);
});

test('AiPolicy atomic shared-Ask admission collapses pause, idempotency, rate limit, and lease into 1 Redis RTT and skips duplicate finish write', async () => {
  class AtomicRedis {
    isReady = true;
    supportsAtomicLua = true;
    evalCalls = [];
    values = new Map();
    zsets = new Map();
    paused = '0';
    ownerLock = null;
    now = 1000000;
    async get(key) {
      if (key === 'security:ai-paused') return this.paused === '1' ? '1' : null;
      return this.values.get(key) || null;
    }
    async set(key, value) { this.values.set(key, value); return 'OK'; }
    async eval(script, { keys, arguments: args = [] }) {
      this.evalCalls.push({ keys, args, script });
      if (script.includes("return {'PAUSED'}")) {
        if (this.paused === '1') return ['PAUSED'];
        const existing = this.values.get(keys[1]);
        if (existing) return ['EXISTS', existing];
        const windowMs = Number(args[2]);
        let retry = 0;
        for (let i = 0; i < 2; i++) {
          const rk = keys[i + 2];
          const entries = (this.zsets.get(rk) || []).filter((s) => s > this.now - windowMs);
          this.zsets.set(rk, entries);
          if (entries.length >= Number(args[i + 3])) {
            retry = Math.max(retry, entries[0] + windowMs - this.now);
          }
        }
        if (retry > 0) return ['RATE_LIMITED', String(Math.ceil(retry / 1000))];
        const owner = this.values.get(keys[4]) ?? this.ownerLock;
        if (owner && owner !== args[5]) return ['BUSY'];
        this.values.set(keys[1], args[0]);
        for (let i = 2; i <= 3; i++) {
          const entries = this.zsets.get(keys[i]) || [];
          entries.push(this.now);
          this.zsets.set(keys[i], entries);
        }
        const leases = this.values.get(keys[5]) || new Map();
        leases.set(args[1], this.now + Number(args[6]));
        this.values.set(keys[5], leases);
        this.values.set(keys[4], args[5]);
        return ['OK'];
      }
      if (script.includes("redis.call('zrem', KEYS[2]")) {
        const leases = this.values.get(keys[1]) || new Map();
        leases.delete(args[1]);
        if (!leases.size) { this.values.delete(keys[0]); this.values.delete(keys[1]); }
        return 1;
      }
      if (script.includes("redis.call('set',KEYS[1],ARGV[2]")) {
        if (this.values.get(keys[0]) !== args[0]) return 0;
        this.values.set(keys[0], args[1]);
        return 1;
      }
      return 1;
    }
  }

  const redis = new AtomicRedis();
  const policy = new AiPolicy({ redis, env: {}, allowParallelAskChats: true });
  const mw = policy.middleware();
  const makeReqRes = (key = randomUUID(), body = { messages: [{ role: 'user', content: 'Hi' }] }) => {
    const req = {
      method: 'POST', path: '/api/ask', ownerId: 'owner-atomic-1', ip: '127.0.0.1',
      user: { id: 'owner-atomic-1', emailVerifiedAt: 'now', status: 'active' },
      body, securityContext: {},
      get: (h) => (h.toLowerCase() === 'idempotency-key' ? key : ''),
    };
    const headers = {};
    const res = Object.assign(new EventEmitter(), {
      statusCode: 200,
      headers,
      setHeader(k, v) { headers[k.toLowerCase()] = v; },
      status(c) { this.statusCode = c; return this; },
      json(b) { this.body = b; this.writableEnded = true; this.emit('finish'); return this; },
    });
    return { req, res };
  };

  // 1. OK path consumes exactly 1 eval before next()
  const okKey = randomUUID();
  const { req: req1, res: res1 } = makeReqRes(okKey);
  let enteredNext = false;
  await mw(req1, res1, () => { enteredNext = true; });
  assert.equal(enteredNext, true);
  assert.equal(redis.evalCalls.length, 1);

  const release1 = req1.securityContext.enableAskBackgroundCompletion(5000);
  req1.securityContext.recordIdempotentResult(200, { chatId: 'c1', ok: true });
  await req1.securityContext.persistIdempotentResult();
  const callsAfterPersist = redis.evalCalls.length;
  await release1();
  // finish() released sharedAskLease without issuing a duplicate requestKey overwrite!
  assert.equal(redis.evalCalls.length, callsAfterPersist + 1);
  assert.ok(!redis.evalCalls.at(-1).script.includes("redis.call('set',KEYS[1],ARGV[2]"));

  // 2. EXISTS replay vs IDEMPOTENCY_CONFLICT
  const { req: replayReq, res: replayRes } = makeReqRes(okKey);
  await mw(replayReq, replayRes, () => assert.fail('Replay must not enter handler'));
  assert.equal(replayRes.statusCode, 200);
  assert.equal(replayRes.body.chatId, 'c1');

  const { req: conflictReq, res: conflictRes } = makeReqRes(okKey, { messages: [{ role: 'user', content: 'Changed' }] });
  await mw(conflictReq, conflictRes, () => assert.fail('Conflict must not enter handler'));
  assert.equal(conflictRes.statusCode, 409);
  assert.equal(conflictRes.body.code, 'IDEMPOTENCY_CONFLICT');

  // 3. PAUSED
  redis.paused = '1';
  const { req: pausedReq, res: pausedRes } = makeReqRes();
  await mw(pausedReq, pausedRes, () => assert.fail('Paused must block'));
  assert.equal(pausedRes.statusCode, 503);
  assert.equal(pausedRes.body.code, 'EXECUTION_DISABLED');
  redis.paused = '0';

  // 4. BUSY
  redis.ownerLock = 'other-exclusive-lock';
  const { req: busyReq, res: busyRes } = makeReqRes();
  await mw(busyReq, busyRes, () => assert.fail('Busy lock must block'));
  assert.equal(busyRes.statusCode, 429);
  assert.equal(busyRes.body.code, 'EXECUTION_BUSY');
  redis.ownerLock = null;

  // 5. RATE_LIMITED (populate zset to 15)
  redis.zsets.set('security:ask-minute:owner-atomic-1', Array(15).fill(redis.now));
  const { req: rlReq, res: rlRes } = makeReqRes();
  await mw(rlReq, rlRes, () => assert.fail('Rate limit must block'));
  assert.equal(rlRes.statusCode, 429);
  assert.equal(rlRes.body.code, 'RATE_LIMITED');
  assert.ok(Number(rlRes.headers['retry-after']) >= 1);
});

test('Ask handler runs registerRun and DecisionRouter.routeAsk in parallel and aborts routeAsk on alreadyCancelled', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'helmer-parallel-route-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const ownerId = randomUUID();
  const strategyId = randomUUID();
  const regGate = deferred();
  t.after(() => regGate.resolve());
  const events = [];
  let routeSignalAborted = false;

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.ownerId = ownerId;
    req.user = { id: ownerId, emailVerifiedAt: 'now', status: 'active' };
    req.auth = { user: req.user, sessionId: 's1' };
    req.securityContext = { ownerId, assertAuthorized: async () => {} };
    executionContext.run(req.securityContext, next);
  });
  app.post('/api/ask', createAskHandler({
    configured: () => true,
    chatRepository: new FileChatRepository(path.join(dir, 'chats'), null, { cloud: false }),
    strategyRepository: {
      async getById(id, reqOwner) {
        if (id === strategyId && reqOwner === ownerId) {
          return { id: strategyId, ownerId, title: 'S1', strategy: { summary: 'Strategy context' } };
        }
        return null;
      },
    },
    plannerRepository: null,
    researchService: {},
    askRunManager: {
      async registerRun() {
        events.push('registerRun:start');
        await regGate.promise;
        events.push('registerRun:done');
        return {
          alreadyCancelled: true,
          checkCancelled: async () => true,
          finish: async () => {},
        };
      },
    },
    decisionRouter: {
      async routeAsk({ signal }) {
        events.push('routeAsk:start');
        signal?.addEventListener('abort', () => { routeSignalAborted = true; }, { once: true });
        await new Promise((resolve) => setTimeout(resolve, 40));
        return { enableSearch: false, requireGrounding: false, routerSource: 'decisions_api', latencyMs: 40 };
      },
    },
    learningLoop: { createInteractionId: randomUUID, recordInteraction: async () => {}, recordSignal: async () => {} },
    telemetryService: { trackAskQuery: async () => {} },
    sanitizeGroundingMetadata: (x) => x,
    generateAsk: async () => ({ text: 'Should not run', provider: 'google', model: 'm' }),
  }));

  const base = await listen(t, app);

  const reqPromise = fetch(`${base}/api/ask`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'Idempotency-Key': randomUUID() },
    body: JSON.stringify({ strategyId, messages: [{ role: 'user', content: 'Analyze strategy' }] }),
  });

  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.ok(events.includes('registerRun:start'));
  assert.ok(events.includes('routeAsk:start'), 'routeAsk must start immediately in parallel before registerRun resolves');
  regGate.resolve();

  const res = await reqPromise;
  await res.text();
  assert.equal(routeSignalAborted, true, 'alreadyCancelled must abort in-flight routeAsk signal');
  assert.ok(res.status >= 400);
});

test('Ask handler overlaps saveChat cloud commit with persistIdempotentResult via onCommitted while blocking done until both succeed', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'helmer-commit-overlap-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const ownerId = randomUUID();
  const chatRepo = new FileChatRepository(path.join(dir, 'chats'), null, { cloud: false });
  const order = [];
  const persistGate = deferred();
  const persistedCalled = deferred();
  t.after(() => persistGate.resolve());
  let shouldFailPersist = false;

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.ownerId = ownerId;
    req.user = { id: ownerId, emailVerifiedAt: 'now', status: 'active' };
    req.auth = { user: req.user, sessionId: 's1' };
    req.securityContext = {
      ownerId,
      assertAuthorized: async () => {},
      recordIdempotentResult(status, body) {
        order.push(`record:${status}:${body.chat?.id}`);
      },
      async persistIdempotentResult() {
        order.push('persist:start');
        persistedCalled.resolve();
        await persistGate.promise;
        if (shouldFailPersist) {
          throw Object.assign(new Error('EXECUTION_UNAVAILABLE'), { code: 'EXECUTION_UNAVAILABLE', status: 503 });
        }
        order.push('persist:done');
      },
    };
    executionContext.run(req.securityContext, next);
  });
  app.post('/api/ask', createAskHandler({
    configured: () => true,
    chatRepository: chatRepo,
    strategyRepository: null,
    plannerRepository: null,
    researchService: {},
    decisionRouter: {
      async routeAsk() { return { enableSearch: false, requireGrounding: false, routerSource: 'decisions_api', latencyMs: 1 }; },
    },
    learningLoop: { createInteractionId: randomUUID, recordInteraction: async () => {}, recordSignal: async () => {} },
    telemetryService: { trackAskQuery: async () => {} },
    sanitizeGroundingMetadata: (x) => x,
    generateAsk: async ({ onChunk }) => {
      await onChunk?.('Hello ');
      return { text: 'Hello world', provider: 'google', model: 'm' };
    },
  }));

  const base = await listen(t, app);

  const res = await fetch(`${base}/api/ask`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', 'Idempotency-Key': randomUUID() },
    body: JSON.stringify({ messages: [{ role: 'user', content: 'Hello strategy' }], stream: true }),
  });
  assert.equal(res.status, 200);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let sseText = '';
  const first = await reader.read();
  sseText += decoder.decode(first.value, { stream: true });
  await Promise.race([
    persistedCalled.promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`persistIdempotentResult was not reached; sseText=${sseText}`)), 3000)),
  ]);
  assert.ok(!sseText.includes('"done":true'), 'done SSE event must wait for persistIdempotentResult');

  persistGate.resolve();
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    sseText += decoder.decode(next.value, { stream: true });
  }
  reader.releaseLock();
  assert.ok(sseText.includes('"done":true'));
  assert.equal(order.filter((x) => x === 'persist:start').length, 1, 'persistIdempotentResult must run exactly once');
  assert.equal(order.at(-1), 'persist:done');

  // Verify post-commit replay-store failure still keeps saved chat on disk and never emits done
  shouldFailPersist = true;
  const failRes = await fetch(`${base}/api/ask`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', 'Idempotency-Key': randomUUID() },
    body: JSON.stringify({ messages: [{ role: 'user', content: 'Hello failure path' }], stream: true }),
  });
  const failText = await failRes.text();
  assert.ok(!failText.includes('"done":true'), 'done must never be emitted when persistIdempotentResult rejects');
  assert.ok(failText.includes('"code":"EXECUTION_UNAVAILABLE"'));
  assert.equal((await chatRepo.list(ownerId)).length, 2, 'committed chat must remain saved on disk');
});
