import { z } from "zod";

const shortText = z.string().trim().min(1).max(300);
const paragraph = z.string().trim().min(1).max(3000);
const longText = z.string().trim().min(1).max(12000);

export const strategyStatuses = [
  "draft",
  "analyzing",
  "needs_clarification",
  "generating",
  "ready",
  "refining",
  "saved",
  "error",
];

export const refinementActions = [
  "shorten",
  "localize_azerbaijan",
  "think_deeper",
  "make_practical",
  "budget_optimize",
  "custom",
];

export const ClarificationQuestionSchema = z.object({
  id: z.string().trim().min(1).max(80),
  question: shortText,
  reason: z.string().trim().max(800),
  inputType: z.enum(["text", "single_choice", "multi_choice"]),
  options: z.array(z.string().trim().min(1).max(200)).max(8),
}).strict();

export const StrategyAssessmentSchema = z.object({
  status: z.enum(["needs_clarification", "ready"]),
  understanding: paragraph,
  questions: z.array(ClarificationQuestionSchema).max(5),
  assumptions: z.array(paragraph).max(12),
}).strict();

export const StrategySchema = z.object({
  title: shortText,
  summary: longText,
  context: z.object({
    business: paragraph,
    objective: paragraph,
    market: paragraph,
    targetAudience: paragraph,
  }).strict(),
  sections: z
    .array(
      z.object({
        id: z.string().trim().min(1).max(80),
        title: shortText,
        summary: z.string().trim().max(800),
        content: longText,
        bullets: z.array(paragraph).max(12),
      }).strict(),
    )
    .min(3)
    .max(12),
  priorities: z
    .array(
      z.object({
        title: shortText,
        description: paragraph,
        priority: z.enum(["high", "medium", "low"]),
      }).strict(),
    )
    .min(1)
    .max(10),
  actionPlan: z
    .array(
      z.object({
        phase: shortText,
        actions: z.array(paragraph).min(1).max(10),
        expectedOutcome: z.string().trim().max(800),
      }).strict(),
    )
    .min(1)
    .max(10),
  kpis: z
    .array(
      z.object({
        name: shortText,
        reason: paragraph,
        target: z.string().trim().max(300),
      }).strict(),
    )
    .min(1)
    .max(12),
  risks: z
    .array(
      z.object({
        risk: paragraph,
        mitigation: paragraph,
      }).strict(),
    )
    .max(10),
  assumptions: z.array(paragraph).max(12),
  nextSteps: z.array(paragraph).min(1).max(12),
  orchestration: z
    .object({
      models: z.array(z.string().trim().max(100)).max(10).nullable().optional(),
      searchGrounded: z.boolean().nullable().optional(),
      sources: z.array(z.object({
        title: z.string().max(200).nullable().optional(),
        url: z.string().refine((u) => {
          try {
            const p = new URL(u).protocol;
            return p === "http:" || p === "https:";
          } catch {
            return false;
          }
        }, "URL must be http or https"),
      }).strict()).max(20).nullable().optional(),
      searchQueries: z.array(z.string().trim().max(160)).max(10).nullable().optional(),
      searchEntryPoint: z.object({
        renderedContent: z.string().max(50000).nullable().optional(),
      }).strict().nullable().optional(),
      buildMode: z.enum(["auto", "faster"]).nullable().optional(),
      generatorModel: z.string().trim().max(100).nullable().optional(),
      thinkingLevel: z.string().trim().max(32).nullable().optional(),
      fasterThinkingLevel: z.enum(["medium", "high"]).nullable().optional(),
      stageMetrics: z.array(z.object({
        phase: z.string().trim().max(64),
        model: z.string().trim().max(100),
        thinkingLevel: z.string().trim().max(32).nullable().optional(),
        latencyMs: z.number().nonnegative(),
        firstChunkMs: z.number().nonnegative().nullable().optional(),
        prompt_tokens: z.number().nonnegative().nullable().optional(),
        visible_output_tokens: z.number().nonnegative().nullable().optional(),
        thoughts_tokens: z.number().nonnegative().nullable().optional(),
        completion_tokens: z.number().nonnegative().nullable().optional(),
        total_tokens: z.number().nonnegative().nullable().optional(),
        usageStatus: z.enum(["measured", "unavailable"]).nullable().optional(),
        estimatedUsdMicros: z.number().nonnegative().nullable().optional(),
        groundingActive: z.boolean().nullable().optional(),
        verifiedSourcesCount: z.number().int().nonnegative().nullable().optional(),
        attempt: z.number().int().positive().nullable().optional(),
        location: z.string().trim().max(64).nullable().optional(),
        fallbackUsed: z.boolean().nullable().optional(),
      }).strict()).max(16).nullable().optional(),
    })
    .strict()
    .nullable()
    .optional(),
}).strict();

