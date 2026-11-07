import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { createAskExecutionGuard } from "../src/http/ask-execution-guard.js";
import { FileTelemetryRepository } from "../src/repositories/file-telemetry-repository.js";

// Helper to create mock Express req/res
function createMockHttp({ method = "POST", path = "/", ownerId = "tenant-1", user = { id: ownerId, emailVerifiedAt: "fixture" } } = {}) {
  const req = {
    method,
    path,
    ownerId,
    auth: user ? { user } : null,
    headers: {},
  };

  const res = new EventEmitter();
  res.statusCode = 200;
  res.body = null;
  res.headersSent = false;
  res.writableEnded = false;

  res.status = function (code) {
    this.statusCode = code;
    return this;
  };

  res.json = function (payload) {
    this.body = payload;
    this.headersSent = true;
    this.writableEnded = true;
    this.emit("finish");
    return this;
  };

  return { req, res };
}

// Color output helpers
const log = {
  info: (msg) => console.log(`\x1b[34mℹ\x1b[0m ${msg}`),
  pass: (msg) => console.log(`\x1b[32m✔\x1b[0m ${msg}`),
  fail: (msg) => console.error(`\x1b[31m✖\x1b[0m ${msg}`),
  header: (msg) => console.log(`\n\x1b[1m\x1b[36m=== ${msg} ===\x1b[0m`),
};

