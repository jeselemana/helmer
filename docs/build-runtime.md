# Build on Vertex AI

Build uses a dedicated ADC-authenticated Vertex AI client. Ask, Research, UP,
Planner and artifacts retain their existing model routes and provider wrappers.
The obsolete Build-only OpenAI transport and cross-provider recovery have been
removed.

## Flow

| Endpoint | Model calls (`Auto` — Default) | Model calls (`Faster` — `Medium` / `High`) |
| --- | --- | --- |
| `/api/strategy/generate`, `/generate-stream` | Gemini Decision 1 → Gemini 4 Hydrogen (`low`/`medium`/`high`/`xhigh`) or Gemini 4 Carbon (`low`/`medium`/`high`, escalated) | Gemini 4 Hydrogen (direct final, optional Hydrogen `LOW` grounding pass when live search is mandatory) |
| `/api/strategy/refine`, `/:id/refine`, `/refine-stream` | Gemini Decision 1 → Gemini 4 Hydrogen (`low`/`medium`/`high`/`xhigh`) or Gemini 4 Carbon (`low`/`medium`/`high`) | Gemini 4 Hydrogen (direct final, preserving user-selected `MEDIUM` or `HIGH` thinking) |
| `/api/strategy/assess` | Gemini 4 Hydrogen only (skipped when brief satisfies multi-dimensional sufficiency or explicit no-questions directive) | Gemini 4 Hydrogen only (or skipped when sufficient) |
| `/api/strategy/estimate` | Gemini Decision 1 + deterministic timing/cost model; validated estimate decisions may be reused | Deterministic preparation estimate (no model router call) |

In `Auto` mode, **Gemini Decision 1** (`gemini-decision-1`) performs single-pass calibrated classification across 7 difficulty tiers: Group A targets `gemini-4-hydrogen` with `thinkingLevel` `LOW`, `MEDIUM` (default workhorse), `HIGH`, or `XHIGH`; Group B escalates deep-difficulty briefs to `gemini-4-carbon` with `thinkingLevel` `LOW`, `MEDIUM`, or `HIGH` (Carbon does not support `XHIGH`). When `Auto` escalates to `gemini-4-carbon`, the backend emits `{ escalatedToFlagship: true, routingTier: "flagship" }` (without exposing internal model names in UI banners) and the loading view renders the sanitized Azerbaijani flagship notification via `textContent`. Only the validated target model and thinking level configure final generation; Scout (`gemini-4-hydrogen`, `HIGH` thinking) executes strict structured JSON (`needs_search`, `target_model`, `thinking_level`, `facts`, `focus_area`) and optional Search Grounding before final generation.

Hydrogen Scout receives Google Search only when needed, with automatic tool selection instructed to use it only for necessary current facts. `ENABLE_BUILD_SEARCH_GROUNDING=false` removes the tool and clears external facts.
No arbitrary URL fetching, URL-context, code execution or alternative search
provider is supplied. Final generation (`gemini-4-hydrogen` or `gemini-4-carbon`) receives no tools, uses the selected thinking level,
and returns the complete existing `StrategySchema`.

Build accepts a web finding only when a provider `groundingSupports` segment
matches the whole finding and links it to at least one accepted `groundingChunks`
source. URLs are checked for scheme, credentials, length and low-quality domains.
Required research fails with `GROUNDING_UNAVAILABLE` when no finding qualifies.
The final model receives the original brief and permitted personalization.
Build adds the linked findings separately after final strategy validation and
displays them alongside Search Suggestions. PDF, HTML, CSV and Excel preserve
the finding-to-source links. Provider HTML stays outside the main page.

Build excludes grounded content from learning and telemetry, including failures
after an attempted search. Grounded strategies are available to view. Build
refinement and Ask decline to send them to another model. The archive retention
clock uses the original grounded version date and survives title edits.

Final strategy chunks reach SSE as they arrive, after current authorization checks.
Intermediate Scout JSON is private. Chunks are provisional: only a complete
`STOP` response that passes JSON and strict Zod validation reaches the repository.
The existing tenant-scoped strategy router controls atomic persistence, versioning,
idempotent replay and payload-fingerprint conflicts. Partial, invalid, blocked or
cancelled output cannot create a saved strategy. The UI accepts only the validated
terminal strategy for rendering and saving; its identity-epoch checks remain.

