import { z } from "zod";
import {
  callDecisionsApi,
  getDecisionVertexClient,
  hasDecisionApiConfiguration,
} from "./client.js";
import { extractJsonFromText } from "./llm-router.js";
import { evaluateSearchRoute, hasGroundedAssistantHistory } from "./search-router.js";

export const DECISION_MODEL = "gemini-decision-1";
export const DECISION_FALLBACK_MODEL = "gemini-3.5-flash-lite";

export const DECISION_THRESHOLDS = Object.freeze({
  ASK_NEEDS_WEB_SEARCH: 0.65,
  ASK_REQUIRE_GROUNDING: 0.75,
  BUILD_NEEDS_MARKET_SEARCH: 0.68,
  BUILD_MIN_ENOUGH_CONTEXT: 0.45,
});

export const DECISION_TIMEOUTS_MS = Object.freeze({
  SHORT_TEXT: 400,
  MEDIA_OR_PDF: 900,
  LARGE_TEXT: 1500,
});

export const DECISION_LARGE_TEXT_TOKEN_THRESHOLD = 16000;

export const REDIS_CIRCUIT_KEYS = Object.freeze({
  FAILURES: "helmer:decision_api:failures",
  CIRCUIT_OPEN: "helmer:decision_api:circuit_open",
  THRESHOLD: 3,
  OPEN_TTL_SECONDS: 60,
  FAILURES_TTL_SECONDS: 300,
});

const URL_OR_DOMAIN_PATTERN =
  /https?:\/\/[^\s]+|www\.[^\s]+|\b[a-zA-Z0-9-]+\.(?:az|com|org|net|io|co|ai|edu|gov|tr|ru|tech|biz|info|me|app)\b/i;

const ASK_FALLBACK_SCHEMA = z
  .object({
    s: z.boolean(),
    r: z.boolean(),
  })
  .strict();

const BUILD_FALLBACK_SCHEMA = z
  .object({
    a: z.enum(["draft_brief", "refine_brief", "ask_questions", "brief_qa", "other"]),
    d: z.union([z.literal(0), z.literal(1), z.literal(2)]),
    m: z.boolean(),
    c: z.boolean(),
  })
  .strict();

export const ASK_DECISION_QUESTIONS = Object.freeze({
  needs_web_search: {
    type: "noul",
    instructions:
      "Does the user's latest message—considering the conversation history—require live Google Search (e.g., current events, recent news, real-time prices/stats, external entity lookup, OR a short verification/follow-up question like 'Dəqiq?', 'Əminsən?', 'Really?' referring to an earlier web-grounded claim)?",
  },
  require_grounding: {
    type: "noul",
    instructions:
      "Does the user's latest message strictly require verified official/regulatory facts (e.g., official central bank interest rates, official inflation figures, or legally binding statistics) where an ungrounded answer must be blocked?",
  },
});

export const BUILD_DECISION_QUESTIONS = Object.freeze({
  brief_action: {
    type: "choice",
    instructions: "Classify the user's primary intent regarding the Build Brief.",
    criteria: {
      draft_brief: "Creating a new Build Brief from a product idea, concept, or prompt.",
      refine_brief:
        "Updating, expanding, narrowing scope (e.g., MVP cut), or modifying sections of an existing Build Brief.",
      ask_questions:
        "The request is too vague or underspecified (e.g., 'I want to build an app' with no domain, target user, or problem statement) and requires 2-3 targeted discovery questions first.",
      brief_qa:
        "Asking a question, seeking strategic feedback, or discussing trade-offs about the brief without rewriting the whole document.",
      other: "Any request that does not fit the categories above.",
    },
  },
  brief_depth: {
    type: "score",
    instructions:
      "Score the required complexity and depth of the Build Brief on a 0 to 2 integer scale: 0 = lightweight / quick MVP brief, 1 = standard multi-feature SaaS / product brief, 2 = comprehensive enterprise / multi-system Build Brief.",
    min_score: 0,
    max_score: 2,
  },
  needs_market_search: {
    type: "noul",
    instructions:
      "Does drafting or refining this Build Brief benefit from live web search (e.g., checking existing competitors, current API pricing/capabilities, regulatory constraints, or recent market benchmarks)?",
  },
  has_enough_context: {
    type: "noul",
    instructions:
      "Does the user prompt plus conversation history contain enough core product context (target problem, user type, or core functionality) to immediately generate a structured Build Brief without asking preliminary discovery questions?",
  },
});

