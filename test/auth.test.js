import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import express from "express";
import { hashOpaqueToken, hashPassword, verifyPassword } from "../src/auth/password.js";
import { FileAuthStore } from "../src/auth/auth-store.js";
import { SignupSchema, AccountUpdateSchema, GoogleOAuthAuthorizeSchema, GoogleOAuthCallbackSchema, normalizeEmail, normalizeUsername } from "../src/auth/validation.js";
import { createIdentityMiddleware, requireAuth } from "../src/http/auth-middleware.js";
import { guestSession, resolveGuestSecret } from "../src/http/session.js";
import {
  authErrorHandler,
  computeCodeChallenge,
  createAuthRouter,
  generateCodeVerifier,
  sanitizeReturnTo,
  verifyPkceChallenge,
} from "../src/http/auth-router.js";
import { migrateAuthUserStore } from "../src/repositories/auth-store-migrations.js";
import { FileUserRepository } from "../src/repositories/file-user-repository.js";

test("auth normalization, validation, and Argon2id hashing", async () => {
  assert.equal(normalizeUsername("  Market.Lead_1 "), "market.lead_1");
  assert.equal(normalizeEmail("  USER@Example.COM "), "user@example.com");
  assert.equal(SignupSchema.safeParse({ fullName: "Test User", username: "ok_user", email: "a@b.co", password: "strongpass1" }).success, true);
  assert.equal(SignupSchema.safeParse({ fullName: "Test User", username: "admin", email: "a@b.co", password: "strongpass1" }).success, false);
  assert.equal(SignupSchema.safeParse({ fullName: "Test User", username: ".leading", email: "a@b.co", password: "strongpass1" }).success, false);
  assert.equal(SignupSchema.safeParse({ fullName: "Test User", username: "double..dot", email: "a@b.co", password: "strongpass1" }).success, false);
  const hash = await hashPassword("strongpass1");
  assert.match(hash, /^\$argon2id\$/);
  assert.equal(await verifyPassword(hash, "strongpass1"), true);
  assert.equal(await verifyPassword(hash, "wrongpass1"), false);
});

test("user store migration and uniqueness are deterministic", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "helmer-users-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  assert.deepEqual(migrateAuthUserStore([]), { schemaVersion: 3, users: [] });
  assert.deepEqual(
    migrateAuthUserStore({ schemaVersion: 1, users: [{ id: "legacy" }] }).users[0].settings,
    {
      personalIntelligence: false,
      brandName: "",
      industry: "",
      targetAudience: "",
      primaryMarket: "",
      tone: "professional",
      customInstructions: "",
      memories: [],
      autoContext: true,
      strategyPersonalization: true,
      defaultMode: "build",
      language: "az",
    },
  );
  const repository = new FileUserRepository(path.join(directory, "users.json"));
  const passwordHash = await hashPassword("strongpass1");
  await repository.create({ fullName: "Test User", username: "Test.User", email: "TEST@example.com", passwordHash });
  await assert.rejects(
    repository.create({ fullName: "Other", username: "test.user", email: "other@example.com", passwordHash }),
    (error) => error.code === "USER_CONFLICT" && error.field === "username",
  );
  await assert.rejects(
    repository.create({ fullName: "Other", username: "other", email: "test@EXAMPLE.com", passwordHash }),
    (error) => error.code === "USER_CONFLICT" && error.field === "email",
  );
});

test("guest session creates a stable anonymous workspace owner", async (t) => {
  const app = express();
  app.use(guestSession);
  app.get("/workspace", (req, res) => res.json({ ownerId: req.ownerId }));
  const server = app.listen(0, "127.0.0.1");
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  const first = await fetch(`${base}/workspace`);
  assert.equal(first.status, 200);
  const firstOwner = (await first.json()).ownerId;
  assert.match(firstOwner, /^guest_[0-9a-f-]{36}$/i);
  const cookie = first.headers.get("set-cookie").split(";")[0];

  const returning = await fetch(`${base}/workspace`, { headers: { Cookie: cookie } });
  assert.equal((await returning.json()).ownerId, firstOwner);

  // Forged unsigned cookie must be rejected and replaced with a new generated ID
  const forged = await fetch(`${base}/workspace`, { headers: { Cookie: "helmer_guest=guest_11111111-2222-3333-4444-555555555555" } });
  assert.notEqual((await forged.json()).ownerId, "guest_11111111-2222-3333-4444-555555555555");
});

test("signup, session, login, reset, and single-use reset token work end to end", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "helmer-auth-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const users = new FileUserRepository(path.join(directory, "users.json"));
  const store = new FileAuthStore(path.join(directory, "sessions.json"));
  const sent = [];
  const verificationMessages = [];
  const emailService = {
    sendPasswordResetEmail: async (message) => sent.push(message),
    sendEmailVerificationCode: async (message) => verificationMessages.push(message),
  };
  const app = express();
  app.use(express.json());
  app.use(createIdentityMiddleware({ authStore: store, userRepository: users }));
  app.use("/api/auth", createAuthRouter({
    userRepository: users,
    authStore: store,
    emailService,
    strategyRepository: { claimOwner: async () => 0 },
    appUrl: "http://localhost",
  }));
  app.get("/protected", requireAuth, (req, res) => res.json({ ownerId: req.ownerId }));
  app.use(authErrorHandler);
  const server = app.listen(0, "127.0.0.1");
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  const blocked = await fetch(`${base}/protected`);
  assert.equal(blocked.status, 401);

  const invalidSignup = await fetch(`${base}/api/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fullName: "M", username: "x", email: "invalid", password: "weak" }),
  });
  assert.equal(invalidSignup.status, 400);

  const signup = await fetch(`${base}/api/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fullName: "Market Lead", username: "market.lead", email: "lead@example.com", password: "strongpass1" }),
  });
  assert.equal(signup.status, 201);
  const created = await signup.json();
  assert.equal(created.verificationRequired, true);
  assert.equal(created.email, "lead@example.com");
  assert.equal(verificationMessages.length, 1);

  const verification = await fetch(`${base}/api/auth/email-verification/confirm`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "lead@example.com", code: verificationMessages[0].code }),
  });
  assert.equal(verification.status, 200);
  const cookie = verification.headers.get("set-cookie").split(";")[0];
  const verified = await verification.json();
  assert.equal(verified.user.username, "market.lead");
  assert.equal(verified.user.settings.personalIntelligence, false);
  assert.equal("passwordHash" in verified.user, false);

  const enabledSettings = await fetch(`${base}/api/auth/settings`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ personalIntelligence: true, defaultMode: "ask" }),
  });
  assert.equal(enabledSettings.status, 200);
  assert.equal((await enabledSettings.json()).user.settings.personalIntelligence, true);
  const refreshedMe = await fetch(`${base}/api/auth/me`, { headers: { Cookie: cookie } });
  const meJson = await refreshedMe.json();
  assert.equal(meJson.user.settings.personalIntelligence, true);
  assert.equal(meJson.user.settings.defaultMode, "ask");

  const importRes = await fetch(`${base}/api/auth/settings/import-memory`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({
      brandName: "Helmer",
      industry: "B2B SaaS",
      primaryMarket: "Azərbaycan",
      targetAudience: "Startaplar və marketoloqlar",
      tone: "creative",
      customInstructions: "Qısa və icra yönümlü ol.",
      memories: [
        { text: "Biz yalnız B2B şirkətlərlə işləyirik.", category: "business" },
        { text: "TV və radio reklamlarından istifadə etmirik.", category: "constraint" },
      ],
      mergeMode: "merge",
      enablePersonalIntelligence: true,
    }),
  });
  assert.equal(importRes.status, 200);
  const importJson = await importRes.json();
  assert.equal(importJson.ok, true);
  assert.equal(importJson.importedCount, 2);
  assert.equal(importJson.user.settings.brandName, "Helmer");
  assert.equal(importJson.user.settings.tone, "creative");
  assert.equal(importJson.user.settings.memories.length, 2);
  assert.equal(importJson.user.settings.personalIntelligence, true);

  const unauthenticatedSettings = await fetch(`${base}/api/auth/settings`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ personalIntelligence: true }),
  });
  assert.equal(unauthenticatedSettings.status, 401);

  const duplicateSignup = await fetch(`${base}/api/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fullName: "Other", username: "MARKET.LEAD", email: "other@example.com", password: "strongpass1" }),
  });
  assert.equal(duplicateSignup.status, 409);

  const me = await fetch(`${base}/api/auth/me`, { headers: { Cookie: cookie } });
  assert.equal(me.status, 200);
  assert.equal((await me.json()).user.email, "lead@example.com");
  const protectedResponse = await fetch(`${base}/protected`, { headers: { Cookie: cookie } });
  assert.equal(protectedResponse.status, 200);

  const wrongLogin = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier: "market.lead", password: "incorrect1" }),
  });
  assert.equal(wrongLogin.status, 401);
  assert.equal((await wrongLogin.json()).error, "E-poçt/istifadəçi adı və ya şifrə yanlışdır.");

  const usernameLogin = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier: "MARKET.LEAD", password: "strongpass1" }),
  });
  assert.equal(usernameLogin.status, 200);
  const usernameCookie = usernameLogin.headers.get("set-cookie").split(";")[0];
  const logout = await fetch(`${base}/api/auth/logout`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: usernameCookie },
    body: "{}",
  });
  assert.equal(logout.status, 204);
  assert.equal((await fetch(`${base}/api/auth/me`, { headers: { Cookie: usernameCookie } })).status, 401);

  const emailLogin = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier: "LEAD@example.com", password: "strongpass1" }),
  });
  assert.equal(emailLogin.status, 200);
  const otherSessionCookie = emailLogin.headers.get("set-cookie").split(";")[0];

  const wrongChange = await fetch(`${base}/api/auth/change-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ currentPassword: "wrongpass1", newPassword: "changedpass2" }),
  });
  assert.equal(wrongChange.status, 400);
  const changed = await fetch(`${base}/api/auth/change-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ currentPassword: "strongpass1", newPassword: "changedpass2" }),
  });
  assert.equal(changed.status, 200);
  assert.equal((await fetch(`${base}/api/auth/me`, { headers: { Cookie: otherSessionCookie } })).status, 401);
  const oldPasswordLogin = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier: "market.lead", password: "strongpass1" }),
  });
  assert.equal(oldPasswordLogin.status, 401);

  const changedPasswordLogin = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier: "lead@example.com", password: "changedpass2" }),
  });
  assert.equal(changedPasswordLogin.status, 200);
  const changedPasswordCookie = changedPasswordLogin.headers.get("set-cookie").split(";")[0];

  const unknownForgot = await fetch(`${base}/api/auth/forgot-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "missing@example.com" }),
  });
  const unknownForgotBody = await unknownForgot.json();
  assert.equal(unknownForgot.status, 200);

  const expiredRawToken = "expired-reset-token-value-1234567890";
  await store.createResetToken(hashOpaqueToken(expiredRawToken), verified.user.id, -1);
  const expiredReset = await fetch(`${base}/api/auth/reset-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: expiredRawToken, password: "newstrongpass2" }),
  });
  assert.equal(expiredReset.status, 400);

  const forgot = await fetch(`${base}/api/auth/forgot-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "lead@example.com" }),
  });
  assert.equal(forgot.status, 200);
  assert.equal((await forgot.json()).message, unknownForgotBody.message);
  assert.equal(sent.length, 1);
  const token = new URL(sent[0].resetUrl).searchParams.get("token");
  assert.ok(token);

  const reset = await fetch(`${base}/api/auth/reset-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, password: "newstrongpass2" }),
  });
  assert.equal(reset.status, 200);
  const reused = await fetch(`${base}/api/auth/reset-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, password: "anotherpass3" }),
  });
  assert.equal(reused.status, 400);
  const expiredSession = await fetch(`${base}/api/auth/me`, { headers: { Cookie: cookie } });
  assert.equal(expiredSession.status, 401);
  assert.equal((await fetch(`${base}/api/auth/me`, { headers: { Cookie: changedPasswordCookie } })).status, 401);

  const login = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier: "LEAD@example.com", password: "newstrongpass2" }),
  });
  assert.equal(login.status, 200);

  const configRes = await fetch(`${base}/api/auth/config`);
  assert.equal(configRes.status, 200);
  const configData = await configRes.json();
  assert.ok("googleClientId" in configData);

  const missingGoogleCred = await fetch(`${base}/api/auth/google`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  assert.equal(missingGoogleCred.status, 400);

  const invalidGoogleCred = await fetch(`${base}/api/auth/google`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ credential: "invalid.jwt.token", nonce: "n".repeat(43) }),
  });
  assert.ok([401, 503].includes(invalidGoogleCred.status));
});

