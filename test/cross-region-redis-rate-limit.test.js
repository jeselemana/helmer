import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { randomUUID } from 'node:crypto';
import { createAskExecutionGuard } from '../src/http/ask-execution-guard.js';
import { AiPolicy, ASK_REQUESTS_PER_MINUTE } from '../src/services/security/ai-policy.js';

class MockMultiRegionRedis {
  isReady = true;
  values = new Map();
  now = 1000000;

  async get(key) {
    return this.values.get(key) || null;
  }

  async set(key, value, options = {}) {
    if (options.NX && this.values.has(key)) return null;
    this.values.set(key, value);
    return 'OK';
  }

  async del(key) {
    this.values.delete(key);
    return 1;
  }

  async eval(script, { keys, arguments: args }) {
    // 1. Sliding rate limit script (reserveAskRate)
    if (keys[0].startsWith('security:ask-minute:')) {
      const window = Number(args[1]);
      const buckets = keys.map(key => (this.values.get(key) || []).filter(time => time > this.now - window));
      const retry = Math.max(0, ...buckets.map((bucket, index) =>
        bucket.length >= Number(args[index + 2]) ? bucket[0] + window - this.now : 0));
      if (retry > 0) return Math.ceil(retry / 1000);
      keys.forEach((key, index) => this.values.set(key, [...buckets[index], this.now]));
      return 0;
    }

    // 2. Shared Ask lease barrier
    if (args[0] === 'ask-shared-v2') {
      const owner = this.values.get(keys[0]);
      const leases = this.values.get(keys[1]) || new Map();
      if (script.includes("redis.call('set', KEYS[1]")) {
        if (owner && owner !== args[0]) return 0;
        this.values.set(keys[0], args[0]);
        this.values.set(keys[1], leases);
        leases.set(args[1], this.now + Number(args[2]));
        return 1;
      }
      if (owner !== args[0]) return 0;
      if (script.includes("redis.call('zrem',")) {
        leases.delete(args[1]);
        if (!leases.size) { this.values.delete(keys[0]); this.values.delete(keys[1]); }
        return 1;
      }
      if ((leases.get(args[1]) || 0) <= this.now) return 0;
      if (script.includes("redis.call('zadd'")) leases.set(args[1], this.now + Number(args[2]));
      return 1;
    }

    // 3. Lock release
    if (script.includes("if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del'")) {
      if (this.values.get(keys[0]) === args[0]) {
        this.values.delete(keys[0]);
        return 1;
      }
      return 0;
    }

    throw new Error(`Unhandled script in MockMultiRegionRedis: ${script.slice(0, 40)}`);
  }
}

function createRegionApp({ regionName, redis }) {
  const app = express();
  app.use(express.json());

  const policy = new AiPolicy({
    redis,
    allowParallelAskChats: true,
    env: { SESSION_SECRET: 'test-shared-secret', AUTH_SECRET: 'test-shared-secret' },
  });

  const guard = createAskExecutionGuard({
    redis,
    allowGuest: false,
    allowParallelChats: true,
    hasActiveJobForOwner: () => false,
  });

  // Attach authenticated test user
  app.use((req, res, next) => {
    const ownerId = req.headers['x-owner-id'] || 'usr_default';
    req.auth = { user: { id: ownerId, emailVerifiedAt: '2026-01-01T00:00:00Z' } };
    req.user = req.auth.user;
    req.ownerId = ownerId;
    req.securityContext = {
      assertAuthorized: async () => {},
    };
    next();
  });

  app.use(policy.middleware());
  app.use('/api/ask', guard);

  app.post('/api/ask', (req, res) => {
    res.json({
      ok: true,
      region: regionName,
      chatId: req.body?.chatId || null,
      message: 'Processed',
    });
  });

  return app;
}

async function request(app, { method = 'POST', path = '/api/ask', body = {}, headers = {}, ip = '203.0.113.10' } = {}) {
  const http = await import('node:http');
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  const defaultHeaders = {
    'content-type': 'application/json',
    'idempotency-key': randomUUID(),
    'x-forwarded-for': ip,
    ...headers,
  };

  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: defaultHeaders,
      body: JSON.stringify(body),
    });
    const status = res.status;
    const resHeaders = res.headers;
    let json = null;
    try { json = await res.json(); } catch {}
    return { status, headers: resHeaders, json };
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

