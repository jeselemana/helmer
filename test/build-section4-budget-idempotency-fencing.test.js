import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import express from 'express';

import {
  AiPolicy,
  DEFAULT_MODEL_PRICING,
  resolveEffectiveModelPricing,
} from '../src/services/security/ai-policy.js';
import { PrivacyPolicy, executionContext } from '../src/services/security/privacy-policy.js';
import { configureProviderPolicy, wrapProvider } from '../src/services/security/provider-policy.js';
import { acquireIdempotencyLock } from '../src/http/execution-lock.js';
import { createBuildOrchestrator } from '../src/services/ai/build-orchestrator.js';
import { FileStrategyRepository } from '../src/repositories/file-strategy-repository.js';
import { LearningLoopService } from '../src/services/learning/learning-loop-service.js';
import { FileAiLearningRepository } from '../src/repositories/file-ai-learning-repository.js';
import { createStrategyRouter, strategyErrorHandler } from '../src/http/strategy-router.js';
import { resolveBuildOutputReservation } from '../src/services/ai/build-config.js';
import { StrategySchema } from '../src/domain/strategy.js';
import { strategyFixture } from './helpers/build-fixtures.js';
import { installBuildRoutingFixture } from './helpers/build-routing-fixture.js';
import { getBuildVertexClient, getGeminiClient } from '../src/services/ai/client.js';

installBuildRoutingFixture();

test('Shared pricing (resolveEffectiveModelPricing): gemini-4-argon stageMetrics matches AiPolicy settlement before and after Dec 1, 2026 transition', async t => {
  const preTransitionMs = Date.UTC(2026, 10, 15, 12, 0, 0);
  const postTransitionMs = Date.UTC(2026, 11, 5, 12, 0, 0);

  for (const [label, nowMs, expectedInputRate, expectedOutputRate] of [
    ['pre-2026-12-01', preTransitionMs, 2.20, 11.00],
    ['post-2026-12-01', postTransitionMs, 4.40, 22.00],
  ]) {
    t.mock.method(Date, 'now', () => nowMs);
    const pricing = resolveEffectiveModelPricing('gemini-4-argon');
    assert.equal(pricing.input, expectedInputRate, `${label} input rate mismatch`);
    assert.equal(pricing.output, expectedOutputRate, `${label} output rate mismatch`);
    assert.equal(DEFAULT_MODEL_PRICING['gemini-4-argon'].input, expectedInputRate);

    const argonUsage = {
      promptTokenCount: 1000,
      candidatesTokenCount: 250,
      thoughtsTokenCount: 50,
    };

    const recordedMetrics = [];
    const gemini = () => ({
      models: {
        generateContent: async params => {
          if (params.config.responseSchema?.properties?.needs_search) {
            return {
              text: JSON.stringify({ needs_search: false, argon_thinking_level: 'Medium', facts: [], focus_area: 'F' }),
              candidates: [{ finishReason: 'STOP' }],
              usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 20, thoughtsTokenCount: 5 },
            };
          }
          return {
            text: JSON.stringify(strategyFixture()),
            candidates: [{ finishReason: 'STOP' }],
            usageMetadata: argonUsage,
          };
        },
        generateContentStream: async params => (async function* () {
          yield {
            text: JSON.stringify(strategyFixture()),
            candidates: [{ finishReason: 'STOP' }],
            usageMetadata: argonUsage,
          };
        })(),
      },
    });

    const orchestrate = createBuildOrchestrator({ gemini, logger: () => {} });
    await orchestrate({
      ownerId: `pricing-${label}`,
      schema: StrategySchema,
      name: 'helmer_strategy',
      instructions: 'Rules',
      input: 'Create safe architecture strategy without search.',
      onUsage: u => recordedMetrics.push(u),
    });

    const finalStage = recordedMetrics.find(m => m.phase === 'final' && m.model === 'gemini-4-argon');
    assert.ok(finalStage, `${label} final Argon stageMetric should exist`);

    // Compare against AiPolicy reserve + settle for identical token counts
    const aiPolicy = new AiPolicy({ env: { AI_USER_DAILY_USD: '100', AI_PLATFORM_DAILY_USD: '500' } });
    const ownerId = `policy-${label}`;
    const release = await aiPolicy.reserveProvider(
      { ownerId },
      { model: 'gemini-4-argon', contents: 'prompt', config: {} },
      { outputTokenReservation: resolveBuildOutputReservation({ model: 'gemini-4-argon', config: { thinkingConfig: { thinkingLevel: 'MEDIUM' } } }) },
    );
    await release.recordUsage({
      inputTokens: argonUsage.promptTokenCount,
      outputTokens: argonUsage.candidatesTokenCount + argonUsage.thoughtsTokenCount,
      searchCalls: 0,
      searchUsageKnown: true,
    });
    await release();

    const budgetEntry = [...aiPolicy.inMemoryBudgets.entries()].find(([k]) => k.endsWith(`:${ownerId}`));
    const settledMicros = budgetEntry?.[1];
    assert.equal(
      finalStage.estimatedUsdMicros,
      settledMicros,
      `${label}: orchestrator stageMetric (${finalStage.estimatedUsdMicros}) must equal AiPolicy settlement (${settledMicros})`,
    );
  }
});

