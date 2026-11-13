import { guestVisible, guestQuota } from "../services/security/guest-retention.js";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import {
  isR2Configured,
  loadJSONFromR2,
  saveJSONToR2,
  deleteJSONFromR2,
  readPlannerObject,
  writePlannerObject,
  deletePlannerObject,
} from "../http/r2-storage.js";
import { TenantLockManager } from "./tenant-lock.js";
import { storageCorruption, writeJsonAtomically } from "./atomic-json-store.js";

export class FilePlannerRepository {
  /**
   * @param {string} filePath - Path to planner.json or planner directory
   * @param {any} redis - Optional Redis client
   * @param {object} options - Optional overrides for cloud functions
   */
  constructor(filePath, redis = null, options = {}) {
    this.filePath = filePath;
    this.redis = redis;
    this.cloud = options.cloud ?? isR2Configured();
    this.readCloud = options.readCloud || readPlannerObject;
    this.writeCloud = options.writeCloud || writePlannerObject;
    this.deleteCloud = options.deleteCloud || deletePlannerObject;

    // Resolve directories and legacy file paths
    if (filePath && path.extname(filePath) === ".json") {
      this.legacyFilePath = filePath;
      this.plannerDir = path.join(path.dirname(filePath), "planner");
    } else {
      this.legacyFilePath = filePath ? path.join(filePath, "planner.json") : null;
      this.plannerDir = filePath
        ? (path.basename(filePath) === "planner" ? filePath : path.join(filePath, "planner"))
        : path.join(process.cwd(), "data", "planner");
    }
    this.baseDir = this.plannerDir;

    const baseLockDir = this.plannerDir
      ? path.dirname(this.plannerDir)
      : path.join(process.cwd(), "data");
    this.lockManager = new TenantLockManager(baseLockDir);

    // In-memory per-tenant queue Map: tenantKey -> Promise
    this.tenantQueues = new Map();

    // Track last synced ETag/digest per tenantKey to skip redundant disk/Redis writes on unchanged R2 reads
    this.syncedShardTags = new Map();
    this.inFlightTenantReads = new Map();

    // Migration memoization promise
    this._migrationPromise = null;
  }

  /**
   * Compute deterministic 64-character SHA-256 tenant hash.
   * @param {string} ownerId
   * @returns {string}
   */
  tenantKey(ownerId) {
    if (!ownerId || typeof ownerId !== "string") {
      throw new Error("Invalid ownerId for planner repository");
    }
    return createHash("sha256").update(ownerId.trim()).digest("hex");
  }

  /**
   * Local filesystem path for tenant shard.
   * @param {string} tenantKey
   * @returns {string}
   */
  tenantFilePath(tenantKey) {
    return path.join(this.plannerDir, `${tenantKey}.json`);
  }

  /**
   * Redis key for tenant planner tasks.
   * @param {string} ownerId
   * @returns {string}
   */
  tenantRedisKey(ownerId) {
    return `marketify:store:planner:${ownerId}`;
  }

  /**
   * Ensure storage directory exists and startup migration has executed.
   */
  async ensure() {
    await fs.mkdir(this.plannerDir, { recursive: true });
    await this.ensureMigrated();
  }

  /**
   * Idempotent migration trigger.
   */
  async ensureMigrated() {
    if (!this._migrationPromise) {
      this._migrationPromise = this.migrateLegacyPlannerIfPresent();
    }
    return this._migrationPromise;
  }

  /**
   * Migrate legacy monolithic planner.json / Redis / R2 into per-tenant shards.
   */
  async migrateLegacyPlannerIfPresent() {
    const markerPath = path.join(this.plannerDir, ".migration_done");
    let hasLocalMarker = false;
    try {
      await fs.access(markerPath);
      hasLocalMarker = true;
    } catch {}

    let localLegacyExists = false;
    if (this.legacyFilePath) {
      try {
        await fs.access(this.legacyFilePath);
        localLegacyExists = true;
      } catch {}
    }

    // If migration already finished and there is no unmigrated local legacy file, exit early
    if (hasLocalMarker && !localLegacyExists) {
      if (this.redis?.isReady && typeof this.redis.del === "function") {
        await this.redis.del("marketify:store:planner").catch(() => {});
      }
      return { migratedCount: 0, tenantsCount: 0 };
    }

    let legacyRecords = null;

    // 1. Check local legacy file
    if (this.legacyFilePath) {
      try {
        const raw = await fs.readFile(this.legacyFilePath, "utf8");
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) {
          legacyRecords = parsed;
        }
      } catch (err) {
        if (err.code !== "ENOENT") {
          console.error("Error reading legacy local planner.json:", err?.message || err);
        }
      }
    }

