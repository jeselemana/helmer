import { assertExecutionActive } from '../security/execution-control.js';
import { privacySnapshot, executionContext } from "../security/privacy-policy.js";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { aiConfig, hasGeminiConfiguration } from "./config.js";
import { getGeminiClient } from "./client.js";
import { extractGroundingSources } from "./strategy-service.js";
import { logWithoutBlocking } from "../learning/learning-loop-service.js";
import { generateSelectiveResearchArtifacts } from "../artifacts/research-artifact-builder.js";

export const CreateResearchJobSchema = z.object({
  prompt: z.string().trim().min(2).max(10000).optional(),
  query: z.string().trim().min(2).max(10000).optional(),
  chatId: z.string().regex(/^[0-9a-f-]{36}$/i).optional(),
  strategyId: z.string().regex(/^[0-9a-f-]{36}$/i).optional(),
  taskId: z.string().regex(/^[0-9a-f-]{36}$/i).optional(),
  language: z.enum(["az", "en"]).optional(),
}).strict().refine((data) => Boolean(data.prompt || data.query), {
  message: "Either prompt or query must be provided",
});

export const LOW_QUALITY_DOMAINS = Object.freeze([
  "quora.com",
  "reddit.com",
  "pinterest.com",
  "buzzfeed.com",
  "tiktok.com",
  "instagram.com",
  "facebook.com",
  "twitter.com",
  "x.com",
  "ehow.com",
  "wikihow.com",
  "answers.com",
  "about.com",
  "tripadvisor.com",
  "yelp.com",
  "teamazing.com",
  "teambuilding.com",
  "medium.com",
  "wordpress.com",
  "blogspot.com",
  "wixsite.com",
  "weebly.com",
  "tumblr.com",
  "hubspot.com",
  "neilpatel.com",
  "semrush.com",
  "ahrefs.com",
  "searchenginejournal.com",
  "searchengineland.com",
  "backlinko.com",
  "ezinearticles.com",
  "articlebiz.com",
  "slideshare.net",
  "scribd.com",
  "issuu.com",
  "patreon.com",
]);

export const HIGH_SIGNAL_DOMAINS = Object.freeze([
  "sec.gov",
  "reuters.com",
  "bloomberg.com",
  "ft.com",
  "wsj.com",
  "marketwatch.com",
  "cnbc.com",
  "investor.google.com",
  "investor.apple.com",
  "ir.aboutamazon.com",
  "semianalysis.com",
  "theinformation.com",
  "stratechery.com",
  "nextplatform.com",
  "anandtech.com",
  "tomshardware.com",
  "servethehome.com",
  "arxiv.org",
  "nature.com",
  "ieee.org",
  "acm.org",
  "science.org",
  "blog.google",
  "research.google",
  "deepmind.google",
  "openai.com",
  "anthropic.com",
  "meta.com",
  "ai.meta.com",
  "aws.amazon.com",
  "azure.microsoft.com",
  "blogs.microsoft.com",
  "developer.nvidia.com",
]);

import {
  isGroundedStrategyRecord,
  isGroundedPlannerTaskInput,
  resolveGroundedStrategyProvenance,
  stripInternalStrategyMetadata,
} from "./grounded-chat-retention.js";

export function isGoogleRelayHostOrUrl(value = "") {
  const raw = String(value || "").trim();
  if (!raw) return false;
  try {
    const parsed = raw.includes("://") ? new URL(raw) : new URL(`https://${raw}`);
    const host = parsed.hostname.toLowerCase().replace(/^(?:www\.)+/i, "").replace(/\.+$/, "");
    if (
      host === "vertexaisearch.cloud.google.com" ||
      host.endsWith(".vertexaisearch.cloud.google.com") ||
      parsed.pathname.includes("/grounding-api-redirect")
    ) {
      return true;
    }
    if (/^(?:[a-z0-9-]+\.)*google\.[a-z.]{2,6}$/i.test(host) && (parsed.pathname === "/url" || parsed.pathname.startsWith("/url/"))) {
      return true;
    }
  } catch {
    const lower = raw.toLowerCase();
    if (lower.includes("vertexaisearch.cloud.google.com") || lower.includes("grounding-api-redirect")) {
      return true;
    }
  }
  return false;
}

export function extractCleanDomain(urlOrDomain = "") {
  const raw = String(urlOrDomain || "").trim();
  if (!raw || /\s/.test(raw)) return "";
  if (isGoogleRelayHostOrUrl(raw)) return "";
  let host = raw.toLowerCase();
  try {
    if (raw.includes("://")) {
      const parsed = new URL(raw);
      if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || parsed.username || parsed.password) {
        return "";
      }
      if (isGoogleRelayHostOrUrl(parsed.href)) return "";
      host = parsed.hostname.toLowerCase();
    } else if (raw.includes("/") || raw.includes("?") || raw.includes("#")) {
      const parsed = new URL(`https://${raw}`);
      if (parsed.username || parsed.password || isGoogleRelayHostOrUrl(parsed.href)) return "";
      host = parsed.hostname.toLowerCase();
    }
  } catch {
    return "";
  }
  const clean = host.replace(/^(?:www\.)+/i, "").replace(/\.+$/, "");
  if (!clean) return "";
  if (
    clean === "vertexaisearch.cloud.google.com" ||
    clean.endsWith(".vertexaisearch.cloud.google.com") ||
    /\.(?:local|internal|localhost|localdomain|arpa|home|corp|lan)$/i.test(clean) ||
    /^(?:localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|172\.(?:1[6-9]|2\d|3[01])\.|\[?(?:::1|fe80:|fc00:|fd00:))/.test(clean)
  ) {
    return "";
  }
  if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i.test(clean)) {
    return "";
  }
  return clean;
}

const LOW_QUALITY_PATTERNS = Object.freeze([
  /(?:^|\.)blogspot\./i,
  /(?:^|\.)wordpress\./i,
  /(?:^|\.)wixsite\./i,
  /(?:^|\.)weebly\./i,
  /(?:^|\.)tumblr\./i,
]);

export function isLowQualityDomain(urlOrDomain = "") {
  const domain = extractCleanDomain(urlOrDomain);
  if (!domain) return false;
  if (LOW_QUALITY_DOMAINS.some((bad) => domain === bad || domain.endsWith(`.${bad}`))) {
    return true;
  }
  return LOW_QUALITY_PATTERNS.some((pattern) => pattern.test(domain));
}

export function isHighSignalDomain(urlOrDomain = "") {
  const domain = extractCleanDomain(urlOrDomain);
  if (!domain) return false;
  return HIGH_SIGNAL_DOMAINS.some((good) => domain === good || domain.endsWith(`.${good}`));
}

export function scoreDomain(urlOrDomain = "") {
  const domain = extractCleanDomain(urlOrDomain);
  if (!domain) return 0;
  if (isHighSignalDomain(domain)) return 10;
  if (isLowQualityDomain(domain)) return -10;
  return 1;
}

export const RESEARCH_STAGES = Object.freeze([
  {
    key: "plan",
    labelAz: "Mövzu üzrə araşdırma planı hazırlanır…",
    labelEn: "Formulating research plan and decomposition…",
  },
  {
    key: "search",
    labelAz: "Çoxmərhələli paralel axtarışlar icra edilir…",
    labelEn: "Executing multi-step parallel searches…",
  },
  {
    key: "gap_analysis",
    labelAz: "Məlumat boşluqları və göstəricilər çarpaz yoxlanılır…",
    labelEn: "Analyzing research gaps & cross-verifying metrics…",
  },
  {
    key: "synthesize",
    labelAz: "Dərin strateji hesabat sintez olunur…",
    labelEn: "Synthesizing deep strategic findings…",
  },
]);

