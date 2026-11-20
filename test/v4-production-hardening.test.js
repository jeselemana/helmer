import { createFixtureStrategyRouter as createStrategyRouter, installBuildRoutingFixture } from "./helpers/build-routing-fixture.js";
installBuildRoutingFixture();
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { FileUserRepository } from "../src/repositories/file-user-repository.js";
import { FileAuthStore } from "../src/auth/auth-store.js";
import { FileAiLearningRepository } from "../src/repositories/file-ai-learning-repository.js";
import { FileTelemetryRepository } from "../src/repositories/file-telemetry-repository.js";
import { FileStrategyRepository } from "../src/repositories/file-strategy-repository.js";
import { FileChatRepository } from "../src/repositories/file-chat-repository.js";
import { FilePlannerRepository } from "../src/repositories/file-planner-repository.js";
import { TenantLockManager } from "../src/repositories/tenant-lock.js";
import { writeJsonAtomically } from "../src/repositories/atomic-json-store.js";
import { LearningLoopService } from "../src/services/learning/learning-loop-service.js";
import { acquireIdempotencyLock } from "../src/http/execution-lock.js";
import { getGeminiClient } from "../src/services/ai/research-google-client.js";

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "helmer-v4-hardening-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}

function cloudStore(initial = null) {
  let record = initial, version = 0;
  return {
    read: async () => ({ record: structuredClone(record), etag: record ? String(version) : null, notFound: !record }),
    write: async (_key, next, etag) => {
      if (etag !== (record ? String(version) : null)) return false;
      record = structuredClone(next); version++;
      return true;
    },
  };
}

test("v4: cloud sync never resurrects deleted users, revoked sessions or consumed tokens", async t => {
  const dir = await fixture(t);
  const file = path.join(dir, "users.json");
  await writeJsonAtomically(file, { schemaVersion: 2, users: [{ id: "deleted", username: "deleted", email: "deleted@example.com" }] });
  let cloudWrites = 0;
  const users = new FileUserRepository(file, null, {
    cloud: true, readCloud: async () => ({ record: { schemaVersion: 2, users: [] }, etag: "empty" }),
    writeCloud: async () => { cloudWrites++; return true; },
  });
  assert.deepEqual((await users.syncFromR2()).users, []);
  assert.deepEqual(JSON.parse(await fs.readFile(file, "utf8")).users, []);
  assert.equal(cloudWrites, 0);
  const authFile = path.join(dir, "auth.json");
  await writeJsonAtomically(authFile, { sessions: { revoked: { userId: "deleted", expiresAt: Date.now() + 100000 } }, resetTokens: { consumed: {} } });
  const auth = new FileAuthStore(authFile, { cloud: true, readCloud: async () => ({ record: { sessions: {}, resetTokens: {} }, etag: "new" }) });
  const synced = await auth.syncFromR2();
  assert.deepEqual(synced.sessions, {});
  assert.deepEqual(synced.resetTokens, {});
  assert.equal(await auth.getSession("revoked"), null);
  users.readCloud = auth.readCloud = async () => { throw new Error("cloud unavailable"); };
  await assert.rejects(users.readStore(), /cloud unavailable/);
  await assert.rejects(auth.read(), /cloud unavailable/);
});

