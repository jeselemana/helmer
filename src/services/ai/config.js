import fs from "node:fs";

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export const aiConfig = Object.freeze({
  upModel: "gpt-6-luna",
  upMaxOutputTokens: 3000,
  // Legacy shared structured/artifact router. Build uses build-config.js exclusively.
  strategyModel: "gemini-3.8-flash",
  strategyFallbackModel: "gpt-6.1-sol",
  strategyThinkingLevel: "HIGH",
  enableBuildSearchGrounding: process.env.ENABLE_BUILD_SEARCH_GROUNDING !== "false",
  askModel: process.env.OPENAI_ASK_MODEL || "gpt-5.6-luna",
  askComplexModel: process.env.OPENAI_ASK_COMPLEX_MODEL || "gpt-5.6-terra",
  askGeminiModel: "gemini-4-hydrogen",
  geminiMaxOutputTokens: positiveInteger(process.env.GEMINI_MAX_OUTPUT_TOKENS, 65536),
  askMaxOutputTokens: positiveInteger(process.env.ASK_MAX_OUTPUT_TOKENS, 8192),
  askSearchTimeoutMs: positiveInteger(process.env.ASK_SEARCH_TIMEOUT_MS, 18000),
  maxClarificationRounds: Number.parseInt(process.env.MAX_CLARIFICATION_ROUNDS || "2", 10),
  assessmentMaxOutputTokens: 6144,
  strategyMaxOutputTokens: 24576,
  refinementMaxOutputTokens: 24576,
  strategySummaryModel: process.env.OPENAI_STRATEGY_SUMMARY_MODEL || "gpt-5.6-luna",
  plannerSummaryModel: process.env.OPENAI_PLANNER_SUMMARY_MODEL || "gpt-6-luna",
  plannerPriorityModel: process.env.OPENAI_PLANNER_PRIORITY_MODEL || "gpt-6-luna",
});

export function hasOpenAIConfiguration() {
  return Boolean(process.env.OPENAI_API_KEY?.trim());
}

export function hasGeminiConfiguration() {
  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim();
  const hasValidCredFile = Boolean(credPath && fs.existsSync(credPath));
  return Boolean(process.env.GEMINI_API_KEY?.trim()) ||
    hasValidCredFile ||
    (process.env.GEMINI_USE_VERTEX === "true" &&
      Boolean(process.env.GOOGLE_CLOUD_PROJECT?.trim() || process.env.GCP_PROJECT?.trim()));
}
