import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";

import { SignupSchema, UserSettingsSchema } from "../src/auth/validation.js";
import { hashPassword } from "../src/auth/password.js";
import { FileUserRepository } from "../src/repositories/file-user-repository.js";
import { FileStrategyRepository } from "../src/repositories/file-strategy-repository.js";
import { FileChatRepository } from "../src/repositories/file-chat-repository.js";
import { FilePlannerRepository } from "../src/repositories/file-planner-repository.js";
import { FileAuthStore } from "../src/auth/auth-store.js";
import { signGuestId, verifyGuestCookie } from "../src/http/session.js";

test("Tier 4 - Scenario 1: Complete end-to-end guest-to-registered user lifecycle", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "tier4-lifecycle-"));
  const userRepo = new FileUserRepository(path.join(tmpDir, "users.json"));
  const stratRepo = new FileStrategyRepository(path.join(tmpDir, "strats.json"));
  const chatRepo = new FileChatRepository(path.join(tmpDir, "chats.json"));
  const plannerRepo = new FilePlannerRepository(path.join(tmpDir, "planner.json"));
  const authStore = new FileAuthStore(path.join(tmpDir, "auth.json"));

  // 1. User starts as guest with HMAC signed cookie
  const guestId = `guest_${randomUUID()}`;
  const signedCookie = signGuestId(guestId);
  const verifiedGuestId = verifyGuestCookie(signedCookie);
  assert.equal(verifiedGuestId, guestId, "Guest HMAC cookie must verify");

  // 2. Guest generates strategy in Build mode
  const initialStrategy = {
    title: "EcoPackaging Brand Strategy",
    summary: "Sustainable packaging market entry for Azerbaijan",
    context: {
      business: "Biodegradable packaging manufacturer",
      objective: "Capture 15% market share in food delivery sector",
      market: "Baku, Azerbaijan",
      targetAudience: "Restaurants and food delivery services",
    },
    sections: [
      { id: "sec_1", title: "Market Analysis", summary: "Eco demand rising", content: "Details...", bullets: ["B1"] },
      { id: "sec_2", title: "Target Persona", summary: "B2B restaurants", content: "Details...", bullets: ["B2"] },
      { id: "sec_3", title: "Go-to-Market", summary: "Direct sales", content: "Details...", bullets: ["B3"] },
    ],
    priorities: [{ title: "Direct Outreach", description: "Contact top 50 food chains", priority: "high" }],
    actionPlan: [{ phase: "Phase 1 (Month 1)", actions: ["Sample kit distribution"], expectedOutcome: "20 pilot clients" }],
    kpis: [{ name: "Pilot Conversion Rate", reason: "Measures product fit", target: "40%" }],
    risks: [{ risk: "Higher unit cost", mitigation: "Bulk discounts and eco subsidies" }],
    assumptions: ["Demand for green packaging continues to increase"],
    nextSteps: ["Finalize pricing tiers"],
  };

  const createdStrat = await stratRepo.create({
    clientSaveId: "guest_build_12345",
    brief: "Eco-friendly packaging manufacturer in Baku",
    answers: [],
    strategy: initialStrategy,
    versions: [{ versionNumber: 1, data: initialStrategy, changeRequest: "Initial build", createdAt: new Date().toISOString() }],
  }, guestId);

  assert.ok(createdStrat.id);

  // 3. Guest interacts in Ask mode
  const createdChat = await chatRepo.saveChat({
    ownerId: guestId,
    title: "Packaging Pricing Discussion",
    messages: [
      { role: "user", content: "What margin should I target for eco-packaging in Baku?" },
      { role: "assistant", content: "Target a 25-30% gross margin for B2B contracts." },
    ],
    strategyId: createdStrat.id,
  });

  // 4. Guest creates planner tasks
  await plannerRepo.addBatch(guestId, [
    { text: "Prepare sample kits", groupLabel: "Immediate", priority: "high" },
    { text: "Draft B2B contract terms", groupLabel: "Week 1", priority: "medium" },
  ]);

  assert.equal((await stratRepo.list(guestId)).length, 1);
  assert.equal((await chatRepo.list(guestId)).length, 1);
  assert.equal((await plannerRepo.list(guestId)).length, 2);

  // 5. User registers an account
  const signupPayload = {
    fullName: "EcoPack Founder",
    email: "founder@ecopack.az",
    username: "ecopack_baku",
    password: "StrongPassword2026!",
    ageConfirmed: true,
  };
  const signupParse = SignupSchema.safeParse(signupPayload);
  assert.ok(signupParse.success, "Signup payload must strictly validate");

  const passwordHash = await hashPassword(signupPayload.password);
  const newUser = await userRepo.create({
    fullName: "EcoPack Founder",
    username: signupPayload.username,
    email: signupPayload.email,
    passwordHash,
  });
  assert.ok(newUser.id);

  // User establishes session
  const sessionId = "sess_user_laptop_1";
  await authStore.createSession(sessionId, newUser.id, 86400);

  // 6. Claim guest assets for registered user
  await stratRepo.claimOwner(guestId, newUser.id);
  await chatRepo.claimOwner(guestId, newUser.id);
  // Planner claim: update tasks with ownerId = newUser.id
  const guestTasks = await plannerRepo.list(guestId);
  for (const task of guestTasks) {
    await plannerRepo.update(task.id, guestId, { ownerId: newUser.id });
  }

  // Verify assets migrated cleanly
  assert.equal((await stratRepo.list(guestId)).length, 0);
  assert.equal((await chatRepo.list(guestId)).length, 0);

  const userStrategies = await stratRepo.list(newUser.id);
  assert.equal(userStrategies.length, 1);
  assert.equal(userStrategies[0].id, createdStrat.id);

  const userChats = await chatRepo.list(newUser.id);
  assert.equal(userChats.length, 1);
  assert.equal(userChats[0].id, createdChat.id);

  // 7. User updates settings and brand memory
  const settingsPayload = {
    brandName: "EcoPack Azerbaijan",
    industry: "Sustainable Packaging",
    targetAudience: "B2B HoReCa sector",
    tone: "executive",
    memories: [
      {
        id: "mem_ecopack_1",
        text: "Məhsullarımız 100% kompostlana biləndir və plastik qadağasına uyğundur.",
        category: "business",
        createdAt: new Date().toISOString(),
      },
    ],
  };
  assert.ok(UserSettingsSchema.safeParse(settingsPayload).success);

  const userWithSettings = await userRepo.update(newUser.id, {
    settings: settingsPayload,
  });
  assert.equal(userWithSettings.settings.brandName, "EcoPack Azerbaijan");
  assert.equal(userWithSettings.settings.memories.length, 1);

  // 8. User refines strategy (Version 2)
  const refinedStrategy = {
    ...initialStrategy,
    title: "EcoPackaging Brand Strategy - Localized",
    summary: "Localized go-to-market plan focusing on Baku delivery apps",
  };
  const updatedStrat = await stratRepo.appendVersion(
    createdStrat.id,
    newUser.id,
    refinedStrategy,
    "Localized for Baku delivery apps"
  );
  assert.ok(updatedStrat);
  assert.equal(updatedStrat.versions.length, 2);
  assert.equal(updatedStrat.versions[1].versionNumber, 2);
  assert.equal(updatedStrat.versions[1].changeRequest, "Localized for Baku delivery apps");

  // 9. User schedules 14-day deletion lifecycle
  const scheduled = await userRepo.scheduleDeletion(newUser.id, 14);
  assert.equal(scheduled.status, "pending_deletion");
  assert.ok(scheduled.scheduledDeletionAt);

  // Verify session revocation
  await authStore.invalidateUserSessions(newUser.id);
  assert.equal(await authStore.getSession(sessionId), null, "Active session revoked on deletion scheduling");

  // 10. User changes mind and cancels deletion
  const restoredUser = await userRepo.cancelDeletion(newUser.id);
  assert.equal(restoredUser.status, "active");
  assert.equal(restoredUser.scheduledDeletionAt, null);

  // Strategies and data remain intact
  const finalStrats = await stratRepo.list(newUser.id);
  assert.equal(finalStrats.length, 1);
  assert.equal(finalStrats[0].versionCount, 2);

  await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
});

