import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import express from 'express';
import { randomUUID } from 'node:crypto';
import {
  guestBuildPerMinuteLimit,
  guestBuildIpPerMinuteLimit,
} from '../src/services/security/config.js';
import { AiPolicy } from '../src/services/security/ai-policy.js';

test('guestBuildPerMinuteLimit and guestBuildIpPerMinuteLimit reject invalid config and enforce strict defaults', () => {
  for (const value of ['0', '-1', '3abc', '3.5', 'NaN', 'Infinity', '', '9007199254740992']) {
    assert.throws(() => guestBuildPerMinuteLimit({ GUEST_BUILD_RATE_LIMIT_PER_MINUTE: value }));
    assert.throws(() => guestBuildIpPerMinuteLimit({ GUEST_BUILD_IP_RATE_LIMIT_PER_MINUTE: value }));
  }
  assert.equal(guestBuildPerMinuteLimit({}), 8);
  assert.equal(guestBuildIpPerMinuteLimit({}), 16);
  assert.equal(guestBuildPerMinuteLimit({ GUEST_BUILD_RATE_LIMIT_PER_MINUTE: '5' }), 5);
  assert.equal(guestBuildIpPerMinuteLimit({ GUEST_BUILD_IP_RATE_LIMIT_PER_MINUTE: '12' }), 12);
});

test('AiPolicy in-memory allows guests past 3 daily briefs and enforces rolling per-minute Build limit', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-11-18T11:00:00Z') });
  const policy = new AiPolicy({
    redis: null,
    env: { GUEST_BUILD_RATE_LIMIT_PER_MINUTE: '6', GUEST_BUILD_IP_RATE_LIMIT_PER_MINUTE: '12' },
  });
  const middleware = policy.middleware();

  const sendBuild = async (path, ownerId = 'guest_build_test_user_1') => {
    const req = {
      path,
      method: 'POST',
      ownerId,
      ip: '198.51.100.7',
      user: null,
      securityContext: {},
      get: () => `valid-idempotency-key-${randomUUID()}`,
    };
    const headers = {};
    let statusVal = 200;
    let bodyVal = null;
    let nextCalled = false;
    const res = Object.assign(new EventEmitter(), {
      statusVal: 200,
      setHeader(name, value) { headers[String(name).toLowerCase()] = value; },
      status(code) { statusVal = code; this.statusVal = code; return this; },
      json(body) { bodyVal = body; return this; },
    });
    await middleware(req, res, () => {
      nextCalled = true;
      req.securityContext.providerStarted = true;
      res.emit('finish');
    });
    return { nextCalled, statusVal, bodyVal, headers, req };
  };

  // 6 Build requests (assess/generate) succeed in the first minute (> old 3/day cap)
  for (let i = 0; i < 6; i++) {
    const path = i % 2 === 0 ? '/api/strategy/assess' : '/api/strategy/generate-stream';
    const out = await sendBuild(path);
    assert.equal(out.nextCalled, true);
    assert.equal(out.req.remainingGuestBriefs, null);
  }

  // 7th Build request in the same minute fails with 429 RATE_LIMITED + Retry-After
  const blocked = await sendBuild('/api/strategy/generate');
  assert.equal(blocked.nextCalled, false);
  assert.equal(blocked.statusVal, 429);
  assert.equal(blocked.bodyVal?.code, 'RATE_LIMITED');
  assert.ok(Number(blocked.headers['retry-after']) >= 1);

  // Rolling window resets after 61s
  t.mock.timers.tick(61000);
  const nextMinute = await sendBuild('/api/strategy/assess');
  assert.equal(nextMinute.nextCalled, true);

  // Quota endpoint reports daily limits removed (null) and active per-minute limit
  const quota = await policy.getGuestQuota({ ownerId: 'guest_build_test_user_1', ip: '198.51.100.7' });
  assert.equal(quota.isGuest, true);
  assert.equal(quota.buildLimit, null);
  assert.equal(quota.buildRemaining, null);
  assert.equal(quota.limit, null);
  assert.equal(quota.remaining, null);
  assert.equal(quota.buildPerMinuteLimit, 6);
});

test('guest HTTP Build mode: omits guestCtaNotice/remainingGuestBriefs and enforces per-minute rate limit with Retry-After', async (t) => {
  const policy = new AiPolicy({
    redis: null,
    env: { GUEST_BUILD_RATE_LIMIT_PER_MINUTE: '4', GUEST_BUILD_IP_RATE_LIMIT_PER_MINUTE: '8' },
  });
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.ownerId = `guest_${req.get('X-Test-Owner') || 'build_test'}`;
    req.securityContext = { providerStarted: false };
    next();
  });
  app.get('/api/auth/guest-status', policy.guestQuotaHandler());
  app.get('/api/security/config', (req, res) => {
    res.json({
      guest: true,
      guestAiDailyLimit: null,
      guestBuildDailyLimit: null,
      guestAskPerMinuteLimit: 10,
      guestBuildPerMinuteLimit: guestBuildPerMinuteLimit(policy.env),
    });
  });
  app.use(policy.middleware());

  app.post('/api/strategy/assess', (req, res) => {
    res.json({
      assessment: { status: 'ready', understanding: 'Brief başa düşüldü', assumptions: [] },
      isGuest: true,
    });
  });

  app.post('/api/strategy/generate-stream', (req, res) => {
    req.securityContext.providerStarted = true;
    const payload = {
      done: true,
      strategy: { title: 'Test Strategy', summary: 'Xülasə' },
      isGuest: true,
    };
    res.type('text/event-stream');
    res.write(`data: ${JSON.stringify({ chunk: 'Strategiya qurulur...' })}\n\n`);
    res.end(`data: ${JSON.stringify(payload)}\n\n`);
  });

  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));

  const base = `http://127.0.0.1:${server.address().port}`;
  const owner = 'build_runner_1';

  const configRes = await fetch(`${base}/api/security/config`);
  const configData = await configRes.json();
  assert.equal(configData.guestAiDailyLimit, null);
  assert.equal(configData.guestBuildDailyLimit, null);
  assert.equal(configData.guestBuildPerMinuteLimit, 4);

  // 4 Build requests succeed
  for (let b = 1; b <= 4; b++) {
    const endpoint = b % 2 === 1 ? '/api/strategy/assess' : '/api/strategy/generate-stream';
    const res = await fetch(`${base}${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': randomUUID(),
        'X-Test-Owner': owner,
      },
      body: JSON.stringify({ brief: `Biznes brif mətni nömrə ${b}` }),
    });
    assert.equal(res.status, 200);
    if (endpoint.endsWith('generate-stream')) {
      const text = await res.text();
      const events = text.trim().split('\n\n').map(l => JSON.parse(l.slice(6)));
      const doneEvt = events.at(-1);
      assert.equal(doneEvt.done, true);
      assert.equal(doneEvt.remainingGuestBriefs, undefined);
      assert.equal(doneEvt.guestCtaNotice, undefined);
    } else {
      const data = await res.json();
      assert.equal(data.isGuest, true);
      assert.equal(data.remainingGuestBriefs, undefined);
    }
  }

  // 5th Build request within the same minute fails with 429 RATE_LIMITED + Retry-After
  const blocked = await fetch(`${base}/api/strategy/assess`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': randomUUID(),
      'X-Test-Owner': owner,
    },
    body: JSON.stringify({ brief: 'Beşinci brif sorğusu' }),
  });
  assert.equal(blocked.status, 429);
  assert.ok(Number(blocked.headers.get('retry-after')) >= 1);
  const blockedData = await blocked.json();
  assert.equal(blockedData.code, 'RATE_LIMITED');
});
