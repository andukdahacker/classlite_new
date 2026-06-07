---
baseline_commit: a90010732057148b3c4e930c7c7b234aa4686378
---

# Story 1d-4: Phase 4 Visual Bridge — Static Shells

Status: backlog

<!-- Validation is optional. Run `validate-create-story` for a quality second pass before `dev-story`. -->

> **PATH B ORIGIN.** This story exists because of the party-mode review consensus (Sally + Winston + Mary independently): deferring all Phase 4 components to feature epics meant the designer's Storybook playground would carry the chrome of the cathedral and save the stained glass for last. The synthesis is to ship Phase 4 components as **static visual shells only** — typography, layout, color, pin chrome, comment-card visual identity, mobile surface dimensions — with all behavior (autosave, anchored persistence, audio playback, AI overlays, role gating) explicitly deferred to the feature epics that own them. The designer gets the visual identity to iterate on three months earlier; we don't pay to build behavior twice.

## Story

As a frontend developer (and as the designer's collaborator),
I want the visual identity shells of the Phase 4 behavior-heavy components (`WriteDocSurface`, `WritingGradingSurface`, `SpeakingGradingSurface`, `AnchoredQuestionCard`, `MobileWritingSurface`, `InboxListShell` + `InboxRow`, `AnalyticsHomeShell` + `ScopeBar`) built as static, fixture-driven Storybook stories with NO behavior wiring,
so that the designer can iterate on the editorial-paper aesthetic, the comment-anchor taxonomy color, the band-score typography rhythm, the role-scoped inbox row vocabulary, and the analytics scope chrome **during** Epic 1D rather than waiting until Epics 5/6/7/8 land — while the behavior implementation (autosave, anchored persistence, audio playback, AI overlays) stays squarely in those feature epics where it belongs.

## Acceptance Criteria (BDD)

> **Static shells, not behavior.** Every component in this story ships as a typed React layout with fixture-driven render. NO autosave, NO real anchor persistence, NO audio playback state machine, NO real-time data fetching, NO AI overlay logic. The Storybook stories tell the visual story; the feature epics tell the behavior story.
>
> **No risk-score ≥6 ACs in this story.** Static visual shells carry no security surface, no tenant isolation, no auth flow. R38 (i18n parity) is inherited from 1d-1's CI gate.
>
> **Stories 1d-1, 1d-2, 1d-3 are hard dependencies.** This story consumes shadcn primitives from 1d-2, the `AppShell` from 1d-3, the decorator stack and `EmptyStatePlaceholder`/`ErrorStatePlaceholder` from 1d-1.

### AC1: `WriteDocSurface` — Docs-style writing canvas shell (`s34`)

**Given** the inventory's `WriteDocSurface` (deferred behavior: debounced autosave + draft recovery → Epic 5 Story 5.3),
**When** inspecting `src/components/domain/WriteDocSurface.tsx`,
**Then** the component renders the **static visual chrome** matching the `s34` mockup:
- Centered paper-surface container (max-width 768px, `--cl-paper` background, `--cl-line-soft` 1px border) on the `--cl-surface` canvas.
- Top strip: title input (Fraunces 32px) with a placeholder "Untitled essay" + autosave **indicator chrome only** ("Saved 2 mins ago" / "Saving…" / "Offline" pill — driven by a `saveState` prop, not a real timer).
- Toolbar: bold/italic/heading/list buttons composed from 1d-2's `Toggle` + `Button` primitives. The buttons render visual states; clicking them does NOT modify the canvas content.
- Body: a single `contentEditable={false}` div rendered with sample paragraph text (Geist 16px, line-height 1.6, max 65-char measure) — the body content is fixture-driven via a `content` prop.
- Footer strip: word count + time-on-task chrome (both fixture-driven via props).

**And** the explicit `Props` interface is:
```ts
export type SaveState = 'saved' | 'saving' | 'offline' | 'error'

export interface WriteDocSurfaceProps {
  /** Title displayed; defaults to "Untitled essay" i18n key when empty. */
  title?: string
  /** Body content rendered read-only (the real editor wiring lives in Epic 5). */
  content: ReactNode
  /** Visual chrome only — NO real timer or autosave behavior. */
  saveState: SaveState
  /** ISO timestamp string — never `new Date()` per TS-6. */
  savedAt?: string
  wordCount: number
  /** Seconds. Rendered as `M:SS`. */
  timeOnTaskSec: number
  /** Toolbar callbacks — feature stories wire these. Default no-ops in this story. */
  onFormat?: (cmd: 'bold' | 'italic' | 'heading' | 'list') => void
}
```

**And** the Storybook stories cover the visual identity:
- `Default` — populated essay, `saveState: 'saved'`, realistic Vietnamese sample text.
- `Saving` — `saveState: 'saving'`, indicator pulses.
- `Offline` — `saveState: 'offline'`, amber pill, no error state.
- `Empty` — `content` is the `EmptyStatePlaceholder` (per 1d-1's three-state convention).
- `Error` — `saveState: 'error'` with the `ErrorStatePlaceholder` strip above the toolbar.
- `LocaleEn` / `LocaleVi` — both render correctly (Vietnamese with diacritics, line-height integrity).

**And** the JSDoc explicitly notes: "Behavior — debounced autosave, draft recovery via `localStorage`, real timer — ships in Epic 5 Story 5.3. This shell is visual identity only."

### AC2: `WritingGradingSurface` — span-anchored grading rail shell (`s23`)

**Given** the inventory's `WritingGradingSurface` (deferred behavior: span-anchored comment persistence + AI per-comment review → Epic 6 Story 6.1),
**When** inspecting `src/components/domain/WritingGradingSurface.tsx`,
**Then** the component renders the **static visual chrome** matching the `s23` mockup:
- Two-column layout: paper-surface essay (left, 60% width) + comment rail (right, 40% width, `--cl-line` separator).
- Essay column: read-only render of submission text with **fixture-driven span highlights** — three highlight colors per the comment taxonomy:
  - **Red** (`--cl-status-danger`) for error spans — composed via inline `<mark class="cl-anchor-error">` wrappers in fixture content.
  - **Green** (`--cl-status-success`) for praise spans — `<mark class="cl-anchor-praise">`.
  - **Amber** (`--cl-accent-2`) for suggestion spans — `<mark class="cl-anchor-suggest">`.
- Comment rail column: stacked `CommentCard` sub-component renders, each with the corresponding taxonomy icon (red `!` / green `★` / amber `✎`), criterion label, comment body (Geist 14px), and `Resolve` / `Edit` action chips composed from 1d-2's `Button` primitive.
- Header strip above both columns: band-score chrome (Geist Mono 28px primary score per UX-DR22) + per-criterion breakdown row (Geist Mono 14px) + Submit / Save Draft action buttons (chrome only).

**And** the explicit `Props` interfaces:
```ts
export type CommentType = 'error' | 'praise' | 'suggest'

export interface AnchoredComment {
  id: string
  type: CommentType
  criterionKey: string  // i18n key — `criterion.taskAchievement`, etc.
  body: string  // fixture text; real i18n in Epic 6
  /** Anchor metadata — for visual rendering of which span is highlighted. NOT persistence. */
  anchor: { start: number; end: number; text: string }
  resolved?: boolean
}

export interface BandScoreBreakdown {
  primary: number  // e.g., 6.5
  /** Per-criterion subscores. UX-DR22 typography applies. */
  criteria: ReadonlyArray<{ criterionKey: string; score: number }>
}

export interface WritingGradingSurfaceProps {
  essayHtml: string  // pre-rendered fixture HTML with `<mark>` wrappers
  comments: ReadonlyArray<AnchoredComment>
  score: BandScoreBreakdown
  /** Visual chrome callbacks — feature epic wires these. */
  onCommentResolve?: (id: string) => void
  onCommentEdit?: (id: string) => void
  onSubmit?: () => void
  onSaveDraft?: () => void
}
```

**And** the Storybook stories cover:
- `Default` — fully populated essay with all three comment types, band 6.5 with criterion breakdown.
- `LongRail` — 12+ comments, demonstrating scroll behavior in the rail column.
- `RedHeavy` — 6 errors, 1 praise, 1 suggest — visual density check.
- `Resolved` — half the comments have `resolved: true` and render dimmed.
- `LocaleEn` / `LocaleVi` — both render correctly.
- `Empty` — no comments yet, rail shows `EmptyStatePlaceholder`.

**And** the JSDoc explicitly notes: "Behavior — span selection, anchor persistence, AI per-comment review, comment thread state — ships in Epic 6 Story 6.1. This shell is visual identity only."

### AC3: `SpeakingGradingSurface` — waveform + timestamp pin chrome (`s24`)

**Given** the inventory's `SpeakingGradingSurface` (deferred behavior: audio player + timestamp-pinned anchor persistence → Epic 6 Story 6.3),
**When** inspecting `src/components/domain/SpeakingGradingSurface.tsx`,
**Then** the component renders the **static visual chrome** matching the `s24` mockup:
- Top section: waveform render — a **static SVG fixture** showing a representative waveform shape (no audio decoding, no Web Audio API). Below the waveform, a horizontal time axis (00:00 — 02:45 fixture) and a play-button chrome (composed from 1d-2's `Button` `WithIcon` variant) that does NOT play audio.
- Pin chrome: timestamp-pinned comment markers overlaid on the waveform at fixture-supplied positions, using the same taxonomy colors as AC2 (red error / green praise / amber suggest).
- Right rail: stacked `CommentCard` sub-component (shared with AC2) rendering each pinned comment with its timestamp (`01:23` in Geist Mono).
- Header strip: band-score breakdown (4 speaking criteria per IELTS — fluency, lexical, grammar, pronunciation) using UX-DR22 typography.

**And** the explicit `Props` interface:
```ts
export interface TimestampedComment {
  id: string
  type: CommentType  // from AC2
  /** Seconds from start. */
  timestamp: number
  criterionKey: string
  body: string
  resolved?: boolean
}

export interface SpeakingGradingSurfaceProps {
  /** Total duration in seconds — drives axis rendering. */
  durationSec: number
  /** Pre-rendered waveform SVG path (fixture). The real audio decode is Epic 6. */
  waveformPath: string
  comments: ReadonlyArray<TimestampedComment>
  score: BandScoreBreakdown  // shared with AC2
  /** Chrome callback — feature epic wires playback. */
  onPlay?: () => void
  onCommentResolve?: (id: string) => void
}
```

**And** the Storybook stories cover:
- `Default` — 2:45 waveform, 6 pinned comments across all criteria.
- `LongRecording` — 8:00 waveform, demonstrating axis tick density.
- `MinimalComments` — 2 pins, band 8.0 — sparse-rail visual.
- `LocaleVi` — Vietnamese-language pins and criterion labels.

**And** the JSDoc explicitly notes: "Behavior — audio decode, Web Audio API playback, real timestamp pinning, anchor persistence — ships in Epic 6 Story 6.3. This shell is visual identity only."

### AC4: `AnchoredQuestionCard` — Docs-style Q&A card chrome (`s18`, `s36`)

**Given** the inventory's `AnchoredQuestionCard` (deferred behavior: anchored Q&A thread persistence + teacher batch handling → Epic 7 Story 7.4),
**When** inspecting `src/components/domain/AnchoredQuestionCard.tsx`,
**Then** the component renders the **static visual chrome** matching the `s18` (teacher answer) and `s36` (student ask) mockups:
- Card container: `--cl-surface` background, `--cl-line-soft` 1px border, 12px radius, soft shadow.
- Header: question author (avatar + name + role badge, role badge composed from 1d-2's `Badge`), anchor location chip (`Question 3, span "wisdom of crowds"`), timestamp (`2h ago` fixture string).
- Body: question text (Geist 14px) with the anchored excerpt rendered as a quote block (`--cl-paper` background, `--cl-line` left border, italic).
- Footer (teacher variant `s18`): textarea input chrome (no submit wiring), `AI suggest` button (composed from 1d-2's `Button` `Secondary` variant) — chrome only, no AI call.
- Footer (student variant `s36`): "Awaiting teacher response" pill or, when answered, the teacher's reply text rendered below with the teacher's avatar.

**And** the explicit `Props` interface:
```ts
export type QuestionVariant = 'teacher-answer' | 'student-ask'
export type QuestionState = 'awaiting' | 'answered'

export interface AnchoredQuestion {
  id: string
  variant: QuestionVariant
  state: QuestionState
  asker: { name: string; avatarUrl?: string | null; role: Role }
  questionText: string
  anchoredExcerpt: { text: string; location: string }  // `location` is a human-readable fixture like "Question 3, span 'wisdom of crowds'"
  /** Optional teacher reply — required when state is 'answered'. */
  teacherReply?: { name: string; avatarUrl?: string | null; text: string; timestamp: string }
  /** ISO timestamp — never `new Date()` per TS-6. */
  askedAt: string
}

export interface AnchoredQuestionCardProps {
  question: AnchoredQuestion
  /** Chrome callbacks — feature epic wires these. */
  onSubmitReply?: (text: string) => void
  onRequestAiSuggest?: () => void
}
```

**And** the Storybook stories cover:
- `TeacherAnswer_Awaiting` — `s18` variant with empty reply textarea + AI suggest chrome.
- `TeacherAnswer_Answered` — teacher's reply rendered below the question.
- `StudentAsk_Awaiting` — `s36` variant with "Awaiting teacher response" pill.
- `StudentAsk_Answered` — teacher reply rendered with avatar + timestamp.
- `LongQuestion` — multi-paragraph question, scroll behavior in card body.
- `LocaleVi` — Vietnamese question + reply text, diacritic rendering.

**And** the JSDoc explicitly notes: "Behavior — Q&A thread persistence, batch handling, anchor-to-exercise reverse lookup, AI suggestion call — ships in Epic 7 Story 7.4. This shell is visual identity only."

### AC5: `MobileWritingSurface` — phone-sized writing canvas chrome (`s78`)

**Given** the inventory's `MobileWritingSurface` (deferred behavior: mobile-specific autosave + Vietnamese IME handling → Epic 5 Story 5.3 mobile variant),
**When** inspecting `src/components/domain/MobileWritingSurface.tsx`,
**Then** the component renders the **static visual chrome** matching the `s78` mockup (390x844 reference):
- Full-viewport `--cl-paper` canvas with a fixed top app-bar (back arrow + autosave indicator chrome + word count) and a fixed bottom toolbar (4 format icons composed from 1d-2's `Toggle` `WithIcon` variant).
- Body: contentEditable=false div with Geist 16px (per UX-4 mobile font minimum), generous line-height (1.7).
- Sticky word counter as the inventory specifies — a small pill at bottom-right that floats above the toolbar when scrolled.
- This is a **purpose-designed mobile** component, NOT a responsive squish of `WriteDocSurface` (per UX-4 + UX-DR32).

**And** the explicit `Props` interface:
```ts
export interface MobileWritingSurfaceProps {
  title?: string
  content: ReactNode
  saveState: SaveState  // shared with AC1
  wordCount: number
  onBack?: () => void
  onFormat?: (cmd: 'bold' | 'italic' | 'heading' | 'list') => void
}
```

**And** the Storybook stories cover:
- `Default` — 390x844 viewport, populated essay.
- `Empty` — `EmptyStatePlaceholder` content.
- `Saving` — autosave indicator chrome animates.
- `LocaleVi` — Vietnamese with diacritics, IME-friendly line-height.

**And** the Storybook viewport is locked to `iphone-14` (390x844) via `parameters.viewport.defaultViewport`.

**And** the JSDoc explicitly notes: "Behavior — mobile autosave, IME composition handling, real word counter — ships in Epic 5 Story 5.3 mobile variant. This shell is visual identity only."

### AC6: `InboxListShell` + `InboxRow` — per-role inbox chrome (`s50`, `s51`, `s52`)

**Given** the inventory's `InboxListShell` + `InboxRow` (deferred behavior: real-time polling + notification fetching + per-row action wiring → Epic 10 Story 10.1),
**When** inspecting `src/components/domain/InboxListShell.tsx` and `src/components/domain/InboxRow.tsx`,
**Then** the components render the **static visual chrome** matching the role-scoped inbox mockups:

`InboxListShell` — the container:
- Top filter chip bar (composed from 1d-2's `Badge` `Removable` variant + `ToggleGroup` from AC1).
- Vertically stacked list of `InboxRow` children.
- Right-side actions strip per row (Resolve / Reply / Archive — chrome only).

`InboxRow` — three role-specific variants:
- **Teacher row** (`s50`): icon (question / submission / mention) + main text (`<student> asked about <exercise>`) + meta (class name, time) + action chips.
- **Student row** (`s51`): icon (reply / grade / comment / assignment / schedule) + main text (`<teacher> replied to your question`) + meta + action chip.
- **Admin/Owner row** (`s52`): icon (enrolment / staff / billing / integration) + main text (`<student> requested enrolment`) + meta + action chips.

**And** the explicit `Props` interfaces:
```ts
export type InboxRowType =
  | 'question'      // teacher + student
  | 'submission'    // teacher
  | 'mention'       // teacher + student
  | 'reply'         // student
  | 'grade'         // student
  | 'assignment'    // student
  | 'schedule'      // student
  | 'enrolment'     // admin/owner
  | 'staff'         // admin/owner
  | 'billing'       // admin/owner
  | 'integration'   // admin/owner

export interface InboxRowData {
  id: string
  type: InboxRowType
  /** i18n key for the main text with interpolation placeholders. */
  mainTextKey: string
  mainTextVars: Record<string, string>
  /** Meta line — class name, time, etc. */
  metaKey: string
  metaVars: Record<string, string>
  /** ISO timestamp — never `new Date()` per TS-6. */
  occurredAt: string
  unread?: boolean
}

export interface InboxRowProps {
  row: InboxRowData
  role: Role
  onPrimaryAction?: () => void
  onArchive?: () => void
}

export interface InboxListShellProps {
  rows: ReadonlyArray<InboxRowData>
  role: Role
  /** Active filter chip keys — chrome only, no actual filtering. */
  activeFilters: ReadonlyArray<string>
  /** Filter chip toggle — chrome only. */
  onToggleFilter?: (key: string) => void
}
```

**And** the Storybook stories cover:
- `TeacherView` — `s50` mockup parity: 8 rows across question / submission / mention types.
- `StudentView` — `s51` mockup parity: 8 rows across reply / grade / assignment / schedule types.
- `AdminOwnerView` — `s52` mockup parity: 6 rows across enrolment / staff / billing / integration types.
- `Empty` — `EmptyStatePlaceholder` per role.
- `FiltersActive` — multiple filter chips active, demonstrating chip pill density.
- `LocaleEn` / `LocaleVi` — both render correctly with per-role copy.
- Per UX-3, three SEPARATE Storybook role-variant stories — NOT a single conditional component.

**And** the JSDoc explicitly notes: "Behavior — TanStack Query inbox polling, action wiring, real notification routing — ships in Epic 10 Story 10.1. This shell is visual identity only."

### AC7: `AnalyticsHomeShell` + `ScopeBar` — role-scoped analytics chrome (`s45`, `s48`)

**Given** the inventory's `AnalyticsHomeShell` + `ScopeBar` (deferred behavior: real chart data fetching, scope-driven query refetch → Epic 8 Story 8.2),
**When** inspecting `src/components/domain/AnalyticsHomeShell.tsx` and `src/components/domain/ScopeBar.tsx`,
**Then** the components render the **static visual chrome** matching `s45` (analytics home — class/student branch) and `s48` (admin/owner dashboard analytics chrome):

`ScopeBar` — the top scope strip per UX-DR29:
- Pill toggle: **My classes** / **All classes** (teacher; teacher sees only "My classes" — render pill but disabled) vs **Center-wide** (admin/owner; full pill set).
- Class picker dropdown (composed from 1d-2's `Select`).
- Date-range picker (composed from 1d-2's `Calendar` `Range` story variant).

`AnalyticsHomeShell` — the container:
- Header: `PageHead` from 1d-3.
- `ScopeBar` underneath.
- Body: 2-column grid for two analytics-card slots (consumer passes children). Each slot has a chart-area chrome (`Skeleton` Rectangle from 1d-2 stands in for the eventual chart) + a metric strip below.

**And** the explicit `Props` interfaces:
```ts
export type AnalyticsScope = 'mine' | 'all' | 'center-wide'

export interface ScopeBarProps {
  role: Role
  activeScope: AnalyticsScope
  /** Disabled scopes per role — teacher disables 'center-wide' visually. */
  disabledScopes?: ReadonlyArray<AnalyticsScope>
  selectedClassId?: string | null
  classOptions: ReadonlyArray<{ id: string; nameKey: string }>
  dateRange: { startIso: string; endIso: string }  // ISO strings per TS-6
  onScopeChange?: (scope: AnalyticsScope) => void
  onClassChange?: (classId: string | null) => void
  onDateRangeChange?: (range: { startIso: string; endIso: string }) => void
}

export interface AnalyticsHomeShellProps {
  role: Role
  /** Slot children — consumer passes analytics cards (chart-area chrome). */
  children: ReactNode
  /** Header config passes through to PageHead from 1d-3. */
  titleKey: string
  subKey?: string
  scopeBar: ScopeBarProps
}
```

**And** the Storybook stories cover:
- `TeacherView` — `s45` mockup parity, "My classes" pill active, "Center-wide" pill disabled.
- `AdminView` / `OwnerView` — `s48` mockup parity, all scope pills enabled.
- `ClassPickerOpen` — `Select` dropdown open with 5 fixture class options.
- `DateRangeSelected` — calendar `Range` story integrated.
- `LocaleEn` / `LocaleVi`.

**And** the JSDoc explicitly notes: "Behavior — TanStack Query analytics fetching, scope-aware refetch, RBAC enforcement on scope changes — ships in Epic 8 Story 8.2. This shell is visual identity only. RBAC is the route layer's job per UX-3."

### AC8: i18n, axe-core, FW-7 placement, and stable selectors across all 1d-4 shells

**Given** all eight 1d-4 components are built,
**When** the Storybook test-runner from 1d-1 runs,
**Then**:
- Zero `axe-core` violations across every story export.
- `assertI18nParity()` from 1d-1 AC4 passes (every new key added is in both `en.json` and `vi.json`).
- All eight components live under `src/components/domain/` per FW-7.
- Every interactive element has a `data-testid` selector for downstream feature epics' integration tests.
- All ISO timestamps in stories use `parameters.now: '2026-06-15T00:00:00Z'` patterns (per TS-6) — zero `new Date()` calls.

**And** all eight components ship with a header comment that names the feature epic + story that will wire the behavior:
- `WriteDocSurface` → Epic 5 Story 5.3
- `WritingGradingSurface` → Epic 6 Story 6.1
- `SpeakingGradingSurface` → Epic 6 Story 6.3
- `AnchoredQuestionCard` → Epic 7 Story 7.4
- `MobileWritingSurface` → Epic 5 Story 5.3 mobile variant
- `InboxListShell` + `InboxRow` → Epic 10 Story 10.1
- `AnalyticsHomeShell` + `ScopeBar` → Epic 8 Story 8.2

## Tasks / Subtasks

- [ ] **Task 1 (AC1):** Build `WriteDocSurface` static shell + 6 stories. Verify Vietnamese diacritic rendering + Fraunces typography rhythm.
- [ ] **Task 2 (AC2):** Build `WritingGradingSurface` static shell + 6 stories. Verify three-color anchor taxonomy (red/green/amber) and band-score Geist Mono typography per UX-DR22.
- [ ] **Task 3 (AC3):** Build `SpeakingGradingSurface` static shell + 4 stories. Ship the fixture waveform SVG (no audio decode).
- [ ] **Task 4 (AC4):** Build `AnchoredQuestionCard` static shell + 6 stories. Verify teacher (`s18`) and student (`s36`) variants render with correct authorship chrome.
- [ ] **Task 5 (AC5):** Build `MobileWritingSurface` static shell + 4 stories at locked 390x844 viewport. Verify NOT a responsive squish.
- [ ] **Task 6 (AC6):** Build `InboxListShell` + `InboxRow` static shells + per-role stories matching `s50`/`s51`/`s52`. Verify three distinct role-variant stories per UX-3.
- [ ] **Task 7 (AC7):** Build `AnalyticsHomeShell` + `ScopeBar` static shells + per-role stories matching `s45`/`s48`. Verify scope-pill disablement chrome for teacher role per UX-DR29.
- [ ] **Task 8 (AC8):** Verify axe-core + i18n parity + FW-7 placement + `data-testid` selectors + no `new Date()` in render across all 8 components.

## Dev Notes

- **Static-shells discipline (the load-bearing constraint of this story):** Every callback prop (`onSubmit`, `onPlay`, `onCommentResolve`, `onPrimaryAction`, etc.) defaults to a no-op in this story. NO Storybook story passes a callback that does anything beyond a console log. Behavior wiring is explicitly Epic 5/6/7/8 work. A peer review hint: if you find yourself adding `useEffect`, `useState` for data-fetching, or `useMutation` to any 1d-4 component, STOP — that's behavior, not visual identity, and belongs in a feature epic.

- **Stack reminders:**
  - React 19 — refs are plain props; no `forwardRef`.
  - Vite 8 (Rolldown) — validated by 1d-1 spike.
  - TypeScript strict — every component has explicit Props.
  - shadcn/ui — primitives in `src/components/ui/`, NEVER hand-edited (XL-1 + FW-7).
  - Tailwind utility classes — no inline `style={{}}`.

- **Mock seam — there isn't one (TEST-FE-1):** Static shells don't fetch data. Storybook stories drive every render via fixture props. No MSW handlers are needed in this story. When feature epics inherit these shells, they wire MSW at the HTTP boundary per their own ACs.

- **i18n is co-primary (UX-2 + NFR-1 + R38 score 6):** Every story renders correctly in both `en` and `vi`. AC8's `assertI18nParity()` enforces. Vietnamese diacritic rendering on Fraunces (`s34`/`s23`) is a specific check — sample text in stories MUST include diacritics (à, ằ, ư, ơ, đ).

- **Role-based rendering uses separate components, not conditional branches (UX-3):** `InboxListShell` ships three role-variant Storybook stories — `TeacherView`, `StudentView`, `AdminOwnerView` — NOT one component branching on role internally. The role-variant content (row taxonomy) is data-driven from `role` prop, but the visual treatment is shared. Same for `AnalyticsHomeShell` (per UX-DR29).

- **`AnchoredQuestionCard` variant rationale:** the teacher (`s18`) and student (`s36`) chrome differs enough (teacher gets composer + AI suggest; student gets awaiting pill or reply readback) that they ship as ONE component with a `variant` prop, not two components. The variant is layout-level (which footer block to render), NOT role-conditional logic per UX-3 — it's the same kind of layout switch as `Tabs`.

- **WF-3 codegen note:** This story does not touch `api.yaml` or `.sql` files. `codegen.sh` does NOT need to run.

- **WF-7 service boundary:** All work stays within `classlite-web/` — fixtures are hand-authored, no imports from `src/generated/`.

- **FW-7 placement:** Every component sits at `src/components/domain/`. Sub-components like `CommentCard` (used by AC2 and AC3) are co-located: `src/components/domain/CommentCard.tsx` — domain tier because it's used by multiple shells.

- **TS-6 (no `new Date()` in render):** Every ISO string in fixtures uses the `parameters.now: '2026-06-15T00:00:00Z'` pattern from 1d-2 `Calendar.stories.tsx`. The audit task at AC8 greps for `new Date()` in `src/components/domain/`'s 1d-4 files and asserts zero occurrences.

- **The designer's iteration loop:** This story is the designer's most valuable Storybook surface. Once 1d-4 ships, the visual identity of ClassLite is available end-to-end — paper canvas, anchor taxonomy color, band-score typography, inbox row vocabulary, analytics scope chrome. Tweaks land via Story 1.7a token-file updates (color, radius, typography scale), and these shells re-render with the new tokens. Per Sally's review: this story is the stained glass of the cathedral.

## Definition of Done

- [ ] Murat's `/bmad-tea TD` gate is passed for Epic 1D (R38 mitigation from 1d-1 in place).
- [ ] All 8 ACs discharged.
- [ ] 8 components (9 files counting `InboxRow` and `ScopeBar` as separate files; CommentCard sub-component shared between AC2 and AC3) live at `src/components/domain/`.
- [ ] Every component ships its full Storybook story matrix (Default + variants + LocaleEn/Vi + Empty/Error placeholders where applicable).
- [ ] Zero `axe-core` violations across all stories via `npm run storybook:test`.
- [ ] `assertI18nParity()` passes — every new key in both `en.json` and `vi.json`.
- [ ] Zero `new Date()` calls in any 1d-4 component file (greppable).
- [ ] Every component has a JSDoc note naming the feature epic + story that will wire behavior.
- [ ] CI `storybook` job from 1d-1's AC6 stays green within the 8-minute soft cap.
- [ ] Designer notified that the Phase 4 visual bridge is ready for review — the visual identity of the writing canvas, grading rail, Q&A card, mobile writing surface, inbox rows, and analytics chrome can now be iterated on in Storybook.

## Out of Scope

- All Phase 4 behavior — autosave (Epic 5), span anchor persistence (Epic 6), audio decode/playback (Epic 6), Q&A thread persistence (Epic 7), inbox polling (Epic 10), analytics data fetching (Epic 8).
- The `WritingGradingSurface` AI per-comment review pane — Epic 6 Story 6.2.
- The `SpeakingGradingSurface` AI auto-transcription pane — Epic 6 Story 6.3 AI variant.
- The student `s33` exercise attempt variants (MCQ / writing canvas / speaking recorder) — Epic 5 Stories 5.2/5.3/5.4 ship those.
- `EmptyState`, `ErrorState`, `LoadingSkeleton` shape-semantic patterns — Epic 10 Story 10.3/10.4 ship those; 1d-4 stories use `EmptyStatePlaceholder` / `ErrorStatePlaceholder` from 1d-1 until then.
- `DashboardHero` role variants — deferred with old 1d-4 to Epic 8 Story 8.1.
- `BandScoreChart` — deferred with old 1d-4 to Epic 8 Story 8.3. (1d-4 ships the static band-score *strip* visual in AC2/AC3; the *chart* is Epic 8.)
- `WritingGradingSurface` keyboard-shortcut comment-cycling — Epic 6 Story 6.1 (TEST-UX-2 covers it there).
- Performance benchmarks — not in MVP scope.
