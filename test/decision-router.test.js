import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import http from "node:http";
import {
  DEFAULT_MODEL_PRICING,
  AiPolicy,
  resolveEffectiveModelPricing,
} from "../src/services/security/ai-policy.js";
import { PrivacyPolicy } from "../src/services/security/privacy-policy.js";
import { getPricingForModel, calculateEstimatedCost } from "../src/services/telemetry/pricing.js";
import {
  callDecisionsApi,
  hasDecisionApiConfiguration,
  resolveDecisionVertexConfig,
} from "../src/services/ai/client.js";
import { evaluateSearchRoute } from "../src/services/ai/search-router.js";
import {
  DECISION_MODEL,
  DECISION_FALLBACK_MODEL,
  DECISION_TIMEOUTS_MS,
  REDIS_CIRCUIT_KEYS,
  HelmerDecisionRouter,
  createHelmerDecisionRouter,
  resolveDecisionTimeoutMs,
  serializeDecisionContext,
} from "../src/services/ai/decision-router.js";
import { createAskHandler } from "../src/http/ask-handler.js";
import { createStrategyRouter } from "../src/http/strategy-router.js";

function createMockRedis() {
  const store = new Map();
  const ttls = new Map();
  return {
    store,
    ttls,
    async get(key) {
      return store.has(key) ? store.get(key) : null;
    },
    async set(key, value, options = {}) {
      store.set(key, String(value));
      if (options?.EX) ttls.set(key, options.EX);
      return "OK";
    },
    async setEx(key, seconds, value) {
      store.set(key, String(value));
      ttls.set(key, seconds);
      return "OK";
    },
    async incr(key) {
      const next = Number(store.get(key) || 0) + 1;
      store.set(key, String(next));
      return next;
    },
    async expire(key, seconds) {
      ttls.set(key, seconds);
      return 1;
    },
    async del(key) {
      store.delete(key);
      ttls.delete(key);
      return 1;
    },
  };
}

async function runExpressRequest(app, method, path, body = {}, headers = {}) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.listen(0, "127.0.0.1", async () => {
      const port = server.address().port;
      try {
        const res = await fetch(`http://127.0.0.1:${port}${path}`, {
          method,
          headers: {
            "Content-Type": "application/json",
            ...headers,
          },
          body: method === "GET" ? undefined : JSON.stringify(body),
        });
        const text = await res.text();
        let json = null;
        try {
          json = JSON.parse(text);
        } catch {}
        resolve({ status: res.status, json, text });
      } catch (err) {
        reject(err);
      } finally {
        server.close();
      }
    });
  });
}

test("Pricing registration for gemini-decision-1 and gemini-3.5-flash-lite in AiPolicy and Telemetry", async () => {
  assert.deepEqual(DEFAULT_MODEL_PRICING["gemini-decision-1"], { input: 0.10, output: 0.00, search: 0 });
  assert.deepEqual(DEFAULT_MODEL_PRICING["gemini-3.5-flash-lite"], { input: 0.30, output: 2.50, search: 0.035 });

  const decisionAiPrice = resolveEffectiveModelPricing("gemini-decision-1", {});
  assert.deepEqual(decisionAiPrice, { input: 0.10, output: 0.00, search: 0, searchMicros: 0 });
  const flashLiteAiPrice = resolveEffectiveModelPricing("gemini-3.5-flash-lite", {});
  assert.equal(flashLiteAiPrice.input, 0.30);
  assert.equal(flashLiteAiPrice.output, 2.50);
  assert.equal(flashLiteAiPrice.search, 0.035);

  const overriddenEnv = {
    GEMINI_FLASH_INPUT_USD_PER_1M: "9.99",
    GEMINI_FLASH_OUTPUT_USD_PER_1M: "19.99",
  };
  assert.deepEqual(getPricingForModel("gemini-decision-1", overriddenEnv), {
    model: "gemini-decision-1",
    inputPerMillion: 0.10,
    outputPerMillion: 0.00,
  });
  assert.deepEqual(getPricingForModel("gemini-3.5-flash-lite", overriddenEnv), {
    model: "gemini-3.5-flash-lite",
    inputPerMillion: 0.30,
    outputPerMillion: 2.50,
  });

  const decisionCost = calculateEstimatedCost("gemini-decision-1", 1_000_000, 0);
  assert.equal(decisionCost.costUsd, 0.10);

  const policy = new AiPolicy({ env: { AI_USER_DAILY_USD: "5", AI_PLATFORM_DAILY_USD: "50" } });
  const release = await policy.reserveProvider(
    { ownerId: "user-1", signal: new AbortController().signal },
    { model: "gemini-decision-1", contents: "Quick routing check" }
  );
  await release({ usage: { promptTokens: 1000, completionTokens: 0 } });
});

