# Story 4.5: JSONB Schema Migration Strategy

Status: done

<!-- Split-convention: this file is the SPEC only. Dev Agent Record + File List + review appendices go to
     4-5-jsonb-schema-migration-strategy-completion-notes.md at first dev pickup (docs/bmad-story-conventions.md). -->

---
baseline_commit: e3ea790
epic: 4
story: 4.5
size: M   # upgraded from S at the 2026-07-31 party-mode review (batch tool ships HARDENED: per-batch tx, rows_affected assert, xmin guard, resumability, poison-row abort)
audience: Backend
depends_on: [4.1]
# WF-8: R20 is BIMODAL (Murat, ratified). R20a lazy read-path = 4 (no ATDD). R20b batch tool = 8 (multi-tenant, self-concealing corruption) → the batch-tool data-preservation + guard tests are authored RED-FIRST (ATDD) before the tool exists.
wf8_atdd_mandatory: batch-tool-only   # R20b=8 trips WF-8 for AC2's preservation/guard/concurrency tests; AC1/AC3/AC4 ladder tests are ordinary inline.
codegen_required: true      # new sqlc admin query file → scripts/codegen.sh (WF-3)
ddl_migration_required: false
---

## Story

As a **developer/operator**,
I want **a versioned upgrade strategy for JSONB content schemas — a lazy read-path ladder that upgrades any row on read, plus a hardened batch tool to sweep rows ahead of time**,
so that **when a schema shape evolves, existing rows stay readable and no read site needs retrofitting under deadline — the day the first real v2 lands, the machinery already exists and is proven**.

## Context & Framing (read first — the invariant that governs every decision below)

This is a **mechanism** story, not a data-shape story. **There is no v2 of any JSONB schema today** — every entity is v1 (`store.CurrentExerciseSchemaVersion = 1`, etc.). You are building the **generic version-dispatch upgrade ladder** + a **hardened operator batch tool**, and proving both with **test-only synthetic versions**. Production upgrader chains ship **empty**; v1 stays a direct passthrough.

### THE GOVERNING INVARIANT (write this into the code as a package-doc comment)
> **The lazy read-path ladder IS the correctness guarantee. The batch tool is an OPTIMIZATION.**
> Every row is upgraded on read through its store choke point, from its own stored version, with no assumption that it is already current. The batch tool exists only so the system needn't pay lazy-upgrade cost forever and can eventually drop old rungs. **Therefore the batch tool is ALLOWED to skip rows** (soft-deleted, freshly inserted at an old version, or concurrently modified) — a skipped row is harmless because it upgrades on next read. A *clobbered* row is not harmless. **Nobody may ever "optimize" the read path by dropping the lazy upgrade because "the batch tool handled everything"** — restored/soft-deleted rows would break silently. This invariant justifies the `deleted_at` skip (Task 5) and the concurrent-write tolerance (Task 5 `xmin`).

### The two disasters this story invites
- **DISASTER 1 — inventing a speculative v2 content shape.** Do NOT design or ship a production `ExerciseContent` v2, a v1→v2 field rename, or any real upgrader. Violates WF-2 (no speculative migrations) + CQ-1 (no dead code). Production upgrader chains ship **empty**; the ladder is exercised only by **synthetic upgraders registered inside tests**.
- **DISASTER 2 — doing nothing because "there's no v2."** The ladder, the hardened tool, the arg parsing, the monotonic guard, the concurrency guard, and the tests ARE the deliverable. FU-4-1-A (deferred-work.md:597) is closed here.

### The canonical pattern already half-exists — you are generalizing, not inventing
- `store.UnmarshalExerciseContent(raw, version)` — `internal/store/exercise_content.go:165`. Version from the **DB column**; struct field is `json:"-"`. Non-v1 → typed `InvalidExerciseContentError`. Its comment (lines 9, 163-164) points here: _"The full lazy-upgrade dispatch for future versions is Story 4.5."_
- `model.MigrateOnboardingPayload(raw)` — `internal/model/onboarding_payload.go:42`. Version **probed from the blob**. Both are the reject-only degenerate case of the ladder. **Onboarding is NOT rewired in this story** (see Q2 ruling / Out of Scope) — it stays as the documented second example.

