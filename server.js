import { publicAskErrorCode } from './src/http/ask-errors.js';
import { sanitizeAskGroundingMetadata } from './src/services/ai/ask-grounding.js';
import { createAskHandler } from './src/http/ask-handler.js';
import { createAskService } from './src/services/ai/ask-service.js';
import { readTenantObject } from "./src/http/r2-storage.js";
import { z } from "zod";
import { isR2Configured, loadJSONFromR2, saveJSONToR2, testR2Connection } from "./src/http/r2-storage.js";
import express from "express";
import { maintenanceMiddleware } from "./src/http/maintenance.js";
import dotenv from "dotenv";
import cors from "cors";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { FileUserRepository } from "./src/repositories/file-user-repository.js";
import { FileAuthStore, RedisAuthStore } from "./src/auth/auth-store.js";
import { PasswordResetEmailService } from "./src/auth/email-service.js";
import { createIdentityMiddleware, requireAuth } from "./src/http/auth-middleware.js";
import { guestSession } from "./src/http/session.js";
import { authErrorHandler, createAuthRouter } from "./src/http/auth-router.js";
import {
  createStrategyRouter,
  strategyErrorHandler,
} from "./src/http/strategy-router.js";
import { FileStrategyRepository } from "./src/repositories/file-strategy-repository.js";
import { FileChatRepository } from "./src/repositories/file-chat-repository.js";
import { FileUpRepository } from "./src/repositories/file-up-repository.js";
import { UpService } from "./src/services/up/up-service.js";
import { createUpRouter } from "./src/http/up-router.js";
import { FilePlannerRepository } from "./src/repositories/file-planner-repository.js";
import { createPlannerRouter } from "./src/http/planner-router.js";
import { getOpenAIClient } from "./src/services/ai/client.js";
import { httpStatusOf, publicErrorMessage } from "./src/http/error-response.js";
import { geminiFileCache } from "./src/services/ai/gemini-file-cache.js";
import { ASK_INSTRUCTIONS, GUEST_RESTRICTION_NOTICES } from "./src/services/ai/prompts.js";
import { FileAiLearningRepository } from "./src/repositories/file-ai-learning-repository.js";
import { LearningLoopService } from "./src/services/learning/learning-loop-service.js";
import { createAiLearningAdminRouter, createAiLearningSignalRouter } from "./src/http/ai-learning-router.js";
import { FileTelemetryRepository } from "./src/repositories/file-telemetry-repository.js";
import { TelemetryService } from "./src/services/telemetry/telemetry-service.js";
import { createTelemetryAdminRouter, createTelemetryClientRouter } from "./src/http/telemetry-router.js";
import { createAdminMfaRouter } from "./src/auth/admin-mfa.js";
import { validateSecurityConfig, guestDailyLimit, guestBuildDailyLimit } from "./src/services/security/config.js";
import { AiPolicy, ASK_REQUESTS_PER_MINUTE } from "./src/services/security/ai-policy.js";
import { configureProviderPolicy } from "./src/services/security/provider-policy.js";
import { CleanupQueue } from "./src/services/security/cleanup-queue.js";
import { DurableStore } from "./src/services/security/durable-store.js";
import { PrivacyPolicy, executionContext } from "./src/services/security/privacy-policy.js";
import { createRequireAdmin } from "./src/http/admin-authorization.js";
import { createClient } from "redis";
import { ArtifactRepository } from "./src/repositories/artifact-repository.js";
import { createPluginRegistry } from "./src/services/plugins/registry.js";
import { CapabilityWorkflow } from "./src/services/plugins/workflow.js";
import { createCapabilityRouter, createArtifactRouter } from "./src/http/capability-router.js";
import { createAskExecutionGuard } from "./src/http/ask-execution-guard.js";
import { createWebResearch } from "./src/services/plugins/research.js";
import { DistributedResearchService as ResearchService } from "./src/services/ai/distributed-research.js";
import { createResearchRouter } from "./src/http/research-router.js";
import { GuestRetention } from "./src/services/security/guest-retention.js";

dotenv.config();
validateSecurityConfig();

const isProduction = process.env.NODE_ENV === "production";

// ES module üçün __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 🔥 REDIS (Cache & Session store)
const redis = process.env.REDIS_URL
  ? createClient({ url: process.env.REDIS_URL })
  : null;

// Event listeners — createClient-dən SONRA gəlməlidir
redis?.on("connect", () => console.log("🔥 Redis connected"));
redis?.on("error", (err) => console.error("❌ Redis error:", err));

// Render-da auto-reconnect üçün
if (redis) {
  try {
    await redis.connect();
  } catch (err) {
    console.error("❌ Redis connection error:", err.message);
  }
}

const app = express();
app.set("trust proxy", 1);
// Operational timings contain no account identifiers, prompts or outputs.
app.use((req, res, next) => {
  if (req.method === "POST" && req.path === "/api/ask") {
    req.askTimings = { startedAt: Date.now() };
    res.once("finish", () => {
      const { startedAt, ...timings } = req.askTimings;
      console.log("[Ask timing]", JSON.stringify({ ...timings, authenticated: Boolean(req.user), status: res.statusCode, totalMs: Date.now() - startedAt }));
    });
  }
  next();
});

const APP_PORT = process.env.PORT || 8080;
const APP_URL = process.env.APP_URL || `http://localhost:${APP_PORT}`;

function normalizeOrigin(value) {
  try {
    return new URL(String(value || '').trim()).origin;
  } catch {
    return String(value || '').trim().replace(/\/+$/, '');
  }
}

const configuredOrigins = [
  ...String(process.env.ALLOWED_ORIGINS || '').split(','),
  ...String(process.env.TRUSTED_ORIGINS || '').split(','),
].map(normalizeOrigin).filter(Boolean);

