import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import express from "express";
import { fileURLToPath } from "node:url";

import {
  ResearchService,
  buildResearchPrompt,
  enrichSourcesFromText,
  decomposeResearchTopic,
  analyzeResearchGaps,
  isLowQualityDomain,
  isHighSignalDomain,
  scoreDomain,
  CreateResearchJobSchema,
} from "../src/services/ai/research-service.js";
import { createResearchRouter } from "../src/http/research-router.js";
import { FileChatRepository } from "../src/repositories/file-chat-repository.js";
import { askRequestSchema } from "../src/http/capability-router.js";
import { createPluginRegistry } from "../src/services/plugins/registry.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

async function safeRmDir(dirPath, maxRetries = 10, delayMs = 50) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      await fs.rm(dirPath, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
      return;
    } catch (err) {
      if ((err.code === "ENOTEMPTY" || err.code === "EBUSY") && attempt < maxRetries - 1) {
        await new Promise((r) => setTimeout(r, delayMs));
        continue;
      }
      throw err;
    }
  }
}

test("1. UI/UX: Deep Research removed from @ menu and exposed as dedicated /deep-research page & sidebar item without model names", async () => {
  const scriptContent = await fs.readFile(path.join(rootDir, "public/script.js"), "utf8");
  const styleContent = await fs.readFile(path.join(rootDir, "public/style.css"), "utf8");
  const artifactsContent = await fs.readFile(path.join(rootDir, "public/artifacts.js"), "utf8");
  const capabilityRouterContent = await fs.readFile(path.join(rootDir, "src/http/capability-router.js"), "utf8");

  // Verify switcher is removed from composer leading in script.js
  assert.doesNotMatch(scriptContent, /composerLeading\.append\([^)]*modeSwitcher/, "modeSwitcher must be removed from composerLeading");
  assert.doesNotMatch(scriptContent, /const modeSwitcher = element\("div", "ask-mode-switcher"\)/, "modeSwitcher DOM element must not be created");

  // Verify Deep Research is registered in createPluginRegistry (for backend compatibility) without exposing model names
  const registry = createPluginRegistry();
  const deepResearchPlugin = registry.get("deep-research");
  assert.ok(deepResearchPlugin, "deep-research plugin must be registered");
  assert.equal(deepResearchPlugin.name, "Deep Research");
  assert.equal(deepResearchPlugin.icon, "research");
  assert.ok(deepResearchPlugin.capabilities.includes("deep_research"), "Must have deep_research capability");
  assert.ok(deepResearchPlugin.capabilities.includes("web_research"), "Must have web_research capability");

  // Verify alias 'research' resolves to 'deep-research'
  const aliasedPlugin = registry.get("research");
  assert.equal(aliasedPlugin?.id, "deep-research", "Alias 'research' must resolve to deep-research");

  // Strictly verify that plugin metadata does NOT contain model names (Gemini, Flash, High, GPT, Claude, etc.)
  assert.doesNotMatch(deepResearchPlugin.name, /gemini|flash|high|gpt|claude/i, "Plugin name must not reveal model names");
  assert.doesNotMatch(deepResearchPlugin.description, /gemini|flash|high|gpt|claude/i, "Plugin description must not reveal model names");
  assert.doesNotMatch(deepResearchPlugin.descriptionEn, /gemini|flash|high|gpt|claude/i, "Plugin descriptionEn must not reveal model names");

  // Verify @ composer menu excludes deep-research in both capability-router GET /plugins and public/artifacts.js
  assert.match(capabilityRouterContent, /router\.get\("\/plugins"[\s\S]*plugin\.id\s*!==\s*"deep-research"/, "GET /api/ask/plugins must exclude deep-research");
  assert.match(artifactsContent, /isComposerPluginVisible[\s\S]*plugin\.id\s*!==\s*"deep-research"/, "public/artifacts.js must filter deep-research out of @ composer");

  // Verify dedicated Deep Research surface & route trigger deep research instead of @ mentions
  assert.match(scriptContent, /const DEEP_RESEARCH_ROUTE_PATH\s*=\s*"\/deep-research"/, "Dedicated /deep-research route constant must be defined");
  assert.match(scriptContent, /const isDeepResearch = Boolean\(conv\.isDeepResearch \|\| forceResearch\)/, "submitAskMessage must run deep research for dedicated Deep Research surface");
  assert.doesNotMatch(scriptContent, /\@\s*\(deep-research\|research\)/, "Ask composer @mention regex for deep research must be removed");

  // Verify CSS contains classes for pulsing indicator, deep research intro, and card, while switcher is removed
  assert.doesNotMatch(styleContent, /\.ask-mode-switcher\s*\{/, "Old switcher CSS must be removed");
  assert.match(styleContent, /\.ask-research-pulsing-indicator/, "CSS must style pulsing indicator");
  assert.match(styleContent, /\.deep-research-intro-icon/, "CSS must style Deep Research intro icon");
  assert.match(styleContent, /@keyframes ask-research-pulse/, "CSS must define calming pulse animation");
});

test("2. Backend Model Routing & Web Search Grounding: ResearchService enforces Gemini 3.8 Flash High & Google Search", async () => {
  let capturedModel = null;
  let capturedConfig = null;
  let capturedContents = null;

  const mockGeminiClient = {
    models: {
      generateContent: async (args) => {
        capturedModel = args.model;
        capturedConfig = args.config;
        capturedContents = args.contents;
        return {
          text: "## Executive Summary\nStrategic findings based on live web search.\n\n## Key Findings\n1. Market trends.\n\n## Sources\n[1] TechCrunch: https://techcrunch.com/article",
          candidates: [
            {
              groundingMetadata: {
                groundingChunks: [
                  { web: { uri: "https://techcrunch.com/article", title: "TechCrunch Article" } },
                  { web: { uri: "javascript:evil()", title: "XSS Attempt" } },
                ],
              },
            },
          ],
        };
      },
    },
  };

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "helmer-research-test-"));
  const chatRepo = new FileChatRepository(path.join(tempDir, "chats.json"));
  const researchService = new ResearchService({
    chatRepository: chatRepo,
    geminiClient: mockGeminiClient,
  });

  const ownerId = `usr_${randomUUID()}`;
  const job = await researchService.createResearchJob({
    ownerId,
    prompt: "Global renewable energy trends 2026",
    language: "en",
  });

  assert.equal(job.jobId ? true : false, true, "Job ID must be generated");

  // Wait for background execution to complete
  const maxWait = 2500;
  const start = Date.now();
  let completedJob = null;
  while (Date.now() - start < maxWait) {
    completedJob = await researchService.getJob(job.jobId, ownerId);
    if (completedJob && (completedJob.status === "completed" || completedJob.status === "failed")) {
      break;
    }
    await new Promise((r) => setTimeout(r, 50));
  }

  assert.ok(completedJob, "Completed job should be retrievable");
  assert.equal(completedJob.status, "completed", "Job should finish with completed status");
  assert.equal(capturedModel, "gemini-3.8-flash", "Must route to gemini-3.8-flash");
  assert.deepEqual(capturedConfig.tools, [{ googleSearch: {} }], "Must enforce Google Search tool");
  assert.ok(capturedConfig.thinkingConfig, "Must have thinkingConfig for reasoning");
  assert.ok(capturedConfig.thinkingConfig.thinkingBudget > 0, "Thinking budget must be configured");

  // Verify sources sanitization: XSS uri removed, https retained
  assert.ok(completedJob.sources.length >= 1, "Must contain grounded sources");
  assert.equal(completedJob.sources[0].url, "https://techcrunch.com/article");
  assert.equal(completedJob.sources[0].domain, "techcrunch.com");
  assert.ok(!completedJob.sources.some((s) => s.url.startsWith("javascript:")), "Malicious URL schemes must be purged");

  // Cleanup
  await researchService.waitForAllJobs();
  await safeRmDir(tempDir);
});

