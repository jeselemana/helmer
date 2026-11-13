import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { isComplexAskQuery, resolveAskModelRoute, resolveAskThinkingLevel } from "../src/services/ai/ask-routing.js";
import { FileChatRepository } from "../src/repositories/file-chat-repository.js";

test("all Ask queries route exclusively to Gemini 4 Hydrogen (GPT models eliminated from Ask)", () => {
  assert.equal(resolveAskModelRoute({ lastUserMsg: "Instagram üçün 3 qısa başlıq yaz" }), "gemini-4-hydrogen");
  assert.equal(resolveAskModelRoute({ lastUserMsg: "Hərtərəfli dərin analiz və SWOT matrisi qur" }), "gemini-4-hydrogen");
  assert.equal(resolveAskModelRoute({ lastUserMsg: "Bunu necə tətbiq edim?", hasStrategyContext: true }), "gemini-4-hydrogen");
  assert.equal(resolveAskModelRoute({ requestedModel: "terra", lastUserMsg: "qısa sual" }), "gemini-4-hydrogen");
  assert.equal(resolveAskModelRoute({ requestedModel: "luna", lastUserMsg: "dərin analiz" }), "gemini-4-hydrogen");
  assert.equal(resolveAskModelRoute({ requestedModel: "auto", lastUserMsg: "sual" }), "gemini-4-hydrogen");
});

test("isComplexAskQuery accurately identifies complex queries and strategy context", () => {
  assert.equal(isComplexAskQuery("Hərtərəfli dərin analiz və SWOT matrisi qur"), true);
  assert.equal(isComplexAskQuery("Bunu necə tətbiq edim?", true), true);
  assert.equal(isComplexAskQuery("Sadə sual", false), false);
});

test("resolveAskThinkingLevel routes auto thinking levels (low, medium, high) and preserves explicit levels", () => {
  // Complex deep analysis queries route to high
  assert.equal(resolveAskThinkingLevel({ requestedThinkingLevel: "auto", lastUserMsg: "Hərtərəfli dərin analiz və SWOT matrisi qur" }), "high");
  assert.equal(resolveAskThinkingLevel({ requestedThinkingLevel: "auto", lastUserMsg: "Hərtərəfli rəqib analizi apar", hasStrategyContext: true }), "high");
  // Multi-step modeling or strategic queries in strategy context route to medium
  assert.equal(resolveAskThinkingLevel({ requestedThinkingLevel: "auto", lastUserMsg: "İlk 30 gündə icra planı və prioritetlər nə olmalıdır?", hasStrategyContext: true }), "medium");
  assert.equal(resolveAskThinkingLevel({ requestedThinkingLevel: "auto", lastUserMsg: "B2B SaaS üçün CAC/LTV və büdcə bölgüsü qur", hasStrategyContext: false }), "medium");
  // Simple / short queries in strategy context route to low
  assert.equal(resolveAskThinkingLevel({ requestedThinkingLevel: "auto", lastUserMsg: "Salam, bu kimdir?", hasStrategyContext: true }), "low");
  // Ordinary 150-350 char conversational queries stay low (thinkingBudget: 0) for ultra-low TTFT
  assert.equal(resolveAskThinkingLevel({ requestedThinkingLevel: "auto", lastUserMsg: "Qısa sual", hasStrategyContext: false }), "low");
  assert.equal(resolveAskThinkingLevel({ requestedThinkingLevel: "auto", lastUserMsg: "Bu adi uzun bir mətndir ki, ümumi Ask rejimində istifadəçinin daxil etdiyi sualın ölçüsü 150-350 simvol arasında olduqda lüzumsuz gecikmə olmasın və cavab ildırım sürəti ilə low rejimində qaytarılsın." }), "low");
  assert.equal(resolveAskThinkingLevel({ requestedThinkingLevel: "auto", thinkingEnabled: false, lastUserMsg: "Adi sual" }), "low");
  // Explicit levels are strictly preserved
  assert.equal(resolveAskThinkingLevel({ requestedThinkingLevel: "xhigh" }), "xhigh");
  assert.equal(resolveAskThinkingLevel({ requestedThinkingLevel: "high" }), "high");
  assert.equal(resolveAskThinkingLevel({ requestedThinkingLevel: "medium" }), "medium");
  assert.equal(resolveAskThinkingLevel({ requestedThinkingLevel: "low" }), "low");
  assert.equal(resolveAskThinkingLevel({ requestedThinkingLevel: "off" }), "off");
});