let appOrigin = '';
try {
  appOrigin = normalizeOrigin(new URL(APP_URL).origin);
} catch {}

const defaultOrigins = [
  appOrigin,
  'https://helmeros.com',
  'https://www.helmeros.com',
].filter(Boolean);

const trustedOrigins = new Set([...defaultOrigins, ...configuredOrigins]);

function isTrustedRequestOrigin(req, origin) {
  const normalized = normalizeOrigin(origin);
  if (!normalized) return false;
  if (process.env.NODE_ENV === 'production' && !normalized.startsWith('https://')) return false;
  if (process.env.NODE_ENV !== 'production' && /^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/.test(normalized)) {
    return true;
  }
  return trustedOrigins.has(normalized);
}

app.use((req, res, next) => {
  res.set({
    "Strict-Transport-Security": "max-age=31536000; includeSubDomains; preload",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), geolocation=(), microphone=()",
    "Cross-Origin-Opener-Policy": "same-origin-allow-popups",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Content-Security-Policy": "default-src 'self'; script-src 'self' https://accounts.google.com https://challenges.cloudflare.com https://static.cloudflareinsights.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data: https://*.googleusercontent.com https://lh3.googleusercontent.com; connect-src 'self' https://accounts.google.com https://challenges.cloudflare.com https://cloudflareinsights.com; font-src 'self' data: https://fonts.gstatic.com; frame-src https://accounts.google.com https://challenges.cloudflare.com; base-uri 'self'; frame-ancestors 'none'; form-action 'self'",
  });
  next();
});
app.use(maintenanceMiddleware);
app.use(cors((req, callback) => {
  const origin = req.get("Origin");
  if (!origin || isTrustedRequestOrigin(req, origin)) {
    return callback(null, { credentials: true, origin: origin || false });
  }
  return callback(null, { credentials: false, origin: false });
}));
app.use((req, res, next) => {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) return next();
  const secFetchSite = req.get("sec-fetch-site");
  if (secFetchSite && ["cross-site"].includes(secFetchSite.toLowerCase())) {
    return res.status(403).json({ error: "Kənar domen sorğusu rədd edildi.", code: "CSRF_CROSS_SITE_REJECTED" });
  }
  const source = req.get("Origin") || (() => {
    try { return new URL(req.get("Referer")).origin; } catch { return ""; }
  })();
  if (source && isTrustedRequestOrigin(req, source)) return next();
  if (!source && process.env.NODE_ENV !== "production") return next();
  return res.status(403).json({ error: "Sorğunun mənbəyi təsdiqlənmədi.", code: "CSRF_ORIGIN_REJECTED" });
});



// 🔍 SEO & Webmaster Discovery Endpoints
app.get("/robots.txt", (req, res) => {
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=86400");
  return res.sendFile(path.join(__dirname, "public", "robots.txt"));
});

app.get("/sitemap.xml", (req, res) => {
  res.setHeader("Content-Type", "application/xml; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=86400");
  return res.sendFile(path.join(__dirname, "public", "sitemap.xml"));
});

