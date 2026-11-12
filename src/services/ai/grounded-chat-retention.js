import { createHash } from "node:crypto";

export const MAX_GROUNDED_CHAT_RETENTION_MS = 730 * 86400000;
export const GROUNDED_STRATEGY_RETENTION_MS = MAX_GROUNDED_CHAT_RETENTION_MS;

function hasGroundedMetadata(gm) {
  if (!gm || typeof gm !== "object") return false;
  const knownKeys = ["groundingChunks", "webSearchQueries", "searchSuggestions", "searchEntryPoint"];
  const hasKnownKey = knownKeys.some((k) => k in gm);
  if (!hasKnownKey) {
    return Object.keys(gm).length > 0;
  }
  return Boolean(
    (Array.isArray(gm.groundingChunks) && gm.groundingChunks.length > 0) ||
    (Array.isArray(gm.webSearchQueries) && gm.webSearchQueries.length > 0) ||
    (Array.isArray(gm.searchSuggestions) && gm.searchSuggestions.length > 0) ||
    (typeof gm.searchEntryPoint?.renderedContent === "string" && gm.searchEntryPoint.renderedContent.trim().length > 0)
  );
}

export function isGroundedAssistantMessage(message) {
  if (!message || (message.role !== "assistant" && message.role !== "model")) return false;
  return Boolean(
    message.type === "research" ||
    message.searchGrounded === true ||
    message.groundingActive === true ||
    (Array.isArray(message.pluginIds) && message.pluginIds.includes("web")) ||
    (Array.isArray(message.sources) && message.sources.length > 0) ||
    hasGroundedMetadata(message.groundingMetadata)
  );
}

export function hasGroundedContent(target) {
  if (!target || typeof target !== "object") return false;
  return Boolean(
    target.searchGrounded === true ||
    target.groundingActive === true ||
    Number(target.sourcesCount) > 0 ||
    (typeof target.firstGroundedAt === "string" && target.firstGroundedAt.trim().length > 0) ||
    (typeof target.lastGroundedAt === "string" && target.lastGroundedAt.trim().length > 0) ||
    (Array.isArray(target.sources) && target.sources.length > 0) ||
    (Array.isArray(target.evidence) && target.evidence.length > 0) ||
    (Array.isArray(target.searchQueries) && target.searchQueries.length > 0) ||
    (typeof target.searchEntryPoint?.renderedContent === "string" && target.searchEntryPoint.renderedContent.trim().length > 0) ||
    hasGroundedMetadata(target.groundingMetadata) ||
    (Array.isArray(target.stageMetrics) &&
      target.stageMetrics.some(
        (stage) => stage && (stage.groundingActive === true || stage.searchGrounded === true || Number(stage.verifiedSourcesCount) > 0)
      ))
  );
}

const INTERNAL_STRATEGY_KEYS = new Set([
  "orchestration",
  "evidence",
  "sources",
  "groundingMetadata",
  "searchEntryPoint",
  "searchQueries",
  "firstGroundedAt",
  "lastGroundedAt",
  "searchGrounded",
  "groundingActive",
]);

export function stripInternalStrategyMetadata(value, depth = 0) {
  if (depth > 16 || value === null || value === undefined) return value;
  if (Array.isArray(value)) {
    return value.map((item) => stripInternalStrategyMetadata(item, depth + 1));
  }
  if (typeof value !== "object") return value;
  const cleaned = {};
  for (const [key, entry] of Object.entries(value)) {
    if (INTERNAL_STRATEGY_KEYS.has(key)) continue;
    cleaned[key] = stripInternalStrategyMetadata(entry, depth + 1);
  }
  return cleaned;
}

export function isGroundedStrategyRecord(record) {
  if (!record || typeof record !== "object") return false;
  if (
    hasGroundedContent(record) ||
    hasGroundedContent(record.orchestration) ||
    hasGroundedContent(record.strategy) ||
    hasGroundedContent(record.strategy?.orchestration)
  ) {
    return true;
  }
  if (Array.isArray(record.versions)) {
    return record.versions.some(
      (version) =>
        hasGroundedContent(version) ||
        hasGroundedContent(version?.orchestration) ||
        hasGroundedContent(version?.data) ||
        hasGroundedContent(version?.data?.orchestration) ||
        hasGroundedContent(version?.strategy) ||
        hasGroundedContent(version?.strategy?.orchestration)
    );
  }
  return false;
}

