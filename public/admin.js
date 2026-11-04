async function fetchJSON(url, options = {}) {
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error || `Request failed: ${res.status}`);
  }
  return res.json();
}

function formatDate(ts) {
  if (!ts) return "–";
  const d = new Date(ts);
  return d.toLocaleString("az-AZ", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;",
  })[character]);
}

// -------------------------------------------------------------
// 🗂️ TAB NAVIGATION
// -------------------------------------------------------------
function setupTabs() {
  const tabs = document.querySelectorAll(".nav-tab");
  const contents = {
    telemetry: document.getElementById("tabContentTelemetry"),
    legal: document.getElementById("tabContentLegal"),
    learning: document.getElementById("tabContentLearning"),
  };

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      tabs.forEach((t) => t.classList.remove("is-active"));
      tab.classList.add("is-active");

      const target = tab.dataset.tab;
      Object.entries(contents).forEach(([key, contentEl]) => {
        if (!contentEl) return;
        if (key === target) {
          contentEl.style.display = "block";
          contentEl.classList.add("is-active");
        } else {
          contentEl.style.display = "none";
          contentEl.classList.remove("is-active");
        }
      });

      if (target === "telemetry") loadTelemetry();
      if (target === "legal") loadLegalReports();
      if (target === "learning") loadAiLearning();
    });
  });
}

// -------------------------------------------------------------
// 📊 TELEMETRY & AUDIT DASHBOARD (PRIVACY-FIRST)
// -------------------------------------------------------------
const telemetryState = {
  page: 1,
  pageSize: 20,
  searchTimer: null,
  liveInterval: null,
  currentEvent: null,
};

function makeEl(tag, className = "", textContent = null) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (textContent !== null && textContent !== undefined) {
    node.textContent = textContent;
  }
  return node;
}

function formatAzn(value) {
  return `${(Number(value) || 0).toFixed(4)} ₼`;
}

function formatUsd(value) {
  return `$${(Number(value) || 0).toFixed(4)}`;
}

function telemetryQuery(extra = {}) {
  const params = new URLSearchParams();
  const dateRange = document.getElementById("telemetryDateFilter")?.value || "today";
  params.set("dateRange", dateRange);

  const mode = document.getElementById("telemetryModeFilter")?.value;
  if (mode && mode !== "all") params.set("mode", mode);

  const market = document.getElementById("telemetryMarketFilter")?.value;
  if (market && market !== "all") params.set("marketMode", market);

  const model = document.getElementById("telemetryModelFilter")?.value;
  if (model && model !== "all") params.set("model", model);

  const status = document.getElementById("telemetryStatusFilter")?.value;
  if (status && status !== "all") params.set("status", status);

  const search = document.getElementById("telemetrySearchInput")?.value?.trim();
  if (search) params.set("search", search);

  params.set("page", String(extra.page || telemetryState.page));
  params.set("pageSize", String(extra.pageSize || telemetryState.pageSize));

  return params.toString();
}

function renderTelemetryKpis(data) {
  if (!data) return;
  const setTxt = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val ?? "–";
  };

  setTxt("stat-telemetry-dau", Number(data.dau || 0).toLocaleString());
  setTxt("stat-telemetry-strategies", Number(data.totalStrategies || 0).toLocaleString());
  setTxt("stat-telemetry-today-strategies", Number(data.todayStrategies || 0).toLocaleString());
  setTxt("stat-telemetry-latency", data.avgLatencyMs ? `${data.avgLatencyMs} ms` : "–");
  setTxt("stat-telemetry-cost-azn", formatAzn(data.todayCostAzn));
  setTxt("stat-telemetry-cost-usd", `(${formatUsd(data.todayCostUsd)})`);
  setTxt("stat-telemetry-total-events", Number(data.totalEvents || 0).toLocaleString());
  setTxt("stat-telemetry-restricted-count", Number(data.restrictedCount || 0).toLocaleString());
  setTxt("stat-telemetry-local-share", `${data.marketDistribution?.localPercent || 0}%`);
  setTxt("stat-telemetry-alltime-cost", formatAzn(data.allTimeCostAzn));
}

function renderMarketDistribution(market) {
  if (!market) return;
  const localPct = Math.max(0, Math.min(100, Number(market.localPercent) || 50));
  const globalPct = 100 - localPct;

  const barLocal = document.getElementById("marketBarLocal");
  const barGlobal = document.getElementById("marketBarGlobal");
  if (barLocal) barLocal.style.width = `${localPct}%`;
  if (barGlobal) barGlobal.style.width = `${globalPct}%`;

  const setTxt = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  };
  setTxt("stat-market-local-count", market.localCount ?? 0);
  setTxt("stat-market-local-pct", `(${localPct}%)`);
  setTxt("stat-market-global-count", market.globalCount ?? 0);
  setTxt("stat-market-global-pct", `(${globalPct}%)`);
}

function renderModelDistribution(models) {
  const tbody = document.getElementById("telemetryModelsBody");
  if (!tbody) return;
  tbody.textContent = "";

  if (!Array.isArray(models) || models.length === 0) {
    const tr = makeEl("tr");
    const td = makeEl("td", "empty-cell", "Model statistikası mövcud deyil.");
    td.setAttribute("colspan", "5");
    tr.appendChild(td);
    tbody.appendChild(tr);
    return;
  }

  models.forEach((item) => {
    const tr = makeEl("tr");

    // Model name
    const tdModel = makeEl("td");
    const strongModel = makeEl("strong", "", item.model);
    tdModel.appendChild(strongModel);

    // Requests count
    const tdCount = makeEl("td", "", Number(item.count).toLocaleString());

    // Share % with progress bar
    const tdShare = makeEl("td");
    const shareWrap = makeEl("div", "model-share-cell");
    const track = makeEl("div", "model-share-track");
    const fill = makeEl("div", "model-share-fill");
    fill.style.width = `${Math.min(100, Math.max(2, item.percentage))}%`;
    track.appendChild(fill);
    const pctText = makeEl("span", "", `${item.percentage}%`);
    shareWrap.append(track, pctText);
    tdShare.appendChild(shareWrap);

    // Latency
    const tdLatency = makeEl("td", "", item.avgLatencyMs ? `${item.avgLatencyMs} ms` : "–");

    // Cost
    const tdCost = makeEl("td", "", `${formatUsd(item.totalCostUsd)} / ${formatAzn(item.totalCostAzn)}`);

    tr.append(tdModel, tdCount, tdShare, tdLatency, tdCost);
    tbody.appendChild(tr);
  });
}

