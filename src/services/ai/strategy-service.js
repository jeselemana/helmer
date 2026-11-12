import { assertExecutionActive } from '../security/execution-control.js';
import {
  StrategyAssessmentSchema,
  StrategySchema,
  StrategySummaryOutputSchema,
  PlannerTaskSummaryOutputSchema,
  PlannerTaskPriorityOutputSchema,
  serializeStrategyContext,
  analyzeBriefSignals,
  evaluateBriefSufficiency,
  stripInlineGroundingRedirectUrls,
  validateAssessment,
} from "../../domain/strategy.js";
import { aiConfig, hasOpenAIConfiguration } from "./config.js";
import { getOpenAIClient } from "./client.js";
import { LLMProviderError, extractJsonFromText } from "./llm-router.js";
import { runBuildOrchestration } from "./build-orchestrator.js";
import { isGroundedStrategyRecord } from "./grounded-chat-retention.js";
import { buildRoutingInput } from "./build-estimate.js";
import {
  IMMEDIATE_ACTION_ITEMS_RULES,
  buildAssessorPrompt,
  buildRefinementInput,
  buildRefinementPrompt,
  buildStrategyPrompt,
} from "./prompts.js";

function clarificationContext(answers) {
  if (!answers?.length) return "No clarification answers have been provided.";
  return answers.map((item) => `${item.question}\nAnswer: ${item.answer}`).join("\n\n");
}

export function validateActionItemTiming(taskText, timeframe = "Today", language = "az") {
  const isEn = language === "en";
  const normalizedTf = String(timeframe || "").toLowerCase().trim();
  const text = String(taskText || "").trim();
  const lowerText = text.toLowerCase();
  const issues = [];

  const isToday = normalizedTf.includes("bu gün") || normalizedTf.includes("today");
  const is48h = normalizedTf.includes("48") || normalizedTf.includes("iki gün") || normalizedTf.includes("two days");
  const isThisWeek = normalizedTf.includes("həftə") || normalizedTf.includes("week");

  // Rule 1: BU GÜN / TODAY:
  // Only 24h single trigger steps. Prohibit multi-day processes like "7 gün ərzində izləyin", "həftə boyunca", etc.
  if (isToday) {
    const multiDayMatch = lowerText.match(/(?:(?:növbəti\s*)?(?:7|yeddi|seven)\s*(?:gün|days?)|(?:həftə\s*(?:ərzində|boyunca)|throughout\s*the\s*week|over\s*(?:the\s*)?next\s*7\s*days|bir\s*həftə\s*ərzində))/i);
    if (multiDayMatch) {
      issues.push(
        isEn
          ? "Multi-day processes (e.g., 'monitor over next 7 days') cannot be placed under 'Today'. Only single 24-hour trigger steps are permitted."
          : "'7 gün ərzində izləyin' kimi çoxgünlük proseslər 'Bu gün' başlığı altına salına bilməz. Yalnız ilk 24 saatda bitirilə bilən tək-tək tətikləyici addımlar olmalıdır."
      );
    }
  }

  // Rule 2: NÖVBƏTİ 48 SAAT / NEXT 48 HOURS:
  // Preparations achievable strictly within 2 days. Prohibit 20-30 in-depth customer interviews or multi-week workloads.
  if (is48h) {
    const heavyInterviewMatch = lowerText.match(/(?:(?:20\s*[-–—]\s*30|iyirmi\s*[-–—]\s*otuz|20\s*to\s*30)\s*(?:(?:dərin|in[- ]depth)\s*)?(?:(?:müştəri|customer)\s*)?(?:müsahibə\w*|interviews?|görüş\w*|meetings?)|(?:həftələrlə\s*(?:vaxt|çəkən)|weeks?\s*of\s*interviews))/i);
    if (heavyInterviewMatch) {
      issues.push(
        isEn
          ? "Conducting 20–30 in-depth interviews takes weeks and cannot be completed in 48 hours. Limit to drafting questions and contacting the first 3 candidates."
          : "20–30 dərin müştəri müsahibəsi kimi həftələrlə vaxt aparacaq tapşırıqlar 'Növbəti 48 saat' bölməsinə salına bilməz (maksimum sualların hazırlanması və ilk 3 namizədlə əlaqə)."
      );
    }
  }

  // Rule 3: BU HƏFTƏ / THIS WEEK:
  // Pilot setup and first test orders. Prohibit second-order retention analysis, cohort retention tracking, or repeat-purchase optimizations.
  if (isThisWeek) {
    const prematureRetentionMatch = lowerText.match(/(?:(?:ikinci|2-?ci)\s*sifariş\s*(?:kohortu?\s*)?(?:və\s*)?(?:retention|analiz)|retention\s*analiz|kohort\s*(?:retention|analiz)|cohort\s*retention|second[- ]order\s*(?:cohort|retention)|təkrar\s*alış\s*analiz)/i);
    if (prematureRetentionMatch) {
      issues.push(
        isEn
          ? "Second-order retention or cohort analysis cannot be required for this week before the pilot has launched and matured."
          : "Pilot yeni qurulduğu halda 'Bu həftə' bölməsində ikinci sifariş kohortu və retention analizi tələb edilə bilməz; kohort izlənməsi növbəti mərhələlərə saxlanmalıdır."
      );
    }
  }

  return {
    valid: issues.length === 0,
    issues,
    timeframe,
    task: text,
  };
}

