# Security Policy & Operational Protocols

## Reporting Security Issues

If you discover a security vulnerability within Helmer / Marketify.ai, please send an email to the security team or repository administrator. Please do not disclose vulnerabilities publicly until they have been patched.

---

# Helmer Security, Architecture, and Code Integrity Rules

These directives are MANDATORY and NON-NEGOTIABLE across all coding, refactoring, feature implementation, and deployment sessions in the Helmer project. Any deviation, simplification, or shortcut is strictly forbidden.

---

### ARCHITECTURAL BASELINE ANCHOR
- **Reference Commit**: `43f22a2`
- **Baseline Invariant**: The codebase state at commit `43f22a2` is the immutable architectural benchmark. When adding features, refactoring, or optimizing, strictly preserve the patterns, defensive pipelines, multi-replica consistency, and tenant isolation established in this commit. If in doubt about an implementation detail, inspect the patterns from commit `43f22a2`.
- **Zero Guard Truncation**: You are strictly FORBIDDEN from omitting, simplifying, or commenting out existing validation checks, locks, abort handlers, or security guards during refactoring. Every defensive check in the original code must persist.
- **No Unauthorized Dependencies**: Do not introduce new external npm packages (especially networking, HTTP, or alternate parsing libraries) without explicit confirmation. Rely strictly on verified internal utilities.

---

### 1. Mandatory Pre-Commit & Verification Gates
- **Security Diff Review**: Before every git commit, perform a full security review. Verify that no secrets, credentials, API keys, private tokens, debug routes, or bypass flags (`DEBUG=true`, bypassed guards) exist or are staged.
- **Strict Verification Gate**: Before declaring any task, feature, refactor, or commit complete, run `npm run check` and `npm test`. All tests must pass (100%). Any failure, type error, or syntax mismatch blocks completion immediately.
- **Error Hygiene (No Leaks)**: Never expose raw database errors, stack traces, or internal error messages in API responses. Log details internally and return sanitized, generic error payloads to clients.

---

### 2. Strict Validation & Mass Assignment Prevention
- **Strict Schema Enforcement**: Every mutation route (`POST`, `PATCH`, `PUT`) MUST validate incoming JSON payloads using Zod `.strict()`. Reject unknown fields unconditionally.
- **No Direct Object Spreading**: Never spread `...req.body` or `...changes` directly over persistent data models.
- **Protected Core Fields**: Core system fields (`id`, `ownerId`, `createdAt`, `passwordHash`, `role`, `emailVerifiedAt`, `googleSub`, `googleEmail`, `emailCustomisedAt`, `pendingEmail`, `pendingEmailExpiresAt`, `authVersion`, `privacyEpoch`, `mfa`) MUST be strictly guarded at the repository layer (`FileUserRepository.update`) against external modification unless `allowSystemFields: true` is explicitly passed by trusted internal auth workflows. Whitelist updatable fields explicitly. Changing `email` automatically resets `emailVerifiedAt` to `null` (unless `allowSystemFields && preserveEmailVerification` is passed after cryptographic verification) and increments `authVersion`.

---

### 3. Multi-Tenancy, Storage, Multi-Replica Consistency & IDOR Prevention
- **Tenant Sharding**: Strategies, chats, tasks, and telemetry must be partitioned into tenant shards using deterministic SHA-256 hashes (`tenantKey(ownerId)`). Never store multi-tenant records in un-sharded, flat global arrays.
- **Strict Ownership**: Every retrieval, mutation, or deletion query MUST enforce `ownerId === req.ownerId` (or `req.user.id`). Raw resource IDs must never be queried without scoped tenant verification.
- **Input Validation**: All incoming resource IDs (`chatId`, `strategyId`, `taskId`, `jobId`) must strictly pass UUID regex validation (`/^[0-9a-f-]{36}$/i`).
- **Atomic Concurrency**: All file and cloud state updates must be synchronized through `TenantLockManager` and committed using `writeJsonAtomically`.
- **Multi-Replica Authoritative Revalidation (R2 ETag Conditional Reads)**: `FileAuthStore` (`getSession`, `write`, `mutate`) and `FileUserRepository` (`readStore`, `writeStore`, `mutateUsers`) MUST pass `{ force: true }` to `readR2JsonWithMeta` (`If-None-Match` conditional ETag revalidation) on R2 reads so `logout`, `logout-all`, password resets/changes, and `authVersion` increments take effect immediately across all Cloud Run replicas without stale cache windows.
- **Cross-Account Frontend Workspace & Async State Isolation**:
  - On `helmer:logout`, `helmer:auth-required`, and `helmer:user-changed`, `clearUserScopedWorkspaceState()` MUST increment `state.identityEpoch`, abort all in-flight `AbortController` instances (`currentAbortController`, `currentAskAbortController`, `activeResearchStreams`, `cancelBuildEstimate()`), clear `sessionStorage` (`helmer_active_ask_chat`, `helmer_planner_visit_notif_shown`), clear `window.helmerSecurity.revisions`, and wipe all Build, Ask, Planner, and UP in-memory/DOM state.
  - Every async loader, SSE stream, polling loop, and mutation in `public/script.js` and `public/up.js` (including `requestRefinement`, `saveStrategy`, `ensureStrategyAskContext`, `startAssessment`, `startGeneration`, `autoSaveBackgroundJob`, `resumeBackgroundJobs`, `submitAskMessage`, `regenerateAskMessageWithThinking`, `connectToResearchJobStream`, `pollResearchJob`, Planner & Strategy Archive mutations) MUST capture `(epoch, expectedUserId)` before `await` and verify `!isIdentityStale(epoch, expectedUserId)` before mutating `state` or rendering to the DOM.

