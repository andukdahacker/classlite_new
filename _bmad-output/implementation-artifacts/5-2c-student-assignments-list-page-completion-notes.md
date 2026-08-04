# Story 5-2c: Completion Notes

_Implementation record for [`5-2c-student-assignments-list-page.md`](./5-2c-student-assignments-list-page.md). Status: review._

## Dev Agent Record

### Debug Log

- **Pre-flight (Task 0) clean.** `client.ts` already exports `listStudentAssignments` (op) + `StudentAssignmentListItem` / `EnvelopeStudentAssignmentList` / `ExerciseSkill` / `SubmissionStatus` (5.2a). Nav entry present at `sidebarNavConfig.tsx:99`. No codegen touched.
- **`t('date',{val})` formatter does not exist.** The story AC2/Dev-Notes reference `t('date',{val})` (the TS-6 example), but no such i18next formatter is registered in `src/lib/i18n.ts`. The shipped codebase formats dates via a feature-local `formatExerciseDate(iso, locale)` util. Followed the actual precedent (`[[feedback_check_prior_story_artifacts_before_generating]]`): added a feature-local `formatAssignmentDate.ts` (TS-7 forbids importing the exercises copy; a shared formatter is tracked tech-debt FU-3-2-x). Still TS-6-compliant — local-midnight `Intl.DateTimeFormat`, never `new Date(iso)` UTC parse in a render path.
- **shadcn `Button` has no `asChild`.** This repo's `Button` wraps `@base-ui/react/button` with no Radix `Slot`/`asChild`. For the actionable CTA I styled the `react-router` `<Link>` directly with the exported `buttonVariants({size,variant})` instead of `<Button asChild>`; the disabled "Available soon" stays a real `<Button disabled>`.
- **`i18n-parity` was RED on baseline.** `npm run i18n-parity` failed on `f513208` (before my change) with an orphan `sidebar.owner.exercises` — introduced by the earlier owner-nav fix `f654fa5` and never registered in the coverage array. Confirmed pre-existing via a locale-only `git stash`. Applied the fix the error message prescribes: registered `sidebar.owner.exercises` in `STORY_1D_3_KEYS`. Gate now green (1457 keys). My `assignments.*` keys were symmetric from the first run.
- **MSW handler placement.** Dev Notes suggested adding a `listStudentAssignments` handler to the default `handlers.ts`; the canonical `ExerciseLibraryPage` precedent instead uses a **per-test `listHandler` factory** via `server.use(...)` (better isolation, default array stays auth-only). Followed the precedent.

### Completion Notes

