# Story 3-5b: Completion Notes

_Implementation record for [`3-5b-attendance-recording.md`](./3-5b-attendance-recording.md). Status: review._

## Dev Agent Record

### Debug Log

- **ATDD reds → green.** The 3 pre-generated red scaffolds compile-failed only on the greenfield seams (`generated.UpsertAttendance`/`ListAttendanceRosterBySession`, `test.NewAttendanceTestServerBareMux`, the FE `AttendanceSection` module). After Tasks 1–5 + 7–9 landed, all reds pass. Per [[reference-atdd-red-convention]] ("dev removes the tag per-file as each contract lands") the `//go:build atdd_red_phase` tag was **removed** from both Go files so they run in normal CI (the risk≥6 RLS/authz coverage would otherwise never execute — CI runs `go test ./...` without the tag).
- **422 NOT_ENROLLED vs 403.** The existing `service.NotEnrolledError` maps to **403** (the *caller* isn't enrolled in an assignment's class). AC7/AC9 need **422** for a *target* studentId that isn't enrolled — a request-data fault. Added a distinct `AttendanceNotEnrolledError` → 422 NOT_ENROLLED and a new error-mapper arm.
- **UPSERT `updated_at`.** `ON CONFLICT DO UPDATE` does not re-fire the column DEFAULT, so the query sets `updated_at = now()` explicitly (per D4/Task-4 note). Verified by the idempotency red (mark→re-mark→count=1 + status updated).
- **FE optimistic revert under static MSW.** The FW-2 `onSettled: invalidate` refetches the test's static GET (stale null), reverting the optimistic write and failing the toggle/undo tests. Switched both mutations to **write-through from the authoritative mutation response** (`onSuccess: setQueryData(entry|roster)`) — the PUT returns the updated entry and the bulk POST returns the full refreshed roster, so a follow-up refetch is redundant. Rollback-on-error is kept (the FW-2 triple's safety half).
- **Roster query `retry: false`.** The shared production `queryClient` retries non-auth errors once (~1s backoff), stalling the error-state tests past their 1s timeout. The section has a manual retry button, so auto-retry is redundant; disabling it makes error states immediate.
- **AttendanceToggle a11y at narrow widths.** The visible label is `hidden` under `sm` (UX-4 VI fit); an always-present `aria-label` on each segment keeps the accessible name stable at every width (the icon is `aria-hidden`).
- **FW-7 for domain components.** `AttendanceToggle`/`RosterTable` (domain tier) take the status type from the generated `@/lib/api/client`, never from the feature api, so a domain component never imports a feature.

### Completion Notes

- All 15 ACs (A1–A3, B4–B5b, C6–C7, D8–D9, E10–E11, F12–F15) satisfied; 11 tasks done.
- **Deferrals kept:** roster pagination → 7.2 (CR-3-4-5-3, D7); ended-session Inbox reminder → Epic 10 (FU-3-5-B, D8); apply-to-selected multi-select cut from v1 (D12 — the bulk endpoint keeps the optional `studentIds` for forward-compat, no FE surface). FU-3-5-A marked **resolved** in `deferred-work.md`.
- **D11/D12 accepted limitation:** "Mark all Absent" undo restores prior per-row statuses, but a row that was **unmarked (null)** before the bulk cannot be un-marked (no clear path, D11) — it stays absent. Documented inline in `AttendanceSection.handleUndo`.
- **Undo/banner are in-component DOM** (not sonner toasts) so they render without a `<Toaster>` in the test tree and are directly assertable.

### Pre-existing unrelated failure (NOT introduced by this story)

`internal/service/class_atdd_test.go` — every `TestClassService_Spawn_AC04_*` (and `Spawn_TemplateFromOtherTenantReturns404`) panics: `svc.Spawn` returns "validation failed" because the tests hardcode `StartDate: "2026-08-01"`, which is now in the **past** (system date 2026-09-04), and Spawn rejects past start dates. Reproduces in isolation, untouched by 3.5b (my change is additive: one new table + attendance files + one error-mapper arm). The service package is otherwise green (`go test -race -skip 'TestClassService_Spawn'` → ok). Flag for a separate date-bomb fix (move the hardcoded dates to a clock-relative `future` helper).

### Implementation Plan (summary)