---

### 4. AI Execution & Concurrency Control (All Generation Routes)
- **Universal Scope**: Mandatory for `/api/ask`, `/api/strategy`, `/api/up`, and any future generation or streaming endpoints.
- **Per-Tenant Execution Limits**: With Redis admission available, authenticated foreground `POST /api/ask` requests may run in parallel across separate chats. Limit submissions to 15 per owner and 60 per IP in a rolling minute, returning 429 `RATE_LIMITED` with `Retry-After`. Keep one writer per existing chat. Guests, other AI routes, and background research retain exclusive owner admission. An exclusive execution cannot overlap with active Ask work. Reject execution conflicts with 429 `EXECUTION_BUSY`. Keep the execution guard, background-job check, and atomic Redis leases across replicas.
- **Platform-Wide Capacity & Heartbeats**: Enforce global concurrent execution limits and Redis provider slots via atomic Lua scripts and heartbeat lease renewals.
- **Idempotency & Fingerprinting**: All mutating generation endpoints require an `Idempotency-Key` header (`^[A-Za-z0-9_-]{16,100}$`). In Build mode, always compute canonical payload fingerprints (`computePayloadFingerprint`) and reject parameter mismatches with 409 `IDEMPOTENCY_CONFLICT`.
- **Budget Tracking**: Every AI model call must be reserved through `AiPolicy.reserveProvider()` to enforce daily per-user (`AI_USER_DAILY_USD`) and platform (`AI_PLATFORM_DAILY_USD`) micro-dollar spend ceilings.
- **Cancellation**: SSE streaming and generation promises must always wire up `AbortController` to client disconnection events (`req.on("close")`) to immediately release model slots and leases.
- **Privacy Mode (Model Improvement)**: When `user.settings.modelImprovement === false`, interaction logging and telemetry MUST completely redact prompts and outputs (`[Zəruri əməliyyat qeydi - Məzmun ötürülmür]`), set `onlyNecessaryData: true`, and purge training candidates.

---

### 5. Artifact Generation & Tool Execution (Word, Excel, PPTX, PDF)
- **Worker Thread Sandbox**: Document compilation (`renderWord`, `renderExcel`, `renderPowerPoint`, `renderPDF`) must NEVER run on the main Node.js event loop. It must strictly run inside isolated `worker_threads` with strict resource limits (max 256MB memory, <=30s timeout).
- **Zero Arbitrary Code / Zero Shell**: Never introduce `child_process`, `eval()`, `exec`, or dynamic script execution. Artifacts are pure typed data structures built from validated Zod specifications (`spec`).
- **Buffer Pre-Flight Inspection**: Rendered file buffers must pass `validateRenderedFile()` before returning to clients or saving to R2:
  - Block XML External Entities (`<!DOCTYPE`, `<!ENTITY`).
  - Block VBA macros, active scripts, and embedded binary packages.
  - Enforce that external relationship targets strictly use `https://`.
- **Deterministic Storage Keys**: Cloud storage keys must strictly validate against `artifactKey` regex (`/^artifacts\/[a-f0-9]{64}\/[a-f0-9-]{36}\/.../`). Never pass unvalidated file paths to S3/R2 commands.

---

### 6. Research Boundaries, Grounding & Source Chips (Zero SSRF)
- **No Arbitrary Fetch / Scraping**: The server must NEVER perform direct HTTP requests (`fetch`, `axios`) to arbitrary user-supplied URLs.
- **Grounding Exclusivity**: Real-time web research must ONLY be conducted via the official Google Search Grounding tool through the `@google/genai` SDK.
- **Source Filtering & Sanitization**:
  - Filter all search results against `LOW_QUALITY_DOMAINS` and prioritize `HIGH_SIGNAL_DOMAINS`.
  - All web source URLs must be strictly sanitized (`https?://` only) to protect against malicious URL schemes (`javascript:`, `data:`).
  - Linked sources MUST be rendered in a compact chip format directly at the end of the response. Titles and domains must be safely rendered without raw `innerHTML`.