test("3. Data Schema & Persistence: Chat repository stores research message with steps and sources", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "helmer-research-test-2-"));
  const chatRepo = new FileChatRepository(path.join(tempDir, "chats.json"));
  const ownerId = `usr_${randomUUID()}`;

  const mockGeminiClient = {
    models: {
      generateContent: async () => ({
        text: "## Summary\nValidated content.\n\n## Sources\n[1] Forbes: https://forbes.com/item",
        candidates: [
          {
            groundingMetadata: {
              groundingChunks: [
                { web: { uri: "https://forbes.com/item", title: "Forbes Item" } },
              ],
            },
          },
        ],
      }),
    },
  };

  const researchService = new ResearchService({
    chatRepository: chatRepo,
    geminiClient: mockGeminiClient,
  });

  const job = await researchService.createResearchJob({
    ownerId,
    prompt: "Azerbaijan startup ecosystem growth",
    language: "az",
  });

  // Wait for completion and persistence
  let savedChat = null;
  const start = Date.now();
  while (Date.now() - start < 5000) {
    const current = await researchService.getJob(job.jobId, ownerId);
    if (current && current.status === "completed") {
      savedChat = await chatRepo.getById(job.chatId, ownerId);
      if (savedChat?.messages?.[1]?.status === "completed") break;
    }
    await new Promise((r) => setTimeout(r, 50));
  }

  // Verify chat is saved in FileChatRepository
  if (!savedChat) {
    savedChat = await chatRepo.getById(job.chatId, ownerId);
  }
  assert.ok(savedChat, "Chat must be persisted in repository");
  assert.equal(savedChat.messages.length, 2, "Chat should contain user and assistant messages");

  const assistantMsg = savedChat.messages[1];
  assert.equal(assistantMsg.role, "assistant");
  assert.equal(assistantMsg.type, "research");
  assert.equal(assistantMsg.status, "completed");
  assert.ok(assistantMsg.jobId, "Assistant message must store jobId");
  assert.ok(Array.isArray(assistantMsg.steps), "Steps array must be persisted");
  assert.ok(Array.isArray(assistantMsg.sources), "Sources array must be persisted");
  assert.equal(assistantMsg.sources[0].domain, "forbes.com");

  // Verify that askRequestSchema in capability-router accepts this stored chat structure on follow-up questions
  const followUpPayload = {
    chatId: savedChat.id,
    messages: [
      ...savedChat.messages,
      { role: "user", content: "Tell me more about the second point" },
    ],
    mode: "research",
  };

  const parseResult = askRequestSchema.safeParse(followUpPayload);
  assert.ok(parseResult.success, "askRequestSchema must strictly validate stored research message schema without error: " + JSON.stringify(parseResult.error?.errors));

  // Cleanup
  await researchService.waitForAllJobs();
  await safeRmDir(tempDir);
});

