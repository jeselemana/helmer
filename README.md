# Helmer

Helmer is an AI strategy workspace built on the project's existing Express and vanilla JavaScript stack. It turns a business brief into a structured strategy, selectively asks for clarification, supports versioned refinements, saves work to an owner-scoped MVP repository, and exports strategy content locally.

## Run locally

1. Copy `.env.example` to `.env` and add API keys (`OPENAI_API_KEY`, `GEMINI_API_KEY`).
2. Install dependencies with `npm install`.
3. Start with `npm start`.
4. Open `http://localhost:8080` in the browser.

For local development, use `npm run dev` so changes to imported server modules restart the process automatically. With `npm start`, restart the server after backend changes. If `PORT` is configured in `.env`, use that port instead of `8080`.

## Configuration

- `GEMINI_API_KEY` — required for Build mode (`gemini-4-hydrogen`, `gemini-4-carbon`, `gemini-decision-1` via Vertex AI), Gemini Ask mode, and Live Search Grounding.
- `OPENAI_API_KEY` — used for Build mode fallback (`gpt-6-sol`) and OpenAI Ask mode (`gpt-5.6-luna`, `gpt-5.6-terra`).
- Build mode uses Auto (Gemini Decision 1 routing across `gemini-4-hydrogen` low/medium/high/xhigh and escalated `gemini-4-carbon` low/medium/high) or Faster (`gemini-4-hydrogen` Medium/High) and falls back to `gpt-6-sol`.
- `OPENAI_ASK_MODEL` — model for Ask mode; defaults to `gpt-5.6-luna`.
- Ask Flash uses `gemini-3.8-flash` with selectable Low, Medium, and High thinking levels.
- `MAX_CLARIFICATION_ROUNDS` — defaults to `2`.
- `PORT` — defaults to `8080`.
- `APP_URL` — the canonical public origin, for example `https://helmerworkspace.com`.
- `TRUSTED_ORIGINS` — optional comma-separated additional browser origins.
- `REDIS_URL` — required in production; used as the primary session, password-reset-token, rate-limit, and repository cache store.
- `SESSION_SECRET`, `AUTH_SECRET` — required in production. Missing Redis or secrets prevents startup; unavailable Redis blocks AI admission, quota reads and provider reservations.
- `GUEST_AI_DAILY_LIMIT` — positive integer, defaults to `5`; shared owner/IP quota resets at 00:00 UTC (04:00 Asia/Baku). Five allows five full answers; the response metadata reports the balance after the current reservation. The prompt and CTA use the balance available when the current request was accepted, including that request. Rejections before a provider call refund the reservation. Development without Redis uses process memory only; production always requires Redis.
- Guest Thinking (including automatic Medium/High routing), uploads, saved strategy access and Planner APIs require registration.
- `RESEND_API_KEY`, `EMAIL_FROM` — Resend HTTP API ilə e-poçt təsdiq kodu və şifrə bərpası göndərişi. `EMAIL_FROM` Resend-də təsdiqlənmiş domenə aid olmalıdır. SMTP (`SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`) alternativ olaraq dəstəklənir.
- `ADMIN_USERNAMES` — comma-separated usernames allowed to access the admin dashboard (`/admin`).

## Data and ownership

Helmer uses first-party username/email + password authentication. Passwords are hashed with Argon2id. An opaque, cryptographically random session token is stored only in the `helmer_session` HttpOnly, SameSite cookie; only its SHA-256 digest is used as the server-side session key. Product APIs require an authenticated user and saved strategies are scoped to that immutable user ID.

The MVP user repository is an atomically written, versioned `data/users.json` store. `src/repositories/auth-store-migrations.js` upgrades the persisted schema without rewriting strategy records. Existing guest-owned strategies are claimed by the new user on the first successful signup/login from that browser. For multi-instance production deploys, attach a persistent disk for `data/users.json` and `data/strategies.json`, and configure Redis for sessions. A later SQL migration can replace the repository implementation without changing the auth/API contract.

Password reset tokens are random, stored only as hashes, expire after 20 minutes, and are consumed once. Changing or resetting a password invalidates other/all active sessions respectively. State-changing browser requests are origin-checked, CORS is allowlisted, and security headers are applied globally.

## Authentication API

- `POST /api/auth/signup`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/me`
- `GET /api/auth/username-availability`
- `PATCH /api/auth/account`
- `POST /api/auth/change-password`
- `POST /api/auth/forgot-password`
- `POST /api/auth/reset-password`
- `POST /api/auth/onboarding`

## Export status

- HTML document export: implemented locally.
- CSV spreadsheet export: implemented locally with normalized priority, action-plan, KPI, and risk rows.
- Google Docs, Google Sheets, and connected Excel: visibly marked as coming soon; no connection is faked.

## Ask capabilities (V4)

Ask and Strategy Copilot support `@Word`, `@Excel`, `@PowerPoint`, `@PDF` and `@Web`. A registry-driven selector routes requests to grounded research or validated structured specifications and deterministic native files. Cards provide authenticated downloads, structural previews, edits and immutable version history. Saved Build strategies can supply source context.

See [Ask artifacts architecture and deployment](docs/ask-artifacts-v4.md) for provider/storage configuration, API contracts, limits, permissions, extension points and verification.

## Verification

- `npm run check` — JavaScript syntax checks.
- `npm test` — auth/domain regression tests plus capability routing, real file integrity, versioning, ownership, recovery, orchestration and UI tests.
- `npm run build` — static-app syntax validation; run `npm test` separately.

## Helmer UP

UP adds account-backed business practice with GPT-6 Luna generation/evaluation, deterministic Points, goals, streaks, levels and skill progression. Open it from UP in desktop/mobile navigation or `/workspace?view=up`. See [UP architecture and verification](docs/up-v4.md). `npm test` includes the UP security and persistence tests; `node scripts/test-up-live.js` runs an isolated live API smoke test, and `--cloud` checks real R2 conditional persistence.