function getEventIcon(eventType, mode) {
  if (eventType === "task_feedback" || mode === "feedback") return "👍";
  if (mode === "planner") return "📋";
  if (mode === "build") return "⚡";
  if (mode === "ask") return "💬";
  if (mode === "summary") return "📝";
  if (mode === "export") return "📥";
  if (mode === "auth") return "🔐";
  if (mode === "system") return "⚠️";
  return "●";
}

function renderTelemetryEvents(data) {
  const tbody = document.getElementById("telemetryEventsBody");
  if (!tbody) return;
  tbody.textContent = "";

  if (!Array.isArray(data.items) || data.items.length === 0) {
    const tr = makeEl("tr");
    const td = makeEl("td", "empty-cell", "Heç bir telemetriya hadisəsi tapılmadı.");
    td.setAttribute("colspan", "9");
    tr.appendChild(td);
    tbody.appendChild(tr);
    renderTelemetryPagination({ total: 0, page: 1, totalPages: 1 });
    return;
  }

  data.items.forEach((event) => {
    const tr = makeEl("tr", "clickable-row");
    tr.dataset.telemetryId = event.id;

    // 1. Event Type & summary preview
    const tdEvent = makeEl("td");
    const eventWrap = makeEl("div", "event-type-cell");
    const eventName = makeEl("span", "event-type-name", `${getEventIcon(event.eventType, event.mode)} ${event.eventType}`);
    const eventSub = makeEl("small", "event-type-sub", event.summary || event.category || "Hadisə");
    eventWrap.append(eventName, eventSub);
    if (event.eventType === "task_feedback" || event.eventType === "strategy_feedback") {
      const fbBadge = makeEl(
        "span",
        `feedback-indicator feedback-${event.metadata?.feedback || "like"}`,
        event.metadata?.feedback === "like" ? "👍 Like" : "👎 Dislike"
      );
      eventWrap.appendChild(fbBadge);
    }
    if (event.groundingActive) {
      const gBadge = makeEl("span", "grounding-indicator", "🌐 Search aktiv");
      eventWrap.appendChild(gBadge);
    }
    if (event.onlyNecessaryData) {
      const rBadge = makeEl("span", "restricted-data-indicator", "🔒 Yalnız zəruri məlumat");
      rBadge.title = "İstifadəçi modelin inkişafına töhfəni deaktiv edib. Admin panelinə yalnız zəruri məlumatlar ötürülüb.";
      eventWrap.appendChild(rBadge);
    }
    tdEvent.appendChild(eventWrap);

    // 2. Mode badge
    const tdMode = makeEl("td");
    const modeBadge = makeEl("span", `mode-pill mode-badge-${event.mode || "other"}`, event.mode || "other");
    tdMode.appendChild(modeBadge);

    // 3. Market Mode badge
    const tdMarket = makeEl("td");
    if (event.marketMode === "LOCAL_AZ_MODE") {
      tdMarket.appendChild(makeEl("span", "market-pill-local", "🇦🇿 [LOCAL_AZ]"));
    } else if (event.marketMode === "GLOBAL_MODE") {
      tdMarket.appendChild(makeEl("span", "market-pill-global", "🌐 [GLOBAL]"));
    } else {
      tdMarket.appendChild(makeEl("span", "market-pill-neutral", "–"));
    }

    // 4. Model
    const tdModel = makeEl("td", "", event.model || (event.format ? `format: ${event.format}` : "–"));

    // 5. Masked User ID (Privacy-First)
    const tdUser = makeEl("td");
    const userCode = makeEl("code", "masked-id-code", event.maskedUserId || "usr_anon...00");
    tdUser.appendChild(userCode);

    // 6. Latency
    const tdLatency = makeEl("td", "", event.latencyMs ? `${event.latencyMs} ms` : "–");

    // 7. Token / Cost
    const tdCost = makeEl("td");
    const tok = event.tokens?.total ? `${event.tokens.total.toLocaleString()} tok` : "–";
    const cost = event.costUsd > 0 ? ` · ${formatUsd(event.costUsd)}` : "";
    tdCost.textContent = `${tok}${cost}`;

    // 8. Status
    const tdStatus = makeEl("td");
    if (event.status === "success") {
      tdStatus.appendChild(makeEl("span", "status-tag-success", "✓ Uğurlu"));
    } else {
      tdStatus.appendChild(makeEl("span", "status-tag-error", "✗ Xəta"));
    }

    // 9. Timestamp
    const tdDate = makeEl("td", "", formatDate(event.timestamp));

    tr.append(tdEvent, tdMode, tdMarket, tdModel, tdUser, tdLatency, tdCost, tdStatus, tdDate);
    tbody.appendChild(tr);
  });

  renderTelemetryPagination(data);
}

