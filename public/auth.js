let currentGoogleNonce = "";
import { t, getLanguage, setLanguage } from "./i18n.js";

const authRoot = document.querySelector("#authRoot");
const appShell = document.querySelector("#appShell");

const DEFAULT_GOOGLE_CLIENT_ID =
  "471975374819-mgn2g8auc7q9eko71air922aoo7h963p.apps.googleusercontent.com";
let runtimeGoogleClientId = DEFAULT_GOOGLE_CLIENT_ID;
let initializedGoogleClientId = null;

async function loadAuthConfig() {
  try {
    const data = await request("/api/auth/config");
    if (data?.googleClientId) {
      runtimeGoogleClientId = data.googleClientId;
    }
  } catch {}
}

const AUTH_PATHS = new Set([
  "/login",
  "/signin",
  "/signup",
  "/register",
  "/forgot-password",
  "/reset-password",
  "/verify-email",
]);

let pendingReturnPath = "/workspace";

function legalNoticeElement() {
  const terms = document.createElement("p");
  terms.className = "auth-terms";

  const termsLink = document.createElement("a");
  termsLink.href = "/terms";
  termsLink.target = "_blank";
  termsLink.rel = "noopener noreferrer";
  termsLink.className = "auth-legal-link";
  termsLink.textContent = t("auth.signup.termsLink");

  const privacyLink = document.createElement("a");
  privacyLink.href = "/privacy";
  privacyLink.target = "_blank";
  privacyLink.rel = "noopener noreferrer";
  privacyLink.className = "auth-legal-link";
  privacyLink.textContent = t("auth.signup.privacyLink");

  terms.append(
    t("auth.signup.termsAgreementPre"),
    termsLink,
    t("auth.signup.and"),
    privacyLink,
    t("auth.signup.termsAgreementPost")
  );
  return terms;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  })[character]);
}

function safeInternalPath(value) {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) return "/";
  try {
    const url = new URL(value, location.origin);
    if (url.origin !== location.origin || AUTH_PATHS.has(url.pathname)) return "/";
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "/";
  }
}

async function request(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && data.code === "AUTH_REQUIRED" && path !== "/api/auth/me") {
      window.dispatchEvent(new CustomEvent("helmer:auth-required"));
    }
    const error = new Error(data.error || t("common.genericError"));
    error.code = data.code;
    error.field = data.field;
    error.details = data.details;
    error.email = data.email;
    error.resendAfterSeconds = data.resendAfterSeconds || data.retryAfter;
    throw error;
  }
  return data;
}

function route(path, replace = false) {
  window.history[replace ? "replaceState" : "pushState"]({}, "", path);
}

function shell(title, subtitle, { stepBadge = null, wide = false } = {}) {
  authRoot.replaceChildren();
  const layout = document.createElement("div");
  layout.className = "auth-layout";

  // Ambient glow backdrop for theme depth
  const glow = document.createElement("div");
  glow.className = "auth-ambient-glow";
  glow.setAttribute("aria-hidden", "true");
  layout.appendChild(glow);

  // Top header bar with brand logo & live theme/language controls
  const topBar = document.createElement("header");
  topBar.className = "auth-top-bar";

  const brand = document.createElement("a");
  brand.className = "auth-brand";
  brand.href = "/login";
  brand.setAttribute("aria-label", "Helmer");

  const brandInfo = document.createElement("div");
  brandInfo.className = "auth-brand-info";
  const brandLogo = document.createElement("img");
  brandLogo.src = "/MarketifyAINewFavicon.png?v=4";
  brandLogo.alt = "Helmer";
  brandLogo.className = "auth-brand-logo";
  brandLogo.width = 24;
  brandLogo.height = 24;
  const brandTitle = document.createElement("strong");
  brandTitle.textContent = "Helmer";
  brandInfo.append(brandLogo, brandTitle);
  brand.appendChild(brandInfo);

  const utils = document.createElement("div");
  utils.className = "auth-top-utils";

  // Theme toggle button (managed automatically by public/theme.js)
  const isDark = document.documentElement.dataset.theme === "dark";
  const themeBtn = document.createElement("button");
  themeBtn.type = "button";
  themeBtn.className = "auth-util-btn auth-theme-toggle";
  themeBtn.setAttribute("data-theme-toggle", "");
  themeBtn.setAttribute("aria-label", isDark ? t("nav.themeToggleLight") : t("nav.themeToggleDark"));
  themeBtn.setAttribute("title", isDark ? t("nav.themeToggleLight") : t("nav.themeToggleDark"));
  themeBtn.innerHTML = `
    <svg class="theme-icon-moon nav-svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.9 13a9 9 0 0 1-9.9-9.9A9 9 0 1 0 20.9 13Z"/></svg>
    <svg class="theme-icon-sun nav-svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42"/></svg>
  `;

  // Language toggle button
  const currentLang = getLanguage();
  const langBtn = document.createElement("button");
  langBtn.type = "button";
  langBtn.className = "auth-util-btn auth-lang-btn";
  langBtn.setAttribute("aria-label", t("nav.languageToggleAria"));
  langBtn.setAttribute("title", t("nav.languageToggle"));
  const langBadge = document.createElement("span");
  langBadge.className = "auth-lang-badge";
  langBadge.textContent = currentLang === "az" ? "EN" : "AZ";
  langBtn.appendChild(langBadge);
  langBtn.addEventListener("click", () => {
    const next = getLanguage() === "az" ? "en" : "az";
    setLanguage(next, true);
    renderRoute();
  });

  utils.append(themeBtn, langBtn);
  topBar.append(brand, utils);
  layout.appendChild(topBar);

  // Auth panel container (clean, centered minimalist glass card)
  const panel = document.createElement("section");
  panel.className = "auth-panel";

  const container = document.createElement("div");
  container.className = `auth-container auth-card${wide ? " auth-container-wide" : ""}`;

  if (stepBadge) {
    const badgeEl = document.createElement("div");
    badgeEl.className = "auth-step-badge";
    badgeEl.textContent = stepBadge;
    container.appendChild(badgeEl);
  }

  const header = document.createElement("div");
  header.className = "auth-header";

  const h1 = document.createElement("h1");
  h1.textContent = title;

  const p = document.createElement("p");
  p.textContent = subtitle;

  header.append(h1, p);
  container.appendChild(header);

  const content = document.createElement("div");
  content.className = "auth-content";
  container.appendChild(content);

  panel.appendChild(container);
  layout.appendChild(panel);

  // Footer with copyright & legal links
  const footer = document.createElement("footer");
  footer.className = "auth-footer";
  const copyright = document.createElement("span");
  copyright.className = "auth-copyright";
  copyright.textContent = "© Innova Group Azerbaijan";

  const footerLinks = document.createElement("div");
  footerLinks.className = "auth-footer-links";

  const termsLink = document.createElement("a");
  termsLink.href = "/terms";
  termsLink.target = "_blank";
  termsLink.rel = "noopener noreferrer";
  termsLink.className = "auth-footer-link";
  termsLink.textContent = t("nav.terms") || "İstifadə şərtləri";

  const privacyLink = document.createElement("a");
  privacyLink.href = "/privacy";
  privacyLink.target = "_blank";
  privacyLink.rel = "noopener noreferrer";
  privacyLink.className = "auth-footer-link";
  privacyLink.textContent = t("nav.privacy") || "Məxfilik siyasəti";

  footerLinks.append(termsLink, document.createTextNode(" · "), privacyLink);
  footer.append(copyright, footerLinks);
  layout.appendChild(footer);

  authRoot.appendChild(layout);
  return content;
}

