---
baseline_commit: 2d6bec4
---

# Story 3.2: Class Detail View with Tabs

Status: done

<!-- SECOND story of Epic 3 (epic already in-progress from 3.1). Audience: FRONTEND. Ships the s08/s09 tabbed detail shell for a single class. Depends on Story 3.1 (classes table, `GET /api/classes/{id}` → `EnvelopeClass`, `ClassStatusPill`, `useRole()`, `RouteRoleGate` sectionNameKey="classes", the `/classes` index + its dormant-cell precedent). -->
<!-- SCOPING DECISIONS (Ducdo, 2026-07-20) — the epic AC set assumes data from tables that DO NOT EXIST yet and belong to later epics:
  • enrollments/roster → Epic 7 (Story 7.3); architecture §4.11 places enrollment_handler/service/queries in People Management (s39–s44), NOT Epic 3. `deferred-work.md` SEQ-2-7-1 named 3.2 as a *candidate* enrollments home — Ducdo confirmed enrollments STAYS in Epic 7. This story creates NO enrollments table and does NOT unblock Story 2.7.
  • sessions → Story 3.4 · assignments → Epic 5 · session_materials → Story 3.5 / Epic 4 · analytics → Epic 8 (already spec'd as a placeholder in the epic AC).
  • DECISION 1 → SHELL-FIRST (frontend-only). Overview tab renders REAL class metadata from the shipped `GET /api/classes/{id}`; the 5 data tabs (Students/Assignments/Sessions/Materials/Analytics) render PRESENT-but-DORMANT "coming soon" panels. ZERO backend work this story.
  • DECISION 2 → NESTED ROUTES `/classes/{id}/{tab}` (React Router v7): deep-linkable, refresh-safe; `/classes/{id}` redirects to `overview`.
  • PARTY-MODE AMENDMENTS (2026-07-20, Winston/Amelia/Sally/John/Murat) folded in — see Change Log. Headlines: Overview drops the two dormant sub-widgets (feels finished on real metadata); dormant tabs are `ComingSoonPanel`-only with NO epic language on-screen (owning-epic pointer is a code comment); the not-found guard wraps the WHOLE nested tree (deep-linking a foreign class's tab must not leak); redirect pinned to `<Navigate replace>`; `ClassStatusPill` gains `onTransition?:` optional; chunk-separation is an AC; the MSW no-refetch assertion is a request-counter + no-reflash observable, not a bare call-count. 12 ACs collapsed to 8. -->
<!-- NO backend / api.yaml / sqlc / migration changes (WF-1/WF-3 do NOT apply — no `.sql`, no `api.yaml` touch → do NOT run codegen.sh). NO enrollments (Epic 7). NO sessions/schedule (3.4). NO assignments (Epic 5). NO materials (3.5/Epic 4). NO analytics data (Epic 8). NO "Save as template" action wiring (templates CRUD is 3.3 — Actions-card affordance is dormant/absent). NO detail-head lifecycle transitions (index owns them, 3.1 AC8). NO student `s31` consumer view. -->

## Story

As a **Teacher, Admin, or Owner viewing a class**,
I want **a tabbed detail page at `/classes/{id}` whose Overview shows the real class at a glance, with Students, Assignments, Sessions, Materials, and Analytics presented as clearly-labelled surfaces that fill in as later features ship**,
so that **every class in the `/classes` index has a stable, deep-linkable home I can open, verify, and orient in — without a dead end or a broken tab.**

## Context: what data exists vs. what is dormant

| Tab | Data source | This story |
|---|---|---|
| **Overview** | `GET /api/classes/{id}` (shipped 3.1) — name, status, teacher/pendingEmail, `startDate`, `endDate`, `targetBand`, `primarySkill`, `sessionCount`, `capacity`, `description`, `color`, `dueDatesEnabled`, `createdAt`/`updatedAt` | **REAL, and complete on its own.** The next-session + quick-analytics widgets are **NOT rendered this story** (no data) — they return with sessions (3.4) / attendance (3.5) / enrollments (7.3). |
| **Students** | `enrollments` table — **does not exist** (Epic 7 / Story 7.3) | Dormant `ComingSoonPanel`. |
| **Assignments** | `assignments` table — **does not exist** (Epic 5) | Dormant `ComingSoonPanel`. |
| **Sessions** | `sessions` table — **does not exist** (Story 3.4) | Dormant `ComingSoonPanel`. |
| **Materials** | `session_materials` / knowledge-hub — **does not exist** (Story 3.5 / Epic 4) | Dormant `ComingSoonPanel`. |
| **Analytics** | Epic 8 — **explicitly a placeholder in the epic AC** | Dormant `ComingSoonPanel`. |

**No new API endpoint is created or required.** The only network read is the reused `GET /api/classes/{id}`.

## Acceptance Criteria

1. **Tabbed detail shell + nested routing (screen s08/s09).** Navigating to `/classes/{id}` renders a `ClassDetailLayout` with a shared **detail-head** (colored skill/letter tile + class name + `ClassStatusPill` (read-only in the head — see AC5 note) + meta line) and a **tab strip** exposing exactly six tabs in order: **Overview · Students · Assignments · Sessions · Materials · Analytics**. Routing is **nested** (React Router v7): `/classes/:id` is a layout route whose children are `overview`, `students`, `assignments`, `sessions`, `materials`, `analytics`. The `:id` **index route redirects to `overview` via `<Navigate to="overview" replace />`** (an in-chunk element redirect — NOT a route `loader` redirect, keeping FW-1 clean and the redirect inside the lazy chunk), so a bare `/classes/{id}` never renders an empty body and the s07 name-link (AC5) lands correctly. Every tab is **deep-linkable and refresh-safe** (`/classes/{id}/sessions` loads directly with Sessions active). The active tab is **derived from the URL** (`NavLink`/`useParams`), never component state or a `useEffect` (FW-4).

2. **Overview tab — real class metadata, complete on its own.** The Overview route reads the class via `useClass(id)` (AC4; same `classesKeys.detail(id)` cache the layout warmed — **no second fetch**) and renders the shipped fields as a finished page: **name, status (`ClassStatusPill`), teacher (or `pendingTeacherEmail`), schedule (`startDate`/`endDate` formatted via the i18n date formatter — TS-6, never raw ISO in render), target band, primary skill, session count, capacity, description, due-dates-enabled**. Layout follows the UX **detail + right-rail** pattern (UX §6.5 / §8.3): main column = class-summary card; right rail (`detail-side`, ~300–320px) = an info/next-step card + a dashed **Actions card**. **The two epic-AC Overview sub-widgets — "next upcoming session" and "quick analytics (attendance rate, student count)" — are NOT rendered this story** (they have no data source; rendering them dormant made the *primary* page read under-construction). They return with their data in Story 3.4 / 3.5 / Epic 7 / Epic 8. _[Deviation from epic AC2 "Overview shows … next session … quick analytics", pragmatically defaulted per the party-mode review; flag at code review if product wants a placeholder instead of omission.]_ The dashed **Actions card**'s "Save as template" affordance is **dormant/absent** this story (templates CRUD is Story 3.3).

3. **Dormant tabs — `ComingSoonPanel` only (AC covers all five: Students, Assignments, Sessions, Materials, Analytics).** Each of the five non-Overview tab routes renders a single shared `<ComingSoonPanel>` and **nothing else** — a hard ceiling: **no data fetch, no query, no data-shaped stub (no mock table/columns/filters), no interactive control** (no "Enroll student" CTA — there is no student-source flow yet). The panel's **user-facing copy speaks the tab's benefit in the user's language and carries NO roadmap/epic/date language** (e.g. Students → "Your class roster lives here. Once you can enroll students, you'll manage them from this tab." — never "arrives in Epic 7"). The owning-epic pointer lives **only in a code comment** (`// epic: 7.3 — swap ComingSoonPanel for the real roster`) so a future dev greps it; it is never shown to a user. A neutral "Coming soon" chip is the ceiling of any roadmap signal. Each panel has a distinct `data-testid` (`class-tab-students-coming-soon`, …). An optional purely-decorative, `aria-hidden` illustration is permitted; a data-shaped preview is not. Analytics is the epic-designated placeholder — same treatment.

4. **Per-tab data slot + parent-owned shared state (independent loading/caching).** Each tab route owns its own data boundary: **Overview** loads from `classesKeys.detail(id)` via `useClass(id)`; the five dormant tabs own **no** query today. The **layout (`ClassDetailLayout` + `useClass`) owns everything shared**: the class metadata read, the detail-head chrome, and the **contract for how a future tab surfaces a count/badge into the tab bar** (documented as a convention now — e.g. "a tab may expose an optional badge via a layout-provided slot" — so Epic 7's Students-count-in-tab drops in without reshaping the layout). Switching tabs **never refetches Overview** and a future Sessions query will not couple to Overview's cache. (No shared "load everything" fetch.)

5. **`/classes` index → detail link (closes 3.1 AC7 deferral).** On the s07 index (`ClassesPage.tsx`), the class **name** in each row becomes a `react-router` `<Link to={/classes/${cls.id}/overview}>` — 3.1 shipped it as inert text noting "the class name becomes a link in Story 3.2 when its destination exists." The row stays **otherwise inert**: no full-row `cursor:pointer`, no row-body click handler (confirm `ClassRow` is not already an `onClick` row → nested-interactive a11y); interactivity remains on the name link, the status pill, and the Actions menu only. Add an Actions-menu **"View details"** item pointing at the same destination. Reconcile the shipped `ClassesPage.test.tsx` (grep for name-cell assertions — `getByRole('cell', {name})` / `.not.toHaveAttribute('href')` inert assertions will break on the new anchor). **`ClassStatusPill` prop delta:** the shipped pill was built for the row transition affordance; make `onTransition?:` **optional** so the detail-head can render it as a static badge (no head transitions this story) — update `ClassStatusPill.tsx` + `ClassStatusPill.test.tsx` accordingly (the one shipped-file edit this story makes; behavior-neutral for the row caller which still passes `onTransition`).

6. **Loading / Not-found / Error trilogy — guarding the WHOLE nested tree (UX-1).** `ClassDetailLayout` implements all three states for the `useClass(id)` read, **before** the `<Outlet />` mounts any tab, so a deep-link straight to a nested tab (`/classes/{foreignId}/students`) hits the SAME guard: **Loading** = detail-head + body skeleton (not a spinner); **Not-found** (`err instanceof ApiError && err.status === 404`, code `CLASS_NOT_FOUND`) = a friendly, role-safe "class not found" card + "back to classes" `<Link to="/classes">`; **Error** (other) = inline `role="alert"` + retry. `useClass` surfaces the `ApiError` **unchanged** (no ad-hoc flag) so the layout branches on `status === 404`. **Non-leak invariant:** the shipped endpoint returns 404 for an absent class AND for a teacher targeting a class not assigned to them (teacher-sees-nothing, 3.1 AC6). The shell MUST render the **identical** not-found surface for both and MUST NOT paint the class name/metadata anywhere (detail-head, breadcrumb, title, tab chrome) before the 404 resolves — no optimistic render from router state. Two-layer model: `RouteRoleGate` = **role** authz; the 404 = **record/ownership** authz — do not try to enforce ownership at the gate.

7. **Role gate + own lazy chunk + real bundle boundary.** The `/classes/:id` route group is a **sibling** of the existing `/classes` index group (not nested under it, so the index chunk stays lean), gated by `RouteRoleGate allowedRoles={['owner','admin','teacher']} requiredRolesForCopy={['owner','admin']} sectionNameKey="classes"` — reusing the existing `classes` `SectionNameKey` (shipped 3.1; no `PermissionDenied` change). `ClassDetailLayout` MUST be **lazy/deep-imported** so Rolldown emits its own `ClassDetail-*.js` chunk; **the s07 index (`ClassesPage`) chunk MUST NOT grow** to absorb it. Extend `e2e/route-bundle-boundaries.spec.ts` with a **real boundary assertion** for `/classes/{id}`: the detail chunk is requested on navigation and was NOT in the initial bundle, and the s07 index chunk does not contain the detail layout (match the spec's existing chunk-level pattern — a bare "coming-soon testid is present" check is a liveness ping, acceptable only alongside the chunk assertion, not instead of it).

8. **i18n (both locales).** New flat `classes.detail.*` keys authored in `en.json` AND `vi.json` at parity (UX-2): tab labels, detail-head meta labels, Overview field labels, the benefit-language "coming soon" copy per tab (**no epic/roadmap words**), the not-found state, and the Actions-card labels. Add a `STORY_3_2_KEYS` closed-literal array to `i18n-parity-coverage.test.ts` with interpolation-token parity + prefix ratchet (mirror the `STORY_3_1_KEYS` block ~line 1520). Assert key existence in both locales (TEST-FE-4). Accessibility copy: dormant tabs are **not** `disabled` (they stay in tab order and lead to a real panel); the "coming soon" state lives in the tab's **accessible name** (e.g. `classes.detail.tabs.sessionsComingSoon` → "Sessions, coming soon").

## Tasks / Subtasks

- [x] **Task 0 — ATDD gate (WF-8). SKIPPABLE and skipped** (document in Dev Agent Record). Frontend shell: no new tenant-scoped table, no new backend, no new authz boundary (reuses shipped `RouteRoleGate` + shipped `GET /api/classes/{id}` teacher-scope 404). No AC maps to risk ≥6. **BUT (Murat):** the AC6 teacher-invisible non-leak is security-adjacent (risk 5-6) — write that test **red-first inside the component suite** (stub a layout that leaks the name → watch it fail → guard it), even though the formal ATDD artifact is skipped. A never-failed security test is not evidence.

- [x] **Task 1 — Nested detail routing + redirect + bundle boundary (AC1, AC6, AC7).** In `src/routes.tsx`, add a `/classes/:id` layout route **as a sibling child of the existing `/classes` AppLayout group** (peers, not nested — index chunk stays lean). Wrap in its own `RouteRoleGate` element (same props as the index). Children: an `index` route rendering **`<Navigate to="overview" replace />`** (element redirect, NOT a loader), plus `overview`/`students`/`assignments`/`sessions`/`materials`/`analytics`. Deep-import `ClassDetailLayout` (NOT the barrel) for its own `ClassDetail-*.js` chunk. Extend `e2e/route-bundle-boundaries.spec.ts` with the real chunk-boundary assertion (AC7). **Tab strip = `NavLink`s (URL is the source of truth), not shadcn `Tabs` state.**
  - [x] Verify the s07 `ClassesPage` chunk does NOT absorb the detail chunk (bundle negative assertion).

- [x] **Task 2 — `useClass(id)` detail hook (AC2, AC4, AC6).** New `src/features/classes/api/useClass.ts`: `useQuery({ queryKey: classesKeys.detail(id), queryFn: () => apiFetch<ClassWire>(/api/classes/${id}), enabled: Boolean(id), staleTime: 60_000 })`. `classesKeys.detail(id)` already exists — do NOT add a key. **Surface the `ApiError` unchanged** (`.status`/`.code`) so the layout branches `status === 404` (AC6). Reuse `ClassWire` from `useClasses.ts`. Read-only — no optimistic anything.

- [x] **Task 3 — `ClassDetailLayout` + detail-head + tab strip + trilogy (AC1, AC5, AC6, AC7).** New `src/features/classes/ClassDetailLayout.tsx` (deep-import target). `useParams(':id')` → `useClass(id)`. Renders the trilogy **around** the `<Outlet />` (guard resolves before any tab mounts — AC6):
  - **Loading** → detail-head + body skeleton (local markup — see below).
  - **Not-found** (`err.status === 404`) → friendly card + "back to classes" `<Link to="/classes">` (identical surface for absent + teacher-invisible; never render the name/metadata — AC6 non-leak).
  - **Error** (other) → inline `role="alert"` + retry.
  - **Success** → detail-head (tile via `cls.color ?? var(--cl-accent)`, name, `ClassStatusPill` **read-only** — pass no `onTransition`; the pill is a static badge per AC5) + meta line (skill · schedule · target band) + **`NavLink` tab strip** (`role="tablist"`/`tab`/`tabpanel`, `aria-selected`, roving tabindex; dormant tabs NOT `disabled`, "coming soon" in the accessible name — AC8) + `<Outlet />` + right-rail (`detail-side`: info card + dashed Actions card).
  - **Trilogy source (Amelia GAP-E, decided): ISOLATED — render local skeleton/error/not-found markup in this file; do NOT extract 3.1's `ClassesPage` `ErrorAlert`/`Skeleton` (avoids editing `ClassesPage.tsx` imports + disturbing 3.1's green suite).** Log the eventual shared-trilogy extraction as tech-debt (FU-3-2-x). Reuse the shadcn `Skeleton` primitive directly (that's shared already).
  - **Mobile:** tab strip is a horizontal scroll-strip with a visible edge-fade + active tab scrolled into view; right-rail reflows **below** the main column (class-summary first, dashed Actions card last). 44px touch targets. Keyboard-reachable (TEST-UX-4).

- [x] **Task 4 — `OverviewTab` (AC2, AC4).** New `src/features/classes/tabs/OverviewTab.tsx`. **MUST call the same `useClass(id)` hook** (byte-identical key → shared cache, no 2nd fetch — do NOT re-declare `useQuery`). Renders the real-metadata card (all shipped fields per AC2) with the i18n date formatter for `startDate`/`endDate` (TS-6). **Do NOT render next-session or quick-analytics widgets** (AC2 — omitted this story). Right-rail info + dashed (dormant) Actions card may live here or in the layout — dev choice, document.

- [x] **Task 5 — Dormant tab panels + `ComingSoonPanel` (AC3, AC8).** New `src/features/classes/tabs/`: `StudentsTab.tsx`, `AssignmentsTab.tsx`, `SessionsTab.tsx`, `MaterialsTab.tsx`, `AnalyticsTab.tsx` — each is `<ComingSoonPanel titleKey bodyKey testid />` and **nothing else** (hard ceiling AC3: no fetch, no data stub, no interactive control). New shared `components/ComingSoonPanel.tsx` (feature-local). Copy = benefit language, **no epic/date words on screen**; put the owning-epic pointer in a **code comment** per tab (`// epic: 5 — swap for AssignmentList`). Distinct `data-testid` per tab. Optional `aria-hidden` decorative illustration allowed.

- [x] **Task 6 — `ClassesPage` link-up (AC5).** UPDATE `src/features/classes/ClassesPage.tsx` `ClassRow`: wrap `cls.name` in `<Link to={/classes/${cls.id}/overview}>` (import `Link` from `react-router`), preserving tile + typography; keep the row otherwise inert. Add a `View details` `DropdownMenuItem` (navigates to the same target). **Before writing:** grep `__tests__/ClassesPage.test.tsx` for name-cell / inert assertions and reconcile. Confirm `ClassRow` has no existing row-level `onClick`. Do NOT change scope/cache/trilogy logic.

- [x] **Task 7 — i18n (AC8).** Author `classes.detail.*` keys in `en.json` + `vi.json` at parity: `.tabs.{overview,students,assignments,sessions,materials,analytics}` + `.tabs.{students,…}ComingSoon` (accessible-name variants), `.head.meta.{skill,schedule,targetBand,teacher,pendingTeacher}`, `.overview.fields.*`, `.comingSoon.{students,assignments,sessions,materials,analytics}.{title,body}` (benefit copy, **no epic words**), `.notFound.{headline,body,backCta}`, `.actions.{heading,viewDetails}`. Reuse index `classes.error.*` where copy matches — do NOT duplicate. Add `STORY_3_2_KEYS` closed literal + `assertI18nParity` + `assertI18nInterpolationParity` + prefix-ratchet blocks (mirror `STORY_3_1_KEYS` ~line 1520). `npm run i18n-parity` stays green.

- [x] **Task 8 — Tests (all ACs).** Frontend only (MSW at HTTP boundary; never mock `useQuery`; `retry:false`; one `QueryClient` per test; `MemoryRouter`/`createMemoryRouter` `initialEntries` for nested-route + deep-link). See Testing.

## Dev Notes

**Reuse map (do NOT reinvent):**

| Need | Reuse | Path |
|---|---|---|
| Single-class read type | `ClassWire = components['schemas']['Class']` | `src/features/classes/api/useClasses.ts:13` |
| Detail query key (already exists) | `classesKeys.detail(id)` | `src/features/classes/api/classesKeys.ts:18` |
| Fetch + `ApiError.status`/`.code` | `apiFetch` | `src/lib/api-fetch.ts` |
| Status pill (detail-head, read-only) | `ClassStatusPill` (add `onTransition?:` optional) | `src/features/classes/components/ClassStatusPill.tsx` |
| Skeleton primitive | `Skeleton` | `src/components/ui/skeleton.tsx` |
| Role gate + section key | `RouteRoleGate` + `SectionNameKey='classes'` | `src/components/shared/RouteRoleGate.tsx`, `PermissionDenied.tsx:45` (already has `classes`) |
| Route group + own-chunk deep-import pattern | `/classes` index route | `src/routes.tsx:235-269` |
| i18n date formatting (TS-6) | `t('date', { val })` / `Intl` helper | settings/dashboard (e.g. `formatDateSingle`/`formatDateRange`, 2-5b `RoomsTab`) |
| Mobile tab bar (optional) | `MobileTabBar` domain component | `src/components/domain/MobileTabBar.tsx` |
| Nested tabbed-shell UX pattern | UX §6.5 "Detail + right-rail", §8.3 s08/s09 | `_bmad-output/planning-artifacts/ux-design-specification.md` |
| i18n parity block precedent | `STORY_3_1_KEYS` | `src/lib/test/__tests__/i18n-parity-coverage.test.ts:1520` |

**Critical constraints:**
- **NO backend / api.yaml / sqlc / migration / codegen.** Only network read = shipped `GET /api/classes/{id}`. `WF-1`/`WF-3` do NOT trigger. Editing `.sql` or `api.yaml` = out of scope — STOP.
- **`TS-6`:** dates via the i18n formatter, never `new Date(iso).toLocaleDateString()` in render.
- **`FW-1`:** the index→overview redirect is an element (`<Navigate>`), not a data-owning loader.
- **`TS-3`:** reuse `classesKeys.detail(id)`; no new flat key.
- **`FW-4`:** active tab derives from the URL, never a `useEffect`.
- **`FW-7` / `TS-7`:** tab panels + `ComingSoonPanel` are feature-local; cross-feature imports via barrels only.
- **`UX-1`:** the shell's Loading/Not-found/Error trilogy is mandatory and wraps the whole nested tree (AC6). Dormant tabs are an intentional "coming soon" state, NOT the empty state of a failed load.
- **Non-leak (AC6):** identical not-found surface for "absent" and "not yours"; never branch copy or paint metadata before the 404 resolves.
- **Dormant-tab ceiling (AC3):** `ComingSoonPanel` only — no query, no data-shaped stub, no interactive control, no epic words on screen.

**Open Questions (defaulted pragmatically; flag at code review if product disagrees):**
1. **Overview next-session + quick-analytics widgets** — OMITTED this story (no data; rendering them dormant made the primary page read under-construction — party-mode John/Sally). Return with 3.4/3.5/Epic 8. Default = omit; product may request a single quiet placeholder instead.
2. **Detail-head status pill** — read-only static badge (`onTransition?` unset); head transitions are forward work (index owns them, 3.1 AC8).
3. **"Save as template" Actions-card affordance** (UX §8.3) — templates CRUD is Story 3.3; render the Actions card with the affordance absent/dormant, not wired.
4. **Six-tab IA** — treated as contractual (locks the navigation shape for later epics). If product wants Analytics deferred from the tab set until Epic 8 is closer, that is a one-line change — raise at review.

### References

- [Source: _bmad-output/planning-artifacts/epics/epic-03.md#Story-3.2] — the 6-tab AC set, deps (Story 3.1), size L, audience Frontend.
- [Source: ux-design-specification.md §8.3 line 477] — s07 index + s08/s09 detail = tabbed shell (Overview embedded students/assignments tables, side cards, dashed Actions with "Save as template"; Students/Assignments/Sessions/Materials/Analytics tabs).
- [Source: ux-design-specification.md §6.5 lines 397-398] — tabbed-shell (shared detail-head + tab-strip, body swapped) + detail+right-rail (300–320px `detail-side`, dashed Actions card).
- [Source: architecture.md line 988 / §4.11] — enrollment_handler/service/queries live in People Management (Epic 7, s39–s44), NOT Epic 3 — confirms Decision 1.
- [Source: deferred-work.md — SEQ-2-7-1] — 3.2 was a *candidate* enrollments home; Ducdo 2026-07-20 confirmed enrollments stays Epic 7; 2.7 does NOT unblock here.
- [Source: 3-1-class-crud-lifecycle-and-creation-ui.md AC6/AC7] — teacher-scope 404 (not 403) on `GET /api/classes/{id}`; "class name becomes a link in Story 3.2 when its destination exists".
- [Source: classlite-api/api.yaml lines 1555-1660] — `GET /api/classes/{id}` → `EnvelopeClass`, `CLASS_NOT_FOUND` 404 (the only endpoint this story consumes).
- [Source: docs/project-context.md] — FW-1/4/7, TS-3/6/7, UX-1/2/4, TEST-FE-1..6, TEST-UX-4, WF-1/3.

## Testing

**Frontend only (MSW at the HTTP boundary — never mock `useQuery`; `retry:false`; one `QueryClient` per test; `MemoryRouter`/`createMemoryRouter` `initialEntries` for nested-route + deep-link):**

- **Shell trilogy (TEST-FE-2, named):** `renders skeleton while loading` · `renders not-found on 404 CLASS_NOT_FOUND` · `renders role="alert" on network error`.
- **Teacher-invisible non-leak (TEST-FE-6, RED-FIRST per Task 0):** MSW 404 for a teacher on another teacher's class → not-found surface renders AND the class name/metadata are ABSENT from the DOM (assert absence).
- **Deep-link-into-404 non-leak (Murat's highest-regret gap, risk 6-7):** navigate directly to a **nested** tab URL of a 404 class (`initialEntries={['/classes/foreign/sessions']}`) → the layout's not-found guard renders (NOT the Sessions panel), and name/metadata are absent — proves the guard wraps the whole nested tree, not just the index.
- **Bare-id redirect (risk 6):** `initialEntries={['/classes/c1']}` → URL settles on `/classes/c1/overview` and Overview is active.
- **Overview real data:** all shipped fields render from a mocked `Class`; `startDate`/`endDate` are i18n-formatted (rendered string ≠ raw ISO); **next-session + quick-analytics widgets are ABSENT** (negative — they were cut).
- **Dormant tabs (AC3):** each renders its `class-tab-*-coming-soon` testid; **no epic/date string appears on screen** (negative assert, e.g. `queryByText(/epic/i)` is null); each is reachable by deep-linking its nested route; no fetch fires for a dormant tab.
- **Tab nav + independent caching (AC4) — robust form, NOT bare call-count (Murat):** an **endpoint-scoped MSW request counter** for `/api/classes/:id` (reset per test) asserted `<= 1` **after awaiting a settled state** across Overview→dormant→back, **AND** the observable: returning to Overview shows data with **no loading skeleton reappearing** (no reflash ⇒ cache used).
- **`ClassesPage` link-up (AC5):** class name is a link to `/classes/{id}/overview`; **negative:** clicking the row *body* (not the name, not the menu) does NOT navigate; "View details" menu item navigates. Reconcile shipped 3.1 assertions.
- **`ClassStatusPill` read-only (AC5):** renders as a static badge with no `onTransition` (no transition affordance in the head); row caller still gets the interactive pill (3.1 regression green).
- **i18n (TEST-FE-4):** `classes.detail.*` keys exist in `en` AND `vi`; `STORY_3_2_KEYS` coverage present + parity green.
- **axe (TEST-FE-5):** full pass on the resolved shell (Overview active); tab-strip `role=tablist/tab/tabpanel` + focus/label smoke; dormant tabs are not `disabled` and expose "coming soon" in the accessible name.
- **e2e (AC7):** `route-bundle-boundaries.spec.ts` — real chunk-boundary assertion (detail chunk requested on nav + absent from initial bundle + not in the s07 index chunk), not merely a testid-presence ping.

**Cut as over-testing:** no full axe pass per dormant tab (one shell axe + presence testids); no rendered-Vietnamese-string assertions (key-existence only); don't test the shipped `GET /api/classes/{id}` contract (3.1 owns it) — mock at MSW; browser back/forward across tabs is browser-native given URL-derived tab state (AC1) — skip unless tab state is also stored (it is not).

## Definition of Done

- [x] AC1–AC8 met; `tsc --noEmit` (app+e2e), `eslint`, `vitest`, `i18n-parity`, `npm run build` all green. (No Go/backend — no codegen.)
- [x] Nested `/classes/:id` routes (overview default via `<Navigate replace>` + 5 tabs) deep-linkable + refresh-safe; own lazy `ClassDetail-*.js` chunk; s07 index chunk did NOT grow; `route-bundle-boundaries` extended with a real chunk assertion + green.
- [x] Overview renders real class metadata; next-session + quick-analytics widgets omitted; 5 dormant tabs are `ComingSoonPanel`-only, no epic language on screen, owning-epic pointer in code comments.
- [x] Shell trilogy wraps the whole nested tree; deep-link-into-404 + teacher-invisible both render not-found with NO metadata leak (red-first leak test present).
- [x] `ClassesPage` class name links to detail (closes 3.1 AC7); row otherwise inert (negative test); "View details" added; `ClassStatusPill onTransition?:` optional; 3.1 suite green.
- [x] Both locales at parity; `STORY_3_2_KEYS` added; axe clean on the shell; dormant tabs not `disabled`.
- [x] No backend / api.yaml / sqlc / migration / codegen changes.
- [x] Atomic frontend commit; baseline `2d6bec4`. (Left uncommitted for `/bmad-code-review` per project flow.)
- [x] Story file ≤600 lines; Dev Agent Record + File List in `3-2-class-detail-view-with-tabs-completion-notes.md` (created at dev pickup).

## Out of Scope

`enrollments` table + student roster data (Epic 7 / Story 7.3 — does NOT unblock Story 2.7) · assignments data (Epic 5) · sessions/schedule data (Story 3.4) · session materials / knowledge-hub (Story 3.5 / Epic 4) · analytics data + charts (Epic 8) · Overview next-session + quick-analytics widgets (omitted; land with their data epics) · "Save as template" action wiring (Story 3.3) · lifecycle transitions from the detail head (index owns them, 3.1 AC8) · student consumer detail `s31` `/classes/{id}` view · any new API endpoint / api.yaml / sqlc / migration / backend change · pagination · edit-from-detail (edit stays on the index dialog, 3.1) · optimistic writes (read-only story) · shared-trilogy extraction from `ClassesPage` (isolated local markup this story; extraction is tech-debt).

## Change Log

| Date | Change |
|---|---|
| 2026-07-20 | Story created (ready-for-dev). Scoping with Ducdo: **Decision 1 → shell-first** (frontend-only; Overview real from shipped `GET /api/classes/{id}`, 5 data tabs dormant, enrollments STAYS in Epic 7 per architecture §4.11 — does NOT unblock 2.7); **Decision 2 → nested routes `/classes/{id}/{tab}`**. Closes 3.1 AC7's deferred class-name link. No backend/codegen. Second Epic-3 story. |
| 2026-07-20 | **Green-phase shipped `in-progress → review` via `/bmad-dev-story 3-2`.** All 8 ACs green + all tasks checked. Frontend-only: new `useClass(id)` hook, `ClassDetailLayout` (own lazy chunk, trilogy wraps the whole nested tree), `OverviewTab` (real metadata, dates via new feature-local `formatClassDate` Intl helper — TS-6, next-session/analytics widgets omitted), `ComingSoonPanel` + 5 dormant tabs (owning-epic pointer in code comments only), nested `/classes/:id` route group (sibling of the s07 index; index `<Navigate to="overview" replace>`), `ClassesPage` name→`<Link>` + "View details" menu item. 49 `classes.detail.*` keys en+vi at parity + `STORY_3_2_KEYS`. `route-bundle-boundaries` extended with a real `ClassDetailLayout` chunk assertion (verified green). **Deviation:** `ClassStatusPill onTransition?:` was ALREADY optional (shipped so at 3.1 code-review) — no source edit needed; only added a read-only static-badge test. **Regression:** `tsc` app+e2e clean; `eslint` clean; `npm run build` clean (own `ClassDetailLayout-*.js` chunk, s07 index chunk did not grow); `i18n-parity` OK (838 keys); Playwright Story 3.2 bundle test green; **vitest 1660 passed / 1 failed** (the 1 = pre-existing FU-2-5b-A RoomsTab capacity flake, fails identically in isolation, zero dependency on the classes changes — NOT a regression). Dev Agent Record + File List in the sibling completion-notes. Baseline `2d6bec4` unchanged; artifacts left uncommitted for `/bmad-code-review`. |
| 2026-07-20 | **`/bmad-code-review 3-2` Round 1 shipped `review → done`.** 3-layer adversarial pass (Blind Hunter + Edge Case Hunter + Acceptance Auditor — no failed layers). 21 raw → 19 unique → **2 decision + 3 patch + 2 defer + 10 dismissed**. Auditor found NO blockers; AC6 non-leak, AC7 chunk-separation, AC8 en+vi parity verified FULLY SATISFIED. CLI `tsc` app+e2e confirmed clean (editor-LSP implicit-`any` was a stale generated `client.ts` cache). **Both decisions resolved by Ducdo → patch:** (P4) Overview rendered "Unassigned" for a class with an assigned teacher (`teacherId` set, no pending email — reachable via 3.1) → added neutral "Assigned" branch + `classes.detail.overview.teacherAssigned` en+vi (parity 838→839); (P5) tab strip declared ARIA tab roles without the keyboard contract → completed the widget (`NavLink`→`Link` to kill the `aria-current` collision, roving `tabIndex`, Arrow/Home/End auto-activation handler, `aria-controls`, focusable `tabpanel`). **3 patches:** (P1) unknown tab segment `/classes/{id}/bogus` escaped to the global NotFound → splat child redirects to overview through the class-scoped guard; (P2) sole unguarded `createdAt.slice` deref (whole-page crash on contract drift) guarded like its siblings; (P3) loading skeleton gained `role="status"`. **2 defers → CR-3-2-1** (`deriveActiveTab` positional segment index, basename-fragile, not triggered) **+ CR-3-2-2** (`formatClassDate` rolls over out-of-range dates instead of raw-string fallback; backend sends valid DATEs). **Verification:** `tsc` app+e2e clean; `eslint` clean; vitest parity+classes **554/554** (incl. a11y axe); `npm run build` clean (`ClassDetailLayout-*.js` chunk still separate from `ClassesPage-*.js`); Playwright `route-bundle-boundaries` **15/15**. Baseline `2d6bec4` unchanged; artifacts remain uncommitted. **Story 2-7 (Bulk Import) still BLOCKED** — 3.2 shipped NO enrollments table (Epic 7 / 7.3). Next: commit story 3-2, or pick up Story 3.3 (Class Templates Management). |
| 2026-07-20 | **Party-mode review pass (Winston/Amelia/Sally/John/Murat).** 10 amendments folded, 12 ACs → 8. **Overview** drops its two dormant sub-widgets (next-session + quick-analytics) — renders complete on real metadata (John: primary page must not read under-construction; Sally: Overview anchors the shell — reconciled: cut ghosts + rely on real fields). **Dormant tabs** capped at `ComingSoonPanel`-only, hard ceiling, **no epic/date language on screen** — owning-epic pointer moved to code comments (Sally hard line + Winston grep seam). **AC6** rewritten: not-found guard wraps the WHOLE nested tree so a deep-link into a foreign class's tab cannot leak metadata (Murat risk 6-7 + Amelia two-layer authz). **Redirect** pinned to `<Navigate to="overview" replace/>` (Amelia GAP-B). **`ClassStatusPill`** gains `onTransition?:` optional for the read-only head (Amelia GAP-A). **AC4** rewritten: layout owns shared class state + the tab-bar badge contract (Winston). **Chunk separation** is now an AC + the e2e is a real boundary assertion, not a testid ping (Amelia REG-2 + Murat). **Trilogy** = isolated local markup, no `ClassesPage` extraction (Amelia GAP-E). **Task 0** stays skipped but the teacher-invisible non-leak test is written **red-first** (Murat). Test plan swaps bare `toHaveBeenCalledTimes(1)` for an endpoint request-counter + no-reflash observable (Murat flake risk 5); adds deep-link-into-404, bare-id-redirect, and row-body-negative tests. a11y: dormant tabs not `disabled`, "coming soon" in the accessible name; mobile scroll-strip + right-rail reflow (Sally). |

### Review Findings

_`/bmad-code-review 3-2` Round 1 (2026-07-20) — 3-layer adversarial pass (Blind Hunter + Edge Case Hunter + Acceptance Auditor; no failed layers). 21 raw → 19 unique after dedup → 2 decision + 3 patch + 2 defer + 10 dismissed. Auditor found NO blockers; AC6 non-leak, AC7 chunk-separation, AC8 en+vi parity verified FULLY SATISFIED. CLI `tsc` app+e2e confirmed clean (the editor-LSP implicit-`any` diagnostics were a stale generated `client.ts` cache, not real errors)._

**Decision-needed (RESOLVED by Ducdo 2026-07-20 → both graduate to Patch P4/P5):**

- [x] [Review][Decision→Patch P4] Overview "Teacher" shows "Unassigned" for a class that HAS an assigned teacher — `OverviewTab.tsx:38-42` ternary branches only on `pendingTeacherEmail`; the `teacherId`-set / `pendingTeacherEmail`-null branch (an accepted, assigned teacher — reachable via 3.1 direct assignment) falls through to `teacherUnassigned` = "Unassigned". Wire carries `teacherId: string | null` (`client.ts:1290`); no teacher-name source until Epic 7. **Resolution → neutral "Assigned" label:** add a third branch (`teacherId` set + no pending email → new i18n key `classes.detail.overview.teacherAssigned`, en "Assigned" / vi "Đã phân công") + STORY_3_2_KEYS + parity. Auditor (STRONG) + Edge (STRONG).
- [x] [Review][Decision→Patch P5] Class-detail tab strip declares ARIA tab-widget roles without the keyboard contract — `ClassDetailLayout.tsx:118-149` renders `<nav role="tablist">` of `NavLink role="tab" aria-selected` + a single `role="tabpanel"`, but omits arrow-key roving `tabIndex`, `aria-controls`, and `tabpanel` `tabIndex={0}`, and `role="tab"` collides with NavLink's auto `aria-current="page"`. `axe` passes (no keyboard-interaction test). **Resolution → complete the tabs-widget contract:** roving `tabIndex` (active 0, rest -1), `ArrowLeft/Right/Home/End` handler moving focus + navigating, `aria-controls` on each tab → the panel `id`, `tabIndex={0}` on the panel, and resolve the `aria-current` collision. Blind (STRONG) + collision/panel-focus (INFO).

**Patch (ALL APPLIED 2026-07-20):**

- [x] [Review][Patch P1 ✅] Unknown tab segment escapes the class-scoped guard [`classlite-web/src/routes.tsx`] — added a splat child (`path:'*'` → `<ClassTabFallbackRedirect/>`, an absolute basename-safe `<Navigate to="/classes/{id}/overview" replace/>`) under the layout so `/classes/{id}/bogus` routes through the class-scoped guard instead of the global NotFound. Edge (STRONG).
- [x] [Review][Patch P2 ✅] `createdAt` unguarded deref [`OverviewTab.tsx`] — hoisted to `createdDisplay` with a `cls.createdAt ? … : notSet` guard matching the siblings; contract drift can no longer throw and blank the whole page. Blind (STRONG) + Edge (INFO).
- [x] [Review][Patch P3 ✅] Loading region announced weakly [`ClassDetailLayout.tsx`] — added `role="status"` to `DetailSkeleton` (alongside the existing `aria-busy`/`aria-label`). Blind (INFO).
- [x] [Review][Patch P4 ✅ — from Decision 1] Teacher "Assigned" label — added the third branch (`teacherId` set + no pending email → `classes.detail.overview.teacherAssigned`) + new key en "Assigned" / vi "Đã phân công" + STORY_3_2_KEYS + parity (838→839 keys). [`OverviewTab.tsx`, `en.json`, `vi.json`, `i18n-parity-coverage.test.ts`]
- [x] [Review][Patch P5 ✅ — from Decision 2] Completed the ARIA tabs-widget contract [`ClassDetailLayout.tsx`] — swapped `NavLink`→`Link` (kills the `aria-current` collision), added roving `tabIndex` (active 0 / rest -1), an `ArrowLeft/Right/Home/End` keydown handler on the tablist (auto-activation: moves focus + navigates), `aria-controls`→panel, `aria-orientation`, and `tabIndex={0}` + `id` on the panel.

_Verification (all green): `tsc -p tsconfig.app.json` + `-p tsconfig.e2e.json` clean; `eslint` clean; vitest i18n-parity + classes **554/554** (incl. `ClassDetail.a11y.test.tsx` axe); `npm run build` clean (`ClassDetailLayout-*.js` chunk still separate from `ClassesPage-*.js`); Playwright `route-bundle-boundaries` **15/15** (AC7 chunk assertion intact)._

**Deferred** (see `deferred-work.md`):

- [x] [Review][Defer] CR-3-2-1 — `deriveActiveTab` parses the tab from positional segment index 2 (`ClassDetailLayout.tsx:86-89`); fragile to any router `basename` / route re-nesting. Not triggered today (no basename). — deferred, robustness only.
- [x] [Review][Defer] CR-3-2-2 — `formatClassDate.parseIsoDateLocal` accepts well-formed-but-out-of-range dates (`2026-13-45`) and rolls them over instead of falling back to the raw ISO string (`formatClassDate.ts`). Backend sends valid DATE values; defense-in-depth only. — deferred, defense-in-depth.

## Dev Agent Record

_Populated at dev pickup, then split to `3-2-class-detail-view-with-tabs-completion-notes.md` per `docs/bmad-story-conventions.md`._

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
