import { OAuth2Client } from "google-auth-library";
import express from "express";
import { z } from "zod";
import { createHash, randomBytes, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import {
  EmptyBodySchema,
  AccountUpdateSchema,
  AddMemoryItemSchema,
  ChangePasswordSchema,
  EmailVerificationConfirmSchema,
  EmailVerificationRequestSchema,
  ForgotPasswordSchema,
  GoogleAuthSchema,
  GoogleOAuthAuthorizeSchema,
  GoogleOAuthCallbackSchema,
  ImportMemoryPayloadSchema,
  LoginSchema,
  OnboardingSchema,
  ResetPasswordSchema,
  SignupSchema,
  UserSettingsSchema,
  UsernameSchema,
  normalizeEmail,
  parseBody,
} from "../auth/validation.js";
import { hashOpaqueToken, hashPassword, verifyPassword } from "../auth/password.js";
import {
  SESSION_TTL_SECONDS,
  clearGuestCookie,
  clearSessionCookie,
  createSessionToken,
  parseCookies,
  setSessionCookie,
} from "./auth-middleware.js";

const RESET_TTL_SECONDS = 20 * 60;
const EMAIL_VERIFICATION_TTL_SECONDS = 10 * 60;
const EMAIL_VERIFICATION_RESEND_COOLDOWN_SECONDS = 60;
const OAUTH_STATE_TTL_SECONDS = 5 * 60;
export const OAUTH_STATE_COOKIE = "helmer_oauth_state";
const DUMMY_PASSWORD_HASH = "$argon2id$v=19$m=19456,p=1,t=2$vcP17Lqj+FV8BaSbIBHvAg$SvwldQJW4f14U7Cv2tgeeuVIFT0LfFBIUNxAGWfNPLU";
const AUTH_LOOP_PATHS = new Set(["/login", "/signin", "/signup", "/register", "/forgot-password", "/reset-password", "/verify-email"]);

export function generateCodeVerifier() {
  return randomBytes(32).toString("base64url");
}

export function computeCodeChallenge(codeVerifier) {
  return createHash("sha256").update(String(codeVerifier)).digest("base64url");
}

export function verifyPkceChallenge(codeVerifier, expectedChallenge) {
  if (typeof codeVerifier !== "string" || typeof expectedChallenge !== "string") return false;
  if (codeVerifier.length < 43 || codeVerifier.length > 128) return false;
  if (!/^[A-Za-z0-9._~-]+$/.test(codeVerifier)) return false;
  const computed = Buffer.from(computeCodeChallenge(codeVerifier), "utf8");
  const expected = Buffer.from(expectedChallenge, "utf8");
  if (computed.length !== expected.length) return false;
  return timingSafeEqual(computed, expected);
}

export function sanitizeReturnTo(value) {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) {
    return "/workspace";
  }
  try {
    const parsed = new URL(value, "http://localhost");
    if (parsed.origin !== "http://localhost" || AUTH_LOOP_PATHS.has(parsed.pathname) || parsed.pathname.startsWith("/api/")) {
      return "/workspace";
    }
    return parsed.pathname === "/" ? "/workspace" : `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return "/workspace";
  }
}

function isSecureRequest(req) {
  const forwarded = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim();
  return process.env.NODE_ENV === "production" || req.secure || forwarded === "https";
}

function setOAuthStateCookie(req, res, token) {
  res.append("Set-Cookie", `${OAUTH_STATE_COOKIE}=${encodeURIComponent(token)}; Path=/api/auth/google; HttpOnly; SameSite=Lax; Max-Age=${OAUTH_STATE_TTL_SECONDS}${isSecureRequest(req) ? "; Secure" : ""}`);
}

function clearOAuthStateCookie(req, res) {
  res.append("Set-Cookie", `${OAUTH_STATE_COOKIE}=; Path=/api/auth/google; HttpOnly; SameSite=Lax; Max-Age=0${isSecureRequest(req) ? "; Secure" : ""}`);
}
function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

export function publicUser(user) {
  const settings = user?.settings && typeof user.settings === "object" ? user.settings : {};
  return {
    id: user.id,
    fullName: user.fullName,
    username: user.username,
    email: user.email,
    pendingEmail: user.pendingEmailExpiresAt > Date.now() ? user.pendingEmail || null : null,
    avatarUrl: user.avatarUrl,
    hasGoogleAuth: Boolean(user.googleSub),
    emailVerified: Boolean(user.emailVerifiedAt),
    onboardingFocus: user.onboardingFocus,
    onboardingRole: user.onboardingRole || null,
    onboardingGoal: user.onboardingGoal || null,
    onboardingCompleted: Boolean(user.onboardingCompletedAt),
    status: user.status === "pending_deletion" ? "pending_deletion" : "active",
    deletionRequestedAt: user.deletionRequestedAt || null,
    scheduledDeletionAt: user.scheduledDeletionAt || null,
    settings: {
      personalIntelligence: settings.personalIntelligence === true,
      modelImprovement: settings.modelImprovement === true,
      brandName: typeof settings.brandName === "string" ? settings.brandName : "",
      industry: typeof settings.industry === "string" ? settings.industry : "",
      targetAudience: typeof settings.targetAudience === "string" ? settings.targetAudience : "",
      primaryMarket: typeof settings.primaryMarket === "string" ? settings.primaryMarket : "",
      tone: typeof settings.tone === "string" ? settings.tone : "professional",
      customInstructions: typeof settings.customInstructions === "string" ? settings.customInstructions : "",
      memories: Array.isArray(settings.memories) ? settings.memories : [],
      autoContext: settings.autoContext !== false,
      strategyPersonalization: settings.strategyPersonalization !== false,
      autoSaveStrategies: settings.autoSaveStrategies !== false,
      defaultMode: settings.defaultMode === "ask" ? "ask" : "build",
      language: settings.language === "en" ? "en" : "az",
    },
    createdAt: user.createdAt,
  };
}

const AUTH_RECOVERY_FLOOR_MS = 250;
const AUTH_RECOVERY_WAIT_CAP_MS = 1000;

function sleepMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Awaits auth email delivery up to waitCapMs while enforcing a constant minimum
 * floorMs so Cloud Run keeps CPU active during normal sends without leaking
 * account existence or stalling on hung upstream lookups.
 */
async function awaitBoundedAuthDelivery(failureMessage, operation, {
  floorMs = AUTH_RECOVERY_FLOOR_MS,
  waitCapMs = AUTH_RECOVERY_WAIT_CAP_MS,
} = {}) {
  const floorPromise = sleepMs(floorMs);
  if (typeof operation !== "function") {
    await floorPromise;
    return;
  }
  const workPromise = Promise.resolve()
    .then(() => operation())
    .catch(() => {
      console.error(failureMessage);
    });
  let capTimer = null;
  const capPromise = new Promise((resolve) => {
    capTimer = setTimeout(resolve, waitCapMs);
  });
  try {
    await Promise.all([
      floorPromise,
      Promise.race([workPromise, capPromise]),
    ]);
  } finally {
    if (capTimer) clearTimeout(capTimer);
  }
}

function rateKey(req, scope, identity = "") {
  const source = `${scope}:${req.ip || req.socket.remoteAddress || "unknown"}:${identity}`;
  return createHash("sha256").update(source).digest("hex");
}

// Keyed on the target account only, so rotating IPs cannot multiply the
// number of guesses against a single login identifier or verification code.
function accountRateKey(scope, identity) {
  return createHash("sha256").update(`${scope}:account:${identity}`).digest("hex");
}

// Mirrors how the schemas normalize identifiers, so whitespace/case/"@"
// variants of the same account cannot each get a fresh rate-limit bucket.
function normalizeIdentifier(value) {
  return String(value || "").trim().toLowerCase().replace(/^@+/, "");
}

function limit(authStore, scope, count, seconds, identity, { perAccount = false } = {}) {
  return asyncRoute(async (req, res, next) => {
    const key = identity?.(req);
    if (perAccount && !key) return next();
    const result = await authStore.hitRateLimit(perAccount ? accountRateKey(scope, key) : rateKey(req, scope, key), count, seconds);
    res.set("X-RateLimit-Remaining", String(result.remaining));
    if (!result.allowed) {
      res.set("Retry-After", String(Math.max(1, Math.ceil((result.resetAt - Date.now()) / 1000))));
      return res.status(429).json({
        error: "Çox sayda cəhd edildi. Bir qədər sonra yenidən yoxla.",
        code: "RATE_LIMITED",
      });
    }
    return next();
  });
}

async function startSession(req, res, authStore, user) {
  if (req.auth?.sessionId) {
    await authStore.deleteSession(req.auth.sessionId).catch(() => {});
  }
  const rawToken = createSessionToken();
  const sessionId = hashOpaqueToken(rawToken);
  await authStore.createSession(sessionId, user.id, SESSION_TTL_SECONDS, { authVersion: user.authVersion || 1 });
  setSessionCookie(req, res, rawToken);
  return sessionId;
}

export function createAuthRouter({ userRepository, authStore, emailService, strategyRepository, chatRepository, plannerRepository, aiLearningRepository, upRepository, appUrl, telemetryService, cleanupQueue = null, researchJobStore = null, googleClient: customGoogleClient = null }) {
  const telemetryRepository = telemetryService?.repository;
  const purgeExpired = () => userRepository.purgeExpiredAccounts({
    strategyRepository,
    chatRepository,
    plannerRepository,
    upRepository,
    aiLearningRepository,
    telemetryRepository,
    authStore,
    cleanupQueue,
    researchJobStore,
  }).catch(() => {});
  // server.js loads dotenv after ESM imports have been evaluated. Resolve this
  // value when the router is created so the configured client ID is available.
  const googleClientId = process.env.GOOGLE_CLIENT_ID;
  const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const googlePkceConfigured = Boolean(googleClientId && (googleClientSecret || customGoogleClient));
  const canonicalAppUrl = String(appUrl || process.env.APP_URL || "http://localhost:8080").replace(/\/$/, "");
  const googleRedirectUri = process.env.GOOGLE_REDIRECT_URI || `${canonicalAppUrl}/api/auth/google/callback`;
  const googleClient = customGoogleClient || new OAuth2Client(googleClientId, googleClientSecret, googleRedirectUri);
  const router = express.Router();

  async function verificationUser(email) {
    const direct = await userRepository.findByEmail(email);
    if (direct) return direct;
    const { users } = await userRepository.readStore();
    return users.find(u => u.pendingEmailExpiresAt > Date.now() && u.pendingEmail === email) || null;
  }
  async function reauthenticate(req, payload) {
    if (payload.currentPassword) return verifyPassword(req.user.passwordHash, payload.currentPassword);
    if (!payload.reauthToken) return false;
    const proof = await authStore.consumeResetToken(hashOpaqueToken(payload.reauthToken));
    return proof?.purpose === 'reauth' && proof.userId === req.user.id && proof.sessionId === req.auth.sessionId && proof.authVersion === (req.user.authVersion || 1);
  }
  router.post('/google/nonce', limit(authStore, 'google-nonce', 20, 300), asyncRoute(async (req, res) => {
    parseBody(EmptyBodySchema, req.body || {});
    const nonce = randomBytes(32).toString('base64url');
    await authStore.createResetToken(hashOpaqueToken(nonce), 'google', 300, {
      purpose: 'google-nonce',
      sessionId: req.auth?.sessionId || req.ownerId,
      guestOwnerId: req.guestOwnerId || req.ownerId || null,
    });
    res.set('Cache-Control', 'no-store');
    res.json({ nonce });
  }));
  const ReauthSchema = z.object({ currentPassword: z.string().min(1).max(128).optional(), credential: z.string().min(1).max(4096).optional(), nonce: z.string().min(32).max(128).optional() }).strict();
  router.post('/reauth', limit(authStore, 'reauth', 8, 300, req => req.user?.id), asyncRoute(async (req, res) => {
    if (!req.auth?.user?.emailVerifiedAt) return res.status(401).json({ code: 'AUTH_REQUIRED' });
    const payload = ReauthSchema.parse(req.body); let accepted = false;
    if (payload.currentPassword) accepted = await verifyPassword(req.user.passwordHash, payload.currentPassword);
    else if (payload.credential && payload.nonce && googleClientId) {
      const record = await authStore.consumeResetToken(hashOpaqueToken(payload.nonce));
      if (record?.purpose === 'google-nonce' && record.sessionId === req.auth.sessionId) {
        try {
          const ticket = await googleClient.verifyIdToken({ idToken: payload.credential, audience: googleClientId });
          const profile = ticket.getPayload();
          const validIssuer = !profile?.iss || profile.iss === 'https://accounts.google.com' || profile.iss === 'accounts.google.com';
          accepted = Boolean(
            profile?.nonce === payload.nonce &&
            profile.email_verified === true &&
            validIssuer &&
            req.user.googleSub &&
            profile.sub === req.user.googleSub
          );
        } catch { accepted = false; }
      }
    }
    if (!accepted) return res.status(403).json({ code: 'INVALID_REAUTH' });
    const reauthToken = randomBytes(32).toString('base64url');
    await authStore.createResetToken(hashOpaqueToken(reauthToken), req.user.id, 300, { purpose: 'reauth', sessionId: req.auth.sessionId, authVersion: req.user.authVersion || 1 });
    res.set('Cache-Control', 'no-store'); res.json({ reauthToken });
  }));
  async function sendEmailVerificationCode(user) {
    const code = String(randomInt(100000, 1000000));
    const address = user.pendingEmailExpiresAt > Date.now() ? user.pendingEmail : user.email;
    const purpose = address === user.email ? "signup" : "email-change";
    const tokenId = hashOpaqueToken(`${user.id}:${address}:${user.authVersion || 1}:${purpose}:${code}`);
    await authStore.createEmailVerificationToken(tokenId, user.id, EMAIL_VERIFICATION_TTL_SECONDS, { email: address, purpose, authVersion: user.authVersion || 1 });
    try {
      await emailService.sendEmailVerificationCode({ email: address, fullName: user.fullName, code });
    } catch (error) {
      await authStore.consumeEmailVerificationToken(tokenId);
      console.error("Email verification delivery failed");
      throw error;
    }
  }

  async function claimGuestData(req, userId) {
    if (req.auth?.user && req.auth.user.id !== userId) return;
    if (req.guestOwnerId && strategyRepository?.claimOwner) await strategyRepository.claimOwner(req.guestOwnerId, userId);
    if (req.guestOwnerId && chatRepository?.claimOwner) await chatRepository.claimOwner(req.guestOwnerId, userId);
    if (req.guestOwnerId && plannerRepository?.claimOwner) await plannerRepository.claimOwner(req.guestOwnerId, userId);
    if (req.guestOwnerId && aiLearningRepository?.claimOwner) await aiLearningRepository.claimOwner(req.guestOwnerId, userId);
  }

  async function startEmailVerificationCooldown(req, email) {
    return authStore.hitRateLimit(
      rateKey(req, "email-verification-resend-cooldown", email),
      1,
      EMAIL_VERIFICATION_RESEND_COOLDOWN_SECONDS,
    );
  }

  router.get("/config", (req, res) => {
    return res.json({
      googleClientId: googleClientId || "",
      googleOAuthEnabled: Boolean(googleClientId),
      googlePkceEnabled: googlePkceConfigured,
      googleCallbackPath: "/api/auth/google/callback",
    });
  });

  router.get("/username-availability", limit(authStore, "username", 120, 60), asyncRoute(async (req, res) => {
    const raw = String(req.query.username || "").trim().replace(/^@+/, "");
    const parsed = UsernameSchema.safeParse(raw);
    if (!parsed.success) return res.json({ available: false, valid: false, error: parsed.error.issues[0]?.message });
    const existing = await userRepository.findByUsername(parsed.data);
    return res.json({ available: !existing, valid: true });
  }));

  async function provisionGoogleUser(req, res, profile) {
    if (!profile?.sub || !profile?.email || profile.email_verified !== true) {
      return {
        status: 401,
        error: "Google hesabı təsdiqlənmədi.",
        code: "INVALID_GOOGLE_ACCOUNT",
      };
    }
    if (profile.iss && profile.iss !== "https://accounts.google.com" && profile.iss !== "accounts.google.com") {
      return {
        status: 401,
        error: "Google token mənbəyi etibarsızdır.",
        code: "INVALID_GOOGLE_ISSUER",
      };
    }
    if (profile.aud && googleClientId) {
      const audMatches = Array.isArray(profile.aud)
        ? profile.aud.includes(googleClientId)
        : profile.aud === googleClientId;
      if (!audMatches) {
        return {
          status: 401,
          error: "Google token auditoriyası etibarsızdır.",
          code: "INVALID_GOOGLE_AUDIENCE",
        };
      }
    }
    if (profile.exp !== undefined && Number(profile.exp) * 1000 <= Date.now() - 30000) {
      return {
        status: 401,
        error: "Google giriş məlumatının vaxtı bitib.",
        code: "INVALID_GOOGLE_TOKEN",
      };
    }

    const email = normalizeEmail(profile.email);
    const googleSub = String(profile.sub).trim();

    // Per Google OIDC best practices, identify existing users primarily by immutable `sub`.
    let user = typeof userRepository.findByGoogleSub === "function"
      ? await userRepository.findByGoogleSub(googleSub)
      : null;

    let restoredFromPendingDeletion = false;
    if (user) {
      if (user.scheduledDeletionAt) {
        const scheduledTime = new Date(user.scheduledDeletionAt).getTime();
        if (!isNaN(scheduledTime) && scheduledTime <= Date.now()) {
          await purgeExpired();
          return {
            status: 401,
            error: "Hesabınız 14 günlük gözləmə müddəti bitdiyinə görə tamamilə silinib.",
            code: "ACCOUNT_EXPIRED_DELETED",
          };
        }
        await userRepository.cancelDeletion(user.id);
        restoredFromPendingDeletion = true;
      }

      const previousGoogleEmail = user.googleEmail ? normalizeEmail(user.googleEmail) : null;
      const currentEmail = normalizeEmail(user.email);
      const hasCustomHelmerEmail = Boolean(
        user.emailCustomisedAt ||
        (previousGoogleEmail && currentEmail !== previousGoogleEmail)
      );

      const updateFields = {
        emailVerifiedAt: user.emailVerifiedAt || new Date().toISOString(),
        avatarUrl: user.avatarUrl || profile.picture || null,
        googleSub,
        googleEmail: email,
        lastLoginAt: new Date().toISOString(),
        status: "active",
        deletionRequestedAt: null,
        scheduledDeletionAt: null,
      };

      // If the user's Google email changed and the user has not set a custom Helmer email,
      // preserve the existing Helmer profile and update the email if it does not conflict.
      if (!hasCustomHelmerEmail && email !== currentEmail) {
        const emailOwner = await verificationUser(email);
        if (!emailOwner || emailOwner.id === user.id) {
          updateFields.email = email;
        }
      }

      user = await userRepository.update(user.id, updateFields, {
        allowSystemFields: true,
        preserveEmailVerification: true,
      });
    } else {
      const emailOwner = await verificationUser(email);
      if (emailOwner) {
        if (emailOwner.googleSub && String(emailOwner.googleSub).trim() !== googleSub) {
          return {
            status: 401,
            error: "Bu e-poçt başqa Google hesabına bağlıdır.",
            code: "GOOGLE_ACCOUNT_MISMATCH",
          };
        }
        // Prohibit unsafe automatic account merging based solely on email similarity.
        // Only link Google `sub` if the caller is already authenticated as that verified account owner.
        const isAuthenticatedOwner = Boolean(
          req.auth?.user?.id === emailOwner.id &&
          req.auth.user.emailVerifiedAt &&
          !emailOwner.googleSub &&
          normalizeEmail(emailOwner.email) === email
        );
        if (!isAuthenticatedOwner) {
          return {
            status: 409,
            error: "Bu e-poçt ünvanı ilə artıq hesab mövcuddur. Təhlükəsizlik üçün əvvəlcə şifrə ilə daxil olun.",
            code: "GOOGLE_ACCOUNT_LINK_REQUIRED",
          };
        }

        if (emailOwner.scheduledDeletionAt) {
          const scheduledTime = new Date(emailOwner.scheduledDeletionAt).getTime();
          if (!isNaN(scheduledTime) && scheduledTime <= Date.now()) {
            await purgeExpired();
            return {
              status: 401,
              error: "Hesabınız 14 günlük gözləmə müddəti bitdiyinə görə tamamilə silinib.",
              code: "ACCOUNT_EXPIRED_DELETED",
            };
          }
          await userRepository.cancelDeletion(emailOwner.id);
          restoredFromPendingDeletion = true;
        }

        user = await userRepository.update(emailOwner.id, {
          emailVerifiedAt: emailOwner.emailVerifiedAt || new Date().toISOString(),
          avatarUrl: emailOwner.avatarUrl || profile.picture || null,
          googleSub,
          googleEmail: email,
          lastLoginAt: new Date().toISOString(),
          status: "active",
          deletionRequestedAt: null,
          scheduledDeletionAt: null,
        }, { allowSystemFields: true });
      } else {
        const baseRaw = email.split("@")[0] || profile.name || "user";
        const username = await userRepository.findUniqueUsername(baseRaw);
        const randomPassword = randomBytes(48).toString("base64url");
        const passwordHash = await hashPassword(randomPassword);

        user = await userRepository.create({
          fullName: String(profile.name || email.split("@")[0]).trim(),
          username,
          email,
          passwordHash,
          emailVerifiedAt: new Date().toISOString(),
          avatarUrl: profile.picture || null,
          googleSub,
          googleEmail: email,
        });
      }
    }

    await startSession(req, res, authStore, user);
    await claimGuestData(req, user.id);

    if (telemetryService) {
      telemetryService.trackAuth({
        ownerId: user.id,
        sessionId: req.guestOwnerId,
        action: "login",
        provider: "google",
        ip: req.ip || req.socket?.remoteAddress,
        status: "success",
      }).catch(() => {});
    }

    return {
      status: 200,
      user: publicUser(user),
      restoredFromPendingDeletion,
    };
  }

  async function handleGoogleAuthorize(req, res) {
    const rawInput = req.method === "POST"
      ? (req.body || {})
      : {
          ...(req.query?.returnTo ? { returnTo: String(req.query.returnTo) } : {}),
          ...(req.query?.codeChallenge ? { codeChallenge: String(req.query.codeChallenge) } : {}),
          ...(req.query?.codeChallengeMethod ? { codeChallengeMethod: String(req.query.codeChallengeMethod) } : {}),
        };
    const payload = parseBody(GoogleOAuthAuthorizeSchema, rawInput);
    const returnTo = sanitizeReturnTo(payload.returnTo);

    if (!googlePkceConfigured) {
      if (req.method === "GET" && req.query?.format !== "json") {
        return res.redirect(302, `/login?error=${encodeURIComponent("GOOGLE_AUTH_NOT_CONFIGURED")}&returnTo=${encodeURIComponent(returnTo)}`);
      }
      return res.status(503).json({
        error: "Google girişi serverdə konfiqurasiya edilməyib.",
        code: "GOOGLE_AUTH_NOT_CONFIGURED",
      });
    }

    const state = randomBytes(32).toString("base64url");
    const nonce = randomBytes(32).toString("base64url");
    const oauthBinding = randomBytes(32).toString("base64url");
    const clientProvidedChallenge = Boolean(payload.codeChallenge);
    const codeVerifier = clientProvidedChallenge ? null : generateCodeVerifier();
    const codeChallenge = clientProvidedChallenge ? payload.codeChallenge : computeCodeChallenge(codeVerifier);

    await authStore.createResetToken(hashOpaqueToken(state), "google-oauth", OAUTH_STATE_TTL_SECONDS, {
      purpose: "google-oauth-pkce",
      codeVerifier,
      codeChallenge,
      codeChallengeMethod: "S256",
      nonce,
      bindingHash: hashOpaqueToken(oauthBinding),
      sessionId: req.auth?.sessionId || req.ownerId || null,
      returnTo,
    });

    setOAuthStateCookie(req, res, oauthBinding);
    res.set("Cache-Control", "no-store");

    const authorizationUrl = googleClient.generateAuthUrl({
      access_type: "online",
      response_type: "code",
      scope: ["openid", "email", "profile"],
      redirect_uri: googleRedirectUri,
      state,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
      nonce,
      prompt: "select_account",
    });

    if (req.method === "POST" || req.query?.format === "json") {
      return res.json({
        authorizationUrl,
        state,
        codeChallenge,
        codeChallengeMethod: "S256",
      });
    }
    return res.redirect(302, authorizationUrl);
  }

  router.get("/google/authorize", limit(authStore, "google-authorize", 20, 300), asyncRoute(handleGoogleAuthorize));
  router.post("/google/authorize", limit(authStore, "google-authorize", 20, 300), asyncRoute(handleGoogleAuthorize));

  async function handleGoogleCallback(req, res) {
    const isBrowserRedirect = req.method === "GET" && req.query?.format !== "json";
    const cookies = parseCookies(req.headers.cookie);
    const rawBindingCookie = cookies[OAUTH_STATE_COOKIE] || "";
    clearOAuthStateCookie(req, res);
    res.set("Cache-Control", "no-store");

    if (req.method === "GET" && req.query?.error) {
      if (isBrowserRedirect) {
        return res.redirect(302, `/login?error=${encodeURIComponent("GOOGLE_OAUTH_CANCELLED")}`);
      }
      return res.status(400).json({
        error: "Google girişi ləğv edildi və ya rədd olundu.",
        code: "GOOGLE_OAUTH_CANCELLED",
      });
    }

    if (!googlePkceConfigured) {
      if (isBrowserRedirect) {
        return res.redirect(302, `/login?error=${encodeURIComponent("GOOGLE_AUTH_NOT_CONFIGURED")}`);
      }
      return res.status(503).json({
        error: "Google girişi serverdə konfiqurasiya edilməyib.",
        code: "GOOGLE_AUTH_NOT_CONFIGURED",
      });
    }

    const rawPayload = req.method === "POST"
      ? (req.body || {})
      : {
          code: typeof req.query?.code === "string" ? req.query.code : "",
          state: typeof req.query?.state === "string" ? req.query.state : "",
          ...(typeof req.query?.codeVerifier === "string" ? { codeVerifier: req.query.codeVerifier } : {}),
        };
    const payload = parseBody(GoogleOAuthCallbackSchema, rawPayload);

    const record = await authStore.consumeResetToken(hashOpaqueToken(payload.state));
    if (!record || record.purpose !== "google-oauth-pkce") {
      if (isBrowserRedirect) {
        return res.redirect(302, `/login?error=${encodeURIComponent("INVALID_GOOGLE_STATE")}`);
      }
      return res.status(401).json({
        error: "Google təhlükəsizlik təsdiqi (state) etibarsızdır və ya vaxtı bitib.",
        code: "INVALID_GOOGLE_STATE",
      });
    }

    let bindingValid = false;
    if (rawBindingCookie && record.bindingHash) {
      const actualHash = Buffer.from(hashOpaqueToken(rawBindingCookie), "utf8");
      const expectedHash = Buffer.from(String(record.bindingHash), "utf8");
      if (actualHash.length === expectedHash.length && timingSafeEqual(actualHash, expectedHash)) {
        bindingValid = true;
      }
    }
    if (!bindingValid && record.sessionId && record.sessionId === (req.auth?.sessionId || req.ownerId)) {
      bindingValid = true;
    }
    if (!bindingValid) {
      if (isBrowserRedirect) {
        return res.redirect(302, `/login?error=${encodeURIComponent("INVALID_GOOGLE_STATE")}`);
      }
      return res.status(401).json({
        error: "Google giriş sessiyası cari brauzerlə uyğun gəlmir.",
        code: "INVALID_GOOGLE_STATE",
      });
    }

    const verifier = payload.codeVerifier || record.codeVerifier;
    if (!verifier || !verifyPkceChallenge(verifier, record.codeChallenge)) {
      if (isBrowserRedirect) {
        return res.redirect(302, `/login?error=${encodeURIComponent("INVALID_GOOGLE_PKCE")}`);
      }
      return res.status(401).json({
        error: "Google PKCE doğrulaması uğursuz oldu.",
        code: "INVALID_GOOGLE_PKCE",
      });
    }

    let idToken;
    try {
      const tokenResponse = await googleClient.getToken({
        code: payload.code,
        codeVerifier: verifier,
        redirect_uri: googleRedirectUri,
      });
      idToken = tokenResponse?.tokens?.id_token;
    } catch {
      console.warn("Google OAuth token exchange failed");
      if (isBrowserRedirect) {
        return res.redirect(302, `/login?error=${encodeURIComponent("INVALID_GOOGLE_CODE")}`);
      }
      return res.status(401).json({
        error: "Google avtorizasiya kodu etibarsızdır və ya vaxtı bitib.",
        code: "INVALID_GOOGLE_CODE",
      });
    }

    if (!idToken) {
      if (isBrowserRedirect) {
        return res.redirect(302, `/login?error=${encodeURIComponent("INVALID_GOOGLE_TOKEN")}`);
      }
      return res.status(401).json({
        error: "Google ID token alınmadı.",
        code: "INVALID_GOOGLE_TOKEN",
      });
    }

    let ticket;
    try {
      ticket = await googleClient.verifyIdToken({
        idToken,
        audience: googleClientId,
      });
    } catch {
      console.warn("Google OAuth ID token verification failed");
      if (isBrowserRedirect) {
        return res.redirect(302, `/login?error=${encodeURIComponent("INVALID_GOOGLE_TOKEN")}`);
      }
      return res.status(401).json({
        error: "Google giriş məlumatı etibarsızdır və ya vaxtı bitib.",
        code: "INVALID_GOOGLE_TOKEN",
      });
    }

    const profile = ticket?.getPayload();
    if (record.nonce && profile?.nonce !== record.nonce) {
      if (isBrowserRedirect) {
        return res.redirect(302, `/login?error=${encodeURIComponent("INVALID_GOOGLE_NONCE")}`);
      }
      return res.status(401).json({
        error: "Google təsdiqi (nonce) uyğun gəlmir.",
        code: "INVALID_GOOGLE_NONCE",
      });
    }

    const outcome = await provisionGoogleUser(req, res, profile);
    if (outcome.status !== 200) {
      if (isBrowserRedirect) {
        return res.redirect(302, `/login?error=${encodeURIComponent(outcome.code || "GOOGLE_AUTH_FAILED")}`);
      }
      return res.status(outcome.status).json({
        error: outcome.error,
        code: outcome.code,
      });
    }

    const returnTo = sanitizeReturnTo(record.returnTo);
    if (isBrowserRedirect) {
      return res.redirect(302, returnTo);
    }
    return res.json({
      user: outcome.user,
      restoredFromPendingDeletion: outcome.restoredFromPendingDeletion,
      returnTo,
    });
  }

  router.get("/google/callback", limit(authStore, "google-callback", 20, 15 * 60), asyncRoute(handleGoogleCallback));
  router.post("/google/callback", limit(authStore, "google-callback", 20, 15 * 60), asyncRoute(handleGoogleCallback));

  router.post(
  "/google",
  limit(authStore, "google-login", 20, 15 * 60),
  asyncRoute(async (req, res) => {
    const payload = parseBody(GoogleAuthSchema, req.body);
    const credential = payload.credential;

    if (!googleClientId) {
      return res.status(503).json({
        error: "Google girişi serverdə konfiqurasiya edilməyib.",
        code: "GOOGLE_AUTH_NOT_CONFIGURED",
      });
    }

    let ticket;
    try {
      ticket = await googleClient.verifyIdToken({
        idToken: credential,
        audience: googleClientId,
      });
    } catch {
      console.warn("Google ID token verification failed");
      return res.status(401).json({
        error: "Google giriş məlumatı etibarsızdır və ya vaxtı bitib.",
        code: "INVALID_GOOGLE_TOKEN",
      });
    }

    const profile = ticket?.getPayload();
    const nonce = await authStore.consumeResetToken(hashOpaqueToken(payload.nonce));
    const currentSessionOrOwner = req.auth?.sessionId || req.ownerId;
    const currentGuestOwner = req.guestOwnerId || req.ownerId;
    const nonceSessionMatches = Boolean(
      nonce &&
      (nonce.sessionId === currentSessionOrOwner || (nonce.guestOwnerId && nonce.guestOwnerId === currentGuestOwner))
    );
    if (!nonce || nonce.purpose !== 'google-nonce' || !nonceSessionMatches || profile?.nonce !== payload.nonce) return res.status(401).json({ code: 'INVALID_GOOGLE_NONCE', error: 'Google təsdiqi yenilənməlidir.' });

    const outcome = await provisionGoogleUser(req, res, profile);
    if (outcome.status !== 200) {
      return res.status(outcome.status).json({
        error: outcome.error,
        code: outcome.code,
      });
    }

    return res.json({
      user: outcome.user,
      restoredFromPendingDeletion: outcome.restoredFromPendingDeletion,
    });
  }),
);

  router.post("/signup", limit(authStore, "signup", 8, 15 * 60), asyncRoute(async (req, res) => {
    const payload = parseBody(SignupSchema, req.body);
    const passwordHash = await hashPassword(payload.password);
    const user = await userRepository.create({ ...payload, passwordHash });
    if (telemetryService) {
      telemetryService.trackAuth({
        ownerId: user.id,
        sessionId: req.guestOwnerId,
        action: "signup",
        provider: "credentials",
        ip: req.ip || req.socket?.remoteAddress,
        status: "success",
      }).catch(() => {});
    }
    try {
      await sendEmailVerificationCode(user);
      await startEmailVerificationCooldown(req, user.email);
    } catch {
      return res.status(202).json({
        verificationRequired: true,
        deliveryPending: true,
        email: user.email,
        message: "Hesab yaradıldı, lakin təsdiq kodu göndərilmədi. Kodu yenidən göndərmək üçün davam et.",
      });
    }
    return res.status(201).json({
      verificationRequired: true,
      email: user.email,
      resendAfterSeconds: EMAIL_VERIFICATION_RESEND_COOLDOWN_SECONDS,
    });
  }));

  router.post(
    "/email-verification/resend",
    limit(authStore, "email-verification-resend-ip", 10, 15 * 60),
    limit(authStore, "email-verification-resend", 3, 15 * 60, (req) => normalizeEmail(req.body?.email)),
    asyncRoute(async (req, res) => {
    const payload = parseBody(EmailVerificationRequestSchema, req.body);
    const cooldown = await startEmailVerificationCooldown(req, payload.email);
    await awaitBoundedAuthDelivery(
      "Email verification resend failed",
      cooldown.allowed
        ? async () => {
            const user = await verificationUser(payload.email);
            if (!user || (user.emailVerifiedAt && user.pendingEmail !== payload.email)) return;
            if (user.email !== payload.email && !(await startEmailVerificationCooldown(req, user.email)).allowed) return;
            await sendEmailVerificationCode(user);
          }
        : null,
    );
    return res.json({ message: "Hesab mövcuddursa, təsdiq kodu e-poçta göndərildi." });
  }));

  router.post(
    "/email-verification/confirm",
    limit(authStore, "email-verification-confirm", 10, 15 * 60, (req) => normalizeEmail(req.body?.email)),
    limit(authStore, "email-verification-confirm", 20, 15 * 60, (req) => normalizeEmail(req.body?.email), { perAccount: true }),
    asyncRoute(async (req, res) => {
    const payload = parseBody(EmailVerificationConfirmSchema, req.body);
    await purgeExpired();
    const user = await verificationUser(payload.email);
    const purpose = user?.pendingEmail === payload.email ? 'email-change' : 'signup';
    const tokenId = user ? hashOpaqueToken(`${user.id}:${payload.email}:${user.authVersion || 1}:${purpose}:${payload.code}`) : hashOpaqueToken(`missing:${payload.code}`);
    const token = await authStore.consumeEmailVerificationToken(tokenId);
    if (!user || !token || token.userId !== user.id || token.email !== payload.email || token.authVersion !== (user.authVersion || 1) || token.purpose !== purpose) {
      return res.status(400).json({ error: "Təsdiq kodu yanlışdır və ya vaxtı bitib.", code: "INVALID_EMAIL_VERIFICATION_CODE" });
    }
    const verifiedUser = await userRepository.confirmVerification(user.id, payload.email, token.authVersion, purpose);
    if (!verifiedUser) return res.status(400).json({ error: "Kod etibarsızdır.", code: "INVALID_EMAIL_VERIFICATION_CODE" });
    await authStore.invalidateUserSessions(user.id);
    await startSession(req, res, authStore, verifiedUser);
    if (purpose === "signup") {
      await claimGuestData(req, verifiedUser.id);
    }
    return res.json({ user: publicUser(verifiedUser) });
  }));

  router.post(
    "/login",
    limit(authStore, "login-ip", 60, 15 * 60),
    limit(authStore, "login", 12, 15 * 60, (req) => normalizeIdentifier(req.body?.identifier)),
    limit(authStore, "login", 50, 15 * 60, (req) => normalizeIdentifier(req.body?.identifier), { perAccount: true }),
    asyncRoute(async (req, res) => {
    await purgeExpired();

    const payload = parseBody(LoginSchema, req.body);
    const user = await userRepository.findByIdentifier(payload.identifier);
    const valid = await verifyPassword(user?.passwordHash || DUMMY_PASSWORD_HASH, payload.password);
    if (!user || !valid) {
      if (telemetryService) {
        telemetryService.trackAuth({
          ownerId: user?.id || null,
          sessionId: req.guestOwnerId,
          action: "login",
          provider: "credentials",
          ip: req.ip || req.socket?.remoteAddress,
          status: "error",
          reason: "Invalid credentials",
        }).catch(() => {});
      }
      return res.status(401).json({
        error: "E-poçt/istifadəçi adı və ya şifrə yanlışdır.",
        code: "INVALID_CREDENTIALS",
      });
    }

    if (!user.emailVerifiedAt) {
      const cooldown = await startEmailVerificationCooldown(req, user.email);
      if (cooldown.allowed) {
        await sendEmailVerificationCode(user).catch(() => {});
      }
      return res.status(403).json({
        error: "Daxil olmaq üçün əvvəlcə e-poçtunu təsdiqlə.",
        code: "EMAIL_VERIFICATION_REQUIRED",
        email: user.email,
        resendAfterSeconds: cooldown.allowed
          ? EMAIL_VERIFICATION_RESEND_COOLDOWN_SECONDS
          : Math.max(1, Math.ceil((cooldown.resetAt - Date.now()) / 1000)),
      });
    }

    let restoredFromPendingDeletion = false;
    let currentUser = user;
    if (user.scheduledDeletionAt) {
      const scheduledTime = new Date(user.scheduledDeletionAt).getTime();
      if (!isNaN(scheduledTime) && scheduledTime <= Date.now()) {
        await purgeExpired();
        return res.status(401).json({
          error: "Hesabınız 14 günlük gözləmə müddəti bitdiyinə görə tamamilə silinib.",
          code: "ACCOUNT_EXPIRED_DELETED",
        });
      } else {
        currentUser = await userRepository.cancelDeletion(user.id);
        restoredFromPendingDeletion = true;
      }
    }

    await startSession(req, res, authStore, currentUser);
    const updated = await userRepository.markLogin(currentUser.id);
    await claimGuestData(req, currentUser.id);
    if (telemetryService) {
      telemetryService.trackAuth({
        ownerId: currentUser.id,
        sessionId: req.guestOwnerId,
        action: "login",
        provider: "credentials",
        ip: req.ip || req.socket?.remoteAddress,
        status: "success",
      }).catch(() => {});
    }
    return res.json({
      user: publicUser(updated || currentUser),
      restoredFromPendingDeletion,
    });
  }));

  router.get(["/me", "/profile"], (req, res) => {
    if (!req.user) return res.status(401).json({ error: "Sessiya aktiv deyil.", code: "AUTH_REQUIRED" });
    return res.json({ user: publicUser(req.user) });
  });

  router.post("/logout", asyncRoute(async (req, res) => {
    parseBody(EmptyBodySchema, req.body || {});
    if (telemetryService) {
      telemetryService.trackAuth({
        ownerId: req.user?.id || req.ownerId,
        sessionId: req.auth?.sessionId || req.guestOwnerId,
        action: "logout",
        ip: req.ip || req.socket?.remoteAddress,
        status: "success",
      }).catch(() => {});
    }
    if (req.auth?.sessionId) await authStore.deleteSession(req.auth.sessionId);
    clearSessionCookie(req, res);
    return res.status(204).end();
  }));

  router.post(
    "/logout-all",
    limit(authStore, "logout-all", 10, 15 * 60, (req) => req.user?.id),
    asyncRoute(async (req, res) => {
      parseBody(EmptyBodySchema, req.body || {});
      if (!req.user) return res.status(401).json({ error: "Sessiya aktiv deyil.", code: "AUTH_REQUIRED" });
      const previousVersion = req.user.authVersion || 1;
      const updated = await userRepository.update(req.user.id, { authVersion: previousVersion + 1 }, {
        allowSystemFields: true, expectedAuthVersion: previousVersion,
      });
      const sessionId = req.auth?.sessionId;
      const kept = updated && sessionId && await authStore.advanceSessionVersion(sessionId, req.user.id, previousVersion);
      await authStore.invalidateUserSessions(req.user.id, kept ? sessionId : null);
      if (!kept) clearSessionCookie(req, res);
      return res.json({ ok: true });
    }),
  );

  router.post(
    "/account/delete-request",
    limit(authStore, "account-delete", 5, 15 * 60, (req) => req.user?.id),
    asyncRoute(async (req, res) => {
      if (!req.user) return res.status(401).json({ error: "Sessiya aktiv deyil.", code: "AUTH_REQUIRED" });
      const payload = z.object({ currentPassword: z.string().min(1).max(128).optional(), reauthToken: z.string().min(32).max(128).optional() }).strict().parse(req.body || {});
      if (!await reauthenticate(req, payload)) {
        return res.status(403).json({ code: 'REAUTH_REQUIRED', error: 'Hesabı silmək üçün təsdiq tələb olunur.' });
      }
      const updated = await userRepository.scheduleDeletion(req.user.id, 14);
      await telemetryService?.repository?.scrubOwner?.(req.user.id);
      if (authStore?.invalidateUserSessions) {
        await authStore.invalidateUserSessions(req.user.id);
      } else if (req.auth?.sessionId) {
        await authStore.deleteSession(req.auth.sessionId);
      }
      clearSessionCookie(req, res);
      return res.json({
        success: true,
        scheduledDeletionAt: updated.scheduledDeletionAt,
        message: "Hesabınız 14 günlük silinmə rejiminə keçirildi.",
      });
    })
  );

  router.post(
    "/account/cancel-deletion",
    limit(authStore, "account-cancel-delete", 5, 15 * 60, (req) => req.user?.id),
    asyncRoute(async (req, res) => {
      if (!req.user) return res.status(401).json({ error: "Sessiya aktiv deyil.", code: "AUTH_REQUIRED" });
      parseBody(EmptyBodySchema, req.body || {});
      const updated = await userRepository.cancelDeletion(req.user.id);
      return res.json({
        success: true,
        user: publicUser(updated),
        message: "Silinmə sorğusu ləğv edildi və hesabınız bərpa olundu.",
      });
    })
  );

  router.patch(
    ["/account", "/profile"],
    limit(authStore, "account-update", 20, 15 * 60, (req) => req.user?.id),
    asyncRoute(async (req, res) => {
      if (!req.user) return res.status(401).json({ error: "Sessiya aktiv deyil.", code: "AUTH_REQUIRED" });
      const payload = parseBody(AccountUpdateSchema, req.body);
      const emailChanged = normalizeEmail(payload.email) !== normalizeEmail(req.user.email);
      if (emailChanged && !await reauthenticate(req, payload)) return res.status(403).json({ code: 'REAUTH_REQUIRED', error: 'E-poçtu dəyişmək üçün yenidən təsdiq tələb olunur.' });
      const updated = await userRepository.update(req.user.id, {
        fullName: payload.fullName, username: payload.username,
        ...(emailChanged ? { pendingEmail: payload.email, pendingEmailExpiresAt: Date.now() + EMAIL_VERIFICATION_TTL_SECONDS * 1000 } : {}),
      }, { allowSystemFields: true, expectedAuthVersion: req.user.authVersion || 1 });
      if (emailChanged) await sendEmailVerificationCode(updated);
      return res.json({ user: publicUser(updated) });
    })
  );

  router.patch(
    "/settings",
    limit(authStore, "settings-update", 30, 15 * 60, (req) => req.user?.id),
    asyncRoute(async (req, res) => {
      if (!req.user) return res.status(401).json({ error: "Sessiya aktiv deyil.", code: "AUTH_REQUIRED" });
      const payload = parseBody(UserSettingsSchema, req.body);
      const updateData = {
        settings: payload,
      };
      const updated = await userRepository.update(req.user.id, updateData, { allowSystemFields: true });
      if (updated?.settings?.modelImprovement === false) await telemetryService?.repository?.scrubOwner?.(req.user.id);

      if (updated?.settings?.modelImprovement === false) {
        if (typeof aiLearningRepository?.scrubOwner === "function") {
          await aiLearningRepository.scrubOwner(req.user.id);
        } else if (aiLearningRepository?.update) {
          await aiLearningRepository.update((store) => {
          const ownerInteractionIds = new Set(
            store.interactions.filter((i) => i.ownerId === req.user.id).map((i) => i.id)
          );
          store.candidates = store.candidates.filter(
            (c) => !ownerInteractionIds.has(c.sourceInteractionId)
          );
          if (Array.isArray(store.iterations)) {
            store.iterations = store.iterations.filter(
              (it) => !ownerInteractionIds.has(it.parentInteractionId) && !ownerInteractionIds.has(it.interactionId)
            );
          }
          if (Array.isArray(store.signals)) {
            store.signals = store.signals.filter(
              (sig) => !ownerInteractionIds.has(sig.interactionId)
            );
          }
          for (const item of store.interactions) {
            if (item.ownerId === req.user.id) {
              item.onlyNecessaryData = true;
              item.modelImprovement = false;
              item.userPrompt = "[Zəruri əməliyyat qeydi - Məzmun ötürülmür]";
              item.modelResponse = "[Məzmun gizlədilib - Töhfə deaktivdir]";
              item.relevantContext = null;
            }
          }
          });
        }
      }
      return res.json({ user: publicUser(updated) });
    })
  );

  router.post(
    "/settings/memory",
    limit(authStore, "settings-memory-add", 30, 15 * 60, (req) => req.user?.id),
    asyncRoute(async (req, res) => {
      if (!req.user) return res.status(401).json({ error: "Sessiya aktiv deyil.", code: "AUTH_REQUIRED" });
      const payload = parseBody(AddMemoryItemSchema, req.body);
      const newMemory = {
        id: `mem_${randomUUID().slice(0, 8)}`,
        text: payload.text,
        category: payload.category || "general",
        createdAt: new Date().toISOString(),
      };
      if (typeof userRepository.updateSettingsAtomically === "function") {
        const outcome = await userRepository.updateSettingsAtomically(req.user.id, (currentSettings) => {
          const currentMemories = Array.isArray(currentSettings.memories) ? currentSettings.memories : [];
          if (currentMemories.length >= 50) {
            return { modified: false, result: { limitReached: true } };
          }
          return {
            settings: { memories: [newMemory, ...currentMemories] },
            result: { limitReached: false },
          };
        });
        if (outcome?.result?.limitReached) {
          return res.status(400).json({ error: "Maksimum 50 yaddaş qeydi saxlanıla bilər.", code: "LIMIT_REACHED" });
        }
        return res.status(201).json({ memory: newMemory, user: publicUser(outcome.user) });
      }
      const currentMemories = Array.isArray(req.user.settings?.memories) ? req.user.settings.memories : [];
      if (currentMemories.length >= 50) {
        return res.status(400).json({ error: "Maksimum 50 yaddaş qeydi saxlanıla bilər.", code: "LIMIT_REACHED" });
      }
      const updated = await userRepository.update(req.user.id, {
        settings: { memories: [newMemory, ...currentMemories] },
      });
      return res.status(201).json({ memory: newMemory, user: publicUser(updated) });
    })
  );

  router.delete(
    "/settings/memory/:id",
    asyncRoute(async (req, res) => {
      parseBody(EmptyBodySchema, req.body ?? {});
      if (!req.user) return res.status(401).json({ error: "Sessiya aktiv deyil.", code: "AUTH_REQUIRED" });
      const memoryId = String(req.params.id || "").trim();
      if (!memoryId || !/^[a-zA-Z0-9_-]{1,100}$/.test(memoryId)) {
        return res.status(400).json({ error: "Yaddaş ID-si düzgün deyil.", code: "VALIDATION_ERROR" });
      }
      if (typeof userRepository.updateSettingsAtomically === "function") {
        const outcome = await userRepository.updateSettingsAtomically(req.user.id, (currentSettings) => {
          const currentMemories = Array.isArray(currentSettings.memories) ? currentSettings.memories : [];
          return {
            settings: { memories: currentMemories.filter((m) => m.id !== memoryId) },
          };
        });
        return res.json({ ok: true, user: publicUser(outcome.user) });
      }
      const currentMemories = Array.isArray(req.user.settings?.memories) ? req.user.settings.memories : [];
      const filtered = currentMemories.filter((m) => m.id !== memoryId);
      const updated = await userRepository.update(req.user.id, {
        settings: {
          memories: filtered,
        },
      });
      return res.json({ ok: true, user: publicUser(updated) });
    })
  );

  router.delete("/settings/memory", asyncRoute(async (req, res) => {
    parseBody(EmptyBodySchema, req.body || {});
    if (!req.user) return res.status(401).json({ error: "Sessiya aktiv deyil.", code: "AUTH_REQUIRED" });
    const updated = typeof userRepository.updateSettingsAtomically === "function"
      ? (await userRepository.updateSettingsAtomically(req.user.id, () => ({ settings: { memories: [] } }))).user
      : await userRepository.update(req.user.id, { settings: { memories: [] } });
    return res.json({ ok: true, user: publicUser(updated) });
  }));

  router.post(
    "/settings/import-memory",
    limit(authStore, "settings-memory-import", 10, 15 * 60, (req) => req.user?.id),
    asyncRoute(async (req, res) => {
    if (!req.user) return res.status(401).json({ error: "Sessiya aktiv deyil.", code: "AUTH_REQUIRED" });
    const payload = parseBody(ImportMemoryPayloadSchema, req.body);

    const now = new Date().toISOString();
    const importedMemories = (payload.memories || []).map((m) => ({
      id: m.id || `mem_${randomUUID().slice(0, 8)}`,
      text: m.text,
      category: m.category || "general",
      createdAt: now,
    }));

    const buildMergedSettings = (currentSettings) => {
      const currentMemories = Array.isArray(currentSettings.memories) ? currentSettings.memories : [];
      let finalMemories = [];
      if (payload.mergeMode === "replace") {
        finalMemories = importedMemories.slice(0, 50);
      } else {
        const existingTexts = new Set(currentMemories.map((m) => m.text.trim().toLowerCase()));
        const newItems = importedMemories.filter((m) => !existingTexts.has(m.text.trim().toLowerCase()));
        finalMemories = [...newItems, ...currentMemories].slice(0, 50);
      }

      return {
        personalIntelligence: payload.enablePersonalIntelligence !== false ? true : (currentSettings.personalIntelligence ?? true),
        brandName: payload.brandName !== undefined && payload.brandName !== "" ? payload.brandName : (currentSettings.brandName || ""),
        industry: payload.industry !== undefined && payload.industry !== "" ? payload.industry : (currentSettings.industry || ""),
        primaryMarket: payload.primaryMarket !== undefined && payload.primaryMarket !== "" ? payload.primaryMarket : (currentSettings.primaryMarket || ""),
        targetAudience: payload.targetAudience !== undefined && payload.targetAudience !== "" ? payload.targetAudience : (currentSettings.targetAudience || ""),
        tone: payload.tone || currentSettings.tone || "professional",
        customInstructions: payload.customInstructions !== undefined && payload.customInstructions !== ""
          ? (payload.mergeMode === "merge" && currentSettings.customInstructions && currentSettings.customInstructions !== payload.customInstructions
              ? `${currentSettings.customInstructions}\n\n${payload.customInstructions}`.slice(0, 2000)
              : payload.customInstructions)
          : (currentSettings.customInstructions || ""),
        memories: finalMemories,
      };
    };

    const updated = typeof userRepository.updateSettingsAtomically === "function"
      ? (await userRepository.updateSettingsAtomically(req.user.id, (currentSettings) => ({
          settings: buildMergedSettings(currentSettings),
        }))).user
      : await userRepository.update(req.user.id, {
          settings: buildMergedSettings(req.user.settings && typeof req.user.settings === "object" ? req.user.settings : {}),
        });
    const totalMemories = Array.isArray(updated?.settings?.memories) ? updated.settings.memories.length : 0;

    return res.status(200).json({
      ok: true,
      importedCount: importedMemories.length,
      totalMemories,
      user: publicUser(updated),
    });
  }));

  router.post("/onboarding", asyncRoute(async (req, res) => {
    if (!req.user) return res.status(401).json({ error: "Sessiya aktiv deyil.", code: "AUTH_REQUIRED" });
    const payload = parseBody(OnboardingSchema, req.body);
    const currentSettings = req.user.settings && typeof req.user.settings === "object" ? req.user.settings : {};
    const updatedSettings = {
    };
    if (payload.role) {
      updatedSettings.industry = payload.role;
    }
    if (payload.goal && !currentSettings.customInstructions) {
      updatedSettings.customInstructions = `Əsas məqsəd: ${payload.goal}`;
    }
    if (payload.role || payload.goal) {
      updatedSettings.personalIntelligence = true;
    }

    const updated = await userRepository.update(req.user.id, {
      onboardingFocus: payload.goal || payload.focus || (payload.skipped ? "other" : "business"),
      onboardingRole: payload.role || null,
      onboardingGoal: payload.goal || null,
      onboardingCompletedAt: new Date().toISOString(),
      settings: updatedSettings,
    });
    return res.json({ user: publicUser(updated) });
  }));

  router.post("/change-password", limit(authStore, "change-password", 8, 15 * 60, (req) => req.user?.id), asyncRoute(async (req, res) => {
    if (!req.user) return res.status(401).json({ error: "Sessiya aktiv deyil.", code: "AUTH_REQUIRED" });
    const payload = parseBody(ChangePasswordSchema, req.body);
    if (!(await verifyPassword(req.user.passwordHash, payload.currentPassword))) {
      return res.status(400).json({ error: "Cari şifrə yanlışdır.", code: "INVALID_CURRENT_PASSWORD" });
    }
    if (await verifyPassword(req.user.passwordHash, payload.newPassword)) {
      return res.status(400).json({ error: "Yeni şifrə cari şifrədən fərqli olmalıdır.", code: "PASSWORD_REUSED" });
    }
    const updated = await userRepository.updatePassword(req.user.id, await hashPassword(payload.newPassword), {
      expectedAuthVersion: req.user.authVersion || 1,
    });
    if (!updated) return res.status(401).json({ code: 'SESSION_CHANGED' });
    await authStore.invalidateUserSessions(req.user.id);
    clearSessionCookie(req, res);
    return res.json({ ok: true });
  }));

  router.post(
    "/forgot-password",
    limit(authStore, "forgot-password-ip", 20, 30 * 60),
    limit(authStore, "forgot-password", 6, 30 * 60, (req) => normalizeEmail(req.body?.email)),
    asyncRoute(async (req, res) => {
    const generic = { message: "Bu e-poçt sistemdə varsa, şifrə yeniləmə keçidi göndərildi." };
    const parsed = ForgotPasswordSchema.safeParse(req.body);
    await awaitBoundedAuthDelivery(
      "Password reset email delivery failed",
      parsed.success
        ? async () => {
            const user = await userRepository.findByEmail(parsed.data.email);
            if (!user) return;
            const rawToken = randomBytes(32).toString("base64url");
            await authStore.createResetToken(hashOpaqueToken(rawToken), user.id, RESET_TTL_SECONDS, { purpose: "password-reset", authVersion: user.authVersion || 1 });
            const resetUrl = `${canonicalAppUrl}/reset-password?token=${encodeURIComponent(rawToken)}`;
            await emailService.sendPasswordResetEmail({ email: user.email, fullName: user.fullName, resetUrl });
          }
        : null,
    );
    return res.json(generic);
  }));

  router.post("/reset-password", limit(authStore, "reset-password", 10, 30 * 60), asyncRoute(async (req, res) => {
    const payload = parseBody(ResetPasswordSchema, req.body);
    const reset = await authStore.consumeResetToken(hashOpaqueToken(payload.token));
    if (!reset) {
      return res.status(400).json({ error: "Keçid etibarsızdır və ya vaxtı bitib.", code: "INVALID_RESET_TOKEN" });
    }
    const user = await userRepository.findById(reset.userId);
    if (!user || reset.purpose !== "password-reset" || reset.authVersion !== (user.authVersion || 1)) return res.status(400).json({ error: "Keçid etibarsızdır və ya vaxtı bitib.", code: "INVALID_RESET_TOKEN" });
    const updated = await userRepository.updatePassword(user.id, await hashPassword(payload.password), {
      expectedAuthVersion: reset.authVersion,
    });
    if (!updated) return res.status(401).json({ code: 'SESSION_CHANGED' });
    await authStore.invalidateUserSessions(user.id);
    clearSessionCookie(req, res);
    return res.json({ ok: true });
  }));

  return router;
}

export function authErrorHandler(error, req, res, next) {
  if (res.headersSent) return next(error);
  const isAuthRoute = Boolean(
    req.baseUrl?.startsWith("/api/auth") ||
    req.originalUrl?.startsWith("/api/auth") ||
    req.path?.startsWith("/api/auth")
  );
  if (!isAuthRoute) {
    return next(error);
  }
  if (error.type === "entity.too.large") {
    return res.status(413).json({ error: "Sorğu həcmi çox böyükdür.", code: "PAYLOAD_TOO_LARGE" });
  }
  if (error.type === "entity.parse.failed") {
    return res.status(400).json({ error: "Sorğu formatı düzgün deyil.", code: "INVALID_JSON" });
  }
  if (error.name === "ZodError") return res.status(400).json({ error: "Sorğu düzgün deyil.", code: "VALIDATION_ERROR" });
  if (error.code === "VALIDATION_ERROR") {
    return res.status(400).json({ error: error.message, code: error.code, details: error.details });
  }
  if (error.code === "USER_CONFLICT") {
    return res.status(409).json({ error: error.message, code: error.code, field: error.field });
  }
  if (error.code === "ORIGIN_NOT_ALLOWED") {
    return res.status(403).json({ error: "Bu mənbədən girişə icazə verilmir.", code: error.code });
  }
  if (error.status === 401) return res.status(401).json({ code: error.code || "AUTH_REQUIRED" });
  console.error("Authentication request failed", { path: req.path, name: error.name, code: error.code });
  return res.status(500).json({ error: "Sorğunu tamamlamaq mümkün olmadı.", code: "AUTH_ERROR" });
}