test("SEC-07: resolveGuestSecret enforces SESSION_SECRET in production mode", () => {
  // 1. In production mode without secret -> throws fatal error
  assert.throws(
    () => resolveGuestSecret({ NODE_ENV: "production" }),
    /Fatal: SESSION_SECRET or AUTH_SECRET environment variable is required in production mode/,
  );
  assert.throws(
    () => resolveGuestSecret({ NODE_ENV: "production", SESSION_SECRET: "   " }),
    /Fatal: SESSION_SECRET or AUTH_SECRET environment variable is required in production mode/,
  );

  // 2. In production mode with valid secret -> returns secret
  assert.equal(
    resolveGuestSecret({ NODE_ENV: "production", SESSION_SECRET: "my_strong_production_secret" }),
    "my_strong_production_secret",
  );
  assert.equal(
    resolveGuestSecret({ NODE_ENV: "production", AUTH_SECRET: "my_auth_secret" }),
    "my_auth_secret",
  );

  // 3. In development/test mode without secret -> returns safe fallback key
  assert.equal(
    resolveGuestSecret({ NODE_ENV: "development" }),
    "helmer_guest_hmac_secret_fallback_key",
  );
  assert.equal(
    resolveGuestSecret({ NODE_ENV: "test" }),
    "helmer_guest_hmac_secret_fallback_key",
  );
});

test("SEC-08: FileUserRepository resets emailVerifiedAt on email change and defends against mass assignment", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "helmer-sec08-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const users = new FileUserRepository(path.join(directory, "users.json"));

  // 1. Create a verified user
  const created = await users.create({
    fullName: "Verified User",
    username: "verified_user",
    email: "original@example.com",
    passwordHash: "hash_original",
    emailVerifiedAt: "2026-09-01T12:00:00.000Z",
  });
  assert.equal(created.emailVerifiedAt, "2026-09-01T12:00:00.000Z");

  // 2. Updating name or username keeps emailVerifiedAt intact
  const updatedName = await users.update(created.id, { fullName: "New Full Name" });
  assert.equal(updatedName.fullName, "New Full Name");
  assert.equal(updatedName.emailVerifiedAt, "2026-09-01T12:00:00.000Z");

  // 3. Updating email to a new address automatically resets emailVerifiedAt to null
  const updatedEmail = await users.update(created.id, { email: "newemail@example.com" });
  assert.equal(updatedEmail.email, "newemail@example.com");
  assert.equal(updatedEmail.emailVerifiedAt, null);

  // 4. Defense-in-depth: attempts to overwrite immutable/sensitive fields (id, createdAt, passwordHash, role) are blocked
  const originalId = created.id;
  const originalCreatedAt = created.createdAt;
  const tamperAttempt = await users.update(created.id, {
    id: "usr_tampered_id",
    createdAt: "1990-01-01T00:00:00.000Z",
    passwordHash: "malicious_injected_hash",
    role: "superadmin",
    fullName: "Tampered Name",
  });
  assert.equal(tamperAttempt.id, originalId);
  assert.equal(tamperAttempt.createdAt, originalCreatedAt);
  assert.equal(tamperAttempt.passwordHash, "hash_original");
  assert.equal(tamperAttempt.role, undefined);
  assert.equal(tamperAttempt.fullName, "Tampered Name");

  // 5. updatePassword works through its dedicated safe method
  const passwordUpdated = await users.updatePassword(created.id, "new_secure_hash");
  assert.equal(passwordUpdated.passwordHash, "new_secure_hash");

  // 6. AccountUpdateSchema strict mode rejects unexpected properties
  const validPayload = { fullName: "Test Name", username: "validname", email: "val@example.com" };
  assert.equal(AccountUpdateSchema.safeParse(validPayload).success, true);
  assert.equal(AccountUpdateSchema.safeParse({ ...validPayload, role: "admin" }).success, false);
  assert.equal(AccountUpdateSchema.safeParse({ ...validPayload, passwordHash: "hacked" }).success, false);
});

