import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

test("index.html: mobile top navigation bar isolates intake/home view and active chat screen", async () => {
  const html = await fs.readFile(path.join(process.cwd(), "public/index.html"), "utf8");

  // Header container
  assert.ok(html.includes('<header class="mobile-header" id="mobileHeader">'), "mobileHeader element is present");

  // Intake View Bar (Mobile Home View)
  assert.ok(html.includes('class="mobile-header-intake" id="mobileHeaderIntake"'), "mobileHeaderIntake container is present");
  assert.ok(html.includes('id="mobileMenuButton"'), "mobileMenuButton is present in intake view");
  assert.ok(html.includes('>☰<'), "hamburger icon is present in intake menu button");
  assert.ok(html.includes('class="mobile-mode-switch" id="mobileModeSwitch"'), "mobileModeSwitch is present in intake view");
  assert.ok(html.includes('id="buildModeButton"'), "buildModeButton is present in intake view");
  assert.ok(html.includes('id="askModeButton"'), "askModeButton is present in intake view");
  assert.ok(html.includes('class="mobile-mode-chevron"'), "mobile-mode-chevron is present in askModeButton");
  assert.ok(html.includes('class="mobile-header-spacer"'), "mobile-header-spacer is present to balance intake grid");

  // Active Chat Bar (Chat Mode ONLY)
  assert.ok(html.includes('class="mobile-header-chat" id="mobileHeaderChat"'), "mobileHeaderChat container is present");

  // Left: Circular dark pill with 2-line menu icon (=)
  assert.ok(html.includes('id="mobileChatMenuButton"'), "mobileChatMenuButton is present in chat view");
  assert.ok(html.includes('class="mobile-menu-icon"'), "mobile-menu-icon SVG is present inside mobileChatMenuButton");
  assert.ok(html.includes('line x1="4" y1="8" x2="20" y2="8"'), "first horizontal line of = menu icon exists");
  assert.ok(html.includes('line x1="4" y1="16" x2="20" y2="16"'), "second horizontal line of = menu icon exists");

  // Left Group: Combined Hamburger Menu (=) and Model Selector Dropdown (Helmer ▾)
  assert.ok(html.includes('class="mobile-chat-left-group"'), "mobile-chat-left-group container is present in chat view");
  assert.ok(html.includes('id="mobileChatMenuButton"'), "mobileChatMenuButton is present in chat view");
  assert.ok(html.includes('class="mobile-menu-icon"'), "mobile-menu-icon SVG is present inside mobileChatMenuButton");
  assert.ok(html.includes('line x1="4" y1="8" x2="20" y2="8"'), "first horizontal line of = menu icon exists");
  assert.ok(html.includes('line x1="4" y1="16" x2="20" y2="16"'), "second horizontal line of = menu icon exists");
  assert.ok(html.includes('id="mobileChatModelButton"'), "mobileChatModelButton is present for model selection");
  assert.ok(html.includes('id="mobileActiveModelName"'), "mobileActiveModelName element is present");
  assert.ok(html.includes('>Helmer<'), "Initial model label defaults to Helmer");

  // Right: Standalone New Chat Button (Pencil Icon)
  assert.ok(html.includes('id="mobileNewButton"'), "mobileNewButton is present as standalone right button");
  assert.ok(html.includes('class="icon-button mobile-pill-btn mobile-new-pill-btn mobile-new"'), "mobileNewButton is styled as a standalone pill button");

  // Three dots (•••) and actions pill completely removed
  assert.ok(!html.includes('id="mobileMoreButton"'), "mobileMoreButton is removed from active chat view");
  assert.ok(!html.includes('class="mobile-actions-pill"'), "mobile-actions-pill is removed from active chat view");
});