- **All 7 ACs + 6 tasks delivered. Frontend-only** over the shipped `GET /api/assignments` (5.2a) — no `api.yaml`, no `client.ts`, no codegen, no backend, `sidebarNavConfig` untouched.
- **New feature `src/features/assignments/`**: paginated read hook (`useStudentAssignments` via `apiFetchWithMeta`, captures `pagination` + `serverTime`), TS-3 key factory, pure row-model (`attemptRouteForSkill` / `rowStatus` / `isOverdue`), `AssignmentsListPage` (inside AppLayout, L/E/E trilogy, pagination) + `AssignmentRow`, TS-7 barrel.
- **Route** `/assignments` wired lazy under the AppLayout pathless route (sibling to `/my-schedule`), `RouteRoleGate allowedRoles={['student']} sectionNameKey="assignments"`. `SectionNameKey` closed union (Story 2.6) extended with `'assignments'` + en/vi `app.permissionDenied.section.assignments.header`.
- **CTA matrix (AC4):** `null`→Start, `in_progress`→Continue (both → 5.2b `/assignments/:id/attempt`), `submitted`/`ai_processing`→read-only View, `graded`→badge only (result deferred to 5.5, D3). writing/speaking/general skills (no attempt UI yet) → disabled "Available soon" (D2; `attemptRouteForSkill` returns `null` — the seam 5.3/5.4 extend). `general` grouped with the not-yet-built set (not named in AC4's quiz set).
- **Overdue (AC5):** non-blocking marker when deadline strictly past AND `submissionStatus ∈ {null, in_progress}`, using `serverTime` from the list envelope as the reference clock; `latePenalty > 0` swaps to the penalty-hint copy.
- **35 `assignments.*` i18n keys** (both locales, VN-checked). VN "Bài tập" reuses the shipped `sidebar.student.assignments` label (students never see the staff exercises library, so no collision in-surface).
- **Tests: 44 new, all green** — 20 pure row-model (RED-first, authored + failing before impl) + 24 page (three-state + empty, role-negative teacher/owner→403 list-absent, full CTA×status×skill matrix incl. "Available soon", overdue incl. penalty, pagination slice, deadline i18n in en+vi, axe on loaded + empty, keyboard-reachable title-specific accessible name).
- **Gates:** `tsc --noEmit -p tsconfig.app.json` clean · `eslint` clean · `npm run i18n-parity` OK (1457 keys) · full `vitest` **143 files / 2119 tests passed, 0 regressions**.
- **Deferred (in scope of later stories):** attempt screens (5.2b/5.3/5.4), graded result view `/assignments/:id/result` (5.5), client-side filter/search. **Release-bound to 5-2b** (D1) — ships together.

### Implementation Plan (summary)

1. Recon + pre-flight (Task 0): verified 5.2a contract exports + nav entry; read the exercises/list, RouteRoleGate, api-fetch, i18n precedents.
2. Task 1 — `assignmentKeys.ts` + `useStudentAssignments.ts` (`apiFetchWithMeta`, staleTime, `keepPreviousData`).
3. Task 2 — RED: `assignmentRow.test.ts` (20 cases) → confirmed failing → GREEN: `assignmentRow.ts`.
4. Task 3 — `formatAssignmentDate.ts`, `AssignmentRow.tsx`, `AssignmentsListPage.tsx`, `index.ts` barrel.
5. Task 4 — `SectionNameKey` union `'assignments'`; `/assignments` route under AppLayout.
6. Task 5 — 35 en/vi keys + section header; `AssignmentsListPage.test.tsx` (24 cases); parity orphan fix; all gates.

## File List

### Added

- `classlite-web/src/features/assignments/api/assignmentKeys.ts` — TS-3 query-key factory (page/pageSize).
- `classlite-web/src/features/assignments/api/useStudentAssignments.ts` — paginated read hook (`apiFetchWithMeta`).
- `classlite-web/src/features/assignments/lib/assignmentRow.ts` — pure row-model (`attemptRouteForSkill`/`rowStatus`/`isOverdue`).
- `classlite-web/src/features/assignments/lib/formatAssignmentDate.ts` — feature-local TS-6 deadline formatter.
- `classlite-web/src/features/assignments/lib/__tests__/assignmentRow.test.ts` — 20 pure unit tests (RED-first).
- `classlite-web/src/features/assignments/AssignmentRow.tsx` — one list row (title/skill/deadline/status/overdue/CTA).
- `classlite-web/src/features/assignments/AssignmentsListPage.tsx` — the `/assignments` page (L/E/E + pagination).
- `classlite-web/src/features/assignments/index.ts` — feature barrel (TS-7).
- `classlite-web/src/features/assignments/__tests__/AssignmentsListPage.test.tsx` — 24 page component tests.
- `_bmad-output/implementation-artifacts/5-2c-student-assignments-list-page-completion-notes.md` — this file.

### Modified

- `classlite-web/src/routes.tsx` — added the lazy student-gated `/assignments` child under AppLayout.
- `classlite-web/src/components/shared/PermissionDenied.tsx` — `SectionNameKey` union += `'assignments'`.
- `classlite-web/src/locales/en.json` — +35 `assignments.*` keys + `app.permissionDenied.section.assignments.header`.
- `classlite-web/src/locales/vi.json` — same keys (Vietnamese), VN-length-checked.
- `classlite-web/src/lib/test/__tests__/i18n-parity-coverage.test.ts` — registered pre-existing orphan `sidebar.owner.exercises` to unblock the parity gate.
- `_bmad-output/implementation-artifacts/5-2c-student-assignments-list-page.md` — task/DoD checkboxes, Status→review, `baseline_commit`, Change Log.
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — `5-2c` `ready-for-dev → in-progress → review`.

### Deleted

- None.