function renderTelemetryPagination(data) {
  const container = document.getElementById("telemetryPagination");
  if (!container) return;
  container.textContent = "";

  if (!data || data.totalPages <= 1) {
    container.appendChild(makeEl("span", "", `${data?.total || 0} hadisə`));
    return;
  }

  const prevBtn = makeEl("button", "btn btn-ghost", "←");
  prevBtn.disabled = data.page <= 1;
  prevBtn.addEventListener("click", () => {
    if (telemetryState.page > 1) {
      telemetryState.page -= 1;
      loadTelemetry({ onlyFeed: true });
    }
  });

  const infoSpan = makeEl("span", "", `${data.page} / ${data.totalPages} · ${data.total} hadisə`);

  const nextBtn = makeEl("button", "btn btn-ghost", "→");
  nextBtn.disabled = data.page >= data.totalPages;
  nextBtn.addEventListener("click", () => {
    if (telemetryState.page < data.totalPages) {
      telemetryState.page += 1;
      loadTelemetry({ onlyFeed: true });
    }
  });

  container.append(prevBtn, infoSpan, nextBtn);
}

async function openTelemetryModal(id) {
  try {
    const { event } = await fetchJSON(`/admin/api/telemetry/events/${encodeURIComponent(id)}`);
    if (!event) return;

    telemetryState.currentEvent = event;
    const modal = document.getElementById("telemetryModal");
    const titleEl = document.getElementById("telemetryModalTitle");
    const chipsEl = document.getElementById("telemetryModalChips");
    const jsonEl = document.getElementById("telemetryModalJson");

    if (titleEl) {
      titleEl.textContent = `${event.eventType} • ${event.maskedUserId}`;
    }

    const restrictedNoticeEl = document.getElementById("telemetryModalRestrictedNotice");
    if (restrictedNoticeEl) {
      restrictedNoticeEl.hidden = !event.onlyNecessaryData;
    }

    if (chipsEl) {
      chipsEl.textContent = "";
      const chipData = [];
      if (event.onlyNecessaryData) {
        chipData.push(["Məlumat Rejimi", "🔒 Yalnız zəruri məlumat (Model töhfəsi deaktiv)"]);
      }
      chipData.push(
        ["Rejim", event.mode],
        ["Bazar", event.marketMode || "Ümumi"],
        ["Model", event.model || "–"],
        ["Maskalanmış ID", event.maskedUserId],
        ["Status", event.status],
        ["Gecikmə", event.latencyMs ? `${event.latencyMs} ms` : "–"],
        ["Token", event.tokens?.total ? Number(event.tokens.total).toLocaleString() : "–"],
        ["Xərc (AZN)", formatAzn(event.costAzn)],
        ["Xərc (USD)", formatUsd(event.costUsd)],
        ["Tarix", formatDate(event.timestamp)],
      );
      if (event.metadata?.feedback) {
        chipData.push(["Rəy", event.metadata.feedback === "like" ? "👍 Faydalı oldu (Like)" : "👎 Faydalı olmadı (Dislike)"]);
      }
      if (event.metadata?.izahat || event.metadata?.explanation) {
        chipData.push(["Aydın İzahat", event.metadata.izahat || event.metadata.explanation]);
      }
      if (event.metadata?.strategyTitle) {
        chipData.push(["Strategiya", event.metadata.strategyTitle]);
      }
      if (event.groundingActive) {
        chipData.push(["Grounding", "Google Search Aktiv"]);
      }
      if (event.anonymizedIp) {
        chipData.push(["Anonim IP", event.anonymizedIp]);
      }
      chipData.forEach(([label, value]) => {
        if (!value) return;
        const chip = makeEl("div", "modal-chip");
        chip.appendChild(makeEl("span", "", `${label}: `));
        chip.appendChild(makeEl("strong", "", String(value)));
        chipsEl.appendChild(chip);
      });
    }

    if (jsonEl) {
      jsonEl.textContent = JSON.stringify(event, null, 2);
    }

    if (modal) {
      modal.hidden = false;
      document.body.style.overflow = "hidden";
    }
  } catch (err) {
    console.error("Open telemetry modal error:", err);
    alert(`Hadisə detalları açılmadı: ${err.message}`);
  }
}

function closeTelemetryModal() {
  const modal = document.getElementById("telemetryModal");
  if (modal) modal.hidden = true;
  document.body.style.overflow = "";
}

async function loadTelemetry({ onlyFeed = false } = {}) {
  try {
    const q = telemetryQuery();
    if (!onlyFeed) {
      const [overview, eventsData] = await Promise.all([
        fetchJSON(`/admin/api/telemetry/overview?${q}`),
        fetchJSON(`/admin/api/telemetry/events?${q}`),
      ]);
      renderTelemetryKpis(overview);
      renderMarketDistribution(overview.marketDistribution);
      renderModelDistribution(overview.modelDistribution);
      renderTelemetryEvents(eventsData);
    } else {
      const eventsData = await fetchJSON(`/admin/api/telemetry/events?${q}`);
      renderTelemetryEvents(eventsData);
    }
  } catch (error) {
    console.error("Telemetry loading error:", error);
  }
}

// -------------------------------------------------------------
// ✦ AI LEARNING
// -------------------------------------------------------------
const learningState = { interactionPage: 1, candidatePage: 1, loaded: false };

function percent(value) {
  return `${((Number(value) || 0) * 100).toFixed(1)}%`;
}

function formatMoney(value, unknown = false) {
  if (unknown) return "Pricing yoxdur";
  return `$${(Number(value) || 0).toFixed(4)}`;
}

function learningQuery(extra = {}) {
  const params = new URLSearchParams();
  const range = document.getElementById("learningRange")?.value || "7d";
  const now = new Date();
  if (range !== "all") {
    const from = new Date(now);
    if (range === "today") from.setHours(0, 0, 0, 0);
    else from.setDate(from.getDate() - (range === "30d" ? 30 : 7));
    params.set("from", from.toISOString());
  }
  [["mode", "learningMode"], ["provider", "learningProvider"], ["model", "learningModel"], ["taskType", "learningTask"], ["candidateStatus", "learningCandidateStatus"], ["minQuality", "learningMinQuality"], ["maxQuality", "learningMaxQuality"]].forEach(([key, id]) => {
    const value = document.getElementById(id)?.value;
    if (value && value !== "all") params.set(key, value);
  });
  Object.entries(extra).forEach(([key, value]) => params.set(key, value));
  return params.toString();
}

