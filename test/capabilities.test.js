import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import express from "express";
import http from "node:http";
import JSZip from "jszip";
import ExcelJS from "exceljs";
import { PDFDocument } from "pdf-lib";
import { createPluginRegistry, resolveCapabilityIntent } from "../src/services/plugins/registry.js";
import { CapabilityWorkflow } from "../src/services/plugins/workflow.js";
import { renderArtifact } from "../src/services/artifacts/render.js";
import { validateRenderedFile } from "../src/services/artifacts/renderers.js";
import { applyArtifactEdits, cellSchema, chartSchema, schemasFor, sectionSchema } from "../src/services/artifacts/schemas.js";
import { ArtifactRepository, safeArtifactFilename } from "../src/repositories/artifact-repository.js";
import { FileChatRepository } from "../src/repositories/file-chat-repository.js";
import { createCapabilityRouter, createArtifactRouter } from "../src/http/capability-router.js";
import { GeminiFileCache } from "../src/services/ai/gemini-file-cache.js";
import { formatGeminiResponseSchema, routeStructuredGeneration } from "../src/services/ai/llm-router.js";
import { prepareUploadedContext } from "../src/services/artifacts/upload-context.js";
import { createWebResearch } from "../src/services/plugins/research.js";
import { zodTextFormat } from "openai/helpers/zod";
import { specs, section, sheet, cell } from "./artifact-fixtures.js";

process.env.OPENAI_API_KEY = "fixture-key";
process.env.GEMINI_API_KEY = "fixture-key";
const ownerId = `usr_${randomUUID()}`, otherOwner = `usr_${randomUUID()}`;
const registry = createPluginRegistry();
const scopes = new Set(["context:read", "artifacts:write", "web:search"]);
const researchOutput = { text: "Grounded market analysis.", model: "gemini-3.8-flash", groundingMetadata: { groundingChunks: [{ web: { uri: "https://example.com/market", title: "Market data" } }, { web: { uri: "javascript:alert(1)", title: "unsafe" } }] } };