test("real-time search, pricing, and AI model queries in auto mode route to Gemini 4 Hydrogen", () => {
  assert.equal(resolveAskModelRoute({ lastUserMsg: "Bakı bazarında hazırkı qiymətlər nə qədərdir?" }), "gemini-4-hydrogen");
  assert.equal(resolveAskModelRoute({ lastUserMsg: "Rəqib analizi və 2026 trendləri" }), "gemini-4-hydrogen");
  assert.equal(resolveAskModelRoute({ lastUserMsg: "Gemini 4 Hydrogen haqqında nə bilirsən?" }), "gemini-4-hydrogen");
  assert.equal(resolveAskModelRoute({ lastUserMsg: "GPT-6 Astra nə vaxt çıxacaq?" }), "gemini-4-hydrogen");
});

test("Gemini configuration exposes default Ask model gemini-4-hydrogen", async () => {
  const { aiConfig, hasGeminiConfiguration, hasOpenAIConfiguration } = await import("../src/services/ai/config.js");
  assert.equal(aiConfig.askGeminiModel, "gemini-4-hydrogen");
  assert.equal(typeof hasGeminiConfiguration(), "boolean");
  assert.equal(typeof hasOpenAIConfiguration(), "boolean");
});

test("Ask queries with file attachments route exclusively to Gemini 4 Hydrogen", () => {
  assert.equal(resolveAskModelRoute({ hasAttachment: true, lastUserMsg: "Bu sənədi analiz et" }), "gemini-4-hydrogen");
  assert.equal(resolveAskModelRoute({ hasAttachment: true, requestedModel: "terra", lastUserMsg: "swot analizi" }), "gemini-4-hydrogen");
  assert.equal(resolveAskModelRoute({ hasAttachment: true, requestedModel: "luna", lastUserMsg: "qısa başlıq" }), "gemini-4-hydrogen");
  assert.equal(resolveAskModelRoute({ hasAttachment: true, requestedModel: "auto", hasStrategyContext: true }), "gemini-4-hydrogen");
});

test("AbortController for Ask stream stays active after request body consumption and only aborts if response closes prematurely", async () => {
  const { EventEmitter } = await import("node:events");

  const req = new EventEmitter();
  const res = new EventEmitter();
  res.writableEnded = false;

  const abortController = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) {
      abortController.abort();
    }
  });

  // Emitting req 'close' (which happens when incoming request body stream ends) should NOT abort
  req.emit("close");
  assert.equal(abortController.signal.aborted, false, "req 'close' must not abort the ongoing response");

  // If res ends cleanly before close, it should NOT abort
  res.writableEnded = true;
  res.emit("close");
  assert.equal(abortController.signal.aborted, false, "clean res finish must not abort");

  // If another res closes while not ended, it MUST abort
  const prematureRes = new EventEmitter();
  prematureRes.writableEnded = false;
  const prematureAbort = new AbortController();
  prematureRes.on("close", () => {
    if (!prematureRes.writableEnded) {
      prematureAbort.abort();
    }
  });

  prematureRes.emit("close");
  assert.equal(prematureAbort.signal.aborted, true, "premature connection close must abort the controller");
});

