import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { TRANSLATIONS } from "../public/i18n.js";

test("i18n defines contextActions with key parity between AZ and EN", () => {
  assert.ok(TRANSLATIONS.az.ask.contextActions, "AZ ask.contextActions exists");
  assert.ok(TRANSLATIONS.en.ask.contextActions, "EN ask.contextActions exists");

  const expectedKeys = [
    "ariaToolbar",
    "analyze",
    "analyzePrompt",
    "prosAndCons",
    "prosAndConsPrompt",
    "roadmap",
    "roadmapPrompt",
    "bottlenecks",
    "bottlenecksPrompt",
    "taskPlan",
    "taskPlanPrompt",
    "taskBlockers",
    "taskBlockersPrompt",
    "taskEffort",
    "taskEffortPrompt",
    "taskSteps",
    "taskStepsPrompt",
  ];

  for (const key of expectedKeys) {
    assert.ok(TRANSLATIONS.az.ask.contextActions[key], `AZ contextActions.${key} is defined`);
    assert.ok(TRANSLATIONS.en.ask.contextActions[key], `EN contextActions.${key} is defined`);
  }

  // Exact names requested by user
  assert.equal(TRANSLATIONS.az.ask.contextActions.analyze, "Analiz et");
  assert.equal(TRANSLATIONS.az.ask.contextActions.prosAndCons, "Müsbət və mənfi tərəflərini araşdır");
  assert.equal(TRANSLATIONS.az.ask.contextActions.roadmap, "İcra xəritəsi hazırla");
});

test("script.js declares and exports createAskContextSuggestions", async () => {
  const js = await fs.readFile(path.join(process.cwd(), "public/script.js"), "utf8");

  assert.ok(
    js.includes("export function createAskContextSuggestions("),
    "createAskContextSuggestions function is declared and exported"
  );

  // Checks for elements and classes
  assert.ok(js.includes('element("div", "ask-context-suggestions")'), "Creates ask-context-suggestions container");
  assert.ok(js.includes('btn.className = "ask-context-suggestion-btn"'), "Creates ask-context-suggestion-btn button");
  assert.ok(js.includes('element("span", "ask-context-suggestion-icon")'), "Creates icon wrapper");
  assert.ok(js.includes('element("span", "ask-context-suggestion-label"'), "Creates safe label wrapper");

  // Wired into renderAsk
  assert.ok(
    js.includes("createAskContextSuggestions(isEn, selectedStrategy, selectedTask"),
    "createAskContextSuggestions is invoked in renderAsk when context is selected"
  );
  assert.ok(
    js.includes('form.insertAdjacentElement("afterend", contextSuggestions)'),
    "contextSuggestions element is inserted right after form in composerArea"
  );
});

test("style.css defines minimalist premium buttons, dark mode parity, and typing collapse", async () => {
  const css = await fs.readFile(path.join(process.cwd(), "public/style.css"), "utf8");

  assert.ok(css.includes(".ask-context-suggestions"), ".ask-context-suggestions container selector present");
  assert.ok(css.includes(".ask-context-suggestion-btn"), ".ask-context-suggestion-btn button selector present");
  assert.ok(css.includes(".ask-context-suggestion-icon"), ".ask-context-suggestion-icon selector present");
  assert.ok(css.includes(".ask-context-suggestion-label"), ".ask-context-suggestion-label selector present");

  // Smooth collapse on input typing
  assert.ok(
    css.includes(".ask-shell.is-empty.has-input .ask-context-suggestions") ||
    css.includes(".ask-shell.has-input .ask-context-suggestions"),
    "collapses suggestions when user starts typing"
  );

  // Dark mode parity
  assert.ok(
    css.includes('[data-theme="dark"] .ask-context-suggestion-btn') &&
    css.includes("html.dark .ask-context-suggestion-btn"),
    "Dark mode styles defined for ask-context-suggestion-btn"
  );

  // Responsive styles: Mobile stacks vertically at top-left of Input Bar without button box effect
  assert.ok(
    css.includes(".ask-context-suggestions") && css.includes("@media (max-width: 767px)"),
    "Mobile responsive media query exists for context suggestions"
  );
  assert.ok(
    css.includes("order: -1") && css.includes("flex-direction: column"),
    "Mobile positions suggestions above input bar and stacks vertically from top to bottom"
  );
  assert.ok(
    css.includes("background: transparent !important") && css.includes("border: none !important"),
    "Mobile removes button box effect for minimalist text/item appearance"
  );
});

test("script.js renders minimalist active context pill without dumping entire strategy title into placeholder", async () => {
  const js = await fs.readFile(path.join(process.cwd(), "public/script.js"), "utf8");

  assert.ok(
    js.includes('element(\n      "span",\n      "ask-active-context-label",\n      contextTitle || fallbackLabel\n    )'),
    "Active context pill displays concise truncated context title or fallback label"
  );
  assert.ok(
    js.includes('contextChip.title = contextTitle || fallbackLabel'),
    "Stores original full context title in hover title attribute"
  );
  assert.ok(
    !js.includes("input.placeholder = selectedStrategy?.title"),
    "Does not dump entire raw strategy title into input placeholder"
  );
});

