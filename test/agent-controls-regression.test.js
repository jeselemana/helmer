import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { FileUserRepository } from '../src/repositories/file-user-repository.js';
import { PrivacyPolicy, privacySnapshot, executionContext } from '../src/services/security/privacy-policy.js';
import { wrapProvider, configureProviderPolicy } from '../src/services/security/provider-policy.js';
import { getRelevantUserContext, invalidateUserContextCache } from '../src/services/ai/personal-context.js';
import { DistributedResearchService } from '../src/services/ai/distributed-research.js';
import { DurableStore } from '../src/services/security/durable-store.js';
import { AiPolicy, isAiRequest } from '../src/services/security/ai-policy.js';
import { EventEmitter } from 'node:events';
import { ungroundedFallbackConfig } from '../src/services/ai/grounding-fallback.js';
import { providerUsage } from '../src/services/security/provider-usage.js';
import { FileTelemetryRepository } from '../src/repositories/file-telemetry-repository.js';
import { TelemetryService } from '../src/services/telemetry/telemetry-service.js';
import { validateRenderedFile } from '../src/services/artifacts/renderers.js';
import { PDFDocument, PDFName, PDFString } from 'pdf-lib';
import JSZip from 'jszip';
import { buildResearchPrompt } from '../src/services/ai/research-service.js';
import { assertCachedFileReference } from '../src/services/artifacts/upload-context.js';

class RedisFixture {
  isReady = true;
  values = new Map();
  budgetReservations = [];
  usageWrites = [];
  slots = new Map();
  async get(key) { return this.values.get(key) || null; }
  async set(key, value, options = {}) { if (options.NX && this.values.has(key)) return null; this.values.set(key, value); return 'OK'; }
  async publish() {}
  async zRem(_key, token) { this.slots.delete(token); }
  async eval(script, { keys, arguments: args }) {
    if (script.includes("redis.call('set',KEYS[1],ARGV[2]")) {
      if (this.values.get(keys[0]) !== args[0]) return 0;
      this.values.set(keys[0], args[1]); return 1;
    }
    if (script.includes("redis.call('zremrangebyscore'")) { this.budgetReservations.push(args); this.slots.set(args[5], Number(args[4])); return 1; }
    if (script.includes("redis.call('zscore'")) {
      const expiry = this.slots.get(args[0]);
      if (!expiry || expiry <= Number(args[1])) return 0;
      this.slots.set(args[0], Number(args[2])); return 1;
    }
    if (script.includes("redis.call('hincrby'")) { this.usageWrites.push(args); return 1; }
    if (script.includes("redis.call('incr',k)")) return 1;
    if (script.includes("redis.call('pexpire'")) return this.values.get(keys[0]) === args[0] ? 1 : 0;
    if (script.includes("redis.call('del'")) { if (this.values.get(keys[0]) !== args[0]) return 0; this.values.delete(keys[0]); return 1; }
    throw new Error('Unexpected Redis operation in regression fixture');
  }
}

class ResponseFixture extends EventEmitter {
  statusCode = 200;
  status(code) { this.statusCode = code; return this; }
  json(body) { this.body = body; this.writableEnded = true; this.emit('finish'); return this; }
}

async function researchFixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'helmer-research-controls-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const store = new DurableStore(directory, { cloud: false });
  const records = new Map();
  const chats = {
    saveChat: async value => { const chat = { id: value.id || randomUUID(), ownerId: value.ownerId, messages: value.appendMessages || value.messages || [] }; records.set(chat.id, chat); return structuredClone(chat); },
    getById: async (id, ownerId) => records.get(id)?.ownerId === ownerId ? structuredClone(records.get(id)) : null,
    readAll: async ownerId => [...records.values()].filter(chat => !ownerId || chat.ownerId === ownerId),
    patchResearchMessage: async (id, ownerId, jobId, value) => { const chat = records.get(id); assert.equal(chat.ownerId, ownerId); const index = chat.messages.findIndex(message => message.jobId === jobId); chat.messages[index] = structuredClone(value); },
  };
  const redis = new RedisFixture();
  const make = geminiClient => {
    const service = new DistributedResearchService({ jobStore: store, redis, chatRepository: chats, geminiClient });
    t.after(() => service.shutdown());
    return service;
  };
  return { store, records, chats, redis, make };
}

test('personalization OFF forces contribution OFF at the repository and advances a monotonic context epoch', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'helmer-agent-privacy-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const users = new FileUserRepository(path.join(directory, 'users.json'), null, { cloud: false });
  const created = await users.create({ fullName: 'Fixture', username: 'fixture', email: 'fixture@example.com', passwordHash: 'fixture' });
  const enabled = await users.update(created.id, { settings: { personalIntelligence: true, modelImprovement: true } });
  const snapshot = privacySnapshot(enabled);
  const disabled = await users.update(created.id, { settings: { personalIntelligence: false } });
  assert.equal(disabled.settings.modelImprovement, false);
  assert.equal(disabled.privacyEpoch, enabled.privacyEpoch + 1);
  const attack = await users.update(created.id, { settings: { modelImprovement: true } });
  assert.equal(attack.settings.modelImprovement, false);
  const privacy = new PrivacyPolicy(users);
  assert.equal(await privacy.allows(created.id, snapshot), false);
  await assert.rejects(privacy.assertExecution({ ownerId: created.id, privacySnapshot: snapshot }), { code: 'EXECUTION_REVOKED' });
  const fresh = await users.update(created.id, { settings: { personalIntelligence: true } });
  const pending = await users.scheduleDeletion(created.id, 14);
  assert.equal(pending.status, 'pending_deletion');
  await assert.rejects(privacy.assertExecution({ ownerId: created.id, privacySnapshot: privacySnapshot(fresh) }), { code: 'EXECUTION_REVOKED' });
});

test('cached personalization revalidates authoritative records after another replica deletes a chat', async () => {
  const ownerId = randomUUID(), id = randomUUID();
  let records = [{ id, ownerId, messages: [{ role: 'user', content: 'confidential subscription retention plan' }] }];
  const chats = { readAll: async () => structuredClone(records), getById: async recordId => structuredClone(records.find(item => item.id === recordId) || null) };
  const args = { ownerId, userMessage: 'subscription retention', chatRepository: chats };
  assert.match(await getRelevantUserContext(args), /confidential/);
  records = [];
  assert.equal(await getRelevantUserContext(args), '');
  invalidateUserContextCache(ownerId);
});

test('managed shard caches cannot bypass authoritative personalization revalidation', async () => {
  const ownerId = randomUUID(), id = randomUUID();
  let records = [{ id, ownerId, messages: [{ role: 'user', content: 'confidential subscription retention plan' }] }];
  const chats = { syncedShardTags: new Map(), readAll: async () => structuredClone(records), getById: async recordId => structuredClone(records.find(item => item.id === recordId) || null) };
  const strategies = { syncedShardTags: new Map(), readAll: async () => [], getById: async () => null };
  const args = { ownerId, userMessage: 'subscription retention', chatRepository: chats, strategyRepository: strategies };
  try {
    assert.match(await getRelevantUserContext(args), /confidential/);
    records = [];
    assert.equal(await getRelevantUserContext(args), '');
  } finally { invalidateUserContextCache(ownerId); }
});

test('provider revocation is checked before admission and before returning an in-flight result', async t => {
  let allowed = true, calls = 0, releases = 0;
  configureProviderPolicy({ reserveProvider: async () => async () => { releases++; } });
  t.after(() => configureProviderPolicy(undefined));
  const controller = new AbortController();
  const context = { ownerId: randomUUID(), controller, signal: controller.signal, assertAuthorized: async () => {
    if (!allowed) throw Object.assign(new Error('revoked'), { code: 'EXECUTION_REVOKED' });
  } };
  const client = wrapProvider({ responses: { create: async () => { calls++; allowed = false; return { output_text: 'must not escape' }; } } }, 'openai');
  await executionContext.run(context, async () => {
    await assert.rejects(client.responses.create({ model: 'fixture' }), { code: 'EXECUTION_REVOKED' });
    assert.equal(releases, 1);
    await assert.rejects(client.responses.create({ model: 'fixture' }), { code: 'EXECUTION_REVOKED' });
    assert.equal(calls, 1);
  });
});

test('remote research cannot return a checkpoint whose parent chat is deleted or unavailable', async () => {
  const id = randomUUID(), ownerId = randomUUID();
  const service = new DistributedResearchService({ jobStore: { read: async () => ({ id, ownerId, chatId: randomUUID(), content: 'deleted content' }), mutate: async (_key, fn) => fn(null) }, chatRepository: { getById: async () => null, readAll: async () => [] } });
  assert.equal(await service.getJob(id, ownerId), null);
});

test('HTTP admission transfers its tenant lease to background work until explicit release', async () => {
  const redis = new RedisFixture(), policy = new AiPolicy({ redis, env: { NODE_ENV: 'production' } });
  const ownerId = randomUUID(), context = {}, response = new ResponseFixture();
  const req = { method: 'POST', path: '/api/ask/research', body: { prompt: 'fixture research' }, ownerId, user: { emailVerifiedAt: 'now' }, securityContext: context, get: () => 'fixture-idempotency-key', socket: {}, ip: '127.0.0.1' };
  let admitted = false;
  await policy.middleware()(req, response, () => { admitted = true; });
  assert.equal(admitted, true);
  const lease = context.transferToBackground();
  response.json({ jobId: randomUUID() });
  assert.equal(context.signal.aborted, false);
  assert.ok(await redis.get(`security:owner-execution:${ownerId}`));
  await lease.release();
  assert.equal(await redis.get(`security:owner-execution:${ownerId}`), null);
});

