import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { TenantLockManager } from "../repositories/tenant-lock.js";
import { storageCorruption, writeJsonAtomically } from "../repositories/atomic-json-store.js";
import {
  isR2Configured,
  readAuthStoreObject,
  writeAuthStoreObject,
} from "../http/r2-storage.js";

function emptyStore() {
  return { schemaVersion: 1, sessions: {}, resetTokens: {}, emailVerificationTokens: {}, rates: {} };
}

// A corrupted or foreign Redis value must read as "no record", never as a 500.
function parseRecord(value) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export class FileAuthStore {
  constructor(filePath, redisOrOptions = null, maybeOptions = {}) {
    this.filePath = filePath;
    const options = (redisOrOptions && typeof redisOrOptions === "object" && !redisOrOptions.isReady && !redisOrOptions.get)
      ? redisOrOptions
      : (maybeOptions || {});
    this.redis = (redisOrOptions && (redisOrOptions.isReady || redisOrOptions.get)) ? redisOrOptions : null;
    this.cloud = options.cloud ?? options.mirrorToR2 ?? isR2Configured();
    this.readCloud = options.readCloud || readAuthStoreObject;
    this.writeCloud = options.writeCloud || writeAuthStoreObject;
    this.lockManager = new TenantLockManager(path.dirname(filePath));
    this.lockKey = createHash("sha256").update(path.resolve(filePath)).digest("hex");
    this.cache = null;
    this.lastMtimeMs = 0;
    this.lastR2Sync = 0;
    this.syncPromise = null;
  }

  async withLock(operation) {
    return this.lockManager.runInLock(this.lockKey, operation);
  }

  async syncFromR2() {
    if (this.syncPromise) return this.syncPromise;
    this.syncPromise = this.withLock(async () => {
      const store = await this.read(true);
      await this.writeLocal(store);
      return store;
    });
    try { return await this.syncPromise; }
    finally { this.syncPromise = null; }
  }

  async read(force = false) {
    if (this.cloud) {
      const { record, notFound } = await this.readCloud({ force: Boolean(force) });
      if (!notFound && record !== null && (!record || typeof record !== "object" || Array.isArray(record))) {
        throw storageCorruption("Invalid cloud auth storage.");
      }
      this.cache = { ...emptyStore(), ...(record || {}) };
      this.lastR2Sync = Date.now();
      return this.cache;
    }
    try {
      this.cache = { ...emptyStore(), ...JSON.parse(await fs.readFile(this.filePath, "utf8")) };
      return this.cache;
    } catch (error) {
      if (error.code === "ENOENT") return emptyStore();
      if (error instanceof SyntaxError) throw storageCorruption("Auth storage contains invalid JSON.", error);
      throw error;
    }
  }

  async writeLocal(store) {
    await writeJsonAtomically(this.filePath, store);
    try {
      this.lastMtimeMs = (await fs.stat(this.filePath)).mtimeMs;
    } catch {}
  }

  async write(store) {
    return this.withLock(async () => {
      if (this.cloud) {
        const { etag } = await this.readCloud({ force: true });
        if (!await this.writeCloud(store, etag)) {
          const error = new Error("Auth storage concurrency conflict.");
          error.code = "STORAGE_BUSY";
          error.statusCode = error.status = 503;
          throw error;
        }
      }
      await this.writeLocal(store);
      this.cache = store;
    });
  }

  mutate(callback) {
    return this.withLock(async () => {
      const isCloud = this.cloud;
      const maxAttempts = isCloud ? 10 : 1;

      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        let store;
        let etag = null;

        if (isCloud) {
          const res = await this.readCloud({ force: true });
          if (res.record) {
            store = { ...emptyStore(), ...res.record };
            etag = res.etag;
          } else {
            if (res.record !== null && !res.notFound) throw storageCorruption("Invalid cloud auth storage.");
            store = emptyStore();
            etag = res.etag || null;
          }
        } else {
          // Always read fresh authoritative store inside lock
          store = await this.read(true);
        }

        const now = Date.now();
        for (const [key, value] of Object.entries(store.sessions)) {
          if (value.expiresAt <= now) delete store.sessions[key];
        }
        for (const [key, value] of Object.entries(store.resetTokens)) {
          if (value.expiresAt <= now) delete store.resetTokens[key];
        }
        for (const [key, value] of Object.entries(store.emailVerificationTokens)) {
          if (value.expiresAt <= now) delete store.emailVerificationTokens[key];
        }
        for (const [key, value] of Object.entries(store.rates)) {
          if (value.resetAt <= now) delete store.rates[key];
        }

        const storeCopy = JSON.parse(JSON.stringify(store));
        const result = callback(storeCopy, now);

        if (isCloud) {
          const success = await this.writeCloud(storeCopy, etag);
          if (!success) {
            await new Promise((r) => setTimeout(r, 20 + Math.floor(Math.random() * 25) + attempt * 20));
            continue;
          }
        }

        await this.writeLocal(storeCopy);
        this.cache = storeCopy;
        return result;
      }

      const err = new Error("Auth store concurrency conflict. Maximum retries exceeded.");
      err.code = "STORAGE_BUSY";
      throw err;
    });
  }

  async createSession(id, userId, ttlSeconds, metadata = {}) {
    return this.mutate((store, now) => {
      store.sessions[id] = { userId, protocolVersion: 2, authVersion: metadata.authVersion ?? 1, ...metadata, createdAt: now, expiresAt: now + ttlSeconds * 1000 };
    });
  }

  async getSession(id) {
    // read(true) forces conditional ETag revalidation against cloud storage so
    // session revocations across multi-replica Cloud Run instances take effect immediately.
    const store = await this.read(true);
    const session = store.sessions[id];
    return session && session.expiresAt > Date.now() ? session : null;
  }

  async updateSession(id, changes) {
    return this.mutate(store => {
      const session = store.sessions[id];
      if (!session || session.expiresAt <= Date.now()) throw new Error('Session expired');
      for (const field of ['mfaVerifiedAt', 'reauthenticatedAt']) if (changes[field] !== undefined) session[field] = changes[field];
      return session;
    });
  }

  async deleteSession(id) {
    return this.mutate((store) => {
      delete store.sessions[id];
    });
  }

  async advanceSessionVersion(id, userId, previousVersion) {
    return this.mutate((store, now) => {
      const session = store.sessions[id];
      if (session?.userId !== userId || session.expiresAt <= now ||
          session.protocolVersion !== 2 || session.authVersion !== previousVersion) return false;
      session.authVersion = previousVersion + 1;
      delete session.mfaVerifiedAt;
      delete session.reauthenticatedAt;
      return true;
    });
  }

  async invalidateUserSessions(userId, exceptId = null) {
    return this.mutate((store) => {
      for (const [id, session] of Object.entries(store.sessions)) {
        if (session.userId === userId && id !== exceptId) delete store.sessions[id];
      }
    });
  }

  async createResetToken(id, userId, ttlSeconds, metadata = {}) {
    return this.mutate((store, now) => {
      store.resetTokens[id] = { userId, ...metadata, createdAt: now, expiresAt: now + ttlSeconds * 1000 };
    });
  }

  async consumeResetToken(id) {
    return this.mutate((store) => {
      const token = store.resetTokens[id] || null;
      delete store.resetTokens[id];
      return token;
    });
  }

  async createEmailVerificationToken(id, userId, ttlSeconds, metadata = {}) {
    return this.mutate((store, now) => {
      for (const [key, token] of Object.entries(store.emailVerificationTokens)) {
        if (token.userId === userId) delete store.emailVerificationTokens[key];
      }
      store.emailVerificationTokens[id] = { userId, ...metadata, createdAt: now, expiresAt: now + ttlSeconds * 1000 };
    });
  }

  async consumeEmailVerificationToken(id) {
    return this.mutate((store) => {
      const token = store.emailVerificationTokens[id] || null;
      delete store.emailVerificationTokens[id];
      return token;
    });
  }

  async hitRateLimit(key, limit, windowSeconds) {
    return this.mutate((store, now) => {
      const existing = store.rates[key];
      const rate = !existing || existing.resetAt <= now
        ? { count: 0, resetAt: now + windowSeconds * 1000 }
        : existing;
      rate.count += 1;
      store.rates[key] = rate;
      return { allowed: rate.count <= limit, remaining: Math.max(0, limit - rate.count), resetAt: rate.resetAt };
    });
  }
}

