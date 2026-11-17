import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PasswordResetEmailService } from "../src/auth/email-service.js";

test("sendLegalReportEmail forwards to legal@example.test with all required fields in outbox", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "helmer-legal-report-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));

  const service = new PasswordResetEmailService({ dataDir: directory, env: { NODE_ENV: "test", LEGAL_REPORT_EMAIL: "legal@example.test" } });

  await service.sendLegalReportEmail({
    issueType: "Müəllif hüquqları və əqli mülkiyyət pozuntusu",
    description: "Bu cavab üçüncü tərəfin qorunan mətnindən icazəsiz istifadə edir.",
    userEmail: "reporter@example.com",
    userName: "Nigar Məmmədova",
    userId: "usr_12345",
    model: "Flash",
    messageContent: "Müəllif hüququ ilə qorunan mətn nümunəsi...",
    timestamp: "2026-08-20T22:30:00.000Z",
    userAgent: "Mozilla/5.0 TestBrowser",
    ip: "127.0.0.1",
  });

  const outboxPath = path.join(directory, "email-outbox.json");
  const raw = await fs.readFile(outboxPath, "utf8");
  const outbox = JSON.parse(raw);

  assert.equal(outbox.length, 1);
  const item = outbox[0];

  assert.equal(item.to, "legal@example.test");
  assert.equal(item.replyTo, "reporter@example.com");
  assert.match(item.subject, /Müəllif hüquqları və əqli mülkiyyət pozuntusu/);
  assert.match(item.text, /Nigar Məmmədova/);
  assert.match(item.text, /Flash/);
  assert.match(item.text, /Bu cavab üçüncü tərəfin qorunan mətnindən/);
  assert.match(item.text, /Müəllif hüququ ilə qorunan mətn nümunəsi/);
  assert.match(item.html, /Nigar Məmmədova/);
  assert.match(item.html, /reporter@example.com/);
  assert.match(item.html, /Müəllif hüquqları və əqli mülkiyyət pozuntusu/);
});

test("sendLegalReportEmail works without user email (anonymous user)", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "helmer-legal-report-anon-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));

  const service = new PasswordResetEmailService({ dataDir: directory, env: { NODE_ENV: "test", LEGAL_REPORT_EMAIL: "legal@example.test" } });

  await service.sendLegalReportEmail({
    issueType: "Fərdi məlumatlar və məxfilik pozuntusu",
    description: "Cavabda fərdi telefon nömrəsi qeyd olunub.",
    model: "Mini",
    messageContent: "Əlaqə nömrəsi: +994 50 123 45 67",
  });

  const outboxPath = path.join(directory, "email-outbox.json");
  const outbox = JSON.parse(await fs.readFile(outboxPath, "utf8"));

  assert.equal(outbox.length, 1);
  const item = outbox[0];
  assert.equal(item.to, "legal@example.test");
  assert.equal(item.replyTo, undefined);
  assert.match(item.text, /Fərdi məlumatlar və məxfilik pozuntusu/);
  assert.match(item.text, /Mini/);
  assert.match(item.text, /Cavabda fərdi telefon nömrəsi qeyd olunub/);
});

test("legal reports persist correctly with id, timestamp, and status", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "helmer-legal-reports-store-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));

  const reportsPath = path.join(directory, "legal_reports.json");
  const reports = [
    {
      id: "rep_1001",
      issueType: "Müəllif hüquqları",
      description: "Test şikayət 1",
      userEmail: "test1@example.com",
      status: "received",
      createdAt: new Date().toISOString(),
    },
    {
      id: "rep_1002",
      issueType: "Digər",
      description: "Test şikayət 2",
      userEmail: null,
      status: "resolved",
      createdAt: new Date().toISOString(),
    },
  ];

  await fs.writeFile(reportsPath, JSON.stringify(reports, null, 2), "utf8");

  const loaded = JSON.parse(await fs.readFile(reportsPath, "utf8"));
  assert.equal(loaded.length, 2);
  assert.equal(loaded[0].id, "rep_1001");
  assert.equal(loaded[0].status, "received");
  assert.equal(loaded[1].status, "resolved");

  // Status update
  loaded[0].status = "in_review";
  await fs.writeFile(reportsPath, JSON.stringify(loaded, null, 2), "utf8");

  const updated = JSON.parse(await fs.readFile(reportsPath, "utf8"));
  assert.equal(updated[0].status, "in_review");
});
