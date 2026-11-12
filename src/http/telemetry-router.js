import express from "express";
import { z } from "zod";
import { isModelImprovementEnabled } from "./auth-middleware.js";
import { isGroundedStrategyRecord, resolveGroundedStrategyProvenance } from "../services/ai/grounded-chat-retention.js";

const ClientTelemetryEventSchema = z.object({
  eventType: z.enum(["export_requested", "summary_clicked", "ui_action"]),
  format: z.enum(["pdf", "markdown", "html", "excel", "csv", "spreadsheet"]).optional(),
  strategyId: z.string().regex(/^[0-9a-f-]{36}$/i).nullable().optional(),
  clientSaveId: z.string().trim().min(8).max(120).nullable().optional(),
  title: z.string().max(200).optional(),
  groundingActive: z.boolean().optional(),
  metadata: z.record(z.any()).optional(),
}).strict();

export function createTelemetryAdminRouter(telemetryService) {
  const router = express.Router();

  // 1. Live KPI Overview
  router.get("/overview", async (req, res) => {
    try {
      const dateRange = typeof req.query.dateRange === "string" ? req.query.dateRange : "today";
      const overview = await telemetryService.repository.getOverview({ dateRange });
      return res.json(overview);
    } catch (error) {
      console.error("Telemetry overview error:", error);
      return res.status(500).json({ error: "Telemetriya göstəriciləri əldə edilmədi.", code: "TELEMETRY_OVERVIEW_ERROR" });
    }
  });

  // 2. Paginated, filterable, searchable live audit feed
  router.get("/events", async (req, res) => {
    try {
      const page = parseInt(req.query.page, 10) || 1;
      const pageSize = parseInt(req.query.pageSize, 10) || 25;
      const mode = typeof req.query.mode === "string" ? req.query.mode : "all";
      const status = typeof req.query.status === "string" ? req.query.status : "all";
      const model = typeof req.query.model === "string" ? req.query.model : "all";
      const marketMode = typeof req.query.marketMode === "string" ? req.query.marketMode : "all";
      const search = typeof req.query.search === "string" ? req.query.search : "";
      const dateRange = typeof req.query.dateRange === "string" ? req.query.dateRange : "all";

      const result = await telemetryService.repository.listEvents({
        page,
        pageSize,
        mode,
        status,
        model,
        marketMode,
        search,
        dateRange,
      });

      return res.json(result);
    } catch (error) {
      console.error("Telemetry events error:", error);
      return res.status(500).json({ error: "Audit jurnalı əldə edilmədi.", code: "TELEMETRY_EVENTS_ERROR" });
    }
  });

  // 3. Single Event Safe JSON Inspector
  router.get("/events/:id", async (req, res) => {
    try {
      const { id } = req.params;
      if (!/^[a-z0-9_-]{1,80}$/i.test(id)) {
        return res.status(400).json({ error: "Hadisə ID-si düzgün deyil.", code: "VALIDATION_ERROR" });
      }
      const event = await telemetryService.repository.getEventById(id);
      if (!event) {
        return res.status(404).json({ error: "Hadisə tapılmadı.", code: "NOT_FOUND" });
      }
      return res.json({ event });
    } catch (error) {
      console.error("Telemetry event get error:", error);
      return res.status(500).json({ error: "Hadisə detalları əldə edilmədi.", code: "TELEMETRY_EVENT_ERROR" });
    }
  });

  return router;
}

const telemetryRateWindows = new Map();

function createTelemetryRateLimiter(limit = 120, windowMs = 60 * 1000) {
  return (req, res, next) => {
    const ip = req.ip || req.socket?.remoteAddress || "127.0.0.1";
    const key = `telemetry:${ip}`;
    const now = Date.now();
    const timestamps = (telemetryRateWindows.get(key) || []).filter((t) => now - t < windowMs);

    if (timestamps.length >= limit) {
      const oldest = timestamps[0] || now;
      const retryAfter = Math.max(1, Math.ceil((oldest + windowMs - now) / 1000));
      res.set("Retry-After", String(retryAfter));
      res.set("X-RateLimit-Remaining", "0");
      return res.status(429).json({
        error: "Hazırda çox sayda telemetriya hadisəsi göndərilib. Bir qədər sonra yenidən cəhd edin.",
        code: "RATE_LIMITED",
        retryAfter,
      });
    }

    timestamps.push(now);
    telemetryRateWindows.set(key, timestamps);
    res.set("X-RateLimit-Remaining", String(limit - timestamps.length));
    return next();
  };
}

setInterval(() => {
  const now = Date.now();
  const windowMs = 60 * 1000;
  for (const [key, timestamps] of telemetryRateWindows.entries()) {
    const active = timestamps.filter((t) => now - t < windowMs);
    if (active.length === 0) telemetryRateWindows.delete(key);
    else telemetryRateWindows.set(key, active);
  }
}, 60 * 1000).unref();

export function createTelemetryClientRouter(telemetryService, options = {}) {
  const router = express.Router();
  const rateLimitMiddleware = options.rateLimit || createTelemetryRateLimiter();
  const strategyRepository = options.strategyRepository || telemetryService?.strategyRepository || null;

  router.post("/event", rateLimitMiddleware, async (req, res) => {
    try {
      const parseResult = ClientTelemetryEventSchema.safeParse(req.body);
      if (!parseResult.success) {
        return res.status(400).json({
          error: "Daxil edilən telemetriya hadisəsi etibarsızdır.",
          code: "VALIDATION_ERROR",
          details: parseResult.error.issues,
        });
      }

      const { eventType, format, strategyId, clientSaveId, title, groundingActive: clientGroundingActive } = parseResult.data;
      const ownerId = req.ownerId || null;
      const sessionId = req.guestOwnerId || null;

      if (eventType === "export_requested") {
        const modelImprovement = isModelImprovementEnabled(req);
        if (strategyRepository && typeof strategyRepository.loadOwnerProvenance === "function") {
          await strategyRepository.loadOwnerProvenance(ownerId).catch(() => {});
        }
        let existing = null;
        if (strategyId && strategyRepository && typeof strategyRepository.getById === "function") {
          existing = await strategyRepository.getById(strategyId, ownerId);
        }
        const provenance = resolveGroundedStrategyProvenance(
          ownerId,
          existing || { id: strategyId, clientSaveId, title },
          existing ? [existing] : []
        );
        const serverGrounded = Boolean((existing && isGroundedStrategyRecord(existing)) || provenance.grounded || clientGroundingActive === true);
        const isGroundedOrUnverified = !strategyId || !existing || serverGrounded;
        const onlyNecessaryData = !modelImprovement || isGroundedOrUnverified;
        const resolvedTitle = onlyNecessaryData ? "" : (existing.strategy?.title || existing.title || "");
        await telemetryService.trackExport({
          ownerId,
          sessionId,
          format: format || "pdf",
          title: resolvedTitle,
          status: "success",
          groundingActive: serverGrounded,
          onlyNecessaryData,
          modelImprovement: !onlyNecessaryData,
        });
      }

      return res.json({ success: true });
    } catch (error) {
      console.warn("⚠️ Client telemetry ingestion warning:", error.message);
      return res.status(500).json({ error: "Hadisə qeydə alınmadı.", code: "INGEST_FAILED" });
    }
  });

  return router;
}
