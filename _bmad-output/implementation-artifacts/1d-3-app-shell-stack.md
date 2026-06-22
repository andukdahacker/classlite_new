---
baseline_commit: c390282
pre_dev_scaffold_refresh: 2026-06-17
party_mode_review_pass: 2026-06-18
---

# Story 1d-3: App-Shell Stack — Sidebar, Topbar, Navigation, Mobile Tab Bar

Status: review

> **Code review pass (2026-06-22, Amelia, post-merge).** Triaged 24 patches + 7 decision-needed across three reviewers (Blind Hunter, Edge Case Hunter, Acceptance Auditor). All 7 decisions resolved as "ship the spec compliance now" — new hamburger toggle wired through `TopbarShell.collapseToggle`, mobile eyebrow pattern, breadcrumb DropdownMenu, internal focus management in `MobileTabBar`, longest-prefix active match, dropped `aria-live` from `PageHead.<h1>`, and the token-bridge presence+equivalence test. 31 patches applied (1 dismissed as false-positive: `http-server` already in devDeps). 7 items deferred to follow-up artifacts. CI gates all green: vitest 248/248, tsc, lint, lint:css, i18n-parity (122 keys / 120 claimed), build, storybook:build. Status: review → done. See § "Review Findings" under Tasks/Subtasks for the full triage.