test('research across replicas rejects a second job and ordinary requests while the first job is active', async t => {
  const f = await researchFixture(t), ownerId = randomUUID();
  let unblock; const gate = new Promise(resolve => { unblock = resolve; });
  t.after(() => unblock());
  const gemini = { models: { generateContent: async params => {
    await gate;
    if (params.config.tools) return { text: 'Verified fixture evidence.', candidates: [{ groundingMetadata: { groundingChunks: [{ web: { uri: 'https://example.com/evidence', title: 'Fixture' } }] } }] };
    return { text: params.config.maxOutputTokens === 1024 ? '[{"query":"first","label":"First"},{"query":"second","label":"Second"}]' : '{"hasGap":false}' };
  } } };
  const first = f.make(gemini), second = f.make(gemini);
  await first.createResearchJob({ ownerId, prompt: 'fixture research' });
  await assert.rejects(second.createResearchJob({ ownerId, prompt: 'duplicate' }), { code: 'EXECUTION_BUSY' });
  const req = { method: 'POST', path: '/api/ask', body: {}, ownerId, user: { emailVerifiedAt: 'now' }, securityContext: {}, get: () => 'ordinary-idempotency-key', socket: {}, ip: '127.0.0.1' }, res = new ResponseFixture();
  await new AiPolicy({ redis: f.redis, env: { NODE_ENV: 'production' } }).middleware()(req, res, () => assert.fail('ordinary request must not overlap research'));
  assert.equal(res.body.code, 'EXECUTION_BUSY');
  unblock(); await first.waitForAllJobs();
  assert.equal(await f.redis.get(`security:owner-execution:${ownerId}`), null);
});

test('durable recovery reuses checkpointed phases, preserves deadline and never repeats completed model calls', async t => {
  const f = await researchFixture(t), id = randomUUID(), ownerId = randomUUID(), chatId = randomUUID();
  f.records.set(chatId, { id: chatId, ownerId, messages: [{ id: randomUUID(), jobId: id, type: 'research', role: 'assistant', status: 'running' }] });
  const metadata = { groundingChunks: [{ web: { uri: 'https://example.com/report', title: 'Report' } }] };
  const saved = { version: 1, id, ownerId, chatId, status: 'running', prompt: 'fixture', language: 'en', privacySnapshot: { enabled: false, epoch: 0 }, deadlineAt: Date.now() + 60000, createdAt: new Date().toISOString(), steps: [], sources: [], artifacts: [], checkpoint: { subqueries: [{ query: 'one', label: 'One' }, { query: 'two', label: 'Two' }], searches: { 0: { text: 'first evidence', metadata }, 1: { text: 'second evidence', metadata } }, gapResult: { hasGap: false }, synthesis: { rawText: 'Recovered report', metadata, verifiedResearchSources: true, response: null } } };
  await f.store.mutate(`research:${id}`, () => ({ value: saved }));
  const service = f.make({ models: { generateContent: async () => assert.fail('completed phases must not invoke a model') } });
  await service.resumeOrphanedJobs(); await service.waitForAllJobs();
  const recovered = await f.store.read(`research:${id}`);
  assert.equal(recovered.status, 'completed', service.activeJobs.get(id)?.abortController.signal.reason?.stack);
  assert.equal(recovered.content, 'Recovered report');
  assert.equal(recovered.deadlineAt, saved.deadlineAt);
  assert.equal(f.records.get(chatId).messages[0].content, 'Recovered report');
  await service.resumeOrphanedJobs();
  assert.equal(service.runningJobPromises.size, 0);
});

test('UP submit/retry are AI requests and replay is bound to the same canonical payload', async () => {
  const redis = new RedisFixture(), policy = new AiPolicy({ redis, env: { NODE_ENV: 'production' } });
  const path = `/api/up/challenges/${randomUUID()}/submit`, ownerId = randomUUID();
  assert.equal(isAiRequest({ method: 'POST', path }), true);
  assert.equal(isAiRequest({ method: 'POST', path: path.replace('submit', 'retry') }), true);
  const send = async body => {
    const res = new ResponseFixture();
    const req = { method: 'POST', path, ownerId, user: { emailVerifiedAt: 'now' }, body, securityContext: {}, get: () => 'up-replay-fixture-key', socket: {}, ip: '127.0.0.1' };
    let calls = 0;
    await policy.middleware()(req, res, () => { calls++; res.json({ points: 30 }); });
    await new Promise(resolve => setImmediate(resolve));
    return { res, calls };
  };
  assert.equal((await send({ answer: 'A', language: 'en' })).calls, 1);
  const replay = await send({ language: 'en', answer: 'A' });
  assert.equal(replay.calls, 0); assert.deepEqual(replay.res.body, { points: 30 });
  const conflict = await send({ answer: 'B', language: 'en' });
  assert.equal(conflict.res.statusCode, 409); assert.equal(conflict.res.body.code, 'IDEMPOTENCY_CONFLICT');
});

test('ungrounded fallback drops search claims and tool/cache state while preserving safety, abort and file instructions', () => {
  const signal = new AbortController().signal, safetySettings = [{ category: 'fixture' }];
  const config = ungroundedFallbackConfig({ tools: [{ googleSearch: {} }], toolConfig: {}, cachedContent: 'old-search-prompt', systemInstruction: 'Google Search is actively configured', safetySettings, abortSignal: signal, maxOutputTokens: 123 }, 'base instructions', 'attached file instructions');
  assert.equal(config.tools, undefined); assert.equal(config.cachedContent, undefined); assert.equal(config.toolConfig, undefined);
  assert.doesNotMatch(config.systemInstruction, /actively configured/);
  assert.match(config.systemInstruction, /Live Google Search is unavailable/);
  assert.match(config.systemInstruction, /attached file instructions/);
  assert.equal(config.safetySettings, safetySettings); assert.equal(config.abortSignal, signal); assert.equal(config.maxOutputTokens, 123);
});

test('cost reservation includes explicit tool call bound; reported usage and observed excess are recorded once', async () => {
  const redis = new RedisFixture(), policy = new AiPolicy({ redis, env: {} }), context = { ownerId: randomUUID(), controller: new AbortController() };
  const params = { model: 'gpt-6.1-sol', input: 'fixture', tools: [{ type: 'web_search' }], max_tool_calls: 4, max_output_tokens: 10 };
  const release = await policy.reserveProvider(context, params);
  const reserved = Number(redis.budgetReservations[0][0]);
  assert.equal(reserved, Math.ceil((Buffer.byteLength(JSON.stringify(params)) + 4 * 8192) * 2 + 10 * 10 + 4 * 0.05 * 1000000));
  await release.recordUsage({ inputTokens: 1000, outputTokens: 100000, searchCalls: 4 });
  await release.recordUsage({ inputTokens: 1000, outputTokens: 100000, searchCalls: 4 });
  assert.equal(redis.usageWrites.length, 1);
  assert.equal(Number(redis.usageWrites[0][0]), 1000 * 2 + 100000 * 10 + 4 * 50000 - reserved);
  await release(); await release(); assert.equal(redis.slots.size, 0);
});

test('usage normalization includes Gemini thinking tokens and OpenAI completed search calls', () => {
  assert.deepEqual(providerUsage({ usageMetadata: { promptTokenCount: 7, candidatesTokenCount: 11, thoughtsTokenCount: 13 } }), { inputTokens: 7, outputTokens: 24, searchCalls: 0 });
  assert.deepEqual(providerUsage({ response: { usage: { input_tokens: 20, output_tokens: 5 }, output: [{ type: 'web_search_call', status: 'completed' }] } }), { inputTokens: 20, outputTokens: 5, searchCalls: 1 });
  assert.equal(providerUsage({ usage: { input_tokens: -1, output_tokens: 10 } }), null);
});

test('provider lease renewal cannot resurrect an expired slot and aborts the actual controller', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const redis = new RedisFixture(), policy = new AiPolicy({ redis, env: {} }), controller = new AbortController();
  const release = await policy.reserveProvider({ ownerId: randomUUID(), controller }, { model: 'fixture' });
  redis.slots.clear();
  t.mock.timers.tick(30000);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(controller.signal.aborted, true);
  assert.equal(redis.slots.size, 0);
  await release();
});

test('kill switch blocks new provider calls and cancels admitted calls on heartbeat', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const redis = new RedisFixture(), policy = new AiPolicy({ redis, env: {} }), controller = new AbortController();
  const release = await policy.reserveProvider({ ownerId: randomUUID(), controller }, { model: 'fixture' });
  await redis.set('security:ai-paused', '1');
  await assert.rejects(policy.reserveProvider({ ownerId: randomUUID() }, {}), { code: 'EXECUTION_DISABLED' });
  t.mock.timers.tick(30000); await new Promise(resolve => setImmediate(resolve));
  assert.equal(controller.signal.reason.code, 'EXECUTION_DISABLED');
  await release();
});

test('telemetry rechecks opt-out inside its atomic write and retains only operational metadata', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'helmer-telemetry-recheck-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const repo = new FileTelemetryRepository(path.join(dir, 'telemetry.json'), null, { cloud: false });
  let checks = 0;
  const service = new TelemetryService(repo, { allows: async () => ++checks === 1 });
  await service.trackAskQuery({ ownerId: randomUUID(), modelImprovement: true, querySnippet: 'confidential fixture business', usage: { prompt_tokens: 4, completion_tokens: 5 } });
  const event = (await repo.readStore()).events[0];
  assert.equal(event.modelImprovement, false); assert.equal(event.onlyNecessaryData, true);
  assert.doesNotMatch(JSON.stringify(event), /confidential/); assert.equal(event.tokens.total, 9);
});

test('artifact validation rejects HTTP Office relationships and PDF active/embedded actions', async () => {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<Types/>'); zip.file('word/document.xml', '<document/>');
  zip.file('word/_rels/document.xml.rels', '<Relationships><Relationship Id="r1" TargetMode="External" Target="http://example.com"/></Relationships>');
  await assert.rejects(validateRenderedFile(await zip.generateAsync({ type: 'nodebuffer' }), 'docx'), /Unsafe external relationship/);
  const pdf = await PDFDocument.create(); pdf.addPage();
  pdf.catalog.set(PDFName.of('OpenAction'), pdf.context.obj({ S: PDFName.of('JavaScript'), JS: PDFString.of('fixture') }));
  await assert.rejects(validateRenderedFile(Buffer.from(await pdf.save()), 'pdf'), /Unsafe PDF/);
});

