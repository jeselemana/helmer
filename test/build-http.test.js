import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { strategyFixture } from './helpers/build-fixtures.js';
import { createStrategyRouter, strategyErrorHandler } from '../src/http/strategy-router.js';
import { FileStrategyRepository } from '../src/repositories/file-strategy-repository.js';
import { AiPolicy } from '../src/services/security/ai-policy.js';
import { PrivacyPolicy } from '../src/services/security/privacy-policy.js';
import { configureProviderPolicy, wrapProvider } from '../src/services/security/provider-policy.js';
import { getBuildVertexClient } from '../src/services/ai/client.js';

async function fixture(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'helmer-build-http-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  process.env.GOOGLE_CLOUD_PROJECT ||= 'test-helmer-project';
  const ownerA = randomUUID(), ownerB = randomUUID();
  const users = new Map([ownerA, ownerB].map(id => [id, { id, status: 'active', emailVerifiedAt: 'now', authVersion: 1, privacyEpoch: 0,
    settings: { modelImprovement: false, personalIntelligence: true, strategyPersonalization: true, industry: 'Software', brandName: 'UnneededSecretBrand' } }]));
  const f = { ownerA, ownerB, users, calls: [], learning: [], route: { needs_search: true, argon_thinking_level: 'High', facts: ['Reported evidence'], focus_area: 'Launch' }, hold: null, background: null, failure: null };
  const policy = new AiPolicy({ redis: null, env: { NODE_ENV: 'test' } });
  f.policy = policy;
  configureProviderPolicy(policy); t.after(() => configureProviderPolicy(undefined));
  const googleResponse = params => {
    const scout = params.config.responseSchema.properties.needs_search;
    if (scout && f.googleFailure) throw f.googleFailure;
    if (!scout && f.failure) throw f.failure;
    const assessment = params.config.responseSchema.properties.status;
    return { text: JSON.stringify(scout ? f.route : assessment ? { status: 'ready', understanding: 'Clear brief', questions: [], assumptions: [] } : f.invalidFinal || strategyFixture()),
      candidates: [{ finishReason: 'STOP', ...(scout && f.route.needs_search ? { groundingMetadata: { groundingChunks: [{ web: { uri: 'https://reuters.com/report', title: 'Report' } }], webSearchQueries: ['Market launch evidence'], groundingSupports: f.route.facts.map(text => ({ segment: { text }, groundingChunkIndices: [0] })) } } : {}) }],
      usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 20 } };
  };
  const gemini = wrapProvider({ models: {
    generateContent: async params => { f.calls.push({ params }); if (params.model === 'gemini-4-argon' && f.hold) await f.hold; return googleResponse(params); },
    generateContentStream: async params => {
      f.calls.push({ params });
      if (f.hold) await f.hold;
      return (async function* () {
        const response = googleResponse(params), text = response.text;
        yield { text: text.slice(0, 50) };
        yield { ...response, text: text.slice(50) };
      })();
    },
  } }, 'gemini', { buildVertex: true });
  t.mock.method(getBuildVertexClient().models, 'generateContent', gemini.models.generateContent);
  t.mock.method(getBuildVertexClient().models, 'generateContentStream', gemini.models.generateContentStream);
  const repository = new FileStrategyRepository(path.join(directory, 'strategies.json'), null, { cloud: false });
  f.repository = repository;
  const app = express(); app.use(express.json());
  app.use((req, _res, next) => { req.ownerId = req.get('X-Test-Owner') || ownerA; req.user = users.get(req.ownerId); req.auth = { user: req.user }; next(); });
  app.use(new PrivacyPolicy({ findById: async id => users.get(id) }).middleware());
  app.use(policy.middleware());
  const learning = { createInteractionId: randomUUID, recordInteraction: async data => f.learning.push(data) };
  app.use('/api/strategy', createStrategyRouter(repository, learning, { hasActiveJobForOwner: owner => f.background === owner }));
  app.use(strategyErrorHandler);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const base = `http://127.0.0.1:${server.address().port}/api/strategy`;
  f.baseUrl = base;
  f.post = (url, body, options = {}) => fetch(`${base}${url}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': body.idempotencyKey || randomUUID(), ...options.headers }, body: JSON.stringify(body), signal: options.signal });
  f.get = (url, owner = ownerA) => fetch(`${base}${url}`, { headers: { 'X-Test-Owner': owner } });
  f.payload = () => ({ brief: 'Prepare a secure technical launch strategy', answers: [], assumptions: ['Limited budget'], idempotencyKey: randomUUID(), language: 'en' });
  return f;
}

test('Build HTTP: SSE ends at Argon, saves one tenant record, preserves sources and redacts private logs', async t => {
  const f = await fixture(t), payload = f.payload();
  const response = await f.post('/generate-stream', payload);
  assert.equal(response.status, 200);
  const body = await response.text();
  const events = body.split('\n').filter(line => line.startsWith('data: {')).map(line => JSON.parse(line.slice(6)));
  const done = events.find(event => event.done);
  assert.equal(done.strategy.title, 'Launch brief'); assert.ok(done.savedId);
  assert.equal(done.strategy.orchestration.sources[0].url, 'https://reuters.com/report');
  assert.deepEqual(done.strategy.orchestration.evidence, [{ text: 'Reported evidence', sourceIndices: [0] }]);
  assert.doesNotMatch(f.calls[1].params.contents, /Reported evidence/);
  assert.deepEqual(f.calls.map(call => call.params.model), ['gemini-3.8-flash', 'gemini-4-argon']);
  assert.equal(f.calls[1].params.config.thinkingConfig.thinkingLevel, 'HIGH');
  assert.match(JSON.parse(f.calls[1].params.contents).untrustedBusinessProfile, /Industry: Software/);
  assert.match(JSON.parse(f.calls[1].params.contents).untrustedBusinessProfile, /UnneededSecretBrand/);
  assert.equal(events.filter(event => event.chunk).map(event => event.chunk).join(''), JSON.stringify(strategyFixture()));
  assert.equal((await f.repository.list(f.ownerA)).length, 1);
  assert.equal((await f.get(`/${done.savedId}`, f.ownerB)).status, 404);
  const replay = await f.post('/generate', payload); assert.equal(replay.status, 200); assert.equal(f.calls.length, 2);
  const conflict = await f.post('/generate', { ...payload, brief: 'A completely different requirement' }); assert.equal(conflict.status, 409);
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(f.learning[0].onlyNecessaryData, true);
  assert.equal(f.learning[0].modelResponse, '[Zəruri əməliyyat qeydi - Məzmun ötürülmür]');
  assert.equal(f.learning[0].usage.prompt_tokens, 40);
  assert.equal(f.learning[0].usage.completion_tokens, 40);
  assert.doesNotMatch(JSON.stringify(f.learning), /Prepare a secure|Launch brief/);
});

test('Build HTTP: disabled profile consent sends no profile; a no-search decision does not ground synthesis', async t => {
  const f = await fixture(t); f.users.get(f.ownerA).settings.strategyPersonalization = false; f.route.needs_search = false;
  const response = await f.post('/generate', f.payload()); assert.equal(response.status, 200);
  assert.equal(JSON.parse(f.calls[1].params.contents).untrustedBusinessProfile, undefined);
  assert.deepEqual(f.calls[0].params.config.tools, [{ googleSearch: {} }]);
  assert.equal(f.calls[1].params.config.tools, undefined);
  const result = await response.json(); assert.equal(result.strategy.orchestration.searchGrounded, false);
});

test('Build HTTP: strict fields, missing idempotency header, unverified users and active Research block before model calls', async t => {
  const f = await fixture(t);
  const invalid = await f.post('/generate', { ...f.payload(), googleSearch: true }); assert.equal(invalid.status, 400);
  const noKey = await f.post('/generate', f.payload(), { headers: { 'Idempotency-Key': '' } }); assert.equal(noKey.status, 400);
  f.background = f.ownerA;
  const busy = await f.post('/generate', f.payload()); assert.equal(busy.status, 429); assert.equal((await busy.json()).code, 'EXECUTION_BUSY');
  f.background = null; f.users.get(f.ownerA).emailVerifiedAt = null;
  const denied = await f.post('/generate', f.payload()); assert.equal(denied.status, 403);
  assert.equal(f.calls.length, 0);
});

test('Build HTTP: concurrent generation returns EXECUTION_BUSY; provider failures cannot leak internals or save output', async t => {
  const f = await fixture(t); let release;
  f.hold = new Promise(resolve => { release = resolve; });
  const pending = f.post('/generate', f.payload());
  for (let i = 0; i < 100 && f.calls.length < 2; i++) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(f.calls.length, 2);
  const second = await f.post('/generate', f.payload()); assert.equal(second.status, 429);
  release(); assert.equal((await pending).status, 200); f.hold = null;
  const before = (await f.repository.list(f.ownerA)).length;
  f.failure = Object.assign(new Error('private stack sk-test-secret /database/path'), { status: 503 });
  f.googleFailure = Object.assign(new Error('private Google failure'), { status: 503 });
  const failed = await f.post('/generate', f.payload()); assert.equal(failed.status, 503);
  assert.doesNotMatch(await failed.text(), /sk-test-secret|database|stack|gpt-|gemini-/);
  assert.equal((await f.repository.list(f.ownerA)).length, before);
});

test('Build HTTP: consent revocation during generation prevents saving or publishing the result', async t => {
  const f = await fixture(t); let release;
  f.hold = new Promise(resolve => { release = resolve; });
  const pending = f.post('/generate', f.payload());
  for (let i = 0; i < 100 && f.calls.length < 2; i++) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(f.calls.length, 2);
  const user = f.users.get(f.ownerA); user.settings.strategyPersonalization = false; user.privacyEpoch++;
  release();
  const response = await pending;
  assert.equal(response.status, 403);
  const body = await response.json(); assert.equal(body.code, 'EXECUTION_REVOKED');
  assert.doesNotMatch(JSON.stringify(body), /Launch brief|authorization revoked|gpt-|gemini-/);
  assert.equal((await f.repository.list(f.ownerA)).length, 0);
});

test('Build HTTP: scout failure returns sanitized SSE error without fallback or persistence', async t => {
  const f = await fixture(t);
  f.googleFailure = Object.assign(new Error('private account capacity'), { status: 429 });
  const response = await f.post('/generate-stream', f.payload());
  const body = await response.text();
  const events = body.split('\n').filter(line => line.startsWith('data: {')).map(line => JSON.parse(line.slice(6)));
  assert.equal(events.find(event => event.error).code, 'AI_RATE_LIMITED');
  assert.equal(events.some(event => event.done), false);
  assert.ok(f.calls.length >= 1 && f.calls.every(call => call.params.model === 'gemini-3.8-flash'));
  assert.equal((await f.repository.list(f.ownerA)).length, 0);
});

test('Build HTTP: Argon failure cannot trigger fallback or save an invalid strategy', async t => {
  const f = await fixture(t);
  f.failure = Object.assign(new Error('private provider failure'), { status: 503 });
  const response = await f.post('/generate-stream', f.payload());
  const text = await response.text();
  const events = text.split('\n').filter(line => line.startsWith('data: {')).map(line => JSON.parse(line.slice(6)));
  assert.equal(events.find(event => event.error).code, 'AI_PROVIDER_UNAVAILABLE');
  assert.equal(events.some(event => event.done), false);
  assert.equal(f.calls[0].params.model, 'gemini-3.8-flash');
  assert.ok(f.calls.slice(1).length >= 1 && f.calls.slice(1).every(call => call.params.model === 'gemini-4-argon'));
  assert.equal((await f.repository.list(f.ownerA)).length, 0);
});

test('Build HTTP: provider failure returns a safe, correlated SSE error without saving', async t => {
  const f = await fixture(t);
  f.googleFailure = Object.assign(new Error('secret Google error'), { status: 429 });
  f.failure = Object.assign(new Error('secret OpenAI error'), { status: 429 });
  const response = await f.post('/generate-stream', f.payload());
  const text = await response.text();
  const events = text.split('\n').filter(line => line.startsWith('data: {')).map(line => JSON.parse(line.slice(6)));
  const error = events.find(event => event.error);
  assert.equal(error.code, 'AI_RATE_LIMITED'); assert.equal(error.retryable, true);
  assert.match(error.requestId, /^[a-f0-9-]{36}$/i);
  assert.doesNotMatch(text, /secret Google|secret OpenAI/);
  assert.equal(events.some(event => event.done), false);
  assert.equal((await f.repository.list(f.ownerA)).length, 0);
});

test('Build estimate endpoint is strict, private, Flash-only and caches only tenant-scoped no-search estimates', async t => {
  const f = await fixture(t), brief = 'Prepare a secure technical launch strategy';
  const response = await f.post('/estimate', { brief });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), { preparationEstimate: { minMinutes: 4, maxMinutes: 11, bufferMinutes: 3 } });
  assert.deepEqual(f.calls.map(call => call.params.model), ['gemini-3.8-flash']);
  assert.doesNotMatch(JSON.stringify(f.calls), /Software|UnneededSecretBrand/);
  const again = await f.post('/estimate', { brief });
  assert.equal(again.status, 200); assert.equal(f.calls.length, 1);
  const other = await f.post('/estimate', { brief }, { headers: { 'X-Test-Owner': f.ownerB } });
  assert.equal(other.status, 200); assert.equal(f.calls.length, 2);
  assert.equal((await f.post('/estimate', { brief, googleSearch: true })).status, 400);
  assert.equal((await f.post('/estimate', { brief: 'tiny' })).status, 400);
  const unkeyed = await f.post('/estimate', { brief }, { headers: { 'Idempotency-Key': '' } });
  assert.equal(unkeyed.status, 400);
  f.background = f.ownerA;
  assert.equal((await f.post('/estimate', { brief })).status, 429);
  assert.equal(f.learning.length, 0);
});

test('Build estimate rejects idempotency mismatches and does not spend guest message or brief allowance', async t => {
  const f = await fixture(t), guest = `guest_${randomUUID()}`, key = randomUUID();
  const headers = { 'X-Test-Owner': guest, 'Idempotency-Key': key };
  const response = await f.post('/estimate', { brief: 'Prepare a safe business launch plan' }, { headers });
  assert.equal(response.status, 200);
  const conflict = await f.post('/estimate', { brief: 'Prepare an entirely different safe launch plan' }, { headers });
  assert.equal(conflict.status, 409);
  assert.equal((await conflict.json()).code, 'IDEMPOTENCY_CONFLICT');
  assert.equal(f.calls.length, 1);
  const again = await f.post('/estimate', { brief: 'Prepare a safe business launch plan' }, { headers });
  assert.equal(again.status, 200);
  assert.equal(f.calls.length, 1);
  assert.equal(f.policy.inMemoryGuestUsage?.size || 0, 0);
});

test('Build HTTP: assessment is Flash-only and a simple refinement still uses Flash → Argon', async t => {
  const f = await fixture(t);
  const assessment = await f.post('/assess', { brief: 'Prepare a safe business launch strategy', language: 'en' });
  assert.equal(assessment.status, 200);
  assert.equal((await assessment.json()).assessment.status, 'ready');
  assert.deepEqual(f.calls.map(call => call.params.model), ['gemini-3.8-flash']);
  assert.equal(f.calls[0].params.config.tools, undefined);
  f.calls.length = 0;
  f.route = { needs_search: false, argon_thinking_level: 'Low', facts: [], focus_area: 'Shorten' };
  const refinement = await f.post('/refine', { brief: 'Prepare a safe business launch strategy', strategy: strategyFixture(), action: 'shorten', language: 'en', idempotencyKey: randomUUID() });
  assert.equal(refinement.status, 200);
  assert.deepEqual(f.calls.map(call => call.params.model), ['gemini-3.8-flash', 'gemini-4-argon']);
  assert.equal(f.calls[1].params.config.thinkingConfig.thinkingLevel, 'LOW');
});

test('Build HTTP: invalid streamed final JSON never receives done or creates a saved strategy', async t => {
  const f = await fixture(t);
  f.invalidFinal = { ...strategyFixture(), protectedField: 'untrusted' };
  const response = await f.post('/generate-stream', f.payload());
  const body = await response.text();
  const events = body.split('\n').filter(line => line.startsWith('data: {')).map(line => JSON.parse(line.slice(6)));
  assert.ok(events.some(event => event.chunk));
  assert.equal(events.find(event => event.error).code, 'AI_INVALID_OUTPUT');
  assert.equal(events.some(event => event.done), false);
  assert.equal((await f.repository.list(f.ownerA)).length, 0);
  assert.equal(f.calls.length, 2);
});

for (const [upstream, expected] of [
  [{ code: 'ENOENT' }, 'AI_NOT_CONFIGURED'],
  [{ status: 400 }, 'AI_PROVIDER_CONFIG_ERROR'],
  [{ status: 404 }, 'AI_MODEL_UNAVAILABLE'],
]) test(`Build HTTP: ${expected} is sanitized and never labelled provider overload`, async t => {
  const f = await fixture(t);
  f.failure = Object.assign(new Error('private ADC file and credential detail'), upstream);
  const response = await f.post('/assess', { brief: 'Prepare a safe launch strategy', language: 'en' });
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.equal(body.code, expected);
  assert.doesNotMatch(JSON.stringify(body), /yüksək yüklənmə|private|ADC file|credential detail/);
  assert.equal((await f.repository.list(f.ownerA)).length, 0);
});

test('Build HTTP: guest generation never auto-saves to repository; user autoSaveStrategies=false is respected when autoSave is omitted', async t => {
  const f = await fixture(t);
  const guestOwner = `guest_${randomUUID()}`;
  const guestRes = await f.post('/generate', { ...f.payload(), autoSave: true }, { headers: { 'X-Test-Owner': guestOwner } });
  assert.equal(guestRes.status, 200);
  const guestBody = await guestRes.json();
  assert.equal(guestBody.isGuest, true);
  assert.equal(guestBody.savedId, null);
  assert.equal(guestBody.savedStrategy, null);
  assert.equal((await f.repository.list(guestOwner)).length, 0);

  // User with autoSaveStrategies: false and omitted autoSave in request body
  f.users.get(f.ownerA).settings.autoSaveStrategies = false;
  const userRes = await f.post('/generate', f.payload());
  assert.equal(userRes.status, 200);
  const userBody = await userRes.json();
  assert.equal(userBody.savedId, null);
  assert.equal((await f.repository.list(f.ownerA)).length, 0);
});

test('Build HTTP: malformed JSON body is sanitized and never leaks V8 parser internals', async t => {
  const f = await fixture(t);
  const rawRes = await fetch(`${f.baseUrl}/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() },
    body: '{"brief": "unterminated secret_token_123',
  });
  assert.equal(rawRes.status, 400);
  const errBody = await rawRes.json();
  assert.equal(errBody.code, 'INVALID_JSON');
  assert.doesNotMatch(JSON.stringify(errBody), /secret_token_123|Unexpected|position/);
});

