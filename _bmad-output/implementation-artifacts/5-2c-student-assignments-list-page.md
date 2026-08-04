# Story 5.2c: Student Assignments List Page

Status: done

---
baseline_commit: f513208f6f3cf7bd0ae083e6ab8d540ee64d8abf
epic: 5
story: 5.2c
size: S
audience: Frontend
depends_on: [5.2a, 5.2b, 1.7b, 1.7c]
realizes_fr: [FR-27]   # the student-facing surface of the assignment list (read side shipped in 5.2a); the entry point into the attempt UIs
release_bound_to: 5-2b   # the entry point for 5-2b (and later 5.3/5.4) — the two release together; neither ships to prod alone (D1)
risk_score: 3   # low: read-only paginated list over a shipped endpoint, inside AppLayout, student-gated. No timer/autosave/finalizer. Standard three-state + role-negative coverage; no ATDD-mandatory gate.
---

<!-- Validation is optional. Run validate-create-story for a quality check before dev-story. -->
<!-- Split out of 5-2b at party-mode (Ducdo 2026-08-04): 5-2b is the attempt screen (s33); this is the student /assignments LIST landing that lets a student SEE and OPEN their assignments. Backend read API (GET /api/assignments) shipped in 5.2a — frontend-only, no codegen. The student /assignments sidebar nav entry ALREADY EXISTS (sidebarNavConfig.tsx:99); this story wires the route it points to. -->

## Story

As a **student**,
I want to **see the assignments set for my enrolled classes — each with its exercise, skill, deadline, and my current status — and open one to start, resume, or view it**,
so that **I have a real in-app entry point to my quiz/writing/speaking attempts instead of a dead nav link**.

**Scope:** Frontend only. Wires the student **`/assignments`** list page (the nav entry at `sidebarNavConfig.tsx:99` already reserves the slot; the route currently 404s). Consumes the **already-shipped** `GET /api/assignments` (student, enrollment-scoped, paginated — 5.2a). Each row deep-links to the matching attempt route by `exerciseSkill` — quiz (`/assignments/:id/attempt`, 5.2b) is wired; writing (5.3) / speaking (5.4) routes are not built yet and degrade gracefully. **This story is release-bound to 5-2b** (they are the entry + the destination — neither ships to prod alone). **No backend change, no schema, no codegen** — `listStudentAssignments` + `StudentAssignmentListItem` already exist in `src/lib/api/client.ts`. The graded result view (5.5) is separate.

## Acceptance Criteria

1. **Route + gate.** Given a `student`, When they visit `/assignments`, Then the list page renders **inside `AppLayout`** (sidebar/topbar — this is a nav landing, NOT the full-bleed attempt shell), lazy-loaded, gated `['student']` via `RouteRoleGate` (precedent: the `/my-schedule` block, `routes.tsx:639`). A non-student caller hits the role gate (403 copy), never the list.
2. **List loads, server order.** Given the page mounts, When `GET /api/assignments?page&pageSize` resolves, Then rows render in the server order (`deadline_at ASC`, due-soonest first — do not re-sort client-side, XL-2). Each row shows: `exerciseTitle`, a `exerciseSkill` badge, the deadline (via the i18n date formatter — `t('date',{val:deadlineAt})`, never `new Date()`, TS-6), and a status derived from `submissionStatus` (AC4).
3. **Pagination.** Given `total > pageSize`, When the student pages, Then pagination controls read `page`/`pageSize` from the `PaginationMeta` (echoed/normalized by 5.2a) and refetch. Default `pageSize` = 20 (5.2a). Reuse the existing list pagination pattern (`ExerciseLibraryPage`).
4. **Row status + CTA by submissionStatus × skill.** Given a row, Then its status + primary action derive from `submissionStatus` and `exerciseSkill`:
   - `null` (not started) → **"Start"** → links to the skill's attempt route.
   - `in_progress` → **"Continue"** → same attempt route (5.2b resumes via the two-call bootstrap).
   - `submitted` / `ai_processing` → **"Submitted"** status; opens the attempt route **read-only** (5.2b AC15/AC23) — no re-edit.
   - `graded` → **"Graded"** badge; the result view is Story 5.5 — the result link is **deferred** (badge only, non-actionable for now).
   A pure `attemptRouteForSkill(skill, assignmentId)` helper maps `reading|listening|vocabulary|grammar` → `/assignments/:id/attempt` (5.2b); `writing` → the 5.3 route, `speaking` → the 5.4 route. **Skills whose attempt UI is not built yet (writing/speaking) render a disabled "Available soon" CTA** (not a 404 link) until 5.3/5.4 ship.