function renderLearningKpis(data) {
  const root = document.getElementById("learningKpis");
  const entries = [
    ["Total AI Interactions", data.totalInteractions], ["Ask Interactions", data.askInteractions],
    ["Build Interactions", data.buildInteractions], ["Training Candidates", data.trainingCandidates],
    ["Approved Samples", data.approvedSamples], ["Pending Review", data.pendingCandidates],
    ["Rejected", data.rejectedCandidates],
  ];
  root.innerHTML = entries.map(([label, value], index) => `<div class="stat ${index === 4 ? "stat-success" : index === 5 ? "stat-warning" : ""}"><span class="label">${escapeHtml(label)}</span><span class="value">${Number(value) || 0}</span></div>`).join("");
  document.getElementById("badgePendingLearning").textContent = data.pendingCandidates || 0;
  document.getElementById("learningCost").innerHTML = `<div class="cost-number">${formatMoney(data.totalEstimatedCost)}</div><div class="cost-breakdown"><span>Ask <strong>${formatMoney(data.askEstimatedCost)}</strong></span><span>Build <strong>${formatMoney(data.buildEstimatedCost)}</strong></span><span>Avg / priced request <strong>${data.averageEstimatedCost === null ? "–" : formatMoney(data.averageEstimatedCost)}</strong></span><span>Input / output tokens <strong>${Number(data.inputTokens).toLocaleString()} / ${Number(data.outputTokens).toLocaleString()}</strong></span></div><p>${data.unpricedInteractions ? `${data.unpricedInteractions} interaction üçün pricing config yoxdur; cost uydurulmayıb.` : "Bütün interaction-lar historical pricing snapshot ilə hesablanıb."}</p>`;
}

function renderGrowth(points) {
  const root = document.getElementById("learningGrowth");
  if (!points.length) { root.innerHTML = '<div class="empty-state">Seçilən period üçün data yoxdur.</div>'; return; }
  const visible = points.slice(-30);
  const max = Math.max(1, ...visible.flatMap((point) => [point.rawInteractions, point.trainingCandidates, point.approvedSamples]));
  root.innerHTML = `<div class="growth-legend"><span><i class="raw"></i>Raw</span><span><i class="candidate"></i>Candidate</span><span><i class="approved"></i>Approved</span></div><div class="growth-bars">${visible.map((point) => `<div class="growth-day" title="${escapeHtml(point.date)} · Raw ${point.rawInteractions} · Candidate ${point.trainingCandidates} · Approved ${point.approvedSamples}"><div class="growth-columns"><i class="raw" style="height:${Math.max(2, point.rawInteractions / max * 100)}%"></i><i class="candidate" style="height:${Math.max(2, point.trainingCandidates / max * 100)}%"></i><i class="approved" style="height:${Math.max(2, point.approvedSamples / max * 100)}%"></i></div><small>${escapeHtml(point.date.slice(5))}</small></div>`).join("")}</div>`;
}

function populateLearningSelect(id, values) {
  const select = document.getElementById(id);
  const current = select.value;
  const base = select.options[0].outerHTML;
  select.innerHTML = base + [...new Set(values.filter(Boolean))].sort().map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join("");
  if ([...select.options].some((option) => option.value === current)) select.value = current;
}

function renderLearningModels(models) {
  document.getElementById("learningModels").innerHTML = models.length ? models.map((item) => `<tr><td><strong>${escapeHtml(item.provider)}</strong><small>${escapeHtml(item.model)}</small></td><td>${item.requestCount}</td><td>${item.averageLatency === null ? "–" : `${item.averageLatency} ms`}</td><td>${item.totalTokens.toLocaleString()}</td><td>${formatMoney(item.estimatedCost)}</td><td>${percent(item.regenerateRate)}</td><td><span class="positive">${percent(item.positiveFeedbackRate)}</span> / <span class="negative">${percent(item.negativeFeedbackRate)}</span></td><td><strong>${Number(item.averageQualityScore).toFixed(2)}</strong></td><td>${percent(item.candidateConversionRate)}</td></tr>`).join("") : '<tr><td colspan="9" class="empty-cell">Model data yoxdur.</td></tr>';
  populateLearningSelect("learningProvider", models.map((item) => item.provider));
  populateLearningSelect("learningModel", models.map((item) => item.model));
}

function renderLearningTasks(tasks) {
  document.getElementById("learningTasks").innerHTML = tasks.length ? tasks.map((item) => `<tr><td><span class="mode-pill ${escapeHtml(item.mode)}">${escapeHtml(item.mode)}</span><strong>${escapeHtml(item.taskType)}</strong></td><td>${item.requestCount}</td><td>${Number(item.averageQualityScore).toFixed(2)}</td><td>${percent(item.regenerateRate)}</td><td>${item.corrections}</td><td>${percent(item.candidateConversionRate)}</td></tr>`).join("") : '<tr><td colspan="6" class="empty-cell">Task data yoxdur.</td></tr>';
  populateLearningSelect("learningTask", tasks.map((item) => item.taskType));
}

function paginationHtml(data, kind) {
  if (data.totalPages <= 1) return `<span>${data.total} nəticə</span>`;
  return `<button class="btn btn-ghost" data-page-kind="${kind}" data-page="${Math.max(1, data.page - 1)}" ${data.page <= 1 ? "disabled" : ""}>←</button><span>${data.page} / ${data.totalPages} · ${data.total} nəticə</span><button class="btn btn-ghost" data-page-kind="${kind}" data-page="${Math.min(data.totalPages, data.page + 1)}" ${data.page >= data.totalPages ? "disabled" : ""}>→</button>`;
}

