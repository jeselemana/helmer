import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { TenantLockManager } from "./tenant-lock.js";
import { storageCorruption, writeJsonAtomically } from "./atomic-json-store.js";
import { migrateAuthUserStore, migrateUser } from "./auth-store-migrations.js";
import { normalizeEmail, normalizeUsername, isReservedUsername } from "../auth/validation.js";
import {
  isR2Configured,
  readUserObject,
  writeUserObject,
} from "../http/r2-storage.js";

export class UserConflictError extends Error {
  constructor(field) {
    super(field === "email" ? "Bu e-poçt artıq istifadə olunur." : "Bu istifadəçi adı artıq götürülüb.");
    this.code = "USER_CONFLICT";
    this.statusCode = 409;
    this.status = 409;
    this.field = field;
  }
}

export class FileUserRepository {
  /**
   * @param {string} filePath - Path to users.json
   * @param {any} redis - Optional Redis client
   * @param {object} options - Optional overrides for cloud functions
   */
  constructor(filePath, redis = null, options = {}) {
    this.filePath = filePath;
    this.redis = redis;
    this.redisKey = "marketify:store:users";
    this.cloud = options.cloud ?? isR2Configured();
    this.readCloud = options.readCloud || readUserObject;
    this.writeCloud = options.writeCloud || writeUserObject;
    this.lockManager = new TenantLockManager(path.dirname(filePath));
    this.lockKey = createHash("sha256").update(path.resolve(filePath)).digest("hex");
    this.cache = null;
    this.lastMtimeMs = 0;
    this.lastR2Sync = 0;
    this.syncPromise = null;
    this.inFlightStoreRead = null;
    this._localRawSnapshot = null;
  }

  async ensure() {
    if (this.cloud) return this.syncFromR2();
    await writeJsonAtomically(this.filePath, migrateAuthUserStore(null), { initialize: true });
  }

  async withLock(operation) {
    return this.lockManager.runInLock(this.lockKey, operation);
  }

  async syncFromR2(force = false) {
    if (this.syncPromise && !force) return this.syncPromise;
    this.syncPromise = this.withLock(async () => {
      // R2 is authoritative, including an empty store or deleted cloud object.
      const { store } = await this.readAuthoritativeStore({ force: Boolean(force) });
      await writeJsonAtomically(this.filePath, store);
    this._localRawSnapshot = null;
      this.cache = store;
      this.lastR2Sync = Date.now();
      this.lastMtimeMs = (await fs.stat(this.filePath)).mtimeMs;
      if (this.redis?.isReady) await this.redis.set(this.redisKey, JSON.stringify(store)).catch(() => {});
      return store;
    });
    try { return await this.syncPromise; }
    finally { this.syncPromise = null; }
  }

  async readRawAuthoritativeStore({ force = false, clone = true } = {}) {
    if (this.cloud) {
      try {
        const { record, etag, notFound } = await this.readCloud({ force, clone });
        if (record && !Array.isArray(record) && Array.isArray(record.users)) {
          return { raw: record, etag };
        }
        if (notFound || record === null) {
          return { raw: null, etag: etag || null };
        }
        throw storageCorruption("Invalid cloud user storage.");
      } catch (err) {
        console.error("Authoritative R2 user read error:", err?.message || err);
        throw err;
      }
    }

    // Local file mode: revalidate via nanosecond stat before skipping disk read/parse.
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    try {
      const stat = await fs.stat(this.filePath, { bigint: true });
      const statKey = `${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`;
      if (this._localRawSnapshot?.key === statKey) {
        const parsed = this._localRawSnapshot.parsed;
        return { raw: clone && parsed ? structuredClone(parsed) : parsed, etag: null };
      }
      const rawText = await fs.readFile(this.filePath, "utf8");
      const parsed = JSON.parse(rawText || "{}");
      this._localRawSnapshot = { key: statKey, parsed };
      this.lastMtimeMs = Number(stat.mtimeNs) / 1e6;
      return { raw: clone && parsed ? structuredClone(parsed) : parsed, etag: null };
    } catch (error) {
      if (error.code === "ENOENT") {
        this._localRawSnapshot = null;
        return { raw: null, etag: null };
      }
      if (error instanceof SyntaxError) throw storageCorruption("User storage contains invalid JSON.", error);
      throw error;
    }
  }