export class RedisAuthStore {
  constructor(client) {
    this.client = client;
  }

  sessionKey(id) { return `auth:session:${id}`; }
  userSessionsKey(userId) { return `auth:user-sessions:${userId}`; }

  async createSession(id, userId, ttlSeconds, metadata = {}) {
    await this.client.multi()
      .set(this.sessionKey(id), JSON.stringify({ userId, protocolVersion: 2, authVersion: metadata.authVersion ?? 1, ...metadata, createdAt: Date.now() }), { EX: ttlSeconds })
      .sAdd(this.userSessionsKey(userId), id)
      .expire(this.userSessionsKey(userId), ttlSeconds)
      .exec();
  }

  async getSession(id) {
    return parseRecord(await this.client.get(this.sessionKey(id)));
  }

  async advanceSessionVersion(id, userId, previousVersion) {
    return Boolean(await this.client.eval(`
      local raw = redis.call('get', KEYS[1])
      if not raw then return 0 end
      local session = cjson.decode(raw)
      local version = tonumber(ARGV[2])
      if session.userId ~= ARGV[1] or session.protocolVersion ~= 2 or session.authVersion ~= version then return 0 end
      session.authVersion = version + 1
      session.mfaVerifiedAt = nil
      session.reauthenticatedAt = nil
      redis.call('set', KEYS[1], cjson.encode(session), 'KEEPTTL')
      return 1
    `, { keys: [this.sessionKey(id)], arguments: [userId, String(previousVersion)] }));
  }

