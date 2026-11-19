import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import express from "express";
import { FileAuthStore, RedisAuthStore } from "../src/auth/auth-store.js";
import { FileUserRepository } from "../src/repositories/file-user-repository.js";
import { createIdentityMiddleware } from "../src/http/auth-middleware.js";
import { authErrorHandler, createAuthRouter } from "../src/http/auth-router.js";
import { DISPOSABLE_EMAIL_DOMAINS, extractEmailDomain, isDisposableEmail } from "../src/auth/disposable-emails.js";
import { verifyTurnstileToken } from "../src/auth/turnstile.js";

function createFakeRedis() {
  const kv = new Map();
  const expiresAt = new Map();

  function purgeExpired(key) {
    const exp = expiresAt.get(key);
    if (exp && Date.now() >= exp) {
      kv.delete(key);
      expiresAt.delete(key);
    }
  }

  return {
    isReady: true,
    async eval(_script, { keys = [], arguments: args = [] } = {}) {
      if (keys.length === 2 && keys[0].startsWith("auth:verify-current:")) {
        const old = kv.get(keys[0]);
        if (old) kv.delete(`auth:verify-email:${old}`);
        const ttl = Number(args[2] || 600);
        kv.set(keys[1], String(args[1]));
        expiresAt.set(keys[1], Date.now() + ttl * 1000);
        kv.set(keys[0], String(args[0]));
        expiresAt.set(keys[0], Date.now() + ttl * 1000);
        return 1;
      }
      return 0;
    },
    multi() {
      const ops = [];
      const chain = {
        set(key, val, opts = {}) {
          ops.push(() => {
            purgeExpired(key);
            if (opts.NX && kv.has(key)) return null;
            kv.set(key, String(val));
            if (opts.EX) expiresAt.set(key, Date.now() + opts.EX * 1000);
            return "OK";
          });
          return chain;
        },
        incr(key) {
          ops.push(() => {
            purgeExpired(key);
            const next = Number(kv.get(key) || "0") + 1;
            kv.set(key, String(next));
            return next;
          });
          return chain;
        },
        ttl(key) {
          ops.push(() => {
            purgeExpired(key);
            const exp = expiresAt.get(key);
            if (!exp) return -1;
            return Math.max(0, Math.ceil((exp - Date.now()) / 1000));
          });
          return chain;
        },
        async exec() {
          return ops.map((fn) => fn());
        },
      };
      return chain;
    },
  };
}

test("Disposable email filter blocks known temporary domains and subdomains while allowing legitimate ones", () => {
  assert.ok(DISPOSABLE_EMAIL_DOMAINS.size >= 100, "Disposable email domain list should be comprehensive");

  const blocked = [
    "test@10minutemail.com",
    "USER@TEMPMAIL.COM",
    "bot@guerrillamail.com",
    "spam@mailinator.com",
    "fake@yopmail.com",
    "anon@throwawaymail.com",
    "nested@sub.10minutemail.com",
    "sub@foo.mailinator.com",
    "demo@1secmail.com",
    "lead@trashmail.com",
  ];
  for (const email of blocked) {
    assert.equal(isDisposableEmail(email), true, `Expected ${email} to be blocked`);
  }

  const allowed = [
    "user@gmail.com",
    "founder@company.az",
    "team@helmeros.com",
    "support@not10minutemail.com",
    "hello@outlook.com",
  ];
  for (const email of allowed) {
    assert.equal(isDisposableEmail(email), false, `Expected ${email} to be allowed`);
  }

  assert.equal(extractEmailDomain("User@Sub.Example.COM."), "sub.example.com");
});