test('provider-policy settlement handles partial text error, partial search cutoff, completed-without-grounding ($0 search), unknown-incomplete-stream search retention, and retry non-double-charge', async t => {
  t.after(() => configureProviderPolicy(undefined));

  const aiPolicy = new AiPolicy({ env: { AI_USER_DAILY_USD: '50', AI_PLATFORM_DAILY_USD: '500' } });
  configureProviderPolicy({
    assertEnabled: () => aiPolicy.assertEnabled(),
    reserveProvider: (ctx, params, reservation) => aiPolicy.reserveProvider(ctx, params, reservation),
  });
  const day = new Date().toISOString().slice(0, 10);
  const budgetOf = ownerId => aiPolicy.inMemoryBudgets.get(`security:budget:${day}:${ownerId}`) || 0;

  // A. Stream emits text then throws WITHOUT usageMetadata -> settles estimated input/output, NO full refund
  {
    const ownerId = `settle-a-${randomUUID()}`;
    const usages = [];
    const client = wrapProvider({
      models: {
        generateContent: async () => ({}),
        generateContentStream: async () => (async function* () {
          yield { text: 'Partial text chunk that consumed tokens already', candidates: [{}] };
          throw Object.assign(new Error('Stream dropped'), { code: 'ECONNRESET' });
        })(),
      },
    }, 'gemini');

    await executionContext.run({
      ownerId,
      signal: new AbortController().signal,
      assertAuthorized: async () => {},
      onProviderUsage: async u => usages.push(u),
    }, async () => {
      const stream = await client.models.generateContentStream({ model: 'gemini-3.8-flash', contents: 'Analyze pricing', config: {} });
      await assert.rejects(async () => { for await (const _ of stream) {} }, err => err.code === 'ECONNRESET');
    });

    assert.equal(usages.length, 1);
    assert.equal(usages[0].estimated, true);
    assert.ok(usages[0].inputTokens > 0 && usages[0].outputTokens > 0);
    assert.ok(budgetOf(ownerId) > 0, 'Partial text before error must NOT be fully refunded');
  }

  // B. Search started (groundingMetadata emitted) then cut off with 0 text & 0 usage -> search unit retained ($0.035), NO full refund
  {
    const ownerId = `settle-b-${randomUUID()}`;
    const usages = [];
    const client = wrapProvider({
      models: {
        generateContent: async () => ({}),
        generateContentStream: async () => (async function* () {
          yield { candidates: [{ groundingMetadata: { webSearchQueries: ['competitor rate'] } }] };
          throw new Error('Upstream cut after search');
        })(),
      },
    }, 'gemini');

    await executionContext.run({
      ownerId,
      signal: new AbortController().signal,
      assertAuthorized: async () => {},
      onProviderUsage: async u => usages.push(u),
    }, async () => {
      const stream = await client.models.generateContentStream({
        model: 'gemini-3.8-flash',
        contents: 'Find rate',
        config: { tools: [{ googleSearch: {} }] },
      });
      await assert.rejects(async () => { for await (const _ of stream) {} });
    });

    assert.equal(usages.length, 1);
    assert.equal(usages[0].searchCalls, 1);
    assert.equal(usages[0].searchUsageKnown, true);
    assert.equal(usages[0].partialSearchOnly, true);
    assert.equal(usages[0].searchSettlementEvidence, 'provider_grounding_metadata');
    assert.ok(budgetOf(ownerId) >= 35_000, 'Started search cutoff must retain $0.035 search unit');
  }

  // C. Completed Gemini call with googleSearch tool that did NOT ground -> ZERO $0.035 search charge
  {
    const ownerId = `settle-c-${randomUUID()}`;
    const usages = [];
    const client = wrapProvider({
      models: {
        generateContent: async () => ({}),
        generateContentStream: async () => (async function* () {
          yield {
            text: '{"ok":true}',
            candidates: [{ finishReason: 'STOP' }],
            usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 20 },
          };
        })(),
      },
    }, 'gemini');

    await executionContext.run({
      ownerId,
      signal: new AbortController().signal,
      assertAuthorized: async () => {},
      onProviderUsage: async u => usages.push(u),
    }, async () => {
      const stream = await client.models.generateContentStream({
        model: 'gemini-3.8-flash',
        contents: 'Direct question',
        config: { tools: [{ googleSearch: {} }] },
      });
      for await (const _ of stream) {}
    });

    assert.equal(usages.length, 1);
    assert.equal(usages[0].searchCalls, 0);
    assert.equal(usages[0].searchUsageKnown, true);
    assert.equal(usages[0].searchSettlementEvidence, 'completed_without_grounding');
    // Token cost for 100*0.75 + 20*3.75 = 150 micros (< 35_000 search fee)
    assert.equal(budgetOf(ownerId), 150);
  }

  // D. Incomplete Gemini stream with googleSearch tool, partial usageMetadata, NO finishReason & NO grounding -> searchUsageKnown: false & retains $0.035 search reserve
  {
    const ownerId = `settle-d-${randomUUID()}`;
    const usages = [];
    const client = wrapProvider({
      models: {
        generateContent: async () => ({}),
        generateContentStream: async () => (async function* () {
          yield {
            text: 'Partial chunk',
            candidates: [{}],
            usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 10 },
          };
          throw new Error('Mid-stream disconnect before STOP');
        })(),
      },
    }, 'gemini');

    await executionContext.run({
      ownerId,
      signal: new AbortController().signal,
      assertAuthorized: async () => {},
      onProviderUsage: async u => usages.push(u),
    }, async () => {
      const stream = await client.models.generateContentStream({
        model: 'gemini-3.8-flash',
        contents: 'Query',
        config: { tools: [{ googleSearch: {} }] },
      });
      await assert.rejects(async () => { for await (const _ of stream) {} });
    });

    assert.equal(usages.length, 1);
    assert.equal(usages[0].searchUsageKnown, false);
    assert.equal(usages[0].searchSettlementEvidence, 'unknown_incomplete_stream');
    // 100*0.75 + 10*3.75 + 35_000 retained search reserve = 35_113 micros
    assert.equal(budgetOf(ownerId), 35_113);
  }

  // E. Pre-output failure refunds cleanly, and retry charges exactly once (no double charge)
  {
    const ownerId = `settle-e-${randomUUID()}`;
    let calls = 0;
    const usages = [];
    const client = wrapProvider({
      models: {
        generateContentStream: async () => { throw new Error('unused'); },
        generateContent: async () => {
          calls++;
          if (calls === 1) throw Object.assign(new Error('503 before output'), { status: 503 });
          return {
            text: 'Recovered',
            candidates: [{ finishReason: 'STOP' }],
            usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 20 },
          };
        },
      },
    }, 'gemini');

    await executionContext.run({
      ownerId,
      signal: new AbortController().signal,
      assertAuthorized: async () => {},
      onProviderUsage: async u => usages.push(u),
    }, async () => {
      await assert.rejects(() => client.models.generateContent({ model: 'gemini-3.8-flash', contents: 'Hi', config: {} }));
      assert.equal(budgetOf(ownerId), 0, 'Pre-output failure must refund reservation completely');
      await client.models.generateContent({ model: 'gemini-3.8-flash', contents: 'Hi', config: {} });
    });

    assert.equal(usages.length, 1);
    assert.equal(budgetOf(ownerId), 150, 'Retry must settle exact single-call cost');
  }
});

