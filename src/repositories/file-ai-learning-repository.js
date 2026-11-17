import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { isR2Configured, listTenantObjects, readTenantObject, writeTenantObject } from "../http/r2-storage.js";
import { AtomicJsonStore, storageCorruption } from "./atomic-json-store.js";

export const EMPTY_LEARNING_STORE = Object.freeze({
  schemaVersion: 1,
  interactions: [],
  signals: [],
  iterations: [],
  candidates: [],
});

function normalizeStore(value) {
  const source = value && typeof value === "object" ? value : {};
  for (const key of ["interactions", "signals", "iterations", "candidates"]) {
    if (source[key] !== undefined && !Array.isArray(source[key])) throw storageCorruption(`Invalid learning ${key}.`);
  }
  return {
    schemaVersion: 1,
    interactions: Array.isArray(source.interactions) ? source.interactions : [],
    signals: Array.isArray(source.signals) ? source.signals : [],
    iterations: Array.isArray(source.iterations) ? source.iterations : [],
    candidates: Array.isArray(source.candidates) ? source.candidates : [],
  };
}

function scrubOwnerData(store, ownerId) {
  const ownerInteractionIds = new Set(
    store.interactions.filter((item) => item.ownerId === ownerId).map((item) => item.id),
  );
  if (ownerInteractionIds.size === 0) return 0;
  store.candidates = store.candidates.filter((c) => !ownerInteractionIds.has(c.sourceInteractionId));
  store.iterations = store.iterations.filter(
    (it) => !ownerInteractionIds.has(it.parentInteractionId) && !ownerInteractionIds.has(it.interactionId),
  );
  store.signals = store.signals.filter((sig) => !ownerInteractionIds.has(sig.interactionId));
  for (const item of store.interactions) {
    if (item.ownerId === ownerId) {
      item.onlyNecessaryData = true;
      item.modelImprovement = false;
      item.userPrompt = "[Zəruri əməliyyat qeydi - Məzmun ötürülmür]";
      item.modelResponse = "[Məzmun gizlədilib - Töhfə deaktivdir]";
      item.relevantContext = null;
    }
  }
  return ownerInteractionIds.size;
}

function removeOwnerData(store, ownerId) {
  const ids = new Set(store.interactions.filter((item) => item.ownerId === ownerId).map((item) => item.id));
  if (ids.size === 0) return 0;
  store.interactions = store.interactions.filter((item) => !ids.has(item.id));
  store.signals = store.signals.filter((item) => !ids.has(item.interactionId));
  store.iterations = store.iterations.filter((item) => !ids.has(item.parentInteractionId));
  store.candidates = store.candidates.filter((item) => !ids.has(item.sourceInteractionId));
  return ids.size;
}

export class FileAiLearningRepository extends AtomicJsonStore {
  constructor(filePath, redis = null, options = {}) {
    super(filePath, redis, options, {
      redisKey: "marketify:store:ai-learning:v1",
      r2FileName: "ai-learning-v1.json",
      empty: EMPTY_LEARNING_STORE,
      normalize: normalizeStore,
    });
    this.shardsDirectory = `${filePath}.tenants`;
    this.shardOptions = { cloud: this.cloud, mirrorToR2: this.mirrorToR2 };
    this.readShard = options.readShard;
    this.writeShard = options.writeShard;
    this.hasCustomCloudReads = Boolean(options.readCloud);
    this.hasExplicitListShards = typeof options.listShards === "function";
    this.listShards = options.listShards || (() => (isR2Configured() ? listTenantObjects("ai-learning-v2/") : []));
  }

  tenantKey(ownerId) {
    return createHash("sha256").update(ownerId || "system").digest("hex");
  }

  shardByKey(key) {
    if (!/^[a-f0-9]{64}$/.test(key)) throw new Error("Invalid learning tenant");
    const options = {
      ...this.shardOptions,
      readCloud: this.readShard
        ? (readOptions = {}) => this.readShard(key, { force: true, ...readOptions })
        : (readOptions = {}) => readTenantObject(`ai-learning-v2/${key}.json`, { force: true, ...readOptions }),
      writeCloud: this.writeShard
        ? (store, etag) => this.writeShard(key, store, etag)
        : (store, etag) => writeTenantObject(`ai-learning-v2/${key}.json`, store, etag),
    };
    return new AtomicJsonStore(path.join(this.shardsDirectory, `${key}.json`), this.redis, options, {
      redisKey: `helmer:store:ai-learning:v2:${key}`,
      r2FileName: `ai-learning-v2/${key}.json`,
      empty: EMPTY_LEARNING_STORE,
      normalize: normalizeStore,
    });
  }