export function isGroundedArtifactRecord(artifact, strategyRecord = null) {
  if (strategyRecord && isGroundedStrategyRecord(strategyRecord)) return true;
  if (!artifact || typeof artifact !== "object") return false;
  if (isGroundedStrategyRecord(artifact)) return true;
  if (Array.isArray(artifact.versions)) {
    return artifact.versions.some(
      (v) =>
        isGroundedStrategyRecord(v) ||
        isGroundedStrategyRecord(v?.spec) ||
        isGroundedStrategyRecord(v?.execution)
    );
  }
  return false;
}

export function resolveGroundedStrategyTimestamp(record) {
  if (!record || typeof record !== "object") return null;
  const candidates = [
    record.firstGroundedAt,
    record.strategy?.orchestration?.firstGroundedAt,
    record.orchestration?.firstGroundedAt,
    record.createdAt,
    record.strategy?.orchestration?.lastGroundedAt,
    record.orchestration?.lastGroundedAt,
  ].filter((d) => typeof d === "string" && d.trim().length > 0);
  if (candidates.length === 0) return null;
  let earliest = null;
  for (const raw of candidates) {
    const parsed = Date.parse(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) return null;
    if (earliest === null || parsed < earliest) {
      earliest = parsed;
    }
  }
  return earliest;
}

export function isExpiredGroundedStrategyRecord(record, now = Date.now()) {
  if (!isGroundedStrategyRecord(record)) return false;

  const authoritativeDates = [
    record.firstGroundedAt,
    record.strategy?.orchestration?.firstGroundedAt,
    record.orchestration?.firstGroundedAt,
    record.createdAt,
    record.strategy?.orchestration?.lastGroundedAt,
    record.orchestration?.lastGroundedAt,
  ].filter((d) => d !== undefined && d !== null && String(d).trim() !== "");

  // Fail-closed if no authoritative record/source date exists (do not trust client version.createdAt alone)
  if (authoritativeDates.length === 0) {
    return true;
  }

  const versionDates = Array.isArray(record.versions)
    ? record.versions
        .filter(
          (version) =>
            hasGroundedContent(version) ||
            hasGroundedContent(version?.orchestration) ||
            hasGroundedContent(version?.data) ||
            hasGroundedContent(version?.data?.orchestration) ||
            hasGroundedContent(version?.strategy) ||
            hasGroundedContent(version?.strategy?.orchestration)
        )
        .flatMap((version) => [
          version?.data?.orchestration?.firstGroundedAt,
          version?.data?.orchestration?.lastGroundedAt,
          version?.createdAt,
        ])
        .filter((d) => d !== undefined && d !== null && String(d).trim() !== "")
    : [];

  const allDates = [...authoritativeDates, ...versionDates];
  return allDates.some((date) => {
    const created = typeof date === "number" ? date : Date.parse(String(date));
    return !Number.isFinite(created) || created <= 0 || created > now + 60000 || now - created >= MAX_GROUNDED_CHAT_RETENTION_MS;
  });
}

export function pruneExpiredGroundedResults(chat, now = Date.now()) {
  if (!Array.isArray(chat?.messages)) return 0;
  const retained = chat.messages.filter((message) => {
    if (!isGroundedAssistantMessage(message)) return true;
    const created = Date.parse(message.createdAt || chat.createdAt);
    return Number.isFinite(created) && created > 0 && created <= now + 60000 && now - created < MAX_GROUNDED_CHAT_RETENTION_MS;
  });
  const removed = chat.messages.length - retained.length;
  if (removed) chat.messages = retained;
  return removed;
}

export function pruneExpiredGroundedStrategies(records, now = Date.now()) {
  if (!Array.isArray(records)) return 0;
  let removed = 0;
  for (let i = records.length - 1; i >= 0; i--) {
    if (isExpiredGroundedStrategyRecord(records[i], now)) {
      records.splice(i, 1);
      removed++;
    }
  }
  return removed;
}