    // 2. Check R2 legacy object if not found locally (and migration was not already marked done)
    if (!hasLocalMarker && (!legacyRecords || legacyRecords.length === 0) && (this.cloud ?? isR2Configured())) {
      try {
        const r2Data = await loadJSONFromR2("planner.json");
        if (Array.isArray(r2Data) && r2Data.length > 0) {
          legacyRecords = r2Data;
        }
      } catch (err) {
        console.error("Error reading legacy R2 planner.json:", err?.message || err);
      }
    }

    // 3. Check legacy Redis global key if still empty (and migration was not already marked done)
    if (!hasLocalMarker && (!legacyRecords || legacyRecords.length === 0) && this.redis?.isReady) {
      try {
        const rawRedis = await this.redis.get("marketify:store:planner");
        if (rawRedis) {
          const parsed = JSON.parse(rawRedis);
          if (Array.isArray(parsed) && parsed.length > 0) {
            legacyRecords = parsed;
          }
        }
      } catch (err) {
        console.error("Error reading legacy Redis planner:", err?.message || err);
      }
    }

    if (!legacyRecords || !Array.isArray(legacyRecords) || legacyRecords.length === 0) {
      if (this.redis?.isReady && typeof this.redis.del === "function") {
        await this.redis.del("marketify:store:planner").catch(() => {});
      }
      // Mark migration as done so we never search legacy stores on subsequent boots
      await fs.mkdir(this.plannerDir, { recursive: true }).catch(() => {});
      await fs.writeFile(markerPath, JSON.stringify({ migratedAt: new Date().toISOString(), empty: true }), "utf8").catch(() => {});
      return { migratedCount: 0, tenantsCount: 0 };
    }

    console.log(`[FilePlannerRepository] Discovered ${legacyRecords.length} legacy planner tasks. Migrating to per-tenant shards...`);

    // Group by ownerId
    const byOwner = new Map();
    for (const record of legacyRecords) {
      if (!record || !record.ownerId) continue;
      if (!byOwner.has(record.ownerId)) {
        byOwner.set(record.ownerId, []);
      }
      byOwner.get(record.ownerId).push(record);
    }

    await fs.mkdir(this.plannerDir, { recursive: true });

    let migratedRecordsCount = 0;
    const isCloud = this.cloud ?? isR2Configured();
    for (const [ownerId, records] of byOwner.entries()) {
      const tenantKey = this.tenantKey(ownerId);
      const { records: existing, etag, notFound, tombstone } = await this.readTenantDataWithEtag(ownerId, tenantKey).catch(() => ({
        records: [],
        etag: null,
        notFound: true,
        tombstone: false,
      }));
      if (tombstone) {
        continue;
      }
      // If tenant already has an authoritative shard in R2, do not merge stale legacy records
      if (isCloud && !notFound && etag) {
        continue;
      }
      const existingIds = new Set((existing || []).map((r) => r.id));

      const merged = [...existing];
      for (const rec of records) {
        if (!existingIds.has(rec.id)) {
          merged.push(rec);
          existingIds.add(rec.id);
          migratedRecordsCount++;
        }
      }

      await this.writeLocalTenant(tenantKey, merged);

      if (this.redis?.isReady) {
        await this.redis.set(this.tenantRedisKey(ownerId), JSON.stringify(merged)).catch(() => {});
      }

      if (isCloud) {
        let currentEtag = etag;
        for (let attempt = 0; attempt < 5; attempt++) {
          try {
            const success = await this.writeCloud(tenantKey, merged, currentEtag);
            if (success) break;
          } catch (err) {
            console.error(`Failed to migrate shard to R2 for tenant ${tenantKey}:`, err?.message || err);
            break;
          }
          const fresh = await this.readTenantDataWithEtag(ownerId, tenantKey).catch(() => null);
          if (!fresh || fresh.tombstone) break;
          currentEtag = fresh.etag;
        }
      }
    }

    // Rename legacy file to .migrated backup
    if (this.legacyFilePath) {
      try {
        const backupPath = `${this.legacyFilePath}.migrated`;
        await fs.rename(this.legacyFilePath, backupPath).catch(() => {});
      } catch {}
    }

    // Archive and purge legacy R2 object to prevent resurrection on future restarts
    if (isCloud) {
      try {
        await saveJSONToR2("planner.json.migrated", legacyRecords);
        await saveJSONToR2("planner.json", []);
        await deleteJSONFromR2("planner.json");
      } catch (err) {
        console.error("Error archiving/deleting legacy R2 planner.json:", err?.message || err);
      }
    }

    // Purge legacy Redis key to prevent resurrection on future restarts
    if (this.redis?.isReady && typeof this.redis.del === "function") {
      await this.redis.del("marketify:store:planner").catch(() => {});
    }