test("4. Security & Tenant Isolation: IDOR protection and UUID validation", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "helmer-research-test-3-"));
  const chatRepo = new FileChatRepository(path.join(tempDir, "chats.json"));
  const researchService = new ResearchService({ chatRepository: chatRepo });

  const ownerA = `usr_${randomUUID()}`;
  const ownerB = `usr_${randomUUID()}`;

  const job = await researchService.createResearchJob({
    ownerId: ownerA,
    prompt: "Private corporate strategy",
  });

  // Owner A can access
  const jobForA = await researchService.getJob(job.jobId, ownerA);
  assert.ok(jobForA, "Owner A should access their own job");

  // Owner B cannot access (Tenant Isolation)
  const jobForB = await researchService.getJob(job.jobId, ownerB);
  assert.equal(jobForB, null, "Owner B must not be able to access Owner A's job");

  // Non-UUID jobId returns null
  assert.equal(await researchService.getJob("../etc/passwd", ownerA), null, "Non-UUID jobId must be rejected");

  // Cancellation IDOR
  const cancelByB = await researchService.cancelJob(job.jobId, ownerB);
  assert.equal(cancelByB, false, "Owner B cannot cancel Owner A's job");

  // Cancellation by Owner A
  const cancelByA = await researchService.cancelJob(job.jobId, ownerA);
  assert.equal(cancelByA, true, "Owner A can cancel their own job");

  await new Promise((r) => setTimeout(r, 100));

  // Cleanup
  await researchService.waitForAllJobs();
  await safeRmDir(tempDir);
});

