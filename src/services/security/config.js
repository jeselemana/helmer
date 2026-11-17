export function guestDailyLimit(env = process.env) {
  const raw = env.GUEST_AI_DAILY_LIMIT ?? '5';
  if (!/^[1-9][0-9]*$/.test(String(raw)) || !Number.isSafeInteger(Number(raw))) {
    throw new Error('GUEST_AI_DAILY_LIMIT must be a positive safe integer');
  }
  return Number(raw);
}

export function guestBuildDailyLimit(env = process.env) {
  const raw = env.GUEST_BUILD_DAILY_LIMIT ?? '3';
  if (!/^[1-9][0-9]*$/.test(String(raw)) || !Number.isSafeInteger(Number(raw))) {
    throw new Error('GUEST_BUILD_DAILY_LIMIT must be a positive safe integer');
  }
  return Number(raw);
}

export function guestBuildPreflightDailyLimit(env = process.env) {
  if (env.GUEST_BUILD_PREFLIGHT_DAILY_LIMIT !== undefined) {
    const raw = env.GUEST_BUILD_PREFLIGHT_DAILY_LIMIT;
    if (!/^[1-9][0-9]*$/.test(String(raw)) || !Number.isSafeInteger(Number(raw))) {
      throw new Error('GUEST_BUILD_PREFLIGHT_DAILY_LIMIT must be a positive safe integer');
    }
    return Number(raw);
  }
  return Math.max(guestBuildDailyLimit(env) * 10, 30);
}

export function validateSecurityConfig(env = process.env) {
  guestDailyLimit(env);
  guestBuildDailyLimit(env);
  guestBuildPreflightDailyLimit(env);
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
    console.error('❌ Redis connection error:', { name: error?.name, code: error?.code, message: error?.message });
    if (required) {
      throw new Error('Fatal: Redis connection failed when Redis is required.', { cause: error });
    }
    return false;
  }
}