export function validateNextStepsSequencing(nextSteps = [], language = "az") {
  if (!Array.isArray(nextSteps) || nextSteps.length === 0) {
    return { valid: true, issues: [], evaluated: [] };
  }

  const isEn = language === "en";
  const defaultTimeframes = isEn
    ? ["Today", "Next 48 hours", "This week"]
    : ["Bu gün", "Növbəti 48 saat", "Bu həftə"];

  const chunkSize = Math.max(1, Math.ceil(nextSteps.length / 3));
  const evaluated = [];
  const allIssues = [];

  nextSteps.forEach((step, index) => {
    const groupIndex = Math.min(2, Math.floor(index / chunkSize));
    const tf = defaultTimeframes[groupIndex];
    const rawText = typeof step === "string" ? step : (step?.title || step?.text || "");
    const res = validateActionItemTiming(rawText, tf, language);
    evaluated.push({ ...res, index, groupIndex });
    if (!res.valid) {
      allIssues.push(...res.issues.map((msg) => `[${tf} / #${index + 1}] ${msg}`));
    }
  });

  return {
    valid: allIssues.length === 0,
    issues: allIssues,
    evaluated,
  };
}

export function alignNextStepsLogic(nextSteps = [], language = "az") {
  if (!Array.isArray(nextSteps) || nextSteps.length === 0) {
    return nextSteps;
  }
  const isEn = language === "en";
  const chunkSize = Math.max(1, Math.ceil(nextSteps.length / 3));

  return nextSteps.map((step, index) => {
    let text = typeof step === "string" ? step : (step?.title || step?.text || "");
    const groupIndex = Math.min(2, Math.floor(index / chunkSize));

    // Group 0: BU GÜN / TODAY (First 24 hours)
    if (groupIndex === 0) {
      if (/(?:(?:növbəti\s*)?(?:7|yeddi|seven)\s*(?:gün|days?)|(?:həftə\s*(?:ərzində|boyunca)|throughout\s*the\s*week|over\s*(?:the\s*)?next\s*7\s*days|bir\s*həftə\s*ərzində))/i.test(text)) {
        text = isEn
          ? "Set up the tracking framework and brief the team today for upcoming launch monitoring."
          : "Monitorinq və izləmə cədvəlinin ilkin qaralamasını bu gün açın və komandaya rəsmi təlimat göndərin.";
      }
    }

    // Group 1: NÖVBƏTİ 48 SAAT / NEXT 48 HOURS (Next 2 days)
    if (groupIndex === 1) {
      if (/(?:(?:20\s*[-–—]\s*30|iyirmi\s*[-–—]\s*otuz|20\s*to\s*30)\s*(?:(?:dərin|in[- ]depth)\s*)?(?:(?:müştəri|customer)\s*)?(?:müsahibə\w*|interviews?|görüş\w*|meetings?)|(?:həftələrlə\s*(?:vaxt|çəkən)|weeks?\s*of\s*interviews))/i.test(text)) {
        text = isEn
          ? "Draft interview questions and contact the first 3 candidates to schedule pilot discovery sessions."
          : "Müsahibə suallarının hazırlanması və ilk 3 namizədlə əlaqə quraraq ilkin qrafikin razılaşdırılması.";
      }
    }

    // Group 2: BU HƏFTƏ / THIS WEEK (Next 7 days)
    if (groupIndex === 2) {
      if (/(?:(?:ikinci|2-?ci)\s*sifariş\s*(?:kohortu?\s*)?(?:və\s*)?(?:retention|analiz)|retention\s*analiz|kohort\s*(?:retention|analiz)|cohort\s*retention|second[- ]order\s*(?:cohort|retention)|təkrar\s*alış\s*analiz)/i.test(text)) {
        text = isEn
          ? "Set up the pilot offer and collect the first test orders to validate immediate operational delivery."
          : "Pilot layihənin qurulması və ilk test sifarişlərinin qəbul edilərək əməliyyat prosesinin yoxlanılması.";
      }
    }

    return typeof step === "string" ? text : { ...step, title: text, text };
  });
}

export async function estimateBuildPreparation({ brief, buildMode = "auto", fasterThinkingLevel = "medium", ownerId, signal }) {
  const routingInput = buildRoutingInput({ brief, buildMode, fasterThinkingLevel });
  return runBuildOrchestration({
    schema: StrategyAssessmentSchema, assessment: true, estimateOnly: true,
    name: "build_estimate", instructions: "", input: routingInput, routingInput, ownerId, signal,
    buildMode, fasterThinkingLevel,
  });
}

