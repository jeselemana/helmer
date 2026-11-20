import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import {
  EPISTEMIC_HUMILITY_RULES,
  HELMER_BUILD_ARCHITECT_RULES,
  STRATEGY_PROMPT,
  REFINEMENT_PROMPT,
  ASSESSOR_PROMPT,
  ASK_INSTRUCTIONS,
  LOCAL_AZ_MODE_RULES,
  buildStrategyPrompt,
  buildAssessorPrompt,
  buildRefinementPrompt,
  buildAskPrompt,
} from "../src/services/ai/prompts.js";

test("1. EPISTEMIC_HUMILITY_RULES defines epistemic humility, honest uncertainty, and proactive solutions", () => {
  // Epistemic humility & honest acknowledgement
  assert.match(EPISTEMIC_HUMILITY_RULES, /Dürüstlük və Qeyri-müəyyənliyin İdarə Edilməsi/i);
  assert.match(EPISTEMIC_HUMILITY_RULES, /Bu sahə üzrə dəqiq rəsmi statistika əlimizdə yoxdur/);
  assert.match(EPISTEMIC_HUMILITY_RULES, /Bu detal məlum deyil/);

  // Prohibition on dead-end refusals ('bilmirəm') & proactive solutions mandate
  assert.match(EPISTEMIC_HUMILITY_RULES, /bilmirəm/);
  assert.match(EPISTEMIC_HUMILITY_RULES, /Ssenari A və Ssenari B/);
  assert.match(EPISTEMIC_HUMILITY_RULES, /addım-addım praktiki istiqamət/);
});

test("2. EPISTEMIC_HUMILITY_RULES strictly bans invented numbers and mandates ranges or formulas", () => {
  // Ban on invented numbers
  assert.match(EPISTEMIC_HUMILITY_RULES, /Rəqəm və Metrika İntizamı/i);
  assert.match(EPISTEMIC_HUMILITY_RULES, /aylıq 4,820 AZN/);
  assert.match(EPISTEMIC_HUMILITY_RULES, /bazarın 18\.4%-i/);

  // Mandatory range & benchmark or formula
  assert.match(EPISTEMIC_HUMILITY_RULES, /Bakı bazarında bu tip kampaniyalar üçün ilkin test büdcəsi adətən 500 – 1,200 AZN aralığında götürülür/);
  assert.match(EPISTEMIC_HUMILITY_RULES, /düstur\/məntiq ver və istifadəçidən əsas dəyişəni soruş/);
});

test("3. EPISTEMIC_HUMILITY_RULES balances bold operator tone against timid AI disclaimers", () => {
  // Avoid timid AI disclaimers
  assert.match(EPISTEMIC_HUMILITY_RULES, /Qorxaq AI/i);
  assert.match(EPISTEMIC_HUMILITY_RULES, /Mən sadəcə süni intellektəm/);
  assert.match(EPISTEMIC_HUMILITY_RULES, /Maliyyə məsləhəti deyil/);

  // Direct, confident leadership under uncertainty
  assert.match(EPISTEMIC_HUMILITY_RULES, /Bunu dəqiqləşdirmək lazımdır, amma gələn nəticəyə görə iki alternativ yolumuz var: A və B/);
});

test("4. Build Mode: STRATEGY_PROMPT, REFINEMENT_PROMPT, and ASSESSOR_PROMPT incorporate epistemic humility", () => {
  // Strategy prompt contains epistemic humility rules and local AZ mode rules
  assert.match(STRATEGY_PROMPT, /EPISTEMIC HUMILITY/i);
  assert.match(STRATEGY_PROMPT, /aylıq 4,820 AZN/);
  assert.match(STRATEGY_PROMPT, /Bakı bazarında bu tip kampaniyalar üçün ilkin test büdcəsi adətən 500 – 1,200 AZN aralığında götürülür/);
  assert.match(STRATEGY_PROMPT, /\[LOCAL_AZ_MODE\]/);

  // Refinement prompt contains epistemic humility rules
  assert.match(REFINEMENT_PROMPT, /EPISTEMIC HUMILITY/i);
  assert.match(REFINEMENT_PROMPT, /aylıq 4,820 AZN/);

  // Assessor prompt contains epistemic humility instruction
  assert.match(ASSESSOR_PROMPT, /Epistemic Humility/i);
  assert.match(ASSESSOR_PROMPT, /working assumptions with benchmark ranges/i);
});

