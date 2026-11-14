import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import express from "express";
import { maskIdentifier, anonymizeIp, categorizeBrief, redactSensitiveText, redactPayload } from "../src/services/telemetry/privacy.js";
import { calculateEstimatedCost, USD_TO_AZN_RATE } from "../src/services/telemetry/pricing.js";
import { FileTelemetryRepository } from "../src/repositories/file-telemetry-repository.js";
import { TelemetryService } from "../src/services/telemetry/telemetry-service.js";
import { createTelemetryAdminRouter, createTelemetryClientRouter } from "../src/http/telemetry-router.js";
import { createRequireAdmin } from "../src/http/admin-authorization.js";

async function createFixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "helmer-telemetry-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const repoPath = path.join(directory, "telemetry.json");
  const repository = new FileTelemetryRepository(repoPath, null, { mirrorToR2: false });
  const service = new TelemetryService(repository);
  return { directory, repository, service };
}

test("1. Privacy-First: maskIdentifier creates deterministic masked ID without exposing raw UUID", () => {
  const uuid1 = "600649fd-2cb1-4475-b829-d5ff1e20fe98";
  const masked1 = maskIdentifier(uuid1);
  const masked2 = maskIdentifier(uuid1);

  assert.equal(masked1, masked2, "Masking must be deterministic for the same user");
  assert.match(masked1, /^usr_[0-9a-f]{4}\.\.\.[0-9a-f]{2}$/, "Format must match usr_xxxx...xx");
  assert.equal(masked1.includes(uuid1), false, "Raw UUID must never be exposed");

  const anonMasked = maskIdentifier(null);
  assert.equal(anonMasked, "usr_anon...00");
});

test("2. Privacy-First: anonymizeIp masks host/subnet to prevent individual identification", () => {
  const ipv4 = anonymizeIp("192.168.1.155");
  assert.equal(ipv4, "192.168.***.***");

  const localIp = anonymizeIp("127.0.0.1");
  assert.equal(localIp, "127.0.***.***");

  const v6 = anonymizeIp("2001:0db8:85a3:0000:0000:8a2e:0370:7334");
  assert.match(v6, /2001:0?db8:\*\*\*\*:\*\*\*\*/);

  assert.equal(anonymizeIp(null), "unknown");
});

test("3. Privacy-First: categorizeBrief accurately identifies generalized market category", () => {
  assert.equal(categorizeBrief("Bizim yeni AI SaaS platformamız var"), "SaaS & Texnologiya");
  assert.equal(categorizeBrief("Bakıda qadın geyim mağazası və kosmetika e-ticarət"), "E-ticarət & Pərakəndə");
  assert.equal(categorizeBrief("Restoran şəbəkəsi və kafe üçün müştəri xidməti"), "Lokal Xidmət & Qonaqpərvərlik");
  assert.equal(categorizeBrief("Logistika və tikinti materialları B2B satışı"), "B2B & İstehsalat");
  assert.equal(categorizeBrief("SMM və rəqəmsal reklam agentliyi"), "Marketinq & Kreativ");
  assert.equal(categorizeBrief("Sadə biznes layihəsi"), "Ümumi Biznes Strategiyası");
});

test("4. Privacy-First: redactSensitiveText and redactPayload scrub PII from audit records", () => {
  const textWithPii = "Contact me at elvin@example.com or +994501234567 with API key sk-abcdef1234567890 and password=secret123";
  const safeText = redactSensitiveText(textWithPii);

  assert.doesNotMatch(safeText, /elvin@example\.com/);
  assert.doesNotMatch(safeText, /\+994501234567/);
  assert.doesNotMatch(safeText, /sk-abcdef1234567890/);
  assert.doesNotMatch(safeText, /secret123/);
  assert.match(safeText, /REDACTED_EMAIL/);

  const payload = {
    userEmail: "test@domain.com",
    password: "superSecretPassword!",
    apiKey: "sk-1234567890123456",
    ip: "10.0.4.12",
    userId: "user-uuid-1234",
    safeMetric: 42,
    details: {
      phone: "+994559998877",
      note: "Customer inquiry",
    },
  };

  const cleaned = redactPayload(payload);
  assert.equal(cleaned.userEmail, "[REDACTED_PII]");
  assert.equal(cleaned.password, "[REDACTED_PII]");
  assert.equal(cleaned.apiKey, "[REDACTED_PII]");
  assert.equal(cleaned.ip, "10.0.***.***");
  assert.match(cleaned.userId, /^usr_/);
  assert.equal(cleaned.safeMetric, 42);
  assert.equal(cleaned.details.phone, "[REDACTED_PII]");
  assert.equal(cleaned.details.note, "Customer inquiry");
});

