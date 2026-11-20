import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import express from 'express';

import { createAskTransport, publicAskErrorMessage } from '../src/http/ask-transport.js';
import { createAskHandler } from '../src/http/ask-handler.js';
import { createGoogleGroundedAskService as createAskService } from './helpers/legacy-google-grounded-ask.js';
import { createAskConfig } from '../src/services/ai/ask-config.js';
import { aiConfig } from '../src/services/ai/config.js';
import { createAskRunManager } from '../src/services/ai/ask-run-manager.js';
import { sanitizeAskGroundingMetadata } from '../src/services/ai/ask-grounding.js';
import { FileChatRepository } from '../src/repositories/file-chat-repository.js';
import { PrivacyPolicy, executionContext } from '../src/services/security/privacy-policy.js';
import { AiPolicy } from '../src/services/security/ai-policy.js';
import { configureProviderPolicy } from '../src/services/security/provider-policy.js';

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const sseEvents = (text) =>
  text
    .split(/\r?\n\r?\n/)
    .filter((block) => block.startsWith('data: '))
    .map((block) => JSON.parse(block.slice(6)));

test('createAskTransport emits immediate keepalive on start() and maps ASK_EMPTY_RESPONSE', (t) => {
  const req = new EventEmitter();
  req.complete = true;
  const frames = [];
  const res = Object.assign(new EventEmitter(), {
    headers: {},
    writableEnded: false,
    destroyed: false,
    writableNeedDrain: false,
    writableLength: 0,
    setHeader(k, v) { this.headers[k] = v; },
    flushHeaders() { frames.push('HEADERS'); },
    write(chunk) { frames.push(chunk); },
    end(chunk) { if (chunk) frames.push(chunk); this.writableEnded = true; this.emit('finish'); },
  });
  const transport = createAskTransport(req, res, { requestTimeoutMs: 5000 });
  t.after(() => transport.dispose());

  transport.start();
  assert.equal(frames[0], 'HEADERS');
  assert.equal(frames[1], ': keepalive\n\n');
  assert.equal(publicAskErrorMessage('ASK_EMPTY_RESPONSE'), 'Model cavab qaytarmadı. Yenidən cəhd edin.');
});

test('Ask handler flushes SSE headers and keepalive before slow personalizationContext resolves while keeping 422 JSON', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'helmer-defer-pers-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));

  const ownerId = randomUUID();
  const strategyId = randomUUID();
  const persGate = deferred();
  t.after(() => persGate.resolve());

  const chatRepo = new FileChatRepository(path.join(dir, 'chats'), null, { cloud: false });
  const originalReadAll = chatRepo.readAll.bind(chatRepo);
  let persStarted = false;
  chatRepo.readAll = async (owner) => {
    persStarted = true;
    await persGate.promise;
    return originalReadAll(owner);
  };

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.ownerId = ownerId;
    req.user = {
      id: ownerId,
      emailVerifiedAt: 'now',
      status: 'active',
      settings: { personalIntelligence: true, modelImprovement: true },
    };
    req.auth = { user: req.user };
    req.securityContext = { ownerId, assertAuthorized: async () => {} };
    executionContext.run(req.securityContext, next);
  });
  app.post('/api/ask', createAskHandler({
    configured: () => true,
    chatRepository: chatRepo,
    strategyRepository: {
      getById: async (id, owner) => (
        id === strategyId && owner === ownerId
          ? { id, ownerId, title: 'Grounded S', strategy: { orchestration: { searchGrounded: true } } }
          : null
      ),
      readAll: async () => [],
    },
    plannerRepository: null,
    researchService: {},
    decisionRouter: {
      async routeAsk() { return { enableSearch: false, requireGrounding: false, routerSource: 'fast_path' }; },
    },
    learningLoop: { createInteractionId: randomUUID, recordInteraction: async () => {}, recordSignal: async () => {} },
    telemetryService: { trackAskQuery: async () => {} },
    sanitizeGroundingMetadata: sanitizeAskGroundingMetadata,
    generateAsk: async ({ personalizationContext }) => ({
      text: `Done:${personalizationContext ? 'P' : 'N'}`,
      model: 'gemini-4-hydrogen',
      provider: 'google',
    }),
  }));

  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  // 1. Grounded strategy still returns 422 JSON synchronously without starting SSE
  const groundedRes = await fetch(`${baseUrl}/api/ask`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() },
    body: JSON.stringify({ stream: true, strategyId, messages: [{ role: 'user', content: 'Analyze' }] }),
  });
  assert.equal(groundedRes.status, 422);
  assert.equal((await groundedRes.json()).code, 'GROUNDED_STRATEGY_RESTRICTED');

  // 2. Normal personalized SSE flushes headers + : keepalive BEFORE personalization finishes
  const resPromise = fetch(`${baseUrl}/api/ask`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', 'Idempotency-Key': randomUUID() },
    body: JSON.stringify({ stream: true, messages: [{ role: 'user', content: 'Salam' }] }),
  });

  for (let i = 0; i < 40 && !persStarted; i++) await delay(10);
  assert.equal(persStarted, true);

  const sseRes = await Promise.race([
    resPromise,
    delay(1500).then(() => { throw new Error('SSE headers blocked on personalizationContext'); }),
  ]);
  assert.equal(sseRes.status, 200);
  assert.match(sseRes.headers.get('content-type') || '', /text\/event-stream/);
  assert.ok(sseRes.headers.get('X-Helmer-Ask-Run-Id'));
  assert.ok(sseRes.headers.get('X-Helmer-Ask-Chat-Id'));

  const reader = sseRes.body.getReader();
  const firstChunk = await reader.read();
  const firstText = new TextDecoder().decode(firstChunk.value || new Uint8Array());
  assert.ok(firstText.includes(': keepalive'), 'Immediate keepalive must arrive while personalization is pending');

  persGate.resolve();
  let restText = firstText;
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    restText += new TextDecoder().decode(next.value, { stream: true });
  }
  reader.releaseLock();
  const events = sseEvents(restText);
  assert.equal(events.at(-1).done, true);
});

