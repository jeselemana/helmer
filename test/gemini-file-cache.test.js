import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { GeminiFileCache } from "../src/services/ai/gemini-file-cache.js";

test("GeminiFileCache stores files and generates deterministic fileId for identical content", () => {
  const cache = new GeminiFileCache({ ttlMs: 10000 });
  const file1 = { name: "report.pdf", size: 5000, mimeType: "application/pdf", data: "base64payload123" };
  const id1 = cache.storeFile(file1);
  assert.ok(id1.startsWith("gfc_"));

  // Storing identical content returns same fileId
  const id2 = cache.storeFile({ ...file1 });
  assert.equal(id1, id2);

  const retrieved = cache.getFile(id1);
  assert.equal(retrieved.name, "report.pdf");
  assert.equal(retrieved.data, "base64payload123");
});

test("GeminiFileCache resolves lightweight file metadata with stored data", () => {
  const cache = new GeminiFileCache({ ttlMs: 10000 });
  const fileId = cache.storeFile({
    name: "data.csv",
    size: 200,
    type: "text/csv",
    textContent: "id,name,price\n1,apple,2.5",
  });

  // Client sends only fileId and name on follow-up turn
  const resolved = cache.resolveFile({ fileId, name: "data.csv", size: 200 });
  assert.ok(resolved);
  assert.equal(resolved.textContent, "id,name,price\n1,apple,2.5");
});

test("GeminiFileCache token estimation works for text and binary files", () => {
  const cache = new GeminiFileCache();
  const smallText = { textContent: "Hello world" };
  assert.equal(cache.estimateTokens(smallText), 3);

  const largeText = { textContent: "A".repeat(160000) };
  assert.equal(cache.estimateTokens(largeText), 40000);

  const binary = { data: "A".repeat(120000) }; // ~90KB
  assert.equal(cache.estimateTokens(binary), 3000);
});

test("GeminiFileCache getOrCreateGeminiCachedContent safely returns null for small files or blocked API", async () => {
  const cache = new GeminiFileCache();
  const file = { name: "small.png", size: 100, data: "smallBase64" };

  // For small files (<32k tokens), returns null without calling gemini.caches.create
  const mockGemini = { caches: { create: async () => { throw new Error("Should not be called"); } } };
  const result = await cache.getOrCreateGeminiCachedContent({
    geminiClient: mockGemini,
    model: "gemini-3.8-flash",
    file,
  });
  assert.equal(result, null);
});

test("GeminiFileCache cleans up expired entries after TTL", async () => {
  const cache = new GeminiFileCache({ ttlMs: 10 }); // 10ms TTL
  const id = cache.storeFile({ name: "temp.txt", textContent: "temporary" });
  assert.ok(cache.getFile(id));

  await new Promise((r) => setTimeout(r, 25));
  cache.cleanup();
  assert.equal(cache.getFile(id), null);
});

test("GeminiFileCache ignores caller-supplied fileId and enforces LRU maxEntries", () => {
  const cache = new GeminiFileCache({ maxEntries: 2 });

  // 1. Caller-supplied fileId is ignored
  const id1 = cache.storeFile({ fileId: "malicious_injected_id", textContent: "file one" });
  assert.notEqual(id1, "malicious_injected_id");
  assert.ok(id1.startsWith("gfc_"));

  const id2 = cache.storeFile({ textContent: "file two" });
  assert.ok(cache.getFile(id1));
  assert.ok(cache.getFile(id2));

  // Access id1 so id2 becomes the least recently used
  cache.getFile(id1);

  // 2. Adding a 3rd file evicts the LRU entry (id2)
  const id3 = cache.storeFile({ textContent: "file three" });
  assert.ok(cache.getFile(id1));
  assert.equal(cache.getFile(id2), null); // Evicted!
  assert.ok(cache.getFile(id3));
});

