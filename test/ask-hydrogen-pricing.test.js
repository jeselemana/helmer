import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { AiPolicy, DEFAULT_MODEL_PRICING, resolveEffectiveModelPricing } from '../src/services/security/ai-policy.js';
import { getPricingForModel } from '../src/services/telemetry/pricing.js';
import { estimateCost } from '../src/services/learning/config.js';
import { wrapProvider, configureProviderPolicy } from '../src/services/security/provider-policy.js';
import { executionContext } from '../src/services/security/privacy-policy.js';

test('DEFAULT_MODEL_PRICING and resolveEffectiveModelPricing expose official gemini-4-hydrogen rates', () => {
  assert.deepEqual(DEFAULT_MODEL_PRICING['gemini-4-hydrogen'], {
    input: 1.50,
    output: 7.50,
    search: 0.035,
  });

  const resolved = resolveEffectiveModelPricing('gemini-4-hydrogen', {});
  assert.deepEqual(resolved, {
    input: 1.50,
    output: 7.50,
    search: 0.035,
    searchMicros: 35000,
  });
});

test('telemetry and learning pricing resolve gemini-4-hydrogen at $1.50/1M input and $7.50/1M output', () => {
  const telemetryPrice = getPricingForModel('gemini-4-hydrogen');
  assert.equal(telemetryPrice.model, 'gemini-4-hydrogen');
  assert.equal(telemetryPrice.inputPerMillion, 1.50);
  assert.equal(telemetryPrice.outputPerMillion, 7.50);

  const customPricing = [{ model: 'gemini-4-hydrogen', inputPerMillion: 1.50, outputPerMillion: 7.50 }];
  const cost = estimateCost('gemini-4-hydrogen', 1_000_000, 1_000_000, customPricing);
  assert.equal(cost.estimatedCost, 9.0);
});

test('AiPolicy.reserveProvider reserves and settles gemini-4-hydrogen with xhigh thinking and search', async () => {
  const policy = new AiPolicy({ env: { AI_USER_DAILY_USD: '5', AI_PLATFORM_DAILY_USD: '100' } });
  configureProviderPolicy(policy);

  const client = wrapProvider({
    models: {
      generateContent: async (params) => {
        assert.equal(params.model, 'gemini-4-hydrogen');
        assert.deepEqual(params.config.thinkingConfig, { thinkingLevel: 'XHIGH' });
        assert.equal(params.config.maxOutputTokens, 8192);
        return {
          text: 'Deep analysis.',
          candidates: [{ finishReason: 'STOP', groundingMetadata: { groundingChunks: [{ web: { uri: 'https://example.com', title: 'Ex' } }] } }],
          usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 500, thoughtsTokenCount: 2500 },
        };
      },
    },
  }, 'gemini');

  const observed = [];
  await executionContext.run({
    ownerId: 'user-hydrogen-1',
    assertAuthorized: async () => {},
    onProviderUsage: async (u) => { observed.push(u); },
  }, async () => {
    await client.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: 'Analyze market',
      config: {
        maxOutputTokens: 8192,
        thinkingConfig: { thinkingLevel: 'XHIGH' },
        tools: [{ googleSearch: {} }],
      },
    });
  });

  assert.equal(observed.length, 1);
  assert.equal(observed[0].model, 'gemini-4-hydrogen');
  assert.equal(observed[0].inputTokens, 1000);
  assert.equal(observed[0].outputTokens, 3000); // 500 candidates + 2500 thoughts
  assert.equal(observed[0].searchCalls, 1);

  const day = new Date().toISOString().slice(0, 10);
  const expectedMicros = Math.ceil(1000 * 1.50 + 3000 * 7.50 + 1 * 0.035 * 1_000_000);
  assert.equal(policy.inMemoryBudgets.get(`security:budget:${day}:user-hydrogen-1`), expectedMicros);
});

test('Ask UI exposes Extra (xhigh) thinking pill and New/Yeni chip without exposing model name', async () => {
  const [scriptJs, i18nJs] = await Promise.all([
    fs.readFile(path.join(process.cwd(), 'public/script.js'), 'utf8'),
    fs.readFile(path.join(process.cwd(), 'public/i18n.js'), 'utf8'),
  ]);

  assert.ok(scriptJs.includes('["low", "medium", "high", "xhigh"]'));
  assert.ok(scriptJs.includes('xhigh: "Extra"'));
  assert.ok(scriptJs.includes('Thinking · Extra'));
  assert.ok(scriptJs.includes('ask-model-chip'));
  assert.ok(i18nJs.includes('newBadge: "Yeni"'));
  assert.ok(i18nJs.includes('newBadge: "New"'));
  assert.ok(!scriptJs.includes('Gemini 4 Hydrogen'));
  assert.ok(!i18nJs.includes('Gemini 4 Hydrogen'));
});
