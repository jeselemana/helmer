import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import express from 'express';
import { JSDOM } from 'jsdom';

import { FileStrategyRepository } from '../src/repositories/file-strategy-repository.js';
import { FileChatRepository } from '../src/repositories/file-chat-repository.js';
import { LearningLoopService } from '../src/services/learning/learning-loop-service.js';
import { FileAiLearningRepository } from '../src/repositories/file-ai-learning-repository.js';
import { AiPolicy } from '../src/services/security/ai-policy.js';
import { PrivacyPolicy } from '../src/services/security/privacy-policy.js';
import { configureProviderPolicy } from '../src/services/security/provider-policy.js';
import { createStrategyRouter, strategyErrorHandler } from '../src/http/strategy-router.js';
import { getBuildVertexClient, getGeminiClient } from '../src/services/ai/client.js';
import { MAX_GROUNDED_CHAT_RETENTION_MS } from '../src/services/ai/grounded-chat-retention.js';
import { createDocumentExport, createPdfPrintDocument } from '../public/exporters.js';
import { strategyFixture } from './helpers/build-fixtures.js';
import { installBuildRoutingFixture } from './helpers/build-routing-fixture.js';

installBuildRoutingFixture();

function makeRedisStub() {
  const store = new Map();
  return {
    store,
    isReady: true,
    async get(key) {
      return store.has(key) ? store.get(key) : null;
    },
    async set(key, value) {
      store.set(key, String(value));
      return 'OK';
    },
    async del(key) {
      return store.delete(key) ? 1 : 0;
    },
    async keys(pattern) {
      const prefix = pattern.endsWith('*') ? pattern.slice(0, -1) : pattern;
      return [...store.keys()].filter(k => (pattern.endsWith('*') ? k.startsWith(prefix) : k === prefix));
    },
  };
}

function makeSampleRecord(ownerId, id, overrides = {}) {
  const strategy = overrides.strategy || strategyFixture();
  const createdAt = overrides.createdAt || new Date().toISOString();
  return {
    id,
    ownerId,
    clientSaveId: overrides.clientSaveId || `cs_${randomUUID()}`,
    brief: overrides.brief || 'Brief for retention test',
    title: strategy.title,
    answers: [],
    strategy,
    versions: overrides.versions || [{ id: randomUUID(), versionNumber: 1, data: strategy, createdAt }],
    currentVersionId: randomUUID(),
    createdAt,
    updatedAt: overrides.updatedAt || createdAt,
    deleted: false,
    ...overrides,
  };
}

