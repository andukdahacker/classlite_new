---
baseline_commit: a90010732057148b3c4e930c7c7b234aa4686378
---

# Story 1d-3: App-Shell Stack — Sidebar, Topbar, Navigation, Mobile Tab Bar

Status: backlog

<!-- Validation is optional. Run `validate-create-story` for a quality second pass before `dev-story`. -->

## Story

As a frontend developer,
I want the persistent app-shell stack (`AppShell`, `SidebarShell` with Owner/Admin/Teacher/Student role variants, `SidebarNavItem`, `UserPill`, `TopbarShell`, `BreadcrumbBar`, `SearchPill`, `PageHead`, plus a purpose-designed `MobileTabBar` for `s74–s86`) built once with full role-variant coverage and Storybook stories,
so that every Epic 2–10 frontend story renders inside a finished, role-correct shell — owner/admin/teacher/student each get their canonical nav set out of the box, mobile gets the bottom tab bar from `s74` rather than a responsive squish of the desktop sidebar, and no feature story re-implements layout chrome.

## Acceptance Criteria (BDD)

> **No risk-score ≥6 ACs in this story.** App-shell components are pure layout — no data fetching, no tenant isolation, no auth/role validation logic (consumers pass role as prop; the route layer owns gating per UX-3). WF-8 ATDD red-tests are NOT mandatory. The high-fidelity ACs are the four role variants of `SidebarShell` (AC2–AC5) where mistaking the per-role nav set is the most likely failure mode — those ACs cite the exact nav list verbatim from `classlite-ia.md`. Stories 1d-1 (Storybook foundation) and 1d-2 (shadcn primitives) are hard dependencies.

### AC1: Shell skeleton — `AppShell`, `TopbarShell`, `BreadcrumbBar`, `SearchPill`, `UserPill`, `PageHead`, `SidebarNavItem`