const EXPLICIT_SEARCH_DIRECTIVE_PATTERN =
  /(?:google(?:-da)?\s+axtar|internet(?:d[əe])?\s+(?:axtar|ara[sş]d[ıi]r|yoxla)|(?:veb|web)(?:-d[əe])?\s+(?:axtar|ara[sş]d[ıi]r|yoxla)|m[əe]nb[əe]l[əe]ri\s+g[oö]st[əe]r|search\s+online|find\s+online|look\s+up\s+on\s+the\s+web|^\s*(?:ara[sş]d[ıi]r|vebd[əe]\s+yoxla|internetd[əe]\s+yoxla)\s*[!?.…]*\s*$)/i;

const GROUNDED_VERIFICATION_FOLLOWUP_PATTERN =
  /^\s*(?:d[əe]qiq\??|[əe]mins[əe]n\??|do[gğ]rudan\??|h[əe]qiq[əe]t[əe]n\??|d[uü]zd[uü]r\??|yenid[əe]n\s+c[əe]hd\s+et|t[əe]krar\s+(?:c[əe]hd\s+et|yoxla|axtar|ara[sş]d[ıi]r)|bir\s+d[əe]\s+(?:yoxla|bax|ara[sş]d[ıi]r)|olmayacaq\??|yoxla|exact(?:ly)?\??|really\??|are\s+you\s+sure\??|sure\??|verify\??|retry|try\s+again|check\s+again|m[əe]nb[əe]\??|sources?\??|link\??)\s*[!?.…\s]*$/i;

const CONVERSATIONAL_GREETING_FAST_PATH_PATTERN =
  /^\s*(?:salam(?:lar|aleykum|əleykum)?|sabah[ıi]n(?:[ıi]z)?\s+xeyir|ax[şs]am[ıi]n(?:[ıi]z)?\s+xeyir|g[üu]nortan(?:[ıi]z)?\s+xeyir|nec[əe]s[əe]n|nec[əe]siz|h[əe]r\s+vaxt[ıi]n(?:[ıi]z)?\s+xeyir|t[əe][şs][əe]kk[üu]r(?:l[əe]r)?|sa[ğg]\s+ol(?:un)?|[çc]ox\s+sa[ğg]\s+ol(?:un)?|oldu|yax[şs][ıi]|super|əla|əlad[ıi]r?|tamam|ba[şs]a\s+d[üu][şs]d[üu]m|hi+|hello+|hey+|good\s+(?:morning|afternoon|evening)|thanks?(?:\s+you)?|ok(?:ay)?|got\s+it|привет|здравствуй(?:те)?|спасибо)\s*[!?.😊👍🙏]*\s*$/i;

function clampScore(value, fallback = 0) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(0, Math.min(1, num));
}

function extractNoulScore(entry, fallback = 0) {
  if (typeof entry === "number") return clampScore(entry, fallback);
  if (typeof entry === "boolean") return entry ? 1 : 0;
  if (!entry || typeof entry !== "object") return fallback;
  const candidate =
    entry.score ??
    entry.probability ??
    entry.value ??
    entry.yesScore ??
    entry.confidence ??
    entry.answer;
  if (typeof candidate === "boolean") return candidate ? 1 : 0;
  if (typeof candidate === "string") {
    const lower = candidate.trim().toLowerCase();
    if (lower === "yes" || lower === "true") return 1;
    if (lower === "no" || lower === "false") return 0;
  }
  return clampScore(candidate, fallback);
}