function renderLearningInteractions(data) {
  document.getElementById("learningInteractions").innerHTML = data.items.length ? data.items.map((item) => `<tr class="clickable-row${item.onlyNecessaryData ? " is-restricted-row" : ""}" data-interaction-id="${escapeHtml(item.id)}"><td>${formatDate(item.createdAt)}</td><td><span class="mode-pill ${escapeHtml(item.mode)}">${escapeHtml(item.mode)}</span><small>${escapeHtml(item.taskType)}</small>${item.onlyNecessaryData ? '<span class="restricted-tag">🔒 Yalnız zəruri</span>' : ''}</td><td>${escapeHtml(item.modelProvider)}<small>${escapeHtml(item.modelName)}</small></td><td>${escapeHtml(item.userPrompt)}</td><td>${escapeHtml(item.modelResponse)}</td><td>${item.latencyMs === null ? "–" : `${item.latencyMs} ms`}</td><td>${item.totalTokens === null ? "–" : item.totalTokens.toLocaleString()}</td><td>${item.estimatedCost === null ? "–" : formatMoney(item.estimatedCost)}</td><td><strong>${Number(item.qualityScore).toFixed(2)}</strong></td><td><span class="review-status ${escapeHtml(item.onlyNecessaryData ? "blocked" : (item.trainingStatus || "none"))}">${escapeHtml(item.onlyNecessaryData ? "🔒 Töhfə deaktiv" : (item.trainingStatus || "—"))}</span></td></tr>`).join("") : '<tr><td colspan="10" class="empty-cell">Interaction yoxdur.</td></tr>';
  const pagination = document.getElementById("learningInteractionPagination");
  pagination.innerHTML = paginationHtml(data, "interaction");
}

function renderLearningCandidates(data) {
  document.getElementById("learningCandidates").innerHTML = data.items.length ? data.items.map((item) => `<tr class="clickable-row" data-candidate-id="${escapeHtml(item.id)}"><td><strong>${escapeHtml(item.taskType)}</strong></td><td>${escapeHtml(item.sanitizedInput)}</td><td>${escapeHtml(item.preferredOutput)}</td><td><strong>${Number(item.qualityScore).toFixed(2)}</strong></td><td>${escapeHtml(item.candidateReason)}</td><td>${item.containsSensitiveData ? '<span class="privacy-redacted">Redacted</span>' : '<span class="privacy-clean">Clean</span>'}</td><td><span class="review-status ${escapeHtml(item.status)}">${escapeHtml(item.status)}</span></td><td>${formatDate(item.createdAt)}</td></tr>`).join("") : '<tr><td colspan="8" class="empty-cell">Candidate yoxdur.</td></tr>';
  document.getElementById("learningCandidatePagination").innerHTML = paginationHtml(data, "candidate");
}

function scoreBreakdown(items = []) {
  return `<div class="score-breakdown">${items.map((item) => `<div><span>${escapeHtml(item.label)} <small>${escapeHtml(item.source)} · ${escapeHtml(item.strength)}</small></span><strong class="${item.value < 0 ? "negative" : "positive"}">${item.value > 0 ? "+" : ""}${Number(item.value).toFixed(2)}</strong></div>`).join("")}</div>`;
}

function openLearningModal(content) {
  document.getElementById("learningModalContent").innerHTML = content;
  document.getElementById("learningModal").hidden = false;
  document.body.style.overflow = "hidden";
}

function closeLearningModal() {
  document.getElementById("learningModal").hidden = true;
  document.body.style.overflow = "";
}

async function openInteractionDetail(id) {
  const { interaction: item } = await fetchJSON(`/admin/api/ai-learning/interactions/${encodeURIComponent(id)}`);
  const restrictedBanner = item.onlyNecessaryData
    ? `<div class="restricted-data-banner"><span>🔒</span><div><strong>Modelin inkişafına töhfə deaktivdir:</strong> İstifadəçi modelin inkişafına töhfə verməkdən imtina edib. Məzmun və fərdi kontekst qorunub, admin panelinə yalnız zəruri əməliyyat məlumatları ötürülüb və təlim namizədlərindən çıxarılıb.</div></div>`
    : "";
  openLearningModal(`${restrictedBanner}<div class="brand-badge">Interaction detail</div><h2 id="learningModalTitle">${escapeHtml(item.mode)} · ${escapeHtml(item.taskType)}</h2><div class="detail-metrics"><span>Provider <strong>${escapeHtml(item.modelProvider)}</strong></span><span>Model <strong>${escapeHtml(item.modelName)}</strong></span><span>Latency <strong>${item.latencyMs ?? "–"} ms</strong></span><span>Tokens <strong>${item.totalTokens ?? "–"}</strong></span><span>Cost <strong>${item.estimatedCost === null ? "Pricing yoxdur" : formatMoney(item.estimatedCost)}</strong></span><span>Quality <strong>${Number(item.qualityScore).toFixed(2)}</strong></span></div><h3>Prompt</h3><pre>${escapeHtml(item.userPrompt)}</pre><h3>Sanitized relevant context</h3><pre>${escapeHtml(JSON.stringify(item.relevantContext, null, 2))}</pre><h3>Model response</h3><pre>${escapeHtml(item.modelResponse)}</pre><h3>Quality score breakdown</h3>${scoreBreakdown(item.qualityBreakdown)}<h3>Signals</h3><pre>${escapeHtml(JSON.stringify(item.signals, null, 2))}</pre><h3>Iteration history</h3>${item.iterations.length ? item.iterations.map((iteration) => `<div class="iteration-card"><strong>V${iteration.iterationNumber}</strong><p>${escapeHtml(iteration.modificationRequest)}</p><pre>${escapeHtml(iteration.response)}</pre></div>`).join("") : '<p class="hint">Iteration yoxdur.</p>'}<h3>Preferred response</h3><pre>${escapeHtml(item.preferredResponse)}</pre><h3>Training candidate</h3><p>${item.candidate ? `<button class="btn btn-ghost" data-modal-candidate="${escapeHtml(item.candidate.id)}">${escapeHtml(item.candidate.status)} candidate-a bax</button>` : "Candidate yaranmayıb."}</p>`);
}