export async function assessBrief({
  brief,
  answers = [],
  round = 0,
  language = "az",
  buildMode = "auto",
  fasterThinkingLevel = "medium",
  ownerId,
  signal,
  personalizationContext = "",
  onChunk,
  onUsage,
  onEstimate,
}) {
  const isEn = language === "en";
  const sufficiency = evaluateBriefSufficiency(brief, { round, answers });
  if (sufficiency.sufficient && round === 0 && (!answers || answers.length === 0)) {
    return {
      status: "ready",
      understanding: isEn
        ? "The brief provides sufficient business, market, execution scope, and operational parameters to proceed directly to strategy generation."
        : "Təqdim edilən brif biznes hədəfi, bazar konteksti, icra miqyası və əməliyyat parametrləri baxımından birbaşa strategiya generasiyası üçün tam kifayətdir.",
      questions: [],
      assumptions: [],
    };
  }
  const signals = sufficiency.signals || analyzeBriefSignals(brief);
  const forceDecision = round >= aiConfig.maxClarificationRounds;
  const languageDirective = isEn
    ? "IMPORTANT LANGUAGE REQUIREMENT: The user has selected ENGLISH as the UI language. All generated outputs (understanding, every question, reason, options, and assumptions) MUST BE WRITTEN IN ENGLISH, even if the brief is in Azerbaijani or discusses Azerbaijani topics."
    : "DİL TƏLƏBİ: İstifadəçinin interfeys dili AZƏRBAYCAN dilidir. Bütün suallar, səbəblər, seçimlər və fərziyyələr Azərbaycan dilində formalaşdırılmalıdır.";

  const input = `Original brief:\n${brief}\n\nClarification answers:\n${clarificationContext(answers)}\n\nIntake signals (advisory only):\n${JSON.stringify(signals)}\n\nClarification round: ${round} of ${aiConfig.maxClarificationRounds}.\n${
    forceDecision
      ? (isEn
          ? "The clarification limit has been reached. Return ready and clearly state reasonable assumptions in English unless the business itself or objective is impossible to identify."
          : "The clarification limit has been reached. Return ready and clearly state reasonable assumptions unless the business itself or objective is impossible to identify.")
      : (isEn
          ? "Decide whether a targeted clarification round is materially useful. All questions and options must be in English."
          : "Decide whether a targeted clarification round is materially useful.")
  }\n\n${languageDirective}`;

  const instructions = buildAssessorPrompt({ brief, answers });

  const data = await runBuildOrchestration({
    schema: StrategyAssessmentSchema, name: "strategy_assessment",
    instructions, input, personalizationContext, ownerId, signal, onChunk, onUsage,
    routingInput: buildRoutingInput({ brief, answers, buildMode, fasterThinkingLevel }), onEstimate,
    assessment: true,
    buildMode, fasterThinkingLevel,
  });

  const assessment = validateAssessment(data);
  if (forceDecision && assessment.status === "needs_clarification") {
    return {
      status: "ready",
      understanding: assessment.understanding,
      questions: [],
      assumptions: [
        isEn
          ? "Some intake details were not provided, so the strategy proceeds with clearly labeled working assumptions."
          : "Bəzi ilkin detallar təqdim edilmədiyi üçün strategiya aydın qeyd edilmiş işçi fərziyyələrlə davam edir.",
      ],
    };
  }
  return assessment;
}

export function extractGroundingSources(metadata) {
  const sources = [];
  const seenUrls = new Set();
  for (const chunk of metadata?.groundingChunks || []) {
    const web = chunk?.web;
    if (!web?.uri || sources.length >= 20) continue;
    try {
      const url = new URL(String(web.uri).trim());
      if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.href.length > 2000 || seenUrls.has(url.href)) continue;
      const host = url.hostname.toLowerCase().replace(/^(?:www\.)+/i, "").replace(/\.+$/, "");
      if (
        !host ||
        host === "vertexaisearch.cloud.google.com" ||
        host.endsWith(".vertexaisearch.cloud.google.com") ||
        url.pathname.includes("/grounding-api-redirect") ||
        (/^(?:[a-z0-9-]+\.)*google\.[a-z.]{2,6}$/i.test(host) && (url.pathname === "/url" || url.pathname.startsWith("/url/"))) ||
        /\.(?:local|internal|localhost|localdomain|arpa|home|corp|lan)$/i.test(host) ||
        /^(?:localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|172\.(?:1[6-9]|2\d|3[01])\.|\[?(?:::1|fe80:|fc00:|fd00:))/.test(host) ||
        !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i.test(host)
      ) {
        continue;
      }
      seenUrls.add(url.href);
      sources.push({ title: String(web.title || host).slice(0, 200), url: url.href });
    } catch { /* Ignore malformed source URLs. */ }
  }
  return sources;
}

export async function generateStrategy({
  brief,
  answers = [],
  assumptions = [],
  language = "az",
  buildMode = "auto",
  fasterThinkingLevel = "medium",
  ownerId,
  signal,
  personalizationContext = "",
  onChunk,
  onUsage,
}) {
  const isEn = language === "en";
  const normalizedMode = buildMode === "faster" ? "faster" : "auto";
  const normalizedFasterThinking = fasterThinkingLevel === "high" ? "high" : "medium";
  const languageDirective = isEn
    ? "\n\nLanguage Directive: The user has selected English. Generate the entire strategy in clear, professional English."
    : "\n\nLanguage Directive: Strategiyanı təmiz, peşəkar Azərbaycan dilində hazırla.";

  const input = JSON.stringify({ brief, answers, assumptions, languageDirective });
  const instructions = buildStrategyPrompt({ brief, answers, buildMode: normalizedMode });
  const rawStrategyData = await runBuildOrchestration({
    schema: StrategySchema, name: "helmer_strategy", instructions, input,
    personalizationContext, ownerId, signal, onChunk, onUsage,
    routingInput: buildRoutingInput({ brief, answers, assumptions, buildMode: normalizedMode, fasterThinkingLevel: normalizedFasterThinking }),
    onEstimate: preparationEstimate => onChunk?.({ preparationEstimate }),
    buildMode: normalizedMode,
    fasterThinkingLevel: normalizedFasterThinking,
  });

  const strategyData = stripInlineGroundingRedirectUrls(rawStrategyData);
  if (Array.isArray(strategyData?.nextSteps)) {
    strategyData.nextSteps = alignNextStepsLogic(strategyData.nextSteps, language);
  }

  return strategyData;
}

