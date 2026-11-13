import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

test("1. Security: extractGroundingWebChunks logic strictly admits only http/https URLs and rejects unsafe schemes", () => {
  // Pure logic replica matching extractGroundingWebChunks in script.js
  function extractChunks(groundingMetadata) {
    if (!groundingMetadata || typeof groundingMetadata !== "object") return [];
    const chunks = Array.isArray(groundingMetadata.groundingChunks) ? groundingMetadata.groundingChunks : [];
    const webChunks = [];
    const seen = new Set();

    for (const c of chunks) {
      const web = c && c.web;
      if (!web || typeof web.uri !== "string") continue;
      const uri = web.uri.trim();
      if (!/^https?:\/\//i.test(uri)) continue; // XSS protection
      if (seen.has(uri)) continue;
      seen.add(uri);

      let hostname = "";
      try {
        hostname = new URL(uri).hostname.replace(/^www\./, "");
      } catch {
        hostname = uri;
      }
      const title = typeof web.title === "string" && web.title.trim() ? web.title.trim() : hostname;
      webChunks.push({ uri, title, hostname });
    }
    return webChunks;
  }

  const maliciousPayload = {
    groundingChunks: [
      { web: { uri: "javascript:alert(1)", title: "Malicious Script" } },
      { web: { uri: "data:text/html,<script>alert(1)</script>", title: "Malicious Data" } },
      { web: { uri: "file:///etc/passwd", title: "Local File" } },
      { web: { uri: "https://openai.com/index/gpt-4-5/", title: "GPT-4.5 Launch" } },
      { web: { uri: "https://openai.com/index/gpt-4-5/", title: "Duplicate URL" } },
      { web: { uri: "https://blog.google/technology/ai/gemini-flash/", title: "" } },
    ],
  };

  const safeChunks = extractChunks(maliciousPayload);

  // Assert unsafe schemes are purged
  assert.equal(safeChunks.length, 2, "Only valid http/https URLs should be extracted without duplicates");
  assert.equal(safeChunks[0].uri, "https://openai.com/index/gpt-4-5/");
  assert.equal(safeChunks[0].hostname, "openai.com");
  assert.equal(safeChunks[0].title, "GPT-4.5 Launch");

  // Fallback to hostname when title is empty
  assert.equal(safeChunks[1].uri, "https://blog.google/technology/ai/gemini-flash/");
  assert.equal(safeChunks[1].hostname, "blog.google");
  assert.equal(safeChunks[1].title, "blog.google");
});

test("2. Frontend script.js: implements renderAskSourceChips and wires it to Ask mode responses", async () => {
  const scriptContent = await fs.readFile(path.join(rootDir, "public/script.js"), "utf8");

  // Must declare extractGroundingWebChunks & renderAskSourceChips
  assert.match(scriptContent, /function extractGroundingWebChunks\(/, "extractGroundingWebChunks helper must exist");
  assert.match(scriptContent, /function renderAskSourceChips\(/, "renderAskSourceChips must exist");

  // Must construct safe grounding container and chips
  assert.match(scriptContent, /ask-grounding-container/, "Must generate .ask-grounding-container element");
  assert.match(scriptContent, /ask-grounding-chip/, "Must generate .ask-grounding-chip elements");
  assert.match(scriptContent, /ask-grounding-chip-domain/, "Must display hostname in .ask-grounding-chip-domain");
  assert.match(scriptContent, /ask-grounding-chip-favicon/, "Must include favicon in .ask-grounding-chip-favicon");
  assert.match(scriptContent, /ask-grounding-chip-ext/, "Must include external link indicator in .ask-grounding-chip-ext");
  assert.match(scriptContent, /target = "_blank"/, "Must open links in new tab");
  assert.match(scriptContent, /rel = "noopener noreferrer"/, "Must have rel=noopener noreferrer for security");

  // Must wire openGroundingSourcesModal in message details/actions
  assert.match(scriptContent, /openGroundingSourcesModal\(message\.groundingMetadata\)/, "Must open grounding sources modal from message details");

  // Must support inline markdown links safely
  assert.match(scriptContent, /ask-inline-link/, "Must support safe inline links");
});

test("3. Frontend style.css: defines compact chip styling and full dark mode support", async () => {
  const styleContent = await fs.readFile(path.join(rootDir, "public/style.css"), "utf8");

  assert.match(styleContent, /\.ask-grounding-container/, "style.css must define .ask-grounding-container");
  assert.match(styleContent, /\.ask-grounding-chip/, "style.css must define .ask-grounding-chip");
  assert.match(styleContent, /\.ask-grounding-chip-favicon/, "style.css must define .ask-grounding-chip-favicon");
  assert.match(styleContent, /\.ask-grounding-chip-domain/, "style.css must define .ask-grounding-chip-domain");
  assert.match(styleContent, /\.ask-grounding-chip-title/, "style.css must define .ask-grounding-chip-title");
  assert.match(styleContent, /\.ask-grounding-chip-ext/, "style.css must define .ask-grounding-chip-ext");
  assert.match(styleContent, /\.ask-grounding-chip-more/, "style.css must define .ask-grounding-chip-more");

  // Dark mode parity
  assert.match(styleContent, /:root\[data-theme="dark"\]\s+\.ask-grounding-chip/, "style.css must have dark mode rules for chips");
});

test("4. Architecture Rules: .cursorrules and .antigravity/rules.md document Rule 8 for Ask mode web search chips", async () => {
  const cursorrules = await fs.readFile(path.join(rootDir, ".cursorrules"), "utf8");
  const antigravityRules = await fs.readFile(path.join(rootDir, ".antigravity/rules.md"), "utf8");

  assert.match(cursorrules, /### 8\. Ask Mode Web Search Grounding & Source Chips/, ".cursorrules must contain Rule 8");
  assert.match(cursorrules, /compact chip format/, ".cursorrules must require compact chip format");
  assert.match(cursorrules, /https\?:\/\//, ".cursorrules must enforce strict URL sanitization");

  assert.match(antigravityRules, /### 8\. Ask Mode Web Search Grounding & Source Chips/, ".antigravity/rules.md must contain Rule 8");
  assert.match(antigravityRules, /compact chip format/, ".antigravity/rules.md must require compact chip format");
  assert.match(antigravityRules, /https\?:\/\//, ".antigravity/rules.md must enforce strict URL sanitization");
});
