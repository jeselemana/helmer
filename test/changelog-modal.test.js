import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { t, TRANSLATIONS } from "../public/i18n.js";

test("index.html: whatsNewNav exists in sidebar with sparkle icon, label, and v4.5 badge", async () => {
  const html = await fs.readFile(path.join(process.cwd(), "public/index.html"), "utf8");

  // Navigation item
  assert.ok(html.includes('id="whatsNewNav"'), "whatsNewNav button element exists");
  assert.ok(html.includes('class="whats-new-label">Yeniliklər<'), "whats-new-label exists with default Azerbaijani text");
  assert.ok(html.includes('class="whats-new-badge">v4.5<'), "v4.5 indicator pill exists");

  // Sparkles icon
  assert.ok(
    html.includes('d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"'),
    "whatsNewNav contains clean 4-point sparkle icon"
  );

  // Overlay container
  assert.ok(html.includes('id="changelogModalOverlay"'), "changelogModalOverlay container exists in index.html");
  assert.ok(html.includes('class="changelog-modal-overlay"'), "changelog-modal-overlay class exists");

  // Preserves existing layout constraints
  const installIndex = html.indexOf('id="installAppNav"');
  const whatsNewIndex = html.indexOf('id="whatsNewNav"');
  assert.ok(installIndex !== -1 && whatsNewIndex !== -1, "Both installAppNav and whatsNewNav exist");
  assert.ok(installIndex < whatsNewIndex, "installAppNav precedes whatsNewNav in primary navigation");
  assert.ok(!html.includes('id="settingsNav"'), "settingsNav is removed from primary navigation");
});