test("GeminiFileCache persists across instances locally, isolates tenants, and deletes chat/owner files", async () => {
  const storageDir = await fs.mkdtemp(path.join(os.tmpdir(), "helmer-gfc-local-"));
  try {
    const cacheA = new GeminiFileCache({ persist: true, cloud: false, storageDir });
    const stored = await cacheA.resolveFileAsync({
      name: "q4-plan.csv",
      size: 42,
      mimeType: "text/csv",
      textContent: "channel,spend\nsearch,1200",
    }, "user-a");

    assert.ok(stored.fileId.startsWith("gfc_"));
    assert.equal(stored.data, ""); // duplicate base64 omitted when textContent exists

    // Separate replica/instance with empty RAM hydrates from disk for owner-a only
    const cacheB = new GeminiFileCache({ persist: true, cloud: false, storageDir });
    const crossTenant = await cacheB.resolveFileAsync({ fileId: stored.fileId, name: "q4-plan.csv" }, "user-b");
    assert.equal(crossTenant.textContent, undefined);

    const hydrated = await cacheB.resolveFileAsync({ fileId: stored.fileId, name: "q4-plan.csv" }, "user-a");
    assert.equal(hydrated.textContent, "channel,spend\nsearch,1200");

    // Store a second file for another chat of the same owner
    const second = await cacheA.resolveFileAsync({
      name: "other-chat.txt",
      size: 10,
      mimeType: "text/plain",
      textContent: "keep-me",
    }, "user-a");

    // Deleting chat-1 files removes stored.fileId without touching second.fileId
    await cacheB.deleteChatFiles("user-a", [{ file: { fileId: stored.fileId } }]);
    const cacheC = new GeminiFileCache({ persist: true, cloud: false, storageDir });
    const afterChatDelete = await cacheC.resolveFileAsync({ fileId: stored.fileId, name: "q4-plan.csv" }, "user-a");
    assert.equal(afterChatDelete.textContent, undefined);

    const stillPresent = await cacheC.resolveFileAsync({ fileId: second.fileId, name: "other-chat.txt" }, "user-a");
    assert.equal(stillPresent.textContent, "keep-me");

    // Deleting owner persisted files wipes remaining owner files
    await cacheC.deleteOwnerPersistedFiles("user-a");
    const cacheD = new GeminiFileCache({ persist: true, cloud: false, storageDir });
    const afterOwnerDelete = await cacheD.resolveFileAsync({ fileId: second.fileId, name: "other-chat.txt" }, "user-a");
    assert.equal(afterOwnerDelete.textContent, undefined);
  } finally {
    await fs.rm(storageDir, { recursive: true, force: true });
  }
});

test("GeminiFileCache persists to R2 cloud backend and cleans up owner keys", async () => {
  const objects = new Map();
  const cloudOpts = {
    persist: true,
    cloud: true,
    writeCloud: async (prefix, key, record) => {
      objects.set(`data/${prefix}/${key}.json`, structuredClone(record));
      return true;
    },
    readCloud: async (prefix, key) => ({
      record: objects.get(`data/${prefix}/${key}.json`) || null,
      etag: "etag-1",
    }),
    deleteCloud: async (prefixOrKey, maybeKey = null) => {
      const fullKey = maybeKey ? `data/${prefixOrKey}/${maybeKey}.json` : prefixOrKey;
      objects.delete(fullKey);
      return true;
    },
    listCloud: async (prefix) => [...objects.keys()].filter((k) => k.startsWith(`data/${prefix}`)),
  };

  const replica1 = new GeminiFileCache(cloudOpts);
  const replica2 = new GeminiFileCache(cloudOpts);

  const saved = await replica1.resolveFileAsync({
    name: "deck.pdf",
    size: 16,
    mimeType: "application/pdf",
    data: "JVBERi0xLjQ=",
  }, "user-cloud");

  assert.equal(objects.size, 1);
  const hydrated = await replica2.resolveFileAsync({ fileId: saved.fileId, name: "deck.pdf" }, "user-cloud");
  assert.equal(hydrated.data, "JVBERi0xLjQ=");

  await replica2.deleteOwnerPersistedFiles("user-cloud");
  assert.equal(objects.size, 0);
});

