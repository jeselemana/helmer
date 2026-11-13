import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

test("Support Chat Bubble: script.js implements minimalist & premium bubble, greeting logic, popover email choice, and mailto redirection", async () => {
  const js = await fs.readFile(path.join(process.cwd(), "public/script.js"), "utf8");

  // Function existence
  assert.ok(js.includes("function buildSupportChatBubble()"), "buildSupportChatBubble helper exists");
  assert.ok(js.includes("function getSupportGreeting()"), "getSupportGreeting helper exists");

  // Popover container and email choice (not immediate redirect on bubble click)
  assert.ok(js.includes("support-chat-popover"), "Popover container is created");
  assert.ok(js.includes("support-email-option"), "Email choice option is rendered");
  assert.ok(js.includes("togglePopover"), "Clicking bubble toggles popover instead of direct mailto jump");

  // Mailto redirect target on the email choice
  assert.ok(js.includes('emailLink.href = "mailto:support@helmeros.com"'), "Email option redirects to support@helmeros.com");

  // Appended in renderSettings (covers Profile, Personalization, Security, Legal tabs)
  assert.ok(js.includes("view.appendChild(buildSupportChatBubble());"), "Appended to settings view for all tabs");

  // Appended in openLegalModal
  assert.ok(js.includes("buildSupportChatBubble()"), "Used in legal modal");

  // XSS protection (Rule 4)
  assert.ok(js.includes("tooltipText.textContent = getSupportGreeting();"), "Sets greeting safely via textContent to prevent XSS");
  assert.ok(!js.includes("tooltipText.innerHTML ="), "Does not use raw innerHTML on tooltip text");

  // Classes & Structure
  assert.ok(js.includes("support-chat-widget"), "support-chat-widget container class is used");
  assert.ok(js.includes("support-chat-bubble"), "support-chat-bubble button class is used");
  assert.ok(js.includes("support-chat-tooltip"), "support-chat-tooltip class is used");
  assert.ok(js.includes("support-chat-status-dot"), "support-chat-status-dot live indicator is used");
  assert.ok(js.includes("support-copy-email-btn"), "Copy email button is provided for quick convenience");
});

test("Support Chat Bubble: i18n.js contains supportBubble dictionaries in both AZ and EN", async () => {
  const i18n = await fs.readFile(path.join(process.cwd(), "public/i18n.js"), "utf8");

  // AZ dictionary
  assert.ok(i18n.includes("Salam {name}, kömək lazımdır?"), "AZ greeting with name placeholder exists");
  assert.ok(i18n.includes("Salam, kömək lazımdır?"), "AZ guest greeting exists");
  assert.ok(i18n.includes("E-poçt vasitəsilə yazın"), "AZ email option label exists");

  // EN dictionary
  assert.ok(i18n.includes("Hi {name}, need help?"), "EN greeting with name placeholder exists");
  assert.ok(i18n.includes("Hi, need help?"), "EN guest greeting exists");
  assert.ok(i18n.includes("Send an email"), "EN email option label exists");
});

test("Support Chat Bubble: style.css defines bottom-right placement, popover card, hover popout, and dark theme parity", async () => {
  const css = await fs.readFile(path.join(process.cwd(), "public/style.css"), "utf8");

  // Fixed bottom-right placement
  assert.ok(css.includes(".support-chat-widget {"), ".support-chat-widget is defined");
  assert.ok(css.includes("position: fixed;"), "Widget is fixed");
  assert.ok(css.includes("right: 28px;"), "Positioned on right");
  assert.ok(css.includes("bottom: 28px;"), "Positioned at bottom");

  // Bubble appearance
  assert.ok(css.includes(".support-chat-bubble {"), ".support-chat-bubble is defined");
  assert.ok(css.includes("border-radius: 9999px;"), "Bubble is circular / pill-shaped");

  // Popover card styling
  assert.ok(css.includes(".support-chat-popover {"), "Popover container is defined in CSS");
  assert.ok(css.includes(".support-email-option {"), "Email option is styled in CSS");
  assert.ok(css.includes(".support-chat-widget.is-popover-open .support-chat-tooltip"), "Hides tooltip when popover is open");

  // Tooltip hover reveal
  assert.ok(css.includes(".support-chat-tooltip {"), ".support-chat-tooltip is defined");
  assert.ok(css.includes(".support-chat-widget:hover .support-chat-tooltip"), "Tooltip reveals on widget hover");

  // Dark mode parity
  assert.ok(css.includes('[data-theme="dark"] .support-chat-bubble'), "Dark mode bubble is defined");
  assert.ok(css.includes('[data-theme="dark"] .support-chat-popover'), "Dark mode popover is defined");
  assert.ok(css.includes('[data-theme="dark"] .support-chat-tooltip'), "Dark mode tooltip is defined");

  // Responsive mobile
  assert.ok(css.includes("@media (max-width: 768px)"), "Mobile responsiveness is defined");
});

test("Support Chat Bubble: legal.css defines support chat bubble and popover styles for legal pages", async () => {
  const legalCss = await fs.readFile(path.join(process.cwd(), "public/legal.css"), "utf8");

  assert.ok(legalCss.includes(".support-chat-widget {"), "legal.css defines .support-chat-widget");
  assert.ok(legalCss.includes(".support-chat-bubble {"), "legal.css defines .support-chat-bubble");
  assert.ok(legalCss.includes(".support-chat-popover {"), "legal.css defines .support-chat-popover");
  assert.ok(legalCss.includes(".support-email-option {"), "legal.css defines .support-email-option");
  assert.ok(legalCss.includes(".support-chat-tooltip {"), "legal.css defines .support-chat-tooltip");
  assert.ok(legalCss.includes(".support-chat-widget:hover .support-chat-tooltip"), "legal.css defines hover reveal");
});

test("Support Chat Bubble: terms.html and privacy.html contain the widget with email choice popover and mailto link", async () => {
  const termsHtml = await fs.readFile(path.join(process.cwd(), "public/terms.html"), "utf8");
  const privacyHtml = await fs.readFile(path.join(process.cwd(), "public/privacy.html"), "utf8");
  const legalPageJs = await fs.readFile(path.join(process.cwd(), "public/legal-page.js"), "utf8");

  // terms.html
  assert.ok(termsHtml.includes('href="mailto:support@helmeros.com"'), "terms.html links to support@helmeros.com");
  assert.ok(termsHtml.includes("support-chat-widget"), "terms.html has support-chat-widget");
  assert.ok(termsHtml.includes("support-chat-popover"), "terms.html has support-chat-popover");
  assert.ok(termsHtml.includes("support-email-option"), "terms.html has support-email-option");
  assert.ok(termsHtml.includes("Salam, kömək lazımdır?"), "terms.html contains default greeting");
  assert.ok(termsHtml.includes("/legal-page.js"), "terms.html loads legal-page.js");

  // privacy.html
  assert.ok(privacyHtml.includes('href="mailto:support@helmeros.com"'), "privacy.html links to support@helmeros.com");
  assert.ok(privacyHtml.includes("support-chat-widget"), "privacy.html has support-chat-widget");
  assert.ok(privacyHtml.includes("support-chat-popover"), "privacy.html has support-chat-popover");
  assert.ok(privacyHtml.includes("support-email-option"), "privacy.html has support-email-option");
  assert.ok(privacyHtml.includes("Salam, kömək lazımdır?"), "privacy.html contains default greeting");
  assert.ok(privacyHtml.includes("/legal-page.js"), "privacy.html loads legal-page.js");
  assert.ok(legalPageJs.includes("updateSupportChat"), "legal-page.js updates greeting dynamically");
});