export function buildResearchPrompt({
  prompt,
  language = "az",
  strategyContext = "",
  taskContext = "",
  gatheredEvidence = "",
  enableSearch = true,
}) {
  const isEn = language === "en";
  if (isEn) {
    return {
      systemInstruction: `You are Helmer's Deep Research Engine, a Principal Technology & Financial Strategist operating at CSO / Senior Research Director caliber.
${enableSearch ? 'You have real-time access to live Google Search Grounding to inspect current official filings, technical architectures, and financial disclosures.' : 'Live search is unavailable in this synthesis step. Use only the supplied research evidence, identify missing facts, and never claim to have performed a new search.'}

YOUR MISSION:
Deliver a comprehensive, rigorous, deeply reasoned, and quantitative strategic research report grounded in verified web data.

CRITICAL DEEP REASONING & EXECUTION DIRECTIVES:
1. FULL EXECUTION & COMPLETE DOSSIER MANDATE (STRICT BAN ON PARTIAL HALTING):
   - Fully and exhaustively answer ALL requirements, sections, points, and subheadings provided by the user.
   - If the user provides a multi-point request (e.g. 10 points or N distinct dimensions), systematically generate and render EVERY single section from 1 to the end using structured Markdown headings (##, ###) within this single dossier. Never truncate, omit, or summarize away any requested point.
   - Halting midway, answering only the first item(s), or emitting conversational pauses (e.g. "ready for the next part", "I will pause here for feedback", "shall we proceed to the next step?") is STRICTLY FORBIDDEN. You are an autonomous research engine, not a conversational back-and-forth bot; execute the entire inquiry completely to the end.
2. STRICT BAN ON TEXTBOOK DEFINITIONS & FILLER:
   - Avoid generic textbook definitions, dictionary phrasing, or filler preamble (e.g. "In today's fast-paced world...", "AI is rapidly growing...").
   - Cut straight to strategic reality, hard metrics, and decisive facts.
3. MANDATORY CONCRETE NUMBERS, MARGINS & BENCHMARKS:
   - Do NOT write general qualitative phrases like "significantly cheaper" or "vast improvement".
   - Provide concrete numbers, percentages, CapEx figures, TCO comparisons, FLOP/watt/dollar benchmarks, and operating margin breakdowns.
4. CONTRADICTORY ARGUMENTS & STRUCTURAL TRADE-OFFS:
   - Compare contrasting arguments directly (e.g. how internal TPU silicon deployment reduces GPU dependency vs real net Capex efficiency, custom software ecosystem switching costs, and developer friction).
5. SOURCE QUALITY & STRICT DOMAIN FILTERING:
   - Exclude low-credibility domains like teamazing.com, random personal blogs (wordpress, blogspot), content farms, and SEO platforms from research and citations.
   - Prioritize high-signal domains: SEC filings (10-K, 10-Q), earnings disclosures, premier analysis (SemiAnalysis, Reuters, Bloomberg, The Information, official engineering blogs).
   - Reject clickbait, aggregators, and unverified blogs.
   - Ground major findings contextually: [Domain: Title](URL).
   - Do NOT dump a raw wall of 20+ naked URLs at the end of the text. Primary citations will be neatly presented in the dedicated sources drawer.

REPORT STRUCTURE (PROFESSIONAL MARKDOWN):
- If the user provided numbered points or a multi-part inquiry (e.g. 10 points):
  # [Executive Subject Title]
  Render EVERY requested section systematically:
  ## 1. [Section Title]
  ...
  ## 10. [Section Title]
  Ensure every single section is comprehensively explored with deep data and strategic depth.
- If the user prompt is open-ended:
  # [Executive Title of Research Subject]
  ## 1. Executive Summary
  High-conviction strategic overview uniting core findings, market disbalances, and bottom-line verdict. No preamble.
  ## 2. Quantitative Benchmarks & Cost/Margin Breakdown
  Exact numbers, pricing benchmarks, CapEx figures, unit economics, and margin comparisons in comparative tables or structured metrics.
  ## 3. Architectural Differences & Strategic Trade-offs
  Technical hardware and infrastructure divergence, contrasting viewpoints, and structural friction points.
  ## 4. Strategic Implications & Actionable Decisions
  High-probability strategic opportunities, high-risk blind spots, and concrete next-step recommendations.`,
      userContent: `Conduct Deep Research on this topic. Fully answer all points, sections, and subheadings (e.g. if 10 points are requested, cover each from 1 to 10) in a single exhaustive report without halting or conversational pauses:\n${prompt}${strategyContext}${taskContext}${
        gatheredEvidence ? `\n\n[SYNTHESIZED RESEARCH EVIDENCE ACROSS PIPELINE PHASES]:\n${gatheredEvidence}` : ""
      }`,
    };
  }

  return {
    systemInstruction: `Sən Helmer-in Dərin Araşdırma (Deep Research) mühərrikisən — strateji təhlil və texnoloji-maliyyə araşdırmaları üzrə Baş Strateq (CSO / Principal Analyst) səviyyəsində işləyirsən.
${enableSearch ? 'Canlı veb axtarış və Google Search Grounding vasitəsilə ən son rəsmi hesabatlara, texniki arxitekturalara və maliyyə disclosures-ə çıxışın var.' : 'Bu sintez mərhələsində canlı axtarış əlçatan deyil. Yalnız təqdim edilmiş araşdırma sübutlarından istifadə et, çatışmayan faktları göstər və yeni axtarış apardığını iddia etmə.'}

SƏNİN MİSSİYAN:
İstifadəçinin mövzusu üzrə dərindən, hərtərəfli, dəqiq rəqəmlərə və yoxlanılmış mənbələrə əsaslanan yüksək intellektli strateji hesabat hazırlamaq.

CİDDİ DƏRİN TƏHLİL VƏ İCRA TƏLƏBLƏRİ:
1. TAM İCRA VƏ BÜTÖV HESABAT TƏLƏBİ (YARIMÇIQ KƏSİLMƏNİN QARŞISINI AL):
   - İstifadəçinin verdiyi bütün tələbləri, bölmələri və alt-başlıqları tam şəkildə sonuna qədər cavablandır.
   - İstifadəçi çoxbəndli sorğu (məsələn, 10 bənd və ya N sayda bölmə) irəli sürübsə, 1-ci bənddən sonuncu bəndə qədər BÜTÜN 10 bölməni strukturlaşdırılmış Markdown başlığı (##, ###) ilə tam hesabat kimi render et. Heç bir bəndi ötürmə, ixtisar etmə və ya ümumiləşdirmə.
   - Cavabı yarımçıq saxlamaq, "növbəti hissəyə hazıram", "davam etməyə hazıram", "növbəti mərhələlərə keçmək üçün təsdiq gözləyirəm" tipli söhbət frazaları işlətmək QƏTİ QADAĞANDIR. Sən çatbot deyilsən; işi bir dəfəyə, tam və müstəqil şəkildə sonuna qədər bitirən Dərin Araşdırma mühərrikisən.
2. GİRİŞ VƏ TƏRİF QADAĞASI:
   - Ümumi dərslik təriflərindən, lüğət izahlarından və boş giriş cümlələrindən QƏTİ QAÇ ("Bu günün sürətlə inkişaf edən dünyasında...", "Süni intellekt böyük əhəmiyyət kəsb edir..." kimi klişelər YASAQDIR). Birbaşa əsas faktlara, rəqəmlərə və strateji reallığa keç.
3. KONKRET RƏQƏMLƏR, MARJA VƏ BENCHMARK TƏLƏBİ:
   - Ümumi sözlər ("böyük qənaət", "yüksək sürət") əvəzinə MÜTLƏQ konkret rəqəmlər, faizlər, CapEx göstəriciləri, TCO (Total Cost of Ownership), FLOP/dollar səmərəliliyi və marja müqayisələri təqdim et.
4. ZİDDİYYƏTLİ ARQUMENTLƏR VƏ TRADE-OFF ANALİZİ:
   - Tək tərəfli tərif və ya marketinq bəyanatları yazma. Ziddiyyətli arqumentləri və real çətinlikləri dərindən müqayisə et (məsələn: daxili TPU istifadəsinin GPU asılılığını nə dərəcədə azaltdığı, proqram təminatı / CUDA ekosistemindən keçidin gizli xərcləri və real xalis marja qənaəti).
5. MƏNBƏ FİLTRLƏMƏSİ VƏ SİTAT KEYFİYYƏTİ:
   - teamazing.com, təsadüfi bloqlar (wordpress, blogspot və s.), SEO platformaları və marketinq aqreqatorları kimi qeyri-ciddi domenləri axtarışdan və istinadlardan tamamilə kənarlaşdır.
   - Yalnız rəsmi SEC filings (10-K, 10-Q), investor hesabatları, akademik tədqiqatlar və nüfuzlu texnoloji/maliyyə analizlərinə (SemiAnalysis, Reuters, Bloomberg, The Information və rəsmi mühəndislik bloqları) istinad et.
   - Hər bir əsas faktın yanında kontekstual citation saxla ([Domen: Başlıq](URL)).
   - Cavabın sonunda 20-30 linki ard-arda mətn kimi tökmə. Əsas istinadlar interfeys tərəfindən ayrıca açılıb-bağlanan Mənbələr kartında səliqəli şəkildə qruplaşdırılacaq.

HESABATIN STRUKTURU (MARKDOWN):
- Əgər istifadəçi nömrələnmiş konkret bölmələr (məsələn, 10 bənd) tələb edibsə:
  # [Mövzunun İcraçı Başlığı]
  İstifadəçinin tələb etdiyi BÜTÜN bölmələri sırası ilə:
  ## 1. [1-ci Bölmənin Başlığı]
  ...
  ## 10. [10-cu Bölmənin Başlığı]
  (Bütün bəndlər dərin təhlil, konkret rəqəmlər və ziddiyyətli arqumentlərlə tam yazılmalıdır).
- Əgər mövzu sərbəstdirsə:
  # [Araşdırma Mövzusunun İcraçı Başlığı]
  ## 1. Executive Summary (İcraçı Xülasə)
  Ən mühüm strateji tapıntıların, bazar disbalansının və yekun analitik hökmün konspektiv təhlili. Boş giriş olmadan, birbaşa strateji arqumentlə başla.
  ## 2. Rəqəmsal Benchmarklar və Xərc/Marja Müqayisəsi
  Konkret rəqəmlər, qiymət benchmarkları, infrastruktur xərcləri, investisiyalar (CapEx) və marja faizləri.
  ## 3. Texnoloji və Arxitektur Ziddiyyətlər (Trade-off Analizi)
  Daxili arxitektura və aparat təminatı fərqləri. Ziddiyyətli arqumentlərin dərindən toqquşdurulması.
  ## 4. Dərin Strateji Qərarlar və Təsirlər
  Qərarvericilər üçün risklər və yüksək təsirli inkişaf imkanları, konkret icra tövsiyələri.`,
    userContent: `Bu mövzu üzrə dərindən araşdırma apar və ətraflı hesabat tərtib et. İstifadəçinin sorğusundakı bütün tələbləri, bölmələri və alt-başlıqları (məsələn, 10 bənd tələb edilibsə, 1-dən 10-a qədər hər birini) tam və sonuna qədər cavablandır. Cavabı yarımçıq saxlamaq, 'növbəti hissəyə hazıram' tipli söhbət frazaları işlətmək qəti qadağandır:\n${prompt}${strategyContext}${taskContext}${
      gatheredEvidence ? `\n\n[ƏLDƏ EDİLMİŞ DƏRİN TƏDQİQAT FAKTLARI VƏ MƏNBƏLƏR]:\n${gatheredEvidence}` : ""
    }`,
  };
}

