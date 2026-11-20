import { researchUnavailable } from '../services/ai/research-availability.js';
import express from "express";
import { randomUUID } from "node:crypto";
import { z } from 'zod';
import { CreateResearchJobSchema } from "../services/ai/research-service.js";
import { hasGeminiConfiguration } from "../services/ai/config.js";
import { requireAuth } from "./auth-middleware.js";

const MAX_STREAM_BYTES = 1024 * 1024;
const MAX_STREAMS = 64;
const MAX_STREAMS_PER_OWNER = 3;
const MAX_STREAM_DURATION_MS = 11 * 60 * 1000;

export function createResearchRouter({ researchService, chatRepository, strategyRepository = null, plannerRepository = null, authStore, redis = null, rateLimit = null, readRateLimit = null }) {
  const router = express.Router();
  router.use(requireAuth);

  const ipRateLimit = rateLimit || ((req, res, next) => next());
  const readLimit = readRateLimit || ((req, res, next) => next());
  const ownerStreams = new Map();
  let streamCount = 0;
  router.use((_req, res, next) => {
    res.setHeader("Cache-Control", "private, no-store");
    next();
  });

  // POST /api/ask/research — Create background research job
  router.post("/", ipRateLimit, async (req, res) => {
    try {
      const parsed = CreateResearchJobSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: "Sorğu parametrləri düzgün deyil.",
          code: "VALIDATION_ERROR",
        });
      }

      if (researchService.enabled === false) {
        const error = researchUnavailable();
        return res.status(error.status).json({ code: error.code, error: error.message });
      }
      if (!hasGeminiConfiguration() && !researchService.geminiClient) {
        return res.status(503).json({
          code: "GEMINI_NOT_CONFIGURED",
          error: "Gemini xidməti konfiqurasiya edilməyib. Zəhmət olmasa GEMINI_API_KEY əlavə edin.",
        });
      }

      const prompt = parsed.data.prompt || parsed.data.query;
      const { chatId, strategyId, briefId, taskId, language, googleSearchEnabled } = parsed.data;

      if (chatId) {
        const existingChat = await chatRepository.getById(chatId, req.ownerId);
        if (!existingChat) {
          return res.status(404).json({
            error: "Söhbət tapılmadı və ya sizə aid deyil.",
            code: "NOT_FOUND",
          });
        }
      }

      const findPlannerTask = (id, options = {}) => {
        if (!id || !plannerRepository) return Promise.resolve(null);
        if (typeof plannerRepository.getById === "function") {
          return plannerRepository.getById(id, req.ownerId, options);
        }
        return plannerRepository.list(req.ownerId, options).then((list) => list.find((task) => task.id === id) || null);
      };

      if (req.securityContext) {
        req.securityContext.assertResources = async () => {
          const [authorizedChat, authorizedStrategy, authorizedBrief, authorizedTask] = await Promise.all([
            chatId && chatRepository ? chatRepository.getById(chatId, req.ownerId, { coalesce: false }) : null,
            strategyId && strategyRepository ? strategyRepository.getById(strategyId, req.ownerId, { coalesce: false }) : null,
            briefId && strategyRepository ? strategyRepository.getById(briefId, req.ownerId, { coalesce: false }) : null,
            taskId && plannerRepository ? findPlannerTask(taskId, { coalesce: false }) : null,
          ]);
          if (
            (chatId && chatRepository && !authorizedChat) ||
            (strategyId && strategyRepository && !authorizedStrategy) ||
            (briefId && strategyRepository && !authorizedBrief) ||
            (taskId && plannerRepository && !authorizedTask)
          ) {
            throw Object.assign(new Error("Execution context removed"), { code: "EXECUTION_REVOKED", status: 403 });
          }
        };
      }

      let clientClosed = false;
      res.on("close", () => {
        if (!res.writableEnded) {
          clientClosed = true;
        }
      });

      const result = await researchService.createResearchJob({
        ownerId: req.ownerId,
        prompt,
        chatId,
        strategyId,
        briefId,
        taskId,
        language: language || (req.headers["accept-language"]?.includes("en") ? "en" : "az"),
        googleSearchEnabled: googleSearchEnabled !== false,
        user: req.user,
      });

      if (clientClosed && result?.jobId) {
        await researchService.cancelJob(result.jobId, req.ownerId).catch(() => {});
        return;
      }

      const acceptedPayload = { ...result, status: "pending" };
      req.securityContext?.recordIdempotentResult?.(202, acceptedPayload);
      await req.securityContext?.persistIdempotentResult?.();
      return res.status(202).json(acceptedPayload);
    } catch (error) {
      if (error?.code === "PROVENANCE_UNAVAILABLE") {
        return res.status(503).json({ code: error.code, error: "Mənbə mənşəyini yoxlamaq mümkün olmadı." });
      }
      if (error?.code === "VALIDATION_ERROR" || error?.status === 400) {
        return res.status(400).json({
          error: "Sorğu parametrləri düzgün deyil.",
          code: "VALIDATION_ERROR",
        });
      }
      if (error?.code === "GROUNDED_STRATEGY_RESTRICTED" || error?.status === 422) {
        return res.status(422).json({
          error: "Veb araşdırması olan konteksti Deep Research-ə ötürmək mümkün deyil.",
          code: "GROUNDED_STRATEGY_RESTRICTED",
        });
      }
      if (error?.code === "EXECUTION_REVOKED" || error?.status === 403) {
        return res.status(403).json({
          error: "Seçilmiş kontekstə giriş icazəsi ləğv edilib.",
          code: "EXECUTION_REVOKED",
        });
      }
      if (error?.code === "NOT_FOUND" || error?.status === 404) {
        return res.status(404).json({
          error: "Seçilmiş kontekst tapılmadı.",
          code: "NOT_FOUND",
        });
      }
      if (error?.code === "EXECUTION_BUSY" || error?.status === 429) {
        return res.status(429).json({
          error: "Hazırda aktiv araşdırma sorğunuz icra olunur. Zəhmət olmasa tamamlanmasını gözləyin.",
          code: "EXECUTION_BUSY",
        });
      }
      console.error("[Research Router] Error creating research job:", { name: error?.name, code: error?.code });
      return res.status(500).json({
        error: "Araşdırma işini başlatmaq mümkün olmadı.",
        code: "INTERNAL_ERROR",
      });
    }
  });

  // GET /api/ask/research/jobs/:jobId — Check status & fetch current report
  router.get("/jobs/:jobId", readLimit, async (req, res) => {
    const { jobId } = req.params;
    if (!/^[0-9a-f-]{36}$/i.test(jobId)) {
      return res.status(400).json({
        error: "İş ID-si düzgün formatda deyil.",
        code: "VALIDATION_ERROR",
      });
    }

    try {
      const job = await researchService.getJob(jobId, req.ownerId);
      if (!job) {
        return res.status(404).json({
          error: "Araşdırma işi tapılmadı.",
          code: "NOT_FOUND",
        });
      }

      return res.json({ id: job.id, status: job.status, ...job, job });
    } catch (error) {
      console.error("[Research Router] Error fetching job:", { name: error?.name, code: error?.code });
      return res.status(500).json({
        error: "Araşdırma məlumatını əldə etmək mümkün olmadı.",
        code: "INTERNAL_ERROR",
      });
    }
  });

  // GET /api/ask/research/jobs/:jobId/stream — Real-time SSE stream for job progress
  router.get("/jobs/:jobId/stream", readLimit, async (req, res) => {
    const { jobId } = req.params;
    if (!/^[0-9a-f-]{36}$/i.test(jobId)) {
      return res.status(400).json({
        error: "İş ID-si düzgün formatda deyil.",
        code: "VALIDATION_ERROR",
      });
    }

    const ownerId = req.ownerId;
    const streamToken = randomUUID();
    const globalSlotsKey = "helmer:research:sse-slots";
    const ownerSlotsKey = `helmer:research:sse-owner:${ownerId}`;
    let redisSseAcquired = false;
    let disconnected = res.destroyed || req.aborted;
    const markDisconnected = () => { disconnected = true; };
    const releaseRedisSlot = () => redisSseAcquired ? Promise.all([
      redis.zRem(globalSlotsKey, streamToken).catch(() => {}),
      redis.zRem(ownerSlotsKey, streamToken).catch(() => {}),
    ]) : Promise.resolve();
    if (disconnected) return;
    res.once("close", markDisconnected);
    if (redis?.isReady && typeof redis.eval === "function" && typeof redis.zRem === "function") {
      try {
        const now = Date.now();
        const admitted = await redis.eval(
          "redis.call('zremrangebyscore', KEYS[1], '-inf', ARGV[1]); redis.call('zremrangebyscore', KEYS[2], '-inf', ARGV[1]); if redis.call('zcard', KEYS[1]) >= tonumber(ARGV[2]) or redis.call('zcard', KEYS[2]) >= tonumber(ARGV[3]) then return 0 end; redis.call('zadd', KEYS[1], ARGV[4], ARGV[5]); redis.call('zadd', KEYS[2], ARGV[4], ARGV[5]); redis.call('pexpire', KEYS[1], ARGV[6]); redis.call('pexpire', KEYS[2], ARGV[6]); return 1",
          {
            keys: [globalSlotsKey, ownerSlotsKey],
            arguments: [
              String(now),
              String(MAX_STREAMS),
              String(MAX_STREAMS_PER_OWNER),
              String(now + MAX_STREAM_DURATION_MS),
              streamToken,
              String(MAX_STREAM_DURATION_MS + 60000),
            ],
          },
        );
        redisSseAcquired = admitted === 1;
        if (!redisSseAcquired) {
          res.off("close", markDisconnected);
          if (disconnected || res.destroyed) return;
          res.setHeader("Retry-After", "15");
          return res.status(429).json({ code: "RATE_LIMITED", error: "Aktiv araşdırma bağlantılarının limiti dolub." });
        }
      } catch {
        // Fall through to local limits if Redis transiently fails
      }
    }
    res.off("close", markDisconnected);
    if (disconnected || res.destroyed) {
      await releaseRedisSlot();
      return;
    }
    const activeForOwner = ownerStreams.get(ownerId) || 0;
    if (streamCount >= MAX_STREAMS || activeForOwner >= MAX_STREAMS_PER_OWNER) {
      await releaseRedisSlot();
      if (res.destroyed) return;
      res.setHeader("Retry-After", "15");
      return res.status(429).json({ code: "RATE_LIMITED", error: "Aktiv araşdırma bağlantılarının limiti dolub." });
    }
    ownerStreams.set(ownerId, activeForOwner + 1);
    streamCount++;
    let closed = false, ending = false, heartbeat, deadline, drainDeadline, unsubscribe;
    const onDrain = () => { clearTimeout(drainDeadline); drainDeadline = undefined; };
    const cleanup = () => {
      if (closed) return;
      closed = true;
      clearInterval(heartbeat);
      clearTimeout(deadline);
      onDrain();
      res.off("drain", onDrain);
      const remaining = ownerStreams.get(ownerId) - 1;
      if (remaining) ownerStreams.set(ownerId, remaining);
      else ownerStreams.delete(ownerId);
      streamCount--;
      void releaseRedisSlot();
      unsubscribe?.();
    };
    const close = () => {
      if (closed || ending) return;
      ending = true;
      clearInterval(heartbeat);
      if (!res.writableEnded && !res.destroyed) res.end();
    };
    res.once("close", cleanup);
    res.once("finish", cleanup);
    deadline = setTimeout(() => { cleanup(); res.destroy(); }, MAX_STREAM_DURATION_MS);
    deadline.unref?.();

    const assertSession = async () => {
      const [session] = await Promise.all([
        authStore ? authStore.getSession(req.auth.sessionId) : req.auth.session,
        req.securityContext?.assertAuthorized?.(),
      ]);
      if (authStore && (!session || session.userId !== ownerId || session.protocolVersion !== 2 ||
          (session.expiresAt !== undefined && session.expiresAt <= Date.now()) || session.authVersion !== (req.auth.user.authVersion || 1))) {
        throw Object.assign(new Error("Research stream session expired"), { code: "AUTH_REQUIRED" });
      }
    };
    const write = (chunk) => {
      if (closed || ending || res.writableEnded || res.destroyed) return false;
      if (res.writableLength + Buffer.byteLength(chunk) > MAX_STREAM_BYTES) {
        cleanup();
        res.destroy();
        return false;
      }
      if (!res.write(chunk) && !drainDeadline) {
        drainDeadline = setTimeout(() => { cleanup(); res.destroy(); }, 15000);
        drainDeadline.unref?.();
      }
      res.flush?.();
      return true;
    };
    let pending = Promise.resolve();
    let queuedBytes = 0;
    const enqueue = (chunk, terminal = false) => {
      if (closed || ending) return;
      const bytes = Buffer.byteLength(chunk);
      queuedBytes += bytes;
      if (queuedBytes > MAX_STREAM_BYTES) {
        cleanup();
        res.destroy();
        return;
      }
      pending = pending.then(async () => {
        if (closed || ending) return;
        await assertSession();
        if (write(chunk) && terminal) close();
      }).catch(close).finally(() => { queuedBytes -= bytes; });
    };

    res.on("drain", onDrain);
    const snapshot = job => `data: ${JSON.stringify({
      type: "snapshot",
      jobId: job.id,
      status: job.status,
      steps: job.steps,
      sources: job.sources || [],
      artifacts: job.artifacts || [],
      groundingMetadata: job.groundingMetadata || null,
      reply: job.content || "",
      error: job.error || null,
    })}\n\n`;
    const isTerminal = job => ["completed", "failed", "cancelled", "interrupted"].includes(job.status);
    try {
      const job = await researchService.getJob(jobId, ownerId);
      if (closed) return;
      if (!job) {
        return res.status(404).json({
          error: "Araşdırma işi tapılmadı.",
          code: "NOT_FOUND",
        });
      }

      await assertSession();
      if (closed) return;
      req.socket?.setTimeout?.(0);
      res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      res.setHeader("Cache-Control", "private, no-store, no-transform");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");
      res.setHeader("Content-Encoding", "identity");
      if (typeof res.flushHeaders === "function") res.flushHeaders();

      if (!write(snapshot(job))) { cleanup(); return; }

      // If already finished, terminate stream cleanly
      if (isTerminal(job)) {
        return close();
      }

      // Keepalive ping
      let refreshing = false;
      heartbeat = setInterval(async () => {
        if (closed || ending || refreshing) return;
        refreshing = true;
        try {
          await assertSession();
          if (closed) return;
          if (redisSseAcquired && redis?.isReady && typeof redis.eval === "function") {
            const now = Date.now();
            await redis.eval(
              "redis.call('zadd', KEYS[1], 'XX', ARGV[1], ARGV[2]); redis.call('zadd', KEYS[2], 'XX', ARGV[1], ARGV[2]); redis.call('pexpire', KEYS[1], ARGV[3]); redis.call('pexpire', KEYS[2], ARGV[3]); return 1",
              {
                keys: [globalSlotsKey, ownerSlotsKey],
                arguments: [String(now + MAX_STREAM_DURATION_MS), streamToken, String(MAX_STREAM_DURATION_MS + 60000)],
              },
            ).catch(() => {});
          }
          const latest = await researchService.getJob(jobId, ownerId);
          if (!latest) close();
          else if (isTerminal(latest)) enqueue(snapshot(latest), true);
          else enqueue(": ping\n\n");
        } catch { close(); }
        finally { refreshing = false; }
      }, 15000);
      heartbeat.unref?.();
      unsubscribe = researchService.subscribe(jobId, ownerId, eventData => {
        enqueue(`data: ${JSON.stringify(eventData)}\n\n`, eventData.type === "done" || eventData.type === "failed");
      });
      if (closed) unsubscribe?.();
    } catch (error) {
      if (closed) return;
      console.error("[Research Router] SSE stream error:", { code: error?.code });
      cleanup();
      if (!res.headersSent && !res.destroyed) {
        if (error?.code === "AUTH_REQUIRED" || error?.code === "EXECUTION_REVOKED") {
          return res.status(401).json({ code: "AUTH_REQUIRED", error: "Davam etmək üçün hesabına daxil ol." });
        }
        res.status(500).json({ error: "Stream xətası baş verdi." });
      } else {
        res.end();
      }
    }
  });

  // POST /api/ask/research/jobs/:jobId/cancel — Cancel active job
  router.post("/jobs/:jobId/cancel", ipRateLimit, async (req, res) => {
    if (!z.object({}).strict().safeParse(req.body || {}).success) return res.status(400).json({ code: 'VALIDATION_ERROR', error: 'Sorğu parametrləri düzgün deyil.' });
    const { jobId } = req.params;
    if (!/^[0-9a-f-]{36}$/i.test(jobId)) {
      return res.status(400).json({
        error: "İş ID-si düzgün formatda deyil.",
        code: "VALIDATION_ERROR",
      });
    }

    try {
      const ok = await researchService.cancelJob(jobId, req.ownerId);
      return res.json({ ok, status: ok ? "cancel_requested" : null });
    } catch (error) {
      console.error("[Research Router] Error cancelling job:", { name: error?.name, code: error?.code });
      return res.status(500).json({ error: "İşi dayandırmaq mümkün olmadı." });
    }
  });

  return router;
}