test('HTTP idempotency & conflicts: header vs body key mismatch, /estimate & /assess 409 conflicts, and refine retry without extra version', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'helmer-sec4-idem-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));

  const ownerId = randomUUID();
  const repo = new FileStrategyRepository(path.join(dir, 'strategies'), null, { cloud: false });
  await repo.ensure();
  const learning = new LearningLoopService(new FileAiLearningRepository(path.join(dir, 'learning.json'), null, { mirrorToR2: false }));

  const legacyClient = getGeminiClient();
  const origGen = legacyClient.models.generateContent;
  t.after(() => { legacyClient.models.generateContent = origGen; });

  let refineModelCalls = 0;
  legacyClient.models.generateContent = async params => {
    const schemaProps = params?.config?.responseSchema?.properties || {};
    if (schemaProps.status && schemaProps.understanding) {
      return {
        text: JSON.stringify({
          status: 'ready',
          understanding: 'Clear brief ready for strategy',
          questions: [],
          assumptions: [],
        }),
        candidates: [{ finishReason: 'STOP' }],
      };
    }
    refineModelCalls++;
    return {
      text: JSON.stringify({ ...strategyFixture(), title: `Refined V${refineModelCalls}` }),
      candidates: [{ finishReason: 'STOP' }],
    };
  };

  const aiPolicy = new AiPolicy({ env: { GUEST_AI_DAILY_LIMIT: '100' } });
  configureProviderPolicy({
    assertEnabled: () => aiPolicy.assertEnabled(),
    reserveProvider: (ctx, p) => aiPolicy.reserveProvider(ctx, p),
  });
  t.after(() => configureProviderPolicy(undefined));

  const app = express();
  app.use(express.json());
  const userObj = { id: ownerId, status: 'active', emailVerifiedAt: new Date().toISOString(), authVersion: 1, settings: { modelImprovement: false } };
  app.use((req, _res, next) => { req.ownerId = ownerId; req.user = userObj; req.auth = { user: userObj }; next(); });
  app.use(new PrivacyPolicy({ findById: async id => (id === ownerId ? userObj : null) }).middleware());
  app.use(aiPolicy.middleware());
  app.use('/api/strategy', createStrategyRouter(repo, learning));
  app.use(strategyErrorHandler);

  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}`;

  // 1. Header vs body idempotencyKey mismatch -> 409 IDEMPOTENCY_CONFLICT
  const headerKey = `hdr_${randomUUID()}`;
  const bodyKey = `bdy_${randomUUID()}`;
  const mismatchRes = await fetch(`${base}/api/strategy/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': headerKey },
    body: JSON.stringify({ brief: 'Launch a B2B SaaS platform', answers: [], idempotencyKey: bodyKey }),
  });
  assert.equal(mismatchRes.status, 409);
  assert.equal((await mismatchRes.json()).code, 'IDEMPOTENCY_CONFLICT');

  // Also test header vs body mismatch on /refine
  const refineMismatchRes = await fetch(`${base}/api/strategy/refine`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': headerKey },
    body: JSON.stringify({
      brief: 'Launch a B2B SaaS platform',
      answers: [],
      strategy: strategyFixture(),
      action: 'think_deeper',
      idempotencyKey: bodyKey,
    }),
  });
  assert.equal(refineMismatchRes.status, 409);
  assert.equal((await refineMismatchRes.json()).code, 'IDEMPOTENCY_CONFLICT');

  // 2. /estimate same key + different canonical payload -> 409 IDEMPOTENCY_CONFLICT
  const estKey = `est_${randomUUID()}`;
  const est1 = await fetch(`${base}/api/strategy/estimate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': estKey },
    body: JSON.stringify({ brief: 'Estimate launch brief alpha' }),
  });
  assert.equal(est1.status, 200);
  const est2 = await fetch(`${base}/api/strategy/estimate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': estKey },
    body: JSON.stringify({ brief: 'Estimate launch brief beta DIFFERENT' }),
  });
  assert.equal(est2.status, 409);
  assert.equal((await est2.json()).code, 'IDEMPOTENCY_CONFLICT');

  // 3. /assess same key + different round/payload -> 409 IDEMPOTENCY_CONFLICT
  const assessKey = `ass_${randomUUID()}`;
  const ass1 = await fetch(`${base}/api/strategy/assess`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': assessKey },
    body: JSON.stringify({ brief: 'Assess SaaS readiness plan', answers: [], round: 0 }),
  });
  assert.equal(ass1.status, 200);
  const ass2 = await fetch(`${base}/api/strategy/assess`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': assessKey },
    body: JSON.stringify({ brief: 'Assess SaaS readiness plan', answers: [], round: 1 }),
  });
  assert.equal(ass2.status, 409);
  assert.equal((await ass2.json()).code, 'IDEMPOTENCY_CONFLICT');

  // 4. /:id/refine retry with same Idempotency-Key returns same version without creating an extra version
  const initialStrategy = strategyFixture();
  const saved = await repo.create({
    clientSaveId: `save_${randomUUID()}`,
    brief: 'Saved brief for refine idempotency',
    answers: [],
    strategy: initialStrategy,
    versions: [{ id: randomUUID(), versionNumber: 1, data: initialStrategy, changeRequest: 'Init', createdAt: new Date().toISOString() }],
  }, ownerId);

  const refineRetryKey = `ref_${randomUUID()}`;
  const callsBefore = refineModelCalls;
  const r1 = await fetch(`${base}/api/strategy/${saved.id}/refine`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': refineRetryKey },
    body: JSON.stringify({ action: 'think_deeper', request: 'Deepen GTM', idempotencyKey: refineRetryKey }),
  });
  assert.equal(r1.status, 200);
  const r1Json = await r1.json();
  assert.equal(r1Json.strategy.versions.length, 2);

  // Retry with SAME idempotencyKey and SAME payload -> 200, NO extra model call, still 2 versions
  const r2 = await fetch(`${base}/api/strategy/${saved.id}/refine`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': refineRetryKey },
    body: JSON.stringify({ action: 'think_deeper', request: 'Deepen GTM', idempotencyKey: refineRetryKey }),
  });
  assert.equal(r2.status, 200);
  const r2Json = await r2.json();
  assert.equal(r2Json.strategy.versions.length, 2);
  assert.equal(refineModelCalls, callsBefore + 1, 'Refine retry must not invoke provider a second time');
});

