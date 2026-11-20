import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { randomUUID } from 'node:crypto';
import { createAskHandler } from '../src/http/ask-handler.js';
import { createResearchRouter } from '../src/http/research-router.js';
import { z } from 'zod';
import { createBuildOrchestrator } from '../src/services/ai/build-orchestrator.js';
import { createLocalAiRouter } from '../src/services/ai/local-ai-routing.js';
import { deepResearchEnabled } from '../src/services/ai/research-availability.js';
import { DistributedResearchService } from '../src/services/ai/distributed-research.js';
import { executionContext } from '../src/services/security/privacy-policy.js';
import { wrapProvider } from '../src/services/security/provider-policy.js';

const schema = z.object({
  title: z.string(),
  orchestration: z.object({}).optional(),
}).strict();

test('production Build selects local effort with a zero-call estimate and one Sol call for final output', async () => {
  const calls = [];
  const run = createBuildOrchestrator({ requestResponse: async function* (request) {
    calls.push(request);
    yield { type: 'response.output_text.delta', delta: '{"title":"Launch"}' };
    yield { type: 'response.completed', response: { status: 'completed', output: [], usage: {
      input_tokens: 200, output_tokens: 60, output_tokens_details: { reasoning_tokens: 10 },
    } } };
  } });
  const router = createLocalAiRouter();
  const args = { schema, name: 'example', instructions: 'Create the brief', ownerId: 'owned-fixture' };
  await run({ ...args, input: 'Create a launch brief.', estimateOnly: true });
  assert.equal(calls.length, 0);
  for (const [input, effort] of [
    ['Create a launch brief.', 'low'],
    ['Create a launch plan. '.repeat(12), 'medium'],
    ['Document the technical architecture and financial model.', 'high'],
  ]) {
    const chunks = [];
    const decision = await router.routeBuild({ prompt: input });
    const output = await run({ ...args, input, buildDecision: decision, onChunk: event => chunks.push(event) });
    assert.equal(output.orchestration.generatorModel, 'gpt-6.2-sol');
    assert.equal(calls.at(-1).reasoning.effort, effort);
    assert.equal(calls.at(-1).store, false);
    assert.equal(output.orchestration.stageMetrics[0].thoughts_tokens, 10);
    assert.deepEqual(chunks, [{ chunk: '{"title":"Launch"}' }, { finishReason: 'STOP' }]);
  }
  assert.equal(calls.length, 3);
});

test('Build isolates private strategy context from web search and requires completed tool evidence', async () => {
  for (const status of ['completed', 'failed']) {
    const chunks = [];
    const calls = [];
    const run = createBuildOrchestrator({ requestResponse: async function* (request) {
      calls.push(request);
      if (request.tools) {
        assert.equal(request.tools[0].type, 'web_search');
        assert.equal(request.tool_choice, 'required');
        assert.equal(request.text, undefined);
        assert.doesNotMatch(JSON.stringify(request), /OWNED_MARKER/);
        assert.equal(chunks.length, 0);
        yield { type: 'response.completed', response: { status: 'completed', output: [
          { type: 'web_search_call', status },
          { type: 'message', content: [{ type: 'output_text', text: 'ECB has a public calendar.', annotations: [
            { type: 'url_citation', url: 'https://www.ecb.europa.eu/', title: 'ECB' },
            { type: 'url_citation', url: 'https://reddit.com/report', title: 'Rejected' },
          ] }] },
        ] } };
        return;
      }
      assert.match(JSON.stringify(request.input), /OWNED_MARKER/);
      assert.equal(JSON.stringify(request.input).includes('ECB has a public calendar.'), status === 'completed');
      yield { type: 'response.output_text.delta', delta: '{"title":"Launch"}' };
      yield { type: 'response.completed', response: { status: 'completed', output: [] } };
    } });
    const result = await run({
      schema, name: 'example', instructions: 'Create a brief', input: 'OWNED_MARKER draft.',
      searchIntentInput: 'Search the web for current ECB facts.',
      ownerId: 'owned-fixture', onChunk: event => chunks.push(event),
    });
    assert.equal(calls.length, 2);
    assert.deepEqual(result.orchestration.sources, status === 'completed' ? [{ url: 'https://www.ecb.europa.eu/', title: 'ECB' }] : []);
    assert.equal(result.orchestration.searchGrounded, status === 'completed');
    assert.equal(Boolean(result.orchestration.groundingUnavailable), status === 'failed');
    assert.equal(chunks.at(-1).finishReason, 'STOP');
  }
});