  async updateSession(id, changes) {
    const metadata = Object.fromEntries(['mfaVerifiedAt', 'reauthenticatedAt'].filter(field => changes[field] !== undefined).map(field => [field, changes[field]]));
    const changed = await this.client.eval("local raw = redis.call('get', KEYS[1]); if not raw then return 0 end; local s = cjson.decode(raw); local p = cjson.decode(ARGV[1]); for k,v in pairs(p) do s[k] = v end; redis.call('set', KEYS[1], cjson.encode(s), 'KEEPTTL'); return 1", { keys: [this.sessionKey(id)], arguments: [JSON.stringify(metadata)] });
    if (!changed) throw new Error('Session expired');
  }

  async deleteSession(id) {
    const session = await this.getSession(id);
    await this.client.del(this.sessionKey(id));
    if (session?.userId) await this.client.sRem(this.userSessionsKey(session.userId), id);
  }

  async invalidateUserSessions(userId, exceptId = null) {
    const ids = await this.client.sMembers(this.userSessionsKey(userId));
    const deletions = ids.filter((id) => id !== exceptId);
    if (deletions.length) await this.client.del(deletions.map((id) => this.sessionKey(id)));
    await this.client.del(this.userSessionsKey(userId));
    if (exceptId) {
      const ttl = await this.client.ttl(this.sessionKey(exceptId));
      if (ttl > 0) {
        await this.client.sAdd(this.userSessionsKey(userId), exceptId);
        await this.client.expire(this.userSessionsKey(userId), ttl);
      }
    }
  }

  async createResetToken(id, userId, ttlSeconds, metadata = {}) {
    await this.client.set(`auth:reset:${id}`, JSON.stringify({ userId, ...metadata }), { EX: ttlSeconds });
  }

  async consumeResetToken(id) {
    const key = `auth:reset:${id}`;
    if (typeof this.client.getDel === "function") {
      return parseRecord(await this.client.getDel(key));
    }
    const lua = "local v = redis.call('get', KEYS[1]); if v then redis.call('del', KEYS[1]) end; return v;";
    return parseRecord(await this.client.eval(lua, { keys: [key] }));
  }

  async createEmailVerificationToken(id, userId, ttlSeconds, metadata = {}) {
    await this.client.eval("local old = redis.call('get', KEYS[1]); if old then redis.call('del', 'auth:verify-email:' .. old) end; redis.call('set', KEYS[2], ARGV[2], 'EX', ARGV[3]); redis.call('set', KEYS[1], ARGV[1], 'EX', ARGV[3]); return 1", { keys: [`auth:verify-current:${userId}`, `auth:verify-email:${id}`], arguments: [id, JSON.stringify({ userId, ...metadata }), String(ttlSeconds)] });
  }

  async consumeEmailVerificationToken(id) {
    const key = `auth:verify-email:${id}`;
    if (typeof this.client.getDel === "function") {
      return parseRecord(await this.client.getDel(key));
    }
    const lua = "local v = redis.call('get', KEYS[1]); if v then redis.call('del', KEYS[1]) end; return v;";
    return parseRecord(await this.client.eval(lua, { keys: [key] }));
  }

  async hitRateLimit(key, limit, windowSeconds) {
    const redisKey = `auth:rate:${key}`;
    // Create the key with its TTL atomically before incrementing; a separate
    // INCR + EXPIRE could leave a TTL-less key that locks the client out forever.
    const [, rawCount, rawTtl] = await this.client.multi()
      .set(redisKey, "0", { NX: true, EX: windowSeconds })
      .incr(redisKey)
      .ttl(redisKey)
      .exec();
    const count = Number(rawCount);
    const ttl = Math.max(0, Number(rawTtl));
    return { allowed: count <= limit, remaining: Math.max(0, limit - count), resetAt: Date.now() + ttl * 1000 };
  }
}
