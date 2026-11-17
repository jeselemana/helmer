import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import express from "express";
import { createAskHandler } from "../src/http/ask-handler.js";
import { createAskService } from "../src/services/ai/ask-service.js";
import { sanitizeAskGroundingMetadata } from "../src/services/ai/ask-grounding.js";
import { createAskExecutionGuard } from "../src/http/ask-execution-guard.js";
import { createCapabilityRouter } from "../src/http/capability-router.js";
import { createResearchRouter } from "../src/http/research-router.js";
import { ResearchService, CreateResearchJobSchema } from "../src/services/ai/research-service.js";
import { AiPolicy } from "../src/services/security/ai-policy.js";
import { PrivacyPolicy } from "../src/services/security/privacy-policy.js";
import { configureProviderPolicy, wrapProvider } from "../src/services/security/provider-policy.js";
import { FileChatRepository } from "../src/repositories/file-chat-repository.js";
import { GUEST_RESTRICTION_NOTICES } from "../src/services/ai/prompts.js";
import { createPluginRegistry } from "../src/services/plugins/registry.js";

async function buildBriefTestHarness(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "helmer-brief-ctx-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));

  const ownerA = randomUUID();
  const ownerB = randomUUID();
  const groundedId = randomUUID();
  const normalId = randomUUID();
  const emptyBriefId = randomUUID();

  const makeUser = (id) => ({
    id,
    status: "active",
    emailVerifiedAt: "2026-01-01T00:00:00.000Z",
    authVersion: 1,
    settings: { modelImprovement: false, personalIntelligence: false },
  });
  const users = new Map([
    [ownerA, makeUser(ownerA)],
    [ownerB, makeUser(ownerB)],
  ]);

  const records = new Map([
    [
      groundedId,
      {
        id: groundedId,
        ownerId: ownerA,
        title: "SECRET_GROUNDED_TITLE",
        brief: "Bakıda 15,000 AZN büdcə ilə pərakəndə əməliyyatlar SaaS-ı qurmaq istəyirəm.",
        searchGrounded: true,
        groundingActive: true,
        sources: [{ title: "External Grounded Source", url: "https://grounded-source.example.com/report" }],
        strategy: {
          title: "SECRET_GROUNDED_STRATEGY_TITLE",
          executiveSummary: "SECRET_GROUNDED_STRATEGY_DO_NOT_LEAK",
          searchGrounded: true,
          sources: [{ title: "External Grounded Source", url: "https://grounded-source.example.com/report" }],
        },
        versions: [
          {
            id: randomUUID(),
            createdAt: "2026-01-01T00:00:00.000Z",
            data: { searchGrounded: true, title: "SECRET_VERSION_DATA" },
          },
        ],
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ],
    [
      normalId,
      {
        id: normalId,
        ownerId: ownerA,
        title: "Ungrounded Strategy Title",
        brief: "B2B logistika platforması üçün başlanğıc brifi.",
        searchGrounded: false,
        strategy: {
          executiveSummary: "UNGROUNDED_STRATEGY_SUMMARY",
        },
        versions: [],
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ],
    [
      emptyBriefId,
      {
        id: emptyBriefId,
        ownerId: ownerA,
        title: "No Brief Record",
        brief: "   ",
        searchGrounded: true,
        strategy: { executiveSummary: "SECRET_EMPTY_BRIEF_STRATEGY" },
        versions: [],
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ],
  ]);

  const strategyRepository = {
    getById: async (id, owner) => {
      const rec = records.get(id);
      if (!rec || rec.ownerId !== owner) return null;
      return rec;
    },
    readAll: async (owner) => Array.from(records.values()).filter((r) => r.ownerId === owner),
    loadOwnerProvenance: async () => {},
  };
  const plannerRepository = { list: async () => [] };
  const chatRepository = new FileChatRepository(path.join(directory, "chats.json"), null, { cloud: false });

  const calls = [];
  const policy = new AiPolicy({ redis: null, allowParallelAskChats: false, env: { GUEST_AI_DAILY_LIMIT: "5" } });
  configureProviderPolicy({
    assertEnabled: () => policy.assertEnabled(),
    reserveProvider: async (context, params) => policy.reserveProvider(context, params),
  });
  t.after(() => configureProviderPolicy(undefined));

  const client = wrapProvider(
    {
      models: {
        generateContent: async (params) => {
          calls.push(params);
          return { text: "Orijinal brif əsasında cavab.", candidates: [{}] };
        },
        generateContentStream: async function* (params) {
          calls.push(params);
          yield { text: "Orijinal brif ", candidates: [{}] };
          yield { text: "əsasında cavab.", candidates: [{}] };
        },
      },
    },
    "gemini"
  );

  const registry = createPluginRegistry();
  const artifactCalls = [];
  const capturedResearchJobs = [];
  const researchService = new ResearchService({
    chatRepository,
    strategyRepository,
    plannerRepository,
    geminiClient: client,
  });
  researchService.executeJob = async (jobId) => {
    const job = researchService.activeJobs.get(jobId);
    if (job) capturedResearchJobs.push(structuredClone(job));
    researchService.activeJobs.delete(jobId);
  };

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const ownerHeader = req.get("X-Test-Owner");
    if (ownerHeader === "guest") {
      req.ownerId = "guest-session-1";
      req.user = null;
      req.auth = { user: null };
    } else {
      req.ownerId = ownerHeader || ownerA;
      req.user = users.get(req.ownerId) || null;
      req.auth = { user: req.user };
    }
    next();
  });
  app.use(new PrivacyPolicy({ findById: async (id) => users.get(id) }).middleware());
  app.use(policy.middleware());

  const guard = createAskExecutionGuard({ redis: null, allowGuest: true });
  app.use(
    "/api/ask",
    guard,
    createCapabilityRouter({
      allowGuestChat: true,
      registry,
      chats: chatRepository,
      artifacts: { get: async () => null, rollback: async () => {} },
      strategies: strategyRepository,
      planner: plannerRepository,
      workflow: {
        execute: async (workflowArgs) => {
          artifactCalls.push({ workflow: workflowArgs });
          return {
            reply: "Brif əsasında Word sənədi hazırlandı.",
            artifacts: [{ id: randomUUID(), format: "docx", fileName: "brief.docx" }],
            execution: { mode: "capability" },
            model: "gemini-4-hydrogen",
          };
        },
      },
    })
  );
  app.use(
    "/api/ask/research",
    createResearchRouter({
      researchService,
      chatRepository,
    })
  );
  app.post(
    "/api/ask",
    createAskHandler({
      configured: () => true,
      chatRepository,
      strategyRepository,
      plannerRepository,
      researchService,
      learningLoop: { createInteractionId: randomUUID, recordInteraction: async () => {}, recordSignal: async () => {} },
      telemetryService: { trackAskQuery: async () => {} },
      sanitizeGroundingMetadata: sanitizeAskGroundingMetadata,
      generateAsk: createAskService({ getClient: () => client }),
    })
  );

  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => new Promise((resolve) => {
    server.close(resolve);
    server.closeAllConnections();
  }));

  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const postAsk = (body = {}, owner = ownerA, extraHeaders = {}) =>
    fetch(`${baseUrl}/api/ask`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Test-Owner": owner,
        "Idempotency-Key": randomUUID(),
        ...extraHeaders,
      },
      body: JSON.stringify({
        messages: [{ role: "user", content: "Bu brif üzrə əsas riskləri analiz et", briefTitle: "Bakıda 15,000 AZN..." }],
        ...body,
      }),
    });

  const postResearch = (body = {}, owner = ownerA) =>
    fetch(`${baseUrl}/api/ask/research`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Test-Owner": owner,
        "Idempotency-Key": randomUUID(),
      },
      body: JSON.stringify(body),
    });

  return {
    ownerA,
    ownerB,
    groundedId,
    normalId,
    emptyBriefId,
    records,
    calls,
    artifactCalls,
    capturedResearchJobs,
    chatRepository,
    researchService,
    postAsk,
    postResearch,
  };
}