test('AskRunManager uses hash-tagged non-empty Redis Lua keys, falls back on Lua failure, and isolates failed run errors', async (t) => {
  const evalCalls = [];
  const store = new Map();
  let throwLua = false;

  const redis = {
    isReady: true,
    supportsAtomicLua: true,
    async get(key) { return store.get(key) || null; },
    async set(key, value) { store.set(key, value); return 'OK'; },
    async del(key) { return store.delete(key) ? 1 : 0; },
    async eval(script, { keys, arguments: args }) {
      evalCalls.push({ keys, args, script });
      if (throwLua) throw Object.assign(new Error('CROSSSLOT mock'), { code: 'CROSSSLOT' });
      if (keys.some((k) => !k)) throw new Error('Empty key passed to Redis eval');
      if (script.includes('local exactCount = tonumber(ARGV[4])')) {
        const exactCount = Number(args[3]);
        const chatCount = Number(args[4]);
        const writeCount = Number(args[5]);
        const clearCount = Number(args[6]);
        let idx = 0;
        for (let i = 0; i < exactCount; i++) if (store.has(keys[idx++])) return 0;
        for (let i = 0; i < chatCount; i++) idx++;
        for (let i = 0; i < writeCount; i++) store.set(keys[idx++], args[1]);
        for (let i = 0; i < clearCount; i++) store.delete(keys[idx++]);
        return 1;
      }
      if (script.includes("redis.call('del'")) {
        if (store.get(keys[0]) !== args[0]) return 0;
        store.delete(keys[0]);
        return 1;
      }
      return 1;
    },
  };

  const manager = createAskRunManager({ redis, cancelPollIntervalMs: 0 });
  t.after(() => manager.dispose());

  const ownerA = randomUUID();
  const ownerB = randomUUID();
  const chatId = randomUUID();
  const run1 = randomUUID();

  // 1. Verify hash-tag and zero empty keys in Lua registration
  const h1 = await manager.registerRun({ runId: run1, ownerId: ownerA, chatId, prompt: 'First prompt' });
  assert.equal(h1.alreadyCancelled, false);
  const regKeys = evalCalls[0].keys;
  assert.ok([...store.values()].every(value => !String(value).includes('First prompt')));
  assert.ok(regKeys.every((k) => typeof k === 'string' && k.length > 0));
  assert.ok(regKeys.every((k) => k.startsWith(`{helmer:ask:${ownerA}}:`)));

  // 2. Finish with error -> visible only to ownerA, cleared on next run
  await h1.finish({ error: { code: 'ASK_PROVIDER_TIMEOUT', error: 'Cavab üçün gözləmə müddəti bitdi.' } });
  const errA = await manager.getLastRunErrorForChat(ownerA, chatId);
  assert.equal(errA?.status, 'failed');
  assert.equal(errA?.code, 'ASK_PROVIDER_TIMEOUT');
  assert.equal(errA?.promptPreview, '');
  assert.equal(errA?.ownerId, undefined, 'ownerId must not leak');
  assert.equal(await manager.getLastRunErrorForChat(ownerB, chatId), null);

  // 2b. Another replica deletes failed-chat from Redis -> local replica cache is evicted on read
  store.delete(`{helmer:ask:${ownerA}}:failed-chat:${chatId}`);
  assert.equal(await manager.getLastRunErrorForChat(ownerA, chatId), null);
  // Restore Redis failed-chat key so step 3 still exercises clearing previous failure
  store.set(`{helmer:ask:${ownerA}}:failed-chat:${chatId}`, JSON.stringify({
    runId: run1, ownerId: ownerA, chatId, status: 'failed', code: 'ASK_PROVIDER_TIMEOUT', error: 'Test', promptPreview: 'First prompt',
  }));
  assert.equal((await manager.getLastRunErrorForChat(ownerA, chatId)).promptPreview, '');

  // 3. Lua throw falls back to individual Redis writes and clears previous failure
  throwLua = true;
  const run2 = randomUUID();
  const h2 = await manager.registerRun({ runId: run2, ownerId: ownerA, chatId, idempotencyKey: 'idem_key_1234567890', prompt: 'Retry prompt' });
  assert.equal(h2.alreadyCancelled, false);
  assert.equal(await manager.getLastRunErrorForChat(ownerA, chatId), null);
  const activeRun = await manager.getActiveRunForChat(ownerA, chatId);
  assert.equal(activeRun?.runId, run2);
  await h2.finish();
});