test('730-day physical retention prunes inactive tenants across disk, .provenance, R2, and Redis, fails closed on undated records, and blocks resurrection', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'helmer-sec3-ret-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));

  const now = Date.now();
  const expiredIso = new Date(now - MAX_GROUNDED_CHAT_RETENTION_MS - 3_600_000).toISOString();
  const freshIso = new Date(now - 30 * 86_400_000).toISOString();
  const oldUngroundedIso = new Date(now - MAX_GROUNDED_CHAT_RETENTION_MS - 100 * 86_400_000).toISOString();

  // R2 storage mock for both strategy & chat cloud shards
  const cloudStore = new Map();
  const redis = makeRedisStub();

  const inactiveOwner = randomUUID();
  const strategyRepo = new FileStrategyRepository(path.join(dir, 'strategies'), redis, {
    cloud: true,
    readCloud: async key => {
      const snap = cloudStore.get(`strategies-v1/${key}.json`);
      return snap ? { record: structuredClone(snap.record), etag: snap.etag } : { record: null, etag: null, notFound: true };
    },
    writeCloud: async (key, data, etag) => {
      const fullKey = `strategies-v1/${key}.json`;
      const existing = cloudStore.get(fullKey);
      if ((existing?.etag || null) !== (etag || null)) return false;
      const nextEtag = `etag-${Date.now()}-${Math.random()}`;
      cloudStore.set(fullKey, { record: structuredClone(data), etag: nextEtag });
      return true;
    },
    deleteCloud: async key => {
      cloudStore.delete(`strategies-v1/${key}.json`);
      return true;
    },
    listCloudShards: async () => [...cloudStore.keys()].filter(k => k.startsWith('strategies-v1/')),
  });
  await strategyRepo.ensure();

  const expiredId = randomUUID();
  const undatedId = randomUUID();
  const clientExtendedId = randomUUID();
  const freshId = randomUUID();
  const ungroundedOldId = randomUUID();

  // Grounded records:
  // 1) expired authoritative date (>730d)
  const expiredRec = makeSampleRecord(inactiveOwner, expiredId, {
    createdAt: expiredIso,
    firstGroundedAt: expiredIso,
    searchGrounded: true,
    strategy: { ...strategyFixture(), orchestration: { searchGrounded: true, firstGroundedAt: expiredIso } },
  });
  // 2) missing authoritative grounded date (only client versions[].createdAt = fresh) -> must FAIL CLOSED
  const undatedRec = makeSampleRecord(inactiveOwner, undatedId, {
    createdAt: '',
    updatedAt: freshIso,
    searchGrounded: true,
    strategy: { ...strategyFixture(), orchestration: { searchGrounded: true } },
    versions: [{ id: randomUUID(), versionNumber: 1, data: { ...strategyFixture(), orchestration: { searchGrounded: true } }, createdAt: freshIso }],
  });
  delete undatedRec.firstGroundedAt;
  // 3) old authoritative firstGroundedAt (>730d) + recent client versions[0].createdAt -> client version date must NOT extend TTL
  const clientExtendedRec = makeSampleRecord(inactiveOwner, clientExtendedId, {
    createdAt: expiredIso,
    firstGroundedAt: expiredIso,
    searchGrounded: true,
    strategy: { ...strategyFixture(), orchestration: { searchGrounded: true, firstGroundedAt: expiredIso } },
    versions: [
      { id: randomUUID(), versionNumber: 1, data: strategyFixture(), createdAt: expiredIso },
      { id: randomUUID(), versionNumber: 2, data: { ...strategyFixture(), orchestration: { searchGrounded: true } }, createdAt: freshIso },
    ],
  });
  // 4) fresh grounded record (<730d) -> retained
  const freshRec = makeSampleRecord(inactiveOwner, freshId, {
    createdAt: freshIso,
    firstGroundedAt: freshIso,
    searchGrounded: true,
    strategy: { ...strategyFixture(), orchestration: { searchGrounded: true, firstGroundedAt: freshIso } },
  });
  // 5) old ungrounded record (>830d) -> retained
  const oldUngroundedRec = makeSampleRecord(inactiveOwner, ungroundedOldId, {
    createdAt: oldUngroundedIso,
    strategy: strategyFixture(),
  });

  const inactiveShardRecords = [expiredRec, undatedRec, clientExtendedRec, freshRec, oldUngroundedRec];
  const inactiveKey = strategyRepo.tenantKey(inactiveOwner);
  await fs.writeFile(strategyRepo.tenantFilePath(inactiveKey), JSON.stringify(inactiveShardRecords));
  cloudStore.set(`strategies-v1/${inactiveKey}.json`, { record: structuredClone(inactiveShardRecords), etag: 'seed-etag-1' });
  await redis.set(strategyRepo.tenantRedisKey(inactiveOwner), JSON.stringify(inactiveShardRecords));

  // Expired provenance for a completely separate offline tenant
  const provOnlyOwner = randomUUID();
  const provKey = strategyRepo.tenantKey(provOnlyOwner);
  const provDir = path.join(strategyRepo.strategiesDir, '.provenance');
  await fs.mkdir(provDir, { recursive: true });
  await fs.writeFile(
    path.join(provDir, `${provKey}.json`),
    JSON.stringify([
      { strategyId: randomUUID(), firstGroundedAt: expiredIso },
      { strategyId: randomUUID(), firstGroundedAt: freshIso },
    ]),
  );

  // Also test a disk-only expired tenant + cloud duplicate check before reading directly
  const removedStrategies = await strategyRepo.pruneInactiveGroundedData(now);
  assert.ok(removedStrategies >= 3, 'pruneInactiveGroundedData must physically prune expired & undated grounded records');

  // Verify physical removal from disk shard, cloud shard, Redis cache, and .provenance
  const diskAfter = JSON.parse(await fs.readFile(strategyRepo.tenantFilePath(inactiveKey), 'utf8'));
  assert.deepEqual(diskAfter.map(r => r.id).sort(), [freshId, ungroundedOldId].sort());
  const cloudAfter = cloudStore.get(`strategies-v1/${inactiveKey}.json`).record;
  assert.deepEqual(cloudAfter.map(r => r.id).sort(), [freshId, ungroundedOldId].sort());
  const redisAfter = JSON.parse(await redis.get(strategyRepo.tenantRedisKey(inactiveOwner)));
  assert.deepEqual(redisAfter.map(r => r.id).sort(), [freshId, ungroundedOldId].sort());

  const provAfter = JSON.parse(await fs.readFile(path.join(provDir, `${provKey}.json`), 'utf8'));
  assert.equal(provAfter.length, 1);
  assert.equal(provAfter[0].firstGroundedAt, freshIso);

  // Inactive Chat repository physical cleanup across disk, R2, and Redis (including legacy sources-only turn)
  const chatRepo = new FileChatRepository(path.join(dir, 'chats'), redis, {
    cloud: true,
    readCloud: async key => {
      const snap = cloudStore.get(`chats-v1/${key}.json`);
      return snap ? { record: structuredClone(snap.record), etag: snap.etag } : { record: null, etag: null, notFound: true };
    },
    writeCloud: async (key, data, etag) => {
      const fullKey = `chats-v1/${key}.json`;
      const existing = cloudStore.get(fullKey);
      if ((existing?.etag || null) !== (etag || null)) return false;
      cloudStore.set(fullKey, { record: structuredClone(data), etag: `chat-etag-${Math.random()}` });
      return true;
    },
    listCloudShards: async () => [...cloudStore.keys()].filter(k => k.startsWith('chats-v1/')),
  });
  await chatRepo.ensure();

  const chatOwner = randomUUID();
  const chatKey = chatRepo.tenantKey(chatOwner);
  const chatRecords = [{
    id: randomUUID(),
    ownerId: chatOwner,
    title: 'Inactive Chat',
    createdAt: expiredIso,
    updatedAt: freshIso,
    revision: 1,
    messages: [
      { id: randomUUID(), role: 'user', content: 'Old user question', createdAt: expiredIso },
      { id: randomUUID(), role: 'assistant', content: 'Expired legacy sources answer', createdAt: expiredIso, sources: [{ title: 'Reuters', url: 'https://reuters.com' }] },
      { id: randomUUID(), role: 'assistant', content: 'Fresh grounded answer', createdAt: freshIso, groundingActive: true },
    ],
  }];
  await fs.writeFile(chatRepo.tenantFilePath(chatKey), JSON.stringify(chatRecords));
  cloudStore.set(`chats-v1/${chatKey}.json`, { record: structuredClone(chatRecords), etag: 'chat-seed-1' });
  await redis.set(chatRepo.tenantRedisKey(chatOwner), JSON.stringify(chatRecords));

  const removedChatTurns = await chatRepo.pruneInactiveGroundedData(now);
  assert.ok(removedChatTurns >= 1);
  const chatDiskAfter = JSON.parse(await fs.readFile(chatRepo.tenantFilePath(chatKey), 'utf8'));
  assert.deepEqual(chatDiskAfter[0].messages.map(m => m.content), ['Old user question', 'Fresh grounded answer']);
  const chatCloudAfter = cloudStore.get(`chats-v1/${chatKey}.json`).record;
  assert.deepEqual(chatCloudAfter[0].messages.map(m => m.content), ['Old user question', 'Fresh grounded answer']);
  const chatRedisAfter = JSON.parse(await redis.get(chatRepo.tenantRedisKey(chatOwner)));
  assert.deepEqual(chatRedisAfter[0].messages.map(m => m.content), ['Old user question', 'Fresh grounded answer']);

  // No resurrection via duplicate(), /save, migrateLegacyStrategiesIfPresent(), or /generate replay
  const dupOwner = randomUUID();
  const dupKey = strategyRepo.tenantKey(dupOwner);
  const expiredDupId = randomUUID();
  const expiredForDup = makeSampleRecord(dupOwner, expiredDupId, {
    createdAt: expiredIso,
    firstGroundedAt: expiredIso,
    searchGrounded: true,
    strategy: { ...strategyFixture(), orchestration: { searchGrounded: true, firstGroundedAt: expiredIso } },
  });
  await fs.writeFile(strategyRepo.tenantFilePath(dupKey), JSON.stringify([expiredForDup]));
  cloudStore.set(`strategies-v1/${dupKey}.json`, { record: [structuredClone(expiredForDup)], etag: 'dup-etag' });
  assert.equal(await strategyRepo.duplicate(expiredDupId, dupOwner), null, 'duplicate() must fail closed on expired grounded record');
  assert.equal(await strategyRepo.getById(expiredDupId, dupOwner), null, 'Archive lookup must not expose expired record');
  assert.equal((await strategyRepo.readAll(dupOwner)).length, 0);

  // Legacy migration skips expired grounded record
  const legacyPath = path.join(dir, 'legacy-strategies.json');
  const legacyExpiredId = randomUUID();
  const legacyOwner = randomUUID();
  await fs.writeFile(legacyPath, JSON.stringify([
    makeSampleRecord(legacyOwner, legacyExpiredId, {
      createdAt: expiredIso,
      firstGroundedAt: expiredIso,
      searchGrounded: true,
      strategy: { ...strategyFixture(), orchestration: { searchGrounded: true, firstGroundedAt: expiredIso } },
    }),
  ]));
  const legacyRepo = new FileStrategyRepository(legacyPath, null, { cloud: false });
  await legacyRepo.ensure();
  assert.equal(await legacyRepo.getById(legacyExpiredId, legacyOwner), null, 'Legacy migration must not resurrect expired grounded records');

  // HTTP /save and /generate replay do not resurrect expired records
  const httpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'helmer-sec3-http-'));
  t.after(() => fs.rm(httpDir, { recursive: true, force: true }));
  const httpOwner = randomUUID();
  const httpRepo = new FileStrategyRepository(path.join(httpDir, 'strategies'), null, { cloud: false });
  await httpRepo.ensure();
  const expiredKey = `idem_${randomUUID()}`;
  const expiredSavedId = randomUUID();
  const httpOwnerKey = httpRepo.tenantKey(httpOwner);
  const expiredSavedRec = makeSampleRecord(httpOwner, expiredSavedId, {
    clientSaveId: expiredKey,
    createdAt: expiredIso,
    firstGroundedAt: expiredIso,
    searchGrounded: true,
    strategy: { ...strategyFixture(), orchestration: { searchGrounded: true, firstGroundedAt: expiredIso } },
  });
  await fs.writeFile(httpRepo.tenantFilePath(httpOwnerKey), JSON.stringify([expiredSavedRec]));

  const legacyClient = getGeminiClient();
  const origLegacyGen = legacyClient.models.generateContent;
  t.after(() => { legacyClient.models.generateContent = origLegacyGen; });
  legacyClient.models.generateContent = async () => ({
    text: JSON.stringify({ ...strategyFixture(), title: 'Fresh Regenerated Strategy' }),
    candidates: [{ finishReason: 'STOP' }],
  });

  const aiPolicy = new AiPolicy({ env: { GUEST_AI_DAILY_LIMIT: '100' } });
  configureProviderPolicy({
    assertEnabled: () => aiPolicy.assertEnabled(),
    reserveProvider: (ctx, p) => aiPolicy.reserveProvider(ctx, p),
  });
  t.after(() => configureProviderPolicy(undefined));

  const app = express();
  app.use(express.json());
  const userObj = { id: httpOwner, status: 'active', emailVerifiedAt: new Date().toISOString(), authVersion: 1, settings: { modelImprovement: false } };
  app.use((req, _res, next) => { req.ownerId = httpOwner; req.user = userObj; req.auth = { user: userObj }; next(); });
  app.use(new PrivacyPolicy({ findById: async id => (id === httpOwner ? userObj : null) }).middleware());
  app.use(aiPolicy.middleware());
  app.use('/api/strategy', createStrategyRouter(httpRepo, new LearningLoopService(new FileAiLearningRepository(path.join(httpDir, 'learning.json'), null, { mirrorToR2: false }))));
  app.use(strategyErrorHandler);

  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}`;

  // /save with expired firstGroundedAt -> 410 GROUNDED_STRATEGY_EXPIRED
  const expiredSaveRes = await fetch(`${base}/api/strategy/save`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientSaveId: `save_${randomUUID()}`,
      brief: 'Expired brief content',
      answers: [],
      strategy: { ...strategyFixture(), orchestration: { searchGrounded: true, firstGroundedAt: expiredIso } },
      versions: [{ versionNumber: 1, data: { ...strategyFixture(), orchestration: { searchGrounded: true, firstGroundedAt: expiredIso } }, changeRequest: 'Init', createdAt: freshIso }],
    }),
  });
  assert.equal(expiredSaveRes.status, 410);
  assert.equal((await expiredSaveRes.json()).code, 'GROUNDED_STRATEGY_EXPIRED');

  // /generate with same idempotencyKey as expired stored record does NOT replay expired grounded record
  const genRes = await fetch(`${base}/api/strategy/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': expiredKey },
    body: JSON.stringify({ brief: 'Regenerate non-expired strategy safely', answers: [], autoSave: false, idempotencyKey: expiredKey }),
  });
  assert.equal(genRes.status, 200);
  const genJson = await genRes.json();
  assert.equal(genJson.strategy.title, 'Fresh Regenerated Strategy');
  await new Promise(resolve => setTimeout(resolve, 40));
});

