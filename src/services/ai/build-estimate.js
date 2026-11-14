import { z } from "zod";
import { resolveEffectiveModelPricing } from "../security/ai-policy.js";

export const BuildEstimateRequestSchema = z.object({
  brief: z.string().trim().min(8).max(8000),
  buildMode: z.enum(["auto", "faster"]).optional(),
  fasterThinkingLevel: z.enum(["medium", "high"]).optional(),
}).strict();

// Web-verified Build rate snapshot (USD per 1M tokens / search query):
// - gemini-4-hydrogen: $1.50 input / $7.50 output / $0.075 cache read (fast workhorse latency)
// - gemini-4-carbon:   $2.00 input / $10.00 output intro through Nov 30, 2026; $4.00/$20.00 standard from Dec 1, 2026 (60-140s+ TTFT)
// - gemini-decision-1: $0.10 input / $0.00 output (single-pass classification)
export function estimateBuildCostUsd({
  targetModel = "gemini-4-hydrogen",
  estimatedInputTokens = 4000,
  estimatedOutputTokens = 8000,
  needsSearch = false,
  env = process.env,
} = {}) {
  const pricing = resolveEffectiveModelPricing(targetModel, env) || { input: 1.50, output: 7.50, search: 0.014 };
  const inTok = Math.max(0, Number(estimatedInputTokens) || 0);
  const outTok = Math.max(0, Number(estimatedOutputTokens) || 0);
  const searchFee = needsSearch ? Number(pricing.search ?? 0.014) : 0;
  return Number(((inTok * pricing.input + outTok * pricing.output) / 1_000_000 + searchFee).toFixed(6));
}

// Estimates are display guidance, never execution deadlines.
// Reflects web-verified latency profiles: Hydrogen (fast workhorse across low/medium/high/xhigh)
// vs Carbon (60-140s+ TTFT heavy internal reasoning cycles across low/medium/high).
export function preparationEstimateForRoute(route = {}) {
  const targetModel = String(route?.target_model || route?.targetModel || "gemini-4-hydrogen").toLowerCase();
  const level = String(route?.thinking_level || route?.thinkingLevel || "medium").toLowerCase();
  let minMinutes, baseMaxMinutes, bufferMinutes;

  if (targetModel === "gemini-4-carbon") {
    if (level === "low") {
      minMinutes = 3;
      baseMaxMinutes = 5;
      bufferMinutes = 2;
    } else if (level === "high") {
      minMinutes = 6;
      baseMaxMinutes = 11;
      bufferMinutes = 3;
    } else {
      minMinutes = 4;
      baseMaxMinutes = 8;
      bufferMinutes = 3;
    }
  } else {
    if (level === "low") {
      minMinutes = 1;
      baseMaxMinutes = 2;
      bufferMinutes = 1;
    } else if (level === "high") {
      minMinutes = 3;
      baseMaxMinutes = 5;
      bufferMinutes = 2;
    } else if (level === "xhigh") {
      minMinutes = 4;
      baseMaxMinutes = 7;
      bufferMinutes = 3;
    } else {
      minMinutes = 2;
      baseMaxMinutes = 3;
      bufferMinutes = 2;
    }
  }

  if (route?.needs_search) {
    minMinutes += 1;
    baseMaxMinutes += 2;
  }
  return Object.freeze({ minMinutes, maxMinutes: baseMaxMinutes + bufferMinutes, bufferMinutes });
}

export function preparationEstimateForFaster({ fasterThinkingLevel = "medium", needs_search = false } = {}) {
  const isHigh = String(fasterThinkingLevel || "medium").toLowerCase() === "high";
  let minMinutes = isHigh ? 2 : 1;
  let baseMaxMinutes = isHigh ? 3 : 2;
  if (needs_search) {
    minMinutes += 1;
    baseMaxMinutes += isHigh ? 2 : 1;
  }
  const bufferMinutes = isHigh ? 2 : 1;
  return Object.freeze({ minMinutes, maxMinutes: baseMaxMinutes + bufferMinutes, bufferMinutes });
}

export function buildRoutingInput({ brief, answers = [], assumptions = [], buildMode, fasterThinkingLevel }) {
  const payload = { brief: brief.trim(), answers, assumptions };
  if (buildMode === "faster") {
    payload.buildMode = "faster";
    payload.fasterThinkingLevel = fasterThinkingLevel === "high" ? "high" : "medium";
  }
  return JSON.stringify(payload);
}