export function enrichSourcesFromText(extractedSources = [], markdownText = "") {
  const sources = [];
  const seenUrls = new Set();

  const addSource = (rawTitle, rawUrl, rawDomain) => {
    if (!rawUrl || typeof rawUrl !== "string") return;
    try {
      const parsed = new URL(rawUrl.trim());
      if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) return;
      if (isGoogleRelayHostOrUrl(parsed.href)) return;
      const cleanUrl = parsed.href;
      if (seenUrls.has(cleanUrl)) return;

      const hostDomain = extractCleanDomain(parsed.hostname);
      if (!hostDomain) return;
      if (isLowQualityDomain(hostDomain)) return;
      if (rawDomain && isLowQualityDomain(rawDomain)) return;
      const domain = hostDomain;

      seenUrls.add(cleanUrl);
      const isHighSignal = isHighSignalDomain(domain);
      sources.push({
        title: (rawTitle || domain || "Source").slice(0, 200),
        url: cleanUrl,
        domain,
        isHighSignal,
        score: scoreDomain(domain),
      });
    } catch {}
  };

  for (const s of extractedSources) {
    addSource(s.title, s.url, s.domain);
  }

  if (markdownText) {
    const linkRegex = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/gi;
    let match;
    while ((match = linkRegex.exec(markdownText)) !== null) {
      if (sources.length >= 35) break;
      addSource(match[1]?.trim(), match[2]?.trim(), null);
    }
  }

  return sources.sort((a, b) => (b.score || 0) - (a.score || 0));
}

export async function decomposeResearchTopic({
  prompt,
  language = "az",
  geminiClient = null,
  abortSignal = null,
}) {
  const isEn = language === "en";

  const fallbackSubqueries = isEn
    ? [
        {
          query: `${prompt} official reports financial disclosures SEC filings 2025 2026`,
          label: "Investigating official disclosures and SEC filings…",
        },
        {
          query: `${prompt} benchmarks pricing metrics infrastructure costs margin comparisons`,
          label: "Analyzing unit economics, CapEx, and cost benchmarks…",
        },
        {
          query: `${prompt} architecture technical differences structural trade-offs`,
          label: "Comparing technical architecture and infrastructure…",
        },
        {
          query: `${prompt} market dynamics contrasting arguments analysis SemiAnalysis`,
          label: "Evaluating contrasting market perspectives and risks…",
        },
      ]
    : [
        {
          query: `${prompt} rəsmi hesabatlar maliyyə göstəriciləri SEC filings 2025 2026`,
          label: "Rəsmi hesabatlar və maliyyə göstəriciləri araşdırılır…",
        },
        {
          query: `${prompt} xərc analizi qiymət benchmarkları marja göstəriciləri CapEx`,
          label: "Xərc analizi və marja göstəriciləri yoxlanılır…",
        },
        {
          query: `${prompt} texnoloji arxitektura fərqləri infrastruktur müqayisəsi`,
          label: "Arxitektura və infrastruktur fərqləri müqayisə edilir…",
        },
        {
          query: `${prompt} ziddiyyətli arqumentlər bazar analizi SemiAnalysis Reuters`,
          label: "Ziddiyyətli arqumentlər və bazar analizi qiymətləndirilir…",
        },
      ];

  try {
    const decompositionPrompt = isEn
      ? `You are an expert research planner. Decompose this research subject into 3 to 4 distinct, concrete, search-engine-ready sub-queries.
Focus on:
1. Exact numbers, benchmarks, and financial metrics.
2. Official filings, earnings reports, and regulatory disclosures.
3. Architecture, hardware infrastructure, and technical differences.
4. Contrasting arguments and strategic market trade-offs.

Topic: "${prompt}"

Return ONLY a valid JSON array of objects with "query" and "label" properties, for example:
[
  { "query": "exact search keywords", "label": "Short user-facing status description in English (e.g. Investigating TPU vs GPU costs...)" }
]`
      : `Sən tədqiqat planlaşdırıcısısan. Bu araşdırma mövzusunu axtarış sistemləri üçün 3-4 konkret alt-sorğuya parçala:
1. Konkret rəqəmlər, qiymət benchmarkları və maliyyə göstəriciləri.
2. Rəsmi hesabatlar, SEC sənədləri və investor disclosures.
3. Texniki arxitektura və infrastruktur fərqləri.
4. Ziddiyyətli arqumentlər və bazar trade-offları.

Mövzu: "${prompt}"

YALNIZ bu formatda JSON array qaytar:
[
  { "query": "dəqiq axtarış açar sözləri", "label": "İstifadəçi üçün qısa status mətni Azərbaycan dilində (məs. TPU və GPU xərcləri araşdırılır...)" }
]`;

    let responseText = "";
    if (geminiClient || hasGeminiConfiguration()) {
      const client = geminiClient || getGeminiClient();
      const res = await client.models.generateContent(
        {
          model: aiConfig.strategyModel || "gemini-3.8-flash",
          contents: decompositionPrompt,
          config: {
            maxOutputTokens: 1024,
            abortSignal,
          },
        },
        abortSignal ? { signal: abortSignal } : undefined,
      );
      responseText = res?.text?.trim() || "";
    }

    if (responseText) {
      const jsonMatch = responseText.match(/\[\s*\{[\s\S]*\}\s*\]/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        if (Array.isArray(parsed) && parsed.length >= 2) {
          return parsed.slice(0, 4).map((item, idx) => ({
            query: String(item.query || fallbackSubqueries[idx]?.query || prompt).trim(),
            label: String(item.label || fallbackSubqueries[idx]?.label || item.query).trim(),
          }));
        }
      }
    }
  } catch (error) {
    assertExecutionActive(error, abortSignal);
    // Fallback on error
  }

  return fallbackSubqueries;
}

export async function executeTargetedSearch({
  query,
  geminiClient = null,
  abortSignal = null,
}) {
  abortSignal?.throwIfAborted();
  let text = "";
  let sources = [];
  let metadata = null;

  if (geminiClient || hasGeminiConfiguration()) {
    try {
      const client = geminiClient || getGeminiClient();
      const res = await client.models.generateContent(
        {
          model: aiConfig.strategyModel || "gemini-3.8-flash",
          contents: `Search the web thoroughly for: "${query}". Provide verified facts, exact numbers, benchmarks, and citations. Strictly exclude low-credibility sources like teamazing.com, random personal blogs, and marketing/SEO platforms.`,
          config: {
            tools: [{ googleSearch: {} }],
            thinkingConfig: {
              thinkingLevel: "HIGH",
              thinkingBudget: 24576,
            },
            maxOutputTokens: 8192,
            abortSignal,
          },
        },
        abortSignal ? { signal: abortSignal } : undefined,
      );
      text = res?.text?.trim() || "";
      metadata = res?.candidates?.[0]?.groundingMetadata || res?.groundingMetadata;
      const extractedSources = extractGroundingSources(metadata);
      sources = enrichSourcesFromText(extractedSources, text);
      return { text, sources, metadata, ok: true };
    } catch (err) {
      assertExecutionActive(err, abortSignal);
      console.warn("[Deep Research] Gemini targeted search failed", { code: err?.code || "PROVIDER_ERROR" });
      return {
        text: "",
        sources: [],
        metadata: null,
        ok: false,
        failed: true,
        errorCode: err?.code || "PROVIDER_ERROR",
      };
    }
  }

  return {
    text: "",
    sources: [],
    metadata: null,
    ok: false,
    failed: true,
    errorCode: "PROVIDER_UNCONFIGURED",
  };
}