export function normalizeTaskComparisonText(value) {
  return String(value || "")
    .replace(/^[\s\-*•\d.)\]]+/, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function canonicalHash(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function computeStrategyContentFingerprints(strategyLike) {
  if (!strategyLike || typeof strategyLike !== "object") return [];
  const s =
    strategyLike.strategy && typeof strategyLike.strategy === "object"
      ? strategyLike.strategy
      : strategyLike.data && typeof strategyLike.data === "object"
        ? strategyLike.data
        : strategyLike;
  if (!s || typeof s !== "object") return [];

  const title = typeof s.title === "string" ? s.title.trim() : "";
  const summary = typeof s.summary === "string" ? s.summary.trim() : "";
  const sections = Array.isArray(s.sections)
    ? s.sections.map((sec) => ({
        id: typeof sec?.id === "string" ? sec.id.trim() : "",
        title: typeof sec?.title === "string" ? sec.title.trim() : "",
        summary: typeof sec?.summary === "string" ? sec.summary.trim() : "",
        bullets: Array.isArray(sec?.bullets) ? sec.bullets.map((b) => String(b || "").trim()) : [],
      }))
    : [];
  const roadmap = Array.isArray(s.roadmap)
    ? s.roadmap.map((r) => ({
        phase: typeof r?.phase === "string" ? r.phase.trim() : "",
        focus: typeof r?.focus === "string" ? r.focus.trim() : "",
        actions: Array.isArray(r?.actions) ? r.actions.map((a) => String(a || "").trim()) : [],
      }))
    : [];
  const nextSteps = Array.isArray(s.nextSteps)
    ? s.nextSteps.map((step) => normalizeTaskComparisonText(step)).filter(Boolean)
    : [];

  if (!title && !summary && sections.length === 0 && roadmap.length === 0 && nextSteps.length === 0) return [];

  const fingerprints = [
    `core:${canonicalHash({ title, summary, sections, roadmap, nextSteps })}`,
    `body:${canonicalHash({ summary, sections, roadmap, nextSteps })}`,
  ];
  if (sections.length > 0 || roadmap.length > 0 || nextSteps.length > 0) {
    fingerprints.push(`sections:${canonicalHash({ sections, roadmap, nextSteps })}`);
  }
  if (sections.length > 0 || roadmap.length > 0) {
    fingerprints.push(`sectionsOnly:${canonicalHash({ sections, roadmap })}`);
  }
  if (nextSteps.length > 0) {
    fingerprints.push(`steps:${canonicalHash(nextSteps)}`);
  }
  return fingerprints;
}

const ownerProvenanceStore = new Map();

function isValidProvenanceTimestamp(dateValue, now = Date.now()) {
  if (!dateValue) return false;
  const parsed = typeof dateValue === "number" ? dateValue : Date.parse(String(dateValue));
  return Number.isFinite(parsed) && parsed > 0 && parsed <= now + 60000 && now - parsed < MAX_GROUNDED_CHAT_RETENTION_MS;
}

function getOwnerProvenanceBucket(ownerId) {
  const key = String(ownerId || "").trim();
  if (!key) return null;
  let bucket = ownerProvenanceStore.get(key);
  if (!bucket) {
    bucket = {
      byId: new Map(),
      byKey: new Map(),
      byFingerprint: new Map(),
      byTaskText: new Map(),
      byTitle: new Map(),
      entries: [],
    };
    ownerProvenanceStore.set(key, bucket);
  }
  return bucket;
}

function buildAuthoritativeOrchestration(recordOrStrategy, existingOrchestration = null) {
  const s =
    recordOrStrategy?.strategy && typeof recordOrStrategy.strategy === "object"
      ? recordOrStrategy.strategy
      : recordOrStrategy;
  const rawOrch =
    s?.orchestration && typeof s.orchestration === "object"
      ? s.orchestration
      : recordOrStrategy?.orchestration && typeof recordOrStrategy.orchestration === "object"
        ? recordOrStrategy.orchestration
        : {};
  const prevOrch = existingOrchestration && typeof existingOrchestration === "object" ? existingOrchestration : {};
  const nowIso = new Date().toISOString();

  const candidateFirstDates = [
    prevOrch.firstGroundedAt,
    recordOrStrategy?.firstGroundedAt,
    rawOrch.firstGroundedAt,
    recordOrStrategy?.createdAt,
    rawOrch.lastGroundedAt,
    prevOrch.lastGroundedAt,
  ].filter((d) => typeof d === "string" && Number.isFinite(Date.parse(d)));

  let firstGroundedAt = candidateFirstDates[0] || nowIso;
  for (const d of candidateFirstDates) {
    if (Date.parse(d) < Date.parse(firstGroundedAt)) {
      firstGroundedAt = d;
    }
  }

  const lastGroundedAt =
    rawOrch.lastGroundedAt || prevOrch.lastGroundedAt || recordOrStrategy?.updatedAt || firstGroundedAt;
  const evidence = Array.isArray(rawOrch.evidence) && rawOrch.evidence.length > 0
    ? rawOrch.evidence
    : Array.isArray(prevOrch.evidence)
      ? prevOrch.evidence
      : Array.isArray(s?.evidence)
        ? s.evidence
        : [];
  const sources = Array.isArray(rawOrch.sources) && rawOrch.sources.length > 0
    ? rawOrch.sources
    : Array.isArray(prevOrch.sources)
      ? prevOrch.sources
      : Array.isArray(s?.sources)
        ? s.sources
        : [];

  return {
    mode: rawOrch.mode || prevOrch.mode || "auto",
    strategistModel: rawOrch.strategistModel || prevOrch.strategistModel || "gemini-4-argon",
    thinkingLevel: rawOrch.thinkingLevel || prevOrch.thinkingLevel || "HIGH",
    searchGrounded: true,
    sourcesCount: Math.max(Number(rawOrch.sourcesCount || 0), Number(prevOrch.sourcesCount || 0), evidence.length, sources.length, 1),
    firstGroundedAt,
    lastGroundedAt,
    ...(evidence.length > 0 ? { evidence } : {}),
    ...(sources.length > 0 ? { sources } : {}),
    ...(Array.isArray(rawOrch.stageMetrics) ? { stageMetrics: rawOrch.stageMetrics } : Array.isArray(prevOrch.stageMetrics) ? { stageMetrics: prevOrch.stageMetrics } : {}),
  };
}

function indexProvenanceEntry(bucket, entry) {
  if (!bucket || !entry) return;
  if (entry.id) bucket.byId.set(entry.id, entry);
  if (entry.clientSaveId) bucket.byKey.set(entry.clientSaveId, entry);
  for (const fp of entry.fingerprints || []) {
    bucket.byFingerprint.set(fp, entry);
  }
  if (entry.titleNorm) {
    bucket.byTitle.set(entry.titleNorm, entry);
  }
  for (const taskText of entry.taskTexts || []) {
    if (taskText && taskText.length >= 4) {
      bucket.byTaskText.set(taskText, entry);
    }
  }
  if (!bucket.entries) bucket.entries = [];
  const existingIdx = bucket.entries.findIndex(
    (item) =>
      item === entry ||
      (entry.id && item.id === entry.id) ||
      (entry.clientSaveId && item.clientSaveId === entry.clientSaveId)
  );
  if (existingIdx !== -1) {
    bucket.entries[existingIdx] = entry;
  } else {
    bucket.entries.push(entry);
    if (bucket.entries.length > 250) {
      bucket.entries.splice(0, bucket.entries.length - 250);
    }
  }
}

export function rememberGroundedStrategyProvenance(ownerId, recordOrStrategy, meta = {}) {
  if (!ownerId || !recordOrStrategy || typeof recordOrStrategy !== "object") return null;
  if (!meta.forceGrounded && !isGroundedStrategyRecord(recordOrStrategy)) return null;

  const bucket = getOwnerProvenanceBucket(ownerId);
  if (!bucket) return null;

  const id = meta.id || meta.strategyId || recordOrStrategy.id || null;
  const clientSaveId = meta.clientSaveId || meta.idempotencyKey || recordOrStrategy.clientSaveId || recordOrStrategy.idempotencyKey || null;
  const existingEntry =
    (id && bucket.byId.get(id)) ||
    (clientSaveId && bucket.byKey.get(clientSaveId)) ||
    null;

  const orchestration = buildAuthoritativeOrchestration(recordOrStrategy, existingEntry?.orchestration || meta.orchestration);
  const fingerprints = Array.from(
    new Set([
      ...(Array.isArray(existingEntry?.fingerprints) ? existingEntry.fingerprints : []),
      ...computeStrategyContentFingerprints(recordOrStrategy),
      ...(Array.isArray(recordOrStrategy.versions)
        ? recordOrStrategy.versions.flatMap((v) => computeStrategyContentFingerprints(v?.data || v?.strategy || v))
        : []),
    ])
  );

  const s =
    recordOrStrategy.strategy && typeof recordOrStrategy.strategy === "object"
      ? recordOrStrategy.strategy
      : recordOrStrategy;
  const titleNorm =
    (typeof s?.title === "string" && s.title.trim() ? normalizeTaskComparisonText(s.title) : "") ||
    (typeof recordOrStrategy.title === "string" && recordOrStrategy.title.trim()
      ? normalizeTaskComparisonText(recordOrStrategy.title)
      : "") ||
    existingEntry?.titleNorm ||
    "";

  const steps = [
    ...(Array.isArray(s?.nextSteps) ? s.nextSteps : []),
    ...(Array.isArray(s?.actionPlan)
      ? s.actionPlan.flatMap((phase) => (Array.isArray(phase?.actions) ? phase.actions : []))
      : []),
    ...(Array.isArray(recordOrStrategy.versions)
      ? recordOrStrategy.versions.flatMap((v) => (Array.isArray(v?.data?.nextSteps) ? v.data.nextSteps : []))
      : []),
  ];
  const taskTexts = Array.from(
    new Set([
      ...(Array.isArray(existingEntry?.taskTexts) ? existingEntry.taskTexts : []),
      ...steps.map((step) => normalizeTaskComparisonText(step)).filter((norm) => norm && norm.length >= 4),
    ])
  );

  const entry = {
    ownerId,
    id: id || existingEntry?.id || null,
    clientSaveId: clientSaveId || existingEntry?.clientSaveId || null,
    orchestration,
    firstGroundedAt: orchestration.firstGroundedAt,
    createdAt: recordOrStrategy.createdAt || existingEntry?.createdAt || orchestration.firstGroundedAt,
    fingerprints,
    titleNorm,
    taskTexts,
  };

  indexProvenanceEntry(bucket, entry);
  return entry;
}

export function exportOwnerProvenanceEntries(ownerId, now = Date.now()) {
  const bucket = getOwnerProvenanceBucket(ownerId);
  if (!bucket || !Array.isArray(bucket.entries)) return [];
  const retained = bucket.entries.filter((entry) =>
    isValidProvenanceTimestamp(entry?.firstGroundedAt || entry?.createdAt, now)
  );
  return retained.map((entry) => ({
    ownerId,
    id: entry.id || null,
    clientSaveId: entry.clientSaveId || null,
    orchestration: entry.orchestration || null,
    firstGroundedAt: entry.firstGroundedAt || entry.createdAt || null,
    createdAt: entry.createdAt || entry.firstGroundedAt || null,
    fingerprints: Array.isArray(entry.fingerprints) ? entry.fingerprints : [],
    titleNorm: typeof entry.titleNorm === "string" ? entry.titleNorm : "",
    taskTexts: Array.isArray(entry.taskTexts) ? entry.taskTexts : [],
  }));
}

export function hydrateOwnerProvenanceEntries(ownerId, entries = [], now = Date.now()) {
  if (!ownerId || !Array.isArray(entries) || entries.length === 0) return { retained: [], removed: 0 };
  const bucket = getOwnerProvenanceBucket(ownerId);
  if (!bucket) return { retained: [], removed: 0 };
  let removed = 0;
  const retained = [];
  for (const raw of entries) {
    if (!raw || typeof raw !== "object") {
      removed++;
      continue;
    }
    const ts = raw.firstGroundedAt || raw.orchestration?.firstGroundedAt || raw.createdAt;
    if (!isValidProvenanceTimestamp(ts, now)) {
      removed++;
      continue;
    }
    const normalized = {
      ownerId,
      id: raw.id || null,
      clientSaveId: raw.clientSaveId || null,
      orchestration: raw.orchestration || null,
      firstGroundedAt: ts,
      createdAt: raw.createdAt || ts,
      fingerprints: Array.isArray(raw.fingerprints) ? raw.fingerprints : [],
      titleNorm: typeof raw.titleNorm === "string" ? raw.titleNorm : "",
      taskTexts: Array.isArray(raw.taskTexts) ? raw.taskTexts : [],
    };
    indexProvenanceEntry(bucket, normalized);
    retained.push(normalized);
  }
  return { retained, removed };
}

export function resolveGroundedStrategyProvenance(ownerId, candidate, existingRecords = [], now = Date.now()) {
  if (!candidate || typeof candidate !== "object") {
    return { grounded: false, expired: false, orchestration: null, sourceRecord: null };
  }

  const bucket = getOwnerProvenanceBucket(ownerId);
  const candidateId = candidate.id || candidate.strategyId || null;
  const candidateKey = candidate.clientSaveId || candidate.idempotencyKey || null;
  const candidateFingerprints = Array.from(
    new Set([
      ...computeStrategyContentFingerprints(candidate),
      ...(Array.isArray(candidate.versions)
        ? candidate.versions.flatMap((v) => computeStrategyContentFingerprints(v?.data || v?.strategy || v))
        : []),
    ])
  );
  const candidateFingerprintSet = new Set(candidateFingerprints);

  let matchedEntry = null;
  if (bucket) {
    if (candidateId && bucket.byId.has(candidateId)) {
      matchedEntry = bucket.byId.get(candidateId);
    } else if (candidateKey && bucket.byKey.has(candidateKey)) {
      matchedEntry = bucket.byKey.get(candidateKey);
    } else {
      for (const fp of candidateFingerprints) {
        if (bucket.byFingerprint.has(fp)) {
          matchedEntry = bucket.byFingerprint.get(fp);
          break;
        }
      }
      if (!matchedEntry && candidateFingerprints.length === 0) {
        const stubTitle = normalizeTaskComparisonText(candidate.title || candidate.strategy?.title || "");
        if (stubTitle && bucket.byTitle.has(stubTitle)) {
          matchedEntry = bucket.byTitle.get(stubTitle);
        }
      }
    }
  }

  let matchedRecord = null;
  if (Array.isArray(existingRecords)) {
    for (const rec of existingRecords) {
      if (!rec || (rec.ownerId && ownerId && rec.ownerId !== ownerId)) continue;
      if (!isGroundedStrategyRecord(rec)) continue;
      if (candidateId && rec.id === candidateId) {
        matchedRecord = rec;
        break;
      }
      if (candidateKey && rec.clientSaveId && rec.clientSaveId === candidateKey) {
        matchedRecord = rec;
        break;
      }
      const recFps = [
        ...computeStrategyContentFingerprints(rec),
        ...(Array.isArray(rec.versions)
          ? rec.versions.flatMap((v) => computeStrategyContentFingerprints(v?.data || v?.strategy || v))
          : []),
      ];
      if (recFps.some((fp) => candidateFingerprintSet.has(fp))) {
        matchedRecord = rec;
        break;
      }
    }
  }

  const directlyGrounded = isGroundedStrategyRecord(candidate);
  if (!directlyGrounded && !matchedEntry && !matchedRecord) {
    return { grounded: false, expired: false, orchestration: null, sourceRecord: null };
  }

  const orchestration = buildAuthoritativeOrchestration(
    matchedRecord || candidate,
    matchedEntry?.orchestration || matchedRecord?.strategy?.orchestration || matchedRecord?.orchestration || null
  );
  const entryExpired = matchedEntry
    ? !isValidProvenanceTimestamp(matchedEntry.firstGroundedAt || matchedEntry.createdAt, now)
    : false;
  const recordExpired = matchedRecord ? isExpiredGroundedStrategyRecord(matchedRecord, now) : false;
  const candidateExpired = directlyGrounded && !matchedRecord && !matchedEntry
    ? isExpiredGroundedStrategyRecord(candidate, now)
    : false;
  const expired = Boolean(entryExpired || recordExpired || candidateExpired);

  if (ownerId && !expired) {
    rememberGroundedStrategyProvenance(ownerId, matchedRecord || candidate, {
      forceGrounded: true,
      id: matchedRecord?.id || candidateId,
      clientSaveId: matchedRecord?.clientSaveId || candidateKey,
      orchestration,
    });
  }
  return {
    grounded: true,
    expired,
    orchestration,
    sourceRecord: matchedRecord || matchedEntry || null,
  };
}

export function applyGroundedProvenanceToStrategy(strategyPayload, provenance) {
  if (!provenance?.grounded || !strategyPayload || typeof strategyPayload !== "object") {
    return strategyPayload;
  }
  const orchestration = provenance.orchestration || buildAuthoritativeOrchestration(strategyPayload);
  if (strategyPayload.strategy && typeof strategyPayload.strategy === "object") {
    strategyPayload.strategy = {
      ...strategyPayload.strategy,
      orchestration: {
        ...(strategyPayload.strategy.orchestration || {}),
        ...orchestration,
        searchGrounded: true,
        firstGroundedAt: orchestration.firstGroundedAt,
      },
    };
  } else if ("title" in strategyPayload && "summary" in strategyPayload && Array.isArray(strategyPayload.sections)) {
    strategyPayload.orchestration = {
      ...(strategyPayload.orchestration || {}),
      ...orchestration,
      searchGrounded: true,
      firstGroundedAt: orchestration.firstGroundedAt,
    };
  }
  if (Array.isArray(strategyPayload.versions) && strategyPayload.versions.length > 0) {
    strategyPayload.versions = strategyPayload.versions.map((v, idx) => {
      if (!v || typeof v !== "object") return v;
      if (idx === strategyPayload.versions.length - 1 || isGroundedStrategyRecord(v)) {
        const dataObj = v.data && typeof v.data === "object" ? v.data : null;
        return {
          ...v,
          ...(dataObj
            ? {
                data: {
                  ...dataObj,
                  orchestration: {
                    ...(dataObj.orchestration || {}),
                    ...orchestration,
                    searchGrounded: true,
                    firstGroundedAt: orchestration.firstGroundedAt,
                  },
                },
              }
            : {}),
        };
      }
      return v;
    });
  }
  return strategyPayload;
}

export function isGroundedPlannerTaskInput(
  ownerId,
  { strategyId = null, strategyTitle = null, tasks = [], source = null, searchGrounded = false } = {},
  existingRecords = []
) {
  if (searchGrounded === true) return true;
  if (Array.isArray(tasks) && tasks.some((t) => t && typeof t === "object" && (t.searchGrounded === true || t.groundingActive === true))) {
    return true;
  }

  const bucket = getOwnerProvenanceBucket(ownerId);
  if (strategyId) {
    if (bucket?.byId.has(strategyId)) return true;
    if (Array.isArray(existingRecords)) {
      const matched = existingRecords.find((r) => r && r.id === strategyId && (!r.ownerId || !ownerId || r.ownerId === ownerId));
      if (matched && isGroundedStrategyRecord(matched)) return true;
    }
  }

  const normalizedTasks = (Array.isArray(tasks) ? tasks : [])
    .map((item) => normalizeTaskComparisonText(typeof item === "string" ? item : item?.title || item?.text || ""))
    .filter((t) => t.length >= 4);

  if (bucket && normalizedTasks.length > 0) {
    if (normalizedTasks.some((t) => bucket.byTaskText.has(t))) {
      return true;
    }
    if (bucket.byFingerprint.has(`steps:${canonicalHash(normalizedTasks)}`)) {
      return true;
    }
  }

  if (Array.isArray(existingRecords) && normalizedTasks.length > 0) {
    const taskSet = new Set(normalizedTasks);
    for (const rec of existingRecords) {
      if (!rec || (rec.ownerId && ownerId && rec.ownerId !== ownerId)) continue;
      if (!isGroundedStrategyRecord(rec)) continue;
      const steps = [
        ...(Array.isArray(rec.strategy?.nextSteps) ? rec.strategy.nextSteps : []),
        ...(Array.isArray(rec.strategy?.roadmap) ? rec.strategy.roadmap.flatMap((r) => (Array.isArray(r?.actions) ? r.actions : [])) : []),
        ...(Array.isArray(rec.strategy?.actionPlan) ? rec.strategy.actionPlan.flatMap((a) => (Array.isArray(a?.actions) ? a.actions : [])) : []),
      ];
      for (const step of steps) {
        const norm = normalizeTaskComparisonText(step);
        if (norm && taskSet.has(norm)) {
          rememberGroundedStrategyProvenance(ownerId, rec);
          return true;
        }
      }
    }
  }

  if (strategyTitle && (source === "brief" || strategyId || normalizedTasks.length > 0)) {
    const normTitle = normalizeTaskComparisonText(strategyTitle);
    if (normTitle) {
      if (bucket?.byTitle.has(normTitle)) return true;
      if (Array.isArray(existingRecords)) {
        for (const rec of existingRecords) {
          if (!rec || (rec.ownerId && ownerId && rec.ownerId !== ownerId)) continue;
          if (!isGroundedStrategyRecord(rec)) continue;
          const recTitle = normalizeTaskComparisonText(rec.strategy?.title || rec.title || "");
          if (recTitle && recTitle === normTitle) {
            rememberGroundedStrategyProvenance(ownerId, rec);
            return true;
          }
        }
      }
    }
  }

  return false;
}