test("5. Pricing: calculateEstimatedCost computes USD and AZN equivalents with 1.70 rate", () => {
  const cost = calculateEstimatedCost("gemini-4-hydrogen", 10_000, 5_000);
  assert.ok(cost.costUsd > 0);
  assert.ok(cost.costAzn > 0);
  assert.equal(Number((cost.costUsd * USD_TO_AZN_RATE).toFixed(6)), cost.costAzn);
  assert.equal(cost.inputTokens, 10_000);
  assert.equal(cost.outputTokens, 5_000);
  assert.equal(cost.totalTokens, 15_000);

  const zeroCost = calculateEstimatedCost("gemini-4-hydrogen", 0, 0);
  assert.equal(zeroCost.costUsd, 0);
  assert.equal(zeroCost.costAzn, 0);
});

test("6. TelemetryService: tracks Build, Ask, Summary, Export, Auth, and System streams", async (t) => {
  const { service, repository } = await createFixture(t);

  // 1. Build stream (Local Azerbaijan Mode)
  await service.trackBuildStrategy({
    ownerId: "usr-az-1",
    brief: "Bakıda yeni milli restoran brendi üçün marketinq planı",
    model: "gemini-4-hydrogen",
    latencyMs: 1450,
    usage: { prompt_tokens: 1500, completion_tokens: 3000 },
    status: "success",
    qualityScore: 0.92,
  });

  // 2. Build stream (Global Mode)
  await service.trackBuildStrategy({
    ownerId: "usr-gl-1",
    brief: "Worldwide enterprise SaaS expansion into the US and European markets",
    model: "gpt-5.6-terra",
    latencyMs: 2800,
    usage: { prompt_tokens: 2000, completion_tokens: 4000 },
    status: "success",
    qualityScore: 0.85,
  });

  // 3. Ask stream (with Google Search Grounding)
  await service.trackAskQuery({
    ownerId: "usr-az-1",
    model: "gemini-3.8-flash",
    latencyMs: 850,
    usage: { prompt_tokens: 800, completion_tokens: 600 },
    groundingActive: true,
    status: "success",
    querySnippet: "What are the latest AI benchmarks for 2026?",
  });

  // 4. Summary stream (Luna)
  await service.trackSummary({
    ownerId: "usr-az-1",
    model: "gpt-5.6-luna",
    latencyMs: 620,
    usage: { prompt_tokens: 500, completion_tokens: 300 },
    status: "success",
  });

  // 5. Export stream (PDF)
  await service.trackExport({
    ownerId: "usr-gl-1",
    format: "pdf",
    title: "Global SaaS Strategy",
    status: "success",
  });

  // 6. Auth stream
  await service.trackAuth({
    ownerId: "usr-az-1",
    action: "login",
    provider: "credentials",
    ip: "192.168.1.10",
    status: "success",
  });

  // 7. System error stream
  await service.trackSystemError({
    ownerId: "usr-gl-1",
    path: "/api/strategy/assess",
    method: "POST",
    statusCode: 429,
    errorCode: "RATE_LIMITED",
    latencyMs: 12,
  });

  const list = await repository.listEvents({ page: 1, pageSize: 20 });
  assert.equal(list.total, 7, "All 7 streams must be recorded");

  const buildAz = list.items.find((e) => e.mode === "build" && e.marketMode === "LOCAL_AZ_MODE");
  assert.ok(buildAz, "LOCAL_AZ_MODE build event must be present");
  assert.equal(buildAz.model, "gemini-4-hydrogen");
  assert.equal(buildAz.qualityScore, 0.92);
  assert.match(buildAz.maskedUserId, /^usr_/);

  const buildGl = list.items.find((e) => e.mode === "build" && e.marketMode === "GLOBAL_MODE");
  assert.ok(buildGl, "GLOBAL_MODE build event must be present");

  const askEvt = list.items.find((e) => e.mode === "ask");
  assert.ok(askEvt, "Ask event must be present");
  assert.equal(askEvt.groundingActive, true, "Grounding active flag must be recorded");

  const sumEvt = list.items.find((e) => e.mode === "summary");
  assert.ok(sumEvt, "Summary event must be present");
  assert.equal(sumEvt.model, "gpt-5.6-luna");

  const expEvt = list.items.find((e) => e.mode === "export");
  assert.ok(expEvt, "Export event must be present");
  assert.equal(expEvt.format, "pdf");

  const authEvt = list.items.find((e) => e.mode === "auth");
  assert.ok(authEvt, "Auth event must be present");
  assert.equal(authEvt.anonymizedIp, "192.168.***.***");

  const sysEvt = list.items.find((e) => e.mode === "system");
  assert.ok(sysEvt, "System error event must be present");
  assert.equal(sysEvt.statusCode, 429);
});

