---
baseline_commit: a90010732057148b3c4e930c7c7b234aa4686378
---

# Story 1d-2: Shadcn Primitive Coverage & Token Theming

Status: backlog

<!-- Validation is optional. Run `validate-create-story` for a quality second pass before `dev-story`. -->

## Story

As a frontend developer,
I want every shadcn primitive identified in the Phase 1 inventory (34 components — the original 32 plus `Toggle` and `ToggleGroup` per the party-mode coupling-gap finding) installed via `npx shadcn add`, themed against the ClassLite design tokens from Story 1.7a, and wrapped with a Storybook story file covering its full variant API surface,
so that every downstream `domain/` and `features/<area>/components/` component built in Stories 1d-3 and 1d-4 (and Epics 2–10) composes against a finished, axe-clean, locale-correct primitive foundation rather than re-theming shadcn defaults inline.

## Acceptance Criteria (BDD)

> **No risk-score ≥6 ACs in this story.** This is install + theme + Storybook scaffold work for vendor primitives — no security surface, no tenant isolation, no auth flow. WF-8 ATDD red-tests are NOT mandatory. Per-primitive coverage is enforced mechanically via the Tasks checklist (one row per primitive) rather than 32 individual ACs; the ACs below group primitives by category so the discharge criteria stay testable. Story 1d-1 (Storybook foundation) is a hard dependency — if 1d-1's kill-switch was invoked (no Storybook), this story degrades to "install + theme + three-state Vitest coverage" and the per-primitive `*.stories.tsx` checklist items become RTL component tests instead.

### AC1: Form and selection primitives — install, theme, story-cover with RHF + Zod canonical wiring

**Given** the twelve form and selection primitives in the inventory's Phase 1 list — `Button`, `Input`, `Textarea`, `Select`, `Checkbox`, `RadioGroup`, `Switch`, `Slider`, `Label`, `Form`, `Toggle`, `ToggleGroup` —
**When** each is installed via `npx shadcn@latest add <component>` and inspected,
**Then** each lives at `src/components/ui/<component>.tsx` (per FW-7), is pinned in `components.json`, and is never hand-edited beyond the post-install token swap performed by AC7's codemod step (per XL-1).

**And** each primitive ships a co-located `<component>.stories.tsx` exporting `Default` plus the variants relevant to its API:
- `Button` — `Default`, `Secondary`, `Destructive`, `Outline`, `Ghost`, `Link`, `Loading`, `Disabled`, `WithIcon`, `SizeSmall`, `SizeLarge`.
- `Input`, `Textarea` — `Default`, `WithLabel`, `WithHelperText`, `WithError` (composes `aria-invalid` + `aria-describedby`), `Disabled`, `ReadOnly`.
- `Select` — `Default`, `WithPlaceholder`, `WithGroups`, `Disabled`, `LongVietnameseOption` (overflow + truncation per UX-2).
- `Checkbox`, `RadioGroup`, `Switch` — `Default`, `Checked`, `Disabled`, `WithLabel`, `WithDescription`.
- `Slider` — `Default`, `WithSteps`, `WithRange`, `Disabled`.
- `Label` — `Default`, `Required` (asterisk), `Optional`.
- `Form` — one canonical story `WithRHFAndZodResolver` that demonstrates the `useForm({ resolver: zodResolver(schema) })` pattern with a 3-field Zod schema and renders the success + validation-error paths (per TS-2, FW-8).
- `Toggle` — `Default`, `Pressed`, `Disabled`, `WithIcon` (the icon-only press variant 1d-3 `SidebarShell` collapse trigger will consume).
- `ToggleGroup` — `Single`, `Multiple`, `WithIcons`, `WithLabels` (the icon+label variant 1d-3 `MobileTabBar` and 1d-4 `ViewToggle` consumers will use).