  async readOwner(ownerId) {
    return this.shardByKey(this.tenantKey(ownerId)).readStore();
  }

  async updateOwner(ownerId, mutator) {
    return this.shardByKey(this.tenantKey(ownerId)).update(mutator);
  }

  async hasLegacyStore() {
    if (this.cloud) {
      return this.hasCustomCloudReads || isR2Configured();
    }
    try {
      await fs.access(this.filePath);
      return true;
    } catch (error) {
      if (error.code === "ENOENT") return false;
      throw error;
    }
  }

  async readLegacyStoreIfPresent() {
    if (!(await this.hasLegacyStore())) {
      return normalizeStore(structuredClone(EMPTY_LEARNING_STORE));
    }
    return super.readStore();
  }

  async listShardKeys() {
    let names;
    if (this.cloud) {
      if (!this.hasExplicitListShards && !isR2Configured()) return [];
      names = (await this.listShards()).map((key) => String(key).split("/").at(-1));
    } else {
      try {
        names = await fs.readdir(this.shardsDirectory);
      } catch (error) {
        if (error.code === "ENOENT") return [];
        throw error;
      }
    }
    return names.filter((name) => /^[a-f0-9]{64}\.json$/.test(name)).map((name) => name.slice(0, -5));
  }

  async readStore() {
    const legacy = await this.readLegacyStoreIfPresent();
    const interactions = new Map(legacy.interactions.map((item) => [item.id, item]));
    const signals = new Map(legacy.signals.map((item) => [item.id, item]));
    const iterations = new Map(legacy.iterations.map((item) => [item.id, item]));
    const candidates = new Map(legacy.candidates.map((item) => [item.id, item]));

    for (const key of await this.listShardKeys()) {
      const shardStore = await this.shardByKey(key).readStore();
      for (const item of shardStore.interactions) interactions.set(item.id, item);
      for (const item of shardStore.signals) signals.set(item.id, item);
      for (const item of shardStore.iterations) iterations.set(item.id, item);
      for (const item of shardStore.candidates) candidates.set(item.id, item);
    }

    return {
      schemaVersion: 1,
      interactions: [...interactions.values()],
      signals: [...signals.values()],
      iterations: [...iterations.values()],
      candidates: [...candidates.values()],
    };
  }

  async updateInteractionOwner(ownerId, interactionId, mutator) {
    if (ownerId) {
      const shard = this.shardByKey(this.tenantKey(ownerId));
      const shardExists = this.cloud
        ? (this.hasCustomCloudReads && !this.readShard && !isR2Configured() ? false : true)
        : await fs.access(shard.filePath).then(() => true, (err) => {
            if (err.code === "ENOENT") return false;
            throw err;
          });
      if (shardExists) {
        const shardStore = await shard.readStore();
        if (shardStore.interactions.some((item) => item.id === interactionId)) {
          return shard.update(mutator);
        }
      }
    }

    if (await this.hasLegacyStore()) {
      const legacy = await this.readLegacyStoreIfPresent();
      if (legacy.interactions.some((item) => item.id === interactionId && (!ownerId || item.ownerId === ownerId))) {
        return super.update(mutator);
      }
    }
    return null;
  }

  async updateByInteractionId(interactionId, mutator) {
    for (const key of await this.listShardKeys()) {
      const shard = this.shardByKey(key);
      const shardStore = await shard.readStore();
      if (shardStore.interactions.some((item) => item.id === interactionId)) {
        return shard.update(mutator);
      }
    }
    if (await this.hasLegacyStore()) {
      const legacy = await this.readLegacyStoreIfPresent();
      if (legacy.interactions.some((item) => item.id === interactionId)) {
        return super.update(mutator);
      }
    }
    return null;
  }

  async updateByCandidateId(candidateId, mutator) {
    for (const key of await this.listShardKeys()) {
      const shard = this.shardByKey(key);
      const shardStore = await shard.readStore();
      if (shardStore.candidates.some((item) => item.id === candidateId)) {
        return shard.update(mutator);
      }
    }
    if (await this.hasLegacyStore()) {
      const legacy = await this.readLegacyStoreIfPresent();
      if (legacy.candidates.some((item) => item.id === candidateId)) {
        return super.update(mutator);
      }
    }
    return null;
  }

