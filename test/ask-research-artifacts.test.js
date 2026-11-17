import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

import {
  selectResearchArtifactFormats,
  buildResearchArtifactSpecs,
  generateSelectiveResearchArtifacts,
} from "../src/services/artifacts/research-artifact-builder.js";
import {
  renderWord,
  renderExcel,
  renderPowerPoint,
  renderPDF,
  validateRenderedFile,
} from "../src/services/artifacts/renderers.js";
import { ArtifactRepository } from "../src/repositories/artifact-repository.js";
import { FileChatRepository } from "../src/repositories/file-chat-repository.js";
import { ResearchService } from "../src/services/ai/research-service.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

test("1. Markdown Fixes: Clean asterisk syntax and correct numbered list (<ol>) sequential parsing", async () => {
  const scriptContent = await fs.readFile(path.join(rootDir, "public/script.js"), "utf8");
  const styleContent = await fs.readFile(path.join(rootDir, "public/style.css"), "utf8");

  // Extract cleanMarkdownFormatting from script.js and run in isolation
  const fnMatch = scriptContent.match(/function cleanMarkdownFormatting\([\s\S]*?\n\}/);
  assert.ok(fnMatch, "cleanMarkdownFormatting must be defined in script.js");
  const cleanMarkdownFormatting = new Function(`${fnMatch[0]}; return cleanMarkdownFormatting;`)();

  // Test case A: "matters**:" broken punctuation collision
  const fixed1 = cleanMarkdownFormatting("1. Why it matters**: This is critical.");
  assert.equal(fixed1, "1. **Why it matters**: This is critical.");

  const fixed2 = cleanMarkdownFormatting("Here is what matters**: important finding.");
  assert.equal(fixed2, "**Here is what matters**: important finding.");

  // Test case B: "**matters:" missing closing asterisk before colon
  const fixed3 = cleanMarkdownFormatting("1. **Why it matters: Detailed note.");
  assert.equal(fixed3, "1. **Why it matters**: Detailed note.");

  // Test case C: Azerbaijani unicode characters in phrases
  const fixedAz = cleanMarkdownFormatting("Əsas nəticələr**: Bazar payı artır.");
  assert.equal(fixedAz, "**Əsas nəticələr**: Bazar payı artır.");

  // Test case D: Valid markdown **text**: must not be corrupted
  const validBold = cleanMarkdownFormatting("This is **already valid**: no changes needed.");
  assert.equal(validBold, "This is **already valid**: no changes needed.");

  // Test case E: CSS list styling ensures continuous 1, 2, 3 numbering
  assert.match(
    styleContent,
    /\.ask-rich-text ol,\s*\.ask-research-markdown ol,\s*\.prose ol\s*\{[\s\S]*?list-style-type:\s*decimal !important;/,
    "CSS must enforce list-style-type: decimal !important on ordered lists"
  );
  assert.match(
    styleContent,
    /\.ask-rich-text ol,\s*\.ask-research-markdown ol,\s*\.prose ol\s*\{[\s\S]*?counter-reset:\s*none !important;/,
    "CSS must prevent counter-reset on ordered lists"
  );
  assert.match(
    styleContent,
    /\.ask-rich-text ol > li,\s*\.ask-research-markdown ol > li,\s*\.prose ol > li\s*\{[\s\S]*?display:\s*list-item !important;/,
    "CSS must enforce display: list-item !important on ordered list items"
  );
});

test("2. Selective Artifact Selection: Never generates 4 formats blindly; picks 1 or at most 2 relevant formats", async () => {
  // Scenario A: Financial comparisons & tables -> strictly picks Excel + Word or Excel + PDF (max 2)
  const financialReport = `
# CapEx və OpEx Müqayisəsi: Cloud vs On-Premise

| İnfrastruktur | CapEx ($M) | OpEx İllik ($M) | 5 İllik TCO ($M) |
|---|---|---|---|
| AWS Cloud | $1.2M | $3.4M | $18.2M |
| On-Premises | $8.5M | $1.1M | $14.0M |

EBITDA marjası 24.5% səviyyəsində proqnozlaşdırılır. Bazar payı 12%-dən 18%-ə yüksələcək.
ROI 36 ay ərzində təmin olunur.
`;
  const formatsA = selectResearchArtifactFormats(financialReport, "Cloud vs On-Premises maliyyə xərcləri və TCO");
  assert.ok(formatsA.length >= 1 && formatsA.length <= 2, "Must select 1 or 2 formats");
  assert.ok(formatsA.includes("xlsx"), "Financial report with tables must include xlsx");
  assert.ok(!formatsA.includes("pptx"), "Table-heavy financial comparison should not include pptx blindly");
  assert.notEqual(formatsA.length, 4, "Must NEVER generate all 4 formats blindly");

  // Scenario B: Executive slide briefing & market trends -> picks pptx + docx or pptx + pdf
  const briefingReport = `
# 2026 AI Bazar Tendensiyaları: Rəhbərlik üçün İcraçı Brifinqi

- Tendensiya 1: Agentik sistemlər 45% avtomatlaşdırma təmin edir.
- Tendensiya 2: Kiçik ixtisaslaşmış modellər mərkəzi LLM-ləri əvəzləyir.
- Tendensiya 3: On-device süni intellekt enerji xərclərini azaldır.
- Tendensiya 4: Təhlükəsizlik və idarəetmə standartları məcburiləşir.
- Tendensiya 5: Müştəri xidmətlərində insan müdaxiləsi 60% azalır.

Bu icra xülasəsi c-level rəhbərlik və stakeholder brifinqi üçün hazırlanmışdır.
`;
  const formatsB = selectResearchArtifactFormats(briefingReport, "AI bazar tendensiyaları təqdimat və slayd brifinqi");
  assert.ok(formatsB.length >= 1 && formatsB.length <= 2, "Must select 1 or 2 formats");
  assert.ok(formatsB.includes("pptx"), "Executive presentation/briefing must include pptx");
  assert.ok(!formatsB.includes("xlsx"), "Non-tabular qualitative briefing should not include xlsx");
  assert.notEqual(formatsB.length, 4, "Must NEVER generate all 4 formats blindly");

  // Scenario C: Extensive strategic analysis & audit narrative -> picks docx (and maybe pdf), never 4
  const strategicAudit = `
# Müəssisə Kiber Təhlükəsizlik Auditi və Strateji Hesabatı

## 1. Mövcud Vəziyyətin Təhlili
Müəssisə daxilində informasiya təhlükəsizliyi siyasətlərinin auditi aparılmışdır.

## 2. Risk Faktorları və Zəif Nöqtələr
Giriş nəzarəti və audit jurnallarının mərkəzləşdirilməsi tələb olunur.

## 3. Strateji Tövsiyələr və Yol Xəritəsi
Növbəti 12 ay üçün sıfır etibar (Zero Trust) arxitekturasının tətbiqi tövsiyə edilir.
Geniş təhlil və audit nəticələri əsasında hüquqi və korporativ standartlar müəyyən edilmişdir.
`.repeat(3);
  const formatsC = selectResearchArtifactFormats(strategicAudit, "Kiber təhlükəsizlik auditi və strateji hesabat");
  assert.ok(formatsC.length >= 1 && formatsC.length <= 2, "Must select 1 or 2 formats");
  assert.ok(formatsC.includes("docx"), "Strategic audit report must include docx");
  assert.notEqual(formatsC.length, 4, "Must NEVER generate all 4 formats blindly");
});

test("3. Artifact Generation & Validation: Renders valid Word, Excel, PowerPoint, and PDF files", async () => {
  const sampleMarkdown = `
# Bazar Analizi və Maliyyə Göstəriciləri

| Şirkət | Gəlir ($M) | Bazar Payı |
|---|---|---|
| Alpha Corp | $150M | 45% |
| Beta LLC | $95M | 28% |

## Əsas Nəticələr
Bazar sabit artım nümayiş etdirir.
- Nəticə 1: Rəqabət kəskinləşir.
- Nəticə 2: Xərclər optimallaşdırılır.
`;
  const { wordSpec, excelSpec, pptSpec, pdfSpec } = buildResearchArtifactSpecs(
    sampleMarkdown,
    "Bazar Analizi",
    [{ title: "Reuters", url: "https://reuters.com", domain: "reuters.com" }],
    "az"
  );

  // 1. Render Word (.docx)
  const docxBuf = await renderWord(wordSpec);
  assert.ok(Buffer.isBuffer(docxBuf) && docxBuf.length > 500, "Word buffer must be valid");
  await validateRenderedFile(docxBuf, "docx");

  // 2. Render Excel (.xlsx)
  const xlsxBuf = await renderExcel(excelSpec);
  assert.ok(Buffer.isBuffer(xlsxBuf) && xlsxBuf.length > 500, "Excel buffer must be valid");
  await validateRenderedFile(xlsxBuf, "xlsx");

  // 3. Render PowerPoint (.pptx)
  const pptxBuf = await renderPowerPoint(pptSpec);
  assert.ok(Buffer.isBuffer(pptxBuf) && pptxBuf.length > 500, "PowerPoint buffer must be valid");
  await validateRenderedFile(pptxBuf, "pptx");

  // 4. Render PDF (.pdf)
  const pdfBuf = await renderPDF(pdfSpec);
  assert.ok(Buffer.isBuffer(pdfBuf) && pdfBuf.length > 500, "PDF buffer must be valid");
  assert.equal(pdfBuf.subarray(0, 4).toString(), "%PDF", "PDF header must start with %PDF");
  await validateRenderedFile(pdfBuf, "pdf");
});

test("4. End-to-End Deep Research Artifact Persistence: Artifacts stored safely and saved in chat.messages", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "helmer-research-artifacts-test-"));
  const artifactsDir = path.join(tempDir, "artifacts");
  const chatsFilePath = path.join(tempDir, "chats.json");
  await fs.mkdir(artifactsDir, { recursive: true });

  const artifactRepo = new ArtifactRepository(artifactsDir);
  const chatRepo = new FileChatRepository(chatsFilePath);

  const ownerId = "usr_" + randomUUID();
  const chatId = randomUUID();

  // Create an initial chat message with type: "research"
  const assistantMsgId = randomUUID();
  const initialChat = {
    id: chatId,
    ownerId,
    title: "Maliyyə Müqayisəsi",
    messages: [
      { id: randomUUID(), role: "user", content: "Maliyyə müqayisəsi apar", createdAt: new Date().toISOString() },
      {
        id: assistantMsgId,
        role: "assistant",
        type: "research",
        jobId: "job-12345",
        status: "running",
        content: "",
        artifacts: [],
        createdAt: new Date().toISOString(),
      },
    ],
  };
  await chatRepo.saveChat(initialChat);

  const fakeJob = {
    id: "job-12345",
    messageId: assistantMsgId,
    ownerId,
    chatId,
    prompt: "Maliyyə müqayisəsi və bazar payı",
    language: "az",
    googleSearchEnabled: false,
    sources: [],
    steps: [{ key: "synth", label: "Hesabat hazırlanır", status: "completed" }],
  };

  const sampleReport = `
# Maliyyə Təhlili və Bazar Müqayisəsi

| Şirkət | Gəlir ($M) | OpEx ($M) |
|---|---|---|
| Helmer AI | $50M | $12M |
| Rəqib A | $35M | $18M |

EBITDA marjası 32% təşkil edir.
`;

  // Generate selective artifacts
  const grounded = await generateSelectiveResearchArtifacts({
    job: { ...fakeJob, googleSearchEnabled: true },
    text: sampleReport,
    artifactRepository: artifactRepo,
  });
  assert.deepEqual(grounded, [], "Grounded reports cannot be sent to artifact generation");
  const generated = await generateSelectiveResearchArtifacts({
    job: fakeJob,
    text: sampleReport,
    artifactRepository: artifactRepo,
  });

  assert.ok(Array.isArray(generated), "Should return an array of generated artifacts");
  assert.ok(generated.length >= 1 && generated.length <= 2, "Should generate 1 or 2 artifacts");

  for (const art of generated) {
    assert.ok(art.id, "Artifact must have an ID");
    assert.ok(["xlsx", "docx", "pptx", "pdf"].includes(art.type), "Valid artifact type");
    assert.ok(art.size > 0, "Artifact size must be positive");
    assert.ok(art.downloadUrl.includes(`/api/artifacts/${art.id}/versions/`), "Must have valid downloadUrl");

    // Check file on disk
    const storedRecord = await artifactRepo.get(art.id, ownerId);
    assert.ok(storedRecord, "Artifact record must exist in artifact repository");
  }

  // Update chat message with generated artifacts
  fakeJob.artifacts = generated;
  fakeJob.status = "completed";
  fakeJob.content = sampleReport;

  const researchService = new ResearchService({
    chatRepository: chatRepo,
    artifactRepository: artifactRepo,
  });
  await researchService.persistJobMessage(fakeJob);

  // Verify chat has persisted artifacts across refresh / reload
  const reloadedChat = await chatRepo.getById(chatId, ownerId);
  assert.ok(reloadedChat, "Chat must exist");
  const reloadedMsg = reloadedChat.messages.find((m) => m.id === assistantMsgId);
  assert.ok(reloadedMsg, "Message must exist in chat");
  assert.equal(reloadedMsg.artifacts.length, generated.length, "Persisted artifacts must match generated artifacts");
  assert.equal(reloadedMsg.artifacts[0].id, generated[0].id, "Artifact ID must be preserved");
  assert.ok(reloadedMsg.artifacts[0].downloadUrl, "Download URL must be preserved");

  // Clean up
  await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
});

