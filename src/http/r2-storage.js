import { S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";

let _s3 = null;

export function isR2Configured() {
  return Boolean(
    process.env.R2_ENDPOINT &&
    process.env.R2_ACCESS_KEY_ID &&
    process.env.R2_SECRET_ACCESS_KEY
  );
}

function getS3Client() {
  if (!isR2Configured()) return null;
  if (!_s3) {
    _s3 = new S3Client({
      region: "auto",
      endpoint: process.env.R2_ENDPOINT,
      forcePathStyle: true,
      requestHandler: { requestTimeout: 30000, connectionTimeout: 5000 },
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
      },
    });
  }
  return _s3;
}

function getBucket() {
  return process.env.R2_BUCKET_NAME || "innovagrp";
}

function artifactKey(key) {
  if (!/^artifacts\/[a-f0-9]{64}\/[a-f0-9-]{36}\/(?:manifest\.json|v[1-9]\d*(?:-[a-f0-9-]{36})?\.(?:docx|xlsx|pptx|pdf))$/.test(key)) throw new Error("Invalid artifact storage key");
  return key;
}

export async function putArtifactObject(key, body, contentType, condition = {}) {
  if (!isR2Configured()) return null;
  return await getS3Client().send(new PutObjectCommand({ Bucket: getBucket(), Key: artifactKey(key), Body: body, ContentType: contentType, ...condition }));
}
export async function readArtifactObject(key) {
  if (!isR2Configured()) return { buffer: null, etag: null };
  try {
    const result = await getS3Client().send(new GetObjectCommand({ Bucket: getBucket(), Key: artifactKey(key) }));
    return { buffer: Buffer.from(await result.Body.transformToByteArray()), etag: result.ETag };
  } catch (error) {
    if (error.name === "NoSuchKey" || error.$metadata?.httpStatusCode === 404) return { buffer: null, etag: null };
    throw error;
  }
}
export async function getArtifactObject(key) { return (await readArtifactObject(key)).buffer; }
export async function deleteArtifactObject(key) {
  if (isR2Configured()) await getS3Client().send(new DeleteObjectCommand({ Bucket: getBucket(), Key: artifactKey(key) }));
}

// Cloudflare R2-dən JSON faylı oxumaq
export async function loadJSONFromR2(fileName, fallback = null) {
  if (!isR2Configured()) return fallback;
  const s3 = getS3Client();
  if (!s3) return fallback;

  try {
    const command = new GetObjectCommand({
      Bucket: getBucket(),
      Key: `data/${fileName}`,
    });
    const response = await s3.send(command);
    const str = await response.Body.transformToString();
    if (!str || !str.trim()) return fallback;
    return JSON.parse(str);
  } catch (err) {
    const code = err.name || err.Code || err.$metadata?.httpStatusCode;
    if (code === "NoSuchKey" || code === 404 || err.message?.includes("NoSuchKey")) {
      return fallback;
    }
    console.error(`❌ Cloudflare R2 oxuma xətası (${fileName}):`, err.message);
    return fallback;
  }
}

// Cloudflare R2-yə JSON faylı yadda saxlamaq
export async function saveJSONToR2(fileName, data) {
  if (!isR2Configured()) return false;
  const s3 = getS3Client();
  if (!s3) return false;

  const fullKey = `data/${fileName}`;
  _r2EtagCache.delete(fullKey);
  try {
    const command = new PutObjectCommand({
      Bucket: getBucket(),
      Key: fullKey,
      Body: JSON.stringify(data, null, 2),
      ContentType: "application/json",
    });
    const response = await s3.send(command);
    if (response?.ETag) {
      setR2EtagCache(fullKey, { record: structuredClone(data), etag: response.ETag, tombstone: false });
    }
    return true;
  } catch (err) {
    _r2EtagCache.delete(fullKey);
    console.error(`❌ Cloudflare R2 yazma xətası (${fileName}):`, err.message);
    return false;
  }
}

// Cloudflare R2-dən JSON faylı silmək
export async function deleteJSONFromR2(fileName) {
  if (!isR2Configured()) return true;
  const s3 = getS3Client();
  if (!s3) return false;

  const fullKey = `data/${fileName}`;
  _r2EtagCache.delete(fullKey);
  try {
    const command = new DeleteObjectCommand({
      Bucket: getBucket(),
      Key: fullKey,
    });
    await s3.send(command);
    return true;
  } catch (err) {
    const code = err.name || err.Code || err.$metadata?.httpStatusCode;
    if (code === "NoSuchKey" || code === 404) return true;
    console.error(`❌ Cloudflare R2 silmə xətası (${fileName}):`, err.message);
    return false;
  }
}

