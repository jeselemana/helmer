# Ask runtime

Ask uses the existing session/guest identity, privacy policy, AI admission policy,
tenant execution guard and policy-wrapped Google GenAI client. No additional
provider, dependency, arbitrary URL fetcher or infrastructure is required.

## Request and response boundaries

1. The existing CSRF origin guard, signed guest identity and verified account
   checks run before generation. Production AI admission reserves the owner
   lease, rate/quota allowance and fingerprinted idempotency record in Redis.
2. The strict Ask schema rejects unknown fields and invalid resource IDs. Reads
   use the authenticated owner. Existing chat history and revision come from
   storage, rather than client-authored history. Context reads run concurrently;
   the capability router's already-authorized chat read can be reused.
3. `ask-handler.js` assembles context; `ask-service.js` prepares the single Gemini
   generation pipeline used by both JSON and SSE. Saved context and attachments
   are reference data in the user role, with an explicit prompt trust boundary.
   This reduces injection exposure; it is not a guarantee of model immunity.
4. Every provider attempt retains budget reservation, slot heartbeats and fresh
   account/resource authorization. Privacy changes and resource deletion cancel
   execution. Local context invalidation never substitutes for authoritative
   cache revalidation across replicas.
5. Required web grounding holds text until safe sources arrive and fails closed
   without sources. Optional search permits one fallback before publication;
   authentication, quota, budget, revocation and cancellation errors cannot
   trigger that fallback. Source metadata is bounded, deduplicated and stripped
   of HTML and unknown provider fields. Chips use safe DOM text and HTTP(S) URLs
   without embedded credentials. The server never fetches those URLs.
6. One request lifetime covers context, generation, persistence and delivery.
   Incomplete requests and response disconnects cancel generation. Normal
   request-body completion does not. SSE disables proxy buffering, sends
   heartbeats, waits for drain and bounds queued output. Responses use no-store.
7. An authorized, revision-checked tenant write and idempotent result precede
   `done`; with Redis admission, the replay record is acknowledged through an
   atomic compare-and-set before final delivery. Identical UI retries retain
   their frozen payload and key; a revision change creates a new operation.
   Failed or interrupted responses cannot be displayed as completed
   solely because EOF arrived. UTF-8 boundaries, malformed frames, excessive
   frames and stalled streams are handled by one frontend parser.
8. Guest restrictions and server-generated quota notices are retained. With
   model improvement disabled, learning and telemetry omit prompt/output
   content. Operational timings contain durations, status and authentication
   presence, without owner identifiers, prompts, outputs or credentials.

## Ask configuration

Values outside the supported range fall back to the default.

| Variable | Default | Supported range |
| --- | ---: | ---: |
| `ASK_MAX_OUTPUT_TOKENS` | 8192 | 256–16384 |
| `ASK_REQUEST_TIMEOUT_MS` | 165000 | 1000–240000 |
| `ASK_FIRST_EVENT_TIMEOUT_MS` | 60000 | 1000–180000 |
| `ASK_STREAM_IDLE_TIMEOUT_MS` | 30000 | 1000–180000 |
| `ASK_SEARCH_TIMEOUT_MS` | 18000 | 1000–180000 |

The text window retains up to 30 recent messages and 120000 characters. Older
attachments stay available without reintroducing their old text turns; repeated
file IDs are included once. File text is capped at 1 MiB characters and binary
context at 28 MiB base64 characters. Generated output is capped at 1 MiB bytes.
The overall request deadline remains authoritative over per-attempt limits.

## Verification and operational limits

Run `npm run check` and `npm test`. HTTP tests need permission to bind localhost.
On 2026-10-25, the syntax/artifact checks passed and all 644 tests passed, with
zero failures, cancellations or skipped tests. The suite includes Ask streaming,
grounding, upload context, strict validation, owner isolation, authentication,
CSRF, source-chip XSS, cancellation, provider reservations, privacy redaction,
replay-store failure and Build/Research/UP regressions.

The tests use deterministic provider and Redis fixtures and temporary tenant
stores; they do not establish live Google, Redis or R2 availability, production
TTFT, or production load capacity. First-text tests prove delivery before
provider completion, rather than a percentage speed improvement.

The existing file cache is process-local and expires. After eviction, restart or
routing to another replica, a user may need to attach the file again; the request
fails safely instead of inventing file content. Provider/source trust remains a
model limitation. Staging validation with real services, account revocation,
disconnects and measured TTFT remains necessary before production rollout.
Deployment requires separate authorization.
