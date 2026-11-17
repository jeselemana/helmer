import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import express from "express";
import {
  UserMemoryItemSchema,
  UserSettingsSchema,
  GoogleAuthSchema,
  SignupSchema,
  LoginSchema,
  ChangePasswordSchema,
  ForgotPasswordSchema,
  ResetPasswordSchema,
  EmailVerificationRequestSchema,
  EmailVerificationConfirmSchema,
  AccountUpdateSchema,
  OnboardingSchema,
  AddMemoryItemSchema,
  ImportMemoryPayloadSchema,
  ImportedMemoryItemSchema,
  parseBody,
} from "../src/auth/validation.js";
import { FileUserRepository } from "../src/repositories/file-user-repository.js";
import { FileAuthStore } from "../src/auth/auth-store.js";
import { createAuthRouter, authErrorHandler } from "../src/http/auth-router.js";
import { createIdentityMiddleware } from "../src/http/auth-middleware.js";

// ============================================================================
// SUITE 1: FileUserRepository.update Mass Assignment Defense
// ============================================================================

test("ADVERSARIAL: FileUserRepository.update strictly guards sensitive/immutable fields without allowSystemFields", async (t) => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "helmer-adv-user-"));
  t.after(() => fs.rm(tmpDir, { recursive: true, force: true }));

  const dbPath = path.join(tmpDir, "users.json");
  const userRepo = new FileUserRepository(dbPath);

  // Seed baseline user with explicit known values
  const initialPasswordHash = "$argon2id$v=19$m=19456,p=1,t=2$baselinehash$abcdef123456";
  const baselineUser = await userRepo.create({
    fullName: "Original User",
    username: "original_user",
    email: "original@example.com",
    passwordHash: initialPasswordHash,
    emailVerifiedAt: null,
  });

  const originalId = baselineUser.id;
  const originalCreatedAt = baselineUser.createdAt;
  assert.ok(originalId.startsWith("usr_"));
  assert.equal(baselineUser.emailVerifiedAt, null);
  assert.equal(baselineUser.role, undefined);
  assert.equal(baselineUser.ownerId, undefined);

  // Attack 1: Overwrite ownerId without allowSystemFields
  const resOwnerId = await userRepo.update(originalId, {
    ownerId: "attacker_tenant_9999",
  });
  assert.equal(resOwnerId.ownerId, undefined, "ownerId must not be modified without allowSystemFields");
  const checkOwnerId = await userRepo.findById(originalId);
  assert.equal(checkOwnerId.ownerId, undefined, "ownerId in db must remain undefined");

  // Attack 2: Forge emailVerifiedAt without allowSystemFields
  const resVerified = await userRepo.update(originalId, {
    emailVerifiedAt: "2099-01-01T00:00:00.000Z",
  });
  assert.equal(resVerified.emailVerifiedAt, null, "emailVerifiedAt must not be forged without allowSystemFields");
  const checkVerified = await userRepo.findById(originalId);
  assert.equal(checkVerified.emailVerifiedAt, null, "emailVerifiedAt in db must remain null");

  // Attack 3: Overwrite id without allowSystemFields
  const resId = await userRepo.update(originalId, {
    id: "usr_attacker_takeover_id",
  });
  assert.equal(resId.id, originalId, "id must not be mutable");
  const checkOldId = await userRepo.findById(originalId);
  assert.ok(checkOldId, "user must still be found by original id");
  const checkNewId = await userRepo.findById("usr_attacker_takeover_id");
  assert.equal(checkNewId, null, "user must not be queryable by injected id");

  // Attack 4: Overwrite createdAt without allowSystemFields
  const resCreatedAt = await userRepo.update(originalId, {
    createdAt: "1970-01-01T00:00:00.000Z",
  });
  assert.equal(resCreatedAt.createdAt, originalCreatedAt, "createdAt must remain immutable");
  const checkCreatedAt = await userRepo.findById(originalId);
  assert.equal(checkCreatedAt.createdAt, originalCreatedAt, "createdAt in db must remain original");

  // Attack 5: Overwrite passwordHash without allowSystemFields
  const resPasswordHash = await userRepo.update(originalId, {
    passwordHash: "$argon2id$v=19$m=19456,p=1,t=2$attackerhackedhash$99999",
  });
  assert.equal(resPasswordHash.passwordHash, initialPasswordHash, "passwordHash must not mutate via generic update");
  const checkPasswordHash = await userRepo.findById(originalId);
  assert.equal(checkPasswordHash.passwordHash, initialPasswordHash, "passwordHash in db must remain original");

  // Attack 6: Privilege escalation via role injection without allowSystemFields
  const resRole = await userRepo.update(originalId, {
    role: "admin",
  });
  assert.equal(resRole.role, undefined, "role must not be grantable via update");
  const checkRole = await userRepo.findById(originalId);
  assert.equal(checkRole.role, undefined, "role in db must remain undefined");

  // Attack 7: Kitchen-sink combined attack (All sensitive fields simultaneously)
  const kitchenSinkPayload = {
    fullName: "Legitimate-Looking Rename",
    ownerId: "attacker_tenant_all",
    emailVerifiedAt: "2099-12-31T23:59:59.999Z",
    id: "usr_attacker_takeover_all",
    createdAt: "1980-01-01T00:00:00.000Z",
    passwordHash: "$argon2id$injected_all",
    role: "superadmin",
  };
  const resCombined = await userRepo.update(originalId, kitchenSinkPayload, { allowSystemFields: false });

  assert.equal(resCombined.fullName, "Legitimate-Looking Rename", "Legitimate safe field should update");
  assert.equal(resCombined.ownerId, undefined, "ownerId must not mutate");
  assert.equal(resCombined.emailVerifiedAt, null, "emailVerifiedAt must not mutate");
  assert.equal(resCombined.id, originalId, "id must not mutate");
  assert.equal(resCombined.createdAt, originalCreatedAt, "createdAt must not mutate");
  assert.equal(resCombined.passwordHash, initialPasswordHash, "passwordHash must not mutate");
  assert.equal(resCombined.role, undefined, "role must not mutate");

  // Attack 8: On-disk raw JSON forensic verification
  const rawDiskData = JSON.parse(await fs.readFile(dbPath, "utf8"));
  const diskUser = rawDiskData.users.find((u) => u.id === originalId);
  assert.ok(diskUser, "user exists on disk");
  assert.equal(diskUser.fullName, "Legitimate-Looking Rename");
  assert.equal(diskUser.ownerId, undefined);
  assert.equal(diskUser.emailVerifiedAt, null);
  assert.equal(diskUser.id, originalId);
  assert.equal(diskUser.createdAt, originalCreatedAt);
  assert.equal(diskUser.passwordHash, initialPasswordHash);
  assert.equal(diskUser.role, undefined);

  // Attack 9: Prototype pollution defense
  const protoPayload = JSON.parse('{"__proto__": {"admin": true, "polluted": true}}');
  await userRepo.update(originalId, protoPayload);
  assert.equal(({}).polluted, undefined, "Object.prototype must not be polluted");
  assert.equal(diskUser.polluted, undefined, "user object must not have polluted prototype");

  // Attack 10: Authorized system field updates WITH allowSystemFields: true
  const authorizedUpdate = await userRepo.update(
    originalId,
    {
      ownerId: "authorized_tenant_abc",
      emailVerifiedAt: "2026-10-01T15:00:00.000Z",
    },
    { allowSystemFields: true },
  );
  assert.equal(authorizedUpdate.ownerId, undefined, "ownerId remains immutable even for generic internal updates");
  assert.equal(authorizedUpdate.emailVerifiedAt, "2026-10-01T15:00:00.000Z", "emailVerifiedAt should update when authorized");

  // Attack 11: Email change automatically invalidates emailVerifiedAt even with allowSystemFields
  const emailChangeUpdate = await userRepo.update(
    originalId,
    {
      email: "newemail@example.com",
      emailVerifiedAt: "2026-10-01T15:00:00.000Z",
    },
    { allowSystemFields: true },
  );
  assert.equal(emailChangeUpdate.email, "newemail@example.com");
  assert.equal(emailChangeUpdate.emailVerifiedAt, null, "email change MUST reset emailVerifiedAt to null");
});