test('Ask handler regenerateFromIndex replaces old assistant turn without duplicating user prompt and validates index', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'helmer-regen-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));

  const ownerId = randomUUID();
  const chatRepo = new FileChatRepository(path.join(dir, 'chats'), null, { cloud: false });
  const seeded = await chatRepo.saveChat({
    ownerId,
    messages: [
      { role: 'user', content: 'Sual 1' },
      { role: 'assistant', content: 'Köhnə cavab 1' },
    ],
  });

  const capturedMessages = [];
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.ownerId = ownerId;
    req.user = { id: ownerId, emailVerifiedAt: 'now', status: 'active' };
    req.auth = { user: req.user };
    req.securityContext = { ownerId, assertAuthorized: async () => {} };
    executionContext.run(req.securityContext, next);
  });
  app.post('/api/ask', createAskHandler({
    configured: () => true,
    chatRepository: chatRepo,
    strategyRepository: null,
    plannerRepository: null,
    researchService: {},
    decisionRouter: { async routeAsk() { return { enableSearch: false, requireGrounding: false, routerSource: 'fast_path' }; } },
    learningLoop: { createInteractionId: randomUUID, recordInteraction: async () => {}, recordSignal: async () => {} },
    telemetryService: { trackAskQuery: async () => {} },
    sanitizeGroundingMetadata: sanitizeAskGroundingMetadata,
    generateAsk: async ({ messages }) => {
      capturedMessages.push(messages.map((m) => ({ role: m.role, content: m.content })));
      return { text: 'Dərin cavab 1', model: 'gemini-4-hydrogen', provider: 'google' };
    },
  }));

  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  const url = `http://127.0.0.1:${server.address().port}/api/ask`;

  // Invalid index (pointing to user turn 0) -> 400 VALIDATION_ERROR
  const badRes = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() },
    body: JSON.stringify({
      chatId: seeded.id,
      chatRevision: seeded.revision,
      regenerateFromIndex: 0,
      messages: [{ role: 'user', content: 'Sual 1' }],
    }),
  });
  assert.equal(badRes.status, 400);

  // Valid regenerateFromIndex: 1 -> replaces assistant at index 1 without duplicating user message
  const okRes = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() },
    body: JSON.stringify({
      chatId: seeded.id,
      chatRevision: seeded.revision,
      regenerateFromIndex: 1,
      thinkingLevel: 'high',
      messages: [{ role: 'user', content: 'Sual 1' }],
    }),
  });
  assert.equal(okRes.status, 200);
  const body = await okRes.json();
  assert.deepEqual(capturedMessages[0], [{ role: 'user', content: 'Sual 1' }]);
  assert.equal(body.chat.messages.length, 2);
  assert.equal(body.chat.messages[0].content, 'Sual 1');
  assert.equal(body.chat.messages[1].content, 'Dərin cavab 1');
});

