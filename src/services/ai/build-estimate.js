import { z } from "zod";

export const BuildEstimateRequestSchema = z.object({
  brief: z.string().trim().min(8).max(8000),
  buildMode: z.enum(["auto", "faster"]).optional(),
  fasterThinkingLevel: z.enum(["medium", "high"]).optional(),
}).strict();

// Estimates are display guidance, never execution deadlines. The classifier is
// Flash; the server owns the range and the requested conservative upper buffer.
export function preparationEstimateForRoute(route) {
  let minMinutes, baseMaxMinutes;
  if (route.argon_thinking_level === "Low") { minMinutes = 1; baseMaxMinutes = 2; }
  else if (route.argon_thinking_level === "High") { minMinutes = 4; baseMaxMinutes = 8; }
  else { minMinutes = 2; baseMaxMinutes = 4; }
  if (route.needs_search) { minMinutes += 1; baseMaxMinutes += 2; }
  const bufferMinutes = route.argon_thinking_level === "Low" ? 2 : 3;
  return Object.freeze({ minMinutes, maxMinutes: baseMaxMinutes + bufferMinutes, bufferMinutes });
}

export function preparationEstimateForFaster({ fasterThinkingLevel = "medium", needs_search = false } = {}) {
  const isHigh = String(fasterThinkingLevel || "medium").toLowerCase() === "high";
  let minMinutes = isHigh ? 2 : 1;
  let baseMaxMinutes = isHigh ? 3 : 2;
  if (needs_search) {
    minMinutes += 1;
    baseMaxMinutes += 1;
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