// ============================================================================
// SUITE 2: Zod Schema Strictness (UserMemoryItemSchema, UserSettingsSchema, GoogleAuthSchema)
// ============================================================================

test("ADVERSARIAL: UserMemoryItemSchema rejects extra properties with unrecognized_keys", () => {
  const validMemory = {
    id: "mem_valid_12345",
    text: "Target audience is B2B founders",
    category: "audience",
    createdAt: "2026-10-01T10:00:00.000Z",
  };

  // Valid baseline passes
  const validResult = UserMemoryItemSchema.safeParse(validMemory);
  assert.equal(validResult.success, true);

  // Adversarial extra properties
  const attackPayloads = [
    { ...validMemory, extraProp: "malicious" },
    { ...validMemory, role: "admin" },
    { ...validMemory, ownerId: "attacker" },
    { ...validMemory, passwordHash: "injected" },
    { ...validMemory, isAdmin: true, bypass: 1 },
  ];

  for (const payload of attackPayloads) {
    const result = UserMemoryItemSchema.safeParse(payload);
    assert.equal(result.success, false, `Schema should reject payload with extra keys: ${JSON.stringify(payload)}`);
    const unrecognizedIssue = result.error.issues.find((issue) => issue.code === "unrecognized_keys");
    assert.ok(unrecognizedIssue, "Failure code must be unrecognized_keys");
    assert.ok(unrecognizedIssue.keys.length > 0, "unrecognized_keys must list the offending keys");

    // Verify parseBody throws VALIDATION_ERROR
    assert.throws(
      () => parseBody(UserMemoryItemSchema, payload),
      (err) => err.code === "VALIDATION_ERROR" && err.details.length > 0,
    );
  }
});