for (const [name, Repository, field] of [
  ["learning", FileAiLearningRepository, "interactions"],
  ["telemetry", FileTelemetryRepository, "events"],
]) {
  test(`v4: ${name} serializes independent local instances and recovers after a failed update`, async t => {
    const dir = await fixture(t);
    const file = path.join(dir, "store.json");
    const a = new Repository(file, null, { mirrorToR2: false });
    const b = new Repository(file, null, { mirrorToR2: false });
    await Promise.all(Array.from({ length: 20 }, (_, i) => (i % 2 ? a : b).update(async store => {
      await pause(2);
      store[field].push({ id: String(i) });
    })));
    assert.equal((await a.readStore())[field].length, 20);
    await assert.rejects(a.update(() => { throw new Error("temporary failure"); }), /temporary failure/);
    await a.update(store => store[field].push({ id: "recovered" }));
    assert.equal((await b.readStore())[field].length, 21);
  });

  test(`v4: ${name} retries R2 OCC across replicas and never trusts stale Redis`, async t => {
    const dir = await fixture(t);
    const storage = cloudStore();
    let conflicts = 0;
    const options = {
      cloud: true,
      readCloud: async () => { const snapshot = await storage.read(); await pause(2); return snapshot; },
      writeCloud: async (data, etag) => { const ok = await storage.write("key", data, etag); if (!ok) conflicts++; return ok; },
    };
    const redis = { isReady: true, get: async () => JSON.stringify({ [field]: [{ id: "stale" }] }), set: async () => {} };
    const a = new Repository(path.join(dir, "replica-a", "store.json"), redis, options);
    const b = new Repository(path.join(dir, "replica-b", "store.json"), redis, options);
    await Promise.all(Array.from({ length: 12 }, (_, i) => (i % 2 ? a : b).update(store => store[field].push({ id: String(i) }))));
    const data = (await a.readStore())[field];
    assert.equal(data.length, 12);
    assert.equal(new Set(data.map(item => item.id)).size, 12);
    assert.equal(data.some(item => item.id === "stale"), false);
    assert.ok(conflicts > 0);
    a.readCloud = async () => { throw new Error("read outage"); };
    await assert.rejects(a.update(() => {}), /read outage/);
    a.readCloud = options.readCloud;
    a.writeCloud = async () => { throw new Error("write outage"); };
    await assert.rejects(a.update(store => store[field].push({ id: "uncommitted" })), /write outage/);
    assert.equal((await b.readStore())[field].length, 12);
  });
}

test("v4: racing initialization cannot truncate an existing store", async t => {
  const dir = await fixture(t), file = path.join(dir, "initialized.json");
  await writeJsonAtomically(file, { preserved: true });
  await Promise.all(Array.from({ length: 10 }, () => writeJsonAtomically(file, {}, { initialize: true })));
  assert.deepEqual(JSON.parse(await fs.readFile(file, "utf8")), { preserved: true });
  assert.deepEqual((await fs.readdir(dir)).filter(name => name.endsWith(".tmp")), []);
});

for (const Repository of [FileStrategyRepository, FileChatRepository, FilePlannerRepository]) {
  test(`v4: ${Repository.name} leaves corrupt shards intact and ignores stale Redis mirrors`, async t => {
    const dir = await fixture(t);
    const redis = { isReady: true, get: async () => "[]", set: async () => {} };
    const repo = new Repository(dir, redis, { cloud: false });
    await repo.ensure();
    const file = repo.tenantFilePath(repo.tenantKey("owner")), corrupt = '[{"id":"existing"';
    await fs.writeFile(file, corrupt);
    await assert.rejects(repo.mutateTenant("owner", records => records.push({ id: "replacement" })), { code: "STORAGE_CORRUPT" });
    assert.equal(await fs.readFile(file, "utf8"), corrupt);
    await fs.writeFile(file, JSON.stringify([{ id: "kept", ownerId: "owner" }]));
    await repo.mutateTenant("owner", records => { records.push({ id: "new", ownerId: "owner" }); });
    assert.deepEqual((await repo.readTenant("owner")).map(r => r.id), ["kept", "new"]);
  });
}

test("v4: live tenant locks survive their stale interval and abandoned locks recover", async t => {
  const dir = await fixture(t);
  const a = new TenantLockManager(dir, { staleMs: 30, timeoutMs: 70 });
  const b = new TenantLockManager(dir, { staleMs: 30, timeoutMs: 70 });
  const held = await a.acquire("live");
  t.after(() => held.release());
  await pause(100);
  await assert.rejects(b.acquire("live"), { code: "STORAGE_BUSY" });
  await held.release();
  await (await b.acquire("live")).release();
  const abandoned = path.join(a.locksDir, "dead.lock");
  await fs.mkdir(abandoned);
  const file = path.join(abandoned, "owner.json");
  await fs.writeFile(file, JSON.stringify({ token: "dead", pid: 999999, createdAt: 1 }));
  await fs.utimes(file, new Date(0), new Date(0));
  await (await b.acquire("dead")).release();
});

