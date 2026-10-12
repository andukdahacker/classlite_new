# Story 11-0a: Completion Notes

_Implementation record for [`11-0a-backend-error-tracking-and-telemetry.md`](./11-0a-backend-error-tracking-and-telemetry.md). Status: review._

## Dev Agent Record

### Debug Log

- **sentry-go API drift (two hits).** The Task-0 ATDD reds were scaffolded against an older `getsentry/sentry-go` API. The latest release (v0.50.0, the one `go get` resolves) differs in two ways that broke compilation when the `atdd_red_phase` tag was stripped:
  1. The `Transport` interface gained `FlushWithContext(context.Context) bool` and `Close()` — the red mocks implemented only `Flush/Configure/SendEvent`. Added the two methods to both mock transports (`sentry_capture_atdd_test.go`, `error_capture_atdd_test.go`). No assertion changed.
  2. The `Event.Extra` field was removed. The AC4 scrub specimen set `event.Extra = map[string]any{prompt, api_key}`; swapped it to `event.Contexts` (the v0.50.0 carrier for arbitrary attached data). The scrubber drops `Contexts` wholesale, so the assertion (prompt + api_key absent) is unchanged.
- **AC5 forced the scrubber posture.** The AC5 red passes `errors.New("job failed: SECRETSUBMISSIONTEXT")` and asserts the text is absent from the captured event. SigV4 redaction cannot catch arbitrary text, so `ScrubEvent` **blanks exception `Value` outright** (keeps `Type` + stacktrace). This is the intended R-11-6 allowlist posture: Sentry carries tags + error type + code-location stacktrace, never free-form error/submission text; triage detail lives in the request-scoped (redacted) stdout logs, joined by the `request_id` tag (DD6). Documented inline in `ScrubEvent`.
- **Worker Go ctx carries no tenant.** The dispatcher sets tenant via SQL `set_config` (not the Go context), so `model.TenantFromContext` is empty at the worker capture sites. Added `workerTenantCtx(ctx, centerID)` which injects `TenantContext{CenterID}` from the claimed ROW (SEC-6) before capture — proven by the `TestWorkerCapture_AC5` dispatcher integration test, not just the unit helper.
- **Pre-existing suite failure (NOT this story).** `internal/test.TestInbox_MarkAllRead_CallerScoped_ArchivedStaysUnread_ATDD` fails with `duplicate key … idx_users_email` at seed time — confirmed identical on the clean baseline `a1bc4d7` (git-stash check). It is test-DB residue (the Story 11-1a test-database-lifecycle defect), not a 11-0a regression. Every other test in `internal/test` passes with it skipped, and every package 11-0a touched is green.

### Completion Notes