function extractChoiceResult(entry, validChoices, fallback = "other") {
  if (typeof entry === "string") {
    return validChoices.includes(entry) ? entry : fallback;
  }
  if (!entry || typeof entry !== "object") return fallback;
  const direct = entry.choice ?? entry.selected ?? entry.value ?? entry.label ?? entry.answer;
  if (typeof direct === "string" && validChoices.includes(direct)) {
    return direct;
  }
  if (entry.scores && typeof entry.scores === "object") {
    let bestKey = fallback;
    let bestVal = -Infinity;
    for (const [k, v] of Object.entries(entry.scores)) {
      if (validChoices.includes(k) && Number(v) > bestVal) {
        bestVal = Number(v);
        bestKey = k;
      }
    }
    return bestKey;
  }
  return fallback;
}

function extractIntegerScore(entry, min = 0, max = 2, fallback = 1) {
  let raw = entry;
  if (entry && typeof entry === "object") {
    raw = entry.score ?? entry.value ?? entry.answer ?? entry.selected;
  }
  const num = Number(raw);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(min, Math.min(max, Math.round(num)));
}

function resolveDecisionMap(responsePayload) {
  if (!responsePayload || typeof responsePayload !== "object") return {};
  return (
    responsePayload.results ||
    responsePayload.decisions ||
    responsePayload.answers ||
    responsePayload.outputs ||
    responsePayload
  );
}

function summarizeText(text, maxChars = 700) {
  if (typeof text !== "string") return "";
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (trimmed.length <= maxChars) return trimmed;
  return `${trimmed.slice(0, maxChars)}... [truncated]`;
}

export function serializeDecisionContext({
  prompt = "",
  messages = [],
  hasGroundedHistory = false,
  hasExistingBrief = false,
  existingBriefSummary = "",
  maxTurns = 6,
} = {}) {
  const safeMessages = Array.isArray(messages) ? messages.slice(-Math.max(1, Math.min(maxTurns, 6))) : [];
  const lines = [
    `[CONTEXT_FLAGS] hasGroundedHistory=${Boolean(hasGroundedHistory)} hasExistingBrief=${Boolean(hasExistingBrief)}`,
  ];

  for (const msg of safeMessages) {
    if (!msg || typeof msg !== "object") continue;
    const role = msg.role === "model" ? "assistant" : msg.role || "user";
    const text = summarizeText(typeof msg.content === "string" ? msg.content : "");
    if (text) {
      lines.push(`${role.toUpperCase()}: ${text}`);
    } else if (msg.file?.name) {
      lines.push(`${role.toUpperCase()}: [Attachment: ${String(msg.file.name).slice(0, 80)}]`);
    }
  }

  const trimmedPrompt = typeof prompt === "string" ? prompt.trim() : "";
  const lastTurnText = safeMessages.at(-1)?.content?.trim?.() || "";
  if (trimmedPrompt && trimmedPrompt !== lastTurnText) {
    lines.push(`USER: ${summarizeText(trimmedPrompt, 1500)}`);
  }

  if (existingBriefSummary && typeof existingBriefSummary === "string") {
    lines.push(`EXISTING_BRIEF_SUMMARY: ${summarizeText(existingBriefSummary, 600)}`);
  }

  return lines.join("\n");
}

function detectMediaInput({ messages = [], hasMedia = false, attachments = [] } = {}) {
  if (hasMedia === true) return true;
  const mediaMimePattern = /^(?:image\/|application\/pdf|audio\/)/i;
  if (Array.isArray(attachments)) {
    for (const att of attachments) {
      const mime = String(att?.mimeType || att?.type || "");
      if (mediaMimePattern.test(mime)) return true;
    }
  }
  if (Array.isArray(messages)) {
    for (const msg of messages) {
      const mime = String(msg?.file?.mimeType || msg?.file?.type || "");
      if (mediaMimePattern.test(mime)) return true;
    }
  }
  return false;
}

