import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import {
  GUEST_EXHAUSTED_MESSAGE,
  getGuestCtaNotice,
  formatGuestAnswerWithCta,
  buildGuestMessageLimitInstructions,
  buildAskPrompt,
} from '../src/services/ai/prompts.js';
import { AiPolicy } from '../src/services/security/ai-policy.js';

test('Guest message limit: getGuestCtaNotice matches exact specifications across all tiers', () => {
  // Tier 1: > 2
  const cta5 = getGuestCtaNotice(5);
  assert.equal(cta5, 'Qeyd: Qonaq rejimində qalan mesaj haqqınız: 5. Bütün analizlərin yaddaşda qalması və limitsiz istifadə üçün qeydiyyatdan keçin.');
  const cta3 = getGuestCtaNotice(3);
  assert.equal(cta3, 'Qeyd: Qonaq rejimində qalan mesaj haqqınız: 3. Bütün analizlərin yaddaşda qalması və limitsiz istifadə üçün qeydiyyatdan keçin.');

  // Tier 2: == 2 or 1
  const cta2 = getGuestCtaNotice(2);
  assert.equal(cta2, 'Diqqət: Cəmi 2 mesaj haqqınız qaldı! Söhbətin yarımçıq qalmaması və sessiyanın itməməsi üçün indi qeydiyyatdan keçin.');
  const cta1 = getGuestCtaNotice(1);
  assert.equal(cta1, 'Diqqət: Cəmi 1 mesaj haqqınız qaldı! Söhbətin yarımçıq qalmaması və sessiyanın itməməsi üçün indi qeydiyyatdan keçin.');

  // Tier 3: == 0
  const cta0 = getGuestCtaNotice(0);
  assert.equal(cta0, GUEST_EXHAUSTED_MESSAGE);
  assert.equal(cta0, 'Qonaq mesaj limitiniz bitdi. Helmer-dən limitsiz istifadə etmək və söhbəti davam etdirmək üçün qeydiyyatdan keçin.');
});

test('Guest message limit: formatGuestAnswerWithCta enforces the exact CTA once and preserves the full answer', () => {
  const answer = 'Bu, biznes analizinin tam cavabıdır.';

  // When > 0: message text remains clean, no CTA appended
  const formatted4 = formatGuestAnswerWithCta(answer, 4);
  assert.equal(formatted4, `${answer}\n\n${getGuestCtaNotice(4)}`);
  assert.equal(formatGuestAnswerWithCta(formatted4, 4), formatted4);

  const formatted2 = formatGuestAnswerWithCta(answer, 2);
  assert.equal(formatted2, `${answer}\n\n**${getGuestCtaNotice(2)}**`);

  const formatted1 = formatGuestAnswerWithCta(answer, 1);
  assert.equal(formatted1, `${answer}\n\n**${getGuestCtaNotice(1)}**`);

  // When 0: question/answer is NOT returned, only the exhausted notice
  const formatted0 = formatGuestAnswerWithCta(answer, 0);
  assert.equal(formatted0, GUEST_EXHAUSTED_MESSAGE);
  assert.ok(!formatted0.includes(answer));
});

test('Guest message limit: buildGuestMessageLimitInstructions creates prompt directives', () => {
  const prompt4 = buildGuestMessageLimitInstructions(4);
  assert.ok(prompt4.includes('İstifadəçi statusu: Qeydiyyatsız (Qonaq).'));
  assert.ok(prompt4.includes('{remaining_messages} = 4'));
  assert.ok(prompt4.includes(getGuestCtaNotice(4)));

  const prompt0 = buildGuestMessageLimitInstructions(0);
  assert.ok(prompt0.includes('Qonaq mesaj limiti bitib'));
  assert.ok(prompt0.includes(GUEST_EXHAUSTED_MESSAGE));

  // Null or undefined returns empty string
  assert.equal(buildGuestMessageLimitInstructions(null), '');
  assert.equal(buildGuestMessageLimitInstructions(undefined), '');
});

test('Guest message limit: buildAskPrompt includes guest instructions only when isGuest is true', () => {
  const guestPrompt = buildAskPrompt({ isGuest: true, remainingMessages: 3 });
  assert.ok(guestPrompt.includes('QEYDİYYATSIZ') || guestPrompt.includes('Qeydiyyatsız (Qonaq)'));
  assert.ok(guestPrompt.includes('{remaining_messages} = 3'));

  const userPrompt = buildAskPrompt({ isGuest: false, remainingMessages: null });
  assert.ok(!userPrompt.includes('Qeydiyyatsız (Qonaq)'));
  assert.ok(!userPrompt.includes('{remaining_messages}'));
});

test('Guest message limit: AiPolicy accurately counts usage and remaining messages in memory', async () => {
  const policy = new AiPolicy({ redis: null, env: { GUEST_AI_DAILY_LIMIT: '3' } });
  const middleware = policy.middleware();

  const req1 = {
    path: '/api/ask',
    method: 'POST',
    ownerId: 'guest_test_actor_1',
    user: null,
    securityContext: {},
    get: () => 'valid-idempotency-key-1234567890',
  };
  const res1 = Object.assign(new EventEmitter(), { status() { return this; }, json() {} });
  const finish = req => {
    req.securityContext.providerStarted = true;
    res1.emit('finish');
  };

  let nextCalled = false;
  await middleware(req1, res1, () => { nextCalled = true; finish(req1); });
  assert.equal(nextCalled, true);
  assert.equal(req1.guestUsageCount, 1);
  assert.equal(req1.remainingGuestMessages, 2);

  // 2nd request
  const req2 = {
    path: '/api/ask',
    method: 'POST',
    ownerId: 'guest_test_actor_1',
    user: null,
    securityContext: {},
    get: () => 'valid-idempotency-key-1234567891',
  };
  let nextCalled2 = false;
  await middleware(req2, res1, () => { nextCalled2 = true; finish(req2); });
  assert.equal(nextCalled2, true);
  assert.equal(req2.guestUsageCount, 2);
  assert.equal(req2.remainingGuestMessages, 1);

  // 3rd request (last allowed message: remaining becomes 0)
  const req3 = {
    path: '/api/ask',
    method: 'POST',
    ownerId: 'guest_test_actor_1',
    user: null,
    securityContext: {},
    get: () => 'valid-idempotency-key-1234567892',
  };
  let nextCalled3 = false;
  await middleware(req3, res1, () => { nextCalled3 = true; finish(req3); });
  assert.equal(nextCalled3, true);
  assert.equal(req3.guestUsageCount, 3);
  assert.equal(req3.remainingGuestMessages, 0);
  assert.equal(req3.guestMessagesAvailable, 1);

  // 4th request: exceeded daily limit -> 429 GUEST_DAILY_LIMIT
  const req4 = {
    path: '/api/ask',
    method: 'POST',
    ownerId: 'guest_test_actor_1',
    user: null,
    securityContext: {},
    get: () => 'valid-idempotency-key-1234567893',
  };
  let statusCode = null, errorCode = null;
  const res4 = Object.assign(new EventEmitter(), {
    status(code) { statusCode = code; return this; },
    json(body) { errorCode = body?.code; },
  });
  await middleware(req4, res4, () => {});
  res4.emit('finish');
  assert.equal(statusCode, 429);
  assert.equal(errorCode, 'GUEST_DAILY_LIMIT');
});