test("5. LOCAL_AZ_MODE_RULES integrates metric discipline and senior strategist tone without breaking existing laws", () => {
  // Metric discipline in local mode finance
  assert.match(LOCAL_AZ_MODE_RULES, /Rəqəm və Metrika İntizamı/);
  assert.match(LOCAL_AZ_MODE_RULES, /500 – 1,200 AZN/);

  // Style and tone guidance in local mode
  assert.match(LOCAL_AZ_MODE_RULES, /Mən sadəcə süni intellektəm/);
  assert.match(LOCAL_AZ_MODE_RULES, /iki alternativ yolumuz var: A və B/);

  // Preserves existing local laws
  assert.match(LOCAL_AZ_MODE_RULES, /İstehlakçı Psixologiyası və Satış Vərdişləri/);
  assert.match(LOCAL_AZ_MODE_RULES, /Instagram/);
  assert.match(LOCAL_AZ_MODE_RULES, /TikTok/);
  assert.match(LOCAL_AZ_MODE_RULES, /VÖEN/);
  assert.match(LOCAL_AZ_MODE_RULES, /MMC/);
  assert.match(LOCAL_AZ_MODE_RULES, /İlk 7 gün/);
  assert.match(LOCAL_AZ_MODE_RULES, /İlk 30 gün/);
});

