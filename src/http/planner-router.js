import express from "express";
import { z } from "zod";
import { assertExecutionAuthorized, createExecutionController } from "../services/security/execution-control.js";
import { summarizeTasksWithLuna, prioritizeTasksWithLuna } from "../services/ai/strategy-service.js";
import { aiConfig } from "../services/ai/config.js";
import { httpStatusOf, publicErrorMessage } from "./error-response.js";
import { isModelImprovementEnabled } from "./auth-middleware.js";
import {
  isGroundedStrategyRecord,
  isGroundedPlannerTaskInput,
  resolveGroundedStrategyProvenance,
} from "../services/ai/grounded-chat-retention.js";

export const TaskInputSchema = z.object({
  text: z.string().trim().min(1).max(1000).optional(),
  title: z.string().trim().min(1).max(1000).optional(),
  timeframe: z.string().trim().max(100).optional(),
  groupLabel: z.string().trim().max(100).optional(),
  status: z.enum(["todo", "in_progress", "completed"]).optional(),
  completed: z.boolean().optional(),
  isPriority: z.boolean().optional(),
  priority: z.enum(["high", "medium", "low", "priority", "normal"]).optional(),
  strategyId: z.string().regex(/^[0-9a-f-]{36}$/i, "Geçərsiz strategiya ID").nullable().optional(),
  strategyTitle: z.string().trim().max(300).nullable().optional(),
  source: z.string().trim().max(50).nullable().optional(),
  feedback: z.enum(["like", "dislike"]).nullable().optional(),
  searchGrounded: z.boolean().optional(),
  groundingActive: z.boolean().optional(),
}).strict().refine((data) => Boolean(data.text || data.title), {
  message: "Tapşırıq mətni daxil edilməlidir.",
});

export const BatchCreateTasksSchema = z.object({
  tasks: z.array(TaskInputSchema).min(1, "Əlavə ediləcək tapşırıq tapılmadı.").max(100),
}).strict();

export const UpdateTaskSchema = z.object({
  text: z.string().trim().min(1, "Tapşırıq mətni boş ola bilməz.").max(1000).optional(),
  title: z.string().trim().min(1, "Tapşırıq mətni boş ola bilməz.").max(1000).optional(),
  completed: z.boolean().optional(),
  status: z.enum(["todo", "in_progress", "completed"]).optional(),
  timeframe: z.string().trim().max(100).optional(),
  groupLabel: z.string().trim().max(100).optional(),
  isPriority: z.boolean().optional(),
  priority: z.enum(["high", "medium", "low", "priority", "normal"]).optional(),
  feedback: z.enum(["like", "dislike"]).nullable().optional(),
  explanation: z.string().trim().max(500).optional(),
  userNote: z.string().trim().max(500).optional(),
}).strict();

export const SummarizeTasksSchema = z.object({
  tasks: z.array(
    z.union([
      z.string().trim().min(1).max(1000),
      z.object({
        text: z.string().trim().min(1).max(1000).optional(),
        title: z.string().trim().min(1).max(1000).optional(),
        timeframe: z.string().trim().max(100).optional(),
        groupLabel: z.string().trim().max(100).optional(),
        isPriority: z.boolean().optional(),
        priority: z.enum(["high", "medium", "low", "priority", "normal"]).optional(),
        searchGrounded: z.boolean().optional(),
        groundingActive: z.boolean().optional(),
      }).strict(),
    ])
  ).min(1).max(50).optional(),
  strategyId: z.string().regex(/^[0-9a-f-]{36}$/i, "Geçərsiz strategiya ID").nullable().optional(),
  strategyTitle: z.string().trim().max(300).nullable().optional(),
  language: z.enum(["az", "en"]).optional(),
  searchGrounded: z.boolean().optional(),
  groundingActive: z.boolean().optional(),
}).strict();

export const PrioritizeTasksSchema = z.object({
  taskIds: z.array(z.string().regex(/^[0-9a-f-]{36}$/i, "Geçərsiz tapşırıq ID")).max(100).optional(),
  language: z.enum(["az", "en"]).optional(),
}).strict();

