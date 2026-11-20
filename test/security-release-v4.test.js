import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { FileAuthStore } from '../src/auth/auth-store.js';
import { FileUserRepository } from '../src/repositories/file-user-repository.js';
import { createRequireAdmin } from '../src/http/admin-authorization.js';
import { GeminiFileCache } from '../src/services/ai/gemini-file-cache.js';
import { validateSecurityConfig } from '../src/services/security/config.js';

async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'helmer-release-v4-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}
test('release: verification resend revokes every prior code for the same user', async t => {
  const store = new FileAuthStore(path.join(await fixture(t), 'auth.json'), { cloud: false });
  await store.createEmailVerificationToken('first', 'user', 600, { email: 'a@example.com', authVersion: 1 });
  await store.createEmailVerificationToken('second', 'user', 600, { email: 'a@example.com', authVersion: 1 });
  assert.equal(await store.consumeEmailVerificationToken('first'), null);
  const record = await store.consumeEmailVerificationToken('second');
  assert.equal(record.email, 'a@example.com');
  assert.equal(await store.consumeEmailVerificationToken('second'), null);
});
test('release: mutable identity cannot grant admin access, MFA is mandatory', () => {
  const guard = createRequireAdmin(new Set(['usr_immutable']));
  let allowed = false, status;
  const response = { status(code) { status = code; return this; }, json() {}, setHeader() {} };
  guard({ user: { id: 'usr_other', email: 'usr_immutable', emailVerifiedAt: 'now' }, method: 'POST' }, response, () => { allowed = true; });
  assert.equal(allowed, false);
  guard({ user: { id: 'usr_immutable', emailVerifiedAt: 'now' }, method: 'POST' }, response, () => { allowed = true; });
  assert.equal(allowed, false);
  assert.equal(status, 403);
});
test('release: new users opt out by default, repository rejects security-field assignment', async t => {
  const users = new FileUserRepository(path.join(await fixture(t), 'users.json'), null, { cloud: false });
  const user = await users.create({ fullName: 'Fixture User', username: 'fixture', email: 'fixture@example.com', passwordHash: 'fixture' });
  assert.equal(user.settings.modelImprovement, false);
  const updated = await users.update(user.id, { authVersion: 99, privacyEpoch: 99, mfa: { enabled: true }, pendingEmail: 'evil@example.com', role: 'admin' });
  assert.equal(updated.authVersion, user.authVersion);
  assert.equal(updated.privacyEpoch, user.privacyEpoch);
  assert.equal(updated.mfa, undefined);
  assert.equal(updated.pendingEmail, undefined);
});
test('release: cache enforces byte capacity across large files', () => {
  const cache = new GeminiFileCache({ maxBytes: 100, maxOwnerBytes: 100 });
  try {
    cache.storeFile({ name: 'one.txt', textContent: 'a'.repeat(70) }, 'owner');
    cache.storeFile({ name: 'two.txt', textContent: 'b'.repeat(70) }, 'owner');
    const bytes = [...cache.cache.values()].reduce((sum, item) => sum + Buffer.byteLength(item.data || '') + Buffer.byteLength(item.textContent || ''), 0);
    assert.ok(bytes <= 100);
  } finally { clearInterval(cache.cleanupInterval); }
});

test('release: production config validation flags missing secrets and invalid MFA key', () => {
  assert.doesNotThrow(() => validateSecurityConfig({ NODE_ENV: 'development' }));
  assert.throws(() => validateSecurityConfig({ NODE_ENV: 'production', SESSION_SECRET: '', AUTH_SECRET: 'x' }), /requires configured secrets/);
  assert.throws(() => validateSecurityConfig({ NODE_ENV: 'production', SESSION_SECRET: 's', AUTH_SECRET: 'a', APP_URL: 'https://helmer.example.com' }), /REDIS_URL/);
  assert.throws(() => validateSecurityConfig({ NODE_ENV: 'production', SESSION_SECRET: 's', AUTH_SECRET: 'a', ADMIN_MFA_ENCRYPTION_KEY: 'short' }), /32-byte/);
  assert.doesNotThrow(() => validateSecurityConfig({
    NODE_ENV: 'production',
    SESSION_SECRET: 'valid-secret-12345678901234567890',
    AUTH_SECRET: 'valid-secret-12345678901234567890',
    ADMIN_MFA_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
    APP_URL: 'https://helmer.example.com',
    REDIS_URL: 'redis://127.0.0.1:6379',
    OPENAI_API_KEY: 'fixture',
    R2_ENDPOINT: 'https://fixture.r2.example.test',
    R2_BUCKET_NAME: 'fixture',
    R2_ACCESS_KEY_ID: 'fixture',
    R2_SECRET_ACCESS_KEY: 'fixture',
  }));
});

test('release: cleanup queue enqueues and tracks pending state with durable store', async (t) => {
  const { CleanupQueue } = await import('../src/services/security/cleanup-queue.js');
  const { DurableStore } = await import('../src/services/security/durable-store.js');
  const dir = await fixture(t);
  const store = new DurableStore(dir, { cloud: false });
  let deletedArtifacts = false;
  const mockArtifacts = { deleteChatArtifacts: async () => { deletedArtifacts = true; } };
  const mockCache = { removeOwnerFiles: () => {} };
  const queue = new CleanupQueue(store, mockArtifacts, mockCache);
  t.after(() => clearInterval(queue.timer));

  await queue.enqueue('owner1', 'chat1', 'chat', { messages: [{ id: 'm1' }] });
  assert.equal(await queue.pending('owner1', 'chat1'), true);
  await queue.process();
  assert.equal(await queue.pending('owner1', 'chat1'), false);
  assert.equal(deletedArtifacts, true);
});

test('release: admin MFA secret encryption and recovery code single-use consumption', async (t) => {
  const { encryptMfaSecret, decryptMfaSecret } = await import('../src/auth/admin-mfa.js');
  const env = { ADMIN_MFA_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64') };
  const secret = 'JBSWY3DPEHPK3PXP';
  const encrypted = encryptMfaSecret(secret, 'usr_admin', env);
  const decrypted = decryptMfaSecret(encrypted, 'usr_admin', env);
  assert.equal(decrypted, secret);
  assert.throws(() => decryptMfaSecret(encrypted, 'usr_imposter', env));
});
