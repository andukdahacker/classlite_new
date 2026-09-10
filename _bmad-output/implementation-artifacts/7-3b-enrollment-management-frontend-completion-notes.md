# Story 7-3b: Completion Notes

_Implementation record for [`7-3b-enrollment-management-frontend.md`](./7-3b-enrollment-management-frontend.md). Status: review._

## Dev Agent Record

### Debug Log

- **Fixture gap (composer target picker):** the shipped `classesHandlers` (Story 3.1) serves `cls-a`/`cls-b`, but `EnrolmentComposer.test.tsx` picks `IELTS Writing 6.5` (`cls-1`, the class on `studentHandlers`' `enrolledClasses`). The composer's target picker sources from `useClasses` (D9), so with `classesHandlers` the picked class never exists → the option query would throw. Root-cause fix: added `enrolmentClassesHandlers` (an enrolment-canonical GET `/api/classes` returning `cls-1 "IELTS Writing 6.5"` + `cls-2 "IELTS Reading R60"`) to `enrolmentHandlers.ts` and pointed the composer test's `beforeEach` at it. This keeps the production target picker honest (center classes only) and fixes the fixture at its root; the test's assertions/seams are unchanged. Chosen over unioning the student's `enrolledClasses` into the picker (which would ship subtly-wrong production behavior to paper over a test fixture).
- **cmdk vs hand-rolled combobox (D9):** used the D9-sanctioned fallback — a hand-rolled `role="listbox"` + text-filter (the `AssignClassPanel` idiom) rather than the cmdk `Command`. cmdk under jsdom + base-ui Popover portals is fiddly for deterministic option-click tests and axe; the fallback is proven, a11y-clean, and satisfies every seam (`enrolment-student-combobox` → `role="option"` by name). Documented deviation; cmdk stays available for a later polish pass.
- **ToggleGroup vs segmented buttons (D6):** the base-ui `ToggleGroup` is array-valued and its item disabled-state is awkward to assert. Used the shipped `aria-pressed` segmented-button idiom (`RoleChipGroup`/`AiChipGroup`, whose header explicitly earmarks it "for s44 enrollment") — a pragmatic read of D6 that keeps the `enrolment-action-*` disabled/testid seams trivially assertable.
- **Zod discriminated union → flat superRefine (D6):** a `z.discriminatedUnion('action', …)` `z.infer` yields a UNION form type that breaks `tsc --strict` `Control<Union>` field access (`toClassId` absent on withdraw). Kept ONE flat object schema with an `action`-keyed `.superRefine` (the shipped `useSessionSchema` idiom) — the same action-discriminated validation contract, one clean `z.infer` for RHF.
- **`watch()` → `useWatch` (React Compiler):** the initial composer used RHF `watch()` and tripped `react-hooks/incompatible-library` (React Compiler can't memoize the returned fn). Switched to `useWatch({ control, name })` — the shipped convention (`SessionModal`/`ClassFormDialog`/`InviteStaffModal`). ESLint clean after.
- **i18n parity was ALREADY RED on the branch:** `sidebar.owner.students`/`sidebar.admin.students` shipped in 7-2b but were never claimed in `i18n-parity-coverage.test.ts` (a covered namespace), so `npm run i18n-parity` failed with 2 orphans on the baseline. Reconciled both (claimed in `STORY_1D_3_KEYS`, the 1D-owned sidebar block) alongside the two new `sidebar.{owner,admin}.enrolment` keys → parity green (2135 keys, 1065 claimed).

### Completion Notes

- **All 8 tasks / 16 ACs implemented; the 5 ATDD red scaffolds (41 cases) are green with no rewrite of assertions or seams** (only the one documented composer fixture-wiring correction above).
- **D13 honored — pure frontend consumer:** ZERO changes to `api.yaml`, `scripts/codegen.sh`, `src/lib/api/client.ts`, or any Go. Every enrollment shape consumed verbatim from the generated `components['schemas']` (drift-guarded by `enrolmentHandlers.ts`).
- **Route + gate + nav (AC1/2):** widened `SectionNameKey` to add `'enrolment'` (the ATDD-surfaced TS2322 driver); cloned the `/people/students` block for `/people/enrolment` (single `index` child, deep-imported `EnrolmentPage`, `allowedRoles`/`requiredRolesForCopy` `['owner','admin']`); added `ArrowLeftRight` sidebar items to `OWNER_GROUPS`/`ADMIN_GROUPS`; new `app.permissionDenied.section.enrolment.header` (en+vi).
- **Compose row (AC3-7):** RHF + `zodResolver` over the flat action-discriminated schema; hand-rolled searchable student combobox; segmented Add/Transfer/Withdraw; target/source class listboxes over `useClasses`+`isAssignableClass`; source-class resolution off `StudentListItem.enrolledClasses` (0→disable Transfer/Withdraw + hint; 1→auto read-only; >1→picker); `<input type="date">` default+max today; self-transfer blocked client-side; every 7-3a error code mapped to an i18n toast; success invalidates + resets, error keeps the form.
- **Needs-attention (AC8-10):** two color-coded, independently-paginated zones (amber unassigned with an "Add" prefill callback / red over-capacity `activeCount/capacity`, informational only); per-zone trilogy.
- **History (AC11-13):** raw `<table>`, newest-first, action `Badge` pills, `performerName ?? "System"`, `"—"` nulls, `meta.pagination` pager, server-side clearable class + student filters; trilogy.
- **Page (AC1/3/8/11):** `EnrolmentPage` composes the three composites top-to-bottom with an "N need attention" superscript and owns the AC9 prefill (student id + bumping nonce → composer selects in Add mode).
- **Deferrals:** filed **FU-7-3-B** (server-side student search param for the combobox, P2) in `deferred-work.md`. FU-7-3-A (inbox → Epic 10) stays as filed by 7-3a.
- **Reconciled pre-existing branch debt:** claimed the two orphan `sidebar.{owner,admin}.students` keys (7-2b) in the i18n coverage gate so `i18n-parity` is green again.

### Implementation Plan (as executed)

1. Recon: read the 5 ATDD scaffolds (contract) + every reference (routes/nav/gate/hooks/pickers/api-fetch/query-client/generated types/primitives/i18n).
2. Task 1 — `SectionNameKey` widen, `/people/enrolment` route, sidebar items.
3. Task 2 — `peopleKeys` slots + param interfaces; `useEnrolment.ts` (history/attention reads); `useEnrolmentActions.ts` (action mutation).
4. Task 3 — `enrolmentSchema.ts`; `EnrolmentComposer.tsx`; the `enrolmentClassesHandlers` fixture + composer-test wiring.
5. Task 4 — `NeedsAttentionList.tsx`.
6. Task 5 — `formatEnrolmentDate.ts`; `EnrolmentHistoryTable.tsx` (filter as a listbox-of-options so clicking option[0] issues the server `?class_id`).
7. Task 6 — `EnrolmentPage.tsx` (compose + prefill wiring + count superscript).
8. Task 7 — all `people.enrolment.*` + sidebar + section keys in en+vi; claimed sidebar keys in the coverage gate; `i18n-parity` green.
9. Task 8 — `useWatch` refactor for ESLint; `tsc -b`=0; enrolment tests 41/41; full web suite 3065/3065; FU-7-3-B filed.

### Gate results

- `npx tsc -b` → **0 errors**.
- `npm run i18n-parity` → **OK, 2135 keys** in both locales, namespace coverage clean.
- Enrolment tests → **41 passed** (EnrolmentComposer 14 · NeedsAttentionList 10 · EnrolmentHistoryTable 8 · EnrolmentRoutesGate 9).
- Full web suite → **226 files / 3065 tests passed (0 regressions)**.
- ESLint on all 7-3b-touched files → **clean**. `eslint .` reports 5 pre-existing errors (intentional `_`-prefixed no-op params in the `describe.skip` `e2e/bulk-student-import.spec.ts`, Story 2.7 FU-2-5-N infra pending) + 2 pre-existing `watch()` warnings in `exercises/AIGenerateDialog.tsx` — all committed-at-HEAD, unmodified by this story, unrelated to enrolment.
- Backend/codegen/Go: **untouched** (D13).

## File List

### Added

- `classlite-web/src/features/people/EnrolmentPage.tsx` — the s43 page (compose → attention → history + AC9 prefill wiring).
- `classlite-web/src/features/people/components/EnrolmentComposer.tsx` — RHF compose row + student combobox + class pickers + source-class resolution + error mapping.
- `classlite-web/src/features/people/components/NeedsAttentionList.tsx` — two-zone needs-attention list.
- `classlite-web/src/features/people/components/EnrolmentHistoryTable.tsx` — immutable history table + server-side filters.
- `classlite-web/src/features/people/api/useEnrolment.ts` — `useEnrolmentHistory` / `useNeedsAttention` reads.
- `classlite-web/src/features/people/api/useEnrolmentActions.ts` — `useEnrolmentAction` mutation.
- `classlite-web/src/features/people/lib/enrolmentSchema.ts` — `useEnrolmentSchema` (action-discriminated) + `todayIsoDate`.
- `classlite-web/src/features/people/lib/formatEnrolmentDate.ts` — date-only + timestamp i18n formatters (TS-6).
- `_bmad-output/implementation-artifacts/7-3b-enrollment-management-frontend-completion-notes.md` — this file.

### Modified

- `classlite-web/src/routes.tsx` — new `/people/enrolment` route block (owner/admin gate, deep-imported page chunk).
- `classlite-web/src/components/domain/sidebarNavConfig.tsx` — `ArrowLeftRight` import + `sidebar.{owner,admin}.enrolment` items.
- `classlite-web/src/components/shared/PermissionDenied.tsx` — `SectionNameKey` += `'enrolment'`.
- `classlite-web/src/features/people/api/peopleKeys.ts` — enrolment history/attention/mutation key slots + `EnrolmentHistoryParams`/`NeedsAttentionParams`.
- `classlite-web/src/locales/en.json` — `people.enrolment.*` + sidebar + section-header keys.
- `classlite-web/src/locales/vi.json` — Vietnamese twins (identical interpolation tokens).
- `classlite-web/src/features/people/api/__tests__/enrolmentHandlers.ts` — added `enrolmentClassesHandlers` (enrolment-canonical GET `/api/classes`).
- `classlite-web/src/features/people/components/__tests__/EnrolmentComposer.test.tsx` — fixture wiring: `classesHandlers` → `enrolmentClassesHandlers` (documented green-phase correction).
- `classlite-web/src/lib/test/__tests__/i18n-parity-coverage.test.ts` — claimed `sidebar.{owner,admin}.enrolment` + reconciled the pre-existing `sidebar.{owner,admin}.students` orphans (7-2b).
- `_bmad-output/implementation-artifacts/deferred-work.md` — filed FU-7-3-B.
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — 7-3b status transitions.
- `_bmad-output/implementation-artifacts/7-3b-enrollment-management-frontend.md` — task checkboxes, Change Log, Status.

### Deleted

- none.
