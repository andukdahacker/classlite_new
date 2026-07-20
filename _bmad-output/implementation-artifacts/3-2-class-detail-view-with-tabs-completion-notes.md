# Story 3-2: Completion Notes

_Implementation record for [`3-2-class-detail-view-with-tabs.md`](./3-2-class-detail-view-with-tabs.md). Status: review._

## Dev Agent Record

### Agent Model Used

claude-opus-4-8[1m] (Amelia / bmad-dev-story)

### Debug Log

- **ClassStatusPill `onTransition?:` already optional.** AC5 / Task 5 asked to "make `onTransition?:` optional" on the shipped pill, but 3.1's code-review round had already shipped it optional (`onTransition?: (next) => void`, `interactive = Boolean(onTransition) && …`). No source edit to `ClassStatusPill.tsx` was needed — I only added a read-only static-badge test asserting a non-terminal status with no `onTransition` renders a plain `<span>` (no trigger). Documented as a deviation in the Change Log.
- **No shared i18n `t('date', …)` formatter exists.** The project-context TS-6 example (`t('date', { val })`) is aspirational — `lib/i18n.ts` configures no `date` interpolation formatter. The established precedent is the settings 2-5b local `formatDateSingle`/`formatDateRange` (Intl, local-midnight parse). I created a feature-local `lib/formatClassDate.ts` mirroring it (FW-7/TS-7 keep it feature-scoped; a shared class/settings date-helper extraction is tech-debt FU-3-2-x).
- **Overview teacher display.** The `Class` wire carries `teacherId` (uuid) + `pendingTeacherEmail` only — no resolved-teacher display name (that join lands in Epic 7 / People). Overview renders the two honestly-renderable states: pending invite (email) else "Unassigned". A resolved-teacher name is out of scope for the shell.
- **axe `definition-list` fix.** First axe pass failed: the description `Field` was wrapped in an extra `<div className="sm:col-span-2">`, putting a `div > div` directly under `<dl>` (invalid). Refactored `Field` to accept a `className` so its own `<div>` (which holds `<dt>/<dd>`) carries the span — every `<dl>` direct child is now a valid `div > dt,dd` group. Axe clean.
- **LSP vs CLI tsc.** The editor LSP served a stale project state throughout (could not resolve `@/` aliases, treated the generated `client.ts` `Class` type as `any`/`string`). The CLI `tsc --noEmit -p tsconfig.app.json` + `-p tsconfig.e2e.json` are authoritative and were both clean — same stale-client-cache footgun the 3.1 review recorded.

### Completion Notes

Shipped the s08/s09 tabbed detail shell, frontend-only, zero backend/api.yaml/sqlc/migration/codegen (WF-1/WF-3 correctly did not trigger — no `.sql` / `api.yaml` touched).

- **AC1** — `ClassDetailLayout` renders the detail-head + six-tab strip (Overview·Students·Assignments·Sessions·Materials·Analytics) in order. Nested `/classes/:id` layout route with 6 children; bare `:id` index redirects to `overview` via `<Navigate to="overview" replace />` (element redirect, FW-1 clean). Active tab derived from the URL (`useLocation`, no state/`useEffect` — FW-4). Deep-linkable + refresh-safe.
- **AC2** — `OverviewTab` reads the SAME `classesKeys.detail(id)` cache via `useClass(id)` (no 2nd fetch), renders every shipped field; dates via `formatClassDate` (TS-6, raw ISO never in render). Next-session + quick-analytics widgets omitted (asserted absent). Right rail = info card + dashed dormant Actions card (Save-as-template affordance absent).
- **AC3** — 5 dormant tabs render `<ComingSoonPanel>` and nothing else (no fetch/query/data-stub/interactive control). Benefit copy, NO epic/roadmap/date words on screen (negative-asserted); owning-epic pointer in a code comment per tab. Distinct `data-testid` each; decorative `aria-hidden` mark only.
- **AC4** — Layout owns the shared class read + detail-head + tab strip + the tab-badge slot convention. Dormant tabs own no query. Verified: switching tabs never refetches Overview (endpoint request-counter ≤ 1 + no skeleton reflash).
- **AC5** — s07 `ClassesPage` class name is now `<Link to="/classes/{id}/overview">` (closes 3.1 AC7); row otherwise inert (negative test: clicking the row body does not navigate); "View details" menu item added; pill stays interactive for the row caller (3.1 suite green).
- **AC6** — trilogy (Loading skeleton / Not-found / Error+retry) wraps the WHOLE nested tree, resolving before `<Outlet />`. Non-leak: identical not-found surface for absent + teacher-invisible 404; deep-link straight into a foreign class's nested tab hits the same guard with name/metadata ABSENT (red-first leak tests present). `useClass` surfaces `ApiError` unchanged so the layout branches `status === 404`.
- **AC7** — `ClassDetailLayout` deep-imported → own `ClassDetailLayout-*.js` chunk; s07 `ClassesPage` chunk did NOT grow (verified in `dist/`: detail chunk carries `class-detail-layout` testid, index chunk does not). `route-bundle-boundaries.spec.ts` extended with the real chunk assertion — Playwright test green.
- **AC8** — 49 `classes.detail.*` keys authored in en.json + vi.json at parity; `STORY_3_2_KEYS` closed literal + interpolation-parity + `classes.detail.` prefix ratchet added. Dormant tabs are not `disabled`; "coming soon" lives in each tab's accessible name.