test('telemetry writes tenant shards and opt-out scrubs only the matching tenant, preserving legacy admin reads', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'helmer-telemetry-shards-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const repo = new FileTelemetryRepository(path.join(dir, 'telemetry.json'), null, { cloud: false });
  const service = new TelemetryService(repo);
  await fs.writeFile(repo.filePath, JSON.stringify({ schemaVersion: 1, events: [{ id: 'legacy', timestamp: new Date().toISOString(), summary: 'legacy record' }] }));
  const first = randomUUID(), second = randomUUID();
  await service.trackAskQuery({ ownerId: first, querySnippet: 'first confidential business', modelImprovement: true });
  await service.trackAskQuery({ ownerId: second, querySnippet: 'second confidential business', modelImprovement: true });
  assert.equal((await repo.readOwner(first)).events.length, 1);
  assert.doesNotMatch(JSON.stringify(await repo.readOwner(first)), /second confidential/);
  assert.equal((await repo.readStore()).events.length, 3);
  assert.equal((await fs.readdir(repo.shardsDirectory)).filter(name => name.endsWith('.json')).length, 2);
  await repo.scrubOwner(first);
  assert.doesNotMatch(JSON.stringify(await repo.readOwner(first)), /first confidential/);
  assert.match(JSON.stringify(await repo.readOwner(second)), /second confidential/);
  assert.equal((await repo.readStore()).events.length, 3);
  await repo.deleteAllByOwner(first);
  await service.trackAskQuery({ ownerId: first, querySnippet: 'late private write' });
  assert.equal((await repo.readOwner(first)).events.length, 0);
  assert.match(JSON.stringify(await repo.readOwner(second)), /second confidential/);
});

test('late progress and usage writes cannot resurrect cancelled or deleted durable research', async t => {
  const f = await researchFixture(t), ownerId = randomUUID(), id = randomUUID(), service = f.make(null);
  await f.store.mutate(`research:${id}`, () => ({ value: { id, ownerId, status: 'cancelled' } }));
  await assert.rejects(service.persistCheckpoint(id, { ownerId, status: 'running', content: 'stale' }), { code: 'EXECUTION_REVOKED' });
  assert.equal((await f.store.read(`research:${id}`)).status, 'cancelled');
  await f.store.mutate(`research:${id}`, () => ({ value: null }));
  await assert.rejects(service.persistCheckpoint(id, { ownerId, status: 'completed', content: 'stale' }), { code: 'EXECUTION_LOCK_LOST' });
  assert.equal(await f.store.read(`research:${id}`), null);
});

test('an in-flight provider is aborted when its privacy authorization is revoked', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  let user = { id: randomUUID(), status: 'active', privacyEpoch: 1, authVersion: 1, settings: { personalIntelligence: true, modelImprovement: true } };
  const privacy = new PrivacyPolicy({ findById: async () => user });
  const controller = new AbortController();
  const context = { ownerId: user.id, privacySnapshot: privacySnapshot(user), controller, signal: controller.signal };
  context.assertAuthorized = () => privacy.assertExecution(context);
  let entered; const started = new Promise(resolve => { entered = resolve; });
  let releases = 0;
  configureProviderPolicy({ reserveProvider: async () => async () => { releases++; } });
  t.after(() => configureProviderPolicy(undefined));
  const client = wrapProvider({ responses: { create: async (_params, { signal }) => {
    entered();
    return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
  } } }, 'openai');
  const pending = executionContext.run(context, () => client.responses.create({ model: 'fixture' }));
  const rejected = assert.rejects(pending, { code: 'EXECUTION_REVOKED' });
  await started;
  user = { ...user, privacyEpoch: 2, settings: { personalIntelligence: false, modelImprovement: false } };
  t.mock.timers.tick(1000); await rejected;
  assert.equal(controller.signal.aborted, true); assert.equal(releases, 1);
});

test('expired durable research is interrupted without model calls or resetting its deadline', async t => {
  const f = await researchFixture(t), id = randomUUID(), chatId = randomUUID(), ownerId = randomUUID();
  f.records.set(chatId, { id: chatId, ownerId, messages: [{ id: randomUUID(), jobId: id, type: 'research', status: 'running' }] });
  const deadlineAt = Date.now() - 1;
  await f.store.mutate(`research:${id}`, () => ({ value: { id, ownerId, chatId, version: 1, status: 'running', createdAt: new Date().toISOString(), deadlineAt, privacySnapshot: { enabled: false, epoch: 0 }, steps: [], sources: [] } }));
  const service = f.make({ models: { generateContent: async () => assert.fail('expired work cannot invoke models') } });
  await service.resumeOrphanedJobs();
  assert.equal((await f.store.read(`research:${id}`)).status, 'interrupted');
  assert.equal((await f.store.read(`research:${id}`)).deadlineAt, deadlineAt);
  assert.equal(f.records.get(chatId).messages[0].status, 'interrupted');
});

test('research synthesis without a search tool never instructs the fallback model to use live Google Search', () => {
  const english = buildResearchPrompt({ prompt: 'fixture', language: 'en', gatheredEvidence: 'provided evidence', enableSearch: false });
  assert.match(english.systemInstruction, /Live search is unavailable/);
  assert.doesNotMatch(english.systemInstruction, /You have real-time access/);
  const az = buildResearchPrompt({ prompt: 'fixture', language: 'az', enableSearch: false });
  assert.match(az.systemInstruction, /canlı axtarış əlçatan deyil/);
  assert.doesNotMatch(az.systemInstruction, /çıxışın var/);
});

test('telemetry cloud shards use conditional writes across independent replicas without a legacy-store mutation', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'helmer-cloud-telemetry-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const objects = new Map(); let revision = 0;
  const options = {
    cloud: true,
    readCloud: async () => ({ record: { schemaVersion: 1, events: [{ id: 'legacy' }] }, etag: 'legacy' }),
    writeCloud: async () => assert.fail('tenant writes cannot mutate the legacy global store'),
    readShard: async key => {
      const object = objects.get(key);
      await new Promise(resolve => setImmediate(resolve));
      return { record: object ? structuredClone(object.value) : null, etag: object?.etag || null };
    },
    writeShard: async (key, value, etag) => {
      if ((objects.get(key)?.etag || null) !== etag) return false;
      objects.set(key, { value: structuredClone(value), etag: String(++revision) }); return true;
    },
    listShards: async () => [...objects.keys()].map(key => `data/telemetry-v2/${key}.json`),
  };
  const first = new FileTelemetryRepository(path.join(dir, 'replica-a', 'telemetry.json'), null, options);
  const second = new FileTelemetryRepository(path.join(dir, 'replica-b', 'telemetry.json'), null, options);
  const ownerId = randomUUID();
  await Promise.all(Array.from({ length: 6 }, (_, index) => (index % 2 ? first : second).recordEvent({ id: `fixture-${index}` }, { ownerId })));
  assert.equal((await first.readOwner(ownerId)).events.length, 6);
  assert.equal((await second.readStore()).events.length, 7);
  assert.equal(objects.size, 1);
});

test('cached file IDs require a live owner-scoped conversation reference; explicit fresh uploads remain usable', () => {
  const file = { fileId: 'gfc_fixture', name: 'fixture.txt' };
  assert.throws(() => assertCachedFileReference(file, null), { code: 'VALIDATION_ERROR' });
  assert.throws(() => assertCachedFileReference(file, { messages: [{ file: { fileId: 'another-file' } }] }), { code: 'VALIDATION_ERROR' });
  assert.doesNotThrow(() => assertCachedFileReference(file, { messages: [{ file }] }));
  assert.doesNotThrow(() => assertCachedFileReference({ ...file, textContent: 'explicitly reattached content' }, null));
});

test('graceful research shutdown persists pending checkpoints and releases leases for a new worker', async t => {
  const f = await researchFixture(t), ownerId = randomUUID();
  let entered; const searching = new Promise(resolve => { entered = resolve; });
  let decompositionCalls = 0;
  const first = f.make({ models: { generateContent: async params => {
    if (!params.config.tools) { decompositionCalls++; return { text: '[{"query":"first","label":"First"},{"query":"second","label":"Second"}]' }; }
    entered();
    return new Promise((_resolve, reject) => params.config.abortSignal.addEventListener('abort', () => reject(params.config.abortSignal.reason), { once: true }));
  } } });
  const result = await first.createResearchJob({ ownerId, prompt: 'fixture research' });
  await searching;
  await first.shutdown();
  const saved = await f.store.read(`research:${result.jobId}`);
  assert.equal(saved.status, 'pending'); assert.ok(saved.checkpoint.subqueries);
  assert.equal(await f.redis.get(`security:owner-execution:${ownerId}`), null);
  assert.equal(await f.redis.get(`helmer:research:lease:${result.jobId}`), null);
  const second = f.make({ models: { generateContent: async params => {
    if (!params.config.tools) return { text: '{"hasGap":false}' };
    return { text: 'Recovered grounded fixture.', candidates: [{ groundingMetadata: { groundingChunks: [{ web: { uri: 'https://example.com/evidence', title: 'Evidence' } }] } }] };
  } } });
  await second.resumeOrphanedJobs(); await second.waitForAllJobs();
  assert.equal((await f.store.read(`research:${result.jobId}`)).status, 'completed');
  assert.equal(decompositionCalls, 1);
});

test('research writes a durable intent before chat creation and a rejected initialization never starts later', async t => {
  const f = await researchFixture(t), ownerId = randomUUID();
  let calls = 0;
  f.chats.saveChat = async () => {
    const intents = (await f.store.entries()).filter(entry => entry.key.startsWith('research:'));
    assert.equal(intents.length, 1); assert.equal(intents[0].value.ownerId, ownerId);
    throw new Error('fixture chat storage failure');
  };
  const service = f.make({ models: { generateContent: async () => { calls++; return { text: 'fixture' }; } } });
  await assert.rejects(service.createResearchJob({ ownerId, prompt: 'fixture research' }), /storage failure/);
  const saved = (await f.store.entries()).find(entry => entry.key.startsWith('research:')).value;
  assert.equal(saved.status, 'failed');
  await service.resumeOrphanedJobs(); assert.equal(calls, 0);
  assert.equal(await f.redis.get(`security:owner-execution:${ownerId}`), null);
});