export async function refineStrategy(payload, ownerId, signal, personalizationContext = "", onChunk, onUsage) {
  if (isGroundedStrategyRecord(payload.strategy)) {
    throw Object.assign(new Error("Grounded strategy is restricted"), { code: "GROUNDED_STRATEGY_RESTRICTED", status: 422 });
  }
  const effectiveBuildMode = (payload.buildMode || payload.strategy?.orchestration?.buildMode || "auto") === "faster" ? "faster" : "auto";
  const effectiveFasterThinking = (
    payload.fasterThinkingLevel ||
    payload.strategy?.orchestration?.fasterThinkingLevel ||
    (effectiveBuildMode === "faster" && String(payload.strategy?.orchestration?.thinkingLevel || "").toUpperCase() === "HIGH" ? "high" : "medium")
  ) === "high" ? "high" : "medium";
  const languageDirective = payload.language === "en"
    ? "Generate the refined strategy in professional English."
    : "Strategiyanı peşəkar Azərbaycan dilində hazırla.";
  const instructions = buildRefinementPrompt({
    brief: payload.brief,
    answers: payload.answers,
    strategy: payload.strategy,
    buildMode: effectiveBuildMode,
  });
  const rawStrategyData = await runBuildOrchestration({
    schema: StrategySchema, name: "helmer_refined_strategy", instructions, refinement: true,
    input: `${buildRefinementInput(payload)}\n${languageDirective}`,
    searchIntentInput: `${payload.action} ${payload.request || ""}`,
    routingInput: JSON.stringify({
      brief: payload.brief,
      answers: payload.answers,
      action: payload.action,
      request: payload.request,
      summary: payload.strategy?.summary,
      objective: payload.strategy?.context?.objective,
      market: payload.strategy?.context?.market,
      sectionTitles: Array.isArray(payload.strategy?.sections)
        ? payload.strategy.sections.slice(0, 8).map((s) => s?.title).filter(Boolean)
        : undefined,
      kpis: Array.isArray(payload.strategy?.kpis)
        ? payload.strategy.kpis.slice(0, 6).map((k) => `${k?.name || ""}: ${k?.target || ""}`.trim()).filter(Boolean)
        : undefined,
      assumptions: Array.isArray(payload.strategy?.assumptions)
        ? payload.strategy.assumptions.slice(0, 6)
        : undefined,
    }),
    personalizationContext, ownerId, signal, onChunk, onUsage,
    buildMode: effectiveBuildMode,
    fasterThinkingLevel: effectiveFasterThinking,
  });
  const strategyData = stripInlineGroundingRedirectUrls(rawStrategyData);
  if (Array.isArray(strategyData?.nextSteps)) {
    strategyData.nextSteps = alignNextStepsLogic(strategyData.nextSteps, payload.language || "az");
  }
  return strategyData;
}