function field({ label, name, type = "text", autocomplete, placeholder = "", hint = "" }) {
  const wrapper = document.createElement("label");
  wrapper.className = "auth-field";
  const eyeLabel = getLanguage() === "en" ? "Show password" : "Şifrəni göstər";

  const labelSpan = document.createElement("span");
  labelSpan.className = "auth-field-label";
  labelSpan.textContent = label;

  const wrapSpan = document.createElement("span");
  wrapSpan.className = "auth-input-wrap";

  const input = document.createElement("input");
  input.name = name;
  input.type = type;
  input.autocomplete = autocomplete || "off";
  input.placeholder = placeholder;
  input.required = true;
  input.setAttribute("aria-label", label);
  wrapSpan.appendChild(input);

  if (type === "password") {
    const toggle = document.createElement("button");
    toggle.className = "password-toggle";
    toggle.type = "button";
    toggle.setAttribute("aria-label", eyeLabel);
    toggle.innerHTML = `<svg class="icon-eye" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>`;

    toggle.addEventListener("click", () => {
      const visible = input.type === "text";
      input.type = visible ? "password" : "text";
      const isEn = getLanguage() === "en";
      toggle.setAttribute("aria-label", visible ? (isEn ? "Show password" : "Şifrəni göstər") : (isEn ? "Hide password" : "Şifrəni gizlət"));
      toggle.innerHTML = visible
        ? `<svg class="icon-eye" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>`
        : `<svg class="icon-eye-off" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" y1="2" x2="22" y2="22"/></svg>`;
    });
    wrapSpan.appendChild(toggle);
  }

  const hintEl = document.createElement("small");
  hintEl.className = "auth-field-hint";
  hintEl.textContent = hint;

  wrapper.append(labelSpan, wrapSpan, hintEl);
  return wrapper;
}

function setFormError(form, message, fieldName = "") {
  form.querySelectorAll(".auth-field").forEach((item) => item.classList.remove("has-error"));
  const box = form.querySelector(".auth-error");
  if (box) {
    box.textContent = message || "";
    box.hidden = !message;
  }
  if (fieldName) form.elements[fieldName]?.closest(".auth-field")?.classList.add("has-error");
}

function submitState(button, pending, label) {
  button.disabled = pending;
  button.replaceChildren();
  if (pending) {
    const spinner = document.createElement("span");
    spinner.className = "auth-spinner";
    spinner.setAttribute("aria-hidden", "true");
    button.append(spinner, document.createTextNode(` ${t("common.loading") || "Loading…"}`));
  } else {
    button.textContent = label;
  }
}

function formBase(actionLabel) {
  const form = document.createElement("form");
  form.className = "auth-form";
  const err = document.createElement("div");
  err.className = "auth-error";
  err.setAttribute("role", "alert");
  err.hidden = true;
  form.appendChild(err);

  const submit = document.createElement("button");
  submit.type = "submit";
  submit.className = "auth-submit";
  submit.textContent = actionLabel;
  return { form, submit };
}

function authDivider(text) {
  const divider = document.createElement("div");
  divider.className = "auth-divider";
  const span = document.createElement("span");
  span.textContent = text;
  divider.appendChild(span);
  return divider;
}

function linkButton(label, path) {
  const link = document.createElement("a");
  link.href = path;
  link.textContent = label;
  link.addEventListener("click", (event) => {
    event.preventDefault();
    route(path);
    renderRoute();
  });
  return link;
}

let authenticatedCallback = null;

async function enterGuestWorkspace() {
  authRoot.hidden = true;
  appShell.hidden = false;
  document.body.classList.remove("auth-loading", "auth-active");
  route(pendingReturnPath, true);
  await authenticatedCallback?.(null);
}

function guestAccessButton(label = null) {
  const currentLabel = label || (getLanguage() === "en" ? "Continue as guest" : "Hesabsız davam et");
  const wrap = document.createElement("div");
  wrap.className = "auth-guest-wrap";
  const guest = document.createElement("button");
  guest.type = "button";
  guest.className = "auth-guest-link";

  const textSpan = document.createElement("span");
  textSpan.textContent = currentLabel;
  guest.appendChild(textSpan);

  guest.insertAdjacentHTML(
    "beforeend",
    `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M12 5l7 7-7 7"/></svg>`
  );

  guest.addEventListener("click", enterGuestWorkspace);
  wrap.appendChild(guest);
  return wrap;
}

async function completeAuthentication(user) {
  window.dispatchEvent(new CustomEvent("helmer:user-changed", { detail: { user } }));
  if (user?.settings?.language) {
    setLanguage(user.settings.language, true);
  }
  if (!user.onboardingCompleted) return renderOnboarding(user);
  authRoot.hidden = true;
  appShell.hidden = false;
  document.body.classList.remove("auth-loading", "auth-active");
  if (pendingReturnPath && (pendingReturnPath === "/admin" || pendingReturnPath.startsWith("/admin/") || pendingReturnPath.startsWith("/admin?"))) {
    window.location.href = pendingReturnPath;
    return;
  }
  route(pendingReturnPath, true);
  await authenticatedCallback?.(user);
}

async function refreshGoogleIdentityNonce() {
  if (!runtimeGoogleClientId || !window.google?.accounts?.id) return;
  try {
    currentGoogleNonce = (await request("/api/auth/google/nonce", { method: "POST", body: JSON.stringify({}) })).nonce;
    window.google.accounts.id.initialize({
      client_id: runtimeGoogleClientId,
      nonce: currentGoogleNonce,
      callback: handleGoogleCredential,
      ux_mode: "popup",
    });
    initializedGoogleClientId = runtimeGoogleClientId;
    const target = document.querySelector(".google-auth-button");
    if (target) {
      window.google.accounts.id.renderButton(target, googleButtonOptions());
    }
  } catch {}
}