test("Dual-client config respects AQ. Vertex key bypass, location env vars, and HTTP 400 safety blocks", async () => {
  assert.equal(hasDecisionApiConfiguration({ GEMINI_API_KEY: "AIza-test-key" }), true);
  assert.equal(hasDecisionApiConfiguration({ GEMINI_API_KEY: "AQ.vertex-express-key" }), false);
  assert.equal(hasDecisionApiConfiguration({}), false);

  const vertexGlobal = resolveDecisionVertexConfig(
    { GOOGLE_CLOUD_PROJECT: "helmer-prod-123", GOOGLE_CLOUD_LOCATION: "global" },
    () => false
  );
  assert.equal(vertexGlobal.location, "global");
  assert.equal(vertexGlobal.vertexai, true);

  const vertexUs = resolveDecisionVertexConfig(
    { GOOGLE_CLOUD_PROJECT: "helmer-prod-123", BUILD_VERTEX_LOCATION: "us", GOOGLE_CLOUD_LOCATION: "global" },
    () => false
  );
  assert.equal(vertexUs.location, "us");

  let capturedRequest = null;
  await callDecisionsApi({
    input: "Context",
    questions: { needs_web_search: { type: "noul", instructions: "Need web?" } },
    env: { GEMINI_API_KEY: "AIza-dev-key" },
    fetcher: async (url, init) => {
      capturedRequest = { url, init };
      return new Response(JSON.stringify({ results: { needs_web_search: { score: 0.9 } } }), { status: 200 });
    },
  });
  assert.equal(capturedRequest.url, "https://generativelanguage.googleapis.com/v1beta/decisions");
  assert.equal(capturedRequest.init.headers["x-goog-api-key"], "AIza-dev-key");

  await assert.rejects(
    () =>
      callDecisionsApi({
        input: "Blocked",
        questions: {},
        env: { GEMINI_API_KEY: "AIza-dev-key" },
        fetcher: async () =>
          new Response(JSON.stringify({ error: { status: "INVALID_ARGUMENT", message: "content_blocked safety" } }), {
            status: 400,
          }),
      }),
    (err) => err.status === 400 && err.code === "AI_CONTENT_BLOCKED" && err.isSafetyBlock === true
  );
});

test("0 ms deterministic fast-paths for Ask (explicitWeb / URL) and Build (attachments)", async () => {
  let fetchCalled = false;
  let vertexCalled = false;
  const router = createHelmerDecisionRouter({
    env: { GEMINI_API_KEY: "AIza-dev-key", GOOGLE_CLOUD_PROJECT: "helmer-prod-123" },
    fetcher: async () => {
      fetchCalled = true;
      throw new Error("Should not call fetch");
    },
    getVertexClientFn: () => {
      vertexCalled = true;
      throw new Error("Should not call vertex");
    },
  });

  const explicitRes = await router.routeAsk({ prompt: "Bu mətni redaktə et", explicitWeb: true });
  assert.equal(explicitRes.enableSearch, true);
  assert.equal(explicitRes.requireGrounding, true);
  assert.equal(explicitRes.routerSource, "fast_path");
  assert.equal(explicitRes.latencyMs, 0);

  const urlRes = await router.routeAsk({ prompt: "https://cbar.az/saytina bax və xülasə ver" });
  assert.equal(urlRes.enableSearch, true);
  assert.equal(urlRes.routerSource, "fast_path");
  assert.equal(urlRes.latencyMs, 0);

  const buildFast = await router.routeBuild({ prompt: "PRD əsasında brief yaz", hasAttachments: true, isBriefGeneration: true });
  assert.equal(buildFast.briefAction, "draft_brief");
  assert.equal(buildFast.hasEnoughContext, true);
  assert.equal(buildFast.routerSource, "fast_path");
  assert.equal(buildFast.latencyMs, 0);

  assert.equal(fetchCalled, false);
  assert.equal(vertexCalled, false);
});