test("5. HTTP Router & SSE Streaming: POST /api/ask/research and GET /jobs/:jobId/stream", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "helmer-research-test-4-"));
  const chatRepo = new FileChatRepository(path.join(tempDir, "chats.json"));

  let resolveGenerate;
  const generatePromise = new Promise((resolve) => {
    resolveGenerate = resolve;
  });

  const mockGeminiClient = {
    models: {
      generateContent: async () => generatePromise,
    },
  };

  const researchService = new ResearchService({
    chatRepository: chatRepo,
    geminiClient: mockGeminiClient,
  });

  const app = express();
  app.use(express.json());

  const testOwner = `usr_${randomUUID()}`;
  app.use((req, _res, next) => {
    req.ownerId = testOwner;
    req.user = { id: testOwner, emailVerifiedAt: new Date().toISOString(), settings: { language: "en" } }; req.auth = { user: req.user };
    next();
  });

  const router = createResearchRouter({
    researchService,
    chatRepository: chatRepo,
  });
  app.use("/api/ask/research", router);

  const server = app.listen(0);
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}/api/ask/research`;

  const streamController = new AbortController();

  try {
    // 1. Create job
    const createRes = await fetch(`${baseUrl}/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "AI development trends 2026" }),
    });

    assert.equal(createRes.status, 202, "Job creation returns 202 Accepted");
    const createData = await createRes.json();
    assert.ok(createData.jobId, "Response must include jobId");
    assert.equal(createData.status, "pending");

    // 2. Poll job status
    const statusRes = await fetch(`${baseUrl}/jobs/${createData.jobId}`);
    assert.equal(statusRes.status, 200);
    const statusData = await statusRes.json();
    assert.equal(statusData.id || statusData.job?.id, createData.jobId);

    // 3. Connect to SSE stream
    const streamRes = await fetch(`${baseUrl}/jobs/${createData.jobId}/stream`, {
      headers: { Accept: "text/event-stream" },
      signal: streamController.signal,
    });
    assert.equal(streamRes.status, 200);
    assert.ok(streamRes.headers.get("content-type").includes("text/event-stream"));

    // Pre-resolve AI generation completion so it's ready when background worker enters search stage
    resolveGenerate({
      text: "## Deep Research Report\nComprehensive findings.\n\n## Sources\n[1] BBC: https://bbc.com/news",
      candidates: [{ groundingMetadata: { groundingChunks: [{ web: { uri: "https://bbc.com/news", title: "BBC News" } }] } }],
    });

    // Read SSE stream chunks
    const reader = streamRes.body.getReader();
    const decoder = new TextDecoder();
    let streamText = "";
    const start = Date.now();

    while (Date.now() - start < 3500) {
      const { done, value } = await reader.read();
      if (done) break;
      streamText += decoder.decode(value, { stream: true });
      if (streamText.includes('"type":"done"')) break;
    }

    assert.ok(streamText.includes('"type":"snapshot"'), "SSE must stream snapshot event");
    assert.ok(streamText.includes('"type":"done"'), "SSE must stream done event upon completion");

    // Cleanly cancel reader and abort stream connection
    await reader.cancel();
    streamController.abort();

    // Wait for background persistence to finish before removing tempDir
    const waitStart = Date.now();
    while (Date.now() - waitStart < 2000) {
      const current = await researchService.getJob(createData.jobId, testOwner);
      if (current && (current.status === "completed" || current.status === "failed")) break;
      await new Promise((r) => setTimeout(r, 50));
    }
  } finally {
    try { streamController.abort(); } catch {}
    if (server) {
      server.closeAllConnections?.();
      await new Promise((r) => server.close(r));
    }
    await researchService.waitForAllJobs();
    await safeRmDir(tempDir);
  }
});

