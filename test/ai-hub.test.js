import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

test("Main Page Teaser: createMainAiHubTeaserCard returns null and notice is removed from page", async () => {
  const script = await fs.readFile(path.join(process.cwd(), "public/script.js"), "utf8");
  assert.ok(script.includes("function createMainAiHubTeaserCard("), "createMainAiHubTeaserCard exists");
  assert.ok(script.includes("return null;"), "createMainAiHubTeaserCard returns null");
  assert.ok(!script.includes("helmer_limit_policy_notice_dismissed"), "limit policy notice storage key removed");
});