// Cloudflare R2 bağlantısını və oxuma/yazma qabiliyyətini yoxlamaq
export async function testR2Connection() {
  if (!isR2Configured()) {
    return {
      configured: false,
      reason: "Missing R2_ENDPOINT, R2_ACCESS_KEY_ID, or R2_SECRET_ACCESS_KEY",
    };
  }
  const s3 = getS3Client();
  if (!s3) return { configured: false, reason: "Failed to initialize S3 client" };

  try {
    const pingKey = "data/_ping.json";
    const payload = { ping: true, time: new Date().toISOString() };
    await s3.send(
      new PutObjectCommand({
        Bucket: getBucket(),
        Key: pingKey,
        Body: JSON.stringify(payload),
        ContentType: "application/json",
      })
    );
    const getRes = await s3.send(
      new GetObjectCommand({
        Bucket: getBucket(),
        Key: pingKey,
      })
    );
    const str = await getRes.Body.transformToString();
    const parsed = JSON.parse(str || "{}");
    return {
      configured: true,
      accessible: true,
      bucket: getBucket(),
      pingSuccess: parsed.ping === true,
      timestamp: parsed.time,
    };
  } catch (err) {
    return {
      configured: true,
      accessible: false,
      bucket: getBucket(),
      error: err.message,
      code: err.name || err.Code || err.$metadata?.httpStatusCode,
    };
  }
}

// UP uses one conditional object per owner, making the answer, ledger and progression
// one atomic commit across Cloud Run replicas. A configured R2 failure never falls back.
function upKey(ownerHash) {
  if (!/^[a-f0-9]{64}$/.test(ownerHash)) throw new Error('Invalid UP owner key');
  return `data/up-v1/${ownerHash}.json`;
}
export async function readUpObject(ownerHash) {
  try {
    const response = await getS3Client().send(new GetObjectCommand({ Bucket: getBucket(), Key: upKey(ownerHash) }));
    return { record: JSON.parse(await response.Body.transformToString()), etag: response.ETag };
  } catch (error) {
    if (error.name === 'NoSuchKey' || error.$metadata?.httpStatusCode === 404) return { record: null, etag: null };
    throw error;
  }
}
export async function writeUpObject(ownerHash, record, etag) {
  try {
    await getS3Client().send(new PutObjectCommand({ Bucket: getBucket(), Key: upKey(ownerHash),
      Body: JSON.stringify(record), ContentType: 'application/json', ...(etag ? { IfMatch: etag } : { IfNoneMatch: '*' }) }));
    return true;
  } catch (error) {
    const statusCode = error.$metadata?.httpStatusCode;
    if (statusCode === 409 || statusCode === 412 || error.name === "PreconditionFailed") return false;
    throw error;
  }
}

const MAX_R2_ETAG_CACHE_ENTRIES = 256;
const R2_REVALIDATE_TTL_MS = Number.parseInt(process.env.R2_REVALIDATE_TTL_MS || "10000", 10) || 10000;
const _r2EtagCache = new Map();
const _r2InFlightReads = new Map();

function setR2EtagCache(fullKey, entry) {
  if (!entry?.etag || entry.etag === '"dry-run-etag"') {
    _r2EtagCache.delete(fullKey);
    return;
  }
  if (_r2EtagCache.has(fullKey)) _r2EtagCache.delete(fullKey);
  else if (_r2EtagCache.size >= MAX_R2_ETAG_CACHE_ENTRIES) {
    const oldestKey = _r2EtagCache.keys().next().value;
    if (oldestKey) _r2EtagCache.delete(oldestKey);
  }
  _r2EtagCache.set(fullKey, { ...entry, verifiedAt: Date.now() });
}