test("Google OAuth 2.0 / OIDC PKCE (S256), state binding, token validation, and open-redirect defense", async (t) => {
  const verifier = generateCodeVerifier();
  const challenge = computeCodeChallenge(verifier);
  assert.equal(verifyPkceChallenge(verifier, challenge), true);
  assert.equal(verifyPkceChallenge(`${verifier}x`, challenge), false);
  assert.equal(verifyPkceChallenge("short", challenge), false);

  assert.equal(sanitizeReturnTo("/workspace?mode=ask"), "/workspace?mode=ask");
  assert.equal(sanitizeReturnTo("/profile"), "/profile");
  assert.equal(sanitizeReturnTo("//evil.example.com/phish"), "/workspace");
  assert.equal(sanitizeReturnTo("https://evil.example.com"), "/workspace");
  assert.equal(sanitizeReturnTo("/login"), "/workspace");
  assert.equal(sanitizeReturnTo("/api/auth/logout"), "/workspace");

  assert.equal(GoogleOAuthAuthorizeSchema.safeParse({ returnTo: "/workspace", extra: 1 }).success, false);
  assert.equal(GoogleOAuthCallbackSchema.safeParse({ code: "abc", state: "s".repeat(43), injected: true }).success, false);

  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "helmer-google-pkce-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const users = new FileUserRepository(path.join(directory, "users.json"));
  const store = new FileAuthStore(path.join(directory, "sessions.json"));

  const originalClientId = process.env.GOOGLE_CLIENT_ID;
  process.env.GOOGLE_CLIENT_ID = "test-google-client-id.apps.googleusercontent.com";
  t.after(() => {
    if (originalClientId === undefined) delete process.env.GOOGLE_CLIENT_ID;
    else process.env.GOOGLE_CLIENT_ID = originalClientId;
  });

  let lastGeneratedAuthOpts = null;
  let lastTokenExchangeOpts = null;
  let mockIdTokenPayload = null;

  const mockGoogleClient = {
    generateAuthUrl(opts) {
      lastGeneratedAuthOpts = opts;
      const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      for (const [k, v] of Object.entries(opts)) {
        if (v !== undefined) url.searchParams.set(k, Array.isArray(v) ? v.join(" ") : String(v));
      }
      return url.toString();
    },
    async getToken(opts) {
      lastTokenExchangeOpts = opts;
      if (opts.code === "invalid_code") throw new Error("invalid_grant");
      return { tokens: { id_token: "mock.valid.id_token" } };
    },
    async verifyIdToken({ idToken, audience }) {
      assert.equal(audience, "test-google-client-id.apps.googleusercontent.com");
      if (idToken !== "mock.valid.id_token") throw new Error("Invalid token");
      return {
        getPayload: () => mockIdTokenPayload,
      };
    },
  };

  let claimedGuestFrom = null;
  let claimedGuestTo = null;
  const app = express();
  app.use(guestSession);
  app.use(express.json());
  app.use(createIdentityMiddleware({ authStore: store, userRepository: users }));
  app.use("/api/auth", createAuthRouter({
    userRepository: users,
    authStore: store,
    emailService: { sendPasswordResetEmail: async () => {}, sendEmailVerificationCode: async () => {} },
    strategyRepository: {
      claimOwner: async (fromId, toId) => {
        claimedGuestFrom = fromId;
        claimedGuestTo = toId;
      },
    },
    appUrl: "http://localhost:8080",
    googleClient: mockGoogleClient,
  }));
  app.use(authErrorHandler);

  const server = app.listen(0, "127.0.0.1");
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  // 1. Client-supplied PKCE flow (POST /api/auth/google/authorize -> POST /api/auth/google/callback)
  const clientVerifier = generateCodeVerifier();
  const clientChallenge = computeCodeChallenge(clientVerifier);

  const authInitRes = await fetch(`${base}/api/auth/google/authorize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      returnTo: "/profile",
      codeChallenge: clientChallenge,
      codeChallengeMethod: "S256",
    }),
  });
  assert.equal(authInitRes.status, 200);
  const setCookies = authInitRes.headers.getSetCookie ? authInitRes.headers.getSetCookie() : [authInitRes.headers.get("set-cookie")];
  const cookieHeader = setCookies.map((c) => c.split(";")[0]).join("; ");
  assert.ok(cookieHeader.includes("helmer_oauth_state="), "Must set HttpOnly helmer_oauth_state binding cookie");

  const authInitData = await authInitRes.json();
  assert.equal(authInitData.codeChallenge, clientChallenge);
  assert.equal(authInitData.codeChallengeMethod, "S256");
  assert.ok(authInitData.state.length >= 32);
  assert.equal(lastGeneratedAuthOpts.code_challenge, clientChallenge);
  assert.equal(lastGeneratedAuthOpts.code_challenge_method, "S256");

  // 2. Attack: Callback with wrong PKCE code_verifier must fail with 401 INVALID_GOOGLE_PKCE
  const wrongPkceRes = await fetch(`${base}/api/auth/google/callback`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookieHeader },
    body: JSON.stringify({
      code: "valid_auth_code",
      state: authInitData.state,
      codeVerifier: generateCodeVerifier(),
    }),
  });
  assert.equal(wrongPkceRes.status, 401);
  assert.equal((await wrongPkceRes.json()).code, "INVALID_GOOGLE_PKCE");

  // 3. Replaying consumed state must fail with 401 INVALID_GOOGLE_STATE
  const replayStateRes = await fetch(`${base}/api/auth/google/callback`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookieHeader },
    body: JSON.stringify({
      code: "valid_auth_code",
      state: authInitData.state,
      codeVerifier: clientVerifier,
    }),
  });
  assert.equal(replayStateRes.status, 401);
  assert.equal((await replayStateRes.json()).code, "INVALID_GOOGLE_STATE");

  // 4. Server-managed PKCE redirect flow (GET /api/auth/google/authorize -> GET /api/auth/google/callback)
  const redirectInit = await fetch(`${base}/api/auth/google/authorize?returnTo=%2Fprofile`, {
    redirect: "manual",
  });
  assert.equal(redirectInit.status, 302);
  const redirectCookies = (redirectInit.headers.getSetCookie ? redirectInit.headers.getSetCookie() : [redirectInit.headers.get("set-cookie")])
    .map((c) => c.split(";")[0])
    .join("; ");
  const googleAuthUrl = new URL(redirectInit.headers.get("location"));
  const redirectState = googleAuthUrl.searchParams.get("state");
  const redirectNonce = googleAuthUrl.searchParams.get("nonce");
  assert.equal(googleAuthUrl.searchParams.get("code_challenge_method"), "S256");
  assert.ok(googleAuthUrl.searchParams.get("code_challenge")?.length >= 43);

  mockIdTokenPayload = {
    iss: "https://accounts.google.com",
    sub: "google_sub_987654321",
    email: "oauth.user@example.com",
    email_verified: true,
    name: "OAuth Leader",
    picture: "https://lh3.googleusercontent.com/a/default-user",
    nonce: redirectNonce,
  };

  const callbackRes = await fetch(
    `${base}/api/auth/google/callback?code=valid_code_123&state=${encodeURIComponent(redirectState)}`,
    {
      redirect: "manual",
      headers: { Cookie: redirectCookies },
    },
  );
  assert.equal(callbackRes.status, 302);
  assert.equal(callbackRes.headers.get("location"), "/profile");
  assert.ok(lastTokenExchangeOpts?.codeVerifier?.length >= 43, "Server must send PKCE codeVerifier during token exchange");

  const callbackCookies = (callbackRes.headers.getSetCookie ? callbackRes.headers.getSetCookie() : [callbackRes.headers.get("set-cookie")])
    .map((c) => c.split(";")[0]);
  const sessionCookie = callbackCookies.find((c) => c.startsWith("helmer_session="));
  assert.ok(sessionCookie, "Callback must issue helmer_session cookie");
  assert.ok(claimedGuestFrom && claimedGuestTo, "Guest workspace data must be claimed by authenticated user");

  // 5. Verify profile via GET /api/auth/profile and update via PATCH /api/auth/profile
  const profileGet = await fetch(`${base}/api/auth/profile`, {
    headers: { Cookie: sessionCookie },
  });
  assert.equal(profileGet.status, 200);
  const profileJson = await profileGet.json();
  assert.equal(profileJson.user.email, "oauth.user@example.com");
  assert.equal(profileJson.user.hasGoogleAuth, true);

  const profilePatch = await fetch(`${base}/api/auth/profile`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Cookie: sessionCookie },
    body: JSON.stringify({
      fullName: "Updated OAuth Leader",
      username: "oauth_leader",
      email: "oauth.user@example.com",
    }),
  });
  assert.equal(profilePatch.status, 200);
  const patchedUser = (await profilePatch.json()).user;
  assert.equal(patchedUser.fullName, "Updated OAuth Leader");
  assert.equal(patchedUser.username, "oauth_leader");

  // 6. Verify POST /api/auth/logout-all revokes other sessions while keeping current session active
  const secondSessionId = hashOpaqueToken("second_device_raw_token_1234567890");
  await store.createSession(secondSessionId, patchedUser.id, 3600, { authVersion: 1 });
  assert.ok(await store.getSession(secondSessionId));

  const logoutAllRes = await fetch(`${base}/api/auth/logout-all`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: sessionCookie },
    body: "{}",
  });
  assert.equal(logoutAllRes.status, 200);
  assert.equal(await store.getSession(secondSessionId), null, "Other device session must be revoked");
  const currentStillActive = await fetch(`${base}/api/auth/profile`, {
    headers: { Cookie: sessionCookie },
  });
  assert.equal(currentStillActive.status, 200, "Current device session must remain active");

  // 7. Attack: OIDC ID token missing nonce claim must be rejected with 401 INVALID_GOOGLE_NONCE
  const noNonceInit = await fetch(`${base}/api/auth/google/authorize?format=json`);
  assert.equal(noNonceInit.status, 200);
  const noNonceCookies = (noNonceInit.headers.getSetCookie ? noNonceInit.headers.getSetCookie() : [noNonceInit.headers.get("set-cookie")])
    .map((c) => c.split(";")[0])
    .join("; ");
  const noNonceData = await noNonceInit.json();
  mockIdTokenPayload = {
    iss: "https://accounts.google.com",
    sub: "google_sub_987654321",
    email: "oauth.user@example.com",
    email_verified: true,
    name: "OAuth Leader",
    // nonce intentionally omitted
  };
  const noNonceCallback = await fetch(`${base}/api/auth/google/callback?format=json&code=valid_code_123&state=${encodeURIComponent(noNonceData.state)}`, {
    headers: { Cookie: noNonceCookies },
  });
  assert.equal(noNonceCallback.status, 401);
  assert.equal((await noNonceCallback.json()).code, "INVALID_GOOGLE_NONCE");

  // 8. Existing Google Identity Services (GIS) flow: POST /api/auth/google/nonce -> POST /api/auth/google -> auto-profile, session, reauth, logout, re-login
  const gisNonceRes1 = await fetch(`${base}/api/auth/google/nonce`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  assert.equal(gisNonceRes1.status, 200);
  const gisGuestCookie = (gisNonceRes1.headers.getSetCookie ? gisNonceRes1.headers.getSetCookie() : [gisNonceRes1.headers.get("set-cookie")])
    .map((c) => c.split(";")[0])
    .join("; ");
  const { nonce: gisNonce1 } = await gisNonceRes1.json();
  assert.ok(gisNonce1 && gisNonce1.length >= 32);

  mockIdTokenPayload = {
    iss: "https://accounts.google.com",
    sub: "google_gis_sub_555666",
    email: "gis.leader@example.com",
    email_verified: true,
    name: "GIS Leader",
    picture: "https://lh3.googleusercontent.com/a/gis-leader",
    nonce: gisNonce1,
  };

  const gisSignupRes = await fetch(`${base}/api/auth/google`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: gisGuestCookie },
    body: JSON.stringify({
      credential: "mock.valid.id_token",
      nonce: gisNonce1,
    }),
  });
  assert.equal(gisSignupRes.status, 200);
  const gisSignupBody = await gisSignupRes.json();
  assert.equal(gisSignupBody.user.email, "gis.leader@example.com");
  assert.equal(gisSignupBody.user.fullName, "GIS Leader");
  assert.equal(gisSignupBody.user.hasGoogleAuth, true);
  assert.equal(gisSignupBody.user.emailVerified, true);

  const gisSessionCookie = (gisSignupRes.headers.getSetCookie ? gisSignupRes.headers.getSetCookie() : [gisSignupRes.headers.get("set-cookie")])
    .map((c) => c.split(";")[0])
    .find((c) => c.startsWith("helmer_session="));
  assert.ok(gisSessionCookie, "POST /api/auth/google must set helmer_session cookie");

  // Re-authenticate with Google via POST /api/auth/reauth
  const reauthNonceRes = await fetch(`${base}/api/auth/google/nonce`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: `${gisGuestCookie}; ${gisSessionCookie}` },
    body: "{}",
  });
  const { nonce: reauthNonce } = await reauthNonceRes.json();
  mockIdTokenPayload.nonce = reauthNonce;
  const reauthRes = await fetch(`${base}/api/auth/reauth`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: `${gisGuestCookie}; ${gisSessionCookie}` },
    body: JSON.stringify({ credential: "mock.valid.id_token", nonce: reauthNonce }),
  });
  assert.equal(reauthRes.status, 200);
  const { reauthToken } = await reauthRes.json();
  assert.ok(reauthToken);

  // Logout and re-login with the same helmer_guest cookie via Google GIS
  const gisLogoutRes = await fetch(`${base}/api/auth/logout`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: `${gisGuestCookie}; ${gisSessionCookie}` },
    body: "{}",
  });
  assert.equal(gisLogoutRes.status, 204);
  assert.equal((await fetch(`${base}/api/auth/me`, { headers: { Cookie: gisSessionCookie } })).status, 401);

  const gisNonceRes2 = await fetch(`${base}/api/auth/google/nonce`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: gisGuestCookie },
    body: "{}",
  });
  const { nonce: gisNonce2 } = await gisNonceRes2.json();
  mockIdTokenPayload.nonce = gisNonce2;

  const gisReloginRes = await fetch(`${base}/api/auth/google`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: gisGuestCookie },
    body: JSON.stringify({ credential: "mock.valid.id_token", nonce: gisNonce2 }),
  });
  assert.equal(gisReloginRes.status, 200);
  assert.equal((await gisReloginRes.json()).user.id, gisSignupBody.user.id, "Re-login with Google must resolve the existing user account");
});

test("Cloud Run multi-replica FileUserRepository force revalidation prevents stale authVersion session deletion", async (t) => {
  const dirA = await fs.mkdtemp(path.join(os.tmpdir(), "helmer-replica-a-"));
  const dirB = await fs.mkdtemp(path.join(os.tmpdir(), "helmer-replica-b-"));
  t.after(async () => {
    await fs.rm(dirA, { recursive: true, force: true });
    await fs.rm(dirB, { recursive: true, force: true });
  });

  let cloudRecord = null;
  let cloudEtag = null;
  let cachedReplicaBRecord = null;

  // Simulate Replica B having a 10-second cached read unless { force: true } is passed
  const readCloudReplicaB = async ({ force = false } = {}) => {
    if (!force && cachedReplicaBRecord) {
      return { record: structuredClone(cachedReplicaBRecord), etag: '"etag-v1"', notFound: false, isCloud: true };
    }
    cachedReplicaBRecord = cloudRecord ? structuredClone(cloudRecord) : null;
    return { record: cachedReplicaBRecord ? structuredClone(cachedReplicaBRecord) : null, etag: cloudEtag, notFound: !cloudRecord, isCloud: true };
  };

  const writeCloudShared = async (record, etag) => {
    if (cloudEtag && etag !== cloudEtag) return false;
    cloudRecord = structuredClone(record);
    cloudEtag = `"etag-${Date.now()}-${Math.random()}"`;
    return true;
  };

  const repoA = new FileUserRepository(path.join(dirA, "users.json"), null, {
    cloud: true,
    readCloud: async () => ({ record: cloudRecord ? structuredClone(cloudRecord) : null, etag: cloudEtag, notFound: !cloudRecord, isCloud: true }),
    writeCloud: writeCloudShared,
  });
  const repoB = new FileUserRepository(path.join(dirB, "users.json"), null, {
    cloud: true,
    readCloud: readCloudReplicaB,
    writeCloud: writeCloudShared,
  });
  const sharedAuthStore = new FileAuthStore(path.join(dirA, "sessions.json"));

  const passwordHash = await hashPassword("strongpass1");
  const user = await repoA.create({
    fullName: "Cloud User",
    username: "cloud_user",
    email: "cloud@example.com",
    passwordHash,
    emailVerifiedAt: new Date().toISOString(),
  });

  // Warm Replica B cache at authVersion=1
  await repoB.readStore();
  assert.equal((await repoB.findById(user.id)).authVersion, 1);

  // Replica A rotates password -> increments authVersion to 2 and creates new session
  const updatedOnA = await repoA.updatePassword(user.id, await hashPassword("newstrongpass2"));
  assert.equal(updatedOnA.authVersion, 2);

  const rawSessionToken = "replica_a_new_session_token_1234567890123456";
  const sessionId = hashOpaqueToken(rawSessionToken);
  await sharedAuthStore.createSession(sessionId, user.id, 3600, { authVersion: 2 });

  // Request hits Replica B while Replica B still has authVersion=1 in its local cache
  const appB = express();
  appB.use(createIdentityMiddleware({ authStore: sharedAuthStore, userRepository: repoB }));
  appB.get("/me", requireAuth, (req, res) => res.json({ id: req.user.id, authVersion: req.user.authVersion }));
  const serverB = appB.listen(0, "127.0.0.1");
  t.after(() => new Promise((resolve) => serverB.close(resolve)));
  await new Promise((resolve) => serverB.once("listening", resolve));

  const resB = await fetch(`http://127.0.0.1:${serverB.address().port}/me`, {
    headers: { Cookie: `helmer_session=${rawSessionToken}` },
  });
  assert.equal(resB.status, 200, "Replica B must force-revalidate from cloud and accept the v2 session");
  const bodyB = await resB.json();
  assert.equal(bodyB.authVersion, 2);
  assert.ok(await sharedAuthStore.getSession(sessionId), "Session must not be deleted by stale replica");
});

