import { AtomicJsonStore, storageCorruption } from "./atomic-json-store.js";
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { listTenantObjects, readTenantObject } from '../http/r2-storage.js';

export const EMPTY_TELEMETRY_STORE = Object.freeze({
  schemaVersion: 1,
  events: [],
});

const MAX_STORED_EVENTS = 10000;

function normalizeStore(value) {
  const source = value && typeof value === "object" ? value : {};
  if (source.events !== undefined && !Array.isArray(source.events)) throw storageCorruption("Invalid telemetry events.");
  return {
    schemaVersion: 1,
    events: Array.isArray(source.events) ? source.events : [],
    ...(source.deleted === true ? { deleted: true } : {}),
  };
}

function redactEvent(event) {
  return {
    id: event.id, eventType: event.eventType, mode: event.mode,
    timestamp: event.timestamp, model: event.model, status: event.status,
    tokens: event.tokens, costUsd: event.costUsd, costAzn: event.costAzn, latencyMs: event.latencyMs,
    groundingActive: event.groundingActive,
    maskedUserId: event.ownerId ? event.maskedUserId : undefined,
    modelImprovement: false, onlyNecessaryData: true,
    summary: '[Zəruri əməliyyat qeydi - Məzmun ötürülmür]',
    category: 'Zəruri Əməliyyat', marketMode: 'GLOBAL_MODE', qualityScore: null,
    metadata: { onlyNecessaryData: true, model: event.model, tokens: event.tokens?.total, latencyMs: event.latencyMs },
    ...(event.ownerId ? { ownerId: event.ownerId } : {}),
  };
}

export class FileTelemetryRepository extends AtomicJsonStore {
  constructor(filePath, redis = null, options = {}) {
    super(filePath, redis, options, {
      redisKey: "helmer:store:telemetry:v1",
      r2FileName: "telemetry-v1.json",
      empty: EMPTY_TELEMETRY_STORE,
      normalize: normalizeStore,
    });
    this.shardsDirectory = `${filePath}.tenants`;
    this.shardOptions = { cloud: this.cloud, mirrorToR2: this.mirrorToR2 };
    this.readShard = options.readShard;
    this.writeShard = options.writeShard;
    this.listShards = options.listShards || (() => listTenantObjects('telemetry-v2/'));
  }

  tenantKey(ownerId) { return createHash('sha256').update(ownerId || 'system').digest('hex'); }

  shardByKey(key) {
    if (!/^[a-f0-9]{64}$/.test(key)) throw new Error('Invalid telemetry tenant');
    const options = {
      ...this.shardOptions,
      readCloud: this.readShard
        ? (readOptions = {}) => this.readShard(key, { force: true, ...readOptions })
        : (readOptions = {}) => readTenantObject(`telemetry-v2/${key}.json`, { force: true, ...readOptions }),
      ...(this.writeShard ? { writeCloud: (store, etag) => this.writeShard(key, store, etag) } : {}),
    };
    return new AtomicJsonStore(path.join(this.shardsDirectory, `${key}.json`), this.redis, options, {
      redisKey: `helmer:store:telemetry:v2:${key}`, r2FileName: `telemetry-v2/${key}.json`, empty: EMPTY_TELEMETRY_STORE, normalize: normalizeStore,
    });
  }

  async readOwner(ownerId) { return this.shardByKey(this.tenantKey(ownerId)).readStore(); }

