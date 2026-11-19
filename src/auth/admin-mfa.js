import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto';
import { generateSecret, generateURI, verifySync } from 'otplib';
import express from 'express';
import { z } from 'zod';
import { hashOpaqueToken, verifyPassword } from './password.js';
import { requireAuth } from '../http/auth-middleware.js';

const proof = z.object({ currentPassword: z.string().min(1).max(128).optional(), reauthToken: z.string().min(32).max(128).optional() }).strict();
const setup = proof.extend({ enrollmentToken: z.string().min(32).max(200) }).strict();
const confirm = z.object({ setupToken: z.string().min(32).max(128), code: z.string().regex(/^\d{6}$/) }).strict();
const challenge = z.object({ code: z.string().min(6).max(100) }).strict();
function key(env) {
  const value = Buffer.from(env.ADMIN_MFA_ENCRYPTION_KEY || '', 'base64');
  if (value.length !== 32) throw Object.assign(new Error('Admin MFA encryption key is not configured'), { status: 503 });
  return value;
}
export function encryptMfaSecret(secret, userId, env = process.env) {
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key(env), iv);
  cipher.setAAD(Buffer.from(userId));
  const body = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), body].map(value => value.toString('base64')).join('.');
}
export function decryptMfaSecret(value, userId, env = process.env) {
  const [iv, tag, body] = value.split('.').map(part => Buffer.from(part, 'base64'));
  const cipher = createDecipheriv('aes-256-gcm', key(env), iv);
  cipher.setAAD(Buffer.from(userId)); cipher.setAuthTag(tag);
  return Buffer.concat([cipher.update(body), cipher.final()]).toString('utf8');
}
export function createAdminMfaRouter({ users, store, adminIds, env = process.env, audit = async () => {} }) {
  const router = express.Router();
  router.use(requireAuth, (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    const isAllowed = Boolean(req.user?.id && adminIds.has(req.user.id));
    if (!isAllowed) return res.status(404).json({ code: 'NOT_FOUND' });
    next();
  });
  const route = fn => (req, res, next) => Promise.resolve().then(async () => {
    const limit = await store.hitRateLimit(`mfa:${req.user.id}`, 8, 300);
    if (!limit.allowed) return res.status(429).json({ code: 'RATE_LIMITED' });
    await fn(req, res);
  }).catch(next);
  async function fresh(req, payload) {
    if (payload.currentPassword) return verifyPassword(req.user.passwordHash, payload.currentPassword);
    if (!payload.reauthToken) return false;
    const token = await store.consumeResetToken(hashOpaqueToken(payload.reauthToken));
    return token?.purpose === 'reauth' && token.userId === req.user.id && token.sessionId === req.auth.sessionId && token.authVersion === (req.user.authVersion || 1);
  }
  router.get('/status', (req, res) => res.json({ enrolled: Boolean(req.user.mfa?.secret), verified: Date.now() - (req.auth.session?.mfaVerifiedAt || 0) < 15 * 60000 }));
  router.post('/setup', route(async (req, res) => {
    const payload = setup.parse(req.body);
    if (req.user.mfa?.secret) return res.status(409).json({ code: 'MFA_ALREADY_ENROLLED' });
    if (!await fresh(req, payload)) return res.status(403).json({ code: 'REAUTH_REQUIRED' });
    let enrollment;
    try { enrollment = JSON.parse(env.ADMIN_MFA_ENROLLMENT_HASHES || '{}')[req.user.id]; } catch {}
    const digest = hashOpaqueToken(payload.enrollmentToken);
    if (!enrollment || !Number.isFinite(enrollment.expiresAt) || enrollment.expiresAt <= Date.now() || typeof enrollment.hash !== 'string' || enrollment.hash.length !== digest.length || !timingSafeEqual(Buffer.from(enrollment.hash), Buffer.from(digest))) return res.status(403).json({ code: 'INVALID_ENROLLMENT_TOKEN' });
    const secret = generateSecret(), setupToken = randomBytes(32).toString('base64url');
    await store.createResetToken(hashOpaqueToken(setupToken), req.user.id, 600, { purpose: 'mfa-setup', sessionId: req.auth.sessionId, secret: encryptMfaSecret(secret, req.user.id, env), enrollmentHash: digest });
    res.json({ setupToken, secret, uri: generateURI({ issuer: 'Helmer', label: req.user.email, secret }) });
  }));
  router.post('/confirm', route(async (req, res) => {
    const payload = confirm.parse(req.body), token = await store.consumeResetToken(hashOpaqueToken(payload.setupToken));
    if (!token || token.userId !== req.user.id || token.sessionId !== req.auth.sessionId || token.purpose !== 'mfa-setup') return res.status(403).json({ code: 'INVALID_MFA_SETUP' });
    const verified = verifySync({ secret: decryptMfaSecret(token.secret, req.user.id, env), token: payload.code, epochTolerance: 30 });
    if (!verified.valid) return res.status(403).json({ code: 'INVALID_MFA_CODE' });
    const recoveryCodes = Array.from({ length: 10 }, () => randomBytes(16).toString('hex'));
    const result = await users.mutateUsers(async state => {
      const user = state.users.find(item => item.id === req.user.id);
      if (!user || user.mfa?.secret || (user.authVersion || 1) !== (req.user.authVersion || 1)) return { store: state, result: false };
      user.mfa = { secret: token.secret, lastTimeStep: verified.timeStep, recoveryHashes: recoveryCodes.map(hashOpaqueToken), enrolledAt: Date.now(), enrollmentHash: token.enrollmentHash };
      return { store: state, result: true };
    });
    if (!result) return res.status(409).json({ code: 'MFA_ALREADY_ENROLLED' });
    await store.updateSession(req.auth.sessionId, { mfaVerifiedAt: Date.now() });
    await audit(req.user.id, 'mfa_enrolled');
    res.json({ ok: true, recoveryCodes });
  }));
  router.post('/challenge', route(async (req, res) => {
    const payload = challenge.parse(req.body);
    const accepted = await users.mutateUsers(async state => {
      const user = state.users.find(item => item.id === req.user.id);
      if (!user?.mfa?.secret || (user.authVersion || 1) !== (req.user.authVersion || 1)) return { store: state, result: false };
      const recovery = hashOpaqueToken(payload.code), index = user.mfa.recoveryHashes.indexOf(recovery);
      if (index >= 0) user.mfa.recoveryHashes.splice(index, 1);
      else {
        if (!/^\d{6}$/.test(payload.code)) return { store: state, result: false };
        const result = verifySync({ secret: decryptMfaSecret(user.mfa.secret, user.id, env), token: payload.code, epochTolerance: 30, afterTimeStep: user.mfa.lastTimeStep });
        if (!result.valid) return { store: state, result: false };
        user.mfa.lastTimeStep = result.timeStep;
      }
      return { store: state, result: true };
    });
    if (!accepted) return res.status(403).json({ code: 'INVALID_MFA_CODE' });
    await store.updateSession(req.auth.sessionId, { mfaVerifiedAt: Date.now() });
    await audit(req.user.id, 'mfa_verified');
    res.json({ ok: true });
  }));
  return router;
}
