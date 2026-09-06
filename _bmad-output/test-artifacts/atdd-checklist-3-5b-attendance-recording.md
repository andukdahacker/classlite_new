---
stepsCompleted: ['step-01-preflight-and-context', 'step-02-generation', 'step-03-red-verify']
lastStep: 'step-03-red-verify'
lastSaved: '2026-09-03'
storyId: '3.5b'
storyKey: '3-5b-attendance-recording'
storyFile: '_bmad-output/implementation-artifacts/3-5b-attendance-recording.md'
atddChecklistPath: '_bmad-output/test-artifacts/atdd-checklist-3-5b-attendance-recording.md'
detectedStack: 'fullstack'
generatedTestFiles:
  - 'classlite-api/internal/test/attendance_rls_atdd_test.go'
  - 'classlite-api/internal/handler/attendance_handler_atdd_test.go'
  - 'classlite-web/src/features/session-detail/__tests__/AttendanceSection.test.tsx'
inputDocuments:
  - '_bmad-output/implementation-artifacts/3-5b-attendance-recording.md (v0.2)'
  - 'docs/project-context.md (TEST-BE-1/3/4, TEST-FE-1/2/4/5/6, WF-8 hard rule)'
  - 'classlite-api/internal/handler/session_content_handler_atdd_test.go (BE precedent)'
  - 'classlite-api/internal/test/enrollments_rls_test.go + staff_roster_rls_atdd_test.go (RLS/★re-read precedent)'
  - 'classlite-web/src/features/session-detail/__tests__/SessionDetailPage.test.tsx (FE precedent)'
---

# ATDD Red-Phase Checklist — Story 3-5b (Attendance Recording)

**Gate context:** WF-8 HARD RULE — AC2 (RLS) maps to standing risks R1=9 / R2=6, so these reds are **REQUIRED on the branch before the story goes `in-progress`** (not optional). Risk_score = 6.

## RED verification (proven 2026-09-03)

| Check | Command | Result |
|---|---|---|
| Green suite unaffected (tagged files excluded) | `go vet ./internal/test/ ./internal/handler/` | ✅ exit 0 |
| BE reds compile-fail under the tag | `go test -tags atdd_red_phase -run xxx ./internal/test/ ./internal/handler/` | ✅ build failed on the greenfield seams (below) |
| FE red fails typecheck | `tsc -b` | ✅ `Cannot find module '@/features/session-detail/components/AttendanceSection'` |

## Generated red scaffolds → AC coverage

### `classlite-api/internal/test/attendance_rls_atdd_test.go` (`//go:build atdd_red_phase`, `package test`)
- **AC2** `TestRLS_Attendance_CrossTenantRead` — tenant A sees 0 of tenant B's rows.
- **AC2** `TestRLS_Attendance_CrossTenantWrite` — cross-tenant UPDATE affects 0 rows **+ ★ re-read AS tenant B asserts byte-unchanged** (Murat house rule).
- **AC6** `TestStore_Attendance_UpsertIdempotent` — mark → re-mark → `count = 1` + status updated (UNIQUE + ON CONFLICT).
- **AC11** `TestStore_Attendance_RosterLeftJoinUnmarkedNull` — active enrollments LEFT JOIN attendance; unmarked → `status NULL`; runs in a tenant tx.

### `classlite-api/internal/handler/attendance_handler_atdd_test.go` (`//go:build atdd_red_phase`, `package handler_test`)
- **AC10** `TestAttendance_NonOwningTeacher_404` — teacher-not-of-class → **404 SESSION_NOT_FOUND** (not 403).
- **AC10** `TestAttendance_Student_403` — student → **403 INSUFFICIENT_ROLE** (in-service `assertClassRole`).
- **AC5b/D14** `TestAttendance_CancelledSessionAllowed` — the class teacher can mark a **cancelled** session (200).
- **AC7** `TestAttendance_NotEnrolled_422` — PUT for a non-enrolled student → **422 NOT_ENROLLED**.
- **AC9/D6** `TestAttendance_BulkOneBadIdLast_ZeroWrites` — bulk with a bad id **positioned last** → 422 **and `count(*) = 0`** (validate-all-before-write; real DB, not the mock seam).

### `classlite-web/src/features/session-detail/__tests__/AttendanceSection.test.tsx` (vitest + MSW + axe)
- **AC15** i18n key-existence in `en` + `vi` (incl. `.status.*`, `.summary`, `.markAll*`, `.undo`, `.empty.*`, `.bulkError`).
- **AC12** skeleton → live roster + `attendance-summary` + `data-unmarked` loud-state; **AC5** role-aware teacher empty (no dead CTA); error trilogy.
- **AC13/D11** optimistic toggle + **no clear/un-mark control** present.
- **AC14/D12** "Mark all Absent" → **undo** affordance; **AC14/D13** bulk failure → single `alert` banner + revert.
- **TEST-FE-6** a 404 (non-owning teacher) renders **no write controls**; **TEST-FE-5** axe clean.

## GREEN SEAMS the dev implements (turns red → green)
- Migration `20260903120000_create_attendance` (+ 4-policy RLS, UNIQUE, FKs).
- `queries/attendance.sql` → `generated.UpsertAttendance`, `generated.ListAttendanceRosterBySession`.
- `internal/test/story_3_5b_helpers.go` → `NewAttendanceTestServerBareMux`.
- `attendance_service.go` + `attendance_handler.go` + routes on `sessionChain`.
- FE `components/AttendanceSection.tsx` + `AttendanceToggle.tsx` + `api/attendanceApi.ts` + `session.attendance.*` flat i18n keys.

## Not covered here (intentional — belongs to green-phase inline tests, per WF-8 step 2)
- Full CRUD happy-path envelopes (TEST-BE-3 green), service mock-seam business rules (TEST-BE-4), the undo-restore exact snapshot, mobile/VI toggle layout. These land as the dev turns the reds green + `/bmad-tea TA` post-dev.