test("Dynamic timeouts & Decisions API context serialization strip groundingMetadata", () => {
  assert.equal(resolveDecisionTimeoutMs({ serializedContext: "short prompt" }), DECISION_TIMEOUTS_MS.SHORT_TEXT);
  assert.equal(resolveDecisionTimeoutMs({ serializedContext: "short", hasMedia: true }), DECISION_TIMEOUTS_MS.MEDIA_OR_PDF);
  assert.equal(
    resolveDecisionTimeoutMs({ messages: [{ role: "user", content: "hi", file: { mimeType: "application/pdf" } }] }),
    DECISION_TIMEOUTS_MS.MEDIA_OR_PDF
  );
  assert.equal(resolveDecisionTimeoutMs({ estimatedTokens: 16001 }), DECISION_TIMEOUTS_MS.LARGE_TEXT);

  const serialized = serializeDecisionContext({
    prompt: "Dəqiq?",
    hasGroundedHistory: true,
    messages: [
      { role: "user", content: "Azərbaycan Mərkəzi Bankının uçot dərəcəsi nə qədərdir?" },
      {
        role: "assistant",
        content: "Cari uçot dərəcəsi 7.25%-dir.",
        searchGrounded: true,
        sources: [{ title: "CBAR", url: "https://cbar.az" }],
        groundingMetadata: { webSearchQueries: ["cbar rate"], groundingChunks: [{ secret: "raw" }] },
      },
      { role: "user", content: "Dəqiq?" },
    ],
  });
  assert.match(serialized, /hasGroundedHistory=true/);
  assert.ok(!serialized.includes("webSearchQueries"));
  assert.ok(!serialized.includes("groundingChunks"));
});

test("gemini-decision-1 Ask routing handles 'Dəqiq?' in grounded chat & require_grounding override", async () => {
  let sentBody = null;
  const router = createHelmerDecisionRouter({
    env: { GEMINI_API_KEY: "AIza-dev-key" },
    fetcher: async (_url, init) => {
      sentBody = JSON.parse(init.body);
      return new Response(
        JSON.stringify({
          results: {
            needs_web_search: { score: 0.89 },
            require_grounding: { score: 0.25 },
          },
        }),
        { status: 200 }
      );
    },
  });

  const decision = await router.routeAsk({
    prompt: "Dəqiq?",
    messages: [
      { role: "user", content: "OpenAI yeni qiymətləri nədir?" },
      { role: "assistant", content: "Qiymətlər dəyişib.", searchGrounded: true },
      { role: "user", content: "Dəqiq?" },
    ],
  });

  assert.equal(sentBody.model, DECISION_MODEL);
  assert.equal(typeof sentBody.input, "string");
  assert.equal(decision.enableSearch, true);
  assert.equal(decision.requireGrounding, false);
  assert.equal(decision.routerSource, "decisions_api");

  // require_grounding >= 0.75 forces enableSearch: true even when needs_web_search < 0.65
  const strictRouter = createHelmerDecisionRouter({
    env: { GEMINI_API_KEY: "AIza-dev-key" },
    fetcher: async () =>
      new Response(
        JSON.stringify({
          results: {
            needs_web_search: { score: 0.40 },
            require_grounding: { score: 0.82 },
          },
        }),
        { status: 200 }
      ),
  });
  const strictDecision = await strictRouter.routeAsk({ prompt: "Rəsmi inflyasiya göstəricisi" });
  assert.equal(strictDecision.requireGrounding, true);
  assert.equal(strictDecision.enableSearch, true);
});

test("gemini-decision-1 Build Brief routing: depth mapping, low context override, and needs_market_search", async () => {
  const router = createHelmerDecisionRouter({
    env: { GEMINI_API_KEY: "AIza-dev-key" },
    fetcher: async (_url, init) => {
      const body = JSON.parse(init.body);
      assert.ok(body.questions.brief_action.criteria.other);
      if (body.input.includes("vague")) {
        return new Response(
          JSON.stringify({
            results: {
              brief_action: { choice: "draft_brief" },
              brief_depth: { score: 0 },
              needs_market_search: { score: 0.2 },
              has_enough_context: { score: 0.3 }, // < 0.45 overrides action to ask_questions
            },
          }),
          { status: 200 }
        );
      }
      return new Response(
        JSON.stringify({
          results: {
            brief_action: { choice: "draft_brief" },
            brief_depth: { score: 2 },
            needs_market_search: { score: 0.84 },
            has_enough_context: { score: 0.91 },
          },
        }),
        { status: 200 }
      );
    },
  });

  const vagueRes = await router.routeBuild({ prompt: "vague app idea" });
  assert.equal(vagueRes.hasEnoughContext, false);
  assert.equal(vagueRes.briefAction, "ask_questions");
  assert.equal(vagueRes.briefDepth, 0);
  assert.equal(vagueRes.routerSource, "decisions_api");

  const enterpriseRes = await router.routeBuild({ prompt: "Enterprise B2B fintech marketplace in Azerbaijan with competitor pricing analysis" });
  assert.equal(enterpriseRes.briefAction, "draft_brief");
  assert.equal(enterpriseRes.briefDepth, 2);
  assert.equal(enterpriseRes.needsMarketSearch, true);
  assert.equal(enterpriseRes.hasEnoughContext, true);
});

