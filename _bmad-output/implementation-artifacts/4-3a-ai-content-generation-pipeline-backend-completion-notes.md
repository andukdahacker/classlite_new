# Story 4-3a: Completion Notes

_Implementation record for [`4-3a-ai-content-generation-pipeline-backend.md`](./4-3a-ai-content-generation-pipeline-backend.md). Status: review._

## Dev Agent Record

### Debug Log

- **Ledger `ref_job_id` FK vs append-only (T2).** First cut made `ref_job_id` a real FK to `jobs(id)` per the A6 DDL. The store RLS scaffolds insert ledger rows with fabricated job ids → FK violation, AND `ON DELETE CASCADE` on that FK would silently delete credit history when a job is removed (contradicting the SEC-9 append-only guarantee). Resolved by making `ref_job_id` a **soft pointer (plain uuid, no FK)**; idempotency is still enforced by the unique `(ref_job_id, reason)` index. Rolled back + re-applied the uncommitted local migration (not editing a shipped one).
- **Partial unique index vs `ON CONFLICT` inference (T2).** The refund query is `INSERT … ON CONFLICT (ref_job_id, reason) DO NOTHING` with no WHERE predicate; a *partial* unique index (`WHERE ref_job_id IS NOT NULL`) can't be inferred → `42P10`. Switched to a **full** unique index (NULLs are distinct, so 6.5's null-ref grant rows still stack).
- **Cross-tenant claim vs RLS (T5).** The dispatcher must find work across tenants, but the per-job PROCESSING must run under RLS. Split the two: unit path (`ProcessOnce`/`SweepStuckJobs`) claims under the already-set tenant (RLS-scoped, deterministic, no cross-package contamination); production `Start` discovers ready/stuck centers via two `SECURITY DEFINER` functions (`next_ready_job_center`, `stuck_job_centers`, returning ONLY center_ids, search_path pinned), then runs the same RLS-scoped claim/sweep in a per-job tenant tx.
- **Handler DI without a jobID (T6/T9).** `JobHandler.ProcessTask(ctx, tc, payload)` returns only `error` and never sees the jobID, so handlers cannot write `jobs.result`. Split responsibilities: the handler's unexported `generate()` returns the result fragment; the dispatcher (which holds the jobID) captures it and calls `MarkJobComplete`. `ProcessTask` is the thin adapter the 3-pattern harness drives (runs `generate`, discards result). Production `generate` is called by the dispatcher with the per-job tx (`exec`), so the handler's bound db is irrelevant in production.
- **HappyPath seeded without tenant (T9/T10).** `seedExerciseForTenant` (scaffold) is called in HappyPath with no prior `TenantContext`, so the RLS exercise INSERT would fail. Moved seeding into `testpkg.SeedExerciseForWorker` (sets tenant to centerID first) and delegated the scaffold helper to it; removed two now-redundant pre-seed `TenantContext(B)` calls in the Payload-ignored scaffolds (which also passed `uuid.UUID` where `pgtype.UUID` was wanted).
- **Config `Validate()` ordering (T4).** Adding `GEMINI_API_KEY` to the non-dev required-missing list fired before the JWT-length branch; updated the two config-test fixtures (`productionBase`, the short-JWT case) to carry the key.

### Completion Notes

Shipped the entire 4.3a backend:

- **Migrations:** `jobs` (job_status enum, RLS null-guard grid, `idx_jobs_status_created_at`), `ai_credit_ledger` (append-only via `REVOKE UPDATE/DELETE/TRUNCATE`, full unique `(ref_job_id, reason)`, RLS select/insert), and two `SECURITY DEFINER` dispatch functions.
- **Data layer:** `store/queries/jobs.sql` (Insert/Get/Claim-SKIP-LOCKED/MarkComplete/MarkFailedTerminal/Reschedule/FindStuck — all binding `clock.Now()`, never SQL `now()`) + `ai_credit_ledger.sql` (deduction + idempotent refund derived from the deduction row). `model/job_types.go` + `model/ai_response.go`.
- **Gemini:** `gemini.Client` interface + real REST `generateContent` client (key sent only to Google, never logged) + `MockClient` (5 modes). Raw `net/http` (no SDK dependency — consistent with the stdlib-only ethos; no `go.mod` addition to flag).
- **Worker:** `internal/worker` dispatcher (claim → tenant-from-row → dispatch → complete / reschedule-with-backoff / terminal-fail+refund), 3 `ai_generate_*` handlers (typed parse → map → `ValidateExerciseContentStructural` → result), stuck-sweep, panic recovery per job, `Start` wired at `main.go` beside the email-retry worker under the shared `workerCtx` (drains on `cancelWorker()`).
- **Service/handler:** single-tx enqueue (job insert + −1 deduction) → 202; RLS-scoped poll → typed envelope / 404 JOB_NOT_FOUND. `api.yaml` two endpoints + schemas; `codegen.sh` regenerated Go + `client.ts` (Zod emitter still disabled project-wide per story-1-8 TODO).
- **Harness (T9):** migrated in-memory → real `jobs` table; public API unchanged; `harness_test.go` green untouched.

