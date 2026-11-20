const DEEP_REASONING_HIGH_PATTERN = /(hərtərəfli dərin analiz|hərtərəfli analiz|hərtərəfli təhlil|geniş təhlil|rəqib analizi|swot analizi|swot matrisi|audit hesabatı|maliyyə modeli|tam marketinq planı|daha dərindən düşün|dərindən düşün|bütün detalları ilə|deep analysis|in-depth analysis|competitor analysis|financial model|marketing plan|think deeper)/i;

const MULTI_STEP_MODELING_MEDIUM_PATTERN = /(?:çoxmərhələli|maliyyə modelləşdir|büdcə bölgüsü|budget breakdown|cac\s*\/\s*ltv|unit economics|sensitivity|həssaslıq analizi|arxitektura auditi|sistem arxitekturası|proqnoz modeli|multi-step|cohort|dcf|npv|irr)/i;

export function isComplexAskQuery(lastUserMsg = "", hasStrategyContext = false) {
  if (hasStrategyContext) return true;
  const cleanMsg = String(lastUserMsg || "").trim();
  if (DEEP_REASONING_HIGH_PATTERN.test(cleanMsg)) return true;
  if (cleanMsg.length >= 600 && MULTI_STEP_MODELING_MEDIUM_PATTERN.test(cleanMsg)) return true;

  return false;
}

export const ASK_TERRA_MODEL = "gpt-6.1-terra";

export function resolveAskModelRoute() {
  return ASK_TERRA_MODEL;
}

export function resolveAskReasoningEffort(thinkingLevel) {
  if (thinkingLevel === "high") return "high";
  if (thinkingLevel === "medium") return "medium";
  return "none";
}

export function resolveAskThinkingLevel({ requestedThinkingLevel = "auto", lastUserMsg = "", hasStrategyContext = false, model } = {}) {
  const normalized = String(requestedThinkingLevel || "auto").toLowerCase().trim();
  if (["low", "medium", "high", "off"].includes(normalized)) {
    return normalized;
  }
  if (model === ASK_TERRA_MODEL) return "off";
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
