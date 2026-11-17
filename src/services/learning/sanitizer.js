const RULES = Object.freeze([
  { type: "email", pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, replacement: "[REDACTED_EMAIL]" },
  { type: "phone", pattern: /(?<!\w)(?:\+?\d{1,3}[\s.-]?)?(?:\(?\d{2,4}\)?[\s.-]?)?\d{3}[\s.-]?\d{2}[\s.-]?\d{2,4}(?!\w)/g, replacement: "[REDACTED_PHONE]" },
  { type: "bearer_token", pattern: /\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, replacement: "Bearer [REDACTED_TOKEN]" },
  { type: "openai_key", pattern: /\bsk-[A-Za-z0-9_-]{16,}\b/g, replacement: "[REDACTED_API_KEY]" },
  { type: "api_key", pattern: /\b(?:api[_-]?key|access[_-]?token|auth(?:orization)?[_-]?token|secret[_-]?key)\s*[:=]\s*["']?[^\s,"']{8,}["']?/gi, replacement: "[REDACTED_SECRET]" },
  { type: "credential", pattern: /\b(?:password|passwd|pwd|parol|şifrə)\s*[:=]\s*["']?[^\s,"']{4,}["']?/gi, replacement: "[REDACTED_CREDENTIAL]" },
  { type: "payment_card", pattern: /\b(?:\d[ -]*?){13,19}\b/g, replacement: "[REDACTED_PAYMENT_CARD]" },
  { type: "azerbaijan_fin", pattern: /\b(?:FİN|FIN)\s*(?:kod(?:u)?\s*)?[:=]?\s*[A-Z0-9]{7}\b/gi, replacement: "[REDACTED_PERSONAL_ID]" },
]);

export function sanitizeTrainingText(value) {
  let text = typeof value === "string" ? value : JSON.stringify(value ?? "");
  const detections = [];
  for (const rule of RULES) {
    let count = 0;
    text = text.replace(rule.pattern, () => {
      count += 1;
      return rule.replacement;
    });
    if (count) detections.push({ type: rule.type, count });
  }
  return {
    text,
    containsSensitiveData: detections.length > 0,
    status: detections.length ? "redacted" : "clean",
    detections,
  };
}

export function sanitizeRelevantContext(context) {
  if (!context || typeof context !== "object") return {};
  const allowlist = ["strategyId", "briefId", "taskId", "chatId", "hasStrategyContext", "hasBriefContext", "hasTaskContext", "personalizationApplied", "resourceId"];
  return Object.fromEntries(allowlist.filter((key) => context[key] !== undefined).map((key) => [key, context[key]]));
}