export async function analyzeResearchGaps({
  prompt,
  gatheredEvidence = "",
  language = "az",
  geminiClient = null,
  abortSignal = null,
}) {
  const isEn = language === "en";
  const fallbackGap = {
    hasGap: true,
    query: `${prompt} exact margin cost numbers vs estimates 2025 2026`,
    label: isEn
      ? "Filling critical data gap on margins & CapEx…"
      : "Marja və xərc üzrə çatışmayan rəqəmlər axtarılır…",
  };

  try {
    const gapPrompt = `You are a strategic research verifier performing Gap Analysis.
User inquiry: "${prompt}"

Current findings summary:
"${(gatheredEvidence || "").slice(0, 3000)}"

Identify if there is any critical missing quantitative metric (margin, CapEx, pricing benchmark) or conflicting assertion that requires a targeted follow-up search.
Return ONLY a JSON object:
{
  "hasGap": true,
  "query": "targeted search query to fill the gap",
  "label": "Short user-facing status in ${isEn ? "English" : "Azerbaijani"}"
}`;

    let responseText = "";
    if (geminiClient || hasGeminiConfiguration()) {
      const client = geminiClient || getGeminiClient();
      const res = await client.models.generateContent(
        {
          model: aiConfig.strategyModel || "gemini-3.8-flash",
          contents: gapPrompt,
          config: { maxOutputTokens: 512, abortSignal },
        },
        abortSignal ? { signal: abortSignal } : undefined,
      );
      responseText = res?.text?.trim() || "";
    }

    if (responseText) {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        if (parsed.hasGap && parsed.query) {
          return {
            hasGap: true,
            query: String(parsed.query).trim(),
            label: String(parsed.label || fallbackGap.label).trim(),
          };
        }
        if (parsed.hasGap === false) {
          return { hasGap: false };
        }
      }
    }
  } catch (error) {
    assertExecutionActive(error, abortSignal);
    // Fallback on error
  }

  return fallbackGap;
}

export class ResearchService {
  constructor({
    chatRepository,
    strategyRepository = null,
    plannerRepository = null,
    learningLoop = null,
    telemetryService = null,
    geminiClient = null,
    artifactRepository = null,
  }) {
    this.chatRepository = chatRepository;
    this.strategyRepository = strategyRepository;
    this.plannerRepository = plannerRepository;
    this.learningLoop = learningLoop;
    this.telemetryService = telemetryService;
    this.geminiClient = geminiClient;
    this.artifactRepository = artifactRepository;
    this.activeJobs = new Map();
    this.runningJobPromises = new Set();
  }

  async waitForAllJobs() {
    await Promise.allSettled(Array.from(this.runningJobPromises));
  }

  async recordProviderUsage(job, usage) {
    job.usageByModel ||= [];
    let entry = job.usageByModel.find(item => item.provider === usage.provider && item.model === usage.model);
    if (!entry) { entry = { provider: usage.provider, model: usage.model, inputTokens: 0, outputTokens: 0, searchCalls: 0, calls: 0 }; job.usageByModel.push(entry); }
    entry.inputTokens += usage.inputTokens; entry.outputTokens += usage.outputTokens; entry.searchCalls += usage.searchCalls; entry.calls++;
    await this.persistCheckpoint?.(job.id, { ownerId: job.ownerId, executionFence: job.executionFence, usageByModel: structuredClone(job.usageByModel) });
  }

  createInitialSteps(language = "az") {
    const isEn = language === "en";
    const now = new Date().toISOString();
    return RESEARCH_STAGES.map((stage, index) => ({
      key: stage.key,
      label: isEn ? stage.labelEn : stage.labelAz,
      status: index === 0 ? "running" : "pending",
      timestamp: now,
    }));
  }

  hasActiveJobForOwner(ownerId) {
    if (!ownerId) return false;
    for (const job of this.activeJobs.values()) {
      if (job.ownerId === ownerId && (job.status === "pending" || job.status === "running")) {
        return true;
      }
    }
    return false;
  }

  async createJob(args) {
    return this.createResearchJob(args);
  }

  async createResearchJob({
    ownerId,
    prompt,
    query,
    chatId = null,
    strategyId = null,
    taskId = null,
    language = "az",
    user = null,
    executionLease = null,
  }) {
    if (this.hasActiveJobForOwner(ownerId)) {
      const busyErr = new Error("Active research job already running for owner");
      busyErr.code = "EXECUTION_BUSY";
      busyErr.status = 429;
      throw busyErr;
    }
    const researchPrompt = (prompt || query || "").trim();
    const isEn = language === "en";
    const jobId = randomUUID();
    const messageId = randomUUID();
    const now = new Date().toISOString();

    let selectedStrategy = null;
    let selectedTask = null;
    let existingChat = null;
    if (chatId && this.chatRepository) {
      existingChat = await this.chatRepository.getById(chatId, ownerId);
    }
    const effectiveStrategyId = strategyId || existingChat?.strategyId || null;
    const effectiveTaskId = taskId || existingChat?.taskId || null;

    if (this.strategyRepository && typeof this.strategyRepository.loadOwnerProvenance === "function") {
      await this.strategyRepository.loadOwnerProvenance(ownerId).catch(() => {});
    }
    const allOwnerStrategies =
      this.strategyRepository && typeof this.strategyRepository.readAll === "function"
        ? await this.strategyRepository.readAll(ownerId).catch(() => [])
        : [];

    if (effectiveStrategyId && this.strategyRepository) {
      selectedStrategy = await this.strategyRepository.getById(effectiveStrategyId, ownerId);
      const strategyProvenance = resolveGroundedStrategyProvenance(
        ownerId,
        selectedStrategy || { id: effectiveStrategyId },
        allOwnerStrategies
      );
      if (strategyProvenance.grounded || isGroundedStrategyRecord(selectedStrategy)) {
        const restrictedErr = new Error("Veb araşdırması olan strategiyanı Deep Research-ə ötürmək mümkün deyil.");
        restrictedErr.code = "GROUNDED_STRATEGY_RESTRICTED";
        restrictedErr.status = 422;
        throw restrictedErr;
      }
      if (!selectedStrategy) {
        if (strategyId) {
          const notFoundErr = new Error("Seçilmiş strategiya tapılmadı.");
          notFoundErr.code = "NOT_FOUND";
          notFoundErr.status = 404;
          throw notFoundErr;
        }
        const restrictedErr = new Error("Veb araşdırması olan və ya silinmiş strategiyanı Deep Research-ə ötürmək mümkün deyil.");
        restrictedErr.code = "GROUNDED_STRATEGY_RESTRICTED";
        restrictedErr.status = 422;
        throw restrictedErr;
      }
    }
    if (effectiveTaskId && this.plannerRepository) {
      const tasks = await this.plannerRepository.list(ownerId);
      selectedTask = tasks.find((t) => t.id === effectiveTaskId) || null;
      if (taskId && !selectedTask) {
        const notFoundErr = new Error("Seçilmiş tapşırıq tapılmadı.");
        notFoundErr.code = "NOT_FOUND";
        notFoundErr.status = 404;
        throw notFoundErr;
      }
      if (selectedTask) {
        const taskStrategy =
          selectedTask.strategyId && this.strategyRepository
            ? await this.strategyRepository.getById(selectedTask.strategyId, ownerId)
            : null;
        const taskStrategyProvenance = selectedTask.strategyId
          ? resolveGroundedStrategyProvenance(ownerId, taskStrategy || { id: selectedTask.strategyId }, allOwnerStrategies)
          : { grounded: false };
        const isGroundedTask =
          isGroundedStrategyRecord(taskStrategy) ||
          taskStrategyProvenance.grounded ||
          Boolean(selectedTask.strategyId && this.strategyRepository && !taskStrategy) ||
          isGroundedPlannerTaskInput(
            ownerId,
            {
              strategyId: selectedTask.strategyId || null,
              strategyTitle: selectedTask.strategyTitle || null,
              tasks: [selectedTask],
              source: selectedTask.source || null,
              searchGrounded: Boolean(selectedTask.searchGrounded || selectedTask.groundingActive),
            },
            allOwnerStrategies
          );
        if (isGroundedTask) {
          const restrictedErr = new Error("Veb araşdırması olan strategiya tapşırığını Deep Research-ə ötürmək mümkün deyil.");
          restrictedErr.code = "GROUNDED_STRATEGY_RESTRICTED";
          restrictedErr.status = 422;
          throw restrictedErr;
        }
      }
    }

    const safeStrategyPayload =
      selectedStrategy?.strategy && typeof selectedStrategy.strategy === "object"
        ? stripInternalStrategyMetadata(selectedStrategy.strategy)
        : selectedStrategy?.strategy || {};

    const strategyContext = selectedStrategy
      ? `\n\n[STRATEGY CONTEXT]:\nTitle: ${selectedStrategy.title}\nBrief: ${JSON.stringify(selectedStrategy.brief || {})}\nStrategy Summary: ${JSON.stringify(safeStrategyPayload)}`
      : "";
    const taskContext = selectedTask
      ? `\n\n[TASK CONTEXT]:\nTask: ${selectedTask.text}\nGroup: ${selectedTask.groupLabel || "General"}`
      : "";

    const steps = this.createInitialSteps(language);

    const userMessage = {
      role: "user",
      content: researchPrompt,
      strategyTitle: selectedStrategy?.title || undefined,
      taskTitle: selectedTask?.text || undefined,
      createdAt: now,
    };

    const assistantMessage = {
      id: messageId,
      role: "assistant",
      type: "research",
      status: "pending",
      jobId,
      model: "gemini-3.8-flash",
      query: researchPrompt,
      steps,
      sources: [],
      artifacts: [],
      content: "",
      createdAt: now,
      updatedAt: now,
    };

    const intendedChatId = chatId || randomUUID();
    const startedAt = Date.now();
    const intent = { id: jobId, messageId, ownerId, chatId: intendedChatId, prompt: researchPrompt, language, strategyContext, taskContext, strategyId: effectiveStrategyId, taskId: effectiveTaskId, privacySnapshot: privacySnapshot(user), status: 'pending', steps, sources: [], artifacts: [], content: '', createdAt: now, deadlineAt: startedAt + 10 * 60 * 1000, checkpoint: {} };
    executionLease?.lease.signal?.throwIfAborted();
    executionLease?.controller?.signal.throwIfAborted();
    if (executionLease) executionLease.intent = intent;
    await this.prepareIntent?.(intent);
    const savedChat = await this.chatRepository.saveChat({
      mustExist: Boolean(chatId),
      id: intendedChatId,
      ownerId,
      title: !chatId ? (researchPrompt.length > 50 ? `${researchPrompt.slice(0, 48)}…` : researchPrompt) : undefined,
      appendMessages: [userMessage, assistantMessage],
      strategyId: effectiveStrategyId || null,
      taskId: effectiveTaskId || null,
    });

    const modelImprovement = user?.settings?.modelImprovement === true;

    const job = {
      id: jobId,
      messageId,
      ownerId,
      chatId: savedChat.id,
      prompt: researchPrompt,
      language,
      strategyContext,
      taskContext,
      strategyId: effectiveStrategyId,
      taskId: effectiveTaskId,
      modelImprovement,
      privacySnapshot: privacySnapshot(user),
      status: "pending",
      steps,
      sources: [],
      artifacts: [],
      groundingMetadata: null,
      content: "",
      error: null,
      createdAt: now,
      updatedAt: now,
      startedAt,
      deadlineAt: intent.deadlineAt,
      checkpoint: {},
      executionLease,
      subscribers: new Set(),
      abortController: new AbortController(),
    };

    if (executionLease) {
      const signals = [executionLease.lease.signal, executionLease.controller?.signal].filter(Boolean);
      const abort = () => job.abortController.abort(signals.find(signal => signal.aborted)?.reason);
      for (const signal of signals) { signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort(); }
      job.detachLease = () => { for (const signal of signals) signal.removeEventListener('abort', abort); };
    }

    this.activeJobs.set(jobId, job);

    const reqCtx = executionContext.getStore();
    if (reqCtx) {
      reqCtx.providerStarted = true;
    }

    if (this.prepareJob) await this.prepareJob(job);

    // Run execution asynchronously in background worker with dedicated execution context
    const execPromise = (async () => {
      try {
        const bgContext = {
          ownerId: job.ownerId,
          privacySnapshot: job.privacySnapshot,
          providerStarted: false,
          guest: typeof job.ownerId === 'string' && job.ownerId.startsWith('guest_'),
          signal: job.abortController.signal,
          controller: job.abortController,
          isBackgroundJob: true,
        };
        bgContext.assertAuthorized = () => this.assertJobAuthorized?.(job);
        bgContext.onProviderUsage = usage => this.recordProviderUsage(job, usage);
        await executionContext.run(bgContext, () => this.executeJob(jobId));
      } catch (err) {
        console.error(`[Deep Research] Unhandled worker error for job ${jobId}:`, err);
      }
    })();
    job.executionPromise = execPromise;
    this.runningJobPromises.add(execPromise);
    execPromise.finally(() => {
      this.runningJobPromises.delete(execPromise);
    });

    return {
      jobId,
      chatId: savedChat.id,
      message: assistantMessage,
    };
  }

