import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import express from 'express';
import { randomUUID } from 'node:crypto';
import { guestBuildDailyLimit, guestDailyLimit } from '../src/services/security/config.js';
import { AiPolicy, guestBriefBalance } from '../src/services/security/ai-policy.js';
import {
  GUEST_BUILD_EXHAUSTED_MESSAGE,
  GUEST_BUILD_EXHAUSTED_MESSAGE_EN,
  getGuestBuildCtaNotice,
} from '../src/services/ai/prompts.js';

test('guestBuildDailyLimit rejects zero, negative, unsafe and non-integer values', () => {
  for (const value of ['0', '-1', '3abc', '3.5', 'NaN', 'Infinity', '', '9007199254740992']) {
    assert.throws(() => guestBuildDailyLimit({ GUEST_BUILD_DAILY_LIMIT: value }));
  }
  assert.equal(guestBuildDailyLimit({}), 3);
  assert.equal(guestBuildDailyLimit({ GUEST_BUILD_DAILY_LIMIT: '5' }), 5);
});

test('guestBriefBalance validates correct brief counts and throws on inconsistent data', () => {
  assert.equal(guestBriefBalance({ guestBriefsAvailable: 3, remainingGuestBriefs: 2 }).remaining, 2);
  assert.equal(guestBriefBalance({ guestBriefsAvailable: 2, remainingGuestBriefs: 2 }).remaining, 2);
  assert.throws(() => guestBriefBalance({}), { code: 'EXECUTION_UNAVAILABLE' });
  assert.throws(() => guestBriefBalance({ guestBriefsAvailable: 0, remainingGuestBriefs: 0 }), { code: 'EXECUTION_UNAVAILABLE' });
  assert.throws(() => guestBriefBalance({ guestBriefsAvailable: 3, remainingGuestBriefs: 5 }), { code: 'EXECUTION_UNAVAILABLE' });
});

test('getGuestBuildCtaNotice returns exact specifications in Azerbaijani and English', () => {
  // Tier 1: > 2 (e.g. 3)
  const cta3 = getGuestBuildCtaNotice(3);
  assert.ok(cta3.includes('Qeyd: Qonaq rejimində qalan brif haqqınız: 3'));
  assert.ok(cta3.includes('qeydiyyatdan keçin'));

  const cta3En = getGuestBuildCtaNotice(3, true);
  assert.ok(cta3En.includes('Remaining briefs: 3'));
  assert.ok(cta3En.includes('Sign up'));

  // Tier 2: 2 or 1
  const cta2 = getGuestBuildCtaNotice(2);
  assert.ok(cta2.includes('Diqqət: Cəmi 2 brif haqqınız qaldı!'));

  const cta1 = getGuestBuildCtaNotice(1);
  assert.ok(cta1.includes('Diqqət: Cəmi 1 brif haqqınız qaldı!'));

  const cta2En = getGuestBuildCtaNotice(2, true);
  assert.ok(cta2En.includes('Only 2 briefs left!'));

  const cta1En = getGuestBuildCtaNotice(1, true);
  assert.ok(cta1En.includes('Only 1 brief left!'));

  // Tier 3: 0
  const cta0 = getGuestBuildCtaNotice(0);
  assert.equal(cta0, GUEST_BUILD_EXHAUSTED_MESSAGE);
  assert.ok(cta0.includes('Qonaq brif limitiniz bitdi'));

  const cta0En = getGuestBuildCtaNotice(0, true);
  assert.equal(cta0En, GUEST_BUILD_EXHAUSTED_MESSAGE_EN);
  assert.ok(cta0En.includes('Guest brief limit reached'));
});

