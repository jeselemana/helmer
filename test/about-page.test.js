import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { JSDOM } from "jsdom";
import { t } from "../public/i18n.js";

const publicDir = path.join(process.cwd(), "public");

test("server.js exposes public /about route before SPA wildcard fallback", async () => {
  const serverJs = await fs.readFile(path.join(process.cwd(), "server.js"), "utf8");
  const aboutIdx = serverJs.indexOf('app.get(["/about", "/haqqimizda"]');
  const fallbackIdx = serverJs.indexOf('app.get("*", (req, res)');
  assert.ok(aboutIdx !== -1, "server.js must expose /about route");
  assert.ok(fallbackIdx !== -1 && aboutIdx < fallbackIdx, "/about must precede SPA fallback");
});

test("sitemap.xml and robots.txt include /about", async () => {
  const sitemap = await fs.readFile(path.join(publicDir, "sitemap.xml"), "utf8");
  const robots = await fs.readFile(path.join(publicDir, "robots.txt"), "utf8");
  assert.ok(sitemap.includes("<loc>https://helmeros.com/about</loc>"));
  assert.ok(robots.includes("Allow: /about"));
});

test("google-gemini-icon.svg star mark exists, old wordmark is removed, and SVG has no scripts", async () => {
  await assert.rejects(
    fs.access(path.join(publicDir, "google-gemini-logo.svg")),
    /ENOENT/
  );
  const svg = await fs.readFile(path.join(publicDir, "google-gemini-icon.svg"), "utf8");
  assert.ok(svg.includes('viewBox="0 0 65 65"'));
  assert.ok(svg.includes("<svg") && svg.includes("</svg>"));
  assert.doesNotMatch(svg, /<script/i);
  assert.doesNotMatch(svg, /\bon\w+\s*=/i);
});

test("about.html and about.css follow ultra-clean monochrome editorial design without hacker/neon clutter", async () => {
  const html = await fs.readFile(path.join(publicDir, "about.html"), "utf8");
  const css = await fs.readFile(path.join(publicDir, "about.css"), "utf8");

  assert.ok(html.includes('<link rel="canonical" href="https://helmeros.com/about" />'));
  assert.ok(html.includes('<meta name="robots" content="index, follow" />'));
  assert.ok(html.includes('property="og:url" content="https://helmeros.com/about"'));
  assert.ok(html.includes("family=Inter"));
  assert.ok(html.includes("JetBrains+Mono"));
  assert.ok(html.includes('href="/about.css'));
  assert.ok(html.includes('<script type="module" src="/about.js'));
  assert.ok(html.includes('src="/google-gemini-icon.svg"'));

  // Monochrome color discipline and widened editorial container
  assert.doesNotMatch(css, /#10b981|#38bdf8/i);
  assert.ok(css.includes("#0a0a0b"));
  assert.ok(css.includes("--container-max: 1280px;"));

  // No terminal/hacker badges or boxed label clutter
  assert.doesNotMatch(html, /MODULE \/\/|METRİKA 01 \/\/|CORE PARTNER \/\/|ASK_CONTEXT_STREAM|NODE_PIPELINE/i);

  // CSP compliance: no inline script blocks or inline event handlers
  const scriptTags = html.match(/<script\b[^>]*>/gi) || [];
  assert.equal(scriptTags.length, 1);
  assert.ok(scriptTags[0].includes('src="/about.js'));
  assert.doesNotMatch(html, /\son(?:click|error|load|mouseover)\s*=/i);

  // Core editorial sections and copy
  assert.ok(html.includes("Strateji düşüncə ilə icra arasındakı sərhədi aradan qaldırırıq."));
  assert.ok(html.includes("İnteraktiv Dialoq və Qərarvermə"));
  assert.ok(html.includes("Çoxagentli və Çoxmodelli İcra"));
  assert.ok(html.includes("Niyə Helmer daha sürətli işləyir?"));
  assert.ok(html.includes("Gözləmədən ilk cavabı alın"));
  assert.ok(html.includes("Sənəd böyüsə də sürət düşmür"));
  assert.ok(html.includes("Əsas İntellekt Tərəfdaşı"));
  assert.ok(html.includes("Çoxmodelli Orkestrasiya"));
  assert.ok(html.includes("Qlobal Bulud İnfrastrukturu"));
  assert.ok(html.includes("Tam Strategy OS yol xəritəsi."));
  assert.ok(html.includes("Helmer İş Mühitinə Keçid"));
});

test("about.js powers editorial telemetry switching, vector diagrams, and Gemini fallback in JSDOM", async () => {
  const html = await fs.readFile(path.join(publicDir, "about.html"), "utf8");
  const dom = new JSDOM(html, { url: "https://helmeros.com/about" });
  const { window } = dom;
  const { document } = window;

  globalThis.window = window;
  globalThis.document = document;
  globalThis.IntersectionObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };

  try {
    await import(`../public/about.js?test=${Date.now()}`);

    // Initial Ask speed mode
    assert.equal(document.getElementById("barValHelmer").textContent, "0.24 san");
    assert.equal(document.getElementById("curveActiveReadout").textContent, "~200 səhifə · 0.25 san");

    // Switch to Build speed mode
    document.getElementById("telemetryTabBuild").click();
    assert.equal(document.getElementById("telemetryTabBuild").getAttribute("aria-selected"), "true");
    assert.equal(document.getElementById("barValHelmer").textContent, "4.8 san");
    assert.equal(document.getElementById("kpiPrimaryLatency").textContent, "4.8 san");
    assert.equal(document.getElementById("latencyChartTitle").textContent, "Böyük işləri paralel tamamlayın");

    // Click 1,500+ səhifə curve node
    const lastNode = document.querySelector('.curve-node[data-point-index="5"]');
    lastNode.dispatchEvent(new window.Event("click"));
    assert.equal(document.getElementById("curveActiveReadout").textContent, "1,500+ səhifə · 6.2 san");

    // Build vector step selection
    const agentsStep = document.querySelector('[data-build-node="agents"]');
    agentsStep.click();
    assert.match(document.getElementById("buildDiagramCaption").textContent, /paralel/i);

    // Ask vector step selection
    const groundingTab = document.querySelector('[data-ask-step="grounding"]');
    groundingTab.click();
    assert.match(document.getElementById("askDiagramCaption").textContent, /Grounding/);

    // Gemini logo error fallback
    const logoImg = document.getElementById("geminiOfficialLogo");
    const fallbackWrap = document.getElementById("geminiFallbackLogo");
    assert.equal(fallbackWrap.hidden, true);
    logoImg.dispatchEvent(new window.Event("error"));
    assert.equal(logoImg.hidden, true);
    assert.equal(fallbackWrap.hidden, false);
  } finally {
    delete globalThis.window;
    delete globalThis.document;
    delete globalThis.IntersectionObserver;
  }
});