  async readStore() {
    // Legacy records with no verified owner binding expose operational fields only.
    const legacy = await super.readStore();
    let names;
    if (this.cloud) names = (await this.listShards()).map(key => key.split('/').at(-1));
    else {
      try { names = await fs.readdir(this.shardsDirectory); }
      catch (error) { if (error.code !== 'ENOENT') throw error; names = []; }
    }
    const events = new Map(legacy.events.map(event => {
      const { ownerId, ...visible } = event.ownerId ? event : redactEvent(event);
      return [event.id, visible];
    }));
    for (const name of names.filter(name => /^[a-f0-9]{64}\.json$/.test(name))) {
      for (const event of (await this.shardByKey(name.slice(0, -5)).readStore()).events) events.set(event.id, event);
    }
    return { schemaVersion: 1, events: [...events.values()].sort((a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || ''))).slice(0, MAX_STORED_EVENTS) };
  }

  async scrubOwner(ownerId) {
    if (!ownerId) return;
    await this.shardByKey(this.tenantKey(ownerId)).update(store => {
      store.events = store.events.map(event => event.modelImprovement === undefined
        ? event
        : { ...redactEvent(event), maskedUserId: event.maskedUserId });
    });
    await this.update(store => {
      store.events = store.events.map(event => !event.ownerId || event.ownerId === ownerId ? redactEvent(event) : event);
    });
  }

  async deleteAllByOwner(ownerId) {
    if (!ownerId) return;
    await this.shardByKey(this.tenantKey(ownerId)).update(store => { store.events = []; store.deleted = true; });
    await this.update(store => {
      store.events = store.events.filter(event => event.ownerId !== ownerId)
        .map(event => event.ownerId ? event : redactEvent(event));
    });
  }

  async update(updater) {
    return super.update(async store => {
      const result = await updater(store);
      if (store.events.length > MAX_STORED_EVENTS) store.events = store.events.slice(0, MAX_STORED_EVENTS);
      return result;
    });
  }

  async recordEvent(event, { prepare, ownerId = null, once = false } = {}) {
    return this.shardByKey(this.tenantKey(ownerId)).update(async (store) => {
      if (store.deleted) return null;
      const permitted = prepare ? await prepare(event) : event;
      if (!once || !store.events.some(existing => existing.id === permitted.id)) store.events.unshift(permitted);
      if (store.events.length > MAX_STORED_EVENTS) store.events = store.events.slice(0, MAX_STORED_EVENTS);
      return permitted;
    });
  }

  async recordEventOnce(event, options = {}) {
    return this.recordEvent(event, { ...options, once: true });
  }

  async recordEventsBatch(events) {
    if (!Array.isArray(events) || events.length === 0) return [];
    const result = [];
    for (const event of events) {
      const { ownerId, ...safeEvent } = event;
      result.push(await this.recordEvent(safeEvent, { ownerId }));
    }
    return result;
  }

  async getEventById(id) {
    const store = await this.readStore();
    return store.events.find((e) => e.id === id) || null;
  }

  async listEvents({
    page = 1,
    pageSize = 25,
    mode = "all",
    status = "all",
    model = "all",
    marketMode = "all",
    search = "",
    dateRange = "all",
  } = {}) {
    const store = await this.readStore();
    const now = Date.now();

    let filtered = store.events;

    // Date range filter
    if (dateRange && dateRange !== "all") {
      let cutoff = 0;
      if (dateRange === "today") {
        const start = new Date();
        start.setHours(0, 0, 0, 0);
        cutoff = start.getTime();
      } else if (dateRange === "24h") {
        cutoff = now - 24 * 60 * 60 * 1000;
      } else if (dateRange === "7d") {
        cutoff = now - 7 * 24 * 60 * 60 * 1000;
      } else if (dateRange === "30d") {
        cutoff = now - 30 * 24 * 60 * 60 * 1000;
      }
      if (cutoff > 0) {
        filtered = filtered.filter((e) => new Date(e.timestamp).getTime() >= cutoff);
      }
    }

    // Mode filter
    if (mode && mode !== "all") {
      filtered = filtered.filter((e) => e.mode === mode);
    }

    // Status filter
    if (status && status !== "all") {
      filtered = filtered.filter((e) => e.status === status);
    }

    // Model filter
    if (model && model !== "all") {
      filtered = filtered.filter((e) => e.model && e.model.toLowerCase().includes(model.toLowerCase()));
    }

    // Market mode filter
    if (marketMode && marketMode !== "all") {
      filtered = filtered.filter((e) => e.marketMode === marketMode);
    }

    // Search query filter
    if (search && search.trim()) {
      const q = search.trim().toLowerCase();
      filtered = filtered.filter((e) => {
        const text = [
          e.maskedUserId,
          e.eventType,
          e.mode,
          e.model,
          e.marketMode,
          e.category,
          e.status,
          e.summary,
          e.metadata?.explanation,
          e.metadata?.izahat,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return text.includes(q);
      });
    }

    const total = filtered.length;
    const p = Math.max(1, Number(page) || 1);
    const size = Math.max(1, Math.min(100, Number(pageSize) || 25));
    const totalPages = Math.ceil(total / size) || 1;
    const startIdx = (p - 1) * size;
    const items = filtered.slice(startIdx, startIdx + size);

    return {
      items,
      total,
      page: p,
      pageSize: size,
      totalPages,
    };
  }

  async getOverview({ dateRange = "today" } = {}) {
    const store = await this.readStore();
    const now = Date.now();

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayCutoff = todayStart.getTime();

    const todayEvents = store.events.filter((e) => new Date(e.timestamp).getTime() >= todayCutoff);

    // 1. DAU: Unique masked user IDs with activity today
    const dauUsers = new Set(
      todayEvents
        .map((e) => e.maskedUserId)
        .filter((id) => id && id !== "usr_anon...00")
    );
    const dau = dauUsers.size || (todayEvents.length > 0 ? 1 : 0);

    // 2. Total Strategies Generated
    const totalStrategies = store.events.filter((e) => e.mode === "build" && e.status === "success").length;
    const todayStrategies = todayEvents.filter((e) => e.mode === "build" && e.status === "success").length;

    // 3. Average Model Latency
    const latencyEvents = store.events.filter((e) => Number.isFinite(e.latencyMs) && e.latencyMs > 0);
    const avgLatencyMs = latencyEvents.length
      ? Math.round(latencyEvents.reduce((acc, e) => acc + e.latencyMs, 0) / latencyEvents.length)
      : 0;

    // 4. Daily Estimated API Cost (AZN / USD)
    const todayCostUsd = Number(
      todayEvents.reduce((acc, e) => acc + (Number(e.costUsd) || 0), 0).toFixed(4)
    );
    const todayCostAzn = Number(
      todayEvents.reduce((acc, e) => acc + (Number(e.costAzn) || 0), 0).toFixed(4)
    );
    const allTimeCostUsd = Number(
      store.events.reduce((acc, e) => acc + (Number(e.costUsd) || 0), 0).toFixed(4)
    );
    const allTimeCostAzn = Number(
      store.events.reduce((acc, e) => acc + (Number(e.costAzn) || 0), 0).toFixed(4)
    );

    // 5. Market Mode Ratio (LOCAL_AZ_MODE vs GLOBAL_MODE)
    const marketEvents = store.events.filter(
      (e) => e.marketMode === "LOCAL_AZ_MODE" || e.marketMode === "GLOBAL_MODE"
    );
    const localCount = marketEvents.filter((e) => e.marketMode === "LOCAL_AZ_MODE").length;
    const globalCount = marketEvents.filter((e) => e.marketMode === "GLOBAL_MODE").length;
    const totalMarket = marketEvents.length;
    const localPercent = totalMarket ? Math.round((localCount / totalMarket) * 100) : 50;
    const globalPercent = totalMarket ? 100 - localPercent : 50;

    // 6. Model Load Balance
    const modelStatsMap = new Map();
    for (const event of store.events) {
      if (!event.model) continue;
      const m = event.model;
      const current = modelStatsMap.get(m) || { count: 0, latencies: [], costUsd: 0, costAzn: 0 };
      current.count += 1;
      if (Number.isFinite(event.latencyMs) && event.latencyMs > 0) {
        current.latencies.push(event.latencyMs);
      }
      current.costUsd += Number(event.costUsd) || 0;
      current.costAzn += Number(event.costAzn) || 0;
      modelStatsMap.set(m, current);
    }

    const totalModelRequests = Array.from(modelStatsMap.values()).reduce((sum, item) => sum + item.count, 0) || 1;
    const modelDistribution = Array.from(modelStatsMap.entries())
      .map(([model, stats]) => ({
        model,
        count: stats.count,
        percentage: Number(((stats.count / totalModelRequests) * 100).toFixed(1)),
        avgLatencyMs: stats.latencies.length
          ? Math.round(stats.latencies.reduce((a, b) => a + b, 0) / stats.latencies.length)
          : null,
        totalCostUsd: Number(stats.costUsd.toFixed(4)),
        totalCostAzn: Number(stats.costAzn.toFixed(4)),
      }))
      .sort((a, b) => b.count - a.count);

    // 7. Mode Distribution
    const modeCounts = {};
    for (const event of store.events) {
      const modeKey = event.mode || "other";
      modeCounts[modeKey] = (modeCounts[modeKey] || 0) + 1;
    }
    const totalEventsCount = store.events.length || 1;
    const modeDistribution = Object.entries(modeCounts)
      .map(([mode, count]) => ({
        mode,
        count,
        percentage: Number(((count / totalEventsCount) * 100).toFixed(1)),
      }))
      .sort((a, b) => b.count - a.count);

    // 8. 7-Day Trend
    const dailyTrend = [];
    const DAY_MS = 24 * 60 * 60 * 1000;
    for (let i = 6; i >= 0; i--) {
      const dayStart = todayCutoff - i * DAY_MS;
      const dayEnd = dayStart + DAY_MS;
      const dayDate = new Date(dayStart);
      const isoDate = dayDate.toISOString().slice(0, 10);
      const dayEvents = store.events.filter((e) => {
        const t = new Date(e.timestamp).getTime();
        return t >= dayStart && t < dayEnd;
      });
      const costUsd = Number(dayEvents.reduce((acc, e) => acc + (Number(e.costUsd) || 0), 0).toFixed(4));
      const costAzn = Number(dayEvents.reduce((acc, e) => acc + (Number(e.costAzn) || 0), 0).toFixed(4));
      dailyTrend.push({
        date: isoDate,
        label: i === 0 ? "Bugün" : `${dayDate.getDate()}/${dayDate.getMonth() + 1}`,
        count: dayEvents.length,
        strategies: dayEvents.filter((e) => e.mode === "build").length,
        askQueries: dayEvents.filter((e) => e.mode === "ask").length,
        costUsd,
        costAzn,
      });
    }

    return {
      dau,
      totalStrategies,
      todayStrategies,
      avgLatencyMs,
      todayCostUsd,
      todayCostAzn,
      allTimeCostUsd,
      allTimeCostAzn,
      totalEvents: store.events.length,
      restrictedCount: store.events.filter((e) => e.onlyNecessaryData === true).length,
      todayRestrictedCount: todayEvents.filter((e) => e.onlyNecessaryData === true).length,
      marketDistribution: {
        localCount,
        globalCount,
        localPercent,
        globalPercent,
      },
      modelDistribution,
      modeDistribution,
      dailyTrend,
      timestamp: new Date().toISOString(),
    };
  }
}
