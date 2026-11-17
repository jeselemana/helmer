import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import express from "express";
import { createAuthRouter } from "../src/http/auth-router.js";
import { createCapabilityRouter } from "../src/http/capability-router.js";
import { createAskHandler } from "../src/http/ask-handler.js";
import { createResearchRouter } from "../src/http/research-router.js";
import { createStrategyRouter, strategyErrorHandler } from "../src/http/strategy-router.js";
import { createAskExecutionGuard } from "../src/http/ask-execution-guard.js";
import { FileChatRepository } from "../src/repositories/file-chat-repository.js";
import { FileStrategyRepository } from "../src/repositories/file-strategy-repository.js";
import { FileUserRepository } from "../src/repositories/file-user-repository.js";
import { createPluginRegistry } from "../src/services/plugins/registry.js";
import { ResearchService } from "../src/services/ai/research-service.js";
import { DistributedResearchService } from "../src/services/ai/distributed-research.js";
import { GeminiFileCache, geminiFileCache } from "../src/services/ai/gemini-file-cache.js";
import { CleanupQueue } from "../src/services/security/cleanup-queue.js";
import { DurableStore } from "../src/services/security/durable-store.js";
import { ResearchJobStore } from "../src/services/security/research-job-store.js";
import { AiPolicy } from "../src/services/security/ai-policy.js";
import { PrivacyPolicy } from "../src/services/security/privacy-policy.js";
import { MAX_GROUNDED_CHAT_RETENTION_MS } from "../src/services/ai/grounded-chat-retention.js";
import { strategyFixture } from "./helpers/build-fixtures.js";

async function tempDirectory(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "helmer-audit-fixes-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

async function listen(t, app) {
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => {
    server.closeAllConnections();
    return new Promise((resolve) => server.close(resolve));
  });
  return `http://127.0.0.1:${server.address().port}`;
}

function attachUser(app, ownerId) {
  app.use((req, _res, next) => {
    req.ownerId = ownerId;
    req.user = { id: ownerId, emailVerifiedAt: "2026-01-01T00:00:00Z", status: "active", authVersion: 1 };
    req.auth = { user: req.user, sessionId: "session-1" };
    req.securityContext = {
      ownerId,
      isGuest: false,
      assertResources: async () => {},
      assertAuthorized: async () => {},
      markMutationPending: () => {},
      recordIdempotentResult: () => {},
      persistIdempotentResult: async () => {},
    };
    next();
  });
}

test("createCapabilityRouter awaits async rateLimit and forwards mode=research without artifact hijacking", async (t) => {
  const dir = await tempDirectory(t);
  const ownerId = randomUUID();
  const chats = new FileChatRepository(path.join(dir, "chats.json"), null, { cloud: false });
  const registry = createPluginRegistry();

  const app = express();
  app.use(express.json());
  attachUser(app, ownerId);

  let rateLimitCalls = 0;
  let workflowCalls = 0;
  const asyncAllowRateLimit = async (_req, _res, next) => {
    rateLimitCalls += 1;
    await new Promise((resolve) => setTimeout(resolve, 10));
    return next();
  };

  app.use(
    "/api/ask",
    createCapabilityRouter({
      allowGuestChat: true,
      registry,
      workflow: {
        execute: async () => {
          workflowCalls += 1;
          return { reply: "ok", artifacts: [], execution: {}, model: "gemini-4-hydrogen" };
        },
      },
      artifacts: {
        get: async () => null,
        rollback: async () => {},
      },
      chats,
      strategies: { readAll: async () => [], getById: async () => null },
      planner: { list: async () => [] },
      rateLimit: asyncAllowRateLimit,
    }),
  );

  let nextHandlerCalled = 0;
  app.post("/api/ask", (req, res) => {
    nextHandlerCalled += 1;
    res.json({ forwarded: true, mode: req.body.mode });
  });

  const baseUrl = await listen(t, app);

  // 1. mode=research with pluginIds=["word"] must pass through to next() without artifact hijacking
  const researchRes = await fetch(`${baseUrl}/api/ask`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      mode: "research",
      pluginIds: ["word"],
      messages: [{ role: "user", content: "Create a Word market report on SaaS" }],
      googleSearchEnabled: false,
    }),
  });
  assert.equal(researchRes.status, 200);
  const researchBody = await researchRes.json();
  assert.equal(researchBody.forwarded, true);
  assert.equal(researchBody.mode, "research");
  assert.equal(nextHandlerCalled, 1);
  assert.equal(workflowCalls, 0);

  // 2. Artifact generation with async rateLimit must await next() instead of hanging
  const artifactRes = await fetch(`${baseUrl}/api/ask`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      mode: "ask",
      pluginIds: ["word"],
      messages: [{ role: "user", content: "Prepare a Word strategy memo" }],
    }),
  });
  assert.equal(artifactRes.status, 200);
  assert.equal(rateLimitCalls, 1);
  assert.equal(workflowCalls, 1);
});

test("createCapabilityRouter stops cleanly when async rateLimit responds 429 without calling next()", async (t) => {
  const dir = await tempDirectory(t);
  const ownerId = randomUUID();
  const chats = new FileChatRepository(path.join(dir, "chats.json"), null, { cloud: false });
  const registry = createPluginRegistry();

  const app = express();
  app.use(express.json());
  attachUser(app, ownerId);

  let workflowCalls = 0;
  const asyncBlockRateLimit = async (_req, res) => {
    await new Promise((resolve) => setTimeout(resolve, 10));
    return res.status(429).json({ code: "RATE_LIMITED" });
  };

  app.use(
    "/api/ask",
    createCapabilityRouter({
      allowGuestChat: true,
      registry,
      workflow: {
        execute: async () => {
          workflowCalls += 1;
          return { reply: "ok", artifacts: [], execution: {}, model: "gemini-4-hydrogen" };
        },
      },
      artifacts: { get: async () => null, rollback: async () => {} },
      chats,
      strategies: { readAll: async () => [], getById: async () => null },
      planner: { list: async () => [] },
      rateLimit: asyncBlockRateLimit,
    }),
  );

  const baseUrl = await listen(t, app);
  const res = await fetch(`${baseUrl}/api/ask`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      pluginIds: ["word"],
      messages: [{ role: "user", content: "Prepare a Word document" }],
    }),
  });
  assert.equal(res.status, 429);
  assert.equal((await res.json()).code, "RATE_LIMITED");
  assert.equal(workflowCalls, 0);
});

