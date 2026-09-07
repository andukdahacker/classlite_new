---
stepsCompleted: ['step-01-preflight-and-context', 'step-02-generation-mode', 'step-03-test-strategy', 'step-04-generate-tests', 'step-05-validate-and-complete']
lastStep: 'step-05-validate-and-complete'
lastSaved: '2026-09-06'
storyId: '7.2a'
storyKey: '7-2a-student-lists-and-student-detail-backend'
storyFile: '_bmad-output/implementation-artifacts/7-2a-student-lists-and-student-detail-backend.md'
atddChecklistPath: '_bmad-output/test-artifacts/atdd-checklist-7-2a-student-lists-and-student-detail-backend.md'
detectedStack: 'backend'
generatedTestFiles:
  - 'classlite-api/internal/test/at_risk_detector_atdd_test.go'
  - 'classlite-api/internal/test/student_roster_rls_atdd_test.go'
  - 'classlite-api/internal/test/student_notes_atdd_test.go'
  - 'classlite-api/internal/test/student_aggregates_atdd_test.go'
inputDocuments:
  - '_bmad-output/implementation-artifacts/7-2a-student-lists-and-student-detail-backend.md'
  - 'docs/project-context.md (TEST-BE-1..5, WF-8, GO-1..7)'
  - 'classlite-api/internal/test/staff_roster_rls_atdd_test.go (7-1a red blueprint)'
  - 'classlite-api/internal/test/staff_load_aggregate_atdd_test.go (bound-now blueprint)'
  - 'classlite-api/internal/test/story_7_1a_helpers.go (test-server harness blueprint)'
---

# ATDD Red-Phase Checklist — Story 7-2a (Student Lists & Detail — Backend)

_Master Test Architect: Murat · 2026-09-06 · WF-8 HARD GATE (risk 7). Red-first before `in-progress`._

## Preflight

- **Stack:** `backend` (Go-only keystone). No E2E — Playwright rides 7-2b.
- **Prereqs:** ✅ story approved, 19 clear ACs · ✅ Go test infra (`internal/test`, `test.SetupDB`, `clock.NewMockClock`, deterministic `TenantAID`/`TenantBID`) · ✅ dev DB available.
- **Red convention:** `//go:build atdd_red_phase` (tagged-compile-fail — project convention, NOT Playwright `test.skip()`). Normal `go build`/`go test` excludes these files; the reds compile-fail on greenfield seams under `-tags atdd_red_phase`. Verified: normal build green; tagged build fails **only** on the seams below.
- **Seams (project rule):** store reds = **real DB in tx** (a mock false-greens the join-scoping + RLS + window math); service reds = **mock store / pure Go**; handler reds = **real middleware chain**. Clock = **injected**, never `time.Now()`. Cross-tenant writes: **re-read AS tenant B, assert byte-unchanged** (the ★ house rule).

## ★ Corrections surfaced during recon (fold into implementation)

1. **`assignments.deadline_at`, NOT `due_at`.** Every "past-due / missed / on-time" derivation keys on `assignments.deadline_at` (NOT NULL). `submissions.is_late boolean` also already exists — on-time = `submitted_at <= deadline_at` (or reuse `is_late`).
2. **`classes.target_band numeric(3,1)` is NULLABLE.** The Good/Normal split + s10 "class target" read it. `class_templates.target_band` is NOT NULL, but a class may override to NULL. For a **multi-class** student the roster Good/Normal cut needs one target — **spec-fill (epic silent):** default to the max enrolled `target_band` (most ambitious), tunable. Detail (`class_id`-scoped) uses that class's target.
3. **`exercises.target_band` also exists** (per-exercise) — do NOT confuse with the class target. Per-skill/Good-Normal use `classes.target_band`.
4. **`exercises.skill` enum** = `reading|listening|writing|speaking|grammar|vocabulary|general`. The 4-box breakdown surfaces ONLY the 4 IELTS; grammar/vocabulary/general are excluded at the **service** (still counted in `overallBand`).

## Test strategy — AC → level → priority

