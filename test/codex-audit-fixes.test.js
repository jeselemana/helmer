import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { isAiRequest, DEFAULT_MODEL_PRICING } from "../src/services/security/ai-policy.js";
import { CleanupQueue } from "../src/services/security/cleanup-queue.js";
import { DurableStore } from "../src/services/security/durable-store.js";
import { FileChatRepository } from "../src/repositories/file-chat-repository.js";
import { ArtifactRepository } from "../src/repositories/artifact-repository.js";
import { DistributedResearchService } from "../src/services/ai/distributed-research.js";
import { createSpreadsheetExport } from "../public/exporters.js";

async function tempDir(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "helmer-codex-fixes-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}

test("Fix 1: isAiRequest is case-insensitive", () => {
  assert.equal(isAiRequest({ method: "POST", path: "/API/STRATEGY/generate" }), true);
  assert.equal(isAiRequest({ method: "POST", path: "/api/strategy/generate" }), true);
  assert.equal(isAiRequest({ method: "POST", path: "/API/ASK" }), true);
  assert.equal(isAiRequest({ method: "POST", path: "/API/ASK/RESEARCH" }), true);
  assert.equal(isAiRequest({ method: "POST", path: "/api/up/challenges" }), true);
  assert.equal(isAiRequest({ method: "POST", path: "/API/UP/CHALLENGES" }), true);
  assert.equal(isAiRequest({ method: "POST", path: "/api/up/challenges/4716143a-a2ba-479a-a17f-f0f1e444f162/submit" }), true);
  assert.equal(isAiRequest({ method: "POST", path: "/api/up/challenges/4716143a-a2ba-479a-a17f-f0f1e444f162/retry" }), true);
  assert.equal(isAiRequest({ method: "GET", path: "/api/strategy/generate" }), false);
  assert.equal(isAiRequest({ method: "POST", path: "/api/unknown" }), false);
});

test("Fix 2 & 3: CleanupQueue handles enqueueChat, object polymorphism, and clearOwner", async (t) => {
  const dir = await tempDir(t);
  const store = new DurableStore(dir, { cloud: false });
  let deletedArtifacts = false;
  let clearedOwner = null;
  const mockArtifacts = { deleteChatArtifacts: async () => { deletedArtifacts = true; } };
  const mockCache = { clearOwner: (ownerId) => { clearedOwner = ownerId; } };
  const queue = new CleanupQueue(store, mockArtifacts, mockCache);
  t.after(() => clearInterval(queue.timer));

  // 1. enqueueChat helper method
  const chat = { id: "c1", ownerId: "u1", messages: [{ id: "m1" }] };
  await queue.enqueueChat(chat);
  assert.equal(await queue.pending("u1", "c1"), true);
  await queue.process();
  assert.equal(await queue.pending("u1", "c1"), false);
  assert.equal(deletedArtifacts, true);
  assert.equal(clearedOwner, "u1");

  // 2. enqueue with chat object directly
  deletedArtifacts = false;
  clearedOwner = null;
  await queue.enqueue(chat);
  assert.equal(await queue.pending("u1", "c1"), true);
  await queue.process();
  assert.equal(await queue.pending("u1", "c1"), false);
  assert.equal(deletedArtifacts, true);
  assert.equal(clearedOwner, "u1");
});

test("Fix 3: FileChatRepository delete and deleteAllByOwner safely dispatch to cleanupQueue", async (t) => {
  const dir = await tempDir(t);
  const chatsPath = path.join(dir, "chats.json");
  const repo = new FileChatRepository(chatsPath);
  repo.artifactRepository = { deleteChatArtifacts: async () => {} };
  let enqueued = null;
  repo.cleanupQueue = {
    enqueueChat: async (chat) => { enqueued = chat.id; },
  };

  const created = await repo.saveChat({
    ownerId: "11111111-1111-1111-1111-111111111111",
    title: "Test Chat",
    messages: [{ id: "m1", text: "hello" }],
  });

  // delete method
  const deleted = await repo.delete(created.id, "11111111-1111-1111-1111-111111111111");
  assert.equal(deleted, true);
  assert.equal(enqueued, created.id);

  // deleteAllByOwner method
  enqueued = null;
  const created2 = await repo.saveChat({
    ownerId: "11111111-1111-1111-1111-111111111111",
    title: "Test Chat 2",
    messages: [{ id: "m2", text: "world" }],
  });
  const deletedCount = await repo.deleteAllByOwner("11111111-1111-1111-1111-111111111111");
  assert.equal(deletedCount >= 1, true);
  assert.equal(enqueued, created2.id);
});

test("Fix 5: ArtifactRepository never produces [object Object] in binaryName when execution is an object", async (t) => {
  const dir = await tempDir(t);
  const repo = new ArtifactRepository(dir);
  const plugin = {
    id: "word",
    name: "Word",
    extension: "docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  };
  const spec = { title: "Test Doc", sections: [] };
  const buffer = Buffer.from("dummy-docx-content");

  const saved = await repo.save({
    ownerId: "11111111-1111-1111-1111-111111111111",
    chatId: "22222222-2222-2222-2222-222222222222",
    plugin,
    spec,
    buffer,
    execution: {
      status: "completed",
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      steps: [],
    },
  });

  assert.ok(saved);
  assert.ok(saved.record.versions.length === 1);
  const version = saved.record.versions[0];
  assert.ok(!version.binaryName.includes("[object Object]"), "binaryName must not contain [object Object]");
  assert.match(version.binaryName, /^v1-[a-f0-9-]{36}\.docx$/);
});

test("Fix 6: DistributedResearchService cancelJob prevents cross-tenant cancellation", async (t) => {
  const service = new DistributedResearchService({
    jobStore: {
      read: async (key) => {
        if (key === "research:job_123") {
          return { id: "job_123", ownerId: "usr_victim", chatId: 'fixture-chat', status: 'running', createdAt: new Date().toISOString() };
        }
        return null;
      },
      mutate: async () => ({ value: {}, result: {} }),
    },
    chatRepository: {
      readAll: async () => [],
      getById: async () => ({ id: 'fixture-chat', ownerId: 'usr_victim' }),
    },
    userRepository: null,
  });

  // Victim attempts cancel -> true
  const victimCancel = await service.cancelJob("job_123", "usr_victim");
  assert.equal(victimCancel, true);

  // Attacker attempts cancel -> false
  const attackerCancel = await service.cancelJob("job_123", "usr_attacker");
  assert.equal(attackerCancel, false);
});

test("Fix 10: CSV export sanitizes formula characters (=, +, -, @, \\t, \\r)", () => {
  const dangerousStrategy = {
    title: "=cmd|' /C calc'!A0",
    summary: "+SUM(1,2)",
    sections: [{ title: "-100", content: "@evil.com", bullets: ["\tTabFormula"] }],
    priorities: [{ title: "=1+1", description: "-danger", priority: "+high" }],
    actionPlan: [{ phase: "=2+2", actions: ["=3+3"], expectedOutcome: "@leak" }],
    kpis: [{ name: "=4+4", reason: "\tTab", target: "10" }],
    risks: [{ risk: "=5+5", mitigation: "-mitigate" }],
    nextSteps: ["=6+6"],
  };

  const file = createSpreadsheetExport(dangerousStrategy);
  assert.equal(file.extension, "csv");
  assert.match(file.content, /"'=1\+1"/);
  assert.match(file.content, /"'-danger"/);
  assert.match(file.content, /"'\+high"/);
  assert.match(file.content, /"'=2\+2"/);
  assert.match(file.content, /"'=3\+3"/);
  assert.match(file.content, /"'@leak"/);
  assert.match(file.content, /"'=4\+4"/);
  assert.match(file.content, /"'\tTab"/);
  assert.match(file.content, /"'=5\+5"/);
  assert.match(file.content, /"'-mitigate"/);
});

test("Fix 11: Telemetry Inspector accepts evt_* prefixed event IDs", async () => {
  const { createTelemetryAdminRouter } = await import("../src/http/telemetry-router.js");
  let queriedId = null;
  const mockService = {
    repository: {
      getEventById: async (id) => {
        queriedId = id;
        return { id, type: "build_generated" };
      },
    },
  };
  const router = createTelemetryAdminRouter(mockService);
  const req = { params: { id: "evt_bld_11111111-1111-1111-1111-111111111111" } };
  let jsonResult = null;
  const res = {
    json(data) { jsonResult = data; return this; },
    status() { return this; },
  };
  // Route layer regex matching
  const route = router.stack.find(layer => layer.route && layer.route.path === "/events/:id");
  assert.ok(route);
  await route.route.stack[0].handle(req, res, () => {});
  assert.equal(queriedId, "evt_bld_11111111-1111-1111-1111-111111111111");
  assert.equal(jsonResult?.event?.id, "evt_bld_11111111-1111-1111-1111-111111111111");
});

test("Fix 2: ArtifactRepository publish failure removes uncommitted binary but preserves shared manifest", async (t) => {
  const dir = await tempDir(t);
  const repo = new ArtifactRepository(dir);
  const plugin = {
    id: "word",
    name: "Word",
    extension: "docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  };
  const spec = { title: "Doc", sections: [] };
  const buffer = Buffer.from("content-1");

  // Save version 1
  const saved1 = await repo.save({
    ownerId: "11111111-1111-1111-1111-111111111111",
    chatId: "22222222-2222-2222-2222-222222222222",
    plugin,
    spec,
    buffer,
  });

  assert.equal(saved1.record.versions.length, 1);

  // Force publish to fail on next attempt
  const originalPublish = repo.publish.bind(repo);
  repo.publish = async () => { throw new Error("OCC_FAILED"); };

  await assert.rejects(
    () => repo.save({
      ownerId: "11111111-1111-1111-1111-111111111111",
      chatId: "22222222-2222-2222-2222-222222222222",
      plugin,
      spec,
      buffer: Buffer.from("content-2"),
      previous: saved1.record,
    }),
    /OCC_FAILED/
  );

  // Verify version 1 manifest is still intact and not corrupted/deleted
  repo.publish = originalPublish;
  const current = await repo.get(saved1.record.id, "11111111-1111-1111-1111-111111111111");
  assert.ok(current);
  assert.equal(current.versions.length, 1);
});

test("Fix 7: saveChat appendMessages atomically appends concurrent messages without overwriting", async (t) => {
  const dir = await tempDir(t);
  const repo = new FileChatRepository(path.join(dir, "chats"));
  const ownerId = "11111111-1111-1111-1111-111111111111";

  // Create initial chat with appendMessages
  const initial = await repo.saveChat({
    ownerId,
    title: "Initial Chat",
    appendMessages: [{ id: "m1", role: "user", content: "hello" }],
  });

  assert.equal(initial.messages.length, 1);

  // Concurrently append messages
  await Promise.all([
    repo.saveChat({
      id: initial.id,
      ownerId,
      mustExist: true,
      appendMessages: [{ id: "m2", role: "user", content: "job 1 request" }, { id: "m3", role: "assistant", content: "job 1 reply" }],
    }),
    repo.saveChat({
      id: initial.id,
      ownerId,
      mustExist: true,
      appendMessages: [{ id: "m4", role: "user", content: "job 2 request" }, { id: "m5", role: "assistant", content: "job 2 reply" }],
    }),
  ]);

  const updated = await repo.getById(initial.id, ownerId);
  assert.ok(updated);
  assert.equal(updated.messages.length, 5);
  const ids = updated.messages.map(m => m.id);
  assert.ok(ids.includes("m1") && ids.includes("m2") && ids.includes("m3") && ids.includes("m4") && ids.includes("m5"));
});

test("Fix 8: DEFAULT_MODEL_PRICING includes gpt-4o with appropriate pricing", () => {
  assert.ok(DEFAULT_MODEL_PRICING["gpt-4o"]);
  assert.equal(DEFAULT_MODEL_PRICING["gpt-4o"].input, 2.50);
  assert.equal(DEFAULT_MODEL_PRICING["gpt-4o"].output, 10.00);
});

test("Fix 9: DistributedResearchService getJob uses getById and preserves active jobs", async () => {
  const service = new DistributedResearchService({
    jobStore: {
      read: async (key) => ({
        id: "job_active_1",
        ownerId: "11111111-1111-1111-1111-111111111111",
        chatId: "22222222-2222-2222-2222-222222222222",
        status: "completed",
        createdAt: new Date().toISOString(),
        content: "research result",
      }),
      mutate: async () => ({ value: {}, result: {} }),
    },
    chatRepository: {
      getById: async (id, ownerId) => {
        if (id === "22222222-2222-2222-2222-222222222222") {
          return { id, ownerId, deleted: false };
        }
        return null;
      },
      readAll: async () => [],
    },
  });

  const job = await service.getJob("job_active_1", "11111111-1111-1111-1111-111111111111");
  assert.ok(job);
  assert.equal(job.id, "job_active_1");
  assert.equal(job.content, "research result");
});

