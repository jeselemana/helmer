import test from 'node:test';
import assert from 'node:assert/strict';
import { checkGeminiConnection } from '../scripts/check-gemini.js';
import { resolveGeminiClientOptions } from '../src/services/ai/client.js';

test('Gemini health check uses supported generation, never Express-incompatible model metadata', async () => {
  const signal = new AbortController().signal;
  let calls = 0;
  const result = await checkGeminiConnection({ signal, client: { models: {
    get: () => { throw new Error('Metadata must not be used for Express health'); },
    generateContent: async params => {
      calls++;
      assert.equal(params.model, 'gemini-4-hydrogen');
      assert.equal(params.contents, 'Reply with exactly OK.');
      assert.equal(params.config.abortSignal, signal);
      assert.equal(params.config.maxOutputTokens, 64);
      assert.equal(params.config.tools, undefined);
      assert.deepEqual(params.config.thinkingConfig, { thinkingLevel: 'LOW' });
      return { text: 'OK', candidates: [{ finishReason: 'STOP' }] };
    },
  } } });
  assert.equal(result.ok, true); assert.equal(calls, 1);
  assert.equal(result.operation, 'generateContent');
  assert.equal('text' in result, false);
});

test('Express auth remains isolated from stale ADC paths, projects and regions', () => {
  const resolved = resolveGeminiClientOptions({ GEMINI_API_KEY: 'AQ.test-express-key',
    GOOGLE_APPLICATION_CREDENTIALS: '/missing/old-service-account.json', GOOGLE_CLOUD_PROJECT: 'other-project', GOOGLE_CLOUD_LOCATION: 'us-central1' }, () => false);
  assert.equal(resolved.options.vertexai, true);
  assert.equal(resolved.options.apiKey, 'AQ.test-express-key');
  assert.equal('project' in resolved.options, false);
  assert.equal('location' in resolved.options, false);
});

test('Gemini diagnostic errors omit SDK credentials, stack traces and account details', async () => {
  for (const status of [401, 403, 404, 429, 500]) {
    const result = await checkGeminiConnection({ client: { models: { generateContent: async () => {
      throw Object.assign(new Error('secret-key /private/credentials.json project-account'), { status });
    } } } });
    assert.equal(result.ok, false); assert.equal(result.status, status);
    assert.doesNotMatch(JSON.stringify(result), /secret-key|credentials|project-account|stack/);
  }
});

test('empty, blocked and truncated provider output cannot report healthy', async () => {
  for (const response of [{ text: '', candidates: [{ finishReason: 'STOP' }] }, { text: 'partial', candidates: [{ finishReason: 'MAX_TOKENS' }] }, { text: '', candidates: [] }]) {
    const result = await checkGeminiConnection({ client: { models: { generateContent: async () => response } } });
    assert.equal(result.ok, false); assert.equal(result.code, 'GEMINI_INVALID_RESPONSE');
  }
});

test('aborted probes cannot return a false success', async () => {
  const controller = new AbortController(); controller.abort();
  const result = await checkGeminiConnection({ signal: controller.signal, client: { models: { generateContent: async () => ({ text: 'OK', candidates: [{ finishReason: 'STOP' }] }) } } });
  assert.equal(result.ok, false); assert.equal(result.code, 'GEMINI_TIMEOUT');
});