test("6. buildStrategyPrompt, buildAssessorPrompt, and buildRefinementPrompt assemble prompts with market directives and calibration", () => {
  const azStrategy = buildStrategyPrompt({ brief: "Bakıda kafe açırıq" });
  assert.match(azStrategy, /\[MARKET CONTEXT DIRECTIVE: Target market is detected as AZERBAIJAN/);
  assert.match(azStrategy, /EPISTEMIC HUMILITY/i);
  assert.match(azStrategy, /aylıq 4,820 AZN/);

  const globalStrategy = buildStrategyPrompt({ brief: "SaaS platform in USA" });
  assert.match(globalStrategy, /\[MARKET CONTEXT DIRECTIVE: Target market is detected as GLOBAL \/ INTERNATIONAL/);
  assert.match(globalStrategy, /EPISTEMIC HUMILITY/i);

  const azAssessor = buildAssessorPrompt({ brief: "Bakı brendi" });
  assert.match(azAssessor, /Epistemic Humility/i);

  const azRefinement = buildRefinementPrompt({ brief: "Bakı brendi" });
  assert.match(azRefinement, /EPISTEMIC HUMILITY/i);
});

test("7. Ask Mode: ASK_INSTRUCTIONS and buildAskPrompt integrate epistemic humility and proactive solutions", () => {
  assert.match(ASK_INSTRUCTIONS, /You are Helmer Ask/);
  assert.match(ASK_INSTRUCTIONS, /EPISTEMIC HUMILITY/i);
  assert.match(ASK_INSTRUCTIONS, /Bu sahə üzrə dəqiq rəsmi statistika əlimizdə yoxdur/);
  assert.match(ASK_INSTRUCTIONS, /aylıq 4,820 AZN/);
  assert.match(ASK_INSTRUCTIONS, /Bunu dəqiqləşdirmək lazımdır, amma gələn nəticəyə görə iki alternativ yolumuz var: A və B/);

  const promptWithContext = buildAskPrompt({
    strategyContext: "\n<context>Strategy</context>",
    taskContext: "\n<task>Task 1</task>",
    personalizationContext: "\n<user>Personal</user>",
  });

  assert.match(promptWithContext, /You are Helmer Ask/);
  assert.match(promptWithContext, /<context>Strategy<\/context>/);
  assert.match(promptWithContext, /<task>Task 1<\/task>/);
  assert.match(promptWithContext, /<user>Personal<\/user>/);
  assert.match(promptWithContext, /EPISTEMIC HUMILITY/i);
});

test("8. Ask handler and service wire calibrated prompts and search guidance", async () => {
  const serverCode = await fs.readFile(path.join(process.cwd(), "server.js"), "utf8");

  // Imports calibration utilities
  assert.match(serverCode, /import\s*\{[^}]*ASK_INSTRUCTIONS[^}]*\}\s*from\s*"\.\/src\/services\/ai\/prompts\.js"/);

  // Wires buildAskPrompt in request handling
  const askHandlerCode = await fs.readFile(path.join(process.cwd(), "src/http/ask-handler.js"), "utf8");
  assert.match(askHandlerCode, /buildAskPrompt\(\{/);

  // Search guidance includes epistemic humility & proactive leadership
  const serviceCode = await fs.readFile(path.join(process.cwd(), "test/helpers/legacy-google-grounded-ask.js"), "utf8");
  assert.match(serviceCode, /EPISTEMIC HUMILITY, ACCURACY & PROACTIVE LEADERSHIP/);
  assert.match(serviceCode, /NEVER hallucinate an invented number or feign certainty/);
  assert.match(serviceCode, /Never give a dead-end refusal or stop at "bilmirəm"/);
});

test("9. HELMER_BUILD_ARCHITECT_RULES enforces 2026 temporal reality and bans legacy models", () => {
  assert.match(HELMER_BUILD_ARCHITECT_RULES, /PRODUCT & SYSTEMS ARCHITECT/);
  assert.match(HELMER_BUILD_ARCHITECT_RULES, /2026-cı il reallığında/);
  assert.match(HELMER_BUILD_ARCHITECT_RULES, /Köhnə Modellərin Qadağası/);
  assert.match(HELMER_BUILD_ARCHITECT_RULES, /GPT-4o, Gemini 1\.5, Claude 3\.5/);
  assert.match(HELMER_BUILD_ARCHITECT_RULES, /\[High-tier Reasoning Model\]/);
  assert.match(HELMER_BUILD_ARCHITECT_RULES, /\[Low-latency High-throughput SLM\]/);
  assert.match(HELMER_BUILD_ARCHITECT_RULES, /\[Long-context Multimodal Engine\]/);
});

test("10. HELMER_BUILD_ARCHITECT_RULES enforces strict metric standards and anti-hallucination", () => {
  assert.match(HELMER_BUILD_ARCHITECT_RULES, /FAKTİKİ İNTİZAM VƏ METRİKA STANDARTLARI/);
  assert.match(HELMER_BUILD_ARCHITECT_RULES, /İstehsalat Datalarının Qadağası/);
  assert.match(HELMER_BUILD_ARCHITECT_RULES, /\[Hədəf KPI \/ Proyeksiya\]/);
  assert.match(HELMER_BUILD_ARCHITECT_RULES, /\[Hipotetik Bençmark Nümunəsi\]/);
  assert.match(HELMER_BUILD_ARCHITECT_RULES, /Mütləqiyyət İddialarının Qadağası/);
  assert.match(HELMER_BUILD_ARCHITECT_RULES, /Cərimələrin sıfırlanması/);
  assert.match(HELMER_BUILD_ARCHITECT_RULES, /100% schema guarantee/);
  assert.match(HELMER_BUILD_ARCHITECT_RULES, /75% xərc azalması/);
});

test("11. HELMER_BUILD_ARCHITECT_RULES integrates architecture routing, moat layers, and pre-flight checklist into prompts", () => {
  assert.match(HELMER_BUILD_ARCHITECT_RULES, /ARXİTEKTURA VƏ WORKFLOW ÇƏRÇİVƏSİ/);
  assert.match(HELMER_BUILD_ARCHITECT_RULES, /Model Routing Məntiqi/);
  assert.match(HELMER_BUILD_ARCHITECT_RULES, /Moat və Dəyər Qatı/);
  assert.match(HELMER_BUILD_ARCHITECT_RULES, /PRE-FLIGHT CHECKLIST/);

  // Embedded in STRATEGY_PROMPT, REFINEMENT_PROMPT, and ASSESSOR_PROMPT
  assert.match(STRATEGY_PROMPT, /PRODUCT & SYSTEMS ARCHITECT/);
  assert.match(STRATEGY_PROMPT, /2026-cı il reallığında/);
  assert.match(STRATEGY_PROMPT, /\[High-tier Reasoning Model\]/);
  assert.match(REFINEMENT_PROMPT, /PRODUCT & SYSTEMS ARCHITECT/);
  assert.match(REFINEMENT_PROMPT, /Mütləqiyyət İddialarının Qadağası/);
  assert.match(ASSESSOR_PROMPT, /PRODUCT & SYSTEMS ARCHITECT/);
});

