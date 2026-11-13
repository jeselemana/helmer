import test from 'node:test';
import assert from 'node:assert/strict';
import { PrivacyPolicy, privacySnapshot, executionContext } from '../src/services/security/privacy-policy.js';
import { configureProviderPolicy, wrapProvider } from '../src/services/security/provider-policy.js';
import { AiPolicy } from '../src/services/security/ai-policy.js';
import { createHelmerDecisionRouter } from '../src/services/ai/decision-router.js';

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
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