test("i18n.js: changelog translations have 100% key parity and contain complete timeline v1.0 to v4.0", () => {
  // Navigation key parity
  assert.equal(t("nav.whatsNew", {}, "az"), "Yeniliklər");
  assert.equal(t("nav.whatsNew", {}, "en"), "What's new");

  // Section parity
  const azChangelog = TRANSLATIONS.az.changelog;
  const enChangelog = TRANSLATIONS.en.changelog;
  assert.ok(azChangelog, "az changelog dictionary exists");
  assert.ok(enChangelog, "en changelog dictionary exists");
  assert.equal(azChangelog.title, "Yeniliklər");
  assert.equal(enChangelog.title, "What's new");

  // Timeline version count
  assert.equal(azChangelog.versions.length, 6, "AZ timeline contains 6 versions (v4.5, v4.0, v3.5, v3.0, v2.0, v1.0)");
  assert.equal(enChangelog.versions.length, 6, "EN timeline contains 6 versions");

  const hasHighlightText = (highlights, ...needles) =>
    highlights.some((h) => {
      const text = typeof h === "string" ? h : `${h?.tag || ""} ${h?.title || ""} ${h?.desc || ""}`;
      return needles.every((needle) => text.includes(needle));
    });

  // v4.5 (Current version — product-grade polish & UX)
  const azV45 = azChangelog.versions[0];
  const enV45 = enChangelog.versions[0];
  assert.equal(azV45.version, "v4.5");
  assert.equal(azV45.name, "Helmer 4.5");
  assert.equal(azV45.status, "Cari versiya");
  assert.equal(azV45.isCurrent, true);
  assert.ok(azV45.subtitle.includes("ciddi məhsul səviyyəsinə"));
  assert.equal(azV45.highlights.length, 4);
  assert.equal(enV45.version, "v4.5");
  assert.equal(enV45.name, "Helmer 4.5");
  assert.equal(enV45.status, "Current Version");
  assert.equal(enV45.isCurrent, true);
  assert.ok(enV45.subtitle.includes("serious product standard"));
  assert.equal(enV45.highlights.length, 4);

  // v4.0
  const azV40 = azChangelog.versions[1];
  const enV40 = enChangelog.versions[1];
  assert.equal(azV40.version, "v4.0");
  assert.equal(azV40.status, "Buraxılış");
  assert.equal(azV40.isCurrent, false);
  assert.equal(azV40.isUpcoming, false);
  assert.ok(azV40.subtitle.includes("təməl arxitektura"));
  assert.ok(hasHighlightText(azV40.highlights, "Zero-trust", "tenant izolasiyası"));
  assert.ok(hasHighlightText(azV40.highlights, "HelmerUp", "məşqləri"));
  assert.ok(hasHighlightText(azV40.highlights, "Deep Research"));
  assert.ok(hasHighlightText(azV40.highlights, "Word", "Excel", "PDF", "PowerPoint"));
  assert.ok(hasHighlightText(azV40.highlights, "Search Grounding", "Build"));
  assert.ok(hasHighlightText(azV40.highlights, "çıxış keyfiyyəti", "təlimatlar"));
  assert.ok(hasHighlightText(azV40.highlights, "Çoxmodeli", "modelin"));

  assert.equal(enV40.version, "v4.0");
  assert.equal(enV40.status, "Release");
  assert.equal(enV40.isCurrent, false);
  assert.equal(enV40.isUpcoming, false);
  assert.ok(enV40.subtitle.includes("Modern foundational architecture"));
  assert.ok(hasHighlightText(enV40.highlights, "Zero-trust", "tenant isolation"));
  assert.ok(hasHighlightText(enV40.highlights, "HelmerUp", "workouts"));
  assert.ok(hasHighlightText(enV40.highlights, "Deep Research"));
  assert.ok(hasHighlightText(enV40.highlights, "Word", "Excel", "PDF", "PowerPoint"));
  assert.ok(hasHighlightText(enV40.highlights, "Search Grounding", "Build"));
  assert.ok(hasHighlightText(enV40.highlights, "output quality", "instruction"));
  assert.ok(hasHighlightText(enV40.highlights, "Multi-model", "collaborate"));

  // v3.5 (Previous Release)
  const azV35 = azChangelog.versions[2];
  const enV35 = enChangelog.versions[2];
  assert.equal(azV35.version, "v3.5");
  assert.equal(azV35.status, "Buraxılış");
  assert.equal(azV35.isCurrent, false);
  assert.equal(azV35.isUpcoming, false);
  assert.equal(enV35.version, "v3.5");
  assert.equal(enV35.status, "Release");
  assert.equal(enV35.isCurrent, false);
  assert.equal(enV35.isUpcoming, false);
  assert.ok(hasHighlightText(azV35.highlights, "kalibrasiya", "grounding"));
  assert.ok(hasHighlightText(azV35.highlights, "Azerbaijan Market Engine", "istehlakçı"));
  assert.ok(hasHighlightText(azV35.highlights, "UI/UX", "sabitliyi"));
  assert.ok(!hasHighlightText(azV35.highlights, "sıfır hallüsinasiya"), "Overconfident 'sıfır hallüsinasiya' is removed");
  assert.ok(!hasHighlightText(enV35.highlights, "zero hallucination"), "Overconfident 'zero hallucination' is removed");

  // v3.0
  const azV30 = azChangelog.versions[3];
  assert.equal(azV30.version, "v3.0");
  assert.ok(hasHighlightText(azV30.highlights, "Avtonom", "Çoxmərhələli iş axınları"));

  // v2.0
  const azV20 = azChangelog.versions[4];
  const enV20 = enChangelog.versions[4];
  assert.equal(azV20.version, "v2.0");
  assert.equal(azV20.date, "Noyabr 2025", "v2.0 release date in AZ is Noyabr 2025");
  assert.equal(enV20.date, "November 2025", "v2.0 release date in EN is November 2025");
  assert.ok(hasHighlightText(azV20.highlights, "Avtonom"));

  // v1.0
  const azV10 = azChangelog.versions[5];
  const enV10 = enChangelog.versions[5];
  assert.equal(azV10.version, "v1.0");
  assert.equal(azV10.date, "Dekabr 2024", "v1.0 release date in AZ is Dekabr 2024");
  assert.equal(enV10.date, "December 2024", "v1.0 release date in EN is December 2024");
  assert.ok(hasHighlightText(azV10.highlights, "təməl arxitektura", "MVP"));

  // Feedback action parity
  assert.equal(azChangelog.feedbackBtn, "Rəy bildir");
  assert.equal(enChangelog.feedbackBtn, "Send Feedback");
});