test("Grounded strategy remains 422 on strategyId, while briefId injects strictly original brief and persists chat.briefId", async (t) => {
  const f = await buildBriefTestHarness(t);

  // 1. Passing grounded strategy via strategyId is still strictly blocked
  const blockedRes = await f.postAsk({ strategyId: f.groundedId });
  assert.equal(blockedRes.status, 422);
  const blockedJson = await blockedRes.json();
  assert.equal(blockedJson.code, "GROUNDED_STRATEGY_RESTRICTED");
  assert.equal(f.calls.length, 0);

  // 2. Passing the same record's original brief via briefId succeeds
  const okRes = await f.postAsk({ briefId: f.groundedId });
  assert.equal(okRes.status, 200);
  const okJson = await okRes.json();
  assert.equal(okJson.reply, "Orijinal brif əsasında cavab.");
  assert.ok(okJson.chat?.id);
  assert.equal(okJson.chat.briefId, f.groundedId);
  assert.equal(okJson.chat.strategyId, null);

  // Verify model prompt contains original brief and ZERO grounded strategy fields
  assert.equal(f.calls.length, 1);
  const serializedCall = JSON.stringify(f.calls[0]);
  assert.match(serializedCall, /15,000 AZN/);
  assert.doesNotMatch(serializedCall, /SECRET_GROUNDED_STRATEGY_DO_NOT_LEAK/);
  assert.doesNotMatch(serializedCall, /SECRET_GROUNDED_STRATEGY_TITLE/);
  assert.doesNotMatch(serializedCall, /SECRET_GROUNDED_TITLE/);
  assert.doesNotMatch(serializedCall, /SECRET_VERSION_DATA/);
  assert.doesNotMatch(serializedCall, /grounded-source\.example\.com/);

  // 3. Follow-up on same chatId inherits persisted briefId automatically without leaking strategy
  const followUpRes = await f.postAsk({
    chatId: okJson.chat.id,
    messages: [{ role: "user", content: "İlk 30 gündə nə edim?" }],
  });
  assert.equal(followUpRes.status, 200);
  assert.equal(f.calls.length, 2);
  const serializedFollowUp = JSON.stringify(f.calls[1]);
  assert.match(serializedFollowUp, /15,000 AZN/);
  assert.doesNotMatch(serializedFollowUp, /SECRET_GROUNDED_STRATEGY_DO_NOT_LEAK/);
});