export async function summarizeStrategyWithLuna({
  strategy,
  language = "az",
  client = null,
  signal = null,
  onUsage = null,
}) {
  if (isGroundedStrategyRecord(strategy)) {
    throw Object.assign(new Error("Grounded strategy is restricted"), { code: "GROUNDED_STRATEGY_RESTRICTED", status: 422 });
  }
  const isEn = language === "en";
  const modelName = aiConfig.strategySummaryModel || "gpt-5.6-luna";

  if (!client && !hasOpenAIConfiguration()) {
    const err = new Error("OpenAI is not configured.");
    err.code = "AI_NOT_CONFIGURED";
    err.model = modelName;
    throw err;
  }

  const openaiClient = client || getOpenAIClient();
  const strategyContext = serializeStrategyContext(strategy);

  const systemPrompt = isEn
    ? `You are an elite Chief Strategy Officer and executive advisor.
Analyze the complete business and marketing strategy provided below and produce an incisive, high-impact executive summary.

STRICT REQUIREMENTS:
1. No fluff, no boilerplate corporate buzzwords. Present direct, actionable points, key metrics, and decisive strategic moves.
2. The summary must be comprehensive yet punchy, precisely covering every critical pillar of the strategy:
   - Objective: core business goal, target market, and primary audience
   - Key Moves: decisive strategic and tactical differentiators (at least 3-5 concrete moves)
   - Execution Direction: implementation roadmap, key phases, and sequencing
   - Budget & KPIs: budget allocation logic, target metrics, and measurable benchmarks
   - Executive Takeaway: decisive bottom-line verdict and strategic priority for leadership
3. Return ONLY a valid JSON object matching this structure:
{
  "title": "Strategy Title",
  "objective": "Concise summary of core objectives and market focus",
  "keyMoves": [
    "Critical strategic move 1",
    "Critical strategic move 2",
    "Critical strategic move 3"
  ],
  "execution": "Execution roadmap and phase breakdown",
  "kpisAndBudget": "Budget considerations and target KPIs",
  "takeaway": "Decisive executive takeaway for leadership",
  "summary": "Cohesive, high-impact executive summary paragraph uniting all points"
}`
    : `Sən yüksək səviyyəli strateq və icraçı direktorsan (Chief Strategy Officer).
Sənə təqdim olunan marketinq və biznes strategiyasının tam məzmununu dərindən təhlil edib, qərarvericilər üçün kəsərli, konkret və dolğun xülasə hazırlamalısan.

CİDDİ TƏLƏBLƏR:
1. Boş söz yığını, ümumi bəlağətli ifadələr qətiyyən olmamalıdır. Birbaşa konkret faktlar, rəqəmlər və əsas qərarlar verilməlidir.
2. Xülasə yığcam, lakin strategiyanın bütün kritik bəndlərini dəqiq əks etdirən ətraflı xülasə formatında olmalıdır:
   - Hədəf: biznesin əsas məqsədi, hədəf kütləsi və bazar fokusu
   - Əsas gedişlər: strategiyanı fərqləndirən və qələbə gətirən ən mühüm taktiki və strateji addımlar (ən azı 3-5 konkret addım)
   - İcra istiqaməti: icra mərhələləri, ardıcıllıq və əsas addımlar
   - Büdcə və KPI: büdcə istiqamətləri və ölçülə bilən əsas nəticə göstəriciləri
   - Kəsərli yekun: qərarverici üçün ən mühüm strateji nəticə və rəhbərlik üçün əsas mesaj
3. Cavab YALNIZ aşağıdakı struktura uyğun valid JSON formatında olmalıdır:
{
  "title": "Strategiyanın adı",
  "objective": "Konkret hədəf və bazar fokusunun xülasəsi",
  "keyMoves": [
    "1-ci kritik strateji gediş",
    "2-ci kritik strateji gediş",
    "3-cü kritik strateji gediş"
  ],
  "execution": "İcra ardıcıllığı və əsas mərhələlərin xülasəsi",
  "kpisAndBudget": "Büdcə bölgüsü və əsas ölçülə bilən KPI hədəfləri",
  "takeaway": "Qərarverici üçün kəsərli strateji yekun",
  "summary": "Bütün bu məqamları birləşdirən bütöv, axıcı və kəsərli xülasə mətni"
}`;

  const userContent = isEn
    ? `Generate an incisive, high-impact executive summary for this strategy:\n\n${strategyContext}`
    : `Aşağıdakı strategiya üçün kəsərli, dolğun və konkret icraçı xülasəsini tərtib et:\n\n${strategyContext}`;

  signal?.throwIfAborted();
  let completion;
  try {
    completion = await openaiClient.chat.completions.create(
      {
        model: modelName,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userContent },
        ],
        response_format: { type: "json_object" },
      },
      signal ? { signal } : undefined,
    );
  } catch (error) {
    assertExecutionActive(error, signal);
    throw error;
  }

  if (typeof onUsage === "function" && completion.usage) {
    onUsage({
      provider: "openai",
      model: modelName,
      usage: {
        inputTokens: completion.usage.prompt_tokens,
        outputTokens: completion.usage.completion_tokens,
        totalTokens: completion.usage.total_tokens,
      },
    });
  }

  const rawContent = completion.choices?.[0]?.message?.content?.trim() || "{}";
  let parsed;
  try {
    parsed = extractJsonFromText(rawContent);
  } catch (jsonErr) {
    throw new LLMProviderError("Model etibarsız JSON cavabı qaytardı.", {
      code: "AI_INVALID_OUTPUT",
      status: 502,
      model: modelName,
      cause: jsonErr,
    });
  }

  const validated = StrategySummaryOutputSchema.parse({
    title: parsed.title || strategy?.title || (isEn ? "Strategy Summary" : "Strategiya Xülasəsi"),
    objective: parsed.objective || "",
    keyMoves: Array.isArray(parsed.keyMoves) ? parsed.keyMoves.map(String) : [],
    execution: parsed.execution || "",
    kpisAndBudget: parsed.kpisAndBudget || "",
    takeaway: parsed.takeaway || "",
    summary: parsed.summary || "",
  });

  return {
    ...validated,
    model: modelName,
  };
}

export function fallbackSummarizeTasks(tasks = [], language = "az", model = "gpt-6-luna") {
  const isEn = language === "en";
  const defaultTimeframes = isEn
    ? ["Today", "Next 48 hours", "This week"]
    : ["Bu gün", "Növbəti 48 saat", "Bu həftə"];

  const chunkSize = Math.max(1, Math.ceil(tasks.length / 3));

  const validated = tasks.map((item, index) => {
    const rawText = typeof item === "string" ? item : (item.title || item.text || "");
    const cleaned = String(rawText).replace(/^[\s\-*•\d.)\]]+/, "").trim();
    const groupIndex = Math.min(2, Math.floor(index / chunkSize));
    const fallbackTf = defaultTimeframes[groupIndex] || defaultTimeframes[0];
    let tf = (typeof item === "object" && (item.timeframe || item.groupLabel)) ? (item.timeframe || item.groupLabel) : fallbackTf;

    // Timeframe alignment & causality correction
    const lowerText = cleaned.toLowerCase();
    const isToday = tf.toLowerCase().includes("bu gün") || tf.toLowerCase().includes("today");
    if (isToday && /(?:(?:növbəti\s*)?(?:7|yeddi|seven)\s*(?:gün|days?)|(?:həftə\s*(?:ərzində|boyunca)|throughout\s*the\s*week|over\s*(?:the\s*)?next\s*7\s*days|bir\s*həftə\s*ərzində))/i.test(lowerText)) {
      tf = defaultTimeframes[2]; // reassign multi-day process to This week
    }

    const isPriority = groupIndex === 0 || index === 0;
    return {
      title: cleaned || rawText,
      timeframe: tf,
      status: "todo",
      isPriority,
      priority: isPriority ? "high" : "normal",
    };
  }).filter((t) => Boolean(t.title));

  return {
    tasks: validated,
    model,
  };
}