export const ClarificationAnswerSchema = z.object({
  questionId: z.string().trim().min(1).max(80),
  question: paragraph,
  answer: z.string().trim().min(1).max(1500),
}).strict();

export const AssessRequestSchema = z.object({
  brief: z.string().trim().min(8).max(8000),
  answers: z.array(ClarificationAnswerSchema).max(10).default([]),
  round: z.number().int().min(0).max(2).default(0),
  language: z.enum(["az", "en"]).optional(),
  buildMode: z.enum(["auto", "faster"]).optional(),
  fasterThinkingLevel: z.enum(["medium", "high"]).optional(),
}).strict();

export const GenerateRequestSchema = z.object({
  brief: z.string().trim().min(8).max(8000),
  answers: z.array(ClarificationAnswerSchema).max(10).default([]),
  assumptions: z.array(paragraph).max(12).default([]),
  idempotencyKey: z.string().trim().min(8).max(120),
  language: z.enum(["az", "en"]).optional(),
  autoSave: z.boolean().optional().default(true),
  buildMode: z.enum(["auto", "faster"]).optional(),
  fasterThinkingLevel: z.enum(["medium", "high"]).optional(),
}).strict();

export const RefineRequestSchema = z
  .object({
    brief: z.string().trim().min(8).max(8000),
    answers: z.array(ClarificationAnswerSchema).max(10).default([]),
    strategy: StrategySchema,
    action: z.enum(refinementActions),
    request: z.string().trim().max(2000).default(""),
    language: z.enum(["az", "en"]).optional(),
    idempotencyKey: z.string().trim().max(120).optional(),
    buildMode: z.enum(["auto", "faster"]).optional(),
    fasterThinkingLevel: z.enum(["medium", "high"]).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.action === "custom" && value.request.length < 3) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["request"],
        message: "Dəyişiklik istəyini yaz.",
      });
    }
  });

export const SaveStrategyRequestSchema = z.object({
  clientSaveId: z.string().trim().min(8).max(120),
  brief: z.string().trim().min(8).max(8000),
  answers: z.array(ClarificationAnswerSchema).max(10).default([]),
  acceptForLearning: z.boolean().optional().default(false),
  strategy: StrategySchema,
  versions: z
    .array(
      z.object({
        versionNumber: z.number().int().min(1).max(100),
        data: StrategySchema,
        changeRequest: z.string().trim().max(2000),
        createdAt: z.string().datetime(),
      }).strict(),
    )
    .min(1)
    .max(100),
}).strict();

export const UpdateStrategyTitleSchema = z.object({
  title: z.string().trim().min(1, "Strategiya adı boş ola bilməz.").max(300),
}).strict();

export const StrategyFeedbackSchema = z.object({
  strategyId: z.string().trim().regex(/^[0-9a-f-]{36}$/i).nullable().optional(),
  feedback: z.enum(["like", "dislike"]).nullable(),
  brief: z.string().trim().max(3000).optional(),
  title: z.string().trim().max(300).optional(),
}).strict();

export const StrategySummaryRequestSchema = z
  .object({
    strategy: StrategySchema.optional(),
    strategyId: z.string().trim().regex(/^[0-9a-f-]{36}$/i).optional(),
    language: z.enum(["az", "en"]).optional(),
  })
  .strict()
  .refine((data) => Boolean(data.strategy || data.strategyId), {
    message: "Strategiya məlumatı və ya ID-si tələb olunur.",
  });

export const StrategySummaryOutputSchema = z
  .object({
    title: z.string().trim().default("Strategiya Xülasəsi"),
    objective: z.string().trim().default(""),
    keyMoves: z.array(z.string().trim()).default([]),
    execution: z.string().trim().default(""),
    kpisAndBudget: z.string().trim().default(""),
    takeaway: z.string().trim().default(""),
    summary: z.string().trim().default(""),
  })
  .strict();

