import { assertExecutionActive, assertExecutionAuthorized, createExecutionController } from '../services/security/execution-control.js';
import { executionContext } from '../services/security/privacy-policy.js';
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import express from "express";
import { createAskExecutionGuard } from "./ask-execution-guard.js";
import { acquireIdempotencyLock } from "./execution-lock.js";
import { httpStatusOf, publicErrorMessage } from "./error-response.js";
import {
  AssessRequestSchema,
  EmptyBodySchema,
  GenerateRequestSchema,
  RefineByIdRequestSchema,
  RefineRequestSchema,
  SaveStrategyRequestSchema,
  StrategyFeedbackSchema,
  UpdateStrategyTitleSchema,
  formatValidationError,
} from "../domain/strategy.js";
import {
  assessBrief,
  estimateBuildPreparation,
  generateStrategy,
  refineStrategy,
} from "../services/ai/strategy-service.js";
import { buildStrategyPersonalizationContext } from "../services/ai/personal-context.js";
import { detectTargetMarket } from "../services/ai/prompts.js";
import { BuildEstimateRequestSchema } from "../services/ai/build-estimate.js";
import { buildConfig } from "../services/ai/build-config.js";
import { createHelmerDecisionRouter, deterministicBuildFallbackRoute } from "../services/ai/decision-router.js";
import {
  isGroundedStrategyRecord,
  isExpiredGroundedStrategyRecord,
  resolveGroundedStrategyProvenance,
  applyGroundedProvenanceToStrategy,
  rememberGroundedStrategyProvenance,
} from "../services/ai/grounded-chat-retention.js";
import { aiConfig } from "../services/ai/config.js";
import { logWithoutBlocking } from "../services/learning/learning-loop-service.js";
import { isModelImprovementEnabled } from "./auth-middleware.js";

const MAX_BUILD_STREAM_BUFFER_BYTES = 2 * 1024 * 1024;
const BUILD_STREAM_DRAIN_TIMEOUT_MS = 15000;

const DANGEROUS_PROTO_KEYS = new Set(["__proto__", "constructor", "prototype"]);

export function canonicalize(value) {
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  const sorted = Object.create(null);
  for (const key of Object.keys(value).sort()) {
    if (DANGEROUS_PROTO_KEYS.has(key)) continue;
    if (value[key] !== undefined) {
      sorted[key] = canonicalize(value[key]);
    }
  }
  return sorted;
}

export function computePayloadFingerprint(operation, payload, resourceId = null) {
  const norm = {
    op: operation,
    resId: resourceId || payload?.strategyId || null,
    brief: typeof payload?.brief === "string" ? payload.brief.trim() : "",
    answers: Array.isArray(payload?.answers)
      ? payload.answers.map((a) => ({
          qid: typeof a?.questionId === "string" ? a.questionId.trim() : "",
          q: typeof a?.question === "string" ? a.question.trim() : "",
          a: typeof a?.answer === "string" ? a.answer.trim() : "",
        }))
      : [],
    assumptions: Array.isArray(payload?.assumptions)
      ? payload.assumptions.map((item) => (typeof item === "string" ? item.trim() : ""))
      : [],
    action: payload?.action || null,
    request: typeof payload?.request === "string" ? payload.request.trim() : null,
    language: payload?.language || null,
    autoSave: payload?.autoSave !== undefined ? Boolean(payload.autoSave) : null,
    strategy: payload?.strategy && typeof payload.strategy === "object" ? canonicalize(payload.strategy) : null,
    ...(payload?.buildMode !== undefined ? { buildMode: payload.buildMode } : {}),
    ...(payload?.fasterThinkingLevel !== undefined ? { fasterThinkingLevel: payload.fasterThinkingLevel } : {}),
    ...(payload?.round !== undefined ? { round: Number(payload.round) } : {}),
  };
  return createHash("sha256").update(JSON.stringify(canonicalize(norm))).digest("hex");
}

export function computeLegacyPayloadFingerprint(operation, payload, resourceId = null) {
  const norm = {
    op: operation,
    resId: resourceId || null,
    brief: typeof payload?.brief === "string" ? payload.brief.trim() : "",
    answers: Array.isArray(payload?.answers)
      ? payload.answers.map((a) => ({ q: a?.question || "", a: a?.answer || "" }))
      : [],
    action: payload?.action || null,
    request: typeof payload?.request === "string" ? payload.request.trim() : null,
    language: payload?.language || null,
    strategyTitle: payload?.strategy?.title || null,
    targetMarket: payload?.strategy?.targetMarket || null,
  };
  return createHash("sha256").update(JSON.stringify(norm)).digest("hex");
}

const activeGenerations = new Map();
const activeRefinements = new Map();
const requestWindows = new Map();

function publicBuildFailure(error) {
  const messages = {
    AI_NOT_CONFIGURED: "AI bağlantısının server konfiqurasiyası tamamlanmayıb.",
    AI_AUTH_ERROR: "AI bağlantısı doğrulanmadı. Serverin giriş icazələrini yoxlayın.",
    AI_PROVIDER_CONFIG_ERROR: "AI bağlantısının server konfiqurasiyasını yoxlamaq lazımdır.",
    AI_MODEL_UNAVAILABLE: "Seçilmiş AI modeli layihə və ya region üçün əlçatan deyil.",
    AI_TIMEOUT: "Strategiyanın hazırlanması vaxt limitinə çatdı. Yenidən cəhd edin.",
    AI_RATE_LIMITED: "AI xidmətlərində hazırda sorğu sıxlığı var. Bir az sonra yenidən cəhd edin.",
    AI_INVALID_OUTPUT: "Strategiyanın cavab formatını tamamlamaq mümkün olmadı. Yenidən cəhd edin.",
    AI_MAX_TOKENS: "Strategiyanın cavab həcmi limitə çatdı. Yenidən cəhd edin.",
    AI_CONTENT_BLOCKED: "Bu sorğunu tamamlamaq mümkün olmadı. Sorğunu nəzərdən keçirin.",
    AI_SAFETY_BLOCKED: "Bu sorğunu tamamlamaq mümkün olmadı. Sorğunu nəzərdən keçirin.",
    GROUNDING_UNAVAILABLE: "Canlı araşdırma üçün mənbə ilə dəstəklənən məlumat tapılmadı. Yenidən cəhd edin.",
    GROUNDED_STRATEGY_RESTRICTED: "Veb araşdırması olan strategiyanı model ilə redaktə etmək mümkün deyil. Orijinal brifdən yeni strategiya yaradın.",
  };
  const code = typeof error.code === "string" ? error.code : "STRATEGY_ERROR";
  return {
    error: messages[code] || "Strategiya generasiyası uğursuz oldu. Yenidən cəhd edin.",
    code, status: httpStatusOf(error),
    retryable: ["AI_TIMEOUT", "AI_RATE_LIMITED", "AI_INVALID_OUTPUT", "AI_MAX_TOKENS", "AI_PROVIDER_UNAVAILABLE"].includes(code),
    ...(typeof error.requestId === "string" && /^[a-f0-9-]{36}$/i.test(error.requestId) ? { requestId: error.requestId } : {}),
  };
}

// Periodic cleanup for requestWindows to prevent memory leaks
setInterval(() => {
  const now = Date.now();
  for (const [key, history] of requestWindows.entries()) {
    const valid = (history || []).filter((timestamp) => now - timestamp < 10 * 60 * 1000);
    if (valid.length === 0) {
      requestWindows.delete(key);
    } else {
      requestWindows.set(key, valid);
    }
  }
}, 5 * 60 * 1000).unref();

function getClientIp(req) {
  return req.ip || req.socket?.remoteAddress || "127.0.0.1";
}

function rateLimit(limit, windowMs = 10 * 60 * 1000, scope = "generation", redis = null) {
  const applyLocalRateLimit = (req, res, next) => {
    const now = Date.now();
    const clientIp = getClientIp(req);
    const identifier = req.user?.id ? `user:${req.user.id}` : `ip:${clientIp}`;
    const key = `strat:${scope}:${identifier}:${req.baseUrl || "/api/strategy"}`;
    const history = (requestWindows.get(key) || []).filter((timestamp) => now - timestamp < windowMs);
    if (history.length >= limit) {
      const oldestTs = history[0] || now;
      const retryAfterSec = Math.max(1, Math.ceil((oldestTs + windowMs - now) / 1000));
      res.setHeader("Retry-After", String(retryAfterSec));
      return res.status(429).json({
        error: "Hazırda çox sayda sorğu göndərilib. Bir neçə dəqiqə sonra yenidən yoxla.",
        code: "RATE_LIMITED",
      });
    }
    history.push(now);
    requestWindows.set(key, history);
    return next();
  };

  return (req, res, next) => {
    if (!redis?.isReady) {
      return applyLocalRateLimit(req, res, next);
    }
    const now = Date.now();
    const clientIp = getClientIp(req);
    const identifier = req.user?.id ? `user:${req.user.id}` : `ip:${clientIp}`;
    const actorDigest = createHash("sha256")
      .update(`${scope}:${identifier}:${req.baseUrl || "/api/strategy"}`)
      .digest("hex")
      .slice(0, 32);
    const windowBucket = Math.floor(now / windowMs);
    const redisKey = `strat:rl:${scope}:${actorDigest}:${windowBucket}`;
    const retryAfterSec = Math.max(1, Math.ceil(((windowBucket + 1) * windowMs - now) / 1000));

    return (async () => {
      try {
        let count = null;
        if (typeof redis.eval === "function") {
          count = Number(
            await redis.eval(
              "local c = redis.call('incr', KEYS[1]); if tonumber(c) == 1 then redis.call('pexpire', KEYS[1], ARGV[1]); end; return c",
              { keys: [redisKey], arguments: [String(windowMs)] },
            ),
          );
        } else if (typeof redis.incr === "function") {
          count = Number(await redis.incr(redisKey));
          if (count === 1) {
            if (typeof redis.pExpire === "function") await redis.pExpire(redisKey, windowMs);
            else if (typeof redis.expire === "function") await redis.expire(redisKey, Math.max(1, Math.ceil(windowMs / 1000)));
          }
        }
        if (Number.isFinite(count) && count >= 1) {
          if (count > limit) {
            res.setHeader("Retry-After", String(retryAfterSec));
            return res.status(429).json({
              error: "Hazırda çox sayda sorğu göndərilib. Bir neçə dəqiqə sonra yenidən yoxla.",
              code: "RATE_LIMITED",
            });
          }
          return next();
        }
      } catch {
        // Fallback to process-local rate window if Redis encounters a transient error
      }
      return applyLocalRateLimit(req, res, next);
    })().catch(next);
  };
}