test('Build HTTP: Faster mode (Medium & High) executes direct Flash, preserves mode across refine, and enforces idempotency conflicts on mode mismatch', async t => {
  const f = await fixture(t);
  const key = randomUUID();
  const basePayload = {
    ...f.payload(),
    idempotencyKey: key,
    buildMode: 'faster',
    fasterThinkingLevel: 'high',
  };
  const genRes = await f.post('/generate-stream', basePayload);
  assert.equal(genRes.status, 200);
  const events = (await genRes.text()).split('\n').filter(line => line.startsWith('data: {')).map(line => JSON.parse(line.slice(6)));
  const done = events.find(e => e.done);
  assert.ok(done);
  assert.equal(done.strategy.orchestration.buildMode, 'faster');
  assert.equal(done.strategy.orchestration.generatorModel, 'gemini-3.8-flash');
  assert.equal(done.strategy.orchestration.thinkingLevel, 'HIGH');
  assert.equal(done.strategy.orchestration.fasterThinkingLevel, 'high');
  assert.deepEqual(f.calls.map(c => c.params.model), ['gemini-3.8-flash']);
  assert.equal(f.calls[0].params.config.thinkingConfig.thinkingLevel, 'HIGH');

  // Replaying with different fasterThinkingLevel or buildMode must return 409 IDEMPOTENCY_CONFLICT
  const conflictMode = await f.post('/generate', { ...basePayload, buildMode: 'auto' });
  assert.equal(conflictMode.status, 409);
  const conflictThinking = await f.post('/generate', { ...basePayload, fasterThinkingLevel: 'medium' });
  assert.equal(conflictThinking.status, 409);

  // Refine on a Faster High strategy preserves Faster High on Flash without calling Argon
  f.calls.length = 0;
  const refineRes = await f.post(`/${done.savedId}/refine`, {
    brief: basePayload.brief,
    answers: [],
    strategy: done.strategy,
    action: 'shorten',
    request: '',
    language: 'en',
    idempotencyKey: randomUUID(),
  });
  assert.equal(refineRes.status, 200);
  const refinedBody = await refineRes.json();
  assert.deepEqual(f.calls.map(c => c.params.model), ['gemini-3.8-flash']);
  assert.equal(f.calls[0].params.config.thinkingConfig.thinkingLevel, 'HIGH');
  assert.equal(refinedBody.strategy.strategy.orchestration.buildMode, 'faster');
  assert.equal(refinedBody.strategy.strategy.orchestration.thinkingLevel, 'HIGH');
});