test("6. Multi-Step Pipeline: Topic decomposition breaks inquiry into 3-4 concrete sub-queries with real dynamic labels", async () => {
  const azPrompt = "Google vs Anthropic süni intellekt infrastruktur xərcləri 2026";
  const azSubqueries = await decomposeResearchTopic({
    prompt: azPrompt,
    language: "az",
  });

  assert.ok(Array.isArray(azSubqueries), "Must return array of subqueries");
  assert.ok(azSubqueries.length >= 3 && azSubqueries.length <= 4, "Must decompose into 3-4 subqueries");
  azSubqueries.forEach((sq) => {
    assert.ok(sq.query && sq.query.length > 5, "Subquery must have search keywords: " + JSON.stringify(sq));
    assert.ok(sq.label && sq.label.length > 5, "Subquery must have human-readable progress label: " + JSON.stringify(sq));
  });

  const enPrompt = "Hyperscaler Capex and custom silicon margins 2026";
  const enSubqueries = await decomposeResearchTopic({
    prompt: enPrompt,
    language: "en",
  });
  assert.ok(enSubqueries.length >= 3 && enSubqueries.length <= 4);
  assert.ok(enSubqueries.some((s) => s.label.includes("…") || s.label.includes("...")));

  // Verify Gap Analysis function
  const gapResult = await analyzeResearchGaps({
    prompt: enPrompt,
    gatheredEvidence: "Initial reports show high investments in AI data centers.",
    language: "en",
  });
  assert.ok(gapResult.hasGap !== undefined, "Gap analysis must return hasGap boolean");
  if (gapResult.hasGap) {
    assert.ok(gapResult.query && gapResult.query.length > 0, "Gap query must be populated");
  }
});

test("7. Source Filtering: Drops SEO spam/clickbait/aggregators and prioritizes high-signal domains (SEC, SemiAnalysis, Reuters)", async () => {
  // Direct domain classification tests
  assert.equal(isLowQualityDomain("quora.com"), true, "Quora is low quality");
  assert.equal(isLowQualityDomain("https://www.quora.com/topic"), true, "Subdomain quora is low quality");
  assert.equal(isLowQualityDomain("buzzfeed.com"), true, "Buzzfeed is low quality");
  assert.equal(isLowQualityDomain("reddit.com"), true, "Reddit is low quality");
  assert.equal(isLowQualityDomain("pinterest.com"), true, "Pinterest is low quality");
  assert.equal(isLowQualityDomain("teamazing.com"), true, "teamazing.com must be identified as low quality");
  assert.equal(isLowQualityDomain("https://www.teamazing.com/blog/virtual-ideas"), true, "teamazing.com URLs must be identified as low quality");
  assert.equal(isLowQualityDomain("teambuilding.com"), true, "teambuilding.com must be low quality");
  assert.equal(isLowQualityDomain("john.blogspot.com"), true, "blogspot blog must be low quality");
  assert.equal(isLowQualityDomain("company.wordpress.com"), true, "wordpress blog must be low quality");
  assert.equal(isLowQualityDomain("neilpatel.com"), true, "neilpatel SEO platform must be low quality");
  assert.equal(isLowQualityDomain("hubspot.com"), true, "hubspot SEO content must be low quality");
  assert.equal(isLowQualityDomain("sec.gov"), false, "sec.gov is not low quality");
  assert.equal(isLowQualityDomain("semianalysis.com"), false, "semianalysis is not low quality");

  assert.equal(isHighSignalDomain("sec.gov"), true, "sec.gov is high signal");
  assert.equal(isHighSignalDomain("semianalysis.com"), true, "semianalysis is high signal");
  assert.equal(isHighSignalDomain("reuters.com"), true, "reuters is high signal");
  assert.equal(isHighSignalDomain("bloomberg.com"), true, "bloomberg is high signal");
  assert.equal(isHighSignalDomain("theinformation.com"), true, "theinformation is high signal");
  assert.equal(isHighSignalDomain("blog.google"), true, "blog.google is high signal");

  // Source list enrichment and ranking test
  const rawSources = [
    { title: "Teamazing Article", url: "https://teamazing.com/virtual-activities", domain: "teamazing.com" },
    { title: "Quora thread", url: "https://quora.com/question-123", domain: "quora.com" },
    { title: "Buzzfeed listicle", url: "https://buzzfeed.com/list", domain: "buzzfeed.com" },
    { title: "Reddit discussion", url: "https://reddit.com/r/technology", domain: "reddit.com" },
    { title: "TechCrunch news", url: "https://techcrunch.com/2026/01/ai-capex", domain: "techcrunch.com" },
    { title: "SemiAnalysis Hardware Deep Dive", url: "https://semianalysis.com/ai-tpu-margins", domain: "semianalysis.com" },
    { title: "SEC Form 10-K Alphabet", url: "https://sec.gov/edgar/data/1652044/alphabet-10k.htm", domain: "sec.gov" },
  ];

  const filtered = enrichSourcesFromText(rawSources, "");
  const domains = filtered.map((s) => s.domain);

  // Assert low quality domains are eliminated
  assert.ok(!domains.includes("teamazing.com"), "teamazing.com must be purged");
  assert.ok(!domains.includes("quora.com"), "Quora must be purged");
  assert.ok(!domains.includes("buzzfeed.com"), "Buzzfeed must be purged");
  assert.ok(!domains.includes("reddit.com"), "Reddit must be purged");

  // Assert high signal domains are preserved and ranked at the top
  assert.ok(domains.includes("sec.gov"), "SEC must be preserved");
  assert.ok(domains.includes("semianalysis.com"), "SemiAnalysis must be preserved");
  assert.ok(domains.includes("techcrunch.com"), "TechCrunch must be preserved");

  assert.equal(filtered[0].isHighSignal, true, "First source must be high-signal");
  assert.equal(filtered[1].isHighSignal, true, "Second source must be high-signal");
  assert.equal(filtered[0].score, 10, "High signal score should be 10");
});