async function readConditionalJsonFromR2(fullKey, errorLabel, { force = false, clone = true } = {}) {
  if (!isR2Configured()) return { record: null, etag: null, isCloud: false, notFound: true, tombstone: false };
  const s3 = getS3Client();
  if (!s3) return { record: null, etag: null, isCloud: false, notFound: true, tombstone: false };

  const freshCached = !force ? _r2EtagCache.get(fullKey) : null;
  if (freshCached && freshCached.verifiedAt && (Date.now() - freshCached.verifiedAt < R2_REVALIDATE_TTL_MS)) {
    return {
      record: (clone && freshCached.record) ? structuredClone(freshCached.record) : freshCached.record,
      etag: freshCached.etag,
      notFound: false,
      isCloud: true,
      tombstone: Boolean(freshCached.tombstone),
    };
  }

  let pending = !force ? _r2InFlightReads.get(fullKey) : null;
  if (!pending) {
    pending = (async () => {
      const cached = _r2EtagCache.get(fullKey);
      try {
        const command = new GetObjectCommand({
          Bucket: getBucket(),
          Key: fullKey,
          ...(cached?.etag ? { IfNoneMatch: cached.etag } : {}),
        });
        const response = await s3.send(command);
        const bodyStr = await response.Body.transformToString();
        if (!bodyStr || !bodyStr.trim()) {
          _r2EtagCache.delete(fullKey);
          return { record: null, etag: response.ETag || null, isCloud: true, notFound: false, tombstone: false };
        }
        const parsed = JSON.parse(bodyStr);
        const isTombstone = Boolean(parsed && typeof parsed === "object" && !Array.isArray(parsed) && parsed._tombstone);
        const etag = response.ETag || null;
        if (etag) {
          setR2EtagCache(fullKey, { record: structuredClone(parsed), etag, tombstone: isTombstone });
        } else {
          _r2EtagCache.delete(fullKey);
        }
        return { record: parsed, etag, notFound: false, isCloud: true, tombstone: isTombstone };
      } catch (err) {
        const statusCode = err?.$metadata?.httpStatusCode;
        const code = err?.name || err?.Code || statusCode;
        if ((statusCode === 304 || code === "NotModified" || code === 304) && cached) {
          cached.verifiedAt = Date.now();
          return {
            record: cached.record,
            etag: cached.etag,
            notFound: false,
            isCloud: true,
            tombstone: Boolean(cached.tombstone),
          };
        }
        if (code === "NoSuchKey" || code === 404 || err?.message?.includes("NoSuchKey")) {
          _r2EtagCache.delete(fullKey);
          return { record: null, etag: null, notFound: true, isCloud: true, tombstone: false };
        }
        console.error(`❌ Cloudflare R2 ${errorLabel} error:`, err?.message || err);
        throw err;
      }
    })();
    _r2InFlightReads.set(fullKey, pending);
    const clear = () => {
      if (_r2InFlightReads.get(fullKey) === pending) _r2InFlightReads.delete(fullKey);
    };
    pending.then(clear, clear);
  }

  const res = await pending;
  return {
    ...res,
    record: (clone && res.record) ? structuredClone(res.record) : res.record,
  };
}

// Cloudflare R2-dən Users JSON faylı oxumaq (OCC ETag ilə)
export async function readUserObject(options = {}) {
  return readConditionalJsonFromR2("data/users.json", "readUserObject", options);
}

// Cloudflare R2-yə Users JSON faylı yazmaq (OCC ETag CAS ilə)
export async function writeUserObject(record, etag = null) {
  if (!isR2Configured()) return true;
  const s3 = getS3Client();
  if (!s3) return false;

  const fullKey = "data/users.json";
  try {
    const command = new PutObjectCommand({
      Bucket: getBucket(),
      Key: fullKey,
      Body: `${JSON.stringify(record, null, 2)}\n`,
      ContentType: "application/json",
      ...(etag ? { IfMatch: etag } : { IfNoneMatch: "*" }),
    });
    const response = await s3.send(command);
    if (response?.ETag) {
      setR2EtagCache(fullKey, { record: structuredClone(record), etag: response.ETag, tombstone: false });
    } else {
      _r2EtagCache.delete(fullKey);
    }
    return true;
  } catch (err) {
    _r2EtagCache.delete(fullKey);
    const statusCode = err.$metadata?.httpStatusCode;
    if (statusCode === 409 || statusCode === 412 || err.name === "PreconditionFailed") {
      return false; // OCC conflict
    }
    console.error("❌ Cloudflare R2 writeUserObject error:", err?.message || err);
    throw err;
  }
}

// Cloudflare R2-dən AuthStore JSON faylı oxumaq (OCC ETag ilə)
export async function readAuthStoreObject(options = {}) {
  return readConditionalJsonFromR2("data/auth-store.json", "readAuthStoreObject", options);
}