## Consent and execution security

`personal-context.js` reads brand/profile/tone only after both
`personalIntelligence === true` and `strategyPersonalization === true`.
Personalization is deterministic and uses the authenticated settings already
loaded by the auth layer. It does not query history, call an LLM or ask Hydrogen to
select profile fields. The minimal opt-in profile reaches final generation as untrusted data,
separate from privileged instructions; Scout and estimates receive none.
The assessment call may receive that same consent-gated profile.

Tenant execution mutexes, background-research exclusion, shared Redis capacity,
provider-slot heartbeats, current authorization, cancellation on disconnect,
privacy-epoch checks, strict mutation schemas and canonical idempotency
fingerprints are preserved. Every model call passes through
`AiPolicy.reserveProvider`. Safety settings on Build models are:

- Hate speech and sexually explicit content: `BLOCK_LOW_AND_ABOVE`.
- Dangerous content and harassment: `BLOCK_MEDIUM_AND_ABOVE`.

Build sets no artificial `maxOutputTokens` cap on model generation while enforcing
bounded stage-specific deadlines (`30s` estimate, `60s` assessment, `35s` scout via `BUILD_SCOUT_TIMEOUT_MS`,
`180s`/`240s`/`360s`/`420s` Hydrogen `LOW`/`MEDIUM`/`HIGH`/`XHIGH`, `240s`/`360s`/`450s` Carbon `LOW`/`MEDIUM`/`HIGH`) and route-level request timeouts
(`45s` `/estimate`, `90s` `/assess`, `600s` `/generate`, `/generate-stream`, and
`/refine`). The existing input/output character and schema bounds protect memory
and persistence.

Before Build calls, admission reserves realistic thinking-aware output token
budgets (`16,384` for Scout, `8,192`/`16,384`/`24,576`/`32,768` for Hydrogen `Low`/`Medium`/`High`/`XHigh`, and `16,384`/`24,576`/`32,768` for Carbon `Low`/`Medium`/`High`).
These are accounting reservations, not generation parameters. Reported usage settles
the reservation; failed/aborted calls without usage refund the reservation; completed
calls without `usageMetadata` settle estimated token usage based on observed bytes;
and grounded search fees are charged only when Google Search grounding was actually
executed. The default `$5`/user and `$100`/platform daily ceilings work out of the
box. Hydrogen prices are `$1.50`/`$7.50` per million input/output tokens; Carbon
prices are `$2.00`/`$10.00` per million input/output tokens through November 2026
and `$4.00`/`$20.00` from December 1, 2026 UTC (scheduled via `AI_CARBON_CUTOVER_MS`);
and Decision 1 is priced at `$0.10`/`$0.00` per million tokens.

Transient Vertex AI failures (`408`, `429`, `5xx`, timeouts) retry across Vertex AI
multi-region endpoints (`us` → `global`) with exponential backoff, streaming-to-unary
recovery (`resetStream`), and thinking step-down on `MAX_TOKENS` (`XHIGH` → `HIGH` → `MEDIUM` → `LOW`). Only
routing decisions without grounded content can be cached across requests.
Missing ADC, invalid provider parameters and unavailable models have
distinct sanitized error codes; they are never described as provider overload. Errors are sanitized
and correlated by a random request ID. Diagnostic records contain stage, model,
code/status, elapsed time and bounded schema issue paths, never SDK messages,
credentials, prompts, outputs or account IDs. Existing model-improvement opt-out
redaction and training-candidate purging remain active.

## Location, identity and caching

The agreed deployment is Cloud Run **`us-central1`**, Vertex generation and
implicit caches **`us`**. This is intentional: neither requested model advertises
`us-central1` serving support. It is a US multi-region deployment, not a guarantee
that all model processing occurs in Iowa or on the same internal network.

