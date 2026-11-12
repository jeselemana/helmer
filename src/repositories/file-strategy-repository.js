import { guestVisible, guestQuota } from "../services/security/guest-retention.js";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import {
  isR2Configured,
  loadJSONFromR2,
  readStrategyObject,
  writeStrategyObject,
  deleteStrategyObject,
  listTenantObjects,
} from "../http/r2-storage.js";
import { TenantLockManager } from "./tenant-lock.js";
import { storageCorruption, writeJsonAtomically } from "./atomic-json-store.js";
import { invalidateUserContextCache } from "../services/ai/personal-context.js";
import {
  MAX_GROUNDED_CHAT_RETENTION_MS,
  isGroundedStrategyRecord,
  isExpiredGroundedStrategyRecord,
  pruneExpiredGroundedStrategies,
  rememberGroundedStrategyProvenance,
  resolveGroundedStrategyProvenance,
  applyGroundedProvenanceToStrategy,
  exportOwnerProvenanceEntries,
  hydrateOwnerProvenanceEntries,
} from "../services/ai/grounded-chat-retention.js";

function parseValidDateMs(value, now = Date.now()) {
  if (value === undefined || value === null || String(value).trim() === "") return null;
  const parsed = typeof value === "number" ? value : Date.parse(String(value));
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > now + 60000) return NaN;
  return parsed;
}

