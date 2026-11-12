import { createUpView } from "./up.js";
import { createDocumentExport, createExcelExport, createSpreadsheetExport, exportStrategyToPDF } from "./exporters.js";
import { readUploadedFileAsData as readFileAsData } from "./file-utils.js";
import { authRequest, initializeAuthentication, logout } from "./auth.js?v=1.1";
import { PRESET_PROMPTS, getPresetPrompts } from "./preset-prompts.js";
import "/artifacts.js";
import {
  t,
  getLanguage,
  setLanguage,
  formatDate as i18nFormatDate,
  LEGAL_DOCS_I18N,
  TRANSLATIONS,
} from "./i18n.js?v=8.5";

const workspace = document.querySelector("#workspace");
const renderUpView = createUpView({ request: authRequest, getUser: () => state.currentUser, getLanguage, onLogin: () => window.dispatchEvent(new CustomEvent("helmer:auth-required")) });
const sidebar = document.querySelector("#sidebar");
const mobileOverlay = document.querySelector("#mobileOverlay");
const mobileMenuButton = document.querySelector("#mobileMenuButton");
const mobileNewButton = document.querySelector("#mobileNewButton");
const railMenuButton = document.querySelector("#railMenuButton");
const railHomeButton = document.querySelector("#railHomeButton");
const railSearchButton = document.querySelector("#railSearchButton");
const railStrategiesButton = document.querySelector("#railStrategiesButton");
const railPlannerButton = document.querySelector("#railPlannerButton");
const railModeToggleButton = document.querySelector("#railModeToggleButton");
const sidebarClose = document.querySelector("#sidebarClose");
const newStrategyButton = document.querySelector("#newStrategyButton");
const sidebarLabel = document.querySelector(".sidebar-label");
const toastRegion = document.querySelector("#toastRegion");
const recentList = document.querySelector("#recentList");
const strategyCount = document.querySelector("#strategyCount");
const plannerCount = document.querySelector("#plannerCount");
const searchNav = document.querySelector("#searchNav");
const homeNav = document.querySelector("#homeNav");
const strategiesNav = document.querySelector("#strategiesNav");
const plannerNav = document.querySelector("#plannerNav");
const upNav = document.querySelector("#upNav");
const railUpButton = document.querySelector("#railUpButton");
const installAppNav = document.querySelector("#installAppNav");
const whatsNewNav = document.querySelector("#whatsNewNav");
const railInstallAppButton = document.querySelector("#railInstallAppButton");
const railLangToggleButton = document.querySelector("#railLangToggleButton");
const railLangBadge = document.querySelector("#railLangBadge");
const railAccountButton = document.querySelector("#railAccountButton");

export const NAV_ITEMS = [
  {
    id: "home",
    sidebarId: "homeNav",
    railId: "railHomeButton",
    labelKey: "nav.home",
    defaultLabelAz: "Başlanğıc",
    defaultLabelEn: "Home",
    icon: "Home",
    svg: `<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>`
  },
  {
    id: "search",
    sidebarId: "searchNav",
    railId: "railSearchButton",
    labelKey: "nav.searchChats",
    defaultLabelAz: "Axtarış",
    defaultLabelEn: "Search",
    icon: "Search",
    svg: `<circle cx="11" cy="11" r="7.5"/><path d="m16.5 16.5 4.5 4.5"/>`
  },
  {
    id: "archive",
    sidebarId: "strategiesNav",
    railId: "railStrategiesButton",
    labelKey: "nav.archive",
    defaultLabelAz: "Arxiv",
    defaultLabelEn: "Archive",
    icon: "Archive",
    svg: `<rect width="20" height="5" x="2" y="3" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/><path d="M10 12h4"/>`
  },
  {
    id: "planner",
    sidebarId: "plannerNav",
    railId: "railPlannerButton",
    labelKey: "nav.planner",
    defaultLabelAz: "Planlaşdırılanlar",
    defaultLabelEn: "Planner",
    icon: "CalendarDays",
    svg: `<rect width="18" height="18" x="3" y="4" rx="2"/><path d="M8 2v4"/><path d="M16 2v4"/><path d="M3 10h18"/><path d="M8 14h.01"/><path d="M12 14h.01"/><path d="M16 14h.01"/><path d="M8 18h.01"/><path d="M12 18h.01"/><path d="M16 18h.01"/>`
  },
  {
    id: "up",
    sidebarId: "upNav",
    railId: "railUpButton",
    labelKey: "nav.up",
    defaultLabelAz: "Helmer UP",
    defaultLabelEn: "Helmer UP",
    icon: "Brain",
    svg: `<path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z"/><path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z"/><path d="M15 13a4.5 4.5 0 0 1-3-4 4.5 4.5 0 0 1-3 4"/><path d="M17.599 6.5a3 3 0 0 0 .399-1.375"/><path d="M6.003 5.125A3 3 0 0 0 6.401 6.5"/><path d="M3.477 10.896a4 4 0 0 1 .585-.396"/><path d="M19.938 10.5a4 4 0 0 1 .585.396"/><path d="M6 18a4 4 0 0 1-1.967-.516"/><path d="M19.967 17.484A4 4 0 0 1 18 18"/>`
  },
];
const accountButton = document.querySelector("#accountButton");
const workspaceAvatar = document.querySelector("#workspaceAvatar");
const railWorkspaceAvatar = document.querySelector("#railWorkspaceAvatar");
const workspaceName = document.querySelector("#workspaceName");
const workspaceMeta = document.querySelector("#workspaceMeta");
const buildModeButton = document.querySelector("#buildModeButton");
const askModeButton = document.querySelector("#askModeButton");
const mobileModeSwitch = document.querySelector(".mobile-mode-switch");
const sidebarBuildModeButton = document.querySelector("#sidebarBuildModeButton");
const sidebarAskModeButton = document.querySelector("#sidebarAskModeButton");
const keyboardShortcutsButton = document.querySelector("#keyboardShortcutsBtn");
const keyboardShortcutsOverlay = document.querySelector("#keyboardShortcutsOverlay");
const installAppModalOverlay = document.querySelector("#installAppModalOverlay");
const changelogModalOverlay = document.querySelector("#changelogModalOverlay");
const mobileBottomSheetOverlay = document.querySelector("#mobileBottomSheetOverlay");
const mobileModelSheetOverlay = document.querySelector("#mobileModelSheetOverlay");
const mobileProfileSheetOverlay = document.querySelector("#mobileProfileSheetOverlay");
const mobileNotifSheetOverlay = document.querySelector("#mobileNotifSheetOverlay");
const guideModalOverlay = document.querySelector("#guideModalOverlay");
const profilePopoverMenu = document.querySelector("#profilePopoverMenu");

function openSettings(tab = "account") {
  if (state.view !== "settings") {
    state.previousView = state.view;
  }
  state.view = "settings";
  state.settingsTab = tab;
  syncNav();
  render();
  closeSidebar();
  if (typeof closeUserProfileMenu === "function") {
    closeUserProfileMenu();
  }
}

function getKeyboardShortcuts() {
  const isEn = getLanguage() === "en";
  return [
    { label: t("shortcuts.items.newStrategyOrChat"), mac: "⌘ ⌥ N", windows: "Ctrl Alt N", action: () => (state.mode === "ask" ? startNewChat() : resetStrategy()) },
    { label: t("nav.search") || (isEn ? "Search" : "Axtarış"), mac: "⌘ K", windows: "Ctrl K", action: () => openSearchModal() },
    { label: t("shortcuts.items.home"), mac: "⌘ 1", windows: "Ctrl 1", action: () => homeNav?.click() },
    { label: t("shortcuts.items.archive"), mac: "⌘ 2", windows: "Ctrl 2", action: () => strategiesNav?.click() },
    { label: t("shortcuts.items.planner"), mac: "⌘ 3", windows: "Ctrl 3", action: () => plannerNav?.click() },
    { label: t("shortcuts.items.settings"), mac: "⌘ ,", windows: "Ctrl ,", action: () => openSettings() },
    { label: t("shortcuts.items.toggleMode"), mac: "⌘ ⇧ A", windows: "Ctrl ⇧ A", action: () => setMode(state.mode === "build" ? "ask" : "build") },
    { label: t("shortcuts.items.closeModal"), mac: "Esc", windows: "Esc", action: () => closeShortcutModal() },
  ];
}

function isMacPlatform() {
  return /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent);
}

function shortcutSuffix(macShortcut, windowsShortcut) {
  return ` · ${isMacPlatform() ? macShortcut : windowsShortcut}`;
}

function isTypingTarget(target) {
  return target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
}

function createShortcutKey(value) {
  return element("kbd", "shortcut-key", value);
}

function openShortcutModal() {
  if (!keyboardShortcutsOverlay || window.innerWidth <= 767) return;

  keyboardShortcutsOverlay.replaceChildren();
  const card = element("div", "keyboard-shortcuts-card");
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-modal", "true");
  card.setAttribute("aria-labelledby", "keyboardShortcutsTitle");

  const header = element("header", "keyboard-shortcuts-header");
  const titleGroup = element("div", "keyboard-shortcuts-title-group");
  const title = element("h2", "", t("shortcuts.title"));
  title.id = "keyboardShortcutsTitle";
  titleGroup.append(title, element("p", "", t("shortcuts.subtitle", { platform: isMacPlatform() ? "macOS" : "Windows/Linux" })));

  const closeButton = button("✕", "keyboard-shortcuts-close", closeShortcutModal);
  closeButton.setAttribute("aria-label", t("shortcuts.closeAria"));
  header.append(titleGroup, closeButton);

  const body = element("div", "keyboard-shortcuts-body");
  const table = element("div", "keyboard-shortcuts-list");
  table.setAttribute("role", "list");
  getKeyboardShortcuts().forEach((shortcut) => {
    const row = element("div", "keyboard-shortcut-row");
    row.setAttribute("role", "listitem");
    const copy = element("div", "keyboard-shortcut-copy");
    copy.appendChild(element("strong", "", shortcut.label));
    const keys = element("div", "keyboard-shortcut-keys");
    keys.append(createShortcutKey(shortcut.mac), element("span", "keyboard-shortcut-or", t("shortcuts.or")), createShortcutKey(shortcut.windows));
    row.append(copy, keys);
    table.appendChild(row);
  });
  body.append(table, element("p", "keyboard-shortcuts-hint", t("shortcuts.hint")));

  card.append(header, body);
  keyboardShortcutsOverlay.appendChild(card);
  keyboardShortcutsOverlay.hidden = false;
  document.body.style.overflow = "hidden";
  closeButton.focus();
}

function closeShortcutModal() {
  if (!keyboardShortcutsOverlay) return;
  keyboardShortcutsOverlay.hidden = true;
  keyboardShortcutsOverlay.replaceChildren();
  if (document.querySelector("#legalModalOverlay[hidden]") && (!installAppModalOverlay || installAppModalOverlay.hidden)) {
    document.body.style.overflow = "";
  }
}

let searchModalOverlay = null;

function closeSearchModal() {
  if (!searchModalOverlay) return;
  searchModalOverlay.remove();
  searchModalOverlay = null;
  document.body.style.overflow = "";
}

function openSearchModal({ allChats = false } = {}) {
  closeSearchModal();
  closeSidebar();

  const isEn = getLanguage() === "en";
  const isAsk = state.mode === "ask";
  const epoch = state.identityEpoch;
  const expectedUserId = state.currentUser?.id || null;
  searchModalOverlay = element("div", "sidebar-search-overlay");
  searchModalOverlay.setAttribute("role", "dialog");
  searchModalOverlay.setAttribute("aria-modal", "true");
  searchModalOverlay.setAttribute(
    "aria-label",
    isAsk
      ? (isEn ? "Search chats" : "Söhbətlərdə axtar")
      : (isEn ? "Search strategies" : "Strategiyalarda axtar")
  );

  const openedOverlay = searchModalOverlay;
  const card = element("div", "sidebar-search-card");
  const handle = element("div", "sidebar-search-handle");
  card.appendChild(handle);

  const header = element("div", "sidebar-search-header");

  const searchSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  searchSvg.setAttribute("class", "nav-svg");
  searchSvg.setAttribute("viewBox", "0 0 24 24");
  searchSvg.setAttribute("fill", "none");
  searchSvg.setAttribute("stroke", "currentColor");
  searchSvg.setAttribute("stroke-width", "1.75");
  searchSvg.setAttribute("stroke-linecap", "round");
  searchSvg.setAttribute("stroke-linejoin", "round");
  searchSvg.setAttribute("aria-hidden", "true");
  const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  circle.setAttribute("cx", "11");
  circle.setAttribute("cy", "11");
  circle.setAttribute("r", "7.5");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", "m16.5 16.5 4.5 4.5");
  searchSvg.append(circle, path);

  const input = element("input", "sidebar-search-input");
  input.type = "text";
  input.placeholder = isAsk
    ? (isEn ? "Search chat history..." : "Söhbət tarixçəsində axtar...")
    : (isEn ? "Search strategies..." : "Strategiyalarda axtar...");
  input.autocomplete = "off";

  const kbd = element("kbd", "sidebar-search-kbd", "Esc");

  const closeBtn = element("button", "sidebar-search-close");
  closeBtn.type = "button";
  closeBtn.setAttribute("aria-label", isEn ? "Close" : "Bağla");
  const closeSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  closeSvg.setAttribute("viewBox", "0 0 24 24");
  closeSvg.setAttribute("width", "16");
  closeSvg.setAttribute("height", "16");
  closeSvg.setAttribute("fill", "none");
  closeSvg.setAttribute("stroke", "currentColor");
  closeSvg.setAttribute("stroke-width", "2");
  closeSvg.setAttribute("stroke-linecap", "round");
  closeSvg.setAttribute("stroke-linejoin", "round");
  const closePath = document.createElementNS("http://www.w3.org/2000/svg", "path");
  closePath.setAttribute("d", "m18 6-12 12M6 6l12 12");
  closeSvg.appendChild(closePath);
  closeBtn.appendChild(closeSvg);
  closeBtn.addEventListener("click", () => closeSearchModal());

  header.append(searchSvg, input, kbd, closeBtn);

  const body = element("div", "sidebar-search-body");

  function renderSearchResults(query = "") {
    body.replaceChildren();
    const q = query.trim().toLowerCase();
    const results = [];

    const chatMatches = [];
    (state.savedChats || []).forEach((chat) => {
      const title = chat.title || (isEn ? "Untitled Chat" : "Adsız söhbət");
      const lastMsg = chat.lastMessage || "";
      const matches = !q || title.toLowerCase().includes(q) || lastMsg.toLowerCase().includes(q);
      if (matches) {
        chatMatches.push({
          type: isEn ? "Chat" : "Söhbət",
          title,
          meta: chat.updatedAt ? i18nFormatDate(chat.updatedAt) : "",
          action: () => {
            closeSearchModal();
            openSavedChat(chat.id);
          }
        });
      }
    });

    const strategyMatches = [];
    (state.savedStrategies || []).forEach((strat) => {
      const title = strat.title || (isEn ? "Untitled Strategy" : "Adsız strategiya");
      const brief = strat.brief || "";
      const matches = !q || title.toLowerCase().includes(q) || brief.toLowerCase().includes(q);
      if (matches) {
        strategyMatches.push({
          type: isEn ? "Strategy" : "Strategiya",
          title,
          meta: strat.createdAt ? i18nFormatDate(strat.createdAt) : "",
          action: () => {
            closeSearchModal();
            openSavedStrategy(strat.id);
          }
        });
      }
    });

    if (isAsk) {
      if (allChats || !q) {
        results.push(...chatMatches);
      } else {
        results.push(...chatMatches, ...strategyMatches);
      }
    } else {
      if (!q) {
        results.push(...strategyMatches);
      } else {
        results.push(...strategyMatches, ...chatMatches);
      }
    }

    if (!results.length) {
      const emptyMsg = isAsk
        ? (isEn ? "No matching chats found." : "Uyğun söhbət tapılmadı.")
        : (isEn ? "No matching strategies found." : "Uyğun strategiya tapılmadı.");
      body.appendChild(element("div", "sidebar-search-empty", emptyMsg));
      return;
    }

    const visibleResults = allChats && isAsk ? results : results.slice(0, 20);
    visibleResults.forEach((res) => {
      const item = button("", "sidebar-search-item", res.action);
      item.type = "button";
      const info = element("div", "sidebar-search-item-info");
      info.append(
        element("span", "sidebar-search-item-title", res.title),
        element("span", "sidebar-search-item-meta", res.meta)
      );
      const badge = element("span", "sidebar-search-item-type", res.type);
      item.append(info, badge);
      body.appendChild(item);
    });
  }

  input.addEventListener("input", () => renderSearchResults(input.value));
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const firstItem = body.querySelector(".sidebar-search-item");
      if (firstItem) firstItem.click();
    }
  });

  renderSearchResults("");

  // Ensure chats or strategies are loaded fresh
  if (isAsk && !state.savedChats?.length) {
    loadSavedChats().then(() => {
      if (!isIdentityStale(epoch, expectedUserId) && searchModalOverlay === openedOverlay && document.body.contains(openedOverlay)) {
        renderSearchResults(input.value);
      }
    });
  } else if (!isAsk && !state.savedStrategies?.length) {
    loadSavedStrategies().then(() => {
      if (!isIdentityStale(epoch, expectedUserId) && searchModalOverlay === openedOverlay && document.body.contains(openedOverlay)) {
        renderSearchResults(input.value);
      }
    });
  }

  card.append(header, body);
  searchModalOverlay.appendChild(card);

  searchModalOverlay.addEventListener("click", (e) => {
    if (e.target === searchModalOverlay) closeSearchModal();
  });

  document.body.appendChild(searchModalOverlay);
  document.body.style.overflow = "hidden";
  setTimeout(() => input.focus(), 20);
}

// ── PWA Installation & OS Detection ──────────────────────────────────────────

let deferredInstallPrompt = null;

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    updateInstallButtonVisibility();
  });

  window.addEventListener("appinstalled", () => {
    deferredInstallPrompt = null;
    updateInstallButtonVisibility();
    showToast(t("installModal.installedSuccess"), "info");
  });

  if (window.matchMedia) {
    try {
      window.matchMedia("(display-mode: standalone)").addEventListener("change", () => {
        updateInstallButtonVisibility();
      });
    } catch {
      // Ignore browsers that don't support addEventListener on MediaQueryList
    }
  }
}

function isAppInstalled() {
  if (typeof window === "undefined") return false;
  const isStandalone = Boolean(window.matchMedia && window.matchMedia("(display-mode: standalone)").matches);
  const isNavigatorStandalone = Boolean(typeof navigator !== "undefined" && navigator.standalone === true);
  const isAndroidApp = Boolean(typeof document !== "undefined" && document.referrer && document.referrer.includes("android-app://"));
  return isStandalone || isNavigatorStandalone || isAndroidApp;
}

function updateInstallButtonVisibility() {
  const installed = isAppInstalled();
  if (installAppNav) {
    installAppNav.hidden = installed;
    if (installed) {
      installAppNav.setAttribute("aria-hidden", "true");
    } else {
      installAppNav.removeAttribute("aria-hidden");
    }
  }
  if (railInstallAppButton) {
    railInstallAppButton.hidden = installed;
    if (installed) {
      railInstallAppButton.setAttribute("aria-hidden", "true");
    } else {
      railInstallAppButton.removeAttribute("aria-hidden");
    }
  }
}

function getDevicePlatform() {
  const ua = (typeof navigator !== "undefined" && navigator.userAgent) ? navigator.userAgent : "";
  const platform = (typeof navigator !== "undefined" && navigator.platform) ? navigator.platform : "";
  const maxTouchPoints = (typeof navigator !== "undefined" && navigator.maxTouchPoints) ? navigator.maxTouchPoints : 0;

  const isIOS = /iPad|iPhone|iPod/.test(ua) || (platform === "MacIntel" && maxTouchPoints > 1);
  if (isIOS) return "ios";

  const isAndroid = /Android/i.test(ua);
  if (isAndroid) return "android";

  return "desktop";
}

async function handleInstallAppClick() {
  if (isAppInstalled()) {
    showToast(t("installModal.alreadyInstalledToast"), "info");
    return;
  }

  const platform = getDevicePlatform();

  if ((platform === "android" || platform === "desktop") && deferredInstallPrompt) {
    try {
      await deferredInstallPrompt.prompt();
      const choiceResult = await deferredInstallPrompt.userChoice;
      if (choiceResult && choiceResult.outcome === "accepted") {
        deferredInstallPrompt = null;
        updateInstallButtonVisibility();
      }
      return;
    } catch (err) {
      console.warn("PWA install prompt error:", err);
    }
  }

  openInstallAppModal(platform);
}

function createInstallSvgIcon(type) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");

  if (type === "app-badge") {
    svg.setAttribute("width", "24");
    svg.setAttribute("height", "24");
    const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    rect.setAttribute("x", "5");
    rect.setAttribute("y", "2");
    rect.setAttribute("width", "14");
    rect.setAttribute("height", "20");
    rect.setAttribute("rx", "2");
    rect.setAttribute("ry", "2");
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", "12");
    line.setAttribute("y1", "18");
    line.setAttribute("x2", "12.01");
    line.setAttribute("y2", "18");
    const arrow = document.createElementNS("http://www.w3.org/2000/svg", "path");
    arrow.setAttribute("d", "M12 6v6M9 9l3 3 3-3");
    svg.append(rect, line, arrow);
  } else if (type === "share") {
    const box = document.createElementNS("http://www.w3.org/2000/svg", "path");
    box.setAttribute("d", "M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8");
    const arrowHead = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
    arrowHead.setAttribute("points", "16 6 12 2 8 6");
    const arrowStem = document.createElementNS("http://www.w3.org/2000/svg", "line");
    arrowStem.setAttribute("x1", "12");
    arrowStem.setAttribute("y1", "2");
    arrowStem.setAttribute("x2", "12");
    arrowStem.setAttribute("y2", "15");
    svg.append(box, arrowHead, arrowStem);
  } else if (type === "plus-square") {
    const square = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    square.setAttribute("x", "3");
    square.setAttribute("y", "3");
    square.setAttribute("width", "18");
    square.setAttribute("height", "18");
    square.setAttribute("rx", "3");
    const vLine = document.createElementNS("http://www.w3.org/2000/svg", "line");
    vLine.setAttribute("x1", "12");
    vLine.setAttribute("y1", "8");
    vLine.setAttribute("x2", "12");
    vLine.setAttribute("y2", "16");
    const hLine = document.createElementNS("http://www.w3.org/2000/svg", "line");
    hLine.setAttribute("x1", "8");
    hLine.setAttribute("y1", "12");
    hLine.setAttribute("x2", "16");
    hLine.setAttribute("y2", "12");
    svg.append(square, vLine, hLine);
  } else if (type === "dots-menu") {
    const c1 = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    c1.setAttribute("cx", "12");
    c1.setAttribute("cy", "5");
    c1.setAttribute("r", "1.5");
    const c2 = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    c2.setAttribute("cx", "12");
    c2.setAttribute("cy", "12");
    c2.setAttribute("r", "1.5");
    const c3 = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    c3.setAttribute("cx", "12");
    c3.setAttribute("cy", "19");
    c3.setAttribute("r", "1.5");
    svg.append(c1, c2, c3);
  } else if (type === "download") {
    const dPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
    dPath.setAttribute("d", "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4");
    const poly = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
    poly.setAttribute("points", "7 10 12 15 17 10");
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", "12");
    line.setAttribute("y1", "15");
    line.setAttribute("x2", "12");
    line.setAttribute("y2", "3");
    svg.append(dPath, poly, line);
  } else if (type === "check") {
    const poly = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
    poly.setAttribute("points", "20 6 9 17 4 12");
    svg.append(poly);
  } else if (type === "monitor") {
    const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    rect.setAttribute("x", "2");
    rect.setAttribute("y", "3");
    rect.setAttribute("width", "20");
    rect.setAttribute("height", "14");
    rect.setAttribute("rx", "2");
    const line1 = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line1.setAttribute("x1", "8");
    line1.setAttribute("y1", "21");
    line1.setAttribute("x2", "16");
    line1.setAttribute("y2", "21");
    const line2 = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line2.setAttribute("x1", "12");
    line2.setAttribute("y1", "17");
    line2.setAttribute("x2", "12");
    line2.setAttribute("y2", "21");
    svg.append(rect, line1, line2);
  }

  return svg;
}

function openInstallAppModal(platform = getDevicePlatform()) {
  if (!installAppModalOverlay) return;

  installAppModalOverlay.replaceChildren();

  const card = element("div", "install-app-modal-card");
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-modal", "true");
  card.setAttribute("aria-labelledby", "installAppModalTitle");

  // Header
  const header = element("header", "install-modal-header");
  const headerLeft = element("div", "install-modal-header-left");

  const iconBadge = element("div", "install-modal-icon-badge");
  iconBadge.appendChild(createInstallSvgIcon("app-badge"));

  const titleGroup = element("div", "install-modal-title-group");
  const title = element("h2", "install-modal-title", t("installModal.title"));
  title.id = "installAppModalTitle";
  const subtitle = element("p", "install-modal-subtitle", t("installModal.subtitle"));

  const badgeText = platform === "ios"
    ? t("installModal.iosBadge")
    : platform === "android"
      ? t("installModal.androidBadge")
      : t("installModal.desktopBadge");
  const platformBadge = element("span", "install-modal-platform-badge", badgeText);

  titleGroup.append(title, subtitle, platformBadge);
  headerLeft.append(iconBadge, titleGroup);

  const closeBtn = button("✕", "install-modal-close", closeInstallAppModal);
  closeBtn.setAttribute("aria-label", t("installModal.closeAria"));
  header.append(headerLeft, closeBtn);

  // Body: Steps
  const body = element("div", "install-modal-body");
  const stepsList = element("ol", "install-modal-steps");
  stepsList.setAttribute("role", "list");

  let steps = [];
  if (platform === "ios") {
    steps = [
      {
        num: "1",
        title: t("installModal.iosStep1Title"),
        pillIcon: "share",
        pillText: "Share",
        desc: t("installModal.iosStep1Desc"),
      },
      {
        num: "2",
        title: t("installModal.iosStep2Title"),
        pillIcon: "plus-square",
        pillText: "+",
        desc: t("installModal.iosStep2Desc"),
      },
      {
        num: "3",
        title: t("installModal.iosStep3Title"),
        pillIcon: "check",
        pillText: "Add",
        desc: t("installModal.iosStep3Desc"),
      },
    ];
  } else if (platform === "android") {
    steps = [
      {
        num: "1",
        title: t("installModal.androidStep1Title"),
        pillIcon: "dots-menu",
        pillText: "⋮",
        desc: t("installModal.androidStep1Desc"),
      },
      {
        num: "2",
        title: t("installModal.androidStep2Title"),
        pillIcon: "download",
        pillText: "Install",
        desc: t("installModal.androidStep2Desc"),
      },
      {
        num: "3",
        title: t("installModal.androidStep3Title"),
        pillIcon: "check",
        pillText: "OK",
        desc: t("installModal.androidStep3Desc"),
      },
    ];
  } else {
    steps = [
      {
        num: "1",
        title: t("installModal.desktopStep1Title"),
        pillIcon: "monitor",
        pillText: "URL",
        desc: t("installModal.desktopStep1Desc"),
      },
      {
        num: "2",
        title: t("installModal.desktopStep2Title"),
        pillIcon: "download",
        pillText: "Install",
        desc: t("installModal.desktopStep2Desc"),
      },
      {
        num: "3",
        title: t("installModal.desktopStep3Title"),
        pillIcon: "check",
        pillText: "App",
        desc: t("installModal.desktopStep3Desc"),
      },
    ];
  }

  steps.forEach((step) => {
    const li = element("li", "install-step-item");
    li.setAttribute("role", "listitem");

    const numBadge = element("span", "install-step-num", step.num);
    const details = element("div", "install-step-details");

    const stepTitle = element("div", "install-step-title");
    stepTitle.appendChild(document.createTextNode(step.title + " "));

    const actionPill = element("span", "install-step-action-pill");
    actionPill.appendChild(createInstallSvgIcon(step.pillIcon));
    actionPill.appendChild(document.createTextNode(step.pillText));
    stepTitle.appendChild(actionPill);

    const stepDesc = element("p", "install-step-desc", step.desc);
    details.append(stepTitle, stepDesc);

    li.append(numBadge, details);
    stepsList.appendChild(li);
  });

  body.appendChild(stepsList);

  // Footer
  const footer = element("footer", "install-modal-footer");
  const understandBtn = button(t("installModal.understandBtn"), "install-modal-btn", closeInstallAppModal);
  footer.appendChild(understandBtn);

  card.append(header, body, footer);
  installAppModalOverlay.appendChild(card);
  installAppModalOverlay.hidden = false;
  document.body.style.overflow = "hidden";
  closeBtn.focus();
}

function closeInstallAppModal() {
  if (!installAppModalOverlay) return;
  installAppModalOverlay.hidden = true;
  installAppModalOverlay.replaceChildren();
  if (
    (!keyboardShortcutsOverlay || keyboardShortcutsOverlay.hidden) &&
    (!changelogModalOverlay || changelogModalOverlay.hidden) &&
    document.querySelector("#legalModalOverlay[hidden]")
  ) {
    document.body.style.overflow = "";
  }
}

function createChangelogSvgIcon(name) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.75");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");

  if (name === "sparkles") {
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("width", "18");
    svg.setAttribute("height", "18");
    const path1 = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path1.setAttribute("d", "m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z");
    const path2 = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path2.setAttribute("d", "M5 3v4M3 5h4M19 17v4M17 19h4");
    svg.append(path1, path2);
  } else if (name === "check") {
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("width", "13");
    svg.setAttribute("height", "13");
    const poly = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
    poly.setAttribute("points", "20 6 9 17 4 12");
    svg.append(poly);
  } else if (name === "close") {
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("width", "16");
    svg.setAttribute("height", "16");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", "m18 6-12 12M6 6l12 12");
    svg.append(path);
  } else if (name === "mail") {
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("width", "15");
    svg.setAttribute("height", "15");
    const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    rect.setAttribute("x", "2");
    rect.setAttribute("y", "4");
    rect.setAttribute("width", "20");
    rect.setAttribute("height", "16");
    rect.setAttribute("rx", "2");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", "m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7");
    svg.append(rect, path);
  }
  return svg;
}

function buildChangelogFooter(currentLang, dict) {
  const footer = element("footer", "changelog-modal-footer");

  const feedbackLink = element("a", "changelog-feedback-btn");
  feedbackLink.href = `mailto:support@helmeros.com?subject=${encodeURIComponent(dict.feedbackSubject || "Helmer Feedback")}`;
  feedbackLink.setAttribute("target", "_blank");
  feedbackLink.setAttribute("rel", "noopener noreferrer");
  const mailIcon = createChangelogSvgIcon("mail");
  const feedbackText = element("span", "changelog-feedback-text", dict.feedbackBtn || (currentLang === "en" ? "Send Feedback" : "Rəy bildir"));
  feedbackLink.append(mailIcon, feedbackText);

  footer.append(feedbackLink);
  return footer;
}

function buildChangelogTimeline() {
  const currentLang = getLanguage() === "en" ? "en" : "az";
  const versionsData = TRANSLATIONS[currentLang]?.changelog?.versions || TRANSLATIONS.az.changelog.versions;

  const timeline = element("div", "changelog-timeline");
  timeline.setAttribute("role", "list");

  versionsData.forEach((entry, index) => {
    const itemClasses = ["changelog-timeline-item"];
    if (entry.isCurrent) itemClasses.push("is-current");
    if (entry.isUpcoming) itemClasses.push("is-upcoming");
    const item = element("div", itemClasses.join(" "));
    item.setAttribute("role", "listitem");

    // Track & Dot
    const marker = element("div", "changelog-timeline-marker");
    const dotClasses = ["changelog-timeline-dot"];
    if (entry.isCurrent) dotClasses.push("is-current");
    if (entry.isUpcoming) dotClasses.push("is-upcoming");
    const dot = element("div", dotClasses.join(" "));
    if (entry.isCurrent || entry.isUpcoming) {
      const pulse = element("div", `changelog-dot-pulse${entry.isUpcoming ? " is-upcoming" : ""}`);
      dot.appendChild(pulse);
    }
    marker.appendChild(dot);
    if (index < versionsData.length - 1) {
      const line = element("div", "changelog-timeline-line");
      marker.appendChild(line);
    }

    // Content Box
    const contentClasses = ["changelog-timeline-content"];
    if (entry.isCurrent) contentClasses.push("is-current");
    if (entry.isUpcoming) contentClasses.push("is-upcoming");
    const content = element("div", contentClasses.join(" "));

    // Header: version tag, status badge, date
    const itemHeader = element("div", "changelog-item-header");
    const tag = element("span", "changelog-version-tag", entry.version);
    const pillClasses = ["changelog-status-pill"];
    if (entry.isCurrent) pillClasses.push("is-current");
    if (entry.isUpcoming) pillClasses.push("is-upcoming");
    const statusPill = element("span", pillClasses.join(" "), entry.status);
    const date = element("span", "changelog-release-date", entry.date);
    itemHeader.append(tag, statusPill, date);

    // Title
    const itemTitle = element("h3", "changelog-item-title", entry.name ? `${entry.name} — ${entry.subtitle}` : entry.subtitle);

    // Feature highlights list
    const featureList = element("ul", "changelog-feature-list");
    (entry.highlights || []).forEach((text) => {
      const li = element("li", "changelog-feature-item");
      const bulletClasses = ["changelog-feature-bullet"];
      if (entry.isCurrent) bulletClasses.push("is-current");
      if (entry.isUpcoming) bulletClasses.push("is-upcoming");
      const bulletIcon = element("span", bulletClasses.join(" "));
      bulletIcon.appendChild(createChangelogSvgIcon(entry.isUpcoming ? "sparkles" : "check"));
      const textSpan = element("span", "changelog-feature-text", text);
      li.append(bulletIcon, textSpan);
      featureList.appendChild(li);
    });

    content.append(itemHeader, itemTitle, featureList);
    item.append(marker, content);
    timeline.appendChild(item);
  });

  return timeline;
}

export function openChangelogModal() {
  if (!changelogModalOverlay) return;

  const isMobile =
    window.innerWidth <= 767 ||
    (typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(max-width: 767px)").matches);
  const currentLang = getLanguage() === "en" ? "en" : "az";
  const dict = TRANSLATIONS[currentLang]?.changelog || TRANSLATIONS.az.changelog;

  closeSidebar();
  changelogModalOverlay.replaceChildren();
  changelogModalOverlay.hidden = false;
  changelogModalOverlay.setAttribute("aria-hidden", "false");
  changelogModalOverlay.classList.remove("is-closing");
  document.body.style.overflow = "hidden";

  if (isMobile) {
    // Mobile Native Bottom Sheet
    changelogModalOverlay.classList.add("is-mobile");
    closeMobileBottomSheet();
    closeMobileModelSheet();
    closeUserProfileMenu();

    const sheet = element("div", "mobile-action-sheet changelog-sheet");
    sheet.setAttribute("role", "dialog");
    sheet.setAttribute("aria-modal", "true");
    sheet.setAttribute("aria-label", dict.title);

    // Drag handle area
    const dragArea = element("div", "mobile-sheet-drag-area");
    dragArea.appendChild(element("div", "mobile-sheet-drag-handle"));

    // Header (includes mobile-sheet-header for touch swipe gestures)
    const header = element("header", "changelog-modal-header changelog-sheet-header mobile-sheet-header");
    const headerLeft = element("div", "changelog-header-left");
    const iconBadge = element("div", "changelog-icon-badge");
    iconBadge.appendChild(createChangelogSvgIcon("sparkles"));

    const titleGroup = element("div", "changelog-title-group");
    const title = element("h2", "changelog-modal-title", dict.title);
    title.id = "changelogModalTitle";
    const subtitle = element("p", "changelog-modal-subtitle", dict.subtitle);
    titleGroup.append(title, subtitle);
    headerLeft.append(iconBadge, titleGroup);

    const closeBtn = button("✕", "changelog-modal-close", closeChangelogModal);
    closeBtn.setAttribute("aria-label", dict.closeAria);
    header.append(headerLeft, closeBtn);

    // Scrollable Body
    const body = element("div", "changelog-modal-body changelog-sheet-body");
    body.appendChild(buildChangelogTimeline());

    // Footer
    const footer = buildChangelogFooter(currentLang, dict);
    footer.classList.add("changelog-sheet-footer");

    sheet.append(dragArea, header, body, footer);
    changelogModalOverlay.appendChild(sheet);

    attachSwipeDownToClose(sheet, closeChangelogModal);

    requestAnimationFrame(() => {
      changelogModalOverlay.classList.add("is-open");
    });
  } else {
    // Desktop Centered Modal
    changelogModalOverlay.classList.remove("is-mobile");

    const card = element("div", "changelog-modal-card");
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-modal", "true");
    card.setAttribute("aria-labelledby", "changelogModalTitle");

    // Header
    const header = element("header", "changelog-modal-header");
    const headerLeft = element("div", "changelog-header-left");
    const iconBadge = element("div", "changelog-icon-badge");
    iconBadge.appendChild(createChangelogSvgIcon("sparkles"));

    const titleGroup = element("div", "changelog-title-group");
    const title = element("h2", "changelog-modal-title", dict.title);
    title.id = "changelogModalTitle";
    const subtitle = element("p", "changelog-modal-subtitle", dict.subtitle);
    titleGroup.append(title, subtitle);
    headerLeft.append(iconBadge, titleGroup);

    const closeBtn = button("✕", "changelog-modal-close", closeChangelogModal);
    closeBtn.setAttribute("aria-label", dict.closeAria);
    header.append(headerLeft, closeBtn);

    // Scrollable Body
    const body = element("div", "changelog-modal-body");
    body.appendChild(buildChangelogTimeline());

    // Footer with Feedback link and close button
    const footer = buildChangelogFooter(currentLang, dict);

    card.append(header, body, footer);
    changelogModalOverlay.appendChild(card);

    requestAnimationFrame(() => {
      changelogModalOverlay.classList.add("is-open");
    });
    closeBtn.focus();
  }
}

export function closeChangelogModal() {
  if (!changelogModalOverlay || changelogModalOverlay.hidden) return;

  const isMobile = changelogModalOverlay.classList.contains("is-mobile");
  changelogModalOverlay.classList.remove("is-open");
  changelogModalOverlay.classList.add("is-closing");

  if (
    (!keyboardShortcutsOverlay || keyboardShortcutsOverlay.hidden) &&
    (!installAppModalOverlay || installAppModalOverlay.hidden) &&
    document.querySelector("#legalModalOverlay[hidden]")
  ) {
    document.body.style.overflow = "";
  }

  let cleanedUp = false;
  const finishClose = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    changelogModalOverlay.hidden = true;
    changelogModalOverlay.setAttribute("aria-hidden", "true");
    changelogModalOverlay.classList.remove("is-closing", "is-mobile");
    changelogModalOverlay.replaceChildren();
  };

  const animTarget = isMobile
    ? changelogModalOverlay.querySelector(".changelog-sheet")
    : changelogModalOverlay.querySelector(".changelog-modal-card");

  if (animTarget) {
    animTarget.addEventListener("transitionend", finishClose, { once: true });
  }
  setTimeout(finishClose, 260);
}

function isPersonalIntelligenceActive() {
  if (state.currentUser && state.currentUser.settings) {
    return state.currentUser.settings.personalIntelligence === true;
  }
  try {
    const saved = localStorage.getItem("helmer_personal_intelligence");
    if (saved !== null) return saved === "true";
  } catch { }
  return false;
}

async function togglePersonalIntelligence(enable) {
  if (state.currentUser) {
    if (!state.currentUser.settings) state.currentUser.settings = {};
    const previous = structuredClone(state.currentUser.settings);
    state.currentUser.settings.personalIntelligence = enable;
    if (!enable) state.currentUser.settings.modelImprovement = false;
    try {
      const data = await authRequest("/api/auth/settings", {
        method: "PATCH",
        body: JSON.stringify({ personalIntelligence: enable }),
      });
      if (data?.user) updateWorkspaceIdentity(data.user);
    } catch (err) {
      state.currentUser.settings = previous;
      showToast(getLanguage() === "en" ? "Settings could not be saved." : "Parametrlər saxlanılmadı.");
    }
  } else {
    try {
      localStorage.setItem("helmer_personal_intelligence", String(enable));
    } catch { }
  }
}

function isModelImprovementActive() {
  if (!isPersonalIntelligenceActive()) return false;
  if (state.currentUser && state.currentUser.settings && typeof state.currentUser.settings.modelImprovement === "boolean") {
    return state.currentUser.settings.modelImprovement;
  }
  try {
    const saved = localStorage.getItem("helmer_model_improvement");
    if (saved !== null) return saved !== "false";
  } catch { }
  return true;
}

async function toggleModelImprovement(enable) {
  const isEn = getLanguage() === "en";
  if (enable && !isPersonalIntelligenceActive()) {
    showToast(isEn ? "Enable personalization first." : "Əvvəl fərdiləşdirməni aktivləşdirin.");
    return;
  }
  try {
    if (state.currentUser) {
      const data = await authRequest("/api/auth/settings", { method: "PATCH", body: JSON.stringify({ modelImprovement: enable }) });
      if (!data?.user) throw new Error("Settings response missing");
      updateWorkspaceIdentity(data.user);
      enable = isModelImprovementActive();
    }
    localStorage.setItem("helmer_model_improvement", String(enable));
    setCookie("helmer_model_improvement", String(enable));
    showToast(enable
      ? (isEn ? "Model improvement enabled." : "Model inkişafına töhfə aktivləşdirildi.")
      : (isEn ? "Model improvement disabled." : "Model inkişafına töhfə söndürüldü."));
  } catch {
    showToast(isEn ? "Settings could not be saved." : "Parametrlər saxlanılmadı.");
  }
}

function attachSwipeDownToClose(sheetEl, onClose) {
  let startY = 0;
  let currentY = 0;
  let isDragging = false;

  const onTouchStart = (e) => {
    if (e.touches.length !== 1) return;
    startY = e.touches[0].clientY;
    currentY = startY;
    isDragging = true;
    sheetEl.style.transition = "none";
  };

  const onTouchMove = (e) => {
    if (!isDragging || e.touches.length !== 1) return;
    currentY = e.touches[0].clientY;
    const deltaY = currentY - startY;
    if (deltaY > 0) {
      sheetEl.style.transform = `translateY(${deltaY}px)`;
    }
  };

  const onTouchEnd = () => {
    if (!isDragging) return;
    isDragging = false;
    sheetEl.style.transition = "";
    const deltaY = currentY - startY;
    if (deltaY > 70) {
      onClose();
    } else {
      sheetEl.style.transform = "";
    }
  };

  const dragArea = sheetEl.querySelector(".mobile-sheet-drag-area");
  const headerArea = sheetEl.querySelector(".mobile-sheet-header");
  dragArea?.addEventListener("touchstart", onTouchStart, { passive: true });
  dragArea?.addEventListener("touchmove", onTouchMove, { passive: true });
  dragArea?.addEventListener("touchend", onTouchEnd, { passive: true });
  headerArea?.addEventListener("touchstart", onTouchStart, { passive: true });
  headerArea?.addEventListener("touchmove", onTouchMove, { passive: true });
  headerArea?.addEventListener("touchend", onTouchEnd, { passive: true });
}

function closeMobileBottomSheet() {
  const overlay = document.querySelector("#mobileBottomSheetOverlay");
  if (!overlay || overlay.hidden || overlay.classList.contains("is-closing")) return;
  overlay.classList.remove("is-open");
  overlay.classList.add("is-closing");
  document.body.style.overflow = "";

  let cleanedUp = false;
  const finishClose = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    overlay.hidden = true;
    overlay.setAttribute("aria-hidden", "true");
    overlay.classList.remove("is-closing");
    overlay.replaceChildren();
  };

  const sheet = overlay.querySelector(".mobile-action-sheet");
  if (sheet) {
    sheet.addEventListener("transitionend", (e) => {
      if (e.target === sheet && e.propertyName === "transform") {
        finishClose();
      }
    }, { once: true });
  }
  setTimeout(finishClose, 250);
}

function openMobileContextSheet(handlers = {}) {
  const overlay = document.querySelector("#mobileBottomSheetOverlay");
  if (!overlay) return;

  const isBuildMode = (handlers.mode || state.mode) === "build";
  const isEn = getLanguage() === "en";

  closeMobileModelSheet();
  overlay.replaceChildren();
  overlay.hidden = false;
  overlay.setAttribute("aria-hidden", "false");
  overlay.classList.remove("is-closing");
  document.body.style.overflow = "hidden";

  const sheet = element("div", "mobile-action-sheet");
  sheet.setAttribute("role", "dialog");
  sheet.setAttribute("aria-modal", "true");
  sheet.setAttribute("aria-label", isBuildMode ? (isEn ? "Add" : "Əlavə et") : t("ask.contextSheet.title"));

  // Drag handle
  const dragArea = element("div", "mobile-sheet-drag-area");
  dragArea.appendChild(element("div", "mobile-sheet-drag-handle"));

  // Header
  const header = element("header", "mobile-sheet-header");
  const title = element("h3", "mobile-sheet-title", isBuildMode ? (isEn ? "Add" : "Əlavə et") : t("ask.contextSheet.title"));
  const closeBtn = button("✕", "mobile-sheet-close-btn", closeMobileBottomSheet);
  closeBtn.type = "button";
  closeBtn.setAttribute("aria-label", t("common.close") || "Bağla");
  header.append(title, closeBtn);

  // Body container
  const body = element("div", "mobile-sheet-body");

  let currentPane = "main";

  const renderBody = () => {
    body.replaceChildren();

    if (currentPane === "main") {
      title.textContent = isBuildMode ? (isEn ? "Add" : "Əlavə et") : t("ask.contextSheet.title");

      // Quick Action Tiles (Only in Ask mode)
      if (!isBuildMode) {
        const tilesGrid = element("div", "mobile-sheet-tiles");

        // Tile 1: Files
        const fileTile = button("", "mobile-sheet-tile tile-files", (e) => {
          e.preventDefault();
          closeMobileBottomSheet();
          if (!state.currentUser) {
            openGuestRestrictionModal(GUEST_RESTRICTION_NOTICES.file);
            return;
          }
          handlers.onFileSelect?.();
        });
        fileTile.type = "button";
        const fileIcon = element("div", "mobile-sheet-tile-icon");
        fileIcon.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>';
        const fileTitle = element("span", "mobile-sheet-tile-title");
        fileTitle.append(element("span", "", t("ask.contextSheet.files")));
        if (!state.currentUser) {
          const lock = element("span", "guest-inline-lock");
          lock.innerHTML = getGuestLockIconSvg(11);
          fileTitle.appendChild(lock);
        }
        const fileDesc = element("span", "mobile-sheet-tile-desc", t("ask.contextSheet.filesDesc"));
        fileTile.append(fileIcon, fileTitle, fileDesc);

        // Tile 2: Photos / Camera
        const photoTile = button("", "mobile-sheet-tile tile-photos", (e) => {
          e.preventDefault();
          closeMobileBottomSheet();
          if (!state.currentUser) {
            openGuestRestrictionModal(GUEST_RESTRICTION_NOTICES.file);
            return;
          }
          handlers.onPhotoSelect?.();
        });
        photoTile.type = "button";
        const photoIcon = element("div", "mobile-sheet-tile-icon");
        photoIcon.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/></svg>';
        const photoTitle = element("span", "mobile-sheet-tile-title");
        photoTitle.append(element("span", "", t("ask.contextSheet.photos")));
        if (!state.currentUser) {
          const lock = element("span", "guest-inline-lock");
          lock.innerHTML = getGuestLockIconSvg(11);
          photoTitle.appendChild(lock);
        }
        const photoDesc = element("span", "mobile-sheet-tile-desc", t("ask.contextSheet.photosDesc"));
        photoTile.append(photoIcon, photoTitle, photoDesc);

        tilesGrid.append(fileTile, photoTile);
        body.appendChild(tilesGrid);
      }

      // Main Context List
      const list = element("div", "mobile-sheet-list");

      if (!isBuildMode) {
        // Row: Strategies
        const stratRow = button("", "mobile-sheet-row", () => {
          if (!state.currentUser) {
            closeMobileBottomSheet();
            openGuestRestrictionModal(GUEST_RESTRICTION_NOTICES.strategy);
            return;
          }
          currentPane = "strategies";
          renderBody();
        });
        stratRow.type = "button";
        const stratLeading = element("div", "mobile-sheet-row-leading");
        const stratIcon = element("div", "mobile-sheet-row-icon");
        stratIcon.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="14" x="2" y="7" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>';
        const stratCopy = element("div", "mobile-sheet-row-copy");
        const stratTitle = element("strong", "");
        stratTitle.append(element("span", "", t("ask.contextSheet.strategies")));
        if (!state.currentUser) {
          const lock = element("span", "guest-inline-lock");
          lock.innerHTML = getGuestLockIconSvg(12);
          stratTitle.appendChild(lock);
        }
        stratCopy.append(
          stratTitle,
          element("small", "", t("ask.contextSheet.strategiesDesc"))
        );
        stratLeading.append(stratIcon, stratCopy);
        stratRow.append(stratLeading, element("span", "mobile-sheet-row-trailing", "›"));

        // Row: Tasks
        const taskRow = button("", "mobile-sheet-row", () => {
          if (!state.currentUser) {
            closeMobileBottomSheet();
            openGuestRestrictionModal(GUEST_RESTRICTION_NOTICES.planner);
            return;
          }
          currentPane = "tasks";
          renderBody();
        });
        taskRow.type = "button";
        const taskLeading = element("div", "mobile-sheet-row-leading");
        const taskIcon = element("div", "mobile-sheet-row-icon");
        taskIcon.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 11 3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>';
        const taskCopy = element("div", "mobile-sheet-row-copy");
        const taskTitle = element("strong", "");
        taskTitle.append(element("span", "", t("ask.contextSheet.tasks")));
        if (!state.currentUser) {
          const lock = element("span", "guest-inline-lock");
          lock.innerHTML = getGuestLockIconSvg(12);
          taskTitle.appendChild(lock);
        }
        taskCopy.append(
          taskTitle,
          element("small", "", t("ask.contextSheet.tasksDesc"))
        );
        taskLeading.append(taskIcon, taskCopy);
        taskRow.append(taskLeading, element("span", "mobile-sheet-row-trailing", "›"));

        // Row: Deep Research
        const researchRow = button("", "mobile-sheet-row", () => {
          closeMobileBottomSheet();
          handlers.onDeepResearch?.();
        });
        researchRow.type = "button";
        const researchLeading = element("div", "mobile-sheet-row-leading");
        const researchIcon = element("div", "mobile-sheet-row-icon");
        researchIcon.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="m4.93 4.93 4.24 4.24"/><path d="m14.83 9.17 4.24-4.24"/><path d="m14.83 14.83 4.24 4.24"/><path d="m9.17 14.83-4.24 4.24"/></svg>';
        const researchCopy = element("div", "mobile-sheet-row-copy");
        researchCopy.append(
          element("strong", "", t("ask.contextSheet.deepResearch")),
          element("small", "", t("ask.contextSheet.deepResearchDesc"))
        );
        researchLeading.append(researchIcon, researchCopy);
        researchRow.append(researchLeading, element("span", "mobile-sheet-row-trailing", "›"));

        list.append(stratRow, taskRow, researchRow);
      }

      // Row: Preset prompts (In both Build and Ask)
      const promptRow = button("", "mobile-sheet-row", () => {
        currentPane = "prompts";
        renderBody();
      });
      promptRow.type = "button";
      const promptLeading = element("div", "mobile-sheet-row-leading");
      const promptIcon = element("div", "mobile-sheet-row-icon");
      promptIcon.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v4"/><path d="M12 18v4"/><path d="M4.93 4.93l2.83 2.83"/><path d="M16.24 16.24l2.83 2.83"/><path d="M2 12h4"/><path d="M18 12h4"/><path d="M4.93 19.07l2.83-2.83"/><path d="M16.24 7.76l2.83-2.83"/></svg>';
      const promptCopy = element("div", "mobile-sheet-row-copy");
      promptCopy.append(
        element("strong", "", t("ask.contextSheet.promptTemplates")),
        element("small", "", isBuildMode ? (isEn ? "Choose a ready-made strategy brief template" : "Başlamaq üçün hazır prompt seç") : t("ask.contextSheet.promptTemplatesDesc"))
      );
      promptLeading.append(promptIcon, promptCopy);
      promptRow.append(promptLeading, element("span", "mobile-sheet-row-trailing", "›"));

      list.append(promptRow);
      body.appendChild(list);

      // If context active: Clear context button (Only in Ask mode)
      if (!isBuildMode && (state.askStrategyId || state.askTaskId)) {
        const clearBtn = button("", "mobile-sheet-clear-btn", () => {
          closeMobileBottomSheet();
          handlers.onClearContext?.();
        });
        clearBtn.type = "button";
        clearBtn.innerHTML = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>';
        clearBtn.appendChild(element("span", "", t("ask.contextSheet.clearContext")));
        body.appendChild(clearBtn);
      }

      // Footer: Personal Intelligence
      const footer = element("div", "mobile-sheet-footer");
      const footerLeading = element("div", "mobile-sheet-footer-leading");
      const footerIcon = element("div", "mobile-sheet-footer-icon");
      footerIcon.innerHTML = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a8 8 0 0 0-8 8c0 3.3 2 6.2 5 7.4V20a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2v-2.6c3-1.2 5-4.1 5-7.4a8 8 0 0 0-8-8z"/></svg>';
      const footerCopy = element("div", "mobile-sheet-footer-copy");
      const footerTitle = element("span", "mobile-sheet-footer-title", t("ask.contextSheet.personalIntelligence"));
      const isActivePi = isPersonalIntelligenceActive();
      const footerStatus = element("span", "mobile-sheet-footer-status", isActivePi ? t("ask.contextSheet.personalIntelligenceOn") : t("ask.contextSheet.personalIntelligenceOff"));
      footerCopy.append(footerTitle, footerStatus);
      footerLeading.append(footerIcon, footerCopy);

      const toggleLabel = element("label", "ask-toggle-switch");
      const toggleInput = document.createElement("input");
      toggleInput.type = "checkbox";
      toggleInput.checked = isActivePi;
      toggleInput.setAttribute("aria-label", t("ask.contextSheet.personalIntelligence"));
      const toggleSlider = element("span", "ask-toggle-slider");
      toggleLabel.append(toggleInput, toggleSlider);

      toggleInput.addEventListener("change", async (e) => {
        e.stopPropagation();
        const nextVal = toggleInput.checked;
        if (nextVal) {
          openPersonalizationConsentModal(async () => {
            await togglePersonalIntelligence(true);
            toggleInput.checked = true;
            footerStatus.textContent = t("ask.contextSheet.personalIntelligenceOn");
          });
        } else {
          await togglePersonalIntelligence(false);
          footerStatus.textContent = t("ask.contextSheet.personalIntelligenceOff");
        }
      });

      footer.append(footerLeading, toggleLabel);
      body.appendChild(footer);
      return;
    }

    if (currentPane === "strategies") {
      const nav = element("div", "mobile-sheet-sub-nav");
      const backBtn = button(`‹ ${t("ask.contextSheet.back")}`, "mobile-sheet-back-btn", () => {
        currentPane = "main";
        renderBody();
      });
      backBtn.type = "button";
      nav.append(backBtn, element("span", "mobile-sheet-sub-title", t("ask.contextSheet.strategies")));
      body.appendChild(nav);

      const list = element("div", "mobile-sheet-sub-list");
      if (!state.savedStrategies.length) {
        list.appendChild(element("div", "mobile-sheet-empty", t("ask.contextSheet.emptyStrategies")));
      } else {
        state.savedStrategies.forEach((strat) => {
          const isSelected = strat.id === state.askStrategyId;
          const item = button("", `mobile-sheet-sub-item${isSelected ? " is-selected" : ""}`, () => {
            closeMobileBottomSheet();
            handlers.onSelectStrategy?.(strat.id);
          });
          item.type = "button";
          item.setAttribute("aria-selected", isSelected ? "true" : "false");
          item.append(
            element("strong", "mobile-sheet-sub-item-title", strat.title),
            element("small", "mobile-sheet-sub-item-meta", isSelected ? (getLanguage() === "en" ? "Selected" : "Seçilib") : formatDate(strat.updatedAt))
          );
          list.appendChild(item);
        });
      }
      body.appendChild(list);
      return;
    }

    if (currentPane === "tasks") {
      const nav = element("div", "mobile-sheet-sub-nav");
      const backBtn = button(`‹ ${t("ask.contextSheet.back")}`, "mobile-sheet-back-btn", () => {
        currentPane = "main";
        renderBody();
      });
      backBtn.type = "button";
      nav.append(backBtn, element("span", "mobile-sheet-sub-title", t("ask.contextSheet.tasks")));
      body.appendChild(nav);

      const activeTasks = state.plannerTasks.filter((t) => !t.completed);
      const list = element("div", "mobile-sheet-sub-list");
      if (!activeTasks.length) {
        list.appendChild(element("div", "mobile-sheet-empty", t("ask.contextSheet.emptyTasks")));
      } else {
        activeTasks.forEach((task) => {
          const isSelected = task.id === state.askTaskId;
          const item = button("", `mobile-sheet-sub-item${isSelected ? " is-selected" : ""}`, () => {
            closeMobileBottomSheet();
            handlers.onSelectTask?.(task.id);
          });
          item.type = "button";
          item.setAttribute("aria-selected", isSelected ? "true" : "false");
          item.append(
            element("strong", "mobile-sheet-sub-item-title", task.text),
            element("small", "mobile-sheet-sub-item-meta", isSelected ? (getLanguage() === "en" ? "Selected" : "Seçilib") : (task.groupLabel || (getLanguage() === "en" ? "General" : "Ümumi")))
          );
          list.appendChild(item);
        });
      }
      body.appendChild(list);
      return;
    }

    if (currentPane === "prompts") {
      const nav = element("div", "mobile-sheet-sub-nav");
      const backBtn = button(`‹ ${t("ask.contextSheet.back")}`, "mobile-sheet-back-btn", () => {
        currentPane = "main";
        renderBody();
      });
      backBtn.type = "button";
      nav.append(backBtn, element("span", "mobile-sheet-sub-title", t("ask.contextSheet.promptTemplates")));
      body.appendChild(nav);

      const presets = getPresetPrompts(isBuildMode ? "build" : "ask");
      const list = element("div", "mobile-sheet-sub-list");
      presets.forEach((prompt) => {
        const item = button("", "mobile-sheet-sub-item", () => {
          closeMobileBottomSheet();
          handlers.onSelectPrompt?.(prompt.text);
        });
        item.type = "button";
        item.append(
          element("strong", "mobile-sheet-sub-item-title", prompt.title),
          element("small", "mobile-sheet-sub-item-meta", prompt.text)
        );
        list.appendChild(item);
      });
      body.appendChild(list);
    }
  };

  renderBody();
  sheet.append(dragArea, header, body);
  overlay.appendChild(sheet);
  attachSwipeDownToClose(sheet, closeMobileBottomSheet);

  requestAnimationFrame(() => {
    overlay.classList.add("is-open");
  });
}

function closeMobileModelSheet() {
  const overlay = document.querySelector("#mobileModelSheetOverlay");
  if (!overlay || overlay.hidden || overlay.classList.contains("is-closing")) return;
  overlay.classList.remove("is-open");
  overlay.classList.add("is-closing");
  document.body.style.overflow = "";

  let cleanedUp = false;
  const finishClose = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    overlay.hidden = true;
    overlay.setAttribute("aria-hidden", "true");
    overlay.classList.remove("is-closing");
    overlay.replaceChildren();
  };

  buildModeButton?.classList.remove("is-open");
  buildModeButton?.setAttribute("aria-expanded", "false");
  const askBtn = document.querySelector("#askModeButton");
  if (askBtn) {
    askBtn.classList.remove("is-open");
    askBtn.setAttribute("aria-expanded", "false");
  }
  const chatModelBtn = document.querySelector("#mobileChatModelButton");
  if (chatModelBtn) {
    chatModelBtn.classList.remove("is-open");
    chatModelBtn.setAttribute("aria-expanded", "false");
  }

  const sheet = overlay.querySelector(".mobile-model-sheet");
  if (sheet) {
    sheet.addEventListener("transitionend", (e) => {
      if (e.target === sheet && e.propertyName === "transform") {
        finishClose();
      }
    }, { once: true });
  }
  setTimeout(finishClose, 250);
}

let currentAskThinking = "low";

function createAskThinkingControls(isEn, onToggle = null) {
  const card = element("div", `ask-thinking-card${state.askThinkingEnabled ? " is-active" : ""}`);

  const mainRow = element("div", "ask-thinking-main-row");

  const info = element("div", "ask-thinking-info");
  const title = element("strong", "ask-thinking-title");
  title.append(element("span", "", isEn ? "Thinking" : "Düşünmə"));
  if (!state.currentUser) {
    const lock = element("span", "guest-inline-lock");
    lock.innerHTML = getGuestLockIconSvg(12);
    title.appendChild(lock);
  }
  const desc = element("small", "ask-thinking-desc", isEn ? "Smart analysis" : "Ağıllı analiz");
  info.append(title, desc);

  // iOS-style Toggle Switch
  const toggleLabel = element("label", "ask-ios-toggle");
  const toggleInput = document.createElement("input");
  toggleInput.type = "checkbox";
  toggleInput.checked = Boolean(state.askThinkingEnabled);
  toggleInput.setAttribute("aria-label", isEn ? "Enable thinking" : "Düşünməni aktiv et");
  const toggleTrack = element("span", "ask-ios-toggle-track");
  toggleLabel.append(toggleInput, toggleTrack);

  mainRow.append(info, toggleLabel);

  // Smooth collapsible pills container
  const pillsContainer = element("div", `ask-thinking-pills${state.askThinkingEnabled ? " is-open" : ""}`);
  pillsContainer.setAttribute("role", "radiogroup");
  pillsContainer.setAttribute("aria-label", isEn ? "Thinking level" : "Düşünmə səviyyəsi");

  const pillGroup = element("div", "ask-thinking-pill-group");
  const pillButtons = new Map();

  const setLevel = (level) => {
    if (!state.currentUser) {
      openGuestRestrictionModal(GUEST_RESTRICTION_NOTICES.thinking);
      return;
    }
    state.askThinkingLevel = level;
    currentAskThinking = level;
    try { localStorage.setItem("helmer_ask_thinking_level", level); } catch { }
    for (const [lvl, btn] of pillButtons.entries()) {
      const active = lvl === level;
      btn.classList.toggle("is-active", active);
      btn.setAttribute("aria-checked", String(active));
    }
    if (typeof onToggle === "function") {
      onToggle(Boolean(state.askThinkingEnabled));
    }
  };

  ["low", "medium", "high"].forEach((lvl) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `ask-thinking-pill-btn${state.askThinkingLevel === lvl ? " is-active" : ""}`;
    btn.setAttribute("role", "radio");
    btn.setAttribute("aria-checked", String(state.askThinkingLevel === lvl));
    btn.textContent = { low: "Low", medium: "Medium", high: "High" }[lvl];

    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!state.currentUser) {
        openGuestRestrictionModal(GUEST_RESTRICTION_NOTICES.thinking);
        return;
      }
      setLevel(lvl);
    });

    pillButtons.set(lvl, btn);
    pillGroup.appendChild(btn);
  });

  pillsContainer.appendChild(pillGroup);

  toggleInput.addEventListener("change", (e) => {
    e.stopPropagation();
    if (!state.currentUser) {
      toggleInput.checked = false;
      openGuestRestrictionModal(GUEST_RESTRICTION_NOTICES.thinking);
      return;
    }
    const isChecked = toggleInput.checked;
    state.askThinkingEnabled = isChecked;
    try { localStorage.setItem("helmer_ask_thinking_enabled", String(isChecked)); } catch { }

    if (isChecked) {
      if (!state.askThinkingLevel || state.askThinkingLevel === "off") {
        setLevel("medium");
      } else {
        setLevel(state.askThinkingLevel);
      }
      card.classList.add("is-active");
      pillsContainer.classList.add("is-open");
    } else {
      currentAskThinking = "low";
      card.classList.remove("is-active");
      pillsContainer.classList.remove("is-open");
    }
    if (typeof onToggle === "function") {
      onToggle(isChecked);
    }
  });

  card.append(mainRow, pillsContainer);
  return card;
}

function createAskModelSelector(isEn) {
  const menu = document.createElement("details");
  menu.className = "ask-model-selector-menu";

  const trigger = document.createElement("summary");
  trigger.className = "ask-model-selector-trigger";
  trigger.setAttribute("aria-label", isEn ? "Model and thinking selection" : "Model və düşünmə seçimi");
  trigger.setAttribute("role", "button");

  const getSelectorLabel = () => {
    if (!state.askThinkingEnabled) return "Auto";
    if (state.askThinkingLevel === "low") return "Thinking · Low";
    return state.askThinkingLevel === "high" ? "Thinking · High" : "Thinking · Med";
  };
  const nameSpan = element("span", "ask-model-name", getSelectorLabel());
  const chevron = element("span", "ask-model-chevron-icon");
  chevron.innerHTML = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>';
  trigger.append(nameSpan, chevron);

  trigger.addEventListener("click", (event) => {
    if (window.innerWidth <= 767) {
      event.preventDefault();
      event.stopPropagation();
      openMobileModelSheet();
    }
  });

  const popover = element("div", "ask-model-selector-popover");

  const isAutoDefault = !state.askThinkingEnabled;

  // Auto Option
  const autoOption = button("", `ask-model-option${isAutoDefault ? " is-active" : ""}`, (e) => {
    e.preventDefault();
    state.askModel = "auto";
    try { localStorage.setItem("helmer_ask_model", "auto"); } catch { }
    state.askThinkingEnabled = false;
    currentAskThinking = "low";
    try { localStorage.setItem("helmer_ask_thinking_enabled", "false"); } catch { }
    menu.removeAttribute("open");
    render();
  });
  autoOption.type = "button";
  const autoLeading = element("div", "ask-model-option-leading");
  const autoBadge = element("div", "ask-model-option-badge");
  autoBadge.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z"/></svg>';
  const autoInfo = element("div", "ask-model-option-info");
  autoInfo.append(
    element("strong", "", "Auto"),
    element("small", "", isEn ? "Automatic smart mode" : "Avtomatik rejim")
  );
  autoLeading.append(autoBadge, autoInfo);
  autoOption.append(autoLeading);
  if (isAutoDefault) {
    const check = element("span", "ask-model-check");
    check.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
    autoOption.append(check);
  }

  const divider = element("div", "ask-model-popover-divider");
  const thinkingControls = createAskThinkingControls(isEn, (enabled) => {
    nameSpan.textContent = getSelectorLabel();
    autoOption.classList.toggle("is-active", !enabled);
    const existingCheck = autoOption.querySelector(".ask-model-check");
    if (!enabled && !existingCheck) {
      const check = element("span", "ask-model-check");
      check.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
      autoOption.append(check);
    } else if (enabled && existingCheck) {
      existingCheck.remove();
    }
  });

  popover.append(autoOption, divider, thinkingControls);
  menu.append(trigger, popover);

  const onDocClick = (e) => {
    if (menu.hasAttribute("open") && !menu.contains(e.target)) {
      menu.removeAttribute("open");
    }
  };
  document.addEventListener("pointerdown", onDocClick);

  return menu;
}

// Build model selector: Auto (Flash -> Argon) and Faster (Flash Direct with Medium/High Thinking).
function createBuildModelSelector(isEn, { onSelect = null } = {}) {
  const isFaster = state.buildModel === "faster";
  const currentFasterThinking = state.buildFasterThinkingLevel === "high" ? "high" : "medium";
  const getTriggerLabel = () => {
    if (state.buildModel === "faster") {
      return state.buildFasterThinkingLevel === "high" ? "Faster · High" : "Faster · Med";
    }
    return "Auto";
  };

  const menu = element("details", "ask-model-selector-menu build-model-selector-menu");
  const trigger = element("summary", "ask-model-selector-trigger");
  trigger.setAttribute("aria-label", isEn ? "Build model selection" : "Build model seçimi");
  trigger.setAttribute("role", "button");
  const nameSpan = element("span", "ask-model-name", getTriggerLabel());
  const chevron = element("span", "ask-model-chevron-icon");
  chevron.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>';
  trigger.append(nameSpan, chevron);
  const popover = element("div", "ask-model-selector-popover");

  const makeOption = (name, description, iconPath, active, chipText = "", trailingEl = null) => {
    const option = element("button", `ask-model-option${active ? " is-active" : ""}`);
    option.type = "button";
    option.setAttribute("aria-pressed", String(Boolean(active)));
    const leading = element("div", "ask-model-option-leading");
    const badge = element("div", "ask-model-option-badge");
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    for (const [key, value] of Object.entries({ viewBox: "0 0 24 24", width: "16", height: "16", fill: "none", stroke: "currentColor", "stroke-width": "2", "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true" })) svg.setAttribute(key, value);
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", iconPath);
    svg.append(path);
    badge.append(svg);
    const info = element("div", "ask-model-option-info");
    const titleRow = element("div", "ask-model-title-row");
    titleRow.append(element("strong", "", name));
    if (chipText) {
      titleRow.append(element("span", "ask-model-chip", chipText));
    }
    info.append(titleRow, element("small", "", description));
    leading.append(badge, info);
    option.append(leading);

    const trailing = element("div", "ask-model-option-trailing");
    if (trailingEl) {
      trailing.append(trailingEl);
    }
    if (active) {
      const check = element("span", "ask-model-check");
      check.textContent = "✓";
      trailing.append(check);
    }
    option.append(trailing);
    return option;
  };

  const syncSelectionUi = () => {
    const isFaster = state.buildModel === "faster";
    const thinkingLvl = state.buildFasterThinkingLevel === "high" ? "high" : "medium";
    const isFasterMed = isFaster && thinkingLvl === "medium";
    const isFasterHigh = isFaster && thinkingLvl === "high";
    const isAuto = !isFaster;

    nameSpan.textContent = getTriggerLabel();

    const updateRow = (row, active) => {
      row.classList.toggle("is-active", active);
      row.setAttribute("aria-pressed", String(active));
      const check = row.querySelector(".ask-model-check, .mobile-model-card-check");
      if (active && !check) {
        const c = element("span", "ask-model-check");
        c.textContent = "✓";
        const trailing = row.querySelector(".ask-model-option-trailing") || row;
        trailing.append(c);
      } else if (!active && check) {
        check.remove();
      }
    };

    updateRow(auto, isAuto);
    updateRow(fasterMed, isFasterMed);
    updateRow(fasterHigh, isFasterHigh);

    thinkingSection.hidden = !isFaster;
    for (const [lvl, btn] of pillButtons.entries()) {
      const pillActive = isFaster && lvl === thinkingLvl;
      btn.classList.toggle("is-active", pillActive);
      btn.setAttribute("aria-checked", String(pillActive));
    }
  };

  const triggerEstimateRefresh = () => {
    state.buildEstimateBrief = "";
    state.buildPreparationEstimate = null;
    if (typeof scheduleBuildEstimate === "function") scheduleBuildEstimate();
  };

  const auto = makeOption("Auto", isEn ? "Smarter routing" : "Daha ağıllı yönləndirmə", "m12 3-3 6-6 3 6 3 3 6 3-6 6-3-6-3Z", !isFaster);
  auto.addEventListener("click", () => {
    state.buildModel = "auto";
    try { localStorage.setItem("helmer_build_model", "auto"); } catch {}
    syncSelectionUi();
    triggerEstimateRefresh();
    menu.open = false;
    if (typeof onSelect === "function") onSelect("auto");
  });

  const selectFasterLevel = (lvl) => {
    state.buildModel = "faster";
    state.buildFasterThinkingLevel = lvl;
    try {
      localStorage.setItem("helmer_build_model", "faster");
      localStorage.setItem("helmer_build_faster_thinking", lvl);
    } catch {}
    syncSelectionUi();
    triggerEstimateRefresh();
    menu.open = false;
    if (typeof onSelect === "function") onSelect("faster", lvl);
  };

  const isFasterMedActive = isFaster && currentFasterThinking === "medium";
  const isFasterHighActive = isFaster && currentFasterThinking === "high";

  const fasterMed = makeOption(
    isEn ? "Faster · Medium" : "Faster · Medium",
    isEn ? "Your essential assistant for daily workflow" : "Gündəlik iş axını zamanı əsas köməkçiniz",
    "m13 2-9 12h7l-1 8 10-12h-7Z",
    isFasterMedActive,
    isEn ? "~3x faster" : "~3x daha sürətli"
  );
  fasterMed.disabled = false;
  fasterMed.addEventListener("click", () => selectFasterLevel("medium"));

  const fasterHigh = makeOption(
    isEn ? "Faster · High" : "Faster · High",
    isEn ? "Faster generation with deeper analytical thinking" : "Daha dərin analitik düşüncə ilə sürətli nəticə",
    "m13 2-9 12h7l-1 8 10-12h-7Z",
    isFasterHighActive,
    isEn ? "Deep analysis" : "Dərin analiz"
  );
  fasterHigh.disabled = false;
  fasterHigh.addEventListener("click", () => selectFasterLevel("high"));

  // Hidden backward-compatibility node for legacy selectors/tests
  const thinkingSection = element("div", "ask-thinking-card build-faster-thinking-card");
  thinkingSection.hidden = !isFaster;
  thinkingSection.style.display = "none";

  const pillButtons = new Map();
  ["medium", "high"].forEach((lvl) => {
    const btn = element("button", `ask-thinking-pill-btn${currentFasterThinking === lvl ? " is-active" : ""}`, lvl === "high" ? "High" : "Medium");
    btn.type = "button";
    btn.setAttribute("role", "radio");
    btn.setAttribute("aria-checked", String(currentFasterThinking === lvl));
    btn.dataset.thinkingLevel = lvl;
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      selectFasterLevel(lvl);
    });
    pillButtons.set(lvl, btn);
    thinkingSection.appendChild(btn);
  });

  popover.append(
    auto,
    element("div", "ask-model-popover-divider"),
    fasterMed,
    fasterHigh,
    thinkingSection
  );
  menu.append(trigger, popover);
  trigger.addEventListener("click", (event) => {
    if (window.innerWidth <= 767) {
      event.preventDefault();
      openMobileModelSheet("build");
    }
  });
  // Scope dismissal listeners to this component's lifetime.
  menu.addEventListener("toggle", () => {
    if (!menu.open) return;
    const controller = new AbortController();
    const close = () => { menu.open = false; controller.abort(); };
    document.addEventListener("pointerdown", (event) => {
      if (!menu.isConnected || !menu.contains(event.target)) close();
    }, { signal: controller.signal });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") { close(); trigger.focus(); }
    }, { signal: controller.signal });
    menu.addEventListener("toggle", () => { controller.abort(); }, { once: true, signal: controller.signal });
  });
  return menu;
}

function openMobileModelSheet(mode = "ask") {
  const overlay = document.querySelector("#mobileModelSheetOverlay");
  if (!overlay) return;
  const isEn = getLanguage() === "en";

  closeMobileBottomSheet();
  overlay.replaceChildren();
  overlay.hidden = false;
  overlay.setAttribute("aria-hidden", "false");
  overlay.classList.remove("is-closing");
  document.body.style.overflow = "hidden";

  const askBtn = document.querySelector(mode === "build" ? "#buildModeButton" : "#askModeButton");
  if (askBtn) {
    askBtn.classList.add("is-open");
    askBtn.setAttribute("aria-expanded", "true");
  }
  const chatModelBtn = document.querySelector("#mobileChatModelButton");
  if (chatModelBtn) {
    chatModelBtn.classList.add("is-open");
    chatModelBtn.setAttribute("aria-expanded", "true");
  }

  const sheet = element("div", "mobile-model-sheet");
  sheet.setAttribute("role", "dialog");
  sheet.setAttribute("aria-modal", "true");
  sheet.setAttribute("aria-label", t("ask.modelSheet.title"));

  // Drag handle
  const dragArea = element("div", "mobile-sheet-drag-area");
  dragArea.appendChild(element("div", "mobile-sheet-drag-handle"));

  // Header
  const header = element("header", "mobile-sheet-header");
  const title = element("h3", "mobile-sheet-title", t("ask.modelSheet.title"));
  const closeBtn = button("✕", "mobile-sheet-close-btn", closeMobileModelSheet);
  closeBtn.type = "button";
  closeBtn.setAttribute("aria-label", t("common.close") || "Bağla");
  header.append(title, closeBtn);

  // Body
  const body = element("div", "mobile-sheet-body");
  const options = element("div", "mobile-model-options");

  if (mode === "build") {
    const selector = createBuildModelSelector(isEn, {
      onSelect: () => {
        closeMobileModelSheet();
        render();
      },
    });
    for (const option of selector.querySelectorAll(".ask-model-option")) {
      option.classList.replace("ask-model-option", "mobile-model-option-card");
      option.querySelector(".ask-model-option-leading")?.classList.replace("ask-model-option-leading", "mobile-model-card-leading");
      option.querySelector(".ask-model-option-badge")?.classList.replace("ask-model-option-badge", "mobile-model-card-icon");
      option.querySelector(".ask-model-option-info")?.classList.replace("ask-model-option-info", "mobile-model-card-copy");
      option.querySelector(".ask-model-check")?.classList.replace("ask-model-check", "mobile-model-card-check");
      options.append(option);
    }
    const thinkingCard = selector.querySelector(".build-faster-thinking-card");
    if (thinkingCard) {
      options.append(thinkingCard);
    }
    body.append(options);
    sheet.append(dragArea, header, body);
    overlay.append(sheet);
    attachSwipeDownToClose(sheet, closeMobileModelSheet);
    requestAnimationFrame(() => overlay.classList.add("is-open"));
    return;
  }

  const isAutoDefault = !state.askThinkingEnabled;

  // Auto Card
  const autoCard = button("", `mobile-model-option-card${isAutoDefault ? " is-active" : ""}`, () => {
    state.askModel = "auto";
    try { localStorage.setItem("helmer_ask_model", "auto"); } catch { }
    state.askThinkingEnabled = false;
    currentAskThinking = "low";
    try { localStorage.setItem("helmer_ask_thinking_enabled", "false"); } catch { }
    closeMobileModelSheet();
    syncMode();
    if (state.mode === "ask") render();
  });
  autoCard.type = "button";
  const autoLeading = element("div", "mobile-model-card-leading");
  const autoIcon = element("div", "mobile-model-card-icon");
  autoIcon.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M12 2L14.4 8.6L21 11L14.4 13.4L12 20L9.6 13.4L3 11L9.6 8.6L12 2Z"/></svg>';
  const autoCopy = element("div", "mobile-model-card-copy");
  autoCopy.append(
    element("strong", "", t("ask.modelSheet.autoTitle")),
    element("small", "", t("ask.modelSheet.autoDesc"))
  );
  autoLeading.append(autoIcon, autoCopy);
  autoCard.append(autoLeading);
  if (isAutoDefault) {
    const check = element("span", "mobile-model-card-check");
    check.setAttribute("aria-hidden", "true");
    check.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
    autoCard.appendChild(check);
  }

  options.append(autoCard);

  const divider = element("div", "ask-model-popover-divider");
  const thinkingControls = createAskThinkingControls(isEn, (enabled) => {
    autoCard.classList.toggle("is-active", !enabled);
    const existingCheck = autoCard.querySelector(".mobile-model-card-check");
    if (!enabled && !existingCheck) {
      const check = element("span", "mobile-model-card-check");
      check.setAttribute("aria-hidden", "true");
      check.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
      autoCard.appendChild(check);
    } else if (enabled && existingCheck) {
      existingCheck.remove();
    }
  });
  options.append(divider, thinkingControls);

  body.appendChild(options);
  sheet.append(dragArea, header, body);
  overlay.appendChild(sheet);
  attachSwipeDownToClose(sheet, closeMobileModelSheet);

  requestAnimationFrame(() => {
    overlay.classList.add("is-open");
  });
}

let activeProfileDocClickCleanup = null;

function closeUserProfileMenu() {
  if (activeProfileDocClickCleanup) {
    activeProfileDocClickCleanup();
    activeProfileDocClickCleanup = null;
  }

  const popover = document.querySelector("#profilePopoverMenu");
  if (popover && !popover.hidden) {
    popover.classList.remove("is-open");
    popover.hidden = true;
    popover.setAttribute("aria-hidden", "true");
    popover.dataset.triggerId = "";
    popover.replaceChildren();
  }

  const overlay = document.querySelector("#mobileProfileSheetOverlay");
  if (overlay && !overlay.hidden && !overlay.classList.contains("is-closing")) {
    overlay.classList.remove("is-open");
    overlay.classList.add("is-closing");
    document.body.style.overflow = "";

    let cleanedUp = false;
    const finishClose = () => {
      if (cleanedUp) return;
      cleanedUp = true;
      overlay.hidden = true;
      overlay.setAttribute("aria-hidden", "true");
      overlay.classList.remove("is-closing");
      overlay.replaceChildren();
    };

    const sheet = overlay.querySelector(".mobile-profile-sheet, .mobile-action-sheet");
    if (sheet) {
      sheet.addEventListener("transitionend", (e) => {
        if (e.target === sheet && e.propertyName === "transform") {
          finishClose();
        }
      }, { once: true });
    }
    setTimeout(finishClose, 250);
  }
}

function buildProfileMenuItems() {
  const isEn = getLanguage() === "en";
  const user = state.currentUser;

  // 1. Header: Avatar, Name, Plan status, and Right Arrow (">")
  const headerBtn = element("div", "profile-menu-header");
  headerBtn.setAttribute("role", "button");
  headerBtn.setAttribute("tabindex", "0");
  headerBtn.setAttribute("aria-label", t("profileMenu.profile") || (isEn ? "Profile" : "Profil"));

  const avatarEl = element("div", "workspace-avatar profile-menu-avatar");
  const avatarText = user
    ? (user.fullName || user.username || "U")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toLocaleUpperCase("az"))
      .join("") || "H"
    : "H";
  avatarEl.textContent = avatarText;

  const infoWrap = element("div", "profile-menu-info");
  const nameEl = element(
    "strong",
    "profile-menu-name",
    user ? (user.fullName || user.username) : (t("profileMenu.guestUser") || (isEn ? "Guest User" : "Qonaq İstifadəçi"))
  );
  infoWrap.append(nameEl);

  if (user?.email) {
    const emailEl = element("span", "profile-menu-email", user.email);
    infoWrap.append(emailEl);
  }

  const headerChevron = element("span", "profile-menu-chevron");
  headerChevron.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>`;

  const onHeaderNavigate = () => {
    if (state.view !== "settings") {
      state.previousView = state.view;
    }
    state.view = "settings";
    state.settingsTab = "account";
    syncNav();
    render();
    closeSidebar();
    closeUserProfileMenu();
  };
  headerBtn.addEventListener("click", onHeaderNavigate);
  headerBtn.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onHeaderNavigate();
    }
  });
  headerBtn.append(avatarEl, infoWrap, headerChevron);

  // Helper for menu items (safe DOM, XSS protection per Rule 4)
  const createItem = ({ iconSvg, label, onClick, hasChevron = false, isDanger = false, extraClass = "" }) => {
    const itemBtn = button("", `profile-menu-item${isDanger ? " is-danger" : ""}${extraClass ? " " + extraClass : ""}`, (e) => {
      e.stopPropagation();
      closeUserProfileMenu();
      onClick();
    });
    itemBtn.setAttribute("role", "menuitem");

    const left = element("div", "profile-menu-item-left");
    const iconWrap = element("span", "profile-menu-item-icon");
    iconWrap.innerHTML = iconSvg;
    const labelWrap = element("span", "profile-menu-item-label", label);
    left.append(iconWrap, labelWrap);
    itemBtn.appendChild(left);

    if (hasChevron) {
      const chev = element("span", "profile-menu-item-chevron");
      chev.innerHTML = `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>`;
      itemBtn.appendChild(chev);
    }
    return itemBtn;
  };

  // Divider 1
  const divider1 = element("div", "profile-menu-divider");
  divider1.setAttribute("role", "separator");

  // Guest Limits Section (Minimalist daily limits for unregistered guests)
  let limitsSection = null;
  let dividerLimits = null;
  if (!user) {
    limitsSection = element("div", "profile-menu-limits");

    const limitsHeader = element("div", "profile-menu-limits-header");
    const limitsTitle = element("span", "profile-menu-limits-title", isEn ? "Limits" : "Limitlər");
    limitsHeader.appendChild(limitsTitle);

    const askRemaining = Number.isInteger(state.remainingGuestMessages) ? Math.max(0, state.remainingGuestMessages) : 5;
    const buildRemaining = Number.isInteger(state.remainingGuestBriefs) ? Math.max(0, state.remainingGuestBriefs) : 3;

    const askRow = element("div", "profile-menu-limit-row");
    const askLabel = element("span", "profile-menu-limit-name", isEn ? "Ask mode" : "Ask rejimi");
    const askVal = element("span", "profile-menu-limit-val", `${askRemaining} / 5 ${isEn ? "messages" : "mesaj"}`);
    askRow.append(askLabel, askVal);

    const buildRow = element("div", "profile-menu-limit-row");
    const buildLabel = element("span", "profile-menu-limit-name", isEn ? "Build mode" : "Build rejimi");
    const buildVal = element("span", "profile-menu-limit-val", `${buildRemaining} / 3 ${isEn ? "briefs" : "brif"}`);
    buildRow.append(buildLabel, buildVal);

    limitsSection.append(limitsHeader, askRow, buildRow);

    dividerLimits = element("div", "profile-menu-divider");
    dividerLimits.setAttribute("role", "separator");
  }

  // Section 1: Settings sections (Profile, Personalization, Security, Legal)
  const section1 = element("div", "profile-menu-section profile-menu-section-1");

  const profileItem = createItem({
    iconSvg: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`,
    label: t("profileMenu.profile") || (isEn ? "Profile" : "Profil"),
    onClick: () => {
      if (state.view !== "settings") {
        state.previousView = state.view;
      }
      state.view = "settings";
      state.settingsTab = "account";
      syncNav();
      render();
      closeSidebar();
    },
  });

  const personalizationItem = createItem({
    iconSvg: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3L12 3z"/></svg>`,
    label: t("profileMenu.personalization") || (isEn ? "Personalization" : "Fərdiləşdirmə"),
    onClick: () => {
      if (state.view !== "settings") {
        state.previousView = state.view;
      }
      state.view = "settings";
      state.settingsTab = "experience";
      syncNav();
      render();
      closeSidebar();
    },
  });

  const securityItem = createItem({
    iconSvg: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`,
    label: t("profileMenu.security") || (isEn ? "Security" : "Təhlükəsizlik"),
    onClick: () => {
      if (state.view !== "settings") {
        state.previousView = state.view;
      }
      state.view = "settings";
      state.settingsTab = "security";
      syncNav();
      render();
      closeSidebar();
    },
  });

  const legalItem = createItem({
    iconSvg: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>`,
    label: t("profileMenu.legal") || (isEn ? "Legal" : "Hüquqi"),
    onClick: () => {
      if (state.view !== "settings") {
        state.previousView = state.view;
      }
      state.view = "settings";
      state.settingsTab = "legal";
      syncNav();
      render();
      closeSidebar();
    },
  });

  section1.append(profileItem, personalizationItem, securityItem, legalItem);

  const isAdminUser = ["boss", "admin", "lalajesur"].includes(state.currentUser?.username?.toLowerCase()) ||
    ["elemanajes@gmail.com", "lalajesur@gmail.com"].includes(state.currentUser?.email?.toLowerCase());
  if (isAdminUser) {
    const adminItem = createItem({
      iconSvg: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></svg>`,
      label: isEn ? "Admin & Telemetry" : "Admin & Telemetriya",
      hasChevron: true,
      onClick: () => {
        window.location.href = "/admin";
      },
    });
    section1.appendChild(adminItem);
  }

  // Divider 2
  const divider2 = element("div", "profile-menu-divider");
  divider2.setAttribute("role", "separator");

  // Section 2: Help (">"), Log out (">")
  const section2 = element("div", "profile-menu-section profile-menu-section-2");
  const helpItem = createItem({
    iconSvg: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
    label: t("profileMenu.help") || (isEn ? "Help" : "Kömək"),
    hasChevron: true,
    onClick: () => {
      openShortcutModal();
      closeSidebar();
    },
  });

  const logoutItem = createItem({
    iconSvg: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>`,
    label: t("profileMenu.logout") || (isEn ? "Log out" : "Çıxış"),
    hasChevron: true,
    isDanger: true,
    onClick: () => {
      logout();
      closeSidebar();
    },
  });
  section2.append(helpItem, logoutItem);

  const items = [headerBtn, divider1];
  if (limitsSection && dividerLimits) {
    items.push(limitsSection, dividerLimits);
  }
  items.push(section1, divider2, section2);
  return items;
}

function openUserProfileMenu(triggerEl) {
  if (!state.currentUser && !Number.isInteger(state.remainingGuestMessages) && !window._fetchingGuestQuota) {
    window._fetchingGuestQuota = true;
    const quotaVersion = state.guestQuotaVersion;
    fetch("/api/auth/guest-status")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (quotaVersion !== state.guestQuotaVersion || state.currentUser) return;
        if (!data || !Number.isInteger(data.remaining)) return;
        state.remainingGuestMessages = data.remaining;
        if (Number.isInteger(data.buildRemaining)) {
          state.remainingGuestBriefs = data.buildRemaining;
        }
        const askValEl = document.querySelector(".profile-menu-limits .profile-menu-limit-row:first-of-type .profile-menu-limit-val");
        const buildValEl = document.querySelector(".profile-menu-limits .profile-menu-limit-row:last-of-type .profile-menu-limit-val");
        const isEn = getLanguage() === "en";
        if (askValEl) askValEl.textContent = `${state.remainingGuestMessages} / 5 ${isEn ? "messages" : "mesaj"}`;
        if (buildValEl && Number.isInteger(state.remainingGuestBriefs)) {
          buildValEl.textContent = `${state.remainingGuestBriefs} / 3 ${isEn ? "briefs" : "brif"}`;
        }
      })
      .catch(() => {})
      .finally(() => {
        window._fetchingGuestQuota = false;
      });
  }

  const isMobile = window.innerWidth <= 767;

  if (isMobile) {
    // Mobile Bottom Sheet
    closeUserProfileMenu();
    closeMobileBottomSheet();
    closeMobileModelSheet();
    closePlannerNotificationSheet();

    const overlay = document.querySelector("#mobileProfileSheetOverlay");
    if (!overlay) return;

    overlay.replaceChildren();
    overlay.hidden = false;
    overlay.setAttribute("aria-hidden", "false");
    overlay.classList.remove("is-closing");
    document.body.style.overflow = "hidden";

    const sheet = element("div", "mobile-action-sheet mobile-profile-sheet");
    sheet.setAttribute("role", "dialog");
    sheet.setAttribute("aria-modal", "true");
    sheet.setAttribute("aria-label", t("profileMenu.ariaLabel") || "User Profile Menu");

    // Drag area & handle
    const dragArea = element("div", "mobile-sheet-drag-area");
    dragArea.appendChild(element("div", "mobile-sheet-drag-handle"));

    // Menu content container
    const content = element("div", "profile-menu-content");
    const items = buildProfileMenuItems();
    content.append(...items);

    sheet.append(dragArea, content);
    overlay.appendChild(sheet);
    attachSwipeDownToClose(sheet, closeUserProfileMenu);

    requestAnimationFrame(() => {
      overlay.classList.add("is-open");
    });
  } else {
    // Desktop Popover
    const popover = document.querySelector("#profilePopoverMenu");
    if (!popover) return;

    // Toggle off if already open for the same trigger
    const triggerId = triggerEl?.id || "accountTrigger";
    if (!popover.hidden && popover.dataset.triggerId === triggerId) {
      closeUserProfileMenu();
      return;
    }

    closeUserProfileMenu();

    popover.dataset.triggerId = triggerId;
    popover.replaceChildren();

    const content = element("div", "profile-menu-content");
    const items = buildProfileMenuItems();
    content.append(...items);
    popover.appendChild(content);

    popover.hidden = false;
    popover.setAttribute("aria-hidden", "false");

    // Position popover floating above avatar trigger
    const rect = triggerEl ? triggerEl.getBoundingClientRect() : { left: 14, top: window.innerHeight - 60, width: 260 };
    const margin = 10;
    const popoverWidth = Math.max(rect.width, 270);
    const bottom = Math.max(margin, window.innerHeight - rect.top + margin);
    const left = Math.max(margin, Math.min(rect.left, window.innerWidth - popoverWidth - margin));

    popover.style.bottom = `${bottom}px`;
    popover.style.left = `${left}px`;
    popover.style.width = `${popoverWidth}px`;

    requestAnimationFrame(() => {
      popover.classList.add("is-open");
    });

    // Outside click dismiss
    setTimeout(() => {
      const onDocClick = (e) => {
        if (!popover.contains(e.target) && (!triggerEl || !triggerEl.contains(e.target))) {
          closeUserProfileMenu();
        }
      };
      document.addEventListener("click", onDocClick);
      activeProfileDocClickCleanup = () => {
        document.removeEventListener("click", onDocClick);
      };
    }, 10);
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function isComplexAskQuery(lastUserMsg = "", hasStrategyContext = false) {
  const cleanMsg = String(lastUserMsg || "").trim();
  if (!cleanMsg) return false;

  const deepHighPattern = /(hərtərəfli dərin analiz|hərtərəfli analiz|hərtərəfli təhlil|geniş təhlil|dərin araşdır|dərindən düşün|daha dərindən düşün|bütün detalları ilə|addım-addım.*hesabla|audit hesabatı|maliyyə modeli|unit economics|dcf|npv|irr|həssaslıq analizi|sensitivity analysis|sistem arxitekturası|deep analysis|in-depth analysis|comprehensive analysis|financial model|think deeper|step-by-step.*model)/i;
  if (deepHighPattern.test(cleanMsg)) return true;

  const modelingMediumPattern = /(rəqib analizi|swot analizi|swot matrisi|büdcə bölgüsü|cac\s*\/\s*ltv|roi\s+hesabla|unit\s+iqtisadiyyat|tam marketinq planı|go-to-market|gtm\s+strategiya|competitor analysis|budget breakdown|marketing plan|architecture review|kohort analizi)/i;
  if (modelingMediumPattern.test(cleanMsg)) return true;

  if (hasStrategyContext && /(analiz|təhlil|strategiya|plan|büdcə|rəqib|audit|hesabla|müqayisə|proqnoz|forecast|strategy|analysis)/i.test(cleanMsg)) {
    return true;
  }

  if (cleanMsg.length >= 450 && /(analiz|təhlil|strategiya|maliyyə|büdcə|rəqib|arxitektura|hesabla|müqayisə|proqnoz|optimallaşdır|model|audit|risk|plan)/i.test(cleanMsg)) {
    return true;
  }

  return false;
}

function getAskMessageModelInfo(model) {
  return {
    isGemini: true,
    isTerra: false,
    displayName: "Auto",
  };
}

function formatFileSize(bytes) {
  const num = Number(bytes);
  if (!Number.isFinite(num) || num <= 0) return "0 B";
  if (num < 1024) return `${num} B`;
  if (num < 1024 * 1024) return `${(num / 1024).toFixed(1)} KB`;
  return `${(num / (1024 * 1024)).toFixed(1)} MB`;
}

function getFileIconSvg(mimeType = "", fileName = "") {
  const ext = String(fileName || "").split(".").pop()?.toLowerCase() || "";
  const mime = String(mimeType || "").toLowerCase();

  if (ext === "pdf" || mime.includes("pdf")) {
    return `<svg class="ask-file-type-icon is-pdf" viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm4 18H6V4h7v5h5v11zM8 15h2a1 1 0 0 0 1-1v-1a1 1 0 0 0-1-1H8v4zm1-3h1v1H9v-1zm4 3h1.5a1.5 1.5 0 0 0 1.5-1.5v-1a1.5 1.5 0 0 0-1.5-1.5H13v4zm1-3h.5a.5.5 0 0 1 .5.5v1a.5.5 0 0 1-.5.5H14v-2z"/></svg>`;
  }
  if (mime.startsWith("image/") || ["png", "jpg", "jpeg", "webp", "gif", "heic", "svg"].includes(ext)) {
    return `<svg class="ask-file-type-icon is-image" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`;
  }
  if (["csv", "xlsx", "xls"].includes(ext) || mime.includes("sheet") || mime.includes("csv") || mime.includes("excel")) {
    return `<svg class="ask-file-type-icon is-sheet" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="15" y1="3" x2="15" y2="21"/></svg>`;
  }
  if (["js", "ts", "json", "py", "html", "css", "sql", "md", "txt", "xml", "yaml", "yml"].includes(ext) || mime.includes("text") || mime.includes("json")) {
    return `<svg class="ask-file-type-icon is-code" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>`;
  }
  return `<svg class="ask-file-type-icon is-doc" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>`;
}

async function readUploadedFileAsData(file) {
  return readFileAsData(file, { isEn: getLanguage() === "en" });
}

const STATUS_LABELS_AZ = {
  draft: "Qaralama",
  analyzing: "Analiz edilir",
  needs_clarification: "Məlumat gözlənilir",
  generating: "Hazırlanır",
  ready: "Hazırdır",
  refining: "Yenilənir",
  saved: "Yadda saxlanıb",
  error: "Xəta",
};

const STATUS_LABELS_EN = {
  draft: "Draft",
  analyzing: "Analyzing",
  needs_clarification: "Clarification Needed",
  generating: "Generating",
  ready: "Ready",
  refining: "Refining",
  saved: "Saved",
  error: "Error",
};

const STATUS_LABELS = new Proxy({}, {
  get(target, prop) {
    const dict = getLanguage() === "en" ? STATUS_LABELS_EN : STATUS_LABELS_AZ;
    return dict[prop] || prop;
  },
});

function getQuickActions() {
  const isEn = getLanguage() === "en";
  return isEn ? [
    ["shorten", "Shorten"],
    ["localize_azerbaijan", "Localize"],
    ["think_deeper", "Think deeper"],
    ["make_practical", "Make practical"],
    ["budget_optimize", "Optimize budget"],
  ] : [
    ["shorten", "Qısalt"],
    ["localize_azerbaijan", "Lokallaşdır"],
    ["think_deeper", "Daha dərindən düşün"],
    ["make_practical", "Praktik et"],
    ["budget_optimize", "Büdcəni optimallaşdır"],
  ];
}

const QUICK_ACTIONS = new Proxy([], {
  get(target, prop) {
    const actions = getQuickActions();
    if (prop === "forEach") return (fn) => actions.forEach(fn);
    if (prop === "map") return (fn) => actions.map(fn);
    if (prop === "length") return actions.length;
    return actions[prop];
  },
});

const LOADING_ASK_PLACEHOLDERS_AZ = [
  "Brendinq prosesi nə qədər vaxt aparır?",
  "Hədəf auditoriyanı necə dəqiq seqmentləşdirim?",
  "Marketinq büdcəsini kanallar üzrə necə bölüşdürməliyəm?",
  "Rəqib analizində ən vacib 3 metrikan nədir?",
  "B2B üçün ən effektiv satış kanalları hansılardır?",
  "CAC və LTV nisbətini necə optimallaşdıraq?",
  "Instagram reklamlarında ROAS-ı necə artıraq?",
  "Startap üçün ilkin böyümə (growth) taktikaları nələrdir?",
  "Strategiya hazır olduqdan sonra ilk addım nə olmalıdır?",
  "Məhsulun unikal satış təklifini (USP) necə formalaşdıraq?",
  "E-ticarətdə səbət tərketmə faizini necə azalda bilərik?",
  "Kontent marketinqi ilə orqanik trafiki necə artıraq?",
];

const LOADING_ASK_PLACEHOLDERS_EN = [
  "How long does the branding process typically take?",
  "How can I accurately segment my target audience?",
  "How should I allocate the marketing budget across channels?",
  "What are the 3 most critical metrics in competitor analysis?",
  "What are the most effective acquisition channels for B2B?",
  "How do we optimize our CAC to LTV ratio?",
  "How can we maximize ROAS on paid social campaigns?",
  "What are high-impact initial growth tactics for a startup?",
  "What should the immediate first step be after finalizing strategy?",
  "How do we define a differentiated Unique Selling Proposition (USP)?",
  "How can we reduce cart abandonment rates in e-commerce?",
  "How can we scale organic search traffic with content marketing?",
];

const LOADING_ASK_PLACEHOLDERS = new Proxy([], {
  get(target, prop) {
    const list = getLanguage() === "en" ? LOADING_ASK_PLACEHOLDERS_EN : LOADING_ASK_PLACEHOLDERS_AZ;
    if (prop === "slice") return (...args) => list.slice(...args);
    if (prop === "forEach") return (fn) => list.forEach(fn);
    if (prop === "map") return (fn) => list.map(fn);
    if (prop === "length") return list.length;
    return list[prop];
  },
});

let loadingAskPlaceholderTimer = null;
let refinementPlaceholderTimer = null;
let askPlaceholderTimer = null;

function stopAskPlaceholderAnimation() {
  if (askPlaceholderTimer) {
    clearTimeout(askPlaceholderTimer);
    askPlaceholderTimer = null;
  }
}

function getCookie(name) {
  try {
    const match = document.cookie.match(new RegExp("(?:^|; )" + name.replace(/([\.$?*|{}\(\)\[\]\\\/\+^])/g, "\\$1") + "=([^;]*)"));
    return match ? decodeURIComponent(match[1]) : null;
  } catch {
    return null;
  }
}

function setCookie(name, value, maxAgeSeconds = 31536000) {
  try {
    const secure = window.location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAgeSeconds}; SameSite=Lax${secure}`;
  } catch { }
}

const state = {
  mode: (() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const requested = params.get("mode");
      if (requested === "ask" || requested === "build") return requested;
      const session = sessionStorage.getItem("helmer_session_mode");
      if (session === "ask" || session === "build") return session;
      const cookieMode = getCookie("helmer_default_mode");
      if (cookieMode === "ask" || cookieMode === "build") return cookieMode;
      try { localStorage.removeItem("helmer_default_mode"); } catch { }
    } catch { }
    return "build";
  })(),
  view: "home",
  previousView: "home",
  status: "draft",
  brief: "",
  buildPreparationEstimate: null,
  buildEstimateBrief: "",
  buildEstimateUnavailable: false,
  questions: [],
  clarificationIndex: 0,
  clarificationDrafts: {},
  answers: [],
  assumptions: [],
  understanding: "",
  round: 0,
  strategy: null,
  versions: [],
  buildStreamingText: "",
  buildStreamingFinishReason: null,
  savedId: null,
  clientSaveId: crypto.randomUUID(),
  savedStrategies: [],
  updatedAt: null,
  error: null,
  retry: null,
  changeSummary: "",
  askChatId: null,
  currentChatId: null,
  savedChats: [],
  plannerTasks: [],
  plannerFilter: "active",
  plannerCollapsedGroups: new Set(["Ümumi"]),
  plannerSelectedTaskIds: new Set(),
  isPrioritizingPlanner: false,
  askMessages: [],
  askDraft: "",
  askPluginIds: [],
  askArtifactId: null,
  askArtifactName: "",
  askRetry: null,
  askLoading: false,
  askError: "",
  askPendingFile: null,
  askStrategyId: "",
  askTaskId: "",
  askPromptHintStrategyId: "",
  askSubMode: (() => {
    try {
      const saved = localStorage.getItem("helmer_ask_submode");
      if (saved === "research" || saved === "ask") return saved;
    } catch { }
    return "ask";
  })(),
  askModel: "auto",
  askThinkingLevel: (() => {
    try {
      const saved = localStorage.getItem("helmer_ask_thinking_level");
      if (["low", "medium", "high"].includes(saved)) return saved;
    } catch { }
    return "medium";
  })(),
  askThinkingEnabled: (() => {
    try { return localStorage.getItem("helmer_ask_thinking_enabled") === "true"; }
    catch { return false; }
  })(),
  buildModel: (() => {
    try {
      const saved = localStorage.getItem("helmer_build_model");
      if (saved === "auto" || saved === "faster") return saved;
    } catch { }
    return "auto";
  })(),
  buildFasterThinkingLevel: (() => {
    try {
      const saved = localStorage.getItem("helmer_build_faster_thinking");
      if (saved === "medium" || saved === "high") return saved;
    } catch { }
    return "medium";
  })(),
  strategyAskOpen: false,
  refinementOpen: false,
  currentUser: null,
  identityEpoch: 0,
  remainingGuestMessages: null,
  remainingGuestBriefs: null,
  guestQuotaCheckedAt: 0,
  guestQuotaVersion: 0,
  settingsTab: "account",
  strategyFormat: "blog",
  faqFilter: "",
  faqExpandedAll: false,
  limitsPeriod: "today",
  usageStats: null,
  limitsStatsExpanded: false,
  limitsFeaturesExpanded: false,
};

currentAskThinking = state.askThinkingEnabled ? (state.askThinkingLevel || "medium") : "low";

let progressTimer;
const freshAskResponses = new WeakSet();
const askWaitTimers = new WeakMap();
const askMessageUiMeta = new WeakMap();

function setAskMessageMeta(message, meta) {
  if (message && typeof message === "object") {
    askMessageUiMeta.set(message, { ...(askMessageUiMeta.get(message) || {}), ...meta });
  }
}

function getAskMessageMeta(message) {
  return (message && typeof message === "object" && askMessageUiMeta.get(message)) || {};
}

function sanitizeAskMessageForApi(message) {
  if (!message || typeof message !== "object") return message;
  const clean = {
    role: message.role,
    content: typeof message.content === "string" ? message.content : "",
  };
  if (message.file) clean.file = message.file;
  if (message.strategyTitle) clean.strategyTitle = message.strategyTitle;
  if (message.taskTitle) clean.taskTitle = message.taskTitle;
  if (message.model) clean.model = message.model;
  if (message.interactionId) clean.interactionId = message.interactionId;
  if (message.createdAt) clean.createdAt = message.createdAt;
  if (message.feedback) clean.feedback = message.feedback;
  if (message.status) clean.status = message.status;
  if (message.statusText) clean.statusText = message.statusText;
  if (message.groundingMetadata) clean.groundingMetadata = message.groundingMetadata;
  if (Array.isArray(message.artifacts)) clean.artifacts = message.artifacts;
  if (message.execution) clean.execution = message.execution;
  if (Array.isArray(message.pluginIds)) clean.pluginIds = message.pluginIds;
  if (message.type) clean.type = message.type;
  if (message.jobId) clean.jobId = message.jobId;
  if (message.id) clean.id = message.id;
  return clean;
}

function isAskThinkingActive(message) {
  if (message?.status === "searching") return true;
  const meta = getAskMessageMeta(message);
  const level = meta.thinkingLevel || message?.thinkingLevel;
  if (level) {
    return level === "medium" || level === "high";
  }
  return Boolean(state.askThinkingEnabled && state.askThinkingLevel && state.askThinkingLevel !== "low" && state.askThinkingLevel !== "off");
}

function getActiveThinkingInitialLabel(message, isEn) {
  const meta = getAskMessageMeta(message);
  let promptText = meta.userPrompt || message?.userPrompt || "";
  if (!promptText && Array.isArray(state.askMessages)) {
    promptText = state.askMessages.slice().reverse().find((m) => m && m.role === "user")?.content || "";
  }
  const lower = promptText.toLowerCase();
  const isConfusion = /fərq|qarışıq|səhv|başa düşmədim|niyə|differ|confus|why|understand|wrong|clarif|sual|problem/i.test(lower);
  const isStrategy = /strateg|plan|biznes|market|growth|bazar|rəqib/i.test(lower);
  const isTechnical = /kod|code|bug|xəta|error|api|db|data|database|funksiya|function/i.test(lower);

  if (isConfusion) {
    return isEn ? "Understanding the Confusion" : "Konteksti və sualı analiz edirəm...";
  }
  if (isStrategy) {
    return isEn ? "Analyzing Strategic Dimensions…" : "Strateji konteksti analiz edirəm…";
  }
  if (isTechnical) {
    return isEn ? "Evaluating Architecture & Logic…" : "Məntiqi və texniki detalları dəyərləndirirəm…";
  }
  return isEn ? "Understanding the context…" : "Düşünürəm…";
}

const askActiveThinkingStages = [
  [3500, "Əsas amilləri və faktorları araşdırıram...", "Evaluating key factors & nuances..."],
  [8000, "Strateji yanaşmanı və variantları dəyərləndirirəm...", "Analyzing trade-offs & approaches..."],
  [14000, "Dərin və strukturlaşdırılmış həlli qururam...", "Structuring the strategic response..."],
  [22000, "Yekun cavabı formalaşdırıram...", "Synthesizing final insights..."],
];

function clearAskWaitStages(message) {
  (askWaitTimers.get(message) || []).forEach(clearTimeout);
  askWaitTimers.delete(message);
}

function startAskWaitStages(message) {
  clearAskWaitStages(message);
}

function askThinkingIcon(isSearching) {
  return isSearching
    ? '<svg class="ask-searching-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m16.5 16.5 4.5 4.5"/></svg>'
    : '<span class="ask-thinking-dots" aria-hidden="true"><span class="ask-thinking-dot dot-1"></span><span class="ask-thinking-dot dot-2"></span><span class="ask-thinking-dot dot-3"></span></span>';
}

function askThinkingLabel(message, isEn) {
  if (message.status === "searching") return isEn ? "Searching the web..." : "Vebdə axtarıram...";
  if (message.statusText) return message.statusText;
  if (isAskThinkingActive(message)) {
    return getActiveThinkingInitialLabel(message, isEn);
  }
  return isEn ? "Preparing your response" : "Cavab hazırlanır";
}

// Background Jobs — analysis processes that continue when user leaves loading page
const MAX_GROUNDED_JOB_RETENTION_MS = 730 * 24 * 60 * 60 * 1000;

function isBackgroundJobGrounded(job) {
  if (!job || typeof job !== "object") return false;
  if (job.searchGrounded === true) return true;
  if (job.strategy && isStrategyGroundedClient(job.strategy)) return true;
  if (Array.isArray(job.versions) && job.versions.some((v) => isStrategyGroundedClient(v?.data || v))) return true;
  return false;
}

function isExpiredGroundedBackgroundJob(job, now = Date.now()) {
  if (!isBackgroundJobGrounded(job)) return false;
  const candidates = [
    job?.strategy?.orchestration?.firstGroundedAt,
    job?.completedAt,
    job?.startedAt,
    job?.updatedAt,
  ]
    .map((ts) => (typeof ts === "string" || typeof ts === "number" ? Date.parse(ts) : NaN))
    .filter((ms) => Number.isFinite(ms) && ms > 0);
  if (candidates.length === 0) return true; // Fail closed when grounded provenance lacks a valid timestamp
  const anchorMs = Math.min(...candidates);
  return now - anchorMs >= MAX_GROUNDED_JOB_RETENTION_MS;
}

let backgroundJobs = loadBackgroundJobs();

function currentOwnerId() {
  return (typeof state !== "undefined" && state?.currentUser?.id) ? state.currentUser.id : "guest";
}

function loadBackgroundJobs() {
  try {
    const owner = currentOwnerId();
    const raw = JSON.parse(localStorage.getItem("helmer_bg_jobs") || "[]");
    const all = Array.isArray(raw) ? raw : [];
    const active = all.filter((j) => j && !isExpiredGroundedBackgroundJob(j));
    if (active.length !== all.length) {
      try { localStorage.setItem("helmer_bg_jobs", JSON.stringify(active)); } catch {}
    }
    return active.filter((j) => j.ownerId === owner);
  } catch { return []; }
}

function persistBackgroundJobs() {
  try {
    const owner = currentOwnerId();
    const raw = JSON.parse(localStorage.getItem("helmer_bg_jobs") || "[]");
    const existingOther = (Array.isArray(raw) ? raw : [])
      .filter((j) => j && j.ownerId && j.ownerId !== owner && !isExpiredGroundedBackgroundJob(j));
    backgroundJobs = backgroundJobs.filter((j) => j && !isExpiredGroundedBackgroundJob(j));
    const combined = [...existingOther, ...backgroundJobs];
    localStorage.setItem("helmer_bg_jobs", JSON.stringify(combined));
  } catch { }
}

function removeBackgroundJob(id) {
  backgroundJobs = backgroundJobs.filter((j) => j.id !== id);
  persistBackgroundJobs();
}

function clearCompletedBackgroundJobs() {
  backgroundJobs = backgroundJobs.filter((j) => j.status === "generating");
  persistBackgroundJobs();
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(label, className, onClick) {
  const node = element("button", className, label);
  node.type = "button";
  if (onClick) node.addEventListener("click", onClick);
  return node;
}

function setStatus(status) {
  if (["analyzing", "generating"].includes(status) && !["analyzing", "generating"].includes(state.status)) state.buildStartedAt = Date.now();
  state.status = status;
  document.body.dataset.status = status;
}

function trackEvent(name, metadata = {}) {
  window.dispatchEvent(
    new CustomEvent("helmer:analytics", {
      detail: { name, metadata, timestamp: new Date().toISOString() },
    }),
  );
}

function formatDate(value) {
  const isEn = getLanguage() === "en";
  if (!value) return isEn ? "Just now" : "İndi";
  const date = new Date(value);
  if (isNaN(date.getTime())) return isEn ? "Just now" : "İndi";

  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday = date.toDateString() === yesterday.toDateString();

  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const time = `${hours}:${minutes}`;

  if (isToday) {
    return isEn ? `Today, ${time}` : `Bu gün, ${time}`;
  }
  if (isYesterday) {
    return isEn ? `Yesterday, ${time}` : `Dünən, ${time}`;
  }

  const monthsAz = ["Yan", "Fev", "Mar", "Apr", "May", "İyn", "İyl", "Avq", "Sen", "Okt", "Noy", "Dek"];
  const monthsEn = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const months = isEn ? monthsEn : monthsAz;
  const day = date.getDate();
  const month = months[date.getMonth()] || "";

  if (date.getFullYear() === now.getFullYear()) {
    return isEn ? `${month} ${day}, ${time}` : `${day} ${month}, ${time}`;
  }
  return isEn ? `${month} ${day}, ${date.getFullYear()}` : `${day} ${month} ${date.getFullYear()}`;
}

function slugify(value) {
  return (value || "helmer-strategy")
    .toLocaleLowerCase("az")
    .normalize("NFKD")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 64) || "helmer-strategy";
}

let currentAbortController = null;
const detachedBuildAbortControllers = new Set();
const backgroundResumeAbortControllers = new Set();
let currentAskAbortController = null;
let activeAskReader = null;
let activeAskTypewriter = null;

function createAskStopIcon() {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "14");
  svg.setAttribute("height", "14");
  svg.setAttribute("fill", "currentColor");
  svg.setAttribute("aria-hidden", "true");
  svg.classList.add("ask-stop-icon");
  const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  rect.setAttribute("x", "6");
  rect.setAttribute("y", "6");
  rect.setAttribute("width", "12");
  rect.setAttribute("height", "12");
  rect.setAttribute("rx", "2");
  svg.appendChild(rect);
  return svg;
}

function createAskSendIcon() {
  return element("span", "ask-submit-icon", "↑");
}

function createStrategyAskSendIcon() {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "15");
  svg.setAttribute("height", "15");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2.2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  const p1 = document.createElementNS("http://www.w3.org/2000/svg", "path");
  p1.setAttribute("d", "M12 19V5");
  const p2 = document.createElementNS("http://www.w3.org/2000/svg", "path");
  p2.setAttribute("d", "m5 12 7-7 7 7");
  svg.append(p1, p2);
  return svg;
}

function abortAskMessage() {
  if (currentAskAbortController) {
    try {
      currentAskAbortController.abort();
    } catch { }
    currentAskAbortController = null;
  }
  if (activeAskReader) {
    try {
      activeAskReader.cancel().catch(() => { });
    } catch { }
    activeAskReader = null;
  }
  if (activeAskTypewriter) {
    try {
      activeAskTypewriter.flush();
    } catch { }
    activeAskTypewriter = null;
  }
  if (typeof activeResearchStreams !== "undefined" && activeResearchStreams.size > 0) {
    for (const [jobId, controller] of activeResearchStreams.entries()) {
      try {
        controller.abort();
        fetch(`/api/ask/research/jobs/${jobId}/cancel`, { method: "POST" }).catch(() => { });
      } catch { }
    }
    activeResearchStreams.clear();
  }
  state.askLoading = false;
  state.askError = "";
  const streamingMsg = state.askMessages.find((m) => m && (m.isStreaming || (m.type === "research" && (m.status === "pending" || m.status === "running"))));
  if (streamingMsg) {
    clearAskWaitStages(streamingMsg);
    streamingMsg.isStreaming = false;
    if (streamingMsg.type === "research") {
      streamingMsg.status = "failed";
      streamingMsg.error = getLanguage() === "en" ? "Research was canceled." : "Araşdırma dayandırıldı.";
    } else if (!streamingMsg.content) {
      const idx = state.askMessages.indexOf(streamingMsg);
      if (idx !== -1) state.askMessages.splice(idx, 1);
    }
  }
  render();
}

async function api(path, options = {}) {
  let response;
  const isEn = getLanguage() === "en";
  const currentLang = isEn ? "en" : "az";
  try {
    response = await fetch(path, {
      ...options,
      signal: options.signal,
      headers: {
        "Content-Type": "application/json",
        "Accept-Language": currentLang,
        "X-Helmer-Language": currentLang,
        "X-Helmer-Model-Improvement": String(isModelImprovementActive()),
        ...(options.headers || {}),
      },
    });
  } catch (error) {
    if (error.name === "AbortError" || options.signal?.aborted) {
      const abortErr = new Error(isEn ? "Execution stopped." : "İcra dayandırıldı.");
      abortErr.name = "AbortError";
      throw abortErr;
    }
    throw new Error(navigator.onLine
      ? (isEn ? "Unable to generate strategy. Please try again in a few seconds." : "Strategiyanı hazırlamaq mümkün olmadı. Bir neçə saniyə sonra yenidən yoxla.")
      : (isEn ? "No internet connection." : "İnternet bağlantısı yoxdur."));
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && data.code === "AUTH_REQUIRED") {
      window.dispatchEvent(new CustomEvent("helmer:auth-required"));
    }
    const safeMessage = data.error || (path === "/api/ask"
      ? (isEn ? "Unable to generate response." : "Cavabı hazırlamaq mümkün olmadı.")
      : (isEn ? "Unable to generate strategy. Please try again in a few seconds." : "Strategiyanı hazırlamaq mümkün olmadı. Bir neçə saniyə sonra yenidən yoxla."));
    const error = new Error(safeMessage);
    error.code = data.code;
    error.status = response.status;
    error.model = data.model;
    throw error;
  }
  return data;
}

function showToast(message, tone = "success") {
  const toast = element("div", `toast toast-${tone}`);
  const dot = element("span", "toast-dot");
  dot.setAttribute("aria-hidden", "true");
  toast.append(dot, element("span", "", message));
  toastRegion.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add("is-visible"));
  setTimeout(() => {
    toast.classList.remove("is-visible");
    setTimeout(() => toast.remove(), 220);
  }, 3600);
}


function setError(error, retry, returnStatus = "draft") {
  state.error = error?.message || (getLanguage() === "en" ? "An unexpected error occurred." : "Gözlənilməz xəta baş verdi.");
  state.retry = retry;
  setStatus(returnStatus);
  render();
}

function clearError() {
  state.error = null;
  state.retry = null;
}

function errorBanner() {
  if (!state.error) return null;
  const isEn = getLanguage() === "en";
  const banner = element("div", "error-banner");
  const copy = element("div");
  copy.append(element("strong", "", isEn ? "Request not completed" : "Sorğu tamamlanmadı"), element("p", "", state.error));
  banner.append(copy);
  if (state.retry) {
    banner.append(
      button(isEn ? "Try again" : "Yenidən cəhd et", "secondary-button compact", () => {
        const retry = state.retry;
        clearError();
        retry();
      }),
    );
  }
  return banner;
}

function openSidebar() {
  document.querySelectorAll("details.ask-context-menu").forEach((el) => { el.open = false; });
  document.querySelector("#appShell").classList.remove("navigation-hidden");
  document.querySelector("#navigationRestore").hidden = true;
  sidebar.inert = false;
  document.querySelector(".navigation-rail").inert = true;
  sidebar.classList.add("is-open");
  document.querySelector(".app-main").inert = window.matchMedia("(max-width: 820px)").matches;
  document.body.classList.add("sidebar-open");
  mobileOverlay.hidden = !window.matchMedia("(max-width: 820px)").matches;
  requestAnimationFrame(() => { if (sidebar.classList.contains("is-open")) sidebarClose.focus(); });
  mobileMenuButton?.setAttribute("aria-expanded", "true");
  document.querySelector("#mobileChatMenuButton")?.setAttribute("aria-expanded", "true");
  railMenuButton.setAttribute("aria-expanded", "true");
  const mobileMenuSpan = mobileMenuButton?.querySelector("span");
  if (mobileMenuSpan) mobileMenuSpan.textContent = "✕";
}

function closeSidebar() {
  const restoreFocus = sidebar.contains(document.activeElement);
  sidebar.inert = true;
  document.querySelector(".navigation-rail").inert = false;
  sidebar.classList.remove("is-open");
  document.querySelector(".app-main").inert = false;
  document.body.classList.remove("sidebar-open");
  mobileOverlay.hidden = true;
  mobileMenuButton?.setAttribute("aria-expanded", "false");
  document.querySelector("#mobileChatMenuButton")?.setAttribute("aria-expanded", "false");
  railMenuButton.setAttribute("aria-expanded", "false");
  const mobileMenuSpan = mobileMenuButton?.querySelector("span");
  if (mobileMenuSpan) mobileMenuSpan.textContent = "☰";
  if (restoreFocus) (window.matchMedia("(max-width: 820px)").matches ? mobileMenuButton : railMenuButton)?.focus();
}

function syncLanguageControls() {
  const skipLink = document.querySelector(".skip-link");
  if (skipLink) skipLink.textContent = t("nav.skipToMain");

  const isEn = getLanguage() === "en";
  for (const [id, az, en] of [
    ["navigationHide", "Naviqasiyanı gizlət", "Hide navigation"],
    ["navigationRestore", "Naviqasiyanı göstər", "Show navigation"],
    ["railWhatsNewButton", "Yeniliklər", "What's new"],
  ]) {
    const control = document.getElementById(id);
    control?.setAttribute("aria-label", isEn ? en : az);
    if (control?.hasAttribute("data-tooltip")) control.setAttribute("data-tooltip", isEn ? en : az);
  }
  const mobileMenuBtn = document.querySelector("#mobileMenuButton");
  if (mobileMenuBtn) {
    mobileMenuBtn.setAttribute("aria-label", t("nav.openMenu") || (isEn ? "Open menu" : "Menyunu aç"));
  }
  const mobileChatMenuBtn = document.querySelector("#mobileChatMenuButton");
  if (mobileChatMenuBtn) {
    mobileChatMenuBtn.setAttribute("aria-label", t("nav.openMenu") || (isEn ? "Open menu" : "Menyunu aç"));
  }
  const newChatLabel = t("nav.newChat") || (isEn ? "New chat" : "Yeni söhbət");
  const mobileNewBtn = document.querySelector("#mobileNewButton");
  if (mobileNewBtn) {
    mobileNewBtn.setAttribute("aria-label", newChatLabel);
    mobileNewBtn.setAttribute("title", newChatLabel);
  }
  const mobileMoreBtn = document.querySelector("#mobileMoreButton");
  if (mobileMoreBtn) {
    const moreLabel = isEn ? "More options" : "Daha çox";
    mobileMoreBtn.setAttribute("aria-label", moreLabel);
    mobileMoreBtn.setAttribute("title", moreLabel);
  }
  const askModeBtn = document.querySelector("#askModeButton");
  if (askModeBtn) {
    askModeBtn.setAttribute("aria-label", isEn ? "Ask mode" : "Ask rejimi");
  }
  const chatModelBtn = document.querySelector("#mobileChatModelButton");
  if (chatModelBtn) {
    chatModelBtn.setAttribute("aria-label", isEn ? "Model selection" : "Model seçimi");
  }
}

function syncNav() {
  const isBuild = state.mode === "build";
  const isEn = getLanguage() === "en";
  const nonHomeViews = ["list", "settings", "planner", "limits", "up"];
  homeNav.classList.toggle("is-active", !nonHomeViews.includes(state.view));
  strategiesNav.classList.toggle("is-active", state.view === "list");
  plannerNav?.classList.toggle("is-active", state.view === "planner");
  for (const id of ["upNav", "railUpButton"]) document.getElementById(id)?.classList.toggle("is-active", state.view === "up");
  railHomeButton.classList.toggle("is-active", !nonHomeViews.includes(state.view));
  railStrategiesButton.classList.toggle("is-active", state.view === "list");
  railPlannerButton?.classList.toggle("is-active", state.view === "planner");

  railHomeButton.setAttribute("data-tooltip", `${isBuild ? t("nav.home") : t("nav.askChat")}${shortcutSuffix("⌘ 1", "Ctrl 1")}`);
  railHomeButton.setAttribute("aria-label", isBuild ? t("nav.home") : t("nav.askChat"));
  railSearchButton?.setAttribute("data-tooltip", `${isEn ? "Search" : "Axtarış"}${shortcutSuffix("⌘ K", "Ctrl K")}`);
  railSearchButton?.setAttribute("aria-label", isEn ? "Search" : "Axtarış");
  railStrategiesButton.setAttribute("data-tooltip", `${t("nav.archive")}${shortcutSuffix("⌘ 2", "Ctrl 2")}`);
  railStrategiesButton.setAttribute("aria-label", t("nav.archive"));
  if (railPlannerButton) {
    railPlannerButton.setAttribute("data-tooltip", `${t("nav.planner")}${shortcutSuffix("⌘ 3", "Ctrl 3")}`);
    railPlannerButton.setAttribute("aria-label", t("nav.planner"));
  }
  if (railInstallAppButton) {
    railInstallAppButton.setAttribute("data-tooltip", t("nav.installApp"));
    railInstallAppButton.setAttribute("aria-label", t("nav.installApp"));
  }
  if (railMenuButton) {
    railMenuButton.setAttribute("data-tooltip", t("nav.menu"));
    railMenuButton.setAttribute("aria-label", t("nav.openMenu"));
  }
  if (railLangToggleButton) {
    const currentLang = getLanguage();
    const isEn = currentLang === "en";
    railLangToggleButton.setAttribute("data-tooltip", t("nav.languageToggle"));
    railLangToggleButton.setAttribute("aria-label", t("nav.languageToggleAria"));
    railLangToggleButton.setAttribute("title", t("nav.languageToggle"));
    if (railLangBadge) {
      railLangBadge.textContent = isEn ? "EN" : "AZ";
    }
  }
  if (railAccountButton) {
    const isEn = getLanguage() === "en";
    railAccountButton.setAttribute("data-tooltip", t("nav.accountSettings") || (isEn ? "Account Settings" : "Hesab tənzimləmələri"));
    railAccountButton.setAttribute("aria-label", t("nav.openAccountSettings") || (isEn ? "Open account settings" : "Hesab tənzimləmələrini aç"));
  }
  if (accountButton) {
    const isEn = getLanguage() === "en";
    accountButton.setAttribute("aria-label", t("nav.openAccountSettings") || (isEn ? "Open account settings" : "Hesab tənzimləmələrini aç"));
  }
  const railNavEl = document.querySelector(".navigation-rail");
  if (railNavEl) {
    railNavEl.setAttribute("aria-label", t("nav.quickNavAria"));
  }
  const sidebarEl = document.querySelector("#sidebar");
  if (sidebarEl) {
    sidebarEl.setAttribute("aria-label", t("nav.mainNavAria"));
  }
  const brandLink = document.querySelector(".brand");
  if (brandLink) {
    brandLink.setAttribute("aria-label", t("brand.homeAriaLabel"));
  }
  const closeSidebarBtn = document.querySelector("#sidebarClose") || document.querySelector("#closeSidebarButton");
  if (closeSidebarBtn) {
    closeSidebarBtn.setAttribute("aria-label", t("nav.closeMenu"));
  }
  const modeSwitchEl = document.querySelector(".sidebar-mode-switch");
  if (modeSwitchEl) {
    modeSwitchEl.setAttribute("aria-label", t("nav.modeSwitchAria"));
  }
  const skipLinkEl = document.querySelector(".skip-link");
  if (skipLinkEl) {
    skipLinkEl.textContent = t("nav.skipToMain");
  }

  const searchLabel = searchNav?.querySelector("span");
  if (searchLabel) {
    searchLabel.textContent = isEn ? "Search" : "Axtarış";
  }

  const homeLabel = homeNav.querySelector("span");
  if (homeLabel) {
    homeLabel.textContent = isBuild ? t("nav.home") : t("nav.askChat");
  }

  const strategiesLabel = strategiesNav.querySelector("span:first-of-type");
  if (strategiesLabel) {
    strategiesLabel.textContent = t("nav.archive");
  }

  const plannerLabel = plannerNav?.querySelector("span:first-of-type");
  if (plannerLabel) {
    plannerLabel.textContent = t("nav.planner");
  }

  // Minimalist lock indicators for guests on restricted navigation items (in sidebar)
  const isGuest = !state.currentUser;
  strategiesNav.classList.toggle("is-guest-locked", isGuest);
  plannerNav?.classList.toggle("is-guest-locked", isGuest);
  upNav?.classList.toggle("is-guest-locked", isGuest);

  // Ensure rail buttons do not show lock indicators
  for (const btn of [railStrategiesButton, railPlannerButton, railUpButton]) {
    btn?.classList.remove("is-guest-locked");
    btn?.querySelector(".guest-lock-indicator")?.remove();
  }

  const updateNavLock = (el) => {
    if (!el) return;
    const existing = el.querySelector(".guest-lock-indicator");
    if (isGuest && !existing) {
      const lock = element("span", "guest-lock-indicator");
      lock.innerHTML = getGuestLockIconSvg(11);
      el.appendChild(lock);
    } else if (!isGuest && existing) {
      existing.remove();
    }
  };

  updateNavLock(strategiesNav);
  updateNavLock(plannerNav);
  updateNavLock(upNav);

  // Hide count indicators for guest users in sidebar, show for authenticated users
  if (strategyCount) {
    strategyCount.style.display = isGuest ? "none" : "";
  }
  if (plannerCount) {
    plannerCount.style.display = isGuest ? "none" : "";
  }

  const installAppLabel = installAppNav?.querySelector("span");
  if (installAppLabel) {
    installAppLabel.textContent = t("nav.installApp");
  }

  updateInstallButtonVisibility();


  const whatsNewLabel = whatsNewNav?.querySelector(".whats-new-label");
  if (whatsNewLabel) {
    whatsNewLabel.textContent = t("nav.whatsNew");
  }
  const whatsNewBadge = whatsNewNav?.querySelector(".whats-new-badge");
  if (whatsNewBadge) {
    whatsNewBadge.textContent = "v4.0";
  }
  if (whatsNewNav) {
    whatsNewNav.setAttribute("aria-label", t("nav.whatsNew"));
    whatsNewNav.setAttribute("data-tooltip", t("nav.whatsNew"));
  }

  if (newStrategyButton) {
    newStrategyButton.style.display = "none";
  }

  const labelEl = document.querySelector("#sidebarLabelText") || sidebarLabel;
  if (labelEl) {
    labelEl.textContent = t("nav.recentWork");
    document.querySelector("#recentViewAll").textContent = getLanguage() === "en" ? "View all ↗" : "Hamısına bax ↗";
  }

  const shortcutsBtn = document.querySelector("#keyboardShortcutsBtn");
  if (shortcutsBtn) shortcutsBtn.textContent = t("nav.shortcuts");
  const termsBtn = document.querySelector("#sidebarTermsBtn");
  if (termsBtn) termsBtn.textContent = t("nav.terms");
  const privacyBtn = document.querySelector("#sidebarPrivacyBtn");
  if (privacyBtn) privacyBtn.textContent = t("nav.privacy");

  if (workspaceMeta) {
    workspaceMeta.textContent = state.currentUser ? t("brand.personalAccount") : t("brand.guestAccount");
  }

  document.title = "Helmer";

  renderRecentList();
  syncLanguageControls();
}

function isHomePage() {
  if (state.view !== "home") return false;
  if (state.mode === "build") {
    return state.status === "draft" && !state.strategy;
  }
  if (state.mode === "ask") {
    return !state.askMessages.length && !state.askLoading;
  }
  return false;
}

function updateMobileActiveModelName() {
  const el = document.querySelector("#mobileActiveModelName");
  if (!el) return;
  const isFlash = state.askModel === "gemini-3.8-flash";
  el.textContent = isFlash ? "Flash" : "Helmer";
}

function syncMode() {
  const isBuild = state.mode === "build";
  const isHome = isHomePage();
  const isAskChatActive = state.mode === "ask" && state.view === "home" && Boolean(state.askMessages?.length || state.askLoading);
  const isChatActive = isAskChatActive;

  updateMobileActiveModelName();

  const mobileHeader = document.querySelector(".mobile-header");
  if (mobileHeader) {
    mobileHeader.classList.toggle("is-chat-active", isChatActive);
  }
  document.body.classList.toggle("is-chat-active", isChatActive);
  document.body.dataset.isChatActive = String(isChatActive);

  if (mobileModeSwitch) {
    mobileModeSwitch.hidden = !isHome;
  }

  if (mobileNewButton) {
    mobileNewButton.hidden = !isAskChatActive;
  }

  buildModeButton?.classList.toggle("is-active", isBuild);
  askModeButton?.classList.toggle("is-active", !isBuild);
  buildModeButton?.setAttribute("aria-selected", String(isBuild));
  askModeButton?.setAttribute("aria-selected", String(!isBuild));

  sidebarBuildModeButton?.classList.toggle("is-active", isBuild);
  sidebarAskModeButton?.classList.toggle("is-active", !isBuild);
  sidebarBuildModeButton?.setAttribute("aria-selected", String(isBuild));
  sidebarAskModeButton?.setAttribute("aria-selected", String(!isBuild));

  if (railModeToggleButton) {
    const isEn = getLanguage() === "en";
    const nextMode = isBuild ? "ask" : "build";
    const nextModeLabel = isBuild ? "Ask" : "Build";
    const dblClickHint = isEn
      ? `Double-click: Save ${nextModeLabel} as default`
      : `İkiqat klik: ${nextModeLabel} default et`;

    railModeToggleButton.setAttribute(
      "data-tooltip",
      `${isBuild ? (isEn ? "Mode: Build (Switch to Ask)" : "Rejim: Build (Ask-a keç)") : (isEn ? "Mode: Ask (Switch to Build)" : "Rejim: Ask (Build-ə keç)")} • ${dblClickHint}${shortcutSuffix("⌘ ⇧ A", "Ctrl ⇧ A")}`,
    );
    railModeToggleButton.setAttribute(
      "aria-label",
      isBuild
        ? (isEn ? `Switch to Ask mode (${dblClickHint})` : `Ask rejiminə keç (${dblClickHint})`)
        : (isEn ? `Switch to Build mode (${dblClickHint})` : `Build rejiminə keç (${dblClickHint})`),
    );
  }

  document.body.dataset.mode = state.mode;
  document.body.dataset.isHome = String(isHome);
}

function getDefaultWorkspaceMode() {
  if (state.currentUser?.settings?.defaultMode) {
    return state.currentUser.settings.defaultMode;
  }
  const cookieMode = getCookie("helmer_default_mode");
  if (cookieMode === "ask" || cookieMode === "build") return cookieMode;
  return "build";
}

let lastDefaultSavedTime = 0;

async function setDefaultWorkspaceMode(mode) {
  if (!['build', 'ask'].includes(mode)) return;
  lastDefaultSavedTime = Date.now();

  // Save to persistent cookie and session (eliminating volatile localStorage)
  setCookie("helmer_default_mode", mode);
  try {
    sessionStorage.setItem("helmer_session_mode", mode);
    localStorage.removeItem("helmer_default_mode");
  } catch { }

  setMode(mode, { persistDefault: true });

  if (railModeToggleButton) {
    railModeToggleButton.classList.remove("is-default-saved");
    void railModeToggleButton.offsetWidth;
    railModeToggleButton.classList.add("is-default-saved");
    setTimeout(() => {
      railModeToggleButton.classList.remove("is-default-saved");
    }, 700);
  }

  // Persist directly to Cloudflare R2 / users database on backend
  if (state.currentUser) {
    try {
      const currentSettings = state.currentUser.settings || {};
      const payload = {
        ...currentSettings,
        defaultMode: mode,
      };
      const data = await authRequest("/api/auth/settings", {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
      if (data?.user) {
        updateWorkspaceIdentity(data.user);
      } else if (state.currentUser.settings) {
        state.currentUser.settings.defaultMode = mode;
      }
    } catch (err) {
      console.warn("Could not persist default mode to account settings:", err);
    }
  }

  const isEn = getLanguage() === "en";
  const modeLabel = mode === "ask" ? "Ask" : "Build";
  showToast(
    isEn
      ? `Default workspace mode saved: ${modeLabel}`
      : `Default workspace rejimi "${modeLabel}" olaraq yadda saxlanıldı`,
    "success"
  );
}

function isAutoSaveStrategiesEnabled() {
  if (!state.currentUser) {
    return false;
  }
  if (typeof state.currentUser.settings?.autoSaveStrategies === "boolean") {
    return state.currentUser.settings.autoSaveStrategies;
  }
  const cookieVal = getCookie("helmer_auto_save_strategies");
  if (cookieVal !== null && cookieVal !== undefined && cookieVal !== "") {
    return cookieVal !== "false";
  }
  try {
    const localVal = localStorage.getItem("helmer_auto_save_strategies");
    if (localVal !== null && localVal !== undefined && localVal !== "") {
      return localVal !== "false";
    }
  } catch { }
  return true; // Default is ON (açıq)
}

async function setAutoSaveStrategies(enabled) {
  const boolVal = Boolean(enabled);
  setCookie("helmer_auto_save_strategies", String(boolVal));
  try {
    localStorage.setItem("helmer_auto_save_strategies", String(boolVal));
  } catch { }

  if (state.currentUser) {
    if (!state.currentUser.settings) state.currentUser.settings = {};
    state.currentUser.settings.autoSaveStrategies = boolVal;

    try {
      const currentSettings = state.currentUser.settings || {};
      const payload = {
        ...currentSettings,
        autoSaveStrategies: boolVal,
      };
      const data = await authRequest("/api/auth/settings", {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
      if (data?.user) {
        updateWorkspaceIdentity(data.user);
      }
    } catch (err) {
      console.warn("Could not persist auto-save to account settings:", err);
    }
  }
}

function setMode(mode, { persistDefault = false } = {}) {
  if (!['build', 'ask'].includes(mode)) return;
  try {
    sessionStorage.setItem("helmer_session_mode", mode);
  } catch { }
  if (persistDefault) {
    setCookie("helmer_default_mode", mode);
    try {
      localStorage.removeItem("helmer_default_mode");
    } catch { }
  }
  if (state.mode === mode && state.view === "home") return;
  state.mode = mode;
  state.view = "home";
  syncMode();
  syncNav();
  renderRecentList();
  render();
  closeSidebar();
  if (mode === "ask" && !state.savedChats.length) {
    loadSavedChats();
  }
}

function startNewChat() {
  clearInterval(progressTimer);
  state.mode = "ask";
  state.view = "home";
  state.askChatId = null;
  state.askMessages = [];
  state.askDraft = "";
  state.askPendingFile = null;
  state.askPluginIds = [];
  state.askArtifactId = null;
  state.askArtifactName = "";
  state.askRetry = null;
  state.askStrategyId = "";
  state.askTaskId = "";
  state.askPromptHintStrategyId = "";
  state.askError = "";
  try { sessionStorage.removeItem("helmer_active_ask_chat"); } catch { }
  render();
  closeSidebar();
}

function resetStrategy() {
  clearInterval(progressTimer);
  Object.assign(state, {
    mode: "build",
    view: "home",
    status: "draft",
    brief: "",
    questions: [],
    clarificationIndex: 0,
    clarificationDrafts: {},
    answers: [],
    assumptions: [],
    understanding: "",
    round: 0,
    strategy: null,
    versions: [],
    savedId: null,
    clientSaveId: crypto.randomUUID(),
    updatedAt: null,
    error: null,
    retry: null,
    changeSummary: "",
    strategyFormat: "blog",
    faqFilter: "",
    faqExpandedAll: false,
    strategyAskOpen: false,
    refinementOpen: false,
  });
  render();
  closeSidebar();
}

function render() {
  stopBuildCountdown();
  stopBuildIntelligence();
  stopAskPlaceholderAnimation();
  clearInterval(progressTimer);
  clearInterval(loadingAskPlaceholderTimer);
  clearTimeout(refinementPlaceholderTimer);
  if (state.mode !== "build" || state.view !== "home") cancelBuildEstimate();
  syncMode();
  syncNav();
  document.querySelectorAll(".build-menu-actions, .loading-top-actions, #loadingTopActions, .loading-history-button, #analysisHistoryBtn, .loading-ask-floating-wrap, #loadingAskFloatingWrap, .loading-ask-modal-overlay").forEach((btn) => btn.remove());
  workspace.replaceChildren();
  workspace.className = "workspace";

  if (state.view === "settings") return renderSettings();
  if (state.view === "up") return renderUpView(workspace);
  if (state.view === "planner") return renderPlannerView();
  if (state.view === "limits") return renderLimitsView();
  if (state.view === "list") return renderStrategyList();
  if (state.mode === "ask") return renderAsk();
  if (["analyzing", "generating"].includes(state.status)) return renderLoading();
  if (state.status === "needs_clarification") return renderClarification();
  if (state.strategy) return renderStrategyWorkspace();
  return renderIntake();
}

function getUserFirstName() {
  const fullName = state.currentUser?.fullName?.trim();
  if (fullName) {
    return fullName.split(/\s+/)[0];
  }
  const username = state.currentUser?.username?.trim();
  if (username) {
    return username.charAt(0).toUpperCase() + username.slice(1);
  }
  return "";
}

const BUILD_CTA_LIST_AZ = [
  (name) => (name ? `${name}, növbəti həmlən nədir?` : "Növbəti həmlən nədir?"),
  "Rəqibləri oyundan çıxarmaq vaxtıdır.",
  (name) => (name ? `${name}, planı qur, bazarı ələ alaq.` : "Planı qur, bazarı ələ alaq."),
  "Boş söhbətləri kəs — icraya başla.",
  (name) => (name ? `${name}, bu gün kimi sıxışdırırıq?` : "Bu gün kimi sıxışdırırıq?"),
  "Standartları sən müəyyən et.",
  (name) => (name ? `${name}, zəif nöqtə buraxma. Sistemi qur.` : "Zəif nöqtə buraxma. Sistemi qur."),
  "İkinci dərəcəli olmağa vaxt yoxdur.",
  (name) => (name ? `${name}, miqyası böyüt, hücuma keç.` : "Miqyası böyüt, hücuma keç."),
  "Fikirlərlə vaxt itirmə — nəticə qoy ortaya.",
  (name) => (name ? `${name}, masaya yumruğunu vurmaq vaxtıdır.` : "Masaya yumruğunu vurmaq vaxtıdır."),
  "Baxmaq bəsdir — get payını götür.",
  (name) => (name ? `${name}, yeni qaydaları sən yaz.` : "Yeni qaydaları sən yaz."),
  "Ləngiyən məhv olur. Tərpən.",
  (name) => (name ? `${name}, qoy onlar sənə çatmağa çalışsın.` : "Qoy onlar sənə çatmağa çalışsın."),
];

const BUILD_CTA_LIST_EN = [
  (name) => (name ? `${name}, what's the next play?` : "What's the next play?"),
  "Eat their lunch.",
  (name) => (name ? `${name}, lock in and ship.` : "Lock in and ship."),
  "Stop talking. Start executing.",
  (name) => (name ? `${name}, who are we squeezing out today?` : "Who are we squeezing out today?"),
  "Set the standard. Make them chase.",
  (name) => (name ? `${name}, build a moat.` : "Build a moat."),
  "Second place is zero.",
  (name) => (name ? `${name}, scale or bleed out.` : "Scale or bleed out."),
  "Fuck the pitch deck. Show me the engine.",
  (name) => (name ? `${name}, takeover mode.` : "Takeover mode."),
  "Outwork, outship, outlast.",
  (name) => (name ? `${name}, push to prod. Break the meta.` : "Push to prod. Break the meta."),
  "Speed is the ultimate weapon.",
  (name) => (name ? `${name}, stop playing defense.` : "Stop playing defense."),
];

const ASK_CTA_LIST_AZ = [
  (name) => (name ? `${name}, prosesdəki kritik boşluq nədir?` : "Prosesdəki kritik boşluq nədir?"),
  "Özünü aldatma — real rəqəmləri göstər.",
  (name) => (name ? `${name}, qazancı nə saxlayır? Problemə baxaq.` : "Qazancı nə saxlayır? Problemə baxaq."),
  "Rəqibin səni haradan vurur?",
  (name) => (name ? `${name}, riskdən qaçma, sualı ver.` : "Riskdən qaçma, sualı ver."),
  "Bəhanələri bir kənara qoy.",
  (name) => (name ? `${name}, darboğazı tap və darmadağın et.` : "Darboğazı tap və darmadağın et."),
  "Zəif strategiya ancaq büdcə yeyir. Yoxlayaq.",
  (name) => (name ? `${name}, nəyi görməzdən gəlirsən?` : "Nəyi görməzdən gəlirsən?"),
  "Yaraya barmaq basmaq vaxtıdır.",
  (name) => (name ? `${name}, sistemi nə batırır?` : "Sistemi nə batırır?"),
  "Zəif arqumentlərlə vaxt alma.",
  (name) => (name ? `${name}, pul hara axır? Konkret de.` : "Pul hara axır? Konkret de."),
  "İllüziyaları dağıtmaq lazımdır.",
  (name) => (name ? `${name}, ən qorxduğun ssenarini aç ortaya.` : "Ən qorxduğun ssenarini aç ortaya."),
];

const ASK_CTA_LIST_EN = [
  (name) => (name ? `${name}, where's the pipeline leaking?` : "Where's the pipeline leaking?"),
  "Stop capping. Show the unit economics.",
  (name) => (name ? `${name}, what's burning runway?` : "What's burning runway?"),
  "Where are you getting cooked?",
  (name) => (name ? `${name}, hit me with the ugly truth.` : "Hit me with the ugly truth."),
  "No vanity metrics. What's broke?",
  (name) => (name ? `${name}, find the bottleneck and kill it.` : "Find the bottleneck and kill it."),
  "Stress-test it before the market does.",
  (name) => (name ? `${name}, what blindspot are you dodging?` : "What blindspot are you dodging?"),
  "Call out the bad assumptions.",
  (name) => (name ? `${name}, what's sinking the ship?` : "What's sinking the ship?"),
  "Drop the spin. What failed?",
  (name) => (name ? `${name}, where's the cash bleed?` : "Where's the cash bleed?"),
  "Check your blind spots.",
  (name) => (name ? `${name}, what's your worst-case reality?` : "What's your worst-case reality?"),
];

function getBuildCta() {
  const list = getLanguage() === "en" ? BUILD_CTA_LIST_EN : BUILD_CTA_LIST_AZ;
  const item = list[Math.floor(Math.random() * list.length)];
  const name = getUserFirstName();
  return typeof item === "function" ? item(name) : item;
}

function getAskCta() {
  const list = getLanguage() === "en" ? ASK_CTA_LIST_EN : ASK_CTA_LIST_AZ;
  const item = list[Math.floor(Math.random() * list.length)];
  const name = getUserFirstName();
  return typeof item === "function" ? item(name) : item;
}

function appendPresetPrompt(input, prompt, onChange) {
  const current = input.value.trim();
  input.value = current ? `${current}\n\n${prompt}` : prompt;
  onChange();
  input.focus();
}

function addPresetPromptPane(popover, mode, onSelect, onBack) {
  const isEn = getLanguage() === "en";
  const header = element("div", "ask-context-menu-subheader");
  const back = button("", "ask-context-menu-back", onBack);
  back.type = "button";
  back.setAttribute("aria-label", isEn ? "Back to context menu" : "Kontekst menyusuna qayıt");
  back.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>';
  header.append(back, element("strong", "ask-context-menu-heading", isEn ? "Prompt Templates" : "Hazır sual"));
  popover.appendChild(header);
  popover.appendChild(element("div", "ask-context-menu-divider"));

  const list = element("div", "preset-prompt-list");
  const prompts = getPresetPrompts ? getPresetPrompts(mode, getLanguage()) : PRESET_PROMPTS[mode];
  prompts.forEach((prompt) => {
    const item = button("", "preset-prompt-item", () => onSelect(prompt.text));
    item.type = "button";
    item.append(element("strong", "", prompt.title), element("span", "", prompt.text));
    list.appendChild(item);
  });
  popover.appendChild(list);
}

function createMainAiHubTeaserCard(isEn) {
  return null;
}

export function closeGuideModal() {
  if (!guideModalOverlay) return;
  guideModalOverlay.hidden = true;
  guideModalOverlay.replaceChildren();
  document.body.style.overflow = "";
}

export function openGuideModal(initialMode = "build") {
  if (!guideModalOverlay) return;
  const isEn = getLanguage() === "en";
  guideModalOverlay.replaceChildren();

  const card = element("div", "guide-modal-card");
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-modal", "true");
  card.setAttribute("aria-labelledby", "guideModalTitle");

  let currentTab = initialMode === "ask" ? "ask" : "build";

  const renderContent = () => {
    card.replaceChildren();

    // ── Header ──
    const header = element("header", "guide-modal-header");
    const titleGroup = element("div", "guide-modal-title-group");
    const modalTitle = element(
      "h2",
      "guide-modal-title",
      currentTab === "build" ? t("starterGuide.modalTitleBuild") : t("starterGuide.modalTitleAsk")
    );
    modalTitle.id = "guideModalTitle";
    titleGroup.appendChild(modalTitle);

    const closeBtn = button("✕", "guide-modal-close", closeGuideModal);
    closeBtn.type = "button";
    closeBtn.setAttribute("aria-label", t("starterGuide.modalCloseAria"));
    header.append(titleGroup, closeBtn);

    // ── Mode Tabs ──
    const tabs = element("div", "guide-modal-tabs");
    tabs.setAttribute("role", "tablist");
    tabs.setAttribute("aria-label", isEn ? "Mode selection" : "Rejim seçimi");

    const buildTab = button(t("starterGuide.tabBuild"), `guide-modal-tab${currentTab === "build" ? " is-active" : ""}`, () => {
      if (currentTab !== "build") {
        currentTab = "build";
        renderContent();
      }
    });
    buildTab.type = "button";
    buildTab.setAttribute("role", "tab");
    buildTab.setAttribute("aria-selected", String(currentTab === "build"));

    const askTab = button(t("starterGuide.tabAsk"), `guide-modal-tab${currentTab === "ask" ? " is-active" : ""}`, () => {
      if (currentTab !== "ask") {
        currentTab = "ask";
        renderContent();
      }
    });
    askTab.type = "button";
    askTab.setAttribute("role", "tab");
    askTab.setAttribute("aria-selected", String(currentTab === "ask"));

    tabs.append(buildTab, askTab);

    // ── Modal Body ──
    const body = element("div", "guide-modal-body");

    // 1. Working Principle
    const principleBox = element("div", "guide-modal-principle");
    const principleTitle = element("h3", "guide-modal-section-title", t("starterGuide.principleHeading"));
    const principleText = element(
      "p",
      "guide-modal-principle-text",
      currentTab === "build" ? t("starterGuide.buildPrinciple") : t("starterGuide.askPrinciple")
    );
    principleBox.append(principleTitle, principleText);

    // 2. 3 Steps
    const stepsBox = element("div", "guide-modal-steps");
    const stepsTitle = element("h3", "guide-modal-section-title", t("starterGuide.stepsHeading"));
    stepsBox.appendChild(stepsTitle);

    const stepsList = element("div", "guide-modal-steps-list");
    const stepsData = currentTab === "build" ? [
      { num: "1", title: t("starterGuide.buildStep1Title"), desc: t("starterGuide.buildStep1Desc") },
      { num: "2", title: t("starterGuide.buildStep2Title"), desc: t("starterGuide.buildStep2Desc") },
      { num: "3", title: t("starterGuide.buildStep3Title"), desc: t("starterGuide.buildStep3Desc") },
    ] : [
      { num: "1", title: t("starterGuide.askStep1Title"), desc: t("starterGuide.askStep1Desc") },
      { num: "2", title: t("starterGuide.askStep2Title"), desc: t("starterGuide.askStep2Desc") },
      { num: "3", title: t("starterGuide.askStep3Title"), desc: t("starterGuide.askStep3Desc") },
    ];

    stepsData.forEach((st) => {
      const stepItem = element("div", "guide-modal-step-item");
      const numBadge = element("span", "guide-modal-step-num", st.num);
      const stepContent = element("div", "guide-modal-step-content");
      const stepHeader = element("strong", "guide-modal-step-heading", st.title);
      const stepDesc = element("p", "guide-modal-step-desc", st.desc);
      stepContent.append(stepHeader, stepDesc);
      stepItem.append(numBadge, stepContent);
      stepsList.appendChild(stepItem);
    });
    stepsBox.appendChild(stepsList);

    // 3. Examples
    const examplesBox = element("div", "guide-modal-examples");
    const examplesTitle = element("h3", "guide-modal-section-title", t("starterGuide.examplesHeading"));
    examplesBox.appendChild(examplesTitle);

    const examplesList = element("div", "guide-modal-examples-list");
    const examplesData = currentTab === "build" ? [
      t("starterGuide.buildExample1"),
      t("starterGuide.buildExample2"),
      t("starterGuide.buildExample3"),
    ] : [
      t("starterGuide.askExample1"),
      t("starterGuide.askExample2"),
      t("starterGuide.askExample3"),
    ];

    examplesData.forEach((exText) => {
      const chip = button("", "guide-modal-example-chip", () => {
        applyStarterPrompt(exText, currentTab);
      });
      chip.type = "button";
      const spark = element("span", "guide-modal-example-icon", "✦");
      const textSpan = element("span", "guide-modal-example-text", exText);
      chip.append(spark, textSpan);
      examplesList.appendChild(chip);
    });
    examplesBox.appendChild(examplesList);

    body.append(principleBox, stepsBox, examplesBox);

    // ── Footer ──
    const footer = element("footer", "guide-modal-footer");
    const dontShowBtn = button(
      t("starterGuide.dismissAria") || (isEn ? "Don't show again" : "Bir daha göstərmə"),
      "guide-modal-dismiss-btn secondary-button",
      () => {
        dismissHomeGuideCardsPermanently();
        closeGuideModal();
      }
    );
    dontShowBtn.type = "button";

    const startBtn = button(
      currentTab === "build" ? t("starterGuide.btnStartBuild") : t("starterGuide.btnStartAsk"),
      "guide-modal-start-btn",
      () => {
        dismissHomeGuideCardsPermanently();
        startInMode(currentTab);
      }
    );
    startBtn.type = "button";
    footer.append(dontShowBtn, startBtn);

    card.append(header, tabs, body, footer);
  };

  renderContent();
  guideModalOverlay.appendChild(card);
  guideModalOverlay.hidden = false;
  document.body.style.overflow = "hidden";
}

export function dismissHomeGuideCardsPermanently() {
  try {
    localStorage.setItem("helmer_guide_dismissed_build", "1");
    localStorage.setItem("helmer_guide_dismissed_ask", "1");
    localStorage.setItem("helmer_guide_dismissed_all", "1");
  } catch { }
  document.querySelectorAll(".home-guide-cards").forEach((el) => {
    el.classList.add("is-dismissing");
    setTimeout(() => el.remove(), 180);
  });
}

function applyStarterPrompt(prompt, targetMode) {
  dismissHomeGuideCardsPermanently();
  closeGuideModal();
  if (state.mode !== targetMode) {
    setMode(targetMode);
  }
  if (targetMode === "build") {
    state.brief = prompt;
    const briefInput = document.getElementById("briefInput");
    if (briefInput) {
      briefInput.value = prompt;
      briefInput.focus();
      briefInput.dispatchEvent(new Event("input", { bubbles: true }));
    }
  } else {
    state.askDraft = prompt;
    const askInput = document.getElementById("askInput");
    if (askInput) {
      askInput.value = prompt;
      askInput.focus();
      askInput.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }
}

function startInMode(targetMode) {
  dismissHomeGuideCardsPermanently();
  closeGuideModal();
  if (state.mode !== targetMode) {
    setMode(targetMode);
  }
  const inputEl = targetMode === "build" ? document.getElementById("briefInput") : document.getElementById("askInput");
  inputEl?.focus();
}

export function createHomeGuideCards(isEn, currentMode) {
  if (state.askStrategyId || state.askTaskId || state.strategy) {
    return null;
  }
  const isBuild = currentMode === "build";
  const storageKey = isBuild ? "helmer_guide_dismissed_build" : "helmer_guide_dismissed_ask";
  try {
    if (
      localStorage.getItem(storageKey) === "1" ||
      localStorage.getItem("helmer_guide_dismissed_all") === "1" ||
      (localStorage.getItem("helmer_guide_dismissed_build") === "1" && localStorage.getItem("helmer_guide_dismissed_ask") === "1")
    ) {
      return null;
    }
  } catch { }

  const container = element("div", "home-guide-cards");
  container.setAttribute("role", "region");
  container.setAttribute("aria-label", t("starterGuide.ariaRegion"));

  const card = element("div", `home-guide-card home-guide-card-${isBuild ? "build" : "ask"}`);
  card.setAttribute("role", "button");
  card.setAttribute("tabindex", "0");
  card.setAttribute("aria-label", isBuild ? t("starterGuide.buildCardAria") : t("starterGuide.askCardAria"));

  const icon = element("span", "home-guide-card-icon");
  icon.innerHTML = isBuild
    ? `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/><path d="M7 8h10"/><path d="M7 12h5"/></svg>`
    : `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><circle cx="12" cy="10" r="1"/><circle cx="8" cy="10" r="1"/><circle cx="16" cy="10" r="1"/></svg>`;

  const body = element("div", "home-guide-card-body");
  const header = element("div", "home-guide-card-header");
  const title = element("strong", "home-guide-card-title", isBuild ? t("starterGuide.buildCardTitle") : t("starterGuide.askCardTitle"));
  const badge = element("span", "home-guide-card-badge", isBuild ? t("starterGuide.buildCardBadge") : t("starterGuide.askCardBadge"));
  header.append(title, badge);

  const subtitle = element("span", "home-guide-card-sub", isBuild ? t("starterGuide.buildCardSubtitle") : t("starterGuide.askCardSubtitle"));
  body.append(header, subtitle);

  const actions = element("div", "home-guide-card-actions");

  const arrow = element("span", "home-guide-card-arrow");
  arrow.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17L17 7"/><path d="M7 7h10v10"/></svg>`;

  const dismissBtn = document.createElement("button");
  dismissBtn.type = "button";
  dismissBtn.className = "home-guide-card-close";
  const dismissTitle = t("starterGuide.dismissAria") || (isEn ? "Don't show again" : "Bir daha göstərmə");
  dismissBtn.setAttribute("aria-label", dismissTitle);
  dismissBtn.title = dismissTitle;
  dismissBtn.innerHTML = `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
  dismissBtn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      localStorage.setItem(storageKey, "1");
      localStorage.setItem("helmer_guide_dismissed_build", "1");
      localStorage.setItem("helmer_guide_dismissed_ask", "1");
      localStorage.setItem("helmer_guide_dismissed_all", "1");
    } catch { }
    container.classList.add("is-dismissing");
    setTimeout(() => {
      container.remove();
    }, 180);
  });

  actions.append(arrow, dismissBtn);

  card.append(icon, body, actions);

  card.addEventListener("click", (e) => {
    if (e.target.closest(".home-guide-card-close")) return;
    e.preventDefault();
    openGuideModal(isBuild ? "build" : "ask");
  });

  card.addEventListener("keydown", (e) => {
    if (e.target.closest(".home-guide-card-close")) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openGuideModal(isBuild ? "build" : "ask");
    }
  });

  container.append(card);
  return container;
}

export function createAskGuestLimitCard(isEn) {
  if (state.currentUser) return null;

  if (Date.now() - state.guestQuotaCheckedAt >= 60000 && !window._fetchingGuestQuota) {
    window._fetchingGuestQuota = true;
    const quotaVersion = state.guestQuotaVersion;
    fetch("/api/auth/guest-status")
      .then((r) => {
        if (!r.ok) throw new Error("Guest quota unavailable");
        return r.json();
      })
      .then((data) => {
        if (!Number.isInteger(data?.remaining) || data.remaining < 0) throw new Error("Invalid guest quota");
        if (quotaVersion !== state.guestQuotaVersion || state.currentUser) return;
        state.remainingGuestMessages = data.remaining;
        if (Number.isInteger(data?.buildRemaining) && data.buildRemaining >= 0) {
          state.remainingGuestBriefs = data.buildRemaining;
        }
        state.guestQuotaCheckedAt = Date.now();
        render();
      })
      .catch(() => {
        if (quotaVersion !== state.guestQuotaVersion || state.currentUser) return;
        state.remainingGuestMessages = null;
        state.remainingGuestBriefs = null;
        state.guestQuotaCheckedAt = Date.now();
        render();
      })
      .finally(() => {
        window._fetchingGuestQuota = false;
        clearTimeout(window._guestQuotaRefreshTimer);
        window._guestQuotaRefreshTimer = setTimeout(() => {
          if (!state.currentUser) { state.guestQuotaCheckedAt = 0; render(); }
        }, 60000);
      });
  }

  if (!Number.isInteger(state.remainingGuestMessages)) return null;
  const remaining = state.remainingGuestMessages;

  const isExhausted = remaining === 0;
  const isUrgent = remaining === 1 || remaining === 2;

  // Rule 10: Permanent Dismissal with 'X' in localStorage for informational tier (> 2)
  if (!isExhausted && !isUrgent) {
    try {
      if (localStorage.getItem("helmer_guest_limit_dismissed") === "1") {
        return null;
      }
    } catch {}
  }

  const card = element("div", `ask-guest-limit-card ${isExhausted ? "is-exhausted" : isUrgent ? "is-urgent" : "is-info"}`);
  card.setAttribute("role", "status");
  card.setAttribute("aria-live", "polite");

  const content = element("div", "ask-guest-limit-content");
  const badge = element("div", "ask-guest-limit-badge");

  if (isExhausted) {
    badge.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"></circle><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"></line></svg>`;
  } else if (isUrgent) {
    badge.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>`;
  } else {
    badge.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>`;
  }

  const textWrap = element("div", "ask-guest-limit-text");
  let titleStr = "";
  let descStr = "";

  if (isExhausted) {
    titleStr = isEn ? "Guest message limit reached" : "Qonaq mesaj limitiniz bitdi";
    descStr = isEn
      ? "Sign up to keep all your analyses and continue unlimited AI chats."
      : "Helmer-dən limitsiz istifadə etmək və söhbəti davam etdirmək üçün qeydiyyatdan keçin.";
  } else if (isUrgent) {
    titleStr = isEn
      ? `Attention: Only ${remaining} message${remaining === 1 ? "" : "s"} left!`
      : `Diqqət: Cəmi ${remaining} mesaj haqqınız qaldı!`;
    descStr = isEn
      ? "Sign up now so your conversation is saved and not interrupted."
      : "Söhbətin yarımçıq qalmaması və sessiyanın itməməsi üçün indi qeydiyyatdan keçin.";
  } else {
    titleStr = isEn
      ? `Guest mode · Remaining messages: ${remaining}`
      : `Qeyd: Qonaq rejimində qalan mesaj haqqınız: ${remaining}`;
    descStr = isEn
      ? "Sign up to save all your business analyses and unlock unlimited usage."
      : "Bütün analizlərin yaddaşda qalması və limitsiz istifadə üçün qeydiyyatdan keçin.";
  }

  const titleEl = element("div", "ask-guest-limit-title", titleStr);
  const descEl = element("div", "ask-guest-limit-desc", descStr);
  textWrap.append(titleEl, descEl);
  content.append(badge, textWrap);

  const actions = element("div", "ask-guest-limit-actions");

  const returnPath = encodeURIComponent(`${window.location.pathname}${window.location.search}`);
  const signupLink = document.createElement("a");
  signupLink.className = "ask-guest-limit-btn";
  signupLink.href = `/signup?returnTo=${returnPath}`;
  signupLink.innerHTML = `<span>${isEn ? "Sign up" : "Qeydiyyatdan keç"}</span><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M12 5l7 7-7 7"/></svg>`;

  actions.appendChild(signupLink);

  if (!isExhausted && !isUrgent) {
    const dismissBtn = document.createElement("button");
    dismissBtn.type = "button";
    dismissBtn.className = "ask-guest-limit-dismiss";
    dismissBtn.title = isEn ? "Dismiss" : "Bağla";
    dismissBtn.setAttribute("aria-label", isEn ? "Dismiss" : "Bağla");
    dismissBtn.innerHTML = `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;
    dismissBtn.addEventListener("click", (e) => {
      e.preventDefault();
      try {
        localStorage.setItem("helmer_guest_limit_dismissed", "1");
      } catch {}
      card.classList.add("is-dismissing");
      setTimeout(() => card.remove(), 180);
    });
    actions.appendChild(dismissBtn);
  }

  card.append(content, actions);
  return card;
}

export function createBuildGuestLimitCard(isEn) {
  if (state.currentUser) return null;

  if (Date.now() - state.guestQuotaCheckedAt >= 60000 && !window._fetchingGuestQuota) {
    window._fetchingGuestQuota = true;
    const quotaVersion = state.guestQuotaVersion;
    fetch("/api/auth/guest-status")
      .then((r) => {
        if (!r.ok) throw new Error("Guest quota unavailable");
        return r.json();
      })
      .then((data) => {
        if (quotaVersion !== state.guestQuotaVersion || state.currentUser) return;
        if (Number.isInteger(data?.remaining) && data.remaining >= 0) {
          state.remainingGuestMessages = data.remaining;
        }
        if (Number.isInteger(data?.buildRemaining) && data.buildRemaining >= 0) {
          state.remainingGuestBriefs = data.buildRemaining;
        }
        state.guestQuotaCheckedAt = Date.now();
        render();
      })
      .catch(() => {
        if (quotaVersion !== state.guestQuotaVersion || state.currentUser) return;
        state.remainingGuestBriefs = null;
        state.guestQuotaCheckedAt = Date.now();
        render();
      })
      .finally(() => {
        window._fetchingGuestQuota = false;
        clearTimeout(window._guestQuotaRefreshTimer);
        window._guestQuotaRefreshTimer = setTimeout(() => {
          if (!state.currentUser) { state.guestQuotaCheckedAt = 0; render(); }
        }, 60000);
      });
  }

  if (!Number.isInteger(state.remainingGuestBriefs)) return null;
  const remaining = state.remainingGuestBriefs;

  const isExhausted = remaining === 0;
  const isUrgent = remaining === 1 || remaining === 2;

  // Rule 10: Permanent Dismissal with 'X' in localStorage for informational tier (> 2)
  if (!isExhausted && !isUrgent) {
    try {
      if (localStorage.getItem("helmer_guest_build_limit_dismissed") === "1") {
        return null;
      }
    } catch {}
  }

  const card = element("div", `ask-guest-limit-card ${isExhausted ? "is-exhausted" : isUrgent ? "is-urgent" : "is-info"}`);
  card.setAttribute("role", "status");
  card.setAttribute("aria-live", "polite");

  const content = element("div", "ask-guest-limit-content");
  const badge = element("div", "ask-guest-limit-badge");

  if (isExhausted) {
    badge.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"></circle><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"></line></svg>`;
  } else if (isUrgent) {
    badge.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>`;
  } else {
    badge.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>`;
  }

  const textWrap = element("div", "ask-guest-limit-text");
  let titleStr = "";
  let descStr = "";

  if (isExhausted) {
    titleStr = isEn ? "Guest brief limit reached" : "Qonaq brif limitiniz bitdi";
    descStr = isEn
      ? "Sign up to keep all your strategies and unlock unlimited usage."
      : "Helmer-dən limitsiz istifadə etmək və yeni strategiyalar hazırlamaq üçün qeydiyyatdan keçin.";
  } else if (isUrgent) {
    titleStr = isEn
      ? `Attention: Only ${remaining} brief${remaining === 1 ? "" : "s"} left!`
      : `Diqqət: Cəmi ${remaining} brif haqqınız qaldı!`;
    descStr = isEn
      ? "Sign up now so your strategy is saved and not interrupted."
      : "Strategiyanın yarımçıq qalmaması və sessiyanın itməməsi üçün indi qeydiyyatdan keçin.";
  } else {
    titleStr = isEn
      ? `Guest mode · Remaining briefs: ${remaining}`
      : `Qeyd: Qonaq rejimində qalan brif haqqınız: ${remaining}`;
    descStr = isEn
      ? "Sign up to save all your strategies and unlock unlimited usage."
      : "Bütün analizlərin yaddaşda qalması və limitsiz istifadə üçün qeydiyyatdan keçin.";
  }

  const titleEl = element("div", "ask-guest-limit-title", titleStr);
  const descEl = element("div", "ask-guest-limit-desc", descStr);
  textWrap.append(titleEl, descEl);
  content.append(badge, textWrap);

  const actions = element("div", "ask-guest-limit-actions");

  const returnPath = encodeURIComponent(`${window.location.pathname}${window.location.search}`);
  const signupLink = document.createElement("a");
  signupLink.className = "ask-guest-limit-btn";
  signupLink.href = `/signup?returnTo=${returnPath}`;
  signupLink.innerHTML = `<span>${isEn ? "Sign up" : "Qeydiyyatdan keç"}</span><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M12 5l7 7-7 7"/></svg>`;

  actions.appendChild(signupLink);

  if (!isExhausted && !isUrgent) {
    const dismissBtn = document.createElement("button");
    dismissBtn.type = "button";
    dismissBtn.className = "ask-guest-limit-dismiss";
    dismissBtn.title = isEn ? "Dismiss" : "Bağla";
    dismissBtn.setAttribute("aria-label", isEn ? "Dismiss" : "Bağla");
    dismissBtn.innerHTML = `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;
    dismissBtn.addEventListener("click", (e) => {
      e.preventDefault();
      try {
        localStorage.setItem("helmer_guest_build_limit_dismissed", "1");
      } catch {}
      card.classList.add("is-dismissing");
      setTimeout(() => card.remove(), 180);
    });
    actions.appendChild(dismissBtn);
  }

  card.append(content, actions);
  return card;
}

export function getGuestLockIconSvg(size = 12, className = "guest-lock-badge") {
  const isEn = getLanguage() === "en";
  const label = isEn ? "Registration required" : "Qeydiyyat tələb olunur";
  return `<span class="${className}" title="${label}" aria-label="${label}"><svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg></span>`;
}

export const GUEST_BUILD_EXHAUSTED_MESSAGE = "Qonaq brif limitiniz bitdi. Helmer-dən limitsiz istifadə etmək və yeni strategiyalar hazırlamaq üçün qeydiyyatdan keçin.";
export const GUEST_BUILD_EXHAUSTED_MESSAGE_EN = "Guest brief limit reached. Sign up to keep all your strategies and continue unlimited usage.";

export const GUEST_RESTRICTION_NOTICES = {
  thinking: "Ask rejimində 'Thinking' funksiyasından istifadə etmək üçün qeydiyyatdan keçməlisiniz. Hesab yaradaraq dərin strateji təhlilləri aktivləşdirin.",
  file: "Fayl yükləmək və sənədlərinizi analiz etmək üçün qeydiyyatdan keçməlisiniz.",
  strategy: "Saxlanılmış strategiyalarınıza daxil olmaq və onlar üzərində işləmək üçün qeydiyyatdan keçməlisiniz.",
  planner: "'Planner Tasks' bölməsindən istifadə etmək və tapşırıqlarınızı idarə etmək üçün qeydiyyatdan keçməlisiniz.",
  buildExhausted: GUEST_BUILD_EXHAUSTED_MESSAGE,
};

export const GUEST_RESTRICTION_NOTICES_EN = {
  thinking: "You must sign up to use the 'Thinking' feature in Ask mode. Create an account to activate deep strategic reasoning.",
  file: "You must sign up to upload files and analyze your documents.",
  strategy: "You must sign up to access your saved strategies and work on them.",
  planner: "You must sign up to use the 'Planner Tasks' section and manage your tasks.",
  buildExhausted: GUEST_BUILD_EXHAUSTED_MESSAGE_EN,
};

export function getGuestRestrictionNotice(noticeOrKey, isEn = getLanguage() === "en") {
  if (!noticeOrKey) return "";
  if (!isEn) {
    if (GUEST_RESTRICTION_NOTICES[noticeOrKey]) return GUEST_RESTRICTION_NOTICES[noticeOrKey];
    const match = Object.entries(GUEST_RESTRICTION_NOTICES_EN).find(([, text]) => text === noticeOrKey);
    if (match && GUEST_RESTRICTION_NOTICES[match[0]]) return GUEST_RESTRICTION_NOTICES[match[0]];
    return noticeOrKey;
  }
  if (GUEST_RESTRICTION_NOTICES_EN[noticeOrKey]) return GUEST_RESTRICTION_NOTICES_EN[noticeOrKey];
  const match = Object.entries(GUEST_RESTRICTION_NOTICES).find(([, text]) => text === noticeOrKey);
  if (match && GUEST_RESTRICTION_NOTICES_EN[match[0]]) return GUEST_RESTRICTION_NOTICES_EN[match[0]];
  return noticeOrKey;
}

export function openGuestRestrictionModal(noticeText) {
  if (!noticeText) return;
  const existing = document.querySelector(".guest-restriction-overlay");
  if (existing) existing.remove();

  const isEn = getLanguage() === "en";
  const resolvedNotice = getGuestRestrictionNotice(noticeText, isEn);
  const overlay = element("div", "guest-restriction-overlay");
  const card = element("div", "guest-restriction-modal");
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-modal", "true");
  card.setAttribute("aria-labelledby", "guestRestrictionTitle");

  const iconWrap = element("div", "guest-restriction-icon");
  iconWrap.innerHTML = `<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`;

  const header = element("div", "guest-restriction-header");
  const title = element("h2", "guest-restriction-title", isEn ? "Registration Required" : "Qeydiyyat Tələb Olunur");
  title.id = "guestRestrictionTitle";

  const closeBtn = button("✕", "guest-restriction-close", () => overlay.remove());
  closeBtn.type = "button";
  closeBtn.setAttribute("aria-label", isEn ? "Close" : "Bağla");
  header.append(title, closeBtn);

  const desc = element("p", "guest-restriction-text", resolvedNotice);

  const actions = element("div", "guest-restriction-actions");
  const cancelBtn = button(isEn ? "Dismiss" : "Bağla", "guest-restriction-cancel", () => overlay.remove());
  cancelBtn.type = "button";

  const returnPath = encodeURIComponent(`${location.pathname}${location.search}${location.hash}`);
  const signupBtn = element("a", "guest-restriction-confirm", isEn ? "Sign Up" : "Qeydiyyatdan keç");
  signupBtn.href = `/signup?returnTo=${returnPath}`;
  signupBtn.addEventListener("click", () => {
    overlay.remove();
  });

  actions.append(cancelBtn, signupBtn);
  card.append(iconWrap, header, desc, actions);
  overlay.appendChild(card);

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.remove();
  });

  const onKey = (e) => {
    if (e.key === "Escape") {
      overlay.remove();
      document.removeEventListener("keydown", onKey);
    }
  };
  document.addEventListener("keydown", onKey);

  document.body.appendChild(overlay);
  setTimeout(() => signupBtn.focus(), 50);
}

export function createAskContextSuggestions(isEn, selectedStrategy, selectedTask, onSelect) {
  const container = element("div", "ask-context-suggestions");
  container.setAttribute("role", "toolbar");
  container.setAttribute("aria-label", t("ask.contextActions.ariaToolbar") || (isEn ? "Context quick actions" : "Kontekst üzrə sürətli əməliyyatlar"));

  const items = selectedStrategy
    ? [
        {
          id: "analyze",
          label: t("ask.contextActions.analyze") || (isEn ? "Analyze" : "Analiz et"),
          prompt: t("ask.contextActions.analyzePrompt") || (isEn ? "Analyze this strategy in detail: identify core strengths, weaknesses, critical risks, and highest-impact growth opportunities." : "Bu strategiyanı ətraflı analiz et: əsas güclü və zəif tərəflərini, kritik riskləri və ən vacib inkişaf imkanlarını prioritetləşdir."),
          icon: '<svg viewBox="0 0 24 24" width="13.5" height="13.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/><path d="M11 8v6"/><path d="M8 11h6"/></svg>',
        },
        {
          id: "pros-cons",
          label: t("ask.contextActions.prosAndCons") || (isEn ? "Explore pros & cons" : "Müsbət və mənfi tərəflərini araşdır"),
          prompt: t("ask.contextActions.prosAndConsPrompt") || (isEn ? "Critically evaluate the pros and cons of this strategy, highlighting potential pitfalls, trade-offs, and alternative approaches." : "Bu strategiyanın bütün müsbət və mənfi cəhətlərini obyektiv araşdır, potensial təhlükələri və alternativ yanaşmaları qiymətləndir."),
          icon: '<svg viewBox="0 0 24 24" width="13.5" height="13.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m16 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z"/><path d="m2 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z"/><path d="M7 21h10"/><path d="M12 3v18"/><path d="M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2"/></svg>',
        },
        {
          id: "roadmap",
          label: t("ask.contextActions.roadmap") || (isEn ? "Build execution roadmap" : "İcra xəritəsi hazırla"),
          prompt: t("ask.contextActions.roadmapPrompt") || (isEn ? "Create a step-by-step execution roadmap for this strategy: include phased milestones, timeline, and key performance indicators." : "Bu strategiyanın uğurla icrası üçün mərhələli fəaliyyət xəritəsi hazırla: addım-addım prioritetlər, zaman qrafiki və əsas KPI-lar daxil olsun."),
          icon: '<svg viewBox="0 0 24 24" width="13.5" height="13.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="6" cy="19" r="3"/><path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15"/><circle cx="18" cy="5" r="3"/></svg>',
        },
        {
          id: "bottlenecks",
          label: t("ask.contextActions.bottlenecks") || (isEn ? "Find bottlenecks & risks" : "Darboğaz və riskləri tap"),
          prompt: t("ask.contextActions.bottlenecksPrompt") || (isEn ? "Stress-test this strategy to uncover potential execution bottlenecks, resource constraints, and strategic risks." : "Bu strategiyanın həyata keçirilməsində yarana biləcək əsas darboğazları, resurs çatışmazlıqlarını və uğursuzluq risklərini stress-test et."),
          icon: '<svg viewBox="0 0 24 24" width="13.5" height="13.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>',
        },
      ]
    : [
        {
          id: "task-plan",
          label: t("ask.contextActions.taskPlan") || (isEn ? "Create action plan" : "İcra planı qur"),
          prompt: t("ask.contextActions.taskPlanPrompt") || (isEn ? "Provide a concrete step-by-step action plan and best practices to execute this task efficiently." : "Bu tapşırığı uğurla və operativ icra etmək üçün addım-addım konkret plan və ən yaxşı təcrübələri təqdim et."),
          icon: '<svg viewBox="0 0 24 24" width="13.5" height="13.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="6" cy="19" r="3"/><path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15"/><circle cx="18" cy="5" r="3"/></svg>',
        },
        {
          id: "task-blockers",
          label: t("ask.contextActions.taskBlockers") || (isEn ? "Identify blockers & risks" : "Maneə və riskləri tap"),
          prompt: t("ask.contextActions.taskBlockersPrompt") || (isEn ? "Identify potential blockers and risks during the execution of this task, along with mitigation strategies." : "Bu tapşırığın icrası zamanı yarana biləcək əsas maneələri, riskləri və onların həll yollarını müəyyən et."),
          icon: '<svg viewBox="0 0 24 24" width="13.5" height="13.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>',
        },
        {
          id: "task-effort",
          label: t("ask.contextActions.taskEffort") || (isEn ? "Effort & timeline" : "Resurs və zaman bölgüsü"),
          prompt: t("ask.contextActions.taskEffortPrompt") || (isEn ? "Structure the estimated effort, required resources, and clear success criteria for completing this task." : "Bu tapşırıq üçün tələb olunan təxmini vaxt, zəruri resurslar və uğur meyarlarını strukturlaşdır."),
          icon: '<svg viewBox="0 0 24 24" width="13.5" height="13.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
        },
        {
          id: "task-steps",
          label: t("ask.contextActions.taskSteps") || (isEn ? "Immediate steps" : "Hərəkətə keçmə addımları"),
          prompt: t("ask.contextActions.taskStepsPrompt") || (isEn ? "List the first 3 highest-priority, immediate action items to get started on this task right away." : "Bu tapşırığa dərhal başlamaq üçün ilk 3 ən vacib praktik addımı sırala."),
          icon: '<svg viewBox="0 0 24 24" width="13.5" height="13.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/><path d="M11 8v6"/><path d="M8 11h6"/></svg>',
        },
      ];

  items.forEach((item) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "ask-context-suggestion-btn";
    btn.setAttribute("data-action-id", item.id);
    btn.setAttribute("aria-label", item.label);
    btn.title = item.prompt;

    const iconSpan = element("span", "ask-context-suggestion-icon");
    iconSpan.innerHTML = item.icon;

    const labelSpan = element("span", "ask-context-suggestion-label", item.label);

    btn.append(iconSpan, labelSpan);

    btn.addEventListener("click", (e) => {
      e.preventDefault();
      if (state.askLoading) return;
      btn.classList.add("is-active");
      container.querySelectorAll("button").forEach(b => { b.disabled = true; });
      onSelect(item.prompt);
    });

    container.appendChild(btn);
  });

  return container;
}

// Ephemeral estimates: never persist prompts or mix responses from edited briefs.
let buildEstimateTimer = null;
let buildEstimateRequest = null;
let buildEstimateSequence = 0;
let buildEstimateLastStarted = 0;

function validBuildEstimate(value) {
  return value && Number.isInteger(value.minMinutes) && Number.isInteger(value.maxMinutes)
    && value.minMinutes >= 1 && value.maxMinutes > value.minMinutes && value.maxMinutes <= 60
    && [1, 2, 3].includes(value.bufferMinutes);
}

function updateBuildEstimate(value, brief = state.brief.trim()) {
  if (!validBuildEstimate(value)) return;
  state.buildPreparationEstimate = value;
  state.buildEstimateBrief = brief;
  refreshBuildEstimateCards();
}

let buildCountdownTimer = null;
function stopBuildCountdown() {
  clearInterval(buildCountdownTimer);
  buildCountdownTimer = null;
}
function startBuildCountdown() {
  stopBuildCountdown();
  const epoch = state.identityEpoch;
  const userId = state.currentUser?.id || null;
  buildCountdownTimer = setInterval(() => {
    if (isIdentityStale(epoch, userId) || !["analyzing", "generating"].includes(state.status) || !document.querySelector(".intelligence-view")) {
      stopBuildCountdown();
      return;
    }
    refreshBuildEstimateCards();
  }, 1000);
}

function createBuildEstimateCard() {
  const card = element("div", "build-estimate-card");
  card.dataset.buildEstimate = "true";
  card.setAttribute("role", "status");
  card.setAttribute("aria-live", "polite");
  const icon = element("span", "build-estimate-clock", "◷");
  icon.setAttribute("aria-hidden", "true");
  const content = element("div", "build-estimate-content");
  content.append(element("span", "build-estimate-label"), element("strong", "build-estimate-range"));
  card.append(icon, content);
  return card;
}

function refreshBuildEstimateCards() {
  const isEn = getLanguage() === "en";
  const visible = state.brief.trim().length >= 8;
  const estimate = state.buildEstimateBrief === state.brief.trim() ? state.buildPreparationEstimate : null;
  document.querySelectorAll("[data-build-estimate]").forEach(card => {
    card.hidden = !visible;
    card.querySelector(".build-estimate-label").textContent = isEn ? "Estimated preparation time:" : "Təxmini hazırlanma vaxtı:";
    card.querySelector(".build-estimate-range").textContent = validBuildEstimate(estimate)
      ? `${estimate.minMinutes}–${estimate.maxMinutes} ${isEn ? "minutes" : "dəqiqə"}`
      : state.buildEstimateUnavailable ? (isEn ? "Currently unavailable" : "Hazırda əlçatan deyil")
      : (isEn ? "Estimating…" : "Hesablanır…");
    card.title = isEn ? "An estimate, not a time limit. Preparation may take longer." : "Təxmini müddətdir, vaxt limiti deyil. Hazırlanma daha uzun çəkə bilər.";
    if (card.closest(".intelligence-view") && validBuildEstimate(estimate)) {
      const started = state.buildStartedAt || (state.buildStartedAt = Date.now());
      const seconds = Math.max(0, Math.ceil((started + (estimate.minMinutes + estimate.maxMinutes) * 30000 - Date.now()) / 1000));
      card.querySelector(".build-estimate-label").textContent = isEn ? "Estimated time remaining:" : "Təxmini qalan vaxt:";
      card.querySelector(".build-estimate-range").textContent = seconds ? `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}` : (isEn ? "Taking longer than expected" : "Gözləniləndən uzun çəkir");
      let info = card.querySelector(".build-countdown-info");
      if (!info) {
        const clock = card.querySelector(".build-estimate-clock");
        const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.setAttribute("viewBox", "0 0 24 24");
        svg.setAttribute("fill", "none");
        svg.setAttribute("stroke", "currentColor");
        svg.setAttribute("stroke-width", "1.7");
        svg.setAttribute("stroke-linecap", "round");
        const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        path.setAttribute("d", "M12 8v4l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0");
        svg.append(path);
        clock.replaceChildren(svg);
        info = element("div", "build-countdown-info");
        const toggle = element("button", "", "ⓘ");
        toggle.type = "button";
        toggle.setAttribute("aria-expanded", "false");
        toggle.addEventListener("click", () => {
          const open = info.classList.toggle("is-open");
          toggle.setAttribute("aria-expanded", String(open));
        });
        info.addEventListener("keydown", event => {
          if (event.key === "Escape") {
            info.classList.remove("is-open");
            toggle.setAttribute("aria-expanded", "false");
            toggle.blur();
          }
        });
        toggle.setAttribute("aria-label", isEn ? "About this estimate" : "Vaxt təxmini haqqında");
        info.append(toggle, element("span", "build-countdown-tooltip"));
        card.append(info);
      }
      info.querySelector(".build-countdown-tooltip").textContent = `${estimate.minMinutes}–${estimate.maxMinutes} ${isEn ? "minutes. This duration is an estimate. Actual preparation may take less or more time." : "dəqiqə. Bu müddət təxminidir. Faktiki hazırlanma vaxtı daha qısa və ya uzun ola bilər."}`;
    }

  });
}

function cancelBuildEstimate() {
  clearTimeout(buildEstimateTimer);
  buildEstimateTimer = null;
  buildEstimateSequence += 1;
  buildEstimateRequest?.controller.abort();
  buildEstimateRequest = null;
}

function scheduleBuildEstimate() {
  const brief = state.brief.trim();
  if (buildEstimateRequest?.brief === brief) return;
  cancelBuildEstimate();
  state.buildEstimateUnavailable = false;
  refreshBuildEstimateCards();
  if (brief.length < 8 || (!state.currentUser && state.remainingGuestBriefs === 0)
    || (state.buildEstimateBrief === brief && validBuildEstimate(state.buildPreparationEstimate))) return;
  const sequence = buildEstimateSequence;
  buildEstimateTimer = setTimeout(() => {
    buildEstimateTimer = null;
    if (sequence !== buildEstimateSequence || state.mode !== "build" || state.status !== "draft") return;
    const controller = new AbortController();
    buildEstimateLastStarted = Date.now();
    const request = { brief, controller, promise: null };
    buildEstimateRequest = request;
    request.promise = api("/api/strategy/estimate", {
      method: "POST", signal: controller.signal,
      headers: { "Idempotency-Key": crypto.randomUUID() },
      body: JSON.stringify(
        state.buildModel === "faster"
          ? { brief, buildMode: "faster", fasterThinkingLevel: state.buildFasterThinkingLevel === "high" ? "high" : "medium" }
          : { brief }
      ),
    }).then(data => {
      if (sequence === buildEstimateSequence && state.brief.trim() === brief) updateBuildEstimate(data.preparationEstimate, brief);
    }).catch(error => {
      if (error.name !== "AbortError" && sequence === buildEstimateSequence) {
        state.buildEstimateUnavailable = true;
        refreshBuildEstimateCards();
      }
    }).finally(() => { if (buildEstimateRequest === request) buildEstimateRequest = null; });
  }, Math.max(1200, 10000 - (Date.now() - buildEstimateLastStarted)));
}

function renderIntake() {
  const isEn = getLanguage() === "en";
  workspace.classList.add("workspace-ask", "workspace-intake", "is-empty");

  const shell = element("section", "ask-shell is-empty");
  shell.setAttribute("aria-labelledby", "intakeTitle");

  const thread = element("div", "ask-thread");
  const intro = element("div", "ask-intro");
  const title = element("h1", "ask-title", getBuildCta());
  title.id = "intakeTitle";
  intro.append(title);
  thread.appendChild(intro);

  const composerArea = element("div", "ask-composer-area");
  composerArea.classList.add("build-estimate-composer");
  const estimateCard = createBuildEstimateCard();
  const estimateIcon = estimateCard.querySelector(".build-estimate-clock");
  const timerSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  timerSvg.setAttribute("viewBox", "0 0 24 24");
  timerSvg.setAttribute("fill", "none");
  timerSvg.setAttribute("stroke", "currentColor");
  timerSvg.setAttribute("stroke-width", "1.6");
  timerSvg.setAttribute("stroke-linecap", "round");
  timerSvg.setAttribute("stroke-linejoin", "round");
  const timerPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
  timerPath.setAttribute("d", "M9 2h6M12 2v3M18 6l1.5-1.5M12 9v4l2 1M20 13a8 8 0 1 1-16 0 8 8 0 0 1 16 0");
  timerSvg.append(timerPath);
  estimateIcon.replaceChildren(timerSvg);
  const form = element("form", "ask-composer");
  const label = element("label", "sr-only", isEn ? "Strategy brief" : "Strategiya brifi");
  label.htmlFor = "briefInput";

  const textarea = element("textarea", "ask-input");
  textarea.id = "briefInput";
  textarea.name = "brief";
  textarea.rows = 1;
  textarea.maxLength = 8000;
  const isBuildExhausted = !state.currentUser && state.remainingGuestBriefs === 0;
  textarea.placeholder = isBuildExhausted
    ? (isEn ? "Guest brief limit reached. Sign up to continue…" : "Qonaq brif limitiniz bitdi. Davam etmək üçün qeydiyyatdan keçin…")
    : (isEn ? "Ask Helmer to Build" : "Helmer ilə strategiya qur");
  textarea.disabled = isBuildExhausted;
  textarea.value = state.brief;

  const submit = button("", "ask-submit");
  submit.type = "submit";
  submit.disabled = isBuildExhausted || state.brief.trim().length < 8;
  submit.setAttribute("aria-label", isEn ? "Build strategy" : "Strategiyanı qur");
  submit.appendChild(createAskSendIcon());

  const composerActions = element("div", "ask-composer-actions");
  composerActions.append(createBuildModelSelector(isEn), submit);

  const contextMenu = document.createElement("details");
  contextMenu.className = "ask-context-menu";
  const contextTrigger = element("summary", "ask-context-trigger");
  contextTrigger.setAttribute("aria-label", isEn ? "More options" : "Əlavə seçimlər");
  contextTrigger.title = isEn ? "More options" : "Əlavə seçimlər";
  contextTrigger.appendChild(element("span", "ask-context-plus", "+"));

  contextTrigger.addEventListener("click", (event) => {
    if (window.innerWidth <= 767) {
      event.preventDefault();
      event.stopPropagation();
      openMobileContextSheet({
        mode: "build",
        onSelectPrompt: (promptText) => {
          appendPresetPrompt(textarea, promptText, resizeInput);
        },
      });
    }
  });

  const isDesktop = typeof window !== "undefined" && window.innerWidth >= 768;
  const contextPopover = element("div", `ask-context-popover${isDesktop ? " is-downwards" : ""}`);
  let contextPane = "main";
  const drawBuildMenu = () => {
    contextPopover.replaceChildren();
    if (typeof window !== "undefined" && window.innerWidth >= 768) {
      contextPopover.classList.add("is-downwards");
    } else {
      contextPopover.classList.remove("is-downwards");
    }
    if (contextPane === "prompts") {
      addPresetPromptPane(contextPopover, "build", (prompt) => {
        contextMenu.open = false;
        contextPane = "main";
        appendPresetPrompt(textarea, prompt, resizeInput);
      }, () => {
        contextPane = "main";
        drawBuildMenu();
      });
      return;
    }
    contextPopover.appendChild(element("strong", "ask-context-menu-heading", isEn ? "Add" : "Əlavə et"));
    contextPopover.appendChild(element("div", "ask-context-menu-divider"));

    const option = button("", "ask-context-menu-option group", () => {
      contextPane = "prompts";
      drawBuildMenu();
    });
    option.type = "button";

    const main = element("div", "ask-context-menu-option-main");
    const icon = element("span", "ask-context-menu-option-icon");
    icon.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="M13 8H7"/><path d="M17 12H7"/></svg>';
    const copy = element("span", "ask-context-menu-option-copy");
    copy.append(
      element("strong", "", isEn ? "Prompt Templates" : "Hazır sual"),
      element("small", "", isEn ? "Choose a ready-made strategy brief template" : "Başlamaq üçün hazır prompt seç")
    );
    main.append(icon, copy);

    const chevron = element("span", "ask-context-menu-chevron");
    chevron.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>';

    option.append(main, chevron);
    contextPopover.appendChild(option);
  };
  drawBuildMenu();
  contextMenu.append(contextTrigger, contextPopover);
  const closeBuildContextMenuOnPointer = (event) => {
    const path = event.composedPath ? event.composedPath() : [];
    if (path.includes(contextMenu) || contextMenu.contains(event.target)) return;
    contextMenu.open = false;
  };
  const closeBuildContextMenuOnKeyDown = (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      contextMenu.open = false;
      contextTrigger.focus?.();
    }
  };
  contextMenu.addEventListener("toggle", () => {
    if (contextMenu.open) {
      setTimeout(() => {
        document.addEventListener("pointerdown", closeBuildContextMenuOnPointer);
        document.addEventListener("keydown", closeBuildContextMenuOnKeyDown);
      }, 0);
    } else {
      document.removeEventListener("pointerdown", closeBuildContextMenuOnPointer);
      document.removeEventListener("keydown", closeBuildContextMenuOnKeyDown);
      contextPane = "main";
      contextPopover.classList.remove("is-downwards");
      drawBuildMenu();
    }
  });

  form.append(contextMenu, label, textarea, composerActions);

  const helper = element("div", "ask-composer-meta");
  const disclaimer = element("p", "ask-disclaimer", t("common.disclaimer"));
  helper.appendChild(disclaimer);

  const guestLimitCard = createBuildGuestLimitCard(isEn);
  if (guestLimitCard) {
    composerArea.append(guestLimitCard);
  }

  const isStrategySelected = Boolean(state.strategy || state.askStrategyId || state.askTaskId);
  const guideCards = !isStrategySelected ? createHomeGuideCards(isEn, "build") : null;
  if (guideCards) {
    composerArea.append(form, estimateCard, helper, guideCards);
  } else {
    composerArea.append(form, estimateCard, helper);
  }

  const resizeInput = () => {
    state.brief = textarea.value;
    const isExhausted = !state.currentUser && state.remainingGuestBriefs === 0;
    submit.disabled = isExhausted || textarea.value.trim().length < 8;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 160)}px`;
    shell.classList.toggle("has-input", Boolean(textarea.value.trim()));
    scheduleBuildEstimate();
  };
  textarea.addEventListener("input", resizeInput);
  textarea.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing && window.innerWidth > 700) {
      event.preventDefault();
      if (!submit.disabled) form.requestSubmit();
    }
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!state.currentUser && state.remainingGuestBriefs === 0) {
      openGuestRestrictionModal(isEn ? GUEST_BUILD_EXHAUSTED_MESSAGE_EN : GUEST_BUILD_EXHAUSTED_MESSAGE);
      return;
    }
    state.brief = textarea.value.trim();
    if (state.brief.length >= 8) startAssessment();
  });

  const banner = errorBanner();
  if (banner) shell.appendChild(banner);

  shell.append(thread, composerArea);
  workspace.appendChild(shell);
  const teaserCard = createMainAiHubTeaserCard(isEn);
  if (teaserCard) workspace.appendChild(teaserCard);
  resizeInput();
  if (window.innerWidth > 767) setTimeout(() => textarea.focus(), 0);
}

function cleanMarkdownFormatting(raw) {
  let text = String(raw || "");
  if (!text.includes("*") && !text.includes("`")) {
    return text;
  }

  // Step A: Protect code blocks and inline code
  const codePlaceholders = [];
  text = text.replace(/(`[^`]+`)/g, (m) => {
    codePlaceholders.push(m);
    return `__MD_CODE_${codePlaceholders.length - 1}__`;
  });

  // Step B: Protect true valid bold pairs where opening ** is left-flanking
  // (preceded by whitespace/start/bracket, not followed by space)
  // and closing ** is right-flanking (not preceded by space, followed by space/punct/end)
  const validPairs = [];
  text = text.replace(/(^|[\s\n\r>(\[*_~])\*\*([^\s*](?:[^*]*?[^\s*])?)\*\*(?=[\s\n\r<)\]*_~:.,;!?]|$)/g, (m, prefix, content) => {
    validPairs.push(`**${content}**`);
    return `${prefix}__VALID_BOLD_${validPairs.length - 1}__`;
  });

  // Step C1: Fix broken closing "**:" or "**." at start of line, list item or after punctuation (e.g. "1. Why it matters**:")
  text = text.replace(
    /(^|[\n\r>(\[|]|\d+[.)]\s+|[-*]\s+|[:.!?]\s+)([\p{L}\p{N}_]+(?:\s+[\p{L}\p{N}_]+){0,5})\*\*([:.,;!?])/gu,
    (_, prefix, words, punct) => {
      validPairs.push(`**${words}**`);
      return `${prefix}__VALID_BOLD_${validPairs.length - 1}__${punct}`;
    }
  );

  // Step C2: Fix broken closing "**:" on a single word anywhere else (e.g. "matters**:")
  text = text.replace(
    /(^|[\s\n\r>(\[])([\p{L}\p{N}_]+)\*\*([:.,;!?])/gu,
    (_, prefix, word, punct) => {
      validPairs.push(`**${word}**`);
      return `${prefix}__VALID_BOLD_${validPairs.length - 1}__${punct}`;
    }
  );

  // Step C3: Fix broken opening without closing before punctuation (e.g. "**matters:")
  text = text.replace(
    /(^|[\s\n\r>(\[])\*\*([\p{L}\p{N}_]+(?:\s+[\p{L}\p{N}_]+){0,5})([:.,;!?])/gu,
    (_, prefix, words, punct) => {
      validPairs.push(`**${words}**`);
      return `${prefix}__VALID_BOLD_${validPairs.length - 1}__${punct}`;
    }
  );

  // Step D: If there is still an unmatched "**" (odd count), close it cleanly
  const remainingStars = (text.match(/\*\*/g) || []).length;
  if (remainingStars % 2 !== 0) {
    text = text + "**";
  }

  // Step E: Restore valid bold pairs and code
  text = text.replace(/__VALID_BOLD_(\d+)__/g, (_, idx) => validPairs[Number(idx)]);
  text = text.replace(/__MD_CODE_(\d+)__/g, (_, idx) => codePlaceholders[Number(idx)]);

  return text;
}

function appendAskInline(parent, value, allowLineBreaks = false) {
  const appendText = (target, text) => {
    const lines = allowLineBreaks ? text.split(/<br\s*\/?>/i) : [text];
    lines.forEach((line, index) => {
      if (index) target.appendChild(document.createElement("br"));
      target.appendChild(document.createTextNode(line));
    });
  };
  const str = String(value || "");
  if (!str.includes("*") && !str.includes("_") && !str.includes("`") && !str.includes("[")) {
    appendText(parent, str);
    return;
  }
  const cleaned = cleanMarkdownFormatting(str);
  const parts = String(cleaned).split(/(\[[^\]]+\]\(https?:\/\/[^\s)]+\)|\*\*[^*]+\*\*|__[^_]+__|(?<!\*)\*[^*]+\*(?!\*)|(?<!_)_[^_]+_(?!_)|`[^`]+`)/g).filter(Boolean);
  parts.forEach((part) => {
    const linkMatch = part.match(/^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/);
    if (linkMatch) {
      const a = document.createElement("a");
      a.href = linkMatch[2];
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.textContent = linkMatch[1];
      a.className = "ask-inline-link";
      parent.appendChild(a);
    } else if ((part.startsWith("**") && part.endsWith("**")) || (part.startsWith("__") && part.endsWith("__"))) {
      const strong = element("strong", "");
      appendText(strong, part.slice(2, -2));
      parent.appendChild(strong);
    } else if ((part.startsWith("*") && part.endsWith("*") && part.length > 2) || (part.startsWith("_") && part.endsWith("_") && part.length > 2)) {
      const emphasis = element("em", "");
      appendText(emphasis, part.slice(1, -1));
      parent.appendChild(emphasis);
    } else if (part.startsWith("`") && part.endsWith("`")) {
      parent.appendChild(element("code", "", part.slice(1, -1)));
    } else {
      appendText(parent, part);
    }
  });
}

function patchAskInline(parent, value) {
  if (parent.childNodes.length === 1 && parent.firstChild.nodeType === 3 && !/[*_`\[]/.test(value)) {
    parent.firstChild.nodeValue = value;
  } else {
    parent.replaceChildren();
    appendAskInline(parent, value);
  }
}

function askTableCells(line) {
  return line.trim().replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim());
}

function parseAskRichTextBlocks(value, sourceOffset = 0) {
  const blocks = [];
  const lines = String(value || "").replace(/\r/g, "").split("\n");
  const lineOffsets = [];
  let offset = sourceOffset;
  for (const line of lines) {
    lineOffsets.push(offset);
    offset += line.length + 1;
  }
  let blockStart = sourceOffset;
  const addBlock = (block) => blocks.push({ ...block, sourceStart: blockStart });
  let index = 0;
  while (index < lines.length) {
    blockStart = lineOffsets[index];
    const line = lines[index].trim();
    if (!line) {
      index += 1;
      continue;
    }

    if (/^[-*_]{3,}$/.test(line)) {
      addBlock({ type: "hr", key: "hr" });
      index += 1;
      continue;
    }

    if (line.startsWith("```")) {
      const language = line.slice(3).trim();
      const content = [];
      index += 1;
      while (index < lines.length && !lines[index].trim().startsWith("```")) content.push(lines[index++]);
      if (index < lines.length) index += 1;
      const codeText = content.join("\n");
      addBlock({ type: "code", language, codeText, key: `code:${language}:${codeText}` });
      continue;
    }

    const heading = line.match(/^(#{2,4})\s+(.+)$/);
    if (heading) {
      const level = Math.min(4, heading[1].length);
      const text = heading[2];
      addBlock({ type: "heading", level, text, key: `h${level}:${text}` });
      index += 1;
      continue;
    }

    if (line.includes("|") && lines[index + 1]?.includes("|") && /^\|?[\s:|-]+\|?$/.test(lines[index + 1].trim())) {
      const headerLine = line;
      index += 2;
      const bodyLines = [];
      while (index < lines.length && lines[index].includes("|") && lines[index].trim()) {
        bodyLines.push(lines[index]);
        index += 1;
      }
      addBlock({
        type: "table",
        headerLine,
        bodyLines,
        key: `table:${headerLine}\n${bodyLines.join("\n")}`,
      });
      continue;
    }

    if (/^[-*]\s+/.test(line)) {
      const items = [];
      while (index < lines.length) {
        const curLine = lines[index].trim();
        if (/^[-*]\s+/.test(curLine)) {
          items.push([curLine.replace(/^[-*]\s+/, "")]);
          index += 1;
          continue;
        }

        if (!curLine) {
          let nextIdx = index + 1;
          while (nextIdx < lines.length && !lines[nextIdx].trim()) {
            nextIdx++;
          }
          if (nextIdx < lines.length && /^[-*]\s+/.test(lines[nextIdx].trim())) {
            index = nextIdx;
            continue;
          }
          break;
        }

        if (
          !/^#{2,4}\s+|^[-*]\s+|^\d+[.)]\s+|^```|^[-*_]{3,}$/.test(curLine) &&
          !curLine.includes("|")
        ) {
          if (items.length > 0) {
            items[items.length - 1].push(curLine);
            index += 1;
            continue;
          }
        }

        break;
      }
      const normalizedItems = items.map((segments) => segments.join(" "));
      addBlock({
        type: "ul",
        items: normalizedItems,
        key: `ul:${normalizedItems.join("\n")}`,
      });
      continue;
    }

    const numMatch = line.match(/^(\d+)[.)]\s+(.*)$/);
    if (numMatch) {
      const startNum = parseInt(numMatch[1], 10) || 1;
      const items = [];
      while (index < lines.length) {
        const curLine = lines[index].trim();
        const curMatch = curLine.match(/^(\d+)[.)]\s+(.*)$/);
        if (curMatch) {
          const itemNum = parseInt(curMatch[1], 10);
          items.push({ num: isNaN(itemNum) ? null : itemNum, segments: [curMatch[2]] });
          index += 1;
          continue;
        }

        if (!curLine) {
          let nextIdx = index + 1;
          while (nextIdx < lines.length && !lines[nextIdx].trim()) {
            nextIdx++;
          }
          if (nextIdx < lines.length && /^\d+[.)]\s+/.test(lines[nextIdx].trim())) {
            index = nextIdx;
            continue;
          }
          break;
        }

        if (
          !/^#{2,4}\s+|^[-*]\s+|^\d+[.)]\s+|^```|^[-*_]{3,}$/.test(curLine) &&
          !curLine.includes("|")
        ) {
          if (items.length > 0) {
            items[items.length - 1].segments.push(curLine);
            index += 1;
            continue;
          }
        }

        break;
      }
      const normalizedItems = items.map((it) => ({
        num: it.num,
        text: it.segments.join(" "),
        key: `${it.num ?? ""}:${it.segments.join(" ")}`,
      }));
      addBlock({
        type: "ol",
        startNum,
        items: normalizedItems,
        key: `ol:${startNum}:${normalizedItems.map((it) => it.key).join("\n")}`,
      });
      continue;
    }

    const paragraphLines = [line];
    index += 1;
    while (index < lines.length && lines[index].trim() && !/^(#{2,4})\s+|^[-*]\s+|^\d+[.)]\s+|^```/.test(lines[index].trim())) {
      if (lines[index].includes("|") && lines[index + 1]?.includes("|")) break;
      paragraphLines.push(lines[index].trim());
      index += 1;
    }
    const text = paragraphLines.join(" ");
    addBlock({ type: "p", text, key: `p:${text}` });
  }
  return blocks;
}

function createAskBlockNode(block) {
  let node;
  if (block.type === "hr") {
    node = element("hr", "ask-divider");
  } else if (block.type === "code") {
    node = element("pre", "ask-code-block");
    const code = element("code", block.language ? `language-${block.language}` : "", block.codeText);
    node.appendChild(code);
  } else if (block.type === "heading") {
    node = element(`h${block.level}`, "");
    appendAskInline(node, block.text);
  } else if (block.type === "table") {
    node = element("div", "ask-table-wrap");
    const table = document.createElement("table");
    const thead = document.createElement("thead");
    const headerRow = document.createElement("tr");
    askTableCells(block.headerLine).forEach((cell) => {
      const th = document.createElement("th");
      appendAskInline(th, cell, true);
      headerRow.appendChild(th);
    });
    thead.appendChild(headerRow);
    table.appendChild(thead);
    const tbody = document.createElement("tbody");
    block.bodyLines.forEach((rowLine) => {
      const row = document.createElement("tr");
      askTableCells(rowLine).forEach((cell) => {
        const td = document.createElement("td");
        appendAskInline(td, cell, true);
        row.appendChild(td);
      });
      tbody.appendChild(row);
    });
    table.appendChild(tbody);
    node.appendChild(table);
  } else if (block.type === "ul") {
    node = document.createElement("ul");
    block.items.forEach((itemText) => {
      const li = document.createElement("li");
      appendAskInline(li, itemText);
      li._askItemKey = itemText;
      node.appendChild(li);
    });
  } else if (block.type === "ol") {
    node = document.createElement("ol");
    if (block.startNum !== 1) {
      node.setAttribute("start", String(block.startNum));
    }
    block.items.forEach((itemObj) => {
      const li = document.createElement("li");
      if (itemObj.num !== null) {
        li.value = itemObj.num;
      }
      appendAskInline(li, itemObj.text);
      li._askItemKey = itemObj.key;
      node.appendChild(li);
    });
  } else {
    node = element("p");
    appendAskInline(node, block.text);
  }
  node._askBlockType = block.type;
  node._askBlockKey = block.key;
  return node;
}

function patchAskListNode(listNode, block) {
  const isOrdered = block.type === "ol";
  if (isOrdered) {
    if (block.startNum !== 1) {
      listNode.setAttribute("start", String(block.startNum));
    } else {
      listNode.removeAttribute("start");
    }
  }
  const items = block.items;
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const itemKey = isOrdered ? item.key : item;
    const itemText = isOrdered ? item.text : item;
    const existingLi = listNode.childNodes[i];
    if (existingLi && existingLi._askItemKey === itemKey) {
      continue;
    }
    if (existingLi && existingLi.nodeName === "LI") {
      if (isOrdered && item.num !== null) {
        existingLi.value = item.num;
      }
      patchAskInline(existingLi, itemText);
      existingLi._askItemKey = itemKey;
    } else {
      const newLi = document.createElement("li");
      if (isOrdered && item.num !== null) {
        newLi.value = item.num;
      }
      appendAskInline(newLi, itemText);
      newLi._askItemKey = itemKey;
      if (existingLi) {
        listNode.replaceChild(newLi, existingLi);
      } else {
        listNode.appendChild(newLi);
      }
    }
  }
  while (listNode.childNodes.length > items.length) {
    listNode.removeChild(listNode.lastChild);
  }
  listNode._askBlockKey = block.key;
}

function patchAskRichTextElement(root, value) {
  const text = String(value || "").replace(/\r/g, "");
  const previous = root._askParseCache;
  if (previous?.text === text) return root;
  let blocks;
  if (previous?.blocks.length && text.startsWith(previous.text)) {
    // The last partial line can still join the preceding list or table.
    const restart = Math.max(0, previous.blocks.length - 2);
    const stableBlocks = previous.blocks.slice(0, restart);
    const start = previous.blocks[restart].sourceStart;
    blocks = stableBlocks.concat(parseAskRichTextBlocks(text.slice(start), start));
  } else {
    blocks = parseAskRichTextBlocks(text);
  }
  root._askParseCache = { text, blocks };
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    const existingNode = root.childNodes[i];
    if (existingNode && existingNode._askBlockKey === block.key) {
      continue;
    }
    if (existingNode && existingNode._askBlockType === block.type) {
      if (block.type === "p") {
        patchAskInline(existingNode, block.text);
        existingNode._askBlockKey = block.key;
        continue;
      }
      if (block.type === "heading" && existingNode.nodeName === `H${block.level}`) {
        patchAskInline(existingNode, block.text);
        existingNode._askBlockKey = block.key;
        continue;
      }
      if (block.type === "ul" || block.type === "ol") {
        patchAskListNode(existingNode, block);
        continue;
      }
      if (block.type === "code") {
        const codeEl = existingNode.firstElementChild;
        if (codeEl && codeEl.nodeName === "CODE") {
          codeEl.className = block.language ? `language-${block.language}` : "";
          codeEl.textContent = block.codeText;
          existingNode._askBlockKey = block.key;
          continue;
        }
      }
    }
    const newNode = createAskBlockNode(block);
    if (existingNode) {
      root.replaceChild(newNode, existingNode);
    } else {
      root.appendChild(newNode);
    }
  }
  while (root.childNodes.length > blocks.length) {
    root.removeChild(root.lastChild);
  }
  return root;
}

function renderAskRichText(value) {
  const root = element("div", "ask-rich-text");
  return patchAskRichTextElement(root, value);
}

async function copyAskResponse(content, successMessage = null) {
  const isEn = getLanguage() === "en";
  const defaultMsg = isEn ? "Response copied to clipboard." : "Cavab kopyalandı.";
  try {
    await navigator.clipboard.writeText(content);
    showToast(successMessage || defaultMsg, "neutral");
    return true;
  } catch {
    showToast(isEn ? "Failed to copy response." : "Cavabı kopyalamaq mümkün olmadı.", "error");
    return false;
  }
}

async function recordLearningSignal(interactionId, signal) {
  if (!interactionId) return;
  try {
    await fetch(`/api/learning/signals/${encodeURIComponent(interactionId)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(signal),
      keepalive: true,
    });
  } catch (error) {
    console.warn("Learning signal could not be recorded:", error?.message || error);
  }
}

async function shareAskResponse(content) {
  const isEn = getLanguage() === "en";
  if (navigator.share) {
    try {
      await navigator.share({ title: isEn ? "Helmer response" : "Helmer cavabı", text: content });
      trackEvent("ask_response_shared", { method: "native" });
      return;
    } catch (error) {
      if (error?.name === "AbortError") return;
    }
  }
  const copied = await copyAskResponse(content, isEn ? "Response copied to share." : "Paylaşmaq üçün cavab kopyalandı.");
  if (copied) trackEvent("ask_response_shared", { method: "clipboard" });
}

function selectAskArtifactForEdit(artifact) {
  if (state.askLoading) return;
  state.askArtifactId = artifact.id;
  state.askArtifactName = artifact.filename;
  state.askPluginIds = [artifact.pluginId];
  state.mode = "ask";
  state.view = "home";
  syncMode(); syncNav();
  render();
  document.querySelector("#askInput")?.focus();
}

function retryAskRequest() {
  const retry = state.askRetry;
  if (!retry || state.askLoading) return;
  state.askMessages = state.askMessages.slice(0, retry.messageIndex);
  state.askPluginIds = retry.pluginIds;
  state.askArtifactId = retry.artifactId;
  submitAskMessage(retry.message, retry.file, { retryOperation: retry.operation });
}

function formatArtifactSize(size) {
  if (!size || isNaN(size)) return "24 KB";
  if (size >= 1048576) return `${(size / 1048576).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(size / 1024))} KB`;
}

function getArtifactFormatDisplayName(type) {
  const ext = String(type || "").toLowerCase().replace(/^\./, "");
  if (ext === "xlsx" || ext === "excel") return "Excel";
  if (ext === "docx" || ext === "word") return "Word";
  if (ext === "pptx" || ext === "powerpoint") return "PowerPoint";
  if (ext === "pdf") return "PDF";
  return ext.toUpperCase();
}

function getArtifactFormatIcon(type) {
  const ext = String(type || "").toLowerCase().replace(/^\./, "");
  if (ext === "xlsx" || ext === "excel") {
    return `<svg viewBox="0 0 48 48" width="16" height="16" fill="none" class="ask-artifact-menu-icon is-excel"><path fill="#185c37" d="M46 34v8c0 1.1-.9 2-2 2H14c-1.1 0-2-.9-2-2V23h16l1 1v10h17z"/><path fill="#21a366" d="M14 4h15l17 10v11H30l-1-1-17-10V6c0-1.1.9-2 2-2z"/><path fill="#33c481" d="M29 4h15c1.1 0 2 .9 2 2v8H29V4z"/><path fill="#107c41" d="M12 14h17v10H12zM29 24h17v10H29z"/><rect x="2" y="13" width="22" height="22" rx="3" fill="#0e6f3a"/><path fill="#ffffff" d="M6.75 31l4.53-7.02L7.13 17h3.34l2.69 5.41L16.08 17h3.07l-4.26 6.94L19.25 31h-3.26l-2.97-5.55L10.03 31H6.75z"/></svg>`;
  }
  if (ext === "docx" || ext === "word") {
    return `<svg viewBox="0 0 48 48" width="16" height="16" fill="none" class="ask-artifact-menu-icon is-word"><path fill="#41a5ee" d="M14 4c-1.1 0-2 .9-2 2v8l17 6 17-6V6c0-1.1-.9-2-2-2H14z"/><path fill="#2b7cd3" d="M12 14h34v10l-17 4-17-4V14z"/><path fill="#1650a7" d="M12 24h34v10l-17 4-17-4V24z"/><path fill="#103f91" d="M12 34v8c0 1.1.9 2 2 2h30c1.1 0 2-.9 2-2v-8H12z"/><rect x="2" y="13" width="22" height="22" rx="3" fill="#185abd"/><path fill="#ffffff" d="M18.53 31h-2.52l-2.94-9.66-3.08 9.66H7.47L4.67 17h2.52l1.96 9.8 2.94-9.8h2.1l2.8 9.8 1.96-9.8h2.38L18.53 31z"/></svg>`;
  }
  if (ext === "pptx" || ext === "powerpoint") {
    return `<svg viewBox="0 0 48 48" width="16" height="16" fill="none" class="ask-artifact-menu-icon is-powerpoint"><path fill="#ed6c47" d="M26 4A20 20 0 0 0 6 24l25.34 5.34L26 4z"/><path fill="#ff8f6b" d="M26 4a20 20 0 0 1 20 20l-10 6.8L26 24V4z"/><path fill="#d35230" d="M26 44a20 20 0 0 0 20-20H6a20 20 0 0 0 20 20z"/><rect x="2" y="13" width="22" height="22" rx="3" fill="#c43e1c"/><path fill="#ffffff" d="M8 17h5.02c1.28-.09 2.54.31 3.57 1.13.86.82 1.31 2.02 1.24 3.26.01.79-.2 1.77-.61 2.42-.42.72-1.03 1.3-1.74 1.66-.82.41-1.71.54-2.62.52H11v5H8V17zm3 3v3.98h1.83c.6 0 1.2-.14 1.62-.43.37-.28.55-.61.55-.98 0-1.06-.7-1.59-2.1-1.59H11z"/></svg>`;
  }
  // pdf or fallback
  return `<svg viewBox="0 0 32 32" width="16" height="16" fill="none" class="ask-artifact-menu-icon is-pdf"><rect width="32" height="32" rx="6" fill="#e5252a"/><path fill="#ffffff" d="M25.53 18.44c-1.5-1.6-5.59-.9-6.58-.8-1.4-1.4-2.39-2.99-2.79-3.59.5-1.5.9-3.19.9-4.79 0-1.5-.6-2.99-2.19-2.99-.6 0-1.1.3-1.4.8-.7 1.2-.4 3.59.7 6.08-.6 1.8-1.6 4.48-2.79 6.57-1.6.6-5.08 2.19-5.38 3.99-.1.5.1 1.1.5 1.4.4.4.9.5 1.4.5 2.09 0 4.19-2.89 5.69-5.49 1.2-.4 3.09-1 4.99-1.3 2.19 2 4.19 2.29 5.19 2.29 1.4 0 1.9-.6 2.09-1.1.26-.47.07-1.17-.33-1.57zM24.13 19.44c-.1.4-.6.8-1.5.6-1.1-.3-2.09-.8-2.89-1.5.7-.1 2.39-.3 3.59-.1.4.1.9.4.8 1zm-9.68-11.96c.1-.2.3-.3.5-.3.5 0 .6.6.6 1.1 0 1.2-.2 2.49-.6 3.59-.8-2.19-.7-3.79-.5-4.39zm-.1 11.26c.5-.9 1.1-2.59 1.3-3.19.5.9 1.4 1.9 1.8 2.39.1-.09-1.7.29-3.1.8zm-3.39 2.3c-1.39 2.19-2.69 3.59-3.49 3.59-.1 0-.3 0-.4-.1-.1-.2-.2-.4-.1-.6.1-.8 1.7-1.9 3.99-2.89z"/></svg>`;
}

function appendArtifactCards(content, message) {
  if (message.type === "research" || message.jobId) return;
  for (const artifact of message.artifacts || []) {
    const card = window.HelmerArtifacts?.artifactCard(artifact, selectAskArtifactForEdit);
    if (card) content.appendChild(card);
  }
}

function buildAskResponseMoreMenu(message, messageIndex, isEn) {
  const moreMenu = document.createElement("details");
  moreMenu.className = "ask-response-more-menu";
  const moreTrigger = element("summary", "ask-response-action ask-response-more-btn");
  moreTrigger.setAttribute("aria-label", isEn ? "More actions" : "Seçimlər");
  moreTrigger.title = isEn ? "More actions" : "Daha çox";
  moreTrigger.innerHTML = `
    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
      <circle cx="5" cy="12" r="2"></circle>
      <circle cx="12" cy="12" r="2"></circle>
      <circle cx="19" cy="12" r="2"></circle>
    </svg>
  `;

  const morePopover = element("div", "ask-response-more-popover");

  const msgModelInfo = getAskMessageModelInfo(message.model);
  const isResearch = message.type === "research" || Boolean(message.jobId);

  const modelRow = element("div", "ask-response-model-row");
  const modelLabel = element("span", "ask-response-model-label", isEn ? "Mode:" : "Rejim:");
  const modelName = element(
    "span",
    "ask-response-model-name",
    isResearch ? (isEn ? "Deep Research" : "Dərin Araşdırma") : msgModelInfo.displayName
  );
  modelRow.append(modelLabel, modelName);
  morePopover.appendChild(modelRow);

  const divider = element("div", "ask-response-popover-divider");
  morePopover.appendChild(divider);

  if (message.groundingMetadata) {
    const sourcesBtn = button("", "ask-response-popover-item ask-sources-btn", (event) => {
      event.preventDefault();
      event.stopPropagation();
      moreMenu.open = false;
      openGroundingSourcesModal(message.groundingMetadata);
    });
    sourcesBtn.type = "button";
    sourcesBtn.innerHTML = `
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10"></circle>
        <line x1="2" y1="12" x2="22" y2="12"></line>
        <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>
      </svg>
      <span>${isEn ? "Grounding Sources" : "Mənbələr"}</span>
    `;
    morePopover.appendChild(sourcesBtn);
  }

  const msgMeta = getAskMessageMeta(message);
  if (!isResearch && msgMeta.thinkingLevel !== "high" && messageIndex !== undefined) {
    const thinkDeeperBtn = button("", "ask-response-popover-item ask-think-deeper-btn", (event) => {
      event.preventDefault();
      event.stopPropagation();
      moreMenu.open = false;
      thinkDeeperWithHigh(messageIndex);
    });
    thinkDeeperBtn.type = "button";
    thinkDeeperBtn.innerHTML = `
      <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
        <path d="M12 2L14.4 8.6L21 11L14.4 13.4L12 20L9.6 13.4L3 11L9.6 8.6L12 2Z"/>
      </svg>
      <span>${isEn ? "Deep Strategic Reasoning" : "Daha dərindən düşün"}</span>
    `;
    morePopover.appendChild(thinkDeeperBtn);
  }

  // --- Download / Export Section ("{ad} kimi yüklə" / "Download as {name}") ---
  const hasArtifacts = Array.isArray(message.artifacts) && message.artifacts.length > 0;
  const isPreparing = isResearch && message.status === "completed" && message.generatingArtifacts;

  if (hasArtifacts || isPreparing) {
    const exportDivider = element("div", "ask-response-popover-divider");
    morePopover.appendChild(exportDivider);

    if (hasArtifacts) {
      for (const artifact of message.artifacts) {
        const ext = String(artifact.type || artifact.name?.split(".").pop() || "docx").toLowerCase().replace(/^\./, "");
        const formatName = getArtifactFormatDisplayName(ext);
        const labelText = isEn ? `Download as ${formatName}` : `${formatName} kimi yüklə`;
        const sizeStr = formatArtifactSize(artifact.size);

        const itemLink = document.createElement("a");
        itemLink.className = "ask-response-popover-item ask-artifact-download-item";
        const safeId = /^[0-9a-f-]{36}$/i.test(String(artifact.id || "")) ? artifact.id : "";
        const safeVer = Math.max(1, parseInt(artifact.version, 10) || 1);
        const rawDownloadUrl = typeof artifact.downloadUrl === "string" ? artifact.downloadUrl.trim() : "";
        const isSafeDownloadUrl = /^\/api\/artifacts\/[0-9a-f-]{36}\//i.test(rawDownloadUrl) || /^https:\/\//i.test(rawDownloadUrl);
        itemLink.href = isSafeDownloadUrl ? rawDownloadUrl : (safeId ? `/api/artifacts/${safeId}/versions/${safeVer}/download` : "#");
        itemLink.setAttribute("download", artifact.name || `Helmer_Artifact.${ext}`);
        itemLink.title = `${artifact.title || artifact.name || formatName} (${sizeStr})`;
        itemLink.innerHTML = `${getArtifactFormatIcon(ext)}<span>${escapeHtml(labelText)}</span>`;
        itemLink.addEventListener("click", () => {
          moreMenu.open = false;
        });
        morePopover.appendChild(itemLink);
      }
    } else if (isPreparing) {
      const preparingItem = element("div", "ask-response-popover-item ask-artifact-download-item is-preparing");
      preparingItem.innerHTML = `<span class="ask-artifact-spinner"></span> <span>${isEn ? "Preparing documents..." : "Hazırlanır..."}</span>`;
      morePopover.appendChild(preparingItem);
    }
  }

  const reportBtn = button("", "ask-response-popover-item ask-report-issue-btn", (event) => {
    event.preventDefault();
    event.stopPropagation();
    moreMenu.open = false;
    openLegalReportModal({ messageContent: message.content, model: isResearch ? "Deep Research" : msgModelInfo.displayName });
  });
  reportBtn.type = "button";
  reportBtn.innerHTML = `
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="12" cy="12" r="10"></circle>
      <line x1="12" y1="8" x2="12" y2="12"></line>
      <line x1="12" y1="16" x2="12.01" y2="16"></line>
    </svg>
    <span>${isEn ? "Report Issue" : "Hüquqi problem bildir"}</span>
  `;
  morePopover.appendChild(reportBtn);

  moreMenu.append(moreTrigger, morePopover);

  const closeMoreMenu = (event) => {
    const path = event.composedPath ? event.composedPath() : [];
    if (path.includes(moreMenu) || moreMenu.contains(event.target)) return;
    moreMenu.open = false;
  };
  moreMenu.addEventListener("toggle", () => {
    if (moreMenu.open) {
      setTimeout(() => {
        document.addEventListener("pointerdown", closeMoreMenu);
      }, 0);
    } else {
      document.removeEventListener("pointerdown", closeMoreMenu);
    }
  });

  return moreMenu;
}

function createAskMessageActions(message, messageIndex, isEn) {
  const actions = element("div", "ask-message-actions");
  actions.setAttribute("aria-label", isEn ? "Response actions" : "Cavab əməliyyatları");

  const copy = button("", "ask-response-action ask-response-copy-btn", async () => {
    const ok = await copyAskResponse(message.content);
    if (ok) {
      recordLearningSignal(message.interactionId, { copied: true });
      copy.classList.add("is-copied");
      copy.title = isEn ? "Copied" : "Kopyalandı";
      copy.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
      setTimeout(() => {
        copy.classList.remove("is-copied");
        copy.title = isEn ? "Copy" : "Kopyala";
        copy.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>';
      }, 1800);
    }
  });
  copy.type = "button";
  copy.setAttribute("aria-label", isEn ? "Copy response" : "Cavabı kopyala");
  copy.title = isEn ? "Copy" : "Kopyala";
  copy.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>';

  actions.append(copy);

  let positive;
  let negative;
  positive = button("", `ask-response-action ask-response-positive-btn${message.feedback === "positive" ? " is-selected" : ""}`, () => {
    const nextFeedback = message.feedback === "positive" ? null : "positive";
    message.feedback = nextFeedback;
    if (nextFeedback) {
      recordLearningSignal(message.interactionId, { explicitRating: "positive", accepted: true });
    }
    positive.classList.toggle("is-selected", nextFeedback === "positive");
    negative?.classList.remove("is-selected");
  });
  positive.type = "button";
  positive.title = isEn ? "Helpful response" : "Cavabı bəyən";
  positive.setAttribute("aria-label", isEn ? "Helpful response" : "Cavabı bəyən");
  positive.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/></svg>';

  negative = button("", `ask-response-action ask-response-negative-btn${message.feedback === "negative" ? " is-selected" : ""}`, () => {
    const nextFeedback = message.feedback === "negative" ? null : "negative";
    message.feedback = nextFeedback;
    if (nextFeedback) {
      recordLearningSignal(message.interactionId, { explicitRating: "negative" });
    }
    negative.classList.toggle("is-selected", nextFeedback === "negative");
    positive?.classList.remove("is-selected");
  });
  negative.type = "button";
  negative.title = isEn ? "Unhelpful response" : "Cavabı bəyənmə";
  negative.setAttribute("aria-label", isEn ? "Unhelpful response" : "Cavabı bəyənmə");
  negative.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round"><path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7-13h3a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-3"/></svg>';
  actions.append(positive, negative);

  actions.appendChild(buildAskResponseMoreMenu(message, messageIndex, isEn));
  return actions;
}

function renderAsk() {
  const isEn = getLanguage() === "en";
  const isAuto = state.askModel === "auto" || !state.askModel;
  workspace.classList.add("workspace-ask");
  const isChatActive = Boolean(state.askMessages.length || state.askLoading);
  workspace.classList.toggle("has-messages", isChatActive);
  workspace.classList.toggle("is-empty", !isChatActive);

  const selectedStrategy = state.savedStrategies.find((strategy) => strategy.id === state.askStrategyId) || null;
  const selectedTask = state.plannerTasks.find((task) => task.id === state.askTaskId) || null;
  if (state.askTaskId && !selectedTask) state.askTaskId = "";
  const shell = element("section", `ask-shell${isChatActive ? " has-messages" : " is-empty"}`);
  shell.setAttribute("aria-label", "Ask");
  const thread = element("div", "ask-thread");

  if (!state.askMessages.length) {
    const intro = element("div", "ask-intro");
    const title = element("h1", "ask-title", getAskCta());
    intro.append(title);
    thread.appendChild(intro);
  } else {
    state.askMessages.forEach((message, messageIndex) => {
      const isFreshResponse = message.role === "assistant" && freshAskResponses.has(message);
      const isStreamingMsg = Boolean(message.isStreaming);
      const isResearch = message.type === "research";
      const row = element("article", `ask-message ask-message-${message.role}${isFreshResponse ? " is-fresh" : ""}${isStreamingMsg ? " is-streaming" : ""}${isResearch ? " ask-message-research" : ""}`);
      const content = element("div", "ask-message-content");
      if (message.role === "assistant") {
        if (isResearch) {
          renderAskResearchMessageContent(content, message, messageIndex, isEn);
        } else if (isStreamingMsg && !message.content) {
          const isSearching = message.status === "searching";
          const showLabel = isSearching || isAskThinkingActive(message);
          const thinking = element("div", `ask-thinking${isSearching ? " is-searching" : ""}${showLabel ? " has-label" : " is-default"}`);
          thinking.setAttribute("role", "status");
          thinking.setAttribute("aria-live", "polite");
          const iconWrap = element("span", "ask-thinking-icon");
          iconWrap.innerHTML = askThinkingIcon(isSearching);
          thinking.appendChild(iconWrap);
          if (showLabel) {
            const thinkingLabel = element("span", "ask-thinking-label", askThinkingLabel(message, isEn));
            thinking.appendChild(thinkingLabel);
          }
          content.appendChild(thinking);
        } else {
          content.appendChild(renderAskRichText(message.content));
          if (message.groundingMetadata) {
            const chips = renderAskSourceChips(message.groundingMetadata);
            if (chips) content.appendChild(chips);
          }
          if (
            Object.values(GUEST_RESTRICTION_NOTICES).includes(message.content) ||
            (typeof GUEST_RESTRICTION_NOTICES_EN !== "undefined" && Object.values(GUEST_RESTRICTION_NOTICES_EN).includes(message.content))
          ) {
            const ctaWrap = element("div", "ask-restriction-cta-wrap");
            const ctaBtn = element("a", "ask-restriction-cta-btn", isEn ? "Sign Up" : "Qeydiyyatdan keç");
            ctaBtn.href = `/signup?returnTo=${encodeURIComponent(location.pathname + location.search + location.hash)}`;
            ctaWrap.appendChild(ctaBtn);
            content.appendChild(ctaWrap);
          }
        }

        if (!isStreamingMsg) appendArtifactCards(content, message);
        if (!isStreamingMsg && message.content) {
          content.appendChild(createAskMessageActions(message, messageIndex, isEn));
          if (isFreshResponse) {
            freshAskResponses.delete(message);
          }
        }
      } else {
        if (message.pluginIds?.length) content.appendChild(element("span", "ask-message-context", message.pluginIds.map(id => `@${id}`).join(" · ")));
        if (message.file) {
          const fileBadge = element("div", "ask-message-attachment");
          const iconWrap = element("span", "ask-message-attachment-icon");
          iconWrap.innerHTML = getFileIconSvg(message.file.mimeType || message.file.type, message.file.name);
          const meta = element("div", "ask-message-attachment-meta");
          meta.append(
            element("span", "ask-message-attachment-name", message.file.name || (isEn ? "File" : "Fayl")),
            element("span", "ask-message-attachment-size", formatFileSize(message.file.size))
          );
          fileBadge.append(iconWrap, meta);
          content.appendChild(fileBadge);
        }
        if (message.content) {
          content.appendChild(element("div", "ask-message-text", message.content));
        }
        if (message.strategyTitle) {
          content.appendChild(element("span", "ask-message-context", `${isEn ? "Strategy" : "Strategiya"}: ${message.strategyTitle}`));
        }
        if (message.taskTitle) {
          content.appendChild(element("span", "ask-message-context", `${isEn ? "Task" : "Tapşırıq"}: ${message.taskTitle}`));
        }
      }
      row.appendChild(content);
      thread.appendChild(row);
    });
  }

  if (state.askError) {
    const isGuestLimit = state.askError.includes("Qonaq mesaj limitiniz bitdi") || state.askError.includes("GUEST_DAILY_LIMIT");
    if (isGuestLimit) {
      state.guestQuotaVersion += 1;
      state.remainingGuestMessages = 0;
      state.askError = "";
    } else {
      const error = element("div", "ask-error");
      error.setAttribute("role", "alert");

      const iconWrap = element("div", "ask-error-icon");
      iconWrap.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>';

      const errorBody = element("div", "ask-error-body");
      const title = element("div", "ask-error-title", state.askError);
      const hint = element("div", "ask-error-hint", navigator.onLine ? (isEn ? "Please try again in a few seconds." : "Bir neçə saniyə sonra yenidən yoxla.") : (isEn ? "Check your internet connection." : "İnternet bağlantını yoxla."));
      errorBody.append(title, hint);

      if (state.askRetry) {
        const retryBtn = button("", "ask-error-retry-btn", retryAskRequest);
        retryBtn.type = "button";
        retryBtn.innerHTML = `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/></svg><span>${isEn ? "Retry" : "Yenidən cəhd et"}</span>`;
        errorBody.appendChild(retryBtn);
      }

      const dismissBtn = button("", "ask-error-dismiss", (e) => {
        e.preventDefault();
        state.askError = "";
        error.remove();
      });
      dismissBtn.type = "button";
      dismissBtn.title = isEn ? "Dismiss" : "Bağla";
      dismissBtn.setAttribute("aria-label", isEn ? "Dismiss" : "Bağla");
      dismissBtn.innerHTML = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';

      error.append(iconWrap, errorBody, dismissBtn);
      thread.appendChild(error);
    }
  }

  const composerArea = element("div", "ask-composer-area");
  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.id = "askFileInput";
  fileInput.className = "sr-only";
  fileInput.accept = ".pdf,.png,.jpg,.jpeg,.webp,.heic,.heif,.gif,.txt,.md,.csv,.json,.docx,.doc,.xlsx,.xls,.html,.js,.ts,.py,.css";

  const handleFileSelection = async (file) => {
    if (!file) return;
    if (!state.currentUser) {
      if (fileInput) {
        try { fileInput.value = ""; } catch { }
      }
      if (imageFileInput) {
        try { imageFileInput.value = ""; } catch { }
      }
      openGuestRestrictionModal(GUEST_RESTRICTION_NOTICES.file);
      return;
    }
    if (input && typeof input.value === "string") {
      state.askDraft = input.value;
    }
    state.askError = "";
    try {
      const fileData = await readUploadedFileAsData(file);
      state.askPendingFile = fileData;
      state.askModel = "auto";
      state.askError = "";
    } catch (err) {
      console.error("Failed to read attached file:", err);
      state.askError = err.message || (isEn ? "Error reading file." : "Fayl oxunarkən xəta baş verdi.");
    } finally {
      if (fileInput) {
        try { fileInput.value = ""; } catch { }
      }
      render();
    }
  };

  fileInput.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    if (file) handleFileSelection(file);
  });

  const imageFileInput = document.createElement("input");
  imageFileInput.type = "file";
  imageFileInput.id = "askImageFileInput";
  imageFileInput.className = "sr-only";
  imageFileInput.accept = "image/*";
  imageFileInput.addEventListener("change", () => {
    const file = imageFileInput.files?.[0];
    if (file) handleFileSelection(file);
  });

  const contextMenu = document.createElement("details");
  contextMenu.className = `ask-context-menu${selectedStrategy || selectedTask ? " has-selection" : ""}`;
  const contextTrigger = element("summary", "ask-context-trigger");
  contextTrigger.setAttribute("aria-label", isEn ? "Select context" : "Kontekst seç");
  contextTrigger.title = selectedStrategy || selectedTask ? `${isEn ? "Context" : "Kontekst"}: ${[selectedStrategy?.title, selectedTask?.text].filter(Boolean).join(" · ")}` : (isEn ? "Select context" : "Kontekst seç");
  contextTrigger.appendChild(element("span", "ask-context-plus", "+"));

  contextTrigger.addEventListener("click", (event) => {
    if (window.innerWidth <= 767) {
      event.preventDefault();
      event.stopPropagation();
      openMobileContextSheet({
        onFileSelect: () => fileInput.click(),
        onPhotoSelect: () => imageFileInput.click(),
        onSelectStrategy: (stratId) => {
          state.askStrategyId = stratId;
          state.askPromptHintStrategyId = stratId;
          render();
        },
        onSelectTask: (taskId) => {
          state.askTaskId = taskId;
          render();
        },
        onSelectPrompt: (promptText) => {
          appendPresetPrompt(input, promptText, resizeInput);
        },
        onClearContext: () => {
          state.askStrategyId = "";
          state.askTaskId = "";
          state.askPromptHintStrategyId = "";
          render();
        },
        onDeepResearch: () => {
          if (!state.askPluginIds) state.askPluginIds = [];
          if (!state.askPluginIds.includes("deep-research")) {
            state.askPluginIds = [...state.askPluginIds.filter(id => !["word", "excel", "powerpoint", "pdf"].includes(id)), "deep-research"];
          }
          const isEnLocale = getLanguage() === "en";
          const defaultPrompt = isEnLocale
            ? "Prepare a comprehensive Deep Research report analyzing my market, target customer segments, and competitors. Identify key market shifts, competitor weaknesses, and highest-potential strategic opportunities."
            : "Biznesim üçün bazar və rəqib analizi üzrə ətraflı dərin araşdırma hesabatı hazırla. Əsas bazar tendensiyalarını, rəqiblərin boşluqlarını və ən yüksək təsirli inkişaf imkanlarını müəyyən et.";
          const existingText = (input ? input.value : state.askDraft || "").trim();
          const targetPrompt = existingText || defaultPrompt;
          state.askDraft = targetPrompt;
          render();
          const activeInput = document.querySelector("#askInput");
          if (activeInput) {
            activeInput.value = targetPrompt;
            activeInput.focus();
            activeInput.setSelectionRange(targetPrompt.length, targetPrompt.length);
            activeInput.dispatchEvent(new Event("input", { bubbles: true }));
          }
        },
      });
    }
  });
  const isDesktop = typeof window !== "undefined" && window.innerWidth >= 768;
  const contextPopover = element("div", `ask-context-popover${!isChatActive && isDesktop ? " is-downwards" : ""}`);
  const activeTasks = state.plannerTasks.filter((task) => !task.completed);
  let contextPane = "main";
  let input;
  let resizeInput = () => { };
  const drawContextMenu = () => {
    contextPopover.replaceChildren();
    if (!isChatActive && typeof window !== "undefined" && window.innerWidth >= 768) {
      contextPopover.classList.add("is-downwards");
    } else {
      contextPopover.classList.remove("is-downwards");
    }
    if (contextPane === "main") {
      contextPopover.appendChild(element("strong", "ask-context-menu-heading", isEn ? "Add context" : "Kontekst əlavə et"));
      contextPopover.appendChild(element("div", "ask-context-menu-divider"));

      // 1. File Option (Fayl əlavə et) -> Direct action, no chevron
      const fileOption = button("", "ask-context-menu-option group ask-context-menu-option-file", (event) => {
        event.preventDefault();
        event.stopPropagation();
        contextMenu.open = false;
        if (!state.currentUser) {
          openGuestRestrictionModal(GUEST_RESTRICTION_NOTICES.file);
          return;
        }
        fileInput.click();
      });
      fileOption.type = "button";
      const fileMain = element("div", "ask-context-menu-option-main");
      const fileLeading = element("span", "ask-context-menu-option-icon");
      fileLeading.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>';
      const fileCopy = element("span", "ask-context-menu-option-copy");
      const fileTitle = element("strong", "");
      fileTitle.append(element("span", "", isEn ? "Attach file" : "Fayl əlavə et"));
      if (!state.currentUser) {
        const lock = element("span", "guest-inline-lock");
        lock.innerHTML = getGuestLockIconSvg(12);
        fileTitle.appendChild(lock);
      }
      fileCopy.append(
        fileTitle,
        element("small", "", isEn ? "Upload PDF, image or document" : "PDF, şəkil və ya sənəd yüklə")
      );
      fileMain.append(fileLeading, fileCopy);
      fileOption.appendChild(fileMain);
      contextPopover.appendChild(fileOption);

      const addSubmenuOption = (title, description, pane, iconSvg, isLocked = false) => {
        const btn = button("", "ask-context-menu-option group", (event) => {
          event.preventDefault();
          event.stopPropagation();
          if (pane === "strategies" && !state.currentUser) {
            contextMenu.open = false;
            openGuestRestrictionModal(GUEST_RESTRICTION_NOTICES.strategy);
            return;
          }
          if (pane === "tasks" && !state.currentUser) {
            contextMenu.open = false;
            openGuestRestrictionModal(GUEST_RESTRICTION_NOTICES.planner);
            return;
          }
          contextMenu.open = true;
          contextPane = pane;
          drawContextMenu();
        });
        btn.type = "button";
        const main = element("div", "ask-context-menu-option-main");
        const icon = element("span", "ask-context-menu-option-icon");
        icon.innerHTML = iconSvg;
        const copy = element("span", "ask-context-menu-option-copy");
        const titleEl = element("strong", "");
        titleEl.append(element("span", "", title));
        if (isLocked) {
          const lock = element("span", "guest-inline-lock");
          lock.innerHTML = getGuestLockIconSvg(12);
          titleEl.appendChild(lock);
        }
        copy.append(
          titleEl,
          element("small", "", description)
        );
        main.append(icon, copy);

        const chevron = element("span", "ask-context-menu-chevron");
        chevron.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>';

        btn.append(main, chevron);
        contextPopover.appendChild(btn);
      };

      // 2. Strategiyalarım (Compass)
      addSubmenuOption(
        isEn ? "My Strategies" : "Strategiyalarım",
        isEn ? "Discuss a saved strategy" : "Yadda saxlanılan strategiyanı müzakirə et",
        "strategies",
        '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/></svg>',
        !state.currentUser
      );

      // 3. Planlaşdırılanlar (CheckSquare)
      addSubmenuOption(
        isEn ? "Planner Tasks" : "Planlaşdırılanlar",
        isEn ? "Discuss an active task" : "Aktiv taskı kontekst kimi seç",
        "tasks",
        '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 11 3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>',
        !state.currentUser
      );

      // 4. Hazır sual (MessageSquareText)
      const promptTitle = selectedStrategy
        ? (isEn ? "Preset prompts" : "Hazır sual seç")
        : (isEn ? "Preset Prompts" : "Hazır sual");
      const promptDesc = selectedStrategy
        ? (isEn ? "Select a prompt aligned with your goal" : "Strategiyaya uyğun hazır prompt seç")
        : (isEn ? "Select a starter prompt" : "Başlamaq üçün hazır prompt seç");
      addSubmenuOption(
        promptTitle,
        promptDesc,
        "prompts",
        '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="M13 8H7"/><path d="M17 12H7"/></svg>'
      );

      // 5. Clear Context (if selected)
      if (selectedStrategy || selectedTask) {
        contextPopover.appendChild(element("div", "ask-context-menu-divider"));
        const clearBtn = button("", "ask-context-clear group", (event) => {
          event.preventDefault();
          state.askStrategyId = "";
          state.askTaskId = "";
          state.askPromptHintStrategyId = "";
          contextMenu.open = false;
          render();
        });
        clearBtn.type = "button";
        const clearMain = element("div", "ask-context-menu-option-main");
        const clearIcon = element("span", "ask-context-menu-option-icon ask-context-clear-icon");
        clearIcon.innerHTML = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>';
        const clearCopy = element("span", "ask-context-menu-option-copy");
        clearCopy.append(element("strong", "", isEn ? "Delete context" : "Konteksti sil"));
        clearMain.append(clearIcon, clearCopy);
        clearBtn.appendChild(clearMain);
        contextPopover.appendChild(clearBtn);
      }
      return;
    }
    if (contextPane === "prompts") {
      addPresetPromptPane(contextPopover, "ask", (prompt) => {
        contextMenu.open = false;
        appendPresetPrompt(input, prompt, resizeInput);
      }, () => {
        contextPane = "main";
        drawContextMenu();
      });
      return;
    }
    const isStrategy = contextPane === "strategies";
    const back = button("", "ask-context-menu-back", (event) => {
      event.preventDefault();
      event.stopPropagation();
      contextMenu.open = true;
      contextPane = "main";
      drawContextMenu();
    });
    back.type = "button";
    back.setAttribute("aria-label", isEn ? "Back to context menu" : "Kontekst menyusuna qayıt");
    back.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>';
    const subHeader = element("div", "ask-context-menu-subheader");
    subHeader.append(back, element("strong", "ask-context-menu-heading", isStrategy ? (isEn ? "Strategies" : "Strategiyalar") : (isEn ? "Tasks" : "Planlaşdırılanlar")));
    contextPopover.appendChild(subHeader);
    contextPopover.appendChild(element("div", "ask-context-menu-divider"));
    const list = element("div", "ask-context-list");
    const entries = isStrategy ? state.savedStrategies : activeTasks;
    if (!entries.length) {
      list.appendChild(element("div", "ask-context-empty", isStrategy ? (isEn ? "Archive is currently empty." : "Arxiv hələ boşdur.") : (isEn ? "No active tasks in Planner." : "Aktiv planlaşdırılan task yoxdur.")));
    } else entries.forEach((entry) => {
      const selected = isStrategy ? entry.id === state.askStrategyId : entry.id === state.askTaskId;
      const item = button("", `ask-context-item${selected ? " is-selected" : ""}`);
      item.type = "button";
      item.append(element("span", "", isStrategy ? entry.title : entry.text), element("small", "", selected ? (isEn ? "Selected" : "Seçilib") : (isStrategy ? formatDate(entry.updatedAt) : entry.groupLabel || (isEn ? "General" : "Ümumi"))));
      item.addEventListener("click", () => {
        if (isStrategy) {
          state.askStrategyId = entry.id;
          state.askPromptHintStrategyId = entry.id;
        } else state.askTaskId = entry.id;
        contextMenu.open = false;
        render();
      });
      list.appendChild(item);
    });
    contextPopover.appendChild(list);
  };
  drawContextMenu();
  const contextSlot = element("div", "ask-context-slot");
  const showPromptHint = selectedStrategy && state.askPromptHintStrategyId === selectedStrategy.id;
  if (showPromptHint) {
    const promptCta = button(isEn ? "Choose prompt" : "Hazır prompt seç", "ask-preset-prompt-cta", () => {
      promptCta.classList.add("is-hidden");
      state.askPromptHintStrategyId = "";
      contextPane = "prompts";
      drawContextMenu();
      contextMenu.open = true;
    });
    promptCta.setAttribute("aria-label", isEn ? "Select prompt" : "Hazır sual seç");
    promptCta.insertAdjacentHTML("afterbegin", '<svg class="ask-preset-prompt-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M8 13V3M4 7l4-4 4 4" /></svg>');
    contextMenu.append(contextTrigger, contextPopover);
    contextSlot.append(contextMenu, promptCta);
    setTimeout(() => {
      promptCta.classList.add("is-hidden");
      state.askPromptHintStrategyId = "";
    }, 3000);
  } else {
    contextMenu.append(contextTrigger, contextPopover);
    contextSlot.appendChild(contextMenu);
  }
  const closeContextMenuOnPointer = (event) => {
    const path = event.composedPath ? event.composedPath() : [];
    if (path.includes(contextMenu) || contextMenu.contains(event.target)) return;
    contextMenu.open = false;
  };
  const closeContextMenuOnKeyDown = (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      contextMenu.open = false;
      contextTrigger.focus?.();
    }
  };
  contextMenu.addEventListener("toggle", () => {
    if (contextMenu.open) {
      setTimeout(() => {
        document.addEventListener("pointerdown", closeContextMenuOnPointer);
        document.addEventListener("keydown", closeContextMenuOnKeyDown);
      }, 0);
    } else {
      document.removeEventListener("pointerdown", closeContextMenuOnPointer);
      document.removeEventListener("keydown", closeContextMenuOnKeyDown);
      contextPane = "main";
      drawContextMenu();
    }
  });

  const form = element("form", "ask-composer");
  const label = element("label", "sr-only", isEn ? "Ask query" : "Ask sualı");
  label.htmlFor = "askInput";
  input = element("textarea", "ask-input");
  input.id = "askInput";
  input.name = "message";
  input.rows = 1;
  input.maxLength = 8000;
  input.disabled = state.askLoading;
  if (state.askDraft) {
    input.value = state.askDraft;
  }

  const updateAskPlaceholder = () => {
    stopAskPlaceholderAnimation();
    if (!state.currentUser && state.remainingGuestMessages === 0) {
      input.placeholder = isEn ? "Guest limit reached. Sign up to continue…" : "Qonaq mesaj limitiniz bitdi. Davam etmək üçün qeydiyyatdan keçin…";
      return;
    }
    const baseText = isEn ? "Ask Helmer anything" : "Helmer-dən soruş";
    if (state.askPendingFile) {
      input.placeholder = isEn ? "Ask a question about this file…" : "Fayl haqqında sualını yaz…";
      return;
    }
    if (isChatActive) {
      input.placeholder = isEn ? "Reply to Helmer" : "Helmer-dən soruş";
      return;
    }
    if (!state.currentUser) {
      input.placeholder = baseText;
      return;
    }

    const mentionSuffix = isEn ? " or @ to mention" : " və ya @ işarələ";
    let isMentionVisible = false;
    let charIndex = 0;
    let isDeleting = false;
    input.placeholder = baseText;

    const tick = () => {
      if (!input.isConnected || state.askPendingFile) return;
      if (!isMentionVisible) {
        // Typing mentionSuffix
        if (charIndex < mentionSuffix.length) {
          charIndex += 1;
          input.placeholder = baseText + mentionSuffix.slice(0, charIndex);
          askPlaceholderTimer = setTimeout(tick, 45);
        } else {
          isMentionVisible = true;
          // Hold mention for 2.8 seconds
          askPlaceholderTimer = setTimeout(tick, 2800);
        }
      } else {
        // Deleting mentionSuffix
        if (charIndex > 0) {
          charIndex -= 1;
          input.placeholder = baseText + mentionSuffix.slice(0, charIndex);
          askPlaceholderTimer = setTimeout(tick, 25);
        } else {
          isMentionVisible = false;
          input.placeholder = baseText;
          // Hold baseText for 3.5 seconds
          askPlaceholderTimer = setTimeout(tick, 3500);
        }
      }
    };

    askPlaceholderTimer = setTimeout(tick, 2500);
  };
  updateAskPlaceholder();

  const submit = button("", "ask-submit");
  const isGenerating = Boolean(state.askLoading);
  submit.classList.toggle("is-stop", isGenerating);
  submit.classList.toggle("is-generating", isGenerating);

  if (isGenerating) {
    submit.type = "button";
    submit.disabled = false;
    submit.setAttribute("aria-label", isEn ? "Stop generating" : "Dayandır");
    submit.title = isEn ? "Stop generating" : "Dayandır";
    submit.appendChild(createAskStopIcon());
  } else {
    submit.type = "submit";
    submit.disabled = true;
    submit.setAttribute("aria-label", isEn ? "Send question" : "Sualı göndər");
    submit.title = isEn ? "Send question" : "Sualı göndər";
    submit.appendChild(createAskSendIcon());
  }

  const composerLeading = element("div", "ask-composer-leading");
  composerLeading.append(contextSlot, fileInput, imageFileInput);

  const composerBody = element("div", "ask-composer-body");
  if (state.askPendingFile) {
    const pendingChip = element("div", "ask-pending-file");
    const chipIcon = element("span", `ask-pending-file-icon${state.askPendingFile.type.includes("pdf") ? " is-pdf" : state.askPendingFile.type.startsWith("image/") ? " is-image" : ""}`);
    chipIcon.innerHTML = getFileIconSvg(state.askPendingFile.mimeType || state.askPendingFile.type, state.askPendingFile.name);
    const chipMeta = element("div", "ask-pending-file-meta");
    chipMeta.append(
      element("span", "ask-pending-file-name", state.askPendingFile.name),
      element("span", "ask-pending-file-size", `${formatFileSize(state.askPendingFile.size)}`)
    );
    const chipRemove = button("", "ask-pending-file-remove", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (input && typeof input.value === "string") {
        state.askDraft = input.value;
      }
      state.askPendingFile = null;
      render();
    });
    chipRemove.type = "button";
    chipRemove.setAttribute("aria-label", isEn ? "Remove file" : "Faylı sil");
    chipRemove.title = isEn ? "Remove file" : "Faylı sil";
    chipRemove.innerHTML = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>';
    pendingChip.append(chipIcon, chipMeta, chipRemove);
    composerBody.appendChild(pendingChip);
  }
  if (selectedStrategy || selectedTask) {
    const contextChip = element("div", "ask-active-context-chip");
    contextChip.title = selectedStrategy?.title || selectedTask?.text || "Context Selected";
    const chipIcon = element("span", "ask-active-context-icon");
    chipIcon.innerHTML = `
      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1-2.5-2.5Z"/>
        <path d="M6 6h10"/>
        <path d="M6 10h10"/>
      </svg>
    `;
    const chipLabel = element(
      "span",
      "ask-active-context-label",
      "Context Selected"
    );
    const chipRemove = button("", "ask-active-context-remove", (e) => {
      e.preventDefault();
      e.stopPropagation();
      state.askStrategyId = "";
      state.askTaskId = "";
      state.askPromptHintStrategyId = "";
      render();
    });
    chipRemove.type = "button";
    chipRemove.setAttribute("aria-label", isEn ? "Remove context" : "Konteksti sil");
    chipRemove.title = isEn ? "Remove context" : "Konteksti sil";
    chipRemove.innerHTML = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>';
    contextChip.append(chipIcon, chipLabel, chipRemove);
    composerBody.appendChild(contextChip);
  }
  composerBody.append(label, input);
  if (state.currentUser) {
    window.HelmerArtifacts?.attachComposer({ input, body: composerBody, getSelection: () => state.askPluginIds || [], setSelection: ids => { state.askPluginIds = ids; } });
  }
  if (state.askArtifactId) {
    const editContext = element("div", "ask-artifact-edit-context", `${isEn ? "Editing latest version" : "Son versiyanı redaktə et"}: ${state.askArtifactName}`);
    const remove = button("×", "ask-plugin-token-remove", () => { state.askArtifactId = null; state.askArtifactName = ""; render(); });
    remove.type = "button"; remove.setAttribute("aria-label", isEn ? "Remove artifact context" : "Artifact kontekstini sil");
    editContext.append(remove); composerBody.prepend(editContext);
  }

  const composerActions = element("div", "ask-composer-actions");
  const modelSelector = createAskModelSelector(isEn);
  composerActions.append(modelSelector, submit);

  form.append(composerLeading, composerBody, composerActions);

  // Drag & drop file upload on composer
  form.addEventListener("dragover", (e) => {
    e.preventDefault();
    form.classList.add("is-dragover");
  });
  form.addEventListener("dragleave", (e) => {
    if (!form.contains(e.relatedTarget)) {
      form.classList.remove("is-dragover");
    }
  });
  form.addEventListener("drop", (e) => {
    e.preventDefault();
    form.classList.remove("is-dragover");
    const file = e.dataTransfer?.files?.[0];
    if (file) handleFileSelection(file);
  });

  // Paste image / file from clipboard
  input.addEventListener("paste", (e) => {
    const items = e.clipboardData?.items;
    if (items) {
      for (const item of items) {
        if (item.kind === "file") {
          const file = item.getAsFile();
          if (file) {
            handleFileSelection(file);
            break;
          }
        }
      }
    }
  });

  const helper = element("div", "ask-composer-meta");
  const suggestionWrap = element("div", "ask-thinking-suggestion-wrap");
  const suggestionBtn = button("", "ask-thinking-suggestion-btn", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!state.currentUser) {
      openGuestRestrictionModal(GUEST_RESTRICTION_NOTICES.thinking);
      return;
    }
    state.askThinkingLevel = "high";
    currentAskThinking = "high";
    state.askThinkingEnabled = true;
    try { localStorage.setItem("helmer_ask_thinking_level", "high"); } catch { }
    try { localStorage.setItem("helmer_ask_thinking_enabled", "true"); } catch { }
    suggestionWrap.style.display = "none";
    render();
  });
  suggestionBtn.type = "button";
  suggestionBtn.innerHTML = `<span class="ask-thinking-suggestion-spark">✦</span><span>${isEn ? "Want to switch to High thinking level?" : "High düşünmə səviyyəsinə keçmək istəyirsən?"}</span>`;
  suggestionWrap.style.display = "none";
  suggestionWrap.appendChild(suggestionBtn);

  const disclaimer = element("p", "ask-disclaimer", isEn ? "Helmer can make mistakes." : "Helmer səhv edə bilər.");
  helper.append(suggestionWrap, disclaimer);

  const guestLimitCard = createAskGuestLimitCard(isEn);
  if (guestLimitCard) {
    composerArea.append(guestLimitCard);
  }

  const guideCards = (!isChatActive && !selectedStrategy && !selectedTask) ? createHomeGuideCards(isEn, "ask") : null;
  if (guideCards) {
    composerArea.append(form, helper, guideCards);
  } else {
    composerArea.append(form, helper);
  }

  const contextSuggestions = (!isChatActive && (selectedStrategy || selectedTask))
    ? createAskContextSuggestions(isEn, selectedStrategy, selectedTask, (promptText) => {
        if (state.askLoading) return;
        const extraText = input ? input.value.trim() : "";
        const finalPrompt = extraText ? `${promptText}\n\nXüsusi fokus: ${extraText}` : promptText;
        if (input) input.value = "";
        state.askDraft = "";
        submitAskMessage(finalPrompt, state.askPendingFile);
      })
    : null;
  if (contextSuggestions) {
    form.insertAdjacentElement("afterend", contextSuggestions);
    if (guideCards) guideCards.remove();
  }
  shell.append(thread, composerArea);
  workspace.appendChild(shell);
  if (!isChatActive) {
    const teaserCard = createMainAiHubTeaserCard(isEn);
    if (teaserCard) workspace.appendChild(teaserCard);
  }

  resizeInput = () => {
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 160)}px`;
    const val = input.value.trim();
    const hasText = val.length >= 2;
    const hasFile = Boolean(state.askPendingFile);
    if (state.askLoading) {
      submit.disabled = false;
    } else {
      submit.disabled = (!hasText && !hasFile);
    }
    shell.classList.toggle("has-input", Boolean(input.value.trim()));
    const hasAnyInput = Boolean(input.value && input.value.length > 0);
    form.classList.toggle("has-input", hasAnyInput);

    const isComplex = isComplexAskQuery(val, Boolean(state.askStrategyId || state.askTaskId));
    if (isComplex && currentAskThinking !== "high" && !state.askLoading) {
      suggestionWrap.style.display = "inline-flex";
    } else {
      suggestionWrap.style.display = "none";
    }
  };
  resizeInput();
  input.addEventListener("input", () => {
    state.askDraft = input.value;
    if (state.askError) state.askError = "";
    resizeInput();
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      if (state.askLoading) {
        abortAskMessage();
      } else if (!submit.disabled) {
        form.requestSubmit();
      }
    }
  });
  submit.addEventListener("click", (event) => {
    if (state.askLoading) {
      event.preventDefault();
      event.stopPropagation();
      abortAskMessage();
    }
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (state.askLoading) {
      abortAskMessage();
      return;
    }
    const message = input.value.trim();
    const hasFile = Boolean(state.askPendingFile);
    if (message.length >= 2 || hasFile) {
      state.askDraft = "";
      submitAskMessage(message, state.askPendingFile);
    }
  });

  requestAnimationFrame(() => {
    if (state.askDraft) resizeInput();
    if (state.askMessages.length) composerArea.scrollIntoView({ block: "end" });
    if (!state.askLoading && window.innerWidth > 767) input.focus();
  });
}

class LiveTypewriter {
  constructor(onUpdate, onComplete) {
    this.targetText = "";
    this.currentText = "";
    this.onUpdate = onUpdate;
    this.onComplete = onComplete;
    this.rafId = null;
    this.finishTimeoutId = null;
    this.revealDeadline = 0;
    this.isDone = false;
    this.hasCompleted = false;
    this.completionPromise = new Promise((resolve) => { this.resolveCompletion = resolve; });
  }

  now() {
    return typeof performance !== "undefined" ? performance.now() : Date.now();
  }

  canAnimate() {
    return (
      typeof window !== "undefined" &&
      typeof requestAnimationFrame === "function" &&
      (typeof document === "undefined" || !document.hidden) &&
      !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    );
  }

  scheduleTick() {
    if (this.rafId !== null || this.hasCompleted) return;
    if (!this.canAnimate()) {
      this.currentText = this.targetText;
      if (this.isDone) this.flush();
      else this.onUpdate?.(this.currentText, false);
      return;
    }
    this.rafId = requestAnimationFrame(() => this.tick());
  }

  append(chunk) {
    if (!chunk || this.hasCompleted) return;
    const wasCaughtUp = this.currentText.length === this.targetText.length;
    this.targetText += chunk;
    if (wasCaughtUp) this.revealDeadline = this.now() + 120;
    if (!this.canAnimate()) {
      this.currentText = this.targetText;
      this.onUpdate?.(this.currentText, false);
      return;
    }
    // Show the first word synchronously, then glide through the provider burst
    // within 120ms. Network completion must not erase the visible animation.
    if (!this.currentText) this.reveal(Math.min(8, this.targetText.length));
    if (this.currentText.length < this.targetText.length) this.scheduleTick();
  }

  reveal(step) {
    let end = Math.min(this.targetText.length, this.currentText.length + step);
    if (end < this.targetText.length) {
      const boundary = this.targetText.slice(end, end + 5).search(/[\s.,;:!?)]/);
      if (boundary >= 0) end = Math.min(this.targetText.length, end + boundary + 1);
      const char = this.targetText.charCodeAt(end - 1);
      if (char >= 0xd800 && char <= 0xdbff) end += 1;
    }
    this.currentText = this.targetText.slice(0, end);
    this.onUpdate?.(this.currentText, false);
  }

  finish(finalText) {
    if (this.hasCompleted) return;
    if (typeof finalText === "string" && finalText.length > 0) this.targetText = finalText;
    const firstFinish = !this.isDone;
    this.isDone = true;
    if (!this.canAnimate() || this.currentText === this.targetText) {
      this.flush();
      return;
    }
    if (!this.currentText) this.reveal(Math.min(8, this.targetText.length));
    if (firstFinish) {
      this.revealDeadline = Math.min(this.revealDeadline || Infinity, this.now() + 120);
      this.finishTimeoutId = setTimeout(() => this.flush(), 150);
    }
    this.scheduleTick();
  }

  flush() {
    if (this.hasCompleted) return;
    this.hasCompleted = true;
    if (this.rafId !== null && typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    if (this.finishTimeoutId !== null) {
      clearTimeout(this.finishTimeoutId);
      this.finishTimeoutId = null;
    }
    this.currentText = this.targetText;
    this.onUpdate?.(this.currentText, true);
    this.onComplete?.();
    this.resolveCompletion?.();
  }

  waitForCompletion() { return this.completionPromise; }

  tick() {
    this.rafId = null;
    if (this.hasCompleted) return;
    if (!this.canAnimate()) {
      this.currentText = this.targetText;
      if (this.isDone) this.flush();
      else this.onUpdate?.(this.currentText, false);
      return;
    }
    const remaining = this.targetText.length - this.currentText.length;
    if (remaining <= 0) {
      if (this.isDone) this.flush();
      return;
    }
    const framesLeft = Math.max(1, Math.ceil((this.revealDeadline - this.now()) / 16));
    this.reveal(Math.max(3, Math.ceil(remaining / framesLeft)));
    if (this.currentText.length < this.targetText.length) this.scheduleTick();
    else if (this.isDone) this.flush();
  }
}

function extractGroundingWebChunks(groundingMetadata) {
  if (!groundingMetadata || typeof groundingMetadata !== "object") return [];
  const webChunks = [];
  const seen = new Set();
  const addSource = (rawUri, rawTitle) => {
    if (typeof rawUri !== "string") return;
    let uri = rawUri.trim();
    if (!/^https?:\/\//i.test(uri) || uri.length > 2000) return;
    let hostname;
    try {
      const parsed = new URL(uri);
      if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password || parsed.href.length > 2000) return;
      uri = parsed.href;
      hostname = parsed.hostname.replace(/^www\./, "");
    } catch { return; }
    if (seen.has(uri)) return;
    seen.add(uri);
    const title = typeof rawTitle === "string" && rawTitle.trim() ? rawTitle.trim() : hostname;
    webChunks.push({ uri, title, hostname });
  };
  for (const chunk of Array.isArray(groundingMetadata.groundingChunks) ? groundingMetadata.groundingChunks : []) {
    addSource(chunk?.web?.uri, chunk?.web?.title);
  }
  for (const citation of Array.isArray(groundingMetadata.citations) ? groundingMetadata.citations : []) {
    addSource(citation?.url || citation?.uri, citation?.title || citation?.text);
  }
  return webChunks;
}

function extractGroundingSearchSuggestions(groundingMetadata) {
  if (!groundingMetadata || typeof groundingMetadata !== "object") return [];
  const suggestions = [];
  const seen = new Set();
  const addSuggestion = (rawQuery, rawUrl) => {
    const query = String(rawQuery || "").replace(/\s+/g, " ").trim().slice(0, 160);
    if (!query) return;
    let url = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
    if (typeof rawUrl === "string" && rawUrl.trim()) {
      try {
        const parsed = new URL(rawUrl.trim());
        const host = parsed.hostname.toLowerCase();
        if (
          (parsed.protocol === "https:" || parsed.protocol === "http:") && !parsed.username && !parsed.password && parsed.href.length <= 2000 &&
          (host === "www.google.com" || host === "google.com" || host.endsWith(".google.com") || host.endsWith(".cloud.google.com"))
        ) {
          url = parsed.href;
        }
      } catch {}
    }
    const key = query.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    suggestions.push({ query, url });
  };

  if (Array.isArray(groundingMetadata.searchSuggestions)) {
    for (const item of groundingMetadata.searchSuggestions) {
      if (suggestions.length >= 8) break;
      if (item && typeof item === "object") addSuggestion(item.query || item.label, item.url);
    }
  }

  const rendered = groundingMetadata?.searchEntryPoint?.renderedContent;
  if (typeof rendered === "string" && rendered.trim()) {
    const anchorRegex = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
    let match;
    while ((match = anchorRegex.exec(rendered)) !== null && suggestions.length < 8) {
      const href = match[1].replace(/&amp;/g, "&");
      const label = match[2].replace(/<[^>]+>/g, "").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&").trim();
      if (label) addSuggestion(label, href);
    }
  }

  if (Array.isArray(groundingMetadata.webSearchQueries)) {
    for (const q of groundingMetadata.webSearchQueries) {
      if (suggestions.length >= 8) break;
      if (typeof q === "string" && q.trim()) addSuggestion(q, null);
    }
  }

  return suggestions;
}

function renderAskSourceChips(groundingMetadata) {
  const webChunks = extractGroundingWebChunks(groundingMetadata);
  const searchSuggestions = extractGroundingSearchSuggestions(groundingMetadata);
  if (!webChunks.length && !searchSuggestions.length) return null;

  const isEn = getLanguage() === "en";
  const container = element("div", "ask-grounding-container");
  container.setAttribute("aria-label", isEn ? "Web sources" : "Veb mənbələri");

  const header = element("div", "ask-grounding-header");
  const icon = element("span", "ask-grounding-icon");
  icon.innerHTML = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>';
  const label = element("span", "ask-grounding-header-label", isEn ? "Sources" : "Mənbələr");
  icon.setAttribute("aria-hidden", "true");
  header.append(icon, label);
  if (webChunks.length) header.appendChild(element("span", "ask-grounding-count", String(webChunks.length)));

  const viewAllBtn = button(isEn ? "View all" : "Hamısı", "ask-grounding-all-btn", (e) => {
    e.preventDefault();
    e.stopPropagation();
    openGroundingSourcesModal(groundingMetadata);
  });
  viewAllBtn.type = "button";
  viewAllBtn.title = isEn ? "View grounding details & queries" : "Bütün mənbələrə və axtarış sorğularına bax";
  header.appendChild(viewAllBtn);

  container.appendChild(header);

  const list = element("div", "ask-grounding-list");
  const MAX_VISIBLE_CHIPS = 4;
  const visibleChunks = webChunks.slice(0, MAX_VISIBLE_CHIPS);
  const remainingCount = webChunks.length - visibleChunks.length;

  visibleChunks.forEach((item, index) => {
    const chip = document.createElement("a");
    chip.className = "ask-grounding-chip";
    chip.href = item.uri;
    chip.target = "_blank";
    chip.rel = "noopener noreferrer";
    chip.title = `${item.title} (${item.hostname})`;
    chip.setAttribute("aria-label", `${item.title} (${item.hostname})`);

    const faviconWrap = element("span", "ask-grounding-chip-favicon", String(index + 1));
    faviconWrap.setAttribute("aria-hidden", "true");
    // Google relay links do not expose the publisher domain. Prefer the supplied
    // title, preserving the original HTTPS destination without fetching it.
    const isRelay = item.hostname === "vertexaisearch.cloud.google.com";
    const sourceTitle = item.title !== item.hostname ? item.title :
      (isRelay ? `${isEn ? "Source" : "Mənbə"} ${index + 1}` : item.hostname);
    const info = element("span", "ask-grounding-chip-info");
    info.appendChild(element("span", "ask-grounding-chip-title", sourceTitle));
    if (!isRelay && item.title !== item.hostname) {
      info.appendChild(element("span", "ask-grounding-chip-domain", item.hostname));
    }
    chip.append(faviconWrap, info);

    const extIcon = element("span", "ask-grounding-chip-ext");
    extIcon.innerHTML = '<svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>';
    chip.appendChild(extIcon);

    list.appendChild(chip);
  });

  if (remainingCount > 0) {
    const moreBtn = button(`+${remainingCount} ${isEn ? "more" : "daha"}`, "ask-grounding-chip ask-grounding-chip-more", (e) => {
      e.preventDefault();
      e.stopPropagation();
      openGroundingSourcesModal(groundingMetadata);
    });
    moreBtn.type = "button";
    moreBtn.title = isEn ? `View all ${webChunks.length} sources` : `Bütün ${webChunks.length} mənbəyə bax`;
    list.appendChild(moreBtn);
  }

  if (webChunks.length > 0) {
    container.appendChild(list);
  }

  if (searchSuggestions.length > 0) {
    const suggestionsBar = element("details", "ask-search-suggestions");
    suggestionsBar.setAttribute("aria-label", "Google Search Suggestions");
    const gBadge = element("summary", "ask-search-suggestions-badge");
    gBadge.innerHTML = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>';
    gBadge.appendChild(element("span", "ask-search-suggestions-label", "Google Search"));
    gBadge.appendChild(element("span", "ask-search-suggestions-count", `${searchSuggestions.length} ${isEn ? "queries" : "sorğu"}`));
    suggestionsBar.appendChild(gBadge);

    const suggestionsList = element("div", "ask-search-suggestions-list");
    searchSuggestions.forEach((suggestion) => {
      const sugChip = document.createElement("a");
      sugChip.className = "ask-search-suggestion-chip";
      sugChip.href = suggestion.url;
      sugChip.target = "_blank";
      sugChip.rel = "noopener noreferrer";
      sugChip.appendChild(element("span", "ask-search-suggestion-text", suggestion.query));
      suggestionsList.appendChild(sugChip);
    });
    suggestionsBar.appendChild(suggestionsList);
    container.appendChild(suggestionsBar);
  }

  return container;
}

const activeResearchStreams = new Map();

function renderResearchSourcesList(sources, isEn) {
  if (!Array.isArray(sources) || !sources.length) return null;

  const validSources = [];
  const seenUrls = new Set();

  for (const s of sources) {
    const rawUrl = String(s?.url || "").trim();
    if (!/^https?:\/\//i.test(rawUrl)) continue;
    if (seenUrls.has(rawUrl)) continue;
    seenUrls.add(rawUrl);

    let hostname = s.domain || "";
    if (!hostname) {
      try {
        hostname = new URL(rawUrl).hostname.replace(/^www\./, "");
      } catch {
        hostname = rawUrl;
      }
    }
    const title = String(s?.title || hostname).trim();
    validSources.push({ url: rawUrl, title, domain: hostname });
  }

  if (!validSources.length) return null;

  const details = document.createElement("details");
  details.className = "ask-research-sources-card ask-research-sources-accordion";

  const summary = document.createElement("summary");
  summary.className = "ask-research-sources-summary";

  const summaryLeft = element("div", "ask-research-sources-summary-left");
  const icon = element("span", "ask-research-sources-summary-icon");
  icon.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>';

  const titleText = element(
    "span",
    "ask-research-sources-summary-title",
    isEn ? "Verified Sources & Citations" : "İstifadə Edilən Mənbələr",
  );

  const countPill = element(
    "span",
    "ask-research-sources-count-pill",
    `${validSources.length} ${isEn ? "sources" : "mənbə"}`,
  );

  summaryLeft.append(icon, titleText, countPill);

  const chevron = element("span", "ask-research-sources-chevron");
  chevron.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';

  summary.append(summaryLeft, chevron);
  details.appendChild(summary);

  const body = element("div", "ask-research-sources-body");
  const list = element("div", "ask-research-sources-grid");

  validSources.forEach((src, idx) => {
    const link = document.createElement("a");
    link.className = "ask-research-source-link";
    link.href = src.url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";

    const num = element("span", "ask-research-source-num", `[${idx + 1}]`);
    const meta = element("div", "ask-research-source-meta");
    const titleSpan = element("span", "ask-research-source-title", src.title);
    const domainSpan = element("span", "ask-research-source-domain", src.domain);
    meta.append(titleSpan, domainSpan);

    const extIcon = element("span", "ask-research-source-ext");
    extIcon.innerHTML = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>';

    link.append(num, meta, extIcon);
    list.appendChild(link);
  });

  body.appendChild(list);
  details.appendChild(body);
  return details;
}

function renderAskResearchMessageContent(content, message, messageIndex, isEn) {
  const isRunning = message.status === "pending" || message.status === "running";
  const isCompleted = message.status === "completed";
  const isFailed = ["failed", "cancelled", "interrupted"].includes(message.status);

  const card = element("div", `ask-research-card${isRunning ? " is-running" : isCompleted ? " is-completed" : " is-failed"}`);

  // Header
  const header = element("div", "ask-research-header");
  const headerLeft = element("div", "ask-research-header-left");

  if (isRunning) {
    const pulseDot = element("span", "ask-research-pulsing-indicator");
    pulseDot.setAttribute("aria-hidden", "true");
    const title = element("strong", "ask-research-title", "Deep Research");
    const statusPill = element("span", "ask-research-status-pill", isEn ? "In progress…" : "İcrada…");
    headerLeft.append(pulseDot, title, statusPill);
  } else if (isCompleted) {
    const checkBadge = element("span", "ask-research-completed-icon");
    checkBadge.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
    const title = element("strong", "ask-research-title", "Deep Research");
    const completedBadge = element("span", "ask-research-completed-badge", isEn ? "Complete" : "Tamamlandı");
    headerLeft.append(checkBadge, title, completedBadge);
  } else {
    const errorBadge = element("span", "ask-research-error-icon");
    errorBadge.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>';
    const title = element("strong", "ask-research-title", "Deep Research");
    const failedBadge = element("span", "ask-research-status-pill is-error", isEn ? "Failed" : "Xəta");
    headerLeft.append(errorBadge, title, failedBadge);
  }

  const headerRight = element("div", "ask-research-header-right");
  if (isCompleted && message.sources?.length) {
    const sourceSummary = element("span", "ask-research-source-count-badge", `${message.sources.length} ${isEn ? "sources analyzed" : "mənbə əsasında"}`);
    headerRight.appendChild(sourceSummary);
  }
  header.append(headerLeft, headerRight);
  card.appendChild(header);

  // Body
  if (isRunning) {
    const stepsContainer = element("div", "ask-research-steps");
    stepsContainer.setAttribute("role", "list");
    stepsContainer.setAttribute("aria-label", isEn ? "Research execution steps" : "Araşdırma mərhələləri");

    const steps = Array.isArray(message.steps) && message.steps.length ? message.steps : [
      { key: "plan", label: isEn ? "Formulating research plan…" : "Mövzu üzrə araşdırma planı hazırlanır…", status: "running" },
      { key: "search", label: isEn ? "Analyzing live web sources and competitors…" : "Veb mənbələr analiz edilir…", status: "pending" },
      { key: "verify", label: isEn ? "Cross-verifying facts and statistics…" : "Faktlar çarpaz yoxlanılır…", status: "pending" },
      { key: "synthesize", label: isEn ? "Synthesizing deep strategic findings…" : "Nəticə sintez olunur…", status: "pending" },
    ];

    steps.forEach((st) => {
      const stepItem = element("div", `ask-research-step is-${st.status || "pending"}`);
      stepItem.setAttribute("role", "listitem");
      const icon = element("span", "ask-research-step-icon");

      if (st.status === "completed") {
        icon.innerHTML = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
      } else if (st.status === "running") {
        icon.innerHTML = '<span class="ask-research-step-spinner" aria-hidden="true"></span>';
      } else if (st.status === "failed") {
        icon.innerHTML = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
      } else {
        icon.innerHTML = '<span class="ask-research-step-dot" aria-hidden="true"></span>';
      }

      const textWrap = element("div", "ask-research-step-text");
      const label = element("span", "ask-research-step-label", st.label || st.key);
      textWrap.appendChild(label);
      if (st.detail) {
        const detail = element("span", "ask-research-step-detail", st.detail);
        textWrap.appendChild(detail);
      }
      stepItem.append(icon, textWrap);
      stepsContainer.appendChild(stepItem);
    });

    card.appendChild(stepsContainer);

    if (message.sources?.length) {
      const liveSources = element("div", "ask-research-live-sources");
      const liveTitle = element("span", "ask-research-live-sources-label", `🌐 ${message.sources.length} ${isEn ? "sources found" : "mənbə aşkarlandı"}`);
      liveSources.appendChild(liveTitle);

      const chipsWrap = element("div", "ask-research-live-sources-chips");
      message.sources.slice(0, 5).forEach((src) => {
        const domainChip = element("span", "ask-research-live-chip", src.domain || src.title);
        chipsWrap.appendChild(domainChip);
      });
      if (message.sources.length > 5) {
        chipsWrap.appendChild(element("span", "ask-research-live-chip is-more", `+${message.sources.length - 5}`));
      }
      liveSources.appendChild(chipsWrap);
      card.appendChild(liveSources);
    }
  } else if (isCompleted) {
    const summaryBanner = element("div", "ask-research-completed-summary");
    const summaryIcon = element("span", "ask-research-summary-icon");
    summaryIcon.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
    const stepCount = Array.isArray(message.steps) && message.steps.length ? message.steps.length : 4;
    const summaryText = element("span", "ask-research-summary-text", isEn ? `Deep research complete across ${stepCount} execution phases` : `${stepCount} icra mərhələsi üzrə dərin araşdırma tamamlandı`);
    summaryBanner.append(summaryIcon, summaryText);
    card.appendChild(summaryBanner);

    if (message.content) {
      let displayContent = String(message.content || "");
      if (Array.isArray(message.sources) && message.sources.length > 0) {
        displayContent = displayContent.replace(
          /(?:\r?\n)+##+\s*(?:\d+[\.\)]\s*)?(?:Mənbələr|İstinadlar|Mənbə|Sources|Citations|References)[\s\S]*$/i,
          ""
        ).trim();
      }
      const mdWrap = element("div", "ask-research-markdown");
      mdWrap.appendChild(renderAskRichText(displayContent || message.content));
      card.appendChild(mdWrap);
    }

    if (message.sources?.length) {
      const sourcesCard = renderResearchSourcesList(message.sources, isEn);
      if (sourcesCard) card.appendChild(sourcesCard);
    }

    if (message.groundingMetadata) {
      const chips = renderAskSourceChips(message.groundingMetadata);
      if (chips) card.appendChild(chips);
    }
  } else if (isFailed) {
    const errorBody = element("div", "ask-research-error-body");
    const errorMsg = element("span", "ask-research-error-text", message.error || (isEn ? "Research failed." : "Araşdırma zamanı xəta baş verdi."));
    const retryBtn = button(isEn ? "Retry research" : "Yenidən araşdır", "ask-research-retry-btn", () => {
      if (message.query) {
        state.askDraft = message.query;
        state.askPluginIds = ["deep-research"];
        render();
        submitAskMessage(message.query);
      }
    });
    retryBtn.type = "button";
    errorBody.append(errorMsg, retryBtn);
    card.appendChild(errorBody);
  }

  content.appendChild(card);

  if (isCompleted && message.content) {
    const actions = element("div", "ask-message-actions");
    actions.setAttribute("aria-label", isEn ? "Response actions" : "Cavab əməliyyatları");

    const copy = button("", "ask-response-action ask-response-copy-btn", async () => {
      const ok = await copyAskResponse(message.content);
      if (ok) {
        copy.classList.add("is-copied");
        copy.title = isEn ? "Copied" : "Kopyalandı";
        copy.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
        setTimeout(() => {
          copy.classList.remove("is-copied");
          copy.title = isEn ? "Copy" : "Kopyala";
          copy.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>';
        }, 1800);
      }
    });
    copy.type = "button";
    copy.setAttribute("aria-label", isEn ? "Copy response" : "Cavabı kopyala");
    copy.title = isEn ? "Copy" : "Kopyala";
    copy.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>';
    actions.appendChild(copy);

    const positive = button("", `ask-response-action ask-response-positive-btn${message.feedback === "positive" ? " is-selected" : ""}`, () => {
      const nextFeedback = message.feedback === "positive" ? null : "positive";
      message.feedback = nextFeedback;
      render();
    });
    positive.type = "button";
    positive.title = isEn ? "Helpful" : "Bəyən";
    positive.setAttribute("aria-label", isEn ? "Helpful" : "Bəyən");
    positive.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/></svg>';

    const negative = button("", `ask-response-action ask-response-negative-btn${message.feedback === "negative" ? " is-selected" : ""}`, () => {
      const nextFeedback = message.feedback === "negative" ? null : "negative";
      message.feedback = nextFeedback;
      render();
    });
    negative.type = "button";
    negative.title = isEn ? "Unhelpful" : "Bəyənmə";
    negative.setAttribute("aria-label", isEn ? "Unhelpful" : "Bəyənmə");
    negative.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round"><path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7-13h3a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-3"/></svg>';

    actions.append(positive, negative, buildAskResponseMoreMenu(message, messageIndex, isEn));
    content.appendChild(actions);
  }
}

function isIdentityStale(epoch, expectedUserId) {
  return epoch !== state.identityEpoch || (state.currentUser?.id || null) !== expectedUserId;
}

function connectToResearchJobStream(message) {
  if (!message || !message.jobId) return;
  if (activeResearchStreams.has(message.jobId)) return;

  const epoch = state.identityEpoch;
  const expectedUserId = state.currentUser?.id || null;
  const controller = new AbortController();
  activeResearchStreams.set(message.jobId, controller);

  (async () => {
    try {
      const response = await fetch(`/api/ask/research/jobs/${message.jobId}/stream`, {
        signal: controller.signal,
        headers: { Accept: "text/event-stream" },
      });

      if (!response.ok) {
        throw new Error(`Stream request failed with status ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let rawBuffer = "";
      let eventLines = [];

      const dispatchResearchEvent = (lines) => {
        if (isIdentityStale(epoch, expectedUserId) || controller.signal.aborted) return;
        if (!lines || !lines.length) return;
        const jsonStr = lines.join("\n").trim();
        if (!jsonStr || jsonStr.startsWith(":")) return;

        try {
          const data = JSON.parse(jsonStr);

          if (data.type === "snapshot") {
            message.status = data.status || message.status;
            if (data.steps?.length) message.steps = data.steps;
            if (data.sources?.length) message.sources = data.sources;
            if (data.groundingMetadata) message.groundingMetadata = data.groundingMetadata;
            if (data.reply) message.content = data.reply;
            if (data.error) message.error = data.error;
            if (data.artifacts?.length) message.artifacts = data.artifacts;
            if (data.generatingArtifacts !== undefined) message.generatingArtifacts = data.generatingArtifacts;
            render();
          } else if (data.type === "step") {
            message.status = data.status || message.status;
            if (data.steps?.length) message.steps = data.steps;
            if (data.sources?.length) message.sources = data.sources;
            if (data.artifacts?.length) message.artifacts = data.artifacts;
            if (data.generatingArtifacts !== undefined) message.generatingArtifacts = data.generatingArtifacts;
            render();
          } else if (data.type === "sources") {
            if (data.sources?.length) message.sources = data.sources;
            render();
          } else if (data.type === "done") {
            message.status = "completed";
            message.content = data.reply || message.content;
            if (data.sources?.length) message.sources = data.sources;
            if (data.groundingMetadata) message.groundingMetadata = data.groundingMetadata;
            if (data.steps?.length) message.steps = data.steps;
            if (data.artifacts?.length) message.artifacts = data.artifacts;
            message.generatingArtifacts = false;
            activeResearchStreams.delete(message.jobId);
            render();
          } else if (data.type === "failed") {
            message.status = data.status || "failed";
            message.error = data.error || "Araşdırma xətası";
            if (data.steps?.length) message.steps = data.steps;
            message.generatingArtifacts = false;
            activeResearchStreams.delete(message.jobId);
            render();
          }
        } catch {
          // Ignore JSON parse errors on partial frames
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done || isIdentityStale(epoch, expectedUserId) || controller.signal.aborted) break;

        rawBuffer += decoder.decode(value, { stream: true });
        const lines = rawBuffer.split(/\r?\n/);
        rawBuffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("data:")) {
            eventLines.push(line.replace(/^data:\s*/, ""));
          } else if (line.trim() === "" && eventLines.length > 0) {
            dispatchResearchEvent(eventLines);
            eventLines = [];
          }
        }
      }

      if (eventLines.length > 0 && !isIdentityStale(epoch, expectedUserId) && !controller.signal.aborted) {
        dispatchResearchEvent(eventLines);
      }
    } catch (err) {
      if (err.name !== "AbortError" && !isIdentityStale(epoch, expectedUserId) && !controller.signal.aborted) {
        console.warn("[Deep Research] Stream disconnected, checking job status via polling:", err?.message || err);
        pollResearchJob(message);
      }
    } finally {
      if (["completed", "failed", "cancelled", "interrupted"].includes(message.status) || isIdentityStale(epoch, expectedUserId) || controller.signal.aborted) {
        activeResearchStreams.delete(message.jobId);
      }
    }
  })();
}

async function pollResearchJob(message) {
  if (!message || !message.jobId) return;
  if (["completed", "failed", "cancelled", "interrupted"].includes(message.status)) return;

  const epoch = state.identityEpoch;
  const expectedUserId = state.currentUser?.id || null;
  const maxAttempts = 60;
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    if (isIdentityStale(epoch, expectedUserId)) return;
    if (["completed", "failed", "cancelled", "interrupted"].includes(message.status)) return;

    try {
      const res = await fetch(`/api/ask/research/jobs/${message.jobId}`);
      if (isIdentityStale(epoch, expectedUserId)) return;
      if (!res.ok) continue;
      const data = await res.json();
      if (isIdentityStale(epoch, expectedUserId)) return;
      if (data.job) {
        message.status = data.job.status || message.status;
        if (data.job.steps?.length) message.steps = data.job.steps;
        if (data.job.sources?.length) message.sources = data.job.sources;
        if (data.job.groundingMetadata) message.groundingMetadata = data.job.groundingMetadata;
        if (data.job.content) message.content = data.job.content;
        if (data.job.error) message.error = data.job.error;
        if (data.job.artifacts?.length) message.artifacts = data.job.artifacts;
        render();

        if (["completed", "failed", "cancelled", "interrupted"].includes(data.job.status)) {
          activeResearchStreams.delete(message.jobId);
          return;
        }
      }
    } catch {
      // Continue polling
    }
  }
}

function openGroundingSourcesModal(groundingMetadata) {
  if (!groundingMetadata || typeof groundingMetadata !== "object") return;
  const chunks = Array.isArray(groundingMetadata.groundingChunks) ? groundingMetadata.groundingChunks : [];
  const webChunks = chunks
    .map((c) => c && c.web)
    .filter((w) => {
      if (!w || typeof w.uri !== "string") return false;
      try {
        const parsed = new URL(w.uri);
        return ["http:", "https:"].includes(parsed.protocol);
      } catch {
        return false;
      }
    });

  const searchSuggestions = extractGroundingSearchSuggestions(groundingMetadata);

  const existing = document.querySelector(".ask-sources-drawer-overlay");
  if (existing) existing.remove();

  const overlay = element("div", "ask-sources-drawer-overlay");
  const drawer = element("div", "ask-sources-drawer");

  const dragHandle = element("div", "ask-sources-drag-handle");
  dragHandle.setAttribute("aria-hidden", "true");

  const isEn = getLanguage() === "en";
  const header = element("div", "ask-sources-drawer-header");
  const titleGroup = element("div", "ask-sources-drawer-title-group");
  const titleRow = element("div", "ask-sources-drawer-title-row");

  const icon = element("span", "ask-sources-drawer-icon");
  icon.innerHTML = `
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="12" cy="12" r="10"></circle>
      <line x1="2" y1="12" x2="22" y2="12"></line>
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>
    </svg>
  `;
  const title = element("h3", "", isEn ? "Sources Used" : "İstifadə olunan mənbələr");
  titleRow.append(icon, title);

  const subtitle = element("p", "", isEn ? "Web citations and grounding references retrieved via real-time search" : "Canlı axtarış vasitəsilə əldə edilən veb mənbələri");
  titleGroup.append(titleRow, subtitle);

  const closeModal = () => {
    document.body.style.overflow = "";
    overlay.remove();
    document.removeEventListener("keydown", handleKeydown);
  };

  const closeBtn = element("button", "ask-sources-drawer-close");
  closeBtn.type = "button";
  closeBtn.setAttribute("aria-label", isEn ? "Close" : "Bağla");
  closeBtn.innerHTML = `
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
      <line x1="18" y1="6" x2="6" y2="18"/>
      <line x1="6" y1="6" x2="18" y2="18"/>
    </svg>
  `;
  closeBtn.addEventListener("click", closeModal);
  header.append(titleGroup, closeBtn);

  const body = element("div", "ask-sources-drawer-body");

  if (searchSuggestions.length > 0) {
    const queriesBox = element("div", "ask-sources-queries-box");
    const queriesLabel = element("div", "ask-sources-queries-label", isEn ? "Google Search suggestions:" : "Google Search axtarış sorğuları:");
    const queriesTags = element("div", "ask-sources-queries-tags");
    searchSuggestions.forEach((suggestion) => {
      const tagLink = document.createElement("a");
      tagLink.className = "ask-sources-query-tag";
      tagLink.href = suggestion.url;
      tagLink.target = "_blank";
      tagLink.rel = "noopener noreferrer";
      tagLink.textContent = suggestion.query;
      queriesTags.appendChild(tagLink);
    });
    queriesBox.append(queriesLabel, queriesTags);
    body.appendChild(queriesBox);
  }

  if (webChunks.length > 0) {
    const list = element("div", "ask-sources-cards-list");
    const seen = new Set();
    webChunks.forEach((item, index) => {
      if (seen.has(item.uri)) return;
      seen.add(item.uri);

      let hostname = "";
      try {
        hostname = new URL(item.uri).hostname.replace(/^www\./, "");
      } catch {
        hostname = item.uri;
      }
      const titleText = item.title || hostname;

      const card = document.createElement("a");
      card.className = "ask-source-card";
      card.href = item.uri;
      card.target = "_blank";
      card.rel = "noopener noreferrer";

      const cardIndex = element("span", "ask-source-card-index", `${index + 1}`);
      const cardInfo = element("div", "ask-source-card-info");
      const cardTitle = element("span", "ask-source-card-title", titleText);
      const cardUrl = element("span", "ask-source-card-url", hostname || item.uri);
      cardInfo.append(cardTitle, cardUrl);

      const extIcon = element("span", "ask-source-card-icon");
      extIcon.innerHTML = `
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
          <polyline points="15 3 21 3 21 9"></polyline>
          <line x1="10" y1="14" x2="21" y2="3"></line>
        </svg>
      `;

      card.append(cardIndex, cardInfo, extIcon);
      list.appendChild(card);
    });
    body.appendChild(list);
  } else {
    body.appendChild(element("p", "ask-sources-empty", isEn ? "No web links found for this response." : "Bu cavab üçün əlavə veb keçidi tapılmadı."));
  }

  drawer.append(dragHandle, header, body);
  overlay.appendChild(drawer);

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeModal();
  });

  const handleKeydown = (e) => {
    if (e.key === "Escape") closeModal();
  };
  document.addEventListener("keydown", handleKeydown);

  document.body.style.overflow = "hidden";
  document.body.appendChild(overlay);
}

function updateActiveAskThinkingStatus(message) {
  const activeBubbles = document.querySelectorAll(".ask-message.is-streaming .ask-thinking");
  if (!activeBubbles.length || message.content || !message.isStreaming) return;
  const isSearching = message.status === "searching";
  const showLabel = isSearching || isAskThinkingActive(message);
  const nextLabel = showLabel ? askThinkingLabel(message, getLanguage() === "en") : "";

  activeBubbles.forEach((activeBubble) => {
    activeBubble.classList.toggle("is-searching", isSearching);
    activeBubble.classList.toggle("has-label", showLabel);
    activeBubble.classList.toggle("is-default", !showLabel);

    let labelEl = activeBubble.querySelector(".ask-thinking-label");
    if (showLabel) {
      if (!labelEl) {
        labelEl = element("span", "ask-thinking-label", nextLabel);
        activeBubble.appendChild(labelEl);
      } else if (labelEl.textContent !== nextLabel) {
        labelEl.textContent = nextLabel;
        labelEl.classList.remove("is-changing");
        void labelEl.offsetWidth;
        labelEl.classList.add("is-changing");
      }
    } else if (labelEl) {
      labelEl.remove();
    }

    const iconEl = activeBubble.querySelector(".ask-thinking-icon");
    if (iconEl) {
      const hasSearchSvg = Boolean(iconEl.querySelector(".ask-searching-icon"));
      if (hasSearchSvg !== isSearching) {
        iconEl.innerHTML = askThinkingIcon(isSearching);
      }
    }
  });
}

let askScrollRafId = null;
function scheduleAskScroll() {
  if (askScrollRafId) return;
  askScrollRafId = requestAnimationFrame(() => {
    askScrollRafId = null;
    const strategyAskBody = document.querySelector(".strategy-ask-body");
    if (strategyAskBody) {
      const isNearBottom = strategyAskBody.scrollHeight - strategyAskBody.scrollTop - strategyAskBody.clientHeight < 180;
      if (isNearBottom) {
        strategyAskBody.scrollTop = strategyAskBody.scrollHeight;
      }
    }
  });
}

function updateActiveAskMessageContent(message, showCaret = true) {
  const activeBubbles = document.querySelectorAll(".ask-message.is-streaming .ask-message-content");
  if (activeBubbles.length) {
    activeBubbles.forEach((activeBubble) => {
      if (message.content) {
        let streamWrap = activeBubble.querySelector(".ask-stream-wrap");
        if (!streamWrap) {
          activeBubble.replaceChildren();
          streamWrap = element("div", "ask-stream-wrap ask-text-glide-in");
          activeBubble.appendChild(streamWrap);
        }
        let richContent = streamWrap.querySelector(".ask-rich-text");
        if (!richContent) {
          richContent = renderAskRichText(message.content);
          streamWrap.prepend(richContent);
        } else {
          patchAskRichTextElement(richContent, message.content);
        }

        if (message.groundingMetadata && streamWrap._renderedGroundingRef !== message.groundingMetadata) {
          streamWrap.querySelector(".ask-grounding-container")?.remove();
          const chips = renderAskSourceChips(message.groundingMetadata);
          if (chips) streamWrap.appendChild(chips);
          streamWrap._renderedGroundingRef = message.groundingMetadata;
        }
      }
    });
    scheduleAskScroll();
    if (!showCaret) {
      const composerArea = document.querySelector(".ask-composer-area");
      if (composerArea) {
        const isNearBottom = (window.innerHeight + window.scrollY) >= document.documentElement.scrollHeight - 250;
        if (isNearBottom) composerArea.scrollIntoView({ behavior: "smooth", block: "end" });
      }
    }
  }
}

function createStrategyAskMessageActions(message, messageIndex, isEn) {
  const actions = element("div", "strategy-ask-message-actions");
  const copy = button("", "strategy-ask-action", async () => {
    const copied = await copyAskResponse(message.content);
    if (!copied) return;
    copy.classList.add("is-copied");
    copy.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="20 6 9 17 4 12"/></svg>';
    setTimeout(() => copy.classList.remove("is-copied"), 1400);
  });
  copy.type = "button";
  copy.title = isEn ? "Copy" : "Kopyala";
  copy.setAttribute("aria-label", isEn ? "Copy response" : "Cavabı kopyala");
  copy.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>';
  actions.appendChild(copy);

  if (message.groundingMetadata) {
    const sourcesBtn = button(isEn ? "🌐 Web Sources" : "🌐 Mənbələr", "strategy-ask-action strategy-ask-sources", () => {
      openGroundingSourcesModal(message.groundingMetadata);
    });
    sourcesBtn.type = "button";
    sourcesBtn.title = isEn ? "Web sources" : "Veb mənbələri";
    actions.appendChild(sourcesBtn);
  }

  const msgMeta = getAskMessageMeta(message);
  if (msgMeta.thinkingLevel !== "high") {
    const deeper = button(isEn ? "✦ Think Deeper" : "✦ Dərin düşün", "strategy-ask-action strategy-ask-deeper", () => thinkDeeperWithHigh(messageIndex));
    deeper.type = "button";
    deeper.disabled = state.askLoading;
    actions.appendChild(deeper);
  }
  const report = button("", "strategy-ask-action strategy-ask-report", () => {
    openLegalReportModal({ messageContent: message.content, model: getAskMessageModelInfo(message.model).displayName });
  });
  report.type = "button";
  report.title = isEn ? "Report issue" : "Hüquqi problem bildir";
  report.setAttribute("aria-label", isEn ? "Report issue" : "Hüquqi problem bildir");
  report.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M12 8v5"/><path d="M12 16.5h.01"/></svg>';
  actions.appendChild(report);
  return actions;
}

function finalizeStreamingAskMessageDom(message, messageIndex) {
  if (state.askError || !message || !message.content) return false;
  const streamingRows = document.querySelectorAll(".ask-message.is-streaming");
  if (!streamingRows.length) return false;

  updateActiveAskMessageContent(message, false);
  const isEn = getLanguage() === "en";

  streamingRows.forEach((row) => {
    row.classList.remove("is-streaming", "is-fresh");
    const content = row.querySelector(".ask-message-content");
    if (!content) return;
    content.querySelector(".ask-thinking")?.remove();
    if (!content.querySelector(".ask-artifact-card") && Array.isArray(message.artifacts) && message.artifacts.length > 0) {
      appendArtifactCards(content, message);
    }
    if (row.classList.contains("strategy-ask-message")) {
      if (!content.querySelector(".strategy-ask-message-actions")) {
        content.appendChild(createStrategyAskMessageActions(message, messageIndex, isEn));
      }
    } else if (!content.querySelector(".ask-message-actions")) {
      content.appendChild(createAskMessageActions(message, messageIndex, isEn));
    }
  });

  freshAskResponses.delete(message);

  const askInput = document.querySelector("#askInput");
  const askSubmit = document.querySelector(".ask-composer .ask-submit");
  if (askInput) {
    askInput.disabled = false;
    if (window.innerWidth > 767 && document.activeElement !== askInput) {
      askInput.focus();
    }
  }
  if (askSubmit) {
    askSubmit.classList.remove("is-stop", "is-generating");
    askSubmit.type = "submit";
    const val = askInput ? askInput.value.trim() : "";
    askSubmit.disabled = !(val.length >= 2 || Boolean(state.askPendingFile));
    askSubmit.setAttribute("aria-label", isEn ? "Send question" : "Sualı göndər");
    askSubmit.title = isEn ? "Send question" : "Sualı göndər";
    askSubmit.replaceChildren(createAskSendIcon());
  }

  const stratInput = document.querySelector("#strategyAskInput");
  const stratSend = document.querySelector(".strategy-ask-composer .strategy-ask-send");
  if (stratInput) {
    stratInput.disabled = false;
  }
  if (stratSend) {
    stratSend.classList.remove("is-stop", "is-generating");
    stratSend.type = "submit";
    const val = stratInput ? stratInput.value.trim() : "";
    stratSend.disabled = val.length < 2;
    stratSend.setAttribute("aria-label", isEn ? "Send question" : "Sualı göndər");
    stratSend.title = isEn ? "Send question" : "Sualı göndər";
    stratSend.replaceChildren(createStrategyAskSendIcon());
  }

  document.querySelectorAll(".ask-plugin-token-remove, .strategy-ask-deeper").forEach((btn) => {
    btn.disabled = false;
  });

  return true;
}

function rememberActiveAskChat(chatId) {
  const ownerId = state.currentUser?.id;
  if (!ownerId) return;
  try { sessionStorage.setItem("helmer_active_ask_chat", JSON.stringify({ chatId, ownerId })); } catch { }
}

function rememberSavedAskChat(chat) {
  if (!chat?.id) return;
  state.askChatId = chat.id;
  rememberActiveAskChat(chat.id);
  window.helmerSecurity?.rememberChat(chat);
  const messages = Array.isArray(chat.messages) ? chat.messages : [];
  const historyItem = {
    ...chat,
    messageCount: messages.length,
    lastMessage: messages.at(-1)?.content?.slice(0, 100) || "",
  };
  state.savedChats = [historyItem, ...state.savedChats.filter((item) => item.id !== chat.id)];
  renderRecentList();
}

async function thinkDeeperWithHigh(messageIndex) {
  if (!state.currentUser) {
    openGuestRestrictionModal(GUEST_RESTRICTION_NOTICES.thinking);
    return;
  }
  if (state.askLoading) return;
  const assistantMsg = state.askMessages[messageIndex];
  if (!assistantMsg || assistantMsg.role !== "assistant") return;

  const historyMessages = state.askMessages.slice(0, messageIndex);
  if (!historyMessages.length) return;

  recordLearningSignal(assistantMsg.interactionId, { regenerated: true });

  assistantMsg.content = "";
  assistantMsg.model = "gemini-3.8-flash";
  assistantMsg.isStreaming = true;
  setAskMessageMeta(assistantMsg, {
    thinkingLevel: "high",
    thinkingEnabled: true,
    userPrompt: historyMessages.filter((m) => m && m.role === "user").at(-1)?.content || "",
  });
  state.askLoading = true;
  state.askError = "";
  freshAskResponses.add(assistantMsg);
  render();
  startAskWaitStages(assistantMsg);

  let typewriter = null;
  let accumulatedFullText = "";
  const epoch = state.identityEpoch;
  const expectedUserId = state.currentUser?.id || null;

  currentAskAbortController?.abort();
  const controller = new AbortController();
  currentAskAbortController = controller;
  activeAskReader = null;
  activeAskTypewriter = null;

  try {
    let response = await fetch("/api/ask", {
      method: "POST",
      signal: currentAskAbortController.signal,
      headers: {
        "Content-Type": "application/json",
        "Accept": "text/event-stream",
        "X-Helmer-Model-Improvement": String(isModelImprovementActive()),
      },
      body: JSON.stringify({
        messages: historyMessages.map(sanitizeAskMessageForApi),
        model: "gemini-3.8-flash",
        thinkingLevel: "high",
        strategyId: state.askStrategyId || undefined,
        taskId: state.askTaskId || undefined,
        chatId: state.askChatId || undefined,
        chatRevision: state.askChatId ? (window.helmerSecurity?.getRevision(state.askChatId) || 1) : undefined,
        stream: true,
      }),
    });

    if (isIdentityStale(epoch, expectedUserId) || controller.signal.aborted) return;

    if (!response.ok && response.status === 409) {
      const errData = await response.clone().json().catch(() => ({}));
      if (isIdentityStale(epoch, expectedUserId) || controller.signal.aborted) return;
      if (errData.code === "REVISION_CONFLICT" && state.askChatId && errData.revision) {
        window.helmerSecurity?.revisions.set(state.askChatId, errData.revision);
        response = await fetch("/api/ask", {
          method: "POST",
          signal: controller.signal,
          headers: {
            "Content-Type": "application/json",
            "Accept": "text/event-stream",
            "X-Helmer-Model-Improvement": String(isModelImprovementActive()),
          },
          body: JSON.stringify({
            messages: historyMessages.map(sanitizeAskMessageForApi),
            model: "gemini-3.8-flash",
            thinkingLevel: "high",
            strategyId: state.askStrategyId || undefined,
            taskId: state.askTaskId || undefined,
            chatId: state.askChatId || undefined,
            chatRevision: errData.revision,
            stream: true,
          }),
        });
        if (isIdentityStale(epoch, expectedUserId) || controller.signal.aborted) return;
      }
    }

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      if (isIdentityStale(epoch, expectedUserId) || controller.signal.aborted) return;
      if (response.status === 409 && errData.code === "REVISION_CONFLICT" && state.askChatId && errData.revision) {
        window.helmerSecurity?.revisions.set(state.askChatId, errData.revision);
      }
      if (errData.code === "GUEST_DAILY_LIMIT" || (response.status === 429 && errData.error?.includes("Qonaq"))) {
        state.guestQuotaVersion += 1;
        state.remainingGuestMessages = 0;
        state.askError = "";
        render();
        return;
      }
      throw new Error(errData.error || (getLanguage() === "en" ? "Failed to regenerate with deeper thinking." : "Daha dərin düşünmə ilə yenidən generasiya etmək mümkün olmadı."));
    }

    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("text/event-stream")) {
      const reader = response.body.getReader();
      activeAskReader = reader;

      typewriter = new LiveTypewriter(
        (text, isComplete) => {
          if (isIdentityStale(epoch, expectedUserId) || controller.signal.aborted) return;
          assistantMsg.content = text;
          updateActiveAskMessageContent(assistantMsg, !isComplete);
        },
        () => {
          assistantMsg.isStreaming = false;
        }
      );
      activeAskTypewriter = typewriter;

      await consumeAskEventStream(reader, async data => {
        if (isIdentityStale(epoch, expectedUserId) || controller.signal.aborted) return;

        if (data.status) {
          assistantMsg.status = data.status;
          assistantMsg.statusText = "";
          updateActiveAskThinkingStatus(assistantMsg);
        }

        if (data.model) assistantMsg.model = data.model;
        if (data.groundingMetadata) assistantMsg.groundingMetadata = data.groundingMetadata;

        if (data.chunk) {
          clearAskWaitStages(assistantMsg);
          assistantMsg.status = "";
          assistantMsg.statusText = "";
          accumulatedFullText += data.chunk;
          typewriter.append(data.chunk);
        }

        if (data.done) {
          clearAskWaitStages(assistantMsg);
          const finalReply = data.reply || accumulatedFullText;
          accumulatedFullText = finalReply;
          if (data.groundingMetadata) {
            assistantMsg.groundingMetadata = data.groundingMetadata;
          }
          freshAskResponses.delete(assistantMsg);
          typewriter.finish(finalReply);
          assistantMsg.interactionId = data.interactionId || assistantMsg.interactionId;
          rememberSavedAskChat(data.chat);
          if (typeof data.remainingGuestMessages === "number") {
            state.guestQuotaVersion += 1;
            state.remainingGuestMessages = data.remainingGuestMessages;
            state.guestQuotaCheckedAt = Date.now();
          }
        }
      });

      if (isIdentityStale(epoch, expectedUserId) || controller.signal.aborted) return;

      if (typewriter) {
        typewriter.finish(accumulatedFullText);
        await typewriter.waitForCompletion();
      }
      if (isIdentityStale(epoch, expectedUserId) || controller.signal.aborted) return;
      if (accumulatedFullText) {
        assistantMsg.content = accumulatedFullText;
      }
    } else {
      const data = await response.json();
      if (isIdentityStale(epoch, expectedUserId) || controller.signal.aborted) return;
      assistantMsg.content = data.reply;
      assistantMsg.model = data.model || "gemini-3.8-flash";
      assistantMsg.interactionId = data.interactionId || assistantMsg.interactionId;
      assistantMsg.isStreaming = false;
      rememberSavedAskChat(data.chat);
      if (typeof data.remainingGuestMessages === "number") {
        state.guestQuotaVersion += 1;
        state.remainingGuestMessages = data.remainingGuestMessages;
        state.guestQuotaCheckedAt = Date.now();
      }
    }
  } catch (error) {
    const isAborted = error?.name === "AbortError" || currentAskAbortController?.signal?.aborted || controller.signal.aborted || isIdentityStale(epoch, expectedUserId);
    if (!isAborted) {
      const isGuestLimit = error.message?.includes("Qonaq mesaj limitiniz bitdi") || error.message?.includes("GUEST_DAILY_LIMIT");
      if (isGuestLimit) {
        state.guestQuotaVersion += 1;
        state.remainingGuestMessages = 0;
        state.askError = "";
      } else {
        state.askError = error.message;
      }
    }
  } finally {
    clearAskWaitStages(assistantMsg);
    typewriter?.flush();
    if (activeAskTypewriter === typewriter) activeAskTypewriter = null;
    if (currentAskAbortController === controller) {
      currentAskAbortController = null;
      activeAskReader = null;
    }
    if (!isIdentityStale(epoch, expectedUserId)) {
      if (accumulatedFullText && (!assistantMsg.content || assistantMsg.content.length < accumulatedFullText.length)) {
        assistantMsg.content = accumulatedFullText;
      }
      assistantMsg.isStreaming = false;
      state.askLoading = false;
      const msgIdx = state.askMessages.indexOf(assistantMsg);
      if (!finalizeStreamingAskMessageDom(assistantMsg, msgIdx >= 0 ? msgIdx : messageIndex)) {
        render();
      }
    }
  }
}

// Keep identical retries tied to one admitted operation. A revision change is a
// different payload and therefore must receive a fresh idempotency key.
function createAskRequestOperation(payload) {
  const body = JSON.stringify(payload);
  const key = window.helmerSecurity?.idempotencyKey?.() || crypto.randomUUID();
  return {
    send(signal) {
      return fetch('/api/ask', {
        method: 'POST', signal,
        headers: {
          'Content-Type': 'application/json', Accept: 'text/event-stream',
          'Idempotency-Key': key,
          'X-Helmer-Model-Improvement': String(isModelImprovementActive()),
        },
        body,
      });
    },
    withRevision(chatRevision) { return createAskRequestOperation({ ...JSON.parse(body), chatRevision }); },
  };
}

// Shared by Ask send, Thinking regeneration and the compact Ask conversation.
// Preserve UTF-8/CRLF boundaries, cap frames, and require a committed done event.
async function consumeAskEventStream(reader, onEvent, { maxFrameChars = 8 * 1024 * 1024, idleTimeoutMs = 65000 } = {}) {
  const decoder = new TextDecoder();
  let buffer = '', lines = [], frameChars = 0, completed = false;
  const protocolError = () => new Error(getLanguage() === 'en'
    ? 'The response stream was interrupted or invalid. Please retry.'
    : 'Cavab axını kəsildi və ya düzgün deyil. Yenidən cəhd edin.');
  const dispatch = async () => {
    if (!lines.length) return;
    const dataText = lines.join('\n');
    lines = []; frameChars = 0;
    if (dataText === '[DONE]') return;
    let data;
    try { data = JSON.parse(dataText); } catch { throw protocolError(); }
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw protocolError();
    if (data.error) {
      const isEn = getLanguage() === 'en';
      if (['ASK_TIMEOUT', 'ASK_PROVIDER_TIMEOUT', 'EXECUTION_TIMEOUT'].includes(data.code)) {
        throw new Error(isEn ? 'The response timed out. Please retry.' : 'Cavab üçün gözləmə müddəti bitdi. Yenidən cəhd edin.');
      }
      if (data.code === 'GROUNDING_UNAVAILABLE') {
        throw new Error(isEn ? 'Web Search could not verify any sources. Please retry.' : 'Veb axtarışı mənbələri təsdiqləyə bilmədi. Yenidən cəhd edin.');
      }
      throw new Error(typeof data.error === 'string' ? data.error : protocolError().message);
    }
    if (data.chunk !== undefined && typeof data.chunk !== 'string') throw protocolError();
    if (data.reply !== undefined && typeof data.reply !== 'string') throw protocolError();
    await onEvent(data);
    if (data.done === true) completed = true;
  };
  const processLines = async () => {
    let end;
    while (!completed && (end = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, end).replace(/\r$/, '');
      buffer = buffer.slice(end + 1);
      if (!line) await dispatch();
      else if (line.startsWith('data:')) {
        const value = line.slice(5).replace(/^ /, '');
        frameChars += value.length;
        if (frameChars > maxFrameChars) throw protocolError();
        lines.push(value);
      }
    }
    if (buffer.length + frameChars > maxFrameChars) throw protocolError();
  };
  try {
    while (!completed) {
      let timer;
      const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(protocolError()), idleTimeoutMs); });
      let next;
      try { next = await Promise.race([reader.read(), timeout]); }
      finally { clearTimeout(timer); }
      if (next.done) {
        buffer += decoder.decode();
        if (buffer) buffer += '\n';
        await processLines();
        if (!completed) await dispatch();
        break;
      }
      buffer += decoder.decode(next.value, { stream: true });
      await processLines();
    }
    if (!completed) throw protocolError();
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

async function submitAskMessage(message, attachedFile = null, { preserveWhitespace = false, retryOperation = null } = {}) {
  const selectedStrategy = state.savedStrategies.find((strategy) => strategy.id === state.askStrategyId) || null;
  const selectedTask = state.plannerTasks.find((task) => task.id === state.askTaskId) || null;
  const fileToAttach = attachedFile || state.askPendingFile || null;
  state.askPendingFile = null;

  if (!state.currentUser) {
    if (fileToAttach) {
      openGuestRestrictionModal(GUEST_RESTRICTION_NOTICES.file);
      return;
    }
    if (selectedStrategy || state.askStrategyId) {
      openGuestRestrictionModal(GUEST_RESTRICTION_NOTICES.strategy);
      return;
    }
    if (selectedTask || state.askTaskId) {
      openGuestRestrictionModal(GUEST_RESTRICTION_NOTICES.planner);
      return;
    }
    if (state.askThinkingEnabled) {
      openGuestRestrictionModal(GUEST_RESTRICTION_NOTICES.thinking);
      return;
    }
  }

  const pluginIds = [...(state.askPluginIds || [])];
  const artifactId = state.askArtifactId || undefined;
  const messageIndex = state.askMessages.length;
  state.askPluginIds = [];
  state.askArtifactId = null;
  state.askArtifactName = "";
  state.askRetry = null;

  const contentText = message ? (preserveWhitespace ? String(message) : String(message).trim()) : (fileToAttach ? `Bu faylı analiz et: ${fileToAttach.name}` : "");

  const hasArtifactPlugin = pluginIds.some(id => ["word", "excel", "powerpoint", "pdf"].includes(id));
  const isDeepResearch = !hasArtifactPlugin && (
    pluginIds.includes("deep-research") ||
    pluginIds.includes("research") ||
    /(?:^|\s)@(deep-research|research)\b/i.test(contentText) ||
    state.askSubMode === "research"
  );

  if (isDeepResearch && !pluginIds.includes("deep-research")) {
    pluginIds.push("deep-research");
  }

  const cleanResearchPrompt = isDeepResearch
    ? contentText.replace(/(?:^|\s)@(deep-research|research)\b/i, " ").trim() || contentText
    : contentText;

  state.askMessages.push({
    role: "user",
    content: contentText,
    pluginIds,
    file: fileToAttach ? { ...fileToAttach } : undefined,
    strategyTitle: selectedStrategy?.title || "",
    taskTitle: selectedTask?.text || "",
  });

  const epoch = state.identityEpoch;
  const expectedUserId = state.currentUser?.id || null;

  if (isDeepResearch) {
    const isEn = getLanguage() === "en";
    const assistantMsg = {
      role: "assistant",
      type: "research",
      status: "pending",
      model: "gemini-3.8-flash",
      query: cleanResearchPrompt,
      steps: [
        { key: "plan", label: isEn ? "Formulating research plan…" : "Mövzu üzrə araşdırma planı hazırlanır…", status: "running", timestamp: new Date().toISOString() },
        { key: "search", label: isEn ? "Analyzing live web sources and competitors…" : "Veb mənbələr analiz edilir…", status: "pending", timestamp: new Date().toISOString() },
        { key: "verify", label: isEn ? "Cross-verifying facts and statistics…" : "Faktlar çarpaz yoxlanılır…", status: "pending", timestamp: new Date().toISOString() },
        { key: "synthesize", label: isEn ? "Synthesizing deep strategic findings…" : "Nəticə sintez olunur…", status: "pending", timestamp: new Date().toISOString() },
      ],
      sources: [],
      content: "",
      createdAt: new Date().toISOString(),
    };
    state.askMessages.push(assistantMsg);
    state.askLoading = true;
    state.askError = "";
    trackEvent("ask_research_started", { promptLength: cleanResearchPrompt.length });
    render();

    currentAskAbortController?.abort();
    const researchInitController = new AbortController();
    currentAskAbortController = researchInitController;

    try {
      const response = await fetch("/api/ask/research", {
        method: "POST",
        signal: researchInitController.signal,
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json",
        },
        body: JSON.stringify({
          prompt: cleanResearchPrompt,
          chatId: state.askChatId || undefined,
          strategyId: state.askStrategyId || undefined,
          taskId: state.askTaskId || undefined,
          language: getLanguage(),
        }),
      });

      if (isIdentityStale(epoch, expectedUserId) || researchInitController.signal.aborted) return;

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || (isEn ? "Failed to start research." : "Araşdırmanı başlatmaq mümkün olmadı."));
      }

      const data = await response.json();
      if (isIdentityStale(epoch, expectedUserId) || researchInitController.signal.aborted) return;
      assistantMsg.jobId = data.jobId;
      if (data.chatId) {
        state.askChatId = data.chatId;
        if (data.chatRevision) window.helmerSecurity?.revisions.set(data.chatId, data.chatRevision);
        rememberActiveAskChat(data.chatId);
      }
      if (data.message?.id) assistantMsg.id = data.message.id;
      render();
      connectToResearchJobStream(assistantMsg);
    } catch (err) {
      if (err?.name === "AbortError" || isIdentityStale(epoch, expectedUserId) || researchInitController.signal.aborted) return;
      assistantMsg.status = "failed";
      assistantMsg.error = err.message;
      state.askError = err.message;
      render();
    } finally {
      if (currentAskAbortController === researchInitController) currentAskAbortController = null;
      if (!isIdentityStale(epoch, expectedUserId)) {
        state.askLoading = false;
        render();
      }
    }
    return;
  }

  const chosenModel = "gemini-3.8-flash";
  const initialPlaceholderModel = "gemini-3.8-flash";
  const assistantMsg = {
    role: "assistant",
    content: "",
    model: initialPlaceholderModel,
    isStreaming: true,
  };
  setAskMessageMeta(assistantMsg, {
    thinkingLevel: state.askThinkingEnabled ? (currentAskThinking || "low") : "auto",
    thinkingEnabled: Boolean(state.askThinkingEnabled),
    userPrompt: contentText,
  });
  state.askMessages.push(assistantMsg);
  state.askLoading = true;
  state.askError = "";
  freshAskResponses.add(assistantMsg);
  trackEvent("ask_message_sent", { messageCount: state.askMessages.length, model: chosenModel, hasFile: Boolean(fileToAttach) });
  render();
  startAskWaitStages(assistantMsg);

  let typewriter = null;
  let accumulatedFullText = "";
  let finalEventReceived = false;

  currentAskAbortController?.abort();
  const controller = new AbortController();
  currentAskAbortController = controller;
  activeAskReader = null;
  activeAskTypewriter = null;

  const apiThinkingLevel = (state.askThinkingEnabled && ["low", "medium", "high", "off"].includes(currentAskThinking))
    ? currentAskThinking
    : undefined;

  let askOperation = retryOperation || createAskRequestOperation({
    messages: state.askMessages.slice(0, -1).map(sanitizeAskMessageForApi),
    model: chosenModel,
    thinkingLevel: apiThinkingLevel,
    strategyId: state.askStrategyId || undefined,
    taskId: state.askTaskId || undefined,
    chatId: state.askChatId || undefined,
    chatRevision: state.askChatId ? (window.helmerSecurity?.getRevision(state.askChatId) || 1) : undefined,
    pluginIds,
    artifactId,
    stream: true,
  });
  try {
    let response = await askOperation.send(controller.signal);
    if (isIdentityStale(epoch, expectedUserId) || controller.signal.aborted) return;

    if (!response.ok && (response.status === 409 || response.status === 429)) {
      const errData = await response.clone().json().catch(() => ({}));
      if (isIdentityStale(epoch, expectedUserId) || controller.signal.aborted) return;
      if (response.status === 429 && errData.code === "EXECUTION_BUSY" && !controller.signal.aborted) {
        await new Promise((resolve) => setTimeout(resolve, 650));
        if (!controller.signal.aborted && !isIdentityStale(epoch, expectedUserId)) {
          response = await askOperation.send(controller.signal);
        }
      }
      if (isIdentityStale(epoch, expectedUserId) || controller.signal.aborted) return;
      if (!response.ok && response.status === 409) {
        const conflictData = await response.clone().json().catch(() => ({}));
        if (isIdentityStale(epoch, expectedUserId) || controller.signal.aborted) return;
        if (conflictData.code === "REVISION_CONFLICT" && state.askChatId && conflictData.revision) {
          window.helmerSecurity?.revisions.set(state.askChatId, conflictData.revision);
          askOperation = askOperation.withRevision(conflictData.revision);
          response = await askOperation.send(controller.signal);
          if (isIdentityStale(epoch, expectedUserId) || controller.signal.aborted) return;
        }
      }
    }

    if (!response.ok) {
      if (response.status === 401 && activeHomepageIntent) {
        window.dispatchEvent(new CustomEvent("helmer:auth-required"));
      }
      const errData = await response.json().catch(() => ({}));
      if (isIdentityStale(epoch, expectedUserId) || controller.signal.aborted) return;
      if (response.status === 409 && errData.code === "REVISION_CONFLICT" && state.askChatId && errData.revision) {
        window.helmerSecurity?.revisions.set(state.askChatId, errData.revision);
      }
      if (errData.code === "GUEST_DAILY_LIMIT" || (response.status === 429 && errData.error?.includes("Qonaq"))) {
        state.guestQuotaVersion += 1;
        state.remainingGuestMessages = 0;
        state.askError = "";
        state.askRetry = null;
        if (!assistantMsg.content) {
          const idx = state.askMessages.indexOf(assistantMsg);
          if (idx !== -1) state.askMessages.splice(idx, 1);
        }
        render();
        return;
      }
      throw new Error(errData.error || "Cavabı hazırlamaq mümkün olmadı.");
    }

    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("text/event-stream")) {
      const reader = response.body.getReader();
      activeAskReader = reader;

      typewriter = new LiveTypewriter(
        (text, isComplete) => {
          if (isIdentityStale(epoch, expectedUserId) || controller.signal.aborted) return;
          assistantMsg.content = text;
          updateActiveAskMessageContent(assistantMsg, !isComplete);
        },
        () => {
          assistantMsg.isStreaming = false;
        }
      );
      activeAskTypewriter = typewriter;

      await consumeAskEventStream(reader, async data => {
        if (isIdentityStale(epoch, expectedUserId) || controller.signal.aborted) return;
        if (data.chatId) {
          state.askChatId = data.chatId;
          if (data.chatRevision) window.helmerSecurity?.revisions.set(data.chatId, data.chatRevision);
          rememberActiveAskChat(data.chatId);
        }

        if (data.status) {
          clearAskWaitStages(assistantMsg);
          assistantMsg.status = data.status;
          assistantMsg.statusText = data.statusText || "";
          updateActiveAskThinkingStatus(assistantMsg);
        }

        if (data.model) assistantMsg.model = data.model;
        if (data.groundingMetadata) assistantMsg.groundingMetadata = data.groundingMetadata;

        if (data.chunk) {
          clearAskWaitStages(assistantMsg);
          assistantMsg.status = "";
          assistantMsg.statusText = "";
          accumulatedFullText += data.chunk;
          typewriter.append(data.chunk);
        }

        if (data.done) {
          finalEventReceived = true;
          assistantMsg.artifacts = data.artifacts || [];
          assistantMsg.execution = data.execution;
          clearAskWaitStages(assistantMsg);
          const finalReply = data.reply || accumulatedFullText;
          accumulatedFullText = finalReply;
          if (data.groundingMetadata) {
            assistantMsg.groundingMetadata = data.groundingMetadata;
          }
          freshAskResponses.delete(assistantMsg);
          typewriter.finish(finalReply);
          assistantMsg.interactionId = data.interactionId || assistantMsg.interactionId;
          rememberSavedAskChat(data.chat);
          if (typeof data.remainingGuestMessages === "number") {
            state.guestQuotaVersion += 1;
            state.remainingGuestMessages = data.remainingGuestMessages;
            state.guestQuotaCheckedAt = Date.now();
          }
          if (data.restrictedFeature) {
            openGuestRestrictionModal(data.reply);
          }
        }
      });

      if (isIdentityStale(epoch, expectedUserId) || controller.signal.aborted) return;

      if (!finalEventReceived) throw new Error(getLanguage() === "en" ? "The connection ended before the task completed. Please retry." : "Tapşırıq tamamlanmadan bağlantı kəsildi. Yenidən cəhd edin.");

      if (typewriter) {
        typewriter.finish(accumulatedFullText);
        await typewriter.waitForCompletion();
      }
      if (isIdentityStale(epoch, expectedUserId) || controller.signal.aborted) return;
      if (accumulatedFullText) {
        assistantMsg.content = accumulatedFullText;
      }
    } else {
      const data = await response.json();
      if (isIdentityStale(epoch, expectedUserId) || controller.signal.aborted) return;
      assistantMsg.artifacts = data.artifacts || [];
      assistantMsg.execution = data.execution;
      assistantMsg.content = data.reply;
      assistantMsg.model = data.model || assistantMsg.model;
      assistantMsg.interactionId = data.interactionId || assistantMsg.interactionId;
      if (data.groundingMetadata) {
        assistantMsg.groundingMetadata = data.groundingMetadata;
      }
      assistantMsg.isStreaming = false;
      rememberSavedAskChat(data.chat);
      if (typeof data.remainingGuestMessages === "number") {
        state.guestQuotaVersion += 1;
        state.remainingGuestMessages = data.remainingGuestMessages;
        state.guestQuotaCheckedAt = Date.now();
      }
    }
  } catch (error) {
    const isAborted = error?.name === "AbortError" || currentAskAbortController?.signal?.aborted || controller.signal.aborted || isIdentityStale(epoch, expectedUserId);
    if (!isAborted) {
      const isGuestLimit = error.message?.includes("Qonaq mesaj limitiniz bitdi") || error.message?.includes("GUEST_DAILY_LIMIT");
      if (isGuestLimit) {
        state.guestQuotaVersion += 1;
        state.remainingGuestMessages = 0;
        state.askError = "";
        state.askRetry = null;
      } else {
        state.askError = error.message;
        state.askRetry = { message: contentText, file: fileToAttach, pluginIds, artifactId, messageIndex, operation: askOperation };
      }
    }
    if (!isIdentityStale(epoch, expectedUserId) && !assistantMsg.content && !accumulatedFullText) {
      const idx = state.askMessages.indexOf(assistantMsg);
      if (idx !== -1) state.askMessages.splice(idx, 1);
    }
  } finally {
    clearAskWaitStages(assistantMsg);
    typewriter?.flush();
    if (activeAskTypewriter === typewriter) activeAskTypewriter = null;
    if (currentAskAbortController === controller) {
      currentAskAbortController = null;
      activeAskReader = null;
    }
    if (!isIdentityStale(epoch, expectedUserId)) {
      if (accumulatedFullText && (!assistantMsg.content || assistantMsg.content.length < accumulatedFullText.length)) {
        assistantMsg.content = accumulatedFullText;
      }
      for (const msg of state.askMessages) {
        if (msg && msg.file && (msg.file.data || msg.file.textContent)) {
          delete msg.file.data;
          delete msg.file.textContent;
        }
      }
      assistantMsg.isStreaming = false;
      state.askLoading = false;
      const msgIdx = state.askMessages.indexOf(assistantMsg);
      if (!finalizeStreamingAskMessageDom(assistantMsg, msgIdx >= 0 ? msgIdx : messageIndex + 1)) {
        render();
      }
    }
  }
}



let buildIntelligenceCleanup = null;

function stopBuildIntelligence() {
  buildIntelligenceCleanup?.();
  buildIntelligenceCleanup = null;
}

// Decorative only: motion never advances the Build workflow or implies progress.
function animateBuildIntelligence(canvas) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return () => {};
  const epoch = state.identityEpoch;
  const expectedUserId = state.currentUser?.id || null;
  const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let frame = 0, disposed = false, time = 0, previous = 0;
  let width = 0, height = 0, ratio = 0;
  let yaw = 0, pitch = 0, velocityX = 0, velocityY = 0;
  let hoverX = 0, hoverY = 0, leanX = 0, leanY = 0;
  let pointer = null;
  const clamp = (value, limit) => Math.max(-limit, Math.min(limit, value));
  function position(event) {
    const rect = canvas.getBoundingClientRect();
    const radius = Math.min(rect.width * 0.255, rect.height * 0.35);
    const x = event.clientX - rect.left - rect.width / 2;
    const y = event.clientY - rect.top - rect.height / 2;
    return { x, y, inside: x*x + y*y <= radius*radius*1.2 };
  }
  function wake() {
    if (!disposed && !frame) frame = requestAnimationFrame(draw);
  }
  function pointerDown(event) {
    if (disposed || pointer || event.isPrimary === false || event.button !== 0 || !position(event).inside) return;
    pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, at: event.timeStamp };
    velocityX = velocityY = 0;
    canvas.setPointerCapture?.(event.pointerId);
    canvas.classList.add("is-dragging");
    wake();
  }
  function pointerMove(event) {
    if (disposed) return;
    if (pointer) {
      if (pointer.id !== event.pointerId) return;
      const dt = Math.max(8, event.timeStamp - pointer.at) / 1000;
      const dx = clamp((event.clientX - pointer.x) * 0.006, 0.3);
      const dy = clamp((event.clientY - pointer.y) * 0.006, 0.3);
      yaw += dx; pitch += dy;
      velocityX = velocityX * 0.4 + clamp(dx / dt, 2.5) * 0.6;
      velocityY = velocityY * 0.4 + clamp(dy / dt, 2.5) * 0.6;
      pointer.x = event.clientX; pointer.y = event.clientY; pointer.at = event.timeStamp;
    } else if (event.pointerType !== "touch") {
      const point = position(event);
      hoverX = point.inside ? clamp(point.x / 650, 0.18) : 0;
      hoverY = point.inside ? clamp(point.y / 650, 0.18) : 0;
      canvas.classList.toggle("is-hovered", point.inside);
    }
    wake();
  }
  function pointerEnd(event) {
    if (!pointer || (event && event.pointerId !== pointer.id)) return;
    const id = pointer.id;
    // A held-still release or browser scroll cancellation must not fling the core.
    if (!event || event.type !== "pointerup" || event.timeStamp - pointer.at > 100 || motion.matches) velocityX = velocityY = 0;
    pointer = null;
    if (canvas.hasPointerCapture?.(id)) canvas.releasePointerCapture(id);
    canvas.classList.remove("is-dragging");
    wake();
  }
  function pointerLeave() {
    hoverX = hoverY = 0;
    canvas.classList.remove("is-hovered");
    wake();
  }
  const pointerEvents = { pointerdown: pointerDown, pointermove: pointerMove, pointerup: pointerEnd, pointercancel: pointerEnd, lostpointercapture: pointerEnd, pointerleave: pointerLeave };
  for (const [name, handler] of Object.entries(pointerEvents)) canvas.addEventListener(name, handler);
  const compact = () => canvas.clientWidth < 480 || (navigator.hardwareConcurrency || 8) <= 4;
  const particles = Array.from({ length: 1100 }, (_, i) => {
    const y = 1 - 2 * (i + 0.5) / 1100;
    const angle = i * Math.PI * (3 - Math.sqrt(5));
    const ring = Math.sqrt(1 - y * y);
    return { x: Math.cos(angle) * ring, y, z: Math.sin(angle) * ring, layer: i % 5 === 0 ? 0.78 : 1 };
  });
  function dispose() {
    if (disposed) return;
    disposed = true;
    pointerEnd();
    for (const [name, handler] of Object.entries(pointerEvents)) canvas.removeEventListener(name, handler);
    canvas.classList.remove("is-hovered", "is-dragging");
    cancelAnimationFrame(frame);
    resize.disconnect();
    removal.disconnect();
    motion.removeEventListener("change", restart);
    document.removeEventListener("visibilitychange", restart);
    window.removeEventListener("resize", restart);
  }
  function draw(now) {
    frame = 0;
    if (disposed) return;
    if (!canvas.isConnected || isIdentityStale(epoch, expectedUserId)) { dispose(); return; }
    if (document.hidden) return;
    const reduced = motion.matches;
    const dt = previous ? Math.min(now - previous, 50) / 1000 : 0;
    if (!reduced) {
      time += dt;
      if (!pointer) {
        const damping = Math.exp(-2.4 * dt);
        yaw += (0.11 + Math.sin(time * 0.19) * 0.025) * dt + velocityX * (1 - damping) / 2.4;
        pitch += velocityY * (1 - damping) / 2.4;
        velocityX *= damping; velocityY *= damping;
      }
      const easing = 1 - Math.exp(-5 * dt);
      leanX += (hoverX - leanX) * easing;
      leanY += (hoverY - leanY) * easing;
    } else {
      velocityX = velocityY = leanX = leanY = 0;
    }
    previous = now;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (width !== w || height !== h || ratio !== dpr) {
      width = w; height = h; ratio = dpr;
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    ctx.clearRect(0, 0, w, h);
    const radius = Math.min(w * 0.255, h * 0.35) * (1 + Math.sin(time * 0.7) * 0.025);
    const cx = w / 2, cy = h / 2;
    const glow = ctx.createRadialGradient(cx, cy, radius * 0.25, cx, cy, radius * 1.65);
    glow.addColorStop(0, "rgba(62,132,245,0.13)");
    glow.addColorStop(0.6, "rgba(62,132,245,0.065)");
    glow.addColorStop(1, "rgba(62,132,245,0)");
    ctx.fillStyle = glow; ctx.fillRect(0, 0, w, h);
    // Bezier streams are an abstract visual metaphor, not research events.
    const streams = compact() ? 4 : 8;
    for (let i = 0; i < streams; i++) {
      const angle = i * Math.PI * 2 / streams + 0.2 + Math.sin(time * 0.17 + i) * 0.035;
      const sx = cx + Math.cos(angle) * w * 0.48;
      const sy = cy + Math.sin(angle) * h * 0.44;
      const ex = cx + Math.cos(angle + 0.5) * radius * 0.85;
      const ey = cy + Math.sin(angle + 0.5) * radius * 0.85;
      const mx = cx + Math.cos(angle - 0.35) * radius * 1.65;
      const my = cy + Math.sin(angle - 0.35) * radius * 1.65;
      ctx.beginPath(); ctx.moveTo(sx, sy); ctx.quadraticCurveTo(mx, my, ex, ey);
      ctx.strokeStyle = "rgba(98,155,240,0.15)"; ctx.lineWidth = 0.75; ctx.stroke();
      let t = (time * 0.12 + i / streams) % 1;
      if (i % 3 === 0) t = 1 - t;
      // A short fading trail gives each impulse direction without a bright flare.
      for (let tail = 4; tail >= 0; tail--) {
        const u = t + (i % 3 === 0 ? 1 : -1) * tail * 0.012;
        if (u < 0 || u > 1) continue;
        const x = (1-u)**2*sx + 2*(1-u)*u*mx + u*u*ex;
        const y = (1-u)**2*sy + 2*(1-u)*u*my + u*u*ey;
        ctx.beginPath(); ctx.arc(x, y, tail === 0 ? 1.55 : 0.9, 0, Math.PI*2);
        ctx.fillStyle = `rgba(145,193,255,${Math.sin(u*Math.PI)*0.8/(tail+1)})`; ctx.fill();
      }
    }
    const rotation = yaw + leanX;
    const tilt = pitch + leanY + Math.sin(time * 0.23) * 0.06;
    const cos = Math.cos(rotation), sin = Math.sin(rotation);
    const tiltCos = Math.cos(tilt), tiltSin = Math.sin(tilt);
    const stride = compact() ? 3 : 1;
    for (let i = 0; i < particles.length; i += stride) {
      const p = particles[i];
      const x = p.x*cos + p.z*sin, rotatedZ = p.z*cos - p.x*sin;
      const y = p.y*tiltCos - rotatedZ*tiltSin;
      const z = p.y*tiltSin + rotatedZ*tiltCos;
      const depth = (z + 1) / 2;
      const ripple = 1 + Math.sin(p.y*7 + time*1.1) * 0.018;
      const scale = radius * p.layer * ripple * (0.86 + depth*0.18);
      ctx.beginPath(); ctx.arc(cx+x*scale, cy+y*scale, 0.4+depth*1.15, 0, Math.PI*2);
      const light = Math.max(0, -x * 0.3 - y * 0.35 + z * 0.55);
      const pulse = 0.94 + Math.sin(p.y * 5 - time * 0.9) * 0.06;
      ctx.fillStyle = `rgba(${Math.round(95+depth*75+light*25)},${Math.round(155+depth*55+light*15)},255,${(0.1+depth*0.7+light*0.12)*pulse})`;
      ctx.fill();
    }
    if (!reduced) frame = requestAnimationFrame(draw);
  }
  function restart() {
    if (disposed) return;
    pointerEnd();
    cancelAnimationFrame(frame); previous = 0;
    frame = requestAnimationFrame(draw);
  }
  const resize = new ResizeObserver(restart);
  resize.observe(canvas);
  const removal = new MutationObserver(() => { if (!canvas.isConnected) dispose(); });
  removal.observe(workspace, { childList: true });
  motion.addEventListener("change", restart);
  document.addEventListener("visibilitychange", restart);
  window.addEventListener("resize", restart);
  restart();
  return dispose;
}

function syncBuildMenuActions(railActions) {
  document.querySelectorAll(".build-menu-actions").forEach(section => section.remove());
  const navigation = document.querySelector(".sidebar .primary-nav");
  if (!navigation) return;
  const isEn = getLanguage() === "en";
  const section = element("section", "build-menu-actions");
  section.setAttribute("aria-label", isEn ? "Build actions" : "Build əməliyyatları");
  section.append(element("div", "sidebar-label", isEn ? "CURRENT BUILD" : "CARİ BUILD"));
  for (const action of railActions.querySelectorAll("button")) {
    const item = element("button", "nav-item");
    item.type = "button";
    const icon = action.querySelector("svg");
    if (icon) {
      const menuIcon = icon.cloneNode(true);
      menuIcon.classList.add("nav-svg");
      item.append(menuIcon);
    }
    item.append(element("span", "", action.querySelector("span")?.textContent || action.getAttribute("aria-label")));
    item.addEventListener("click", () => {
      // Delegate to the visible rail action so confirmation and execution stay shared.
      if (!action.isConnected) return;
      closeSidebar();
      action.click();
    });
    section.append(item);
  }
  navigation.before(section);
}

function renderLoading() {
  const isEn = getLanguage() === "en";
  workspace.classList.add("workspace-centered");
  const isAssessment = state.status === "analyzing";
  const view = element("section", `loading-view intelligence-view ${isAssessment ? "is-assessment" : "is-generation"}`);
  const statusLine = element("div", "loading-status-line");
  statusLine.append(element("span", "loading-live-dot"), element("span", "loading-eyebrow", "BUILD / INTELLIGENCE"));
  const heading = element("div", "intelligence-heading");
  heading.setAttribute("aria-live", "polite");
  const title = element("h1", "loading-title", isAssessment
    ? (isEn ? "Understanding your ambition" : "İdeyanı anlamaqdan başlayırıq")
    : (isEn ? "Your strategy is taking shape" : "Strategiyanız formalaşır"));
  const intro = element("p", "loading-intro", isAssessment
    ? (isEn ? "Your brief sets the direction. We’re evaluating the context and the next step." : "Brifiniz istiqaməti müəyyən edir. Konteksti və növbəti addımı qiymətləndiririk.")
    : (isEn ? "Turning your brief into a structured strategy and an actionable plan." : "Brifinizi strukturlaşdırılmış strategiyaya və icra planına çeviririk."));
  heading.append(title, intro);
  const core = element("div", "intelligence-core");
  core.setAttribute("aria-hidden", "true");
  const canvas = element("canvas", "intelligence-canvas");
  core.append(canvas);
  const activity = element("div", "intelligence-status");
  activity.setAttribute("role", "status");
  activity.append(element("span", "intelligence-status-dot"), element("span", "", isAssessment
    ? (isEn ? "Brief analysis in progress" : "Brif analizi davam edir")
    : (isEn ? "Strategy generation in progress" : "Strategiya hazırlanır")));
  const progress = element("ol", "intelligence-workflow");
  const labels = isEn ? ["Brief analysis", "Strategy", "Ready"] : ["Brif analizi", "Strategiya", "Hazır"];
  labels.forEach((label, index) => {
    const current = isAssessment ? 0 : 1;
    const step = element("li", index < current ? "is-complete" : index === current ? "is-current" : "is-upcoming");
    if (index === current) step.setAttribute("aria-current", "step");
    step.append(element("span", "intelligence-rail"), element("span", "", label));
    progress.append(step);
  });
  // One shared action group for desktop and mobile; existing handlers own execution.
  const topActions = element("div", "loading-top-actions build-rail-actions");
  topActions.setAttribute("role", "group");
  topActions.setAttribute("aria-label", isEn ? "Build actions" : "Build əməliyyatları");
  topActions.id = "loadingTopActions";

  if (!isAssessment) {
    const bgBtn = element("button", "loading-back-button");
    bgBtn.type = "button";
    bgBtn.setAttribute("aria-label", isEn ? "Continue in background" : "İşi arxa planda davam etdir");
    bgBtn.title = isEn ? "Continue in background" : "İşi arxa planda davam etdir";
    bgBtn.innerHTML = `
      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
        <polyline points="15 3 21 3 21 9"></polyline>
        <line x1="10" y1="14" x2="21" y2="3"></line>
      </svg>
      <span>${isEn ? "Continue in background" : "İşi arxa planda davam etdir"}</span>
    `;
    bgBtn.addEventListener("click", () => {
      const confirmMsg = isEn
        ? "Your strategy is being generated in the background and will be automatically saved to your Archive. Return to Home?"
        : "Əsas səhifəyə qayıdırsınız. Bu strategiyanın hazırlanmasını arxa planda davam etdirmək istəyirsiniz? Nəticə hazır olduqda Arxiv bölməsində saxlanılacaq.";
      if (window.confirm(confirmMsg)) {
        minimizeToBackground();
      }
    });
    topActions.appendChild(bgBtn);
  }

  const desktopCancelBtn = element("button", "loading-cancel-button");
  desktopCancelBtn.type = "button";
  desktopCancelBtn.setAttribute("aria-label", isEn ? "Stop brief analysis" : "Brif analizini dayandır");
  desktopCancelBtn.title = isEn ? "Stop analysis" : "Analizi dayandır";
  desktopCancelBtn.innerHTML = `
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="12" cy="12" r="10"/><rect x="9" y="9" width="6" height="6" fill="currentColor" rx="1"/>
    </svg>
    <span>${isEn ? "Stop" : "Dayandır"}</span>
  `;
  desktopCancelBtn.addEventListener("click", () => {
    const confirmCancelMsg = isEn ? "Are you sure you want to stop the analysis?" : "Brif analizini dayandırmaq istədiyinizdən əminsiniz?";
    if (window.confirm(confirmCancelMsg)) cancelCurrentAnalysis();
  });

  const desktopHistoryBtn = element("button", "loading-history-button");
  desktopHistoryBtn.type = "button";
  desktopHistoryBtn.setAttribute("aria-label", isEn ? "History" : "Tarixçə");
  desktopHistoryBtn.title = isEn ? "Chat and brief history" : "Söhbət və brif tarixçəsi";
  desktopHistoryBtn.innerHTML = `
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 15"/>
    </svg>
    <span>${isEn ? "History" : "Tarixçə"}</span>
    ${state.answers && state.answers.length > 0 ? `<span class="loading-history-badge">${state.answers.length}</span>` : ""}
  `;
  desktopHistoryBtn.addEventListener("click", () => showAnalysisHistoryModal(isAssessment));
  if (isAssessment) topActions.append(desktopCancelBtn, desktopHistoryBtn);

  view.append(statusLine, heading, core, activity, progress, createBuildEstimateCard());
  workspace.appendChild(view);
  refreshBuildEstimateCards();
  for (const action of topActions.querySelectorAll("button")) {
    action.className = "rail-button build-rail-action";
    action.dataset.tooltip = action.title;
    action.querySelector("svg")?.setAttribute("aria-hidden", "true");
  }
  const railNav = document.querySelector(".navigation-rail .rail-nav");
  (railNav || document.body).appendChild(topActions);
  syncBuildMenuActions(topActions);
  buildIntelligenceCleanup = animateBuildIntelligence(canvas);
  startBuildCountdown();

}

function cancelCurrentAnalysis() {
  const isEn = getLanguage() === "en";
  clearInterval(progressTimer);
  clearInterval(loadingAskPlaceholderTimer);
  if (currentAbortController) {
    currentAbortController.abort();
    currentAbortController = null;
  }
  document.querySelectorAll(".build-menu-actions, .loading-top-actions, #loadingTopActions, .loading-history-button, #analysisHistoryBtn, .loading-ask-modal-overlay").forEach((el) => el.remove());
  state.status = "draft";
  showToast(isEn ? "Brief analysis canceled." : "Brif analizi dayandırıldı.", "default");
  render();
}

function minimizeToBackground() {
  if (state.status !== "generating") return;
  const isEn = getLanguage() === "en";

  const existingJob = backgroundJobs.find((j) => j.idempotencyKey === state.clientSaveId);
  const job = existingJob || {
    id: crypto.randomUUID(),
    ownerId: currentOwnerId(),
    brief: state.brief,
    answers: [...state.answers],
    assumptions: [...state.assumptions],
    idempotencyKey: state.clientSaveId,
    status: "generating",
    strategy: null,
    versions: [],
    startedAt: new Date().toISOString(),
    completedAt: null,
    error: null,
    savedId: null,
  };

  if (!existingJob) {
    backgroundJobs.unshift(job);
  } else {
    job.status = "generating";
    job.error = null;
  }
  persistBackgroundJobs();

  // Detach the controller so resetStrategy doesn't abort it, while still tracking it for logout/identity reset
  const detachedController = currentAbortController;
  if (detachedController) {
    detachedBuildAbortControllers.add(detachedController);
  }
  currentAbortController = null;

  // Reset state to home without aborting
  clearInterval(progressTimer);
  clearInterval(loadingAskPlaceholderTimer);
  document.querySelectorAll(".build-menu-actions, .loading-top-actions, #loadingTopActions, .loading-history-button, #analysisHistoryBtn, .loading-ask-floating-wrap, #loadingAskFloatingWrap, .loading-ask-modal-overlay").forEach((el) => el.remove());
  Object.assign(state, {
    view: "home",
    status: "draft",
    brief: "",
    questions: [],
    clarificationIndex: 0,
    clarificationDrafts: {},
    answers: [],
    assumptions: [],
    understanding: "",
    round: 0,
    strategy: null,
    versions: [],
    savedId: null,
    clientSaveId: crypto.randomUUID(),
    updatedAt: null,
    error: null,
    retry: null,
    changeSummary: "",
    strategyFormat: "blog",
    faqFilter: "",
    faqExpandedAll: false,
  });
  render();
  showToast(isEn ? "Strategy generating in background ✦" : "Strategiya arxa planda hazırlanır ✦", "default");
}

async function autoSaveBackgroundJob(job) {
  const isEn = getLanguage() === "en";
  const epoch = state.identityEpoch;
  const expectedUserId = state.currentUser?.id || null;
  const saveController = new AbortController();
  backgroundResumeAbortControllers.add(saveController);
  try {
    const data = await api("/api/strategy/save", {
      method: "POST",
      signal: saveController.signal,
      body: JSON.stringify({
        clientSaveId: job.idempotencyKey,
        brief: job.brief,
        answers: job.answers,
        strategy: job.strategy,
        versions: job.versions,
      }),
    });
    if (isIdentityStale(epoch, expectedUserId)) return;
    job.savedId = data.strategy.id;
    removeBackgroundJob(job.id);
    await loadSavedStrategies();
    if (isIdentityStale(epoch, expectedUserId)) return;
    showToast(isEn ? "Strategy generated and saved to archive ✓" : "Strategiya hazırlandı və arxivə saxlanıldı ✓");
  } catch (error) {
    if (error?.name === "AbortError" || isIdentityStale(epoch, expectedUserId)) return;
    console.error("Auto-save background job failed:", error);
    persistBackgroundJobs();
  } finally {
    backgroundResumeAbortControllers.delete(saveController);
  }
}

async function resumeBackgroundJobs() {
  backgroundJobs = loadBackgroundJobs();
  if (!backgroundJobs.length) return;
  const isEn = getLanguage() === "en";
  const activeOwner = currentOwnerId();
  const epoch = state.identityEpoch;
  const expectedUserId = state.currentUser?.id || null;

  // Ensure saved strategies are loaded
  if (!state.savedStrategies || !state.savedStrategies.length) {
    try {
      await loadSavedStrategies();
    } catch { }
  }
  if (isIdentityStale(epoch, expectedUserId)) return;

  const jobsToProcess = [...backgroundJobs];
  for (const job of jobsToProcess) {
    if (isIdentityStale(epoch, expectedUserId)) return;
    if (job.ownerId && job.ownerId !== activeOwner) {
      removeBackgroundJob(job.id);
      continue;
    }
    if (isExpiredGroundedBackgroundJob(job)) {
      removeBackgroundJob(job.id);
      continue;
    }
    // Check if the strategy was already saved on server by idempotencyKey or brief
    const alreadySaved = state.savedStrategies.find(
      (s) => (s.clientSaveId && s.clientSaveId === job.idempotencyKey) || (s.brief && s.brief === job.brief)
    );
    if (alreadySaved) {
      removeBackgroundJob(job.id);
      if (state.view === "list") renderStrategyList();
      continue;
    }

    // If ready but not saved to server yet, retry autoSave if enabled
    if (job.status === "ready" && job.strategy && !job.savedId) {
      if (isAutoSaveStrategiesEnabled()) {
        await autoSaveBackgroundJob(job);
      }
      continue;
    }

    if (job.status !== "generating") continue;

    const resumeController = new AbortController();
    backgroundResumeAbortControllers.add(resumeController);
    try {
      const autoSaveActive = isAutoSaveStrategiesEnabled();
      const data = await api("/api/strategy/generate", {
        method: "POST",
        signal: resumeController.signal,
        headers: job.idempotencyKey ? { "Idempotency-Key": job.idempotencyKey } : {},
        body: JSON.stringify({
          brief: job.brief,
          answers: job.answers,
          assumptions: job.assumptions,
          idempotencyKey: job.idempotencyKey,
          autoSave: autoSaveActive,
        }),
      });
      if (isIdentityStale(epoch, expectedUserId) || resumeController.signal.aborted) return;

      // Check if user restored this job to foreground while in flight
      if (state.clientSaveId === job.idempotencyKey && state.status === "generating") {
        state.strategy = data.strategy;
        state.updatedAt = new Date().toISOString();
        state.versions = [{ versionNumber: 1, data: data.strategy, changeRequest: isEn ? "Initial Strategy" : "İlkin strategiya", createdAt: state.updatedAt }];
        if (data.savedId) state.savedId = data.savedId;
        removeBackgroundJob(job.id);
        setStatus(data.savedId ? "saved" : "ready");
        render();
        showToast(data.savedId ? (isEn ? "Strategy generated and saved to archive ✓" : "Strategiya hazırlandı və arxivə saxlanıldı ✓") : (isEn ? "Strategy is ready ✓" : "Strategiya hazırdır ✓"));
        if (data.savedId) await loadSavedStrategies();
        return;
      }

      job.status = "ready";
      job.strategy = data.strategy;
      if (data.savedId) job.savedId = data.savedId;
      job.completedAt = new Date().toISOString();
      job.versions = [{ versionNumber: 1, data: data.strategy, changeRequest: isEn ? "Initial Strategy" : "İlkin strategiya", createdAt: job.completedAt }];
      persistBackgroundJobs();
      if (autoSaveActive && !job.savedId) {
        await autoSaveBackgroundJob(job);
      }
    } catch (err) {
      if (err.name === "AbortError" || resumeController.signal.aborted || isIdentityStale(epoch, expectedUserId)) continue;

      // If temporary network disconnection, keep in generating status and retry on reconnect
      if (!navigator.onLine) {
        continue;
      }

      // Check if server already finished and saved it
      try {
        await loadSavedStrategies();
        if (isIdentityStale(epoch, expectedUserId)) return;
        const savedNow = state.savedStrategies.find(
          (s) => (s.clientSaveId && s.clientSaveId === job.idempotencyKey) || (s.brief && s.brief === job.brief)
        );
        if (savedNow) {
          removeBackgroundJob(job.id);
          if (state.view === "list") renderStrategyList();
          continue;
        }
      } catch { }

      if (isIdentityStale(epoch, expectedUserId)) return;
      if (state.clientSaveId === job.idempotencyKey && state.status === "generating") {
        setError(err, startGeneration, state.questions?.length ? "needs_clarification" : "draft");
        continue;
      }

      job.status = "error";
      job.error = err.message || (isEn ? "An error occurred." : "Xəta baş verdi");
      persistBackgroundJobs();
      if (state.view === "list") renderStrategyList();
    } finally {
      backgroundResumeAbortControllers.delete(resumeController);
    }
  }
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    resumeBackgroundJobs();
  }
});
window.addEventListener("online", () => {
  resumeBackgroundJobs();
});

function openBackgroundJob(jobId) {
  const job = backgroundJobs.find((j) => j.id === jobId);
  if (!job) return;
  if (isExpiredGroundedBackgroundJob(job)) {
    removeBackgroundJob(job.id);
    return;
  }
  const isEn = getLanguage() === "en";

  if (job.status === "ready" && job.strategy) {
    Object.assign(state, {
      view: "home",
      status: job.savedId ? "saved" : "ready",
      brief: job.brief,
      answers: job.answers || [],
      assumptions: job.assumptions || job.strategy?.assumptions || [],
      strategy: job.strategy,
      versions: job.versions || [],
      savedId: job.savedId || null,
      clientSaveId: job.idempotencyKey,
      updatedAt: job.completedAt,
      error: null,
      retry: null,
    });
    removeBackgroundJob(jobId);
    render();
    closeSidebar();
  } else if (job.status === "generating") {
    // Restore to loading view
    Object.assign(state, {
      view: "home",
      status: "generating",
      brief: job.brief,
      answers: job.answers || [],
      assumptions: job.assumptions || [],
      clientSaveId: job.idempotencyKey,
    });
    render();
    closeSidebar();
  } else if (job.status === "error") {
    showToast(job.error || (isEn ? "An error occurred." : "Xəta baş verdi"), "error");
    removeBackgroundJob(jobId);
    if (state.view === "list") renderStrategyList();
  }
}

function showAnalysisHistoryModal(isAssessment = true) {
  const existing = document.querySelector(".analysis-history-overlay");
  if (existing) existing.remove();
  const isEn = getLanguage() === "en";

  const overlay = element("div", "analysis-history-overlay");
  const drawer = element("div", "analysis-history-drawer");
  const dragHandle = element("div", "analysis-history-drag-handle");
  dragHandle.setAttribute("aria-hidden", "true");

  const header = element("div", "analysis-history-header");
  const titleGroup = element("div", "analysis-history-title-group");
  const title = element("h3", "", isEn ? "Brief & Clarification History" : "Söhbət və Brif Tarixçəsi");
  const subtitle = element("p", "", isEn ? "Captured business context and clarification responses" : "Daxil edilmiş məlumatlar və dəqiqləşdirmə dialoqu");
  titleGroup.append(title, subtitle);

  const closeModal = () => {
    document.body.style.overflow = "";
    overlay.remove();
    document.removeEventListener("keydown", handleKeydown);
  };

  const closeBtn = element("button", "analysis-history-close");
  closeBtn.type = "button";
  closeBtn.setAttribute("aria-label", isEn ? "Close" : "Bağla");
  closeBtn.innerHTML = `
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <line x1="18" y1="6" x2="6" y2="18"/>
      <line x1="6" y1="6" x2="18" y2="18"/>
    </svg>
  `;
  closeBtn.addEventListener("click", closeModal);

  header.append(titleGroup, closeBtn);

  const body = element("div", "analysis-history-body");

  // 1. Initial Brief
  if (state.brief) {
    const briefItem = element("div", "history-item history-item-brief");
    briefItem.innerHTML = `
      <div class="history-item-header">
        <span class="history-item-icon user-icon">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/>
            <circle cx="12" cy="7" r="4"/>
          </svg>
        </span>
        <strong class="history-item-sender">${isEn ? "Initial Brief" : "İlkin Brif"}</strong>
        <span class="history-item-tag">${isEn ? "User" : "İstifadəçi"}</span>
      </div>
      <div class="history-item-content">
        <p>${escapeHtml(state.brief)}</p>
      </div>
    `;
    body.appendChild(briefItem);
  }

  // 2. Clarification Questions & Answers
  if (state.answers && state.answers.length > 0) {
    state.answers.forEach((item, idx) => {
      const qaGroup = element("div", "history-qa-group");

      const qItem = element("div", "history-item history-item-model");
      qItem.innerHTML = `
        <div class="history-item-header">
          <span class="history-item-icon ai-icon">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
            </svg>
          </span>
          <strong class="history-item-sender">${isEn ? `Clarification Question #${idx + 1}` : `Dəqiqləşdirmə Sualı #${idx + 1}`}</strong>
          <span class="history-item-tag ai-tag">Helmer</span>
        </div>
        <div class="history-item-content">
          <p>${escapeHtml(item.question)}</p>
        </div>
      `;

      const aItem = element("div", "history-item history-item-user");
      aItem.innerHTML = `
        <div class="history-item-header">
          <span class="history-item-icon user-icon">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="20 6 9 17 4 12"/>
            </svg>
          </span>
          <strong class="history-item-sender">${isEn ? "Your Answer" : "Cavabınız"}</strong>
          <span class="history-item-tag">${isEn ? "User" : "İstifadəçi"}</span>
        </div>
        <div class="history-item-content">
          <p>${escapeHtml(item.answer)}</p>
        </div>
      `;

      qaGroup.append(qItem, aItem);
      body.appendChild(qaGroup);
    });
  } else if (!state.brief) {
    const emptyState = element("div", "history-empty-state");
    emptyState.innerHTML = `<p>${isEn ? "No context recorded yet." : "Hələlik qeydə alınmış məlumat yoxdur."}</p>`;
    body.appendChild(emptyState);
  }

  const footer = element("div", "analysis-history-footer");
  footer.innerHTML = `
    <div class="history-status-indicator">
      <span class="history-pulse-dot"></span>
      <span>${isAssessment ? (isEn ? "Analyzing brief…" : "Brif analiz olunur…") : (isEn ? "Synthesizing strategy…" : "Strategiya formalaşdırılır…")}</span>
    </div>
  `;

  drawer.append(dragHandle, header, body, footer);
  overlay.appendChild(drawer);

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeModal();
  });

  const handleKeydown = (e) => {
    if (e.key === "Escape") {
      closeModal();
    }
  };
  document.addEventListener("keydown", handleKeydown);

  document.body.style.overflow = "hidden";
  document.body.appendChild(overlay);
}

function showLoadingAskModal(initialQuery) {
  const existing = document.querySelector(".loading-ask-modal-overlay");
  if (existing) { existing._closeAskModal?.(); existing.remove(); }
  let modalAskController = null;
  const isEn = getLanguage() === "en";

  const overlay = element("div", "loading-ask-modal-overlay");
  const modal = element("div", "loading-ask-modal");
  const dragHandle = element("div", "analysis-history-drag-handle");
  dragHandle.setAttribute("aria-hidden", "true");

  const header = element("div", "loading-ask-modal-header");
  const titleGroup = element("div", "loading-ask-modal-title-group");
  const titleRow = element("div", "loading-ask-modal-title-row");
  const title = element("h3", "", isEn ? "Strategic Marketing Copilot" : "Helmer-dən soruş");
  titleRow.appendChild(title);

  const statusSub = element("div", "loading-ask-modal-status");
  statusSub.innerHTML = `
    <span class="history-pulse-dot"></span>
    <span>${isEn ? "Brief analysis running in background…" : "Brif analizi arxa planda davam edir…"}</span>
  `;
  titleGroup.append(titleRow, statusSub);

  const closeModal = () => {
    modalAskController?.abort();
    document.body.style.overflow = "";
    overlay.remove();
    document.removeEventListener("keydown", handleKeydown);
  };

  overlay._closeAskModal = closeModal;

  const closeBtn = element("button", "analysis-history-close");
  closeBtn.type = "button";
  closeBtn.setAttribute("aria-label", isEn ? "Close" : "Bağla");
  closeBtn.innerHTML = `
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <line x1="18" y1="6" x2="6" y2="18"/>
      <line x1="6" y1="6" x2="18" y2="18"/>
    </svg>
  `;
  closeBtn.addEventListener("click", closeModal);
  header.append(titleGroup, closeBtn);

  const messagesBody = element("div", "loading-ask-modal-body");
  const formWrap = element("div", "loading-ask-modal-footer");
  const modalForm = element("form", "loading-ask-modal-form");
  const modalInput = element("input", "loading-ask-modal-input");
  modalInput.type = "text";
  modalInput.placeholder = isEn ? "Ask a follow-up or marketing question…" : "Əlavə sualını yaz…";
  modalInput.autocomplete = "off";
  modalInput.maxLength = 1000;

  const modalSend = element("button", "loading-ask-send-btn");
  modalSend.type = "submit";
  modalSend.setAttribute("aria-label", isEn ? "Send" : "Göndər");
  modalSend.innerHTML = `
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
      <line x1="12" y1="19" x2="12" y2="5"></line>
      <polyline points="5 12 12 5 19 12"></polyline>
    </svg>
  `;
  modalForm.append(modalInput, modalSend);
  formWrap.appendChild(modalForm);

  modal.append(dragHandle, header, messagesBody, formWrap);
  overlay.appendChild(modal);

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeModal();
  });

  const handleKeydown = (e) => {
    if (e.key === "Escape") {
      closeModal();
    }
  };
  document.addEventListener("keydown", handleKeydown);

  document.body.style.overflow = "hidden";
  document.body.appendChild(overlay);

  const thread = [];

  const appendUserMessage = (text) => {
    const item = element("div", "ask-thread-msg is-user");
    item.innerHTML = `
      <div class="ask-thread-msg-header">
        <span class="history-item-icon user-icon">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/>
            <circle cx="12" cy="7" r="4"/>
          </svg>
        </span>
        <strong>${isEn ? "You" : "Siz"}</strong>
      </div>
      <div class="ask-thread-msg-content"><p>${escapeHtml(text)}</p></div>
    `;
    messagesBody.appendChild(item);
    messagesBody.scrollTop = messagesBody.scrollHeight;
  };

  const askAssistant = async (queryText) => {
    if (modalAskController) return;
    const controller = new AbortController();
    modalAskController = controller;
    modalSend.disabled = true;
    const welcome = messagesBody.querySelector(".loading-ask-welcome");
    if (welcome) welcome.remove();
    const suggestionsWrap = messagesBody.querySelector(".loading-ask-suggestions");
    if (suggestionsWrap) suggestionsWrap.remove();

    appendUserMessage(queryText);
    thread.push({ role: "user", content: queryText });

    const loadingItem = element("div", "ask-thread-msg is-assistant is-thinking");
    loadingItem.innerHTML = `
      <div class="ask-thread-msg-header">
        <span class="history-item-icon ai-icon">✦</span>
        <strong>Helmer</strong>
      </div>
      <div class="ask-thread-msg-content">
        <div class="loading-processing-dots">
          <span></span><span></span><span></span>
        </div>
      </div>
    `;
    messagesBody.appendChild(loadingItem);
    messagesBody.scrollTop = messagesBody.scrollHeight;

    try {
      let response = await fetch("/api/ask", {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          "Accept": "text/event-stream",
          "X-Helmer-Model-Improvement": String(isModelImprovementActive()),
        },
        body: JSON.stringify({
          messages: thread.map(sanitizeAskMessageForApi),
          model: "gemini-3.8-flash",
          thinkingLevel: (state.askThinkingEnabled && ["low", "medium", "high", "off"].includes(currentAskThinking)) ? currentAskThinking : undefined,
          strategyId: state.askStrategyId || undefined,
          taskId: state.askTaskId || undefined,
          chatId: state.askChatId || undefined,
          chatRevision: state.askChatId ? (window.helmerSecurity?.getRevision(state.askChatId) || 1) : undefined,
          stream: true,
        }),
      });

      if (!response.ok && response.status === 409) {
        const errorData = await response.clone().json().catch(() => ({}));
        if (errorData.code === "REVISION_CONFLICT" && state.askChatId && errorData.revision) {
          window.helmerSecurity?.revisions.set(state.askChatId, errorData.revision);
          response = await fetch("/api/ask", {
            method: "POST",
        signal: controller.signal,
            headers: {
              "Content-Type": "application/json",
              "Accept": "text/event-stream",
              "X-Helmer-Model-Improvement": String(isModelImprovementActive()),
            },
            body: JSON.stringify({
              messages: thread.map(sanitizeAskMessageForApi),
              model: "gemini-3.8-flash",
              thinkingLevel: (state.askThinkingEnabled && ["low", "medium", "high", "off"].includes(currentAskThinking)) ? currentAskThinking : undefined,
              strategyId: state.askStrategyId || undefined,
              taskId: state.askTaskId || undefined,
              chatId: state.askChatId || undefined,
              chatRevision: errorData.revision,
              stream: true,
            }),
          });
        }
      }

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        if (response.status === 409 && errorData.code === "REVISION_CONFLICT" && state.askChatId && errorData.revision) {
          window.helmerSecurity?.revisions.set(state.askChatId, errorData.revision);
        }
        throw new Error(errorData.error || (isEn ? "Unable to generate response." : "Cavab almaq mümkün olmadı."));
      }

      loadingItem.classList.remove("is-thinking");
      const contentWrap = loadingItem.querySelector(".ask-thread-msg-content");
      let reply = "", richContent;
      const renderReply = () => {
        if (!contentWrap) return;
        if (!richContent) {
          richContent = renderAskRichText('');
          contentWrap.replaceChildren(richContent);
        }
        patchAskRichTextElement(richContent, reply);
      };
      const reader = response.body.getReader();

      await consumeAskEventStream(reader, async data => {
        if (data.status === "searching") {
          const dots = loadingItem.querySelector(".loading-processing-dots");
          if (dots && !loadingItem.querySelector(".ask-searching-badge")) {
            const badge = element("div", "ask-searching-badge", isEn ? "Searching the web…" : "Veb axtarışı...");
            loadingItem.querySelector(".ask-thread-msg-content")?.prepend(badge);
          }
        }
        if (data.chunk) {
          loadingItem.querySelector(".ask-searching-badge")?.remove();
          if (contentWrap && !contentWrap.dataset.hasStreamedText) {
            contentWrap.dataset.hasStreamedText = "true";
            contentWrap.classList.add("ask-text-glide-in");
          }
          reply += data.chunk;
          renderReply();
        }
        if (data.done) {
          reply = data.reply || reply;
          renderReply();
          if (data.groundingMetadata) {
            const chips = renderAskSourceChips(data.groundingMetadata);
            if (chips) loadingItem.querySelector(".ask-thread-msg-content")?.appendChild(chips);
          }
          rememberSavedAskChat(data.chat);
        }
      });

      if (!reply) throw new Error(isEn ? "AI returned an empty response." : "AI boş cavab qaytardı.");
      renderReply();
      thread.push({ role: "assistant", content: reply });
    } catch (err) {
      if (controller.signal.aborted) return;
      loadingItem.classList.remove("is-thinking");
      const contentWrap = loadingItem.querySelector(".ask-thread-msg-content");
      contentWrap.replaceChildren(element("p", "ask-thread-error", err.message || (isEn ? "Unable to generate response." : "Cavab almaq mümkün olmadı.")));
    } finally {
      modalAskController = null;
      modalSend.disabled = false;
      messagesBody.scrollTop = messagesBody.scrollHeight;
      modalInput.focus();
    }
  };

  modalForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const val = modalInput.value.trim();
    if (!val) return;
    modalInput.value = "";
    askAssistant(val);
  });

  if (initialQuery) {
    askAssistant(initialQuery);
  } else {
    const welcome = element("div", "loading-ask-welcome");
    welcome.innerHTML = `
      <div class="loading-ask-welcome-spark">✦</div>
      <div class="loading-ask-welcome-text">
        <strong>${isEn ? "Strategic Marketing Copilot" : "Helmer-dən soruş"}</strong>
        <p>${isEn ? "Explore marketing questions, unit economics, or channel ideas while your strategy brief is being analyzed." : "Brif analizi arxa planda davam edərkən istənilən marketinq sualınızı verə bilərsiniz."}</p>
      </div>
    `;
    const suggestionsWrap = element("div", "loading-ask-suggestions");
    const sampleQuestions = LOADING_ASK_PLACEHOLDERS.slice(0, 4);
    sampleQuestions.forEach((q) => {
      const pill = element("button", "loading-ask-suggestion-pill", q);
      pill.type = "button";
      pill.addEventListener("click", () => {
        askAssistant(q);
      });
      suggestionsWrap.appendChild(pill);
    });
    messagesBody.append(welcome, suggestionsWrap);
    setTimeout(() => modalInput.focus(), 120);
  }
}

function isBuildBriefSufficientClient(brief, round = 0, answers = []) {
  const text = String(brief || "").trim();
  if (!text) return false;
  if (round >= 2 || (Array.isArray(answers) && answers.length > 0 && round >= 1)) return true;
  const hasBusiness = /(?:^|[^\p{L}\p{N}])(restoran\p{L}*|restaurant\p{L}*|cafe\p{L}*|kafe\p{L}*|brand\p{L}*|brend\p{L}*|saas|fintech|app\p{L}*|tətbiq\p{L}*|məhsul\p{L}*|product\p{L}*|xidmət\p{L}*|service\p{L}*|e-?commerce|mağaza\p{L}*|shop\p{L}*|şirkət\p{L}*|company|platforma\p{L}*|platform\p{L}*)(?:$|[^\p{L}\p{N}])/iu.test(text);
  const hasObjective = /(?:^|[^\p{L}\p{N}])(artır\p{L}*|artım\p{L}*|increase\p{L}*|launch\p{L}*|satış\p{L}*|sales|growth|böyü\p{L}*|repeat|təkrar|lead\p{L}*|conversion\p{L}*|konversiya\p{L}*|awareness|tanınma\p{L}*|qazan\p{L}*|icra\s+strategiya\p{L}*)(?:$|[^\p{L}\p{N}])/iu.test(text);
  if (/(əlavə\s+sual\s+verm[əe]\S*|sual\s+verm[əe]\S*|suallarsız|birbaşa\s+strategiyanı\s+hazırla|birbaşa\s+generasiya|\bdo\s+not\s+ask\s+(?:any\s+)?(?:clarifying\s+)?questions\b|\bno\s+clarifying\s+questions\b|\bskip\s+questions\b|\bproceed\s+directly\b)/iu.test(text) && hasBusiness && hasObjective) {
    return true;
  }
  const hasAudience = /(?:^|[^\p{L}\p{N}])(auditoriya\p{L}*|target|müştəri\p{L}*|customer\p{L}*|müəssisə\p{L}*|korporativ\p{L}*|enterprise\p{L}*|women|men|qadın\p{L}*|kişi\p{L}*|yaş\p{L}*|aged|b2b|b2c|student\p{L}*|tələbə\p{L}*|seqment\p{L}*)(?:$|[^\p{L}\p{N}])/iu.test(text);
  const hasMarket = /(?:^|[^\p{L}\p{N}])(bakı\p{L}*|baku\p{L}*|azərbaycan\p{L}*|azerbaijan\p{L}*|market\p{L}*|bazar\p{L}*|region\p{L}*|badamdar\p{L}*|sumqayıt\p{L}*|gəncə\p{L}*)(?:$|[^\p{L}\p{N}])/iu.test(text);
  const hasTimeline = /(?:^|[^\p{L}\p{N}])(gün\p{L}*|days?|weeks?|həftə\p{L}*|months?|ay\p{L}*|quarter\p{L}*|rüb\p{L}*|20\d{2})(?:$|[^\p{L}\p{N}])/iu.test(text);
  const hasBudget = /(?:^|[^\p{L}\p{N}])(azn|manat\p{L}*|budget\p{L}*|büdcə\p{L}*|usd|eur)(?:$|[^\p{L}\p{N}])|[₼$€]/iu.test(text);
  const score = [hasBusiness, hasObjective, hasAudience, hasMarket, hasTimeline, hasBudget].filter(Boolean).length;
  const hasScopeAndConstraints = /(?:^|[^\p{L}\p{N}])(kpi\p{L}*|cac|ltv|mrr|arr|arpu|arpa|marja\p{L}*|margin\p{L}*|roi|kanal\p{L}*|channel\p{L}*|mərhələ\p{L}*|phase\p{L}*|struktur\p{L}*|arxitektura\p{L}*|architecture|komanda\p{L}*|team|qiymət\p{L}*|pricing|paket\p{L}*|tier\p{L}*|konversiya\p{L}*|conversion|məhdudiyyət\p{L}*|constraint\p{L}*|risk\p{L}*|hədəf\p{L}*|target\p{L}*|unit\s+ekonomika\p{L}*|unit\s+economics)(?:$|[^\p{L}\p{N}])/iu.test(text);
  const hasUnresolvedPlaceholders = /\b(tbd|todo|naməlum|hələ\s+bilinmir|qərarlaşdırılmayıb)\b|\?\?\?/i.test(text);
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  return score >= 5 && hasBusiness && hasObjective && hasAudience && hasMarket && (hasTimeline || hasBudget) && hasScopeAndConstraints && !hasUnresolvedPlaceholders && wordCount >= 35;
}

async function startAssessment() {
  if (!state.currentUser && state.remainingGuestBriefs === 0) {
    const isEn = getLanguage() === "en";
    openGuestRestrictionModal(isEn ? GUEST_BUILD_EXHAUSTED_MESSAGE_EN : GUEST_BUILD_EXHAUSTED_MESSAGE);
    return;
  }
  const epoch = state.identityEpoch;
  const expectedUserId = state.currentUser?.id || null;
  if (state.round === 0 && state.answers.length === 0) trackEvent("strategy_started");
  clearError();
  cancelBuildEstimate();
  if (state.round === 0 && state.answers.length === 0 && isBuildBriefSufficientClient(state.brief, state.round, state.answers)) {
    await startGeneration();
    return;
  }
  currentAbortController?.abort();
  const controller = new AbortController();
  currentAbortController = controller;
  setStatus("analyzing");
  render();
  try {
    const data = await api("/api/strategy/assess", {
      method: "POST",
      signal: controller.signal,
      body: JSON.stringify({
        brief: state.brief,
        answers: state.answers,
        round: state.round,
        language: getLanguage(),
        ...(state.buildModel === "faster" ? {
          buildMode: "faster",
          fasterThinkingLevel: state.buildFasterThinkingLevel === "high" ? "high" : "medium",
        } : {}),
      }),
    });
    if (currentAbortController === controller) currentAbortController = null;
    if (isIdentityStale(epoch, expectedUserId) || controller.signal.aborted) return;
    if (typeof data?.remainingGuestBriefs === "number") {
      state.remainingGuestBriefs = data.remainingGuestBriefs;
    }
    updateBuildEstimate(data.preparationEstimate);
    const assessment = data.assessment;
    state.understanding = assessment.understanding;
    state.assumptions = assessment.assumptions || [];
    if (assessment.status === "needs_clarification") {
      state.questions = assessment.questions;
      state.clarificationIndex = 0;
      state.clarificationDrafts = {};
      trackEvent("clarification_requested", { questionCount: assessment.questions.length, round: state.round + 1 });
      setStatus("needs_clarification");
      render();
      return;
    }
    await startGeneration();
  } catch (error) {
    if (error.name === "AbortError" || controller.signal.aborted || isIdentityStale(epoch, expectedUserId)) {
      return;
    }
    if (error.code === "GUEST_DAILY_LIMIT") {
      state.remainingGuestBriefs = 0;
      const isEn = getLanguage() === "en";
      openGuestRestrictionModal(isEn ? GUEST_BUILD_EXHAUSTED_MESSAGE_EN : GUEST_BUILD_EXHAUSTED_MESSAGE);
      setStatus("draft");
      render();
      return;
    }
    setError(error, startAssessment, state.answers.length ? "needs_clarification" : "draft");
  }
}

function renderClarification() {
  const isEn = getLanguage() === "en";
  workspace.classList.add("workspace-centered");
  const index = Math.min(state.clarificationIndex, state.questions.length - 1);
  const question = state.questions[index];
  if (!question) return startGeneration();
  const view = element("section", "clarification-view");
  view.setAttribute("aria-labelledby", "clarificationTitle");
  const top = element("div", "clarification-heading");
  top.append(
    element("div", "step-label", state.round ? (isEn ? "FOLLOW-UP CLARIFICATION" : "BİR DETAL DA DƏQİQLƏŞDİRƏK") : (isEn ? "STRATEGY CLARIFICATION" : "QISA DƏQİQLƏŞDİRMƏ")),
    element("h1", "clarification-title", isEn ? "Sharpen your strategy details" : "Strategiyanı dəqiqləşdirək"),
    element("p", "clarification-copy", isEn ? "A few targeted details will ensure an accurate, execution-ready strategy." : "Bir neçə vacib detal strategiyanı real biznesinə uyğunlaşdıracaq."),
  );

  const progressMeta = element("div", "clarification-progress-meta");
  progressMeta.append(element("span", "", `${index + 1} / ${state.questions.length}`), element("span", "", isEn ? "Question" : "Sual"));
  const progressTrack = element("div", "clarification-progress");
  const progressFill = element("span");
  progressFill.style.width = `${((index + 1) / state.questions.length) * 100}%`;
  progressTrack.appendChild(progressFill);

  const form = element("form", "clarification-form");
  const stage = element("div", "clarification-stage");
  stage.append(element("h2", "question-title", question.question));
  if (question.reason) stage.append(element("p", "question-reason", question.reason));

  let textInput;
  if (question.inputType === "text" || !question.options.length) {
    textInput = element("textarea", "question-input");
    textInput.name = question.id;
    textInput.rows = 4;
    textInput.maxLength = 1500;
    textInput.placeholder = isEn ? "Enter your answer or key preferences…" : "Cavabını qısa və konkret yaz…";
    textInput.value = state.clarificationDrafts[question.id] || "";
    stage.append(textInput, element("p", "question-example", isEn ? "e.g. Core offerings, target customer profile, budget constraints, or unique value proposition." : "Məsələn: əsas məhsul, auditoriya, büdcə və ya fərqləndirici yanaşma."));
  } else {
    const options = element("div", "choice-grid");
    const selected = new Set(Array.isArray(state.clarificationDrafts[question.id]) ? state.clarificationDrafts[question.id] : [state.clarificationDrafts[question.id]].filter(Boolean));
    question.options.forEach((option) => {
      const label = element("label", "choice-pill");
      const input = document.createElement("input");
      input.type = question.inputType === "multi_choice" ? "checkbox" : "radio";
      input.name = question.id;
      input.value = option;
      input.checked = selected.has(option);
      const displayOption = isEn && option === "Digər" ? "Other (specify)" : option;
      label.append(input, element("span", "", displayOption));
      options.appendChild(label);
    });
    stage.appendChild(options);
  }
  form.appendChild(stage);

  const context = document.createElement("details");
  context.className = "clarification-context";
  const contextSummary = element("summary", "", isEn ? "Captured Context & Brief" : "Helmer nə bilir?");
  const contextBody = element("div", "clarification-context-body");
  const briefRow = element("div", "context-summary-row");
  briefRow.append(element("strong", "", isEn ? "Brief" : "Brif"), element("span", "", state.brief.slice(0, 220)));
  contextBody.appendChild(briefRow);
  state.answers.slice(-3).forEach((answer) => {
    const row = element("div", "context-summary-row");
    row.append(element("strong", "", answer.question), element("span", "", answer.answer));
    contextBody.appendChild(row);
  });
  context.append(contextSummary, contextBody);

  const actions = element("div", "clarification-actions");
  const back = button(isEn ? "← Back" : "← Geri", "text-button", () => {
    if (index === 0) return;
    state.clarificationIndex = index - 1;
    render();
  });
  back.disabled = index === 0;
  const skip = button(isEn ? "Skip / Use Best Estimate" : "Dəqiq bilmirəm", "text-button clarification-skip");
  const continueButton = button(index === state.questions.length - 1 ? (isEn ? "Generate Strategy" : "Tamamla") : (isEn ? "Continue" : "Davam et"), "primary-button");
  continueButton.type = "submit";
  continueButton.appendChild(element("span", "button-arrow", "→"));
  const actionRight = element("div", "clarification-action-right");
  actionRight.append(skip, continueButton);
  actions.append(back, actionRight);
  form.append(context, actions);

  const advance = (answer) => {
    if (!answer) {
      showToast(isEn ? "Please select or type an answer to continue." : "Davam etmək üçün cavab seç və ya yaz.", "error");
      return;
    }
    state.clarificationDrafts[question.id] = question.inputType === "multi_choice" ? answer.split(", ") : answer;
    if (index < state.questions.length - 1) {
      state.clarificationIndex = index + 1;
      render();
      return;
    }
    const newAnswers = state.questions.map((item) => {
      const value = state.clarificationDrafts[item.id];
      return { questionId: item.id, question: item.question, answer: Array.isArray(value) ? value.join(", ") : value };
    });
    state.answers = [...state.answers, ...newAnswers];
    state.round += 1;
    trackEvent("clarification_completed", { answerCount: newAnswers.length, round: state.round });
    startAssessment();
  };

  skip.addEventListener("click", () => advance(isEn ? "Not specified — infer the most strategic industry standard." : "Dəqiq məlum deyil — əsaslandırılmış işçi fərziyyə istifadə et."));
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const value = textInput ? textInput.value.trim() : new FormData(form).getAll(question.id).join(", ").trim();
    advance(value);
  });
  textInput?.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      form.requestSubmit();
    }
  });

  const banner = errorBanner();
  if (banner) view.appendChild(banner);
  view.append(top, progressMeta, progressTrack, form);
  workspace.appendChild(view);
  setTimeout(() => textInput?.focus(), 0);
}

async function startGeneration() {
  const epoch = state.identityEpoch;
  const expectedUserId = state.currentUser?.id || null;
  clearError();
  currentAbortController?.abort();
  const controller = new AbortController();
  currentAbortController = controller;
  const generationKey = state.clientSaveId;
  state.buildStreamingText = "";
  state.buildStreamingFinishReason = null;
  setStatus("generating");
  render();

  try {
    const autoSaveActive = isAutoSaveStrategiesEnabled();
    let finalStrategy = null;
    let savedStrategy = null;
    let savedId = null;
    try {
      const response = await fetch("/api/strategy/generate-stream", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "text/event-stream",
          "Accept-Language": getLanguage() === "en" ? "en" : "az",
          "X-Helmer-Language": getLanguage(),
          "X-Helmer-Model-Improvement": String(isModelImprovementActive()),
          "Idempotency-Key": generationKey,
        },
        body: JSON.stringify({
          brief: state.brief,
          answers: state.answers,
          assumptions: state.assumptions,
          idempotencyKey: state.clientSaveId,
          language: getLanguage(),
          autoSave: autoSaveActive,
          ...(state.buildModel === "faster" ? {
            buildMode: "faster",
            fasterThinkingLevel: state.buildFasterThinkingLevel === "high" ? "high" : "medium",
          } : {}),
        }),
        signal: controller.signal,
      });

      if (isIdentityStale(epoch, expectedUserId) || controller.signal.aborted) return;

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        const err = new Error(errData.error || "Strategiyanı hazırlamaq mümkün olmadı.");
        err.code = errData.code;
        err.status = response.status;
        err.model = errData.model;
        throw err;
      }

      const contentType = response.headers.get("content-type") || "";
      if (contentType.includes("text/event-stream")) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let rawBuffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (isIdentityStale(epoch, expectedUserId) || controller.signal.aborted) break;

          rawBuffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
          const lines = rawBuffer.split(/\r?\n/);
          rawBuffer = done ? "" : (lines.pop() || "");

          for (const line of lines) {
            if (isIdentityStale(epoch, expectedUserId) || controller.signal.aborted) break;
            const trimmed = line.trim();
            if (!trimmed || !trimmed.startsWith("data:")) continue;

            const jsonStr = trimmed.replace(/^data:\s*/, "").trim();
            if (!jsonStr || jsonStr === "[DONE]") continue;

            try {
              const evt = JSON.parse(jsonStr);
              if (evt.error) {
                const streamErr = new Error(evt.error);
                streamErr.code = evt.code;
                streamErr.status = evt.status;
                streamErr.model = evt.model;
                throw streamErr;
              }

              if (evt.preparationEstimate) updateBuildEstimate(evt.preparationEstimate);
              if (evt.resetStream) {
                state.buildStreamingText = "";
                state.buildStreamingFinishReason = null;
              }
              if (evt.chunk) {
                state.buildStreamingText = (state.buildStreamingText || "") + evt.chunk;
              }

              if (evt.finishReason) {
                state.buildStreamingFinishReason = evt.finishReason;
              }

              if (evt.done && evt.strategy) {
                finalStrategy = evt.strategy;
                if (evt.savedId) savedId = evt.savedId;
                if (evt.savedStrategy) savedStrategy = evt.savedStrategy;
                if (typeof evt.remainingGuestBriefs === "number") {
                  state.remainingGuestBriefs = evt.remainingGuestBriefs;
                }
              }
            } catch (pErr) {
              if (pErr.code || (pErr.message && !pErr.message.includes("JSON"))) throw pErr;
            }
          }
          if (done) break;
        }
        if (!isIdentityStale(epoch, expectedUserId) && !controller.signal.aborted && !finalStrategy) {
          // A proxy can close an HTTP 200 stream before the terminal result.
          // Do not start another model execution while the original may still hold its lease.
          const interrupted = new Error(getLanguage() === "en"
            ? "The connection ended before the strategy was ready. Please try again."
            : "Strategiya hazır olmadan bağlantı kəsildi. Yenidən cəhd edin.");
          interrupted.code = "BUILD_STREAM_INCOMPLETE";
          throw interrupted;
        }
      } else {
        const data = await response.json();
        if (isIdentityStale(epoch, expectedUserId) || controller.signal.aborted) return;
        finalStrategy = data.strategy;
        if (data.savedId) savedId = data.savedId;
        if (data.savedStrategy) savedStrategy = data.savedStrategy;
        if (typeof data.remainingGuestBriefs === "number") {
          state.remainingGuestBriefs = data.remainingGuestBriefs;
        }
      }
    } catch (streamFetchErr) {
      if (streamFetchErr.name === "AbortError" || controller.signal.aborted || isIdentityStale(epoch, expectedUserId)) throw streamFetchErr;
      if (streamFetchErr.code && streamFetchErr.code !== "AI_PROVIDER_ERROR") throw streamFetchErr;

      // Direct fallback to non-streaming generate endpoint
      const data = await api("/api/strategy/generate", {
        method: "POST",
        signal: controller.signal,
        headers: { "Idempotency-Key": generationKey },
        body: JSON.stringify({
          brief: state.brief,
          answers: state.answers,
          assumptions: state.assumptions,
          idempotencyKey: state.clientSaveId,
          language: getLanguage(),
          autoSave: autoSaveActive,
          ...(state.buildModel === "faster" ? {
            buildMode: "faster",
            fasterThinkingLevel: state.buildFasterThinkingLevel === "high" ? "high" : "medium",
          } : {}),
        }),
      });
      if (isIdentityStale(epoch, expectedUserId) || controller.signal.aborted) return;
      finalStrategy = data.strategy;
      if (data.savedId) savedId = data.savedId;
      if (data.savedStrategy) savedStrategy = data.savedStrategy;
      if (typeof data.remainingGuestBriefs === "number") {
        state.remainingGuestBriefs = data.remainingGuestBriefs;
      }
    }

    if (isIdentityStale(epoch, expectedUserId) || controller.signal.aborted) return;

    if (!finalStrategy) {
      throw new Error("Strategiya generasiyası tamamlanmadı.");
    }

    if (currentAbortController === controller) currentAbortController = null;

    // Check if this generation was moved to background while awaiting
    const bgJob = backgroundJobs.find((j) => j.idempotencyKey === generationKey);
    if (bgJob) {
      bgJob.status = "ready";
      bgJob.strategy = finalStrategy;
      if (savedId) bgJob.savedId = savedId;
      bgJob.completedAt = new Date().toISOString();
      bgJob.versions = [{ versionNumber: 1, data: finalStrategy, changeRequest: "İlkin strategiya", createdAt: bgJob.completedAt }];
      persistBackgroundJobs();
      if (autoSaveActive && !bgJob.savedId) {
        autoSaveBackgroundJob(bgJob);
      }
      return;
    }

    state.strategy = finalStrategy;
    state.updatedAt = new Date().toISOString();
    state.versions = [
      {
        versionNumber: 1,
        data: finalStrategy,
        changeRequest: "İlkin strategiya",
        createdAt: state.updatedAt,
      },
    ];
    trackEvent("strategy_generated", { clarificationRounds: state.round, model: "gemini-3.8-flash" });

    const isEn = getLanguage() === "en";
    if (autoSaveActive) {
      if (savedId) {
        state.savedId = savedId;
        if (savedStrategy) {
          state.updatedAt = savedStrategy.updatedAt || state.updatedAt;
          if (Array.isArray(savedStrategy.versions) && savedStrategy.versions.length) {
            state.versions = savedStrategy.versions;
          }
        }
        setStatus("saved");
        render();
        showToast(isEn ? "Strategy generated and saved to archive ✓" : "Strategiya hazırlandı və arxivə saxlanıldı ✓");
        await loadSavedStrategies();
      } else {
        // Fallback: auto-save via /api/strategy/save if not returned by generator
        try {
          const saveData = await api("/api/strategy/save", {
            method: "POST",
            body: JSON.stringify({
              clientSaveId: state.clientSaveId,
              brief: state.brief,
              answers: state.answers,
              strategy: state.strategy,
              versions: state.versions,
              acceptForLearning: true,
            }),
          });
          if (isIdentityStale(epoch, expectedUserId)) return;
          state.savedId = saveData.strategy.id;
          state.updatedAt = saveData.strategy.updatedAt;
          state.versions = saveData.strategy.versions;
          setStatus("saved");
          render();
          showToast(isEn ? "Strategy generated and saved to archive ✓" : "Strategiya hazırlandı və arxivə saxlanıldı ✓");
          await loadSavedStrategies();
        } catch (saveErr) {
          if (isIdentityStale(epoch, expectedUserId)) return;
          console.error("Auto-save fallback failed:", saveErr);
          setStatus("ready");
          render();
          showToast(isEn ? "Strategy is ready ✓" : "Strategiya hazırdır ✓");
        }
      }
    } else {
      state.savedId = null;
      setStatus("ready");
      render();
      showToast(isEn ? "Strategy is ready ✓" : "Strategiya hazırdır ✓");
    }
  } catch (error) {
    if (error.name === "AbortError" || controller.signal.aborted || isIdentityStale(epoch, expectedUserId)) {
      return;
    }
    if (error.code === "GUEST_DAILY_LIMIT") {
      state.remainingGuestBriefs = 0;
      const isEn = getLanguage() === "en";
      openGuestRestrictionModal(isEn ? GUEST_BUILD_EXHAUSTED_MESSAGE_EN : GUEST_BUILD_EXHAUSTED_MESSAGE);
      setStatus("draft");
      render();
      return;
    }
    // Check if this generation was moved to background
    const bgJob = backgroundJobs.find((j) => j.idempotencyKey === generationKey && j.status === "generating");
    if (bgJob) {
      if (!navigator.onLine) {
        // Keep in generating status so online event can resume
        return;
      }
      bgJob.status = "error";
      bgJob.error = error.message || "Xəta baş verdi";
      persistBackgroundJobs();
      if (state.view === "list") renderStrategyList();
      return;
    }
    setError(error, startGeneration, state.questions.length ? "needs_clarification" : "draft");
  } finally {
    if (typeof detachedBuildAbortControllers !== "undefined") {
      detachedBuildAbortControllers.delete(controller);
    }
  }
}

function calcReadingTime(strategy) {
  if (!strategy) return 3;
  let wordCount = 0;
  if (strategy.title) wordCount += strategy.title.split(/\s+/).length;
  if (strategy.summary) wordCount += strategy.summary.split(/\s+/).length;
  if (strategy.context) {
    Object.values(strategy.context).forEach((val) => {
      if (val) wordCount += String(val).split(/\s+/).length;
    });
  }
  if (Array.isArray(strategy.sections)) {
    strategy.sections.forEach((sec) => {
      if (sec.title) wordCount += sec.title.split(/\s+/).length;
      if (sec.summary) wordCount += sec.summary.split(/\s+/).length;
      if (sec.content) wordCount += sec.content.split(/\s+/).length;
      if (Array.isArray(sec.bullets)) {
        sec.bullets.forEach((b) => (wordCount += String(b).split(/\s+/).length));
      }
    });
  }
  if (Array.isArray(strategy.priorities)) {
    strategy.priorities.forEach((p) => {
      wordCount += `${p.title} ${p.description}`.split(/\s+/).length;
    });
  }
  if (Array.isArray(strategy.actionPlan)) {
    strategy.actionPlan.forEach((ap) => {
      wordCount += `${ap.phase} ${ap.expectedOutcome || ""}`.split(/\s+/).length;
      if (Array.isArray(ap.actions)) {
        ap.actions.forEach((a) => (wordCount += String(a).split(/\s+/).length));
      }
    });
  }
  return Math.max(1, Math.ceil(wordCount / 170));
}

function createSectionHeading(kicker, title, description) {
  const heading = element("div", "section-heading");
  heading.append(element("span", "section-kicker", kicker), element("h2", "", title));
  if (description) heading.append(element("p", "section-description", description));
  return heading;
}

function buildFormatSwitcher() {
  const isEn = getLanguage() === "en";
  const container = element("div", "strategy-format-tabs");
  container.setAttribute("role", "tablist");
  container.setAttribute("aria-label", isEn ? "View format" : "Görünüş formatı");

  const tabs = [
    { id: "blog", label: isEn ? "Article (Blog)" : "Məqalə (Blog)" },
    { id: "faq", label: isEn ? "Q&A (FAQ)" : "Sual-Cavab (FAQ)" },
    { id: "roadmap", label: isEn ? "Execution Plan" : "İcra Planı" },
  ];

  tabs.forEach((tab) => {
    const btn = button(tab.label, `format-tab${state.strategyFormat === tab.id ? " is-active" : ""}`, () => {
      state.strategyFormat = tab.id;
      render();
    });
    btn.setAttribute("role", "tab");
    btn.setAttribute("aria-selected", String(state.strategyFormat === tab.id));
    container.appendChild(btn);
  });

  return container;
}

function getBriefFeedbackIdentifiers(strategy) {
  const keys = [];
  if (state.savedId) keys.push(`id_${state.savedId}`);
  if (strategy?.id && strategy.id !== state.savedId) keys.push(`id_${strategy.id}`);
  if (state.brief && state.brief.trim()) {
    let hash = 0;
    const s = state.brief.trim();
    for (let i = 0; i < s.length; i++) {
      hash = ((hash << 5) - hash + s.charCodeAt(i)) | 0;
    }
    keys.push(`b_${Math.abs(hash).toString(36)}`);
  }
  if (strategy?.title && strategy.title.trim()) {
    let hash = 0;
    const s = strategy.title.trim();
    for (let i = 0; i < s.length; i++) {
      hash = ((hash << 5) - hash + s.charCodeAt(i)) | 0;
    }
    keys.push(`t_${Math.abs(hash).toString(36)}`);
  }
  return keys;
}

function isBriefFeedbackDismissed(strategy) {
  try {
    const keys = getBriefFeedbackIdentifiers(strategy);
    return keys.some((k) => localStorage.getItem(`helmer_brief_fb_dismissed_${k}`) === "1");
  } catch {
    return false;
  }
}

function markBriefFeedbackDismissed(strategy) {
  try {
    const keys = getBriefFeedbackIdentifiers(strategy);
    for (const k of keys) {
      localStorage.setItem(`helmer_brief_fb_dismissed_${k}`, "1");
    }
  } catch {}
}

function getBriefFeedbackVote(strategy) {
  try {
    const keys = getBriefFeedbackIdentifiers(strategy);
    for (const k of keys) {
      const v = localStorage.getItem(`helmer_brief_fb_vote_${k}`);
      if (v) return v;
    }
  } catch {}
  return null;
}

function setBriefFeedbackVote(strategy, vote) {
  try {
    const keys = getBriefFeedbackIdentifiers(strategy);
    for (const k of keys) {
      if (vote) {
        localStorage.setItem(`helmer_brief_fb_vote_${k}`, vote);
      } else {
        localStorage.removeItem(`helmer_brief_fb_vote_${k}`);
      }
    }
  } catch {}
}

function buildBriefFeedbackCard(strategy, isEn) {
  if (isBriefFeedbackDismissed(strategy)) {
    return null;
  }

  const card = element("div", "brief-feedback-card");
  card.setAttribute("role", "group");
  card.setAttribute("aria-label", isEn ? "Feedback" : "Rəy");

  const promptText = element(
    "span",
    "brief-feedback-text",
    isEn ? "Satisfied with the result?" : "Nəticədən razı qaldın?"
  );

  const actions = element("div", "brief-feedback-actions");

  const currentVote = getBriefFeedbackVote(strategy);

  // Like button
  const likeBtn = document.createElement("button");
  likeBtn.type = "button";
  likeBtn.className = `brief-feedback-btn is-like${currentVote === "like" ? " is-active" : ""}`;
  const likeLabel = isEn ? "Helpful" : "Bəyəndim";
  likeBtn.setAttribute("aria-label", likeLabel);
  likeBtn.title = likeLabel;
  likeBtn.innerHTML =
    '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/></svg>';

  // Dislike button
  const dislikeBtn = document.createElement("button");
  dislikeBtn.type = "button";
  dislikeBtn.className = `brief-feedback-btn is-dislike${currentVote === "dislike" ? " is-active" : ""}`;
  const dislikeLabel = isEn ? "Not helpful" : "Bəyənmədim";
  dislikeBtn.setAttribute("aria-label", dislikeLabel);
  dislikeBtn.title = dislikeLabel;
  dislikeBtn.innerHTML =
    '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7-13h3a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-3"/></svg>';

  const sendBriefFeedback = (vote) => {
    const isSavedUuid = Boolean(state.savedId && /^[0-9a-f-]{36}$/i.test(state.savedId));
    const isGrounded = isStrategyGroundedClient(strategy || state.strategy);
    const hideContent = isGrounded || !isSavedUuid;
    fetch("/api/strategy/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        strategyId: isSavedUuid ? state.savedId : null,
        clientSaveId: (!isSavedUuid && state.clientSaveId) ? state.clientSaveId : null,
        feedback: vote,
        brief: hideContent ? "" : (state.brief?.slice(0, 500) || ""),
        title: hideContent ? "" : (strategy?.title?.slice(0, 200) || ""),
        ...(isGrounded ? { groundingActive: true } : {}),
      }),
    }).catch((err) => {
      console.warn("Brief feedback could not be logged:", err?.message || err);
    });
  };

  likeBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const active = likeBtn.classList.contains("is-active");
    const nextVote = active ? null : "like";
    likeBtn.classList.toggle("is-active", nextVote === "like");
    dislikeBtn.classList.remove("is-active");
    setBriefFeedbackVote(strategy, nextVote);
    sendBriefFeedback(nextVote);
    if (nextVote === "like") {
      showToast(isEn ? "Feedback recorded ✓" : "Rəyiniz qeydə alındı ✓", "info");
      trackEvent("brief_feedback", { rating: "positive", strategyId: state.savedId || strategy?.id });
    }
  });

  dislikeBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const active = dislikeBtn.classList.contains("is-active");
    const nextVote = active ? null : "dislike";
    dislikeBtn.classList.toggle("is-active", nextVote === "dislike");
    likeBtn.classList.remove("is-active");
    setBriefFeedbackVote(strategy, nextVote);
    sendBriefFeedback(nextVote);
    if (nextVote === "dislike") {
      showToast(isEn ? "Feedback recorded ✓" : "Rəyiniz qeydə alındı ✓", "info");
      trackEvent("brief_feedback", { rating: "negative", strategyId: state.savedId || strategy?.id });
    }
  });

  const divider = element("span", "brief-feedback-divider");
  divider.setAttribute("aria-hidden", "true");

  // Close 'X' button
  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "brief-feedback-close";
  const closeLabel = isEn ? "Dismiss" : "Bağla";
  closeBtn.setAttribute("aria-label", closeLabel);
  closeBtn.title = closeLabel;
  closeBtn.innerHTML =
    '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';

  closeBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    markBriefFeedbackDismissed(strategy);
    card.classList.add("is-dismissing");
    setTimeout(() => {
      card.remove();
    }, 180);
  });

  actions.append(likeBtn, dislikeBtn, divider, closeBtn);
  card.append(promptText, actions);

  return card;
}

function buildStrategyHeader(strategy) {
  const isEn = getLanguage() === "en";
  const header = element("header", "strategy-overview");
  header.id = "overview";

  const topRow = element("div", "strategy-header-top");
  const status = element("span", `status-badge status-${state.status}`);
  status.append(element("span", "status-dot"), document.createTextNode(STATUS_LABELS[state.status]));

  const meta = element("div", "strategy-meta");
  const readingTime = element("span", "reading-time-badge", isEn ? `~${calcReadingTime(strategy)} min read` : `~${calcReadingTime(strategy)} dəqiqəlik oxu`);
  meta.append(
    status,
    element("span", "meta-divider", "·"),
    element("span", "", isEn ? `Version ${state.versions.length}` : `Versiya ${state.versions.length}`),
    element("span", "meta-divider", "·"),
    element("span", "", isEn ? `Updated ${i18nFormatDate(state.updatedAt)}` : `Yenilənib ${i18nFormatDate(state.updatedAt)}`),
    element("span", "meta-divider", "·"),
    readingTime,
  );
  topRow.appendChild(meta);

  const feedbackCard = buildBriefFeedbackCard(strategy, isEn);
  if (feedbackCard) {
    topRow.appendChild(feedbackCard);
  }

  const title = element("h1", "strategy-title", strategy.title);

  const contextChips = element("dl", "context-chips-strip strategy-context-grid");
  const appendContextItem = (label, value) => {
    if (!value) return;
    const item = element("div", "context-chip strategy-context-item");
    item.append(element("dt", "strategy-context-label", label), element("dd", "strategy-context-value", String(value)));
    contextChips.appendChild(item);
  };
  appendContextItem(isEn ? "Audience" : "Auditoriya", strategy.context?.targetAudience);
  appendContextItem(isEn ? "Market" : "Bazar", strategy.context?.market);
  const budget = budgetSignal(state.brief);
  appendContextItem(isEn ? "Budget" : "Büdcə", budget);
  appendContextItem(isEn ? "Business" : "Biznes", strategy.context?.business);

  const execCard = element("div", "strategy-executive-card");
  const execKicker = element("div", "exec-card-header");
  execKicker.append(
    element("span", "exec-badge", isEn ? "STRATEGIC SUMMARY & DIRECTION" : "STRATEJİ XÜLASƏ VƏ ƏSAS İSTİQAMƏT"),
  );
  const execText = element("p", "exec-summary-text", strategy.summary);
  execCard.append(execKicker, execText);

  header.append(topRow, title, contextChips, execCard);

  if (state.changeSummary) {
    const changeBox = element("div", "change-note");
    changeBox.append(element("span", "change-note-icon", "✨ "), document.createTextNode(state.changeSummary));
    header.append(changeBox);
  }

  return header;
}

function buildKpiCard(kpi) {
  const isEn = getLanguage() === "en";
  const card = element("article", "kpi-card");
  const header = element("div", "kpi-card-header");
  const kicker = element("span", "kpi-card-kicker", isEn ? "KPI METRIC" : "KPI METRİKİ");
  const name = element("h3", "kpi-name", kpi.name);
  header.append(kicker, name);

  const targetBox = element("div", "kpi-target-box");
  targetBox.append(
    element("span", "kpi-target-label", isEn ? "Target / Signal:" : "Hədəf / İlk Siqnal:"),
    element("p", "kpi-target-value", kpi.target || (isEn ? "Initial baseline period" : "İlk ölçüm dövrü")),
  );

  const desc = element("p", "kpi-desc", kpi.reason);
  card.append(header, targetBox, desc);
  return card;
}

function createCheckSvgIcon() {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "13");
  svg.setAttribute("height", "13");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2.5");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  const polyline = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
  polyline.setAttribute("points", "20 6 9 17 4 12");
  svg.appendChild(polyline);
  return svg;
}

function createPlusSvgIcon() {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "13");
  svg.setAttribute("height", "13");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2.4");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  const l1 = document.createElementNS("http://www.w3.org/2000/svg", "line");
  l1.setAttribute("x1", "12");
  l1.setAttribute("y1", "5");
  l1.setAttribute("x2", "12");
  l1.setAttribute("y2", "19");
  const l2 = document.createElementNS("http://www.w3.org/2000/svg", "line");
  l2.setAttribute("x1", "5");
  l2.setAttribute("y1", "12");
  l2.setAttribute("x2", "19");
  l2.setAttribute("y2", "12");
  svg.append(l1, l2);
  return svg;
}

function cleanTaskText(raw) {
  return String(raw || "").replace(/^[\s\-*•\d.)\]]+/, "").trim();
}

function isTaskAlreadyInPlanner(rawText, strategyId, strategyTitle) {
  const target = cleanTaskText(rawText).toLowerCase();
  if (!target) return false;
  return (state.plannerTasks || []).some((t) => {
    const tTitle = cleanTaskText(t.title || t.text).toLowerCase();
    if (tTitle !== target) return false;
    if (strategyId && t.strategyId && t.strategyId === strategyId) return true;
    if (strategyTitle && t.strategyTitle && t.strategyTitle === strategyTitle) return true;
    return true;
  });
}

function openPlannerTaskSelectionModal({
  aiTasks = [],
  rawTasks = [],
  tasks = [],
  strategyTitle = "",
  strategyId = null,
  isEn = false,
  initialTab = "ai",
  identityEpoch = state.identityEpoch,
  expectedUserId = state.currentUser?.id || null,
  onTasksAdded = null,
}) {
  if (isIdentityStale(identityEpoch, expectedUserId)) return;
  document.querySelectorAll(".planner-modal-overlay").forEach((el) => el._closeModal ? el._closeModal() : el.remove());

  const resolvedAiTasks = Array.isArray(aiTasks) && aiTasks.length > 0 ? aiTasks : (Array.isArray(tasks) ? tasks : []);
  const resolvedRawTasks = Array.isArray(rawTasks) ? rawTasks : [];

  const overlay = element("div", "planner-modal-overlay");
  let onKeydown = null;
  const closeModal = () => {
    overlay.remove();
    if (onKeydown) document.removeEventListener("keydown", onKeydown);
  };
  overlay._closeModal = closeModal;
  const card = element("div", "planner-modal-card");
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-modal", "true");
  card.setAttribute("aria-labelledby", "planner-modal-title");

  let currentTab = (resolvedAiTasks.length > 0 && initialTab === "ai") ? "ai" : (resolvedRawTasks.length > 0 ? "raw" : "ai");

  const header = element("header", "planner-modal-header");
  const headerText = element("div", "planner-modal-header-text");
  const badge = element("div", "planner-modal-badge", isEn ? "✦ AI Summary" : "✦ AI Xülasəsi");
  const title = element("h2", "planner-modal-title", isEn ? "Add to Planner" : "Planlaşdırılanlara əlavə et");
  title.id = "planner-modal-title";
  const subtitle = element(
    "p",
    "planner-modal-subtitle",
    isEn
      ? "Actionable tasks summarized and optimized by AI."
      : "AI tərəfindən xülasələnmiş və optimallaşdırılmış icra addımları."
  );
  headerText.append(badge, title, subtitle);

  const closeBtn = button("✕", "planner-modal-close", closeModal);
  closeBtn.setAttribute("aria-label", isEn ? "Close" : "Bağla");
  header.append(headerText, closeBtn);

  const selectedAiIndices = new Set(resolvedAiTasks.map((_, i) => i));
  const selectedRawIndices = new Set(resolvedRawTasks.map((_, i) => i));

  function getActiveTasks() {
    return currentTab === "ai" ? resolvedAiTasks : resolvedRawTasks;
  }

  function getActiveSelection() {
    return currentTab === "ai" ? selectedAiIndices : selectedRawIndices;
  }

  let tabsContainer = null;
  let aiTabBtn = null;
  let rawTabBtn = null;

  if (resolvedAiTasks.length > 0 && resolvedRawTasks.length > 0) {
    tabsContainer = element("div", "planner-modal-tabs");

    aiTabBtn = button("", "planner-modal-tab" + (currentTab === "ai" ? " is-active" : ""), () => {
      if (currentTab !== "ai") {
        currentTab = "ai";
        onTabChanged();
      }
    });
    aiTabBtn.replaceChildren(
      document.createTextNode(isEn ? "✦ AI Summary " : "✦ AI Xülasəsi "),
      element("span", "planner-modal-tab-badge", String(resolvedAiTasks.length))
    );

    rawTabBtn = button("", "planner-modal-tab" + (currentTab === "raw" ? " is-active" : ""), () => {
      if (currentTab !== "raw") {
        currentTab = "raw";
        onTabChanged();
      }
    });
    rawTabBtn.replaceChildren(
      document.createTextNode(isEn ? "As-Is " : "Olduğu kimi "),
      element("span", "planner-modal-tab-badge", String(resolvedRawTasks.length))
    );

    tabsContainer.append(aiTabBtn, rawTabBtn);
  }

  const toolbar = element("div", "planner-modal-toolbar");
  const countIndicator = element("span", "planner-modal-count", "");
  const toggleAllBtn = button("", "planner-modal-toggle-all", () => {
    const activeTasks = getActiveTasks();
    const activeSelection = getActiveSelection();
    if (activeSelection.size === activeTasks.length) {
      activeSelection.clear();
    } else {
      activeTasks.forEach((_, i) => activeSelection.add(i));
    }
    updateListSelection();
  });
  toolbar.append(countIndicator, toggleAllBtn);

  const list = element("div", "planner-modal-list");
  let currentItemElements = [];

  function renderList() {
    list.replaceChildren();
    currentItemElements = [];
    const activeTasks = getActiveTasks();
    const activeSelection = getActiveSelection();

    activeTasks.forEach((task, index) => {
      const isSelected = activeSelection.has(index);
      const itemRow = element("label", "planner-modal-item" + (isSelected ? " is-selected" : ""));
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.className = "planner-modal-item-checkbox";
      checkbox.checked = isSelected;

      checkbox.addEventListener("change", () => {
        if (checkbox.checked) {
          activeSelection.add(index);
          itemRow.classList.add("is-selected");
        } else {
          activeSelection.delete(index);
          itemRow.classList.remove("is-selected");
        }
        updateCounts();
      });

      const content = element("div", "planner-modal-item-content");
      const textSpan = element("span", "planner-modal-item-text", task.title || task.text);
      const pill = element("span", "planner-modal-item-pill", task.timeframe || task.groupLabel || (isEn ? "Today" : "Bu gün"));
      content.append(textSpan, pill);

      itemRow.append(checkbox, content);
      list.appendChild(itemRow);
      currentItemElements.push({ itemRow, checkbox, index });
    });

    updateCounts();
  }

  function onTabChanged() {
    if (aiTabBtn && rawTabBtn) {
      aiTabBtn.classList.toggle("is-active", currentTab === "ai");
      rawTabBtn.classList.toggle("is-active", currentTab === "raw");
    }
    if (currentTab === "ai") {
      badge.textContent = isEn ? "✦ AI Summary" : "✦ AI Xülasəsi";
      subtitle.textContent = isEn
        ? "Actionable tasks summarized and optimized by AI."
        : "AI tərəfindən xülasələnmiş və optimallaşdırılmış icra addımları.";
    } else {
      badge.textContent = isEn ? "Original Tasks" : "Orijinal mətnlər";
      subtitle.textContent = isEn
        ? "Original execution action items from the strategy."
        : "Strategiyadakı orijinal icra addımları.";
    }
    renderList();
  }

  const footer = element("footer", "planner-modal-footer");
  const cancelBtn = button(isEn ? "Cancel" : "İmtina", "planner-modal-cancel-btn", closeModal);
  const confirmBtn = button("", "planner-modal-confirm-btn", async () => {
    if (isIdentityStale(identityEpoch, expectedUserId)) {
      closeModal();
      return;
    }
    const activeTasks = getActiveTasks();
    const activeSelection = getActiveSelection();
    if (activeSelection.size === 0) return;

    confirmBtn.disabled = true;
    confirmBtn.textContent = isEn ? "Adding…" : "Əlavə edilir…";

    const selectedTasks = activeTasks.filter((_, i) => activeSelection.has(i));
    const itemsToBatch = selectedTasks.map((t) => ({
      title: t.title || t.text,
      text: t.title || t.text,
      timeframe: t.timeframe || t.groupLabel || (isEn ? "Today" : "Bu gün"),
      groupLabel: t.timeframe || t.groupLabel || (isEn ? "Today" : "Bu gün"),
      status: "todo",
      strategyId: (strategyId && /^[0-9a-f-]{36}$/i.test(strategyId)) ? strategyId : null,
      strategyTitle: strategyTitle || (isEn ? "Strategy" : "Strategiya"),
      source: "brief",
    }));

    try {
      const res = await authRequest("/api/planner/batch", {
        method: "POST",
        body: JSON.stringify({ tasks: itemsToBatch }),
      });
      if (isIdentityStale(identityEpoch, expectedUserId)) {
        closeModal();
        return;
      }
      state.plannerTasks = Array.isArray(res.tasks) ? res.tasks : state.plannerTasks;
      updatePlannerBadge();
      const count = res.added?.length ?? itemsToBatch.length;
      const toastMsg = count === 1
        ? (isEn ? "1 task added to Planner ✓" : "1 tapşırıq Planner-ə əlavə edildi ✓")
        : (isEn ? `${count} tasks added to Planner ✓` : `${count} tapşırıq Planner-ə əlavə edildi ✓`);
      showToast(toastMsg, "success");
      closeModal();
      if (typeof onTasksAdded === "function") {
        onTasksAdded(selectedTasks);
      }
    } catch (err) {
      if (isIdentityStale(identityEpoch, expectedUserId)) {
        closeModal();
        return;
      }
      showToast(err.message || (isEn ? "An error occurred" : "Xəta baş verdi"), "error");
      confirmBtn.disabled = false;
      updateCounts();
    }
  });

  footer.append(cancelBtn, confirmBtn);

  function updateCounts() {
    const activeTasks = getActiveTasks();
    const activeSelection = getActiveSelection();
    const total = activeTasks.length;
    const selected = activeSelection.size;
    countIndicator.textContent = isEn
      ? `${selected} of ${total} selected`
      : `${total} tapşırıqdan ${selected} seçilib`;

    toggleAllBtn.textContent = selected === total
      ? (isEn ? "Deselect All" : "Seçimi ləğv et")
      : (isEn ? "Select All" : "Hamısını seç");

    confirmBtn.disabled = selected === 0;
    confirmBtn.textContent = isEn
      ? `Add Selected (${selected})`
      : `Seçilənləri əlavə et (${selected})`;
  }

  function updateListSelection() {
    const activeSelection = getActiveSelection();
    currentItemElements.forEach(({ itemRow, checkbox, index }) => {
      const isSel = activeSelection.has(index);
      checkbox.checked = isSel;
      itemRow.classList.toggle("is-selected", isSel);
    });
    updateCounts();
  }

  renderList();

  if (tabsContainer) {
    card.append(header, tabsContainer, toolbar, list, footer);
  } else {
    card.append(header, toolbar, list, footer);
  }
  overlay.appendChild(card);

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeModal();
  });

  onKeydown = (e) => {
    if (e.key === "Escape") {
      closeModal();
    }
  };
  document.addEventListener("keydown", onKeydown);

  document.body.appendChild(overlay);
}

function buildNextStepsSection(strategy, isEn, isRoadmap = false) {
  const closeout = element("section", "strategy-work-section next-actions-section");
  closeout.id = "next";
  const headingWrapper = element("div", "section-heading-with-action");

  if (isRoadmap) {
    headingWrapper.appendChild(
      isEn
        ? createSectionHeading("IMMEDIATE NEXT STEPS", "Immediate action items", "Initial steps to set the strategy in motion")
        : createSectionHeading("NÖVBƏTİ ADDIMLAR", "Dərhal başlanılacaq fəaliyyətlər", "Strategiyanı hərəkətə keçirmək üçün ilk addımlar")
    );
  } else {
    headingWrapper.appendChild(
      isEn
        ? createSectionHeading("06. IMMEDIATE NEXT STEPS", "Immediate action items", "Actionable step-by-step tasks to set the strategy in motion")
        : createSectionHeading("06. NÖVBƏTİ ADDIMLAR", "Dərhal başlanılacaq fəaliyyətlər", "Strategiyanı hərəkətə keçirmək üçün ilk addım-addım tapşırıqlar")
    );
  }

  const rowControllers = [];

  const itemsToSummarize = [];
  const groupLabels = isEn ? ["Today", "Next 48 hours", "This week"] : ["Bu gün", "Növbəti 48 saat", "Bu həftə"];
  const nextStepsList = Array.isArray(strategy.nextSteps) ? strategy.nextSteps : [];
  const chunkSize = Math.max(1, Math.ceil(nextStepsList.length / 3));

  groupLabels.forEach((label, groupIndex) => {
    const items = nextStepsList.slice(groupIndex * chunkSize, (groupIndex + 1) * chunkSize);
    items.forEach((item) => {
      const cleaned = cleanTaskText(item) || String(item).trim();
      if (cleaned) {
        itemsToSummarize.push({
          title: cleaned,
          text: cleaned,
          timeframe: label,
          groupLabel: label,
          status: "todo",
        });
      }
    });
  });

  const nextActionsGroup = element("div", "next-actions-btn-group");

  // Track 1: Manual Direct Bulk Add (Olduğu kimi əlavə et)
  const addAllManualButton = button(
    isEn ? "Add All As Is" : "Olduğu kimi əlavə et",
    "add-all-manual-btn",
    async () => {
      if (itemsToSummarize.length === 0) return;
      addAllManualButton.disabled = true;
      addAllManualButton.textContent = isEn ? "Adding…" : "Əlavə edilir…";

      const itemsToBatch = itemsToSummarize.map((t) => ({
        title: t.title || t.text,
        text: t.title || t.text,
        timeframe: t.timeframe || t.groupLabel || (isEn ? "Today" : "Bu gün"),
        groupLabel: t.timeframe || t.groupLabel || (isEn ? "Today" : "Bu gün"),
        status: "todo",
        strategyId: (state.savedId && /^[0-9a-f-]{36}$/i.test(state.savedId)) ? state.savedId : null,
        strategyTitle: strategy.title || (isEn ? "Strategy" : "Strategiya"),
        source: "brief",
      }));

      const epoch = state.identityEpoch;
      const expectedUserId = state.currentUser?.id || null;
      try {
        const res = await authRequest("/api/planner/batch", {
          method: "POST",
          body: JSON.stringify({ tasks: itemsToBatch }),
        });
        if (isIdentityStale(epoch, expectedUserId)) return;
        state.plannerTasks = Array.isArray(res.tasks) ? res.tasks : state.plannerTasks;
        updatePlannerBadge();
        const count = res.added?.length ?? itemsToBatch.length;
        const toastMsg = count === 1
          ? (isEn ? "1 task added to Planner ✓" : "1 tapşırıq olduğu kimi Planner-ə əlavə edildi ✓")
          : (isEn ? `${count} tasks added to Planner ✓` : `${count} tapşırıq olduğu kimi Planner-ə əlavə edildi ✓`);
        showToast(toastMsg, "success");
        rowControllers.forEach(({ setAddedState }) => setAddedState());
        addAllManualButton.classList.add("is-success");
        addAllManualButton.textContent = isEn ? "✓ Added" : "✓ Əlavə edildi";
        setTimeout(() => {
          addAllManualButton.classList.remove("is-success");
          addAllManualButton.disabled = false;
          addAllManualButton.textContent = isEn ? "Add All As Is" : "Olduğu kimi əlavə et";
        }, 2500);
      } catch (err) {
        if (isIdentityStale(epoch, expectedUserId)) return;
        showToast(err.message || (isEn ? "An error occurred" : "Xəta baş verdi"), "error");
        addAllManualButton.disabled = false;
        addAllManualButton.textContent = isEn ? "Add All As Is" : "Olduğu kimi əlavə et";
      }
    }
  );

  // Track 2: AI Summarized Bulk Add (✦ AI ilə xülasələ və əlavə et)
  const addAllToPlannerButton = button(
    isEn ? "✦ AI Summarize & Add" : "✦ AI ilə xülasələ və əlavə et",
    "add-to-planner-btn add-ai-summary-btn",
    async () => {
      const epoch = state.identityEpoch;
      const expectedUserId = state.currentUser?.id || null;
      const capturedStrategyId = state.savedId || null;
      const capturedStrategyTitle = strategy.title || (isEn ? "Strategy" : "Strategiya");
      addAllToPlannerButton.disabled = true;
      addAllToPlannerButton.textContent = isEn ? "✦ Summarizing with AI…" : "✦ AI ilə xülasələnir…";

      const triggerModalWithTasks = (summarizedTasks) => {
        if (isIdentityStale(epoch, expectedUserId)) return;
        openPlannerTaskSelectionModal({
          aiTasks: summarizedTasks,
          rawTasks: itemsToSummarize,
          strategyTitle: capturedStrategyTitle,
          strategyId: capturedStrategyId,
          isEn,
          identityEpoch: epoch,
          expectedUserId,
          onTasksAdded: (addedTasks) => {
            if (isIdentityStale(epoch, expectedUserId)) return;
            rowControllers.forEach(({ setAddedState, cleaned }) => {
              const wasAdded = addedTasks.some((at) => {
                const atText = cleanTaskText(at.title || at.text).toLowerCase();
                return atText.includes(cleaned.toLowerCase()) || cleaned.toLowerCase().includes(atText);
              });
              if (wasAdded) setAddedState();
            });
            addAllToPlannerButton.textContent = isEn ? "✓ Added" : "✓ Əlavə edildi";
            setTimeout(() => {
              if (isIdentityStale(epoch, expectedUserId)) return;
              addAllToPlannerButton.disabled = false;
              addAllToPlannerButton.textContent = isEn ? "✦ AI Summarize & Add" : "✦ AI ilə xülasələ və əlavə et";
            }, 2500);
          },
        });
      };

      try {
        const res = await authRequest("/api/planner/summarize", {
          method: "POST",
          body: JSON.stringify({
            tasks: itemsToSummarize,
            strategyId: (capturedStrategyId && /^[0-9a-f-]{36}$/i.test(capturedStrategyId)) ? capturedStrategyId : null,
            strategyTitle: capturedStrategyTitle,
            language: isEn ? "en" : "az",
          }),
        });
        if (isIdentityStale(epoch, expectedUserId)) return;

        const summarizedTasks = Array.isArray(res.tasks) && res.tasks.length > 0
          ? res.tasks
          : itemsToSummarize.map((t) => ({
            title: cleanTaskText(t.title || t.text),
            timeframe: t.timeframe || t.groupLabel || (isEn ? "Today" : "Bu gün"),
            status: "todo",
          }));

        triggerModalWithTasks(summarizedTasks);
      } catch (err) {
        if (isIdentityStale(epoch, expectedUserId)) return;
        console.warn("AI Task summarization error, falling back to local tasks:", err);
        triggerModalWithTasks(
          itemsToSummarize.map((t) => ({
            title: cleanTaskText(t.title || t.text),
            timeframe: t.timeframe || t.groupLabel || (isEn ? "Today" : "Bu gün"),
            status: "todo",
          }))
        );
      } finally {
        if (!isIdentityStale(epoch, expectedUserId)) {
          addAllToPlannerButton.disabled = false;
          addAllToPlannerButton.textContent = isEn ? "✦ AI Summarize & Add" : "✦ AI ilə xülasələ və əlavə et";
        }
      }
    }
  );

  nextActionsGroup.append(addAllManualButton, addAllToPlannerButton);
  headingWrapper.appendChild(nextActionsGroup);
  closeout.appendChild(headingWrapper);

  const checklistGrid = element("div", "action-checklist-grid");

  groupLabels.forEach((label, groupIndex) => {
    const items = nextStepsList.slice(groupIndex * chunkSize, (groupIndex + 1) * chunkSize);
    if (!items.length) return;
    const groupCard = element("section", "checklist-group-card");
    groupCard.appendChild(element("h3", "checklist-group-title", label));
    const itemsList = element("div", "checklist-items-list");

    items.forEach((item, itemIndex) => {
      const checkboxLabel = element("label", "checklist-item");
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.dataset.key = `${isRoadmap ? "roadmap-" : ""}${groupIndex}-${itemIndex}`;
      const span = element("span", "checklist-item-text", item);

      const cleaned = cleanTaskText(item) || String(item).trim();
      const alreadyAdded = isTaskAlreadyInPlanner(cleaned, state.savedId, strategy.title);

      const singleAddBtn = element("button", "item-plan-btn" + (alreadyAdded ? " is-added" : ""));
      singleAddBtn.type = "button";
      singleAddBtn.setAttribute("aria-label", isEn ? "Add to Planner" : "Planlaşdırılanlara əlavə et");

      const setAddedState = () => {
        singleAddBtn.disabled = true;
        singleAddBtn.classList.add("is-added");
        singleAddBtn.replaceChildren(createCheckSvgIcon(), document.createTextNode(isEn ? " Added" : " Əlavə edildi"));
      };

      const setDefaultState = () => {
        singleAddBtn.disabled = false;
        singleAddBtn.classList.remove("is-added");
        singleAddBtn.replaceChildren(createPlusSvgIcon(), document.createTextNode(isEn ? " Add" : " Planlaşdır"));
      };

      if (alreadyAdded) {
        setAddedState();
      } else {
        setDefaultState();
      }

      singleAddBtn.addEventListener("click", async (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (singleAddBtn.disabled) return;

        singleAddBtn.disabled = true;
        singleAddBtn.textContent = "…";

        const epoch = state.identityEpoch;
        const expectedUserId = state.currentUser?.id || null;
        try {
          const res = await authRequest("/api/planner", {
            method: "POST",
            body: JSON.stringify({
              title: cleaned,
              text: cleaned,
              timeframe: label,
              groupLabel: label,
              status: "todo",
              strategyId: (state.savedId && /^[0-9a-f-]{36}$/i.test(state.savedId)) ? state.savedId : null,
              strategyTitle: strategy.title || (isEn ? "Strategy" : "Strategiya"),
              source: "brief",
            }),
          });
          if (isIdentityStale(epoch, expectedUserId)) return;

          if (res.task) {
            state.plannerTasks = [res.task, ...(state.plannerTasks || []).filter((t) => t.id !== res.task.id)];
            updatePlannerBadge();
            showToast(isEn ? "1 task added to Planner ✓" : "1 tapşırıq Planner-ə əlavə edildi ✓", "success");
            setAddedState();
          }
        } catch (err) {
          if (isIdentityStale(epoch, expectedUserId)) return;
          showToast(err.message || (isEn ? "An error occurred" : "Xəta baş verdi"), "error");
          setDefaultState();
        }
      });

      rowControllers.push({ setAddedState, cleaned });
      checkboxLabel.append(checkbox, span, singleAddBtn);
      itemsList.appendChild(checkboxLabel);
    });

    groupCard.appendChild(itemsList);
    checklistGrid.appendChild(groupCard);
  });

  closeout.appendChild(checklistGrid);
  return closeout;
}

function buildBlogView(strategy) {
  const isEn = getLanguage() === "en";
  const container = element("div", "strategy-blog-container");

  // 01. PRIORITIES
  const priorities = element("section", "strategy-work-section");
  priorities.id = "priorities";
  priorities.appendChild(
    isEn
      ? createSectionHeading("01. PRIORITIES", "What do we focus on first?", "High-impact strategic directions where resources and attention are concentrated")
      : createSectionHeading("01. PRİORİTETLƏR", "İlk növbədə nəyə fokuslanırıq?", "Resursların və diqqətin yönəldiləcəyi ən vacib strateji istiqamətlər")
  );
  const pillarGrid = element("div", "strategy-pillar-grid");
  strategy.priorities.forEach((item, index) => {
    const card = element("article", `strategy-pillar-card priority-${item.priority}`);
    const top = element("div", "pillar-card-top");
    const num = element("span", "pillar-num", String(index + 1).padStart(2, "0"));
    const priorityLabel = item.priority === "high"
      ? (isEn ? "High Priority" : "Yüksək Prioritet")
      : item.priority === "medium"
        ? (isEn ? "Medium Priority" : "Orta Prioritet")
        : (isEn ? "Planned" : "Planlı");
    const badge = element("span", `pillar-badge priority-${item.priority}`, priorityLabel);
    top.append(num, badge);
    const h3 = element("h3", "pillar-title", item.title);
    const p = element("p", "pillar-desc", item.description);
    card.append(top, h3, p);
    pillarGrid.appendChild(card);
  });
  priorities.appendChild(pillarGrid);

  // 02. STRATEGIC DECISIONS
  const direction = element("section", "strategy-work-section");
  direction.id = "decisions";
  direction.appendChild(
    isEn
      ? createSectionHeading("02. STRATEGIC DECISIONS", "Channel, positioning, and market approach", "Key strategic choices and execution guidelines to achieve the objective")
      : createSectionHeading("02. STRATEJİ QƏRARLAR", "Kanal, mövqeləndirmə və hədəf yanaşması", "Məqsədə çatmaq üçün verilmiş əsas qərarlar və tətbiq qaydaları")
  );
  const sections = element("div", "editorial-sections-list");
  strategy.sections.forEach((section, index) => {
    const article = element("article", "editorial-section-card");
    const header = element("header", "editorial-card-header");
    const num = element("span", "editorial-idx", `02.${index + 1}`);
    const heading = element("h3", "editorial-title", section.title);
    header.append(num, heading);

    const body = element("div", "editorial-card-body");

    const decisionBox = element("div", "editorial-decision-box");
    decisionBox.append(
      element("strong", "decision-label", isEn ? "Core Decision:" : "Əsas Qərar:"),
      element("p", "decision-text", section.summary || firstSentences(section.content, 2)),
    );
    body.appendChild(decisionBox);

    const rationale = element("div", "editorial-rationale");
    rationale.appendChild(element("p", "rationale-text", section.content));
    body.appendChild(rationale);

    if (section.bullets && section.bullets.length) {
      const bulletsList = element("ul", "editorial-bullets-list");
      section.bullets.forEach((bullet) => {
        bulletsList.appendChild(element("li", "", bullet));
      });
      body.appendChild(bulletsList);
    }

    article.append(header, body);
    sections.appendChild(article);
  });
  direction.appendChild(sections);

  // 03. EXECUTION ROADMAP
  const actionPlan = element("section", "strategy-work-section");
  actionPlan.id = "execution";
  actionPlan.appendChild(
    isEn
      ? createSectionHeading("03. EXECUTION ROADMAP", "Step-by-step implementation plan", "Sequential action plan organized into phased execution milestones")
      : createSectionHeading("03. İCRA MƏRHƏLƏLƏRİ", "Addım-addım tətbiq planı", "Strateji qərarların mərhələli və ardıcıl həyata keçirilməsi")
  );
  const timeline = element("div", "strategy-timeline");
  strategy.actionPlan.forEach((phase, index) => {
    const card = element("article", "phase-card");
    const header = element("header", "phase-header");
    const badge = element("span", "phase-badge", isEn ? `Phase ${index + 1}` : `Mərhələ ${index + 1}`);
    const title = element("h3", "phase-title", phase.phase);
    header.append(badge, title);
    card.appendChild(header);

    const list = element("ul", "phase-actions-list");
    phase.actions.forEach((act) => list.appendChild(element("li", "", act)));
    card.appendChild(list);

    if (phase.expectedOutcome) {
      const outcome = element("div", "phase-outcome");
      outcome.append(
        element("strong", "", isEn ? "Expected outcome: " : "Gözlənilən nəticə: "),
        document.createTextNode(phase.expectedOutcome),
      );
      card.appendChild(outcome);
    }
    timeline.appendChild(card);
  });
  actionPlan.appendChild(timeline);

  // 04. KPI METRICS
  const measurement = element("section", "strategy-work-section");
  measurement.id = "kpi";
  measurement.appendChild(
    isEn
      ? createSectionHeading("04. SUCCESS METRICS & KPIS", "Measurement and success signals", "Core performance indicators to track strategy effectiveness")
      : createSectionHeading("04. KPI GÖSTƏRİCİLƏRİ", "Ölçü və uğur siqnalları", "Strategiyanın effektivliyini izləmək üçün əsas performans göstəriciləri")
  );
  const kpiGrid = element("div", "kpi-cards-grid");
  strategy.kpis.forEach((kpi) => {
    kpiGrid.appendChild(buildKpiCard(kpi));
  });
  measurement.appendChild(kpiGrid);

  // 05. RISKS & MITIGATIONS
  const risks = element("section", "strategy-work-section");
  risks.id = "risks";
  risks.appendChild(
    isEn
      ? createSectionHeading("05. RISKS & MITIGATIONS", "Precautionary measures and safeguards", "Risk mitigation strategies for unexpected challenges")
      : createSectionHeading("05. RİSKLƏR VƏ HƏLLİ", "Ehtiyat tədbirləri və qarşısının alınması", "Gözlənilməz çətinliklərə qarşı sığorta və həll yolları")
  );
  const riskGrid = element("div", "risk-cards-grid");
  if (strategy.risks && strategy.risks.length) {
    strategy.risks.forEach((risk, index) => {
      const card = element("article", "risk-card");
      const top = element("div", "risk-card-top");
      const badge = element(
        "span",
        `risk-badge risk-${index < 2 ? "high" : "medium"}`,
        index < 2 ? (isEn ? "High Risk" : "Yüksək Risk") : (isEn ? "Medium Risk" : "Orta Risk")
      );
      const title = element("h3", "risk-title", risk.risk);
      top.append(badge, title);
      const mitigation = element("div", "risk-mitigation");
      mitigation.append(element("strong", "", isEn ? "Mitigation: " : "Həll yolu: "), document.createTextNode(risk.mitigation));
      card.append(top, mitigation);
      riskGrid.appendChild(card);
    });
  } else {
    riskGrid.appendChild(element("p", "section-empty", isEn ? "No critical risks identified." : "Əlavə kritik risk müəyyən edilməyib."));
  }
  risks.appendChild(riskGrid);

  // 06. NEXT STEPS
  const closeout = buildNextStepsSection(strategy, isEn, false);

  // Model & Search Intelligence metadata panel (strictly rendered before assumptions)
  const metaPanel = buildOrchestrationMetaPanel(strategy, isEn);

  // Assumptions
  if (strategy.assumptions && strategy.assumptions.length) {
    const assumptions = document.createElement("details");
    assumptions.className = "assumptions-panel";
    assumptions.appendChild(element("summary", "", isEn ? "Assumptions and Core Context" : "Fərziyyələr və əsas kontekst"));
    const assumptionList = element("ul", "decision-list");
    strategy.assumptions.forEach((item) => assumptionList.appendChild(element("li", "", item)));
    assumptions.append(assumptionList);
    container.append(priorities, direction, actionPlan, measurement, risks, closeout);
    if (metaPanel) container.appendChild(metaPanel);
    container.appendChild(assumptions);
  } else {
    container.append(priorities, direction, actionPlan, measurement, risks, closeout);
    if (metaPanel) container.appendChild(metaPanel);
  }

  return container;
}

function buildOrchestrationMetaPanel(strategy, isEn) {
  const sources = Array.isArray(strategy?.orchestration?.sources) ? strategy.orchestration.sources : [];
  const evidence = Array.isArray(strategy?.orchestration?.evidence) ? strategy.orchestration.evidence : [];
  const searchSuggestions = extractGroundingSearchSuggestions({
    webSearchQueries: strategy?.orchestration?.searchQueries,
    searchEntryPoint: strategy?.orchestration?.searchEntryPoint,
  });
  if (!sources.length && !searchSuggestions.length) return null;

  const panel = element("section", "strategy-sources-card");
  panel.setAttribute("aria-label", isEn ? "Research sources" : "Araşdırma mənbələri");
  const heading = element("div", "strategy-sources-heading");
  heading.append(
    element("span", "strategy-sources-icon", "↗"),
    element("div", "strategy-sources-heading-copy")
  );
  heading.lastChild.append(
    element("h3", "", isEn ? "Web research" : "Veb araşdırması"),
    element("p", "", isEn ? "Source-linked findings shown separately from the generated plan" : "Mənbələrlə əlaqələndirilmiş tapıntılar plandan ayrıca göstərilir")
  );
  panel.appendChild(heading);
  const list = element("div", "strategy-sources-list");
  const sourceLink = source => {
    let url;
    try { url = new URL(source?.url); }
    catch { return null; }
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
    const link = element("a", "strategy-source-link");
    link.href = url.href;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    const hostname = url.hostname.replace(/^www\./, "");
    link.append(element("strong", "", source.title || hostname), element("span", "", hostname + " ↗"));
    return link;
  };
  if (evidence.length) {
    const findings = element("ul", "decision-list");
    for (const item of evidence) {
      if (!item || typeof item.text !== "string" || !Array.isArray(item.sourceIndices)) continue;
      const links = item.sourceIndices.map(index => sourceLink(sources[index])).filter(Boolean);
      if (!links.length) continue;
      const finding = element("li", "", item.text);
      const citations = element("div", "strategy-sources-list");
      citations.append(...links);
      finding.appendChild(citations);
      findings.appendChild(finding);
    }
    panel.appendChild(findings);
  } else {
    list.append(...sources.slice(0, 20).map(sourceLink).filter(Boolean));
    panel.appendChild(list);
  }
  if (searchSuggestions.length > 0) {
    const suggestionsBar = element("div", "ask-search-suggestions strategy-search-suggestions");
    suggestionsBar.setAttribute("aria-label", "Google Search Suggestions");
    const gBadge = element("span", "ask-search-suggestions-badge");
    gBadge.appendChild(element("span", "ask-search-suggestions-label", "Google Search"));
    suggestionsBar.appendChild(gBadge);
    const suggestionsList = element("div", "ask-search-suggestions-list");
    searchSuggestions.slice(0, 4).forEach((suggestion) => {
      const sugChip = document.createElement("a");
      sugChip.className = "ask-search-suggestion-chip";
      sugChip.href = suggestion.url;
      sugChip.target = "_blank";
      sugChip.rel = "noopener noreferrer";
      sugChip.appendChild(element("span", "ask-search-suggestion-text", suggestion.query));
      suggestionsList.appendChild(sugChip);
    });
    suggestionsBar.appendChild(suggestionsList);
    panel.appendChild(suggestionsBar);
  }
  return panel;
}

function buildFaqView(strategy) {
  const isEn = getLanguage() === "en";
  const container = element("div", "strategy-faq-container");

  const faqHeader = element("div", "faq-intro-header");
  const faqTitle = element(
    "h2",
    "faq-main-title",
    isEn ? "Frequently Asked Questions and Clear Answers about the Strategy" : "Strategiya haqqında tez-tez verilən suallar və aydın cavablar"
  );
  const faqSubtitle = element(
    "p",
    "faq-main-desc",
    isEn
      ? "All strategic decisions, target audience insights, execution milestones, and risk mitigations organized into a clear Q&A format."
      : "Bütün strateji qərarlar, hədəf auditoriyası, icra mərhələləri və risklər sual-cavab formatında ümumiləşdirilib."
  );
  faqHeader.append(faqTitle, faqSubtitle);

  // FAQ Controls: Search + Toggle All
  const controlsBar = element("div", "faq-controls-bar");
  const searchInput = element("input", "faq-search-input");
  searchInput.type = "search";
  searchInput.placeholder = isEn ? "Search questions..." : "Suallarda axtar...";
  searchInput.value = state.faqFilter || "";
  searchInput.setAttribute("aria-label", isEn ? "Search questions" : "Suallarda axtar");

  const toggleAllBtn = button(
    state.faqExpandedAll ? (isEn ? "Collapse all" : "Hamısını bağla") : (isEn ? "Expand all" : "Hamısını aç"),
    "secondary-button compact faq-toggle-btn",
    () => {
      state.faqExpandedAll = !state.faqExpandedAll;
      const detailsList = container.querySelectorAll(".faq-item");
      detailsList.forEach((d) => {
        d.open = state.faqExpandedAll;
      });
      toggleAllBtn.textContent = state.faqExpandedAll ? (isEn ? "Collapse all" : "Hamısını bağla") : (isEn ? "Expand all" : "Hamısını aç");
    },
  );

  controlsBar.append(searchInput, toggleAllBtn);
  container.append(faqHeader, controlsBar);

  // Structured FAQ Q&A Items
  const faqItemsData = [
    {
      id: "faq-goal",
      category: isEn ? "Objective & Summary" : "Məqsəd və Xülasə",
      question: isEn ? "What is the primary business goal and direction of this strategy?" : "Bu strategiyanın əsas biznes məqsədi və istiqaməti nədir?",
      renderBody: () => {
        const body = element("div", "faq-body-content");
        body.append(element("p", "faq-lead-text", strategy.summary));
        if (strategy.context?.objective) {
          const objBox = element("div", "faq-info-callout");
          objBox.append(element("strong", "", isEn ? "Targeted Outcome: " : "Hədəflənən Nəticə: "), document.createTextNode(strategy.context.objective));
          body.appendChild(objBox);
        }
        return body;
      },
    },
    {
      id: "faq-audience",
      category: isEn ? "Audience & Market" : "Auditoriya və Bazar",
      question: isEn ? "Who is our target audience and where are we operating?" : "Hədəf auditoriyamız kimlərdir və harada fəaliyyət göstəririk?",
      renderBody: () => {
        const body = element("div", "faq-body-content");
        if (strategy.context?.targetAudience) {
          body.append(element("p", "", `${isEn ? "Primary audience" : "Əsas auditoriya"}: ${strategy.context.targetAudience}`));
        }
        if (strategy.context?.market) {
          body.append(element("p", "", `${isEn ? "Market and geography" : "Fəaliyyət bazarı və coğrafiya"}: ${strategy.context.market}`));
        }
        if (strategy.context?.business) {
          body.append(element("p", "", `${isEn ? "Business model and proposition" : "Biznes modeli və təklif"}: ${strategy.context.business}`));
        }
        return body;
      },
    },
    {
      id: "faq-priorities",
      category: isEn ? "Priorities" : "Prioritetlər",
      question: isEn ? "Which strategic priorities should we execute first?" : "İlk növbədə hansı strateji prioritetləri icra etməliyik?",
      renderBody: () => {
        const body = element("div", "faq-body-content");
        const list = element("div", "faq-priorities-list");
        strategy.priorities.forEach((p, idx) => {
          const item = element("div", "faq-priority-row");
          const tag = element(
            "span",
            `pillar-badge priority-${p.priority}`,
            p.priority === "high" ? (isEn ? "High" : "Yüksək") : p.priority === "medium" ? (isEn ? "Medium" : "Orta") : (isEn ? "Planned" : "Planlı")
          );
          const text = element("div", "");
          text.append(element("strong", "", `${idx + 1}. ${p.title}: `), document.createTextNode(p.description));
          item.append(tag, text);
          list.appendChild(item);
        });
        body.appendChild(list);
        return body;
      },
    },
    {
      id: "faq-decisions",
      category: isEn ? "Strategic Decisions" : "Strateji Qərarlar",
      question: isEn ? "What core decisions have been made regarding marketing and growth?" : "Marketinq və inkişaf üzrə hansı əsas qərarlar verilib?",
      renderBody: () => {
        const body = element("div", "faq-body-content");
        strategy.sections.forEach((sec, idx) => {
          const secBox = element("div", "faq-decision-entry");
          secBox.append(
            element("h4", "faq-entry-title", `${idx + 1}. ${sec.title}`),
            element("p", "faq-entry-decision", sec.summary || sec.content),
          );
          if (sec.bullets && sec.bullets.length) {
            const ul = element("ul", "editorial-bullets");
            sec.bullets.forEach((b) => {
              const li = element("li");
              li.append(element("span", "bullet-check", "✓"), document.createTextNode(b));
              ul.appendChild(li);
            });
            secBox.appendChild(ul);
          }
          body.appendChild(secBox);
        });
        return body;
      },
    },
    {
      id: "faq-execution",
      category: isEn ? "Execution Plan" : "İcra Planı",
      question: isEn ? "What are the execution milestones and timeline?" : "İcra planı hansı mərhələlərlə həyata keçiriləcək?",
      renderBody: () => {
        const body = element("div", "faq-body-content");
        const timeline = element("div", "roadmap-timeline");
        strategy.actionPlan.forEach((ph, idx) => {
          const card = element("div", "roadmap-phase-card");
          const h = element("div", "phase-card-header");
          h.append(element("span", "phase-badge", isEn ? `Phase ${idx + 1}` : `Mərhələ ${idx + 1}`), element("h3", "phase-title", ph.phase));
          const ul = element("ul", "phase-action-list");
          ph.actions.forEach((act) => {
            const li = element("li");
            li.append(element("span", "action-dot", "•"), document.createTextNode(act));
            ul.appendChild(li);
          });
          card.append(h, ul);
          if (ph.expectedOutcome) {
            const out = element("div", "phase-outcome");
            out.append(element("span", "outcome-icon", "🎯"), element("strong", "", isEn ? "Expected Outcome: " : "Gözlənilən nəticə: "), document.createTextNode(ph.expectedOutcome));
            card.appendChild(out);
          }
          timeline.appendChild(card);
        });
        body.appendChild(timeline);
        return body;
      },
    },
    {
      id: "faq-kpi",
      category: isEn ? "KPIs & Results" : "KPI və Nəticə",
      question: isEn ? "How will we measure strategic success and outcome signals?" : "Strategiyanın uğurunu və nəticələrini hansı KPI-larla ölçəcəyik?",
      renderBody: () => {
        const body = element("div", "faq-body-content");
        const kpiGrid = element("div", "kpi-cards-grid");
        strategy.kpis.forEach((kpi) => {
          kpiGrid.appendChild(buildKpiCard(kpi));
        });
        body.appendChild(kpiGrid);
        return body;
      },
    },
    {
      id: "faq-risks",
      category: isEn ? "Risks" : "Risklər",
      question: isEn ? "What risks may arise and how will we mitigate them?" : "Hansı risklər yarana bilər və onların qarşısını necə alacağıq?",
      renderBody: () => {
        const body = element("div", "faq-body-content");
        const riskGrid = element("div", "risk-cards-grid");
        if (strategy.risks && strategy.risks.length) {
          strategy.risks.forEach((r, idx) => {
            const card = element("article", "risk-card");
            const top = element("div", "risk-card-top");
            top.append(
              element("span", `risk-badge risk-${idx < 2 ? "high" : "medium"}`, idx < 2 ? (isEn ? "High Risk" : "Yüksək Risk") : (isEn ? "Medium Risk" : "Orta Risk")),
              element("h3", "risk-title", r.risk)
            );
            const mit = element("div", "risk-mitigation");
            mit.append(element("strong", "", isEn ? "Mitigation Strategy: " : "Həll yolu: "), document.createTextNode(r.mitigation));
            card.append(top, mit);
            riskGrid.appendChild(card);
          });
        }
        body.appendChild(riskGrid);
        return body;
      },
    },
    {
      id: "faq-next",
      category: isEn ? "Next Steps" : "İlk Addımlar",
      question: isEn ? "What immediate steps (next 24–48 hours) should we take?" : "Dərhal (növbəti 24–48 saatda) hansı ilk addımları atmalıyıq?",
      renderBody: () => {
        const body = element("div", "faq-body-content");
        const checklistGrid = element("div", "action-checklist-grid");
        const groupLabels = isEn ? ["Today", "Next 48 Hours", "This Week"] : ["Bu gün", "Növbəti 48 saat", "Bu həftə"];
        const chunkSize = Math.max(1, Math.ceil(strategy.nextSteps.length / 3));
        groupLabels.forEach((label, groupIndex) => {
          const items = strategy.nextSteps.slice(groupIndex * chunkSize, (groupIndex + 1) * chunkSize);
          if (!items.length) return;
          const groupCard = element("section", "checklist-group-card");
          groupCard.appendChild(element("h3", "checklist-group-title", label));
          const itemsList = element("div", "checklist-items-list");
          items.forEach((item, itemIndex) => {
            const checkboxLabel = element("label", "checklist-item");
            const checkbox = document.createElement("input");
            checkbox.type = "checkbox";
            checkbox.dataset.key = `faq-${groupIndex}-${itemIndex}`;
            checkboxLabel.append(checkbox, element("span", "checklist-item-text", item));
            itemsList.appendChild(checkboxLabel);
          });
          groupCard.appendChild(itemsList);
          checklistGrid.appendChild(groupCard);
        });
        body.appendChild(checklistGrid);
        return body;
      },
    },
  ];

  if (strategy.assumptions && strategy.assumptions.length) {
    faqItemsData.push({
      id: "faq-assumptions",
      category: isEn ? "Assumptions" : "Fərziyyələr",
      question: isEn ? "What initial assumptions and conditions is this strategy built on?" : "Bu strategiya hansı ilkin fərziyyələrə və şərtlərə əsaslanır?",
      renderBody: () => {
        const body = element("div", "faq-body-content");
        const list = element("ul", "editorial-bullets");
        strategy.assumptions.forEach((item) => {
          const li = element("li");
          li.append(element("span", "bullet-check", "•"), document.createTextNode(item));
          list.appendChild(li);
        });
        body.appendChild(list);
        return body;
      },
    });
  }

  const faqAccordion = element("div", "faq-accordion");

  const renderFilteredFaq = () => {
    faqAccordion.replaceChildren();
    const query = (state.faqFilter || "").trim().toLowerCase();
    const matched = faqItemsData.filter((item) => {
      if (!query) return true;
      return item.question.toLowerCase().includes(query) || item.category.toLowerCase().includes(query);
    });

    if (!matched.length) {
      faqAccordion.appendChild(element("p", "faq-no-results", isEn ? "No questions match your search." : "Axtarışınıza uyğun sual tapılmadı."));
      return;
    }

    matched.forEach((item, idx) => {
      const details = document.createElement("details");
      details.className = "faq-item";
      details.id = item.id;
      if (state.faqExpandedAll || idx === 0) details.open = true;

      const summary = element("summary", "faq-summary");
      const summaryLeft = element("div", "faq-summary-left");
      summaryLeft.append(
        element("span", "faq-category-badge", item.category),
        element("span", "faq-question-text", item.question),
      );
      const chevron = element("span", "faq-chevron", "›");
      summary.append(summaryLeft, chevron);

      const bodyWrap = element("div", "faq-body-wrap");
      bodyWrap.appendChild(item.renderBody());

      details.append(summary, bodyWrap);
      faqAccordion.appendChild(details);
    });
  };

  searchInput.addEventListener("input", () => {
    state.faqFilter = searchInput.value;
    renderFilteredFaq();
  });

  renderFilteredFaq();
  container.appendChild(faqAccordion);
  const metaPanel = buildOrchestrationMetaPanel(strategy, isEn);
  if (metaPanel) container.appendChild(metaPanel);
  return container;
}

function buildRoadmapView(strategy) {
  const isEn = getLanguage() === "en";
  const container = element("div", "strategy-roadmap-container");

  // Timeline
  const actionPlan = element("section", "strategy-work-section");
  actionPlan.id = "execution";
  actionPlan.appendChild(
    isEn
      ? createSectionHeading("EXECUTION ROADMAP", "From strategy to action", "Objectives and expected milestones for each phase")
      : createSectionHeading("İCRA MƏRHƏLƏLƏRİ", "Strategiyadan hərəkətə", "Hər bir mərhələnin hədəfləri və gözlənilən nəticələri")
  );
  const timeline = element("div", "roadmap-timeline");
  strategy.actionPlan.forEach((phase, index) => {
    const card = element("article", "roadmap-phase-card");
    const phaseHeader = element("div", "phase-card-header");
    const phaseBadge = element("span", "phase-badge", isEn ? `Phase ${index + 1}` : `Mərhələ ${index + 1}`);
    const phaseTitle = element("h3", "phase-title", phase.phase);
    phaseHeader.append(phaseBadge, phaseTitle);

    const actionList = element("ul", "phase-action-list");
    phase.actions.forEach((action) => {
      const li = element("li");
      li.append(element("span", "action-dot", "•"), document.createTextNode(action));
      actionList.appendChild(li);
    });

    card.append(phaseHeader, actionList);

    if (phase.expectedOutcome) {
      const outcome = element("div", "phase-outcome");
      outcome.append(
        element("span", "outcome-icon", "🎯"),
        element("strong", "", isEn ? "Expected Outcome: " : "Gözlənilən nəticə: "),
        document.createTextNode(phase.expectedOutcome),
      );
      card.appendChild(outcome);
    }
    timeline.appendChild(card);
  });
  actionPlan.appendChild(timeline);

  // Next Steps Checklist
  const closeout = buildNextStepsSection(strategy, isEn, true);

  // KPI checkpoints
  const measurement = element("section", "strategy-work-section");
  measurement.id = "kpi";
  measurement.appendChild(
    isEn
      ? createSectionHeading("SUCCESS METRICS & KPI CHECKPOINTS", "Measurement and goal signals")
      : createSectionHeading("UĞUR VƏ KPI YOXLAMA NÖQTƏLƏRİ", "Ölçü və hədəf siqnalları")
  );
  const kpiGrid = element("div", "kpi-cards-grid");
  strategy.kpis.forEach((kpi) => {
    kpiGrid.appendChild(buildKpiCard(kpi));
  });
  measurement.appendChild(kpiGrid);

  container.append(actionPlan, closeout, measurement);
  const metaPanel = buildOrchestrationMetaPanel(strategy, isEn);
  if (metaPanel) container.appendChild(metaPanel);
  return container;
}

function resetAskForStrategy(strategyId, force = false) {
  if (!force && state.askStrategyId === strategyId && !state.askTaskId) return;
  state.askChatId = null;
  state.askMessages = [];
  state.askError = "";
  state.askTaskId = "";
  state.askStrategyId = strategyId || "";
}

async function ensureStrategyAskContext() {
  state.askModel = "gemini-3.8-flash";
  if (state.savedId) {
    resetAskForStrategy(state.savedId);
    return true;
  }
  if (!state.strategy) return false;

  const epoch = state.identityEpoch;
  const expectedUserId = state.currentUser?.id || null;
  try {
    const data = await api("/api/strategy/save", {
      method: "POST",
      body: JSON.stringify({
        clientSaveId: state.clientSaveId,
        brief: state.brief,
        answers: state.answers,
        strategy: state.strategy,
        versions: state.versions,
      }),
    });
    if (isIdentityStale(epoch, expectedUserId)) return false;
    state.savedId = data.strategy.id;
    state.updatedAt = data.strategy.updatedAt;
    state.versions = data.strategy.versions;
    state.status = "saved";
    resetAskForStrategy(state.savedId);
    trackEvent("strategy_saved", { versionCount: state.versions.length, source: "strategy_ask" });
    await loadSavedStrategies();
    return !isIdentityStale(epoch, expectedUserId);
  } catch (error) {
    if (isIdentityStale(epoch, expectedUserId)) return false;
    state.askError = error.message || "Strategiyanı söhbət kontekstinə əlavə etmək mümkün olmadı.";
    render();
    return false;
  }
}

function buildStrategyAskMessage(message, messageIndex) {
  const isEn = getLanguage() === "en";
  const isAssistant = message.role === "assistant";
  const isStreaming = Boolean(message.isStreaming);
  const row = element("article", `strategy-ask-message ask-message ask-message-${message.role}${isStreaming ? " is-streaming" : ""}`);
  const content = element("div", "ask-message-content");

  if (!isAssistant) {
    if (message.file) {
      const fileBadge = element("div", "ask-message-attachment");
      const iconWrap = element("span", "ask-message-attachment-icon");
      iconWrap.innerHTML = getFileIconSvg(message.file.mimeType || message.file.type, message.file.name);
      const meta = element("div", "ask-message-attachment-meta");
      meta.append(
        element("span", "ask-message-attachment-name", message.file.name || (isEn ? "File" : "Fayl")),
        element("span", "ask-message-attachment-size", formatFileSize(message.file.size))
      );
      fileBadge.append(iconWrap, meta);
      content.appendChild(fileBadge);
    }
    if (message.content) {
      content.appendChild(element("div", "ask-message-text", message.content));
    }
    row.appendChild(content);
    return row;
  }

  if (isStreaming && !message.content) {
    const isSearching = message.status === "searching";
    const showLabel = isSearching || isAskThinkingActive(message);
    const thinking = element("div", `ask-thinking strategy-ask-thinking${isSearching ? " is-searching" : ""}${showLabel ? " has-label" : " is-default"}`);
    thinking.setAttribute("role", "status");
    thinking.setAttribute("aria-live", "polite");
    const iconWrap = element("span", "ask-thinking-icon");
    iconWrap.innerHTML = askThinkingIcon(isSearching);
    thinking.appendChild(iconWrap);
    if (showLabel) {
      const label = element("span", "ask-thinking-label", askThinkingLabel(message, isEn));
      thinking.appendChild(label);
    }
    content.appendChild(thinking);
  } else {
    content.appendChild(renderAskRichText(message.content));
    if (message.groundingMetadata) {
      const chips = renderAskSourceChips(message.groundingMetadata);
      if (chips) content.appendChild(chips);
    }
  }

  if (!isStreaming) appendArtifactCards(content, message);
  if (!isStreaming && message.content) {
    const actions = element("div", "strategy-ask-message-actions");
    const copy = button("", "strategy-ask-action", async () => {
      const copied = await copyAskResponse(message.content);
      if (!copied) return;
      copy.classList.add("is-copied");
      copy.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="20 6 9 17 4 12"/></svg>';
      setTimeout(() => copy.classList.remove("is-copied"), 1400);
    });
    copy.type = "button";
    copy.title = isEn ? "Copy" : "Kopyala";
    copy.setAttribute("aria-label", isEn ? "Copy response" : "Cavabı kopyala");
    copy.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>';
    actions.appendChild(copy);

    if (message.groundingMetadata) {
      const sourcesBtn = button(isEn ? "🌐 Web Sources" : "🌐 Mənbələr", "strategy-ask-action strategy-ask-sources", () => {
        openGroundingSourcesModal(message.groundingMetadata);
      });
      sourcesBtn.type = "button";
      sourcesBtn.title = isEn ? "Web sources" : "Veb mənbələri";
      actions.appendChild(sourcesBtn);
    }

    const msgMeta = getAskMessageMeta(message);
    if (msgMeta.thinkingLevel !== "high") {
      const deeper = button(isEn ? "✦ Think Deeper" : "✦ Dərin düşün", "strategy-ask-action strategy-ask-deeper", () => thinkDeeperWithHigh(messageIndex));
      deeper.type = "button";
      deeper.disabled = state.askLoading;
      actions.appendChild(deeper);
    }
    const report = button("", "strategy-ask-action strategy-ask-report", () => {
      openLegalReportModal({ messageContent: message.content, model: getAskMessageModelInfo(message.model).displayName });
    });
    report.type = "button";
    report.title = isEn ? "Report issue" : "Hüquqi problem bildir";
    report.setAttribute("aria-label", isEn ? "Report issue" : "Hüquqi problem bildir");
    report.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M12 8v5"/><path d="M12 16.5h.01"/></svg>';
    actions.appendChild(report);
    content.appendChild(actions);
  }

  row.appendChild(content);
  return row;
}

function buildStrategyAskAssistant() {
  const isEn = getLanguage() === "en";
  const root = element(
    "div",
    `strategy-ask-root${state.strategyAskOpen ? " is-open" : ""}${state.refinementOpen ? " is-refinement-open" : ""}`,
  );

  const backdrop = button("", "strategy-ask-backdrop", (e) => {
    e.preventDefault();
    state.strategyAskOpen = false;
    root.classList.remove("is-open");
    document.querySelector(".strategy-view")?.classList.remove("is-ask-open");
    const askBtn = document.querySelector(".dock-ask-btn");
    if (askBtn) askBtn.setAttribute("aria-expanded", "false");
  });
  backdrop.type = "button";
  backdrop.setAttribute("aria-label", isEn ? "Close strategy conversation" : "Strategiya söhbətini bağla");
  root.appendChild(backdrop);

  const panel = element("section", "strategy-ask-panel");
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");
  panel.setAttribute("aria-label", isEn ? "Strategy Copilot" : "Strategiya üzrə Helmer Ask");

  const header = element("header", "strategy-ask-header");
  const heading = element("div", "strategy-ask-heading");
  const title = element("strong", "", isEn ? "Strategy Copilot" : "Ask Helmer");
  const context = element("span", "strategy-ask-context", state.strategy?.title || (isEn ? "Active Strategy" : "Aktiv strategiya"));
  heading.append(title, context);
  const close = button("", "strategy-ask-close", (e) => {
    e.preventDefault();
    state.strategyAskOpen = false;
    root.classList.remove("is-open");
    document.querySelector(".strategy-view")?.classList.remove("is-ask-open");
    const askBtn = document.querySelector(".dock-ask-btn");
    if (askBtn) askBtn.setAttribute("aria-expanded", "false");
  });
  close.type = "button";
  close.setAttribute("aria-label", isEn ? "Minimize conversation" : "Söhbəti kiçilt");
  close.innerHTML = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m7 10 5 5 5-5"/></svg>';
  header.append(heading, close);

  const body = element("div", "strategy-ask-body");
  body.setAttribute("aria-live", "polite");
  if (!state.askMessages.length) {
    const welcome = element("div", "strategy-ask-welcome");
    welcome.innerHTML = `<span class="strategy-ask-orb">✦</span><strong>${isEn ? "Analyze this strategy together" : "Strategiyanı birlikdə təhlil edək"}</strong><p>${isEn ? "Ask about strategic decisions, key priorities, risks, or next action steps." : "Bu strategiyanın qərarları, prioritetləri, riskləri və icra addımları barədə soruş."}</p>`;
    body.appendChild(welcome);
    const askSuggestions = isEn ? [
      "What is the biggest risk in this strategy?",
      "What should I prioritize in the first 30 days?",
      "Identify critical blind spots in this plan.",
    ] : [
      "Bu strategiyada ən böyük risk nədir?",
      "İlk 30 gündə nəyə fokuslanmalıyam?",
      "Bu planın zəif nöqtələrini göstər.",
    ];
    askSuggestions.forEach((question) => {
      const suggestion = button(question, "strategy-ask-suggestion", async (e) => {
        e.preventDefault();
        if (state.askLoading) return;
        const ready = await ensureStrategyAskContext();
        if (ready) submitAskMessage(question);
      });
      suggestion.type = "button";
      body.appendChild(suggestion);
    });
  } else {
    state.askMessages.forEach((message, index) => body.appendChild(buildStrategyAskMessage(message, index)));
  }

  if (state.askError) {
    const error = element("div", "strategy-ask-error", state.askError);
    if (state.askRetry) {
      const retry = button(isEn ? "Retry" : "Yenidən cəhd et", "ask-artifact-action", retryAskRequest);
      retry.type = "button"; error.append(retry);
    }
    body.appendChild(error);
  }

  const footer = element("footer", "strategy-ask-footer");
  const form = element("form", "strategy-ask-composer");
  const input = element("textarea", "strategy-ask-input");
  input.id = "strategyAskInput";
  input.value = state.askDraft || "";
  input.rows = 1;
  input.maxLength = 8000;
  input.placeholder = isEn ? "Ask a question about this strategy…" : "Strategiya haqqında soruş…";
  input.disabled = state.askLoading;
  const send = button("", "strategy-ask-send");
  const isStrategyGenerating = Boolean(state.askLoading);
  send.classList.toggle("is-stop", isStrategyGenerating);
  send.classList.toggle("is-generating", isStrategyGenerating);

  if (isStrategyGenerating) {
    send.type = "button";
    send.disabled = false;
    send.setAttribute("aria-label", isEn ? "Stop generating" : "Dayandır");
    send.title = isEn ? "Stop generating" : "Dayandır";
    send.appendChild(createAskStopIcon());
  } else {
    send.type = "submit";
    send.disabled = true;
    send.setAttribute("aria-label", isEn ? "Send question" : "Sualı göndər");
    send.title = isEn ? "Send question" : "Sualı göndər";
    send.appendChild(createStrategyAskSendIcon());
  }
  const composerBody = element("div", "strategy-artifact-composer-body");
  composerBody.append(input);
  if (state.currentUser) {
    window.HelmerArtifacts?.attachComposer({ input, body: composerBody, getSelection: () => state.askPluginIds || [], setSelection: ids => { state.askPluginIds = ids; } });
  }
  form.append(composerBody, send);

  const suggestionWrap = element("div", "ask-thinking-suggestion-wrap strategy-ask-thinking-suggestion-wrap");
  const suggestionBtn = button("", "ask-thinking-suggestion-btn", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!state.currentUser) {
      openGuestRestrictionModal(GUEST_RESTRICTION_NOTICES.thinking);
      return;
    }
    state.askThinkingLevel = "high";
    currentAskThinking = "high";
    state.askThinkingEnabled = true;
    try { localStorage.setItem("helmer_ask_thinking_level", "high"); } catch { }
    try { localStorage.setItem("helmer_ask_thinking_enabled", "true"); } catch { }
    suggestionWrap.style.display = "none";
  });
  suggestionBtn.type = "button";
  suggestionBtn.innerHTML = `<span class="ask-thinking-suggestion-spark">✦</span><span>${isEn ? "Want to switch to High thinking level?" : "High düşünmə səviyyəsinə keçmək istəyirsən?"}</span>`;
  suggestionWrap.style.display = "none";
  suggestionWrap.appendChild(suggestionBtn);

  const resize = () => {
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 110)}px`;
    const val = input.value.trim();
    if (state.askLoading) {
      send.disabled = false;
    } else {
      send.disabled = val.length < 2;
    }
    const isComplex = isComplexAskQuery(val, false);
    if (isComplex && currentAskThinking !== "high" && !state.askLoading) {
      suggestionWrap.style.display = "inline-flex";
    } else {
      suggestionWrap.style.display = "none";
    }
  };
  input.addEventListener("input", () => { state.askDraft = input.value; resize(); });
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      if (state.askLoading) {
        abortAskMessage();
      } else if (!send.disabled) {
        form.requestSubmit();
      }
    }
  });
  send.addEventListener("click", (event) => {
    if (state.askLoading) {
      event.preventDefault();
      event.stopPropagation();
      abortAskMessage();
    }
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (state.askLoading) {
      abortAskMessage();
      return;
    }
    const message = input.value.trim();
    if (message.length < 2 || state.askLoading) return;
    input.value = "";
    state.askDraft = "";
    send.disabled = true;
    const ready = await ensureStrategyAskContext();
    if (ready) submitAskMessage(message);
  });

  footer.append(form, suggestionWrap, element("p", "strategy-ask-disclaimer", isEn ? "Conversation is saved in Chat history · Answers are grounded in the active strategy." : "Söhbət Ask tarixçəsində saxlanılır · Cavab aktiv strategiya əsasında hazırlanır."));
  panel.append(header, body, footer);
  root.appendChild(panel);

  if (state.strategyAskOpen) {
    requestAnimationFrame(() => {
      body.scrollTop = body.scrollHeight;
      if (!state.askLoading && window.innerWidth > 767) input.focus();
    });
  }
  return root;
}

function renderStrategyWorkspace() {
  const isEn = getLanguage() === "en";
  workspace.classList.add("workspace-document");
  const strategy = state.strategy;
  const view = element("div", `strategy-view${state.status === "refining" ? " is-refining" : ""}${state.strategyAskOpen ? " is-ask-open" : ""}`);

  // Toolbar - Clean Top Navigation with Breadcrumb and Format Switcher
  const toolbar = element("div", "strategy-toolbar");
  const crumb = button(`${isEn ? "Archive" : "Arxiv"} / ${strategy.title}`, "strategy-breadcrumb", () => {
    if (!state.currentUser) {
      openGuestRestrictionModal(GUEST_RESTRICTION_NOTICES.strategy);
      return;
    }
    state.view = "list";
    render();
  });

  const switcher = buildFormatSwitcher();
  toolbar.append(crumb, switcher);

  // Header
  const header = buildStrategyHeader(strategy);

  // Canvas
  const documentCanvas = element("main", "strategy-document-canvas");
  documentCanvas.appendChild(header);

  if (!state.currentUser) {
    const guestLimitCard = createBuildGuestLimitCard(isEn);
    if (guestLimitCard) documentCanvas.appendChild(guestLimitCard);
  }

  let tocItems = [];
  if (state.strategyFormat === "faq") {
    documentCanvas.appendChild(buildFaqView(strategy));
    tocItems = isEn ? [
      ["overview", "Summary & Context"],
      ["faq-goal", "Goal"],
      ["faq-audience", "Audience"],
      ["faq-priorities", "Priorities"],
      ["faq-decisions", "Decisions"],
      ["faq-execution", "Execution Plan"],
      ["faq-kpi", "KPI Metrics"],
      ["faq-risks", "Risks"],
      ["faq-next", "First Steps"],
    ] : [
      ["overview", "Xülasə & Kontekst"],
      ["faq-goal", "Məqsəd"],
      ["faq-audience", "Auditoriya"],
      ["faq-priorities", "Prioritetlər"],
      ["faq-decisions", "Qərarlar"],
      ["faq-execution", "İcra Planı"],
      ["faq-kpi", "KPI Metrikləri"],
      ["faq-risks", "Risklər"],
      ["faq-next", "İlk Addımlar"],
    ];
  } else if (state.strategyFormat === "roadmap") {
    documentCanvas.appendChild(buildRoadmapView(strategy));
    tocItems = isEn ? [
      ["overview", "Summary"],
      ["execution", "Phases"],
      ["next", "Next Steps"],
      ["kpi", "KPI Points"],
    ] : [
      ["overview", "Xülasə"],
      ["execution", "Mərhələlər"],
      ["next", "Növbəti Addımlar"],
      ["kpi", "KPI Nöqtələri"],
    ];
  } else {
    documentCanvas.appendChild(buildBlogView(strategy));
    tocItems = isEn ? [
      ["overview", "Summary & Context"],
      ["priorities", "01. Priorities"],
      ["decisions", "02. Strategic Decisions"],
      ["execution", "03. Execution Plan"],
      ["kpi", "04. KPI Targets"],
      ["risks", "05. Risks & Mitigations"],
      ["next", "06. Immediate Steps"],
    ] : [
      ["overview", "Xülasə & Kontekst"],
      ["priorities", "01. Prioritetlər"],
      ["decisions", "02. Strateji Qərarlar"],
      ["execution", "03. İcra Planı"],
      ["kpi", "04. KPI Hədəfləri"],
      ["risks", "05. Risklər və Həlli"],
      ["next", "06. Növbəti Addımlar"],
    ];
  }

  // Sticky TOC
  const toc = element("nav", "strategy-toc");
  toc.setAttribute("aria-label", isEn ? "Strategy sections" : "Strategiya bölmələri");
  tocItems.forEach(([id, label], index) => {
    const link = element("a", index === 0 ? "is-active" : "", label);
    link.href = `#${id}`;
    link.addEventListener("click", (e) => {
      e.preventDefault();
      const target = document.getElementById(id);
      if (target) {
        target.scrollIntoView({ behavior: "smooth", block: "start" });
        history.replaceState(null, "", `#${id}`);
      }
    });
    toc.appendChild(link);
  });

  const shell = element("div", "strategy-local-shell");
  shell.append(toc, documentCanvas);
  view.append(toolbar, shell, buildRefinementPanel(), buildStrategyAskAssistant());

  if (state.status === "refining") {
    const working = element("div", "refining-banner");
    working.append(element("span", "inline-spinner"), element("span", "", isEn ? "Strategy is refining — existing version remains visible." : "Strategiya yenilənir — mövcud versiya ekranda qalır."));
    view.prepend(working);
  }
  const banner = errorBanner();
  if (banner) view.insertBefore(banner, shell);
  workspace.appendChild(view);

  const sectionNodes = tocItems.map(([id]) => document.getElementById(id)).filter(Boolean);
  const observer = new IntersectionObserver((entries) => {
    const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
    if (!visible) return;
    [...toc.children].forEach((link) => link.classList.toggle("is-active", link.getAttribute("href") === `#${visible.target.id}`));
  }, { rootMargin: "-18% 0px -68% 0px", threshold: [0, 0.2, 0.6] });
  sectionNodes.forEach((section) => observer.observe(section));
}

function firstSentences(value, count = 2, maxLength = count === 1 ? 180 : 360) {
  const text = String(value || "").trim();
  const sentences = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [text];
  const summary = sentences.slice(0, count).join(" ").trim();
  return summary.length > maxLength ? `${summary.slice(0, maxLength - 1).trim()}…` : summary;
}

function shortValue(value, max = 28) {
  const text = String(value || "—").trim();
  return text.length > max ? `${text.slice(0, max - 1).trim()}…` : text;
}

function budgetSignal(brief) {
  const isEn = getLanguage() === "en";
  const match = String(brief || "").match(/(?:₼|AZN|manat|büdcə|budget|\$|USD)\s*[:：-]?\s*([\d.,]+(?:\s*[–-]\s*[\d.,]+)?)/i)
    || String(brief || "").match(/([\d.,]+(?:\s*[–-]\s*[\d.,]+)?)\s*(?:AZN|₼|manat|\$|USD)/i);
  return match ? `${match[1]} AZN` : (isEn ? "Optimized" : "Optimallaşdırılmış");
}

function buildRefinementPanel() {
  const isEn = getLanguage() === "en";
  const panel = element("section", `refinement-dock${state.refinementOpen ? " is-expanded" : ""}`);
  panel.setAttribute("aria-label", isEn ? "Refine and manage strategy" : "Strategiyanı idarə et və yenilə");

  // Compact document actions live in the same surface as the refinement composer.
  const actionsStrip = element("div", "dock-actions-strip");

  const refineToggle = button("", "dock-action-btn dock-refine-toggle", (e) => {
    e.preventDefault();
    if (!state.currentUser) {
      openGuestRestrictionModal(GUEST_RESTRICTION_NOTICES.strategy);
      return;
    }
    state.refinementOpen = !state.refinementOpen;
    refineToggle.setAttribute("aria-expanded", String(state.refinementOpen));
    refineToggle.title = state.refinementOpen ? (isEn ? "Close" : "Bağla") : (isEn ? "Request edit" : "Düzəliş istə");
    panel.classList.toggle("is-expanded", state.refinementOpen);

    let popover = panel.querySelector(".refinement-popover");
    if (state.refinementOpen) {
      if (!popover) {
        popover = element("div", "refinement-popover");
        popover.append(form);
        panel.appendChild(popover);
      }
      popover.hidden = false;
      requestAnimationFrame(() => {
        if (!input.disabled) {
          input.focus();
          startRefinementPlaceholderTyping(input);
        }
      });
    } else {
      if (popover) popover.remove();
      clearTimeout(refinementPlaceholderTimer);
    }
  });
  refineToggle.type = "button";
  refineToggle.setAttribute("aria-label", state.refinementOpen ? (isEn ? "Close refinement panel" : "Düzəliş pəncərəsini bağla") : (isEn ? "Request refinement" : "Strategiyada düzəliş istə"));
  refineToggle.setAttribute("aria-expanded", String(state.refinementOpen));
  refineToggle.title = state.refinementOpen ? (isEn ? "Close" : "Bağla") : (isEn ? "Request strategic revisions" : "Düzəliş istə");
  refineToggle.innerHTML = `
    <svg class="dock-btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>
    </svg>
    <span>${isEn ? "Refine Strategy" : "Düzəliş istə"}</span>
  `;

  // Export wrap + button with minimalist download/export icon + menu
  const exportWrap = element("div", "export-wrap dock-export-wrap");
  const exportBtn = button("", "dock-action-btn dock-export-btn");
  exportBtn.setAttribute("aria-haspopup", "menu");
  exportBtn.setAttribute("aria-expanded", "false");
  exportBtn.innerHTML = `
    <svg class="dock-btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
      <polyline points="7 10 12 15 17 10"/>
      <line x1="12" y1="15" x2="12" y2="3"/>
    </svg>
    <span>${isEn ? "Export" : "Yüklə"}</span>
    <svg class="dock-chevron-icon" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>
  `;
  const menu = buildExportMenu(exportBtn);
  const onExportDocClick = (e) => {
    if (!exportWrap.contains(e.target)) {
      menu.classList.remove("is-open");
      exportBtn.setAttribute("aria-expanded", "false");
    }
  };
  exportBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const open = menu.classList.toggle("is-open");
    exportBtn.setAttribute("aria-expanded", String(open));
    if (open) {
      setTimeout(() => document.addEventListener("click", onExportDocClick, { once: true }), 0);
    }
  });
  exportWrap.append(exportBtn, menu);

  const toolbarSeparator = element("span", "dock-toolbar-separator");
  toolbarSeparator.setAttribute("aria-hidden", "true");

  // 3. Save button with minimalist bookmark/check icon
  const saveBtn = button("", `dock-action-btn dock-save-btn${state.savedId ? " is-saved" : ""}`, () => {
    if (!state.currentUser) {
      openGuestRestrictionModal(GUEST_RESTRICTION_NOTICES.strategy);
      return;
    }
    saveStrategy();
  });
  saveBtn.disabled = Boolean(state.savedId) || state.status === "refining";
  const saveIconSvg = state.savedId
    ? `<svg class="dock-btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><polyline points="8 12 10.7 14.7 16.5 9"/></svg>`
    : `<svg class="dock-btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>`;
  saveBtn.innerHTML = `
    ${saveIconSvg}
    <span>${state.savedId ? (isEn ? "Saved" : "Yadda saxlanıldı") : (isEn ? "Save" : "Yadda saxla")}</span>
  `;

  const askSeparator = element("span", "dock-toolbar-separator dock-ask-separator");
  askSeparator.setAttribute("aria-hidden", "true");

  const askBtn = button("", "dock-action-btn dock-ask-btn", (e) => {
    e.preventDefault();
    if (!state.currentUser) {
      openGuestRestrictionModal(GUEST_RESTRICTION_NOTICES.strategy);
      return;
    }
    state.askModel = "gemini-3.8-flash";
    if (state.savedId) resetAskForStrategy(state.savedId);
    else resetAskForStrategy("", true);
    state.strategyAskOpen = true;
    const root = document.querySelector(".strategy-ask-root");
    const strategyView = document.querySelector(".strategy-view");
    if (root) {
      root.classList.add("is-open");
      strategyView?.classList.add("is-ask-open");
      askBtn.setAttribute("aria-expanded", "true");
      const askInput = root.querySelector(".strategy-ask-input");
      const askBody = root.querySelector(".strategy-ask-body");
      if (askBody) askBody.scrollTop = askBody.scrollHeight;
      if (askInput && window.innerWidth > 767) askInput.focus();
    } else {
      render();
    }
  });
  askBtn.type = "button";
  askBtn.setAttribute("aria-label", isEn ? "Ask Helmer about this strategy" : "Bu strategiya haqqında Helmer-dən soruş");
  askBtn.setAttribute("aria-expanded", String(state.strategyAskOpen));
  askBtn.innerHTML = `
    <svg class="dock-btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z"/><path d="M8 9h8M8 13h5"/></svg>
    <span>${isEn ? "Ask Strategy Copilot" : "Strategiya barədə soruş"}</span>
  `;

  actionsStrip.append(refineToggle, exportWrap, toolbarSeparator, saveBtn, askSeparator, askBtn);

  // Suggestions are presented as an animated placeholder instead of controls.
  const form = element("form", "refinement-form");
  const label = element("label", "sr-only", isEn ? "Refinement request" : "Dəyişiklik istəyi");
  label.htmlFor = "refinementInput";

  const inputPrefix = element("div", "refine-input-prefix");
  inputPrefix.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/></svg>`;

  const input = element("textarea", "refinement-input");
  input.id = "refinementInput";
  input.rows = 1;
  input.maxLength = 2000;
  input.placeholder = isEn ? "Shorten" : "Qısalt";
  input.disabled = state.status === "refining";

  const submit = button("", "refine-submit");
  submit.type = "submit";
  submit.disabled = true;
  submit.setAttribute("aria-label", isEn ? "Send refinement request" : "Dəyişiklik istəyini göndər");
  submit.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>`;

  form.append(label, inputPrefix, input, submit);

  const resizeInput = () => {
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 140)}px`;
    submit.disabled = input.value.trim().length < 3 || state.status === "refining";
  };

  input.addEventListener("input", resizeInput);
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing && window.innerWidth > 700) {
      event.preventDefault();
      if (!submit.disabled) form.requestSubmit();
    }
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const request = input.value.trim();
    if (request.length >= 3) requestRefinement("custom", request);
  });

  panel.append(actionsStrip);
  if (state.refinementOpen) {
    const popover = element("div", "refinement-popover");
    popover.append(form);
    panel.appendChild(popover);
    requestAnimationFrame(() => {
      if (!input.disabled) {
        input.focus();
        startRefinementPlaceholderTyping(input);
      }
    });
  }
  return panel;
}

function startRefinementPlaceholderTyping(input) {
  const isEn = getLanguage() === "en";
  const suggestions = isEn
    ? ["Make it more concise...", "Localize for regional market...", "Deepen competitive analysis...", "Focus on immediate quick wins...", "Optimize budget allocation..."]
    : ["Qısalt", "Lokallaşdır", "Daha dərindən düşün", "Praktik et", "Büdcəni optimallaşdır"];
  let suggestionIndex = 0;
  let characterIndex = 0;
  let deleting = false;

  const tick = () => {
    if (!input.isConnected) return;
    const suggestion = suggestions[suggestionIndex];
    input.placeholder = suggestion.slice(0, characterIndex);

    if (!deleting && characterIndex < suggestion.length) {
      characterIndex += 1;
      refinementPlaceholderTimer = setTimeout(tick, 58);
    } else if (!deleting) {
      deleting = true;
      refinementPlaceholderTimer = setTimeout(tick, 2200);
    } else if (characterIndex > 0) {
      characterIndex -= 1;
      refinementPlaceholderTimer = setTimeout(tick, 32);
    } else {
      deleting = false;
      suggestionIndex = (suggestionIndex + 1) % suggestions.length;
      refinementPlaceholderTimer = setTimeout(tick, 220);
    }
  };

  tick();
}

async function requestRefinement(action, request, retryIdempotencyKey = null) {
  const epoch = state.identityEpoch;
  const expectedUserId = state.currentUser?.id || null;
  const previousStatus = state.savedId ? "saved" : "ready";
  const refinementKey = retryIdempotencyKey || window.helmerSecurity?.idempotencyKey?.() || crypto.randomUUID();
  clearError();
  state.changeSummary = "";
  state.refinementOpen = false;
  trackEvent("refinement_requested", { action, saved: Boolean(state.savedId) });
  if (action !== "custom") trackEvent("quick_action_used", { action });
  currentAbortController?.abort();
  const controller = new AbortController();
  currentAbortController = controller;
  setStatus("refining");
  render();
  const path = state.savedId ? `/api/strategy/${state.savedId}/refine` : "/api/strategy/refine";
  const activeBuildMode = state.strategy?.orchestration?.buildMode || (state.buildModel === "faster" ? "faster" : "auto");
  const activeFasterThinking = state.strategy?.orchestration?.fasterThinkingLevel || (state.buildFasterThinkingLevel === "high" ? "high" : "medium");
  try {
    const data = await api(path, {
      method: "POST",
      signal: controller.signal,
      headers: { "Idempotency-Key": refinementKey },
      body: JSON.stringify({
        brief: state.brief,
        answers: state.answers,
        strategy: state.strategy,
        action,
        request,
        idempotencyKey: refinementKey,
        language: getLanguage(),
        ...(activeBuildMode === "faster" ? {
          buildMode: "faster",
          fasterThinkingLevel: activeFasterThinking,
        } : {}),
      }),
    });
    if (currentAbortController === controller) currentAbortController = null;
    if (isIdentityStale(epoch, expectedUserId) || controller.signal.aborted) return;
    const record = data.strategy;
    state.strategy = record.strategy || record;
    state.updatedAt = record.updatedAt || new Date().toISOString();
    if (record.versions) {
      state.versions = record.versions;
    } else {
      state.versions.push({
        versionNumber: state.versions.length + 1,
        data: state.strategy,
        changeRequest: request || action,
        createdAt: state.updatedAt,
      });
    }
    const isEn = getLanguage() === "en";
    const actionLabel = QUICK_ACTIONS.find(([id]) => id === action)?.[1];
    state.changeSummary = isEn
      ? `Updated — ${actionLabel || "requested revisions"} applied to relevant strategy sections.`
      : `Yeniləndi — ${actionLabel || "istədiyin dəyişiklik"} strategiyanın əlaqəli hissələrinə tətbiq olundu.`;
    setStatus(state.savedId ? "saved" : "ready");
    render();
    showToast(isEn ? "New strategy version is ready." : "Yeni strategiya versiyası hazırdır.");
    if (state.savedId) loadSavedStrategies();
  } catch (error) {
    if (currentAbortController === controller) currentAbortController = null;
    if (error?.name === "AbortError" || controller.signal.aborted || isIdentityStale(epoch, expectedUserId)) return;
    setError(error, () => requestRefinement(action, request, refinementKey), previousStatus);
  }
}

async function saveStrategy() {
  if (state.savedId || !state.strategy) return;
  const epoch = state.identityEpoch;
  const expectedUserId = state.currentUser?.id || null;
  const isEn = getLanguage() === "en";
  try {
    const data = await api("/api/strategy/save", {
      method: "POST",
      body: JSON.stringify({
        clientSaveId: state.clientSaveId,
        brief: state.brief,
        answers: state.answers,
        strategy: state.strategy,
        versions: state.versions,
        acceptForLearning: true,
      }),
    });
    if (isIdentityStale(epoch, expectedUserId)) return;
    state.savedId = data.strategy.id;
    state.updatedAt = data.strategy.updatedAt;
    state.versions = data.strategy.versions;
    setStatus("saved");
    trackEvent("strategy_saved", { versionCount: state.versions.length });
    render();
    showToast(isEn ? "Strategy saved to workspace." : "Strategiya workspace-ə əlavə edildi.");
    await loadSavedStrategies();
  } catch (error) {
    if (isIdentityStale(epoch, expectedUserId)) return;
    showToast(error.message, "error");
  }
}

function isStrategyGroundedClient(strategy) {
  if (!strategy || typeof strategy !== "object") return false;
  const orch = strategy.orchestration && typeof strategy.orchestration === "object" ? strategy.orchestration : null;
  return Boolean(
    strategy.searchGrounded === true ||
    strategy.groundingActive === true ||
    (Array.isArray(strategy.sources) && strategy.sources.length > 0) ||
    (Array.isArray(strategy.evidence) && strategy.evidence.length > 0) ||
    orch?.searchGrounded === true ||
    orch?.groundingActive === true ||
    Number(orch?.sourcesCount) > 0 ||
    (Array.isArray(orch?.sources) && orch.sources.length > 0) ||
    (Array.isArray(orch?.evidence) && orch.evidence.length > 0) ||
    (Array.isArray(orch?.searchQueries) && orch.searchQueries.length > 0) ||
    (typeof orch?.searchEntryPoint?.renderedContent === "string" && orch.searchEntryPoint.renderedContent.trim().length > 0) ||
    (Array.isArray(orch?.stageMetrics) && orch.stageMetrics.some((s) => s && (s.groundingActive || s.searchGrounded || Number(s.verifiedSourcesCount) > 0)))
  );
}

function sendExportTelemetry(format, title = "") {
  const isSavedUuid = Boolean(state?.savedId && /^[0-9a-f-]{36}$/i.test(state.savedId));
  const isGrounded = isStrategyGroundedClient(state?.strategy);
  const hideContent = isGrounded || !isSavedUuid;
  fetch("/api/telemetry/event", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      eventType: "export_requested",
      format,
      strategyId: isSavedUuid ? state.savedId : null,
      clientSaveId: (!isSavedUuid && state?.clientSaveId) ? state.clientSaveId : null,
      title: hideContent ? "" : ((title || state?.strategy?.title || "").slice(0, 200)),
      ...(isGrounded ? { groundingActive: true } : {}),
    }),
  }).catch(() => { });
}

function buildExportMenu(trigger) {
  const isEn = getLanguage() === "en";
  const menu = element("div", "export-menu");
  menu.setAttribute("role", "menu");
  const title = element("span", "export-label", isEn ? "Export" : "İxrac et");
  menu.appendChild(title);

  const pdf = button(isEn ? "PDF Document (.pdf)" : "PDF sənədi (.pdf)", "export-option", () => {
    trackEvent("export_requested", { format: "pdf" });
    sendExportTelemetry("pdf");
    menu.classList.remove("is-open");
    trigger.setAttribute("aria-expanded", "false");
    showToast(isEn ? "Generating and opening PDF…" : "PDF generasiya edilir və açılır…");
    exportStrategyToPDF(state.strategy);
  });

  const doc = button(isEn ? "HTML Report (.html)" : "HTML sənədi (.html)", "export-option", () => {
    trackEvent("export_requested", { format: "document" });
    sendExportTelemetry("html");
    downloadExport(createDocumentExport(state.strategy));
    menu.classList.remove("is-open");
    trigger.setAttribute("aria-expanded", "false");
  });

  const excel = button(isEn ? "Excel Spreadsheet (.xls)" : "Excel cədvəli (.xls)", "export-option", () => {
    trackEvent("export_requested", { format: "excel" });
    sendExportTelemetry("excel");
    downloadExport(createExcelExport(state.strategy));
    menu.classList.remove("is-open");
    trigger.setAttribute("aria-expanded", "false");
  });

  const csv = button(isEn ? "CSV Data (.csv)" : "CSV / Cədvəl (.csv)", "export-option", () => {
    trackEvent("export_requested", { format: "spreadsheet" });
    sendExportTelemetry("csv");
    downloadExport(createSpreadsheetExport(state.strategy));
    menu.classList.remove("is-open");
    trigger.setAttribute("aria-expanded", "false");
  });

  menu.append(pdf, doc, excel, csv);
  return menu;
}

function downloadExport(file) {
  const isEn = getLanguage() === "en";
  const content = file.extension === "xls" && !String(file.content).startsWith("\ufeff")
    ? `\ufeff${file.content}`
    : file.content;
  const url = URL.createObjectURL(new Blob([content], { type: file.type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `${slugify(state.strategy.title)}.${file.extension}`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  showToast(isEn ? "Export file ready." : "Export faylı hazırdır.");
}

async function loadSavedStrategies() {
  if (!state.currentUser) {
    state.savedStrategies = [];
    if (strategyCount) strategyCount.style.display = "none";
    renderRecentList();
    return;
  }
  const epoch = state.identityEpoch;
  const expectedUserId = state.currentUser?.id || null;
  try {
    const data = await api("/api/strategy");
    if (epoch !== state.identityEpoch || (state.currentUser?.id || null) !== expectedUserId) return;
    state.savedStrategies = data.strategies || [];
    if (strategyCount) {
      if (!state.currentUser) {
        strategyCount.style.display = "none";
      } else {
        strategyCount.style.display = "";
        strategyCount.textContent = String(state.savedStrategies.length);
      }
    }
    renderRecentList();
    if (state.view === "list") renderStrategyList();
    const railPopover = document.querySelector("#railArchivePopover");
    if (railPopover && !railPopover.hidden) renderRailArchivePopover();
  } catch {
    if (epoch !== state.identityEpoch || (state.currentUser?.id || null) !== expectedUserId) return;
    recentList.replaceChildren(element("p", "recent-empty", "Strategiyaları yükləmək mümkün olmadı."));
  }
}

async function loadSavedChats() {
  const epoch = state.identityEpoch;
  const expectedUserId = state.currentUser?.id || null;
  try {
    const data = await api("/api/ask/chats");
    if (epoch !== state.identityEpoch || (state.currentUser?.id || null) !== expectedUserId) return;
    state.savedChats = data.chats || [];
    state.savedChats.forEach((chat) => {
      if (chat?.id) window.helmerSecurity?.rememberChat(chat);
    });
    renderRecentList();
  } catch (error) {
    console.error("Failed to load chats:", error);
  }
}

async function openSavedChat(chatId) {
  const isEn = getLanguage() === "en";
  const epoch = state.identityEpoch;
  const expectedUserId = state.currentUser?.id || null;
  try {
    const data = await api(`/api/ask/chats/${chatId}`);
    if (epoch !== state.identityEpoch || (state.currentUser?.id || null) !== expectedUserId) return;
    if (!data.chat) return;
    rememberSavedAskChat(data.chat);
    state.mode = "ask";
    state.view = "home";
    state.askChatId = data.chat.id;
    state.currentChatId = data.chat.id;
    state.askMessages = data.chat.messages || [];
    state.askPluginIds = [];
    state.askArtifactId = null;
    state.askArtifactName = "";
    state.askRetry = null;
    state.askStrategyId = data.chat.strategyId || "";
    state.askTaskId = data.chat.taskId || "";
    state.askError = "";
    syncMode();
    syncNav();
    render();
    closeSidebar();

    // Reconnect to in-flight research background jobs if any
    state.askMessages.forEach((msg) => {
      if (msg && (msg.type === "research" || msg.jobId) && (msg.status === "pending" || msg.status === "running")) {
        connectToResearchJobStream(msg);
      }
    });
  } catch (error) {
    if (epoch !== state.identityEpoch || (state.currentUser?.id || null) !== expectedUserId) return;
    showToast(isEn ? "Unable to load chat." : "Söhbəti yükləmək mümkün olmadı.", "error");
  }
}

async function deleteSavedChat(event, chatId) {
  event.stopPropagation();
  const isEn = getLanguage() === "en";
  const epoch = state.identityEpoch;
  const expectedUserId = state.currentUser?.id || null;
  try {
    await api(`/api/ask/chats/${chatId}`, { method: "DELETE" });
    if (isIdentityStale(epoch, expectedUserId)) return;
    if (state.askChatId === chatId) {
      startNewChat();
    }
    await loadSavedChats();
    showToast(isEn ? "Chat deleted." : "Söhbət silindi.");
  } catch (error) {
    if (isIdentityStale(epoch, expectedUserId)) return;
    showToast(isEn ? "Unable to delete chat." : "Söhbəti silmək mümkün olmadı.", "error");
  }
}

function renderRecentList() {
  const isEn = getLanguage() === "en";
  recentList.replaceChildren();

  if (state.mode === "ask") {
    if (!state.savedChats.length) {
      const empty = element("div", "recent-empty");
      empty.append(
        element("strong", "", isEn ? "Chats will appear here." : "Söhbətlər burada görünəcək."),
        element("span", "", isEn ? "Your conversations with Helmer Ask are saved here." : "Helmer Ask ilə apardığın söhbətlər burada saxlanılır.")
      );
      recentList.appendChild(empty);
      return;
    }

    state.savedChats.slice(0, 4).forEach((chat) => {
      const item = button("", "recent-item", () => openSavedChat(chat.id));
      item.classList.toggle("is-active", state.askChatId === chat.id);

      const textWrap = element("div", "recent-text-wrap");
      textWrap.append(
        element("span", "recent-title", chat.title || (isEn ? "Chat" : "Söhbət")),
        element("span", "recent-date", formatDate(chat.updatedAt || chat.createdAt))
      );

      const deleteBtn = button("", "recent-delete-btn", (e) => deleteSavedChat(e, chat.id));
      deleteBtn.setAttribute("aria-label", isEn ? "Delete chat" : "Söhbəti sil");
      deleteBtn.setAttribute("title", isEn ? "Delete chat" : "Söhbəti sil");

      const delSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      delSvg.setAttribute("viewBox", "0 0 24 24");
      delSvg.setAttribute("width", "13");
      delSvg.setAttribute("height", "13");
      delSvg.setAttribute("fill", "none");
      delSvg.setAttribute("stroke", "currentColor");
      delSvg.setAttribute("stroke-width", "2");
      delSvg.setAttribute("stroke-linecap", "round");
      delSvg.setAttribute("stroke-linejoin", "round");
      delSvg.setAttribute("aria-hidden", "true");
      const delPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
      delPath.setAttribute("d", "M18 6 6 18M6 6l12 12");
      delSvg.appendChild(delPath);
      deleteBtn.appendChild(delSvg);

      item.append(textWrap, deleteBtn);
      recentList.appendChild(item);
    });
    return;
  }

  if (!state.savedStrategies.length && !backgroundJobs.some((j) => j.status === "generating")) {
    const empty = element("div", "recent-empty");
    empty.append(
      element("strong", "", isEn ? "Strategies will appear here." : "Strategiyalar burada görünəcək."),
      element("span", "", isEn ? "Your saved strategy roadmaps are preserved here." : "Yadda saxladığın işlər bu bölmədə qalır.")
    );
    recentList.appendChild(empty);
    return;
  }

  // Show active background jobs at top of recent list
  backgroundJobs.filter((j) => j.status === "generating").forEach((job) => {
    const item = button("", "recent-item is-bg-job", () => openBackgroundJob(job.id));
    const pulse = element("span", "recent-bg-pulse");
    const textWrap = element("div", "recent-text-wrap");
    const jobTitle = job.brief ? (job.brief.length > 26 ? job.brief.slice(0, 26) + "…" : job.brief) : (isEn ? "New Strategy" : "Yeni Strategiya");
    textWrap.append(element("span", "recent-title", jobTitle), element("span", "recent-date", (isEn ? "Generating · " : "Hazırlanır · ") + formatDate(job.startedAt)));
    item.append(pulse, textWrap);
    recentList.appendChild(item);
  });

  state.savedStrategies.slice(0, Math.max(0, 4 - backgroundJobs.filter((j) => j.status === "generating").length)).forEach((record) => {
    const item = button("", "recent-item", () => openSavedStrategy(record.id));
    item.classList.toggle("is-active", state.savedId === record.id);

    const textWrap = element("div", "recent-text-wrap");
    textWrap.append(element("span", "recent-title", record.title), element("span", "recent-date", formatDate(record.updatedAt)));

    item.append(textWrap);
    recentList.appendChild(item);
  });
}

function clearUserScopedWorkspaceState() {
  state.identityEpoch = (state.identityEpoch || 0) + 1;
  closeSearchModal();
  if (typeof stopBuildCountdown === "function") stopBuildCountdown();
  if (typeof stopBuildIntelligence === "function") stopBuildIntelligence();
  if (typeof stopAskPlaceholderAnimation === "function") stopAskPlaceholderAnimation();
  document.querySelectorAll(".build-menu-actions, .build-rail-actions").forEach(node => node.remove());
  state.buildStartedAt = null;
  if (currentAbortController) {
    try { currentAbortController.abort(); } catch {}
    currentAbortController = null;
  }
  if (typeof detachedBuildAbortControllers !== "undefined" && detachedBuildAbortControllers.size > 0) {
    for (const controller of detachedBuildAbortControllers) {
      try { controller.abort(); } catch {}
    }
    detachedBuildAbortControllers.clear();
  }
  if (typeof backgroundResumeAbortControllers !== "undefined" && backgroundResumeAbortControllers.size > 0) {
    for (const controller of backgroundResumeAbortControllers) {
      try { controller.abort(); } catch {}
    }
    backgroundResumeAbortControllers.clear();
  }
  if (typeof progressTimer !== "undefined" && progressTimer) {
    clearInterval(progressTimer);
    progressTimer = null;
  }
  if (typeof cancelBuildEstimate === "function") {
    try { cancelBuildEstimate(); } catch {}
  }
  if (currentAskAbortController) {
    try { currentAskAbortController.abort(); } catch {}
    currentAskAbortController = null;
  }
  if (activeAskReader) {
    try { activeAskReader.cancel().catch(() => {}); } catch {}
    activeAskReader = null;
  }
  if (activeAskTypewriter) {
    try { activeAskTypewriter.flush(); } catch {}
    activeAskTypewriter = null;
  }
  if (typeof activeResearchStreams !== "undefined" && activeResearchStreams.size > 0) {
    for (const controller of activeResearchStreams.values()) {
      try { controller.abort(); } catch {}
    }
    activeResearchStreams.clear();
  }
  try {
    document.querySelector(".loading-ask-modal-overlay")?._closeAskModal?.();
    document.querySelectorAll(".planner-modal-overlay").forEach((el) => el._closeModal ? el._closeModal() : el.remove());
    document.querySelector(".analysis-history-overlay")?.remove();
  } catch {}

  // Clear Build state
  state.status = "draft";
  state.brief = "";
  state.buildPreparationEstimate = null;
  state.buildEstimateBrief = "";
  state.buildEstimateUnavailable = false;
  state.questions = [];
  state.clarificationIndex = 0;
  state.clarificationDrafts = {};
  state.answers = [];
  state.assumptions = [];
  state.understanding = "";
  state.round = 0;
  state.strategy = null;
  state.versions = [];
  state.buildStreamingText = "";
  state.buildStreamingFinishReason = null;
  state.savedId = null;
  state.clientSaveId = crypto.randomUUID();
  state.savedStrategies = [];
  state.updatedAt = null;
  state.error = null;
  state.retry = null;
  state.changeSummary = "";
  state.strategyAskOpen = false;
  state.refinementOpen = false;
  state.buildModel = "auto";
  state.buildFasterThinkingLevel = "medium";
  try {
    localStorage.removeItem("helmer_build_model");
    localStorage.removeItem("helmer_build_faster_thinking");
  } catch {}

  // Clear Ask state
  state.askChatId = null;
  state.currentChatId = null;
  state.savedChats = [];
  state.askMessages = [];
  state.askDraft = "";
  state.askPluginIds = [];
  state.askArtifactId = null;
  state.askArtifactName = "";
  state.askRetry = null;
  state.askLoading = false;
  state.askError = "";
  state.askPendingFile = null;
  state.askStrategyId = "";
  state.askTaskId = "";
  state.askPromptHintStrategyId = "";

  // Clear Planner, usage stats, security revisions, and guest quota state
  state.plannerTasks = [];
  state.plannerFilter = "active";
  state.plannerCollapsedGroups = new Set(["Ümumi"]);
  if (state.plannerSelectedTaskIds?.clear) {
    state.plannerSelectedTaskIds.clear();
  } else {
    state.plannerSelectedTaskIds = new Set();
  }
  state.isPrioritizingPlanner = false;
  state.usageStats = null;
  state.remainingGuestMessages = null;
  state.remainingGuestBriefs = null;
  state.guestQuotaCheckedAt = 0;
  state.guestQuotaVersion += 1;
  window.helmerSecurity?.revisions?.clear?.();
  backgroundJobs = [];

  try {
    sessionStorage.removeItem("helmer_active_ask_chat");
    sessionStorage.removeItem("helmer_planner_visit_notif_shown");
  } catch {}

  if (strategyCount) strategyCount.style.display = "none";
  if (typeof updatePlannerBadge === "function") updatePlannerBadge();
  if (typeof renderRecentList === "function") renderRecentList();
}

window.addEventListener("helmer:logout", () => {
  state.currentUser = null;
  clearUserScopedWorkspaceState();
  render();
});

window.addEventListener("helmer:auth-required", () => {
  if (state.currentUser) {
    state.currentUser = null;
    clearUserScopedWorkspaceState();
  }
});

window.addEventListener("helmer:user-changed", (event) => {
  const nextUser = event?.detail?.user || null;
  if ((state.currentUser?.id || null) !== (nextUser?.id || null)) {
    updateWorkspaceIdentity(nextUser);
  }
});

function updateWorkspaceIdentity(user) {
  const prevId = state.currentUser?.id || null;
  const nextId = user?.id || null;
  if (prevId !== nextId) {
    clearUserScopedWorkspaceState();
  }
  state.currentUser = user;
  backgroundJobs = loadBackgroundJobs();
  const isEn = getLanguage() === "en";
  const supportTooltip = document.querySelector(".support-chat-tooltip-text");
  if (supportTooltip) {
    supportTooltip.textContent = getSupportGreeting();
  }
  if (!user) {
    workspaceAvatar.textContent = "H";
    railWorkspaceAvatar.textContent = "H";
    workspaceName.textContent = "Helmer";
    workspaceMeta.textContent = isEn ? "Guest session · account recommended" : "Hesabsız istifadə · hesab yaratmaq tövsiyə olunur";
    return;
  }
  const initials = user.fullName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toLocaleUpperCase("az"))
    .join("") || "H";
  workspaceAvatar.textContent = initials;
  railWorkspaceAvatar.textContent = initials;
  workspaceName.textContent = user.fullName;
  workspaceMeta.textContent = isEn ? `@${user.username} · Personal workspace` : `@${user.username} · Şəxsi hesab`;
  if (user?.settings && typeof user.settings.modelImprovement === "boolean") {
    try {
      localStorage.setItem("helmer_model_improvement", String(user.settings.modelImprovement));
      setCookie("helmer_model_improvement", String(user.settings.modelImprovement));
    } catch { }
  }
}

function settingsField(label, name, value, type = "text", autocomplete = "off", placeholder = "") {
  const wrapper = element("label", "settings-field");
  const input = element("input", "settings-input");
  input.name = name;
  input.type = type;
  input.value = value || "";
  input.autocomplete = autocomplete;
  if (placeholder) input.placeholder = placeholder;
  input.setAttribute("aria-label", label);
  wrapper.append(element("span", "settings-field-label", label), input);
  return wrapper;
}

function settingsMessage(form, message, tone = "error") {
  let node = form.querySelector(".settings-form-message");
  if (!node) {
    node = element("p", "settings-form-message");
    form.prepend(node);
  }
  node.className = `settings-form-message is-${tone}`;
  node.textContent = message;
}

function buildLanguageSelectorSection() {
  const currentLang = getLanguage();
  const isEn = currentLang === "en";
  const row = element("div", "settings-lang-row");

  const info = element("div", "settings-lang-info");
  const label = element("span", "settings-lang-label", t("settings.languageSelector.title") || (isEn ? "Interface Language" : "İnterfeys dili"));
  const hint = element("span", "settings-lang-hint", t("settings.languageSelector.intro") || (isEn ? "Choose your preferred language for Helmer." : "Helmer üçün istifadə etmək istədiyiniz dili seçin."));
  info.append(label, hint);

  const dropdown = element("details", "settings-lang-dropdown");
  const trigger = element("summary", "settings-lang-trigger");
  trigger.setAttribute("aria-haspopup", "listbox");
  trigger.setAttribute("aria-label", isEn ? "Select interface language" : "İnterfeys dilini seçin");

  const currLabel = currentLang === "en" ? "English" : "Azərbaycan dili";

  trigger.innerHTML = `
    <span class="settings-lang-curr-name">${escapeHtml(currLabel)}</span>
    <svg class="settings-lang-chevron" viewBox="0 0 20 20" width="14" height="14" fill="currentColor" aria-hidden="true">
      <path fill-rule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clip-rule="evenodd" />
    </svg>
  `;

  const menu = element("div", "settings-lang-menu");
  menu.setAttribute("role", "listbox");

  const languages = [
    { code: "az", name: "Azərbaycan dili" },
    { code: "en", name: "English" },
  ];

  languages.forEach((item) => {
    const isSelected = currentLang === item.code;
    const opt = button("", `settings-lang-option${isSelected ? " is-selected" : ""}`, async () => {
      dropdown.removeAttribute("open");
      if (getLanguage() === item.code) return;
      setLanguage(item.code, true);
      if (state.currentUser) {
        try {
          await authRequest("/api/auth/settings", { method: "PATCH", body: JSON.stringify({ language: item.code }) });
        } catch { }
      }
      showToast(t("settings.languageSelector.toastChanged", {}, item.code) || (item.code === "en" ? "Interface language updated." : "İnterfeys dili dəyişdirildi."), "success");
    });
    opt.type = "button";
    opt.setAttribute("role", "option");
    opt.setAttribute("aria-selected", String(isSelected));
    opt.innerHTML = `
      <span class="settings-lang-opt-name">${escapeHtml(item.name)}</span>
      ${isSelected ? `<svg class="settings-lang-check" viewBox="0 0 20 20" width="15" height="15" fill="currentColor" aria-hidden="true">
        <path fill-rule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clip-rule="evenodd" />
      </svg>` : ""}
    `;
    menu.appendChild(opt);
  });

  dropdown.append(trigger, menu);

  const handleDropdownClose = (evt) => {
    if (dropdown.hasAttribute("open") && !dropdown.contains(evt.target)) {
      dropdown.removeAttribute("open");
    }
  };
  document.addEventListener("click", handleDropdownClose);

  row.append(info, dropdown);
  return row;
}

function getSupportGreeting() {
  const name = getUserFirstName();
  if (name) {
    return t("supportBubble.greeting", { name });
  }
  return t("supportBubble.greetingGuest");
}

function buildSupportChatBubble() {
  const isEn = getLanguage() === "en";
  const widget = element("div", "support-chat-widget");

  const tooltip = element("div", "support-chat-tooltip");
  tooltip.setAttribute("role", "tooltip");

  const tooltipText = element("span", "support-chat-tooltip-text");
  tooltipText.textContent = getSupportGreeting();
  tooltip.appendChild(tooltipText);

  const popover = element("div", "support-chat-popover");
  popover.setAttribute("role", "dialog");
  popover.setAttribute("aria-label", t("supportBubble.popoverTitle") || (isEn ? "Help & Support" : "Kömək və Dəstək"));
  popover.hidden = true;

  const popoverHeader = element("div", "support-popover-header");
  const titleWrap = element("div", "support-popover-title-wrap");
  titleWrap.append(
    element("strong", "support-popover-title", t("supportBubble.popoverTitle") || (isEn ? "Help & Support" : "Kömək və Dəstək")),
    element("p", "support-popover-subtitle", t("supportBubble.popoverSubtitle") || (isEn ? "Get in touch with us for questions or feedback." : "Suallarınız və ya təklifləriniz üçün bizə yazın."))
  );

  const closeBtn = button("", "support-popover-close", (e) => {
    e.stopPropagation();
    closePopover();
  });
  closeBtn.type = "button";
  closeBtn.setAttribute("aria-label", t("supportBubble.close") || (isEn ? "Close" : "Bağla"));
  closeBtn.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;

  popoverHeader.append(titleWrap, closeBtn);

  const emailLink = element("a", "support-email-option");
  emailLink.href = "mailto:support@helmeros.com";
  emailLink.innerHTML = `
    <div class="support-email-icon-wrap" aria-hidden="true">
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect width="20" height="16" x="2" y="4" rx="2"/>
        <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>
      </svg>
    </div>
    <div class="support-email-text-wrap">
      <span class="support-email-label">${escapeHtml(t("supportBubble.emailOptionLabel") || (isEn ? "Send an email" : "E-poçt vasitəsilə yazın"))}</span>
      <span class="support-email-address">support@helmeros.com</span>
    </div>
    <div class="support-email-arrow" aria-hidden="true">
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="9 18 15 12 9 6"/>
      </svg>
    </div>
  `;

  const copyBtn = button(t("supportBubble.copyEmail") || (isEn ? "Copy email" : "Ünvanı kopyala"), "support-copy-email-btn", async (e) => {
    e.stopPropagation();
    e.preventDefault();
    try {
      await navigator.clipboard.writeText("support@helmeros.com");
      copyBtn.textContent = t("supportBubble.copied") || (isEn ? "Copied!" : "Kopyalandı!");
      setTimeout(() => {
        copyBtn.textContent = t("supportBubble.copyEmail") || (isEn ? "Copy email" : "Ünvanı kopyala");
      }, 2000);
    } catch { }
  });
  copyBtn.type = "button";

  const optionsList = element("div", "support-popover-options");
  optionsList.append(emailLink, copyBtn);

  popover.append(popoverHeader, optionsList);

  const bubble = button("", "support-chat-bubble", (e) => {
    e.stopPropagation();
    togglePopover();
  });
  bubble.type = "button";
  bubble.setAttribute("aria-label", t("supportBubble.ariaLabel") || (isEn ? "Support & Contact" : "Kömək və Dəstək"));
  bubble.setAttribute("aria-expanded", "false");
  bubble.innerHTML = `
    <svg class="support-chat-icon" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>
    </svg>
    <span class="support-chat-status-dot" aria-hidden="true"></span>
  `;

  function openPopover() {
    popover.hidden = false;
    bubble.setAttribute("aria-expanded", "true");
    widget.classList.add("is-popover-open");
  }

  function closePopover() {
    popover.hidden = true;
    bubble.setAttribute("aria-expanded", "false");
    widget.classList.remove("is-popover-open");
  }

  function togglePopover() {
    if (popover.hidden) {
      openPopover();
    } else {
      closePopover();
    }
  }

  const handleOutsideClick = (e) => {
    if (!widget.contains(e.target) && !popover.hidden) {
      closePopover();
    }
  };
  document.addEventListener("click", handleOutsideClick);

  const handleKeyDown = (e) => {
    if (e.key === "Escape" && !popover.hidden) {
      closePopover();
    }
  };
  document.addEventListener("keydown", handleKeyDown);

  widget.append(tooltip, popover, bubble);
  return widget;
}

function renderSettings() {
  const isEn = getLanguage() === "en";
  workspace.classList.add("workspace-settings");
  workspace.replaceChildren();
  const view = element("section", "settings-view");

  const topNav = element("div", "settings-top-nav");
  const backBtn = button("", "settings-back-btn", () => {
    state.view = state.previousView || "home";
    syncNav();
    render();
  });
  backBtn.type = "button";
  backBtn.id = "settingsBackBtn";
  backBtn.setAttribute("aria-label", t("common.back") || (isEn ? "Back" : "Geri"));
  backBtn.title = t("common.back") || (isEn ? "Back" : "Geri");
  backBtn.innerHTML = `
    <svg class="settings-back-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M19 12H5M12 19l-7-7 7-7"/>
    </svg>
    <span class="settings-back-label">${escapeHtml(t("common.back") || (isEn ? "Back" : "Geri"))}</span>
  `;
  topNav.appendChild(backBtn);
  view.appendChild(topNav);

  const header = element("header", "settings-header");
  header.append(
    element("span", "section-kicker settings-kicker", isEn ? "SETTINGS" : "PARAMETRLƏR"),
    element("h1", "", isEn ? "Settings" : "Parametrlər"),
    element("p", "", state.currentUser
      ? (isEn ? "Manage your account preferences, intelligence, and security." : "Hesab məlumatlarını, fərdiləşdirilmiş təcrübəni və giriş təhlükəsizliyini idarə edin.")
      : (isEn ? "Configure workspace preferences, interface language, and cloud synchronization." : "İş mühiti parametrlərini, interfeys dilini və bulud sinxronizasiyasını tənzimləyin."))
  );

  if (!state.settingsTab) state.settingsTab = "account";

  const tabs = element("div", "settings-tabs");
  tabs.setAttribute("role", "tablist");
  tabs.setAttribute("aria-label", isEn ? "Settings navigation" : "Parametrlər menyusu");

  const tabDefs = [
    {
      id: "account",
      label: t("settings.tabs.account"),
      icon: `<svg class="settings-tab-icon" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`,
    },
    {
      id: "experience",
      label: t("settings.tabs.experience"),
      icon: `<svg class="settings-tab-icon" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3L12 3z"/></svg>`,
    },
    {
      id: "security",
      label: t("settings.tabs.security"),
      icon: `<svg class="settings-tab-icon" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`,
    },
    {
      id: "legal",
      label: t("settings.tabs.legal"),
      icon: `<svg class="settings-tab-icon" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>`,
    },
  ];

  tabDefs.forEach((tabItem) => {
    const tabBtn = button("", `settings-tab${state.settingsTab === tabItem.id ? " is-active" : ""}`, () => {
      state.settingsTab = tabItem.id;
      renderSettings();
    });
    tabBtn.type = "button";
    tabBtn.setAttribute("role", "tab");
    tabBtn.setAttribute("aria-selected", String(state.settingsTab === tabItem.id));
    tabBtn.innerHTML = `${tabItem.icon}<span>${escapeHtml(tabItem.label)}</span>`;
    tabs.appendChild(tabBtn);
  });

  function createExperienceAccordion({ title, desc, badgeNode = null, isOpen = false, contentNode }) {
    const details = document.createElement("details");
    details.className = "experience-accordion";
    if (isOpen) details.open = true;

    const summary = element("summary", "experience-accordion-summary");
    const summaryLeft = element("div", "experience-accordion-left");
    const titleRow = element("div", "experience-accordion-title-row");
    titleRow.appendChild(element("strong", "experience-accordion-title", title));
    if (badgeNode) titleRow.appendChild(badgeNode);
    summaryLeft.appendChild(titleRow);
    if (desc) summaryLeft.appendChild(element("p", "experience-accordion-desc", desc));

    const iconWrap = element("span", "experience-accordion-icon");
    iconWrap.innerHTML = '<svg class="experience-chevron" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';

    summary.append(summaryLeft, iconWrap);
    const body = element("div", "experience-accordion-content");
    body.appendChild(contentNode);
    details.append(summary, body);
    return details;
  }

  function createExperienceCategorySection({ title, desc, iconSvg, contentNodes = [] }) {
    const section = element("div", "experience-category-section");
    const header = element("div", "experience-category-header");

    if (iconSvg) {
      const iconWrap = element("span", "experience-category-icon");
      iconWrap.setAttribute("aria-hidden", "true");
      iconWrap.innerHTML = iconSvg;
      header.appendChild(iconWrap);
    }

    const textWrap = element("div", "experience-category-text");
    textWrap.appendChild(element("h3", "experience-category-title", title));
    if (desc) {
      textWrap.appendChild(element("p", "experience-category-desc", desc));
    }
    header.appendChild(textWrap);

    const cardsContainer = element("div", "experience-category-cards");
    contentNodes.filter(Boolean).forEach((node) => cardsContainer.appendChild(node));

    section.append(header, cardsContainer);
    return { section, cardsContainer };
  }

  let panel;
  if (state.settingsTab === "account") {
    panel = element("section", "settings-panel settings-account-panel");
    panel.append(
      element("h2", "", state.currentUser ? t("settings.account.title") : (isEn ? "Account & Workspace" : "Hesab və İş Mühiti")),
      element("p", "settings-panel-intro", state.currentUser ? t("settings.account.intro") : (isEn ? "Manage your profile, workspace preferences, and device synchronization." : "Profilinizi, iş mühiti parametrlərini və cihazlararası sinxronizasiyanı idarə edin."))
    );

    // Profile Identity Card with collapsible details via arrow on the right
    const avatarInitial = state.currentUser ? (state.currentUser.fullName || state.currentUser.username || "U")[0].toUpperCase() : "G";
    const userName = state.currentUser ? (state.currentUser.fullName || state.currentUser.username) : (isEn ? "Guest Workspace" : "Qonaq İş Mühiti");
    const userRole = state.currentUser ? state.currentUser.email : (isEn ? "Local browser sandbox · Device isolated" : "Lokal brauzer mühiti · Bu cihaza bağlı");

    const profileCard = document.createElement("details");
    profileCard.className = "account-profile-card experience-accordion";
    profileCard.open = true;

    const profileSummary = element("summary", "account-profile-summary");
    profileSummary.innerHTML = `
      <div class="account-profile-avatar" aria-hidden="true">${escapeHtml(avatarInitial)}</div>
      <div class="account-profile-details">
        <div class="account-profile-title-row">
          <strong class="account-profile-name">${escapeHtml(userName)}</strong>
          <span class="account-badge ${state.currentUser ? "is-verified" : "is-guest"}">${state.currentUser ? (isEn ? "✓ Synced" : "✓ Bulud Hesabı") : (isEn ? "○ Guest" : "○ Qonaq")}</span>
        </div>
        <p class="account-profile-role">${escapeHtml(userRole)}</p>
      </div>
      <span class="experience-accordion-icon" aria-hidden="true">
        <svg class="experience-chevron" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </span>
    `;

    const profileBody = element("div", "account-profile-body experience-accordion-content");

    if (state.currentUser) {
      const form = element("form", "settings-form account-settings-form");
      form.append(
        settingsField(t("settings.account.fullName"), "fullName", state.currentUser.fullName, "text", "name"),
        settingsField(t("settings.account.username"), "username", state.currentUser.username, "text", "username"),
        settingsField(t("settings.account.email"), "email", state.currentUser.email, "email", "email"),
      );
      const save = button(t("settings.account.saveBtn"), "primary-button");
      save.type = "submit";
      form.appendChild(save);
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        save.disabled = true;
        save.textContent = isEn ? "Saving…" : "Saxlanılır…";
        try {
          const payload = Object.fromEntries(new FormData(form));
          const emailChanged = String(payload.email || "").trim().toLowerCase() !== String(state.currentUser?.email || "").trim().toLowerCase();
          if (emailChanged && window.helmerSecurity?.reauthenticate) {
            const proof = await window.helmerSecurity.reauthenticate();
            Object.assign(payload, proof);
          }
          const data = await authRequest("/api/auth/account", {
            method: "PATCH",
            body: JSON.stringify(payload),
          });
          updateWorkspaceIdentity(data.user);
          if (data.user?.pendingEmail) {
            settingsMessage(
              form,
              isEn
                ? `Verification code sent to ${data.user.pendingEmail}. Confirm below to complete the email change.`
                : `${data.user.pendingEmail} ünvanına təsdiq kodu göndərildi. Dəyişikliyi tamamlamaq üçün kodu aşağıda daxil edin.`,
              "success"
            );
            renderSettings();
            return;
          }
          settingsMessage(form, isEn ? "Account information updated." : "Hesab məlumatları yeniləndi.", "success");
        } catch (error) {
          settingsMessage(form, error.message);
        } finally {
          save.disabled = false;
          save.textContent = t("settings.account.saveBtn");
        }
      });
      profileBody.appendChild(form);

      if (state.currentUser.pendingEmail) {
        const pendingBox = element("div", "pending-email-verification-box");
        pendingBox.style.cssText = "margin-top:16px;padding:14px 16px;border-radius:12px;border:1px solid var(--border-subtle,#e2e8f0);background:var(--bg-subtle,rgba(79,110,232,0.06));";
        const pendingTitle = element(
          "strong",
          "",
          isEn
            ? `Verify new email: ${state.currentUser.pendingEmail}`
            : `Yeni e-poçtu təsdiqlə: ${state.currentUser.pendingEmail}`
        );
        const pendingHint = element(
          "p",
          "",
          isEn
            ? "Enter the 6-digit verification code sent to your new email address."
            : "Yeni e-poçt ünvanınıza göndərilən 6 rəqəmli təsdiq kodunu daxil edin."
        );
        pendingHint.style.cssText = "margin:4px 0 10px;font-size:13px;color:var(--text-secondary,#64748b);";
        const verifyForm = element("form", "settings-form pending-email-verify-form");
        const codeField = settingsField(isEn ? "6-Digit Code" : "6 rəqəmli kod", "code", "", "text", "one-time-code");
        const codeInput = codeField.querySelector("input");
        if (codeInput) {
          codeInput.maxLength = 6;
          codeInput.inputMode = "numeric";
          codeInput.pattern = "[0-9]{6}";
          codeInput.placeholder = "123456";
        }
        const actionsRow = element("div", "pending-email-actions");
        actionsRow.style.cssText = "display:flex;gap:10px;align-items:center;margin-top:8px;";
        const confirmBtn = button(isEn ? "Confirm Email" : "E-poçtu təsdiqlə", "primary-button");
        confirmBtn.type = "submit";
        const resendBtn = button(isEn ? "Resend code" : "Kodu yenidən göndər", "secondary-button", async () => {
          resendBtn.disabled = true;
          try {
            await authRequest("/api/auth/email-verification/resend", {
              method: "POST",
              body: JSON.stringify({ email: state.currentUser.pendingEmail }),
            });
            settingsMessage(verifyForm, isEn ? "Verification code resent." : "Təsdiq kodu yenidən göndərildi.", "success");
          } catch (err) {
            settingsMessage(verifyForm, err.message);
          } finally {
            resendBtn.disabled = false;
          }
        });
        resendBtn.type = "button";
        actionsRow.append(confirmBtn, resendBtn);
        verifyForm.append(codeField, actionsRow);
        verifyForm.addEventListener("submit", async (e) => {
          e.preventDefault();
          confirmBtn.disabled = true;
          try {
            const res = await authRequest("/api/auth/email-verification/confirm", {
              method: "POST",
              body: JSON.stringify({
                email: state.currentUser.pendingEmail,
                code: String(verifyForm.code?.value || "").trim(),
              }),
            });
            updateWorkspaceIdentity(res.user);
            showToast(isEn ? "Email address updated and verified." : "E-poçt ünvanı təsdiqləndi və yeniləndi.", "success");
            renderSettings();
          } catch (err) {
            settingsMessage(verifyForm, err.message);
            confirmBtn.disabled = false;
          }
        });
        pendingBox.append(pendingTitle, pendingHint, verifyForm);
        profileBody.appendChild(pendingBox);
      }
    } else {
      const guestCard = element("div", "guest-sync-banner");
      const guestLeft = element("div", "guest-sync-left");
      guestLeft.innerHTML = `
        <div class="guest-sync-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M19 18a3.5 3.5 0 0 0 0-7h-1A5 5 0 0 0 8 8a3.5 3.5 0 0 0-1 6.8V18"/>
            <polyline points="13 14 16 11 19 14"/>
            <line x1="16" y1="11" x2="16" y2="21"/>
          </svg>
        </div>
        <div class="guest-sync-text">
          <h3>${escapeHtml(isEn ? "Cloud Strategy Vault & Device Sync" : "Bulud Strategiya Arxivi və Sinxronizasiya")}</h3>
          <p>${escapeHtml(isEn ? "Your campaigns, personas, and custom instructions are saved in this browser. Create a free account to back them up securely and access your work anywhere." : "Hazırladığınız marketinq strategiyaları, brend təlimatları və qeydləriniz bu brauzerdə saxlanılır. Keçmişinizi itirməmək və istənilən cihazdan daxil olmaq üçün pulsuz hesab açın.")}</p>
        </div>
      `;
      const guestActions = element("div", "guest-sync-actions");
      guestActions.append(
        button(isEn ? "Create account" : "Hesab yarat", "primary-button", () => { window.location.href = "/signup?returnTo=/workspace"; }),
        button(isEn ? "Log in" : "Daxil ol", "secondary-button", () => { window.location.href = "/login?returnTo=/workspace"; })
      );
      guestCard.append(guestLeft, guestActions);
      profileBody.appendChild(guestCard);
    }

    profileCard.append(profileSummary, profileBody);
    panel.appendChild(profileCard);

    // Language Selector Card
    panel.appendChild(buildLanguageSelectorSection());

    view.appendChild(panel);

  } else if (state.settingsTab === "experience") {
    panel = element("section", "settings-panel settings-experience-panel");
    panel.append(
      element("h2", "", t("settings.experience.title")),
      element("p", "settings-panel-intro", t("settings.experience.intro")),
    );

    const userSettings = state.currentUser?.settings || {};
    let currentTone = userSettings.tone || "professional";
    let memoriesList = Array.isArray(userSettings.memories) ? [...userSettings.memories] : [];

    // Personalization categories container (collapses when deactivated)
    const personalizationContainer = element("div", "experience-personalization-group");

    // Master AI Intelligence Switch Card
    const masterCard = element("div", "experience-hero-toggle");
    const masterLeft = element("div", "experience-hero-left");
    masterLeft.append(
      element("strong", "", t("settings.experience.masterTitle")),
      element("p", "", t("settings.experience.masterDesc")),
    );
    const masterToggle = element("button", "settings-toggle");
    masterToggle.type = "button";
    masterToggle.setAttribute("role", "switch");
    masterToggle.setAttribute("aria-label", t("settings.experience.masterTitle"));
    let isMasterEnabled = state.currentUser ? userSettings.personalIntelligence === true : true;
    const syncMasterToggle = () => {
      masterToggle.classList.toggle("is-active", isMasterEnabled);
      masterToggle.setAttribute("aria-checked", String(isMasterEnabled));
      if (personalizationContainer) {
        personalizationContainer.classList.toggle("is-collapsed", !isMasterEnabled);
        personalizationContainer.style.display = isMasterEnabled ? "" : "none";
        if (!isMasterEnabled) {
          personalizationContainer.querySelectorAll("details.experience-accordion").forEach((d) => {
            d.open = false;
          });
        }
      }
    };
    masterToggle.appendChild(element("span", "settings-toggle-thumb"));
    syncMasterToggle();
    masterToggle.addEventListener("click", () => {
      if (isMasterEnabled) {
        isMasterEnabled = false;
        syncMasterToggle();
        return;
      }
      openPersonalizationConsentModal(() => {
        isMasterEnabled = true;
        syncMasterToggle();
      });
    });
    masterCard.append(masterLeft, masterToggle);

    // Default Mode Selector (Both Authenticated & Guest - Collapsible, Open by default)
    let currentDefaultMode = userSettings.defaultMode || getCookie("helmer_default_mode") || state.mode || "build";
    const modeBadge = element("span", "experience-summary-badge", currentDefaultMode === "ask" ? "Ask Mode" : "Build Mode");

    const modeGrid = element("div", "experience-mode-options experience-tone-grid experience-mode-grid");
    modeGrid.style.marginTop = "6px";

    const defaultModeOptions = [
      {
        id: "build",
        icon: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>',
        name: "Build Mode",
        desc: isEn ? "Start directly in structured multi-channel strategy generation mode on launch." : "Helmer açıldıqda birbaşa strukturlaşdırılmış marketinq strategiyası rejimi aktiv olsun.",
      },
      {
        id: "ask",
        icon: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
        name: "Ask Mode",
        desc: isEn ? "Start directly in conversational AI sparring and ad-hoc strategic Q&A mode on launch." : "Helmer açıldıqda birbaşa interaktiv AI söhbət və operativ sual-cavab rejimi aktiv olsun.",
      },
    ];

    defaultModeOptions.forEach((opt) => {
      const card = element("button", `experience-mode-option experience-tone-card experience-mode-card${currentDefaultMode === opt.id ? " is-selected" : ""}`);
      card.type = "button";
      card.innerHTML = `
        <div class="tone-card-top">
          <span class="tone-card-icon-wrap">${opt.icon}</span>
          <strong class="tone-card-title">${escapeHtml(opt.name)}</strong>
          <span class="tone-card-check"></span>
        </div>
        <p class="tone-card-desc">${escapeHtml(opt.desc)}</p>
      `;
      card.addEventListener("click", () => {
        currentDefaultMode = opt.id;
        setDefaultWorkspaceMode(currentDefaultMode);
        modeBadge.textContent = opt.name;
        modeGrid.querySelectorAll(".experience-mode-card").forEach((c) => c.classList.remove("is-selected"));
        card.classList.add("is-selected");
        showToast(isEn ? `Default mode set to ${opt.name}.` : `İlkin rejim ${opt.name} olaraq təyin edildi.`);
      });
      modeGrid.appendChild(card);
    });

    const modeAccordion = createExperienceAccordion({
      title: isEn ? "Default Workspace Mode" : "İlkin İş Rejimi",
      desc: isEn ? "Choose your default launch workspace when opening Helmer." : "Helmer açıldıqda hansı rejimdə başlamaq istədiyinizi seçin.",
      badgeNode: modeBadge,
      isOpen: true,
      contentNode: modeGrid,
    });

    // Strategy Auto-Save Studio (Build Mode - Collapsible, Open by default)
    let isAutoSave = isAutoSaveStrategiesEnabled();
    const autoSaveBadge = element(
      "span",
      "experience-summary-badge",
      isAutoSave
        ? (t("settings.experience.autoSaveActive") || (isEn ? "Active" : "Aktiv"))
        : (t("settings.experience.autoSaveInactive") || (isEn ? "Inactive" : "Deaktiv"))
    );

    const autoSaveCard = element("div", "settings-toggle-row");
    const autoSaveCopy = element("div", "settings-toggle-copy");
    autoSaveCopy.append(
      element("strong", "", t("settings.experience.autoSaveToggleTitle") || (isEn ? "Auto-Save to Archive" : "Arxivə Avtomatik Saxlama")),
      element("p", "", t("settings.experience.autoSaveToggleDesc") || (isEn ? "Automatically preserve newly generated strategies in your workspace archive upon completion." : "Build rejimində generasiya edilən hər yeni strategiya tamamlandıqda birbaşa arxivə əlavə edilsin."))
    );
    const autoSaveToggle = element("button", "settings-toggle");
    autoSaveToggle.type = "button";
    autoSaveToggle.setAttribute("role", "switch");
    autoSaveToggle.setAttribute("aria-label", t("settings.experience.autoSaveTitle") || (isEn ? "Strategy Auto-Save (Build Mode)" : "Strategiyaların Avtomatik Saxlanılması (Build)"));

    let syncScopesAutoSave = null;
    const syncAutoSaveToggle = () => {
      autoSaveToggle.classList.toggle("is-active", isAutoSave);
      autoSaveToggle.setAttribute("aria-checked", String(isAutoSave));
      autoSaveBadge.textContent = isAutoSave
        ? (t("settings.experience.autoSaveActive") || (isEn ? "Active" : "Aktiv"))
        : (t("settings.experience.autoSaveInactive") || (isEn ? "Inactive" : "Deaktiv"))
      if (typeof syncScopesAutoSave === "function") {
        syncScopesAutoSave(isAutoSave);
      }
    };
    autoSaveToggle.appendChild(element("span", "settings-toggle-thumb"));
    syncAutoSaveToggle();

    autoSaveToggle.addEventListener("click", () => {
      isAutoSave = !isAutoSave;
      syncAutoSaveToggle();
      setAutoSaveStrategies(isAutoSave);
      showToast(
        isAutoSave
          ? (t("settings.experience.autoSaveToastActive") || (isEn ? "Strategy auto-save enabled." : "Build rejimində avtomatik arxivləmə aktiv edildi."))
          : (t("settings.experience.autoSaveToastInactive") || (isEn ? "Strategy auto-save disabled." : "Build rejimində avtomatik arxivləmə deaktiv edildi."))
      );
    });
    autoSaveCard.append(autoSaveCopy, autoSaveToggle);

    const autoSaveAccordion = createExperienceAccordion({
      title: t("settings.experience.autoSaveTitle") || (isEn ? "Strategy Auto-Save (Build Mode)" : "Strategiyaların Avtomatik Saxlanılması (Build)"),
      desc: t("settings.experience.autoSaveDesc") || (isEn ? "Configure whether strategies created in Build mode are automatically saved to your archive." : "Build rejimində hazırlanan strategiyaların avtomatik olaraq arxivə köçürülməsini tənzimləyin."),
      badgeNode: autoSaveBadge,
      isOpen: true,
      contentNode: autoSaveCard,
    });

    // Planner Notifications Accordion in Settings Experience
    let isPlannerNotif = isPlannerNotificationsEnabled();
    const plannerNotifBadge = element(
      "span",
      "experience-summary-badge",
      isPlannerNotif
        ? (t("settings.experience.autoSaveActive") || (isEn ? "Active" : "Aktiv"))
        : (t("settings.experience.autoSaveInactive") || (isEn ? "Inactive" : "Deaktiv"))
    );

    const plannerNotifCard = element("div", "settings-toggle-row");
    const plannerNotifCopy = element("div", "settings-toggle-copy");
    plannerNotifCopy.append(
      element("strong", "", t("settings.experience.plannerNotifToggleTitle") || (isEn ? "Priority Task Notifications" : "Prioritet Tapşırıq Bildirişləri")),
      element("p", "", t("settings.experience.plannerNotifToggleDesc") || (isEn ? "Display reminders about pending priority tasks each time you open the workspace." : "Sayta hər dəfə daxil olduqda icra gözləyən prioritet tapşırıqlar barədə bildiriş göstərilsin."))
    );
    const plannerNotifToggle = element("button", "settings-toggle");
    plannerNotifToggle.type = "button";
    plannerNotifToggle.setAttribute("role", "switch");
    plannerNotifToggle.setAttribute("aria-label", t("settings.experience.plannerNotifTitle") || (isEn ? "Planner Priority Reminders" : "Planlaşdırılanlar Xatırlatmaları"));

    const syncPlannerNotifToggle = () => {
      plannerNotifToggle.classList.toggle("is-active", isPlannerNotif);
      plannerNotifToggle.setAttribute("aria-checked", String(isPlannerNotif));
      plannerNotifBadge.textContent = isPlannerNotif
        ? (t("settings.experience.autoSaveActive") || (isEn ? "Active" : "Aktiv"))
        : (t("settings.experience.autoSaveInactive") || (isEn ? "Inactive" : "Deaktiv"));
    };
    plannerNotifToggle.appendChild(element("span", "settings-toggle-thumb"));
    syncPlannerNotifToggle();

    plannerNotifToggle.addEventListener("click", async () => {
      isPlannerNotif = !isPlannerNotif;
      syncPlannerNotifToggle();
      await setPlannerNotificationsEnabled(isPlannerNotif);
    });
    plannerNotifCard.append(plannerNotifCopy, plannerNotifToggle);

    const plannerNotifAccordion = createExperienceAccordion({
      title: t("settings.experience.plannerNotifTitle") || (isEn ? "Planner Priority Reminders" : "Planlaşdırılanlar Xatırlatmaları"),
      desc: t("settings.experience.plannerNotifDesc") || (isEn ? "Receive reminders about pending priority and urgent tasks when opening the workspace." : "İş mühitinə daxil olduqda icra gözləyən prioritet və təcili tapşırıqlar barədə xatırlatma al."),
      badgeNode: plannerNotifBadge,
      isOpen: true,
      contentNode: plannerNotifCard,
    });

    // Visual Theme Picker Studio (Both Authenticated & Guest - Collapsible, Closed by default)
    const currentTheme = document.documentElement.dataset.theme === "dark" ? "dark" : "light";
    const themeBadge = element("span", "experience-summary-badge", currentTheme === "dark" ? (isEn ? "Dark Mode" : "Qaranlıq Rejim") : (isEn ? "Light Mode" : "Açıq Rejim"));

    const themeCardsGrid = element("div", "theme-cards-grid");
    themeCardsGrid.innerHTML = `
      <button type="button" class="theme-preview-card${currentTheme === "light" ? " is-active" : ""}" data-theme-choice="light">
        <div class="theme-preview-canvas is-light" aria-hidden="true">
          <div class="preview-mock-rail"></div>
          <div class="preview-mock-body">
            <div class="preview-mock-line"></div>
            <div class="preview-mock-box"></div>
          </div>
        </div>
        <div class="theme-card-caption">
          <div class="theme-card-dot is-light"></div>
          <strong>${escapeHtml(isEn ? "Light Mode" : "Açıq Rejim")}</strong>
          <span class="theme-card-radio"></span>
        </div>
      </button>
      <button type="button" class="theme-preview-card${currentTheme === "dark" ? " is-active" : ""}" data-theme-choice="dark">
        <div class="theme-preview-canvas is-dark" aria-hidden="true">
          <div class="preview-mock-rail"></div>
          <div class="preview-mock-body">
            <div class="preview-mock-line"></div>
            <div class="preview-mock-box"></div>
          </div>
        </div>
        <div class="theme-card-caption">
          <div class="theme-card-dot is-dark"></div>
          <strong>${escapeHtml(isEn ? "Dark Mode" : "Qaranlıq Rejim")}</strong>
          <span class="theme-card-radio"></span>
        </div>
      </button>
    `;
    themeCardsGrid.querySelectorAll(".theme-preview-card").forEach((card) => {
      card.addEventListener("click", () => {
        const choice = card.dataset.themeChoice;
        const root = document.documentElement;
        root.dataset.theme = choice;
        if (choice === "dark") root.classList.add("dark");
        else root.classList.remove("dark");
        try { localStorage.setItem("theme", choice); } catch { }
        themeCardsGrid.querySelectorAll(".theme-preview-card").forEach((c) => {
          c.classList.toggle("is-active", c.dataset.themeChoice === choice);
        });
        themeBadge.textContent = choice === "dark" ? (isEn ? "Dark Mode" : "Qaranlıq Rejim") : (isEn ? "Light Mode" : "Açıq Rejim");
        showToast(isEn ? `Theme set to ${choice === "dark" ? "Dark Mode" : "Light Mode"}.` : `Mövzu ${choice === "dark" ? "Qaranlıq" : "Açıq"} olaraq təyin edildi.`);
      });
    });

    const themeAccordion = createExperienceAccordion({
      title: isEn ? "Appearance & Surface Tone" : "Vizual Görünüş və Mövzu",
      desc: isEn ? "Choose your workspace surface tone. Helmer adapts to high-contrast daylight or pure black obsidian." : "İş mühitinin rəng rejimini tənzimləyin. Helmer yüksək kontrastlı işıqlı və təmiz obsidian qaranlıq rejimi dəstəkləyir.",
      badgeNode: themeBadge,
      isOpen: false,
      contentNode: themeCardsGrid,
    });
    themeAccordion.classList.add("settings-theme-studio");

    // Tone Studio Accordion (Collapsed by default)
    const toneGrid = element("div", "experience-tone-grid");
    toneGrid.style.marginTop = "6px";
    const toneOptions = [
      {
        id: "professional",
        name: isEn ? "Strategic & Analytical" : "Strateji və Analitik",
        desc: isEn ? "Data-backed market positioning, unit economics, and ROI-driven action plans." : "Məlumatlara əsaslanan mövqeləndirmə, vahid iqtisadiyyatı və ROI hədəfli planlar.",
        icon: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>',
      },
      {
        id: "direct",
        name: isEn ? "Bold & High-Converting" : "Cəsarətli və Satış Yönümlü",
        desc: isEn ? "Punchy direct-response hooks, bold headlines, and uncompromising CTA triggers." : "Dəqiq çağırışlar, güclü başlıqlar və yüksək konversiyalı marketinq mətni.",
        icon: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>',
      },
      {
        id: "creative",
        name: isEn ? "Storyteller & Creative" : "Yaradıcı və Hekayəçi",
        desc: isEn ? "Narrative-driven voice, emotional brand resonance, and lifestyle storytelling." : "Hekayə əsaslı brend dili, emosional bağ və cəlbedici brend hekayəsi.",
        icon: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/></svg>',
      },
      {
        id: "executive",
        name: isEn ? "Executive & Concise" : "İcraçı və Qısa",
        desc: isEn ? "High-level bulleted summaries, action-item delegation, and zero marketing jargon." : "Yüksək səviyyəli xülasələr, konkret tapşırıqlar və lüzumsuz sözlərdən azad dil.",
        icon: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="14" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>',
      },
    ];

    const currentToneObj = toneOptions.find((t) => t.id === currentTone)
      || (currentTone === "concise" ? toneOptions.find((t) => t.id === "executive") : null)
      || (currentTone === "data_driven" ? toneOptions.find((t) => t.id === "direct") : null)
      || (currentTone === "friendly" ? toneOptions.find((t) => t.id === "creative") : null)
      || toneOptions[0];
    currentTone = currentToneObj.id;
    const toneBadge = element("span", "experience-summary-badge", currentToneObj.name);

    toneOptions.forEach((opt) => {
      const card = element("button", `experience-tone-card${currentTone === opt.id ? " is-selected" : ""}`);
      card.type = "button";
      card.innerHTML = `
        <div class="tone-card-top">
          <span class="tone-card-icon-wrap">${opt.icon}</span>
          <strong class="tone-card-title">${escapeHtml(opt.name)}</strong>
          <span class="tone-card-check"></span>
        </div>
        <p class="tone-card-desc">${escapeHtml(opt.desc)}</p>
      `;
      card.addEventListener("click", () => {
        currentTone = opt.id;
        toneBadge.textContent = opt.name;
        toneGrid.querySelectorAll(".experience-tone-card").forEach((c) => c.classList.remove("is-selected"));
        card.classList.add("is-selected");
      });
      toneGrid.appendChild(card);
    });

    const toneAccordion = createExperienceAccordion({
      title: isEn ? "Brand Voice & Analytical Tone" : "Brend Səsi və Analitik Ton",
      desc: isEn ? "Configure the communication style and directness of Helmer's outputs." : "Helmer-in çıxardığı nəticələrin üslubunu və tonunu müəyyən edin.",
      badgeNode: toneBadge,
      isOpen: false,
      contentNode: toneGrid,
    });

    const aiCategory = createExperienceCategorySection({
      title: t("settings.experience.categories.ai.title") || (isEn ? "AI Intelligence & Memory" : "AI İntellekti və Yaddaş"),
      desc: t("settings.experience.categories.ai.desc") || (isEn ? "Tailored AI responses, strategy auto-save, and persistent strategic memories." : "Fərdiləşdirilmiş AI cavabları, strategiyaların avtomatik saxlanılması və daimi yaddaş qeydləri."),
      iconSvg: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1-1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3L12 3z"/></svg>',
    });

    const brandCategory = createExperienceCategorySection({
      title: t("settings.experience.categories.brand.title") || (isEn ? "Brand & Business Identity" : "Brend və Biznes Kimliyi"),
      desc: t("settings.experience.categories.brand.desc") || (isEn ? "Company facts, target market audience, and analytical response tone." : "Şirkət məlumatları, hədəf kütlə və analitik cavab tonu."),
      iconSvg: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="14" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>',
    });

    const workspaceCategory = createExperienceCategorySection({
      title: t("settings.experience.categories.workspace.title") || (isEn ? "Workspace & Interface" : "İş Mühiti və Görünüş"),
      desc: t("settings.experience.categories.workspace.desc") || (isEn ? "Default launch workspace and surface appearance tone." : "İlkin açılış rejimi və vizual rəng mövzusu."),
      iconSvg: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg>',
    });

    workspaceCategory.cardsContainer.append(modeAccordion, themeAccordion);

    if (state.currentUser) {
      const form = element("form", "settings-form experience-settings-form");

      // Business Profile Accordion (Collapsed by default)
      const profileGrid = element("div", "experience-grid-fields");
      profileGrid.append(
        settingsField(t("settings.experience.brandName"), "brandName", userSettings.brandName || "", "text", "organization", isEn ? "e.g. Helmer" : "Məs: Helmer"),
        settingsField(t("settings.experience.industry"), "industry", userSettings.industry || "", "text", "off", isEn ? "e.g. B2B SaaS, E-commerce" : "Məs: B2B SaaS, E-ticarət, Kosmetika"),
        settingsField(t("settings.experience.primaryMarket"), "primaryMarket", userSettings.primaryMarket || "", "text", "off", isEn ? "e.g. Global, North America, Azerbaijan" : "Məs: Azərbaycan (Bakı və regionlar)"),
        settingsField(t("settings.experience.targetAudience"), "targetAudience", userSettings.targetAudience || "", "text", "off", isEn ? "e.g. Tech founders, Growth marketers" : "Məs: 20-35 yaş gənclər, startaplar"),
      );
      const profileAccordion = createExperienceAccordion({
        title: t("settings.experience.profileTitle"),
        desc: t("settings.experience.profileDesc"),
        isOpen: false,
        contentNode: profileGrid,
      });

      // Memory Hub (Secondary - Collapsible)
      const memoryWrapper = element("div", "experience-memory-wrapper");
      const memoryListContainer = element("div", "experience-memory-list");
      const memoryBadge = element("span", "experience-summary-badge", isEn ? `${memoriesList.length} memories` : `${memoriesList.length} qeyd`);
      const categoryNames = {
        business: isEn ? "Business Fact" : "Biznes faktı",
        audience: isEn ? "Audience" : "Auditoriya",
        preference: isEn ? "Preference" : "Üstünlük",
        constraint: isEn ? "Constraint" : "Məhdudiyyət",
        general: isEn ? "General Note" : "Qeyd",
      };
      const memoryFilters = [
        { id: "all", label: t("common.all") },
        { id: "preference", label: isEn ? "Preferences" : "Üstünlüklər" },
        { id: "constraint", label: isEn ? "Constraints" : "Məhdudiyyətlər" },
        { id: "business", label: isEn ? "Business Facts" : "Biznes faktları" },
      ];
      let activeMemoryFilter = "all";

      const memoryFilterBar = element("div", "experience-memory-filters");
      memoryFilterBar.setAttribute("role", "tablist");
      memoryFilterBar.setAttribute("aria-label", isEn ? "Memory category" : "Yaddaş kateqoriyası");

      const updateMemoryFilterState = () => {
        const counts = memoriesList.reduce((result, memory) => {
          result[memory.category || "general"] = (result[memory.category || "general"] || 0) + 1;
          return result;
        }, {});
        memoryFilterBar.querySelectorAll(".memory-filter-btn").forEach((filterButton) => {
          const filter = filterButton.dataset.filter;
          const count = filter === "all" ? memoriesList.length : (counts[filter] || 0);
          const countNode = filterButton.querySelector(".memory-filter-count");
          if (countNode) countNode.textContent = count;
          const selected = activeMemoryFilter === filter;
          filterButton.classList.toggle("is-active", selected);
          filterButton.setAttribute("aria-selected", String(selected));
        });
      };

      memoryFilters.forEach(({ id, label }) => {
        const filterButton = button("", "memory-filter-btn", () => {
          activeMemoryFilter = id;
          updateMemoryFilterState();
          renderMemories();
        });
        filterButton.dataset.filter = id;
        filterButton.setAttribute("role", "tab");
        filterButton.setAttribute("aria-selected", String(id === "all"));
        filterButton.append(element("span", "memory-filter-label", label), element("span", "memory-filter-count", "0"));
        memoryFilterBar.appendChild(filterButton);
      });

      const renderMemories = () => {
        memoryListContainer.replaceChildren();
        memoryBadge.textContent = isEn ? `${memoriesList.length} memories` : `${memoriesList.length} qeyd`;
        updateMemoryFilterState();
        const visibleMemories = activeMemoryFilter === "all"
          ? memoriesList
          : memoriesList.filter((memory) => memory.category === activeMemoryFilter);
        if (!visibleMemories.length) {
          const emptyText = memoriesList.length
            ? (isEn ? "No memories found in this category." : "Bu kateqoriyada yaddaş qeydi yoxdur.")
            : (isEn ? "No memory entries stored yet." : "Hələ heç bir yaddaş qeydi saxlanılmayıb.");
          const empty = element("p", "experience-memory-empty", emptyText);
          memoryListContainer.appendChild(empty);
          return;
        }
        visibleMemories.forEach((mem) => {
          const item = element("div", "experience-memory-item");
          const catLabel = categoryNames[mem.category] || (isEn ? "Note" : "Qeyd");
          item.innerHTML = `
          <div class="memory-item-content">
            <span class="memory-category-tag tag-${escapeHtml(mem.category || "general")}">${escapeHtml(catLabel)}</span>
            <span class="memory-text">${escapeHtml(mem.text)}</span>
          </div>
        `;
          const delBtn = button("", "memory-delete-btn", () => {
            memoriesList = memoriesList.filter((m) => m.id !== mem.id);
            renderMemories();
          });
          delBtn.type = "button";
          delBtn.setAttribute("aria-label", isEn ? "Delete memory entry" : "Yaddaş qeydini sil");
          delBtn.title = isEn ? "Delete memory" : "Yaddaş qeydini sil";
          delBtn.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16"/><path d="M10 11v6M14 11v6"/><path d="m6 7 1 13h10l1-13"/><path d="M9 7V4h6v3"/></svg>';
          item.appendChild(delBtn);
          memoryListContainer.appendChild(item);
        });
      };
      renderMemories();

      const memoryComposer = element("div", "experience-memory-composer is-collapsed");
      const composerHeading = element("div", "experience-memory-composer-heading");
      const composerHeadingCopy = element("div", "experience-memory-composer-heading-copy");
      composerHeadingCopy.append(
        element("span", "experience-memory-composer-title", isEn ? "New memory entry" : "Yeni yaddaş qeydi"),
        element("span", "experience-memory-composer-hint", isEn ? "Keep it concise and factual for best results" : "Model üçün qısa və konkret saxlayın"),
      );
      const setMemoryComposerOpen = (isOpen) => {
        memoryComposer.classList.toggle("is-open", isOpen);
        memoryComposer.classList.toggle("is-collapsed", !isOpen);
        memoryFilterBar.classList.toggle("is-collapsed", isOpen);
        memoryListContainer.classList.toggle("is-collapsed", isOpen);
        composerToggle.setAttribute("aria-expanded", String(isOpen));
        composerToggle.title = isOpen ? (isEn ? "Close composer" : "Yaddaş qeydini bağla") : (isEn ? "Add new memory" : "Yeni yaddaş qeydi əlavə et");
      };
      const composerToggle = button("", "memory-composer-toggle", () => setMemoryComposerOpen(false));
      composerToggle.type = "button";
      composerToggle.setAttribute("aria-label", isEn ? "Close composer" : "Yaddaş qeydini bağla");
      composerToggle.setAttribute("aria-expanded", "false");
      composerToggle.title = isEn ? "Close composer" : "Yaddaş qeydini bağla";
      composerToggle.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>';
      composerHeading.append(
        composerHeadingCopy,
        composerToggle,
      );

      const addMemoryRow = element("div", "experience-add-memory-row");
      const memoryInput = element("input", "settings-input");
      memoryInput.type = "text";
      memoryInput.placeholder = isEn ? "Add new business fact... e.g. We only work with B2B SaaS companies" : "Yeni fakt əlavə et... məs. Biz yalnız B2B şirkətlərlə işləyirik";
      memoryInput.maxLength = 500;
      memoryInput.setAttribute("aria-label", isEn ? "New memory fact" : "Yeni yaddaş qeydi");

      const memoryCategorySelect = element("select", "settings-input settings-select");
      memoryCategorySelect.setAttribute("aria-label", isEn ? "Memory category" : "Yaddaş qeydi kateqoriyası");
      [
        { val: "business", label: isEn ? "Business Fact" : "Biznes Faktı" },
        { val: "preference", label: isEn ? "Preference" : "Üstünlük" },
        { val: "constraint", label: isEn ? "Constraint" : "Məhdudiyyət" },
      ].forEach((c) => {
        const opt = element("option", "", c.label);
        opt.value = c.val;
        memoryCategorySelect.appendChild(opt);
      });

      const addMemoryBtn = button(isEn ? "Save memory" : "Yaddaşı saxla", "primary-button experience-add-btn", () => {
        const text = memoryInput.value.trim();
        if (!text) return;
        const sensitiveWarning = checkSensitiveData(text);
        if (sensitiveWarning) {
          showToast(sensitiveWarning, "error");
          return;
        }
        if (memoriesList.length >= 50) {
          showToast(isEn ? "Maximum 50 memory entries allowed." : "Maksimum 50 yaddaş qeydi saxlanıla bilər.", "error");
          return;
        }
        memoriesList.unshift({
          id: `mem_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
          text,
          category: memoryCategorySelect.value,
          createdAt: new Date().toISOString(),
        });
        memoryInput.value = "";
        setMemoryComposerOpen(false);
        renderMemories();
      });
      addMemoryBtn.type = "button";

      addMemoryRow.append(memoryInput, memoryCategorySelect, addMemoryBtn);
      memoryComposer.append(composerHeading, addMemoryRow);

      const memoryActionArea = element("div", "experience-memory-action-area");
      const memoryPrimaryActions = element("div", "experience-memory-primary-actions");
      const addMemoryActionBtn = button(isEn ? "+ Add memory" : "+ Yaddaş əlavə et", "primary-button memory-add-action-btn", () => {
        setMemoryComposerOpen(true);
        window.requestAnimationFrame(() => memoryInput.focus());
      });
      addMemoryActionBtn.type = "button";
      const importMemoryInlineBtn = button(isEn ? "Import from other AI" : "Başqa AI-dan köçür", "secondary-button experience-import-inline-btn", () => {
        openImportMemoryModal({
          userSettings: state.currentUser?.settings || {},
          onImportSuccess: (updatedUser) => {
            updateWorkspaceIdentity(updatedUser);
            renderSettings();
          },
        });
      });
      importMemoryInlineBtn.type = "button";
      memoryPrimaryActions.append(addMemoryActionBtn, importMemoryInlineBtn);

      const clearMemoriesBtn = button(isEn ? "Clear all memories" : "Bütün yaddaşı təmizlə", "danger-text-button", () => {
        if (confirm(isEn ? "Are you sure you want to delete all stored memories?" : "Bütün yaddaş qeydlərini silmək istədiyinizdən əminsiniz?")) {
          memoriesList = [];
          renderMemories();
        }
      });
      clearMemoriesBtn.type = "button";
      memoryActionArea.append(memoryPrimaryActions, clearMemoriesBtn);

      memoryWrapper.append(memoryFilterBar, memoryListContainer, memoryComposer, memoryActionArea);

      const memoryAccordion = createExperienceAccordion({
        title: "Memory Hub",
        desc: t("settings.experience.memoryDesc"),
        badgeNode: memoryBadge,
        isOpen: false,
        contentNode: memoryWrapper,
      });

      // 5. Scopes (Secondary - Collapsible)
      const scopesWrapper = element("div", "experience-scopes-wrapper");
      let isAutoContext = userSettings.autoContext !== false;
      let isStrategyPersonalization = userSettings.strategyPersonalization !== false;

      const createScopeRow = (title, desc, initialVal, onToggle) => {
        const row = element("div", "settings-toggle-row");
        const copy = element("div", "settings-toggle-copy");
        copy.append(element("strong", "", title), element("p", "", desc));
        const toggle = element("button", "settings-toggle");
        toggle.type = "button";
        toggle.setAttribute("role", "switch");
        let active = initialVal;
        const sync = () => {
          toggle.classList.toggle("is-active", active);
          toggle.setAttribute("aria-checked", String(active));
        };
        toggle.appendChild(element("span", "settings-toggle-thumb"));
        sync();
        toggle.addEventListener("click", () => {
          active = !active;
          sync();
          onToggle(active);
        });
        row.append(copy, toggle);
        return {
          row,
          setValue: (val) => {
            active = val;
            sync();
          },
        };
      };

      const askScope = createScopeRow("Ask", isEn ? "Automatically draws relevant context from past chats and strategies when answering questions." : "Cari sualınızla bağlı olduqda keçmiş söhbətlər və strategiyalardan faydalı məlumatlar avtomatik cəlb edilir.", isAutoContext, (v) => { isAutoContext = v; });
      const buildScope = createScopeRow("Build", isEn ? "Applies your brand profile and tone when generating and refining strategies." : "Yeni strategiya yaradarkən və dəqiqləşdirərkən yuxarıdakı brend profili və ton nəzərə alınır.", isStrategyPersonalization, (v) => { isStrategyPersonalization = v; });
      const autoSaveScope = createScopeRow(
        t("settings.experience.scopeAutoSaveTitle") || (isEn ? "Build Auto-Save" : "Build Arxivləmə"),
        t("settings.experience.scopeAutoSaveDesc") || (isEn ? "Automatically saves and archives strategies generated in Build mode." : "Build rejimində hazırlanan strategiyaları avtomatik olaraq arxivə köçürür və saxlayır."),
        isAutoSave,
        (v) => {
          isAutoSave = v;
          syncAutoSaveToggle();
          setAutoSaveStrategies(v);
        }
      );
      syncScopesAutoSave = (val) => autoSaveScope.setValue(val);

      scopesWrapper.append(askScope.row, buildScope.row, autoSaveScope.row);

      const scopesAccordion = createExperienceAccordion({
        title: t("settings.experience.scopesTitle"),
        desc: t("settings.experience.scopesDesc"),
        isOpen: false,
        contentNode: scopesWrapper,
      });

      aiCategory.cardsContainer.append(autoSaveAccordion, memoryAccordion, scopesAccordion);
      aiCategory.cardsContainer.appendChild(plannerNotifAccordion);
      brandCategory.cardsContainer.append(profileAccordion, toneAccordion);
      personalizationContainer.append(aiCategory.section, brandCategory.section);
      syncMasterToggle();

      // Save bar
      const formActions = element("div", "experience-form-actions");
      const save = button(t("settings.experience.saveBtn"), "primary-button experience-save-btn");
      save.type = "submit";
      formActions.appendChild(save);
      form.append(masterCard, personalizationContainer, workspaceCategory.section, formActions);

      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        save.disabled = true;
        save.textContent = isEn ? "Saving…" : "Saxlanılır…";
        const formData = new FormData(form);
        const payload = {
          personalIntelligence: isMasterEnabled,
          brandName: String(formData.get("brandName") || "").trim(),
          industry: String(formData.get("industry") || "").trim(),
          primaryMarket: String(formData.get("primaryMarket") || "").trim(),
          targetAudience: String(formData.get("targetAudience") || "").trim(),
          tone: currentTone,
          customInstructions: String(formData.get("customInstructions") || "").trim(),
          memories: memoriesList,
          autoContext: isAutoContext,
          strategyPersonalization: isStrategyPersonalization,
          autoSaveStrategies: isAutoSave,
          plannerNotifications: isPlannerNotif,
          defaultMode: currentDefaultMode,
        };
        try {
          const data = await authRequest("/api/auth/settings", {
            method: "PATCH",
            body: JSON.stringify(payload),
          });
          updateWorkspaceIdentity(data.user);
          setAutoSaveStrategies(isAutoSave);
          setCookie("helmer_default_mode", currentDefaultMode);
          try {
            localStorage.removeItem("helmer_default_mode");
          } catch { }
          state.mode = currentDefaultMode;
          syncMode();
          syncNav();
          settingsMessage(form, isEn ? "Personalized intelligence settings updated successfully." : "Fərdiləşdirilmiş təcrübə parametrləri uğurla yeniləndi.", "success");
          showToast(isEn ? "Settings saved." : "Parametrlər yadda saxlanıldı.");
        } catch (error) {
          settingsMessage(form, error.message);
          showToast(error.message, "error");
        } finally {
          save.disabled = false;
          save.textContent = t("settings.experience.saveBtn");
        }
      });
      panel.appendChild(form);
    } else {
      const guestStack = element("div", "experience-cards-stack");

      // Guest Experience Preview Card
      const guestExpCard = element("div", "experience-preview-card");
      guestExpCard.innerHTML = `
        <div class="experience-preview-header">
          <span class="experience-preview-badge" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1-1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3L12 3z"/>
            </svg>
          </span>
          <div class="experience-preview-text">
            <strong>${escapeHtml(isEn ? "Personalized Brand Brain & Long-Term Memory" : "Fərdiləşdirilmiş Brend Yaddaşı")}</strong>
            <p>${escapeHtml(isEn ? "Save your industry, target audience, and strategic constraints once. Helmer uses persistent context across all campaigns without repeating prompts." : "Sənayenizi, hədəf auditoriyanızı və brend qaydalarınızı bir dəfə qeyd edin. Helmer hər dəfə təkrar yazmadan bütün strategiyalarda bu kontekstdən istifadə edəcək.")}</p>
          </div>
        </div>
        <div class="experience-preview-features">
          <div class="preview-feature-item"><span class="preview-feature-bullet">✓</span>${escapeHtml(isEn ? "Persistent business profile facts" : "Daimi biznes faktları və profili")}</div>
          <div class="preview-feature-item"><span class="preview-feature-bullet">✓</span>${escapeHtml(isEn ? "Target ICP and persona memory" : "Hədəf kütlə və persona yaddaşı")}</div>
          <div class="preview-feature-item"><span class="preview-feature-bullet">✓</span>${escapeHtml(isEn ? "Cross-session strategic context" : "Sessiyalararası strateji kontekst")}</div>
          <div class="preview-feature-item"><span class="preview-feature-bullet">✓</span>${escapeHtml(isEn ? "Brand voice style enforcement" : "Brend tonu və üslub dəqiqliyi")}</div>
        </div>
      `;
      const guestExpCta = element("div", "guest-sync-banner");
      const guestExpLeft = element("div", "guest-sync-left");
      guestExpLeft.innerHTML = `
        <div class="guest-sync-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M19 18a3.5 3.5 0 0 0 0-7h-1A5 5 0 0 0 8 8a3.5 3.5 0 0 0-1 6.8V18"/>
            <polyline points="13 14 16 11 19 14"/>
            <line x1="16" y1="11" x2="16" y2="21"/>
          </svg>
        </div>
        <div class="guest-sync-text">
          <strong>${escapeHtml(isEn ? "Unlock Multi-Project Memory Hub" : "Çoxlayihəli Yaddaş Mərkəzini Açın")}</strong>
          <p>${escapeHtml(isEn ? "Create a free cloud account to save up to 50 strategic memories, custom instructions, and persona rules." : "50-dək strateji yaddaş qeydi, xüsusi təlimatlar və qaydalar saxlamaq üçün pulsuz hesab açın.")}</p>
        </div>
      `;
      const guestExpActions = element("div", "guest-sync-actions");
      guestExpActions.append(
        button(isEn ? "Create account" : "Hesab yarat", "primary-button", () => { window.location.href = "/signup?returnTo=/workspace"; }),
        button(isEn ? "Log in" : "Daxil ol", "secondary-button", () => { window.location.href = "/login?returnTo=/workspace"; })
      );
      guestExpCta.append(guestExpLeft, guestExpActions);
      aiCategory.cardsContainer.append(guestExpCard, guestExpCta);
      brandCategory.cardsContainer.append(toneAccordion);
      personalizationContainer.append(aiCategory.section, brandCategory.section);
      syncMasterToggle();
      guestStack.append(masterCard, personalizationContainer, workspaceCategory.section);
      panel.appendChild(guestStack);
    }
    view.appendChild(panel);
  } else if (state.settingsTab === "security") {
    const panel = element("section", "settings-panel settings-security-panel");
    panel.append(
      element("h2", "", t("settings.security.title")),
      element("p", "settings-panel-intro", t("settings.security.intro"))
    );

    // Security & Data Protection Health Card
    const healthCard = element("div", "settings-security-card security-health-card");
    healthCard.innerHTML = `
      <div class="security-card-header">
        <div class="security-badge" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
            <path d="m9 12 2 2 4-4"/>
          </svg>
        </div>
        <div class="security-card-text">
          <strong>${escapeHtml(isEn ? "Security & Data Protection" : "Təhlükəsizlik və Məlumatların Qorunması")}</strong>
          <p>${escapeHtml(isEn ? "Helmer employs industry-standard practices to protect your workspace, active sessions, and preferences." : "Helmer iş mühitinizi, aktiv sessiyalarınızı və parametrlərinizi qorumaq üçün standart təhlükəsizlik qaydalarından istifadə edir.")}</p>
        </div>
      </div>
      <div class="security-badges-grid">
        <div class="security-badge-tile">
          <span class="tile-icon">🔒</span>
          <strong>${escapeHtml(isEn ? "Encrypted Connection" : "Şifrələnmiş Əlaqə")}</strong>
          <p>${escapeHtml(isEn ? "Data transmitted between your browser and the workspace is protected via secure HTTPS." : "Brauzer və sistem arasındakı məlumat mübadiləsi təhlükəsiz HTTPS protokolu ilə qorunur.")}</p>
        </div>
        <div class="security-badge-tile">
          <span class="tile-icon">🛡️</span>
          <strong>${escapeHtml(isEn ? "Session & Account Safety" : "Sessiya və Giriş Təhlükəsizliyi")}</strong>
          <p>${escapeHtml(isEn ? "Sessions are managed with secure browser cookies to keep your account safe." : "Hesabınızın təhlükəsizliyini təmin etmək üçün qorunan sessiya kukilərindən istifadə edilir.")}</p>
        </div>
        <div class="security-badge-tile">
          <span class="tile-icon">📄</span>
          <strong>${escapeHtml(isEn ? "Data Control" : "Məlumatlara Nəzarət")}</strong>
          <p>${escapeHtml(isEn ? "You have full control over your saved strategies, account data, and workspace memory." : "Saxlanılan strategiyalarınız, yaddaş və hesab məlumatlarınız üzərində tam nəzarətə maliksiniz.")}</p>
        </div>
      </div>
    `;
    panel.appendChild(healthCard);

    // Model Improvement Contribution Card (Settings Security Tab)
    const isModelActive = isModelImprovementActive();
    const modelCard = element("div", "settings-security-card model-improvement-card");
    const modelRow = element("div", "settings-toggle-row");
    const modelCopy = element("div", "settings-toggle-copy");

    const modelHeaderRow = element("div", "model-improvement-header-row");
    const modelTitle = element("strong", "", t("settings.security.modelImprovementTitle"));

    const modelInfoWrap = element("div", "model-info-wrap");
    const modelInfoBtn = element("button", "model-improvement-info-btn");
    modelInfoBtn.type = "button";
    modelInfoBtn.setAttribute("aria-label", t("settings.security.modelImprovementInfoBtn"));
    modelInfoBtn.innerHTML = `
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="10"/>
        <path d="M12 16v-4"/>
        <path d="M12 8h.01"/>
      </svg>
    `;

    const modelInfoPopover = element("div", "model-info-popover");
    modelInfoPopover.setAttribute("role", "tooltip");
    modelInfoPopover.innerHTML = `
      <div class="model-info-popover-arrow" aria-hidden="true"></div>
      <div class="model-info-popover-content">
        <p class="model-info-popover-text">${escapeHtml(t("settings.security.modelImprovementInfoDetails"))}</p>
        <button type="button" class="model-info-popover-close" aria-label="${escapeHtml(isEn ? "Close info" : "Məlumatı bağla")}">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </div>
    `;

    const modelInfoCloseBtn = modelInfoPopover.querySelector(".model-info-popover-close");
    if (modelInfoCloseBtn) {
      modelInfoCloseBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        modelInfoWrap.classList.remove("is-visible");
      });
    }

    modelInfoWrap.append(modelInfoBtn, modelInfoPopover);

    // Support mobile touch / tap toggle as well as hover
    modelInfoBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      modelInfoWrap.classList.toggle("is-visible");
    });
    document.addEventListener("click", (e) => {
      if (!modelInfoWrap.contains(e.target)) {
        modelInfoWrap.classList.remove("is-visible");
      }
    });

    modelHeaderRow.append(modelTitle, modelInfoWrap);

    const modelDesc = element("p", "", t("settings.security.modelImprovementDesc"));
    modelCopy.append(modelHeaderRow, modelDesc);

    const modelToggle = element("button", `settings-toggle${isModelActive ? " is-active" : ""}`);
    modelToggle.type = "button";
    modelToggle.setAttribute("role", "switch");
    modelToggle.setAttribute("aria-label", t("settings.security.modelImprovementTitle"));
    modelToggle.setAttribute("aria-checked", String(isModelActive));
    modelToggle.disabled = !isPersonalIntelligenceActive();
    modelToggle.appendChild(element("span", "settings-toggle-thumb"));

    modelToggle.addEventListener("click", async () => {
      const nextState = !isModelImprovementActive();
      modelToggle.disabled = true;
      await toggleModelImprovement(nextState);
      modelToggle.classList.toggle("is-active", isModelImprovementActive());
      modelToggle.setAttribute("aria-checked", String(isModelImprovementActive()));
      modelToggle.disabled = !isPersonalIntelligenceActive();
    });

    modelRow.append(modelCopy, modelToggle);
    modelCard.appendChild(modelRow);
    panel.appendChild(modelCard);

    if (!state.currentUser) {
      const guestSandboxCard = element("div", "settings-diagnostic-card");
      guestSandboxCard.innerHTML = `
        <div class="diagnostic-info">
          <strong>${escapeHtml(isEn ? "Guest Local Sandbox Controls" : "Qonaq Mühiti İdarəetməsi")}</strong>
          <p>${escapeHtml(isEn ? "Reset this browser's isolated local memory and purge session cookies immediately." : "Bu brauzerdəki lokal yaddaşı və sessiya kukilərini dərhal sıfırlayın.")}</p>
        </div>
      `;
      const resetBtn = button(isEn ? "Reset Local Session" : "Lokal sessiyanı sıfırla", "secondary-button", () => {
        if (confirm(isEn ? "Reset local guest data and refresh workspace?" : "Lokal məlumatları sıfırlamaq və səhifəni yeniləmək istəyirsiniz?")) {
          document.cookie.split(";").forEach((c) => {
            document.cookie = c.replace(/^ +/, "").replace(/=.*/, "=;expires=" + new Date().toUTCString() + ";path=/");
          });
          window.location.reload();
        }
      });
      resetBtn.type = "button";
      guestSandboxCard.appendChild(resetBtn);
      panel.appendChild(guestSandboxCard);

      const guestSecCard = element("div", "guest-sync-banner");
      const guestSecLeft = element("div", "guest-sync-left");
      guestSecLeft.innerHTML = `
        <div class="guest-sync-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
          </svg>
        </div>
        <div class="guest-sync-text">
          <strong>${escapeHtml(isEn ? "Elevate to Encrypted Cloud Security" : "Şifrələnmiş Bulud Hesabına Keçin")}</strong>
          <p>${escapeHtml(isEn ? "Your guest session is securely isolated on this device. Create an account to enable Argon2id password protection and multi-device session security." : "Qonaq sessiyanız bu cihazda təcrid olunub. Şifrə mühafizəsi və çoxcihazlı təhlükəsizlik üçün hesab yaradın.")}</p>
        </div>
      `;
      const guestSecActions = element("div", "guest-sync-actions");
      guestSecActions.append(
        button(isEn ? "Create account" : "Hesab yarat", "primary-button", () => { window.location.href = "/signup?returnTo=/workspace"; }),
        button(isEn ? "Log in" : "Daxil ol", "secondary-button", () => { window.location.href = "/login?returnTo=/workspace"; })
      );
      guestSecCard.append(guestSecLeft, guestSecActions);
      panel.appendChild(guestSecCard);
      view.appendChild(panel);
    } else {
      const form = element("form", "settings-form");
      form.append(
        settingsField(t("settings.security.currentPassword"), "currentPassword", "", "password", "current-password"),
        settingsField(t("settings.security.newPassword"), "newPassword", "", "password", "new-password"),
        settingsField(t("settings.security.confirmPassword"), "confirmPassword", "", "password", "new-password"),
      );
      const save = button(t("settings.security.changePasswordBtn"), "primary-button");
      save.type = "submit";
      form.appendChild(save);
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (form.newPassword.value !== form.confirmPassword.value) {
          settingsMessage(form, isEn ? "New passwords do not match." : "Yeni şifrələr eyni deyil.");
          return;
        }
        save.disabled = true;
        save.textContent = isEn ? "Updating…" : "Yenilənir…";
        try {
          await authRequest("/api/auth/change-password", {
            method: "POST",
            body: JSON.stringify({
              currentPassword: form.currentPassword.value,
              newPassword: form.newPassword.value,
            }),
          });
          form.reset();
          settingsMessage(form, isEn ? "Password updated. Other sessions terminated." : "Şifrə yeniləndi. Digər sessiyalar bağlandı.", "success");
        } catch (error) {
          settingsMessage(form, error.message);
        } finally {
          save.disabled = false;
          save.textContent = t("settings.security.changePasswordBtn");
        }
      });
      const signOut = element("div", "settings-signout");
      const copy = element("div");
      copy.append(
        element("strong", "", t("settings.security.signOutTitle")),
        element("p", "", t("settings.security.signOutDesc"))
      );
      const signOutActions = element("div", "settings-signout-actions");
      signOutActions.style.cssText = "display:flex;gap:10px;flex-wrap:wrap;align-items:center;";
      const logoutOtherBtn = button(
        isEn ? "Sign out other devices" : "Digər cihazlardan çıxış",
        "secondary-button",
        async () => {
          logoutOtherBtn.disabled = true;
          try {
            await authRequest("/api/auth/logout-all", { method: "POST", body: "{}" });
            showToast(isEn ? "Signed out of all other devices." : "Digər bütün cihazlardakı sessiyalar bağlandı.", "success");
          } catch (err) {
            showToast(err.message || (isEn ? "Could not sign out other devices." : "Xəta baş verdi."), "error");
          } finally {
            logoutOtherBtn.disabled = false;
          }
        }
      );
      logoutOtherBtn.type = "button";
      signOutActions.append(logoutOtherBtn, button(t("settings.security.signOutBtn"), "danger-button", logout));
      signOut.append(copy, signOutActions);

      // Danger Zone: Account Deletion (14-day grace period)
      const isPendingDeletion = state.currentUser?.status === "pending_deletion" || Boolean(state.currentUser?.scheduledDeletionAt);
      const deleteAccountBox = element("div", `settings-signout settings-danger-zone${isPendingDeletion ? " is-pending-deletion" : ""}`);
      const deleteCopy = element("div");

      if (isPendingDeletion) {
        const schedDate = state.currentUser.scheduledDeletionAt
          ? new Date(state.currentUser.scheduledDeletionAt).toLocaleDateString(isEn ? "en-US" : "az-AZ", { day: "numeric", month: "long", year: "numeric" })
          : (isEn ? "in 14 days" : "14 gün sonra");
        deleteCopy.append(
          element("strong", "danger-zone-title text-warning", isEn ? "⚠️ Account deletion pending" : "⚠️ Hesabın silinməsi gözlənilir"),
          element("p", "", isEn
            ? `Your account is scheduled for deletion on ${schedDate}. You can cancel deletion anytime before this date.`
            : `Hesabınız 14 günlük gözləmə rejimindədir. Yekun silinmə tarixi: ${schedDate}. Bu tarixə qədər silinməni istədiyiniz vaxt ləğv edə bilərsiniz.`)
        );
        const cancelDeletionBtn = button(isEn ? "Cancel deletion" : "Silinməni ləğv et", "secondary-button experience-restore-btn", async () => {
          cancelDeletionBtn.disabled = true;
          cancelDeletionBtn.textContent = isEn ? "Restoring…" : "Bərpa edilir…";
          try {
            const res = await authRequest("/api/auth/account/cancel-deletion", { method: "POST" });
            if (res?.user) state.currentUser = res.user;
            showToast(isEn ? "Deletion cancelled and account restored." : "Silinmə sorğusu ləğv edildi və hesabınız bərpa olundu.", "success");
            render();
          } catch (err) {
            showToast(err.message || (isEn ? "An error occurred." : "Xəta baş verdi."), "error");
            cancelDeletionBtn.disabled = false;
            cancelDeletionBtn.textContent = isEn ? "Cancel deletion" : "Silinməni ləğv et";
          }
        });
        deleteAccountBox.append(deleteCopy, cancelDeletionBtn);
      } else {
        deleteCopy.append(
          element("strong", "danger-zone-title text-danger", t("settings.security.deleteAccountTitle")),
          element("p", "", t("settings.security.deleteAccountDesc"))
        );
        const deleteBtn = button(t("settings.security.deleteAccountBtn"), "danger-button", openDeleteAccountModal);
        deleteAccountBox.append(deleteCopy, deleteBtn);
      }

      panel.append(form, signOut, deleteAccountBox);
      view.appendChild(panel);
    }
  } else {
    const panel = element("section", "settings-panel settings-legal-panel");
    panel.append(
      element("h2", "", t("settings.legal.title")),
      element("p", "settings-panel-intro", t("settings.legal.intro"))
    );

    const docsList = element("div", "settings-legal-list");

    const termsRow = element("div", "settings-legal-row");
    const termsInfo = element("div");
    termsInfo.append(
      element("strong", "", t("settings.legal.termsTitle")),
      element("p", "", t("settings.legal.termsDesc"))
    );
    termsRow.append(termsInfo, button(isEn ? "View Terms →" : "Baxış keçir →", "secondary-button", () => openLegalModal("terms")));

    const privacyRow = element("div", "settings-legal-row");
    const privacyInfo = element("div");
    privacyInfo.append(
      element("strong", "", t("settings.legal.privacyTitle")),
      element("p", "", t("settings.legal.privacyDesc"))
    );
    privacyRow.append(privacyInfo, button(isEn ? "View Policy →" : "Baxış keçir →", "secondary-button", () => openLegalModal("privacy")));

    const reportRow = element("div", "settings-legal-row");
    const reportInfo = element("div");
    reportInfo.append(
      element("strong", "", t("settings.legal.reportTitle")),
      element("p", "", t("settings.legal.reportDesc"))
    );
    reportRow.append(reportInfo, button(isEn ? "Report issue →" : "Problem bildir →", "secondary-button", () => openLegalReportModal()));

    docsList.append(termsRow, privacyRow, reportRow);
    panel.appendChild(docsList);
    view.appendChild(panel);
  }
  view.appendChild(tabs);
  view.appendChild(buildSupportChatBubble());
  workspace.appendChild(view);
}

function formatArchiveDate(value) {
  const isEn = getLanguage() === "en";
  if (!value) return isEn ? "Just now" : "İndi";
  const date = new Date(value);
  if (isNaN(date.getTime())) return isEn ? "Just now" : "İndi";

  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  if (isToday) return isEn ? "Today" : "Bu gün";

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday = date.toDateString() === yesterday.toDateString();
  if (isYesterday) return isEn ? "Yesterday" : "Dünən";

  const monthsAz = ["Yan", "Fev", "Mar", "Apr", "May", "İyn", "İyl", "Avq", "Sen", "Okt", "Noy", "Dek"];
  const monthsEn = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const months = isEn ? monthsEn : monthsAz;
  const day = date.getDate();
  const month = months[date.getMonth()] || "";

  if (date.getFullYear() === now.getFullYear()) {
    return isEn ? `${month} ${day}` : `${day} ${month}`;
  }
  return isEn ? `${month} ${day}, ${date.getFullYear()}` : `${day} ${month} ${date.getFullYear()}`;
}

function closeAllArchiveMenus() {
  document.querySelectorAll(".archive-context-menu, .archive-sort-menu").forEach((m) => {
    m.hidden = true;
  });
  document.querySelectorAll(".archive-more-btn.is-active").forEach((b) => {
    b.classList.remove("is-active");
  });
}

document.addEventListener("click", (e) => {
  if (!e.target.closest("#railArchiveContainer")) {
    hideRailArchivePopover(true);
  }
  closeAllArchiveMenus();
  document.querySelectorAll(".settings-lang-dropdown[open]").forEach((d) => {
    if (!d.contains(e.target)) d.removeAttribute("open");
  });
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    closeAllArchiveMenus();
    document.querySelectorAll(".settings-lang-dropdown[open]").forEach((d) => d.removeAttribute("open"));
  }
});

function openArchivePromptModal({ title, label, initialValue, confirmText = "", onConfirm }) {
  const isEn = getLanguage() === "en";
  const defaultConfirmText = confirmText || (isEn ? "Save" : "Yadda saxla");
  document.querySelectorAll(".archive-modal-overlay").forEach((el) => el.remove());
  const overlay = element("div", "archive-modal-overlay");
  const card = element("div", "archive-modal-card");
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-modal", "true");

  const titleEl = element("h2", "archive-modal-title", title);
  const input = element("input", "archive-modal-input");
  input.type = "text";
  input.value = initialValue || "";
  input.placeholder = label || (isEn ? "Strategy name" : "Strategiya adı");

  const actions = element("div", "archive-modal-actions");
  const cancelBtn = button(isEn ? "Cancel" : "Ləğv et", "archive-modal-cancel", () => overlay.remove());
  const confirmBtn = button(defaultConfirmText, "archive-modal-confirm", async () => {
    const val = input.value.trim();
    if (!val) return;
    overlay.remove();
    await onConfirm(val);
  });

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      confirmBtn.click();
    } else if (e.key === "Escape") {
      overlay.remove();
    }
  });

  actions.append(cancelBtn, confirmBtn);
  card.append(titleEl, input, actions);
  overlay.appendChild(card);

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.remove();
  });

  document.body.appendChild(overlay);
  setTimeout(() => {
    input.focus();
    input.select();
  }, 40);
}

function openArchiveConfirmModal({ title, message, confirmText = "", isDestructive = false, onConfirm }) {
  const isEn = getLanguage() === "en";
  const defaultConfirmText = confirmText || (isEn ? "Confirm" : "Təsdiq et");
  document.querySelectorAll(".archive-modal-overlay").forEach((el) => el.remove());
  const overlay = element("div", "archive-modal-overlay");
  const card = element("div", "archive-modal-card");
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-modal", "true");

  const titleEl = element("h2", "archive-modal-title", title);
  const descEl = element("p", "archive-modal-desc", message);

  const actions = element("div", "archive-modal-actions");
  const cancelBtn = button(isEn ? "Cancel" : "Ləğv et", "archive-modal-cancel", () => overlay.remove());
  const confirmBtn = button(defaultConfirmText, `archive-modal-confirm${isDestructive ? " is-destructive" : ""}`, async () => {
    overlay.remove();
    await onConfirm();
  });

  actions.append(cancelBtn, confirmBtn);
  card.append(titleEl, descEl, actions);
  overlay.appendChild(card);

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.remove();
  });

  document.body.appendChild(overlay);
}

function createStrategyRowContextMenu(record) {
  const isEn = getLanguage() === "en";
  const menu = element("div", "archive-context-menu");
  menu.hidden = true;

  const openItem = button("", "archive-menu-item", (e) => {
    e.stopPropagation();
    menu.hidden = true;
    openSavedStrategy(record.id);
  });
  openItem.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg><span>${isEn ? "Open" : "Aç"}</span>`;

  const renameItem = button("", "archive-menu-item", (e) => {
    e.stopPropagation();
    menu.hidden = true;
    openArchivePromptModal({
      title: isEn ? "Rename strategy" : "Adını dəyiş",
      label: isEn ? "Strategy name" : "Strategiya adı",
      initialValue: record.title,
      confirmText: isEn ? "Save" : "Yadda saxla",
      onConfirm: async (newTitle) => {
        const epoch = state.identityEpoch;
        const expectedUserId = state.currentUser?.id || null;
        try {
          await api(`/api/strategy/${record.id}`, {
            method: "PATCH",
            body: JSON.stringify({ title: newTitle }),
          });
          if (isIdentityStale(epoch, expectedUserId)) return;
          if (state.savedId === record.id && state.strategy) {
            state.strategy.title = newTitle;
          }
          await loadSavedStrategies();
          showToast(isEn ? "Strategy renamed ✓" : "Strategiyanın adı dəyişdirildi ✓");
        } catch (error) {
          if (isIdentityStale(epoch, expectedUserId)) return;
          showToast(error.message || (isEn ? "Unable to rename strategy." : "Adı dəyişmək mümkün olmadı."), "error");
        }
      },
    });
  });
  renameItem.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg><span>${isEn ? "Rename" : "Adını dəyiş"}</span>`;

  const duplicateItem = button("", "archive-menu-item", async (e) => {
    e.stopPropagation();
    menu.hidden = true;
    const epoch = state.identityEpoch;
    const expectedUserId = state.currentUser?.id || null;
    try {
      await api(`/api/strategy/${record.id}/duplicate`, { method: "POST" });
      if (isIdentityStale(epoch, expectedUserId)) return;
      await loadSavedStrategies();
      showToast(isEn ? "Strategy duplicated ✓" : "Strategiyanın dublikatı yaradıldı ✓");
    } catch (error) {
      if (isIdentityStale(epoch, expectedUserId)) return;
      showToast(error.message || (isEn ? "Unable to duplicate strategy." : "Dublikat yaratmaq mümkün olmadı."), "error");
    }
  });
  duplicateItem.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg><span>${isEn ? "Duplicate" : "Dublikat yarat"}</span>`;

  const saveItem = button("", "archive-menu-item", (e) => {
    e.stopPropagation();
    menu.hidden = true;
    showToast(isEn ? "Strategy already preserved in Archive ✓" : "Strategiya artıq arxivdə saxlanılıb ✓");
  });
  saveItem.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg><span>${isEn ? "Archive / Saved" : "Arxivlə / Yadda saxla"}</span>`;

  const divider = element("div", "archive-menu-divider");

  const deleteItem = button("", "archive-menu-item is-destructive", (e) => {
    e.stopPropagation();
    menu.hidden = true;
    openArchiveConfirmModal({
      title: isEn ? "Delete strategy" : "Strategiyanı sil",
      message: isEn
        ? `"${record.title || "This strategy"}" will be permanently removed from Archive. This action cannot be undone.`
        : `"${record.title || "Bu strategiya"}" arxivdən birdəfəlik silinəcək. Bu əməliyyat geri qaytarılmır.`,
      confirmText: isEn ? "Delete" : "Sil",
      isDestructive: true,
      onConfirm: async () => {
        const epoch = state.identityEpoch;
        const expectedUserId = state.currentUser?.id || null;
        try {
          await api(`/api/strategy/${record.id}`, { method: "DELETE" });
          if (isIdentityStale(epoch, expectedUserId)) return;
          if (state.savedId === record.id) {
            resetStrategy();
          }
          await loadSavedStrategies();
          showToast(isEn ? "Strategy deleted from Archive." : "Strategiya arxivdən silindi.");
        } catch (error) {
          showToast(error.message || (isEn ? "Unable to delete strategy." : "Strategiyanı silmək mümkün olmadı."), "error");
        }
      },
    });
  });
  deleteItem.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg><span>${isEn ? "Delete" : "Sil"}</span>`;

  menu.append(openItem, renameItem, duplicateItem, saveItem, divider, deleteItem);
  return menu;
}

function renderArchiveBackgroundCta() {
  try {
    if (localStorage.getItem("helmer_archive_bg_cta_dismissed") === "1") {
      return null;
    }
  } catch { }

  const banner = element("aside", "archive-bg-cta");
  banner.setAttribute("role", "note");
  banner.setAttribute("aria-label", t("archive.bgCtaTitle"));

  const left = element("div", "archive-bg-cta-left");
  const iconWrap = element("div", "archive-bg-cta-icon");
  iconWrap.setAttribute("aria-hidden", "true");
  iconWrap.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>`;

  const textWrap = element("div", "archive-bg-cta-text");
  const tag = element("span", "archive-bg-cta-tag");
  const tagSparkle = document.createElement("span");
  tagSparkle.className = "archive-bg-cta-tag-sparkle";
  tagSparkle.setAttribute("aria-hidden", "true");
  tagSparkle.innerHTML = `<svg viewBox="0 0 24 24" width="10" height="10" fill="currentColor"><path d="M12 2l2.4 5.6L20 10l-4.4 3.8L16.8 20 12 16.9 7.2 20l1.2-6.2L4 10l5.6-2.4z"/></svg>`;
  tag.append(tagSparkle, document.createTextNode(t("archive.bgCtaTag")));

  const title = element("strong", "archive-bg-cta-title", t("archive.bgCtaTitle"));
  const desc = element("p", "archive-bg-cta-desc", t("archive.bgCtaDesc"));
  textWrap.append(tag, title, desc);
  left.append(iconWrap, textWrap);

  const actions = element("div", "archive-bg-cta-actions");
  const actionBtn = button("", "archive-bg-cta-btn", () => {
    try { localStorage.setItem("helmer_archive_bg_cta_dismissed", "1"); } catch { }
    resetStrategy();
  });
  actionBtn.type = "button";
  actionBtn.setAttribute("aria-label", t("archive.bgCtaAction"));
  const arrow = document.createElement("span");
  arrow.setAttribute("aria-hidden", "true");
  arrow.className = "archive-bg-cta-arrow";
  arrow.innerHTML = `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>`;
  actionBtn.append(document.createTextNode(t("archive.bgCtaAction")), arrow);

  const dismissBtn = element("button", "archive-bg-cta-dismiss");
  dismissBtn.type = "button";
  dismissBtn.setAttribute("aria-label", t("archive.bgCtaDismiss"));
  dismissBtn.title = t("archive.bgCtaDismiss");
  dismissBtn.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
  dismissBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    try { localStorage.setItem("helmer_archive_bg_cta_dismissed", "1"); } catch { }
    banner.classList.add("is-dismissed");
    setTimeout(() => {
      banner.remove();
    }, 220);
  });

  actions.append(actionBtn, dismissBtn);
  banner.append(left, actions);

  return banner;
}

export function goToAskDeepResearch() {
  if (state.mode !== "ask") {
    setMode("ask");
  }
  if (!state.askPluginIds) state.askPluginIds = [];
  if (!state.askPluginIds.includes("deep-research")) {
    state.askPluginIds = [
      ...state.askPluginIds.filter((id) => !["word", "excel", "powerpoint", "pdf"].includes(id)),
      "deep-research"
    ];
  }
  state.view = "home";
  render();
  setTimeout(() => {
    const askInput = document.querySelector("#askInput");
    askInput?.focus();
  }, 50);
}

export function renderArchiveResearchCard(isEn) {
  try {
    if (localStorage.getItem("helmer_archive_research_card_dismissed") === "1") {
      return null;
    }
  } catch { }

  const card = element("div", "archive-research-card");
  card.setAttribute("role", "region");
  const cardTitle = t("archive.researchTipTitle") || (isEn ? "Want to wait less next time?" : "Növbəti dəfə daha az gözləmək istəyirsən?");
  card.setAttribute("aria-label", cardTitle);

  const left = element("div", "archive-research-card-left");

  const iconWrap = element("span", "archive-research-card-icon");
  iconWrap.setAttribute("aria-hidden", "true");
  iconWrap.innerHTML = `<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7.5"/><path d="m21 21-4.35-4.35"/><path d="M11 7.5a3.5 3.5 0 0 0-3.5 3.5" stroke-width="1.8" stroke-linecap="round"/></svg>`;

  const body = element("div", "archive-research-card-body");

  const header = element("div", "archive-research-card-header");
  const title = element("strong", "archive-research-card-title", cardTitle);
  header.append(title);

  const desc = element(
    "p",
    "archive-research-card-desc",
    t("archive.researchTipDesc") || (isEn
      ? "Try the new Deep Research feature in Ask mode! Get the synthesis of speed with comparable performance."
      : "Ask rejimində yeni Deep Research funksiyasını yoxla! Oxşar performansla sürətin sintezini əldə et.")
  );

  body.append(header, desc);
  left.append(iconWrap, body);

  const actions = element("div", "archive-research-card-actions");

  const actionBtn = button(
    "",
    "archive-research-card-btn",
    (e) => {
      e.stopPropagation();
      try {
        localStorage.setItem("helmer_archive_research_card_dismissed", "1");
      } catch { }
      goToAskDeepResearch();
    }
  );
  actionBtn.type = "button";
  const btnText = element("span", "", t("archive.researchTipAction") || (isEn ? "Try it" : "Yoxla"));
  actionBtn.append(btnText);

  const dismissBtn = document.createElement("button");
  dismissBtn.type = "button";
  dismissBtn.className = "archive-research-card-close";
  const dismissTitle = t("archive.researchTipDismiss") || (isEn ? "Dismiss" : "Bağla");
  dismissBtn.setAttribute("aria-label", dismissTitle);
  dismissBtn.title = dismissTitle;
  dismissBtn.innerHTML = `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
  dismissBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    try {
      localStorage.setItem("helmer_archive_research_card_dismissed", "1");
    } catch { }
    card.classList.add("is-dismissing");
    setTimeout(() => {
      card.remove();
    }, 180);
  });

  actions.append(actionBtn, dismissBtn);
  card.append(left, actions);

  card.addEventListener("click", (e) => {
    if (e.target.closest(".archive-research-card-close")) return;
    try {
      localStorage.setItem("helmer_archive_research_card_dismissed", "1");
    } catch { }
    goToAskDeepResearch();
  });

  return card;
}

let railArchiveHoverTimeout = null;

function renderRailArchivePopover() {
  const popover = document.querySelector("#railArchivePopover");
  if (!popover) return;
  const isEn = getLanguage() === "en";
  popover.replaceChildren();

  const header = element("div", "rail-archive-popover-header", t("archive.recentStrategies"));
  popover.appendChild(header);

  const list = element("div", "rail-archive-popover-list");
  const recent = (state.savedStrategies || []).slice(0, 3);

  if (!recent.length) {
    const empty = element("div", "rail-archive-popover-empty", t("archive.noStrategiesYet"));
    list.appendChild(empty);
  } else {
    recent.forEach((strat) => {
      const item = button("", "rail-archive-popover-item", (e) => {
        e.stopPropagation();
        hideRailArchivePopover(true);
        openSavedStrategy(strat.id);
      });
      item.setAttribute("role", "menuitem");

      const icon = element("span", "rail-archive-popover-item-icon");
      icon.innerHTML = `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/></svg>`;

      const textWrap = element("div", "rail-archive-popover-item-text");
      const title = element(
        "span",
        "rail-archive-popover-item-title",
        strat.title || (isEn ? "Untitled strategy" : "Adsız strategiya")
      );
      const date = element(
        "span",
        "rail-archive-popover-item-date",
        formatDate(strat.updatedAt || strat.createdAt)
      );
      textWrap.append(title, date);

      item.append(icon, textWrap);
      list.appendChild(item);
    });
  }
  popover.appendChild(list);

  const divider = element("div", "rail-archive-popover-divider");
  popover.appendChild(divider);

  const viewAllBtn = button("", "rail-archive-popover-all", (e) => {
    e.stopPropagation();
    hideRailArchivePopover(true);
    state.view = "list";
    syncNav();
    render();
    closeSidebar();
  });
  viewAllBtn.setAttribute("role", "menuitem");

  const viewAllText = element("span", "rail-archive-popover-all-label", t("archive.viewAll"));
  const arrow = element("span", "rail-archive-popover-all-arrow");
  arrow.innerHTML = `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>`;
  viewAllBtn.append(viewAllText, arrow);

  popover.appendChild(viewAllBtn);
}

function showRailArchivePopover() {
  if (typeof window !== "undefined" && window.innerWidth < 768) return;
  if (document.body.classList.contains("sidebar-open")) return;
  if (state.view === "list") return;

  if (railArchiveHoverTimeout) {
    clearTimeout(railArchiveHoverTimeout);
    railArchiveHoverTimeout = null;
  }
  const popover = document.querySelector("#railArchivePopover");
  if (!popover) return;

  if (!popover.hidden && popover.classList.contains("is-visible")) {
    return;
  }

  renderRailArchivePopover();
  popover.hidden = false;
  popover.classList.add("is-visible");
}

function hideRailArchivePopover(immediate = false) {
  if (railArchiveHoverTimeout) {
    clearTimeout(railArchiveHoverTimeout);
    railArchiveHoverTimeout = null;
  }
  const popover = document.querySelector("#railArchivePopover");
  if (!popover) return;

  if (immediate) {
    popover.classList.remove("is-visible");
    popover.hidden = true;
    return;
  }

  railArchiveHoverTimeout = setTimeout(() => {
    popover.classList.remove("is-visible");
    popover.hidden = true;
    railArchiveHoverTimeout = null;
  }, 260);
}

function setupRailArchiveHover() {
  const container = document.querySelector("#railArchiveContainer");
  const popover = document.querySelector("#railArchivePopover");
  const btn = document.querySelector("#railStrategiesButton");
  if (!container || !popover || !btn) return;

  const cancelHide = () => {
    if (railArchiveHoverTimeout) {
      clearTimeout(railArchiveHoverTimeout);
      railArchiveHoverTimeout = null;
    }
  };

  container.addEventListener("mouseenter", () => {
    cancelHide();
    showRailArchivePopover();
  });

  popover.addEventListener("mouseenter", () => {
    cancelHide();
  });

  container.addEventListener("mouseleave", (e) => {
    if (e.relatedTarget && (container.contains(e.relatedTarget) || popover.contains(e.relatedTarget))) {
      return;
    }
    hideRailArchivePopover();
  });

  popover.addEventListener("mouseleave", (e) => {
    if (e.relatedTarget && (container.contains(e.relatedTarget) || popover.contains(e.relatedTarget))) {
      return;
    }
    hideRailArchivePopover();
  });

  btn.addEventListener("click", () => {
    hideRailArchivePopover(true);
  });

  container.addEventListener("focusin", (e) => {
    cancelHide();
    if (e.target === btn) {
      showRailArchivePopover();
    }
  });

  container.addEventListener("focusout", () => {
    setTimeout(() => {
      if (!container.contains(document.activeElement) && !popover.contains(document.activeElement)) {
        hideRailArchivePopover(true);
      }
    }, 250);
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && popover && !popover.hidden) {
      hideRailArchivePopover(true);
    }
  });
}

function renderArchivePlannerSwitch(activeView = "archive") {
  const isEn = getLanguage() === "en";
  const switchWrap = element("div", "archive-planner-switch");
  switchWrap.setAttribute("role", "tablist");
  switchWrap.setAttribute("aria-label", isEn ? "Workspace views" : "İş sahələri");

  const archiveBtn = button("", `archive-planner-option${activeView === "archive" ? " is-active" : ""}`, () => {
    if (!state.currentUser) {
      openGuestRestrictionModal(GUEST_RESTRICTION_NOTICES.strategy);
      return;
    }
    if (state.view !== "list") {
      state.view = "list";
      syncNav();
      render();
      closeSidebar();
    }
  });
  archiveBtn.type = "button";
  archiveBtn.setAttribute("role", "tab");
  archiveBtn.setAttribute("aria-selected", String(activeView === "archive"));
  archiveBtn.append(element("span", "", isEn ? "Archive" : "Arxiv"));
  if (!state.currentUser) {
    const lock = element("span", "guest-inline-lock");
    lock.innerHTML = getGuestLockIconSvg(11);
    archiveBtn.appendChild(lock);
  }

  const plannerBtn = button("", `archive-planner-option${activeView === "planner" ? " is-active" : ""}`, () => {
    if (!state.currentUser) {
      openGuestRestrictionModal(GUEST_RESTRICTION_NOTICES.planner);
      return;
    }
    if (state.view !== "planner") {
      state.view = "planner";
      syncNav();
      render();
      closeSidebar();
      loadPlannerTasks();
    }
  });
  plannerBtn.type = "button";
  plannerBtn.setAttribute("role", "tab");
  plannerBtn.setAttribute("aria-selected", String(activeView === "planner"));
  plannerBtn.append(element("span", "", isEn ? "Planner" : "Planlaşdırılanlar"));
  if (!state.currentUser) {
    const lock = element("span", "guest-inline-lock");
    lock.innerHTML = getGuestLockIconSvg(11);
    plannerBtn.appendChild(lock);
  }

  switchWrap.append(archiveBtn, plannerBtn);
  return switchWrap;
}

function renderStrategyList() {
  const isEn = getLanguage() === "en";
  workspace.classList.add("workspace-list");
  workspace.replaceChildren();

  const view = element("section", "strategies-view");
  const heading = element("div", "archive-header");
  const copy = element("div", "archive-header-copy");
  copy.append(
    element("h1", "archive-title", isEn ? "Archive" : "Arxiv"),
    element("p", "archive-subtitle", isEn ? "Manage and organize your strategic roadmaps" : "Strategiyalarını və saxladığın işləri idarə et")
  );
  const switchEl = renderArchivePlannerSwitch("archive");
  heading.append(copy, switchEl);
  view.appendChild(heading);

  if (!state.currentUser) {
    const locked = element("div", "archive-guest-locked-card");
    locked.innerHTML = `
      <div class="archive-guest-locked-icon">
        <svg viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
      </div>
      <h2 class="archive-guest-locked-title">${isEn ? "Registration Required" : "Qeydiyyat Tələb Olunur"}</h2>
      <p class="archive-guest-locked-text">${escapeHtml(getGuestRestrictionNotice(GUEST_RESTRICTION_NOTICES.strategy, isEn))}</p>
      <a href="/signup?returnTo=${encodeURIComponent(location.pathname + location.search + location.hash)}" class="archive-guest-locked-btn">${isEn ? "Sign Up" : "Qeydiyyatdan keç"}</a>
    `;
    view.appendChild(locked);
    workspace.appendChild(view);
    return;
  }

  const researchCard = renderArchiveResearchCard(isEn);
  if (researchCard) {
    view.appendChild(researchCard);
  }

  const activeBgJobs = backgroundJobs.filter((j) => j.status === "generating" || j.status === "ready" || j.status === "error");

  if (!state.savedStrategies.length && !activeBgJobs.length) {
    const empty = element("div", "archive-empty-state");
    const emptyNewBtn = button("", "archive-new-btn", resetStrategy);
    emptyNewBtn.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg><span>${t("archive.buildSomethingNew")}</span>`;
    empty.append(
      element("h2", "archive-empty-title", isEn ? "No strategies yet" : "Hələ strategiya yoxdur"),
      element("p", "archive-empty-desc", isEn ? "Get started by building your first go-to-market strategy." : "İlk strategiyanı yaradaraq işə başla."),
      emptyNewBtn,
    );
    view.appendChild(empty);
  } else {
    // Toolbar with simple editorial tabs on left and Sort on right
    const toolbar = element("div", "archive-toolbar");

    const tabs = element("div", "archive-tabs");
    let currentFilterKey = "all";
    const filterTabsConfig = [
      { key: "all", label: isEn ? "All" : "Hamısı" },
      { key: "recent", label: isEn ? "Recent" : "Son" },
      { key: "saved", label: isEn ? "Saved" : "Yadda saxlanmış" },
    ];
    filterTabsConfig.forEach(({ key, label }, index) => {
      const tabBtn = button(label, `archive-tab${index === 0 ? " is-active" : ""}`, () => {
        currentFilterKey = key;
        [...tabs.children].forEach((item) => item.classList.toggle("is-active", item === tabBtn));
        drawRows();
      });
      tabs.appendChild(tabBtn);
    });

    let currentSort = "newest";
    const sortLabels = {
      newest: isEn ? "Most Recent" : "Son yenilənən",
      oldest: isEn ? "Oldest First" : "Ən köhnə",
      alphabetical: isEn ? "Alphabetical (A–Z)" : "Əlifba sırası",
    };
    const sortWrap = element("div", "archive-sort-wrap");
    const sortBtn = button("", "archive-sort-btn");
    const sortLabelSpan = element("span", "archive-sort-label", sortLabels[currentSort]);
    const sortChevron = element("span", "archive-sort-chevron");
    sortChevron.innerHTML = `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>`;
    sortBtn.append(sortLabelSpan, sortChevron);

    const sortMenu = element("div", "archive-sort-menu");
    sortMenu.hidden = true;
    [
      { key: "newest", label: isEn ? "Most Recent" : "Son yenilənən" },
      { key: "oldest", label: isEn ? "Oldest First" : "Ən köhnə" },
      { key: "alphabetical", label: isEn ? "Alphabetical (A–Z)" : "Əlifba sırası" },
    ].forEach((opt) => {
      const optBtn = button(opt.label, `archive-sort-option${opt.key === currentSort ? " is-selected" : ""}`, (e) => {
        e.stopPropagation();
        currentSort = opt.key;
        sortLabelSpan.textContent = opt.label;
        [...sortMenu.children].forEach((c) => c.classList.remove("is-selected"));
        optBtn.classList.add("is-selected");
        sortMenu.hidden = true;
        drawRows();
      });
      sortMenu.appendChild(optBtn);
    });

    sortBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const wasHidden = sortMenu.hidden;
      closeAllArchiveMenus();
      sortMenu.hidden = !wasHidden;
    });

    sortWrap.append(sortBtn, sortMenu);
    toolbar.append(tabs, sortWrap);

    const controlsSection = element("div", "archive-controls-section");
    controlsSection.append(toolbar);
    view.appendChild(controlsSection);

    // Floating compact bottom dock: Search + "Build something new" button
    const dock = element("div", "archive-bottom-dock");
    dock.setAttribute("role", "toolbar");
    dock.setAttribute("aria-label", isEn ? "Archive actions" : "Arxiv əməliyyatları");

    const searchWrap = element("div", "archive-dock-search-wrap");
    searchWrap.innerHTML = `<svg class="archive-dock-search-icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`;

    const search = element("input", "archive-search-input archive-dock-search-input");
    search.type = "search";
    search.placeholder = isEn ? "Search strategies…" : "Strategiyalarda axtar…";
    search.setAttribute("aria-label", isEn ? "Search strategies" : "Strategiyalarda axtar");
    searchWrap.appendChild(search);

    search.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && search.value) {
        e.stopPropagation();
        search.value = "";
        drawRows();
      }
    });

    dock.append(searchWrap);
    view.appendChild(dock);

    const list = element("div", "strategy-library");

    const drawRows = () => {
      const query = search.value.trim().toLocaleLowerCase(isEn ? "en" : "az");
      list.replaceChildren();

      // Render active background jobs seamlessly
      const matchingBgJobs = activeBgJobs.filter((job) => !query || `${job.brief || ""} ${job.strategy?.summary || ""}`.toLocaleLowerCase(isEn ? "en" : "az").includes(query));
      if (currentFilterKey !== "saved") {
        matchingBgJobs.forEach((job) => {
          const isGenerating = job.status === "generating";
          const isError = job.status === "error";
          const row = element("article", `strategy-library-row ${isGenerating ? "library-row-progress" : isError ? "library-row-error" : ""}`);
          row.setAttribute("role", "button");
          row.setAttribute("tabindex", "0");

          const briefTitle = job.brief ? (job.brief.length > 70 ? job.brief.slice(0, 70) + "…" : job.brief) : (isEn ? "New Strategy" : "Yeni Strategiya");
          const subtitle = isGenerating
            ? (isEn ? "Analyzing inputs and synthesizing strategic framework…" : "Məlumatlar analiz olunur və strateji plan formalaşdırılır…")
            : isError
              ? (job.error || (isEn ? "An error occurred during generation." : "Generasiya zamanı xəta baş verdi."))
              : (firstSentences(job.strategy?.summary || job.brief, 1));

          // Top Header (Title + Chevron)
          const rowHeader = element("div", "archive-row-header");
          rowHeader.append(
            element("h2", "archive-row-title", isGenerating ? briefTitle : (job.strategy?.title || briefTitle))
          );
          if (!isError) {
            const chevron = element("span", "archive-chevron-icon");
            chevron.innerHTML = `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>`;
            rowHeader.appendChild(chevron);
          }

          const descEl = element("p", "archive-row-desc", subtitle);

          // Footer (Date · Version + Status + Actions)
          const rowFooter = element("div", "archive-row-footer");
          const metaLine = element("div", "archive-row-meta-line");

          const dateVer = element("span", "archive-row-date-ver", `${isEn ? "Started " : "Başladı "}${formatArchiveDate(job.startedAt)} · ${isGenerating ? (isEn ? "Background" : "Arxa planda") : isError ? (isEn ? "Error" : "Xəta") : "v1"}`);
          const statusEl = element("div", `archive-row-status ${isGenerating ? "is-generating" : isError ? "is-error" : ""}`);
          const dot = element("span", "archive-status-dot");
          statusEl.append(dot, document.createTextNode(isGenerating ? (isEn ? "Generating" : "Hazırlanır") : isError ? (isEn ? "Error" : "Xəta") : (isEn ? "Ready" : "Hazırdır")));
          metaLine.append(dateVer, statusEl);

          const actionsWrap = element("div", "archive-row-actions");
          if (isError) {
            const retryBtn = button(isEn ? "Retry" : "Yoxla", "bg-job-retry-btn", (e) => {
              e.stopPropagation();
              job.status = "generating";
              job.error = null;
              persistBackgroundJobs();
              resumeBackgroundJobs();
              render();
            });
            const deleteBtn = button(isEn ? "Delete" : "Sil", "bg-job-delete-btn", (e) => {
              e.stopPropagation();
              removeBackgroundJob(job.id);
              render();
            });
            actionsWrap.append(retryBtn, deleteBtn);
          }

          rowFooter.append(metaLine, actionsWrap);
          row.append(rowHeader, descEl, rowFooter);

          if (!isError) {
            row.addEventListener("click", () => openBackgroundJob(job.id));
            row.addEventListener("keydown", (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                openBackgroundJob(job.id);
              }
            });
          }

          list.appendChild(row);
        });
      }

      let records = state.savedStrategies.filter((record) => !query || `${record.title} ${record.strategy?.summary || record.brief}`.toLocaleLowerCase(isEn ? "en" : "az").includes(query));

      if (currentFilterKey === "recent") {
        const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
        records = records.filter((r) => new Date(r.updatedAt || r.createdAt || 0).getTime() >= sevenDaysAgo);
      } else if (currentFilterKey === "saved") {
        records = records.filter((r) => Boolean(r.id));
      }

      // Sort
      records.sort((a, b) => {
        if (currentSort === "oldest") {
          return (a.updatedAt || a.createdAt || "").localeCompare(b.updatedAt || b.createdAt || "");
        }
        if (currentSort === "alphabetical") {
          return (a.title || "").localeCompare(b.title || "", isEn ? "en" : "az");
        }
        return (b.updatedAt || b.createdAt || "").localeCompare(a.updatedAt || a.createdAt || "");
      });

      if (!records.length && (!matchingBgJobs.length || currentFilterKey === "saved")) {
        const noRes = element("div", "archive-no-results");
        noRes.append(
          element("h3", "", isEn ? "No results found" : "Nəticə tapılmadı"),
          element("p", "", query
            ? (isEn ? `No strategies found matching “${search.value.trim()}”.` : `“${search.value.trim()}” üçün uyğun strategiya yoxdur.`)
            : (isEn ? "No strategies match this filter." : "Bu filter üçün uyğun strategiya yoxdur.")),
          button(isEn ? "Clear filters" : "Filterləri təmizlə", "archive-clear-filters-btn", () => {
            search.value = "";
            currentFilterKey = "all";
            [...tabs.children].forEach((item, i) => item.classList.toggle("is-active", i === 0));
            drawRows();
            search.focus();
          })
        );
        list.appendChild(noRes);
        return;
      }

      records.forEach((record) => {
        const row = element("article", "strategy-library-row");
        row.setAttribute("role", "button");
        row.setAttribute("tabindex", "0");
        row.setAttribute("aria-label", `${record.title}, ${formatArchiveDate(record.updatedAt)}`);

        row.addEventListener("click", () => openSavedStrategy(record.id));
        row.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            openSavedStrategy(record.id);
          }
        });

        // Top Header: Title + Chevron
        const rowHeader = element("div", "archive-row-header");
        const titleEl = element("h2", "archive-row-title", record.title);
        const chevron = element("span", "archive-chevron-icon");
        chevron.innerHTML = `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>`;
        rowHeader.append(titleEl, chevron);

        // Body: Description
        const descEl = element("p", "archive-row-desc", firstSentences(record.strategy?.summary || record.brief, 1));

        // Footer: Date · Version + Status + Context Menu
        const rowFooter = element("div", "archive-row-footer");
        const metaLine = element("div", "archive-row-meta-line");
        metaLine.setAttribute("title", `${formatDate(record.updatedAt)} · ${isEn ? "Version " : "Versiya "}${record.versionCount || 1}`);

        const dateVer = element("span", "archive-row-date-ver", `${formatArchiveDate(record.updatedAt)} · v${record.versionCount || 1}`);
        const status = element("div", "archive-row-status");
        const dot = element("span", "archive-status-dot");
        status.append(dot, document.createTextNode(isEn ? "Ready" : "Hazırdır"));
        metaLine.append(dateVer, status);

        const actionsWrap = element("div", "archive-row-actions");
        const moreBtn = button("", "archive-more-btn");
        moreBtn.setAttribute("aria-label", isEn ? "Strategy actions" : "Strategiya əməliyyatları");
        moreBtn.innerHTML = `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></svg>`;

        const contextMenu = createStrategyRowContextMenu(record);

        moreBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          const wasHidden = contextMenu.hidden;
          closeAllArchiveMenus();
          if (wasHidden) {
            contextMenu.hidden = false;
            moreBtn.classList.add("is-active");
          }
        });

        actionsWrap.append(moreBtn, contextMenu);
        rowFooter.append(metaLine, actionsWrap);

        row.append(rowHeader, descEl, rowFooter);
        list.appendChild(row);
      });
    };

    search.addEventListener("input", drawRows);
    drawRows();
    view.appendChild(list);
  }
  workspace.appendChild(view);
}

async function openSavedStrategy(id) {
  const epoch = state.identityEpoch;
  const expectedUserId = state.currentUser?.id || null;
  try {
    const data = await api(`/api/strategy/${id}`);
    if (epoch !== state.identityEpoch || (state.currentUser?.id || null) !== expectedUserId) return;
    const record = data.strategy;
    state.mode = "build";
    Object.assign(state, {
      view: "home",
      status: "saved",
      brief: record.brief,
      questions: [],
      clarificationIndex: 0,
      clarificationDrafts: {},
      answers: record.clarification?.answers || [],
      assumptions: record.strategy.assumptions,
      strategy: record.strategy,
      versions: record.versions,
      savedId: record.id,
      updatedAt: record.updatedAt,
      error: null,
      retry: null,
      changeSummary: "",
      strategyAskOpen: false,
      refinementOpen: false,
    });
    syncMode();
    render();
    closeSidebar();
  } catch (error) {
    if (epoch !== state.identityEpoch || (state.currentUser?.id || null) !== expectedUserId) return;
    showToast(error.message, "error");
  }
}

async function loadPlannerTasks() {
  if (!state.currentUser) {
    state.plannerTasks = [];
    updatePlannerBadge();
    return;
  }
  const epoch = state.identityEpoch;
  const expectedUserId = state.currentUser?.id || null;
  try {
    const data = await authRequest("/api/planner");
    if (epoch !== state.identityEpoch || (state.currentUser?.id || null) !== expectedUserId) return;
    state.plannerTasks = Array.isArray(data.tasks) ? data.tasks : [];
    updatePlannerBadge();
    checkAndShowPlannerVisitNotification();
    if (state.view === "planner") render();
  } catch (error) {
    console.error("Failed to load planner tasks:", error);
  }
}

function updatePlannerBadge() {
  if (plannerCount) {
    if (!state.currentUser) {
      plannerCount.style.display = "none";
      return;
    }
    plannerCount.style.display = "";
    const activeCount = state.plannerTasks.filter((t) => !t.completed).length;
    plannerCount.textContent = String(activeCount);
  }
}

function isPlannerNotificationsEnabled() {
  if (state.currentUser && state.currentUser.settings && typeof state.currentUser.settings.plannerNotifications === "boolean") {
    return state.currentUser.settings.plannerNotifications;
  }
  const localVal = localStorage.getItem("helmer_planner_notif_enabled");
  return localVal !== "false";
}

async function setPlannerNotificationsEnabled(enabled) {
  const isEn = getLanguage() === "en";
  localStorage.setItem("helmer_planner_notif_enabled", enabled ? "true" : "false");
  if (state.currentUser) {
    if (!state.currentUser.settings) state.currentUser.settings = {};
    state.currentUser.settings.plannerNotifications = enabled;
    try {
      await authRequest("/api/auth/settings", {
        method: "PATCH",
        body: JSON.stringify({ plannerNotifications: enabled }),
      });
    } catch (err) {
      console.error("Failed to update planner notification settings:", err);
    }
  }
  showToast(
    enabled
      ? (t("planner.notifEnabledToast") || (isEn ? "Planner notifications enabled" : "Planlaşdırılanlar bildirişləri aktiv edildi"))
      : (t("planner.notifDisabledToast") || (isEn ? "Planner notifications disabled" : "Planlaşdırılanlar bildirişləri deaktiv edildi")),
    "info"
  );
}

function isPlannerNotificationSnoozed() {
  const snoozeUntil = Number(localStorage.getItem("helmer_planner_snooze_until") || 0);
  return Date.now() < snoozeUntil;
}

function snoozePlannerNotification(hours = 2) {
  const isEn = getLanguage() === "en";
  const snoozeTime = Date.now() + hours * 60 * 60 * 1000;
  localStorage.setItem("helmer_planner_snooze_until", String(snoozeTime));
  showToast(
    t("planner.notifSnoozedToast") || (isEn ? "Reminder snoozed for 2 hours" : "Xatırlatma 2 saatlıq təxirə salındı"),
    "info"
  );
}

function getUrgentPlannerTasks() {
  if (!Array.isArray(state.plannerTasks)) return [];
  const urgentGroupLabels = new Set([
    "Bu gün",
    "Today",
    "Növbəti 48 saat",
    "Next 48 Hours",
    "Gecikmiş",
    "Overdue",
  ]);
  return state.plannerTasks.filter((t) => {
    if (t.completed) return false;
    const isPriority = Boolean(t.isPriority || t.priority === "high");
    const isDueSoon = Boolean(t.groupLabel && urgentGroupLabels.has(t.groupLabel));
    return isPriority || isDueSoon;
  });
}

function checkAndShowPlannerVisitNotification() {
  if (!isPlannerNotificationsEnabled()) return;
  if (isPlannerNotificationSnoozed()) return;
  if (sessionStorage.getItem("helmer_planner_visit_notif_shown") === "true") return;

  const urgentTasks = getUrgentPlannerTasks();
  if (!urgentTasks.length) return;

  sessionStorage.setItem("helmer_planner_visit_notif_shown", "true");

  const isEn = getLanguage() === "en";
  const rawName = getUserFirstName() || (isEn ? "Leader" : "Lider");

  document.querySelectorAll(".planner-visit-toast").forEach((el) => el.remove());

  const toast = element("div", "planner-visit-toast");
  toast.setAttribute("role", "alert");
  toast.setAttribute("aria-live", "polite");

  const topRow = element("div", "planner-visit-toast-top");
  const iconWrap = element("div", "planner-visit-toast-icon");
  iconWrap.innerHTML = `
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
      <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
    </svg>
  `;
  const titleWrap = element("div", "planner-visit-toast-title-wrap");
  const title = element("strong", "planner-visit-toast-title", isEn ? "Planner Reminder" : "Planlaşdırılanlar Xatırlatması");
  const taskCountBadge = element(
    "span",
    "planner-visit-toast-badge",
    isEn ? `${urgentTasks.length} pending` : `${urgentTasks.length} icra gözləyən`
  );
  titleWrap.append(title, taskCountBadge);

  const closeBtn = button("✕", "planner-visit-toast-close", () => {
    toast.remove();
  });
  closeBtn.type = "button";
  closeBtn.setAttribute("aria-label", isEn ? "Close" : "Bağla");

  topRow.append(iconWrap, titleWrap, closeBtn);

  const messageText = isEn
    ? `Hello, ${rawName}! You still have pending priority task(s) in Planner waiting for execution. Don't forget to review them.`
    : `Salam, ${rawName}! Planlaşdırılanlarda hələ də icra gözləyən prioritet tapşırıq(ların) mövcuddur. Nəzərdən keçirməyi unutma.`;

  const messageEl = element("p", "planner-visit-toast-message", messageText);

  const actionsRow = element("div", "planner-visit-toast-actions");

  const reviewBtn = button(
    t("planner.notifReviewTasks") || (isEn ? "Review tasks" : "Nəzərdən keçir"),
    "planner-visit-btn-review primary-button",
    () => {
      toast.remove();
      state.view = "planner";
      state.plannerFilter = "priority";
      syncNav();
      render();
    }
  );
  reviewBtn.type = "button";

  const remindLaterBtn = button(
    t("planner.notifRemindLater") || (isEn ? "Remind me later" : "Daha sonra xatırlat"),
    "planner-visit-btn-snooze secondary-button",
    () => {
      toast.remove();
      snoozePlannerNotification(2);
    }
  );
  remindLaterBtn.type = "button";

  actionsRow.append(reviewBtn, remindLaterBtn);

  const bottomRow = element("div", "planner-visit-toast-bottom");
  const disableBtn = button(
    t("planner.notifDeactivate") || (isEn ? "Turn off reminders" : "Bildirişləri deaktiv et"),
    "planner-visit-btn-disable",
    async () => {
      toast.remove();
      await setPlannerNotificationsEnabled(false);
    }
  );
  disableBtn.type = "button";
  bottomRow.appendChild(disableBtn);

  toast.append(topRow, messageEl, actionsRow, bottomRow);
  document.body.appendChild(toast);
}

function renderPlannerNotificationContent(container, closeFn) {
  const isEn = getLanguage() === "en";
  container.replaceChildren();

  const isEnabled = isPlannerNotificationsEnabled();
  if (!isEnabled) {
    const disabledCard = element("div", "planner-notif-empty-state");
    disabledCard.innerHTML = `
      <p>${escapeHtml(isEn ? "Priority task reminders are disabled." : "Prioritet tapşırıq xatırlatmaları deaktiv edilib.")}</p>
    `;
    container.appendChild(disabledCard);
    return;
  }

  const urgentTasks = getUrgentPlannerTasks();
  if (!urgentTasks.length) {
    const emptyState = element("div", "planner-notif-empty-state");
    emptyState.innerHTML = `
      <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="planner-notif-empty-icon">
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
        <polyline points="22 4 12 14.01 9 11.01"/>
      </svg>
      <strong>${escapeHtml(t("planner.notifAllCaughtUp") || (isEn ? "All caught up" : "Hər şey qaydasındadır"))}</strong>
      <p>${escapeHtml(t("planner.notifAllCaughtUpDesc") || (isEn ? "No pending priority tasks waiting for execution ✓" : "İcra gözləyən prioritet tapşırıq yoxdur ✓"))}</p>
    `;
    container.appendChild(emptyState);
    return;
  }

  const subhead = element(
    "div",
    "planner-notif-subhead",
    t("planner.notifWindowSubtitle") || (isEn ? "Pending priority tasks" : "İcra gözləyən prioritet tapşırıqlar")
  );
  container.appendChild(subhead);

  const list = element("div", "planner-notif-task-list");
  urgentTasks.slice(0, 6).forEach((task) => {
    const item = element("div", "planner-notif-task-item");
    const dot = element("span", "planner-notif-task-dot");
    const text = element("span", "planner-notif-task-text", task.text);
    const badge = element("span", "planner-notif-task-badge", task.groupLabel || (isEn ? "Priority" : "Prioritet"));
    item.append(dot, text, badge);
    item.addEventListener("click", () => {
      closeFn();
      state.plannerFilter = "priority";
      render();
    });
    list.appendChild(item);
  });
  container.appendChild(list);

  const actionButtons = element("div", "planner-notif-popover-actions");
  const viewAllBtn = button(
    isEn ? "View all priorities" : "Bütün prioritetlərə bax",
    "primary-button",
    () => {
      closeFn();
      state.plannerFilter = "priority";
      render();
    }
  );
  viewAllBtn.type = "button";

  const snoozeBtn = button(
    t("planner.notifRemindLater") || (isEn ? "Remind me later" : "Daha sonra xatırlat"),
    "secondary-button",
    () => {
      closeFn();
      snoozePlannerNotification(2);
    }
  );
  snoozeBtn.type = "button";

  actionButtons.append(viewAllBtn, snoozeBtn);
  container.appendChild(actionButtons);
}

function closePlannerNotificationSheet() {
  const overlay = document.querySelector("#mobileNotifSheetOverlay");
  const bellBtn = document.querySelector(".planner-notif-btn");
  if (bellBtn) bellBtn.classList.remove("is-active");
  if (!overlay || overlay.hidden || overlay.classList.contains("is-closing")) return;
  overlay.classList.remove("is-open");
  overlay.classList.add("is-closing");
  document.body.style.overflow = "";

  let cleanedUp = false;
  const finishClose = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    overlay.hidden = true;
    overlay.setAttribute("aria-hidden", "true");
    overlay.classList.remove("is-closing");
    overlay.replaceChildren();
  };

  const sheet = overlay.querySelector(".mobile-action-sheet");
  if (sheet) {
    sheet.addEventListener("transitionend", finishClose, { once: true });
  }
  setTimeout(finishClose, 260);
}

function openPlannerNotificationSheet(anchorBtn) {
  const overlay = document.querySelector("#mobileNotifSheetOverlay");
  if (!overlay) return;

  const isEn = getLanguage() === "en";

  if (!overlay.hidden && overlay.classList.contains("is-open")) {
    closePlannerNotificationSheet();
    return;
  }

  closeSidebar();
  closeMobileBottomSheet();
  closeMobileModelSheet();
  closeUserProfileMenu();

  if (anchorBtn) anchorBtn.classList.add("is-active");

  overlay.replaceChildren();
  overlay.hidden = false;
  overlay.setAttribute("aria-hidden", "false");
  overlay.classList.remove("is-closing");
  document.body.style.overflow = "hidden";

  const sheet = element("div", "mobile-action-sheet mobile-notif-sheet");
  sheet.setAttribute("role", "dialog");
  sheet.setAttribute("aria-modal", "true");
  sheet.setAttribute("aria-label", t("planner.notifications") || "Bildirişlər");

  // Drag area & handle
  const dragArea = element("div", "mobile-sheet-drag-area");
  dragArea.appendChild(element("div", "mobile-sheet-drag-handle"));

  // Sheet Header
  const header = element("header", "mobile-sheet-header mobile-notif-sheet-header");
  const title = element("h3", "mobile-sheet-title", t("planner.notifications") || (isEn ? "Notifications" : "Bildirişlər"));

  const headerActions = element("div", "mobile-notif-sheet-header-actions");

  // Reminders Switch Toggle
  const toggleWrap = element("div", "planner-notif-popover-toggle-wrap");
  const toggleLabel = element("span", "planner-notif-toggle-label", t("planner.notifRemindersActive") || (isEn ? "Reminders active" : "Xatırlatmalar"));
  const toggleBtn = element("button", `settings-toggle${isPlannerNotificationsEnabled() ? " is-active" : ""}`);
  toggleBtn.type = "button";
  toggleBtn.setAttribute("role", "switch");
  toggleBtn.setAttribute("aria-label", t("planner.notifRemindersActive") || (isEn ? "Reminders active" : "Xatırlatmalar"));
  toggleBtn.appendChild(element("span", "settings-toggle-thumb"));

  const body = element("div", "mobile-sheet-body mobile-notif-sheet-body");

  toggleBtn.addEventListener("click", async () => {
    const nextState = !isPlannerNotificationsEnabled();
    toggleBtn.classList.toggle("is-active", nextState);
    await setPlannerNotificationsEnabled(nextState);
    renderPlannerNotificationContent(body, closePlannerNotificationSheet);
  });
  toggleWrap.append(toggleLabel, toggleBtn);

  // Close button
  const closeBtn = button("✕", "mobile-sheet-close-btn", closePlannerNotificationSheet);
  closeBtn.type = "button";
  closeBtn.setAttribute("aria-label", t("common.close") || (isEn ? "Close" : "Bağla"));

  headerActions.append(toggleWrap, closeBtn);
  header.append(title, headerActions);

  renderPlannerNotificationContent(body, closePlannerNotificationSheet);

  sheet.append(dragArea, header, body);
  overlay.appendChild(sheet);

  attachSwipeDownToClose(sheet, closePlannerNotificationSheet);

  requestAnimationFrame(() => {
    overlay.classList.add("is-open");
  });
}

function togglePlannerNotificationPopover(anchorBtn) {
  const isEn = getLanguage() === "en";
  const isMobile = window.innerWidth <= 767;

  if (isMobile) {
    openPlannerNotificationSheet(anchorBtn);
    return;
  }

  const existing = document.querySelector(".planner-notif-popover");
  if (existing) {
    existing.remove();
    anchorBtn.classList.remove("is-active");
    return;
  }

  anchorBtn.classList.add("is-active");
  const popover = element("div", "planner-notif-popover");

  const header = element("div", "planner-notif-popover-header");
  const title = element("strong", "planner-notif-popover-title", t("planner.notifications") || (isEn ? "Notifications" : "Bildirişlər"));

  const toggleWrap = element("div", "planner-notif-popover-toggle-wrap");
  const toggleLabel = element("span", "planner-notif-toggle-label", t("planner.notifRemindersActive") || (isEn ? "Reminders active" : "Xatırlatmalar aktivdir"));
  const toggleBtn = element("button", `settings-toggle${isPlannerNotificationsEnabled() ? " is-active" : ""}`);
  toggleBtn.type = "button";
  toggleBtn.setAttribute("role", "switch");
  toggleBtn.setAttribute("aria-label", t("planner.notifRemindersActive") || (isEn ? "Reminders active" : "Xatırlatmalar"));
  toggleBtn.appendChild(element("span", "settings-toggle-thumb"));

  const body = element("div", "planner-notif-popover-body");

  const closePopover = () => {
    popover.remove();
    anchorBtn.classList.remove("is-active");
  };

  toggleBtn.addEventListener("click", async () => {
    const nextState = !isPlannerNotificationsEnabled();
    toggleBtn.classList.toggle("is-active", nextState);
    await setPlannerNotificationsEnabled(nextState);
    renderPlannerNotificationContent(body, closePopover);
  });
  toggleWrap.append(toggleLabel, toggleBtn);
  header.append(title, toggleWrap);

  renderPlannerNotificationContent(body, closePopover);
  popover.append(header, body);
  anchorBtn.parentElement.appendChild(popover);

  const closeOnOutside = (e) => {
    if (!popover.contains(e.target) && !anchorBtn.contains(e.target)) {
      closePopover();
      document.removeEventListener("click", closeOnOutside);
    }
  };
  setTimeout(() => document.addEventListener("click", closeOnOutside), 10);
}

function executePlannerTask(task) {
  if (!task) return;
  const isEn = getLanguage() === "en";

  setMode("ask");

  let matchedStrategy = null;
  if (task.strategyId) {
    matchedStrategy = state.savedStrategies.find((s) => s.id === task.strategyId) || null;
    state.askStrategyId = task.strategyId;
    state.askPromptHintStrategyId = task.strategyId;
  } else if (task.strategyTitle) {
    matchedStrategy = state.savedStrategies.find((s) => s.title === task.strategyTitle) || null;
    if (matchedStrategy) {
      state.askStrategyId = matchedStrategy.id;
      state.askPromptHintStrategyId = matchedStrategy.id;
    } else {
      state.askStrategyId = "";
      state.askPromptHintStrategyId = "";
    }
  } else {
    state.askStrategyId = "";
    state.askPromptHintStrategyId = "";
  }

  state.askTaskId = task.id || "";
  state.askChatId = null;
  state.askMessages = [];
  state.askError = "";

  const taskPrompt = isEn
    ? `How can I execute this task step-by-step: "${task.text}"? Provide a practical, concrete action plan.`
    : `"${task.text}" tapşırığını necə icra edə bilərəm? Mənə addım-addım konkret və praktiki icra planı təqdim et.`;
  state.askDraft = taskPrompt;

  render();

  requestAnimationFrame(() => {
    const askInput = document.querySelector("#askInput");
    if (askInput) {
      askInput.focus();
      try {
        askInput.setSelectionRange(askInput.value.length, askInput.value.length);
      } catch { }
    }
  });

  const toastMsg = matchedStrategy
    ? (isEn ? `Context loaded: ${matchedStrategy.title}` : `Strategiya konteksti yükləndi: ${matchedStrategy.title}`)
    : (isEn ? "Task context loaded" : "Tapşırıq kontekst kimi seçildi");
  showToast(toastMsg, "info");
}

function generateExecutionRoadmapForTasks(tasks, groupName = "") {
  if (!tasks || !tasks.length) return;
  const isEn = getLanguage() === "en";

  const primaryStrategyId = tasks.find((t) => t.strategyId)?.strategyId || "";
  let matchedStrategy = null;
  if (primaryStrategyId) {
    matchedStrategy = state.savedStrategies.find((s) => s.id === primaryStrategyId) || null;
    state.askStrategyId = primaryStrategyId;
    state.askPromptHintStrategyId = primaryStrategyId;
  } else {
    const primaryTitle = tasks.find((t) => t.strategyTitle)?.strategyTitle;
    if (primaryTitle) {
      matchedStrategy = state.savedStrategies.find((s) => s.title === primaryTitle) || null;
      if (matchedStrategy) {
        state.askStrategyId = matchedStrategy.id;
        state.askPromptHintStrategyId = matchedStrategy.id;
      } else {
        state.askStrategyId = "";
        state.askPromptHintStrategyId = "";
      }
    } else {
      state.askStrategyId = "";
      state.askPromptHintStrategyId = "";
    }
  }

  state.askTaskId = "";
  setMode("ask");
  state.askChatId = null;
  state.askMessages = [];
  state.askError = "";

  const taskListBullets = tasks.map((t, idx) => `${idx + 1}. ${t.text}`).join("\n");
  const groupLabel = groupName ? ` (${groupName})` : "";
  const roadmapPrompt = isEn
    ? `Prepare a detailed execution roadmap for the following planned tasks${groupLabel}:\n\n${taskListBullets}\n\nPlease format the execution roadmap with:\n1. Phased timeline & priority sequencing\n2. Detailed tactical execution steps per task\n3. Required resources, team ownership & marketing channels\n4. Risk analysis, bottlenecks & proactive solutions\n5. Measurable checkpoints and KPI targets`
    : `Aşağıdakı planlaşdırılan tapşırıqlar${groupLabel} üçün detallı icra xəritəsi hazırla:\n\n${taskListBullets}\n\nZəhmət olmasa icra xəritəsini aşağıdakı aydın strukturda təqdim et:\n1. Mərhələli icra qrafiki və prioritet ardıcıllığı\n2. Hər tapşırıq üzrə addım-addım konkret taktiki plan\n3. Lazımi resurslar, məsuliyyət bölgüsü və marketinq kanalları\n4. Gözlənilən risklər, potensial maneələr və qabaqlayıcı həllər\n5. Ölçülə bilən yoxlama nöqtələri və əsas KPI hədəfləri`;

  submitAskMessage(roadmapPrompt);
}

async function prioritizePlannerTasksWithLuna({ forceRefresh = false } = {}) {
  const isEn = getLanguage() === "en";
  if (!Array.isArray(state.plannerTasks) || state.plannerTasks.length === 0) {
    return [];
  }

  if (state.isPrioritizingPlanner) return state.plannerTasks;
  state.isPrioritizingPlanner = true;
  const epoch = state.identityEpoch;
  const expectedUserId = state.currentUser?.id || null;

  try {
    showToast(
      isEn
        ? "AI is analyzing tasks to isolate priorities…"
        : "Tapşırıqlar təhlil edilir və prioritetlər ayrılır…",
      "info"
    );

    const activeTasks = state.plannerTasks.filter((t) => !t.completed);
    const targetTaskIds = (activeTasks.length > 0 ? activeTasks : state.plannerTasks).map((t) => t.id);

    const res = await authRequest("/api/planner/prioritize", {
      method: "POST",
      body: JSON.stringify({
        taskIds: targetTaskIds,
        language: isEn ? "en" : "az",
      }),
    });

    if (isIdentityStale(epoch, expectedUserId)) return state.plannerTasks;

    if (res && Array.isArray(res.tasks)) {
      state.plannerTasks = res.tasks;
      updatePlannerBadge();
      const count = res.count !== undefined ? res.count : state.plannerTasks.filter((t) => t.isPriority || t.priority === "high").length;
      showToast(
        isEn
          ? `Separated ${count} priority task${count === 1 ? "" : "s"} ✓`
          : `${count} prioritet tapşırıq ayrıldı ✓`,
        "success"
      );
    }
    return state.plannerTasks;
  } catch (err) {
    if (isIdentityStale(epoch, expectedUserId)) return state.plannerTasks;
    console.error("Planner prioritization failed:", err);
    showToast(
      err.message || (isEn ? "Failed to prioritize tasks" : "Prioritetləri ayırmaq mümkün olmadı"),
      "error"
    );
    return state.plannerTasks;
  } finally {
    if (!isIdentityStale(epoch, expectedUserId)) {
      state.isPrioritizingPlanner = false;
    }
  }
}

function renderPlannerView() {
  const isEn = getLanguage() === "en";
  workspace.classList.add("workspace-list");
  workspace.replaceChildren();

  const view = element("section", "planner-view");

  // Workspace header
  const headerRow = element("header", "planner-header-row");
  const headerText = element("div", "planner-header-text");
  headerText.append(
    element("span", "section-kicker", isEn ? "Workspace" : "İş sahəsi"),
    element("h1", "", t("planner.title")),
    element("p", "", isEn ? "Turn strategic intent into your next move." : "Strategiyanı konkret icra addımlarına çevir.")
  );

  const headerActions = element("div", "planner-header-actions");
  const switchEl = renderArchivePlannerSwitch("planner");
  const notifBtn = button("", "planner-notif-btn", (e) => {
    e.stopPropagation();
    togglePlannerNotificationPopover(notifBtn);
  });
  notifBtn.type = "button";
  notifBtn.setAttribute("aria-label", t("planner.notifications") || (isEn ? "Notifications" : "Bildirişlər"));
  notifBtn.setAttribute("title", t("planner.notificationsTooltip") || (isEn ? "Planner notifications" : "Planlaşdırılanlar bildirişləri"));
  notifBtn.innerHTML = `
    <svg class="planner-notif-bell-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
      <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
    </svg>
  `;
  const urgentTasks = getUrgentPlannerTasks();
  if (urgentTasks.length > 0) {
    const badge = element("span", "planner-notif-badge");
    badge.textContent = urgentTasks.length > 9 ? "9+" : String(urgentTasks.length);
    notifBtn.appendChild(badge);
  }
  headerActions.append(switchEl, notifBtn);

  headerRow.append(headerText, headerActions);
  view.appendChild(headerRow);

  if (!state.currentUser) {
    const locked = element("div", "archive-guest-locked-card");
    locked.innerHTML = `
      <div class="archive-guest-locked-icon">
        <svg viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m9 11 3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
      </div>
      <h2 class="archive-guest-locked-title">${isEn ? "Registration Required" : "Qeydiyyat Tələb Olunur"}</h2>
      <p class="archive-guest-locked-text">${escapeHtml(getGuestRestrictionNotice(GUEST_RESTRICTION_NOTICES.planner, isEn))}</p>
      <a href="/signup?returnTo=${encodeURIComponent(location.pathname + location.search + location.hash)}" class="archive-guest-locked-btn">${isEn ? "Sign Up" : "Qeydiyyatdan keç"}</a>
    `;
    view.appendChild(locked);
    workspace.appendChild(view);
    return;
  }

  const overview = element("div", "planner-overview");
  overview.setAttribute("aria-label", isEn ? "Execution overview" : "İcra göstəriciləri");

  const capture = element("section", "planner-capture");
  capture.setAttribute("aria-labelledby", "planner-capture-title");
  const captureTitle = element("h2", "planner-capture-title");
  captureTitle.id = "planner-capture-title";
  const captureContext = element("p", "planner-capture-context");
  capture.append(captureTitle, overview, captureContext);
  view.appendChild(capture);

  // Inline capture keeps planning and execution in the same workspace.
  const composer = element("form", "planner-composer-card");
  const taskInput = element("input", "planner-composer-input");
  taskInput.type = "text";
  taskInput.placeholder = isEn ? "Ask Helmer to add anything" : "Helmer-dən istədiyini əlavə etməsini istə";
  taskInput.required = true;
  taskInput.setAttribute("aria-label", isEn ? "New task" : "Yeni tapşırıq");

  const composerBottom = element("div", "planner-composer-bottom");

  const plannerGroupOptions = isEn ? [
    "Today",
    "Next 48 Hours",
    "Next 72 Hours",
    "Next 7 Days",
    "Next 14 Days",
    "Next 30 Days",
    "Next 60 Days",
    "General Tasks",
  ] : [
    "Bu gün",
    "Növbəti 48 saat",
    "Növbəti 72 saat",
    "Növbəti 7 gün",
    "Növbəti 14 gün",
    "Növbəti 30 gün",
    "Növbəti 60 gün",
    "Ümumi",
  ];

  const selectPill = element("div", "planner-time-select-pill");
  const selectLabel = element("span", "planner-select-label", plannerGroupOptions[0]);
  const groupSelect = document.createElement("select");
  groupSelect.className = "planner-select-native";
  groupSelect.setAttribute("aria-label", isEn ? "Task timeframe" : "Tapşırığın zaman aralığı");
  plannerGroupOptions.forEach((opt) => {
    const option = document.createElement("option");
    option.value = opt;
    option.textContent = opt;
    groupSelect.appendChild(option);
  });
  groupSelect.addEventListener("change", () => {
    selectLabel.textContent = groupSelect.value;
  });

  selectPill.innerHTML = `
    <svg class="planner-cal-icon" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="3"/>
      <line x1="16" y1="2" x2="16" y2="6"/>
      <line x1="8" y1="2" x2="8" y2="6"/>
      <line x1="3" y1="10" x2="21" y2="10"/>
    </svg>
  `;
  selectPill.appendChild(selectLabel);
  selectPill.appendChild(groupSelect);

  const chevronSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  chevronSvg.setAttribute("class", "planner-chevron-icon");
  chevronSvg.setAttribute("viewBox", "0 0 24 24");
  chevronSvg.setAttribute("width", "12");
  chevronSvg.setAttribute("height", "12");
  chevronSvg.setAttribute("fill", "none");
  chevronSvg.setAttribute("stroke", "currentColor");
  chevronSvg.setAttribute("stroke-width", "2");
  chevronSvg.setAttribute("stroke-linecap", "round");
  chevronSvg.setAttribute("stroke-linejoin", "round");
  chevronSvg.innerHTML = `<polyline points="6 9 12 15 18 9"/>`;
  selectPill.appendChild(chevronSvg);

  const submitBtn = button("", "planner-submit-btn");
  submitBtn.type = "submit";
  submitBtn.setAttribute("aria-label", isEn ? "Add task" : "Tapşırığı əlavə et");
  submitBtn.innerHTML = `
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M12 19V5"/><path d="m6 11 6-6 6 6"/>
    </svg>
  `;

  composerBottom.append(selectPill, submitBtn);
  composer.append(taskInput, composerBottom);

  composer.addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = taskInput.value.trim();
    if (!text) return;
    submitBtn.disabled = true;
    const epoch = state.identityEpoch;
    const expectedUserId = state.currentUser?.id || null;
    try {
      const res = await authRequest("/api/planner", {
        method: "POST",
        body: JSON.stringify({
          text,
          groupLabel: groupSelect.value,
          isPriority: state.plannerFilter === "priority",
          priority: state.plannerFilter === "priority" ? "high" : "normal",
        }),
      });
      if (isIdentityStale(epoch, expectedUserId)) return;
      if (res.task) {
        state.plannerTasks.unshift(res.task);
        updatePlannerBadge();
        taskInput.value = "";
        drawPlannerList();
        showToast(isEn ? "Task added ✓" : "Tapşırıq əlavə edildi ✓", "success");
      }
    } catch (err) {
      if (isIdentityStale(epoch, expectedUserId)) return;
      showToast(err.message || (isEn ? "An error occurred" : "Xəta baş verdi"), "error");
    } finally {
      if (!isIdentityStale(epoch, expectedUserId)) submitBtn.disabled = false;
    }
  });
  capture.appendChild(composer);

  // Lightweight search and filter toolbar
  const toolbar = element("div", "planner-toolbar");
  const searchBar = element("div", "planner-search-bar");
  searchBar.hidden = true;
  const searchToggle = button("", "planner-search-toggle");
  searchToggle.setAttribute("aria-label", isEn ? "Search tasks" : "Tapşırıqlarda axtar");
  searchToggle.setAttribute("aria-expanded", "false");
  searchToggle.setAttribute("aria-controls", "planner-search-input");
  searchToggle.innerHTML = `
    <svg class="planner-search-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="11" cy="11" r="8"/>
      <line x1="21" y1="21" x2="16.65" y2="16.65"/>
    </svg>
  `;
  const searchInput = element("input", "planner-search-input");
  searchInput.type = "search";
  searchInput.id = "planner-search-input";
  searchInput.hidden = true;
  searchInput.placeholder = isEn ? "Search tasks…" : "Tapşırıqlarda axtar…";
  searchInput.setAttribute("aria-label", isEn ? "Search tasks" : "Tapşırıqlarda axtar");
  searchBar.append(searchToggle.querySelector("svg").cloneNode(true), searchInput);
  headerActions.append(searchToggle, searchBar);
  const setSearchOpen = (open) => {
    searchBar.hidden = !open;
    searchBar.classList.toggle("is-open", open);
    searchToggle.setAttribute("aria-expanded", String(open));
    searchToggle.replaceChildren();
    if (open) {
      const closeIcon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      closeIcon.setAttribute("viewBox", "0 0 24 24");
      closeIcon.setAttribute("width", "18");
      closeIcon.setAttribute("height", "18");
      closeIcon.setAttribute("fill", "none");
      closeIcon.setAttribute("stroke", "currentColor");
      closeIcon.setAttribute("stroke-width", "1.8");
      closeIcon.setAttribute("stroke-linecap", "round");
      closeIcon.setAttribute("aria-hidden", "true");
      const cross = document.createElementNS("http://www.w3.org/2000/svg", "path");
      cross.setAttribute("d", "M6 6l12 12M18 6 6 18");
      closeIcon.appendChild(cross);
      searchToggle.appendChild(closeIcon);
    } else {
      searchToggle.appendChild(searchBar.querySelector("svg").cloneNode(true));
    }
    searchToggle.setAttribute("aria-label", open ? (isEn ? "Close search" : "Axtarışı bağla") : (isEn ? "Search tasks" : "Tapşırıqlarda axtar"));
    searchInput.hidden = !open;
    if (open) searchInput.focus({ preventScroll: true });
    else {
      searchInput.value = "";
      drawPlannerList();
      searchToggle.focus({ preventScroll: true });
    }
  };
  searchToggle.addEventListener("click", () => setSearchOpen(searchInput.hidden));
  searchBar.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !searchInput.hidden) {
      event.preventDefault();
      setSearchOpen(false);
    }
  });
  const filterRow = element("div", "planner-filter-row");
  const filterPills = element("div", "planner-filter-pills");
  const filterOptions = [
    { key: "active", label: isEn ? "Active" : "Aktiv" },
    { key: "completed", label: isEn ? "Completed" : "Tamamlanmış" },
    { key: "priority", label: t("planner.filterPriority") || (isEn ? "Priority" : "Prioritet") },
    { key: "archive", label: isEn ? "Archive" : "Arxiv" },
  ];
  filterOptions.forEach((opt) => {
    const btn = element(
      "button",
      `planner-filter-pill${state.plannerFilter === opt.key ? " is-active" : ""}${opt.isNew ? " is-priority-pill" : ""}`
    );
    btn.type = "button";
    const labelSpan = element("span", "planner-filter-pill-label", opt.label);
    btn.appendChild(labelSpan);
    btn.setAttribute("aria-pressed", String(state.plannerFilter === opt.key));
    btn.addEventListener("click", async () => {
      const epoch = state.identityEpoch;
      const expectedUserId = state.currentUser?.id || null;
      state.plannerFilter = opt.key;
      [...filterPills.children].forEach((b) => {
        b.classList.remove("is-active");
        b.setAttribute("aria-pressed", "false");
      });
      btn.setAttribute("aria-pressed", "true");
      btn.classList.add("is-active");

      if (opt.key === "priority") {
        const hasPriority = state.plannerTasks.some((t) => t.isPriority || t.priority === "high");
        if (!hasPriority && state.plannerTasks.length > 0) {
          await prioritizePlannerTasksWithLuna();
        }
      }
      if (isIdentityStale(epoch, expectedUserId)) return;
      drawPlannerList();
    });
    filterPills.appendChild(btn);
  });
  filterRow.appendChild(filterPills);
  toolbar.appendChild(filterRow);
  view.appendChild(toolbar);

  const listContainer = element("div", "planner-tasks-container");
  view.appendChild(listContainer);

  const floatingBar = element("div", "planner-floating-actions");
  const floatingContent = element("div", "planner-floating-content");
  const floatingCount = element("span", "planner-floating-count", "");
  const floatingRoadmapBtn = button("", "planner-floating-roadmap-btn", () => {
    const selectedTasks = state.plannerTasks.filter((t) => state.plannerSelectedTaskIds.has(t.id));
    generateExecutionRoadmapForTasks(selectedTasks);
  });
  floatingRoadmapBtn.type = "button";
  floatingRoadmapBtn.innerHTML = `
    <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">
      <path d="M13 2L3 14h7v8l10-12h-7z"/>
    </svg>
    <span>${t("planner.generateRoadmap") || (isEn ? "Prepare execution map" : "İcra xəritəsi hazırla")}</span>
  `;
  const floatingClearBtn = button("✕", "planner-floating-clear-btn", () => {
    state.plannerSelectedTaskIds.clear();
    drawPlannerList();
  });
  floatingClearBtn.type = "button";
  floatingClearBtn.setAttribute("aria-label", t("planner.deselectAll") || (isEn ? "Clear selection" : "Seçimi təmizlə"));
  floatingClearBtn.setAttribute("title", t("planner.deselectAll") || (isEn ? "Clear selection" : "Seçimi təmizlə"));

  floatingContent.append(floatingCount, floatingRoadmapBtn, floatingClearBtn);
  floatingBar.appendChild(floatingContent);
  view.appendChild(floatingBar);

  const drawPlannerList = () => {
    overview.replaceChildren();
    const allTasks = state.plannerTasks;
    const doneCount = allTasks.filter((task) => task.completed).length;
    const priorityCount = allTasks.filter((task) => !task.completed && (task.isPriority || task.priority === "high")).length;
    // Use the full owner-scoped task collection, never the current filter/search.
    const activeCount = allTasks.length - doneCount;
    const firstName = getUserFirstName();
    const greeting = firstName ? `${firstName}, ` : "";
    if (priorityCount > 0) {
      captureTitle.textContent = isEn
        ? `${greeting}${firstName ? "what" : "What"} are we focusing on today?`
        : `${greeting}${firstName ? "bu" : "Bu"} gün nəyə fokuslanırıq?`;
      captureContext.textContent = isEn
        ? `${priorityCount} high-priority step${priorityCount === 1 ? "" : "s"} to focus on. Make room for the next move.`
        : `${priorityCount} yüksək prioritetli addım diqqətini gözləyir. Növbəti addımını planlaşdır.`;
    } else if (activeCount > 0) {
      captureTitle.textContent = isEn
        ? `${greeting}${firstName ? "what’s" : "What’s"} on your plan today?`
        : `${greeting}${firstName ? "bu" : "Bu"} gün planında nə var?`;
      captureContext.textContent = isEn
        ? `${activeCount} active step${activeCount === 1 ? "" : "s"} in your plan. Give your next idea a clear action.`
        : `Planında ${activeCount} aktiv addım var. Növbəti ideyanı konkret tapşırığa çevir.`;
    } else if (doneCount > 0) {
      captureTitle.textContent = isEn
        ? `${greeting}${firstName ? "what’s" : "What’s"} your next goal?`
        : `${greeting}${firstName ? "növbəti" : "Növbəti"} hədəfin nədir?`;
      captureContext.textContent = isEn
        ? `All ${doneCount} step${doneCount === 1 ? " is" : "s are"} complete. Plan the first step toward your next goal.`
        : `${doneCount} addımın hamısı tamamlanıb. Yeni hədəfin üçün ilk addımı planlaşdır.`;
    } else {
      captureTitle.textContent = isEn
        ? `${greeting}${firstName ? "ready" : "Ready"} to bring a new idea to life?`
        : `${greeting}${firstName ? "yeni" : "Yeni"} bir ideyanı həyata keçirməyə hazırsan?`;
      captureContext.textContent = isEn
        ? "Every strategy starts with one concrete step. Add yours below."
        : "Hər strategiya bir konkret addımla başlayır. İlk tapşırığını əlavə et.";
    }
    const percent = allTasks.length ? Math.round(doneCount / allTasks.length * 100) : 0;
    const progressPanel = element("div", "planner-progress-panel");
    const progressHeading = element("div", "planner-progress-heading");
    progressHeading.append(element("span", "planner-eyebrow", isEn ? "EXECUTION PULSE" : "İCRA RİTMİ"), element("strong", "planner-progress-percent", `${percent}%`));
    const progress = element("div", "planner-progress-track");
    progress.setAttribute("role", "progressbar");
    progress.setAttribute("aria-label", isEn ? "Task completion" : "Tapşırıqların tamamlanması");
    progress.setAttribute("aria-valuemin", "0");
    progress.setAttribute("aria-valuemax", "100");
    progress.setAttribute("aria-valuenow", String(percent));
    const fill = element("span", "planner-progress-fill");
    fill.style.width = `${percent}%`;
    progress.appendChild(fill);
    progressPanel.append(progressHeading, progress, element("span", "planner-progress-caption", isEn ? `${doneCount} of ${allTasks.length} steps completed` : `${allTasks.length} addımdan ${doneCount}-i tamamlanıb`));
    overview.appendChild(progressPanel);
    [[allTasks.length - doneCount, isEn ? "Active" : "Aktiv"], [priorityCount, isEn ? "Priority" : "Prioritet"], [doneCount, isEn ? "Completed" : "Tamamlanıb"]].forEach(([count, label]) => {
      const metric = element("div", "planner-metric");
      metric.append(element("strong", "planner-metric-value", String(count)), element("span", "planner-metric-label", label));
      overview.appendChild(metric);
    });
    const query = searchInput.value.trim().toLocaleLowerCase(isEn ? "en" : "az");
    let tasks = state.plannerTasks;

    if (state.plannerFilter === "active") tasks = tasks.filter((t) => !t.completed);
    else if (state.plannerFilter === "completed") tasks = tasks.filter((t) => t.completed);
    else if (state.plannerFilter === "priority") tasks = tasks.filter((t) => Boolean(t.isPriority || t.priority === "high"));

    if (query) {
      tasks = tasks.filter((t) =>
        t.text.toLocaleLowerCase(isEn ? "en" : "az").includes(query) ||
        (t.strategyTitle && t.strategyTitle.toLocaleLowerCase(isEn ? "en" : "az").includes(query)) ||
        (t.groupLabel && t.groupLabel.toLocaleLowerCase(isEn ? "en" : "az").includes(query))
      );
    }

    listContainer.replaceChildren();

    // If in Priority filter, render top AI Banner
    if (state.plannerFilter === "priority" && tasks.length) {
      const banner = element("div", "planner-priority-ai-banner");
      const bannerLeft = element("div", "planner-priority-banner-left");
      const bannerTitle = element("h3", "planner-priority-banner-title", t("planner.priorityBannerTitle") || (isEn ? "Priorities classified by AI" : "AI ilə ayrılmış prioritetlər"));
      const bannerDesc = element("p", "planner-priority-banner-desc", t("planner.priorityBannerSubtitle") || (isEn ? "High-leverage tasks isolated for immediate breakthrough and execution." : "Biznesin inkişafı və kritik icra üçün ən yüksək təsirə malik tapşırıqlar."));
      bannerLeft.append(bannerTitle, bannerDesc);

      const reprioritizeBtn = button("", "planner-reprioritize-btn", async () => {
        reprioritizeBtn.disabled = true;
        reprioritizeBtn.classList.add("is-loading");
        const epoch = state.identityEpoch;
        const expectedUserId = state.currentUser?.id || null;
        await prioritizePlannerTasksWithLuna({ forceRefresh: true });
        if (isIdentityStale(epoch, expectedUserId)) return;
        drawPlannerList();
      });
      reprioritizeBtn.type = "button";
      reprioritizeBtn.innerHTML = `
        <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <polyline points="23 4 23 10 17 10"/>
          <polyline points="1 20 1 14 7 14"/>
          <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
        </svg>
        <span>${t("planner.reprioritizeWithLuna") || (isEn ? "Re-prioritize" : "Yenidən ayır")}</span>
      `;

      banner.append(bannerLeft, reprioritizeBtn);
      listContainer.appendChild(banner);
    }

    if (!tasks.length) {
      const empty = element("div", "planner-empty-state");
      if (state.plannerFilter === "priority") {
        empty.append(
          element("h2", "", t("planner.noPriorityTasks") || (isEn ? "No priority tasks yet" : "Hələ prioritet tapşırıq yoxdur")),
          element("p", "", t("planner.noPriorityDesc") || (isEn ? "Run the AI model to automatically isolate your high-impact strategic tasks." : "Tapşırıqlarınızdan yüksək təsirli olanları avtomatik ayırmaq üçün AI modelini işə salın."))
        );
        const prioritizeNowBtn = button("", "planner-priority-action-btn", async () => {
          prioritizeNowBtn.disabled = true;
          const epoch = state.identityEpoch;
          const expectedUserId = state.currentUser?.id || null;
          await prioritizePlannerTasksWithLuna({ forceRefresh: true });
          if (isIdentityStale(epoch, expectedUserId)) return;
          drawPlannerList();
        });
        prioritizeNowBtn.type = "button";
        prioritizeNowBtn.innerHTML = `
          <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">
            <path d="M12 2l2.4 7.4H22l-6 4.6 2.3 7.2-6.3-4.6-6.3 4.6 2.3-7.2-6-4.6h7.6z"/>
          </svg>
          <span>${t("planner.prioritizeBtn") || (isEn ? "Prioritize tasks" : "Prioritetləri ayır")}</span>
        `;
        empty.appendChild(prioritizeNowBtn);
      } else {
        empty.append(
          element("h2", "", isEn ? "No tasks found" : "Tapşırıq tapılmadı"),
          element("p", "", isEn ? "Change the filter or add a new task." : "Filteri dəyiş və ya yeni tapşırıq əlavə et.")
        );
      }
      listContainer.appendChild(empty);
      floatingBar.classList.remove("is-visible");
      return;
    }

    // Group by groupLabel
    const groupOrder = isEn ? [
      "Overdue",
      "Today",
      "Next 48 hours",
      "Next 72 hours",
      "Next 7 days",
      "This week",
      "Next 14 days",
      "Next 30 days",
      "Next 60 days",
      "General",
      "Completed",
    ] : [
      "Gecikmiş",
      "Bu gün",
      "Növbəti 48 saat",
      "Növbəti 72 saat",
      "Növbəti 7 gün",
      "Bu həftə",
      "Növbəti 14 gün",
      "Növbəti 30 gün",
      "Növbəti 60 gün",
      "Ümumi",
      "Tamamlanmış",
    ];
    const localizePlannerGroup = (label) => {
      if (!label) return isEn ? "General" : "Ümumi";
      const raw = String(label).trim().toLowerCase();
      if (raw === "overdue" || raw === "gecikmiş") return isEn ? "Overdue" : "Gecikmiş";
      if (raw === "bu gün" || raw === "today") return isEn ? "Today" : "Bu gün";
      if (raw === "növbəti 48 saat" || raw === "next 48 hours") return isEn ? "Next 48 hours" : "Növbəti 48 saat";
      if (raw === "növbəti 72 saat" || raw === "next 72 hours") return isEn ? "Next 72 hours" : "Növbəti 72 saat";
      if (raw === "növbəti 7 gün" || raw === "next 7 days") return isEn ? "Next 7 days" : "Növbəti 7 gün";
      if (raw === "bu həftə" || raw === "this week") return isEn ? "This week" : "Bu həftə";
      if (raw === "növbəti 14 gün" || raw === "next 14 days") return isEn ? "Next 14 days" : "Növbəti 14 gün";
      if (raw === "növbəti 30 gün" || raw === "next 30 days") return isEn ? "Next 30 days" : "Növbəti 30 gün";
      if (raw === "növbəti 60 gün" || raw === "next 60 days") return isEn ? "Next 60 days" : "Növbəti 60 gün";
      if (raw === "ümumi" || raw === "general" || raw === "general tasks") return isEn ? "General" : "Ümumi";
      return label;
    };
    // Relative planning windows are anchored to creation, never to each page visit.
    // General/custom windows and missing/invalid timestamps have no inferred deadline.
    const isTaskOverdue = (task) => {
      if (task.completed) return false;
      const label = localizePlannerGroup(task.groupLabel || task.timeframe);
      if (label === "Overdue" || label === "Gecikmiş") return true;
      const created = new Date(task.createdAt);
      if (!task.createdAt || !Number.isFinite(created.getTime())) return false;
      if (label === "Today" || label === "Bu gün") {
        created.setHours(23, 59, 59, 999);
      } else if (label === "This week" || label === "Bu həftə") {
        created.setDate(created.getDate() + (7 - created.getDay()) % 7);
        created.setHours(23, 59, 59, 999);
      } else {
        const raw = String(task.groupLabel || task.timeframe || "").trim().toLowerCase();
        const hours = /^(?:next|növbəti) (48|72) (?:hours|saat)$/.exec(raw);
        const days = /^(?:next|növbəti) (7|14|30|60) (?:days|gün)$/.exec(raw);
        if (hours) created.setTime(created.getTime() + Number(hours[1]) * 60 * 60 * 1000);
        else if (days) created.setDate(created.getDate() + Number(days[1]));
        else return false;
      }
      return Date.now() > created.getTime();
    };
    const completedName = isEn ? "Completed" : "Tamamlanmış";
    const overdueName = isEn ? "Overdue" : "Gecikmiş";
    const spotlightName = isEn ? "Priority Spotlight" : "Prioritet fokus";
    const groups = Object.create(null);
    tasks.forEach((task) => {
      const g = task.completed ? completedName
        : (task.isPriority || task.priority === "high") ? spotlightName
        : isTaskOverdue(task) ? overdueName : localizePlannerGroup(task.groupLabel || task.timeframe);
      if (!groups[g]) groups[g] = [];
      groups[g].push(task);
    });

    const sortedGroupNames = Object.keys(groups).sort((a, b) => {
      if (a === spotlightName) return -1;
      if (b === spotlightName) return 1;
      const aActive = groups[a].some((task) => !task.completed);
      const bActive = groups[b].some((task) => !task.completed);
      if (aActive !== bActive) return aActive ? -1 : 1;
      const ia = groupOrder.indexOf(a);
      const ib = groupOrder.indexOf(b);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    });

    const allRenderedTaskCards = [];
    const groupActionUpdaters = [];

    const updateSelectionUi = () => {
      // Completed tasks cannot be selected
      state.plannerSelectedTaskIds.forEach((id) => {
        const found = state.plannerTasks.find((t) => t.id === id);
        if (found && found.completed) {
          state.plannerSelectedTaskIds.delete(id);
        }
      });

      allRenderedTaskCards.forEach(({ task, card }) => {
        const isSelected = !task.completed && state.plannerSelectedTaskIds.has(task.id);
        card.classList.toggle("is-selected", isSelected);
      });

      groupActionUpdaters.forEach((updater) => updater());

      const totalSelected = state.plannerSelectedTaskIds.size;
      const hasSelection = totalSelected > 0;
      view.classList.toggle("has-selection", hasSelection);
      searchBar.classList.toggle("is-hidden-by-selection", hasSelection);
      composer.classList.toggle("is-hidden-by-selection", hasSelection);
      floatingBar.classList.toggle("is-visible", hasSelection);
      floatingCount.textContent = isEn
        ? `${totalSelected} task${totalSelected > 1 ? "s" : ""} selected`
        : `${totalSelected} tapşırıq seçildi`;
    };

    sortedGroupNames.forEach((groupName) => {
      const groupTasks = groups[groupName];
      if (!groupTasks.length) return;

      const isSpotlight = groupName === spotlightName;
      const groupEl = element("section", `planner-group${isSpotlight ? " planner-spotlight" : ""}`);
      const isCollapsible = groupName === "Ümumi" || groupName === "General";
      const isCollapsed = isCollapsible && state.plannerCollapsedGroups.has(groupName);

      const groupHeader = element("div", "planner-group-header");
      const activeCount = groupTasks.filter((t) => !t.completed).length;

      const groupTitle = isCollapsible
        ? button("", "planner-group-title is-collapsible-trigger")
        : element("div", "planner-group-title");

      groupTitle.append(
        element("h3", "planner-group-name", groupName),
        element("span", "planner-group-badge", groupName === completedName
          ? `${groupTasks.length} ${isEn ? "completed" : "tamamlanıb"}`
          : `${activeCount} ${isEn ? "Active" : "aktiv"}`)
      );

      if (isCollapsible) {
        groupTitle.setAttribute("aria-expanded", String(!isCollapsed));
        groupTitle.setAttribute(
          "aria-label",
          isEn
            ? `${isCollapsed ? "Expand" : "Collapse"} general tasks`
            : `Ümumi tapşırıqları ${isCollapsed ? "aç" : "bağla"}`
        );
        groupTitle.insertAdjacentHTML(
          "beforeend",
          `
          <svg class="planner-group-chevron" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        `
        );
        if (isCollapsed) groupTitle.classList.add("is-collapsed");
        groupTitle.addEventListener("click", () => {
          if (state.plannerCollapsedGroups.has(groupName)) state.plannerCollapsedGroups.delete(groupName);
          else state.plannerCollapsedGroups.add(groupName);
          drawPlannerList();
        });
      }
      groupHeader.appendChild(groupTitle);

      const groupActions = element("div", "planner-group-actions");

      // "İcra xəritəsi hazırla" button (appears when any task in this category is selected)
      const groupRoadmapBtn = button("", "planner-roadmap-btn", (e) => {
        e.stopPropagation();
        const selectedInGroup = groupTasks.filter((t) => state.plannerSelectedTaskIds.has(t.id));
        const tasksToUse = selectedInGroup.length > 0 ? selectedInGroup : groupTasks;
        generateExecutionRoadmapForTasks(tasksToUse, groupName);
      });
      groupRoadmapBtn.type = "button";
      groupRoadmapBtn.style.display = "none";
      groupRoadmapBtn.innerHTML = `
        <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor" aria-hidden="true">
          <path d="M13 2L3 14h7v8l10-12h-7z"/>
        </svg>
        <span class="planner-roadmap-btn-label">${t("planner.generateRoadmap") || (isEn ? "Prepare execution map" : "İcra xəritəsi hazırla")}</span>
      `;

      // "Hamısını seç" button (Tamamlanmış tasklardan Select all yığışdırılır, yalnız aktiv tasklar seçilir)
      const selectAllBtn = button("", "planner-select-all-btn", (e) => {
        e.stopPropagation();
        const activeTasks = groupTasks.filter((t) => !t.completed);
        if (activeTasks.length === 0) return;
        const allGroupSelected = activeTasks.every((t) => state.plannerSelectedTaskIds.has(t.id));
        if (allGroupSelected) {
          activeTasks.forEach((t) => state.plannerSelectedTaskIds.delete(t.id));
        } else {
          activeTasks.forEach((t) => state.plannerSelectedTaskIds.add(t.id));
        }
        updateSelectionUi();
      });
      selectAllBtn.type = "button";
      selectAllBtn.setAttribute("aria-label", isEn ? "Select all active tasks in this group" : "Bu qrupdakı aktiv tapşırıqları seç");
      const selectAllBox = element("span", "planner-select-all-box");
      const selectAllText = element("span", "planner-select-all-text", t("planner.selectAll") || (isEn ? "Select all" : "Hamısını seç"));
      selectAllBtn.append(selectAllBox, selectAllText);

      groupActions.append(groupRoadmapBtn, selectAllBtn);
      groupHeader.appendChild(groupActions);
      groupEl.appendChild(groupHeader);
      if (isSpotlight) {
        groupEl.appendChild(element("p", "planner-spotlight-caption", isEn ? "The moves that matter most. Start here." : "Ən yüksək təsirə malik addımlar. Buradan başla."));
      }

      const updateThisGroup = () => {
        const activeTasks = groupTasks.filter((t) => !t.completed);
        const hasActiveTasks = activeTasks.length > 0 && state.plannerFilter !== "completed";

        if (!hasActiveTasks) {
          selectAllBtn.style.display = "none";
          groupEl.classList.remove("has-bulk-selection");
          groupRoadmapBtn.style.display = "none";
          return;
        }

        selectAllBtn.style.display = "inline-flex";
        const selectedInGroup = activeTasks.filter((t) => state.plannerSelectedTaskIds.has(t.id));
        const allSelected = selectedInGroup.length === activeTasks.length;
        groupEl.classList.toggle("has-bulk-selection", allSelected);
        selectAllBtn.classList.toggle("is-all-selected", allSelected);
        selectAllText.textContent = allSelected
          ? (t("planner.deselectAll") || (isEn ? "Deselect all" : "Seçimi ləğv et"))
          : (t("planner.selectAll") || (isEn ? "Select all" : "Hamısını seç"));

        const hasSelected = selectedInGroup.length > 0;
        groupRoadmapBtn.style.display = hasSelected ? "inline-flex" : "none";
        const roadmapLabel = groupRoadmapBtn.querySelector(".planner-roadmap-btn-label");
        if (roadmapLabel) {
          roadmapLabel.textContent = hasSelected
            ? `${t("planner.generateRoadmap") || (isEn ? "Prepare execution map" : "İcra xəritəsi hazırla")} (${selectedInGroup.length})`
            : (t("planner.generateRoadmap") || (isEn ? "Prepare execution map" : "İcra xəritəsi hazırla"));
        }
      };
      groupActionUpdaters.push(updateThisGroup);

      const taskList = element("div", "planner-task-list");
      taskList.hidden = isCollapsed;

      groupTasks.forEach((task) => {
        const epoch = state.identityEpoch;
        const expectedUserId = state.currentUser?.id || null;
        const isSelected = !task.completed && state.plannerSelectedTaskIds.has(task.id);
        const card = element("div", `planner-task-card${task.completed ? " is-done" : ""}${isSelected ? " is-selected" : ""}`);
        allRenderedTaskCards.push({ task, card });

        const cardMain = element("div", "planner-card-main");

        // Custom checkbox
        const checkWrap = element("label", "planner-check-wrap");
        checkWrap.title = task.completed ? (isEn ? "Mark active" : "Aktiv et") : (isEn ? "Mark completed" : "Tamamla");
        checkWrap.addEventListener("click", (e) => e.stopPropagation());
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = Boolean(task.completed);
        checkbox.setAttribute("aria-label", task.text);
        const customBox = element("span", "planner-custom-checkbox");
        checkWrap.append(checkbox, customBox);

        const isPriority = Boolean(task.isPriority || task.priority === "high");
        if (isPriority) card.classList.add("is-priority");

        const textEl = element("p", "planner-task-text", task.text);
        if (isPriority) {
          const priorityBadge = element("span", "planner-card-priority-badge");
          priorityBadge.title = isEn ? "High priority task" : "Prioritet tapşırıq";
          priorityBadge.innerHTML = `
            <svg viewBox="0 0 24 24" width="10" height="10" fill="currentColor" aria-hidden="true">
              <path d="M12 2l2.4 7.4H22l-6 4.6 2.3 7.2-6.3-4.6-6.3 4.6 2.3-7.2-6-4.6h7.6z"/>
            </svg>
            <span>${isEn ? "Priority" : "Prioritet"}</span>
          `;
          cardMain.append(checkWrap, textEl, priorityBadge);
        } else {
          cardMain.append(checkWrap, textEl);
        }

        const cardActions = element("div", "planner-card-actions");

        // "İcra et" button (to the left of 3-dots button)
        const executeBtn = button("", "planner-execute-btn", (e) => {
          e.stopPropagation();
          executePlannerTask(task);
        });
        executeBtn.type = "button";
        executeBtn.setAttribute("aria-label", t("planner.executeTask") || (isEn ? "Execute" : "İcra et"));
        executeBtn.setAttribute("title", isEn ? "Execute this task in Ask mode" : "Bu tapşırığı Ask rejimində icra et");
        if (task.completed) {
          executeBtn.hidden = true;
          executeBtn.style.display = "none";
        }
        executeBtn.innerHTML = `
          <svg class="planner-execute-icon" viewBox="0 0 24 24" width="13" height="13" fill="currentColor" aria-hidden="true">
            <path d="M8 5.14v13.72a1 1 0 0 0 1.5.86l11-6.86a1 1 0 0 0 0-1.72l-11-6.86a1 1 0 0 0-1.5.86z"/>
          </svg>
          <span>${t("planner.executeTask") || (isEn ? "Execute" : "İcra et")}</span>
        `;

        const menuWrap = element("div", "planner-menu-wrap");
        const menuBtn = button("", "planner-menu-btn", (e) => {
          e.stopPropagation();
          const existingMenu = menuWrap.querySelector(".planner-dropdown-menu");
          document.querySelectorAll(".planner-dropdown-menu").forEach((m) => m.remove());
          document.querySelectorAll(".planner-task-card.has-open-menu").forEach((c) => c.classList.remove("has-open-menu"));
          if (existingMenu) return;

          card.classList.add("has-open-menu");
          const dropdown = element("div", "planner-dropdown-menu");
          if (task.strategyTitle) {
            const sourceItem = button("", "planner-dropdown-item planner-dropdown-source", (ev) => {
              ev.stopPropagation();
              dropdown.remove();
              card.classList.remove("has-open-menu");
              if (task.strategyId) openSavedStrategy(task.strategyId);
              else {
                state.mode = "build";
                state.view = "list";
                render();
              }
            });
            sourceItem.innerHTML = `
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
              </svg>
              <span class="planner-dropdown-source-copy"><small>${isEn ? "Source" : "Mənbə"}</small><strong>${escapeHtml(task.strategyTitle)}</strong></span>
            `;
            dropdown.appendChild(sourceItem);
          }
          if (task.createdAt) {
            const timeItem = element("div", "planner-dropdown-item planner-dropdown-time");
            timeItem.innerHTML = `
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="10"/>
                <polyline points="12 6 12 12 16 14"/>
              </svg>
              <span class="planner-dropdown-source-copy"><small>${isEn ? "Added" : "Əlavə edilib"}</small><strong>${formatDate(task.createdAt)}</strong></span>
            `;
            dropdown.appendChild(timeItem);
          }
          const priorityToggleItem = button("", "planner-dropdown-item", async (ev) => {
            ev.stopPropagation();
            dropdown.remove();
            card.classList.remove("has-open-menu");
            const nextVal = !Boolean(task.isPriority || task.priority === "high");
            try {
              await authRequest(`/api/planner/${task.id}`, {
                method: "PATCH",
                body: JSON.stringify({ isPriority: nextVal, priority: nextVal ? "high" : "normal" }),
              });
              if (isIdentityStale(epoch, expectedUserId)) return;
              task.isPriority = nextVal;
              task.priority = nextVal ? "high" : "normal";
              drawPlannerList();
              showToast(
                nextVal
                  ? (isEn ? "Task marked as priority ✓" : "Tapşırıq prioritet edildi ✓")
                  : (isEn ? "Removed from priority" : "Prioritetdən çıxarıldı"),
                "info"
              );
            } catch (err) {
              if (isIdentityStale(epoch, expectedUserId)) return;
              showToast(err.message || (isEn ? "Failed to update" : "Yeniləmək mümkün olmadı"), "error");
            }
          });
          priorityToggleItem.innerHTML = `
            <svg viewBox="0 0 24 24" width="14" height="14" fill="${isPriority ? "currentColor" : "none"}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
            </svg>
            <span class="planner-dropdown-source-copy"><strong>${isPriority ? (t("planner.unmarkPriority") || (isEn ? "Remove from priority" : "Prioritetdən çıxar")) : (t("planner.markPriority") || (isEn ? "Mark as priority" : "Prioritet et"))}</strong></span>
          `;
          dropdown.appendChild(priorityToggleItem);
          const deleteItem = button("", "planner-dropdown-item is-danger", async (ev) => {
            ev.stopPropagation();
            dropdown.remove();
            card.classList.remove("has-open-menu");
            if (!window.confirm(isEn ? "Are you sure you want to delete this task?" : "Bu tapşırığı silmək istədiyinizdən əminsiniz?")) {
              return;
            }
            card.style.opacity = "0.4";
            try {
              const res = await authRequest(`/api/planner/${task.id}`, { method: "DELETE" });
              if (isIdentityStale(epoch, expectedUserId)) return;
              if (res && res.ok === false) {
                throw new Error(isEn ? "Task not found or could not be deleted" : "Tapşırıq tapılmadı və ya silinmədi");
              }
              state.plannerTasks = state.plannerTasks.filter((t) => t.id !== task.id);
              state.plannerSelectedTaskIds.delete(task.id);
              updatePlannerBadge();
              drawPlannerList();
              showToast(isEn ? "Task deleted ✓" : "Tapşırıq silindi ✓", "info");
            } catch (err) {
              if (isIdentityStale(epoch, expectedUserId)) return;
              card.style.opacity = "1";
              showToast(err.message || (isEn ? "Unable to delete" : "Silmək mümkün olmadı"), "error");
            }
          });
          deleteItem.innerHTML = `
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
            </svg>
            <span>${isEn ? "Delete" : "Sil"}</span>
          `;
          dropdown.appendChild(deleteItem);
          menuWrap.appendChild(dropdown);
        });

        menuBtn.setAttribute("aria-label", isEn ? "Actions" : "Əməliyyatlar");
        menuBtn.innerHTML = `
          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
            <circle cx="5" cy="12" r="1.8"/>
            <circle cx="12" cy="12" r="1.8"/>
            <circle cx="19" cy="12" r="1.8"/>
          </svg>
        `;
        menuWrap.appendChild(menuBtn);

        cardActions.append(executeBtn, menuWrap);
        const taskCopy = element("div", "planner-task-copy");
        const metadata = element("div", "planner-task-meta");
        const status = element("span", "planner-task-status", task.completed ? (isEn ? "Completed" : "Tamamlanıb") : isTaskOverdue(task) ? overdueName : task.status === "in_progress" ? (isEn ? "In progress" : "İcradadır") : (isEn ? "Ready" : "İcraya hazır"));
        metadata.append(status, element("span", "planner-task-timeframe", localizePlannerGroup(task.groupLabel)));
        if (task.createdAt) {
          const added = element("time", "planner-task-date", formatDate(task.createdAt));
          added.dateTime = task.createdAt;
          added.title = isEn ? "Date added" : "Əlavə edilmə tarixi";
          metadata.appendChild(added);
        }
        if (task.strategyTitle) metadata.appendChild(element("span", "planner-task-source", task.strategyTitle));
        taskCopy.append(textEl, metadata);
        // Move the badge out of the title flow; every card retains one set of controls.
        const priorityBadge = cardMain.querySelector(".planner-card-priority-badge");
        if (priorityBadge) metadata.appendChild(priorityBadge);
        cardMain.replaceChildren(checkWrap, taskCopy, cardActions);

        // Feedback prompt for completed brief tasks (Rule: only for tasks from brief, not user-added)
        const isBriefTask = Boolean(task.strategyId || task.strategyTitle || task.source === "brief" || task.source === "strategy");
        let feedbackRow = null;
        if (isBriefTask) {
          feedbackRow = element("div", "planner-task-feedback");
          if (!task.completed) {
            feedbackRow.hidden = true;
            feedbackRow.style.display = "none";
          }

          const feedbackPrompt = element(
            "span",
            "planner-feedback-prompt",
            t("planner.taskHelpfulQuestion") || (isEn ? "Was this task helpful?" : "Bu tapşırıq faydalı oldu?")
          );

          const feedbackButtons = element("div", "planner-feedback-buttons");

          const likeBtn = button(
            "",
            `planner-feedback-btn is-like${task.feedback === "like" ? " is-active" : ""}`,
            async (e) => {
              e.stopPropagation();
              const nextFeedback = task.feedback === "like" ? null : "like";
              const prevFeedback = task.feedback;
              task.feedback = nextFeedback;
              likeBtn.classList.toggle("is-active", nextFeedback === "like");
              dislikeBtn.classList.remove("is-active");
              try {
                await authRequest(`/api/planner/${task.id}`, {
                  method: "PATCH",
                  body: JSON.stringify({ feedback: nextFeedback }),
                });
                if (isIdentityStale(epoch, expectedUserId)) return;
                showToast(
                  nextFeedback
                    ? (t("planner.taskFeedbackRecorded") || (isEn ? "Feedback recorded ✓" : "Rəyiniz qeydə alındı ✓"))
                    : (isEn ? "Feedback removed" : "Rəy silindi"),
                  "info"
                );
              } catch (err) {
              if (isIdentityStale(epoch, expectedUserId)) return;
                task.feedback = prevFeedback;
                likeBtn.classList.toggle("is-active", prevFeedback === "like");
                dislikeBtn.classList.toggle("is-active", prevFeedback === "dislike");
                showToast(err.message || (isEn ? "Unable to record feedback" : "Rəyi qeyd etmək mümkün olmadı"), "error");
              }
            }
          );
          likeBtn.type = "button";
          likeBtn.title = t("planner.taskHelpfulYes") || (isEn ? "Helpful" : "Faydalı oldu");
          likeBtn.setAttribute("aria-label", t("planner.taskHelpfulYes") || (isEn ? "Helpful" : "Faydalı oldu"));
          likeBtn.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/></svg>';

          const dislikeBtn = button(
            "",
            `planner-feedback-btn is-dislike${task.feedback === "dislike" ? " is-active" : ""}`,
            async (e) => {
              e.stopPropagation();
              const nextFeedback = task.feedback === "dislike" ? null : "dislike";
              const prevFeedback = task.feedback;
              task.feedback = nextFeedback;
              dislikeBtn.classList.toggle("is-active", nextFeedback === "dislike");
              likeBtn.classList.remove("is-active");
              try {
                await authRequest(`/api/planner/${task.id}`, {
                  method: "PATCH",
                  body: JSON.stringify({ feedback: nextFeedback }),
                });
                if (isIdentityStale(epoch, expectedUserId)) return;
                showToast(
                  nextFeedback
                    ? (t("planner.taskFeedbackRecorded") || (isEn ? "Feedback recorded ✓" : "Rəyiniz qeydə alındı ✓"))
                    : (isEn ? "Feedback removed" : "Rəy silindi"),
                  "info"
                );
              } catch (err) {
              if (isIdentityStale(epoch, expectedUserId)) return;
                task.feedback = prevFeedback;
                dislikeBtn.classList.toggle("is-active", prevFeedback === "dislike");
                likeBtn.classList.toggle("is-active", prevFeedback === "like");
                showToast(err.message || (isEn ? "Unable to record feedback" : "Rəyi qeyd etmək mümkün olmadı"), "error");
              }
            }
          );
          dislikeBtn.type = "button";
          dislikeBtn.title = t("planner.taskHelpfulNo") || (isEn ? "Not helpful" : "Faydalı olmadı");
          dislikeBtn.setAttribute("aria-label", t("planner.taskHelpfulNo") || (isEn ? "Not helpful" : "Faydalı olmadı"));
          dislikeBtn.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7-13h3a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-3"/></svg>';

          feedbackButtons.append(likeBtn, dislikeBtn);
          feedbackRow.append(feedbackPrompt, feedbackButtons);
        }

        // Click card to toggle selection (completed tasks cannot be selected)
        if (!task.completed) {
          card.tabIndex = 0;
          card.setAttribute("role", "group");
          card.setAttribute("aria-label", `${isEn ? "Select task" : "Tapşırığı seç"}: ${task.text}`);
          card.addEventListener("keydown", (e) => {
            if (e.target === card && (e.key === "Enter" || e.key === " ")) {
              e.preventDefault();
              card.click();
            }
          });
        }
        card.addEventListener("click", (e) => {
          if (
            e.target.closest(".planner-check-wrap") ||
            e.target.closest(".planner-execute-btn") ||
            e.target.closest(".planner-menu-wrap") ||
            e.target.closest(".planner-dropdown-menu") ||
            e.target.closest(".planner-task-feedback")
          ) {
            return;
          }
          if (task.completed) {
            return;
          }
          if (state.plannerSelectedTaskIds.has(task.id)) {
            state.plannerSelectedTaskIds.delete(task.id);
          } else {
            state.plannerSelectedTaskIds.add(task.id);
          }
          updateSelectionUi();
        });

        checkbox.addEventListener("change", async () => {
          task.completed = checkbox.checked;
          if (task.completed) {
            state.plannerSelectedTaskIds.delete(task.id);
            card.classList.remove("is-selected");
          }
          card.classList.toggle("is-done", task.completed);
          if (executeBtn) {
            executeBtn.hidden = task.completed;
            executeBtn.style.display = task.completed ? "none" : "";
          }
          if (feedbackRow) {
            feedbackRow.hidden = !task.completed;
            feedbackRow.style.display = task.completed ? "flex" : "none";
          }
          updatePlannerBadge();
          updateSelectionUi();
          try {
            await authRequest(`/api/planner/${task.id}`, {
              method: "PATCH",
              body: JSON.stringify({ completed: task.completed }),
            });
            if (isIdentityStale(epoch, expectedUserId)) return;
            drawPlannerList();
          } catch (err) {
            if (isIdentityStale(epoch, expectedUserId)) return;
            checkbox.checked = !task.completed;
            task.completed = checkbox.checked;
            if (task.completed) {
              state.plannerSelectedTaskIds.delete(task.id);
              card.classList.remove("is-selected");
            }
            card.classList.toggle("is-done", task.completed);
            if (executeBtn) {
              executeBtn.hidden = task.completed;
              executeBtn.style.display = task.completed ? "none" : "";
            }
            if (feedbackRow) {
              feedbackRow.hidden = !task.completed;
              feedbackRow.style.display = task.completed ? "flex" : "none";
            }
            updatePlannerBadge();
            updateSelectionUi();
            showToast(err.message || (isEn ? "Unable to update task" : "Yeniləmək mümkün olmadı"), "error");
          }
        });

        card.appendChild(cardMain);
        if (feedbackRow) {
          card.appendChild(feedbackRow);
        }
        taskList.appendChild(card);
      });

      groupEl.appendChild(taskList);
      listContainer.appendChild(groupEl);
    });

    updateSelectionUi();
  };

  const onDocClick = (e) => {
    if (!e.target.closest(".planner-menu-wrap")) {
      document.querySelectorAll(".planner-dropdown-menu").forEach((m) => m.remove());
      document.querySelectorAll(".planner-task-card.has-open-menu").forEach((c) => c.classList.remove("has-open-menu"));
    }
  };
  if (window._helmerPlannerDocClick) {
    document.removeEventListener("click", window._helmerPlannerDocClick);
  }
  window._helmerPlannerDocClick = onDocClick;
  document.addEventListener("click", onDocClick);

  searchInput.addEventListener("input", drawPlannerList);
  drawPlannerList();
  workspace.appendChild(view);
}

/* ===== USAGE LIMITS VIEW & STATS ===== */

async function loadUsageStats() {
  const epoch = state.identityEpoch;
  const expectedUserId = state.currentUser?.id || null;
  if (state.currentUser) {
    try {
      const tzOffset = new Date().getTimezoneOffset();
      const data = await authRequest(`/api/usage/stats?tzOffset=${tzOffset}`);
      if (epoch !== state.identityEpoch || (state.currentUser?.id || null) !== expectedUserId) return null;
      if (data && data.statsByPeriod) {
        state.usageStats = data;
        return data;
      }
    } catch (err) {
      if (epoch !== state.identityEpoch || (state.currentUser?.id || null) !== expectedUserId) return null;
      console.warn("Could not fetch remote usage stats, computing locally:", err);
    }
  }

  // Local fallback computation
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0).getTime();
  const DAY_MS = 24 * 60 * 60 * 1000;
  const periods = {
    today: { start: todayStart },
    "7d": { start: todayStart - 6 * DAY_MS },
    "14d": { start: todayStart - 13 * DAY_MS },
    "30d": { start: todayStart - 29 * DAY_MS },
  };

  const strats = state.savedStrategies || [];
  const chats = state.savedChats || [];
  const tasks = state.plannerTasks || [];

  const buildEvents = [];
  strats.forEach((s) => {
    const t = new Date(s.createdAt || s.updatedAt || Date.now()).getTime();
    buildEvents.push({ type: "strategy_create", timestamp: t });
    if (Array.isArray(s.versions)) {
      for (let i = 1; i < s.versions.length; i++) {
        buildEvents.push({
          type: "strategy_refine",
          timestamp: new Date(s.versions[i].createdAt || t).getTime(),
        });
      }
    }
  });

  const askEvents = [];
  chats.forEach((c) => {
    if (Array.isArray(c.messages)) {
      c.messages.forEach((m) => {
        const mt = new Date(m.createdAt || c.createdAt || Date.now()).getTime();
        if (m.role === "user") askEvents.push({ type: "ask_question", timestamp: mt });
        else if (m.role === "assistant") askEvents.push({ type: "ask_response", timestamp: mt });
      });
    }
  });

  const statsByPeriod = {};
  for (const [key, { start }] of Object.entries(periods)) {
    const pBuild = buildEvents.filter((e) => e.timestamp >= start);
    const pAsk = askEvents.filter((e) => e.timestamp >= start);
    const created = pBuild.filter((e) => e.type === "strategy_create").length;
    const refined = pBuild.filter((e) => e.type === "strategy_refine").length;
    const questions = pAsk.filter((e) => e.type === "ask_question").length;
    const responses = pAsk.filter((e) => e.type === "ask_response").length;
    statsByPeriod[key] = {
      totalOps: created + refined + questions + responses,
      build: { total: created + refined, strategiesCreated: created, refinements: refined },
      ask: { total: questions + responses, questions, responses, activeChats: chats.length },
      activeProjects: strats.length,
      plannerTasksCount: tasks.length,
    };
  }

  const dailyBreakdown = [];
  const isEn = getLanguage() === "en";
  for (let i = 29; i >= 0; i--) {
    const dayStart = todayStart - i * DAY_MS;
    const dayEnd = dayStart + DAY_MS;
    const d = new Date(dayStart);
    const dateStr = d.toLocaleDateString(isEn ? "en-US" : "az-AZ", { month: "short", day: "numeric" });
    const isoDate = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    const dayBuild = buildEvents.filter((e) => e.timestamp >= dayStart && e.timestamp < dayEnd).length;
    const dayAsk = askEvents.filter((e) => e.timestamp >= dayStart && e.timestamp < dayEnd).length;
    dailyBreakdown.push({
      date: isoDate,
      label: i === 0 ? (isEn ? "Today" : "Bugün") : dateStr,
      build: dayBuild,
      ask: dayAsk,
      total: dayBuild + dayAsk,
    });
  }

  state.usageStats = {
    plan: {
      isUnlimited: true,
      planTitle: isEn ? "Unlimited Usage Plan" : "Limitsiz İstifadə Planı",
      statusText: isEn ? "All AI Models Active" : "Bütün AI Modelləri Aktivdir",
    },
    statsByPeriod,
    dailyBreakdown,
    totals: {
      allTimeStrategies: strats.length,
      allTimeChats: chats.length,
      allTimeTasks: tasks.length,
    },
  };

  return state.usageStats;
}

function renderLimitsView() {
  const isEn = getLanguage() === "en";
  workspace.classList.add("workspace-limits");
  workspace.replaceChildren();

  if (!state.usageStats) {
    loadUsageStats().then(() => {
      if (state.view === "limits") renderLimitsView();
    });
  }

  const view = element("section", "limits-view");
  const period = state.limitsPeriod || "today";
  const stats = state.usageStats?.statsByPeriod?.[period] || {
    totalOps: 0,
    build: { total: 0, strategiesCreated: 0, refinements: 0 },
    ask: { total: 0, questions: 0, responses: 0 },
  };

  // 1. Header Row with Integrated Period Switcher
  const headerRow = element("div", "limits-header-row");
  const headerText = element("div", "limits-header-text");
  headerText.append(
    element("h1", "", t("limits.title")),
    element("p", "", t("limits.subtitle"))
  );

  const headerControls = element("div", "limits-header-controls");

  // Desktop Period Segmented Filter
  const filterPills = element("div", "limits-segmented-control");
  const PERIOD_OPTIONS = [
    { id: "today", label: isEn ? "Today" : "Bugün" },
    { id: "7d", label: isEn ? "Last 7 Days" : "7 gün" },
    { id: "14d", label: isEn ? "Last 14 Days" : "14 gün" },
    { id: "30d", label: isEn ? "Last 30 Days" : "30 gün" },
  ];

  PERIOD_OPTIONS.forEach(({ id, label }) => {
    const pill = button(label, `limits-segment-btn${period === id ? " is-active" : ""}`, () => {
      state.limitsPeriod = id;
      renderLimitsView();
    });
    filterPills.appendChild(pill);
  });

  // Mobile Native Select Dropdown
  const mobileSelectWrap = element("div", "limits-mobile-select-wrap");
  const mobileSelect = document.createElement("select");
  mobileSelect.className = "limits-mobile-select";
  mobileSelect.setAttribute("aria-label", isEn ? "Select period" : "Dövr seçimi");
  PERIOD_OPTIONS.forEach(({ id, label }) => {
    const opt = document.createElement("option");
    opt.value = id;
    opt.textContent = label;
    if (period === id) opt.selected = true;
    mobileSelect.appendChild(opt);
  });
  mobileSelect.addEventListener("change", (e) => {
    state.limitsPeriod = e.target.value;
    renderLimitsView();
  });
  mobileSelectWrap.innerHTML = `
    <svg class="limits-select-chevron" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <polyline points="6 9 12 15 18 9"/>
    </svg>
  `;
  mobileSelectWrap.prepend(mobileSelect);

  // Refresh Button
  const refreshBtn = button("", "limits-refresh-btn", async () => {
    refreshBtn.disabled = true;
    refreshBtn.classList.add("is-loading");
    await loadUsageStats();
    if (state.view === "limits") renderLimitsView();
    showToast(isEn ? "Usage statistics refreshed ✓" : "Statistikalar yeniləndi ✓", "info");
  });
  refreshBtn.setAttribute("title", isEn ? "Refresh statistics" : "Statistikanı yenilə");
  refreshBtn.innerHTML = `
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <polyline points="23 4 23 10 17 10"/>
      <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
    </svg>
  `;

  headerControls.append(filterPills, mobileSelectWrap, refreshBtn);
  headerRow.append(headerText, headerControls);
  view.appendChild(headerRow);

  // 2. Two Clean Mode Cards (Build & Ask)
  const modeGrid = element("div", "limits-mode-grid");

  // Build Card
  const buildCard = element("div", "limits-mode-card mode-build-card");
  buildCard.innerHTML = `
    <div class="limits-mode-card-top">
      <div class="limits-mode-title-wrap">
        <div class="limits-mode-icon-box build-icon-box">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
        </div>
        <div>
          <h4>Build</h4>
          <span class="limits-mode-sub">${isEn ? "Strategic roadmap generation & refinement" : "Strateji generasiya və dəqiqləşdirmə"}</span>
        </div>
      </div>
      <span class="limits-tag tag-build">${isEn ? "Unlimited" : "Limitsiz"}</span>
    </div>
    <div class="limits-mode-value-wrap">
      <span class="limits-mode-big-num">${stats.build.total}</span>
      <span class="limits-mode-unit">${isEn ? "strategy operations" : "əməliyyat"}</span>
    </div>
    <div class="limits-mode-meta-pills">
      <span class="limits-meta-pill"><strong>${stats.build.strategiesCreated}</strong> ${isEn ? "strategies built" : "yeni strategiya"}</span>
      <span class="limits-meta-pill"><strong>${stats.build.refinements}</strong> ${isEn ? "refinements" : "dəqiqləşdirmə"}</span>
    </div>
  `;

  // Ask Card
  const askCard = element("div", "limits-mode-card mode-ask-card");
  askCard.innerHTML = `
    <div class="limits-mode-card-top">
      <div class="limits-mode-title-wrap">
        <div class="limits-mode-icon-box ask-icon-box">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>
        </div>
        <div>
          <h4>Ask</h4>
          <span class="limits-mode-sub">${isEn ? "Interactive strategic Q&A and analysis" : "İnteraktiv sual-cavab və analiz"}</span>
        </div>
      </div>
      <span class="limits-tag tag-ask">${isEn ? "Unlimited" : "Limitsiz"}</span>
    </div>
    <div class="limits-mode-value-wrap">
      <span class="limits-mode-big-num">${stats.ask.total}</span>
      <span class="limits-mode-unit">${isEn ? "consultations" : "əməliyyat"}</span>
    </div>
    <div class="limits-mode-meta-pills">
      <span class="limits-meta-pill"><strong>${stats.ask.questions}</strong> ${isEn ? "questions asked" : "sual"}</span>
      <span class="limits-meta-pill"><strong>${stats.ask.responses}</strong> ${isEn ? "AI responses" : "AI cavabı"}</span>
    </div>
  `;

  modeGrid.append(buildCard, askCard);
  view.appendChild(modeGrid);

  // 4. Activity Timeline Chart Card
  const chartSection = element("div", "limits-chart-card");
  const chartHeader = element("div", "limits-chart-header");
  const periodTitle = period === "today"
    ? (isEn ? "Today" : "Bugün")
    : period === "7d"
      ? (isEn ? "Past 7 days" : "Son 7 gün")
      : period === "14d"
        ? (isEn ? "Past 14 days" : "Son 14 gün")
        : (isEn ? "Past 30 days" : "Son 30 gün");

  chartHeader.innerHTML = `
    <div>
      <h3>${isEn ? "Activity Timeline" : "Fəallığınız"}</h3>
      <p>${escapeHtml(isEn ? `Visual distribution of strategic operations over ${periodTitle.toLowerCase()}.` : `${periodTitle} üzrə sorğu və generasiyaların vizual bölgüsü.`)}</p>
    </div>
    <div class="limits-chart-legend">
      <div class="legend-item"><span class="legend-dot dot-build"></span><span>Build</span></div>
      <div class="legend-item"><span class="legend-dot dot-ask"></span><span>Ask</span></div>
    </div>
  `;
  chartSection.appendChild(chartHeader);

  let chartData = state.usageStats?.dailyBreakdown || [];
  if (period === "today") chartData = chartData.slice(-1);
  else if (period === "7d") chartData = chartData.slice(-7);
  else if (period === "14d") chartData = chartData.slice(-14);
  else if (period === "30d") chartData = chartData.slice(-30);

  const totalDays = chartData.length;
  const maxTotal = Math.max(...chartData.map((d) => d.total || 0), 4);

  const chartBody = element("div", "limits-chart-body");
  const barsContainer = element("div", `limits-chart-bars-wrap${period === "today" ? " is-single-day" : ""}`);

  let labelStep = 1;
  if (totalDays > 20) labelStep = 5;
  else if (totalDays > 10) labelStep = 3;

  const totalPeriodOps = chartData.reduce((sum, d) => sum + (d.total || 0), 0);
  if (totalPeriodOps === 0 && period === "today") {
    const emptyState = element("div", "limits-chart-empty-state");
    emptyState.innerHTML = `
      <div class="limits-empty-icon-wrap">
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <line x1="18" y1="20" x2="18" y2="10"/>
          <line x1="12" y1="20" x2="12" y2="4"/>
          <line x1="6" y1="20" x2="6" y2="14"/>
        </svg>
      </div>
      <p class="limits-empty-title">${escapeHtml(isEn ? "No strategic activity recorded yet today" : "Bugün üçün hələlik strateji fəallıq qeydə alınmayıb")}</p>
      <span class="limits-empty-hint">${escapeHtml(isEn ? "Execute a Build generation or consult Ask Copilot to see real-time distribution." : "Real vaxt rejimində fəallığı görmək üçün Build generasiyası edin və ya Ask məsləhətçisinə sual verin.")}</span>
    `;
    chartBody.appendChild(emptyState);
  } else {
    chartData.forEach((dayItem, idx) => {
      const col = element("div", "limits-chart-col");
      const isFirst = (idx === 0);
      const isLast = (idx === totalDays - 1);
      const isKeyStep = (idx % labelStep === 0);
      const showLabel = (totalDays <= 8) || isFirst || isLast || isKeyStep;

      const hasActivity = (dayItem.build > 0) || (dayItem.ask > 0);
      const buildH = dayItem.build > 0 ? Math.max(6, Math.round(((dayItem.build || 0) / maxTotal) * 110)) : 0;
      const askH = dayItem.ask > 0 ? Math.max(6, Math.round(((dayItem.ask || 0) / maxTotal) * 110)) : 0;

      let barsTrackHtml = "";
      if (hasActivity) {
        barsTrackHtml = `
          <div class="limits-col-bars-track">
            ${buildH > 0 ? `<div class="limits-bar-segment segment-build" style="height: ${buildH}px;"></div>` : ""}
            ${askH > 0 ? `<div class="limits-bar-segment segment-ask" style="height: ${askH}px;"></div>` : ""}
          </div>
        `;
      } else {
        barsTrackHtml = `
          <div class="limits-col-bars-track is-empty">
            <div class="limits-bar-empty"></div>
          </div>
        `;
      }

      const labelText = escapeHtml(isEn ? dayItem.label.replace("Bugün", "Today") : dayItem.label.replace("Bu gün", "Bugün"));

      col.innerHTML = `
        <div class="limits-chart-tooltip">
          <strong>${labelText}</strong>
          <div class="tooltip-row"><span class="t-dot dot-build"></span> Build: ${dayItem.build || 0}</div>
          <div class="tooltip-row"><span class="t-dot dot-ask"></span> Ask: ${dayItem.ask || 0}</div>
          <div class="tooltip-row t-total">${isEn ? "Total" : "Cəmi"}: ${dayItem.total || 0}</div>
        </div>
        ${barsTrackHtml}
        <span class="limits-col-label${showLabel ? "" : " is-hidden-label"}">${showLabel ? labelText : "&nbsp;"}</span>
      `;
      barsContainer.appendChild(col);
    });
    chartBody.appendChild(barsContainer);
  }
  chartSection.appendChild(chartBody);
  view.appendChild(chartSection);

  // 4. Compact & Premium FAQ Section (Collapsible)
  const faqSection = document.createElement("details");
  faqSection.className = "limits-faq-card";
  const faqHeader = document.createElement("summary");
  faqHeader.className = "limits-faq-header";
  faqHeader.innerHTML = `
    <div class="limits-faq-title-wrap">
      <div class="limits-faq-icon">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10"/>
          <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/>
          <line x1="12" y1="17" x2="12.01" y2="17"/>
        </svg>
      </div>
      <div>
        <h3>${isEn ? "Frequently Asked Questions" : "Tez-tez verilən suallar"}</h3>
        <p>${isEn ? "Key facts about usage, modes, and activity metrics." : "İstifadə, rejimlər və fəallıq statistikaları haqqında faydalı məlumatlar."}</p>
      </div>
    </div>
    <div class="limits-faq-main-toggle" aria-hidden="true">
      <svg class="limits-main-faq-chevron" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="6 9 12 15 18 9"/>
      </svg>
    </div>
  `;
  faqSection.appendChild(faqHeader);

  const faqList = element("div", "limits-faq-list");
  const FAQ_ITEMS = isEn ? [
    {
      q: "What is the difference between Build and Ask modes?",
      a: "<strong>Build mode</strong> crafts comprehensive go-to-market strategies, competitor mappings, target audiences, and execution roadmaps. <strong>Ask mode</strong> provides real-time strategic Q&A, deep analysis, and tactical advice."
    },
    {
      q: "How are activity metrics and timelines computed?",
      a: "The system automatically tracks your Build and Ask operations across the selected timeframe (Today, 7 days, 14 days, 30 days) and plots them dynamically."
    },
    {
      q: "Are there any usage or rate limits on Helmer?",
      a: "All strategic intelligence models and workflows are fully enabled for uninterrupted high-velocity marketing execution."
    },
    {
      q: "Where are my strategies and conversations stored?",
      a: "All generated strategies and chat histories are securely stored in your personal workspace. You can access them anytime via the <strong>Archive</strong> and <strong>Planner</strong> tabs in the sidebar."
    },
    {
      q: "When and how are these statistics updated?",
      a: "Usage statistics update automatically with each new generation or conversation. You can also click the <strong>Refresh</strong> button at the top to instantly reload latest stats."
    }
  ] : [
    {
      q: "Build və Ask rejimləri arasındakı fərq nədir?",
      a: "<strong>Build rejimi</strong> strukturlaşdırılmış marketinq strategiyaları, bazar analizi, hədəf auditoriya xəritələri və icra planları hazırlayır. <strong>Ask rejimi</strong> isə operativ sual-cavab, araşdırmalar və analitik dəqiqləşdirmələr üçün optimallaşdırılıb."
    },
    {
      q: "Fəallıq statistikaları və dövrlər necə hesablanır?",
      a: "Sistem seçdiyiniz dövr (Bugün, 7 gün, 14 gün, 30 gün) üzrə Build və Ask əməliyyatlarınızı avtomatik qeydə alır və dinamika qrafikində anlıq əks etdirir."
    },
    {
      q: "Helmer-də istifadə və ya kvota limiti varmı?",
      a: "Bütün modellər üzrə sorğu və strategiya generasiyası fasiləsiz iş axını üçün tam açıqdır. Sistem sabit və rahat iş üçün optimallaşdırılmışdır."
    },
    {
      q: "Hazırladığım strategiyalar və söhbətlər harada saxlanılır?",
      a: "Yaratdığınız bütün strategiyalar və söhbətlər profilinizə bağlı şəkildə saxlanılır. Sol paneldəki <strong>Arxiv</strong> və <strong>Planlaşdırılanlar</strong> bölmələrindən onlara istənilən vaxt baxa və davam etdirə bilərsiniz."
    },
    {
      q: "Göstəricilər nə zaman və necə yenilənir?",
      a: "Statistikalar hər yeni əməliyyatdan sonra avtomatik yenilənir. Həmçinin yuxarıdakı <strong>Yenilə</strong> düyməsini sıxaraq məlumatları anında təzələyə bilərsiniz."
    }
  ];

  FAQ_ITEMS.forEach((item) => {
    const details = document.createElement("details");
    details.className = "limits-faq-item";
    details.name = "limits-faq-accordion";
    details.innerHTML = `
      <summary class="limits-faq-summary">
        <span class="limits-faq-question">${escapeHtml(item.q)}</span>
        <span class="limits-faq-icon-wrap" aria-hidden="true">
          <svg class="limits-faq-chevron" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </span>
      </summary>
      <div class="limits-faq-content">
        <p>${item.a}</p>
      </div>
    `;
    faqList.appendChild(details);
  });

  faqSection.appendChild(faqList);
  view.appendChild(faqSection);

  workspace.appendChild(view);
}

const LEGAL_DOCS = new Proxy({}, {
  get(target, prop) {
    const lang = getLanguage();
    const docs = LEGAL_DOCS_I18N[lang] || LEGAL_DOCS_I18N.az;
    return docs[prop] || docs.terms;
  },
});

function openPersonalizationConsentModal(onAccept) {
  const isEn = getLanguage() === "en";
  const overlay = document.querySelector("#legalModalOverlay");
  if (!overlay) return;

  overlay.replaceChildren();

  const card = element("div", "legal-modal-card personalization-consent-card");
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-modal", "true");
  card.setAttribute("aria-labelledby", "personalizationConsentTitle");

  const header = element("header", "legal-modal-header");
  const titleGroup = element("div", "legal-modal-title-group");
  const title = element("h2", "", isEn ? "Enable personalized experience?" : "Fərdiləşdirilmiş təcrübəni aktivləşdir?");
  title.id = "personalizationConsentTitle";
  titleGroup.append(
    title,
    element("p", "", isEn ? "Leverage brand knowledge for contextual AI responses." : "Daha uyğun cavablar üçün brend məlumatlarından istifadə et.")
  );

  const closeBtn = button("✕", "legal-modal-close", closeLegalModal);
  closeBtn.setAttribute("aria-label", isEn ? "Close" : "Bağla");
  header.append(titleGroup, closeBtn);

  const body = element("div", "legal-modal-body personalization-consent-body");
  body.append(
    element(
      "p",
      "",
      isEn
        ? "When enabled, Helmer adapts strategies, frameworks, and analyses based on your brand profile, tone of voice, and memory notes."
        : "Aktiv olduqda Helmer cavabları və strategiyaları brend profilin, seçdiyin üslub və yaddaş qeydlərin əsasında fərdiləşdirəcək."
    ),
    element(
      "p",
      "",
      isEn
        ? "This feature is optional and can be turned off anytime in Settings."
        : "Bu funksiya könüllüdür və istənilən vaxt Parametrlər bölməsindən söndürülə bilər."
    )
  );

  const privacyLink = element(
    "a",
    "personalization-consent-privacy-link",
    isEn ? "Read Privacy Policy →" : "Məxfilik Siyasətini oxu →"
  );
  privacyLink.href = "#privacy";
  privacyLink.addEventListener("click", (event) => {
    event.preventDefault();
    openLegalModal("privacy");
  });
  body.appendChild(privacyLink);

  const footer = element("div", "legal-modal-footer personalization-consent-footer");
  const cancelBtn = button(isEn ? "Not now" : "İndi yox", "secondary-button", closeLegalModal);
  const acceptBtn = button(isEn ? "Agree & enable" : "Razıyam, aktiv et", "primary-button", () => {
    closeLegalModal();
    if (typeof onAccept === "function") onAccept();
  });
  footer.append(cancelBtn, acceptBtn);

  card.append(header, body, footer);
  overlay.appendChild(card);
  overlay.hidden = false;
  document.body.style.overflow = "hidden";
  acceptBtn.focus();
}

function openLegalModal(type) {
  const isEn = getLanguage() === "en";
  const overlay = document.querySelector("#legalModalOverlay");
  if (!overlay) return;
  const doc = LEGAL_DOCS[type] || LEGAL_DOCS.terms;

  overlay.replaceChildren();
  const card = element("div", "legal-modal-card");

  const header = element("header", "legal-modal-header");
  const titleGroup = element("div", "legal-modal-title-group");
  titleGroup.append(element("h2", "", doc.title), element("p", "", doc.subtitle));

  const closeBtn = button("✕", "legal-modal-close", closeLegalModal);
  closeBtn.setAttribute("aria-label", isEn ? "Close" : "Bağla");

  header.append(titleGroup, closeBtn);

  const body = element("div", "legal-modal-body");
  body.innerHTML = doc.html;

  const footer = element("div", "legal-modal-footer");
  footer.appendChild(button(isEn ? "Close" : "Bağla", "primary-button", closeLegalModal));

  card.append(header, body, footer);
  overlay.append(card, buildSupportChatBubble());
  overlay.hidden = false;
  document.body.style.overflow = "hidden";
}

function closeLegalModal() {
  const overlay = document.querySelector("#legalModalOverlay");
  if (overlay) {
    overlay.hidden = true;
    overlay.replaceChildren();
  }
  document.body.style.overflow = "";
}

window.addEventListener("helmer:open-legal", (event) => {
  openLegalModal(event.detail?.type || "terms");
});

function openDeleteAccountModal() {
  const isEn = getLanguage() === "en";
  const overlay = document.querySelector("#legalModalOverlay");
  if (!overlay) return;

  overlay.replaceChildren();
  const card = element("div", "legal-modal-card delete-account-modal-card");

  const header = element("header", "legal-modal-header");
  const titleGroup = element("div", "legal-modal-title-group");
  titleGroup.append(
    element("h2", "", isEn ? "Confirm Account Deletion" : "Hesabın silinməsini təsdiqləyirsiniz?"),
    element("p", "", isEn ? "14-day security grace period" : "14 günlük təhlükəsizlik və gözləmə müddəti")
  );

  const closeBtn = button("✕", "legal-modal-close", closeLegalModal);
  closeBtn.setAttribute("aria-label", isEn ? "Close" : "Bağla");
  header.append(titleGroup, closeBtn);

  const body = element("div", "legal-modal-body delete-account-modal-body");
  body.innerHTML = isEn ? `
    <div class="delete-account-callout">
      <div class="delete-callout-icon">⚠️</div>
      <div class="delete-callout-copy">
        <strong>Your account will not be erased immediately.</strong> A 14-day security grace period applies.
      </div>
    </div>
    <div class="delete-rules-container">
      <div class="delete-rule-item">
        <span class="delete-rule-bullet">1</span>
        <div>
          <strong>Immediate Deactivation:</strong>
          <p>Your current session will end immediately and your account will enter a protected 14-day deactivation state.</p>
        </div>
      </div>
      <div class="delete-rule-item">
        <span class="delete-rule-bullet">2</span>
        <div>
          <strong>Effortless 14-Day Restoration:</strong>
          <p>If you change your mind, simply sign in within 14 days to cancel deletion and restore your full workspace.</p>
        </div>
      </div>
      <div class="delete-rule-item">
        <span class="delete-rule-bullet">3</span>
        <div>
          <strong>Permanent Erasure After 14 Days:</strong>
          <p>If you do not sign in within 14 days, all strategies, chat histories, planner tasks, and account data will be permanently wiped.</p>
        </div>
      </div>
    </div>
  ` : `
    <div class="delete-account-callout">
      <div class="delete-callout-icon">⚠️</div>
      <div class="delete-callout-copy">
        <strong>Hesabınız dərhal silinmir.</strong> 14 günlük təhlükəsiz gözləmə müddəti tətbiq olunur.
      </div>
    </div>
    <div class="delete-rules-container">
      <div class="delete-rule-item">
        <span class="delete-rule-bullet">1</span>
        <div>
          <strong>Dərhal deaktivasiya:</strong>
          <p>Təsdiq etdiyiniz an cari sessiyanız bağlanacaq və hesabınız təhlükəsiz gözləmə rejiminə keçəcək.</p>
        </div>
      </div>
      <div class="delete-rule-item">
        <span class="delete-rule-bullet">2</span>
        <div>
          <strong>14 gün ərzində avtomatik bərpa:</strong>
          <p>14 gün ərzində fikrinizi dəyişsəniz, sadəcə hesabınıza yenidən daxil olmaqla silinməni ləğv edə və hesabınızı tam bərpa edə bilərsiniz.</p>
        </div>
      </div>
      <div class="delete-rule-item">
        <span class="delete-rule-bullet">3</span>
        <div>
          <strong>14 gündən sonra dönməz silinmə:</strong>
          <p>14 gün ərzində heç bir giriş edilməzsə, bütün marketinq strategiyalarınız, çatlar, planlaşdırıcı qeydləriniz və profiliniz birdəfəlik silinəcək.</p>
        </div>
      </div>
    </div>
  `;

  const footer = element("div", "legal-modal-footer delete-modal-footer");
  const cancelBtn = button(isEn ? "Cancel" : "İmtina et", "secondary-button", closeLegalModal);
  const confirmBtn = button(isEn ? "Yes, submit deletion request" : "Bəli, silinmə sorğusu göndər", "danger-button delete-confirm-btn", async () => {
    confirmBtn.disabled = true;
    confirmBtn.textContent = isEn ? "Requesting deletion…" : "Silinmə tələb edilir…";
    try {
      const deletionProof = await window.helmerSecurity.reauthenticate();
      await authRequest("/api/auth/account/delete-request", { method: "POST", body: deletionProof });
      closeLegalModal();
      state.currentUser = null;
      showToast(isEn ? "Your account has entered the 14-day deletion grace period." : "Hesabınız 14 günlük silinmə rejiminə keçirildi. 14 gün ərzində daxil olmasanız, hesabınız birdəfəlik silinəcək.", "info");
      window.dispatchEvent(new CustomEvent("helmer:auth-required"));
    } catch (err) {
      showToast(err.message || (isEn ? "An error occurred." : "Xəta baş verdi."), "error");
      confirmBtn.disabled = false;
      confirmBtn.textContent = isEn ? "Yes, submit deletion request" : "Bəli, silinmə sorğusu göndər";
    }
  });

  footer.append(cancelBtn, confirmBtn);
  card.append(header, body, footer);
  overlay.appendChild(card);
  overlay.hidden = false;
  document.body.style.overflow = "hidden";
}

function openLegalReportModal({ messageContent = "", model = "" } = {}) {
  const isEn = getLanguage() === "en";
  const overlay = document.querySelector("#legalModalOverlay");
  if (!overlay) return;

  overlay.replaceChildren();
  const card = element("div", "legal-modal-card legal-report-modal-card");

  const header = element("header", "legal-modal-header");
  const titleGroup = element("div", "legal-modal-title-group");
  titleGroup.append(
    element("h2", "", isEn ? "Report Legal / Policy Issue" : "Hüquqi problem bildir"),
    element("p", "", isEn ? "Report a legal concern, policy violation, or content issue with an AI response" : "Süni intellekt cavabı ilə bağlı hüquqi narahatlıq və ya pozuntu bildirin")
  );

  const closeBtn = button("✕", "legal-modal-close", closeLegalModal);
  closeBtn.setAttribute("aria-label", isEn ? "Close" : "Bağla");
  header.append(titleGroup, closeBtn);

  const body = element("div", "legal-modal-body legal-report-modal-body");

  const noticeBox = element("div", "legal-report-notice-box");
  noticeBox.innerHTML = `
    <div class="legal-report-notice-icon">
      <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="10"></circle>
        <line x1="12" y1="8" x2="12" y2="12"></line>
        <line x1="12" y1="8" x2="12.01" y2="8"></line>
      </svg>
    </div>
    <div class="legal-report-notice-text">
      ${isEn
      ? 'AI responses may contain inaccuracies and should not be construed as professional legal or financial advice. For more details, review our <button type="button" class="legal-report-terms-link" id="legalReportTermsLink">Terms of Service</button>.'
      : 'Süni intellekt cavablarında qeyri-dəqiqlik və ya səhvlər ola bilər və onlar peşəkar məsləhət kimi qəbul edilməməlidir. Ətraflı məlumat üçün <button type="button" class="legal-report-terms-link" id="legalReportTermsLink">İstifadə şərtləri</button> ilə tanış olun.'}
    </div>
  `;
  noticeBox.querySelector("#legalReportTermsLink")?.addEventListener("click", (e) => {
    e.preventDefault();
    openLegalModal("terms");
  });
  body.appendChild(noticeBox);

  const form = document.createElement("form");
  form.className = "legal-report-form";

  if (messageContent) {
    const previewBox = element("div", "legal-report-context-box");
    const previewHeader = element("div", "legal-report-context-header");
    const previewLabel = element("span", "legal-report-context-label", isEn ? "Referenced Response" : "İstinad edilən cavab");
    const modelBadge = element("span", "legal-report-model-pill", model ? `Model: ${model}` : (isEn ? "AI Response" : "AI Cavabı"));
    previewHeader.append(previewLabel, modelBadge);

    const previewText = element("div", "legal-report-context-preview");
    previewText.textContent = messageContent.length > 350 ? messageContent.slice(0, 350) + "…" : messageContent;
    previewBox.append(previewHeader, previewText);
    form.appendChild(previewBox);
  }

  const typeField = element("div", "legal-report-field");
  const typeLabel = element("label", "legal-report-label");
  typeLabel.innerHTML = `<span>${isEn ? "Issue Category" : "Problem növü"}</span> <span class="required-star">*</span>`;

  const typeSelect = document.createElement("select");
  typeSelect.className = "legal-report-select";
  typeSelect.required = true;

  const defaultOption = document.createElement("option");
  defaultOption.value = "";
  defaultOption.textContent = isEn ? "Select an issue category…" : "Problem növünü seçin…";
  defaultOption.disabled = true;
  defaultOption.selected = true;
  typeSelect.appendChild(defaultOption);

  const issueTypes = isEn ? [
    "Copyright or intellectual property infringement",
    "Personal data and privacy violation",
    "Inaccurate, harmful, or dangerous legal advice",
    "Trademark or brand right violation",
    "Other legal or compliance issue",
  ] : [
    "Müəllif hüquqları və əqli mülkiyyət pozuntusu",
    "Fərdi məlumatlar və məxfilik pozuntusu",
    "Yanlış, zərərli və ya təhlükəli hüquqi məlumat",
    "Ticarət nişanı və ya brend hüquqlarının pozulması",
    "Digər hüquqi problem",
  ];

  issueTypes.forEach((text) => {
    const opt = document.createElement("option");
    opt.value = text;
    opt.textContent = text;
    typeSelect.appendChild(opt);
  });
  typeField.append(typeLabel, typeSelect);
  form.appendChild(typeField);

  const descField = element("div", "legal-report-field");
  const descLabel = element("label", "legal-report-label");
  descLabel.innerHTML = `<span>${isEn ? "Detailed Description" : "Problem haqqında təsvir"}</span> <span class="required-star">*</span>`;

  const descTextarea = document.createElement("textarea");
  descTextarea.className = "legal-report-textarea";
  descTextarea.rows = 4;
  descTextarea.maxLength = 4000;
  descTextarea.required = true;
  descTextarea.placeholder = isEn ? "Explain the nature of the issue and your concern in detail…" : "Problemin mahiyyətini və narahatlığınızı ətraflı izah edin…";

  const descHint = element("span", "legal-report-hint", isEn ? "Your inquiry will be reviewed under strict legal confidentiality." : "Müraciətiniz hüquqi məxfilik qaydalarına uyğun araşdırılacaqdır.");
  descField.append(descLabel, descTextarea, descHint);
  form.appendChild(descField);

  const emailField = element("div", "legal-report-field");
  const emailLabel = element("label", "legal-report-label");
  emailLabel.innerHTML = `<span>${isEn ? "Your Contact Email" : "Əlaqə üçün e-poçt ünvanınız"}</span> <span class="optional-tag">(${isEn ? "optional" : "istəyə bağlı"})</span>`;

  const emailInput = document.createElement("input");
  emailInput.type = "email";
  emailInput.className = "legal-report-input";
  emailInput.maxLength = 250;
  emailInput.placeholder = "you@example.com";
  if (state.currentUser && state.currentUser.email) {
    emailInput.value = state.currentUser.email;
  }
  const emailHint = element("span", "legal-report-hint", isEn ? "Allows our compliance team to respond regarding your report." : "Müraciətinizlə bağlı sizə geri dönüş edə bilməyimiz üçün.");
  emailField.append(emailLabel, emailInput, emailHint);
  form.appendChild(emailField);

  const errorBox = element("div", "legal-report-error");
  errorBox.style.display = "none";
  form.appendChild(errorBox);

  body.appendChild(form);

  const footer = element("div", "legal-modal-footer legal-report-modal-footer");
  const cancelBtn = button(isEn ? "Cancel" : "İmtina et", "secondary-button", closeLegalModal);
  cancelBtn.type = "button";

  const submitBtn = button(isEn ? "Submit Report" : "Bildirişi göndər", "primary-button legal-report-submit-btn");
  submitBtn.type = "button";

  const doSubmit = async (e) => {
    if (e) e.preventDefault();
    errorBox.style.display = "none";
    errorBox.textContent = "";

    const selectedType = typeSelect.value.trim();
    const description = descTextarea.value.trim();
    const userEmail = emailInput.value.trim();

    if (!selectedType) {
      errorBox.textContent = isEn ? "Please select an issue category." : "Zəhmət olmasa problem növünü seçin.";
      errorBox.style.display = "block";
      typeSelect.focus();
      return;
    }

    if (!description || description.length < 5) {
      errorBox.textContent = isEn ? "Please provide a detailed description (at least 5 characters)." : "Zəhmət olmasa problem haqqında ən azı 5 simvoldan ibarət ətraflı məlumat daxil edin.";
      errorBox.style.display = "block";
      descTextarea.focus();
      return;
    }

    submitBtn.disabled = true;
    cancelBtn.disabled = true;
    submitBtn.textContent = isEn ? "Submitting…" : "Göndərilir…";

    try {
      const res = await fetch("/api/legal-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          issueType: selectedType,
          description,
          userEmail: userEmail || undefined,
          messageContent: messageContent || "",
          model: model || "",
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || (isEn ? "An error occurred while submitting the report." : "Müraciət göndərilərkən xəta baş verdi."));
      }

      closeLegalModal();
      showToast(isEn ? "Your legal notice has been recorded and submitted for compliance review. Thank you!" : "Hüquqi probleminizlə bağlı müraciət qeydə alındı və nəzərdən keçirilmək üçün yönləndirildi. Təşəkkür edirik!", "success");
    } catch (err) {
      errorBox.textContent = err.message || (isEn ? "An error occurred. Please try again shortly." : "Xəta baş verdi. Zəhmət olmasa bir az sonra yenidən cəhd edin.");
      errorBox.style.display = "block";
      submitBtn.disabled = false;
      cancelBtn.disabled = false;
      submitBtn.textContent = isEn ? "Submit Report" : "Bildirişi göndər";
    }
  };

  submitBtn.addEventListener("click", doSubmit);
  form.addEventListener("submit", doSubmit);

  footer.append(cancelBtn, submitBtn);
  card.append(header, body, footer);
  overlay.appendChild(card);
  overlay.hidden = false;
  document.body.style.overflow = "hidden";
  setTimeout(() => typeSelect.focus(), 80);
}

function checkSensitiveData(txt) {
  if (!txt) return null;
  const isEn = getLanguage() === "en";
  const t = txt.trim();
  const phonePats = [
    /(?:\+994|00994|994)?[\s.-]?(?:0?(?:10|50|51|55|60|70|77|99|12|18|20|21|22|23|24|25|26|36))[\s.-]?[0-9]{3}[\s.-]?[0-9]{2}[\s.-]?[0-9]{2}/i,
    /(?:\btelefon|\bnömrə|\bnömrəm|\bmobil|\bwhatsapp|\bəlaqə|\bphone|\bcall|\btel)[\s:]*[\s.-]?(?:\+?[0-9]{1,4}[\s.-]?)?[0-9]{5,12}/i,
    /(?:\+\d{1,3}[\s.-]?)?\(?\d{2,4}\)?[\s.-]?\d{3}[\s.-]?\d{2}[\s.-]?\d{2,4}/,
    /\b0[1-9][0-9]{8}\b/,
  ];
  for (const r of phonePats) {
    if (r.test(t)) return isEn ? "Storing phone numbers in memory is not permitted." : "Yaddaşda telefon və ya mobil nömrələrin saxlanılmasına icazə verilmir.";
  }
  const addrPats = [
    /(?:yaşayış\s*ünvanı|ev\s*ünvanı|ev\s*ünvanım|yaşayış\s*yeri|evimin\s*ünvanı|qeydiyyat\s*ünvanı)/i,
    /(?:residential\s*address|home\s*address|living\s*address|apartment\s*address)/i,
    /(?:küç(?:əsi|\.)|prospekt(?:i|\.)|pr\.|döngə(?:si|\.)|dalan(?:ı|\.))\s*(?:[0-9]+|[A-ZƏÖĞÇŞÜa-zəöğçşü]+)\s*,?\s*(?:ev|bina|mənzil|blok|korpus|mərtəbə)\s*[0-9]+/i,
    /(?:ev|bina|korpus)\s*[0-9]+\s*,\s*mənzil\s*[0-9]+/i,
    /(?:mənzil\s*no|mənzil\s*№|mənzil\s*nömrəsi|apt\s*#|apt\s*no)\s*[0-9]+/i,
    /(?:yaşayıram|yaşayırıq)\s*:\s*.+/i,
  ];
  for (const r of addrPats) {
    if (r.test(t)) return isEn ? "Storing residential addresses in memory is not permitted." : "Yaddaşda dəqiq yaşayış və ya ev ünvanlarının saxlanılmasına icazə verilmir.";
  }
  const payPats = [
    /\b(?:\d{4}[ -]?){3}\d{4}\b/,
    /\b(?:cvv|cvc|cvv2|cvc2)(?:\s*(?:kodu?m?|code))?[\s:=]*[0-9]{3,4}\b/i,
    /\bAZ\d{2}[A-Z0-9]{24}\b/i,
    /(?:kart\s*nömrəsi|hesab\s*nömrəsi|kredit\s*kartı|bank\s*kartı)[\s:]*[0-9]{8,20}/i,
  ];
  for (const r of payPats) {
    if (r.test(t)) return isEn ? "Storing payment card or bank account details in memory is not permitted." : "Yaddaşda bank kartı, CVV və ya hesab məlumatlarının saxlanılmasına icazə verilmir.";
  }
  const idPats = [
    /(?:fin(?:\s*kodu?m?)?|f[iİ]n|şv(?:\s*seriya(?:sı)?)?|şəxsiyyət\s*vəsiqəsi|pasport(?:\s*nömrəsi)?|pin(?:\s*code|\s*kodu?m?)?|ssn)[\s:=]*[a-zA-Z0-9]{6,10}/i,
    /\b(?:AZE|AA)\s*[0-9]{7,8}\b/i,
  ];
  for (const r of idPats) {
    if (r.test(t)) return isEn ? "Storing government ID, passport, or PIN codes in memory is not permitted." : "Yaddaşda FİN kod, şəxsiyyət vəsiqəsi və ya pasport məlumatlarının saxlanılmasına icazə verilmir.";
  }
  const secPats = [
    /(?:şifrə(?:m)?|parol(?:um)?|password|api[_-]?key|secret[_-]?key|token|auth[_-]?token)[\s:=]+[\S]{4,}/i,
  ];
  for (const r of secPats) {
    if (r.test(t)) return isEn ? "Storing passwords, API keys, or confidential tokens in memory is not permitted." : "Yaddaşda şifrə, API açarı və ya məxfi tokenlərin saxlanılmasına icazə verilmir.";
  }
  return null;
}

function getImportMemoryPrompt() {
  const isEn = getLanguage() === "en";
  if (isEn) {
    return `Export my existing business and marketing context for migration to Helmer.

Review our past conversations, stored memory, and reliable facts known about me. Select ONLY persistent knowledge that will help Helmer generate more tailored marketing strategies, copy, campaigns, and business recommendations.

Whenever possible, preserve my exact phrasing, terminology, preferences, and explicit instructions without altering their meaning.

Only use facts you reliably know. Do not guess, invent, or extrapolate missing data.

Export the information using the following JSON structure:

{
  "brandName": "Brand or project name",
  "industry": "Industry or business sector",
  "primaryMarket": "Core market and geographic scope",
  "targetAudience": "Target audience description",
  "tone": "professional",
  "customInstructions": "Special marketing and strategic communication instructions Helmer should follow in future responses",
  "memories": [
    {
      "category": "business",
      "text": "Specific and enduring business or marketing fact"
    }
  ]
}

Include in memory items:
- Enduring facts about brand, business, products, and services;
- Industry, business model, and primary market;
- Known target audience and ideal customer profiles;
- Marketing, content, advertising, and communication preferences;
- Brand tone, language, and stylistic preferences;
- Enduring business rules and constraints;
- Active business objectives and projects that affect future Helmer outputs;
- Any other persistent business context helpful for strategy generation.

Do NOT include:
- Private personal details with no marketing relevance;
- One-off conversations, ephemeral questions, or transient events;
- Outdated or deprecated information;
- Passwords, API keys, credentials, phone numbers, exact residential addresses, or financial data;
- Sensitive personal data like health, political beliefs, religious views, ethnicity, or sexual orientation.

Rules:
1. Output MUST be valid, syntactically clean JSON only. No markdown fences, intro, explanation, or trailing notes.
2. "tone" must be strictly one of: "professional", "creative", "concise", "friendly", "data_driven".
3. Default to "tone": "professional" if style is unspecified.
4. "category" must be strictly one of: "business", "audience", "preference", "constraint", "general".
5. Each "memories" item should express a single clear fact, preference, or constraint.
6. Do not repeat duplicate or near-identical memory items.
7. Use empty string ("") for unknown root fields.
8. If no memory items apply, return "memories": [].
9. In "customInstructions", summarize how Helmer should tailor future outputs.
10. Ensure all keys and strings are double-quoted with no trailing commas.

Return JSON only.`;
  }

  return `Helmer-a keçid üçün mənim haqqımda mövcud biznes və marketinq kontekstini ixrac et.

Keçmiş söhbətlərimizi, mövcud yaddaşı və mənim haqqımda etibarlı şəkildə bildiyin məlumatları nəzərdən keçir. Yalnız Helmer-ın gələcəkdə daha uyğun marketinq strategiyaları, kontent, kampaniyalar və biznes tövsiyələri verməsinə kömək edəcək davamlı məlumatları seç.

Mümkün olduqda mənim öz ifadələrimi, terminologiyamı, seçimlərimi və verdiyim konkret təlimatları mənasını dəyişmədən qoru.

Yalnız həqiqətən bildiyin məlumatlardan istifadə et. Məlumatı təxmin etmə, uydurma və ya çatışmayan sahələri özün tamamlama.

Məlumatları aşağıdakı JSON strukturunda ixrac et:

{
  "brandName": "Brend və ya layihə adı",
  "industry": "Sənaye və ya fəaliyyət sahəsi",
  "primaryMarket": "Əsas bazar və coğrafiya",
  "targetAudience": "Hədəf auditoriya təsviri",
  "tone": "professional",
  "customInstructions": "Helmer-ın gələcək cavablarında nəzərə almalı olduğu xüsusi marketinq və kommunikasiya təlimatları",
  "memories": [
    {
      "category": "business",
      "text": "Konkret və davamlı biznes və ya marketinq faktı"
    }
  ]
}

Yaddaş qeydlərinə əsasən bunları daxil et:
- brend, biznes, məhsul və xidmətlər haqqında davamlı faktlar;
- fəaliyyət sahəsi, biznes modeli və əsas bazar;
- hədəf auditoriya və ideal müştəri haqqında məlum məlumatlar;
- marketinq, kontent, reklam və kommunikasiya üstünlükləri;
- brend tonu, dil və üslub seçimləri;
- davamlı biznes qaydaları və məhdudiyyətlər;
- gələcək Helmer cavablarına təsir edə biləcək aktiv biznes məqsədləri və layihələr;
- Helmer-ın daha uyğun nəticə verməsinə kömək edəcək digər davamlı biznes konteksti.

Daxil etmə:
- biznes və marketinq üçün praktik əhəmiyyəti olmayan şəxsi məlumatları;
- birdəfəlik söhbətləri, təsadüfi sualları və keçici hadisələri;
- artıq aktual olmadığı məlum olan məlumatları;
- şifrələri, API açarlarını, autentifikasiya məlumatlarını, telefon nömrələrini, dəqiq ünvanları, kart və bank məlumatlarını;
- sağlamlıq, siyasi baxışlar və mənsubiyyət, dini inanclar, etnik mənsubiyyət, cinsi həyat və ya oriyentasiya kimi həssas şəxsi məlumatları.

Qaydalar:
1. Cavab yalnız sintaktik olaraq etibarlı JSON olmalıdır. Markdown code block, giriş, izah, qeyd və ya əlavə mətn yazma.
2. "tone" yalnız bu dəyərlərdən biri ola bilər: "professional", "creative", "concise", "friendly", "data_driven".
3. İstifadəçinin üslub seçimi məlum deyilsə "tone": "professional" istifadə et.
4. "category" yalnız bu dəyərlərdən biri ola bilər: "business", "audience", "preference", "constraint", "general".
5. Hər "memories" elementi yalnız bir konkret fakt, üstünlük və ya qayda ifadə etməlidir.
6. Eyni və ya çox oxşar yaddaş faktlarını təkrarlama.
7. Məlum olmayan əsas sahələr üçün boş string ("") istifadə et.
8. Uyğun yaddaş faktı yoxdursa "memories": [] qaytar.
9. "customInstructions" daxilində faktları sadalamaq əvəzinə Helmer-ın gələcək cavablarını necə uyğunlaşdırmalı olduğunu qısa şəkildə ifadə et.
10. Bütün key və string-lər double quote ilə yazılmalı və trailing comma istifadə edilməməlidir.

Yalnız JSON qaytar.`;
}

const IMPORT_MEMORY_PROMPT = new Proxy({}, {
  get() {
    return getImportMemoryPrompt();
  },
  toString() {
    return getImportMemoryPrompt();
  },
});

function parseImportedMemoryText(raw) {
  if (!raw || typeof raw !== "string") {
    return { brandName: "", industry: "", primaryMarket: "", targetAudience: "", tone: "professional", customInstructions: "", memories: [], sensitiveExcluded: 0 };
  }

  const text = raw.trim();
  let parsedJson = null;

  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const jsonCandidate = codeBlockMatch ? codeBlockMatch[1].trim() : text;

  try {
    parsedJson = JSON.parse(jsonCandidate);
  } catch {
    const firstBrace = text.indexOf("{");
    const lastBrace = text.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      try {
        parsedJson = JSON.parse(text.slice(firstBrace, lastBrace + 1));
      } catch { }
    }
    if (!parsedJson) {
      const firstBracket = text.indexOf("[");
      const lastBracket = text.lastIndexOf("]");
      if (firstBracket !== -1 && lastBracket > firstBracket) {
        try {
          parsedJson = JSON.parse(text.slice(firstBracket, lastBracket + 1));
        } catch { }
      }
    }
  }

  let brandName = "";
  let industry = "";
  let primaryMarket = "";
  let targetAudience = "";
  let tone = "professional";
  let customInstructions = "";
  let rawMemories = [];
  let sensitiveExcluded = 0;

  const validTones = new Set(["professional", "creative", "concise", "friendly", "data_driven"]);
  const validCategories = new Set(["business", "audience", "preference", "constraint", "general"]);

  function sanitizeCategory(cat, txt = "") {
    const c = String(cat || "").toLowerCase().trim();
    if (validCategories.has(c)) return c;
    if (c.includes("biznes") || c.includes("business") || c.includes("fakt")) return "business";
    if (c.includes("auditor") || c.includes("kütlə") || c.includes("müştəri") || c.includes("audience")) return "audience";
    if (c.includes("üstün") || c.includes("pref") || c.includes("istək")) return "preference";
    if (c.includes("məhdud") || c.includes("qadağa") || c.includes("constrain") || c.includes("limit")) return "constraint";
    const lowerTxt = String(txt).toLowerCase();
    if (/(?:etmirik|olmaz|qadağandır|istifadə etmirik|don't|never|no tv|no radio|heç vaxt)/i.test(lowerTxt)) return "constraint";
    if (/(?:yaş|auditoriya|müştəri|gənc|qadın|kişi|segment|b2b|b2c)/i.test(lowerTxt)) return "audience";
    if (/(?:üstünlük|sevirik|əsasən|tərz|prioritet)/i.test(lowerTxt)) return "preference";
    if (/(?:şirkət|məhsul|xidmət|satış|qiymət|brend|biznes)/i.test(lowerTxt)) return "business";
    return "general";
  }

  if (parsedJson && typeof parsedJson === "object") {
    if (Array.isArray(parsedJson)) {
      rawMemories = parsedJson;
    } else {
      brandName = String(parsedJson.brandName || parsedJson.brand || parsedJson.name || "").trim().slice(0, 100);
      industry = String(parsedJson.industry || parsedJson.sector || parsedJson.sahə || "").trim().slice(0, 100);
      primaryMarket = String(parsedJson.primaryMarket || parsedJson.market || parsedJson.bazar || parsedJson.geography || "").trim().slice(0, 100);
      targetAudience = String(parsedJson.targetAudience || parsedJson.audience || parsedJson.hədəf || "").trim().slice(0, 500);
      if (validTones.has(parsedJson.tone)) tone = parsedJson.tone;
      customInstructions = String(parsedJson.customInstructions || parsedJson.instructions || parsedJson.təlimatlar || "").trim().slice(0, 2000);

      const memCandidate = parsedJson.memories || parsedJson.memory || parsedJson.facts || parsedJson.knowledge || parsedJson.items || parsedJson.qeydlər;
      if (Array.isArray(memCandidate)) {
        rawMemories = memCandidate;
      }
    }
  } else {
    const lines = text.split("\n");
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;

      const brandMatch = line.match(/^(?:brend|brand|layihə|şirkət)\s*[:=]\s*(.+)$/i);
      if (brandMatch && !brandName) { brandName = brandMatch[1].trim().slice(0, 100); continue; }

      const industryMatch = line.match(/^(?:sənaye|sahə|industry|sector)\s*[:=]\s*(.+)$/i);
      if (industryMatch && !industry) { industry = industryMatch[1].trim().slice(0, 100); continue; }

      const marketMatch = line.match(/^(?:bazar|coğrafiya|market|region)\s*[:=]\s*(.+)$/i);
      if (marketMatch && !primaryMarket) { primaryMarket = marketMatch[1].trim().slice(0, 100); continue; }

      const audienceMatch = line.match(/^(?:hədəf(?:\s*kütlə|\s*auditoriya)?|audience|target)\s*[:=]\s*(.+)$/i);
      if (audienceMatch && !targetAudience) { targetAudience = audienceMatch[1].trim().slice(0, 500); continue; }

      const toneMatch = line.match(/^(?:üslub|ton|tone|voice)\s*[:=]\s*(.+)$/i);
      if (toneMatch) {
        const tVal = toneMatch[1].trim().toLowerCase();
        if (validTones.has(tVal)) tone = tVal;
        continue;
      }

      const instrMatch = line.match(/^(?:təlimat(?:lar)?|instructions?|qaydalar)\s*[:=]\s*(.+)$/i);
      if (instrMatch && !customInstructions) { customInstructions = instrMatch[1].trim().slice(0, 2000); continue; }

      const bulletMatch = line.match(/^(?:[-*•+]|\d+[.)])\s*(.+)$/);
      if (bulletMatch) {
        const itemTxt = bulletMatch[1].trim();
        if (itemTxt) rawMemories.push(itemTxt);
      }
    }
  }

  const memories = [];
  const seen = new Set();

  for (const item of rawMemories) {
    let itemText = "";
    let itemCat = "general";

    if (typeof item === "string") {
      itemText = item.trim();
      itemCat = sanitizeCategory("", itemText);
    } else if (item && typeof item === "object") {
      itemText = String(item.text || item.fact || item.note || item.content || item.value || "").trim();
      itemCat = sanitizeCategory(item.category || item.type || item.cat, itemText);
    }

    if (!itemText) continue;
    itemText = itemText.slice(0, 500);

    const norm = itemText.toLowerCase();
    if (seen.has(norm)) continue;
    seen.add(norm);

    const sensitive = checkSensitiveData(itemText);
    if (sensitive) {
      sensitiveExcluded += 1;
      continue;
    }

    memories.push({
      id: `mem_imp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      text: itemText,
      category: itemCat,
      selected: true,
    });
  }

  return {
    brandName,
    industry,
    primaryMarket,
    targetAudience,
    tone,
    customInstructions,
    memories: memories.slice(0, 50),
    sensitiveExcluded,
  };
}

function openImportMemoryModal({ userSettings = {}, onImportSuccess = null } = {}) {
  const isEn = getLanguage() === "en";
  const overlay = document.querySelector("#legalModalOverlay");
  if (!overlay) return;

  overlay.replaceChildren();

  const card = element("div", "legal-modal-card import-memory-modal-card");

  // Header
  const header = element("header", "legal-modal-header import-memory-modal-header");

  const titleGroup = element("div", "legal-modal-title-group");
  titleGroup.append(
    element("h2", "", isEn ? "Memory & Brand Migration" : "Yaddaşın köçürülməsi"),
    element(
      "p",
      "",
      isEn
        ? "Import brand knowledge and strategic context from other AI assistants into Helmer."
        : "Başqa AI xidmətindəki yaddaş və brend məlumatlarını Helmer-a köçür."
    )
  );

  const closeBtn = button("✕", "legal-modal-close", closeLegalModal);
  closeBtn.setAttribute("aria-label", isEn ? "Close" : "Bağla");

  header.append(titleGroup, closeBtn);

  const body = element("div", "legal-modal-body import-memory-modal-body");

  // ------------------------------------------------------------
  // STEP 1
  // ------------------------------------------------------------
  const step1 = element("section", "import-step");

  const step1Header = element("div", "import-step-heading");
  step1Header.innerHTML = isEn ? `
    <span class="import-step-number">1</span>
    <div>
      <strong>Export Knowledge from Another AI</strong>
      <p>Copy and send this structured export prompt to ChatGPT, Claude, or Gemini.</p>
    </div>
  ` : `
    <span class="import-step-number">1</span>
    <div>
      <strong>Promptu AI xidmətinə göndər</strong>
      <p>ChatGPT, Claude və ya Gemini-yə bu promptu göndər.</p>
    </div>
  `;

  const currentPromptText = getImportMemoryPrompt();
  const promptBox = element("div", "import-prompt-box");

  const promptPreview = element("div", "import-prompt-preview");
  promptPreview.textContent = currentPromptText;

  const copyBtn = button(
    isEn ? "Copy prompt" : "Promptu kopyala",
    "secondary-button import-copy-btn",
    async () => {
      try {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(currentPromptText);
        } else {
          const ta = document.createElement("textarea");
          ta.value = currentPromptText;
          document.body.appendChild(ta);
          ta.select();
          document.execCommand("copy");
          ta.remove();
        }

        copyBtn.textContent = isEn ? "Copied ✓" : "Kopyalandı ✓";
        copyBtn.classList.add("is-copied");

        setTimeout(() => {
          copyBtn.textContent = isEn ? "Copy prompt" : "Promptu kopyala";
          copyBtn.classList.remove("is-copied");
        }, 1800);

        showToast(isEn ? "Prompt copied to clipboard." : "Prompt kopyalandı.");
      } catch {
        showToast(isEn ? "Unable to copy prompt." : "Promptu kopyalamaq mümkün olmadı.", "error");
      }
    }
  );

  copyBtn.type = "button";

  promptBox.append(promptPreview, copyBtn);
  step1.append(step1Header, promptBox);

  // ------------------------------------------------------------
  // STEP 2
  // ------------------------------------------------------------
  const step2 = element("section", "import-step");

  const step2Header = element("div", "import-step-heading");
  step2Header.innerHTML = isEn ? `
    <span class="import-step-number">2</span>
    <div>
      <strong>Paste AI Output</strong>
      <p>Paste the structured JSON or response generated by your AI assistant below.</p>
    </div>
  ` : `
    <span class="import-step-number">2</span>
    <div>
      <strong>Cavabı bura yapışdır</strong>
      <p>AI tərəfindən yaradılmış JSON və ya mətn nəticəsini daxil et.</p>
    </div>
  `;

  const textarea = element(
    "textarea",
    "settings-input settings-textarea import-textarea"
  );

  textarea.rows = 5;
  textarea.placeholder = isEn ? `Paste the AI JSON output here...

{
  "brandName": "Helmer",
  "industry": "B2B SaaS",
  "memories": [...]
}` : `AI cavabını buraya yapışdır...

{
  "brandName": "Helmer",
  "industry": "B2B SaaS",
  "memories": [...]
}`;

  step2.append(step2Header, textarea);

  // ------------------------------------------------------------
  // STEP 3
  // ------------------------------------------------------------
  const step3 = element("section", "import-step import-step-review");

  const step3Header = element("div", "import-step-heading");
  step3Header.innerHTML = isEn ? `
    <span class="import-step-number">3</span>
    <div>
      <strong>Review & Finalize Import</strong>
      <p>Review the extracted brand facts and choose how to merge them into your workspace.</p>
    </div>
  ` : `
    <span class="import-step-number">3</span>
    <div>
      <strong>Nəticəni yoxla</strong>
      <p>Aşkarlanan məlumatları nəzərdən keçir və idxal et.</p>
    </div>
  `;

  const previewContainer = element("div", "import-preview-container");

  step3.append(step3Header, previewContainer);

  let currentParsedData = null;
  let importMode = "merge";
  let enablePersonalIntelligence = true;

  function createImportChip(label, value) {
    const chip = element("div", "import-chip");

    chip.innerHTML = `
      <span class="import-chip-label">${escapeHtml(label)}</span>
      <span class="import-chip-val">${escapeHtml(value)}</span>
    `;

    return chip;
  }

  function createModeOption({
    value,
    title,
    description,
    recommended = false,
  }) {
    const label = element(
      "label",
      `import-mode-option${importMode === value ? " is-selected" : ""}`
    );

    const radio = document.createElement("input");
    radio.type = "radio";
    radio.name = "importMode";
    radio.value = value;
    radio.checked = importMode === value;
    radio.className = "import-mode-radio";

    const text = element("div", "import-mode-text");
    text.innerHTML = `
      <strong>
        ${escapeHtml(title)}
        ${recommended ? `<span class="import-recommended">${isEn ? "Recommended" : "Tövsiyə olunur"}</span>` : ""}
      </strong>
      <p>${escapeHtml(description)}</p>
    `;

    radio.addEventListener("change", () => {
      importMode = value;

      document
        .querySelectorAll(".import-mode-option")
        .forEach((item) => item.classList.remove("is-selected"));

      label.classList.add("is-selected");
    });

    label.append(radio, text);
    return label;
  }

  const renderPreview = () => {
    previewContainer.replaceChildren();

    const raw = textarea.value.trim();

    if (!raw) {
      const empty = element(
        "div",
        "import-preview-empty",
        isEn
          ? "Discovered knowledge attributes and memory items will appear here once pasted."
          : "Cavabı yapışdırdıqdan sonra aşkarlanan məlumatlar burada görünəcək."
      );

      previewContainer.appendChild(empty);
      currentParsedData = null;
      return;
    }

    currentParsedData = parseImportedMemoryText(raw);

    const hasProfile = Boolean(
      currentParsedData.brandName ||
      currentParsedData.industry ||
      currentParsedData.primaryMarket ||
      currentParsedData.targetAudience ||
      currentParsedData.customInstructions ||
      (currentParsedData.tone &&
        currentParsedData.tone !== "professional")
    );

    const hasMemories = currentParsedData.memories.length > 0;

    if (!hasProfile && !hasMemories) {
      const warning = element("div", "import-warning-box");

      warning.innerHTML = isEn ? `
        <strong>No valid knowledge detected</strong>
        <p>Make sure you copied the complete JSON response from your AI assistant.</p>
      ` : `
        <strong>Məlumat aşkarlanmadı</strong>
        <p>AI cavabının tam şəkildə kopyalandığından əmin ol.</p>
      `;

      previewContainer.appendChild(warning);
      return;
    }

    // Sensitive data alert
    if (currentParsedData.sensitiveExcluded > 0) {
      const notice = element("div", "import-sensitive-alert");

      notice.innerHTML = `
        <span>
          ${isEn
          ? `${currentParsedData.sensitiveExcluded} sensitive data items were excluded for security reasons.`
          : `${currentParsedData.sensitiveExcluded} həssas məlumat təhlükəsizlik səbəbilə idxaldan çıxarıldı.`}
        </span>
      `;

      previewContainer.appendChild(notice);
    }

    // Profile
    if (hasProfile) {
      const profileBox = element("div", "import-review-section");

      profileBox.appendChild(
        element("strong", "import-section-subtitle", isEn ? "Brand & Profile Knowledge" : "Brend və profil")
      );

      const chipGrid = element("div", "import-chips-grid");

      const toneNames = isEn ? {
        professional: "Professional",
        creative: "Creative",
        concise: "Concise",
        friendly: "Friendly",
        data_driven: "Data-Driven",
      } : {
        professional: "Peşəkar",
        creative: "Yaradıcı",
        concise: "Qısa və konkret",
        friendly: "Dostcasına",
        data_driven: "Nəticə yönümlü",
      };

      if (currentParsedData.brandName) {
        chipGrid.appendChild(
          createImportChip(isEn ? "Brand" : "Brend", currentParsedData.brandName)
        );
      }

      if (currentParsedData.industry) {
        chipGrid.appendChild(
          createImportChip(isEn ? "Industry" : "Sahə", currentParsedData.industry)
        );
      }

      if (currentParsedData.primaryMarket) {
        chipGrid.appendChild(
          createImportChip(isEn ? "Market" : "Bazar", currentParsedData.primaryMarket)
        );
      }

      if (currentParsedData.targetAudience) {
        chipGrid.appendChild(
          createImportChip(isEn ? "Audience" : "Auditoriya", currentParsedData.targetAudience)
        );
      }

      if (currentParsedData.tone) {
        chipGrid.appendChild(
          createImportChip(
            isEn ? "Tone" : "Üslub",
            toneNames[currentParsedData.tone] || currentParsedData.tone
          )
        );
      }

      if (currentParsedData.customInstructions) {
        chipGrid.appendChild(
          createImportChip(
            isEn ? "Instructions" : "Təlimat",
            currentParsedData.customInstructions
          )
        );
      }

      profileBox.appendChild(chipGrid);
      previewContainer.appendChild(profileBox);
    }

    // Memories
    if (hasMemories) {
      const memBox = element("div", "import-review-section");

      const memHeader = element("div", "import-memories-header");

      memHeader.append(
        element(
          "strong",
          "import-section-subtitle",
          isEn ? `Memory Notes · ${currentParsedData.memories.length}` : `Yaddaş qeydləri · ${currentParsedData.memories.length}`
        ),
        element(
          "span",
          "import-hint-text",
          isEn ? "Deselect any items you wish to omit." : "İstəmədiyin qeydlərin seçimini sil."
        )
      );

      const list = element("div", "import-memories-list");

      const categoryNames = isEn ? {
        business: "Business",
        audience: "Audience",
        preference: "Preference",
        constraint: "Constraint",
        general: "Note",
      } : {
        business: "Biznes",
        audience: "Auditoriya",
        preference: "Üstünlük",
        constraint: "Məhdudiyyət",
        general: "Qeyd",
      };

      currentParsedData.memories.forEach((mem) => {
        const row = element("label", "import-memory-item-row");

        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.className = "import-memory-checkbox";
        checkbox.checked = mem.selected !== false;

        checkbox.addEventListener("change", () => {
          mem.selected = checkbox.checked;
        });

        const tag = element(
          "span",
          `memory-category-tag tag-${mem.category || "general"}`,
          categoryNames[mem.category] || (isEn ? "Note" : "Qeyd")
        );

        const text = element("span", "import-memory-text", mem.text);

        row.append(checkbox, tag, text);
        list.appendChild(row);
      });

      memBox.append(memHeader, list);
      previewContainer.appendChild(memBox);
    }

    // Import mode
    const settingsBox = element("div", "import-review-section import-options-box");

    settingsBox.appendChild(
      element("strong", "import-section-subtitle", isEn ? "Import Mode" : "İdxal üsulu")
    );

    const modeWrap = element("div", "import-mode-selector");

    modeWrap.append(
      createModeOption({
        value: "merge",
        title: isEn ? "Merge with existing memory" : "Mövcud yaddaşla birləşdir",
        description: isEn ? "Preserves current notes while appending newly discovered facts." : "Cari məlumatlar qalır, yeni faktlar əlavə olunur.",
        recommended: true,
      }),
      createModeOption({
        value: "replace",
        title: isEn ? "Replace existing memory" : "Yaddaşı əvəzlə",
        description: isEn ? "Clears previous notes and sets newly imported data." : "Cari yaddaş silinir və yalnız bu məlumatlar saxlanılır.",
      })
    );

    const autoEnableRow = element("label", "import-auto-enable-row");

    const autoEnableCheck = document.createElement("input");
    autoEnableCheck.type = "checkbox";
    autoEnableCheck.className = "import-auto-enable-check";
    autoEnableCheck.checked = enablePersonalIntelligence;

    autoEnableCheck.addEventListener("change", () => {
      enablePersonalIntelligence = autoEnableCheck.checked;
    });

    autoEnableRow.append(
      autoEnableCheck,
      element(
        "span",
        "",
        isEn ? "Enable personalized experience automatically" : "Fərdiləşdirilmiş təcrübəni aktiv et"
      )
    );

    settingsBox.append(modeWrap, autoEnableRow);
    previewContainer.appendChild(settingsBox);
  };

  textarea.addEventListener("input", renderPreview);

  renderPreview();

  body.append(step1, step2, step3);

  // ------------------------------------------------------------
  // FOOTER
  // ------------------------------------------------------------
  const footer = element(
    "div",
    "legal-modal-footer import-modal-footer"
  );

  const cancelBtn = button(
    isEn ? "Cancel" : "Ləğv et",
    "secondary-button",
    closeLegalModal
  );

  const confirmBtn = button(
    isEn ? "Confirm Import" : "Təsdiqlə",
    "primary-button import-confirm-btn",
    async () => {
      if (!currentParsedData) {
        renderPreview();
      }

      if (!currentParsedData) {
        showToast(isEn ? "Please paste AI output first." : "Əvvəlcə AI cavabını yapışdır.", "error");
        return;
      }

      const selectedMemories = (
        currentParsedData.memories || []
      ).filter((m) => m.selected !== false);

      const hasProfileData = Boolean(
        currentParsedData.brandName ||
        currentParsedData.industry ||
        currentParsedData.primaryMarket ||
        currentParsedData.targetAudience ||
        currentParsedData.customInstructions ||
        (currentParsedData.tone &&
          currentParsedData.tone !== "professional")
      );

      if (!hasProfileData && !selectedMemories.length) {
        showToast(
          isEn ? "No items selected to import." : "İdxal ediləcək məlumat seçilməyib.",
          "error"
        );
        return;
      }

      const payload = {
        brandName: currentParsedData.brandName || "",
        industry: currentParsedData.industry || "",
        primaryMarket: currentParsedData.primaryMarket || "",
        targetAudience: currentParsedData.targetAudience || "",
        tone: currentParsedData.tone || "professional",
        customInstructions:
          currentParsedData.customInstructions || "",
        memories: selectedMemories.map((m) => ({
          text: m.text,
          category: m.category,
        })),
        mergeMode: importMode,
        enablePersonalIntelligence,
      };

      const importMemory = async () => {
        confirmBtn.disabled = true;
        confirmBtn.textContent = isEn ? "Importing…" : "İdxal edilir…";

        try {
          const res = await authRequest(
            "/api/auth/settings/import-memory",
            {
              method: "POST",
              body: JSON.stringify(payload),
            }
          );

          closeLegalModal();

          if (typeof onImportSuccess === "function") {
            onImportSuccess(res.user);
          } else {
            updateWorkspaceIdentity(res.user);
          }

          showToast(
            isEn
              ? `Memory imported · ${res.importedCount || selectedMemories.length} facts`
              : `Yaddaş idxal edildi · ${res.importedCount || selectedMemories.length} fakt`
          );
        } catch (err) {
          showToast(
            err.message || (isEn ? "An error occurred during import." : "İdxal zamanı xəta baş verdi."),
            "error"
          );

          confirmBtn.disabled = false;
          confirmBtn.textContent = isEn ? "Confirm Import" : "Yaddaşı köçür";
        }
      };

      if (enablePersonalIntelligence && userSettings.personalIntelligence !== true) {
        openPersonalizationConsentModal(importMemory);
        return;
      }

      await importMemory();
    }
  );

  confirmBtn.type = "button";

  footer.append(cancelBtn, confirmBtn);

  card.append(header, body, footer);
  overlay.appendChild(card);

  overlay.hidden = false;
  document.body.style.overflow = "hidden";
}

window.addEventListener("helmer:account-restored", () => {
  const isEn = getLanguage() === "en";
  showToast(isEn ? "Welcome back! The 14-day deletion request was canceled and your account has been restored." : "Xoş gəldiniz! 14 günlük silinmə sorğusu ləğv edildi və hesabınız bərpa olundu.", "success");
});

function navigateHome() {
  if (state.view !== "home") {
    state.view = "home";
    syncMode();
    syncNav();
    render();
  } else {
    if (state.mode === "ask") startNewChat();
    else resetStrategy();
  }
}

newStrategyButton?.addEventListener("click", () => {
  if (state.mode === "ask") startNewChat();
  else resetStrategy();
});
document.querySelector("#mobileNewButton")?.addEventListener("click", () => {
  if (state.mode === "ask") startNewChat();
  else resetStrategy();
});
mobileMenuButton.addEventListener("click", () => (sidebar.classList.contains("is-open") ? closeSidebar() : openSidebar()));
railMenuButton.addEventListener("click", () => (sidebar.classList.contains("is-open") ? closeSidebar() : openSidebar()));
railHomeButton.addEventListener("click", navigateHome);
railStrategiesButton.addEventListener("click", () => {
  if (!state.currentUser) {
    closeSidebar();
    openGuestRestrictionModal(GUEST_RESTRICTION_NOTICES.strategy);
    return;
  }
  hideRailArchivePopover(true);
  state.view = "list";
  syncNav();
  render();
  closeSidebar();
});
for (const id of ["upNav", "railUpButton"]) document.getElementById(id)?.addEventListener("click", () => {
  state.view = "up";
  render();
  closeSidebar();
  workspace.focus();
});
railPlannerButton?.addEventListener("click", () => {
  if (!state.currentUser) {
    closeSidebar();
    openGuestRestrictionModal(GUEST_RESTRICTION_NOTICES.planner);
    return;
  }
  state.view = "planner";
  syncNav();
  render();
  closeSidebar();
  loadPlannerTasks();
});
railSearchButton?.addEventListener("click", () => {
  openSearchModal();
});
railInstallAppButton?.addEventListener("click", () => {
  handleInstallAppClick();
});
railLangToggleButton?.addEventListener("click", async () => {
  const currentLang = getLanguage();
  const nextLang = currentLang === "az" ? "en" : "az";
  setLanguage(nextLang, true);
  if (state.currentUser) {
    try {
      await authRequest("/api/auth/settings", { method: "PATCH", body: JSON.stringify({ language: nextLang }) });
    } catch { }
  }
  showToast(
    t("settings.languageSelector.toastChanged", {}, nextLang) ||
    (nextLang === "en" ? "Interface language updated." : "İnterfeys dili dəyişdirildi."),
    "success"
  );
});
railAccountButton?.addEventListener("click", (e) => {
  e.stopPropagation();
  openUserProfileMenu(railAccountButton);
});
sidebarClose.addEventListener("click", closeSidebar);
mobileOverlay.addEventListener("click", closeSidebar);
document.querySelectorAll(".brand").forEach((brandEl) => {
  brandEl.addEventListener("click", (e) => {
    e.preventDefault();
    navigateHome();
  });
});
searchNav?.addEventListener("click", () => {
  openSearchModal();
});
const recentCollapseToggle = document.querySelector("#recentCollapseToggle");
const recentSection = document.querySelector("#recentSection");
if (recentCollapseToggle && recentSection) {
  try {
    if (localStorage.getItem("helmer_recent_collapsed") === "true") {
      recentSection.classList.add("is-collapsed");
      recentCollapseToggle.setAttribute("aria-expanded", "false");
    }
  } catch { }
  recentCollapseToggle.addEventListener("click", () => {
    const isCollapsed = recentSection.classList.toggle("is-collapsed");
    recentCollapseToggle.setAttribute("aria-expanded", String(!isCollapsed));
    try {
      localStorage.setItem("helmer_recent_collapsed", String(isCollapsed));
    } catch { }
  });
}
homeNav.addEventListener("click", () => {
  navigateHome();
  closeSidebar();
});
strategiesNav.addEventListener("click", () => {
  if (!state.currentUser) {
    closeSidebar();
    openGuestRestrictionModal(GUEST_RESTRICTION_NOTICES.strategy);
    return;
  }
  state.view = "list";
  syncNav();
  render();
  closeSidebar();
});
plannerNav?.addEventListener("click", () => {
  if (!state.currentUser) {
    closeSidebar();
    openGuestRestrictionModal(GUEST_RESTRICTION_NOTICES.planner);
    return;
  }
  state.view = "planner";
  syncNav();
  render();
  closeSidebar();
  loadPlannerTasks();
});
installAppNav?.addEventListener("click", () => {
  closeSidebar();
  handleInstallAppClick();
});
whatsNewNav?.addEventListener("click", () => {
  openChangelogModal();
  closeSidebar();
});
accountButton?.addEventListener("click", (e) => {
  e.stopPropagation();
  openUserProfileMenu(accountButton);
});
document.querySelector("#sidebarTermsBtn")?.addEventListener("click", () => {
  closeSidebar();
  openLegalModal("terms");
});
document.querySelector("#sidebarPrivacyBtn")?.addEventListener("click", () => {
  closeSidebar();
  openLegalModal("privacy");
});
keyboardShortcutsButton?.addEventListener("click", () => {
  closeSidebar();
  openShortcutModal();
});
document.querySelector("#legalModalOverlay")?.addEventListener("click", (event) => {
  if (event.target === document.querySelector("#legalModalOverlay")) closeLegalModal();
});
keyboardShortcutsOverlay?.addEventListener("click", (event) => {
  if (event.target === keyboardShortcutsOverlay) closeShortcutModal();
});
installAppModalOverlay?.addEventListener("click", (event) => {
  if (event.target === installAppModalOverlay) closeInstallAppModal();
});
changelogModalOverlay?.addEventListener("click", (event) => {
  if (event.target === changelogModalOverlay) closeChangelogModal();
});
mobileBottomSheetOverlay?.addEventListener("click", (event) => {
  if (event.target === mobileBottomSheetOverlay) closeMobileBottomSheet();
});
mobileModelSheetOverlay?.addEventListener("click", (event) => {
  if (event.target === mobileModelSheetOverlay) closeMobileModelSheet();
});
mobileProfileSheetOverlay?.addEventListener("click", (event) => {
  if (event.target === mobileProfileSheetOverlay) closeUserProfileMenu();
});
mobileNotifSheetOverlay?.addEventListener("click", (event) => {
  if (event.target === mobileNotifSheetOverlay) closePlannerNotificationSheet();
});
guideModalOverlay?.addEventListener("click", (event) => {
  if (event.target === guideModalOverlay) closeGuideModal();
});
buildModeButton?.addEventListener("click", () => {
  if (state.mode !== "build") setMode("build");
  else openMobileModelSheet("build");
});
buildModeButton?.querySelector(".mobile-mode-chevron")?.addEventListener("click", (event) => {
  event.stopPropagation();
  if (state.mode !== "build") setMode("build");
  openMobileModelSheet("build");
});
askModeButton?.addEventListener("click", () => {
  if (state.mode !== "ask") {
    setMode("ask");
  } else {
    openMobileModelSheet();
  }
});
askModeButton?.querySelector(".mobile-mode-chevron")?.addEventListener("click", (event) => {
  event.stopPropagation();
  if (state.mode !== "ask") {
    setMode("ask");
  }
  openMobileModelSheet();
});
document.querySelector("#mobileChatMenuButton")?.addEventListener("click", openSidebar);
document.querySelector("#mobileChatModelButton")?.addEventListener("click", () => {
  openMobileModelSheet();
});
document.querySelector("#mobileMoreButton")?.addEventListener("click", (event) => {
  event.stopPropagation();
  openUserProfileMenu(document.querySelector("#mobileMoreButton"));
});
sidebarBuildModeButton?.addEventListener("click", () => setMode("build"));
sidebarAskModeButton?.addEventListener("click", () => setMode("ask"));

window.addEventListener("resize", () => {
  if (window.innerWidth > 767) {
    closeMobileBottomSheet();
    closeMobileModelSheet();
  }
});
let railModeClickTimeout = null;
let railModeLastClick = 0;

railModeToggleButton?.addEventListener("click", () => {
  const now = Date.now();
  const diff = now - railModeLastClick;
  railModeLastClick = now;

  if (diff < 320) {
    if (railModeClickTimeout) {
      clearTimeout(railModeClickTimeout);
      railModeClickTimeout = null;
    }
    const nextMode = state.mode === "build" ? "ask" : "build";
    setDefaultWorkspaceMode(nextMode);
    return;
  }

  railModeClickTimeout = setTimeout(() => {
    railModeClickTimeout = null;
    const nextMode = state.mode === "build" ? "ask" : "build";
    setMode(nextMode);
  }, 260);
});

railModeToggleButton?.addEventListener("dblclick", (event) => {
  event.preventDefault();
  if (railModeClickTimeout) {
    clearTimeout(railModeClickTimeout);
    railModeClickTimeout = null;
  }
  const now = Date.now();
  if (now - lastDefaultSavedTime < 400) return;
  const nextMode = state.mode === "build" ? "ask" : "build";
  setDefaultWorkspaceMode(nextMode);
});

function handleKeyboardShortcut(event) {
  if (event.key === "Escape") {
    if (searchModalOverlay) {
      closeSearchModal();
      return;
    }
    if (changelogModalOverlay && !changelogModalOverlay.hidden) {
      closeChangelogModal();
      return;
    }
    if (guideModalOverlay && !guideModalOverlay.hidden) {
      closeGuideModal();
      return;
    }
    const hadOverlay = Boolean(
      sidebar.classList.contains("is-open") ||
      (mobileOverlay && !mobileOverlay.hidden) ||
      document.querySelector("#legalModalOverlay:not([hidden])") ||
      document.querySelector("#keyboardShortcutsOverlay:not([hidden])") ||
      document.querySelector("#installAppModalOverlay:not([hidden])") ||
      document.querySelector("#changelogModalOverlay:not([hidden])") ||
      document.querySelector("#guideModalOverlay:not([hidden])") ||
      document.querySelector("#mobileBottomSheetOverlay:not([hidden])") ||
      document.querySelector("#mobileModelSheetOverlay:not([hidden])") ||
      document.querySelector("#mobileProfileSheetOverlay:not([hidden])") ||
      document.querySelector("#mobileNotifSheetOverlay:not([hidden])") ||
      document.querySelector("#profilePopoverMenu:not([hidden])") ||
      document.querySelector("#appShell.is-sidebar-open")
    );
    closeSidebar();
    closeLegalModal();
    closeShortcutModal();
    closeInstallAppModal();
    closeChangelogModal();
    closeGuideModal();
    closeMobileBottomSheet();
    closeMobileModelSheet();
    closeUserProfileMenu();
    closePlannerNotificationSheet();
    if (!hadOverlay && state.view === "settings") {
      state.view = state.previousView || "home";
      syncNav();
      render();
    }
    return;
  }

  if (window.innerWidth <= 767) return;

  const typing = isTypingTarget(event.target);
  const primary = event.metaKey || event.ctrlKey;
  const key = event.code === "KeyN" ? "n" : (event.code === "KeyK" ? "k" : (typeof event.key === "string" ? event.key.toLowerCase() : ""));

  if (primary && key === "k") {
    event.preventDefault();
    openSearchModal();
    return;
  }

  if (!typing && (event.key === "?" || (primary && event.key === "/"))) {
    event.preventDefault();
    openShortcutModal();
    return;
  }

  if (typing && primary && event.key === "/") {
    event.preventDefault();
    openShortcutModal();
    return;
  }

  if (!primary || event.isComposing) return;

  // Alt/Option is intentionally allowed for the new-workspace fallback.
  if (event.altKey && key !== "n") return;

  if (event.shiftKey && key === "a") {
    event.preventDefault();
    setMode(state.mode === "build" ? "ask" : "build");
    return;
  }

  const actions = {
    n: () => newStrategyButton?.click(),
    k: () => openSearchModal(),
    "1": () => homeNav?.click(),
    "2": () => strategiesNav?.click(),
    "3": () => plannerNav?.click(),
    ",": () => openSettings(),
  };

  if (actions[key]) {
    event.preventDefault();
    actions[key]();
  }
}

// Capture phase gives app shortcuts the earliest possible chance to run.
window.addEventListener("keydown", handleKeyboardShortcut, true);

// Prevent accidental file drop outside dropzone from navigating away from the app
window.addEventListener("dragover", (e) => {
  if (e.dataTransfer?.types?.includes("Files")) {
    e.preventDefault();
  }
});
window.addEventListener("drop", (e) => {
  if (e.dataTransfer?.types?.includes("Files")) {
    e.preventDefault();
  }
});

export function showV35ReleaseToast() {
  const STORAGE_KEY = "helmer_v4_release_toast_dismissed";
  const LEGACY_STORAGE_KEY = "helmer_v3_5_release_toast_dismissed";
  try {
    if (localStorage.getItem(STORAGE_KEY) === "dismissed") return;
  } catch { }
  if (document.querySelector("#v35ReleaseToast")) return;

  const AUTO_DISMISS_SECONDS = 16;

  const toast = element("aside", "v35-release-toast");
  toast.id = "v35ReleaseToast";
  toast.setAttribute("role", "status");
  toast.setAttribute("aria-live", "polite");

  let autoDismissTimer;

  const dismiss = () => {
    clearTimeout(autoDismissTimer);
    toast.classList.add("is-dismissing");
    setTimeout(() => toast.remove(), 280);
  };

  const dismissPermanently = () => {
    try {
      localStorage.setItem(STORAGE_KEY, "dismissed");
    } catch { }
    dismiss();
  };

  const header = element("div", "v35-toast-header");
  const title = element(
    "h3",
    "v35-toast-title",
    t("announcement.title")
  );
  title.id = "v35ToastTitle";

  const closeBtn = button("✕", "v35-toast-close", dismissPermanently);
  closeBtn.setAttribute("aria-label", t("announcement.closeAria"));
  closeBtn.id = "v35ToastCloseBtn";
  header.append(title, closeBtn);

  const body = element(
    "p",
    "v35-toast-body",
    t("announcement.body")
  );
  body.id = "v35ToastBody";

  const actions = element("div", "v35-toast-actions");
  const dontShowBtn = button(t("announcement.dontShow"), "secondary-button v35-toast-dontshow-btn", dismissPermanently);
  dontShowBtn.type = "button";
  dontShowBtn.id = "v35ToastDontShowBtn";

  const ctaBtn = button(t("announcement.cta"), "primary-button v35-toast-cta-btn", () => {
    dismissPermanently();
    document.querySelector("#intakeQueryInput")?.focus();
  });
  ctaBtn.type = "button";
  ctaBtn.id = "v35ToastCtaBtn";

  actions.append(dontShowBtn, ctaBtn);
  toast.append(header, body, actions);

  // Auto-dismiss progress bar
  const progressWrap = element("div", "v35-toast-progress-wrap");
  const progressBar = element("div", "v35-toast-progress-bar");
  progressWrap.appendChild(progressBar);
  toast.appendChild(progressWrap);
  progressBar.style.animationDuration = AUTO_DISMISS_SECONDS + "s";

  document.body.appendChild(toast);
  requestAnimationFrame(() => {
    toast.classList.add("is-visible");
    progressBar.classList.add("is-running");
  });

  autoDismissTimer = setTimeout(dismiss, AUTO_DISMISS_SECONDS * 1000);

  // Pause auto-dismiss on hover
  toast.addEventListener("mouseenter", () => {
    clearTimeout(autoDismissTimer);
    progressBar.style.animationPlayState = "paused";
  });
  toast.addEventListener("mouseleave", () => {
    autoDismissTimer = setTimeout(dismiss, AUTO_DISMISS_SECONDS * 1000);
    progressBar.style.animationPlayState = "running";
  });

  // Language update listener
  const updateToastLanguage = () => {
    if (title) title.textContent = t("announcement.title");
    if (body) body.textContent = t("announcement.body");
    if (dontShowBtn) dontShowBtn.textContent = t("announcement.dontShow");
    if (ctaBtn) ctaBtn.textContent = t("announcement.cta");
    if (closeBtn) closeBtn.setAttribute("aria-label", t("announcement.closeAria"));
  };
  window.addEventListener("helmer:language-change", updateToastLanguage);
}

// Global helmer:language-change handler to re-render components on language switch
window.addEventListener("helmer:language-change", () => {
  syncMode();
  syncNav();
  renderRecentList();
  render();
});

window.addEventListener("storage", (event) => {
  if (event.key === "helmer_language" && (event.newValue === "az" || event.newValue === "en")) {
    setLanguage(event.newValue, false);
  }
});

// Render the workspace immediately while authentication and saved data load in the background.
if (!new Set(["/login", "/signin", "/signup", "/register", "/forgot-password", "/reset-password", "/verify-email"]).has(window.location.pathname)) {
  if (window.location.pathname === "/profile" || window.location.pathname === "/settings") {
    state.view = "settings";
    state.settingsTab = "account";
  }
  render();
}

let startupAskChat;
try { startupAskChat = JSON.parse(sessionStorage.getItem("helmer_active_ask_chat")); } catch { }
initializeAuthentication(async (user) => {
  const previousAskChat = startupAskChat;
  startupAskChat = null;
  updateWorkspaceIdentity(user);
  const epoch = state.identityEpoch;
  const expectedUserId = user?.id || null;
  const preferredMode = user?.settings?.defaultMode || getCookie("helmer_default_mode");
  if (preferredMode === "ask" || preferredMode === "build") {
    setCookie("helmer_default_mode", preferredMode);
    try { localStorage.removeItem("helmer_default_mode"); } catch { }
  }
  const sessionMode = (() => {
    try { return sessionStorage.getItem("helmer_session_mode"); } catch { return null; }
  })();
  const activeMode = sessionMode || preferredMode;
  if (activeMode === "ask" || activeMode === "build") {
    state.mode = activeMode;
    syncMode();
    syncNav();
  }
  const params = new URLSearchParams(window.location.search);
  const requestedMode = params.get("mode");
  if (["ask", "build"].includes(requestedMode)) setMode(requestedMode);
  const requestedView = params.get("view");
  if (["limits", "up", "settings"].includes(requestedView)) {
    state.view = requestedView;
  } else if (requestedView === "profile" || window.location.pathname === "/profile" || window.location.pathname === "/settings") {
    state.view = "settings";
    const requestedTab = params.get("tab");
    state.settingsTab = ["account", "experience", "security", "legal"].includes(requestedTab) ? requestedTab : "account";
  }
  render();
  await Promise.allSettled([loadSavedStrategies(), loadSavedChats(), loadPlannerTasks(), loadUsageStats()]);
  if (isIdentityStale(epoch, expectedUserId)) return;
  if (expectedUserId && previousAskChat?.ownerId === expectedUserId &&
      /^[0-9a-f-]{36}$/i.test(previousAskChat.chatId) && state.mode === "ask" && state.view === "home" && !state.askMessages.length) {
    openSavedChat(previousAskChat.chatId).catch(() => { });
  }
  if (user) {
    resumeBackgroundJobs();
    checkAndShowPlannerVisitNotification();
  }
  if (window.location.hash === "#terms" || window.location.pathname === "/terms") {
    openLegalModal("terms");
  } else if (window.location.hash === "#privacy" || window.location.pathname === "/privacy") {
    openLegalModal("privacy");
  }
  setupRailArchiveHover();
  showV35ReleaseToast();
});

// The existing rail is the compact workspace navigation; never show two panels.
sidebar.inert = !sidebar.classList.contains("is-open");
function openRecentWorkArchive() {
  if (state.mode === "ask") {
    openSearchModal({ allChats: true });
    return;
  }
  strategiesNav.click();
}
document.querySelector("#recentViewAll").addEventListener("click", openRecentWorkArchive);
document.querySelector("#navigationHide").addEventListener("click", () => {
  closeSidebar();
  document.querySelector(".navigation-rail").inert = true;
  document.querySelector("#appShell").classList.add("navigation-hidden");
  document.querySelector("#navigationRestore").hidden = false;
  document.querySelector("#navigationRestore").focus();
});
document.querySelector("#navigationRestore").addEventListener("click", () => {
  document.querySelector(".navigation-rail").inert = false;
  document.querySelector("#appShell").classList.remove("navigation-hidden");
  document.querySelector("#navigationRestore").hidden = true;
  railMenuButton.focus();
});
window.matchMedia("(max-width: 820px)").addEventListener("change", () => closeSidebar());
sidebar.addEventListener("keydown", (event) => {
  if (event.key !== "Tab" || !window.matchMedia("(max-width: 820px)").matches) return;
  const controls = [...sidebar.querySelectorAll("button:not(:disabled), a[href]")].filter(node => node.getClientRects().length);
  const first = controls[0], last = controls.at(-1);
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
});

document.querySelector("#railWhatsNewButton").addEventListener("click", () => whatsNewNav.click());