Build ignores API-key, generic location and custom Vertex base-URL overrides. Its
SDK client explicitly sets the project, `vertexai: true`, the canonical
`https://aiplatform.us.rep.googleapis.com` multi-region endpoint and
`v1beta1`. Cloud Run uses an attached service account and ADC. Downloaded credential
files are rejected for Build in production. Explicit credential-file paths are
validated before SDK construction; a missing file returns `AI_NOT_CONFIGURED`.
For local development, use standard user ADC (`gcloud auth application-default
login`) rather than a stale `GOOGLE_APPLICATION_CREDENTIALS` path. The scripts attach
`CLOUD_RUN_SERVICE_ACCOUNT` (default
`helmer-runtime@PROJECT_ID.iam.gserviceaccount.com`) and verify that the service
account exists without mutating project IAM policy bindings on each deploy. They
do not create service account keys. Existing secrets for unrelated modes remain
separate.

Final Build generation models support **implicit** context caching only, not `caches.create` or an explicit
`cachedContent` resource. Stable strategy/refinement templates and methodology
remain at the beginning of the system prompt to make repeated prefixes eligible
for caching. Cache hits depend on Google's eligibility/minimum-token rules and
project configuration; the application does not promise a hit. No explicit shared
user-data cache is created. The existing prohibition on unadmitted explicit cache
creation remains. Implicit caching can retain customer-derived data in Google's
project-scoped cache for up to 24 hours, including durable storage by default.
Project administrators control cache retention; application telemetry opt-out does
not disable Google's independent cache or abuse-monitoring retention.

The estimate optimization is separate: a bounded, process-local, five-minute cache
uses SHA-256(owner + task) keys and stores only the effort enum and fixed metadata.
It retains no task-derived focus text, profile, facts or prompt. Cache hits recheck
authorization. Generation and assessment never reuse an estimate to skip their
required routing/assessment calls. The numeric estimate remains a heuristic, not a deadline.

## Official documentation

- [Gemini 4 Hydrogen & Carbon models, thinking, decoding, and Vertex AI generative AI docs](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/models)
- [Cloud Run service identity and ADC](https://docs.cloud.google.com/run/docs/ai/authenticate-agents).
- [Safety filter configuration](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/capabilities/configure-safety-filters).
- [Context caching and tenant boundaries](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/context-cache/context-cache-overview).
- [Data governance and retention](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/data-governance).
- [Google Search grounding display requirements](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/multimodal/grounding-search-suggestions).
- [Service-specific terms](https://cloud.google.com/terms/service-terms), [Cloud Data Processing Addendum](https://cloud.google.com/terms/data-processing-addendum) and [pricing](https://cloud.google.com/gemini-enterprise-agent-platform/generative-ai/pricing).

Google does not use customer data for training without permission, but that does
not imply zero retention. Google Search may retain derived queries/context for up
to three days and cannot be configured for zero retention; abuse monitoring and
Advanced AI terms may impose additional logging. IAM, billing, model access,
request/response logging, organization policy, cache retention and applicable
Google terms must also be verified in the actual project. Section 20(k) specifically
restricts modification/analysis, training, storage, framing and reuse of Grounded
Results and Search Suggestions. Strategy archives, exports and Google's exact
suggestion display requirements need separate confirmation under the project's
Google agreement. This change
must not be presented as certifying those contractual permissions. Repository changes
alone cannot certify deployed compliance or grant model access.

## Verification

Run `npm run check` and `npm test` with the declared Node 24 runtime. Coverage
includes model-call counts, all thinking levels, consent-gated profile access,
streaming-before-completion, malformed JSON, safety stops, no fallback, sanitization,
provider admission and full reservations, cancellation, tenant persistence,
idempotency, privacy revocation and safe Google Suggestions rendering.

Deployment scripts are prepared but have not been executed. No IAM mutation or
production deployment is part of the local test suite.

On 2026-10-31, separate synthetic live probes originally confirmed Vertex API
connectivity at the canonical US multi-region endpoint. In the current
configuration, Build uses Decision 1 (`gemini-decision-1`) -> Gemini 4 Hydrogen
(`low`/`medium`/`high`/`xhigh`) and Gemini 4 Carbon (`low`/`medium`/`high`)
exclusively for Build strategy synthesis and refinement.