test("v4: R2 execution leases renew, abort on loss, and cannot release a successor's lock", async () => {
  const storage = cloudStore();
  const args = { ownerId: "owner", idempotencyKey: randomUUID(), operation: "generate", timeoutMs: 60, storage };
  const held = await acquireIdempotencyLock(args);
  try {
    await pause(160);
    assert.equal(await acquireIdempotencyLock(args), null);
    const current = await storage.read();
    await storage.write("key", { token: "successor", expiresAt: Date.now() + 10000 }, current.etag);
    for (let i = 0; i < 30 && !held.signal.aborted; i++) await pause(10);
    assert.equal(held.signal.aborted, true);
    await held.release();
    assert.equal((await storage.read()).record.token, "successor");
  } finally { await held.release(); }
});

test("v4: Redis execution leases renew and failed renewal cancels the execution", async () => {
  let value = null, expiresAt = 0;
  const redis = {
    isReady: true,
    set: async (_key, token, options) => {
      if (value && expiresAt > Date.now()) return null;
      value = token; expiresAt = Date.now() + options.PX; return "OK";
    },
    eval: async (script, { arguments: args }) => {
      if (value !== args[0] || expiresAt <= Date.now()) return 0;
      if (script.includes("pexpire")) expiresAt = Date.now() + Number(args[1]);
      else value = null;
      return 1;
    },
  };
  const options = { ownerId: "owner", operation: "generate", idempotencyKey: randomUUID(), redis, timeoutMs: 60 };
  const lock = await acquireIdempotencyLock(options);
  try {
    await pause(160);
    assert.equal(await acquireIdempotencyLock(options), null);
    value = "successor"; expiresAt = Date.now() + 10000;
    for (let i = 0; i < 30 && !lock.signal.aborted; i++) await pause(10);
    assert.equal(lock.signal.aborted, true);
    await lock.release();
    assert.equal(value, "successor");
  } finally { await lock.release(); }
});

function sampleStrategy(title = "Test Strategy") {
  return {
    title, summary: "Comprehensive strategy summary for testing purposes.",
    context: { business: "Fashion", objective: "Grow sales", market: "Baku", targetAudience: "Professionals" },
    sections: [1, 2, 3].map(i => ({ id: `s${i}`, title: "Overview", summary: "Summary", content: "Detailed content", bullets: ["Action"] })),
    priorities: [{ title: "Acquisition", description: "Optimize campaigns", priority: "high" }],
    actionPlan: [{ phase: "Phase 1", actions: ["Launch campaigns"], expectedOutcome: "Sales growth" }],
    kpis: [{ name: "ROAS", reason: "Efficiency", target: "3x" }],
    risks: [{ risk: "Fatigue", mitigation: "Rotate creatives" }], assumptions: ["Stable market"], nextSteps: ["Review daily."],
  };
}

function send(router, url, body, user = { id: "owner", settings: { modelImprovement: false } }) {
  return new Promise((resolve, reject) => {
    const req = Object.assign(new EventEmitter(), { method: "POST", url, body, headers: {}, ownerId: user.id, user, ip: "127.0.0.1", socket: {} });
    const res = Object.assign(new EventEmitter(), {
      writableEnded: false, statusCode: 200, setHeader() {}, getHeader() {},
      status(code) { this.statusCode = code; return this; },
      json(data) { this.writableEnded = true; resolve({ data, req, res: this }); return this; },
    });
    router.handle(req, res, error => reject(error || new Error("Route not handled")));
  });
}

