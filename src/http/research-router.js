import express from "express";
import { z } from 'zod';
import { CreateResearchJobSchema } from "../services/ai/research-service.js";
import { hasGeminiConfiguration } from "../services/ai/config.js";
import { requireAuth } from "./auth-middleware.js";

function getClientIp(req) {
  return req.ip || req.socket?.remoteAddress || "127.0.0.1";
}

export function createResearchRouter({ researchService, chatRepository, rateLimit = null }) {
  const router = express.Router();
  router.use(requireAuth);

  const ipRateLimit = rateLimit || ((req, res, next) => next());

  // POST /api/ask/research — Create background research job
  router.post("/", ipRateLimit, async (req, res) => {
    try {
      const parsed = CreateResearchJobSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: "Sorğu parametrləri düzgün deyil.",
          code: "VALIDATION_ERROR",
          details: parsed.error.issues,
        });
      }

      if (!hasGeminiConfiguration() && !researchService.geminiClient) {
        return res.status(503).json({
          code: "GEMINI_NOT_CONFIGURED",
          error: "Gemini xidməti konfiqurasiya edilməyib. Zəhmət olmasa GEMINI_API_KEY əlavə edin.",
        });
      }

      const prompt = parsed.data.prompt || parsed.data.query;
      const { chatId, strategyId, taskId, language } = parsed.data;

      if (chatId) {
        const existingChat = await chatRepository.getById(chatId, req.ownerId);
        if (!existingChat) {
          return res.status(404).json({
            error: "Söhbət tapılmadı və ya sizə aid deyil.",
            code: "NOT_FOUND",
          });
        }
      }

      const result = await researchService.createResearchJob({
        ownerId: req.ownerId,
        prompt,
        chatId,
        strategyId,
        taskId,
        language: language || (req.headers["accept-language"]?.includes("en") ? "en" : "az"),
        user: req.user,
      });

      return res.status(202).json({ ...result, status: "pending" });
    } catch (error) {
      if (error?.code === "GROUNDED_STRATEGY_RESTRICTED" || error?.status === 422) {
        return res.status(422).json({
          error: error.message || "Veb araşdırması olan strategiyanı Deep Research-ə ötürmək mümkün deyil.",
          code: "GROUNDED_STRATEGY_RESTRICTED",
        });
      }
      if (error?.code === "NOT_FOUND" || error?.status === 404) {
        return res.status(404).json({
          error: error.message || "Seçilmiş kontekst tapılmadı.",
          code: "NOT_FOUND",
        });
      }
      if (error?.code === "EXECUTION_BUSY" || error?.status === 429) {
        return res.status(429).json({
          error: "Hazırda aktiv araşdırma sorğunuz icra olunur. Zəhmət olmasa tamamlanmasını gözləyin.",
          code: "EXECUTION_BUSY",
        });
      }
      console.error("[Research Router] Error creating research job:", error);
      return res.status(500).json({
        error: "Araşdırma işini başlatmaq mümkün olmadı.",
        code: "INTERNAL_ERROR",
      });
    }
  });

  // GET /api/ask/research/jobs/:jobId — Check status & fetch current report
  router.get("/jobs/:jobId", async (req, res) => {
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
      console.error("[Research Router] Error fetching job:", error);
      return res.status(500).json({
        error: "Araşdırma məlumatını əldə etmək mümkün olmadı.",
        code: "INTERNAL_ERROR",
      });
    }
  });

  // GET /api/ask/research/jobs/:jobId/stream — Real-time SSE stream for job progress
  router.get("/jobs/:jobId/stream", async (req, res) => {
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

      req.socket?.setTimeout?.(0);
      res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");
      res.setHeader("Content-Encoding", "identity");
      if (typeof res.flushHeaders === "function") res.flushHeaders();

      // Emit initial snapshot
      res.write(
        `data: ${JSON.stringify({
          type: "snapshot",
          jobId: job.id,
          status: job.status,
          steps: job.steps,
          sources: job.sources || [],
          artifacts: job.artifacts || [],
          reply: job.content || "",
          error: job.error || null,
        })}\n\n`,
      );
      if (typeof res.flush === "function") res.flush();

      // If already finished, terminate stream cleanly
      if (["completed", "failed", "cancelled", "interrupted"].includes(job.status)) {
        return res.end();
      }

      // Keepalive ping
      const pingInterval = setInterval(() => {
        if (!res.writableEnded && !res.destroyed) {
          res.write(": ping\n\n");
          if (typeof res.flush === "function") res.flush();
        }
      }, 15000);

      const unsubscribe = researchService.subscribe(jobId, req.ownerId, (eventData) => {
        if (res.writableEnded || res.destroyed) return;

        res.write(`data: ${JSON.stringify(eventData)}\n\n`);
        if (typeof res.flush === "function") res.flush();

        if (eventData.type === "done" || eventData.type === "failed") {
          clearInterval(pingInterval);
          res.end();
        }
      });

      res.on("close", () => {
        clearInterval(pingInterval);
        if (unsubscribe) unsubscribe();
      });
    } catch (error) {
      console.error("[Research Router] SSE stream error:", error);
      if (!res.headersSent) {
        res.status(500).json({ error: "Stream xətası baş verdi." });
      } else {
        res.end();
      }
    }
  });

  // POST /api/ask/research/jobs/:jobId/cancel — Cancel active job
  router.post("/jobs/:jobId/cancel", async (req, res) => {
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
      console.error("[Research Router] Error cancelling job:", error);
      return res.status(500).json({ error: "İşi dayandırmaq mümkün olmadı." });
    }
  });

  return router;
}
