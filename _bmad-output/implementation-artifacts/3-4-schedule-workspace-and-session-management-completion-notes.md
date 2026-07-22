# Story 3-4: Completion Notes

_Implementation record for [`3-4-schedule-workspace-and-session-management.md`](./3-4-schedule-workspace-and-session-management.md). Status: review._

## Dev Agent Record

### Agent Model Used
claude-opus-4-8[1m] (Amelia / bmad-dev-story)

### Debug Log
- **RLS test fixture (`::timestamptz` cast).** Once Task 1 created the table, `sessions_rls_test.go` / `session_handler_atdd_test.go` fixtures failed `42P08` (`$4` used both as `starts_at` and in `$4 + interval`). Added `$4::timestamptz` casts in the two raw-SQL fixture INSERTs (assertion logic untouched — a mechanical fixture fix).
- **DELETE optimistic stamp via query param.** The delete ATDD test passes `expectedUpdatedAt` in the query string; its `+07:00` offset decodes to a space (`+`→space in query params). RFC3339 has no spaces, so the handler normalizes space→`+` before parsing.
- **Cross-package DB deadlock (pre-existing, flake).** `go test ./...` intermittently deadlocks (`40P01`) on the shared dev DB when `internal/service` login tests and the new `sessions_rls_test.go` race on the deterministic tenant IDs (`…001/…002`) — the same fixed-ID pattern `classes_rls_test.go` already uses (13×). Passes on isolated/retry runs. Raise at review; not a 3.4 logic defect.
- **Stale-LSP `client.ts` footgun.** After `codegen.sh`, the editor LSP reported spurious "Cannot find module @/…" / "React UMD global" / "implicitly any" on unchanged UI files. `tsc -b` is clean (exit 0) — the story's documented footgun; trusted CLI `tsc`.
- **Pre-existing FE test failure.** `src/features/settings/__tests__/RoomsTab.test.tsx` "capacity outside 1..500" fails on branch HEAD with my changes reverted (confirmed via `git stash` of the locale files) — a Story 2-5b flake, unrelated to 3.4.

### Completion Notes
- **Backend gate (Tasks 1–6) shipped green FIRST** per the binding ordering guard, before any UI. Full R19 scope matrix (J19-001/002+005/003/004), cross-teacher-404 + LIST-absent, student-403, recurrence bound/cap, range-cap, series-counts — all green through the real middleware/service with a frozen `MockClock`.
- **Past-immutable mutations** enforced in SQL: every `…InScope` mutation ANDs `starts_at >= @now_floor`; the service pre-rejects a past `this` target (422) and re-reads `updated_at` for the optimistic 409.
- **Recurrence** materializes on create (required endDate + 200 cap, one-past-cap overflow detection reporting the furthest reachable date); `recurrence_tz` stamped from the app zone.
- **Frontend**: hand-rolled Day/Week/Month calendar (no new runtime dep; date-fns v4 is the ONE named date utility), SR hidden linear list, keyboard-first "New session", mobile single-day agenda tree, trilogy choreography (empty overlay ≠ error scrim), SessionModal + safe-default counted date-anchored RecurrenceScopeConfirm. `/my-schedule` truthful stub. Sessions tab lit.
- **Deviations (documented):** (1) modal date field is a native `<input type=date>` (accessible + testable) — the shadcn calendar drives the mini-month; (2) week/day overlap is width-split (no lane-packing) per the v1 scope; "+K more" is on month cells.
- **Not done locally:** Playwright e2e (needs a browser/dev server) — the `route-bundle-boundaries` additions were verified manually against the real `dist/` (SchedulePage chunk carries `schedule-workspace`; MySchedulePage + dashboards do not leak it).

### Implementation Plan (summary)
1. Migration + RLS grid (Task 1) → red RLS tests green.
2. sqlc queries (Task 2) → api.yaml (Task 3) → `codegen.sh` (Task 4).
3. Service (`session.go`/`session_crud.go`/`recurrence.go`) + handler + test harness + routing + 3 new 422 typed errors (Task 5) → R19 handler matrix green.
4. recurrence unit table + full backend regression (Task 6) → backend gate PASSED.
5. FE data layer (Task 7) → workspace + modal (Task 8) → my-schedule stub (Task 9) → lit Sessions tab (Task 10) → i18n + parity (Task 11) → FE tests + a11y + bundle + full regression (Task 12).