1. Migration `20260903120000_create_attendance` (+ up/down roundtrip verified).
2. `queries/attendance.sql` → sqlc codegen (roster LEFT JOIN, UPSERT, read-back).
3. `api.yaml` additive (3 ops + `AttendanceStatus`/`AttendanceRosterEntry`/`AttendanceRoster`/`SetAttendanceRequest`/`BulkAttendanceRequest` + 2 envelopes) → codegen.
4. `AttendanceService` (in-service authz via `assertClassRole` + `assertSessionTeacherScope`; validate-all-before-write bulk).
5. `AttendanceHandler` + 3 routes on `sessionChain`; `story_3_5b_helpers.go` test server; `AttendanceNotEnrolledError` + mapper arm.
6. Turned ATDD reds green (tag removed) + added green happy-path envelope suite.
7. `AttendanceToggle` + `RosterTable` (domain).
8. `attendanceApi` hooks + `AttendanceSection`; mounted top-of-main; deleted placeholder; updated page test.
9. i18n flat keys en+vi (removed `.comingSoon`); parity test Story 3.5b block.
10. FE tests green (`tsc -b`, vitest, ESLint).
11. `deferred-work.md` FU-3-5-A resolved.

## File List

### Added
- `classlite-api/migrations/20260903120000_create_attendance.up.sql` — attendance table + RLS grid + UNIQUE + index.
- `classlite-api/migrations/20260903120000_create_attendance.down.sql` — drop table (reverses up).
- `classlite-api/internal/store/queries/attendance.sql` — roster read, UPSERT, single read-back.
- `classlite-api/internal/store/generated/attendance.sql.go` — sqlc output (generated).
- `classlite-api/internal/service/attendance_service.go` — roster/set/bulk + in-service authz.
- `classlite-api/internal/handler/attendance_handler.go` — 3 endpoints + envelope DTOs + status validation.
- `classlite-api/internal/handler/attendance_handler_green_test.go` — green happy-path envelope integration (TEST-BE-3).
- `classlite-api/internal/test/story_3_5b_helpers.go` — `NewAttendanceTestServerBareMux`.
- `classlite-web/src/components/domain/AttendanceToggle.tsx` — segmented Present/Late/Absent toggle.
- `classlite-web/src/components/domain/RosterTable.tsx` — participants + attendance rows (loud unmarked).
- `classlite-web/src/features/session-detail/api/attendanceApi.ts` — query + set + bulk hooks.
- `classlite-web/src/features/session-detail/components/AttendanceSection.tsx` — live section.

### Modified
- `classlite-api/api.yaml` — additive attendance ops + schemas.
- `classlite-api/internal/service/errors.go` — new `AttendanceNotEnrolledError`.
- `classlite-api/internal/middleware/error_mapper.go` — arm → 422 NOT_ENROLLED.
- `classlite-api/cmd/api/main.go` — wire `AttendanceService`/`AttendanceHandler` + 3 routes.
- `classlite-api/internal/test/attendance_rls_atdd_test.go` — build tag removed (green); header updated.
- `classlite-api/internal/handler/attendance_handler_atdd_test.go` — build tag removed (green); header updated.
- `classlite-web/src/lib/api/client.ts` — openapi-typescript output (generated).
- `classlite-web/src/features/schedule/api/sessionsKeys.ts` — `attendance(id)` key.
- `classlite-web/src/features/session-detail/SessionDetailPage.tsx` — mount `AttendanceSection` top-of-main; drop placeholder; docstring.
- `classlite-web/src/features/session-detail/__tests__/SessionDetailPage.test.tsx` — attendance MSW handler + live-section assertion.
- `classlite-web/src/locales/en.json` / `vi.json` — flat `session.attendance.*` keys (added; `.comingSoon` removed).
- `classlite-web/src/lib/test/__tests__/i18n-parity-coverage.test.ts` — Story 3.5b parity block; dropped `.comingSoon` from 3.5 list.
- `_bmad-output/implementation-artifacts/deferred-work.md` — FU-3-5-A resolved.
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — 3-5b → in-progress → review.

### Deleted
- `classlite-web/src/features/session-detail/components/AttendancePlaceholder.tsx` — replaced by the live `AttendanceSection` (sole importer was `SessionDetailPage`; confirmed no dangling refs).