  async executeJob(jobId) {
    const job = this.activeJobs.get(jobId);
    if (!job) return;

    let leaseTimer = null;
    let leaseToken = null;
    const leaseKey = `helmer:research:lease:${jobId}`;

    if (this.redis?.isReady) {
      leaseToken = randomUUID();
      job.researchLeaseToken = leaseToken;
      const acquired = await this.redis.set(leaseKey, leaseToken, { NX: true, PX: 60000 });
      if (!acquired) {
        console.warn(`[Deep Research] Job ${jobId} already leased by another replica.`);
        this.activeJobs.delete(jobId);
        return;
      }
      leaseTimer = setInterval(async () => {
        try {
          const renewed = await this.redis.eval(
            "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('pexpire', KEYS[1], 60000) else return 0 end",
            { keys: [leaseKey], arguments: [leaseToken] }
          );
          if (!renewed) {
            job.abortController?.abort(Object.assign(new Error("RESEARCH_LEASE_LOST"), { code: "EXECUTION_LOCK_LOST" }));
          }
        } catch {
          job.abortController?.abort(Object.assign(new Error("RESEARCH_LEASE_LOST"), { code: "EXECUTION_LOCK_LOST" }));
        }
      }, 15000);
      leaseTimer.unref();
    }

    const isEn = job.language === "en";
    job.status = "running";
    job.updatedAt = new Date().toISOString();

    if (!job.deadlineAt) {
      job.deadlineAt = (job.startedAt || Date.now()) + 10 * 60 * 1000;
    }
    const assertWithinDeadline = () => {
      job.abortController.signal.throwIfAborted();
      if (job.deadlineAt && Date.now() >= job.deadlineAt) {
        const timeoutErr = Object.assign(new Error("Research deadline exceeded"), {
          code: "EXECUTION_TIMEOUT",
          status: 504,
        });
        job.abortController.abort(timeoutErr);
        throw timeoutErr;
      }
    };

    const maxTimeout = setTimeout(() => {
      job.abortController?.abort(Object.assign(new Error("RESEARCH_TIMEOUT"), { code: "EXECUTION_TIMEOUT" }));
    }, Math.max(1, job.deadlineAt - Date.now()));
    maxTimeout.unref();

    const persistAndBroadcast = async (extraData = {}) => {
      assertWithinDeadline();
      job.updatedAt = new Date().toISOString();
      await this.persistJobMessage(job);
      this.broadcast(jobId, {
        type: "step",
        status: job.status,
        steps: job.steps,
        sources: job.sources,
        ...extraData,
      });
    };

    const MAX_SEARCH_ATTEMPTS = 2;
    const runBoundedSearch = async ({ query, stepKey, getCached, setCached, getAttempts, setAttempts }) => {
      const cached = getCached();
      if (cached && !cached.failed && cached.ok !== false) {
        return cached;
      }
      let attempts = Number(getAttempts() || 0);
      let lastResult = null;
      while (attempts < MAX_SEARCH_ATTEMPTS) {
        assertWithinDeadline();
        attempts += 1;
        setAttempts(attempts);
        const candidate = await executeTargetedSearch({
          query,
          geminiClient: this.geminiClient,
          abortSignal: job.abortController.signal,
        });
        if (!candidate.failed && candidate.ok !== false) {
          setCached(candidate);
          return candidate;
        }
        lastResult = candidate;
        await persistAndBroadcast({ currentStep: stepKey, stepStatus: "running" });
      }
      return lastResult || {
        text: "",
        sources: [],
        metadata: null,
        ok: false,
        failed: true,
        errorCode: "RETRY_LIMIT_EXCEEDED",
      };
    };

    try {
      assertWithinDeadline();
      // ----------------------------------------------------
      // STEP 1: Research Planning & Query Decomposition
      // ----------------------------------------------------
      const planStep = job.steps.find((s) => s.key === "plan") || job.steps[0];
      if (planStep) {
        planStep.status = "running";
        planStep.timestamp = new Date().toISOString();
      }
      await persistAndBroadcast({ currentStep: "plan", stepStatus: "running" });

      job.checkpoint ||= {};
      const subqueries = job.checkpoint.subqueries || await decomposeResearchTopic({
        prompt: job.prompt,
        language: job.language,
        geminiClient: this.geminiClient,
        abortSignal: job.abortController.signal,
      });
      job.checkpoint.subqueries = subqueries;

      if (planStep) {
        planStep.status = "completed";
        planStep.timestamp = new Date().toISOString();
        planStep.detail = isEn
          ? `${subqueries.length} targeted research dimensions identified`
          : `${subqueries.length} alt-istiqamət müəyyən edildi`;
      }

      // Add dynamic subsearch steps
      const newSteps = [planStep];
      subqueries.forEach((sq, idx) => {
        newSteps.push({
          key: `subsearch_${idx}`,
          label: sq.label,
          query: sq.query,
          status: "pending",
          timestamp: new Date().toISOString(),
        });
      });

      newSteps.push({
        key: "gap_analysis",
        label: isEn
          ? "Analyzing research gaps & missing metrics (Gap Analysis)…"
          : "Məlumat boşluqları və göstəricilər təhlil edilir (Gap Analysis)…",
        status: "pending",
        timestamp: new Date().toISOString(),
      });

      newSteps.push({
        key: "synthesize",
        label: isEn
          ? "Synthesizing deep strategic findings & executive report…"
          : "Dərin strateji hesabat və analitik nəticələr sintez olunur…",
        status: "pending",
        timestamp: new Date().toISOString(),
      });

      job.steps = newSteps;
      await persistAndBroadcast();

      // ----------------------------------------------------
      // STEP 2: Parallel Grounded Searches across Sub-queries
      // ----------------------------------------------------
      const searchResults = await Promise.allSettled(
        subqueries.map(async (sq, idx) => {
          const stepKey = `subsearch_${idx}`;
          const currentSubStep = job.steps.find((s) => s.key === stepKey);
          const cachedSearch = job.checkpoint.searches?.[idx];
          const isCachedCompleted = Boolean(cachedSearch && !cachedSearch.failed && cachedSearch.ok !== false);
          if (!isCachedCompleted) {
            if (currentSubStep) {
              currentSubStep.status = "running";
              currentSubStep.timestamp = new Date().toISOString();
            }
            await persistAndBroadcast({ currentStep: stepKey, stepStatus: "running" });
          }

          const result = await runBoundedSearch({
            query: sq.query,
            stepKey,
            getCached: () => job.checkpoint.searches?.[idx],
            setCached: (val) => {
              (job.checkpoint.searches ||= {})[idx] = val;
            },
            getAttempts: () => job.checkpoint.searchAttempts?.[idx] || 0,
            setAttempts: (val) => {
              (job.checkpoint.searchAttempts ||= {})[idx] = val;
            },
          });

          const searchSucceeded = !result.failed && result.ok !== false;
          if (currentSubStep) {
            currentSubStep.status = searchSucceeded ? "completed" : "failed";
            currentSubStep.timestamp = new Date().toISOString();
            const count = result.sources?.length || 0;
            currentSubStep.detail = searchSucceeded
              ? (count > 0
                ? `${count} ${isEn ? "sources verified" : "mənbə tapıldı"}`
                : (isEn ? "Searched" : "Yoxlanıldı"))
              : (isEn ? "Search failed" : "Axtarış uğursuz oldu");
          }

          if (searchSucceeded && result.sources?.length) {
            const seen = new Set(job.sources.map((s) => s.url));
            for (const s of result.sources) {
              if (!seen.has(s.url)) {
                seen.add(s.url);
                job.sources.push(s);
              }
            }
            job.sources.sort((a, b) => (b.score || 0) - (a.score || 0));
            this.broadcast(jobId, { type: "sources", sources: job.sources, count: job.sources.length });
          }

          await persistAndBroadcast({
            currentStep: stepKey,
            stepStatus: searchSucceeded ? "completed" : "failed",
          });
          return result;
        }),
      );
      assertWithinDeadline();

      // Collect findings text from all parallel searches
      let collectedEvidence = searchResults
        .filter((r) => r.status === "fulfilled" && !r.value?.failed && r.value?.ok !== false && r.value?.text)
        .map((r, i) => `### Sub-Research Dimension ${i + 1} (${subqueries[i]?.label}):\n${r.value.text}`)
        .join("\n\n");

      // ----------------------------------------------------
      // STEP 3: Gap Analysis & Follow-Up Targeted Search
      // ----------------------------------------------------
      const gapStep = job.steps.find((s) => s.key === "gap_analysis");
      if (gapStep) {
        gapStep.status = "running";
        gapStep.timestamp = new Date().toISOString();
      }
      await persistAndBroadcast({ currentStep: "gap_analysis", stepStatus: "running" });

      const gapResult = job.checkpoint.gapResult || await analyzeResearchGaps({
        prompt: job.prompt,
        gatheredEvidence: collectedEvidence,
        language: job.language,
        geminiClient: this.geminiClient,
        abortSignal: job.abortController.signal,
      });
      job.checkpoint.gapResult = gapResult;
      await persistAndBroadcast();

      let gapSearchSucceeded = true;
      if (gapResult.hasGap && gapResult.query) {
        if (gapStep) {
          gapStep.detail = gapResult.label || (isEn ? "Closing data gap…" : "Çatışmayan rəqəmlər axtarılır…");
        }
        await persistAndBroadcast({ currentStep: "gap_analysis", stepStatus: "running" });

        const gapSearch = await runBoundedSearch({
          query: gapResult.query,
          stepKey: "gap_analysis",
          getCached: () => job.checkpoint.gapSearch,
          setCached: (val) => {
            job.checkpoint.gapSearch = val;
          },
          getAttempts: () => job.checkpoint.gapSearchAttempts || 0,
          setAttempts: (val) => {
            job.checkpoint.gapSearchAttempts = val;
          },
        });
        gapSearchSucceeded = !gapSearch.failed && gapSearch.ok !== false;

        if (gapSearchSucceeded && gapSearch.sources?.length) {
          const seen = new Set(job.sources.map((s) => s.url));
          for (const s of gapSearch.sources) {
            if (!seen.has(s.url)) {
              seen.add(s.url);
              job.sources.push(s);
            }
          }
          job.sources.sort((a, b) => (b.score || 0) - (a.score || 0));
          this.broadcast(jobId, { type: "sources", sources: job.sources, count: job.sources.length });
        }

        if (gapSearchSucceeded && gapSearch.text) {
          collectedEvidence += `\n\n### Gap Analysis Findings (${gapResult.label}):\n${gapSearch.text}`;
        }
      }

      if (gapStep) {
        gapStep.status = gapSearchSucceeded ? "completed" : "failed";
        gapStep.timestamp = new Date().toISOString();
        gapStep.detail = gapSearchSucceeded
          ? (isEn
            ? "Critical metrics and data gaps verified"
            : "Faktlar və ziddiyyətli arqumentlər çarpaz yoxlanıldı")
          : (isEn ? "Follow-up search failed" : "Əlavə axtarış uğursuz oldu");
      }
      await persistAndBroadcast({
        currentStep: "gap_analysis",
        stepStatus: gapSearchSucceeded ? "completed" : "failed",
      });

      // ----------------------------------------------------
      // STEP 4: Deep Strategic Synthesis (Gemini 3.8 Flash High)
      // ----------------------------------------------------
      const synthStep = job.steps.find((s) => s.key === "synthesize");
      if (synthStep) {
        synthStep.status = "running";
        synthStep.timestamp = new Date().toISOString();
      }
      await persistAndBroadcast({ currentStep: "synthesize", stepStatus: "running" });

      const { systemInstruction, userContent } = buildResearchPrompt({
        prompt: job.prompt,
        language: job.language,
        strategyContext: job.strategyContext,
        taskContext: job.taskContext,
        gatheredEvidence: collectedEvidence,
      });

      let rawText = "";
      let metadata = null;
      let primarySucceeded = false;
      let response = null;

      if (job.checkpoint.synthesis) {
        ({ rawText, metadata, response } = job.checkpoint.synthesis);
        primarySucceeded = true;
      } else if (hasGeminiConfiguration() || this.geminiClient) {
        try {
          const gemini = this.geminiClient || getGeminiClient();
          response = await gemini.models.generateContent(
            {
              model: aiConfig.strategyModel || "gemini-3.8-flash",
              contents: userContent,
              config: {
                systemInstruction,
                tools: [{ googleSearch: {} }],
                thinkingConfig: {
                  thinkingLevel: "HIGH",
                  thinkingBudget: 24576,
                },
                maxOutputTokens: 16384,
                abortSignal: job.abortController.signal,
              },
            },
            job.abortController ? { signal: job.abortController.signal } : undefined,
          );

          rawText = response?.text?.trim() || "";
          job.provider = 'google'; job.model = aiConfig.strategyModel;
          metadata = response?.candidates?.[0]?.groundingMetadata || response?.groundingMetadata;
          const extractedSources = extractGroundingSources(metadata);
          const finalSources = enrichSourcesFromText(extractedSources, rawText);

          const seen = new Set(job.sources.map((s) => s.url));
          for (const s of finalSources) {
            if (!seen.has(s.url)) {
              seen.add(s.url);
              job.sources.push(s);
            }
          }
          job.sources.sort((a, b) => (b.score || 0) - (a.score || 0));
          if (rawText) primarySucceeded = true;
        } catch (geminiError) {
          assertExecutionActive(geminiError, job.abortController?.signal);
          console.warn("[Deep Research] Gemini 3.8 Flash High synthesis error, falling back:", geminiError?.message || geminiError);
        }
      }

      if (!primarySucceeded) {
        if (!collectedEvidence.trim() || !job.sources.length || (!hasGeminiConfiguration() && !this.geminiClient)) {
          throw Object.assign(new Error('Google Search Grounding unavailable'), { code: 'GROUNDING_UNAVAILABLE', status: 503 });
        }
        try {
          const gemini = this.geminiClient || getGeminiClient();
          const fallback = buildResearchPrompt({
            prompt: job.prompt,
            language: job.language,
            strategyContext: job.strategyContext,
            taskContext: job.taskContext,
            gatheredEvidence: collectedEvidence,
            enableSearch: false,
          });
          response = await gemini.models.generateContent(
            {
              model: aiConfig.strategyModel || "gemini-3.8-flash",
              contents: fallback.userContent,
              config: {
                systemInstruction: fallback.systemInstruction,
                maxOutputTokens: 8192,
                abortSignal: job.abortController.signal,
              },
            },
            job.abortController ? { signal: job.abortController.signal } : undefined,
          );
          rawText = response?.text?.trim() || "";
          job.provider = 'google';
          job.model = aiConfig.strategyModel || 'gemini-3.8-flash';
          const textSources = enrichSourcesFromText([], rawText);
          const seen = new Set(job.sources.map((s) => s.url));
          for (const s of textSources) {
            if (!seen.has(s.url)) {
              seen.add(s.url);
              job.sources.push(s);
            }
          }
          job.sources.sort((a, b) => (b.score || 0) - (a.score || 0));
        } catch (fallbackErr) {
          assertExecutionActive(fallbackErr, job.abortController?.signal);
          throw Object.assign(new Error('Google Search Grounding unavailable'), { code: 'GROUNDING_UNAVAILABLE', status: 503 });
        }
      }

      if (!rawText) {
        throw new Error(isEn ? "Research engine returned an empty response." : "Araşdırma mühərriki boş cavab qaytardı.");
      }
      const collectedQueries = new Set();
      let renderedEntryPoint = metadata?.searchEntryPoint?.renderedContent || null;
      for (const r of searchResults) {
        if (r.status === "fulfilled" && r.value?.metadata) {
          for (const q of r.value.metadata.webSearchQueries || []) {
            if (typeof q === "string" && q.trim()) collectedQueries.add(q.trim().slice(0, 160));
          }
          if (!renderedEntryPoint && typeof r.value.metadata.searchEntryPoint?.renderedContent === "string") {
            renderedEntryPoint = r.value.metadata.searchEntryPoint.renderedContent;
          }
        }
      }
      if (job.checkpoint?.gapSearch?.metadata) {
        for (const q of job.checkpoint.gapSearch.metadata.webSearchQueries || []) {
          if (typeof q === "string" && q.trim()) collectedQueries.add(q.trim().slice(0, 160));
        }
        if (!renderedEntryPoint && typeof job.checkpoint.gapSearch.metadata.searchEntryPoint?.renderedContent === "string") {
          renderedEntryPoint = job.checkpoint.gapSearch.metadata.searchEntryPoint.renderedContent;
        }
      }
      for (const q of metadata?.webSearchQueries || []) {
        if (typeof q === "string" && q.trim()) collectedQueries.add(q.trim().slice(0, 160));
      }
      for (const sq of subqueries || []) {
        if (collectedQueries.size >= 10) break;
        if (typeof sq?.query === "string" && sq.query.trim()) collectedQueries.add(sq.query.trim().slice(0, 160));
      }
      const mergedGroundingMetadata = {
        ...(metadata && typeof metadata === "object" ? metadata : {}),
        groundingChunks: job.sources.slice(0, 30).map((s) => ({ web: { uri: s.url, title: s.title || s.domain || "Source" } })),
        webSearchQueries: Array.from(collectedQueries).slice(0, 10),
        ...(renderedEntryPoint ? { searchEntryPoint: { renderedContent: String(renderedEntryPoint).slice(0, 50000) } } : {}),
      };
      metadata = mergedGroundingMetadata;
      job.checkpoint.synthesis = { rawText, metadata, response: response ? { usageMetadata: response.usageMetadata, usage: response.usage } : null };
      await persistAndBroadcast();

      if (synthStep) {
        synthStep.status = "completed";
        synthStep.timestamp = new Date().toISOString();
        synthStep.detail = isEn ? "Executive report ready" : "Yekun analitik hesabat hazırdır";
      }

      // Mark non-failed steps completed
      for (const step of job.steps) {
        if (step.status !== "failed") {
          step.status = "completed";
        }
      }

      job.content = rawText;
      job.groundingMetadata = metadata || undefined;
      job.updatedAt = new Date().toISOString();

      if (this.artifactRepository && job.chatId) {
        try {
          const generatedArtifacts = await generateSelectiveResearchArtifacts({
            job,
            text: rawText,
            artifactRepository: this.artifactRepository,
            signal: job.abortController?.signal,
          });
          job.artifacts = generatedArtifacts || [];
        } catch (artifactErr) {
          assertExecutionActive(artifactErr, job.abortController?.signal);
          console.warn("[Deep Research] Error generating selective artifacts:", artifactErr?.message || artifactErr);
          job.artifacts = [];
        }
      }

      job.abortController.signal.throwIfAborted();
      await this.assertJobAuthorized?.(job);
      job.status = "completed";
      await this.persistJobMessage(job);

      await this.broadcast(jobId, {
        type: "done",
        status: "completed",
        reply: rawText,
        sources: job.sources,
        artifacts: job.artifacts || [],
        groundingMetadata: metadata,
        steps: job.steps,
      });

      this.recordCompletion(job, response);
    } catch (error) {
      const abortReason = job.abortController?.signal?.reason || error;
      const isRestart = abortReason?.code === "RESEARCH_RESTART";
      const isAborted = Boolean(job.abortController?.signal?.aborted);
      job.status = isRestart ? "pending" : isAborted ? "cancelled" : "failed";
      job.error = isRestart
        ? null
        : isAborted
          ? (isEn ? "Research was canceled." : "Araşdırma dayandırıldı.")
          : (isEn ? "Research failed." : "Araşdırma zamanı xəta baş verdi.");

      if (!isRestart) {
        await this.rollbackJobArtifacts(job);
      }

      const currentRunning = job.steps.find((s) => s.status === "running");
      if (currentRunning) {
        currentRunning.status = isRestart ? "pending" : "failed";
      }

      await this.persistJobMessage(job).catch(() => {});

      await this.broadcast(jobId, {
        type: isRestart ? "step" : "failed",
        status: job.status,
        error: job.error,
        steps: job.steps,
      });
    } finally {
      clearTimeout(maxTimeout);
      if (leaseTimer) clearInterval(leaseTimer);
      if (this.redis?.isReady && leaseToken) {
        await this.redis.eval(
          "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
          { keys: [leaseKey], arguments: [leaseToken] }
        ).catch(() => {});
      }
      // Keep completed/failed job in memory for 1 hour to handle reconnects cleanly
      setTimeout(() => {
        this.activeJobs.delete(jobId);
      }, 60 * 60 * 1000).unref();
    }
  }

