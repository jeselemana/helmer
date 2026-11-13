import { installBuildRoutingFixture } from './helpers/build-routing-fixture.js';
installBuildRoutingFixture();
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import express from 'express';

import { createPluginRegistry } from '../src/services/plugins/registry.js';
import { CapabilityWorkflow } from '../src/services/plugins/workflow.js';
import { ArtifactRepository } from '../src/repositories/artifact-repository.js';
import { FileChatRepository } from '../src/repositories/file-chat-repository.js';
import { FileStrategyRepository } from '../src/repositories/file-strategy-repository.js';
import { FilePlannerRepository } from '../src/repositories/file-planner-repository.js';
import { FileTelemetryRepository } from '../src/repositories/file-telemetry-repository.js';
import { FileAiLearningRepository } from '../src/repositories/file-ai-learning-repository.js';
import { TelemetryService } from '../src/services/telemetry/telemetry-service.js';
import { LearningLoopService } from '../src/services/learning/learning-loop-service.js';
import { createCapabilityRouter, createArtifactRouter } from '../src/http/capability-router.js';
import { createTelemetryClientRouter } from '../src/http/telemetry-router.js';
import { createStrategyRouter, strategyErrorHandler } from '../src/http/strategy-router.js';
import { createPlannerRouter } from '../src/http/planner-router.js';
import { createAskHandler } from '../src/http/ask-handler.js';
import { createAskService, buildAskContents } from '../src/services/ai/ask-service.js';
import { createAskConfig } from '../src/services/ai/ask-config.js';
import { sanitizeAskGroundingMetadata } from '../src/services/ai/ask-grounding.js';
import { getRelevantUserContext } from '../src/services/ai/personal-context.js';
import { AiPolicy } from '../src/services/security/ai-policy.js';
import { configureProviderPolicy, wrapProvider } from '../src/services/security/provider-policy.js';
import { PrivacyPolicy } from '../src/services/security/privacy-policy.js';
import { getGeminiClient, getBuildVertexClient } from '../src/services/ai/client.js';
import { specs } from './artifact-fixtures.js';

function createSampleStrategy(title = 'B2B Growth Plan', tag = 'default') {
  return {
    title,
    summary: `Executive summary for ${title} (${tag}).`,
    context: {
      business: `SaaS Analytics ${tag}`,
      objective: `Acquire 100 enterprise accounts (${tag})`,
      market: `Baku ${tag}`,
      targetAudience: `SME CFOs ${tag}`,
    },
    sections: [
      { id: `${tag}-s1`, title: `Overview ${tag}`, summary: `Strategic overview ${tag}`, content: `Detailed strategic content ${tag}.`, bullets: [`Bullet A ${tag}`] },
      { id: `${tag}-s2`, title: `Market ${tag}`, summary: `Market positioning ${tag}`, content: `Market positioning ${tag}.`, bullets: [`Bullet B ${tag}`] },
      { id: `${tag}-s3`, title: `Acquisition ${tag}`, summary: `Lead acquisition ${tag}`, content: `Acquisition steps ${tag}.`, bullets: [`Bullet C ${tag}`] },
      { id: `${tag}-s4`, title: `Retention ${tag}`, summary: `Client retention ${tag}`, content: `Retention workflow ${tag}.`, bullets: [`Bullet D ${tag}`] },
      { id: `${tag}-s5`, title: `Execution ${tag}`, summary: `Execution milestones ${tag}`, content: `Phase 1 launch steps ${tag}.`, bullets: [`Bullet E ${tag}`] },
    ],
    priorities: [{ title: `Direct enterprise outreach ${tag}`, description: `High conversion ${tag}`, priority: 'high' }],
    actionPlan: [
      { phase: `Month 1 ${tag}`, actions: [`Audit CRM funnel ${tag}`], expectedOutcome: `Baseline conversion ${tag}` },
    ],
    kpis: [{ name: `MRR growth ${tag}`, reason: `Revenue velocity ${tag}`, target: '25%' }],
    risks: [{ risk: `Slow procurement cycle ${tag}`, mitigation: `Pilot SLA ${tag}` }],
    assumptions: [`Baseline CAC stays flat ${tag}`],
    nextSteps: [`Schedule pilot demos ${tag}`],
  };
}

