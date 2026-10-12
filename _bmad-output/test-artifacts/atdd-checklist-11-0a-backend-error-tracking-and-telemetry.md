---
stepsCompleted: ['step-01-preflight-and-context', 'step-02-generation-mode', 'step-03-test-strategy', 'step-04-generate-tests', 'step-05-validate-and-complete']
lastStep: 'step-05-validate-and-complete'
lastSaved: '2026-10-10'
storyId: '11.0a'
storyKey: '11-0a-backend-error-tracking-and-telemetry'
storyFile: '_bmad-output/implementation-artifacts/11-0a-backend-error-tracking-and-telemetry.md'
atddChecklistPath: '_bmad-output/test-artifacts/atdd-checklist-11-0a-backend-error-tracking-and-telemetry.md'
detectedStack: 'fullstack'
generationMode: 'ai-generation'
redVerified: true
generatedTestFiles:
  - 'classlite-api/internal/test/sentry_capture_atdd_test.go'
  - 'classlite-api/internal/middleware/error_capture_atdd_test.go'
  - 'classlite-web/src/lib/__tests__/sentry-replay-off.test.ts'
inputDocuments:
  - '_bmad-output/implementation-artifacts/11-0a-backend-error-tracking-and-telemetry.md'
  - '_bmad-output/planning-artifacts/epics/epic-11.md (Story 11-0a; Resolved: replay-off)'
  - 'classlite-api/internal/middleware/error_mapper.go (:77-88 panic, :538-543 unhandled)'
  - 'classlite-api/internal/config/config.go (:19/:163 SentryDSN)'
  - 'classlite-api/internal/model/tenant.go + ctxkey.go (TenantContext, RequestID)'
  - 'classlite-web/src/lib/sentry.ts + src/lib/__tests__/sentry-breadcrumb.test.ts'
  - 'docs/project-context.md (EDGE-4, GO-4, SEC-6; reference_atdd_red_convention; privacy-strip value-scan)'
---

# ATDD Red-Phase Checklist — Story 11-0a (Backend Error Tracking & Request-Scoped Telemetry)

**Stack:** backend (Go) primary + a frontend regression-lock. **Mode:** AI generation (backend — no browser recording). **Convention:** Go reds use `//go:build atdd_red_phase` tagged-compile-fail (excluded from the normal suite; dev strips the tag per file as each seam lands green). FE AC7 ships as a **green characterization lock**, not a red (behavior is already correct; the risk is *future* regression).

**WF-8 HARD GATE SATISFIED FOR ENTRY TO in-progress:** the ACs map to **R-11-6 ≥6** (Sentry PII over student submissions/grades, minors plausible). The red specimen for the gating AC (**AC4 — the beforeSend scrubber**) plus the capture-correctness ACs (AC2/AC3/AC5) are on the branch. Story stays `ready-for-dev`; next is `/bmad-dev-story 11-0a`.

## Red / lock files (3) — specimen → file

| Task-0 | AC / Risk | File |
|---|---|---|
| 0.1 | **AC4** / R-11-6 ≥6 · AC2 · AC5 · AC1 · AC6 | `classlite-api/internal/test/sentry_capture_atdd_test.go` — **unit, no DB**. `ScrubEvent` value-scan (essay/Bearer/cookie/prompt/API-key/SigV4 all absent, operator tags survive); `CaptureError` tags request_id+center_id+user_id from HTTP ctx; worker ctx (center_id, no request_id) tagged + scrubbed (SEC-6); empty-DSN `Init` → nil err + callable flush. |
| 0.2 | **AC2** (funnel wiring) · **AC3** | `classlite-api/internal/middleware/error_capture_atdd_test.go` — `package middleware_test`, mock transport + real `ErrorMapper`. Panic → 1 event w/ request_id tag; unhandled error → 1 event; mapped Forbidden/NotFound/Validation → **0** events (+ correct 4xx status). |
| 0.3 | **AC7** (replay-off lock) | `classlite-web/src/lib/__tests__/sentry-replay-off.test.ts` — **GREEN lock** (not red). `initSentry()` with a DSN → no replay integration, no `replays*SampleRate`; DSN unset → `init` not called. |

**Not red-tested (verified green inline by dev / by review):** AC8 (manual-setup.md doc — reviewed, not a code test). AC6 flush-on-shutdown wiring (`main.go:1157-1167`) — the *flush-callable* contract is pinned in 0.1; the shutdown *call-site* is a green seam verified by inspection in dev-story.

## GREEN-PHASE SEAM CONTRACT (the reds ARE the contract — dev implements to match)

### New dependency (Task 1)
- `go get github.com/getsentry/sentry-go` + `go mod tidy`. **Flag for human review** in the PR (new direct dep).

### New package `internal/observability/sentry.go` (Task 1)
```go
package observability

// Init wraps sentry.Init. EMPTY DSN → non-nil no-op flush + nil error (DD4 —
// server never fails-fast on a missing/bad DSN; dev + full suite stay green).
// On a valid DSN: Environment = cfg.AppEnv, Release = cfg.ReleaseSHA (optional),
// a named low TracesSampleRate const, BeforeSend = ScrubEvent. No replay (N/A BE).
func Init(cfg config.Config) (flush func(context.Context), err error)

// ScrubEvent is the BeforeSend hook (DD3 ALLOWLIST, the R-11-6 guardrail):
//   - drop event.Request wholesale (body, cookies, Authorization/Cookie headers)
//   - drop event.Extra
//   - run surviving strings (Message, Exception values) through the existing
//     internal/logging SigV4/presigned-URL redaction
//   - KEEP only the operator-safe tags (request_id/center_id/user_id/route/method/status)
// Returns the event (never nil — events still send, only scrubbed).
func ScrubEvent(event *sentry.Event, hint *sentry.EventHint) *sentry.Event

// CaptureError / CapturePanic read model.RequestID + model.TenantFromContext from
// the INCOMING ctx (GO-4; never context.Background) and set request_id/center_id/
// user_id as TAGS (DD2). Only non-empty values are set. Fire-and-forget to the
// SDK's async transport (never block the request/worker path).
func CaptureError(ctx context.Context, err error)
func CapturePanic(ctx context.Context, rec any, stack []byte)
```
Capture uses `sentry.GetHubFromContext(ctx)` falling back to `sentry.CurrentHub()` so a request-scoped hub is honored when present; tests install the global client via `sentry.Init(ClientOptions{Transport: <mock>, BeforeSend: ScrubEvent})`.

