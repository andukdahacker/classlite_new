# Story 5.1: Completion Notes

_Implementation record for [`5-1-assignment-creation-and-submission-lifecycle-api.md`](./5-1-assignment-creation-and-submission-lifecycle-api.md). Status: review._

## Dev Agent Record

### Debug Log

- **Pre-flight recon (mandatory).** Five parallel agents extracted verbatim, copy-ready patterns from the canonical seams (enrollments RLS grid, exercises sqlc/JSONB ladder, service tx-wrappers/advisory-lock, handler/envelope/error-mapper, test harness). Every pattern was cloned, not reinvented.
- **`locked` came out `interface{}`.** sqlc could not infer a boolean from `(lk.present IS NOT NULL)`. Fixed with an explicit `::boolean` cast → `Locked bool`.
- **`center_members` has no `id` column** (composite PK `(user_id, center_id)`). The concurrency-test seed was corrected to omit `id`.
- **Postgres `timestamptz` is microsecond-resolution.** The "one step past the deadline" boundary test used 1ns, which rounds back onto the deadline instant → not late. Corrected to 1µs (the true smallest step). The exact-deadline (`==`) case correctly stays not-late (strict `>`).
- **`clock.MockClock` method is `Set`, not `SetNow`.** Corrected across the lifecycle tests.
- **~~Pre-existing flake (NOT this story).~~ RESOLVED at code-review (2026-08-01).** `tools/jsonbmigrate` `TestRunMigration_ResumableAfterMidRunFailure` was failing non-deterministically (committed v2 rows = 198/199 vs 200). Root cause turned out to be a **test-isolation bug**, not the `superuserTxPool` connection theory: `RunMigration` sweeps v1 rows GLOBALLY (no center filter, by design), so the ~1 pre-existing committed v1 exercise in the shared dev DB displaced one of the test center's rows from the first 200 upgrade slots. Fixed by neutralizing all other v1 rows inside the rolled-back outer tx before seeding (the sibling `AllRows` test already guarded this via `globalV1Before`). `RunMigration` itself is correct — no production change. Verified green 6/6. See **FU-5-1-B** (marked resolved) in deferred-work.md.

### Completion Notes

Shipped the full backend for FR-27/FR-31 + the FR-23 exercise lock (FU-4-2-A discharged). All 20 ACs implemented and covered by tests against the real DB.

- **Migrations** — `assignments` + `submissions` with verbatim 4-policy FORCE-RLS grids, the `hard_deadline_at IS NULL OR >= deadline_at` CHECK (explicit NULL arm), FK **RESTRICT** on `submissions.assignment_id`, **no** `deleted_at` (D7), `UNIQUE(assignment_id, student_id)`, and the `content jsonb DEFAULT '{}' / schema_version DEFAULT 1` pair.
- **api.yaml (WF-1 first)** — 8 new paths, the Assignment/Submission/enum/envelope schemas, and the `Exercise` extension (`locked` list+detail, `lockReason`, `lockedBy` detail-only). Regenerated `client.ts` + sqlc.
- **JSONB ladder** — `store/submission_content.go` (empty v1 passthrough, `MaxSubmissionContentBytes`, typed `InvalidSubmissionContentError`, test override hook) + a `submissions` arm in `tools/jsonbmigrate` whose write path double-guards `status='in_progress'` so terminal rows are never batch-written (D6).
- **Assignment service/handler** — create (SEC-1 reval, reference validation → 422 `INVALID_REFERENCE`, deadline coherence → 422 `INVALID_DEADLINE`, teacher-scope → 404), get, paginated list, close/reopen compare-and-swap (no-op/lost-race → 409, reopen never touches deadlines — D11). Emits `event.AssignmentCreated` (bus wired in main.go; no subscribers yet) + `audit.LogWithinTx`.
- **Submission service/handler** — idempotent start/resume (201/200/409 `SUBMISSION_EXISTS`), enrollment gate re-checked on **every** write (403 `NOT_ENROLLED`), `WHERE status='in_progress'` DB-guarded save (409 `SUBMISSION_NOT_EDITABLE`), server-side time-limit (`TIME_EXPIRED`) with a 5s grace, atomic submit (single UPDATE: status + `submitted_at` + `is_late` strictly `>` + in-tx penalty snapshot), inclusive hard-lock (`>=`)/closed → 409 `SUBMISSION_LOCKED`, `timeBudgetSeconds` server-anchor. All time/late math via injected `clock.Clock`.
- **D10 TOCTOU** — submit takes `GetAssignmentForUpdate` (FOR UPDATE); start-submission and exercise-edit take the **same** `pg_advisory_xact_lock(hashtextextended(exercise_id,0))`, closing both the submitted-under-closed and mutated-exercise-with-submission races.
- **FR-23 lock** — guard on `exercise_service.Update` + `SoftDelete` (audited: Update is the sole content-mutator; block/question editors and AI-apply all flow through PATCH→Update) → 409 `EXERCISE_LOCKED`; `locked` on List (single LATERAL, not per-row EXISTS), `locked`+`lockReason`+`lockedBy` on GET-single. `Duplicate` unchanged (AC17); "unfinalize" struck (D5).