    // Write persistent marker file
    try {
      await fs.writeFile(
        markerPath,
        JSON.stringify({
          migratedAt: new Date().toISOString(),
          tasksCount: migratedRecordsCount,
          tenantsCount: byOwner.size,
        }),
        "utf8"
      );
    } catch {}

    console.log(`[FilePlannerRepository] Successfully migrated ${migratedRecordsCount} tasks across ${byOwner.size} tenants.`);
    return { migratedCount: migratedRecordsCount, tenantsCount: byOwner.size };
  }

  /**
   * Execute an operation inside a per-tenant lock.
   * Guarantees concurrent operations on the same tenant never interleave across instances or processes.
   * @param {string} ownerId
   * @param {(tenantKey: string) => Promise<any>} fn
   * @returns {Promise<any>}
   */
  async runInTenantLock(ownerId, fn) {
    const tenantKey = this.tenantKey(ownerId);
    return this.lockManager.runInLock(tenantKey, () => fn(tenantKey));
  }

  /**
   * Alias for runInTenantLock.
   */
  async withTenantLock(ownerId, fn) {
    return this.runInTenantLock(ownerId, fn);
  }

  /**
   * Lock across two tenant IDs in deterministic order to prevent deadlocks.
   */
  async withTenantLocks(ownerId1, ownerId2, fn) {
    const key1 = this.tenantKey(ownerId1);
    const key2 = this.tenantKey(ownerId2);
    return this.lockManager.runInMultiLock([key1, key2], () => fn());
  }

  /**
   * Read tenant records and R2 ETag across R2, Redis, and local filesystem.
   * @param {string} ownerId
   * @param {string} tenantKey
   * @returns {Promise<{ records: any[], etag: string | null, notFound?: boolean, tombstone?: boolean, deletedAt?: string }>}
   */
  async readCloudSnapshot(tenantKey, { clone = true } = {}) {
    let pending = this.inFlightTenantReads.get(tenantKey);
    if (!pending) {
      pending = Promise.resolve().then(() => this.readCloud(tenantKey, { clone: false }));
      this.inFlightTenantReads.set(tenantKey, pending);
      const clear = () => { if (this.inFlightTenantReads.get(tenantKey) === pending) this.inFlightTenantReads.delete(tenantKey); };
      pending.then(clear, clear);
    }
    const res = await pending;
    return clone ? structuredClone(res) : res;
  }

  async readTenantDataWithEtag(ownerId, tenantKey, options = {}) {
    // 1. Try Cloudflare R2
    if (this.cloud) {
      try {
        const res = await this.readCloudSnapshot(tenantKey, options);
        const { record, etag, notFound, tombstone } = res || {};
        if (tombstone || (record && typeof record === "object" && !Array.isArray(record) && record._tombstone)) {
          this.syncedShardTags.delete(tenantKey);
          await fs.rm(this.tenantFilePath(tenantKey), { force: true }).catch(() => {});
          if (this.redis?.isReady) {
            await this.redis.del(this.tenantRedisKey(ownerId)).catch(() => {});
          }
          return { records: [], etag, notFound: false, tombstone: true, deletedAt: record?.deletedAt };
        }
        if (record && Array.isArray(record)) {
          const tagKey = etag
            ? `${etag}:${record.length}:${record[0]?.id || ""}:${record[0]?.updatedAt || ""}:${record.at(-1)?.id || ""}:${record.at(-1)?.updatedAt || ""}`
            : createHash("sha256").update(JSON.stringify(record)).digest("hex");
          if (this.syncedShardTags.get(tenantKey) !== tagKey) {
            await this.writeLocalTenant(tenantKey, record).catch(() => {});
            if (this.redis?.isReady) {
              await this.redis.set(this.tenantRedisKey(ownerId), JSON.stringify(record)).catch(() => {});
            }
            this.syncedShardTags.set(tenantKey, tagKey);
          }
          return { records: record, etag, notFound: false, tombstone: false };
        }
        if (notFound || record === null) {
          this.syncedShardTags.delete(tenantKey);
          await fs.rm(this.tenantFilePath(tenantKey), { force: true }).catch(() => {});
          if (this.redis?.isReady) {
            await this.redis.del(this.tenantRedisKey(ownerId)).catch(() => {});
          }
          return { records: [], etag: null, notFound: true, tombstone: false };
        }
        throw storageCorruption("Invalid authoritative tenant shard structure.");
      } catch (err) {
        console.error(`R2 planner read error (${tenantKey}):`, err?.message || err);
        throw err;
      }
    }

    // Local disk is authoritative; Redis may contain a stale mirror after an outage.
    const targetPath = this.tenantFilePath(tenantKey);
    try {
      const raw = await fs.readFile(targetPath, "utf8");
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && parsed._tombstone) {
        return { records: [], etag: null, notFound: false, tombstone: true, deletedAt: parsed.deletedAt };
      }
      if (!Array.isArray(parsed)) throw storageCorruption("Invalid tenant shard structure.");
      const records = parsed;
      if (records.length > 0 && this.redis?.isReady) {
        const digest = createHash("sha256").update(raw).digest("hex");
        if (this.syncedShardTags.get(tenantKey) !== digest) {
          await this.redis.set(this.tenantRedisKey(ownerId), JSON.stringify(records)).catch(() => {});
          this.syncedShardTags.set(tenantKey, digest);
        }
      }
      return { records, etag: null, notFound: false, tombstone: false };
    } catch (error) {
      if (error.code === "ENOENT") {
        return { records: [], etag: null, notFound: true, tombstone: false };
      }
      if (error instanceof SyntaxError) {
        throw storageCorruption(`Planner shard ${tenantKey} contains invalid JSON.`, error);
      }
      throw error;
    }
  }

  /**
   * Atomic local write using PID + UUID temporary file followed by fs.rename.
   * @param {string} tenantKey
   * @param {any[]} records
   */
  async writeLocalTenant(tenantKey, records) {
    await fs.mkdir(this.plannerDir, { recursive: true });
    await writeJsonAtomically(this.tenantFilePath(tenantKey), records);
  }

  /**
   * Safe atomic local disk write (backward compatibility helper)
   */
  async writeLocalFile(targetPath, records) {
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    const tempPath = `${targetPath}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(tempPath, `${JSON.stringify(records, null, 2)}\n`, "utf8");
      await fs.rename(tempPath, targetPath);
    } catch (err) {
      await fs.rm(tempPath, { force: true }).catch(() => {});
      throw err;
    }
  }

  /**
   * Optimistic Concurrency Control (OCC) mutation wrapper.
   * Wraps read-modify-write inside in-process tenant queue and retries up to 10 times on R2 412 conflicts.
   * @param {string} ownerId
   * @param {(records: any[]) => { updated?: any[], result?: any } | { records?: any[], result?: any } | any} mutator
   * @returns {Promise<any>}
   */
  async mutateTenant(ownerId, mutator) {
    await this.ensureMigrated();

    return this.runInTenantLock(ownerId, async (tenantKey) => {
      const isCloud = this.cloud ?? isR2Configured();
      const maxAttempts = isCloud ? 10 : 1;
      const mutationStartedAt = Date.now();

      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const { records, etag, tombstone, deletedAt } = await this.readTenantDataWithEtag(ownerId, tenantKey);

        if (tombstone) {
          return null;
        }

        const recordsCopy = JSON.parse(JSON.stringify(records));

        const mutatorOutput = await mutator(recordsCopy);
        const nextRecords = mutatorOutput?.updated !== undefined
          ? mutatorOutput.updated
          : (mutatorOutput?.records !== undefined
            ? mutatorOutput.records
            : (Array.isArray(mutatorOutput) ? mutatorOutput : recordsCopy));
        const returnValue = mutatorOutput?.result !== undefined ? mutatorOutput.result : mutatorOutput;

        // Perform R2 conditional PUT with OCC ETag
        if (isCloud) {
          const success = await this.writeCloud(tenantKey, nextRecords, etag);
          if (!success) {
            // Precondition failed (412/409): wait with exponential jitter and retry
            await new Promise((resolve) => setTimeout(resolve, Math.floor(Math.random() * 40) + attempt * 25));
            continue;
          }
        }

        // Commit to local filesystem and Redis
        this.syncedShardTags.delete(tenantKey);
        await this.writeLocalTenant(tenantKey, nextRecords);

        if (this.redis?.isReady) {
          try {
            await this.redis.set(this.tenantRedisKey(ownerId), JSON.stringify(nextRecords));
          } catch (err) {
            console.error(`Redis planner write error (${ownerId}):`, err?.message || err);
          }
        }

        return returnValue;
      }

      const err = new Error("Planner storage concurrency conflict. Maximum retries exceeded.");
      err.code = "STORAGE_BUSY";
      err.statusCode = 503;
      throw err;
    });
  }

  /**
   * Read all records for a specific tenant.
   * @param {string} ownerId
   * @returns {Promise<any[]>}
   */
  async readTenant(ownerId, options = {}) {
    await this.ensureMigrated();
    const tenantKey = this.tenantKey(ownerId);
    const { records, tombstone } = await this.readTenantDataWithEtag(ownerId, tenantKey, options);
    if (tombstone) return [];
    return records.filter((r) => !r.deleted && guestVisible(r, ownerId));
  }

  /**
   * Backwards-compatible readAll method:
   * - If ownerId is provided, returns that tenant's records.
   * - If ownerId is omitted, aggregates records across all local tenant shard files.
   * @param {string} [ownerId]
   * @returns {Promise<any[]>}
   */
  async readAll(ownerId = null) {
    if (ownerId) {
      return this.readTenant(ownerId);
    }

    await this.ensure();

    try {
      const entries = await fs.readdir(this.plannerDir, { withFileTypes: true });
      const aggregated = [];
      for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith(".json") && !entry.name.endsWith(".tmp")) {
          try {
            const raw = await fs.readFile(path.join(this.plannerDir, entry.name), "utf8");
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
              aggregated.push(...parsed.filter((r) => r && !r.deleted));
            }
          } catch {
            // Ignore malformed shard
          }
        }
      }
      return aggregated;
    } catch (err) {
      console.error("Error reading all planner shards:", err?.message || err);
      return [];
    }
  }

  /**
   * Backwards-compatible writeAll method.
   * Partitions records by ownerId and persists to their respective shards.
   * @param {any[]} records
   */
  async writeAll(records) {
    await this.ensure();
    if (!Array.isArray(records)) return;

    const byOwner = new Map();
    for (const record of records) {
      if (!record || !record.ownerId) continue;
      if (!byOwner.has(record.ownerId)) byOwner.set(record.ownerId, []);
      byOwner.get(record.ownerId).push(record);
    }

    for (const [ownerId, tenantRecords] of byOwner.entries()) {
      await this.mutateTenant(ownerId, () => ({
        updated: tenantRecords,
        result: true,
      }));
    }
  }

  /**
   * List all tasks for a given owner, sorted by createdAt descending.
   * @param {string} ownerId
   * @returns {Promise<any[]>}
   */
  async getById(id, ownerId) {
    if (!id || !ownerId) return null;
    const records = await this.readTenant(ownerId, { clone: false });
    const found = records.find((task) => task.id === id && task.ownerId === ownerId && !task.deleted) || null;
    return found ? structuredClone(found) : null;
  }

  async list(ownerId) {
    if (!ownerId) return [];
    const records = await this.readTenant(ownerId);
    return records
      .filter((task) => !task.deleted && task.ownerId === ownerId)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  /**
   * Add a batch of tasks for an owner, skipping duplicates.
   * @param {string} ownerId
   * @param {any[]} tasks
   * @returns {Promise<any[]>}
   */
  async addBatch(ownerId, tasks = []) {
    if (!ownerId) throw new Error("ownerId is required to add tasks");
    await this.ensureMigrated();

    return this.mutateTenant(ownerId, async (records) => {
      guestQuota(records, ownerId, 50, tasks.length);
      const now = new Date().toISOString();
      const added = [];

      for (const item of tasks) {
        const rawText = typeof item === "string" ? item : (item.title || item.text || "");
        const cleaned = String(rawText || "")
          .replace(/^[\s\-*•\d.)\]]+/, "")
          .trim();
        const text = cleaned || String(rawText || "").trim();
        if (!text) continue;

        const groupLabel = item.groupLabel || item.timeframe || "Ümumi";
        const timeframe = item.timeframe || groupLabel;
        const title = text;
        const status = item.status || (item.completed ? "completed" : "todo");
        const strategyId = item.strategyId || null;
        const strategyTitle = item.strategyTitle || null;

        // Prevent duplicate task from same strategy with exact same text or title (ignore soft-deleted tasks)
        const isDuplicate = records.some(
          (r) =>
            !r.deleted &&
            r.ownerId === ownerId &&
            ((r.title && r.title.toLowerCase() === title.toLowerCase()) ||
             (r.text && r.text.toLowerCase() === text.toLowerCase())) &&
            r.strategyId === strategyId
        );

        if (!isDuplicate) {
          const isPriority = Boolean(item.isPriority || item.priority === "high");
          const priority = item.priority || (isPriority ? "high" : "normal");
          const newTask = {
            id: randomUUID(),
            ownerId,
            title,
            text,
            timeframe,
            groupLabel,
            status,
            strategyId,
            strategyTitle,
            source: item.source || (strategyId || strategyTitle ? "brief" : "user"),
            ...(item.searchGrounded || item.groundingActive ? { searchGrounded: true } : {}),
            feedback: item.feedback || null,
            isPriority,
            priority,
            completed: status === "completed" || Boolean(item.completed),
            completedAt: (status === "completed" || item.completed) ? now : null,
            createdAt: now,
            updatedAt: now,
          };
          records.unshift(newTask);
          added.push(newTask);
        }
      }

      return { updated: records, result: added };
    });
  }

  /**
   * Update a specific task. Enforces mass-assignment protection.
   * @param {string} id
   * @param {string} ownerId
   * @param {object} changes
   * @returns {Promise<any | null>}
   */
  async update(id, ownerId, changes = {}) {
    if (!id || !ownerId) return null;
    await this.ensureMigrated();

    const targetId = String(id).trim().toLowerCase();
    return this.mutateTenant(ownerId, async (records) => {
      const index = records.findIndex((r) => {
        if (r.deleted) return false;
        const matchesId = String(r.id || "").trim().toLowerCase() === targetId;
        const matchesOwner = !r.ownerId || r.ownerId === ownerId;
        return matchesId && matchesOwner;
      });
      if (index === -1) return { updated: records, result: null };

      const now = new Date().toISOString();
      const { id: _ignoredId, ownerId: _ignoredOwnerId, createdAt: _ignoredCreatedAt, strategyId: _ignoredStrategyId, searchGrounded: _ignoredSearchGrounded, ...safeChanges } = changes;

      const completed = typeof safeChanges.completed === "boolean"
        ? safeChanges.completed
        : (safeChanges.status ? safeChanges.status === "completed" : records[index].completed);

      const isPriority = typeof safeChanges.isPriority === "boolean"
        ? safeChanges.isPriority
        : (safeChanges.priority ? safeChanges.priority === "high" : Boolean(records[index].isPriority));
      const priority = safeChanges.priority || (isPriority ? "high" : (records[index].priority || "normal"));

      const status = safeChanges.status || (completed ? "completed" : (records[index].status || "todo"));
      const title = safeChanges.title || safeChanges.text || records[index].title || records[index].text;
      const text = safeChanges.text || safeChanges.title || records[index].text || records[index].title;
      const timeframe = safeChanges.timeframe || safeChanges.groupLabel || records[index].timeframe || records[index].groupLabel;
      const groupLabel = safeChanges.groupLabel || safeChanges.timeframe || records[index].groupLabel || records[index].timeframe;
      const feedback = safeChanges.feedback !== undefined ? safeChanges.feedback : (records[index].feedback || null);
      const source = safeChanges.source !== undefined
        ? safeChanges.source
        : (records[index].source || (records[index].strategyId || records[index].strategyTitle ? "brief" : "user"));
      const searchGrounded = Boolean(records[index].searchGrounded || records[index].groundingActive || changes.searchGrounded || changes.groundingActive);

      records[index] = {
        ...records[index],
        ...safeChanges,
        id: records[index].id,
        ownerId: records[index].ownerId,
        createdAt: records[index].createdAt,
        strategyId: records[index].strategyId ?? null,
        ...(searchGrounded ? { searchGrounded: true } : {}),
        title,
        text,
        timeframe,
        groupLabel,
        status,
        isPriority,
        priority,
        source,
        feedback,
        completed,
        completedAt: completed ? (records[index].completedAt || now) : null,
        updatedAt: now,
      };

      return { updated: records, result: records[index] };
    });
  }

  /**
   * Update task priorities in batch.
   * @param {string} ownerId
   * @param {string[] | Set<string>} priorityTaskIds
   * @returns {Promise<any[]>}
   */
  async updatePriorities(ownerId, priorityTaskIds = []) {
    if (!ownerId) return [];
    await this.ensureMigrated();

    return this.mutateTenant(ownerId, async (records) => {
      const idSet = priorityTaskIds instanceof Set ? priorityTaskIds : new Set(priorityTaskIds);
      let updatedCount = 0;
      const now = new Date().toISOString();
      for (const record of records) {
        if (!record.deleted && record.ownerId === ownerId) {
          const shouldBePriority = idSet.has(record.id);
          if (Boolean(record.isPriority) !== shouldBePriority || record.priority !== (shouldBePriority ? "high" : "normal")) {
            record.isPriority = shouldBePriority;
            record.priority = shouldBePriority ? "high" : "normal";
            record.updatedAt = now;
            updatedCount++;
          }
        }
      }
      const sorted = records
        .filter((task) => !task.deleted && task.ownerId === ownerId)
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      return { updated: records, result: sorted };
    });
  }

  /**
   * Delete a task by ID (retaining a soft-delete tombstone to prevent resurrection).
   * @param {string} id
   * @param {string} ownerId
   * @returns {Promise<boolean>}
   */
  async delete(id, ownerId) {
    if (!id || !ownerId) return false;
    await this.ensureMigrated();

    const targetId = String(id).trim().toLowerCase();
    return this.mutateTenant(ownerId, async (records) => {
      let matched = false;
      const deletedAt = new Date().toISOString();
      const nextRecords = records.map((r) => {
        if (r.deleted) return r;
        const matchesId = String(r.id || "").trim().toLowerCase() === targetId;
        const matchesOwner = !r.ownerId || r.ownerId === ownerId;
        if (matchesId && matchesOwner) {
          matched = true;
          return {
            id: r.id,
            ownerId: r.ownerId || ownerId,
            deleted: true,
            deletedAt,
          };
        }
        return r;
      });
      if (matched) {
        return { updated: nextRecords, result: true };
      }
      return { updated: records, result: false };
    });
  }

  /**
   * Clear all completed tasks for an owner (retaining soft-delete tombstones).
   * @param {string} ownerId
   * @returns {Promise<number>}
   */
  async clearCompleted(ownerId) {
    if (!ownerId) return 0;
    await this.ensureMigrated();

    return this.mutateTenant(ownerId, async (records) => {
      let count = 0;
      const now = new Date().toISOString();
      const nextRecords = records.map((r) => {
        if (r.deleted) return r;
        const matchesOwner = !r.ownerId || r.ownerId === ownerId;
        const isCompleted = Boolean(r.completed || r.status === "completed");
        if (matchesOwner && isCompleted) {
          count++;
          return {
            id: r.id,
            ownerId: r.ownerId || ownerId,
            deleted: true,
            deletedAt: now,
          };
        }
        return r;
      });
      return { updated: nextRecords, result: count };
    });
  }

  /**
   * Atomically migrate all planner tasks from previousOwnerId (guest) to ownerId (user).
   * @param {string} previousOwnerId
   * @param {string} ownerId
   * @returns {Promise<number>}
   */
  async claimOwner(previousOwnerId, ownerId) {
    if (!previousOwnerId || !ownerId || previousOwnerId === ownerId) return 0;
    await this.ensure();

    const guestKey = this.tenantKey(previousOwnerId);
    const userKey = this.tenantKey(ownerId);

    return this.withTenantLocks(previousOwnerId, ownerId, async () => {
      // 1. Read guest records with ETag
      const guestData = await this.readTenantDataWithEtag(previousOwnerId, guestKey);
      const guestRecords = Array.isArray(guestData.records) ? guestData.records.filter(record => !record.deleted && guestVisible(record, previousOwnerId)) : [];
      if (guestRecords.length === 0 || guestData.tombstone) {
        return 0;
      }

      // 2. Read destination records with ETag and perform OCC retry merge
      const isCloud = this.cloud ?? isR2Configured();
      const maxRetries = 5;
      let claimedCount = 0;
      let committed = false;

      for (let attempt = 0; attempt < maxRetries; attempt++) {
        const destData = await this.readTenantDataWithEtag(ownerId, userKey);
        if (destData.tombstone) {
          throw new Error("Cannot migrate to a tombstoned/deleted tenant account");
        }
        const userRecords = Array.isArray(destData.records) ? [...destData.records] : [];

        const claimedRecords = guestRecords.map((t) => ({
          ...t,
          ownerId,
        }));

        const existingIds = new Set(
          userRecords.map((r) => String(r.id || "").toLowerCase())
        );
        const existingSignatures = new Set(
          userRecords
            .filter((r) => !r.deleted)
            .map((r) => `${r.strategyId || ""}:${(r.title || r.text || "").toLowerCase()}`)
        );
        const deduplicatedClaimed = claimedRecords.filter(
          (r) =>
            !existingIds.has(String(r.id || "").toLowerCase()) &&
            !existingSignatures.has(`${r.strategyId || ""}:${(r.title || r.text || "").toLowerCase()}`)
        );

        claimedCount = deduplicatedClaimed.length;
        const activeUserRecords = userRecords.filter((r) => !r.deleted);
        const tombstoneUserRecords = userRecords.filter((r) => r.deleted);
        const sortedActive = [...activeUserRecords, ...deduplicatedClaimed].sort(
          (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
        );
        const combined = [...sortedActive, ...tombstoneUserRecords];

        // Commit User Records locally first
        this.syncedShardTags.delete(userKey);
        await this.writeLocalTenant(userKey, combined);

        if (isCloud) {
          try {
            const success = await this.writeCloud(userKey, combined, destData.etag);
            if (!success) {
              // OCC conflict on destination shard! Wait and retry
              await new Promise((r) => setTimeout(r, 20 * Math.pow(2, attempt) + Math.random() * 20));
              continue;
            }
          } catch (err) {
            console.error(`Failed to write migrated shard to R2 for tenant ${userKey}:`, err?.message || err);
            throw err;
          }
        }

        if (this.redis?.isReady) {
          await this.redis.set(this.tenantRedisKey(ownerId), JSON.stringify(combined)).catch(() => {});
        }

        committed = true;
        break;
      }

      if (!committed) {
        const conflictErr = new Error(`Migration conflict: destination shard ${userKey} could not be updated after ${maxRetries} attempts`);
        conflictErr.code = "STORAGE_CONFLICT";
        conflictErr.statusCode = 409;
        throw conflictErr;
      }

      // 3. Purge/cleanup old guest shard ONLY after destination is confirmed written!
      // Check if parallel writes added new unmigrated records to guest shard
      const freshGuestData = await this.readTenantDataWithEtag(previousOwnerId, guestKey).catch(() => ({ records: [] }));
      const freshGuestRecords = Array.isArray(freshGuestData.records) ? freshGuestData.records : [];
      const migratedIds = new Set(guestRecords.map((r) => r.id));
      const unmigratedGuestRecords = freshGuestRecords.filter((r) => !r.deleted && !migratedIds.has(r.id));

      if (unmigratedGuestRecords.length > 0) {
        // Parallel write added new records to guest shard: preserve unmigrated records!
        this.syncedShardTags.delete(guestKey);
        await this.writeLocalTenant(guestKey, unmigratedGuestRecords);
        if (isCloud) {
          await this.writeCloud(guestKey, unmigratedGuestRecords, freshGuestData.etag).catch(() => {});
        }
        if (this.redis?.isReady) {
          await this.redis.set(this.tenantRedisKey(previousOwnerId), JSON.stringify(unmigratedGuestRecords)).catch(() => {});
        }
      } else {
        // Safely remove guest shard
        this.syncedShardTags.delete(guestKey);
        await fs.rm(this.tenantFilePath(guestKey), { force: true }).catch(() => {});
        if (this.redis?.isReady) {
          await this.redis.del(this.tenantRedisKey(previousOwnerId)).catch(() => {});
        }
        if (isCloud) {
          await this.writeCloud(guestKey, [], freshGuestData.etag).catch(() => {});
          await this.deleteCloud(guestKey).catch(() => {});
        }
      }

      return claimedCount;
    });
  }

  /**
   * Delete all planner tasks belonging to an owner.
   * @param {string} ownerId
   * @returns {Promise<number>}
   */
  async deleteAllByOwner(ownerId) {
    if (!ownerId) return 0;
    await this.ensure();

    return this.runInTenantLock(ownerId, async (tenantKey) => {
      const { records, etag } = await this.readTenantDataWithEtag(ownerId, tenantKey);
      const count = Array.isArray(records) ? records.filter((r) => !r.deleted).length : 0;
      const now = new Date().toISOString();

      const tombstoneRecord = {
        _tombstone: true,
        deletedAt: now,
        ownerId,
      };

      // 1. In cloud mode, write OCC-protected tombstone with retry
      const isCloud = this.cloud ?? isR2Configured();
      if (isCloud) {
        let written = false;
        let currentEtag = etag;
        const maxRetries = 5;

        for (let attempt = 0; attempt < maxRetries; attempt++) {
          try {
            written = await this.writeCloud(tenantKey, tombstoneRecord, currentEtag);
            if (written) break;
          } catch (err) {
            console.error(`Failed to write tombstone to R2 for planner tenant ${tenantKey}:`, err?.message || err);
            throw err;
          }

          // Conflict: re-read to get fresh ETag
          const fresh = await this.readTenantDataWithEtag(ownerId, tenantKey);
          if (fresh.tombstone) {
            written = true;
            break;
          }
          currentEtag = fresh.etag;
          await new Promise((r) => setTimeout(r, 20 * Math.pow(2, attempt) + Math.random() * 20));
        }

        if (!written) {
          const conflictErr = new Error(`Tenant deletion conflict: failed to write tombstone after ${maxRetries} attempts`);
          conflictErr.code = "STORAGE_CONFLICT";
          conflictErr.statusCode = 409;
          throw conflictErr;
        }
      }

      // 2. Write tombstone to local shard with unique temp file + rename
      this.syncedShardTags.delete(tenantKey);
      const targetPath = this.tenantFilePath(tenantKey);
      const tempPath = `${targetPath}.${randomUUID()}.tmp`;
      await fs.mkdir(path.dirname(targetPath), { recursive: true });
      await fs.writeFile(tempPath, `${JSON.stringify(tombstoneRecord, null, 2)}\n`, "utf8");
      await fs.rename(tempPath, targetPath);

      // 3. Remove Redis key ONLY AFTER authoritative commit
      if (this.redis?.isReady) {
        await this.redis.del(this.tenantRedisKey(ownerId)).catch(() => {});
      }

      return count;
    });
  }
}