test('AiPolicy in-memory tracks up to 3 guest briefs in Build mode and rejects 4th with 429', async () => {
  const policy = new AiPolicy({ redis: null, env: { GUEST_BUILD_DAILY_LIMIT: '3' } });
  const middleware = policy.middleware();

  const makeReq = (path, method = 'POST') => ({
    path,
    method,
    ownerId: 'guest_build_test_user_1',
    user: null,
    securityContext: {},
    get: () => 'valid-idempotency-key-build-12345',
  });

  const makeRes = () => {
    return Object.assign(new EventEmitter(), {
      statusVal: 200,
      bodyVal: null,
      status(code) { this.statusVal = code; return this; },
      json(body) { this.bodyVal = body; return this; },
    });
  };

  // Brief 1 - assess phase (checks quota, does not increment)
  const assessReq1 = makeReq('/api/strategy/assess');
  const res1 = makeRes();
  let next1 = false;
  const finish = req => {
    req.securityContext.providerStarted = true;
    res1.emit('finish');
  };
  await middleware(assessReq1, res1, () => { next1 = true; finish(assessReq1); });
  assert.equal(next1, true);
  assert.equal(assessReq1.remainingGuestBriefs, 3);

  // Brief 1 - generate-stream phase (consumes 1 brief quota)
  const genReq1 = makeReq('/api/strategy/generate-stream');
  let nextGen1 = false;
  await middleware(genReq1, res1, () => { nextGen1 = true; finish(genReq1); });
  assert.equal(nextGen1, true);
  assert.equal(genReq1.guestBuildUsageCount, 1);
  assert.equal(genReq1.remainingGuestBriefs, 2);

  // Brief 2 - generate phase (consumes 2nd brief)
  const genReq2 = makeReq('/api/strategy/generate');
  let nextGen2 = false;
  await middleware(genReq2, res1, () => { nextGen2 = true; finish(genReq2); });
  assert.equal(nextGen2, true);
  assert.equal(genReq2.guestBuildUsageCount, 2);
  assert.equal(genReq2.remainingGuestBriefs, 1);

  // Brief 3 - generate phase (consumes 3rd brief -> remaining 0)
  const genReq3 = makeReq('/api/strategy/generate-stream');
  let nextGen3 = false;
  await middleware(genReq3, res1, () => { nextGen3 = true; finish(genReq3); });
  assert.equal(nextGen3, true);
  assert.equal(genReq3.guestBuildUsageCount, 3);
  assert.equal(genReq3.remainingGuestBriefs, 0);

  // Brief 4 - assess phase must now fail with 429 GUEST_DAILY_LIMIT and GUEST_BUILD_EXHAUSTED_MESSAGE
  const assessReq4 = makeReq('/api/strategy/assess');
  const res4 = makeRes();
  let nextAssess4 = false;
  await middleware(assessReq4, res4, () => { nextAssess4 = true; });
  res4.emit('finish');
  assert.equal(nextAssess4, false);
  assert.equal(res4.statusVal, 429);
  assert.equal(res4.bodyVal?.code, 'GUEST_DAILY_LIMIT');
  assert.equal(res4.bodyVal?.error, GUEST_BUILD_EXHAUSTED_MESSAGE);

  // Brief 4 - generate phase must also fail with 429 GUEST_DAILY_LIMIT and GUEST_BUILD_EXHAUSTED_MESSAGE
  const genReq4 = makeReq('/api/strategy/generate-stream');
  const resGen4 = makeRes();
  let nextGen4 = false;
  await middleware(genReq4, resGen4, () => { nextGen4 = true; });
  resGen4.emit('finish');
  assert.equal(nextGen4, false);
  assert.equal(resGen4.statusVal, 429);
  assert.equal(resGen4.bodyVal?.code, 'GUEST_DAILY_LIMIT');
  assert.equal(resGen4.bodyVal?.error, GUEST_BUILD_EXHAUSTED_MESSAGE);

  // Check getGuestQuota reports both Ask and Build quotas
  const quota = await policy.getGuestQuota({ ownerId: 'guest_build_test_user_1', ip: '127.0.0.1' });
  assert.equal(quota.isGuest, true);
  assert.equal(quota.buildLimit, 3);
  assert.equal(quota.buildUsed, 3);
  assert.equal(quota.buildRemaining, 0);
  assert.equal(quota.limit, 5); // Default Ask limit intact
  assert.equal(quota.used, 0); // No ask queries consumed
  assert.equal(quota.remaining, 5);
});

