# Story 7-2b: Completion Notes

_Implementation record for [`7-2b-student-lists-and-student-detail-frontend.md`](./7-2b-student-lists-and-student-detail-frontend.md). Status: review._

## Dev Agent Record

### Debug Log

- **RED confirmed first** — the 6 Murat ATDD files failed on 4 missing page/component modules + the `requiredRolesForCopy={['teacher']}` type error (`PermissionDeniedRoles` couldn't express `['teacher']`). Exactly the D1 driver.
- **Notes-mutation cache strategy (D11 reconcile).** MSW's GET handlers are static, so an `invalidateQueries` on the notes list would refetch the unchanged list and DROP the just-applied create/flag/delete — breaking the ATDD assertions ("note appears", "flag reflects", "note disappears"). Resolved by updating the `studentNotes(id)` cache DIRECTLY from each mutation response (append / replace / optimistic-remove-with-rollback) and invalidating only `studentDetail(id)` (a different, unmounted query). Pragmatic read of the AC "invalidate" wording ([[feedback_pragmatic_interpretation_of_spec_absolutes]]) — the cache-direct write is the authoritative single-log update.
- **Detail composes the notes panel without a second fetch.** `onUnhandledRequest: 'error'` means the detail test (mocks only `/api/students/:id`) would error if the composed `StudentNotesPanel` fetched `/notes`. `useStudentNotes` grew an optional `initialNotes` seed; `StudentDetailPage` passes the detail's embedded `notes` → the panel renders the log with no round-trip. Mounted standalone (panel test), it fetches.
- **FW-7 fix during green.** `PerfPill`/`SkillPerfBars` initially imported wire types from the people feature (`features/people/api/useStudents`) — a domain-tier boundary violation. Repointed to the generated client (`components['schemas'][…]`). ESLint `react-refresh/only-export-components` also flagged `PerfPill` co-exporting `perfToneFromStatus`; extracted the mapper + `PerfTone` type to `components/domain/perfTone.ts`.
- **Teacher roster "Attendance" column** has no backing field — `StudentListItem` (wire contract) carries no per-student attendance rate (it lives on the whole-student detail). The column renders `—` always (never `0%`, AC4). Flagged as a follow-up (roster-level attendance rate = FU) below.
- **Teacher filter chip deferred.** AC10 names class + teacher filter chips. The roster wire shape carries `classId` (class filter shipped, server-side `?class_id`) but NOT a `teacherId` (only `teachers: string[]` names) — a teacher-id filter has no roster-sourced value and would need the staff-roster list. Shipped the class chip; teacher chip deferred (FU) — flagged.

### Completion Notes

All 9 tasks / 21 ACs implemented over Murat's ATDD scaffold — every red test green, plus a new route-precedence guard.

- **Routes (D1):** `/students` + `/students/:id` (teacher gate) activate the shipped DEAD sidebar link; `/people/students` + `/people/students/:id` (owner/admin gate); one shared class-agnostic `StudentDetailPage`. `/students/import` precedence preserved (RRv7 static-over-`:id`), asserted by `StudentRoutesPrecedence.test.tsx` against the real router config.
- **PermissionDenied (D1):** `PermissionDeniedRoles` widened with `['teacher']`; explicit teacher `bodyKey`/`requiredRoleSummaryKey` branch (not a length collapse); `section.students.header` broadened to staff-inclusive (en + vi).
- **Hooks (D3/D4):** `peopleKeys` extended (studentList(params)/studentDetail/studentNotes + 3 note-mutation slots); `useStudents.ts` (roster via `apiFetchWithMeta`, `page_size=100`; detail + notes via `apiFetch`); `useStudentActions.ts` (create/flag/delete, cache-direct).
- **Domain (D8/D9/D10):** `PerfPill` (perf tones, NOT a `StatusPill` retrofit), `SkillPerfBars` (4 IELTS skills, `lang="en"`, null→em-dash never 0), `BandScoreChart` (big band + 2 deltas, NO projection). `perfTone.ts` holds the shared mapper/type.
- **Roster (D5/D6/D7):** one `StudentRosterView` in `center`/`teacher` variants; client-derived tabs + counts over the loaded page; `page_size=100` window + overflow pager + `role="status"` count note (AC10); server-side class filter chip.
- **Detail (D14):** head + 6-up stat strip + perf-card + enrolled-classes list + at-risk reasons + composed notes panel. Notes-only write surface — no enrollment actions / share / PDF / projection / inquiries (all deferred).
- **Notes (D11):** chronological flag/plain log (no red warn tier), composer (content + flag + save, disabled on empty), per-note flag toggle, author-or-owner/admin-gated delete (control ABSENT for a non-author teacher; 403 mapped to a toast), Attach/@mention absent.
- **D13 co-finalization:** stripped both PROVISIONAL markers from the api.yaml student read block; `codegen.sh` re-ran with ZERO generated diff (client.ts + Go generated unchanged — comment-only api.yaml edit). Notes mutation shapes left untouched (already stable).

**Deviations / flags for Ducdo/Sally:**
1. `NEW_STUDENT_WINDOW_DAYS = 30` defined locally (D5) — not carried on the wire contract; confirm it matches 7-2a `NewStudentWindowDays`.
2. Teacher roster **Attendance** column shows `—` (no roster-level attendance field in the contract) → **FU: roster attendance rate**.
3. **Teacher** filter chip deferred (roster carries teacher names, not IDs; class chip shipped) → **FU: teacher filter source**.
4. 6-up stat strip uses **Enrolled classes** as box 6 (mock's "Inquiries" is anchored-Q&A, deferred per D14).

### Implementation Plan (as executed)

i18n (Task 7) → PermissionDenied widen (Task 1a) → peopleKeys + hooks (Task 2) → domain components (Task 3) → StudentRosterView + role pages (Task 4) → StudentNotesPanel (Task 6) → StudentDetailPage (Task 5, composes 6) → routes + sidebar (Task 1b) → route-precedence test (Task 8) → FW-7/react-refresh refactor → contract co-finalize + regen (Task 9).

## File List

### Added
- `classlite-web/src/features/people/StudentsTeacherPage.tsx` — s10a teacher roster (thin variant wrapper)
- `classlite-web/src/features/people/StudentsCenterPage.tsx` — s42 center roster (thin variant wrapper)
- `classlite-web/src/features/people/StudentDetailPage.tsx` — shared s10 detail
- `classlite-web/src/features/people/components/StudentRosterView.tsx` — shared roster view (both variants)
- `classlite-web/src/features/people/components/StudentNotesPanel.tsx` — teacher-notes composer + log
- `classlite-web/src/features/people/api/useStudents.ts` — roster/detail/notes queries
- `classlite-web/src/features/people/api/useStudentActions.ts` — note create/flag/delete mutations
- `classlite-web/src/components/domain/PerfPill.tsx` — performance status pill
- `classlite-web/src/components/domain/perfTone.ts` — PerfTone type + AtRiskStatus→tone mapper
- `classlite-web/src/components/domain/SkillPerfBars.tsx` — 4-skill bars
- `classlite-web/src/components/domain/BandScoreChart.tsx` — big-band + 2 deltas
- `classlite-web/src/features/people/__tests__/StudentRoutesPrecedence.test.tsx` — AC3 precedence guard
- (Murat ATDD, now green): `__tests__/{StudentRoutesGate,StudentsTeacherPage,StudentsCenterPage,StudentDetailPage}.test.tsx`, `components/__tests__/StudentNotesPanel.test.tsx`, `api/__tests__/studentHandlers.ts`

### Modified
- `classlite-web/src/features/people/api/peopleKeys.ts` — student list/detail/notes + note-mutation slots + `StudentListParams`
- `classlite-web/src/components/shared/PermissionDenied.tsx` — `PermissionDeniedRoles` += `['teacher']`; teacher body/summary branch
- `classlite-web/src/components/domain/sidebarNavConfig.tsx` — owner + admin "Students" → `/people/students`
- `classlite-web/src/routes.tsx` — 4 routes (teacher `/students(+:id)`, owner/admin `/people/students(+:id)`)
- `classlite-web/src/locales/en.json`, `vi.json` — `people.student.*` (+93 keys each) + PermissionDenied teacher copy + broadened `section.students.header` + sidebar students
- `classlite-api/api.yaml` — stripped PROVISIONAL markers from the student read block (comment-only; D13)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — 7-2b status

### Deleted
- (none)