**And** the `Form` story's Zod schema is defined inline in the story file (not imported from `lib/`) so the story documents the canonical RHF + Zod wiring pattern that 1d-7 (Drawers/modals/forms) and every Epic 2–10 form story will consume verbatim.

**And** the writing editor is explicitly excluded from this pattern via a code comment in `Form.stories.tsx`: it uses the document-editing pattern with debounced TanStack Query mutations, deferred to Epic 5 (per FW-8).

### AC2: Overlay primitives — install, theme, story-cover with focus-trap verification

**Given** the seven overlay primitives — `Dialog`, `AlertDialog`, `Sheet`, `Drawer`, `Popover`, `Tooltip`, `HoverCard` —
**When** each is installed and storied,
**Then** each `*.stories.tsx` exports `Default` (closed-by-default with a trigger button), `Open` (forced open via `parameters.open: true`), and the variants relevant to that primitive (`Sheet` adds `Left`, `Right`, `Top`, `Bottom`; `Dialog` adds `WithForm`; `AlertDialog` adds `Destructive`; `Popover`/`Tooltip`/`HoverCard` add `Positioned` covering `top`, `right`, `bottom`, `left`).

**And** the focus-trap behavior is verified inline in the story file via a `play` function from `@storybook/test`:
```ts
play: async ({ canvasElement }) => {
  const canvas = within(canvasElement)
  const trigger = canvas.getByRole('button', { name: /open/i })
  await userEvent.click(trigger)
  await waitFor(() => expect(canvas.getByRole('dialog')).toHaveFocus())
  await userEvent.keyboard('{Escape}')
  await waitFor(() => expect(trigger).toHaveFocus())  // focus returns to trigger (per TEST-UX-2)
}
```
This pattern is the canonical reference 1d-7 will reuse for the higher-fidelity drawer/modal wrappers.

**And** `Tooltip` and `Popover` stories include a `LongVietnameseContent` variant to verify overflow + word-wrap behavior at typical Vietnamese string length (~1.5x English length per UX-2).

### AC3: Menu and command primitives — install, theme, story-cover with keyboard nav

**Given** the four menu/command primitives — `DropdownMenu`, `ContextMenu`, `Command` (the ⌘K palette base), `NavigationMenu` —
**When** each is installed and storied,
**Then** each `*.stories.tsx` exports `Default`, `WithSubmenu` (nested items), `WithSeparators`, `WithShortcuts` (keyboard hint rendering), and `Disabled` (disabled item state).

**And** `Command.stories.tsx` additionally exports `EmptyResults` (composes the `Command.Empty` slot with i18n key `command.empty` — not hardcoded English) and `WithGroups` (demonstrating grouped command entries, the structure the future `⌘K` palette will consume).

**And** keyboard navigation is verified inline via a `play` function asserting arrow-key traversal, `Enter`-to-select, and `Escape`-to-close on at least the `Default` story per primitive (per TEST-UX-2).

### AC4: Feedback and indicator primitives — install, theme, story-cover with shape-mirroring loading