**Given** the inventory's app-shell components,
**When** inspecting `src/components/domain/`,
**Then** each of the following exists as a typed React component with explicit props, sibling-import stories, and stable test selectors:
- `AppShell` (`s06`, every desktop screen) — top-level layout: `<aside>` slot (220px sidebar) + `<header>` slot (topbar) + `<main>` slot (page content). Owns no data; accepts `sidebar`, `topbar`, `children` slots.
- `TopbarShell` (`s06`, every desktop screen) — crumbs (left) + actions (right: search pill + section CTA slot). Accepts `breadcrumb`, `search`, `cta` slots; CTA slot accepts arbitrary actions (`+ New class`, `Invite staff`, `+ New assignment`).
- `BreadcrumbBar` (`s06`, every screen) — wraps shadcn `Breadcrumb` from 1d-2. Current item is non-clickable; separator is the canonical token `/`; overflow truncates middle segments with an ellipsis-menu pattern (`Workspace / … / Current`) using `Breadcrumb`'s `WithEllipsis` variant from 1d-2.
- `SearchPill` (`s06`, every desktop screen) — "Search" placeholder + `⌘K` keyboard-hint chip on the right. Renders the visual affordance only; the actual `⌘K` palette wiring is deferred (uses 1d-2's `Command` primitive when a future story wires it).
- `UserPill` (`s06`, every desktop screen) — avatar + name + role label, rendered at the sidebar foot. Role label is data-driven from the `role` prop (`Owner`, `Admin`, `Teacher`, `Student`) — not branched in component code.
- `PageHead` (`s06`, every screen) — H1 + count + sub-line layout. Display headlines use Fraunces (not consumed by primitives — first appearance is here).
- `SidebarNavItem` (`s06`, every screen) — icon + label + optional unread/count badge. The badge variant uses 1d-2's `Badge` primitive with the design-token amber accent.

**And** each component is pure layout — no data fetching, no Zustand reads beyond sidebar-collapsed UI state (allowed per FW-5 — UI-only), no role-resolution logic (consumers pass role as prop per UX-3 — the route layer owns gating).

**And** every component ships a co-located `<Component>.stories.tsx` with `Default` plus the three-state coverage where applicable (`PageHead` is data-rendering — exports `Default`, `Loading`, `Empty`, `Error` using the `EmptyStatePlaceholder` / `ErrorStatePlaceholder` from 1d-1 until Epic 10 ships the real `EmptyState` / `ErrorState`; the others are pure layout and ship `Default` only).

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
9. **Settings** (`/settings` → `s49`, Owner-only — sits under a "Center settings" group separator per inventory `OwnerSidebarShell` note)

**And** the `UserPill` at the sidebar foot renders the role label as "Owner" per the IA bottom-pill convention.

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
  /** Collapsed UI state — owned by the consuming Zustand `uiStore` (FW-5). */
  collapsed?: boolean
  onCollapseToggle?: () => void
}
```

The role variants in AC2–AC5 specify the **content** of the `groups` array per role; the **type** is shared.

### AC3: `SidebarShell` — Admin role variant matches `classlite-ia.md`

**Given** the `SidebarShell` component rendered with `role="admin"`,
**When** the Storybook `AdminView` story renders,
**Then** the nav set matches the IA convention at `classlite-ia.md` line 17 — Admin sees the same sidebar as Owner per mockup convention, **MINUS** the `Settings` item (Settings is Owner-only per the IA permission matrix at `classlite-ia.md` line 159):
1. **Dashboard** (`/dashboard` → `s48`)
2. **People** (`/people/staff` → `s39`)
3. **Classes** (`/classes` → `s07`)
4. **Schedule** (`/schedule` → `s13`)
5. **Analytics** (`/analytics` → `s45`)
6. **Inbox** (`/inbox` → `s52`)
7. **Knowledge hub** (`/knowledge-hub` → `s26`)
8. **Archive** (`/archive` → `s28`)

**And** the `UserPill` role label renders as "Admin" — note this is the only place the Admin role chip is visible per IA (also called out on `s41` Invite staff modal).

**And** the `s41` Invite-staff visibility difference (Admin doesn't see the "Owner" chip — only Owner does) is OUT OF SCOPE for `SidebarShell` — it surfaces in 1d-7's `InviteStaffModal`. The story comment documents this so an Admin/Owner sidebar reviewer doesn't confuse the two.

### AC4: `SidebarShell` — Teacher role variant matches `classlite-ia.md`

**Given** the `SidebarShell` component rendered with `role="teacher"`,
**When** the Storybook `TeacherView` story renders,
**Then** the nav set matches the IA table at `classlite-ia.md` line 18 EXACTLY, in this order:
1. **Dashboard** (`/dashboard` → `s06`)
2. **Classes** (`/classes` → `s07`)
3. **Schedule** (`/schedule` → `s13`)
4. **Exercises** (`/exercises` → `s15`)
5. **Questions** (`/exercises/{id}?questions=open` → `s18`)
6. **Students** (`/students` → `s10a`, the teacher's own-roster top-level per the IA `s10a` definition — distinct from Admin/Owner's `s42` center-wide students)
7. **Analytics** (`/analytics` → `s45`)
8. **Inbox** (`/inbox` → `s50`, with unread-count badge)
9. **Knowledge hub** (`/knowledge-hub` → `s26`)
10. **Archive** (`/archive` → `s28`)

**And** the `UserPill` role label renders as "Teacher".

**And** there is NO `Settings` item (Owner-only per AC2) and NO `People` item (Admin/Owner only per AC2/AC3) — the story explicitly asserts absence of those nav labels in its `play` function (per TEST-FE-6 — test what's absent, not just present).

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

**And** the Student sidebar drops the "Resources" group (Knowledge hub, Archive — both are owner/teacher-only per the IA permission matrix), and drops the "Workspace" → "People/Analytics" entries entirely. The story `play` function asserts absence of `Settings`, `People`, `Knowledge hub`, `Archive`, `Analytics` nav labels (per TEST-FE-6).

**And** the nav copy uses the student-tone labels per the IA convention — "My classes" (not "Classes"), "My schedule" (not "Schedule"), "My performance" (not "Analytics"). All labels resolve via i18n keys (`sidebar.student.myClasses`, etc., per UX-2).

### AC6: `SidebarNavItem` badge contract and active-state behavior

**Given** the `SidebarNavItem` component with a populated `badge` prop,
**When** rendered,
**Then** the unread badge renders with the design-token amber accent (composing 1d-2's `Badge` primitive in the `Default` variant with `tone="warning"` semantics) and is announced to screen readers via `aria-label` including the count and item name — e.g., `aria-label="Inbox, 3 unread"`.

**And** when the `active` prop is true, the row renders with the design-token accent left-border + active background; the `aria-current="page"` attribute is set so screen readers announce the current section.

**And** the component honors the project's role-rendering rule (UX-3) — `SidebarNavItem` itself contains no role-conditional code; role-specific nav sets are constructed by the parent `SidebarShell` and passed as a typed `items` array.

**And** the Storybook stories for `SidebarNavItem` export `Default`, `Active`, `WithBadge`, `WithBadgeAndActive`, `Disabled`.

### AC7: `MobileTabBar` — purpose-designed bottom tab bar per `s74–s86` with three role variants

**Given** the `MobileTabBar` component (`s74–s86`),
**When** rendered,
**Then** it is a separate, purpose-designed mobile bottom tab bar — NOT a responsive squish of `SidebarShell` (per UX-4 + UX-DR32). It renders 5 tabs (the inventory's `s74` 5-tab spec) at the bottom of the mobile viewport, each composed from the `MobileTab` sub-component (icon + label + optional red-dot badge).

**And** three role-specific stories exist matching the IA mobile sections at `classlite-ia.md` Chapter 8:

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

3. `OwnerView` (per `s86`) — 5 tabs:
   - **Home** (`/dashboard` → `s48` mobile)
   - **People** (`/people/staff` → `s86` enrolment approve surface)
   - **Inbox** (`/inbox`, with red-dot badge)
   - **Analytics** (`/analytics`)
   - **Me** (`/profile`)

**And** the `MobileTabBar` is co-located with `AppShell` at `src/components/domain/MobileTabBar.tsx` per FW-7 — domain tier, not feature tier (it's reused across every mobile screen).

**And** each tab honors the touch-target minimum (44x44px per TEST-UX-4) and the active tab uses `aria-current="page"` for screen readers.

**And** the explicit `MobileTabBar` `Props` interface is:
```ts
export interface MobileTab {
  /** i18n key for the visible label. */
  labelKey: string
  icon: ReactNode
  href: string
  /** When true, renders the red-dot badge. The count itself is not shown on mobile (per IA — desktop sidebar shows count, mobile shows dot). */
  hasUnread?: boolean
}