test("v4: generation rechecks authority after locking across independent router instances", async t => {
  const dir = await fixture(t);
  process.env.GEMINI_API_KEY = "test-v4-gemini-key";
  const client = getGeminiClient(), original = client.models.generateContent;
  t.after(() => { client.models.generateContent = original; });
  let calls = 0;
  client.models.generateContent = async () => ({ candidates: [{ finishReason: "STOP" }], text: JSON.stringify(sampleStrategy(`Result ${++calls}`)) });
  const other = await import(`../src/http/strategy-router.js?v4=${randomUUID()}`);
  let rows = [], unblock, readStarted;
  const firstComplete = new Promise(resolve => { unblock = resolve; });
  const secondRead = new Promise(resolve => { readStarted = resolve; });
  let reads = 0;
  const common = {
    strategiesDir: path.join(dir, "strategies"),
    create: async (payload, ownerId) => { const saved = { ...payload, ownerId, id: randomUUID() }; rows.push(saved); return saved; },
  };
  const a = createStrategyRouter({ ...common, readTenant: async () => structuredClone(rows) });
  const b = other.createStrategyRouter({ ...common, readTenant: async () => {
    const snapshot = structuredClone(rows);
    if (++reads === 1) { readStarted(); await firstComplete; }
    return snapshot;
  } });
  const payload = { brief: "A shared test brief", answers: [], idempotencyKey: randomUUID() };
  const pendingB = send(b, "/generate", payload);
  await secondRead;
  const answerA = await send(a, "/generate", payload); unblock();
  const answerB = await pendingB;
  assert.equal(calls, 1);
  assert.equal(rows.length, 1);
  assert.deepEqual(answerA.data.strategy, answerB.data.strategy);
});

test("v4: saved refinement respects opt-out and restricted iterations never persist content", async t => {
  const dir = await fixture(t);
  const repo = new FileAiLearningRepository(path.join(dir, "learning.json"), null, { mirrorToR2: false });
  const learning = new LearningLoopService(repo);
  const parent = await learning.recordInteraction({ ownerId: "owner", mode: "build", modelImprovement: false, userPrompt: "Private parent", modelResponse: "Private answer" });
  process.env.GEMINI_API_KEY = "test-v4-gemini-key";
  const client = getGeminiClient(), original = client.models.generateContent;
  t.after(() => { client.models.generateContent = original; });
  client.models.generateContent = async () => ({ candidates: [{ finishReason: "STOP" }], text: JSON.stringify(sampleStrategy()) });
  const existing = { id: randomUUID(), ownerId: "owner", brief: "Private initial brief", answers: [], strategy: sampleStrategy(), versions: [], learningInteractionId: parent.id };
  const router = createStrategyRouter({ getById: async () => existing, appendVersion: async (_id, _owner, strategy) => ({ ...existing, strategy }) }, learning);
  const answer = await send(router, `/${existing.id}/refine`, { action: "custom", request: "Confidential launch plan", idempotencyKey: randomUUID() });
  assert.equal(answer.req.listenerCount("close"), 0);
  await pause(20);
  await learning.recordIteration({ parentInteractionId: parent.id, ownerId: "owner", modificationRequest: "Private iteration", response: "Private output" });
  const store = await repo.readStore();
  assert.equal(store.interactions.length, 2);
  assert.equal(store.interactions.every(record => record.modelImprovement === false), true);
  assert.equal(store.iterations.length, 0);
  assert.doesNotMatch(JSON.stringify(store), /Private|Confidential/);
});

test("v4: auto-save disabled still replays across independent instances and rejects changed parameters", async t => {
  const dir = await fixture(t);
  process.env.GEMINI_API_KEY = "test-v4-gemini-key";
  const client = getGeminiClient(), original = client.models.generateContent;
  t.after(() => { client.models.generateContent = original; });
  let calls = 0;
  client.models.generateContent = async () => ({ candidates: [{ finishReason: "STOP" }], text: JSON.stringify(sampleStrategy(`Result ${++calls}`)) });
  const other = await import(`../src/http/strategy-router.js?v4=${randomUUID()}`);
  const repository = { strategiesDir: path.join(dir, "strategies"), readTenant: async () => [] };
  const a = createStrategyRouter(repository), b = other.createStrategyRouter(repository);
  const payload = { brief: "A shared test brief", answers: [], idempotencyKey: randomUUID(), autoSave: false };
  const first = await send(a, "/generate", payload);
  const replay = await send(b, "/generate", payload);
  assert.equal(calls, 1);
  assert.deepEqual(replay.data.strategy, first.data.strategy);
  assert.equal(replay.data.savedStrategy, null);
  await assert.rejects(send(b, "/generate", { ...payload, brief: "A changed test brief" }), { code: "IDEMPOTENCY_CONFLICT" });
});