export class FileStrategyRepository {
  /**
   * @param {string} filePath - Path to strategies.json or strategies directory
   * @param {any} redis - Optional Redis client
   * @param {object} options - Optional overrides for cloud functions
   */
  constructor(filePath, redis = null, options = {}) {
    this.filePath = filePath;
    this.redis = redis;
    this.cloud = options.cloud ?? isR2Configured();
    this.readCloud = options.readCloud || readStrategyObject;
    this.writeCloud = options.writeCloud || writeStrategyObject;
    this.deleteCloud = options.deleteCloud || deleteStrategyObject;
    this.listCloudShards = options.listCloudShards || (() => listTenantObjects("strategies-v1/"));

    // Resolve directories and legacy file paths
    if (filePath && path.extname(filePath) === ".json") {
      this.legacyFilePath = filePath;
      this.strategiesDir = path.join(path.dirname(filePath), "strategies");
    } else {
      this.legacyFilePath = filePath ? path.join(filePath, "strategies.json") : null;
      this.strategiesDir = filePath
        ? (path.basename(filePath) === "strategies" ? filePath : path.join(filePath, "strategies"))
        : path.join(process.cwd(), "data", "strategies");
    }

    const baseLockDir = this.strategiesDir
      ? path.dirname(this.strategiesDir)
      : path.join(process.cwd(), "data");
    this.lockManager = new TenantLockManager(baseLockDir);

    // In-memory per-tenant queue Map: tenantKey -> Promise
    this.tenantQueues = new Map();
    this.inFlightTenantReads = new Map();

    // Track last synced ETag/digest per tenantKey to skip redundant disk/Redis writes on unchanged R2 reads
    this.syncedShardTags = new Map();

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
      throw new Error("Invalid ownerId for strategy repository");
    }
    return createHash("sha256").update(ownerId.trim()).digest("hex");
  }

  /**
   * Local filesystem path for tenant shard.
   * @param {string} tenantKey
   * @returns {string}
   */
  tenantFilePath(tenantKey) {
    return path.join(this.strategiesDir, `${tenantKey}.json`);
  }

  /**
   * Redis key for tenant strategies.
   * @param {string} ownerId
   * @returns {string}
   */
  tenantRedisKey(ownerId) {
    return `marketify:store:strategies:${ownerId}`;
  }

  /**
   * Ensure storage directory exists and startup migration has executed.
   */
  async ensure() {
    await fs.mkdir(this.strategiesDir, { recursive: true });
    await this.ensureMigrated();
  }

  /**
   * Idempotent migration trigger.
   */
  async ensureMigrated() {
    if (!this._migrationPromise) {
      this._migrationPromise = this.migrateLegacyStrategiesIfPresent();
    }
    return this._migrationPromise;
  }

  /**
   * Migrate legacy monolithic strategies.json / Redis / R2 into per-tenant shards.
   */
  async migrateLegacyStrategiesIfPresent() {
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
          console.error("Error reading legacy local strategies.json:", err?.message || err);
        }
      }
    }

    // 2. Check R2 legacy object if not found locally
    if ((!legacyRecords || legacyRecords.length === 0) && (this.cloud ?? isR2Configured())) {
      try {
        const r2Data = await loadJSONFromR2("strategies.json");
        if (Array.isArray(r2Data) && r2Data.length > 0) {
          legacyRecords = r2Data;
        }
      } catch (err) {
        console.error("Error reading legacy R2 strategies.json:", err?.message || err);
      }
    }

    // 3. Check legacy Redis global key if still empty
    if ((!legacyRecords || legacyRecords.length === 0) && this.redis?.isReady) {
      try {
        const rawRedis = await this.redis.get("marketify:store:strategies");
        if (rawRedis) {
          const parsed = JSON.parse(rawRedis);
          if (Array.isArray(parsed) && parsed.length > 0) {
            legacyRecords = parsed;
          }
        }
      } catch (err) {
        console.error("Error reading legacy Redis strategies:", err?.message || err);
      }
    }

    if (!legacyRecords || !Array.isArray(legacyRecords) || legacyRecords.length === 0) {
      return { migratedCount: 0, tenantsCount: 0 };
    }

    console.log(`[FileStrategyRepository] Discovered ${legacyRecords.length} legacy strategies. Migrating to per-tenant shards...`);

    // Group by ownerId (excluding expired grounded records)
    const byOwner = new Map();
    for (const record of legacyRecords) {
      if (!record || !record.ownerId) continue;
      if (isExpiredGroundedStrategyRecord(record)) continue;
      if (!byOwner.has(record.ownerId)) {
        byOwner.set(record.ownerId, []);
      }
      byOwner.get(record.ownerId).push(record);
    }

    await fs.mkdir(this.strategiesDir, { recursive: true });

    let migratedRecordsCount = 0;
    let migrationIncomplete = false;
    const isCloud = this.cloud ?? isR2Configured();
    for (const [ownerId, records] of byOwner.entries()) {
      const tenantKey = this.tenantKey(ownerId);
      const { records: existing, etag, tombstone } = await this.readTenantDataWithEtag(ownerId, tenantKey).catch(() => ({ records: [], etag: null, tombstone: false }));
      if (tombstone) {
        continue;
      }

      const mergeWithSnapshot = (snapshotRecords) => {
        const base = Array.isArray(snapshotRecords) ? [...snapshotRecords] : [];
        pruneExpiredGroundedStrategies(base);
        const existingIds = new Set(base.map((r) => r.id));
        const mergedList = [...base];
        let added = 0;
        for (const rec of records) {
          if (isExpiredGroundedStrategyRecord(rec)) continue;
          if (!existingIds.has(rec.id)) {
            mergedList.push(rec);
            existingIds.add(rec.id);
            added++;
          }
        }
        return { mergedList, added };
      };

      let { mergedList: merged, added: finalAdded } = mergeWithSnapshot(existing);
      let committed = !isCloud;
      let tombstoned = false;

      if (isCloud) {
        let currentEtag = etag;
        let currentMerged = merged;
        for (let attempt = 0; attempt < 5; attempt++) {
          try {
            const success = await this.writeCloud(tenantKey, currentMerged, currentEtag);
            if (success) {
              merged = currentMerged;
              committed = true;
              break;
            }
          } catch (err) {
            console.error(`Failed to migrate shard to R2 for tenant ${tenantKey}:`, err?.message || err);
            break;
          }
          const fresh = await this.readCloud(tenantKey).catch(() => null);
          const freshRecord = fresh?.record;
          if (!fresh || fresh.tombstone || (freshRecord && typeof freshRecord === "object" && !Array.isArray(freshRecord) && freshRecord._tombstone)) {
            tombstoned = Boolean(fresh?.tombstone || freshRecord?._tombstone);
            break;
          }
          currentEtag = fresh.etag || null;
          const nextMerge = mergeWithSnapshot(Array.isArray(freshRecord) ? freshRecord : []);
          currentMerged = nextMerge.mergedList;
          finalAdded = nextMerge.added;
          merged = currentMerged;
        }
      }

      if (tombstoned) {
        this.syncedShardTags.delete(tenantKey);
        await fs.rm(this.tenantFilePath(tenantKey), { force: true }).catch(() => {});
        if (this.redis?.isReady) {
          await this.redis.del(this.tenantRedisKey(ownerId)).catch(() => {});
        }
        continue;
      }

      if (!committed) {
        migrationIncomplete = true;
        console.error(`Legacy strategy migration skipped local commit for tenant ${tenantKey}: R2 OCC did not converge.`);
        continue;
      }

      migratedRecordsCount += finalAdded;
      this.syncedShardTags.delete(tenantKey);
      await this.writeLocalTenant(tenantKey, merged);

      if (this.redis?.isReady) {
        await this.redis.set(this.tenantRedisKey(ownerId), JSON.stringify(merged)).catch(() => {});
      }
    }

    // Rename legacy file to .migrated backup only when every tenant committed cleanly
    if (this.legacyFilePath && !migrationIncomplete) {
      try {
        const backupPath = `${this.legacyFilePath}.migrated`;
        await fs.rename(this.legacyFilePath, backupPath).catch(() => {});
      } catch {}
    }

    console.log(`[FileStrategyRepository] Successfully migrated ${migratedRecordsCount} records across ${byOwner.size} tenants.`);
    return { migratedCount: migratedRecordsCount, tenantsCount: byOwner.size };
  }

  /**
   * Execute an operation inside a per-tenant in-memory serialized queue.
   * Guarantees concurrent operations on the same tenant never interleave.
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
   * Lock across multiple tenant IDs in deterministic order to prevent deadlocks.
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
   * @returns {Promise<{ records: any[], etag: string | null, tombstone?: boolean, deletedAt?: string }>}
   */
  async readCloudSnapshot(tenantKey, { clone = true } = {}) {
    // Coalesce only the remote read, never the following local mirror writes.
    // A later authorization must not join a snapshot already received from R2.
    let pending = this.inFlightTenantReads.get(tenantKey);
    if (!pending) {
      pending = Promise.resolve().then(() => this.readCloud(tenantKey));
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
          // Explicit tombstone detected: clean up local shard cache and Redis to prevent resurrection
          this.syncedShardTags.delete(tenantKey);
          await fs.rm(this.tenantFilePath(tenantKey), { force: true }).catch(() => {});
          if (this.redis?.isReady) {
            await this.redis.del(this.tenantRedisKey(ownerId)).catch(() => {});
          }
          return { records: [], etag, tombstone: true, deletedAt: record?.deletedAt };
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
          return { records: record, etag, tombstone: false };
        }
        if (notFound || record === null) {
          // Authoritative cloud object does NOT exist! Clean up any stale local file
          this.syncedShardTags.delete(tenantKey);
          await fs.rm(this.tenantFilePath(tenantKey), { force: true }).catch(() => {});
          if (this.redis?.isReady) {
            await this.redis.del(this.tenantRedisKey(ownerId)).catch(() => {});
          }
          return { records: [], etag: null, tombstone: false };
        }
        throw storageCorruption("Invalid authoritative tenant shard structure.");
      } catch (err) {
        console.error(`R2 strategy read error (${tenantKey}):`, err?.message || err);
        throw err;
      }
    }

    // Local disk is authoritative; Redis may contain a stale mirror after an outage.
    const targetPath = this.tenantFilePath(tenantKey);
    try {
      const raw = await fs.readFile(targetPath, "utf8");
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && parsed._tombstone) {
        return { records: [], etag: null, tombstone: true, deletedAt: parsed.deletedAt };
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
      return { records, etag: null, tombstone: false };
    } catch (error) {
      if (error.code === "ENOENT") {
        return { records: [], etag: null, tombstone: false };
      }
      if (error instanceof SyntaxError) {
        throw storageCorruption(`Strategy shard ${tenantKey} contains invalid JSON.`, error);
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
    await fs.mkdir(this.strategiesDir, { recursive: true });
    await writeJsonAtomically(this.tenantFilePath(tenantKey), records);
  }

  /**
   * Optimistic Concurrency Control (OCC) mutation wrapper.
   * Wraps read-modify-write inside in-process tenant queue and retries up to 10 times on R2 412 conflicts.
   * @param {string} ownerId
   * @param {(records: any[]) => { records?: any[], result?: any } | any} mutator
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
        const nextRecords = mutatorOutput?.records !== undefined
          ? mutatorOutput.records
          : (Array.isArray(mutatorOutput) ? mutatorOutput : recordsCopy);
        const returnValue = mutatorOutput?.result !== undefined ? mutatorOutput.result : mutatorOutput;

        if (mutatorOutput?.unchanged === true) return returnValue;
        if (Array.isArray(nextRecords)) {
          pruneExpiredGroundedStrategies(nextRecords);
        }

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
        invalidateUserContextCache(ownerId);
        await this.writeLocalTenant(tenantKey, nextRecords);

        if (this.redis?.isReady) {
          try {
            await this.redis.set(this.tenantRedisKey(ownerId), JSON.stringify(nextRecords));
          } catch (err) {
            console.error(`Redis strategy write error (${ownerId}):`, err?.message || err);
          }
        }

        return returnValue;
      }

      const err = new Error("Strategy storage concurrency conflict. Maximum retries exceeded.");
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
    if (!Array.isArray(records)) return [];
    const hasExpiredGrounded = records.some((record) => isExpiredGroundedStrategyRecord(record));
    if (hasExpiredGrounded) {
      await this.pruneGroundedStrategies(ownerId).catch(() => {});
    }
    return records.filter((record) => {
      if (!guestVisible(record, ownerId) || isExpiredGroundedStrategyRecord(record)) {
        return false;
      }
      if (isGroundedStrategyRecord(record)) {
        rememberGroundedStrategyProvenance(ownerId, record, {
          strategyId: record.id,
          clientSaveId: record.clientSaveId,
        });
      }
      return true;
    });
  }

  provenanceFilePath(tenantKey) {
    return path.join(this.strategiesDir, ".provenance", `${tenantKey}.json`);
  }

  async loadOwnerProvenance(ownerId, now = Date.now()) {
    if (!ownerId || typeof ownerId !== "string") return [];
    const tenantKey = this.tenantKey(ownerId);
    const filePath = this.provenanceFilePath(tenantKey);
    try {
      const raw = await fs.readFile(filePath, "utf8");
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      const { retained, removed } = hydrateOwnerProvenanceEntries(ownerId, parsed, now);
      if (removed > 0) {
        if (retained.length === 0) {
          await fs.rm(filePath, { force: true }).catch(() => {});
        } else {
          await writeJsonAtomically(filePath, retained).catch(() => {});
        }
      }
      return retained;
    } catch {
      return [];
    }
  }

  async persistOwnerProvenance(ownerId, now = Date.now()) {
    if (!ownerId || typeof ownerId !== "string") return [];
    const tenantKey = this.tenantKey(ownerId);
    const filePath = this.provenanceFilePath(tenantKey);
    return this.lockManager.runInLock(`prov:${tenantKey}`, async () => {
      let existing = [];
      try {
        const raw = await fs.readFile(filePath, "utf8");
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) existing = parsed;
      } catch {
        // File does not exist yet
      }
      if (existing.length > 0) {
        hydrateOwnerProvenanceEntries(ownerId, existing, now);
      }
      const entries = exportOwnerProvenanceEntries(ownerId, now);
      if (entries.length === 0) {
        await fs.rm(filePath, { force: true }).catch(() => {});
        return [];
      }
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await writeJsonAtomically(filePath, entries);
      return entries;
    });
  }

  async rememberProvenance(ownerId, strategyOrRecord, meta = {}) {
    const entry = rememberGroundedStrategyProvenance(ownerId, strategyOrRecord, {
      ...meta,
      forceGrounded: meta.forceGrounded ?? true,
    });
    if (entry) {
      await this.persistOwnerProvenance(ownerId).catch(() => {});
    }
    return entry;
  }

  async resolveProvenance(ownerId, candidate, existingRecords = null) {
    if (!ownerId || !candidate || typeof candidate !== "object") {
      return { grounded: false, expired: false, orchestration: null, sourceRecord: null };
    }
    await this.loadOwnerProvenance(ownerId);
    const records = Array.isArray(existingRecords)
      ? existingRecords
      : await this.readTenant(ownerId, { clone: false }).catch(() => []);
    return resolveGroundedStrategyProvenance(ownerId, candidate, records);
  }

  async pruneGroundedStrategies(ownerId, now = Date.now()) {
    const removed = await this.mutateTenant(ownerId, (records) => {
      const count = pruneExpiredGroundedStrategies(records, now);
      return { unchanged: count === 0, records, result: count };
    });
    await this.loadOwnerProvenance(ownerId, now).catch(() => {});
    await this.persistOwnerProvenance(ownerId, now).catch(() => {});
    return removed;
  }

  async pruneInactiveGroundedData(now = Date.now()) {
    await this.ensure();
    let totalRemoved = 0;
    try {
      const entries = await fs.readdir(this.strategiesDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith(".json") || entry.name.endsWith(".tmp")) continue;
        const shardPath = path.join(this.strategiesDir, entry.name);
        try {
          const raw = await fs.readFile(shardPath, "utf8");
          const parsed = JSON.parse(raw);
          if (!Array.isArray(parsed)) continue;
          const shardOwnerId = parsed.find((r) => r && typeof r.ownerId === "string")?.ownerId || null;
          const expiredCount = parsed.filter((r) => isExpiredGroundedStrategyRecord(r, now)).length;
          if (expiredCount > 0) {
            if (shardOwnerId) {
              totalRemoved += Number(await this.pruneGroundedStrategies(shardOwnerId, now)) || 0;
            } else {
              const removed = pruneExpiredGroundedStrategies(parsed, now);
              if (removed > 0) {
                await writeJsonAtomically(shardPath, parsed).catch(() => {});
                totalRemoved += removed;
              }
            }
          }
        } catch {
          // Ignore malformed shard
        }
      }
      const provDir = path.join(this.strategiesDir, ".provenance");
      const provEntries = await fs.readdir(provDir, { withFileTypes: true }).catch(() => []);
      for (const entry of provEntries) {
        if (!entry.isFile() || !entry.name.endsWith(".json") || entry.name.endsWith(".tmp")) continue;
        const provPath = path.join(provDir, entry.name);
        try {
          const raw = await fs.readFile(provPath, "utf8");
          const parsed = JSON.parse(raw);
          if (!Array.isArray(parsed)) continue;
          const retained = parsed.filter((item) => {
            const ms = parseValidDateMs(item?.firstGroundedAt || item?.orchestration?.firstGroundedAt || item?.createdAt, now);
            return ms !== null && Number.isFinite(ms) && now - ms < MAX_GROUNDED_CHAT_RETENTION_MS;
          });
          if (retained.length !== parsed.length) {
            totalRemoved += parsed.length - retained.length;
            if (retained.length === 0) await fs.rm(provPath, { force: true }).catch(() => {});
            else await writeJsonAtomically(provPath, retained).catch(() => {});
          }
        } catch {}
      }
      if (this.cloud ?? isR2Configured()) {
        const cloudKeys = await this.listCloudShards().catch(() => []);
        for (const rawKey of cloudKeys) {
          if (typeof rawKey !== "string" || !rawKey.endsWith(".json")) continue;
          const stripped = rawKey.replace(/^data\//, "").replace(/^strategies-v1\//, "").replace(/\.json$/, "");
          if (!stripped) continue;
          try {
            const snap = await this.readCloud(stripped);
            const cloudRecords = snap?.record;
            if (!Array.isArray(cloudRecords)) continue;
            const expiredCount = cloudRecords.filter((r) => isExpiredGroundedStrategyRecord(r, now)).length;
            if (expiredCount === 0) continue;
            const shardOwnerId = cloudRecords.find((r) => r && typeof r.ownerId === "string")?.ownerId || null;
            if (shardOwnerId) {
              totalRemoved += Number(await this.pruneGroundedStrategies(shardOwnerId, now)) || 0;
            } else {
              const removed = pruneExpiredGroundedStrategies(cloudRecords, now);
              if (removed > 0) {
                const ok = await this.writeCloud(stripped, cloudRecords, snap?.etag || null).catch(() => false);
                if (ok) totalRemoved += removed;
              }
            }
          } catch {}
        }
      }
      if (this.redis?.isReady && typeof this.redis.keys === "function") {
        const keys = await this.redis.keys("marketify:store:strategies:*").catch(() => []);
        for (const key of keys) {
          const ownerId = key.slice("marketify:store:strategies:".length);
          if (!ownerId) continue;
          try {
            const raw = await this.redis.get(key);
            const parsed = JSON.parse(raw || "null");
            if (Array.isArray(parsed) && parsed.some((r) => isExpiredGroundedStrategyRecord(r, now))) {
              totalRemoved += Number(await this.pruneGroundedStrategies(ownerId, now)) || 0;
            }
          } catch {}
        }
      }
    } catch (err) {
      console.warn("[FileStrategyRepository] Background grounded cleanup warning:", err?.message || err);
    }
    return totalRemoved;
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
      const entries = await fs.readdir(this.strategiesDir, { withFileTypes: true });
      const aggregated = [];
      for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith(".json") && !entry.name.endsWith(".tmp")) {
          const shardPath = path.join(this.strategiesDir, entry.name);
          try {
            const raw = await fs.readFile(shardPath, "utf8");
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
              const shardOwnerId = parsed.find((r) => r && typeof r.ownerId === "string")?.ownerId || null;
              const removed = pruneExpiredGroundedStrategies(parsed);
              if (removed > 0) {
                if (shardOwnerId) {
                  await this.pruneGroundedStrategies(shardOwnerId).catch(async () => {
                    await writeJsonAtomically(shardPath, parsed).catch(() => {});
                  });
                } else {
                  await writeJsonAtomically(shardPath, parsed).catch(() => {});
                }
              }
              aggregated.push(...parsed);
            }
          } catch {
            // Ignore malformed shard
          }
        }
      }
      return aggregated;
    } catch (err) {
      console.error("Error reading all strategy shards:", err?.message || err);
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
      if (isExpiredGroundedStrategyRecord(record)) continue;
      if (!byOwner.has(record.ownerId)) byOwner.set(record.ownerId, []);
      byOwner.get(record.ownerId).push(record);
    }

    for (const [ownerId, tenantRecords] of byOwner.entries()) {
      await this.mutateTenant(ownerId, () => ({
        records: tenantRecords,
        result: true,
      }));
    }
  }

  /**
   * List all strategies for a given owner, sorted by updatedAt descending.
   * @param {string} ownerId
   * @returns {Promise<any[]>}
   */
  async list(ownerId) {
    if (!ownerId) return [];
    const records = await this.readTenant(ownerId, { clone: false });
    return records
      .filter((record) => record.ownerId === ownerId && !isExpiredGroundedStrategyRecord(record))
      .sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""))
      .map(({ versions, ownerId: _ownerId, clientSaveId: _clientSaveId, ...record }) => ({
        ...structuredClone(record),
        versionCount: (versions || []).length,
      }));
  }

  /**
   * Get single strategy by ID and ownerId.
   * @param {string} id
   * @param {string} ownerId
   * @returns {Promise<any | null>}
   */
  async getById(id, ownerId) {
    if (!id || !ownerId) return null;
    const records = await this.readTenant(ownerId, { clone: false });
    const found = records.find((record) => record.id === id && record.ownerId === ownerId && !isExpiredGroundedStrategyRecord(record)) || null;
    return found ? structuredClone(found) : null;
  }

  /**
   * Idempotently create a new strategy record for an owner.
   * @param {object} payload
   * @param {string} ownerId
   * @returns {Promise<object>}
   */
  async create(payload, ownerId) {
    if (!ownerId) throw new Error("ownerId is required to create a strategy");
    await this.loadOwnerProvenance(ownerId).catch(() => {});

    const created = await this.mutateTenant(ownerId, (records) => {
      pruneExpiredGroundedStrategies(records);
      const nowMs = Date.now();
      const now = new Date(nowMs).toISOString();
      const provenance = resolveGroundedStrategyProvenance(
        ownerId,
        {
          clientSaveId: payload.clientSaveId,
          strategy: payload.strategy,
          orchestration: payload.orchestration,
          searchGrounded: payload.searchGrounded,
          firstGroundedAt: payload.firstGroundedAt,
          createdAt: payload.createdAt,
          versions: payload.versions,
        },
        records,
        nowMs
      );
      if (provenance?.expired) {
        return { records, result: null };
      }

      if (payload.clientSaveId) {
        const dupIndex = records.findIndex(
          (record) => record.ownerId === ownerId && record.clientSaveId === payload.clientSaveId
        );
        if (dupIndex !== -1) {
          if (isExpiredGroundedStrategyRecord(records[dupIndex], nowMs)) {
            records.splice(dupIndex, 1);
          } else {
            return { records, result: records[dupIndex] };
          }
        }
      }
      guestQuota(records, ownerId, 10, 1);

      const isGrounded = Boolean(
        payload.searchGrounded === true ||
        provenance?.grounded ||
        isGroundedStrategyRecord(payload) ||
        isGroundedStrategyRecord(payload.strategy)
      );

      if (isGrounded) {
        const payloadSourceDates = [
          payload.firstGroundedAt,
          payload.createdAt,
          payload.strategy?.orchestration?.firstGroundedAt,
          payload.strategy?.orchestration?.lastGroundedAt,
          payload.orchestration?.firstGroundedAt,
          payload.orchestration?.lastGroundedAt,
        ].filter((d) => d !== undefined && d !== null && String(d).trim() !== "");

        if (!provenance?.grounded && payloadSourceDates.length === 0) {
          // Fail closed: undated grounded payloads without server provenance must not fabricate a fresh TTL from client version dates.
          return { records, result: null };
        }

        const versionDates = (payload.versions || [])
          .flatMap((v) => [
            v?.createdAt,
            v?.data?.orchestration?.firstGroundedAt,
            v?.data?.orchestration?.lastGroundedAt,
          ])
          .filter((d) => d !== undefined && d !== null && String(d).trim() !== "");

        for (const dateVal of [...payloadSourceDates, ...versionDates]) {
          const parsedMs = parseValidDateMs(dateVal, nowMs);
          if (parsedMs === null || !Number.isFinite(parsedMs) || nowMs - parsedMs >= MAX_GROUNDED_CHAT_RETENTION_MS) {
            return { records, result: null };
          }
        }
      }

      const candidateAuthorityDates = isGrounded
        ? [
            provenance?.orchestration?.firstGroundedAt,
            payload.firstGroundedAt,
            payload.strategy?.orchestration?.firstGroundedAt,
            payload.orchestration?.firstGroundedAt,
            payload.createdAt,
            provenance?.orchestration?.lastGroundedAt,
            payload.strategy?.orchestration?.lastGroundedAt,
          ]
            .map((d) => parseValidDateMs(d, nowMs))
            .filter((ms) => ms !== null && Number.isFinite(ms))
        : [];
      const authoritativeCreatedAt =
        isGrounded && candidateAuthorityDates.length > 0
          ? new Date(Math.min(...candidateAuthorityDates)).toISOString()
          : now;

      const effectiveProvenance = isGrounded
        ? {
            grounded: true,
            orchestration: {
              ...(provenance?.orchestration || {}),
              firstGroundedAt: authoritativeCreatedAt,
            },
          }
        : provenance;

      const effectiveStrategy = isGrounded
        ? applyGroundedProvenanceToStrategy(
            structuredClone(payload.strategy),
            effectiveProvenance || { grounded: true, orchestration: { firstGroundedAt: authoritativeCreatedAt } }
          )
        : payload.strategy;

      const versions = (payload.versions || []).map((version) => {
        const versionCreatedAt =
          isGrounded && version.createdAt
            ? (Date.parse(version.createdAt) < Date.parse(authoritativeCreatedAt) ? version.createdAt : authoritativeCreatedAt)
            : (version.createdAt || authoritativeCreatedAt);
        return {
          ...version,
          id: version.id || randomUUID(),
          createdAt: versionCreatedAt,
          ...(isGrounded ? { searchGrounded: true } : {}),
          data:
            isGrounded && version.data
              ? applyGroundedProvenanceToStrategy(
                  structuredClone(version.data),
                  effectiveProvenance || { grounded: true, orchestration: { firstGroundedAt: authoritativeCreatedAt } }
                )
              : version.data,
        };
      });

      const record = {
        id: randomUUID(),
        ownerId,
        clientSaveId: payload.clientSaveId,
        payloadFingerprint: payload.payloadFingerprint || null,
        title: effectiveStrategy?.title || "Untitled Strategy",
        brief: payload.brief,
        clarification: { answers: payload.answers },
        strategy: effectiveStrategy,
        ...(isGrounded ? { searchGrounded: true, firstGroundedAt: authoritativeCreatedAt } : {}),
        status: "saved",
        currentVersionId: versions.at(-1)?.id || randomUUID(),
        learningInteractionId: payload.learningInteractionId || null,
        versions,
        createdAt: authoritativeCreatedAt,
        updatedAt: now,
      };

      if (isGrounded) {
        rememberGroundedStrategyProvenance(ownerId, record, {
          strategyId: record.id,
          clientSaveId: record.clientSaveId,
          orchestration: effectiveProvenance?.orchestration,
        });
      }

      records.push(record);
      return { records, result: record };
    });

    if (created && isGroundedStrategyRecord(created)) {
      await this.persistOwnerProvenance(ownerId).catch(() => {});
    }
    return created;
  }

  /**
   * Append a new version to an existing strategy.
   * @param {string} id
   * @param {string} ownerId
   * @param {object} strategy
   * @param {string} changeRequest
   * @param {object} [options]
   * @returns {Promise<object | null>}
   */
  async appendVersion(id, ownerId, strategy, changeRequest, options = {}) {
    if (!id || !ownerId) return null;

    const updatedRecord = await this.mutateTenant(ownerId, (records) => {
      const index = records.findIndex((record) => record.id === id && record.ownerId === ownerId);
      if (index === -1) return { records, result: null };

      const record = records[index];
      if (isExpiredGroundedStrategyRecord(record)) {
        records.splice(index, 1);
        return { records, result: null };
      }
      const completed = options.clientSaveId && (record.versions || []).find(version => version.clientSaveId === options.clientSaveId);
      if (completed) {
        if (completed.payloadFingerprint && completed.payloadFingerprint !== options.payloadFingerprint) {
          const error = new Error("Idempotency key was reused with different refinement parameters.");
          error.code = "IDEMPOTENCY_CONFLICT";
          error.status = 409;
          throw error;
        }
        return { records, result: record };
      }

      const provenance = resolveGroundedStrategyProvenance(ownerId, {
        strategyId: id,
        clientSaveId: options.clientSaveId || record.clientSaveId,
        strategy,
        existingRecord: record,
      });
      const isGrounded = Boolean(
        options.searchGrounded === true ||
        provenance?.grounded ||
        isGroundedStrategyRecord(record) ||
        isGroundedStrategyRecord(strategy)
      );
      const nowIso = new Date().toISOString();
      const effectiveStrategy = isGrounded
        ? applyGroundedProvenanceToStrategy(strategy, provenance || {
            grounded: true,
            searchEntryPoint: record.strategy?.orchestration?.searchEntryPoint || null,
            sources: record.strategy?.orchestration?.sources || [],
            evidence: record.strategy?.orchestration?.evidence || [],
            searchQueries: record.strategy?.orchestration?.searchQueries || [],
            createdAt: record.createdAt || nowIso,
          })
        : strategy;

      const version = {
        id: randomUUID(),
        versionNumber: (record.versions || []).length + 1,
        data: effectiveStrategy,
        ...(isGrounded ? { searchGrounded: true } : {}),
        changeRequest,
        clientSaveId: options.clientSaveId || null,
        payloadFingerprint: options.payloadFingerprint || null,
        createdAt: nowIso,
      };

      records[index] = {
        ...record,
        title: effectiveStrategy?.title || record.title,
        strategy: effectiveStrategy,
        ...(isGrounded ? { searchGrounded: true } : {}),
        status: "saved",
        currentVersionId: version.id,
        versions: [...(record.versions || []), version],
        updatedAt: version.createdAt,
      };

      if (isGrounded) {
        rememberGroundedStrategyProvenance(ownerId, records[index], {
          strategyId: id,
          clientSaveId: options.clientSaveId || record.clientSaveId,
        });
      }

      return { records, result: records[index] };
    });

    if (updatedRecord && isGroundedStrategyRecord(updatedRecord)) {
      await this.persistOwnerProvenance(ownerId).catch(() => {});
    }
    return updatedRecord;
  }

  /**
   * Update strategy title.
   * @param {string} id
   * @param {string} ownerId
   * @param {string} title
   * @returns {Promise<object | null>}
   */
  async updateTitle(id, ownerId, title) {
    if (!id || !ownerId || !title?.trim()) return null;
    const trimmedTitle = title.trim();

    const updatedRecord = await this.mutateTenant(ownerId, (records) => {
      const index = records.findIndex((record) => record.id === id && record.ownerId === ownerId);
      if (index === -1) return { records, result: null };

      const record = records[index];
      if (isExpiredGroundedStrategyRecord(record)) {
        records.splice(index, 1);
        return { records, result: null };
      }

      const now = new Date().toISOString();
      const updatedStrategy = record.strategy ? { ...record.strategy, title: trimmedTitle } : { title: trimmedTitle };
      const updatedVersions = (record.versions || []).map((v, i, arr) => {
        if (i === arr.length - 1 && v.data) {
          return { ...v, data: { ...v.data, title: trimmedTitle } };
        }
        return v;
      });

      records[index] = {
        ...record,
        title: trimmedTitle,
        strategy: updatedStrategy,
        versions: updatedVersions,
        updatedAt: now,
      };

      if (isGroundedStrategyRecord(records[index])) {
        rememberGroundedStrategyProvenance(ownerId, records[index], {
          strategyId: id,
          clientSaveId: records[index].clientSaveId,
        });
      }

      return { records, result: records[index] };
    });

    if (updatedRecord && isGroundedStrategyRecord(updatedRecord)) {
      await this.persistOwnerProvenance(ownerId).catch(() => {});
    }
    return updatedRecord;
  }

  /**
   * Duplicate an existing strategy.
   * @param {string} id
   * @param {string} ownerId
   * @returns {Promise<object | null>}
   */
  async duplicate(id, ownerId) {
    if (!id || !ownerId) return null;

    const duplicatedRecord = await this.mutateTenant(ownerId, (records) => {
      const origIndex = records.findIndex((record) => record.id === id && record.ownerId === ownerId);
      if (origIndex === -1) return { records, result: null };
      const original = records[origIndex];

      if (isExpiredGroundedStrategyRecord(original)) {
        records.splice(origIndex, 1);
        return { records, result: null };
      }
      if (original.deleted || !guestVisible(original, ownerId)) return { records, result: null };
      guestQuota(records, ownerId, 10, 1);
      const now = new Date().toISOString();
      const isGrounded = isGroundedStrategyRecord(original);
      const preservedCreatedAt = isGrounded
        ? (original.firstGroundedAt || original.strategy?.orchestration?.firstGroundedAt || original.createdAt || now)
        : now;
      const newId = randomUUID();
      const newTitle = `${original.title} (Kopiya)`;
      const newStrategy = original.strategy ? JSON.parse(JSON.stringify(original.strategy)) : { title: newTitle };
      newStrategy.title = newTitle;

      const versions = (original.versions || []).map((v) => ({
        ...v,
        id: randomUUID(),
        data: v.data ? JSON.parse(JSON.stringify(v.data)) : newStrategy,
      }));

      if (!versions.length) {
        versions.push({
          id: randomUUID(),
          versionNumber: 1,
          data: newStrategy,
          changeRequest: "Dublikat strategiya",
          createdAt: preservedCreatedAt,
        });
      } else {
        versions[versions.length - 1].data.title = newTitle;
      }

      const duplicateRecord = {
        ...original,
        id: newId,
        clientSaveId: randomUUID(),
        title: newTitle,
        strategy: newStrategy,
        ...(isGrounded ? { searchGrounded: true, firstGroundedAt: preservedCreatedAt } : {}),
        versions,
        currentVersionId: versions.at(-1)?.id || randomUUID(),
        createdAt: preservedCreatedAt,
        updatedAt: now,
      };

      if (isGrounded) {
        rememberGroundedStrategyProvenance(ownerId, duplicateRecord, {
          strategyId: newId,
          clientSaveId: duplicateRecord.clientSaveId,
        });
      }

      records.unshift(duplicateRecord);
      return { records, result: duplicateRecord };
    });

    if (duplicatedRecord && isGroundedStrategyRecord(duplicatedRecord)) {
      await this.persistOwnerProvenance(ownerId).catch(() => {});
    }
    return duplicatedRecord;
  }

  /**
   * Delete a single strategy by ID.
   * @param {string} id
   * @param {string} ownerId
   * @returns {Promise<boolean>}
   */
  async delete(id, ownerId) {
    if (!id || !ownerId) return false;

    return this.mutateTenant(ownerId, (records) => {
      const remaining = records.filter((record) => !(record.id === id && record.ownerId === ownerId));
      if (remaining.length === records.length) return { records, result: false };
      return { records: remaining, result: true };
    });
  }

  /**
   * Delete all strategies belonging to an owner.
   * @param {string} ownerId
   * @returns {Promise<number>}
   */
  async deleteAllByOwner(ownerId) {
    if (!ownerId) return 0;
    await this.ensure();

    return this.runInTenantLock(ownerId, async (tenantKey) => {
      const { records, etag } = await this.readTenantDataWithEtag(ownerId, tenantKey);
      const count = Array.isArray(records) ? records.length : 0;
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
            console.error(`Failed to write tombstone to R2 for tenant ${tenantKey}:`, err?.message || err);
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

      // 2. Write tombstone to local file using unique temp file + atomic rename
      const targetPath = this.tenantFilePath(tenantKey);
      const tempPath = `${targetPath}.${randomUUID()}.tmp`;
      await fs.mkdir(path.dirname(targetPath), { recursive: true });
      await fs.writeFile(tempPath, `${JSON.stringify(tombstoneRecord, null, 2)}\n`, "utf8");
      await fs.rename(tempPath, targetPath);

      // 3. Remove from Redis ONLY AFTER authoritative commit
      if (this.redis?.isReady) {
        await this.redis.del(this.tenantRedisKey(ownerId)).catch(() => {});
      }

      return count;
    });
  }

  /**
   * Atomically migrate all strategies from previousOwnerId (guest) to ownerId (user).
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
      const guestRecords = Array.isArray(guestData.records)
        ? guestData.records.filter(
            (record) =>
              !record.deleted &&
              guestVisible(record, previousOwnerId) &&
              !isExpiredGroundedStrategyRecord(record)
          )
        : [];
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
        pruneExpiredGroundedStrategies(userRecords);
        const userExistingIds = new Set(userRecords.map((r) => r.id));

        const now = new Date().toISOString();
        claimedCount = 0;
        for (const record of guestRecords) {
          if (isExpiredGroundedStrategyRecord(record)) continue;
          if (!userExistingIds.has(record.id)) {
            userRecords.push({
              ...record,
              ownerId,
              updatedAt: now,
            });
            userExistingIds.add(record.id);
            claimedCount++;
          }
        }

        if (isCloud) {
          try {
            const success = await this.writeCloud(userKey, userRecords, destData.etag);
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

        // Commit updated user shard locally and to Redis AFTER authoritative cloud write
        this.syncedShardTags.delete(userKey);
        await this.writeLocalTenant(userKey, userRecords);

        if (this.redis?.isReady) {
          await this.redis.set(this.tenantRedisKey(ownerId), JSON.stringify(userRecords)).catch(() => {});
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
      const unmigratedGuestRecords = freshGuestRecords.filter((r) => !migratedIds.has(r.id));

      if (unmigratedGuestRecords.length > 0) {
        // Parallel write added new records to guest shard: preserve unmigrated records!
        await this.writeLocalTenant(guestKey, unmigratedGuestRecords);
        if (isCloud) {
          await this.writeCloud(guestKey, unmigratedGuestRecords, freshGuestData.etag).catch(() => {});
        }
        if (this.redis?.isReady) {
          await this.redis.set(this.tenantRedisKey(previousOwnerId), JSON.stringify(unmigratedGuestRecords)).catch(() => {});
        }
      } else {
        // Safely remove guest shard
        await fs.rm(this.tenantFilePath(guestKey), { force: true }).catch(() => {});
        if (this.redis?.isReady) {
          await this.redis.del(this.tenantRedisKey(previousOwnerId)).catch(() => {});
        }
        if (isCloud) {
          await this.deleteCloud(guestKey).catch(() => {});
        }
      }

      return claimedCount;
    });
  }
}
