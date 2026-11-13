import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAskContents } from '../src/services/ai/ask-service.js';
import { createAskConfig } from '../src/services/ai/ask-config.js';
import { MAX_GROUNDED_CHAT_RETENTION_MS, pruneExpiredGroundedResults, pruneExpiredGroundedStrategies } from '../src/services/ai/grounded-chat-retention.js';
import { getRelevantUserContext } from '../src/services/ai/personal-context.js';
import { LearningLoopService } from '../src/services/learning/learning-loop-service.js';
import { TelemetryService } from '../src/services/telemetry/telemetry-service.js';

test('1. Ask Conversational Continuity: synthesized grounded assistant text is retained for active Ask turns without forwarding raw grounding metadata', () => {
  const limits = createAskConfig({});
  const fileCache = { resolveFile: () => null };

  const messages = [
    { role: 'user', content: 'What is the latest rate for 2026?' },
    {
      role: 'assistant',
      content: 'The rate is 5.25% based on Google Search.',
      groundingMetadata: {
        groundingChunks: [{ web: { uri: 'https://example.com/rates', title: 'Example Rates' } }],
        webSearchQueries: ['2026 interest rate'],
      },
    },
    { role: 'user', content: 'Compare that with 2025.' },
    {
      role: 'assistant',
      content: 'In 2025 it was conceptual without search.',
    },
    { role: 'user', content: 'Final summary please.' },
  ];

  const contents = buildAskContents(messages, 'owner-test', fileCache, limits);

  // Synthesized assistant reply text is preserved so Ask doesn't re-answer prior turns,
  // while raw groundingMetadata/sources are never serialized into contents.
  const stringified = JSON.stringify(contents);
  assert.ok(stringified.includes('5.25% based on Google Search'), 'Synthesized assistant reply text must remain in Ask contents');
  assert.ok(!stringified.includes('https://example.com/rates'), 'Raw grounding URLs must not be forwarded into contents');
  assert.ok(!stringified.includes('groundingChunks'), 'Raw groundingMetadata must not be forwarded into contents');

  // The ungrounded assistant response MUST remain in contents
  assert.ok(stringified.includes('In 2025 it was conceptual without search'), 'Ungrounded assistant response must be retained in model request');

  // User prompts must all be retained
  assert.ok(stringified.includes('What is the latest rate for 2026?'));
  assert.ok(stringified.includes('Compare that with 2025.'));
  assert.ok(stringified.includes('Final summary please.'));
});

test('2. Chat History Retention: 2-year maximum retention prunes entire expired grounded turns while keeping fresh results', () => {
  const now = Date.now();
  const freshDate = new Date(now - 30 * 86400000).toISOString(); // 30 days old
  const expiredDate = new Date(now - (MAX_GROUNDED_CHAT_RETENTION_MS + 86400000)).toISOString(); // 2 years + 1 day old

  const chat = {
    id: 'chat-retention-test',
    ownerId: 'usr-retention-1',
    createdAt: freshDate,
    messages: [
      {
        role: 'user',
        content: 'Historical search',
        createdAt: expiredDate,
      },
      {
        role: 'assistant',
        content: 'Old search results',
        createdAt: expiredDate,
        groundingMetadata: {
          groundingChunks: [{ web: { uri: 'https://archive.org/data', title: 'Archive' } }],
        },
        sources: [{ url: 'https://archive.org/data', title: 'Archive' }],
      },
      {
        role: 'user',
        content: 'Recent search',
        createdAt: freshDate,
      },
      {
        role: 'assistant',
        content: 'Recent search results',
        createdAt: freshDate,
        groundingMetadata: {
          groundingChunks: [{ web: { uri: 'https://recent.com/news', title: 'Recent' } }],
        },
        sources: [{ url: 'https://recent.com/news', title: 'Recent' }],
      },
    ],
  };

  const modified = pruneExpiredGroundedResults(chat, now);
  assert.equal(modified, 1);
  assert.equal(pruneExpiredGroundedResults(chat, now), 0);
  assert.deepEqual(chat.messages.map(message => message.content),
    ['Historical search', 'Recent search', 'Recent search results']);
  assert.equal(chat.messages[2].groundingMetadata.groundingChunks[0].web.title, 'Recent');
  assert.ok(chat.messages[2].sources);
});

test('3. Learning Log Protection: Grounded interactions are strictly redacted and excluded from training candidates', async () => {
  const mockRepo = {
    data: { interactions: [], signals: [], iterations: [], candidates: [] },
    async readStore() { return this.data; },
    async update(mutator) { return mutator(this.data); },
  };

  const service = new LearningLoopService(mockRepo);

  const interaction = await service.recordInteraction({
    ownerId: 'usr-learn-1',
    mode: 'ask',
    taskType: 'ask_general',
    modelProvider: 'google',
    modelName: 'gemini-3.8-flash',
    userPrompt: 'Tell me the current gold price in Baku',
    modelResponse: 'The live price is 150 AZN per gram based on Google Search.',
    groundingActive: true,
    modelImprovement: true,
  });

  assert.equal(interaction.userPrompt, '[Zəruri əməliyyat qeydi - Məzmun ötürülmür]');
  assert.equal(interaction.modelResponse, '[Məzmun gizlədilib - Töhfə deaktivdir]');
  assert.equal(interaction.relevantContext, null);
  assert.equal(interaction.onlyNecessaryData, true);
  assert.equal(interaction.modelImprovement, false);

  // Recording strong positive signal must not admit it as a candidate
  await service.recordSignal(interaction.id, 'usr-learn-1', { accepted: true, copied: true, explicitRating: 'positive' });
  const visible = await service.readVisibleStore();
  assert.equal(visible.candidates.length, 0, 'Grounded interaction must never become a training candidate');
});

