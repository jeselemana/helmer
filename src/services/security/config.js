function parsePositiveSafeInt(raw, name) {
  if (!/^[1-9][0-9]*$/.test(String(raw)) || !Number.isSafeInteger(Number(raw))) {
    throw new Error(`${name} must be a positive safe integer`);
  }
  return Number(raw);
}

export function guestAskPerMinuteLimit(env = process.env) {
  return parsePositiveSafeInt(env.GUEST_ASK_RATE_LIMIT_PER_MINUTE ?? '10', 'GUEST_ASK_RATE_LIMIT_PER_MINUTE');
}

export function guestAskIpPerMinuteLimit(env = process.env) {
  if (env.GUEST_ASK_IP_RATE_LIMIT_PER_MINUTE !== undefined) {
    return parsePositiveSafeInt(env.GUEST_ASK_IP_RATE_LIMIT_PER_MINUTE, 'GUEST_ASK_IP_RATE_LIMIT_PER_MINUTE');
  }
  return Math.max(guestAskPerMinuteLimit(env) * 2, 20);
}

export function guestBuildPerMinuteLimit(env = process.env) {
  return parsePositiveSafeInt(env.GUEST_BUILD_RATE_LIMIT_PER_MINUTE ?? '8', 'GUEST_BUILD_RATE_LIMIT_PER_MINUTE');
}

export function guestBuildIpPerMinuteLimit(env = process.env) {
  if (env.GUEST_BUILD_IP_RATE_LIMIT_PER_MINUTE !== undefined) {
    return parsePositiveSafeInt(env.GUEST_BUILD_IP_RATE_LIMIT_PER_MINUTE, 'GUEST_BUILD_IP_RATE_LIMIT_PER_MINUTE');
  }
  return Math.max(guestBuildPerMinuteLimit(env) * 2, 16);
}

export function validateSecurityConfig(env = process.env) {
  guestAskPerMinuteLimit(env);
  guestAskIpPerMinuteLimit(env);
  guestBuildPerMinuteLimit(env);
  guestBuildIpPerMinuteLimit(env);
  if (env.REQUIRE_REDIS === 'true' && !env.REDIS_URL?.trim()) {
    throw new Error('REDIS_URL is required when REQUIRE_REDIS is enabled');
  }
  if (env.NODE_ENV !== 'production') return;
  const missing = [];
  if (!env.SESSION_SECRET?.trim()) missing.push('SESSION_SECRET');
  if (!env.AUTH_SECRET?.trim()) missing.push('AUTH_SECRET');
  if (!env.REDIS_URL?.trim()) missing.push('REDIS_URL');
  if (env.ADMIN_MFA_ENCRYPTION_KEY) {
    const key = Buffer.from(env.ADMIN_MFA_ENCRYPTION_KEY, 'base64');
    if (key.length !== 32) throw new Error('ADMIN_MFA_ENCRYPTION_KEY must be a 32-byte base64-encoded string');
  }
  if (missing.length > 0) {
    throw new Error(`Production environment requires configured secrets: ${missing.join(', ')}`);
  }
  if (!env.APP_URL || !/^https:\/\//.test(env.APP_URL)) {
    throw new Error('APP_URL must be an HTTPS URL in production');
  }
  const hasTurnstileSiteKey = Boolean(env.TURNSTILE_SITE_KEY?.trim() || env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim());
  if (hasTurnstileSiteKey && !env.TURNSTILE_SECRET_KEY?.trim()) {
    throw new Error('TURNSTILE_SECRET_KEY is required when TURNSTILE_SITE_KEY is configured in production');
  }
}

export async function ensureStartupRedisConnection(redis, env = process.env) {
  const required = env.NODE_ENV === 'production' || env.REQUIRE_REDIS === 'true';
  if (!redis) {
    if (required) {
      throw new Error('Fatal: Redis client is required in production or when REQUIRE_REDIS=true.');
    }
    return false;
  }
  try {
    await redis.connect();
    if (required && !redis.isReady) {
      throw new Error('Fatal: Redis client is not ready after startup connect.');
    }
    return Boolean(redis.isReady);
  } catch (error) {
    console.error('❌ Redis connection error:', { name: error?.name, code: error?.code });
    if (required) {
      throw new Error('Fatal: Redis connection failed when Redis is required.', { cause: error });
    }
    return false;
  }
}
