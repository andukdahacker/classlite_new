---
stepsCompleted: ['step-01-preflight-and-context', 'step-02-generation-mode', 'step-03-test-strategy', 'step-04-generate-tests', 'step-05-validate-and-complete']
lastStep: 'step-05-validate-and-complete'
lastSaved: '2026-09-08'
storyId: '7.3a'
storyKey: '7-3a-enrollment-management-backend'
storyFile: '_bmad-output/implementation-artifacts/7-3a-enrollment-management-backend.md'
atddChecklistPath: '_bmad-output/test-artifacts/atdd-checklist-7-3a-enrollment-management-backend.md'
detectedStack: 'backend'
generatedTestFiles:
  - 'classlite-api/internal/test/enrollment_history_rls_atdd_test.go'
  - 'classlite-api/internal/test/enrollment_status_coupling_atdd_test.go'
inputDocuments:
  - '_bmad-output/implementation-artifacts/7-3a-enrollment-management-backend.md'
  - 'docs/project-context.md (TEST-BE-1..5, WF-2/8, GO-1..7, SEC-1)'
  - 'classlite-api/internal/test/audit_logs_rls_test.go (append-only privilege-layer blueprint)'
  - 'classlite-api/internal/test/enrollments_rls_test.go (enrollment seeds + RLS grid, reused verbatim)'
  - 'classlite-api/internal/handler/enrollment_handler_atdd_test.go (setupEnrollmentHandlerTest harness for the ⏳ authz reds)'
  - '_bmad-output/test-artifacts/atdd-checklist-7-2a-...md (house convention blueprint)'
---

# ATDD Red-Phase Checklist — Story 7-3a (Enrollment Management — Backend)

_Master Test Architect: Murat · 2026-09-08 · **WF-8 HARD GATE (risk 7)**. Red-first before `in-progress`._

## Preflight

- **Stack:** `backend` (Go-only keystone). No E2E — Playwright rides 7-3b (the s43 console). Frontend `package.json`/`playwright.config.ts` present but out of this story's scope.
- **Prereqs:** ✅ story approved, 16 clear ACs · ✅ Go test infra (`internal/test`, `SetupDB`, `TxDB`, deterministic `TenantAID`/`TenantBID`, `TenantContext`, `AssertRLSViolation`) · ✅ dev DB available.
- **Red convention:** `//go:build atdd_red_phase` (project rule — tagged, quarantined; NOT Playwright `test.skip()`). Normal `go build`/`go test` **excludes** these files (verified exit 0); the tagged build surfaces the reds. **All prior reds are de-tagged** (their stories are done), so these are the branch's only active-tagged files.
- **Seams (project rule):** DB-guarantee reds (RLS/REVOKE/CHECK) = **raw SQL against the greenfield table** (audit_logs is the exact precedent — a mock/generated wrapper would hide the privilege-layer behavior); store reads = **real DB via `generated.*`**; service/handler authz = **real service + real middleware chain** (a mock false-greens the SEC-1 DB role re-fetch). Cross-tenant writes: re-read AS tenant B, assert unchanged.

## ★ Two failure shapes — do NOT conflate (the R17 trap)

`enrollment_history` is the R17 driver. Immutability is **privilege-layer**, not RLS-row-scope:

- **Append-only mutations** (`UPDATE`/`DELETE`/`TRUNCATE`) must fail with a **HARD error** (`err != nil`, SQLSTATE 42501) — the `REVOKE … FROM classlite_app` fires before RLS. A test asserting silent `RowsAffected()==0` here would **green a table that merely lacks an UPDATE policy while classlite_app still holds UPDATE** — the exact hole R17 warns about. Assert the hard error (mirrors `audit_logs_rls_test.go:195-238`).
- **Cross-tenant reads/inserts** fail the RLS way (0 rows / `WITH CHECK` reject) — the standard grid.

## Corrections / decisions folded from recon (implement accordingly)