export async function summarizeTasksWithLuna({
  tasks = [],
  strategyTitle = "",
  language = "az",
  client = null,
  signal = null,
  onUsage = null,
}) {
  const isEn = language === "en";
  const modelName = aiConfig.plannerSummaryModel || "gpt-6-luna";

  if (!client && !hasOpenAIConfiguration()) {
    return fallbackSummarizeTasks(tasks, language, modelName);
  }

  const openaiClient = client || getOpenAIClient();

  const taskLines = tasks
    .map((item, idx) => {
      if (typeof item === "string") return `${idx + 1}. ${item}`;
      const text = item.title || item.text || "";
      const tf = item.timeframe || item.groupLabel || "";
      return `${idx + 1}. [${tf || "General"}] ${text}`;
    })
    .join("\n");

  const systemPrompt = isEn
    ? `You are an elite productivity and strategic execution AI assistant powered by gpt-6-luna.
Your role is to analyze raw strategic action items from 'IMMEDIATE NEXT STEPS' and convert them into clear, concise, actionable, and punchy Planner tasks adhering strictly to realistic execution timeframes and operational causality.

STRICT REQUIREMENTS:
1. Each task must start with an active imperative verb (e.g., 'Launch', 'Finalize', 'Audit', 'Draft', 'Contact', 'Review').
2. Keep tasks focused, unambiguous, and realistic for immediate execution.
3. Strict Timeframe Compliance ('Today', 'Next 48 hours', or 'This week'):
   - 'Today': ONLY single trigger steps that can be started and finished within the first 24 hours (e.g., 'Send formal brief to legal counsel', 'Open draft budget allocation spreadsheet'). Long multi-day processes like 'Monitor over 7 days' must NEVER be assigned to 'Today'.
   - 'Next 48 hours': Initial preparation and concrete setup achievable strictly within 2 days (e.g., 'Draft interview questions and contact first 3 candidates', 'Finalize 3 pilot packages and pricing'). Never squeeze multi-week tasks (like conducting 20–30 customer interviews) into 48 hours.
   - 'This week': Pilot setup and collecting first test orders. Never demand second-order retention analysis, cohort tracking, or repeat-purchase optimizations for a newly launched pilot; cohort analysis belongs to subsequent phases.
4. Strict Causality: No analytical result can be demanded before the physical operational action has taken place.
5. Set status to 'todo' for every task.
6. Return ONLY a valid JSON object matching this structure:
{
  "tasks": [
    {
      "title": "Action-oriented concise task title",
      "timeframe": "Today",
      "status": "todo"
    }
  ]
}`
    : `Sən gpt-6-luna tərəfindən gücləndirilmiş strateji icra və tapşırıq optimizasiyası üzrə süni intellekt köməkçisisən.
Vəzifən strategiyanın '06. NÖVBƏTİ ADDIMLAR' bölməsindəki xam maddələri təhlil edərək onları Planner üçün aydın, konkret, kəsərli və icraya hazır tapşırıqlara çevirməkdir. Bütün tapşırıqlar dəqiq zaman çərçivəsi və səbəb-nəticə məntiqinə uyğun olmalıdır.

CİDDİ TƏLƏBLƏR:
1. Hər bir tapşırıq konkret fəaliyyət feili ilə bitməlidir və ya başlamalıdır (məs: 'Hazırla', 'Təsdiqlə', 'Tərtib et', 'Başlat', 'Təşkil et').
2. Tapşırıqlar yığcam, konkret və dərhal icra edilə bilən şəkildə formalaşdırılmalıdır.
3. Dəqiq Zaman Çərçivəsi Uyğunluğu ('Bu gün', 'Növbəti 48 saat' və ya 'Bu həftə'):
   - 'Bu gün': YALNIZ ilk 24 saat ərzində başlanıb bitirilə bilən tək-tək tətikləyici addımlar (məs: 'Hüquq məsləhətçisinə rəsmi brifin göndərilməsi', 'Büdcə bölgüsü cədvəlinin qaralamasını aç'). '7 gün ərzində izləyin' kimi uzun proseslər 'Bu gün' başlığı altına qətiyyən salına bilməz.
   - 'Növbəti 48 saat': Cəmi 2 gün ərzində tamamlana bilən ilkin hazırlıqlar (məs: 'Müsahibə suallarını hazırla və ilk 3 namizədlə əlaqə qur', 'Pilot üçün 3 hazır set və qiymətləri dəqiqləşdir'). 20–30 nəfərlə canlı görüş/müsahibə kimi həftələrlə vaxt aparan tapşırıqlar 48 saata sıxışdırıla bilməz.
   - 'Bu həftə': Pilotun qurulması və ilk test sifarişlərinin qəbulu. Hələ baş tutmamış pilotun ikinci sifariş (retention) analizi və ya kohort izlənməsi bu həftəyə yazıla bilməz; kohort analizi növbəti mərhələlərə saxlanmalıdır.
4. Səbəb-Nəticə Ardıcıllığı: Əməliyyat baş vermədən onun analitik nəticəsi növbəti addım kimi tələb oluna bilməz.
5. Hər bir tapşırığın statusu 'todo' olmalıdır.
6. Cavab YALNIZ aşağıdakı struktura uyğun valid JSON formatında olmalıdır:
{
  "tasks": [
    {
      "title": "Konkret və icraya hazır tapşırıq mətni",
      "timeframe": "Bu gün",
      "status": "todo"
    }
  ]
}`;

  const userContent = isEn
    ? `Strategy: ${strategyTitle || "Business Strategy"}\n\nRaw Action Steps to optimize into planner tasks:\n${taskLines}`
    : `Strategiya: ${strategyTitle || "Biznes Strategiyası"}\n\nPlanner üçün optimallaşdırılmalı olan növbəti addımlar:\n${taskLines}`;

  signal?.throwIfAborted();
  let completion;
  try {
    completion = await openaiClient.chat.completions.create(
      {
        model: modelName,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userContent },
        ],
        response_format: { type: "json_object" },
      },
      signal ? { signal } : undefined,
    );
  } catch (error) {
    assertExecutionActive(error, signal);
    throw error;
  }

  if (typeof onUsage === "function" && completion.usage) {
    onUsage({
      provider: "openai",
      model: modelName,
      usage: {
        inputTokens: completion.usage.prompt_tokens,
        outputTokens: completion.usage.completion_tokens,
        totalTokens: completion.usage.total_tokens,
      },
    });
  }

  const rawContent = completion.choices?.[0]?.message?.content?.trim() || "{}";
  let parsed;
  try {
    parsed = extractJsonFromText(rawContent);
  } catch (jsonErr) {
    throw new LLMProviderError("Model etibarsız JSON cavabı qaytardı.", {
      code: "AI_INVALID_OUTPUT",
      status: 502,
      model: modelName,
      cause: jsonErr,
    });
  }

  const rawTasksList = Array.isArray(parsed.tasks)
    ? parsed.tasks
    : (Array.isArray(parsed) ? parsed : []);

  const validatedTasks = rawTasksList.map((t) => {
    const rawTitle = typeof t === "string" ? t : (t.title || t.text || "");
    const cleaned = String(rawTitle).replace(/^[\s\-*•\d.)\]]+/, "").trim();
    const isPriority = Boolean(t.isPriority);
    let tf = t.timeframe || t.groupLabel || (isEn ? "Today" : "Bu gün");

    // Align timeframe logic if multi-day task fell into Today
    const lowerText = cleaned.toLowerCase();
    const isToday = tf.toLowerCase().includes("bu gün") || tf.toLowerCase().includes("today");
    if (isToday && /(?:(?:növbəti\s*)?(?:7|yeddi|seven)\s*(?:gün|days?)|(?:həftə\s*(?:ərzində|boyunca)|throughout\s*the\s*week|over\s*(?:the\s*)?next\s*7\s*days|bir\s*həftə\s*ərzində))/i.test(lowerText)) {
      tf = isEn ? "This week" : "Bu həftə";
    }

    return {
      title: cleaned || rawTitle,
      timeframe: tf,
      status: "todo",
      isPriority,
      priority: t.priority || (isPriority ? "high" : "normal"),
    };
  }).filter((t) => Boolean(t.title));

  const resultTasks = validatedTasks.length > 0 ? validatedTasks : fallbackSummarizeTasks(tasks, language, modelName).tasks;

  const validatedOutput = PlannerTaskSummaryOutputSchema.parse({
    tasks: resultTasks,
    model: modelName,
  });

  return validatedOutput;
}

