# Story 7-2a: Completion Notes

_Implementation record for [`7-2a-student-lists-and-student-detail-backend.md`](./7-2a-student-lists-and-student-detail-backend.md). Status: review._

## Dev Agent Record

### Debug Log

- **Notes ordering (red `TestStudentNotes_Lifecycle`):** first list returned `[second, first]`. Root cause — `created_at DEFAULT now()` returns the transaction start time, so two notes inserted in ONE test tx tie and cannot be ordered. Fix: migration `created_at DEFAULT clock_timestamp()` (advances within a tx). Corrected the (uncommitted, same-session) migration + re-ran down/up. Chronological log is now strictly orderable.
- **Aggregates red seeded `sessions.status='completed'`** — violates the CHECK (`scheduled|cancelled`). Fixed the red seed → `'scheduled'` (the attendance-stats query does not depend on session status). Flagged in the ATDD checklist as "compile-verified only".
- **Consecutive-missed input red over-counted (got 4/3, want 2/1):** the red seeded two students into the SAME class → 6 shared assignments, so each student saw the other's. Fixed the test to give each student their own class (disjoint assignment sets). The SQL leading-run was correct.
- **sqlc `interface{}` columns:** `max(c.target_band)` and the `jsonb_agg` both inferred as `interface{}`. Cast `max(...)::numeric` → `pgtype.Numeric`; cast the enrolled-classes agg `::text` → `string` (service `json.Unmarshal`s it). Deterministic types.
- **`ListEnrolledStudentsByClass` signature:** initially paginated it in place, which broke attendance's `BulkMark` (needs the FULL active set). Reverted to keep the unpaged query for attendance and added a separate `ListEnrolledStudentsByClassPaged` + `CountEnrolledStudentsByClass` for the HTTP list (D10). Zero attendance regression.
- **`parsePageParams` collision:** an existing `parsePageParams` (assignment_handler) reads camelCase `pageSize`; my contract uses snake_case `page_size` (XL-2). Added `parseSnakePageParams` instead of reusing.
- **Seeder name collisions in `test` package:** `seedAssignment`/`seedSubmission` already exist (attempt_read_test) → renamed mine `seedInput*`.
- **Pre-existing date-bomb (NOT 7-2a):** `TestSpawn_*` (handler) + `TestClassService_Spawn_AC04_*` (service) fail because they hardcode `StartDate:"2026-08-01"` and construct the service with `clock.RealClock{}`; the 30-day-past drift rule (`spawnStartDateDrift`) now rejects it (today 2026-09-07 = 37 days later). Confirmed the tests use `RealClock{}` + a fixed date; untouched by this story. Recommend the class-spawn story inject a `MockClock` or relativize the dates.

### Completion Notes

Shipped the full Story 7-2a backend: a role-scoped, paginated student roster read model; a per-student detail composition (band / per-skill / attendance / submission stats / at-risk / notes / currentVsFirstDelta); a clock-injected `AtRiskDetector`; and the `student_notes` surface (create/list/flag/soft-delete).

- **D3 role-scope (R-SEC):** ONE `GET /api/students`. Admin/owner center-wide; teacher pinned to own userId (any `teacher_id` param ignored). `ListStudents`/`CountStudents` take an optional `teacher_id` narg; a teacher's caller-visible aggregates and membership all key on it. Proven by `TestStudentRoster_TeacherScope_Isolation` (real DB, positive control) + the handler `TeacherOutOfScope404` (404 non-disclosure, never 403).
- **D4 at-risk:** `AtRiskDetector.Classify` is pure Go over per-row INPUT columns supplied by LATERAL subqueries on the roster row → the whole page classifies with NO N+1. Thresholds are named consts (single source of truth); the SQL window sizes (`LIMIT 5`/`LIMIT 4`) are documented to mirror `OverallBandWindow`/`AtRiskGradedWindow`. Exhaustive boundary table + multi-reason test green.
- **D6 per-skill:** derived via `submission → assignments.exercise_id → exercises.skill` off `current_grades` (released only). The store seam `StudentPerSkillBands` stays center-wide (pinned by the red) but takes an optional `teacher_id` narg so the detail IS teacher-scoped (satisfies AC9). Service surfaces only the 4 IELTS skills; grammar/vocabulary/general excluded from the box breakdown (still counted in overallBand).
- **D7/D8 notes:** `student_notes` with 4-policy RLS + soft-delete; `attachments jsonb` ships empty (no R2/@mention). Author-or-owner/admin delete guard; SEC-1 role re-validation on every write; staff-only (student → 403).
- **D10 pagination:** both the new list and `GET /api/classes/{classId}/enrollments` (`?page`/`page_size`, clamped `[1,100]`, default 20).
- **D14:** read shapes (`StudentListItem`/`StudentDetail`/`StudentNote` read + pagination meta) marked PROVISIONAL in api.yaml for 7-2b to co-finalize; notes mutation shapes are stable.