test("ADVERSARIAL: UserMemoryItemSchema blocks sensitive data leakage and invalid types", () => {
  const base = {
    id: "mem_valid_01",
    category: "general",
    createdAt: "2026-10-01T10:00:00.000Z",
  };

  // 1. Credit card injection in text
  const ccAttempt = UserMemoryItemSchema.safeParse({
    ...base,
    text: "Here is the corporate card 4111 2222 3333 4444 with cvv 123",
  });
  assert.equal(ccAttempt.success, false, "Credit card numbers must be blocked");

  // 2. Phone number injection in text
  const phoneAttempt = UserMemoryItemSchema.safeParse({
    ...base,
    text: "Bizimlə əlaqə: +994501234567 nömrəsi",
  });
  assert.equal(phoneAttempt.success, false, "Phone numbers must be blocked");

  // 3. Password injection in text
  const secretAttempt = UserMemoryItemSchema.safeParse({
    ...base,
    text: "production api_key: sk-proj-1234567890abcdef",
  });
  assert.equal(secretAttempt.success, false, "API keys and passwords must be blocked");

  // 4. Invalid category enum
  const enumAttempt = UserMemoryItemSchema.safeParse({
    ...base,
    text: "Normal text note",
    category: "super_admin_category",
  });
  assert.equal(enumAttempt.success, false, "Invalid categories must be blocked");

  // 5. Type pollution: non-string id or text
  const typeAttempt = UserMemoryItemSchema.safeParse({
    ...base,
    id: { $ne: null },
    text: ["array of text"],
  });
  assert.equal(typeAttempt.success, false, "Non-primitive injection must be blocked");
});