async function handleGoogleCredential(response) {
  try {
    const data = await request("/api/auth/google", {
      method: "POST",
      body: JSON.stringify({
        credential: response.credential,
        nonce: currentGoogleNonce,
      }),
    });

    if (data.restoredFromPendingDeletion) {
      window.dispatchEvent(new CustomEvent("helmer:account-restored"));
    }
    await completeAuthentication(data.user);
  } catch (error) {
    console.error("Google login error:", error);
    const form = authRoot.querySelector(".auth-form");
    if (form) setFormError(form, error.message);
    await refreshGoogleIdentityNonce();
  }
}

function googleButtonOptions() {
  const isDark = document.documentElement.dataset.theme === "dark";
  return {
    type: "standard",
    theme: isDark ? "outline_dark" : "outline",
    size: "large",
    text: "continue_with",
    shape: "rectangular",
    width: 380,
  };
}

window.addEventListener("helmer:theme-change", () => {
  const target = document.querySelector(".google-auth-button");
  if (target && window.google?.accounts?.id) {
    try { window.google.accounts.id.renderButton(target, googleButtonOptions()); } catch {}
  }
});

function resolveOAuthErrorMessage(errorCode) {
  if (!errorCode) return "";
  const isEn = getLanguage() === "en";
  const messages = {
    GOOGLE_AUTH_NOT_CONFIGURED: isEn ? "Google Sign-In is not configured on the server." : "Google girişi serverdə konfiqurasiya edilməyib.",
    GOOGLE_OAUTH_CANCELLED: isEn ? "Google sign-in was cancelled." : "Google girişi ləğv edildi.",
    INVALID_GOOGLE_STATE: isEn ? "Google security state expired. Please try again." : "Google təhlükəsizlik təsdiqi (state) vaxtı bitib. Yenidən yoxla.",
    INVALID_GOOGLE_PKCE: isEn ? "Google PKCE verification failed. Please try again." : "Google PKCE doğrulaması uğursuz oldu. Yenidən yoxla.",
    INVALID_GOOGLE_CODE: isEn ? "Google authorization code expired. Please try again." : "Google avtorizasiya kodu etibarsızdır və ya vaxtı bitib.",
    INVALID_GOOGLE_TOKEN: isEn ? "Google ID token is invalid or expired." : "Google giriş məlumatı etibarsızdır və ya vaxtı bitib.",
    INVALID_GOOGLE_NONCE: isEn ? "Google verification nonce mismatch. Please try again." : "Google təsdiqi yenilənməlidir.",
    GOOGLE_ACCOUNT_MISMATCH: isEn ? "This email is linked to another Google account." : "Bu e-poçt başqa Google hesabına bağlıdır.",
    GOOGLE_ACCOUNT_LINK_REQUIRED: isEn ? "An account with this email already exists. Please sign in with your password first." : "Bu e-poçt ünvanı ilə artıq hesab mövcuddur. Təhlükəsizlik üçün əvvəlcə şifrə ilə daxil olun.",
    INVALID_GOOGLE_AUDIENCE: isEn ? "Google token audience mismatch." : "Google token auditoriyası etibarsızdır.",
    INVALID_GOOGLE_ISSUER: isEn ? "Google token issuer mismatch." : "Google token mənbəyi etibarsızdır.",
    ACCOUNT_EXPIRED_DELETED: isEn ? "This account was permanently deleted after the 14-day grace period." : "Hesabınız 14 günlük gözləmə müddəti bitdiyinə görə tamamilə silinib.",
  };
  return messages[errorCode] || (isEn ? "Google sign-in could not be completed." : "Google ilə giriş tamamlana bilmədi.");
}

function googleSignInButton() {
  const wrapper = document.createElement("div");
  wrapper.className = "google-auth-wrapper";

  const target = document.createElement("div");
  target.className = "google-auth-button";

  wrapper.appendChild(target);

  const renderGoogleButton = async () => {
    if (!wrapper.isConnected) return;
    if (!window.google?.accounts?.id) {
      setTimeout(renderGoogleButton, 100);
      return;
    }

    if (!runtimeGoogleClientId) {
      await loadAuthConfig();
    }

    if (!runtimeGoogleClientId) return;

    try {
      {
        currentGoogleNonce = (await request("/api/auth/google/nonce", { method: "POST", body: JSON.stringify({}) })).nonce;
        google.accounts.id.initialize({
          client_id: runtimeGoogleClientId,
          nonce: currentGoogleNonce,
          callback: handleGoogleCredential,
          ux_mode: "popup",
        });
        initializedGoogleClientId = runtimeGoogleClientId;
      }

      google.accounts.id.renderButton(target, googleButtonOptions());
    } catch (err) {
      console.warn("Google Sign-In button render error:", err);
    }
  };

  requestAnimationFrame(renderGoogleButton);

  return wrapper;
}

function renderLogin() {
  document.title = `${t("auth.login.title")} — Helmer Workspace`;

  const content = shell(
    t("auth.login.title"),
    t("auth.login.subtitle")
  );

  const { form, submit } = formBase(t("auth.login.submitBtn"));

  const isEn = getLanguage() === "en";
  form.append(
    field({
      label: t("auth.login.identifierLabel"),
      name: "identifier",
      autocomplete: "username",
      placeholder: isEn ? "name@company.com or username" : "ad@sirket.az və ya username",
    }),
    field({
      label: t("auth.login.passwordLabel"),
      name: "password",
      type: "password",
      autocomplete: "current-password",
      placeholder: isEn ? "Your password" : "Şifrən",
    }),
  );

  const helpers = document.createElement("div");
  helpers.className = "auth-form-helpers";
  helpers.append(
    document.createElement("span"),
    linkButton(t("auth.login.forgotPasswordLink"), "/forgot-password"),
  );

  form.append(helpers, submit);

  const divider = authDivider(isEn ? "or" : "və ya");

  form.append(
    divider,
    googleSignInButton(),
  );

  const switcher = document.createElement("p");
  switcher.className = "auth-switch";
  switcher.append(
    `${t("auth.login.noAccountPrompt")} `,
    linkButton(t("auth.login.signupLink"), "/signup"),
  );

  form.append(
    switcher,
    guestAccessButton(),
    legalNoticeElement(),
  );

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    setFormError(form, "");
    submitState(submit, true, t("auth.login.submitBtn"));

    try {
      const data = await request("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({
          identifier: form.identifier.value,
          password: form.password.value,
        }),
      });

      if (data.restoredFromPendingDeletion) {
        window.dispatchEvent(new CustomEvent("helmer:account-restored"));
      }
      await completeAuthentication(data.user);
    } catch (error) {
      if (error.code === "EMAIL_VERIFICATION_REQUIRED" && error.email) {
        route(`/verify-email?email=${encodeURIComponent(error.email)}&cooldown=${encodeURIComponent(error.resendAfterSeconds || 0)}`);
        renderRoute();
        return;
      }
      setFormError(form, error.message);
      submitState(submit, false, t("auth.login.submitBtn"));
    }
  });

  content.appendChild(form);
  const oauthError = new URLSearchParams(location.search).get("error");
  if (oauthError) {
    setFormError(form, resolveOAuthErrorMessage(oauthError));
  }

  setTimeout(() => form.identifier.focus(), 0);
}