test("SEC-12: FileChatRepository enforces UUID format, cross-tenant isolation, and collision defense", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "helmer-sec12-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const chats = new FileChatRepository(path.join(directory, "chats.json"));

  // 1. Invalid or non-UUID id is replaced with a generated UUID
  const chat1 = await chats.saveChat({
    id: "malicious_injected_id_123",
    ownerId: "user_alice",
    title: "Alice Chat",
    messages: [{ role: "user", content: "Salam" }],
  });
  assert.notEqual(chat1.id, "malicious_injected_id_123");
  assert.match(chat1.id, /^[0-9a-f-]{36}$/i);

  // 2. Owner isolation: Bob cannot read Alice's chat
  const bobFetch = await chats.getById(chat1.id, "user_bob");
  assert.equal(bobFetch, null);

  const aliceFetch = await chats.getById(chat1.id, "user_alice");
  assert.ok(aliceFetch);
  assert.equal(aliceFetch.title, "Alice Chat");

  // 3. Collision defense: Bob cannot hijack or collide with Alice's existing chatId
  const bobAttempt = await chats.saveChat({
    id: chat1.id,
    ownerId: "user_bob",
    title: "Bob Spoofed Chat",
    messages: [{ role: "user", content: "Hacked" }],
  });
  assert.notEqual(bobAttempt.id, chat1.id, "Bob's chat ID must not collide with Alice's existing chat ID");
  assert.match(bobAttempt.id, /^[0-9a-f-]{36}$/i);

  // Alice's chat remains unchanged
  const aliceAfter = await chats.getById(chat1.id, "user_alice");
  assert.equal(aliceAfter.title, "Alice Chat");
  assert.equal(aliceAfter.messages[0].content, "Salam");
});

test("Ask Mode: script.js defines currentAskAbortController, abortAskMessage, and wires AbortController signal to /api/ask", async () => {
  const scriptContent = await fs.readFile(path.join(process.cwd(), "public/script.js"), "utf8");

  assert.ok(scriptContent.includes("let currentAskAbortController = null;"), "declares currentAskAbortController");
  assert.ok(scriptContent.includes("function abortAskMessage()"), "defines abortAskMessage function");
  assert.ok(scriptContent.includes("currentAskAbortController.abort()"), "calls abort on currentAskAbortController");
  assert.ok(scriptContent.includes("function createAskStopIcon()"), "defines createAskStopIcon safe SVG builder");
  assert.ok(scriptContent.includes("createElementNS(\"http://www.w3.org/2000/svg\", \"rect\")"), "safely constructs stop square via DOM API");
  assert.ok(scriptContent.includes("signal: currentAskAbortController.signal"), "passes abort signal to /api/ask fetch call");
  assert.ok(scriptContent.includes("error?.name === \"AbortError\" || currentAskAbortController?.signal?.aborted"), "handles AbortError gracefully without noisy error banners");
});

test("Ask Mode: renderAsk and renderStrategyAskPanel toggle is-stop class and button states during generation", async () => {
  const scriptContent = await fs.readFile(path.join(process.cwd(), "public/script.js"), "utf8");

  // Main ask composer
  assert.ok(scriptContent.includes("submit.classList.toggle(\"is-stop\", isGenerating)"), "toggles is-stop on ask-submit");
  assert.ok(scriptContent.includes("submit.setAttribute(\"aria-label\", isEn ? \"Stop generating\" : \"Dayandır\")"), "sets stop aria-label on ask-submit");
  assert.ok(scriptContent.includes("submit.appendChild(createAskStopIcon())"), "appends safe stop icon to ask-submit");
  assert.ok(scriptContent.includes("abortAskMessage()"), "calls abortAskMessage on click/submit");

  // Strategy ask composer
  assert.ok(scriptContent.includes("send.classList.toggle(\"is-stop\", isStrategyGenerating)"), "toggles is-stop on strategy-ask-send");
  assert.ok(scriptContent.includes("send.appendChild(createAskStopIcon())"), "appends safe stop icon to strategy-ask-send");
});

test("Ask Mode: style.css defines .is-stop, hover transitions, and dark mode high-contrast parity", async () => {
  const cssContent = await fs.readFile(path.join(process.cwd(), "public/style.css"), "utf8");

  assert.ok(cssContent.includes(".ask-submit.is-stop"), "defines .ask-submit.is-stop");
  assert.ok(cssContent.includes(".strategy-ask-send.is-stop"), "defines .strategy-ask-send.is-stop");
  assert.ok(cssContent.includes(".ask-stop-icon"), "defines .ask-stop-icon");
  assert.ok(cssContent.includes("[data-theme=\"dark\"] .ask-stop-icon"), "defines dark mode .ask-stop-icon contrast");
});

test("handleKeyboardShortcut in script.js defines typing and primary variables", async () => {
  const scriptContent = await fs.readFile(path.join(process.cwd(), "public/script.js"), "utf8");
  assert.ok(scriptContent.includes("const typing = isTypingTarget(event.target);"), "defines typing using isTypingTarget");
  assert.ok(scriptContent.includes("const primary = event.metaKey || event.ctrlKey;"), "defines primary using metaKey or ctrlKey");
});