app.get("/manifest.json", (req, res) => {
  res.setHeader("Content-Type", "application/manifest+json; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  return res.sendFile(path.join(__dirname, "public", "manifest.json"));
});

// 🩺 Health & Storage Diagnostics
app.get("/api/health", (req, res) => {
  const redisRequired = Boolean(process.env.REDIS_URL || process.env.REQUIRE_REDIS === "true");
  if (process.env.NODE_ENV === "production" && redisRequired && !redis?.isReady) res.status(503);
  return res.json({
    status: process.env.NODE_ENV !== "production" || !redisRequired || redis?.isReady ? "ok" : "unavailable",
    app: "Helmer",
    storage: {
      r2Configured: isR2Configured(),
      redisReady: Boolean(redis?.isReady),
    },
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});

app.get(["/favicon.ico", "/favicon.png", "/MarketifyAINewFavicon.png", "/MarketifyAIpwaicon.png", "/pwa-icon.png"], (req, res) => {
  res.setHeader("Content-Type", "image/png");
  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  return res.sendFile(path.join(__dirname, "public", "MarketifyAINewFavicon.png"));
});

// Protect direct static access to admin template and assets
const PROTECTED_ADMIN_ASSETS = new Set(["/index_admin.html", "/admin.js", "/admin.css"]);
const publicStaticHandler = express.static("public", {
  index: false,
  setHeaders: (res, filePath) => {
    if (filePath.endsWith(".html")) {
      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      res.setHeader("Pragma", "no-cache");
      res.setHeader("Expires", "0");
    } else if (filePath.endsWith(".css") || filePath.endsWith(".js")) {
      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      res.setHeader("Pragma", "no-cache");
      res.setHeader("Expires", "0");
    }
  },
});

app.use((req, res, next) => {
  let staticPath;
  try { staticPath = path.posix.normalize(decodeURIComponent(req.path).replaceAll("\\", "/")).toLowerCase(); }
  catch { return res.status(400).end(); }
  if (PROTECTED_ADMIN_ASSETS.has(staticPath)) {
    // Skip public static serving; guarded by requireAdmin routes downstream
    return next();
  }
  return publicStaticHandler(req, res, next);
});

const openai = process.env.OPENAI_API_KEY ? getOpenAIClient() : null;

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const STRATEGIES_PATH = path.join(DATA_DIR, "strategies.json");
const CHATS_PATH = path.join(DATA_DIR, "chats.json");
const PLANNER_PATH = path.join(DATA_DIR, "planner.json");
const USERS_PATH = path.join(DATA_DIR, "users.json");
const AUTH_STORE_PATH = path.join(DATA_DIR, "auth-store.json");
const LEGAL_REPORTS_PATH = path.join(DATA_DIR, "legal_reports.json");
const AI_LEARNING_PATH = path.join(DATA_DIR, "ai-learning-v1.json");
const TELEMETRY_PATH = path.join(DATA_DIR, "telemetry.json");
const strategyRepository = new FileStrategyRepository(STRATEGIES_PATH, redis);
const chatRepository = new FileChatRepository(CHATS_PATH, redis);
const durableStore = new DurableStore(path.join(DATA_DIR, 'security-v4'));
const artifactRepository = new ArtifactRepository(path.join(DATA_DIR, "artifacts"), redis);
chatRepository.artifactRepository = artifactRepository;
const cleanupQueue = new CleanupQueue(durableStore, artifactRepository, geminiFileCache);
chatRepository.cleanupQueue = cleanupQueue;
const pluginRegistry = createPluginRegistry();
const plannerRepository = new FilePlannerRepository(PLANNER_PATH, redis);
const guestRetention = new GuestRetention([
  { repo: strategyRepository, prefix: 'strategies-v1', directory: path.join(DATA_DIR, 'strategies') },
  { repo: chatRepository, prefix: 'chats-v1', directory: path.join(DATA_DIR, 'chats'), chats: true },
  { repo: plannerRepository, prefix: 'planner-v1', directory: path.join(DATA_DIR, 'planner') },
]);
const userRepository = new FileUserRepository(USERS_PATH, redis);
const authStore = redis?.isReady ? new RedisAuthStore(redis) : new FileAuthStore(AUTH_STORE_PATH);
const aiLearningRepository = new FileAiLearningRepository(AI_LEARNING_PATH, redis);
const privacyPolicy = new PrivacyPolicy(userRepository);
const learningLoop = new LearningLoopService(aiLearningRepository, undefined, privacyPolicy);
const telemetryRepository = new FileTelemetryRepository(TELEMETRY_PATH, redis);
const telemetryService = new TelemetryService(telemetryRepository, privacyPolicy);
const upRepository = new FileUpRepository(path.join(DATA_DIR, "up-v1"));
const upService = new UpService(upRepository, { telemetry: telemetryService });
const emailService = new PasswordResetEmailService({ dataDir: DATA_DIR });
const adminUsernames = new Set([
  ...String(process.env.ADMIN_USER_IDS || '').split(','),
  ...String(process.env.ADMIN_USERNAMES || '').split(',')
].map(value => value.trim()).filter(Boolean));

async function refreshAdminIdentities() {
  const candidateNames = new Set(
    String(process.env.ADMIN_USERNAMES || '')
      .split(',')
      .map(v => v.trim().toLowerCase().replace(/^@+/, ''))
      .filter(Boolean)
  );
  if (candidateNames.size === 0) return;
  try {
    const { users } = await userRepository.readStore();
    for (const u of users || []) {
      const uName = (u.username || '').toLowerCase().replace(/^@+/, '');
      const uEmail = (u.email || '').toLowerCase();
      if (candidateNames.has(uName) || candidateNames.has(uEmail)) {
        if (u.emailVerifiedAt && u.status === 'active' && !u.scheduledDeletionAt) {
          adminUsernames.add(u.id);
        }
      }
    }
  } catch {}
}
refreshAdminIdentities().catch(() => {});

async function syncAllStores() {
  if (isR2Configured()) {
    console.log("☁️ Cloudflare R2 storage active. Starting initial sync...");
  }
  const syncResults = await Promise.allSettled([
    typeof userRepository.syncFromR2 === "function" ? userRepository.syncFromR2() : userRepository.readStore(),
    typeof authStore.syncFromR2 === "function" ? authStore.syncFromR2() : (authStore.read ? authStore.read() : Promise.resolve()),
    strategyRepository.readAll(),
    chatRepository.readAll(),
    plannerRepository.readAll(),
    typeof aiLearningRepository?.readStore === "function" ? aiLearningRepository.readStore() : Promise.resolve(),
    typeof telemetryRepository?.readStore === "function" ? telemetryRepository.readStore() : Promise.resolve(),
  ]);

  const failed = syncResults.filter((r) => r.status === "rejected");
  if (failed.length > 0) {
    if (isProduction) throw new Error("Required storage initialization failed");
    console.warn("Storage initialization failed", { count: failed.length });
  } else {
    console.log("✅ All persistent stores synchronized from storage.");
  }

  await refreshAdminIdentities();
  userRepository.purgeExpiredAccounts({ strategyRepository, chatRepository, plannerRepository, upRepository, aiLearningRepository, telemetryRepository, authStore }).catch(() => {});
  guestRetention.prune().catch(() => {});
}

// Periodic background check for expired account deletion (every 1 hour)
setInterval(() => {
  userRepository.purgeExpiredAccounts({ strategyRepository, chatRepository, plannerRepository, upRepository, aiLearningRepository, telemetryRepository, authStore }).catch(() => {});
  guestRetention.prune().catch(() => {});
}, 60 * 60 * 1000).unref();

const requireAdmin = createRequireAdmin(adminUsernames);
const allowParallelAskChats = true;
const aiPolicy = new AiPolicy({ redis, allowParallelAskChats });
configureProviderPolicy(aiPolicy);


app.use(guestSession);
app.use(createIdentityMiddleware({ authStore, userRepository }));
app.use(privacyPolicy.middleware());
app.use('/api/auth', express.json({ limit: '64kb' }));
const askGuestJsonParser = express.json({ limit: '512kb' });
const askAuthJsonParser = express.json({ limit: '25mb' });
app.use('/api/ask', (req, res, next) => (req.user ? askAuthJsonParser(req, res, next) : askGuestJsonParser(req, res, next)));
app.use(express.json({ limit: '256kb' }));
app.use(express.urlencoded({ limit: '64kb', extended: false }));
const MAX_JSON_ARRAY_LENGTH = 250;
const MAX_JSON_OBJECT_KEYS = 250;
const MAX_JSON_DEPTH = 14;
function hasOversizedJsonCollection(value, depth = 0) {
  if (!value || typeof value !== 'object') return false;
  if (depth > MAX_JSON_DEPTH) return true;
  if (Array.isArray(value)) {
    if (value.length > MAX_JSON_ARRAY_LENGTH) return true;
    for (let i = 0; i < value.length; i += 1) {
      if (hasOversizedJsonCollection(value[i], depth + 1)) return true;
    }
    return false;
  }
  const keys = Object.keys(value);
  if (keys.length > MAX_JSON_OBJECT_KEYS) return true;
  for (let i = 0; i < keys.length; i += 1) {
    if (hasOversizedJsonCollection(value[keys[i]], depth + 1)) return true;
  }
  return false;
}
app.use((req, res, next) => {
  if (req.body && typeof req.body === 'object' && hasOversizedJsonCollection(req.body)) {
    return res.status(400).json({ error: 'Sorğu parametrləri həddi aşır.', code: 'VALIDATION_ERROR' });
  }
  next();
});
app.use(aiPolicy.middleware());
app.get('/api/security/config', (req, res) => {
  const guestLimit = guestDailyLimit();
  const guestBuildLimit = guestBuildDailyLimit();
  res.set('Cache-Control', 'no-store');
  res.json({ guest: !req.user, turnstileSiteKey: process.env.TURNSTILE_SITE_KEY || null, guestAiDailyLimit: guestLimit, guestBuildDailyLimit: guestBuildLimit, guestRetentionDays: 7 });
});
app.get('/api/auth/guest-status', aiPolicy.guestQuotaHandler());
app.use("/api/auth", createAuthRouter({
  userRepository,
  authStore,
  emailService,
  strategyRepository,
  chatRepository,
  plannerRepository,
  aiLearningRepository,
  upRepository,
  appUrl: APP_URL,
  telemetryService,
}));

app.use("/api/auth/admin-mfa", createAdminMfaRouter({
  users: userRepository,
  store: authStore,
  adminIds: adminUsernames,
  audit: async (actorId, action, details) => {
    try {
      console.log(`[Admin MFA Audit] actor=${actorId} action=${action} time=${new Date().toISOString()}`);
    } catch {}
  },
}));
app.use("/api/strategy", createStrategyRouter(strategyRepository, learningLoop, {
  telemetryService, redis,
  hasActiveJobForOwner: ownerId => researchService.hasActiveJobForOwner(ownerId),
}));
app.use("/api/up", createUpRouter(upService));
app.use("/api/planner", createPlannerRouter(plannerRepository, { strategyRepository, telemetryService }));
app.use("/api/learning/signals", createAiLearningSignalRouter(learningLoop));
app.use("/api/telemetry", createTelemetryClientRouter(telemetryService));
app.use("/admin/api/telemetry", requireAuth, requireAdmin, createTelemetryAdminRouter(telemetryService));
app.use("/admin/api/ai-learning", requireAuth, requireAdmin, createAiLearningAdminRouter(learningLoop));
app.get("/admin/api/storage-status", requireAuth, requireAdmin, async (req, res) => {
  const r2Test = await testR2Connection();
  const userStore = await userRepository.readStore();
  const authData = typeof authStore.read === "function" ? await authStore.read() : null;
  return res.json({
    r2: r2Test,
    redis: {
      configured: Boolean(process.env.REDIS_URL),
      isReady: Boolean(redis?.isReady),
    },
    counts: {
      users: userStore?.users?.length || 0,
      activeSessions: Object.keys(authData?.sessions || {}).length,
    },
    timestamp: new Date().toISOString(),
  });
});

const legalReportRateMap = new Map();
async function isLegalReportRateLimited(key) {
  if (redis?.isReady) {
    try {
      const redisKey = `helmer:rate:legal-report:${key}`;
      const count = await redis.incr(redisKey);
      if (count === 1) {
        await redis.expire(redisKey, 600);
      }
      return count > 5;
    } catch {
      // Fallback to in-memory rate limiting on Redis error
    }
  }
  const now = Date.now();
  const windowMs = 10 * 60 * 1000;
  const maxAttempts = 5;
  const record = legalReportRateMap.get(key) || { count: 0, resetAt: now + windowMs };
  if (now > record.resetAt) {
    record.count = 0;
    record.resetAt = now + windowMs;
  }
  record.count += 1;
  legalReportRateMap.set(key, record);
  return record.count > maxAttempts;
}

// Periodic cleanup for legalReportRateMap to prevent memory leaks
setInterval(() => {
  const now = Date.now();
  for (const [key, record] of legalReportRateMap.entries()) {
    if (now > record.resetAt) {
      legalReportRateMap.delete(key);
    }
  }
}, 5 * 60 * 1000).unref();

async function mutateLegalReports(operation) {
  return durableStore.mutate('legal-reports', async current => {
    let reports = current;
    if (!reports) {
      if (isR2Configured()) reports = (await readTenantObject('legal_reports.json')).record || [];
      else {
        try { reports = JSON.parse(await fs.promises.readFile(LEGAL_REPORTS_PATH, 'utf8')); }
        catch (error) { if (error.code !== 'ENOENT') throw error; reports = []; }
      }
    }
    if (!Array.isArray(reports)) throw new Error('Invalid legal report store');
    const result = await operation(reports);
    return { value: reports, result };
  });
}
async function loadLegalReportsFromStore() { return mutateLegalReports(reports => reports); }

const LegalReportSchema = z.object({ issueType: z.string().trim().min(1).max(150), description: z.string().trim().min(5).max(5000), userEmail: z.union([z.string().email().max(254), z.literal('')]).optional(), messageContent: z.string().max(15000).optional(), model: z.string().max(100).optional() }).strict();
app.post("/api/legal-report", async (req, res) => {
  try {
    const ip = req.ip || req.socket?.remoteAddress || "127.0.0.1";
    const rateKey = `legal-report:${ip}`;
    if (await isLegalReportRateLimited(rateKey)) {
      return res.status(429).json({
        error: "Çox sayda bildiriş göndərildi. Zəhmət olmasa bir az sonra yenidən cəhd edin.",
        code: "RATE_LIMITED",
      });
    }

    const parsed = LegalReportSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ code: 'VALIDATION_ERROR' });
    const { issueType, description, userEmail, messageContent, model } = parsed.data;

    if (!issueType || typeof issueType !== "string" || !issueType.trim()) {
      return res.status(400).json({ error: "Zəhmət olmasa problem növünü seçin.", code: "INVALID_ISSUE_TYPE" });
    }

    if (!description || typeof description !== "string" || description.trim().length < 5) {
      return res.status(400).json({
        error: "Zəhmət olmasa problem haqqında ən azı 5 simvoldan ibarət ətraflı məlumat daxil edin.",
        code: "INVALID_DESCRIPTION",
      });
    }

    if (description.trim().length > 5000) {
      return res.status(400).json({
        error: "Təsvir mətni 5000 simvoldan çox ola bilməz.",
        code: "DESCRIPTION_TOO_LONG",
      });
    }

    let cleanEmail = "";
    if (userEmail && typeof userEmail === "string" && userEmail.trim()) {
      cleanEmail = userEmail.trim();
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(cleanEmail) || cleanEmail.length > 254) {
        return res.status(400).json({
          error: "Düzgün bir e-poçt ünvanı daxil edin və ya boş buraxın.",
          code: "INVALID_EMAIL",
        });
      }
    } else if (req.user?.email) {
      cleanEmail = req.user.email;
    }

    const cleanIssueType = String(issueType).trim().slice(0, 150);
    const cleanDescription = String(description).trim().slice(0, 5000);
    const cleanMessageContent = messageContent ? String(messageContent).trim().slice(0, 15000) : "";
    const cleanModel = model ? String(model).trim().slice(0, 100) : "";
    const userName = req.user?.fullName || req.user?.username || (cleanEmail ? cleanEmail.split("@")[0] : "Anonim istifadəçi");
    const userId = req.user?.id || req.ownerId || "Qonaq";
    const userAgent = req.get("user-agent") || "";
    const timestamp = new Date().toISOString();

    // 1. Send email (will be delivered to elemanajes@gmail.com on server side if SMTP configured)
    try {
      await emailService.sendLegalReportEmail({
        issueType: cleanIssueType,
        description: cleanDescription,
        userEmail: cleanEmail,
        userName,
        userId,
        model: cleanModel,
        messageContent: cleanMessageContent,
        timestamp,
        userAgent,
        ip,
      });
    } catch (emailErr) {
      console.warn("⚠️ Legal report email dispatch warning:", emailErr.message);
    }

    // 2. Persist audit record in local data store & Cloudflare R2
    try {
      await mutateLegalReports(reports => reports.unshift({
        id: `rep_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        issueType: cleanIssueType,
        description: cleanDescription,
        userEmail: cleanEmail,
        userName,
        userId,
        model: cleanModel,
        messageContent: cleanMessageContent,
        createdAt: timestamp,
        ip,
        userAgent,
        status: "received", // "received" | "in_review" | "resolved"
      }));
    } catch (saveErr) {
      throw saveErr;
    }

    return res.json({
      success: true,
      message: "Hüquqi probleminizlə bağlı müraciət qəbul edildi. Təşəkkür edirik!",
    });
  } catch (error) {
    console.error("❌ Legal report error:", error);
    return res.status(500).json({
      error: "Müraciət göndərilərkən xəta baş verdi. Zəhmət olmasa bir az sonra yenidən cəhd edin.",
      code: "REPORT_FAILED",
    });
  }
});


app.get("/api/usage/stats", async (req, res, next) => {
  try {
    const result = await authStore.hitRateLimit(`usage:${aiPolicy.ipKey(req)}`, 60, 600);
    if (!result.allowed) return res.status(429).json({ code: "RATE_LIMITED" });
    res.set("Cache-Control", "no-store");
    next();
  } catch (error) { next(error); }
}, async (req, res) => {
  try {
    const [strategies, chats, tasks] = await Promise.all([
      strategyRepository.readAll(req.ownerId).catch(() => []),
      chatRepository.readAll(req.ownerId).catch(() => []),
      plannerRepository.list(req.ownerId).catch(() => []),
    ]);

    const tzOffsetMinutes = Number.isFinite(parseInt(req.query.tzOffset, 10)) ? parseInt(req.query.tzOffset, 10) : 0;
    const now = Date.now();
    const DAY_MS = 24 * 60 * 60 * 1000;

    // Calculate local midnight in user's timezone:
    const localNow = new Date(now - tzOffsetMinutes * 60 * 1000);
    const localYear = localNow.getUTCFullYear();
    const localMonth = localNow.getUTCMonth();
    const localDate = localNow.getUTCDate();
    const todayStartUtc = Date.UTC(localYear, localMonth, localDate) + tzOffsetMinutes * 60 * 1000;

    const periods = {
      today: { start: todayStartUtc },
      "7d": { start: todayStartUtc - 6 * DAY_MS },
      "14d": { start: todayStartUtc - 13 * DAY_MS },
      "30d": { start: todayStartUtc - 29 * DAY_MS },
    };

    const buildEvents = [];
    for (const strat of (strategies || [])) {
      const stratCreated = new Date(strat.createdAt || strat.updatedAt || Date.now()).getTime();
      buildEvents.push({ type: "strategy_create", timestamp: stratCreated });

      if (Array.isArray(strat.versions)) {
        for (let i = 1; i < strat.versions.length; i++) {
          const v = strat.versions[i];
          const vCreated = new Date(v.createdAt || strat.updatedAt || Date.now()).getTime();
          buildEvents.push({ type: "strategy_refine", timestamp: vCreated });
        }
      }
    }

    const askEvents = [];
    for (const chat of (chats || [])) {
      if (Array.isArray(chat.messages)) {
        for (const msg of chat.messages) {
          const msgTime = new Date(msg.createdAt || chat.createdAt || Date.now()).getTime();
          if (msg.role === "user") {
            askEvents.push({ type: "ask_question", timestamp: msgTime });
          } else if (msg.role === "assistant") {
            askEvents.push({ type: "ask_response", timestamp: msgTime });
          }
        }
      }
    }

    const statsByPeriod = {};
    for (const [key, { start }] of Object.entries(periods)) {
      const pBuildEvents = buildEvents.filter((e) => e.timestamp >= start);
      const pAskEvents = askEvents.filter((e) => e.timestamp >= start);

      const strategiesCreated = pBuildEvents.filter((e) => e.type === "strategy_create").length;
      const strategyRefinements = pBuildEvents.filter((e) => e.type === "strategy_refine").length;
      const totalBuild = strategiesCreated + strategyRefinements;

      const askQuestions = pAskEvents.filter((e) => e.type === "ask_question").length;
      const askResponses = pAskEvents.filter((e) => e.type === "ask_response").length;
      const totalAsk = askQuestions + askResponses;

      statsByPeriod[key] = {
        totalOps: totalBuild + totalAsk,
        build: {
          total: totalBuild,
          strategiesCreated,
          refinements: strategyRefinements,
        },
        ask: {
          total: totalAsk,
          questions: askQuestions,
          responses: askResponses,
          activeChats: (chats || []).filter((c) => new Date(c.updatedAt || c.createdAt || 0).getTime() >= start).length,
        },
        activeProjects: (strategies || []).length,
        plannerTasksCount: (tasks || []).length,
      };
    }

    const dailyBreakdown = [];
    for (let i = 29; i >= 0; i--) {
      const dayStart = todayStartUtc - i * DAY_MS;
      const dayEnd = dayStart + DAY_MS;
      const dayDate = new Date(dayStart - tzOffsetMinutes * 60 * 1000);

      const dayBuild = buildEvents.filter((e) => e.timestamp >= dayStart && e.timestamp < dayEnd).length;
      const dayAsk = askEvents.filter((e) => e.timestamp >= dayStart && e.timestamp < dayEnd).length;

      const dateStr = dayDate.toLocaleDateString("az-AZ", { month: "short", day: "numeric", timeZone: "UTC" });
      const isoDate = dayDate.toISOString().slice(0, 10);

      dailyBreakdown.push({
        date: isoDate,
        label: i === 0 ? "Bugün" : dateStr,
        build: dayBuild,
        ask: dayAsk,
        total: dayBuild + dayAsk,
      });
    }

    return res.json({
      plan: {
        isUnlimited: true,
        planTitle: "Limitsiz İstifadə Planı",
        statusText: "Bütün AI Modelləri Aktivdir",
        badge: "Limitsiz Plan",
        accessLevel: "Məhdudiyyətsiz Tam Giriş",
        models: [
          {
            name: "Strateji Zəka Mühərriki",
            mode: "Build",
            status: "Limitsiz",
            description: "Dərin bazar, brendinq və satış strategiyalarının tam avtomatlaşdırılmış generasiyası.",
          },
          {
            name: "İnteraktiv AI Məsləhətçi",
            mode: "Ask",
            status: "Limitsiz",
            description: "Marketinq, böyümə və biznes suallarına real vaxt rejimində ekspert cavabları.",
          },
          {
            name: "Analitik Planlaşdırıcı & Eksport",
            mode: "Workspace",
            status: "Limitsiz",
            description: "PDF və elektron cədvəl eksportları, tapşırıq planlaması və limitsiz layihə yaddaşı.",
          },
        ],
      },
      statsByPeriod,
      dailyBreakdown,
      totals: {
        allTimeStrategies: (strategies || []).length,
        allTimeChats: (chats || []).length,
        allTimeTasks: (tasks || []).length,
      },
    });
  } catch (error) {
    console.error("Usage stats error:", error);
    return res.status(500).json({ error: "İstifadə statistikasını əldə etmək mümkün olmadı." });
  }
});

app.get("/api/ask/chats", async (req, res) => {
  try {
    const chats = await chatRepository.list(req.ownerId);
    return res.json({ chats });
  } catch (error) {
    console.error("Ask chats list error:", { code: publicAskErrorCode(error) });
    return res.status(500).json({ error: "Söhbətləri yükləmək mümkün olmadı." });
  }
});

app.get("/api/ask/chats/:id", async (req, res) => {
  try {
    const { id } = req.params;
    if (!/^[0-9a-f-]{36}$/i.test(id)) {
      return res.status(400).json({ error: "Söhbət ID-si düzgün deyil.", code: "VALIDATION_ERROR" });
    }
    const chat = await chatRepository.getById(id, req.ownerId);
    if (!chat) return res.status(404).json({ error: "Söhbət tapılmadı." });
    return res.json({ chat });
  } catch (error) {
    console.error("Ask chat get error:", { code: publicAskErrorCode(error) });
    return res.status(500).json({ error: "Söhbəti yükləmək mümkün olmadı." });
  }
});

app.delete("/api/ask/chats/:id", async (req, res) => {
  try {
    const { id } = req.params;
    if (!/^[0-9a-f-]{36}$/i.test(id)) {
      return res.status(400).json({ error: "Söhbət ID-si düzgün deyil.", code: "VALIDATION_ERROR" });
    }
    const ok = await chatRepository.delete(id, req.ownerId);
    return res.json({ ok, cleanupPending: ok && await cleanupQueue.pending(req.ownerId, id) });
  } catch (error) {
    console.error("Ask chat delete error:", { code: publicAskErrorCode(error) });
    return res.status(500).json({ error: "Söhbəti silmək mümkün olmadı." });
  }
});

function getClientIp(req) {
  return req.ip || req.socket?.remoteAddress || "127.0.0.1";
}

const askRequestWindows = new Map();

// Periodic cleanup for askRequestWindows to prevent memory leaks
setInterval(() => {
  const now = Date.now();
  for (const [key, history] of askRequestWindows.entries()) {
    const valid = (history || []).filter((timestamp) => now - timestamp < 10 * 60 * 1000);
    if (valid.length === 0) {
      askRequestWindows.delete(key);
    } else {
      askRequestWindows.set(key, valid);
    }
  }
}, 5 * 60 * 1000).unref();

function askRateLimit(limit = 60, windowMs = 10 * 60 * 1000, scope = "ask") {
  return (req, res, next) => {
    const now = Date.now();
    const clientIp = getClientIp(req);
    const identifier = req.user?.id ? `user:${req.user.id}` : `ip:${clientIp}`;
    const key = `${scope}:${identifier}`;
    const history = (askRequestWindows.get(key) || []).filter((timestamp) => now - timestamp < windowMs);
    if (history.length >= limit) {
      res.setHeader("Retry-After", String(Math.max(1, Math.ceil((history[0] + windowMs - now) / 1000))));
      return res.status(429).json({
        code: "RATE_LIMITED",
        error: "Hazırda çox sayda Ask sorğusu göndərilib. Zəhmət olmasa bir neçə dəqiqə sonra yenidən cəhd edin.",
      });
    }
    history.push(now);
    askRequestWindows.set(key, history);
    return next();
  };
}

const localForegroundAskRateLimit = askRateLimit(ASK_REQUESTS_PER_MINUTE, 60000, "ask-minute");
const standardAskRateLimit = askRateLimit(60);
function foregroundAskRateLimit(req, res, next) {
  if (allowParallelAskChats && req.user && req.body?.mode !== "research") {
    if (redis?.isReady) return next();
    return localForegroundAskRateLimit(req, res, next);
  }
  return standardAskRateLimit(req, res, next);
}

const generateAsk = createAskService({ sanitizeGroundingMetadata: sanitizeAskGroundingMetadata });

const capabilityWorkflow = new CapabilityWorkflow({
  registry: pluginRegistry, artifacts: artifactRepository,
  research: createWebResearch({
    geminiResearch: async ({ messages, instructions, signal, onChunk }) => {
      const researchInstructions = `${ASK_INSTRUCTIONS}\nResearch the user's request with live Google Search. Cite sources; never fabricate unavailable statistics.`;
      return generateAsk({ messages, instructions: researchInstructions, referenceContext: instructions,
        enableSearch: true, requireGrounding: true, onChunk, signal,
        ownerId: executionContext.getStore()?.ownerId,
      });
    },
  }),
});
const researchService = new ResearchService({
  jobStore: durableStore, redis, userRepository,
  chatRepository,
  strategyRepository,
  plannerRepository,
  learningLoop,
  telemetryService,
  artifactRepository,
});
researchService.resumeOrphanedJobs().catch(() => {});
app.use("/api/ask/research", requireAuth, createResearchRouter({ researchService, chatRepository, rateLimit: askRateLimit(20) }));
app.use("/api/ask", createAskExecutionGuard({ redis, allowGuest: true, allowParallelChats: allowParallelAskChats, hasActiveJobForOwner: ownerId => researchService.hasActiveJobForOwner(ownerId) }), createCapabilityRouter({ allowGuestChat: true, registry: pluginRegistry, workflow: capabilityWorkflow, artifacts: artifactRepository, chats: chatRepository, strategies: strategyRepository, planner: plannerRepository, rateLimit: foregroundAskRateLimit,
  hydrateFile: (file, ownerId) => geminiFileCache.resolveFile(file, ownerId),
  onComplete: ({ req, result }) => telemetryService.trackAskQuery({ ownerId: req.ownerId, sessionId: req.guestOwnerId, model: result.model, latencyMs: Date.parse(result.execution.completedAt) - Date.parse(result.execution.startedAt), usage: result.usage, groundingActive: Boolean(result.groundingMetadata), status: "success", querySnippet: "", onlyNecessaryData: true, modelImprovement: false }).catch(() => {}),
}));
app.use("/api/artifacts", createArtifactRouter({ artifacts: artifactRepository, chats: chatRepository }));

app.post("/api/ask", foregroundAskRateLimit, createAskHandler({
  chatRepository, strategyRepository, plannerRepository, researchService, learningLoop, telemetryService,
  sanitizeGroundingMetadata: sanitizeAskGroundingMetadata,
  generateAsk,
}));

// 🧠 ADMIN PANEL – YALNIZ SƏNİN ÜÇÜN
//

// ⚖️ Hüquqi Müraciətlər (Legal Reports)
app.get("/admin/api/legal-reports", requireAuth, requireAdmin, async (req, res) => {
  try {
    const reports = await loadLegalReportsFromStore();
    const total = reports.length;
    const pending = reports.filter((r) => !r.status || r.status === "received").length;
    const inReview = reports.filter((r) => r.status === "in_review").length;
    const resolved = reports.filter((r) => r.status === "resolved").length;
    res.json({
      reports,
      stats: { total, pending, inReview, resolved },
    });
  } catch (err) {
    console.error("Admin legal-reports xətası:", err.message);
    res.status(500).json({ error: "Hüquqi müraciətlər alınmadı" });
  }
});

// Update legal report status
app.post("/admin/api/legal-reports/status", requireAuth, requireAdmin, async (req, res) => {
  try {
    const parsed = z.object({ id: z.string().regex(/^rep_[a-zA-Z0-9_-]+$/).max(100), status: z.enum(['received','in_review','resolved']) }).strict().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ code: 'VALIDATION_ERROR' });
    const { id, status } = parsed.data;
    if (!id || !status) {
      return res.status(400).json({ error: "id və status tələb olunur" });
    }
    const validStatuses = ["received", "in_review", "resolved"];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: "Yanlış status növü" });
    }
    const target = await mutateLegalReports(reports => {
      const target = reports.find(r => r.id === id);
      if (target) { target.status = status; target.updatedAt = new Date().toISOString(); }
      return target;
    });
    if (!target) return res.status(404).json({ code: 'NOT_FOUND' });
    res.json({ success: true, report: target });
  } catch (err) {
    console.error("Admin legal report status xətası:", err.message);
    res.status(500).json({ error: "Status yenilənmədi" });
  }
});

