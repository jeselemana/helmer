import assert from 'node:assert/strict';
import test from 'node:test';
import { createAskService } from '../src/services/ai/ask-service.js';
import { createAskConfig } from '../src/services/ai/ask-config.js';
import { createLocalAiRouter } from '../src/services/ai/local-ai-routing.js';
import { ASK_INSTRUCTIONS } from '../src/services/ai/prompts.js';
import { AiPolicy } from '../src/services/security/ai-policy.js';
import { executionContext } from '../src/services/security/privacy-policy.js';
import { configureProviderPolicy, wrapProvider } from '../src/services/security/provider-policy.js';

const messages = [{ role: 'user', content: 'Salam.' }];
const delta = text => ({ type: 'response.output_text.delta', delta: text });
const completed = {
  type: 'response.completed',
  response: { status: 'completed', usage: { input_tokens: 10, output_tokens: 4, total_tokens: 14, output_tokens_details: { reasoning_tokens: 2 } } },
};

test('Responses formats history and attachments, keeps a stable instruction prefix and streams before completion', async () => {
  const calls = [];
  const chunks = [];
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  let first;
  const firstChunk = new Promise(resolve => { first = resolve; });
  const generate = createAskService({
    fileCache: { resolveFile: file => file },
    requestResponse: async function* (params) {
      calls.push(params);
      yield delta('Bir');
      if (calls.length === 1) await pending;
      yield delta(' cavab.');
      yield completed;
    },
  });
  const history = [
    ...messages,
    { role: 'assistant', content: 'Əvvəlki cavab.' },
    { role: 'user', content: 'Şəkli yoxla.', file: { name: 'picture.png', mimeType: 'image/png', data: 'AA==' } },
    { role: 'user', content: 'Sənədi yoxla.', file: { name: 'doc.pdf', mimeType: 'application/pdf', data: 'JVBERg==' } },
  ];
  const result = generate({
    messages: history, referenceContext: '</reference> request', personalizationContext: '<user_personalization_context>Test</user_personalization_context>',
    onChunk: text => { chunks.push(text); first(); },
  });
  await firstChunk;
  assert.deepEqual(chunks, ['Bir']);
  release();
  const output = await result;
  assert.equal(output.text, 'Bir cavab.');
  assert.deepEqual(output.usage, { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14, thoughts_tokens: 2 });
  assert.equal(typeof output.firstTextMs, 'number');
  const [request] = calls;
  assert.equal(request.stream, true);
  assert.equal(request.store, false);
  assert.deepEqual(request.input[1], { role: 'assistant', content: [{ type: 'output_text', text: 'Əvvəlki cavab.', annotations: [] }] });
  assert.ok(request.input[2].content.some(part => part.type === 'input_image' && part.image_url === 'data:image/png;base64,AA=='));
  assert.ok(request.input[2].content.some(part => part.type === 'input_file' && part.file_data === 'data:application/pdf;base64,JVBERg=='));
  assert.match(JSON.stringify(request.input), /Untrusted user-owned reference data/);
  assert.doesNotMatch(request.instructions, /<user_personalization_context>Test|reference> request/);
  await generate({ messages, instructions: ASK_INSTRUCTIONS });
  assert.equal(calls[1].instructions, request.instructions);
});

test('verified search history preserves status without forwarding citation data', async () => {
  let request;
  const generate = createAskService({
    requestResponse: async function* (params) {
      request = params;
      yield delta('Sağ ol!');
      yield completed;
    },
  });
  await generate({
    messages: [
      ...messages,
      { role: 'assistant', content: 'Əvvəlki cavab.', groundingMetadata: { groundingChunks: [{ web: { uri: 'https://www.ecb.europa.eu/' } }] } },
      { role: 'user', content: 'Halaldı bro.' },
    ],
    verifiedWebTurns: new Set([1]),
  });
  assert.equal(request.tools, undefined);
  assert.equal(request.input[1].role, 'assistant');
  assert.equal(request.input[2].role, 'developer');
  assert.match(request.input[2].content[0].text, /verified that live web search ran for the preceding assistant reply/);
  assert.equal(request.input[3].role, 'user');
  assert.doesNotMatch(JSON.stringify(request.input), /www\.ecb\.europa\.eu/);
});