async function openCandidateDetail(id) {
  const { candidate: item } = await fetchJSON(`/admin/api/ai-learning/candidates/${encodeURIComponent(id)}`);
  openLearningModal(`<div class="brand-badge">Training candidate</div><h2 id="learningModalTitle">${escapeHtml(item.taskType)}</h2><div class="detail-metrics"><span>Status <strong>${escapeHtml(item.status)}</strong></span><span>Quality <strong>${Number(item.qualityScore).toFixed(2)}</strong></span><span>Privacy <strong>${item.containsSensitiveData ? "Redacted" : "Clean"}</strong></span><span>Source <strong>${escapeHtml(item.sourceModelProvider)} / ${escapeHtml(item.sourceModelName)}</strong></span></div><h3>Sanitized input</h3><pre>${escapeHtml(item.sanitizedInput)}</pre><h3>Preferred output</h3><pre>${escapeHtml(item.preferredOutput)}</pre><h3>Candidate reason</h3><p>${escapeHtml(item.candidateReason)}</p><h3>Quality breakdown</h3>${scoreBreakdown(item.qualityBreakdown)}<h3>Sanitization result</h3><pre>${escapeHtml(JSON.stringify(item.sanitizationResult, null, 2))}</pre><h3>Response iterations</h3><pre>${escapeHtml(JSON.stringify(item.iterations, null, 2))}</pre><div class="review-actions"><button class="btn btn-ghost" data-review-id="${escapeHtml(item.id)}" data-review-status="pending">Keep Pending</button><button class="btn btn-danger" data-review-id="${escapeHtml(item.id)}" data-review-status="rejected">Reject</button><button class="btn btn-approve" data-review-id="${escapeHtml(item.id)}" data-review-status="approved">Approve for Training</button></div>`);
}

async function loadAiLearning() {
  const query = learningQuery();
  try {
    const [overview, growth, modelsData, tasksData, interactions, candidates] = await Promise.all([
      fetchJSON(`/admin/api/ai-learning/overview?${query}`), fetchJSON(`/admin/api/ai-learning/growth?${query}`),
      fetchJSON(`/admin/api/ai-learning/models?${query}`), fetchJSON(`/admin/api/ai-learning/tasks?${query}`),
      fetchJSON(`/admin/api/ai-learning/interactions?${learningQuery({ page: learningState.interactionPage, pageSize: 20 })}`),
      fetchJSON(`/admin/api/ai-learning/candidates?${learningQuery({ page: learningState.candidatePage, pageSize: 20, status: document.getElementById("learningCandidateStatus")?.value || "all" })}`),
    ]);
    renderLearningKpis(overview); renderGrowth(growth.points); renderLearningModels(modelsData.models); renderLearningTasks(tasksData.tasks); renderLearningInteractions(interactions); renderLearningCandidates(candidates);
    learningState.loaded = true;
  } catch (error) {
    console.error("AI Learning loading error:", error);
    document.getElementById("learningKpis").innerHTML = `<div class="empty-state error">AI Learning məlumatı yüklənmədi: ${escapeHtml(error.message)}</div>`;
  }
}

// -------------------------------------------------------------
// ⚖️ LEGAL REPORTS DASHBOARD
// -------------------------------------------------------------
let allLegalReports = [];

async function loadLegalReports() {
  const container = document.getElementById("legal-reports-container");
  const elTotal = document.getElementById("stat-legal-total");
  const elPending = document.getElementById("stat-legal-pending");
  const elInReview = document.getElementById("stat-legal-inreview");
  const elResolved = document.getElementById("stat-legal-resolved");
  const badgePending = document.getElementById("badgePendingLegal");

  try {
    const data = await fetchJSON("/admin/api/legal-reports");
    allLegalReports = Array.isArray(data.reports) ? data.reports : [];

    const stats = data.stats || {
      total: allLegalReports.length,
      pending: allLegalReports.filter((r) => !r.status || r.status === "received").length,
      inReview: allLegalReports.filter((r) => r.status === "in_review").length,
      resolved: allLegalReports.filter((r) => r.status === "resolved").length,
    };

    if (elTotal) elTotal.textContent = stats.total;
    if (elPending) elPending.textContent = stats.pending;
    if (elInReview) elInReview.textContent = stats.inReview;
    if (elResolved) elResolved.textContent = stats.resolved;
    if (badgePending) {
      badgePending.textContent = stats.pending;
      badgePending.style.display = stats.pending > 0 ? "inline-flex" : "none";
    }

    renderLegalReports();
  } catch (err) {
    console.error("Legal reports loading error:", err);
    if (container) {
      container.innerHTML = `<div class="empty-state error">Müraciətlər yüklənərkən xəta baş verdi: ${escapeHtml(err.message)}</div>`;
    }
  }
}