test("HTTP 400 safety/content_blocked blocks explicitly without tripping Redis circuit breaker", async () => {
  const redis = createMockRedis();
  const router = createHelmerDecisionRouter({
    redis,
    env: { GEMINI_API_KEY: "AIza-dev-key" },
    fetcher: async () =>
      new Response(JSON.stringify({ error: { status: "INVALID_ARGUMENT", message: "safety content_blocked" } }), {
        status: 400,
      }),
  });

  await assert.rejects(
    () => router.routeAsk({ prompt: "unsafe test prompt" }),
    (err) => err.status === 400 && err.code === "AI_SAFETY_BLOCKED" && err.isSafetyBlock === true
  );
  assert.equal(redis.store.get(REDIS_CIRCUIT_KEYS.FAILURES), undefined);
  assert.equal(redis.store.get(REDIS_CIRCUIT_KEYS.CIRCUIT_OPEN), undefined);
});

test("503 / timeout fallback to gemini-3.5-flash-lite (MINIMAL thinking) + strict Zod schema", async () => {
  const redis = createMockRedis();
  let vertexParams = null;

  const router = createHelmerDecisionRouter({
    redis,
    env: { GEMINI_API_KEY: "AIza-dev-key", GOOGLE_CLOUD_PROJECT: "helmer-prod-123" },
    fetcher: async () => new Response("Service Unavailable", { status: 503 }),
    getVertexClientFn: () => ({
      models: {
        generateContent: async (params) => {
          vertexParams = params;
          return {
            text: JSON.stringify(
              params.contents[0].parts[0].text.includes('"draft_brief"')
                ? { a: "refine_brief", d: 0, m: true, c: true }
                : { s: true, r: false }
            ),
          };
        },
      },
    }),
  });

  const askRes = await router.routeAsk({ prompt: "Baku coffee shop prices 2026" });
  assert.equal(askRes.enableSearch, true);
  assert.equal(askRes.requireGrounding, false);
  assert.equal(askRes.routerSource, "vertex_flash_lite");
  assert.equal(vertexParams.model, DECISION_FALLBACK_MODEL);
  assert.deepEqual(vertexParams.config.thinkingConfig, { thinkingLevel: "MINIMAL" });
  assert.equal(vertexParams.config.temperature, 0.0);
  assert.equal(vertexParams.config.maxOutputTokens, 64);
  assert.equal(vertexParams.config.responseMimeType, "application/json");

  const buildRes = await router.routeBuild({ prompt: "Cut scope to MVP only", hasExistingBrief: true });
  assert.equal(buildRes.briefAction, "refine_brief");
  assert.equal(buildRes.briefDepth, 0);
  assert.equal(buildRes.needsMarketSearch, true);
  assert.equal(buildRes.routerSource, "vertex_flash_lite");

  // AQ. Vertex key bypasses AI Studio fetch in 0 ms straight to Fallback 1
  let studioCalled = false;
  const aqRouter = createHelmerDecisionRouter({
    env: { GEMINI_API_KEY: "AQ.vertex-express", GOOGLE_CLOUD_PROJECT: "helmer-prod-123" },
    fetcher: async () => {
      studioCalled = true;
      throw new Error("Should bypass");
    },
    getVertexClientFn: () => ({
      models: {
        generateContent: async () => ({ text: '{"s":false,"r":false}' }),
      },
    }),
  });
  const aqRes = await aqRouter.routeAsk({ prompt: "Write a short slogan" });
  assert.equal(studioCalled, false);
  assert.equal(aqRes.routerSource, "vertex_flash_lite");
  assert.equal(aqRes.enableSearch, false);
});

