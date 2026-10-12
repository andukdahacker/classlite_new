# Story 11.0a: Backend Error Tracking & Request-Scoped Telemetry

Status: done

<!-- Validation optional. Run validate-create-story before dev-story if desired. -->

---
baseline_commit: a1bc4d7
epic: 11
story: 11.0a
fr: NFR (observability) — promotes FU-11-SENTRY; no FR, no api.yaml change
size: S
audience: backend (+ small FE regression-lock + ops/manual-setup)
depends_on: []   # deps NONE — numbered 11-0a to sort FIRST (this project reads story numbers as sequence)
split_from: FU-11-SENTRY (promoted to a sequenced story at Epic 11 v0.3, 2026-09-28)
wf8_hard_gate: true   # ACs map to R-11-6 (Sentry PII over student submissions/grades, minors plausible) = ≥6. ATDD red-phase MANDATORY before in-progress (Task 0). The PII-scrub + replay-OFF ACs ARE the guardrail.
ducdo_rulings: "Epic-11 v0.1→v0.4: promoted from FU-11-SENTRY (Murat — a prereq with no story never gets sequenced); session replay OFF in EVERY env until masking verified (education product, minors plausible, VN jurisdiction/consent); Mary's framing = 'if tenant A sees tenant B's students in prod, YOU WILL NOT FIND OUT' — blindness is the gate; must precede L1 pilot because until it lands Ducdo IS the error tracking; also covers log retention (Sentry = errors; triage needs request-scoped logs, Railway retention short)"
---

## Story

As **Ducdo (operator of the L1 pilot)**,
I want **backend errors and request-scoped context to reach a place I can search — correlated by `request_id`, tagged by tenant, with student PII and secrets scrubbed — and the frontend DSN live in every deployed environment**,
so that **a cross-tenant leak or a lost submission in front of a pilot center is something I discover, not something a customer tells me about weeks later.**

This is a **pure-infrastructure story**. There is **no api.yaml change, no new endpoint, no migration, no DB schema**. It activates error tracking that the architecture promised "from day one" (architecture.md:267) but which was never wired on the backend, and it closes the ops gaps that keep the already-instrumented frontend inert.

**Done when** (epic-11.md:501): a deliberately triggered backend error is searchable by its `request_id`, and the frontend DSN is live in every deployed environment.

---

## Context & Reuse Map (READ FIRST)

The hard part is **already done**: `request_id` is generated and propagated, tenant context is on every request, there is a single error funnel, and the config field exists. 11-0a wires an SDK onto substrate that was built expecting it. **Do NOT rebuild any of this.**

### Current state — REUSE / capture here, do not rebuild

