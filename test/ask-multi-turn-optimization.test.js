import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import express from 'express';
import { JSDOM } from 'jsdom';
import { createAskHandler } from '../src/http/ask-handler.js';
import { createCapabilityRouter, askRequestSchema } from '../src/http/capability-router.js';
import { createAskExecutionGuard } from '../src/http/ask-execution-guard.js';
import { createGoogleGroundedAskService as createAskService } from './helpers/legacy-google-grounded-ask.js';
import { buildAskContents } from '../src/services/ai/ask-context.js';
import { createAskConfig } from '../src/services/ai/ask-config.js';
import { sanitizeAskGroundingMetadata } from '../src/services/ai/ask-grounding.js';
import { createAskRunManager } from '../src/services/ai/ask-run-manager.js';
import { geminiFileCache } from '../src/services/ai/gemini-file-cache.js';
import { HelmerDecisionRouter, DECISION_TIMEOUTS_MS, resolveDecisionTimeoutMs } from './helpers/legacy-decision-router.js';
import { createPluginRegistry } from '../src/services/plugins/registry.js';
import { AiPolicy, createReplayResourceCheck } from '../src/services/security/ai-policy.js';
import { PrivacyPolicy } from '../src/services/security/privacy-policy.js';
import { configureProviderPolicy, wrapProvider } from '../src/services/security/provider-policy.js';
import { FileChatRepository } from '../src/repositories/file-chat-repository.js';

const limits = createAskConfig({});
const scriptSource = await fs.readFile(new URL('../public/script.js', import.meta.url), 'utf8');
const extractSection = (startMarker, endMarker) => {
  const start = scriptSource.indexOf(startMarker);
  assert.ok(start >= 0, `Missing start marker: ${startMarker}`);
  const end = scriptSource.indexOf(endMarker, start);
  assert.ok(end > start, `Missing end marker: ${endMarker}`);
  return scriptSource.slice(start, end);
};

async function createHttpFixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'helmer-multiturn-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));

  const ownerId = randomUUID();
  const user = {
    id: ownerId,
    status: 'active',
    emailVerifiedAt: '2026-01-01T00:00:00.000Z',
    authVersion: 1,
    settings: { modelImprovement: false, personalIntelligence: false },
  };
  const chatRepository = new FileChatRepository(path.join(dir, 'chats.json'), null, { cloud: false });
  const calls = [];
  const policy = new AiPolicy({
    redis: null,
    allowParallelAskChats: false,
    env: {},
    canReplay: createReplayResourceCheck({ chatRepository }),
  });
  configureProviderPolicy({
    assertEnabled: () => policy.assertEnabled(),
    reserveProvider: async (context, params) => policy.reserveProvider(context, params),
  });
  t.after(() => configureProviderPolicy(undefined));

  const client = wrapProvider({
    models: {
      generateContent: async (params) => {
        calls.push(params);
        return { text: 'Cavab hazırdır.', candidates: [{}] };
      },
      generateContentStream: async (params) => {
        calls.push(params);
        return (async function* () {
          yield { text: 'Cavab hazırdır.', candidates: [{}] };
        })();
      },
    },
  }, 'gemini');

  const askRunManager = createAskRunManager({ redis: null, cancelPollIntervalMs: 30 });
  t.after(() => askRunManager.dispose());

  const app = express();
  app.use(express.json({ limit: '25mb' }));
  app.use((req, _res, next) => {
    req.ownerId = ownerId;
    req.user = user;
    req.auth = { user };
    next();
  });
  app.use(new PrivacyPolicy({ findById: async (id) => (id === ownerId ? user : null) }).middleware());
  app.use(policy.middleware());

  const guard = createAskExecutionGuard({ redis: null, allowGuest: true, allowParallelChats: false });
  app.use('/api/ask', guard, createCapabilityRouter({
    allowGuestChat: true,
    registry: createPluginRegistry(),
    chats: chatRepository,
    artifacts: { get: async () => null },
    strategies: { getById: async () => null },
    planner: { list: async () => [] },
  }));
  app.post('/api/ask', createAskHandler({
    configured: () => true,
    chatRepository,
    strategyRepository: { getById: async () => null },
    plannerRepository: { list: async () => [] },
    researchService: {},
    limits,
    learningLoop: { createInteractionId: randomUUID, recordInteraction: async () => {}, recordSignal: async () => {} },
    telemetryService: { trackAskQuery: async () => {} },
    sanitizeGroundingMetadata: sanitizeAskGroundingMetadata,
    generateAsk: createAskService({ getClient: () => client }),
    askRunManager,
  }));

  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));

  return {
    ownerId,
    chatRepository,
    calls,
    url: `http://127.0.0.1:${server.address().port}/api/ask`,
  };
}