test("8. System Prompt & Deep Thinking: Enforces concrete numbers, margin comparisons, trade-off analysis, complete execution mandate, and bans filler", () => {
  // Azerbaijani prompt check
  const azPrompt = buildResearchPrompt({
    prompt: "Google TPU v5p vs Nvidia H100 xərcləri",
    language: "az",
    strategyContext: "",
    taskContext: "",
    gatheredEvidence: "Sub-query findings on Capex and FLOPs.",
  });

  assert.match(azPrompt.systemInstruction, /TAM İCRA VƏ BÜTÖV HESABAT TƏLƏBİ/s, "Must require full execution mandate in AZ");
  assert.match(azPrompt.systemInstruction, /bütün tələbləri.*tam.*cavablandır/i, "Must demand full answer to all points in AZ");
  assert.match(azPrompt.systemInstruction, /növbəti hissəyə hazıram.*QƏTİ QADAĞANDIR/s, "Must strictly ban conversational halting phrases in AZ");
  assert.match(azPrompt.systemInstruction, /10 bölməni strukturlaşdırılmış Markdown başlığı/s, "Must demand rendering all 10 sections with Markdown headings in AZ");
  assert.match(azPrompt.systemInstruction, /teamazing\.com/, "Must ban teamazing in AZ prompt");
  assert.match(azPrompt.userContent, /növbəti hissəyə hazıram.*qəti qadağandır/i, "Must enforce complete execution in userContent AZ");

  assert.match(azPrompt.systemInstruction, /Ümumi dərslik təriflərindən.*QƏTİ QAÇ/s, "Must ban generic textbook definitions in AZ");
  assert.match(azPrompt.systemInstruction, /MÜTLƏQ konkret rəqəmlər, faizlər, CapEx/s, "Must mandate concrete figures and margins in AZ");
  assert.match(azPrompt.systemInstruction, /Ziddiyyətli arqumentləri.*müqayisə et/s, "Must mandate contrasting arguments in AZ");
  assert.match(azPrompt.systemInstruction, /TPU.*GPU/s, "Must highlight silicon and GPU trade-off analysis in AZ");
  assert.match(azPrompt.systemInstruction, /SemiAnalysis|SEC|Reuters|Bloomberg/, "Must cite premier high-signal references");
  assert.match(azPrompt.userContent, /Sub-query findings on Capex and FLOPs/, "Must pass gathered multi-step evidence to final synthesis");

  // English prompt check
  const enPrompt = buildResearchPrompt({
    prompt: "Hyperscaler Capex and custom silicon efficiency",
    language: "en",
    strategyContext: "",
    taskContext: "",
    gatheredEvidence: "Data points on Trainium and TPU efficiency.",
  });

  assert.match(enPrompt.systemInstruction, /FULL EXECUTION & COMPLETE DOSSIER MANDATE/i, "Must require full dossier in EN");
  assert.match(enPrompt.systemInstruction, /ready for the next part.*STRICTLY FORBIDDEN/s, "Must ban halting in EN");
  assert.match(enPrompt.systemInstruction, /teamazing\.com/, "Must ban teamazing in EN prompt");
  assert.match(enPrompt.systemInstruction, /STRICT BAN ON TEXTBOOK DEFINITIONS/i, "Must ban textbook definitions in EN");
  assert.match(enPrompt.systemInstruction, /MANDATORY CONCRETE NUMBERS, MARGINS & BENCHMARKS/i, "Must mandate concrete figures in EN");
  assert.match(enPrompt.systemInstruction, /CONTRADICTORY ARGUMENTS & STRUCTURAL TRADE-OFFS/i, "Must mandate contrasting arguments in EN");
  assert.match(enPrompt.userContent, /Data points on Trainium and TPU efficiency/, "Must pass gathered evidence to synthesis");
});