- **Grounding Data Isolation & 2-Year Retention**:
  - Responses grounded with Google Search must NEVER be forwarded to learning loops, telemetry, or subsequent model prompt turns (`isRestricted = true`). Telemetry and learning loop entries for grounded queries must redact interaction content (`onlyNecessaryData: true`).
  - Grounded assistant turns stored in user chat history have a strict maximum retention of 2 years (`MAX_GROUNDED_CHAT_RETENTION_MS`). Stored records older than 2 years must be pruned during store sanitization and tenant maintenance.

---

### 7. Authentication, Google OIDC/PKCE, Admin RBAC & MFA
- **Password Security**: Use Argon2id (OWASP: 19MB RAM, t=2, p=1). Always use `DUMMY_PASSWORD_HASH` on non-existent accounts to eliminate timing side-channels.
- **Token Storage Hygiene**: Plaintext session tokens, reset tokens, and verification codes must NEVER be stored. Always hash them with SHA-256 (`hashOpaqueToken`) before saving or querying.
- **Cookie Security**: Auth and guest cookies must use `HttpOnly`, `SameSite=Lax`, and `Secure` (mandatory in production).
- **Google OAuth 2.0 / OIDC & Account Linking**:
  - Support both Google Identity Services (GIS) ID token verification (`POST /api/auth/google` with single-use `nonce` bound to session/guest owner) and OAuth 2.0 Authorization Code Flow with PKCE (`S256`, `GET/POST /api/auth/google/authorize` and `/api/auth/google/callback` with `HttpOnly` state-binding cookie and open-redirect sanitization via `sanitizeReturnTo`).
  - Verify ID tokens strictly for `iss` (`accounts.google.com` / `https://accounts.google.com`), `aud` (`GOOGLE_CLIENT_ID`), `exp`, `email_verified === true`, and cryptographic `nonce`.
  - Identify Google users primarily by immutable `googleSub` (`findByGoogleSub`) and enforce `googleSub` uniqueness at the repository layer (`create` and `update`).
  - Prohibit unauthenticated email-based automatic account merging (`409 GOOGLE_ACCOUNT_LINK_REQUIRED`); linking a Google identity to an existing account requires an authenticated session of the verified email owner.
  - Track `googleEmail` alongside `emailCustomisedAt` so in-app verified email changes (`PATCH /api/auth/profile` + `POST /api/auth/email-verification/confirm`) are preserved across subsequent Google logins, while Google-side email changes update uncustomised profiles.
- **Session Versioning (`authVersion`)**: Every session stores the user's `authVersion` at creation/rotation. Any password change, email change, or `logout-all` increments `user.authVersion` and revokes sessions; `attachAuthContext` rejects any session whose `session.authVersion !== user.authVersion`.
- **Admin Access & MFA**:
  - Admin API routes (`/admin/api/...`) strictly require both `requireAuth` and `requireAdmin`.
  - TOTP secrets must be encrypted at rest with AES-256-GCM using `userId` as Additional Authenticated Data (AAD).
  - Verify OTP codes with replay attack protection (`afterTimeStep`).
  - Enforce maximum 5-minute MFA session validity for sensitive/export routes, 15-minute for read routes.

---

### 8. Ask Mode Web Search Grounding & Source Chips (Frontend XSS & Sanitization)
- **Grounding Source Chips**: Whenever an Ask mode answer involves web search grounding, the linked sources MUST be rendered in a compact chip format directly at the end of the response.
- **Strict URL Sanitization**: All web source URLs must be strictly sanitized (`https?://` only) to protect against malicious URL schemes (`javascript:`, `data:`).
- **Safe Rendering**: Web source titles and domains must be safely rendered without raw `innerHTML`.
- **Zero Raw HTML Injection**: Never render dynamic user data, database records, or AI outputs via raw `innerHTML`.
- **Safe DOM Construction**: Always sanitize with `escapeHtml(...)` or build nodes safely using `element(...)` / `textContent`.
- **URL Scheme Filtering**: Reject or sanitize unsafe URL schemes (`javascript:`, `data:`, `vbscript:`) on dynamic links and media embeds.

---