test('Legacy R2 migration merges fresh snapshot on OCC conflict without dropping concurrent replica writes', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'helmer-sec3-occ-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));

  const ownerId = randomUUID();
  const concurrentRecordId = randomUUID();
  const legacyRecordId = randomUUID();
  const legacyPath = path.join(dir, 'strategies.json');
  await fs.writeFile(legacyPath, JSON.stringify([
    makeSampleRecord(ownerId, legacyRecordId, { brief: 'Legacy Strategy Brief', strategy: { ...strategyFixture(), title: 'Legacy Strategy' } }),
  ]));

  let writeAttempts = 0;
  let currentCloud = { record: [], etag: 'etag-v1' };

  const repo = new FileStrategyRepository(legacyPath, null, {
    cloud: true,
    readCloud: async () => structuredClone(currentCloud),
    writeCloud: async (_key, data, expectedEtag) => {
      writeAttempts++;
      if (writeAttempts === 1) {
        // Simulate a parallel replica committing right before our writeCloud call
        currentCloud = {
          record: [makeSampleRecord(ownerId, concurrentRecordId, { brief: 'Parallel Replica Brief', strategy: { ...strategyFixture(), title: 'Parallel Replica Strategy' } })],
          etag: 'etag-v2',
        };
        return false; // OCC mismatch
      }
      if (expectedEtag !== currentCloud.etag) return false;
      currentCloud = { record: structuredClone(data), etag: 'etag-v3' };
      return true;
    },
  });

  await repo.ensure();
  assert.equal(writeAttempts, 2, 'Should retry with fresh ETag and snapshot after OCC conflict');
  const finalIds = currentCloud.record.map(r => r.id).sort();
  assert.deepEqual(finalIds, [concurrentRecordId, legacyRecordId].sort(), 'Both concurrent replica record and legacy record must survive OCC merge');
});