test("briefId enforces ownership, mutual exclusion with strategyId, non-empty brief, and guest block", async (t) => {
  const f = await buildBriefTestHarness(t);

  // Cross-tenant briefId access -> 404
  const crossTenantRes = await f.postAsk({ briefId: f.groundedId }, f.ownerB);
  assert.equal(crossTenantRes.status, 404);
  assert.equal(f.calls.length, 0);

  // Simultaneous strategyId and briefId -> 400
  const conflictPayloadRes = await f.postAsk({ strategyId: f.normalId, briefId: f.groundedId });
  assert.equal(conflictPayloadRes.status, 400);
  assert.equal(f.calls.length, 0);

  // Empty brief record -> 404
  const emptyBriefRes = await f.postAsk({ briefId: f.emptyBriefId });
  assert.equal(emptyBriefRes.status, 404);
  assert.equal(f.calls.length, 0);

  // Guest using briefId -> 401 with strategy restriction notice
  const guestRes = await f.postAsk({ briefId: f.groundedId }, "guest");
  assert.equal(guestRes.status, 401);
  const guestJson = await guestRes.json();
  assert.equal(guestJson.error, GUEST_RESTRICTION_NOTICES.strategy);
  assert.equal(f.calls.length, 0);

  // Switching from briefId chat to strategyId on same chatId -> 400
  const createdBriefChat = await (await f.postAsk({ briefId: f.groundedId })).json();
  const mixChatRes = await f.postAsk({
    chatId: createdBriefChat.chat.id,
    strategyId: f.normalId,
    messages: [{ role: "user", content: "Strategiyaya keç" }],
  });
  assert.equal(mixChatRes.status, 400);
});