test('Multi-Region Redis: 15 req/min per account limit is enforced across us-central1 and europe-west3', async () => {
  const sharedRedis = new MockMultiRegionRedis();
  const usCentralApp = createRegionApp({ regionName: 'us-central1', redis: sharedRedis });
  const europeWestApp = createRegionApp({ regionName: 'europe-west3', redis: sharedRedis });

  const ownerId = 'usr_cross_region_tenant';
  const headers = { 'x-owner-id': ownerId };

  // Send 10 requests to us-central1
  for (let i = 0; i < 10; i++) {
    const res = await request(usCentralApp, { headers, body: { chatId: randomUUID() } });
    assert.equal(res.status, 200, `us-central1 request ${i + 1} should succeed`);
    assert.equal(res.json?.region, 'us-central1');
  }

  // Send 5 requests to europe-west3
  for (let i = 0; i < 5; i++) {
    const res = await request(europeWestApp, { headers, body: { chatId: randomUUID() } });
    assert.equal(res.status, 200, `europe-west3 request ${i + 1} should succeed`);
    assert.equal(res.json?.region, 'europe-west3');
  }

  // 15 requests total reached across both regions. The 16th request to us-central1 MUST fail with 429 RATE_LIMITED
  const usOverLimit = await request(usCentralApp, { headers, body: { chatId: randomUUID() } });
  assert.equal(usOverLimit.status, 429);
  assert.equal(usOverLimit.json?.code, 'RATE_LIMITED');
  assert.equal(usOverLimit.headers.get('retry-after'), '60');

  // The 17th request to europe-west3 MUST ALSO fail with 429 RATE_LIMITED
  const euOverLimit = await request(europeWestApp, { headers, body: { chatId: randomUUID() } });
  assert.equal(euOverLimit.status, 429);
  assert.equal(euOverLimit.json?.code, 'RATE_LIMITED');
  assert.equal(euOverLimit.headers.get('retry-after'), '60');

  // Advance time by 30 seconds
  sharedRedis.now += 30000;
  const stillLimited = await request(europeWestApp, { headers, body: { chatId: randomUUID() } });
  assert.equal(stillLimited.status, 429);
  assert.equal(stillLimited.headers.get('retry-after'), '30');

  // Advance time past the 60-second window
  sharedRedis.now += 30001;
  const recovered = await request(europeWestApp, { headers, body: { chatId: randomUUID() } });
  assert.equal(recovered.status, 200);
});

test('Multi-Region Redis: Prevents parallel writes to the SAME chat across us-central1 and europe-west3', async () => {
  const sharedRedis = new MockMultiRegionRedis();
  const usCentralApp = createRegionApp({ regionName: 'us-central1', redis: sharedRedis });
  const europeWestApp = createRegionApp({ regionName: 'europe-west3', redis: sharedRedis });

  const ownerId = 'usr_parallel_chat_owner';
  const sharedChatId = randomUUID();
  const headers = { 'x-owner-id': ownerId };

  // Simulate an active lock on sharedChatId acquired by us-central1
  const lockKey = `helmer:ask-lock:${ownerId}:chat:${sharedChatId}`;
  await sharedRedis.set(lockKey, 'us-token', { NX: true, PX: 240000 });

  // A concurrent request for the same chat arriving at europe-west3 MUST be rejected with 429 EXECUTION_BUSY
  const res = await request(europeWestApp, {
    headers,
    body: { chatId: sharedChatId },
  });
  assert.equal(res.status, 429);
  assert.equal(res.json?.code, 'EXECUTION_BUSY');

  // However, a request for a DIFFERENT chat in europe-west3 MUST succeed
  const differentChatId = randomUUID();
  const diffRes = await request(europeWestApp, {
    headers,
    body: { chatId: differentChatId },
  });
  assert.equal(diffRes.status, 200);
  assert.equal(diffRes.json?.chatId, differentChatId);

  // Once us-central1 releases the lock on sharedChatId
  await sharedRedis.del(lockKey);

  // europe-west3 can now proceed on sharedChatId
  const releasedRes = await request(europeWestApp, {
    headers,
    body: { chatId: sharedChatId },
  });
  assert.equal(releasedRes.status, 200);
  assert.equal(releasedRes.json?.chatId, sharedChatId);
});

test('Multi-Region Redis: IP rate limit (60 req/min) is enforced centrally across regions', async () => {
  const sharedRedis = new MockMultiRegionRedis();
  const usCentralApp = createRegionApp({ regionName: 'us-central1', redis: sharedRedis });
  const europeWestApp = createRegionApp({ regionName: 'europe-west3', redis: sharedRedis });

  const sharedIp = '198.51.100.42';

  // Send 60 requests from distinct owners but sharing the same client IP (split 30/30 across regions)
  for (let i = 0; i < 30; i++) {
    const res = await request(usCentralApp, {
      headers: { 'x-owner-id': `owner_us_${i}` },
      body: { chatId: randomUUID() },
      ip: sharedIp,
    });
    assert.equal(res.status, 200);
  }
  for (let i = 0; i < 30; i++) {
    const res = await request(europeWestApp, {
      headers: { 'x-owner-id': `owner_eu_${i}` },
      body: { chatId: randomUUID() },
      ip: sharedIp,
    });
    assert.equal(res.status, 200);
  }

  // 61st request from a new owner but the same IP in either region MUST fail with 429 RATE_LIMITED
  const ipOverLimit = await request(usCentralApp, {
    headers: { 'x-owner-id': 'owner_us_new' },
    body: { chatId: randomUUID() },
    ip: sharedIp,
  });
  assert.equal(ipOverLimit.status, 429);
  assert.equal(ipOverLimit.json?.code, 'RATE_LIMITED');
  assert.equal(ipOverLimit.headers.get('retry-after'), '60');
});
