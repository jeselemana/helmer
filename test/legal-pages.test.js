import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { JSDOM } from "jsdom";
import { LEGAL_DOCUMENTS } from "../public/legal-documents.js";

test("legal-documents.js contains complete AZ and EN Terms (12 articles) and Privacy (10 articles)", () => {
  for (const lang of ["az", "en"]) {
    const terms = LEGAL_DOCUMENTS.terms[lang];
    assert.ok(terms.title);
    assert.ok(terms.subtitle);
    assert.equal(terms.articles.length, 12);
    assert.ok(terms.callout.title);
    assert.ok(terms.callout.paragraphs.length > 0);
    assert.match(terms.footer.copyright, /2026 Innova Group Azerbaijan \/ Helmer Strategy OS/);
    assert.equal(terms.footer.companionHref, "/privacy");

    const privacy = LEGAL_DOCUMENTS.privacy[lang];
    assert.ok(privacy.title);
    assert.ok(privacy.subtitle);
    assert.equal(privacy.articles.length, 10);
    assert.match(privacy.callout.title, /Limited Use|Məhdud İstifadə/i);
    assert.ok(privacy.preamble.paragraphs.length === 2);
    assert.match(privacy.footer.copyright, /2026 Innova Group Azerbaijan \/ Helmer Strategy OS/);
    assert.equal(privacy.footer.companionHref, "/terms");
  }
});

test("terms.html and privacy.html load theme.js synchronously before CSS and include SEO & navigation controls", async () => {
  for (const [file, expectedCanonical] of [
    ["terms.html", "https://helmeros.com/terms"],
    ["privacy.html", "https://helmeros.com/privacy"],
  ]) {
    const html = await fs.readFile(path.join(process.cwd(), "public", file), "utf8");
    const themeScript = html.match(/<script[^>]+src="\/theme\.js[^>]+>/)?.[0];
    assert.ok(themeScript, `${file} missing theme.js`);
    assert.doesNotMatch(themeScript, /\b(?:async|defer|module)\b/);
    assert.ok(html.indexOf(themeScript) < html.indexOf('rel="stylesheet"'), `${file} theme.js must precede stylesheets`);

    assert.ok(html.includes('href="/tokens.css"'));
    assert.ok(html.includes('href="/legal.css"'));
    assert.ok(html.includes(`<link rel="canonical" href="${expectedCanonical}" />`));
    assert.ok(html.includes('<meta name="robots" content="index, follow" />'));
    assert.ok(html.includes('href="/terms"'));
    assert.ok(html.includes('href="/privacy"'));
    assert.ok(html.includes('id="btnAz"'));
    assert.ok(html.includes('id="btnEn"'));
    assert.ok(html.includes('id="legalPrintBtn"'));
    assert.ok(html.includes("data-theme-toggle"));
  }
});

test("index.html, auth.js, and script.js use dedicated /terms and /privacy routes instead of legal modals", async () => {
  const indexHtml = await fs.readFile(path.join(process.cwd(), "public/index.html"), "utf8");
  assert.match(indexHtml, /<a[^>]+id="sidebarTermsBtn"[^>]+href="\/terms"/);
  assert.match(indexHtml, /<a[^>]+id="sidebarPrivacyBtn"[^>]+href="\/privacy"/);

  const scriptJs = await fs.readFile(path.join(process.cwd(), "public/script.js"), "utf8");
  assert.doesNotMatch(scriptJs, /\bopenLegalModal\b/);
  assert.doesNotMatch(scriptJs, /helmer:open-legal/);

  const authJs = await fs.readFile(path.join(process.cwd(), "public/auth.js"), "utf8");
  assert.doesNotMatch(authJs, /\bopenLegalDoc\b/);
  assert.doesNotMatch(authJs, /helmer:open-legal/);
});

test("legal-page.js renders full semantic legal page in JSDOM and supports AZ/EN switching", async () => {
  const termsHtml = await fs.readFile(path.join(process.cwd(), "public/terms.html"), "utf8");
  const dom = new JSDOM(termsHtml, { url: "https://helmeros.com/terms?lang=en" });
  const { window } = dom;
  const { document } = window;

  globalThis.window = window;
  globalThis.document = document;
  globalThis.localStorage = window.localStorage;
  globalThis.CustomEvent = window.CustomEvent;
  globalThis.IntersectionObserver = class {
    observe() {}
    disconnect() {}
  };
  globalThis.fetch = async () => ({ ok: false });

  try {
    await import(`../public/legal-page.js?test=${Date.now()}`);

    assert.equal(document.documentElement.lang, "en");
    assert.match(document.title, /Terms of Service \| Helmer Strategy OS/);
    assert.equal(document.querySelectorAll(".legal-article").length, 12);
    assert.equal(document.querySelectorAll(".legal-toc-sidebar .legal-toc-link").length, 13);
    assert.ok(document.querySelector(".legal-callout"));
    assert.ok(document.querySelector(".legal-meta-card"));
    assert.ok(document.querySelector(".legal-doc-footer"));

    // Toggle to AZ
    document.getElementById("btnAz").click();
    assert.equal(document.documentElement.lang, "az");
    assert.match(document.title, /İstifadəçi Razılaşması/);
    assert.equal(document.querySelector(".legal-hero-title").textContent, "İSTİFADƏÇİ RAZILAŞMASI (İSTİFADƏ ŞƏRTLƏRİ)");
  } finally {
    delete globalThis.window;
    delete globalThis.document;
    delete globalThis.localStorage;
    delete globalThis.CustomEvent;
    delete globalThis.IntersectionObserver;
    delete globalThis.fetch;
  }
});

test("server.js exposes public /terms and /privacy routes", async () => {
  const serverJs = await fs.readFile(path.join(process.cwd(), "server.js"), "utf8");
  assert.ok(serverJs.includes('app.get(["/privacy", "/privacy-policy"]'));
  assert.ok(serverJs.includes('app.get(["/terms", "/terms-of-service"]'));
});