  async readAuthoritativeStore({ force = false, clone = true } = {}) {
    const { raw, etag } = await this.readRawAuthoritativeStore({ force, clone });
    const store = migrateAuthUserStore(raw);
    this.cache = store;
    return { store, etag };
  }

  async readStore({ force = false, clone = true, raw = false } = {}) {
    let pending = (this.cloud && !force) ? this.inFlightStoreRead : null;
    if (!pending) {
      pending = this.readRawAuthoritativeStore({ force: this.cloud || Boolean(force), clone: false });
      if (this.cloud && !force) {
        this.inFlightStoreRead = pending;
        const clear = () => { if (this.inFlightStoreRead === pending) this.inFlightStoreRead = null; };
        pending.then(clear, clear);
      }
    }
    const { raw: rawRecord } = await pending;
    this.lastR2Sync = Date.now();
    if (raw) {
      const users = Array.isArray(rawRecord) ? rawRecord : (Array.isArray(rawRecord?.users) ? rawRecord.users : []);
      return clone ? { users: structuredClone(users) } : { users };
    }
    const store = migrateAuthUserStore(rawRecord);
    this.cache = store;
    // Share the read, never mutable account objects or a time-based auth cache.
    return clone ? structuredClone(store) : store;
  }

  async writeStore(store) {
    return this.withLock(async () => {
      const { etag } = await this.readAuthoritativeStore({ force: true });
      if (!await this.commitStore(store, etag)) {
        const error = new Error("User storage concurrency conflict.");
        error.code = "STORAGE_BUSY";
        error.statusCode = error.status = 503;
        throw error;
      }
    });
  }

  async commitStore(store, etag = null) {
    if (this.cloud) {
      const success = await this.writeCloud(store, etag);
      if (!success) {
        return false;
      }
    }

    await writeJsonAtomically(this.filePath, store);
    this._localRawSnapshot = null;

    try {
      this.lastMtimeMs = (await fs.stat(this.filePath)).mtimeMs;
    } catch {}

    if (this.redis?.isReady) {
      try {
        await this.redis.set(this.redisKey, JSON.stringify(store));
      } catch (err) {
        console.error("Redis user write error:", err?.message || err);
      }
    }

    // Cache updated only AFTER successful commit
    this.cache = store;
    return true;
  }