function renderSignup() {
  document.title = `${t("auth.signup.title")} — Helmer Workspace`;
  const isEn = getLanguage() === "en";
  const content = shell(t("auth.signup.title"), t("auth.signup.subtitle"), {
    stepBadge: t("auth.signup.stepBadge") || (isEn ? "Step 1 of 3 · Account Details" : "Addım 1 / 3 · Hesab məlumatları"),
  });
  const { form, submit } = formBase(t("auth.signup.submitBtn"));
  const fullName = field({ label: t("auth.signup.fullNameLabel"), name: "fullName", autocomplete: "name", placeholder: isEn ? "Full Name" : "Ad və Soyad" });
  const username = field({ label: t("auth.signup.usernameLabel"), name: "username", autocomplete: "username", placeholder: isEn ? "marketer" : "marketoloq" });
  username.classList.add("auth-username-field");
  const usernamePrefix = document.createElement("span");
  usernamePrefix.className = "auth-username-prefix";
  usernamePrefix.textContent = "@";
  username.querySelector(".auth-input-wrap").prepend(usernamePrefix);
  const email = field({ label: t("auth.signup.emailLabel"), name: "email", type: "email", autocomplete: "email", placeholder: isEn ? "name@company.com" : "ad@sirket.az" });
  const password = field({ label: t("auth.signup.passwordLabel"), name: "password", type: "password", autocomplete: "new-password", placeholder: isEn ? "At least 10 characters" : "Ən azı 10 simvol" });

  const ageConsentRow = document.createElement("label");
  ageConsentRow.className = "auth-age-consent";
  ageConsentRow.style.cssText = "display:flex;align-items:flex-start;gap:10px;margin:6px 0 4px;font-size:12.5px;line-height:1.45;color:var(--text-secondary,#475569);cursor:pointer;user-select:none;";
  const ageCheckbox = document.createElement("input");
  ageCheckbox.type = "checkbox";
  ageCheckbox.name = "ageConfirmed";
  ageCheckbox.required = true;
  ageCheckbox.style.cssText = "margin-top:2px;width:15px;height:15px;flex-shrink:0;accent-color:var(--accent,#4f6ee8);cursor:pointer;";
  const ageText = document.createElement("span");
  ageText.textContent = isEn
    ? "I confirm that I am at least 18 years old and agree to the Terms of Service and Privacy Policy."
    : "Ən azı 18 yaşımın olduğunu təsdiqləyirəm, İstifadə Şərtləri və Məxfilik Siyasəti ilə razıyam.";
  ageConsentRow.append(ageCheckbox, ageText);

  form.append(fullName, username, email, password, ageConsentRow, submit);

  const divider = authDivider(isEn ? "or" : "və ya");

  form.append(
    divider,
    googleSignInButton(),
  );
  const availability = username.querySelector("small");
  let timer;
  let isUsernameAvailable = null;
  form.username.addEventListener("input", () => {
    clearTimeout(timer);
    const clean = form.username.value.trim().replace(/^@+/, "");
    if (!clean) {
      availability.className = "auth-field-hint";
      availability.textContent = "";
      isUsernameAvailable = null;
      return;
    }
    availability.className = "auth-field-hint";
    availability.textContent = isEn ? "Checking…" : "Yoxlanılır…";
    timer = setTimeout(async () => {
      try {
        const data = await request(`/api/auth/username-availability?username=${encodeURIComponent(clean)}`);
        if (!data.valid) {
          availability.textContent = data.error || (isEn ? "3–30 chars · letters, numbers, dot, underscore" : "3–30 simvol · hərf, rəqəm, nöqtə və alt xətt");
          availability.className = "auth-field-hint is-invalid";
          isUsernameAvailable = false;
        } else if (data.available) {
          availability.textContent = isEn ? `@${clean.toLowerCase()} is available` : `@${clean.toLowerCase()} istifadəyə uyğundur`;
          availability.className = "auth-field-hint is-valid";
          isUsernameAvailable = true;
        } else {
          availability.textContent = isEn ? "This username is already taken" : "Bu istifadəçi adı artıq götürülüb";
          availability.className = "auth-field-hint is-invalid";
          isUsernameAvailable = false;
        }
      } catch {
        availability.textContent = "";
      }
    }, 250);
  });

  const switcher = document.createElement("p");
  switcher.className = "auth-switch";
  switcher.append(`${t("auth.signup.hasAccountPrompt")} `, linkButton(t("auth.signup.loginLink"), "/login"));

  form.append(switcher, guestAccessButton(), legalNoticeElement());

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!ageCheckbox.checked) {
      setFormError(
        form,
        isEn
          ? "You must confirm that you are at least 18 years old and accept the Terms of Service."
          : "Qeydiyyat üçün ən azı 18 yaşınızın olduğunu və İstifadə Şərtlərini təsdiqləməlisiniz.",
      );
      return;
    }
    if (isUsernameAvailable === false) {
      setFormError(form, isEn ? "This username is already taken. Please choose another." : "Bu istifadəçi adı artıq götürülüb. Başqa ad seç.", "username");
      return;
    }
    setFormError(form, "");
    submitState(submit, true, t("auth.signup.submitBtn"));
    
    try {
      const formData = Object.fromEntries(new FormData(form));
      formData.username = String(formData.username || "").trim().replace(/^@+/, "");
      formData.language = getLanguage();
      formData.ageConfirmed = true;
      const data = await request("/api/auth/signup", {
        method: "POST",
        body: JSON.stringify(formData),
      });
      if (data.verificationRequired && data.email) {
        const delivery = data.deliveryPending ? "&delivery=pending" : "";
        const cooldown = `&cooldown=${encodeURIComponent(data.resendAfterSeconds || 0)}`;
        route(`/verify-email?email=${encodeURIComponent(data.email)}${delivery}${cooldown}`);
        renderRoute();
        return;
      }
      throw new Error(isEn ? "Could not initiate verification process." : "Təsdiq prosesini başlatmaq mümkün olmadı.");
    } catch (error) {
      setFormError(form, error.message, error.field);
      submitState(submit, false, t("auth.signup.submitBtn"));
    }
  });
  content.appendChild(form);
  setTimeout(() => form.fullName.focus(), 0);
}