  broadcast(jobId, eventData) {
    const job = this.activeJobs.get(jobId);
    if (!job || !job.subscribers?.size) return;

    for (const send of job.subscribers) {
      try {
        send(eventData);
      } catch (err) {
        console.warn("[Deep Research] Error sending to subscriber:", err?.message || err);
      }
    }
  }

  subscribe(jobId, ownerId, onEvent) {
    const job = this.activeJobs.get(jobId);
    if (!job || job.ownerId !== ownerId) return null;

    job.subscribers.add(onEvent);
    return () => {
      job.subscribers.delete(onEvent);
    };
  }

  async getJob(jobId, ownerId) {
    const memoryJob = this.activeJobs.get(jobId);
    if (memoryJob) {
      if (memoryJob.ownerId !== ownerId) return null;
      if (memoryJob.chatId && this.chatRepository) {
        const chat = await this.chatRepository.getById(memoryJob.chatId, ownerId).catch(() => null);
        if (!chat || chat.deleted) {
          memoryJob.abortController?.abort(Object.assign(new Error('Conversation removed'), { code: 'EXECUTION_REVOKED' }));
          this.activeJobs.delete(jobId);
          return null;
        }
      }
      return {
        id: memoryJob.id,
        chatId: memoryJob.chatId,
        status: memoryJob.status,
        steps: memoryJob.steps,
        sources: memoryJob.sources,
        artifacts: memoryJob.artifacts || [],
        groundingMetadata: memoryJob.groundingMetadata || null,
        content: memoryJob.content,
        error: memoryJob.error,
        createdAt: memoryJob.createdAt,
        updatedAt: memoryJob.updatedAt,
      };
    }

    // Fall back to chat persistence if job has completed and memory expired
    const allChats = await this.chatRepository.readAll(ownerId);
    const matchingChat = allChats.find((chat) => chat.ownerId === ownerId && chat.messages.some((m) => m.jobId === jobId));
    if (!matchingChat) return null;

    const msg = matchingChat.messages.find((m) => m.jobId === jobId);
    if (!msg) return null;

    return {
      id: jobId,
      chatId: matchingChat.id,
      status: msg.status || "completed",
      steps: msg.steps || [],
      sources: msg.sources || [],
      artifacts: msg.artifacts || [],
      groundingMetadata: msg.groundingMetadata || null,
      content: msg.content || "",
      error: msg.error || null,
      createdAt: msg.createdAt || matchingChat.createdAt,
      updatedAt: msg.updatedAt || matchingChat.updatedAt,
    };
  }

