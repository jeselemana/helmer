import { resolveAskModelRoute } from './ask-routing.js';
import { createHash } from "node:crypto";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LOCAL_CANCEL_TOMBSTONE_TTL_MS = 30 * 1000;
const FAILED_RUN_TTL_SECONDS = 120;

function hashIdempotencyKey(value) {
  if (!value || typeof value !== "string") return "";
  return createHash("sha256").update(value.trim()).digest("hex");
}

function sanitizeRunMetadata(record) {
  if (!record || typeof record !== "object") return null;
  return {
    runId: record.runId,
    chatId: record.chatId || null,
    status: record.status || "running",
    model: record.model || resolveAskModelRoute(),
    promptPreview: "",
    startedAt: record.startedAt,
  };
}

function sanitizeFailedRunMetadata(record) {
  if (!record || typeof record !== "object") return null;
  return {
    runId: record.runId || null,
    chatId: record.chatId || null,
    status: "failed",
    code: typeof record.code === "string" && record.code ? record.code : "ASK_ERROR",
    error: typeof record.error === "string" && record.error ? record.error : "Sorğunu tamamlamaq mümkün olmadı.",
    promptPreview: "",
    failedAt: record.failedAt || null,
  };
}

async function safeRedisSet(redis, key, value, ttlSeconds) {
  if (!redis?.isReady || typeof redis.set !== "function") return;
  try {
    await redis.set(key, value, { EX: Math.max(10, Math.ceil(ttlSeconds)) });
  } catch {
    // Non-fatal: in-process tracking still handles the active replica
  }
}

async function safeRedisGet(redis, key) {
  if (!redis?.isReady || typeof redis.get !== "function") return null;
  try {
    return await redis.get(key);
  } catch {
    return null;
  }
}

async function safeRedisDel(redis, key) {
  if (!redis?.isReady || !key || typeof redis.del !== "function") return;
  try {
    await redis.del(key);
  } catch {
    // Best-effort cleanup; TTL bounds lifetime
  }
}

async function safeRedisDelIfEqual(redis, key, expectedValue) {
  if (!redis?.isReady || !key || expectedValue === undefined || expectedValue === null) return;
  try {
    if (typeof redis.eval === "function") {
      await redis.eval(
        "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
        { keys: [key], arguments: [expectedValue] }
      );
      return;
    }
    if (typeof redis.del === "function") {
      const current = await redis.get?.(key);
      if (current === expectedValue) await redis.del(key);
    }
  } catch {
    // Best-effort cleanup; TTL bounds lifetime
  }
}