async function runAllStressTests() {
  let passedCount = 0;
  let failedCount = 0;

  async function testCase(name, fn) {
    try {
      await fn();
      log.pass(name);
      passedCount++;
    } catch (err) {
      log.fail(`${name}: ${err.message}`);
      console.error(err);
      failedCount++;
    }
  }

  log.header("SUITE 1: Ask Execution Guard Concurrency & Decoupling");

  await testCase("1.1: 10 concurrent distinct tenants never blocked (maxConcurrent = 100)", async () => {
    const guard = createAskExecutionGuard({ maxConcurrent: 100 });
    const tenantCount = 10;
    const activeExecutions = [];
    const executionResults = [];

    // Launch 10 distinct tenants concurrently
    const promises = Array.from({ length: tenantCount }, async (_, i) => {
      const ownerId = `tenant-${i + 1}`;
      const { req, res } = createMockHttp({ ownerId });

      let reachedNext = false;
      const next = () => {
        reachedNext = true;
      };

      const guardPromise = guard(req, res, next);
      await guardPromise;

      assert.equal(reachedNext, true, `Tenant ${ownerId} must reach next()`);
      assert.equal(res.statusCode, 200, `Tenant ${ownerId} status must be 200`);

      activeExecutions.push({ ownerId, res });
      // Hold in-flight for 40ms to guarantee simultaneous overlap
      await new Promise((r) => setTimeout(r, 40));

      // Complete request
      res.writableEnded = true;
      res.emit("finish");
      executionResults.push(ownerId);
    });

    await Promise.all(promises);

    assert.equal(executionResults.length, 10, "All 10 distinct tenants must complete without blocking");
  });

  await testCase("1.2: Same tenant concurrent request IS blocked with HTTP 429 EXECUTION_BUSY", async () => {
    const guard = createAskExecutionGuard({ maxConcurrent: 100 });
    const tenantId = "same-tenant-alpha";

    // Request 1: starts and stays in-flight
    const req1 = createMockHttp({ ownerId: tenantId });
    let req1ReachedNext = false;
    await guard(req1.req, req1.res, () => {
      req1ReachedNext = true;
    });
    assert.equal(req1ReachedNext, true, "First request must proceed to next()");

    // Request 2: concurrent attempt for same tenant while Request 1 is still in flight
    const req2 = createMockHttp({ ownerId: tenantId });
    let req2ReachedNext = false;
    await guard(req2.req, req2.res, () => {
      req2ReachedNext = true;
    });

    assert.equal(req2ReachedNext, false, "Second request for same tenant MUST NOT reach next()");
    assert.equal(req2.res.statusCode, 429, "Second request must return HTTP 429");
    assert.equal(req2.res.body?.code, "EXECUTION_BUSY", "Error code must be EXECUTION_BUSY");
    assert.equal(req2.res.body?.retryable, true, "Error must be marked retryable: true");
    assert.match(
      req2.res.body?.error,
      /Hazırda başqa tapşırıq icra olunur/,
      "Expected per-tenant execution busy error message"
    );

    // Now complete Request 1
    req1.res.writableEnded = true;
    req1.res.emit("finish");

    // Request 3: subsequent request for same tenant after Request 1 finishes
    const req3 = createMockHttp({ ownerId: tenantId });
    let req3ReachedNext = false;
    await guard(req3.req, req3.res, () => {
      req3ReachedNext = true;
    });

    assert.equal(req3ReachedNext, true, "Third request must proceed after first request finished");
    req3.res.emit("finish");
  });

  await testCase("1.3: Client disconnect (res.close) releases per-tenant lock immediately", async () => {
    const guard = createAskExecutionGuard({ maxConcurrent: 100 });
    const tenantId = "tenant-disconnect-test";

    const req1 = createMockHttp({ ownerId: tenantId });
    let reached = false;
    await guard(req1.req, req1.res, () => {
      reached = true;
    });
    assert.equal(reached, true);

    // Simulate unexpected client socket closure (abort)
    req1.res.emit("close");

    // Subsequent request must be accepted immediately without hanging or 429
    const req2 = createMockHttp({ ownerId: tenantId });
    let req2Reached = false;
    await guard(req2.req, req2.res, () => {
      req2Reached = true;
    });
    assert.equal(req2Reached, true, "Lock must be released on socket close");
    req2.res.emit("finish");
  });

  await testCase("1.4: Global capacity ceiling (maxConcurrent) enforces backpressure across distinct tenants", async () => {
    const guard = createAskExecutionGuard({ maxConcurrent: 3 });

    // Occupy all 3 slots with distinct tenants
    const active = [];
    for (let i = 1; i <= 3; i++) {
      const mock = createMockHttp({ ownerId: `occupant-${i}` });
      let nextCalled = false;
      await guard(mock.req, mock.res, () => {
        nextCalled = true;
      });
      assert.equal(nextCalled, true, `Occupant ${i} should be admitted`);
      active.push(mock);
    }

    // 4th distinct tenant tries to enter while 3 slots are occupied
    const tenant4 = createMockHttp({ ownerId: "occupant-4" });
    let tenant4Admitted = false;
    await guard(tenant4.req, tenant4.res, () => {
      tenant4Admitted = true;
    });

    assert.equal(tenant4Admitted, false, "4th tenant must be blocked when maxConcurrent=3 is reached");
    assert.equal(tenant4.res.statusCode, 429);
    assert.equal(tenant4.res.body?.code, "EXECUTION_BUSY");
    assert.match(
      tenant4.res.body?.error,
      /Server hazırda yüksək yüklənmə altındadır/,
      "Must return platform overload message"
    );

    // Free 1 slot
    active[0].res.emit("finish");

    // 4th tenant retries and now succeeds
    const tenant4Retry = createMockHttp({ ownerId: "occupant-4" });
    let tenant4RetryAdmitted = false;
    await guard(tenant4Retry.req, tenant4Retry.res, () => {
      tenant4RetryAdmitted = true;
    });
    assert.equal(tenant4RetryAdmitted, true, "Tenant 4 must be admitted after slot freed");

    // Clean up remaining slots
    active[1].res.emit("finish");
    active[2].res.emit("finish");
    tenant4Retry.res.emit("finish");
  });

  await testCase("1.5: Redis distributed lock integration and failure handling", async () => {
    // Mock redis with isReady: true
    const storage = new Map();
    const mockRedis = {
      isReady: true,
      async set(key, value, { NX, PX } = {}) {
        if (storage.has(key)) return null;
        storage.set(key, value);
        return "OK";
      },
      async eval(script, { keys, arguments: args } = {}) {
        const key = keys[0];
        const token = args[0];
        if (storage.get(key) === token) {
          storage.delete(key);
          return 1;
        }
        return 0;
      },
    };

    const guard = createAskExecutionGuard({ redis: mockRedis, maxConcurrent: 100 });
    const tenant = "redis-tenant-1";

    const req1 = createMockHttp({ ownerId: tenant });
    let req1Called = false;
    await guard(req1.req, req1.res, () => {
      req1Called = true;
    });
    assert.equal(req1Called, true);
    assert.ok(storage.has(`helmer:ask-lock:${tenant}`), "Redis key must be set");

    // Finish request
    req1.res.emit("finish");
    // Allow async release to run
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(storage.has(`helmer:ask-lock:${tenant}`), false, "Redis key must be cleared");

    // Simulate Redis lock acquisition failure (e.g. held by another instance)
    storage.set(`helmer:ask-lock:foreign-locked`, "other-instance-token");
    const reqForeign = createMockHttp({ ownerId: "foreign-locked" });
    let foreignCalled = false;
    await guard(reqForeign.req, reqForeign.res, () => {
      foreignCalled = true;
    });

    assert.equal(foreignCalled, false);
    assert.equal(reqForeign.res.statusCode, 429);
    assert.match(reqForeign.res.body?.error, /Başqa tapşırığın bitməsini gözləyin/);
  });

  await testCase("1.6: Non-matching HTTP methods and paths pass through without locking", async () => {
    const guard = createAskExecutionGuard({ maxConcurrent: 100 });

    const getReq = createMockHttp({ method: "GET", path: "/", ownerId: "user-get" });
    let getCalled = false;
    await guard(getReq.req, getReq.res, () => {
      getCalled = true;
    });
    assert.equal(getCalled, true);

    const subReq = createMockHttp({ method: "POST", path: "/subpath", ownerId: "user-sub" });
    let subCalled = false;
    await guard(subReq.req, subReq.res, () => {
      subCalled = true;
    });
    assert.equal(subCalled, true);
  });

  await testCase("1.7: High-concurrency soak test (10 tenants, 60 requests interleaved)", async () => {
    const guard = createAskExecutionGuard({ maxConcurrent: 100 });
    const tenants = Array.from({ length: 10 }, (_, i) => `tenant-soak-${i}`);
    const activePerTenant = new Map();
    for (const t of tenants) activePerTenant.set(t, 0);

    let total200 = 0;
    let total429 = 0;

    const runRequest = async (tenantId) => {
      const { req, res } = createMockHttp({ ownerId: tenantId });
      let nextCalled = false;

      await guard(req, res, () => {
        nextCalled = true;
      });

      if (nextCalled) {
        total200++;
        // Strict invariant: no more than 1 active request per tenant
        const curActive = activePerTenant.get(tenantId);
        assert.equal(curActive, 0, `Tenant ${tenantId} had ${curActive} active executions! Invariant violated!`);
        activePerTenant.set(tenantId, curActive + 1);

        // Sleep 10-25ms
        const delay = 10 + Math.floor(Math.random() * 15);
        await new Promise((r) => setTimeout(r, delay));

        activePerTenant.set(tenantId, activePerTenant.get(tenantId) - 1);
        res.emit("finish");
      } else {
        total429++;
        assert.equal(res.statusCode, 429, "Blocked request must be 429");
      }
    };

    // Dispatch 60 requests randomly distributed across tenants
    const promises = [];
    for (let i = 0; i < 60; i++) {
      const tenant = tenants[i % tenants.length];
      promises.push(runRequest(tenant));
      // Stagger slightly so some overlap while others complete
      if (i % 5 === 0) await new Promise((r) => setTimeout(r, 4));
    }

    await Promise.all(promises);

    log.info(`Soak test completed: 200 OK = ${total200}, 429 Busy = ${total429}`);
    assert.ok(total200 >= 10, "At least 10 requests must have succeeded");
    assert.ok(total429 > 0, "Some concurrent requests for same tenants should have received 429");
    for (const [t, active] of activePerTenant.entries()) {
      assert.equal(active, 0, `Tenant ${t} has leaking active count`);
    }
  });

  log.header("SUITE 2: Telemetry Repository Atomic Writes & Temp File Safety");

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "helmer-telemetry-stress-"));

  await testCase("2.1: 50 rapid concurrent updates succeed, zero .tmp files, 100% valid JSON", async () => {
    const filePath = path.join(tempDir, "telemetry-50.json");
    const repo = new FileTelemetryRepository(filePath, null, { mirrorToR2: false });
    await repo.ensure();

    const writeCount = 50;
    const writePromises = Array.from({ length: writeCount }, (_, i) => {
      return repo.recordEvent({
        id: `evt-${i + 1}`,
        timestamp: new Date().toISOString(),
        mode: "build",
        status: "success",
        latencyMs: 100 + i,
      });
    });

    await Promise.all(writePromises);

    // 1. Read file directly from disk
    const rawContent = await fs.readFile(path.join(repo.shardsDirectory, `${repo.tenantKey(null)}.json`), "utf8");
    assert.ok(rawContent.length > 0, "Telemetry file must not be 0 bytes");

    let parsed;
    try {
      parsed = JSON.parse(rawContent);
    } catch (e) {
      assert.fail(`Telemetry file contains corrupted JSON: ${e.message}`);
    }

    assert.equal(parsed.schemaVersion, 1, "Schema version must be 1");
    assert.equal(parsed.events.length, writeCount, `Expected exactly ${writeCount} events recorded`);

    // 2. Check for leftover .tmp files
    const allFiles = await fs.readdir(repo.shardsDirectory);
    const tmpFiles = allFiles.filter((f) => f.endsWith(".tmp"));
    assert.equal(tmpFiles.length, 0, `No leftover .tmp files allowed, found: ${tmpFiles.join(", ")}`);
  });

  await testCase("2.2: 100 rapid concurrent updates stress test", async () => {
    const filePath = path.join(tempDir, "telemetry-100.json");
    const repo = new FileTelemetryRepository(filePath, null, { mirrorToR2: false });
    await repo.ensure();

    const writeCount = 100;
    const writePromises = Array.from({ length: writeCount }, (_, i) => {
      return repo.recordEvent({
        id: `evt-100-${i + 1}`,
        timestamp: new Date().toISOString(),
        mode: i % 2 === 0 ? "ask" : "summary",
        status: "success",
        latencyMs: 50 + (i % 20),
      });
    });

    await Promise.all(writePromises);

    const rawContent = await fs.readFile(path.join(repo.shardsDirectory, `${repo.tenantKey(null)}.json`), "utf8");
    assert.ok(rawContent.length > 0, "File must not be 0 bytes");

    const parsed = JSON.parse(rawContent);
    assert.equal(parsed.events.length, writeCount);

    const allFiles = await fs.readdir(repo.shardsDirectory);
    const tmpFiles = allFiles.filter((f) => f.endsWith(".tmp"));
    assert.equal(tmpFiles.length, 0, "Zero .tmp files remaining");
  });

  await testCase("2.3: Interleaved concurrent reads & writes never observe half-written JSON or throw SyntaxError", async () => {
    const filePath = path.join(tempDir, "telemetry-interleaved.json");
    const repo = new FileTelemetryRepository(filePath, null, { mirrorToR2: false });
    await repo.ensure();

    const ops = [];
    let readSuccessCount = 0;
    let writeSuccessCount = 0;

    for (let i = 0; i < 40; i++) {
      // Add a write operation
      const idx = i;
      ops.push(
        repo.recordEvent({
          id: `interleaved-${idx}`,
          timestamp: new Date().toISOString(),
          mode: "build",
          status: "success",
        }).then(() => {
          writeSuccessCount++;
        })
      );

      // Add concurrent read operations
      ops.push(
        repo.readStore().then((store) => {
          assert.ok(Array.isArray(store.events), "store.events must always be an array");
          readSuccessCount++;
        })
      );

      ops.push(
        repo.getOverview().then((overview) => {
          assert.ok(typeof overview.totalEvents === "number", "overview must have valid totalEvents");
          readSuccessCount++;
        })
      );
    }

    await Promise.all(ops);

    log.info(`Interleaved completed: ${writeSuccessCount} writes, ${readSuccessCount} reads without error`);
    assert.equal(writeSuccessCount, 40);
    assert.equal(readSuccessCount, 80);

    const allFiles = await fs.readdir(repo.shardsDirectory);
    const tmpFiles = allFiles.filter((f) => f.endsWith(".tmp"));
    assert.equal(tmpFiles.length, 0, "Zero .tmp files remaining after interleaved operations");
  });

  await testCase("2.4: 25 parallel ensure() calls on a fresh non-existent path never race or corrupt", async () => {
    const filePath = path.join(tempDir, "fresh-subfolder", "telemetry-ensure.json");
    const repo = new FileTelemetryRepository(filePath, null, { mirrorToR2: false });

    // Call ensure 25 times simultaneously
    const ensurePromises = Array.from({ length: 25 }, () => repo.ensure());
    await Promise.all(ensurePromises);

    const content = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(content);
    assert.equal(parsed.schemaVersion, 1);
    assert.deepEqual(parsed.events, []);

    const dirFiles = await fs.readdir(path.dirname(filePath));
    const tmpFiles = dirFiles.filter((f) => f.endsWith(".tmp"));
    assert.equal(tmpFiles.length, 0, "Zero .tmp files remaining after parallel ensure");
  });

  await testCase("2.5: Write/rename failure unlinks temporary file and leaves zero orphan .tmp files", async () => {
    const filePath = path.join(tempDir, "telemetry-unlink-test.json");
    const repo = new FileTelemetryRepository(filePath, null, { mirrorToR2: false });
    await repo.ensure();

    // Mock fs.rename to simulate an OS-level rename failure during atomic swap
    const originalRename = fs.rename;
    try {
      fs.rename = async (oldPath, newPath) => {
        if (oldPath.includes("telemetry-unlink-test") && oldPath.endsWith(".tmp")) {
          // Confirm the .tmp file actually exists on disk right before rename
          const stat = await fs.stat(oldPath);
          assert.ok(stat.size > 0, "Temporary file must have been written before rename");
          throw new Error("Simulated filesystem EIO during atomic rename");
        }
        return originalRename(oldPath, newPath);
      };

      let failed = false;
      try {
        await repo.update((store) => {
          store.events.push({ id: "fail-evt" });
        });
      } catch (err) {
        failed = true;
        assert.match(err.message, /Simulated filesystem EIO/);
      }
      assert.equal(failed, true, "Update must reject when rename fails");
    } finally {
      fs.rename = originalRename;
    }

    // Crucial check: verify the temporary file was unlinked in the catch block
    const allFiles = await fs.readdir(tempDir);
    const orphanTmpFiles = allFiles.filter((f) => f.includes("telemetry-unlink-test") && f.endsWith(".tmp"));
    assert.equal(orphanTmpFiles.length, 0, `No orphaned .tmp files must remain, found: ${orphanTmpFiles.join(", ")}`);
  });

  log.header("SUITE 3: Live Express HTTP Server Network Integration");

  const express = (await import("express")).default;
  const app = express();
  app.use(express.json());

  // Test auth simulation middleware
  app.use((req, res, next) => {
    const userHeader = req.headers["x-test-user"];
    if (userHeader) {
      req.auth = { user: { id: userHeader, emailVerifiedAt: "fixture" } };
      req.user = req.auth.user;
      req.ownerId = userHeader;
    }
    next();
  });

  const liveGuard = createAskExecutionGuard({ maxConcurrent: 100 });
  app.use("/api/ask", liveGuard, (req, res) => {
    const delay = Number(req.query.delay || 40);
    setTimeout(() => {
      res.json({ success: true, ownerId: req.ownerId });
    }, delay);
  });

  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    await testCase("3.1: Live HTTP - 10 concurrent distinct tenants never blocked", async () => {
      const requests = Array.from({ length: 10 }, async (_, i) => {
        const tenant = `live-tenant-${i + 1}`;
        const res = await fetch(`${baseUrl}/api/ask?delay=40`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-test-user": tenant,
          },
          body: JSON.stringify({ message: "hello" }),
        });
        const status = res.status;
        const data = await res.json();
        return { tenant, status, data };
      });

      const results = await Promise.all(requests);
      assert.equal(results.length, 10);
      for (const r of results) {
        assert.equal(r.status, 200, `Tenant ${r.tenant} expected 200, got ${r.status}`);
        assert.equal(r.data.success, true);
        assert.equal(r.data.ownerId, r.tenant);
      }
    });

    await testCase("3.2: Live HTTP - 2 simultaneous requests for same tenant properly blocks second with 429", async () => {
      const tenant = "live-same-tenant";

      const p1 = fetch(`${baseUrl}/api/ask?delay=60`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-test-user": tenant },
        body: JSON.stringify({ message: "first" }),
      });

      // Small delay to ensure p1 has entered guard before p2 arrives
      await new Promise((r) => setTimeout(r, 10));

      const p2 = fetch(`${baseUrl}/api/ask?delay=60`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-test-user": tenant },
        body: JSON.stringify({ message: "second" }),
      });

      const [res1, res2] = await Promise.all([p1, p2]);

      assert.equal(res1.status, 200, "First request must succeed with 200");
      assert.equal(res2.status, 429, "Second simultaneous request for same tenant must receive 429");

      const body2 = await res2.json();
      assert.equal(body2.code, "EXECUTION_BUSY");
      assert.equal(body2.retryable, true);

      // Now that both are resolved, verify a third request can immediately succeed
      const res3 = await fetch(`${baseUrl}/api/ask?delay=10`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-test-user": tenant },
        body: JSON.stringify({ message: "third" }),
      });
      assert.equal(res3.status, 200, "Subsequent request after completion must succeed with 200");
    });

    await testCase("3.3: Live HTTP - Client abort cleans up guard lock immediately", async () => {
      const tenant = "live-abort-tenant";
      const ac = new AbortController();

      const fetchPromise = fetch(`${baseUrl}/api/ask?delay=100`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-test-user": tenant },
        body: JSON.stringify({ message: "aborted" }),
        signal: ac.signal,
      }).catch((e) => {
        // Expected abort error
        return { aborted: true };
      });

      // Wait 15ms so request is in-flight, then abort
      await new Promise((r) => setTimeout(r, 15));
      ac.abort();
      await fetchPromise;

      // Allow server event loop to process socket close
      await new Promise((r) => setTimeout(r, 20));

      // Immediate subsequent request must succeed without 429
      const nextRes = await fetch(`${baseUrl}/api/ask?delay=10`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-test-user": tenant },
        body: JSON.stringify({ message: "next" }),
      });
      assert.equal(nextRes.status, 200, "Subsequent request after client abort must succeed with 200");
    });
  } finally {
    server.close();
  }

  // Cleanup temp dir
  await fs.rm(tempDir, { recursive: true, force: true });

  log.header("SUMMARY");
  console.log(`Passed: ${passedCount}`);
  console.log(`Failed: ${failedCount}`);

  if (failedCount > 0) {
    process.exit(1);
  }
}

runAllStressTests().catch((err) => {
  console.error("FATAL ERROR in stress runner:", err);
  process.exit(1);
});