  async mutateUsers(mutator) {
    return this.withLock(async () => {
      const isCloud = this.cloud;
      const maxAttempts = isCloud ? 10 : 1;

      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const { store, etag } = await this.readAuthoritativeStore({ force: true });
        const storeCopy = JSON.parse(JSON.stringify(store));

        const mutatorOutput = await mutator(storeCopy);
        const nextStore = mutatorOutput?.store !== undefined ? mutatorOutput.store : storeCopy;
        const returnValue = mutatorOutput?.result !== undefined ? mutatorOutput.result : mutatorOutput;

        if (mutatorOutput?.modified === false) {
          return returnValue;
        }

        const committed = await this.commitStore(nextStore, etag);
        if (!committed) {
          // OCC conflict detected in cloud: back off with jitter and retry
          await new Promise((resolve) => setTimeout(resolve, 20 + Math.floor(Math.random() * 30) + attempt * 25));
          continue;
        }

        return returnValue;
      }

      const err = new Error("User storage concurrency conflict. Maximum retries exceeded.");
      err.code = "STORAGE_BUSY";
      err.statusCode = 503;
      throw err;
    });
  }

  enqueue(operation) {
    return this.withLock(operation);
  }

  extractUserById(store, id) {
    if (!id || !Array.isArray(store?.users)) return null;
    const found = store.users.find((item) => item.id === id) || null;
    return found ? structuredClone(migrateUser(found)) : null;
  }

  async findById(id, { force = false } = {}) {
    if (!id) return null;
    const store = await this.readStore({ force, clone: false, raw: true });
    return this.extractUserById(store, id);
  }

  async findByUsername(username) {
    const normalized = normalizeUsername(username).replace(/^@+/, "");
    if (!normalized) return null;
    const { users } = await this.readStore();
    return users.find((user) => normalizeUsername(user.username).replace(/^@+/, "") === normalized) || null;
  }

  async findByEmail(email) {
    const normalized = normalizeEmail(email);
    if (!normalized) return null;
    const { users } = await this.readStore();
    return users.find((user) => normalizeEmail(user.email) === normalized) || null;
  }

  async findByGoogleSub(googleSub) {
    const sub = String(googleSub || "").trim();
    if (!sub) return null;
    const { users } = await this.readStore();
    return users.find((user) => user.googleSub && String(user.googleSub).trim() === sub) || null;
  }

  async findByIdentifier(identifier) {
    const raw = String(identifier || "").trim();
    if (!raw) return null;
    if (raw.startsWith("@")) {
      return this.findByUsername(raw.slice(1));
    }
    if (raw.includes("@")) {
      const byEmail = await this.findByEmail(raw);
      if (byEmail) return byEmail;
    }
    return this.findByUsername(raw);
  }

  async findUniqueUsername(desiredUsername) {
    const clean = normalizeUsername(desiredUsername)
      .replace(/^@+/, "")
      .replace(/[^a-z0-9._]/g, "")
      .replace(/^[._]+|[._]+$/g, "");
    const base = clean.length >= 3 ? clean.slice(0, 24) : `user${Math.floor(1000 + Math.random() * 9000)}`;

    const { users } = await this.readStore();
    const existingSet = new Set(users.map((u) => normalizeUsername(u.username).replace(/^@+/, "")));

    if (!existingSet.has(base)) {
      return base;
    }

    let counter = 1;
    while (counter < 1000) {
      const candidate = `${base.slice(0, 24)}${counter}`;
      if (!existingSet.has(candidate)) {
        return candidate;
      }
      counter += 1;
    }
    return `${base.slice(0, 18)}_${Date.now().toString().slice(-6)}`;
  }

  create(payload) {
    return this.mutateUsers(async (store) => {
      const username = normalizeUsername(payload.username).replace(/^@+/, "");
      const email = normalizeEmail(payload.email);
      if (isReservedUsername(username) && !payload.allowReservedUsername) {
        throw new UserConflictError("username");
      }
      if (store.users.some((user) => normalizeUsername(user.username).replace(/^@+/, "") === username)) {
        throw new UserConflictError("username");
      }
      if (store.users.some((user) => (normalizeEmail(user.email) === email || (user.pendingEmailExpiresAt > Date.now() && normalizeEmail(user.pendingEmail) === email)))) {
        throw new UserConflictError("email");
      }
      if (payload.googleSub && store.users.some((user) => user.googleSub && String(user.googleSub).trim() === String(payload.googleSub).trim())) {
        throw new UserConflictError("googleSub");
      }
      const now = new Date().toISOString();
      const user = {
        id: `usr_${randomUUID()}`,
        fullName: payload.fullName.trim(),
        username,
        email,
        passwordHash: payload.passwordHash,
        avatarUrl: payload.avatarUrl || null,
        emailVerifiedAt: payload.emailVerifiedAt || null,
        googleSub: payload.googleSub || null,
        googleEmail: payload.googleEmail
          ? normalizeEmail(payload.googleEmail)
          : (payload.googleSub ? email : null),
        emailCustomisedAt: payload.emailCustomisedAt || null,
        onboardingFocus: payload.onboardingFocus || null,
        onboardingRole: payload.onboardingRole || null,
        onboardingGoal: payload.onboardingGoal || null,
        onboardingCompletedAt: payload.onboardingCompletedAt || null,
        settings: {
          personalIntelligence: false,
          modelImprovement: false,
          brandName: "",
          industry: "",
          targetAudience: "",
          primaryMarket: "",
          tone: "professional",
          customInstructions: "",
          memories: [],
          autoContext: true,
          strategyPersonalization: true,
          autoSaveStrategies: true,
          plannerNotifications: true,
          defaultMode: "build",
          language: "az",
        },
        authVersion: 1,
        privacyEpoch: 0,
        passwordChangedAt: now,
        lastLoginAt: now,
        createdAt: now,
        updatedAt: now,
      };
      store.users.push(user);
      return { store, result: user };
    });
  }

  update(id, changes, { allowSystemFields = false, preserveEmailVerification = false, expectedAuthVersion = null } = {}) {
    return this.mutateUsers(async (store) => {
      const index = store.users.findIndex((user) => user.id === id);
      if (index === -1) return { store, result: null, modified: false };

      const publicFields = ['fullName', 'username', 'email', 'avatarUrl', 'settings', 'lastLoginAt', 'onboardingFocus', 'onboardingRole', 'onboardingGoal', 'onboardingCompletedAt'];
      const internalFields = ['emailVerifiedAt', 'googleSub', 'googleEmail', 'emailCustomisedAt', 'pendingEmail', 'pendingEmailExpiresAt', 'authVersion', 'privacyEpoch', 'mfa', 'status', 'deletionRequestedAt', 'scheduledDeletionAt'];
      const fields = allowSystemFields ? [...publicFields, ...internalFields] : publicFields;
      const effectiveChanges = Object.fromEntries(fields.filter(key => changes[key] !== undefined).map(key => [key, changes[key]]));
      const current = store.users[index];
      if (expectedAuthVersion !== null && (current.authVersion || 1) !== expectedAuthVersion) throw Object.assign(new Error('Session changed'), { status: 401, code: 'SESSION_CHANGED' });
      const username = effectiveChanges.username
        ? normalizeUsername(effectiveChanges.username).replace(/^@+/, "")
        : normalizeUsername(current.username).replace(/^@+/, "");
      const email = effectiveChanges.email
        ? normalizeEmail(effectiveChanges.email)
        : normalizeEmail(current.email);

      if (store.users.some((user, i) => i !== index && normalizeUsername(user.username).replace(/^@+/, "") === username)) {
        throw new UserConflictError("username");
      }
      if (store.users.some((user, i) => i !== index && (normalizeEmail(user.email) === email || (user.pendingEmailExpiresAt > Date.now() && normalizeEmail(user.pendingEmail) === email)))) {
        throw new UserConflictError("email");
      }
      if (effectiveChanges.googleSub && store.users.some((user, i) => i !== index && user.googleSub && String(user.googleSub).trim() === String(effectiveChanges.googleSub).trim())) {
        throw new UserConflictError("googleSub");
      }

      if (effectiveChanges.email && email !== normalizeEmail(current.email)) {
        effectiveChanges.authVersion = (current.authVersion || 1) + 1;
        const isGoogleEmailSync = Boolean(
          allowSystemFields &&
          changes.googleEmail &&
          normalizeEmail(changes.googleEmail) === email
        );
        if (!isGoogleEmailSync && changes.emailCustomisedAt === undefined) {
          effectiveChanges.emailCustomisedAt = new Date().toISOString();
          if (current.googleSub && !current.googleEmail && !effectiveChanges.googleEmail) {
            effectiveChanges.googleEmail = normalizeEmail(current.email);
          }
        }
      }
      if (effectiveChanges.pendingEmail && store.users.some((user, i) => i !== index && (normalizeEmail(user.email) === normalizeEmail(effectiveChanges.pendingEmail) || (user.pendingEmailExpiresAt > Date.now() && normalizeEmail(user.pendingEmail) === normalizeEmail(effectiveChanges.pendingEmail))))) throw new UserConflictError('email');
      if (effectiveChanges.settings) {
        const settings = { ...(current.settings || {}), ...effectiveChanges.settings };
        if (settings.personalIntelligence === false) settings.modelImprovement = false;
        const contextFields = ['personalIntelligence', 'modelImprovement', 'memories', 'autoContext', 'strategyPersonalization', 'autoSaveStrategies', 'customInstructions', 'brandName', 'industry', 'primaryMarket', 'targetAudience'];
        if (contextFields.some(key => JSON.stringify(settings[key]) !== JSON.stringify(current.settings?.[key]))) {
          effectiveChanges.privacyEpoch = (current.privacyEpoch || 0) + 1;
        }
        effectiveChanges.settings = settings;
      }
      if ((effectiveChanges.status !== undefined && effectiveChanges.status !== current.status) ||
          (effectiveChanges.scheduledDeletionAt !== undefined && effectiveChanges.scheduledDeletionAt !== current.scheduledDeletionAt)) effectiveChanges.privacyEpoch = (current.privacyEpoch || 0) + 1;
      // SEC-08: If email is changed, reset emailVerifiedAt to null unless preserveEmailVerification is explicitly authorized
      let emailVerifiedAt = allowSystemFields && changes.emailVerifiedAt !== undefined
        ? changes.emailVerifiedAt
        : current.emailVerifiedAt;
      if (effectiveChanges.email && email !== normalizeEmail(current.email) && !(allowSystemFields && preserveEmailVerification)) {
        emailVerifiedAt = null;
      }

      store.users[index] = {
        ...current,
        ...effectiveChanges,
        id: current.id,
        createdAt: current.createdAt,
        passwordHash: current.passwordHash,
        username,
        email,
        emailVerifiedAt,
        updatedAt: new Date().toISOString(),
      };
      return { store, result: store.users[index] };
    });
  }

  confirmVerification(id, email, authVersion, purpose) {
    return this.mutateUsers(async store => {
      const user = store.users.find(item => item.id === id);
      if (!user || (user.authVersion || 1) !== authVersion) return { store, result: null };
      if (purpose === 'email-change') {
        if (user.pendingEmail !== email || user.pendingEmailExpiresAt <= Date.now()) return { store, result: null };
        if (store.users.some(item => item.id !== id && normalizeEmail(item.email) === email)) throw new UserConflictError('email');
        if (user.googleSub && !user.googleEmail) {
          user.googleEmail = normalizeEmail(user.email);
        }
        user.email = email;
        user.emailCustomisedAt = new Date().toISOString();
        user.pendingEmail = null;
        user.pendingEmailExpiresAt = null;
        user.authVersion = authVersion + 1;
      } else if (user.email !== email) return { store, result: null };
      user.emailVerifiedAt = new Date().toISOString();
      user.updatedAt = user.emailVerifiedAt;
      return { store, result: user };
    });
  }

  updatePassword(id, passwordHash, { expectedAuthVersion = null } = {}) {
    return this.mutateUsers(async (store) => {
      const index = store.users.findIndex((user) => user.id === id);
      if (index === -1) return { store, result: null };
      const currentVersion = store.users[index].authVersion || 1;
      if (expectedAuthVersion !== null && currentVersion !== expectedAuthVersion) {
        throw Object.assign(new Error("Session changed"), { status: 401, code: "SESSION_CHANGED" });
      }
      const now = new Date().toISOString();
      store.users[index].passwordHash = passwordHash;
      store.users[index].passwordChangedAt = now;
      store.users[index].authVersion = (store.users[index].authVersion || 1) + 1;
      store.users[index].updatedAt = now;
      return { store, result: store.users[index] };
    });
  }

  markLogin(id) {
    return this.update(id, { lastLoginAt: new Date().toISOString() });
  }

  scheduleDeletion(id, days = 14) {
    const now = new Date();
    const scheduled = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
    return this.update(id, {
      status: "pending_deletion",
      deletionRequestedAt: now.toISOString(),
      scheduledDeletionAt: scheduled.toISOString(),
    }, { allowSystemFields: true });
  }

  cancelDeletion(id) {
    return this.update(id, {
      status: "active",
      deletionRequestedAt: null,
      scheduledDeletionAt: null,
    }, { allowSystemFields: true });
  }

  /**
   * Atomically read-modify-write user.settings under TenantLockManager + R2 OCC
   * while preserving personalIntelligence/modelImprovement invariants and privacyEpoch.
   * @param {string} id
   * @param {(currentSettings: object, currentUser: object) => ({ settings: object, result?: any, modified?: boolean })} mutator
   * @returns {Promise<{ user: object | null, result?: any }>}
   */
  updateSettingsAtomically(id, mutator) {
    return this.mutateUsers(async (store) => {
      const index = store.users.findIndex((user) => user.id === id);
      if (index === -1) return { store, result: { user: null, result: null }, modified: false };

      const current = store.users[index];
      const currentSettings = current.settings && typeof current.settings === "object" ? structuredClone(current.settings) : {};
      const outcome = await mutator(currentSettings, current);
      if (!outcome || outcome.modified === false) {
        return { store, result: { user: current, result: outcome?.result ?? null }, modified: false };
      }

      const nextSettings = { ...currentSettings, ...(outcome.settings || {}) };
      if (nextSettings.personalIntelligence === false) nextSettings.modelImprovement = false;
      const contextFields = ['personalIntelligence', 'modelImprovement', 'memories', 'autoContext', 'strategyPersonalization', 'autoSaveStrategies', 'customInstructions', 'brandName', 'industry', 'primaryMarket', 'targetAudience'];
      let privacyEpoch = current.privacyEpoch || 0;
      if (contextFields.some((key) => JSON.stringify(nextSettings[key]) !== JSON.stringify(current.settings?.[key]))) {
        privacyEpoch += 1;
      }

      store.users[index] = {
        ...current,
        settings: nextSettings,
        privacyEpoch,
        updatedAt: new Date().toISOString(),
      };
      return { store, result: { user: store.users[index], result: outcome.result ?? null } };
    });
  }

  deleteUser(id, { strategyRepository = null, chatRepository = null, plannerRepository = null, upRepository = null, aiLearningRepository = null, telemetryRepository = null, authStore = null, cleanupQueue = null, researchJobStore = null } = {}) {
    return this.mutateUsers(async (store) => {
      const userExists = store.users.some((user) => user.id === id);
      if (!userExists) {
        return { store, result: false };
      }

      if (strategyRepository?.deleteAllByOwner) await strategyRepository.deleteAllByOwner(id);
      if (chatRepository?.deleteAllByOwner) await chatRepository.deleteAllByOwner(id);
      if (plannerRepository?.deleteAllByOwner) await plannerRepository.deleteAllByOwner(id);
      if (upRepository?.deleteAllByOwner) await upRepository.deleteAllByOwner(id);
      if (aiLearningRepository?.deleteAllByOwner) await aiLearningRepository.deleteAllByOwner(id);
      if (telemetryRepository?.deleteAllByOwner) await telemetryRepository.deleteAllByOwner(id);
      if (authStore?.invalidateUserSessions) await authStore.invalidateUserSessions(id);
      if (cleanupQueue?.enqueue) {
        await cleanupQueue.enqueue(id, id, "owner");
        if (typeof cleanupQueue.process === "function") await cleanupQueue.process().catch(() => {});
      } else if (researchJobStore?.jobsForOwner) {
        for await (const job of researchJobStore.jobsForOwner(id)) {
          await researchJobStore.mutateJob(job.id, id, () => ({ value: { id: job.id, ownerId: id, status: "deleted" } }));
          await researchJobStore.removeRetention?.(job);
          await researchJobStore.removeActive?.(job);
        }
      }

      store.users = store.users.filter((user) => user.id !== id);
      return { store, result: true };
    });
  }

  async purgeExpiredAccounts({ strategyRepository = null, chatRepository = null, plannerRepository = null, upRepository = null, aiLearningRepository = null, telemetryRepository = null, authStore = null, cleanupQueue = null, researchJobStore = null } = {}) {
    return this.mutateUsers(async (store) => {
      const now = new Date();
      const expiredUsers = store.users.filter((user) => {
        if (user.scheduledDeletionAt) {
          const sched = new Date(user.scheduledDeletionAt);
          if (!isNaN(sched.getTime()) && sched <= now) return true;
        }

        if (user.emailVerifiedAt) return false;
        const createdAt = new Date(user.createdAt);
        const unverifiedExpiry = now.getTime() - 24 * 60 * 60 * 1000;
        return !isNaN(createdAt.getTime()) && createdAt.getTime() <= unverifiedExpiry;
      });

      if (expiredUsers.length === 0) return { store, result: 0, modified: false };

      const expiredIds = new Set(expiredUsers.map((u) => u.id));
      const successfullyPurgedIds = new Set();

      for (const userId of expiredIds) {
        try {
          if (strategyRepository?.deleteAllByOwner) await strategyRepository.deleteAllByOwner(userId);
          if (chatRepository?.deleteAllByOwner) await chatRepository.deleteAllByOwner(userId);
          if (plannerRepository?.deleteAllByOwner) await plannerRepository.deleteAllByOwner(userId);
          if (upRepository?.deleteAllByOwner) await upRepository.deleteAllByOwner(userId);
          if (aiLearningRepository?.deleteAllByOwner) await aiLearningRepository.deleteAllByOwner(userId);
          if (telemetryRepository?.deleteAllByOwner) await telemetryRepository.deleteAllByOwner(userId);
          if (authStore?.invalidateUserSessions) await authStore.invalidateUserSessions(userId);
          if (cleanupQueue?.enqueue) {
            await cleanupQueue.enqueue(userId, userId, "owner");
            if (typeof cleanupQueue.process === "function") await cleanupQueue.process().catch(() => {});
          } else if (researchJobStore?.jobsForOwner) {
            for await (const job of researchJobStore.jobsForOwner(userId)) {
              await researchJobStore.mutateJob(job.id, userId, () => ({ value: { id: job.id, ownerId: userId, status: "deleted" } }));
              await researchJobStore.removeRetention?.(job);
              await researchJobStore.removeActive?.(job);
            }
          }
          successfullyPurgedIds.add(userId);
        } catch (err) {
          console.error(`Error cascading data deletion for expired user ${userId}:`, { name: err?.name, code: err?.code });
        }
      }

      store.users = store.users.filter((user) => !successfullyPurgedIds.has(user.id));
      return { store, result: successfullyPurgedIds.size };
    });
  }
}
