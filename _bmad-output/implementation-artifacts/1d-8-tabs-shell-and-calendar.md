---
baseline_commit: a90010732057148b3c4e930c7c7b234aa4686378
---

# Story 1d-8 (legacy): Tabs Shell, Schedule Calendar & Calendar Library Decision

Status: deferred-to-feature-epic

> **PATH B RE-SCOPE (2026-06-07):** After party-mode review (Mary + Winston: calendar locks 6+ months of UX on a 1-day spike; Amelia: XL not L; Winston: needs RRULE-fit + 2-day timebox), this story is deferred. Components ship with Epic 3 where the schedule workspace actually lives:
> - `ClassDetailTabsShell` (6 tabs per IA) → **Epic 3** Story 3.2 (class detail view with tabs)
> - `SessionScheduleCalendar` + calendar library decision spike (revised: **2-day timebox**, RRULE-fit dimension added, axe baseline test on candidate prototype) → **Epic 3** Story 3.4 (schedule workspace and session management)
> - `ScheduleEditModal` + `RecurrenceScopeConfirm` → **Epic 3** Story 3.4/3.5 (session creation/edit)
>
> Note: This file is kept as an input artifact. The calendar library decision contract (with Winston's RRULE-fit dimension and Murat's axe-on-candidate requirement) is reusable scope for Epic 3 Story 3.4. The 1-day spike timebox is widened to 2 days per Winston's recommendation when the work transitions.

<!-- Validation is optional. Run `validate-create-story` for a quality second pass before `dev-story`. -->

## Story

As a frontend developer,
I want the multi-tab class-detail shell (`ClassDetailTabsShell` — 6 tabs), the schedule calendar workspace (`SessionScheduleCalendar` — Day/Week/Month + mini-month nav), the schedule edit modal (`ScheduleEditModal`) and its `RecurrenceScopeConfirm` sub-component built and storied — including a documented timeboxed spike on the calendar implementation strategy,
so that Epic 3 (class management and scheduling) consumes finished shells rather than choosing a calendar library mid-feature.

## Acceptance Criteria (BDD)

> **Architectural spike risk explicitly called out.** The calendar library decision in AC1 is a real architectural risk — a wrong library choice locks downstream Epic 3 (Story 3-4 schedule workspace) and the mobile schedule variant. The spike timebox is 1 working day with a documented decision artifact (`classlite-web/docs/calendar-library-decision.md`) before AC2+ proceed. **No risk-score ≥6 codes from the handoff risk register apply** — calendar rendering is not security-coupled and does not touch tenant boundaries — but the calendar-library spike is itself a flagged architectural risk for this story.
>
> WF-8 ATDD red-tests are NOT mandatory. The Vitest + axe + focus-trap assertions described below are written inline by the dev using the patterns from `test-design-qa.md`, TEST-UX-2, and TEST-FE-5.

### AC1: Calendar library decision spike (timeboxed 1 working day)

**Given** the `SessionScheduleCalendar` component must support Day/Week/Month views with a mini-month nav, theming with ClassLite design tokens, Vietnamese locale, accessibility baseline, and a mobile-feasibility path,
**When** the dev starts Story 1d-8,
**Then** the first AC discharge is a 1-working-day timeboxed spike comparing the candidate calendar implementations:

1. **`react-big-calendar`** — mature, opinionated, harder to deep-theme; battle-tested but ships its own CSS that fights design tokens
2. **Hand-rolled Day/Week/Month grid** — full theming control, no external dep, but Day/Week hour-grid + recurrence rendering is meaningful code volume
3. **`FullCalendar`** — premium plugins behind a license for advanced features; v6 has reasonable theming hooks; React wrapper is officially maintained
4. **Alternative (e.g., `@schedule-x/react`, `react-calendar` + custom hour grid)** — only if the spike surfaces a clear advantage

**And** the spike produces `classlite-web/docs/calendar-library-decision.md` covering each of the following dimensions per candidate:

- **Theming fit with design tokens** — can the library accept `--cl-ink`, `--cl-paper`, `--cl-accent` via CSS variables without ejecting? Does it need a CSS-override fight?
- **Vietnamese locale support** — does it ship `vi` date formatting natively, or does it need a custom locale adapter? Are day-of-week labels translatable via i18next, or hardcoded?
- **Accessibility baseline** — keyboard nav (arrow keys, Enter, Escape), `aria-label` on cells, focus management between views, axe-core passing out of the box?
- **Mobile variant feasibility** — does the library expose a layout strategy that adapts to 390px viewports, or is mobile a separate component?
- **Maintenance burden** — active maintenance? bundle size? React 19 compatibility? Rolldown compatibility (per Vite 8 stack)?
- **Decision and justification** — one of the candidates is selected with a written rationale; the other candidates have a 2–3 line "why not" paragraph

**And** the decision document concludes with a section "Implementation plan for AC2–AC6" mapping the chosen library's API surface to the props contract defined in AC3.

**And** if the spike surfaces a blocker that prevents any library from meeting the contract (e.g., none support `aria-grid` semantics for the week view AND `vi` locale AND token theming within 5 days of additional work), the spike documents the fallback: ship `SessionScheduleCalendar` as a hand-rolled grid scoped to the MVP feature set (Day/Week/Month read-only render + session click + slot click; no drag-resize, no drag-move) and accept that downstream interaction features take longer in Epic 3.

_Spike timebox: 1 working day. Do not exceed without explicit re-scope._

### AC2: `ClassDetailTabsShell` — 6 tabs per IA

**Given** the `ClassDetailTabsShell` component in `src/components/domain/ClassDetailTabsShell.tsx`,
**When** rendered,
**Then** the shell composes the shadcn `Tabs` primitive (Story 1d-2) with exactly six tab slots in this order, matching the IA for `s08` / `s09`:

1. **Overview** — class summary, KPIs, day-glance widgets
2. **Students** — roster table (consumes Story 1d-6 `DataListTable`)
3. **Assignments** — assignment list (consumes Story 1d-6)
4. **Sessions** — sessions table or mini-calendar embed
5. **Materials** — knowledge-hub-linked materials
6. **Analytics** — class-scoped analytics charts

**And** the shell owns NO tab payload data — each tab accepts a `children` slot that the Epic 3 page renders per-tab. Per-tab data fetching (TanStack Query) and per-tab loading/empty/error states ship with Epic 3 stories.

**And** the props are:
- `activeTab: TabId` — controlled
- `onTabChange(tab: TabId): void`
- `tabs: Array<{ id: TabId; label: string; badgeCount?: number; children: React.ReactNode }>` — typed `TabId` is the union of the six tab IDs
- `headerSlot?: React.ReactNode` — accepts a `DetailHead` (from Story 1d-4) above the tab strip

**And** the tab labels resolve via i18n keys (`t('class.detail.tabs.overview')`, etc.) — never hardcoded English.

**And** Storybook stories: `Default` (Overview active), `WithBadgeCounts` (Assignments shows "3 due", Sessions shows "2 today"), `EmptyTab` (Sessions tab with empty children → consumer renders `EmptyState`).

### AC3: `SessionScheduleCalendar` — three view modes + mini-month nav