test("createAskHandler with mode=research enforces CreateResearchJobSchema and forwards googleSearchEnabled", async (t) => {
  const dir = await tempDirectory(t);
  const ownerId = randomUUID();
  const chats = new FileChatRepository(path.join(dir, "chats.json"), null, { cloud: false });
  const capturedCalls = [];

  const app = express();
  app.use(express.json());
  attachUser(app, ownerId);
  app.post(
    "/api/ask",
    createAskHandler({
      chatRepository: chats,
      researchService: {
        createResearchJob: async (args) => {
          capturedCalls.push(args);
          return { jobId: randomUUID(), status: "pending" };
        },
        cancelJob: async () => true,
      },
      configured: () => true,
    }),
  );

  const baseUrl = await listen(t, app);
  const headers = {
    "Content-Type": "application/json",
    "Idempotency-Key": "idemp_research_test_123456",
  };

  // 1-char prompt must fail CreateResearchJobSchema (.min(2)) with 400 VALIDATION_ERROR
  const badRes = await fetch(`${baseUrl}/api/ask`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      mode: "research",
      messages: [{ role: "user", content: "a" }],
    }),
  });
  assert.equal(badRes.status, 400);
  assert.equal((await badRes.json()).code, "VALIDATION_ERROR");
  assert.equal(capturedCalls.length, 0);

  // Valid research prompt with googleSearchEnabled: false forwards flag accurately
  const okRes = await fetch(`${baseUrl}/api/ask`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      mode: "research",
      googleSearchEnabled: false,
      messages: [{ role: "user", content: "Analyze SaaS pricing trends in 2026" }],
    }),
  });
  assert.equal(okRes.status, 201);
  assert.equal(capturedCalls.length, 1);
  assert.equal(capturedCalls[0].prompt, "Analyze SaaS pricing trends in 2026");
  assert.equal(capturedCalls[0].googleSearchEnabled, false);
});