export function fallbackPrioritizeTasks(tasks = [], language = "az", model = "gpt-6-luna") {
  const priorityKeywords = [
    "təcili", "launch", "audit", "təsdiqlə", "başlat", "satış", "büdcə", "əlaqə", "müştəri", "kampaniya", "vacib",
    "urgent", "critical", "priority", "revenue", "contract", "financial", "pricing", "target", "roadmap", "immediate"
  ];

  const prioritizedIds = [];
  const prioritizedTitles = [];

  const validated = tasks.map((item, index) => {
    const rawId = item.id || null;
    const rawTitle = typeof item === "string" ? item : (item.title || item.text || "");
    const cleaned = String(rawTitle).replace(/^[\s\-*•\d.)\]]+/, "").trim() || rawTitle;
    const tf = (typeof item === "object" && (item.timeframe || item.groupLabel)) ? String(item.timeframe || item.groupLabel).toLowerCase() : "";
    const lowerTitle = cleaned.toLowerCase();

    const isImmediateTimeframe = tf.includes("bu gün") || tf.includes("today") || tf.includes("48");
    const hasPriorityKeyword = priorityKeywords.some((kw) => lowerTitle.includes(kw));

    const isPriority = item.isPriority === true || isImmediateTimeframe || hasPriorityKeyword || (tasks.length > 0 && index === 0);
    if (isPriority) {
      if (rawId) prioritizedIds.push(rawId);
      prioritizedTitles.push(cleaned);
    }

    return {
      ...(typeof item === "object" ? item : {}),
      id: rawId,
      title: cleaned,
      text: cleaned,
      isPriority,
      priority: isPriority ? "high" : "normal",
    };
  });

  return {
    tasks: validated,
    prioritizedTaskIds: prioritizedIds,
    priorityTaskTitles: prioritizedTitles,
    model,
  };
}

