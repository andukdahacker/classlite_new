# Story 4.5: Completion Notes

_Implementation record for [`4-5-jsonb-schema-migration-strategy.md`](./4-5-jsonb-schema-migration-strategy.md). Status: done._

## Dev Agent Record

### Debug Log

- **AC5 precondition (read-only verify).** `exercises.schema_version integer NOT NULL DEFAULT 1` confirmed in migration `20260727120000_create_exercises.up.sql:43`. No DDL needed; no escalation.
- **sqlc cannot type an `xmin` UPDATE predicate.** `xmin::text AS row_xmin` in a SELECT target list generates fine, but `... WHERE ... AND xmin::text = $` fails codegen with `column "xmin" does not exist` (even table-aliased). Per the story's stated latitude ("dev picks the form sqlc accepts, document it"), the keyset LIST stays sqlc (`ListExercisesForJSONBMigration`), and the lost-update-guarded UPDATE is a **raw pgx statement** inside the tool (`updateExerciseJSONBVersionSQL`), using `CommandTag.RowsAffected()` for the `:execrows` assertion. Documented at the top of `exercise_jsonb_migration.sql` and in `migrate.go`.
- **AC1 write-back needed a real fix, not a "confirm".** `UpdateExercise` never wrote `schema_version` and passed content verbatim when `in.Content==nil`, so an upgraded row's column never advanced. Fixed: the query now `SET schema_version = $`, and the service decodes+re-marshals through the ladder when `stored < current`, folded into the SAME single UPDATE (no eager pass). v1-at-current rows keep bytes verbatim → byte-identical.
- **Test seam for a real version bump without a speculative v2.** `CurrentExerciseSchemaVersion` is a `const` (floor = 1), so no `from < current` row can exist in production to exercise write-back/upgrade. Added `store.OverrideExerciseSchemaForTest(current, upgraders) func()` + `store.ActiveExerciseSchemaVersion()`: the decode + the service stamp read the active version (default = the const), and tests install a synthetic current=2 + 1→2 rung. Production chain stays EMPTY; current stays 1.
- **`-race` caught a real count bug (the no-race pass was luck).** `RunMigration` was adding a poison-aborted batch's in-progress `migrated` count even though the batch tx rolled back; random-UUID keyset order made it pass or fail non-deterministically. Fixed: on a batch error, return without adding that batch's count (only committed batches contribute). Verified deterministic under `-race` + `-count=5`.
- **Cross-tenant tool testing.** The tool is superuser/cross-tenant + per-batch-committing. All-250/resumability/poison/guards run inside a **superuser outer tx** (RLS bypassed → cross-tenant; the tool's `pool.Begin()` becomes a savepoint whose Commit is a RELEASE → per-batch commit/rollback modeled while the whole thing rolls back). The **xmin** test needs committed rows + a second connection (xmin only changes across real txns), so it uses `SuperuserPool` directly with explicit cleanup.

### Completion Notes

All 9 tasks + all ACs (AC1–AC5) satisfied. Mechanism-only: **no speculative v2**, production upgrader chain EMPTY, v1 behavior byte-identical (regression suite green). FU-4-1-A closed.

- **AC1** — lazy upgrade + service-layer write-back proven through the REAL `ExerciseService.Update` with a synthetic v2 ladder (one UPDATE, no eager pass, idempotent re-read). `exercise_service_writeback_test.go`.
- **AC2** — hardened batch tool: keyset-100, per-batch tx, `xmin` lost-update guard, `rows_affected` assert, `--after-id` resumability, poison-row abort, arg guards. All red-first-style tested across ≥3 batches / ≥2 tenants (`tools/jsonbmigrate/migrate_test.go`).
- **AC3** — generic `MigrateJSONB` dispatch; `UnmarshalExerciseContent` refactored onto it; genericity proven by a synthetic 2nd entity + column-wins test.
- **AC4** — monotonic stepwise loop (structural), gap/bounds typed errors, per-rung contract test.
- **AC5** — `schema_version NOT NULL DEFAULT 1` verified (read-only).

**Deviations (both sanctioned/documented):** (1) raw-pgx guarded UPDATE (sqlc xmin limitation); (2) `OverrideExerciseSchemaForTest` test seam. Neither ships a production v2 nor changes v1 behavior.

**Deferred (per Out of Scope / first-v2 runbook):** real-transform correctness, backfill defaults, JSONB down-migration/rollback, big-tenant timeout tuning, rewiring `jobs.params`/`jobs.result`/`onboarding.payload` — all listed in `docs/jsonb-schema-migration.md`.

**Verification:** `go test ./... -race` → exit 0, 0 failures, 13 pkgs. `go vet ./...` clean. `gofmt` clean (all touched files). `tenantcheck` (GO-1) clean. `scripts/migrate-jsonb.sh` smoke-tested against the real superuser DB: `--help`, guard rejects (non-zero exit, zero writes), and production `--from=1 --to=2` safely rejects because current=1.

### Implementation Plan (as executed)

1. `MigrateJSONB` ladder + unit tests (red→green).
2. Refactor `UnmarshalExerciseContent` onto the ladder; genericity + column-wins tests.
3. New admin sqlc query (keyset+xmin LIST) + `UpdateExercise` schema_version stamp → `codegen.sh`.
4. Service write-back (decode-through-ladder when stored<current; stamp active version) + `OverrideExerciseSchemaForTest` seam; AC1 service test.
5. Batch tool (`RunMigration` + entity registry + raw-pgx guarded UPDATE + `main.go`) with GOVERNING INVARIANT package doc; 6 integration tests.
6. `scripts/migrate-jsonb.sh` wrapper.
7. `jsonb_array_length` GO-7-exception comment + tripwire test.
8. Convention doc + first-v2 runbook.
9. Full `-race` gate; fixed the poison-count bug it surfaced.

## File List

### Added

- `classlite-api/internal/model/schema_migration.go` — generic `MigrateJSONB` ladder + `UpgradeFunc` + `SchemaVersionError`.
- `classlite-api/internal/model/schema_migration_test.go` — ladder units (order/gap/bounds/no-op/per-rung contract).
- `classlite-api/internal/store/queries/exercise_jsonb_migration.sql` — admin keyset LIST (`ListExercisesForJSONBMigration`, xmin-in-select).
- `classlite-api/tools/jsonbmigrate/migrate.go` — `EntityMigrator`, `RunMigration`, `ExercisesMigrator`, `Resolve`, raw-pgx guarded UPDATE, GOVERNING INVARIANT package doc.
- `classlite-api/tools/jsonbmigrate/cmd/jsonbmigrate/main.go` — CLI (flags, superuser URL resolution, exit codes).
- `classlite-api/tools/jsonbmigrate/migrate_test.go` — 6 integration tests (all-250/2-tenant, xmin, resumability, poison, guards, progress-count).
- `classlite-api/internal/service/exercise_service_writeback_test.go` — AC1 service-layer write-back proof.
- `classlite-api/internal/service/exercise_jsonb_count_tripwire_test.go` — Task 7 SQL-count == laddered-Go-count tripwire.
- `scripts/migrate-jsonb.sh` — operator wrapper (migrate.sh header idioms).
- `docs/jsonb-schema-migration.md` — ladder pattern, column-vs-blob rule, GOVERNING INVARIANT, GO-7-exception inventory rule, first-v2 runbook + what-4.5-did-NOT-solve.

### Modified

- `classlite-api/internal/store/exercise_content.go` — `UnmarshalExerciseContent` refactored onto `MigrateJSONB`; active-version var + `ActiveExerciseSchemaVersion()` + `OverrideExerciseSchemaForTest` seam (production defaults to v1/empty).
- `classlite-api/internal/store/exercise_content_test.go` — added column-wins (AC3) + generic-2nd-entity (AC3) tests; imports.
- `classlite-api/internal/service/exercise_service.go` — Update write-back (ladder decode when stored<current) + stamp `schema_version` on Create/Update/Duplicate via `ActiveExerciseSchemaVersion()`; refreshed package/query doc.
- `classlite-api/internal/store/queries/exercises.sql` — `UpdateExercise` now `SET schema_version`; GO-7-exception + TRIPWIRE comment on the `jsonb_array_length` count site.

### Regenerated (gitignored — not committed; produced by `scripts/codegen.sh`)

- `classlite-api/internal/store/generated/exercise_jsonb_migration.sql.go` (new), `.../exercises.sql.go` (UpdateExerciseParams gains SchemaVersion). `src/lib/api/client.ts` unchanged (api.yaml untouched).

### Deleted

- None.

## Review Findings

_Adversarial code review 2026-07-31 (Blind Hunter / Edge Case Hunter / Acceptance Auditor). Acceptance Auditor: all AC1–AC5 SATISFIED, both disasters avoided, GOVERNING INVARIANT + scope hold. Findings below are latent-defect hardening — none fire today (production chain EMPTY, `active=1`, batch tool self-rejects at `--to != current`); every one activates the day the first real v2 ships, which is exactly when this machinery must be trusted. 6 patch, 1 defer, 2 dismissed._

- [x] [Review][Patch] Write-back & batch UPDATE bypass the `MaxContentBytes` (413) cap [`classlite-api/internal/service/exercise_service.go:708-717`; `classlite-api/tools/jsonbmigrate/migrate.go:93-95`] — the `in.Content != nil` arm checks `len(raw) > store.MaxContentBytes`; the write-back arm assigns the re-marshaled upgraded blob to `contentBytes` with no cap. A future field-adding rung can inflate a near-256KiB row past the ceiling on an unrelated title-only save (and the batch tool writes the same uncapped blob). Fix: re-check `len(contentBytes) > store.MaxContentBytes` after the upgrade re-marshal. (blind+edge+auditor)
- [x] [Review][Patch] Batch UPDATE bumps `updated_at = now()`, invalidating open editors' optimistic-concurrency token [`classlite-api/tools/jsonbmigrate/migrate.go:94`] — the editor precondition IS `updated_at` (`exercises.sql:149-164`). The `xmin` change already powers the lost-update guard; `updated_at = now()` is gratuitous. Running the tool during business hours → every open editor's next autosave matches 0 rows → spurious 409, against a design whose prime directive is "never disrupt a user edit." Also needlessly reorders the library (`ORDER BY updated_at DESC`). Fix: drop `updated_at = now()` from the guarded UPDATE. (blind)
- [x] [Review][Patch] `RunMigration` reports only migrated count — no aggregated skipped total, no "remaining-at-`from` == 0" completeness signal [`classlite-api/tools/jsonbmigrate/migrate.go:155,178,187`] — `skipped` is logged per batch but never summed or returned; `--after-id` past max-id exits 0 `migrated=0` indistinguishable from a genuine empty sweep. An operator reading "complete" proceeds to drop the old rung while skipped/beyond-cursor rows remain at `from` (lazy path saves correctness, but the tool actively misleads the drop-rung decision). Fix: aggregate + surface skipped total and/or a final `count(*) WHERE schema_version = from == 0` assertion. (blind+edge)
- [x] [Review][Patch] A missing rung in `[from,to)` surfaces as a per-row "poison row" abort after DB work, not a pre-flight guard [`classlite-api/tools/jsonbmigrate/migrate.go:155-167`] — guards validate `from>=1`, `from<to`, `to==current`, but never that a rung exists for every step. A future `current=3` with only a `2→3` rung run as `--from=1 --to=3` passes all guards, then the first v1 row's `MigrateJSONB` hits the gap → reported as data corruption ("poison row … aborting"). Fix: pre-flight assert the chain covers every step `[from,to)` before touching the DB, with a distinct config-error exit. (edge)
- [x] [Review][Patch] `--batch-size` has no upper clamp [`classlite-api/tools/jsonbmigrate/migrate.go:165`] — only `batchSize <= 0 → Default` is guarded. A pathological `--batch-size=100000000` issues `LIMIT 100000000`, collapsing the whole sweep into one effective transaction (long locks, WAL bloat, non-resumable) — the exact failure the per-batch design prevents. Fix: clamp/reject above a `MaxBatchSize`. (edge)
- [x] [Review][Patch] Stale error message "unknown schema version (4.1 supports v1 only)" [`classlite-api/internal/store/exercise_content.go:167`] — the guard was generalized to `version < 1 || version > currentExerciseSchemaVersion` but the `Reason` string still hard-codes the v1-only text. Once current > 1 it fires for an ahead-of-code row yet blames "v1 only," misdirecting on-call. Fix: report the actual accepted range. (blind)
- [x] [Review][Defer] Version-ahead row (`stored > active`) → 500 on Update/Get during a v2 rolling deploy [`classlite-api/internal/service/exercise_service.go:708`] — deferred. The write-back branch fires on `!=` (includes `>`); an old-code pod reading a v2 row `UnmarshalExerciseContent(v2)` → `InvalidExerciseContentError` → 500. The naive `!=`→`<` fix is UNSAFE: the `schema_version` stamp at :729 is unconditional, so skipping the branch would write `schema_version = active(1)` over a v2 blob = silent corruption (a 500 is the safer failure). Correct handling (reject-ahead-rows loudly, or version-aware stamp) belongs to the first-real-v2 rollout choreography, which owns the mixed-deploy window. Only reachable mid-rollout of a future v2; harmless today. Logged as **FU-4-5-1** in `deferred-work.md`.

### Review fixes applied (2026-08-01)

All 6 patch findings fixed; the 1 defer (FU-4-5-1) is logged, not fixed.

- **P1 (413 cap):** `exercise_service.go` write-back arm now re-checks `len(contentBytes) > store.MaxContentBytes` → `PayloadTooLargeError`; the batch tool enforces the same ceiling inside `ExercisesMigrator().Upgrade` (over-cap → run abort, not a silent over-cap write).
- **P2 (updated_at):** dropped `updated_at = now()` from `updateExerciseJSONBVersionSQL`; `xmin` (auto-bumped on any UPDATE) still powers the guard. Doc comment explains why (editor concurrency token + list sort key).
- **P3 (skipped/completeness):** `RunMigration` now returns `(migrated, skipped, err)`, aggregates both across batches, warns when `skipped > 0` ("rows remain at --from; re-run"), and `main.go` logs `skipped_remaining_at_from` + `fully_swept`. New assertion in the all-250 test locks `skipped == 0` on a clean sweep.
- **P4 (chain-gap pre-flight):** added `model.ValidateChain` (bounds + rung-coverage, no transform) — `MigrateJSONB` now delegates its guards to it; `store.ValidateExerciseUpgradeChain` + `EntityMigrator.ValidateChain` let `RunMigration` fail a gap as a clean config error before any DB work (no more per-row poison mislabel).
- **P5 (batch-size clamp):** added `MaxBatchSize = 10_000`; `RunMigration` clamps + warns above it.
- **P6 (stale message):** `UnmarshalExerciseContent` out-of-range Reason now reports the real accepted range `1..currentExerciseSchemaVersion`.

**Verification:** `go build ./...`, `go vet`, `gofmt` clean; `go test ./internal/model/ ./internal/store/ ./internal/service/ ./tools/jsonbmigrate/... -race` → all green.
