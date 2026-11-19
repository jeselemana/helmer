// Shared rules for turning thrown errors into public JSON responses.

export function httpStatusOf(error, fallback = 500) {
  const status = Number(error?.status ?? error?.statusCode);
  return Number.isInteger(status) && status >= 400 && status < 600 ? status : fallback;
}

// 4xx messages and LLMProviderError messages are written for end users. Any
// other server-side failure may carry file paths, SDK internals or storage
// details, so it is replaced with the caller's generic fallback.
function looksLikeInternalOrThirdPartyError(error) {
  if (!error || typeof error !== "object") return false;
  if (
    error.$metadata !== undefined ||
    error.headers !== undefined ||
    error.request_id !== undefined ||
    error.response !== undefined ||
    error.errorDetails !== undefined ||
    error.syscall !== undefined ||
    error.errno !== undefined ||
    error.path !== undefined ||
    error.type !== undefined
  ) {
    return true;
  }
  const msg = String(error.message || "");
  if (msg.length > 300 || /[\r\n]/.test(msg)) return true;
  if (/(?:\/(?:app|usr|var|etc|home|tmp|Users)\/|[A-Za-z]:\\)/.test(msg)) return true;
  if (/(?:https?:\/\/|redis:\/\/|mongodb:\/\/|postgres:\/\/|Bearer\s|sk-[A-Za-z0-9]|AIza[A-Za-z0-9_-]+)/i.test(msg)) return true;
  if (/\b(?:ENOENT|EACCES|ECONNREFUSED|ETIMEDOUT|SignatureDoesNotMatch|InvalidAccessKeyId|NoSuchBucket|WRONGTYPE|NOAUTH)\b/i.test(msg)) return true;
  return false;
}

export function publicErrorMessage(error, fallback) {
  if (!error?.message) return fallback;
  if (error instanceof SyntaxError || error?.type === "entity.parse.failed" || error?.name === "SyntaxError") {
    return "Sorğu formatı yanlışdır (JSON sintaksis xətası).";
  }
  if (error?.type === "entity.too.large") {
    return "Sorğu həcmi icazə verilən limitdən böyükdür.";
  }
  if (error.expose === true) return error.message;
  if (httpStatusOf(error) >= 500) return fallback;
  return looksLikeInternalOrThirdPartyError(error) ? fallback : error.message;
}
