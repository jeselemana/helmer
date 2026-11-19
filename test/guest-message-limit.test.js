import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import {
  buildGuestMessageLimitInstructions,
  buildAskPrompt,
} from '../src/services/ai/prompts.js';
import {
  ASK_REQUESTS_PER_MINUTE,
  AiPolicy,
} from '../src/services/security/ai-policy.js';
import {
  guestAskPerMinuteLimit,
  guestAskIpPerMinuteLimit,
} from '../src/services/security/config.js';

test('Guest Ask per-minute security limit is strictly lower than registered users and rejects invalid config', () => {
  for (const value of ['0', '-1', '3abc', '3.5', 'NaN', 'Infinity', '', '9007199254740992']) {
    assert.throws(() => guestAskPerMinuteLimit({ GUEST_ASK_RATE_LIMIT_PER_MINUTE: value }));
    assert.throws(() => guestAskIpPerMinuteLimit({ GUEST_ASK_IP_RATE_LIMIT_PER_MINUTE: value }));
  }
  assert.equal(guestAskPerMinuteLimit({}), 10);
  assert.equal(guestAskIpPerMinuteLimit({}), 20);
  assert.ok(guestAskPerMinuteLimit({}) < ASK_REQUESTS_PER_MINUTE, 'Guest Ask RPM must be stricter than registered users');
  assert.equal(guestAskPerMinuteLimit({ GUEST_ASK_RATE_LIMIT_PER_MINUTE: '4' }), 4);
  assert.equal(guestAskIpPerMinuteLimit({ GUEST_ASK_IP_RATE_LIMIT_PER_MINUTE: '9' }), 9);
});

test('Guest Ask prompt: builds prompt without daily limit instructions when remainingMessages is null', () => {
  assert.equal(buildGuestMessageLimitInstructions(null), '');
  assert.equal(buildGuestMessageLimitInstructions(undefined), '');

  const guestPrompt = buildAskPrompt({ isGuest: true, remainingMessages: null });
  assert.ok(!guestPrompt.includes('{remaining_messages}'));
  assert.ok(!guestPrompt.includes('Qonaq mesaj limitiniz bitdi'));

  const userPrompt = buildAskPrompt({ isGuest: false, remainingMessages: null });
  assert.ok(!userPrompt.includes('Qeydiyyatsız (Qonaq)'));
  assert.ok(!userPrompt.includes('{remaining_messages}'));
});

test('Guest Ask rate limit: guests can exceed legacy 5-message daily count and are capped only by per-minute window', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-11-18T10:00:00Z') });
  const policy = new AiPolicy({
    redis: null,
    env: { GUEST_ASK_RATE_LIMIT_PER_MINUTE: '7', GUEST_ASK_IP_RATE_LIMIT_PER_MINUTE: '14' },
  });
  const middleware = policy.middleware();

  const sendRequest = async (ownerId, keySuffix, ip = '198.51.100.1') => {
    const req = {
      path: '/api/ask',
      method: 'POST',
      ownerId,
      ip,
      user: null,
      securityContext: {},
      get: () => `valid-idempotency-key-${keySuffix}-1234567890`,
    };
    let statusCode = 200;
    let payload = null;
    let nextCalled = false;
    const headers = {};
    const res = Object.assign(new EventEmitter(), {
      statusCode: 200,
      setHeader(name, value) { headers[String(name).toLowerCase()] = value; },
      status(code) { statusCode = code; this.statusCode = code; return this; },
      json(body) { payload = body; return this; },
    });
    await middleware(req, res, () => {
      nextCalled = true;
      req.securityContext.providerStarted = true;
      res.emit('finish');
    });
    return { nextCalled, statusCode, payload, headers, req };
  };

  // 7 requests succeed in the first minute (> old 5/day limit)
  for (let i = 1; i <= 7; i++) {
    const out = await sendRequest('guest_test_actor_1', `r1-${i}`);
    assert.equal(out.nextCalled, true);
    assert.equal(out.req.remainingGuestMessages, null);
    assert.equal(out.req.remainingGuestBriefs, null);
  }

  // 8th request within the same minute is blocked with 429 RATE_LIMITED and Retry-After
  const blocked = await sendRequest('guest_test_actor_1', 'r1-8');
  assert.equal(blocked.nextCalled, false);
  assert.equal(blocked.statusCode, 429);
  assert.equal(blocked.payload?.code, 'RATE_LIMITED');
  assert.ok(Number(blocked.headers['retry-after']) >= 1);

  // Advancing 61s resets the rolling minute window so the same guest can continue sending (> 5 total!)
  t.mock.timers.tick(61000);
  const afterWindow = await sendRequest('guest_test_actor_1', 'r2-1');
  assert.equal(afterWindow.nextCalled, true);
});