test("Regression 1: Account A -> Logout -> Account B ensures complete frontend and backend workspace data isolation and blocks stale async writes", async (t) => {
  const vm = await import("node:vm");
  const scriptSource = await fs.readFile(path.join(process.cwd(), "public/script.js"), "utf8");
  const authSource = await fs.readFile(path.join(process.cwd(), "public/auth.js"), "utf8");

  // Verify auth.js dispatches helmer:logout before awaiting network logout and disables Google auto-select
  assert.ok(authSource.includes('window.dispatchEvent(new CustomEvent("helmer:logout"))'), "auth.js must dispatch helmer:logout");
  assert.ok(authSource.includes('sessionStorage.removeItem("helmer_active_ask_chat")'), "auth.js must clear helmer_active_ask_chat");
  assert.ok(authSource.includes('sessionStorage.removeItem("helmer_planner_visit_notif_shown")'), "auth.js must clear helmer_planner_visit_notif_shown");

  // Extract isIdentityStale, clearUserScopedWorkspaceState, requestRefinement, saveStrategy, loadSavedStrategies, loadSavedChats, openSavedChat, openSavedStrategy, loadPlannerTasks, loadUsageStats
  const staleFnMatch = scriptSource.match(/function isIdentityStale\(epoch, expectedUserId\) \{[\s\S]*?\n\}/);
  const clearFnMatch = scriptSource.match(/function clearUserScopedWorkspaceState\(\) \{[\s\S]*?\n\}/);
  const refineFnMatch = scriptSource.match(/async function requestRefinement\(action, request(?:, [^)]*)?\) \{[\s\S]*?\n\}/);
  const saveFnMatch = scriptSource.match(/async function saveStrategy\(\) \{[\s\S]*?\n\}/);
  const loadStratsMatch = scriptSource.match(/async function loadSavedStrategies\(\) \{[\s\S]*?\n\}/);
  const loadChatsMatch = scriptSource.match(/async function loadSavedChats\(\) \{[\s\S]*?\n\}/);
  const openChatMatch = scriptSource.match(/async function openSavedChat\(chatId\) \{[\s\S]*?\n\}/);
  const openStratMatch = scriptSource.match(/async function openSavedStrategy\(id\) \{[\s\S]*?\n\}/);
  const loadPlannerMatch = scriptSource.match(/async function loadPlannerTasks\(\) \{[\s\S]*?\n\}/);
  const loadStatsMatch = scriptSource.match(/async function loadUsageStats\(\) \{[\s\S]*?\n  \/\/ Local fallback computation/);

  assert.ok(staleFnMatch && clearFnMatch, "isIdentityStale and clearUserScopedWorkspaceState must exist in public/script.js");
  assert.ok(refineFnMatch && saveFnMatch && loadStratsMatch && loadChatsMatch && openChatMatch && openStratMatch && loadPlannerMatch && loadStatsMatch, "All async loaders and mutators must exist in public/script.js");

  const sessionMap = new Map([
    ["helmer_active_ask_chat", "chat_account_a_123"],
    ["helmer_planner_visit_notif_shown", "true"],
  ]);
  const revisionsMap = new Map([["chat_account_a_123", "rev_a"]]);
  let abortedBuild = false;
  let abortedAsk = false;

  const sandbox = {
    crypto: { randomUUID: () => "uuid_fresh_after_clear" },
    currentAbortController: { abort: () => { abortedBuild = true; } },
    currentAskAbortController: { abort: () => { abortedAsk = true; } },
    progressTimer: null,
    activeAskReader: null,
    activeAskTypewriter: null,
    backgroundJobs: [{ id: "job_a", ownerId: "usr_a", status: "generating" }],
    strategyCount: { style: { display: "" }, textContent: "4" },
    recentList: { replaceChildren: () => {} },
    document: { querySelector: () => null, querySelectorAll: () => [{ remove() { sandbox.buildActionsRemoved = true; } }] },
    stopBuildCountdown() { sandbox.countdownStopped = true; },
    stopBuildIntelligence() { sandbox.intelligenceStopped = true; },
    window: {
      helmerSecurity: {
        revisions: revisionsMap,
        rememberChat: (c) => revisionsMap.set(c.id, c.revision || "r1"),
      },
    },
    sessionStorage: {
      removeItem: (k) => sessionMap.delete(k),
      setItem: (k, v) => sessionMap.set(k, v),
      getItem: (k) => sessionMap.get(k) || null,
    },
    getLanguage: () => "az",
    element: () => ({}),
    renderRecentList: () => {},
    renderStrategyList: () => {},
    renderRailArchivePopover: () => {},
    updatePlannerBadge: () => {},
    checkAndShowPlannerVisitNotification: () => {},
    rememberSavedAskChat: () => {},
    syncMode: () => {},
    syncNav: () => {},
    render: () => {},
    closeSidebar: () => {},
    showToast: () => {},
    connectToResearchJobStream: () => {},
    clearError: () => { sandbox.state.error = null; },
    trackEvent: () => {},
    setStatus: (s) => { sandbox.state.status = s; },
    setError: (err) => { sandbox.state.error = err?.message || String(err); },
    QUICK_ACTIONS: [["sharpen_positioning", "Mövqelənməni kəskinləşdir"]],
    AbortController,
    console,
    Date,
    Set,
    Object,
    Array,
    String,
    state: {
      mode: "build",
      view: "home",
      status: "saved",
      brief: "Account A Confidential Brief",
      buildPreparationEstimate: { seconds: 40 },
      buildEstimateBrief: "Account A Brief",
      buildEstimateUnavailable: false,
      questions: [{ id: "q1", question: "Account A Question?" }],
      clarificationIndex: 2,
      clarificationDrafts: { q1: "Account A Draft Answer" },
      answers: [{ id: "q1", answer: "Account A Answer" }],
      assumptions: ["Account A Assumption"],
      understanding: "Account A Understanding",
      round: 1,
      strategy: { title: "Account A Strategy", summary: "Secret A" },
      versions: [{ version: 1, title: "Account A v1" }],
      buildStreamingText: "Streaming A...",
      buildStreamingFinishReason: "STOP",
      savedId: "strat_account_a_1",
      clientSaveId: "save_account_a_1",
      savedStrategies: [{ id: "strat_account_a_1", title: "Account A Strategy" }],
      updatedAt: "2026-10-26T00:00:00.000Z",
      error: "err_a",
      retry: () => {},
      changeSummary: "Account A change",
      strategyAskOpen: true,
      refinementOpen: true,
      askChatId: "chat_account_a_123",
      currentChatId: "chat_account_a_123",
      savedChats: [{ id: "chat_account_a_123", title: "Account A Secret Chat" }],
      askMessages: [{ role: "user", content: "Account A secret prompt" }],
      askDraft: "Account A unsent draft",
      askPluginIds: ["plugin_a"],
      askArtifactId: "art_a",
      askArtifactName: "Account_A.docx",
      askRetry: () => {},
      askLoading: true,
      askError: "err_ask_a",
      askPendingFile: { name: "account_a.pdf" },
      askStrategyId: "strat_account_a_1",
      askTaskId: "task_account_a_1",
      askPromptHintStrategyId: "strat_account_a_1",
      plannerTasks: [{ id: "task_account_a_1", text: "Account A Task" }],
      plannerFilter: "priority",
      plannerCollapsedGroups: new Set(),
      plannerSelectedTaskIds: new Set(["task_account_a_1"]),
      isPrioritizingPlanner: true,
      usageStats: { statsByPeriod: { today: { totalOps: 99 } } },
      currentUser: { id: "usr_account_a", username: "account_a" },
      identityEpoch: 1,
      remainingGuestMessages: 3,
      remainingGuestBriefs: 2,
      guestQuotaCheckedAt: 12345,
      guestQuotaVersion: 1,
    },
  };

  // Deferred resolvers to simulate slow in-flight requests started while Account A was active
  let resolveSlowAccountAStrategies;
  let resolveSlowAccountAChats;
  let resolveSlowAccountAPlanner;
  let resolveSlowAccountARefinement;
  let PendingApiHandler = (url) => {
    if (url === "/api/strategy") {
      return new Promise((resolve) => { resolveSlowAccountAStrategies = resolve; });
    }
    if (url === "/api/ask/chats") {
      return new Promise((resolve) => { resolveSlowAccountAChats = resolve; });
    }
    if (url === "/api/strategy/strat_account_a_1/refine" || url === "/api/strategy/refine") {
      return new Promise((resolve) => { resolveSlowAccountARefinement = resolve; });
    }
    throw new Error(`Unexpected api call: ${url}`);
  };
  let PendingAuthRequestHandler = (url) => {
    if (url === "/api/planner") {
      return new Promise((resolve) => { resolveSlowAccountAPlanner = resolve; });
    }
    throw new Error(`Unexpected authRequest call: ${url}`);
  };

  let searchHistoryClosed = false;
  sandbox.closeSearchModal = () => { searchHistoryClosed = true; };
  sandbox.api = (url, opts) => PendingApiHandler(url, opts);
  sandbox.authRequest = (url, opts) => PendingAuthRequestHandler(url, opts);

  vm.createContext(sandbox);
  vm.runInContext(
    `${staleFnMatch[0]}\n${clearFnMatch[0]}\n${refineFnMatch[0]}\n${saveFnMatch[0]}\n${loadStratsMatch[0]}\n${loadChatsMatch[0]}\n${openChatMatch[0]}\n${openStratMatch[0]}\n${loadPlannerMatch[0]}`,
    sandbox,
  );

  // 1. Account A starts async loads AND a strategy refinement before logging out
  const inFlightStratsA = sandbox.loadSavedStrategies();
  const inFlightChatsA = sandbox.loadSavedChats();
  const inFlightPlannerA = sandbox.loadPlannerTasks();
  const inFlightRefineA = sandbox.requestRefinement("sharpen_positioning", "Make Account A strategy sharper");
  assert.equal(sandbox.state.status, "refining");
  let refineControllerAborted = false;
  sandbox.currentAbortController.signal.addEventListener("abort", () => { refineControllerAborted = true; });

  // 2. Account A logs out -> clearUserScopedWorkspaceState() runs
  sandbox.state.currentUser = null;
  sandbox.clearUserScopedWorkspaceState();

  assert.equal(searchHistoryClosed, true, "Account changes must close the previous user's search history");
  assert.equal(abortedBuild, true, "Previous Build controller must be aborted when refinement starts");
  assert.equal(refineControllerAborted, true, "In-flight Refinement controller must be aborted on logout");
  assert.equal(sandbox.countdownStopped, true);
  assert.equal(sandbox.intelligenceStopped, true);
  assert.equal(sandbox.buildActionsRemoved, true);
  assert.equal(sandbox.state.buildStartedAt, null);
  assert.equal(abortedAsk, true, "In-flight Ask controller must be aborted on logout");
  assert.equal(sandbox.state.brief, "");
  assert.equal(sandbox.state.questions.length, 0);
  assert.equal(Object.keys(sandbox.state.clarificationDrafts).length, 0);
  assert.equal(sandbox.state.answers.length, 0);
  assert.equal(sandbox.state.strategy, null);
  assert.equal(sandbox.state.versions.length, 0);
  assert.equal(sandbox.state.savedId, null);
  assert.equal(sandbox.state.savedStrategies.length, 0);
  assert.equal(sandbox.state.askChatId, null);
  assert.equal(sandbox.state.currentChatId, null);
  assert.equal(sandbox.state.savedChats.length, 0);
  assert.equal(sandbox.state.askMessages.length, 0);
  assert.equal(sandbox.state.askDraft, "");
  assert.equal(sandbox.state.askPendingFile, null);
  assert.equal(sandbox.state.askStrategyId, "");
  assert.equal(sandbox.state.askTaskId, "");
  assert.equal(sandbox.state.plannerTasks.length, 0);
  assert.equal(sandbox.state.plannerSelectedTaskIds.size, 0);
  assert.equal(sandbox.state.usageStats, null);
  assert.equal(sessionMap.has("helmer_active_ask_chat"), false);
  assert.equal(sessionMap.has("helmer_planner_visit_notif_shown"), false);
  assert.equal(revisionsMap.size, 0);

  // 3. Account B logs in
  sandbox.state.currentUser = { id: "usr_account_b", username: "account_b" };
  sandbox.clearUserScopedWorkspaceState();

  // 4. Stale in-flight responses from Account A arrive AFTER Account B is active
  resolveSlowAccountAStrategies({ strategies: [{ id: "strat_account_a_1", title: "Leaked Strategy A" }] });
  resolveSlowAccountAChats({ chats: [{ id: "chat_account_a_123", title: "Leaked Chat A" }] });
  resolveSlowAccountAPlanner({ tasks: [{ id: "task_account_a_1", text: "Leaked Task A" }] });
  resolveSlowAccountARefinement({
    strategy: {
      strategy: { title: "Leaked Refined Strategy A", summary: "Confidential A v2" },
      updatedAt: "2026-10-26T02:00:00.000Z",
      versions: [{ versionNumber: 2, title: "Leaked v2" }],
    },
  });
  await Promise.all([inFlightStratsA, inFlightChatsA, inFlightPlannerA, inFlightRefineA]);

  // Verify zero leakage of Account A's delayed responses into Account B's state
  assert.equal(sandbox.state.savedStrategies.length, 0, "Stale Account A strategies must be ignored after switch to Account B");
  assert.equal(sandbox.state.savedChats.length, 0, "Stale Account A chats must be ignored after switch to Account B");
  assert.equal(sandbox.state.plannerTasks.length, 0, "Stale Account A planner tasks must be ignored after switch to Account B");
  assert.equal(sandbox.state.strategy, null, "Stale Account A refinement response must never overwrite Account B strategy state");
  assert.equal(sandbox.state.versions.length, 0, "Stale Account A refinement versions must never leak into Account B");
  assert.equal(sandbox.state.changeSummary, "", "Stale Account A refinement changeSummary must never leak into Account B");
  assert.equal(sandbox.state.status, "draft", "Stale Account A refinement must not change Account B status from draft");

  // 5. Account B's own authoritative responses arrive and populate cleanly
  PendingApiHandler = async (url) => {
    if (url === "/api/strategy") return { strategies: [{ id: "strat_account_b_1", title: "Account B Strategy" }] };
    if (url === "/api/ask/chats") return { chats: [{ id: "chat_account_b_1", title: "Account B Chat" }] };
    return {};
  };
  PendingAuthRequestHandler = async (url) => {
    if (url === "/api/planner") return { tasks: [{ id: "task_account_b_1", text: "Account B Task" }] };
    return {};
  };
  await Promise.all([sandbox.loadSavedStrategies(), sandbox.loadSavedChats(), sandbox.loadPlannerTasks()]);
  assert.equal(sandbox.state.savedStrategies.length, 1);
  assert.equal(sandbox.state.savedStrategies[0].id, "strat_account_b_1");
  assert.equal(sandbox.state.savedChats.length, 1);
  assert.equal(sandbox.state.savedChats[0].id, "chat_account_b_1");
  assert.equal(sandbox.state.plannerTasks.length, 1);
  assert.equal(sandbox.state.plannerTasks[0].id, "task_account_b_1");
});