function renderEmailVerification() {
  document.title = `${t("auth.verifyEmail.title")} — Helmer Workspace`;
  const isEn = getLanguage() === "en";
  const email = new URLSearchParams(location.search).get("email") || "";
  const deliveryPending = new URLSearchParams(location.search).get("delivery") === "pending";
  const requestedCooldown = Number(new URLSearchParams(location.search).get("cooldown"));
  const content = shell(t("auth.verifyEmail.title"), t("auth.verifyEmail.subtitle", { email: email || (isEn ? "your email" : "e-poçtunuza") }));
  const { form, submit } = formBase(t("auth.verifyEmail.submitBtn"));
  const emailField = field({ label: t("auth.signup.emailLabel"), name: "email", type: "email", autocomplete: "email", placeholder: isEn ? "name@company.com" : "ad@sirket.az" });
  emailField.querySelector("input").value = email;
  const codeField = field({ label: t("auth.verifyEmail.codeLabel"), name: "code", autocomplete: "one-time-code", placeholder: "123456", hint: isEn ? "Code is valid for 10 minutes." : "Kod 10 dəqiqə ərzində etibarlıdır." });
  const codeInput = codeField.querySelector("input");
  codeInput.inputMode = "numeric";
  codeInput.maxLength = 6;
  codeInput.pattern = "[0-9]{6}";
  form.append(emailField, codeField, submit);

  const resend = document.createElement("button");
  resend.type = "button";
  resend.className = "auth-resend-button";
  const resendHint = document.createElement("span");
  resendHint.className = "auth-resend-hint";
  const startResendCooldown = (seconds = 60) => {
    const endsAt = Date.now() + Math.max(0, seconds) * 1000;
    const update = () => {
      const remaining = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
      const minutes = Math.floor(remaining / 60);
      const secondsPart = remaining % 60;
      resend.disabled = remaining > 0;
      const resendText = t("auth.verifyEmail.resendBtn");
      resend.textContent = remaining > 0 ? `${resendText} · ${minutes}:${String(secondsPart).padStart(2, "0")}` : resendText;
      resendHint.textContent = remaining > 0 ? (isEn ? "Please wait before requesting a new code" : "Yeni kod üçün qısa gözləmə") : (isEn ? "Didn't receive the code? Resend." : "Kod gəlməyibsə, yenidən göndər.");
      if (remaining > 0) window.setTimeout(update, 1000);
    };
    update();
  };
  startResendCooldown(Number.isFinite(requestedCooldown) ? Math.min(60, Math.max(0, requestedCooldown)) : 0);
  resend.addEventListener("click", async () => {
    setFormError(form, "");
    resend.disabled = true;
    try {
      const data = await request("/api/auth/email-verification/resend", {
        method: "POST",
        body: JSON.stringify({ email: form.email.value }),
      });
      resendHint.textContent = data.message || t("auth.verifyEmail.resendSuccess");
      startResendCooldown(60);
    } catch (error) {
      if (error.code === "EMAIL_VERIFICATION_COOLDOWN") {
        startResendCooldown(error.resendAfterSeconds || 60);
      } else {
        setFormError(form, error.message, "email");
        resend.disabled = false;
      }
    }
  });
  const resendWrap = document.createElement("div");
  resendWrap.className = "auth-resend";
  resendWrap.append(resend, resendHint);
  const switcher = document.createElement("div");
  switcher.className = "auth-switch";
  switcher.append(resendWrap, linkButton(isEn ? "Back to sign in" : "Daxil olmağa qayıt", "/login"));
  form.append(switcher);
  if (deliveryPending) {
    setFormError(form, isEn ? "Account created, but verification email could not be sent. Please click Resend Code." : "Hesab yaradıldı, amma kod göndərilmədi. Aşağıdakı düymə ilə yenidən göndər.");
  }
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    setFormError(form, "");
    if (!/^\d{6}$/.test(form.code.value.trim())) return setFormError(form, isEn ? "Enter the 6-digit verification code." : "6 rəqəmli təsdiq kodunu daxil et.", "code");
    submitState(submit, true, t("auth.verifyEmail.submitting"));
    try {
      const data = await request("/api/auth/email-verification/confirm", {
        method: "POST",
        body: JSON.stringify({ email: form.email.value, code: form.code.value.trim() }),
      });
      await completeAuthentication(data.user);
    } catch (error) {
      setFormError(form, error.message, error.code === "INVALID_EMAIL_VERIFICATION_CODE" ? "code" : "email");
      submitState(submit, false, t("auth.verifyEmail.submitBtn"));
    }
  });
  content.appendChild(form);
  setTimeout(() => (email ? codeInput : form.email).focus(), 0);
}

function renderForgot() {
  document.title = `${t("auth.forgotPassword.title")} — Helmer Workspace`;
  const isEn = getLanguage() === "en";
  const content = shell(t("auth.forgotPassword.title"), t("auth.forgotPassword.subtitle"));
  const { form, submit } = formBase(t("auth.forgotPassword.submitBtn"));
  form.append(field({ label: t("auth.forgotPassword.emailLabel"), name: "email", type: "email", autocomplete: "email", placeholder: isEn ? "name@company.com" : "ad@sirket.az" }), submit);
  const back = document.createElement("p");
  back.className = "auth-switch";
  back.append(linkButton(isEn ? "← Back to sign in" : "← Daxil olmağa qayıt", "/login"));
  form.append(back);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    submitState(submit, true, t("auth.forgotPassword.submitting"));
    try {
      const data = await request("/api/auth/forgot-password", { method: "POST", body: JSON.stringify({ email: form.email.value }) });
      form.replaceChildren();
      const done = document.createElement("div");
      done.className = "auth-success";
      const checkIcon = document.createElement("span");
      checkIcon.textContent = "✓";
      const heading = document.createElement("h3");
      heading.textContent = isEn ? "Check your email" : "E-poçtunu yoxla";
      const notice = document.createElement("p");
      notice.textContent = data.message || t("auth.forgotPassword.sentNotice");
      done.append(checkIcon, heading, notice, linkButton(isEn ? "Back to sign in" : "Daxil olmağa qayıt", "/login"));
      form.appendChild(done);
    } catch (error) {
      setFormError(form, error.message);
      submitState(submit, false, t("auth.forgotPassword.submitBtn"));
    }
  });
  content.appendChild(form);
}