test("script.js: changelog modal functions comply with Frontend XSS rules (Rule 4), provide email feedback, and wire event listeners", async () => {
  const js = await fs.readFile(path.join(process.cwd(), "public/script.js"), "utf8");

  // Function exports
  assert.ok(js.includes("export function openChangelogModal()"), "openChangelogModal is exported");
  assert.ok(js.includes("export function closeChangelogModal()"), "closeChangelogModal is exported");

  // DOM creation compliance - NO innerHTML
  const changelogBlock = js.substring(
    js.indexOf("function createChangelogSvgIcon("),
    js.indexOf("function isPersonalIntelligenceActive(")
  );
  assert.ok(!changelogBlock.includes(".innerHTML ="), "Changelog rendering strictly avoids innerHTML (Rule 4)");
  assert.ok(changelogBlock.includes("changelog-split-layout"), "Builds 2-column split layout safely via element()");
  assert.ok(changelogBlock.includes("changelog-version-rail"), "Builds version rail tablist safely");
  assert.ok(changelogBlock.includes('document.createElementNS("http://www.w3.org/2000/svg"'), "Creates SVG icons safely via createElementNS");

  // Feedback button points to support@helmeros.com
  assert.ok(changelogBlock.includes("support@helmeros.com"), "Send Feedback button redirects to support@helmeros.com");
  assert.ok(changelogBlock.includes("changelog-feedback-btn"), "Feedback button has class changelog-feedback-btn");

  // Event wiring
  assert.ok(js.includes("whatsNewNav?.addEventListener(\"click\","), "whatsNewNav click listener is registered");
  assert.ok(js.includes("changelogModalOverlay?.addEventListener(\"click\","), "changelogModalOverlay click listener is registered");
  assert.ok(js.includes("closeChangelogModal();"), "closeChangelogModal is called on escape and close");

  // Escape shortcut handling
  assert.ok(
    js.includes("if (changelogModalOverlay && !changelogModalOverlay.hidden) {\n      closeChangelogModal();"),
    "Escape key dismisses changelogModalOverlay"
  );

  // Mobile swipe-down support
  assert.ok(
    changelogBlock.includes("attachSwipeDownToClose(sheet, closeChangelogModal);"),
    "Mobile bottom sheet wires native touch swipe-down-to-close"
  );

  // Got it button removed, Send Feedback is the sole footer action, close button exists in header
  assert.ok(!changelogBlock.includes("changelog-footer-btn"), "Got it button is removed from changelog footer");
  assert.ok(changelogBlock.includes('button("✕", "changelog-modal-close", closeChangelogModal)'), "Close button exists in header for dismissal");
});