5. **Overdue affordance.** Given a row whose `deadlineAt` has passed and `submissionStatus ∈ {null, in_progress}`, Then it shows a non-blocking **overdue** marker; if `latePenalty > 0`, the marker communicates a late penalty applies (the item carries `latePenalty` for exactly this — 5.2a AC7). No hard-deadline logic here (that's the attempt screen).
6. **Loading / Empty / Error trilogy (UX-1).** Loading = list-shaped **skeleton** rows (not a spinner). Empty (no assignments) = a student-tone empty state (icon + encouraging headline, e.g. "No assignments yet — you're all caught up"), **never** "No data found". Error = inline human message + one retry action; all copy via i18n, no raw HTTP codes.
7. **i18n + a11y.** All strings are `assignments.*` keys in **both** `en.json` and `vi.json` (UX-2, `assertI18nParity`), VN-length-checked. `axe` clean on loading/data/empty/error; rows are keyboard-reachable and the status/CTA is announced (semantic list + accessible names). The existing `sidebar.student.assignments` nav label is reused (already present).

## Tasks / Subtasks

- [x] **Task 0 — Pre-flight (mandatory, `[[feedback_check_prior_story_artifacts_before_generating]]`).** Confirm `src/lib/api/client.ts` exports `operations['listStudentAssignments']` + `components['schemas']['StudentAssignmentListItem'|'EnvelopeStudentAssignmentList'|'ExerciseSkill'|'SubmissionStatus']` (shipped by 5.2a). Confirm `sidebarNavConfig.tsx:99` already has the student `/assignments` entry (do NOT duplicate it). **No `api.yaml`/codegen.**
- [x] **Task 1 — API layer (AC2,3).** `src/features/assignments/api/`: `assignmentKeys.ts` (TS-3 factory: `list(page,pageSize)`), `useStudentAssignments.ts` — GET `listStudentAssignments` via **`apiFetchWithMeta`** to capture `PaginationMeta` (page/pageSize/total/totalPages); explicit `staleTime` (FW-3); envelope unwrap (TS-4); never mock Query in tests (TEST-FE-1). Mirror the `exercises/api/useExercises.ts` paginated-list precedent.
- [x] **Task 2 — Row model (AC4,5; pure, RED-first).** `src/features/assignments/lib/assignmentRow.ts`: `attemptRouteForSkill(skill, id) → string | null` (null = not-yet-built → "Available soon"), `rowStatus(submissionStatus) → {labelKey, cta}`, `isOverdue(deadlineAt, submissionStatus, serverTime?)`. Unit tests first — every `submissionStatus` × representative skills + overdue boundary.
- [x] **Task 3 — Page + row component (AC1,2,4,5,6).** `src/features/assignments/AssignmentsListPage.tsx` (page inside AppLayout — model on `ExerciseLibraryPage.tsx` / `MySchedulePage.tsx`) + `AssignmentRow.tsx` (title, skill badge, i18n deadline, status badge, overdue marker, CTA link/disabled). L/E/E trilogy: skeleton rows, student-tone empty, inline-retry error. Feature barrel `src/features/assignments/index.ts` (TS-7). No domain data in `components/ui/` (FW-7).
- [x] **Task 4 — Route wiring (AC1).** Add `/assignments` to `src/routes.tsx` as a **lazy deep-imported** child under the `AppLayout` pathless route (same block as `/my-schedule`), `element: <RouteRoleGate allowedRoles={['student']} … sectionNameKey="assignments" />`. **Extend the `RouteRoleGate` `sectionNameKey` discriminated union + its i18n copy to include `'assignments'`** (the union is a closed type — Story 2.6; add the member + en/vi strings). The `/assignments/:assignmentId/attempt` child (5.2b) sits under the full-bleed layout — do not nest it here.
- [x] **Task 5 — i18n + tests + gates (AC6,7).** Add `assignments.*` keys to `en.json` + `vi.json` (`assertI18nParity`, VN-length-checked). Tests (MSW-only seam, TEST-FE-1..6): three-state (skeleton/rows/error) + empty; role-negative — teacher/owner → 403 gate, list absent (TEST-FE-6); CTA/status mapping per `submissionStatus` × skill incl. the "Available soon" disabled case; overdue marker; deadline i18n both locales; `axe` on all states; keyboard reachability. Gates: `tsc --noEmit -p tsconfig.app.json`, `eslint`, `npm run i18n-parity`, full `vitest`.

### Review Findings

_Code review 2026-08-04 (Amelia). Blind Hunter · Edge Case Hunter · Acceptance Auditor. 1 decision, 4 patch, 1 defer, 4 dismissed. Each patch/decision verified against source — the hunters worked off diff offsets._

- [x] [Review][Patch] Late-penalty needs a unit (decision resolved 2026-08-04 → **points**) — `assignments.overdue.penalty` currently "Overdue · late penalty {{penalty}}" (bare number). Change en to "Overdue · −{{penalty}} pts" and vi to the Vietnamese points equivalent. [`en.json`/`vi.json` `assignments.overdue.penalty`]

- [x] [Review][Patch] Row-model switches lack fail-safe defaults — `rowStatus`/`attemptRouteForSkill` are exhaustive over the *generated* closed unions, but a server/type-version skew value returns `undefined`: `rowStatus` → `const { statusKey, cta } = undefined` crashes the whole list (not one row); `attemptRouteForSkill` → `route === null` is false → `<Link to={undefined}>` broken link (the exact 404-into-unbuilt-route case D2 forbids). Add a fail-safe `default` (route → `null` = degrade to "Available soon"; status → no-CTA + fallback badge). [`lib/assignmentRow.ts`:30-41, 64-76]
- [x] [Review][Patch] AC7 axe coverage gap — AC7/Task 5 require "`axe` clean on loading/data/empty/error"; the suite runs axe on **data + empty only** (2 calls), NOT on the loading (skeleton) or error states. [`__tests__/AssignmentsListPage.test.tsx`:~397-407]
- [x] [Review][Patch] Header count shows "0 assignments" during loading and error — the count (`t('assignments.countLabel',{count: pagination.total})`) sits above the state switch; `pagination.total` defaults to 0, so it flashes "0 assignments" over the skeleton and contradicts the error alert. Render the count only in the success branch (or guard `!isPending && !isError`). [`AssignmentsListPage.tsx`:55-57]
- [x] [Review][Patch] Route uses the feature barrel, not a deep import — Task 4 says "lazy **deep-imported** child … same block as `/my-schedule`"; `/my-schedule` (and `/exercises`, `/classes`, `/knowledge-hub`) deep-import "(NOT the barrel) so Rolldown emits a dedicated chunk". This route imports `{ AssignmentsListPage } from '@/features/assignments'` (the barrel → pulls the whole feature surface). Change to `import('@/features/assignments/AssignmentsListPage')`. [`routes.tsx`:661-662]

- [x] [Review][Defer] Deadline display is UTC-date-only while overdue uses the full instant — `formatAssignmentDate` slices `iso.slice(0,10)` (local-midnight format) so a late-in-day deadline can read "Due Aug 20" yet already show "Overdue", and the UTC slice is off-by-one in UTC+7. Mirrors the sanctioned `formatExerciseDate` precedent (codebase-wide pattern, shared-formatter tech-debt FU-3-2-x); not introduced by this change. The overdue instant-comparison itself is correct. [`lib/formatAssignmentDate.ts`:16-26] — deferred, pre-existing.

**Dismissed (noise / false positive):** (1) null-`deadlineAt` crash — `StudentAssignmentListItem.deadlineAt` is non-nullable `string` in the contract (`client.ts` schema). (2) out-of-range date rollover (`2026-13-01`) — needs malformed non-RFC3339 data; subsumed by the deferred formatter item. (3) test seeds session into the singleton `queryClient` while rendering under `createTestQueryClient()` — intentional and matches TS-8 (session lives in the module-level cache app-wide; the provider client serves component data queries; role-negative tests pass, proving the gate reads the seeded singleton). (4) "Showing {shown} of {total}" using the current-page count — defensible as designed (page position is shown separately by the page indicator).

## Dev Notes

**Thin, read-only list page — low risk.** The backend (`GET /api/assignments`) shipped in 5.2a; this is a straightforward paginated list inside `AppLayout`, gated to students, whose rows are the entry point into the attempt UIs. The only mild subtlety is the row CTA mapping (AC4) and extending the `RouteRoleGate` section-name union (AC/Task 4).

### Backend contract consumed (in `src/lib/api/client.ts` — do NOT hand-write, TS-2/XL-1)
- `GET /api/assignments?page&pageSize` — `operationId: listStudentAssignments`. Student-only (non-student → **403** `INSUFFICIENT_ROLE`), enrollment-scoped, `deadline_at ASC` (tiebreak `id`). Returns `EnvelopeStudentAssignmentList` = `{ data: StudentAssignmentListItem[], meta: { serverTime, pagination: {page,pageSize,total,totalPages} } }` (meta echoes **normalized/clamped** page/pageSize).
- `StudentAssignmentListItem` = `{ id, exerciseId, classId, status (AssignmentStatus open|closed), deadlineAt, hardDeadlineAt (nullable), instructions (nullable), latePenalty, createdAt, updatedAt, exerciseTitle, exerciseSkill (ExerciseSkill), submissionId (nullable), submissionStatus (nullable SubmissionStatus) }`. `submissionStatus == null` ⇒ not started.
- `ExerciseSkill = reading|listening|writing|speaking|grammar|vocabulary|general`; `SubmissionStatus = in_progress|submitted|ai_processing|graded`.

### Canonical reuse paths (reuse/adapt, do not rebuild)
- **Nav entry ALREADY EXISTS:** `src/components/domain/sidebarNavConfig.tsx:99` — `{ labelKey: 'sidebar.student.assignments', icon: ClipboardList, href: '/assignments' }`. Do **not** add it; just make the route resolve.
- **Route precedent (student nav landing, inside AppLayout):** `src/routes.tsx:639` — the `/my-schedule` block (`RouteRoleGate allowedRoles={['student']} requiredRolesForCopy={['owner','admin']} sectionNameKey="schedule"`, lazy, `MySchedulePage`). Copy this shape.
- **List page + pagination + L/E/E template:** `src/features/exercises/ExerciseLibraryPage.tsx` (+ `api/useExercises.ts` paginated hook, `exercisesKeys.ts`). Page structure/test wrapper: `ExerciseEditorPage.test.tsx`.
- **api-fetch (TS-4/8):** `src/lib/api-fetch.ts` — **`apiFetchWithMeta`** for the paginated meta; Bearer from `['auth','session']`; envelope unwrap; typed `ApiError`.
- **RouteRoleGate:** `src/components/shared/RouteRoleGate.tsx` — `sectionNameKey` is a **closed discriminated union** (Story 2.6, Sally-B2) driving the PermissionDenied copy; add `'assignments'` + en/vi strings (Task 4).
- **i18n:** `src/locales/en.json`+`vi.json` (flat dot keys, `{{token}}`); `assertI18nParity` (`src/lib/test/i18n-parity.ts`) + `npm run i18n-parity`. The i18n **date formatter** (`t('date',{val})`) formats `deadlineAt` — never `new Date().toLocaleDateString()` (TS-6). No `assignments.*` keys exist yet — clean namespace.
- **Tests:** inline render wrappers per file; MSW `src/test/mocks/handlers.ts` (add a `listStudentAssignments` handler); role via session-seed / `RoleProvider`; `vitest-axe` in `src/test/vitest-setup.ts`.

### Decisions
- **D1 — Release bound to 5-2b.** 5-2c is the entry point; 5-2b is the destination. Neither releases to prod alone (they were one epic story, s33). Build order: 5-2c first is recommended (gives 5-2b a real in-app entry for verify/demo), but the release wraps both. Mirrors the `release_bound_to` on 5-2b.
- **D2 — Rows link by skill; unbuilt attempt UIs degrade to "Available soon."** Only the quiz attempt route (5.2b) exists at ship. Writing (5.3)/speaking (5.4) rows still LIST (the student sees the assignment) but their CTA is a disabled "Available soon" until those stories land — no 404 links. `attemptRouteForSkill` returning `null` is the seam 5.3/5.4 extend.
- **D3 — Result link deferred.** `graded` rows show a badge only; the result view (`/assignments/:id/result`, s35) is Story 5.5. No result navigation here.
- **D4 — List page lives in `src/features/assignments/`, not `quiz-attempt/`.** The list spans all skills (quiz/writing/speaking), so it is its own feature; `quiz-attempt/` (5.2b) stays the attempt-screen feature. Cross-feature nav is by route path, not import (TS-7).

### Project Structure Notes
New: `src/features/assignments/` (`api/{assignmentKeys,useStudentAssignments}.ts`, `lib/assignmentRow.ts`, `AssignmentsListPage.tsx`, `AssignmentRow.tsx`, `index.ts`). Modified: `src/routes.tsx` (+`/assignments` child under AppLayout), `src/components/shared/RouteRoleGate.tsx` (+`'assignments'` section-name member), `src/locales/en.json`+`vi.json`. **No `api.yaml`, no `client.ts`, no codegen, no backend.** Do NOT touch `sidebarNavConfig.tsx` (entry already present).

### Testing standards summary
TEST-FE-1..6 + TEST-UX-1. MSW only (add `listStudentAssignments` handler). Three-state + empty coverage. Role-negative: student-only route — assert a teacher/owner hits the 403 gate and the list is absent (TEST-FE-6). i18n: both locales, deadline date rendered via the formatter in en+vi. axe on every state. Low risk — no timer/autosave/finalizer, so no WF-8 ATDD gate; still author the pure `assignmentRow.ts` tests first.

### References
- [Source: epics/epic-05.md#Story-5.2] — the parent quiz story; the list is the entry surface for the attempt UIs.
- [Source: 5-2a-student-attempt-read-api.md] — `GET /api/assignments` contract, `StudentAssignmentListItem`, pagination/ordering, 403 role gate, `latePenalty` carried for the overdue marker.
- [Source: 5-2b-quiz-attempt-interface-reading-listening-vocabulary.md] — the attempt route `/assignments/:assignmentId/attempt` each row deep-links to; release-binding (D13/`release_bound_to`).
- [Source: classlite-web/src/components/domain/sidebarNavConfig.tsx:99] — the existing student `/assignments` nav entry (do not duplicate).
- [Source: classlite-web/src/routes.tsx:639] — the `/my-schedule` student-gated-inside-AppLayout route precedent.
- [Source: classlite-web/src/features/exercises/ExerciseLibraryPage.tsx] — paginated list + L/E/E template.
- [Source: docs/project-context.md] — TS-2/3/4/6/8, FW-3/7, UX-1/2, TEST-FE-1..6, XL-2.
- [Source: docs/bmad-story-conventions.md] — Dev Agent Record + File List → sibling completion-notes at dev pickup; story <600 lines.

## Definition of Done

- [x] `/assignments` renders inside AppLayout, student-gated (non-student → 403 gate); nav entry (pre-existing) now resolves.
- [x] Paginated list in server order (`deadline_at ASC`); each row shows title, skill badge, i18n deadline, status; overdue marker when past-deadline + unsubmitted (+ late-penalty hint).
- [x] Row CTA maps per `submissionStatus` × skill: Start/Continue → attempt route; Submitted → read-only; Graded → badge (result deferred); writing/speaking → "Available soon" disabled until 5.3/5.4.
- [x] Frontend-only: **no `api.yaml`/`client.ts`/codegen/backend change**; `RouteRoleGate` section-name union extended with `'assignments'` (+ en/vi copy); `sidebarNavConfig` untouched.
- [x] L/E/E trilogy (skeleton/student-tone empty/inline-retry error); `assignments.*` in en+vi (`i18n-parity` green); axe clean all states; role-negative asserted; pure `assignmentRow.ts` unit-tested.
- [x] Gates: `tsc --noEmit`, `eslint`, `vitest`, `i18n-parity` green. **Release-bound to 5-2b** (D1). Sibling completion-notes holds Dev Agent Record + File List; story <600 lines.

## Out of Scope

- **The attempt screens** — quiz (5.2b), writing (5.3), speaking (5.4). This story only LISTS assignments and links into them.
- **The graded result view** (`/assignments/:id/result`, s35) — Story 5.5. `graded` rows show a badge; no result navigation.
- **Writing/speaking attempt routes** — not built until 5.3/5.4; their rows degrade to "Available soon" (D2).
- **Filtering / search / advanced grouping** — v1 is the server-ordered list; client filters are a later enhancement if needed.
- **Any backend/`api.yaml`/schema/codegen change** — `GET /api/assignments` shipped in 5.2a.
- **Teacher/owner assignment management views** — the teacher class-scoped list (`GET /api/classes/{classId}/assignments`) + FR-20 exercise-library columns are separate Epic-5 teacher-FE concerns.

## Change Log

| Date | Change | Author |
|---|---|---|
| 2026-08-04 | **Implemented via `/bmad-dev-story 5-2c` (Amelia).** All 6 tasks + 7 ACs delivered, frontend-only over the shipped `GET /api/assignments` (no codegen/backend). New `src/features/assignments/` feature (api hook+keys, pure `assignmentRow` row-model, `AssignmentsListPage` + `AssignmentRow`, barrel). `/assignments` route wired under AppLayout, student-gated; `RouteRoleGate`/`PermissionDenied` `SectionNameKey` union extended with `'assignments'` (+en/vi copy). 35 `assignments.*` i18n keys added in both locales. Incidental: registered the pre-existing orphan `sidebar.owner.exercises` in the parity coverage array to unblock the (baseline-red) `i18n-parity` gate. **44 new tests** (20 pure row-model RED-first + 24 page). Gates green: `tsc`, `eslint`, `i18n-parity` (1457 keys), full `vitest` **2119 passed, 0 regressions**. Dev Agent Record + File List in sibling `5-2c-student-assignments-list-page-completion-notes.md`. `ready-for-dev → review`. **Release-bound to 5-2b** (D1). | Amelia |
| 2026-08-04 | **Created via `/bmad-create-story 5-2c` (Amelia).** Split out of 5-2b at party-mode (Ducdo 2026-08-04) — the student `/assignments` list landing / entry point into the attempt UIs, so 5-2b (attempt screen) has a real in-app door. Frontend-only over the shipped `GET /api/assignments` (5.2a) — no codegen. 7 ACs, 4 decisions, size S, risk 3. Recon confirmed the student `/assignments` **nav entry already exists** (`sidebarNavConfig.tsx:99`) — this story wires the route it points to (currently 404s), mirroring the `/my-schedule` student-gated-inside-AppLayout precedent (`routes.tsx:639`). Rows deep-link by skill: quiz → 5.2b `/assignments/:id/attempt`; writing/speaking → "Available soon" until 5.3/5.4; graded result deferred to 5.5. **Release-bound to 5-2b** (D1) — recommended build order 5-2c → 5-2b, ship together. `backlog → ready-for-dev`. Sequence: **5-2c → 5-2b** → 5-3 → 5-4 → 5-5. Next: `/bmad-dev-story 5-2c`. | Amelia |