test('Build HTTP: oversized array/object collections are rejected before Zod parsing (GHSA-mrhx-c7xc-m3w5 mitigation)', async t => {
  const f = await fixture(t);
  const oversizedAnswers = Array.from({ length: 1000 }, (_, i) => ({ questionId: `q_${i}`, answer: 'x' }));
  const res = await f.post('/generate', {
    ...f.payload(),
    answers: oversizedAnswers,
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.code, 'VALIDATION_ERROR');
  assert.equal(f.calls.length, 0);
});

test('Build HTTP blocks grounded refinements before provider calls and learning', async t => {
  const f = await fixture(t);
  const payload = f.payload();
  const generated = await f.post('/generate', payload);
  const { strategy, savedId } = await generated.json();
  assert.ok(savedId);
  const callCount = f.calls.length;
  const input = { action: 'shorten', idempotencyKey: randomUUID() };
  const stored = await f.post(`/${savedId}/refine`, input);
  const unsaved = await f.post('/refine', { ...input, strategy, brief: payload.brief });
  for (const response of [stored, unsaved]) {
    assert.equal(response.status, 422);
    assert.equal((await response.json()).code, 'GROUNDED_STRATEGY_RESTRICTED');
  }
  assert.equal(f.calls.length, callCount);
  assert.equal(f.learning.filter(item => item.taskType?.startsWith('build_refine')).length, 0);
});

test('Build HTTP redacts failed grounding with model improvement enabled', async t => {
  const f = await fixture(t);
  f.users.get(f.ownerA).settings.modelImprovement = true;
  f.route.facts = [];
  const response = await f.post('/generate', f.payload());
  assert.equal(response.status, 422);
  assert.equal((await response.json()).code, 'GROUNDING_UNAVAILABLE');
  assert.equal(f.calls.length, 1);
  assert.equal((await f.repository.list(f.ownerA)).length, 0);
  assert.equal(f.learning[0].onlyNecessaryData, true);
  assert.doesNotMatch(JSON.stringify(f.learning), /Prepare a secure/);
});
