import test from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzeBuildTaskSignals,
  createBuildOrchestrator,
  locateFactByteSpans,
} from '../src/services/ai/build-orchestrator.js';
import {
  extractCleanDomain,
  isGoogleRelayHostOrUrl,
  isLowQualityDomain,
  enrichSourcesFromText,
} from '../src/services/ai/research-service.js';
import { buildConfig } from '../src/services/ai/build-config.js';
import { StrategySchema } from '../src/domain/strategy.js';
import { strategyFixture } from './helpers/build-fixtures.js';

function makeChunkCollector() {
  const events = [];
  return {
    events,
    onChunk: async chunk => {
      events.push(chunk);
    },
  };
}

function makeOrchestrator({ onCall, onStream, config = {}, onStage = () => {} }) {
  const gemini = location => ({
    models: {
      generateContent: async params => onCall({ params, location }),
      generateContentStream: async params => {
        if (onStream) return onStream({ params, location });
        const result = await onCall({ params, location });
        return (async function* () {
          yield result;
        })();
      },
    },
  });
  return createBuildOrchestrator({
    gemini,
    config: {
      ...buildConfig,
      retryBaseDelayMs: 5,
      retryMaxDelayMs: 20,
      ...config,
    },
    logger: () => {},
    onStage,
  });
}