test('Build streams the first delta immediately and batches small deltas behind fresh authorization', async () => {
  const text = JSON.stringify({ title: 'Short example '.repeat(24).trim() });
  const writes = [];
  let authorizationChecks = 0;
  const run = createBuildOrchestrator({ requestResponse: async function* () {
    yield { type: 'response.output_text.delta', delta: text.slice(0, 1) };
    assert.deepEqual(writes, ['{']);
    for (const delta of text.slice(1)) yield { type: 'response.output_text.delta', delta };
    yield { type: 'response.completed', response: { status: 'completed', output: [] } };
  } });
  const context = {
    ownerId: 'build-stream-fixture',
    assertAuthorized: async () => { authorizationChecks++; },
  };
  const result = await executionContext.run(context, () => run({
    schema, name: 'example', instructions: 'Create the brief', input: 'A brief example.',
    ownerId: context.ownerId,
    onChunk: ({ chunk }) => { if (chunk) writes.push(chunk); },
  }));
  assert.equal(writes.join(''), text);
  assert.equal(result.title, JSON.parse(text).title);
  assert.ok(writes.length <= 4);
  assert.ok(authorizationChecks >= writes.length + 1);
});

test('frozen research refuses admission and skips unfinished checkpoints without acquiring an execution lease', async t => {
  assert.equal(deepResearchEnabled({}), false);
  let dispatches = 0;
  const job = { id: 'legacy-job', ownerId: 'fixture-owner', status: 'pending', createdAt: new Date().toISOString() };
  const service = new DistributedResearchService({
    enabled: false,
    jobStore: { activePage: async () => ({ records: [{ value: job }] }) },
    geminiClient: { models: { generateContent: async () => { dispatches++; } } },
  });
  t.after(() => service.shutdown());
  await assert.rejects(service.createResearchJob({ ownerId: job.ownerId, prompt: 'Research' }), { code: 'DEEP_RESEARCH_UNAVAILABLE' });
  await service.resumeOrphanedJobs();
  assert.equal(service.activeJobs.size, 0);
  assert.equal(dispatches, 0);
  assert.equal(job.status, 'pending');
});

test('active OpenAI Build policy rejects an unauthorized tool and model before dispatch', async () => {
  const provider = wrapProvider({ responses: { create: async () => assert.fail('provider dispatched') } }, 'openai', { buildResponses: true });
  const request = { model: 'gpt-6.2-sol', reasoning: { effort: 'low' }, max_output_tokens: 16384, store: false };
  await assert.rejects(provider.responses.create({ ...request, tools: [{ type: 'function', name: 'unsupported' }] }), { code: 'EXECUTION_UNAVAILABLE' });
  await assert.rejects(provider.responses.create({ ...request, model: 'gemini-4-hydrogen' }), { code: 'EXECUTION_UNAVAILABLE' });
});

test('both Deep Research creation APIs reject authenticated requests while completed reports remain readable', async t => {
  const ownerId = randomUUID();
  const completedId = randomUUID();
  const researchService = {
    enabled: false,
    createResearchJob: async () => assert.fail('frozen research was dispatched'),
    getJob: async (id, owner) => owner === ownerId && id === completedId ? { id, status: 'completed', content: 'Archived report.' } : null,
  };
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.ownerId = ownerId;
    req.user = { id: ownerId, emailVerifiedAt: new Date().toISOString() };
    req.auth = { user: req.user };
    req.securityContext = { ownerId };
    next();
  });
  app.use('/api/ask/research', createResearchRouter({ researchService }));
  app.post('/api/ask', createAskHandler({
    researchService,
    generateAsk: async () => assert.fail('research was dispatched as ordinary Ask'),
  }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const [path, body] of [
    ['/api/ask/research', { prompt: 'Synthetic research request' }],
    ['/api/ask', { mode: 'research', messages: [{ role: 'user', content: 'Synthetic research request' }] }],
  ]) {
    const response = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() },
      body: JSON.stringify(body),
    });
    assert.equal(response.status, 503);
    assert.equal((await response.json()).code, 'DEEP_RESEARCH_UNAVAILABLE');
  }
  const archived = await fetch(`${base}/api/ask/research/jobs/${completedId}`);
  assert.equal(archived.status, 200);
  assert.equal((await archived.json()).content, 'Archived report.');
});