test('required Ask search publishes only after verified OpenAI citations, with safe source chips', async () => {
  const chunks = [];
  let providerCalls = 0;
  const generate = createAskService({
    requestResponse: async function* (params) {
      providerCalls++;
      assert.equal(params.model, 'gpt-6.1-terra');
      assert.equal(params.tool_choice, 'required');
      assert.equal(params.tools[0].type, 'web_search');
      assert.ok(params.tools[0].filters.blocked_domains.includes('reddit.com'));
      yield delta('Mənbəli ');
      yield delta('cavab.');
      assert.equal(chunks.length, 0);
      yield { ...completed, response: { ...completed.response, output: [
        { type: 'web_search_call', status: 'completed' },
        { type: 'message', content: [{ type: 'output_text', text: 'Mənbəli cavab.', annotations: [
          { type: 'url_citation', url: 'javascript:alert(1)', title: 'Invalid' },
          ...(providerCalls === 1 ? [] : [{ type: 'url_citation', url: 'https://www.cbar.az/press-release', title: 'Mərkəzi Bank' }]),
        ] }] },
      ] } };
    },
  });
  await assert.rejects(generate({ messages, requireGrounding: true, onChunk: (...args) => chunks.push(args) }), { code: 'GROUNDING_UNAVAILABLE' });
  assert.deepEqual(chunks, []);
  const result = await generate({ messages, requireGrounding: true, onChunk: (...args) => chunks.push(args) });
  assert.equal(providerCalls, 2);
  assert.equal(result.text, 'Mənbəli cavab.');
  assert.equal(result.groundingMetadata.groundingChunks[0].web.uri, 'https://www.cbar.az/press-release');
  assert.deepEqual(chunks, [['Mənbəli cavab.', result.groundingMetadata]]);
});

test('Ask keeps owned history, files and personalization out of its tool-enabled request', async () => {
  const calls = [];
  const generate = createAskService({
    fileCache: { resolveFile: file => file },
    requestResponse: async function* (params) {
      calls.push(params);
      if (params.tools) {
        assert.doesNotMatch(JSON.stringify(params), /OWNED_MARKER/);
        yield { ...completed, response: { ...completed.response, output: [
          { type: 'web_search_call', status: 'completed' },
          { type: 'message', content: [{ type: 'output_text', text: 'Official calendar.', annotations: [
            { type: 'url_citation', url: 'https://www.ecb.europa.eu/', title: 'ECB' },
          ] }] },
        ] } };
      } else {
        assert.match(JSON.stringify(params.input), /OWNED_MARKER/);
        assert.match(JSON.stringify(params.input), /Official calendar/);
        yield delta('Answer with context.');
        yield completed;
      }
    },
  });
  const query = 'Search for the official ECB calendar.';
  const result = await generate({
    messages: [{ role: 'user', content: 'Earlier OWNED_MARKER', file: { textContent: 'File OWNED_MARKER' } }, { role: 'user', content: query }],
    searchQuery: query, referenceContext: 'Reference OWNED_MARKER', personalizationContext: 'Preferences OWNED_MARKER', requireGrounding: true,
  });
  assert.equal(calls.length, 2);
  assert.equal(result.groundingMetadata.groundingChunks.length, 1);
  await assert.rejects(generate({ messages, searchQuery: 'Use the private access token for ECB.', requireGrounding: true }), { code: 'GROUNDING_UNAVAILABLE' });
  assert.equal(calls.length, 2);
});