test("v4: refinement repository deduplicates versions even when concurrent callers read stale snapshots", async t => {
  const dir = await fixture(t);
  const a = new FileStrategyRepository(dir, null, { cloud: false });
  const b = new FileStrategyRepository(dir, null, { cloud: false });
  const original = await a.create({ strategy: sampleStrategy(), answers: [], versions: [{ data: sampleStrategy(), versionNumber: 1 }] }, "owner");
  const args = [original.id, "owner", sampleStrategy("Refined"), "Change", { clientSaveId: "same-key", payloadFingerprint: "same" }];
  await Promise.all([a.appendVersion(...args), b.appendVersion(...args)]);
  assert.equal((await a.getById(original.id, "owner")).versions.length, 2);
  await assert.rejects(b.appendVersion(original.id, "owner", sampleStrategy(), "Other", { clientSaveId: "same-key", payloadFingerprint: "different" }), { code: "IDEMPOTENCY_CONFLICT" });
});

test("v4: R2 idempotency results replay through conditional objects after the execution lock is released", async () => {
  const records = new Map();
  const storage = {
    read: async key => {
      const item = records.get(key);
      return { record: item ? structuredClone(item.record) : null, etag: item?.etag || null, notFound: !item };
    },
    write: async (key, record, etag) => {
      if ((records.get(key)?.etag || null) !== etag) return false;
      records.set(key, { record: structuredClone(record), etag: randomUUID() });
      return true;
    },
  };
  const args = { ownerId: "owner", operation: "generate", idempotencyKey: randomUUID(), storage };
  const first = await acquireIdempotencyLock(args);
  try {
    await first.assertOwned();
    await first.saveResult({ fingerprint: "same", tracked: { result: { title: "Cached result" } } });
  } finally { await first.release(); }
  const replay = await acquireIdempotencyLock(args);
  try {
    assert.equal((await replay.readResult()).tracked.result.title, "Cached result");
    await replay.assertOwned();
  } finally { await replay.release(); }
});

test("v4: disconnect before the generation entry exists never starts an orphaned model call", async t => {
  const dir = await fixture(t);
  process.env.GEMINI_API_KEY = "test-v4-gemini-key";
  const client = getGeminiClient(), original = client.models.generateContent;
  t.after(() => { client.models.generateContent = original; });
  let calls = 0, unblock, started;
  client.models.generateContent = async () => { calls++; return { candidates: [{ finishReason: "STOP" }], text: JSON.stringify(sampleStrategy()) }; };
  const paused = new Promise(resolve => { unblock = resolve; });
  const reading = new Promise(resolve => { started = resolve; });
  const router = createStrategyRouter({ strategiesDir: path.join(dir, "strategies"), readTenant: async () => { started(); await paused; return []; } });
  const req = Object.assign(new EventEmitter(), { method: "POST", url: "/generate-stream", body: { brief: "A shared test brief", answers: [], idempotencyKey: randomUUID() }, headers: {}, ownerId: "owner", user: { settings: {} }, ip: "127.0.0.1" });
  let complete, fail;
  const finished = new Promise((resolve, reject) => { complete = resolve; fail = reject; });
  const res = Object.assign(new EventEmitter(), { writableEnded: false, destroyed: false, setHeader() {}, flushHeaders() {}, write() {}, end() { this.writableEnded = true; complete(); } });
  router.handle(req, res, error => fail(error || new Error("Route not handled")));
  await reading;
  res.destroyed = true; res.emit("close"); unblock();
  await finished;
  assert.equal(calls, 0);
  assert.equal(req.listenerCount("close"), 0);
  assert.equal(res.listenerCount("close"), 0);
});