// Cloudflare R2-yə AuthStore JSON faylı yazmaq (OCC ETag CAS ilə)
export async function writeAuthStoreObject(record, etag = null) {
  if (!isR2Configured()) return true;
  const s3 = getS3Client();
  if (!s3) return false;

  const fullKey = "data/auth-store.json";
  try {
    const command = new PutObjectCommand({
      Bucket: getBucket(),
      Key: fullKey,
      Body: `${JSON.stringify(record, null, 2)}\n`,
      ContentType: "application/json",
      ...(etag ? { IfMatch: etag } : { IfNoneMatch: "*" }),
    });
    const response = await s3.send(command);
    if (response?.ETag) {
      setR2EtagCache(fullKey, { record: structuredClone(record), etag: response.ETag, tombstone: false });
    } else {
      _r2EtagCache.delete(fullKey);
    }
    return true;
  } catch (err) {
    _r2EtagCache.delete(fullKey);
    const statusCode = err.$metadata?.httpStatusCode;
    if (statusCode === 409 || statusCode === 412 || err.name === "PreconditionFailed") {
      return false; // OCC conflict
    }
    console.error("❌ Cloudflare R2 writeAuthStoreObject error:", err?.message || err);
    throw err;
  }
}

// --------------------------------------------------------------------------
// Multi-Tenant Sharded Object Storage Helpers (Strategies, Chats, Planner)
// --------------------------------------------------------------------------

