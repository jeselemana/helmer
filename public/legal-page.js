import { LEGAL_DOCUMENTS } from "./legal-documents.js";

const docType = document.body?.dataset?.legalDoc === "privacy" ? "privacy" : "terms";

function resolveInitialLang() {
  try {
    const params = new URLSearchParams(window.location.search);
    const paramLang = params.get("lang");
    if (paramLang === "en" || paramLang === "az") return paramLang;
    const stored = localStorage.getItem("helmer_language") || localStorage.getItem("marketify_language");
    if (stored === "en" || stored === "az") return stored;
  } catch {}
  return "az";
}

let currentLang = resolveInitialLang();
let activeObserver = null;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
}

function renderMetadataGrid(doc) {
  const section = el("section", "legal-meta-card");
  section.setAttribute("aria-label", doc.metadataTitle);

  const heading = el("div", "legal-meta-header", doc.metadataTitle);
  const grid = el("dl", "legal-meta-grid");

  for (const item of doc.metadata) {
    const row = el("div", "legal-meta-item");
    const dt = el("dt", "legal-meta-label", item.label);
    const dd = el("dd", "legal-meta-value");

    if (item.href) {
      const link = el("a", "legal-inline-link", item.value);
      link.href = item.href;
      if (item.href.startsWith("https://")) {
        link.target = "_blank";
        link.rel = "noopener noreferrer";
      }
      dd.appendChild(link);
    } else {
      dd.textContent = item.value;
    }

    row.append(dt, dd);
    grid.appendChild(row);
  }

  section.append(heading, grid);
  return section;
}

function renderCallout(callout) {
  if (!callout) return null;
  const box = el("section", "legal-callout");
  box.id = callout.id;

  const badgeRow = el("div", "legal-callout-header");
  const icon = el("span", "legal-callout-icon");
  icon.setAttribute("aria-hidden", "true");
  icon.textContent = "✦";
  const title = el("h2", "legal-callout-title", callout.title);
  badgeRow.append(icon, title);
  box.appendChild(badgeRow);

  for (const pText of callout.paragraphs) {
    const p = el("p", "legal-callout-text", pText);
    box.appendChild(p);
  }

  if (Array.isArray(callout.links) && callout.links.length) {
    const linksWrap = el("div", "legal-callout-links");
    for (const linkInfo of callout.links) {
      const a = el("a", "legal-callout-link", `${linkInfo.label} ↗`);
      a.href = linkInfo.href;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      linksWrap.appendChild(a);
    }
    box.appendChild(linksWrap);
  }

  return box;
}

function renderPreamble(preamble) {
  if (!preamble) return null;
  const section = el("section", "legal-article legal-preamble");
  section.id = preamble.id;
  section.appendChild(el("h2", "legal-article-title", preamble.title));
  for (const pText of preamble.paragraphs) {
    section.appendChild(el("p", "legal-paragraph", pText));
  }
  return section;
}

function renderParagraphWithClausePrefix(text) {
  const p = el("p", "legal-paragraph");
  const match = text.match(/^(\d+\.\d+\.)\s+(.*)$/);
  if (match) {
    const numSpan = el("span", "legal-clause-num", `${match[1]} `);
    const restText = match[2];
    const colonIdx = restText.indexOf(":");
    if (colonIdx > 0 && colonIdx < 80) {
      const lead = el("strong", "legal-clause-lead", restText.slice(0, colonIdx + 1));
      p.append(numSpan, lead, document.createTextNode(restText.slice(colonIdx + 1)));
    } else {
      p.append(numSpan, document.createTextNode(restText));
    }
  } else {
    p.textContent = text;
  }
  return p;
}

function renderArticle(article) {
  const section = el("section", "legal-article");
  section.id = article.id;
  section.appendChild(el("h2", "legal-article-title", article.title));

  for (const block of article.blocks) {
    if (block.type === "paragraph") {
      section.appendChild(renderParagraphWithClausePrefix(block.text));
    } else if (block.type === "list") {
      const ul = el("ul", "legal-list");
      for (const item of block.items) {
        ul.appendChild(el("li", "legal-list-item", item));
      }
      section.appendChild(ul);
    }
  }

  return section;
}

function renderToc(doc) {
  const items = [];
  if (doc.callout) {
    items.push({ id: doc.callout.id, title: doc.callout.title });
  }
  if (doc.preamble) {
    items.push({ id: doc.preamble.id, title: doc.preamble.title });
  }
  for (const article of doc.articles) {
    items.push({ id: article.id, title: article.title });
  }

  const nav = el("nav", "legal-toc-nav");
  nav.setAttribute("aria-label", doc.tocTitle);

  const list = el("ul", "legal-toc-list");
  for (const item of items) {
    const li = el("li", "legal-toc-item");
    const a = el("a", "legal-toc-link", item.title);
    a.href = `#${item.id}`;
    a.dataset.targetId = item.id;
    a.addEventListener("click", () => {
      const mobileToggle = document.getElementById("legalMobileTocDetails");
      if (mobileToggle && mobileToggle.open) {
        mobileToggle.open = false;
      }
    });
    li.appendChild(a);
    list.appendChild(li);
  }
  nav.appendChild(list);
  return { nav, items };
}