test("workspace rail, sidebar navigation, legal pages header keep /about hidden while keeping /about route and translations intact", async () => {
  const indexHtml = await fs.readFile(path.join(publicDir, "index.html"), "utf8");
  const privacyHtml = await fs.readFile(path.join(publicDir, "privacy.html"), "utf8");
  const termsHtml = await fs.readFile(path.join(publicDir, "terms.html"), "utf8");
  const aboutHtml = await fs.readFile(path.join(publicDir, "about.html"), "utf8");
  const legalPageJs = await fs.readFile(path.join(publicDir, "legal-page.js"), "utf8");
  const scriptJs = await fs.readFile(path.join(publicDir, "script.js"), "utf8");

  assert.match(indexHtml, /<a[^>]+id="railAboutButton"[^>]+hidden[^>]+aria-hidden="true"[^>]+inert/);
  assert.match(indexHtml, /<a[^>]+id="aboutNav"[^>]+hidden[^>]+aria-hidden="true"[^>]+inert/);
  assert.match(privacyHtml, /<a[^>]+href="\/about"[^>]+id="navAbout"[^>]+hidden[^>]+aria-hidden="true"[^>]+inert/);
  assert.match(termsHtml, /<a[^>]+href="\/about"[^>]+id="navAbout"[^>]+hidden[^>]+aria-hidden="true"[^>]+inert/);
  assert.ok(aboutHtml.includes('href="https://helmeros.com/about"'), "about.html remains intact");
  assert.ok(legalPageJs.includes("navAbout.hidden = true"), "legal-page.js keeps navAbout hidden");
  assert.ok(scriptJs.includes("railAboutButton.hidden = true") && scriptJs.includes("aboutNav.hidden = true"), "script.js keeps railAboutButton and aboutNav hidden");

  assert.equal(t("nav.about", {}, "az"), "Haqqımızda");
  assert.equal(t("nav.about", {}, "en"), "About");
});