## File List

### Added
**Backend**
- `classlite-api/migrations/20260721120000_create_sessions.up.sql` / `.down.sql` — sessions table + 4-policy RLS + coupling CHECKs + indexes.
- `classlite-api/internal/store/queries/sessions.sql` — session queries (create/list/get/series-counts/scoped mutations).
- `classlite-api/internal/store/generated/sessions.sql.go` — sqlc output (generated; read-only).
- `classlite-api/internal/service/session.go` — SessionService + tx/authz/optimistic/scope helpers.
- `classlite-api/internal/service/session_crud.go` — List/Get/Create/Update/Cancel/Delete + validation.
- `classlite-api/internal/service/recurrence.go` — pure occurrence generator.
- `classlite-api/internal/service/recurrence_test.go` — recurrence unit table.
- `classlite-api/internal/handler/session_handler.go` — 6 endpoints + DTOs + converters.
- `classlite-api/internal/test/story_3_4_helpers.go` — `NewSessionTestServerBareMux`.

**Frontend**
- `classlite-web/src/features/schedule/` — `SchedulePage.tsx`, `MySchedulePage.tsx`, `index.ts`; `api/{sessionsKeys,useSessions,useSessionMutations}.ts`; `lib/{scheduleDates,formatSessionTime,useSessionSchema}.ts`; `components/{ScheduleWorkspace,CalendarGrid,SessionBlock,ScheduleToolbar,CalendarLegend,MiniMonthNavigator,SessionModal,RecurrenceScopeConfirm}.tsx`.
- `classlite-web/src/features/schedule/__tests__/{ScheduleWorkspace,schedule.a11y}.test.tsx` (+ the Task-0 `SchedulePage`/`MySchedulePage` tests, now green).
- `classlite-web/src/features/classes/tabs/__tests__/SessionsTab.test.tsx` — lit-tab three-state.

### Modified
- `classlite-api/api.yaml` — sessions paths + schemas (additive).
- `classlite-api/internal/service/errors.go` — 3 new 422 typed errors.
- `classlite-api/internal/middleware/error_mapper.go` — arms for the 3 new codes.
- `classlite-api/cmd/api/main.go` — `sessionChain` + 6 routes.
- `classlite-api/internal/test/sessions_rls_test.go`, `internal/handler/session_handler_atdd_test.go` — `::timestamptz` fixture cast (assertions unchanged).
- `classlite-web/src/lib/api/client.ts` — regenerated (additive, 598 lines).
- `classlite-web/src/components/shared/PermissionDenied.tsx` — `SectionNameKey += 'schedule'`.
- `classlite-web/src/routes.tsx` — `/schedule` + `/my-schedule` routes.
- `classlite-web/src/features/classes/tabs/SessionsTab.tsx` — lit (per-class list).
- `classlite-web/src/features/classes/ClassDetailLayout.tsx` — Sessions tab no longer `comingSoonKey`.
- `classlite-web/src/features/classes/__tests__/ClassDetailLayout.test.tsx` — reconciled (Sessions lit).
- `classlite-web/src/locales/en.json` / `vi.json` — schedule/mySchedule/sessions keys (parity, 996 each).
- `classlite-web/src/lib/test/__tests__/i18n-parity-coverage.test.ts` — `STORY_3_4_KEYS` block.
- `classlite-web/e2e/route-bundle-boundaries.spec.ts` — SchedulePage/MySchedulePage chunk isolation.

### Deleted
_None._

## Open items to raise at code review
- Pre-existing cross-package DB deadlock flake on shared fixed tenant IDs (test-infra; predates 3.4).
- Pre-existing `RoomsTab.test.tsx` capacity-range failure on branch HEAD (Story 2-5b; unrelated).
- Playwright e2e not executed locally (bundle assertions verified against `dist/`).
- Overlap = width-split (no lane-packing); modal date = native input (shadcn calendar on mini-month) — both v1 scope decisions.
