(() => {
  let registryPromise;
  const node = (tag, className, text) => { const result = document.createElement(tag); result.className = className || ""; if (text !== undefined) result.textContent = text; return result; };
  const iconPaths = {
    document: ["M6 3h8l4 4v14H6z", "M14 3v5h4M9 12h6M9 16h6"],
    spreadsheet: ["M3 4h18v16H3z", "M3 9h18M9 4v16M15 4v16M3 14h18"],
    presentation: ["M3 3h18v13H3z", "M12 16v5M8 21h8M7 12l3-3 3 2 4-5"],
    pdf: ["M6 3h8l4 4v14H6z", "M14 3v5h4M9 13h6M9 17h4"],
    globe: ["M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Z", "M2 12h20M12 2c5 5 5 15 0 20-5-5-5-15 0-20Z"],
    research: ["M11 3a8 8 0 1 0 0 16 8 8 0 0 0 0-16Z", "m21 21-4.35-4.35", "M11 7v4l2.5 1.5"],
  };
  const brandLogos = {
    word: '<svg viewBox="0 0 48 48" width="18" height="18" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path fill="#41a5ee" d="M14 4c-1.1 0-2 .9-2 2v8l17 6 17-6V6c0-1.1-.9-2-2-2H14z"/><path fill="#2b7cd3" d="M12 14h34v10l-17 4-17-4V14z"/><path fill="#1650a7" d="M12 24h34v10l-17 4-17-4V24z"/><path fill="#103f91" d="M12 34v8c0 1.1.9 2 2 2h30c1.1 0 2-.9 2-2v-8H12z"/><rect x="2" y="13" width="22" height="22" rx="3" fill="#185abd"/><path fill="#ffffff" d="M18.53 31h-2.52l-2.94-9.66-3.08 9.66H7.47L4.67 17h2.52l1.96 9.8 2.94-9.8h2.1l2.8 9.8 1.96-9.8h2.38L18.53 31z"/></svg>',
    excel: '<svg viewBox="0 0 48 48" width="18" height="18" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path fill="#185c37" d="M46 34v8c0 1.1-.9 2-2 2H14c-1.1 0-2-.9-2-2V23h16l1 1v10h17z"/><path fill="#21a366" d="M14 4h15l17 10v11H30l-1-1-17-10V6c0-1.1.9-2 2-2z"/><path fill="#33c481" d="M29 4h15c1.1 0 2 .9 2 2v8H29V4z"/><path fill="#107c41" d="M12 14h17v10H12zM29 24h17v10H29z"/><rect x="2" y="13" width="22" height="22" rx="3" fill="#0e6f3a"/><path fill="#ffffff" d="M6.75 31l4.53-7.02L7.13 17h3.34l2.69 5.41L16.08 17h3.07l-4.26 6.94L19.25 31h-3.26l-2.97-5.55L10.03 31H6.75z"/></svg>',
    powerpoint: '<svg viewBox="0 0 48 48" width="18" height="18" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path fill="#ed6c47" d="M26 4A20 20 0 0 0 6 24l25.34 5.34L26 4z"/><path fill="#ff8f6b" d="M26 4a20 20 0 0 1 20 20l-10 6.8L26 24V4z"/><path fill="#d35230" d="M26 44a20 20 0 0 0 20-20H6a20 20 0 0 0 20 20z"/><rect x="2" y="13" width="22" height="22" rx="3" fill="#c43e1c"/><path fill="#ffffff" d="M8 17h5.02c1.28-.09 2.54.31 3.57 1.13.86.82 1.31 2.02 1.24 3.26.01.79-.2 1.77-.61 2.42-.42.72-1.03 1.3-1.74 1.66-.82.41-1.71.54-2.62.52H11v5H8V17zm3 3v3.98h1.83c.6 0 1.2-.14 1.62-.43.37-.28.55-.61.55-.98 0-1.06-.7-1.59-2.1-1.59H11z"/></svg>',
    pdf: '<svg viewBox="0 0 32 32" width="18" height="18" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><rect width="32" height="32" rx="6" fill="#e5252a"/><path fill="#ffffff" d="M25.53 18.44c-1.5-1.6-5.59-.9-6.58-.8-1.4-1.4-2.39-2.99-2.79-3.59.5-1.5.9-3.19.9-4.79 0-1.5-.6-2.99-2.19-2.99-.6 0-1.1.3-1.4.8-.7 1.2-.4 3.59.7 6.08-.6 1.8-1.6 4.48-2.79 6.57-1.6.6-5.08 2.19-5.38 3.99-.1.5.1 1.1.5 1.4.4.4.9.5 1.4.5 2.09 0 4.19-2.89 5.69-5.49 1.2-.4 3.09-1 4.99-1.3 2.19 2 4.19 2.29 5.19 2.29 1.4 0 1.9-.6 2.09-1.1.26-.47.07-1.17-.33-1.57zM24.13 19.44c-.1.4-.6.8-1.5.6-1.1-.3-2.09-.8-2.89-1.5.7-.1 2.39-.3 3.59-.1.4.1.9.4.8 1zm-9.68-11.96c.1-.2.3-.3.5-.3.5 0 .6.6.6 1.1 0 1.2-.2 2.49-.6 3.59-.8-2.19-.7-3.79-.5-4.39zm-.1 11.26c.5-.9 1.1-2.59 1.3-3.19.5.9 1.4 1.9 1.8 2.39.1-.09-1.7.29-3.1.8zm-3.39 2.3c-1.39 2.19-2.69 3.59-3.49 3.59-.1 0-.3 0-.4-.1-.1-.2-.2-.4-.1-.6.1-.8 1.7-1.9 3.99-2.89z"/></svg>',
  };
  function capabilityIcon(type, id) {
    const wrap = node("span", "ask-plugin-icon");
    const key = String(id || type || "").toLowerCase();
    const brandKey = key === "word" || (key === "document" && (!id || id === "word")) ? "word"
      : key === "excel" || (key === "spreadsheet" && (!id || id === "excel")) ? "excel"
      : key === "powerpoint" || (key === "presentation" && (!id || id === "powerpoint")) ? "powerpoint"
      : key === "pdf" ? "pdf"
      : null;
    if (brandKey && brandLogos[brandKey]) {
      wrap.innerHTML = brandLogos[brandKey];
      return wrap;
    }
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    for (const [name, value] of Object.entries({ viewBox: "0 0 24 24", width: "18", height: "18", fill: "none", stroke: "currentColor", "stroke-width": "1.6", "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true" })) svg.setAttribute(name, value);
    for (const data of iconPaths[type] || ["M12 3l9 9-9 9-9-9Z"]) { const path = document.createElementNS("http://www.w3.org/2000/svg", "path"); path.setAttribute("d", data); svg.append(path); }
    wrap.append(svg); return wrap;
  }
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const isEn = () => document.documentElement.lang === "en";
  const request = async url => {
    const response = await fetch(url, { credentials: "same-origin" });
    const data = await response.json(); if (!response.ok) throw new Error(data.error || "Unable to open file"); return data;
  };
  const registry = () => registryPromise ||= request("/api/ask/plugins").then(data => data.plugins).catch(error => { registryPromise = null; throw error; });
  function attachComposer({ input, body, getSelection, setSelection }) {
    const chips = node("div", "ask-plugin-tokens");
    const popup = node("div", "ask-plugin-selector"); popup.hidden = true; popup.id = `plugin-selector-${input.id}`;
    popup.setAttribute("role", "listbox"); popup.setAttribute("aria-label", isEn() ? "Capabilities" : "Capability seçimi");
    body.prepend(chips); body.append(popup);
    input.setAttribute("aria-controls", popup.id); input.setAttribute("aria-expanded", "false"); input.setAttribute("aria-autocomplete", "list");
    let plugins = [], matches = [], active = 0, queryRange = null;
    const close = () => { popup.hidden = true; popup.classList.remove("is-downwards"); input.setAttribute("aria-expanded", "false"); input.removeAttribute("aria-activedescendant"); queryRange = null; };
    const drawChips = () => {
      chips.replaceChildren();
      for (const id of getSelection()) {
        const plugin = plugins.find(item => item.id === id);
        const chip = node("span", "ask-plugin-token");
        chip.append(capabilityIcon(plugin?.icon, plugin?.id || id), node("span", "", `@${plugin?.name || id}`));
        const remove = node("button", "ask-plugin-token-remove", "×"); remove.type = "button";
        remove.setAttribute("aria-label", `${isEn() ? "Remove" : "Sil"} @${plugin?.name || id}`);
        remove.addEventListener("click", () => { if (input.disabled) return; setSelection(getSelection().filter(value => value !== id)); drawChips(); input.focus(); }); chip.append(remove); chips.append(chip);
      }
    };
    const choose = plugin => {
      if (input.disabled || !queryRange || plugin.status !== "available") return;
      const ids = getSelection(); if (!ids.includes(plugin.id) && ids.length < 6) setSelection([...ids, plugin.id]);
      const cursor = queryRange.start;
      input.value = input.value.slice(0, queryRange.start) + input.value.slice(queryRange.end);
      input.focus(); input.setSelectionRange(cursor, cursor); input.dispatchEvent(new Event("input", { bubbles: true })); close(); drawChips();
    };
    const drawPopup = () => {
      popup.replaceChildren();
      if (!matches.length) popup.append(node("p", "ask-plugin-empty", isEn() ? "No matching capability" : "Uyğun capability yoxdur"));
      matches.forEach((plugin, index) => {
        const option = node("button", `ask-plugin-option${index === active ? " is-active" : ""}`); option.type = "button";
        option.id = `${popup.id}-${index}`; option.setAttribute("role", "option"); option.setAttribute("aria-selected", String(index === active));
        option.disabled = plugin.status !== "available";
        const copy = node("span", "ask-plugin-option-copy"); copy.append(node("strong", "", `@${plugin.name}`), node("small", "", plugin.status === "available" ? (isEn() ? plugin.descriptionEn || plugin.description : plugin.description) : (isEn() ? "Currently unavailable" : "Hazırda əlçatan deyil")));
        option.append(capabilityIcon(plugin.icon, plugin.id), copy);
        option.addEventListener("pointerdown", event => event.preventDefault()); option.addEventListener("click", () => choose(plugin)); popup.append(option);
      });
      if (matches[active]) input.setAttribute("aria-activedescendant", `${popup.id}-${active}`);
    };
    const search = () => {
      if (input.disabled) return close();
      const cursor = input.selectionStart;
      const match = input.value.slice(0, cursor).match(/(?:^|\s)@([^\s@]*)$/);
      if (!match) return close();
      queryRange = { start: cursor - match[1].length - 1, end: cursor };
      matches = plugins.filter(plugin => !getSelection().includes(plugin.id) && `${plugin.name} ${plugin.description} ${plugin.descriptionEn || ""}`.toLowerCase().includes(match[1].toLowerCase()));
      active = 0; popup.hidden = false; input.setAttribute("aria-expanded", "true");
      const isDesktop = typeof window !== "undefined" && window.innerWidth >= 768;
      const isMainPage = Boolean(popup.closest && popup.closest(".workspace-intake, .workspace-ask.is-empty, .ask-shell.is-empty"));
      popup.classList.toggle("is-downwards", Boolean(isDesktop && isMainPage));
      drawPopup();
    };
    input.addEventListener("input", search); input.addEventListener("click", search);
    input.addEventListener("keydown", event => {
      if (event.isComposing || input.disabled) return;
      if (!popup.hidden && ["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"].includes(event.key)) {
        event.preventDefault(); event.stopImmediatePropagation();
        if (event.key === "Escape") close();
        else if (["Enter", "Tab"].includes(event.key)) { if (matches[active]) choose(matches[active]); }
        else { active = matches.length ? (active + (event.key === "ArrowDown" ? 1 : -1) + matches.length) % matches.length : 0; drawPopup(); }
      } else if (event.key === "Backspace" && !input.value && getSelection().length) { setSelection(getSelection().slice(0, -1)); drawChips(); }
    }, true);
    input.addEventListener("blur", close);
    drawChips();
    registry().then(list => { plugins = list; if (input.isConnected) { drawChips(); search(); } }).catch(() => { if (input.isConnected) { close(); chips.append(node("small", "ask-plugin-empty", isEn() ? "Capabilities could not load. Refresh to retry." : "Capability-lər yüklənmədi. Yenidən yoxlamaq üçün səhifəni yeniləyin.")); } });
  }

  function artifactCard(artifact, onEdit, showPreview = true) {
    if (!uuid.test(artifact.id) || !Number.isInteger(artifact.version) || artifact.version < 1) return null;
    const card = node("div", "ask-artifact-card");
    const info = node("div", "ask-artifact-info"); info.append(node("strong", "", artifact.filename), node("small", "", `${artifact.outputLabel || artifact.pluginId} · ${formatSize(artifact.size)} · v${artifact.version}`));
    const actions = node("div", "ask-artifact-actions");
    const preview = node("button", "ask-artifact-action", isEn() ? "Preview" : "Aç"); preview.type = "button";
    preview.addEventListener("click", () => previewArtifact(artifact, onEdit));
    const download = node("a", "ask-artifact-action", isEn() ? "Download" : "Yüklə"); download.href = `/api/artifacts/${artifact.id}/versions/${artifact.version}/download`; download.download = artifact.filename;
    const edit = node("button", "ask-artifact-action", isEn() ? "Edit" : "Redaktə et"); edit.type = "button"; edit.addEventListener("click", () => onEdit?.(artifact));
    if (showPreview) actions.append(preview);
    actions.append(download, edit); card.append(node("span", "ask-artifact-icon", String(artifact.filename || "").split(".").at(-1).toUpperCase()), info, actions);
    return card;
  }
  const formatSize = size => size >= 1048576 ? `${(size / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(size / 1024))} KB`;
  function drawTable(container, table) {
    const wrap = node("div", "artifact-preview-table-wrap"), grid = node("table", "artifact-preview-table");
    if (table.headers) { const head = node("tr"); table.headers.forEach(value => head.append(node("th", "", value))); grid.append(head); }
    table.rows.forEach(row => { const tr = node("tr"); row.forEach(value => tr.append(node("td", "", value))); grid.append(tr); });
    wrap.append(grid); container.append(wrap);
  }
  function drawSpec(container, spec, pluginId) {
    container.replaceChildren(node("h1", "", spec.title));
    spec.units.forEach((unit, index) => {
      const section = node("section", "artifact-preview-section");
      section.append(node("h2", "", unit.heading || unit.name || unit.title || `${index + 1}`));
      if (unit.subtitle) section.append(node("p", "", unit.subtitle));
      (unit.paragraphs || []).forEach(value => section.append(node("p", "", value)));
      (unit.lists || []).forEach(list => { const el = node(list.ordered ? "ol" : "ul"); list.items.forEach(value => el.append(node("li", "", value))); section.append(el); });
      if (unit.bullets?.length) { const list = node("ul"); unit.bullets.forEach(value => list.append(node("li", "", value))); section.append(list); }
      if (unit.rows) {
        if (unit.summary) section.append(node("p", "", unit.summary));
        drawTable(section, { rows: unit.rows.slice(0, 200).map(row => row.map(cell => cell.type === "formula" ? `=${cell.formula.replace(/^=/, "")}${cell.result !== null ? ` → ${cell.result}` : ""}` : cell.value)) });
        if (unit.rows.length > 200) section.append(node("small", "", isEn() ? "Download for all rows." : "Bütün sətirlər üçün faylı yükləyin."));
      } else (unit.tables || []).forEach(table => drawTable(section, table));
      (unit.metrics || []).forEach(metric => section.append(node("p", "", `${metric.label}: ${metric.value}`)));
      (unit.charts || []).forEach(chart => { section.append(node("h3", "", chart.title)); drawTable(section, { headers: ["", ...chart.series.map(series => series.name)], rows: chart.labels.map((label, ci) => [label, ...chart.series.map(series => String(series.values[ci]))]) }); });
      if (unit.notes) { const details = node("details"); details.append(node("summary", "", isEn() ? "Speaker notes" : "Spiker qeydləri"), node("p", "", unit.notes)); section.append(details); }
      container.append(section);
    });
    if (spec.citations.length) {
      const list = node("ul"); spec.citations.forEach(cite => { if (!/^https?:\/\//i.test(cite.url)) return; const li = node("li"), link = node("a", "", cite.title); link.href = cite.url; link.target = "_blank"; link.rel = "noopener noreferrer"; li.append(link); list.append(li); }); container.append(list);
    }
  }
  async function previewArtifact(artifact, onEdit) {
    const dialog = node("dialog", "artifact-preview-dialog");
    const toolbar = node("div", "artifact-preview-toolbar");
    const title = node("strong", "", artifact.filename), select = node("select", "artifact-version-select"), close = node("button", "ask-artifact-action", "×");
    select.setAttribute("aria-label", isEn() ? "Version history" : "Versiya tarixçəsi"); close.type = "button"; close.setAttribute("aria-label", isEn() ? "Close preview" : "Önbaxışı bağla"); close.addEventListener("click", () => dialog.close());
    toolbar.append(title, select, close);
    const content = node("div", "artifact-preview-body", isEn() ? "Loading..." : "Yüklənir..."); dialog.append(toolbar, content); document.body.append(dialog); dialog.showModal();
    dialog.addEventListener("close", () => dialog.remove(), { once: true });
    let loadId = 0;
    const load = async version => {
      const currentLoad = ++loadId;
      try {
        const data = await request(`/api/artifacts/${artifact.id}/versions/${version}/preview`);
        if (currentLoad !== loadId || !dialog.isConnected) return;
        title.textContent = data.artifact.filename;
        select.replaceChildren(); data.versions.forEach(item => { const option = node("option", "", `v${item.version} · ${new Date(item.createdAt).toLocaleString()}`); option.value = item.version; option.selected = item.version === Number(version); select.append(option); });
        drawSpec(content, data.specification, data.artifact.pluginId);
        const card = artifactCard(data.artifact, selected => { dialog.close(); onEdit?.(selected); }, false); if (card) content.prepend(card);
      } catch (error) { if (currentLoad !== loadId || !dialog.isConnected) return; content.replaceChildren(node("p", "ask-error", error.message)); const retry = node("button", "ask-artifact-action", isEn() ? "Retry" : "Yenidən cəhd et"); retry.addEventListener("click", () => load(version)); content.append(retry); }
    };
    select.addEventListener("change", () => load(select.value)); await load(artifact.version);
  }
  window.HelmerArtifacts = { attachComposer, artifactCard };
})();
