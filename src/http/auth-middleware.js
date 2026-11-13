import { randomBytes } from "node:crypto";
import { hashOpaqueToken } from "../auth/password.js";
import { GUEST_COOKIE, clearGuestCookie, parseCookies, verifyGuestCookie } from "./session.js";

export { GUEST_COOKIE, clearGuestCookie, parseCookies };
export const SESSION_COOKIE = "helmer_session";
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;

function secureRequest(req) {
  const forwarded = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim();
  return process.env.NODE_ENV === "production" || req.secure || forwarded === "https";
}

export function setSessionCookie(req, res, token) {
  res.append("Set-Cookie", `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_SECONDS}${secureRequest(req) ? "; Secure" : ""}`);
}

export function clearSessionCookie(req, res) {
  res.append("Set-Cookie", `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secureRequest(req) ? "; Secure" : ""}`);
}

export function createSessionToken() {
  return randomBytes(32).toString("base64url");
}

export function createIdentityMiddleware({ authStore, userRepository }) {
  return async function identity(req, res, next) {
    try {
      const cookies = parseCookies(req.headers.cookie);
      req.guestOwnerId = verifyGuestCookie(cookies[GUEST_COOKIE]);
      const rawToken = cookies[SESSION_COOKIE];
      if (!rawToken || rawToken.length > 200) return next();
      const sessionId = hashOpaqueToken(rawToken);
      const canPreloadStore = typeof userRepository?.readStore === "function";
      const [session, preloadedStore] = await Promise.all([
        authStore.getSession(sessionId),
        canPreloadStore ? userRepository.readStore({ force: true, clone: false, raw: true }).catch(() => null) : Promise.resolve(null),
      ]);
      if (!session) {
        clearSessionCookie(req, res);
        return next();
      }
      let user = Array.isArray(preloadedStore?.users)
        ? (typeof userRepository?.extractUserById === "function"
            ? userRepository.extractUserById(preloadedStore, session.userId)
            : (preloadedStore.users.find((item) => item.id === session.userId) || null))
        : await userRepository.findById(session.userId);
      const needsCloudRevalidation = Boolean(
        !user ||
        (userRepository?.cloud && (session.authVersion !== (user.authVersion || 1) || !user.emailVerifiedAt))
      );
      if (needsCloudRevalidation && typeof userRepository.syncFromR2 === "function") {
        await userRepository.syncFromR2(true).catch(() => {});
        user = await userRepository.findById(session.userId);
      }
      if (!user) {
        clearSessionCookie(req, res);
        return next();
      }
      if (session.protocolVersion !== 2 || session.authVersion !== (user.authVersion || 1)) {
        await authStore.deleteSession(sessionId);
        clearSessionCookie(req, res);
        return next();
      }
      if (user.passwordChangedAt && session.createdAt) {
        const passwordChangedTime = new Date(user.passwordChangedAt).getTime();
        if (passwordChangedTime > session.createdAt + 1000) {
          if (authStore?.deleteSession) {
            await authStore.deleteSession(sessionId).catch(() => {});
          }
          clearSessionCookie(req, res);
          return next();
        }
      }
      if (user.status === "deleted" || (user.scheduledDeletionAt && new Date(user.scheduledDeletionAt) <= new Date())) {
        if (authStore?.invalidateUserSessions) {
          await authStore.invalidateUserSessions(user.id).catch(() => {});
        } else {
          await authStore.deleteSession(sessionId).catch(() => {});
        }
        clearSessionCookie(req, res);
        return next();
      }
      req.auth = { user, sessionId, session };
      req.user = user;
      req.ownerId = user.id;
      return next();
    } catch (error) {
      return next(error);
    }
  };
}

export function requireAuth(req, res, next) {
  if (req.auth?.user?.emailVerifiedAt && (!req.auth.user.status || req.auth.user.status === 'active')) return next();
  return res.status(401).json({ error: "Davam etmək üçün hesabına daxil ol.", code: "AUTH_REQUIRED" });
}

export function isModelImprovementEnabled(req) {
  if (req?.user?.settings) {
    return req.user.settings.modelImprovement === true && req.user.settings.personalIntelligence !== false;
  }
  return false;
}