test("Tier 4 - Scenario 2: Multi-tenant concurrency & data isolation across 5 tenants", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "tier4-multitenant-"));
  const stratRepo = new FileStrategyRepository(path.join(tmpDir, "strats.json"));
  const chatRepo = new FileChatRepository(path.join(tmpDir, "chats.json"));
  const plannerRepo = new FilePlannerRepository(path.join(tmpDir, "planner.json"));
  const userRepo = new FileUserRepository(path.join(tmpDir, "users.json"));

  const tenantCount = 5;
  const tenants = [];

  for (let i = 0; i < tenantCount; i++) {
    const passwordHash = await hashPassword(`TenantPassword${i + 1}!`);
    const user = await userRepo.create({
      fullName: `Tenant ${i + 1}`,
      username: `tenant_${i + 1}`,
      email: `tenant${i + 1}@example.com`,
      passwordHash,
    });
    tenants.push(user);
  }

  // Each tenant creates strategies, chats, and tasks
  for (let i = 0; i < tenantCount; i++) {
    const tenantId = tenants[i].id;
    const stratData = {
      title: `Strategy for Tenant ${i + 1}`,
      summary: `Business summary for ${i + 1}`,
      context: {},
      sections: [],
      priorities: [],
      actionPlan: [],
      kpis: [],
      risks: [],
      assumptions: [],
      nextSteps: [],
    };

    // 2 strategies per tenant
    await stratRepo.create({
      clientSaveId: `cs_${tenantId}_1`,
      brief: `Brief 1 for ${i + 1}`,
      answers: [],
      strategy: stratData,
      versions: [{ versionNumber: 1, data: stratData, createdAt: new Date().toISOString() }],
    }, tenantId);

    await stratRepo.create({
      clientSaveId: `cs_${tenantId}_2`,
      brief: `Brief 2 for ${i + 1}`,
      answers: [],
      strategy: stratData,
      versions: [{ versionNumber: 1, data: stratData, createdAt: new Date().toISOString() }],
    }, tenantId);

    // 2 chats per tenant
    await chatRepo.saveChat({
      ownerId: tenantId,
      title: `Chat 1 for Tenant ${i + 1}`,
      messages: [{ role: "user", content: `Hello from tenant ${i + 1}` }],
    });
    await chatRepo.saveChat({
      ownerId: tenantId,
      title: `Chat 2 for Tenant ${i + 1}`,
      messages: [{ role: "user", content: `Follow-up from tenant ${i + 1}` }],
    });

    // 3 planner tasks per tenant
    await plannerRepo.addBatch(tenantId, [
      { text: `Task 1 for Tenant ${i + 1}` },
      { text: `Task 2 for Tenant ${i + 1}` },
      { text: `Task 3 for Tenant ${i + 1}` },
    ]);
  }

  // Verify strict isolation across all 5 tenants
  for (let i = 0; i < tenantCount; i++) {
    const tenantId = tenants[i].id;
    const tenantStrats = await stratRepo.list(tenantId);
    assert.equal(tenantStrats.length, 2, `Tenant ${i + 1} has exactly 2 strategies`);

    const tenantChats = await chatRepo.list(tenantId);
    assert.equal(tenantChats.length, 2, `Tenant ${i + 1} has exactly 2 chats`);

    const tenantTasks = await plannerRepo.list(tenantId);
    assert.equal(tenantTasks.length, 3, `Tenant ${i + 1} has exactly 3 tasks`);

    // Verify other tenants cannot access this tenant's strategy by ID
    const otherTenantId = tenants[(i + 1) % tenantCount].id;
    assert.equal(await stratRepo.getById(tenantStrats[0].id, otherTenantId), null);
    assert.equal(await chatRepo.getById(tenantChats[0].id, otherTenantId), null);
  }

  // Cascade deletion of Tenant 1: leaves Tenants 2, 3, 4, 5 completely untouched
  const tenant1Id = tenants[0].id;
  await stratRepo.deleteAllByOwner(tenant1Id);
  await chatRepo.deleteAllByOwner(tenant1Id);
  await plannerRepo.deleteAllByOwner(tenant1Id);

  assert.equal((await stratRepo.list(tenant1Id)).length, 0);
  assert.equal((await chatRepo.list(tenant1Id)).length, 0);
  assert.equal((await plannerRepo.list(tenant1Id)).length, 0);

  // Tenants 2..5 remain completely intact
  for (let i = 1; i < tenantCount; i++) {
    const tenantId = tenants[i].id;
    assert.equal((await stratRepo.list(tenantId)).length, 2);
    assert.equal((await chatRepo.list(tenantId)).length, 2);
    assert.equal((await plannerRepo.list(tenantId)).length, 3);
  }

  await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
});