test('1. Delta payload supports 1-message continuation and regeneration on 210-message chats while keeping .max(200)', async (t) => {
  const tooMany = Array.from({ length: 201 }, (_, i) => ({
    role: i % 2 === 0 ? 'user' : 'assistant',
    content: `Mesaj ${i}`,
  }));
  assert.equal(askRequestSchema.safeParse({ messages: tooMany }).success, false);
  const deltaSchemaOk = askRequestSchema.safeParse({
    chatId: randomUUID(),
    chatRevision: 5,
    messages: [{ role: 'user', content: 'Növbəti sual' }],
  });
  assert.equal(deltaSchemaOk.success, true);

  const f = await createHttpFixture(t);
  const longHistory = Array.from({ length: 210 }, (_, i) => ({
    role: i % 2 === 0 ? 'user' : 'assistant',
    content: `Tarixçə mesajı ${i}`,
  }));
  const saved = await f.chatRepository.saveChat({
    ownerId: f.ownerId,
    messages: longHistory,
  });

  const deltaRes = await fetch(f.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() },
    body: JSON.stringify({
      chatId: saved.id,
      chatRevision: saved.revision,
      messages: [{ role: 'user', content: '211-ci sual' }],
    }),
  });
  assert.equal(deltaRes.status, 200);
  const deltaJson = await deltaRes.json();
  assert.equal(deltaJson.chat.messages.length, 212);
  assert.equal(deltaJson.chat.messages.at(-2).content, '211-ci sual');
  assert.equal(deltaJson.chat.messages.at(-1).content, 'Cavab hazırdır.');
  assert.equal(f.calls.at(-1).contents.at(-1).parts.at(-1).text, '211-ci sual');

  const regenRes = await fetch(f.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() },
    body: JSON.stringify({
      chatId: saved.id,
      chatRevision: deltaJson.chatRevision,
      regenerateFromIndex: 199,
      messages: [{ role: 'user', content: 'Tarixçə mesajı 198' }],
    }),
  });
  assert.equal(regenRes.status, 200);
  const regenJson = await regenRes.json();
  assert.equal(regenJson.chat.messages.length, 200);
  assert.equal(regenJson.chat.messages.at(-2).content, 'Tarixçə mesajı 198');
  assert.equal(regenJson.chat.messages.at(-1).content, 'Cavab hazırdır.');
});