**Test result:** `go test ./...` = 12 pkg / 0 fail; `go vet ./...` clean; `gofmt -l` clean on all new files. All ~34 ATDD red tests now green (tags stripped) + the SKIP-LOCKED contention companion.

**Deferrals (see FU-4-3-A):** 4.3b frontend; Story 6.5 credit guard/balance-cache/UI + `SumCenterUserBalance`; Epic 6 grading handlers; enqueue p95 k6 check; CI secret grep-scan.

**Deviations from spec:** `ai_credit_ledger.ref_job_id` is a soft pointer, not the A6 FK (append-only correctness — see Debug Log + FU-4-3-A); `SumCenterUserBalance` not minted (no 4.3a consumer — YAGNI, balance computed inline).

### Implementation Plan (as executed)

1. T1/T2 migrations → `migrate.sh` → AC9 store RLS tests green.
2. Model types + Gemini client/mock.
3. `.sql` queries → `sqlc generate`.
4. Worker handlers + mapping + dispatcher; dispatch-function migration.
5. T9 harness migration + T7 service/handler + test helpers.
6. Worker (AC3/5/6/7/8) + handler (AC1/2) ATDD green; strip tags.
7. T8 `api.yaml` + full `codegen.sh`.
8. T4 config env + `main.go` wiring + `.env.example`/`manual-setup.md`.
9. SKIP-LOCKED companion; full-suite + gofmt/vet green.

## File List

### Added

- `classlite-api/migrations/20260728120000_create_jobs.{up,down}.sql`
- `classlite-api/migrations/20260728130000_create_ai_credit_ledger.{up,down}.sql`
- `classlite-api/migrations/20260728140000_create_job_dispatch_functions.{up,down}.sql`
- `classlite-api/internal/store/queries/jobs.sql`, `ai_credit_ledger.sql`
- `classlite-api/internal/store/generated/jobs.sql.go`, `ai_credit_ledger.sql.go` (codegen)
- `classlite-api/internal/model/job_types.go`, `ai_response.go`
- `classlite-api/internal/gemini/client.go`, `mock.go`
- `classlite-api/internal/worker/ai_generate.go`, `ai_generate_mapping.go`, `dispatcher.go`, `dispatcher_skiplocked_test.go`
- `classlite-api/internal/service/ai_generation_service.go`
- `classlite-api/internal/handler/ai_generation_handler.go`
- `classlite-api/internal/test/story_4_3a_helpers.go`
- `_bmad-output/implementation-artifacts/4-3a-…-completion-notes.md` (this file)

### Modified

- `classlite-api/internal/test/workers/harness.go` — in-memory → real `jobs` table (T9); public API unchanged.
- `classlite-api/internal/worker/{ai_generate,credit_refund,secret_logging}_atdd_test.go`, `internal/handler/ai_generation_handler_atdd_test.go`, `internal/test/{jobs,ai_credit_ledger}_rls_atdd_test.go` — stripped `atdd_red` tag (green-phase); minor scaffold helper fixes in `ai_generate_atdd_test.go`.
- `classlite-api/internal/config/config.go` + `config_test.go` — `GEMINI_API_KEY`/`GEMINI_MODEL`.
- `classlite-api/cmd/api/main.go` — dispatcher wiring + 2 routes.
- `classlite-api/api.yaml` + `classlite-web/src/lib/api/client.ts` — enqueue/poll + Job schemas (codegen).
- `.env.example`, `docs/manual-setup.md` — Gemini env (WF-9).
- `_bmad-output/implementation-artifacts/{deferred-work.md,sprint-status.yaml}` — FU-4-3-A + status.

### Deleted

- `classlite-api/internal/gemini/doc.go`, `internal/worker/doc.go` — placeholder stubs (real source landed).