function renderLegalReports() {
  const container = document.getElementById("legal-reports-container");
  if (!container) return;

  const searchVal = (document.getElementById("legalSearchInput")?.value || "").toLowerCase().trim();
  const statusFilter = document.getElementById("legalStatusFilter")?.value || "all";
  const typeFilter = document.getElementById("legalTypeFilter")?.value || "all";

  const filtered = allLegalReports.filter((rep) => {
    const currentStatus = rep.status || "received";
    if (statusFilter !== "all" && currentStatus !== statusFilter) return false;
    if (typeFilter !== "all" && rep.issueType !== typeFilter) return false;

    if (searchVal) {
      const matchText = [
        rep.issueType,
        rep.description,
        rep.userEmail,
        rep.userName,
        rep.model,
        rep.messageContent,
        rep.id,
      ].filter(Boolean).join(" ").toLowerCase();
      if (!matchText.includes(searchVal)) return false;
    }
    return true;
  });

  if (!filtered.length) {
    container.innerHTML = `
      <div class="empty-state">
        <span class="empty-icon">⚖️</span>
        <p>Heç bir hüquqi problem müraciəti tapılmadı.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = "";

  filtered.forEach((rep) => {
    const currentStatus = rep.status || "received";
    const statusLabels = {
      received: "Gözləyir",
      in_review: "Baxılır",
      resolved: "Həll olundu",
    };
    const statusClasses = {
      received: "status-received",
      in_review: "status-inreview",
      resolved: "status-resolved",
    };

    const card = document.createElement("div");
    card.className = `legal-card ${statusClasses[currentStatus] || ""}`;

    const dateStr = formatDate(rep.createdAt);
    const userDisplay = rep.userName || "Anonim istifadəçi";
    const encodedSubjectFull = encodeURIComponent(`Helmer Hüquqi Müraciətiniz Barədə [${rep.id || ""}]`);
    const encodedSubjectShort = encodeURIComponent(`Helmer Hüquqi Müraciətiniz [${rep.id || ""}]`);
    const emailDisplay = rep.userEmail ? `<a href="mailto:${escapeHtml(rep.userEmail)}?subject=${escapeHtml(encodedSubjectFull)}" class="legal-email-link" title="E-poçt göndər">✉️ ${escapeHtml(rep.userEmail)}</a>` : '<span class="text-muted">E-poçt qeyd olunmayıb</span>';
    const modelBadge = rep.model ? `<span class="model-badge">${escapeHtml(rep.model)}</span>` : "";

    card.innerHTML = `
      <div class="legal-card-header">
        <div class="legal-card-type-row">
          <span class="issue-badge">${escapeHtml(rep.issueType || "Ümumi")}</span>
          <span class="status-badge ${statusClasses[currentStatus]}">${statusLabels[currentStatus] || currentStatus}</span>
          ${modelBadge}
        </div>
        <div class="legal-card-date" title="${escapeHtml(rep.createdAt || "")}">${dateStr}</div>
      </div>

      <div class="legal-user-meta">
        <div class="meta-item"><strong>İstifadəçi:</strong> ${escapeHtml(userDisplay)}</div>
        <div class="meta-item"><strong>Əlaqə:</strong> ${emailDisplay}</div>
        ${rep.ip ? `<div class="meta-item"><strong>IP:</strong> <code>${escapeHtml(rep.ip)}</code></div>` : ""}
      </div>

      <div class="legal-section-title">İstifadəçinin Şikayəti / Təsvir:</div>
      <div class="legal-desc-box">${escapeHtml(rep.description || "")}</div>

      ${rep.messageContent ? `
        <details class="legal-ai-details">
          <summary class="legal-ai-summary">
            <span>İstinad edilən AI Cavabı</span>
            <span class="badge">aç / bağla</span>
          </summary>
          <div class="legal-ai-content">${escapeHtml(rep.messageContent)}</div>
        </details>
      ` : ""}

      <div class="legal-card-actions">
        <div class="status-select-wrap">
          <label for="status_${escapeHtml(rep.id)}">Status:</label>
          <select class="status-select" id="status_${escapeHtml(rep.id)}" data-id="${escapeHtml(rep.id)}">
            <option value="received" ${currentStatus === "received" ? "selected" : ""}>⏳ Gözləyir</option>
            <option value="in_review" ${currentStatus === "in_review" ? "selected" : ""}>🔍 Baxılır</option>
            <option value="resolved" ${currentStatus === "resolved" ? "selected" : ""}>✅ Həll olundu</option>
          </select>
        </div>

        <div class="action-buttons">
          ${rep.userEmail ? `
            <a href="mailto:${escapeHtml(rep.userEmail)}?subject=${escapeHtml(encodedSubjectShort)}" class="btn btn-email">
              ✉️ Cavab yaz
            </a>
          ` : ""}
          <button type="button" class="btn btn-copy" data-id="${escapeHtml(rep.id)}">
            📋 Kopyala
          </button>
          <button type="button" class="btn btn-danger btn-delete" data-id="${escapeHtml(rep.id)}">
            🗑 Sil
          </button>
        </div>
      </div>
    `;

    // Status change listener
    const statusSelect = card.querySelector(".status-select");
    statusSelect?.addEventListener("change", async (e) => {
      const newStatus = e.target.value;
      try {
        await fetchJSON("/admin/api/legal-reports/status", {
          method: "POST",
          body: JSON.stringify({ id: rep.id, status: newStatus }),
        });
        rep.status = newStatus;
        loadLegalReports();
      } catch (err) {
        alert("Status dəyişdirilərkən xəta: " + err.message);
        statusSelect.value = currentStatus;
      }
    });

    // Delete listener
    const deleteBtn = card.querySelector(".btn-delete");
    deleteBtn?.addEventListener("click", async () => {
      if (!confirm("Bu hüquqi müraciəti arxivdən silmək istədiyinizə əminsiniz?")) return;
      try {
        await fetchJSON("/admin/api/legal-reports/delete", {
          method: "POST",
          body: JSON.stringify({ id: rep.id }),
        });
        allLegalReports = allLegalReports.filter((r) => r.id !== rep.id);
        loadLegalReports();
      } catch (err) {
        alert("Silmə xətası: " + err.message);
      }
    });

    // Copy listener
    const copyBtn = card.querySelector(".btn-copy");
    copyBtn?.addEventListener("click", () => {
      const copyText = `[Helmer Hüquqi Müraciət #${rep.id}]\nTarix: ${dateStr}\nNöv: ${rep.issueType}\nİstifadəçi: ${userDisplay} (${rep.userEmail || "email yoxdur"})\nModel: ${rep.model || "Məlum deyil"}\n\nTəsvir:\n${rep.description}\n\nAI Cavabı:\n${rep.messageContent || "(yoxdur)"}`;
      navigator.clipboard.writeText(copyText).then(() => {
        copyBtn.textContent = "✓ Kopyalandı";
        setTimeout(() => copyBtn.textContent = "📋 Kopyala", 1500);
      });
    });

    container.appendChild(card);
  });
}