**Given** the four feedback/indicator primitives — `Badge`, `Avatar`, `Skeleton`, `Progress`, `Sonner` (the toast surface) —
**When** each is installed and storied,
**Then** each ships the variants relevant to its API:
- `Badge` — `Default`, `Secondary`, `Destructive`, `Outline`, `Removable` (with close button — the variant `FilterChipBar` from 1d-6 will consume), `WithIcon`.
- `Avatar` — `Default`, `WithImage`, `WithInitials` (covering letter-mark fallback used by `BrandColorPicker` from 1d-7), `SizeSm`, `SizeMd`, `SizeLg`, plus `ColoredA1` through `ColoredA6` matching the inventory's avatar color rotation.
- `Skeleton` — `Default`, `Rectangle`, `Circle`, `Text`, `Card` — these are pure shape primitives without data-surface semantics (per Winston's FW-7 split). The shape-semantic skeleton wrappers (`SkeletonListRow`, `SkeletonTableRow`, `SkeletonChartRectangle`) belong to `domain/` and defer to Epic 10 Story 10.3 with the consolidated `LoadingSkeleton` pattern set. Until then, 1d-3 and 1d-4 stories compose the pure primitives directly (`<Skeleton variant="Rectangle" className="h-12 w-full" />` patterns).
- `Progress` — `Default`, `Indeterminate`, `Warn` (used by `PlanUsageMeter`), `Critical` (used by `BillingGraceBanner`), `Complete`.
- `Sonner` — one canonical story `WithTriggers` that demonstrates `toast.success`, `toast.error`, `toast.info` invocation. The story documents the i18n contract: toast bodies resolve via `t('toast.*')` keys (no hardcoded English).

**And** `Skeleton` story variants cover the five pure shape primitives (`Rectangle`, `Circle`, `Text`, `Card`, plus `Default`). Shape-semantic compositions (`ListRow`, `TableRow`, `ChartRectangle`) DO NOT ship here — they're domain components per FW-7 and defer to Epic 10's `LoadingSkeleton` pattern set. Until then, 1d-3 and 1d-4 stories compose the primitives directly.

**And** all primitives in this category honor `prefers-reduced-motion` (the pulse animation on `Skeleton`, the indeterminate animation on `Progress`) — verified by setting `parameters.reducedMotion: 'reduce'` on at least one story per animated primitive.

### AC5: Layout and structure primitives — install, theme, story-cover with token compliance

**Given** the seven layout primitives — `Card`, `Separator`, `ScrollArea`, `Accordion`, `Collapsible`, `Tabs`, `Calendar` —
**When** each is installed and storied,
**Then** each ships the variants relevant to its API:
- `Card` — `Default`, `WithHeader`, `WithFooter`, `WithHeaderAndFooter`, `Interactive` (with hover state).
- `Separator` — `Horizontal`, `Vertical`, `WithLabel` (the `or` divider pattern).
- `ScrollArea` — `Vertical`, `Horizontal`, `Both`, with content sized to force overflow.
- `Accordion` — `Single`, `Multiple`, `Default` (collapsed), `DefaultOpen`.
- `Collapsible` — `Default`, `Controlled`.
- `Tabs` — `Default`, `WithIcon`, `WithBadgeCount` (the count-bearing pattern `TabStrip` from 1d-3 will wrap), `Vertical`.
- `Calendar` — `Default`, `WithSelected`, `Range`, `WithDisabledDates`, `LocaleEn`, `LocaleVi` — the `LocaleVi` story passes `locale={vi}` from `date-fns/locale` to confirm Vietnamese date-format rendering (per UX-2, TS-6).

**And** `Calendar.stories.tsx` does NOT call `new Date()` in render (per TS-6). The "today" reference date is passed via a `parameters.now: '2026-06-15T00:00:00Z'` ISO string that the story reads through a stable mock so axe snapshots stay deterministic.

**And** this story does NOT make the calendar-library decision for `SessionScheduleCalendar` — that spike lives in Story 1d-8. The `Calendar` primitive here is the shadcn day-picker, used for date-input affordances in forms (and downstream the mini-month navigator in 1d-8 may or may not compose it depending on 1d-8's library decision).

### AC6: Data primitives — install, theme, story-cover with column-rendering sketch

**Given** the three data primitives — `Table`, `Breadcrumb`, `Pagination` —
**When** each is installed and storied,
**Then**:
- `Table.stories.tsx` exports `Default`, `WithCaption`, `WithFooter`, `Striped`, `Hoverable`, `Sortable` (demonstrates `aria-sort` attribute on header cells per W3C ARIA pattern — the contract 1d-6's `DataListTable` will consume).
- `Breadcrumb.stories.tsx` exports `Default`, `WithEllipsis` (middle-truncation pattern), `WithDropdown` (overflow menu), `LongPath` (5+ segments) — the contract 1d-3's `BreadcrumbBar` will wrap.
- `Pagination.stories.tsx` exports `Default`, `FirstPage`, `MiddlePage`, `LastPage`, `WithEllipsis` — the API uses the project's `page` + `pageSize` contract (per XL-2), not `offset` + `limit`. Story documents this in a header comment so 1d-6's `Pagination` wrapper inherits the convention.

**And** `Table.stories.tsx` includes a `WithMockData` story populating 5 rows of typed mock data so the visual rendering can be reviewed without 1d-6's `DataListTable` wrapper present. The mock data shape is deliberately trivial (`{id, name, status}`) — 1d-6 owns the typed column-def pattern.

### AC7: Token theming — design-token swap, zero raw hex, Geist + Geist Mono enforced

**Given** all 32 primitives are installed,
**When** inspecting each `<component>.tsx` file post-install,
**Then** every color value resolves to a design token defined by Story 1.7a:
- Backgrounds: `bg-cl-paper`, `bg-cl-paper-raised`, `bg-cl-accent`, `bg-cl-success`, `bg-cl-warning`, `bg-cl-danger`, `bg-cl-muted`.
- Foregrounds: `text-cl-ink`, `text-cl-ink-soft`, `text-cl-ink-muted`, `text-cl-accent-fg`, etc.
- Borders: `border-cl-line`, `border-cl-line-soft`.
- No raw hex values (`#fff`, `#000`, `#hexcode`) anywhere in `src/components/ui/`.
- No default shadcn `tw-` prefixed neutrals (`bg-slate-50`, `text-zinc-900`, etc.).

**And** typography overrides are applied per the token contract:
- Body text — `font-body` (Geist).
- Numeric and code — `font-mono` (Geist Mono) — applied to `Badge` when used as a count, to `Progress` percentage labels, to numeric `Input` types, and to `Calendar` day numbers.
- Display headlines (Fraunces) are NOT consumed by primitives — they live in domain components (`PageHead`, `DashboardHero` from 1d-3 and 1d-4).

**And** border radius matches the token rule:
- `Button` and `Input` — 6px (`rounded-cl-control`).
- `Card`, `Dialog`, `Sheet`, `Drawer` — 12px (`rounded-cl-surface`).
- `Badge`, `Avatar` — full-pill (`rounded-full`).
- `Skeleton` — inherits from the consuming shape's radius.

**And** the token-swap is performed by a single PR that applies one of the two patterns documented in `classlite-web/docs/storybook-conventions.md` AC7:
1. **Preferred:** wrap shadcn's CSS-variable-driven tokens by overriding `:root` CSS variables in `src/styles/tokens.css` (Story 1.7a's token file) so the install output remains unmodified — keeps XL-1 cleanly satisfied.
2. **Fallback (only if the variant prop surface needs more than CSS variables can express):** a documented, scoped edit to the installed file with a `// CL-THEME-SWAP: <reason>` comment line so future agents understand why the file deviates from shadcn upstream.

The PR uses Pattern 1 wherever possible; any use of Pattern 2 is called out in the PR description for reviewer approval.

### AC8: i18n, axe, and CI green across all 32 primitive stories

**Given** all 32 primitives are storied,
**When** the Storybook toolbar switches locale between `en` and `vi`,
**Then** every primitive story renders correctly in both locales — character set, line-height, and (where applicable) overflow behavior of longer Vietnamese strings work without layout breakage.

**And** any primitive story containing user-visible text consumes its strings via `t()` keys — no hardcoded English strings anywhere in `src/components/ui/*.stories.tsx` (per UX-2, TEST-FE-4). Placeholder copy in stories (e.g., `Sonner` toast bodies) uses Storybook-scoped i18n keys (`storybook.placeholder.*`) so production translation files stay clean.

**Given** the `@storybook/addon-a11y` audit and the `vitest-axe` integration from 1d-1,
**When** all 32 primitive stories run via `npm run storybook:test` in CI,
**Then** zero `axe-core` violations across every story export. Any primitive that fails the baseline is patched at the `domain/` wrapper level (FW-7) or via a documented `axe.disabled` annotation on the specific rule with a justification comment — never by hand-editing the installed `ui/` file (per XL-1).

**And** the CI `storybook` job from 1d-1's AC5 stays green throughout this story.

**And** the smoke story `Button.stories.tsx` from 1d-1's AC8 is extended in this story to its full variant matrix (replacing the trivial smoke version).

## Tasks / Subtasks

- [ ] **Task 1 (AC1):** Install + theme + story the 12 form and selection primitives.
  - [ ] `npx shadcn@latest add button` + `Button.stories.tsx` (extend smoke story from 1d-1).
  - [ ] `npx shadcn@latest add input` + `Input.stories.tsx`.
  - [ ] `npx shadcn@latest add textarea` + `Textarea.stories.tsx`.
  - [ ] `npx shadcn@latest add select` + `Select.stories.tsx`.
  - [ ] `npx shadcn@latest add checkbox` + `Checkbox.stories.tsx`.
  - [ ] `npx shadcn@latest add radio-group` + `RadioGroup.stories.tsx`.
  - [ ] `npx shadcn@latest add switch` + `Switch.stories.tsx`.
  - [ ] `npx shadcn@latest add slider` + `Slider.stories.tsx`.
  - [ ] `npx shadcn@latest add label` + `Label.stories.tsx`.
  - [ ] `npx shadcn@latest add form` + `Form.stories.tsx` with canonical RHF + `zodResolver` wiring story.
  - [ ] `npx shadcn@latest add toggle` + `Toggle.stories.tsx` (1d-3 sidebar-collapse consumer).
  - [ ] `npx shadcn@latest add toggle-group` + `ToggleGroup.stories.tsx` (1d-3 MobileTabBar + 1d-4 ViewToggle consumers).
- [ ] **Task 2 (AC2):** Install + theme + story the 7 overlay primitives with focus-trap `play` functions.
  - [ ] `dialog`, `alert-dialog`, `sheet`, `drawer`, `popover`, `tooltip`, `hover-card`.
  - [ ] Each story exports `Default` + `Open` + position/variant variants.
  - [ ] `play` function asserts focus return to trigger on close for `Dialog`, `AlertDialog`, `Sheet`, `Drawer`.
  - [ ] `LongVietnameseContent` variant for `Tooltip` and `Popover`.
- [ ] **Task 3 (AC3):** Install + theme + story the 4 menu/command primitives with keyboard nav verification.
  - [ ] `dropdown-menu`, `context-menu`, `command`, `navigation-menu`.
  - [ ] `Command.stories.tsx` includes `EmptyResults` and `WithGroups` exports (palette structural reference).
  - [ ] `play` function verifies arrow-key/Enter/Escape on `Default` per primitive.
- [ ] **Task 4 (AC4):** Install + theme + story the 5 feedback/indicator primitives.
  - [ ] `badge`, `avatar`, `skeleton`, `progress`, `sonner`.
  - [ ] `Skeleton.stories.tsx` exports the 5 pure shape variants (`Rectangle`, `Circle`, `Text`, `Card`, plus `Default`). Shape-semantic compositions (`ListRow`, `TableRow`, `ChartRectangle`) defer to Epic 10's `LoadingSkeleton` per FW-7 + Winston's split.
  - [ ] `Avatar.stories.tsx` exports `ColoredA1` through `ColoredA6`.
  - [ ] `Sonner.stories.tsx` story uses `t('storybook.toast.*')` keys.
  - [ ] Verify `prefers-reduced-motion` honored on `Skeleton` and `Progress`.
- [ ] **Task 5 (AC5):** Install + theme + story the 7 layout primitives.
  - [ ] `card`, `separator`, `scroll-area`, `accordion`, `collapsible`, `tabs`, `calendar`.
  - [ ] `Calendar.stories.tsx` exports `LocaleEn` and `LocaleVi` (passing `vi` from `date-fns/locale`).
  - [ ] `Calendar.stories.tsx` uses ISO-string `now` from `parameters`, not `new Date()` in render (per TS-6).
  - [ ] Add header comment in `Calendar.stories.tsx`: "Calendar-library decision for `SessionScheduleCalendar` is Story 1d-8 — this primitive is the shadcn day-picker only."
- [ ] **Task 6 (AC6):** Install + theme + story the 3 data primitives.
  - [ ] `table`, `breadcrumb`, `pagination`.
  - [ ] `Table.stories.tsx` `Sortable` variant uses `aria-sort` per W3C pattern.
  - [ ] `Pagination.stories.tsx` documents the `page` + `pageSize` contract (per XL-2).
- [ ] **Task 7 (AC7):** Apply the design-token theming pass.
  - [ ] Use Pattern 1 (CSS-variable override in `src/styles/tokens.css`) wherever the shadcn `:root` variables suffice.
  - [ ] Document each Pattern-2 deviation with `// CL-THEME-SWAP: <reason>` and list deviations in the PR description.
  - [ ] Grep `src/components/ui/` for raw hex values, raw `slate-*`/`zinc-*`/`neutral-*` Tailwind classes — must be zero.
  - [ ] Apply `font-mono` to numeric `Badge`, `Progress` label, numeric `Input`, `Calendar` day numbers.
  - [ ] Apply `rounded-cl-control` (6px) to `Button` and `Input`, `rounded-cl-surface` (12px) to `Card`/`Dialog`/`Sheet`/`Drawer`.
- [ ] **Task 8 (AC8):** Wire CI green across all 34 stories.
  - [ ] Verify `en` and `vi` locale toolbar switching renders every story correctly.
  - [ ] Grep `src/components/ui/*.stories.tsx` for hardcoded English — must be zero outside `t()` keys.
  - [ ] Run `npm run storybook:test` locally — zero axe violations expected.
  - [ ] Confirm CI `storybook` job from 1d-1's AC5 stays green.

## Dev Notes

- **Stack reminders:**
  - React 19 — no `forwardRef` (shadcn installs may include legacy patterns — flag any during install for the conversion pass). No `"use client"` directives.
  - Vite 8 (Rolldown) — already validated by 1d-1's spike; no new builder risk in this story.
  - TypeScript strict — no `any` in story files; mock data has explicit types.
  - shadcn/ui — primitives in `src/components/ui/`, never hand-edited (XL-1 + FW-7). Token theming uses the CSS-variable override pattern (Pattern 1 in AC7) wherever possible; Pattern 2 file edits require documented justification.
  - Tailwind utility classes only — no inline `style={{}}` in any story file.
  - TanStack Query — `Form.stories.tsx` does NOT introduce a `useMutation` example here; that lives in 1d-7's drawer/modal/form story. Primitives are pre-state.

- **One mock seam per side (TEST-FE-1):** Primitive stories rarely need MSW because primitives don't fetch data. The two exceptions are:
  - `Form.stories.tsx`'s `WithRHFAndZodResolver` story includes a fake mutation handler returning a resolved promise — NOT an MSW handler — to show the success/validation-error flow without committing to an HTTP contract this early.
  - `Sonner.stories.tsx` triggers toasts via story controls, not network.

- **i18n is co-primary (UX-2 + TEST-FE-4):** Every story renders correctly in both `en` and `vi`. Vietnamese strings are typically ~1.5x the English length — `Tooltip`, `Popover`, `Select`, and `Calendar` stories must include a Vietnamese overflow case. Placeholder copy uses `storybook.placeholder.*` keys so production translation files stay clean.

- **Role-based rendering rule (UX-3, UX-DR29):** Primitives are role-agnostic. The `withRole` decorator from 1d-1 stays available in the toolbar, but no primitive story should render differently per role — if a primitive appears to need role variants, that's a sign the role logic belongs in a domain wrapper (1d-3 onward), not in `ui/`.

- **WF-3 codegen note:** This story does not touch `api.yaml` or `.sql` files. `codegen.sh` does NOT need to run.

- **WF-7 service boundary:** All work stays within `classlite-web/` — never reach into `../../classlite-api/`. Mock data in stories is hand-authored; no imports from `src/generated/`.

- **FW-7 placement:** Every file authored by this story sits in `src/components/ui/`. Any domain-aware wrapper that emerges during the work (e.g., a status-pill composition) is OUT OF SCOPE — push it to 1d-4.

- **TS-6 (no `new Date()` in render):** `Calendar.stories.tsx` must use a deterministic ISO-string `now` reference. Use `parameters.now: '2026-06-15T00:00:00Z'` and read it in the render function. This keeps axe snapshots deterministic and matches the project convention.

- **Component count discipline:** The 34-primitive list is fixed by the inventory's Phase 1 § "Shadcn primitives needed" plus the party-mode coupling-gap fix that pulled `Toggle` and `ToggleGroup` into this story (rather than leaving them as downstream-owned installs that would create hidden 1d-3 → 1d-4 ordering issues). Shape-semantic skeletons (`SkeletonListRow`, etc.) remain OUT of this story per FW-7 — they live in `domain/` and ship with Epic 10's `LoadingSkeleton` pattern set.

- **Designer review touchpoint:** This is the first major designer-iteration surface — once 1d-2 ships, the designer can browse the full primitive Storybook and request token tweaks (radius, color saturation, font weights). Tweaks land via Story 1.7a token-file updates, not via per-primitive file edits.

## Definition of Done

- [ ] All 8 ACs discharged.
- [ ] All 34 primitives installed at `src/components/ui/<component>.tsx`.
- [ ] All 34 primitives have a co-located `<component>.stories.tsx` exporting the variants listed per-AC.
- [ ] Zero raw hex values, zero default shadcn `slate-*`/`zinc-*`/`neutral-*` classes in `src/components/ui/`.
- [ ] `Form.stories.tsx` ships a canonical RHF + `zodResolver` wiring story that 1d-7 will consume verbatim.
- [ ] `Calendar.stories.tsx` does NOT call `new Date()` in render (per TS-6).
- [ ] All primitive stories pass `en` + `vi` locale toolbar switching with no layout breakage.
- [ ] All primitive stories pass `axe-core` audit (zero violations) via `npm run storybook:test`.
- [ ] CI `storybook` job green on the PR (per 1d-1's AC5).
- [ ] PR description lists every Pattern-2 file edit (if any) with a justification per entry.
- [ ] Designer notified that the full primitive Storybook is ready for review.

## Out of Scope

- Domain components composing these primitives — Stories 1d-3 (app-shell) and 1d-4 (Phase 4 visual bridge).
- Shape-semantic skeletons (`SkeletonListRow`, `SkeletonTableRow`, `SkeletonChartRectangle`) — defer to Epic 10 Story 10.3 with the consolidated `LoadingSkeleton` pattern set.
- The `SessionScheduleCalendar` calendar-library decision — deferred with old Story 1d-8 to Epic 3 Story 3.4 (this story only installs the shadcn `Calendar` day-picker primitive).
- The `⌘K` command palette UI itself — this story installs the `Command` primitive and stories its API; the palette wiring is a follow-up consuming feature story.
- The writing-editor RHF exemption pattern (FW-8) — only mentioned in the `Form.stories.tsx` comment; the actual writing editor ships in Epic 5.
- Visual regression testing (Chromatic, Percy) — not in MVP scope per 1d-1.
- Per-primitive performance benchmarks — not in MVP scope.