const MAX_BODY_ARRAY_LENGTH = 250;
const MAX_BODY_OBJECT_KEYS = 250;
const MAX_BODY_DEPTH = 14;

function hasOversizedCollection(value, depth = 0) {
  if (!value || typeof value !== "object") return false;
  if (depth > MAX_BODY_DEPTH) return true;
  if (Array.isArray(value)) {
    if (value.length > MAX_BODY_ARRAY_LENGTH) return true;
    for (let i = 0; i < value.length; i += 1) {
      if (hasOversizedCollection(value[i], depth + 1)) return true;
    }
    return false;
  }
  const keys = Object.keys(value);
  if (keys.length > MAX_BODY_OBJECT_KEYS) return true;
  for (let i = 0; i < keys.length; i += 1) {
    if (DANGEROUS_PROTO_KEYS.has(keys[i])) return true;
    if (hasOversizedCollection(value[keys[i]], depth + 1)) return true;
  }
  return false;
}

function parse(schema, body) {
  if (body && typeof body === "object" && hasOversizedCollection(body)) {
    const error = new Error("Invalid request: collection size limit exceeded.");
    error.code = "VALIDATION_ERROR";
    error.details = [{ field: "body", message: "Collection size limit exceeded." }];
    throw error;
  }
  const result = schema.safeParse(body);
  if (!result.success) {
    const error = new Error("Invalid request");
    error.code = "VALIDATION_ERROR";
    error.details = formatValidationError(result.error);
    throw error;
  }
  return result.data;
}

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function publicRecord(record) {
  const { ownerId: _ownerId, clientSaveId: _clientSaveId, ...safe } = record;
  return safe;
}

function resolveLanguage(req, payloadLang) {
  if (payloadLang === "en" || payloadLang === "az") return payloadLang;
  const headerLang = req?.headers?.["x-helmer-language"] || req?.headers?.["x-language"];
  if (headerLang === "en" || headerLang === "az") return headerLang;
  if (req?.user?.settings?.language === "en" || req?.user?.settings?.language === "az") {
    return req.user.settings.language;
  }
  const accept = String(req?.headers?.["accept-language"] || "").toLowerCase();
  if (accept.startsWith("en") || accept.includes("en-") || accept.includes("en,")) return "en";
  return "az";
}

function getReqPrivacySnapshot(req) {
  if (req?.securityContext?.privacySnapshot) return req.securityContext.privacySnapshot;
  if (req?.user) {
    return { enabled: req.user.settings?.modelImprovement === true, epoch: req.user.privacyEpoch || 0, ownerId: req.user.id };
  }
  return null;
}

async function runTrackedBuild({
  learningLoop,
  telemetryService,
  ownerId,
  taskType,
  userPrompt,
  relevantContext,
  execute,
  onlyNecessaryData = false,
  modelImprovement = true,
  privacySnapshot = null,
}) {
  if (!learningLoop && !telemetryService) return { result: await execute(() => {}), interactionId: null };
  const interactionId = learningLoop ? learningLoop.createInteractionId() : null;
  const startedAt = Date.now();
  let providerMeta = { provider: "google", model: buildConfig.strategistModel, usage: null, stageMetrics: [] };
  const isRestricted = onlyNecessaryData || modelImprovement === false;
  let searchObserved = false;
  let searchAttempted = false;
  try {
    const result = await execute((meta) => {
      searchObserved ||= Boolean(meta?.groundingActive || meta?.searchGrounded);
      searchAttempted ||= Boolean(meta?.searchAttempted);
      if (!meta?.model) return;
      const prevUsage = providerMeta.usage;
      const stageMetrics = [
        ...(Array.isArray(providerMeta.stageMetrics) ? providerMeta.stageMetrics : []),
        ...(meta?.phase ? [{
          phase: meta.phase,
          model: meta.model,
          thinkingLevel: meta.thinkingLevel || null,
          latencyMs: meta.latencyMs ?? 0,
          firstChunkMs: meta.firstChunkMs ?? null,
          usageStatus: meta.usageStatus || (meta?.usage ? "measured" : "unavailable"),
          estimatedUsdMicros: meta.estimatedUsdMicros ?? null,
          groundingActive: Boolean(meta.groundingActive),
          verifiedSourcesCount: Number(meta.verifiedSourcesCount || 0),
          attempt: meta.attempt || 1,
          location: meta.location || null,
          fallbackUsed: Boolean(meta.fallbackUsed),
          usage: meta.usage || null,
        }] : []),
      ];
      let nextUsage = prevUsage;
      if (meta?.usage) {
        const prompt_tokens = (prevUsage?.prompt_tokens || 0) + (meta.usage.prompt_tokens || 0);
        const visible_output_tokens = (prevUsage?.visible_output_tokens || 0) + (meta.usage.visible_output_tokens ?? meta.usage.completion_tokens ?? 0);
        const thoughts_tokens = (prevUsage?.thoughts_tokens || 0) + (meta.usage.thoughts_tokens || 0);
        const completion_tokens = (prevUsage?.completion_tokens || 0) + (meta.usage.completion_tokens || 0);
        const total_tokens = (prevUsage?.total_tokens || 0) + (meta.usage.total_tokens || 0);
        const estimatedUsdMicros = (prevUsage?.estimatedUsdMicros || 0) + (meta.estimatedUsdMicros || 0);
        nextUsage = {
          prompt_tokens,
          visible_output_tokens,
          thoughts_tokens,
          completion_tokens,
          total_tokens,
          estimatedUsdMicros,
          usageStatus: "measured",
        };
      }
      providerMeta = { ...providerMeta, ...meta, usage: nextUsage, stageMetrics };
    });
    const groundingActive = searchObserved || isGroundedStrategyRecord(result);
    const effectiveRestricted = Boolean(isRestricted || groundingActive);
    if (learningLoop) {
      logWithoutBlocking(learningLoop.recordInteraction({
        id: interactionId,
        ownerId,
        mode: "build",
        taskType,
        userPrompt: effectiveRestricted ? "[Zəruri əməliyyat qeydi - Məzmun ötürülmür]" : userPrompt,
        relevantContext: effectiveRestricted ? null : relevantContext,
        modelProvider: providerMeta.provider,
        modelName: providerMeta.model,
        modelResponse: effectiveRestricted ? "[Zəruri əməliyyat qeydi - Məzmun ötürülmür]" : result,
        usage: providerMeta.usage,
        latencyMs: Date.now() - startedAt,
        requestStatus: "success",
        groundingActive,
        onlyNecessaryData: effectiveRestricted,
        modelImprovement: !effectiveRestricted,
        privacySnapshot,
      }), `Build ${taskType} logging`);
    }
    if (telemetryService) {
      telemetryService.trackBuildStrategy({
        ownerId,
        brief: effectiveRestricted ? "" : userPrompt,
        model: providerMeta.model,
        latencyMs: Date.now() - startedAt,
        usage: providerMeta.usage,
        groundingActive,
        status: "success",
        strategy: effectiveRestricted ? null : result,
        action: taskType,
        onlyNecessaryData: effectiveRestricted,
        modelImprovement: !effectiveRestricted,
      }).catch(() => {});
    }
    return { result, interactionId, providerMeta };
  } catch (error) {
    const errorGroundingActive = searchObserved || searchAttempted;
    const errorRestricted = Boolean(isRestricted || errorGroundingActive);
    if (learningLoop) {
      logWithoutBlocking(learningLoop.recordInteraction({
        id: interactionId,
        ownerId,
        mode: "build",
        taskType,
        userPrompt: errorRestricted ? "[Zəruri əməliyyat qeydi - Məzmun ötürülmür]" : userPrompt,
        relevantContext: errorRestricted ? null : relevantContext,
        modelProvider: providerMeta.provider,
        modelName: providerMeta.model,
        modelResponse: errorRestricted ? "[Zəruri əməliyyat qeydi - Məzmun ötürülmür]" : "",
        usage: providerMeta.usage,
        latencyMs: Date.now() - startedAt,
        requestStatus: "error",
        errorType: error?.code || error?.name || "BUILD_ERROR",
        groundingActive: errorGroundingActive,
        onlyNecessaryData: errorRestricted,
        modelImprovement: !errorRestricted,
        privacySnapshot,
      }), `Build ${taskType} failure logging`);
    }
    if (telemetryService) {
      telemetryService.trackBuildStrategy({
        ownerId,
        brief: errorRestricted ? "" : userPrompt,
        model: providerMeta.model,
        latencyMs: Date.now() - startedAt,
        usage: providerMeta.usage,
        groundingActive: errorGroundingActive,
        status: "error",
        error,
        action: taskType,
        onlyNecessaryData: errorRestricted,
        modelImprovement: !errorRestricted,
      }).catch(() => {});
    }
    throw error;
  }
}