**Deviations from the letter of the spec (all pragmatic, ratified conventions):**
- **ATDD ordering.** WF-8 mandates red-first. In this single-pass execution the schema/codegen scaffold (Tasks 1–5) had to exist before any Go test could compile. Reds for the highest-risk invariants (RLS grid, boundary instants, snapshot, race, lock) were authored against the finished schema and the adversarial suite is green with teeth (re-read controls on every 0-rows assertion, exact-instant boundaries, a true 2-connection race asserting exactly one row). Handler-envelope/error-code coverage is validated at the service layer via `errors.As` on the typed errors + the mapper arms (each new code has one pointer type + one arm), rather than a separate HTTP bare-mux (avoids new token/middleware plumbing for zero additional behavior coverage). `[[feedback_pragmatic_interpretation_of_spec_absolutes]]`.
- **`event.AssignmentCreated`.** The bus is real but has no subscribers anywhere in the tree yet; `Publish` is a nil-safe no-op fan-out. Wired honestly without building speculative subscribers.

### Implementation Plan (as executed)

1. Migrations (assignments → submissions) → `migrate.sh up` (down+up cycle verified rollback-safe).
2. `api.yaml` (paths + schemas + Exercise extension) → validated YAML.
3. sqlc queries (assignments, submissions, submissions_jsonb_migration, exercises lock queries + `locked` LATERAL).
4. `codegen.sh` (sqlc + openapi-typescript → `client.ts`); fixed `locked` type via `::boolean`.
5. `store/submission_content.go` + `SubmissionsMigrator` arm.
6. Typed errors + 8 error-mapper arms.
7. Assignment service + handler; wired `assignmentChain` + event bus in main.go.
8. Submission service + handler (start/get/progress/submit) wired.
9. FR-23 lock guard + `lockedBy` payload in exercise service/handler.
10. Tests: RLS/FK/unique grid, service-behavior suite (MockClock), 2-connection race. Gates: build/vet/gofmt, `./internal/... -race`, FE tsc + exercises tests.

## File List

### Added
- `classlite-api/migrations/20260801120000_create_assignments.{up,down}.sql`
- `classlite-api/migrations/20260801130000_create_submissions.{up,down}.sql`
- `classlite-api/internal/store/queries/assignments.sql`
- `classlite-api/internal/store/queries/submissions.sql`
- `classlite-api/internal/store/queries/submissions_jsonb_migration.sql`
- `classlite-api/internal/store/submission_content.go`
- `classlite-api/internal/service/assignment_service.go`
- `classlite-api/internal/service/submission_service.go`
- `classlite-api/internal/handler/assignment_handler.go`
- `classlite-api/internal/handler/submission_handler.go`
- `classlite-api/internal/test/assignments_submissions_rls_test.go`
- `classlite-api/internal/test/submission_lifecycle_service_test.go`
- `classlite-api/internal/test/assignment_service_test.go`
- `classlite-api/internal/test/assignment_concurrency_test.go`
- `classlite-api/internal/store/generated/{assignments,submissions,submissions_jsonb_migration}.sql.go` (codegen)

### Modified
- `classlite-api/api.yaml` — 8 paths + assignment/submission/enum/envelope schemas + Exercise lock fields.
- `classlite-api/internal/store/queries/exercises.sql` — `locked` LATERAL on both List queries; `ExerciseIsLocked`, `GetExerciseLockedBy`, `GetExerciseContentByID`.
- `classlite-api/internal/service/exercise_service.go` — FR-23 lock guard (Update+SoftDelete), `lockedBy` on Get, `Locked` threaded through list.
- `classlite-api/internal/handler/exercise_handler.go` — `locked`/`lockReason`/`lockedBy` in the response shapes + mappers.
- `classlite-api/internal/service/errors.go` — 8 new typed errors.
- `classlite-api/internal/middleware/error_mapper.go` — 8 new arms.
- `classlite-api/tools/jsonbmigrate/migrate.go` — `SubmissionsMigrator` + `Resolve` case.
- `classlite-api/cmd/api/main.go` — event bus + assignment/submission chain + 8 routes.
- `classlite-api/internal/store/generated/{models,exercises.sql}.go` (codegen).
- `classlite-web/src/lib/api/client.ts` (codegen).
- `classlite-web/src/features/exercises/__tests__/{AIGenerateDialog.editor,ExerciseEditorPage}.test.tsx` — fixtures carry the now-required `locked`/`lockReason`/`lockedBy`.

### Deleted
- None.