test('1b. Frontend submitAskMessage sends 1-message delta payload when chatId exists and full array for new chats', async (t) => {
  const dom = new JSDOM('<main></main>', { url: 'https://helmer.local', runScripts: 'outside-only' });
  t.after(() => dom.window.close());

  const capturedBodies = [];
  dom.window.fetch = async (_url, options) => {
    capturedBodies.push(JSON.parse(options.body));
    return {
      ok: true,
      status: 200,
      headers: { get: (name) => (name.toLowerCase() === 'content-type' ? 'application/json' : null) },
      json: async () => ({
        reply: 'Cavab',
        chatId: '11111111-1111-4111-8111-111111111111',
        chatRevision: 2,
        chat: { id: '11111111-1111-4111-8111-111111111111', revision: 2, messages: [] },
      }),
    };
  };

  dom.window.eval(`
    const state = {
      currentUser: { id: 'u1' },
      savedStrategies: [],
      plannerTasks: [],
      askMessages: [],
      askChatId: '',
      askStrategyId: '',
      askBriefId: '',
      askTaskId: '',
      askPluginIds: [],
      askArtifactId: null,
      askArtifactName: '',
      askModel: 'default',
      askThinkingEnabled: false,
      askLoading: false,
      askError: '',
      identityEpoch: 1,
    };
    let currentAskAbortController = null;
    let activeAskReader = null;
    let activeAskTypewriter = null;
    let activeAskRunMeta = null;
    let currentAskThinking = 'low';
    const freshAskResponses = new Set();
    window.helmerSecurity = {
      revisions: new Map(),
      getRevision: (id) => window.helmerSecurity.revisions.get(id) || 1,
      idempotencyKey: () => 'idem-key-1234567890abcdef',
      rememberChat: () => {},
    };
    function getActiveConversationSurface() { return 'ask'; }
    function getConversationState() {
      return {
        surface: 'ask',
        isDeepResearch: false,
        get chatId() { return state.askChatId; },
        set chatId(v) { state.askChatId = v; },
        get messages() { return state.askMessages; },
        set messages(v) { state.askMessages = v; },
        get strategyId() { return state.askStrategyId; },
        get briefId() { return state.askBriefId; },
        get taskId() { return state.askTaskId; },
        pendingFile: null,
        quotedText: '',
        retry: null,
        get loading() { return state.askLoading; },
        set loading(v) { state.askLoading = v; },
        get error() { return state.askError; },
        set error(v) { state.askError = v; },
        draft: '',
      };
    }
    function hasAcceptedFirstQueryDisclaimer() { return true; }
    function setAskMessageMeta() {}
    function trackEvent() {}
    function appendAskTurnToDom() { return false; }
    function render() {}
    function scrollToLatestAskTurn() {}
    function startAskWaitStages() {}
    function clearAskWaitStages() {}
    function stopAskRunPolling() {}
    function isModelImprovementActive() { return false; }
    function isIdentityStale() { return false; }
    function getLanguage() { return 'az'; }
    function formatBriefContextLabel(x) { return x?.title || ''; }
    function rememberActiveAskChat() {}
    function rememberSavedAskChat() {}
    function loadSavedChats() {}
    function finalizeStreamingAskMessageDom() { return true; }
    function isRecoverableAskNetworkError() { return false; }
    ${extractSection('function sanitizeAskMessageForApi(', 'function isAskThinkingActive(')}
    ${extractSection('function createAskRequestOperation(', 'async function consumeAskEventStream(')}
    ${extractSection('async function submitAskMessage(', 'let buildIntelligenceCleanup = null;')}
    function element(tag, className, text) {
      const node = document.createElement(tag);
      node.className = className;
      if (text) node.textContent = text;
      return node;
    }
    ${extractSection('function createAskThinkingControls(', 'function createAskModelSelector(')}
    window.__slider = createAskThinkingControls(true).querySelector('input');
    window.__submitAskMessage = submitAskMessage;
    window.__state = state;
  `);

  dom.window.__state.askChatId = '';
  dom.window.__state.askMessages = [
    { role: 'user', content: 'İlk sual' },
    { role: 'assistant', content: 'İlk cavab' },
  ];
  await dom.window.__submitAskMessage('Yeni söhbət sualı');
  assert.equal(capturedBodies[0].messages.length, 3);
  assert.equal(capturedBodies[0].model, 'default');

  dom.window.__state.askChatId = '11111111-1111-4111-8111-111111111111';
  dom.window.__state.askModel = 'gpt-6.1-terra';
  dom.window.__state.askMessages = [
    { role: 'user', content: 'Sual 1' },
    { role: 'assistant', content: 'Cavab 1' },
    { role: 'user', content: 'Sual 2' },
    { role: 'assistant', content: 'Cavab 2' },
  ];
  await dom.window.__submitAskMessage('Delta sual');
  assert.equal(capturedBodies[1].messages.length, 1);
  assert.equal(capturedBodies[1].messages[0].role, 'user');
  assert.equal(capturedBodies[1].messages[0].content, 'Delta sual');
  assert.equal(capturedBodies[1].model, 'gpt-6.1-terra');
  assert.equal(capturedBodies[1].thinkingLevel, 'low');
  for (const [index, level] of ['low', 'medium', 'high'].entries()) {
    dom.window.__slider.value = String(index);
    dom.window.__slider.dispatchEvent(new dom.window.Event('input'));
    await dom.window.__submitAskMessage('Effort ' + level);
    assert.equal(capturedBodies.at(-1).thinkingLevel, level);
  }
});