test("Regression 2: Multi-replica session revocation (logout, logout-all, password change) immediately rejects stale sessions on other instances", async (t) => {
  const dirA = await fs.mkdtemp(path.join(os.tmpdir(), "helmer-sess-rep-a-"));
  const dirB = await fs.mkdtemp(path.join(os.tmpdir(), "helmer-sess-rep-b-"));
  t.after(async () => {
    await fs.rm(dirA, { recursive: true, force: true });
    await fs.rm(dirB, { recursive: true, force: true });
  });

  let cloudUsersRecord = null;
  let cloudUsersEtag = null;
  let replicaBCachedUsers = null;

  let cloudAuthRecord = null;
  let cloudAuthEtag = null;
  let replicaBCachedAuth = null;

  // Simulate 10-second R2 TTL cache on Replica B that returns stale data unless { force: true } is passed
  const readUsersReplicaB = async ({ force = false } = {}) => {
    if (!force && replicaBCachedUsers) {
      return { record: structuredClone(replicaBCachedUsers), etag: '"users-stale"', notFound: false, isCloud: true };
    }
    replicaBCachedUsers = cloudUsersRecord ? structuredClone(cloudUsersRecord) : null;
    return { record: replicaBCachedUsers ? structuredClone(replicaBCachedUsers) : null, etag: cloudUsersEtag, notFound: !cloudUsersRecord, isCloud: true };
  };
  const writeUsersShared = async (record, etag) => {
    if (cloudUsersEtag && etag !== cloudUsersEtag) return false;
    cloudUsersRecord = structuredClone(record);
    cloudUsersEtag = `"users-${Date.now()}-${Math.random()}"`;
    return true;
  };

  const readAuthReplicaB = async ({ force = false } = {}) => {
    if (!force && replicaBCachedAuth) {
      return { record: structuredClone(replicaBCachedAuth), etag: '"auth-stale"', notFound: false, isCloud: true };
    }
    replicaBCachedAuth = cloudAuthRecord ? structuredClone(cloudAuthRecord) : null;
    return { record: replicaBCachedAuth ? structuredClone(replicaBCachedAuth) : null, etag: cloudAuthEtag, notFound: !cloudAuthRecord, isCloud: true };
  };
  const writeAuthShared = async (record, etag) => {
    if (cloudAuthEtag && etag !== cloudAuthEtag) return false;
    cloudAuthRecord = structuredClone(record);
    cloudAuthEtag = `"auth-${Date.now()}-${Math.random()}"`;
    return true;
  };

  const repoA = new FileUserRepository(path.join(dirA, "users.json"), null, {
    cloud: true,
    readCloud: async () => ({ record: cloudUsersRecord ? structuredClone(cloudUsersRecord) : null, etag: cloudUsersEtag, notFound: !cloudUsersRecord, isCloud: true }),
    writeCloud: writeUsersShared,
  });
  const repoB = new FileUserRepository(path.join(dirB, "users.json"), null, {
    cloud: true,
    readCloud: readUsersReplicaB,
    writeCloud: writeUsersShared,
  });

  const authStoreA = new FileAuthStore(path.join(dirA, "sessions.json"), null, {
    cloud: true,
    readCloud: async () => ({ record: cloudAuthRecord ? structuredClone(cloudAuthRecord) : null, etag: cloudAuthEtag, notFound: !cloudAuthRecord, isCloud: true }),
    writeCloud: writeAuthShared,
  });
  const authStoreB = new FileAuthStore(path.join(dirB, "sessions.json"), null, {
    cloud: true,
    readCloud: readAuthReplicaB,
    writeCloud: writeAuthShared,
  });

  const makeReplicaApp = (repo, store) => {
    const app = express();
    app.use(express.json());
    app.use(createIdentityMiddleware({ authStore: store, userRepository: repo }));
    app.use("/api/auth", createAuthRouter({
      userRepository: repo,
      authStore: store,
      emailService: { sendPasswordResetEmail: async () => {}, sendEmailVerificationCode: async () => {} },
      appUrl: "http://localhost",
    }));
    app.get("/api/protected", requireAuth, (req, res) => res.json({ userId: req.user.id, authVersion: req.user.authVersion }));
    app.use(authErrorHandler);
    return app;
  };

  const serverA = makeReplicaApp(repoA, authStoreA).listen(0, "127.0.0.1");
  const serverB = makeReplicaApp(repoB, authStoreB).listen(0, "127.0.0.1");
  t.after(() => Promise.all([
    new Promise((resolve) => serverA.close(resolve)),
    new Promise((resolve) => serverB.close(resolve)),
  ]));
  await Promise.all([
    new Promise((resolve) => serverA.once("listening", resolve)),
    new Promise((resolve) => serverB.once("listening", resolve)),
  ]);
  const baseA = `http://127.0.0.1:${serverA.address().port}`;
  const baseB = `http://127.0.0.1:${serverB.address().port}`;

  const passwordHash = await hashPassword("strongpass1");
  await repoA.create({
    fullName: "Replica User",
    username: "replica_user",
    email: "replica@example.com",
    passwordHash,
    emailVerifiedAt: new Date().toISOString(),
  });

  // 1. Login on Replica A (Device 1) and Replica B (Device 2)
  const login1 = await fetch(`${baseA}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier: "replica_user", password: "strongpass1" }),
  });
  assert.equal(login1.status, 200);
  const cookie1 = login1.headers.get("set-cookie").split(";")[0];

  const login2 = await fetch(`${baseB}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier: "replica_user", password: "strongpass1" }),
  });
  assert.equal(login2.status, 200);
  const cookie2 = login2.headers.get("set-cookie").split(";")[0];

  // Warm Replica B's caches with both sessions active
  assert.equal((await fetch(`${baseB}/api/protected`, { headers: { Cookie: cookie1 } })).status, 200);
  assert.equal((await fetch(`${baseB}/api/protected`, { headers: { Cookie: cookie2 } })).status, 200);

  // 2. Logout cookie1 on Replica A -> Replica B must immediately reject cookie1
  const logout1 = await fetch(`${baseA}/api/auth/logout`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie1 },
    body: "{}",
  });
  assert.equal(logout1.status, 204);

  const checkRevokedOnB = await fetch(`${baseB}/api/protected`, { headers: { Cookie: cookie1 } });
  assert.equal(checkRevokedOnB.status, 401, "Session revoked on Replica A must be immediately rejected on Replica B");

  // 3. Create cookie3 on Replica B, warm Replica B cache, then run logout-all on Replica A using cookie2
  const login3 = await fetch(`${baseB}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier: "replica_user", password: "strongpass1" }),
  });
  const cookie3 = login3.headers.get("set-cookie").split(";")[0];
  assert.equal((await fetch(`${baseB}/api/protected`, { headers: { Cookie: cookie3 } })).status, 200);

  const logoutAllOnA = await fetch(`${baseA}/api/auth/logout-all`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie2 },
    body: "{}",
  });
  assert.equal(logoutAllOnA.status, 200);

  const checkCookie3OnB = await fetch(`${baseB}/api/protected`, { headers: { Cookie: cookie3 } });
  assert.equal(checkCookie3OnB.status, 401, "Session revoked via logout-all on Replica A must be immediately rejected on Replica B");

  // 4. Create cookie4 on Replica B, warm cache, then change password on Replica A using cookie2 -> authVersion increments -> cookie4 must be rejected on Replica B
  const login4 = await fetch(`${baseB}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier: "replica_user", password: "strongpass1" }),
  });
  const cookie4 = login4.headers.get("set-cookie").split(";")[0];
  assert.equal((await fetch(`${baseB}/api/protected`, { headers: { Cookie: cookie4 } })).status, 200);

  const pwChangeOnA = await fetch(`${baseA}/api/auth/change-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie2 },
    body: JSON.stringify({ currentPassword: "strongpass1", newPassword: "newstrongpass2" }),
  });
  assert.equal(pwChangeOnA.status, 200);

  const checkCookie4OnB = await fetch(`${baseB}/api/protected`, { headers: { Cookie: cookie4 } });
  assert.equal(checkCookie4OnB.status, 401, "Session with outdated authVersion after password change on Replica A must be immediately rejected on Replica B");
});

test("Regression 3 & 4: Google OAuth sub-first identification on email change and protection against unauthorized email-based account linking", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "helmer-google-sub-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const users = new FileUserRepository(path.join(directory, "users.json"));
  const store = new FileAuthStore(path.join(directory, "sessions.json"));

  const originalClientId = process.env.GOOGLE_CLIENT_ID;
  process.env.GOOGLE_CLIENT_ID = "test-google-client-id.apps.googleusercontent.com";
  t.after(() => {
    if (originalClientId === undefined) delete process.env.GOOGLE_CLIENT_ID;
    else process.env.GOOGLE_CLIENT_ID = originalClientId;
  });

  let latestVerificationCode = null;
  let mockIdTokenPayload = null;
  const mockGoogleClient = {
    generateAuthUrl() { return "https://accounts.google.com/o/oauth2/v2/auth"; },
    async getToken() { return { tokens: { id_token: "mock.valid.id_token" } }; },
    async verifyIdToken({ idToken, audience }) {
      assert.equal(audience, "test-google-client-id.apps.googleusercontent.com");
      if (idToken !== "mock.valid.id_token") throw new Error("Invalid token");
      return { getPayload: () => mockIdTokenPayload };
    },
  };

  const app = express();
  app.use(guestSession);
  app.use(express.json());
  app.use(createIdentityMiddleware({ authStore: store, userRepository: users }));
  app.use("/api/auth", createAuthRouter({
    userRepository: users,
    authStore: store,
    emailService: {
      sendPasswordResetEmail: async () => {},
      sendEmailVerificationCode: async ({ code }) => { latestVerificationCode = code; },
    },
    appUrl: "http://localhost:8080",
    googleClient: mockGoogleClient,
  }));
  app.use(authErrorHandler);

  const server = app.listen(0, "127.0.0.1");
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  async function googleLoginWithPayload(payload, existingCookies = "") {
    const nonceRes = await fetch(`${base}/api/auth/google/nonce`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(existingCookies ? { Cookie: existingCookies } : {}) },
      body: "{}",
    });
    const guestCookies = (nonceRes.headers.getSetCookie ? nonceRes.headers.getSetCookie() : [nonceRes.headers.get("set-cookie")])
      .filter(Boolean)
      .map((c) => c.split(";")[0])
      .join("; ");
    const combinedCookies = [existingCookies, guestCookies].filter(Boolean).join("; ");
    const { nonce } = await nonceRes.json();
    mockIdTokenPayload = {
      iss: "https://accounts.google.com",
      aud: "test-google-client-id.apps.googleusercontent.com",
      exp: Math.floor(Date.now() / 1000) + 3600,
      email_verified: true,
      ...payload,
      nonce,
    };
    return fetch(`${base}/api/auth/google`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: combinedCookies },
      body: JSON.stringify({ credential: "mock.valid.id_token", nonce }),
    });
  }

  // --- Scenario 3: Google email change with same `sub` opens existing profile and preserves data ---
  const initialGoogleRes = await googleLoginWithPayload({
    sub: "google_immutable_sub_001",
    email: "founder.old@example.com",
    name: "Founder Profile",
  });
  assert.equal(initialGoogleRes.status, 200);
  const initialUser = (await initialGoogleRes.json()).user;
  assert.equal(initialUser.email, "founder.old@example.com");

  // Save custom brand setting on initialUser to verify profile & workspace preservation
  const extractSessionCookie = (res) =>
    (res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get("set-cookie")])
      .filter(Boolean)
      .map((c) => c.split(";")[0])
      .find((c) => c.startsWith("helmer_session="));

  const initialCookie = extractSessionCookie(initialGoogleRes);
  assert.ok(initialCookie);
  const patchSettingsRes = await fetch(`${base}/api/auth/settings`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Cookie: initialCookie },
    body: JSON.stringify({ brandName: "ImmutableSubBrand", personalIntelligence: true }),
  });
  assert.equal(patchSettingsRes.status, 200);

  // Now the user changes their Google account email to founder.new@example.com (same `sub`)
  const changedEmailRes = await googleLoginWithPayload({
    sub: "google_immutable_sub_001",
    email: "founder.new@example.com",
    name: "Founder Profile",
  });
  assert.equal(changedEmailRes.status, 200);
  const updatedUser = (await changedEmailRes.json()).user;
  assert.equal(updatedUser.id, initialUser.id, "Same Google sub must open the exact same Helmer user profile");
  assert.equal(updatedUser.email, "founder.new@example.com", "Profile email must update to the new verified Google email");
  assert.equal(updatedUser.settings.brandName, "ImmutableSubBrand", "Existing profile settings and data must be preserved");
  assert.equal((await users.readStore()).users.length, 1, "No duplicate user account may be created on Google email change");

  // --- Scenario 3b: In-app Helmer email change + verification is NOT overwritten by subsequent Google login ---
  const sessionAfterGoogleChange = extractSessionCookie(changedEmailRes);
  assert.ok(sessionAfterGoogleChange);

  // Re-authenticate with Google sub to authorize in-app email change
  const reauthNonceRes = await fetch(`${base}/api/auth/google/nonce`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: sessionAfterGoogleChange },
    body: "{}",
  });
  const { nonce: reauthNonce } = await reauthNonceRes.json();
  mockIdTokenPayload = {
    iss: "https://accounts.google.com",
    aud: "test-google-client-id.apps.googleusercontent.com",
    exp: Math.floor(Date.now() / 1000) + 3600,
    email_verified: true,
    sub: "google_immutable_sub_001",
    email: "founder.new@example.com",
    name: "Founder Profile",
    nonce: reauthNonce,
  };
  const reauthRes = await fetch(`${base}/api/auth/reauth`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: sessionAfterGoogleChange },
    body: JSON.stringify({ credential: "mock.valid.id_token", nonce: reauthNonce }),
  });
  assert.equal(reauthRes.status, 200);
  const { reauthToken } = await reauthRes.json();

  // Request email change inside Helmer to "founder.custom@helmer.az"
  latestVerificationCode = null;
  const profilePatchRes = await fetch(`${base}/api/auth/profile`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Cookie: sessionAfterGoogleChange },
    body: JSON.stringify({
      fullName: "Founder Profile",
      username: updatedUser.username.replace(/^@/, ""),
      email: "founder.custom@helmer.az",
      reauthToken,
    }),
  });
  assert.equal(profilePatchRes.status, 200);
  assert.ok(latestVerificationCode, "Verification code must be sent for pending email change");

  // Confirm the new Helmer email
  const confirmEmailChangeRes = await fetch(`${base}/api/auth/email-verification/confirm`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: sessionAfterGoogleChange },
    body: JSON.stringify({ email: "founder.custom@helmer.az", code: latestVerificationCode }),
  });
  assert.equal(confirmEmailChangeRes.status, 200);
  const confirmedUser = (await confirmEmailChangeRes.json()).user;
  assert.equal(confirmedUser.email, "founder.custom@helmer.az");

  // Now sign in via Google again where Google still sends "founder.new@example.com"
  const subsequentGoogleRes = await googleLoginWithPayload({
    sub: "google_immutable_sub_001",
    email: "founder.new@example.com",
    name: "Founder Profile",
  });
  assert.equal(subsequentGoogleRes.status, 200);
  const userAfterSubsequentGoogleLogin = (await subsequentGoogleRes.json()).user;
  assert.equal(userAfterSubsequentGoogleLogin.id, initialUser.id);
  assert.equal(
    userAfterSubsequentGoogleLogin.email,
    "founder.custom@helmer.az",
    "In-app verified Helmer email must be preserved across subsequent Google logins",
  );

  // --- Scenario 4: Google account linking blocks unauthorized access to another user's password account ---
  const victimPasswordHash = await hashPassword("victimStrongPass99!");
  const victimUser = await users.create({
    fullName: "Victim Owner",
    username: "victim_owner",
    email: "victim@example.com",
    passwordHash: victimPasswordHash,
    emailVerifiedAt: new Date().toISOString(),
  });

  // Unauthenticated Google login attempt with matching email ("victim@example.com") must be rejected (409 GOOGLE_ACCOUNT_LINK_REQUIRED)
  const unauthLinkAttempt = await googleLoginWithPayload({
    sub: "google_sub_unlinked_attacker",
    email: "victim@example.com",
    name: "Attacker",
  });
  assert.equal(unauthLinkAttempt.status, 409, "Unauthenticated email-based auto-merge into existing password account must be blocked");
  const unauthLinkBody = await unauthLinkAttempt.json();
  assert.equal(unauthLinkBody.code, "GOOGLE_ACCOUNT_LINK_REQUIRED");

  // Verify victim's password and account were NOT touched
  const victimAfterAttempt = await users.findById(victimUser.id);
  assert.equal(victimAfterAttempt.googleSub, null, "Victim googleSub must remain null after blocked attempt");
  assert.equal(await verifyPassword(victimAfterAttempt.passwordHash, "victimStrongPass99!"), true, "Victim password must remain intact");

  // Conversely, when Victim logs in with their password first, Victim CAN link their own Google account
  const victimLogin = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier: "victim@example.com", password: "victimStrongPass99!" }),
  });
  assert.equal(victimLogin.status, 200);
  const victimSessionCookie = extractSessionCookie(victimLogin);
  assert.ok(victimSessionCookie);

  const authLinkRes = await googleLoginWithPayload({
    sub: "google_sub_victim_verified",
    email: "victim@example.com",
    name: "Victim Owner",
  }, victimSessionCookie);
  assert.equal(authLinkRes.status, 200, "Authenticated account owner can link their own Google sub");
  const linkedVictim = (await authLinkRes.json()).user;
  assert.equal(linkedVictim.id, victimUser.id);
  assert.equal(linkedVictim.hasGoogleAuth, true);

  // Once linked, a different Google sub with the same email is rejected with 401 GOOGLE_ACCOUNT_MISMATCH
  const mismatchAttempt = await googleLoginWithPayload({
    sub: "google_sub_another_person",
    email: "victim@example.com",
    name: "Another Person",
  }, victimSessionCookie);
  assert.equal(mismatchAttempt.status, 401);
  assert.equal((await mismatchAttempt.json()).code, "GOOGLE_ACCOUNT_MISMATCH");
});