export interface MobileTabBarProps {
  role: Role  // 'owner' | 'admin' | 'teacher' | 'student' — Admin reuses Owner tabs
  /** Active href derived by consumer from router match. */
  activeHref: string
  /** AC7 fixes the tab count at 5 per role per the IA mobile spec; the role determines the set. */
}
```

Note: the `tabs` array is NOT a prop — it's derived inside `MobileTabBar` from `role` per the AC7 fixed sets (Student/Teacher/Owner). This is the deliberate exception to "no role logic in components" (UX-3) — the mobile tab content per role is a *layout* decision matched to the IA mobile spec, not a *permission* decision. Documented in the component's JSDoc.

**And** the `AdminView` is NOT listed as a separate variant — the IA mobile chapter only covers Owner/Teacher/Student mobile (Chapter 8). Admin shares the Owner mobile shell per the desktop convention; the story comment documents this.

### AC8: Mobile breakpoint composition — `AppShell` swaps to `MobileTabBar` below desktop breakpoint

**Given** the `AppShell` component rendered below the desktop breakpoint (390px viewport, the `s74` mobile reference),
**When** inspecting the rendered DOM,
**Then**:
- The desktop `SidebarShell` is NOT in the DOM (not just visually hidden — per TEST-FE-6 — completely absent so screen readers don't announce empty nav).
- The `MobileTabBar` is rendered at the bottom of the viewport with `position: fixed`.
- The `TopbarShell` swaps to the mobile-topbar pattern (eyebrow + title + right-icon affordances per inventory `MobileTopbar` row at `s74`) — but `MobileTopbar` is itself a responsive variant of `TopbarShell` per the inventory's "purpose-designed vs responsive" guidance and ships as a `md:` breakpoint variant of `TopbarShell`, NOT a separate component (this story builds the responsive pattern, not a second component).

**And** the swap is driven by Tailwind responsive prefixes systematically (`md:hidden`, `md:flex`, `md:grid`) — no magic-pixel media queries, no JavaScript viewport listeners (per UX-4).

**And** the Storybook `AppShell.stories.tsx` exports `Desktop` (default at viewport `>= md`), `Mobile` (`parameters.viewport: { defaultViewport: 'iphone14' }`), `MobileWithBillingGrace` (mobile + the placeholder for 1d-4's `BillingGraceBanner` slot), and `Tablet` (sanity check at `md` breakpoint).

### AC9: i18n, axe-core, and stable test selectors

**Given** every component story in this stack,
**When** the Storybook toolbar switches locale between `en` and `vi`,
**Then** every nav label, role label, breadcrumb segment, search placeholder, and tab label renders correctly in both locales. All copy resolves via i18n keys (`sidebar.owner.dashboard`, `sidebar.teacher.students`, `sidebar.student.myPerformance`, `mobileTab.student.home`, etc., per UX-2 + TEST-FE-4) — zero hardcoded English strings anywhere in `src/components/domain/`.

**And** Vietnamese nav strings (typically ~1.5x English length) do not break the 220px sidebar layout — labels truncate with ellipsis where needed, and the truncated state is keyboard-focusable for full-text reveal via tooltip.

**Given** the `@storybook/addon-a11y` audit and the `vitest-axe` integration from 1d-1,
**When** every story in this stack runs via `npm run storybook:test` in CI,
**Then** zero `axe-core` violations. Tab order follows visual reading order (sidebar → topbar → main; or mobile: topbar → main → tab bar). The mobile `MobileTabBar` is keyboard-accessible (each tab focusable, `Enter` activates).

**And** every component exposes stable selectors for tests — `data-testid` on each `SidebarNavItem` (`sidebar-nav-{slug}`), each `MobileTab` (`mobile-tab-{slug}`), the `UserPill` role label (`user-pill-role`), and the `BreadcrumbBar` current item (`breadcrumb-current`). Selectors are documented in `classlite-web/docs/storybook-conventions.md` as the canonical pattern for downstream stories.

## Tasks / Subtasks

- [ ] **Task 1 (AC1):** Build the shell skeleton components in `src/components/domain/`.
  - [ ] `AppShell.tsx` + `AppShell.stories.tsx` — three-slot layout (sidebar, topbar, main).
  - [ ] `TopbarShell.tsx` + `TopbarShell.stories.tsx` — breadcrumb + search + CTA slots.
  - [ ] `BreadcrumbBar.tsx` + `BreadcrumbBar.stories.tsx` — wraps 1d-2's `Breadcrumb` primitive; middle-segment ellipsis truncation.
  - [ ] `SearchPill.tsx` + `SearchPill.stories.tsx` — placeholder + `⌘K` kbd hint chip (no palette wiring).
  - [ ] `UserPill.tsx` + `UserPill.stories.tsx` — avatar + name + data-driven role label.
  - [ ] `PageHead.tsx` + `PageHead.stories.tsx` — H1 + count + sub-line; three-state coverage (`Default`, `Loading`, `Empty`, `Error`).
  - [ ] `SidebarNavItem.tsx` + `SidebarNavItem.stories.tsx` — icon + label + optional badge; `Default`, `Active`, `WithBadge`, `WithBadgeAndActive`, `Disabled`.
- [ ] **Task 2 (AC2–AC5):** Build `SidebarShell` with four role variants.
  - [ ] `SidebarShell.tsx` accepts typed `role` prop (`'owner' | 'admin' | 'teacher' | 'student'`) and a derived typed `items` array — items are constructed by a per-role config map, not branched inline (per UX-3).
  - [ ] Encode the four role nav sets EXACTLY per `classlite-ia.md` lines 16–19 (verbatim — verify against IA before commit).
  - [ ] Story exports: `OwnerView`, `AdminView`, `TeacherView`, `StudentView` (per UX-DR29) — each set via the role toolbar from 1d-1's decorator.
  - [ ] `TeacherView` and `StudentView` stories include `play` functions asserting absence of disallowed nav items (per TEST-FE-6).
  - [ ] Document the IA citation in a header comment of `SidebarShell.tsx` so future agents updating nav must update the IA + this file atomically.
- [ ] **Task 3 (AC6):** Verify `SidebarNavItem` badge and active-state contracts.
  - [ ] Badge composes 1d-2's `Badge` primitive with amber accent + count.
  - [ ] `aria-label` includes count + item name (e.g., `"Inbox, 3 unread"`).
  - [ ] `aria-current="page"` on active row.
  - [ ] Stories cover `Default`, `Active`, `WithBadge`, `WithBadgeAndActive`, `Disabled`.
- [ ] **Task 4 (AC7):** Build `MobileTabBar` and `MobileTab` sub-component.
  - [ ] `MobileTabBar.tsx` + `MobileTabBar.stories.tsx` co-located in `src/components/domain/`.
  - [ ] Three role-specific stories: `StudentView`, `TeacherView`, `OwnerView` — each renders the 5-tab set from AC7 verbatim.
  - [ ] `MobileTab.tsx` sub-component — icon + label + red-dot badge slot; touch-target ≥44x44px (per TEST-UX-4).
  - [ ] Header comment documents that Admin mobile is NOT a separate variant (shares Owner mobile per IA Chapter 8 convention).
- [ ] **Task 5 (AC8):** Wire the responsive breakpoint composition in `AppShell`.
  - [ ] Below `md` breakpoint: `SidebarShell` is `hidden md:flex` (absent from DOM via conditional, not just CSS-hidden — verify with TEST-FE-6 in the story's `play` function).
  - [ ] Below `md` breakpoint: `MobileTabBar` renders `position: fixed bottom-0` via Tailwind utilities.
  - [ ] `TopbarShell` mobile pattern (eyebrow + title + right-icon) is a `md:` responsive variant of `TopbarShell` — not a separate `MobileTopbar` component.
  - [ ] `AppShell.stories.tsx` exports `Desktop`, `Mobile`, `MobileWithBillingGrace` (placeholder slot for 1d-4), `Tablet`.
- [ ] **Task 6 (AC9):** Verify i18n, axe, and selector contracts.
  - [ ] Grep `src/components/domain/` for hardcoded English — must be zero outside `t()` keys and dev-only debug comments.
  - [ ] Add Vietnamese fixtures to `vi.json` for every new key introduced (`sidebar.*`, `mobileTab.*`, `topbar.*`, etc.).
  - [ ] Verify Vietnamese rendering at 220px sidebar doesn't break layout — add `LongVietnameseLabel` story to `SidebarNavItem`.
  - [ ] Add `data-testid` selectors per AC9; update `storybook-conventions.md` with the canonical pattern.
  - [ ] Run `npm run storybook:test` locally — zero axe violations expected.

## Dev Notes

- **Stack reminders:**
  - React 19 — refs are plain props, no `forwardRef`. Use `use()` hook if a shell component needs synchronous context resolution. No `"use client"` directives.
  - Vite 8 (Rolldown) — already validated; nothing new here.
  - TypeScript strict — every component's `Props` interface is explicit; the `role` prop is a `'owner' | 'admin' | 'teacher' | 'student'` discriminated union, never `string`.
  - shadcn/ui — primitives consumed via sibling imports from 1d-2 (`Badge`, `Breadcrumb`, `Avatar`, etc.). Never reach into shadcn internals.
  - Tailwind utility classes only — responsive prefixes (`md:`, `lg:`) drive the mobile-vs-desktop swap (per UX-4); no inline `style={{}}`, no magic-pixel media queries.
  - React Router v7 — nav `to` props are string routes; this story does NOT wire the router itself (1d-1's Memory Router decorator handles story navigation). The route strings reference IA-canonical paths verbatim.

- **One mock seam per side (TEST-FE-1):** Shell components don't fetch data. The `Inbox` badge count is passed as a prop, not fetched here — Epic 2+ stories that own the inbox state machine pass the count down via the layout slot. No MSW handlers needed in this story.

- **i18n is co-primary (UX-2 + TEST-FE-4):** Every nav label, role label, breadcrumb segment, tooltip, and tab label resolves via i18n keys. Both `en.json` and `vi.json` are updated in the same PR. Vietnamese strings are ~1.5x English length — the 220px sidebar must handle "Knowledge hub" / "Trung tâm kiến thức" without breaking; truncation with focus-revealed tooltip is the documented fallback.

- **Role-based rendering uses separate variants, not conditional branches (UX-3, UX-DR29):** `SidebarShell` uses a single component with a typed `role` prop and a per-role config map. This is the canonical pattern downstream `DashboardHero` (1d-4) and `InboxListShell` (deferred) will reuse. The four `OwnerView`/`AdminView`/`TeacherView`/`StudentView` Storybook stories are switchable via the role toolbar from 1d-1's decorator. The role itself is NEVER inferred inside the component — consumers pass it in.

- **Mobile is purpose-designed, not responsive squish (UX-4, UX-DR32):** `MobileTabBar` ships as a dedicated component because the bottom-tab-bar topology fundamentally differs from the desktop sidebar. The `TopbarShell` mobile pattern, by contrast, is responsive (eyebrow + title + right-icon affordances reflow inside the existing component) because the topology is the same.

- **Mobile deferred-scope reminder:** Per the epic's "Out of Scope" table, `MobileWritingSurface` (`s78`), `MobileQAThread` (`s80`), `MobileSwipeRow` (`s75`), `MobileQuestionReplyComposer` (`s85`), and `MobilePushApproveCard` (`s86`) are deferred to feature epics 5/7/9/4 respectively — they do NOT ship here. `MobileTabBar` is in scope because it's pure layout chrome; the gestural and content-bearing mobile surfaces are feature-coupled.

- **FW-7 component placement:**
  - `src/components/domain/AppShell.tsx`
  - `src/components/domain/SidebarShell.tsx`
  - `src/components/domain/SidebarNavItem.tsx`
  - `src/components/domain/UserPill.tsx`
  - `src/components/domain/TopbarShell.tsx`
  - `src/components/domain/BreadcrumbBar.tsx`
  - `src/components/domain/SearchPill.tsx`
  - `src/components/domain/PageHead.tsx`
  - `src/components/domain/MobileTabBar.tsx`
  - `src/components/domain/MobileTab.tsx`

  All stories co-located. Never place these in `ui/` (would imply they're shadcn primitives — they're not).

- **WF-3 codegen note:** This story does not touch `api.yaml` or `.sql` files. `codegen.sh` does NOT need to run.

- **WF-7 service boundary:** All work stays within `classlite-web/`. The `role` prop type lives in `src/lib/auth/types.ts` (or wherever Story 1.7b puts it), NOT in `src/generated/` — role is an application-layer concern, not a wire-format type.

- **TS-3 (query key factories):** No queries in this story (shell is pre-state). When future feature stories fetch the unread `Inbox` count, the badge prop is populated from a TanStack Query elsewhere — the shell doesn't own that key.

- **TS-6 (no `new Date()` in render):** The `MobileTopbar` "Day eyebrow" text (per inventory `MobileTopbar` row — "Day eyebrow + title + right icons") is data-driven via prop, not computed in the component. Consumers pass an ISO date string; the i18n formatter resolves the day name.

- **Designer review touchpoint:** Once 1d-3 ships, the designer can iterate on shell spacing, sidebar group separation, mobile tab labels, and the breadcrumb truncation behavior — all via the Storybook toolbar's role + locale switching. Token tweaks land in Story 1.7a's token file, not per-component file edits.

## Definition of Done

- [ ] All 9 ACs discharged.
- [ ] All 10 component files exist at `src/components/domain/` with co-located stories.
- [ ] `SidebarShell` four role variants match `classlite-ia.md` lines 16–19 verbatim — confirmed by re-reading the IA before merge.
- [ ] `MobileTabBar` three role variants (Student/Teacher/Owner) match IA Chapter 8 mobile sections.
- [ ] Every nav label, role label, tab label resolves via i18n keys; `en.json` and `vi.json` both updated in the same PR.
- [ ] Vietnamese rendering at 220px sidebar verified — no layout breakage, truncation pattern documented.
- [ ] `play` functions in `TeacherView` and `StudentView` `SidebarShell` stories assert absence of disallowed nav items (per TEST-FE-6).
- [ ] Mobile `AppShell` story verifies `SidebarShell` is absent from DOM (not just visually hidden) at sub-`md` breakpoints.
- [ ] All stories pass `axe-core` audit (zero violations) via `npm run storybook:test`.
- [ ] Stable `data-testid` selectors documented in `storybook-conventions.md`.
- [ ] CI `storybook` job green on the PR (per 1d-1's AC5).
- [ ] Designer notified that the role-variant shell Storybook is ready for review.

## Out of Scope

- `DashboardHero` role variants — Story 1d-4 (visual/status domain components).
- `BillingGraceBanner` rendered inside `AppShell` — Story 1d-4 builds the banner; this story leaves the slot.
- `⌘K` command palette wiring — `SearchPill` renders the visual affordance only; the palette is a follow-up feature story consuming 1d-2's `Command` primitive.
- Inbox unread-count fetching — the badge prop is consumed; the query lives in Epic 2+ inbox stories.
- `OnboardingShell` — Story 1d-5 owns the onboarding shell (no sidebar; different topbar).
- Sidebar-collapsed UI state Zustand store — if needed, Story 1.7b's store catalog adds it; this story consumes the existing store reference only.
- `MobileWritingSurface` (`s78`), `MobileQAThread` (`s80`), `MobileSwipeRow` (`s75`), `MobileQuestionReplyComposer` (`s85`), `MobilePushApproveCard` (`s86`) — all deferred to feature epics per the epic's Out of Scope table.
- Visual regression testing (Chromatic, Percy) — not in MVP scope per 1d-1.
- Per-screen integration tests of every desktop screen consuming `AppShell` — those tests live in their consuming feature stories.