  async rollbackJobArtifacts(job) {
    if (!this.artifactRepository || !Array.isArray(job?.artifacts) || !job.artifacts.length) return;
    for (const art of [...job.artifacts].reverse()) {
      try {
        if (typeof this.artifactRepository.rollback === "function") {
          await this.artifactRepository.rollback(art, job.ownerId);
        } else if (typeof this.artifactRepository.deleteArtifact === "function") {
          await this.artifactRepository.deleteArtifact(art.id, job.ownerId);
        }
      } catch (err) {
        console.warn("[Deep Research] Error rolling back artifact:", err?.message || err);
      }
    }
    job.artifacts = [];
  }

  async cancelJob(jobId, ownerId) {
    const job = this.activeJobs.get(jobId);
    if (!job || job.ownerId !== ownerId || !['pending', 'running'].includes(job.status)) return false;
    job.abortController.abort();
    await this.rollbackJobArtifacts(job);
    return true;
  }

  async persistJobMessage(job) {
    const isAborted = Boolean(job.abortController?.signal?.aborted);
    const isFailed = ["failed", "cancelled", "interrupted"].includes(job.status) || isAborted;
    if (isFailed) {
      await this.rollbackJobArtifacts(job);
    }
    try {
      if (!isFailed) await this.assertJobAuthorized?.(job);
      const chat = await this.chatRepository.getById(job.chatId, job.ownerId);
      if (!chat) { job.abortController.abort(); throw new Error("Conversation removed"); }

      const msgIdx = chat.messages.findIndex(
        (m) => m.jobId === job.id || (m.role === "assistant" && m.type === "research" && m.id === job.messageId),
      );

      if (msgIdx >= 0) {
        chat.messages[msgIdx] = {
          ...chat.messages[msgIdx],
          type: "research",
          jobId: job.id,
          status: job.status,
          steps: job.steps,
          sources: job.sources,
          artifacts: isFailed ? [] : (job.artifacts || chat.messages[msgIdx].artifacts || []),
          groundingMetadata: job.groundingMetadata || chat.messages[msgIdx].groundingMetadata,
          content: job.content || "",
          error: job.error || undefined,
          updatedAt: job.updatedAt,
        };

        if (this.chatRepository.patchResearchMessage) await this.chatRepository.patchResearchMessage(chat.id, job.ownerId, job.id, chat.messages[msgIdx], { executionFence: job.executionFence, assertOwned: () => this.assertJobOwned?.(job) });
        else {
        await this.chatRepository.saveChat({
          id: chat.id,
          ownerId: job.ownerId,
          title: chat.title,
          messages: chat.messages,
          strategyId: chat.strategyId,
          taskId: chat.taskId,
          mustExist: true,
          expectedRevision: chat.revision || 1,
        });
        }
      }
    } catch (err) {
      console.error("[Deep Research] Error persisting job message to repository:", err?.message || err);
      await this.rollbackJobArtifacts(job);
      throw err;
    }
  }