test('Shared activeRefinements on /refine and /:id/refine keep work alive when first subscriber disconnects, and abort when last subscriber disconnects', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'helmer-sec4-refshare-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));

  const ownerId = randomUUID();
  const repo = new FileStrategyRepository(path.join(dir, 'strategies'), null, { cloud: false });
  await repo.ensure();
  const learning = new LearningLoopService(new FileAiLearningRepository(path.join(dir, 'learning.json'), null, { mirrorToR2: false }));

  const legacyClient = getGeminiClient();
  const origGen = legacyClient.models.generateContent;
  t.after(() => { legacyClient.models.generateContent = origGen; });

  const aiPolicy = new AiPolicy({ env: { GUEST_AI_DAILY_LIMIT: '100' } });
  configureProviderPolicy({
    assertEnabled: () => aiPolicy.assertEnabled(),
    reserveProvider: (ctx, p) => aiPolicy.reserveProvider(ctx, p),
  });
  t.after(() => configureProviderPolicy(undefined));

  const userObj = { id: ownerId, status: 'active', emailVerifiedAt: new Date().toISOString(), authVersion: 1, settings: { modelImprovement: false } };
  let routerEnteredCount = 0;
  let lastTransferReleaseCount = 0;
  const makeServer = async () => {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.ownerId = ownerId; req.user = userObj; req.auth = { user: userObj }; next(); });
    app.use(new PrivacyPolicy({ findById: async id => (id === ownerId ? userObj : null) }).middleware());
    app.use(aiPolicy.middleware());
    app.use((req, _res, next) => {
      routerEnteredCount++;
      if (req.securityContext?.transferToBackground) {
        const origTransfer = req.securityContext.transferToBackground.bind(req.securityContext);
        req.securityContext.transferToBackground = () => {
          const lease = origTransfer();
          const origRelease = lease.release.bind(lease);
          return {
            ...lease,
            release: async () => {
              lastTransferReleaseCount++;
              return origRelease();
            },
          };
        };
      }
      next();
    });
    app.use('/api/strategy', createStrategyRouter(repo, learning));
    app.use(strategyErrorHandler);
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
    return `http://127.0.0.1:${server.address().port}`;
  };

  // Two routers/replicas in the same process sharing module-level activeRefinements Map
  const base1 = await makeServer();
  const base2 = await makeServer();

  const saved = await repo.create({
    clientSaveId: `save_${randomUUID()}`,
    brief: 'Shared refinement saved strategy brief',
    answers: [],
    strategy: strategyFixture(),
    versions: [{ id: randomUUID(), versionNumber: 1, data: strategyFixture(), changeRequest: 'Init', createdAt: new Date().toISOString() }],
  }, ownerId);

  for (const mode of ['stateless', 'saved']) {
    // Part 1: two subscribers join; first disconnects -> work stays alive & second succeeds
    let releaseProvider = null;
    let observedSignal = null;
    let providerCalls = 0;

    legacyClient.models.generateContent = (_params, options) => {
      providerCalls++;
      observedSignal = options?.signal;
      return new Promise((resolve, reject) => {
        if (options?.signal?.aborted) return reject(new DOMException('Aborted', 'AbortError'));
        options?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
        releaseProvider = () => resolve({
          text: JSON.stringify({ ...strategyFixture(), title: `Shared Refined ${mode}` }),
          candidates: [{ finishReason: 'STOP' }],
        });
      });
    };

    const sharedKey = `share_${randomUUID()}`;
    const urlPath = mode === 'stateless' ? '/api/strategy/refine' : `/api/strategy/${saved.id}/refine`;
    const body = JSON.stringify(mode === 'stateless'
      ? { brief: 'Shared refine brief', answers: [], strategy: strategyFixture(), action: 'think_deeper', idempotencyKey: sharedKey }
      : { action: 'think_deeper', request: 'Deepen risks', idempotencyKey: sharedKey });

    const sub1Ctrl = new AbortController();
    const p1 = fetch(`${base1}${urlPath}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': sharedKey },
      body,
      signal: sub1Ctrl.signal,
    }).catch(e => e);

    while (!releaseProvider) await new Promise(r => setTimeout(r, 10));

    const enteredBefore = routerEnteredCount;
    const sub2Ctrl = new AbortController();
    const p2 = fetch(`${base2}${urlPath}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': sharedKey },
      body,
      signal: sub2Ctrl.signal,
    });

    while (routerEnteredCount < enteredBefore + 1) await new Promise(r => setTimeout(r, 5));
    await new Promise(r => setTimeout(r, 25));
    // Disconnect subscriber 1 -> provider signal MUST NOT abort while subscriber 2 is active
    const releasesBeforeDisconnect = lastTransferReleaseCount;
    sub1Ctrl.abort();
    await p1;
    await new Promise(r => setTimeout(r, 25));
    assert.equal(observedSignal.aborted, false, `${mode}: disconnecting 1st of 2 subscribers must NOT abort provider`);
    assert.equal(lastTransferReleaseCount, releasesBeforeDisconnect, `${mode}: lease must stay active while 2nd subscriber remains`);
    assert.equal(providerCalls, 1);

    releaseProvider();
    const res2 = await p2;
    assert.equal(res2.status, 200);
    const json2 = await res2.json();
    assert.ok(json2.strategy);
    await new Promise(r => setTimeout(r, 25));
    assert.ok(lastTransferReleaseCount > releasesBeforeDisconnect, `${mode}: lease must release after shared completion`);

    // Part 2: both subscribers join and BOTH disconnect -> last disconnect aborts provider & cleans lease without saving partial version
    releaseProvider = null;
    observedSignal = null;
    const versionsBefore = (await repo.getById(saved.id, ownerId)).versions.length;
    const releasesBeforePart2 = lastTransferReleaseCount;
    legacyClient.models.generateContent = (_params, options) => {
      observedSignal = options?.signal;
      return new Promise((_resolve, reject) => {
        if (options?.signal?.aborted) return reject(new DOMException('Aborted', 'AbortError'));
        options?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
        releaseProvider = true;
      });
    };

    const abortKey = `abort_${randomUUID()}`;
    const abortBody = JSON.stringify(mode === 'stateless'
      ? { brief: 'Shared abort brief', answers: [], strategy: strategyFixture(), action: 'think_deeper', idempotencyKey: abortKey }
      : { action: 'think_deeper', request: 'Abort all', idempotencyKey: abortKey });

    const cA = new AbortController();
    const pA = fetch(`${base1}${urlPath}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': abortKey },
      body: abortBody,
      signal: cA.signal,
    }).catch(e => e);

    while (!releaseProvider) await new Promise(r => setTimeout(r, 10));

    const enteredPart2 = routerEnteredCount;
    const cB = new AbortController();
    const pB = fetch(`${base2}${urlPath}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': abortKey },
      body: abortBody,
      signal: cB.signal,
    }).catch(e => e);

    while (routerEnteredCount < enteredPart2 + 1) await new Promise(r => setTimeout(r, 5));
    await new Promise(r => setTimeout(r, 25));
    cA.abort();
    await pA;
    await new Promise(r => setTimeout(r, 20));
    assert.equal(observedSignal.aborted, false, `${mode}: still 1 active subscriber`);
    assert.equal(lastTransferReleaseCount, releasesBeforePart2, `${mode}: lease must stay active while 2nd subscriber remains`);

    cB.abort();
    await pB;
    await new Promise(r => setTimeout(r, 35));
    assert.equal(observedSignal.aborted, true, `${mode}: disconnecting LAST subscriber must abort provider`);
    assert.ok(lastTransferReleaseCount > releasesBeforePart2, `${mode}: lease cleanup must run when last subscriber disconnects`);
    assert.equal((await repo.getById(saved.id, ownerId)).versions.length, versionsBefore, 'No partial version may be saved after abort');
  }
});