1. **Immutability idiom = `audit_logs` REVOKE, NOT a trigger.** `enrollment_history` is *unconditionally* append-only → 2 policies (SELECT isolation + `FOR INSERT WITH CHECK`) + `FORCE` RLS + double `REVOKE UPDATE,DELETE,TRUNCATE` (PUBLIC + classlite_app). No P0001 trigger (that idiom is only for *conditional* freezes).
2. **`performed_by` is NULLABLE.** Genesis-backfill (3.4.5-Add + 2.7-import) and any system row carry NULL performer; the FK is `→ users` NO ACTION. 7-3b renders NULL as "System".
3. **`from/to_class_id → classes` NO ACTION (nullable), NOT CASCADE** — history must survive a class purge (unlike `enrollments.class_id` which CASCADEs). Intentional divergence; call it out in the migration comment.
4. **Coupling CHECK (CR-3-4-5-1) is a NEW migration pair** — never edit `20260722120000` (WF-2). Existing rows (all active/NULL) satisfy it.
5. **Genesis backfill hits the FORCE-RLS `WITH CHECK`** — a bare cross-center `INSERT…SELECT` fails; loop per `center_id` with `SET LOCAL app.current_tenant_id` (PERF-1) or run under a BYPASSRLS migration role.

## Test strategy — AC → level → priority → red

| AC | Scenario | Level | Priority | Risk | Red file / status |
|----|----------|-------|----------|------|-------------------|
| 6 | `enrollment_history` append-only: UPDATE **and** DELETE **and** TRUNCATE hard-reject (privilege layer) | Integration (real DB) | **P0** | R17 | `enrollment_history_rls_atdd_test.go` ✅ |
| 8 | Cross-tenant history read isolation + `WITH CHECK` insert reject | Integration (real DB) | **P0** | R17/R1 | `enrollment_history_rls_atdd_test.go` ✅ |
| 11 | Paginated history read returns the tenant's own rows (compile-red store anchor) | Integration (real DB) | **P1** | — | `enrollment_history_rls_atdd_test.go` ✅ |
| 9 | status↔withdrawn_at coupling CHECK: withdrawn+NULL rejected, active+ts rejected, valid combos accepted | Integration (real DB) | **P1** | CR-3-4-5-1 | `enrollment_status_coupling_atdd_test.go` ✅ |
| 7 | **Exactly one** history row per Add/Transfer/Withdraw + performer/timestamp/effective/from-to correct; **rollback leaves none** (atomicity) | Service (real svc + real DB) | **P0** | R17 | ⏳ red-first to author (needs greenfield ctor + methods) |
| 1 | Teacher/Student action → 403 `INSUFFICIENT_ROLE` (transfer + withdraw, not just Add) | Integration (handler chain) | **P0** | R15 | ⏳ red-first (extend `setupEnrollmentHandlerTest`) |
| 1 | **Demoted-admin stale-JWT** → 403: role re-fetched from `center_members`, not the claim (revoke-then-attempt) | Integration (real svc + real DB) | **P0** | R15 | ⏳ red-first (SEC-1 seam) |
| 2,3 | Enrollable guard: `paused`/`ended` target → 422 `CLASS_NOT_ENROLLABLE` | Service | **P1** | CR-3-4-5-2 | ⏳ red-first |
| 3,4 | Transfer/Withdraw without an active source enrollment → 422 `NOT_ENROLLED_IN_SOURCE` | Service | **P1** | — | ⏳ red-first |
| 10 | Genesis backfill: every pre-existing enrollment gets exactly one `add` history row (per-center tenant ctx) | Integration (real DB, post-migration) | **P1** | — | ⏳ red-first (migration-level) |

**Generated now (2 files, 9 test funcs):** the DB-layer guarantee reds whose seams are stable regardless of the not-yet-designed service constructor/action wiring — the R17 immutability grid (the ★ risk driver) + the CR-3-4-5-1 coupling CHECK. **Specified as ⏳ red-first-to-author:** the reds that would force guessing the greenfield `NewEnrollmentService(...)` signature (now +event bus, +EmailRetryQueue, +templates) and the unified action-body handler wiring — authored against the existing `setupEnrollmentHandlerTest` harness once that shape is chosen, BEFORE `in-progress`. This mirrors 7-2a exactly (generate stable-seam reds; specify the handler/authz reds rather than guess wiring).

## Green seams (consolidated contract for the dev)