export function createPlannerRouter(plannerRepository, options = {}) {
  const router = express.Router();
  const strategyRepository = options.strategyRepository || null;
  const telemetryService = options.telemetryService || null;

  const guestMutationRate = new Map();
  function checkGuestPlannerRate(ip) {
    const now = Date.now();
    const windowMs = 10 * 60 * 1000;
    const limit = 60;
    const record = guestMutationRate.get(ip) || { count: 0, resetAt: now + windowMs };
    if (now > record.resetAt) {
      record.count = 0;
      record.resetAt = now + windowMs;
    }
    record.count += 1;
    guestMutationRate.set(ip, record);
    if (guestMutationRate.size > 10000) {
      for (const [k, v] of guestMutationRate) if (v.resetAt < now) guestMutationRate.delete(k);
    }
    return record.count <= limit;
  }

  async function loadOwnerStrategies(ownerId) {
    if (!strategyRepository || !ownerId) return [];
    if (typeof strategyRepository.loadOwnerProvenance === "function") {
      await strategyRepository.loadOwnerProvenance(ownerId).catch(() => {});
    }
    if (typeof strategyRepository.readAll === "function") {
      return strategyRepository.readAll(ownerId).catch(() => []);
    }
    if (typeof strategyRepository.list === "function") {
      return strategyRepository.list(ownerId).catch(() => []);
    }
    return [];
  }

  async function resolveTaskGroundedProvenance(ownerId, item, ownerStrategies = []) {
    if (!item || typeof item !== "object") return false;
    if (item.searchGrounded === true || item.groundingActive === true) return true;
    const strategyId = item.strategyId || null;
    if (strategyId && strategyRepository && typeof strategyRepository.getById === "function") {
      const rec = await strategyRepository.getById(strategyId, ownerId);
      if (rec && isGroundedStrategyRecord(rec)) return true;
      const resolved = resolveGroundedStrategyProvenance(ownerId, rec || { id: strategyId }, ownerStrategies);
      if (resolved.grounded) return true;
    }
    return isGroundedPlannerTaskInput(
      ownerId,
      {
        strategyId,
        strategyTitle: item.strategyTitle || null,
        tasks: [item],
        source: item.source || (strategyId || item.strategyTitle ? "brief" : "user"),
        searchGrounded: Boolean(item.searchGrounded || item.groundingActive),
      },
      ownerStrategies
    );
  }

  router.get("/", async (req, res) => {
    try {
      const tasks = await plannerRepository.list(req.ownerId);
      return res.json({ tasks });
    } catch (error) {
      console.error("Planner list error:", error);
      return res.status(500).json({ error: "Tapşırıqları yükləmək mümkün olmadı." });
    }
  });

  router.post("/batch", async (req, res) => {
    try {
      if (!req.user) {
        const ip = req.ip || req.socket?.remoteAddress || "127.0.0.1";
        if (!checkGuestPlannerRate(ip)) {
          return res.status(429).json({ error: "Çox sayda sorğu göndərildi. Bir qədər sonra yenidən cəhd edin.", code: "RATE_LIMITED" });
        }
      }
      const parsed = BatchCreateTasksSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: parsed.error.issues[0]?.message || "Əlavə ediləcək tapşırıq tapılmadı.",
          code: "VALIDATION_ERROR",
          details: parsed.error.issues,
        });
      }

      const ownerStrategies = await loadOwnerStrategies(req.ownerId);
      const tasksToInsert = await Promise.all(
        parsed.data.tasks.map(async (item) => {
          const rawText = item.title || item.text || "";
          const text = rawText.replace(/^[\s\-*•\d.)\]]+/, "").trim() || rawText.trim();
          const title = text;
          const timeframe = item.timeframe || item.groupLabel || "Ümumi";
          const groupLabel = item.groupLabel || timeframe;
          const status = item.status || (item.completed ? "completed" : "todo");
          const isPriority = Boolean(item.isPriority || item.priority === "high");
          const priority = item.priority || (isPriority ? "high" : "normal");
          const searchGrounded = await resolveTaskGroundedProvenance(req.ownerId, { ...item, title, text }, ownerStrategies);
          return {
            title,
            text,
            timeframe,
            groupLabel,
            status,
            isPriority,
            priority,
            strategyId: item.strategyId || null,
            strategyTitle: item.strategyTitle || null,
            source: item.source || (item.strategyId || item.strategyTitle ? "brief" : "user"),
            ...(searchGrounded ? { searchGrounded: true } : {}),
            feedback: item.feedback || null,
            completed: status === "completed" || Boolean(item.completed),
          };
        })
      );

      const added = await plannerRepository.addBatch(req.ownerId, tasksToInsert);
      const allTasks = await plannerRepository.list(req.ownerId);
      return res.json({ added, count: added.length, tasks: allTasks });
    } catch (error) {
      console.error("Planner batch add error:", error);
      return res.status(500).json({ error: "Tapşırıqları əlavə etmək mümkün olmadı." });
    }
  });

  router.post("/", async (req, res) => {
    try {
      if (!req.user) {
        const ip = req.ip || req.socket?.remoteAddress || "127.0.0.1";
        if (!checkGuestPlannerRate(ip)) {
          return res.status(429).json({ error: "Çox sayda sorğu göndərildi. Bir qədər sonra yenidən cəhd edin.", code: "RATE_LIMITED" });
        }
      }
      const parsed = TaskInputSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: parsed.error.issues[0]?.message || "Tapşırıq məlumatı düzgün deyil.",
          code: "VALIDATION_ERROR",
          details: parsed.error.issues,
        });
      }
      const data = parsed.data;
      const rawText = data.title || data.text || "";
      const text = rawText.replace(/^[\s\-*•\d.)\]]+/, "").trim() || rawText.trim();
      const title = text;
      const timeframe = data.timeframe || data.groupLabel || "Ümumi";
      const groupLabel = data.groupLabel || timeframe;
      const status = data.status || (data.completed ? "completed" : "todo");
      const isPriority = Boolean(data.isPriority || data.priority === "high");
      const priority = data.priority || (isPriority ? "high" : "normal");
      const ownerStrategies = await loadOwnerStrategies(req.ownerId);
      const searchGrounded = await resolveTaskGroundedProvenance(req.ownerId, { ...data, title, text }, ownerStrategies);

      const added = await plannerRepository.addBatch(req.ownerId, [
        {
          title,
          text,
          timeframe,
          groupLabel,
          status,
          isPriority,
          priority,
          strategyId: data.strategyId || null,
          strategyTitle: data.strategyTitle || null,
          source: data.source || (data.strategyId || data.strategyTitle ? "brief" : "user"),
          ...(searchGrounded ? { searchGrounded: true } : {}),
          feedback: data.feedback || null,
          completed: status === "completed" || Boolean(data.completed),
        },
      ]);
      return res.status(201).json({ task: added[0] || null });
    } catch (error) {
      console.error("Planner create error:", error);
      return res.status(500).json({ error: "Tapşırıq yaratmaq mümkün olmadı." });
    }
  });

  router.post("/summarize", async (req, res) => {
    const abortController = createExecutionController();
    const onReqClose = () => {
      if (!req.complete && !res.writableEnded) abortController.abort();
    };
    const onResClose = () => {
      if (!res.writableEnded) abortController.abort();
    };
    req.on?.("close", onReqClose);
    res.on?.("close", onResClose);
    try {
      const parsed = SummarizeTasksSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: parsed.error.issues[0]?.message || "Məlumatları yoxlayın.",
          code: "VALIDATION_ERROR",
          details: parsed.error.issues,
        });
      }

      const { strategyId, strategyTitle, language = "az" } = parsed.data;
      let tasks = parsed.data.tasks || [];
      let strategyRecord = null;

      // Tenant isolation & IDOR check: If strategyId is provided, enforce ownerId match (Rule 3)
      if (strategyId) {
        if (strategyRepository) {
          strategyRecord = await strategyRepository.getById(strategyId, req.ownerId);
          if (!strategyRecord) {
            return res.status(404).json({ error: "Strategiya tapılmadı.", code: "NOT_FOUND" });
          }
          if (isGroundedStrategyRecord(strategyRecord)) {
            return res.status(422).json({
              error: "Veb araşdırması olan strategiya tapşırıqlarını model vasitəsilə xülasələndirmək mümkün deyil.",
              code: "GROUNDED_STRATEGY_RESTRICTED",
            });
          }
          if (!tasks.length && Array.isArray(strategyRecord.strategy?.nextSteps)) {
            tasks = strategyRecord.strategy.nextSteps;
          }
        }
      }

      const ownerStrategies = await loadOwnerStrategies(req.ownerId);
      if (strategyId && strategyRecord) {
        const stratProv = resolveGroundedStrategyProvenance(req.ownerId, strategyRecord, ownerStrategies);
        if (stratProv.grounded) {
          return res.status(422).json({
            error: "Veb araşdırması olan strategiya tapşırıqlarını model vasitəsilə xülasələndirmək mümkün deyil.",
            code: "GROUNDED_STRATEGY_RESTRICTED",
          });
        }
      }
      const isGroundedTaskSubmission = isGroundedPlannerTaskInput(
        req.ownerId,
        {
          strategyId: strategyId || null,
          strategyTitle: strategyTitle || null,
          tasks,
          source: "brief",
          searchGrounded: Boolean(parsed.data.searchGrounded || parsed.data.groundingActive),
        },
        ownerStrategies
      );
      if (isGroundedTaskSubmission) {
        return res.status(422).json({
          error: "Veb araşdırması olan strategiya tapşırıqlarını model vasitəsilə xülasələndirmək mümkün deyil.",
          code: "GROUNDED_STRATEGY_RESTRICTED",
        });
      }

      if (!tasks.length) {
        return res.status(400).json({ error: "Xülasələndiriləcək tapşırıq tapılmadı.", code: "VALIDATION_ERROR" });
      }

      const client = options.openAiClient || options.client || null;
      const startedAt = Date.now();
      let summaryUsage = null;

      await assertExecutionAuthorized(abortController.signal);
      const result = await summarizeTasksWithLuna({
        tasks,
        strategyTitle: strategyTitle || "",
        language,
        client,
        signal: abortController.signal,
        onUsage: (u) => { summaryUsage = u; },
      });
      await assertExecutionAuthorized(abortController.signal);

      if (telemetryService && typeof telemetryService.trackSummary === "function") {
        const modelImprovement = isModelImprovementEnabled(req);
        telemetryService.trackSummary({
          ownerId: req.ownerId,
          sessionId: req.guestOwnerId,
          model: result.model || aiConfig.plannerSummaryModel || "gpt-6-luna",
          latencyMs: Date.now() - startedAt,
          usage: summaryUsage,
          status: "success",
          onlyNecessaryData: !modelImprovement,
          modelImprovement,
        }).catch(() => {});
      }

      const responseBody = {
        tasks: result.tasks,
        model: result.model || "gpt-6-luna",
        count: result.tasks.length,
      };
      req.securityContext?.recordIdempotentResult?.(200, responseBody);
      return res.json(responseBody);
    } catch (error) {
      if (abortController.signal.aborted && !error?.code) {
        return res.end();
      }
      const status = httpStatusOf(error);
      console.error("Planner summarize error:", error);
      return res.status(status).json({
        error: publicErrorMessage(error, "Tapşırıqları xülasələndirmək mümkün olmadı."),
        ...(error?.code ? { code: error.code } : {}),
      });
    } finally {
      req.off?.("close", onReqClose);
      res.off?.("close", onResClose);
    }
  });

  router.post("/prioritize", async (req, res) => {
    const abortController = createExecutionController();
    const onReqClose = () => {
      if (!req.complete && !res.writableEnded) abortController.abort();
    };
    const onResClose = () => {
      if (!res.writableEnded) abortController.abort();
    };
    req.on?.("close", onReqClose);
    res.on?.("close", onResClose);
    try {
      const parsed = PrioritizeTasksSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: parsed.error.issues[0]?.message || "Məlumatları yoxlayın.",
          code: "VALIDATION_ERROR",
          details: parsed.error.issues,
        });
      }

      const { taskIds, language = "az" } = parsed.data;

      // Tenant isolation: fetch owner's tasks strictly scoped to req.ownerId (Rule 3)
      const allUserTasks = await plannerRepository.list(req.ownerId);
      if (!allUserTasks.length) {
        const emptyBody = {
          tasks: [],
          prioritizedTaskIds: [],
          model: aiConfig.plannerPriorityModel || "gpt-6-luna",
          count: 0,
        };
        req.securityContext?.recordIdempotentResult?.(200, emptyBody);
        return res.json(emptyBody);
      }

      let tasksToEvaluate = allUserTasks;
      if (Array.isArray(taskIds) && taskIds.length > 0) {
        const idFilter = new Set(taskIds);
        tasksToEvaluate = allUserTasks.filter((t) => idFilter.has(t.id));
      }

      const ownerStrategies = await loadOwnerStrategies(req.ownerId);
      const nonGroundedTasks = [];
      for (const task of tasksToEvaluate) {
        const isGrounded = await resolveTaskGroundedProvenance(req.ownerId, task, ownerStrategies);
        if (!isGrounded) {
          nonGroundedTasks.push(task);
        }
      }
      if (tasksToEvaluate.length > 0 && nonGroundedTasks.length === 0) {
        return res.status(422).json({
          error: "Veb araşdırması olan strategiya tapşırıqlarını model vasitəsilə prioritetləşdirmək mümkün deyil.",
          code: "GROUNDED_STRATEGY_RESTRICTED",
        });
      }
      tasksToEvaluate = nonGroundedTasks;

      if (!tasksToEvaluate.length) {
        const unchangedBody = {
          tasks: allUserTasks,
          prioritizedTaskIds: [],
          model: aiConfig.plannerPriorityModel || "gpt-6-luna",
          count: 0,
        };
        req.securityContext?.recordIdempotentResult?.(200, unchangedBody);
        return res.json(unchangedBody);
      }

      const client = options.openAiClient || options.client || null;
      const startedAt = Date.now();
      let priorityUsage = null;

      await assertExecutionAuthorized(abortController.signal);
      const result = await prioritizeTasksWithLuna({
        tasks: tasksToEvaluate,
        language,
        client,
        signal: abortController.signal,
        onUsage: (u) => { priorityUsage = u; },
      });

      await assertExecutionAuthorized(abortController.signal);
      const priorityIds = new Set(result.prioritizedTaskIds || []);
      req.securityContext?.markMutationPending?.();
      const updatedTasks = typeof plannerRepository.updatePriorities === "function"
        ? await plannerRepository.updatePriorities(req.ownerId, priorityIds)
        : allUserTasks.map((t) => ({
            ...t,
            isPriority: priorityIds.has(t.id),
            priority: priorityIds.has(t.id) ? "high" : "normal",
          }));

      const priorityCount = updatedTasks.filter((t) => t.isPriority).length;
      const responseBody = {
        tasks: updatedTasks,
        prioritizedTaskIds: result.prioritizedTaskIds,
        model: result.model || "gpt-6-luna",
        count: priorityCount,
      };
      req.securityContext?.recordIdempotentResult?.(200, responseBody);

      if (telemetryService && typeof telemetryService.trackSummary === "function") {
        const modelImprovement = isModelImprovementEnabled(req);
        telemetryService.trackSummary({
          ownerId: req.ownerId,
          sessionId: req.guestOwnerId,
          model: result.model || aiConfig.plannerPriorityModel || "gpt-6-luna",
          latencyMs: Date.now() - startedAt,
          usage: priorityUsage,
          status: "success",
          onlyNecessaryData: !modelImprovement,
          modelImprovement,
        }).catch(() => {});
      }

      return res.json(responseBody);
    } catch (error) {
      if (abortController.signal.aborted && !error?.code) {
        return res.end();
      }
      const status = httpStatusOf(error);
      console.error("Planner prioritize error:", error);
      return res.status(status).json({
        error: publicErrorMessage(error, "Tapşırıqları prioritetləşdirmək mümkün olmadı."),
        ...(error?.code ? { code: error.code } : {}),
      });
    } finally {
      req.off?.("close", onReqClose);
      res.off?.("close", onResClose);
    }
  });

  router.patch("/:id", async (req, res) => {
    try {
      const { id } = req.params;
      if (!/^[0-9a-f-]{36}$/i.test(id)) {
        return res.status(400).json({ error: "Tapşırıq ID-si düzgün deyil.", code: "VALIDATION_ERROR" });
      }
      const parsed = UpdateTaskSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: parsed.error.issues[0]?.message || "Məlumatları yoxlayın.",
          code: "VALIDATION_ERROR",
          details: parsed.error.issues,
        });
      }
      const updated = await plannerRepository.update(id, req.ownerId, parsed.data);
      if (!updated) {
        return res.status(404).json({ error: "Tapşırıq tapılmadı." });
      }

      if (parsed.data.feedback && telemetryService && typeof telemetryService.trackTaskFeedback === "function") {
        const modelImprovement = isModelImprovementEnabled(req);
        const ownerStrategies = await loadOwnerStrategies(req.ownerId);
        let strategyExistsAndUngrounded = false;
        if (updated.strategyId && strategyRepository && typeof strategyRepository.getById === "function") {
          const existingStrategy = await strategyRepository.getById(updated.strategyId, req.ownerId);
          strategyExistsAndUngrounded = Boolean(existingStrategy && !isGroundedStrategyRecord(existingStrategy));
        }
        const taskGrounded =
          await resolveTaskGroundedProvenance(req.ownerId, updated, ownerStrategies) ||
          Boolean(updated.strategyId && strategyRepository && !strategyExistsAndUngrounded);
        const isRestricted = !modelImprovement || taskGrounded;
        telemetryService.trackTaskFeedback({
          ownerId: req.ownerId,
          sessionId: req.guestOwnerId,
          taskId: updated.id,
          taskText: isRestricted ? "" : (updated.title || updated.text || ""),
          feedback: parsed.data.feedback,
          strategyId: updated.strategyId || null,
          strategyTitle: isRestricted ? null : (updated.strategyTitle || null),
          source: updated.source || "brief",
          userNote: isRestricted ? "" : (parsed.data.userNote || parsed.data.explanation || ""),
          groundingActive: taskGrounded,
          onlyNecessaryData: isRestricted,
          modelImprovement: !isRestricted,
        }).catch(() => {});
      }

      return res.json({ task: updated });
    } catch (error) {
      console.error("Planner update error:", error);
      return res.status(500).json({ error: "Tapşırığı yeniləmək mümkün olmadı." });
    }
  });

  router.delete("/completed", async (req, res) => {
    try {
      const count = await plannerRepository.clearCompleted(req.ownerId);
      return res.json({ ok: true, cleared: count });
    } catch (error) {
      console.error("Planner clear completed error:", error);
      return res.status(500).json({ error: "Tamamlanmış tapşırıqları silmək mümkün olmadı." });
    }
  });

  router.delete("/:id", async (req, res) => {
    try {
      const id = typeof req.params?.id === "string" ? req.params.id.trim() : "";
      if (!/^[0-9a-f-]{36}$/i.test(id)) {
        return res.status(400).json({ error: "Tapşırıq ID-si düzgün deyil.", code: "VALIDATION_ERROR" });
      }
      const ok = await plannerRepository.delete(id, req.ownerId);
      if (!ok) {
        return res.status(404).json({ error: "Tapşırıq tapılmadı.", code: "NOT_FOUND" });
      }
      return res.json({ ok: true, id });
    } catch (error) {
      console.error("Planner delete error:", error);
      return res.status(500).json({ error: "Tapşırığı silmək mümkün olmadı." });
    }
  });

  return router;
}