export async function prioritizeTasksWithLuna({
  tasks = [],
  language = "az",
  client = null,
  signal = null,
  onUsage = null,
}) {
  const isEn = language === "en";
  const modelName = aiConfig.plannerPriorityModel || aiConfig.plannerSummaryModel || "gpt-6-luna";

  if (!tasks.length) {
    return { tasks: [], prioritizedTaskIds: [], priorityTaskTitles: [], model: modelName };
  }

  if (!client && !hasOpenAIConfiguration()) {
    return fallbackPrioritizeTasks(tasks, language, modelName);
  }

  const openaiClient = client || getOpenAIClient();

  const taskLines = tasks
    .map((item, idx) => {
      const idStr = item.id ? `[ID: ${item.id}] ` : "";
      const tfStr = (item.timeframe || item.groupLabel) ? `[Müddət: ${item.timeframe || item.groupLabel}] ` : "";
      const text = item.title || item.text || (typeof item === "string" ? item : "");
      return `${idx + 1}. ${idStr}${tfStr}${text}`;
    })
    .join("\n");

  const systemPrompt = isEn
    ? `You are an elite strategic prioritization AI powered by gpt-6-luna.
Your role is to deeply evaluate the provided task list and isolate ONLY the highest-impact, time-critical, strategic, and revenue/growth-essential tasks as "PRIORITY".

STRICT RULES:
1. Filter out routine, administrative, or low-leverage tasks.
2. Select ONLY the top high-leverage tasks that drive immediate breakthrough, critical dependencies, or pivotal business milestones (typically top 20-40% of tasks).
3. Return ONLY a valid JSON object matching this structure:
{
  "prioritizedTaskIds": ["id1", "id2"],
  "priorityTaskTitles": ["Exact or closely matching task title 1"]
}`
    : `Sən gpt-6-luna tərəfindən gücləndirilmiş icra və strateji prioritetləşdirmə üzrə ixtisaslaşmış süni intellekt köməkçisisən.
Vəzifən istifadəçinin təqdim olunan tapşırıqlar siyahısını dərindən təhlil edib, yalnız ən yüksək təsirə malik (high-impact), vaxt baxımından kritik, strateji əhəmiyyətli və biznesin inkişafı üçün həlledici olan tapşırıqları "PRIORITY" (prioritet) olaraq ayırmaqdır.

CİDDİ TƏLƏBLƏR:
1. Rutin, xırda və ya ikinci dərəcəli tapşırıqları prioritet etmə.
2. Yalnız biznesin inkişafı, gəlir artımı, ilkin mərhələnin açarı və ya kritik asılılıq yaradan ən vacib tapşırıqları (ümumi sayın 20-40%-ni) prioritet seç.
3. Cavab YALNIZ aşağıdakı struktura uyğun valid JSON formatında olmalıdır:
{
  "prioritizedTaskIds": ["id1", "id2"],
  "priorityTaskTitles": ["Dəqiq və ya ən yaxın tapşırıq başlığı 1"]
}`;

  const userContent = isEn
    ? `Task list to prioritize:\n${taskLines}`
    : `Prioritetlərə ayrılmalı olan tapşırıqlar siyahısı:\n${taskLines}`;

  signal?.throwIfAborted();
  let completion;
  try {
    completion = await openaiClient.chat.completions.create(
      {
        model: modelName,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userContent },
        ],
        response_format: { type: "json_object" },
      },
      signal ? { signal } : undefined,
    );
  } catch (error) {
    assertExecutionActive(error, signal);
    throw error;
  }

  if (typeof onUsage === "function" && completion.usage) {
    onUsage({
      provider: "openai",
      model: modelName,
      usage: {
        inputTokens: completion.usage.prompt_tokens,
        outputTokens: completion.usage.completion_tokens,
        totalTokens: completion.usage.total_tokens,
      },
    });
  }

  const rawContent = completion.choices?.[0]?.message?.content?.trim() || "{}";
  let parsed;
  try {
    parsed = extractJsonFromText(rawContent);
  } catch (jsonErr) {
    throw new LLMProviderError("Model etibarsız JSON cavabı qaytardı.", {
      code: "AI_INVALID_OUTPUT",
      status: 502,
      model: modelName,
      cause: jsonErr,
    });
  }

  const prioritizedIds = new Set(Array.isArray(parsed.prioritizedTaskIds) ? parsed.prioritizedTaskIds : []);
  const prioritizedTitles = (Array.isArray(parsed.priorityTaskTitles) ? parsed.priorityTaskTitles : []).map((t) =>
    String(t).toLowerCase().trim()
  );

  const validatedTasks = tasks.map((item) => {
    const rawId = item.id || null;
    const rawText = item.title || item.text || (typeof item === "string" ? item : "");
    const lowerText = String(rawText).toLowerCase().trim();

    const matchesId = Boolean(rawId && prioritizedIds.has(rawId));
    const matchesTitle = prioritizedTitles.some((pt) => pt && (lowerText.includes(pt) || pt.includes(lowerText)));
    const isPriority = matchesId || matchesTitle;

    return {
      ...(typeof item === "object" ? item : {}),
      id: rawId,
      title: item.title || rawText,
      text: item.text || rawText,
      isPriority,
      priority: isPriority ? "high" : "normal",
    };
  });

  return {
    tasks: validatedTasks,
    prioritizedTaskIds: Array.from(prioritizedIds),
    priorityTaskTitles: prioritizedTitles,
    model: modelName,
  };
}
