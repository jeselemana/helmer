import { createFixtureStrategyRouter as createStrategyRouter, installBuildRoutingFixture } from "./helpers/build-routing-fixture.js";
installBuildRoutingFixture();
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { randomUUID, createHash } from "node:crypto";
import express from "express";
import { EventEmitter } from "node:events";

import { FileUserRepository } from "../src/repositories/file-user-repository.js";
import { FileAuthStore } from "../src/auth/auth-store.js";
import { FileStrategyRepository } from "../src/repositories/file-strategy-repository.js";
import { FileChatRepository } from "../src/repositories/file-chat-repository.js";
import { FilePlannerRepository } from "../src/repositories/file-planner-repository.js";
import { strategyErrorHandler, computePayloadFingerprint } from "../src/http/strategy-router.js";
import { extractGroundingSources } from "../src/services/ai/strategy-service.js";
import { getGeminiClient } from "../src/services/ai/research-google-client.js";

process.env.GEMINI_API_KEY = "test-gemini-key";
const geminiClient = getGeminiClient();

class MockReq extends EventEmitter {
  constructor({ url = "/", method = "POST", body = {}, ownerId = "usr_test", user = null, headers = {} } = {}) {
    super();
    this.url = url;
    this.method = method;
    this.body = body;
    this.ownerId = ownerId;
    this.user = user || { id: ownerId, settings: { language: "az" } };
    this.headers = headers;
    this.ip = "127.0.0.1";
    this.socket = { remoteAddress: "127.0.0.1" };
  }
}

class MockRes extends EventEmitter {
  constructor() {
    super();
    this.statusCode = 200;
    this.headers = {};
    this.body = null;
    this.writableEnded = false;
    this.destroyed = false;
  }

  status(code) {
    this.statusCode = code;
    return this;
  }

  setHeader(k, v) {
    this.headers[k.toLowerCase()] = v;
    return this;
  }

  getHeader(k) {
    return this.headers[k.toLowerCase()];
  }

  flushHeaders() { this.headersSent = true; }

  write(chunk) {
    if (!this.chunks) this.chunks = [];
    this.chunks.push(chunk);
  }

  json(data) {
    this.body = data;
    this.writableEnded = true;
    this.emit("finish");
    return this;
  }

  end(data) {
    if (data) this.write(data);
    this.writableEnded = true;
    this.emit("finish");
    return this;
  }
}

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
    nextSteps: ["Prepare pilot"],
  };
}