test("ADVERSARIAL: UserSettingsSchema rejects extra properties at root and nested memories with unrecognized_keys", () => {
  const validMemory = {
    id: "mem_valid_12345",
    text: "Target audience is B2B founders",
    category: "audience",
    createdAt: "2026-10-01T10:00:00.000Z",
  };

  const validSettings = {
    brandName: "Helmer Pro",
    industry: "Tech",
    tone: "professional",
    memories: [validMemory],
    autoContext: true,
  };

  // Valid baseline passes
  const validResult = UserSettingsSchema.safeParse(validSettings);
  assert.equal(validResult.success, true);

  // Attack 1: Root-level extra properties
  const rootAttackPayloads = [
    { ...validSettings, unexpectedKey: "root_bypass" },
    { ...validSettings, role: "admin" },
    { ...validSettings, passwordHash: "injected" },
    { ...validSettings, ownerId: "fake_owner" },
    { ...validSettings, is_admin: true, backdoor: "open" },
  ];

  for (const payload of rootAttackPayloads) {
    const result = UserSettingsSchema.safeParse(payload);
    assert.equal(result.success, false, `UserSettingsSchema should reject root-level extra properties: ${JSON.stringify(payload)}`);
    const unrecognizedIssue = result.error.issues.find((issue) => issue.code === "unrecognized_keys");
    assert.ok(unrecognizedIssue, "Root failure code must be unrecognized_keys");
    assert.ok(unrecognizedIssue.keys.length > 0);

    assert.throws(
      () => parseBody(UserSettingsSchema, payload),
      (err) => err.code === "VALIDATION_ERROR",
    );
  }

  // Attack 2: Nested extra property inside memories
  const nestedAttackSettings = {
    ...validSettings,
    memories: [
      {
        ...validMemory,
        nestedHackerField: "injected_into_memory",
      },
    ],
  };

  const nestedResult = UserSettingsSchema.safeParse(nestedAttackSettings);
  assert.equal(nestedResult.success, false, "UserSettingsSchema should reject extra properties nested in memories");
  const nestedUnrecognizedIssue = nestedResult.error.issues.find((issue) => issue.code === "unrecognized_keys");
  assert.ok(nestedUnrecognizedIssue, "Nested memory failure code must be unrecognized_keys");
  assert.ok(nestedUnrecognizedIssue.keys.includes("nestedHackerField"));

  assert.throws(
    () => parseBody(UserSettingsSchema, nestedAttackSettings),
    (err) => err.code === "VALIDATION_ERROR",
  );

  // Attack 3: Memory limit overflow (> 50 items)
  const fiftyOneMemories = Array.from({ length: 51 }, (_, i) => ({
    id: `mem_${i}`,
    text: `Memory note ${i}`,
    category: "general",
    createdAt: "2026-10-01T00:00:00Z",
  }));
  const overflowSettings = { ...validSettings, memories: fiftyOneMemories };
  assert.equal(UserSettingsSchema.safeParse(overflowSettings).success, false, "Should reject > 50 memories");
});

test("ADVERSARIAL: GoogleAuthSchema rejects extra properties with unrecognized_keys", () => {
  const validGoogle = {
    credential: "google_oauth_credential_token_value_here", nonce: "n".repeat(43),
  };

  // Valid baseline passes
  const validResult = GoogleAuthSchema.safeParse(validGoogle);
  assert.equal(validResult.success, true);

  // Adversarial extra properties
  const attackPayloads = [
    { ...validGoogle, email: "victim@example.com" },
    { ...validGoogle, role: "admin" },
    { ...validGoogle, ownerId: "hijacked_tenant" },
    { ...validGoogle, sub: "injected_google_sub" },
    { ...validGoogle, extraParam: 12345, bypass: true },
  ];

  for (const payload of attackPayloads) {
    const result = GoogleAuthSchema.safeParse(payload);
    assert.equal(result.success, false, `GoogleAuthSchema should reject extra properties: ${JSON.stringify(payload)}`);
    const unrecognizedIssue = result.error.issues.find((issue) => issue.code === "unrecognized_keys");
    assert.ok(unrecognizedIssue, "Failure code must be unrecognized_keys");
    assert.ok(unrecognizedIssue.keys.length > 0);

    assert.throws(
      () => parseBody(GoogleAuthSchema, payload),
      (err) => err.code === "VALIDATION_ERROR",
    );
  }

  // Type attacks: non-string credential or empty string or oversized token
  assert.equal(GoogleAuthSchema.safeParse({ credential: "" }).success, false);
  assert.equal(GoogleAuthSchema.safeParse({ credential: { token: "abc" } }).success, false);
  assert.equal(GoogleAuthSchema.safeParse({ credential: "a".repeat(4097) }).success, false);
});

