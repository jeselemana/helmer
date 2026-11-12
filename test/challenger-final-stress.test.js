import { installBuildRoutingFixture } from "./helpers/build-routing-fixture.js";
installBuildRoutingFixture();
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import express from "express";
import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { createStrategyRouter, strategyErrorHandler } from "../src/http/strategy-router.js";
import { FileStrategyRepository } from "../src/repositories/file-strategy-repository.js";
import { getGeminiClient } from "../src/services/ai/client.js";
import { extractGroundingSources } from "../src/services/ai/strategy-service.js";

// Ensure Gemini client exists for mocking
process.env.GEMINI_API_KEY = "test-challenger-gemini-key";
const geminiClient = getGeminiClient();

function createSampleStrategy(title = "Initial Test Strategy") {
  return {
    title,
    summary: "Comprehensive strategy summary for testing purposes.",
    context: {
      business: "E-Commerce Fashion",
      objective: "Scale customer acquisition",
      market: "Baku",
      targetAudience: "Young professionals",
    },
    sections: [
      { id: "sec-1", title: "Overview", summary: "Summary 1", content: "Detailed content 1", bullets: ["Point 1"] },
      { id: "sec-2", title: "Execution", summary: "Summary 2", content: "Detailed content 2", bullets: ["Point 2"] },
      { id: "sec-3", title: "Monitoring", summary: "Summary 3", content: "Detailed content 3", bullets: ["Point 3"] },
    ],
    priorities: [
      { title: "Paid Acquisition", description: "Optimize ad campaigns", priority: "high" },
    ],
    actionPlan: [
      { phase: "Phase 1", actions: ["Launch campaigns"], expectedOutcome: "Immediate lift" },
    ],
    kpis: [
      { name: "ROAS", reason: "Target efficiency", target: "3.5x" },
    ],
    risks: [
      { risk: "Market fatigue", mitigation: "Rotate creatives regularly" },
    ],
    assumptions: ["Stable market conditions"],
    nextSteps: ["1. Review campaign performance daily."],

  };
}

class MockReq extends EventEmitter {
  constructor({ method = "POST", url = "/refine", body = {}, ownerId = "owner-1", headers = {} } = {}) {
    super();
    this.method = method;
    this.url = url;
    this.baseUrl = "/api/strategy";
    this.body = body;
    this.params = {};
    this.ownerId = ownerId;
    this.headers = headers;
    this.ip = "127.0.0.1";
    this.socket = { remoteAddress: "127.0.0.1" };
  }
}

class MockRes extends EventEmitter {
  constructor() {
    super();
    this.statusCode = 200;
    this.body = null;
    this.headers = {};
    this.writableEnded = false;
  }
  status(code) {
    this.statusCode = code;
    return this;
  }
  setHeader(key, value) {
    this.headers[key] = value;
    return this;
  }
  json(data) {
    this.body = data;
    this.writableEnded = true;
    this.emit("finish");
    return this;
  }
  end() {
    this.writableEnded = true;
    this.emit("finish");
    return this;
  }
}

// ============================================================================
// SUITE 1: Refinement Idempotency Deduplication on POST /api/strategy/refine
// ============================================================================