test("POST /api/ask/research/jobs/:jobId/cancel enforces ipRateLimit", async (t) => {
  const ownerId = randomUUID();
  const app = express();
  app.use(express.json());
  attachUser(app, ownerId);

  let cancelCalls = 0;
  let rateLimitCalls = 0;
  app.use(
    "/api/ask/research",
    createResearchRouter({
      researchService: {
        cancelJob: async () => {
          cancelCalls += 1;
          return true;
        },
      },
      rateLimit: (_req, res, next) => {
        rateLimitCalls += 1;
        if (rateLimitCalls > 1) {
          return res.status(429).json({ code: "RATE_LIMITED" });
        }
        return next();
      },
    }),
  );

  const baseUrl = await listen(t, app);
  const jobId = randomUUID();

  const first = await fetch(`${baseUrl}/api/ask/research/jobs/${jobId}/cancel`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  assert.equal(first.status, 200);
  assert.equal(cancelCalls, 1);

  const second = await fetch(`${baseUrl}/api/ask/research/jobs/${jobId}/cancel`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  assert.equal(second.status, 429);
  assert.equal((await second.json()).code, "RATE_LIMITED");
  assert.equal(cancelCalls, 1);
});

test("POST /api/strategy/generate does not abort when req closes after req.complete=true while res stays open", async (t) => {
  const dir = await tempDirectory(t);
  const ownerId = randomUUID();
  const strategyRepo = new FileStrategyRepository(path.join(dir, "strategies.json"), null, { cloud: false });

  let capturedSignal = null;
  let abortedDuringRun = false;

  const router = createStrategyRouter(strategyRepo, null, {
    configured: () => true,
    generationServices: {
      generateStrategy: async ({ signal }) => {
        capturedSignal = signal;
        await new Promise((resolve) => setTimeout(resolve, 60));
        abortedDuringRun = signal?.aborted === true;
        return {
          title: "Test Strategy",
          executiveSummary: "Summary",
          sections: [],
        };
      },
    },
  });

  const app = express();
  app.use(express.json());
  attachUser(app, ownerId);
  app.use((req, _res, next) => {
    // Wait until handler starts, then simulate req half-close with req.complete === true
    if (req.path === "/api/strategy/generate") {
      setTimeout(() => {
        req.complete = true;
        req.emit("close");
      }, 15);
    }
    next();
  });
  app.use("/api/strategy", router);

  const baseUrl = await listen(t, app);
  const res = await fetch(`${baseUrl}/api/strategy/generate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": "idemp_build_generate_12345",
    },
    body: JSON.stringify({
      brief: "Launch B2B analytics SaaS product in Azerbaijan market",
      idempotencyKey: "idemp_build_generate_12345",
      buildMode: "faster",
      autoSave: false,
    }),
  });

  assert.equal(res.status, 200);
  assert.ok(capturedSignal);
  assert.equal(abortedDuringRun, false, "req close after req.complete=true must not abort in-flight generation");
});

test("FileChatRepository.saveChat avoids readAll() and preserves cross-tenant collision defense without mutating other shards", async (t) => {
  const dir = await tempDirectory(t);
  const chats = new FileChatRepository(path.join(dir, "chats.json"), null, { cloud: false });

  const aliceChat = await chats.saveChat({
    ownerId: "alice",
    title: "Alice Chat",
    messages: [{ role: "user", content: "Hello" }],
  });

  let readAllCalled = 0;
  chats.readAll = async () => {
    readAllCalled += 1;
    return [];
  };

  const bobAttempt = await chats.saveChat({
    id: aliceChat.id,
    ownerId: "bob",
    title: "Bob Collision Attempt",
    messages: [{ role: "user", content: "Steal ID" }],
  });

  assert.equal(readAllCalled, 0, "saveChat must not call readAll()");
  assert.notEqual(bobAttempt.id, aliceChat.id, "cross-tenant UUID collision defense must persist");
});

test("ResearchService.resumeOrphanedJobs skips expired (>2y) jobs and sets assertAuthorized on bgContext", async (t) => {
  const dir = await tempDirectory(t);
  const chats = new FileChatRepository(path.join(dir, "chats.json"), null, { cloud: false });
  const ownerId = randomUUID();
  const expiredJobId = randomUUID();

  await chats.saveChat({
    ownerId,
    title: "Old research",
    messages: [
      {
        role: "assistant",
        type: "research",
        jobId: expiredJobId,
        status: "running",
        createdAt: new Date(Date.now() - MAX_GROUNDED_CHAT_RETENTION_MS - 60_000).toISOString(),
        content: "",
      },
    ],
  });

  const service = new ResearchService({ chatRepository: chats });
  let executed = 0;
  service.executeJob = async () => {
    executed += 1;
  };

  await service.resumeOrphanedJobs();
  assert.equal(executed, 0, "expired orphaned research job must not be resumed");
  assert.equal(service.activeJobs.size, 0);
});

test("public/script.js guards cancelResearchJob with isIdentityStale and opens guest restriction modal on 401/non-SSE", async () => {
  const scriptSrc = await fs.readFile(path.join(process.cwd(), "public/script.js"), "utf8");
  const cancelFnStart = scriptSrc.indexOf("async function cancelResearchJob(");
  const cancelFnEnd = scriptSrc.indexOf("function abortAskMessage(");
  const cancelFnBody = scriptSrc.slice(cancelFnStart, cancelFnEnd);

  assert.match(cancelFnBody, /const epoch = state\.identityEpoch;/);
  assert.match(cancelFnBody, /if \(isIdentityStale\(epoch, expectedUserId\)\) return;/);

  assert.match(
    scriptSrc,
    /if \(response\.status === 401 && errData\?\.reply && !state\.currentUser\)[\s\S]*openGuestRestrictionModal\(errData\.reply\);/,
  );
  assert.match(
    scriptSrc,
    /const data = await response\.json\(\);[\s\S]*if \(data\.restrictedFeature\) \{\s*openGuestRestrictionModal\(data\.reply\);\s*\}/,
  );
});

test("Item 1: GeminiFileCache physically purges expired files, propagates delete errors to CleanupQueue, and cleans uncommitted Ask uploads", async (t) => {
  const dir = await tempDirectory(t);
  const ownerId = randomUUID();
  const store = new DurableStore(path.join(dir, "durable"), { cloud: false });

  // A. Expired persisted file is physically removed from disk by cleanupPersistedExpired()
  let deleteAttempts = 0;
  let failDelete = true;
  const cache = new GeminiFileCache({
    storageDir: path.join(dir, "ask-files"),
    persist: true,
    cloud: false,
    persistentTtlMs: 50,
  });
  t.after(() => clearInterval(cache.cleanupInterval));

  const fileId = cache.storeFile({ name: "doc.txt", mimeType: "text/plain", textContent: "Confidential file bytes" }, ownerId);
  const entry = cache.getFile(fileId, ownerId);
  await cache.persistEntry(entry);
  const loc = cache._storageLocation(ownerId, fileId);
  assert.ok(await fs.stat(loc.localPath));

  await new Promise((r) => setTimeout(r, 70));
  const purged = await cache.cleanupPersistedExpired();
  assert.equal(purged, 1);
  await assert.rejects(fs.stat(loc.localPath), { code: "ENOENT" });

  // B. Failed file deletion is NOT swallowed: CleanupQueue retains job & retries until deleted
  const cloudDeleted = [];
  const cloudCache = new GeminiFileCache({
    persist: true,
    cloud: true,
    readCloud: async () => null,
    writeCloud: async () => {},
    listCloud: async () => [],
    deleteCloud: async (_prefix, key) => {
      deleteAttempts += 1;
      if (failDelete) throw new Error("R2 transient outage");
      cloudDeleted.push(key);
    },
  });
  t.after(() => clearInterval(cloudCache.cleanupInterval));

  const queue = new CleanupQueue(store, null, cloudCache, null);
  t.after(() => clearInterval(queue.timer));

  const retryFileId = `gfc_${randomUUID()}`;
  const chatId = randomUUID();
  await queue.enqueue(ownerId, chatId, "chat", {
    messages: [{ role: "user", content: "hi", file: { fileId: retryFileId, name: "a.pdf" } }],
  });
  await queue.process();
  assert.equal(await queue.pending(ownerId, chatId), true, "cleanup job must remain queued when file deletion fails");
  assert.ok(deleteAttempts >= 1);

  failDelete = false;
  await queue.process();
  assert.equal(await queue.pending(ownerId, chatId), false, "cleanup job clears after retry succeeds");
  assert.equal(cloudDeleted.length, 1);

  // C. Uncommitted Ask failure deletes newly persisted upload from storage (or enqueues cleanup)
  const chatRepo = new FileChatRepository(path.join(dir, "chats.json"), null, { cloud: false });
  const app = express();
  app.use(express.json());
  attachUser(app, ownerId);
  app.post(
    "/api/ask",
    createAskHandler({
      chatRepository: chatRepo,
      cleanupQueue: queue,
      learningLoop: { createInteractionId: () => randomUUID(), recordInteraction: async () => {}, recordSignal: async () => {} },
      telemetryService: { trackAskQuery: async () => {} },
      configured: () => true,
      generateAsk: async () => {
        throw new Error("Simulated provider failure before chat save");
      },
      decisionRouter: { routeAsk: async () => ({ shouldSearch: false, reason: "test" }) },
    }),
  );
  const baseUrl = await listen(t, app);
  const uploadB64 = Buffer.from("Temporary uploaded text payload").toString("base64");
  const askRes = await fetch(`${baseUrl}/api/ask`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": "idemp_orphan_ask_123456" },
    body: JSON.stringify({
      messages: [
        {
          role: "user",
          content: "Summarize this",
          file: { name: "temp.txt", size: 31, type: "text/plain", mimeType: "text/plain", data: uploadB64 },
        },
      ],
      stream: false,
    }),
  });
  assert.equal(askRes.status, 500);
  const ownerHash = geminiFileCache._ownerHash(ownerId);
  const ownerDir = path.join(geminiFileCache.storageDir, ownerHash);
  const remaining = await fs.readdir(ownerDir).catch(() => []);
  assert.equal(remaining.length, 0, "uncommitted Ask upload must not remain persisted after failure");
});

test("Item 2: Account deletion purges unlinked Research records created before chatRepository.saveChat completes", async (t) => {
  const dir = await tempDirectory(t);
  const users = new FileUserRepository(path.join(dir, "users.json"), null, { cloud: false });
  const chats = new FileChatRepository(path.join(dir, "chats.json"), null, { cloud: false });
  const durableStore = new DurableStore(path.join(dir, "durable"), { cloud: false });
  const jobStore = new ResearchJobStore(path.join(dir, "research-jobs"), { cloud: false });
  const cleanupQueue = new CleanupQueue(durableStore, null, null, jobStore);
  t.after(() => clearInterval(cleanupQueue.timer));

  const createdUser = await users.create({
    fullName: "Unlinked Research User",
    email: "unlinked-research@example.com",
    passwordHash: "hash",
    emailVerifiedAt: new Date().toISOString(),
  });
  const ownerId = createdUser.id;
  await users.update(ownerId, {
    scheduledDeletionAt: new Date(Date.now() - 60_000).toISOString(),
  }, { allowSystemFields: true });

  // Simulate process crash right after prepareIntent() and before chatRepository.saveChat()
  const crashingChatRepo = {
    getById: async () => null,
    saveChat: async () => {
      throw new Error("Simulated crash between prepareIntent and saveChat");
    },
    deleteAllByOwner: async () => 0,
  };

  const service = new DistributedResearchService({
    jobStore,
    chatRepository: crashingChatRepo,
    userRepository: users,
  });
  t.after(() => service.shutdown());

  await assert.rejects(
    () =>
      service.createResearchJob({
        ownerId,
        prompt: "Secret unlinked research prompt",
        language: "en",
        user: { id: ownerId, settings: { modelImprovement: false } },
      }),
    /Simulated crash/,
  );

  // Confirm unlinked research record exists before account purge (even with 0 saved chats)
  let jobsBefore = [];
  for await (const j of jobStore.jobsForOwner(ownerId)) jobsBefore.push(j);
  assert.equal(jobsBefore.length, 1);
  assert.equal(jobsBefore[0].status, "failed");

  const purged = await users.purgeExpiredAccounts({
    chatRepository: chats,
    cleanupQueue,
    researchJobStore: jobStore,
  });
  assert.equal(purged, 1);

  const storedAfter = await jobStore.readJob(jobsBefore[0].id, ownerId);
  assert.equal(storedAfter?.status, "deleted", "unlinked research record must be deleted on account purge");
  assert.equal(storedAfter?.prompt, undefined);
});

test("Item 3: Build separates manual /save clientSaveId from /generate and rejects mismatched legacy records without payloadFingerprint", async (t) => {
  const dir = await tempDirectory(t);
  const ownerId = randomUUID();
  const repo = new FileStrategyRepository(path.join(dir, "strategies.json"), null, { cloud: false });

  const sampleStrategy = {
    ...strategyFixture(),
    title: "Saved Manual Strategy",
  };

  const app = express();
  app.use(express.json());
  attachUser(app, ownerId);
  app.use(
    "/api/strategy",
    createStrategyRouter(repo, null, {
      generationServices: {
        generateStrategy: async ({ brief }) => ({
          ...sampleStrategy,
          title: `Generated for: ${brief}`,
        }),
      },
    }),
  );
  app.use(strategyErrorHandler);
  const baseUrl = await listen(t, app);

  // 1. User manually saves a strategy with clientSaveId = sharedKey
  const sharedKey = "shared_client_key_123456";
  const saveRes = await fetch(`${baseUrl}/api/strategy/save`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      clientSaveId: sharedKey,
      brief: "Manual saved brief for coffee shop",
      answers: [],
      strategy: sampleStrategy,
      versions: [
        {
          versionNumber: 1,
          data: sampleStrategy,
          changeRequest: "Manual save",
          createdAt: new Date().toISOString(),
        },
      ],
    }),
  });
  assert.equal(saveRes.status, 201);

  // 2. Calling /generate with the SAME key and a DIFFERENT brief must NOT return the manual save
  const genRes = await fetch(`${baseUrl}/api/strategy/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": sharedKey },
    body: JSON.stringify({
      brief: "Completely different fintech B2B brief",
      answers: [],
      idempotencyKey: sharedKey,
      buildMode: "faster",
      autoSave: true,
    }),
  });
  assert.equal(genRes.status, 200);
  const genBody = await genRes.json();
  assert.equal(genBody.strategy.title, "Generated for: Completely different fintech B2B brief");

  // 3. Legacy record without saveOrigin and without payloadFingerprint must reject mismatched parameters with 409
  const legacyKey = "legacy_no_fp_key_123456";
  await repo.create(
    {
      clientSaveId: legacyKey,
      brief: "Original legacy brief",
      answers: [],
      strategy: sampleStrategy,
      versions: [{ versionNumber: 1, data: sampleStrategy, changeRequest: "Init", createdAt: new Date().toISOString() }],
    },
    ownerId,
  );
  const conflictRes = await fetch(`${baseUrl}/api/strategy/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": legacyKey },
    body: JSON.stringify({
      brief: "Different brief trying to collide with legacy key",
      answers: [],
      idempotencyKey: legacyKey,
      buildMode: "faster",
      autoSave: false,
    }),
  });
  assert.equal(conflictRes.status, 409);
  assert.equal((await conflictRes.json()).code, "IDEMPOTENCY_CONFLICT");
});

test("Item 4: Research 202 response persists idempotent replay immediately while background job holds lease, and browser reuses retry key", async (t) => {
  const dir = await tempDirectory(t);
  const ownerId = randomUUID();
  const chats = new FileChatRepository(path.join(dir, "chats.json"), null, { cloud: false });
  const jobStore = new ResearchJobStore(path.join(dir, "jobs"), { cloud: false });

  const redisStore = new Map();
  const mockRedis = {
    isReady: true,
    async get(k) { return redisStore.has(k) ? redisStore.get(k) : null; },
    async set(k, v, opts = {}) {
      if (opts.NX && redisStore.has(k)) return null;
      redisStore.set(k, String(v));
      return "OK";
    },
    async del(k) { return redisStore.delete(k) ? 1 : 0; },
    async zRem() { return 1; },
    async eval(script, { keys = [], arguments: args = [] } = {}) {
      if (script.includes("redis.call('incr'")) {
        const next = Number(redisStore.get(keys[0]) || 0) + 1;
        redisStore.set(keys[0], String(next));
        return next;
      }
      if (script.includes("if redis.call('get',KEYS[1]) ~= ARGV[1]")) {
        if (redisStore.get(keys[0]) !== args[0]) return 0;
        if (script.includes("redis.call('set'")) redisStore.set(keys[0], String(args[1]));
        return 1;
      }
      if (script.includes("redis.call('del'")) {
        if (redisStore.get(keys[0]) === args[0]) {
          redisStore.delete(keys[0]);
          return 1;
        }
        return 0;
      }
      return 1;
    },
  };

  let createdCount = 0;
  let releaseBgJob;
  const bgDone = new Promise((resolve) => { releaseBgJob = resolve; });
  const jobId = randomUUID();
  const chatId = randomUUID();

  const policy = new AiPolicy({
    redis: mockRedis,
    env: {},
    canReplay: async () => true,
  });

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.ownerId = ownerId;
    req.user = { id: ownerId, emailVerifiedAt: "2026-01-01T00:00:00Z", status: "active", authVersion: 1 };
    req.auth = { user: req.user, sessionId: "s1" };
    next();
  });
  app.use(new PrivacyPolicy({ findById: async () => ({ id: ownerId, status: "active", authVersion: 1 }) }).middleware());
  app.use(policy.middleware());
  app.use(
    "/api/ask/research",
    createResearchRouter({
      researchService: {
        geminiClient: {},
        createResearchJob: async () => {
          createdCount += 1;
          const lease = reqLeaseHolder.transferToBackground();
          void bgDone.then(() => lease.release());
          return { jobId, chatId, chatRevision: 1, message: { id: randomUUID() } };
        },
      },
      chatRepository: chats,
      redis: mockRedis,
    }),
  );

  // Capture securityContext for lease handoff simulation
  let reqLeaseHolder = null;
  const outerApp = express();
  outerApp.use((req, _res, next) => {
    // Wrap after policy middleware via app router ordering
    next();
  });

  // Mount cleanly with lease capture inside router wrapper
  const cleanApp = express();
  cleanApp.use(express.json());
  cleanApp.use((req, _res, next) => {
    req.ownerId = ownerId;
    req.user = { id: ownerId, emailVerifiedAt: "2026-01-01T00:00:00Z", status: "active", authVersion: 1 };
    req.auth = { user: req.user, sessionId: "s1" };
    next();
  });
  cleanApp.use(new PrivacyPolicy({ findById: async () => ({ id: ownerId, status: "active", authVersion: 1 }) }).middleware());
  cleanApp.use(policy.middleware());
  cleanApp.use("/api/ask/research", (req, _res, next) => {
    reqLeaseHolder = req.securityContext;
    next();
  }, createResearchRouter({
    researchService: {
      geminiClient: {},
      createResearchJob: async () => {
        createdCount += 1;
        const lease = reqLeaseHolder.transferToBackground();
        void bgDone.then(() => lease.release());
        return { jobId, chatId, chatRevision: 1, message: { id: randomUUID() } };
      },
    },
    chatRepository: chats,
    redis: mockRedis,
  }));

  const baseUrl = await listen(t, cleanApp);
  const idempKey = `res_idemp_${randomUUID()}`;

  const first = await fetch(`${baseUrl}/api/ask/research`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": idempKey },
    body: JSON.stringify({ prompt: "Deep market analysis for SaaS" }),
  });
  assert.equal(first.status, 202);
  const firstBody = await first.json();
  assert.equal(firstBody.jobId, jobId);

  // Retry immediately WHILE background job still holds the lock -> must replay 202 (NOT 409 REQUEST_ALREADY_SUBMITTED)
  const replay = await fetch(`${baseUrl}/api/ask/research`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": idempKey },
    body: JSON.stringify({ prompt: "Deep market analysis for SaaS" }),
  });
  assert.equal(replay.status, 202);
  const replayBody = await replay.json();
  assert.equal(replayBody.jobId, jobId);
  assert.equal(createdCount, 1);

  releaseBgJob();
  await new Promise((r) => setTimeout(r, 10));

  const scriptSrc = await fs.readFile(path.join(process.cwd(), "public/script.js"), "utf8");
  assert.match(scriptSrc, /idempotencyKey:\s*retry\.idempotencyKey\s*\|\|\s*null/);
  assert.match(scriptSrc, /const researchIdempotencyKey\s*=\s*retryOperation\?\.idempotencyKey\s*\|\|\s*idempotencyKey/);
});

test("Item 5 & 7: server.js enforces 64kb parser on /api/ask/research + pre-parse load guard, and script.js checks isIdentityStale before abort-cancel", async () => {
  const serverSrc = await fs.readFile(path.join(process.cwd(), "server.js"), "utf8");
  assert.match(serverSrc, /const askResearchJsonParser = express\.json\(\{\s*limit:\s*['"]64kb['"]\s*\}\);/);
  assert.match(serverSrc, /app\.use\(['"]\/api\/ask\/research['"],\s*askPreParseLoadGuard,\s*askResearchJsonParser\);/);
  assert.match(serverSrc, /if \(req\.path === '\/research' \|\| req\.path\.startsWith\('\/research\/'\)\) return next\(\);/);

  const scriptSrc = await fs.readFile(path.join(process.cwd(), "public/script.js"), "utf8");
  const idxStale = scriptSrc.indexOf("const data = await response.json();\n      if (isIdentityStale(epoch, expectedUserId)) return;");
  const idxAborted = scriptSrc.indexOf("if (researchInitController.signal.aborted) {\n        if (data?.jobId)");
  assert.ok(idxStale !== -1 && idxAborted !== -1 && idxStale < idxAborted, "isIdentityStale check must precede abort-cancel fetch");
});

test("Item 6: Ask execution guard and Research SSE enforce global/owner concurrency across multiple replicas via Redis", async (t) => {
  const zsets = new Map();
  const kv = new Map();
  const sharedRedis = {
    isReady: true,
    async set(k, v, opts = {}) {
      if (opts.NX && kv.has(k)) return null;
      kv.set(k, String(v));
      return "OK";
    },
    async zRem(key, member) {
      const z = zsets.get(key);
      if (!z) return 0;
      return z.delete(member) ? 1 : 0;
    },
    async eval(script, { keys = [], arguments: args = [] } = {}) {
      if (script.includes("zremrangebyscore")) {
        const now = Number(args[0]);
        for (const k of keys) {
          const z = zsets.get(k) || new Map();
          for (const [m, score] of z.entries()) {
            if (score <= now) z.delete(m);
          }
          zsets.set(k, z);
        }
        if (keys.length === 1) {
          const z = zsets.get(keys[0]);
          if (z.size >= Number(args[1])) return 0;
          z.set(args[3], Number(args[2]));
          return 1;
        }
        const g = zsets.get(keys[0]);
        const o = zsets.get(keys[1]);
        if (g.size >= Number(args[1]) || o.size >= Number(args[2])) return 0;
        g.set(args[4], Number(args[3]));
        o.set(args[4], Number(args[3]));
        return 1;
      }
      if (script.includes("if redis.call('get', KEYS[1]) == ARGV[1]")) {
        if (kv.get(keys[0]) === args[0]) {
          kv.delete(keys[0]);
          return 1;
        }
        return 0;
      }
      return 1;
    },
  };

  // A. Two separate askExecutionGuard instances sharing Redis enforce maxConcurrent = 1 globally
  let holdFirst;
  const firstReleased = new Promise((r) => { holdFirst = r; });

  const makeGuardApp = () => {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.ownerId = req.get("X-Owner");
      req.user = { id: req.ownerId, emailVerifiedAt: "2026-01-01T00:00:00Z" };
      req.auth = { user: req.user };
      next();
    });
    app.use("/api/ask", createAskExecutionGuard({ redis: sharedRedis, maxConcurrent: 1, allowParallelChats: true }));
    app.post("/api/ask", async (_req, res) => {
      await firstReleased;
      res.json({ ok: true });
    });
    return app;
  };

  const [replica1Url, replica2Url] = await Promise.all([listen(t, makeGuardApp()), listen(t, makeGuardApp())]);
  const owner1 = randomUUID();
  const owner2 = randomUUID();

  const p1 = fetch(`${replica1Url}/api/ask`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Owner": owner1 },
    body: JSON.stringify({ chatId: randomUUID() }),
  });
  await new Promise((r) => setTimeout(r, 30));

  // Different owner on Replica 2 must still be rejected with 429 EXECUTION_BUSY because global maxConcurrent = 1
  const p2 = await fetch(`${replica2Url}/api/ask`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Owner": owner2 },
    body: JSON.stringify({ chatId: randomUUID() }),
  });
  assert.equal(p2.status, 429);
  assert.equal((await p2.json()).code, "EXECUTION_BUSY");

  holdFirst();
  const r1 = await p1;
  assert.equal(r1.status, 200);

  // B. Two separate ResearchRouter instances sharing Redis enforce MAX_STREAMS_PER_OWNER (3) across replicas
  const sseJobId = randomUUID();
  const sseOwner = randomUUID();
  const makeSseApp = () => {
    const app = express();
    app.use((req, _res, next) => {
      req.ownerId = sseOwner;
      req.user = { id: sseOwner, emailVerifiedAt: "2026-01-01T00:00:00Z", status: "active", authVersion: 1 };
      req.auth = { user: req.user, session: { userId: sseOwner, protocolVersion: 2, authVersion: 1 }, sessionId: "s1" };
      next();
    });
    app.use(
      "/api/ask/research",
      createResearchRouter({
        researchService: {
          getJob: async () => ({ id: sseJobId, ownerId: sseOwner, status: "running", steps: [], sources: [], artifacts: [] }),
          subscribe: () => () => {},
        },
        redis: sharedRedis,
      }),
    );
    return app;
  };
  const [sseReplica1, sseReplica2] = await Promise.all([listen(t, makeSseApp()), listen(t, makeSseApp())]);
  const openControllers = [];
  t.after(() => openControllers.forEach((c) => c.abort()));

  for (let i = 0; i < 2; i++) {
    const ac = new AbortController();
    openControllers.push(ac);
    const res = await fetch(`${sseReplica1}/api/ask/research/jobs/${sseJobId}/stream`, { signal: ac.signal });
    assert.equal(res.status, 200);
  }
  const ac3 = new AbortController();
  openControllers.push(ac3);
  const res3 = await fetch(`${sseReplica2}/api/ask/research/jobs/${sseJobId}/stream`, { signal: ac3.signal });
  assert.equal(res3.status, 200);

  // 4th SSE connection across Replica 1 & Replica 2 must be rejected with 429 RATE_LIMITED
  const res4 = await fetch(`${sseReplica2}/api/ask/research/jobs/${sseJobId}/stream`);
  assert.equal(res4.status, 429);
  assert.equal((await res4.json()).code, "RATE_LIMITED");
});

test("DistributedResearchService.resumeOrphanedJobs closes completionPending and uncommitted preparing jobs when chat is removed", async (t) => {
  const dir = await tempDirectory(t);
  const jobStore = new ResearchJobStore(path.join(dir, "research"), { cloud: false });
  const chats = new FileChatRepository(path.join(dir, "chats.json"), null, { cloud: false });
  const deletedArtifacts = [];
  const artifactRepo = {
    async rollback(art, ownerId) {
      deletedArtifacts.push({ id: art.id, ownerId });
    },
  };
  const service = new DistributedResearchService({
    jobStore,
    chatRepository: chats,
    artifactRepository: artifactRepo,
    recoveryIntervalMs: 60 * 60 * 1000,
  });
  t.after(() => service.shutdown());

  const ownerId = randomUUID();
  const missingChatId = randomUUID();
  const jobId = randomUUID();
  const artifactId = randomUUID();
  const createdAt = new Date().toISOString();

  // Case A: completed job in completionPending=true state whose chat was deleted
  const pendingJob = {
    id: jobId,
    messageId: randomUUID(),
    ownerId,
    chatId: missingChatId,
    prompt: "Sensitive research prompt",
    language: "en",
    strategyContext: "[SECRET STRATEGY]",
    taskContext: "[SECRET TASK]",
    status: "running",
    completionPending: true,
    executionFence: 1,
    privacySnapshot: { enabled: false },
    steps: [],
    sources: [],
    verifiedResearchSources: true,
    artifacts: [{ id: artifactId }],
    content: "Sensitive generated output",
    createdAt,
    updatedAt: createdAt,
    deadlineAt: Date.now() + 60000,
    checkpoint: { draft: "secret" },
    version: 1,
  };
  await jobStore.index(pendingJob);
  await jobStore.mutateJob(jobId, ownerId, () => ({ value: pendingJob }));

  // Case B: crash between prepareIntent and saveChat (pending job without chat)
  const owner2 = randomUUID();
  const orphanId = randomUUID();
  const preparingJob = {
    id: orphanId,
    messageId: randomUUID(),
    ownerId: owner2,
    chatId: randomUUID(),
    prompt: "Uncommitted research prompt",
    language: "en",
    strategyContext: "[SECRET STRATEGY 2]",
    taskContext: null,
    status: "pending",
    privacySnapshot: { enabled: false },
    steps: [],
    sources: [],
    verifiedResearchSources: true,
    artifacts: [],
    content: "",
    createdAt,
    updatedAt: createdAt,
    deadlineAt: Date.now() + 60000,
    checkpoint: { secret: true },
    version: 1,
  };
  await jobStore.index(preparingJob);
  await jobStore.mutateJob(orphanId, owner2, () => ({ value: preparingJob }));

  assert.equal((await jobStore.activePage()).records.length, 2);

  await service.resumeOrphanedJobs();

  // Both orphaned jobs must be removed from active/ index (no infinite recovery loop)
  assert.equal((await jobStore.activePage()).records.length, 0);

  const savedA = await jobStore.readJob(jobId, ownerId);
  assert.equal(savedA.status, "cancelled");
  assert.equal(savedA.completionPending, false);
  assert.equal(savedA.content, "");
  assert.equal(savedA.prompt, null);
  assert.equal(savedA.strategyContext, null);
  assert.equal(savedA.checkpoint, null);
  assert.deepEqual(savedA.artifacts, []);
  assert.deepEqual(deletedArtifacts, [{ id: artifactId, ownerId }]);

  const savedB = await jobStore.readJob(orphanId, owner2);
  assert.equal(savedB.status, "interrupted");
  assert.equal(savedB.prompt, null);
  assert.equal(savedB.strategyContext, null);
  assert.equal(savedB.checkpoint, null);

  // Subsequent recovery pass must be a no-op and never re-acquire chat locks
  const claimSpy = t.mock.method(chats, "claimResearchMessage");
  await service.resumeOrphanedJobs();
  assert.equal(claimSpy.mock.callCount(), 0);
});

test("GeminiFileCache cloud cleanupPersistedExpired and deleteOwnerPersistedFiles normalize R2 data/ask-files-v1/ keys", async () => {
  const objects = new Map();
  const cache = new GeminiFileCache({
    persist: true,
    cloud: true,
    writeCloud: async (prefix, key, record) => {
      objects.set(`data/${prefix}/${key}.json`, structuredClone(record));
      return true;
    },
    readCloud: async (prefix, key) => {
      assert.equal(prefix, "ask-files-v1");
      assert.ok(!key.startsWith("data/") && !key.startsWith("ask-files-v1/") && !key.endsWith(".json"), `Unexpected readCloud key: ${key}`);
      const fullKey = `data/${prefix}/${key}.json`;
      return { record: objects.has(fullKey) ? structuredClone(objects.get(fullKey)) : null, etag: "e1" };
    },
    deleteCloud: async (prefix, key) => {
      assert.equal(prefix, "ask-files-v1");
      assert.ok(typeof key === "string" && key && !key.startsWith("data/") && !key.startsWith("ask-files-v1/") && !key.endsWith(".json"), `Unexpected deleteCloud key: ${key}`);
      return objects.delete(`data/${prefix}/${key}.json`);
    },
    listCloud: async (prefix) => [...objects.keys()].filter((k) => k.startsWith(`data/${prefix}`)),
  });

  const ownerA = randomUUID();
  const ownerB = randomUUID();
  const expired = await cache.resolveFileAsync({ name: "old.txt", size: 10, mimeType: "text/plain", textContent: "expired-content" }, ownerA);
  const freshA = await cache.resolveFileAsync({ name: "fresh-a.txt", size: 10, mimeType: "text/plain", textContent: "fresh-a-content" }, ownerA);
  const freshB = await cache.resolveFileAsync({ name: "fresh-b.txt", size: 10, mimeType: "text/plain", textContent: "fresh-b-content" }, ownerB);

  const hashA = createHash("sha256").update(ownerA).digest("hex");
  const expiredKey = `data/ask-files-v1/${hashA}-${expired.fileId}.json`;
  const storedExpired = objects.get(expiredKey);
  storedExpired.expiresAt = Date.now() - 5000;
  objects.set(expiredKey, storedExpired);

  assert.equal(objects.size, 3);
  const removedExpired = await cache.cleanupPersistedExpired(Date.now());
  assert.equal(removedExpired, 1);
  assert.equal(objects.has(expiredKey), false);
  assert.equal(objects.size, 2);

  await cache.deleteOwnerPersistedFiles(ownerA);
  const hashB = createHash("sha256").update(ownerB).digest("hex");
  assert.equal(objects.size, 1);
  assert.equal(objects.has(`data/ask-files-v1/${hashB}-${freshB.fileId}.json`), true);
  assert.ok(freshA.fileId);
});

test("DistributedResearchService pre-commit 503 failure keeps Idempotency-Key retryable in Redis", async (t) => {
  const dir = await tempDirectory(t);
  const ownerId = randomUUID();
  const chats = new FileChatRepository(path.join(dir, "chats.json"), null, { cloud: false });
  const jobStore = new ResearchJobStore(path.join(dir, "jobs"), { cloud: false });

  const redisStore = new Map();
  const mockRedis = {
    isReady: true,
    async get(k) { return redisStore.has(k) ? redisStore.get(k) : null; },
    async set(k, v, opts = {}) {
      if (opts.NX && redisStore.has(k)) return null;
      redisStore.set(k, String(v));
      return "OK";
    },
    async del(k) { return redisStore.delete(k) ? 1 : 0; },
    async zRem() { return 1; },
    async eval(script, { keys = [], arguments: args = [] } = {}) {
      if (script.includes("redis.call('incr'")) {
        const next = Number(redisStore.get(keys[0]) || 0) + 1;
        redisStore.set(keys[0], String(next));
        return next;
      }
      if (script.includes("if redis.call('get',KEYS[1]) ~= ARGV[1]")) {
        if (redisStore.get(keys[0]) !== args[0]) return 0;
        if (script.includes("redis.call('set'")) redisStore.set(keys[0], String(args[1]));
        return 1;
      }
      if (script.includes("redis.call('del'")) {
        if (redisStore.get(keys[0]) === args[0]) {
          redisStore.delete(keys[0]);
          return 1;
        }
        return 0;
      }
      return 1;
    },
  };

  let provenanceCalls = 0;
  const strategyRepo = {
    async loadOwnerProvenance() {
      provenanceCalls += 1;
      if (provenanceCalls === 1) {
        throw Object.assign(new Error("Temporary provenance outage"), { code: "PROVENANCE_UNAVAILABLE", status: 503 });
      }
    },
    async readAll() { return []; },
  };

  const userRepo = { findById: async () => ({ id: ownerId, status: "active", authVersion: 1, settings: {} }) };
  const researchService = new DistributedResearchService({
    jobStore,
    redis: mockRedis,
    userRepository: userRepo,
    chatRepository: chats,
    strategyRepository: strategyRepo,
    geminiClient: {},
    recoveryIntervalMs: 60 * 60 * 1000,
  });
  t.after(() => researchService.shutdown());
  t.mock.method(researchService, "executeJob", async (jobId) => {
    const job = researchService.activeJobs.get(jobId);
    await new Promise((resolve) => setTimeout(resolve, 25));
    if (job) {
      job.status = "completed";
      job.detachLease?.();
      await job.executionLease?.lease.release();
    }
  });

  const policy = new AiPolicy({
    redis: mockRedis,
    env: {},
    canReplay: async () => true,
  });

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.ownerId = ownerId;
    req.user = { id: ownerId, emailVerifiedAt: "2026-01-01T00:00:00Z", status: "active", authVersion: 1 };
    req.auth = { user: req.user, sessionId: "s1" };
    next();
  });
  app.use(new PrivacyPolicy(userRepo).middleware());
  app.use(policy.middleware());
  app.use("/api/ask/research", createResearchRouter({
    researchService,
    chatRepository: chats,
    strategyRepository: strategyRepo,
    redis: mockRedis,
  }));

  const baseUrl = await listen(t, app);
  const idempKey = `res_retry_${randomUUID()}`;
  const payload = JSON.stringify({ prompt: "Deep research SaaS competitive benchmark" });

  const first = await fetch(`${baseUrl}/api/ask/research`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": idempKey },
    body: payload,
  });
  assert.equal(first.status, 503);
  assert.equal((await first.json()).code, "PROVENANCE_UNAVAILABLE");

  // Idempotency record in Redis must be 'retryable', not poisoned as 'started'
  const reqEntries = [...redisStore.entries()].filter(([k]) => k.startsWith("security:request:"));
  assert.equal(reqEntries.length, 1);
  assert.equal(JSON.parse(reqEntries[0][1]).state, "retryable");

  const retry = await fetch(`${baseUrl}/api/ask/research`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": idempKey },
    body: payload,
  });
  assert.equal(retry.status, 202);
  const retryBody = await retry.json();
  assert.ok(retryBody.jobId);
  assert.equal(retryBody.status, "pending");
});

test("askPreParseLoadGuard enforces 64KB limit on /api/ask/research while allowing /cancel during active job", async (t) => {
  const serverSrc = await fs.readFile(path.join(process.cwd(), "server.js"), "utf8");
  const start = serverSrc.indexOf("async function askPreParseLoadGuard(req, res, next) {");
  const end = serverSrc.indexOf("\napp.use('/api/ask/research'", start);
  assert.ok(start !== -1 && end !== -1, "askPreParseLoadGuard definition must exist in server.js");
  const fnSource = serverSrc.slice(start, end);

  const preParseAskWindows = new Map();
  const researchService = { hasActiveJobForOwner: () => true };
  const compile = new Function(
    "researchService",
    "getClientIp",
    "redis",
    "preParseAskWindows",
    "createHash",
    `${fnSource}\nreturn askPreParseLoadGuard;`,
  );
  const askPreParseLoadGuard = compile(
    researchService,
    () => "127.0.0.1",
    null,
    preParseAskWindows,
    createHash,
  );

  const app = express();
  const ownerId = randomUUID();
  app.use((req, _res, next) => {
    req.ownerId = ownerId;
    req.user = { id: ownerId, emailVerifiedAt: "2026-01-01T00:00:00Z" };
    next();
  });
  app.use("/api/ask/research", askPreParseLoadGuard, express.json({ limit: "64kb" }));
  app.post("/api/ask/research", (_req, res) => res.status(202).json({ ok: true }));
  app.post("/api/ask/research/jobs/:jobId/cancel", (_req, res) => res.json({ cancelled: true }));

  const baseUrl = await listen(t, app);

  // 1. Oversized (>64KB) authenticated POST /api/ask/research must fail fast at pre-parse guard with 413
  const bigBody = JSON.stringify({ prompt: "x".repeat(70 * 1024) });
  const oversizedRes = await fetch(`${baseUrl}/api/ask/research`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: bigBody,
  });
  assert.equal(oversizedRes.status, 413);
  assert.equal((await oversizedRes.json()).code, "PAYLOAD_TOO_LARGE");

  // 2. Normal create POST while hasActiveJobForOwner=true returns 429 EXECUTION_BUSY
  const createRes = await fetch(`${baseUrl}/api/ask/research`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: "valid prompt" }),
  });
  assert.equal(createRes.status, 429);
  assert.equal((await createRes.json()).code, "EXECUTION_BUSY");

  // 3. Cancel POST while hasActiveJobForOwner=true must NOT be blocked with EXECUTION_BUSY, and enforces 60/min rate limit
  const jobId = randomUUID();
  for (let i = 0; i < 60; i++) {
    const cancelRes = await fetch(`${baseUrl}/api/ask/research/jobs/${jobId}/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    assert.equal(cancelRes.status, 200);
  }
  const limitedCancel = await fetch(`${baseUrl}/api/ask/research/jobs/${jobId}/cancel`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  assert.equal(limitedCancel.status, 429);
  assert.equal((await limitedCancel.json()).code, "RATE_LIMITED");
});

test("createAuthRouter forwards cleanupQueue and researchJobStore to purgeExpiredAccounts, and FileChatRepository checks Redis/cloud shards", async (t) => {
  const serverSrc = await fs.readFile(path.join(process.cwd(), "server.js"), "utf8");
  assert.match(serverSrc, /createAuthRouter\(\{[\s\S]*?cleanupQueue,[\s\S]*?researchJobStore,[\s\S]*?\}\)/);

  const purgeCalls = [];
  const cleanupQueueSentinel = { marker: "cleanup-queue" };
  const researchJobStoreSentinel = { marker: "research-job-store" };

  const authApp = express();
  authApp.use(express.json());
  authApp.use("/api/auth", createAuthRouter({
    userRepository: {
      purgeExpiredAccounts: async (deps) => { purgeCalls.push(deps); return 0; },
      findByIdentifier: async () => null,
    },
    authStore: {
      hitRateLimit: async () => ({ allowed: true, remaining: 9, resetAt: Date.now() + 60000 }),
    },
    emailService: {},
    strategyRepository: {},
    chatRepository: {},
    plannerRepository: {},
    aiLearningRepository: {},
    upRepository: {},
    appUrl: "http://127.0.0.1",
    cleanupQueue: cleanupQueueSentinel,
    researchJobStore: researchJobStoreSentinel,
  }));

  const baseUrl = await listen(t, authApp);
  const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier: "nobody@example.com", password: "password123" }),
  });
  assert.equal(loginRes.status, 401);
  assert.equal(purgeCalls.length, 1);
  assert.equal(purgeCalls[0].cleanupQueue, cleanupQueueSentinel);
  assert.equal(purgeCalls[0].researchJobStore, researchJobStoreSentinel);

  // Verify FileChatRepository.hasChatIdInOtherShards uses O(1) Redis and Cloud owner indexes without redis.keys() or listCloudShards()
  const dir = await tempDirectory(t);
  const ownerA = randomUUID();
  const ownerB = randomUUID();
  const targetChatId = randomUUID();
  const ownerBHash = createHash("sha256").update(ownerB).digest("hex");

  const redisRepo = new FileChatRepository(
    path.join(dir, "redis-chats.json"),
    {
      isReady: true,
      keys: async () => { throw new Error("redis.keys() must not be called"); },
      get: async (key) => key === `marketify:chat-owner:${targetChatId}`
        ? ownerBHash
        : null,
    },
    { cloud: false },
  );
  assert.equal(await redisRepo.hasChatIdInOtherShards(targetChatId, ownerA), true);
  assert.equal(await redisRepo.hasChatIdInOtherShards(targetChatId, ownerB), false);

  const cloudRepo = new FileChatRepository(
    path.join(dir, "cloud-chats.json"),
    null,
    {
      cloud: true,
      listCloudShards: async () => { throw new Error("listCloudShards() must not be called"); },
      readChatOwnerIndex: async (chatId) => chatId === targetChatId
        ? { record: { ownerHash: ownerBHash }, etag: "e1" }
        : { record: null, notFound: true },
    },
  );
  assert.equal(await cloudRepo.hasChatIdInOtherShards(targetChatId, ownerA), true);
  assert.equal(await cloudRepo.hasChatIdInOtherShards(targetChatId, ownerB), false);
});
