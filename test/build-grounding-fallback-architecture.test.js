import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  createBuildOrchestrator,
  buildDegradationChain,
} from '../src/services/ai/build-orchestrator.js';
import {
  HelmerDecisionRouter,
  deterministicBuildFallbackRoute,
} from '../src/services/ai/decision-router.js';
import { StrategySchema } from '../src/domain/strategy.js';
import { createStrategyRouter, strategyErrorHandler } from '../src/http/strategy-router.js';
import { FileStrategyRepository } from '../src/repositories/file-strategy-repository.js';
import { AiPolicy } from '../src/services/security/ai-policy.js';
import { PrivacyPolicy } from '../src/services/security/privacy-policy.js';
import { configureProviderPolicy, wrapProvider } from '../src/services/security/provider-policy.js';
import { getBuildVertexClient } from '../src/services/ai/client.js';
import { executionContext } from '../src/services/security/privacy-policy.js';
import { buildConfig } from '../src/services/ai/build-config.js';
import { strategyFixture } from './helpers/build-fixtures.js';

function makeDirectGroundedResponse(strategyObj, { chunks = [], queries = ['baku saas 2026'] } = {}) {
  const text = JSON.stringify(strategyObj);
  return {
    text,
    candidates: [
      {
        finishReason: 'STOP',
        content: { role: 'model', parts: [{ text }] },
        groundingMetadata: {
          webSearchQueries: queries,
          groundingChunks: chunks,
        },
      },
    ],
    usageMetadata: { promptTokenCount: 25, candidatesTokenCount: 40, thoughtsTokenCount: 5 },
  };
}