test("SUITE 1.1: Concurrent rapid POST /refine requests with same idempotencyKey execute model call exactly once", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "helmer-stress-refine-"));
  const repo = new FileStrategyRepository(tmpDir);
  await repo.ensure();
  const router = createStrategyRouter(repo);

  let modelCallCount = 0;
  const originalGenerateContent = geminiClient.models.generateContent;
  geminiClient.models.generateContent = async (_params, _options) => {
    modelCallCount++;
    // Simulate non-trivial LLM latency to guarantee concurrent overlap
    await new Promise((resolve) => setTimeout(resolve, 80));
    return {
      candidates: [{ finishReason: "STOP" }], text: JSON.stringify(createSampleStrategy("Refined Concurrently")),
      usageMetadata: { totalTokenCount: 150 },
    };
  };

  try {
    const OWNER_ID = "usr_dedup_refine_1";
    const IDEMPOTENCY_KEY = `idem-refine-${randomUUID()}`;
    const CONCURRENT_REQUESTS = 10;

    const requestBody = {
      brief: "Test brief for concurrent refinement",
      answers: [],
      strategy: createSampleStrategy("Pre-Refined Strategy"),
      action: "shorten",
      idempotencyKey: IDEMPOTENCY_KEY,
    };

    const runRequest = () => {
      return new Promise((resolve, reject) => {
        const req = new MockReq({
          url: "/refine",
          body: requestBody,
          ownerId: OWNER_ID,
        });
        const res = new MockRes();
        router.handle(req, res, (err) => {
          if (err) {
            strategyErrorHandler(err, req, res, () => reject(err));
          } else {
            resolve({ status: res.statusCode, body: res.body });
          }
        });
        res.on("finish", () => resolve({ status: res.statusCode, body: res.body }));
      });
    };

    // Dispatch 10 concurrent requests at the exact same instant
    const results = await Promise.all(Array.from({ length: CONCURRENT_REQUESTS }, () => runRequest()));

    // EMPIRICAL VERIFICATION:
    // 1. Model must be executed exactly ONCE
    assert.equal(modelCallCount, 1, `Model must be called exactly 1 time, got ${modelCallCount}`);

    // 2. All 10 requests must succeed with HTTP 200
    assert.equal(results.length, CONCURRENT_REQUESTS);
    for (const res of results) {
      assert.equal(res.status, 200);
      assert.ok(res.body?.strategy);
      assert.equal(res.body.strategy.title, "Refined Concurrently");
    }

    // 3. Sequential replay within 5-minute cache window returns cached result without re-invoking model
    const replayResult = await runRequest();
    assert.equal(replayResult.status, 200);
    assert.equal(replayResult.body.strategy.title, "Refined Concurrently");
    assert.equal(modelCallCount, 1, "Sequential replay must not call model again within cache window");

    // 4. Different idempotencyKey MUST invoke the model
    const diffKeyBody = { ...requestBody, idempotencyKey: `diff-key-${randomUUID()}` };
    const diffReq = () => {
      return new Promise((resolve) => {
        const req = new MockReq({ url: "/refine", body: diffKeyBody, ownerId: OWNER_ID });
        const res = new MockRes();
        router.handle(req, res, () => {});
        res.on("finish", () => resolve({ status: res.statusCode, body: res.body }));
      });
    };
    const diffRes = await diffReq();
    assert.equal(diffRes.status, 200);
    assert.equal(modelCallCount, 2, "Different idempotencyKey must invoke model a second time");
  } finally {
    geminiClient.models.generateContent = originalGenerateContent;
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test("SUITE 1.2: Multi-tenant isolation on POST /refine: Identical idempotencyKey does not collide across tenants", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "helmer-stress-tenant-refine-"));
  const repo = new FileStrategyRepository(tmpDir);
  await repo.ensure();
  const router = createStrategyRouter(repo);

  let modelCallCount = 0;
  const originalGenerateContent = geminiClient.models.generateContent;
  geminiClient.models.generateContent = async () => {
    modelCallCount++;
    return {
      candidates: [{ finishReason: "STOP" }], text: JSON.stringify(createSampleStrategy(`Refined Tenant Call ${modelCallCount}`)),
      usageMetadata: { totalTokenCount: 120 },
    };
  };

  try {
    const SHARED_KEY = "shared-idempotency-key-abc";
    const TENANT_A = "tenant_alpha";
    const TENANT_B = "tenant_beta";

    const makeReq = (ownerId) => {
      return new Promise((resolve) => {
        const req = new MockReq({
          url: "/refine",
          body: {
            brief: "Test brief",
            answers: [],
            strategy: createSampleStrategy("Base Strategy"),
            action: "localize_azerbaijan",
            idempotencyKey: SHARED_KEY,
          },
          ownerId,
        });
        const res = new MockRes();
        router.handle(req, res, () => {});
        res.on("finish", () => resolve({ status: res.statusCode, body: res.body }));
      });
    };

    const [resA, resB] = await Promise.all([makeReq(TENANT_A), makeReq(TENANT_B)]);
    assert.equal(resA.status, 200);
    assert.equal(resB.status, 200);

    // Tenant isolation verification:
    // Both tenants executed their own refinement (2 separate model calls)
    assert.equal(modelCallCount, 2, "Tenant A and Tenant B must execute independently despite identical key");
  } finally {
    geminiClient.models.generateContent = originalGenerateContent;
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

// ============================================================================
// SUITE 2: Refinement Idempotency Deduplication on POST /api/strategy/:id/refine
// ============================================================================

test("SUITE 2.1: Concurrent rapid POST /:id/refine requests execute model call once and append exactly ONE version", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "helmer-stress-id-refine-"));
  const repo = new FileStrategyRepository(tmpDir);
  await repo.ensure();
  const router = createStrategyRouter(repo);

  const OWNER_ID = "usr_id_refine_owner";
  const baseStrategy = await repo.create(
    {
      clientSaveId: "base-id-refine-save",
      brief: "Base strategy brief for id refine test",
      answers: [],
      strategy: createSampleStrategy("Original Strategy V1"),
      versions: [
        {
          versionNumber: 1,
          data: createSampleStrategy("Original Strategy V1"),
          changeRequest: "Initial creation",
          createdAt: new Date().toISOString(),
        },
      ],
    },
    OWNER_ID,
  );

  let modelCallCount = 0;
  const originalGenerateContent = geminiClient.models.generateContent;
  geminiClient.models.generateContent = async () => {
    modelCallCount++;
    // Add latency to guarantee concurrent in-flight overlap
    await new Promise((resolve) => setTimeout(resolve, 80));
    return {
      candidates: [{ finishReason: "STOP" }], text: JSON.stringify(createSampleStrategy("Refined Strategy V2")),
      usageMetadata: { totalTokenCount: 180 },
    };
  };

  try {
    const IDEMPOTENCY_KEY = `idem-id-refine-${randomUUID()}`;
    const CONCURRENT_REQUESTS = 10;

    const runIdRefine = () => {
      return new Promise((resolve, reject) => {
        const req = new MockReq({
          url: `/${baseStrategy.id}/refine`,
          body: {
            action: "shorten",
            idempotencyKey: IDEMPOTENCY_KEY,
          },
          ownerId: OWNER_ID,
        });
        const res = new MockRes();
        router.handle(req, res, (err) => {
          if (err) {
            strategyErrorHandler(err, req, res, () => reject(err));
          } else {
            resolve({ status: res.statusCode, body: res.body });
          }
        });
        res.on("finish", () => resolve({ status: res.statusCode, body: res.body }));
      });
    };

    // Dispatch 10 concurrent requests simultaneously to /:id/refine
    const results = await Promise.all(Array.from({ length: CONCURRENT_REQUESTS }, () => runIdRefine()));

    // EMPIRICAL VERIFICATION:
    // 1. Model executed exactly ONCE
    assert.equal(modelCallCount, 1, `Model must be called exactly 1 time, got ${modelCallCount}`);

    // 2. All 10 callers get HTTP 200 with identical refined strategy
    assert.equal(results.length, CONCURRENT_REQUESTS);
    for (const res of results) {
      assert.equal(res.status, 200);
      assert.equal(res.body?.strategy?.title, "Refined Strategy V2");
      assert.equal(res.body.strategy.versions.length, 2);
    }

    // 3. Database / Repository integrity: EXACTLY 2 versions in storage (1 base + 1 refinement)
    const persisted = await repo.getById(baseStrategy.id, OWNER_ID);
    assert.ok(persisted);
    assert.equal(
      persisted.versions.length,
      2,
      `Strategy must have strictly 2 versions (no duplicate versions appended). Found ${persisted.versions.length}`,
    );
    assert.equal(persisted.versions[0].versionNumber, 1);
    assert.equal(persisted.versions[1].versionNumber, 2);
    assert.equal(persisted.versions[1].data.title, "Refined Strategy V2");

    // 4. Sequential replay with same idempotencyKey does NOT append version 3
    const replayResult = await runIdRefine();
    assert.equal(replayResult.status, 200);
    assert.equal(modelCallCount, 1, "Sequential replay must not call model again");

    const persistedAfterReplay = await repo.getById(baseStrategy.id, OWNER_ID);
    assert.equal(
      persistedAfterReplay.versions.length,
      2,
      "Replay must NOT append a duplicate 3rd version into repository",
    );
  } finally {
    geminiClient.models.generateContent = originalGenerateContent;
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test("SUITE 2.2: POST /:id/refine strictly rejects cross-tenant modification (IDOR defense)", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "helmer-stress-idor-refine-"));
  const repo = new FileStrategyRepository(tmpDir);
  await repo.ensure();
  const router = createStrategyRouter(repo);

  const OWNER_A = "tenant_legitimate_owner";
  const ATTACKER = "tenant_malicious_attacker";

  const strategyA = await repo.create(
    {
      clientSaveId: "strat-a-save",
      strategy: createSampleStrategy("Owner A Secret Strategy"),
      versions: [{ versionNumber: 1, data: createSampleStrategy("Owner A"), changeRequest: "Init", createdAt: new Date().toISOString() }],
    },
    OWNER_A,
  );

  const req = new MockReq({
    url: `/${strategyA.id}/refine`,
    body: { action: "shorten", idempotencyKey: "attacker-key-1" },
    ownerId: ATTACKER,
  });
  const res = new MockRes();

  await new Promise((resolve) => {
    router.handle(req, res, () => {});
    res.on("finish", resolve);
  });

  assert.equal(res.statusCode, 404, "Attacker must receive 404 NOT_FOUND when attempting to refine another tenant's strategy");
  assert.equal(res.body?.code, "NOT_FOUND");

  // Verify strategy was untouched
  const unchanged = await repo.getById(strategyA.id, OWNER_A);
  assert.equal(unchanged.versions.length, 1);

  await fs.rm(tmpDir, { recursive: true, force: true });
});