- Shipped backend Sentry over the existing substrate — **no new endpoint, no api.yaml, no migration, no sqlc, no codegen** (WF-3 honored). The one new direct dep is `github.com/getsentry/sentry-go v0.50.0` — **flag for human review** in the PR.
- `internal/observability/sentry.go`: `Init` (empty-DSN no-op, DD4) · `ScrubEvent` (allowlist BeforeSend, R-11-6) · `CaptureError`/`CapturePanic` (ctx-read tags, GO-4/DD2) · `WithHTTPTags` (operator-safe route/method/status). Named consts `tracesSampleRate`, `FlushTimeout` (CQ-3).
- Capture wired at: `error_mapper.go` panic arm + unhandled/500 default arm (mapped 4xx get NO capture — AC3/DD1); `auth.go` four transient-500 paths; `dispatcher.go` `processClaimed` + `runInTenantTx` job-error sites + `terminalFail`. `recoverLoop` left slog-only (process-level panic, no tenant ctx, outside AC5's per-job scope — documented).
- `auth.go:157-168` (403 INVALID_TENANT_CLAIM) deliberately **not** captured — a stale/invalid tenant claim is a business rejection, not an incident (AC3/DD1 analog). The reuse map's `:157-168` reference is the swallowed audit-log write, which is intentionally non-fatal (R4).
- Flush on graceful shutdown (`main.go`, bounded by `shutdownCtx`, AC6). Empty DSN → flush is a no-op.
- `config.ReleaseSHA` (`getEnv("RELEASE_SHA","")`, raw in `LogSummary`, optional in `Validate`).
- FE: no runtime change (replay already absent). `sentry-replay-off.test.ts` is the green regression lock (AC7, 2 passed).
- `docs/manual-setup.md` → new `## Sentry (Story 11-0a)` section: `SENTRY_DSN`/`VITE_SENTRY_DSN`/`RELEASE_SHA`/`VITE_RELEASE_SHA` per-env rows, replay-disabled verify row, log-retention decision row; prod columns `[ ]` (WF-9). The bare cross-cutting `SENTRY_DSN` row now points to it.

### AC → evidence

| AC | Evidence |
|---|---|
| AC1 init/no-op | `TestSentry_AC1_Init_EmptyDSN_NoOpNoError` + `main.go` Init wiring |
| AC2 capture + request_id tag | `TestSentry_AC2_*` + `TestErrorCapture_AC2_Panic*` / `_UnhandledError_*` |
| AC3 4xx not captured | `TestErrorCapture_AC3_MappedErrors_AreNotCaptured` (forbidden/notfound/validation) |
| AC4 scrub (R-11-6) | `TestSentry_AC4_ScrubEvent_StripsBodyHeadersPIISecrets` (value-scan) |
| AC5 worker + tenant | `TestSentry_AC5_*` (unit) + `TestWorkerCapture_AC5_TerminalFail_TaggedWithCenterID` (real dispatcher) |
| AC6 flush on shutdown | `main.go` `flushSentry(shutdownCtx)` + AC1 flush-callable assertion |
| AC7 replay off + locked | `classlite-web/src/lib/__tests__/sentry-replay-off.test.ts` (2 passed) |
| AC8 ops activation | `docs/manual-setup.md` `## Sentry (Story 11-0a)` |

### Implementation Plan (summary)

1. `go get getsentry/sentry-go` + `go mod tidy` (promoted to direct require).
2. `logging.RedactString` export (reuse the single SigV4 pattern, compose not replace — AC4).
3. `internal/observability/sentry.go` (Init/ScrubEvent/CaptureError/CapturePanic/WithHTTPTags).
4. `config.ReleaseSHA`.
5. `main.go` Init-after-LogSummary + flush-on-shutdown.
6. HTTP capture: `error_mapper.go` (panic + default arm) + `auth.go` (4 transient-500s).
7. Worker capture: `dispatcher.go` (processClaimed + runInTenantTx + terminalFail) via `workerTenantCtx`.
8. Strip `atdd_red_phase` tags + adapt mock transports to v0.50.0; add the AC5 dispatcher integration test.
9. Gates: `go build`/`go vet`/`gofmt`/`go test ./...` (API), `tsc -b` + `vitest src/lib` (web).

## File List

### Added
- `classlite-api/internal/observability/sentry.go` — the new cross-cutting telemetry package (Init/ScrubEvent/CaptureError/CapturePanic/WithHTTPTags).
- `classlite-api/internal/worker/sentry_worker_capture_test.go` — AC5 real-dispatcher integration test (terminal-fail → center_id-tagged event, scrubber applied).
- `classlite-api/internal/test/sentry_capture_atdd_test.go` — Task-0 ATDD unit specimen (AC1/AC2/AC4/AC5/AC6); tag stripped + adapted to sentry-go v0.50.0, now green.
- `classlite-api/internal/middleware/error_capture_atdd_test.go` — Task-0 ATDD funnel-wiring specimen (AC2/AC3); tag stripped + transport completed, now green.
- `classlite-web/src/lib/__tests__/sentry-replay-off.test.ts` — Task-0 AC7 green regression lock (replay stays OFF).

### Modified
- `classlite-api/internal/config/config.go` — `ReleaseSHA` field + `Load()` + `LogSummary()` (raw).
- `classlite-api/internal/logging/redact.go` — exported `RedactString` for the Sentry scrubber (same SigV4 pattern).
- `classlite-api/internal/middleware/error_mapper.go` — capture at panic arm (`CapturePanic`) + unhandled/500 default arm (`CaptureError`); mapped 4xx untouched.
- `classlite-api/internal/middleware/auth.go` — `CaptureError` at the four transient-500 paths.
- `classlite-api/internal/worker/dispatcher.go` — `workerTenantCtx` helper + capture at `processClaimed`/`runInTenantTx` job-error sites + `terminalFail`.
- `classlite-api/cmd/api/main.go` — `observability.Init` after `LogSummary()` (warn-and-continue) + bounded `flushSentry` in the shutdown block.
- `classlite-api/go.mod` / `classlite-api/go.sum` — `getsentry/sentry-go v0.50.0` (new direct dep — HUMAN REVIEW).
- `docs/manual-setup.md` — `## Sentry (Story 11-0a)` section + cross-cutting pointer row.
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — 11-0a `ready-for-dev` → `in-progress` → `review`.

### Deleted
- None.