test('byte-span grounding binds strictly to concrete facts[i], handles UTF-8/escapes/partIndex, and rejects bleed/partials/relays/trailing-dot', async t => {
  const origFetch = globalThis.fetch;
  let networkFetchCalls = 0;
  globalThis.fetch = async () => {
    networkFetchCalls++;
    throw new Error('Unexpected network fetch');
  };
  t.after(() => { globalThis.fetch = origFetch; });

  // 1a. Multi-byte Azerbaijan text, JSON escapes, UTF-8 BOM in locateFactByteSpans, explicit partIndex, and structural JSON prefix succeed
  const azFact0 = 'Azərbaycan "SaaS" bazarında\norta qiymət 45₼ təşkil edir';
  const azFact1 = 'Korporativ seqmentdə illik artım 18% səviyyəsindədir';
  const scoutPayload = {
    needs_search: true,
    target_model: 'gemini-4-hydrogen',
    thinking_level: 'medium',
    focus_area: 'Qiymət və artım',
    facts: [azFact0, azFact1],
  };
  const scoutJsonWithBom = `\uFEFF${JSON.stringify(scoutPayload)}`;
  const bomSpans = locateFactByteSpans(scoutJsonWithBom);
  assert.equal(bomSpans.length, 2);
  assert.equal(bomSpans[0].decoded, azFact0);
  assert.equal(bomSpans[1].decoded, azFact1);

  const scoutJson = JSON.stringify(scoutPayload);
  const spans = locateFactByteSpans(scoutJson);
  assert.equal(spans.length, 2);
  assert.equal(spans[0].decoded, azFact0);
  assert.equal(spans[1].decoded, azFact1);

  const bytes = Buffer.from(scoutJson, 'utf8');
  // Legitimate provider span starting from JSON prefix 0 up to spans[0].quoteEndByte on explicit partIndex 1
  const seg0Bytes = bytes.subarray(0, spans[0].quoteEndByte);
  const seg1Bytes = bytes.subarray(spans[1].effectiveStartByte, spans[1].effectiveEndByte);

  const runValid = makeOrchestrator({
    onCall: async ({ params }) => {
      if (params.config.responseSchema?.properties?.needs_search) {
        return {
          text: scoutJson,
          candidates: [{
            finishReason: 'STOP',
            content: {
              parts: [
                { thought: true, text: JSON.stringify({ facts: [azFact0, azFact1] }) },
                { text: scoutJson },
              ],
            },
          }],
          groundingMetadata: {
            webSearchQueries: ['azerbaijan saas pricing'],
            groundingChunks: [
              { web: { uri: 'https://statista.com/outlook/az-saas', title: 'Statista Report' } },
            ],
            groundingSupports: [
              {
                segment: { partIndex: 1, startIndex: 0, endIndex: spans[0].quoteEndByte, text: seg0Bytes.toString('utf8') },
                groundingChunkIndices: [0],
              },
              {
                segment: { partIndex: 1, startIndex: spans[1].effectiveStartByte, endIndex: spans[1].effectiveEndByte, text: seg1Bytes.toString('utf8') },
                groundingChunkIndices: [0],
              },
            ],
          },
        };
      }
      return { text: JSON.stringify(strategyFixture()), candidates: [{ finishReason: 'STOP' }] };
    },
  });

  const validResult = await runValid({
    ownerId: 'sec2-valid',
    schema: StrategySchema,
    name: 'helmer_strategy',
    instructions: 'Follow rules',
    input: 'Check current prices for Azerbaijan SaaS',
  });
  assert.equal(validResult.orchestration.searchGrounded, true);
  assert.equal(validResult.orchestration.evidence.length, 2);
  assert.equal(validResult.orchestration.evidence[0].text, 'Azərbaycan "SaaS" bazarında orta qiymət 45₼ təşkil edir');
  assert.equal(validResult.orchestration.evidence[1].text, azFact1);
  assert.equal(validResult.orchestration.sources[0].url, 'https://statista.com/outlook/az-saas');

  // 1b. focus_area cannot satisfy facts[0], cross-fact bleed cannot satisfy facts[0] or facts[1], partial fragment missing trailing number/negation cannot satisfy claim
  const focusCloneFact = 'Enterprise churn is 4.2% not 14.2%';
  const secondFact = 'SMB churn is 9.1%';
  const bleedPayload = JSON.stringify({
    focus_area: focusCloneFact,
    facts: [focusCloneFact, secondFact],
    needs_search: true,
    target_model: 'gemini-4-hydrogen',
    thinking_level: 'medium',
  });
  const bleedBytes = Buffer.from(bleedPayload, 'utf8');
  const focusStart = bleedBytes.indexOf(`"${focusCloneFact}"`) + 1;
  const focusEnd = focusStart + Buffer.byteLength(focusCloneFact, 'utf8');
  const bleedSpans = locateFactByteSpans(bleedPayload);
  // Span covering end of focusCloneFact without trailing " not 14.2%" (partial fragment)
  const partialWithoutNegation = 'Enterprise churn is 4.2%';
  const partialEnd = bleedSpans[0].effectiveStartByte + Buffer.byteLength(partialWithoutNegation, 'utf8');
  // Cross-fact span running from facts[0] into facts[1]
  const crossStart = bleedSpans[0].effectiveStartByte;
  const crossEnd = bleedSpans[1].effectiveEndByte;

  const maliciousSupports = [
    // From focus_area only
    { segment: { startIndex: focusStart, endIndex: focusEnd, text: focusCloneFact }, groundingChunkIndices: [0] },
    // Partial fact missing trailing number/negation
    { segment: { startIndex: bleedSpans[0].effectiveStartByte, endIndex: partialEnd, text: partialWithoutNegation }, groundingChunkIndices: [0] },
    // Cross-fact span bleeding across facts[0] and facts[1]
    { segment: { startIndex: crossStart, endIndex: crossEnd, text: bleedBytes.subarray(crossStart, crossEnd).toString('utf8') }, groundingChunkIndices: [0] },
    // Unchecked non-byte partial / percentage overlap
    { segment: { text: 'Enterprise churn is 4.2%' }, groundingChunkIndices: [0] },
  ];

  const runRejectedSpans = makeOrchestrator({
    onCall: async ({ params }) => {
      if (params.config.responseSchema?.properties?.needs_search) {
        return {
          text: bleedPayload,
          candidates: [{ finishReason: 'STOP' }],
          groundingMetadata: {
            webSearchQueries: ['churn'],
            groundingChunks: [{ web: { uri: 'https://hbr.org/churn', title: 'HBR' } }],
            groundingSupports: maliciousSupports,
          },
        };
      }
      return { text: JSON.stringify(strategyFixture()), candidates: [{ finishReason: 'STOP' }] };
    },
  });

  const rejectedSpanResult = await runRejectedSpans({
    ownerId: 'sec2-bleed',
    schema: StrategySchema,
    name: 'helmer_strategy',
    instructions: 'Follow rules',
    input: 'Check current prices and churn benchmarks',
  });
  assert.equal(rejectedSpanResult.orchestration.searchGrounded, false);
  assert.equal(rejectedSpanResult.orchestration.groundingUnavailable, true);
  assert.deepEqual(rejectedSpanResult.orchestration.sources, []);
  assert.equal(rejectedSpanResult.orchestration.evidence, undefined);

  // 1c. Trailing-dot low-quality domain & Google relay hosts fail closed even with high-signal titles
  assert.equal(isLowQualityDomain('reddit.com.'), true);
  assert.equal(isLowQualityDomain('https://www.reddit.com./r/saas'), true);
  assert.equal(isGoogleRelayHostOrUrl('https://www.google.az/url?q=https://statista.com/x'), true);
  assert.equal(isGoogleRelayHostOrUrl('https://vertexaisearch.cloud.google.com/grounding-api-redirect/token123'), true);
  assert.equal(extractCleanDomain('https://www.google.co.uk/url?q=https://reuters.com'), '');

  const enriched = enrichSourcesFromText([
    { title: 'Statista', url: 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/xyz' },
    { title: 'Reuters', url: 'https://www.google.az/url?q=https://reuters.com' },
    { title: 'Reddit Thread', url: 'https://reddit.com./r/business' },
  ]);
  assert.deepEqual(enriched, []);

  const simpleFact = 'SaaS CAC payback is 14 months';
  const relayScoutJson = JSON.stringify({
    needs_search: true,
    target_model: 'gemini-4-hydrogen',
    thinking_level: 'low',
    facts: [simpleFact],
    focus_area: 'CAC',
  });
  const relaySegBytes = Buffer.from(relayScoutJson, 'utf8');
  const runRelayRejected = makeOrchestrator({
    onCall: async ({ params }) => {
      if (params.config.responseSchema?.properties?.needs_search) {
        return {
          text: relayScoutJson,
          candidates: [{ finishReason: 'STOP' }],
          groundingMetadata: {
            webSearchQueries: ['saas cac'],
            groundingChunks: [
              { web: { uri: 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc', title: 'Statista' } },
              { web: { uri: 'https://www.google.com/url?q=https://mckinsey.com/report', title: 'McKinsey' } },
              { web: { uri: 'https://reddit.com./r/startups/comments/1', title: 'Reddit' } },
            ],
            groundingSupports: [{
              segment: { startIndex: 0, endIndex: relaySegBytes.length, text: relayScoutJson },
              groundingChunkIndices: [0, 1, 2],
            }],
          },
        };
      }
      return { text: JSON.stringify(strategyFixture()), candidates: [{ finishReason: 'STOP' }] };
    },
  });

  const relayRejectedResult = await runRelayRejected({
    ownerId: 'sec2-relay',
    schema: StrategySchema,
    name: 'helmer_strategy',
    instructions: 'Follow rules',
    input: 'Check current prices and SaaS CAC benchmarks',
  });
  assert.equal(relayRejectedResult.orchestration.searchGrounded, false);
  assert.equal(relayRejectedResult.orchestration.groundingUnavailable, true);
  assert.deepEqual(relayRejectedResult.orchestration.sources, []);
  assert.equal(relayRejectedResult.orchestration.evidence, undefined);
  assert.equal(networkFetchCalls, 0, 'Must never fetch or follow redirects for relay URL verification');

  // 1d. Official HTTPS Vertex AI grounding redirects with structured web.domain succeed without network fetches,
  //     while malformed, low-quality, or private domains in web.domain still fail closed.
  const relaySpan0 = locateFactByteSpans(relayScoutJson)[0];
  const relayFactSegment = {
    startIndex: relaySpan0.effectiveStartByte,
    endIndex: relaySpan0.effectiveEndByte,
    text: Buffer.from(relayScoutJson, 'utf8').subarray(relaySpan0.effectiveStartByte, relaySpan0.effectiveEndByte).toString('utf8'),
  };
  const vertexTrustedChunks = makeOrchestrator({
    onCall: async ({ params }) => {
      if (params.config.responseSchema?.properties?.needs_search) {
        return {
          text: relayScoutJson,
          candidates: [{ finishReason: 'STOP' }],
          groundingMetadata: {
            webSearchQueries: ['saas cac'],
            groundingChunks: [
              { web: { uri: 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/LOW', title: 'reddit.com', domain: 'reddit.com.' } },
              { web: { uri: 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/LOCAL', title: 'localhost', domain: 'localhost' } },
              { web: { uri: 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/OK', title: 'reuters.com', domain: 'reuters.com' } },
            ],
            groundingSupports: [{
              segment: relayFactSegment,
              groundingChunkIndices: [0, 1, 2],
            }],
          },
        };
      }
      return { text: JSON.stringify(strategyFixture()), candidates: [{ finishReason: 'STOP' }] };
    },
  });
  const vertexResult = await vertexTrustedChunks({
    ownerId: 'sec2-vertex-domain',
    schema: StrategySchema,
    name: 'helmer_strategy',
    instructions: 'Follow rules',
    input: 'Check current prices and SaaS CAC benchmarks',
  });
  assert.deepEqual(
    vertexResult.orchestration.sources.map(s => ({ title: s.title, url: s.url })),
    [{ title: 'reuters.com', url: 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/OK' }],
  );
  assert.equal(networkFetchCalls, 0, 'Must never fetch or follow redirects for Vertex grounding redirect URLs');

  // 1e. Cumulative Vertex prefix segments (startIndex: 0 .. facts[1].effectiveEndByte) still bind facts[1]
  //     even when facts[0]'s chunk is filtered out.
  const twoFactPayload = JSON.stringify({
    needs_search: true,
    target_model: 'gemini-4-hydrogen',
    thinking_level: 'high',
    facts: [azFact0, azFact1],
    focus_area: 'Qiymət və artım',
  });
  const twoFactSpans = locateFactByteSpans(twoFactPayload);
  const twoFactBytes = Buffer.from(twoFactPayload, 'utf8');
  const cumulativeSecond = makeOrchestrator({
    onCall: async ({ params }) => {
      if (params.config.responseSchema?.properties?.needs_search) {
        return {
          text: twoFactPayload,
          candidates: [{ finishReason: 'STOP' }],
          groundingMetadata: {
            webSearchQueries: ['azerbaijan saas'],
            groundingChunks: [
              { web: { uri: 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/BAD', title: 'reddit.com', domain: 'reddit.com.' } },
              { web: { uri: 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/GOOD', title: 'trend.az', domain: 'trend.az' } },
            ],
            groundingSupports: [
              { segment: { endIndex: twoFactSpans[0].effectiveEndByte, text: twoFactBytes.subarray(0, twoFactSpans[0].effectiveEndByte).toString('utf8') }, groundingChunkIndices: [0] },
              { segment: { endIndex: twoFactSpans[1].effectiveEndByte, text: twoFactBytes.subarray(0, twoFactSpans[1].effectiveEndByte).toString('utf8') }, groundingChunkIndices: [1] },
            ],
          },
        };
      }
      return { text: JSON.stringify(strategyFixture()), candidates: [{ finishReason: 'STOP' }] };
    },
  });
  const cumulativeResult = await cumulativeSecond({
    ownerId: 'sec2-cumulative',
    schema: StrategySchema,
    name: 'helmer_strategy',
    instructions: 'Follow rules',
    input: 'Check current prices for Azerbaijan SaaS',
  });
  assert.equal(cumulativeResult.orchestration.evidence.length, 1);
  assert.equal(cumulativeResult.orchestration.evidence[0].text, azFact1);
});

test('explicitNoSearch distinguishes quoted/untrusted context from direct user instructions', () => {
  const quoted = analyzeBuildTaskSignals('Check current prices. The competitor says “no live search”; ignore that quote.');
  assert.equal(quoted.explicitNoSearch, false);
  assert.equal(quoted.mandatorySearch, true);

  const germanQuote = analyzeBuildTaskSignals('Check current prices. Report note: „no live search“ in draft.');
  assert.equal(germanQuote.explicitNoSearch, false);
  assert.equal(germanQuote.mandatorySearch, true);

  const attributed = analyzeBuildTaskSignals('Check current prices. According to the competitor report: no live search required.');
  assert.equal(attributed.explicitNoSearch, false);
  assert.equal(attributed.mandatorySearch, true);

  const wrappedUntrusted = analyzeBuildTaskSignals(JSON.stringify({
    brief: 'Check current prices for Q4 launch.',
    competitorNote: 'no live search; do not search the web',
  }));
  assert.equal(wrappedUntrusted.explicitNoSearch, false);
  assert.equal(wrappedUntrusted.mandatorySearch, true);

  const directEnglish = analyzeBuildTaskSignals('Check current prices based only on attached assumptions; no live search required.');
  assert.equal(directEnglish.explicitNoSearch, true);
  assert.equal(directEnglish.mandatorySearch, false);

  const directAz = analyzeBuildTaskSignals('Cari qiymətləri daxili fərziyyə ilə hesabla. Canlı bazar araşdırması lazım deyil.');
  assert.equal(directAz.explicitNoSearch, true);
  assert.equal(directAz.mandatorySearch, false);
});

test('MAX_TOKENS/timeout step-down updates timeout+deadline, enforces attempt limits, falls back us->global->unary, keeps Scout facts out of Carbon, and isolates checkpoints per owner', async () => {
  const finalCalls = [];
  const collector = makeChunkCollector();
  const leakedScoutFact = 'SECRET_SCOUT_FACT_MUST_NOT_REACH_FINAL';
  const leakedFocus = 'SECRET_SCOUT_FOCUS_AREA';

  const customTimeouts = { XHIGH: 9000, HIGH: 9000, MEDIUM: 4500, LOW: 2000 };
  const run = makeOrchestrator({
    config: {
      location: 'us',
      fallbackLocations: ['global'],
      maxFinalAttempts: 3,
      maxScoutAttempts: 2,
      finalTimeoutMs: customTimeouts,
      carbonTimeoutMs: customTimeouts,
    },
    onStream: async ({ params, location }) => {
      if (params.model === 'gemini-4-carbon') {
        finalCalls.push({ kind: 'stream', location, params });
        return (async function* () {
          yield { text: '{"title":"Partial', candidates: [{}] };
          const maxTokErr = new Error('Truncated at MAX_TOKENS');
          maxTokErr.finishReason = 'MAX_TOKENS';
          yield { text: '', candidates: [{ finishReason: 'MAX_TOKENS' }] };
        })();
      }
      throw new Error('Unexpected stream for Scout');
    },
    onCall: async ({ params, location }) => {
      if (params.config.responseSchema?.properties?.needs_search) {
        return {
          text: JSON.stringify({
            needs_search: false,
            target_model: 'gemini-4-carbon',
            thinking_level: 'high',
            facts: [leakedScoutFact],
            focus_area: leakedFocus,
          }),
          candidates: [{ finishReason: 'STOP' }],
        };
      }
      finalCalls.push({ kind: 'unary', location, params });
      if (finalCalls.length === 2) {
        // Attempt 1 (MEDIUM on global) fails with timeout
        const timeoutErr = new Error('Upstream request timeout');
        timeoutErr.code = 'ETIMEDOUT';
        throw timeoutErr;
      }
      // Attempt 2 (LOW on us) succeeds
      return { text: JSON.stringify({ ...strategyFixture(), title: 'Recovered Title' }), candidates: [{ finishReason: 'STOP' }] };
    },
  });

  const out = await run({
    ownerId: 'tenant-sec2',
    schema: StrategySchema,
    name: 'helmer_strategy',
    instructions: 'Build resilient architecture plan.',
    input: 'Design resilient rollout without live search.',
    onChunk: collector.onChunk,
  });

  assert.equal(out.title, 'Recovered Title');
  assert.equal(finalCalls.length, 3);
  // Attempt 0: HIGH stream on 'us'
  assert.equal(finalCalls[0].kind, 'stream');
  assert.equal(finalCalls[0].location, 'us');
  assert.equal(finalCalls[0].params.config.thinkingConfig.thinkingLevel, 'HIGH');
  assert.equal(finalCalls[0].params.config.httpOptions.timeout, customTimeouts.HIGH);
  // Attempt 1: stepped down to MEDIUM unary on 'global' with matching timeout & resetStream emitted
  assert.equal(finalCalls[1].kind, 'unary');
  assert.equal(finalCalls[1].location, 'global');
  assert.equal(finalCalls[1].params.config.thinkingConfig.thinkingLevel, 'MEDIUM');
  assert.equal(finalCalls[1].params.config.httpOptions.timeout, customTimeouts.MEDIUM);
  assert.ok(collector.events.some(e => e.resetStream === true));
  // Attempt 2: degrades to Hydrogen XHIGH unary on 'us'
  assert.equal(finalCalls[2].kind, 'unary');
  assert.equal(finalCalls[2].location, 'us');
  assert.equal(finalCalls[2].params.model, 'gemini-4-hydrogen');
  assert.equal(finalCalls[2].params.config.thinkingConfig.thinkingLevel, 'XHIGH');
  assert.equal(finalCalls[2].params.config.httpOptions.timeout, customTimeouts.HIGH);

  // Scout facts and focus_area must never appear in any Carbon/final prompt
  for (const call of finalCalls) {
    const serialized = JSON.stringify(call.params);
    assert.ok(!serialized.includes(leakedScoutFact), 'Scout facts leaked into Carbon prompt');
    assert.ok(!serialized.includes(leakedFocus), 'Scout focus_area leaked into Carbon prompt');
  }

  // Stage attempt limit config is actually enforced & owner checkpoint stays tenant-isolated
  let checkpointScoutCalls = 0;
  let forceFinalDown = true;
  const runLimits = makeOrchestrator({
    config: { maxScoutAttempts: 2, maxFinalAttempts: 1 },
    onCall: async ({ params }) => {
      if (params.config.responseSchema?.properties?.needs_search) {
        checkpointScoutCalls++;
        return {
          text: JSON.stringify({ needs_search: false, target_model: 'gemini-4-hydrogen', thinking_level: 'low', facts: ['Internal'], focus_area: 'Internal' }),
          candidates: [{ finishReason: 'STOP' }],
        };
      }
      if (forceFinalDown) {
        throw Object.assign(new Error('transient final failure'), { status: 503 });
      }
      return { text: JSON.stringify(strategyFixture()), candidates: [{ finishReason: 'STOP' }] };
    },
  });
  await assert.rejects(
    () => runLimits({ ownerId: 'owner-A', schema: StrategySchema, name: 's', instructions: 'i', input: 'SHARED_CHECKPOINT_INPUT' }),
    err => err.status === 503,
  );
  assert.equal(checkpointScoutCalls, 1);

  // Retry by same owner reuses scout checkpoint (no extra Flash call)
  forceFinalDown = false;
  await runLimits({ ownerId: 'owner-A', schema: StrategySchema, name: 's', instructions: 'i', input: 'SHARED_CHECKPOINT_INPUT' });
  assert.equal(checkpointScoutCalls, 1, 'Same owner should reuse scout checkpoint');

  // Seed fresh checkpoint for owner-A again, then verify owner-B cannot reuse it
  forceFinalDown = true;
  await assert.rejects(
    () => runLimits({ ownerId: 'owner-A', schema: StrategySchema, name: 's', instructions: 'i', input: 'SHARED_CHECKPOINT_INPUT_2' }),
    err => err.status === 503,
  );
  assert.equal(checkpointScoutCalls, 2);
  forceFinalDown = false;
  await runLimits({ ownerId: 'owner-B', schema: StrategySchema, name: 's', instructions: 'i', input: 'SHARED_CHECKPOINT_INPUT_2' });
  assert.equal(checkpointScoutCalls, 3, 'Different owner must not reuse owner-A scout checkpoint');

  // Verify maxScoutAttempts hard limit caps scout retries at 2 before fallback
  let scoutTries = 0;
  const runHardStop = makeOrchestrator({
    config: { maxScoutAttempts: 2, retryAttempts: undefined },
    onCall: async ({ params }) => {
      if (params.config.responseSchema?.properties?.needs_search) scoutTries++;
      throw Object.assign(new Error('503'), { status: 503 });
    },
  });
  await assert.rejects(
    () => runHardStop({ ownerId: 'owner-hard', schema: StrategySchema, name: 's', instructions: 'i', input: 'Plan' }),
    err => err.status === 503,
  );
  assert.equal(scoutTries, 2);
});

test('retry wait cleans up timers and abort listeners on completion, abort, and wait-setup failure', async () => {
  // 1. Completion removes wait abort listener cleanly
  let callCount1 = 0;
  const controller1 = new AbortController();
  let removedWaitListener = false;
  let addedWaitListener = false;
  const origAdd1 = controller1.signal.addEventListener.bind(controller1.signal);
  const origRemove1 = controller1.signal.removeEventListener.bind(controller1.signal);
  controller1.signal.addEventListener = (type, fn, opts) => {
    if (opts?.once) addedWaitListener = true;
    return origAdd1(type, fn, opts);
  };
  controller1.signal.removeEventListener = (type, fn, opts) => {
    removedWaitListener = true;
    return origRemove1(type, fn, opts);
  };

  const runComplete = makeOrchestrator({
    config: { retryBaseDelayMs: 15, maxScoutAttempts: 2 },
    onCall: async ({ params }) => {
      if (params.config.responseSchema?.properties?.needs_search) {
        callCount1++;
        if (callCount1 === 1) throw Object.assign(new Error('Retry me'), { status: 503 });
        return { text: JSON.stringify({ needs_search: false, target_model: 'gemini-4-hydrogen', thinking_level: 'low', facts: [], focus_area: 'F' }), candidates: [{ finishReason: 'STOP' }] };
      }
      return { text: JSON.stringify(strategyFixture()), candidates: [{ finishReason: 'STOP' }] };
    },
  });
  await runComplete({ ownerId: 'wait-ok', signal: controller1.signal, schema: StrategySchema, name: 's', instructions: 'i', input: 'Plan' });
  assert.equal(addedWaitListener, true);
  assert.equal(removedWaitListener, true);

  // 2. Abort during retry wait rejects cleanly & clears timer/listener
  const controller2 = new AbortController();
  let removedAbortListener2 = false;
  const origRemove2 = controller2.signal.removeEventListener.bind(controller2.signal);
  controller2.signal.removeEventListener = (type, fn, opts) => {
    removedAbortListener2 = true;
    return origRemove2(type, fn, opts);
  };
  const runAbort = makeOrchestrator({
    config: { retryBaseDelayMs: 5000, retryMaxDelayMs: 5000, maxScoutAttempts: 2 },
    onCall: async () => {
      setTimeout(() => controller2.abort(new DOMException('Cancelled mid-backoff', 'AbortError')), 15);
      throw Object.assign(new Error('Retry me'), { status: 503 });
    },
  });
  await assert.rejects(
    () => runAbort({ ownerId: 'wait-abort', signal: controller2.signal, schema: StrategySchema, name: 's', instructions: 'i', input: 'Plan' }),
    err => err.name === 'AbortError' || err.code === 'REQUEST_ABORTED',
  );
  assert.equal(removedAbortListener2, true);

  // 3. Wait setup throwing synchronously rejects cleanly without leaked timer
  const controller3 = new AbortController();
  let listenerCalls3 = 0;
  const origAdd3 = controller3.signal.addEventListener.bind(controller3.signal);
  controller3.signal.addEventListener = (type, fn, opts) => {
    listenerCalls3++;
    if (opts?.once && type === 'abort') {
      throw new Error('Listener registration failure');
    }
    return origAdd3(type, fn, opts);
  };
  const runWaitSetupError = makeOrchestrator({
    config: { retryBaseDelayMs: 5000, retryMaxDelayMs: 5000, maxScoutAttempts: 2 },
    onCall: async () => {
      throw Object.assign(new Error('Retry me'), { status: 503 });
    },
  });
  await assert.rejects(
    () => runWaitSetupError({ ownerId: 'wait-err', signal: controller3.signal, schema: StrategySchema, name: 's', instructions: 'i', input: 'Plan' }),
    err => err.message === 'Listener registration failure',
  );
  assert.ok(listenerCalls3 >= 1);
});