test("ADVERSARIAL: All mutation schemas enforce strict() and reject unexpected fields", () => {
  const testCases = [
    {
      name: "SignupSchema",
      schema: SignupSchema,
      valid: { fullName: "User", username: "user123", email: "u@example.com", password: "Password123!", ageConfirmed: true },
      extra: { role: "admin" },
    },
    {
      name: "LoginSchema",
      schema: LoginSchema,
      valid: { identifier: "user123", password: "Password123!" },
      extra: { sessionOverride: "root" },
    },
    {
      name: "ChangePasswordSchema",
      schema: ChangePasswordSchema,
      valid: { currentPassword: "OldPassword123!", newPassword: "NewPassword123!" },
      extra: { forceReset: true },
    },
    {
      name: "ForgotPasswordSchema",
      schema: ForgotPasswordSchema,
      valid: { email: "u@example.com" },
      extra: { bypassToken: "abc" },
    },
    {
      name: "ResetPasswordSchema",
      schema: ResetPasswordSchema,
      valid: { token: "a".repeat(32), password: "NewPassword123!" },
      extra: { userId: "victim" },
    },
    {
      name: "EmailVerificationRequestSchema",
      schema: EmailVerificationRequestSchema,
      valid: { email: "u@example.com" },
      extra: { skipVerification: true },
    },
    {
      name: "EmailVerificationConfirmSchema",
      schema: EmailVerificationConfirmSchema,
      valid: { email: "u@example.com", code: "123456" },
      extra: { role: "admin" },
    },
    {
      name: "AccountUpdateSchema",
      schema: AccountUpdateSchema,
      valid: { fullName: "User", username: "user123", email: "u@example.com" },
      extra: { ownerId: "attacker" },
    },
    {
      name: "OnboardingSchema",
      schema: OnboardingSchema,
      valid: { role: "marketer", goal: "grow", focus: "b2b" },
      extra: { permissions: ["all"] },
    },
    {
      name: "AddMemoryItemSchema",
      schema: AddMemoryItemSchema,
      valid: { text: "Simple memory note", category: "general" },
      extra: { id: "injected_id" },
    },
    {
      name: "ImportedMemoryItemSchema",
      schema: ImportedMemoryItemSchema,
      valid: { text: "Imported memory note", category: "general" },
      extra: { injected: 1 },
    },
    {
      name: "ImportMemoryPayloadSchema",
      schema: ImportMemoryPayloadSchema,
      valid: { brandName: "Brand", memories: [] },
      extra: { secretAdminFlag: true },
    },
  ];

  for (const { name, schema, valid, extra } of testCases) {
    const validRes = schema.safeParse(valid);
    assert.equal(validRes.success, true, `${name} should accept valid payload`);

    const attackPayload = { ...valid, ...extra };
    const attackRes = schema.safeParse(attackPayload);
    assert.equal(attackRes.success, false, `${name} should reject unexpected properties: ${Object.keys(extra)}`);
    const unrecognizedIssue = attackRes.error.issues.find((issue) => issue.code === "unrecognized_keys");
    assert.ok(unrecognizedIssue, `${name} issue code must be unrecognized_keys`);
    assert.throws(
      () => parseBody(schema, attackPayload),
      (err) => err.code === "VALIDATION_ERROR",
      `${name} parseBody must throw VALIDATION_ERROR`,
    );
  }
});

// ============================================================================
// SUITE 3: HTTP API Boundary Strictness (HTTP 400 VALIDATION_ERROR)
// ============================================================================