function renderReset() {
  document.title = `${t("auth.resetPassword.title")} — Helmer Workspace`;
  const isEn = getLanguage() === "en";
  const content = shell(t("auth.resetPassword.title"), t("auth.resetPassword.subtitle"));
  const token = new URLSearchParams(location.search).get("token") || "";
  const { form, submit } = formBase(t("auth.resetPassword.submitBtn"));
  form.append(
    field({ label: t("auth.resetPassword.newPasswordLabel"), name: "password", type: "password", autocomplete: "new-password", placeholder: isEn ? "At least 10 characters" : "Ən azı 10 simvol", hint: isEn ? "At least 10 characters with letters and numbers" : "Ən azı 10 simvol, bir hərf və bir rəqəm" }),
    field({ label: t("auth.resetPassword.confirmPasswordLabel"), name: "confirmPassword", type: "password", autocomplete: "new-password", placeholder: isEn ? "Re-enter new password" : "Yeni şifrəni təkrar yaz" }),
    submit,
  );
  const newLink = document.createElement("p");
  newLink.className = "auth-switch";
  newLink.append(linkButton(isEn ? "Request new reset link" : "Yeni bərpa keçidi istə", "/forgot-password"));
  form.appendChild(newLink);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    setFormError(form, "");
    if (form.password.value !== form.confirmPassword.value) {
      return setFormError(form, isEn ? "Passwords do not match." : "Yeni şifrələr eyni deyil.", "confirmPassword");
    }
    submitState(submit, true, t("auth.resetPassword.submitting"));
    try {
      await request("/api/auth/reset-password", { method: "POST", body: JSON.stringify({ token, password: form.password.value }) });
      form.replaceChildren();
      const done = document.createElement("div");
      done.className = "auth-success";
      const checkIcon = document.createElement("span");
      checkIcon.textContent = "✓";
      const heading = document.createElement("h3");
      heading.textContent = isEn ? "Password Updated" : "Şifrə yeniləndi";
      const notice = document.createElement("p");
      notice.textContent = t("auth.resetPassword.successNotice");
      done.append(checkIcon, heading, notice, linkButton(t("auth.login.title"), "/login"));
      form.appendChild(done);
    } catch (error) {
      setFormError(form, error.message);
      submitState(submit, false, t("auth.resetPassword.submitBtn"));
    }
  });
  content.appendChild(form);
}

