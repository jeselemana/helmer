import { shouldEnableSearch } from "./search-router.js";

const DEEP_REASONING_HIGH_PATTERN = /(hərtərəfli dərin analiz|hərtərəfli analiz|hərtərəfli təhlil|geniş təhlil|rəqib analizi|swot analizi|swot matrisi|audit hesabatı|maliyyə modeli|tam marketinq planı|daha dərindən düşün|dərindən düşün|bütün detalları ilə|deep analysis|in-depth analysis|competitor analysis|financial model|marketing plan|think deeper)/i;

const MULTI_STEP_MODELING_MEDIUM_PATTERN = /(?:çoxmərhələli|maliyyə modelləşdir|büdcə bölgüsü|budget breakdown|cac\s*\/\s*ltv|unit economics|sensitivity|həssaslıq analizi|arxitektura auditi|sistem arxitekturası|proqnoz modeli|multi-step|cohort|dcf|npv|irr)/i;

export function isComplexAskQuery(lastUserMsg = "", hasStrategyContext = false) {
  if (hasStrategyContext) return true;
  const cleanMsg = String(lastUserMsg || "").trim();
  if (DEEP_REASONING_HIGH_PATTERN.test(cleanMsg)) return true;
  if (cleanMsg.length >= 600 && MULTI_STEP_MODELING_MEDIUM_PATTERN.test(cleanMsg)) return true;

  return false;
}

// Ask mode exclusively routes to Gemini 4 Hydrogen. GPT models and GPT fallbacks
// are completely eliminated from Ask.
export function resolveAskModelRoute() {
  return "gemini-4-hydrogen";
}

// Auto-routing for Gemini 4 Hydrogen thinking levels (low, medium, high, xhigh)
export function resolveAskThinkingLevel({ requestedThinkingLevel = "auto", lastUserMsg = "", hasStrategyContext = false } = {}) {
  const normalized = String(requestedThinkingLevel || "auto").toLowerCase().trim();
  if (["low", "medium", "high", "xhigh", "off"].includes(normalized)) {
    return normalized;
  }
  const cleanMsg = String(lastUserMsg || "").trim();
  if (isComplexAskQuery(cleanMsg, false)) {
    return "high";
  }
  if (
    MULTI_STEP_MODELING_MEDIUM_PATTERN.test(cleanMsg) ||
    (hasStrategyContext && /(?:strateg|plan|prioritet|qərar|icra|kpi|büdcə|risk|analiz|rəqib|təhlil|istiqamət|decision|metric|budget)/i.test(cleanMsg))
  ) {
    return "medium";
  }
  return "low";
}