test('public/exporters.js strictly allowlists and escapes lang attribute without changing Build HTML format', () => {
  const maliciousLang = 'en" onclick="alert(1)';
  const sample = strategyFixture();

  const pdfHtml = createPdfPrintDocument(sample, maliciousLang);
  assert.match(pdfHtml, /^<!doctype html>\n<html lang="az">/);
  assert.doesNotMatch(pdfHtml, /onclick=/);

  const docHtmlEn = createDocumentExport(sample, 'en');
  assert.match(docHtmlEn.content, /^<!doctype html><html lang="en"><head>/);
  assert.match(docHtmlEn.content, /<h2>Strategy<\/h2>[\s\S]*<h2>Execution Roadmap<\/h2>[\s\S]*<h2>KPIs<\/h2>[\s\S]*<h2>Immediate Next Steps<\/h2>/);

  const docHtmlMalicious = createDocumentExport(sample, maliciousLang);
  assert.match(docHtmlMalicious.content, /^<!doctype html><html lang="az"><head>/);
  assert.doesNotMatch(docHtmlMalicious.content, /onclick=/);
});

test('Client isolation (script.js): grounded bg job retention, detached Build stream/resume abort on auth events, and Planner summary/confirm stale identity guard', async () => {
  const scriptSrc = await readFile(new URL('../public/script.js', import.meta.url), 'utf8');

  // Slice relevant client security blocks cleanly
  const bgRetStart = scriptSrc.indexOf('const MAX_GROUNDED_JOB_RETENTION_MS =');
  const bgRetEnd = scriptSrc.indexOf('function element(tag, className, text)');
  assert.ok(bgRetStart !== -1 && bgRetEnd > bgRetStart);

  const cancelStart = scriptSrc.indexOf('function cancelCurrentAnalysis()');
  const cancelEnd = scriptSrc.indexOf('document.addEventListener("visibilitychange"', cancelStart);
  assert.ok(cancelStart !== -1 && cancelEnd > cancelStart);

  const groundedClientStart = scriptSrc.indexOf('function isStrategyGroundedClient(strategy)');
  const groundedClientEnd = scriptSrc.indexOf('function sendExportTelemetry(');
  assert.ok(groundedClientStart !== -1 && groundedClientEnd > groundedClientStart);

  const modalStart = scriptSrc.indexOf('function openPlannerTaskSelectionModal(');
  const modalEnd = scriptSrc.indexOf('function buildNextStepsSection(');
  assert.ok(modalStart !== -1 && modalEnd > modalStart);

  const clearStart = scriptSrc.indexOf('function clearUserScopedWorkspaceState()');
  const userChangedStart = scriptSrc.indexOf('window.addEventListener("helmer:user-changed"', clearStart);
  const clearEndResolved = scriptSrc.indexOf('});', userChangedStart) + 3;

  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://helmer.test/' });
  const toasts = [];
  const plannerBatchCalls = [];
  let savedStrategiesLoaded = 0;

  const state = {
    identityEpoch: 1,
    currentUser: { id: 'user-A' },
    status: 'generating',
    view: 'loading',
    brief: 'Launch strategy',
    answers: [],
    assumptions: [],
    questions: [],
    savedId: null,
    clientSaveId: 'bg-key-1',
    savedStrategies: [],
    plannerTasks: [],
    plannerSelectedTaskIds: new Set(),
    guestQuotaVersion: 0,
  };

  let nextAuthReqBehavior = 'resolve';
  let deferredPlannerSummarize = null;

  const context = {
    window: dom.window,
    document: dom.window.document,
    localStorage: dom.window.localStorage,
    sessionStorage: dom.window.sessionStorage,
    CustomEvent: dom.window.CustomEvent,
    navigator: { onLine: true },
    crypto: globalThis.crypto,
    AbortController,
    DOMException,
    setInterval,
    clearInterval,
    setTimeout,
    clearTimeout,
    console: { ...console, error: () => {}, warn: () => {} },
    state,
    strategyCount: null,
    progressTimer: null,
    loadingAskPlaceholderTimer: null,
    activeAskReader: null,
    activeAskTypewriter: null,
    activeResearchStreams: new Map(),
    currentAbortController: new AbortController(),
    detachedBuildAbortControllers: new Set(),
    backgroundResumeAbortControllers: new Set(),
    currentAskAbortController: new AbortController(),
    element(tag, className, text) {
      const n = dom.window.document.createElement(tag);
      if (className) n.className = className;
      if (text !== undefined) n.textContent = text;
      return n;
    },
    button(label, className, onClick) {
      const n = dom.window.document.createElement('button');
      n.type = 'button';
      if (className) n.className = className;
      n.textContent = label || '';
      if (onClick) n.addEventListener('click', onClick);
      return n;
    },
    getLanguage: () => 'en',
    isAutoSaveStrategiesEnabled: () => true,
    isIdentityStale: (epoch, expectedUserId) => epoch !== state.identityEpoch || (expectedUserId || null) !== (state.currentUser?.id || null),
    closeSearchModal() {},
    stopBuildCountdown() {},
    stopBuildIntelligence() {},
    stopAskPlaceholderAnimation() {},
    cancelBuildEstimate() {},
    updatePlannerBadge() {},
    render() {},
    renderRecentList() {},
    renderStrategyList() {},
    setStatus(s) { state.status = s; },
    setError() {},
    startGeneration() {},
    openBackgroundJob() {},
    openSavedStrategy() {},
    formatDate: d => String(d || ''),
    cleanTaskText: s => String(s || '').trim(),
    showToast: (msg, type) => toasts.push({ msg, type }),
    loadSavedStrategies: async () => { savedStrategiesLoaded++; },
    api: async (url, opts) => {
      return new Promise((resolve, reject) => {
        if (opts?.signal) {
          if (opts.signal.aborted) return reject(new DOMException('Aborted', 'AbortError'));
          opts.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
        }
        if (url === '/api/strategy/generate') {
          setTimeout(() => resolve({ strategy: strategyFixture(), savedId: 's-bg' }), 5000);
        } else if (url === '/api/strategy/save') {
          setTimeout(() => resolve({ strategy: { id: 's-saved' } }), 5000);
        } else {
          resolve({});
        }
      });
    },
    authRequest: async (url, opts) => {
      if (url === '/api/planner/batch') {
        plannerBatchCalls.push(JSON.parse(opts.body));
        return { tasks: [{ id: 't1', title: 'Step 1' }], added: [{ id: 't1' }] };
      }
      if (url === '/api/planner/summarize') {
        return new Promise((resolve, reject) => {
          deferredPlannerSummarize = { resolve, reject };
        });
      }
      return {};
    },
    updateWorkspaceIdentity(nextUser) {
      state.currentUser = nextUser;
      context.clearUserScopedWorkspaceState();
    },
  };

  vm.createContext(context);
  vm.runInContext(
    [
      scriptSrc.slice(groundedClientStart, groundedClientEnd),
      scriptSrc.slice(bgRetStart, bgRetEnd),
      scriptSrc.slice(cancelStart, cancelEnd),
      scriptSrc.slice(modalStart, modalEnd),
      scriptSrc.slice(clearStart, clearEndResolved),
    ].join('\n;\n'),
    context,
  );

  // 1. Browser grounded background job 730-day & fail-closed retention
  const now = Date.now();
  const expiredBgIso = new Date(now - MAX_GROUNDED_CHAT_RETENTION_MS - 60_000).toISOString();
  const freshBgIso = new Date(now - 10 * 86_400_000).toISOString();
  dom.window.localStorage.setItem('helmer_bg_jobs', JSON.stringify([
    { id: 'bg-expired', ownerId: 'user-A', searchGrounded: true, completedAt: expiredBgIso, strategy: { orchestration: { searchGrounded: true, firstGroundedAt: expiredBgIso } } },
    { id: 'bg-undated', ownerId: 'user-A', searchGrounded: true, strategy: { orchestration: { searchGrounded: true } } },
    { id: 'bg-fresh', ownerId: 'user-A', searchGrounded: true, completedAt: freshBgIso, strategy: { orchestration: { searchGrounded: true, firstGroundedAt: freshBgIso } } },
  ]));
  const loadedJobs = context.loadBackgroundJobs();
  assert.deepEqual([...loadedJobs.map(j => j.id)], ['bg-fresh']);
  const persistedAfterLoad = JSON.parse(dom.window.localStorage.getItem('helmer_bg_jobs'));
  assert.deepEqual([...persistedAfterLoad.map(j => j.id)], ['bg-fresh']);

  // 2. Detach Build stream + in-flight background autosave + research stream -> helmer:logout aborts all of them
  const streamCtrl = context.currentAbortController;
  const askCtrl = context.currentAskAbortController;
  const researchCtrl = new AbortController();
  context.activeResearchStreams.set('job-1', researchCtrl);
  context.minimizeToBackground();
  assert.equal(streamCtrl.signal.aborted, false, 'minimizeToBackground should detach without aborting');
  const autoSavePromise = context.autoSaveBackgroundJob({ id: 'bg-fresh', ownerId: 'user-A', idempotencyKey: 'k1', brief: 'B', answers: [], strategy: strategyFixture(), versions: [] });

  dom.window.dispatchEvent(new dom.window.CustomEvent('helmer:logout'));
  await autoSavePromise;
  assert.equal(streamCtrl.signal.aborted, true, 'Detached Build stream controller must abort on helmer:logout');
  assert.equal(askCtrl.signal.aborted, true);
  assert.equal(researchCtrl.signal.aborted, true);
  assert.equal(savedStrategiesLoaded, 0, 'Aborted background autosave must not load strategies after logout');

  // Also test helmer:user-changed & helmer:auth-required abort detached controller
  for (const evt of [
    () => dom.window.dispatchEvent(new dom.window.CustomEvent('helmer:user-changed', { detail: { user: { id: 'user-B' } } })),
    () => { state.currentUser = { id: 'user-B' }; dom.window.dispatchEvent(new dom.window.CustomEvent('helmer:auth-required')); },
  ]) {
    state.status = 'generating';
    state.clientSaveId = `k_${randomUUID()}`;
    const ctrl = new AbortController();
    context.currentAbortController = ctrl;
    context.minimizeToBackground();
    assert.equal(ctrl.signal.aborted, false);
    evt();
    assert.equal(ctrl.signal.aborted, true);
  }

  // 3. Planner summary success + error callbacks & modal confirm guard
  // Extract just the addAllToPlannerButton click handler logic via vm helper using exact code lines from script.js
  const summaryHandlerStart = scriptSrc.indexOf('const triggerModalWithTasks = (summarizedTasks) => {');
  const summaryHandlerEnd = scriptSrc.indexOf('nextActionsGroup.append(addAllManualButton, addAllToPlannerButton);');
  const summaryBody = `
    async function runSummarizeClick(capturedStrategyId, capturedStrategyTitle, itemsToSummarize) {
      const isEn = true;
      const epoch = state.identityEpoch;
      const expectedUserId = state.currentUser?.id || null;
      const addAllToPlannerButton = { disabled: false, textContent: '' };
      const rowControllers = [];
      ${scriptSrc.slice(summaryHandlerStart, summaryHandlerEnd).replace(/\n\s*\}\s*\n\s*\);\s*$/, '\n}')}
  `;
  vm.runInContext(summaryBody, context);

  // 3a) Identity changes before /api/planner/summarize resolves -> no modal opened
  state.currentUser = { id: 'user-A' };
  const pSuccessStale = context.runSummarizeClick(randomUUID(), 'Secret Strategy A', [{ title: 'Task A' }]);
  state.currentUser = { id: 'user-B' };
  state.identityEpoch += 1;
  deferredPlannerSummarize.resolve({ tasks: [{ title: 'Summarized Secret A', timeframe: 'Today', status: 'todo' }] });
  await pSuccessStale;
  assert.equal(dom.window.document.querySelectorAll('.planner-modal-overlay').length, 0, 'Stale summarize success callback must not open modal');

  // 3b) Identity changes before /api/planner/summarize rejects (error fallback path!) -> no modal opened
  state.currentUser = { id: 'user-A' };
  const pErrorStale = context.runSummarizeClick(randomUUID(), 'Secret Strategy A', [{ title: 'Task A' }]);
  state.currentUser = { id: 'user-B' };
  state.identityEpoch += 1;
  deferredPlannerSummarize.reject(new Error('503 Upstream Error'));
  await pErrorStale;
  assert.equal(dom.window.document.querySelectorAll('.planner-modal-overlay').length, 0, 'Stale summarize error fallback callback must not open modal');

  // 3c) Modal opens while identity matches, then identity changes BEFORE confirm click -> confirm closes modal without calling /api/planner/batch
  state.currentUser = { id: 'user-A' };
  const activeEpoch = state.identityEpoch;
  context.openPlannerTaskSelectionModal({
    aiTasks: [{ title: 'Approve pilot', timeframe: 'Today', status: 'todo' }],
    rawTasks: [{ title: 'Approve pilot', timeframe: 'Today' }],
    strategyTitle: 'Strategy A',
    strategyId: randomUUID(),
    isEn: true,
    identityEpoch: activeEpoch,
    expectedUserId: 'user-A',
  });
  const confirmBtn = dom.window.document.querySelector('.planner-modal-confirm-btn');
  assert.ok(confirmBtn, 'Modal should open for active user');
  state.currentUser = { id: 'user-B' };
  state.identityEpoch += 1;
  confirmBtn.click();
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(plannerBatchCalls.length, 0, 'Confirm click after identity switch must not submit tasks for old user');
  assert.equal(dom.window.document.querySelectorAll('.planner-modal-overlay').length, 0, 'Stale confirm click must close modal');
});