test("style.css: isolates intake vs active chat views, defines fading dark gradient, sticky position, and desktop isolation", async () => {
  const css = await fs.readFile(path.join(process.cwd(), "public/style.css"), "utf8");

  // Desktop check: mobile header is hidden on desktop (outside @media)
  assert.ok(css.includes(".mobile-header {\n  display: none;") || css.includes(".mobile-header { display: none;"), "mobile-header is hidden on desktop");

  // Mobile Header container styles
  assert.ok(css.includes(".mobile-header {"), "mobile-header is defined");
  assert.ok(css.includes("position: sticky;"), "mobile-header uses sticky positioning");

  // Intake view styling
  assert.ok(css.includes(".mobile-header-intake {"), "mobile-header-intake is defined");
  assert.ok(css.includes("grid-template-columns: 44px minmax(0, 1fr) 44px;"), "mobile-header-intake uses 3-column grid");
  assert.ok(css.includes(".mobile-header-intake #mobileMenuButton"), "mobileMenuButton in intake view is styled");

  // Chat bar styling - edge alignment and full width
  assert.ok(css.includes(".mobile-header-chat {"), "mobile-header-chat is defined");
  assert.ok(css.includes("display: none;"), "mobile-header-chat is hidden by default");
  assert.ok(css.includes("justify-content: space-between;"), "mobile-header-chat distributes elements to left and right edges");

  // View isolation via .is-chat-active
  assert.ok(css.includes(".mobile-header.is-chat-active .mobile-header-intake {\n    display: none !important;"), "intake bar is hidden when chat is active");
  assert.ok(css.includes(".mobile-header.is-chat-active .mobile-header-chat {\n    display: flex !important;"), "chat bar is displayed when chat is active");
  assert.ok(css.includes(".mobile-header.is-chat-active {"), "mobile-header.is-chat-active has dedicated styling");
  assert.ok(css.includes("linear-gradient(180deg, rgba(0, 0, 0,"), "mobile-header defines top-to-bottom dark gradient fade in chat mode");

  // Touch pass-through
  assert.ok(css.includes("pointer-events: none;"), "header allows touch pass-through on empty fade areas in chat mode");
  assert.ok(css.includes("pointer-events: auto;"), "buttons retain pointer-events auto");

  // Left: Combined group
  assert.ok(css.includes(".mobile-chat-left-group {"), ".mobile-chat-left-group is defined");
  assert.ok(css.includes("gap: 8px;"), ".mobile-chat-left-group spaces menu and model selector");

  // Touch targets: 42px touch target dimensions
  assert.ok(css.includes("width: 42px;"), "circular pill buttons have 42px width");
  assert.ok(css.includes("height: 42px;"), "circular pill buttons have 42px height");
  assert.ok(css.includes(".mobile-menu-pill-btn"), ".mobile-menu-pill-btn is defined");
  assert.ok(css.includes(".mobile-new-pill-btn"), ".mobile-new-pill-btn is defined");
  assert.ok(css.includes("border-radius: 50%;"), "circular pill uses 50% border radius");
  assert.ok(css.includes(".mobile-menu-icon"), ".mobile-menu-icon is styled");

  // Center: Native model pill
  assert.ok(css.includes(".mobile-model-pill-btn"), ".mobile-model-pill-btn is defined");
  assert.ok(css.includes(".mobile-active-model-name"), ".mobile-active-model-name is styled");
  assert.ok(css.includes(".mobile-mode-chevron"), ".mobile-mode-chevron is styled");
  assert.ok(css.includes("transform: rotate(180deg);"), "chevron rotates 180 degrees when model sheet is open");

  // Dark mode parity
  assert.ok(css.includes('[data-theme="dark"] .mobile-header.is-chat-active') || css.includes('html.dark .mobile-header.is-chat-active'), "Dark mode mobile-header.is-chat-active styling is defined");
  assert.ok(css.includes('[data-theme="dark"] .mobile-header .mobile-new-pill-btn') || css.includes('html.dark .mobile-header .mobile-new-pill-btn'), "Dark mode mobile new button styling is defined");
  assert.ok(css.includes('[data-theme="dark"] .mobile-header-intake #mobileMenuButton') || css.includes('html.dark .mobile-header-intake #mobileMenuButton'), "Dark mode mobile intake menu button styling is defined");
});

test("script.js: applies is-chat-active ONLY during active chat, wires model/profile dropdowns, and complies with Rule 4", async () => {
  const js = await fs.readFile(path.join(process.cwd(), "public/script.js"), "utf8");

  // State sync: toggles is-chat-active ONLY on active chat
  assert.ok(js.includes('mobileHeader.classList.toggle("is-chat-active", isChatActive)'), "is-chat-active is toggled on mobileHeader based on isChatActive");
  assert.ok(js.includes('document.body.classList.toggle("is-chat-active", isChatActive)'), "is-chat-active is toggled on body");

  // Event handler for mobile more button (•••)
  assert.ok(js.includes('document.querySelector("#mobileMoreButton")?.addEventListener("click"'), "mobileMoreButton click listener is attached");
  assert.ok(js.includes('openUserProfileMenu(document.querySelector("#mobileMoreButton"))'), "mobileMoreButton opens user profile menu");

  // Event handler for chat model button
  assert.ok(js.includes('document.querySelector("#mobileChatModelButton")?.addEventListener("click"'), "mobileChatModelButton click listener is attached");

  // Event handler for chat menu button
  assert.ok(js.includes('document.querySelector("#mobileChatMenuButton")?.addEventListener("click"'), "mobileChatMenuButton click listener is attached");

  // updateMobileActiveModelName function & Rule 4 compliance
  assert.ok(js.includes("function updateMobileActiveModelName()"), "updateMobileActiveModelName is declared");
  assert.ok(js.includes('el.textContent = "Helmer"'), "Model name is safely set using textContent per Rule 4");
  assert.ok(!js.includes("mobileActiveModelName.innerHTML ="), "Raw innerHTML is never used for model name");

  // Open / close state toggling on chat model button
  assert.ok(js.includes('chatModelBtn.classList.add("is-open")'), "chatModelBtn adds is-open class when sheet opens");
  assert.ok(js.includes('chatModelBtn.classList.remove("is-open")'), "chatModelBtn removes is-open class when sheet closes");

  // Localization sync
  assert.ok(js.includes('document.querySelector("#mobileMoreButton")'), "syncLanguageControls handles mobileMoreButton");
  assert.ok(js.includes('document.querySelector("#mobileChatMenuButton")'), "syncLanguageControls handles mobileChatMenuButton");
  assert.ok(js.includes('document.querySelector("#mobileChatModelButton")'), "syncLanguageControls handles mobileChatModelButton");
});