export function createStrategyRouter(repository, learningLoop = null, options = {}) {
  const router = express.Router();
  const telemetryService = options?.telemetryService || null;
  const routeIdempotencyState = new Map();
  const generationServices = options.generationServices || { assessBrief, generateStrategy, refineStrategy };
  const decisionRouter = options?.decisionRouter || createHelmerDecisionRouter({ redis: options?.redis || null });
  const resolvePreFlightBuildDecision = async ({ payload, existingStrategy = null, isBriefGeneration = true, signal }) => {
    const effectiveBuildMode = payload.buildMode === "faster"
      ? "faster"
      : (payload.buildMode || (existingStrategy?.orchestration?.buildMode === "faster" ? "faster" : "auto"));
    if (effectiveBuildMode === "faster") {
      return { buildDecision: null, effectiveBuildMode: "faster" };
    }
    const promptText = payload.action === "custom" ? payload.request : (payload.brief || "");
    const existingSummary = existingStrategy?.summary || payload.strategy?.summary || "";
    try {
      const decision = await decisionRouter.routeBuild({
        prompt: promptText,
        hasAttachments: Boolean(payload.hasAttachments),
        isBriefGeneration,
        hasExistingBrief: Boolean(existingStrategy || payload.strategy),
        existingBriefSummary: existingSummary,
        signal,
      });
      if (!decision || typeof decision !== "object" || !decision.targetModel || !decision.thinkingLevel) {
        return {
          buildDecision: deterministicBuildFallbackRoute({
            prompt: promptText,
            hasExistingBrief: Boolean(existingStrategy || payload.strategy),
            existingBriefSummary: existingSummary,
            fallbackReason: "decision_invalid_format",
          }),
          effectiveBuildMode,
        };
      }
      return { buildDecision: decision, effectiveBuildMode };
    } catch (error) {
      assertExecutionActive(error, signal);
      if (error?.isSafetyBlock || ["AI_SAFETY_BLOCKED", "AI_CONTENT_BLOCKED"].includes(error?.code)) throw error;
      console.warn("[Build decision] Pre-flight routing failed; using deterministic Hydrogen fallback", {
        code: error?.code || "DECISION_ERROR",
      });
      return {
        buildDecision: deterministicBuildFallbackRoute({
          prompt: promptText,
          hasExistingBrief: Boolean(existingStrategy || payload.strategy),
          existingBriefSummary: existingSummary,
          fallbackReason: "decision_exception",
        }),
        effectiveBuildMode,
      };
    }
  };
  const isGenerationRequest = req => req.method === "POST" && /^\/(?:estimate|assess|generate|generate-stream|refine|[0-9a-f-]{36}\/refine)\/?$/i.test(req.path);

  const readRequestHeaderKey = (req) => {
    const raw = typeof req.get === "function"
      ? req.get("Idempotency-Key")
      : (req.headers?.["idempotency-key"] || req.headers?.["Idempotency-Key"] || "");
    return typeof raw === "string" ? raw.trim() : "";
  };

  const resolveRequestIdempotencyKey = (req, payload = null) => {
    const headerKey = readRequestHeaderKey(req);
    const rawBodyKey = payload?.idempotencyKey ?? req.body?.idempotencyKey;
    const bodyKey = typeof rawBodyKey === "string" ? rawBodyKey.trim() : "";
    if (bodyKey && headerKey && bodyKey !== headerKey) {
      const conflictErr = new Error("Eyni idempotency açarı fərqli parametrlərlə istifadə edilib.");
      conflictErr.code = "IDEMPOTENCY_CONFLICT";
      conflictErr.status = 409;
      throw conflictErr;
    }
    return bodyKey || headerKey || null;
  };

  async function executeSharedRefinement({ refineKey, fingerprint, subscriberId, req, res, execute }) {
    const isSecurityAbortReason = (reason) => Boolean(
      reason &&
      typeof reason === "object" &&
      /^(EXECUTION_|RESEARCH_RESTART|GROUNDING_|PROVENANCE_|DAILY_BUDGET_|MODEL_PRICING_|TOOL_PRICING_)/.test(reason.code || "")
    );

    const attachSubscriber = (entry, subId, subReq, subRes) => {
      entry.subscribers.add(subId);
      const subContext = subReq?.securityContext || null;
      if (subContext) {
        entry.subscriberContexts.set(subId, subContext);
      }

      const subSignal = subContext?.signal || null;
      const onSecurityAbort = () => {
        if (!entry.settled && isSecurityAbortReason(subSignal?.reason)) {
          entry.abortController.abort(subSignal.reason);
        }
      };
      if (subSignal) {
        if (subSignal.aborted) {
          onSecurityAbort();
        } else {
          subSignal.addEventListener("abort", onSecurityAbort, { once: true });
        }
      }

      let detached = false;
      const detach = (fromReqClose = false) => {
        if (detached) return;
        if (fromReqClose && subReq.complete && !subRes.destroyed && !subRes.closed) return;
        if (subRes.writableEnded) return;
        detached = true;
        entry.subscribers.delete(subId);
        entry.subscriberContexts.delete(subId);
        if (entry.subscribers.size === 0 && !entry.settled) {
          entry.abortController.abort();
          entry.releaseLease?.();
        }
      };
      const onReqClose = () => detach(true);
      const onResClose = () => detach(false);
      subReq.on?.("close", onReqClose);
      subRes.on?.("close", onResClose);

      return () => {
        subReq.off?.("close", onReqClose);
        subRes.off?.("close", onResClose);
        if (subSignal) {
          try { subSignal.removeEventListener("abort", onSecurityAbort); } catch {}
        }
        entry.subscribers.delete(subId);
        entry.subscriberContexts.delete(subId);
        if (entry.settled && entry.subscribers.size === 0) {
          setImmediate(() => {
            if (entry.settled && entry.subscribers.size === 0) {
              entry.releaseLease?.();
            }
          }).unref?.();
        }
      };
    };

    if (refineKey && activeRefinements.has(refineKey)) {
      const entry = activeRefinements.get(refineKey);
      if (entry.fingerprint && entry.fingerprint !== fingerprint) {
        const conflictErr = new Error("Eyni idempotency açarı fərqli parametrlərlə istifadə edilib.");
        conflictErr.code = "IDEMPOTENCY_CONFLICT";
        conflictErr.status = 409;
        throw conflictErr;
      }
      if (entry.settled && entry.result) {
        return entry.result;
      }
      const cleanupSubscriber = attachSubscriber(entry, subscriberId, req, res);
      try {
        return await entry.promise;
      } finally {
        cleanupSubscriber();
      }
    }

    const baseContext = req?.securityContext || null;
    const lease = refineKey && baseContext?.transferToBackground ? baseContext.transferToBackground() : null;
    const abortController = baseContext ? new AbortController() : createExecutionController();
    let leaseReleased = false;
    const entry = {
      promise: null,
      fingerprint,
      abortController,
      subscribers: new Set(),
      subscriberContexts: new Map(),
      settled: false,
      result: null,
      lease,
      releaseLease: () => {
        if (leaseReleased || !lease?.release) return;
        leaseReleased = true;
        return Promise.resolve().then(() => lease.release()).catch(() => {});
      },
    };

    const cleanupCreator = attachSubscriber(entry, subscriberId, req, res);
    if (res?.once) {
      res.once("finish", () => {
        if (entry.settled && entry.subscribers.size === 0) {
          entry.releaseLease?.();
        }
      });
    }

    const sharedContext = baseContext
      ? {
          ...baseContext,
          controller: abortController,
          signal: abortController.signal,
          markMutationPending: () => {
            baseContext.markMutationPending?.();
            for (const ctx of entry.subscriberContexts.values()) {
              if (ctx !== baseContext) ctx?.markMutationPending?.();
            }
          },
          recordIdempotentResult: (...args) => {
            baseContext.recordIdempotentResult?.(...args);
            for (const ctx of entry.subscriberContexts.values()) {
              if (ctx !== baseContext) ctx?.recordIdempotentResult?.(...args);
            }
          },
          assertAuthorized: async () => {
            const activeContexts = entry.subscriberContexts.size > 0
              ? [...entry.subscriberContexts.values()]
              : [baseContext];
            await Promise.all([
              ...activeContexts.map((ctx) => (ctx?.assertAuthorized ? ctx.assertAuthorized() : Promise.resolve())),
              ...(lease?.assertOwned ? [lease.assertOwned()] : []),
            ]);
          },
        }
      : null;

    const refinePromise = sharedContext
      ? executionContext.run(sharedContext, () => execute(abortController.signal))
      : execute(abortController.signal);
    entry.promise = refinePromise;
    if (refineKey) {
      activeRefinements.set(refineKey, entry);
      refinePromise.then(
        (val) => {
          entry.settled = true;
          entry.result = val;
          setTimeout(() => {
            if (activeRefinements.get(refineKey) === entry) {
              activeRefinements.delete(refineKey);
            }
          }, 5 * 60 * 1000).unref();
          setImmediate(() => {
            if (entry.subscribers.size === 0) entry.releaseLease?.();
          }).unref?.();
        },
        () => {
          entry.settled = true;
          if (activeRefinements.get(refineKey) === entry) {
            activeRefinements.delete(refineKey);
          }
          entry.releaseLease?.();
        },
      );
    }

    try {
      return await refinePromise;
    } finally {
      cleanupCreator();
    }
  }

  async function runWithRouteIdempotency(operation, ownerId, idKey, fingerprint, fn) {
    if (!idKey) return fn();
    const requestKey = createHash("sha256").update(`${ownerId}:${operation}:${idKey}`).digest("hex");
    const now = Date.now();
    for (const [key, entry] of routeIdempotencyState) if (entry.expiresAt <= now) routeIdempotencyState.delete(key);
    const previous = routeIdempotencyState.get(requestKey);
    if (previous && previous.fingerprint !== fingerprint) {
      const conflictErr = new Error("Eyni sorğu açarı fərqli parametrlərlə istifadə edilib.");
      conflictErr.code = "IDEMPOTENCY_CONFLICT";
      conflictErr.status = 409;
      throw conflictErr;
    }
    if (previous?.status === "completed" && previous.response) {
      return previous.response;
    }
    if (previous?.status === "pending" && previous.promise) {
      return previous.promise;
    }

    const redis = options?.redis;
    const useRedis = Boolean(redis?.isReady && typeof redis.set === "function" && typeof redis.get === "function");
    const redisKey = `strat:route_idem:${requestKey}`;
    const lockToken = randomUUID();
    const pendingPayload = JSON.stringify({ state: "pending", fingerprint, token: lockToken });

    if (useRedis) {
      let claimed = false;
      try {
        claimed = Boolean(await redis.set(redisKey, pendingPayload, { NX: true, EX: 900 }));
      } catch {
        claimed = false;
      }
      if (!claimed) {
        let rawExisting = null;
        try {
          rawExisting = await redis.get(redisKey);
        } catch {
          rawExisting = null;
        }
        if (rawExisting) {
          let existing = null;
          try { existing = JSON.parse(rawExisting); } catch { existing = null; }
          if (!existing || existing.fingerprint !== fingerprint) {
            const conflictErr = new Error("Eyni sorğu açarı fərqli parametrlərlə istifadə edilib.");
            conflictErr.code = "IDEMPOTENCY_CONFLICT";
            conflictErr.status = 409;
            throw conflictErr;
          }
          if (existing.state === "completed" && existing.response !== undefined) {
            return existing.response;
          }
          if (existing.state === "pending") {
            const pendingErr = new Error("Eyni sorğu artıq icra olunur.");
            pendingErr.code = "REQUEST_ALREADY_SUBMITTED";
            pendingErr.status = 409;
            throw pendingErr;
          }
        } else {
          // Transient error or race where key disappeared right before get: try NX claim once more cleanly
          try {
            claimed = Boolean(await redis.set(redisKey, pendingPayload, { NX: true, EX: 900 }));
          } catch {}
        }
      }
    }

    if (routeIdempotencyState.size >= 512) routeIdempotencyState.delete(routeIdempotencyState.keys().next().value);
    const entry = {
      fingerprint,
      status: "pending",
      response: null,
      expiresAt: now + 15 * 60 * 1000,
      promise: null,
    };
    entry.promise = Promise.resolve().then(fn).then(
      async (result) => {
        entry.status = "completed";
        entry.response = result;
        if (useRedis) {
          const completedPayload = JSON.stringify({ state: "completed", fingerprint, response: result });
          try {
            if (typeof redis.eval === "function") {
              await redis.eval(
                "if redis.call('get',KEYS[1]) == ARGV[1] then redis.call('set',KEYS[1],ARGV[2],'EX',900); return 1 end; return 0",
                { keys: [redisKey], arguments: [pendingPayload, completedPayload] },
              );
            } else {
              await redis.set(redisKey, completedPayload, { EX: 900 });
            }
          } catch {}
        }
        return result;
      },
      async (err) => {
        if (routeIdempotencyState.get(requestKey) === entry) {
          routeIdempotencyState.delete(requestKey);
        }
        if (useRedis) {
          try {
            if (typeof redis.eval === "function") {
              await redis.eval(
                "if redis.call('get',KEYS[1]) == ARGV[1] then return redis.call('del',KEYS[1]) end; return 0",
                { keys: [redisKey], arguments: [pendingPayload] },
              );
            } else if (typeof redis.del === "function") {
              await redis.del(redisKey);
            }
          } catch {}
        }
        throw err;
      },
    );
    routeIdempotencyState.set(requestKey, entry);
    return entry.promise;
  }

  const estimateRateLimit = rateLimit(20, 10 * 60 * 1000, "estimate", options?.redis);
  const generationRateLimit = rateLimit(30, 10 * 60 * 1000, "generation", options?.redis);
  router.use((req, res, next) => (req.path === "/estimate" ? estimateRateLimit : generationRateLimit)(req, res, next));
  router.use((req, res, next) => {
    if (isGenerationRequest(req)) {
      const headerKey = readRequestHeaderKey(req);
      if (!/^[A-Za-z0-9_-]{16,100}$/.test(headerKey)) {
        return res.status(400).json({ code: "IDEMPOTENCY_KEY_REQUIRED", error: "Etibarlı sorğu açarı tələb olunur." });
      }
      const rawBodyKey = req.body?.idempotencyKey;
      const bodyKey = typeof rawBodyKey === "string" ? rawBodyKey.trim() : "";
      if (bodyKey && bodyKey !== headerKey) {
        return res.status(409).json({ code: "IDEMPOTENCY_CONFLICT", error: "Eyni sorğu açarı fərqli parametrlərlə istifadə edilib." });
      }
    }
    return next();
  });
  router.use(createAskExecutionGuard({
    redis: options.redis, allowGuest: true,
    hasActiveJobForOwner: options.hasActiveJobForOwner,
    matchesRequest: isGenerationRequest,
  }));

  router.post("/estimate", asyncRoute(async (req, res) => {
    const payload = parse(BuildEstimateRequestSchema, req.body);
    const idKey = readRequestHeaderKey(req);
    const fingerprint = computePayloadFingerprint("estimate", payload);
    const controller = createExecutionController();
    const onRequestClose = () => { if (!req.complete && !res.writableEnded) controller.abort(); };
    const onResponseClose = () => { if (!res.writableEnded) controller.abort(); };
    req.on("close", onRequestClose);
    res.on("close", onResponseClose);
    res.setHeader("Cache-Control", "no-store");
    try {
      const responseBody = await runWithRouteIdempotency("estimate", req.ownerId, idKey, fingerprint, async () => {
        const buildDecision = payload.buildMode === "faster"
          ? null
          : (await resolvePreFlightBuildDecision({
            payload,
            isBriefGeneration: true,
            signal: controller.signal,
          })).buildDecision;
        const preparationEstimate = await estimateBuildPreparation({
          brief: payload.brief,
          buildMode: payload.buildMode,
          fasterThinkingLevel: payload.fasterThinkingLevel,
          buildDecision,
          ownerId: req.ownerId,
          signal: controller.signal,
        });
        await assertExecutionAuthorized(controller.signal);
        return { preparationEstimate };
      });
      if (!res.writableEnded) res.json(responseBody);
    } finally {
      req.off("close", onRequestClose);
      res.off("close", onResponseClose);
    }
  }));

  router.post(
    "/assess",
    asyncRoute(async (req, res) => {
      const payload = parse(AssessRequestSchema, req.body);
      const idKey = readRequestHeaderKey(req);
      const fingerprint = computePayloadFingerprint("assess", payload);
      const abortController = createExecutionController();
      const onReqClose = () => {
        if (!req.complete && !res.writableEnded) abortController.abort();
      };
      const onResClose = () => {
        if (!res.writableEnded) abortController.abort();
      };
      if (typeof req?.on === "function") req.on("close", onReqClose);
      if (typeof res?.on === "function") res.on("close", onResClose);

      try {
        const responseBody = await runWithRouteIdempotency("assess", req.ownerId, idKey, fingerprint, async () => {
          const language = resolveLanguage(req, payload.language);
          const personalizationContext = buildStrategyPersonalizationContext({
            user: req.user,
          });
          const marketMode = detectTargetMarket({ brief: payload.brief, answers: payload.answers });
          const modelImprovement = isModelImprovementEnabled(req);
          const { buildDecision, effectiveBuildMode } = await resolvePreFlightBuildDecision({
            payload,
            isBriefGeneration: true,
            signal: abortController.signal,
          });
          let preparationEstimate;
          const tracked = await runTrackedBuild({
            learningLoop, telemetryService, ownerId: req.ownerId, taskType: "build_assess", userPrompt: payload.brief,
            relevantContext: { personalizationApplied: Boolean(personalizationContext), language, marketMode },
            execute: (onUsage) => generationServices.assessBrief({
              ...payload,
              ...(effectiveBuildMode ? { buildMode: effectiveBuildMode } : {}),
              buildDecision,
              language,
              ownerId: req.ownerId,
              personalizationContext,
              signal: abortController.signal,
              onUsage,
              onEstimate: value => { preparationEstimate = value; },
            }),
            onlyNecessaryData: !modelImprovement || Boolean(buildDecision?.needsMarketSearch),
            modelImprovement,
            privacySnapshot: getReqPrivacySnapshot(req),
          });
          return {
            assessment: tracked.result,
            preparationEstimate,
          };
        });
        if (!res.writableEnded) {
          res.json({
            ...responseBody,
            ...(req.user ? {} : {
              isGuest: true,
            }),
          });
        }
      } finally {
        if (typeof req?.off === "function") req.off("close", onReqClose);
        if (typeof res?.off === "function") res.off("close", onResClose);
      }
    }),
  );

  async function getOrCreateGeneration({
    payload,
    ownerId,
    user,
    req,
    subscriberId = randomUUID(),
    onEntry = null,
    onChunk = null,
  }) {
    const fingerprint = computePayloadFingerprint("generate", payload);
    const requestKey = `${ownerId}:${payload.idempotencyKey}`;

    const findSaved = async () => {
      const tenantRecords = typeof repository.readTenant === "function"
        ? await repository.readTenant(ownerId)
        : await repository.readAll(ownerId);

      const existingSaved = tenantRecords.find(
        (r) => r.clientSaveId === payload.idempotencyKey && r.saveOrigin !== "manual"
      );
      if (existingSaved) {
        if (isExpiredGroundedStrategyRecord(existingSaved)) {
          return null;
        }
        if (existingSaved.payloadFingerprint) {
          const matchesCanonical = existingSaved.payloadFingerprint === fingerprint;
          const matchesLegacy = existingSaved.payloadFingerprint === computeLegacyPayloadFingerprint("generate", payload);
          if (!matchesCanonical && !matchesLegacy) {
            const conflictErr = new Error("Eyni idempotency açarı fərqli parametrlərlə istifadə edilib.");
            conflictErr.code = "IDEMPOTENCY_CONFLICT";
            conflictErr.status = 409;
            throw conflictErr;
          }
        } else {
          const savedBrief = typeof existingSaved.brief === "string" ? existingSaved.brief.trim() : "";
          const reqBrief = typeof payload.brief === "string" ? payload.brief.trim() : "";
          const savedAnswers = JSON.stringify(canonicalize(existingSaved.clarification?.answers || []));
          const reqAnswers = JSON.stringify(canonicalize(payload.answers || []));
          const savedBuildMode = existingSaved.strategy?.orchestration?.buildMode;
          const reqBuildMode = payload.buildMode;
          if (
            savedBrief !== reqBrief ||
            savedAnswers !== reqAnswers ||
            (savedBuildMode && reqBuildMode && savedBuildMode !== reqBuildMode)
          ) {
            const conflictErr = new Error("Eyni idempotency açarı fərqli parametrlərlə istifadə edilib.");
            conflictErr.code = "IDEMPOTENCY_CONFLICT";
            conflictErr.status = 409;
            throw conflictErr;
          }
        }
        return {
          result: existingSaved.strategy,
          interactionId: existingSaved.learningInteractionId || null,
          savedRecord: existingSaved,
          fromStore: true,
        };
      }

      return null;
    };
    const saved = await findSaved();
    if (saved) return saved;

    // 2. In-process active generation check
    let activeEntry = activeGenerations.get(requestKey);
    if (activeEntry) {
      if (activeEntry.fingerprint !== fingerprint) {
        const conflictErr = new Error("Eyni idempotency açarı fərqli parametrlərlə icra edilir.");
        conflictErr.code = "IDEMPOTENCY_CONFLICT";
        conflictErr.status = 409;
        throw conflictErr;
      }
      activeEntry.subscribers.add(subscriberId);
      if (onChunk) {
        activeEntry.onChunkListeners.set(subscriberId, onChunk);
      }
      if (onEntry) onEntry(activeEntry);
      return activeEntry.promise;
    }

    // 3. Acquire distributed / cross-process lock
    const redis = options?.redis || repository?.redis || null;
    const locksDir = repository?.strategiesDir
      ? path.join(path.dirname(repository.strategiesDir), ".strategy-locks")
      : null;

    let distLock = await acquireIdempotencyLock({
      ownerId,
      idempotencyKey: payload.idempotencyKey,
      operation: "generate",
      redis,
      locksDir,
      timeoutMs: 120000,
      storage: options.leaseStorage,
    });

    if (!distLock) {
      // Another instance holds the lock! Wait and poll for authoritative result or lock release
      const maxWaitMs = 60000;
      const pollStart = Date.now();
      while (Date.now() - pollStart < maxWaitMs) {
        await new Promise((r) => setTimeout(r, 200));

        const persisted = await findSaved();
        if (persisted) return persisted;

        // Try to acquire lock if previous instance failed or released
        distLock = await acquireIdempotencyLock({
          ownerId,
          idempotencyKey: payload.idempotencyKey,
          operation: "generate",
          redis,
          locksDir,
          timeoutMs: 120000,
          storage: options.leaseStorage,
        });
        if (distLock) break;
      }

      if (!distLock) {
        const timeoutErr = new Error("Strategiya generasiyası başqa proses tərəfindən icra olunur.");
        timeoutErr.code = "EXECUTION_BUSY";
        timeoutErr.status = 429;
        throw timeoutErr;
      }
    }

    // 4. Create in-flight generation with subscriber tracking
    const masterAbortController = createExecutionController();
    const generationSignal = AbortSignal.any([masterAbortController.signal, distLock.signal]);
    const subscribers = new Set([subscriberId]);
    const onChunkListeners = new Map();
    if (onChunk) {
      onChunkListeners.set(subscriberId, onChunk);
    }

    const generationPromise = (async () => {
      try {
        // The pre-lock snapshot may have been read before another replica committed.
        const completed = await findSaved();
        if (completed) return completed;
        const cached = await distLock.readResult();
        if (cached) {
          if (cached.fingerprint !== fingerprint) {
            const error = new Error("Eyni idempotency açarı fərqli parametrlərlə istifadə edilib.");
            error.code = "IDEMPOTENCY_CONFLICT";
            error.status = 409;
            throw error;
          }
          const replayRecord = cached.tracked?.savedRecord || cached.tracked?.result || null;
          if (!replayRecord || !isExpiredGroundedStrategyRecord(replayRecord)) {
            return cached.tracked;
          }
        }
        generationSignal.throwIfAborted();
        await distLock.assertOwned();
        const language = resolveLanguage(req, payload.language);
        const personalizationContext = buildStrategyPersonalizationContext({
          user,
        });
        const marketMode = detectTargetMarket({ brief: payload.brief, answers: payload.answers });
        const modelImprovement = isModelImprovementEnabled(req);
        const { buildDecision, effectiveBuildMode } = await resolvePreFlightBuildDecision({
          payload,
          isBriefGeneration: true,
          signal: generationSignal,
        });
        const tracked = await runTrackedBuild({
          learningLoop,
          telemetryService,
          ownerId,
          taskType: "build_generate",
          userPrompt: payload.brief,
          relevantContext: {
            personalizationApplied: Boolean(personalizationContext),
            language,
            marketMode,
            decisionRouterSource: buildDecision?.routerSource,
          },
          execute: (onUsage) =>
            generationServices.generateStrategy({
              ...payload,
              ...(effectiveBuildMode ? { buildMode: effectiveBuildMode } : {}),
              buildDecision,
              language,
              ownerId,
              personalizationContext,
              signal: generationSignal,
              onUsage,
              onChunk: (chunkInfo) => {
                for (const listener of onChunkListeners.values()) {
                  try { listener(chunkInfo); } catch {}
                }
              },
            }),
          onlyNecessaryData: !modelImprovement || Boolean(buildDecision?.needsMarketSearch),
          modelImprovement,
          privacySnapshot: getReqPrivacySnapshot(req),
        });

        generationSignal.throwIfAborted();
        await distLock.assertOwned();
        await assertExecutionAuthorized(generationSignal);
        const strategy = tracked.result;
        const isGroundedGeneration =
          isGroundedStrategyRecord(strategy) ||
          Boolean(tracked.providerMeta?.stageMetrics?.some((stage) => stage.groundingActive));
        if (isGroundedGeneration) {
          if (typeof repository.rememberProvenance === "function") {
            await repository.rememberProvenance(ownerId, strategy, {
              clientSaveId: payload.idempotencyKey,
              forceGrounded: true,
            });
          } else {
            rememberGroundedStrategyProvenance(ownerId, strategy, {
              clientSaveId: payload.idempotencyKey,
              forceGrounded: true,
            });
          }
        }
        const isGuest = !user && (Boolean(req?.securityContext?.guest) || String(ownerId || "").startsWith("guest_"));
        const explicitAutoSave = typeof req?.body?.autoSave === "boolean" ? req.body.autoSave : undefined;
        const shouldAutoSave = isGuest
          ? false
          : explicitAutoSave !== undefined
            ? explicitAutoSave
            : (user?.settings?.autoSaveStrategies !== false);

        let savedRecord = null;
        if (shouldAutoSave) {
          const now = new Date().toISOString();
          req?.securityContext?.markMutationPending?.();
          savedRecord = await repository.create(
            {
              clientSaveId: payload.idempotencyKey,
              saveOrigin: "generate",
              payloadFingerprint: fingerprint,
              brief: payload.brief,
              answers: payload.answers,
              strategy,
              versions: [
                {
                  versionNumber: 1,
                  data: strategy,
                  changeRequest: "İlkin strategiya",
                  createdAt: now,
                },
              ],
              learningInteractionId: tracked.interactionId,
            },
            ownerId,
          );
          if (!savedRecord) {
            const error = new Error("Tenant was deleted during generation.");
            error.code = "TENANT_DELETED";
            error.status = 404;
            throw error;
          }
        }
        if (isGroundedGeneration && savedRecord) {
          if (typeof repository.rememberProvenance === "function") {
            await repository.rememberProvenance(ownerId, savedRecord, {
              id: savedRecord.id,
              clientSaveId: savedRecord.clientSaveId || payload.idempotencyKey,
              forceGrounded: true,
            });
          } else {
            rememberGroundedStrategyProvenance(ownerId, savedRecord, {
              id: savedRecord.id,
              clientSaveId: savedRecord.clientSaveId || payload.idempotencyKey,
              forceGrounded: true,
            });
          }
        }
        const completedResult = { ...tracked, result: savedRecord?.strategy || tracked.result, savedRecord };
        const escalatedToFlagship = Boolean(completedResult.result?.orchestration?.escalatedToFlagship);
        req?.securityContext?.recordIdempotentResult?.(200, {
          strategy: completedResult.result,
          savedStrategy: savedRecord ? publicRecord(savedRecord) : null,
          savedId: savedRecord ? savedRecord.id : null,
          ...(escalatedToFlagship
            ? { escalatedToFlagship: true, routingTier: "flagship" }
            : (completedResult.result?.orchestration?.buildMode === "auto"
              ? { escalatedToFlagship: false, routingTier: "standard" }
              : {})),
        });
        if (!shouldAutoSave) await distLock.saveResult({ fingerprint, tracked: completedResult });
        return completedResult;
      } finally {
        if (distLock) {
          await distLock.release().catch(() => {});
        }
      }
    })();

    const entry = {
      fingerprint,
      promise: generationPromise,
      masterAbortController,
      subscribers,
      onChunkListeners,
    };

    activeGenerations.set(requestKey, entry);
    if (onEntry) onEntry(entry);

    const clearActive = () => {
      if (activeGenerations.get(requestKey) === entry) {
        activeGenerations.delete(requestKey);
      }
    };
    generationPromise.then(clearActive, clearActive);

    return generationPromise;
  }

  router.post(
    "/generate",
    asyncRoute(async (req, res) => {
      const payload = parse(GenerateRequestSchema, req.body);
      const subscriberId = randomUUID();
      let entry = null, disconnected = false;
      const cleanupSubscriber = () => {
        disconnected = true;
        entry?.subscribers.delete(subscriberId);
        if (entry?.subscribers.size === 0) entry.masterAbortController.abort();
      };
      const onReqClose = () => {
        if (!req.complete && !res.writableEnded) cleanupSubscriber();
      };
      const onResClose = () => {
        if (!res.writableEnded) cleanupSubscriber();
      };
      req.on?.("close", onReqClose);
      res.on?.("close", onResClose);
      try {
        const tracked = await getOrCreateGeneration({
          payload, ownerId: req.ownerId, user: req.user, req, subscriberId,
          onEntry: value => { entry = value; if (disconnected) cleanupSubscriber(); },
        });
        if (!disconnected && !res.writableEnded && !res.destroyed) {
          const savedRecord = tracked.savedRecord || null;
          const escalatedToFlagship = Boolean(tracked.result?.orchestration?.escalatedToFlagship);
          res.json({
            strategy: tracked.result,
            savedStrategy: savedRecord ? publicRecord(savedRecord) : null,
            savedId: savedRecord ? savedRecord.id : null,
            ...(escalatedToFlagship
            ? { escalatedToFlagship: true, routingTier: "flagship" }
            : (tracked.result?.orchestration?.buildMode === "auto"
              ? { escalatedToFlagship: false, routingTier: "standard" }
              : {})),
            ...(req.user ? {} : {
              isGuest: true,
            }),
          });
        }
      } finally {
        req.off?.("close", onReqClose);
        res.off?.("close", onResClose);
        cleanupSubscriber();
      }
    }),
  );

  router.post(
    "/generate-stream",
    asyncRoute(async (req, res) => {
      const payload = parse(GenerateRequestSchema, req.body);
      const subscriberId = randomUUID();
      let generationEntry = null;
      let disconnected = false;
      let drainDeadline;
      const onDrain = () => {
        clearTimeout(drainDeadline);
        drainDeadline = undefined;
      };
      const disposeDrain = () => {
        onDrain();
        res.off("drain", onDrain);
        res.off("finish", disposeDrain);
        res.off("close", disposeDrain);
      };

      const onClose = () => {
        if (req.complete && !res.destroyed && !res.closed) return;
        disconnected = true;
        onDrain();
        if (generationEntry) {
          generationEntry.subscribers?.delete(subscriberId);
          generationEntry.onChunkListeners?.delete(subscriberId);
          if (generationEntry.subscribers?.size === 0) {
            generationEntry.masterAbortController?.abort();
          }
        }
      };

      if (typeof req?.on === "function") req.on("close", onClose);
      if (typeof res?.on === "function") res.on("close", onClose);

      res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      res.setHeader("Cache-Control", "private, no-store, no-transform");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");
      res.flushHeaders?.();

      const closeSlowStream = () => {
        res.destroy();
        onClose();
      };
      const writeFrame = (frame) => {
        if (res.writableEnded || res.destroyed || disconnected) return false;
        if (res.writableLength + Buffer.byteLength(frame) > MAX_BUILD_STREAM_BUFFER_BYTES) {
          closeSlowStream();
          return false;
        }
        if (!res.write(frame) && !drainDeadline) {
          drainDeadline = setTimeout(closeSlowStream, BUILD_STREAM_DRAIN_TIMEOUT_MS);
          drainDeadline.unref();
        }
        return true;
      };
      res.on("drain", onDrain);
      res.once("finish", disposeDrain);
      res.once("close", disposeDrain);
      const heartbeat = setInterval(() => {
        if (!res.writableNeedDrain && writeFrame(": keepalive\n\n")) {
          if (typeof res.flush === "function") res.flush();
        }
      }, 15000);

      const sendEvent = (data) => {
        return writeFrame(`data: ${JSON.stringify(data)}\n\n`);
      };

      try {
        const tracked = await getOrCreateGeneration({
          payload,
          ownerId: req.ownerId,
          user: req.user,
          req,
          subscriberId,
          onEntry: (entry) => { generationEntry = entry; if (disconnected) onClose(); },
          onChunk: ({ chunk, finishReason, preparationEstimate, resetStream, escalatedToFlagship, routingTier }) => sendEvent({
            chunk,
            finishReason,
            preparationEstimate,
            ...(resetStream ? { resetStream: true } : {}),
            ...(typeof escalatedToFlagship === "boolean" ? { escalatedToFlagship } : {}),
            ...(routingTier ? { routingTier } : {}),
          }),
        });
        const strategy = tracked.result;
        const savedRecord = tracked.savedRecord || null;
        const escalatedToFlagship = Boolean(strategy?.orchestration?.escalatedToFlagship);

        sendEvent({
          done: true,
          strategy,
          savedStrategy: savedRecord ? publicRecord(savedRecord) : null,
          savedId: savedRecord ? savedRecord.id : null,
          ...(escalatedToFlagship
            ? { escalatedToFlagship: true, routingTier: "flagship" }
            : (strategy?.orchestration?.buildMode === "auto"
              ? { escalatedToFlagship: false, routingTier: "standard" }
              : {})),
          ...(req.user ? {} : {
            isGuest: true,
          }),
        });
        if (writeFrame("data: [DONE]\n\n")) res.end();
      } catch (streamError) {
        if (streamError.name === "AbortError" || generationEntry?.masterAbortController?.signal?.aborted) {
          return res.end();
        }

        sendEvent(publicBuildFailure(streamError));
        res.end();
      } finally {
        clearInterval(heartbeat);
        if (typeof req?.off === "function") req.off("close", onClose);
        if (typeof res?.off === "function") res.off("close", onClose);
        onClose();
      }
    }),
  );

  router.post(
    "/refine",
    asyncRoute(async (req, res) => {
      const payload = parse(RefineRequestSchema, req.body);
      const effectiveKey = resolveRequestIdempotencyKey(req, payload);
      if (typeof repository.loadOwnerProvenance === "function") {
        await repository.loadOwnerProvenance(req.ownerId);
      }
      const ownerRecordsForRefine = typeof repository.readTenant === "function"
        ? await repository.readTenant(req.ownerId, { clone: false })
        : [];
      const refineProvenance = typeof repository.resolveProvenance === "function"
        ? await repository.resolveProvenance(req.ownerId, payload.strategy, ownerRecordsForRefine)
        : resolveGroundedStrategyProvenance(req.ownerId, payload.strategy, ownerRecordsForRefine);
      if (isGroundedStrategyRecord(payload.strategy) || refineProvenance.grounded) {
        throw Object.assign(new Error("Grounded strategy is restricted"), {
          code: refineProvenance.expired ? "GROUNDED_STRATEGY_EXPIRED" : "GROUNDED_STRATEGY_RESTRICTED",
          status: refineProvenance.expired ? 410 : 422,
        });
      }

      const fingerprint = computePayloadFingerprint("refine", payload);
      const refineKey = effectiveKey ? `${req.ownerId}:${effectiveKey}` : null;
      const subscriberId = randomUUID();

      const result = await executeSharedRefinement({
        refineKey,
        fingerprint,
        subscriberId,
        req,
        res,
        execute: async (signal) => {
          const language = resolveLanguage(req, payload.language);
          const personalizationContext = buildStrategyPersonalizationContext({
            user: req.user,
          });
          const marketMode = detectTargetMarket({ brief: payload.brief, answers: payload.answers, strategy: payload.strategy });
          const modelImprovement = isModelImprovementEnabled(req);
          const { buildDecision, effectiveBuildMode } = await resolvePreFlightBuildDecision({
            payload,
            existingStrategy: payload.strategy,
            isBriefGeneration: false,
            signal,
          });
          const tracked = await runTrackedBuild({
            learningLoop, telemetryService, ownerId: req.ownerId, taskType: `build_refine_${payload.action}`, userPrompt: payload.action === "custom" ? payload.request : payload.action,
            relevantContext: { personalizationApplied: Boolean(personalizationContext), language, marketMode },
            execute: (onUsage) => generationServices.refineStrategy({
              ...payload,
              ...(effectiveBuildMode ? { buildMode: effectiveBuildMode } : {}),
              buildDecision,
              language,
            }, req.ownerId, signal, personalizationContext, undefined, onUsage),
            onlyNecessaryData: !modelImprovement || Boolean(buildDecision?.needsMarketSearch),
            modelImprovement,
            privacySnapshot: getReqPrivacySnapshot(req),
          });
          const escalatedToFlagship = Boolean(tracked.result?.orchestration?.escalatedToFlagship);
          return {
            strategy: tracked.result,
            ...(escalatedToFlagship
            ? { escalatedToFlagship: true, routingTier: "flagship" }
            : (tracked.result?.orchestration?.buildMode === "auto"
              ? { escalatedToFlagship: false, routingTier: "standard" }
              : {})),
          };
        },
      });
      if (!res.writableEnded && !res.destroyed && !res.closed) {
        res.json(result);
      }
    }),
  );

  router.post(
    "/save",
    asyncRoute(async (req, res) => {
      const payload = parse(SaveStrategyRequestSchema, req.body);
      if (typeof repository.loadOwnerProvenance === "function") {
        await repository.loadOwnerProvenance(req.ownerId);
      }
      const saveProvenance = typeof repository.resolveProvenance === "function"
        ? await repository.resolveProvenance(req.ownerId, payload)
        : resolveGroundedStrategyProvenance(req.ownerId, payload);
      if (saveProvenance.expired) {
        return res.status(410).json({ error: "Veb araşdırmalı strategiyanın saxlama müddəti bitib.", code: "GROUNDED_STRATEGY_EXPIRED" });
      }
      const authoritativeSavePayload = saveProvenance.grounded
        ? applyGroundedProvenanceToStrategy(structuredClone(payload), saveProvenance)
        : payload;
      const record = await repository.create(
        {
          ...authoritativeSavePayload,
          saveOrigin: "manual",
          payloadFingerprint: null,
        },
        req.ownerId,
      );
      if (!record) {
        return res.status(410).json({ error: "Strategiya saxlama müddəti bitib və ya etibarsızdır.", code: "GROUNDED_STRATEGY_EXPIRED" });
      }
      const latestVersion = payload.versions.at(-1);
      const isGroundedRecord = isGroundedStrategyRecord(record) || isGroundedStrategyRecord(authoritativeSavePayload) || saveProvenance.grounded;
      if (learningLoop && payload.acceptForLearning && record.learningInteractionId && !isGroundedRecord) {
        const learningUpdate = learningLoop.recordSignal(record.learningInteractionId, req.ownerId, { accepted: true })
          .then(() => payload.versions.length > 1 ? learningLoop.recordIteration({
            parentInteractionId: record.learningInteractionId,
            ownerId: req.ownerId,
            modificationRequest: latestVersion.changeRequest,
            response: latestVersion.data,
            modelProvider: "google",
            modelName: latestVersion?.data?.orchestration?.generatorModel || buildConfig.strategistModel,
            finalAccepted: true,
          }) : null);
        logWithoutBlocking(learningUpdate, "Build acceptance logging");
      }
      res.status(201).json({ strategy: publicRecord(record) });
    }),
  );

  router.post(
    "/feedback",
    asyncRoute(async (req, res) => {
      const payload = parse(StrategyFeedbackSchema, req.body);
      const { strategyId, clientSaveId, feedback, brief, title, groundingActive: clientGroundingActive } = payload;

      if (typeof repository.loadOwnerProvenance === "function") {
        await repository.loadOwnerProvenance(req.ownerId);
      }

      let existing = null;
      let interactionId = null;
      let strategyTitle = title || "";
      let isGroundedExisting = false;

      if (strategyId) {
        existing = await repository.getById(strategyId, req.ownerId);
        if (existing) {
          interactionId = existing.learningInteractionId || null;
          strategyTitle = existing.strategy?.title || existing.title || strategyTitle;
          isGroundedExisting = isGroundedStrategyRecord(existing);
        }
      }

      const provenance = typeof repository.resolveProvenance === "function"
        ? await repository.resolveProvenance(
            req.ownerId,
            existing || { id: strategyId, clientSaveId: clientSaveId || null, title, strategy: { title }, brief },
            existing ? [existing] : []
          )
        : resolveGroundedStrategyProvenance(
            req.ownerId,
            existing || { id: strategyId, clientSaveId: clientSaveId || null, title, strategy: { title }, brief },
            existing ? [existing] : []
          );

      const serverGrounded = Boolean(isGroundedExisting || provenance.grounded || clientGroundingActive === true);
      const isUnverifiedOrGrounded = !strategyId || !existing || serverGrounded;
      const modelImprovement = isModelImprovementEnabled(req);
      const isRestrictedFeedback = !modelImprovement || isUnverifiedOrGrounded;

      if (learningLoop && interactionId && feedback && !isUnverifiedOrGrounded) {
        logWithoutBlocking(
          learningLoop.recordSignal(interactionId, req.ownerId, {
            explicitRating: feedback === "like" ? "positive" : "negative",
            accepted: feedback === "like",
          }),
          "Strategy learning signal"
        );
      }

      if (telemetryService && feedback && typeof telemetryService.trackStrategyFeedback === "function") {
        logWithoutBlocking(
          telemetryService.trackStrategyFeedback({
            ownerId: req.ownerId,
            sessionId: req.guestOwnerId,
            strategyId: strategyId || null,
            strategyTitle: isRestrictedFeedback ? "" : strategyTitle,
            brief: isRestrictedFeedback ? "" : (brief || ""),
            feedback,
            groundingActive: serverGrounded,
            onlyNecessaryData: isRestrictedFeedback,
            modelImprovement: !isRestrictedFeedback,
          }),
          "Strategy telemetry feedback"
        );
      }

      return res.json({ success: true, feedback });
    }),
  );

  router.post(
    "/:id/refine",
    asyncRoute(async (req, res) => {
      if (!/^[0-9a-f-]{36}$/i.test(req.params.id)) {
        const error = new Error("Invalid strategy id");
        error.code = "VALIDATION_ERROR";
        error.details = [{ field: "id", message: "Strategiya ID-si düzgün deyil." }];
        throw error;
      }

      const clientPayload = parse(RefineByIdRequestSchema, req.body);

      const existing = await repository.getById(req.params.id, req.ownerId);
      if (!existing) return res.status(404).json({ error: "Strategiya tapılmadı.", code: "NOT_FOUND" });

      if (req.securityContext) {
        req.securityContext.assertResources = async () => {
          if (!await repository.getById(existing.id, req.ownerId, { coalesce: false })) {
            throw Object.assign(new Error("Execution context removed"), { code: "EXECUTION_REVOKED", status: 403 });
          }
        };
      }

      const payload = parse(RefineRequestSchema, {
        action: clientPayload.action,
        request: clientPayload.request,
        language: clientPayload.language,
        idempotencyKey: clientPayload.idempotencyKey,
        buildMode: clientPayload.buildMode,
        fasterThinkingLevel: clientPayload.fasterThinkingLevel,
        brief: existing.brief || "",
        answers: existing.clarification?.answers || existing.answers || [],
        strategy: existing.strategy,
      });

      const effectiveKey = resolveRequestIdempotencyKey(req, payload);
      const fingerprint = computePayloadFingerprint("refine_id", clientPayload, req.params.id);
      const refineKey = effectiveKey ? `${req.ownerId}:${effectiveKey}` : null;

      // Check if version with this idempotencyKey was already appended (replay after restart)
      if (effectiveKey && Array.isArray(existing.versions)) {
        const completedVersion = existing.versions.find((v) => v.clientSaveId === effectiveKey);
        if (completedVersion) {
          if (completedVersion.payloadFingerprint) {
            const matchesCanonical = completedVersion.payloadFingerprint === fingerprint;
            const matchesLegacy = completedVersion.payloadFingerprint === computeLegacyPayloadFingerprint("refine_id", clientPayload, req.params.id);
            if (!matchesCanonical && !matchesLegacy) {
              const conflictErr = new Error("Eyni idempotency açarı fərqli parametrlərlə istifadə edilib.");
              conflictErr.code = "IDEMPOTENCY_CONFLICT";
              conflictErr.status = 409;
              throw conflictErr;
            }
          }
          return res.json({ strategy: publicRecord(existing) });
        }
      }

      if (typeof repository.loadOwnerProvenance === "function") {
        await repository.loadOwnerProvenance(req.ownerId);
      }
      const existingRefineProvenance = typeof repository.resolveProvenance === "function"
        ? await repository.resolveProvenance(req.ownerId, existing, [existing])
        : resolveGroundedStrategyProvenance(req.ownerId, existing, [existing]);
      if (isGroundedStrategyRecord(existing) || existingRefineProvenance.grounded) {
        throw Object.assign(new Error("Grounded strategy is restricted"), {
          code: existingRefineProvenance.expired ? "GROUNDED_STRATEGY_EXPIRED" : "GROUNDED_STRATEGY_RESTRICTED",
          status: existingRefineProvenance.expired ? 410 : 422,
        });
      }

      const subscriberId = randomUUID();
      const result = await executeSharedRefinement({
        refineKey,
        fingerprint,
        subscriberId,
        req,
        res,
        execute: async (signal) => {
          const language = resolveLanguage(req, payload.language);
          const personalizationContext = buildStrategyPersonalizationContext({
            user: req.user,
          });
          const modelImprovement = isModelImprovementEnabled(req);
          const { buildDecision, effectiveBuildMode } = await resolvePreFlightBuildDecision({
            payload,
            existingStrategy: payload.strategy,
            isBriefGeneration: false,
            signal,
          });
          const tracked = await runTrackedBuild({
            learningLoop, telemetryService, ownerId: req.ownerId, taskType: `build_refine_${payload.action}`, userPrompt: payload.action === "custom" ? payload.request : payload.action,
            relevantContext: { resourceId: existing.id, personalizationApplied: Boolean(personalizationContext), language },
            execute: (onUsage) => generationServices.refineStrategy({
              ...payload,
              ...(effectiveBuildMode ? { buildMode: effectiveBuildMode } : {}),
              buildDecision,
              language,
            }, req.ownerId, signal, personalizationContext, undefined, onUsage),
            onlyNecessaryData: !modelImprovement || Boolean(buildDecision?.needsMarketSearch),
            modelImprovement,
            privacySnapshot: getReqPrivacySnapshot(req),
          });
          const strategy = tracked.result;
          const changeRequest = payload.action === "custom" ? payload.request : payload.action;
          await assertExecutionAuthorized(signal);
          req.securityContext?.markMutationPending?.();
          const updated = await repository.appendVersion(
            req.params.id,
            req.ownerId,
            strategy,
            changeRequest,
            { clientSaveId: effectiveKey || null, payloadFingerprint: fingerprint }
          );
          const escalatedToFlagship = Boolean(strategy?.orchestration?.escalatedToFlagship);
          const responsePayload = {
            strategy: publicRecord(updated),
            ...(escalatedToFlagship
            ? { escalatedToFlagship: true, routingTier: "flagship" }
            : (strategy?.orchestration?.buildMode === "auto"
              ? { escalatedToFlagship: false, routingTier: "standard" }
              : {})),
          };
          req.securityContext?.recordIdempotentResult?.(200, responsePayload);
          const isGroundedRefine = isGroundedStrategyRecord(strategy) || tracked.providerMeta?.stageMetrics?.some(stage => stage.groundingActive);
          if (modelImprovement && !isGroundedRefine && learningLoop && existing.learningInteractionId) {
            logWithoutBlocking(
              learningLoop.recordIteration({
                parentInteractionId: existing.learningInteractionId, interactionId: tracked.interactionId, ownerId: req.ownerId,
                privacySnapshot: getReqPrivacySnapshot(req),
                modificationRequest: changeRequest, response: strategy, modelProvider: tracked.providerMeta.provider,
                modelName: tracked.providerMeta.model, finalAccepted: false,
              }),
              "Build iteration logging",
            );
          }
          return responsePayload;
        },
      });
      if (!res.writableEnded && !res.destroyed && !res.closed) {
        res.json(result);
      }
    }),
  );

  router.get(
    "/",
    asyncRoute(async (req, res) => {
      const strategies = await repository.list(req.ownerId);
      res.json({ strategies });
    }),
  );

  router.get(
    "/:id",
    asyncRoute(async (req, res) => {
      if (!/^[0-9a-f-]{36}$/i.test(req.params.id)) {
        return res.status(400).json({ error: "Strategiya ID-si düzgün deyil.", code: "VALIDATION_ERROR" });
      }
      const existing = await repository.getById(req.params.id, req.ownerId);
      if (!existing) return res.status(404).json({ error: "Strategiya tapılmadı.", code: "NOT_FOUND" });
      return res.json({ strategy: publicRecord(existing) });
    }),
  );

  router.delete(
    "/:id",
    asyncRoute(async (req, res) => {
      parse(EmptyBodySchema, req.body ?? {});
      if (!/^[0-9a-f-]{36}$/i.test(req.params.id)) {
        return res.status(400).json({ error: "Strategiya ID-si düzgün deyil.", code: "VALIDATION_ERROR" });
      }
      const success = await repository.delete(req.params.id, req.ownerId);
      if (!success) return res.status(404).json({ error: "Strategiya tapılmadı.", code: "NOT_FOUND" });
      return res.json({ success: true, id: req.params.id });
    }),
  );

  router.patch(
    "/:id",
    asyncRoute(async (req, res) => {
      if (!/^[0-9a-f-]{36}$/i.test(req.params.id)) {
        return res.status(400).json({ error: "Strategiya ID-si düzgün deyil.", code: "VALIDATION_ERROR" });
      }
      const parsed = UpdateStrategyTitleSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: parsed.error.issues[0]?.message || "Strategiya adı boş ola bilməz.",
          code: "VALIDATION_ERROR",
          details: formatValidationError(parsed.error),
        });
      }
      const updated = await repository.updateTitle(req.params.id, req.ownerId, parsed.data.title);
      if (!updated) return res.status(404).json({ error: "Strategiya tapılmadı.", code: "NOT_FOUND" });
      return res.json({ strategy: publicRecord(updated) });
    }),
  );

  router.post(
    "/:id/duplicate",
    asyncRoute(async (req, res) => {
      if (!/^[0-9a-f-]{36}$/i.test(req.params.id)) {
        return res.status(400).json({ error: "Strategiya ID-si düzgün deyil.", code: "VALIDATION_ERROR" });
      }
      parse(EmptyBodySchema, req.body ?? {});
      const duplicate = await repository.duplicate(req.params.id, req.ownerId);
      if (!duplicate) return res.status(404).json({ error: "Strategiya tapılmadı.", code: "NOT_FOUND" });
      return res.status(201).json({ strategy: publicRecord(duplicate) });
    }),
  );

  return router;
}

