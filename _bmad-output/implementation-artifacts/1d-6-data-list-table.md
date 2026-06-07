---
baseline_commit: a90010732057148b3c4e930c7c7b234aa4686378
---

# Story 1d-6 (legacy): DataListTable Family

Status: deferred-to-feature-epic

> **PATH B RE-SCOPE (2026-06-07):** After party-mode review (Mary's "information-architecture lock-in 6 months before product validation" finding), this story is deferred. Components ship with their first consuming feature epic, then re-used across the rest:
> - `DataListTable` + `FilterChipBar` + `Pagination` wrapper → **Epic 3** Story 3.1 (class index `s07` — first consumer)
> - Recurring usage stories (`StudentsRoster`, `StaffList`, `ExercisesLibrary`, `InvoiceHistory`) → adopt the same component in Epic 7 Stories 7.1/7.2, Epic 4 Story 4.1, Epic 9 Story 9.3 (DoD amendment per Epic 1D applies)
> - `GradingQueueShell` (UX-DR23) → **Epic 6** Story 6.1 (writing grading queue — where the bulk-review pattern lives)
>
> Note: This file is kept as an input artifact. The contract (typed columns, XL-2 page+pageSize pagination, `aria-sort`, three-state coverage) carries over verbatim into Epic 3 Story 3.1.

<!-- Validation is optional. Run `validate-create-story` for a quality second pass before `dev-story`. -->

## Story

As a frontend developer,
I want a `DataListTable` composable family (typed table primitive, `FilterChipBar`, sort headers, `Pagination` wrapper) plus the `GradingQueueShell` for bulk-review queues (UX-DR23) — built once with Storybook coverage across five concrete usage stories,
so that every Epic 2–10 index/list view (Classes, Students, Staff, Exercises, Invoices) and Epic 6 grading queue consumes the same composable shape rather than re-implementing column rendering, sort, filter, and pagination per surface.

## Acceptance Criteria (BDD)

> **No risk-score ≥6 ACs in this story.** This is composable frontend infrastructure — no tenant boundary, no auth flow, no security surface, no money-handling code. Component renders data passed in by consumers; server-state ownership remains with TanStack Query per FW-1. WF-8 ATDD red-tests are NOT mandatory. The Vitest + axe assertions described below are written inline by the dev using the patterns from `test-design-qa.md`.

### AC1: `DataListTable` typed API and TanStack Table column-def adoption

**Given** the `DataListTable` component in `src/components/domain/DataListTable.tsx`,
**When** inspecting its props surface,
**Then** the API accepts:
- `columns: ColumnDef<TRow>[]` — TanStack Table v8 column-def pattern (chosen for typed accessors, sort/filter integration, and existing community familiarity over a hand-rolled typed schema; decision documented in dev notes)
- `data: TRow[]` — pre-fetched rows; the component does NOT own data fetching (TanStack Query owns server state per FW-1; consumers pass `data` from `useQuery`/`useSuspenseQuery`)
- `sort: { id: string; direction: 'asc' | 'desc' } | null` — controlled sort state; consumers map this into their query key per TS-3
- `onSortChange(sort)` callback — emitted when a sort header is activated
- `filterBarSlot?: React.ReactNode` — accepts an arbitrary `FilterChipBar` instance OR custom filter UI; `DataListTable` does not own filter state
- `paginationSlot?: React.ReactNode` — accepts the `Pagination` sub-component instance
- `getRowId(row): string` — required for stable React keys and selection (defaults to `row.id` if present)
- `emptyState?: React.ReactNode` and `errorState?: React.ReactNode` — slots accepting the `EmptyState` / `ErrorState` shapes from Story 1d-5; default fallbacks compose `EmptyState` with generic copy and `FormValidationError` respectively

**And** the component renders the table via the `Table` shadcn primitive (Story 1d-2) — never re-implementing the table semantics. TanStack Table powers column resolution, sort header binding, and row model; rendering remains in our themed `Table` primitive.

**And** the component is generic over `TRow extends { id: string }`: `DataListTable<TRow extends { id: string }>(props: DataListTableProps<TRow>)` with strict TS — no `any`, no `as unknown as`, per TS strict-mode rules.

### AC2: Three-state coverage (`Default`, `Loading`, `Empty`, `Error`)

**Given** the inventory's UX-DR24 + UX-DR28 contract for data-rendering components,
**When** the Storybook stories render,
**Then** four state exports exist for `DataListTable`:
- **`Default`** — canonical render with realistic rows from `src/test/fixtures/`
- **`Loading`** — skeleton rows whose count matches the `pageSize` and whose cell shapes mirror column types (rectangle for text, circle for avatar, smaller rectangle for badge). Skeletons render via the `Skeleton` primitive (Story 1d-2) — never a centered spinner (UX-DR24)
- **`Empty`** — composes `EmptyState` (1d-5) with role-appropriate icon, headline, and action (per UX-1); copy resolves via i18n keys, never hardcoded English
- **`Error`** — composes `FormValidationError` (1d-5) with i18n-keyed message and retry action; tested with MSW `HttpResponse.error()` per TEST-FE-2

**And** the skeleton row count is configurable via `loadingRowCount` prop (default `pageSize`) so consumers can render a stable layout while the first page loads.

### AC3: `FilterChipBar` as separate reusable sub-component

**Given** the `FilterChipBar` component in `src/components/domain/FilterChipBar.tsx`,
**When** inspecting its API,
**Then** it accepts:
- `chips: FilterChip[]` where each chip is `{ id: string; label: string; value: string | string[]; removable?: boolean; tone?: StatusPillTone }`
- `onRemove(chipId): void` — emitted on chip removal; consumers update their filter query key
- `onAddFilter?(): void` — optional callback to open a filter picker (Popover composition; picker UI deferred to consuming stories)

**And** the component renders chips using the `Badge` primitive with a `removable` variant exposing an `aria-label` of the form `t('filters.removeChip', { label: chip.label })` — never a bare `×` glyph without an accessible name.

**And** the component is independently storied with three exports: `Default` (3 chips), `Empty` (zero chips render the filter-picker affordance only), and `Overflow` (10+ chips wrap to a second row — never a horizontal-scroll bar on desktop; horizontal scroll is the mobile-only variant per UX-4 and is built later via `MobileFilterChipScroll`).

**And** `FilterChipBar` is usable independently of `DataListTable` — Storybook documents this with a standalone story so future epic stories can compose it elsewhere (e.g., dashboard scope chips, knowledge-hub folder filters).

### AC4: Sort headers with `aria-sort` per W3C ARIA pattern

**Given** any column declared `sortable: true` in its `ColumnDef`,
**When** the column header renders,
**Then** the header is a button (`role="columnheader" aria-sort="..."`) exposing one of three states per the W3C ARIA grid pattern:
- `aria-sort="ascending"` — column is the active sort, ascending
- `aria-sort="descending"` — column is the active sort, descending
- `aria-sort="none"` — column is sortable but not the active sort

**And** the visual sort indicator is a chevron icon driven from the same state — keyboard activation (`Enter` or `Space`) cycles `none → ascending → descending → none` and emits `onSortChange`.

**And** non-sortable columns omit the `aria-sort` attribute entirely (not `aria-sort="none"`, which would falsely signal sortability to assistive tech).

**And** the axe-core audit (TEST-FE-5) passes with zero violations across all sort states.

### AC5: `Pagination` wrapper using XL-2 `page + pageSize` contract

**Given** the `Pagination` sub-component in `src/components/domain/Pagination.tsx`,
**When** inspecting its API,
**Then** the contract follows XL-2 exactly:
- `page: number` (1-indexed) and `pageSize: number` — controlled props; no internal state
- `totalRows: number` and `totalPages: number` — derived display values supplied by the consumer (computed from the API response `meta` block)
- `pageSizeOptions: number[]` — default `[10, 20, 50]`
- `onPageChange(page: number): void` — 1-indexed page number
- `onPageSizeChange(size: number): void` — resets to page 1 in consuming stories' callback handlers

**And** the component NEVER expresses pagination as `offset + limit` internally or in its prop names — agents trained on offset/limit patterns must hit a typed compile error before merging. The dev-notes section reinforces this with the XL-2 cross-reference.

**And** the rendered controls expose `aria-label="Pagination"` on the wrapping `<nav>` element, and the current page indicator uses `aria-current="page"` per the WAI-ARIA pagination pattern.

**And** the component composes the shadcn `Pagination` primitive (Story 1d-2) for layout — the wrapper adds the `page + pageSize` contract enforcement and the page-size selector on top.

### AC6: `GradingQueueShell` per UX-DR23 — shell only, grading interactions defer to Epic 6

**Given** the `GradingQueueShell` component in `src/components/domain/GradingQueueShell.tsx`,
**When** rendered with a queue payload,
**Then** the shell composes:
- A `DataListTable` instance with the canonical grading-queue column set: `student` (StudentCell from 1d-2), `assignmentTitle`, `className`, `submittedAt` (i18n date formatter per TS-6), `overdueFlag` (StatusPill with `tone="danger"` when overdue, otherwise omitted)
- A prev/next nav control above the table with `aria-label="Queue navigation"` and `aria-current` tracking on the focused row
- A progress indicator `t('grading.queue.progress', { graded: n, total: m })` (e.g., "3 of 12 graded") — copy resolves via i18n keys per UX-2
- A `quickActionBarSlot: React.ReactNode` — accepts an arbitrary action bar (Accept AI / Skip / Flag for later); the slot is empty by default in this story; **the grading actions themselves defer to Epic 6 (Story 6-1 writing grading, 6-3 speaking grading, 6-4 auto-grade override)**

**And** the dev notes for `GradingQueueShell` explicitly state: "This story ships the queue navigation and progress shell ONLY. Wiring the quick-action bar to grading mutations, anchoring to the writing/speaking surfaces, and the AI suggestion strip integration are Epic 6 concerns. Do not implement them here."

**And** the Storybook story for `GradingQueueShell` ships with `Default` (12 queued submissions, 3 graded), `Loading`, `Empty` (`EmptyState` with copy `t('grading.queue.empty')`), and `Error` exports.

### AC7: Five concrete usage stories — one component, role-appropriate columns

**Given** the recurring `DataListTable` consumers across the IA,
**When** Storybook is browsed,
**Then** five named usage stories exist demonstrating one component covers every list view:

1. **`ClassesIndex`** (`s07`) — columns: `EntityCell` (class icon + name + meta), `BandPill` (target band), `studentCount`, `PerfPill` (status: Good/At-risk/Paused/Active), `nextSession` (i18n date), `RowActionsCluster`
2. **`StudentsRoster`** (`s10a`/`s42`) — columns: `StudentCell` (avatar + name + email), `currentBand` (BandPill), `targetBand` (BandPill), `assignmentsDue`, `PerfPill` (status), `RowActionsCluster`
3. **`StaffList`** (`s39`) — columns: `StaffCell` (avatar + name + role), `RoleChipGroup` value rendered read-only, `classesCount`, `LoadMeter`, `StatusPill` (Active/Paused), `lastActiveAt` (i18n date), `RowActionsCluster`
4. **`ExercisesLibrary`** (`s15`) — columns: `EntityCell` (exercise icon + title + meta), `SkillTag`, `BandPill` (target band), `attemptCount`, `lastModifiedAt` (i18n date), `RowActionsCluster`
5. **`InvoiceHistory`** (`s70`) — columns: `invoiceNumber` (monospace per UX-DR22), `description`, `amount` (monospace + locale-formatted via i18n), `InvoiceStatusPill` (StatusPill specialization per UX-DR30), `paymentMethod`, `RowActionsCluster`

**And** each usage story uses the role decorator (per Story 1d-1 AC2) appropriately:
- `ClassesIndex`, `StudentsRoster`, `ExercisesLibrary` render under both `TeacherView` and `OwnerView` with role-appropriate column variants (teacher sees own classes; owner sees center-wide scope)
- `StaffList` and `InvoiceHistory` render only under `OwnerView` and `AdminView` (per IA — students never see staff lists or invoices)

**And** every usage story declares its MSW handlers in `parameters.msw.handlers` returning fixtures from `src/test/fixtures/` — no inline mock data in story files.

### AC8: Keyboard navigation, axe-core, and i18n coverage

**Given** the `DataListTable`, `FilterChipBar`, `Pagination`, and `GradingQueueShell` stories,
**When** axe-core runs against every story in CI (per TEST-FE-5 and Story 1d-1 AC4),
**Then** zero violations across all states (`Default`, `Loading`, `Empty`, `Error`) and all five usage stories.

**And** keyboard navigation follows the standard data-grid WAI-ARIA pattern:
- `Tab` enters and exits the table at the header row
- `Arrow Up/Down` moves between rows (when focused inside the table body)
- `Arrow Left/Right` moves between cells within a row
- `Enter` / `Space` on a sort header cycles sort state
- `Page Up/Down` moves through pagination (when `paginationSlot` is supplied)
- Focus order matches visual reading order (TEST-UX-2)

**And** every story renders correctly under both `en` and `vi` locales (toolbar switch from Story 1d-1 AC2). Vietnamese strings are typically 15–30% longer than English equivalents — the dev verifies column widths and chip overflow do not break layout under `vi`. Per TEST-UX-1, `aria-label` attributes (e.g., the sort header chevron's screen-reader text) are resolved through i18n, never hardcoded English.

**And** every date column uses the i18n date formatter pattern `t('date', { val: row.submittedAt })` per TS-6 — never `new Date(row.submittedAt).toLocaleDateString()`.

## Tasks / Subtasks

- [ ] **Task 1 (AC1):** Build `src/components/domain/DataListTable.tsx` with the typed TanStack Table column-def API. Add JSDoc on the exported component and props type. Verify `tsc --noEmit` clean.
  - [ ] Add the generic `TRow extends { id: string }` constraint.
  - [ ] Wire `useReactTable` against the shadcn `Table` primitive — no replacement of the themed semantics.
  - [ ] Add `loadingRowCount` prop with default `pageSize`.
- [ ] **Task 2 (AC2):** Author `DataListTable.stories.tsx` with the four state exports (`Default`, `Loading`, `Empty`, `Error`). Wire MSW handlers per `parameters.msw.handlers` for the `Default` and `Error` states.
- [ ] **Task 3 (AC3):** Build `src/components/domain/FilterChipBar.tsx` and its `FilterChipBar.stories.tsx` (`Default`, `Empty`, `Overflow` exports). Verify the chips compose the `Badge` primitive's removable variant.
- [ ] **Task 4 (AC4):** Add sort-header rendering inside `DataListTable` with `aria-sort` cycling per W3C pattern. Add a Storybook story `SortableColumns` demonstrating ascending / descending / none.
- [ ] **Task 5 (AC5):** Build `src/components/domain/Pagination.tsx` enforcing the XL-2 `page + pageSize` contract. Add `Pagination.stories.tsx` with `Default`, `LargeDataset` (1000 rows), and `SinglePage` exports.
- [ ] **Task 6 (AC6):** Build `src/components/domain/GradingQueueShell.tsx` composing `DataListTable` with the queue-specific columns + prev/next nav + progress + `quickActionBarSlot`. Author `GradingQueueShell.stories.tsx` with the four states. Add a prominent dev-notes comment block in the source file flagging that quick-action wiring defers to Epic 6.
- [ ] **Task 7 (AC7):** Author five Storybook usage stories — `ClassesIndex.stories.tsx`, `StudentsRoster.stories.tsx`, `StaffList.stories.tsx`, `ExercisesLibrary.stories.tsx`, `InvoiceHistory.stories.tsx`. Each story imports `DataListTable` and configures its column set + fixtures + MSW handlers + role decorator.
- [ ] **Task 8 (AC8):** Run `npm run storybook:test` locally — verify zero axe violations across all stories. Tab-walk every story manually to confirm keyboard nav. Toggle the locale to `vi` for each story and verify no layout breakage.

## Dev Notes

- **Stack reminders:**
  - React 19 — refs are plain props on `DataListTable`; no `forwardRef`.
  - Vite 8 (Rolldown) — TanStack Table v8 is pure ESM; no Rolldown plugin concerns expected.
  - TypeScript strict — `DataListTable<TRow>` is generic; never widen `TRow` to `any` to escape a type error. If a column accessor type widens unexpectedly, fix the upstream `ColumnDef` typing.
  - Tailwind utility classes only — no inline `style={{}}` for column widths; use `colSize` via `ColumnDef.size` and `min-w-*` utility classes.
  - shadcn `Table`, `Skeleton`, `Badge`, `Pagination` primitives from Story 1d-2 are the rendering substrate. Never hand-edit those files.

- **Why TanStack Table v8 column-def (not a custom typed schema):** TanStack Table provides typed accessors, headless sort/filter integration, and row-model composability without coupling us to its rendering. We use it as a row-model engine while keeping rendering in our shadcn `Table` primitive. The alternative — a hand-rolled column schema — would re-implement column accessors, sort state, and row IDs at no clear benefit. This decision is documented in the source file's header JSDoc and in `classlite-web/docs/storybook-conventions.md` (cross-referenced from Story 1d-1 AC7).

- **One mock seam per side (TEST-FE-1):** MSW at the HTTP boundary in every story. Never mock `useQuery`/`useMutation` in the story files. The `DataListTable` itself does NOT call `useQuery` — the consuming page component does, then passes `data` and `isLoading` props down. The story-level mocks emulate the consumer's `useQuery` resolution by intercepting the HTTP call.

- **FW-1 reminder for downstream consumers:** Although `DataListTable` does not directly consume a route loader, every Epic 2–10 page that uses it WILL. The pattern is: route loader prefetches into the Query cache → page component reads via `useSuspenseQuery` → page passes `data` to `DataListTable`. This story documents the contract; the loader itself ships per-page in the consuming epic stories.

- **FW-3 staleTime defaults:** Stories that need fresh data on every navigation can use `staleTime: 0` in the story-level QueryClient (with a comment justifying it), but the project default is `30 * 1000` per `query-client.ts`. The `DataListTable` is agnostic to staleTime — that contract is owned by the consumer.

- **XL-2 pagination contract (binding):** The `Pagination` wrapper enforces `page + pageSize` at the type level. Agents who try to add `offset` / `limit` props (e.g., to interop with a third-party hook) must fail the type-check at compile time. The conversion `OFFSET = (page-1) * pageSize` happens in the API client / query function, not in the component.

- **TS-3 query keys:** Consumers wire sort and filter into hierarchical query keys (e.g., `studentKeys.list({ page, pageSize, sort, filters })`). The `DataListTable` does not own the keys — it surfaces `onSortChange` and the `FilterChipBar` surfaces `onRemove`; consumers map those into their query-key factory.

- **TS-6 dates:** Every date column MUST format via `t('date', { val })`. The component cannot enforce this at the type level (column accessors return `string`), but Storybook stories model it and the lint rule blocks `new Date()` in render paths in CI.

- **UX-DR24 skeletons:** Skeleton row shape must mirror column types — text → rectangle, avatar → circle, badge → rounded-pill. The `loadingRowCount` defaults to `pageSize` so the skeleton occupies the same vertical space as the loaded data, preventing layout shift.

- **UX-DR23 grading queue scope:** `GradingQueueShell` ships the shell ONLY. The Epic 6 grading stories wire the quick-action bar, the AI suggestion strip integration, and the auto-grading override flow. This story is the chassis; the engine ships later.

- **WF-3 codegen note:** This story does not touch `api.yaml` or `.sql` files. `codegen.sh` does NOT need to run.

- **WF-7 service boundary:** Imports stay within `classlite-web/` — never reach into `../../classlite-api/`. Mock API response shapes use MSW with hand-authored fixtures matching the OpenAPI types in `src/generated/`.

- **FW-7 component placement:** `DataListTable`, `FilterChipBar`, `Pagination`, and `GradingQueueShell` all live in `src/components/domain/` — they're business-aware (column shapes know about `StudentCell`, `BandPill`, etc.) but reusable across features. Never place them in `ui/`.

- **Role-rendering rule (UX-3):** Role-specific column sets are configured by the consuming page component, not branched inside `DataListTable`. The five usage stories demonstrate this pattern — each page constructs its own `ColumnDef[]` with role-appropriate columns and passes it to the same `DataListTable`. There is no `if (role === 'owner')` branch buried inside the table.

## Definition of Done

- [ ] All 8 ACs discharged.
- [ ] `DataListTable`, `FilterChipBar`, `Pagination`, and `GradingQueueShell` ship with co-located `*.stories.tsx` files (FW-7).
- [ ] Five usage stories (`ClassesIndex`, `StudentsRoster`, `StaffList`, `ExercisesLibrary`, `InvoiceHistory`) exist in Storybook and render green.
- [ ] All stories pass `npm run storybook:test` with zero axe violations.
- [ ] `tsc --noEmit` is clean against the strict-mode config.
- [ ] Both `en` and `vi` locales render every story without layout breakage.
- [ ] At least one other frontend dev reviews the column-def adoption decision before merge.

## Out of Scope

- Grading mutation wiring inside `GradingQueueShell` — Epic 6 (Stories 6-1, 6-3, 6-4).
- Server-state ownership inside `DataListTable` — consumers own `useQuery` per FW-1.
- Filter picker UI inside `FilterChipBar` (the popover that lets users add a new filter) — deferred to the consuming page stories in Epics 3, 4, 8.
- `MobileFilterChipScroll` horizontal-scroll variant (UX-DR32 mobile-purpose-designed) — built as a dedicated component later in 1D or per the mobile chapter.
- Row selection and bulk actions — not in MVP scope for this story; if needed by Epic 6 grading queue, added then.
- Virtualized rows for >1000-row tables — not needed for MVP page sizes (10/20/50); revisit if a future epic surface needs it.
- Column resizing / reordering — not in MVP scope.
- CSV export of table data — feature-coupled; ships per consuming epic.
