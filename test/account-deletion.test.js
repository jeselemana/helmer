import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { FileUserRepository } from "../src/repositories/file-user-repository.js";
import { FileStrategyRepository } from "../src/repositories/file-strategy-repository.js";
import { FileChatRepository } from "../src/repositories/file-chat-repository.js";
import { FilePlannerRepository } from "../src/repositories/file-planner-repository.js";
import { FileAuthStore } from "../src/auth/auth-store.js";
import { hashPassword } from "../src/auth/password.js";

test("14-day account deletion: schedule, cancel, and auto-purge with cascading cleanup", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "helmer-del-test-"));
  const usersPath = path.join(tmpDir, "users.json");
  const strategiesPath = path.join(tmpDir, "strategies.json");
  const chatsPath = path.join(tmpDir, "chats.json");
  const plannerPath = path.join(tmpDir, "planner.json");
  const authStorePath = path.join(tmpDir, "auth-store.json");

  const userRepo = new FileUserRepository(usersPath);
  const strategyRepo = new FileStrategyRepository(strategiesPath);
  const chatRepo = new FileChatRepository(chatsPath);
  const plannerRepo = new FilePlannerRepository(plannerPath);
  const authStore = new FileAuthStore(authStorePath);

  // 1. Create test user
  const passwordHash = await hashPassword("ValidPassword123!");
  const userA = await userRepo.create({
    fullName: "User A",
    username: "usera",
    email: "usera@example.com",
    passwordHash,
  });

  const userB = await userRepo.create({
    fullName: "User B",
    username: "userb",
    email: "userb@example.com",
    passwordHash,
  });

  // Create strategy, chat, and planner task for userA
  await strategyRepo.create({
    clientSaveId: "cs_1",
    brief: "Brief A",
    answers: [],
    strategy: { title: "Strat A", summary: "Summary A" },
    versions: [{ versionNumber: 1, data: { title: "Strat A" }, createdAt: new Date().toISOString() }],
  }, userA.id);

  await chatRepo.saveChat({
    ownerId: userA.id,
    title: "Chat A",
    messages: [{ role: "user", content: "Sual" }],
  });

  await plannerRepo.addBatch(userA.id, [{ text: "Tapşırıq A", groupLabel: "Qrup A" }]);

  // 2. Schedule deletion for User A (14 days)
  const scheduled = await userRepo.scheduleDeletion(userA.id, 14);
  assert.equal(scheduled.status, "pending_deletion");
  assert.ok(scheduled.deletionRequestedAt);
  assert.ok(scheduled.scheduledDeletionAt);

  const diffDays = (new Date(scheduled.scheduledDeletionAt).getTime() - new Date(scheduled.deletionRequestedAt).getTime()) / (1000 * 60 * 60 * 24);
  assert.ok(Math.abs(diffDays - 14) < 0.1);

  // 3. Purge running now should NOT delete User A because 14 days have not passed
  const purgedCount1 = await userRepo.purgeExpiredAccounts({
    strategyRepository: strategyRepo,
    chatRepository: chatRepo,
    plannerRepository: plannerRepo,
    authStore,
  });
  assert.equal(purgedCount1, 0);

  const stillUserA = await userRepo.findById(userA.id);
  assert.ok(stillUserA);

  // 4. Cancel deletion
  const restoredUserA = await userRepo.cancelDeletion(userA.id);
  assert.equal(restoredUserA.status, "active");
  assert.equal(restoredUserA.scheduledDeletionAt, null);
  assert.equal(restoredUserA.deletionRequestedAt, null);

  // 5. Simulate an expired user (e.g. deletion requested 15 days ago)
  const pastDate = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString();
  const pastScheduled = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(); // expired yesterday
  await userRepo.update(userA.id, {
    status: "pending_deletion",
    deletionRequestedAt: pastDate,
    scheduledDeletionAt: pastScheduled,
  }, { allowSystemFields: true });

  // 6. Run purge on expired accounts
  const purgedCount2 = await userRepo.purgeExpiredAccounts({
    strategyRepository: strategyRepo,
    chatRepository: chatRepo,
    plannerRepository: plannerRepo,
    authStore,
  });
  assert.equal(purgedCount2, 1);

  // User A should be completely gone from user repository
  const deletedUserA = await userRepo.findById(userA.id);
  assert.equal(deletedUserA, null);

  // User B should remain untouched
  const intactUserB = await userRepo.findById(userB.id);
  assert.ok(intactUserB);

  // User A's strategies, chats, and planner tasks must be completely deleted
  const remainingStrats = await strategyRepo.readAll();
  assert.equal(remainingStrats.filter((s) => s.ownerId === userA.id).length, 0);

  const remainingChats = await chatRepo.list(userA.id);
  assert.equal(remainingChats.length, 0);

  const remainingTasks = await plannerRepo.list(userA.id);
  assert.equal(remainingTasks.length, 0);

  // 7. Unverified signup accounts are removed after 24 hours.
  await userRepo.mutateUsers(state => {
    state.users.find(u => u.id === userB.id).createdAt = new Date(Date.now() - 24 * 60 * 60 * 1000 - 1).toISOString();
    return { store: state };
  });
  const unverifiedPurged = await userRepo.purgeExpiredAccounts({
    strategyRepository: strategyRepo,
    chatRepository: chatRepo,
    plannerRepository: plannerRepo,
    authStore,
  });
  assert.equal(unverifiedPurged, 1);
  assert.equal(await userRepo.findById(userB.id), null);

  // Cleanup
  await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
});