test("ADVERSARIAL: HTTP endpoints reject extra keys with HTTP 400 and VALIDATION_ERROR code", async (t) => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "helmer-adv-http-"));
  t.after(() => fs.rm(tmpDir, { recursive: true, force: true }));

  const userRepo = new FileUserRepository(path.join(tmpDir, "users.json"));
  const authStore = new FileAuthStore(path.join(tmpDir, "sessions.json"));

  // Create a verified active user
  const user = await userRepo.create({
    fullName: "API Tester",
    username: "apitester",
    email: "apitester@example.com",
    passwordHash: "$argon2id$v=19$m=19456,p=1,t=2$fakehash",
  });

  const app = express();
  app.use(express.json());
  app.use(createIdentityMiddleware({ authStore, userRepository: userRepo }));

  // Helper route to seed authenticated session
  app.get("/test/login-as-user", async (req, res) => {
    const rawToken = "test_session_token_12345678901234567890";
    const sessionId = (await import("../src/auth/password.js")).hashOpaqueToken(rawToken);
    await authStore.createSession(sessionId, user.id, 3600);
    res.setHeader("Set-Cookie", `helmer_session=${rawToken}; Path=/; HttpOnly; SameSite=Lax`);
    res.json({ ok: true, userId: user.id });
  });

  app.use(
    "/api/auth",
    createAuthRouter({
      userRepository: userRepo,
      authStore,
      emailService: { sendPasswordResetEmail: async () => {}, sendEmailVerificationCode: async () => {} },
      strategyRepository: { claimOwner: async () => 0 },
      appUrl: "http://localhost",
    }),
  );
  app.use(authErrorHandler);

  const server = app.listen(0, "127.0.0.1");
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  // Step 1: Login and get auth cookie
  const loginRes = await fetch(`${base}/test/login-as-user`);
  assert.equal(loginRes.status, 200);
  const cookie = loginRes.headers.get("set-cookie").split(";")[0];

  // Test 1: POST /api/auth/google with unexpected keys
  const googleTamperRes = await fetch(`${base}/api/auth/google`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      credential: "fake_jwt_token_for_adversarial_test",
      hackerKey: "unauthorized_property",
    }),
  });
  assert.equal(googleTamperRes.status, 400, "POST /api/auth/google should reject extra keys with HTTP 400");
  const googleTamperJson = await googleTamperRes.json();
  assert.equal(googleTamperJson.code, "VALIDATION_ERROR", "Response code must be VALIDATION_ERROR");
  assert.ok(googleTamperJson.error, "Error message must be present");

  // Test 2: PATCH /api/auth/settings with unexpected keys at root
  const settingsRootTamperRes = await fetch(`${base}/api/auth/settings`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: JSON.stringify({
      brandName: "Legit Brand",
      injectedField: "privilege_escalation_attempt",
    }),
  });
  assert.equal(settingsRootTamperRes.status, 400, "PATCH /api/auth/settings should reject root extra keys with HTTP 400");
  const settingsRootTamperJson = await settingsRootTamperRes.json();
  assert.equal(settingsRootTamperJson.code, "VALIDATION_ERROR");

  // Test 3: PATCH /api/auth/settings with unexpected keys in nested memory
  const settingsNestedTamperRes = await fetch(`${base}/api/auth/settings`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: JSON.stringify({
      memories: [
        {
          id: "mem_101",
          text: "Legit text note",
          category: "general",
          createdAt: "2026-10-01T12:00:00Z",
          unrecognizedNestedField: "hacked",
        },
      ],
    }),
  });
  assert.equal(settingsNestedTamperRes.status, 400, "PATCH /api/auth/settings should reject nested extra keys with HTTP 400");
  const settingsNestedTamperJson = await settingsNestedTamperRes.json();
  assert.equal(settingsNestedTamperJson.code, "VALIDATION_ERROR");

  // Test 4: POST /api/auth/signup with unexpected keys
  const signupTamperRes = await fetch(`${base}/api/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      fullName: "New Hacker",
      username: "new_hacker",
      email: "hacker@example.com",
      password: "StrongPassword123!",
      ageConfirmed: true,
      role: "admin",
    }),
  });
  assert.equal(signupTamperRes.status, 400, "POST /api/auth/signup should reject role with HTTP 400");
  const signupTamperJson = await signupTamperRes.json();
  assert.equal(signupTamperJson.code, "VALIDATION_ERROR");

  // Test 5: POST /api/auth/login with unexpected keys
  const loginTamperRes = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      identifier: "apitester",
      password: "somepassword",
      extraLoginProp: "bypass",
    }),
  });
  assert.equal(loginTamperRes.status, 400, "POST /api/auth/login should reject extra keys with HTTP 400");
  const loginTamperJson = await loginTamperRes.json();
  assert.equal(loginTamperJson.code, "VALIDATION_ERROR");

  // Test 6: PATCH /api/auth/account with unexpected keys
  const accountTamperRes = await fetch(`${base}/api/auth/account`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: JSON.stringify({
      fullName: "API Tester Renamed",
      username: "apitester",
      email: "apitester@example.com",
      role: "admin",
      ownerId: "attacker",
    }),
  });
  assert.equal(accountTamperRes.status, 400, "PATCH /api/auth/account should reject extra keys with HTTP 400");
  const accountTamperJson = await accountTamperRes.json();
  assert.equal(accountTamperJson.code, "VALIDATION_ERROR");
});