test('2a. Ask handler skips cache resolution for files older than last 10 messages while enforcing assertCachedFileReference', async (t) => {
  const f = await createHttpFixture(t);
  const oldFileId = `gfc_${randomUUID()}`;
  const recentFileId = `gfc_${randomUUID()}`;

  const resolvedIds = [];
  const origResolveAsync = geminiFileCache.resolveFileAsync.bind(geminiFileCache);
  geminiFileCache.resolveFileAsync = async (file, ownerId) => {
    resolvedIds.push(file.fileId);
    if (file.fileId === recentFileId) {
      return { ...file, ownerId, textContent: 'RECENT_FILE_BODY' };
    }
    return origResolveAsync(file, ownerId);
  };
  t.after(() => {
    geminiFileCache.resolveFileAsync = origResolveAsync;
  });

  const messages = [
    { role: 'user', content: 'Köhnə fayla bax', file: { fileId: oldFileId, name: 'old-report.pdf', size: 100, type: 'application/pdf' } },
    { role: 'assistant', content: 'Baxdım' },
    ...Array.from({ length: 10 }, (_, idx) => ({
      role: idx % 2 === 0 ? 'user' : 'assistant',
      content: `Turn ${idx}`,
    })),
    { role: 'user', content: 'Yeni fayla bax', file: { fileId: recentFileId, name: 'new-report.txt', size: 50, type: 'text/plain' } },
    { role: 'assistant', content: 'Tamam' },
  ];
  const saved = await f.chatRepository.saveChat({ ownerId: f.ownerId, messages });

  const okRes = await fetch(f.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() },
    body: JSON.stringify({
      chatId: saved.id,
      chatRevision: saved.revision,
      messages: [{ role: 'user', content: 'Son sual' }],
    }),
  });
  assert.equal(okRes.status, 200);
  assert.ok(!resolvedIds.includes(oldFileId), 'Old file outside last 10 messages must skip cache resolution');
  assert.ok(resolvedIds.includes(recentFileId), 'Recent file within last 10 messages must still resolve');

  const forgedFileId = `gfc_${randomUUID()}`;
  const forgedRes = await fetch(f.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() },
    body: JSON.stringify({
      chatId: saved.id,
      chatRevision: saved.revision + 1,
      messages: [{ role: 'user', content: 'Saxta fayl', file: { fileId: forgedFileId, name: 'forged.txt', size: 10, type: 'text/plain' } }],
    }),
  });
  assert.equal(forgedRes.status, 400);
  assert.equal((await forgedRes.json()).code, 'VALIDATION_ERROR');
});

