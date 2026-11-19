import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { TRANSLATIONS } from "../public/i18n.js";

test("index.html contains dedicated mobile profile sheet overlay and desktop popover container", async () => {
  const html = await fs.readFile(path.join(process.cwd(), "public/index.html"), "utf8");

  assert.ok(html.includes('id="mobileProfileSheetOverlay"'), "mobileProfileSheetOverlay is present in index.html");
  assert.ok(html.includes('id="profilePopoverMenu"'), "profilePopoverMenu is present in index.html");
});

test("i18n.js contains profileMenu translations in both AZ and EN", () => {
  const azMenu = TRANSLATIONS.az.profileMenu;
  const enMenu = TRANSLATIONS.en.profileMenu;

  assert.ok(azMenu, "az.profileMenu is defined");
  assert.ok(enMenu, "en.profileMenu is defined");

  const requiredKeys = [
    "personalization",
    "profile",
    "security",
    "legal",
    "help",
    "logout",
  ];

  for (const key of requiredKeys) {
    assert.ok(typeof azMenu[key] === "string" && azMenu[key].length > 0, `az.profileMenu.${key} is non-empty string`);
    assert.ok(typeof enMenu[key] === "string" && enMenu[key].length > 0, `en.profileMenu.${key} is non-empty string`);
  }
});

test("script.js implements responsive profile menu (desktop popover vs mobile sheet) and excludes Upgrade plan", async () => {
  const js = await fs.readFile(path.join(process.cwd(), "public/script.js"), "utf8");

  // Function declarations
  assert.ok(js.includes("function openUserProfileMenu"), "openUserProfileMenu is declared");
  assert.ok(js.includes("function closeUserProfileMenu"), "closeUserProfileMenu is declared");
  assert.ok(js.includes("function buildProfileMenuItems"), "buildProfileMenuItems is declared");

  // Verify "Upgrade plan" is NOT added to profile menu items
  const menuFnMatch = js.substring(
    js.indexOf("function buildProfileMenuItems"),
    js.indexOf("function openUserProfileMenu")
  );
  assert.ok(
    !menuFnMatch.toLowerCase().includes("upgrade plan"),
    "Upgrade plan must not be added to profile menu"
  );
  assert.ok(
    !menuFnMatch.toLowerCase().includes("upgradeplan"),
    "Upgrade plan must not be added to profile menu"
  );

  // Structure & elements in Header: Avatar, Name, chevron (Plan status omitted per user request)
  assert.ok(menuFnMatch.includes("profile-menu-header"), "profile-menu-header is built");
  assert.ok(menuFnMatch.includes("profile-menu-avatar"), "profile-menu-avatar is included in header");
  assert.ok(menuFnMatch.includes("profile-menu-name"), "profile-menu-name is included in header");
  assert.ok(!menuFnMatch.includes("profile-menu-plan"), "profile-menu-plan is omitted from header per request");
  assert.ok(menuFnMatch.includes("profile-menu-chevron"), "profile-menu-chevron is included in header");

  // Dividers
  assert.ok(menuFnMatch.includes("profile-menu-divider"), "subtle dividers separate sections");

  // Section 1: Settings sections (Profile, Personalization, Security, Legal)
  assert.ok(menuFnMatch.includes("profile-menu-section-1"), "section 1 is present");
  assert.ok(menuFnMatch.includes("profileMenu.profile"), "Profile item is wired in section 1");
  assert.ok(menuFnMatch.includes("profileMenu.personalization"), "Personalization item is wired in section 1");
  assert.ok(menuFnMatch.includes("profileMenu.security"), "Security item is wired in section 1");
  assert.ok(menuFnMatch.includes("profileMenu.legal"), "Legal item is wired in section 1");

  // Section 2: Help (">"), Log out (">")
  assert.ok(menuFnMatch.includes("profile-menu-section-2"), "section 2 is present");
  assert.ok(menuFnMatch.includes("profileMenu.help"), "Help item is wired in section 2");
  assert.ok(menuFnMatch.includes("profileMenu.logout"), "Log out item is wired in section 2");

  // Behavior: Wiring to bottom-left account triggers
  assert.ok(js.includes("openUserProfileMenu(accountButton)"), "accountButton triggers openUserProfileMenu");
  assert.ok(js.includes("openUserProfileMenu(railAccountButton)"), "railAccountButton triggers openUserProfileMenu");

  // Behavior: Desktop outside click & Escape key
  assert.ok(js.includes("closeUserProfileMenu()"), "closeUserProfileMenu is called on Escape and outside click");

  // Behavior: Mobile bottom sheet swipe-down & backdrop click
  assert.ok(js.includes("attachSwipeDownToClose(sheet, closeUserProfileMenu)"), "mobile bottom sheet attaches swipe-down gesture");
  assert.ok(js.includes("mobileProfileSheetOverlay?.addEventListener(\"click\""), "tapping overlay closes profile sheet");
});