### 9. Sessions, Rate Limiting & Production Secrets
- **Guest Sessions**: Guest sessions must be HMAC-signed (`signGuestId`). Any unsigned or forged guest cookie must be rejected and re-issued.
- **Production Secrets Zero-Fallback**: When `NODE_ENV === "production"`, missing `SESSION_SECRET`, `AUTH_SECRET` (or `REDIS_URL` when `REQUIRE_REDIS === "true"`) must immediately throw a fatal error on startup (`validateSecurityConfig`). Never silently fall back to default development keys.
- **IP Rate Limiting**: Identify rate limits strictly via trusted reverse-proxy IP headers (`req.ip || req.socket.remoteAddress`), never through spoofable raw client headers alone. Enforce strict limits on auth, password resets, and AI generation endpoints.

---

### 10. UI Card & Teaser Permanent Dismissal (Zero Clutter Policy)
- **Permanent Dismissal with X / Close**: When a user clicks 'X' (close), 'Dismiss', 'Keç', or 'Bir daha göstərmə' on any informational card, starter guide, feature tip, or announcement toast, the dismissal MUST be stored permanently in persistent client storage (`localStorage`).
- **Zero Temporary Memory / No Session Clutter**: Never use `sessionStorage` or transient in-memory flags for dismissible UI cards or promotional teasers that cause them to reappear upon reload, opening a new tab, or starting a new session.
- **Cross-Mode Cleanliness**: Dismissing starter or guide cards must permanently dismiss all related starter guide cards across all modes (Ask and Build) so the interface remains clean and the user is never repeatedly interrupted.
- **Interaction & Action Dismissal**: When the user acts on an informational card (e.g., clicking 'Try it' / 'Yoxla' or navigating to the featured destination), the card must be marked permanently dismissed so future visits to that page remain decluttered.

---

### 11. Guest User Status & Message Limit Rules (Qeydiyyatsız İstifadəçi və Mesaj Limiti Qaydaları)
- **Guest Identification**: When `!req.user` (anonymous guest session), the user is strictly treated as Unregistered (Guest).
- **Remaining Messages Tracking**: The system configuration must dynamically calculate and provide the exact `{remaining_messages}` value to the AI context. Never fabricate or guess remaining message counts out of thin air.
- **End-of-Response CTA Rules**:
  - When `{remaining_messages} > 2`: Provide full response, followed by an empty line and strictly:
    `"Qeyd: Qonaq rejimində qalan mesaj haqqınız: {remaining_messages}. Bütün analizlərin yaddaşda qalması və limitsiz istifadə üçün qeydiyyatdan keçin."`
  - When `{remaining_messages} == 2` or `1`: Provide full response, followed by an emphasized last line:
    `"Diqqət: Cəmi {remaining_messages} mesaj haqqınız qaldı! Söhbətin yarımçıq qalmaması və sessiyanın itməməsi üçün indi qeydiyyatdan keçin."`
  - When `{remaining_messages} == 0`: Do NOT answer the user's query. Return exclusively:
    `"Qonaq mesaj limitiniz bitdi. Helmer-dən limitsiz istifadə etmək və söhbəti davam etdirmək üçün qeydiyyatdan keçin."`
- **Defense-in-Depth Enforcement**: These directives must be embedded in the AI prompt instructions (`buildGuestMessageLimitInstructions`) and validated server-side (`formatGuestAnswerWithCta` / early exit on exhaustion) across all streaming and non-streaming Ask generation endpoints.

---

### 12. Guest Functional Restriction Rules (Qeydiyyatsız İstifadəçi üçün Giriş və Funksional Məhdudiyyət Qaydaları)
When `!req.user` (anonymous guest session), the user is strictly treated as Unregistered (Guest). When any of the following 4 features are requested or attempted, execution MUST be blocked immediately with zero exceptions, returning strictly and exclusively the designated registration requirement notice:
1. **Ask "Thinking" (Düşünmə / Dərin Təhlil)**:
   - Notice: `"Ask rejimində 'Thinking' funksiyasından istifadə etmək üçün qeydiyyatdan keçməlisiniz. Hesab yaradaraq dərin strateji təhlilləri aktivləşdirin."`
2. **File Upload & Analysis ("Attach file")**:
   - Notice: `"Fayl yükləmək və sənədlərinizi analiz etmək üçün qeydiyyatdan keçməlisiniz."`
3. **Saved Strategies ("My Strategies" & "Discuss a saved strategy")**:
   - Notice: `"Saxlanılmış strategiyalarınıza daxil olmaq və onlar üzərində işləmək üçün qeydiyyatdan keçməlisiniz."`
4. **Planner Tasks ("Planner Tasks")**:
   - Notice: `"'Planner Tasks' bölməsindən istifadə etmək və tapşırıqlarınızı idarə etmək üçün qeydiyyatdan keçməlisiniz."`
- **Zero Additional Fluff**: In all 4 cases, never provide additional explanations, workarounds, or alternative advice. Return exclusively the exact specified notice and direct the user to sign up.
