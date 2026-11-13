function numberFromEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
}

function price(model, inputEnv, outputEnv) {
  const inputPerMillion = numberFromEnv(inputEnv, 0);
  const outputPerMillion = numberFromEnv(outputEnv, 0);
  return Object.freeze({ model, inputPerMillion, outputPerMillion });
}

export const learningConfig = Object.freeze({
  candidateThreshold: numberFromEnv("AI_LEARNING_CANDIDATE_THRESHOLD", 0.75),
  maxPromptChars: numberFromEnv("AI_LEARNING_MAX_PROMPT_CHARS", 20_000),
  maxResponseChars: numberFromEnv("AI_LEARNING_MAX_RESPONSE_CHARS", 80_000),
  weights: Object.freeze({
    baseline: numberFromEnv("AI_QUALITY_BASELINE", 0.5),
    explicitPositive: numberFromEnv("AI_QUALITY_EXPLICIT_POSITIVE", 0.5),
    explicitNegative: numberFromEnv("AI_QUALITY_EXPLICIT_NEGATIVE", -0.65),
    accepted: numberFromEnv("AI_QUALITY_ACCEPTED", 0.3),
    copied: numberFromEnv("AI_QUALITY_COPIED", 0.12),
    successfulFinalIteration: numberFromEnv("AI_QUALITY_FINAL_ITERATION", 0.22),
    regenerated: numberFromEnv("AI_QUALITY_REGENERATED", -0.25),
    edited: numberFromEnv("AI_QUALITY_EDITED", -0.12),
    correction: numberFromEnv("AI_QUALITY_CORRECTION", -0.08),
  }),
  pricing: Object.freeze([
    price(process.env.OPENAI_ASK_MODEL || "gpt-5.6-luna", "OPENAI_LUNA_INPUT_USD_PER_1M", "OPENAI_LUNA_OUTPUT_USD_PER_1M"),
    price(process.env.OPENAI_ASK_COMPLEX_MODEL || "gpt-5.6-terra", "OPENAI_TERRA_INPUT_USD_PER_1M", "OPENAI_TERRA_OUTPUT_USD_PER_1M"),
    price("gemini-4-hydrogen", "GEMINI_HYDROGEN_INPUT_USD_PER_1M", "GEMINI_HYDROGEN_OUTPUT_USD_PER_1M"),
    price("gemini-3.8-flash", "GEMINI_FLASH_INPUT_USD_PER_1M", "GEMINI_FLASH_OUTPUT_USD_PER_1M"),
  ]),
});

export function pricingFor(model, pricing = learningConfig.pricing) {
  return pricing.find((item) => item.model === model) || null;
}

export function estimateCost(model, inputTokens, outputTokens, pricingTable = learningConfig.pricing) {
  const pricing = pricingFor(model, pricingTable);
  if (!pricing || (!pricing.inputPerMillion && !pricing.outputPerMillion)) {
    return { estimatedCost: null, pricingSnapshot: pricing };
  }
  const input = Number.isFinite(Number(inputTokens)) ? Number(inputTokens) : 0;
  const output = Number.isFinite(Number(outputTokens)) ? Number(outputTokens) : 0;
  const estimatedCost = (input / 1_000_000) * pricing.inputPerMillion
    + (output / 1_000_000) * pricing.outputPerMillion;
  return { estimatedCost: Number(estimatedCost.toFixed(8)), pricingSnapshot: pricing };
}