test("verifyTurnstileToken validates tokens, actions, hostnames, and fails closed on errors", async () => {
  const missing = await verifyTurnstileToken({
    token: "",
    secretKey: "test-secret",
    appUrl: "http://localhost:5050",
  });
  assert.equal(missing.ok, false);
  assert.equal(missing.status, 403);
  assert.equal(missing.code, "BOT_VERIFICATION_REQUIRED");

  const rejected = await verifyTurnstileToken({
    token: "bad-token",
    secretKey: "test-secret",
    appUrl: "http://localhost:5050",
    fetcher: async () => ({
      ok: true,
      json: async () => ({ success: false, "error-codes": ["invalid-input-response"] }),
    }),
  });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.status, 403);
  assert.equal(rejected.code, "BOT_VERIFICATION_FAILED");

  const wrongAction = await verifyTurnstileToken({
    token: "valid-token",
    secretKey: "test-secret",
    appUrl: "https://helmeros.com",
    expectedAction: "signup",
    fetcher: async () => ({
      ok: true,
      json: async () => ({ success: true, action: "guest-ai", hostname: "helmeros.com" }),
    }),
  });
  assert.equal(wrongAction.ok, false);
  assert.equal(wrongAction.status, 403);

  const prodTestingKey = await verifyTurnstileToken({
    token: "XXXX.DUMMY.TOKEN.XXXX",
    secretKey: "test-secret",
    appUrl: "https://helmeros.com",
    nodeEnv: "production",
    fetcher: async () => ({
      ok: true,
      json: async () => ({
        success: true,
        hostname: "example.com",
        metadata: { result_with_testing_key: true },
      }),
    }),
  });
  assert.equal(prodTestingKey.ok, false, "Production must never accept Cloudflare testing-key example.com hostname");

  const devTestingKey = await verifyTurnstileToken({
    token: "XXXX.DUMMY.TOKEN.XXXX",
    secretKey: "1x0000000000000000000000000000000AA",
    appUrl: "http://localhost:5050",
    nodeEnv: "development",
    fetcher: async () => ({
      ok: true,
      json: async () => ({
        success: true,
        hostname: "example.com",
        metadata: { result_with_testing_key: true },
      }),
    }),
  });
  assert.equal(devTestingKey.ok, true);

  const networkError = await verifyTurnstileToken({
    token: "valid-token",
    secretKey: "test-secret",
    appUrl: "http://localhost:5050",
    fetcher: async () => {
      throw new Error("ECONNREFUSED");
    },
  });
  assert.equal(networkError.ok, false);
  assert.equal(networkError.status, 503);
  assert.equal(networkError.code, "BOT_VERIFICATION_UNAVAILABLE");
});