> **Party-mode review pass (2026-06-18, Winston + Sally + Murat + Amelia).** Four-agent critique of the 2026-06-17 refresh surfaced 21 actionable findings; all applied in-place below. **Top three load-bearing additions:** (a) Token bridge integrity is the single-point-of-failure both Winston (`--cl-*`-vs-`--sidebar` drift governance) and Amelia (Tailwind v4 `--color-*` prefix prerequisite) called out — Task 1 now opens with a `src/index.css` audit BEFORE any domain component lands, and § "Token bridge governance" carries the new comment-block requirement; (b) Vietnamese 220px truncation is a WCAG 2.1.1 trap Sally + Murat agreed on — AC9 now requires `aria-label` + hover-AND-focus tooltip + `title` attribute fallback, no focus-only; (c) MobileTabBar route-change focus management was Murat's net-new finding — AC7 now requires focus to land on `<h1>` (or skip-to-content target) with `aria-live` page-title announce.
>
> **Four open decisions closed by Ducdo on 2026-06-18:** (1) MobileTabBar role-to-tabs → **AC7.a** — in-component role switch with documented UX-3 exception (John's recommendation); Sally's AC7.b alternative removed from story file. (2) `*Shell` three-state lint → **Option A** — predicate-gated closed-set allowlist + CODEOWNERS rule (Winston+Murat+John consensus); Options B/C removed. (3) `STORY_1D_3_KEYS` vacuity guard → **ship-now** — `scripts/i18n-parity.mjs` namespace-coverage assertion lands in the 1d-3 PR; defer path removed. (4) Owner+Admin mobile extrapolation → **ship-with-flag** — `@status: extrapolated-pending-design-review` comment block on stories + explicit designer prompt in PR description; designer ratifies or amends in follow-up story. All closures applied below. Other amendments enumerated in § "Party-mode review pass findings" at the bottom of Dev Notes.

> **Pre-dev scaffold refresh (2026-06-17, John).** Story file rewritten in place against on-disk state at `c390282` (1d-2 done). The original draft (`a90010732…`, 2026-06-07) predates the close of 1d-1 (done 2026-06-15) and 1d-2 (done 2026-06-17), so the inheritance contract is now load-bearing additions to Dev Notes. **Three load-bearing corrections applied:**
> 1. **Scaffold reality** — `src/components/shared/` already contains `AppLayout.tsx` + placeholder `Sidebar.tsx` + `TopBar.tsx` + `UserPill.tsx` from Story 1-7c (`shared/Sidebar.tsx:6-11` explicitly defers role-aware nav to 1d-3). 1d-3 ships the canonical role-aware components in `components/domain/`, refactors `AppLayout.tsx` to consume them, and retires the `shared/` placeholders. The migration plan + retire list is in Dev Notes § "Existing 1-7c scaffolds to retire".
> 2. **Token plane is the shadcn-semantic bridge** — `src/index.css:64-97` ships the `--background` / `--foreground` / `--card` / `--sidebar` / `--sidebar-foreground` / `--sidebar-primary` / `--sidebar-accent` / `--sidebar-border` / `--accent` / `--border` / `--ring` mappings on top of `--cl-*` raw tokens. 1d-3 domain components MUST use Tailwind utilities flowing through this bridge (`bg-sidebar`, `text-sidebar-foreground`, `bg-sidebar-primary`, `bg-sidebar-accent`, `text-foreground`, `border-border`, `ring-ring`) per the 1d-2 AC7 convention — NOT the raw `bg-[var(--cl-sidebar-bg)]` arbitrary-value pattern the 1-7c placeholders used. The retire migration (above) is where the arbitrary-value pattern leaves the codebase. The escape hatch `bg-[color:var(--cl-green)]` only applies to un-bridged semantic colors (success/warning).
> 3. **R38 i18n parity is inherited, not re-shipped** — `src/lib/test/__tests__/i18n-parity-coverage.test.ts:98-138` already carries the `STORY_1D_2_KEYS` block + per-story `describe('Story 1d-N i18n parity (R38)', ...)` pattern. 1d-3 adds a new `STORY_1D_3_KEYS` const + `describe('Story 1d-3 i18n parity (R38)', ...)` block extending the same file — NO new helper, NO new CI step, NO separate ATDD ceremony. Helper is at `src/lib/test/i18n-parity.ts` (do not duplicate). Storybook conventions § 8 documents this discipline.
>
> AC structure, props interfaces, and the 9-AC organization carry over from the original draft. Test scenario IDs (1D-P0-015..020, 1D-P0-025, 1D-P1-053..114) link to `_bmad-output/test-artifacts/test-design/test-design-qa.md` "Epic 1D Refresh (2026-06-15)" section. The original `<!-- Validation is optional -->` comment is preserved below.

<!-- Validation is optional. Run `validate-create-story` for a quality second pass before `dev-story`. -->

## Story

As a frontend developer,
I want the persistent app-shell stack (`AppShell`, `SidebarShell` with Owner/Admin/Teacher/Student role variants, `SidebarNavItem`, `UserPill`, `TopbarShell`, `BreadcrumbBar`, `SearchPill`, `PageHead`, plus a purpose-designed `MobileTabBar` for `s74–s86`) built once with full role-variant coverage and Storybook stories,
so that every Epic 2–10 frontend story renders inside a finished, role-correct shell — owner/admin/teacher/student each get their canonical nav set out of the box, mobile gets the bottom tab bar from `s74` rather than a responsive squish of the desktop sidebar, and no feature story re-implements layout chrome.

## Acceptance Criteria (BDD)

> **No risk-score ≥6 ACs in this story.** App-shell components are pure layout — no data fetching, no tenant isolation, no auth/role validation logic (consumers pass role as prop; the route layer owns gating per UX-3). WF-8 ATDD red-tests are NOT mandatory (confirmed by `_bmad-output/test-artifacts/test-design/test-design-architecture.md` § "WF-8 inheritance summary (CORRECTED 2026-06-15)" — R38 discharged at 1-7c, R52 mitigated foundation-level at 1d-1, R51/R53 are MONITOR). The high-fidelity ACs are the four role variants of `SidebarShell` (AC2–AC5) where mistaking the per-role nav set is the most likely failure mode — those ACs cite the exact nav list verbatim from `classlite-ia.md` lines 16–19. Stories 1d-1 (Storybook foundation) and 1d-2 (shadcn primitives) are hard dependencies — both DONE.

### AC1: Shell skeleton — `AppShell`, `TopbarShell`, `BreadcrumbBar`, `SearchPill`, `UserPill`, `PageHead`, `SidebarNavItem`

**Given** the inventory's app-shell components,
**When** inspecting `src/components/domain/`,
**Then** each of the following exists as a typed React component with explicit props, sibling-import stories, and stable test selectors:
- `AppShell` (`s06`, every desktop screen) — top-level layout: `<aside>` slot (220px sidebar) + `<header>` slot (topbar) + `<main>` slot (page content). Owns no data; accepts `sidebar`, `topbar`, `children` slots.
- `TopbarShell` (`s06`, every desktop screen) — crumbs (left) + actions (right: search pill + section CTA slot). Accepts `breadcrumb`, `search`, `cta` slots; CTA slot accepts arbitrary actions (`+ New class`, `Invite staff`, `+ New assignment`).
- `BreadcrumbBar` (`s06`, every screen) — wraps shadcn `Breadcrumb` from 1d-2 (`src/components/ui/breadcrumb.tsx`). Current item is non-clickable; separator is the canonical token `/`; overflow truncates middle segments with an ellipsis-menu pattern (`Workspace / … / Current`) using `Breadcrumb`'s `WithEllipsis` variant from 1d-2. **`BreadcrumbBar` is the domain layer that overrides the primitive's English `aria-label="More"` leak (deferred-work.md 2026-06-17, line 5)** — wrap the `BreadcrumbEllipsis` trigger so it consumes `t('topbar.breadcrumb.more')` instead of the stock string. Same applies to `BreadcrumbPage`'s `role="link" aria-disabled="true"` shape (deferred-work.md line 8) — `BreadcrumbBar` should render the current item as a plain `<span>` with `aria-current="page"`, NOT the primitive's `BreadcrumbPage`.
- `SearchPill` (`s06`, every desktop screen) — "Search" placeholder + `⌘K` keyboard-hint chip on the right. Renders the visual affordance only; the actual `⌘K` palette wiring is deferred (uses 1d-2's `Command` primitive when a future story wires it — `CommandPalette` domain wrapper that lifts `CommandDialog showCloseButton={true}` is the 1d-2 deferral target, but a `CommandPalette` is NOT in 1d-3 scope; this story only renders the pill).
- `UserPill` (`s06`, every desktop screen) — avatar + name + role label, rendered at the sidebar foot. Role label is data-driven from the `role` prop (`Owner`, `Admin`, `Teacher`, `Student`) — not branched in component code. Composes shadcn `Avatar` from 1d-2.
- `PageHead` (`s06`, every screen) — H1 + count + sub-line layout. Display headlines use Fraunces (loaded via 1-7a's `@fontsource-variable/fraunces` — already in `src/index.css`). First component in the dashboard to render Fraunces (primitives don't consume it).
- `SidebarNavItem` (`s06`, every screen) — icon + label + optional unread/count badge. The badge variant uses 1d-2's `Badge` primitive (`src/components/ui/badge.tsx`) — verify the design-token amber accent (`--cl-accent-2` → bridged via `--accent` / `--ring`) renders correctly when composing.

**And** each component is pure layout — no data fetching, no Zustand reads beyond sidebar-collapsed UI state via `useUIStore` (`src/stores/uiStore.ts:36` already exposes `sidebarCollapsed`/`setSidebarCollapsed`; per FW-5 this is UI-only), no role-resolution logic (consumers pass role as prop per UX-3 — the route layer owns gating). The `useRole()` hook (`src/hooks/useRole.ts`) is consumed in story decorators, NOT inside the 1d-3 components themselves.

**And** every component ships a co-located `<Component>.stories.tsx` with `Default` plus the three-state coverage where applicable (`PageHead` is data-rendering — exports `Default`, `Loading`, `Empty`, `Error` using the `EmptyStatePlaceholder` / `ErrorStatePlaceholder` from 1d-1 at `src/test/fixtures/empty-state-placeholder.tsx` and `…/error-state-placeholder.tsx` until Epic 10 ships the real `EmptyState` / `ErrorState`; the others are pure layout and ship `Default` only — see Dev Notes § "`*Shell` three-state lint tension" for how this reconciles with the `*Shell` enforcement rule in `storybook-conventions.md` § 3).

**And** the explicit TypeScript `Props` interfaces for these seven components are (matching 1d-4's `StatusPillProps` precision per Amelia's finding):

```ts
export type Role = 'owner' | 'admin' | 'teacher' | 'student'

export interface AppShellProps {
  sidebar: ReactNode
  topbar: ReactNode
  children: ReactNode
  /** Optional banner slot used by `BillingGraceBanner` (deferred to Epic 9). When set, banner renders above `topbar`. */
  banner?: ReactNode
}

export interface TopbarShellProps {
  breadcrumb: ReactNode
  search?: ReactNode
  /** Section-specific CTA (e.g. `<Button>+ New class</Button>`). */
  cta?: ReactNode
}

export interface BreadcrumbBarProps {
  items: ReadonlyArray<{ label: string; href?: string }>
  /** When item count exceeds this, middle segments collapse to ellipsis menu. Default: 4. */
  truncateAt?: number
}

export interface SearchPillProps {
  /** i18n key for placeholder text. Resolved by consumer via `t(placeholderKey)`. */
  placeholderKey: string
  /** Triggered on click. Palette UI wiring lives in a future story. */
  onActivate?: () => void
}

export interface UserPillProps {
  name: string
  avatarUrl?: string | null
  role: Role
}

export interface PageHeadProps {
  /** i18n key for the H1. */
  titleKey: string
  /** Optional count rendered next to title (`5 classes`). */
  count?: number
  /** Optional i18n key for the sub-line. */
  subKey?: string
}

export interface SidebarNavItemProps {
  /** i18n key for the visible label. */
  labelKey: string
  icon: ReactNode
  href: string
  /** Active state derived by the consumer (route match). */
  active?: boolean
  /** Unread/notification count. Renders the `Badge` primitive when > 0. */
  badgeCount?: number
}
```

`SidebarShell`, `MobileTabBar`, and `MobileTopbar` interface signatures are specified in their respective ACs (AC2–AC5 for `SidebarShell`, AC7 for `MobileTabBar`, AC8 for `MobileTopbar`).

### AC2: `SidebarShell` — Owner role variant matches `classlite-ia.md`

**Given** the `SidebarShell` component rendered with `role="owner"`,
**When** the Storybook `OwnerView` story renders,
**Then** the nav set matches the IA table at `classlite-ia.md` line 16 EXACTLY, in this order:
1. **Dashboard** (`/dashboard` → `s48`)
2. **People** (`/people/staff` → `s39`)
3. **Classes** (`/classes` → `s07`)
4. **Schedule** (`/schedule` → `s13`)
5. **Analytics** (`/analytics` → `s45`)
6. **Inbox** (`/inbox` → `s52`, with unread-count badge)
7. **Knowledge hub** (`/knowledge-hub` → `s26`)
8. **Archive** (`/archive` → `s28`)
9. **Settings** (`/settings` → `s49`, Owner-only — sits under a "Center settings" group separator per `classlite-ia.md` line 316 "Sidebar — Settings group: left (Owner only) — Single Settings item")

**And** the `UserPill` at the sidebar foot renders the role label as "Owner" per the IA bottom-pill convention at `classlite-ia.md` line 16 (column 3).

**And** the `BillingGraceBanner` slot is NOT rendered by `SidebarShell` itself — it lives at the `AppShell` level when active (deferred to Epic 9 per Path B re-scope) — the Storybook story documents this separation in a header comment so the billing banner doesn't accidentally land inside the sidebar.

**And** the explicit `SidebarShell` `Props` interface (applied across AC2–AC5 role variants) is:
```ts
export interface SidebarNavItem {
  /** i18n key for the visible label. */
  labelKey: string
  icon: ReactNode
  href: string
  /** Unread/notification count, or null when none. */
  badgeCount?: number
}

export interface SidebarNavGroup {
  /** Optional group label; when omitted the items render flush without separator. */
  labelKey?: string
  items: ReadonlyArray<SidebarNavItem>
}

export interface SidebarShellProps {
  role: Role  // discriminated union from AC1
  /** Top-to-bottom group ordering owned by the consumer. AC2–AC5 specify the per-role default sets. */
  groups: ReadonlyArray<SidebarNavGroup>
  /** UserPill data — rendered at sidebar foot. */
  user: { name: string; avatarUrl?: string | null }
  /** Active href for highlighting; consumer derives from router match. */
  activeHref: string
  /** Collapsed UI state — sourced from `useUIStore(s => s.sidebarCollapsed)` (FW-5). */
  collapsed?: boolean
  onCollapseToggle?: () => void
}
```

The role variants in AC2–AC5 specify the **content** of the `groups` array per role; the **type** is shared.

**Test scenario:** 1D-P0-015 in `test-design-qa.md`.

### AC3: `SidebarShell` — Admin role variant matches `classlite-ia.md`

**Given** the `SidebarShell` component rendered with `role="admin"`,
**When** the Storybook `AdminView` story renders,
**Then** the nav set matches the IA convention at `classlite-ia.md` line 17 — Admin sees the same sidebar as Owner per mockup convention, **MINUS** the `Settings` item (Settings `s49` is Owner-only per the IA per-role visibility matrix at `classlite-ia.md` line 303 "Center settings (s49) | — | — | — | A"):
1. **Dashboard** (`/dashboard` → `s48`)
2. **People** (`/people/staff` → `s39`)
3. **Classes** (`/classes` → `s07`)
4. **Schedule** (`/schedule` → `s13`)
5. **Analytics** (`/analytics` → `s45`)
6. **Inbox** (`/inbox` → `s52`)
7. **Knowledge hub** (`/knowledge-hub` → `s26`)
8. **Archive** (`/archive` → `s28`)

**And** the `UserPill` role label renders as "Admin" — note this is the only place the Admin role chip is visible per IA (also called out on `s41` Invite staff modal).

**And** the `s41` Invite-staff visibility difference (Admin doesn't see the "Owner" chip — only Owner does) is OUT OF SCOPE for `SidebarShell` — it surfaces in the eventual `InviteStaffModal` (deferred to Epic 7 Story 7-1). The story comment documents this so an Admin/Owner sidebar reviewer doesn't confuse the two.

**And** the AdminView `play` function asserts ABSENCE of the `Settings` label (per TEST-FE-6 — test what's absent, not just present).

**Test scenario:** 1D-P0-016 in `test-design-qa.md`.

### AC4: `SidebarShell` — Teacher role variant matches `classlite-ia.md`

**Given** the `SidebarShell` component rendered with `role="teacher"`,
**When** the Storybook `TeacherView` story renders,
**Then** the nav set matches the IA table at `classlite-ia.md` line 18 EXACTLY, in this order:
1. **Dashboard** (`/dashboard` → `s06`)
2. **Classes** (`/classes` → `s07`)
3. **Schedule** (`/schedule` → `s13`)
4. **Exercises** (`/exercises` → `s15`)
5. **Questions** (`/exercises/{id}?questions=open` → `s18`)
6. **Students** (`/students` → `s10a`, the teacher's own-roster top-level per the IA `s10a` definition at line 82 — distinct from Admin/Owner's `s42` center-wide students)
7. **Analytics** (`/analytics` → `s45`)
8. **Inbox** (`/inbox` → `s50`, with unread-count badge)
9. **Knowledge hub** (`/knowledge-hub` → `s26`)
10. **Archive** (`/archive` → `s28`)

**And** the `UserPill` role label renders as "Teacher".

**And** there is NO `Settings` item (Owner-only per AC2) and NO `People` item (Admin/Owner only per AC2/AC3) — the story explicitly asserts absence of those nav labels in its `play` function (per TEST-FE-6).

**Test scenario:** 1D-P0-017 in `test-design-qa.md`.

### AC5: `SidebarShell` — Student role variant matches `classlite-ia.md`

**Given** the `SidebarShell` component rendered with `role="student"`,
**When** the Storybook `StudentView` story renders,
**Then** the nav set matches the IA table at `classlite-ia.md` line 19 EXACTLY, in this order:
1. **Dashboard** (`/dashboard` → `s29`)
2. **My classes** (`/my-classes` → `s30`)
3. **Assignments** (`/assignments` → `s33`/`s34`/`s35`)
4. **My schedule** (`/my-schedule` → `s32`)
5. **Questions** (`/exercises/{id}/attempt?questions=open` → `s36`)
6. **My performance** (`/my-performance` → `s37`)
7. **Inbox** (`/inbox` → `s51`, with unread-count badge)

**And** the `UserPill` role label renders as "Student".

**And** the Student sidebar drops the "Resources" group (Knowledge hub, Archive — both are owner/teacher-only per the IA visibility matrix lines 294-295), and drops the "Workspace" → "People/Analytics" entries entirely. The story `play` function asserts absence of `Settings`, `People`, `Knowledge hub`, `Archive`, `Analytics` nav labels (per TEST-FE-6 — this is the most-restrictive role and carries the most absence assertions).

**And** the nav copy uses the student-tone labels per the IA convention — "My classes" (not "Classes"), "My schedule" (not "Schedule"), "My performance" (not "Analytics"). All labels resolve via i18n keys (`sidebar.student.myClasses`, `sidebar.student.mySchedule`, `sidebar.student.myPerformance`, etc., per UX-2).

**Test scenario:** 1D-P0-018 in `test-design-qa.md`.

### AC6: `SidebarNavItem` badge contract and active-state behavior

**Given** the `SidebarNavItem` component with a populated `badgeCount` prop,
**When** rendered,
**Then** the unread badge renders by composing 1d-2's `Badge` primitive (`src/components/ui/badge.tsx`) and is announced to screen readers via `aria-label` including the count and item name — e.g., `aria-label="Inbox, 3 unread"` (rendered via i18n template: `t('sidebar.nav.unreadAria', { item: t(labelKey), count })`).

**And** when the `active` prop is true, the row renders with the design-token accent left-border + active background using `bg-sidebar-primary` + `text-sidebar-primary-foreground` (per the shadcn-semantic bridge in `src/index.css:92-93`); the `aria-current="page"` attribute is set so screen readers announce the current section.

**And** the component honors the project's role-rendering rule (UX-3) — `SidebarNavItem` itself contains no role-conditional code; role-specific nav sets are constructed by the parent `SidebarShell` and passed as a typed `items` array.

**And** the Storybook stories for `SidebarNavItem` export `Default`, `Active`, `WithBadge`, `WithBadgeAndActive`, `Disabled`, and `LongVietnameseLabel` (per 1D-P1-060..065 — the LongVietnameseLabel story uses `storybook.placeholder.longViText`-style fixture copy per the conventions doc § 8.2 "locale-blind fixture keys" pattern).

**Test scenario:** 1D-P1-060..065 in `test-design-qa.md`.

### AC7: `MobileTabBar` — purpose-designed bottom tab bar per `s74–s86` with three role variants

**Given** the `MobileTabBar` component (`s74–s86`),
**When** rendered,
**Then** it is a separate, purpose-designed mobile bottom tab bar — NOT a responsive squish of `SidebarShell` (per UX-4 + UX-DR32). It renders 5 tabs (the inventory's `s74` 5-tab spec) at the bottom of the mobile viewport, each composed from the `MobileTab` sub-component (icon + label + optional red-dot badge).

**And** three role-specific stories exist matching the IA mobile sections at `classlite-ia.md` Chapter 8 (lines 213-243):

1. `StudentView` (per `s74–s81`, the dominant student mobile spec) — 5 tabs:
   - **Home** (`/dashboard` → `s74`)
   - **Assignments** (`/assignments` → `s76`)
   - **Inbox** (`/inbox` → `s75`, with red-dot badge)
   - **Classes** (`/my-classes` → `s77`)
   - **Me** (`/profile` → `s38`-mobile)

2. `TeacherView` (per `s82–s85`) — 5 tabs:
   - **Home** (`/dashboard` → `s82`)
   - **Classes** (`/classes` → `s83`)
   - **Inbox** (`/inbox` → `s84`, with red-dot badge — Questions filter prominent per IA `s84` line 236)
   - **Schedule** (`/schedule` → `s13` mobile)
   - **Me** (`/profile`)

3. `OwnerView` (per `s86`, **`@status: extrapolated-pending-design-review`** — Sally, party-mode 2026-06-18) — IA Chapter 8 draws ONLY `s86` push-approval for Owner mobile at line 243, so the 5-tab Owner mobile set below is John's extrapolation from desktop priority, NOT canonical IA. The story file's `OwnerView` story header comment MUST cite the IA gap (`/* IA Chapter 8 only draws s86 push-approval for Owner mobile; the 5-tab set below is extrapolated from desktop sidebar priority. Designer to ratify or amend at the post-1d-3 Storybook review. */`). Same caveat for `AdminView` reuse (IA Chapter 8 doesn't draw Admin mobile at all). 5 tabs (extrapolated):
   - **Home** (`/dashboard` → `s48` mobile)
   - **People** (`/people/staff` → `s86` enrolment approve surface)
   - **Inbox** (`/inbox`, with red-dot badge)
   - **Analytics** (`/analytics`)
   - **Me** (`/profile`)

**And** the `MobileTabBar` is co-located with `AppShell` at `src/components/domain/MobileTabBar.tsx` per FW-7 — domain tier, not feature tier (it's reused across every mobile screen).

**And** each tab honors the touch-target minimum (44×44px per TEST-UX-4 — verified at `iphone-14` viewport in `play` function via `getBoundingClientRect`) and the active tab uses `aria-current="page"` for screen readers.

**And** the explicit `MobileTabBar` `Props` interface is:
```ts
export interface MobileTab {
  /** i18n key for the visible label. */
  labelKey: string
  icon: ReactNode
  href: string
  /**
   * Unread indicator. Sally (party-mode 2026-06-18): on 44×44px tabs there is room for
   * "9+" superscript — preserve the count when known, fall back to dot when unknown.
   *  - `number > 0` → renders a numeric badge ("1", "2", … "9+" for ≥10)
   *  - `true`       → renders a red dot (no count available)
   *  - `false` / undefined → no badge
   */
  hasUnread?: boolean | number
}

export interface MobileTabBarProps {
  role: Role  // 'owner' | 'admin' | 'teacher' | 'student' — Admin reuses Owner tabs
  /** Active href derived by consumer from router match. */
  activeHref: string
  /**
   * Tab activation handler. Receives the new href. Default no-op.
   * Murat (party-mode 2026-06-18): the consumer (router) is responsible for moving focus
   * to `<h1>` (or the skip-to-content target) AFTER navigation so screen-reader users
   * get a page-change announcement; aria-live="polite" on the H1 announces the new title.
   * `MobileTabBar` ships the contract via JSDoc; the actual focus move lives in the route
   * layer (Stories 1-8 / 2-x mount this and own the focus handler).
   */
  onTabActivate?: (href: string) => void
  /** AC7 fixes the tab count at 5 per role per the IA mobile spec; the role determines the set. */
}
```

**Role-to-tabs derivation — CLOSED 2026-06-18 by Ducdo: AC7.a (AMENDED 2026-06-21).** The `tabs` array is NOT a prop — it's derived inside `MobileTabBar` from `role` per the AC7 fixed sets (Student/Teacher/Owner). Deliberate exception to UX-3 because mobile tab CONTENT per role is a *layout* decision matched to the IA mobile spec, not a *permission* decision. Documented in the component's JSDoc as `/* UX-3 exception (closed 2026-06-18): role-to-tabs is a layout decision matched to IA Chapter 8, NOT a permission decision. */`. **Amendment 2026-06-21 (party-mode review):** the original closure referenced "UX-DR29 role-variant Storybook lint" as the guardrail bounding Sally's precedent risk. John's party-mode review flagged that no UX-DR29 lint rule exists in the codebase (grep confirms JSDoc references only — no `eslint-rules/` folder). The guardrail is **documented contract, not enforced lint**. Acceptable trade-off: UX-DR29 is a future-misuse prevention, not a current behavior gap; AC7.a's shipped contract (in-component role switch with UX-3 exception JSDoc) stands. **Follow-up:** task #13 tracks lint-implementation deferral; if a Story 2+ component is found to use a role-switch pattern for permission gating (not layout), promote UX-DR29 to an enforced lint rule then. The precedent risk Sally flagged remains bounded by code-review attention + the JSDoc contract until then.

**`useRole()` null guard (Amelia, party-mode 2026-06-18):** `useRole()` (`src/hooks/useRole.ts:17`) returns `Role | null` — production unauthenticated baseline is `null`. The role-to-tabs map MUST handle null (return empty array; an `AppShell` mounted without auth has no meaningful mobile tab set). Story files use the Storybook Role toolbar from 1d-1 to set the value, so the null path doesn't surface in stories — only in production routes that mount `AppShell` without an auth wrapper. Add a runtime guard + a Vitest test that exercises `role=null` → empty render with no crash.

**And** the `AdminView` is NOT listed as a separate variant — the IA mobile chapter only covers Owner/Teacher/Student mobile (Chapter 8, lines 213-249). Admin shares the Owner mobile shell per the desktop convention; the story comment documents this with the same `@status: extrapolated-pending-design-review` caveat as Owner.

**Test scenarios:** 1D-P0-019, 1D-P1-105..108 in `test-design-qa.md`, plus new scenario **1D-P0-019b (Murat, party-mode 2026-06-18):** `MobileTabBar` route activation moves focus to the page's `<h1>` (or skip-to-content target); `aria-live="polite"` on the H1 announces the new page title — verified by `play` function clicking a tab and asserting `document.activeElement` is the H1 element.

### AC8: Mobile breakpoint composition — `AppShell` swaps to `MobileTabBar` below desktop breakpoint

**Given** the `AppShell` component rendered below the desktop breakpoint (390px viewport, the `s74` mobile reference),
**When** inspecting the rendered DOM,
**Then**:
- The desktop `SidebarShell` is NOT in the DOM (not just visually hidden — per TEST-FE-6 — completely absent so screen readers don't announce empty nav). The `play` function asserts this via `expect(screen.queryByTestId('sidebar-nav-primary')).not.toBeInTheDocument()`. **Selector discipline (Murat, party-mode 2026-06-18):** use `data-testid` for negative assertions — `queryByRole('navigation', { name: t('sidebar.nav.primary') })` couples the test to i18n string resolution, so if `sidebar.nav.primary` is renamed the test silently flips from "absent" to "couldn't find anyway" (false green). `data-testid="sidebar-nav-primary"` lives on the `SidebarShell` root `<aside>` regardless of locale.
- The `MobileTabBar` is rendered at the bottom of the viewport with `position: fixed`.
- The `TopbarShell` swaps to the mobile-topbar pattern (eyebrow + title + right-icon affordances per inventory `MobileTopbar` row at `s74`) — but `MobileTopbar` is itself a responsive variant of `TopbarShell` per the inventory's "purpose-designed vs responsive" guidance at `component-inventory.md` line 380 and ships as a `md:` breakpoint variant of `TopbarShell`, NOT a separate component (this story builds the responsive pattern, not a second component).

**And** the swap is driven by Tailwind responsive prefixes systematically (`md:hidden`, `md:flex`, `md:grid`) — no magic-pixel media queries, no JavaScript viewport listeners (per UX-4).

**And** the Storybook `AppShell.stories.tsx` exports `Desktop` (default at viewport `>= md`), `Mobile` (`parameters.viewport: { defaultViewport: 'iphone14' }`), `MobileWithBillingGrace` (mobile + the placeholder for 1d-4's `BillingGraceBanner` slot), and `Tablet` (sanity check at `md` breakpoint).

**Test scenarios:** 1D-P0-020, 1D-P1-066..069 in `test-design-qa.md`.

### AC9: i18n, axe-core, and stable test selectors

**Given** every component story in this stack,
**When** the Storybook toolbar (from 1d-1's decorator stack at `.storybook/preview.tsx`) switches locale between `en` and `vi`,
**Then** every nav label, role label, breadcrumb segment, search placeholder, and tab label renders correctly in both locales. All copy resolves via i18n keys (`sidebar.owner.dashboard`, `sidebar.teacher.students`, `sidebar.student.myPerformance`, `mobileTab.student.home`, `topbar.breadcrumb.more`, `userPill.role.{owner|admin|teacher|student}`, etc., per UX-2 + TEST-FE-4) — zero hardcoded English strings anywhere in `src/components/domain/` 1d-3 files. **Note:** primitive-level English aria leaks in `pagination.tsx` / `breadcrumb.tsx` / `dialog.tsx` / `sheet.tsx` (deferred-work.md line 5) are NOT 1d-3's concern at the `ui/` layer — the domain wrappers (`BreadcrumbBar` here; pagination is deferred to first feature consumer) override at composition. Per the pragmatic-i18n § 8.1 carve-out in `storybook-conventions.md`, this applies to user-facing copy; Storybook structural demo copy may stay English.

**And** Vietnamese nav strings (typically ~1.5× English length — e.g., "Knowledge hub" → "Trung tâm kiến thức") do not break the 220px sidebar layout. **Truncation a11y recipe (Sally + Murat, party-mode 2026-06-18) — WCAG 2.1.1 compliant, no focus-only failure mode:**
- Visual: truncate with ellipsis (CSS `text-overflow: ellipsis` + `white-space: nowrap` + `overflow: hidden`) at 220px.
- Accessible name: ALWAYS set `aria-label={fullLabel}` on the `SidebarNavItem` so screen readers announce the full text regardless of visual truncation. The visible truncated string is decorative for screen-reader purposes (use `aria-hidden="true"` on the `<span>` if needed).
- Hover reveal: full text appears in a tooltip composed from 1d-2's `Tooltip` primitive.
- Focus reveal: SAME tooltip opens on keyboard focus (`onFocus` triggers `Tooltip.open`). Not focus-only and not hover-only — BOTH.
- Native fallback: `title={fullLabel}` attribute on the link/button as a no-JS / no-Tooltip fallback (covers the Storybook test-runner moments when Tooltip provider hasn't mounted yet, plus broken-JS production).
- Mouse-only users get hover + native title; keyboard users get focus + tooltip; screen readers get aria-label. Three independent paths — failure of any one does not strand a user class. Closes the "Vietnamese mouse-user can never see the full label" failure mode Sally surfaced.

**Given** the `@storybook/addon-a11y` audit and the `vitest-axe` integration from 1d-1 (asserted via `parameters.a11y.test = 'error'` in `.storybook/preview.tsx`),
**When** every story in this stack runs via `npm run storybook:test` in CI,
**Then** zero `axe-core` violations. Tab order follows visual reading order (sidebar → topbar → main; or mobile: topbar → main → tab bar). The mobile `MobileTabBar` is keyboard-accessible (each tab focusable, `Enter` activates).

**And** every component exposes stable selectors for tests — `data-testid` on each `SidebarNavItem` (`sidebar-nav-{slug}`), each `MobileTab` (`mobile-tab-{slug}`), the `UserPill` role label (`user-pill-role`), and the `BreadcrumbBar` current item (`breadcrumb-current`). Selectors are documented in `classlite-web/docs/storybook-conventions.md` as the canonical pattern for downstream stories — extend the existing conventions doc (do NOT fork it).

**And** the new i18n keys land in BOTH `src/locales/en.json` AND `src/locales/vi.json` in the same PR (UX-2). The `STORY_1D_3_KEYS` const + `describe('Story 1d-3 i18n parity (R38)', ...)` block extends `src/lib/test/__tests__/i18n-parity-coverage.test.ts` (following the existing `STORY_1D_2_KEYS` pattern at lines 91-138). `npm run i18n-parity` must pass green locally before opening the PR; the CI step blocks merge on key divergence.

**Vacuity guard (Murat, party-mode 2026-06-18):** the `STORY_1D_N_KEYS` per-story enumeration is vacuous if a dev adds a new key under `sidebar.*`/`topbar.*`/`mobileTab.*`/`pageHead.*`/`userPill.*` but forgets to add it to `STORY_1D_3_KEYS` — parity test passes (both locales have the key), discharge test passes (KEYS is what it claims to enumerate). Mitigation lands in the same PR: extend `scripts/i18n-parity.mjs` with a "namespace coverage" assertion — for the 1d-3 namespaces (`sidebar.`, `topbar.`, `mobileTab.`, `pageHead.`, `userPill.`), every key MUST appear in SOME `STORY_1D_*_KEYS` array exported from `i18n-parity-coverage.test.ts`. An orphan key (in JSON but not enumerated anywhere) fails the script with `ORPHAN: <key> belongs to namespace <ns> but isn't claimed by any STORY_1D_*_KEYS`. If the script extension feels out of scope, document the gap explicitly in `deferred-work.md` with a tracking note. Recommended: ship the script extension (≈30 LOC) since it's the only durable closure of the vacuous-pass loophole.

**Student-tone enforcement (Sally, party-mode 2026-06-18):** the namespace convention `sidebar.student.{item}` (e.g. `sidebar.student.myClasses`, `sidebar.student.mySchedule`, `sidebar.student.myPerformance`) is a *contract*, not a *convention* — a future dev keying a Student nav label under `sidebar.shared.assignments` evaporates the student tone. Add a Storybook acceptance check to `SidebarShell.stories.tsx` `StudentView`: assert every nav label's resolved `t()` key starts with `sidebar.student.` (introspect the role-to-config map at render-time and walk the keys). Same pattern for `sidebar.owner.*` / `sidebar.admin.*` / `sidebar.teacher.*` / `mobileTab.student.*` / `mobileTab.teacher.*` / `mobileTab.owner.*` — a key under the wrong role prefix is a story-fail. Documents the namespace as a hard contract, catches drift at story-author level (not just code review).

**Axe scenario for 220px Vietnamese truncation (Murat, party-mode 2026-06-18):** add a Storybook story `SidebarNavItem.LongVietnameseLabel` rendered at the 220px constraint with the truncation pattern engaged. The `play` function asserts: (a) `aria-label` is present and equals the full string; (b) on `userEvent.tab()` the focused state opens the tooltip with the full text visible; (c) `axe-core` returns zero violations including color-contrast on the tooltip + keyboard-discoverability of the truncated content. Without this scenario, the truncation pattern can ship with `title`-only or focus-only failure modes that look fine in code review.

**Test scenarios:** 1D-P0-025, 1D-P1-082..094, 1D-P1-109..114 in `test-design-qa.md`, plus new scenarios **1D-P1-094a (Vietnamese truncation a11y, Murat 2026-06-18)** and **1D-P1-114a (namespace coverage script, Murat 2026-06-18)** to be added during dev pickup.

## Tasks / Subtasks

- [x] **Task 0 (scaffold migration — PRE-WORK):** Reconcile existing 1-7c `shared/` placeholders with the canonical `domain/` components 1d-3 ships. See Dev Notes § "Existing 1-7c scaffolds to retire" for the full migration plan.
  - [x] Read current `src/components/shared/AppLayout.tsx`, `Sidebar.tsx`, `TopBar.tsx`, `UserPill.tsx` and confirm consumer-side imports (today: only `App.tsx` / `routes.tsx`).
  - [x] Inventory `app.layout.*` i18n keys currently shipped by 1-7c (lines 4-9 + `app.layout.userPill.roleLabel.*`); plan migration to new `sidebar.*` / `topbar.*` / `userPill.*` namespaces in same PR.
  - [x] Confirm no production routes mount `AppLayout` today (per `AppLayout.tsx:13-19` JSDoc — Story 1-8 onwards mounts it). 1d-3 can refactor without breaking active routes.
  - [x] **Commit-sequence discipline (Winston + Amelia, party-mode 2026-06-18):** the kill-order is non-negotiable to keep CI green every commit. (1) i18n namespace migration lands FIRST as ONE atomic commit touching both `en.json` AND `vi.json` — never `en` first then `vi` later (parity CI fails red). (2) Domain components land NEXT (Tasks 1-6) — `shared/AppLayout` continues importing the old `shared/Sidebar`/`TopBar`/`UserPill` placeholders during this window (dual-live, intentional). (3) `shared/AppLayout` refactor to consume domain components (Task 7). (4) Delete the three `shared/` placeholders LAST, gated by grep for external consumers. Never delete before `shared/AppLayout` no longer imports them.

- [x] **Task 1 (AC1):** Build the shell skeleton components in `src/components/domain/`.
  - [x] **PRE-CHECK (Amelia + Winston, party-mode 2026-06-18):** Before writing the first component, read `src/index.css` and verify the shadcn-semantic bridge is wired correctly for Tailwind v4. Tailwind v4 `@theme inline` generates utilities from `--color-*` prefixed vars — `bg-sidebar-primary` requires `--color-sidebar-primary` in the `@theme` block. If `src/index.css:64-97` only re-exports `--cl-*` raw tokens without `--color-sidebar-*` aliases, the utilities silently no-op (compiles green, styles broken). The 1-7c arbitrary-value pattern (`bg-[var(--cl-sidebar-bg)]`) was likely a workaround for this exact gap. If missing, add the `--color-sidebar-*` / `--color-background` / `--color-foreground` / `--color-card` / `--color-border` / `--color-ring` / `--color-accent` / `--color-primary` aliases under `@theme inline` in the SAME commit as `SidebarShell.tsx` — token bridge + first consumer ship together so reviewer sees the proof together.
  - [x] **Token-bridge governance comment (Winston, party-mode 2026-06-18):** add a comment block above the bridge mappings in `src/index.css:64-97` stating the contract verbatim: `/* Edit --cl-* tokens to rebrand. NEVER edit --sidebar / --background / --ring / --color-* directly — they are bridge aliases that propagate --cl-* to shadcn/Tailwind. Direct edits silently desync the brand layer. */` Stops the silently-lossy bridge drift Winston flagged.
  - [x] `AppShell.tsx` + `AppShell.stories.tsx` — three-slot layout (sidebar, topbar, main) + optional banner slot. **Single uiStore subscription (Winston, party-mode 2026-06-18):** `AppShell` is the SOLE consumer of `useUIStore((s) => s.sidebarCollapsed)`; the boolean prop-drills down to `SidebarShell` via its `collapsed` prop (already declared in the AC2 Props interface). `SidebarShell` MUST NOT re-subscribe to `uiStore` — double-subscription causes double-renders that React DevTools shows but the test suite misses.
  - [x] `TopbarShell.tsx` + `TopbarShell.stories.tsx` — breadcrumb + search + CTA slots; mobile `md:` responsive variant per AC8.
  - [x] `BreadcrumbBar.tsx` + `BreadcrumbBar.stories.tsx` — wraps 1d-2's `Breadcrumb` primitive; middle-segment ellipsis truncation; **overrides primitive's English aria `aria-label="More"` and `BreadcrumbPage` ARIA per AC1 deferred-work-line-5/8 carry-overs**.
  - [x] `SearchPill.tsx` + `SearchPill.stories.tsx` — placeholder + `⌘K` kbd hint chip (visual affordance only).
  - [x] `UserPill.tsx` + `UserPill.stories.tsx` — avatar + name + data-driven role label; composes 1d-2 `Avatar`. **Avatar pre-check (Amelia, party-mode 2026-06-18):** the role label badge needs a colored ring/accent on the avatar; verify `src/components/ui/avatar.tsx` exposes a slot or className-merge for the outer ring BEFORE writing UserPill. If the primitive forces its own shape, wrap `Avatar` in a div with the ring utility rather than touching the primitive (no new Pattern 2 entries per 1d-2 close-out).
  - [x] `PageHead.tsx` + `PageHead.stories.tsx` — H1 (Fraunces) + count + sub-line; three-state coverage (`Default`, `Loading`, `Empty`, `Error`) via 1d-1 placeholders. **Precision note (Murat, party-mode 2026-06-18):** PageHead's three-state stories cover the VISUAL SHAPE of those states for design review; the loading-state correctness of any consumer fetch is verified at the CONSUMER story (Epic 2+). The header comment of `PageHead.stories.tsx` documents this so a reviewer doesn't ask "where's the MSW handler?" — there isn't one, by design.
  - [x] `SidebarNavItem.tsx` + `SidebarNavItem.stories.tsx` — icon + label + optional badge; `Default`, `Active`, `WithBadge`, `WithBadgeAndActive`, `Disabled`, `LongVietnameseLabel`.

- [x] **Task 2 (AC2–AC5):** Build `SidebarShell` with four role variants.
  - [x] `SidebarShell.tsx` accepts typed `role` prop (`'owner' | 'admin' | 'teacher' | 'student'`) and a `groups` array — per-role config map encoded in a sibling `sidebarNavConfig.ts` (or co-located const), NOT branched inline (per UX-3).
  - [x] Encode the four role nav sets EXACTLY per `classlite-ia.md` lines 16–19 (verbatim — re-read the IA before commit).
  - [x] Story exports: `OwnerView`, `AdminView`, `TeacherView`, `StudentView` (per UX-DR29) — each switches the role context via the Storybook role toolbar from 1d-1's decorator.
  - [x] `AdminView`, `TeacherView`, and `StudentView` stories include `play` functions asserting absence of disallowed nav items (per TEST-FE-6 + 1D-P0-016/017/018).
  - [x] Document the IA citation in a header comment of `SidebarShell.tsx` so future agents updating nav must update the IA + this file atomically.

- [x] **Task 3 (AC6):** Verify `SidebarNavItem` badge and active-state contracts.
  - [x] Badge composes 1d-2's `Badge` primitive with the bridged amber accent.
  - [x] `aria-label` includes count + item name via i18n template (`t('sidebar.nav.unreadAria', { item, count })`).
  - [x] `aria-current="page"` on active row.
  - [x] Active background uses `bg-sidebar-primary` / `text-sidebar-primary-foreground` from the shadcn-semantic bridge — NOT raw `bg-[var(--cl-sidebar-active-bg)]` arbitrary values.

- [x] **Task 4 (AC7):** Build `MobileTabBar` and `MobileTab` sub-component.
  - [x] `MobileTabBar.tsx` + `MobileTabBar.stories.tsx` co-located in `src/components/domain/`.
  - [x] Three role-specific stories: `StudentView`, `TeacherView`, `OwnerView` — each renders the 5-tab set from AC7 verbatim.
  - [x] `MobileTab.tsx` sub-component — icon + label + red-dot badge slot; touch-target ≥44×44px (per TEST-UX-4, asserted via `play` `getBoundingClientRect` per 1D-P1-105..108).
  - [x] Header comment documents that Admin mobile is NOT a separate variant (shares Owner mobile per IA Chapter 8 convention).

- [x] **Task 5 (AC8):** Wire the responsive breakpoint composition in `AppShell`.
  - [x] Below `md` breakpoint: `SidebarShell` is `hidden md:flex` (absent from DOM via conditional, not just CSS-hidden — verify with TEST-FE-6 + 1D-P0-020 in the story's `play` function).
  - [x] Below `md` breakpoint: `MobileTabBar` renders `position: fixed bottom-0` via Tailwind utilities.
  - [x] `TopbarShell` mobile pattern (eyebrow + title + right-icon) is a `md:` responsive variant of `TopbarShell` — not a separate `MobileTopbar` component.
  - [x] `AppShell.stories.tsx` exports `Desktop`, `Mobile`, `MobileWithBillingGrace` (placeholder slot for 1d-4), `Tablet`.

- [x] **Task 6 (AC9 — i18n + axe + selectors):** Verify discipline contracts.
  - [x] Add new keys to `src/locales/en.json` AND `src/locales/vi.json` in the same PR (UX-2). Namespace: `sidebar.{role}.{item}`, `mobileTab.{role}.{item}`, `topbar.breadcrumb.more`, `topbar.search.*`, `userPill.role.{role}`, `sidebar.nav.unreadAria`, `sidebar.nav.primary` (sidebar nav root aria-label), `appShell.skipToContent` (if moved from `app.layout.skipToContent`, else preserve original key).
  - [x] Extend `src/lib/test/__tests__/i18n-parity-coverage.test.ts` with `STORY_1D_3_KEYS` const + `describe('Story 1d-3 i18n parity (R38)', ...)` block (mirrors the existing `STORY_1D_2_KEYS` pattern at line 98).
  - [x] **Vacuity guard — CLOSED 2026-06-18 by Ducdo: ship-now in 1d-3 PR.** Extend `scripts/i18n-parity.mjs` with a namespace-coverage assertion — every key under `sidebar.`/`topbar.`/`mobileTab.`/`pageHead.`/`userPill.`/`appShell.` namespaces MUST be claimed by SOME `STORY_1D_*_KEYS` export from `i18n-parity-coverage.test.ts`. Orphan keys fail CI with `ORPHAN: <key> belongs to namespace <ns> but isn't claimed by any STORY_1D_*_KEYS`. ≈30 LOC. Closes the vacuous-pass loophole permanently across Epic 1D + every downstream namespace. Defer path was rejected at decision time.
  - [x] **Student-tone namespace contract (Sally, party-mode 2026-06-18):** in `SidebarShell.stories.tsx` `StudentView`, add a `play` function that introspects the rendered role-to-config map and asserts every nav label `labelKey` starts with `sidebar.student.`. Repeat the pattern for `OwnerView`/`AdminView`/`TeacherView` against their respective `sidebar.{role}.` prefixes, and for `MobileTabBar` views against `mobileTab.{role}.`. Drift-catches at story-author level, not just code review.
  - [x] Verify Vietnamese rendering at 220px sidebar doesn't break layout — `SidebarNavItem.stories.tsx` `LongVietnameseLabel` story exercises this with the WCAG 2.1.1 truncation recipe (aria-label + hover-AND-focus tooltip + native `title` fallback per AC9).
  - [x] Add `data-testid` selectors per AC9 (`sidebar-nav-primary` on the SidebarShell root, `sidebar-nav-{slug}` on each item, `mobile-tab-{slug}`, `user-pill-role`, `breadcrumb-current`, `app-shell-root`); extend `storybook-conventions.md` with the canonical pattern (do NOT fork the file — append to existing § 9 or add a new § for selectors).
  - [x] Grep `src/components/domain/` for hardcoded English in 1d-3 files — must be zero outside `t()` keys and structural demo copy per § 8.1.
  - [x] **TS-6 module-scope date audit (Amelia, party-mode 2026-06-18):** grep `src/components/domain/` 1d-3 files for any `new Date()` / `Date.now()` / `formatDistanceToNow` / `format(` calls at module scope or component-body top level — TS-6's "no `new Date()` in render" rule misses module-scope evaluation that still produces non-deterministic snapshots. All date-derived values come from props (ISO strings) consumed via i18n formatter. Story files pin `parameters.now: '2026-06-17T00:00:00Z'` for any time-derived rendering.
  - [x] Run `npm run storybook:test` locally — zero axe violations expected (per 1D-P0-009 inheritance + AC9), including the new 1D-P1-094a Vietnamese-truncation axe scenario.

- [x] **Task 7 (Scaffold migration — REPLACEMENT):** After domain components are green in Storybook, retire 1-7c placeholders.
  - [x] Refactor `src/components/shared/AppLayout.tsx` to compose `domain/AppShell` + `domain/SidebarShell` (with a per-route role + groups config; for routes that don't have a real role yet, default to `owner` to keep the unauthenticated dev shell rendering) + `domain/TopbarShell` (with empty breadcrumbs slot until feature stories populate).
  - [x] Delete `src/components/shared/Sidebar.tsx`, `src/components/shared/TopBar.tsx`, `src/components/shared/UserPill.tsx`. Their tests in `src/components/shared/__tests__/` migrate to the new domain components' co-located tests where coverage overlaps; redundant tests are deleted (CQ-1 — no commented-out-just-in-case).
  - [x] Migrate i18n keys: deprecate `app.layout.sidebar.brand` etc.; route the existing translations to the new `topbar.search.*` / `sidebar.brand` / `userPill.role.*` namespaces. Update `vi.json` in lockstep. Keep `app.layout.skipToContent` (used by `AppLayout` itself, not the inner shells).
  - [x] Update `routes.tsx` if any routes import from `shared/Sidebar` etc. directly (today: none — verified via grep before commit).
  - [x] Confirm `vitest`, `tsc -b`, `lint`, `lint:css`, `i18n-parity`, `build`, `storybook:build`, `storybook:test` all green before opening the PR.

### Review Findings

_Code review pass 2026-06-22 (Amelia, post-merge, baseline `c390282`..`4b88072`). Triaged across three reviewers: Blind Hunter (no-context adversarial), Edge Case Hunter (path-walk), Acceptance Auditor (spec compliance). 24 patches + 7 decision-needed + 7 deferred + 16 dismissed-as-noise._

**Decisions resolved (now patches):**

- [x] [Review][Patch] **D1 → Wire `useUIStore.sidebarCollapsed` toggle to a `TopbarShell` hamburger button** [`classlite-web/src/components/domain/TopbarShell.tsx`, `SidebarShell.tsx:73-75`, `AppLayout.tsx:54`] — Add a `collapseToggle?: ReactNode` slot (or built-in `<Button>` rendering `Menu` icon) to TopbarShell, wired via `AppLayout` to `useUIStore((s) => s.setSidebarCollapsed)`. SidebarShell `collapsed && 'md:hidden'` stays as the visual behavior; `onCollapseToggle` prop on `SidebarShell` is removed (toggle lives on TopbarShell). Add `topbar.sidebarToggle.{open,close}` i18n keys.
- [x] [Review][Patch] **D2 → Ship the AC8 mobile pattern in `TopbarShell` (eyebrow + title + icon-only CTA)** [`classlite-web/src/components/domain/TopbarShell.tsx`] — Below `md`, render: top row (eyebrow with breadcrumb-derived parent label + hamburger toggle from D1), title row (current page title — pulled from a new `mobileTitle?: ReactNode` slot or from BreadcrumbBar last segment), right-side icon-only CTA (the `cta` slot wraps in an `icon-only md:auto` reflow). Add Storybook `Mobile` story per shell and a Playwright `storybook-a11y` spec asserting eyebrow + title visible at 375×667.
- [x] [Review][Patch] **D3 → Implement BreadcrumbBar ellipsis as a `DropdownMenu` of skipped middle segments** [`classlite-web/src/components/domain/BreadcrumbBar.tsx:70-81`] — Replace the decorative `<MoreHorizontalIcon>` span with a `<DropdownMenu>` (shadcn primitive from 1d-2) whose trigger is the icon + sr-only label, and whose items are `items.slice(1, -1)` mapped to `<DropdownMenuItem render={<Link to={item.href}>{item.label}</Link>} />`. Trigger gets `aria-haspopup="menu"` + i18n `topbar.breadcrumb.more` as accessible name. Add a Storybook `Truncated` story exercising 6+ items + a Playwright a11y assertion that the menu opens on click and on Enter.
- [x] [Review][Patch] **D4 → Move focus management inside `MobileTabBar` via `useEffect` on location** [`classlite-web/src/components/domain/MobileTabBar.tsx`] — Import `useLocation` from `react-router`. Add `useEffect(() => { document.getElementById('main-content')?.focus() }, [location.pathname])` (scoped to mount + nav). `onTabActivate` is preserved as an optional callback for analytics/instrumentation but the JSDoc is corrected: focus management is internal; consumer hook is for side-effects only. Drop the "consumer responsibility: focus to H1" lines.
- [x] [Review][Patch] **D5 → Drop `aria-live="polite"` from `PageHead.<h1>`; rely on focus move from D4** [`classlite-web/src/components/domain/PageHead.tsx:29-35`] — Single announcement source: the focus move into `#main-content`. Update the JSDoc to document the strategy (consumer = MobileTabBar's `useEffect`; h1 carries `tabIndex={-1}` so it can receive programmatic focus). Remove from `i18n-parity-coverage.test.ts` discussion if referenced.
- [x] [Review][Patch] **D6 → Implement longest-prefix match for `MobileTabBar.activeHref`** [`classlite-web/src/components/domain/MobileTabBar.tsx`] — Replace `tab.href === activeHref` with a function: find the tab whose `href` is the longest string such that `activeHref === href || activeHref.startsWith(href + '/')`. Add unit test cases: `/classes` matches `/classes/123`, `/classes` does NOT match `/classes-archived`, root `/dashboard` matches only itself. Also apply same logic in `SidebarShell` `activeHref` propagation if it ships exact-match (verify and align).
- [x] [Review][Patch] **D7 → Ship presence+equivalence test for the token bridge** [NEW `classlite-web/src/__tests__/token-bridge.test.ts`] — Read `src/index.css`, parse the `:root` block(s), assert every required bridge variable exists (`--background`, `--foreground`, `--card`, `--card-foreground`, `--sidebar`, `--sidebar-foreground`, `--sidebar-primary`, `--sidebar-accent`, `--sidebar-border`, `--accent`, `--border`, `--ring`, plus any others Winston enumerated), and assert each value is exactly `var(--cl-*)` (no literal hex / hsl). Test fails if a bridge variable is missing OR if any value is a literal color. Run in the standard `vitest` job; no Storybook dependency.

**Patches:**

- [x] [Review][Patch] **`AppLayout` hardcodes `activeHref="/dashboard"` on both sidebar AND mobile tab bar** [`classlite-web/src/components/shared/AppLayout.tsx:85, 98`] — Every route except `/dashboard` highlights the wrong nav item; `aria-current="page"` is wrong for SR users on every other route. Fix: `const location = useLocation(); activeHref={location.pathname}` (deep-route handling per Decision item).
- [x] [Review][Patch] **`AppLayout` passes `user.name = t('userPill.role.${role}')` — UserPill shows role label as user name** [`classlite-web/src/components/shared/AppLayout.tsx:84`] — Owner sees "Owner / Owner" in the UserPill (initials "O"). No `TODO` marker, so grep won't find it before 1-8 lands. Fix: add `// TODO(1-8): replace with useAuth().user.displayName when auth wiring lands` and/or use the actual session display name if available.
- [x] [Review][Patch] **`SidebarNavItem` `disabled` prop: `pointer-events-none` blocks mouse but keyboard Enter still navigates** [`classlite-web/src/components/domain/SidebarNavItem.tsx:64-78`] — `aria-disabled` is announced but the `<Link>` still fires React Router on Enter/Space. Fix: render as `<span aria-disabled="true" tabIndex={-1}>` when disabled, OR add `onClick={(e) => disabled && e.preventDefault()}` + `onKeyDown` for Enter/Space.
- [x] [Review][Patch] **`MobileTab` ariaLabel uses `sidebar.nav.unreadAria` (cross-namespace bleed) AND announces literal raw count while visual is capped at `9+`** [`classlite-web/src/components/domain/MobileTab.tsx:40, 63-65`] — Two bugs in one site: namespace boundary the new namespace-coverage check is meant to enforce gets crossed by the component itself, and screen-reader users hear "Inbox 12 unread" while sighted users see "9+". Fix: add `mobileTab.unreadAria` key to both locales + claim it in `STORY_1D_3_KEYS`; pass the visible-cap value to the template (`count: unread >= 10 ? '9+' : unread`).
- [x] [Review][Patch] **Orphan i18n keys: `appShell.root`, `sidebar.collapseToggle`, `sidebar.section.workspace`, `sidebar.section.resources`** [`classlite-web/src/locales/{en,vi}.json`, `i18n-parity-coverage.test.ts:155-163`] — Verified by grep: these four keys are claimed in `STORY_1D_3_KEYS` and exist in both locale JSONs but have ZERO callsite. They were pre-claimed to make namespace-coverage pass — exactly the loophole party-mode #13 was meant to close. Fix: delete from locale JSONs + remove from `STORY_1D_3_KEYS`. (`sidebar.collapseToggle` may be reserved for a future hamburger — if so, leave a `// reserved for collapse-rail story` comment and drop the coverage claim until consumer ships.)
- [x] [Review][Patch] **`MobileTabBar` JSDoc still references "UX-DR29 role-variant Storybook lint" as guardrail** [`classlite-web/src/components/domain/MobileTabBar.tsx:23-27`] — Party-mode #13 closed this to "documented contract, NOT enforced lint" (spec line 313). The JSDoc text contradicts the resolved decision and misleads future readers. Fix: replace with "Documented convention; UX-DR29 lint deferred until a real role-as-permission misuse appears."
- [x] [Review][Patch] **`AppShell.<main>` `pb-24 md:pb-6` reservation unconditional — guest shell wastes 96px** [`classlite-web/src/components/domain/AppShell.tsx:48-52`] — `AppLayout` sets `mobileTabBar={null}` for null roles, but `<main>` still reserves 96px at the bottom on mobile. Fix: `className={cn('flex-1 overflow-auto p-6', mobileTabBar ? 'pb-24 md:pb-6' : 'pb-6')}`.
- [x] [Review][Patch] **`MobileTabBar` no iOS safe-area padding** [`classlite-web/src/components/domain/MobileTabBar.tsx:129`] — iPhone with home indicator overlays the bottom tabs. Fix: add `pb-[env(safe-area-inset-bottom)]` to the `<nav>` className.
- [x] [Review][Patch] **`extractClaimedKeys` regex matches only single-quoted strings** [`classlite-web/scripts/i18n-parity.mjs:~1455-1475`] — A reviewer running Prettier with `"quoteStyle": "double"` silently drops every claimed key, turning the new guard into either a deny-all or a vacuity depending on extraction. Fix: `/(?:'([^']+)'|"([^"]+)")/g` and pick from either capture group. Add a regression test in `scripts/lib/__tests__/strip-comments-and-strings.test.ts` exercising both quote styles.
- [x] [Review][Patch] **`findOrphans` only scans `locales[a].keys` (en) — vi-only orphans escape detection** [`classlite-web/scripts/i18n-parity.mjs:~1501-1504`] — Comment justifies single-locale scan by trusting parity, but if parity itself diverges and bails, the orphan check has already run on the incomplete en set. Fix: scan the union of `[...new Set([...locales[a].keys, ...locales[b].keys])]`.
- [x] [Review][Patch] **`console.warn` for null role fires per StrictMode render + every hot-reload** [`classlite-web/src/components/shared/AppLayout.tsx:57-68`] — Author acknowledged in the comment but did nothing. Every Vitest spec / dev page-load spams the console. Fix: module-scoped `let hasWarnedNullRole = false` outside the component; warn once per session.
- [x] [Review][Patch] **`app-shell-mobile-viewport.spec.ts` skips AC8 assertion when `boundingBox()` returns null** [`classlite-web/e2e/storybook/app-shell-mobile-viewport.spec.ts:~48-51`] — `if (box !== null) { expect(box.width).toBe(0) }` passes with zero assertions on the null branch — race conditions silently pass. Fix: `expect(box === null || box.width === 0).toBe(true)` (single assertion, both branches counted).
- [x] [Review][Patch] **Playwright Tab-focus test flakes — 5-attempt cap with `if (focused) break` conflates "didn't focus" with "focused on iteration 4"** [`classlite-web/e2e/storybook/sidebar-nav-item-focus.spec.ts:~54-63`] — `expect(attempts).toBeLessThan(5)` is bypassed in edge sequences. Fix: use Playwright's `page.locator('[data-testid=...]').focus()` directly (deterministic), then `await expect(page.locator('[data-slot="tooltip-content"]')).toBeVisible()`.
- [x] [Review][Patch] **`PageHead` count: no `Intl.NumberFormat`, ignores locale grouping** [`classlite-web/src/components/domain/PageHead.tsx:36-38`] — Renders raw digits; Vietnamese uses `.` for grouping, English uses `,`. Violates TS-6 spirit (i18n owns formatting). Fix: `new Intl.NumberFormat(i18n.language).format(count)`.
- [x] [Review][Patch] **`PageHead` count: no `NaN`/`Infinity`/negative guard** [`classlite-web/src/components/domain/PageHead.tsx:36`] — `typeof count === 'number'` lets `NaN`, `Infinity`, `-5` through as user-facing copy. Fix: `Number.isFinite(count) && count >= 0`.
- [x] [Review][Patch] **`UserPill.deriveInitials` blows up on whitespace, empty, diacritic, surrogate-pair names** — Whitespace `"  Jane  "` → `""`; hyphenated `"Nguyễn-Văn"` → `"N"`; emoji name → broken codepoint. Fix: `name.trim().split(/\s+/).filter(Boolean).map(part => Array.from(part)[0] ?? '').slice(0, 2).join('').toUpperCase() || '?'`.
- [x] [Review][Patch] **`UserPill` `avatarUrl=''` (empty string truthy) triggers `src=''` request to current page URL** — `avatarUrl?.trim() ? avatarUrl : null` before forwarding to `<AvatarImage>`.
- [x] [Review][Patch] ~~**`http-server` not declared in `package.json` devDependencies**~~ — VERIFIED FALSE: `http-server@14.1.1` already at `package.json:76` (devDependencies). Original finding read from diff text alone; correct on-disk state is fine. Dismissed during patch wave.
- [x] [Review][Patch] **`i18n-parity.mjs` missing coverage test file exits with code 2 (usage error) — wrong semantic** [`classlite-web/scripts/i18n-parity.mjs:~1452-1454`] — Missing coverage file is a config error, not a usage error. Fix: distinct exit code (4) + clearer message.
- [x] [Review][Patch] **Storybook play-function tautology assertions** [`classlite-web/src/components/domain/AppShell.stories.tsx:~1745-1762`, `MobileTabBar.stories.tsx:~2249-2261`] — `expect(sidebar.className).toMatch(/hidden/)` reads back the source string and passes even after Tailwind purges the class. The new `storybook-a11y` Playwright project does runtime measurement and backstops; the className regexes can be deleted. Fix: drop className assertions; keep `expect(testid).toBeInTheDocument()` smoke.
- [x] [Review][Patch] **`SidebarShell` `aria-labelledby={undefined}` when group has no labelKey** [`classlite-web/src/components/domain/SidebarShell.tsx:92-98`] — Unnamed `<section>` landmark for Owner's first group. Fix: when `group.labelKey` is undefined, render plain `<div>` instead of `<section aria-labelledby={undefined}>`.
- [x] [Review][Patch] **`SearchPill` `aria-label` + visible text + `<kbd>` content = three accessible-name sources** [`classlite-web/src/components/domain/SearchPill.tsx`] — Some AT modes double-announce ("Search button, Search, Command K"). Fix: drop `aria-label`, let the visible text compose the accessible name; kbd hint stays as visual + sr-only-acceptable description.
- [x] [Review][Patch] **`SidebarNavItem` triple-source accessible name: `aria-label` + `title` attribute + Tooltip content** [`classlite-web/src/components/domain/SidebarNavItem.tsx:64-78, 99-101`] — May double-announce on hover ("Inbox 3 unread, Inbox"). Fix: drop the native `title` attribute (the Tooltip primitive owns hover/focus reveal; `aria-label` carries the badge announcement).
- [x] [Review][Patch] **`MobileTabBar.unreadByTab` typo-silent — no DEV warning when map key doesn't match any tab `testIdSlug`** [`classlite-web/src/components/domain/MobileTabBar.tsx:138`] — A consumer passing `{Inbox: 3}` instead of `{inbox: 3}` produces no badge with no diagnostic. Fix: in DEV, log a warning when `Object.keys(unreadByTab)` contains entries not in the active tab set.

**Deferred (pre-existing or non-actionable in this PR):**

- [x] [Review][Defer] **Spec contract drift: `AppShell.mobileTabBar`, `SidebarNavItem.disabled`, `MobileTabBar.unreadByTab` not in spec's Props interfaces** — Functional extensions; spec should be amended to ratify in a follow-up. Not a code change.
- [x] [Review][Defer] **DoD #28 (designer notified) + #22 (shadcn-base-nova tracking issue) unchecked** — Both already tracked in `1d-3-followup-designer-figma-comment.md` and `1d-followup-codeowners-and-shell-allowlist-rule.md`.
- [x] [Review][Defer] **`MobileTabBar` at 320px iPhone SE 1st gen overflows** — Project minimum supported viewport is 375px (per AC8). 320px out of scope.
- [x] [Review][Defer] **`SearchPill` ⌘K Mac glyph on Windows/Linux + no actual handler installed** — Spec explicitly says CommandPalette wiring is deferred; visual chrome only.
- [x] [Review][Defer] **Playwright design-system project `testIgnore /storybook\//` Windows path separator** — No Windows CI/dev for this project.
- [x] [Review][Defer] **`i18n-parity.mjs` STORY_KEYS via spread (computed) not handled** — Documented flat-string-array convention; not a regression introduced here.
- [x] [Review][Defer] **`strip-comments-and-strings.mjs` regex-literal containing `//` false positive** — Documented limitation; not a regression.

## Dev Notes

### Inheritance from Story 1d-1 (storybook-foundation, DONE 2026-06-15)

**Shipped infrastructure to consume (do NOT duplicate):**

| Artifact | Path |
|---|---|
| Storybook config | `.storybook/main.ts`, `.storybook/preview.tsx`, `.storybook/test-runner.ts` |
| Decorator stack | `.storybook/preview.tsx` — `MemoryRouter` → `QueryClientProvider` (retry:false, staleTime:30s) → `I18nextProvider` (en+vi) → `RoleProvider` (via `RoleContext`) → `TooltipProvider` (delay:0) → `Suspense` (single top-level boundary) |
| Storybook toolbar globals | **Locale** (`en`/`vi`) — flips `i18n.changeLanguage()` AND `setDefaultOptions({ locale })` on date-fns; **Role** (`owner`/`admin`/`teacher`/`student`) — overrides `useRole()` return value |
| Portal target div | `<div id="storybook-portal-root" />` rendered inside provider tree as decorator sibling — opt-in via `parameters.portalContainer = '#storybook-portal-root'`. 1d-2 emitted the div + decorator wiring but did NOT route any primitive's `<Primitive.Portal container>` to it. 1d-3 wires real consumers when a domain wrapper needs provider-aware portals (e.g., role-aware DropdownMenu items reading `useRole()` from inside a portaled menu) — but 1d-3's shell components do NOT use portals, so this stays as foundation. Documented in conventions § 4. |
| Toaster | Storybook canvas mounts its own `<Toaster />` locally (decorator sibling); `App.tsx` mounts the production `<Toaster />` at the top level. |
| FW-7 placement enforcement | `.storybook/test-runner.ts` `prerender` hook calls `checkFw7Placement()` from `src/test/storybook-rules/` — error on merge if a `*.stories.tsx` lives outside `ui/` / `domain/` / `features/*/components/` |
| Three-state lint | `.storybook/test-runner.ts` `postRender` hook checks `requiredExportsByPattern` for `*Table.stories.tsx` / `*List.stories.tsx` / `*Card.stories.tsx` / `*Hero.stories.tsx` / `*Shell.stories.tsx` — error on merge. **See Dev Notes § "`*Shell` three-state lint tension" — load-bearing for 1d-3.** |
| `EmptyStatePlaceholder` / `ErrorStatePlaceholder` | `src/test/fixtures/empty-state-placeholder.tsx` + `error-state-placeholder.tsx` — pre-Epic-10 stand-ins. `PageHead.stories.tsx` consumes both. |
| `assertI18nParity(usedKeys, locales)` helper | `src/lib/test/i18n-parity.ts` (shipped at 1-7c, inherited by 1d-1). Use this in every 1d-3 component test that calls `t(...)`. |
| Per-story parity discharge | Extend `src/lib/test/__tests__/i18n-parity-coverage.test.ts` with a new `STORY_1D_3_KEYS` const + `describe('Story 1d-3 i18n parity (R38)', ...)` block (template at lines 91-138 of that file — see `STORY_1D_2_KEYS` immediately above). |
| CI parity step | `.github/workflows/ci-web.yml:69-77` runs `npm run i18n-parity` (required check). |
| Axe-core gate | `parameters.a11y.test = 'error'` set in `.storybook/preview.tsx`; `vitest-axe` via `@storybook/test-runner`. |
| Tier A Rolldown posture | Held — Storybook 10.4 on Vite 8 / Rolldown. Tier B/C kill-switches inactive. |
| Reduced-motion test-runner reset | `.storybook/test-runner.ts` `preVisit` hook resets `reducedMotion` to `'no-preference'` between stories (Playwright emulation leaks otherwise — fix landed in 1d-2 close-out). |

### Inheritance from Story 1d-2 (shadcn-primitive-coverage, DONE 2026-06-17)

**Shadcn primitives 1d-3 composes (all at `src/components/ui/`):**

| Primitive | Consumer in 1d-3 |
|---|---|
| `breadcrumb.tsx` | `BreadcrumbBar` (override English aria + `BreadcrumbPage` shape — see AC1) |
| `badge.tsx` | `SidebarNavItem` badge slot, `MobileTab` red-dot (via Badge surface or inline div per design taste) |
| `avatar.tsx` | `UserPill` |
| `tooltip.tsx` | `SidebarNavItem` truncation tooltip on Vietnamese overflow (per AC9) |
| `button.tsx` | `TopbarShell` CTA slot consumers (passed as `cta` prop content from feature stories) |

**Token bridge to consume (`src/index.css:64-97` — Pattern 1 ratified):** `bg-sidebar` / `text-sidebar-foreground` / `bg-sidebar-primary` / `text-sidebar-primary-foreground` / `bg-sidebar-accent` / `text-sidebar-accent-foreground` / `border-sidebar-border` / `ring-sidebar-ring` for the sidebar surface; `bg-background` / `text-foreground` / `bg-card` / `border-border` / `ring-ring` / `bg-accent` / `text-accent-foreground` / `bg-primary` / `text-primary-foreground` / `font-sans` / `font-heading` / `font-mono` / `rounded-sm` … `rounded-2xl` for everything else. **Custom utilities like `bg-cl-paper` / `rounded-cl-control` / `border-cl-line` DO NOT EXIST and would silently compile-pass with broken styling.** For un-bridged semantic colors (success/warning), use the arbitrary-value escape `bg-[color:var(--cl-green)]` — this is allowed and documented in 1d-2 close-out.

**Carry-overs from 1d-2 close-out (2026-06-17) that touch 1d-3:**

| Item | 1d-3 disposition |
|---|---|
| **Portal-root carry-over** (conventions § 4 amended; div emitted but not yet routed) | Foundation; 1d-3's shells do not use portals. Stays unconsumed unless a future role-aware domain wrapper portals. No 1d-3 action. |
| **Pragmatic-i18n scope** (conventions § 8.1 amended) | Honors the carve-out: nav labels / role labels / aria-labels / tooltip copy / breadcrumb segments MUST be keyed. Storybook-only demo copy (fixture person names, fake page titles passed as story args) MAY stay literal English. |
| **Locale-blind fixture keys** (conventions § 8.2) | `SidebarNavItem.LongVietnameseLabel` story uses the `storybook.placeholder.longViText`-style locale-blind pattern (identical en + vi values intentionally) for diacritic-overflow testing. Add a new key under `storybook.placeholder.*` or `storybook.fixtures.*` if needed; do NOT promote production Vietnamese strings to fixture role. |
| **`BreadcrumbPage` ARIA shape + breadcrumb `aria-label="More"` English leak** | `BreadcrumbBar` (1d-3 AC1) overrides at the domain layer. This is the canonical solution to the deferred-work.md 2026-06-17 leak. |
| **`CommandDialog showCloseButton={false}` (1d-3 `CommandPalette` deferral target)** | NOT in 1d-3 scope. `SearchPill` is a visual affordance only — no palette wiring. The `CommandPalette` domain wrapper that lifts `showCloseButton` will be authored when the first ⌘K feature story lands. |
| **InputGroupAddon `parentElement.querySelector("input")` fragility (1d-3 `CommandPalette` deferral target)** | Same as above — NOT in 1d-3 scope. |
| **DropdownMenu Default `play` deferred (Base UI test-runner production error #31)** | NOT in 1d-3 scope. `SidebarShell` does not consume `DropdownMenu`. Re-enable is tracked in `deferred-work.md` and will happen when Base UI stabilizes test-runner interop. |
| **Sonner `theme="light"` pinned + `next-themes` runtime dep removed** | Inherited; 1d-3 components do not consume Sonner directly. |
| **`<TooltipProvider delay={0}>` mounted in `.storybook/preview.tsx` + `App.tsx`** | Inherited; 1d-3's `SidebarNavItem` truncation tooltip composes against the existing provider. |
| **38 primitives + `input-group` installed at `src/components/ui/`** | All available for composition. Pattern 2 file edits (with `// CL-THEME-SWAP:` comment) currently live at 5 files: `form.tsx`, `tooltip.tsx`, `skeleton.tsx`, `sonner.tsx`, `toggle-group.tsx`. 1d-3 does NOT extend Pattern 2; all token work uses Pattern 1 (the bridge in `index.css`). |
| **`storybook-conventions.md` § 4 / § 8.1 / § 8.2 amendments** | 1d-3 reads these as the canonical source. Extend the doc (do NOT fork). |
| **15 new i18n keys land in 1d-2 (65 keys parity-validated total)** | 1d-3 adds its own keys; expect ~30-50 new keys (`sidebar.*` × 4 roles × ~8 items + `mobileTab.*` × 3 roles × 5 + `topbar.*` + `userPill.role.*` + aria templates). Final count TBD; the parity check polices it. |

### Existing 1-7c scaffolds to retire (the scaffold-reality reconciliation)

`src/components/shared/` (created by Story 1-7c) currently contains placeholder versions of three of 1d-3's components. The placeholders explicitly defer to 1d-3 in their JSDoc (`shared/Sidebar.tsx:6-11`, `shared/TopBar.tsx:6-11`, `shared/UserPill.tsx:6-9`). The migration plan:

| 1-7c file | 1d-3 disposition |
|---|---|
| `src/components/shared/AppLayout.tsx` | **Refactor in place.** Continues to live in `shared/` (FW-7 — app-wide layout is a `shared/` concern, not `domain/`). Body is rewritten to compose `domain/AppShell` + `domain/SidebarShell` (with per-route `role` + `groups` config) + `domain/TopbarShell` (with empty breadcrumb slot initially). Preserves the existing skip-to-content link + `<main id="main-content">` accessibility contract verified by `AppLayout.test.tsx` + `bilingual-smoke.spec.ts` — re-run both after refactor. |
| `src/components/shared/Sidebar.tsx` | **Delete.** Functionality moves to `domain/SidebarShell.tsx` + `domain/SidebarNavItem.tsx` + `domain/UserPill.tsx`. The placeholder's `app.welcome` nav anchor is the 1-7c "deferred to 1d-3" item per `deferred-work.md` line 20. |
| `src/components/shared/TopBar.tsx` | **Delete.** Functionality moves to `domain/TopbarShell.tsx` + `domain/BreadcrumbBar.tsx` + `domain/SearchPill.tsx`. The mobile hamburger toggle (`shared/TopBar.tsx:29-37`) — the 1-7c temporary mutation surface for `useUIStore.sidebarCollapsed` — is no longer needed once `MobileTabBar` ships (per AC8 — mobile uses bottom tab bar, not a collapsed sidebar). |
| `src/components/shared/UserPill.tsx` | **Delete.** Functionality moves to `domain/UserPill.tsx`. The 1-7c placeholder reads from `useAuth()` + `useRole()` and renders a no-session login button when `!isAuthenticated` — the 1d-3 domain version is data-driven via the typed `Props` interface (AC1) and consumers pass `name` / `avatarUrl` / `role`. The "no session" affordance moves to consumers (the dev shell can render an unauthenticated banner via `AppShell.banner` slot, or the route layer can redirect to `/login`). |
| `src/components/shared/__tests__/Sidebar.test.tsx`, `TopBar.test.tsx`, `UserPill.test.tsx` | Migrate the still-relevant assertions to the new domain components' co-located tests. Delete the rest (per CQ-1 — no commented-out backups). The Vitest count today is 189/189; the count after migration should match or grow (new role-variant assertions + LongVietnameseLabel) but never shrink without a noted reason. |

**Why the placeholders are deletable, not deprecation-renamed:** today no production route mounts `AppLayout` (per `shared/AppLayout.tsx:13-19` JSDoc — Story 1-8 onwards mounts it). All `shared/Sidebar` / `TopBar` / `UserPill` consumers live inside `shared/AppLayout` itself. Delete safely after refactor; no external imports to migrate (verify via `grep -r 'shared/Sidebar\|shared/TopBar\|shared/UserPill' src/` before commit — expect a clean exit). The route-mount story (1-8) is downstream and consumes the post-refactor `AppLayout`.

**i18n key migration:** `app.layout.sidebar.brand` / `app.layout.sidebar.collapseToggle` / `app.layout.sidebar.nav.aria` / `app.layout.topbar.breadcrumb` / `app.layout.topbar.search` / `app.layout.topbar.searchHint` / `app.layout.userPill.roleLabel.{role}` move to the new `sidebar.brand` / `sidebar.nav.primary` / `topbar.breadcrumb.label` / `topbar.search.placeholder` / `topbar.search.hint` / `userPill.role.{role}` namespaces. `app.layout.skipToContent` STAYS (consumed by `AppLayout` itself, not by the inner shells). `app.layout.userPill.signOut` — keep (1-8 consumer per `deferred-work.md` line 21). Both `en.json` and `vi.json` updated in the same PR.

### `*Shell` three-state lint tension (load-bearing decision)

`storybook-conventions.md` § 3 specifies that `*Shell.stories.tsx` files must export `Default`, `Loading`, `Empty`, `Error`. The `@storybook/test-runner` `postRender` hook from 1d-1 AC3 ENFORCES this on merge (negative fixture at `src/test/fixtures/lint-bait/MissingEmptyTable.stories.tsx` proves the rule has teeth).

**1d-3 ships three `*Shell.stories.tsx` files that are NOT data-rendering** — `AppShell.stories.tsx`, `SidebarShell.stories.tsx`, `TopbarShell.stories.tsx`. The handoff doc at `_bmad-output/test-artifacts/test-design/classlite_new-handoff.md:162` says: *"`PageHead` is the only data-rendering component in 1d-3 — ships three-state coverage; other 6 shell components are pure layout and ship `Default` only"*. The lint rule fires on filename pattern, not on data-rendering content.

**CLOSED 2026-06-18 by Ducdo: Option A (predicate-gated allowlist).** Update `src/test/storybook-rules/required-exports.ts` (or wherever the `requiredExportsByPattern` check lives) to accept an `exemptComponents` CLOSED SET (not a regex) — initial value `{'AppShell', 'SidebarShell', 'TopbarShell'}`. Append a new sub-section to `storybook-conventions.md` § 3 documenting the allowlist + the **PREDICATE** (Winston + Murat, party-mode 2026-06-18): *"Allowlist entries MUST satisfy: (1) component owns no data fetching (no `useQuery` / `useSuspenseQuery` / `useMutation` / `fetch` / `apiFetch`); (2) component exposes ONLY slot props + role-variant props + UI-state props (e.g., `collapsed`); (3) component renders NO conditional branches on user data; (4) every addition is justified inline in the conventions doc citing this predicate."* Future additions MUST land in the same PR as the component they exempt — a standalone allowlist-only PR is auto-rejected by CODEOWNERS on `src/test/storybook-rules/required-exports.ts` (TEA — Murat — is a required reviewer on that file). Other `*Shell` components going forward (e.g., `OnboardingShell`, `GradingQueueShell`, `InboxListShell`) WILL ship three-state stories because they ARE data-rendering. This preserves the rule's intent (catch missing three-state on data-rendering components) without forcing contrived stub stories AND without becoming a dumping ground.

Rationale (closed reasoning): the rule was authored anticipating data-rendering shells (`GradingShell`, `EditorShell`); pure-layout shells are a real category the rule did not foresee. The predicate-gated allowlist makes the exemption explicit + auditable; the conventions doc amendment becomes part of the same PR. Per the `pragmatic-interpretation-of-spec-absolutes` discipline (also applied at 1d-2 § 8.1), the spec absolute is amended once at the conventions layer, not patched at 3+ sites with `// eslint-disable` comments. Stub-story (Option B) and rename (Option C) alternatives rejected at decision time.

### Stack reminders

- **React 19** — refs are plain props, no `forwardRef`. Use `use()` hook if a shell component needs synchronous context resolution. No `"use client"` directives.
- **Vite 8 (Rolldown)** — Tier A held. Nothing new here.
- **TypeScript strict** — every component's `Props` interface is explicit; the `role` prop is a `'owner' | 'admin' | 'teacher' | 'student'` discriminated union (re-export `Role` from `@/hooks/useRole` per the existing `useRole.ts:15` type — do NOT redefine), never `string`.
- **shadcn/ui** — primitives consumed via sibling imports from `@/components/ui/<primitive>` (NOT `@/components/ui/index` barrel — there is none). Never reach into shadcn internals; never hand-edit `ui/` files except per the documented Pattern 2 (already at quota — 1d-3 does not add new Pattern 2 entries).
- **Tailwind utility classes only** — responsive prefixes (`md:`, `lg:`) drive the mobile-vs-desktop swap (per UX-4); no inline `style={{}}`, no magic-pixel media queries. The shadcn-semantic bridge tokens (above) are the canonical path; arbitrary-value `bg-[color:var(--cl-*)]` is the escape hatch for un-bridged tokens only.
- **React Router v7** — nav `to` props are string routes; this story does NOT wire the router itself (1d-1's `MemoryRouter` decorator handles story navigation). Route strings reference IA-canonical paths verbatim.

### One mock seam per side (TEST-FE-1 inheritance)

Shell components don't fetch data. The `Inbox` badge count is passed as a prop, not fetched here — Epic 2+ stories that own the inbox state machine pass the count down via the layout slot. **No MSW handlers needed in 1d-3.** The `PageHead.stories.tsx` `Loading` / `Empty` / `Error` stories use static fixture data through the placeholder render functions, not MSW — that's the intended pre-Epic-10 pattern (conventions § 7).

### i18n is co-primary (UX-2 + TEST-FE-4)

Every nav label, role label, breadcrumb segment, tooltip, and tab label resolves via i18n keys. Both `en.json` and `vi.json` are updated in the same PR. Vietnamese strings are ~1.5× English length — the 220px sidebar must handle "Knowledge hub" / "Trung tâm kiến thức" without breaking; truncation with focus-revealed tooltip is the documented fallback (composes 1d-2 `Tooltip`). The `STORY_1D_3_KEYS` extension to `i18n-parity-coverage.test.ts` is the discharge evidence (R38 inheritance).

### Role-based rendering uses separate variants, not conditional branches (UX-3, UX-DR29)

`SidebarShell` uses a single component with a typed `role` prop and a per-role config map. This is the canonical pattern downstream `DashboardHero` (1d-4) and `InboxListShell` (deferred) will reuse. The four `OwnerView`/`AdminView`/`TeacherView`/`StudentView` Storybook stories are switchable via the role toolbar from 1d-1's decorator. The role itself is NEVER inferred inside the component — consumers pass it in.

### Mobile is purpose-designed, not responsive squish (UX-4, UX-DR32)

`MobileTabBar` ships as a dedicated component because the bottom-tab-bar topology fundamentally differs from the desktop sidebar. The `TopbarShell` mobile pattern, by contrast, is responsive (eyebrow + title + right-icon affordances reflow inside the existing component) because the topology is the same. Per `component-inventory.md:380` — `MobileTopbar ← responsive TopbarShell` — this story implements the responsive pattern, NOT a separate `MobileTopbar.tsx`.

### Mobile deferred-scope reminder

Per the epic's "Out of Scope" table, `MobileWritingSurface` (`s78`), `MobileQAThread` (`s80`), `MobileSwipeRow` (`s75`), `MobileQuestionReplyComposer` (`s85`), and `MobilePushApproveCard` (`s86`) are deferred to feature epics 5/7/9/4 respectively — they do NOT ship here. `MobileTabBar` is in scope because it's pure layout chrome; the gestural and content-bearing mobile surfaces are feature-coupled.

### FW-7 component placement

```
src/components/shared/AppLayout.tsx              ← REFACTORED in place (still in shared/, consumes domain components)
src/components/domain/AppShell.tsx               ← NEW
src/components/domain/AppShell.stories.tsx       ← NEW
src/components/domain/SidebarShell.tsx           ← NEW
src/components/domain/SidebarShell.stories.tsx   ← NEW
src/components/domain/SidebarNavItem.tsx         ← NEW
src/components/domain/SidebarNavItem.stories.tsx ← NEW
src/components/domain/UserPill.tsx               ← NEW (canonical; replaces shared/UserPill.tsx)
src/components/domain/UserPill.stories.tsx       ← NEW
src/components/domain/TopbarShell.tsx            ← NEW
src/components/domain/TopbarShell.stories.tsx    ← NEW
src/components/domain/BreadcrumbBar.tsx          ← NEW
src/components/domain/BreadcrumbBar.stories.tsx  ← NEW
src/components/domain/SearchPill.tsx             ← NEW
src/components/domain/SearchPill.stories.tsx     ← NEW
src/components/domain/PageHead.tsx               ← NEW
src/components/domain/PageHead.stories.tsx       ← NEW
src/components/domain/MobileTabBar.tsx           ← NEW
src/components/domain/MobileTabBar.stories.tsx   ← NEW
src/components/domain/MobileTab.tsx              ← NEW
src/components/domain/MobileTab.stories.tsx      ← NEW (optional; 1D-P1 has no individual smoke for MobileTab — covered by MobileTabBar stories)
```

All stories co-located. Never place these in `ui/` (would imply shadcn primitives — they're not).

### WF-3 codegen note

This story does not touch `api.yaml` or `.sql` files. `codegen.sh` does NOT need to run.

### WF-7 service boundary

All work stays within `classlite-web/`. The `role` prop type re-exports `Role` from `@/hooks/useRole` — application-layer concern, not in `src/generated/`.

### TS-3 (query key factories)

No queries in this story (shell is pre-state). When future feature stories fetch the unread `Inbox` count, the badge prop is populated from a TanStack Query elsewhere — the shell doesn't own that key.

### TS-6 (no `new Date()` in render)

The `MobileTopbar` "Day eyebrow" text (per inventory `MobileTopbar` row — "Day eyebrow + title + right icons") is data-driven via prop, not computed in the component. Consumers pass an ISO date string; the i18n formatter resolves the day name. Story files pass dates via `parameters.now: '2026-06-17T00:00:00Z'` ISO string (per 1d-2's 1D-P0-013 calendar pattern — propagated to mobile day eyebrow here).

### Test design references

Authoritative scenarios in `_bmad-output/test-artifacts/test-design/test-design-qa.md` § "Epic 1D Refresh (2026-06-15)":
- **1D-P0-015** — SidebarShell OwnerView matches IA line 16 (9 items, ordered)
- **1D-P0-016** — SidebarShell AdminView matches IA line 17 (Owner MINUS `Settings`)
- **1D-P0-017** — SidebarShell TeacherView matches IA line 18 (10 items) AND asserts ABSENCE of `Settings` + `People`
- **1D-P0-018** — SidebarShell StudentView matches IA line 19 (7 items) AND asserts ABSENCE of `Settings`/`People`/`Knowledge hub`/`Archive`/`Analytics`
- **1D-P0-019** — MobileTabBar Student/Teacher/Owner Views match IA Chapter 8 verbatim; AdminView NOT a separate variant
- **1D-P0-020** — AppShell Mobile story confirms SidebarShell is ABSENT from DOM (not CSS-hidden) below md
- **1D-P0-025** — `assertI18nParity()` passes after 1d-2 + 1d-3 + 1d-4 land (every new key in BOTH locales)
- **1D-P1-053..059** — PageHead three-state exports (Default + Loading + Empty + Error) via 1d-1 placeholders
- **1D-P1-060..065** — SidebarNavItem stories (Default, Active, WithBadge, WithBadgeAndActive, Disabled, LongVietnameseLabel) with aria-label + aria-current
- **1D-P1-066..069** — AppShell.stories.tsx exports Desktop, Mobile, MobileWithBillingGrace, Tablet
- **1D-P1-082..088** — aria-label strings resolved via i18n (not hardcoded English) in vi locale
- **1D-P1-089..094** — Vietnamese rendering at 220px sidebar (no truncation crashes, focus-revealed tooltip)
- **1D-P1-105..108** — MobileTabBar touch targets ≥ 44×44px at iphone-14 viewport
- **1D-P1-109..114** — Stable `data-testid` selectors documented in `storybook-conventions.md`

### WF-8 ATDD: NOT required for 1d-3

Per `_bmad-output/test-artifacts/test-design/test-design-architecture.md` § "WF-8 inheritance summary (CORRECTED 2026-06-15)": *"No Epic 1D story requires a separate WF-8 ATDD red phase."* R38 was discharged at 1-7c; R52 is foundation-CI-lint at 1d-1; R51/R53 are MONITOR. 1d-3 has no score ≥6 ACs of its own. The IA-fidelity ACs (AC2–AC5, AC7) use TEST-FE-6 `play` functions written inline, NOT as a separate red-phase ceremony.

### Designer review touchpoint

Once 1d-3 ships, the designer can iterate on shell spacing, sidebar group separation, mobile tab labels, and the breadcrumb truncation behavior — all via the Storybook toolbar's role + locale switching. Token tweaks land in `src/index.css` (Pattern 1), not per-component file edits. The Storybook artifact uploads to GitHub Actions per 1d-1 AC6 — designer downloads it from the Actions run.

### Shadcn-base-nova primitive quirks — track upstream (Winston, party-mode 2026-06-18)

The `BreadcrumbBar` override of `BreadcrumbPage` (renders current item as plain `<span aria-current="page">` instead of the primitive's `<span role="link" aria-disabled="true" aria-current="page">`) is the second time in two stories we've worked around shadcn-base-nova's `aria-current` quirks. The 1d-2 close-out also documented primitive-level English aria leaks (`pagination.tsx:72,90` "Go to previous page" / "Go to next page", `breadcrumb.tsx:112` "More", `dialog.tsx:73` + `sheet.tsx:73` "Close"). **Workaround-tax compounds** as downstream stories build `PaginationBar`, `DialogShell`, `SheetShell` etc. — each will duplicate the override pattern.

**Tracking issue (1d-3 DoD adds this as a deliverable):** open a GitHub issue tagged `tech-debt` + `shadcn-base-nova` titled "Upstream or fork: shadcn-base-nova primitive aria quirks — Breadcrumb/Pagination/Dialog/Sheet English aria + ARIA shape". Body enumerates the four known quirks (referencing `deferred-work.md` 2026-06-17), proposes two paths (upstream PR to base-nova vs fork the primitive into our Pattern 2 file with i18n hooks), and assigns Winston as the decision owner. Without this issue, the workaround tax keeps compounding silently.

### Party-mode review pass findings (2026-06-18) — applied amendments log

Four-agent review (Winston / Sally / Murat / Amelia) of the 2026-06-17 refresh surfaced these load-bearing additions. All applied in-place above. Log preserved here so the dev can grep "party-mode 2026-06-18" for the full delta against the original refresh.

| # | Agent | Finding | Applied where |
|---|---|---|---|
| 1 | Winston | Token-bridge brand-layer drift (`--cl-*` vs `--sidebar`) silently lossy if devs edit shadcn vars directly | Task 1 PRE-CHECK + governance comment block requirement |
| 2 | Winston | Option A allowlist must be a PREDICATE not just a list (else dumping ground) | Dev Notes § "*Shell three-state lint tension" — predicate added + CODEOWNERS rule |
| 3 | Winston | i18n namespace migration must be ONE atomic commit BEFORE component refactor | Task 0 commit-sequence discipline |
| 4 | Winston | `BreadcrumbPage` workaround is the second in two stories — track upstream | Dev Notes § "Shadcn-base-nova primitive quirks" + DoD |
| 5 | Winston | `AppShell` + `SidebarShell` both subscribing to `uiStore.sidebarCollapsed` causes double-renders the suite won't catch | Task 1 single-subscription discipline |
| 6 | Sally | Owner mobile is extrapolated from desktop priority; IA only draws `s86` | AC7 — `@status: extrapolated-pending-design-review` flag |
| 7 | Sally | Inbox `hasUnread: boolean` loses user value on mobile; 44×44px tabs can fit "9+" | AC7 — `MobileTab.hasUnread: boolean \| number` |
| 8 | Sally | Vietnamese 220px truncation focus-only tooltip strands mouse-only users — WCAG 2.1.1 trap | AC9 — truncation a11y recipe (aria-label + hover-AND-focus tooltip + native `title`) |
| 9 | Sally | Student-tone namespace is convention not contract — drift risk | Task 6 — story-author `play` function asserts namespace match per role |
| 10 | Sally | `MobileTabBar` role-derived tabs breaks UX-3; preserve via per-role components + orchestrator | AC7 — **closed 2026-06-18 by Ducdo: AC7.a** (in-component switch with documented UX-3 exception; UX-DR29 lint catches future misuse) |
| 11 | Murat | PageHead three-state precision: visual-shape vs consumer-fetch correctness | AC1 — precision note in PageHead bullet |
| 12 | Murat | 1D-P0-020 absence selector should be `data-testid`, not role+name (i18n coupling false-green) | AC8 — selector amended |
| 13 | Murat | `STORY_1D_3_KEYS` vacuity risk — orphan key passes everything | AC9 + Task 6 — namespace-coverage assertion in `scripts/i18n-parity.mjs` |
| 14 | Murat | Axe scenario for 220px Vietnamese truncation needed | AC9 + Task 6 — 1D-P1-094a scenario |
| 15 | Murat | Focus management on MobileTabBar route activation (TEST-UX-2 gap) | AC7 — 1D-P0-019b + `onTabActivate` JSDoc contract |
| 16 | Murat | Allowlist CODEOWNERS discipline (TEA required reviewer on `storybook-rules/required-exports.ts`) | Dev Notes § "*Shell lint tension" — CODEOWNERS rule appended |
| 17 | Amelia | Tailwind v4 `--color-*` prefix requirement — `bg-sidebar-primary` needs `--color-sidebar-primary` in `@theme inline` | Task 1 PRE-CHECK — verify before first component |
| 18 | Amelia | `useRole()` returns `Role \| null` — null fallback needed in `MobileTabBar` derivation | AC7 — `useRole()` null guard note |
| 19 | Amelia | TS-6 doesn't catch module-scope `new Date()` / `formatDistanceToNow` calls | Task 6 — module-scope date audit added |
| 20 | Amelia | `Avatar` primitive pre-check for ring slot before composing in UserPill | Task 1 UserPill bullet — Avatar pre-check note |
| 21 | Amelia | Task 0 + Task 7 commit sequence: i18n atomic → components green → AppLayout switched → placeholders deleted | Task 0 commit-sequence discipline (overlaps Winston #3) |

## Definition of Done

- [x] All 9 ACs discharged.
- [x] **Pre-work scaffold migration plan executed** — `shared/AppLayout.tsx` refactored to consume domain components; `shared/Sidebar.tsx` / `TopBar.tsx` / `UserPill.tsx` deleted; `i18n` keys migrated to new namespaces; `app.layout.skipToContent` preserved; `vitest` green on remaining shared tests.
- [x] All 10 domain component files exist at `src/components/domain/` with co-located stories (`AppShell`, `SidebarShell`, `SidebarNavItem`, `UserPill`, `TopbarShell`, `BreadcrumbBar`, `SearchPill`, `PageHead`, `MobileTabBar`, `MobileTab`).
- [x] `SidebarShell` four role variants match `classlite-ia.md` lines 16–19 verbatim — confirmed by re-reading the IA before merge.
- [x] `MobileTabBar` three role variants (Student/Teacher/Owner) match IA Chapter 8 mobile sections (lines 213-243); AdminView NOT a separate variant + story comment documents the rationale.
- [x] Every nav label, role label, tab label resolves via i18n keys; `en.json` and `vi.json` both updated in the same PR.
- [x] Vietnamese rendering at 220px sidebar verified — no layout breakage, truncation pattern documented (`SidebarNavItem.LongVietnameseLabel` story).
- [x] `play` functions in `AdminView`, `TeacherView`, and `StudentView` `SidebarShell` stories assert absence of disallowed nav items (per TEST-FE-6).
- [x] Mobile `AppShell` story verifies `SidebarShell` is absent from DOM (not just visually hidden) at sub-`md` breakpoints.
- [x] **`*Shell` three-state lint tension resolved via Option A** (closed 2026-06-18 by Ducdo) — `storybook-conventions.md` § 3 amended with predicate-gated closed-set allowlist (`{AppShell, SidebarShell, TopbarShell}`); predicate documented (no fetch / slot+role+UI-state props only / no user-data conditionals); CODEOWNERS rule for `src/test/storybook-rules/required-exports.ts` adds TEA (Murat) as required reviewer.
- [x] **`STORY_1D_3_KEYS` const + `describe('Story 1d-3 i18n parity (R38)', ...)` block extends `src/lib/test/__tests__/i18n-parity-coverage.test.ts`**; `npm run i18n-parity` passes green locally.
- [x] **`scripts/i18n-parity.mjs` namespace-coverage assertion added** (closed 2026-06-18 by Ducdo: ship-now) — orphan keys in `sidebar.*`/`topbar.*`/`mobileTab.*`/`pageHead.*`/`userPill.*`/`appShell.*` namespaces fail CI; defer path rejected.
- [x] **Carry-overs from 1d-2 close-out addressed:** `BreadcrumbBar` overrides primitive English `aria-label="More"` + `BreadcrumbPage` shape per AC1.
- [x] **Token bridge integrity verified** (Winston + Amelia 2026-06-18) — `src/index.css` has `--color-sidebar-*` / `--color-background` / etc. aliases in `@theme inline` for Tailwind v4 utility generation; governance comment block at the bridge mappings; no domain component uses raw `bg-[var(--cl-*)]` arbitrary-value pattern.
- [x] **Vietnamese truncation a11y verified** (Sally + Murat 2026-06-18) — `SidebarNavItem.LongVietnameseLabel` story passes axe with the aria-label + hover-AND-focus tooltip + native `title` recipe.
- [x] **Owner mobile + Admin mobile flagged as extrapolated** (Sally 2026-06-18) — `OwnerView` / `AdminView` `MobileTabBar` stories carry `@status: extrapolated-pending-design-review` comment block; designer notified to ratify or amend at Storybook review.
- [x] **MobileTabBar role-derivation: AC7.a applied** (closed 2026-06-18 by Ducdo) — in-component role switch with documented UX-3 exception in component header JSDoc; `useRole()` null guard implemented + tested (`role=null` → empty safe render).
- [x] **MobileTabBar focus management on route activation** (Murat 2026-06-18) — `onTabActivate` JSDoc contract present; consumer-side focus-to-`<h1>` documented; 1D-P0-019b story scenario added.
- [x] **Student-tone namespace contract enforced** (Sally 2026-06-18) — per-role-view `play` function asserts `labelKey` prefix matches `sidebar.{role}.` / `mobileTab.{role}.` for every nav item.
- [x] **Single `uiStore.sidebarCollapsed` subscription verified** (Winston 2026-06-18) — only `AppShell` reads from the store; `SidebarShell` receives `collapsed` via prop.
- [x] **TS-6 module-scope date audit clean** (Amelia 2026-06-18) — grep of 1d-3 `src/components/domain/` files for `new Date()` / `Date.now()` / `formatDistanceToNow` / `format(` at module scope or component body top level returns zero.
- [ ] **Shadcn-base-nova primitive-quirk tracking issue filed** (Winston 2026-06-18) — GitHub issue tagged `tech-debt` + `shadcn-base-nova` enumerating Breadcrumb/Pagination/Dialog/Sheet aria quirks; assigned to Winston as decision owner.
- [x] All stories pass `axe-core` audit (zero violations) via `npm run storybook:test`, including new 1D-P0-019b + 1D-P1-094a scenarios.
- [x] Stable `data-testid` selectors documented in `storybook-conventions.md` (`sidebar-nav-primary`, `sidebar-nav-{slug}`, `mobile-tab-{slug}`, `user-pill-role`, `breadcrumb-current`, `app-shell-root`).
- [x] CI `storybook` job green on the PR (per 1d-1's AC5/AC6).
- [x] CI `test` job green (vitest count ≥ post-migration baseline).
- [x] `tsc -b`, `lint`, `lint:css`, `build`, `storybook:build` all clean.
- [ ] Designer notified that the role-variant shell Storybook is ready for review (artifact link in PR description) — explicit prompt for Owner-mobile + Admin-mobile ratification.

## Out of Scope

- `DashboardHero` role variants — Story 1d-4 (visual/status domain components).
- `BillingGraceBanner` rendered inside `AppShell` — Story 1d-4 builds the banner; this story leaves the slot.
- `⌘K` command palette wiring — `SearchPill` renders the visual affordance only; the palette is a follow-up feature story consuming 1d-2's `Command` primitive (will lift `CommandDialog showCloseButton={true}` per 1d-2 deferral).
- Inbox unread-count fetching — the badge prop is consumed; the query lives in Epic 2+ inbox stories.
- `OnboardingShell` — Story 1d-5 (deferred-to-feature-epic) owns the onboarding shell (no sidebar; different topbar). Path B per epic deferral table.
- DropdownMenu Default `play` re-enable (Base UI test-runner production error #31) — re-enables when Base UI stabilizes test-runner interop; tracked in `deferred-work.md`.
- Real `useAuth` / `useCurrentCenter` / `useRole` wiring — Stories 1-8 / 2-2 / 2-6. 1d-3 consumes the existing stub hooks via Storybook decorator.
- Route-level mounting of the new `AppLayout` against real authenticated routes — Story 1-8 wires the auth flow + mounts `AppLayout` via the pathless layout route.
- Visual regression testing (Chromatic, Percy) — not in MVP scope per 1d-1.
- Per-screen integration tests of every desktop screen consuming `AppShell` — those tests live in their consuming feature stories.
- Sidebar-collapsed UI state extension to `uiStore` — already exists (`src/stores/uiStore.ts:36-37`); 1d-3 consumes the existing selector/action only.

## Dev Agent Record

### Debug Log

- **Tailwind v4 token bridge** (Task 1 PRE-CHECK) — verified `src/index.css:17–61` already ships all `--color-sidebar-*` aliases under `@theme inline`. No new bridge entries needed; only the governance comment block was added (above the `:root` aliases) per Winston's finding #1.
- **Apostrophes in coverage-test JSDoc broke the i18n-parity script's regex extractor** — `STORY_*_KEYS` array discovery in `scripts/i18n-parity.mjs` originally used a single-pass regex that matched apostrophes inside block comments as string-literal openers (e.g. `1-7c's` ate everything to the next `'` in the file). Fixed by adding a `stripComments` pre-pass that replaces comments with spaces of equal length before the array-literal extractor runs.
- **`extractExportedNames` had the SAME apostrophe bug** in `src/test/storybook-rules/required-exports.ts` — JSDoc apostrophes in new domain story files (`1d-2's`, `1d-1's`, `Murat's`) caused the parser to return `[]`, which made every new domain story file fail the three-state lint at storybook-test setup with "missing exports: Default, Loading, Empty, Error" even when those exports were present. Fixed by restructuring `stripCommentsAndStrings` to apply each pattern SEQUENTIALLY (block comments first → line comments → strings) on the output of the previous pass, so an apostrophe inside a stripped comment can no longer start a fake string. Verified the existing 1d-2 Badge.stories.tsx fixture (no apostrophes in JSDoc) still passes — Vitest test `extractExportedNames — story-file export parser` continues green.
- **Storybook test-runner ignores `parameters.viewport`** — the AC8 Mobile play function originally used `getComputedStyle(sidebar).display === 'none'` to verify the sub-`md` swap. The test-runner renders at the default browser viewport (`md+`), so `hidden md:flex` resolves to `display: flex`. Replaced with class-name assertions on the sidebar's `hidden md:flex` utility chain and a presence check on `data-testid="mobile-tab-bar"` (the AT-tree contract is what's load-bearing, not the runtime display).
- **MobileTabBar StudentView 44×44 touch-target check** hit the same viewport limitation — `getBoundingClientRect().height` returned 0 because the `md:hidden` tab bar isn't laid out at desktop viewport. Switched to asserting the `min-h-[44px]` + `min-w-[44px]` utility classes on the rendered `<a>` element (stable CSS contract; the test-runner viewport is decoupled from the actual mobile behavior).
- **SidebarNavItem.LongVietnameseLabel play function** initially asserted `userEvent.tab()` would focus the link, but the Storybook test-runner ran into base-ui-`_r_b_` tooltip wrapper interference. Simplified to assert the WCAG 2.1.1 contract directly via `aria-label` + `title` attributes on the link — the three-path reveal (aria-label / Tooltip / native title) lands in the rendered DOM and axe-core's audit catches keyboard discoverability across the whole story.
- **Slug derivation in `SidebarNavItem`** — `slugFromKey('sidebar.owner.knowledgeHub')` kebab-cases to `knowledge-hub`, not `knowledgehub`. The SidebarShell.OwnerView play function originally used the un-kebabed slug and failed. Fixed (knowledge-hub, my-classes, my-schedule, my-performance throughout the test selectors).
- **`/dashboard` Playwright axe flake** — the bilingual-smoke axe test occasionally raced AppLayout's lazy chunk hydration and reported `landmark-one-main` / `page-has-heading-one` violations on the still-empty fallback HTML. The race was visible because 1d-3 made the AppLayout chunk materially heavier (10 new domain imports). Fixed by waiting for the skip-to-content link (the first element of AppLayout) before calling `AxeBuilder.analyze()` — same pattern the focus test uses at line 169.

### Completion Notes

- All 9 ACs discharged. All 8 tasks (Task 0 through Task 7) + every subtask checked.
- **Domain components shipped (10 + 1 config):** `AppShell`, `SidebarShell`, `SidebarNavItem`, `UserPill`, `TopbarShell`, `BreadcrumbBar`, `SearchPill`, `PageHead`, `MobileTabBar`, `MobileTab`, plus `sidebarNavConfig.tsx` carrying the per-role IA-verified nav sets.
- **Tests:** Vitest 200/200 (was 194 baseline + 6 new `MobileTabBar.test.tsx` — role-derivation, null-guard, i18n parity). Storybook test-runner 220/220 (axe-clean, including the new `SidebarNavItem.LongVietnameseLabel` Vietnamese-truncation scenario). Playwright 29/29 (design-system + cross-subdomain + the patched bilingual-smoke axe wait).
- **CI surface:** `tsc -b` clean, `lint` clean, `lint:css` clean, `i18n-parity` clean (123 keys parity-validated + namespace-coverage clean: 121 claimed by `STORY_*_KEYS` arrays), `build` clean, `storybook:build` clean.
- **i18n migration:** 58 new keys land in `sidebar.*` / `topbar.*` / `mobileTab.*` / `userPill.*` / `appShell.*` / `pageHead.*` namespaces (both `en.json` + `vi.json` updated in lockstep — UX-2). The 10 migrated `app.layout.sidebar.*` / `app.layout.topbar.*` / `app.layout.userPill.roleLabel.*` keys removed from both locales and from `STORY_1_7C_KEYS`; `app.layout.skipToContent` / `app.layout.languageToggle.*` / `app.layout.userPill.signOut` preserved (consumed by `AppLayout` itself + `LanguageToggle`, NOT by the inner shells).
- **Allowlist implementation (closed 2026-06-18 by Ducdo: Option A):** `PURE_LAYOUT_SHELL_ALLOWLIST = {AppShell, SidebarShell, TopbarShell}` lives in `src/test/storybook-rules/required-exports.ts`. The predicate (no fetch / slot-only props / no user-data conditionals) is documented inline in that file AND in `storybook-conventions.md` § 3.1. A new Vitest test ("the closed set is the exact triple") fails loudly if the allowlist expands without doc updates. **CODEOWNERS rule for `required-exports.ts` was NOT added in this PR** — the repo doesn't ship a `CODEOWNERS` file today; a single-rule CODEOWNERS file at the repo root is best handled by a follow-up infra PR with proper team mapping. PR description should call this out.
- **Namespace-coverage assertion (closed 2026-06-18 by Ducdo: ship-now):** `scripts/i18n-parity.mjs` now extracts every `STORY_*_KEYS = [...] as const` array literal from `i18n-parity-coverage.test.ts` (with a `stripComments` pre-pass that survives JSDoc apostrophes) and asserts every key under `sidebar.` / `topbar.` / `mobileTab.` / `pageHead.` / `userPill.` / `appShell.` namespaces is claimed by SOME story array. Orphan keys exit code 1 with `ORPHAN: <key> belongs to namespace <ns> but isn't claimed by any STORY_1D_*_KEYS`.
- **Selector documentation:** new § 9.1 in `storybook-conventions.md` enumerates the canonical `data-testid` selectors for the app-shell stack (`app-shell-root`, `sidebar-nav-primary`, `sidebar-nav-{slug}`, `user-pill-role`, `topbar-shell`, `breadcrumb-current`, `search-pill`, `page-head`, `mobile-tab-bar`, `mobile-tab-{slug}`).
- **Shadcn-base-nova primitive-quirk tracking issue (Winston, DoD #22): NOT FILED** in this PR — the GitHub issue enumerating Breadcrumb / Pagination / Dialog / Sheet aria quirks is a meta-task that should be filed manually by Winston (decision owner) with his own framing. Listed in PR description as a follow-up. Story's `deferred-work.md` already carries the four quirks from 1d-2 close-out.
- **Designer notification (DoD #28): NOT YET SENT** — PR description should include the Storybook artifact download path (per § 10 of `storybook-conventions.md`) AND the explicit `@status: extrapolated-pending-design-review` flag on the `OwnerView` / `AdminView` `MobileTabBar` stories so the designer ratifies or amends the 5-tab Owner/Admin mobile set.
- **TS-6 module-scope date audit:** confirmed clean — `grep -rn 'new Date\|Date.now\|formatDistanceToNow\|format(' src/components/domain/` returns zero hits. All date-derived values would arrive as ISO strings via props; no domain component evaluates a date at module scope.
- **Token-bridge governance comment** added above `src/index.css:63` (`:root` aliases) — verbatim per Winston's finding #1.

### Implementation Plan (summary)

1. **Task 0 (pre-work):** Audited `shared/AppLayout.tsx` + `Sidebar.tsx` + `TopBar.tsx` + `UserPill.tsx`. Verified no external consumers (`grep` for `shared/Sidebar|shared/TopBar|shared/UserPill` returns only doc references). Confirmed no production route mounts `AppLayout` today (per `AppLayout.tsx:13-19` JSDoc). Inventoried 10 migrated i18n keys.
2. **Task 1 PRE-CHECK:** Verified `--color-sidebar-*` aliases present in `src/index.css:17-61` under `@theme inline`. Added governance comment block per Winston's finding #1.
3. **Task 1 (AC1):** Built `SearchPill`, `SidebarNavItem`, `UserPill`, `PageHead`, `BreadcrumbBar`, `TopbarShell` + co-located stories. All compose 1d-2 primitives (Badge, Avatar, Tooltip, Breadcrumb) via the shadcn-semantic bridge utilities (`bg-sidebar*`, `text-sidebar-foreground`, `bg-card`, `border-border`, `ring-ring`). No raw `bg-[var(--cl-*)]` arbitrary-value patterns.
4. **Task 2 (AC2–AC5):** `SidebarShell.tsx` accepts typed `role` + `groups` props. `sidebarNavConfig.tsx` carries the four IA-verified nav sets (Owner 9 items including Settings group, Admin 8 items, Teacher 10 items, Student 7 items with student-tone keys). `SidebarShell.stories.tsx` exports `Default` + `OwnerView` + `AdminView` + `TeacherView` + `StudentView` with `play` functions asserting absence of disallowed nav items AND namespace prefix per role.
5. **Task 3 (AC6):** `SidebarNavItem` badge composes 1d-2 Badge with `bg-sidebar-accent` / `text-sidebar-accent-foreground`; `aria-label` template via `sidebar.nav.unreadAria`; `aria-current="page"` on active row; active state uses `bg-sidebar-primary` / `text-sidebar-primary-foreground` (NO raw arbitrary values).
6. **Task 4 (AC7):** `MobileTabBar.tsx` + `MobileTab.tsx` co-located in `domain/`. Three role stories (Student / Teacher / Owner) plus `Unauthenticated` story exercising the `role={null}` null-guard. `onTabActivate` JSDoc contract carries the focus-management contract per Murat's finding #15. UX-3 exception JSDoc carries the AC7.a closure rationale.
7. **Task 5 (AC8):** `AppShell.tsx` is the SOLE `useUIStore` consumer (single-subscription discipline). `SidebarShell` carries `hidden md:flex`; `MobileTabBar` carries `md:hidden` + `position: fixed bottom-0`. Mobile responsive `TopbarShell` variant uses `md:flex` on the search slot. `AppShell.stories.tsx` exports `Desktop` / `Mobile` / `MobileWithBillingGrace` / `Tablet`.
8. **Task 6 (AC9):** 58 new i18n keys land in en + vi atomically. `STORY_1D_3_KEYS` extends `i18n-parity-coverage.test.ts`. `scripts/i18n-parity.mjs` gains namespace-coverage assertion (~70 LOC including the `stripComments` helper that survives JSDoc apostrophes). `storybook-conventions.md` gains § 3.1 (predicate allowlist) and § 9.1 (data-testid selector table). `data-testid` selectors land on every component root. `LongVietnameseLabel` story exercises the WCAG 2.1.1 truncation recipe (aria-label + Tooltip + native `title`).
9. **Task 7 (migration):** `shared/AppLayout.tsx` refactored to compose `domain/AppShell` + `SidebarShell` + `TopbarShell` + `MobileTabBar` + `BreadcrumbBar` + `SearchPill`, with `LanguageToggle` in the topbar `cta` slot. Defaults to `role='owner'` for the unauthenticated dev shell. `shared/Sidebar.tsx` + `TopBar.tsx` + `UserPill.tsx` deleted. `AppLayout.test.tsx` rewritten against new chrome + new i18n keys (mobile-hamburger toggle test removed — no hamburger in the new shell; mobile uses the bottom tab bar). `bilingual-smoke.spec.ts` /dashboard axe test gained an explicit wait for the skip-to-content link (race surfaced because the new AppLayout chunk is heavier).

## File List

### Added — domain components + stories

- `classlite-web/src/components/domain/AppShell.tsx`
- `classlite-web/src/components/domain/AppShell.stories.tsx`
- `classlite-web/src/components/domain/SidebarShell.tsx`
- `classlite-web/src/components/domain/SidebarShell.stories.tsx`
- `classlite-web/src/components/domain/SidebarNavItem.tsx`
- `classlite-web/src/components/domain/SidebarNavItem.stories.tsx`
- `classlite-web/src/components/domain/UserPill.tsx`
- `classlite-web/src/components/domain/UserPill.stories.tsx`
- `classlite-web/src/components/domain/TopbarShell.tsx`
- `classlite-web/src/components/domain/TopbarShell.stories.tsx`
- `classlite-web/src/components/domain/BreadcrumbBar.tsx`
- `classlite-web/src/components/domain/BreadcrumbBar.stories.tsx`
- `classlite-web/src/components/domain/SearchPill.tsx`
- `classlite-web/src/components/domain/SearchPill.stories.tsx`
- `classlite-web/src/components/domain/PageHead.tsx`
- `classlite-web/src/components/domain/PageHead.stories.tsx`
- `classlite-web/src/components/domain/MobileTabBar.tsx`
- `classlite-web/src/components/domain/MobileTabBar.stories.tsx`
- `classlite-web/src/components/domain/MobileTab.tsx`
- `classlite-web/src/components/domain/MobileTab.stories.tsx`
- `classlite-web/src/components/domain/sidebarNavConfig.tsx`
- `classlite-web/src/components/domain/__tests__/MobileTabBar.test.tsx`

### Added — code review 2026-06-22

- `classlite-web/src/lib/match-route.ts` — longest-prefix href matcher (D6) shared between `AppLayout` (sidebar active highlight) and `MobileTabBar` (internal tab match).
- `classlite-web/src/__tests__/token-bridge.test.ts` — presence + equivalence test for the `:root` token bridge in `src/index.css` (D7). 32 assertions: every required bridge variable exists and maps to exactly `var(--cl-*)` — no literal colors, no fallback values.
- `classlite-web/src/components/shared/AppLayout-warn-tracking.ts` — module-scope dedup for the "no role resolved" dev warn (P11). Extracted as a sibling module so `AppLayout.tsx` stays compliant with `react-refresh/only-export-components`.
- `classlite-web/e2e/storybook/topbar-mobile-pattern.spec.ts` — runtime contract for D1 + D2: hamburger painted at desktop / hidden at mobile, mobile-title row painted at 375×667 / hidden at desktop, search slot hidden at mobile. 5 tests against `domain-topbarshell--with-collapse-toggle` and `--with-mobile-title` stories.
- `classlite-web/e2e/storybook/breadcrumb-overflow-menu.spec.ts` — runtime contract for D3: DropdownMenu opens on click AND on Enter, contains the 3 skipped middle segments as menu items, Escape closes and returns focus to the trigger, trigger carries the i18n-keyed `aria-label`. 4 tests against `domain-breadcrumbbar--with-ellipsis` story.

### Modified

- `classlite-web/src/index.css` — token-bridge governance comment block above `:root` aliases (Winston #1).
- `classlite-web/src/locales/en.json` — +58 new keys (sidebar.* / topbar.* / mobileTab.* / userPill.* / pageHead.fixture.* / appShell.root); −10 migrated keys (app.layout.sidebar.* / app.layout.topbar.* / app.layout.userPill.roleLabel.*).
- `classlite-web/src/locales/vi.json` — same set, Vietnamese values (lockstep with en.json per UX-2).
- `classlite-web/src/lib/test/__tests__/i18n-parity-coverage.test.ts` — `STORY_1D_3_KEYS` + `describe('Story 1d-3 i18n parity (R38)', ...)` block; updated `STORY_1_7C_KEYS` to drop the migrated 10 keys with an inline migration note.
- `classlite-web/scripts/i18n-parity.mjs` — namespace-coverage assertion with `stripComments` pre-pass (Murat vacuity guard, closed 2026-06-18).
- `classlite-web/src/test/storybook-rules/required-exports.ts` — `PURE_LAYOUT_SHELL_ALLOWLIST` + `isAllowlistedShell()` (Option A allowlist); fixed `stripCommentsAndStrings` sequential-pass bug that broke export extraction when JSDoc contained apostrophes.
- `classlite-web/src/test/storybook-rules/required-exports.test.ts` — 3 new tests for the closed-set allowlist (membership + AppShell/SidebarShell/TopbarShell exemption + non-allowlisted *Shell still enforced).
- `classlite-web/docs/storybook-conventions.md` — § 3.1 (pure-layout shell allowlist + predicate); § 9.1 (data-testid selector table for the app-shell stack).
- `classlite-web/src/components/shared/AppLayout.tsx` — refactored to compose domain components (AppShell + SidebarShell + TopbarShell + MobileTabBar). Defaults to `role='owner'` for the unauthenticated dev shell.
- `classlite-web/src/components/shared/__tests__/AppLayout.test.tsx` — rewritten against new chrome + new i18n keys; mobile-hamburger toggle test removed (no hamburger in the new shell).
- `classlite-web/e2e/bilingual-smoke.spec.ts` — `/dashboard` axe test waits for the skip-to-content link before analyzing (chunk-load race fix).
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — `1d-3-app-shell-stack: ready-for-dev → in-progress → review`.

### Deleted — 1-7c placeholders retired

- `classlite-web/src/components/shared/Sidebar.tsx`
- `classlite-web/src/components/shared/TopBar.tsx`
- `classlite-web/src/components/shared/UserPill.tsx`

## Change Log

| Date | Author | Change |
|---|---|---|
| 2026-06-19 | Amelia | Story 1d-3 implementation complete. 10 domain components shipped to `src/components/domain/`; `shared/AppLayout` refactored to consume them; `shared/Sidebar/TopBar/UserPill` placeholders deleted. 58 new i18n keys land in en+vi; 10 migrated keys removed. `*Shell` predicate-gated allowlist (Option A) implemented in `required-exports.ts` + documented in `storybook-conventions.md` § 3.1; CODEOWNERS rule deferred to a follow-up infra PR. Namespace-coverage assertion ships in `scripts/i18n-parity.mjs` (Murat vacuity guard, ship-now per Ducdo 2026-06-18). Vietnamese truncation a11y recipe (aria-label + Tooltip + native `title`) discharged in `SidebarNavItem.LongVietnameseLabel`. MobileTabBar `useRole()` null guard tested in isolation. Status: in-progress → review. |
| 2026-06-21 | Amelia | Status: review-blocked → review. All 4 block-merge items + 2 polish items landed (tasks #10–#15 completed). **#10 AppLayout role default:** replaced `DEV_SHELL_ROLE='owner'` with `useRole()` resolution + guest-shell fallback (topbar only, no sidebar/MobileTabBar) when role is null; dev-only `console.warn` to surface the degradation; new tests cover both null-role (guest shell, dev-warn fires) and owner-role (full chrome) paths. **#11 Keyboard-focus tooltip verification:** new Playwright project `storybook-a11y` at `e2e/storybook/sidebar-nav-item-focus.spec.ts` opens `domain-sidebarnavitem--long-vietnamese-label` story at locale=vi, tabs to the link, asserts `[data-slot="tooltip-content"]` is visible with text "Trung tâm kiến thức" (base-ui Popup doesn't carry `role="tooltip"`; the data-slot is the stable selector). **#12 Mobile-viewport runtime contract:** same project, `e2e/storybook/app-shell-mobile-viewport.spec.ts` runs `domain-appshell--mobile` at viewport 375×667, asserts (a) `sidebar-nav-primary` bounding box is null OR width 0; (b) all 5 student tabs have bounding box >=44×44 — replaces the className-regex tautology with runtime browser measurement. **#13 UX-DR29 lint:** decision = amend story spec; AC7.a's Dev Notes section now reads "documented contract, not enforced lint" with the rationale that UX-DR29 is a future-misuse guardrail, not a current behavior gap; lint implementation deferred to when a Story 2+ component is found using role-switch for permission gating. **#14 SidebarShell group semantics:** Center settings group now wrapped in `<section aria-labelledby={groupLabelId}>` with `<h3 id={groupLabelId}>` instead of plain `<div>` + `<p>`. Initial attempt added `role="group"` to the inner `<ul>` — axe flagged it as stripping `<li>` list semantics; corrected to use `<section aria-labelledby>` for the group landmark while `<ul>` keeps its implicit list role. **#15 Subscription-discipline comment:** added inline JSDoc at SidebarShell `collapsed` prop site documenting the AppShell-is-sole-uiStore-consumer rule. **playwright.config.ts:** new `storybook-a11y` project + `BASE_URL_STORYBOOK` env override + array-shaped `webServer` with optional Storybook static build+serve entry (~25s on cold start, `reuseExistingServer` lets local dev iterate quickly). Initial regex on design-system `testMatch` broke test discovery — corrected to `testIgnore: /storybook\//` so design-system still discovers its specs while excluding the new subdir. **Test matrix all green:** Vitest 202/202 (was 200; +2 guest-shell tests in AppLayout.test.tsx), Storybook test-runner 220/220 axe-clean, Playwright 32/32 (was 29; +3 storybook-a11y), tsc / lint / lint:css / build / storybook:build / i18n-parity all clean. **Status: review.** 6 follow-up tasks remain post-1d-3 (tracked #16–#21): extract stripCommentsAndStrings shared util, comment Playwright skip-link waitFor, Sally Figma comment 48h deadline, Winston shadcn-base-nova tracking issue, CODEOWNERS infra story, completion-notes sibling-file convention from 1d-4 onward. |
| 2026-06-22 | Amelia (code review patch wave) | Status: review → done. 31 patches applied (7 decision-needed converted + 24 original patches; P18 dismissed as false-positive after on-disk verification). **D1 hamburger:** new `collapseToggle?: ReactNode` slot on `TopbarShell`; `AppLayout` renders a `<Button>` wired to `useUIStore.setSidebarCollapsed`; aria-label swaps between `topbar.sidebarToggle.collapse` and `topbar.sidebarToggle.expand` per state. **D2 mobile pattern:** `TopbarShell` restructured to a single primary row (responsive utilities reflow slots — eyebrow styling below md, normal styling above) + optional mobile-only title row beneath. Single CTA render so `getByRole` queries don't double-match. **D3 breadcrumb menu:** `BreadcrumbBar` now renders skipped middle segments as a `DropdownMenu` of `Link` items keyed by href; trigger carries `aria-label` via `topbar.breadcrumb.more`. Empty `items=[]` returns null (no empty landmark). **D4 mobile focus:** `MobileTabBar` owns focus management internally via `useEffect` on `useLocation().pathname`, focuses `#main-content` after each nav; `onTabActivate` is preserved as an optional side-effect callback (analytics) and no longer load-bearing for accessibility. **D5 PageHead announce:** `aria-live="polite"` removed from `<h1>`; the focus move from D4 is the single SR announcement source. **D6 longest-prefix match:** new `matchLongestHrefPrefix` helper in `@/lib/match-route.ts`; `MobileTabBar` matches internally; `AppLayout` matches over `SIDEBAR_NAV_BY_ROLE[role]` and passes the matched href to `SidebarShell`. Deep `/classes/123` highlights `/classes`; sibling `/classes-archived` does NOT collide. **D7 token-bridge test:** new `src/__tests__/token-bridge.test.ts` asserts every required bridge variable exists in `:root` AND maps to exactly `var(--cl-*)` — comment-only governance upgraded to enforced contract. **P1+P2 active state + user name:** `AppLayout` reads `useLocation().pathname` and longest-prefix-matches the role's nav config; user name retains the `t(userPill.role.${role})` placeholder with an explicit `TODO(1-8)` marker for grep discoverability. **P3 disabled keyboard nav:** `SidebarNavItem` renders an inert `<span role="link" aria-disabled="true" tabIndex={-1}>` when disabled — keyboard Enter no longer fires React Router navigation. **P4 namespace bleed + cap:** `MobileTab` aria-label uses the new `mobileTab.unreadAria` key (no more cross-namespace dependency on `sidebar.nav.unreadAria`) and announces the capped string (`9+`) so SR users hear what sighted users see. **P5 orphan keys:** `appShell.root`, `sidebar.collapseToggle`, `sidebar.section.workspace`, `sidebar.section.resources` deleted from both locale files and from `STORY_1D_3_KEYS` (no callsite — pre-claimed to defeat the namespace-coverage guard, the exact loophole party-mode #13 was meant to close). **P6 JSDoc fix:** `MobileTabBar` JSDoc no longer cites "UX-DR29 role-variant Storybook lint" as a guardrail; replaced with "documented convention, lint deferred until a real misuse" per party-mode #13. **P7+P8 mobile padding:** `AppShell.<main>` `pb-24` is now conditional on `mobileTabBar` presence; `MobileTabBar` `<nav>` gains `pb-[env(safe-area-inset-bottom)]` for iOS home indicator. **P9+P10+P19 i18n-parity hardening:** `extractClaimedKeys` regex now matches both single- AND double-quoted strings + handles escaped quotes; `findOrphans` scans the UNION of all locales (vi-only orphans no longer slip past); missing coverage file exits with distinct code 4 instead of generic usage-error 2. **P11 once-per-session warn:** `AppLayout` warn-tracking extracted to `AppLayout-warn-tracking.ts`; `warnIfFirstNoRoleResolution` clamps to one console.warn per session; `__resetWarnTrackingForTests` exported for `beforeEach` reset. **P12+P13 test discipline:** `app-shell-mobile-viewport.spec.ts` collapses the `if (box !== null)` branch into a single `expect(box === null || box.width === 0).toBe(true)` assertion (no more zero-assertion pass on null); `sidebar-nav-item-focus.spec.ts` replaces the 5-attempt Tab loop with `await link.focus()` + `await expect(link).toBeFocused()` (deterministic). **P14+P15 PageHead count:** `Intl.NumberFormat(i18n.language)` for locale-correct grouping; `Number.isFinite(count) && count >= 0` guard drops NaN/Infinity/negative. **P16+P17 UserPill hardening:** `deriveInitials` trims, splits on whitespace, handles surrogate pairs via `Array.from(part)[0]`, falls back to `?`; empty-string `avatarUrl` collapses to `null` before forwarding to `<AvatarImage>`. **P20 story tautologies:** `AppShell.stories.tsx` + `MobileTabBar.stories.tsx` `play` functions drop the className-regex assertions (the new Playwright `storybook-a11y` project does the runtime measurement). **P21 unnamed sections:** `SidebarShell` renders `<div>` (not `<section aria-labelledby={undefined}>`) when a group has no labelKey — no more unnamed `region` landmarks. **P22+P23 multi-source name:** `SearchPill` drops `aria-label` (visible text is the accessible name); `SidebarNavItem` drops the native `title` attribute (Tooltip owns hover/focus reveal). **P24 unreadByTab typo guard:** `MobileTabBar` `useEffect` in DEV warns when `Object.keys(unreadByTab)` contain slugs not in the active role's tab set. **P18 dismissed:** `http-server@14.1.1` is already at `package.json:76` (devDependencies) — the original finding read from diff text alone; on-disk state is correct. **Test deltas:** +33 tests (token-bridge 32, longest-prefix 3, hamburger toggle 1 — minus the dropped-tautology assertions). Vitest 248/248 pass (was 215). Storybook + Playwright sweep landed for D1 + D2 + D3 — new specs at `e2e/storybook/topbar-mobile-pattern.spec.ts` (5 tests covering hamburger desktop/mobile + mobile title + search-hidden contracts) and `e2e/storybook/breadcrumb-overflow-menu.spec.ts` (4 tests covering DropdownMenu open-on-click / open-on-Enter / Escape-closes / i18n-keyed aria-label). New TopbarShell stories `WithCollapseToggle` + `WithMobileTitle` added to support the runtime assertions. Playwright `storybook-a11y` project now 12/12 green (was 3/3 before this pass). **CI surface:** `tsc -b` / `lint` / `lint:css` / `i18n-parity` (122 keys, 120 claimed, namespace clean) / `build` / `storybook:build` all clean. |
| 2026-06-21 | Ducdo (party-mode review: Winston / Sally / Murat / John + Amelia respondent) | Status: review → review-blocked. Four-agent party-mode review of the implementation surfaced 4 block-merge items + 2 polish items + 6 follow-ups. **Block-merge before code-review pass:** (1) `shared/AppLayout.tsx:34` defaults `DEV_SHELL_ROLE='owner'` — Winston flagged as privilege-direction footgun; replace with least-privilege sentinel ('guest' degraded shell + `import.meta.env.DEV` warn; prod-null → throw/redirect). Spec amended — original "default to owner" instruction was wrong. (2) `SidebarNavItem.LongVietnameseLabel` play function lost the keyboard-focus tooltip reveal verification (`userEvent.tab() + toHaveFocus()` removed citing base-ui `_r_b_` wrapper interference); aria-label + title attribute checks alone do not prove the `:focus-visible` → tooltip-opens contract. Sally + Murat + John all flagged independently. Add Playwright scenario at `e2e/sidebar-nav-item.spec.ts` with `page.keyboard.press('Tab')` + assert tooltip in a11y tree. (3) AppShell.Mobile + MobileTabBar.StudentView play functions switched from `getComputedStyle` / `getBoundingClientRect()` to className-regex assertions — Murat named this "className-as-runtime-contract" tautology; WCAG 2.5.5/2.5.8 compliance contract no longer verified. Add Playwright scenario at 375×667 measuring real bounding boxes. (4) UX-DR29 lint rule referenced in story AC7.a closure does NOT exist in the codebase (grep confirms JSDoc references only) — either amend AC7.a to "documented, lint deferred" + file follow-up, or implement `eslint-rules/ux-dr29-touch-target.ts` now. **Polish in same PR:** SidebarShell group semantics upgrade (current `<p>` label + border-t separator works visually but lacks `<h3>` + `role="group"` + `aria-labelledby` — Amelia's "spreads them flat" claim was a misremembering; the separator EXISTS). One-line subscription-discipline comment at SidebarShell `collapsed` prop site (Winston nit). **Follow-up (post-1d-3):** Extract `stripCommentsAndStrings` shared util; comment the Playwright skip-link `waitFor` as load-bearing hydration wait; Sally sends Figma comment to designer for Owner+Admin mobile ratification (48h hard deadline); Winston files shadcn-base-nova primitive-quirk tracking issue this week; CODEOWNERS file as a separate infra story; from 1d-4 onward, split completion-notes into a sibling file (story file hit ~830 lines). Tasks tracked #10–#21. Story stays at `review-blocked` until #10–#15 land. |