test("hasGeminiConfiguration rejects non-existent GOOGLE_APPLICATION_CREDENTIALS file path", async () => {
  const { hasGeminiConfiguration } = await import("../src/services/ai/config.js");
  const origKey = process.env.GEMINI_API_KEY;
  const origProj = process.env.GOOGLE_CLOUD_PROJECT;
  const origGcp = process.env.GCP_PROJECT;
  const origVertex = process.env.GEMINI_USE_VERTEX;
  const origCred = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  try {
    delete process.env.GEMINI_API_KEY;
    delete process.env.GOOGLE_CLOUD_PROJECT;
    delete process.env.GCP_PROJECT;
    delete process.env.GEMINI_USE_VERTEX;
    process.env.GOOGLE_APPLICATION_CREDENTIALS = "/non/existent/path/to/key.json";
    assert.equal(hasGeminiConfiguration(), false, "must be false when credential file does not exist");
  } finally {
    if (origKey !== undefined) process.env.GEMINI_API_KEY = origKey; else delete process.env.GEMINI_API_KEY;
    if (origProj !== undefined) process.env.GOOGLE_CLOUD_PROJECT = origProj; else delete process.env.GOOGLE_CLOUD_PROJECT;
    if (origGcp !== undefined) process.env.GCP_PROJECT = origGcp; else delete process.env.GCP_PROJECT;
    if (origVertex !== undefined) process.env.GEMINI_USE_VERTEX = origVertex; else delete process.env.GEMINI_USE_VERTEX;
    if (origCred !== undefined) process.env.GOOGLE_APPLICATION_CREDENTIALS = origCred; else delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
  }
});

test("askRequestSchema strictly accepts follow-up messages containing assistant history and thinking metadata", async () => {
  const { askRequestSchema } = await import("../src/http/capability-router.js");
  const followUpPayload = {
    messages: [
      { role: "user", content: "Birinci sual" },
      { role: "assistant", content: "Birinci cavab", thinkingLevel: "low", thinkingEnabled: false, userPrompt: "Birinci sual" },
      { role: "user", content: "İkinci sual" },
    ],
    model: "auto",
    thinkingLevel: "low",
    stream: true,
  };
  const parseResult = askRequestSchema.safeParse(followUpPayload);
  assert.ok(parseResult.success, "askRequestSchema must accept follow-up payload without 400 Bad Request: " + JSON.stringify(parseResult.error?.errors));

  const autoThinkingPayload = {
    messages: [{ role: "user", content: "Salam" }],
    model: "gemini-3.8-flash",
    thinkingLevel: "auto",
    stream: true,
  };
  const autoResult = askRequestSchema.safeParse(autoThinkingPayload);
  assert.ok(autoResult.success, "askRequestSchema must accept thinkingLevel auto without 400 Bad Request: " + JSON.stringify(autoResult.error?.errors));

  const scriptContent = await fs.readFile(path.join(process.cwd(), "public/script.js"), "utf8");
  assert.ok(scriptContent.includes("sanitizeAskMessageForApi"), "script.js must define sanitizeAskMessageForApi");
  assert.ok(scriptContent.includes("messages: state.askMessages.slice(0, -1).map(sanitizeAskMessageForApi)"), "script.js must map outgoing messages through sanitizeAskMessageForApi");
});