| Capability | Where it lives | Note |
|---|---|---|
| **`SentryDSN` config field** | `internal/config/config.go:19` (field), `:163` (`getEnv("SENTRY_DSN", "")`), `:382` (logged as boolean `"sentry_dsn_set", c.SentryDSN != ""`) | Plumbed end-to-end but **read by nothing** — no SDK, no init, no capture. **Optional in `Validate()`** (`config.go:244-371` never references it) — keep it optional so dev/local with an empty DSN is unaffected. |
| **`request_id` generation + propagation** | `internal/middleware/request_id.go:13-20` — `uuid.New().String()`, injected via `context.WithValue(ctx, model.RequestID, id)`, also set as `X-Request-ID` response header. First middleware in the outer chain. | Context key is `model.RequestID` (`internal/model/ctxkey.go:13`). Read it at **capture time** from the incoming ctx (same pattern as `error_mapper.go:79,95`) — this is the search key the whole story turns on. |
| **Tenant context on every request** | `internal/model/tenant.go` — `TenantContext{CenterID, UserID, Role, EmailVerified}` (`:12-17`), `model.TenantFromContext(ctx)` (`:28-39`) | `center_id` / `user_id` become Sentry **tags** (operator data, not student PII — tagging these is the point of Mary's gate). Available at both HTTP and worker capture points. |
| **Single HTTP error funnel** | `internal/middleware/error_mapper.go` — panic recovery `:77-88` (`defer`/`recover`, has `rec`, `debug.Stack()`, `requestID`); unhandled-error **default arm** `:537-543` (`slog.Error("unhandled error", ...)` + 500 `INTERNAL_ERROR`) | **These two points are the capture sites.** Everything `ErrorMapper`-wrapped funnels through them. Mapped 4xx (NotFound/Forbidden/Validation/Conflict/Gone) are **expected** — do NOT capture them; capture only panics + the unhandled/500 default arm. |
| Routes **NOT** wrapped in `ErrorMapper` (capture gap) | `GET /health` (`cmd/api/main.go:232`), OAuth 302 redirects (`internal/handler/auth_handler.go`), `POST /api/webhooks/polar`; plus direct-500 paths in `internal/middleware/auth.go:66,88,97,118` and `:157-168` (transient DB failures) | These bypass the funnel. Cover the `auth.go` transient-500s with an explicit `CaptureError(ctx, err)` call (worth knowing when auth DB is flaking). Health/redirect/webhook capture is **out of scope** (documented below). |
| **Worker error funnel** | `internal/worker/dispatcher.go` — per-job panic `runRecovered :534-542`, loop panic `recoverLoop :526-530`, terminal fail `terminalFail :239-262`, `handleFailure :171-220` | All currently `slog.Error` only. Tenant `center_id` is in hand per job (`model.TenantContext{CenterID: centerID}` at `:126`, re-established via `setTenant :546-550` per SEC-6). Capture with the `center_id` tag. |
| **Global redacting slog handler** | `cmd/api/main.go:43-44` — `slog.New(logging.NewRedactingJSONHandler(os.Stdout, nil))`; handler at `internal/logging/redact.go:34-62` scrubs presigned-R2/SigV4 URLs (`redactPattern :24`) | Logger is **global, not context-carried** (`request_id` passed as an explicit attr at each site). Any Sentry scrubbing must be **composed with**, never replace, this redaction — SigV4/presigned URLs must stay scrubbed in Sentry too. **A full slog→Sentry bridge is OUT of scope** (keep S-sized); capture is explicit at the funnels. |
| **main() bootstrap sequence** | `cmd/api/main.go` — slog `:43-44`, `config.Load()` `:46`, `Validate()` `:48-51`, `LogSummary()` `:53`, ffmpeg fail-fast `:59-63` (model for init-failure handling), services + `go aiDispatcher.Start(workerCtx)` `:227`, chain assembly `:1113-1139`, server `:1141-1147`, **SIGINT/SIGTERM graceful shutdown `:1157-1167`** | **Sentry init goes right after slog `:44`** (so init failures are logged). **`sentry.Flush(2*time.Second)` goes in the shutdown block `:1157-1167`** (before/alongside `srv.Shutdown`), else buffered events are dropped on deploy. |
| **go.mod** | `github.com/ducdo/classlite-api`, `go 1.25.0`. **No `getsentry/sentry-go`** (0 hits in go.sum). | This story adds `github.com/getsentry/sentry-go` as the one new direct dep. Flag for human review per the dependency convention. |
| **Frontend Sentry (already correct)** | `classlite-web/src/lib/sentry.ts` — `initSentry()` reads `import.meta.env.VITE_SENTRY_DSN`, **no-ops when unset** (`:33`), `environment: MODE`, `release: VITE_RELEASE_SHA ?? 'dev'`, `tracesSampleRate 0.1`, `integrations: [browserTracingIntegration()]` only. Called from `main.tsx:15`. | **NO session replay integration exists** (verified — correct per the ruling). **No `beforeSend`.** FE code is inert only for want of a DSN. 11-0a adds a **regression-lock test** that replay stays absent, and provisions the DSN in ops — it does NOT re-architect the FE. |
| **Test harness** | BE: `internal/test/helpers.go` (`SetupDB` tx-rollback, `SET LOCAL ROLE classlite_app`), per-story `story_*_helpers.go` server builders (`newStorySrv` wires real chain + `ErrorMapper`); middleware tests in `internal/middleware/*_test.go` pkg `middleware_test` (see `logger_test.go` buffer-slog pattern). Worker: `internal/test/workers/harness.go`. FE: MSW + real QueryClient. | `sentry-go` exposes `ClientOptions.Transport` — use a **mock/in-memory transport** to assert captured events in tests (no network, no real DSN). This is the test seam; document it in the completion notes. |

### Net-new — THIS story builds

- **`internal/observability/sentry.go`** (new package — single lowercase word, CQ-4): 
  - `Init(cfg config.Config) (flush func(context.Context), err error)` — wraps `sentry.Init`. Empty DSN → returns a no-op flush + nil error (mirror the FE guard; dev/local unaffected). Sets `Environment: cfg.AppEnv`, `Release:` from a new optional `RELEASE_SHA` env, a **named low `TracesSampleRate` const**, and `BeforeSend:` the scrubber below. **No replay** (N/A backend).
  - `CaptureError(ctx context.Context, err error)` and `CapturePanic(ctx context.Context, rec any, stack []byte)` — read `model.RequestID` + `model.TenantFromContext` from the **incoming ctx** (GO-4 — never `context.Background()`), set `request_id` / `center_id` / `user_id` as tags, capture via the hub, return quickly (never block the request/worker path).
  - **`beforeSend` scrubber** (the R-11-6 guardrail): strip request bodies, cookies, `Authorization`, and any value that could carry student submission text, grades, Gemini prompt content, or the Gemini API key (EDGE-4). Allowlist-tag approach: attach only `request_id`, `center_id`, `user_id`, `route`, `method`, `status` — drop everything else sensitive. Must also preserve the existing SigV4/presigned-URL redaction.
- **Capture calls** at the two HTTP funnels (`error_mapper.go:77-88`, `:537-543`) and the worker funnels (`dispatcher.go` panic + `terminalFail`), plus the `auth.go` transient-500 paths.
- **Flush on shutdown** in `cmd/api/main.go:1157-1167`.
- **Config**: optional `ReleaseSHA string` from `getEnv("RELEASE_SHA", "")` (backend release tag). Keep optional; add `*_set` or raw to `LogSummary()` consistently (SHA is not a secret — raw is fine). No change to `Validate()` severity.
- **FE regression-lock test** asserting `initSentry()` configures **no** replay integration (locks the ruling so a future dep bump can't silently enable it). Optionally thread `VITE_SENTRY_DSN` through the deploy/CI build env.
- **`docs/manual-setup.md`** (WF-9): a new `## Sentry (Story 11-0a)` section — create backend + frontend Sentry projects, obtain the two DSNs, set `SENTRY_DSN` (api) and `VITE_SENTRY_DSN` (web) per Dev/Staging/Prod, confirm **session replay disabled**, and a **log-retention** decision row (Railway log drain / retention target). Add the missing `VITE_SENTRY_DSN` row + `RELEASE_SHA` row. Prod columns stay `[ ]` until cutover.

### Design decisions pinned (engineering calls — override at dev pickup only with a written reason)

- **DD1 — Capture only the unexpected; never the mapped 4xx.** The `error_mapper.go` panic (`:77-88`) and default/unhandled arm (`:537-543`) are the only HTTP capture sites. NotFound/Forbidden/Validation/Conflict/Gone are business-as-usual and would drown the signal. A 403 is not an incident; a panic is.
- **DD2 — `request_id` is a TAG, not just context.** Sentry's searchable/indexed dimension is tags. Put `request_id` (and `center_id`, `user_id`, `route`, `method`) in `scope.SetTag(...)` so "search by request_id" actually works in the Sentry UI — that is the literal "Done when". Reading it from the incoming ctx at capture time (GO-4) is load-bearing: a worker or a post-refresh retry carries a different id than the closure that set up capture.
- **DD3 — The scrubber is allowlist, not denylist (R-11-6).** Deny-listing field names loses the next time someone adds a field that carries an essay body. Default-drop the HTTP request body and known-sensitive headers; attach only the explicit operator-safe tag set. `center_id`/`user_id` are UUIDs an operator needs and are not student PII; submission text, grades, and prompts never leave the process. This is the ATDD-gated AC.
- **DD4 — Empty DSN = silent no-op, both services.** Matches the FE (`sentry.ts:33`) and keeps the 228-file Go suite + local dev green without a DSN. Init must never fail-fast the server on a bad/empty DSN — log a warn and continue (the API serving without telemetry beats the API not serving).
- **DD5 — Replay stays OFF everywhere; lock it with a test.** The ruling (epic-11.md:929) is a hard precondition, not a default. Backend has no replay surface; the FE one is already absent — the deliverable is a **regression lock** so it can't come back via a dependency's default, not new masking code.
- **DD6 — Log retention is a documented ops decision, not a pipeline.** "S" size. The code deliverable is `request_id` correlation (errors in Sentry ↔ request-scoped stdout logs joinable by id). The retention gap (Railway stdout is short-lived) is captured as a `manual-setup.md` decision row (log drain / retention target), not a log-shipping build. Flag if you think it needs to be code.
- **DD7 — Health/OAuth-redirect/Polar-webhook capture is out of scope.** They bypass `ErrorMapper` by design; wrapping them is a bigger refactor than an S story warrants. The `auth.go` transient-500s ARE covered because an auth DB flake in front of the pilot is exactly the blindness Mary named.

---

## Acceptance Criteria (BDD)

### AC1: Backend Sentry initializes from config, no-ops when unset
Given `SENTRY_DSN` is set to a valid DSN,
When the API process starts,
Then `observability.Init` initializes the Sentry SDK with `Environment = cfg.AppEnv` and the release tag from `RELEASE_SHA` (when present);
And given `SENTRY_DSN` is empty (dev/local default), When the process starts, Then Init returns a no-op flush and **nil error**, the server starts normally, and nothing is sent.

### AC2: A deliberately triggered backend error is captured and searchable by request_id
Given the SDK is initialized (test uses an in-memory transport),
When a request through the real middleware chain hits a handler that panics OR returns an unmapped error (the `error_mapper.go` default arm),
Then exactly one Sentry event is captured,
And its tags include `request_id` equal to the request's `X-Request-ID`, plus `center_id`, `user_id` (when authenticated), `route`, `method`, and `status`.

### AC3: Mapped business errors (4xx) are NOT captured
Given the SDK is initialized,
When a handler returns a `NotFoundError` / `ForbiddenError` / `ValidationError` / `ConflictError` / `GoneError`,
Then **no** Sentry event is captured (only the correct 4xx envelope is written).

### AC4: Student PII, submission content, and secrets are scrubbed [R-11-6 — ATDD-GATED]
Given a captured event for a request whose body contained student submission text and whose headers carried `Authorization` / cookies,
When `beforeSend` processes the event,
Then the event contains **no** request body, **no** `Authorization`/cookie values, **no** Gemini prompt content, **no** grade/submission text, and **no** `GEMINI_API_KEY`;
And the only request-derived data present is the operator-safe tag set (request_id, center_id, user_id, route, method, status);
And existing SigV4/presigned-R2 URL redaction (`internal/logging/redact.go`) is still applied to anything that does survive.

### AC5: Worker (async) errors are captured with tenant context [SEC-6]
Given the job dispatcher is running with the SDK initialized,
When a job panics (`runRecovered`) or terminally fails (`terminalFail`),
Then a Sentry event is captured tagged with the job's `center_id` (re-established from the claimed row, never the payload — SEC-6),
And no Gemini prompt content or submission text is included (AC4 scrubber applies to worker events too).

### AC6: Events flush on graceful shutdown
Given buffered Sentry events exist,
When the process receives SIGINT/SIGTERM,
Then `sentry.Flush` is called (bounded, ~2s) within the shutdown block before exit, so in-flight events are not dropped on deploy.

### AC7: Session replay is OFF — and locked [DD5]
Given the frontend `initSentry()` runs with a DSN set,
When Sentry is initialized,
Then no session-replay integration is configured (no `replayIntegration`, no `replaysSessionSampleRate`/`replaysOnErrorSampleRate`);
And a regression test asserts this, so a future dependency change cannot silently enable replay.

### AC8: Ops activation is tracked and the DSN is consumable in every deployed environment
Given `docs/manual-setup.md`,
When a reader looks for Sentry activation,
Then there is a `## Sentry (Story 11-0a)` section listing `SENTRY_DSN` (api) and `VITE_SENTRY_DSN` (web) with per-environment checkboxes, a "session replay disabled — verify" row, and a log-retention decision row;
And setting the env var in a deployed environment activates capture with **no further code change** (code already reads both vars).

## Tasks / Subtasks

- [x] **Task 0 — ATDD red-phase (MANDATORY, WF-8 gate; R-11-6 ≥6) — DONE 2026-10-10.** Reds on branch: `classlite-api/internal/test/sentry_capture_atdd_test.go` (AC4 scrub value-scan + AC2/AC5 tag mechanism + AC1/AC6), `classlite-api/internal/middleware/error_capture_atdd_test.go` (AC2 funnel wiring + AC3 4xx-not-captured), both `//go:build atdd_red_phase` (RED verified: excluded from normal suite, compile-fail under tag). FE AC7 ships as a GREEN regression-lock `classlite-web/src/lib/__tests__/sentry-replay-off.test.ts` (2 passed). Green-phase seam contract in `_bmad-output/test-artifacts/atdd-checklist-11-0a-backend-error-tracking-and-telemetry.md`. **WF-8 gate satisfied for entry to in-progress.**
- [x] **Task 1 — SDK + observability package (AC1, AC4).**
  - [x] `go get github.com/getsentry/sentry-go` (flag the new dep for human review per convention); run `go mod tidy`. — v0.50.0, now a direct require.
  - [x] `internal/observability/sentry.go`: `Init(cfg) (flush, err)`, empty-DSN no-op (DD4), named `tracesSampleRate`/`FlushTimeout` consts (CQ-3), `ScrubEvent` allowlist scrubber (DD3), `CaptureError`/`CapturePanic` reading `model.RequestID` + `model.TenantFromContext` from incoming ctx (GO-4, DD2), plus `WithHTTPTags` for route/method/status.
  - [x] Preserve `internal/logging/redact.go` SigV4/presigned redaction inside `ScrubEvent` (via new exported `logging.RedactString`).
- [x] **Task 2 — Config (AC1).** Added optional `ReleaseSHA` (`getEnv("RELEASE_SHA","")`) to `config.go`; included in `LogSummary()` (raw). No `Validate()` change; `SentryDSN` stays optional.
- [x] **Task 3 — Wire init + flush (AC1, AC6).** `observability.Init` called after `cfg.LogSummary()` (slog already up so init failures log); warn-and-continue on error (DD4). Bounded `flushSentry(shutdownCtx)` added to the shutdown block.
- [x] **Task 4 — HTTP capture (AC2, AC3).** `CapturePanic` at the panic arm, `CaptureError` at the unhandled/500 default arm; mapped 4xx untouched (AC3). `CaptureError` added to the four `auth.go` transient-500 paths (`:66,88,97,118`). The `:157-168` 403 INVALID_TENANT_CLAIM is a business rejection → intentionally NOT captured (AC3/DD1 — see completion notes).
- [x] **Task 5 — Worker capture (AC5).** Capture at `dispatcher.go` `processClaimed` + `runInTenantTx` job-error sites (covers `runRecovered` panics) and `terminalFail`, tagged with the per-job `center_id` via `workerTenantCtx` (SEC-6). `recoverLoop` left slog-only (process-level panic, no tenant ctx, outside AC5's per-job scope — documented). Scrubber applies.
- [x] **Task 6 — FE replay regression-lock (AC7).** `classlite-web/src/lib/__tests__/sentry-replay-off.test.ts` asserts no replay integration + no `replays*SampleRate` with a DSN set, and no init when unset. 2 passed. No FE runtime change.
- [x] **Task 7 — Ops / manual-setup (AC8).** Added `## Sentry (Story 11-0a)` to `docs/manual-setup.md`: `SENTRY_DSN` + `VITE_SENTRY_DSN` + `RELEASE_SHA` + `VITE_RELEASE_SHA` per-env rows, replay-disabled verify row, log-retention decision row. `VITE_RELEASE_SHA` CI wiring noted as a follow-up (`.env.example` claims it but CI does not set it). Prod columns `[ ]` (WF-9).
- [x] **Task 8 — Verify gates.** `go build ./...` ✓, `go vet` ✓, `gofmt` ✓, `go test ./...` (API — only failure is the pre-existing, baseline-confirmed `TestInbox_MarkAllRead…` DB-residue test, unrelated to 11-0a), `tsc -b` ✓, `vitest src/lib` (1182 passed incl. AC7) ✓. Empty-DSN path keeps the suite green (DD4). No `scripts/codegen.sh` run (no api.yaml / .sql touched — WF-3).

### Review Findings (code-review 2026-10-11)

_Adversarial 3-layer review (Blind Hunter + Edge Case Hunter + Acceptance Auditor). All 8 ACs verified SATISFIED by the Auditor; findings below are scrubber-completeness holes and triage-quality gaps, all confirmed against live source + sentry-go v0.50.0._

- [x] [Review][Patch] (resolved from Decision — Ducdo chose broaden, 2026-10-11) Worker infra / discovery / `recoverLoop` errors are not captured — a DB-down or scan-loop panic produces ZERO Sentry signal worker-side, the exact "blindness is the gate" the story targets (and that `auth.go` DOES cover on the HTTP side). AC5-literal is met (per-job + terminalFail), but `claimJob` begin/claim/commit [`worker/dispatcher.go:433,447,451`], `nextReadyCenter` [`:502`], `sweepAllTenants` discover/scan [`:403,410`], and `recoverLoop` [`:549-553`] are all slog-only. → capture these funnels (operator-safe, no per-job tenant where none exists).
- [x] [Review][Patch] (resolved from Decision — Ducdo chose restore grouping, 2026-10-11) Blanking every `Exception.Value` collapses HTTP-500 Sentry grouping — all unhandled 500s are captured at the shared `ErrorMapper` funnel (same stacktrace top) with Value now blanked and Type usually `*errors.errorString`, so distinct incidents fingerprint into ~one issue titled empty [`observability/sentry.go:137-142`]. → add a non-PII error-type tag + custom fingerprint and surface `terminalFail` `detail` as an operator-safe `reason` tag.
- [x] [Review][Patch] Non-error panic values bypass the R-11-6 scrubber via `event.Message` — `CapturePanic` passes raw `rec` to `hub.Recover`, which routes a `string`/non-error panic to `EventFromMessage`; `ScrubEvent` only runs Message through the 5-pattern SigV4/URL `RedactString`, so `panic("…"+essay)` or `panic(struct)` reaches Sentry nearly unscrubbed. Docstring's "wrapped into an error" is false. [`observability/sentry.go:185-191` + `:136`]
- [x] [Review][Patch] Tracing armed (`TracesSampleRate: 0.1`) with no `BeforeSendTransaction` — transaction events bypass `ScrubEvent` entirely; any future tracing surface ships ~10% transactions with unscrubbed Request/URL/spans. On a hard-gate story. Add a transaction scrubber or set the rate to 0 until tracing is scoped. [`observability/sentry.go:89-90`]
- [x] [Review][Patch] Flush not clamped to zero when the shutdown budget is already spent — `remaining > 0 && remaining < timeout` leaves the full 2s `FlushTimeout` in effect when the deadline has passed, blocking process exit up to 2s past an exhausted budget. [`observability/sentry.go:97-101`]
- [x] [Review][Defer] Captured panic stacktrace points at the defer-site funnel, not the panic origin — `hub.Recover` builds the stack at `CapturePanic`; the real `debug.Stack()` is discarded. [`observability/sentry.go:185`] — deferred, documented tradeoff (raw stack is in request-scoped stdout per DD6, joinable by request_id).
- [x] [Review][Defer] Worker captures during shutdown can post-date the flush — `cancelWorker()` does not await the claim/sweep loops, so a late `CaptureError` can fire after `flushSentry` returns and be dropped. [`cmd/api/main.go:1176-1180`] — deferred, narrow window; awaiting workers is a larger change weighed against value.
- [x] [Review][Defer] Auth-stage captures carry only `request_id` (no tenant/HTTP tags) — they fire inside `ExtractTenant` before tenant context exists and omit `WithHTTPTags`. [`middleware/auth.go:69,92,102,124`] — deferred, inherent to pre-tenant capture; `request_id` is the Done-when join key and is present.
- [x] [Review][Defer] Incidental `go.mod`/`go.sum` churn beyond sentry-go — `excelize/v2` promoted indirect→direct plus `golang.org/x/*` bumps rode along a `go mod tidy`. [`go.mod`] — deferred, verify intentional; not a code defect.

## Dev Notes

### What this story must preserve (read before editing the funnels)
- `error_mapper.go` is the **only** panic recovery for `ErrorMapper`-wrapped routes and the single envelope mapper. Capture is **additive** — it must not change which status/code/envelope is written, must not swallow the existing `slog.Error` lines, and must not slow the response path (capture is fire-and-forget to the SDK's async transport). The panic arm must still re-panic nothing and still write the 500.
- `dispatcher.go` tenant handling (`setTenant`, `logCenterDiscrepancy`) is SEC-6-load-bearing. Read `center_id` from the **claimed row's** context, never the payload. Capture tagging reuses the id already in hand at `:126`; do not re-derive it from the payload.
- The global logger is the **redacting** handler. If you add any Sentry breadcrumb/log bridge (you shouldn't — out of scope), it must not bypass `internal/logging/redact.go`.

### Constraints (project-context.md)
- **EDGE-4**: Gemini API key / prompt content / user PII never logged or transmitted. The `beforeSend` scrubber is the enforcement point — this is the whole point of R-11-6.
- **GO-4**: propagate the incoming context into capture; never `context.Background()` (breaks request_id/tenant correlation — the thing we're building).
- **SEC-6**: worker capture re-establishes tenant from the job row.
- **CQ-3**: `TracesSampleRate` and the flush timeout are named constants, not magic numbers. **CQ-4**: package `observability` (no `obs`/`telem` abbreviation); file `sentry.go`.
- **Dependency convention** (project-context Vite/Go rules): a new third-party dep (`sentry-go`) is flagged for human review in the PR.
- **No api.yaml, no migration, no sqlc** → **do NOT run `scripts/codegen.sh`** (WF-3). This is additive infra; single-service-ish but touches web (regression test) + ops doc — one PR is fine (not a breaking cross-service change, WF-4 additive).

### Testing standards
- **BE capture tests**: use `sentry-go` `ClientOptions.Transport = <in-memory mock>` so events are asserted in-process with no network/DSN. Drive through a real `newStorySrv`-style chain so `ErrorMapper` + `request_id` middleware actually run (TEST-BE-3 — handler tests are integration tests with real middleware). Assert: event count, `request_id` tag == response `X-Request-ID`, tenant tags present, **and the negative** — body/headers/secrets absent (for every positive PII assertion write the paired negative, per Test Meta-Rules).
- **Worker capture test**: use `internal/test/workers/harness.go`; trigger a terminal fail / panic job and assert the captured event carries `center_id` and no payload content.
- **4xx-not-captured test** (AC3): return a `ForbiddenError`, assert transport captured zero events.
- **FE (AC7)**: spy `Sentry.init`, call `initSentry()` with a stubbed `VITE_SENTRY_DSN`, assert integrations exclude replay. Use `tsc -b` as the typecheck gate (not `tsc --noEmit`).
- Empty-DSN path (DD4) must be covered: Init returns no-op + nil, no events, suite green.

### Project Structure Notes
- New package `internal/observability/` sits beside `internal/logging/` (both cross-cutting infra, imported by `cmd/api/main.go`, `internal/middleware`, `internal/worker`). No layer violation (GO-3): it's infra, not a Store/Service/Handler tier — importable from any layer like `logging`.
- No conflict with the `event` bus (`internal/event/`) — unrelated; events are domain, this is error telemetry.

### References
- [Source: _bmad-output/planning-artifacts/epics/epic-11.md#Story 11-0a] (lines 481-502) — story prose, "Done when".
- [Source: _bmad-output/planning-artifacts/epics/epic-11.md#Resolved] (lines 929-932) — replay OFF, masking precondition.
- [Source: _bmad-output/planning-artifacts/architecture.md] — observability (248, 266-267), request_id propagation (521), slog levels (514-521), error envelope + requestId (425, 511).
- [Source: docs/project-context.md] — EDGE-4, GO-4, SEC-6, CQ-3/4, WF-3/WF-9, dependency review.
- [Source: memory project_epic_11_docs_and_qa_loop] — v0.3/v0.4 rulings: promotion, blindness-is-the-gate, replay-off, log-retention, precede-L1.
- Code anchors: all `file:line` references in the Reuse Map above (verified 2026-10-10 against baseline a1bc4d7).

## Definition of Done
- [x] AC1–AC8 met; Task 0 ATDD red tests existed on the branch before in-progress and are now green.
- [x] `go build ./...` and `go test ./...` green (API — sole failure is the pre-existing, baseline-confirmed `TestInbox_MarkAllRead…` DB-residue test, unrelated to 11-0a); `tsc -b` and `vitest` green (web); full suite green with an **empty** DSN (DD4).
- [x] A deliberately triggered backend error is demonstrably captured with its `request_id` tag (`TestSentry_AC2_*` + `TestErrorCapture_AC2_*` are the proof).
- [x] `ScrubEvent`/beforeSend scrubber verified by the AC4 negative value-scan (no body/PII/secrets in captured events).
- [x] New dep `getsentry/sentry-go` (v0.50.0, direct) flagged for human review in the PR description.
- [x] `docs/manual-setup.md` has the `## Sentry (Story 11-0a)` section; prod columns left `[ ]` until cutover (WF-9 — never pre-mark prod).
- [x] No `scripts/codegen.sh` run; no api.yaml/migration/sqlc diff.
- [x] Completion notes written to `11-0a-backend-error-tracking-and-telemetry-completion-notes.md` (story-conventions split).

## Out of Scope
- **Session replay / PII masking config** — replay stays OFF (DD5); masking work is deferred until the consent/jurisdiction question is answered. This story locks "off", it does not build masking.
- **Full slog→Sentry bridge / breadcrumb pipeline** — capture is explicit at the error funnels only (DD1/DD6). Architecture mentions "breadcrumbs include request_id"; the request_id **tag** satisfies searchability. A breadcrumb bridge is a future enhancement.
- **Capture for routes outside `ErrorMapper`** — `/health`, OAuth 302 redirects, Polar webhook (DD7). Only the `auth.go` transient-500s are covered.
- **Performance/tracing tuning, transaction sampling, dashboards, alerts** — a low traces sample rate is set; alert rules and a log-drain pipeline are ops follow-ups (DD6).
- **Frontend re-instrumentation** — the FE is already correct; only the replay regression-lock test + DSN provisioning are in scope.
- **Sentry source-map upload / `@sentry/vite-plugin`** — readable FE stack traces in prod is a nice-to-have follow-up, not required for the request_id-searchable bar.
- **CI `VITE_RELEASE_SHA`=commit-SHA wiring** — include if trivial in the deploy env; otherwise note as a follow-up (the `.env.example` comment already claims CI does this but it does not).

## Change Log
| Date | Change | Author |
|---|---|---|
| 2026-10-10 | Story created from FU-11-SENTRY promotion (Epic 11 v0.3/v0.4). ACs engineered from epic prose + exhaustive code recon (baseline a1bc4d7). WF-8 hard gate on R-11-6. Status → ready-for-dev. | Amelia (create-story) |
| 2026-10-10 | Implemented Tasks 1–8 (AC1–AC8). New `internal/observability` pkg (sentry-go v0.50.0, direct dep — HUMAN REVIEW); allowlist `ScrubEvent` (R-11-6); capture at error_mapper + auth + worker funnels; flush-on-shutdown; `config.ReleaseSHA`; FE replay-off lock; `manual-setup.md` Sentry section. ATDD reds adapted to v0.50.0 API (Transport +FlushWithContext/Close, Extra→Contexts) + tags stripped → all green. Gates green (one pre-existing unrelated DB-residue failure). Impl record in [completion-notes](./11-0a-backend-error-tracking-and-telemetry-completion-notes.md). Status → review. | Amelia (dev-story) |
| 2026-10-11 | Code review (3-layer adversarial). All 8 ACs verified SATISFIED. 5 patches applied (2 from Decisions): (1) `CapturePanic` now wraps `rec`→exception so a string/non-error panic no longer leaks into `event.Message`, + `ScrubEvent` hardened to drop `event.Message`/`event.Spans` and redact `event.Transaction` — closes the R-11-6 scrubber hole; (2) `BeforeSendTransaction: ScrubEvent` so sampled transactions can't egress unscrubbed; (3) flush clamps to 0 when the shutdown budget is spent; (4) throttled worker infra/discovery/`recoverLoop` capture (`captureInfra`, 1/min per funnel, skips shutdown cancellation) — closes worker-side blindness; (5) non-PII `error_type` tag + custom fingerprint (+ `reason` tag on terminal fails) so blanked exception values no longer collapse Sentry grouping. 4 findings deferred (panic origin-stack, shutdown flush race, auth-stage tag depth, go.mod churn) → `deferred-work.md`. Gates: build/vet/gofmt clean; observability + worker + middleware tests green (sole failure is the pre-existing `TestInbox_MarkAllRead` DB-residue). Status → done. | Amelia (code-review) |
