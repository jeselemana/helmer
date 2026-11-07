import { randomUUID } from 'node:crypto';

// Keep the existing owner mutex as a barrier against exclusive work.
const ASK_BARRIER = 'ask-shared-v2';
const LEASE_MS = '180000';
const redisNow = `local t = redis.call('TIME')
local now = t[1] * 1000 + math.floor(t[2] / 1000)`;

export async function acquireSharedAskLease(redis, ownerId, token) {
  const ownerKey = `security:owner-execution:${ownerId}`;
  const keys = [ownerKey, `${ownerKey}:ask-leases`];
  const args = [ASK_BARRIER, token, LEASE_MS];
  const admitted = await redis.eval(`
    ${redisNow}
    local owner = redis.call('get', KEYS[1])
    if owner and owner ~= ARGV[1] then return 0 end
    redis.call('zremrangebyscore', KEYS[2], '-inf', now)
    redis.call('zadd', KEYS[2], now + tonumber(ARGV[3]), ARGV[2])
    redis.call('pexpire', KEYS[2], ARGV[3])
    redis.call('set', KEYS[1], ARGV[1], 'PX', ARGV[3])
    return 1
  `, { keys, arguments: args });
  if (!admitted) return null;
  const verify = `
    ${redisNow}
    local expires = redis.call('zscore', KEYS[2], ARGV[2])
    if redis.call('get', KEYS[1]) ~= ARGV[1] or not expires or tonumber(expires) <= now then return 0 end
  `;
  return {
    async isOwned() {
      return redis.isReady && await redis.eval(verify + 'return 1', { keys, arguments: args }) === 1;
    },
    renew: () => redis.eval(verify + `
      redis.call('zadd', KEYS[2], now + tonumber(ARGV[3]), ARGV[2])
      redis.call('pexpire', KEYS[2], ARGV[3])
      return redis.call('pexpire', KEYS[1], ARGV[3])
    `, { keys, arguments: args }),
    release: () => redis.eval(`
      ${redisNow}
      if redis.call('get', KEYS[1]) ~= ARGV[1] then return 0 end
      redis.call('zrem', KEYS[2], ARGV[2])
      redis.call('zremrangebyscore', KEYS[2], '-inf', now)
      if redis.call('zcard', KEYS[2]) == 0 then redis.call('del', KEYS[1]) end
      return 1
    `, { keys, arguments: args }),
  };
}

// Uses the same tenant key as HTTP admission; recovery cannot bypass active requests.
export async function acquireOwnerExecutionLease(redis, ownerId, controller) {
  if (!redis?.isReady) {
    if ((process.env.NODE_ENV === 'production' && (process.env.REDIS_URL || process.env.REQUIRE_REDIS === 'true')) || redis) throw Object.assign(new Error('Execution unavailable'), { code: 'EXECUTION_UNAVAILABLE', status: 503 });
    let released = false;
    return { assertOwned: async () => { if (released) throw Object.assign(new Error('Execution lease lost'), { code: 'EXECUTION_LOCK_LOST' }); }, release: async () => { released = true; } };
  }
  const key = `security:owner-execution:${ownerId}`, token = randomUUID();
  if (!await redis.set(key, token, { NX: true, PX: 180000 })) throw Object.assign(new Error('Execution busy'), { code: 'EXECUTION_BUSY', status: 429 });
  let released = false, renewing = false;
  const heartbeat = setInterval(async () => {
    if (renewing || released) return;
    renewing = true;
    try {
      if (!await redis.eval("if redis.call('get',KEYS[1]) ~= ARGV[1] then return 0 end; return redis.call('pexpire',KEYS[1],180000)", { keys: [key], arguments: [token] })) throw new Error('Lease lost');
    } catch { controller.abort(Object.assign(new Error('Execution lease lost'), { code: 'EXECUTION_LOCK_LOST' })); }
    finally { renewing = false; }
  }, 30000);
  heartbeat.unref();
  return { assertOwned: async () => {
    if (released || !redis.isReady || await redis.get(key) !== token) throw Object.assign(new Error('Execution lease lost'), { code: 'EXECUTION_LOCK_LOST' });
  }, release: async () => {
    if (released) return;
    released = true; clearInterval(heartbeat);
    await redis.eval("if redis.call('get',KEYS[1]) == ARGV[1] then return redis.call('del',KEYS[1]) end; return 0", { keys: [key], arguments: [token] }).catch(() => {});
  } };
}