export function createAskRunManager({ redis = null, cancelPollIntervalMs = 500 } = {}) {
  const runsById = new Map();
  const recentCancels = new Map(); // key -> { ts: number, expiresAt: number }
  const failedRunsByChat = new Map(); // `${ownerId}:${chatId}` -> { record, expiresAt }

  const keyTag = (ownerId) => `{helmer:ask:${ownerId}}`;
  const activeRunKey = (ownerId, runId) => `${keyTag(ownerId)}:run:${runId}`;
  const activeChatKey = (ownerId, chatId) => `${keyTag(ownerId)}:active-chat:${chatId}`;
  const latestRunKey = (ownerId) => `${keyTag(ownerId)}:latest-run`;
  const cancelRunKey = (ownerId, runId) => `${keyTag(ownerId)}:cancel:${runId}`;
  const cancelChatKey = (ownerId, chatId) => `${keyTag(ownerId)}:cancel-chat:${chatId}`;
  const cancelIdemKey = (ownerId, idemHash) => `${keyTag(ownerId)}:cancel-idem:${idemHash}`;
  const failedChatKey = (ownerId, chatId) => `${keyTag(ownerId)}:failed-chat:${chatId}`;

  const pruneRecentCancels = (now = Date.now()) => {
    for (const [k, entry] of recentCancels.entries()) {
      if (!entry || entry.expiresAt <= now) recentCancels.delete(k);
    }
  };

  const pruneFailedRuns = (now = Date.now()) => {
    for (const [k, entry] of failedRunsByChat.entries()) {
      if (!entry || entry.expiresAt <= now) failedRunsByChat.delete(k);
    }
  };

  const recordLocalCancel = (key, ts = Date.now()) => {
    pruneRecentCancels(ts);
    recentCancels.set(key, { ts, expiresAt: ts + LOCAL_CANCEL_TOMBSTONE_TTL_MS });
  };

  const hasCancelSignal = async ({ ownerId, runId, chatId, idemHash, requestStartedAt }) => {
    const now = Date.now();
    pruneRecentCancels(now);

    const runCancelKey = runId ? cancelRunKey(ownerId, runId) : null;
    const idemCancelKey = idemHash ? cancelIdemKey(ownerId, idemHash) : null;
    const chatCancelKey = chatId ? cancelChatKey(ownerId, chatId) : null;

    if (runCancelKey && recentCancels.has(runCancelKey)) return true;
    if (idemCancelKey && recentCancels.has(idemCancelKey)) return true;
    if (chatCancelKey) {
      const chatEntry = recentCancels.get(chatCancelKey);
      if (chatEntry && chatEntry.ts >= requestStartedAt) return true;
    }

    if (!redis?.isReady) return false;

    const checks = [];
    if (runCancelKey) checks.push({ type: "exact", promise: safeRedisGet(redis, runCancelKey) });
    if (idemCancelKey) checks.push({ type: "exact", promise: safeRedisGet(redis, idemCancelKey) });
    if (chatCancelKey) checks.push({ type: "ts", promise: safeRedisGet(redis, chatCancelKey) });
    if (!checks.length) return false;

    const results = await Promise.all(checks.map((c) => c.promise));
    for (let i = 0; i < checks.length; i += 1) {
      const raw = results[i];
      if (!raw) continue;
      if (checks[i].type === "exact") return true;
      try {
        const parsed = JSON.parse(raw);
        if (parsed && Number(parsed.ts) >= requestStartedAt) return true;
      } catch {
        // Legacy or malformed timestamp marker: only ignore stale markers
      }
    }
    return false;
  };

  return {
    async registerRun({
      runId,
      ownerId,
      chatId = null,
      idempotencyKey = "",
      model = resolveAskModelRoute(),
      requestTimeoutMs = 180000,
      requestStartedAt = Date.now(),
      onCancel = null,
    }) {
      if (!ownerId || !runId || !UUID_RE.test(runId)) {
        throw Object.assign(new Error("Invalid run registration"), { code: "VALIDATION_ERROR", status: 400 });
      }
      const normalizedChatId = chatId && UUID_RE.test(chatId) ? chatId.toLowerCase() : null;
      const idemHash = hashIdempotencyKey(idempotencyKey);

      const runCancel = cancelRunKey(ownerId, runId);
      const idemCancel = idemHash ? cancelIdemKey(ownerId, idemHash) : null;
      const chatCancel = normalizedChatId ? cancelChatKey(ownerId, normalizedChatId) : null;
      const supportsAtomicLua = Boolean(
        redis?.isReady &&
        typeof redis.eval === "function" &&
        (typeof redis.sendCommand === "function" || redis.supportsAtomicLua === true)
      );

      let localCancelled = Boolean(recentCancels.has(runCancel) || (idemCancel && recentCancels.has(idemCancel)));
      if (!localCancelled && chatCancel) {
        const chatEntry = recentCancels.get(chatCancel);
        if (chatEntry && chatEntry.ts >= requestStartedAt) localCancelled = true;
      }
      if (localCancelled) {
        onCancel?.();
        return { runId, chatId: normalizedChatId, alreadyCancelled: true, checkCancelled: async () => true, finish: async () => {} };
      }

      const ttlSeconds = Math.ceil((Number(requestTimeoutMs) || 180000) / 1000) + 60;
      const effectiveTtl = Math.max(10, Math.ceil(ttlSeconds));
      const metadata = {
        runId,
        ownerId,
        chatId: normalizedChatId,
        status: "running",
        model: String(model || resolveAskModelRoute()).slice(0, 100),
        startedAt: new Date(requestStartedAt).toISOString(),
      };
      const serialized = JSON.stringify(metadata);

      if (normalizedChatId) {
        failedRunsByChat.delete(`${ownerId}:${normalizedChatId}`);
      }

      let luaRegistered = false;
      if (supportsAtomicLua) {
        try {
          const exactCancelKeys = [runCancel, ...(idemCancel ? [idemCancel] : [])];
          const chatCancelKeys = chatCancel ? [chatCancel] : [];
          const writeKeys = [
            activeRunKey(ownerId, runId),
            latestRunKey(ownerId),
            ...(normalizedChatId ? [activeChatKey(ownerId, normalizedChatId)] : []),
          ];
          const clearKeys = normalizedChatId ? [failedChatKey(ownerId, normalizedChatId)] : [];
          const keys = [...exactCancelKeys, ...chatCancelKeys, ...writeKeys, ...clearKeys];
          const registered = await redis.eval(`
            local exactCount = tonumber(ARGV[4])
            local chatCount = tonumber(ARGV[5])
            local writeCount = tonumber(ARGV[6])
            local clearCount = tonumber(ARGV[7])
            local idx = 1
            for i = 1, exactCount do
              if redis.call('get', KEYS[idx]) then return 0 end
              idx = idx + 1
            end
            for i = 1, chatCount do
              local raw = redis.call('get', KEYS[idx])
              if raw then
                local ts = tonumber(string.match(raw, '"ts"%s*:%s*(%d+)'))
                if ts and ts >= tonumber(ARGV[1]) then return 0 end
              end
              idx = idx + 1
            end
            for i = 1, writeCount do
              redis.call('set', KEYS[idx], ARGV[2], 'EX', tonumber(ARGV[3]))
              idx = idx + 1
            end
            for i = 1, clearCount do
              redis.call('del', KEYS[idx])
              idx = idx + 1
            end
            return 1
          `, {
            keys,
            arguments: [
              String(requestStartedAt),
              serialized,
              String(effectiveTtl),
              String(exactCancelKeys.length),
              String(chatCancelKeys.length),
              String(writeKeys.length),
              String(clearKeys.length),
            ],
          });
          if (registered === 0) {
            onCancel?.();
            return { runId, chatId: normalizedChatId, alreadyCancelled: true, checkCancelled: async () => true, finish: async () => {} };
          }
          if (registered === 1) {
            luaRegistered = true;
          }
        } catch (err) {
          console.warn("AskRunManager Lua registration fallback:", { code: err?.code });
        }
      }
      if (!luaRegistered && await hasCancelSignal({
        ownerId,
        runId,
        chatId: normalizedChatId,
        idemHash,
        requestStartedAt,
      })) {
        onCancel?.();
        return { runId, chatId: normalizedChatId, alreadyCancelled: true, checkCancelled: async () => true, finish: async () => {} };
      }

      let resolveDone;
      const donePromise = new Promise((resolve) => {
        resolveDone = resolve;
      });
      let finished = false;
      let cancelTriggered = false;
      let pollTimer = null;

      const triggerCancel = () => {
        if (cancelTriggered || finished) return;
        cancelTriggered = true;
        clearInterval(pollTimer);
        pollTimer = null;
        try {
          onCancel?.();
        } catch {}
      };

      const entry = {
        ...metadata,
        idemHash,
        requestStartedAt,
        onCancel: triggerCancel,
        stopPoll: () => {
          clearInterval(pollTimer);
          pollTimer = null;
        },
        donePromise,
      };
      runsById.set(runId, entry);

      if (!luaRegistered) {
        const writes = [
          safeRedisSet(redis, activeRunKey(ownerId, runId), serialized, ttlSeconds),
          safeRedisSet(redis, latestRunKey(ownerId), serialized, ttlSeconds),
        ];
        if (normalizedChatId) {
          writes.push(safeRedisSet(redis, activeChatKey(ownerId, normalizedChatId), serialized, ttlSeconds));
          writes.push(safeRedisDel(redis, failedChatKey(ownerId, normalizedChatId)));
        }
        await Promise.all(writes);
      }

      if (redis?.isReady && cancelPollIntervalMs > 0) {
        let polling = false;
        pollTimer = setInterval(async () => {
          if (polling || finished || cancelTriggered) return;
          polling = true;
          try {
            const cancelled = await hasCancelSignal({
              ownerId,
              runId,
              chatId: normalizedChatId,
              idemHash,
              requestStartedAt,
            });
            if (cancelled) triggerCancel();
          } finally {
            polling = false;
          }
        }, cancelPollIntervalMs);
        pollTimer.unref?.();
      }

      const finish = async (outcome = {}) => {
        if (finished) return;
        finished = true;
        clearInterval(pollTimer);
        pollTimer = null;
        runsById.delete(runId);

        const ops = [
          safeRedisDelIfEqual(redis, activeRunKey(ownerId, runId), serialized),
          safeRedisDelIfEqual(redis, latestRunKey(ownerId), serialized),
        ];
        if (normalizedChatId) {
          ops.push(safeRedisDelIfEqual(redis, activeChatKey(ownerId, normalizedChatId), serialized));
          const errorInfo = outcome?.error;
          if (errorInfo && !cancelTriggered) {
            const failRecord = {
              runId,
              ownerId,
              chatId: normalizedChatId,
              status: "failed",
              code: typeof errorInfo.code === "string" && errorInfo.code.trim() ? errorInfo.code.trim().slice(0, 64) : "ASK_ERROR",
              error: typeof errorInfo.error === "string" && errorInfo.error.trim()
                ? errorInfo.error.trim().slice(0, 500)
                : "Sorğunu tamamlamaq mümkün olmadı.",
              failedAt: new Date().toISOString(),
            };
            pruneFailedRuns();
            failedRunsByChat.set(`${ownerId}:${normalizedChatId}`, {
              record: failRecord,
              expiresAt: Date.now() + FAILED_RUN_TTL_SECONDS * 1000,
            });
            ops.push(safeRedisSet(redis, failedChatKey(ownerId, normalizedChatId), JSON.stringify(failRecord), FAILED_RUN_TTL_SECONDS));
          } else {
            failedRunsByChat.delete(`${ownerId}:${normalizedChatId}`);
            ops.push(safeRedisDel(redis, failedChatKey(ownerId, normalizedChatId)));
          }
        }
        await Promise.all(ops);
        resolveDone();
      };

      return {
        runId,
        chatId: normalizedChatId,
        alreadyCancelled: false,
        checkCancelled: async () => {
          if (cancelTriggered) return true;
          const cancelled = await hasCancelSignal({
            ownerId,
            runId,
            chatId: normalizedChatId,
            idemHash,
            requestStartedAt,
          });
          if (cancelled) triggerCancel();
          return cancelled;
        },
        finish,
      };
    },

    async cancelRun(ownerId, { runId = null, chatId = null, idempotencyKey = null } = {}) {
      if (!ownerId) return { cancelled: false };
      const normalizedRunId = runId && UUID_RE.test(runId) ? runId.toLowerCase() : null;
      const normalizedChatId = chatId && UUID_RE.test(chatId) ? chatId.toLowerCase() : null;
      const idemHash = hashIdempotencyKey(idempotencyKey);
      const cancelTs = Date.now();
      const cancelMarker = JSON.stringify({ ts: cancelTs, cancelled: true });

      const redisWrites = [];
      if (normalizedRunId) {
        const key = cancelRunKey(ownerId, normalizedRunId);
        recordLocalCancel(key, cancelTs);
        redisWrites.push(safeRedisSet(redis, key, cancelMarker, 180));
      }
      if (normalizedChatId && !normalizedRunId && !idemHash) {
        const key = cancelChatKey(ownerId, normalizedChatId);
        recordLocalCancel(key, cancelTs);
        redisWrites.push(safeRedisSet(redis, key, cancelMarker, 180));
      }
      if (idemHash) {
        const key = cancelIdemKey(ownerId, idemHash);
        recordLocalCancel(key, cancelTs);
        redisWrites.push(safeRedisSet(redis, key, cancelMarker, 180));
      }

      const matchingEntries = [];
      for (const entry of runsById.values()) {
        if (entry.ownerId !== ownerId) continue;
        const matches =
          (normalizedRunId && entry.runId.toLowerCase() === normalizedRunId) ||
          (normalizedChatId && entry.chatId && entry.chatId.toLowerCase() === normalizedChatId) ||
          (idemHash && entry.idemHash && entry.idemHash === idemHash);
        if (matches) matchingEntries.push(entry);
      }

      for (const entry of matchingEntries) {
        entry.onCancel?.();
      }

      await Promise.all(redisWrites);

      if (matchingEntries.length > 0) {
        await Promise.race([
          Promise.allSettled(matchingEntries.map((entry) => entry.donePromise)),
          new Promise((resolve) => setTimeout(resolve, 600)),
        ]);
        return { cancelled: true };
      }

      // Check Redis to see if another replica owns an active run for this owner/chat/run
      const remoteChecks = [];
      if (normalizedRunId) remoteChecks.push(safeRedisGet(redis, activeRunKey(ownerId, normalizedRunId)));
      if (normalizedChatId) remoteChecks.push(safeRedisGet(redis, activeChatKey(ownerId, normalizedChatId)));
      const remoteValues = remoteChecks.length ? await Promise.all(remoteChecks) : [];
      const remoteMatched = remoteValues.some((raw) => {
        if (!raw) return false;
        try {
          return JSON.parse(raw)?.ownerId === ownerId;
        } catch {
          return false;
        }
      });

      return { cancelled: remoteMatched || Boolean(normalizedRunId || normalizedChatId || idemHash) };
    },

    async getActiveRunForChat(ownerId, chatId) {
      if (!ownerId || !chatId || !UUID_RE.test(chatId)) return null;
      const normalizedChatId = chatId.toLowerCase();

      for (const entry of runsById.values()) {
        if (entry.ownerId === ownerId && entry.chatId && entry.chatId.toLowerCase() === normalizedChatId) {
          return sanitizeRunMetadata(entry);
        }
      }

      const raw = await safeRedisGet(redis, activeChatKey(ownerId, normalizedChatId));
      if (!raw) return null;
      try {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.ownerId === ownerId && String(parsed.chatId || "").toLowerCase() === normalizedChatId) {
          return sanitizeRunMetadata(parsed);
        }
      } catch {}
      return null;
    },

    async getLastRunErrorForChat(ownerId, chatId) {
      if (!ownerId || !chatId || !UUID_RE.test(chatId)) return null;
      const normalizedChatId = chatId.toLowerCase();
      pruneFailedRuns();
      const localKey = `${ownerId}:${normalizedChatId}`;
      const local = failedRunsByChat.get(localKey);

      if (redis?.isReady && typeof redis.get === "function") {
        try {
          const raw = await redis.get(failedChatKey(ownerId, normalizedChatId));
          if (!raw) {
            failedRunsByChat.delete(localKey);
            return null;
          }
          const parsed = JSON.parse(raw);
          if (parsed && parsed.ownerId === ownerId && String(parsed.chatId || "").toLowerCase() === normalizedChatId) {
            return sanitizeFailedRunMetadata(parsed);
          }
          return null;
        } catch {
          // Fall back to local failed-run cache if Redis read transiently fails
        }
      }

      if (local && local.record?.ownerId === ownerId && String(local.record?.chatId || "").toLowerCase() === normalizedChatId) {
        return sanitizeFailedRunMetadata(local.record);
      }
      return null;
    },

    async listActiveRuns(ownerId) {
      if (!ownerId) return [];
      const result = new Map();
      for (const entry of runsById.values()) {
        if (entry.ownerId === ownerId) {
          result.set(entry.runId, sanitizeRunMetadata(entry));
        }
      }
      const rawLatest = await safeRedisGet(redis, latestRunKey(ownerId));
      if (rawLatest) {
        try {
          const parsed = JSON.parse(rawLatest);
          if (parsed && parsed.ownerId === ownerId && parsed.runId && !result.has(parsed.runId)) {
            result.set(parsed.runId, sanitizeRunMetadata(parsed));
          }
        } catch {}
      }
      return [...result.values()];
    },

    dispose() {
      for (const entry of runsById.values()) {
        try {
          entry.stopPoll?.();
        } catch {}
        try {
          entry.onCancel?.();
        } catch {}
      }
      runsById.clear();
      recentCancels.clear();
      failedRunsByChat.clear();
    },
  };
}