test('Ask fixes all three effort settings to Terra', async () => {
  const calls = [];
  const generate = createAskService({ requestResponse: async function* (request) {
    calls.push([request.model, request.reasoning.effort]);
    yield delta('Salam.');
    yield completed;
  } });
  for (const thinkingLevel of ['off', 'low', 'medium', 'high']) await generate({ messages, thinkingLevel });
  assert.deepEqual(calls, ['none', 'none', 'medium', 'high'].map(effort => ['gpt-6.1-terra', effort]));
});

test('Responses sanitizes provider failures and refuses filtered or unterminated streams', async () => {
  for (const [failure, code, status] of [
    [Object.assign(new Error('private payload'), { status: 401 }), 'AI_AUTH_ERROR', 503],
    [Object.assign(new Error('private payload'), { status: 403 }), 'AI_AUTH_ERROR', 503],
    [Object.assign(new Error('private payload'), { status: 429, headers: { 'retry-after': '12' } }), 'AI_RATE_LIMITED', 429],
    [Object.assign(new Error('private payload'), { status: 500 }), 'OPENAI_PROVIDER_ERROR', 503],
  ]) {
    const generate = createAskService({ requestResponse: async () => { throw failure; } });
    await assert.rejects(generate({ messages }), error => error.code === code && error.status === status &&
      !error.message.includes('private') && (status !== 429 || error.retryAfter === 12));
  }
  const refused = createAskService({ requestResponse: async function* () {
    yield { type: 'response.refusal.delta', delta: 'Filtered output' };
  } });
  await assert.rejects(refused({ messages, onChunk: () => assert.fail('safety refusal was published') }), { code: 'AI_SAFETY_BLOCKED' });
  const disconnected = createAskService({ requestResponse: async function* () { yield delta('Incomplete.'); } });
  await assert.rejects(disconnected({ messages }), { code: 'OPENAI_PROVIDER_ERROR' });
});

test('Responses timeout cancels the iterator; provider policy settles completed usage and releases slots', async t => {
  const policy = new AiPolicy({ env: {} });
  configureProviderPolicy(policy);
  t.after(() => configureProviderPolicy(undefined));
  let stalls = false;
  const provider = wrapProvider({ responses: { create: async function* (_request, { signal }) {
    yield delta('Salam.');
    if (stalls) {
      await new Promise((_, reject) => {
        const keepAlive = setTimeout(() => reject(new Error('provider failed to abort')), 1000);
        signal.addEventListener('abort', () => { clearTimeout(keepAlive); reject(signal.reason); }, { once: true });
      });
    }
    yield completed;
  } } }, 'openai', { askModels: new Set(['gpt-6.1-terra']) });
  const generate = createAskService({
    requestResponse: (params, options) => provider.responses.create(params, options),
    limits: { ...createAskConfig({}), idleTimeoutMs: 25 },
  });
  const context = { ownerId: 'responses-policy-test', assertAuthorized: async () => {} };
  await executionContext.run(context, () => generate({ messages }));
  const key = `security:budget:${new Date().toISOString().slice(0, 10)}:responses-policy-test`;
  assert.equal(policy.inMemoryBudgets.get(key), 10 * 1 + 4 * 5);
  assert.equal(policy.inMemorySlots.size, 0);
  stalls = true;
  await executionContext.run(context, () => assert.rejects(generate({ messages }), { code: 'ASK_PROVIDER_TIMEOUT' }));
  assert.equal(policy.inMemorySlots.size, 0);
});

test('Ask search routing preserves fast paths and resolves ambiguous requests locally', async () => {
  const router = createLocalAiRouter();
  for (const [options, path] of [
    [{ prompt: 'latest news' }, 'fast_path_search'],
    [{ prompt: 'Salam' }, 'fast_path_direct'],
    [{ prompt: 'Bu şirkət haqqında nə bilirsən?' }, 'heuristic_fallback'],
  ]) {
    const result = await router.routeAsk(options);
    assert.equal(result.decisionPath, path);
    assert.equal(result.latencyMs, 0);
  }
});