function resolveTenantStorageKey(prefixOrKey, maybeTenantKey = null) {
  if (maybeTenantKey) {
    const cleanPrefix = prefixOrKey.replace(/^data\//, "").replace(/\/$/, "");
    return `data/${cleanPrefix}/${maybeTenantKey}.json`;
  }
  if (prefixOrKey.startsWith("data/")) {
    return prefixOrKey;
  }
  return `data/${prefixOrKey}`;
}

/**
 * Reads a tenant-sharded JSON object from Cloudflare R2, returning data and ETag for OCC.
 * Supports both readTenantObject(fullKey) and readTenantObject(prefix, tenantKey).
 * @param {string} prefixOrKey - e.g. "chats-v1" or "data/chats-v1/${tenantKey}.json"
 * @param {string} [maybeTenantKey] - 64-char hex SHA-256 hash of ownerId (optional)
 * @returns {Promise<{ record: any, etag: string | null, notFound?: boolean, isCloud: boolean, tombstone?: boolean }>}
 */
export async function readTenantObject(prefixOrKey, maybeTenantKey = null, options = {}) {
  const hasOptsAsSecond = maybeTenantKey && typeof maybeTenantKey === "object";
  const actualTenantKey = hasOptsAsSecond ? null : maybeTenantKey;
  const actualOptions = hasOptsAsSecond ? maybeTenantKey : options;
  const fullKey = resolveTenantStorageKey(prefixOrKey, actualTenantKey);
  return readConditionalJsonFromR2(fullKey, `readTenantObject (${fullKey})`, actualOptions);
}

/**
 * Writes a tenant-sharded JSON object to Cloudflare R2 using Optimistic Concurrency Control (ETag).
 * Supports both writeTenantObject(key, data, etag) and writeTenantObject(prefix, tenantKey, data, etag).
 * @param {string} prefixOrKey
 * @param {...any} args
 * @returns {Promise<boolean>} True if written successfully, false if OCC conflict (412/409)
 */
export async function writeTenantObject(prefixOrKey, ...args) {
  if (!isR2Configured()) return true;
  const s3 = getS3Client();
  if (!s3) return false;

  let fullKey;
  let data;
  let etag = null;

  if (typeof args[0] === "string") {
    // Called as: writeTenantObject(prefix, tenantKey, data, etag)
    fullKey = resolveTenantStorageKey(prefixOrKey, args[0]);
    data = args[1];
    etag = args[2] || null;
  } else {
    // Called as: writeTenantObject(key, data, etag)
    fullKey = resolveTenantStorageKey(prefixOrKey);
    data = args[0];
    etag = args[1] || null;
  }

  try {
    const response = await s3.send(
      new PutObjectCommand({
        Bucket: getBucket(),
        Key: fullKey,
        Body: `${JSON.stringify(data, null, 2)}\n`,
        ContentType: "application/json",
        ...(etag ? { IfMatch: etag } : { IfNoneMatch: "*" }),
      })
    );
    const isTombstone = Boolean(data && typeof data === "object" && !Array.isArray(data) && data._tombstone);
    if (response?.ETag) {
      setR2EtagCache(fullKey, { record: structuredClone(data), etag: response.ETag, tombstone: isTombstone });
    } else {
      _r2EtagCache.delete(fullKey);
    }
    return true;
  } catch (error) {
    _r2EtagCache.delete(fullKey);
    const statusCode = error.$metadata?.httpStatusCode;
    if (statusCode === 409 || statusCode === 412 || error.name === "PreconditionFailed") {
      return false; // OCC conflict detected
    }
    console.error(`❌ Cloudflare R2 writeTenantObject error (${fullKey}):`, error?.message || error);
    throw error;
  }
}

/**
 * Deletes a tenant-sharded JSON object from Cloudflare R2.
 * Supports both deleteTenantObject(key) and deleteTenantObject(prefix, tenantKey).
 * @param {string} prefixOrKey
 * @param {string} [maybeTenantKey]
 * @returns {Promise<boolean>}
 */
export async function deleteTenantObject(prefixOrKey, maybeTenantKey = null) {
  if (!isR2Configured()) return true;
  const s3 = getS3Client();
  if (!s3) return false;

  const fullKey = resolveTenantStorageKey(prefixOrKey, maybeTenantKey);
  _r2EtagCache.delete(fullKey);
  try {
    await s3.send(
      new DeleteObjectCommand({
        Bucket: getBucket(),
        Key: fullKey,
      })
    );
    return true;
  } catch (error) {
    const code = error.name || error.Code || error.$metadata?.httpStatusCode;
    if (code === "NoSuchKey" || code === 404) return true;
    console.error(`❌ Cloudflare R2 deleteTenantObject error (${fullKey}):`, error?.message || error);
    return false;
  }
}

// Strategy domain helpers
export async function readStrategyObject(tenantKey, options = {}) {
  return readTenantObject("strategies-v1", tenantKey, options);
}

export async function writeStrategyObject(tenantKey, record, etag = null) {
  return writeTenantObject("strategies-v1", tenantKey, record, etag);
}

export async function deleteStrategyObject(tenantKey) {
  return deleteTenantObject("strategies-v1", tenantKey);
}

// Chat domain helpers
export async function readChatObject(tenantKey, options = {}) {
  return readTenantObject("chats-v1", tenantKey, options);
}

export async function writeChatObject(tenantKey, record, etag = null) {
  return writeTenantObject("chats-v1", tenantKey, record, etag);
}

export async function deleteChatObject(tenantKey) {
  return deleteTenantObject("chats-v1", tenantKey);
}

// Planner domain helpers
export async function readPlannerObject(tenantKey, options = {}) {
  return readTenantObject("planner-v1", tenantKey, options);
}

export async function writePlannerObject(tenantKey, record, etag = null) {
  return writeTenantObject("planner-v1", tenantKey, record, etag);
}

export async function deletePlannerObject(tenantKey) {
  return deleteTenantObject("planner-v1", tenantKey);
}

// Tombstone helpers
export async function tombstoneTenantObject(prefixOrKey, maybeTenantKey = null, etag = null) {
  const tombstone = {
    _tombstone: true,
    deletedAt: new Date().toISOString(),
  };
  if (maybeTenantKey && typeof maybeTenantKey === "string" && !etag) {
    return writeTenantObject(prefixOrKey, maybeTenantKey, tombstone, null);
  }
  return writeTenantObject(prefixOrKey, maybeTenantKey, tombstone, etag);
}

export async function tombstoneStrategyObject(tenantKey, etag = null) {
  return tombstoneTenantObject("strategies-v1", tenantKey, etag);
}

export async function tombstoneChatObject(tenantKey, etag = null) {
  return tombstoneTenantObject("chats-v1", tenantKey, etag);
}

export async function tombstonePlannerObject(tenantKey, etag = null) {
  return tombstoneTenantObject("planner-v1", tenantKey, etag);
}



export async function listTenantObjects(prefix) {
  if (!/^[a-z0-9-]+\/$/.test(prefix)) throw new Error('Invalid storage prefix');
  if (!isR2Configured()) return [];
  const keys = []; let token;
  do {
    const page = await getS3Client().send(new ListObjectsV2Command({ Bucket: getBucket(), Prefix: `data/${prefix}`, ContinuationToken: token, MaxKeys: 1000 }));
    keys.push(...(page.Contents || []).map(item => item.Key));
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  return keys;
}