function setupScrollSpy(items) {
  if (activeObserver) {
    activeObserver.disconnect();
    activeObserver = null;
  }

  const tocLinks = Array.from(document.querySelectorAll(".legal-toc-link"));
  if (!tocLinks.length || typeof IntersectionObserver === "undefined") return;

  const setActive = (id) => {
    for (const link of tocLinks) {
      if (link.dataset.targetId === id) {
        link.classList.add("is-active");
        link.setAttribute("aria-current", "true");
      } else {
        link.classList.remove("is-active");
        link.removeAttribute("aria-current");
      }
    }
  };

  if (items[0]) setActive(items[0].id);

  const visibleIds = new Set();
  activeObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) visibleIds.add(entry.target.id);
        else visibleIds.delete(entry.target.id);
      }
      const firstVisible = items.find((item) => visibleIds.has(item.id));
      if (firstVisible) setActive(firstVisible.id);
    },
    {
      rootMargin: "-96px 0px -65% 0px",
      threshold: [0, 0.1, 0.5],
    }
  );

  for (const item of items) {
    const target = document.getElementById(item.id);
    if (target) activeObserver.observe(target);
  }
}

function syncHeaderControls(lang) {
  const isEn = lang === "en";
  document.documentElement.lang = lang;

  const navTerms = document.getElementById("navTerms");
  const navPrivacy = document.getElementById("navPrivacy");
  const navHome = document.getElementById("navHome");
  const printBtn = document.getElementById("legalPrintBtn");
  const printLabel = document.getElementById("legalPrintLabel");
  const btnAz = document.getElementById("btnAz");
  const btnEn = document.getElementById("btnEn");

  if (navTerms) navTerms.textContent = isEn ? "Terms of Service" : "İstifadə Şərtləri";
  if (navPrivacy) navPrivacy.textContent = isEn ? "Privacy Policy" : "Məxfilik Siyasəti";
  if (navHome) navHome.textContent = isEn ? "Workspace" : "İş Sahəsi";
  if (printLabel) printLabel.textContent = isEn ? "Print / Save PDF" : "Çap et / PDF";
  if (printBtn) printBtn.setAttribute("aria-label", isEn ? "Print or Save as PDF" : "Çap et və ya PDF kimi saxla");

  if (btnAz) {
    btnAz.classList.toggle("active", !isEn);
    btnAz.setAttribute("aria-pressed", String(!isEn));
  }
  if (btnEn) {
    btnEn.classList.toggle("active", isEn);
    btnEn.setAttribute("aria-pressed", String(isEn));
  }

  if (docType === "terms") {
    document.title = isEn
      ? "Terms of Service | Helmer Strategy OS"
      : "İstifadəçi Razılaşması (İstifadə Şərtləri) | Helmer Strategy OS";
  } else {
    document.title = isEn
      ? "Privacy Policy | Helmer Strategy OS"
      : "Məxfilik Siyasəti | Helmer Strategy OS";
  }

  window.dispatchEvent(new CustomEvent("helmer:language-change", { detail: { lang } }));
}

function renderDocument(lang) {
  const doc = LEGAL_DOCUMENTS[docType]?.[lang] || LEGAL_DOCUMENTS[docType]?.az;
  const root = document.getElementById("legalPageRoot");
  if (!doc || !root) return;

  root.replaceChildren();

  // Hero & Metadata Header Block
  const hero = el("header", "legal-hero");
  hero.appendChild(el("span", "legal-badge", doc.badge));
  hero.appendChild(el("h1", "legal-hero-title", doc.title));
  hero.appendChild(el("p", "legal-hero-subtitle", doc.subtitle));
  hero.appendChild(renderMetadataGrid(doc));
  root.appendChild(hero);

  // Two-Column Layout: Sticky TOC Sidebar + Main Reading Column
  const layout = el("div", "legal-layout");

  const { nav: desktopTocNav, items: tocItems } = renderToc(doc);
  const sidebar = el("aside", "legal-toc-sidebar");
  const sidebarInner = el("div", "legal-toc-sticky");
  sidebarInner.appendChild(el("div", "legal-toc-heading", doc.tocTitle));
  sidebarInner.appendChild(desktopTocNav);
  sidebar.appendChild(sidebarInner);

  // Mobile Collapsible TOC
  const mobileTocDetails = el("details", "legal-mobile-toc");
  mobileTocDetails.id = "legalMobileTocDetails";
  const mobileSummary = el("summary", "legal-mobile-toc-summary", doc.tocTitle);
  mobileTocDetails.appendChild(mobileSummary);
  mobileTocDetails.appendChild(renderToc(doc).nav);

  const mainCol = el("article", "legal-reading-column");
  mainCol.appendChild(mobileTocDetails);

  const calloutNode = renderCallout(doc.callout);
  if (calloutNode) mainCol.appendChild(calloutNode);

  const preambleNode = renderPreamble(doc.preamble);
  if (preambleNode) mainCol.appendChild(preambleNode);

  for (const article of doc.articles) {
    mainCol.appendChild(renderArticle(article));
  }

  // Corporate Footer at bottom of reading column
  const docFooter = el("footer", "legal-doc-footer");
  const precedenceBox = el("div", "legal-precedence-box");
  precedenceBox.textContent = doc.footer.precedence;

  const footerMeta = el("div", "legal-doc-footer-meta");
  const copyrightEl = el("p", "legal-doc-copyright", doc.footer.copyright);
  const companionWrap = el("p", "legal-doc-companion");
  companionWrap.append(document.createTextNode(`${doc.footer.companionLabel} `));
  const companionLink = el("a", "legal-inline-link", doc.footer.companionText);
  companionLink.href = doc.footer.companionHref;
  companionWrap.appendChild(companionLink);

  footerMeta.append(copyrightEl, companionWrap);
  docFooter.append(precedenceBox, footerMeta);
  mainCol.appendChild(docFooter);

  layout.append(sidebar, mainCol);
  root.appendChild(layout);

  syncHeaderControls(lang);
  setupScrollSpy(tocItems);
}