test("5. UI Integration: 3-dots (...) menu includes '{ad} kimi yüklə' and does not dump large cards in chat", async () => {
  const scriptContent = await fs.readFile(path.join(rootDir, "public/script.js"), "utf8");
  const styleContent = await fs.readFile(path.join(rootDir, "public/style.css"), "utf8");

  // Verify appendArtifactCards ignores research messages
  assert.match(
    scriptContent,
    /function appendArtifactCards\(content, message\) \{[\s\S]*?if \(message\.type === "research" \|\| message\.jobId\) return;/,
    "appendArtifactCards must skip research messages to avoid cluttering chat with big cards"
  );

  // Verify buildAskResponseMoreMenu is called for research messages
  assert.match(
    scriptContent,
    /actions\.append\([^)]*buildAskResponseMoreMenu\(message, messageIndex, isEn\)/,
    "Deep research card must append buildAskResponseMoreMenu to actions bar"
  );

  // Verify getArtifactFormatDisplayName exists and formats correctly
  assert.match(scriptContent, /function getArtifactFormatDisplayName\(/, "getArtifactFormatDisplayName function must exist");
  assert.match(
    scriptContent,
    /isEn \? `Download as \$\{formatName\}` : `\$\{formatName\} kimi yüklə`/,
    "Download menu item text must be formatted as '{ad} kimi yüklə' / 'Download as {name}'"
  );

  // Verify formatArtifactSize and format icons
  assert.match(scriptContent, /function formatArtifactSize\(/, "formatArtifactSize function must exist");
  assert.match(scriptContent, /function getArtifactFormatIcon\(/, "getArtifactFormatIcon function must exist");

  // Verify CSS styles for popover download items and format icons
  assert.match(styleContent, /\.ask-response-popover-item\.ask-artifact-download-item/, "CSS must have download item style");
  assert.match(styleContent, /\.ask-artifact-menu-icon\.is-excel/, "CSS must style excel icon");
  assert.match(styleContent, /\.ask-artifact-menu-icon\.is-word/, "CSS must style word icon");
  assert.match(styleContent, /\.ask-artifact-spinner/, "CSS must have .ask-artifact-spinner");
});