test('Research callers never turn terminal failures into a plan, empty search, or gap fallback', async () => {
  const { decomposeResearchTopic, executeTargetedSearch, analyzeResearchGaps } = await import('../src/services/ai/research-service.js');
  for (const code of ['EXECUTION_REVOKED', 'EXECUTION_DISABLED', 'EXECUTION_LOCK_LOST', 'EXECUTION_TIMEOUT']) {
    let calls = 0;
    const geminiClient = { models: { generateContent: async () => { calls++; throw Object.assign(new Error('terminal'), { code }); } } };
    for (const caller of [decomposeResearchTopic, executeTargetedSearch, analyzeResearchGaps]) {
      await assert.rejects(caller({ prompt: 'fixture', query: 'fixture', geminiClient }), { code });
    }
    assert.equal(calls, 3);
  }
});

test('Ask streaming and non-streaming callers do not fall back after revoke; required grounding never leaks ungrounded chunks', async () => {
  const { createGoogleGroundedAskService: createAskService } = await import('./helpers/legacy-google-grounded-ask.js');
  const load = (name, _end, client) => options => createAskService({ getClient: () => client })({
    ...options, ...(name.includes('Stream') ? { onChunk: options.onChunk || (() => {}) } : {}),
  });
  for (const streaming of [true, false]) {
    let calls = 0;
    const client = { models: { [streaming ? 'generateContentStream' : 'generateContent']: async () => { calls++; throw Object.assign(new Error('revoked'), { code: 'EXECUTION_REVOKED' }); } } };
    const caller = load(streaming ? 'generateGeminiAskStreamResponse' : 'generateGeminiAskResponse', streaming ? 'async function generateGeminiAskResponse' : 'const capabilityWorkflow', client);
    await assert.rejects(caller({ enableSearch: true }), { code: 'EXECUTION_REVOKED' });
    assert.equal(calls, 1);
  }
  let calls = 0, chunks = [];
  const caller = load('generateGeminiAskStreamResponse', 'async function generateGeminiAskResponse', { models: { generateContentStream: async () => {
    calls++; return (async function* () { yield { text: 'unverified text' }; })();
  } } });
  await assert.rejects(caller({ enableSearch: true, requireGrounding: true, onChunk: chunk => chunks.push(chunk) }), { code: 'GROUNDING_UNAVAILABLE' });
  assert.equal(calls, 1); assert.deepEqual(chunks, []);
});

test('new Research worker fences every old worker checkpoint, status, chat projection and cleanup after abrupt lease loss', async t => {
  const { FileChatRepository } = await import('../src/repositories/file-chat-repository.js');
  const { acquireOwnerExecutionLease } = await import('../src/services/security/owner-execution-lease.js');
  const f = await researchFixture(t), ownerId = randomUUID(), id = randomUUID(), chatId = randomUUID();
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'helmer-fenced-chat-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const chats = new FileChatRepository(path.join(directory, 'chats.json'), null, { cloud: false });
  await chats.saveChat({ id: chatId, ownerId, messages: [{ role: 'assistant', type: 'research', jobId: id, status: 'running', content: '' }] });
  const saved = { id, ownerId, chatId, status: 'running', version: 1, language: 'en', prompt: 'fixture', createdAt: new Date().toISOString(), deadlineAt: Date.now() + 60000, privacySnapshot: { enabled: false, epoch: 0 }, steps: [], sources: [], artifacts: [], checkpoint: {} };
  await f.store.mutate(`research:${id}`, () => ({ value: saved }));
  const first = f.make(), second = f.make(); first.chatRepository = chats; second.chatRepository = chats;
  const old = { ...saved, abortController: new AbortController(), subscribers: new Set() };
  old.executionLease = { lease: await acquireOwnerExecutionLease(f.redis, ownerId, old.abortController) };
  await first.claimJob(old); first.activeJobs.set(id, old);
  // Simulate a replica disappearing: both Redis leases expire without shutdown.
  f.redis.values.delete(`security:owner-execution:${ownerId}`);
  const next = { ...saved, abortController: new AbortController(), subscribers: new Set() };
  next.executionLease = { lease: await acquireOwnerExecutionLease(f.redis, ownerId, next.abortController) };
  await second.claimJob(next); second.activeJobs.set(id, next);
  next.content = 'successor'; await second.persistJobMessage(next);
  old.content = 'stale'; old.status = 'cancelled';
  await assert.rejects(first.persistJobMessage(old), { code: 'EXECUTION_LOCK_LOST' });
  await assert.rejects(first.persistCheckpoint(id, { ownerId, checkpoint: { stale: true } }), { code: 'EXECUTION_LOCK_LOST' });
  await assert.rejects(first.rollbackJobArtifacts(old), { code: 'EXECUTION_LOCK_LOST' });
  await assert.rejects(chats.patchResearchMessage(chatId, ownerId, id, { content: 'stale' }, { executionFence: old.executionFence }), { code: 'EXECUTION_LOCK_LOST' });
  assert.equal((await f.store.read(`research:${id}`)).content, 'successor');
  assert.equal((await chats.getById(chatId, ownerId)).messages[0].content, 'successor');
  await old.executionLease.lease.release();
  await next.executionLease.lease.assertOwned();
  await next.executionLease.lease.release();
  first.activeJobs.clear(); second.activeJobs.clear();
});

test('kill switch during an active provider call aborts the linked route and prevents an uncooperative provider result', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const { createExecutionController } = await import('../src/services/security/execution-control.js');
  const redis = new RedisFixture(), policy = new AiPolicy({ redis, env: {} });
  configureProviderPolicy(policy); t.after(() => configureProviderPolicy(undefined));
  const controller = new AbortController(), context = { ownerId: randomUUID(), controller, signal: controller.signal, assertAuthorized: async () => {} };
  await executionContext.run(context, async () => {
    const route = createExecutionController();
    let resolve, entered; const started = new Promise(done => { entered = done; });
    const client = wrapProvider({ responses: { create: async () => { entered(); return new Promise(done => { resolve = done; }); } } }, 'openai');
    const pending = client.responses.create({ model: 'fixture' }, { signal: route.signal });
    await started; redis.values.set('security:ai-paused', '1');
    t.mock.timers.tick(1000); await new Promise(done => setImmediate(done));
    assert.equal(route.signal.aborted, true);
    resolve({ output_text: 'must not return' });
    await assert.rejects(pending, { code: 'EXECUTION_DISABLED' });
    assert.equal(redis.slots.size, 0);
  });
});

test('usage reconciliation refunds unused tokens once, retains unknown search charges and never adds thinking budget twice', async () => {
  const redis = new RedisFixture(), policy = new AiPolicy({ redis, env: {} });
  const params = { model: 'gemini-4-hydrogen', config: { maxOutputTokens: 8192, thinkingConfig: { thinkingBudget: 24576 }, tools: [{ googleSearch: {} }] } };
  const release = await policy.reserveProvider({ ownerId: randomUUID() }, params);
  const reservation = Number(redis.budgetReservations[0][0]);
  assert.equal(reservation, Math.ceil(Buffer.byteLength(JSON.stringify(params)) * 1.50 + 8192 * 7.50 + 35000));
  await release.recordUsage({ inputTokens: 100, outputTokens: 200, searchCalls: 0, searchUsageKnown: false });
  await release.recordUsage({ inputTokens: 100, outputTokens: 200, searchCalls: 0, searchUsageKnown: false });
  assert.equal(redis.usageWrites.length, 1);
  assert.equal(Number(redis.usageWrites[0][0]), Math.ceil(100 * 1.50 + 200 * 7.50 + 35000) - reservation);
  await release();
});

test('UP HTTP safely replays a 503 after durable completion without repeating reward or accepting a different answer', async t => {
  const express = (await import('express')).default;
  const { createUpRouter } = await import('../src/http/up-router.js');
  const { UpService } = await import('../src/services/up/up-service.js');
  const { FileUpRepository } = await import('../src/repositories/file-up-repository.js');
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'helmer-up-replay-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const ownerId = randomUUID(), id = randomUUID(), repository = new FileUpRepository(directory, { cloud: false });
  await repository.mutate(ownerId, state => {
    state.preferences = { dailyGoal: 10, weeklyGoal: 20, interests: ['Finance'], timezone: 'Asia/Baku' };
    state.challenges.push({ id, ownerId, title: 'Fixture', status: 'ready', category: 'Finance', difficulty: 1, maximumPoints: 40, answer: null,
      options: [{ id: 'A', text: 'Fixture A', score: 40, is_optimal: true }, { id: 'B', text: 'Fixture B', score: 10 }], attempts: 0 });
  });
  const service = new UpService(repository, { ai: { generate: () => assert.fail('No model call'), evaluate: () => assert.fail('No model call') } });
  const flush = service.flush.bind(service); let failAfterCommit = true;
  service.flush = async (...args) => { if (failAfterCommit) { failAfterCommit = false; throw new Error('Simulated response failure after commit'); } return flush(...args); };
  const redis = new RedisFixture(), policy = new AiPolicy({ redis, env: { NODE_ENV: 'production' } });
  const app = express(); app.use(express.json());
  app.use((req, res, next) => {
    req.ownerId = ownerId; req.user = { id: ownerId, emailVerifiedAt: 'now' }; req.auth = { user: req.user };
    req.securityContext = { ownerId, assertAuthorized: async () => {} };
    executionContext.run(req.securityContext, next);
  });
  app.use(policy.middleware()); app.use('/api/up', createUpRouter(service));
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const url = `http://127.0.0.1:${server.address().port}/api/up/challenges/${id}/submit`;
  const send = answer => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'safe-http-replay-key' }, body: JSON.stringify({ selectedOption: answer, language: 'en' }) });
  const failed = await send('A'); assert.equal(failed.status, 503); await failed.text();
  await new Promise(resolve => setImmediate(resolve));
  const replay = await send('A'); assert.equal(replay.status, 200); assert.equal((await replay.json()).status, 'completed');
  const changed = await send('B'); assert.equal(changed.status, 409); assert.equal((await changed.json()).code, 'IDEMPOTENCY_CONFLICT');
  const state = await repository.read(ownerId); assert.equal(state.transactions.length, 1); assert.equal(state.totalPoints, 40);
});

