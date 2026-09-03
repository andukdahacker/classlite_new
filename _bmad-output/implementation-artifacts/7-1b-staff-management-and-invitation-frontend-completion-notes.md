# Story 7-1b: Completion Notes

_Implementation record for [`7-1b-staff-management-and-invitation-frontend.md`](./7-1b-staff-management-and-invitation-frontend.md). Status: review._

## Dev Agent Record

### Debug Log

- **ATDD scaffold was already red-first.** Murat's `atdd-checklist-7-1b-*` shipped 5 test files + `handlers.ts` (typed against the generated 7-1a wire shapes). Implementation was pure green — no test authored/edited by dev; the fixtures are the contract.
- **`onUnhandledRequest: 'error'` (vitest-setup) forced lazy class fetches.** The assign-class picker (`OwnerActionsCard`) and the teacher-only classId field (`InviteStaffModal`) each mount `useClasses` (→ `GET /api/classes`) ONLY when their panel/role is active, so the reset/force/archive flows and admin-invite path never hit an unmocked endpoint.
- **Duplicate "—" token (StaffDetailPage).** First green attempt rendered `lastActive` in both the 6-up stat strip and the Overview tab → `getByText(people.staff.lastActive.never)` matched 2 nodes. Fixed by swapping the strip's 6th box from last-active to a recent-activity count (the strip is dev-defined per Dev Notes; last-active stays in Overview per AC9). Added `people.staff.detail.stats.activity` (en+vi).
- **axe(document.body) vs base-ui Dialog focus guards.** jsdom reports `navigator.vendor` = "Apple Computer, Inc." → base-ui's `FocusGuard` renders Safari-only `role="button"` sentinels with no accessible name, which the mandated TEST-FE-5 `axe(document.body)` flags (`aria-command-name`). The shipped `AIGenerateDialog` axe test dodges this by scoping to the content node; this test scopes to `document.body`, so a portal Dialog cannot pass. Resolved by hand-rolling `InviteStaffModal` as a plain accessible modal (`role="dialog"` + `aria-modal` + `aria-labelledby` + Escape/backdrop close) — no portal, no guards. RHF + `zodResolver` logic is otherwise identical to the `ClassFormDialog` clone.
- **Lint folds:** `?invite=new` open-state moved from a setState-in-effect to a lazy `useState` initializer (the app-wide `react-hooks/set-state-in-effect` rule); `watch()` → `useWatch({control})` to clear the React-Compiler `incompatible-library` warning (matches `ClassFormDialog`).

### Completion Notes