export const PlannerTaskSummaryItemSchema = z
  .object({
    title: z.string().trim().min(1).max(500),
    timeframe: z.string().trim().min(1).max(100).default("Today"),
    status: z.enum(["todo", "in_progress", "completed"]).default("todo"),
    isPriority: z.boolean().optional(),
    priority: z.enum(["high", "medium", "low", "priority", "normal"]).optional(),
  })
  .strict();

export const PlannerTaskSummaryOutputSchema = z
  .object({
    tasks: z.array(PlannerTaskSummaryItemSchema).min(1),
    model: z.string().optional(),
  })
  .strict();

export const PlannerTaskPriorityOutputSchema = z
  .object({
    prioritizedTaskIds: z.array(z.string()).default([]),
    priorityTaskTitles: z.array(z.string()).default([]),
    model: z.string().default("gpt-6-luna"),
  })
  .strict();

export function serializeStrategyContext(strategy) {
  if (!strategy) return "";
  const parts = [];
  if (strategy.title) parts.push(`TITLE: ${strategy.title}`);
  if (strategy.summary) parts.push(`EXECUTIVE OVERVIEW:\n${strategy.summary}`);
  if (strategy.context) {
    const { business, objective, market, targetAudience } = strategy.context;
    parts.push(`CONTEXT:\n- Business: ${business || ""}\n- Objective: ${objective || ""}\n- Market: ${market || ""}\n- Target Audience: ${targetAudience || ""}`);
  }
  if (strategy.priorities?.length) {
    parts.push(`STRATEGIC PRIORITIES:\n` + strategy.priorities.map((p) => `- [${(p.priority || "PRIORITY").toUpperCase()}] ${p.title}: ${p.description}`).join("\n"));
  }
  if (strategy.sections?.length) {
    parts.push(`SECTIONS:\n` + strategy.sections.map((s) => `### ${s.title}\n${s.summary || ""}\n${s.content || ""}\n${s.bullets?.length ? s.bullets.map((b) => `* ${b}`).join("\n") : ""}`).join("\n\n"));
  }
  if (strategy.actionPlan?.length) {
    parts.push(`ACTION PLAN:\n` + strategy.actionPlan.map((a) => `Phase: ${a.phase}\nActions:\n${(a.actions || []).map((act) => `* ${act}`).join("\n")}\nExpected Outcome: ${a.expectedOutcome}`).join("\n\n"));
  }
  if (strategy.kpis?.length) {
    parts.push(`KPIS:\n` + strategy.kpis.map((k) => `- ${k.name} (Target: ${k.target}): ${k.reason}`).join("\n"));
  }
  if (strategy.risks?.length) {
    parts.push(`RISKS & MITIGATIONS:\n` + strategy.risks.map((r) => `- Risk: ${r.risk}\n  Mitigation: ${r.mitigation}`).join("\n"));
  }
  if (strategy.nextSteps?.length) {
    parts.push(`NEXT STEPS:\n` + strategy.nextSteps.map((n) => `- ${n}`).join("\n"));
  }
  return parts.join("\n\n");
}

export function validateAssessment(value) {
  const assessment = StrategyAssessmentSchema.parse(value);

  if (assessment.status === "needs_clarification" && assessment.questions.length === 0) {
    throw new Error("Clarification assessment did not include any questions.");
  }

  if (assessment.status === "ready") {
    return { ...assessment, questions: [] };
  }

  return { ...assessment, assumptions: [] };
}

