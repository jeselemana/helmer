import { assertExecutionAuthorized, createExecutionController } from '../services/security/execution-control.js';
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import express from "express";
import { createAskExecutionGuard } from "./ask-execution-guard.js";
import { acquireIdempotencyLock } from "./execution-lock.js";
import { httpStatusOf, publicErrorMessage } from "./error-response.js";
import {
  AssessRequestSchema,
  GenerateRequestSchema,
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
import { detectTargetMarket, getGuestBuildCtaNotice, GUEST_BUILD_EXHAUSTED_MESSAGE } from "../services/ai/prompts.js";
import { BuildEstimateRequestSchema } from "../services/ai/build-estimate.js";
import { buildConfig } from "../services/ai/build-config.js";
import { aiConfig } from "../services/ai/config.js";
import { logWithoutBlocking } from "../services/learning/learning-loop-service.js";
import { isModelImprovementEnabled } from "./auth-middleware.js";

export function canonicalize(value) {
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  const sorted = {};
  for (const key of Object.keys(value).sort()) {
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

function rateLimit(limit, windowMs = 10 * 60 * 1000, scope = "generation") {
  return (req, res, next) => {
    const now = Date.now();
    const clientIp = getClientIp(req);
    const identifier = req.user?.id ? `user:${req.user.id}` : `ip:${clientIp}`;
    const key = `strat:${scope}:${identifier}:${req.baseUrl || "/api/strategy"}`;
    const history = (requestWindows.get(key) || []).filter((timestamp) => now - timestamp < windowMs);
    if (history.length >= limit) {
      return res.status(429).json({
        error: "Hazırda çox sayda sorğu göndərilib. Bir neçə dəqiqə sonra yenidən yoxla.",
        code: "RATE_LIMITED",
      });
    }
    history.push(now);
    requestWindows.set(key, history);
    return next();
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
  try {
    const result = await execute((meta) => {
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
    const groundingActive = Boolean(result?.orchestration?.searchGrounded || providerMeta?.searchGrounded);
    if (learningLoop) {
      logWithoutBlocking(learningLoop.recordInteraction({
        id: interactionId,
        ownerId,
        mode: "build",
        taskType,
        userPrompt: isRestricted ? "[Zəruri əməliyyat qeydi - Məzmun ötürülmür]" : userPrompt,
        relevantContext: isRestricted ? null : relevantContext,
        modelProvider: providerMeta.provider,
        modelName: providerMeta.model,
        modelResponse: isRestricted ? "[Zəruri əməliyyat qeydi - Məzmun ötürülmür]" : result,
        usage: providerMeta.usage,
        latencyMs: Date.now() - startedAt,
        requestStatus: "success",
        groundingActive,
        onlyNecessaryData: isRestricted,
        modelImprovement: !isRestricted,
        privacySnapshot,
      }), `Build ${taskType} logging`);
    }
    if (telemetryService) {
      telemetryService.trackBuildStrategy({
        ownerId,
        brief: isRestricted ? "" : userPrompt,
        model: providerMeta.model,
        latencyMs: Date.now() - startedAt,
        usage: providerMeta.usage,
        status: "success",
        strategy: isRestricted ? null : result,
        action: taskType,
        onlyNecessaryData: isRestricted,
        modelImprovement: !isRestricted,
      }).catch(() => {});
    }
    return { result, interactionId, providerMeta };
  } catch (error) {
    if (learningLoop) {
      logWithoutBlocking(learningLoop.recordInteraction({
        id: interactionId,
        ownerId,
        mode: "build",
        taskType,
        userPrompt: isRestricted ? "[Zəruri əməliyyat qeydi - Məzmun ötürülmür]" : userPrompt,
        relevantContext: isRestricted ? null : relevantContext,
        modelProvider: providerMeta.provider,
        modelName: providerMeta.model,
        modelResponse: "",
        usage: providerMeta.usage,
        latencyMs: Date.now() - startedAt,
        requestStatus: "error",
        errorType: error?.code || error?.name || "BUILD_ERROR",
        onlyNecessaryData: isRestricted,
        modelImprovement: !isRestricted,
        privacySnapshot,
      }), `Build ${taskType} failure logging`);
    }
    if (telemetryService) {
      telemetryService.trackBuildStrategy({
        ownerId,
        brief: isRestricted ? "" : userPrompt,
        model: providerMeta.model,
        latencyMs: Date.now() - startedAt,
        usage: providerMeta.usage,
        status: "error",
        error,
        action: taskType,
        onlyNecessaryData: isRestricted,
        modelImprovement: !isRestricted,
      }).catch(() => {});
    }
    throw error;
  }
}

export function createStrategyRouter(repository, learningLoop = null, options = {}) {
  const router = express.Router();
  const telemetryService = options?.telemetryService || null;
  const estimateFingerprints = new Map();
  const generationServices = options.generationServices || { assessBrief, generateStrategy, refineStrategy };
  const isGenerationRequest = req => req.method === "POST" && /^\/(?:estimate|assess|generate|generate-stream|refine|[0-9a-f-]{36}\/refine)\/?$/i.test(req.path);

  const estimateRateLimit = rateLimit(20, 10 * 60 * 1000, "estimate");
  const generationRateLimit = rateLimit(30);
  router.use((req, res, next) => (req.path === "/estimate" ? estimateRateLimit : generationRateLimit)(req, res, next));
  router.use((req, res, next) => {
    if (isGenerationRequest(req) && !/^[A-Za-z0-9_-]{16,100}$/.test(req.get("Idempotency-Key") || "")) {
      return res.status(400).json({ code: "IDEMPOTENCY_KEY_REQUIRED", error: "Etibarlı sorğu açarı tələb olunur." });
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
    const fingerprint = computePayloadFingerprint("estimate", payload);
    const requestKey = createHash("sha256").update(`${req.ownerId}:estimate:${req.get("Idempotency-Key")}`).digest("hex");
    const now = Date.now();
    for (const [key, entry] of estimateFingerprints) if (entry.expiresAt <= now) estimateFingerprints.delete(key);
    const previous = estimateFingerprints.get(requestKey);
    if (previous && previous.fingerprint !== fingerprint) return res.status(409).json({ code: "IDEMPOTENCY_CONFLICT", error: "Eyni sorğu açarı fərqli parametrlərlə istifadə edilib." });
    if (!previous && estimateFingerprints.size >= 512) estimateFingerprints.delete(estimateFingerprints.keys().next().value);
    // Bounded, owner-scoped fingerprints contain neither prompt nor profile.
    estimateFingerprints.set(requestKey, { fingerprint, expiresAt: now + 15 * 60 * 1000 });
    const controller = createExecutionController();
    const onRequestClose = () => { if (!req.complete && !res.writableEnded) controller.abort(); };
    const onResponseClose = () => { if (!res.writableEnded) controller.abort(); };
    req.on("close", onRequestClose);
    res.on("close", onResponseClose);
    res.setHeader("Cache-Control", "no-store");
    try {
      const preparationEstimate = await estimateBuildPreparation({
        brief: payload.brief,
        buildMode: payload.buildMode,
        fasterThinkingLevel: payload.fasterThinkingLevel,
        ownerId: req.ownerId,
        signal: controller.signal,
      });
      await assertExecutionAuthorized(controller.signal);
      if (!res.writableEnded) res.json({ preparationEstimate });
    } finally {
      req.off("close", onRequestClose);
      res.off("close", onResponseClose);
    }
  }));

  router.post(
    "/assess",
    asyncRoute(async (req, res) => {
      const payload = parse(AssessRequestSchema, req.body);
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
        const language = resolveLanguage(req, payload.language);
        const personalizationContext = buildStrategyPersonalizationContext({
          user: req.user,
        });
        const marketMode = detectTargetMarket({ brief: payload.brief, answers: payload.answers });
        const modelImprovement = isModelImprovementEnabled(req);
        let preparationEstimate;
        const tracked = await runTrackedBuild({
          learningLoop, telemetryService, ownerId: req.ownerId, taskType: "build_assess", userPrompt: payload.brief,
          relevantContext: { personalizationApplied: Boolean(personalizationContext), language, marketMode },
          execute: (onUsage) => generationServices.assessBrief({ ...payload, language, ownerId: req.ownerId, personalizationContext, signal: abortController.signal, onUsage, onEstimate: value => { preparationEstimate = value; } }),
          onlyNecessaryData: !modelImprovement,
          modelImprovement,
          privacySnapshot: getReqPrivacySnapshot(req),
        });
        const assessment = tracked.result;
        if (!res.writableEnded) {
          res.json({
            assessment,
            preparationEstimate,
            ...(req.user ? {} : {
              remainingGuestBriefs: req.remainingGuestBriefs,
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

      const existingSaved = tenantRecords.find((r) => r.clientSaveId === payload.idempotencyKey);
      if (existingSaved) {
        if (existingSaved.payloadFingerprint) {
          const matchesCanonical = existingSaved.payloadFingerprint === fingerprint;
          const matchesLegacy = existingSaved.payloadFingerprint === computeLegacyPayloadFingerprint("generate", payload);
          if (!matchesCanonical && !matchesLegacy) {
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
          return cached.tracked;
        }
        generationSignal.throwIfAborted();
        await distLock.assertOwned();
        const language = resolveLanguage(req, payload.language);
        const personalizationContext = buildStrategyPersonalizationContext({
          user,
        });
        const marketMode = detectTargetMarket({ brief: payload.brief, answers: payload.answers });
        const modelImprovement = isModelImprovementEnabled(req);
        const tracked = await runTrackedBuild({
          learningLoop,
          telemetryService,
          ownerId,
          taskType: "build_generate",
          userPrompt: payload.brief,
          relevantContext: { personalizationApplied: Boolean(personalizationContext), language, marketMode },
          execute: (onUsage) =>
            generationServices.generateStrategy({
              ...payload,
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
          onlyNecessaryData: !modelImprovement,
          modelImprovement,
          privacySnapshot: getReqPrivacySnapshot(req),
        });

        generationSignal.throwIfAborted();
        await distLock.assertOwned();
        await assertExecutionAuthorized(generationSignal);
        const strategy = tracked.result;
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
        const completedResult = { ...tracked, result: savedRecord?.strategy || tracked.result, savedRecord };
        req?.securityContext?.recordIdempotentResult?.(200, {
          strategy: completedResult.result,
          savedStrategy: savedRecord ? publicRecord(savedRecord) : null,
          savedId: savedRecord ? savedRecord.id : null,
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

    generationPromise.then(
      () => setTimeout(() => activeGenerations.delete(requestKey), 15 * 60 * 1000).unref(),
      () => activeGenerations.delete(requestKey),
    );

    return generationPromise;
  }

  router.post(
    "/generate",
    asyncRoute(async (req, res) => {
      const payload = parse(GenerateRequestSchema, req.body);
      const subscriberId = randomUUID();
      let entry = null, disconnected = false;
      const onClose = () => {
        disconnected = true;
        entry?.subscribers.delete(subscriberId);
        if (entry?.subscribers.size === 0) entry.masterAbortController.abort();
      };
      req.on?.("close", onClose);
      res.on?.("close", onClose);
      try {
        const tracked = await getOrCreateGeneration({
          payload, ownerId: req.ownerId, user: req.user, req, subscriberId,
          onEntry: value => { entry = value; if (disconnected) onClose(); },
        });
        if (!disconnected && !res.writableEnded && !res.destroyed) {
          const savedRecord = tracked.savedRecord || null;
          res.json({
            strategy: tracked.result,
            savedStrategy: savedRecord ? publicRecord(savedRecord) : null,
            savedId: savedRecord ? savedRecord.id : null,
            ...(req.user ? {} : {
              remainingGuestBriefs: req.remainingGuestBriefs,
              isGuest: true,
              guestCtaNotice: req.remainingGuestBriefs !== undefined ? getGuestBuildCtaNotice(req.remainingGuestBriefs, req.headers["accept-language"]?.includes("en")) : undefined,
            }),
          });
        }
      } finally {
        req.off?.("close", onClose);
        res.off?.("close", onClose);
        onClose();
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

      const onClose = () => {
        if (req.complete && !res.destroyed && !res.closed) return;
        disconnected = true;
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
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");
      res.flushHeaders?.();

      const heartbeat = setInterval(() => {
        if (!res.writableEnded && !res.destroyed) {
          res.write(": keepalive\n\n");
          if (typeof res.flush === "function") res.flush();
        }
      }, 15000);

      const sendEvent = (data) => {
        if (res.writableEnded) return;
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      };

      try {
        const tracked = await getOrCreateGeneration({
          payload,
          ownerId: req.ownerId,
          user: req.user,
          req,
          subscriberId,
          onEntry: (entry) => { generationEntry = entry; if (disconnected) onClose(); },
          onChunk: ({ chunk, finishReason, preparationEstimate, resetStream }) => sendEvent({
            chunk,
            finishReason,
            preparationEstimate,
            ...(resetStream ? { resetStream: true } : {}),
          }),
        });
        const strategy = tracked.result;
        const savedRecord = tracked.savedRecord || null;

        sendEvent({
          done: true,
          strategy,
          savedStrategy: savedRecord ? publicRecord(savedRecord) : null,
          savedId: savedRecord ? savedRecord.id : null,
          ...(req.user ? {} : {
            remainingGuestBriefs: req.remainingGuestBriefs,
            isGuest: true,
            guestCtaNotice: req.remainingGuestBriefs !== undefined ? getGuestBuildCtaNotice(req.remainingGuestBriefs, req.headers["accept-language"]?.includes("en")) : undefined,
          }),
        });
        res.write("data: [DONE]\n\n");
        res.end();
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
      const abortController = createExecutionController();
      const onReqClose = () => {
        if (!req.complete && !res.writableEnded) abortController.abort();
      };
      const onResClose = () => {
        if (!res.writableEnded) abortController.abort();
      };
      if (typeof req?.on === "function") req.on("close", onReqClose);
      if (typeof res?.on === "function") res.on("close", onResClose);

      const fingerprint = computePayloadFingerprint("refine", payload);
      const refineKey = payload.idempotencyKey ? `${req.ownerId}:${payload.idempotencyKey}` : null;

      try {
        if (refineKey && activeRefinements.has(refineKey)) {
          const entry = activeRefinements.get(refineKey);
          if (entry.fingerprint && entry.fingerprint !== fingerprint) {
            const conflictErr = new Error("Eyni idempotency açarı fərqli parametrlərlə istifadə edilib.");
            conflictErr.code = "IDEMPOTENCY_CONFLICT";
            conflictErr.status = 409;
            throw conflictErr;
          }
          const result = await entry.promise;
          if (!res.writableEnded) {
            res.json(result);
          }
          return;
        }

        const executeRefine = async () => {
          const language = resolveLanguage(req, payload.language);
          const personalizationContext = buildStrategyPersonalizationContext({
            user: req.user,
          });
          const marketMode = detectTargetMarket({ brief: payload.brief, answers: payload.answers, strategy: payload.strategy });
          const modelImprovement = isModelImprovementEnabled(req);
          const tracked = await runTrackedBuild({
            learningLoop, telemetryService, ownerId: req.ownerId, taskType: `build_refine_${payload.action}`, userPrompt: payload.action === "custom" ? payload.request : payload.action,
            relevantContext: { personalizationApplied: Boolean(personalizationContext), language, marketMode },
            execute: (onUsage) => generationServices.refineStrategy({ ...payload, language }, req.ownerId, abortController.signal, personalizationContext, undefined, onUsage),
            onlyNecessaryData: !modelImprovement,
            modelImprovement,
            privacySnapshot: getReqPrivacySnapshot(req),
          });
          return { strategy: tracked.result };
        };

        const refinePromise = executeRefine();
        if (refineKey) {
          activeRefinements.set(refineKey, { promise: refinePromise, fingerprint, abortController });
          refinePromise.then(
            () => setTimeout(() => activeRefinements.delete(refineKey), 5 * 60 * 1000).unref(),
            () => activeRefinements.delete(refineKey),
          );
        }

        const result = await refinePromise;
        if (!res.writableEnded) {
          res.json(result);
        }
      } finally {
        if (typeof req?.off === "function") req.off("close", onReqClose);
        if (typeof res?.off === "function") res.off("close", onResClose);
      }
    }),
  );

  router.post(
    "/save",
    asyncRoute(async (req, res) => {
      const payload = parse(SaveStrategyRequestSchema, req.body);
      const record = await repository.create(payload, req.ownerId);
      if (learningLoop && payload.acceptForLearning && record.learningInteractionId) {
        const latestVersion = payload.versions.at(-1);
        const learningUpdate = learningLoop.recordSignal(record.learningInteractionId, req.ownerId, { accepted: true })
          .then(() => payload.versions.length > 1 ? learningLoop.recordIteration({
            parentInteractionId: record.learningInteractionId,
            ownerId: req.ownerId,
            modificationRequest: latestVersion.changeRequest,
            response: latestVersion.data,
            modelProvider: "google",
            modelName: buildConfig.strategistModel,
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
      const { strategyId, feedback, brief, title } = payload;

      let interactionId = null;
      let strategyTitle = title || "";

      if (strategyId) {
        const existing = await repository.getById(strategyId, req.ownerId);
        if (existing) {
          interactionId = existing.learningInteractionId || null;
          strategyTitle = existing.strategy?.title || existing.title || strategyTitle;
        }
      }

      const modelImprovement = isModelImprovementEnabled(req);

      if (learningLoop && interactionId && feedback) {
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
            strategyTitle,
            brief: brief || "",
            feedback,
            onlyNecessaryData: !modelImprovement,
            modelImprovement,
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

      const existing = await repository.getById(req.params.id, req.ownerId);
      if (!existing) return res.status(404).json({ error: "Strategiya tapılmadı.", code: "NOT_FOUND" });

      const payload = parse(RefineRequestSchema, {
        ...req.body,
        brief: existing.brief || "",
        answers: existing.clarification?.answers || existing.answers || [],
        strategy: existing.strategy,
      });

      const fingerprint = computePayloadFingerprint("refine_id", req.body, req.params.id);
      const refineKey = payload.idempotencyKey ? `${req.ownerId}:${payload.idempotencyKey}` : null;

      // Check if version with this idempotencyKey was already appended (replay after restart)
      if (payload.idempotencyKey && Array.isArray(existing.versions)) {
        const completedVersion = existing.versions.find((v) => v.clientSaveId === payload.idempotencyKey);
        if (completedVersion) {
          if (completedVersion.payloadFingerprint) {
            const matchesCanonical = completedVersion.payloadFingerprint === fingerprint;
            const matchesLegacy = completedVersion.payloadFingerprint === computeLegacyPayloadFingerprint("refine_id", req.body, req.params.id);
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

      if (refineKey && activeRefinements.has(refineKey)) {
        const entry = activeRefinements.get(refineKey);
        if (entry.fingerprint && entry.fingerprint !== fingerprint) {
          const conflictErr = new Error("Eyni idempotency açarı fərqli parametrlərlə istifadə edilib.");
          conflictErr.code = "IDEMPOTENCY_CONFLICT";
          conflictErr.status = 409;
          throw conflictErr;
        }
        const result = await entry.promise;
        if (!res.writableEnded) {
          res.json(result);
        }
        return;
      }

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
        const executeRefine = async () => {
          const language = resolveLanguage(req, payload.language);
          const personalizationContext = buildStrategyPersonalizationContext({
            user: req.user,
          });
          const modelImprovement = isModelImprovementEnabled(req);
          const tracked = await runTrackedBuild({
            learningLoop, telemetryService, ownerId: req.ownerId, taskType: `build_refine_${payload.action}`, userPrompt: payload.action === "custom" ? payload.request : payload.action,
            relevantContext: { resourceId: existing.id, personalizationApplied: Boolean(personalizationContext), language },
            execute: (onUsage) => generationServices.refineStrategy({ ...payload, language }, req.ownerId, abortController.signal, personalizationContext, undefined, onUsage),
            onlyNecessaryData: !modelImprovement,
            modelImprovement,
            privacySnapshot: getReqPrivacySnapshot(req),
          });
          const strategy = tracked.result;
          const changeRequest = payload.action === "custom" ? payload.request : payload.action;
          await assertExecutionAuthorized(abortController.signal);
          req.securityContext?.markMutationPending?.();
          const updated = await repository.appendVersion(
            req.params.id,
            req.ownerId,
            strategy,
            changeRequest,
            { clientSaveId: payload.idempotencyKey || null, payloadFingerprint: fingerprint }
          );
          const responsePayload = { strategy: publicRecord(updated) };
          req.securityContext?.recordIdempotentResult?.(200, responsePayload);
          if (modelImprovement && learningLoop && existing.learningInteractionId) {
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
        };

        const refinePromise = executeRefine();
        if (refineKey) {
          activeRefinements.set(refineKey, { promise: refinePromise, fingerprint, abortController });
          refinePromise.then(
            () => setTimeout(() => activeRefinements.delete(refineKey), 5 * 60 * 1000).unref(),
            () => activeRefinements.delete(refineKey),
          );
        }

        const result = await refinePromise;
        if (!res.writableEnded) {
          res.json(result);
        }
      } finally {
        if (typeof req?.off === "function") req.off("close", onReqClose);
        if (typeof res?.off === "function") res.off("close", onResClose);
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

  if (["AI_TIMEOUT", "AI_CONTENT_BLOCKED"].includes(error.code)) {
    return res.status(httpStatusOf(error)).json(publicBuildFailure(error));
  }

  if (/^(EXECUTION_|DAILY_BUDGET_|MODEL_PRICING_|TOOL_PRICING_)/.test(error.code || "")) {
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