export function resolveDecisionTimeoutMs({
  serializedContext = "",
  messages = [],
  attachments = [],
  hasMedia = false,
  estimatedTokens = null,
} = {}) {
  if (detectMediaInput({ messages, attachments, hasMedia })) {
    return DECISION_TIMEOUTS_MS.MEDIA_OR_PDF;
  }
  const tokens = Number.isFinite(Number(estimatedTokens))
    ? Number(estimatedTokens)
    : Math.ceil(String(serializedContext || "").length / 4);
  if (tokens > DECISION_LARGE_TEXT_TOKEN_THRESHOLD) {
    return DECISION_TIMEOUTS_MS.LARGE_TEXT;
  }
  return DECISION_TIMEOUTS_MS.SHORT_TEXT;
}

function isTimeoutError(error) {
  if (!error) return false;
  return (
    error.name === "TimeoutError" ||
    error.code === "TIMEOUT" ||
    error.code === "ETIMEDOUT" ||
    error.isTimeout === true
  );
}

function isCircuitBreakerFailure(error) {
  if (!error || error.isSafetyBlock === true || error.code === "AI_SAFETY_BLOCKED" || error.code === "AI_CONTENT_BLOCKED") {
    return false;
  }
  if (error.code === "AI_NOT_CONFIGURED") return false;
  const status = Number(error.status);
  return status === 503 || status === 429 || isTimeoutError(error);
}

function buildComposedSignal(timeoutMs, callerSignal) {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  if (!callerSignal) {
    return { signal: timeoutSignal, timeoutSignal };
  }
  return {
    signal: AbortSignal.any([callerSignal, timeoutSignal]),
    timeoutSignal,
  };
}

export class HelmerDecisionRouter {
  constructor({
    redis = null,
    fetcher = null,
    callDecisionsApiFn = null,
    getVertexClientFn = null,
    hasDecisionApiConfigFn = hasDecisionApiConfiguration,
    env = process.env,
    localFailuresBeforeOpen = REDIS_CIRCUIT_KEYS.THRESHOLD,
  } = {}) {
    this.redis = redis;
    this.hasCustomFetcher = typeof fetcher === "function" || typeof callDecisionsApiFn === "function";
    this.fetcher = fetcher || ((...args) => globalThis.fetch(...args));
    this.callDecisionsApiFn = callDecisionsApiFn || callDecisionsApi;
    this.hasCustomVertexClient = typeof getVertexClientFn === "function";
    this.getVertexClientFn = getVertexClientFn || getDecisionVertexClient;
    this.hasDecisionApiConfigFn = hasDecisionApiConfigFn;
    this.env = env;
    this.localFailuresBeforeOpen = localFailuresBeforeOpen;
    this.localFailures = 0;
    this.localCircuitOpenedUntil = 0;
  }

  _isSyntheticUnmockedStudioConfig() {
    if (this.hasCustomFetcher || this.fetcher?.mock || globalThis.fetch?.mock) return false;
    if (this.env?.NODE_ENV === "production") return false;
    return /^test-/i.test(String(this.env?.GEMINI_API_KEY || "").trim());
  }

  _isSyntheticUnmockedVertexConfig() {
    if (this.hasCustomVertexClient || this.getVertexClientFn?.mock) return false;
    if (this.env?.NODE_ENV === "production") return false;
    const project = String(this.env?.GOOGLE_CLOUD_PROJECT || this.env?.GCP_PROJECT || "").trim();
    const apiKey = String(this.env?.GEMINI_API_KEY || "").trim();
    return /^test-/i.test(project) || (!project && /^test-/i.test(apiKey));
  }

  async _isCircuitOpen() {
    if (this.redis && typeof this.redis.get === "function") {
      try {
        const val = await this.redis.get(REDIS_CIRCUIT_KEYS.CIRCUIT_OPEN);
        return val === "1" || val === 1 || val === true;
      } catch {
        return false;
      }
    }
    return Date.now() < this.localCircuitOpenedUntil;
  }

