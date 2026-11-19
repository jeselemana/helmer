import { createHash } from "node:crypto";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LOCAL_CANCEL_TOMBSTONE_TTL_MS = 30 * 1000;

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
    model: record.model || "gemini-4-hydrogen",
    promptPreview: typeof record.promptPreview === "string" ? record.promptPreview : "",
    startedAt: record.startedAt,
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

  const activeRunKey = (ownerId, runId) => `helmer:ask:run:${ownerId}:${runId}`;
  const activeChatKey = (ownerId, chatId) => `helmer:ask:active-chat:${ownerId}:${chatId}`;
  const latestRunKey = (ownerId) => `helmer:ask:latest-run:${ownerId}`;
  const cancelRunKey = (ownerId, runId) => `helmer:ask:cancel:${ownerId}:${runId}`;
  const cancelChatKey = (ownerId, chatId) => `helmer:ask:cancel-chat:${ownerId}:${chatId}`;
  const cancelIdemKey = (ownerId, idemHash) => `helmer:ask:cancel-idem:${ownerId}:${idemHash}`;

  const pruneRecentCancels = (now = Date.now()) => {
    for (const [k, entry] of recentCancels.entries()) {
      if (!entry || entry.expiresAt <= now) recentCancels.delete(k);
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
      prompt = "",
      model = "gemini-4-hydrogen",
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
        model: String(model || "gemini-4-hydrogen").slice(0, 100),
        promptPreview: String(prompt || "").trim().slice(0, 2000),
        startedAt: new Date(requestStartedAt).toISOString(),
      };
      const serialized = JSON.stringify(metadata);

      if (supportsAtomicLua) {
        try {
          const keys = [
            runCancel,
            idemCancel || "",
            chatCancel || "",
            activeRunKey(ownerId, runId),
            latestRunKey(ownerId),
            ...(normalizedChatId ? [activeChatKey(ownerId, normalizedChatId)] : []),
          ];
          const registered = await redis.eval(`
            if redis.call('get', KEYS[1]) then return 0 end
            if KEYS[2] ~= '' and redis.call('get', KEYS[2]) then return 0 end
            if KEYS[3] ~= '' then
              local raw = redis.call('get', KEYS[3])
              if raw then
                local ts = tonumber(string.match(raw, '"ts"%s*:%s*(%d+)'))
                if ts and ts >= tonumber(ARGV[1]) then return 0 end
              end
            end
            redis.call('set', KEYS[4], ARGV[2], 'EX', tonumber(ARGV[3]))
            redis.call('set', KEYS[5], ARGV[2], 'EX', tonumber(ARGV[3]))
            if KEYS[6] then
              redis.call('set', KEYS[6], ARGV[2], 'EX', tonumber(ARGV[3]))
            end
            return 1
          `, {
            keys,
            arguments: [String(requestStartedAt), serialized, String(effectiveTtl)],
          });
          if (registered === 0) {
            onCancel?.();
            return { runId, chatId: normalizedChatId, alreadyCancelled: true, checkCancelled: async () => true, finish: async () => {} };
          }
        } catch {
          // Non-fatal: in-process tracking still handles the active replica
        }
      } else if (await hasCancelSignal({
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

      if (!supportsAtomicLua) {
        const writes = [
          safeRedisSet(redis, activeRunKey(ownerId, runId), serialized, ttlSeconds),
          safeRedisSet(redis, latestRunKey(ownerId), serialized, ttlSeconds),
        ];
        if (normalizedChatId) {
          writes.push(safeRedisSet(redis, activeChatKey(ownerId, normalizedChatId), serialized, ttlSeconds));
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

      const finish = async () => {
        if (finished) return;
        finished = true;
        clearInterval(pollTimer);
        pollTimer = null;
        runsById.delete(runId);

        const deletes = [
          safeRedisDelIfEqual(redis, activeRunKey(ownerId, runId), serialized),
          safeRedisDelIfEqual(redis, latestRunKey(ownerId), serialized),
        ];
        if (normalizedChatId) {
          deletes.push(safeRedisDelIfEqual(redis, activeChatKey(ownerId, normalizedChatId), serialized));
        }
        await Promise.all(deletes);
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
    },
  };
}
