import { randomUUID } from "node:crypto";
import { requireAuth } from "./auth-middleware.js";

// Both ordinary Ask and capability runs share the guard, so two tabs cannot overwrite a chat.
// Separate per-chat admission from the platform capacity threshold.
export function createAskExecutionGuard({
  redis = null,
  allowGuest = false,
  allowParallelChats = false,
  hasActiveJobForOwner = () => false,
  maxConcurrent = Number.parseInt(process.env.ASK_MAX_CONCURRENT || "100", 10),
  matchesRequest = req => req.method === "POST" && req.path === "/",
} = {}) {
  const activeOwners = new Map();
  let activeCount = 0;
  const capacity = Number.isSafeInteger(maxConcurrent) && maxConcurrent > 0 ? maxConcurrent : 100;
  return async (req, res, next) => {
    if (!matchesRequest(req)) return next();
    if (!req.auth?.user?.emailVerifiedAt && !(allowGuest && !req.user && req.ownerId?.startsWith("guest_"))) return requireAuth(req, res, next);

    const shared = allowParallelChats && redis?.isReady && req.user && req.body?.mode !== "research";
    const rawChatId = req.body?.chatId;
    const chatId = typeof rawChatId === "string" && /^[0-9a-f-]{36}$/i.test(rawChatId) ? rawChatId.toLowerCase() : null;
    const target = shared ? chatId || Symbol("new chat") : null;
    const active = activeOwners.get(req.ownerId) || new Set();
    if (hasActiveJobForOwner(req.ownerId) || active.has(null) ||
        (shared ? active.has(target) : active.size > 0)) {
      return res.status(429).json({
        error: "Hazırda başqa tapşırıq icra olunur. Bir az sonra yenidən cəhd edin.",
        code: "EXECUTION_BUSY",
        retryable: true,
      });
    }

    // 2. Platform-wide safety backpressure ceiling (default: 100 concurrent tenants)
    if (activeCount >= capacity) {
      return res.status(429).json({
        error: "Server hazırda yüksək yüklənmə altındadır. Bir az sonra yenidən cəhd edin.",
        code: "EXECUTION_BUSY",
        retryable: true,
      });
    }

    if (process.env.NODE_ENV === 'production' && (process.env.REDIS_URL || process.env.REQUIRE_REDIS === 'true') && !redis?.isReady) return res.status(503).json({ code: 'EXECUTION_UNAVAILABLE' });
    const key = shared ? (chatId ? `helmer:ask-lock:${req.ownerId}:chat:${chatId}` : null) : `helmer:ask-lock:${req.ownerId}`;
    const token = randomUUID();
    active.add(target);
    activeOwners.set(req.ownerId, active);
    activeCount++;

    let locked = false;
    let heartbeat;
    let released = false;

    const release = async () => {
      if (released) return;
      released = true;
      clearInterval(heartbeat);
      active.delete(target);
      if (!active.size) activeOwners.delete(req.ownerId);
      activeCount--;
      if (locked && redis?.isReady) {
        await redis.eval(
          "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
          { keys: [key], arguments: [token] },
        ).catch(() => {});
      }
    };

    try {
      if (key && redis?.isReady) {
        locked = await redis.set(key, token, { NX: true, PX: 240000 });
        if (!locked) {
          await release();
          return res.status(429).json({
            error: "Başqa tapşırığın bitməsini gözləyin.",
            code: "EXECUTION_BUSY",
            retryable: true,
          });
        }
      }
      if (locked) {
        heartbeat = setInterval(async () => {
          try {
            const owned = await redis.eval("if redis.call('get',KEYS[1]) ~= ARGV[1] then return 0 end; return redis.call('pexpire',KEYS[1],240000)", { keys: [key], arguments: [token] });
            if (!owned) req.securityContext?.controller?.abort(new Error('Execution lease lost'));
          } catch { req.securityContext?.controller?.abort(new Error('Execution lease unavailable')); }
        }, 30000); heartbeat.unref();
      }
      res.once("finish", release);
      res.once("close", release);
      if (req.aborted || res.destroyed || res.writableEnded) return release();
      return next();
    } catch {
      await release();
      return res.status(503).json({
        error: "Tapşırığı başlatmaq mümkün olmadı.",
        code: "EXECUTION_UNAVAILABLE",
        retryable: true,
      });
    }
  };
}