test("7. TelemetryRepository: listEvents supports filters, search, and pagination", async (t) => {
  const { service, repository } = await createFixture(t);

  await service.trackBuildStrategy({ ownerId: "u1", brief: "Bakı brend", model: "gemini-4-hydrogen", status: "success" });
  await service.trackBuildStrategy({ ownerId: "u2", brief: "Global export", model: "gpt-5.6-terra", status: "success" });
  await service.trackAskQuery({ ownerId: "u1", model: "gemini-3.8-flash", status: "success", querySnippet: "Local pricing" });
  await service.trackExport({ ownerId: "u3", format: "excel", status: "success" });

  // Filter by mode
  const buildOnly = await repository.listEvents({ mode: "build" });
  assert.equal(buildOnly.total, 2);

  // Filter by marketMode
  const azOnly = await repository.listEvents({ marketMode: "LOCAL_AZ_MODE" });
  assert.ok(azOnly.total >= 1);

  // Search query
  const searched = await repository.listEvents({ search: "excel" });
  assert.equal(searched.total, 1);
  assert.equal(searched.items[0].format, "excel");

  // Pagination
  const paged = await repository.listEvents({ page: 1, pageSize: 2 });
  assert.equal(paged.items.length, 2);
  assert.equal(paged.totalPages, 2);
});

test("8. TelemetryRepository: getOverview aggregates DAU, strategies, latency, and costs", async (t) => {
  const { service, repository } = await createFixture(t);

  await service.trackBuildStrategy({
    ownerId: "user-alpha",
    brief: "Bakı filialı",
    model: "gemini-4-hydrogen",
    latencyMs: 1200,
    usage: { prompt_tokens: 1000, completion_tokens: 2000 },
    status: "success",
  });
  await service.trackBuildStrategy({
    ownerId: "user-beta",
    brief: "Global tech startup",
    model: "gpt-5.6-terra",
    latencyMs: 1800,
    usage: { prompt_tokens: 2000, completion_tokens: 3000 },
    status: "success",
  });

  const overview = await repository.getOverview({ dateRange: "today" });
  assert.equal(overview.dau, 2, "DAU should count unique active users");
  assert.equal(overview.totalStrategies, 2, "Should count 2 successful strategies");
  assert.equal(overview.avgLatencyMs, 1500, "Average latency of 1200 and 1800 is 1500ms");
  assert.ok(overview.todayCostUsd > 0);
  assert.ok(overview.todayCostAzn > 0);
  assert.equal(overview.marketDistribution.localCount, 1);
  assert.equal(overview.marketDistribution.globalCount, 1);
  assert.equal(overview.marketDistribution.localPercent, 50);
  assert.equal(overview.marketDistribution.globalPercent, 50);
  assert.ok(Array.isArray(overview.modelDistribution));
  assert.ok(overview.modelDistribution.some((m) => m.model === "gemini-4-hydrogen"));
});

test("9. HTTP & Security: Admin routes require admin authorization, client route validates strictly", async (t) => {
  const { service } = await createFixture(t);

  const app = express();
  app.use(express.json());

  const requireAdmin = createRequireAdmin(new Set(["admin-1"]));

  // Mock auth middleware for testing
  const authMock = (role) => (req, res, next) => {
    if (role === "admin") {
      req.user = { id: "admin-1", username: "admin_user", email: "admin@helmer.ai", emailVerifiedAt: new Date().toISOString() }; req.auth = { session: { mfaVerifiedAt: Date.now() } };
      req.ownerId = "admin-1";
    } else if (role === "user") {
      req.user = { username: "regular_user", email: "user@example.com" };
      req.ownerId = "user-1";
    }
    next();
  };

  app.use("/admin/api/telemetry", authMock("admin"), requireAdmin, createTelemetryAdminRouter(service));
  app.use("/api/telemetry", createTelemetryClientRouter(service));

  // 1. Create a server instance for endpoint tests
  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  t.after(() => server.close());
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  // Test client event ingestion with valid schema
  const resValid = await fetch(`${baseUrl}/api/telemetry/event`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      eventType: "export_requested",
      format: "pdf",
      title: "Quarterly Strategy",
    }),
  });
  assert.equal(resValid.status, 200);
  const dataValid = await resValid.json();
  assert.equal(dataValid.success, true);

  // Test Mass Assignment rejection (Rule 2): unexpected field must fail validation
  const resInvalid = await fetch(`${baseUrl}/api/telemetry/event`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      eventType: "export_requested",
      format: "pdf",
      injectedRole: "admin", // Unrecognized field
    }),
  });
  assert.equal(resInvalid.status, 400);

  // Test admin overview
  const resOverview = await fetch(`${baseUrl}/admin/api/telemetry/overview`);
  assert.equal(resOverview.status, 200);
  const dataOverview = await resOverview.json();
  assert.ok("totalEvents" in dataOverview);

  // Test admin events feed
  const resEvents = await fetch(`${baseUrl}/admin/api/telemetry/events?page=1&pageSize=10`);
  assert.equal(resEvents.status, 200);
  const dataEvents = await resEvents.json();
  assert.ok(Array.isArray(dataEvents.items));
});