test('guest HTTP Build mode: 3 briefs succeed, 4th brief is rejected with 429 and GUEST_BUILD_EXHAUSTED_MESSAGE', async (t) => {
  const policy = new AiPolicy({ redis: null, env: { GUEST_BUILD_DAILY_LIMIT: '3' } });
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
      guestAiDailyLimit: guestDailyLimit(),
      guestBuildDailyLimit: guestBuildDailyLimit(policy.env),
    });
  });
  app.use(policy.middleware());

  // Mock Build strategy routes
  app.post('/api/strategy/assess', (req, res) => {
    res.json({
      assessment: { status: 'ready', understanding: 'Brief başa düşüldü', assumptions: [] },
      remainingGuestBriefs: req.remainingGuestBriefs,
      isGuest: true,
    });
  });

  app.post('/api/strategy/generate-stream', (req, res) => {
    req.securityContext.providerStarted = true;
    const remaining = req.remainingGuestBriefs;
    const payload = {
      done: true,
      strategy: { title: 'Test Strategy', summary: 'Xülasə' },
      remainingGuestBriefs: remaining,
      isGuest: true,
      guestCtaNotice: getGuestBuildCtaNotice(remaining),
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

  // Config test
  const configRes = await fetch(`${base}/api/security/config`);
  const configData = await configRes.json();
  assert.equal(configData.guestBuildDailyLimit, 3);

  // 3 briefs
  for (let b = 1; b <= 3; b++) {
    // assess
    const assessRes = await fetch(`${base}/api/strategy/assess`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': randomUUID(),
        'X-Test-Owner': owner,
      },
      body: JSON.stringify({ brief: `Biznes brif mətni nömrə ${b}` }),
    });
    assert.equal(assessRes.status, 200);
    const assessData = await assessRes.json();
    assert.equal(assessData.isGuest, true);
    assert.equal(assessData.remainingGuestBriefs, 4 - b);

    // generate-stream
    const genRes = await fetch(`${base}/api/strategy/generate-stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': randomUUID(),
        'X-Test-Owner': owner,
      },
      body: JSON.stringify({
        brief: `Biznes brif mətni nömrə ${b}`,
        idempotencyKey: randomUUID(),
      }),
    });
    assert.equal(genRes.status, 200);
    const text = await genRes.text();
    const events = text.trim().split('\n\n').map(l => JSON.parse(l.slice(6)));
    const doneEvt = events.at(-1);
    assert.equal(doneEvt.done, true);
    assert.equal(doneEvt.remainingGuestBriefs, 3 - b);
  }

  // 4th brief attempt: assess should fail with 429
  const assess4 = await fetch(`${base}/api/strategy/assess`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': randomUUID(),
      'X-Test-Owner': owner,
    },
    body: JSON.stringify({ brief: 'Dördüncü brif' }),
  });
  assert.equal(assess4.status, 429);
  const assess4Data = await assess4.json();
  assert.equal(assess4Data.code, 'GUEST_DAILY_LIMIT');
  assert.equal(assess4Data.error, GUEST_BUILD_EXHAUSTED_MESSAGE);

  // 4th brief attempt: generate-stream should also fail with 429
  const gen4 = await fetch(`${base}/api/strategy/generate-stream`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': randomUUID(),
      'X-Test-Owner': owner,
    },
    body: JSON.stringify({ brief: 'Dördüncü brif', idempotencyKey: randomUUID() }),
  });
  assert.equal(gen4.status, 429);
  const gen4Data = await gen4.json();
  assert.equal(gen4Data.code, 'GUEST_DAILY_LIMIT');
  assert.equal(gen4Data.error, GUEST_BUILD_EXHAUSTED_MESSAGE);
});