const signalMatchers = {
  business: /(?:^|[^\p{L}\p{N}])(restoran\p{L}*|restaurant\p{L}*|cafe\p{L}*|kafe\p{L}*|brand\p{L}*|brend\p{L}*|saas|fintech|app\p{L}*|tətbiq\p{L}*|məhsul\p{L}*|product\p{L}*|xidmət\p{L}*|service\p{L}*|e-?commerce|mağaza\p{L}*|shop\p{L}*|şirkət\p{L}*|company|platforma\p{L}*|platform\p{L}*)(?:$|[^\p{L}\p{N}])/iu,
  objective: /(?:^|[^\p{L}\p{N}])(artır\p{L}*|artım\p{L}*|increase\p{L}*|launch\p{L}*|satış\p{L}*|sales|growth|böyü\p{L}*|repeat|təkrar|lead\p{L}*|conversion\p{L}*|konversiya\p{L}*|awareness|tanınma\p{L}*|qazan\p{L}*|icra\s+strategiya\p{L}*)(?:$|[^\p{L}\p{N}])/iu,
  audience: /(?:^|[^\p{L}\p{N}])(auditoriya\p{L}*|target|müştəri\p{L}*|customer\p{L}*|müəssisə\p{L}*|korporativ\p{L}*|enterprise\p{L}*|women|men|qadın\p{L}*|kişi\p{L}*|yaş\p{L}*|aged|b2b|b2c|student\p{L}*|tələbə\p{L}*|seqment\p{L}*)(?:$|[^\p{L}\p{N}])/iu,
  market: /(?:^|[^\p{L}\p{N}])(bakı\p{L}*|baku\p{L}*|azərbaycan\p{L}*|azerbaijan\p{L}*|market\p{L}*|bazar\p{L}*|region\p{L}*|badamdar\p{L}*|sumqayıt\p{L}*|gəncə\p{L}*)(?:$|[^\p{L}\p{N}])/iu,
  timeline: /(?:^|[^\p{L}\p{N}])(gün\p{L}*|days?|weeks?|həftə\p{L}*|months?|ay\p{L}*|quarter\p{L}*|rüb\p{L}*|20\d{2})(?:$|[^\p{L}\p{N}])/iu,
  budget: /(?:^|[^\p{L}\p{N}])(azn|manat\p{L}*|budget\p{L}*|büdcə\p{L}*|usd|eur)(?:$|[^\p{L}\p{N}])|[₼$€]/iu,
};

export function analyzeBriefSignals(brief) {
  const signals = Object.fromEntries(
    Object.entries(signalMatchers).map(([name, matcher]) => [name, matcher.test(brief)]),
  );
  const score = Object.values(signals).filter(Boolean).length;
  return {
    signals,
    score,
    likelyComplete: score >= 5 && signals.business && signals.objective && signals.audience,
    missing: Object.entries(signals)
      .filter(([, found]) => !found)
      .map(([name]) => name),
  };
}

const explicitNoQuestionsPattern = /(əlavə\s+sual\s+verm[əe]\S*|sual\s+verm[əe]\S*|suallarsız|birbaşa\s+strategiyanı\s+hazırla|birbaşa\s+generasiya|\bdo\s+not\s+ask\s+(?:any\s+)?(?:clarifying\s+)?questions\b|\bno\s+clarifying\s+questions\b|\bskip\s+questions\b|\bproceed\s+directly\b)/iu;
const unresolvedPlaceholderPattern = /\b(tbd|todo|naməlum|hələ\s+bilinmir|qərarlaşdırılmayıb)\b|\?\?\?/i;
const executionScopePattern = /(?:^|[^\p{L}\p{N}])(kpi\p{L}*|cac|ltv|mrr|arr|arpu|arpa|marja\p{L}*|margin\p{L}*|roi|kanal\p{L}*|channel\p{L}*|mərhələ\p{L}*|phase\p{L}*|struktur\p{L}*|arxitektura\p{L}*|architecture|komanda\p{L}*|team|qiymət\p{L}*|pricing|paket\p{L}*|tier\p{L}*|konversiya\p{L}*|conversion|məhdudiyyət\p{L}*|constraint\p{L}*|risk\p{L}*|hədəf\p{L}*|target\p{L}*|unit\s+ekonomika\p{L}*|unit\s+economics)(?:$|[^\p{L}\p{N}])/iu;