## Acceptance Criteria

Mapped from epic-04.md:175-179, amended per the 2026-07-31 party-mode review (Winston/Murat/John).

1. **(AC1 — lazy upgrade + write-back on next save, proven at the SERVICE layer)** Given exercise-content JSONB stored at `schema_version = N` and the current code is at version `M > N`, When the store decodes it, Then a version-dispatch function upgrades the content **in-memory** stepwise `N→N+1→…→M` and returns the typed struct at `M`; and When that exercise is next persisted through a **normal service update**, Then the row is written back at `schema_version = M` with **exactly one UPDATE and no separate eager-rewrite pass**, and a subsequent read performs no further upgrade (idempotent). _Proven with a test-only synthetic version through the real `ExerciseService` update path — not merely the store round-trip (Murat #1)._

2. **(AC2 — HARDENED batch backfill tool)** Given the operator runs `scripts/migrate-jsonb.sh --entity=exercises --from=1 --to=2`, When it executes, Then it drives a Go one-off tool that selects rows at `schema_version = --from` and upgrades each via the **same ladder** as AC1, UPDATEing `content` + `schema_version` **in batches of 100, one transaction per batch, with per-batch progress logging**, and:
   - **(2a keyset)** paginates by **keyset on `id`** (never OFFSET — the tool mutates `schema_version` out from under its own cursor; OFFSET would skip rows). Sweeping 250 rows migrates **all 250**, not 200.
   - **(2b lost-update guard)** the UPDATE is keyed by `id = $1 AND schema_version = $from AND xmin = $readXmin` — a row a concurrent live writer touched between the tool's SELECT and UPDATE matches **zero rows** and is **skipped + logged** (never clobbered). Each batch **asserts `rows_affected` == rows-intended**; a shortfall is expected under concurrency and is logged, not fatal.
   - **(2c resumability)** each batch commits independently; a mid-run failure leaves committed batches at `--to` and the rest at `--from`; a re-run picks up only the remaining `--from` rows (the version predicate makes this automatic). Tool accepts `--after-id` and logs the last committed `id` per batch.
   - **(2d poison-row abort)** a row whose stored blob is NULL/empty or fails to decode at its column version **aborts the run**, surfaces the offending PK, and exits non-zero — no silent skip (a silently-skipped bad row is a permanently-mixed-version table nobody notices).
   - **(2e guards)** unknown `--entity`, `--to` ≠ that entity's current version, `--from >= --to`, or `--from < 1` → clean error + non-zero exit, **zero writes**.

3. **(AC3 — version-dispatch on unmarshal, generic)** Given any JSONB blob carrying a `schema_version` (column- or blob-sourced), When Go unmarshals it, Then it routes through the shared `MigrateJSONB` dispatch that applies the ordered upgrade chain to current **before** returning the typed struct — callers (service/handler/worker) **never see a legacy version** (GO-7). `UnmarshalExerciseContent` is refactored onto it. **Genericity ("any JSONB column", not just exercises) is proven by a synthetic SECOND entity in the unit test** — no live production path beyond exercises is rewired this story.

4. **(AC4 — monotonic, never skipped, per-rung contract enforced)** Given the upgrade chain, When it runs, Then versions increase monotonically applied **one rung at a time** (`v→v+1`, never `v→v+2`); a **missing rung** (gap), `fromVersion < 1`, `fromVersion > currentVersion`, or `fromVersion == 0` is a typed error, never a silent skip or panic. A test asserts the chain covers every step `1..current` with no gap. **AND (the price of blob-level type-erasure — Winston/Murat):** each registered rung MUST have a **contract test proving `rung[n]`'s output blob unmarshals cleanly into `rung[n+1]`'s expected input** (and the final rung's output into the current typed struct) — this is what catches a silent field-drop that the `RawMessage→RawMessage` signature cannot catch at compile time.

5. **(AC5 — precondition: column integrity)** Given the batch tool + ladder both key off `exercises.schema_version`, When dev picks up this story, Then they first **verify `exercises.schema_version` is `NOT NULL DEFAULT 1`** (from 4.1's migration `20260727120000`). If it were nullable/0, a NULL reads as `from=0` → the ladder rejects `from<1` → **every exercise read 500s**. This is a read-only verification (no DDL migration expected); if it fails, STOP and escalate — the fix is a migration outside this story's `ddl_migration_required:false` scope.

## Tasks / Subtasks

- [x] **Task 1 — Generic version-dispatch ladder in `package model`** (AC3, AC4)
  - [x] New file `classlite-api/internal/model/schema_migration.go` (CQ-4: name reflects primary export). Lives in `model` because `store → model` (not vice-versa; `ai_response.go:10-11`), so both packages can use it.
  - [x] Blob-level, type-erased design (Winston-ratified — avoids "struct archaeology" of keeping every historical `vN` struct alive; the price is per-rung contract tests, AC4):
    ```go
    // UpgradeFunc transforms a JSONB blob from schema version v to v+1.
    type UpgradeFunc func(json.RawMessage) (json.RawMessage, error)

    // MigrateJSONB walks the upgrade chain from fromVersion to currentVersion,
    // applying exactly one rung per step (monotonic, never skips), returning the
    // blob at currentVersion. upgraders[v] upgrades v→v+1. Errors (never panics):
    // fromVersion < 1, fromVersion > currentVersion, or a missing rung in
    // [fromVersion, currentVersion). The caller does the final json.Unmarshal.
    func MigrateJSONB(raw json.RawMessage, fromVersion, currentVersion int, upgraders map[int]UpgradeFunc) (json.RawMessage, error)
    ```
  - [x] Loop `for v := fromVersion; v < currentVersion; v++ { fn, ok := upgraders[v]; if !ok { return gap error }; raw = fn(raw) }` — structurally enforces AC4 (stepwise, no skip). Typed `SchemaVersionError{From, Current int, Reason string}` for out-of-range/gap.
- [x] **Task 2 — Refactor `UnmarshalExerciseContent` onto the ladder** (AC1, AC3)
  - [x] `internal/store/exercise_content.go:165`. Package-level `var exerciseUpgraders = map[int]model.UpgradeFunc{}` — **empty today**.
  - [x] Reject `version < 1 || version > CurrentExerciseSchemaVersion` and empty blob as typed `InvalidExerciseContentError` (preserve today's error surface + messages for the corruption/untrusted-input mappers), then `raw, err = model.MigrateJSONB(raw, version, CurrentExerciseSchemaVersion, exerciseUpgraders)`, then `json.Unmarshal` into `ExerciseContent`, stamp `content.SchemaVersion = CurrentExerciseSchemaVersion` + non-nil `Sections`. **Production behavior identical to today** (v1 passthrough; 0/unknown/future/empty → typed error) — only machinery changed.
- [x] **Task 3 — Verify service write-back stamps current version** (AC1) — _(the old "refactor onboarding" Task 3 was DROPPED per Q2; this slot now covers the AC1 write-back verification)_
  - [x] In `internal/service/exercise_service.go`, confirm the create/update write paths `Marshal()` the (now-possibly-upgraded) struct AND write `store.CurrentExerciseSchemaVersion` to the `schema_version` column param. If any update path threads the *old* column value through instead of stamping current, fix it — that is the AC1 "write-back on next save" guarantee. **No new eager-rewrite pass.**
- [x] **Task 4 — sqlc admin queries for the batch tool** (AC2) → **runs `scripts/codegen.sh` (WF-3)**
  - [x] New `internal/store/queries/exercise_jsonb_migration.sql`, commented **admin-tool-only, cross-tenant (superuser connection), keep isolated from request-path queries**:
    - `-- name: ListExercisesForJSONBMigration :many` → `SELECT id, xmin, content, schema_version FROM exercises WHERE schema_version = $1 AND id > $2 AND deleted_at IS NULL ORDER BY id LIMIT $3`. **Keyset on `id`** (AC2a). `xmin` selected for the lost-update guard (AC2b). `deleted_at IS NULL` skip is safe per THE GOVERNING INVARIANT — soft-deleted rows upgrade lazily on restore/read. (sqlc: `xmin` is `pgtype` system column — surface it as `uint32`/`pgtype.Uint32`; if the analyzer balks, cast `xmin::text` or `xmin::bigint` and compare as such — dev picks the form sqlc accepts, document it.)
    - `-- name: UpdateExerciseJSONBVersion :execrows` → `UPDATE exercises SET content = $2, schema_version = $3, updated_at = now() WHERE id = $1 AND schema_version = $4 AND xmin = $5`. `:execrows` returns rows-affected for the AC2b assertion. The **`xmin = $5`** guard is the lost-update fix (AC2b): a concurrent live writer that changed content-but-left-version bumps `xmin`, so this matches zero rows and skips instead of clobbering the user's edit.
  - [x] Run `scripts/codegen.sh` (sqlc) — last script before done (WF-3).
- [x] **Task 5 — HARDENED batch tool `tools/jsonbmigrate`** (AC2, AC4, AC5)
  - [x] `classlite-api/tools/jsonbmigrate/cmd/jsonbmigrate/main.go` (mirror `tools/tenantcheck/cmd/tenantcheck/main.go` nesting — the `go run ./tools/...` convention, already in CI).
  - [x] Args via stdlib `flag` (accepts `--entity=exercises --from=1 --to=2`).
  - [x] **Connection = superuser `MIGRATION_DATABASE_URL`** (fallback `DATABASE_URL`) via `store.NewPool(ctx, url)`. Ratified at party-mode (Q1): the tool does **same-row read-modify-write keyed by `id=$1`** (no join, no cross-row copy, no computed target id), so RLS is not the correctness boundary — the monotonic ladder + `schema_version=$4` + `xmin=$5` guards are. The rejected per-tenant/`SECURITY DEFINER all_center_ids()` alternative would trade an *ephemeral* superuser invocation for a *standing* RLS-bypassing DDL artifact — a worse trade (Winston). **Guardrail: keep the admin sqlc queries in their own file, and the superuser pool ephemeral to this CLI process — never hand it to request-serving code** (this is what keeps GO-1 untouched — the tool is outside GO-1's request-path scope, not violating it).
  - [x] **Testable exported function** `func RunMigration(ctx, pool, entity string, from, to, batchSize int, afterID uuid.UUID, log *slog.Logger) (migrated int, err error)` — `main` parses flags, resolves the entity registry, calls it, prints a final summary, sets exit code.
  - [x] Entity registry maps `--entity` → {current-version, decode+upgrade+remarshal closure over `MigrateJSONB`, the sqlc list/update fns}. Register `exercises` now; structure so future column-versioned entities slot in.
  - [x] Guards (AC2e/AC4): unknown entity; `to != registry.currentVersion(entity)`; `from >= to`; `from < 1` → error, non-zero exit, **zero writes**.
  - [x] **Batch loop, hardened:** keyset over `id`, `const jsonbMigrationBatchSize = 100` (CQ-3), **one tx per batch** (commit each 100 — never one giant tx: long locks + WAL bloat + not resumable). Per row: `MigrateJSONB` from→to + current struct re-marshal; `UpdateExerciseJSONBVersion` with the read `xmin`. **Assert `rows_affected`**; a shortfall = concurrent-skip, log it (`skipped`), don't abort. **Poison row** (NULL/empty/undecodable at its version) → abort run, surface PK, non-zero exit (AC2d). `slog.Info("==> migrated batch", "entity", …, "count", n, "skipped", s, "cumulative", total, "last_id", …)` per batch. Stop when a page returns 0 rows.
  - [x] `--after-id` resume flag; log the last committed `id` each batch (AC2c).
- [x] **Task 6 — `scripts/migrate-jsonb.sh` wrapper** (AC2)
  - [x] Repo-root `scripts/` (no `classlite-api/scripts/`). Header verbatim from `scripts/migrate.sh`: `#!/usr/bin/env bash`, `set -euo pipefail`, `SCRIPT_DIR`/`ROOT_DIR` idiom, `source "$ROOT_DIR/.env" 2>/dev/null || true`, `${MIGRATION_DATABASE_URL:-${DATABASE_URL:-}}` guard + the _"Copy .env.example to .env and configure it."_ error.
  - [x] Body: export resolved URL, `cd "$ROOT_DIR/classlite-api"`, `exec go run ./tools/jsonbmigrate/cmd/jsonbmigrate "$@"`. `-h`/`--help` prints the `--entity/--from/--to/--after-id` contract. Logging `echo "==> ..."`.
- [x] **Task 7 — `jsonb_array_length` SQL-count seam → first-class GO-7 exception + tripwire (closes FU-4-1-A)** (AC1)
  - [x] The exercise **list** path counts sections/questions in SQL via `jsonb_array_length`, assuming the v1 shape and **bypassing the ladder** (it's a COUNT, not an unmarshal — a *second, un-laddered reader* of the blob shape). This is the concrete place the empty-chain bet leaks (Winston #2). Add: (a) a code comment at the SQL-count site + the query file marking it a **GO-7 exception — shape-dependent SQL over versioned JSONB, valid for v1 only**; (b) a **test** asserting the count is correct for a v1 blob AND a `// TRIPWIRE:` comment instructing that when a v2 with a reshaped blob lands, this count must branch on `schema_version` or fall back to app-side counting; (c) a one-line entry in the convention doc (Task 9) generalizing it: _any shape-dependent SQL over versioned JSONB is a ladder bypass and must be inventoried when a version bumps._ Minimal — no v2, no functional change today.
- [x] **Task 8 — Tests** (all ACs; TEST-BE conventions; AC2 tests authored RED-FIRST per R20b=8)
  - [x] `internal/model/schema_migration_test.go` (unit, pure): synthetic upgraders `1→2→3`. Assert order (spy each rung ran once, in order), gap-reject (register 1→2 not 2→3, ask 1→3 → error), bounds (`from=0/<1/>current` → error), `from==current` no-op. **Per-rung contract test (AC4):** `rung[n]` output unmarshals into `rung[n+1]` input + final into current struct. Every positive has a negative (meta-rule).
  - [x] `internal/store/exercise_content_test.go` (add): v1 regression (round-trips unchanged; `version=0/2/-1`/empty → `InvalidExerciseContentError` preserved). **Genericity proof (AC3):** a synthetic SECOND entity type run through `MigrateJSONB` in-test (proves "any JSONB column", no onboarding rewire). **Column-wins (AC3):** an exercise row where the column says v1 but the blob carries a stray `schema_version:2` field → assert the **column** drives dispatch (upgrades 1→current, not a false no-op).
  - [x] **`internal/service/exercise_service_test.go` (AC1 at the SERVICE layer — Murat #1, real DB `test.SetupDB`):** seed a row at synthetic v1 (current=2 via a test-scoped ladder), call the **real `ExerciseService` update** changing one unrelated field, assert the persisted row is now `schema_version=2` + upgraded shape + **exactly one UPDATE (no eager-rewrite)**; re-read → no second upgrade (idempotent).
  - [x] **`tools/jsonbmigrate/…_test.go` (integration, `test.SetupDB`, RED-FIRST per R20b=8 — TEST-BE-2):**
    - **(all-N)** seed **250** rows at `from` across **≥2 tenants**; run; assert **all 250** stamped (crosses ≥3 batches — catches OFFSET-skip, AC2a) AND **per-tenant counts** pre/post match exactly (cross-tenant blast-radius, Murat #6).
    - **(concurrency/xmin)** row at v1; simulate a concurrent content-write that bumps `xmin` but leaves version=1 between the tool's read and write → assert the UPDATE matches **zero rows**, the row is **skipped + logged**, the user's edit is **not clobbered** (Murat #3 / Winston #1). This is the highest-severity correctness test in the story.
    - **(resumability)** seed 250; force failure after batch 2 commits → batches 1-2 at `to`, 3-5 at `from`; re-run → only remaining `from` rows swept, already-migrated untouched (Murat #5).
    - **(poison row)** seed a NULL/undecodable-at-version row mid-batch → assert **abort + PK surfaced + non-zero exit + no partial commit past the bad row** (AC2d).
    - **(guards)** unknown entity / `to`≠current / `from>=to` / `from<1` → error + **zero writes** (AC2e).
    - **(progress-count)** final log count == rows actually touched (250, not 300 double-count, not 200 lost-batch — Murat #8).
    - Never `t.Parallel()` on DB tests.
  - [x] onboarding tests untouched (not rewired this story).
- [x] **Task 9 — Convention doc + first-v2 runbook** (John / Winston — honest handoff, not a done-claim)
  - [x] Short doc (e.g. `docs/jsonb-schema-migration.md` or a section appended to an existing conventions doc): the ladder pattern, the column-vs-blob version-source rule (_column-versioned entities are batch-tool-eligible; blob-probed are read-path-only_ — Winston #4), the GOVERNING INVARIANT, and the GO-7-exception inventory rule from Task 7.
  - [x] **First-v2 runbook** (the durable output for the future operator, John): the checklist for when a real schema change lands — add the `vN→vN+1` rung + its contract test, bump the current-version constant, decide backfill/default semantics, run the batch tool per-environment, AND an explicit list of **what 4.5 did NOT solve**: real-transform correctness, backfill defaults, rollback/down-migration of a JSONB shape, big-tenant timeouts, and (if not yet built) any entity-specific batch wrinkle.

## Dev Notes

### The three independent version lines — NEVER share a constant
| Entity | Constant | Version source | Choke point | This story |
|---|---|---|---|---|
| Exercise `content` | `store.CurrentExerciseSchemaVersion = 1` (`exercise_content.go:27`) | DB **column** (`json:"-"`) | `UnmarshalExerciseContent` (`:165`) | **refactored onto ladder** |
| Job `params` | `model.AIJobParamsSchemaVersion = 1` (`job_types.go:53`) | DB **column** `params_schema_version` | worker `Unmarshal` (`ai_generate.go:78/120/164`) | documented only |
| Job `result` | `model.AIResponseSchemaVersion = 1` (`ai_response.go:15`) | in-**blob** + col `result_schema_version` | dispatcher (`ai_generate.go:219`) | documented only |
| Onboarding `payload` | `model.OnboardingPayloadSchemaVersion = 1` (`onboarding_payload.go:11`) | in-**blob** | `MigrateOnboardingPayload` (`:42`) | **NOT rewired (Q2 ruling)** — documented 2nd example |
`job_types.go:49-52` warns these version independently — respect it.

### Party-mode review rulings (2026-07-31, Ducdo ratified — Winston/Murat/John as subagents)
- **Q1 batch-tool connection → SUPERUSER** (`MIGRATION_DATABASE_URL`). Validated by Winston; the `SECURITY DEFINER all_center_ids()` + per-tenant-loop alternative was rejected as *worse* (standing RLS-bypass DDL vs ephemeral privilege). SEC-6 (workers) and GO-1 (request-path store methods) do **not** reach this out-of-band CLI tool — but keep the pool ephemeral + admin queries isolated so they never touch request-serving code.
- **Rung signature → blob-level `UpgradeFunc` (`RawMessage→RawMessage`)** (Winston) — avoids struct archaeology — **made safe by the mandatory per-rung contract test** (AC4, answers Murat's field-drop concern at the test layer).
- **Q2 onboarding refactor → DROPPED** (John). Genericity proven by a synthetic 2nd entity in the unit test; no zero-value-change production rewrite.
- **R20 is bimodal** (Murat): R20a lazy=4 (no ATDD), **R20b batch=8** (multi-tenant, self-concealing corruption, correlated failure) → AC2 preservation/guard/concurrency tests authored **red-first**.
- **Batch tool ships HARDENED** (Winston lean, Ducdo): per-batch tx, `rows_affected` assert, **`xmin` lost-update guard**, resumability, poison-row abort. This is the story's real defense-in-depth (standing in for the RLS backstop that wouldn't have caught the actual same-row failure).
- **Four hardenings adopted:** service-layer AC1 test; `jsonb_array_length` GO-7-exception tripwire; GOVERNING INVARIANT + first-v2 runbook; `schema_version NOT NULL` precondition.

### GO-7 contract
`project-context.md:256-268` + architecture.md:206/966-969: JSONB is always a typed struct with a companion `schema_version`; **"schema migration happens in the store layer before returning to service — service never sees legacy versions."** Ladder lives at/below the store decode boundary (exercises) or in `model`. Never upgrade in a handler/service. The `jsonb_array_length` count (Task 7) is the one **exception** — an un-laddered shape-dependent reader — hence the tripwire.

### The lost-update trap (Winston #1 — the top correctness risk, why `xmin` not version-only)
Version-only guard `WHERE schema_version=$from` is insufficient: a concurrent live writer that changes **content** but leaves `schema_version=1` is invisible to it — the tool would write its upgraded-*stale* content back and **clobber the user's edit**. `AND xmin = $readXmin` makes it whole-row optimistic-concurrency: any concurrent write bumps `xmin`, the UPDATE matches zero rows, the row is skipped (harmless — lazy read-path upgrades it later per the GOVERNING INVARIANT).

### Reuse map — do NOT reinvent
| Need | Reuse |
|---|---|
| Version-dispatch precedent | `MigrateOnboardingPayload` (`onboarding_payload.go:42`) — pattern only (not rewired) |
| Exercise decode/marshal | `UnmarshalExerciseContent`/`ExerciseContent.Marshal()` (`exercise_content.go:165/131`) — single source of version logic for the tool's transform |
| pgxpool from standalone tool | `store.NewPool(ctx, url)` (`db.go:14`) + `config.Load()` (`config.go:65`) |
| `go run ./tools/...` one-off | `tools/tenantcheck/cmd/tenantcheck/main.go` (nesting + CI) |
| Shell script conventions | `scripts/migrate.sh` (env load, URL guard, header) |
| Bounded batch loop shape | `dispatcher.go` `drainReady`(:319) + per-item `slog` |

### Testing standards
- Mock seams unchanged: store/service/tool tests use **real DB in transactions** (`test.SetupDB(t)`), never mock pgx (TEST-BE-2). Ladder unit tests are pure functions.
- AC2 batch tests are **red-first** (R20b=8). AC1/AC3/AC4 ladder tests are ordinary inline. Target scenario `test-design-qa.md:309` P2-076..080 (round-trip) is the AC1 service-layer test.

### Project Structure Notes
- New: `internal/model/schema_migration.go` (+test), `internal/store/queries/exercise_jsonb_migration.sql`, `tools/jsonbmigrate/cmd/jsonbmigrate/main.go` (+test), `scripts/migrate-jsonb.sh`, `docs/jsonb-schema-migration.md` (doc + runbook). Modified: `internal/store/exercise_content.go`, `internal/service/exercise_service.go` (write-back verify + Task 7 seam), regenerated `store/generated/*` (codegen — never hand-edit, XL-1).
- **No DDL migration** (AC5 is a read-only verification). **codegen.sh required** (new sqlc). No `api.yaml`/frontend/i18n. Single-service — not a cross-service atomic PR (WF-4).

### References
- [Source: epic-04.md#Story 4.5] — 4 canonical ACs
- [Source: deferred-work.md#FU-4-1-A (line 597)] — machinery this story owns/closes
- [Source: docs/project-context.md#GO-7 / #WF-2 / #WF-3]
- [Source: internal/store/exercise_content.go:165] / [internal/model/onboarding_payload.go:42] — the two choke points
- [Source: internal/worker/dispatcher.go:319/493] — bounded-batch + `set_config` precedents
- [Source: tools/tenantcheck/cmd/tenantcheck/main.go] — `go run ./tools/...`
- [Source: test-design-qa.md:309 (P2-076..080); test-design-architecture.md:150 (R20=4, now split R20a/R20b)]

## Definition of Done

- AC1–AC5 satisfied; production behavior for v1 rows **byte-identical to today** (regression-proven) — only machinery changed.
- `MigrateJSONB` ladder in `model`, reused by `UnmarshalExerciseContent`; production upgrader map **empty** (no speculative v2). Per-rung contract test discipline in place (AC4).
- Hardened batch tool + `scripts/migrate-jsonb.sh`: keyset-100, per-batch tx, `xmin` lost-update guard, `rows_affected` assert, `--after-id` resumability, poison-row abort, arg guards — all **red-first tested** (R20b) with >100 rows across ≥2 tenants incl. the concurrency/xmin, resumability, poison-row, per-tenant-count, and guards scenarios.
- AC1 write-back proven through the **real service update** (not just store round-trip). Task 7 `jsonb_array_length` GO-7-exception tripwire in place. AC5 `schema_version NOT NULL DEFAULT 1` verified. Convention doc + first-v2 runbook written.
- GOVERNING INVARIANT written as a package-doc comment.
- `go test ./... -race` green; `go vet` + `gofmt` clean. `scripts/codegen.sh` run (sqlc regenerated); no hand-edits under `store/generated/`.
- Story file ≤600 lines; Dev Agent Record + File List in the sibling completion-notes.

## Out of Scope

- **Any production v2 schema** for any entity (no v1→v2 upgrader, no shape change). Production chains ship empty.
- **Rewiring `jobs.params`/`jobs.result` decode** onto the ladder (workers stay direct-`Unmarshal` at v1) — documented pattern, follow-up at first v2 job shape.
- **Rewiring `onboarding.payload`** (Q2 ruling — DROPPED). It stays as the documented blob-sourced second example; genericity is proven by a synthetic test entity.
- **`submissions` JSONB** — the table does not exist (Epic 5/6). Forward-looking only.
- **A DDL migration / new `SECURITY DEFINER` function** — Q1 chose the ephemeral-superuser path; AC5 is a read-only precondition check.
- **JSONB down-migration / rollback of a shape, backfill-default semantics, big-tenant timeout tuning** — explicitly a *future v2 story's* job; listed in the first-v2 runbook as NOT solved here (honest handoff, not a done-claim).
- **Any HTTP/API/frontend/i18n surface.** The AI-response in-blob `schemaVersion` provider contract (Gemini wire format) — untouched.

## Change Log

| Date | Change | By |
|---|---|---|
| 2026-07-31 | Story created via `/bmad-create-story 4-5` (Amelia) — 3 parallel recon agents (backend JSONB seams / scripts+migration infra / architecture+deferred+test-design). Mechanism-only scope (no speculative v2; empty production chains; test-only synthetic versions). FU-4-1-A owned. backlog → ready-for-dev. | Amelia |
| 2026-07-31 | **Implemented via `/bmad-dev-story 4-5` (Amelia).** All 9 tasks shipped; `ready-for-dev → review`. Ladder + refactor + service write-back + hardened batch tool + wrapper + GO-7 tripwire + docs. **2 sanctioned deviations (both in completion-notes):** (1) the xmin-guarded UPDATE is raw pgx, not sqlc — sqlc's analyzer can't type an `xmin` predicate in an UPDATE WHERE (keyset LIST stays sqlc); (2) a test-only `store.OverrideExerciseSchemaForTest` seam lets the AC1 service test + tool tests exercise a real v1→v2 bump WITHOUT a speculative production v2 (chain still empty; current stays 1). AC5 `schema_version NOT NULL DEFAULT 1` verified. `go test ./... -race` green (13 pkgs), vet+gofmt+tenantcheck clean, production `--to=2` safely rejects (current=1). Dev Agent Record + File List → sibling completion-notes. | Amelia |
| 2026-07-31 | **Party-mode pre-dev review + AMENDED** (Amelia orchestrating Winston/Murat/John as subagents; Ducdo ratified). Size **S→M**. **Q1→superuser** (validated; SECURITY-DEFINER alt rejected as worse). **Rung→blob-level + mandatory per-rung contract test** (AC4). **Q2→onboarding refactor DROPPED** (old Task 3 replaced by AC1 write-back verify). **R20 split bimodal** → batch-tool tests **red-first** (R20b=8). **Batch tool ships HARDENED:** per-batch tx + `rows_affected` assert + **`xmin` lost-update guard** + `--after-id` resumability + poison-row abort + keyset-not-OFFSET (all-250 test). **4 hardenings added:** service-layer AC1 test, `jsonb_array_length` GO-7-exception tripwire (Task 7), GOVERNING INVARIANT (lazy=correctness / batch=optimization) + first-v2 runbook (Task 9), `schema_version NOT NULL` precondition (AC5). Concurrency/xmin, resumability, poison-row, per-tenant-count, progress-count tests added to Task 8. Still ready-for-dev. | Amelia |
