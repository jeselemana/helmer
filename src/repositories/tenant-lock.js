import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { hostname } from "node:os";

function ownerIsAlive(info) {
  if (!info?.pid || (info.hostname && info.hostname !== hostname())) return false;
  try {
    process.kill(info.pid, 0);
    return true;
  } catch (error) {
    return error.code !== "ESRCH";
  }
}

/**
 * Cross-instance and cross-process file-based lock for tenant mutations.
 * Provides safe release with token, crash recovery (stale detection),
 * timeout handling, and deterministic multi-tenant locking to prevent deadlocks.
 */

export class TenantLockManager {
  /**
   * @param {string} baseDir - Directory where .tenant-locks folder will be located
   * @param {object} [options]
   * @param {number} [options.timeoutMs=15000] - Timeout waiting for lock
   * @param {number} [options.staleMs=20000] - Duration after which an abandoned lock is broken
   */
  constructor(baseDir, options = {}) {
    this.baseDir = baseDir || path.join(process.cwd(), "data");
    this.locksDir = path.join(this.baseDir, ".tenant-locks");
    this.timeoutMs = options.timeoutMs ?? 15000;
    this.staleMs = options.staleMs ?? 20000;
    this.inProcessQueues = new Map();
  }

  /**
   * Acquire a lock for a single tenantKey.
   * @param {string} tenantKey
   * @returns {Promise<{ token: string, release: () => Promise<void> }>}
   */
  async acquire(tenantKey) {
    await fs.mkdir(this.locksDir, { recursive: true }).catch(() => {});
    const lockDir = path.join(this.locksDir, `${tenantKey}.lock`);
    const token = randomUUID();
    const ownerName = `owner-${token}.json`;
    const staging = `${lockDir}.${token}.tmp`;
    const start = Date.now();
    let handle;
    let acquired = false;

    try {
      await fs.mkdir(staging, { mode: 0o700 });
      handle = await fs.open(path.join(staging, ownerName), "wx", 0o600);
      await handle.writeFile(JSON.stringify({ token, pid: process.pid, hostname: hostname(), createdAt: start }));

      while (true) {
        try {
          // Publish a nonempty directory atomically. A stale reaper may remove
          // an empty directory but cannot remove a newer generation's marker.
          const now = new Date();
          await handle.utimes(now, now);
          await fs.rename(staging, lockDir);
          acquired = true;
          break;
        } catch (error) {
          if (error.code !== "EEXIST" && error.code !== "ENOTEMPTY") throw error;
        }

        await this.reapStaleLock(lockDir);
        if (Date.now() - start > this.timeoutMs) {
          throw Object.assign(new Error(`Tenant concurrency conflict: lock timeout for tenant ${tenantKey}`), {
            code: "STORAGE_BUSY", statusCode: 503,
          });
        }
        await new Promise((resolve) => setTimeout(resolve, 15 + Math.floor(Math.random() * 25)));
      }

      const heartbeat = setInterval(() => {
        const now = new Date();
        handle.utimes(now, now).catch(() => {});
      }, Math.max(5, Math.floor(this.staleMs / 3)));
      heartbeat.unref();

      let released = false;
      return {
        token,
        release: async () => {
          if (released) return;
          released = true;
          clearInterval(heartbeat);
          try {
            await handle.close();
          } finally {
            await fs.unlink(path.join(lockDir, ownerName)).catch(() => {});
            await fs.rmdir(lockDir).catch(() => {});
          }
        },
      };
    } finally {
      if (!acquired) {
        await handle?.close().catch(() => {});
        await fs.rm(staging, { recursive: true, force: true }).catch(() => {});
      }
    }
  }

  async reapStaleLock(lockDir) {
    try {
      const directory = await fs.stat(lockDir);
      const entries = await fs.readdir(lockDir);
      const name = entries.find(entry => /^owner-[a-f0-9-]{36}\.json$/.test(entry) || entry === "owner.json");
      if (!name) {
        if (entries.length === 0 && Date.now() - directory.mtimeMs > this.staleMs) await fs.rmdir(lockDir);
        return;
      }

      const ownerFile = path.join(lockDir, name);
      const observed = await fs.stat(ownerFile);
      let owner = null;
      try { owner = JSON.parse(await fs.readFile(ownerFile, "utf8")); } catch {}
      const current = await fs.stat(ownerFile);
      if (current.dev !== observed.dev || current.ino !== observed.ino ||
          current.mtimeMs !== observed.mtimeMs || Date.now() - current.mtimeMs <= this.staleMs ||
          ownerIsAlive(owner)) return;

      // Only unlink the observed generation. A newer nonempty lock directory
      // survives rmdir even when another reaper has already removed this one.
      await fs.unlink(ownerFile);
      await fs.rmdir(lockDir);
    } catch {
      // Released, renewed, or being recovered by another contender.
    }
  }

  /**
   * Run fn in a serialized in-process queue + cross-process file lock.
   * @param {string} tenantKey
   * @param {() => Promise<any>} fn
   * @returns {Promise<any>}
   */
  async runInLock(tenantKey, fn) {
    const previousQueue = this.inProcessQueues.get(tenantKey) || Promise.resolve();

    let releaseInProcess;
    const currentQueue = new Promise((resolve) => {
      releaseInProcess = resolve;
    });
    this.inProcessQueues.set(tenantKey, currentQueue);

    try {
      await previousQueue;
    } catch {
      // Ignore errors from earlier in-process operations
    }

    let fileLock = null;
    try {
      fileLock = await this.acquire(tenantKey);
      return await fn();
    } finally {
      if (fileLock) {
        await fileLock.release().catch(() => {});
      }
      releaseInProcess();
      if (this.inProcessQueues.get(tenantKey) === currentQueue) {
        this.inProcessQueues.delete(tenantKey);
      }
    }
  }

  /**
   * Run fn with locks on multiple tenant keys acquired in deterministic
   * lexicographical order to prevent deadlocks.
   * @param {string[]} tenantKeys
   * @param {() => Promise<any>} fn
   * @returns {Promise<any>}
   */
  async runInMultiLock(tenantKeys, fn) {
    const uniqueKeys = Array.from(new Set(tenantKeys)).sort();
    if (uniqueKeys.length === 0) return fn();
    if (uniqueKeys.length === 1) return this.runInLock(uniqueKeys[0], fn);

    const acquireNested = async (index) => {
      if (index >= uniqueKeys.length) {
        return fn();
      }
      return this.runInLock(uniqueKeys[index], () => acquireNested(index + 1));
    };

    return acquireNested(0);
  }
}