**Given** the calendar-library decision from AC1 is documented and merged,
**When** building `src/components/domain/SessionScheduleCalendar.tsx`,
**Then** the component renders three view modes — `Day`, `Week`, `Month` — switchable via a `ViewToggle` (from `Story 1d-4`'s inventory).

**And** a `MiniMonthNavigator` (also from Story 1d-4's inventory) renders in a side panel for date navigation across view modes.

**And** the props contract is:
- `sessions: SessionPayload[]` — pre-fetched session data; the component does NOT own data fetching (FW-1 — consumers fetch via TanStack Query, the route loader prefetches into Query cache, and the page passes `sessions` to the calendar)
- `view: 'day' | 'week' | 'month'` — controlled
- `onViewChange(view): void`
- `focusedDate: string` (ISO 8601 date) — controlled; the mini-month nav binds to this
- `onFocusedDateChange(date: string): void`
- `onSessionClick?(session: SessionPayload): void` — emitted when a rendered session block is clicked
- `onSlotClick?(slot: { start: string; end: string }): void` — emitted when an empty calendar slot is clicked (for create-session UX in Epic 3)
- `loading?: boolean` and `error?: Error | null` — drive the Loading/Error stories

**And** the calendar renders read-only by default — drag-resize, drag-move, and inline edit are explicitly deferred to Epic 3 Story 3-4. Click handlers expose the hooks for downstream interaction.

**And** the calendar uses i18n date formatters (`t('date', { val })` and `t('time', { val })`) for every rendered date and time string — NEVER `new Date(...).toLocaleDateString()` per TS-6. The Vietnamese locale switch from Storybook (Story 1d-1 AC2) must render Vietnamese day-of-week labels and Vietnamese month names correctly.

### AC4: `ScheduleEditModal` composing the `FormModal` pattern from 1d-7

**Given** the `ScheduleEditModal` component in `src/components/domain/ScheduleEditModal.tsx`,
**When** rendered,
**Then** it composes the `FormModal` pattern from Story 1d-7 with these fields (RHF + `zodResolver` per FW-8 and TS-2):
- `title: string` — required
- `date: string` (ISO 8601 date) — required, uses a date picker bound to the shadcn `Calendar` primitive
- `startTime: string` and `endTime: string` — required; `endTime > startTime` validated by the Zod schema
- `recurrence: RecurrenceConfig | null` — optional; recurrence editor is a sub-component (`RecurrenceEditor`) showing weekday picker + "every N weeks" + end-date
- `roomId: string | null` — optional
- `teacherId: string | null` — optional, composed via the `AssignChip` from Story 1d-7
- `studentIds: string[]` — optional; multi-select

**And** the Zod schema defines the form shape per TS-2; the form uses `useForm` + `zodResolver(scheduleEditSchema)` + `type ScheduleEditValues = z.infer<typeof scheduleEditSchema>` — never derived from generated API types.

**And** the modal's submit behavior emits `onSubmit(values: ScheduleEditValues): void | Promise<void>` — the actual mutation (POST to `/api/v1/sessions` or PATCH) is wired by the Epic 3 consuming story per FW-2 (optimistic update triple).

**And** Storybook stories: `Default` (new session), `EditExisting` (pre-filled with existing session), `WithRecurrence` (recurrence editor active), `Error` (Zod validation errors visible — composing `FormValidationError` from Story 1d-5).

### AC5: `RecurrenceScopeConfirm` sub-component for delete-from-recurrence flows

**Given** the `RecurrenceScopeConfirm` component in `src/components/domain/RecurrenceScopeConfirm.tsx`,
**When** a user attempts to delete or modify a session that belongs to a recurrence series,
**Then** the component renders as a confirmation step (composes `ConfirmationModal` from Story 1d-7) presenting three radio options:
1. **This session only** — affects only the current occurrence
2. **This and following sessions** — affects the current and all future occurrences in the series
3. **All sessions in series** — affects every occurrence past and future

**And** the radio group is keyboard-navigable via `Arrow Up/Down` per WAI-ARIA radiogroup pattern, and the selected scope is announced via `aria-describedby` text explaining the consequence (e.g., "All 12 sessions will be deleted").

**And** the props are:
- `open: boolean`, `onOpenChange(open): void`
- `recurrenceSummary: string` — e.g., "Recurring every Wed and Sat, ends 2026-12-15"
- `affectedCounts: { thisOnly: number; future: number; all: number }` — used in the consequence-explainer text
- `onConfirm(scope: 'this' | 'future' | 'all'): void`
- `action: 'delete' | 'modify'` — drives the modal title and confirm-button copy

**And** the component is reusable for both delete-from-recurrence and modify-from-recurrence flows in Epic 3 — the action prop distinguishes the two.

**And** Storybook stories: `DeleteScope`, `ModifyScope`, `LongRecurrenceSeries` (24+ future occurrences, verifies the consequence text wraps without overflow).

### AC6: Three-state coverage (`Default`, `Loading`, `Empty`, `Error`) for the calendar

**Given** `SessionScheduleCalendar` is a data-rendering component,
**When** the Storybook stories render,
**Then** four state exports exist:
- **`Default`** — populated week with realistic session blocks from `src/test/fixtures/sessions.ts`
- **`Loading`** — skeleton calendar shell: the view chrome (header, day labels, hour rows) renders solid; the session blocks are skeleton rectangles at realistic positions and durations (UX-DR24 shape-mirroring). Never a centered spinner
- **`Empty`** — composes `EmptyState` (Story 1d-5) overlaid on the empty calendar with copy `t('schedule.empty.thisWeek')` and an action `t('schedule.empty.createSession')` calling `onSlotClick`
- **`Error`** — composes `FormValidationError` (Story 1d-5) banner with i18n-keyed message and retry action; tested with MSW `HttpResponse.error()` per TEST-FE-2

**And** the `Loading` skeleton respects `prefers-reduced-motion` — the pulse animation disables when the user has reduced motion enabled.

### AC7: Calendar keyboard navigation per WAI-ARIA date-picker pattern

**Given** the `SessionScheduleCalendar` and its `MiniMonthNavigator` side panel,
**When** the user interacts via keyboard,
**Then** the calendar follows the standard WAI-ARIA date-picker pattern:
- `Arrow Up/Down/Left/Right` — move focused date by one day (left/right) or one week (up/down) in Month and Week views; by one hour (up/down) and one day (left/right) in Day view
- `Page Up/Page Down` — move by one month (Month view) or one week (Week view)
- `Home/End` — jump to start/end of week
- `Enter` / `Space` on a session block — emit `onSessionClick`
- `Enter` / `Space` on an empty slot — emit `onSlotClick`
- `Tab` enters the calendar at the focused date; `Shift+Tab` exits
- The focused cell carries `aria-selected="true"` and `tabIndex="0"`; all other cells carry `tabIndex="-1"` (roving tabindex pattern)

**And** the `ScheduleEditModal` keyboard handling:
- `Escape` closes the modal and returns focus to the trigger (per Story 1d-7 AC2 focus-trap test reused here)
- `Enter` inside a focused input submits the form (RHF default)
- `Tab` cycles inside the modal only

**And** axe-core runs zero violations across every story (`SessionScheduleCalendar` Default/Loading/Empty/Error, `ClassDetailTabsShell` Default/WithBadgeCounts/EmptyTab, `ScheduleEditModal` Default/EditExisting/WithRecurrence/Error, `RecurrenceScopeConfirm` DeleteScope/ModifyScope/LongRecurrenceSeries).

### AC8: i18n co-primary coverage + downstream consumption contract

**Given** every story in this 1d-8 set,
**When** the locale toolbar (Story 1d-1 AC2) switches between `en` and `vi`,
**Then** the calendar renders correctly under both locales:
- Day-of-week labels are translated (Mon/Tue/... → T2/T3/... per Vietnamese convention; the i18next-driven date formatter handles this)
- Month names are translated
- Session block content respects the `t()` formatter for time strings
- The mini-month nav month/year header is locale-aware
- The `ScheduleEditModal` field labels, error messages, and confirm-button copy resolve via i18n keys
- `aria-label` strings (e.g., "Wednesday, March 12, 2026" on focused cells) are translated to Vietnamese under `vi`

**And** the `ClassDetailTabsShell` tab labels render correctly in both locales — Vietnamese tab labels are typically longer; the dev verifies the tab strip does not overflow on the smallest desktop breakpoint.

**And** the downstream Epic 3 consumption contract is documented in `classlite-web/docs/calendar-library-decision.md` (cross-referenced) so the Story 3-4 dev knows: (a) the calendar consumes `sessions: SessionPayload[]` from a route loader prefetch (FW-1), (b) mutation interactions wire per FW-2 optimistic triple, (c) the calendar library choice is not their decision — only the interaction wiring is.

## Tasks / Subtasks

- [ ] **Task 1 (AC1):** Run the calendar library decision spike (1 working day timebox). Compare `react-big-calendar`, hand-rolled, `FullCalendar`, and any other candidate that surfaces. Document the decision in `classlite-web/docs/calendar-library-decision.md` covering all six dimensions from AC1. Mark the decision as merged before proceeding to Task 2.
- [ ] **Task 2 (AC2):** Build `src/components/domain/ClassDetailTabsShell.tsx` composing the shadcn `Tabs` primitive with the six-tab IA. Author `ClassDetailTabsShell.stories.tsx` with `Default`, `WithBadgeCounts`, `EmptyTab` exports.
- [ ] **Task 3 (AC3):** Build `src/components/domain/SessionScheduleCalendar.tsx` per the AC1 decision. Wire the three view modes + mini-month nav. Verify i18n date formatters are used everywhere — no `new Date().toLocaleDateString()` survives the lint rule. Author `SessionScheduleCalendar.stories.tsx` with the four state exports.
- [ ] **Task 4 (AC4):** Build `src/components/domain/ScheduleEditModal.tsx` composing the `FormModal` pattern from Story 1d-7. Define the Zod schema for the form. Wire `RecurrenceEditor` as a sub-component. Author `ScheduleEditModal.stories.tsx` with the four exports.
- [ ] **Task 5 (AC5):** Build `src/components/domain/RecurrenceScopeConfirm.tsx` composing the `ConfirmationModal` pattern from Story 1d-7 with the three-radio scope picker. Author `RecurrenceScopeConfirm.stories.tsx` with `DeleteScope`, `ModifyScope`, `LongRecurrenceSeries` exports.
- [ ] **Task 6 (AC6):** Verify the four state exports for `SessionScheduleCalendar`. Confirm the skeleton respects `prefers-reduced-motion`. Confirm the `Empty` overlay composes `EmptyState` from 1d-5.
- [ ] **Task 7 (AC7):** Implement and test the calendar keyboard navigation per WAI-ARIA date-picker pattern. Add a Vitest test verifying the roving tabindex behavior. Run axe-core on every story — expect zero violations.
- [ ] **Task 8 (AC8):** Toggle the Storybook locale to `vi` for every story in this set and verify Vietnamese day/month names + tab labels + form labels render correctly. Cross-reference the calendar-library decision doc to `classlite-web/docs/storybook-conventions.md` and link the downstream-consumption contract for Epic 3.

## Dev Notes

- **Stack reminders:**
  - React 19 — refs are plain props on every component. If the chosen calendar library uses `forwardRef` internally, wrap it in a thin component that exposes ref as a plain prop. No `"use client"` directives.
  - Vite 8 (Rolldown) — verify the chosen calendar library is Rolldown-compatible (no Rollup-specific plugin reliance). This is part of the AC1 spike's "Rolldown compatibility" check, cross-referenced from the Story 1d-1 Rolldown spike notes.
  - TypeScript strict — `SessionScheduleCalendar` is generic over `SessionPayload` shape; the Epic 3 story's session type is the canonical one. No `any` in the calendar API.
  - Tailwind utility classes only — if the chosen calendar library ships CSS, the spike documents the override strategy (CSS variables vs. utility classes vs. ejecting styles).
  - shadcn `Tabs`, `Dialog`, `Calendar`, `Popover`, `Select`, `RadioGroup`, `Checkbox`, `ScrollArea`, `ToggleGroup` primitives from Story 1d-2 are the substrate for the non-calendar pieces.

- **Calendar library decision spike — risks considered:**
  - `react-big-calendar`: mature but CSS-heavy; theming with our token palette requires CSS variable overrides + potentially ejecting its style sheet. Vietnamese locale via `date-fns/locale/vi` and `dateFnsLocalizer` is documented. Accessibility has improved in recent versions but is not best-in-class. Mobile is a separate concern (its responsive mode is limited).
  - Hand-rolled: full theming control, exact a11y story, no external dep — but Day/Week hour-grid + recurrence layout + mini-month nav is meaningful code (estimated 3–5 dev-days beyond the spike). Mobile feasibility is best because we own the layout.
  - `FullCalendar`: premium plugin licensing for some advanced features (e.g., resource timeline); we likely don't need those. Theming is reasonable via CSS variables. Bundle size is larger. Active maintenance.
  - The spike picks one and writes the rationale; AC1 explicitly enumerates the six dimensions to compare against so the decision is reproducible.

- **One mock seam per side (TEST-FE-1):** MSW at the HTTP boundary. `SessionScheduleCalendar` does not call APIs itself — the consuming Epic 3 page does. Stories that demonstrate the Loading and Error states wire MSW handlers for the page-level call; the calendar receives `loading: true` or `error: Error` props.

- **FW-1 route loader prefetches into Query:** The Epic 3 schedule page's route loader runs `await queryClient.prefetchQuery(sessionsQuery({ from, to }))`; the page reads via `useSuspenseQuery`; the page passes `sessions` and `loading` props to `SessionScheduleCalendar`. This story documents the contract; the loader ships per Epic 3 Story 3-4.

- **FW-2 optimistic triple (binding for downstream):** Epic 3's session create/edit/delete mutations MUST use the full `onMutate` / `onError` / `onSettled` triple per FW-2. This story's `ScheduleEditModal` emits `onSubmit(values)` only — the mutation lives in Epic 3. Documented here for the downstream dev.

- **FW-3 staleTime defaults:** Session data may benefit from a shorter staleTime (sessions change frequently during operating hours). Epic 3's `sessionsQuery` can override the project default (30s) with a justifying comment per FW-3. Not this story's concern.

- **FW-8 RHF + Zod (binding):** `ScheduleEditModal` uses RHF + `zodResolver` per FW-8 — this is NOT the writing-editor exemption. The writing editor exemption (Story 1d-7 AC5) does NOT apply here. The form fields are standard inputs; submit validation is standard Zod.

- **TS-2 Zod schema → form type pattern (binding):** `ScheduleEditValues = z.infer<typeof scheduleEditSchema>`. Never derive from the generated `SessionDTO`. The wire format and form shape differ (the form has draft state, partial values, and a `null`-vs-undefined-vs-missing distinction that the wire format doesn't represent).

- **TS-6 dates (binding):** Every date and time string flows through the i18n formatter. The calendar library wrapper layer (built in AC3) MUST translate calendar-library callbacks (which often return JS `Date` objects) back to ISO strings before they leave the component boundary. Internal-to-the-calendar `Date` usage is fine (the library needs it); external API is ISO strings only.

- **UX-DR24 skeletons:** The calendar's `Loading` state mirrors the calendar shell shape — view chrome solid, session blocks as skeleton rectangles at realistic positions. Never a centered spinner. The `prefers-reduced-motion` check disables the pulse animation.

- **WF-3 codegen note:** This story does not touch `api.yaml` or `.sql` files. `codegen.sh` does NOT need to run. (Epic 3 Story 3-4 will run codegen for the session endpoints; that's not this story's concern.)

- **WF-7 service boundary:** Imports stay within `classlite-web/` — never reach into `../../classlite-api/`. The `SessionPayload` type is hand-modeled to match the OpenAPI-generated `SessionDTO` for now; when Epic 3 generates the real type, this story's `SessionPayload` placeholder is replaced.

- **FW-7 component placement:** All four components live in `src/components/domain/` — they're business-aware (sessions, classes, recurrence) but reusable across features (schedule page, class-detail Sessions tab, mobile schedule variant). Never in `ui/`.

- **Role-rendering rule (UX-3):** None of these components branch on role internally. The `ClassDetailTabsShell` shows all 6 tabs regardless of role; if a tab is role-gated (e.g., Analytics for students), the gate lives at the consuming page level via `<RoleGate role="teacher">` around the tab's children.

- **i18n is co-primary (UX-2, NFR-1, TEST-UX-1):** Vietnamese strings are typically 15–30% longer than English. The dev verifies tab strip overflow, calendar day-label width, mini-month nav cell width, and modal field label alignment all hold under `vi`.

- **TEST-UX-2 focus traps:** `ScheduleEditModal` and `RecurrenceScopeConfirm` reuse the shared focus-trap test utility from Story 1d-7. Focus returns to the trigger on close.

- **TEST-FE-5 axe-core:** Every story passes zero axe violations. The calendar's roving tabindex pattern is a common a11y trap — the test explicitly verifies that only the focused cell carries `tabIndex="0"`.

## Definition of Done

- [ ] All 8 ACs discharged.
- [ ] `classlite-web/docs/calendar-library-decision.md` exists, is merged, and documents the library choice with rationale across all six dimensions.
- [ ] `ClassDetailTabsShell`, `SessionScheduleCalendar`, `ScheduleEditModal`, and `RecurrenceScopeConfirm` ship with co-located `*.stories.tsx` files (FW-7).
- [ ] All stories pass `npm run storybook:test` with zero axe violations.
- [ ] Calendar keyboard navigation follows the WAI-ARIA date-picker pattern, verified by a Vitest test for the roving tabindex behavior.
- [ ] Focus-trap tests for `ScheduleEditModal` and `RecurrenceScopeConfirm` pass via `npm test`, reusing the shared utility from Story 1d-7.
- [ ] `tsc --noEmit` is clean against the strict-mode config.
- [ ] Both `en` and `vi` locales render every story without layout breakage; Vietnamese day-of-week and month names render correctly.
- [ ] The calendar-library decision doc is linked from `classlite-web/docs/storybook-conventions.md` so Epic 3 Story 3-4 dev finds it.
- [ ] At least one other frontend dev reviews the calendar library decision before merge.

## Out of Scope

- Session create / edit / delete mutations — Epic 3 Story 3-4 (wired via FW-2 optimistic triple).
- Drag-to-resize, drag-to-move, inline edit on the calendar — Epic 3 Story 3-4 (deferred interactions).
- The `MonthCalendar` simpler month-grid component (`s11`) — separate component in Story 1d-4's inventory; this story builds the full `SessionScheduleCalendar` workspace, not the simpler calendar embed.
- The mobile schedule variant — Chapter 8 mobile screens; deferred to Epic 3 mobile story or to a dedicated 1D mobile story.
- Per-tab payload data fetching inside `ClassDetailTabsShell` — Epic 3 stories own each tab's content (Overview → Story 3-1, Students → Story 3-2, etc.).
- Recurrence semantics validation (e.g., "every other Tuesday starting from a date not falling on Tuesday") — Epic 3 Story 3-4 (the Zod schema in this story validates structural shape; semantic validation lives in the consuming story).
- Calendar export (ICS download) — feature-coupled; ships per consuming epic.
- Calendar print stylesheet — not in MVP scope.
- Room / resource scheduling beyond `roomId` field — Epic 4 (rooms management) ships the room picker; this story accepts `roomId` as an optional string.