async function harness(t, options = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "helmer-artifacts-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const artifacts = new ArtifactRepository(path.join(directory, "artifacts"));
  const chats = new FileChatRepository(path.join(directory, "chats.json")); chats.artifactRepository = artifacts;
  const calls = [];
  let fail = false;
  const workflow = new CapabilityWorkflow({ registry, artifacts, research: async () => researchOutput, generate: async args => {
    calls.push(args); if (fail) throw new Error("Sensitive provider internals");
    const input = JSON.parse(args.input);
    if (input.previous) return { data: { title: null, header: null, footer: null, citations: null, operations: [{ action: "replace", index: input.previous.units.length === 3 ? 2 : 0, unit: input.previous.units.length === 3 ? { ...sheet("Sensitivity"), summary: "CAC/LTV sensitivity added" } : { ...section(), paragraphs: ["Short summary"] } }] }, model: "fixture" };
    const plugin = options.pluginId || (input.request.match(/excel|powerpoint|pdf|word/i)?.[0]?.toLowerCase()) || "word";
    return { data: structuredClone(specs[plugin]), model: "fixture" };
  }, ...options.workflow });
  const app = express(); app.use(express.json({ limit: "25mb" }));
  app.use((req, _res, next) => { const id = req.headers["x-test-owner"]; if (id) { req.ownerId = id; req.user = { id, emailVerifiedAt: new Date().toISOString(), settings: { language: "az" } }; req.auth = { user: req.user }; } next(); });
  const strategyId = randomUUID();
  const strategy = { id: strategyId, ownerId, title: "Build strategy", brief: { business: "Fintech" }, strategy: { executiveSummary: "Board-approved plan" } };
  app.use("/api/ask", createCapabilityRouter({ registry, workflow, artifacts, chats, strategies: { getById: async (id, owner) => id === strategyId && owner === ownerId ? strategy : null }, planner: { list: async () => [] } }));
  app.post("/api/ask", (req, res) => res.json({ ordinaryChat: true, artifactContext: req.askArtifactContext }));
  app.use("/api/artifacts", createArtifactRouter({ artifacts, chats }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = async (payload, owner = ownerId, accept = "application/json") => {
    if (payload.chatId && payload.chatRevision === undefined) payload = { ...payload, chatRevision: (await chats.getById(payload.chatId, owner))?.revision };
    return fetch(`${base}/api/ask`, { method: "POST", headers: { "Content-Type": "application/json", "x-test-owner": owner, Accept: accept }, body: JSON.stringify(payload) }); };
  const rawPost = (payload, owner = ownerId, accept = "application/json") => fetch(`${base}/api/ask`, { method: "POST", headers: { "Content-Type": "application/json", "x-test-owner": owner, Accept: accept }, body: JSON.stringify(payload) });
  const get = (url, owner = ownerId) => fetch(`${base}${url}`, { headers: { "x-test-owner": owner } });
  return { artifacts, chats, workflow, post, rawPost, get, calls, strategyId, fail: value => { fail = value; } };
}

test("registry routes explicit selections before implicit intent and supports future plugins", () => {
  assert.equal(registry.list().length, 6);
  assert.equal(resolveCapabilityIntent({ registry, prompt: "Bunu Excel faylı kimi hazırla" }).plugins[0].id, "excel");
  assert.equal(resolveCapabilityIntent({ registry, prompt: "Bunun təqdimatını yarat" }).plugins[0].id, "powerpoint");
  assert.equal(resolveCapabilityIntent({ registry, pluginIds: ["pdf"], prompt: "Word sənədi hazırla" }).plugins[0].id, "pdf");
  assert.equal(resolveCapabilityIntent({ registry, prompt: "What is Excel?" }).intent, "chat");
  assert.equal(resolveCapabilityIntent({ registry, prompt: "İlk 90 gün üçün real fəaliyyət planı hazırla və 1C əvəzinə Excel/CSV ixracı ilə başla." }).intent, "chat");
  assert.equal(resolveCapabilityIntent({ registry, pluginIds: ["word", "web"], prompt: "Research then report" }).plugins[0].id, "web");
  const future = createPluginRegistry();
  future.register({ id: "drive", name: "Drive", icon: "document", description: "Read Drive", capabilities: ["external_read"], acceptedInputs: ["text"], outputTypes: ["research"], permissionRequirements: ["drive:read"], availability: () => true, execute: async () => ({ type: "research", text: "Document" }) });
  assert.equal(resolveCapabilityIntent({ registry: future, pluginIds: ["drive"], prompt: "Open file" }).plugins[0].id, "drive");
  assert.equal(resolveCapabilityIntent({ registry: future, pluginIds: ["drive"], prompt: "Open file" }).intent, "capability_execution");
});

for (const id of ["word", "excel", "powerpoint", "pdf"]) test(`@${id}: real binary, persistence, authenticated download and preview`, async t => {
  const h = await harness(t, { pluginId: id });
  const response = await h.post({ messages: [{ role: "user", content: `Create ${id} from this strategy` }], pluginIds: [id], strategyId: h.strategyId });
  assert.equal(response.status, 200);
  const data = await response.json(); assert.equal(data.artifacts.length, 1);
  assert.equal(data.chat.messages.at(-1).artifacts[0].id, data.artifacts[0].id);
  assert.match(h.calls[0].input, /Board-approved plan/);
  assert.match(h.calls[0].input, /Fintech/);
  const artifact = data.artifacts[0];
  const downloaded = await h.get(artifact.downloadUrl);
  assert.equal(downloaded.status, 200); assert.equal(downloaded.headers.get("content-type"), artifact.mimeType);
  assert.match(downloaded.headers.get("content-disposition"), /attachment/);
  const buffer = Buffer.from(await downloaded.arrayBuffer()); assert.equal(buffer.length, artifact.size);
  await validateRenderedFile(buffer, registry.get(id).extension);
  assert.equal((await h.get(artifact.downloadUrl, otherOwner)).status, 404);
  assert.equal((await h.get(`/api/artifacts/../../etc/passwd/versions/1/download`)).status, 404);
  const preview = await (await h.get(artifact.previewUrl)).json(); assert.equal(preview.versions.length, 1);
  if (id === "word") {
    const zip = await JSZip.loadAsync(buffer); const xml = await zip.file("word/document.xml").async("string");
    assert.match(xml, /Executive Summary/); assert.match(xml, /Azərbaycan/); assert.match(xml, /w:tbl/);
  } else if (id === "excel") {
    const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(buffer);
    assert.equal(workbook.worksheets.length, 3);
    assert.equal(workbook.getWorksheet("Forecast").getCell("B4").formula, "SUM(B2:B3)");
    assert.equal(workbook.getWorksheet("Forecast").getCell("B4").result, 210);
    const zip = await JSZip.loadAsync(buffer); assert.ok(zip.file("xl/charts/chart1.xml")); assert.ok(zip.file("xl/drawings/drawing1.xml"));
    assert.match(await zip.file("xl/charts/chart1.xml").async("string"), /Revenue forecast/);
    assert.match(await zip.file("xl/charts/chart1.xml").async("string"), /c:numRef/);
    assert.match(await zip.file("xl/worksheets/sheet1.xml").async("string"), /conditionalFormatting/);
  } else if (id === "powerpoint") {
    const zip = await JSZip.loadAsync(buffer); assert.ok(zip.file("ppt/charts/chart1.xml")); assert.ok(zip.file("ppt/notesSlides/notesSlide1.xml"));
    assert.match(await zip.file("ppt/slides/slide1.xml").async("string"), /Board presentation/);
  } else {
    assert.equal((await PDFDocument.load(buffer)).getPageCount(), 2);
  }
});

test("editing the third Excel sheet preserves prior versions and other sheets", async t => {
  const h = await harness(t, { pluginId: "excel" });
  const original = await (await h.post({ messages: [{ role: "user", content: "Create Excel" }], pluginIds: ["excel"] })).json();
  const first = original.artifacts[0]; const firstBytes = Buffer.from(await (await h.get(first.downloadUrl)).arrayBuffer());
  const revised = await (await h.post({ chatId: original.chat.id, messages: [{ role: "user", content: "3-cü sheet-ə CAC/LTV sensitivity əlavə et." }] })).json();
  assert.equal(revised.artifacts[0].id, first.id); assert.equal(revised.artifacts[0].version, 2);
  const record = await h.artifacts.get(first.id, ownerId);
  assert.deepEqual(record.versions[0].spec.units.slice(0, 2), record.versions[1].spec.units.slice(0, 2));
  assert.equal(record.versions[1].spec.units[2].summary, "CAC/LTV sensitivity added");
  assert.deepEqual(Buffer.from(await (await h.get(first.downloadUrl)).arrayBuffer()), firstBytes);
  const preview = await (await h.get(revised.artifacts[0].previewUrl)).json(); assert.deepEqual(preview.versions.map(item => item.version), [1, 2]);
  const chatResponse = await (await h.post({ chatId: original.chat.id, messages: [{ role: "user", content: "Explain this forecast" }] })).json();
  assert.equal(chatResponse.ordinaryChat, true); assert.match(chatResponse.artifactContext, /CAC\/LTV/);
  const denied = await h.post({ chatId: original.chat.id, messages: [{ role: "user", content: "Edit" }], artifactId: first.id }, otherOwner); assert.equal(denied.status, 404);
  await h.chats.delete(original.chat.id, ownerId); assert.equal(await h.artifacts.get(first.id, ownerId), null);
});

test("an explicit Word selection targets the saved Word artifact even when a PDF was created later", async t => {
  const h = await harness(t);
  const word = await (await h.post({ pluginIds: ["word"], messages: [{ role: "user", content: "Create Word" }] })).json();
  await h.post({ chatId: word.chat.id, pluginIds: ["pdf"], messages: [{ role: "user", content: "Create PDF" }] });
  const edited = await (await h.post({ chatId: word.chat.id, pluginIds: ["word"], messages: [{ role: "user", content: "Executive Summary-ni qısalt" }] })).json();
  assert.equal(edited.artifacts[0].id, word.artifacts[0].id);
  assert.equal(edited.artifacts[0].version, 2);
});

test("Web research returns safe sources and grounded output stays out of artifact prompts", async t => {
  const h = await harness(t);
  const result = await (await h.post({ pluginIds: ["web", "word"], messages: [{ role: "user", content: "Research the fintech market and create Word report" }] })).json();
  assert.equal(result.execution.steps.length, 2); assert.deepEqual(result.execution.steps.map(step => step.pluginId), ["web", "word"]);
  assert.equal(result.groundingMetadata.groundingChunks.length, 1);
  assert.doesNotMatch(h.calls[0].input, /Grounded market analysis/);
  assert.match(result.reply, /Grounded market analysis/);
  const webOnly = await (await h.post({ pluginIds: ["web"], messages: [{ role: "user", content: "Research market" }] })).json();
  assert.equal(webOnly.ordinaryChat, true);
});

test("Web → Excel → PowerPoint renders downloadable files and shares structured intermediate data", async t => {
  const inputs = [];
  const h = await harness(t, { workflow: { generate: async args => {
    inputs.push(JSON.parse(args.input));
    return { data: structuredClone(inputs.length === 1 ? specs.excel : specs.powerpoint), model: "fixture" };
  } } });
  const response = await h.post({ pluginIds: ["web", "excel", "powerpoint"], messages: [{ role: "user", content: "Research, analyze in Excel and prepare PowerPoint" }] });
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(result.execution.steps.map(step => step.pluginId), ["web", "excel", "powerpoint"]);
  assert.equal(inputs[1].priorOutputs[0].type, "xlsx");
  assert.equal(inputs[1].priorOutputs[0].spec.units[0].rows[3][1].formula, "SUM(B2:B3)");
  assert.equal(result.artifacts.length, 2);
  for (const artifact of result.artifacts) {
    const download = await h.get(artifact.downloadUrl);
    assert.equal(download.status, 200);
    await validateRenderedFile(Buffer.from(await download.arrayBuffer()), registry.get(artifact.pluginId).extension);
  }
});

test("SSE emits actual phases and a committed artifact; failure allows retry without corrupt files", async t => {
  const h = await harness(t);
  h.fail(true);
  const failed = await h.post({ pluginIds: ["word"], stream: true, messages: [{ role: "user", content: "Create Word report" }] }, ownerId, "text/event-stream");
  const events = (await failed.text()).split("\n").filter(line => line.startsWith("data:")).map(line => JSON.parse(line.slice(5)));
  assert.ok(events.at(-1).retryable); assert.equal(events.at(-1).artifacts, undefined); assert.doesNotMatch(JSON.stringify(events), /Sensitive provider/);
  const chatId = events[0].chatId;
  h.fail(false);
  const retried = await h.post({ chatId, pluginIds: ["word"], messages: [{ role: "user", content: "Create Word report" }], stream: true }, ownerId, "text/event-stream");
  const retryEvents = (await retried.text()).split("\n").filter(line => line.startsWith("data:")).map(line => JSON.parse(line.slice(5)));
  assert.ok(retryEvents.some(event => event.status === "rendering")); assert.ok(retryEvents.some(event => event.status === "saving"));
  assert.equal(retryEvents.at(-1).done, true); assert.equal(retryEvents.at(-1).chat.messages.length, 2);
  assert.equal((await h.get(retryEvents.at(-1).artifacts[0].downloadUrl)).status, 200);
});

test("deleting a chat during generation prevents publication and rolls back the new file", async t => {
  const h = await harness(t, { workflow: { generate: async () => {
    const [chat] = await h.chats.list(ownerId);
    await h.chats.delete(chat.id, ownerId);
    return { data: structuredClone(specs.word), model: "fixture" };
  } } });
  const response = await h.post({ pluginIds: ["word"], messages: [{ role: "user", content: "Create Word" }] });
  assert.equal(response.status, 502);
  assert.equal((await response.json()).artifacts, undefined);
  assert.deepEqual(await h.chats.list(ownerId), []);
  const files = await fs.readdir(h.artifacts.directory, { recursive: true });
  assert.equal(files.some(file => /manifest\.json|\.docx$/.test(file)), false);
});

test("strict request validation, filename safety, formulas and tenant-scoped uploads", async t => {
  const h = await harness(t);
  assert.equal((await h.post({ messages: [{ role: "user", content: "Create Word" }], ownerId: otherOwner })).status, 400);
  assert.equal((await h.post({ messages: [{ role: "user", content: "Create Word" }], pluginIds: ["unknown"] })).status, 502);
  assert.equal((await h.post({ messages: [{ role: "user", content: "Create Word" }], strategyId: "../../etc/passwd" })).status, 400);
  assert.doesNotMatch(safeArtifactFilename('../../evil\r\n".exe', "docx"), /[\/\\\r\n"]/);
  assert.throws(() => safeArtifactFilename("a", "exe"));
  for (const formula of ['WEBSERVICE("https://evil.com")', '[book.xlsx]Sheet1!A1', 'CALL("cmd")', 'HYPERLINK("file:///etc/passwd")']) assert.equal(cellSchema.safeParse(cell("", "formula", formula)).success, false);
  assert.equal(cellSchema.safeParse(cell("", "formula", "IF(B2>0,B2,0)")).success, true);
  assert.equal(chartSchema.safeParse({ title: "Shares", type: "pie", labels: ["A"], series: [{ name: "A", values: [1] }, { name: "B", values: [2] }] }).success, false);
  const cache = new GeminiFileCache(); t.after(() => clearInterval(cache.cleanupInterval));
  const file = cache.resolveFile({ name: "private.txt", textContent: "secret", type: "text/plain" }, ownerId);
  assert.equal(cache.getFile(file.fileId, otherOwner), null);
  assert.equal(cache.getFile(file.fileId, ownerId).textContent, "secret");
});

test("bounded execution rejects missing permissions, ungrounded research, invalid renders and timeouts", async () => {
  const context = { plugins: [registry.get("web")], ownerId, chatId: randomUUID(), prompt: "Research", messages: [], sourceContext: "", scopes };
  const workflow = new CapabilityWorkflow({ registry, artifacts: {}, research: async () => ({ text: "No evidence" }) });
  await assert.rejects(workflow.execute(context), /mənbələri/);
  await assert.rejects(workflow.execute({ ...context, scopes: new Set() }), /permission/);
  await assert.rejects(workflow.execute({ ...context, plugins: Array(7).fill(registry.get("web")) }), /limit/);
  const stalled = new CapabilityWorkflow({ registry, artifacts: {}, timeoutMs: 15, research: () => new Promise(() => {}) });
  await assert.rejects(stalled.execute(context), /timed out/);
  await assert.rejects(validateRenderedFile(Buffer.from("broken"), "docx"));
  await assert.rejects(renderArtifact("unknown", {}, { timeoutMs: 1000 }));
  assert.throws(() => applyArtifactEdits(specs.word, { title: null, header: null, footer: null, citations: null, operations: [{ action: "remove", index: 99, unit: null }] }, schemasFor(sectionSchema, 60).spec));
});

test("new plugin structured outputs feed later steps and helpers enforce declared permission scopes", async () => {
  const future = createPluginRegistry();
  const descriptor = { id: "dataset", name: "Dataset", icon: "spreadsheet", description: "Analyze data", capabilities: ["analysis"], acceptedInputs: ["text"], outputTypes: ["dataset"], permissionRequirements: [], availability: () => true };
  let seenInput;
  future.register({ ...descriptor, execute: async context => {
    assert.equal(context.request.sourceContext, undefined);
    await assert.rejects(context.research(), /permission/);
    await assert.rejects(context.generateArtifact(future.get("word")), /permission/);
    return { type: "dataset", rows: [{ revenue: 123 }] };
  } });
  const workflow = new CapabilityWorkflow({ registry: future, artifacts: { save: async () => ({ artifact: { id: randomUUID(), version: 1 } }) },
    generate: async args => { seenInput = JSON.parse(args.input); return { data: specs.word, model: "fixture" }; }, render: async () => Buffer.from("validated renderer fixture") });
  const result = await workflow.execute({ plugins: [future.get("dataset"), future.get("word")], ownerId, chatId: randomUUID(), prompt: "Analyze and report", messages: [], sourceContext: "private source", scopes });
  assert.deepEqual(seenInput.priorOutputs[0], { type: "dataset", rows: [{ revenue: 123 }] });
  assert.equal(result.execution.steps[0].output.rows[0].revenue, 123);
  assert.equal(result.execution.steps[1].output.artifact.version, 1);
});

test("provider schemas retain nullable fields and avoid unsupported URI formats", () => {
  const excel = formatGeminiResponseSchema(registry.get("excel").schemas.spec, "artifact_specification");
  assert.deepEqual(excel.properties.units.items.properties.rows.items.items.properties.result, { type: "number", nullable: true });
  const edit = formatGeminiResponseSchema(registry.get("word").schemas.edit, "artifact_edit");
  assert.equal(edit.properties.title.nullable, true);
  assert.equal(edit.properties.operations.items.properties.unit.nullable, true);
  assert.doesNotMatch(JSON.stringify(zodTextFormat(registry.get("word").schemas.spec, "artifact_specification")), /"format":"uri"/);
});

test("binary attachments fail closed when the multimodal provider is unavailable", async () => {
  const previousKey = process.env.GEMINI_API_KEY, previousVertex = process.env.GEMINI_USE_VERTEX;
  process.env.GEMINI_API_KEY = ""; process.env.GEMINI_USE_VERTEX = "false";
  try {
    await assert.rejects(routeStructuredGeneration({ schema: registry.get("word").schemas.spec, name: "artifact_specification", askRoute: "gemini-3.8-flash", input: "Attached PDF", attachments: [{ type: "application/pdf", data: "JVBERi0=" }] }), error => error.code === "AI_ATTACHMENT_UNAVAILABLE");
  } finally {
    process.env.GEMINI_API_KEY = previousKey;
    if (previousVertex === undefined) delete process.env.GEMINI_USE_VERTEX; else process.env.GEMINI_USE_VERTEX = previousVertex;
  }
});

test("uploaded DOCX and XLSX become source context without executing file content", async () => {
  for (const id of ["word", "excel"]) {
    const extension = registry.get(id).extension;
    const buffer = await renderArtifact(extension, specs[id]);
    const file = await prepareUploadedContext({ name: `source.${extension}`, size: buffer.length, type: registry.get(id).mimeType, data: buffer.toString("base64") });
    assert.match(file.textContent, id === "word" ? /Executive Summary/ : /SUM\(B2:B3\)/);
  }
  await assert.rejects(prepareUploadedContext({ name: "file.exe", size: 1, type: "application/octet-stream", data: "AA==" }), /Unsupported/);
  await assert.rejects(prepareUploadedContext({ name: "report.pdf", size: 3, type: "application/pdf", data: "YWJj" }), /Invalid PDF/);
});

test("Web research enforces Google-only grounding and does not fall back to another search provider", async () => {
  let parameters;
  const client = { responses: { create: async params => { parameters = params; return { output_text: "Grounded facts.", model: "test", output: [{ type: "web_search_call", status: "completed", action: { sources: [{ url: "https://example.com/report", title: "Report" }, { url: "javascript:alert(1)" }] } }, { type: "message", content: [{ type: "output_text", text: "Grounded facts.", annotations: [{ type: "url_citation", url: "https://example.com/report", title: "Report" }] }] }] }; } } };
  const research = createWebResearch({ geminiResearch: async () => { throw new Error("Permission denied"); }, openAIClient: client });
  await assert.rejects(research({ messages: [{ role: "user", content: "Research market" }], instructions: "Build context" }), /Permission denied/);
  assert.equal(parameters, undefined);
  const missing = createWebResearch({ openAIClient: { responses: { create: async () => ({ output_text: "Invented citation", output: [{ type: "message", content: [] }] }) } } });
  await assert.rejects(missing({ messages: [], instructions: "" }), { code: 'GROUNDING_UNAVAILABLE' });
});

test("storage failure rolls back previously saved outputs; stale versions cannot overwrite newer ones", async t => {
  const h = await harness(t);
  const original = await (await h.post({ pluginIds: ["word"], messages: [{ role: "user", content: "Create Word" }] })).json();
  const record = await h.artifacts.get(original.artifacts[0].id, ownerId);
  const plugin = registry.get("word"), buffer = await renderArtifact("docx", specs.word);
  const next = await h.artifacts.save({ ownerId, chatId: original.chat.id, plugin, spec: specs.word, buffer, previous: record });
  await assert.rejects(h.artifacts.save({ ownerId, chatId: original.chat.id, plugin, spec: specs.word, buffer, previous: record }), /version changed/);
  await h.artifacts.rollback(next.artifact, ownerId); assert.equal((await h.artifacts.get(record.id, ownerId)).versions.length, 1);
  let saves = 0, rolledBack = false;
  const workflow = new CapabilityWorkflow({ registry, artifacts: { save: async () => { if (saves++) throw new Error("Storage unavailable"); return { artifact: { id: randomUUID(), version: 1 } }; }, rollback: async () => { rolledBack = true; } }, generate: async args => ({ data: JSON.parse(args.input).priorOutputs.length ? specs.pdf : specs.word, model: "test" }) });
  await assert.rejects(workflow.execute({ plugins: [registry.get("word"), registry.get("pdf")], ownerId, chatId: randomUUID(), prompt: "Create files", messages: [], scopes }), /Storage unavailable/);
  assert.equal(rolledBack, true);
});

test("private R2 object protocol preserves prior manifests after local commit failure and verifies download checksums", async t => {
  const objects = new Map();
  const server = http.createServer(async (req, res) => {
    const key = new URL(req.url, "http://localhost").pathname;
    if (req.method === "PUT") {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      objects.set(key, Buffer.concat(chunks)); res.end();
    } else if (req.method === "DELETE") { objects.delete(key); res.statusCode = 204; res.end(); }
    else if (objects.has(key)) { res.end(objects.get(key)); }
    else { res.statusCode = 404; res.setHeader("Content-Type", "application/xml"); res.end("<Error><Code>NoSuchKey</Code></Error>"); }
  });
  server.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const keys = ["R2_ENDPOINT", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET_NAME"], old = keys.map(key => process.env[key]);
  process.env.R2_ENDPOINT = `http://127.0.0.1:${server.address().port}`;
  process.env.R2_ACCESS_KEY_ID = "fixture-access"; process.env.R2_SECRET_ACCESS_KEY = "fixture-secret"; process.env.R2_BUCKET_NAME = "fixture";
  t.after(() => keys.forEach((key, index) => { if (old[index] === undefined) delete process.env[key]; else process.env[key] = old[index]; }));
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "helmer-r2-artifacts-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const repository = new ArtifactRepository(directory), chatId = randomUUID(), plugin = registry.get("word");
  const buffer = await renderArtifact("docx", specs.word);
  const saved = await repository.save({ ownerId, chatId, plugin, spec: specs.word, buffer });
  const record = await repository.get(saved.artifact.id, ownerId);
  assert.equal(record.versions.length, 1);
  assert.deepEqual((await repository.download(record, 1, ownerId)).buffer, buffer);
  assert.equal(await repository.get(record.id, otherOwner), null);
  // R2 is authoritative: force a local rename failure after the remote v2 manifest write.
  const manifest = repository.location(ownerId, record.id);
  await fs.unlink(manifest.local); await fs.mkdir(manifest.local);
  await assert.rejects(repository.save({ ownerId, chatId, plugin, spec: specs.word, buffer, previous: record }));
  assert.equal((await repository.get(record.id, ownerId)).versions.length, 1);
  assert.equal([...objects.keys()].some(key => key.endsWith("v2.docx")), false);
  const binary = `/fixture/${repository.location(ownerId, record.id, "v1.docx").key}`;
  objects.set(binary, Buffer.from("corrupt"));
  await assert.rejects(repository.download(record, 1, ownerId), /integrity/);
  await repository.deleteChatArtifacts({ id: chatId, ownerId, messages: [{ artifacts: [saved.artifact] }] });
  assert.equal(objects.size, 0);
});

test("OCC revision guard: omitted chatRevision defaults safely, stale revision yields 409 REVISION_CONFLICT, and OCC retry succeeds", async t => {
  const h = await harness(t, { pluginId: "word" });
  const created = await h.chats.saveChat({
    id: randomUUID(),
    ownerId,
    messages: [
      { role: "user", content: "İlk mesaj" },
      { role: "assistant", content: "İlk cavab" },
    ],
  });
  assert.equal(created.revision, 1);

  // 1. Omitted chatRevision does not trigger false 409 conflict
  const resOmitted = await h.rawPost({
    messages: [
      { role: "user", content: "İlk mesaj" },
      { role: "assistant", content: "İlk cavab" },
      { role: "user", content: "Word faylı yarat", pluginIds: ["word"] },
    ],
    chatId: created.id,
    pluginIds: ["word"],
  });
  assert.equal(resOmitted.status, 200);
  const dataOmitted = await resOmitted.json();
  assert.equal(dataOmitted.done, true);
  assert.equal(dataOmitted.chatRevision, 3);

  // 2. Stale chatRevision triggers 409 REVISION_CONFLICT with authoritative revision
  const resStale = await h.rawPost({
    messages: [
      { role: "user", content: "İlk mesaj" },
      { role: "assistant", content: "İlk cavab" },
      { role: "user", content: "Word faylı yarat", pluginIds: ["word"] },
    ],
    chatId: created.id,
    chatRevision: 1,
    pluginIds: ["word"],
  });
  assert.equal(resStale.status, 409);
  const dataStale = await resStale.json();
  assert.equal(dataStale.code, "REVISION_CONFLICT");
  assert.equal(dataStale.revision, 3);

  // 3. Retry with authoritative revision succeeds
  const resRetry = await h.rawPost({
    messages: [
      { role: "user", content: "İlk mesaj" },
      { role: "assistant", content: "İlk cavab" },
      { role: "user", content: "Word faylı yarat", pluginIds: ["word"] },
    ],
    chatId: created.id,
    chatRevision: dataStale.revision,
    pluginIds: ["word"],
  });
  assert.equal(resRetry.status, 200);
  const dataRetry = await resRetry.json();
  assert.equal(dataRetry.done, true);
  assert.equal(dataRetry.chatRevision, 5);
});