function renderOnboarding(user) {
  const isEn = getLanguage() === "en";
  document.title = `${isEn ? "Personalization" : "Fərdiləşdirmə"} — Helmer Workspace`;
  appShell.hidden = true;
  authRoot.hidden = false;
  document.body.classList.remove("auth-loading");
  document.body.classList.add("auth-active");

  const firstName = (user?.fullName || "").trim().split(/\s+/)[0] || (isEn ? "Leader" : "Lider");
  const welcomeTitle = isEn ? `Welcome, ${firstName}` : `Salam, ${firstName}`;
  const subtitle = t("auth.onboarding.subtitle") || (isEn ? "Briefly tailor Helmer to your workflow." : "Helmer-i iş axınınıza uyğunlaşdırmaq üçün qısa məlumat verin.");

  const content = shell(
    welcomeTitle,
    subtitle,
    {
      stepBadge: t("auth.onboarding.stepBadge") || (isEn ? "Step 2 of 3 · Personalization" : "Addım 2 / 3 · Fərdiləşdirmə"),
      wide: true,
    }
  );

  const form = document.createElement("form");
  form.className = "auth-form onboarding-form";

  const errorBox = document.createElement("div");
  errorBox.className = "auth-error";
  errorBox.setAttribute("role", "alert");
  errorBox.hidden = true;
  form.appendChild(errorBox);

  // Group 1: Role / Industry selection
  const roleGroup = document.createElement("div");
  roleGroup.className = "onboarding-group";

  const roleLabel = document.createElement("div");
  roleLabel.className = "onboarding-label";
  roleLabel.textContent = t("auth.onboarding.roleLabel") || (isEn ? "1. Your role or field:" : "1. Rol və ya fəaliyyət sahəniz:");
  roleGroup.appendChild(roleLabel);

  const roleGrid = document.createElement("div");
  roleGrid.className = "onboarding-grid onboarding-grid-roles";

  const roleOptions = [
    {
      key: "marketing",
      title: t("auth.onboarding.roles.marketing.title") || (isEn ? "Marketing" : "Marketinq"),
      desc: t("auth.onboarding.roles.marketing.desc") || (isEn ? "Digital marketing, brand & growth" : "Rəqəmsal marketinq, brend və böyümə"),
    },
    {
      key: "startup",
      title: t("auth.onboarding.roles.startup.title") || (isEn ? "Startup / Founder" : "Startap / Təsisçi"),
      desc: t("auth.onboarding.roles.startup.desc") || (isEn ? "Product development & go-to-market" : "Məhsul inkişafı və bazar açılışı"),
    },
    {
      key: "business",
      title: t("auth.onboarding.roles.business.title") || (isEn ? "Business Management" : "Biznes İdarəetmə"),
      desc: t("auth.onboarding.roles.business.desc") || (isEn ? "Leadership, operations & strategy" : "Rəhbərlik, əməliyyatlar və strategiya"),
    },
    {
      key: "ecommerce",
      title: t("auth.onboarding.roles.ecommerce.title") || (isEn ? "E-Commerce" : "E-ticarət"),
      desc: t("auth.onboarding.roles.ecommerce.desc") || (isEn ? "Online store, retail & direct sales" : "Onlayn mağaza, satış və pərakəndə"),
    },
    {
      key: "freelance",
      title: t("auth.onboarding.roles.freelance.title") || (isEn ? "Freelance" : "Freelance"),
      desc: t("auth.onboarding.roles.freelance.desc") || (isEn ? "Independent consultant or agency" : "Müstəqil mütəxəssis və ya agentlik"),
    },
    {
      key: "other",
      title: t("auth.onboarding.roles.other.title") || (isEn ? "Other" : "Digər"),
      desc: t("auth.onboarding.roles.other.desc") || (isEn ? "Other custom domain or project" : "Fərqli fəaliyyət sahəsi və ya layihə"),
    },
  ];

  roleOptions.forEach((opt, idx) => {
    const label = document.createElement("label");
    label.className = "onboarding-card";

    const input = document.createElement("input");
    input.type = "radio";
    input.name = "role";
    input.value = opt.title;
    if (idx === 0) input.checked = true;

    const cardInner = document.createElement("span");
    cardInner.className = "onboarding-card-inner";

    const cardHeader = document.createElement("span");
    cardHeader.className = "onboarding-card-header";

    const titleEl = document.createElement("strong");
    titleEl.textContent = opt.title;

    const checkIndicator = document.createElement("span");
    checkIndicator.className = "onboarding-card-check";
    checkIndicator.setAttribute("aria-hidden", "true");

    cardHeader.append(titleEl, checkIndicator);

    const descEl = document.createElement("small");
    descEl.textContent = opt.desc;

    cardInner.append(cardHeader, descEl);
    label.append(input, cardInner);
    roleGrid.appendChild(label);
  });

  roleGroup.appendChild(roleGrid);
  form.appendChild(roleGroup);

  // Group 2: Primary Goal / Use Case selection
  const goalGroup = document.createElement("div");
  goalGroup.className = "onboarding-group";

  const goalLabel = document.createElement("div");
  goalLabel.className = "onboarding-label";
  goalLabel.textContent = t("auth.onboarding.goalLabel") || (isEn ? "2. Primary purpose / goal:" : "2. Əsas istifadə məqsədiniz:");
  goalGroup.appendChild(goalLabel);

  const goalGrid = document.createElement("div");
  goalGrid.className = "onboarding-grid onboarding-grid-goals";

  const goalOptions = [
    {
      key: "strategy",
      title: t("auth.onboarding.goals.strategy.title") || (isEn ? "Build Strategy" : "Strategiya qurmaq"),
      desc: t("auth.onboarding.goals.strategy.desc") || (isEn ? "Market analysis, positioning & roadmap" : "Bazar analizi, mövqelənmə və yol xəritəsi"),
    },
    {
      key: "content",
      title: t("auth.onboarding.goals.content.title") || (isEn ? "Create Content" : "Məzmun yaratmaq"),
      desc: t("auth.onboarding.goals.content.desc") || (isEn ? "Campaign concepts & creative messaging" : "Kampaniya konsepsiyaları və kreativ mesajlar"),
    },
    {
      key: "execution",
      title: t("auth.onboarding.goals.execution.title") || (isEn ? "Execution & Analytics" : "İcra və analiz"),
      desc: t("auth.onboarding.goals.execution.desc") || (isEn ? "Task execution, KPIs & performance tracking" : "Tapşırıqların icrası, KPI və nəticələrin analizi"),
    },
  ];

  goalOptions.forEach((opt, idx) => {
    const label = document.createElement("label");
    label.className = "onboarding-card";

    const input = document.createElement("input");
    input.type = "radio";
    input.name = "goal";
    input.value = opt.title;
    input.dataset.focus = opt.key;
    if (idx === 0) input.checked = true;

    const cardInner = document.createElement("span");
    cardInner.className = "onboarding-card-inner";

    const cardHeader = document.createElement("span");
    cardHeader.className = "onboarding-card-header";

    const titleEl = document.createElement("strong");
    titleEl.textContent = opt.title;

    const checkIndicator = document.createElement("span");
    checkIndicator.className = "onboarding-card-check";
    checkIndicator.setAttribute("aria-hidden", "true");

    cardHeader.append(titleEl, checkIndicator);

    const descEl = document.createElement("small");
    descEl.textContent = opt.desc;

    cardInner.append(cardHeader, descEl);
    label.append(input, cardInner);
    goalGrid.appendChild(label);
  });

  goalGroup.appendChild(goalGrid);
  form.appendChild(goalGroup);

  // Action Buttons: Continue & Skip
  const actions = document.createElement("div");
  actions.className = "onboarding-actions";

  const submit = document.createElement("button");
  submit.type = "submit";
  submit.className = "auth-submit";
  submit.textContent = t("auth.onboarding.continueBtn") || (isEn ? "Continue to Workspace" : "Davam et");

  const skipBtn = document.createElement("button");
  skipBtn.type = "button";
  skipBtn.className = "auth-skip-btn";
  skipBtn.textContent = t("auth.onboarding.skipBtn") || (isEn ? "Skip for now" : "Keç");

  actions.append(submit, skipBtn);
  form.appendChild(actions);

  skipBtn.addEventListener("click", async () => {
    skipBtn.disabled = true;
    submit.disabled = true;
    submitState(submit, true, isEn ? "Loading…" : "Keçid edilir…");
    try {
      const data = await request("/api/auth/onboarding", {
        method: "POST",
        body: JSON.stringify({ skipped: true }),
      });
      renderWorkspaceOverview(data.user);
    } catch (error) {
      setFormError(form, error.message);
      submitState(submit, false, t("auth.onboarding.continueBtn") || (isEn ? "Continue to Workspace" : "Davam et"));
      skipBtn.disabled = false;
    }
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    setFormError(form, "");
    submitState(submit, true, t("auth.onboarding.submitting") || (isEn ? "Saving…" : "Yadda saxlanılır…"));
    skipBtn.disabled = true;

    try {
      const selectedRole = form.role.value;
      const selectedGoalInput = form.querySelector('input[name="goal"]:checked');
      const selectedGoal = selectedGoalInput ? selectedGoalInput.value : "";
      const selectedFocus = selectedGoalInput?.dataset?.focus || "business";

      const data = await request("/api/auth/onboarding", {
        method: "POST",
        body: JSON.stringify({
          role: selectedRole,
          goal: selectedGoal,
          focus: selectedFocus,
        }),
      });
      renderWorkspaceOverview(data.user);
    } catch (error) {
      setFormError(form, error.message);
      submitState(submit, false, t("auth.onboarding.continueBtn") || (isEn ? "Continue to Workspace" : "Davam et"));
      skipBtn.disabled = false;
    }
  });

  content.appendChild(form);
}