test("style.css defines desktop popover, mobile sheet, dividers, and dark mode parity", async () => {
  const css = await fs.readFile(path.join(process.cwd(), "public/style.css"), "utf8");

  // Desktop Popover styles
  assert.ok(css.includes(".profile-popover-menu"), ".profile-popover-menu is defined");
  assert.ok(css.includes(".profile-popover-menu.is-open"), ".profile-popover-menu.is-open is defined");
  assert.ok(css.includes(".profile-popover-menu[hidden]"), ".profile-popover-menu[hidden] is styled");

  // Mobile Bottom Sheet styles
  assert.ok(css.includes(".mobile-profile-sheet-overlay"), ".mobile-profile-sheet-overlay is defined");
  assert.ok(css.includes(".mobile-profile-sheet"), ".mobile-profile-sheet is defined");

  // Header, items, dividers
  assert.ok(css.includes(".profile-menu-header"), ".profile-menu-header is defined");
  assert.ok(css.includes(".profile-menu-avatar"), ".profile-menu-avatar is defined");
  assert.ok(css.includes(".profile-menu-plan"), ".profile-menu-plan is defined");
  assert.ok(css.includes(".profile-menu-divider"), ".profile-menu-divider is defined");
  assert.ok(css.includes(".profile-menu-item"), ".profile-menu-item is defined");
  assert.ok(css.includes(".profile-menu-item.is-danger"), ".profile-menu-item.is-danger (logout) is defined");

  // Dark mode parity
  assert.ok(css.includes('[data-theme="dark"] .profile-popover-menu'), "Dark mode styling for popover exists");
  assert.ok(css.includes('[data-theme="dark"] .profile-menu-item:hover'), "Dark mode hover styling for menu item exists");

  // Settings navbar removal
  assert.ok(css.includes(".settings-tabs {\n  display: none !important;"), "settings navigation bar is removed/hidden");
});

test("Settings: back button is rendered in top-left corner with return icon and restores previous view", async () => {
  const js = await fs.readFile(path.join(process.cwd(), "public/script.js"), "utf8");
  const css = await fs.readFile(path.join(process.cwd(), "public/style.css"), "utf8");

  // Script renders topNav with back button and SVG return icon
  assert.ok(js.includes("settings-top-nav"), "settings-top-nav container is present");
  assert.ok(js.includes("settings-back-btn"), "settings-back-btn is present");
  assert.ok(js.includes("settingsBackBtn"), "settingsBackBtn id is present");
  assert.ok(js.includes("settings-back-icon"), "settings-back-icon SVG is rendered");
  assert.ok(js.includes("settings-back-label"), "settings-back-label is rendered");
  assert.ok(js.includes("state.view = state.previousView || \"home\";"), "back button restores previous view or home");

  // CSS styling for back button and dark mode parity
  assert.ok(css.includes(".settings-top-nav {"), ".settings-top-nav styling is defined");
  assert.ok(css.includes(".settings-back-btn {"), ".settings-back-btn styling is defined");
  assert.ok(css.includes(".settings-back-btn:hover"), ".settings-back-btn:hover styling is defined");
  assert.ok(css.includes('[data-theme="dark"] .settings-back-btn'), "Dark mode .settings-back-btn styling is defined");
});

test("Profile icon tooltip and aria-label are localized in English and Azerbaijani", async () => {
  const js = await fs.readFile(path.join(process.cwd(), "public/script.js"), "utf8");

  // Translation dictionaries have accountSettings and openAccountSettings
  assert.equal(TRANSLATIONS.az.nav.accountSettings, "Hesab tənzimləmələri");
  assert.equal(TRANSLATIONS.en.nav.accountSettings, "Account Settings");
  assert.equal(TRANSLATIONS.az.nav.openAccountSettings, "Hesab tənzimləmələrini aç");
  assert.equal(TRANSLATIONS.en.nav.openAccountSettings, "Open account settings");

  // script.js syncNav sets data-tooltip and aria-label dynamically for railAccountButton
  assert.ok(js.includes('railAccountButton.setAttribute("data-tooltip", t("nav.accountSettings")'), "railAccountButton data-tooltip is synced with i18n");
  assert.ok(js.includes('railAccountButton.setAttribute("aria-label", t("nav.openAccountSettings")'), "railAccountButton aria-label is synced with i18n");
});

test("Profile menu: renders user email below profile name and omits legacy guest daily limits", async () => {
  const js = await fs.readFile(path.join(process.cwd(), "public/script.js"), "utf8");
  const css = await fs.readFile(path.join(process.cwd(), "public/style.css"), "utf8");

  // Email under profile name
  assert.ok(js.includes("profile-menu-email"), "profile-menu-email is rendered");
  assert.ok(css.includes(".profile-menu-email"), ".profile-menu-email styling is defined in style.css");

  // Legacy guest daily limits section is removed from profile menu
  assert.ok(!js.includes("profile-menu-limits"), "profile-menu-limits container is removed from guest profile menu");
});



