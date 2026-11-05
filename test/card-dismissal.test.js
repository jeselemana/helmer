import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

test("script.js: Ask & Build starter guide cards are permanently dismissed across all modes", async () => {
  const scriptContent = await fs.readFile(path.join(process.cwd(), "public/script.js"), "utf8");

  // Function dismissHomeGuideCardsPermanently exists and is exported
  assert.ok(
    scriptContent.includes("export function dismissHomeGuideCardsPermanently()"),
    "dismissHomeGuideCardsPermanently function is exported"
  );

  // Both modes are permanently dismissed when X or dismiss is triggered
  assert.ok(
    scriptContent.includes('localStorage.setItem("helmer_guide_dismissed_build", "1")') &&
    scriptContent.includes('localStorage.setItem("helmer_guide_dismissed_ask", "1")'),
    "dismissing cards permanently sets both build and ask dismissal keys"
  );

  // Cross-mode check in createHomeGuideCards
  assert.ok(
    scriptContent.includes('localStorage.getItem("helmer_guide_dismissed_all") === "1"'),
    "createHomeGuideCards checks global guide dismissal key"
  );

  // Modal has dismiss button and start buttons dismiss cards
  assert.ok(
    scriptContent.includes("guide-modal-dismiss-btn"),
    "guide modal has dismiss button"
  );
  assert.ok(
    scriptContent.includes("dismissHomeGuideCardsPermanently();\n  closeGuideModal();"),
    "startInMode and applyStarterPrompt permanently dismiss guide cards"
  );
});

test("script.js: Archive research card and background CTA permanently store dismissal in localStorage", async () => {
  const scriptContent = await fs.readFile(path.join(process.cwd(), "public/script.js"), "utf8");

  // Archive research card
  assert.ok(
    scriptContent.includes('localStorage.getItem("helmer_archive_research_card_dismissed") === "1"'),
    "renderArchiveResearchCard checks localStorage for dismissal"
  );
  assert.ok(
    scriptContent.includes('localStorage.setItem("helmer_archive_research_card_dismissed", "1")'),
    "renderArchiveResearchCard persists dismissal on close, action, and card click"
  );

  // Archive background CTA
  assert.ok(
    scriptContent.includes('localStorage.getItem("helmer_archive_bg_cta_dismissed") === "1"'),
    "renderArchiveBackgroundCta checks localStorage for dismissal"
  );
  assert.ok(
    scriptContent.includes('localStorage.setItem("helmer_archive_bg_cta_dismissed", "1")'),
    "renderArchiveBackgroundCta persists dismissal in localStorage"
  );
});

test("script.js: release toast close button triggers permanent dismissal", async () => {
  const scriptContent = await fs.readFile(path.join(process.cwd(), "public/script.js"), "utf8");

  assert.ok(
    scriptContent.includes('button("✕", "v35-toast-close", dismissPermanently)'),
    "v35 toast close button invokes dismissPermanently so it never respawns"
  );
});

test("style.css: defines styles for guide modal dismiss button in light and dark mode", async () => {
  const css = await fs.readFile(path.join(process.cwd(), "public/style.css"), "utf8");

  assert.ok(css.includes(".guide-modal-dismiss-btn {"), ".guide-modal-dismiss-btn is styled in CSS");
  assert.ok(css.includes('[data-theme="dark"] .guide-modal-dismiss-btn'), "dark mode override exists for guide-modal-dismiss-btn");
});

test("AGENTS.md & GEMINI.md: contains Section 10 Zero Clutter Policy rule", async () => {
  const agentsMd = await fs.readFile(path.join(process.cwd(), "AGENTS.md"), "utf8");
  const geminiMd = await fs.readFile(path.join(process.cwd(), "GEMINI.md"), "utf8");

  for (const doc of [agentsMd, geminiMd]) {
    assert.ok(doc.includes("10. UI Card & Teaser Permanent Dismissal (Zero Clutter Policy)"), "Rule 10 title is present");
    assert.ok(doc.includes("Permanent Dismissal with X / Close"), "X / Close dismissal clause is documented");
    assert.ok(doc.includes("Zero Temporary Memory / No Session Clutter"), "Zero temporary memory clause is documented");
    assert.ok(doc.includes("Cross-Mode Cleanliness"), "Cross-mode cleanliness clause is documented");
    assert.ok(doc.includes("Interaction & Action Dismissal"), "Action dismissal clause is documented");
  }
});

test("mobile positioning: info cards are placed above the Input Bar and eliminated when a strategy is selected", async () => {
  const css = await fs.readFile(path.join(process.cwd(), "public/style.css"), "utf8");
  const js = await fs.readFile(path.join(process.cwd(), "public/script.js"), "utf8");

  // CSS: order: -1 on mobile home-guide-cards
  assert.ok(
    css.includes(".home-guide-cards {\n    order: -1;"),
    "home-guide-cards has order: -1 on mobile to place it above input bar"
  );

  // CSS: hide when strategy / active context chip exists
  assert.ok(
    css.includes(".ask-shell:has(.ask-active-context-chip) .home-guide-cards"),
    "home-guide-cards is hidden via CSS when strategy context chip exists"
  );

  // JS: createHomeGuideCards returns null when strategy or task is active
  assert.ok(
    js.includes("if (state.askStrategyId || state.askTaskId || state.strategy) {\n    return null;\n  }"),
    "createHomeGuideCards returns null when strategy or task is selected"
  );

  // JS: renderAsk eliminates guide cards when strategy or task is selected
  assert.ok(
    js.includes('const guideCards = (!isChatActive && !selectedStrategy && !selectedTask) ? createHomeGuideCards(isEn, "ask") : null;'),
    "renderAsk suppresses guide cards when a strategy or task is selected"
  );

  // JS: renderIntake eliminates guide cards when a strategy is active
  assert.ok(
    js.includes("const isStrategySelected = Boolean(state.strategy || state.askStrategyId || state.askTaskId);"),
    "renderIntake checks for active strategy before creating guide cards"
  );
});