| AC | Scenario | Level | Priority | Red file |
|----|----------|-------|----------|----------|
| 11, 19 | AtRiskDetector.Classify boundary table (attendance 0.69/0.70, 2/1 consecutive, drop 1.0/0.9, insufficient-data, Good/Normal split, multi-reason) | Unit (pure Go) | **P0** | `at_risk_detector_atdd_test.go` ✅ |
| 15 | Cross-tenant roster read isolation (+positive control) | Integration (real DB) | **P0** | `student_roster_rls_atdd_test.go` ✅ |
| 2, 16 | ★ Teacher role-scope isolation (T1≠T2 rosters; center-wide sees both) | Integration (real DB) | **P0** | `student_roster_rls_atdd_test.go` ✅ |
| 5 | Pagination Limit/Offset + CountStudents total + past-end empty | Integration (real DB) | **P1** | `student_roster_rls_atdd_test.go` ✅ |
| 9 | Per-skill band derivation (reading/writing set, listening/speaking absent) | Integration (real DB) | **P0** | `student_aggregates_atdd_test.go` ✅ |
| 10 | Attendance-rate inputs (present+late / total; absent in denom) | Integration (real DB) | **P1** | `student_aggregates_atdd_test.go` ✅ |
| 12, 13, 14 | Notes lifecycle (insert→chrono list→flag→soft-delete-hides, double-delete 0 rows) | Integration (real DB) | **P1** | `student_notes_atdd_test.go` ✅ |
| 15 | Notes cross-tenant (A can't list/delete B's; re-read-as-B unchanged) | Integration (real DB) | **P0** | `student_notes_atdd_test.go` ✅ |
| 3, 8 | Read authz: student → 403 on list+detail | Integration (handler chain) | **P0** | ⏳ add red-first (needs harness) |
| 7 | Teacher `GET /students/{id}` out-of-scope → 404 non-disclosure | Integration (handler chain) | **P0** | ⏳ add red-first (needs harness) |
| 12, 14 | Notes authz: student→403; non-author teacher delete→403; author/owner→ok | Service (mock store) + handler | **P0** | ⏳ add red-first |
| 11 | Consecutive-missed + band-drop INPUT queries (leading run over deadline_at; last-4 window) | Integration (real DB) | **P1** | ⏳ add red-first |
| 10 | on-time / pending / missing split at `deadline_at` vs `clock.Now()` | Integration (real DB) | **P2** | ⏳ add red-first |

## Green seams (consolidated contract for the dev)

**Store (`queries/students.sql`, `queries/student_notes.sql` — Task 3):**
- `ListStudents(ctx, {CenterID, TeacherID pgtype.UUID(Valid=false⇒center-wide), ClassID, Now, Limit, Offset}) → []ListStudentsRow` — `role='student'` ⋈ users; teacher-scope = active enrollment in a class where `classes.teacher_id=TeacherID`. Row carries at-risk INPUT columns (attendance num/denom, consecutive-miss run, last-4 band slice) so the service batch-classifies the page — **NO N+1**.
- `CountStudents(ctx, {CenterID, TeacherID, ClassID}) → int64` — same filter, full total.
- `StudentPerSkillBands(ctx, {CenterID, StudentID}) → []{Skill string, AvgBand pgtype.Numeric}` — released `current_grades` grouped by `exercises.skill`.
- `GetStudentAttendanceStats(ctx, {CenterID, StudentID}) → {PresentLate, TotalMarked int64}`.
- `InsertStudentNote` / `ListStudentNotes` (deleted_at IS NULL, created_at ASC) / `SetStudentNoteFlag` / `SoftDeleteStudentNote` (:execrows).
- `ListEnrolledStudentsByClass` gains `Limit`/`Offset` + a count (CR-3-4-5-3, D10).