// Delete legal report
app.post("/admin/api/legal-reports/delete", requireAuth, requireAdmin, async (req, res) => {
  try {
    const parsed = z.object({ id: z.string().regex(/^rep_[a-zA-Z0-9_-]+$/).max(100) }).strict().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ code: 'VALIDATION_ERROR' });
    const { id } = parsed.data;
    if (!id) {
      return res.status(400).json({ error: "id tələb olunur" });
    }
    const removed = await mutateLegalReports(reports => {
      const index = reports.findIndex(r => r.id === id);
      if (index < 0) return false;
      reports.splice(index, 1); return true;
    });
    if (!removed) return res.status(404).json({ code: 'NOT_FOUND' });
    res.json({ success: true });
  } catch (err) {
    console.error("Admin delete legal report xətası:", err.message);
    res.status(500).json({ error: "Müraciət silinmədi" });
  }
});

// Admin UI & Protected Assets
app.get("/admin-mfa", requireAuth, (req, res) => { res.set("Cache-Control", "no-store"); res.sendFile(path.join(__dirname, "public", "admin-mfa.html")); });
app.get("/admin.js", requireAdmin, (req, res) => { res.set("Cache-Control", "private, no-store"); res.sendFile(path.join(__dirname, "public", "admin.js")); });
app.get("/admin.css", requireAdmin, (req, res) => { res.set("Cache-Control", "private, no-store"); res.sendFile(path.join(__dirname, "public", "admin.css")); });
app.get("/index_admin.html", requireAdmin, (req, res) => res.redirect(301, "/admin"));
app.get(["/admin", "/admin/"], requireAdmin, (req, res) => {
  return res.sendFile(path.join(__dirname, "public", "index_admin.html"));
});