test("POST /api/auth/signup enforces 3-layer bot defense (Turnstile, Disposable Email, Redis 5/60s IP Rate Limit)", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "helmer-signup-defense-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));

  const users = new FileUserRepository(path.join(dir, "users.json"), null, { cloud: false });
  const fakeRedis = createFakeRedis();
  const authStore = new RedisAuthStore(fakeRedis);

  const siteverifyCalls = [];
  const turnstileFetcher = async (url, init) => {
    const parsed = JSON.parse(init.body);
    siteverifyCalls.push(parsed);
    if (parsed.response === "VALID_TEST_TOKEN") {
      return {
        ok: true,
        json: async () => ({ success: true, action: "signup", hostname: "localhost" }),
      };
    }
    return {
      ok: true,
      json: async () => ({ success: false, "error-codes": ["invalid-input-response"] }),
    };
  };

  const app = express();
  app.set("trust proxy", 1);
  app.use(express.json());
  app.use(createIdentityMiddleware({ authStore, userRepository: users }));
  app.use("/api/auth", createAuthRouter({
    userRepository: users,
    authStore,
    emailService: {
      sendEmailVerificationCode: async () => {},
      sendPasswordResetEmail: async () => {},
    },
    appUrl: "http://localhost:5050",
    turnstileSiteKey: "1x00000000000000000000AA",
    turnstileSecretKey: "test-turnstile-secret",
    turnstileFetcher,
  }));
  app.use(authErrorHandler);

  const server = app.listen(0, "127.0.0.1");
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  // Config endpoint exposes turnstileSiteKey
  const cfgRes = await fetch(`${base}/api/auth/config`);
  assert.equal(cfgRes.status, 200);
  const cfg = await cfgRes.json();
  assert.equal(cfg.turnstileSiteKey, "1x00000000000000000000AA");
  assert.equal(cfg.turnstileEnabled, true);

  // Scenario A1: Empty Turnstile token -> 403 BOT_VERIFICATION_REQUIRED (IP-1)
  const emptyTokenRes = await fetch(`${base}/api/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Forwarded-For": "198.51.100.10" },
    body: JSON.stringify({
      fullName: "Bot User",
      username: "bot_empty",
      email: "bot1@company.com",
      password: "StrongPassword123",
      ageConfirmed: true,
      turnstileToken: "",
    }),
  });
  assert.equal(emptyTokenRes.status, 403);
  assert.equal((await emptyTokenRes.json()).code, "BOT_VERIFICATION_REQUIRED");

  // Scenario A2: Fake Turnstile token -> 403 BOT_VERIFICATION_FAILED (IP-1)
  const fakeTokenRes = await fetch(`${base}/api/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Forwarded-For": "198.51.100.10" },
    body: JSON.stringify({
      fullName: "Bot User",
      username: "bot_fake",
      email: "bot2@company.com",
      password: "StrongPassword123",
      ageConfirmed: true,
      turnstileToken: "FAKE_BOT_TOKEN",
    }),
  });
  assert.equal(fakeTokenRes.status, 403);
  assert.equal((await fakeTokenRes.json()).code, "BOT_VERIFICATION_FAILED");
  assert.equal(siteverifyCalls.length, 1);

  // Scenario B: Disposable email with valid Turnstile token -> 400 DISPOSABLE_EMAIL_NOT_ALLOWED (IP-2)
  const disposableRes = await fetch(`${base}/api/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Forwarded-For": "198.51.100.11" },
    body: JSON.stringify({
      fullName: "Temp User",
      username: "temp_user_1",
      email: "test@10minutemail.com",
      password: "StrongPassword123",
      ageConfirmed: true,
      turnstileToken: "VALID_TEST_TOKEN",
    }),
  });
  assert.equal(disposableRes.status, 400);
  const disposableBody = await disposableRes.json();
  assert.equal(disposableBody.code, "DISPOSABLE_EMAIL_NOT_ALLOWED");
  assert.equal(disposableBody.field, "email");
  assert.equal(await users.findByEmail("test@10minutemail.com"), null, "Disposable signup must not create user");

  // Scenario C: 6 consecutive requests from IP-3 with valid token & normal emails -> 5 allowed, 6th gets 429
  for (let i = 1; i <= 5; i += 1) {
    const res = await fetch(`${base}/api/auth/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Forwarded-For": "198.51.100.12" },
      body: JSON.stringify({
        fullName: `Real User ${i}`,
        username: `real_user_${i}`,
        email: `real${i}@company.com`,
        password: "StrongPassword123",
        ageConfirmed: true,
        turnstileToken: "VALID_TEST_TOKEN",
      }),
    });
    assert.equal(res.status, 201, `Signup #${i} within 5/min limit should succeed`);
    assert.equal(res.headers.get("x-ratelimit-remaining"), String(5 - i));
  }

  const rateLimitedRes = await fetch(`${base}/api/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Forwarded-For": "198.51.100.12" },
    body: JSON.stringify({
      fullName: "Real User 6",
      username: "real_user_6",
      email: "real6@company.com",
      password: "StrongPassword123",
      ageConfirmed: true,
      turnstileToken: "VALID_TEST_TOKEN",
    }),
  });
  assert.equal(rateLimitedRes.status, 429);
  const rateLimitedBody = await rateLimitedRes.json();
  assert.equal(rateLimitedBody.code, "RATE_LIMITED");
  assert.ok(Number(rateLimitedRes.headers.get("retry-after")) >= 1);
  assert.equal(await users.findByEmail("real6@company.com"), null, "Rate-limited 6th signup must not create user");

  // Alias /api/auth/register works identically for a fresh IP
  const registerAliasRes = await fetch(`${base}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Forwarded-For": "198.51.100.13" },
    body: JSON.stringify({
      fullName: "Alias User",
      username: "alias_user_1",
      email: "alias1@company.com",
      password: "StrongPassword123",
      ageConfirmed: true,
      turnstileToken: "VALID_TEST_TOKEN",
    }),
  });
  assert.equal(registerAliasRes.status, 201);
});

test("Frontend index.html, auth.js, and style.css cleanly integrate Turnstile in signup form", async () => {
  const [html, authJs, css] = await Promise.all([
    fs.readFile(path.join(process.cwd(), "public/index.html"), "utf8"),
    fs.readFile(path.join(process.cwd(), "public/auth.js"), "utf8"),
    fs.readFile(path.join(process.cwd(), "public/style.css"), "utf8"),
  ]);

  assert.ok(html.includes("https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"), "index.html loads Turnstile explicit script");
  assert.ok(authJs.includes("auth-turnstile-wrap"), "auth.js renders Turnstile container");
  assert.ok(authJs.includes('appearance: "interaction-only"'), "auth.js uses non-intrusive interaction-only Turnstile mode");
  assert.ok(authJs.includes("window.turnstile.reset"), "auth.js resets Turnstile token on signup error");
  assert.ok(authJs.includes("turnstileToken"), "auth.js sends turnstileToken with signup request");
  assert.ok(css.includes(".auth-turnstile-wrap"), "style.css styles .auth-turnstile-wrap cleanly");
});