**Migrations (Task 1):**
- `{ts>20260906120000}_create_enrollment_history.{up,down}.sql` — table (AC5 cols) + `ENABLE`+`FORCE` RLS + `enrollment_history_select`/`_insert` policies (no update/delete policy) + `REVOKE UPDATE,DELETE,TRUNCATE … FROM PUBLIC` + `… FROM classlite_app`; indexes `(center_id, performed_at DESC)` + `(center_id, student_id)`. FKs: center CASCADE, student/class/performer NO ACTION.
- `{ts}_add_enrollments_status_withdrawn_at_check.{up,down}.sql` — `CHECK ((status='active' AND withdrawn_at IS NULL) OR (status IN ('withdrawn','transferred') AND withdrawn_at IS NOT NULL))`.
- `{ts}_backfill_enrollment_history_genesis.{up,down}.sql` — one `action='add'` genesis row per existing enrollment; per-center `SET LOCAL app.current_tenant_id` loop.

**Store (Task 2 — `queries/enrollment_history.sql` + extend `enrollments.sql`):**
- `InsertEnrollmentHistory(ctx, {CenterID, StudentID, Action, FromClassID, ToClassID, EffectiveDate, Note, PerformedBy}) → row`.
- `ListEnrollmentHistoryPaged(ctx, {Limit int32, Offset int32, StudentID/ClassID optional nargs}) → []Row` **(the compile-red anchor the generated red references)** — newest-first (`performed_at DESC, id DESC`), RLS center-scoped, denormalized (student/class names + performer name). `CountEnrollmentHistory(...)` shares the filter.
- `WithdrawEnrollment(ctx, {ID, WithdrawnAt, ...}) :execrows` (SET status='withdrawn', withdrawn_at, updated_at=now()); `TransferEnrollmentSource(...)` (SET status='transferred', ...); target reuses `CreateEnrollment`.
- `ListUnassignedStudents(ctx, {CenterID}) → []Student` (student member, `NOT EXISTS` active enrollment); `ListOverCapacityClasses(ctx, {CenterID}) → []{Class, ActiveCount}` (`HAVING count(*) FILTER (WHERE status='active') > capacity`, `capacity IS NOT NULL`) — SQL-aggregated, no N+1 (PERF-2). `GetClassTeacherRecipient(...)` for notify.

**Service (Task 4/5):** extend `NewEnrollmentService(db, audit, clk, +bus, +emailQueue, +templates/recipients)`; `WithdrawEnrollment`/`TransferEnrollment`; retrofit `CreateEnrollment` (history row + enrollable guard + notify + event). One tenant tx per action (state-change + `InsertEnrollmentHistory` + `audit.LogWithinTx`); email/event **post-commit** best-effort. SEC-1: re-fetch `member.Role` from `center_members`, gate `∈ {owner,admin}`, never `tc.Role`. New codes `CLASS_NOT_ENROLLABLE` (422), `NOT_ENROLLED_IN_SOURCE` (422).

**Handler (Task 6):** action-body parse (+legacy `{studentId,classId}` normalize) on `POST /api/enrollments`; `GET /api/enrollments/history` + `GET /api/enrollments/attention`; enrollment chain + `RequireRole("owner","admin")` edge defense-in-depth.

## Implementation checklist (ordered — red stays red until its seam lands)