test('2b. buildAskContents uses lightweight placeholder for old/expired prior attachments and throws FILE_CONTEXT_EXPIRED only on active turn', () => {
  const resolveCalls = [];
  const fileCache = {
    resolveFile: (file) => {
      resolveCalls.push(file.fileId);
      return file;
    },
  };

  // Old attachment outside last 10 turns skips resolveFile and emits placeholder
  const oldHistory = [
    { role: 'user', content: 'Köhnə sənədi oxu', file: { fileId: 'gfc_old_1', name: 'archive.pdf', textContent: 'HEAVY_ARCHIVE_CONTENT' } },
    { role: 'assistant', content: 'Cavab' },
    ...Array.from({ length: 11 }, (_, i) => ({ role: i % 2 === 0 ? 'user' : 'assistant', content: `Turn ${i}` })),
  ];
  const oldContents = buildAskContents(oldHistory, 'owner', fileCache, limits);
  const oldSerialized = JSON.stringify(oldContents);
  assert.ok(!resolveCalls.includes('gfc_old_1'));
  assert.ok(!oldSerialized.includes('HEAVY_ARCHIVE_CONTENT'));
  assert.ok(oldSerialized.includes('[Əvvəlki fayl əlavəsi: archive.pdf]'));

  // Expired prior attachment within last 10 turns degrades gracefully to placeholder
  const expiredPriorHistory = [
    { role: 'user', content: 'Əvvəlki fayl', file: { fileId: 'gfc_expired_prior', name: 'expired-prior.csv' } },
    { role: 'assistant', content: 'Analiz etdim' },
    { role: 'user', content: 'İndi başqa sual verirəm' },
  ];
  const gracefulContents = buildAskContents(expiredPriorHistory, 'owner', fileCache, limits);
  assert.ok(JSON.stringify(gracefulContents).includes('[Əvvəlki fayl əlavəsi: expired-prior.csv]'));

  // Expired active/last turn attachment still fails closed with FILE_CONTEXT_EXPIRED
  assert.throws(
    () => buildAskContents([{ role: 'user', content: 'Bunu oxu', file: { fileId: 'gfc_expired_now', name: 'missing.txt' } }], 'owner', fileCache, limits),
    (err) => err?.code === 'FILE_CONTEXT_EXPIRED' && err?.status === 400
  );
});

test('3. Ask service keeps systemInstruction constant, anchors referenceContext as a fixed prefix across window shifts, and cleans fallback directives', async () => {
  const calls = [];
  let attempt = 0;
  const client = {
    models: {
      generateContent: async (params) => {
        calls.push(params);
        if (attempt++ === 0 && params.config.tools) {
          throw new Error('Search temporary failure');
        }
        return { text: 'OK', candidates: [{}] };
      },
    },
  };
  const generate = createAskService({ getClient: () => client });

  // Ungrounded fallback must not leave search directives in contents.at(-1)
  const fallbackResult = await generate({
    messages: [{ role: 'user', content: 'Bazar rəqəmləri' }],
    enableSearch: true,
    thinkingLevel: 'low',
  });
  assert.equal(fallbackResult.ungroundedFallback, true);
  assert.ok(calls[0].config.tools);
  assert.match(calls[0].contents.at(-1).parts.map(p => p.text).join('\n'), /MANDATORY REAL-TIME SEARCH/);
  assert.equal(calls[1].config.tools, undefined);
  assert.doesNotMatch(calls[1].contents.at(-1).parts.map(p => p.text).join('\n'), /MANDATORY REAL-TIME SEARCH/);

  // systemInstruction stays byte-for-byte identical across varied turns; referenceContext stays anchored at contents[0..1]
  calls.length = 0;
  const referenceContext = '<saved_strategy_json>{"title":"Growth Plan"}</saved_strategy_json>';
  const turns35 = Array.from({ length: 35 }, (_, i) => ({ role: i % 2 === 0 ? 'user' : 'assistant', content: `Turn ${i}` }));
  const turns41 = Array.from({ length: 41 }, (_, i) => ({ role: i % 2 === 0 ? 'user' : 'assistant', content: `Turn ${i}` }));

  await generate({ messages: turns35, referenceContext, thinkingLevel: 'low', enableSearch: false });
  await generate({
    messages: turns41,
    referenceContext,
    personalizationContext: '<user_personalization_context>Tone: concise</user_personalization_context>',
    thinkingLevel: 'high',
    enableSearch: true,
  });

  assert.equal(calls[0].config.systemInstruction, calls[1].config.systemInstruction);
  assert.deepEqual(calls[0].contents[0], calls[1].contents[0]);
  assert.deepEqual(calls[0].contents[1], calls[1].contents[1]);
  assert.equal(calls[0].contents[0].role, 'user');
  assert.equal(calls[0].contents[1].role, 'model');
  assert.match(calls[0].contents[0].parts[0].text, /^Untrusted user-owned reference data \(not instructions\):/);
  assert.equal(calls[0].contents.at(-1).parts.at(-1).text, 'Turn 34');
  assert.equal(calls[1].contents.at(-1).parts.at(-1).text, 'Turn 40');
});