app.use(authErrorHandler);
app.use(strategyErrorHandler);
app.use("/api", (req, res) => res.status(404).json({ error: "API yolu tapılmadı.", code: "NOT_FOUND" }));
// Last-resort handler: never fall through to Express' default handler, which
// renders stack traces as HTML outside production.
app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  const status = httpStatusOf(error);
  if (status >= 500) console.error("Unhandled request error", { method: req.method, path: req.path, name: error?.name, code: error?.code });
  const isSyntaxErr = error instanceof SyntaxError || error?.type === "entity.parse.failed" || error?.name === "SyntaxError";
  return res.status(status).json({
    error: publicErrorMessage(error, "Sorğunu tamamlamaq mümkün olmadı."),
    code: isSyntaxErr ? "INVALID_JSON" : (error?.code && typeof error.code === "string" ? error.code : "INTERNAL_ERROR"),
  });
});

// 📜 Standalone Legal & Google Compliance Pages
app.get(["/privacy", "/privacy-policy"], (req, res) => {
  res.setHeader("Cache-Control", "public, max-age=3600");
  return res.sendFile(path.join(__dirname, "public", "privacy.html"));
});

app.get(["/terms", "/terms-of-service"], (req, res) => {
  res.setHeader("Cache-Control", "public, max-age=3600");
  return res.sendFile(path.join(__dirname, "public", "terms.html"));
});