test("Redis circuit breaker opens after >= 3 failures with 60s TTL and bypasses Decisions API in 0 ms", async () => {
  const redis = createMockRedis();
  let fetchCalls = 0;

  const router = createHelmerDecisionRouter({
    redis,
    env: { GEMINI_API_KEY: "AIza-dev-key", GOOGLE_CLOUD_PROJECT: "helmer-prod-123" },
    fetcher: async () => {
      fetchCalls += 1;
      if (fetchCalls === 1) return new Response("Unavailable", { status: 503 });
      if (fetchCalls === 2) return new Response("Rate Limited", { status: 429 });
      const timeoutErr = new Error("Timed out");
      timeoutErr.name = "TimeoutError";
      throw timeoutErr;
    },
    getVertexClientFn: () => ({
      models: {
        generateContent: async () => ({ text: '{"s":false,"r":false}' }),
      },
    }),
  });

  await router.routeAsk({ prompt: "q1" });
  assert.equal(redis.store.get(REDIS_CIRCUIT_KEYS.FAILURES), "1");
  assert.equal(redis.store.get(REDIS_CIRCUIT_KEYS.CIRCUIT_OPEN), undefined);

  await router.routeAsk({ prompt: "q2" });
  assert.equal(redis.store.get(REDIS_CIRCUIT_KEYS.FAILURES), "2");
  assert.equal(redis.store.get(REDIS_CIRCUIT_KEYS.CIRCUIT_OPEN), undefined);

  await router.routeAsk({ prompt: "q3" });
  assert.equal(redis.store.get(REDIS_CIRCUIT_KEYS.FAILURES), "3");
  assert.equal(redis.store.get(REDIS_CIRCUIT_KEYS.CIRCUIT_OPEN), "1");
  assert.equal(redis.ttls.get(REDIS_CIRCUIT_KEYS.CIRCUIT_OPEN), 60);

  // 4th call while circuit is open must NOT invoke fetch
  const res4 = await router.routeAsk({ prompt: "q4" });
  assert.equal(fetchCalls, 3);
  assert.equal(res4.routerSource, "vertex_flash_lite");
});

test("Fallback 2 local rules handle Ask ('Dəqiq?' with grounded history) and Build when Vertex fails", async () => {
  // Invalid Zod schema from Vertex should fall through to local_rules
  const router = createHelmerDecisionRouter({
    env: { GOOGLE_CLOUD_PROJECT: "helmer-prod-123" },
    getVertexClientFn: () => ({
      models: {
        generateContent: async () => ({ text: '{"invalid_key": true}' }),
      },
    }),
  });

  const askFallback = await router.routeAsk({
    prompt: "Dəqiq?",
    messages: [
      { role: "user", content: "2026 inflyasiya proqnozu" },
      { role: "assistant", content: "Proqnoz 4.5%-dir.", searchGrounded: true },
      { role: "user", content: "Dəqiq?" },
    ],
  });
  assert.equal(askFallback.enableSearch, true);
  assert.equal(askFallback.routerSource, "local_rules");

  // Synchronous evaluateSearchRoute backward compatibility check
  const syncFollowup = evaluateSearchRoute({
    prompt: "Dəqiq?",
    messages: [
      { role: "assistant", content: "Grounded claim", searchGrounded: true },
    ],
  });
  assert.equal(syncFollowup.enableSearch, true);

  const buildNewFallback = await router.routeBuild({ prompt: "Build a SaaS", hasExistingBrief: false });
  assert.deepEqual(
    {
      briefAction: buildNewFallback.briefAction,
      briefDepth: buildNewFallback.briefDepth,
      needsMarketSearch: buildNewFallback.needsMarketSearch,
      hasEnoughContext: buildNewFallback.hasEnoughContext,
      routerSource: buildNewFallback.routerSource,
    },
    {
      briefAction: "draft_brief",
      briefDepth: 1,
      needsMarketSearch: false,
      hasEnoughContext: true,
      routerSource: "local_rules",
    }
  );

  const buildRefineFallback = await router.routeBuild({ prompt: "Update KPIs", hasExistingBrief: true });
  assert.equal(buildRefineFallback.briefAction, "refine_brief");
  assert.equal(buildRefineFallback.routerSource, "local_rules");
});