test('Ask service uses 28s searchTimeoutMs, resets timer on groundingSupports, and handles abnormal finishReasons', async () => {
  assert.equal(createAskConfig({}).searchTimeoutMs, 28000);
  assert.equal(aiConfig.askSearchTimeoutMs, 28000);

  // 1. groundingSupports resets searchTimeoutMs -> idleTimeoutMs
  const shortLimits = { ...createAskConfig({}), searchTimeoutMs: 40, firstEventTimeoutMs: 40, idleTimeoutMs: 140 };
  const supportsClient = {
    models: {
      generateContentStream: async () => (async function* () {
        yield {
          candidates: [{
            groundingMetadata: {
              groundingSupports: [{ segment: { text: 'fact' }, groundingChunkIndices: [0] }],
            },
          }],
        };
        await delay(70);
        yield { text: 'Tamamlandı.' };
      })(),
    },
  };
  const supportsResult = await createAskService({ getClient: () => supportsClient, limits: shortLimits })({
    messages: [{ role: 'user', content: 'Test' }],
    enableSearch: true,
    onChunk: async () => {},
  });
  assert.equal(supportsResult.text, 'Tamamlandı.');

  // 2. Abnormal finishReasons mark partial text truncated and empty text as ASK_EMPTY_RESPONSE
  for (const reason of ['OTHER', 'MALFORMED_FUNCTION_CALL', 'UNEXPECTED_TOOL_CALL', 'LANGUAGE']) {
    const partialClient = {
      models: {
        generateContent: async () => ({ text: 'Yarımçıq mətn', candidates: [{ finishReason: reason }] }),
      },
    };
    const res = await createAskService({ getClient: () => partialClient })({
      messages: [{ role: 'user', content: 'Test' }],
    });
    assert.equal(res.truncated, true);
    assert.equal(res.finishReason, reason);

    const emptyClient = {
      models: {
        generateContent: async () => ({ text: '', candidates: [{ finishReason: reason }] }),
      },
    };
    await assert.rejects(
      () => createAskService({ getClient: () => emptyClient })({ messages: [{ role: 'user', content: 'Test' }] }),
      (err) => err?.code === 'ASK_EMPTY_RESPONSE'
    );
  }
});

test('Guest DecisionRouter prefetch runs for allowed guest Ask and skips restricted guest Ask', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'helmer-guest-prefetch-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));

  const chatRepo = new FileChatRepository(path.join(dir, 'chats'), null, { cloud: false });
  const routedPrompts = [];
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.ownerId = 'guest_prefetch_1';
    req.user = null;
    req.securityContext = { ownerId: req.ownerId, guest: true, assertAuthorized: async () => {}, reserveGuestAsk: async () => ({ remaining: 3 }) };
    executionContext.run(req.securityContext, next);
  });
  app.post('/api/ask', createAskHandler({
    configured: () => true,
    chatRepository: chatRepo,
    strategyRepository: null,
    plannerRepository: null,
    researchService: {},
    decisionRouter: {
      async routeAsk({ prompt }) {
        routedPrompts.push(prompt);
        return { enableSearch: false, requireGrounding: false, routerSource: 'fast_path' };
      },
    },
    learningLoop: { createInteractionId: randomUUID, recordInteraction: async () => {}, recordSignal: async () => {} },
    telemetryService: { trackAskQuery: async () => {} },
    sanitizeGroundingMetadata: sanitizeAskGroundingMetadata,
    generateAsk: async () => ({ text: 'Qonaq cavabı', model: 'gemini-4-hydrogen', provider: 'google' }),
  }));

  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  const url = `http://127.0.0.1:${server.address().port}/api/ask`;

  // Restricted guest (thinkingLevel: high) -> skips DecisionRouter
  const restrictedRes = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() },
    body: JSON.stringify({ thinkingLevel: 'high', messages: [{ role: 'user', content: 'Blocked prompt' }] }),
  });
  assert.equal(restrictedRes.status, 200);
  const restrictedJson = await restrictedRes.json();
  assert.equal(restrictedJson.restrictedFeature, true);
  assert.equal(routedPrompts.length, 0);

  // Allowed guest -> triggers DecisionRouter prefetch
  const allowedRes = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() },
    body: JSON.stringify({ messages: [{ role: 'user', content: 'Allowed prompt' }] }),
  });
  assert.equal(allowedRes.status, 200);
  assert.deepEqual(routedPrompts, ['Allowed prompt']);
});