test('Req 1: Hydrogen and Carbon execute native googleSearch independently with zero scout wait, SSRF/relay filtering, redirect stripping, and reserveProvider', async t => {
  const reservations = [];
  const aiPolicy = new AiPolicy({ redis: null, env: { NODE_ENV: 'test', AI_USER_DAILY_USD: '5' } });
  configureProviderPolicy({
    assertEnabled: () => aiPolicy.assertEnabled(),
    reserveProvider: async (context, params, reservation) => {
      reservations.push({ model: params.model, tools: params.config?.tools, reservation });
      return aiPolicy.reserveProvider(context, params, reservation);
    },
  });
  t.after(() => configureProviderPolicy(undefined));

  const controller = new AbortController();
  const context = {
    ownerId: 'tenant-direct-search',
    controller,
    signal: controller.signal,
    assertAuthorized: async () => {},
  };

  for (const targetModel of ['gemini-4-carbon', 'gemini-4-hydrogen']) {
    reservations.length = 0;
    const calls = [];
    const dirtyStrategy = {
      ...strategyFixture(),
      summary: 'Summary with inline relay https://vertexaisearch.cloud.google.com/grounding-api-redirect/SECRET_TOKEN cleaned.',
    };
    const mockClient = {
      models: {
        generateContent: async params => {
          calls.push(params);
          assert.equal(params.config.responseSchema?.properties?.needs_search, undefined, 'Must never call scout when Decision 1 routed');
          assert.deepEqual(params.config.tools, [{ googleSearch: {} }]);
          return makeDirectGroundedResponse(dirtyStrategy, {
            chunks: [
              { web: { uri: 'https://reuters.com/tech-benchmarks', title: 'Reuters Tech' } },
              { web: { uri: 'https://reddit.com./r/saas/comments/1', title: 'Reddit Thread' } },
              { web: { uri: 'http://127.0.0.1:8080/internal', title: 'SSRF Localhost' } },
              { web: { uri: 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/UNVERIFIED', title: 'Relay Only' } },
            ],
          });
        },
      },
    };
    const wrapped = wrapProvider(mockClient, 'gemini', { buildVertex: true });
    const run = createBuildOrchestrator({
      gemini: () => wrapped,
      config: { ...buildConfig, retryBaseDelayMs: 5 },
    });

    const out = await executionContext.run(context, () => run({
      ownerId: 'tenant-direct-search',
      schema: StrategySchema,
      name: 'helmer_strategy',
      instructions: 'Produce verified architecture brief.',
      input: 'Compare 2026 live cloud API benchmarks and pricing for SaaS rollout.',
      buildDecision: {
        targetModel,
        thinkingLevel: 'MEDIUM',
        needsMarketSearch: true,
        routerSource: 'decisions_api',
      },
    }));

    assert.equal(calls.length, 1, `Expected single direct ${targetModel} call without cross-model dependency`);
    assert.equal(out.orchestration.generatorModel, targetModel);
    assert.equal(out.orchestration.searchGrounded, true);
    assert.deepEqual(out.orchestration.sources.map(s => s.url), ['https://reuters.com/tech-benchmarks']);
    assert.doesNotMatch(out.summary, /grounding-api-redirect|SECRET_TOKEN/);
    assert.equal(reservations.length, 1);
    assert.deepEqual(reservations[0].tools, [{ googleSearch: {} }]);
  }
});

test('Req 2 Tier 0: Decision 1 timeout, API error, malformed payload, and low confidence deterministically fall back to Hydrogen MEDIUM or HIGH without failure', async () => {
  const shortPrompt = 'Launch MVP coffee shop plan';
  const longComplexPrompt = 'Design a multi-region distributed zero-trust microservices payment architecture with strict compliance, disaster recovery failover, SLA budgets, compliance audit pipelines, and cross-border API gateways for enterprise fintech deployment over 12 months. '.repeat(2);

  for (const scenario of ['timeout', 'api_error', 'malformed', 'low_confidence']) {
    let callIdx = 0;
    const router = new HelmerDecisionRouter({
      hasDecisionApiConfigFn: () => true,
      localFailuresBeforeOpen: 10,
      callDecisionsApiFn: async () => {
        callIdx++;
        if (scenario === 'timeout') {
          const err = new Error('Decisions API timed out');
          err.name = 'AbortError';
          throw err;
        }
        if (scenario === 'api_error') {
          throw Object.assign(new Error('Decisions 503'), { status: 503 });
        }
        if (scenario === 'malformed') {
          return { unexpected: 'shape' };
        }
        // low_confidence: has_enough_context 0.50 -> confidence 0.50 < 0.55 threshold
        return {
          brief_action: { choiceResult: 'draft_brief' },
          brief_depth: { integerResult: 1 },
          has_enough_context: { noulResult: 0.5 },
          needs_market_search: { noulResult: 0.2 },
          route_tier: { choiceResult: 'carbon_high' },
        };
      },
    });
    // Force Vertex fallback inside router to also fail so Tier 0 deterministic fallback is exercised end-to-end
    router._callVertexFallback = async () => {
      throw Object.assign(new Error('Vertex fallback busy'), { status: 503 });
    };

    const shortDecision = await router.routeBuild({ prompt: shortPrompt, isBriefGeneration: true });
    assert.equal(callIdx, 1);
    assert.equal(shortDecision.targetModel, 'gemini-4-hydrogen');
    assert.equal(shortDecision.thinkingLevel, 'MEDIUM');
    assert.ok(shortDecision.fallbackReason);

    const complexDecision = await router.routeBuild({ prompt: longComplexPrompt, isBriefGeneration: true });
    assert.equal(complexDecision.targetModel, 'gemini-4-hydrogen');
    assert.equal(complexDecision.thinkingLevel, 'HIGH');
    assert.ok(complexDecision.fallbackReason);
  }

  // Deterministic fallback inside build-orchestrator runs Hydrogen directly without calling scout
  const calls = [];
  const tier0Decision = deterministicBuildFallbackRoute({ prompt: longComplexPrompt, fallbackReason: 'decision_low_confidence' });
  assert.equal(tier0Decision.targetModel, 'gemini-4-hydrogen');
  assert.equal(tier0Decision.thinkingLevel, 'HIGH');

  const run = createBuildOrchestrator({
    gemini: () => ({
      models: {
        generateContent: async params => {
          calls.push(params);
          return {
            text: JSON.stringify(strategyFixture()),
            candidates: [{ finishReason: 'STOP' }],
            usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 10 },
          };
        },
      },
    }),
    config: { ...buildConfig, retryBaseDelayMs: 5 },
  });
  const out = await run({
    ownerId: 'tenant-tier0',
    schema: StrategySchema,
    name: 'helmer_strategy',
    instructions: 'Follow rules',
    input: longComplexPrompt,
    buildDecision: tier0Decision,
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].model, 'gemini-4-hydrogen');
  assert.equal(calls[0].config.thinkingConfig.thinkingLevel, 'HIGH');
  assert.equal(out.orchestration.generatorModel, 'gemini-4-hydrogen');
});

test('Req 2 Tier 1: googleSearch quota/tool errors and empty chunks fall back cleanly to same model ungrounded with groundingUnavailable: true', async () => {
  // 1a. googleSearch tool error (400 / 429) retries same model with tools: undefined
  const calls = [];
  const runErrorFallback = createBuildOrchestrator({
    gemini: () => ({
      models: {
        generateContent: async params => {
          calls.push({ model: params.model, hasSearch: Boolean(params.config?.tools?.length), thinking: params.config?.thinkingConfig?.thinkingLevel });
          if (params.config?.tools?.length) {
            throw Object.assign(new Error('googleSearch quota exceeded'), { status: 429 });
          }
          return {
            text: JSON.stringify(strategyFixture()),
            candidates: [{ finishReason: 'STOP' }],
            usageMetadata: { promptTokenCount: 15, candidatesTokenCount: 25 },
          };
        },
      },
    }),
    config: { ...buildConfig, retryBaseDelayMs: 5 },
  });

  const outErr = await runErrorFallback({
    ownerId: 'tenant-tier1-err',
    schema: StrategySchema,
    name: 'helmer_strategy',
    instructions: 'Be concise',
    input: 'Search current 2026 Azeri SaaS market trends.',
    buildDecision: {
      targetModel: 'gemini-4-carbon',
      thinkingLevel: 'MEDIUM',
      needsMarketSearch: true,
      routerSource: 'decisions_api',
    },
  });
  assert.equal(outErr.title, 'Launch brief');
  assert.equal(outErr.orchestration.generatorModel, 'gemini-4-carbon');
  assert.equal(outErr.orchestration.thinkingLevel, 'MEDIUM');
  assert.equal(outErr.orchestration.groundingUnavailable, true);
  assert.equal(outErr.orchestration.searchGrounded, false);
  assert.deepEqual(outErr.orchestration.sources, []);
  assert.deepEqual(calls.at(-1), { model: 'gemini-4-carbon', hasSearch: false, thinking: 'MEDIUM' });

  // 1b. googleSearch returns 0 verified chunks (or only blocked domains) -> still succeeds with groundingUnavailable: true
  const runEmptyChunks = createBuildOrchestrator({
    gemini: () => ({
      models: {
        generateContent: async () => makeDirectGroundedResponse(strategyFixture(), {
          chunks: [{ web: { uri: 'https://reddit.com./r/bad', title: 'Blocked Domain' } }],
        }),
      },
    }),
    config: { ...buildConfig, retryBaseDelayMs: 5 },
  });
  const outEmpty = await runEmptyChunks({
    ownerId: 'tenant-tier1-empty',
    schema: StrategySchema,
    name: 'helmer_strategy',
    instructions: 'Be concise',
    input: 'Search live pricing benchmarks.',
    buildDecision: {
      targetModel: 'gemini-4-hydrogen',
      thinkingLevel: 'HIGH',
      needsMarketSearch: true,
      routerSource: 'decisions_api',
    },
  });
  assert.equal(outEmpty.title, 'Launch brief');
  assert.equal(outEmpty.orchestration.groundingUnavailable, true);
  assert.equal(outEmpty.orchestration.searchGrounded, false);
  assert.deepEqual(outEmpty.orchestration.sources, []);
});

test('Req 2 Tiers 2 & 3: buildDegradationChain and orchestrator follow exact Carbon HIGH/MEDIUM/LOW and Hydrogen XHIGH/HIGH/MEDIUM chains', async () => {
  assert.deepEqual(
    buildDegradationChain({ targetModel: 'gemini-4-carbon', thinkingLevel: 'HIGH' }),
    [
      { model: 'gemini-4-carbon', thinkingLevel: 'HIGH' },
      { model: 'gemini-4-carbon', thinkingLevel: 'MEDIUM' },
      { model: 'gemini-4-hydrogen', thinkingLevel: 'XHIGH' },
      { model: 'gemini-4-hydrogen', thinkingLevel: 'HIGH' },
      { model: 'gemini-4-hydrogen', thinkingLevel: 'MEDIUM' },
      { model: 'gemini-4-hydrogen', thinkingLevel: 'LOW' },
    ],
  );
  assert.deepEqual(
    buildDegradationChain({ targetModel: 'gemini-4-carbon', thinkingLevel: 'MEDIUM' }),
    [
      { model: 'gemini-4-carbon', thinkingLevel: 'MEDIUM' },
      { model: 'gemini-4-carbon', thinkingLevel: 'LOW' },
      { model: 'gemini-4-hydrogen', thinkingLevel: 'XHIGH' },
      { model: 'gemini-4-hydrogen', thinkingLevel: 'HIGH' },
      { model: 'gemini-4-hydrogen', thinkingLevel: 'MEDIUM' },
      { model: 'gemini-4-hydrogen', thinkingLevel: 'LOW' },
    ],
  );
  assert.deepEqual(
    buildDegradationChain({ targetModel: 'gemini-4-carbon', thinkingLevel: 'LOW' }),
    [
      { model: 'gemini-4-carbon', thinkingLevel: 'LOW' },
      { model: 'gemini-4-hydrogen', thinkingLevel: 'HIGH' },
      { model: 'gemini-4-hydrogen', thinkingLevel: 'MEDIUM' },
      { model: 'gemini-4-hydrogen', thinkingLevel: 'LOW' },
    ],
  );
  assert.deepEqual(
    buildDegradationChain({ targetModel: 'gemini-4-hydrogen', thinkingLevel: 'XHIGH' }),
    [
      { model: 'gemini-4-hydrogen', thinkingLevel: 'XHIGH' },
      { model: 'gemini-4-hydrogen', thinkingLevel: 'HIGH' },
      { model: 'gemini-4-hydrogen', thinkingLevel: 'MEDIUM' },
      { model: 'gemini-4-hydrogen', thinkingLevel: 'LOW' },
      { model: 'gemini-4-carbon', thinkingLevel: 'LOW', crossModelRescue: true },
    ],
  );

  // Runtime execution: fail Carbon HIGH, Carbon MEDIUM, Hydrogen XHIGH, Hydrogen HIGH -> succeed on Hydrogen MEDIUM
  const sequence = [];
  const runTier2 = createBuildOrchestrator({
    gemini: () => ({
      models: {
        generateContent: async params => {
          const step = `${params.model}:${params.config.thinkingConfig.thinkingLevel}`;
          sequence.push(step);
          if (step !== 'gemini-4-hydrogen:MEDIUM') {
            throw Object.assign(new Error('transient overload'), { status: 503 });
          }
          return { text: JSON.stringify(strategyFixture()), candidates: [{ finishReason: 'STOP' }] };
        },
      },
    }),
    config: { ...buildConfig, retryBaseDelayMs: 5 },
  });
  const resTier2 = await runTier2({
    ownerId: 'tenant-tier2',
    schema: StrategySchema,
    name: 'helmer_strategy',
    instructions: 'Architecture brief',
    input: 'Critical system plan',
    buildDecision: { targetModel: 'gemini-4-carbon', thinkingLevel: 'HIGH', needsMarketSearch: false, routerSource: 'decisions_api' },
  });
  assert.deepEqual(sequence, [
    'gemini-4-carbon:HIGH',
    'gemini-4-carbon:HIGH',
    'gemini-4-carbon:HIGH', // primary retry attempts (maxFinalAttempts=3)
    'gemini-4-carbon:MEDIUM',
    'gemini-4-hydrogen:XHIGH',
    'gemini-4-hydrogen:HIGH',
    'gemini-4-hydrogen:MEDIUM',
  ]);
  assert.equal(resTier2.orchestration.generatorModel, 'gemini-4-hydrogen');
  assert.equal(resTier2.orchestration.thinkingLevel, 'MEDIUM');
  assert.equal(resTier2.orchestration.escalatedToFlagship, false);

  // Runtime execution: Hydrogen XHIGH -> HIGH -> MEDIUM -> LOW (succeeds at LOW)
  const hSeq = [];
  const runTier3 = createBuildOrchestrator({
    gemini: () => ({
      models: {
        generateContent: async params => {
          const step = `${params.model}:${params.config.thinkingConfig.thinkingLevel}`;
          hSeq.push(step);
          if (step !== 'gemini-4-hydrogen:LOW') {
            throw Object.assign(new Error('overloaded'), { status: 503 });
          }
          return { text: JSON.stringify(strategyFixture()), candidates: [{ finishReason: 'STOP' }] };
        },
      },
    }),
    config: { ...buildConfig, retryBaseDelayMs: 5 },
  });
  const resTier3 = await runTier3({
    ownerId: 'tenant-tier3',
    schema: StrategySchema,
    name: 'helmer_strategy',
    instructions: 'Deep plan',
    input: 'Complex analysis',
    buildDecision: { targetModel: 'gemini-4-hydrogen', thinkingLevel: 'XHIGH', needsMarketSearch: false, routerSource: 'decisions_api' },
  });
  assert.deepEqual(hSeq, [
    'gemini-4-hydrogen:XHIGH',
    'gemini-4-hydrogen:XHIGH',
    'gemini-4-hydrogen:XHIGH', // primary retry attempts (maxFinalAttempts=3)
    'gemini-4-hydrogen:HIGH',
    'gemini-4-hydrogen:MEDIUM',
    'gemini-4-hydrogen:LOW',
  ]);
  assert.equal(resTier3.orchestration.thinkingLevel, 'LOW');
});

test('Req 2 Tier 4: AI_INVALID_OUTPUT and truncated MAX_TOKENS raw output are rescued via Hydrogen schema repair pass', async () => {
  // 4a. AI_INVALID_OUTPUT with raw text -> immediately triggers Hydrogen LOW repair pass (tools disabled)
  const callsInvalid = [];
  const runInvalidRepair = createBuildOrchestrator({
    gemini: () => ({
      models: {
        generateContent: async params => {
          callsInvalid.push(params);
          if (callsInvalid.length === 1) {
            return {
              text: '{"title":"Draft Title","summary":"Valid substance missing sections"}',
              candidates: [{ finishReason: 'STOP' }],
            };
          }
          const payload = JSON.parse(params.contents);
          assert.match(payload.draftOutput, /Draft Title/);
          assert.equal(params.config.tools, undefined);
          return {
            text: JSON.stringify({ ...strategyFixture(), title: 'Repaired Strategy Title' }),
            candidates: [{ finishReason: 'STOP' }],
          };
        },
      },
    }),
    config: { ...buildConfig, retryBaseDelayMs: 5 },
  });

  const outInvalid = await runInvalidRepair({
    ownerId: 'tenant-tier4-invalid',
    schema: StrategySchema,
    name: 'helmer_strategy',
    instructions: 'Produce brief',
    input: 'Prepare launch plan',
    buildDecision: { targetModel: 'gemini-4-carbon', thinkingLevel: 'MEDIUM', needsMarketSearch: false, routerSource: 'decisions_api' },
  });
  assert.equal(outInvalid.title, 'Repaired Strategy Title');
  assert.equal(callsInvalid.length, 2);
  assert.equal(callsInvalid[1].model, 'gemini-4-hydrogen');
  assert.equal(callsInvalid[1].config.thinkingConfig.thinkingLevel, 'LOW');

  // 4b. MAX_TOKENS truncated draft across all steps -> rescued cleanly by final repair pass
  const callsMaxTok = [];
  const runMaxTokRepair = createBuildOrchestrator({
    gemini: () => ({
      models: {
        generateContent: async params => {
          callsMaxTok.push(params);
          if (!params.contents.includes('"draftOutput"')) {
            return {
              text: '{"title":"Truncated Flagship Draft","summary":"Truncated mid-sentence...',
              candidates: [{ finishReason: 'MAX_TOKENS' }],
            };
          }
          const body = JSON.parse(params.contents);
          assert.match(body.draftOutput, /Truncated Flagship Draft/);
          return {
            text: JSON.stringify({ ...strategyFixture(), title: 'Truncated Flagship Draft (Rescued)' }),
            candidates: [{ finishReason: 'STOP' }],
          };
        },
      },
    }),
    config: { ...buildConfig, retryBaseDelayMs: 5 },
  });
  const outMaxTok = await runMaxTokRepair({
    ownerId: 'tenant-tier4-maxtok',
    schema: StrategySchema,
    name: 'helmer_strategy',
    instructions: 'Produce brief',
    input: 'Detailed plan',
    buildDecision: { targetModel: 'gemini-4-hydrogen', thinkingLevel: 'LOW', needsMarketSearch: false, routerSource: 'decisions_api' },
  });
  assert.equal(outMaxTok.title, 'Truncated Flagship Draft (Rescued)');
  assert.equal(callsMaxTok.at(-1).model, 'gemini-4-hydrogen');
});

test('Req 2 SSE & HTTP Endpoints (/generate-stream, /generate, /refine, /:id/refine): mid-stream Carbon failure resets stream, clears escalation badge, and completes HTTP 200 on Hydrogen', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'helmer-sse-fallback-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  process.env.GOOGLE_CLOUD_PROJECT ||= 'test-helmer-project';

  const ownerId = randomUUID();
  const userRecord = {
    id: ownerId,
    status: 'active',
    emailVerifiedAt: new Date().toISOString(),
    authVersion: 1,
    privacyEpoch: 0,
    settings: { modelImprovement: true, personalIntelligence: false, autoSaveStrategies: true },
  };
  const policy = new AiPolicy({ redis: null, env: { NODE_ENV: 'test' } });
  configureProviderPolicy(policy);
  t.after(() => configureProviderPolicy(undefined));

  const mockDecisionRouter = {
    routeBuild: async () => ({
      briefAction: 'draft_brief',
      briefDepth: 2,
      needsMarketSearch: false,
      hasEnoughContext: true,
      routeTier: 'carbon_medium',
      targetModel: 'gemini-4-carbon',
      thinkingLevel: 'MEDIUM',
      carbonEscalated: true,
      routerSource: 'decisions_api',
      confidence: 0.95,
      latencyMs: 1,
    }),
  };

  let mode = 'carbon_midstream_fail_to_hydrogen';
  const buildClient = getBuildVertexClient();
  t.mock.method(buildClient.models, 'generateContent', async params => {
    if (params.model === 'gemini-4-carbon') {
      throw Object.assign(new Error('carbon overloaded mid-stream fallback'), { status: 503 });
    }
    const base = strategyFixture();
    const title = mode === 'refine_fallback' ? 'Refined via Hydrogen Rescue' : 'Rescued Launch Brief';
    return {
      text: JSON.stringify({ ...base, title }),
      candidates: [{ finishReason: 'STOP' }],
      usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 20 },
    };
  });
  t.mock.method(buildClient.models, 'generateContentStream', async params => {
    if (params.model === 'gemini-4-carbon') {
      return (async function* () {
        yield { text: '{"title":"Partial Carbon Output', candidates: [{}] };
        throw Object.assign(new Error('Carbon stream dropped'), { status: 503 });
      })();
    }
    return (async function* () {
      const text = JSON.stringify({ ...strategyFixture(), title: 'Rescued Launch Brief' });
      yield { text, candidates: [{ finishReason: 'STOP' }] };
    })();
  });

  const repository = new FileStrategyRepository(path.join(dir, 'strategies.json'), null, { cloud: false });
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.ownerId = ownerId; req.user = userRecord; req.auth = { user: userRecord }; next(); });
  app.use(new PrivacyPolicy({ findById: async id => (id === ownerId ? userRecord : null) }).middleware());
  app.use(policy.middleware());
  app.use('/api/strategy', createStrategyRouter(repository, null, { decisionRouter: mockDecisionRouter }));
  app.use(strategyErrorHandler);

  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const baseUrl = `http://127.0.0.1:${server.address().port}/api/strategy`;

  // 1. /generate-stream mid-stream Carbon failure -> resetStream + escalatedToFlagship: false + HTTP 200 done
  const sseKey = randomUUID();
  const sseRes = await fetch(`${baseUrl}/generate-stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': sseKey },
    body: JSON.stringify({ brief: 'Enterprise launch plan', answers: [], idempotencyKey: sseKey, language: 'en' }),
  });
  assert.equal(sseRes.status, 200);
  const events = (await sseRes.text())
    .split('\n')
    .filter(l => l.startsWith('data: {'))
    .map(l => JSON.parse(l.slice(6)));
  assert.ok(events.some(e => e.escalatedToFlagship === true), 'Should initially signal flagship before Carbon attempt');
  assert.ok(events.some(e => e.resetStream === true && e.escalatedToFlagship === false && e.routingTier === 'standard'), 'Must clear escalation banner and reset stream before Hydrogen rescue');
  const done = events.find(e => e.done);
  assert.ok(done);
  assert.equal(done.escalatedToFlagship, false);
  assert.equal(done.routingTier, 'standard');
  assert.equal(done.strategy.title, 'Rescued Launch Brief');
  assert.equal(done.strategy.orchestration.generatorModel, 'gemini-4-hydrogen');
  assert.ok(done.savedId);

  // 2. /generate + /:id/refine + /refine all inherit Carbon -> Hydrogen degradation transparently
  mode = 'refine_fallback';
  const genKey = randomUUID();
  const genRes = await fetch(`${baseUrl}/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': genKey },
    body: JSON.stringify({ brief: 'Another enterprise plan', answers: [], autoSave: false, idempotencyKey: genKey, language: 'en' }),
  });
  assert.equal(genRes.status, 200);
  const genJson = await genRes.json();
  assert.equal(genJson.strategy.orchestration.generatorModel, 'gemini-4-hydrogen');

  const savedRefineRes = await fetch(`${baseUrl}/${done.savedId}/refine`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() },
    body: JSON.stringify({ action: 'shorten', request: '', language: 'en' }),
  });
  assert.equal(savedRefineRes.status, 200);
  const savedRefineJson = await savedRefineRes.json();
  assert.equal(savedRefineJson.strategy.title, 'Refined via Hydrogen Rescue');

  const statelessRefineRes = await fetch(`${baseUrl}/refine`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() },
    body: JSON.stringify({ brief: 'Enterprise launch', answers: [], strategy: strategyFixture(), action: 'shorten', request: '', language: 'en' }),
  });
  assert.equal(statelessRefineRes.status, 200);
  const statelessJson = await statelessRefineRes.json();
  assert.equal(statelessJson.strategy.title, 'Refined via Hydrogen Rescue');
});