1. [ ] **Migration `create_enrollment_history`** (+ coupling CHECK + genesis backfill) → `scripts/migrate.sh`. Turns the immutability grid (`enrollment_history_rls_atdd_test.go`) and the coupling reds (`enrollment_status_coupling_atdd_test.go`) from red → green at runtime.
2. [ ] **`queries/enrollment_history.sql` + extend `enrollments.sql`** → `scripts/codegen.sh` (defines `generated.ListEnrollmentHistoryPaged`/`Params`, `InsertEnrollmentHistory`, `WithdrawEnrollment`, `TransferEnrollmentSource`, `ListUnassignedStudents`, `ListOverCapacityClasses`) — clears the AC11 compile-fail.
3. [ ] **Author the ⏳ service/handler authz + atomicity reds red-first** against `setupEnrollmentHandlerTest` (+ a service-level env for SEC-1 role re-fetch), once the `NewEnrollmentService` ctor + action-body shape are chosen: exactly-one-row + rollback-none (AC7); teacher/student→403 + demoted-admin stale-JWT→403 (AC1/R15); enrollable 422 + NOT_ENROLLED_IN_SOURCE (AC2/3/4); genesis-backfill count (AC10). **These MUST exist on the branch before `in-progress`.**
4. [ ] **api.yaml action body + new reads** → `codegen.sh`.
5. [ ] Implement migrations → store → service → handler → drive ALL reds green.
6. [ ] **De-tag** every `//go:build atdd_red_phase` file → permanent regression suite.
7. [ ] `go build ./... && go vet ./... && go test ./... -race -count=1 -p 1` green (serialize DB-tx packages — deterministic-tenant-ID contention, per 7-1a/7-2a). Pre-existing 3.1/2.3b spawn wall-clock date-bomb is untouched. `codegen.sh` additive; web `tsc -b`=0.

## Generated red files (this run)

- ✅ `enrollment_history_rls_atdd_test.go` — **6 tests**: append-only UPDATE/DELETE/TRUNCATE hard-reject (P0, R17) + cross-tenant read/insert grid (P0) + ListEnrollmentHistoryPaged positive-control (P1, the compile-red anchor). New helper `insertEnrollmentHistoryRaw` (raw SQL, robust to the sqlc shape). Reuses `seedEnrollmentDeps`/`CreateCenterWithID`/`TenantContext`/`AssertRLSViolation`.
- ✅ `enrollment_status_coupling_atdd_test.go` — **3 tests**: withdrawn+NULL rejected, active+timestamp rejected, valid combos (active+NULL / withdrawn+ts / transferred+ts) accepted (P1, CR-3-4-5-1). New helper `attemptEnrollmentInsert` (savepoint-wrapped).

## Verification (this run)

- **Normal build:** `go build ./internal/test/` = exit 0 — reds excluded from the permanent suite / CI. ✅
- **Normal vet:** `go vet ./internal/test/` = exit 0. ✅
- **Tagged vet:** `go vet -tags atdd_red_phase ./internal/test/` compile-fails on **exactly two symbols** — `generated.ListEnrollmentHistoryPaged` + `generated.ListEnrollmentHistoryPagedParams` (the intended AC11 greenfield seam). **No scaffold bugs, no collateral breakage.** ✅
- The immutability + coupling tests are **runtime-red** (they compile under the tag once the seam lands, then fail until the migration adds the table/REVOKE/CHECK) — documented in each file header, the correct shape for a DB-layer guarantee (raw-SQL, per the audit_logs precedent).

## Assumptions & risks

- The 2 generated files cover the ★ R17 immutability driver + the CR-3-4-5-1 data-integrity guard — the seams that are stable today. The remaining P0 reds (exactly-one-row atomicity, teacher/demoted-admin→403 role re-fetch) depend on the greenfield `NewEnrollmentService` constructor + unified action-body wiring; authoring them now would hard-code a design not yet chosen, so they are **specified red-first** (step 3) rather than generated — the identical call 7-2a made for its handler/authz reds.
- `ListEnrollmentHistoryPagedParams{Limit, Offset}` uses the house sqlc LIMIT/OFFSET convention (`int32`, mirrors `ListEnrolledStudentsByClassPagedParams`); optional `StudentID`/`ClassID` nargs zero-init in the literal, so adding them does not break the anchor. If the dev names the query differently, update the one call at green.
- `performed_by` nullable is load-bearing for the genesis backfill — if the dev makes it NOT NULL, the AC10 backfill has no valid performer and breaks.

## Handoff

- **Story:** `_bmad-output/implementation-artifacts/7-3a-enrollment-management-backend.md`
- **Next:** `/bmad-dev-story 7-3a` — implement migrations → store → service → handler; author the ⏳ authz/atomicity reds red-first; drive all reds green; de-tag. Then `/bmad-tea TA 7-3a` (Test Automate) AFTER implementation for P2/P3 + fault-injection expansion, and `/bmad-code-review 7-3a` (prefer a different LLM).