test('Office upload preflight bounds non-XML parts before handing the archive to ExcelJS', async () => {
  const { prepareUploadedContext } = await import('../src/services/artifacts/upload-context.js');
  const zip = new JSZip(); zip.file('xl/workbook.xml', '<workbook/>'); zip.file('xl/media/huge.bin', Buffer.alloc(11 * 1024 * 1024));
  const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  await assert.rejects(prepareUploadedContext({ name: 'fixture.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', data: buffer.toString('base64') }), /decompression limit/);
});

test('PDF output validation rejects an indirect nested action and accepts a plain HTTPS link', async () => {
  const unsafe = await PDFDocument.create(); unsafe.addPage();
  unsafe.catalog.set(PDFName.of('Fixture'), unsafe.context.register(unsafe.context.obj({ S: 'JavaScript', JS: PDFString.of('fixture()') })));
  await assert.rejects(validateRenderedFile(Buffer.from(await unsafe.save()), 'pdf'), /Unsafe|active|PDF/i);
  const safe = await PDFDocument.create(); safe.addPage();
  safe.catalog.set(PDFName.of('Fixture'), safe.context.register(safe.context.obj({ S: 'URI', URI: PDFString.of('https://example.com/reference') })));
  await validateRenderedFile(Buffer.from(await safe.save()), 'pdf');
});

test('historical strategy telemetry records unknown usage without fabricating tokens, prices or latency', async () => {
  let saved;
  const repository = { readStore: async () => ({ events: [] }), recordEvent: async event => { saved = event; } };
  const telemetry = new TelemetryService(repository);
  await telemetry.syncHistoricalIfEmpty({ strategyRepository: { readAll: async () => [{ id: randomUUID(), ownerId: randomUUID(), title: 'Fixture' }] } });
  assert.equal(saved.tokens, null); assert.equal(saved.costUsd, null); assert.equal(saved.latencyMs, null); assert.equal(saved.qualityScore, null);
});

test('Research recovery after abrupt replica loss completes on a new worker and rejects the old pending provider response', async t => {
  const f = await researchFixture(t), ownerId = randomUUID();
  let unblock, entered; const started = new Promise(resolve => { entered = resolve; });
  const first = f.make({ models: { generateContent: async () => { entered(); return new Promise(resolve => { unblock = resolve; }); } } });
  const created = await first.createResearchJob({ ownerId, prompt: 'fixture replica recovery' });
  await started;
  const old = [...first.activeJobs.values()][0];
  f.redis.values.delete(`security:owner-execution:${ownerId}`);
  f.redis.values.delete(`helmer:research:lease:${old.id}`);
  const second = f.make({ models: { generateContent: async params => {
    if (params.config.maxOutputTokens === 1024) return { text: '[{"query":"first","label":"One"},{"query":"second","label":"Two"}]' };
    if (params.config.maxOutputTokens === 512) return { text: '{"hasGap":false}' };
    return { text: 'Recovered fixture report', candidates: [{ groundingMetadata: { groundingChunks: [{ web: { uri: 'https://example.com/evidence', title: 'Fixture' } }] } }] };
  } } });
  await second.resumeOrphanedJobs(); await second.waitForAllJobs();
  const recovered = await f.store.read(`research:${old.id}`);
  assert.equal(recovered.status, 'completed'); assert.ok(recovered.executionFence > old.executionFence);
  unblock({ text: '[{"query":"stale","label":"Stale"},{"query":"old","label":"Old"}]' });
  await first.waitForAllJobs();
  assert.deepEqual(await f.store.read(`research:${old.id}`), recovered);
  assert.equal(f.records.get(old.chatId).messages.find(message => message.jobId === old.id).status, 'completed');
});

test('settings caller honors the server privacy invariant and leaves state unchanged after a failed save', async () => {
  const vm = await import('node:vm');
  const source = await fs.readFile(new URL('../public/script.js', import.meta.url), 'utf8');
  const code = source.slice(source.indexOf('function isPersonalIntelligenceActive()'), source.indexOf('function attachSwipeDownToClose'));
  const state = { currentUser: { settings: { personalIntelligence: false, modelImprovement: false } } };
  let calls = 0, fail = false;
  const context = { state, structuredClone, getLanguage: () => 'en', showToast() {}, setCookie() {},
    localStorage: { getItem: () => null, setItem() {} },
    authRequest: async (_url, options) => {
      calls++; if (fail) throw new Error('fixture unavailable');
      const settings = { ...state.currentUser.settings, ...JSON.parse(options.body) };
      if (!settings.personalIntelligence) settings.modelImprovement = false;
      return { user: { settings } };
    }, updateWorkspaceIdentity: user => { state.currentUser = user; },
  };
  const api = vm.runInNewContext(`(() => { ${code}; return { togglePersonalIntelligence, toggleModelImprovement, isModelImprovementActive }; })()`, context);
  await api.toggleModelImprovement(true); assert.equal(calls, 0);
  await api.togglePersonalIntelligence(true); await api.toggleModelImprovement(true); assert.equal(api.isModelImprovementActive(), true);
  fail = true; await api.togglePersonalIntelligence(false); assert.equal(api.isModelImprovementActive(), true);
  fail = false; await api.togglePersonalIntelligence(false);
  assert.equal(state.currentUser.settings.modelImprovement, false); assert.equal(api.isModelImprovementActive(), false);
  fail = true; await api.toggleModelImprovement(false); assert.equal(state.currentUser.settings.modelImprovement, false);
});

test('active Research kill switch stops downstream search and persists cancellation without fallback', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const f = await researchFixture(t); let paused = false, unblock, entered, calls = 0;
  configureProviderPolicy({ assertEnabled: async () => { if (paused) throw Object.assign(new Error('paused'), { code: 'EXECUTION_DISABLED' }); } });
  t.after(() => configureProviderPolicy(undefined));
  const started = new Promise(resolve => { entered = resolve; });
  const service = f.make({ models: { generateContent: async () => { calls++; entered(); return new Promise(resolve => { unblock = resolve; }); } } });
  await service.createResearchJob({ ownerId: randomUUID(), prompt: 'fixture kill switch' }); await started;
  paused = true; t.mock.timers.tick(1000);
  await new Promise(resolve => setImmediate(resolve));
  const job = [...service.activeJobs.values()][0]; assert.equal(job.abortController.signal.reason.code, 'EXECUTION_DISABLED');
  unblock({ text: '[{"query":"one","label":"One"},{"query":"two","label":"Two"}]' }); await service.waitForAllJobs();
  assert.equal(calls, 1); assert.equal((await f.store.read(`research:${job.id}`)).status, 'cancelled');
});