**Service (Task 4/5/6):** `service.NewAtRiskDetector(clk clock.Clock)` + `AtRiskInputs`/`AtRiskResult{Status,Reasons}` + `Classify`; exported consts `AtRiskAttendanceFloor=0.70`, `AtRiskConsecutiveMissed=2`, `AtRiskGradedWindow=4`, `AtRiskBandDropDelta=1.0`, `OverallBandWindow=5`. `StudentService.ListStudents`/`GetStudentDetail`/notes methods (role-scoped, 404 non-disclosure, SEC-1 re-validate on note writes). `StudentHandler` on `RequireRole("owner","admin","teacher")`.

**Migration (Task 2):** `{ts>20260903120000}_create_student_notes.{up,down}.sql` — table + 4-policy `center_id` RLS grid + `idx_student_notes_center_student`.

## Implementation checklist (ordered — red stays red until its seam lands)

1. [ ] **Migration** `create_student_notes` → `scripts/migrate.sh` (unblocks the notes reds at runtime).
2. [ ] **`queries/students.sql` + `student_notes.sql`** → `scripts/codegen.sh` (defines `generated.ListStudents*`, `CountStudents`, `StudentPerSkillBands`, `GetStudentAttendanceStats`, note queries) — clears the roster/aggregates/notes compile-fails.
3. [ ] **`at_risk_detector.go`** — `NewAtRiskDetector`/`AtRiskInputs`/`AtRiskResult`/`Classify` + consts — clears the detector compile-fails; run `go test -tags atdd_red_phase -run AtRisk` → green.
4. [ ] **Add the ⏳ handler/service authz reds** red-first (student→403, teacher out-of-scope→404, non-author note delete→403) using a new `NewStudentTestServerForRole` harness cloned from `story_7_1a_helpers.go:33` `NewStaffTestServerForRole`.
5. [ ] **Add the ⏳ input-query reds** red-first (consecutive-missed leading run over `deadline_at`; last-4 band-drop window; on-time/pending/missing split at `clock.Now()`).
6. [ ] Implement service + handler → drive ALL reds green.
7. [ ] **De-tag** every `//go:build atdd_red_phase` file → permanent regression suite.
8. [ ] `go build ./... && go vet ./... && go test ./... -race -count=1 -p 1` green (serialize DB-tx packages — deterministic-tenant-ID contention, per 7-1a). `codegen.sh` additive; web `tsc -b`=0.

## Generated red files (this run)

- ✅ `at_risk_detector_atdd_test.go` — 16-case boundary table + multi-reason (P0, the correctness gate).
- ✅ `student_roster_rls_atdd_test.go` — cross-tenant + ★ teacher-scope + pagination (P0/P1); local converters `pgUUID`/`uuidFromPg` + seeds `seedStudentMember`/`seedClassWithTeacher`/`seedActiveEnrollment` (shared by the other reds under the tag).
- ✅ `student_notes_atdd_test.go` — lifecycle + cross-tenant re-read-as-B (P0/P1).
- ✅ `student_aggregates_atdd_test.go` — per-skill derivation + attendance stats (P0/P1); `seedReleasedGrade` full chain (exercise→assignment→submission→grade).

## Assumptions & risks

- The 4 generated files cover the ★ risk-driver reds (at-risk correctness, teacher-scope, cross-tenant, per-skill). The remaining P0 **authz** reds (student-403, teacher-404-non-disclosure, non-author-note-delete-403) need the greenfield test-server harness — **must be authored red-first before `in-progress`** (step 4 above); they are specified here, not yet generated, to avoid guessing the not-yet-designed handler wiring.
- `numericToFloat` uses `pgtype.Numeric.Float64Value()` (pgx v5) — if the dev types `StudentPerSkillBands.AvgBand` as a different numeric carrier, adjust the helper.
- Verified this run: `go build ./...` (tag off) = clean; `go vet -tags atdd_red_phase ./internal/test/` fails only on `service.AtRiskDetector`/`AtRiskInputs`/`generated.ListStudents*` (greenfield) — no scaffold bugs.

## Handoff

- **Story:** `_bmad-output/implementation-artifacts/7-2a-student-lists-and-student-detail-backend.md`
- **Next:** `/bmad-dev-story 7-2a` (implement red→green→de-tag). `automate` (`/bmad-tea TA 7-2a`) comes AFTER implementation for coverage expansion.