  async _recordFailure() {
    if (this.redis && typeof this.redis.incr === "function") {
      try {
        const count = Number(await this.redis.incr(REDIS_CIRCUIT_KEYS.FAILURES));
        if (typeof this.redis.expire === "function") {
          await this.redis.expire(REDIS_CIRCUIT_KEYS.FAILURES, REDIS_CIRCUIT_KEYS.FAILURES_TTL_SECONDS);
        }
        if (count >= REDIS_CIRCUIT_KEYS.THRESHOLD && typeof this.redis.set === "function") {
          try {
            await this.redis.set(REDIS_CIRCUIT_KEYS.CIRCUIT_OPEN, "1", {
              EX: REDIS_CIRCUIT_KEYS.OPEN_TTL_SECONDS,
            });
          } catch {
            if (typeof this.redis.setEx === "function") {
              await this.redis.setEx(
                REDIS_CIRCUIT_KEYS.CIRCUIT_OPEN,
                REDIS_CIRCUIT_KEYS.OPEN_TTL_SECONDS,
                "1"
              );
            } else {
              await this.redis.set(REDIS_CIRCUIT_KEYS.CIRCUIT_OPEN, "1");
              if (typeof this.redis.expire === "function") {
                await this.redis.expire(
                  REDIS_CIRCUIT_KEYS.CIRCUIT_OPEN,
                  REDIS_CIRCUIT_KEYS.OPEN_TTL_SECONDS
                );
              }
            }
          }
        }
        return;
      } catch {
        // Fall through gracefully on Redis errors
      }
    }
    this.localFailures += 1;
    if (this.localFailures >= this.localFailuresBeforeOpen) {
      this.localCircuitOpenedUntil = Date.now() + REDIS_CIRCUIT_KEYS.OPEN_TTL_SECONDS * 1000;
    }
  }

  async _resetFailures() {
    this.localFailures = 0;
    this.localCircuitOpenedUntil = 0;
    if (this.redis && typeof this.redis.del === "function") {
      try {
        await this.redis.del(REDIS_CIRCUIT_KEYS.FAILURES);
      } catch {
        // Ignore Redis reset failures
      }
    }
  }

  async _callDecisionsWithResilience({ serializedContext, questions, timeoutMs, signal }) {
    if (!this.hasDecisionApiConfigFn(this.env) || this._isSyntheticUnmockedStudioConfig()) {
      return { skipped: true, reason: "no_api_key" };
    }
    if (await this._isCircuitOpen()) {
      return { skipped: true, reason: "circuit_open" };
    }

    const { signal: composedSignal, timeoutSignal } = buildComposedSignal(timeoutMs, signal);
    try {
      const result = await this.callDecisionsApiFn({
        model: DECISION_MODEL,
        input: serializedContext,
        questions,
        signal: composedSignal,
        fetcher: this.fetcher,
        env: this.env,
      });
      await this._resetFailures();
      return { skipped: false, data: result };
    } catch (error) {
      if (signal?.aborted && !timeoutSignal.aborted) {
        throw error;
      }
      if (error?.isSafetyBlock === true || error?.status === 400 && (error?.code === "AI_SAFETY_BLOCKED" || error?.code === "AI_CONTENT_BLOCKED")) {
        throw Object.assign(new Error(error.message || "Request blocked by safety policy."), {
          code: "AI_SAFETY_BLOCKED",
          status: 400,
          isSafetyBlock: true,
        });
      }
      const normalizedError =
        timeoutSignal.aborted && !isTimeoutError(error)
          ? Object.assign(new Error("Decisions API request timed out."), {
              name: "TimeoutError",
              code: "TIMEOUT",
              isTimeout: true,
            })
          : error;

      if (isCircuitBreakerFailure(normalizedError)) {
        await this._recordFailure();
      }
      return { skipped: false, error: normalizedError };
    }
  }