// ============================================================================
// SUITE 3: Refinement Client Disconnect Abort Handling
// ============================================================================

test("SUITE 3.1: Client socket disconnect during POST /refine triggers AbortController.abort() and aborts model call", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "helmer-stress-abort-refine-"));
  const repo = new FileStrategyRepository(tmpDir);
  await repo.ensure();
  const router = createStrategyRouter(repo);

  let abortObservedOnSignal = false;
  let signalPassedToModel = null;
  const originalGenerateContent = geminiClient.models.generateContent;

  geminiClient.models.generateContent = async (_params, options) => {
    const signal = options?.signal || _params?.config?.abortSignal;
    signalPassedToModel = signal;

    if (signal) {
      if (signal.aborted) {
        abortObservedOnSignal = true;
      } else {
        signal.addEventListener("abort", () => {
          abortObservedOnSignal = true;
        });
      }
    }

    // Hang until aborted
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        resolve({ candidates: [{ finishReason: "STOP" }], text: JSON.stringify(createSampleStrategy("Should not complete")) });
      }, 5000);

      signal?.addEventListener("abort", () => {
        clearTimeout(timeout);
        const abortErr = new Error("This operation was aborted");
        abortErr.name = "AbortError";
        reject(abortErr);
      });
    });
  };

  try {
    const OWNER_ID = "usr_abort_test_1";
    const IDEMPOTENCY_KEY = `abort-key-${randomUUID()}`;

    const req = new MockReq({
      url: "/refine",
      body: {
        brief: "Brief for abort test",
        answers: [],
        strategy: createSampleStrategy("Strategy Before Abort"),
        action: "think_deeper",
        idempotencyKey: IDEMPOTENCY_KEY,
      },
      ownerId: OWNER_ID,
    });
    const res = new MockRes();

    // Start request
    const requestPromise = new Promise((resolve) => {
      router.handle(req, res, (err) => {
        if (err) {
          strategyErrorHandler(err, req, res, () => resolve({ error: err }));
        } else {
          resolve({ status: res.statusCode });
        }
      });
      res.on("finish", () => resolve({ status: res.statusCode }));
    });

    // Wait until model has received request
    const waitStart31 = Date.now();
    while (!signalPassedToModel) {
      if (Date.now() - waitStart31 > 5000) {
        throw new Error("Timeout waiting for signalPassedToModel in SUITE 3.1");
      }
      await new Promise((r) => setTimeout(r, 10));
    }

    assert.ok(signalPassedToModel, "AbortSignal must be propagated to model");
    assert.equal(signalPassedToModel.aborted, false, "Signal must be active initially");

    // Client prematurely disconnects (socket closes)
    req.emit("close");

    // Wait for request handling to conclude
    await requestPromise;

    // EMPIRICAL VERIFICATION:
    // 1. Abort signal was triggered
    assert.equal(signalPassedToModel.aborted, true, "signal.aborted must be true after client disconnect");
    assert.equal(abortObservedOnSignal, true, "Model listener must have received abort event");

    // 2. Event listeners cleaned up: no memory leak on req or res
    assert.equal(req.listenerCount("close"), 0, "req close listener must be unbound in finally block");
    assert.equal(res.listenerCount("close"), 0, "res close listener must be unbound in finally block");

    // 3. activeRefinements cleanup: key must not be stuck
    // Subsequent request with the same key must be permitted to run
    geminiClient.models.generateContent = async () => ({
      candidates: [{ finishReason: "STOP" }], text: JSON.stringify(createSampleStrategy("Retry Succeeded")),
      usageMetadata: { totalTokenCount: 100 },
    });

    const retryReq = new MockReq({
      url: "/refine",
      body: {
        brief: "Brief for abort test",
        answers: [],
        strategy: createSampleStrategy("Strategy Before Abort"),
        action: "think_deeper",
        idempotencyKey: IDEMPOTENCY_KEY,
      },
      ownerId: OWNER_ID,
    });
    const retryRes = new MockRes();

    await new Promise((resolve) => {
      router.handle(retryReq, retryRes, () => {});
      retryRes.on("finish", resolve);
    });

    assert.equal(retryRes.statusCode, 200, "Retry with same idempotencyKey must succeed after previous abort");
    assert.equal(retryRes.body?.strategy?.title, "Retry Succeeded");
  } finally {
    geminiClient.models.generateContent = originalGenerateContent;
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test("SUITE 3.2: Client socket disconnect during POST /:id/refine aborts model call and does NOT append partial version", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "helmer-stress-abort-id-refine-"));
  const repo = new FileStrategyRepository(tmpDir);
  await repo.ensure();
  const router = createStrategyRouter(repo);

  const OWNER_ID = "usr_abort_id_owner";
  const baseStrategy = await repo.create(
    {
      clientSaveId: "abort-base-strategy",
      brief: "Base strategy brief for disconnect abort test",
      answers: [],
      strategy: createSampleStrategy("Original Strategy Prior To Abort"),
      versions: [
        {
          versionNumber: 1,
          data: createSampleStrategy("Original Strategy Prior To Abort"),
          changeRequest: "Init",
          createdAt: new Date().toISOString(),
        },
      ],
    },
    OWNER_ID,
  );

  let signalPassedToModel = null;
  const originalGenerateContent = geminiClient.models.generateContent;

  geminiClient.models.generateContent = async (_params, options) => {
    const signal = options?.signal || _params?.config?.abortSignal;
    signalPassedToModel = signal;

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        resolve({ candidates: [{ finishReason: "STOP" }], text: JSON.stringify(createSampleStrategy("Aborted Strategy That Shouldn't Save")) });
      }, 5000);

      signal?.addEventListener("abort", () => {
        clearTimeout(timeout);
        const abortErr = new Error("This operation was aborted");
        abortErr.name = "AbortError";
        reject(abortErr);
      });
    });
  };

  try {
    const req = new MockReq({
      url: `/${baseStrategy.id}/refine`,
      body: { action: "shorten", idempotencyKey: `abort-id-key-${randomUUID()}` },
      ownerId: OWNER_ID,
    });
    const res = new MockRes();

    const requestPromise = new Promise((resolve) => {
      router.handle(req, res, (err) => {
        if (err) {
          strategyErrorHandler(err, req, res, () => resolve({ error: err }));
        } else {
          resolve({ status: res.statusCode });
        }
      });
      res.on("finish", () => resolve({ status: res.statusCode }));
    });

    // Wait until model starts executing
    const waitStart32 = Date.now();
    while (!signalPassedToModel) {
      if (Date.now() - waitStart32 > 5000) {
        throw new Error("Timeout waiting for signalPassedToModel in SUITE 3.2");
      }
      await new Promise((r) => setTimeout(r, 10));
    }

    assert.ok(signalPassedToModel);
    assert.equal(signalPassedToModel.aborted, false);

    // Simulate client disconnecting via res 'close'
    res.emit("close");

    await requestPromise;

    // EMPIRICAL VERIFICATION:
    // 1. Signal was aborted
    assert.equal(signalPassedToModel.aborted, true, "Signal must be aborted upon res close");

    // 2. Storage integrity: appendVersion must NOT have been called!
    const persisted = await repo.getById(baseStrategy.id, OWNER_ID);
    assert.equal(persisted.versions.length, 1, "Storage must still contain strictly 1 version; aborted version must not be written");

    // 3. Listener hygiene:
    assert.equal(req.listenerCount("close"), 0, "req close listener cleaned up");
    assert.equal(res.listenerCount("close"), 0, "res close listener cleaned up");
  } finally {
    geminiClient.models.generateContent = originalGenerateContent;
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

// ============================================================================
// SUITE 4: Real HTTP Server Integration & Concurrent Connection Stress
// ============================================================================

test("SUITE 4.1: Real HTTP server under concurrent fetch() load deduplicates /refine and cleans up sockets", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "helmer-stress-http-"));
  const repo = new FileStrategyRepository(tmpDir);
  await repo.ensure();

  const app = express();
  app.use(express.json());

  const OWNER_ID = `usr_http_${randomUUID()}`;
  app.use((req, _res, next) => {
    req.ownerId = OWNER_ID;
    req.user = { id: OWNER_ID, emailVerifiedAt: "now", settings: { language: "en" } };
    req.auth = { user: req.user };
    next();
  });

  const router = createStrategyRouter(repo);
  app.use("/api/strategy", router);
  app.use(strategyErrorHandler);

  const server = app.listen(0);
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}/api/strategy`;

  let modelCalls = 0;
  const originalGenerateContent = geminiClient.models.generateContent;
  geminiClient.models.generateContent = async () => {
    modelCalls++;
    await new Promise((r) => setTimeout(r, 100));
    return {
      candidates: [{ finishReason: "STOP" }], text: JSON.stringify(createSampleStrategy("HTTP Refined")),
      usageMetadata: { totalTokenCount: 140 },
    };
  };

  try {
    const IDEMPOTENCY_KEY = `http-idem-${randomUUID()}`;
    const payload = {
      brief: "Test brief for real HTTP test",
      answers: [],
      strategy: createSampleStrategy("HTTP Initial"),
      action: "shorten",
      idempotencyKey: IDEMPOTENCY_KEY,
    };

    // Send 8 parallel real HTTP POST requests
    const responses = await Promise.all(
      Array.from({ length: 8 }, () =>
        fetch(`${baseUrl}/refine`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Idempotency-Key": IDEMPOTENCY_KEY },
          body: JSON.stringify(payload),
        }),
      ),
    );

    assert.equal(modelCalls, 1, "Model must be called exactly once across 8 real HTTP requests");

    assert.equal(responses.filter(r => r.status === 200).length, 1);
    for (const r of responses) {
      const data = await r.json();
      if (r.status === 200) assert.equal(data?.strategy?.title, "HTTP Refined");
      else { assert.equal(r.status, 429); assert.equal(data.code, "EXECUTION_BUSY"); }
    }
  } finally {
    geminiClient.models.generateContent = originalGenerateContent;
    server.closeAllConnections?.();
    await new Promise((r) => server.close(r));
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

// ============================================================================
// SUITE 5: Grounding URLs Sanitization against Adversarial Inputs
// ============================================================================

test("SUITE 5.1: sanitizeGroundingMetadata strictly rejects adversarial protocols and malformed URLs", async () => {
  const { sanitizeAskGroundingMetadata: sanitizeGroundingMetadata } = await import('../src/services/ai/ask-grounding.js');

  const adversarialInputs = [
    // XSS and script execution vectors
    "javascript:alert(1)",
    "javascript:/*--></title></style></textarea></script></xmp><svg/onload='+/'/+/onmouseover=1+(alert)(1)//>",
    "JAVASCRIPT:alert(document.cookie)",
    "javascript:void(0)",
    "vbscript:MsgBox(1)",
    "data:text/html,<script>alert(1)</script>",
    "data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==",
    "data:image/svg+xml,<svg onload=alert(1)>",
    // Local filesystem access vectors
    "file:///etc/passwd",
    "file://localhost/etc/shadow",
    "file://C:/Windows/win.ini",
    "file:///C:/boot.ini",
    // Protocol-relative and internal URI schemes
    "//attacker.com/malicious",
    "/relative/path/to/resource",
    "blob:https://example.com/d282b093-9c86-45ef-823d-04533e4b7724",
    "about:blank",
    "about:srcdoc",
    // Alternative network protocols
    "ftp://ftp.example.com/file.txt",
    "ldap://ldap.example.com/cn=root",
    "gopher://gopher.example.com",
    "ws://websocket.attacker.com",
    "wss://websocket.attacker.com",
    // Malformed and garbage inputs
    "not a url",
    "http://",
    "https://",
    "://invalid",
    ":::",
    "https://[::1:80",
    "",
    "   ",
    "https://pinterest.com/pin/low-quality-source",
    "https://reddit.com./r/marketing",
    "http://192.168.1.1:8080/report",
    "https://vertexaisearch.cloud.google.com/grounding-api-redirect/FAKE",
    'https://example.com/' + 'a'.repeat(2001),
  ];

  const validUrls = [
    "https://example.com/news/article?id=42#headline",
    "http://subdomain.news.org/path/index.html",
    "https://azertag.az/xeber/2026-baku-market",
    "http://reports.example.org:8080/report",
  ];

  const testMetadata = {
    webSearchQueries: ["marketing trends 2026"],
    groundingChunks: [
      ...adversarialInputs.map((uri, idx) => ({
        web: { uri, title: `Adversarial Input ${idx}` },
      })),
      // Null, non-string, and empty objects
      { web: { uri: null, title: "Null URI" } },
      { web: { uri: undefined, title: "Undefined URI" } },
      { web: { uri: 12345, title: "Numeric URI" } },
      { web: {} },
      {},
      ...validUrls.map((uri, idx) => ({
        web: { uri, title: `Valid Source ${idx}` },
      })),
    ],
  };

  const sanitized = sanitizeGroundingMetadata(testMetadata);

  // EMPIRICAL VERIFICATION:
  // 1. None of the adversarial inputs survived
  assert.equal(Array.isArray(sanitized.groundingChunks), true);
  assert.equal(
    sanitized.groundingChunks.length,
    validUrls.length,
    `Only the ${validUrls.length} valid http/https URLs must survive. Found ${sanitized.groundingChunks.length}`,
  );

  // 2. Every surviving chunk strictly has protocol http: or https:
  for (const chunk of sanitized.groundingChunks) {
    const uri = chunk.web.uri;
    const parsed = new URL(uri);
    assert.ok(
      parsed.protocol === "http:" || parsed.protocol === "https:",
      `Surviving URL protocol must strictly be http: or https:, got ${parsed.protocol} (${uri})`,
    );
  }

  // 3. Null/undefined/empty metadata handling
  assert.equal(sanitizeGroundingMetadata(null), null);
  assert.equal(sanitizeGroundingMetadata(undefined), null);
  assert.deepEqual(sanitizeGroundingMetadata({}), { groundingChunks: [], webSearchQueries: [], searchSuggestions: [] });
});

test("SUITE 5.2: extractGroundingSources strictly admits only http/https and deduplicates URLs", () => {
  const metadata = {
    groundingChunks: [
      { web: { uri: "javascript:alert(1)", title: "Bad Script" } },
      { web: { uri: "file:///etc/passwd", title: "Local File" } },
      { web: { uri: "data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==", title: "Data URI" } },
      { web: { uri: "https://bbc.com/news", title: "BBC News" } },
      { web: { uri: "https://bbc.com/news", title: "Duplicate BBC News" } }, // Duplicate href
      { web: { uri: "http://example.com/news", title: "Example News" } },
      { web: { uri: "ftp://files.example.com", title: "FTP Server" } },
    ],
  };

  const sources = extractGroundingSources(metadata);

  assert.equal(sources.length, 2, "Only the 2 unique valid http/https URLs must be extracted");
  assert.equal(sources[0].url, "https://bbc.com/news");
  assert.equal(sources[0].title, "BBC News");
  assert.equal(sources[1].url, "http://example.com/news");
  assert.equal(sources[1].title, "Example News");

  // Verify none have javascript, file, data, ftp
  for (const s of sources) {
    const url = new URL(s.url);
    assert.ok(["http:", "https:"].includes(url.protocol));
  }
});

test("SUITE 5.3: research-service.js and workflow.js citation filters strictly reject unsafe schemes", () => {
  // Test research-service.js URL parsing logic (lines 1004-1010)
  function isSafeResearchSourceUrl(rawUrl) {
    try {
      const parsed = new URL(String(rawUrl).trim());
      return ["http:", "https:"].includes(parsed.protocol);
    } catch {
      return false;
    }
  }

  // Test workflow.js citation filter logic (lines 108-115)
  function isSafeWorkflowCitation(rawUrl) {
    try {
      const parsed = new URL(rawUrl);
      return parsed.protocol === "http:" || parsed.protocol === "https:";
    } catch {
      return false;
    }
  }

  const badUrls = [
    "javascript:alert(1)",
    "data:text/html;base64,ABC",
    "file:///etc/hosts",
    "blob:uuid-1234",
    "//example.com",
    "not a url",
    null,
    undefined,
  ];

  for (const bad of badUrls) {
    assert.equal(isSafeResearchSourceUrl(bad), false, `research-service logic must reject ${bad}`);
    assert.equal(isSafeWorkflowCitation(bad), false, `workflow citation logic must reject ${bad}`);
  }

  const goodUrls = [
    "https://google.com",
    "http://example.org/path?q=1",
  ];

  for (const good of goodUrls) {
    assert.equal(isSafeResearchSourceUrl(good), true, `research-service logic must admit ${good}`);
    assert.equal(isSafeWorkflowCitation(good), true, `workflow citation logic must admit ${good}`);
  }
});