test('HTTP Regression 1: Saved grounded Build strategy with @word never sends evidence or orchestration to provider', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'helmer-sec1-word-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));

  const ownerId = `usr_${randomUUID()}`;
  const artifacts = new ArtifactRepository(path.join(dir, 'artifacts'));
  const chats = new FileChatRepository(path.join(dir, 'chats.json'), null, { cloud: false });
  chats.artifactRepository = artifacts;
  const strategies = new FileStrategyRepository(path.join(dir, 'strategies'), null, { cloud: false });
  await strategies.ensure();

  // Verify fail-closed creation when grounded record lacks an authoritative source date
  const undatedGrounded = await strategies.create({
    clientSaveId: `save_undated_${randomUUID()}`,
    brief: 'Undated grounded brief',
    answers: [],
    strategy: {
      ...createSampleStrategy('Undated Grounded'),
      orchestration: { searchGrounded: true },
    },
  }, ownerId);
  assert.equal(undatedGrounded, null, 'Undated grounded strategy without provenance must fail closed');

  const savedGrounded = await strategies.create({
    clientSaveId: `save_${randomUUID()}`,
    brief: 'CONFIDENTIAL GROUNDED BRIEF SECRET',
    answers: [],
    firstGroundedAt: new Date().toISOString(),
    strategy: {
      ...createSampleStrategy('GROUNDED BUILD SECRET TITLE'),
      orchestration: {
        searchGrounded: true,
        evidence: [{ claim: 'Live benchmark is 42.7% in Q4', sourceIndex: 0 }],
        internalPromptToken: 'SECRET_ORCHESTRATION_METADATA',
      },
      sources: [{ title: 'Market Report', url: 'https://example.com/report' }],
    },
  }, ownerId);
  assert.ok(savedGrounded?.id);

  const allowedStrategy = await strategies.create({
    clientSaveId: `save_${randomUUID()}`,
    brief: 'Ungrounded standard strategy brief',
    answers: [],
    strategy: {
      ...createSampleStrategy('Allowed Standard Title', 'ungrounded-distinct'),
      orchestration: {
        mode: 'standard',
        internalNotes: 'INTERNAL_ORCHESTRATION_LEAK_MARKER',
      },
    },
  }, ownerId);

  const providerCalls = [];
  const workflow = new CapabilityWorkflow({
    registry: createPluginRegistry(),
    artifacts,
    research: async () => { throw new Error('Should not run web research for blocked grounded strategy'); },
    generate: async args => {
      providerCalls.push(args);
      const parsed = JSON.parse(args.input);
      if (parsed.previous) {
        return {
          data: {
            title: null,
            header: null,
            footer: null,
            citations: null,
            operations: [{ action: 'replace', index: 0, unit: specs.word.units[0] }],
          },
          model: 'fixture',
        };
      }
      return { data: structuredClone(specs.word), model: 'fixture' };
    },
  });

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.ownerId = ownerId;
    req.user = { id: ownerId, emailVerifiedAt: new Date().toISOString(), settings: { language: 'az', modelImprovement: true } };
    req.auth = { user: req.user };
    next();
  });
  app.use('/api/ask', createCapabilityRouter({
    registry: createPluginRegistry(),
    workflow,
    artifacts,
    chats,
    strategies,
    planner: { list: async () => [] },
  }));
  app.use('/api/artifacts', createArtifactRouter({ artifacts, chats }));
  app.post('/api/ask', (_req, res) => res.json({ ordinaryChat: true }));

  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}`;

  // 1a. Saved grounded strategy via strategyId is blocked before provider call
  const blockedSaved = await fetch(`${base}/api/ask`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      pluginIds: ['word'],
      strategyId: savedGrounded.id,
      messages: [{ role: 'user', content: '@word Bunu Word faylı kimi hazırla' }],
    }),
  });
  assert.equal(blockedSaved.status, 422);
  const blockedBody = await blockedSaved.json();
  assert.equal(blockedBody.code, 'GROUNDED_STRATEGY_RESTRICTED');
  assert.equal(providerCalls.length, 0, 'Provider must not be invoked for saved grounded strategy');

  // 1b. Chat containing grounded assistant turn (e.g. Ask Web / legacy sources) never leaks grounded content into @word provider
  const groundedChat = await chats.saveChat({
    ownerId,
    messages: [
      { role: 'user', content: 'Discuss strategy' },
      { role: 'assistant', content: 'GROUNDED_CHAT_ASSISTANT_SECRET', sources: [{ title: 'Source', url: 'https://example.com' }] },
    ],
  });
  const blockedOrSanitizedChatRes = await fetch(`${base}/api/ask`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      pluginIds: ['word'],
      chatId: groundedChat.id,
      chatRevision: groundedChat.revision,
      messages: [{ role: 'user', content: '@word Hazırla' }],
    }),
  });
  assert.ok([200, 422].includes(blockedOrSanitizedChatRes.status));
  assert.ok(providerCalls.every(call => !JSON.stringify(call).includes('GROUNDED_CHAT_ASSISTANT_SECRET')));
  providerCalls.length = 0;

  // 1c. Allowed strategy works AND strips internal orchestration metadata from model input & edit path
  const allowedRes = await fetch(`${base}/api/ask`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      pluginIds: ['word'],
      strategyId: allowedStrategy.id,
      messages: [{ role: 'user', content: '@word Hazırla' }],
    }),
  });
  assert.equal(allowedRes.status, 200);
  const allowedData = await allowedRes.json();
  assert.equal(providerCalls.length, 1);
  assert.ok(!providerCalls[0].input.includes('INTERNAL_ORCHESTRATION_LEAK_MARKER'));
  assert.ok(!providerCalls[0].input.includes('"orchestration"'));
  assert.ok(!providerCalls[0].input.includes('42.7%'));

  // 1d. Follow-up artifact edit/reference strips internal metadata if stored on chat messages
  const editRes = await fetch(`${base}/api/ask`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      pluginIds: ['word'],
      chatId: allowedData.chat.id,
      chatRevision: allowedData.chat.revision,
      messages: [{ role: 'user', content: '@word Birinci bölməni qısalt' }],
    }),
  });
  assert.equal(editRes.status, 200);
  assert.equal(providerCalls.length, 2);
  assert.ok(!providerCalls[1].input.includes('INTERNAL_ORCHESTRATION_LEAK_MARKER'));
});

test('HTTP Regression 2: Grounded PDF export & unsaved grounded feedback never store title/brief even with modelImprovement consent', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'helmer-sec1-telemetry-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));

  const ownerId = randomUUID();
  const strategyRepo = new FileStrategyRepository(path.join(dir, 'strategies'), null, { cloud: false });
  await strategyRepo.ensure();
  const telemetryRepo = new FileTelemetryRepository(path.join(dir, 'telemetry.json'), null, { mirrorToR2: false });
  const telemetryService = new TelemetryService(telemetryRepo);
  const learningRepo = new FileAiLearningRepository(path.join(dir, 'learning.json'), null, { mirrorToR2: false });
  const learningService = new LearningLoopService(learningRepo);

  const client = getGeminiClient();
  const buildClient = getBuildVertexClient();
  const originalGen = client.models.generateContent;
  t.after(() => { client.models.generateContent = originalGen; });

  const unsavedClientSaveId = `unsaved_${randomUUID()}`;
  const unsavedBrief = 'UNSAVED_GROUNDED_BRIEF_CONFIDENTIAL_ABC';
  const unsavedTitle = 'UNSAVED_GROUNDED_TITLE_CONFIDENTIAL_XYZ';

  const scoutResponse = () => {
    const fact = 'Market grew 18% in 2026';
    const scoutJson = JSON.stringify({
      needs_search: true,
      argon_thinking_level: 'High',
      facts: [fact],
      focus_area: 'Baku market',
    });
    const factEndChar = scoutJson.indexOf(fact) + fact.length + 1;
    const segText = scoutJson.slice(0, factEndChar);
    return {
      text: scoutJson,
      groundingMetadata: {
        webSearchQueries: ['Baku market 2026'],
        groundingChunks: [{ web: { uri: 'https://example.com/baku-2026', title: 'Baku Data' } }],
        groundingSupports: [{
          segment: { startIndex: 0, endIndex: Buffer.byteLength(segText), text: segText },
          groundingChunkIndices: [0],
        }],
      },
      candidates: [{ finishReason: 'STOP' }],
    };
  };

  client.models.generateContent = async () => ({
    text: JSON.stringify(createSampleStrategy(unsavedTitle)),
    candidates: [{ finishReason: 'STOP' }],
  });

  t.mock.method(buildClient.models, 'generateContent', async params => {
    if (params.config?.responseSchema?.properties?.needs_search) return scoutResponse();
    return {
      text: JSON.stringify(createSampleStrategy(unsavedTitle)),
      candidates: [{ finishReason: 'STOP' }],
    };
  });
  t.mock.method(buildClient.models, 'generateContentStream', async function* (params) {
    if (params.config?.responseSchema?.properties?.needs_search) yield scoutResponse();
    else yield { text: JSON.stringify(createSampleStrategy(unsavedTitle)), candidates: [{ finishReason: 'STOP' }] };
  });

  const aiPolicy = new AiPolicy({ env: { GUEST_AI_DAILY_LIMIT: '100' } });
  configureProviderPolicy({
    assertEnabled: () => aiPolicy.assertEnabled(),
    reserveProvider: (context, params) => aiPolicy.reserveProvider(context, params),
  });
  t.after(() => configureProviderPolicy(undefined));

  const app = express();
  app.use(express.json());
  const userRecord = { id: ownerId, status: 'active', emailVerifiedAt: new Date().toISOString(), authVersion: 1, settings: { modelImprovement: true, personalIntelligence: true } };
  app.use((req, _res, next) => {
    req.ownerId = ownerId;
    req.user = userRecord;
    req.auth = { user: req.user };
    next();
  });
  app.use(new PrivacyPolicy({ findById: async id => (id === ownerId ? userRecord : null) }).middleware());
  app.use(aiPolicy.middleware());
  app.use('/api/telemetry', createTelemetryClientRouter(telemetryService, { strategyRepository: strategyRepo }));
  app.use('/api/strategy', createStrategyRouter(strategyRepo, learningService, { telemetryService }));
  app.use(strategyErrorHandler);

  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}`;

  // First produce an unsaved grounded strategy via /api/strategy/generate (autoSave: false)
  const genRes = await fetch(`${base}/api/strategy/generate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': unsavedClientSaveId,
      'X-Helmer-Model-Improvement': 'true',
    },
    body: JSON.stringify({
      brief: unsavedBrief,
      answers: [],
      autoSave: false,
      idempotencyKey: unsavedClientSaveId,
    }),
  });
  assert.equal(genRes.status, 200);
  const genData = await genRes.json();
  assert.equal(genData.strategy?.orchestration?.searchGrounded, true);

  // 2a. Grounded PDF export event with consent active -> must NEVER store title
  const exportRes = await fetch(`${base}/api/telemetry/event`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Helmer-Model-Improvement': 'true',
    },
    body: JSON.stringify({
      eventType: 'export_requested',
      format: 'pdf',
      title: unsavedTitle,
      clientSaveId: unsavedClientSaveId,
      groundingActive: true,
    }),
  });
  assert.equal(exportRes.status, 200);

  // 2b. Missing/unknown strategyId export without client grounding flag -> fails closed (no title persisted)
  const missingExportRes = await fetch(`${base}/api/telemetry/event`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Helmer-Model-Improvement': 'true',
    },
    body: JSON.stringify({
      eventType: 'export_requested',
      format: 'pdf',
      strategyId: randomUUID(),
      title: 'ORPHAN_SECRET_TITLE_NO_FLAG',
    }),
  });
  assert.equal(missingExportRes.status, 200);

  // 2c. Unsaved grounded result feedback -> even with modelImprovement=true and client omitting flag, provenance redacts title & brief
  const feedbackRes = await fetch(`${base}/api/strategy/feedback`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Helmer-Model-Improvement': 'true',
    },
    body: JSON.stringify({
      clientSaveId: unsavedClientSaveId,
      brief: unsavedBrief,
      title: unsavedTitle,
      feedback: 'like',
    }),
  });
  assert.equal(feedbackRes.status, 200);

  await new Promise(resolve => setTimeout(resolve, 25));
  const storedTelemetry = await telemetryRepo.listEvents({ page: 1, pageSize: 50 });
  const serialized = JSON.stringify(storedTelemetry.items);
  assert.ok(!serialized.includes(unsavedBrief), 'Brief must never appear in telemetry');
  assert.ok(!serialized.includes(unsavedTitle), 'Title must never appear in telemetry');
  assert.ok(!serialized.includes('ORPHAN_SECRET_TITLE_NO_FLAG'), 'Missing strategyId export must not persist title');

  const exportEvents = storedTelemetry.items.filter(e => e.mode === 'export');
  assert.equal(exportEvents.length, 2);
  assert.ok(exportEvents.every(e => e.onlyNecessaryData === true && e.modelImprovement === false));

  const feedbackEvents = storedTelemetry.items.filter(e => e.eventType === 'strategy_feedback');
  assert.equal(feedbackEvents.length, 1);
  assert.equal(feedbackEvents[0].onlyNecessaryData, true);
  assert.equal(feedbackEvents[0].modelImprovement, false);
});

test('Server provenance defeats client stripping of orchestration on /save, /refine, and /:id/refine', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'helmer-sec1-prov-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));

  const ownerId = randomUUID();
  const strategyRepo = new FileStrategyRepository(path.join(dir, 'strategies'), null, { cloud: false });
  await strategyRepo.ensure();
  const telemetryRepo = new FileTelemetryRepository(path.join(dir, 'telemetry.json'), null, { mirrorToR2: false });
  const telemetryService = new TelemetryService(telemetryRepo);
  const learningRepo = new FileAiLearningRepository(path.join(dir, 'learning.json'), null, { mirrorToR2: false });
  const learningService = new LearningLoopService(learningRepo);

  const client = getGeminiClient();
  const buildClient = getBuildVertexClient();
  const originalGen = client.models.generateContent;
  t.after(() => { client.models.generateContent = originalGen; });

  const secretBrief = 'PROVENANCE_SECRET_BRIEF_999';
  const generatedTitle = 'PROVENANCE_SECRET_TITLE_999';

  const scoutResponse = () => {
    const fact = 'Competitor price is 99 AZN';
    const scoutJson = JSON.stringify({
      needs_search: true,
      argon_thinking_level: 'High',
      facts: [fact],
      focus_area: 'Pricing',
    });
    const factEndChar = scoutJson.indexOf(fact) + fact.length + 1;
    const segText = scoutJson.slice(0, factEndChar);
    return {
      text: scoutJson,
      groundingMetadata: {
        webSearchQueries: ['competitor price 99 azn'],
        groundingChunks: [{ web: { uri: 'https://example.com/price', title: 'Pricing' } }],
        groundingSupports: [{
          segment: { startIndex: 0, endIndex: Buffer.byteLength(segText), text: segText },
          groundingChunkIndices: [0],
        }],
      },
      candidates: [{ finishReason: 'STOP' }],
    };
  };

  let totalModelCalls = 0;
  t.mock.method(buildClient.models, 'generateContent', async params => {
    totalModelCalls++;
    if (params.config?.responseSchema?.properties?.needs_search) return scoutResponse();
    return {
      text: JSON.stringify(createSampleStrategy(generatedTitle)),
      candidates: [{ finishReason: 'STOP' }],
    };
  });
  t.mock.method(buildClient.models, 'generateContentStream', async function* (params) {
    totalModelCalls++;
    if (params.config?.responseSchema?.properties?.needs_search) yield scoutResponse();
    else yield { text: JSON.stringify(createSampleStrategy(generatedTitle)), candidates: [{ finishReason: 'STOP' }] };
  });

  client.models.generateContent = async params => {
    totalModelCalls++;
    return {
      candidates: [{ finishReason: 'STOP' }],
      text: JSON.stringify(createSampleStrategy(params?.contents?.toString?.().includes('refine') ? 'REFINED_GROUNDED_TITLE' : generatedTitle)),
    };
  };

  const aiPolicy = new AiPolicy({ env: { GUEST_AI_DAILY_LIMIT: '100' } });
  configureProviderPolicy({
    assertEnabled: () => aiPolicy.assertEnabled(),
    reserveProvider: (context, params) => aiPolicy.reserveProvider(context, params),
  });
  t.after(() => configureProviderPolicy(undefined));

  const router = createStrategyRouter(strategyRepo, learningService, { telemetryService });
  const app = express();
  app.use(express.json());
  const userRecord = { id: ownerId, status: 'active', emailVerifiedAt: new Date().toISOString(), authVersion: 1, settings: { modelImprovement: true, personalIntelligence: true } };
  app.use((req, _res, next) => {
    req.ownerId = ownerId;
    req.user = userRecord;
    req.auth = { user: req.user };
    next();
  });
  app.use(new PrivacyPolicy({ findById: async id => (id === ownerId ? userRecord : null) }).middleware());
  app.use(aiPolicy.middleware());
  app.use('/api/strategy', router);
  app.use(strategyErrorHandler);

  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}`;

  const genKey = `idem_${randomUUID()}`;
  const genRes = await fetch(`${base}/api/strategy/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': genKey },
    body: JSON.stringify({ brief: secretBrief, answers: [], autoSave: false, idempotencyKey: genKey }),
  });
  assert.equal(genRes.status, 200);
  const genJson = await genRes.json();

  // Client strips orchestration, evidence, sources, swaps clientSaveId and title, tries /save as "ordinary" strategy
  const strippedStrategy = {
    title: 'Renamed Client Copy',
    summary: genJson.strategy.summary,
    context: genJson.strategy.context,
    sections: genJson.strategy.sections,
    priorities: genJson.strategy.priorities,
    actionPlan: genJson.strategy.actionPlan,
    kpis: genJson.strategy.kpis,
    risks: genJson.strategy.risks,
    assumptions: genJson.strategy.assumptions,
    nextSteps: genJson.strategy.nextSteps,
  };

  const saveRes = await fetch(`${base}/api/strategy/save`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `idem_${randomUUID()}` },
    body: JSON.stringify({
      clientSaveId: `forged_${randomUUID()}`,
      brief: secretBrief,
      answers: [],
      strategy: strippedStrategy,
      versions: [
        {
          versionNumber: 1,
          data: strippedStrategy,
          changeRequest: 'Initial client save',
          createdAt: new Date().toISOString(),
        },
      ],
    }),
  });
  assert.equal(saveRes.status, 201);
  const savedJson = await saveRes.json();
  assert.equal(savedJson.strategy.searchGrounded || savedJson.strategy.strategy?.orchestration?.searchGrounded, true, '/save must restore grounded provenance even when client strips orchestration');
  assert.ok(savedJson.strategy.firstGroundedAt || savedJson.strategy.strategy?.orchestration?.firstGroundedAt, '/save must preserve firstGroundedAt provenance');

  // Client strips orchestration on stateless /refine -> server provenance rejects before calling model
  const callsBeforeRefine = totalModelCalls;
  const refineStatelessRes = await fetch(`${base}/api/strategy/refine`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `idem_${randomUUID()}` },
    body: JSON.stringify({
      brief: secretBrief,
      answers: [],
      strategy: strippedStrategy,
      action: 'custom',
      request: 'Refine pricing without telling server it was grounded',
    }),
  });
  assert.equal(refineStatelessRes.status, 422);
  const refinedStatelessErr = await refineStatelessRes.json();
  assert.equal(refinedStatelessErr.code, 'GROUNDED_STRATEGY_RESTRICTED');

  // Client calls /:id/refine on saved strategy -> server provenance blocks before calling model
  const refineByIdRes = await fetch(`${base}/api/strategy/${savedJson.strategy.id}/refine`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `idem_${randomUUID()}` },
    body: JSON.stringify({
      action: 'think_deeper',
      request: 'Deepen GTM risks',
    }),
  });
  assert.equal(refineByIdRes.status, 422);
  const refineByIdErr = await refineByIdRes.json();
  assert.equal(refineByIdErr.code, 'GROUNDED_STRATEGY_RESTRICTED');

  // Legacy saved grounded record (orchestration.searchGrounded only, no top-level flag) also blocked on /:id/refine
  const legacySaved = await strategyRepo.create({
    clientSaveId: `legacy_${randomUUID()}`,
    brief: 'LEGACY_GROUNDED_RECORD_BRIEF',
    answers: [],
    strategy: {
      ...createSampleStrategy('Legacy Grounded Strategy'),
      orchestration: { searchGrounded: true },
    },
    createdAt: new Date().toISOString(),
  }, ownerId);
  const legacyRefineRes = await fetch(`${base}/api/strategy/${legacySaved.id}/refine`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `idem_${randomUUID()}` },
    body: JSON.stringify({ action: 'think_deeper', request: 'Deepen legacy' }),
  });
  assert.equal(legacyRefineRes.status, 422);
  assert.equal((await legacyRefineRes.json()).code, 'GROUNDED_STRATEGY_RESTRICTED');
  assert.equal(totalModelCalls, callsBeforeRefine, 'Grounded /refine and /:id/refine must block before any model call');

  await new Promise(resolve => setTimeout(resolve, 25));
  const learningStore = await learningRepo.readStore();
  assert.equal(learningStore.iterations.length, 0, 'Grounded refinement must never record learning iterations');
  assert.ok(!JSON.stringify(learningStore).includes(secretBrief));

  const teleEvents = await telemetryRepo.listEvents({ page: 1, pageSize: 50 });
  assert.ok(!JSON.stringify(teleEvents.items).includes(secretBrief));
  assert.ok(teleEvents.items.every(e => e.onlyNecessaryData === true));
});

test('Build -> Planner -> Ask & Planner feedback telemetry preserve grounded provenance and block model leakage', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'helmer-sec1-planner-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));

  const ownerId = randomUUID();
  const strategyRepo = new FileStrategyRepository(path.join(dir, 'strategies'), null, { cloud: false });
  await strategyRepo.ensure();
  const plannerRepo = new FilePlannerRepository(path.join(dir, 'planner'), null, { cloud: false });
  await plannerRepo.ensure();
  const chatRepo = new FileChatRepository(path.join(dir, 'chats.json'), null, { cloud: false });
  const telemetryRepo = new FileTelemetryRepository(path.join(dir, 'telemetry.json'), null, { mirrorToR2: false });
  const telemetryService = new TelemetryService(telemetryRepo);

  const groundedStrategy = await strategyRepo.create({
    clientSaveId: `save_${randomUUID()}`,
    brief: 'GROUNDED_PLANNER_SECRET_BRIEF',
    answers: [],
    strategy: {
      ...createSampleStrategy('Grounded Planner Source'),
      orchestration: { searchGrounded: true },
    },
    groundingActive: true,
    firstGroundedAt: new Date().toISOString(),
  }, ownerId);

  let openAiCalls = 0;
  const mockOpenAI = {
    chat: {
      completions: {
        create: async () => {
          openAiCalls++;
          return {
            choices: [{
              message: {
                content: JSON.stringify({ tasks: [{ title: 'Step 1', timeframe: 'Today', status: 'todo' }] }),
              },
            }],
          };
        },
      },
    },
  };

  const askCalls = [];
  const geminiClient = wrapProvider({
    models: {
      generateContent: async params => {
        askCalls.push(params);
        return { text: 'Ok.', candidates: [{ finishReason: 'STOP' }] };
      },
    },
  }, 'gemini');

  const app = express();
  app.use(express.json());
  const userRecord = { id: ownerId, status: 'active', emailVerifiedAt: new Date().toISOString(), authVersion: 1, settings: { modelImprovement: true, personalIntelligence: true } };
  app.use((req, _res, next) => {
    req.ownerId = ownerId;
    req.user = userRecord;
    req.auth = { user: req.user };
    next();
  });
  app.use(new PrivacyPolicy({ findById: async id => (id === ownerId ? userRecord : null) }).middleware());
  app.use('/api/planner', createPlannerRouter(plannerRepo, {
    strategyRepository: strategyRepo,
    telemetryService,
    openAiClient: mockOpenAI,
  }));
  app.post('/api/ask', createAskHandler({
    configured: () => true,
    chatRepository: chatRepo,
    strategyRepository: strategyRepo,
    plannerRepository: plannerRepo,
    researchService: {},
    limits: createAskConfig({}),
    learningLoop: { createInteractionId: randomUUID, recordInteraction: async () => {}, recordSignal: async () => {} },
    telemetryService,
    sanitizeGroundingMetadata: sanitizeAskGroundingMetadata,
    generateAsk: createAskService({ getClient: () => geminiClient }),
  }));

  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}`;

  // 1. Saved grounded strategyId -> /api/planner/summarize must refuse OpenAI call
  const summarizeSaved = await fetch(`${base}/api/planner/summarize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ strategyId: groundedStrategy.id }),
  });
  assert.equal(summarizeSaved.status, 422);
  assert.equal(openAiCalls, 0);

  // 2. Build UI task text without strategyId when searchGrounded marker applies -> refuse summarize
  const summarizeUiText = await fetch(`${base}/api/planner/summarize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tasks: [{ title: 'Launch campaign from grounded Build benchmark', timeframe: 'Bu gün', searchGrounded: true }],
      searchGrounded: true,
    }),
  });
  assert.equal(summarizeUiText.status, 422);
  assert.equal(openAiCalls, 0);

  // 3. Create Planner task linked to grounded Build strategy -> Ask with taskId & feedback telemetry keep provenance
  const createTaskRes = await fetch(`${base}/api/planner`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: 'CONFIDENTIAL_GROUNDED_PLANNER_TASK',
      timeframe: 'Today',
      strategyId: groundedStrategy.id,
      searchGrounded: true,
    }),
  });
  assert.equal(createTaskRes.status, 201);
  const createdTask = (await createTaskRes.json()).task;

  const askWithTask = await fetch(`${base}/api/ask`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `idem_${randomUUID()}` },
    body: JSON.stringify({
      taskId: createdTask.id,
      messages: [{ role: 'user', content: 'Explain this task' }],
    }),
  });
  // Blocked or excluded from model call
  assert.ok([200, 422].includes(askWithTask.status));
  if (askCalls.length > 0) {
    assert.ok(!JSON.stringify(askCalls).includes('CONFIDENTIAL_GROUNDED_PLANNER_TASK'));
  }

  const fbRes = await fetch(`${base}/api/planner/${createdTask.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ feedback: 'like' }),
  });
  assert.equal(fbRes.status, 200);
  await new Promise(resolve => setTimeout(resolve, 40));
  const events = await telemetryRepo.listEvents({ page: 1, pageSize: 20 });
  assert.ok(!JSON.stringify(events.items).includes('CONFIDENTIAL_GROUNDED_PLANNER_TASK'));
  assert.ok(events.items.some(e => e.onlyNecessaryData === true || e.metadata?.onlyNecessaryData === true));
});

test('Ask legacy sources-only assistant/model messages retain synthesized text in active Ask context without raw sources, and redact LearningLoop, Telemetry, and PersonalContext', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'helmer-sec1-legacy-ask-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));

  const ownerId = randomUUID();
  const chatRepo = new FileChatRepository(path.join(dir, 'chats.json'), null, { cloud: false });
  const strategyRepo = new FileStrategyRepository(path.join(dir, 'strategies'), null, { cloud: false });
  await strategyRepo.ensure();
  const telemetryRepo = new FileTelemetryRepository(path.join(dir, 'telemetry.json'), null, { mirrorToR2: false });
  const telemetryService = new TelemetryService(telemetryRepo);
  const learningRepo = new FileAiLearningRepository(path.join(dir, 'learning.json'), null, { mirrorToR2: false });
  const learningService = new LearningLoopService(learningRepo);

  const chat = await chatRepo.saveChat({
    ownerId,
    messages: [
      { role: 'user', content: 'Legacy grounded question' },
      {
        role: 'assistant',
        content: 'LEGACY_SOURCES_ONLY_ASSISTANT_SECRET',
        sources: [{ title: 'Legacy Source', url: 'https://example.com/legacy' }],
      },
    ],
  });

  // 1. Unit check on buildAskContents with legacy sources-only turn (model role too):
  // synthesized reply text stays in active Ask context, raw sources/URLs do not
  const unitContents = buildAskContents([
    { role: 'user', content: 'Hi' },
    { role: 'model', content: 'LEGACY_MODEL_SOURCES_ONLY_SECRET', sources: [{ title: 'S', url: 'https://example.com' }] },
    { role: 'user', content: 'Follow up' },
  ], ownerId, { resolveFile: () => null }, createAskConfig({}));
  assert.ok(JSON.stringify(unitContents).includes('LEGACY_MODEL_SOURCES_ONLY_SECRET'));
  assert.ok(!JSON.stringify(unitContents).includes('https://example.com'));

  // 2. Ask HTTP success + failure redaction with legacy sources-only chat
  const askCalls = [];
  let failProvider = false;
  const geminiClient = wrapProvider({
    models: {
      generateContent: async params => {
        askCalls.push(params);
        if (failProvider) throw Object.assign(new Error('Provider error'), { status: 503 });
        return { text: 'Follow-up answer.', candidates: [{ finishReason: 'STOP' }] };
      },
    },
  }, 'gemini');

  const app = express();
  app.use(express.json());
  const userRecord = { id: ownerId, status: 'active', emailVerifiedAt: new Date().toISOString(), authVersion: 1, settings: { modelImprovement: true, personalIntelligence: true } };
  app.use((req, _res, next) => {
    req.ownerId = ownerId;
    req.user = userRecord;
    req.auth = { user: req.user };
    next();
  });
  app.use(new PrivacyPolicy({ findById: async id => (id === ownerId ? userRecord : null) }).middleware());
  app.post('/api/ask', createAskHandler({
    configured: () => true,
    chatRepository: chatRepo,
    strategyRepository: strategyRepo,
    plannerRepository: { list: async () => [] },
    researchService: {},
    limits: createAskConfig({}),
    learningLoop: learningService,
    telemetryService,
    sanitizeGroundingMetadata: sanitizeAskGroundingMetadata,
    generateAsk: createAskService({ getClient: () => geminiClient }),
  }));

  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}`;

  const okRes = await fetch(`${base}/api/ask`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': `idem_${randomUUID()}`,
      'X-Helmer-Model-Improvement': 'true',
    },
    body: JSON.stringify({
      chatId: chat.id,
      chatRevision: chat.revision,
      messages: [{ role: 'user', content: 'USER_PROMPT_IN_LEGACY_GROUNDED_CHAT_OK' }],
    }),
  });
  assert.equal(okRes.status, 200);
  assert.ok(JSON.stringify(askCalls[0].contents).includes('LEGACY_SOURCES_ONLY_ASSISTANT_SECRET'));
  assert.ok(!JSON.stringify(askCalls[0].contents).includes('https://example.com/legacy'));

  failProvider = true;
  const freshChat = await chatRepo.getById(chat.id, ownerId);
  const failRes = await fetch(`${base}/api/ask`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': `idem_${randomUUID()}`,
      'X-Helmer-Model-Improvement': 'true',
    },
    body: JSON.stringify({
      chatId: chat.id,
      chatRevision: freshChat.revision,
      messages: [{ role: 'user', content: 'USER_PROMPT_IN_LEGACY_GROUNDED_CHAT_FAIL' }],
    }),
  });
  assert.equal(failRes.status, 503);
  await new Promise(resolve => setTimeout(resolve, 60));

  const lStore = await learningRepo.readStore();
  assert.ok(!JSON.stringify(lStore).includes('USER_PROMPT_IN_LEGACY_GROUNDED_CHAT_OK'));
  assert.ok(!JSON.stringify(lStore).includes('USER_PROMPT_IN_LEGACY_GROUNDED_CHAT_FAIL'));
  assert.ok(lStore.interactions.every(i => i.onlyNecessaryData === true));

  const tEvents = await telemetryRepo.listEvents({ page: 1, pageSize: 20 });
  assert.ok(!JSON.stringify(tEvents.items).includes('USER_PROMPT_IN_LEGACY_GROUNDED_CHAT_OK'));
  assert.ok(!JSON.stringify(tEvents.items).includes('USER_PROMPT_IN_LEGACY_GROUNDED_CHAT_FAIL'));
  assert.ok(tEvents.items.every(e => e.onlyNecessaryData === true));

  // 3. PersonalContext skips strategies with sources / evidence / searchEntryPoint / grounded version
  await strategyRepo.create({
    brief: 'PERSONAL_CONTEXT_SOURCES_SECRET',
    answers: [],
    strategy: { ...createSampleStrategy('PC_SOURCES_SECRET'), sources: [{ title: 'X', url: 'https://example.com' }] },
  }, ownerId);
  await strategyRepo.create({
    brief: 'PERSONAL_CONTEXT_VERSION_SECRET',
    answers: [],
    strategy: createSampleStrategy('PC_VERSION_SECRET'),
    versions: [{ versionNumber: 1, data: { ...createSampleStrategy('V1'), evidence: [{ claim: 'Live', sourceIndex: 0 }] } }],
  }, ownerId);

  const ctx = await getRelevantUserContext({
    user: { id: ownerId, settings: { personalIntelligence: true } },
    chatRepository: chatRepo,
    strategyRepository: strategyRepo,
  });
  assert.ok(!JSON.stringify(ctx).includes('PERSONAL_CONTEXT_SOURCES_SECRET'));
  assert.ok(!JSON.stringify(ctx).includes('PERSONAL_CONTEXT_VERSION_SECRET'));
  assert.ok(!JSON.stringify(ctx).includes('LEGACY_SOURCES_ONLY_ASSISTANT_SECRET'));

  // 4. LearningLoop blocks iteration when response itself is grounded even on ungrounded parent
  const ungroundedParent = await learningService.recordInteraction({
    ownerId,
    mode: 'build',
    taskType: 'strategy_generation',
    modelProvider: 'google',
    modelName: 'gemini-4-argon',
    userPrompt: 'Safe prompt',
    modelResponse: 'Safe strategy',
    modelImprovement: true,
  });
  await learningService.recordIteration({
    parentInteractionId: ungroundedParent.id,
    ownerId,
    modificationRequest: 'Add market data',
    response: 'Grounded refinement',
    groundingActive: true,
  });
  const afterIter = await learningRepo.readStore();
  assert.equal(afterIter.iterations.length, 0);
});