**Deviations / spec-fills:**
- Good/Normal split uses `overallBand >= max(enrolled class target_band)` (multi-class spec-fill per the ATDD checklist; `classes.target_band` is nullable → nil target ⇒ "normal").
- `currentVsFirstDelta` = avg(last 5 released) − avg(first-month released); nil when insufficient data. `BandTrendSparkline`/projection remain OUT (Epic 8, D9).

**Gates:** `go build`/`go vet ./...` clean; `tsc -b`=0; full Go race suite green except the documented pre-existing spawn date-bomb. All 6 ATDD files de-tagged into the permanent suite.

### Implementation Plan (as executed)

1. Migration `create_student_notes` (+ `clock_timestamp()` fix) → `migrate up` (down/up round-trip verified).
2. `queries/students.sql` + `queries/student_notes.sql` + enrollment paged query → `sqlc generate` (fixed 3 `interface{}` casts).
3. api.yaml paths + schemas (student roster/detail/notes + `EnvelopeMetaPagination`; enrollment list → paginated meta) → `codegen.sh` (client.ts additive).
4. `AtRiskDetector` (Task 4) → detector table red green.
5. `StudentService` (list/detail/notes) + `StudentHandler` + routes in `main.go` (Tasks 5/6).
6. Enrollment pagination service + handler (Task 7).
7. Authz + input reds: `NewStudentTestServerForRole` harness + `student_handler_atdd_test.go` + `student_inputs_atdd_test.go` (Task 8) → all reds green → de-tag all 6.
8. Verify (Task 9): build/vet/race suite + `tsc -b`.

## File List

### Added

- `classlite-api/migrations/20260906120000_create_student_notes.up.sql` — student_notes table + 4-policy RLS + index.
- `classlite-api/migrations/20260906120000_create_student_notes.down.sql` — reversal.
- `classlite-api/internal/store/queries/students.sql` — roster + detail-composition queries.
- `classlite-api/internal/store/queries/student_notes.sql` — notes CRUD queries.
- `classlite-api/internal/service/at_risk_detector.go` — clock-injected pure-Go classifier + consts.
- `classlite-api/internal/service/student_service.go` — list/detail/notes orchestration.
- `classlite-api/internal/handler/student_handler.go` — 6 HTTP handlers + wire shapes.
- `classlite-api/internal/test/story_7_2a_helpers.go` — `NewStudentTestServerForRole` harness.
- `classlite-api/internal/store/generated/students.sql.go`, `student_notes.sql.go` — sqlc output (generated).

### Modified

- `classlite-api/api.yaml` — student paths + schemas; enrollment list → paginated meta; PROVISIONAL read markers (D14).
- `classlite-api/internal/store/queries/enrollments.sql` — added `ListEnrolledStudentsByClassPaged` + `CountEnrolledStudentsByClass` (kept the unpaged query for attendance).
- `classlite-api/internal/service/enrollment_service.go` — `ListEnrolledStudentsByClass` now paginated (returns rows + `PageResult`).
- `classlite-api/internal/handler/enrollment_handler.go` — pagination params + paginated meta; `parseSnakePageParams`.
- `classlite-api/cmd/api/main.go` — StudentService/Handler + 6 routes on the read chain.
- `classlite-api/internal/store/generated/enrollments.sql.go` — sqlc output (generated).
- `classlite-web/src/lib/api/client.ts` — openapi-typescript output (generated, additive).
- ATDD reds de-tagged (build tag removed): `internal/test/at_risk_detector_atdd_test.go`, `student_roster_rls_atdd_test.go`, `student_notes_atdd_test.go`, `student_aggregates_atdd_test.go`, `student_inputs_atdd_test.go`, `internal/handler/student_handler_atdd_test.go`. Two red-seed corrections applied during green (session status; per-student classes) — see Debug Log.

### Deleted

- None.