test("style.css: changelog modal and timeline styles with light and dark mode parity", async () => {
  const css = await fs.readFile(path.join(process.cwd(), "public/style.css"), "utf8");

  // Sidebar badge styles
  assert.ok(css.includes(".whats-new-badge {"), ".whats-new-badge is styled");
  assert.ok(css.includes("[data-theme=\"dark\"] .whats-new-badge"), "Dark mode override for whats-new-badge exists");

  // Modal overlay and card
  assert.ok(css.includes(".changelog-modal-overlay {"), ".changelog-modal-overlay is defined");
  assert.ok(css.includes(".changelog-modal-card {"), ".changelog-modal-card is defined");
  assert.ok(css.includes(".changelog-modal-header {"), ".changelog-modal-header is defined");
  assert.ok(css.includes(".changelog-modal-body {"), ".changelog-modal-body is defined");
  assert.ok(css.includes(".changelog-feedback-btn {"), ".changelog-feedback-btn is defined");
  assert.ok(css.includes("[data-theme=\"dark\"] .changelog-feedback-btn"), "Dark mode changelog-feedback-btn is defined");

  // Vertical timeline styles
  assert.ok(css.includes(".changelog-timeline {"), ".changelog-timeline is defined");
  assert.ok(css.includes(".changelog-timeline-line {"), ".changelog-timeline-line connects nodes");
  assert.ok(css.includes(".changelog-timeline-dot {"), ".changelog-timeline-dot is defined");
  assert.ok(css.includes(".changelog-dot-pulse {"), ".changelog-dot-pulse provides active beacon");
  assert.ok(css.includes(".changelog-timeline-item.is-current"), "Current version active state is styled");
  assert.ok(css.includes(".changelog-timeline-item.is-upcoming"), "Upcoming milestone state is styled");
  assert.ok(css.includes(".changelog-status-pill.is-upcoming"), "Upcoming status pill is styled");

  // Mobile Bottom Sheet
  assert.ok(css.includes(".changelog-modal-overlay.is-mobile"), "Mobile overlay layout is defined");
  assert.ok(css.includes(".changelog-sheet.mobile-action-sheet"), "Mobile action sheet layout is defined");

  // Dark mode parity
  assert.ok(css.includes("[data-theme=\"dark\"] .changelog-modal-card"), "Dark mode card styles exist");
  assert.ok(css.includes("[data-theme=\"dark\"] .changelog-timeline-dot"), "Dark mode timeline dot styles exist");
});

test("style.css: mobile bottom sheet defines responsive dimension adaptations and dark/light parity", async () => {
  const css = await fs.readFile(path.join(process.cwd(), "public/style.css"), "utf8");

  // Mobile Bottom Sheet Container
  assert.ok(css.includes("max-height: min(88dvh, calc(100dvh - 36px))"), "Responsive max-height is set for mobile bottom sheet");
  assert.ok(css.includes("border-radius: 24px 24px 0 0"), "Mobile bottom sheet has rounded top corners");
  assert.ok(css.includes("padding-bottom: max(14px, env(safe-area-inset-bottom))"), "Safe-area-inset-bottom padding is supported");

  // Responsive Header & Body Dimensions
  assert.ok(css.includes("padding: 12px 16px !important"), "Mobile header has compact 12px 16px padding");
  assert.ok(css.includes("padding: 14px 16px 18px !important"), "Mobile body has optimized touch scrollable padding");

  // Responsive Timeline & Content Card Dimensions
  assert.ok(css.includes("gap: 18px !important"), "Timeline gap is reduced on mobile");
  assert.ok(css.includes("padding: 12px 14px 14px !important"), "Timeline content card has tailored mobile padding");

  // Responsive Footer & Button Actions
  assert.ok(css.includes(".changelog-sheet-footer"), "Mobile sheet footer class is defined");
  assert.ok(css.includes(".changelog-feedback-btn"), "Feedback button is styled for mobile");

  // Small Screen Adaptations (<= 390px)
  assert.ok(css.includes("@media (max-width: 390px)"), "Micro-screen media query exists for narrow mobile phones");

  // Theme Parity on Mobile Sheet
  assert.ok(
    css.includes("[data-theme=\"dark\"] .changelog-modal-overlay .changelog-sheet.mobile-action-sheet") &&
    css.includes("background: #0B0F17 !important"),
    "Mobile sheet has Obsidian dark theme background"
  );
  assert.ok(
    css.includes("[data-theme=\"light\"] .changelog-modal-overlay .changelog-sheet.mobile-action-sheet") &&
    css.includes("background: #FFFFFF !important"),
    "Mobile sheet has clean white light theme background"
  );
});