test("HTTP integration: createAskHandler and createStrategyRouter respect HelmerDecisionRouter", async () => {
  let capturedGenerateAskArgs = null;
  const app = express();
  app.use(express.json());
  const ownerId = "11111111-1111-4111-8111-111111111111";
  const testUser = {
    id: ownerId,
    status: "active",
    email: "founder@helmer.ai",
    emailVerifiedAt: new Date().toISOString(),
    authVersion: 1,
    privacyEpoch: 0,
    settings: { modelImprovement: true },
  };
  const aiPolicy = new AiPolicy({ env: { AI_USER_DAILY_USD: "5", AI_PLATFORM_DAILY_USD: "50" } });
  const privacyPolicy = new PrivacyPolicy({ findById: async (id) => (id === ownerId ? testUser : null) });
  app.use((req, _res, next) => {
    req.ownerId = ownerId;
    req.user = testUser;
    req.auth = { user: testUser };
    next();
  });
  app.use(privacyPolicy.middleware());
  app.use(aiPolicy.middleware());

  const decisionRouter = createHelmerDecisionRouter({
    env: { GEMINI_API_KEY: "AIza-dev-key" },
    fetcher: async (_url, init) => {
      const body = JSON.parse(init.body);
      if (body.questions?.needs_web_search) {
        return new Response(
          JSON.stringify({ results: { needs_web_search: { score: 0.92 }, require_grounding: { score: 0.1 } } }),
          { status: 200 }
        );
      }
      return new Response(
        JSON.stringify({
          results: {
            brief_action: { choice: "draft_brief" },
            brief_depth: { score: 0 },
            needs_market_search: { score: 0.85 },
            has_enough_context: { score: 0.9 },
          },
        }),
        { status: 200 }
      );
    },
  });

  app.post(
    "/api/ask",
    createAskHandler({
      configured: () => true,
      decisionRouter,
      chatRepository: {
        getById: async () => null,
        saveChat: async ({ messages }) => ({ id: "22222222-2222-4222-8222-222222222222", revision: 1, messages }),
      },
      strategyRepository: { getById: async () => null },
      plannerRepository: { listByOwner: async () => [] },
      researchService: { hasActiveJobForOwner: () => false },
      learningLoop: { createInteractionId: () => "33333333-3333-4333-8333-333333333333", recordInteraction: async () => {} },
      telemetryService: { trackAskQuery: async () => {} },
      sanitizeGroundingMetadata: (m) => m,
      generateAsk: async (args) => {
        capturedGenerateAskArgs = args;
        return {
          text: "Verified response.",
          model: "gemini-4-hydrogen",
          provider: "google",
          usage: { inputTokens: 10, outputTokens: 10 },
        };
      },
    })
  );

  const askRes = await runExpressRequest(
    app,
    "POST",
    "/api/ask",
    {
      messages: [
        { role: "user", content: "OpenAI GPT qiyməti?" },
        { role: "assistant", content: "Qiymət məlumatı.", searchGrounded: true },
        { role: "user", content: "Dəqiq?" },
      ],
    },
    { "Idempotency-Key": "ask_decision_test_123456" }
  );
  assert.equal(askRes.status, 200);
  assert.equal(capturedGenerateAskArgs.enableSearch, true);

  let capturedStrategyArgs = null;
  let capturedLearningRecord = null;
  const strategyRouter = createStrategyRouter(
    {
      readAll: async () => [],
      create: async (record) => ({ ...record, id: "55555555-5555-4555-8555-555555555555" }),
      rememberProvenance: async () => {},
    },
    {
      createInteractionId: () => "44444444-4444-4444-8444-444444444444",
      recordInteraction: async (rec) => {
        capturedLearningRecord = rec;
      },
    },
    {
      decisionRouter,
      telemetryService: {
        trackStrategyEvent: async () => {},
        trackBuildGeneration: async () => {},
        trackBuildStrategy: async () => {},
      },
      generationServices: {
        assessBrief: async () => ({ status: "ready", understanding: "ok", questions: [], assumptions: [] }),
        generateStrategy: async (args) => {
          capturedStrategyArgs = args;
          return {
            title: "Quick MVP Strategy",
            summary: "Summary",
            context: { business: "SaaS", objective: "Launch", market: "Global", targetAudience: "SMBs" },
            sections: [],
            kpis: [],
            assumptions: [],
            nextSteps: [],
          };
        },
        refineStrategy: async () => ({}),
      },
    }
  );
  app.use("/api/strategy", strategyRouter);

  const genRes = await runExpressRequest(
    app,
    "POST",
    "/api/strategy/generate",
    {
      brief: "Launch an AI analytics SaaS in Azerbaijan with live market pricing benchmarks",
      idempotencyKey: "build_decision_test_123456",
    },
    { "Idempotency-Key": "build_decision_test_123456" }
  );
  assert.equal(genRes.status, 200);
  assert.equal(capturedStrategyArgs.buildMode, "faster");
  assert.equal(capturedStrategyArgs.buildDecision.briefDepth, 0);
  assert.equal(capturedStrategyArgs.buildDecision.needsMarketSearch, true);
  assert.equal(capturedLearningRecord.onlyNecessaryData, true);
});