**Task 0 (ATDD)** — skipped per the story-author-permitted path (frontend shell, no new tenant table/backend/authz, no risk ≥6). The AC6 teacher-invisible + deep-link-into-404 non-leak tests were written to assert absence of name/metadata (the security-adjacent behavior Murat flagged), living in the component suite.

**Verification:** `tsc` app+e2e clean · `eslint` clean · `npm run build` clean · `i18n-parity` OK (838 keys) · Playwright Story 3.2 bundle test green · classes vitest 41/41 · full vitest **1660 passed / 1 failed** (the 1 = pre-existing **FU-2-5b-A** RoomsTab capacity flake — fails identically in isolation, 1 failed/12 passed, zero dependency on this story's diff; NOT a regression).

### Implementation Plan (summary)

Executed fastest-feedback order: 7 (i18n keys + STORY_3_2_KEYS) → 2 (`useClass`) → 5 (`ComingSoonPanel` + 5 dormant tabs) → 4 (`OverviewTab` + `formatClassDate`) → 3 (`ClassDetailLayout` + trilogy + tab strip) → 1 (nested routes + `Navigate` redirect + e2e chunk assertion) → 6 (`ClassesPage` link-up + `ClassStatusPill` read-only test) → 8 (layout/a11y test suites + MSW `/api/classes/:id` handlers + full regression).

## File List

### Added

- `classlite-web/src/features/classes/api/useClass.ts` — single-class detail hook (`classesKeys.detail(id)`, surfaces `ApiError` unchanged)
- `classlite-web/src/features/classes/ClassDetailLayout.tsx` — detail-head + tab strip + trilogy (deep-import chunk target)
- `classlite-web/src/features/classes/lib/formatClassDate.ts` — feature-local Intl date formatter (TS-6)
- `classlite-web/src/features/classes/components/ComingSoonPanel.tsx` — shared dormant-tab panel
- `classlite-web/src/features/classes/tabs/OverviewTab.tsx` — real-metadata Overview + right rail
- `classlite-web/src/features/classes/tabs/StudentsTab.tsx` — dormant (epic 7.3 pointer)
- `classlite-web/src/features/classes/tabs/AssignmentsTab.tsx` — dormant (epic 5 pointer)
- `classlite-web/src/features/classes/tabs/SessionsTab.tsx` — dormant (epic 3.4 pointer)
- `classlite-web/src/features/classes/tabs/MaterialsTab.tsx` — dormant (epic 3.5/4 pointer)
- `classlite-web/src/features/classes/tabs/AnalyticsTab.tsx` — dormant (epic 8 pointer)
- `classlite-web/src/features/classes/__tests__/ClassDetailLayout.test.tsx` — trilogy, non-leak, deep-link-404, redirect, caching, Overview, dormant-tab suite
- `classlite-web/src/features/classes/__tests__/ClassDetail.a11y.test.tsx` — axe + tab-strip semantics

### Modified

- `classlite-web/src/routes.tsx` — added the `/classes/:id` sibling route group (RouteRoleGate → `ClassDetailLayout` → 6 tab children + index `<Navigate>`); imported `Navigate`
- `classlite-web/src/features/classes/ClassesPage.tsx` — class name → `<Link>` to detail overview; added "View details" dropdown item; row stays inert
- `classlite-web/src/features/classes/api/__tests__/handlers.ts` — added `GET /api/classes/:id` fixtures + happy/404/500 handlers
- `classlite-web/src/features/classes/components/__tests__/ClassStatusPill.test.tsx` — added read-only static-badge test (AC5)
- `classlite-web/src/features/classes/__tests__/ClassesPage.test.tsx` — added detail link-up + row-inert negative tests (AC5)
- `classlite-web/src/lib/test/__tests__/i18n-parity-coverage.test.ts` — added `STORY_3_2_KEYS` block (parity + interpolation + prefix ratchet)
- `classlite-web/src/locales/en.json` — +49 `classes.detail.*` keys
- `classlite-web/src/locales/vi.json` — +49 `classes.detail.*` keys
- `classlite-web/e2e/route-bundle-boundaries.spec.ts` — added the Story 3.2 `ClassDetailLayout` chunk-boundary assertion

### Deleted

- none

## Party-Mode Review Appendix

_None yet — populated at `/bmad-code-review` if applicable._