test('4. Telemetry Protection: Grounded queries are strictly redacted and only necessary metadata is recorded', async () => {
  const mockRepo = {
    events: [],
    async listEvents() { return { items: this.events, total: this.events.length }; },
  };

  const service = new TelemetryService(mockRepo);
  service.persistEvent = async (event) => { mockRepo.events.push(event); return event; };

  await service.trackAskQuery({
    ownerId: 'usr-telem-1',
    model: 'gemini-3.8-flash',
    groundingActive: true,
    querySnippet: 'Confidential live search query',
    status: 'success',
  });

  assert.equal(mockRepo.events.length, 1);
  const evt = mockRepo.events[0];
  assert.equal(evt.groundingActive, true);
  assert.equal(evt.onlyNecessaryData, true);
  assert.equal(evt.modelImprovement, false);
  assert.equal(evt.summary, '[Zəruri məlumat] Model inkişafına töhfə deaktivdir - Məzmun ötürülmür');
  assert.equal(evt.category, 'Zəruri Əməliyyat');
  assert.equal(evt.metadata.onlyNecessaryData, true);
  assert.ok(!JSON.stringify(evt).includes('Confidential live search query'), 'Query snippet must never leak into telemetry');
});

test('5. Build Telemetry & Cross-Session Isolation: Grounded Build strategies are redacted in telemetry, excluded from cross-session Ask context, and pruned after 2 years', async () => {
  const mockRepo = {
    events: [],
    async listEvents() { return { items: this.events, total: this.events.length }; },
  };
  const service = new TelemetryService(mockRepo);
  service.persistEvent = async (event) => { mockRepo.events.push(event); return event; };

  await service.trackBuildStrategy({
    ownerId: 'usr-telem-build',
    brief: 'Confidential grounded fintech brief in Baku',
    model: 'gemini-4-argon',
    groundingActive: true,
    strategy: {
      title: 'Grounded Strategy Secret',
      orchestration: { searchGrounded: true },
    },
    status: 'success',
  });

  assert.equal(mockRepo.events.length, 1);
  const buildEvt = mockRepo.events[0];
  assert.equal(buildEvt.groundingActive, true);
  assert.equal(buildEvt.onlyNecessaryData, true);
  assert.equal(buildEvt.modelImprovement, false);
  assert.equal(buildEvt.category, 'Zəruri Əməliyyat');
  assert.ok(!JSON.stringify(buildEvt).includes('Confidential grounded fintech brief'), 'Grounded Build brief must never leak into telemetry');

  // Verify grounded strategies are excluded from getRelevantUserContext
  const now = Date.now();
  const freshDate = new Date(now - 10 * 86400000).toISOString();
  const expiredDate = new Date(now - (MAX_GROUNDED_CHAT_RETENTION_MS + 86400000)).toISOString();

  const strategies = [
    {
      id: 'strat-grounded-1',
      ownerId: 'usr-ctx-1',
      title: 'Fintech Grounded Plan',
      brief: 'Fintech payment gateway expansion',
      summary: 'Grounded web secret summary',
      createdAt: expiredDate,
      updatedAt: freshDate,
      strategy: { orchestration: { searchGrounded: true, sources: [{ title: 'reuters.com', url: 'https://reuters.com/fintech' }] } },
    },
    {
      id: 'strat-ungrounded-1',
      ownerId: 'usr-ctx-1',
      title: 'Fintech Internal Plan',
      brief: 'Fintech onboarding optimization',
      summary: 'Ungrounded internal summary',
      updatedAt: freshDate,
      strategy: { orchestration: { searchGrounded: false, sources: [] } },
    },
  ];

  const context = await getRelevantUserContext({
    ownerId: 'usr-ctx-1',
    userMessage: 'Fintech planımız nədir?',
    chatRepository: { readAll: async () => [] },
    strategyRepository: { readAll: async () => strategies, getById: async () => true },
  });

  assert.match(context, /Fintech Internal Plan/);
  assert.doesNotMatch(context, /Fintech Grounded Plan|Grounded web secret summary/);

  // Verify 2-year retention pruning removes expired grounded strategy while keeping ungrounded strategy
  const removed = pruneExpiredGroundedStrategies(strategies, now);
  assert.equal(removed, 1);
  assert.equal(strategies.length, 1);
  assert.equal(strategies[0].id, 'strat-ungrounded-1');
});