### Config (Task 2)
- Add optional `ReleaseSHA string` = `getEnv("RELEASE_SHA", "")` to `internal/config/config.go`; include in `LogSummary()` (raw — a SHA is not a secret). `SentryDSN` stays optional in `Validate()` (no severity change).

### Wiring (Tasks 3–5)
- `cmd/api/main.go:44` (right after slog): `flush, err := observability.Init(cfg)` — on err, `slog.Warn` and continue (DD4). `cmd/api/main.go:1157-1167` shutdown block: bounded `sentry.Flush` (named timeout const, ~2s).
- `internal/middleware/error_mapper.go`: panic arm (`:77-88`) → `observability.CapturePanic(r.Context(), rec, debug.Stack())`; unhandled/default arm (`:538-543`) → `observability.CaptureError(r.Context(), err)`. **Mapped 4xx arms get NO capture call (AC3).** Also add `observability.CaptureError` to the direct-500 paths in `internal/middleware/auth.go:66,88,97,118,157-168`.
- `internal/worker/dispatcher.go`: `runRecovered` (`:534-542`) + `recoverLoop` (`:526-530`) + `terminalFail` (`:239-262`) → capture with the per-job tenant ctx (`center_id` from the claimed row, SEC-6 — never the payload).

### Frontend (Task 6)
- No runtime change expected (`src/lib/sentry.ts` already has no replay). The green lock file above is the deliverable; keep it passing.

### Ops (Task 7) — not a code test
- `docs/manual-setup.md` `## Sentry (Story 11-0a)`: `SENTRY_DSN` (api) + `VITE_SENTRY_DSN` (web) per Dev/Staging/Prod, replay-disabled verify row, log-retention decision row, `RELEASE_SHA`. Prod columns stay `[ ]` until cutover (WF-9).

## Test levels & priorities (step-03)

| AC | Level | Priority | Rationale |
|---|---|---|---|
| AC4 scrub | Unit (observability) | **P0** | R-11-6 ≥6 — the leak gate. Lowest level that can prove the security property. |
| AC2 tags | Unit | P0 | "Searchable by request_id" is the Done-when. |
| AC5 worker | Unit | P0 | SEC-6 — async events carry tenant, scrub applies. |
| AC2 wiring / AC3 | Integration (middleware) | P0 | Proves the funnel is actually wired and 4xx stays quiet. |
| AC1/AC6 | Unit | P1 | DD4 empty-DSN safety; flush contract. |
| AC7 replay-off | Unit (vitest) | P1 | Green regression lock over already-correct FE. |

Prefer-lower-level honored: the security property (AC4) and the tag mechanism (AC2/AC5) are proven at **unit** level against the capture helper; only the funnel-wiring claim (does `ErrorMapper` actually call capture?) needs the **integration** level.

## RED verification (2026-10-10)

```
# (a) normal build EXCLUDES the tagged reds — suite stays green
$ go test -count=1 -run 'TestSentry_|TestErrorCapture_' ./internal/test/ ./internal/middleware/
ok  github.com/ducdo/classlite-api/internal/test        [no tests to run]
ok  github.com/ducdo/classlite-api/internal/middleware  [no tests to run]

# (b) WITH the tag → compile-fail = RED confirmed
$ go test -tags atdd_red_phase -run 'TestSentry_|TestErrorCapture_' ./internal/test/ ./internal/middleware/
internal/test/sentry_capture_atdd_test.go:50:2: no required module provides package
  github.com/ducdo/classlite-api/internal/observability
FAIL  [setup failed]   # + github.com/getsentry/sentry-go surfaces once the pkg exists

# (c) FE replay-off green lock
$ npx vitest run src/lib/__tests__/sentry-replay-off.test.ts
Test Files  1 passed (1)   Tests  2 passed (2)
```

The Go reds progress red→green in two moves: (1) `go get sentry-go` + create the `observability` package → files compile under the tag; (2) wire the capture call-sites → tests pass; then strip the `//go:build atdd_red_phase` tag per file.

## Assumptions / risks for dev

- **Global Sentry client in tests** — `sentry.Init` with a mock transport mutates the process-global hub. The helpers re-init per test and `t.Cleanup(Flush)`; keep tests non-parallel within the capture files.
- **SigV4 preservation seam** — `ScrubEvent` must compose with `internal/logging` redaction, not replace it. The AC4 value-scan asserts the *security property* (signature absent); if green drops the whole Message that also passes — acceptable, but prefer composing the redaction so non-sensitive error text survives for triage.
- **Pre-existing web typecheck noise** (RealTeacherDashboard/StudentDashboard/OwnerDashboard implicit-any, attemptReadOnly unused import, ClassFormDialog `BillingSummary`) is **unrelated to 11-0a** — untouched files; do not fold fixes into this story.
