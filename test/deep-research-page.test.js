import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import express from "express";
import { createCapabilityRouter } from "../src/http/capability-router.js";
import { createPluginRegistry } from "../src/services/plugins/registry.js";
import { FileChatRepository } from "../src/repositories/file-chat-repository.js";
import { TRANSLATIONS } from "../public/i18n.js";

const rootDir = process.cwd();

async function requestRouter(app, method, urlPath) {
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    const port = server.address().port;
    const response = await fetch(`http://127.0.0.1:${port}${urlPath}`, { method });
    return { status: response.status, body: await response.json() };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("GET /api/ask/plugins excludes deep-research while keeping document and web plugins", async () => {
  const registry = createPluginRegistry();
  const app = express();
  app.use((req, _res, next) => {
    req.user = { id: "user-1", role: "user", emailVerifiedAt: new Date().toISOString() };
    req.auth = { user: req.user };
    req.ownerId = "user-1";
    next();
  });
  app.use("/api/ask", createCapabilityRouter({ registry, workflow: {}, artifacts: {}, chats: {} }));

  const { status, body } = await requestRouter(app, "GET", "/api/ask/plugins");
  assert.equal(status, 200);
  const ids = body.plugins.map((plugin) => plugin.id);
  assert.ok(!ids.includes("deep-research"), "deep-research must not appear in @ mention plugins endpoint");
  assert.ok(ids.includes("web"));
  assert.ok(ids.includes("word"));
  assert.ok(ids.includes("excel"));
  assert.ok(ids.includes("powerpoint"));
  assert.ok(ids.includes("pdf"));
});

test("public/artifacts.js attachComposer filters deep-research out of @ autocomplete popup", async () => {
  const source = await fs.readFile(path.join(rootDir, "public/artifacts.js"), "utf8");
  const windowObj = {};
  const makeNode = (tag) => ({
    tagName: tag,
    id: "",
    className: "",
    textContent: "",
    children: [],
    hidden: false,
    disabled: false,
    style: {},
    attributes: {},
    classList: { toggle() {}, add() {}, remove() {} },
    append(...nodes) { this.children.push(...nodes); },
    appendChild(node) { this.children.push(node); return node; },
    replaceChildren(...nodes) { this.children = [...nodes]; },
    setAttribute(k, v) { this.attributes[k] = v; },
    removeAttribute(k) { delete this.attributes[k]; },
    getAttribute(k) { return this.attributes[k] || null; },
    addEventListener() {},
    remove() {},
    prepend(node) { this.children.unshift(node); },
    contains() { return false; },
    closest() { return null; },
    dispatchEvent() {},
    scrollIntoView() {},
  });
  const documentStub = {
    documentElement: { lang: "az" },
    createElement: (tag) => makeNode(tag),
    createElementNS: (_ns, tag) => makeNode(tag),
    addEventListener() {},
    removeEventListener() {},
  };

  let fetchedPlugins = null;
  vm.runInNewContext(source, {
    window: windowObj,
    document: documentStub,
    requestAnimationFrame: (fn) => fn(),
    fetch: async () => ({
      ok: true,
      headers: new Map([["content-type", "application/json"]]),
      json: async () => ({
        plugins: [
          { id: "web", name: "Web Search", icon: "web", description: "Search", capabilities: ["web"] },
          { id: "deep-research", name: "Deep Research", icon: "research", description: "Research", capabilities: ["deep_research"] },
        ],
      }),
    }),
  });

  const inputListeners = {};
  const input = Object.assign(makeNode("textarea"), {
    id: "askInput",
    value: "@",
    selectionStart: 1,
    disabled: false,
    addEventListener(type, fn) { inputListeners[type] = fn; },
    setSelectionRange() {},
    focus() {},
  });
  const body = makeNode("div");
  windowObj.HelmerArtifacts.attachComposer({
    input,
    body,
    getSelection: () => [],
    setSelection: () => {},
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  inputListeners.input?.();
  const popup = body.children.find((node) => node.className === "ask-plugin-selector");
  assert.ok(popup, "Plugin popup should render for @ input");
  const extractText = (node) => typeof node === "string" ? node : [node.textContent || "", ...(node.children || []).map(extractText)].join(" ");
  fetchedPlugins = popup.children.map(extractText);
  assert.equal(popup.children.length, 1, "Only non-deep-research plugins should appear in @ menu");
  assert.ok(fetchedPlugins.join(" ").includes("Web Search"), "Web Search should still appear");
  assert.ok(!fetchedPlugins.join(" ").includes("Deep Research"), "Deep Research must be filtered from @ autocomplete");
});

test("Sidebar and rail HTML include #deepResearchNav and #railDeepResearchButton with matching icon", async () => {
  const html = await fs.readFile(path.join(rootDir, "public/index.html"), "utf8");
  const railIdx = html.indexOf('id="railPlannerButton"');
  const railDeepIdx = html.indexOf('id="railDeepResearchButton"');
  const navIdx = html.indexOf('id="plannerNav"');
  const navDeepIdx = html.indexOf('id="deepResearchNav"');
  const moreIdx = html.indexOf('id="navMoreGroup"');

  assert.ok(railDeepIdx > railIdx, "#railDeepResearchButton must appear after #railPlannerButton");
  assert.ok(navDeepIdx > navIdx && navDeepIdx < moreIdx, "#deepResearchNav must appear in primary nav after #plannerNav");
});

test("i18n.js provides complete AZ and EN translations for Deep Research navigation and page welcome", () => {
  assert.ok(TRANSLATIONS.az.nav.deepResearch, "az.nav.deepResearch defined");
  assert.ok(TRANSLATIONS.en.nav.deepResearch, "en.nav.deepResearch defined");

  for (const key of [
    "badge",
    "welcomeTitle",
    "welcomeSubtitle",
    "placeholder",
    "newResearch",
    "exitThread",
    "historyTitle",
    "historyShowAll",
    "historyShowLess",
    "historyEmpty",
    "statusCompleted",
    "statusRunning",
    "statusFailed",
    "guestRequiredNotice",
    "sendLabel",
  ]) {
    assert.ok(typeof TRANSLATIONS.az.deepResearch[key] === "string" && TRANSLATIONS.az.deepResearch[key].length > 0, `az.deepResearch.${key} non-empty`);
    assert.ok(typeof TRANSLATIONS.en.deepResearch[key] === "string" && TRANSLATIONS.en.deepResearch[key].length > 0, `en.deepResearch.${key} non-empty`);
  }
});

test("script.js wires /deep-research route, exit action, in-page Tarixçə (first 3), and logout isolation", async () => {
  const script = await fs.readFile(path.join(rootDir, "public/script.js"), "utf8");
  const style = await fs.readFile(path.join(rootDir, "public/style.css"), "utf8");

  assert.match(script, /id:\s*"deep-research"[\s\S]*?sidebarId:\s*"deepResearchNav"[\s\S]*?railId:\s*"railDeepResearchButton"/, "NAV_ITEMS registers deep-research");
  assert.match(script, /if\s*\(state\.view === "deep-research"\)\s*return renderDeepResearch\(\);/, "render() dispatches to renderDeepResearch()");
  assert.match(script, /window\.location\.pathname === DEEP_RESEARCH_ROUTE_PATH/, "Direct /deep-research startup route handled");
  assert.match(script, /window\.addEventListener\("popstate"/, "popstate listener handles Back/Forward route transitions");
  assert.match(script, /state\.deepResearchMessages\s*=\s*\[\];/, "clearUserScopedWorkspaceState clears deepResearchMessages");
  assert.match(script, /isDeepResearch\)\s*\{\s*const introIcon = element\("div", "deep-research-intro-icon"\)/, "Dedicated Deep Research intro renders icon & welcome text");
  assert.match(script, /ask-top-exit-btn[\s\S]*?startNewDeepResearch\(\)/, "Active Deep Research thread provides exit button to return to Deep Research page");
  assert.match(script, /function renderDeepResearchHistorySection[\s\S]*?researchChats\.slice\(0,\s*3\)/, "Deep Research page renders Tarixçə section showing first 3 items by default");

  assert.match(style, /\.deep-research-intro-icon\s*\{/, "style.css styles .deep-research-intro-icon");
  assert.match(style, /\.deep-research-intro-subtitle\s*\{/, "style.css styles .deep-research-intro-subtitle");
  assert.match(style, /\.ask-top-exit-btn\s*\{/, "style.css styles .ask-top-exit-btn");
  assert.match(style, /\.deep-research-history\s*\{/, "style.css styles .deep-research-history");
  assert.doesNotMatch(script, /deep-research-composer-pill/, "Deep Research input bar must not render a composer chip");
  assert.doesNotMatch(style, /\.deep-research-composer-pill/, "Removed composer chip styles should not remain");
});

test("FileChatRepository.list classifies research chats with isResearch, isResearchOnly, and researchStatus", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "helmer-dr-history-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const repo = new FileChatRepository(path.join(dir, "chats.json"));

  await repo.saveChat({
    ownerId: "user-1",
    title: "Market Research",
    messages: [
      { role: "user", content: "Analyze AI market" },
      { role: "assistant", type: "research", status: "completed", content: "Report" },
    ],
  });
  await repo.saveChat({
    ownerId: "user-1",
    title: "Normal Ask Chat",
    messages: [
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi!" },
    ],
  });

  const chats = await repo.list("user-1");
  assert.equal(chats.length, 2);
  const research = chats.find((c) => c.title === "Market Research");
  const ask = chats.find((c) => c.title === "Normal Ask Chat");
  assert.equal(research.isResearch, true);
  assert.equal(research.isResearchOnly, true);
  assert.equal(research.researchStatus, "completed");
  assert.equal(ask.isResearch, false);
  assert.equal(ask.isResearchOnly, false);
  assert.equal(ask.researchStatus, null);
});

test("Deep Research Customizations: i18n, frontend toggle, CSS, and schema/backend search prohibition", async () => {
  for (const key of ["customizationsTitle", "googleSearchLabel", "googleSearchDesc"]) {
    assert.ok(TRANSLATIONS.az.deepResearch[key], `Missing az.deepResearch.${key}`);
    assert.ok(TRANSLATIONS.en.deepResearch[key], `Missing en.deepResearch.${key}`);
  }

  const scriptSrc = await fs.readFile(path.join(rootDir, "public/script.js"), "utf8");
  assert.match(scriptSrc, /deepResearchGoogleSearchEnabled:\s*true/);
  assert.match(scriptSrc, /function createDeepResearchGoogleSearchToggle/);
  assert.match(scriptSrc, /if\s*\(handlers\.isDeepResearch\)\s*\{\s*title\.textContent\s*=\s*t\("deepResearch\.customizationsTitle"\)/);
  assert.match(scriptSrc, /if\s*\(isDeepResearch\)\s*\{\s*const customHeader\s*=\s*element\("div",\s*"dr-customizations-header"\)/);
  assert.match(scriptSrc, /googleSearchEnabled:\s*false/);

  const cssSrc = await fs.readFile(path.join(rootDir, "public/style.css"), "utf8");
  assert.match(cssSrc, /\.dr-customizations-header\b/);
  assert.match(cssSrc, /\.dr-customization-toggle-row\b/);
  assert.match(cssSrc, /\.dr-toggle-switch\b/);

  const {
    CreateResearchJobSchema,
    ResearchService,
    buildResearchPrompt,
    executeTargetedSearch,
  } = await import("../src/services/ai/research-service.js");

  assert.equal(
    CreateResearchJobSchema.safeParse({ prompt: "Test topic", googleSearchEnabled: false }).success,
    true,
  );
  assert.equal(
    CreateResearchJobSchema.safeParse({ prompt: "Test topic", unknownField: 123 }).success,
    false,
  );

  const disabledPrompt = buildResearchPrompt({
    prompt: "SaaS unit economics",
    language: "en",
    enableSearch: false,
    gatheredEvidence: "",
  });
  assert.match(disabledPrompt.systemInstruction, /Web search is strictly forbidden/i);

  const disabledSearchRes = await executeTargetedSearch({
    query: "SaaS unit economics",
    allowGoogleSearch: false,
  });
  assert.equal(disabledSearchRes.ok, false);
  assert.equal(disabledSearchRes.errorCode, "SEARCH_DISABLED");

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "helmer-dr-nosearch-"));
  const chatRepository = new FileChatRepository(path.join(tempDir, "chats.json"));
  const generateCalls = [];
  const mockGeminiClient = {
    models: {
      generateContent: async (req) => {
        generateCalls.push(req);
        return { text: "# Direct Strategic Synthesis\n\nNo web search used." };
      },
    },
  };

  const service = new ResearchService({
    chatRepository,
    geminiClient: mockGeminiClient,
  });

  const { jobId, chatId } = await service.createResearchJob({
    ownerId: "user-nosearch",
    prompt: "Analyze SaaS unit economics",
    language: "en",
    googleSearchEnabled: false,
  });

  const job = service.activeJobs.get(jobId);
  await job.executionPromise;

  const savedChat = await chatRepository.getById(chatId, "user-nosearch");
  const assistantMsg = savedChat.messages.find((m) => m.jobId === jobId);
  assert.equal(job.status, "completed");
  assert.equal(assistantMsg.status, "completed");
  assert.equal(assistantMsg.sources.length, 0);
  assert.equal(assistantMsg.groundingMetadata, undefined);
  assert.equal(generateCalls.length, 1);
  assert.equal(generateCalls[0]?.config?.tools, undefined);
});

test("Apple-inspired Deep Research progress card: i18n, accessible progress bar, expand/collapse state, and CSS", async () => {
  const requiredKeys = [
    "progressStatusRunning",
    "progressStatusCompleted",
    "progressStatusFailed",
    "progressTitleRunning",
    "progressTitleCompleted",
    "progressTitleFailed",
    "progressSubtitleRunning",
    "progressSubtitleCompleted",
    "progressStagesCaption",
    "progressSourcesCollected",
    "progressSourcesCollecting",
    "progressShowDetails",
    "progressHideDetails",
  ];
  for (const key of requiredKeys) {
    assert.ok(TRANSLATIONS.az.deepResearch[key], `Missing az.deepResearch.${key}`);
    assert.ok(TRANSLATIONS.en.deepResearch[key], `Missing en.deepResearch.${key}`);
  }

  const scriptSrc = await fs.readFile(path.join(rootDir, "public/script.js"), "utf8");
  assert.match(scriptSrc, /expandedResearchDetails:\s*new Set\(\)/);
  assert.match(scriptSrc, /ask-research-card dr-apple-card/);
  assert.match(scriptSrc, /track\.setAttribute\("role",\s*"progressbar"\)/);
  assert.match(scriptSrc, /dr-progress-details-toggle/);
  assert.match(scriptSrc, /detailsToggle\.setAttribute\("aria-expanded"/);

  const cssSrc = await fs.readFile(path.join(rootDir, "public/style.css"), "utf8");
  for (const selector of [
    ".ask-research-card.dr-apple-card",
    ".dr-progress-badge",
    ".dr-progress-track",
    ".dr-progress-fill",
    ".dr-progress-details-toggle",
    ".dr-progress-details-panel",
  ]) {
    assert.ok(cssSrc.includes(selector), `Missing CSS selector ${selector}`);
  }
  assert.match(cssSrc, /@media \(prefers-reduced-motion: reduce\)/);
});

test("Deep Research nav badge (Yeni/New) and permanently dismissible model upgrade info card", async () => {
  assert.equal(TRANSLATIONS.az.deepResearch.navNewBadge, "Yeni");
  assert.equal(TRANSLATIONS.en.deepResearch.navNewBadge, "New");
  assert.equal(
    TRANSLATIONS.az.deepResearch.modelUpgradeNotice,
    "Diqqətinizə çatdırırıq ki, araşdırmaların keyfiyyətinin artırılması məqsədilə yaxın zamanda cari Deep Research modeli yeni və daha təkmilləşdirmiş model ilə əvəzlənəcək. Anlayışınıza görə təşəkkür edirik.",
  );
  assert.ok(TRANSLATIONS.en.deepResearch.modelUpgradeNotice);

  const htmlSrc = await fs.readFile(path.join(rootDir, "public/index.html"), "utf8");
  assert.match(htmlSrc, /id="deepResearchNewBadge"/);

  const scriptSrc = await fs.readFile(path.join(rootDir, "public/script.js"), "utf8");
  assert.match(scriptSrc, /DEEP_RESEARCH_MODEL_NOTICE_STORAGE_KEY\s*=\s*"helmer_deep_research_model_notice_dismissed"/);
  assert.match(scriptSrc, /localStorage\.getItem\(DEEP_RESEARCH_MODEL_NOTICE_STORAGE_KEY\)/);
  assert.match(scriptSrc, /localStorage\.setItem\(DEEP_RESEARCH_MODEL_NOTICE_STORAGE_KEY,\s*"1"\)/);
  assert.match(scriptSrc, /function createDeepResearchModelNoticeCard/);

  const cssSrc = await fs.readFile(path.join(rootDir, "public/style.css"), "utf8");
  assert.ok(cssSrc.includes(".nav-new-badge"));
  assert.ok(cssSrc.includes(".dr-model-notice-card"));
});

test("Deep Research continues in background on Back/exit and updates History live", async () => {
  const scriptSrc = await fs.readFile(path.join(rootDir, "public/script.js"), "utf8");
  assert.match(scriptSrc, /function detachActiveResearchStreams\(\)/);
  assert.match(scriptSrc, /function syncDeepResearchHistoryPolling\(\)/);
  assert.match(scriptSrc, /deepResearchThreadEpoch:\s*0/);
  assert.match(scriptSrc, /export function startNewDeepResearch[\s\S]*?detachActiveResearchStreams\(\)/);
  assert.match(scriptSrc, /if\s*\(drEpoch !== state\.deepResearchThreadEpoch \|\| state\.view !== "deep-research"\)\s*\{\s*if\s*\(state\.currentUser\)\s*loadSavedChats\(\);\s*return;\s*\}/);
  assert.match(scriptSrc, /syncDeepResearchHistoryPolling\(\)/);
  assert.match(scriptSrc, /fetch\("\/api\/ask\/research"[\s\S]*?"Idempotency-Key":\s*researchIdempotencyKey/);
});

test("Deep Research Stop button cancels UI state and aborts in-flight model request", async () => {
  const scriptSrc = await fs.readFile(path.join(rootDir, "public/script.js"), "utf8");
  assert.match(scriptSrc, /function syncResearchConversationLoading\(message\)/);
  assert.match(scriptSrc, /async function cancelResearchJob\(message,/);
  assert.match(scriptSrc, /element\("button",\s*"dr-stop-btn"\)/);
  assert.match(scriptSrc, /fetch\(`\/api\/ask\/research\/jobs\/\$\{jobId\}\/cancel`,\s*\{/);

  const cssSrc = await fs.readFile(path.join(rootDir, "public/style.css"), "utf8");
  assert.ok(cssSrc.includes(".dr-stop-btn"));
  assert.ok(cssSrc.includes(".dr-progress-top-actions"));

  const { ResearchService } = await import("../src/services/ai/research-service.js");
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "helmer-dr-cancel-"));
  const chatRepository = new FileChatRepository(path.join(tempDir, "chats.json"));

  let modelAborted = false;
  let notifyModelStarted;
  const modelStarted = new Promise((resolve) => {
    notifyModelStarted = resolve;
  });

  const mockGeminiClient = {
    models: {
      generateContent: (req, opts) => new Promise((_resolve, reject) => {
        const signal = req?.config?.abortSignal || opts?.signal;
        notifyModelStarted();
        if (signal?.aborted) {
          modelAborted = true;
          const err = new Error("Aborted");
          err.name = "AbortError";
          reject(err);
          return;
        }
        signal?.addEventListener("abort", () => {
          modelAborted = true;
          const err = new Error("Aborted");
          err.name = "AbortError";
          reject(err);
        }, { once: true });
      }),
    },
  };

  const service = new ResearchService({
    chatRepository,
    geminiClient: mockGeminiClient,
  });

  const { jobId, chatId } = await service.createResearchJob({
    ownerId: "user-cancel",
    prompt: "Analyze competitive landscape",
    language: "en",
    googleSearchEnabled: false,
  });

  await modelStarted;
  const cancelled = await service.cancelJob(jobId, "user-cancel");
  assert.equal(cancelled, true);
  assert.equal(modelAborted, true);

  const job = service.activeJobs.get(jobId);
  await job.executionPromise;
  assert.equal(job.status, "cancelled");

  const savedChat = await chatRepository.getById(chatId, "user-cancel");
  const assistantMsg = savedChat.messages.find((m) => m.jobId === jobId);
  assert.equal(assistantMsg.status, "cancelled");
});

test("DistributedResearchService preserves briefId and googleSearchEnabled in snapshots and revokes deleted briefId", async () => {
  const { DistributedResearchService } = await import("../src/services/ai/distributed-research.js");
  const distSrc = await fs.readFile(path.join(rootDir, "src/services/ai/distributed-research.js"), "utf8");
  assert.match(distSrc, /if\s*\(job\.briefId\s*&&\s*!\s*await\s*this\.strategyRepository\?\.getById\(job\.briefId,\s*job\.ownerId\)\)\s*throw revoked\(\)/);
  assert.match(distSrc, /'googleSearchEnabled',\s*'strategyId',\s*'briefId'/);

  const askHandlerSrc = await fs.readFile(path.join(rootDir, "src/http/ask-handler.js"), "utf8");
  const assertIdx = askHandlerSrc.indexOf("req.securityContext.assertResources");
  const researchModeIdx = askHandlerSrc.indexOf('req.body.mode === "research"');
  assert.ok(assertIdx !== -1 && researchModeIdx !== -1 && assertIdx < researchModeIdx);
  assert.equal(typeof DistributedResearchService, "function");
});

test("Deep Research hero chip includes Beta badge and mobile CSS rules cover Deep Research UI", async () => {
  const scriptSrc = await fs.readFile(path.join(rootDir, "public/script.js"), "utf8");
  assert.match(scriptSrc, /element\("span",\s*"deep-research-intro-beta",\s*"Beta"\)/);

  const cssSrc = await fs.readFile(path.join(rootDir, "public/style.css"), "utf8");
  assert.ok(cssSrc.includes(".deep-research-intro-beta"));
  const mobileBlockStart = cssSrc.indexOf(".deep-research-intro-badge {\n    padding: 3.5px");
  assert.ok(mobileBlockStart !== -1, "Mobile media query covers Deep Research visual updates");
  const mobileSlice = cssSrc.slice(mobileBlockStart);
  for (const selector of [
    ".dr-stop-btn",
    ".dr-model-notice-card",
    ".dr-customization-toggle-row",
    ".deep-research-history-delete",
    ".ask-research-card.dr-apple-card",
  ]) {
    assert.ok(mobileSlice.includes(selector), `Missing mobile responsive rule for ${selector}`);
  }
});
