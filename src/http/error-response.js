// Shared rules for turning thrown errors into public JSON responses.

export function httpStatusOf(error, fallback = 500) {
  const status = Number(error?.status ?? error?.statusCode);
  return Number.isInteger(status) && status >= 400 && status < 600 ? status : fallback;
}

// 4xx messages and LLMProviderError messages are written for end users. Any
// other server-side failure may carry file paths, SDK internals or storage
// details, so it is replaced with the caller's generic fallback.
export function publicErrorMessage(error, fallback) {
  if (!error?.message) return fallback;
  if (error instanceof SyntaxError || error?.type === "entity.parse.failed" || error?.name === "SyntaxError") {
    return "Sorğu formatı yanlışdır (JSON sintaksis xətası).";
  }
  if (error?.type === "entity.too.large") {
    return "Sorğu həcmi icazə verilən limitdən böyükdür.";
  }
  if (error.expose === true) return error.message;
  return httpStatusOf(error) < 500 ? error.message : fallback;
}