export function evaluateBriefSufficiency(brief, { round = 0, answers = [] } = {}) {
  const text = String(brief || "").trim();
  if (!text) {
    return { sufficient: false, reason: "empty_brief", signals: null };
  }
  const signalAnalysis = analyzeBriefSignals(text);
  if (round >= 2 || (Array.isArray(answers) && answers.length > 0 && round >= 1)) {
    return { sufficient: true, reason: "clarification_round_completed", signals: signalAnalysis };
  }
  if (explicitNoQuestionsPattern.test(text) && signalAnalysis.signals.business && signalAnalysis.signals.objective) {
    return { sufficient: true, reason: "explicit_no_questions_directive", signals: signalAnalysis };
  }
  const hasCoreDimensions =
    signalAnalysis.signals.business &&
    signalAnalysis.signals.objective &&
    signalAnalysis.signals.audience &&
    signalAnalysis.signals.market &&
    (signalAnalysis.signals.timeline || signalAnalysis.signals.budget);
  const hasScopeAndConstraints = executionScopePattern.test(text);
  const hasUnresolvedPlaceholders = unresolvedPlaceholderPattern.test(text);
  const wordCount = text.split(/\s+/).filter(Boolean).length;

  if (
    signalAnalysis.score >= 5 &&
    hasCoreDimensions &&
    hasScopeAndConstraints &&
    !hasUnresolvedPlaceholders &&
    wordCount >= 35
  ) {
    return { sufficient: true, reason: "multi_dimensional_semantic_sufficiency", signals: signalAnalysis };
  }

  return { sufficient: false, reason: "needs_assessment", signals: signalAnalysis };
}

const INLINE_GROUNDING_REDIRECT_REGEX = /\s*\(?https?:\/\/vertexaisearch\.cloud\.google\.com\/grounding-api-redirect\/[^\s)"'\]]+\)?/gi;

function cleanRedirectString(str) {
  if (typeof str !== "string" || !str.includes("vertexaisearch.cloud.google.com/grounding-api-redirect/")) {
    return str;
  }
  return str.replace(INLINE_GROUNDING_REDIRECT_REGEX, "").replace(/\s{2,}/g, " ").trim();
}

export function stripInlineGroundingRedirectUrls(strategy) {
  if (!strategy || typeof strategy !== "object") return strategy;
  return {
    ...strategy,
    title: cleanRedirectString(strategy.title),
    summary: cleanRedirectString(strategy.summary),
    context: strategy.context
      ? {
          business: cleanRedirectString(strategy.context.business),
          objective: cleanRedirectString(strategy.context.objective),
          market: cleanRedirectString(strategy.context.market),
          targetAudience: cleanRedirectString(strategy.context.targetAudience),
        }
      : strategy.context,
    sections: Array.isArray(strategy.sections)
      ? strategy.sections.map((s) => ({
          ...s,
          title: cleanRedirectString(s.title),
          summary: cleanRedirectString(s.summary),
          content: cleanRedirectString(s.content),
          bullets: Array.isArray(s.bullets) ? s.bullets.map(cleanRedirectString) : s.bullets,
        }))
      : strategy.sections,
    priorities: Array.isArray(strategy.priorities)
      ? strategy.priorities.map((p) => ({
          ...p,
          title: cleanRedirectString(p.title),
          description: cleanRedirectString(p.description),
        }))
      : strategy.priorities,
    actionPlan: Array.isArray(strategy.actionPlan)
      ? strategy.actionPlan.map((a) => ({
          ...a,
          phase: cleanRedirectString(a.phase),
          actions: Array.isArray(a.actions) ? a.actions.map(cleanRedirectString) : a.actions,
          expectedOutcome: cleanRedirectString(a.expectedOutcome),
        }))
      : strategy.actionPlan,
    kpis: Array.isArray(strategy.kpis)
      ? strategy.kpis.map((k) => ({
          ...k,
          name: cleanRedirectString(k.name),
          reason: cleanRedirectString(k.reason),
          target: cleanRedirectString(k.target),
        }))
      : strategy.kpis,
    risks: Array.isArray(strategy.risks)
      ? strategy.risks.map((r) => ({
          ...r,
          risk: cleanRedirectString(r.risk),
          mitigation: cleanRedirectString(r.mitigation),
        }))
      : strategy.risks,
    assumptions: Array.isArray(strategy.assumptions)
      ? strategy.assumptions.map(cleanRedirectString)
      : strategy.assumptions,
    nextSteps: Array.isArray(strategy.nextSteps)
      ? strategy.nextSteps.map(cleanRedirectString)
      : strategy.nextSteps,
  };
}

export function formatValidationError(error) {
  if (!(error instanceof z.ZodError)) return null;
  return error.issues.map((issue) => ({
    field: issue.path.join(".") || "request",
    message: issue.message,
  }));
}