export function strategyErrorHandler(error, req, res, next) {
  if (res.headersSent) return next(error);

  if (error instanceof SyntaxError || error?.type === "entity.parse.failed" || error?.name === "SyntaxError") {
    return res.status(400).json({
      error: "Sorğu formatı yanlışdır (JSON sintaksis xətası).",
      code: "INVALID_JSON",
    });
  }

  if (["AI_TIMEOUT", "AI_CONTENT_BLOCKED", "AI_SAFETY_BLOCKED", "GROUNDING_UNAVAILABLE", "GROUNDED_STRATEGY_RESTRICTED"].includes(error.code)) {
    return res.status(httpStatusOf(error)).json(publicBuildFailure(error));
  }

  if (/^(EXECUTION_|PROVENANCE_|DAILY_BUDGET_|MODEL_PRICING_|TOOL_PRICING_)/.test(error.code || "")) {
    return res.status(httpStatusOf(error)).json({
      error: "Sorğunu təhlükəsiz şəkildə tamamlamaq mümkün olmadı. Yenidən cəhd edin.", code: error.code,
    });
  }

  if (error.code === "VALIDATION_ERROR") {
    return res.status(400).json({
      error: error.details?.[0]?.message || "Göndərilən məlumatları yoxla.",
      code: error.code,
      details: error.details,
    });
  }

  if (error.code === "IDEMPOTENCY_CONFLICT" || error.status === 409) {
    return res.status(409).json({
      error: "Eyni idempotency açarı fərqli parametrlərlə istifadə edilib.",
      code: "IDEMPOTENCY_CONFLICT",
    });
  }

  if (error.code === "AI_NOT_CONFIGURED") {
    return res.status(503).json({
      error: "Seçilmiş AI xidməti hələ konfiqurasiya edilməyib.",
      code: error.code,
    });
  }

  if (error.status === 401 || error.code === "invalid_api_key" || error.code === "AI_AUTH_ERROR") {
    return res.status(503).json({
      error: "AI bağlantısı doğrulanmadı. Serverin giriş icazələrini yoxlayın.",
      code: "AI_AUTH_ERROR",
    });
  }

  if (error.status === 429 || error.code === "rate_limit_exceeded" || error.code === "AI_RATE_LIMITED") {
    return res.status(429).json({
      error: "AI xidmətində sorğu limiti aşılıb (429). Bir az sonra yenidən yoxla.",
      code: "AI_RATE_LIMITED",
    });
  }

  if (["AI_PROVIDER_CONFIG_ERROR", "AI_MODEL_UNAVAILABLE"].includes(error.code)) {
    return res.status(503).json(publicBuildFailure(error));
  }

  if (error.status === 503 || error.code === "AI_PROVIDER_UNAVAILABLE") {
    return res.status(503).json({
      error: "AI xidməti ilə əlaqə yaratmaq mümkün olmadı. Yenidən cəhd edin.",
      code: "AI_PROVIDER_UNAVAILABLE",
    });
  }

  if (error.code === "AI_MAX_TOKENS") {
    return res.status(422).json({
      error: "Strategiya generasiyası token limitinə çatdı.",
      code: "AI_MAX_TOKENS",
    });
  }

  if (error.code === "AI_INVALID_OUTPUT") {
    return res.status(502).json({
      error: "Strategiya strukturunu tamamlamaq mümkün olmadı. Yenidən cəhd et.",
      code: error.code,
    });
  }

  console.error("Strategy request failed", {
    method: req.method,
    path: req.path,
    code: error.code,
    status: error.status,
    name: error.name,
  });
  return res.status(httpStatusOf(error)).json({
    error: publicErrorMessage(error, "Helmer hazırda sorğunu tamamlaya bilmədi. Məlumatların qorunub — yenidən cəhd et."),
    code: error.code || "STRATEGY_ERROR",
  });
}