function setLang(lang) {
  if (lang !== "az" && lang !== "en") return;
  currentLang = lang;
  try {
    localStorage.setItem("helmer_language", lang);
  } catch {}
  renderDocument(lang);
}

function initSupportChat() {
  const widget = document.getElementById("supportChatWidget");
  const bubble = document.getElementById("supportChatBubble");
  const popover = document.getElementById("supportChatPopover");
  const closeBtn = document.getElementById("supportPopoverClose");
  const copyBtn = document.getElementById("supportCopyEmailBtn");
  const tooltipText = document.getElementById("supportChatTooltipText");
  const popoverTitle = document.getElementById("supportPopoverTitle");
  const popoverSubtitle = document.getElementById("supportPopoverSubtitle");
  const emailLabel = document.getElementById("supportEmailLabel");
  if (!widget || !bubble || !popover) return;

  let currentUserName = "";

  const updateSupportChat = () => {
    const isEn = currentLang === "en";
    if (tooltipText) {
      tooltipText.textContent = currentUserName
        ? (isEn ? `Hi ${currentUserName}, need help?` : `Salam ${currentUserName}, kömək lazımdır?`)
        : (isEn ? "Hi, need help?" : "Salam, kömək lazımdır?");
    }
    if (popoverTitle) popoverTitle.textContent = isEn ? "Help & Support" : "Kömək və Dəstək";
    if (popoverSubtitle) popoverSubtitle.textContent = isEn ? "Write to us with your questions or feedback." : "Suallarınız və ya təklifləriniz üçün bizə yazın.";
    if (emailLabel) emailLabel.textContent = isEn ? "Send an email" : "E-poçt vasitəsilə yazın";
    if (copyBtn && copyBtn.dataset.copied !== "true") {
      copyBtn.textContent = isEn ? "Copy email address" : "Ünvanı kopyala";
    }
    bubble.setAttribute("aria-label", isEn ? "Help & Support" : "Kömək və Dəstək");
  };

  const openPopover = () => {
    popover.hidden = false;
    bubble.setAttribute("aria-expanded", "true");
    widget.classList.add("is-open");
  };

  const closePopover = () => {
    popover.hidden = true;
    bubble.setAttribute("aria-expanded", "false");
    widget.classList.remove("is-open");
  };

  bubble.addEventListener("click", (e) => {
    e.stopPropagation();
    if (popover.hidden) openPopover();
    else closePopover();
  });

  closeBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    closePopover();
  });

  copyBtn?.addEventListener("click", () => {
    const isEn = currentLang === "en";
    navigator.clipboard?.writeText("support@helmeros.com").catch(() => {});
    copyBtn.dataset.copied = "true";
    copyBtn.textContent = isEn ? "Copied!" : "Kopyalandı!";
    setTimeout(() => {
      copyBtn.dataset.copied = "false";
      copyBtn.textContent = currentLang === "en" ? "Copy email address" : "Ünvanı kopyala";
    }, 2000);
  });

  document.addEventListener("click", (e) => {
    if (!popover.hidden && !widget.contains(e.target)) closePopover();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !popover.hidden) closePopover();
  });

  window.addEventListener("helmer:language-change", updateSupportChat);
  updateSupportChat();

  fetch("/api/auth/me")
    .then((r) => (r.ok ? r.json() : null))
    .then((data) => {
      if (data?.user) {
        if (data.user.fullName) {
          currentUserName = data.user.fullName.trim().split(/\s+/)[0];
        } else if (data.user.username) {
          const u = data.user.username.trim();
          currentUserName = u.charAt(0).toUpperCase() + u.slice(1);
        }
        updateSupportChat();
      }
    })
    .catch(() => {});
}

document.getElementById("btnAz")?.addEventListener("click", () => setLang("az"));
document.getElementById("btnEn")?.addEventListener("click", () => setLang("en"));
document.getElementById("legalPrintBtn")?.addEventListener("click", () => window.print());

renderDocument(currentLang);
initSupportChat();