test('Frontend script.js recovers Safari Load failed, preserves error codes, and handles R2 lag & lastRunError in pollActiveAskRun', async () => {
  const source = await fs.readFile(new URL('../public/script.js', import.meta.url), 'utf8');

  // 1. consumeAskEventStream & isRecoverableAskNetworkError
  const helperStart = source.indexOf('function isRecoverableAskNetworkError(');
  const helperEnd = source.indexOf('// Keep identical retries', helperStart);
  const streamStart = source.indexOf('async function consumeAskEventStream(');
  const streamEnd = source.indexOf('async function submitAskMessage(', streamStart);
  const vmHelpers = vm.runInNewContext(
    `(() => { ${source.slice(helperStart, helperEnd)}\n${source.slice(streamStart, streamEnd)}\nreturn { isRecoverableAskNetworkError, consumeAskEventStream }; })()`,
    { TextDecoder, setTimeout, clearTimeout, getLanguage: () => 'en' }
  );

  assert.equal(vmHelpers.isRecoverableAskNetworkError(new TypeError('Load failed')), true);
  assert.equal(vmHelpers.isRecoverableAskNetworkError(new TypeError('Failed to fetch')), true);
  assert.equal(vmHelpers.isRecoverableAskNetworkError(Object.assign(new Error('x'), { code: 'EXECUTION_UNAVAILABLE' })), true);
  assert.equal(vmHelpers.isRecoverableAskNetworkError(Object.assign(new Error('x'), { isStreamInterrupted: true })), true);
  assert.equal(vmHelpers.isRecoverableAskNetworkError(Object.assign(new Error('Safety'), { code: 'AI_SAFETY_BLOCKED' })), false);

  const errReader = {
    chunks: [new TextEncoder().encode('data: {"error":"Unavailable","code":"EXECUTION_UNAVAILABLE"}\n\n')],
    async read() { return this.chunks.length ? { value: this.chunks.shift(), done: false } : { done: true }; },
    async cancel() {},
    releaseLock() {},
  };
  await assert.rejects(
    () => vmHelpers.consumeAskEventStream(errReader, async () => {}),
    (err) => err?.code === 'EXECUTION_UNAVAILABLE'
  );

  const truncReader = {
    chunks: [new TextEncoder().encode('data: {"chunk":"partial"}\n\n')],
    async read() { return this.chunks.length ? { value: this.chunks.shift(), done: false } : { done: true }; },
    async cancel() {},
    releaseLock() {},
  };
  await assert.rejects(
    () => vmHelpers.consumeAskEventStream(truncReader, async () => {}),
    (err) => err?.isStreamInterrupted === true
  );

  // 2. pollActiveAskRun preserves prompt on lastRunError and retries on R2 settle lag
  const pollStart = source.indexOf('async function pollActiveAskRun(');
  const pollEnd = source.indexOf('async function openSavedChat(', pollStart);
  const pollCode = source.slice(pollStart, pollEnd);

  const createPollHarness = (responses) => {
    const idx = { n: 0 };
    const state = {
      identityEpoch: 1,
      currentUser: { id: 'u1' },
      askChatId: 'c1',
      mode: 'ask',
      askLoading: true,
      askError: '',
      askRetry: null,
      askMessages: [{ role: 'user', content: 'Sualım' }, { role: 'assistant', content: '', isStreaming: true }],
    };
    let renders = 0;
    const context = {
      state,
      activeAskPollController: null,
      activeAskRunMeta: { chatId: 'c1', runId: 'r1' },
      stopAskRunPolling() { context.activeAskPollController?.abort?.(); context.activeAskPollController = null; },
      getLanguage: () => 'az',
      isIdentityStale: (e, u) => e !== state.identityEpoch || (state.currentUser?.id || null) !== u,
      api: async () => responses[Math.min(idx.n++, responses.length - 1)],
      rememberSavedAskChat() {},
      loadSavedChats: async () => {},
      render() { renders++; },
      scrollToLatestAskTurn() {},
      AbortController,
      setTimeout: (fn) => globalThis.setTimeout(fn, 1),
      clearTimeout: globalThis.clearTimeout,
    };
    const fn = vm.runInNewContext(`(${pollCode})`, context);
    return { fn, state, context, getRenders: () => renders };
  };

  // Case A: lastRunError returned -> preserves user prompt, sets askError and askRetry
  const failedHarness = createPollHarness([
    { activeRun: null, chat: null, lastRunError: { status: 'failed', code: 'ASK_TIMEOUT', error: 'Cavab üçün gözləmə müddəti bitdi.', promptPreview: 'Sualım' } },
  ]);
  await failedHarness.fn('c1', 'r1', 1, 'u1', { immediate: true, expectedMinMessages: 2, pendingPrompt: 'Sualım' });
  assert.equal(failedHarness.state.askLoading, false);
  assert.equal(failedHarness.state.askError, 'Cavab üçün gözləmə müddəti bitdi.');
  assert.equal(failedHarness.state.askMessages.length, 1);
  assert.equal(failedHarness.state.askMessages[0].content, 'Sualım');
  assert.equal(failedHarness.state.askRetry?.message, 'Sualım');
  assert.equal(failedHarness.state.askRetry?.operation, null);

  // Case B: R2 lag (first 2 polls return null, 3rd returns committed chat)
  const lagHarness = createPollHarness([
    { activeRun: null, chat: null, lastRunError: null },
    { activeRun: null, chat: null, lastRunError: null },
    { activeRun: null, chat: { id: 'c1', revision: 1, messages: [{ role: 'user', content: 'Sualım' }, { role: 'assistant', content: 'Hazır cavab' }] }, lastRunError: null },
  ]);
  await lagHarness.fn('c1', 'r1', 1, 'u1', { immediate: true, expectedMinMessages: 2, pendingPrompt: 'Sualım' });
  assert.equal(lagHarness.state.askLoading, false);
  assert.equal(lagHarness.state.askError, '');
  assert.equal(lagHarness.state.askMessages.length, 2);
  assert.equal(lagHarness.state.askMessages[1].content, 'Hazır cavab');

  // Case C: 120 activeRun attempts exhaust polling -> clears loading/run meta and surfaces timeout error
  const timeoutHarness = createPollHarness([
    { activeRun: { runId: 'r1', chatId: 'c1', status: 'running' }, chat: null, lastRunError: null },
  ]);
  await timeoutHarness.fn('c1', 'r1', 1, 'u1', { immediate: true, expectedMinMessages: 2, pendingPrompt: 'Sualım' });
  assert.equal(timeoutHarness.state.askLoading, false);
  assert.equal(timeoutHarness.context.activeAskRunMeta, null);
  assert.equal(timeoutHarness.context.activeAskPollController, null);
  assert.equal(timeoutHarness.state.askError, 'Cavabın tamamlanması gözləniləndən uzun çəkdi.');
  assert.equal(timeoutHarness.state.askMessages.length, 1);
  assert.equal(timeoutHarness.state.askMessages[0].content, 'Sualım');
  assert.equal(timeoutHarness.state.askRetry?.message, 'Sualım');
  assert.ok(timeoutHarness.getRenders() >= 1);

  // Ensure submitAskMessage & thinkDeeperWithHigh retain key guards
  assert.ok(source.includes('conflictData.code === "REQUEST_ALREADY_SUBMITTED"'));
  assert.ok(source.includes('isRecoverableAskNetworkError(error)'));
  assert.ok(source.includes('regenerateFromIndex: messageIndex'));
});
