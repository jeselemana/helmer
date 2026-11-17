import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { isR2Configured, readTenantObject, writeTenantObject } from "../http/r2-storage.js";
import { TenantLockManager } from "./tenant-lock.js";

export function storageCorruption(message, cause) {
  const error = new Error(message, { cause });
  error.code = "STORAGE_CORRUPT";
  error.statusCode = error.status = 503;
  return error;
}

export async function writeJsonAtomically(filePath, value, { initialize = false } = {}) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  let fileHandle = null;
  try {
    fileHandle = await fs.open(temporaryPath, "w", 0o600);
    await fileHandle.writeFile(`${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8" });
    await fileHandle.sync();
    await fileHandle.close();
    fileHandle = null;

    if (initialize) {
      // link is create-only: racing initialization must never replace a populated store.
      await fs.link(temporaryPath, filePath).catch(error => { if (error.code !== "EEXIST") throw error; });
    } else {
      await fs.rename(temporaryPath, filePath);
    }
  } finally {
    if (fileHandle) {
      await fileHandle.close().catch(() => {});
    }
    await fs.rm(temporaryPath, { force: true });
  }
}

// Reads and mutations use the same authority. Redis is only a best-effort mirror.
export class AtomicJsonStore {
  constructor(filePath, redis, options, { redisKey, r2FileName, empty, normalize }) {
    this.filePath = filePath;
    this.redis = redis;
    this.redisKey = redisKey;
    this.r2FileName = r2FileName;
    this.mirrorToR2 = options.mirrorToR2 !== false;
    this.cloud = options.cloud ?? (this.mirrorToR2 && isR2Configured());
    this.readCloud = options.readCloud || ((readOptions = {}) => readTenantObject(r2FileName, { force: true, ...readOptions }));
    this.writeCloud = options.writeCloud || ((value, etag) => writeTenantObject(r2FileName, value, etag));
    this.empty = empty;
    this.normalize = normalize;
    this.lockManager = new TenantLockManager(path.dirname(filePath));
    this.lockKey = createHash("sha256").update(path.resolve(filePath)).digest("hex");
  }

  async ensure() {
    try { await fs.access(this.filePath); return; }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    await writeJsonAtomically(this.filePath, this.empty, { initialize: true });
  }

  async readAuthoritative() {
    if (this.cloud) {
      const { record, etag, notFound } = await this.readCloud({ force: true });
      if (notFound || record === null) return { store: this.normalize(structuredClone(this.empty)), etag: etag || null };
      if (!record || typeof record !== "object" || Array.isArray(record)) throw storageCorruption("Invalid cloud JSON store.");
      return { store: this.normalize(structuredClone(record)), etag };
    }
    await this.ensure();
    try {
      const parsed = JSON.parse(await fs.readFile(this.filePath, "utf8"));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw storageCorruption("Invalid local JSON store.");
      return { store: this.normalize(parsed), etag: null };
    } catch (error) {
      if (error instanceof SyntaxError) throw storageCorruption("Storage contains invalid JSON.", error);
      throw error;
    }
  }

  async readStore() {
    return (await this.readAuthoritative()).store;
  }

  async update(mutator) {
    return this.lockManager.runInLock(this.lockKey, async () => {
      for (let attempt = 0; attempt < (this.cloud ? 10 : 1); attempt++) {
        const { store, etag } = await this.readAuthoritative();
        const result = await mutator(store);
        if (this.cloud && !await this.writeCloud(store, etag)) {
          await new Promise(resolve => setTimeout(resolve, 20 + attempt * 25 + Math.random() * 20));
          continue;
        }
        await writeJsonAtomically(this.filePath, store);
        if (this.redis?.isReady) await this.redis.set(this.redisKey, JSON.stringify(store)).catch(() => {});
        return result;
      }
      const error = new Error("Storage concurrency conflict. Maximum retries exceeded.");
      error.code = "STORAGE_BUSY";
      error.statusCode = error.status = 503;
      throw error;
    });
  }

  async writeStore(value) {
    const next = this.normalize(value);
    return this.update(store => {
      Object.assign(store, structuredClone(next));
      return store;
    });
  }
}