test('Priority 1: primary /api/ask HTTP route enforces requireGrounding on streaming and non-streaming paths and blocks ungrounded answers', async t => {
  const express = (await import('express')).default;
  const { evaluateSearchRoute } = await import('../src/services/ai/search-router.js');
  const { resolveAskModelRoute, resolveAskThinkingLevel } = await import('../src/services/ai/ask-routing.js');
  const { buildAskPrompt, formatGuestAnswerWithCta, createGuestAnswerStream, detectGuestFunctionalRestriction, GUEST_EXHAUSTED_MESSAGE } = await import('../src/services/ai/prompts.js');
  const { assertExecutionActive, assertExecutionAuthorized, createExecutionController } = await import('../src/services/security/execution-control.js');
  const { httpStatusOf, publicErrorMessage } = await import('../src/http/error-response.js');
  let activeClient = null;
  const savedChats = [];
  const app = express();
  app.use(express.json());
  const ownerId = randomUUID();
  app.use((req, _res, next) => {
    req.ownerId = ownerId;
    req.user = { id: ownerId, emailVerifiedAt: 'now', settings: { personalIntelligence: false, modelImprovement: false } };
    req.securityContext = { ownerId, assertAuthorized: async () => {} };
    executionContext.run(req.securityContext, next);
  });
  const sandbox = {
    app,
    askRateLimit: () => (_req, _res, next) => next(),
    Date, Array, Object, String, Number, Boolean, Promise, Set, Map, Error, RegExp, JSON, Math, Buffer,
    setInterval, clearInterval, setTimeout, clearTimeout,
    ASK_MODEL: 'gemini-3.8-flash',
    ASK_GEMINI_MODEL: 'gemini-3.8-flash',
    ASK_INSTRUCTIONS: 'fixture instructions',
    aiConfig: {},
    GEMINI_SAFETY_SETTINGS: [],
    hasGeminiConfiguration: () => true,
    getGeminiClient: () => activeClient,
    sanitizeGroundingMetadata: meta => meta?.groundingChunks?.length ? meta : null,
    ungroundedFallbackConfig,
    assertExecutionActive,
    assertExecutionAuthorized,
    createExecutionController,
    LLMProviderError: class extends Error { constructor(msg, fields) { super(msg); Object.assign(this, fields); } },
    formatGeminiErrorMessage: () => 'provider error',
    buildGeminiAskContents: async ({ messages }) => ({ contents: messages.map(m => ({ role: m.role, parts: [{ text: m.content }] })) }),
    evaluateSearchRoute,
    resolveAskModelRoute,
    resolveAskThinkingLevel,
    buildAskPrompt,
    formatGuestAnswerWithCta,
    createGuestAnswerStream,
    detectGuestFunctionalRestriction,
    GUEST_EXHAUSTED_MESSAGE,
    guestMessageBalance: () => ({ available: 5, remaining: 4 }),
    chatRepository: {
      getById: async () => null,
      saveChat: async chat => { savedChats.push(chat); return { id: randomUUID(), revision: 1, ...chat }; },
    },
    strategyRepository: { getById: async () => null },
    plannerRepository: { list: async () => [] },
    buildPersonalizationContext: async () => '',
    assertCachedFileReference,
    prepareUploadedContext: async f => f,
    geminiFileCache: { resolveFile: () => null },
    learningLoop: {
      createInteractionId: () => randomUUID(),
      recordInteraction: async () => {},
      recordSignal: async () => {},
    },
    logWithoutBlocking: () => {},
    telemetryService: { trackAskQuery: async () => {} },
    isModelImprovementEnabled: () => false,
    getReqPrivacySnapshot: () => ({ enabled: false, epoch: 0, ownerId }),
    httpStatusOf,
    publicErrorMessage,
    researchService: {},
    console: { warn() {}, error() {}, log() {} },
  };
  const { createAskHandler } = await import('../src/http/ask-handler.js');
  const { createGoogleGroundedAskService: createAskService } = await import('./helpers/legacy-google-grounded-ask.js');
  app.post('/api/ask', createAskHandler({
    ...sandbox, configured: () => true,
    generateAsk: createAskService({ getClient: () => activeClient, sanitizeGroundingMetadata: sandbox.sanitizeGroundingMetadata }),
  }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const url = `http://127.0.0.1:${server.address().port}/api/ask`;
  const mandatorySearchPrompt = '2026-cı ildə son rəsmi inflyasiya faizi və Mərkəzi Bankın faiz dərəcəsi nə qədərdir?';

  // 1) Non-streaming: search returns ungrounded text without groundingMetadata -> must fail closed (503 GROUNDING_UNAVAILABLE) and never save chat
  let nonStreamCalls = 0;
  activeClient = {
    models: {
      generateContent: async () => {
        nonStreamCalls++;
        return { text: 'Mənbəsiz cavab.', candidates: [{}] };
      },
    },
  };
  const ungroundedJsonRes = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() },
    body: JSON.stringify({ stream: false, messages: [{ role: 'user', content: mandatorySearchPrompt }] }),
  });
  assert.equal(ungroundedJsonRes.status, 503);
  const ungroundedJsonBody = await ungroundedJsonRes.json();
  assert.equal(ungroundedJsonBody.code, 'GROUNDING_UNAVAILABLE');
  assert.equal(nonStreamCalls, 1);
  assert.equal(savedChats.length, 0);

  // 2) Streaming: search stream yields text without groundingMetadata -> must never emit ungrounded chunk or save chat
  let streamCalls = 0;
  activeClient = {
    models: {
      generateContentStream: async () => {
        streamCalls++;
        return (async function* () {
          yield { text: 'Mənbəsiz axın mətni.', candidates: [{}] };
        })();
      },
    },
  };
  const ungroundedStreamRes = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() },
    body: JSON.stringify({ stream: true, messages: [{ role: 'user', content: mandatorySearchPrompt }] }),
  });
  assert.equal(ungroundedStreamRes.status, 200);
  const sseRaw = await ungroundedStreamRes.text();
  const sseEvents = sseRaw.trim().split('\n\n').filter(line => line.startsWith('data: ')).map(line => JSON.parse(line.slice(6)));
  assert.equal(sseEvents.some(ev => ev.chunk || ev.done || ev.reply), false);
  assert.equal(sseEvents.at(-1).code, 'GROUNDING_UNAVAILABLE');
  assert.equal(streamCalls, 1);
  assert.equal(savedChats.length, 0);

  // 3) Grounded non-streaming & streaming succeed when groundingMetadata is present
  const validGrounding = { groundingChunks: [{ web: { uri: 'https://cbar.az/rate', title: 'CBAR' } }] };
  activeClient = {
    models: {
      generateContent: async () => ({
        text: 'Təsdiqlənmiş cavab.',
        candidates: [{ groundingMetadata: validGrounding }],
        usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 10, thoughtsTokenCount: 5, totalTokenCount: 35 },
      }),
      generateContentStream: async () => (async function* () {
        yield {
          text: 'Təsdiqlənmiş axın cavabı.',
          candidates: [{ groundingMetadata: validGrounding }],
          usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 10, thoughtsTokenCount: 5, totalTokenCount: 35 },
        };
      })(),
    },
  };
  const okJsonRes = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() },
    body: JSON.stringify({ stream: false, messages: [{ role: 'user', content: mandatorySearchPrompt }] }),
  });
  assert.equal(okJsonRes.status, 200);
  const okJson = await okJsonRes.json();
  assert.equal(okJson.reply, 'Təsdiqlənmiş cavab.');
  assert.equal(okJson.groundingMetadata.groundingChunks.length, 1);
  assert.equal(savedChats.length, 1);

  // A metadata-only grounding event releases the buffered text while the
  // provider is still running. Later deltas must not be duplicated at finish.
  let releaseProvider;
  const providerGate = new Promise(resolve => { releaseProvider = resolve; });
  activeClient.models.generateContentStream = async () => (async function* () {
    yield { text: 'İlk hissə.', candidates: [{}] };
    yield { text: '', candidates: [{ groundingMetadata: validGrounding }] };
    await providerGate;
    yield { text: ' Son hissə.', candidates: [{}] };
  })();
  try {
    const response = await fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() },
      signal: AbortSignal.timeout(5000),
      body: JSON.stringify({ stream: true, messages: [{ role: 'user', content: mandatorySearchPrompt }] }),
    });
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let received = '';
    while (!received.includes('İlk hissə.')) {
      const part = await reader.read();
      assert.equal(part.done, false, 'Grounded prefix must arrive before provider completion');
      received += decoder.decode(part.value, { stream: true });
    }
    assert.equal(savedChats.length, 1, 'Streaming must begin before the final save');
    releaseProvider();
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      received += decoder.decode(part.value, { stream: true });
    }
    const events = received.split('\n\n').filter(line => line.startsWith('data: ')).map(line => JSON.parse(line.slice(6)));
    assert.equal(events.filter(event => event.chunk).map(event => event.chunk).join(''), 'İlk hissə. Son hissə.');
    assert.equal(events.find(event => event.chunk).groundingMetadata.groundingChunks.length, 1);
    assert.equal(events.at(-1).done, true);
    assert.equal(savedChats.length, 2);
  } finally { releaseProvider(); }


});

test('Priority 2: Research separates empty search from failed search, bounds retries without marking failed stage completed, preserves deadline and aligns restart SSE status', async t => {
  const f = await researchFixture(t);
  const ownerId = randomUUID();
  const subsearchCalls = { q1: 0, q2: 0 };
  const service = f.make({
    models: {
      generateContent: async params => {
        if (params.config?.maxOutputTokens === 1024) {
          return { text: JSON.stringify([{ query: 'q1-empty', label: 'Empty Subsearch' }, { query: 'q2-fail', label: 'Failing Subsearch' }]) };
        }
        if (params.config?.tools) {
          if (params.contents.includes('q1-empty')) {
            subsearchCalls.q1++;
            return { text: '', candidates: [{ groundingMetadata: { groundingChunks: [] } }] };
          }
          if (params.contents.includes('q2-fail')) {
            subsearchCalls.q2++;
            throw Object.assign(new Error('search provider down'), { code: 'PROVIDER_ERROR' });
          }
        }
        if (params.config?.maxOutputTokens === 512) {
          return { text: JSON.stringify({ hasGap: false }) };
        }
        return {
          text: 'Synthesized report from remaining evidence.',
          candidates: [{ groundingMetadata: { groundingChunks: [{ web: { uri: 'https://example.com/report', title: 'Report' } }] } }],
        };
      },
    },
  });

  const created = await service.createResearchJob({ ownerId, prompt: 'fixture search separation' });
  await service.waitForAllJobs();
  const saved = await f.store.read(`research:${created.jobId}`);
  // q1 succeeded with empty result on first attempt -> cached as ok: true and never retried
  assert.equal(subsearchCalls.q1, 1);
  assert.equal(saved.checkpoint.searches[0]?.ok, true);
  assert.equal(saved.steps.find(s => s.key === 'subsearch_0')?.status, 'completed');
  // q2 failed -> bounded to MAX_SEARCH_ATTEMPTS (2), NOT stored as completed in checkpoint.searches[1], and step status is 'failed'
  assert.equal(subsearchCalls.q2, 2);
  assert.equal(saved.checkpoint.searches[1], undefined);
  assert.equal(saved.checkpoint.searchAttempts[1], 2);
  assert.equal(saved.steps.find(s => s.key === 'subsearch_1')?.status, 'failed');

  // Verify restart SSE event aligns with durable 'pending' status (not 'failed')
  const restartOwner = randomUUID();
  let searchEntered;
  const waitingInSearch = new Promise(resolve => { searchEntered = resolve; });
  const restartingWorker = f.make({
    models: {
      generateContent: async params => {
        if (params.config?.maxOutputTokens === 1024) {
          return { text: JSON.stringify([{ query: 'slow-q1', label: 'Slow 1' }, { query: 'slow-q2', label: 'Slow 2' }]) };
        }
        searchEntered();
        return new Promise((_resolve, reject) => {
          params.config.abortSignal.addEventListener('abort', () => reject(params.config.abortSignal.reason || new Error('aborted')), { once: true });
        });
      },
    },
  });
  const restartJob = await restartingWorker.createResearchJob({ ownerId: restartOwner, prompt: 'fixture restart sse' });
  const receivedEvents = [];
  restartingWorker.subscribe(restartJob.jobId, restartOwner, ev => receivedEvents.push(ev));
  await waitingInSearch;
  await restartingWorker.shutdown();
  const durableAfterRestart = await f.store.read(`research:${restartJob.jobId}`);
  assert.equal(durableAfterRestart.status, 'pending');
  const lastEvent = receivedEvents.at(-1);
  assert.equal(lastEvent.type, 'step');
  assert.equal(lastEvent.status, 'pending');
  assert.equal(lastEvent.error, null);
});

