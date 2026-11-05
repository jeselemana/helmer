import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { t, TRANSLATIONS } from "../public/i18n.js";

test("index.html: top announcement bar and modal are completely removed", async () => {
  const html = await fs.readFile(path.join(process.cwd(), "public/index.html"), "utf8");

  // Legacy v3.0 must not exist
  assert.ok(!html.includes("Helmer v3.0 istifadənizdədir"), "Legacy v3.0 message is completely removed from index.html");
  assert.ok(!html.includes("v3.0"), "No legacy v3.0 strings remain in index.html");

  // Top announcement bar elements are removed
  assert.ok(!html.includes('id="announcementBar"'), "announcementBar element is removed from index.html");
  assert.ok(!html.includes('id="announcementPill"'), "announcementPill is removed from index.html");
  assert.ok(!html.includes('id="whatsNewModalOverlay"'), "whatsNewModalOverlay is removed from index.html");
});

test("script.js: technical support card is removed and replaced with clean v3.5 release toast card", async () => {
  const scriptContent = await fs.readFile(path.join(process.cwd(), "public/script.js"), "utf8");

  // Old technical support notice must be removed
  assert.ok(!scriptContent.includes("checkSupportBanner"), "checkSupportBanner is removed");
  assert.ok(!scriptContent.includes("supportNoticeToast"), "supportNoticeToast is removed");
  assert.ok(!scriptContent.includes("Texniki çətinliklə qarşılaşdığınız halda"), "Support notice text is removed");

  // New v3.5 release toast card is defined and called
  assert.ok(scriptContent.includes("export function showV35ReleaseToast()"), "showV35ReleaseToast function is exported");
  assert.ok(scriptContent.includes("showV35ReleaseToast();"), "showV35ReleaseToast is called at initialization");
  assert.ok(scriptContent.includes('"helmer_v3_5_release_toast_dismissed"'), "Storage key for v3.5 toast is present");
  assert.ok(scriptContent.includes("v35-release-toast"), "v35-release-toast class is used for the toast element");
  assert.ok(!scriptContent.includes("v35-toast-tags"), "Tag pills are removed from card");
  assert.ok(!scriptContent.includes("v35-toast-badge"), "Badges are removed from card");
});

test("i18n.js: release card translations have general subtext and full parity for Helmer 4", () => {
  // Azerbaijani
  assert.equal(t("announcement.title", {}, "az"), "Helmer 4 istifadənizdədir");
  assert.equal(
    t("announcement.body", {}, "az"),
    "Yüksək təhlükəsizlik standartlarına cavab verən tamamilə yenilənmiş müasir təməl arxitektura, yeni funksiyalar və daha çoxu. Ətraflı Yeniliklər bölməsində."
  );
  assert.equal(t("announcement.dontShow", {}, "az"), "Bir daha göstərmə");
  assert.equal(t("announcement.cta", {}, "az"), "Anladım");
  assert.equal(t("announcement.closeAria", {}, "az"), "Bağla");

  // English
  assert.equal(t("announcement.title", {}, "en"), "Helmer 4 is now available");
  assert.ok(t("announcement.body", {}, "en").includes("foundational architecture"));
  assert.equal(t("announcement.dontShow", {}, "en"), "Don't show again");
  assert.equal(t("announcement.cta", {}, "en"), "Got it");
  assert.equal(t("announcement.closeAria", {}, "en"), "Close");
});

test("style.css: v3.5 clean release toast card styles and support notice removal", async () => {
  const css = await fs.readFile(path.join(process.cwd(), "public/style.css"), "utf8");

  // Old support notice toast is removed
  assert.ok(!css.includes(".support-notice-toast {"), ".support-notice-toast is removed from style.css");

  // Top announcement bar is removed
  assert.ok(!css.includes(".announcement-bar {"), ".announcement-bar is removed from style.css");

  // v3.5 release toast card is defined
  assert.ok(css.includes(".v35-release-toast {"), ".v35-release-toast is defined");
  assert.ok(css.includes(".v35-release-toast.is-visible {"), "is-visible state is defined for v35 toast");
  assert.ok(css.includes(".v35-release-toast.is-dismissing {"), "is-dismissing state is defined for v35 toast");
  assert.ok(css.includes(".v35-toast-progress-bar {"), "progress bar is defined for v35 toast");
  assert.ok(css.includes("[data-theme=\"dark\"] .v35-release-toast"), "Dark mode support exists for v35 toast");
});
