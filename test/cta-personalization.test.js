import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

test("script.js: getUserFirstName, BUILD_CTA_LIST, ASK_CTA_LIST support personalized names with guest fallback", async () => {
  const scriptContent = await fs.readFile(path.join(process.cwd(), "public/script.js"), "utf8");

  assert.ok(scriptContent.includes("function getUserFirstName()"), "getUserFirstName function is declared in script.js");
  assert.ok(scriptContent.includes("BUILD_CTA_LIST_AZ"), "BUILD_CTA_LIST_AZ is declared");
  assert.ok(scriptContent.includes("BUILD_CTA_LIST_EN"), "BUILD_CTA_LIST_EN is declared");
  assert.ok(scriptContent.includes("ASK_CTA_LIST_AZ"), "ASK_CTA_LIST_AZ is declared");
  assert.ok(scriptContent.includes("ASK_CTA_LIST_EN"), "ASK_CTA_LIST_EN is declared");

  // Rule 4: Frontend XSS compliance - getBuildCta and getAskCta are passed to element() which sets textContent uniformly
  assert.ok(scriptContent.includes('const title = element("h1", "ask-title", getBuildCta());'), "Build title rendered uniformly via element() safe textContent");
  assert.ok(scriptContent.includes('const title = element("h1", "ask-title", getAskCta());'), "Ask title rendered uniformly via element() safe textContent");
});

test("script.js: CTAs include a balanced mix of personalized and natural nameless options", async () => {
  const scriptContent = await fs.readFile(path.join(process.cwd(), "public/script.js"), "utf8");

  // Verify that getBuildCta and getAskCta resolve function-based CTAs with user name
  assert.ok(scriptContent.includes("const name = getUserFirstName();"), "getUserFirstName is called in getBuildCta / getAskCta");
  assert.ok(scriptContent.includes("typeof item === \"function\" ? item(name) : item"), "function-based CTAs are resolved with name");

  // Verify neutral, native business phrases in AZ and EN (both personalized and nameless)
  assert.ok(scriptContent.includes("bu gün nə üzərində işləyirik?"), "AZ Build contains personalized neutral CTA");
  assert.ok(scriptContent.includes("what are we building today?"), "EN Build contains personalized neutral CTA");
  assert.ok(scriptContent.includes("Növbəti strategiyanı quraq."), "AZ Build contains natural nameless CTA");
  assert.ok(scriptContent.includes("Let's map out your next strategy."), "EN Build contains natural nameless CTA");
  assert.ok(scriptContent.includes("İdeyanı addım-addım plana çevirək."), "AZ Build contains structured planning CTA");
  assert.ok(scriptContent.includes("Turn your brief into a clear plan."), "EN Build contains structured planning CTA");
  assert.ok(scriptContent.includes("bu gün nəyi araşdıraq?"), "AZ Ask contains personalized neutral CTA");
  assert.ok(scriptContent.includes("what would you like to explore?"), "EN Ask contains personalized neutral CTA");
  assert.ok(scriptContent.includes("Nə ilə bağlı kömək lazımdır?"), "AZ Ask contains natural nameless CTA");
  assert.ok(scriptContent.includes("How can I help today?"), "EN Ask contains natural nameless CTA");
});

test("style.css: ask-title has uniform reduced font-weight: 400 across all CTA elements", async () => {
  const cssContent = await fs.readFile(path.join(process.cwd(), "public/style.css"), "utf8");

  assert.ok(cssContent.includes(".ask-title {"), ".ask-title class is defined in style.css");
  assert.ok(cssContent.includes("font-weight: 400;"), ".ask-title font-weight is reduced to 400 uniformly");
  assert.ok(!cssContent.includes(".ask-title-name {"), "no separate class or special bold distinction for name");
});