  recordCompletion(job, response) {
    if (job.status !== "completed" || job.abortController?.signal?.aborted) return;
    const latencyMs = Date.now() - (job.startedAt || Date.now());
    let usage = null;
    if (response?.usageMetadata) {
      const promptTokens = response.usageMetadata.promptTokenCount || 0;
      const candidateTokens = response.usageMetadata.candidatesTokenCount || 0;
      const thoughtsTokens = response.usageMetadata.thoughtsTokenCount || 0;
      const completionTokens = candidateTokens + thoughtsTokens;
      usage = {
        prompt_tokens: promptTokens || null,
        completion_tokens: completionTokens || null,
        thoughts_tokens: thoughtsTokens || 0,
        total_tokens: response.usageMetadata.totalTokenCount || (promptTokens + completionTokens) || null,
      };
    }
    if (job.usageByModel?.length) {
      usage = { prompt_tokens: job.usageByModel.reduce((sum, item) => sum + item.inputTokens, 0), completion_tokens: job.usageByModel.reduce((sum, item) => sum + item.outputTokens, 0) };
      usage.total_tokens = usage.prompt_tokens + usage.completion_tokens;
    }

    const isModelImprovement = job.modelImprovement === true;
    const isRestricted = true;

    if (this.learningLoop) {
      const interactionId = this.learningLoop.createInteractionId();
      logWithoutBlocking(
        this.learningLoop.recordInteraction({
          id: interactionId,
          ownerId: job.ownerId,
          mode: "ask_research",
          taskType: "deep_research",
          userPrompt: isRestricted ? "[Zəruri əməliyyat qeydi - Məzmun ötürülmür]" : job.prompt,
          relevantContext: isRestricted ? null : { sourcesCount: job.sources?.length || 0 },
          modelProvider: job.provider || 'google',
          modelName: job.model || "gemini-3.8-flash",
          modelResponse: isRestricted ? "[Məzmun gizlədilib - Töhfə deaktivdir]" : job.content,
          usage,
          latencyMs,
          requestStatus: "success",
          groundingActive: true,
          onlyNecessaryData: isRestricted,
          modelImprovement: isModelImprovement,
          privacySnapshot: job.privacySnapshot,
        }),
        "Deep Research interaction logging",
      );
    }

    if (this.telemetryService) {
      this.telemetryService
        .trackAskQuery({
          ownerId: job.ownerId,
          model: job.model || "gemini-3.8-flash-high",
          latencyMs,
          usage,
          providerUsage: job.usageByModel,
          groundingActive: true,
          status: "success",
          querySnippet: isRestricted ? "" : job.prompt,
          onlyNecessaryData: isRestricted,
          modelImprovement: isModelImprovement,
          privacySnapshot: job.privacySnapshot,
        })
        .catch(() => {});
    }
  }

  async resumeOrphanedJobs() {
    try {
      const allChats = await this.chatRepository.readAll();
      for (const chat of allChats) {
        if (!chat.messages?.length) continue;
        for (const msg of chat.messages) {
          if (msg.type === "research" && (msg.status === "running" || msg.status === "pending") && msg.jobId) {
            const msgAgeMs = Date.now() - new Date(msg.createdAt || 0).getTime();
            if (msgAgeMs < 15 * 60 * 1000) continue;
            if (this.redis?.isReady) {
              const claimed = await this.redis.set(`helmer:research:claim:${msg.jobId}`, "1", { NX: true, PX: 600000 });
              if (!claimed) continue;
            }
            if (!this.activeJobs.has(msg.jobId)) {
              console.log(`[Deep Research] Resuming orphaned job ${msg.jobId} in chat ${chat.id}`);
              const job = {
                id: msg.jobId,
                messageId: msg.id,
                ownerId: chat.ownerId,
                chatId: chat.id,
                prompt: msg.query || chat.title || "",
                modelImprovement: false,
                privacySnapshot: msg.privacySnapshot || { enabled: false, epoch: -1 },
                language: msg.language || "az",
                strategyContext: "",
                taskContext: "",
                status: "running",
                steps: msg.steps || this.createInitialSteps("az"),
                sources: msg.sources || [],
                groundingMetadata: null,
                content: "",
                error: null,
                createdAt: msg.createdAt || new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                startedAt: Date.now(),
                subscribers: new Set(),
                abortController: new AbortController(),
              };
              this.activeJobs.set(msg.jobId, job);
              const resumeExecPromise = (async () => {
                try {
                  const bgContext = {
                    ownerId: job.ownerId,
                    privacySnapshot: job.privacySnapshot,
                    providerStarted: false,
                    guest: typeof job.ownerId === "string" && job.ownerId.startsWith("guest_"),
                    signal: job.abortController.signal,
                    isBackgroundJob: true,
                  };
                  await executionContext.run(bgContext, () => this.executeJob(msg.jobId));
                } catch (err) {
                  console.error(`[Deep Research] Error executing resumed job ${msg.jobId}:`, err);
                }
              })();
              job.executionPromise = resumeExecPromise;
              this.runningJobPromises.add(resumeExecPromise);
              resumeExecPromise.finally(() => {
                this.runningJobPromises.delete(resumeExecPromise);
              });
            }
          }
        }
      }
    } catch (err) {
      console.warn("[Deep Research] Error checking orphaned jobs:", err?.message || err);
    }
  }
}