function renderWorkspaceOverview(user) {
  const isEn = getLanguage() === "en";
  document.title = `${t("auth.overview.title") || (isEn ? "Welcome to Helmer Workspace" : "Helmer Workspace-ə xoş gəldiniz")} — Helmer Workspace`;
  appShell.hidden = true;
  authRoot.hidden = false;
  document.body.classList.remove("auth-loading");
  document.body.classList.add("auth-active");

  const content = shell(
    t("auth.overview.title") || (isEn ? "Welcome to Helmer Workspace" : "Helmer Workspace-ə xoş gəldiniz"),
    t("auth.overview.subtitle") || (isEn ? "Strategic management, AI execution, and unified workflows in one place." : "Strateji idarəetmə, süni intellektlə icra və güclü iş axını bir məkanda."),
    {
      stepBadge: t("auth.overview.stepBadge") || (isEn ? "Step 3 of 3 · Workspace Overview" : "Addım 3 / 3 · Workspace İcmalı"),
      wide: true,
    }
  );

  const container = document.createElement("div");
  container.className = "onboarding-overview-container";

  const grid = document.createElement("div");
  grid.className = "onboarding-overview-grid";

  const cardsData = [
    {
      key: "strategy",
      svg: `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/></svg>`,
      title: t("auth.overview.cards.strategy.title") || (isEn ? "Strategic Management" : "Strateji İdarəetmə"),
      desc: t("auth.overview.cards.strategy.desc") || (isEn ? "Clear business objectives, market research, competitive insights, and step-by-step growth roadmaps." : "Dəqiq biznes hədəfləri, bazar analizi, rəqib araşdırması və addım-addım böyümə yol xəritələri."),
    },
    {
      key: "execution",
      svg: `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>`,
      title: t("auth.overview.cards.execution.title") || (isEn ? "AI-Powered Execution" : "Süni İntellektlə İcra"),
      desc: t("auth.overview.cards.execution.desc") || (isEn ? "AI-powered deep copilot for rapid campaign concepts, creative copy, and execution." : "Dərin süni intellekt kopiloti, avtomatlaşdırılmış kampaniyalar və sürətli kreativ məzmun."),
    },
    {
      key: "workflow",
      svg: `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg>`,
      title: t("auth.overview.cards.workflow.title") || (isEn ? "Unified Workflows" : "Vahid İş Axını"),
      desc: t("auth.overview.cards.workflow.desc") || (isEn ? "Built-in task planner, instant PDF/DOCX exports, and real-time performance tracking." : "Tapşırıq planlayıcısı, PDF/DOCX sənəd ixracı və real-vaxt performans nəticələri."),
    },
  ];

  cardsData.forEach((item) => {
    const card = document.createElement("div");
    card.className = "onboarding-overview-card";

    const iconBox = document.createElement("div");
    iconBox.className = "onboarding-overview-icon";
    iconBox.setAttribute("aria-hidden", "true");
    iconBox.insertAdjacentHTML("beforeend", item.svg);

    const titleEl = document.createElement("strong");
    titleEl.className = "onboarding-overview-title";
    titleEl.textContent = item.title;

    const descEl = document.createElement("p");
    descEl.className = "onboarding-overview-desc";
    descEl.textContent = item.desc;

    card.append(iconBox, titleEl, descEl);
    grid.appendChild(card);
  });

  const actions = document.createElement("div");
  actions.className = "onboarding-overview-actions";

  const enterBtn = document.createElement("button");
  enterBtn.type = "button";
  enterBtn.className = "auth-submit onboarding-enter-btn";
  enterBtn.textContent = t("auth.overview.enterBtn") || (isEn ? "Enter Workspace" : "Workspace-ə daxil ol");

  enterBtn.addEventListener("click", async () => {
    enterBtn.disabled = true;
    submitState(enterBtn, true, isEn ? "Entering…" : "Daxil olunur…");
    authRoot.hidden = true;
    appShell.hidden = false;
    document.body.classList.remove("auth-loading", "auth-active");
    route(pendingReturnPath, true);
    await authenticatedCallback?.(user);
  });

  actions.appendChild(enterBtn);
  container.append(grid, actions);
  content.appendChild(container);
}

function renderRoute() {
  const path = location.pathname;
  if (!AUTH_PATHS.has(path)) {
    if (appShell.hidden) {
      appShell.hidden = false;
      authRoot.hidden = true;
      document.body.classList.remove("auth-loading");
      document.body.classList.remove("auth-active");
    }
    return;
  }
  appShell.hidden = true;
  authRoot.hidden = false;
  document.body.classList.remove("auth-loading");
  document.body.classList.add("auth-active");
  if (path === "/signup" || path === "/register") {
    if (path === "/register") route(`/signup${location.search}`, true);
    return renderSignup();
  }
  if (path === "/forgot-password") return renderForgot();
  if (path === "/reset-password") return renderReset();
  if (path === "/verify-email") return renderEmailVerification();
  if (path !== "/login") route(`/login${location.search}`, true);
  return renderLogin();
}

export async function initializeAuthentication(onAuthenticated) {
  authenticatedCallback = onAuthenticated;
  loadAuthConfig().catch(() => {});
  const requestedReturn = new URLSearchParams(location.search).get("returnTo");
  pendingReturnPath = requestedReturn
    ? safeInternalPath(requestedReturn === "/" ? "/workspace" : requestedReturn)
    : AUTH_PATHS.has(location.pathname)
      ? "/workspace"
      : safeInternalPath(`${location.pathname}${location.search}${location.hash}`);
  window.addEventListener("popstate", renderRoute);
  window.addEventListener("helmer:auth-required", () => {
    pendingReturnPath = safeInternalPath(`${location.pathname}${location.search}${location.hash}`);
    route(`/login?returnTo=${encodeURIComponent(pendingReturnPath)}`, true);
    renderRoute();
  });
  window.addEventListener("helmer:language-change", () => {
    if (AUTH_PATHS.has(location.pathname)) {
      renderRoute();
    }
  });
  if (AUTH_PATHS.has(location.pathname)) {
    try {
      const data = await request("/api/auth/me");
      if (data?.user) {
        if (pendingReturnPath && (pendingReturnPath === "/admin" || pendingReturnPath.startsWith("/admin/") || pendingReturnPath.startsWith("/admin?"))) {
          window.location.href = pendingReturnPath;
          return;
        }
        await completeAuthentication(data.user);
        return;
      }
    } catch {}
    renderRoute();
    return;
  }
  try {
    const data = await request("/api/auth/me");
    await completeAuthentication(data.user);
  } catch {
    await enterGuestWorkspace();
  }
}

export async function logout() {
  try { localStorage.removeItem("helmer_bg_jobs"); } catch {}
  try {
    sessionStorage.removeItem("helmer_active_ask_chat");
    sessionStorage.removeItem("helmer_planner_visit_notif_shown");
  } catch {}
  try { window.google?.accounts?.id?.disableAutoSelect?.(); } catch {}
  window.dispatchEvent(new CustomEvent("helmer:logout"));
  await request("/api/auth/logout", { method: "POST", body: "{}" }).catch(() => {});
  route("/login", true);
  renderRoute();
}

export { request as authRequest };
