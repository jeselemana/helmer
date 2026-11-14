import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
  isR2Configured,
  readTenantObject,
  writeTenantObject,
  deleteTenantObject,
  listTenantObjects,
} from "../../http/r2-storage.js";
import { writeJsonAtomically } from "../../repositories/atomic-json-store.js";

const VALID_FILE_ID_RE = /^gfc_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ASK_FILES_PREFIX = "ask-files-v1";

/**
 * Server-side File & Context Cache for Gemini 3.8 Flash.
 *
 * Solves two key problems for multi-turn Ask conversations:
 * 1. Network Bandwidth & Latency: Client does not repeatedly transmit 10-20MB base64 data on every follow-up turn.
 * 2. Token & Cost Optimization: For large documents (>=32,768 tokens), attempts Gemini Context Caching (75% token discount).
 *    For smaller or permission-restricted environments, seamlessly falls back to cached server-side multi-turn payloads.
 */
export class GeminiFileCache {
  constructor(options = {}) {
    this.ttlMs = options.ttlMs || 15 * 60 * 1000; // 15 minute in-memory LRU TTL
    this.persistentTtlMs = options.persistentTtlMs || 7 * 24 * 60 * 60 * 1000; // 7 days cross-replica TTL
    this.maxEntries = options.maxEntries || 100; // Max 100 entries to prevent memory exhaustion
    this.maxBytes = options.maxBytes || 64 * 1024 * 1024;
    this.maxOwnerBytes = options.maxOwnerBytes || 20 * 1024 * 1024;
    this.storageDir = options.storageDir || path.join(process.cwd(), "data", "ask-files");
    this.persist = options.persist ?? true;
    this.cloud = options.cloud;
    this.readCloud = options.readCloud || readTenantObject;
    this.writeCloud = options.writeCloud || writeTenantObject;
    this.deleteCloud = options.deleteCloud || deleteTenantObject;
    this.listCloud = options.listCloud || (() => listTenantObjects(`${ASK_FILES_PREFIX}/`));
    this.onDelete = options.onDelete || null;
    this.cache = new Map();
    this.hashToId = new Map();
    this.inFlightPersists = new Map();
    this.inFlightHydrations = new Map();
    this.minTokenThresholdForGeminiCache = 32768; // Gemini API requirement for cachedContent

    // Periodic cleanup every 10 minutes
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 10 * 60 * 1000);
    if (this.cleanupInterval.unref) {
      this.cleanupInterval.unref();
    }
  }

  /**
   * Compute sha256 hash of file content (data or textContent).
   */
  _computeHash(file) {
    const hasher = crypto.createHash("sha256");
    if (file.textContent) {
      hasher.update("text:" + file.textContent);
    } else if (file.data) {
      hasher.update("base64:" + file.data);
    } else {
      hasher.update("meta:" + (file.name || "") + ":" + (file.size || 0) + ":" + (file.type || file.mimeType || ""));
    }
    return hasher.digest("hex");
  }

  /**
   * Store a file in server cache and return its unique fileId.
   */
  storeFile(file, ownerId = file?.ownerId || null) {
    if (!file || typeof file !== "object") return null;

    const hash = `${ownerId || "legacy"}:${this._computeHash(file)}`;
    if (this.hashToId.has(hash)) {
      const existingId = this.hashToId.get(hash);
      const existing = this.cache.get(existingId);
      if (existing && existing.expiresAt > Date.now()) {
        // Refresh TTL on reuse and update LRU order
        existing.expiresAt = Date.now() + this.ttlMs;
        this.cache.delete(existingId);
        this.cache.set(existingId, existing);
        return existingId;
      }
    }

    // LRU eviction: If cache is full, evict the oldest entry
    if (this.cache.size >= this.maxEntries) {
      const oldestId = this.cache.keys().next().value;
      if (oldestId) {
        this.deleteFile(oldestId);
      }
    }

    // Always generate secure server-side fileId using crypto.randomUUID()
    const fileId = "gfc_" + crypto.randomUUID();
    const name = String(file.name || "fayl").trim();
    const mimeType = String(file.mimeType || file.type || "application/octet-stream").trim();
    const textContent = typeof file.textContent === "string" ? file.textContent : "";
    const rawData = file.data ? String(file.data).replace(/^data:[^;]+;base64,/, "").trim() : "";
    // Text-extracted uploads (txt, csv, docx, xlsx, etc.) only consume textContent at the model boundary.
    const data = textContent ? "" : rawData;
    const size = Number(file.size) || 0;

    const entry = {
      ownerId,
      fileId,
      hash,
      name,
      mimeType,
      type: mimeType,
      data,
      textContent,
      size,
      cachedContentName: null,
      cachedContentExpiresAt: 0,
      createdAt: Date.now(),
      expiresAt: Date.now() + this.ttlMs,
    };

    this._putMemoryEntry(entry);
    return fileId;
  }

  _putMemoryEntry(entry) {
    if (this.cache.size >= this.maxEntries && !this.cache.has(entry.fileId)) {
      const oldestId = this.cache.keys().next().value;
      if (oldestId) this.deleteFile(oldestId);
    }
    const bytes = Buffer.byteLength(entry.data || "") + Buffer.byteLength(entry.textContent || "");
    if (bytes > this.maxOwnerBytes || bytes > this.maxBytes) {
      throw Object.assign(new Error("File exceeds cache capacity"), { status: 413, code: "FILE_TOO_LARGE" });
    }
    const used = (owner) =>
      [...this.cache.values()]
        .filter((item) => owner === undefined || item.ownerId === owner)
        .reduce((sum, item) => sum + (item.bytes || 0), 0);
    for (const [id, item] of this.cache) {
      if (used(entry.ownerId) + bytes <= this.maxOwnerBytes) break;
      if (item.ownerId === entry.ownerId && id !== entry.fileId) this.deleteFile(id);
    }
    while (used() + bytes > this.maxBytes) {
      const oldestId = this.cache.keys().next().value;
      if (!oldestId) break;
      this.deleteFile(oldestId);
    }
    entry.bytes = bytes;
    this.cache.delete(entry.fileId);
    this.cache.set(entry.fileId, entry);
    if (entry.hash) this.hashToId.set(entry.hash, entry.fileId);
  }

  /**
   * Retrieve cached file by fileId.
   */
  getFile(fileId, ownerId = null) {
    if (!fileId) return null;
    const entry = this.cache.get(fileId);
    if (!entry) return null;
    if (entry.ownerId !== ownerId) return null;
    if (entry.expiresAt <= Date.now()) {
      this.deleteFile(fileId);
      return null;
    }
    // Refresh TTL on read and update LRU order
    entry.expiresAt = Date.now() + this.ttlMs;
    this.cache.delete(fileId);
    this.cache.set(fileId, entry);
    return entry;
  }

  /**
   * Hydrate / normalize message file object.
   * If message has only fileId or lightweight metadata, resolves full payload from server cache.
   */
  resolveFile(file, ownerId = file?.ownerId || null) {
    if (!file) return null;
    if (file.data || file.textContent) {
      // Message has raw data; ensure it is stored and indexed in cache
      const fileId = this.storeFile(file, ownerId);
      const entry = this.cache.get(fileId);
      return entry || file;
    }
    if (file.fileId) {
      const cached = this.getFile(file.fileId, ownerId);
      if (cached) return cached;
    }
    return file;
  }

  _isCloud() {
    return this.cloud ?? isR2Configured();
  }

  _ownerHash(ownerId) {
    if (!ownerId || typeof ownerId !== "string") return null;
    return crypto.createHash("sha256").update(ownerId.trim()).digest("hex");
  }

  _storageLocation(ownerId, fileId) {
    const ownerHash = this._ownerHash(ownerId);
    if (!ownerHash || !fileId || !VALID_FILE_ID_RE.test(fileId)) return null;
    const normalizedId = fileId.toLowerCase();
    return {
      ownerHash,
      cloudKey: `${ownerHash}-${normalizedId}`,
      localPath: path.join(this.storageDir, ownerHash, `${normalizedId}.json`),
    };
  }

  async persistEntry(entry) {
    if (!this.persist || !entry || entry.persisted) return false;
    const loc = this._storageLocation(entry.ownerId, entry.fileId);
    if (!loc) return false;
    if (this.inFlightPersists.has(loc.cloudKey)) {
      return this.inFlightPersists.get(loc.cloudKey);
    }
    const promise = (async () => {
      const record = {
        ownerId: entry.ownerId,
        fileId: entry.fileId,
        hash: entry.hash,
        name: entry.name,
        mimeType: entry.mimeType,
        type: entry.type,
        data: entry.data || "",
        textContent: entry.textContent || "",
        size: entry.size || 0,
        createdAt: entry.createdAt || Date.now(),
        expiresAt: Date.now() + this.persistentTtlMs,
      };
      try {
        if (this._isCloud()) {
          await this.writeCloud(ASK_FILES_PREFIX, loc.cloudKey, record, null);
        } else {
          await writeJsonAtomically(loc.localPath, record);
        }
        entry.persisted = true;
        return true;
      } catch (err) {
        console.warn("Ask file persistence skipped:", err?.message || err);
        return false;
      } finally {
        if (this.inFlightPersists.get(loc.cloudKey) === promise) {
          this.inFlightPersists.delete(loc.cloudKey);
        }
      }
    })();
    this.inFlightPersists.set(loc.cloudKey, promise);
    return promise;
  }

  async _loadPersistedEntry(fileId, ownerId) {
    if (!this.persist) return null;
    const loc = this._storageLocation(ownerId, fileId);
    if (!loc) return null;
    if (this.inFlightHydrations.has(loc.cloudKey)) {
      return this.inFlightHydrations.get(loc.cloudKey);
    }
    const promise = (async () => {
      try {
        let record = null;
        if (this._isCloud()) {
          const res = await this.readCloud(ASK_FILES_PREFIX, loc.cloudKey, { force: false });
          record = res?.record || null;
        } else {
          try {
            record = JSON.parse(await fs.readFile(loc.localPath, "utf8"));
          } catch (error) {
            if (error?.code !== "ENOENT") throw error;
          }
        }
        if (!record || typeof record !== "object") return null;
        if (record.ownerId !== ownerId || String(record.fileId || "").toLowerCase() !== fileId.toLowerCase()) return null;
        if (record.expiresAt && record.expiresAt <= Date.now()) return null;
        if (!record.data && !record.textContent) return null;
        const entry = {
          ownerId: record.ownerId,
          fileId: record.fileId,
          hash: record.hash || `${ownerId}:${this._computeHash(record)}`,
          name: String(record.name || "fayl").trim(),
          mimeType: String(record.mimeType || record.type || "application/octet-stream").trim(),
          type: String(record.mimeType || record.type || "application/octet-stream").trim(),
          data: record.textContent ? "" : String(record.data || ""),
          textContent: typeof record.textContent === "string" ? record.textContent : "",
          size: Number(record.size) || 0,
          cachedContentName: null,
          cachedContentExpiresAt: 0,
          createdAt: Number(record.createdAt) || Date.now(),
          expiresAt: Date.now() + this.ttlMs,
          persisted: true,
        };
        this._putMemoryEntry(entry);
        return entry;
      } catch (err) {
        console.warn("Ask file hydration failed:", err?.message || err);
        return null;
      } finally {
        if (this.inFlightHydrations.get(loc.cloudKey) === promise) {
          this.inFlightHydrations.delete(loc.cloudKey);
        }
      }
    })();
    this.inFlightHydrations.set(loc.cloudKey, promise);
    return promise;
  }

  /**
   * Async hydration across in-memory LRU, local atomic storage, and R2.
   * Ensures multi-replica Cloud Run requests and reloaded chats keep file context.
   */
  async resolveFileAsync(file, ownerId = file?.ownerId || null) {
    if (!file) return null;
    if (!ownerId) return this.resolveFile(file, ownerId);
    if (file.data || file.textContent) {
      const entry = this.resolveFile(file, ownerId);
      if (entry && entry.fileId) {
        await this.persistEntry(entry);
      }
      return entry;
    }
    if (file.fileId) {
      const cached = this.getFile(file.fileId, ownerId);
      if (cached) return cached;
      const hydrated = await this._loadPersistedEntry(file.fileId, ownerId);
      if (hydrated) return hydrated;
    }
    return file;
  }

  /**
   * Estimate token count for text or binary file to decide on Gemini Context Caching.
   */
  estimateTokens(file) {
    if (!file) return 0;
    if (file.textContent) {
      // Rough estimate: ~4 characters per token
      return Math.ceil(file.textContent.length / 4);
    }
    if (file.data) {
      // For images, typical token cost is 258 to 1500 tokens.
      // For large PDFs, base64 payload of 1MB is ~30,000-40,000 tokens.
      const bytes = (file.data.length * 3) / 4;
      return Math.ceil(bytes / 30);
    }
    return 0;
  }

  /**
   * Attempt to create or reuse a Gemini Context Cache resource for large documents.
   * Safe with automatic graceful fallback if CacheService is not enabled on the API key or token count is < 32k.
   */
  async getOrCreateGeminiCachedContent({ geminiClient, model = "gemini-3.8-flash", file, systemInstruction = "" }) {
    if (!geminiClient || !file) return null;

    const fileEntry = this.resolveFile(file);
    if (!fileEntry) return null;

    // Check if we already have an active Gemini cache for this file
    if (fileEntry.cachedContentName && fileEntry.cachedContentExpiresAt > Date.now() + 60000) {
      return fileEntry.cachedContentName;
    }

    // Only attempt Gemini Context Caching if estimated tokens >= 32,768 (Gemini minimum threshold)
    const estimated = this.estimateTokens(fileEntry);
    if (estimated < this.minTokenThresholdForGeminiCache) {
      return null;
    }

    if (!geminiClient.caches || typeof geminiClient.caches.create !== "function") {
      return null;
    }

    try {
      const contents = [];
      if (fileEntry.textContent) {
        contents.push({
          role: "user",
          parts: [{ text: "[Sənəd konteksti: \"" + fileEntry.name + "\"]\n```\n" + fileEntry.textContent + "\n```" }],
        });
      } else if (fileEntry.data) {
        contents.push({
          role: "user",
          parts: [{ inlineData: { mimeType: fileEntry.mimeType, data: fileEntry.data } }],
        });
      }

      if (contents.length === 0) return null;

      const cacheResponse = await geminiClient.caches.create({
        model,
        config: {
          displayName: "helmer_doc_" + fileEntry.fileId.slice(0, 12),
          ttl: "900s",
          contents,
          systemInstruction: systemInstruction ? { parts: [{ text: systemInstruction }] } : undefined,
        },
      });

      if (cacheResponse && cacheResponse.name) {
        fileEntry.cachedContentName = cacheResponse.name;
        fileEntry.cachedContentExpiresAt = Date.now() + 850 * 1000;
        return cacheResponse.name;
      }
    } catch (err) {
      // If CacheService is blocked (403), token count < 32k, or any network issue,
      // fail open and return null to use standard inline transmission.
      fileEntry.cachedContentName = null;
      return null;
    }

    return null;
  }

  async deleteChatFiles(ownerId, messages = []) {
    if (!ownerId || !Array.isArray(messages) || messages.length === 0) return;
    const fileIds = [...new Set(
      messages
        .map((m) => m?.file?.fileId)
        .filter((id) => typeof id === "string" && VALID_FILE_ID_RE.test(id))
    )];
    for (const fileId of fileIds) {
      const entry = this.cache.get(fileId);
      if (entry && entry.ownerId === ownerId) {
        this.deleteFile(fileId);
      }
      if (!this.persist) continue;
      const loc = this._storageLocation(ownerId, fileId);
      if (!loc) continue;
      if (this._isCloud()) {
        await this.deleteCloud(ASK_FILES_PREFIX, loc.cloudKey).catch(() => {});
      } else {
        await fs.rm(loc.localPath, { force: true }).catch(() => {});
      }
    }
  }

  async deleteOwnerPersistedFiles(ownerId) {
    this.clearOwner(ownerId);
    if (!this.persist || !ownerId) return;
    const ownerHash = this._ownerHash(ownerId);
    if (!ownerHash) return;
    if (this._isCloud()) {
      const keys = await this.listCloud(`${ASK_FILES_PREFIX}/`).catch(() => []);
      const prefixSegment = `${ASK_FILES_PREFIX}/${ownerHash}-`;
      for (const key of keys) {
        if (typeof key !== "string") continue;
        if (key.includes(prefixSegment)) {
          await this.deleteCloud(key).catch(() => {});
        } else if (key.startsWith(`${ownerHash}-`)) {
          const cleanKey = key.replace(/\.json$/i, "");
          await this.deleteCloud(ASK_FILES_PREFIX, cleanKey).catch(() => {});
        }
      }
      return;
    }
    const ownerDir = path.join(this.storageDir, ownerHash);
    await fs.rm(ownerDir, { recursive: true, force: true }).catch(() => {});
  }

  deleteFile(fileId) {
    const entry = this.cache.get(fileId);
    if (entry) {
      if (entry.hash) this.hashToId.delete(entry.hash);
      this.cache.delete(fileId);
      if (entry.cachedContentName && this.onDelete) Promise.resolve(this.onDelete(entry.cachedContentName)).catch(() => {});
    }
  }

  cleanup() {
    const now = Date.now();
    for (const [id, entry] of this.cache.entries()) {
      if (entry.expiresAt <= now) {
        this.deleteFile(id);
      }
    }
  }

  clearOwner(ownerId) {
    for (const [id, entry] of this.cache) if (entry.ownerId === ownerId) this.deleteFile(id);
  }

  clear() {
    for (const id of [...this.cache.keys()]) this.deleteFile(id);
    this.cache.clear();
    this.hashToId.clear();
  }
}

export const geminiFileCache = new GeminiFileCache();