test("9. Mobile Ask Context Sheet: Deep Research option navigates to /deep-research page", async () => {
  const scriptContent = await fs.readFile(path.join(rootDir, "public/script.js"), "utf8");

  // Verify onDeepResearch handler navigates to dedicated Deep Research page
  assert.match(scriptContent, /onDeepResearch:\s*\(\)\s*=>\s*\{[\s\S]*?navigateToDeepResearch\(/, "onDeepResearch must navigate to Deep Research page");
  assert.match(scriptContent, /researchRow\.append\(researchLeading,\s*element\("span",\s*"mobile-sheet-row-trailing",\s*"›"\)\)/, "Mobile sheet must display Deep Research row in Ask mode");
});

test("10. Source Accordion UI & Trailing Link Sanitization: Sources grouped into collapsible accordion, raw link dumps stripped", async () => {
  const scriptContent = await fs.readFile(path.join(rootDir, "public/script.js"), "utf8");
  const styleContent = await fs.readFile(path.join(rootDir, "public/style.css"), "utf8");

  // Verify renderResearchSourcesList creates a collapsible accordion (<details> with <summary>)
  assert.match(scriptContent, /ask-research-sources-accordion/, "Must assign accordion class to sources card");
  assert.match(scriptContent, /ask-research-sources-summary/, "Must create summary element for accordion");
  assert.match(scriptContent, /ask-research-sources-count-pill/, "Must show source count pill in summary");
  assert.match(scriptContent, /ask-research-sources-chevron/, "Must include chevron for expand/collapse");

  // Verify trailing link dump is sanitized from markdown report content
  assert.match(scriptContent, /displayContent\.replace\([\s\S]*?Mənbələr\|İstinadlar\|Mənbə\|Sources\|Citations\|References/, "Must strip trailing raw sources link dump from markdown body");

  // Verify CSS styles for accordion, summary, count-pill, chevron rotation, and dark mode
  assert.match(styleContent, /\.ask-research-sources-card\.ask-research-sources-accordion/, "Must style accordion container");
  assert.match(styleContent, /\.ask-research-sources-summary\s*\{/, "Must style summary interactive header");
  assert.match(styleContent, /\.ask-research-sources-accordion\[open\]\s*\.ask-research-sources-chevron\s*\{\s*transform:\s*rotate\(180deg\)/, "Must rotate chevron when open");
  assert.match(styleContent, /\[data-theme="dark"\]\s*\.ask-research-sources-summary/, "Must support dark theme for accordion");
});

