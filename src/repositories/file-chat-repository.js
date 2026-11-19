import { guestVisible, guestQuota } from "../services/security/guest-retention.js";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import {
  isR2Configured,
  loadJSONFromR2,
  readChatObject,
  writeChatObject,
  deleteChatObject,
  listTenantObjects,
  readTenantObject,
  writeTenantObject,
} from "../http/r2-storage.js";
import { TenantLockManager } from "./tenant-lock.js";
import { storageCorruption, writeJsonAtomically } from "./atomic-json-store.js";
import { invalidateUserContextCache, syncCachedTenantChats } from "../services/ai/personal-context.js";

import { isWithinGroundedRetention, isGroundedAssistantMessage, pruneExpiredGroundedResults } from "../services/ai/grounded-chat-retention.js";

export class FileChatRepository {
  /**
   * @param {string} filePath - Path to chats.json or chats directory
   * @param {any} redis - Optional Redis client
   * @param {object} options - Optional overrides for cloud functions
   */
  constructor(filePath, redis = null, options = {}) {
    this.filePath = filePath;
    this.redis = redis;
    this.cloud = options.cloud ?? isR2Configured();
    this.hasCustomCloudReads = Boolean(options.readCloud);
    this.hasCustomCloudWrites = Boolean(options.writeCloud);
    this.readCloud = options.readCloud || readChatObject;
    this.writeCloud = options.writeCloud || writeChatObject;
    this.deleteCloud = options.deleteCloud || deleteChatObject;
    this.listCloudShards = options.listCloudShards || (() => listTenantObjects("chats-v1/"));
    this.readChatOwnerIndex = options.readChatOwnerIndex || (!this.hasCustomCloudReads
      ? (chatId) => readTenantObject(`chat-owners-v1/${chatId}.json`, { force: true })
      : null);
    this.writeChatOwnerIndex = options.writeChatOwnerIndex || (!this.hasCustomCloudWrites
      ? (chatId, record, etag = null) => writeTenantObject(`chat-owners-v1/${chatId}.json`, record, etag)
      : null);
    this.artifactRepository = null;

    // Resolve directories and legacy file paths
    if (filePath && path.extname(filePath) === ".json") {
      this.legacyFilePath = filePath;
      this.chatsDir = path.join(path.dirname(filePath), "chats");
    } else {
      this.legacyFilePath = filePath ? path.join(filePath, "chats.json") : null;
      this.chatsDir = filePath
        ? (path.basename(filePath) === "chats" ? filePath : path.join(filePath, "chats"))
        : path.join(process.cwd(), "data", "chats");
    }
    this.baseDir = this.chatsDir;
    this.chatOwnersDir = path.join(this.chatsDir, ".chat-owners");

    const baseLockDir = this.chatsDir
      ? path.dirname(this.chatsDir)
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
      throw new Error("Invalid ownerId for chat repository");
    }
    return createHash("sha256").update(ownerId.trim()).digest("hex");
  }

  /**
   * Local filesystem path for tenant shard.
   * @param {string} tenantKey
   * @returns {string}
   */
  tenantFilePath(tenantKey) {
    return path.join(this.chatsDir, `${tenantKey}.json`);
  }

  /**
   * Redis key for tenant chats.
   * @param {string} ownerId
   * @returns {string}
   */
  tenantRedisKey(ownerId) {
    return `marketify:store:chats:${ownerId}`;
  }

  /**
   * Ensure storage directory exists and startup migration has executed.
   */
  async ensure() {
    await fs.mkdir(this.chatsDir, { recursive: true });
    await this.ensureMigrated();
  }

  /**
   * Idempotent migration trigger.
   */
  async ensureMigrated() {
    if (!this._migrationPromise) {
      this._migrationPromise = this.migrateLegacyChatsIfPresent();
    }
    return this._migrationPromise;
  }

  /**
   * Migrate legacy monolithic chats.json / Redis / R2 into per-tenant shards.
   */
  async migrateLegacyChatsIfPresent() {
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
          console.error("Error reading legacy local chats.json:", err?.message || err);
        }
      }
    }

    // 2. Check R2 legacy object if not found locally
    if ((!legacyRecords || legacyRecords.length === 0) && (this.cloud ?? isR2Configured())) {
      try {
        const r2Data = await loadJSONFromR2("chats.json");
        if (Array.isArray(r2Data) && r2Data.length > 0) {
          legacyRecords = r2Data;
        }
      } catch (err) {
        console.error("Error reading legacy R2 chats.json:", err?.message || err);
      }
    }

    // 3. Check legacy Redis global key if still empty
    if ((!legacyRecords || legacyRecords.length === 0) && this.redis?.isReady) {
      try {
        const rawRedis = await this.redis.get("marketify:store:chats");
        if (rawRedis) {
          const parsed = JSON.parse(rawRedis);
          if (Array.isArray(parsed) && parsed.length > 0) {
            legacyRecords = parsed;
          }
        }
      } catch (err) {
        console.error("Error reading legacy Redis chats:", err?.message || err);
      }
    }

    if (!legacyRecords || !Array.isArray(legacyRecords) || legacyRecords.length === 0) {
      return { migratedCount: 0, tenantsCount: 0 };
    }

    console.log(`[FileChatRepository] Discovered ${legacyRecords.length} legacy chats. Migrating to per-tenant shards...`);

    // Group by ownerId
    const byOwner = new Map();
    for (const record of legacyRecords) {
      if (!record || !record.ownerId) continue;
      if (!byOwner.has(record.ownerId)) {
        byOwner.set(record.ownerId, []);
      }
      byOwner.get(record.ownerId).push(record);
    }

    await fs.mkdir(this.chatsDir, { recursive: true });

    let migratedRecordsCount = 0;
    let migrationIncomplete = false;
    const isCloud = this.cloud ?? isR2Configured();
    for (const [ownerId, records] of byOwner.entries()) {
      const tenantKey = this.tenantKey(ownerId);
      const { records: existing, etag, tombstone } = await this.readTenantDataWithEtag(ownerId, tenantKey, { coalesce: false }).catch(() => ({ records: [], etag: null, tombstone: false }));
      if (tombstone) {
        continue;
      }
      const mergeWithSnapshot = (snapshotRecords) => {
        const base = Array.isArray(snapshotRecords)
          ? snapshotRecords.map((chat) => {
              const copy = structuredClone(chat);
              pruneExpiredGroundedResults(copy);
              return copy;
            })
          : [];
        const existingIds = new Set(base.map((r) => r.id));
        const mergedList = [...base];
        let added = 0;
        for (const rec of records) {
          const copy = structuredClone(rec);
          pruneExpiredGroundedResults(copy);
          if (!existingIds.has(copy.id)) {
            mergedList.push(copy);
            existingIds.add(copy.id);
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
            this.inFlightTenantReads.delete(tenantKey);
            const success = await this.writeCloud(tenantKey, currentMerged, currentEtag);
            this.inFlightTenantReads.delete(tenantKey);
            if (success) {
              merged = currentMerged;
              committed = true;
              break;
            }
          } catch (err) {
            this.inFlightTenantReads.delete(tenantKey);
            console.error(`Failed to migrate shard to R2 for tenant ${tenantKey}:`, err?.message || err);
            break;
          }
          const fresh = await this.readCloud(tenantKey, { force: true }).catch(() => null);
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
        console.error(`Legacy chat migration skipped local commit for tenant ${tenantKey}: R2 OCC did not converge.`);
        continue;
      }

      migratedRecordsCount += finalAdded;
      this.syncedShardTags.delete(tenantKey);
      await this.writeLocalTenant(tenantKey, merged);

      if (this.redis?.isReady) {
        await this.redis.set(this.tenantRedisKey(ownerId), JSON.stringify(merged)).catch(() => {});
      }
      const pendingIndex = [];
      for (const migratedRecord of merged) {
        if (!migratedRecord?.id || !/^[0-9a-f-]{36}$/i.test(migratedRecord.id)) continue;
        if (finalAdded === 0) {
          try {
            const localIdx = JSON.parse(await fs.readFile(this.chatOwnerFilePath(migratedRecord.id), "utf8"));
            if (localIdx?.ownerHash === tenantKey) continue;
          } catch {}
        }
        pendingIndex.push(migratedRecord.id);
      }
      const INDEX_BATCH_SIZE = 20;
      for (let i = 0; i < pendingIndex.length; i += INDEX_BATCH_SIZE) {
        await Promise.all(
          pendingIndex.slice(i, i + INDEX_BATCH_SIZE).map((chatId) =>
            this.reserveChatOwnerIndex(chatId, ownerId, { overwrite: true }).catch(() => {}),
          ),
        );
      }
    }

    // Rename legacy file to .migrated backup only when every tenant committed cleanly
    if (this.legacyFilePath && !migrationIncomplete) {
      try {
        const backupPath = `${this.legacyFilePath}.migrated`;
        await fs.rename(this.legacyFilePath, backupPath).catch(() => {});
      } catch {}
    }

    console.log(`[FileChatRepository] Successfully migrated ${migratedRecordsCount} chats across ${byOwner.size} tenants.`);
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
   * @returns {Promise<{ records: any[], etag: string | null, tombstone?: boolean, deletedAt?: string }>}
   */
  async readCloudSnapshot(tenantKey, { clone = true, coalesce = true } = {}) {
    // Coalesce only the remote read, never the following local mirror writes.
    // A later authorization must not join a snapshot already received from R2.
    if (!coalesce) {
      const res = await this.readCloud(tenantKey, { force: true, clone: false });
      return clone ? structuredClone(res) : res;
    }
    let pending = this.inFlightTenantReads.get(tenantKey);
    if (!pending) {
      pending = Promise.resolve().then(() => this.readCloud(tenantKey, { force: true, clone: false }));
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
          return { records: [], etag, tombstone: true, deletedAt: record?.deletedAt };
        }
        if (record && Array.isArray(record)) {
          if (options.syncMirrors !== false) {
            const tagKey = etag
              ? `${etag}:${record.length}:${record[0]?.id || ""}:${record[0]?.updatedAt || ""}:${record.at(-1)?.id || ""}:${record.at(-1)?.updatedAt || ""}`
              : createHash("sha256").update(JSON.stringify(record)).digest("hex");
            if (this.syncedShardTags.get(tenantKey) !== tagKey) {
              const cached = record.map(chat => {
                const view = { ...chat };
                pruneExpiredGroundedResults(view);
                return view;
              });
              await this.writeLocalTenant(tenantKey, cached).catch(() => {});
              if (this.redis?.isReady) {
                await this.redis.set(this.tenantRedisKey(ownerId), JSON.stringify(cached)).catch(() => {});
              }
              this.syncedShardTags.set(tenantKey, tagKey);
            }
          }
          return { records: record, etag, tombstone: false };
        }
        if (notFound || record === null) {
          this.syncedShardTags.delete(tenantKey);
          await fs.rm(this.tenantFilePath(tenantKey), { force: true }).catch(() => {});
          if (this.redis?.isReady) {
            await this.redis.del(this.tenantRedisKey(ownerId)).catch(() => {});
          }
          return { records: [], etag: null, tombstone: false };
        }
        throw storageCorruption("Invalid authoritative tenant shard structure.");
      } catch (err) {
        console.error(`R2 chat read error (${tenantKey}):`, err?.message || err);
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
      if (records.length > 0 && this.redis?.isReady && options.syncMirrors !== false) {
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
        throw storageCorruption(`Chat shard ${tenantKey} contains invalid JSON.`, error);
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
    await fs.mkdir(this.chatsDir, { recursive: true });
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
  async mutateTenant(ownerId, mutator, { retentionTime = Date.now(), syncContextCache = false, onCommitted = null } = {}) {
    await this.ensureMigrated();

    return this.runInTenantLock(ownerId, async (tenantKey) => {
      const isCloud = this.cloud ?? isR2Configured();
      const maxAttempts = isCloud ? 10 : 1;
      const mutationStartedAt = Date.now();

      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const { records, etag, tombstone, deletedAt } = await this.readTenantDataWithEtag(ownerId, tenantKey, { coalesce: false, syncMirrors: false });

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

        if (mutatorOutput?.unchanged === true) return returnValue;
        if (this.cleanupQueue) {
          for (const chat of records) {
            if (chat.ownerId !== ownerId) continue;
            for (const message of chat.messages || []) {
              if (!isGroundedAssistantMessage(message) ||
                  isWithinGroundedRetention(message.groundedAt ?? (message.createdAt || chat.createdAt), retentionTime)) {
                continue;
              }
              const artifacts = (message.artifacts || []).filter((a) => a?.id).map(({ id }) => ({ id }));
              if (message.type === "research" && message.jobId) {
                const jobId = message.jobId;
                await this.cleanupQueue.enqueue(ownerId, `research-expiry:${jobId}`, "expired-research", { chatId: chat.id, jobId, artifacts });
              } else if (artifacts.length > 0) {
                const msgKey = message.id || artifacts[0].id;
                await this.cleanupQueue.enqueue(ownerId, `grounded-artifacts-expiry:${chat.id}:${msgKey}`, "expired-research", { chatId: chat.id, jobId: null, artifacts });
              }
            }
          }
        }
        for (const chat of nextRecords) {
          if (chat.ownerId === ownerId && pruneExpiredGroundedResults(chat, retentionTime)) chat.revision = (chat.revision || 1) + 1;
        }

        // Perform R2 conditional PUT with OCC ETag
        if (isCloud) {
          this.inFlightTenantReads.delete(tenantKey);
          const success = await this.writeCloud(tenantKey, nextRecords, etag);
          this.inFlightTenantReads.delete(tenantKey);
          if (!success) {
            // Precondition failed (412/409): wait with exponential jitter and retry
            await new Promise((resolve) => setTimeout(resolve, Math.floor(Math.random() * 40) + attempt * 25));
            continue;
          }
        }

        // Commit to local filesystem, Redis mirror, and optional post-commit hook
        this.inFlightTenantReads.delete(tenantKey);
        this.syncedShardTags.delete(tenantKey);
        if (syncContextCache) syncCachedTenantChats(ownerId, nextRecords);
        else invalidateUserContextCache(ownerId);
        const syncRedisMirror = async () => {
          if (this.redis?.isReady) {
            try {
              await this.redis.set(this.tenantRedisKey(ownerId), JSON.stringify(nextRecords));
            } catch (err) {
              console.error(`Redis chat write error (${ownerId}):`, err?.message || err);
            }
          }
        };
        if (!isCloud) {
          await this.writeLocalTenant(tenantKey, nextRecords);
        }
        const postCommitTasks = [
          ...(isCloud ? [this.writeLocalTenant(tenantKey, nextRecords)] : []),
          syncRedisMirror(),
          ...(typeof onCommitted === "function" ? [Promise.resolve().then(() => onCommitted(returnValue))] : []),
        ];
        const settled = await Promise.allSettled(postCommitTasks);
        const rejected = settled.find((item) => item.status === "rejected");
        if (rejected) throw rejected.reason;

        return returnValue;
      }

      const err = new Error("Chat storage concurrency conflict. Maximum retries exceeded.");
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
    let needsPhysicalPrune = false;
    const result = records.filter(record => !record.deleted && guestVisible(record, ownerId)).map(record => {
      const view = { ...record };
      if (pruneExpiredGroundedResults(view) > 0) {
        needsPhysicalPrune = true;
      }
      if (view.messages?.some(message => message.type === "research" && message.verifiedResearchSources !== true)) {
        view.messages = view.messages.map(message => message.type === "research" && message.verifiedResearchSources !== true
          ? { ...message, sources: [], groundingMetadata: null }
          : message);
      }
      return view;
    });
    if (needsPhysicalPrune) {
      await this.pruneGroundedHistory(ownerId).catch(() => {});
    }
    return result;
  }

  async pruneGroundedHistory(ownerId, now = Date.now()) {
    return this.mutateTenant(ownerId, records => {
      let removed = 0;
      for (const chat of records) {
        if (chat.ownerId !== ownerId) continue;
        const count = pruneExpiredGroundedResults(chat, now);
        if (count) {
          removed += count;
          chat.revision = (chat.revision || 1) + 1;
        }
      }
      return { unchanged: removed === 0, updated: records, result: removed };
    }, { retentionTime: now });
  }

  async pruneInactiveGroundedData(now = Date.now()) {
    await this.ensure();
    let totalRemoved = 0;
    try {
      const entries = await fs.readdir(this.chatsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith(".json") || entry.name.endsWith(".tmp")) continue;
        const shardPath = path.join(this.chatsDir, entry.name);
        try {
          const raw = await fs.readFile(shardPath, "utf8");
          const parsed = JSON.parse(raw);
          if (!Array.isArray(parsed)) continue;
          const shardOwnerId = parsed.find((c) => c && typeof c.ownerId === "string")?.ownerId || null;
          let expiredCount = 0;
          for (const chat of parsed) {
            expiredCount += pruneExpiredGroundedResults(chat, now);
          }
          if (expiredCount > 0) {
            if (shardOwnerId) {
              totalRemoved += Number(await this.pruneGroundedHistory(shardOwnerId, now)) || 0;
            } else {
              for (const chat of parsed) chat.revision = (chat.revision || 1) + 1;
              await writeJsonAtomically(shardPath, parsed).catch(() => {});
              totalRemoved += expiredCount;
            }
          }
        } catch {}
      }
      if (this.cloud ?? isR2Configured()) {
        const cloudKeys = await this.listCloudShards().catch(() => []);
        for (const rawKey of cloudKeys) {
          if (typeof rawKey !== "string" || !rawKey.endsWith(".json")) continue;
          const stripped = rawKey.replace(/^data\//, "").replace(/^chats-v1\//, "").replace(/\.json$/, "");
          if (!stripped) continue;
          try {
            const snap = await this.readCloud(stripped, { force: true });
            const cloudRecords = snap?.record;
            if (!Array.isArray(cloudRecords)) continue;
            let expiredCount = 0;
            for (const chat of cloudRecords) {
              expiredCount += pruneExpiredGroundedResults(chat, now);
            }
            if (expiredCount === 0) continue;
            const shardOwnerId = cloudRecords.find((c) => c && typeof c.ownerId === "string")?.ownerId || null;
            if (shardOwnerId) {
              totalRemoved += Number(await this.pruneGroundedHistory(shardOwnerId, now)) || 0;
            } else {
              const ok = await this.writeCloud(stripped, cloudRecords, snap?.etag || null).catch(() => false);
              if (ok) totalRemoved += expiredCount;
            }
          } catch {}
        }
      }
      if (this.redis?.isReady && typeof this.redis.keys === "function") {
        const keys = await this.redis.keys("marketify:store:chats:*").catch(() => []);
        for (const key of keys) {
          const ownerId = key.slice("marketify:store:chats:".length);
          if (!ownerId) continue;
          try {
            const raw = await this.redis.get(key);
            const parsed = JSON.parse(raw || "null");
            if (!Array.isArray(parsed)) continue;
            let expiredCount = 0;
            for (const chat of parsed) {
              expiredCount += pruneExpiredGroundedResults(structuredClone(chat), now);
            }
            if (expiredCount > 0) {
              totalRemoved += Number(await this.pruneGroundedHistory(ownerId, now)) || 0;
            }
          } catch {}
        }
      }
    } catch (err) {
      console.warn("[FileChatRepository] Background grounded cleanup warning:", err?.message || err);
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
      const entries = await fs.readdir(this.chatsDir, { withFileTypes: true });
      const aggregated = [];
      for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith(".json") && !entry.name.endsWith(".tmp")) {
          const shardPath = path.join(this.chatsDir, entry.name);
          try {
            const raw = await fs.readFile(shardPath, "utf8");
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
              const shardOwnerId = parsed.find((c) => c && typeof c.ownerId === "string")?.ownerId || null;
              let removedCount = 0;
              for (const chat of parsed) {
                const count = pruneExpiredGroundedResults(chat);
                if (count > 0) {
                  removedCount += count;
                  chat.revision = (chat.revision || 1) + 1;
                }
              }
              if (removedCount > 0) {
                if (shardOwnerId) {
                  await this.pruneGroundedHistory(shardOwnerId).catch(async () => {
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
      console.error("Error reading all chat shards:", err?.message || err);
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
      for (const rec of tenantRecords) {
        await this.reserveChatOwnerIndex(rec.id, ownerId, { overwrite: true }).catch(() => {});
      }
    }
  }

  /**
   * List all chats for a given owner, sorted by updatedAt descending.
   * @param {string} ownerId
   * @returns {Promise<any[]>}
   */
  async list(ownerId) {
    if (!ownerId) return [];
    const records = await this.readTenant(ownerId, { clone: false });
    return records
      .filter((record) => record.ownerId === ownerId)
      .sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""))
      .map(({ messages, ...record }) => {
        const msgs = Array.isArray(messages) ? messages : [];
        const isResearch = msgs.some((m) => m && (m.type === "research" || m.jobId));
        const isResearchOnly = isResearch && !msgs.some((m) => m && m.role === "assistant" && m.type !== "research" && !m.jobId);
        const latestResearch = isResearch ? msgs.slice().reverse().find((m) => m && (m.type === "research" || m.jobId)) : null;
        return {
          ...structuredClone(record),
          messageCount: msgs.length,
          lastMessage: msgs.at(-1)?.content?.slice(0, 100) || "",
          isResearch,
          isResearchOnly,
          researchStatus: latestResearch?.status || null,
        };
      });
  }

  /**
   * Get single chat by ID and ownerId.
   * @param {string} id
   * @param {string} ownerId
   * @returns {Promise<any | null>}
   */
  async getById(id, ownerId, options = {}) {
    if (!id || !ownerId) return null;
    const records = await this.readTenant(ownerId, { clone: false, ...options });
    const found = records.find((record) => record.id === id && record.ownerId === ownerId) || null;
    return found ? structuredClone(found) : null;
  }

  chatOwnerRedisKey(chatId) {
    return `marketify:chat-owner:${chatId}`;
  }

  chatOwnerFilePath(chatId) {
    if (!/^[0-9a-f-]{36}$/i.test(String(chatId || ""))) {
      throw new Error("Invalid chat ID for owner index");
    }
    return path.join(this.chatOwnersDir, `${String(chatId).toLowerCase()}.json`);
  }

  /**
   * Atomically reserve an O(1) chat ownership index entry so cross-tenant
   * collision checks never scan unrelated tenant shards.
   * @param {string} chatId
   * @param {string} ownerId
   * @param {{ overwrite?: boolean }} [options]
   * @returns {Promise<boolean>}
   */
  async reserveChatOwnerIndex(chatId, ownerId, { overwrite = false } = {}) {
    if (!chatId || !/^[0-9a-f-]{36}$/i.test(chatId) || !ownerId) return true;
    const ownerHash = this.tenantKey(ownerId);
    const isCloud = this.cloud ?? isR2Configured();
    const canCloud = isCloud && typeof this.writeChatOwnerIndex === "function";
    const canRedis = Boolean(this.redis?.isReady && typeof this.redis.set === "function");

    if (!overwrite && canCloud && canRedis) {
      const [cloudOutcome, redisOutcome] = await Promise.all([
        this.writeChatOwnerIndex(chatId, { ownerHash }, null).catch(() => false),
        this.redis.set(this.chatOwnerRedisKey(chatId), ownerHash, { NX: true }).catch(() => "REDIS_ERR"),
      ]);
      if (!cloudOutcome && typeof this.readChatOwnerIndex === "function") {
        const existing = await this.readChatOwnerIndex(chatId).catch(() => null);
        const existingOwnerHash = existing?.record?.ownerHash;
        if (existingOwnerHash && existingOwnerHash !== ownerHash) {
          if (redisOutcome && redisOutcome !== "REDIS_ERR") {
            await this.redis.set(this.chatOwnerRedisKey(chatId), existingOwnerHash).catch(() => {});
          }
          return false;
        }
      }
      if (!redisOutcome && typeof this.redis.get === "function") {
        const existingOwner = await this.redis.get(this.chatOwnerRedisKey(chatId)).catch(() => null);
        if (existingOwner && existingOwner !== ownerHash) {
          return false;
        }
      }
    } else {
      if (canCloud) {
        if (overwrite && typeof this.readChatOwnerIndex === "function") {
          for (let attempt = 0; attempt < 5; attempt++) {
            const existing = await this.readChatOwnerIndex(chatId).catch(() => null);
            if (existing?.record?.ownerHash === ownerHash) break;
            const written = await this.writeChatOwnerIndex(chatId, { ownerHash }, existing?.etag || null).catch(() => false);
            if (written) break;
          }
        } else {
          const written = await this.writeChatOwnerIndex(chatId, { ownerHash }, null).catch(() => false);
          if (!written && typeof this.readChatOwnerIndex === "function") {
            const existing = await this.readChatOwnerIndex(chatId).catch(() => null);
            if (existing?.record?.ownerHash && existing.record.ownerHash !== ownerHash) {
              return false;
            }
          }
        }
      }

      if (canRedis) {
        try {
          if (overwrite) {
            await this.redis.set(this.chatOwnerRedisKey(chatId), ownerHash);
          } else {
            const ok = await this.redis.set(this.chatOwnerRedisKey(chatId), ownerHash, { NX: true });
            if (!ok && typeof this.redis.get === "function") {
              const existingOwner = await this.redis.get(this.chatOwnerRedisKey(chatId));
              if (existingOwner && existingOwner !== ownerHash) {
                return false;
              }
            }
          }
        } catch {
          // Fall back cleanly on transient Redis error
        }
      }
    }

    await fs.mkdir(this.chatOwnersDir, { recursive: true });
    const indexPath = this.chatOwnerFilePath(chatId);
    if (overwrite) {
      await writeJsonAtomically(indexPath, { ownerHash });
      return true;
    }
    try {
      await fs.writeFile(indexPath, `${JSON.stringify({ ownerHash })}\n`, { flag: "wx", encoding: "utf8", mode: 0o600 });
    } catch (err) {
      if (err.code !== "EEXIST") throw err;
      try {
        const existing = JSON.parse(await fs.readFile(indexPath, "utf8"));
        if (existing?.ownerHash && existing.ownerHash !== ownerHash) {
          return false;
        }
      } catch {
        await writeJsonAtomically(indexPath, { ownerHash });
      }
    }
    return true;
  }

  /**
   * O(1) cross-shard UUID collision check via dedicated chat-owner index.
   * Never scans unrelated tenant shards via redis.keys() or R2 ListObjects.
   * @param {string} validId
   * @param {string} excludeOwnerId
   * @returns {Promise<boolean>}
   */
  async hasChatIdInOtherShards(validId, excludeOwnerId) {
    if (!validId || !/^[0-9a-f-]{36}$/i.test(validId)) return false;
    await this.ensure();
    const excludeTenantKey = excludeOwnerId ? this.tenantKey(excludeOwnerId) : null;

    try {
      const raw = await fs.readFile(this.chatOwnerFilePath(validId), "utf8");
      const parsed = JSON.parse(raw);
      if (parsed?.ownerHash && (!excludeTenantKey || parsed.ownerHash !== excludeTenantKey)) {
        return true;
      }
    } catch {
      // Index entry absent locally
    }

    const canRedis = Boolean(this.redis?.isReady && typeof this.redis.get === "function");
    const canCloud = Boolean((this.cloud ?? isR2Configured()) && typeof this.readChatOwnerIndex === "function");
    const [indexedOwner, cloudSnap] = await Promise.all([
      canRedis ? this.redis.get(this.chatOwnerRedisKey(validId)).catch(() => null) : Promise.resolve(null),
      canCloud ? this.readChatOwnerIndex(validId).catch(() => null) : Promise.resolve(null),
    ]);
    if (typeof indexedOwner === "string" && indexedOwner.length > 0 && (!excludeTenantKey || indexedOwner !== excludeTenantKey)) {
      return true;
    }
    const ownerHash = cloudSnap?.record?.ownerHash;
    if (ownerHash && (!excludeTenantKey || ownerHash !== excludeTenantKey)) {
      return true;
    }

    return false;
  }

  /**
   * Save or update a chat for a tenant.
   */
  async saveChat({ id, ownerId, title, messages, appendMessages, strategyId, briefId, taskId, mustExist = false, expectedRevision = null, onCommitted = null }) {
    if (!ownerId) throw new Error("ownerId is required to save chat");
    await this.ensureMigrated();
    const isCloud = this.cloud ?? isR2Configured();

    return this.mutateTenant(ownerId, async (records) => {
      const now = new Date().toISOString();
      const existingIndex = id ? records.findIndex((r) => r.id === id && r.ownerId === ownerId) : -1;
      if (existingIndex < 0) guestQuota(records, ownerId, 10, 1);
      if (existingIndex >= 0 && !guestVisible(records[existingIndex], ownerId)) throw Object.assign(new Error("Conversation expired"), { status: 404 });
      if (existingIndex >= 0 && records[existingIndex].deleted) throw Object.assign(new Error("Conversation removed"), { status: 404, code: "NOT_FOUND" });
      if (existingIndex >= 0 && expectedRevision !== null && (records[existingIndex].revision || 1) !== expectedRevision) {
        throw Object.assign(new Error("Conversation changed"), {
          status: 409,
          code: "REVISION_CONFLICT",
          revision: records[existingIndex].revision || 1,
        });
      }
      if (mustExist && existingIndex < 0) {
        throw new Error("Conversation was removed during execution");
      }

      if (existingIndex >= 0) {
        let finalMessages = messages;
        if (Array.isArray(appendMessages)) {
          const currentMsgs = records[existingIndex].messages || [];
          finalMessages = [...currentMsgs, ...appendMessages];
        }
        records[existingIndex] = {
          ...records[existingIndex],
          revision: (records[existingIndex].revision || 1) + 1,
          title: title || records[existingIndex].title,
          messages: finalMessages !== undefined ? finalMessages : records[existingIndex].messages,
          strategyId: strategyId !== undefined ? strategyId : records[existingIndex].strategyId,
          briefId: briefId !== undefined ? briefId : (records[existingIndex].briefId ?? null),
          taskId: taskId !== undefined ? taskId : records[existingIndex].taskId,
          updatedAt: now,
        };
        pruneExpiredGroundedResults(records[existingIndex]);
        return { updated: records, result: records[existingIndex] };
      }

      const validId = id && /^[0-9a-f-]{36}$/i.test(id) ? id : null;
      let chatId = null;
      if (validId && !records.some((r) => r.id === validId)) {
        const needsExplicitCheck = (!isCloud && !this.redis?.isReady) || Object.hasOwn(this, "hasChatIdInOtherShards");
        if (!needsExplicitCheck || !(await this.hasChatIdInOtherShards(validId, ownerId))) {
          const reserved = await this.reserveChatOwnerIndex(validId, ownerId);
          if (reserved) chatId = validId;
        }
      }
      if (!chatId) {
        chatId = randomUUID();
        await this.reserveChatOwnerIndex(chatId, ownerId);
      }
      const initialMessages = Array.isArray(appendMessages) ? appendMessages : (messages || []);
      const firstUserMsg = initialMessages.find((m) => m.role === "user")?.content || "";
      const cleanTitle = title || (firstUserMsg.length > 50 ? `${firstUserMsg.slice(0, 48)}…` : firstUserMsg) || "Yeni söhbət";
      const newRecord = {
        id: chatId,
        ownerId,
        revision: 1,
        title: cleanTitle,
        messages: initialMessages,
        strategyId: strategyId || null,
        briefId: briefId || null,
        taskId: taskId || null,
        createdAt: now,
        updatedAt: now,
      };
      pruneExpiredGroundedResults(newRecord);
      records.push(newRecord);
      return { updated: records, result: newRecord };
    }, { syncContextCache: true, onCommitted });
  }

  /**
   * Delete a single chat by ID.
   * @param {string} id
   * @param {string} ownerId
   * @returns {Promise<boolean>}
   */
  async claimResearchMessage(id, ownerId, jobId, executionFence) {
    return this.mutateTenant(ownerId, async records => {
      const chat = records.find(record => record.id === id && !record.deleted && record.ownerId === ownerId);
      if (!chat || !chat.messages.some(item => item.jobId === jobId)) throw Object.assign(new Error('Research removed'), { code: 'EXECUTION_REVOKED' });
      const previous = chat.researchFences?.[jobId] || 0;
      if (!Number.isSafeInteger(executionFence) || executionFence <= previous) throw Object.assign(new Error('Research ownership lost'), { code: 'EXECUTION_LOCK_LOST' });
      chat.researchFences = { ...chat.researchFences, [jobId]: executionFence };
      return { updated: records, result: executionFence };
    });
  }

  async patchResearchMessage(id, ownerId, jobId, message, { executionFence, assertOwned } = {}) {
    return this.mutateTenant(ownerId, async records => {
      const chat = records.find(record => record.id === id && !record.deleted && record.ownerId === ownerId);
      if (!chat) throw Object.assign(new Error('Conversation removed'), { code: 'NOT_FOUND', status: 404 });
      await assertOwned?.();
      if (chat.researchFences?.[jobId] !== undefined && chat.researchFences[jobId] !== executionFence) throw Object.assign(new Error('Research ownership lost'), { code: 'EXECUTION_LOCK_LOST' });
      const index = chat.messages.findIndex(item => item.jobId === jobId);
      if (index < 0) throw new Error('Research message removed');
      chat.messages[index] = { ...chat.messages[index], ...message };
      chat.revision = (chat.revision || 1) + 1; chat.updatedAt = new Date().toISOString();
      return { updated: records, result: chat };
    });
  }

  async delete(id, ownerId) {
    if (!id || !ownerId) return false;
    await this.ensureMigrated();

    return this.mutateTenant(ownerId, async (records) => {
      const chat = records.find((record) => record.id === id && record.ownerId === ownerId && !record.deleted);
      if (chat && this.artifactRepository) {
        if (this.cleanupQueue) {
          if (typeof this.cleanupQueue.enqueueChat === 'function') await this.cleanupQueue.enqueueChat(chat);
          else if (typeof this.cleanupQueue.enqueue === 'function') await this.cleanupQueue.enqueue(chat.ownerId, chat.id, 'chat', { messages: chat.messages || [] });
        } else {
          await this.artifactRepository.deleteChatArtifacts(chat);
        }
      }
      const filtered = records.filter((r) => !(r.id === id && r.ownerId === ownerId));
      if (chat) {
        filtered.push({ id, ownerId, deleted: true, deletedAt: new Date().toISOString(), messages: [] });
        return { updated: filtered, result: true };
      }
      return { updated: records, result: false };
    });
  }

  /**
   * Atomically migrate all chats from previousOwnerId (guest) to ownerId (user).
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
      const guestData = await this.readTenantDataWithEtag(previousOwnerId, guestKey, { coalesce: false });
      const guestRecords = Array.isArray(guestData.records)
        ? guestData.records
            .filter(record => !record.deleted && guestVisible(record, previousOwnerId))
            .map(record => {
              const copy = structuredClone(record);
              pruneExpiredGroundedResults(copy);
              return copy;
            })
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
        const destData = await this.readTenantDataWithEtag(ownerId, userKey, { coalesce: false });
        if (destData.tombstone) {
          throw new Error("Cannot migrate to a tombstoned/deleted tenant account");
        }
        const userRecords = Array.isArray(destData.records)
          ? destData.records.map(record => {
              const copy = structuredClone(record);
              pruneExpiredGroundedResults(copy);
              return copy;
            })
          : [];
        const userExistingIds = new Set(userRecords.map((r) => r.id));

        const now = new Date().toISOString();
        claimedCount = 0;
        for (const record of guestRecords) {
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

        // Sort by updatedAt descending
        userRecords.sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));

        if (isCloud) {
          try {
            this.inFlightTenantReads.delete(userKey);
            const success = await this.writeCloud(userKey, userRecords, destData.etag);
            this.inFlightTenantReads.delete(userKey);
            if (!success) {
              // OCC conflict on destination shard! Wait and retry
              await new Promise((r) => setTimeout(r, 20 * Math.pow(2, attempt) + Math.random() * 20));
              continue;
            }
          } catch (err) {
            this.inFlightTenantReads.delete(userKey);
            console.error(`Failed to write migrated shard to R2 for tenant ${userKey}:`, err?.message || err);
            throw err;
          }
        }

        // Commit updated user shard locally and to Redis AFTER authoritative cloud write
        this.inFlightTenantReads.delete(userKey);
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
      // Check with OCC retry if parallel writes added new unmigrated records to guest shard.
      const migratedIds = new Set(guestRecords.map((r) => r.id));
      if (isCloud) {
        const cleanupMaxRetries = 5;
        let guestRemaining = [];
        let guestCleaned = false;
        for (let attempt = 0; attempt < cleanupMaxRetries; attempt++) {
          const freshGuestData = await this.readTenantDataWithEtag(previousOwnerId, guestKey, { coalesce: false }).catch(() => null);
          if (!freshGuestData || freshGuestData.tombstone || (freshGuestData.etag === null && (!Array.isArray(freshGuestData.records) || freshGuestData.records.length === 0))) {
            guestRemaining = [];
            guestCleaned = true;
            break;
          }
          const freshGuestRecords = Array.isArray(freshGuestData.records) ? freshGuestData.records : [];
          const unmigrated = freshGuestRecords.filter((r) => !migratedIds.has(r.id));
          guestRemaining = unmigrated;
          this.inFlightTenantReads.delete(guestKey);
          const written = await this.writeCloud(guestKey, unmigrated, freshGuestData.etag).catch(() => false);
          this.inFlightTenantReads.delete(guestKey);
          if (written) {
            guestCleaned = true;
            break;
          }
          await new Promise((r) => setTimeout(r, 20 * Math.pow(2, attempt) + Math.random() * 20));
        }
        if (guestCleaned) {
          this.syncedShardTags.delete(guestKey);
          if (guestRemaining.length > 0) {
            await this.writeLocalTenant(guestKey, guestRemaining);
            if (this.redis?.isReady) {
              await this.redis.set(this.tenantRedisKey(previousOwnerId), JSON.stringify(guestRemaining)).catch(() => {});
            }
          } else {
            await fs.rm(this.tenantFilePath(guestKey), { force: true }).catch(() => {});
            if (this.redis?.isReady) {
              await this.redis.del(this.tenantRedisKey(previousOwnerId)).catch(() => {});
            }
          }
        }
      } else {
        const freshGuestData = await this.readTenantDataWithEtag(previousOwnerId, guestKey, { coalesce: false }).catch(() => ({ records: [] }));
        const freshGuestRecords = Array.isArray(freshGuestData.records) ? freshGuestData.records : [];
        const unmigratedGuestRecords = freshGuestRecords.filter((r) => !migratedIds.has(r.id));

        if (unmigratedGuestRecords.length > 0) {
          // Parallel write added new records to guest shard: preserve unmigrated records!
          this.syncedShardTags.delete(guestKey);
          await this.writeLocalTenant(guestKey, unmigratedGuestRecords);
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
        }
      }

      for (const migratedRecord of guestRecords) {
        await this.reserveChatOwnerIndex(migratedRecord.id, ownerId, { overwrite: true }).catch(() => {});
      }

      return claimedCount;
    });
  }

  /**
   * Delete all chats belonging to an owner.
   * @param {string} ownerId
   * @returns {Promise<number>}
   */
  async deleteAllByOwner(ownerId) {
    if (!ownerId) return 0;
    await this.ensure();

    return this.runInTenantLock(ownerId, async (tenantKey) => {
      const { records, etag } = await this.readTenantDataWithEtag(ownerId, tenantKey, { coalesce: false });
      const count = Array.isArray(records) ? records.length : 0;
      const now = new Date().toISOString();

      if (this.artifactRepository && count > 0) {
        for (const chat of records) {
          if (this.cleanupQueue) {
            if (typeof this.cleanupQueue.enqueueChat === 'function') await this.cleanupQueue.enqueueChat(chat);
            else if (typeof this.cleanupQueue.enqueue === 'function') await this.cleanupQueue.enqueue(chat.ownerId, chat.id, 'chat', { messages: chat.messages || [] });
          } else {
            await this.artifactRepository.deleteChatArtifacts(chat);
          }
        }
      }
      if (typeof this.cleanupQueue?.enqueue === "function") {
        await this.cleanupQueue.enqueue(ownerId, ownerId, "owner");
      }

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
            this.inFlightTenantReads.delete(tenantKey);
            written = await this.writeCloud(tenantKey, tombstoneRecord, currentEtag);
            this.inFlightTenantReads.delete(tenantKey);
            if (written) break;
          } catch (err) {
            this.inFlightTenantReads.delete(tenantKey);
            console.error(`Failed to write tombstone to R2 for chat tenant ${tenantKey}:`, err?.message || err);
            throw err;
          }

          // Conflict: re-read to get fresh ETag
          const fresh = await this.readTenantDataWithEtag(ownerId, tenantKey, { coalesce: false });
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