// -------------------------------------------------------------
// INITIALIZATION
// -------------------------------------------------------------
document.addEventListener("DOMContentLoaded", () => {
  setupTabs();
  loadTelemetry();
  loadLegalReports();

  // Load AI Learning pending count badge on init
  fetchJSON("/admin/api/ai-learning/overview")
    .then((overview) => {
      const badge = document.getElementById("badgePendingLearning");
      if (badge && overview?.pendingCandidates !== undefined) {
        badge.textContent = overview.pendingCandidates || 0;
      }
    })
    .catch(() => {});

  // Telemetry Search & Filter listeners
  const teleSearch = document.getElementById("telemetrySearchInput");
  teleSearch?.addEventListener("input", () => {
    clearTimeout(telemetryState.searchTimer);
    telemetryState.searchTimer = setTimeout(() => {
      telemetryState.page = 1;
      loadTelemetry({ onlyFeed: true });
    }, 300);
  });

  ["telemetryModeFilter", "telemetryMarketFilter", "telemetryModelFilter", "telemetryStatusFilter", "telemetryDateFilter"].forEach((id) => {
    document.getElementById(id)?.addEventListener("change", () => {
      telemetryState.page = 1;
      loadTelemetry();
    });
  });

  document.getElementById("btnRefreshTelemetry")?.addEventListener("click", () => {
    loadTelemetry();
  });

  // Telemetry table row click -> modal
  document.getElementById("telemetryEventsBody")?.addEventListener("click", (e) => {
    const row = e.target.closest("[data-telemetry-id]");
    if (row && row.dataset.telemetryId) {
      openTelemetryModal(row.dataset.telemetryId);
    }
  });

  // Telemetry Modal close
  document.getElementById("telemetryModal")?.addEventListener("click", (e) => {
    if (e.target.closest("[data-close-telemetry-modal]")) {
      closeTelemetryModal();
    }
  });

  // Telemetry Copy JSON
  document.getElementById("btnCopyTelemetryJson")?.addEventListener("click", () => {
    if (!telemetryState.currentEvent) return;
    navigator.clipboard.writeText(JSON.stringify(telemetryState.currentEvent, null, 2)).then(() => {
      const btn = document.getElementById("btnCopyTelemetryJson");
      if (btn) {
        btn.textContent = "✓ Kopyalandı";
        setTimeout(() => { btn.textContent = "📋 JSON Kopyala"; }, 1500);
      }
    });
  });

  // Telemetry Live polling interval (every 8s)
  telemetryState.liveInterval = setInterval(() => {
    const isLive = document.getElementById("telemetryLiveToggle")?.checked;
    const isTelemetryActive = document.getElementById("tabContentTelemetry")?.classList.contains("is-active");
    if (isLive && isTelemetryActive) {
      loadTelemetry({ onlyFeed: true });
    }
  }, 8000);

  // Search & Filter event listeners for Legal & Learning
  document.getElementById("legalSearchInput")?.addEventListener("input", renderLegalReports);
  document.getElementById("legalStatusFilter")?.addEventListener("change", renderLegalReports);
  document.getElementById("legalTypeFilter")?.addEventListener("change", renderLegalReports);
  document.getElementById("btnRefreshLegal")?.addEventListener("click", loadLegalReports);
  document.getElementById("learningRefresh")?.addEventListener("click", loadAiLearning);
  document.getElementById("learningFilters")?.addEventListener("change", () => {
    learningState.interactionPage = 1;
    learningState.candidatePage = 1;
    loadAiLearning();
  });

  let qualityFilterTimer;
  const onQualityInput = () => {
    clearTimeout(qualityFilterTimer);
    qualityFilterTimer = setTimeout(() => {
      learningState.interactionPage = 1;
      learningState.candidatePage = 1;
      loadAiLearning();
    }, 300);
  };
  document.getElementById("learningMinQuality")?.addEventListener("input", onQualityInput);
  document.getElementById("learningMaxQuality")?.addEventListener("input", onQualityInput);
  document.getElementById("tabContentLearning")?.addEventListener("click", (event) => {
    const interaction = event.target.closest("[data-interaction-id]");
    const candidate = event.target.closest("[data-candidate-id]");
    const pageButton = event.target.closest("[data-page-kind]");
    if (interaction) openInteractionDetail(interaction.dataset.interactionId);
    if (candidate) openCandidateDetail(candidate.dataset.candidateId);
    if (pageButton && !pageButton.disabled) {
      if (pageButton.dataset.pageKind === "interaction") learningState.interactionPage = Number(pageButton.dataset.page);
      else learningState.candidatePage = Number(pageButton.dataset.page);
      loadAiLearning();
    }
  });
  document.getElementById("learningModal")?.addEventListener("click", async (event) => {
    if (event.target.closest("[data-close-learning-modal]")) closeLearningModal();
    const candidateLink = event.target.closest("[data-modal-candidate]");
    if (candidateLink) openCandidateDetail(candidateLink.dataset.modalCandidate);
    const review = event.target.closest("[data-review-id]");
    if (review) {
      review.disabled = true;
      try {
        await fetchJSON(`/admin/api/ai-learning/candidates/${encodeURIComponent(review.dataset.reviewId)}/review`, { method: "POST", body: JSON.stringify({ status: review.dataset.reviewStatus }) });
        closeLearningModal();
        loadAiLearning();
      } catch (error) {
        alert(`Review xətası: ${error.message}`);
        review.disabled = false;
      }
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      if (!document.getElementById("telemetryModal")?.hidden) closeTelemetryModal();
      if (!document.getElementById("learningModal")?.hidden) closeLearningModal();
    }
  });
});