test('Priority 3: Planner and UP propagate AbortSignal to provider calls and Planner rechecks authorization before saving priorities', async t => {
  const express = (await import('express')).default;
  const { createPlannerRouter } = await import('../src/http/planner-router.js');
  const { UpService } = await import('../src/services/up/up-service.js');
  const { UpAI } = await import('../src/services/up/ai.js');
  const { FileUpRepository } = await import('../src/repositories/file-up-repository.js');

  const ownerId = randomUUID();
  const taskId = randomUUID();
  let plannerSignalPassed = false;
  let updatePrioritiesCalled = false;
  let authorized = true;

  const plannerRepo = {
    list: async () => [{ id: taskId, title: 'Critical contract review', timeframe: 'Today', status: 'todo' }],
    updatePriorities: async () => { updatePrioritiesCalled = true; return []; },
  };
  const mockOpenAI = {
    chat: {
      completions: {
        create: async (_body, opts) => {
          plannerSignalPassed = Boolean(opts?.signal);
          // Revoke authorization while model is running, before updatePriorities executes
          authorized = false;
          return { choices: [{ message: { content: JSON.stringify({ prioritizedTaskIds: [taskId], priorityTaskTitles: ['Critical contract review'] }) } }] };
        },
      },
    },
  };

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.ownerId = ownerId;
    req.user = { id: ownerId, emailVerifiedAt: 'now' };
    req.securityContext = {
      ownerId,
      assertAuthorized: async () => {
        if (!authorized) throw Object.assign(new Error('Authorization revoked'), { code: 'EXECUTION_REVOKED', status: 403 });
      },
    };
    executionContext.run(req.securityContext, next);
  });
  app.use('/api/planner', createPlannerRouter(plannerRepo, { openAiClient: mockOpenAI }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));

  const res = await fetch(`http://127.0.0.1:${server.address().port}/api/planner/prioritize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ taskIds: [taskId], language: 'en' }),
  });
  assert.equal(res.status, 403);
  assert.equal((await res.json()).code, 'EXECUTION_REVOKED');
  assert.equal(plannerSignalPassed, true);
  assert.equal(updatePrioritiesCalled, false);

  // Verify UpService -> UpAI passes AbortSignal into client.responses.create and aborts cleanly
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'helmer-up-signal-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const upRepo = new FileUpRepository(directory, { cloud: false });
  await upRepo.mutate(ownerId, state => {
    state.preferences = { dailyGoal: 50, weeklyGoal: 350, interests: ['Strategy'], timezone: 'Asia/Baku' };
  });
  let upSignalReceived = null;
  const upClient = {
    responses: {
      create: async (_payload, options) => {
        upSignalReceived = options?.signal || null;
        throw Object.assign(new Error('Request was aborted.'), { name: 'AbortError' });
      },
    },
  };
  const upService = new UpService(upRepo, { ai: new UpAI(upClient) });
  const upAbort = new AbortController();
  upAbort.abort(Object.assign(new Error('Kill switch paused'), { code: 'EXECUTION_DISABLED', status: 503 }));
  await assert.rejects(
    executionContext.run({ ownerId, signal: upAbort.signal, assertAuthorized: async () => {} }, () => upService.start(ownerId, 'en')),
    { code: 'EXECUTION_DISABLED' },
  );
  // Also test when abort happens inside responses.create
  const inFlightAbort = new AbortController();
  const upClientInFlight = {
    responses: {
      create: async (_payload, options) => {
        upSignalReceived = options?.signal || null;
        inFlightAbort.abort(Object.assign(new Error('Revoked'), { code: 'EXECUTION_REVOKED', status: 403 }));
        const abortErr = new Error('Request was aborted.');
        abortErr.name = 'AbortError';
        throw abortErr;
      },
    },
  };
  const upService2 = new UpService(upRepo, { ai: new UpAI(upClientInFlight) });
  await assert.rejects(
    executionContext.run({ ownerId, signal: inFlightAbort.signal, assertAuthorized: async () => {} }, () => upService2.start(ownerId, 'en')),
    { code: 'EXECUTION_REVOKED' },
  );
  assert.equal(upSignalReceived, inFlightAbort.signal);
});

test('Priority 4: UP frontend retains Idempotency-Key across retries and generic AI routes distinguish pre-commit 5xx, post-commit replay and ambiguous mid-mutation 5xx', async t => {
  const { createUpView } = await import('../public/up.js');
  const sentHeaders = [];
  let shouldFail = true;
  let capturedRequest = null;
  // Intercept transport passed into createUpView
  createUpView({
    request: async (path, options) => {
      sentHeaders.push({ path, key: options.headers?.['Idempotency-Key'] });
      if (shouldFail) throw new Error('Temporary 503');
      return { id: 'ch-1' };
    },
    getUser: () => ({ id: 'u1' }),
    getLanguage: () => 'en',
  });
  // Verify directly via a minimal host mount that triggers load + start retry
  const makeNode = tag => ({
    tag, className: '', textContent: '', attributes: {}, children: [],
    classList: { add() {} },
    setAttribute(k, v) { this.attributes[k] = v; },
    addEventListener(ev, fn) { this[`on_${ev}`] = fn; },
    append(...items) { this.children.push(...items); },
    replaceChildren(...items) { this.children = [...items]; },
    querySelector() { return null; },
    get isConnected() { return true; },
  });
  globalThis.document = {
    createElement: makeNode,
    createTextNode: text => ({ text }),
  };
  try {
    const host = makeNode('div');
    const mount = createUpView({
      request: async (reqPath, options = {}) => {
        if (options.method === 'POST' && reqPath.startsWith('/api/up/challenges')) {
          sentHeaders.push({ path: reqPath, key: options.headers?.['Idempotency-Key'] });
          if (shouldFail) throw new Error('503 Service Unavailable');
          return { id: 'ch-1', title: 'Dilemma', status: 'ready', options: [{ id: 'A', text: 'Opt A', score: 40, is_optimal: true }] };
        }
        return {
          onboardingComplete: true,
          totalPoints: 0,
          streak: 0,
          level: { level: 1, floor: 0, next: 100 },
          daily: { points: 0, goal: 50 },
          weekly: { points: 0, goal: 350 },
          recommendation: { category: 'Strategy' },
          preferences: { dailyGoal: 50, weeklyGoal: 350, interests: ['Strategy'] },
          activeChallenge: null,
          skills: [],
          history: [],
        };
      },
      getUser: () => ({ id: 'u1' }),
      getLanguage: () => 'en',
    });
    mount(host);
    await new Promise(resolve => setTimeout(resolve, 20));
    const findButtons = node => {
      const out = [];
      if (node?.tag === 'button') out.push(node);
      for (const child of node?.children || []) out.push(...findButtons(child));
      return out;
    };
    const startBtn1 = findButtons(host).find(b => /Start|Başla/i.test(b.textContent));
    startBtn1.on_click();
    await new Promise(resolve => setTimeout(resolve, 20));
    shouldFail = false;
    const startBtn2 = findButtons(host).find(b => /Start|Başla/i.test(b.textContent));
    startBtn2.on_click();
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(sentHeaders.length, 2);
    assert.ok(sentHeaders[0].key);
    assert.equal(sentHeaders[0].key, sentHeaders[1].key, 'Failed challenge POST retry must reuse the same Idempotency-Key');
  } finally {
    delete globalThis.document;
  }

  // Generic AI routes with AiPolicy.middleware(): pre-commit 5xx is retryable; post-commit 5xx replays without duplicate execution; ambiguous mid-mutation 5xx blocks with REQUEST_ALREADY_SUBMITTED
  const express = (await import('express')).default;
  const redis = new RedisFixture();
  const policy = new AiPolicy({ redis, env: { NODE_ENV: 'production' } });
  const ownerId = randomUUID();
  let mode = 'pre_commit_fail';
  let executions = 0;

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.ownerId = ownerId;
    req.user = { id: ownerId, emailVerifiedAt: 'now' };
    req.securityContext = { ownerId, assertAuthorized: async () => {} };
    executionContext.run(req.securityContext, next);
  });
  app.use(policy.middleware());
  app.post('/api/planner/prioritize', (req, res) => {
    executions++;
    if (mode === 'pre_commit_fail') {
      return res.status(503).json({ code: 'PROVIDER_DOWN' });
    }
    if (mode === 'post_commit_fail') {
      req.securityContext.markMutationPending();
      req.securityContext.recordIdempotentResult(200, { prioritizedTaskIds: ['t-1'], count: 1 });
      return res.status(503).json({ code: 'POST_COMMIT_TELEMETRY_ERROR' });
    }
    if (mode === 'ambiguous_mutation_fail') {
      req.securityContext.markMutationPending();
      return res.status(500).json({ code: 'STORAGE_WRITE_AMBIGUOUS' });
    }
    req.securityContext.markMutationPending();
    const body = { prioritizedTaskIds: ['t-1'], count: 1 };
    req.securityContext.recordIdempotentResult(200, body);
    return res.json(body);
  });

  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const baseUrl = `http://127.0.0.1:${server.address().port}/api/planner/prioritize`;
  const post = (key, payload = { language: 'en' }) => fetch(baseUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
    body: JSON.stringify(payload),
  });

  // Case 1: Pre-commit 503 allows safe retry with same key and payload
  const preFail = await post('key-pre-commit-retry-0001');
  assert.equal(preFail.status, 503);
  await preFail.text();
  await new Promise(resolve => setImmediate(resolve));
  mode = 'ok';
  const preRetry = await post('key-pre-commit-retry-0001');
  assert.equal(preRetry.status, 200);
  assert.deepEqual(await preRetry.json(), { prioritizedTaskIds: ['t-1'], count: 1 });
  assert.equal(executions, 2);

  // Case 2: Post-commit 503 replays committed result on retry without re-executing handler
  mode = 'post_commit_fail';
  const postCommitFail = await post('key-post-commit-replay-02');
  assert.equal(postCommitFail.status, 503);
  await postCommitFail.text();
  await new Promise(resolve => setImmediate(resolve));
  const beforeReplayExecutions = executions;
  const postCommitReplay = await post('key-post-commit-replay-02');
  assert.equal(postCommitReplay.status, 200);
  assert.deepEqual(await postCommitReplay.json(), { prioritizedTaskIds: ['t-1'], count: 1 });
  assert.equal(executions, beforeReplayExecutions, 'Post-commit replay must not execute handler a second time');
  const conflictReplay = await post('key-post-commit-replay-02', { language: 'az' });
  assert.equal(conflictReplay.status, 409);
  assert.equal((await conflictReplay.json()).code, 'IDEMPOTENCY_CONFLICT');

  // Case 3: Ambiguous mid-mutation 500 is never treated as proof of non-execution -> blocks automatic replay with 409 REQUEST_ALREADY_SUBMITTED
  mode = 'ambiguous_mutation_fail';
  const ambigFail = await post('key-ambiguous-mutation-03');
  assert.equal(ambigFail.status, 500);
  await ambigFail.text();
  await new Promise(resolve => setImmediate(resolve));
  const ambigRetry = await post('key-ambiguous-mutation-03');
  assert.equal(ambigRetry.status, 409);
  assert.equal((await ambigRetry.json()).code, 'REQUEST_ALREADY_SUBMITTED');
});