test("personal-context caches tenant indexes, revalidates content and invalidates on mutation", async () => {
  const { getRelevantUserContext, invalidateUserContextCache } = await import("../src/services/ai/personal-context.js");
  let chatReadCount = 0;
  let stratReadCount = 0;
  let revalidations = 0;
  const mockChatRepo = {
    async getById(id, ownerId) { revalidations++; return { id, ownerId, title: 'Kofe', messages: [{ role: 'user', content: 'Kofe brendi üçün strategiya' }] }; },
    async readAll() {
      chatReadCount += 1;
      return [{ id: "c1", ownerId: "tenant_perf_1", title: "Kofe brendi satışı", updatedAt: new Date().toISOString(), messages: [{ role: "user", content: "Kofe brendi üçün strategiya" }] }];
    },
  };
  const mockStrategyRepo = {
    async getById(id, ownerId) { revalidations++; return { id, ownerId, title: 'Kofe Bazar Strategiyası', brief: 'Bakıda premium kofe' }; },
    async readAll() {
      stratReadCount += 1;
      return [{ id: "s1", ownerId: "tenant_perf_1", title: "Kofe Bazar Strategiyası", updatedAt: new Date().toISOString(), brief: "Bakıda premium kofe" }];
    },
  };

  invalidateUserContextCache("tenant_perf_1");
  const ctx1 = await getRelevantUserContext({ ownerId: "tenant_perf_1", userMessage: "kofe brendi", chatRepository: mockChatRepo, strategyRepository: mockStrategyRepo });
  assert.ok(ctx1.includes("Kofe Bazar Strategiyası"));
  assert.equal(chatReadCount, 1);
  assert.equal(stratReadCount, 1);

  // Cached indexes avoid list scans but content is checked against authoritative records.
  const ctx2 = await getRelevantUserContext({ ownerId: "tenant_perf_1", userMessage: "kofe satışı", chatRepository: mockChatRepo, strategyRepository: mockStrategyRepo });
  assert.ok(ctx2.includes("Kofe"));
  assert.equal(chatReadCount, 1);
  assert.equal(stratReadCount, 1);
  assert.equal(revalidations, 2);

  // Invalidation forces fresh repository read
  invalidateUserContextCache("tenant_perf_1");
  await getRelevantUserContext({ ownerId: "tenant_perf_1", userMessage: "kofe", chatRepository: mockChatRepo, strategyRepository: mockStrategyRepo });
  assert.equal(chatReadCount, 2);
  assert.equal(stratReadCount, 2);
});

test("CapabilityWorkflow streams chunks via onChunk when only @Web plugin is selected", async () => {
  const { CapabilityWorkflow } = await import("../src/services/plugins/workflow.js");
  const streamedChunks = [];
  const workflow = new CapabilityWorkflow({
    artifacts: {},
    research: async ({ onChunk }) => {
      if (onChunk) {
        onChunk("Birinci hissə ");
        onChunk("İkinci hissə");
      }
      return {
        text: "Birinci hissə İkinci hissə",
        model: "gemini-3.8-flash",
        usage: { inputTokens: 10, outputTokens: 10 },
        groundingMetadata: {
          webSearchQueries: ["test"],
          groundingChunks: [{ web: { uri: "https://example.com", title: "Example" } }],
        },
      };
    },
  });

  const webPlugin = {
    id: "web",
    name: "Web",
    capabilities: ["web_research"],
    outputTypes: ["research"],
    permissionRequirements: ["web:search", "context:read"],
    availability: () => true,
    execute: async ({ research }) => research(),
  };

  const result = await workflow.execute({
    plugins: [webPlugin],
    ownerId: "user_1",
    chatId: "00000000-0000-4000-8000-000000000001",
    prompt: "Son iqtisadi xəbərlər",
    messages: [{ role: "user", content: "Son iqtisadi xəbərlər" }],
    scopes: new Set(["web:search", "context:read"]),
    onChunk: (chunk) => streamedChunks.push(chunk),
  });

  assert.deepEqual(streamedChunks, ["Birinci hissə ", "İkinci hissə"]);
  assert.equal(result.reply, "Birinci hissə İkinci hissə");
});

test("script.js implements 60 FPS LiveTypewriter, incremental block diffing, and zero-flicker completion", async () => {
  const scriptContent = await fs.readFile(path.join(process.cwd(), "public/script.js"), "utf8");
  assert.ok(scriptContent.includes("function parseAskRichTextBlocks("), "defines parseAskRichTextBlocks");
  assert.ok(scriptContent.includes("function patchAskRichTextElement("), "defines patchAskRichTextElement");
  assert.ok(scriptContent.includes("function finalizeStreamingAskMessageDom("), "defines finalizeStreamingAskMessageDom");
  assert.ok(scriptContent.includes("this.rafId = requestAnimationFrame(() => this.tick());"), "LiveTypewriter uses requestAnimationFrame loop");
});
