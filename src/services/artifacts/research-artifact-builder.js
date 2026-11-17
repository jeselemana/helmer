import { assertExecutionActive, assertExecutionAuthorized } from '../security/execution-control.js';
import { renderArtifact } from "./render.js";
import { createPluginRegistry } from "../plugins/registry.js";
import { renderWord, renderExcel, renderPowerPoint, renderPDF } from "./renderers.js";
import { safeArtifactFilename } from "../../repositories/artifact-repository.js";

/**
 * Heuristically selects 1 or at most 2 relevant artifact formats based on research content.
 * Never generates all 4 formats; strictly tailors to the structure and nature of the report.
 *
 * @param {string} text - The synthesized research text (markdown).
 * @param {string} prompt - The research query or prompt.
 * @returns {Array<"xlsx" | "docx" | "pptx" | "pdf">} Array containing 1 or 2 format extensions.
 */
export function selectResearchArtifactFormats(text = "", prompt = "") {
  const content = `${prompt}\n${text}`;

  // 1. Excel (xlsx) criteria:
  // Triggered only if text contains numerical comparisons, financial indicators,
  // CapEx/OpEx, market share percentages, or markdown tables.
  const hasMarkdownTable = /\|[^\n\r]+\|[\r\n]+\|?[\s:|-]+\|?[\r\n]+\|[^\n\r]+\|/.test(text);
  const financialPatterns = [
    /\b(?:capex|opex|ebitda|roi|cagr|irr|npv|tco)\b/i,
    /\b(?:maliyyə|bazar payı|gəlir|xərc|mənfəət|büdcə|qiymət|rentabellik)\b/i,
    /\b(?:revenue|margin|market share|valuation|financial|budget|forecast|pricing)\b/i,
    /\b\d+(?:\.\d+)?%\b/, // percentages
    /(?:\$|€|£|₼|AZN|USD|EUR)\s*\d+/, // currency figures
    /\b\d{1,3}(?:,\d{3})+(?:\.\d+)?\b/, // formatted numbers
  ];

  let excelScore = 0;
  if (hasMarkdownTable) excelScore += 5;
  for (const pattern of financialPatterns) {
    if (pattern.test(content)) excelScore += 1.5;
  }
  const numbersCount = (text.match(/\b\d+(?:\.\d+)?%?\b/g) || []).length;
  if (numbersCount >= 8) excelScore += 2;
  const isExcelCandidate = excelScore >= 4.5;

  // 2. PowerPoint (pptx) criteria:
  // Suitable for executive briefings, market trends, executive summaries, or bullet slide structures.
  const pptxPatterns = [
    /\b(?:təqdimat|slayd|brifinq|icra xülasəsi|əsas tendensiyalar|rəhbərlik üçün)\b/i,
    /\b(?:presentation|slide|deck|briefing|executive summary|market trends|key takeaways|board)\b/i,
    /\b(?:c-level|stakeholder|overview)\b/i,
  ];
  let pptxScore = 0;
  for (const pattern of pptxPatterns) {
    if (pattern.test(content)) pptxScore += 2;
  }
  const bulletCount = (text.match(/^[-*]\s+/gm) || []).length;
  if (bulletCount >= 5) pptxScore += 2;

  // 3. Word (docx) criteria:
  // Deep strategic analysis, extensive audit, or structured legal/business report.
  let wordScore = 0;
  const headingCount = (text.match(/^#{1,4}\s+/gm) || []).length;
  if (headingCount >= 3) wordScore += 3;
  if (text.length >= 1000) wordScore += 2;
  if (/\b(?:strateji|təhlil|hesabat|audit|analiz|rekomendasiya|strategic|analysis|report|recommendations|audit)\b/i.test(content)) {
    wordScore += 2;
  }

  // 4. PDF (pdf) criteria:
  // Formal executive summary, compact reading format, compliance.
  let pdfScore = 0;
  if (/\b(?:executive briefing|formal|whitepaper|rəsmi|arayış|briefing document)\b/i.test(content)) pdfScore += 3;
  if (text.length >= 800 && text.length <= 4000) pdfScore += 2;
  if (/\b(?:strateji|hesabat|icra|strategic|summary)\b/i.test(content)) pdfScore += 1;

  const selected = [];

  if (isExcelCandidate) {
    selected.push("xlsx");
    // Pick the best complementary format: Word or PDF
    if (wordScore >= pdfScore) {
      selected.push("docx");
    } else {
      selected.push("pdf");
    }
  } else {
    // Non-excel qualitative/strategic research: rank docx, pptx, pdf
    const candidates = [
      { format: "docx", score: wordScore + 1 }, // default strong baseline for research reports
      { format: "pptx", score: pptxScore },
      { format: "pdf", score: pdfScore },
    ].sort((a, b) => b.score - a.score);

    selected.push(candidates[0].format);
    if (candidates[1].score >= 3 && selected.length < 2) {
      selected.push(candidates[1].format);
    }
  }

  // Strictly enforce max 2 formats
  return selected.slice(0, 2);
}

/**
 * Helper to parse markdown into structured sections, tables, and lists.
 */
function parseMarkdownStructure(markdown = "", defaultTitle = "Research Report", language = "az") {
  const isEn = language === "en";
  const lines = String(markdown || "").replace(/\r/g, "").split("\n");

  let docTitle = "";
  for (const l of lines) {
    const m = l.trim().match(/^#\s+(.+)$/);
    if (m) {
      docTitle = m[1].replace(/[*_`]/g, "").trim().slice(0, 150);
      break;
    }
  }
  if (!docTitle) {
    docTitle = defaultTitle.slice(0, 150);
  }

  // Parse markdown tables
  const tables = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trim();
    if (line.startsWith("|") && line.endsWith("|")) {
      const nextLine = lines[i + 1]?.trim() || "";
      if (/^\|?[\s:|-]+\|?$/.test(nextLine)) {
        const parseRow = (r) => r.replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
        const rawHeaders = parseRow(line);
        // Ensure unique, clean headers
        const headerCounts = new Map();
        const headers = rawHeaders.map((h, idx) => {
          const clean = h.replace(/[^a-zA-Z0-9_\s-]/g, "").trim() || `Col_${idx + 1}`;
          const count = headerCounts.get(clean) || 0;
          headerCounts.set(clean, count + 1);
          return count > 0 ? `${clean}_${count + 1}` : clean;
        });

        const rows = [];
        i += 2;
        while (i < lines.length && lines[i].trim().startsWith("|") && lines[i].trim().endsWith("|")) {
          const row = parseRow(lines[i].trim());
          const fixedRow = headers.map((_, idx) => row[idx] || "");
          rows.push(fixedRow);
          i++;
        }
        if (headers.length > 0 && rows.length > 0) {
          tables.push({ headers: headers.slice(0, 8), rows: rows.slice(0, 100) });
        }
        continue;
      }
    }
    i++;
  }

  // Parse sections
  const sections = [];
  let curHeading = isEn ? "Executive Summary" : "İcra Xülasəsi";
  let curLevel = 1;
  let curParagraphs = [];
  let curLists = [];
  let curList = null;

  function flush() {
    if (curParagraphs.length > 0 || curLists.length > 0) {
      sections.push({
        heading: curHeading.slice(0, 150),
        level: curLevel,
        paragraphs: curParagraphs.slice(0, 25),
        lists: curLists.slice(0, 6),
        tables: [],
        pageBreak: false,
      });
      curParagraphs = [];
      curLists = [];
      curList = null;
    }
  }

  for (let j = 0; j < lines.length; j++) {
    const trimmed = lines[j].trim();
    if (trimmed.startsWith("```")) continue;
    if (trimmed.startsWith("|") && trimmed.endsWith("|")) continue;

    const hMatch = trimmed.match(/^(#{1,3})\s+(.+)$/);
    if (hMatch) {
      flush();
      curHeading = hMatch[2].replace(/[*_`]/g, "").trim();
      curLevel = Math.min(3, hMatch[1].length);
      continue;
    }

    const bMatch = trimmed.match(/^[-*]\s+(.+)$/);
    if (bMatch) {
      if (!curList || curList.ordered) {
        curList = { ordered: false, items: [] };
        curLists.push(curList);
      }
      curList.items.push(bMatch[1].replace(/[*_`]/g, "").trim().slice(0, 400));
      continue;
    }

    const nMatch = trimmed.match(/^\d+[.)]\s+(.+)$/);
    if (nMatch) {
      if (!curList || !curList.ordered) {
        curList = { ordered: true, items: [] };
        curLists.push(curList);
      }
      curList.items.push(nMatch[1].replace(/[*_`]/g, "").trim().slice(0, 400));
      continue;
    }

    if (!trimmed) {
      curList = null;
      continue;
    }

    const clean = trimmed.replace(/[*_`]/g, "").trim();
    if (clean) curParagraphs.push(clean.slice(0, 4000));
  }
  flush();

  if (sections.length === 0) {
    sections.push({
      heading: isEn ? "Overview" : "Xülasə",
      level: 1,
      paragraphs: [docTitle],
      lists: [],
      tables: [],
      pageBreak: false,
    });
  }

  if (tables.length > 0 && sections.length > 0) {
    sections[0].tables = [tables[0]];
  }

  return { docTitle, sections, tables };
}

/**
 * Builds compliant specifications for Word, Excel, PowerPoint, and PDF artifacts.
 */
export function buildResearchArtifactSpecs(markdown = "", prompt = "", sources = [], language = "az") {
  const isEn = language === "en";
  const defaultTitle = prompt
    ? (prompt.length > 60 ? `${prompt.slice(0, 58)}…` : prompt)
    : (isEn ? "Research Report" : "Araşdırma Hesabatı");

  const { docTitle, sections, tables } = parseMarkdownStructure(markdown, defaultTitle, language);

  const citations = (sources || []).slice(0, 25).map((s) => {
    let url = s.url || "https://helmeros.com";
    try {
      const parsed = new URL(url);
      if (!/^https?:$/i.test(parsed.protocol)) {
        url = "https://helmeros.com";
      }
    } catch {
      url = "https://helmeros.com";
    }
    return {
      title: String(s.title || s.domain || "Source").slice(0, 150),
      url,
    };
  });

  // 1. Word / PDF Specification
  const wordSpec = {
    title: docTitle.slice(0, 180),
    header: isEn ? "Helmer Deep Research Report" : "Helmer Strateji Araşdırma Hesabatı",
    footer: "Helmer · helmeros.com",
    accent: "1E40AF",
    fontSize: 11,
    citations,
    units: sections,
  };

  // PDF uses the exact same sectionSchema structure as Word
  const pdfSpec = {
    title: docTitle.slice(0, 180),
    header: isEn ? "Helmer Executive Briefing" : "Helmer İcraçı Hesabatı",
    footer: "Helmer · helmeros.com",
    accent: "1E40AF",
    fontSize: 10,
    citations,
    units: sections,
  };

  // 2. Excel Specification
  const excelUnits = [];
  if (tables.length > 0) {
    tables.slice(0, 18).forEach((t, tIdx) => {
      const rows = [
        t.headers.map((h) => ({ type: "text", value: h, formula: "", result: null, format: "", bold: true })),
      ];
      t.rows.forEach((r) => {
        const rowCells = r.map((c) => {
          const num = Number(c);
          if (c && !isNaN(num) && isFinite(num)) {
            return { type: "number", value: String(num), formula: "", result: null, format: "", bold: false };
          }
          return { type: "text", value: String(c || ""), formula: "", result: null, format: "", bold: false };
        });
        rows.push(rowCells);
      });

      const colEnd = String.fromCharCode(64 + Math.min(26, t.headers.length));
      const rowEnd = rows.length;
      excelUnits.push({
        name: `Sheet_${tIdx + 1}`,
        summary: isEn ? `Comparative Data Table ${tIdx + 1}` : `Müqayisəli Məlumat Cədvəli ${tIdx + 1}`,
        widths: t.headers.map(() => 22),
        rows,
        tables: [{ name: `Table_${tIdx + 1}`, range: `A1:${colEnd}${rowEnd}` }],
        conditionalFormats: [],
        charts: [],
      });
    });
  } else {
    excelUnits.push({
      name: "Analysis",
      summary: isEn ? "Key Strategic Metrics & Insights" : "Əsas Strateji Göstəricilər və Nəticələr",
      widths: [28, 55],
      rows: [
        [
          { type: "text", value: isEn ? "Dimension" : "İstiqamət", formula: "", result: null, format: "", bold: true },
          { type: "text", value: isEn ? "Key Metric / Finding" : "Əsas Göstərici / Tapıntı", formula: "", result: null, format: "", bold: true },
        ],
        ...sections.map((s) => [
          { type: "text", value: s.heading, formula: "", result: null, format: "", bold: false },
          { type: "text", value: s.paragraphs[0] || (s.lists[0]?.items[0]) || "", formula: "", result: null, format: "", bold: false },
        ]),
      ],
      tables: [{ name: "Analysis_Table", range: `A1:B${sections.length + 1}` }],
      conditionalFormats: [],
      charts: [],
    });
  }

  const excelSpec = {
    title: docTitle.slice(0, 180),
    header: isEn ? "Helmer Financial & Market Analysis" : "Helmer Maliyyə və Bazar Analizi",
    footer: "Helmer Workspace",
    accent: "1E40AF",
    fontSize: 11,
    citations,
    units: excelUnits,
  };

  // 3. PowerPoint Specification
  const pptUnits = [
    {
      layout: "title",
      title: docTitle.slice(0, 150),
      subtitle: isEn ? "Executive Strategic Research Briefing" : "Strateji Araşdırma və İcra Brifinqi",
      bullets: [],
      tables: [],
      charts: [],
      metrics: [],
      notes: "Helmer Strategic Briefing Deck",
    },
  ];

  sections.slice(0, 9).forEach((s) => {
    if (s.tables.length > 0) {
      pptUnits.push({
        layout: "table",
        title: s.heading.slice(0, 100),
        subtitle: "",
        bullets: [],
        tables: [{
          headers: s.tables[0].headers.slice(0, 6),
          rows: s.tables[0].rows.slice(0, 10),
        }],
        charts: [],
        metrics: [],
        notes: s.paragraphs.join("\n").slice(0, 500),
      });
    } else {
      const bullets = [];
      s.lists.forEach((l) => bullets.push(...l.items));
      if (bullets.length === 0) {
        s.paragraphs.forEach((p) => bullets.push(p.slice(0, 140)));
      }
      pptUnits.push({
        layout: "text",
        title: s.heading.slice(0, 100),
        subtitle: "",
        bullets: bullets.slice(0, 6),
        tables: [],
        charts: [],
        metrics: [],
        notes: s.paragraphs.join("\n").slice(0, 500),
      });
    }
  });

  const pptSpec = {
    title: docTitle.slice(0, 180),
    header: "Helmer Executive Deck",
    footer: "Helmer Workspace",
    accent: "1E40AF",
    fontSize: 12,
    citations,
    units: pptUnits,
  };

  return { wordSpec, excelSpec, pptSpec, pdfSpec };
}

const PLUGIN_METADATA = {
  xlsx: {
    id: "excel",
    name: "Excel",
    extension: "xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    outputLabel: "Excel Workbook",
    defaultTitleAz: "Bazar Müqayisəsi",
    defaultTitleEn: "Market Comparison",
  },
  docx: {
    id: "word",
    name: "Word",
    extension: "docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    outputLabel: "Word Document",
    defaultTitleAz: "Strateji Araşdırma Hesabatı",
    defaultTitleEn: "Strategic Research Report",
  },
  pptx: {
    id: "powerpoint",
    name: "PowerPoint",
    extension: "pptx",
    mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    outputLabel: "PowerPoint Presentation",
    defaultTitleAz: "İcraçı Brifinqi",
    defaultTitleEn: "Executive Briefing",
  },
  pdf: {
    id: "pdf",
    name: "PDF",
    extension: "pdf",
    mimeType: "application/pdf",
    outputLabel: "PDF Document",
    defaultTitleAz: "Formal İcra Xülasəsi",
    defaultTitleEn: "Executive Summary",
  },
};

/**
 * Generates and saves selective real artifacts (Word, Excel, PowerPoint, PDF) for a completed research job.
 *
 * @param {object} params
 * @param {object} params.job - The research job object.
 * @param {string} params.text - The research text report.
 * @param {object} params.artifactRepository - The ArtifactRepository instance.
 * @returns {Promise<Array<object>>} Generated artifacts array for message persistence.
 */
export async function generateSelectiveResearchArtifacts({ job, text, artifactRepository, signal = null }) {
  if (!artifactRepository || !job?.ownerId || !job?.chatId) {
    return [];
  }
  if (job.googleSearchEnabled !== false || job.groundingMetadata || job.sources?.length) return [];

  const selectedFormats = selectResearchArtifactFormats(text, job.prompt);
  if (!selectedFormats || selectedFormats.length === 0) {
    return [];
  }

  const isEn = job.language === "en";
  const { wordSpec, excelSpec, pptSpec, pdfSpec } = buildResearchArtifactSpecs(
    text,
    job.prompt,
    job.sources,
    job.language || "az",
  );

  const specMap = {
    docx: wordSpec,
    xlsx: excelSpec,
    pptx: pptSpec,
    pdf: pdfSpec,
  };

  const renderMap = {
    docx: renderWord,
    xlsx: renderExcel,
    pptx: renderPowerPoint,
    pdf: renderPDF,
  };

  const generated = [];

  try {
    for (const format of selectedFormats) {
      if (signal?.aborted) {
        throw new Error("Research artifact generation aborted");
      }
      try {
        const spec = createPluginRegistry().get(PLUGIN_METADATA[format].id).schemas.spec.parse(specMap[format]);
        const renderer = renderMap[format];
        if (!spec || !renderer) continue;

        const buffer = await renderArtifact(format, spec, { signal });
        signal?.throwIfAborted();

        const meta = PLUGIN_METADATA[format];
        const title = spec.title || (isEn ? meta.defaultTitleEn : meta.defaultTitleAz);

        signal?.throwIfAborted();
        await assertExecutionAuthorized(signal);
        const saved = await artifactRepository.save({
          ownerId: job.ownerId,
          chatId: job.chatId,
          plugin: {
            id: meta.id,
            name: meta.name,
            extension: meta.extension,
            mimeType: meta.mimeType,
            outputLabel: meta.outputLabel,
          },
          spec,
          buffer,
          execution: {
            status: "completed",
            startedAt: new Date().toISOString(),
            completedAt: new Date().toISOString(),
            steps: [],
          },
        });

        generated.push({
          id: saved.artifact.id,
          type: format,
          name: saved.artifact.filename,
          title,
          size: saved.artifact.size,
          downloadUrl: saved.artifact.downloadUrl,
          version: saved.artifact.version,
        });
      } catch (err) {
        assertExecutionActive(err, signal);
        console.warn(`[Research Artifacts] Failed to generate ${format} artifact:`, err?.message || err);
      }
    }
  } catch (err) {
    for (const art of generated.reverse()) {
      await artifactRepository.rollback?.(art, job.ownerId).catch(() => {});
    }
    assertExecutionActive(err, signal);
    return [];
  }

  return generated;
}