test('Priority 5: Telemetry accounts for Gemini thinking tokens and Redis budget reconciliation never creates negative counters when budget keys expire', async () => {
  const events = [];
  const repo = { recordEvent: async ev => { events.push(ev); return ev; } };
  const telemetry = new TelemetryService(repo);

  await telemetry.trackBuildStrategy({
    ownerId: randomUUID(),
    model: 'gemini-4-hydrogen',
    usage: { promptTokenCount: 1000, candidatesTokenCount: 500, thoughtsTokenCount: 1500, totalTokenCount: 3000 },
    onlyNecessaryData: true,
    modelImprovement: false,
  });
  assert.equal(events[0].tokens.prompt, 1000);
  assert.equal(events[0].tokens.completion, 2000);
  assert.equal(events[0].tokens.total, 3000);

  await telemetry.trackSummary({
    ownerId: randomUUID(),
    model: 'gpt-6-luna',
    usage: { provider: 'openai', model: 'gpt-6-luna', usage: { inputTokens: 400, outputTokens: 250, totalTokens: 650 } },
    onlyNecessaryData: true,
    modelImprovement: false,
  });
  assert.equal(events[1].tokens.prompt, 400);
  assert.equal(events[1].tokens.completion, 250);
  assert.equal(events[1].tokens.total, 650);

  // Test Redis budget key expiration / missing key during usage settlement
  class BudgetFloorRedis extends RedisFixture {
    async eval(script, { keys, arguments: args }) {
      if (script.includes("redis.call('zremrangebyscore'")) {
        const micros = Number(args[0]);
        for (let i = 0; i < 2; i++) {
          this.values.set(keys[i], String(Number(this.values.get(keys[i]) || 0) + micros));
        }
        this.slots.set(args[5], Number(args[4]));
        return 1;
      }
      if (script.includes("redis.call('hincrby'")) {
        if (this.values.has(keys[4])) return 0;
        this.values.set(keys[4], '1');
        const delta = Number(args[0]) || 0;
        const floor = Math.max(0, Number(args[4]) || 0);
        assert.ok(script.includes('math.max(floor, cur + delta)'), 'Lua script must clamp budget keys to floor');
        for (let i = 0; i < 2; i++) {
          const raw = this.values.get(keys[i]);
          const cur = raw !== undefined && raw !== null ? Number(raw) : null;
          const next = cur !== null && !Number.isNaN(cur) ? Math.max(floor, cur + delta) : floor;
          this.values.set(keys[i], String(next));
        }
        return 1;
      }
      return super.eval(script, { keys, arguments: args });
    }
  }

  const redis = new BudgetFloorRedis();
  const policy = new AiPolicy({ redis, env: {} });
  const ownerId = randomUUID();
  const release = await policy.reserveProvider({ ownerId }, { model: 'gemini-4-hydrogen', config: { maxOutputTokens: 8192 } });
  const day = new Date().toISOString().slice(0, 10);
  const userBudgetKey = `security:budget:${day}:${ownerId}`;
  const globalBudgetKey = `security:budget:${day}:global`;
  // Simulate Redis key eviction/expiration before usage reconciliation
  redis.values.delete(userBudgetKey);
  redis.values.delete(globalBudgetKey);

  await release.recordUsage({ inputTokens: 100, outputTokens: 200, searchCalls: 0, searchUsageKnown: true });
  const userBudgetAfter = Number(redis.values.get(userBudgetKey));
  const globalBudgetAfter = Number(redis.values.get(globalBudgetKey));
  const expectedObservedMicros = Math.ceil(100 * 1.50 + 200 * 7.50);
  assert.equal(userBudgetAfter, expectedObservedMicros);
  assert.equal(globalBudgetAfter, expectedObservedMicros);
  assert.ok(userBudgetAfter > 0, 'Budget counter must never become negative when key was evicted');
  await release();
});

test('Priority 6: Vertex AI vs Gemini Developer API auth options never mix non-Vertex apiKey with vertexai project/location', async () => {
  const { resolveGeminiClientOptions } = await import('../src/services/ai/research-google-client.js');

  // Case 1: Vertex AI enabled with GCP project + non-Vertex GEMINI_API_KEY in env -> apiKey must NOT be passed
  const vertexAdcOpts = resolveGeminiClientOptions({
    GEMINI_USE_VERTEX: 'true',
    GOOGLE_CLOUD_PROJECT: 'helmer-prod',
    GOOGLE_CLOUD_LOCATION: 'us-central1',
    GEMINI_API_KEY: 'AIzaSyDummyDeveloperKey',
  });
  assert.equal(vertexAdcOpts.options.vertexai, true);
  assert.equal(vertexAdcOpts.options.project, 'helmer-prod');
  assert.equal(vertexAdcOpts.options.location, 'us-central1');
  assert.equal('apiKey' in vertexAdcOpts.options, false, 'Must not pass Developer API key when Vertex project/ADC is active');

  // Case 2: Vertex AI Express key (AQ.*) without GCP project -> apiKey is passed with vertexai: true
  const vertexExpressOpts = resolveGeminiClientOptions({
    GEMINI_API_KEY: 'AQ.Ab8RN6LDummyVertexExpressKey',
  });
  assert.equal(vertexExpressOpts.options.vertexai, true);
  assert.equal(vertexExpressOpts.options.apiKey, 'AQ.Ab8RN6LDummyVertexExpressKey');
  assert.equal('project' in vertexExpressOpts.options, false);

  // Case 3: Standard Gemini Developer API key (non-Vertex) -> apiKey is passed without vertexai
  const devApiOpts = resolveGeminiClientOptions({
    GEMINI_USE_VERTEX: 'false',
    GEMINI_API_KEY: 'AIzaSyDummyDeveloperKey',
  });
  assert.equal(devApiOpts.options.vertexai, undefined);
  assert.equal(devApiOpts.options.apiKey, 'AIzaSyDummyDeveloperKey');
});

test('Priority 7: Grounded interactions are excluded from LearningLoopService training candidates and OpenAI JSONL exports', async () => {
  const { LearningLoopService } = await import('../src/services/learning/learning-loop-service.js');
  const { FileAiLearningRepository } = await import('../src/repositories/file-ai-learning-repository.js');
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'helmer-learning-grounding-'));
  const filePath = path.join(tmpDir, 'learning.json');
  const repo = new FileAiLearningRepository(filePath);
  const service = new LearningLoopService(repo);
  const ownerId = randomUUID();

  try {
    // 1. Record a grounded interaction with strong positive signals
    const grounded = await service.recordInteraction({
      ownerId,
      mode: 'ask',
      taskType: 'general_reasoning',
      modelProvider: 'google',
      modelName: 'gemini-3.8-flash',
      userPrompt: 'Latest 2026 central bank rate decision',
      modelResponse: 'Grounded response with live search facts and analysis '.repeat(8),
      groundingActive: true,
      modelImprovement: true,
      onlyNecessaryData: false,
    });
    await service.recordSignal(grounded.id, ownerId, {
      accepted: true,
      copied: true,
      explicitRating: 'positive',
    });

    // 2. Record an ungrounded interaction with strong positive signals
    const ungrounded = await service.recordInteraction({
      ownerId,
      mode: 'ask',
      taskType: 'general_reasoning',
      modelProvider: 'google',
      modelName: 'gemini-3.8-flash',
      userPrompt: 'Explain Porter Five Forces framework in detail',
      modelResponse: 'Ungrounded conceptual strategic analysis and breakdown '.repeat(8),
      groundingActive: false,
      modelImprovement: true,
      onlyNecessaryData: false,
    });
    await service.recordSignal(ungrounded.id, ownerId, {
      accepted: true,
      copied: true,
      explicitRating: 'positive',
    });

    const overview = await service.overview();
    assert.equal(overview.trainingCandidates, 1, 'Only ungrounded interaction may become a training candidate');

    const candidatesRes = await service.listCandidates();
    assert.equal(candidatesRes.items.length, 1);
    assert.equal(candidatesRes.items[0].sourceInteractionId, ungrounded.id);

    await service.reviewCandidate(candidatesRes.items[0].id, 'approved', 'admin-test');

    const exported = await service.exportApproved('openai-chat-jsonl');
    assert.ok(!exported.includes('Latest 2026 central bank rate decision'), 'Grounded prompt/output must never be exported to OpenAI JSONL');
    assert.ok(exported.includes('Explain Porter Five Forces framework in detail'));
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('Priority 8: SignupSchema enforces ageConfirmed literal true and rejects missing or false', async () => {
  const { SignupSchema } = await import('../src/auth/validation.js');

  const validWithAge = SignupSchema.safeParse({
    fullName: 'Test User',
    username: 'valid_user_18',
    email: 'adult@example.com',
    password: 'StrongPassword123',
    ageConfirmed: true,
  });
  assert.equal(validWithAge.success, true);

  const missingAge = SignupSchema.safeParse({
    fullName: 'Test User',
    username: 'missing_age_user',
    email: 'noage@example.com',
    password: 'StrongPassword123',
  });
  assert.equal(missingAge.success, false);

  const invalidUnderage = SignupSchema.safeParse({
    fullName: 'Test User',
    username: 'underage_user',
    email: 'minor@example.com',
    password: 'StrongPassword123',
    ageConfirmed: false,
  });
  assert.equal(invalidUnderage.success, false);
});