- **All 22 ACs / 10 tasks satisfied.** 63/63 people tests green; full web suite 2938/2938 excluding one unrelated `WritingAttemptShell` parallelism flake (passes 20/20 in isolation, no overlap with this story's surface). `tsc -b` = 0; ESLint clean.
- **TEST-FE-6 (mandatory) proven:** an Admin's s40 renders read-only with NO `owner-actions` node in the DOM (gated in `StaffDetailPage`, not inside the card); a Teacher/Student is denied both `/people/*` routes with the new `people` section copy.
- **D16 contract co-finalized:** stripped the PROVISIONAL markers from the api.yaml staff block (banner + 5 summaries + schemas banner) and re-ran `codegen.sh`. The `client.ts` diff is comment-only (JSDoc summary text) — no field-shape drift, so no atomic backend commit needed (WF-4). No sqlc/Go output changed.
- **Deviations from the letter of the spec (both pragmatic, [[feedback_pragmatic_interpretation_of_spec_absolutes]]):**
  1. `InviteStaffModal` is a hand-rolled modal, not the shadcn/base-ui `Dialog` the "clone ClassFormDialog" guidance implies — the mandated `axe(document.body)` test is authoritative and a portal Dialog can't pass it in jsdom. Fully accessible; behavior (RHF + zodResolver, always-mounted, parent-controlled) matches the clone.
  2. s40 6-up stat strip's 6th box is a recent-activity count, not last-active (which lives in Overview) — the strip is explicitly "dev-defined default; may tune" in Dev Notes, and this keeps the null token unique. Flag to Sally/Ducdo if a different 6th metric is wanted.
- **`LoadMeter`** uses an inline `style={{ width }}` for the dynamic fill percentage — the one accepted escape from Tailwind-only, matching the shipped colored-tile precedent (`ClassesPage`/`ClassDetailLayout` set `style={{ backgroundColor }}`). Amber is driven solely by server `load.heavy` (no client threshold).
- **`RoleChipGroup`** follows the shipped `AiChipGroup` idiom (plain `aria-pressed` buttons, not base-ui ToggleGroup) — the repo's documented, testable chip pattern. D12 honored: Teacher/Admin only, no `owner` chip for any sender.
- **Reuse, not reinvention:** `apiFetch` (envelope unwrap + Bearer/401), `RouteRoleGate`/`useRole`, `ClassesPage` tabs+trilogy+countByStatus shape, `useClasses` (barrel), `sonner` toast convention, the `ClassesPage.test.tsx` singleton-session harness. No new backend, no second invite endpoint, no force-logout/reset infra, no `ClassStatusPill` retrofit, no loader introduced.

### Implementation Plan (as executed)

1. peopleKeys extension + `SectionNameKey` `people` union (Task 1/2 groundwork).
2. Domain components: `LoadMeter`, `StatusPill` (shadcn Badge), `RoleChipGroup` (Task 3).
3. people/lib: `useStaffSession`/`useStaffCenterId` (singleton reader), `formatStaffDateTime`, `inviteSchema` (Task 2/7 support).
4. Hooks: `useStaff` (roster + detail queries), `useStaffActions` (invite + 4 owner-action mutations) (Task 2).
5. `OwnerActionsCard` with lazily-mounted assign picker (Task 6).
6. `InviteStaffModal` (Task 7).
7. `StaffListPage` (Task 4), `StaffDetailPage` (Task 5).
8. Route wiring in `routes.tsx` (Task 1).
9. i18n en+vi (105 + 1 keys, parity 1948/1948) (Task 8).
10. Green the suite, lint/typecheck folds (Task 9).
11. D16: strip PROVISIONAL markers + `codegen.sh` + verify comment-only diff (Task 10).

## File List

### Added

- `classlite-web/src/components/domain/LoadMeter.tsx` — teaching-load bar (server-owned amber).
- `classlite-web/src/components/domain/StatusPill.tsx` — composable tone pill (shadcn Badge).
- `classlite-web/src/components/domain/RoleChipGroup.tsx` — Teacher/Admin segmented chips.
- `classlite-web/src/features/people/lib/useStaffSession.ts` — singleton session/centerId reader.
- `classlite-web/src/features/people/lib/formatStaffDate.ts` — i18n date-time formatter (TS-6).
- `classlite-web/src/features/people/lib/inviteSchema.ts` — RHF/zod invite schema.
- `classlite-web/src/features/people/api/useStaff.ts` — roster + detail queries.
- `classlite-web/src/features/people/api/useStaffActions.ts` — invite + 4 owner-action mutations.
- `classlite-web/src/features/people/components/OwnerActionsCard.tsx` — owner-only actions + confirm surfaces.
- `classlite-web/src/features/people/components/InviteStaffModal.tsx` — s41 invite modal.
- `classlite-web/src/features/people/StaffListPage.tsx` — s39 roster list.
- `classlite-web/src/features/people/StaffDetailPage.tsx` — s40 tabbed detail.
- `_bmad-output/implementation-artifacts/7-1b-staff-management-and-invitation-frontend-completion-notes.md` — this file.

### Modified

- `classlite-web/src/features/people/api/peopleKeys.ts` — added staffList/staffDetail + 5 mutation slots.
- `classlite-web/src/components/shared/PermissionDenied.tsx` — `people` added to `SectionNameKey`.
- `classlite-web/src/routes.tsx` — `/people/staff` + `/people/staff/:userId` gated block (deep-imported).
- `classlite-web/src/locales/en.json` / `vi.json` — 106 `people.staff.*` / `people.invite.*` / section keys each (parity held).
- `classlite-api/api.yaml` — D16: PROVISIONAL markers stripped from the staff block (banner + summaries).
- `classlite-web/src/lib/api/client.ts` — regenerated (comment-only diff from the marker strip).

### Deleted

- None.

## Pre-existing files consumed as the test contract (authored by Murat's ATDD, not dev)

- `classlite-web/src/features/people/api/__tests__/handlers.ts`
- `classlite-web/src/features/people/__tests__/{StaffListPage,StaffDetailPage,StaffRoutesGate}.test.tsx`
- `classlite-web/src/features/people/components/__tests__/{InviteStaffModal,OwnerActionsCard}.test.tsx`