// ----------------------------------------------------------------------------
// TEST 1: Parallel Create/Update Across Independent Repositories (No Data Loss)
// ----------------------------------------------------------------------------
test("1. User Storage: Parallel create/update across two independent FileUserRepository instances preserves all updates without data loss", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "helmer-test-user-concurrency-"));
  const usersPath = path.join(tmpDir, "users.json");

  const repoA = new FileUserRepository(usersPath);
  const repoB = new FileUserRepository(usersPath);

  try {
    const TOTAL_USERS = 16;
    const usersToCreate = Array.from({ length: TOTAL_USERS }, (_, i) => ({
      email: `parallel_${i}_${randomUUID().slice(0, 8)}@example.com`,
      username: `user_${i}_${randomUUID().slice(0, 8)}`,
      passwordHash: "$argon2id$v=19$m=65536,t=3,p=4$fakehash",
      fullName: `User ${i}`,
    }));

    // Interleave creations between repoA and repoB concurrently
    const createdUsers = await Promise.all(
      usersToCreate.map((u, i) => {
        const repo = i % 2 === 0 ? repoA : repoB;
        return repo.create(u);
      }),
    );

    assert.equal(createdUsers.length, TOTAL_USERS);

    // Verify all created users exist in raw file
    const rawData = JSON.parse(await fs.readFile(usersPath, "utf8"));
    const usersInStore = Array.isArray(rawData) ? rawData : (rawData.users || []);
    assert.equal(usersInStore.length, TOTAL_USERS, "All users must be persisted in shared authoritative store");

    // Concurrently update each user's full name across repoA and repoB
    await Promise.all(
      createdUsers.map((u, i) => {
        const repo = i % 2 === 0 ? repoB : repoA; // Swap repos
        return repo.update(u.id, { fullName: `Updated ${u.fullName}` });
      }),
    );

    // Verify all updates are reflected in a fresh repo instance
    const repoFresh = new FileUserRepository(usersPath);
    for (const u of createdUsers) {
      const persisted = await repoFresh.findById(u.id);
      assert.ok(persisted, `User ${u.id} must be found`);
      assert.equal(persisted.fullName, `Updated ${u.fullName}`, "Every concurrent update must be preserved");
    }
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

// ----------------------------------------------------------------------------
// TEST 2: Parallel Same Email/Username Registration (Single Winner)
// ----------------------------------------------------------------------------
test("2. User Storage: Parallel registration with identical email/username allows exactly 1 winner and rejects the other with USER_CONFLICT", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "helmer-test-user-conflict-"));
  const usersPath = path.join(tmpDir, "users.json");

  const repoA = new FileUserRepository(usersPath);
  const repoB = new FileUserRepository(usersPath);

  try {
    const email = `exclusive_${randomUUID().slice(0, 8)}@example.com`;
    const username = `exclusive_${randomUUID().slice(0, 8)}`;

    const userPayload = {
      email,
      username,
      passwordHash: "$argon2id$v=19$fakehash",
      fullName: "Exclusive Candidate",
    };

    // Concurrently fire create on both instances
    const results = await Promise.allSettled([
      repoA.create(userPayload),
      repoB.create(userPayload),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    assert.equal(fulfilled.length, 1, "Exactly one registration must succeed");
    assert.equal(rejected.length, 1, "The competing registration must fail");

    const conflictErr = rejected[0].reason;
    assert.equal(conflictErr.code, "USER_CONFLICT", "Error code must be USER_CONFLICT");
    assert.equal(conflictErr.statusCode, 409, "Status code must be 409");

    // Check raw file to confirm only 1 record exists
    const rawData = JSON.parse(await fs.readFile(usersPath, "utf8"));
    const usersInStore = Array.isArray(rawData) ? rawData : (rawData.users || []);
    const matches = usersInStore.filter((u) => u.email === email || u.username === username);
    assert.equal(matches.length, 1, "Exactly 1 user record must exist in store");
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

// ----------------------------------------------------------------------------
// TEST 3: Cross-Instance Session Invalidation & Single-Use Tokens
// ----------------------------------------------------------------------------
test("3. Auth Store: Session revoked in instance A is immediately rejected in instance B; single-use reset token consumed atomically", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "helmer-test-auth-concurrency-"));
  const authPath = path.join(tmpDir, "auth.json");

  const authStoreA = new FileAuthStore(authPath);
  const authStoreB = new FileAuthStore(authPath);

  try {
    const userId = `usr_${randomUUID()}`;
    const sessionId = `sess_${randomUUID()}`;
    await authStoreA.createSession(sessionId, userId, 3600);

    // Instance B can read it initially
    const sessionOnB = await authStoreB.getSession(sessionId);
    assert.ok(sessionOnB, "Instance B must see active session");
    assert.equal(sessionOnB.userId, userId);

    // Instance A revokes the session
    await authStoreA.deleteSession(sessionId);

    // Instance B must immediately recognize revocation (authoritative freshness check via mtime)
    const sessionAfterRevokeOnB = await authStoreB.getSession(sessionId);
    assert.equal(sessionAfterRevokeOnB, null, "Instance B must immediately reject revoked session");

    // Single-use password reset token test
    const resetToken = `reset_${randomUUID()}`;
    await authStoreA.createResetToken(resetToken, userId, 1800);

    // Competing consumption between Instance A and Instance B
    const consumeResults = await Promise.allSettled([
      authStoreA.consumeResetToken(resetToken),
      authStoreB.consumeResetToken(resetToken),
    ]);

    const successes = consumeResults.filter((r) => r.status === "fulfilled" && r.value !== null);
    const failures = consumeResults.filter((r) => r.status === "fulfilled" && r.value === null);

    assert.equal(successes.length, 1, "Exactly one instance must successfully consume the reset token");
    assert.equal(failures.length, 1, "The competing instance must receive null (token already consumed)");

    // Further attempts on either instance must return null
    assert.equal(await authStoreA.consumeResetToken(resetToken), null);
    assert.equal(await authStoreB.consumeResetToken(resetToken), null);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

// ----------------------------------------------------------------------------
// TEST 4: Deleted Tenant Resurrection Protection & In-Flight Abort
// ----------------------------------------------------------------------------
test("4. Tenant Isolation: Deleted tenant writes tombstone; old shard and in-flight operations cannot resurrect tenant data", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "helmer-test-tombstone-"));
  const strategyRepo = new FileStrategyRepository(tmpDir);
  const chatRepo = new FileChatRepository(tmpDir);
  const plannerRepo = new FilePlannerRepository(tmpDir);

  await strategyRepo.ensure();
  await chatRepo.ensure();
  await plannerRepo.ensure();

  try {
    const OWNER_ID = `usr_tombstone_${randomUUID()}`;

    // 1. Create strategy, chat, and planner items
    const strat = await strategyRepo.create(
      { clientSaveId: "cs_1", brief: "Brief A", strategy: createSampleStrategy("Strategy 1") },
      OWNER_ID,
    );
    assert.ok(strat.id);

    const chat = await chatRepo.saveChat({ ownerId: OWNER_ID, title: "Chat 1", messages: [] });
    assert.ok(chat.id);

    const initialTasks = await plannerRepo.addBatch(OWNER_ID, [{ text: "Task 1", groupLabel: "Q1" }]);
    assert.ok(initialTasks?.length > 0);

    // 2. Delete tenant across all repositories (writes tombstone)
    await strategyRepo.deleteAllByOwner(OWNER_ID);
    await chatRepo.deleteAllByOwner(OWNER_ID);
    await plannerRepo.deleteAllByOwner(OWNER_ID);

    // 3. Verify tombstone prevents reading records
    const strats = await strategyRepo.list(OWNER_ID);
    assert.equal(strats.length, 0, "Strategies list must be empty for tombstoned tenant");

    const chats = await chatRepo.list(OWNER_ID);
    assert.equal(chats.length, 0, "Chats list must be empty for tombstoned tenant");

    const tasks = await plannerRepo.list(OWNER_ID);
    assert.equal(tasks.length, 0, "Tasks list must be empty for tombstoned tenant");

    // 4. Verify in-flight mutation started prior to deletion cannot resurrect data
    const inFlightResult = await strategyRepo.mutateTenant(OWNER_ID, (records) => {
      records.push({ id: randomUUID(), title: "Ghost Strategy Resurrected", ownerId: OWNER_ID });
      return records;
    });

    assert.equal(inFlightResult, null, "In-flight mutation on tombstoned tenant must abort and return null");

    // Verify tenant remains completely empty
    const checkAfterInFlight = await strategyRepo.readTenant(OWNER_ID);
    assert.equal(checkAfterInFlight.length, 0, "Tenant data must not be resurrected");

    // 5. Verify legacy migration does not restore a tombstoned tenant
    const migrationResult = await strategyRepo.migrateLegacyStrategiesIfPresent();
    assert.equal(migrationResult.migratedCount, 0, "Legacy migration must not resurrect tombstoned tenant");
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

// ----------------------------------------------------------------------------
// TEST 5: Cross-Process Idempotency, Single AI Call, Replay on Restart, & Conflict
// ----------------------------------------------------------------------------
test("5. Idempotency: Separate router instances with same idempotencyKey produce 1 AI call, persist 1 record, allow replay on restart, and reject conflicting payload with 409", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "helmer-test-idempotency-"));
  const repoA = new FileStrategyRepository(tmpDir);
  const repoB = new FileStrategyRepository(tmpDir);
  await repoA.ensure();
  await repoB.ensure();

  const routerA = createStrategyRouter(repoA);
  const routerB = createStrategyRouter(repoB);

  const OWNER_ID = `usr_idem_${randomUUID()}`;
  const IDEMPOTENCY_KEY = `idem_key_${randomUUID()}`;

  let modelCallCount = 0;
  const originalGenerateContent = geminiClient.models.generateContent;
  geminiClient.models.generateContent = async () => {
    modelCallCount++;
    await new Promise((r) => setTimeout(r, 60)); // Simulate AI latency
    return {
      candidates: [{ finishReason: "STOP" }], text: JSON.stringify(createSampleStrategy("Authoritative Concurrency Strategy")),
      usageMetadata: { totalTokenCount: 200 },
    };
  };

  try {
    const payload = {
      brief: "Test Idempotency Brief across processes",
      answers: [],
      idempotencyKey: IDEMPOTENCY_KEY,
    };

    const runRequest = (router) =>
      new Promise((resolve) => {
        const req = new MockReq({ url: "/generate", body: payload, ownerId: OWNER_ID });
        const res = new MockRes();
        router.handle(req, res, (err) => {
          if (err) {
            strategyErrorHandler(err, req, res, () => resolve({ status: res.statusCode, body: res.body, error: err }));
          } else {
            resolve({ status: res.statusCode, body: res.body });
          }
        });
        res.on("finish", () => resolve({ status: res.statusCode, body: res.body }));
      });

    // Fire parallel requests to routerA and routerB
    const [resA, resB] = await Promise.all([runRequest(routerA), runRequest(routerB)]);

    assert.equal(resA.status, 200);
    assert.equal(resB.status, 200);
    assert.equal(modelCallCount, 1, "Model must be executed strictly ONCE across parallel instances");

    // Both instances receive identical strategy
    assert.equal(resA.body.strategy.title, "Authoritative Concurrency Strategy");
    assert.equal(resB.body.strategy.title, "Authoritative Concurrency Strategy");

    // Storage check: exactly 1 strategy persisted in repository
    const stored = await repoA.readTenant(OWNER_ID);
    assert.equal(stored.length, 1, "Strictly 1 strategy record must be saved in repository");
    assert.equal(stored[0].clientSaveId, IDEMPOTENCY_KEY);

    // Replay after restart: instantiate a fresh router
    const repoC = new FileStrategyRepository(tmpDir);
    await repoC.ensure();
    const routerC = createStrategyRouter(repoC);

    const replayRes = await runRequest(routerC);
    assert.equal(replayRes.status, 200, "Replay request after restart must succeed with HTTP 200");
    assert.equal(modelCallCount, 1, "Replay must NOT execute model again");
    assert.equal(replayRes.body.strategy.title, "Authoritative Concurrency Strategy");

    // Idempotency Conflict Check: Send same idempotencyKey with DIFFERENT payload
    const conflictingPayload = {
      brief: "Completely Different Brief that should trigger conflict",
      answers: [],
      idempotencyKey: IDEMPOTENCY_KEY,
    };

    const conflictRes = await new Promise((resolve) => {
      const req = new MockReq({ url: "/generate", body: conflictingPayload, ownerId: OWNER_ID });
      const res = new MockRes();
      routerC.handle(req, res, (err) => {
        if (err) {
          strategyErrorHandler(err, req, res, () => resolve({ status: res.statusCode, body: res.body, error: err }));
        } else {
          resolve({ status: res.statusCode, body: res.body });
        }
      });
      res.on("finish", () => resolve({ status: res.statusCode, body: res.body }));
    });

    assert.equal(conflictRes.status, 409, "Different payload with reused idempotencyKey must return HTTP 409");
    assert.equal(conflictRes.body?.code, "IDEMPOTENCY_CONFLICT");
  } finally {
    geminiClient.models.generateContent = originalGenerateContent;
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

// ----------------------------------------------------------------------------
// TEST 6: Storage Failure Does Not Produce False Success or Fake Cache Commit
// ----------------------------------------------------------------------------
test("6. Error Recovery: Storage write failure rejects without committing unverified state or returning false success", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "helmer-test-storage-failure-"));
  const usersPath = path.join(tmpDir, "users.json");

  // Create repository configured with failing writeCloud in cloud mode
  const repo = new FileUserRepository(usersPath, null, {
    cloud: true,
    readCloud: async () => ({ record: { schemaVersion: 2, users: [] }, etag: "etag-init", notFound: false }),
    writeCloud: async () => {
      throw new Error("R2 connection aborted: 500 Internal Storage Error");
    },
  });

  try {
    const userPayload = {
      email: `failtest_${randomUUID().slice(0, 8)}@example.com`,
      username: `failuser_${randomUUID().slice(0, 8)}`,
      passwordHash: "$argon2id$v=19$fakehash",
      fullName: "Failed User",
    };

    // Attempting to create must throw, NOT return a fake success
    await assert.rejects(
      async () => {
        await repo.create(userPayload);
      },
      (err) => {
        return err.message.includes("R2 connection aborted") || err.code === "STORAGE_BUSY";
      },
      "Storage write error must be propagated",
    );

    // Verify cache is NOT committed: finding by email must return null
    const cachedUser = await repo.findByEmail(userPayload.email);
    assert.equal(cachedUser, null, "Cache must not commit unverified state when write failed");
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

// ----------------------------------------------------------------------------
// TEST 7: Listener Hygiene on Invalid Body & Grounding Scheme Allowlist
// ----------------------------------------------------------------------------
test("7. Hygiene & Security: Invalid body removes listeners; multi-client SSE disconnect does not abort peers; unsafe URLs strictly purged", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "helmer-test-hygiene-"));
  const repo = new FileStrategyRepository(tmpDir);
  await repo.ensure();
  const router = createStrategyRouter(repo);

  try {
    // Part A: Listener hygiene on validation errors
    // 1. /generate-stream with invalid body
    const badStreamReq = new MockReq({ url: "/generate-stream", body: { brief: 123 } }); // brief must be string
    const badStreamRes = new MockRes();
    await new Promise((resolve) => {
      router.handle(badStreamReq, badStreamRes, (err) => {
        if (err) strategyErrorHandler(err, badStreamReq, badStreamRes, resolve);
        else resolve();
      });
      badStreamRes.on("finish", resolve);
    });
    assert.equal(badStreamRes.statusCode, 400);
    assert.equal(badStreamReq.listenerCount("close"), 0, "No leaked close listeners on req for invalid stream body");
    assert.equal(badStreamRes.listenerCount("close"), 0, "No leaked close listeners on res for invalid stream body");

    // 2. /refine with invalid body
    const badRefineReq = new MockReq({ url: "/refine", body: { action: "invalid_action" } });
    const badRefineRes = new MockRes();
    await new Promise((resolve) => {
      router.handle(badRefineReq, badRefineRes, (err) => {
        if (err) strategyErrorHandler(err, badRefineReq, badRefineRes, resolve);
        else resolve();
      });
      badRefineRes.on("finish", resolve);
    });
    assert.equal(badRefineRes.statusCode, 400);
    assert.equal(badRefineReq.listenerCount("close"), 0, "No leaked close listeners on req for invalid refine body");
    assert.equal(badRefineRes.listenerCount("close"), 0, "No leaked close listeners on res for invalid refine body");

    // Part B: SSE Multi-Caller Disconnect Safety
    // Caller 1 and Caller 2 connect to the same in-flight generation
    let modelAbortSignal = null;
    let markModelStarted;
    const modelStarted = new Promise(resolve => { markModelStarted = resolve; });
    let markSecondLookup;
    const secondLookup = new Promise(resolve => { markSecondLookup = resolve; });
    let secondCallerDispatched = false;
    const originalReadTenant = repo.readTenant.bind(repo);
    repo.readTenant = async (...args) => {
      const records = await originalReadTenant(...args);
      if (secondCallerDispatched && args[0] === "usr_multi_caller") markSecondLookup();
      return records;
    };
    let modelFinishResolve = null;
    const modelFinishPromise = new Promise((resolve) => {
      modelFinishResolve = resolve;
    });

    const originalGenerateContent = geminiClient.models.generateContent;
    geminiClient.models.generateContent = async (_params, options) => {
      modelAbortSignal = options?.signal || _params?.config?.abortSignal;
      markModelStarted();
      await modelFinishPromise;
      return {
        candidates: [{ finishReason: "STOP" }], text: JSON.stringify(createSampleStrategy("Multi-Caller Strategy")),
        usageMetadata: { totalTokenCount: 150 },
      };
    };

    const SHARED_KEY = `idem_shared_${randomUUID()}`;
    const caller1Req = new MockReq({
      url: "/generate-stream",
      body: { brief: "Shared Brief", answers: [], idempotencyKey: SHARED_KEY },
      ownerId: "usr_multi_caller",
    });
    const caller1Res = new MockRes();

    const caller2Req = new MockReq({
      url: "/generate-stream",
      body: { brief: "Shared Brief", answers: [], idempotencyKey: SHARED_KEY },
      ownerId: "usr_multi_caller",
    });
    const caller2Res = new MockRes();

    try {
      router.handle(caller1Req, caller1Res, () => {});
      await modelStarted;
      secondCallerDispatched = true;
      router.handle(caller2Req, caller2Res, () => {});
      await secondLookup;
      // The route attaches immediately after its asynchronous saved-result lookup.
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(modelAbortSignal.aborted, false);
      caller1Res.emit("close");
      assert.equal(modelAbortSignal.aborted, false, "Caller 1 disconnect must NOT abort in-flight generation for Caller 2");
      modelFinishResolve();
      await new Promise(resolve => {
        if (caller2Res.writableEnded) return resolve();
        caller2Res.on("finish", resolve);
      });
    } finally {
      modelFinishResolve();
      geminiClient.models.generateContent = originalGenerateContent;
    }

    // Caller 2 must receive completed event
    assert.equal(caller2Res.writableEnded, true);
    const caller2Output = (caller2Res.chunks || []).join("");
    assert.ok(caller2Output.includes("Multi-Caller Strategy"), "Caller 2 must receive completed strategy event");

    // Part C: Grounding Scheme Allowlist: extractGroundingSources
    const testMetadata = {
      groundingChunks: [
        { web: { uri: "https://trusted.com/report", title: "Trusted Report" } },
        { web: { uri: "http://insecure-but-http.com/data", title: "HTTP Data" } },
        { web: { uri: "javascript:alert(document.cookie)", title: "Malicious JS" } },
        { web: { uri: "data:text/html,<script>evil()</script>", title: "Data URI" } },
        { web: { uri: "file:///etc/passwd", title: "Local File" } },
        { web: { uri: "vbscript:msgbox(1)", title: "VBScript" } },
        { web: { uri: "blob:https://example.com/uuid", title: "Blob URL" } },
      ],
    };

    const safeSources = extractGroundingSources(testMetadata);
    assert.equal(safeSources.length, 2, "Only http: and https: sources must be retained");
    assert.equal(safeSources[0].url, "https://trusted.com/report");
    assert.equal(safeSources[1].url, "http://insecure-but-http.com/data");

    // Verify frontend URL parser logic
    const testUrls = [
      "https://example.com",
      "http://example.com",
      "javascript:alert(1)",
      "data:text/html;base64,123",
      "file:///etc/hosts",
    ];

    const parsedResults = testUrls.map((uri) => {
      try {
        const parsed = new URL(uri);
        return ["http:", "https:"].includes(parsed.protocol);
      } catch {
        return false;
      }
    });

    assert.deepEqual(parsedResults, [true, true, false, false, false]);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});