// 🌐 Frontend üçün fallback
app.get("*", (req, res) => {
  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

const PORT = APP_PORT;

async function startServer() {
  try {
    await syncAllStores();
  } catch (err) {
    if (isProduction) throw err;
    console.error("Initial storage initialization failed", { code: err.code });
  }

  const server = app.listen(PORT, "0.0.0.0", () =>
    console.log(`✅ Helmer is live on port ${PORT}`)
  );

  // 🔁 Render üçün keep-alive
  const keepAlive = setInterval(() => {
    fetch(process.env.APP_URL || "https://helmeros.com").catch(() =>
      console.log("⚠️ Keep-alive ping alınmadı")
    );
  }, 10 * 60 * 1000);
  keepAlive.unref();

  let shuttingDown = false;
  const shutdown = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`🛑 ${signal} received, draining connections...`);
    clearInterval(keepAlive);
    const researchShutdown = researchService.shutdown().catch(error => console.error('Research shutdown failed', { code: error.code }));
    server.close(async () => {
      await researchShutdown;
      if (redis?.isOpen) await redis.quit().catch(() => {});
      process.exit(0);
    });
    // Long-lived SSE streams would otherwise hold the process open forever.
    setTimeout(() => process.exit(0), 10_000).unref();
    server.closeIdleConnections?.();
  };
  process.once("SIGTERM", () => shutdown("SIGTERM"));
  process.once("SIGINT", () => shutdown("SIGINT"));
}

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled promise rejection:", reason?.name || "Error", reason?.code || "", "Unhandled operation failure");
});

startServer();