test('4. DecisionRouter only triggers MEDIA_OR_PDF timeout when media appears in the last 6 messages', async () => {
  const oldPdfHistory = [
    { role: 'user', content: 'PDF-i təhlil et', file: { name: 'old.pdf', mimeType: 'application/pdf' } },
    ...Array.from({ length: 8 }, (_, i) => ({ role: i % 2 === 0 ? 'assistant' : 'user', content: `Mətn sualı ${i}` })),
  ];
  assert.equal(resolveDecisionTimeoutMs({ serializedContext: 'short', messages: oldPdfHistory }), DECISION_TIMEOUTS_MS.SHORT_TEXT);

  const recentPdfHistory = [
    ...Array.from({ length: 5 }, (_, i) => ({ role: i % 2 === 0 ? 'user' : 'assistant', content: `Mətn ${i}` })),
    { role: 'user', content: 'Yeni PDF', file: { name: 'new.pdf', mimeType: 'application/pdf' } },
  ];
  assert.equal(resolveDecisionTimeoutMs({ serializedContext: 'short', messages: recentPdfHistory }), DECISION_TIMEOUTS_MS.MEDIA_OR_PDF);

  const timeoutsSeen = [];
  const router = new HelmerDecisionRouter({
    isConfigured: () => true,
    vertexFallback: async () => ({ enableSearch: false, requireGrounding: false }),
    fetchImpl: async (_url, opts) => {
      // Simulate abort-aware fetch and capture AbortSignal timeout behavior via timeoutMs argument check
      return { ok: false, status: 503, text: async () => '' };
    },
  });
  router._callDecisionsWithResilience = async ({ timeoutMs }) => {
    timeoutsSeen.push(timeoutMs);
    return { skipped: false, data: { decisions: { needs_web_search: { decision: 'NO', score: 0.1, confidence: 0.95 }, require_grounding: { decision: 'NO', score: 0.1, confidence: 0.95 } } } };
  };

  await router.routeAsk({ prompt: 'Qısaca cavabla', messages: oldPdfHistory });
  await router.routeAsk({ prompt: 'Qısaca cavabla', messages: recentPdfHistory });
  assert.equal(timeoutsSeen[0], DECISION_TIMEOUTS_MS.SHORT_TEXT);
  assert.equal(timeoutsSeen[1], DECISION_TIMEOUTS_MS.MEDIA_OR_PDF);
});