  async scrubOwner(ownerId) {
    if (!ownerId) return 0;
    let scrubbedCount = 0;
    const key = this.tenantKey(ownerId);
    const shardKeys = new Set(await this.listShardKeys());
    if (shardKeys.has(key)) {
      scrubbedCount += await this.shardByKey(key).update((store) => scrubOwnerData(store, ownerId));
    }

    if (await this.hasLegacyStore()) {
      const legacy = await this.readLegacyStoreIfPresent();
      if (legacy.interactions.some((item) => item.ownerId === ownerId)) {
        scrubbedCount += await this.update((store) => scrubOwnerData(store, ownerId));
      }
    }
    return scrubbedCount;
  }

  async deleteAllByOwner(ownerId) {
    if (!ownerId) return 0;
    let totalDeleted = 0;
    const key = this.tenantKey(ownerId);
    const shardKeys = new Set(await this.listShardKeys());
    if (shardKeys.has(key)) {
      totalDeleted += await this.shardByKey(key).update((store) => removeOwnerData(store, ownerId));
    }

    if (await this.hasLegacyStore()) {
      const legacy = await this.readLegacyStoreIfPresent();
      if (legacy.interactions.some((item) => item.ownerId === ownerId)) {
        totalDeleted += await this.update((store) => removeOwnerData(store, ownerId));
      }
    }
    return totalDeleted;
  }

  async claimOwner(previousOwnerId, ownerId) {
    if (!previousOwnerId || previousOwnerId === ownerId) return 0;
    let movedCount = 0;
    const prevKey = this.tenantKey(previousOwnerId);
    const shardKeys = new Set(await this.listShardKeys());
    if (shardKeys.has(prevKey)) {
      const guestShard = this.shardByKey(prevKey);
      const guestStore = await guestShard.readStore();
      const guestInteractions = guestStore.interactions.filter((item) => item.ownerId === previousOwnerId);
      if (guestInteractions.length > 0) {
        const movedIds = new Set(guestInteractions.map((item) => item.id));
        const movedSignals = guestStore.signals.filter((item) => movedIds.has(item.interactionId));
        const movedIterations = guestStore.iterations.filter((item) => movedIds.has(item.parentInteractionId));
        const movedCandidates = guestStore.candidates.filter((item) => movedIds.has(item.sourceInteractionId));

        await this.updateOwner(ownerId, (destStore) => {
          const existingInteractionIds = new Set(destStore.interactions.map((item) => item.id));
          const existingSignalIds = new Set(destStore.signals.map((item) => item.id));
          const existingIterationIds = new Set(destStore.iterations.map((item) => item.id));
          const existingCandidateIds = new Set(destStore.candidates.map((item) => item.id));

          for (const item of guestInteractions) {
            if (!existingInteractionIds.has(item.id)) {
              destStore.interactions.push({ ...item, ownerId });
              movedCount += 1;
            }
          }
          for (const item of movedSignals) {
            if (!existingSignalIds.has(item.id)) destStore.signals.push(item);
          }
          for (const item of movedIterations) {
            if (!existingIterationIds.has(item.id)) destStore.iterations.push(item);
          }
          for (const item of movedCandidates) {
            if (!existingCandidateIds.has(item.id)) destStore.candidates.push(item);
          }
          return movedCount;
        });

        await guestShard.update((store) => {
          store.interactions = store.interactions.filter((item) => !movedIds.has(item.id));
          store.signals = store.signals.filter((item) => !movedIds.has(item.interactionId));
          store.iterations = store.iterations.filter((item) => !movedIds.has(item.parentInteractionId));
          store.candidates = store.candidates.filter((item) => !movedIds.has(item.sourceInteractionId));
          return movedIds.size;
        });
      }
    }

    if (await this.hasLegacyStore()) {
      const legacy = await this.readLegacyStoreIfPresent();
      if (legacy.interactions.some((item) => item.ownerId === previousOwnerId)) {
        movedCount += await this.update((store) => {
          let count = 0;
          for (const interaction of store.interactions) {
            if (interaction.ownerId === previousOwnerId) {
              interaction.ownerId = ownerId;
              count += 1;
            }
          }
          return count;
        });
      }
    }
    return movedCount;
  }
}