test("briefId works securely in capability (@word) and Deep Research routes", async (t) => {
  const f = await buildBriefTestHarness(t);

  // 1. @word capability route passes strictly { brief } and never leaks strategy/title
  const wordRes = await f.postAsk({
    briefId: f.groundedId,
    messages: [{ role: "user", content: "@word bu brif üzrə plan hazırla" }],
  });
  assert.equal(wordRes.status, 200);
  assert.equal(f.artifactCalls.length, 1);
  const sourceCtx = f.artifactCalls[0].workflow.sourceContext;
  assert.match(sourceCtx, /15,000 AZN/);
  assert.doesNotMatch(sourceCtx, /SECRET_GROUNDED_STRATEGY_DO_NOT_LEAK/);
  assert.doesNotMatch(sourceCtx, /SECRET_GROUNDED_TITLE/);

  // 2. Research schema rejects combined strategyId + briefId
  assert.equal(
    CreateResearchJobSchema.safeParse({
      prompt: "Bazar araşdırması",
      strategyId: f.normalId,
      briefId: f.groundedId,
    }).success,
    false
  );

  // 3. Research route accepts briefId for grounded strategy and strips all strategy content
  const resJob = await f.postResearch({
    prompt: "Azərbaycanda bazar həcmini araşdır",
    briefId: f.groundedId,
  });
  assert.equal(resJob.status, 202);
  const resJobJson = await resJob.json();
  assert.ok(resJobJson.jobId);
  assert.ok(resJobJson.chatId);

  await f.researchService.waitForAllJobs();
  assert.equal(f.capturedResearchJobs.length, 1);
  assert.equal(f.capturedResearchJobs[0].briefId, f.groundedId);
  assert.equal(f.capturedResearchJobs[0].strategyId, null);
  assert.match(f.capturedResearchJobs[0].strategyContext, /15,000 AZN/);
  assert.doesNotMatch(f.capturedResearchJobs[0].strategyContext, /SECRET_GROUNDED_STRATEGY_DO_NOT_LEAK/);
  assert.doesNotMatch(f.capturedResearchJobs[0].strategyContext, /SECRET_GROUNDED_TITLE/);

  const persistedChat = await f.chatRepository.getById(resJobJson.chatId, f.ownerA);
  assert.equal(persistedChat.briefId, f.groundedId);
  assert.equal(persistedChat.strategyId, null);
  assert.ok(persistedChat.messages[0].briefTitle);
  assert.doesNotMatch(persistedChat.messages[0].briefTitle, /SECRET_GROUNDED_TITLE/);
});

test("Client script, i18n, and style support Briefs context selection and grounded fallback", async () => {
  const [scriptText, i18nText, styleText] = await Promise.all([
    fs.readFile(path.join(process.cwd(), "public/script.js"), "utf8"),
    fs.readFile(path.join(process.cwd(), "public/i18n.js"), "utf8"),
    fs.readFile(path.join(process.cwd(), "public/style.css"), "utf8"),
  ]);

  assert.ok(scriptText.includes("askBriefId"));
  assert.ok(scriptText.includes("function resetAskForBrief(briefId"));
  assert.ok(scriptText.includes("function isActiveStrategyCopilotGrounded()"));
  assert.ok(scriptText.includes("briefId: state.askBriefId || undefined"));
  assert.ok(scriptText.includes("errData.code === \"GROUNDED_STRATEGY_RESTRICTED\""));
  assert.ok(scriptText.includes("node.strategy && typeof node.strategy === \"object\""));
  assert.ok(!scriptText.includes("ask-context-tabs"));
  assert.ok(!scriptText.includes("mobile-sheet-sub-tabs"));
  assert.ok(scriptText.includes("ASK_BRIEF_STAGES_AZ"));
  assert.ok(scriptText.includes("ASK_BRIEF_STAGES_EN"));
  assert.ok(scriptText.includes("ASK_STRATEGY_STAGES_AZ"));
  assert.ok(scriptText.includes("ASK_STRATEGY_STAGES_EN"));
  assert.ok(scriptText.includes("strategyContextWait"));
  assert.ok(scriptText.includes("function startAskBriefStages(message)"));
  assert.ok(scriptText.includes("function usesAskSearchAnimation(message)"));

  assert.ok(i18nText.includes("groundedBriefToast"));
  assert.ok(i18nText.includes("briefAnalyzePrompt"));

  assert.ok(styleText.includes(".ask-context-item.is-grounded-strategy"));
  assert.ok(styleText.includes(".mobile-sheet-sub-item.is-grounded-strategy"));
});