  async _callVertexFallback({ systemInstruction, serializedContext, schema, signal }) {
    if (signal?.aborted) {
      throw signal.reason || new Error("Aborted");
    }
    if (this._isSyntheticUnmockedVertexConfig()) {
      throw Object.assign(new Error("Synthetic test Vertex config bypassed without mock."), {
        code: "AI_NOT_CONFIGURED",
        status: 503,
      });
    }
    const client = this.getVertexClientFn(null, this.env);
    const { signal: composedSignal } = buildComposedSignal(2500, signal);
    const response = await client.models.generateContent({
      model: DECISION_FALLBACK_MODEL,
      contents: [
        {
          role: "user",
          parts: [{ text: `${systemInstruction}\n\n${serializedContext}` }],
        },
      ],
      config: {
        thinkingConfig: { thinkingLevel: "MINIMAL" },
        temperature: 0.0,
        maxOutputTokens: 64,
        responseMimeType: "application/json",
        abortSignal: composedSignal,
      },
    });
    const rawText =
      response?.text ||
      response?.candidates?.[0]?.content?.parts?.map((p) => p?.text || "").join("") ||
      "";
    const parsed = extractJsonFromText(rawText);
    return schema.parse(parsed);
  }

  _logDecision(mode, result) {
    if (this.env?.NODE_ENV === "test") return result;
    console.info("[DecisionRouter]", JSON.stringify({
      mode,
      routerSource: result.routerSource,
      latencyMs: result.latencyMs,
      ...(mode === "ask"
        ? { enableSearch: result.enableSearch, requireGrounding: result.requireGrounding }
        : {
            briefAction: result.briefAction,
            briefDepth: result.briefDepth,
            needsMarketSearch: result.needsMarketSearch,
          }),
    }));
    return result;
  }