test('5. Frontend appendAskTurnToDom appends only the new turn without rebuilding existing message DOM nodes', (t) => {
  const dom = new JSDOM('<main></main>', { url: 'https://helmer.local', runScripts: 'outside-only' });
  t.after(() => dom.window.close());

  dom.window.eval(`
    const state = {
      askChatId: 'chat-123',
      mode: 'ask',
      view: 'home',
      askLoading: true,
      askMessages: [],
      askPendingFile: null,
    };
    const freshAskResponses = new Set();
    const GUEST_RESTRICTION_NOTICES = {};
    function element(tag, className = '', text) {
      const node = document.createElement(tag);
      if (className) node.className = className;
      if (text !== undefined) node.textContent = text;
      return node;
    }
    function button(text, className, handler) {
      const node = element('button', className, text);
      if (handler) node.addEventListener('click', handler);
      return node;
    }
    function getLanguage() { return 'en'; }
    function getActiveConversationSurface() { return 'ask'; }
    function splitQuotedUserMessage(text) { return { quote: '', text }; }
    function renderAskRichText(text) { return element('div', 'ask-rich-text', text); }
    function renderAskSourceChips() { return null; }
    function appendArtifactCards() {}
    function createAskMessageActions() { return element('div', 'ask-message-actions'); }
    function usesAskSearchAnimation() { return false; }
    function isAskThinkingActive() { return false; }
    function askThinkingIcon() { return ''; }
    function askThinkingLabel() { return 'Thinking'; }
    function createAskStopIcon() { return element('span', 'stop-icon'); }
    function createAskSendIcon() { return element('span', 'send-icon'); }
    function getFileIconSvg() { return ''; }
    function formatFileSize() { return '1 KB'; }
    function t() { return ''; }
    ${extractSection('function createAskMessageElement(', 'function renderAsk(')}
    ${extractSection('function finalizeStreamingAskMessageDom(', 'function rememberActiveAskChat(')}
    window.__domTest = { state, freshAskResponses, createAskMessageElement, appendAskTurnToDom };
  `);

  const { state, freshAskResponses, createAskMessageElement, appendAskTurnToDom } = dom.window.__domTest;
  const doc = dom.window.document;
  const main = doc.querySelector('main');
  main.innerHTML = `
    <section class="ask-shell has-input">
      <div class="ask-thread">
        <div class="ask-error">Previous error</div>
      </div>
      <form class="ask-composer has-input">
        <div class="ask-pending-file">pending.txt</div>
        <div class="ask-quote-preview">quote</div>
        <div class="ask-input-wrap has-value">
          <textarea id="askInput">Follow-up question</textarea>
        </div>
        <button class="ask-submit" type="submit"></button>
        <button class="ask-plugin-token-remove" type="button"></button>
      </form>
    </section>
  `;
  const thread = doc.querySelector('.ask-thread');
  const existingMsgs = [
    { role: 'user', content: 'Q1' },
    { role: 'assistant', content: 'A1' },
    { role: 'user', content: 'Q2' },
    { role: 'assistant', content: 'A2' },
  ];
  const initialNodes = existingMsgs.map((msg, idx) => {
    const el = createAskMessageElement(msg, idx, { isEn: true, surface: 'ask' });
    thread.insertBefore(el, thread.querySelector('.ask-error'));
    return el;
  });

  const userMsg = { role: 'user', content: 'Q3' };
  const assistantMsg = { role: 'assistant', content: '', isStreaming: true };
  freshAskResponses.add(assistantMsg);
  state.askMessages = [...existingMsgs, userMsg, assistantMsg];

  const appended = appendAskTurnToDom(userMsg, 4, assistantMsg, 5);
  assert.equal(appended, true);

  const rows = Array.from(thread.querySelectorAll('.ask-message'));
  assert.equal(rows.length, 6);
  for (let i = 0; i < 4; i++) {
    assert.equal(rows[i], initialNodes[i], `Existing DOM node ${i} must remain untouched`);
  }
  assert.equal(thread.querySelector('.ask-error'), null);
  assert.equal(doc.querySelector('.ask-pending-file'), null);
  assert.equal(doc.querySelector('.ask-quote-preview'), null);
  assert.equal(doc.querySelector('#askInput').value, '');
  assert.equal(doc.querySelector('#askInput').disabled, true);
  assert.equal(doc.querySelector('.ask-submit').classList.contains('is-stop'), true);
  assert.equal(doc.querySelector('.ask-submit').type, 'button');
  assert.equal(doc.querySelector('.ask-plugin-token-remove').disabled, true);

  // Fallback checks
  assert.equal(appendAskTurnToDom(userMsg, 4, assistantMsg, 5, { hasStructuralChange: true }), false);
  assert.equal(appendAskTurnToDom(userMsg, 99, assistantMsg, 100), false);
  state.askChatId = '';
  assert.equal(appendAskTurnToDom(userMsg, 6, assistantMsg, 7), false);
});