test('execution-lock fencing: stale Redis & R2 lease holders get EXECUTION_LOCK_LOST and cannot overwrite successor lock or replay result', async () => {
  // 1. Redis fencing race
  const redisMap = new Map();
  const fakeRedis = {
    isReady: true,
    async set(key, val, opts) {
      if (opts?.NX && redisMap.has(key)) return null;
      redisMap.set(key, val);
      return 'OK';
    },
    async get(key) {
      return redisMap.has(key) ? redisMap.get(key) : null;
    },
    async eval(script, { keys, arguments: args }) {
      const [k1, k2] = keys;
      if (script.includes('pexpire')) {
        return redisMap.get(k1) === args[0] ? 1 : 0;
      }
      if (script.includes("redis.call('del'")) {
        if (redisMap.get(k1) === args[0]) {
          redisMap.delete(k1);
          return 1;
        }
        return 0;
      }
      if (script.includes("redis.call('set', KEYS[2]")) {
        if (redisMap.get(k1) === args[0]) {
          redisMap.set(k2, args[1]);
          return 1;
        }
        return 0;
      }
      return 0;
    },
  };

  const lockA = await acquireIdempotencyLock({
    ownerId: 'owner-redis',
    idempotencyKey: 'idem_redis_race_0001',
    operation: 'generate',
    redis: fakeRedis,
    timeoutMs: 60_000,
  });
  assert.ok(lockA);

  // Lease expires / stolen in Redis and Lock B acquires it and saves successor result
  const lockKey = 'marketify:lock:strat:owner-redis:generate:idem_redis_race_0001';
  redisMap.delete(lockKey);
  const lockB = await acquireIdempotencyLock({
    ownerId: 'owner-redis',
    idempotencyKey: 'idem_redis_race_0001',
    operation: 'generate',
    redis: fakeRedis,
    timeoutMs: 60_000,
  });
  assert.ok(lockB);
  await lockB.saveResult({ tracked: { result: { title: 'Winner B' } } });

  // Stale Lock A attempts saveResult() -> MUST throw EXECUTION_LOCK_LOST and preserve Winner B result
  await assert.rejects(
    () => lockA.saveResult({ tracked: { result: { title: 'Stale A Overwrite' } } }),
    err => err.code === 'EXECUTION_LOCK_LOST',
  );
  const replayRedis = await lockB.readResult();
  assert.equal(replayRedis.tracked.result.title, 'Winner B');
  assert.equal(replayRedis.ownerToken, lockB.token);
  await lockA.release();
  await lockB.release();

  // 2. R2 single-object ETag CAS fencing race (including mid-saveResult TOCTOU race!)
  let r2Object = null;
  let r2EtagSeq = 0;
  const r2Map = new Map();
  let injectRaceOnNextWrite = false;

  const storage = {
    async read(key) {
      const snap = r2Map.get(key);
      return snap ? { record: structuredClone(snap.record), etag: snap.etag } : { record: null, etag: null };
    },
    async write(key, value, expectedEtag) {
      if (injectRaceOnNextWrite) {
        injectRaceOnNextWrite = false;
        // Between read() and write() of Holder A, Holder B overwrote the single object!
        r2EtagSeq++;
        r2Map.set(key, {
          record: {
            token: 'token-holder-B',
            expiresAt: Date.now() + 60_000,
            result: { tracked: { result: { title: 'R2 Winner B' } }, ownerToken: 'token-holder-B', expiresAt: Date.now() + 60_000 },
          },
          etag: `r2-etag-${r2EtagSeq}`,
        });
      }
      const existing = r2Map.get(key);
      if ((existing?.etag || null) !== (expectedEtag || null)) return false;
      r2EtagSeq++;
      r2Object = structuredClone(value);
      r2Map.set(key, { record: r2Object, etag: `r2-etag-${r2EtagSeq}` });
      return true;
    },
  };

  const r2LockA = await acquireIdempotencyLock({
    ownerId: 'owner-r2',
    idempotencyKey: 'idem_r2_race_0001',
    operation: 'generate',
    timeoutMs: 60_000,
    storage,
  });
  assert.ok(r2LockA);

  // Trigger single-object ETag CAS loss between Holder A's read() and write()
  injectRaceOnNextWrite = true;
  await assert.rejects(
    () => r2LockA.saveResult({ tracked: { result: { title: 'R2 Stale A' } } }),
    err => err.code === 'EXECUTION_LOCK_LOST',
  );
  const storedAfterRace = await r2LockA.readResult();
  assert.equal(storedAfterRace.tracked.result.title, 'R2 Winner B');
  assert.equal(storedAfterRace.ownerToken, 'token-holder-B');
  await r2LockA.release(); // Must not wipe Holder B's lock/result because token mismatch!
  assert.equal((await r2LockA.readResult()).tracked.result.title, 'R2 Winner B');
});