  async routeAsk({
    prompt = "",
    messages = [],
    explicitWeb = false,
    hasStrategyContext = false,
    hasGroundedHistory,
    hasMedia = false,
    estimatedTokens = null,
    signal,
  } = {}) {
    const startedAt = Date.now();
    const lastUserMsg =
      typeof prompt === "string" && prompt.trim()
        ? prompt.trim()
        : Array.isArray(messages)
          ? messages.filter((m) => m && m.role === "user").at(-1)?.content || ""
          : "";

    const groundedHistory =
      typeof hasGroundedHistory === "boolean"
        ? hasGroundedHistory
        : hasGroundedAssistantHistory(messages);

    // 1. 0 ms Deterministic Fast-Path
    const hasExplicitSearchDirective =
      explicitWeb === true ||
      URL_OR_DOMAIN_PATTERN.test(lastUserMsg) ||
      EXPLICIT_SEARCH_DIRECTIVE_PATTERN.test(lastUserMsg);
    if (hasExplicitSearchDirective) {
      const localEval = evaluateSearchRoute({
        prompt: lastUserMsg,
        messages,
        hasStrategyContext,
        hasGroundedHistory: groundedHistory,
      });
      return this._logDecision("ask", {
        enableSearch: true,
        requireGrounding: Boolean(explicitWeb || localEval.requireGrounding),
        intent: "grounded_search",
        prompt: lastUserMsg,
        routerSource: "fast_path",
        confidence: 1,
        latencyMs: 0,
      });
    }

    if (
      !groundedHistory &&
      !hasMedia &&
      lastUserMsg.length > 0 &&
      lastUserMsg.length <= 60 &&
      CONVERSATIONAL_GREETING_FAST_PATH_PATTERN.test(lastUserMsg)
    ) {
      return this._logDecision("ask", {
        enableSearch: false,
        requireGrounding: false,
        intent: "direct_chat",
        prompt: lastUserMsg,
        routerSource: "fast_path",
        confidence: 0.99,
        latencyMs: 0,
      });
    }

    const serializedContext = serializeDecisionContext({
      prompt: lastUserMsg,
      messages,
      hasGroundedHistory: groundedHistory,
      hasExistingBrief: Boolean(hasStrategyContext),
    });

    const timeoutMs = resolveDecisionTimeoutMs({
      serializedContext,
      messages,
      hasMedia,
      estimatedTokens,
    });

    // 2. Primary: Decisions API (gemini-decision-1)
    const primary = await this._callDecisionsWithResilience({
      serializedContext,
      questions: ASK_DECISION_QUESTIONS,
      timeoutMs,
      signal,
    });

    if (!primary.skipped && primary.data && !primary.error) {
      const map = resolveDecisionMap(primary.data);
      const webScore = extractNoulScore(map.needs_web_search, 0);
      const groundingScore = extractNoulScore(map.require_grounding, 0);
      const requireGrounding = groundingScore >= DECISION_THRESHOLDS.ASK_REQUIRE_GROUNDING;
      const enableSearch = requireGrounding || webScore >= DECISION_THRESHOLDS.ASK_NEEDS_WEB_SEARCH;
      const confidence = Math.max(
        enableSearch ? Math.max(webScore, groundingScore) : 1 - webScore,
        0
      );
      return this._logDecision("ask", {
        enableSearch,
        requireGrounding,
        intent: enableSearch ? "grounded_search" : "standard",
        prompt: lastUserMsg,
        routerSource: "decisions_api",
        confidence: Number(confidence.toFixed(4)),
        latencyMs: Date.now() - startedAt,
      });
    }

    // 3. Deterministic Grounded Follow-up & Search Guard before Vertex Fallback
    if (groundedHistory && GROUNDED_VERIFICATION_FOLLOWUP_PATTERN.test(lastUserMsg)) {
      const localEval = evaluateSearchRoute({
        prompt: lastUserMsg,
        messages,
        hasStrategyContext,
        hasGroundedHistory: groundedHistory,
      });
      if (localEval.enableSearch) {
        return this._logDecision("ask", {
          enableSearch: true,
          requireGrounding: Boolean(localEval.requireGrounding),
          intent: "grounded_search",
          prompt: lastUserMsg,
          routerSource: "local_rules",
          confidence: 0.95,
          latencyMs: Date.now() - startedAt,
        });
      }
    }

    // 4. Fallback 1: gemini-3.5-flash-lite (MINIMAL thinking) on Vertex AI
    try {
      const fallbackSystemInstruction =
        'Return compact JSON ONLY matching {"s":boolean,"r":boolean}. ' +
        '"s": true if the latest user message (including short verification follow-ups like "Dəqiq?"/"Really?" when hasGroundedHistory=true) requires live web search. ' +
        '"r": true ONLY if the message strictly requires verified official/regulatory facts (central bank rates, official inflation, binding statistics).';
      const parsed = await this._callVertexFallback({
        systemInstruction: fallbackSystemInstruction,
        serializedContext,
        schema: ASK_FALLBACK_SCHEMA,
        signal,
      });
      const enableSearch = Boolean(parsed.s || parsed.r);
      const requireGrounding = Boolean(parsed.r);
      return this._logDecision("ask", {
        enableSearch,
        requireGrounding,
        intent: enableSearch ? "grounded_search" : "standard",
        prompt: lastUserMsg,
        routerSource: "vertex_flash_lite",
        confidence: 0.8,
        latencyMs: Date.now() - startedAt,
      });
    } catch (error) {
      if (signal?.aborted) throw error;
    }

    // 4. Fallback 2: Deterministic Local Rules
    const fallbackRoute = evaluateSearchRoute({
      prompt: lastUserMsg,
      messages,
      hasStrategyContext,
      hasGroundedHistory: groundedHistory,
    });

    return this._logDecision("ask", {
      enableSearch: fallbackRoute.enableSearch,
      requireGrounding: fallbackRoute.requireGrounding,
      intent: fallbackRoute.intent,
      prompt: fallbackRoute.prompt,
      routerSource: "local_rules",
      confidence: 0.5,
      latencyMs: Date.now() - startedAt,
    });
  }

