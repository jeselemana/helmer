const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const MAX_TOKEN_LENGTH = 2048;

/**
 * Verifies a Cloudflare Turnstile token against Cloudflare's siteverify API.
 * Skips verification only when no Turnstile secret key is configured.
 */
export async function verifyTurnstileToken({
  token,
  secretKey,
  remoteIp,
  appUrl,
  expectedAction = "signup",
  fetcher = fetch,
  nodeEnv = process.env.NODE_ENV,
} = {}) {
  const secret = String(secretKey || "").trim();
  if (!secret) {
    return { ok: true, skipped: true };
  }

  const normalizedToken = typeof token === "string" ? token.trim() : "";
  if (!normalizedToken || normalizedToken.length > MAX_TOKEN_LENGTH) {
    return {
      ok: false,
      status: 403,
      code: "BOT_VERIFICATION_REQUIRED",
      error: "Bot yoxlaması (Turnstile) tamamlanmalıdır. Zəhmət olmasa yenidən cəhd edin.",
    };
  }

  let response;
  let result;
  try {
    response = await fetcher(SITEVERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(5000),
      body: JSON.stringify({
        secret,
        response: normalizedToken,
        remoteip: remoteIp || undefined,
      }),
    });
    if (!response?.ok) {
      return {
        ok: false,
        status: 503,
        code: "BOT_VERIFICATION_UNAVAILABLE",
        error: "Təhlükəsizlik yoxlaması hazırda əlçatan deyil. Bir az sonra yenidən cəhd edin.",
      };
    }
    result = await response.json();
  } catch {
    return {
      ok: false,
      status: 503,
      code: "BOT_VERIFICATION_UNAVAILABLE",
      error: "Təhlükəsizlik yoxlaması zamanı xəta baş verdi. Bir az sonra yenidən cəhd edin.",
    };
  }

  let appHost = "helmeros.com";
  try {
    if (appUrl) appHost = new URL(appUrl).hostname;
  } catch {}

  const isProd = nodeEnv === "production";
  const allowedHosts = isProd
    ? new Set([appHost, "helmeros.com", "www.helmeros.com"])
    : new Set([appHost, "helmeros.com", "www.helmeros.com", "localhost", "127.0.0.1"]);
  const isNonProdTestKeyResult = !isProd && result?.metadata?.result_with_testing_key === true;
  if (isNonProdTestKeyResult) {
    allowedHosts.add("example.com");
  }

  const actionMatches = isProd
    ? (!expectedAction || result?.action === expectedAction)
    : (!result?.action || !expectedAction || result.action === expectedAction);
  const hostMatches = isProd
    ? (Boolean(result?.hostname) && allowedHosts.has(result.hostname))
    : (!result?.hostname || allowedHosts.has(result.hostname));

  if (!result?.success || !actionMatches || !hostMatches) {
    return {
      ok: false,
      status: 403,
      code: "BOT_VERIFICATION_FAILED",
      error: "Təhlükəsizlik yoxlaması (Turnstile) uğursuz oldu. Səhifəni yeniləyib yenidən cəhd edin.",
    };
  }

  return {
    ok: true,
    hostname: result.hostname || null,
    testingKey: isNonProdTestKeyResult,
  };
}