  async routeBuild({
    prompt = "",
    messages = [],
    hasAttachments = false,
    isBriefGeneration = true,
    hasExistingBrief = false,
    existingBriefSummary = "",
    hasMedia = false,
    attachments = [],
    estimatedTokens = null,
    signal,
  } = {}) {
    const startedAt = Date.now();
    const trimmedPrompt = typeof prompt === "string" ? prompt.trim() : "";

    // 1. 0 ms Deterministic Fast-Path
    if (hasAttachments === true && isBriefGeneration) {
      return {
        briefAction: "draft_brief",
        briefDepth: 1,
        needsMarketSearch: false,
        hasEnoughContext: true,
        routerSource: "fast_path",
        confidence: 1,
        latencyMs: 0,
      };
    }

    const serializedContext = serializeDecisionContext({
      prompt: trimmedPrompt,
      messages,
      hasGroundedHistory: hasGroundedAssistantHistory(messages),
      hasExistingBrief,
      existingBriefSummary,
    });

    const timeoutMs = resolveDecisionTimeoutMs({
      serializedContext,
      messages,
      attachments,
      hasMedia: Boolean(hasMedia || hasAttachments),
      estimatedTokens,
    });

    // 2. Primary: Decisions API (gemini-decision-1)
    const primary = await this._callDecisionsWithResilience({
      serializedContext,
      questions: BUILD_DECISION_QUESTIONS,
      timeoutMs,
      signal,
    });

    if (!primary.skipped && primary.data && !primary.error) {
      const map = resolveDecisionMap(primary.data);
      const validActions = ["draft_brief", "refine_brief", "ask_questions", "brief_qa", "other"];
      const rawAction = extractChoiceResult(
        map.brief_action,
        validActions,
        hasExistingBrief ? "refine_brief" : "draft_brief"
      );
      const briefDepth = extractIntegerScore(map.brief_depth, 0, 2, 1);
      const marketScore = extractNoulScore(map.needs_market_search, 0);
      const contextScore = extractNoulScore(map.has_enough_context, 1);
      const hasEnoughContext = contextScore >= DECISION_THRESHOLDS.BUILD_MIN_ENOUGH_CONTEXT;
      const briefAction = !hasEnoughContext ? "ask_questions" : rawAction;
      const needsMarketSearch = marketScore >= DECISION_THRESHOLDS.BUILD_NEEDS_MARKET_SEARCH;

      return {
        briefAction,
        briefDepth,
        needsMarketSearch,
        hasEnoughContext,
        routerSource: "decisions_api",
        confidence: Number(Math.max(contextScore, 1 - contextScore).toFixed(4)),
        latencyMs: Date.now() - startedAt,
      };
    }

    // 3. Fallback 1: gemini-3.5-flash-lite (MINIMAL thinking) on Vertex AI
    try {
      const fallbackSystemInstruction =
        'Return compact JSON ONLY matching {"a":"draft_brief"|"refine_brief"|"ask_questions"|"brief_qa"|"other","d":0|1|2,"m":boolean,"c":boolean}. ' +
        '"a"=primary Build Brief intent, "d"=depth (0=quick MVP,1=standard SaaS,2=comprehensive enterprise), ' +
        '"m"=true if live web search benefits competitors/APIs/regulatory/benchmarks, "c"=true if context is enough to draft immediately without discovery questions.';
      const parsed = await this._callVertexFallback({
        systemInstruction: fallbackSystemInstruction,
        serializedContext,
        schema: BUILD_FALLBACK_SCHEMA,
        signal,
      });
      return {
        briefAction: !parsed.c ? "ask_questions" : parsed.a,
        briefDepth: parsed.d,
        needsMarketSearch: Boolean(parsed.m),
        hasEnoughContext: Boolean(parsed.c),
        routerSource: "vertex_flash_lite",
        confidence: 0.8,
        latencyMs: Date.now() - startedAt,
      };
    } catch (error) {
      if (signal?.aborted) throw error;
    }

    // 4. Fallback 2: Emergency Deterministic Local Rules
    return {
      briefAction: hasExistingBrief ? "refine_brief" : "draft_brief",
      briefDepth: 1,
      needsMarketSearch: false,
      hasEnoughContext: true,
      routerSource: "local_rules",
      confidence: 0.5,
      latencyMs: Date.now() - startedAt,
    };
  }
}

export function createHelmerDecisionRouter(options = {}) {
  return new HelmerDecisionRouter(options);
}
