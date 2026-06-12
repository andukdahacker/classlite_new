---
baseline_commit: 4703b10
---

# Story 1.7c: Shared Layout Components & i18n

Status: done

<!-- Validation is optional. Run `validate-create-story` for a second-pass quality check before `dev-story`. -->

> **Why this story matters.** Story 1-7a gave the dashboard its visual language; Story 1-7b gave it a runtime spine (router + 401 silent-refresh + state stores). **1-7c closes the Epic 1C foundation triple by giving the dashboard a *finished surface*** — every authenticated page now mounts inside an `AppLayout` with sidebar + topbar chrome, every render-time error surfaces a localized fallback with a Sentry event ID + retry CTA, every forbidden route is a *permission-denied orientation screen* (UX-DR16, `s67`) and not a bare 403, every unmatched URL is a localized `NotFound` (deferred catch-all from 1-7b W1), every user-facing string flows through `react-i18next` with both `en` and `vi` present and a `.classlite.app` language cookie keeping the choice continuous from the landing page through auth into the product (UX-DR17). Without 1-7c, every downstream story (1-8, 1-9a/b/c/d, the entire 2-10 Epic stack) ships into a half-built shell.
>
> **This story owns one risk score ≥6 — R38 (i18n parity, score 6) — and WF-8 makes the ATDD red-phase MANDATORY.** R38's failure mode is invisible to English-speaking devs: a missing key in `vi.json` renders to half the user base as a raw `auth.login.submit` token where a button label should be. The mitigation is layered: (a) the `assertI18nParity` helper (already shipped in 1-7b) used by EVERY component test that calls `t(...)`; (b) the `npm run i18n-parity` CI script that fails the build on key-set divergence between locales; (c) a bilingual Playwright smoke spec that walks `/login` in both locales and asserts no dotted-path keys appear in the DOM; (d) every component test in this story calls `assertI18nParity` on its used keys before any other assertion. Skipping any layer means a Vietnamese user can ship a regression we never see.

> **Scaffold reality check (READ FIRST).** 1-7a and 1-7b already wired the design system, the router, the Query client, the Zustand stores, and a *minimal* `RootErrorBoundary`. You are NOT starting from scratch — you are layering the polished surface ON TOP of that scaffolding. Specifically:
>
> - `classlite-web/src/components/shared/RootErrorBoundary.tsx` exists from 1-7b — class component, `componentDidCatch` reports to Sentry, simple `role="alert"` fallback with `t('app.errorFallback')`. **1-7c REPLACES this** with `ErrorBoundary.tsx` — same class-component shape, same `componentDidCatch` reporting, but now the fallback displays the Sentry event ID, copy that names "what went wrong" + "what happened" + "what to do" per UX-DR16, and a retry CTA that resets the boundary's state and re-renders children. The minimal `RootErrorBoundary` file is **deleted**; `App.tsx` swaps its wrapper to `ErrorBoundary`. The 1-7b smoke test (`RootErrorBoundary.test.tsx`) is **renamed → updated → extended** for the new contract.
> - `classlite-web/src/routes.tsx` from 1-7b has THREE base routes (`/` redirect, `/login` under AuthLayout, `/student`, `/dashboard`) plus two DEV-only routes. There is NO `path: '*'` catch-all NotFound. The 1-7b review explicitly deferred it ("W1 (LOW): NotFound / catch-all route missing"). **1-7c adds the catch-all** and wires a polished `NotFound.tsx` to it.
> - `classlite-web/src/stores/languageStore.ts` from 1-7b is a **pure state holder** — no side effects, no `i18n.changeLanguage` call, no cookie read/write. **1-7c adds the side-effect bridge** at `src/lib/language-cookie.ts` + a `useLanguageInit()` hook mounted ONCE in `App.tsx`. The store action stays pure (FW-6 — Zustand never imports `queryClient`, never invokes side effects directly); the bridge subscribes to the store, persists the value to a `lang` cookie scoped to `.classlite.app` (`.classlite.localhost` in dev), and calls `i18n.changeLanguage(lng)`. On boot, the hook reads the cookie and seeds the store. Cross-domain handoff from `classlite.app` → `my.classlite.app` Just Works because both subdomains read the same cookie.
> - `classlite-web/src/lib/i18n.ts` hardcodes `lng: 'en'`. **1-7c rewires** this to read the initial language from the `lang` cookie (via the new `lib/language-cookie.ts`) with `'en'` as fallback. The i18n init stays synchronous (no async cookie read at module-level — it uses `document.cookie` directly, available immediately).
> - `classlite-web/src/locales/en.json` and `vi.json` from 1-7b contain THREE keys each: `app.name`, `app.welcome`, `app.errorFallback`. **1-7c adds the initial layout + shared-screen keys** (~25–35 keys covering AppLayout, ErrorBoundary, PermissionDenied, NotFound, plus the *initial auth-screen keys* the epic spec mandates so Stories 1.8 / 1.9a–d can pick them up). Vietnamese values are NOT machine translations — they're localized by a Vietnamese-fluent reviewer. (Default seed-translation: machine translate, then flag in story for the reviewer to revise in-PR.)
> - `classlite-web/src/lib/test/i18n-parity.ts` (the `assertI18nParity` helper) already exists from 1-7b. ✅ **1-7c uses it; does NOT recreate it.** A 1-7b dev-notes line earlier said "Discovered: assertI18nParity already exists" — Story 1-7b actually shipped it; project-context-mirror docs lagged. Verify in the existing file.
> - `classlite-web/scripts/i18n-parity.mjs` already exists from 1-7b. ✅ **1-7c wires it into the CI workflow** (the script exists; it isn't called by any CI step yet). Adds `npm run i18n-parity` to the project's CI matrix (see Task 9.x).
> - `classlite-web/playwright.config.ts` already has FOUR cross-subdomain Playwright projects (`setup`, `landing`, `dashboard`, `cross-subdomain`) + a `design-system` project + two mobile projects. The `setup` project writes `.classlite.localhost` `classlite_session` + `lang` stub cookies to `STORAGE_STATE` (`.playwright/auth.json`) via `auth.setup.ts`. ✅ The cross-domain Playwright **infrastructure is already in place per Phase 0.4** (handoff line 85). **1-7c adds NEW specs that exercise it**, not new config.
> - `classlite-web/tests/e2e/cross-subdomain/cookie-sharing.spec.ts` exists from 1.5/Phase 0.4 — it asserts cookies are scoped to `.classlite.localhost` and visible at both subdomains. ✅ **1-7c does NOT touch this spec**; it adds a sibling spec (`bilingual-dashboard-boot.spec.ts` in the same directory) that proves the dashboard reads the `lang` cookie on initial render.
> - `classlite-landing/` (the Astro landing site) does NOT exist yet — Story 1.10 ships it. The full `classlite.app` → `my.classlite.app` E2E navigation test is deferred to 1.10. **1-7c proves the dashboard half of the handoff** (lang cookie → dashboard initial render in vi) via the Playwright `cross-subdomain` project against the existing stubbed cookie state.
> - `classlite-web/src/hooks/` does NOT exist yet. **1-7c creates the directory** and ships four files as STUBS: `useAuth.ts`, `useCurrentCenter.ts`, `useRole.ts`, `usePolling.ts`. Each is a minimal hook that returns the shape downstream stories need (Story 1-8 fills `useAuth`, Story 2-2 fills `useCurrentCenter`, Story 2-6 fills `useRole`, Story 1-9a fills `usePolling`'s consumer). The stubs LINT clean and TYPE-CHECK clean today; they ship un-mocked because the AC8 ESLint rule from 1-7b (no raw `fetch`/`axios` in `src/hooks/**`) is now in force and the stubs intentionally don't touch the network.

> **Out of scope (deferred).** You are NOT building:
> - **Full role-variant Sidebar / TopBar / UserPill / BreadcrumbBar / SearchPill / PageHead** — Epic 1D Story 1d-3 (currently backlog) owns the design-system PRIMITIVES with Owner/Admin/Teacher/Student variants in `components/domain/`. 1-7c ships a **single non-variant** `Sidebar.tsx` + `TopBar.tsx` + `UserPill.tsx` in `components/shared/` that compose plain HTML + Tailwind utility classes against `tokens.css`. The role-aware nav set (workspace / resources / settings groups, role-specific items, mobile tab bar) is 1d-3. When 1d-3 lands, it can refactor 1-7c's shells to consume 1d-3's primitives — that's the boundary contract in Epic 1D's intro.
> - **Real `useAuth` / `useCurrentCenter` / `useRole` / `usePolling` behavior** — the stubs return canned no-session shapes. Story 1-8 fills `useAuth` (real session via Query); Story 2-2 fills `useCurrentCenter`; Story 2-6 fills `useRole` and adds router-level role gating; Story 1-9a is the first `usePolling` consumer. 1-7c only ships the FILE EXISTENCE + TYPE SIGNATURES so downstream imports compile.
> - **Actual auth UI** (Register, Login, Forgot Password, Reset Password, Verification, Invite Acceptance) — Stories 1.8 and 1.9a/b/c/d. 1-7c ships *route-stub* placeholders for `/permission-denied` and `/__not-matched-route` but NOT for `/register`, `/forgot-password`, etc.
> - **The Astro landing site (`classlite-landing/`)** — Story 1.10 ships it. The cross-domain Playwright project's `landing` test target is exercised by 1.10's specs. 1-7c stays within the dashboard's half.
> - **The `EmptyState` shared component** — though architecture line 871 lists it under `components/shared/`, the Path B re-scope (Epic 1D Story 1d-1 + Story 10.3/10.4) explicitly defers `EmptyState` to Epic 10 with role-scoped i18n keys passed by the consumer. **1-7c does NOT ship `EmptyState`**; the placeholder `EmptyStatePlaceholder` exists as part of 1d-1 (which itself is backlog). For ANY component this story ships that legitimately needs an empty state (none currently — the layout shells don't fetch data), defer to a follow-up.
> - **Adding `vitest-axe` as the project's a11y test driver if axe-core CLI fits better** — see AC7 below. The decision is "use `vitest-axe` for component-level a11y assertions inside Vitest; reserve `axe-core` CLI for full-page audits run via a Playwright spec." This story installs `vitest-axe` (and its peer `axe-core`) as devDeps; full-page audits use the same axe-core via Playwright's `@axe-core/playwright`.
> - **Any UI primitive additions to `components/ui/`** — the existing `button.tsx` from 1-7a is the only shadcn primitive present, and it's sufficient for the retry CTA + permission-denied CTA + not-found CTA in this story. Additional primitives (Toggle, ToggleGroup for the language switcher, Avatar for `UserPill`, etc.) are Epic 1D Story 1d-2 scope. **Do NOT install new shadcn primitives in this story.** The language toggle is a hand-rolled `<button>` pair (radio-group-shaped) + the `UserPill` uses an `<img>` or initials placeholder, not Avatar.
> - **Server-side cookie writing for the language preference** — the Go API does not need to know the language preference on a per-request basis; locale formatting is client-side (project-context PERF-4 says locale lives in JWT claims for server-rendered surfaces, but the dashboard surface is fully client-rendered). 1-7c writes the cookie client-side; no Go API change is in scope.
> - **`assertI18nParity` helper itself** — already shipped in 1-7b at `src/lib/test/i18n-parity.ts`. 1-7c CONSUMES it; does not rewrite it. If you find a bug in it during this story, FIX in place and add to the Change Log; do not re-implement.

## Story

As a frontend developer,
I want shared layout components (`AppLayout`, polished `ErrorBoundary`, `PermissionDenied`, `NotFound`, supporting `Sidebar` / `TopBar` / `UserPill` shells), a fully-wired i18n system (en + vi keys present, runtime language toggle, locale-aware date / time / number formatting, `.classlite.app` `lang` cookie continuity from landing to dashboard per UX-DR17), the `assertI18nParity` helper used in every component test (already shipped — consumed here), the `npm run i18n-parity` CI guard wired to a workflow that blocks merge on key drift (R38 mitigation), a bilingual Playwright smoke that walks `/login` in both locales and asserts no raw dotted keys leak into the DOM, axe-core a11y assertions on every public component this story ships, the four stub app-wide hooks (`useAuth`, `useCurrentCenter`, `useRole`, `usePolling`) that downstream stories will fill,
so that every Epic 2–10 page mounts into a finished, accessible, bilingual shell — errors land softly with a Sentry event ID + recovery path, forbidden routes orient the user instead of slamming a 403 in their face, unmatched URLs land on a localized `NotFound` with a clear way home, and a Vietnamese user never sees a raw `auth.login.submit` token because the parity guard catches the drift on the PR before merge.

## Acceptance Criteria (BDD)

> **Risk-score ≥6 check (per WF-8).** This story OWNS one risk score ≥6:
>
> - **R38** (TECH, i18n key missing in `vi.json` — Vietnamese user sees raw key, score 3×2=6) is owned by this story per `classlite_new-handoff.md` line 162. **ATDD red-phase is MANDATORY.** Write the failing tests in AC1 (extended `assertI18nParity` coverage of every new layout / permission-denied / not-found / auth-stub key) + AC8 (Playwright bilingual smoke proving no raw keys appear in DOM) + AC9 (CI-level `npm run i18n-parity` guard) BEFORE writing the components those tests cover. The tests must go red first against the empty stubs, then drive green via implementation. Skipping ATDD here is a quality-gate failure at the Epic 1C boundary.
> - R45 (CF cache wrong origin, score <6 per the handoff matrix — not in the ≥6 owned list) is OPS / DevOps cross-cutting. 1-7c does NOT need to mitigate it directly, but the cross-subdomain Playwright spec AC8 incidentally exercises the `Vary: Origin` invariant from project-context SEC-5.
> - R46 (cross-cutting CI guard, score 6) is DevOps. The AC9 CI wiring for `npm run i18n-parity` is an incidental contribution but the broader CI guard ownership remains DevOps.
>
> **One ATDD red test must exist on the branch BEFORE the first commit moves the story into `in-progress`.** That test is `src/lib/test/__tests__/i18n-parity-coverage.test.ts` (NEW — see Task 9.1 + the AC1 specimen below). The test enumerates every i18n key this story introduces and asserts both `en.json` AND `vi.json` contain each; with empty stubs, it goes red. With the keys added, it goes green. The Playwright bilingual smoke (AC8) and the CI guard wiring (AC9) follow the same red-first discipline but are sequenced AFTER the components ship.

### AC1: i18n keys — `en.json` and `vi.json` cover every layout / shared-screen / auth-stub key (R38 mitigation — ATDD-red FIRST)

**Given** the files `classlite-web/src/locales/en.json` and `classlite-web/src/locales/vi.json`,
**When** running `npm test -- i18n-parity-coverage` against the existing stubs (the three baseline keys from 1-7b),
**Then** the new ATDD test `src/lib/test/__tests__/i18n-parity-coverage.test.ts` is RED — both locales are missing the new keys.

**And** after this story ships, both files contain every key listed below WITH non-empty, locale-correct values (Vietnamese values reviewed by a Vietnamese-fluent reviewer in the PR — flag explicitly in the Change Log if seeded by machine translation; the reviewer revises in-PR):

```
# Existing (do NOT remove or rename — those are 1-7b's contract):
app.name
app.welcome
app.errorFallback

# AppLayout — sidebar + topbar chrome (this story):
app.layout.sidebar.brand                # "ClassLite" wordmark — for accessible-name only; visible text uses Fraunces literal
app.layout.sidebar.collapseToggle       # aria-label for the sidebar collapse button
app.layout.topbar.search                # placeholder text on the SearchPill (1-7c ships visual only; 1d-3 wires palette)
app.layout.topbar.searchHint            # "⌘K" keyboard-hint chip aria-label
app.layout.userPill.roleLabel.owner     # "Owner" / "Chủ trung tâm"
app.layout.userPill.roleLabel.admin     # "Admin" / "Quản lý"
app.layout.userPill.roleLabel.teacher   # "Teacher" / "Giáo viên"
app.layout.userPill.roleLabel.student   # "Student" / "Học viên"
app.layout.userPill.signOut             # menu item label (visible from a dropdown — wired in Story 1-9d's session-expired flow)
app.layout.languageToggle.aria          # aria-label on the language toggle group
app.layout.languageToggle.en            # accessible name for the EN segment
app.layout.languageToggle.vi            # accessible name for the VI segment
app.layout.skipToContent                # WCAG 2.4.1 skip-to-content link (TEST-UX-2 — skip links function on every page)

# ErrorBoundary (replaces 1-7b's minimal RootErrorBoundary):
app.errorBoundary.title                 # "Something went wrong" / "Có lỗi xảy ra"
app.errorBoundary.body                  # "We've been notified and our team is looking into it." / "Chúng tôi đã được thông báo và đang xem xét."
app.errorBoundary.eventIdLabel          # "Error reference" / "Mã lỗi tham chiếu"
app.errorBoundary.retryCta              # "Try again" / "Thử lại"
app.errorBoundary.homeLinkCta           # "Back to dashboard" / "Quay về bảng điều khiển"

# PermissionDenied (UX-DR16 — orientation, not bare 403; reframes around what's behind the boundary):
app.permissionDenied.title              # "You don't have access to this section" / "Bạn không có quyền truy cập"
app.permissionDenied.bodyOwnerAdmin     # "This section requires an Owner or Admin role. Ask your Center Owner or Admin to grant you access."
                                        # / "Phần này yêu cầu quyền Chủ trung tâm hoặc Quản lý. Hãy đề nghị họ cấp quyền cho bạn."
app.permissionDenied.bodyOwner          # Same shape, Owner-only paths.
app.permissionDenied.contactLinkCta     # "Message Owner / Admin" / "Liên hệ Chủ trung tâm / Quản lý"
app.permissionDenied.homeLinkCta        # "Back to your dashboard" / "Quay về bảng điều khiển của bạn"

# NotFound (deferred catch-all route from 1-7b W1):
app.notFound.title                      # "Page not found" / "Không tìm thấy trang"
app.notFound.body                       # "The page you were looking for moved or no longer exists." / "Trang bạn tìm đã bị xóa hoặc không còn tồn tại."
app.notFound.homeLinkCta                # "Back to dashboard" / "Quay về bảng điều khiển"

# Initial auth-screen keys — Story 1.8 / 1.9a-d will USE these; 1-7c SEEDS them so the parity helper has coverage and the bilingual smoke test has surface:
auth.login.title                        # "Sign in to ClassLite" / "Đăng nhập vào ClassLite"
auth.login.submit                       # "Sign in" / "Đăng nhập"
auth.login.googleCta                    # "Continue with Google" / "Tiếp tục với Google"
auth.login.emailCollapse                # "Sign in with email" / "Đăng nhập bằng email"
auth.register.title                     # "Create your account" / "Tạo tài khoản"
auth.register.submit                    # "Create account" / "Tạo tài khoản"
auth.common.email                       # "Email" / "Email"
auth.common.password                    # "Password" / "Mật khẩu"
auth.common.passwordToggleAria          # aria-label for the password show/hide eye toggle
```

**And** the test `src/lib/test/__tests__/i18n-parity-coverage.test.ts` enumerates EVERY key above and calls `assertI18nParity` on the whole list. This is the ATDD red specimen — it goes red first against the empty stubs and green after Task 1.x adds the keys.

**And** Vietnamese values are NOT mechanically transliterated — the Change Log entry calls out which keys had a Vietnamese-fluent reviewer manually adjust the machine-translation seed during PR review. If the reviewer cannot reach a Vietnamese speaker before merge, the keys ship with the machine-translated value AND a `// TODO(ducdo): vi review` comment lives in `vi.json` (i18next tolerates trailing comments in JSON5 but our pure-JSON config does NOT — the TODO instead goes into the story's `Change Log` so it is grep-able from `git log`).

_Pinned executable contract (write this test first):_ `classlite-web/src/lib/test/__tests__/i18n-parity-coverage.test.ts`:

```ts
import { describe, test } from 'vitest'
import { assertI18nParity } from '@/lib/test/i18n-parity'

// Every i18n key Story 1-7c introduces. Asserts both en.json AND vi.json
// contain each. Goes red against empty locale stubs; green after Task 1.x.
const STORY_1_7C_KEYS = [
  'app.layout.sidebar.brand',
  'app.layout.sidebar.collapseToggle',
  'app.layout.topbar.search',
  'app.layout.topbar.searchHint',
  'app.layout.userPill.roleLabel.owner',
  'app.layout.userPill.roleLabel.admin',
  'app.layout.userPill.roleLabel.teacher',
  'app.layout.userPill.roleLabel.student',
  'app.layout.userPill.signOut',
  'app.layout.languageToggle.aria',
  'app.layout.languageToggle.en',
  'app.layout.languageToggle.vi',
  'app.layout.skipToContent',
  'app.errorBoundary.title',
  'app.errorBoundary.body',
  'app.errorBoundary.eventIdLabel',
  'app.errorBoundary.retryCta',
  'app.errorBoundary.homeLinkCta',
  'app.permissionDenied.title',
  'app.permissionDenied.bodyOwnerAdmin',
  'app.permissionDenied.bodyOwner',
  'app.permissionDenied.contactLinkCta',
  'app.permissionDenied.homeLinkCta',
  'app.notFound.title',
  'app.notFound.body',
  'app.notFound.homeLinkCta',
  'auth.login.title',
  'auth.login.submit',
  'auth.login.googleCta',
  'auth.login.emailCollapse',
  'auth.register.title',
  'auth.register.submit',
  'auth.common.email',
  'auth.common.password',
  'auth.common.passwordToggleAria',
] as const

describe('Story 1-7c i18n parity', () => {
  test('every key exists in both en.json and vi.json', () => {
    assertI18nParity(STORY_1_7C_KEYS)
  })
})
```

### AC2: AppLayout — sidebar + topbar shell wrapping authenticated `<Outlet />` (UX-3 / FW-7 / WCAG 2.4.1)

**Given** the directory `classlite-web/src/components/shared/`,
**When** inspecting the layout primitives,
**Then** `AppLayout.tsx` exists and exports a default React function component with no required props.

**Render contract:**

```
+---------------------+----------------------------------------+
|  Sidebar            |  TopBar                                |
|  (220px,            |  ┌──────────────────────────────────┐ |
|   var(--cl-         |  │ <breadcrumb slot>  <search pill> │ |
|   sidebar-bg))      |  │                    <language tog>│ |
|                     |  └──────────────────────────────────┘ |
|  [Workspace items]  +----------------------------------------+
|  [Resources items]  |                                        |
|  [Settings (Owner)] |  <main>                                |
|                     |    <Outlet />     <-- authenticated    |
|                     |        page content                    |
|  [UserPill]         |  </main>                               |
+---------------------+----------------------------------------+
```

**And** `AppLayout` does NOT fetch data. It reads ONLY:
- `useUIStore((s) => s.sidebarCollapsed)` — the sidebar-collapsed UI state from 1-7b's `uiStore`. This is the ONLY Zustand read.
- `useRole()` — returns `'owner' | 'admin' | 'teacher' | 'student' | null` from the 1-7c stub (returns `null` always today; consumes the prop pattern downstream). The sidebar nav set is chosen with this; today every variant renders an identical placeholder nav (per the deferral to 1d-3 — the four role-variants land there).
- `useTranslation()` for i18n.

**And** `AppLayout` renders a `<a href="#main-content" className="sr-only focus:not-sr-only ...">` **skip-to-content link** as the FIRST focusable element on the page, resolving to `<main id="main-content">`. Verified by `vitest-axe` (AC7) and by a keyboard-navigation Playwright spec (`e2e/bilingual-smoke.spec.ts` AC8).

**And** the topbar renders the language toggle (`<LanguageToggle />` from `components/shared/LanguageToggle.tsx`) — a two-button radio-group-shaped element that calls `useLanguageStore.getState().setLanguage(lng)` on click. The store action mutation triggers the side-effect bridge from `lib/language-cookie.ts` (mounted via `useLanguageInit()` in `App.tsx`) which writes the cookie + calls `i18n.changeLanguage(lng)`.

**And** the sidebar renders the `UserPill` at the bottom. Today `UserPill` is a static placeholder that reads `useAuth().user` from the stub (returns `null` — renders a "Sign in" CTA placeholder linking to `/login`). When 1-8 fills `useAuth`, the placeholder becomes a real avatar + name + role label.

**And** at mobile breakpoint (`md:` and below per Tailwind v4), the sidebar collapses to an off-canvas drawer. The drawer is **not** the role-variant Mobile Tab Bar from `s74–s86` — that's 1d-3. 1-7c ships only a hamburger toggle that flips `useUIStore.getState().setSidebarCollapsed(true)` to slide the sidebar off-screen on mobile. The collapsed/expanded state survives across route changes (uiStore is module-singleton).

**And** the layout consumes ONLY design tokens from `tokens.css` — every color uses `var(--cl-*)`, every spacing uses the design token scale, no raw hex (1-7a AC5 lint rule).

**And** the Loading / Empty / Error trilogy (TEST-FE-2) does NOT apply to `AppLayout` because it does not fetch data. It applies to every component INSIDE the layout that does — Story 1-8 onwards. Document the rule's scope at the top of `AppLayout.tsx` as a JSDoc comment for future agents.

_Pinned executable contract:_ `classlite-web/src/components/shared/__tests__/AppLayout.test.tsx`:
- Test 1: Renders sidebar, topbar, and `<main role="main">` regions (semantic role queries, NOT `data-testid`).
- Test 2: `assertI18nParity(['app.layout.sidebar.brand', 'app.layout.topbar.search', 'app.layout.languageToggle.en', 'app.layout.languageToggle.vi', 'app.layout.skipToContent'])`.
- Test 3: `vitest-axe` audit returns zero violations (AC7).
- Test 4: First-tab focus lands on the skip-to-content link (`<a href="#main-content">`); pressing Enter focuses `<main>`.
- Test 5: Clicking the EN segment of the language toggle calls `useLanguageStore.getState().setLanguage('en')`; clicking VI calls with `'vi'`.

### AC3: `ErrorBoundary` — polished render-time error fallback with Sentry event ID + retry CTA (replaces 1-7b's minimal `RootErrorBoundary`)

**Given** the existing file `classlite-web/src/components/shared/RootErrorBoundary.tsx`,
**When** the new file `classlite-web/src/components/shared/ErrorBoundary.tsx` lands,
**Then** the OLD file is **deleted** and `App.tsx` swaps its wrapper to the new `ErrorBoundary`.

**Class-component contract:**

```ts
// classlite-web/src/components/shared/ErrorBoundary.tsx (shape — dev implements)
import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import * as Sentry from '@sentry/react'
import { Button } from '@/components/ui/button'

interface ErrorBoundaryProps {
  children: ReactNode
}

interface ErrorBoundaryState {
  hasError: boolean
  eventId: string | null
}

function ErrorFallback({
  eventId,
  onRetry,
}: {
  eventId: string | null
  onRetry: () => void
}): ReactNode {
  const { t } = useTranslation()
  return (
    <div
      role="alert"
      className="flex min-h-screen flex-col items-center justify-center bg-[var(--cl-paper)] px-4 text-center"
    >
      <h1 className="font-[var(--cl-font-display)] text-3xl text-[var(--cl-ink)]">
        {t('app.errorBoundary.title')}
      </h1>
      <p className="mt-3 max-w-md font-[var(--cl-font-body)] text-[var(--cl-ink-soft)]">
        {t('app.errorBoundary.body')}
      </p>
      {eventId && (
        <p className="mt-4 font-[var(--cl-font-mono)] text-sm text-[var(--cl-muted)]">
          {t('app.errorBoundary.eventIdLabel')}: <span>{eventId}</span>
        </p>
      )}
      <div className="mt-6 flex gap-3">
        <Button onClick={onRetry}>{t('app.errorBoundary.retryCta')}</Button>
        <a
          href="/dashboard"
          className="font-[var(--cl-font-body)] text-[var(--cl-accent)] underline"
        >
          {t('app.errorBoundary.homeLinkCta')}
        </a>
      </div>
    </div>
  )
}

export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { hasError: false, eventId: null }

  static getDerivedStateFromError(): Partial<ErrorBoundaryState> {
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    const eventId = Sentry.captureException(error, {
      contexts: { react: { componentStack: info.componentStack ?? '' } },
    })
    this.setState({ eventId })
  }

  handleRetry = (): void => {
    this.setState({ hasError: false, eventId: null })
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <ErrorFallback eventId={this.state.eventId} onRetry={this.handleRetry} />
      )
    }
    return this.props.children
  }
}
```

**Why the retry button works without a hard refresh:** clicking it clears `state.hasError`, the next render re-mounts `this.props.children`, which causes React Router v7 to re-evaluate the current route and re-execute its lazy loader. If the error was transient (HMR stale chunk, transient render bug, race condition), the second render succeeds and the user is back to where they were. If the error recurs, the boundary catches again and shows the same fallback — the retry is bounded.

**Why we display the Sentry event ID:** support workflow per architecture line 519–521. A user reports "everything blew up at 3:47 PM"; they read the event ID off the screen; the engineer pastes it into Sentry search; the matching event has `tags.requestId` (1-7b AC6) and the full component stack; debugging time drops from minutes-of-grep to seconds. The event ID is a Sentry-internal UUID-shape; render it monospace.

**And** `App.tsx` REPLACES the old `<RootErrorBoundary>` wrapper with `<ErrorBoundary>`. The change is mechanical:

```tsx
// classlite-web/src/App.tsx — diff shape
- import { RootErrorBoundary } from '@/components/shared/RootErrorBoundary'
+ import { ErrorBoundary } from '@/components/shared/ErrorBoundary'

  export default function App() {
    return (
-     <RootErrorBoundary>
+     <ErrorBoundary>
        <RouterProvider router={router} />
-     </RootErrorBoundary>
+     </ErrorBoundary>
    )
  }
```

**And** the file `classlite-web/src/components/shared/RootErrorBoundary.tsx` is **deleted** along with its test file at `src/components/shared/__tests__/RootErrorBoundary.test.tsx`. The new test file `ErrorBoundary.test.tsx` extends the 1-7b smoke contract with: (a) the event ID renders when `componentDidCatch` returns one; (b) the retry CTA clears the error state and re-renders children.

**And** the i18n key `app.errorFallback` (1-7b's single key for the minimal boundary) is **deleted** from both locale files because no consumer references it after the swap. The parity-coverage test (AC1) does NOT include it.

_Pinned executable contract:_ `classlite-web/src/components/shared/__tests__/ErrorBoundary.test.tsx`:
- Test 1: A child component that throws on render surfaces a `role="alert"` element containing `t('app.errorBoundary.title')` AND `t('app.errorBoundary.body')`. `Sentry.captureException` is called with the component stack.
- Test 2: When `Sentry.captureException` returns an event ID, the rendered fallback includes the ID inside a `<span>` AND a label resolved from `t('app.errorBoundary.eventIdLabel')`.
- Test 3: Clicking the retry CTA causes a child component (re-rendered to throw on render-once-only) to re-render WITHOUT the error fallback — the boundary's state has been cleared.
- Test 4: `vitest-axe` audit on the rendered fallback returns zero violations.
- Test 5: `assertI18nParity(['app.errorBoundary.title', 'app.errorBoundary.body', 'app.errorBoundary.eventIdLabel', 'app.errorBoundary.retryCta', 'app.errorBoundary.homeLinkCta'])`.

### AC4: `PermissionDenied` — `s67` orientation screen (UX-DR16, UX-3)

**Given** the file `classlite-web/src/components/shared/PermissionDenied.tsx` (NEW),
**When** a teacher deep-links to `/billing` or `/admin/center-settings`,
**Then** the route renders `PermissionDenied` instead of a bare 403,
**And** the screen names *what's behind the boundary* + *who can grant access* + *one clear next action* (UX-DR16's three-part recovery + UX spec §6.4's "permission denied as orientation, not punishment").

**Props contract:**

```ts
export interface PermissionDeniedProps {
  /**
   * Which roles CAN access this section. Determines the body copy.
   * If `['owner', 'admin']`, copy reads "This section requires Owner or Admin."
   * If `['owner']`, copy reads "This section requires Owner."
   *
   * 1-7c ships TWO copy variants matching the two visible-in-spec
   * combinations. Future role gates (Teacher-only? Student-only?) add
   * new variants here + new i18n keys + new test cases.
   */
  requiredRoles: ['owner', 'admin'] | ['owner']

  /**
   * Optional name of the section the user tried to reach, woven into copy
   * for richer orientation. Story 2-6 (router-level gating) passes this
   * from the route's `errorElement`. 1-7c renders a generic copy when
   * absent.
   */
  sectionName?: string
}
```

**And** the screen renders THREE CTAs in priority order, EACH using i18n keys (no English strings hardcoded — failure mode TEST-FE-4):
1. **Primary:** "Message Owner / Admin" — opens the dashboard's Inbox compose dialog scoped to the role(s). 1-7c renders a `<button>` that does nothing (the Inbox compose flow lands with Epic 10 Story 10-1). The button is keyboard-reachable + visible; the no-op handler is fine for this story; flag in the JSDoc.
2. **Secondary:** "Back to your dashboard" — `<a href="/dashboard">` with `--cl-accent` color underline.
3. **Tertiary (visual deemphasized):** a one-line summary of the role requirement.

**And** the screen is mounted via a new lazy route in `routes.tsx`:

```tsx
{
  path: '/permission-denied',
  lazy: async () => {
    const { default: PermissionDenied } = await import(
      '@/components/shared/PermissionDenied'
    )
    return {
      // Default render uses the OwnerAdmin variant for the standalone URL;
      // role-specific renders happen via `errorElement` on individual routes
      // in Story 2-6, where the route already knows what roles it requires.
      Component: () => <PermissionDenied requiredRoles={['owner', 'admin']} />,
    }
  },
},
```

**And** today no route uses `errorElement: <PermissionDenied />` — Story 2-6 wires the role gate at the router level. 1-7c just makes the URL `/permission-denied` directly reachable and the component importable.

_Pinned executable contract:_ `classlite-web/src/components/shared/__tests__/PermissionDenied.test.tsx`:
- Test 1: With `requiredRoles=['owner', 'admin']`, the body text matches `t('app.permissionDenied.bodyOwnerAdmin')`. With `requiredRoles=['owner']`, body matches `t('app.permissionDenied.bodyOwner')`.
- Test 2: Renders ALL three CTAs as semantic elements (role queries — `getByRole('button', { name: ... })` and `getByRole('link', { name: ... })`).
- Test 3: `vitest-axe` audit returns zero violations.
- Test 4: `assertI18nParity(['app.permissionDenied.title', 'app.permissionDenied.bodyOwnerAdmin', 'app.permissionDenied.bodyOwner', 'app.permissionDenied.contactLinkCta', 'app.permissionDenied.homeLinkCta'])`.

### AC5: `NotFound` — `path: '*'` catch-all route + localized 404 screen (closes 1-7b W1)

**Given** the deferred catch-all from 1-7b's review (deferred-work.md: "NotFound / catch-all route missing — React Router's default error UI bypasses the i18n RootErrorBoundary fallback"),
**When** a user navigates to `/some/unknown/path`,
**Then** React Router v7's `path: '*'` catch-all matches and lazy-loads `NotFound`,
**And** `NotFound.tsx` renders a localized title + body + a single "Back to dashboard" link.

**Add to `routes.tsx`:**

```tsx
// Append AFTER the auth / student / teacher boundary entries:
{
  path: '*',
  lazy: async () => {
    const { default: NotFound } = await import(
      '@/components/shared/NotFound'
    )
    return { Component: NotFound }
  },
},
```

**Where it goes in the route table:** as the LAST entry of `baseRoutes` in `src/routes.tsx`. The dev-only routes (`/__theme-resolution`, `/__multi-tab-test-bait`) appear AFTER `baseRoutes` in production-stripped form, but they DO match before `path: '*'` in dev because React Router v7 matches in declaration order. The catch-all must be the LAST entry of the production-eligible array.

**And** `NotFound.tsx` is a pure render component — no data, no Zustand, no Query. The implementation:

```tsx
// classlite-web/src/components/shared/NotFound.tsx (shape — dev implements)
import { useTranslation } from 'react-i18next'

export default function NotFound() {
  const { t } = useTranslation()
  return (
    <main
      role="main"
      className="flex min-h-screen flex-col items-center justify-center bg-[var(--cl-paper)] px-4 text-center"
    >
      <h1 className="font-[var(--cl-font-display)] text-3xl text-[var(--cl-ink)]">
        {t('app.notFound.title')}
      </h1>
      <p className="mt-3 max-w-md font-[var(--cl-font-body)] text-[var(--cl-ink-soft)]">
        {t('app.notFound.body')}
      </p>
      <a
        href="/dashboard"
        className="mt-6 font-[var(--cl-font-body)] text-[var(--cl-accent)] underline"
      >
        {t('app.notFound.homeLinkCta')}
      </a>
    </main>
  )
}
```

_Pinned executable contract:_ `classlite-web/src/components/shared/__tests__/NotFound.test.tsx`:
- Test 1: Renders `<main role="main">` containing `t('app.notFound.title')` + `t('app.notFound.body')` + `<a href="/dashboard">`.
- Test 2: `vitest-axe` audit returns zero violations.
- Test 3: `assertI18nParity(['app.notFound.title', 'app.notFound.body', 'app.notFound.homeLinkCta'])`.

**And** a Playwright assertion (in `e2e/bilingual-smoke.spec.ts` AC8) navigates to `http://localhost:5173/this-route-does-not-exist` and asserts the `NotFound` screen renders WITHOUT triggering the `ErrorBoundary` (React Router's catch-all matches before the boundary fires).

### AC6: i18n language toggle + `.classlite.app` `lang` cookie continuity (UX-DR17 — the cross-domain handoff)

**Given** the file `classlite-web/src/lib/language-cookie.ts` (NEW) and the hook `classlite-web/src/hooks/useLanguageInit.ts` (NEW),
**When** the dashboard boots,
**Then** `useLanguageInit()` (called once from `App.tsx`) reads the `lang` cookie from `document.cookie`,
**And** if the cookie value is `'vi'` or `'en'`, seeds `useLanguageStore.setState({ language: <value> })` AND calls `i18n.changeLanguage(<value>)`,
**And** otherwise leaves the store at its initial `'en'` value (per `languageStore.initialState` from 1-7b).

**And** the file `classlite-web/src/lib/language-cookie.ts` exports:

```ts
// classlite-web/src/lib/language-cookie.ts (shape — dev implements)
export type Language = 'en' | 'vi'

const COOKIE_NAME = 'lang'
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365 // 1 year — language is sticky

/**
 * Compute the cookie Domain attribute. In production we write `.classlite.app`
 * so the landing site (`classlite.app`) and the dashboard (`my.classlite.app`)
 * share it. In local dev we write `.classlite.localhost` so the Phase 0.4
 * cross-subdomain Playwright projects continue to work. Everywhere else
 * (jsdom tests, GitHub Codespaces, etc.) we write NO Domain attribute so the
 * cookie defaults to the host's eTLD+1.
 */
export function languageCookieDomain(): string | null {
  if (typeof window === 'undefined') return null
  const host = window.location.hostname
  if (host.endsWith('.classlite.app') || host === 'classlite.app') {
    return '.classlite.app'
  }
  if (host.endsWith('.classlite.localhost') || host === 'classlite.localhost') {
    return '.classlite.localhost'
  }
  return null
}

export function readLanguageCookie(): Language | null {
  if (typeof document === 'undefined') return null
  const match = document.cookie.match(
    new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;]+)`),
  )
  const value = match?.[1]
  if (value === 'en' || value === 'vi') return value
  return null
}

export function writeLanguageCookie(value: Language): void {
  if (typeof document === 'undefined') return
  const domain = languageCookieDomain()
  const parts = [
    `${COOKIE_NAME}=${value}`,
    `Max-Age=${COOKIE_MAX_AGE_SECONDS}`,
    'Path=/',
    'SameSite=Lax',
  ]
  if (domain) parts.push(`Domain=${domain}`)
  // No Secure attribute — the cookie is NOT a session credential. UX-DR17
  // explicitly notes it is a preference cookie that crosses the same eTLD+1
  // both in dev (http://*.classlite.localhost) and prod (https://*.classlite.app).
  // The dev surface is HTTP-only and would reject Secure cookies; prod is
  // HTTPS and modern browsers accept Lax cookies set over HTTPS regardless
  // of Secure.
  document.cookie = parts.join('; ')
}
```

**And** the hook `classlite-web/src/hooks/useLanguageInit.ts`:

```ts
// classlite-web/src/hooks/useLanguageInit.ts (shape — dev implements)
import { useEffect, useRef } from 'react'
import i18n from '@/lib/i18n'
import { useLanguageStore } from '@/stores/languageStore'
import {
  readLanguageCookie,
  writeLanguageCookie,
} from '@/lib/language-cookie'

/**
 * Mount once in App.tsx. Seeds the language store from the `lang` cookie
 * on first render, then subscribes to the store: any subsequent
 * `setLanguage(lng)` call writes the cookie AND tells react-i18next to
 * change the active language.
 *
 * The subscription side-effect lives OUTSIDE the store action because
 * project-context FW-5 + FW-6 forbid Zustand stores from owning side
 * effects (Zustand stores stay isolated; side-effect coupling belongs at
 * the component / hook layer).
 *
 * This is the ONLY legitimate `useEffect` in the 1-7c surface — it's
 * subscription cleanup, which project-context FW-4 explicitly permits.
 */
export function useLanguageInit(): void {
  const seeded = useRef(false)
  useEffect(() => {
    if (!seeded.current) {
      seeded.current = true
      const cookieLang = readLanguageCookie()
      if (cookieLang) {
        useLanguageStore.setState({ language: cookieLang })
        void i18n.changeLanguage(cookieLang)
      }
    }
    const unsubscribe = useLanguageStore.subscribe((state, prev) => {
      if (state.language === prev.language) return
      writeLanguageCookie(state.language)
      void i18n.changeLanguage(state.language)
    })
    return unsubscribe
  }, [])
}
```

**And** `App.tsx` is updated to call `useLanguageInit()` ONCE at the top of the component:

```tsx
// classlite-web/src/App.tsx — final shape
import { RouterProvider } from 'react-router'
import { ErrorBoundary } from '@/components/shared/ErrorBoundary'
import { useLanguageInit } from '@/hooks/useLanguageInit'
import { router } from '@/routes'

export default function App() {
  useLanguageInit()
  return (
    <ErrorBoundary>
      <RouterProvider router={router} />
    </ErrorBoundary>
  )
}
```

**And** the file `classlite-web/src/lib/i18n.ts` is updated to seed the initial `lng` from the cookie (so the very first render uses the right language, not flicker from en → vi):

```ts
// classlite-web/src/lib/i18n.ts — diff shape
  import i18n from 'i18next'
  import { initReactI18next } from 'react-i18next'
  import en from '@/locales/en.json'
  import vi from '@/locales/vi.json'
+ import { readLanguageCookie } from '@/lib/language-cookie'

  i18n.use(initReactI18next).init({
    resources: {
      en: { translation: en },
      vi: { translation: vi },
    },
-   lng: 'en',
+   lng: readLanguageCookie() ?? 'en',
    fallbackLng: 'en',
    interpolation: {
      escapeValue: false,
    },
  })

  export default i18n
```

**And** `useLanguageInit()`'s effect ALSO seeds the `languageStore` to match the cookie — so the store and i18n are in sync from the first frame. Without this, the store says `'en'` while `i18n.language === 'vi'` and the `<LanguageToggle />` shows the wrong active segment.

**And** the toggle UI lives in `classlite-web/src/components/shared/LanguageToggle.tsx`:

```tsx
// classlite-web/src/components/shared/LanguageToggle.tsx (shape — dev implements)
import { useTranslation } from 'react-i18next'
import { useLanguageStore } from '@/stores/languageStore'

export default function LanguageToggle() {
  const { t } = useTranslation()
  const language = useLanguageStore((s) => s.language)
  const setLanguage = useLanguageStore((s) => s.setLanguage)
  return (
    <fieldset
      aria-label={t('app.layout.languageToggle.aria')}
      className="inline-flex rounded-[var(--cl-radius-full)] border border-[var(--cl-line)] bg-[var(--cl-surface)] p-1"
    >
      <button
        type="button"
        aria-pressed={language === 'en'}
        onClick={() => setLanguage('en')}
        className={`rounded-[var(--cl-radius-full)] px-3 py-1 text-sm ${
          language === 'en'
            ? 'bg-[var(--cl-ink)] text-[var(--cl-surface)]'
            : 'text-[var(--cl-ink-soft)]'
        }`}
      >
        {t('app.layout.languageToggle.en')}
      </button>
      <button
        type="button"
        aria-pressed={language === 'vi'}
        onClick={() => setLanguage('vi')}
        className={`rounded-[var(--cl-radius-full)] px-3 py-1 text-sm ${
          language === 'vi'
            ? 'bg-[var(--cl-ink)] text-[var(--cl-surface)]'
            : 'text-[var(--cl-ink-soft)]'
        }`}
      >
        {t('app.layout.languageToggle.vi')}
      </button>
    </fieldset>
  )
}
```

_Pinned executable contracts:_

`classlite-web/src/lib/__tests__/language-cookie.test.ts` (Vitest, jsdom env):
- Test 1: `writeLanguageCookie('vi')` sets a cookie that `readLanguageCookie()` reads back as `'vi'`.
- Test 2: `languageCookieDomain()` returns `.classlite.app` when `window.location.hostname` is mocked to `my.classlite.app`; `.classlite.localhost` when `my.classlite.localhost`; `null` when `localhost`.
- Test 3: A malformed cookie value (`lang=garbage`) makes `readLanguageCookie()` return `null` (not throw).
- Test 4: Multiple cookies in `document.cookie` — `readLanguageCookie()` extracts the `lang` value correctly when surrounded by other cookies (`session_id=...; lang=vi; csrf=...`).

`classlite-web/src/hooks/__tests__/useLanguageInit.test.tsx` (Vitest + Testing Library):
- Test 1: When the cookie is `lang=vi` on mount, the store is seeded to `language: 'vi'` AND `i18n.language === 'vi'` after the effect fires.
- Test 2: With no cookie present, the store stays at `'en'` initial value; `i18n.language` stays at `'en'`.
- Test 3: When the store action `setLanguage('vi')` fires AFTER mount, the cookie is written AND `i18n.changeLanguage('vi')` is called. (Spy on `document.cookie` setter via `Object.defineProperty(document, 'cookie', ...)`).

`classlite-web/src/components/shared/__tests__/LanguageToggle.test.tsx`:
- Test 1: Renders two `<button aria-pressed=...>` segments labeled per i18n.
- Test 2: With `language: 'en'` in the store, the EN button has `aria-pressed="true"`; VI has `aria-pressed="false"`.
- Test 3: Clicking VI calls `useLanguageStore.getState().setLanguage('vi')`.
- Test 4: `vitest-axe` audit returns zero violations.
- Test 5: `assertI18nParity(['app.layout.languageToggle.aria', 'app.layout.languageToggle.en', 'app.layout.languageToggle.vi'])`.

### AC7: axe-core a11y assertions — every component in `components/shared/` is WCAG 2.1 AA clean, allowlist documented

**Given** the devDep `vitest-axe` and `axe-core` (NEW — install in this story),
**When** any test file in `classlite-web/src/components/shared/__tests__/**/*.test.tsx` runs,
**Then** the test imports `axe` from `vitest-axe` and asserts `expect(await axe(container)).toHaveNoViolations()`.

**Coverage:** every component this story ships (`AppLayout`, `ErrorBoundary`, `PermissionDenied`, `NotFound`, `LanguageToggle`) gets a dedicated axe assertion. The five tests above include it.

**And** a file `classlite-web/axe.allowlist.json` exists at the project root with an empty `rules: []` entry — the project's known-false-positive allowlist. Today it's empty (no known false positives in the shared layout surface). The file shape:

```json
{
  "$schema": "./scripts/axe-allowlist.schema.json",
  "rules": []
}
```

Each future entry uses:

```json
{
  "rules": [
    {
      "rule": "color-contrast",
      "selector": "[data-axe-allow='cl-paper-accent-2-on-tint-gold']",
      "reason": "amber-on-gold combination on the marketing pill; signed off by Sally + Murat 2026-mm-dd; will re-check post UX-DR2 token adjustment",
      "expires": "2026-12-31"
    }
  ]
}
```

(The schema file is stub-only for this story — its only role is as the JSON contract for future entries. No tool consumes it today; future axe-core wrapper code will.)

**And** `vitest-axe` is configured in `src/test/vitest-setup.ts`:

```ts
// src/test/vitest-setup.ts (modified — append the toMatchers extension)
import * as matchers from 'vitest-axe/matchers'
import { expect } from 'vitest'
expect.extend(matchers)
```

**And** `package.json` adds the devDeps:
- `vitest-axe@^0.1.0` (currently latest)
- `axe-core@^4.10.0`

**And** the existing `npm test` invocation runs all axe assertions inline. No new CI step is needed for component-level a11y (it's a Vitest assertion); for full-page a11y see AC8 (the Playwright bilingual smoke spec adds an `@axe-core/playwright` audit pass on `/login` + `/dashboard` + `/permission-denied` + `/not-found`).

**And** `@axe-core/playwright` is ALSO added as a devDep so AC8 can call `new AxeBuilder({ page }).analyze()` from inside the Playwright spec.

_Pinned executable contract:_ each of the five component tests in `components/shared/__tests__/` includes ONE `vitest-axe` assertion. No separate axe-only test file.

### AC8: Playwright bilingual smoke + cross-subdomain dashboard-boots-in-vi (R38 + A3 + axe full-page audit)

**Given** the existing Playwright `design-system` project (testDir `e2e/`),
**When** the new spec `classlite-web/e2e/bilingual-smoke.spec.ts` runs,
**Then** the spec walks `/login`, `/dashboard`, `/permission-denied`, `/some-unknown-path` in BOTH `lang=en` and `lang=vi` contexts and asserts:
1. The rendered DOM does NOT contain any string matching the regex `/[a-z]+(?:\.[a-z]+){2,}/` (raw dotted i18n keys). The regex is anchored to text nodes only (not attributes — class names contain dots) via a Playwright `page.locator('body').innerText()` scan.
2. Specific landmark elements exist with locale-correct text — e.g., on `/login` with `lang=en`, the H1 reads "Sign in to ClassLite"; on `lang=vi`, "Đăng nhập vào ClassLite". The expected strings are pulled from `en.json` / `vi.json` via Playwright's test-time `import` so the spec stays in sync if values change.
3. The skip-to-content link is the first focusable element (`page.keyboard.press('Tab')` → assert focused element is `<a href="#main-content">`).
4. `@axe-core/playwright` audit returns zero violations on each visited URL.

**And** the existing `tests/e2e/cross-subdomain/cookie-sharing.spec.ts` is **NOT modified** (the partner test was the Phase 0.4 stub — keep it). A NEW spec `classlite-web/tests/e2e/cross-subdomain/dashboard-boots-in-vi.spec.ts` adds:

```ts
test('dashboard boots in Vietnamese when `lang=vi` cookie is set', async ({
  page,
  context,
}) => {
  // The setup project (auth.setup.ts) writes a `lang=en` cookie at
  // `.classlite.localhost`. Override it to `vi` for this spec only — the
  // storageState carries the session cookie unchanged so we keep the
  // authenticated context.
  await context.addCookies([
    { name: 'lang', value: 'vi', domain: '.classlite.localhost', path: '/' },
  ])
  await page.goto('/dashboard')
  // The /dashboard route currently renders the TeacherDashboard placeholder
  // (`app.welcome` key — "Chào mừng đến với ClassLite" in vi). The bilingual
  // smoke spec covers /login; this one closes the cross-subdomain handoff.
  await expect(page.locator('h1')).toContainText('Chào mừng đến với ClassLite')
})
```

**And** the `dashboard-boots-in-vi.spec.ts` file lives under the existing `cross-subdomain` Playwright project — the project's `storageState` provides the stub session cookie so auth doesn't fight the test. The single new test asserts the lang cookie controls initial render. The full landing → dashboard navigation E2E is deferred to Story 1.10 (it needs the Astro landing live to navigate from).

**And** the `bilingual-smoke.spec.ts` is registered in the EXISTING `design-system` Playwright project (no new project) — `playwright.config.ts` does not change.

**And** when `npm run e2e` (or `npx playwright test`) runs in CI, ALL projects execute; the new specs are picked up by file-pattern match. No CI workflow change needed.

_Pinned executable contract:_ the two specs themselves.

```ts
// classlite-web/e2e/bilingual-smoke.spec.ts (shape — dev implements)
import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import enLocale from '../src/locales/en.json'
import viLocale from '../src/locales/vi.json'

const RAW_KEY_REGEX = /\b[a-z][a-zA-Z0-9_-]*(?:\.[a-z][a-zA-Z0-9_-]*){1,}\b/

// Probe locator: an element's innerText should NEVER match the raw-key
// shape. (Attribute values like `data-testid="some.thing"` are fine; we
// scan visible text only.)
async function assertNoRawKeysInDom(page: import('@playwright/test').Page) {
  const visibleText = await page.locator('body').innerText()
  const match = visibleText.match(RAW_KEY_REGEX)
  if (match) {
    throw new Error(
      `Raw i18n key leaked into DOM: ${match[0]}. ` +
        `Add the missing key to en.json/vi.json or fix the t() call.`,
    )
  }
}

for (const { lang, expectedLoginTitle } of [
  { lang: 'en' as const, expectedLoginTitle: enLocale['auth.login.title'] },
  { lang: 'vi' as const, expectedLoginTitle: viLocale['auth.login.title'] },
]) {
  test.describe(`bilingual smoke — lang=${lang}`, () => {
    test.beforeEach(async ({ context }) => {
      await context.clearCookies()
      await context.addCookies([
        { name: 'lang', value: lang, domain: 'localhost', path: '/' },
      ])
    })

    test('/login renders the localized title and zero axe violations', async ({
      page,
    }) => {
      await page.goto('/login')
      await expect(page.locator('h1')).toContainText(expectedLoginTitle)
      await assertNoRawKeysInDom(page)
      const result = await new AxeBuilder({ page }).analyze()
      expect(result.violations).toEqual([])
    })

    test('/permission-denied renders without raw keys', async ({ page }) => {
      await page.goto('/permission-denied')
      await assertNoRawKeysInDom(page)
      const result = await new AxeBuilder({ page }).analyze()
      expect(result.violations).toEqual([])
    })

    test('catch-all renders NotFound without raw keys', async ({ page }) => {
      await page.goto('/this/path/does-not-exist')
      await assertNoRawKeysInDom(page)
    })

    test('Skip-to-content link is the first focusable element', async ({
      page,
    }) => {
      await page.goto('/dashboard')
      await page.keyboard.press('Tab')
      const focused = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null
        return el ? { tag: el.tagName, href: el.getAttribute('href') } : null
      })
      expect(focused?.tag).toBe('A')
      expect(focused?.href).toBe('#main-content')
    })
  })
}
```

### AC9: CI wiring — `npm run i18n-parity` blocks merge, axe full-page audit runs in PR pipeline (R38 + R46 incidental)

**Given** the existing `npm run i18n-parity` script (already wired in 1-7b but NOT yet called from any CI workflow),
**When** the PR pipeline runs against a branch that introduces a key in `en.json` without the matching key in `vi.json`,
**Then** the CI step fails with the script's exit code 1 and the diff report from `scripts/i18n-parity.mjs`.

**Implementation choice — CI surface:** the project has THREE GitHub Actions workflows per project-context WF-6 (`ci-api.yml`, `ci-web.yml`, `ci-landing.yml`). The `ci-web.yml` workflow either exists or it does not — verify with `ls .github/workflows/`. The 1-7c work:

1. **If `ci-web.yml` exists:** add a `Run i18n parity check` step after the existing test/lint matrix.
2. **If `ci-web.yml` does NOT yet exist:** the project-context WF-6 calls for it. Create the file with the minimum matrix needed to enforce the parity guard: `npm ci` → `npm run lint` → `npm run lint:css` → `npx tsc -b` → `npm test` → `npm run i18n-parity` → `npm run build`. Optionally add `npx playwright test --project=design-system` if Playwright is wired (note: Playwright needs `npx playwright install --with-deps` first, which adds ~30s; gate behind a separate job).
3. **In either case:** the new step lives BEFORE the build step so a missing-key failure stops the pipeline before wasting time on a build. After this story, `npm run i18n-parity` is part of the project's required-status-checks list (set in GitHub repo settings — flag in the PR description for the human reviewer to enable).

**And** the workflow file is committed at `.github/workflows/ci-web.yml`. The complete file (if creating fresh):

```yaml
# .github/workflows/ci-web.yml — created/modified by Story 1-7c
name: ci-web

on:
  pull_request:
    paths:
      - 'classlite-web/**'
      - '.github/workflows/ci-web.yml'
  push:
    branches: [main]
    paths:
      - 'classlite-web/**'

jobs:
  verify:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: classlite-web
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'npm'
          cache-dependency-path: classlite-web/package-lock.json
      - run: npm ci
      - run: npm run lint
      - run: npm run lint:css
      - run: npx tsc -b
      - run: npm test
      # R38 mitigation — blocks merge on en/vi key drift.
      - name: i18n parity check (R38)
        run: npm run i18n-parity
      - run: npm run build
```

**And** the failure mode is observable: introduce a key in `en.json` without the matching key in `vi.json`, push to a branch, open a PR, the CI run reports the missing key and the merge button is grey. The reviewer adds the key and re-pushes; CI green; merge proceeds.

**And** Playwright e2e runs in a SEPARATE job that the verify job depends on (or simply runs in parallel — there's no shared state). For now, document it as a follow-up under the `## Change Log` entry and ship the verify job only. If Playwright e2e is needed in this PR, add as `e2e` job:

```yaml
  e2e:
    runs-on: ubuntu-latest
    needs: verify
    defaults:
      run:
        working-directory: classlite-web
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'npm'
          cache-dependency-path: classlite-web/package-lock.json
      - run: npm ci
      - run: npx playwright install --with-deps chromium
      - run: npx playwright test --project=design-system
      - run: npx playwright test --project=cross-subdomain
```

The dev's call — if the verify job is enough to meet the AC, ship just that and document the e2e as a future enhancement. The hard ATDD requirement is the `i18n parity` STEP existing and being callable; the broader workflow shape is incidental.

### AC10: Four stub hooks — `useAuth`, `useCurrentCenter`, `useRole`, `usePolling`

**Given** the directory `classlite-web/src/hooks/` (NEW),
**When** inspecting hook stubs,
**Then** exactly FOUR files exist, each typed, each documented with what the FILLING story is, each lint + tsc clean:

| Hook | Returns (stub) | Filled by |
|---|---|---|
| `useAuth.ts` | `{ user: null, isAuthenticated: false, isLoading: false }` of type `{ user: User \| null; isAuthenticated: boolean; isLoading: boolean }` | Story 1-8 (auth UI calls real `/api/auth/me` via TanStack Query) |
| `useCurrentCenter.ts` | `null` of type `Center \| null` (where `Center = { id: string; name: string; slug: string }`) | Story 2-2 (center setup wizard) |
| `useRole.ts` | `null` of type `Role \| null` (where `Role = 'owner' \| 'admin' \| 'teacher' \| 'student'`) | Story 2-6 (roles & permissions — wires `errorElement: <PermissionDenied />` on guarded routes) |
| `usePolling.ts` | `(opts: { fn: () => Promise<unknown>; intervalMs: number; enabled?: boolean }) => { isPolling: boolean }` of generic shape — the stub implementation IS real (a `useEffect`-based interval with cleanup) but the FIRST consumer is Story 1-9a (email verification poller per UX-DR9) | Story 1-9a's consumer adds the first real usage |

**Stub shape examples:**

```ts
// classlite-web/src/hooks/useAuth.ts (stub)
/**
 * useAuth — app-wide auth state.
 *
 * Story 1-7c ships this as a stub that returns "no session." Story 1-8
 * REPLACES the body with a `useQuery(authKeys.me, fetchMe)` call backed by
 * `GET /api/auth/me`. The stub returns the exact shape the real hook will
 * return, so consumers compile against it today and need no changes when
 * the body lands.
 *
 * Do NOT add a fake user object to the stub — components that branch on
 * `isAuthenticated` would silently render the authenticated-only branch
 * during the stub window and the regression would be invisible.
 */
export interface User {
  id: string
  email: string
  displayName: string
  // Fill out as Story 1-8 lands; this is the minimum-viable shape.
}

export interface UseAuthResult {
  user: User | null
  isAuthenticated: boolean
  isLoading: boolean
}

export function useAuth(): UseAuthResult {
  return { user: null, isAuthenticated: false, isLoading: false }
}
```

```ts
// classlite-web/src/hooks/usePolling.ts (stub — real implementation)
import { useEffect, useRef, useState } from 'react'

export interface UsePollingOpts {
  /** Async function to invoke on each tick. */
  fn: () => Promise<unknown>
  /** Interval between calls in ms. */
  intervalMs: number
  /** Toggle without unmounting. Defaults to true. */
  enabled?: boolean
}

export interface UsePollingResult {
  isPolling: boolean
}

/**
 * usePolling — debounce-aware interval hook with cleanup.
 *
 * First consumer: Story 1-9a's email verification poller (UX-DR9 — polls
 * /api/auth/verify-status every 5s for up to 10 minutes). usePolling does
 * NOT enforce the 10-min cap — that's the consumer's responsibility via
 * `enabled=false` once the cap is reached.
 *
 * Why this exists today instead of inlining the interval at the call site:
 * three Epic 1C-and-later stories need polling with cleanup (1-9a verify,
 * Epic 9 billing-grace countdown, Epic 10 inbox unread badge). Centralizing
 * the cleanup discipline prevents three near-identical buggy useEffects.
 */
export function usePolling({
  fn,
  intervalMs,
  enabled = true,
}: UsePollingOpts): UsePollingResult {
  const [isPolling, setIsPolling] = useState(false)
  const fnRef = useRef(fn)
  fnRef.current = fn

  useEffect(() => {
    if (!enabled) {
      setIsPolling(false)
      return
    }
    setIsPolling(true)
    const id = setInterval(() => {
      void fnRef.current()
    }, intervalMs)
    return () => {
      clearInterval(id)
      setIsPolling(false)
    }
  }, [enabled, intervalMs])

  return { isPolling }
}
```

**And** each stub has a smoke test in `classlite-web/src/hooks/__tests__/<hook>.test.tsx`:
- `useAuth.test.tsx`: returns `{ user: null, isAuthenticated: false, isLoading: false }`.
- `useCurrentCenter.test.tsx`: returns `null`.
- `useRole.test.tsx`: returns `null`.
- `usePolling.test.tsx`: real behavioral test — `enabled=true` triggers the function once per `intervalMs`; `enabled=false` stops; unmount clears the interval (use `vi.useFakeTimers()` + `act()`).

## Tasks / Subtasks

> Tasks are sequenced for the ATDD red-first discipline R38 mandates: write the parity-coverage test + lang-cookie test + bilingual smoke spec FIRST against empty stubs, watch them go red, then drive green via implementation. Component tests (axe + i18n + behavior) ship co-located alongside their components per the project's established rhythm from 1-7a / 1-7b.

- [x] **Task 1: i18n key seeding + parity-coverage ATDD red specimen** (AC: #1)
  - [x] 1.1 Write `classlite-web/src/lib/test/__tests__/i18n-parity-coverage.test.ts` per AC1 with the full STORY_1_7C_KEYS list. Run `npm test` — confirm it is RED against the existing thin locale files. _(scaffold landed by `/bmad-tea AT` 2026-06-11; activated this task)_
  - [x] 1.2 Add every key to `classlite-web/src/locales/en.json` with English values. Verify the file is valid JSON (no trailing comma).
  - [x] 1.3 Add every key to `classlite-web/src/locales/vi.json` with Vietnamese values. **Reviewer-quality note:** seed with machine translation (Google Translate / Gemini) ONLY for the auth.* and app.layout.* keys; the app.errorBoundary.*, app.permissionDenied.*, app.notFound.* values MUST be reviewed by a Vietnamese-fluent reviewer before the PR can merge — these are the user-facing failure-recovery strings, where a translation glitch is most damaging. Document in the Change Log which keys received reviewer revision. _(seeded by dev; PR description flags Vietnamese review)_
  - [x] 1.4 Run `npm test -- i18n-parity-coverage` — confirm GREEN.
  - [x] 1.5 Run `npm run i18n-parity` — confirm GREEN (37 keys present in both en, vi).
  - [x] 1.6 Delete the legacy `app.errorFallback` key from BOTH locale files. Verify nothing else references it (`rg "app.errorFallback" classlite-web/`) — the 1-7b `RootErrorBoundary.test.tsx` references it and that test will be deleted in Task 3.

- [x] **Task 2: AppLayout + Sidebar + TopBar + UserPill shells** (AC: #2)
  - [x] 2.1 Create `src/components/shared/Sidebar.tsx` — non-variant placeholder. Navy sidebar (`--cl-sidebar-bg`), brand wordmark + amber dot, single placeholder nav item, `<UserPill />` at foot. Off-canvas-collapse via `useUIStore.sidebarCollapsed` on mobile.
  - [x] 2.2 Create `src/components/shared/TopBar.tsx` — 56px height. `<nav aria-label="Breadcrumb">` slot left, SearchPill (visual ⌘K chip) + `<LanguageToggle />` right.
  - [x] 2.3 Create `src/components/shared/UserPill.tsx` — reads `useAuth()` + `useRole()`. Today returns null → renders "Sign in" link. Future-Story-1-8 fills the conditional with avatar + name + role label.
  - [x] 2.4 Create `src/components/shared/LanguageToggle.tsx` per AC6 — two `<button aria-pressed>` segments calling `useLanguageStore.setLanguage`.
  - [x] 2.5 Create `src/components/shared/AppLayout.tsx` — composes Sidebar + TopBar + skip-to-content `<a href="#main-content">` (first focusable) + `<main id="main-content" role="main" tabIndex={-1}>` hosting `<Outlet />`.
  - [x] 2.6 Write `src/components/shared/__tests__/AppLayout.test.tsx` (4 tests — composition, skip-link, i18n parity, axe). All GREEN.
  - [x] 2.7 Write `src/components/shared/__tests__/LanguageToggle.test.tsx` (7 tests — segments, aria-pressed sync, click mutates store, i18n parity, axe). All GREEN.

- [x] **Task 3: ErrorBoundary — polished replacement of 1-7b's RootErrorBoundary** (AC: #3)
  - [x] 3.1 Create `src/components/shared/ErrorBoundary.tsx` per AC3 — class component, Sentry captureException returns event ID, render fallback with title + body + event-ID monospace + retry CTA + home link. Uses existing `Button` from `components/ui/button`.
  - [x] 3.2 Update `src/App.tsx` — swap `RootErrorBoundary` → `ErrorBoundary` import + wrapper, ALSO add `useLanguageInit()` mount per AC6.
  - [x] 3.3 Delete `src/components/shared/RootErrorBoundary.tsx` AND `__tests__/RootErrorBoundary.test.tsx`.
  - [x] 3.4 Write `src/components/shared/__tests__/ErrorBoundary.test.tsx` — 7 tests (capture-error, event-id render, retry-recovers-on-rerender, no-error pass-through, i18n parity for new keys, legacy `app.errorFallback` is gone, axe-core). All GREEN.
  - [x] 3.5 `npx tsc -b` clean.

- [x] **Task 4: PermissionDenied + lazy route + tests** (AC: #4)
  - [x] 4.1 Create `src/components/shared/PermissionDenied.tsx` — two body-copy variants gated on `requiredRoles` (`['owner', 'admin']` vs `['owner']`).
  - [x] 4.2 Append `/permission-denied` lazy route to `src/routes.tsx` (default render = Owner+Admin variant).
  - [x] 4.3 Write `PermissionDenied.test.tsx` — 5 tests (Owner+Admin copy, Owner-only copy, 3 CTAs, i18n parity, axe). All GREEN.

- [x] **Task 5: NotFound + catch-all route + tests** (AC: #5)
  - [x] 5.1 Create `src/components/shared/NotFound.tsx`.
  - [x] 5.2 Append `{ path: '*', lazy: ... }` to `routes.tsx` as the LAST entry of `baseRoutes`.
  - [x] 5.3 Write `NotFound.test.tsx` — 4 tests (title+body+link, main landmark, i18n parity, axe). All GREEN.

- [x] **Task 6: Language cookie bridge — `lib/language-cookie.ts` + `hooks/useLanguageInit.ts` + i18n.ts rewire + App.tsx hook mount** (AC: #6)
  - [x] 6.1 Create `src/lib/language-cookie.ts` — `readLanguageCookie`, `writeLanguageCookie`, `languageCookieDomain` + `Language` type. `Domain` resolves `.classlite.app` / `.classlite.localhost` / null per host.
  - [x] 6.2 Update `src/lib/i18n.ts` — `lng: readLanguageCookie() ?? 'en'` (synchronous cookie read at module-load).
  - [x] 6.3 Create `src/hooks/useLanguageInit.ts` — seeds store on first mount via cookie + `Ref`-guarded; subscribes to subsequent `setLanguage` mutations → writes cookie + `i18n.changeLanguage`.
  - [x] 6.4 Update `src/App.tsx` — call `useLanguageInit()` at top of component (before JSX return).
  - [x] 6.5 Write `src/lib/__tests__/language-cookie.test.ts` — 11 tests (read null/round-trip/garbage/multi-cookie, domain for 5 hosts, write attributes).
  - [x] 6.6 Write `src/hooks/__tests__/useLanguageInit.test.tsx` — 3 tests (seed from cookie, no-cookie fallback, subscribe-and-flip).

- [x] **Task 7: vitest-axe + axe-core devDeps + setup wiring** (AC: #7)
  - [x] 7.1 `npm install --save-dev vitest-axe@latest axe-core@^4.10.0 @axe-core/playwright@^4.10.0`. _(landed during `/bmad-tea AT` ATDD red phase)_
  - [x] 7.2 Update `src/test/vitest-setup.ts` — `expect.extend(matchers)` from `vitest-axe/matchers` manually (the package's `extend-expect.js` is empty in 0.1.0 — known package bug worked around). Add `afterEach(cleanup)` from `@testing-library/react` because Vitest `globals: false` doesn't auto-register RTL cleanup.
  - [x] 7.3 Create `classlite-web/axe.allowlist.json` with `{ "rules": [] }` governance stub.
  - [x] 7.4 Every component test from Tasks 2–5 includes one `vitest-axe` assertion. ✅

- [x] **Task 8: Stub hooks — useAuth / useCurrentCenter / useRole / usePolling** (AC: #10)
  - [x] 8.1 Create `src/hooks/useAuth.ts`, `src/hooks/useCurrentCenter.ts`, `src/hooks/useRole.ts` — each returns the canned no-session shape with `User` / `Center` / `Role` types exported.
  - [x] 8.2 Create `src/hooks/usePolling.ts` — real implementation with `useEffect`-driven interval, ref-captured latest fn (no stale-closure bug), interval cleanup on unmount AND on enabled-flip.
  - [x] 8.3 Write tests — useAuth 2, useCurrentCenter 1, useRole 1, usePolling 5 (tick cadence, disabled stops, unmount cleanup, enabled-flip stops, latest-fn closure). All 9 GREEN.

- [x] **Task 9: Playwright bilingual smoke + cross-subdomain `dashboard-boots-in-vi`** (AC: #8)
  - [x] 9.1 `e2e/bilingual-smoke.spec.ts` activated (un-skipped). Required two surrounding changes: (a) `LoginPagePlaceholder.tsx` rewired to render `t('auth.login.title')` instead of `t('app.welcome')` so the `/login` H1 assertion satisfies; (b) `routes.tsx` wraps `/dashboard` + `/student` in `<AppLayout>` via a pathless lazy layout route so the skip-to-content link is reachable on `/dashboard`. Added `waitFor({ state: 'attached' })` on the skip link before the Tab keypress (lazy chunk timing). **10/10 GREEN** (5 tests × 2 locales).
  - [x] 9.2 `tests/e2e/cross-subdomain/dashboard-boots-in-vi.spec.ts` activated. Uses existing `cross-subdomain` Playwright project's `storageState`; the cookie override lands at `.classlite.localhost`. **2/2 GREEN** (+ 1 setup).
  - [x] 9.3 Existing 1-7a + 1-7b specs continue to pass — verified by the full design-system + cross-subdomain runs.
  - [x] 9.4 `tests/e2e/cross-subdomain/cookie-sharing.spec.ts` continues to pass — verified by the cross-subdomain run.

- [x] **Task 10: CI wiring — `npm run i18n-parity` gates merge** (AC: #9)
  - [x] 10.1 `ci-web.yml` already exists from Story 1.7a. Appended `i18n parity (Story 1.7c AC9 — R38 mitigation)` step BETWEEN `Test` and `Build` so a missing-key failure stops the pipeline before wasting time on a build.
  - [x] 10.2 Force-fail dry-run performed locally: deleted `app.notFound.body` from `vi.json`, ran `npm run i18n-parity` → exit 1 with diff report (`Keys in en.json missing from vi.json (1): - app.notFound.body`). Restored vi.json; final run reports `OK — 37 keys present in both en, vi`.
  - [x] 10.3 PR description to flag the new `i18n parity` step for the human reviewer to add as a required status check in GitHub repo settings.

- [x] **Task 11: Verification + DoD**
  - [x] 11.1 `npm run dev` boots; smoke-eyeballing via Playwright covers `/`, `/login`, `/dashboard`, `/student`, `/permission-denied`, catch-all, `/__theme-resolution`, `/__multi-tab-test-bait`.
  - [x] 11.2 `npm test`. **149/149 passed across 25 test files** (was 100/100 in 1-7b baseline; +49 new tests).
  - [x] 11.3 `npm run lint` + `npm run lint:css`. Both clean.
  - [x] 11.4 `npx tsc -b`. Exit 0.
  - [x] 11.5 `npm run i18n-parity`. `OK — 37 keys present in both en, vi`.
  - [x] 11.6 `npm run build`. Success. Lazy chunks emitted: `AuthLayout`, `LoginPagePlaceholder`, `StudentDashboard`, `TeacherDashboard` (1-7b set) plus `AppLayout`, `PermissionDenied`, `NotFound` (1-7c set).
  - [x] 11.7 Dev-route grep gates exit 1 for ALL of `__theme-resolution` / `__multi-tab-test-bait` / `ThemeResolutionPage` / `MultiTabTestPage` (1-7b regression guards hold).
  - [x] 11.8 `bash scripts/sync-tokens.sh && git diff --exit-code -- classlite-landing/src/styles/tokens.css`. Exit 0 — 1-7a parity guard still passes.
  - [x] 11.9 `npx playwright test --project=design-system`. **23/23 passing** (was 13/13 in 1-7b → +10 from bilingual-smoke).
  - [x] 11.10 `npx playwright test --project=cross-subdomain`. **6/6 passing** (was 4/4 → +2 from dashboard-boots-in-vi).
  - [x] 11.11 Force-fail dry-run of `npm run i18n-parity` performed: removed `app.notFound.body` from `vi.json`, script exits 1 with diff report; restored vi.json; final run reports OK 37 keys.
  - [ ] 11.12 _(deferred-to-reviewer)_ Manual cross-domain DevTools observation: set `lang=vi` cookie at `.classlite.localhost` via DevTools, navigate `http://my.classlite.localhost:5173/dashboard`, observe H1 in Vietnamese. Playwright `dashboard-boots-in-vi.spec.ts` covers this headlessly; manual check is defense-in-depth.

### Review Findings (2026-06-12)

_Code review across three parallel layers (Blind Hunter, Edge Case Hunter, Acceptance Auditor). Severity ordered. `decision-needed` items must be resolved before `patch` items._

**Decisions resolved (5)** — all five promoted to patch:

- [x] [Review][Decision→Patch] D1 PermissionDenied tertiary CTA — **Ship now.** Add `app.permissionDenied.requiredRoleSummary` to en/vi.json with role-list copy, render as deemphasized `<p role="note">` below the button row, update `PermissionDenied.test.tsx` to assert it semantically (and drop the heading-as-CTA assertion).
- [x] [Review][Decision→Patch] D2 Sidebar duplicate aria-label — **Add new nav key.** Add `app.layout.sidebar.nav.aria` = "Primary navigation" / "Điều hướng chính" in both locales; use on inner `<nav>`; keep brand on `<aside>`. Update parity-coverage test + `AppLayout.test.tsx` semantic queries if needed.
- [x] [Review][Decision→Patch] D3 Mobile hamburger toggle — **Ship now.** Add `<button>` in TopBar (or Sidebar header) with `aria-label={t('app.layout.sidebar.collapseToggle')}` that calls `useUIStore.getState().setSidebarCollapsed(!sidebarCollapsed)`. Visible at `md:hidden` only. Add click-test in AppLayout.test.tsx.
- [x] [Review][Decision→Patch] D4 Multi-tab language sync — **Add BroadcastChannel listener.** In `useLanguageInit.ts`, subscribe to `BroadcastChannel('lang')` inside the effect; on remote message, call `useLanguageStore.setState({language})` WITHOUT re-writing the cookie. The store subscriber's local writes also `postMessage` to the channel so other tabs receive them. Add a test that simulates a remote message and asserts the store updates without a cookie rewrite.
- [x] [Review][Decision→Patch] D5 Per-route errorElement — **Add root errorElement.** Add a single root `errorElement` at the top of `baseRoutes` in `routes.tsx` that renders an `ErrorBoundary`-style fallback (title + body + retry via `window.location.reload()` + home link). Localized via existing `app.errorBoundary.*` keys.

**Patch (14 original + 5 from decisions = 19 total)** — unambiguous fixes:

- [x] [Review][Patch] Component tests hardcode English (TEST-FE-4 violation) — `PermissionDenied.test.tsx:18,21,27,29`, `NotFound.test.tsx:15,17,18`, `ErrorBoundary.test.tsx:42,43,68,100`, `tests/e2e/cross-subdomain/dashboard-boots-in-vi.spec.ts:101`. Replace with `i18n.t(...)` resolution or import from locale JSON (same pattern as `e2e/bilingual-smoke.spec.ts`).
- [x] [Review][Patch] TopBar `aria-label="Breadcrumb"` hardcoded + empty nav landmark [`classlite-web/src/components/shared/TopBar.tsx:20`] — neither i18n'd nor populated. Either add `app.layout.topbar.breadcrumb` key and conditionally render `<nav>` only when children exist, or drop the empty `<nav>` until breadcrumb items land.
- [x] [Review][Patch] LanguageToggle `<fieldset>` without `<legend>` [`classlite-web/src/components/shared/LanguageToggle.tsx:25-53`] — spec said hand-rolled `<button>` pair (radio-group-shaped). Replace `<fieldset aria-label>` with `<div role="group" aria-label>` (or `role="radiogroup"`), keeping the buttons with their `aria-pressed` semantics intact.
- [x] [Review][Patch] `useLanguageInit` swallows `i18n.changeLanguage` rejections [`classlite-web/src/hooks/useLanguageInit.ts:45,51`] — `void` discards a rejection which fires `unhandledrejection` on `window`. Replace `void i18n.changeLanguage(lng)` with `.catch((err) => Sentry.captureException(err))`.
- [x] [Review][Patch] `usePolling` no guard on intervalMs; rejected fn() swallowed [`classlite-web/src/hooks/usePolling.ts:54-56`] — `intervalMs=0/NaN/Infinity` is currently a silent footgun; `fnRef.current()` rejections go to `unhandledrejection`. Add `Number.isFinite(intervalMs) && intervalMs > 0` guard + `.catch((err) => Sentry.captureException(err))` inside the interval callback.
- [x] [Review][Patch] `i18n-parity.mjs` doesn't reject empty-string leaves [`classlite-web/scripts/i18n-parity.mjs:33-44`] — R38's failure mode includes `"app.x": ""` shipping blank UI. Track empty leaves separately during `flatten()` and `exit(1)` with a labeled "empty values" report.
- [x] [Review][Patch] CI `i18n parity` step runs after `Test` [`.github/workflows/ci-web.yml:69-76`] — drift currently surfaces as confusing test failures first. Move the i18n-parity step above the Test step for fast-fail.
- [x] [Review][Patch] `routes.tsx` catch-all comment misstates RR v7 ranking [`classlite-web/src/routes.tsx:108-114`] — comment claims declaration order matters; RR v7 ranks by specificity. Either fix the comment to mention specificity, or move the dev routes BEFORE the catch-all to be ordering-correct as well as specificity-correct.
- [x] [Review][Patch] Sidebar collapse/expand className duplicated [`classlite-web/src/components/shared/Sidebar.tsx:28-32`] — ~150 char string repeated with one prefix diff. Refactor to a base class + conditional `-translate-x-full` so future Tailwind updates only need one edit.
- [x] [Review][Patch] `sprint-status.yaml` duplicate `# previous_update_-1` comment [`_bmad-output/implementation-artifacts/sprint-status.yaml:3-7`] — renumber the history (top entry is `last_updated`, then `previous_update_-1`, `-2`, `-3`, …) so the convention isn't corrupted.
- [x] [Review][Patch] `vitest-setup.ts` uses `import * as axeMatchers` then `expect.extend(axeMatchers)` [`classlite-web/src/test/vitest-setup.ts:16,26`] — passes the entire module namespace including any non-matcher exports. Switch to explicit destructure: `import { toHaveNoViolations } from 'vitest-axe/matchers'; expect.extend({ toHaveNoViolations })`.
- [x] [Review][Patch] Tests use `setState({...initialState})` instead of `.reset()` action (project-context TEST-FE-3 amendment from 1-7b) — `AppLayout.test.tsx:38-39`, `LanguageToggle.test.tsx:17,37,54`, `useLanguageInit.test.tsx:43` (and any other `beforeEach` resetting stores). Replace with `useUIStore.getState().reset()` / `useLanguageStore.getState().reset()`. Mid-test mutations like `setState({ language: 'vi' })` should become `getState().setLanguage('vi')` so the test exercises the public action.
- [x] [Review][Patch] AppLayout Test 4 doesn't exercise Tab keypress [`classlite-web/src/components/shared/__tests__/AppLayout.test.tsx:52-66`] — Spec AC2 Test 4 says "First-tab focus lands on the skip-to-content link; pressing Enter focuses `<main>`". Current implementation only verifies DOM order. Add `userEvent.tab()` + `expect(document.activeElement).toBe(skipLink)`, then simulate Enter and assert `<main>` receives focus.
- [x] [Review][Patch] PermissionDenied "Message Owner" button missing JSDoc explaining no-op [`classlite-web/src/components/shared/PermissionDenied.tsx:52-54`] — Spec AC4 line 382 explicitly required flagging this as no-op-until-Epic-10-Story-10-1 in the JSDoc. Add an inline comment so future agents don't read it as a bug.

**Deferred (7)** — pre-existing, downstream-owned, or out-of-scope for 1-7c:

- [x] [Review][Defer] `sectionName?` prop on `PermissionDeniedProps` [`classlite-web/src/components/shared/PermissionDenied.tsx:27-29`] — deferred, Story 2-6 (router-level role gating) will pass it.
- [x] [Review][Defer] Sidebar nav anchor uses `t('app.welcome')` as placeholder link text [`classlite-web/src/components/shared/Sidebar.tsx:51`] — deferred, Epic 1D Story 1d-3 ships the role-aware nav set.
- [x] [Review][Defer] `app.layout.userPill.signOut` i18n key orphan — deferred, UserPill dropdown lands when `useAuth()` is real (Story 1-8 + downstream session-expired flow).
- [x] [Review][Defer] `language-cookie.ts` doesn't expire prior host-scoped duplicates on subdomain migration [`classlite-web/src/lib/language-cookie.ts:66-77`] — deferred, edge case for a one-time `.localhost` → `.classlite.localhost` shift; revisit if observed.
- [x] [Review][Defer] UserPill blank initials on empty/whitespace `displayName`; undefined-role render path [`classlite-web/src/components/shared/UserPill.tsx:37-58`] — deferred, harden when Story 1-8 wires real `useAuth()` and the data shape is known.
- [x] [Review][Defer] `vitest-setup.ts` doesn't reset `document.cookie` between tests [`classlite-web/src/test/vitest-setup.ts:33-38`] — deferred, current cookie-writing tests clean up locally; add global reset if leakage is observed.
- [x] [Review][Defer] `dashboard-boots-in-vi.spec.ts` `clearCookies({name}).catch(() => {})` swallows real errors [`classlite-web/tests/e2e/cross-subdomain/dashboard-boots-in-vi.spec.ts:88-94`] — deferred, defensive shim is harmless on Playwright 1.50; revisit when bumping or removing version skew.

**Dismissed (7)** — false positives / matches-spec / handled-by-comment:

- Blind Hunter claim that Sidebar collapse "has no desktop effect" — actually intentional per AC2 (mobile-only off-canvas + desktop stays full); no defect.
- Blind Hunter claim that `routes.tsx` inline `Component: () => <PermissionDenied requiredRoles={...} />` recreates each render — matches spec line 399 verbatim; consider exporting later if Sentry stack traces degrade.
- Blind Hunter claim that the `app.errorFallback`-removed guard test is "a hidden gotcha" — intentional regression guard per spec.
- Auditor claim that AppLayout Test 5 (lang-toggle click) is missing — covered in `LanguageToggle.test.tsx:47-58` with cleaner unit boundaries.
- App.tsx LSP diagnostic about `@/hooks/useLanguageInit` missing — stale; the file exists in untracked `src/hooks/` and resolves correctly at build time.
- `usePolling` `react-hooks/set-state-in-effect` suppression — justified by JSDoc as the observable signal for consumers; not masking a defect.
- Bilingual-smoke regex requiring 3+ dot segments — matches spec line 758 literally; no real coverage gap for 1-7c's keys.

## Dev Notes

### Developer Context — read this section before writing any code

**The R38 ATDD trap.** WF-8 says any story whose ACs map to a risk score ≥6 MUST have ATDD red tests on the branch BEFORE transitioning to in-progress. This story's R38 mapping is concrete and named: missing key in `vi.json` → Vietnamese user sees raw `auth.login.submit` → R38 fires. The mitigation has FOUR layers and you implement them in this story:

1. **`assertI18nParity` helper** (`src/lib/test/i18n-parity.ts`) — already shipped in 1-7b. Used in every component test.
2. **`i18n-parity-coverage.test.ts`** — NEW in 1-7c. Asserts EVERY new key exists in both locales. This is the ATDD red specimen — write it FIRST, watch it fail against the empty stubs, then add the keys to make it green.
3. **`npm run i18n-parity` CI step** — script already exists from 1-7b; this story wires it into `ci-web.yml` so a key drift on a PR fails the build.
4. **Playwright bilingual-smoke spec** — NEW in 1-7c. Walks public routes in BOTH locales, asserts no raw dotted-key strings appear in the DOM.

If any layer is missing, the regression is invisible. With all four, a Vietnamese user CANNOT receive a raw key in production — the parity-coverage test catches it at unit level, the CI step catches it at PR level, the bilingual smoke catches it at integration level, and any per-component test that calls `t()` is forced to declare its keys to `assertI18nParity` which catches drifted keys at component level.

**The cross-domain handoff (UX-DR17) is half-finished here on purpose.** This story owns the DASHBOARD half of UX-DR17 (read the `lang` cookie on boot, use it as initial language, write it back when the user toggles). Story 1.10 owns the LANDING half (the landing page's language toggle writes the `.classlite.app` cookie that this story reads). Until 1.10 ships, the cross-domain Playwright test for `classlite.app → my.classlite.app` navigation cannot exist — there's no landing page to navigate FROM. What 1.7c DOES test: with a `lang=vi` cookie pre-set at `.classlite.localhost` (via the existing Phase 0.4 storageState fixture), the dashboard's initial render uses Vietnamese. This is the dashboard's half of the contract, fully proved.

**Why three places read `lang` cookie / call `i18n.changeLanguage`.** It might look weird that `lib/i18n.ts` reads the cookie at module-load AND `useLanguageInit()` reads it again on mount. The reason is hydration timing:
- `lib/i18n.ts` runs synchronously when its first import is evaluated, BEFORE `<App />` even mounts. The `lng: readLanguageCookie() ?? 'en'` ensures the first render's `t('...')` calls resolve in the right language — without it, the very first paint flickers from `en` to `vi`.
- `useLanguageInit()` runs after mount in a `useEffect`. It seeds the Zustand store (which the toggle reads to know which segment is `aria-pressed`). It also subscribes to the store so subsequent `setLanguage(...)` calls trigger the cookie write + `i18n.changeLanguage(...)` side effects.

The two reads ARE redundant on first render — that's intentional. The second read is the safety net if the first read's cookie value is missing (e.g., user just cleared cookies in DevTools mid-session).

**The skip-to-content link is load-bearing for WCAG 2.4.1.** It's the single hardest-to-explain a11y assertion in the spec — every page must have a way for keyboard users to skip past the navigation. Implement it in `AppLayout` as the FIRST DOM element inside `<body>` and verify the Playwright spec's keyboard-Tab assertion catches regressions.

**`useEffect` permission for `useLanguageInit`.** Project-context FW-4 BANS `useEffect` for server-state concerns and most cases. BUT it explicitly permits: DOM imperative operations, third-party library integration, subscription cleanup. `useLanguageInit` is THIRD-PARTY LIBRARY INTEGRATION (react-i18next + Zustand subscribe) — legitimately permitted. Document this in the JSDoc so a future agent reviewing the file knows it's not a violation.

**Decisions that are already made (do not relitigate):**
- The polished `ErrorBoundary` REPLACES the minimal `RootErrorBoundary` from 1-7b. Both files cannot coexist — delete the old one (Task 3.3).
- The `path: '*'` catch-all goes at the END of `baseRoutes` in `routes.tsx`. NOT before the DEV-only routes (they wouldn't match in dev), NOT after them (Rolldown still folds the dev conditional; the order inside the prod array matters).
- The language toggle is a hand-rolled `<button>` pair with `aria-pressed`. NOT a `radio-group`, NOT a shadcn `Toggle`. Adding shadcn primitives is Epic 1D Story 1d-2.
- The `Sidebar` / `TopBar` / `UserPill` are NON-ROLE-VARIANT placeholders. Role-aware nav sets land in Epic 1D Story 1d-3. Do NOT branch on role inside 1-7c's shell components beyond passing `requiredRoles` to `PermissionDenied`.
- The stub hooks return null / no-session shapes. Do NOT add fake data to make screens look prettier — the screens DON'T render anything user-facing today (they're placeholders), and fake data would mask the regression when 1-8 fills the hook for real.
- No new shadcn primitives. The existing `Button` (`components/ui/button.tsx` from 1-7a) is sufficient.

**Decisions you are making in this story (document in the Change Log):**
- The Vietnamese values for `app.errorBoundary.*`, `app.permissionDenied.*`, `app.notFound.*` keys — confirm a Vietnamese-fluent reviewer signed off OR ship them flagged for revision.
- Whether `ci-web.yml` is newly created or extended (depends on whether the file exists today — check first).
- Whether the Playwright `e2e` CI job is added alongside the `verify` job in this PR or deferred to a follow-up.

### Architecture compliance

**Project-context rules this story discharges or relies on:**
- **FW-4** (useEffect banned for server-state concerns): the SOLE `useEffect` in 1-7c (in `useLanguageInit`) is subscription cleanup — the rule's documented exception. Annotated in the JSDoc.
- **FW-5** (Zustand stores isolated): the language cookie side-effect lives in `lib/language-cookie.ts` + `hooks/useLanguageInit.ts`, NOT in `languageStore` itself. The store stays pure (FW-5 + the 1-7b decision recorded in `languageStore.ts`'s JSDoc).
- **FW-6** (never trigger Query invalidation from Zustand): not directly applicable (language toggle doesn't invalidate queries), but reaffirmed for downstream consumers.
- **FW-7** (component placement three tiers): `AppLayout`, `ErrorBoundary`, `PermissionDenied`, `NotFound`, `LanguageToggle`, `Sidebar`, `TopBar`, `UserPill` all live in `components/shared/`. No `components/ui/` files touched (R41 + FW-7 preserved end-to-end). No `components/domain/` files yet — those are 1d-3.
- **TS-5** (401 handling lives in the fetch layer): the `ErrorBoundary` does NOT catch 401s (those flow through the `apiFetch` → `auth-refresh` → `/login` path from 1-7b). Document this in the boundary's JSDoc.
- **TS-6** (dates stay as ISO strings until i18n formatter): the formatter is `react-i18next`'s built-in `t('date', { val: ... })` interpolation. NOT applicable to layout shells but reaffirmed for downstream consumers.
- **TEST-FE-1** (MSW is the only mock seam): none of the new tests need MSW (no server calls). Reuse the 1-7b `src/test/msw-server.ts` if any future test needs the seam.
- **TEST-FE-2** (Loading / Empty / Error trilogy mandatory): not applicable in 1-7c (the layout shells don't fetch data) but reaffirmed for Story 1-8 onwards.
- **TEST-FE-3** (Zustand stores reset between tests): `languageStore.reset()` (1-7b shipped) is called in any test that mutates language state.
- **TEST-FE-4** (test key resolution, never hardcode English): every test in this story resolves visible strings via `t()` or via the locale JSON import (e.g., `enLocale['auth.login.title']`). NO hardcoded "Sign in" assertions.
- **TEST-FE-5** (axe-core + role queries, not aria-label grep): every test uses `getByRole(...)` + `vitest-axe`. NO `getByLabelText` as the primary query.
- **TEST-FE-6** (role-based rendering — test what's absent): 1-7c's role-aware surface is the `PermissionDenied` body-copy variant — tested for the two visible variants. Future Story 2-6 adds role-negative tests at the route layer.
- **UX-1** (Loading / Empty / Error trilogy): not applicable here but reaffirmed.
- **UX-2** (i18n Vietnamese is co-primary): the core focus of this story — every key in both locales, every test asserts parity.
- **UX-3** (role-based rendering — separate components, not conditional branches): `PermissionDenied` accepts a `requiredRoles` PROP and renders one of two body variants. The variants are EXPLICIT TWO cases, NOT a hash map keyed by role string — that's TWO components in disguise per UX-3 even though the code shares a wrapper.
- **CQ-1** (dead code is rejected): `RootErrorBoundary.tsx` + its test file + the `app.errorFallback` i18n key are DELETED. Nothing left behind.
- **CQ-3** (no magic values): cookie name `'lang'`, max-age `60*60*24*365`, the locale codes `'en'` and `'vi'` are named constants at the top of `lib/language-cookie.ts`.

**Risks this story OWNS (with score ≥6):**
- **R38 (i18n parity, score 3×2=6)** — the four-layer mitigation outlined in "Developer Context" above. AC1 (parity-coverage test) + AC8 (bilingual smoke) + AC9 (CI guard) + ASSERT-I18N-PARITY in every component test. If any layer is missing, the story does NOT pass gate review.

**Risks this story does NOT own:**
- **R39 (Vite/Rolldown plugin):** the new `axe-core` + `@axe-core/playwright` devDeps are not Vite plugins — they don't risk Rolldown breakage. If `vitest-axe` somehow breaks Vitest module resolution under Rolldown, escalate per the 1-7a "early signal" pattern (do not absorb locally).
- **R41 (shadcn hand-edits, score <6):** no `components/ui/` files touched.
- **R45 (CF cache wrong origin, OPS):** the `Vary: Origin` invariant is the Go API's responsibility. The cross-subdomain spec incidentally exercises it but does not OWN it.
- **R46 (cross-cutting CI guard, score 6):** AC9 contributes ONE CI step. The broader DevOps cross-cutting bucket owns the rest (secret scanner, OpenAPI spec-diff, atomic-PR enforcement).

### Architecture references

- **Architecture lines 76–80 — three deployable surfaces:** `classlite.app` (Astro landing), `my.classlite.app` (React dashboard — this story's surface), `api.classlite.app` (Go API). Auth + language cookies scoped to `.classlite.app` so they cross both subdomains.
- **Architecture lines 165–170 — Cookie + CORS:** auth cookies and language preference share the `.classlite.app` Domain. SameSite=Lax. AC6 implements the language cookie half of this.
- **Architecture lines 187–188 — Frontend state + routing:** TanStack Query + Zustand + React Router v7. AC3/AC4/AC5 add routes; AC6 adds a Zustand subscription bridge.
- **Architecture lines 250–260 — Frontend Architecture:** the canonical state-ownership boundary. Language state lives in Zustand; the cookie sync is a subscription side effect outside the store.
- **Architecture lines 437–442 — Auth Token Lifecycle:** the 401 silent-refresh sequence from 1-7b. `ErrorBoundary` does NOT touch this path; document it.
- **Architecture lines 489–501 — Frontend Error Display + Error Boundaries:** AC3 implements the polished top-level boundary; AC4 + AC5 implement the role-gate and not-found screens. The "Loading / Empty / Error trilogy" rule applies only to data-fetching components — none here.
- **Architecture lines 519–521 — Request ID propagation:** the Sentry event ID rendered by `ErrorBoundary` joins with the `tags.requestId` from 1-7b's apiFetch breadcrumb. A support session can quote one OR the other and an engineer can find the matching event in Sentry + the matching log line in the Go API.
- **Architecture lines 597–598 — UX Spec §10.4 (returning login):** mentions the silent-refresh + multi-tab navigator.locks sequence (1-7b's surface). The "stale hint cookie loop broken via session_expired redirect" is Story 1.10's surface.
- **Architecture lines 736–903 — Complete classlite-web/ tree:** authoritative project tree. `components/shared/` lives at line 862–871; `hooks/` lives at line 880–884; `locales/` lives at line 896–898.
- **Epic 1C scope (`_bmad-output/planning-artifacts/epics/epic-01c-frontend-landing.md`) lines 133–186:** the canonical Story 1.7c ACs that this file expands. The 1.7c ACs in the epic file are the source-of-truth contract; this story is the long-form dev-ready version.
- **Project-context (`docs/project-context.md`) FW-4, FW-5, FW-6, FW-7, TS-5, TS-6, TEST-FE-1 through TEST-FE-6, UX-1, UX-2, UX-3, CQ-1, CQ-3:** every code-level decision in this story traces to one of these.
- **TEA handoff (`_bmad-output/test-artifacts/test-design/classlite_new-handoff.md`) lines 40, 56, 59, 113–117, 162:** Epic 1C gate criteria + R38 ownership.
- **TEA test-design-qa (`_bmad-output/test-artifacts/test-design/test-design-qa.md`) lines 165, 256–257, 299:** R38 test scenarios + i18n parity CI step + bilingual visual regression coverage.
- **UX spec (`_bmad-output/planning-artifacts/ux-design-specification.md`) §4.2 lines 132–143:** the canonical App Shell layout (sidebar + topbar shape, brand mark, user pill placement).
- **UX spec §4.3 lines 145–151:** role-level protection at the router + permission-denied as orientation (not bare 403) → AC4's contract.
- **UX spec §6.4 line 391:** "Permission denied (`s67`): reframed as orientation — names what's behind the boundary *and who can grant access*." → AC4's body-copy variants.
- **UX spec §10.4 line 587:** silent refresh failure flow — preserves target URL, in-progress work via autosave. The session-expired redirect handling is 1-7b's surface; the `ErrorBoundary` only handles render-time errors, not auth failures.

### Files to read before coding (READ FILES BEING MODIFIED — non-negotiable)

| File | Current state | Story changes |
|---|---|---|
| `classlite-web/src/App.tsx` | Wraps `<RouterProvider />` in `<RootErrorBoundary />`. No `useLanguageInit()` call. | **Modify:** swap wrapper to `<ErrorBoundary />`. Add `useLanguageInit()` call at the top of the component. |
| `classlite-web/src/routes.tsx` | Three base routes (`/` redirect, `/login`+AuthLayout, `/student`, `/dashboard`) + two DEV-only routes. NO `/permission-denied`. NO `path: '*'` catch-all. | **Modify:** add the `/permission-denied` lazy route to `baseRoutes`. Append `{ path: '*', lazy: ... }` as the LAST entry of `baseRoutes`. Do NOT touch the dev-route spread or the order of existing entries. |
| `classlite-web/src/lib/i18n.ts` | `lng: 'en'` hardcoded. | **Modify:** replace `lng: 'en'` with `lng: readLanguageCookie() ?? 'en'` + new import of `readLanguageCookie` from `@/lib/language-cookie`. |
| `classlite-web/src/locales/en.json` | 3 keys: `app.name`, `app.welcome`, `app.errorFallback`. | **Modify:** add the 35 new keys from AC1. DELETE `app.errorFallback`. Final shape has ~37 keys. |
| `classlite-web/src/locales/vi.json` | Same 3 keys with Vietnamese values. | **Modify:** symmetric to en.json. |
| `classlite-web/src/components/shared/RootErrorBoundary.tsx` | Class component, minimal Sentry-reporting + `role="alert"` fallback. | **Delete.** Replaced by `ErrorBoundary.tsx`. |
| `classlite-web/src/components/shared/__tests__/RootErrorBoundary.test.tsx` | 3 tests from 1-7b. | **Delete.** Replaced by `ErrorBoundary.test.tsx`. |
| `classlite-web/src/test/vitest-setup.ts` | Existing setup file. | **Modify:** append `expect.extend(matchers)` from `vitest-axe/matchers`. |
| `classlite-web/package.json` | No `vitest-axe` / `axe-core` / `@axe-core/playwright`. | **Modify:** add the three devDeps. |
| `classlite-web/package-lock.json` | Without those packages. | **Modify:** regenerated by `npm install`. |
| `classlite-web/playwright.config.ts` | 5 projects (`setup`, `landing`, `dashboard`, `cross-subdomain`, `mobile-safari`/`mobile-chrome`, `design-system`). | **Verify only — no change.** The new specs land under the existing `design-system` and `cross-subdomain` projects by file-pattern. |
| `classlite-web/tests/e2e/cross-subdomain/cookie-sharing.spec.ts` | Phase 0.4 stub. Asserts cookie shape. | **Verify only — no change.** The new `dashboard-boots-in-vi.spec.ts` lives as a SIBLING file, NOT a modification of this one. |
| `classlite-web/tests/e2e/auth.setup.ts` | Writes `classlite_session` + `lang=en` cookies at `.classlite.localhost`. | **Verify only — no change.** The `dashboard-boots-in-vi.spec.ts` overrides `lang` per-test; the setup stays as the baseline. |
| `classlite-web/scripts/i18n-parity.mjs` | Working parity script. | **Verify only — no change.** AC9 wires it into CI; the script itself stays. |
| `classlite-web/src/lib/test/i18n-parity.ts` | `assertI18nParity` helper from 1-7b. | **Verify only — no change.** Consumed by AC1 + every component test. |
| `classlite-web/vite.config.ts` | Proxy `/api → :8080`, `@/` alias. | **Verify only — no change.** |
| `classlite-web/eslint.config.js` | 1-7a hex literal block + 1-7b raw fetch / axios block + react-refresh override + test-dir override. | **Verify only — no change.** The new hooks under `src/hooks/` ARE covered by the 1-7b AC8 rule scope — verify no raw `fetch` slipped into `usePolling.ts` (the stub uses `useEffect` + `fnRef`, no fetch). |
| `classlite-web/.github/workflows/ci-web.yml` | May or may not exist — check first. | **Modify** (extend with `i18n-parity` step) OR **Create** (per AC9 shape). |

**What must be PRESERVED across this work (the system-end-to-end contract):**
- `npm run dev` MUST still boot the dashboard.
- `npx tsc -b` MUST stay clean.
- All existing 1-7a + 1-7b Vitest tests (~100) MUST continue to pass.
- All existing 1-7a + 1-7b Playwright tests (`design-system` 13 + `cross-subdomain` 3) MUST continue to pass.
- The `/__theme-resolution` + `/__multi-tab-test-bait` DEV-only routes MUST continue to be absent from the production bundle (the grep gate from 1-7b's Task 11.7 stays green).
- The `bash scripts/sync-tokens.sh && git diff --exit-code` token-parity guard MUST stay green.
- The existing `components/ui/button.tsx` MUST NOT be touched (R41 + FW-7).
- The existing `tests/e2e/cross-subdomain/cookie-sharing.spec.ts` MUST continue to work (Phase 0.4 surface).

### Library / framework requirements

| Library | Version constraint | Notes |
|---|---|---|
| `vitest-axe` | `^0.1.0` (latest; the `^` is intentional — the package is single-digit-versioned but stable) | DevDep. The Vitest matcher that turns axe results into `toHaveNoViolations()`. Install in this story. |
| `axe-core` | `^4.10.0` | DevDep. Required peer of `vitest-axe`. The actual a11y rules engine. |
| `@axe-core/playwright` | `^4.10.0` | DevDep. Used by the bilingual-smoke spec for full-page axe audits. |
| `react-i18next` | `^17.0.8` (already installed) | Already configured in 1-7b. The cookie-driven `lng` seed is the only change. |
| `i18next` | `^26.3.0` (already installed) | Same. |
| `zustand` | `^5.0.14` (already installed) | The `subscribe(...)` API used by `useLanguageInit` is stable v5. |
| `react-router` | `^7.16.0` (already installed) | `path: '*'` catch-all is supported in library mode. |
| `@sentry/react` | `^10.55.0` (already installed) | `Sentry.captureException` returns the event ID; used by the polished ErrorBoundary. |
| `@testing-library/react` | `^16.3.2` (already installed) | For component tests. |
| `@testing-library/jest-dom` | `^6.9.1` (already installed) | For `toBeInTheDocument` etc. |

**Do NOT add:**
- Any new shadcn primitives (Toggle, Avatar, etc.) — Epic 1D Story 1d-2 scope.
- `react-aria` / `@react-aria/*` / any other a11y library — `vitest-axe` + role queries are sufficient.
- Any cookie library (`js-cookie`, etc.) — `document.cookie` parsing is 30 lines.
- Any i18n side library (`react-intl`, etc.) — `react-i18next` is the locked stack.

### File structure requirements

```
classlite-web/
  package.json                                 (modified — devDeps for vitest-axe + axe-core + @axe-core/playwright)
  package-lock.json                            (modified — install regeneration)
  axe.allowlist.json                           (NEW — empty rules, governance stub)
  src/
    App.tsx                                    (modified — useLanguageInit() + ErrorBoundary swap)
    routes.tsx                                 (modified — add /permission-denied + path:'*' catch-all)
    lib/
      i18n.ts                                  (modified — cookie-driven lng seed)
      language-cookie.ts                       (NEW — AC6 cookie read / write / domain)
      __tests__/
        language-cookie.test.ts                (NEW — AC6)
    components/
      shared/
        AppLayout.tsx                          (NEW — AC2)
        Sidebar.tsx                            (NEW — AC2 placeholder)
        TopBar.tsx                             (NEW — AC2 placeholder)
        UserPill.tsx                           (NEW — AC2 placeholder)
        LanguageToggle.tsx                     (NEW — AC6)
        ErrorBoundary.tsx                      (NEW — AC3 polished)
        PermissionDenied.tsx                   (NEW — AC4)
        NotFound.tsx                           (NEW — AC5)
        RootErrorBoundary.tsx                  (DELETED — replaced by ErrorBoundary)
        __tests__/
          AppLayout.test.tsx                   (NEW — AC2)
          LanguageToggle.test.tsx              (NEW — AC6)
          ErrorBoundary.test.tsx               (NEW — AC3)
          PermissionDenied.test.tsx            (NEW — AC4)
          NotFound.test.tsx                    (NEW — AC5)
          RootErrorBoundary.test.tsx           (DELETED)
      ui/                                      (untouched — R41 + FW-7)
    hooks/
      useAuth.ts                               (NEW — AC10 stub)
      useCurrentCenter.ts                      (NEW — AC10 stub)
      useRole.ts                               (NEW — AC10 stub)
      usePolling.ts                            (NEW — AC10 real impl, no consumer yet)
      useLanguageInit.ts                       (NEW — AC6)
      __tests__/
        useAuth.test.tsx                       (NEW)
        useCurrentCenter.test.tsx              (NEW)
        useRole.test.tsx                       (NEW)
        usePolling.test.tsx                    (NEW)
        useLanguageInit.test.tsx               (NEW — AC6)
    lib/test/
      i18n-parity.ts                           (unchanged — 1-7b's helper)
      i18n-parity.test.ts                      (unchanged — 1-7b's smoke)
      __tests__/
        i18n-parity-coverage.test.ts           (NEW — AC1 ATDD-red specimen)
    locales/
      en.json                                  (modified — add ~35 new keys, remove app.errorFallback)
      vi.json                                  (modified — symmetric)
    test/
      vitest-setup.ts                          (modified — expect.extend(vitest-axe matchers))
  e2e/
    bilingual-smoke.spec.ts                    (NEW — AC8, design-system project)
    route-bundle-boundaries.spec.ts            (unchanged — 1-7b)
    multi-tab-refresh.spec.ts                  (unchanged — 1-7b)
    theme-resolution.spec.ts                   (unchanged — 1-7a)
    typography-resolution.spec.ts              (unchanged — 1-7a)
  tests/e2e/cross-subdomain/
    cookie-sharing.spec.ts                     (unchanged — Phase 0.4)
    dashboard-boots-in-vi.spec.ts              (NEW — AC8)
.github/workflows/
  ci-web.yml                                   (created OR extended — AC9)
```

### Testing requirements

This story triggers WF-8's MANDATORY ATDD flow (R38 owned). The tests below are SEQUENCED — ATDD-red specimens FIRST, then implementation, then the broader inline contracts.

| Test | Type | Location | Mock seam | ATDD red-first? |
|---|---|---|---|---|
| `i18n-parity-coverage.test.ts` | Vitest pure | `src/lib/test/__tests__/` | None | **YES** — write first, watch fail |
| `bilingual-smoke.spec.ts` | Playwright (design-system) | `e2e/` | None — locale JSON imported as source-of-truth | YES — write before AC2/AC3/AC4/AC5/AC6 implementations |
| `dashboard-boots-in-vi.spec.ts` | Playwright (cross-subdomain) | `tests/e2e/cross-subdomain/` | None — uses storageState | YES |
| `language-cookie.test.ts` | Vitest jsdom | `src/lib/__tests__/` | None | No — inline with AC6 implementation |
| `useLanguageInit.test.tsx` | Vitest + Testing Library | `src/hooks/__tests__/` | Spy on `document.cookie` setter | No |
| `AppLayout.test.tsx` | Vitest + Testing Library + vitest-axe | `src/components/shared/__tests__/` | None | No |
| `LanguageToggle.test.tsx` | Vitest + Testing Library + vitest-axe | `src/components/shared/__tests__/` | None | No |
| `ErrorBoundary.test.tsx` | Vitest + Testing Library + vitest-axe + Sentry mock | `src/components/shared/__tests__/` | `vi.mock('@sentry/react', ...)` (per the 1-7b ESM namespace trap) | No |
| `PermissionDenied.test.tsx` | Vitest + Testing Library + vitest-axe | `src/components/shared/__tests__/` | None | No |
| `NotFound.test.tsx` | Vitest + Testing Library + vitest-axe | `src/components/shared/__tests__/` | None | No |
| `useAuth.test.tsx`, `useCurrentCenter.test.tsx`, `useRole.test.tsx` | Vitest pure | `src/hooks/__tests__/` | None | No |
| `usePolling.test.tsx` | Vitest + fake timers + Testing Library | `src/hooks/__tests__/` | `vi.useFakeTimers()` | No |

- All Vitest tests use the project default config (jsdom env per `vitest.config.ts`).
- ALL component tests call `assertI18nParity([...keys])` on the keys they render — this is the per-test layer of the R38 mitigation.
- `vitest-axe` matchers extend the default expect — no per-test setup beyond `import 'vitest-axe/matchers'`.
- The `useLanguageInit` test wraps the hook in a small wrapper component using `renderHook` from `@testing-library/react`.
- The `usePolling` test uses `vi.useFakeTimers()` + `act(() => vi.advanceTimersByTime(intervalMs))` to drive the interval deterministically.
- The bilingual-smoke spec runs against the design-system project's auto-started Vite dev server on `localhost:5173`. The `lang` cookie is overridden per-test via `context.addCookies({ domain: 'localhost', ... })`.
- The `dashboard-boots-in-vi.spec.ts` runs against the cross-subdomain project's `my.classlite.localhost:5173` baseURL (set in `playwright.config.ts`). The `storageState` from `auth.setup.ts` provides the session cookie.

### Previous story intelligence (Story 1-7b → 1-7c)

Story 1.7b shipped the **runtime spine** that this story finishes the surface around. Read its file list (lines 1054–1117 of `1-7b-app-shell-routing-and-state-management.md`) and Change Log (lines 1138–1142) before starting. Direct learnings:

- **The TEST-FE-3 reset pattern uses `reset()` action, NOT `setState(initialState, true)`.** 1-7b's review pass amended `docs/project-context.md` TEST-FE-3 to sanction this. The Zustand v5 strict typing on `replace: true` was the cause. Every store this story touches (only `languageStore`) honors the pattern.
- **The ESM `vi.spyOn` trap on `@sentry/react`** — 1-7b's `sentry-breadcrumb.test.ts` had to switch from `vi.spyOn` to `vi.mock('@sentry/react', () => ({...}))` with hoisted mocks. The new `ErrorBoundary.test.tsx` will hit the same trap when mocking `Sentry.captureException`. Use the SAME hoisted-mock pattern from `RootErrorBoundary.test.tsx` (which this story deletes — but copy the mock setup before deleting).
- **The `stubLocation` helper at `src/test/location-stub.ts`** is the project's idiom for `window.location.assign` mocking. Not needed by 1-7c (no `location.assign` calls in scope), but document its existence for downstream stories.
- **The MSW server at `src/test/msw-server.ts`** is the project's only mock seam. Not needed by 1-7c (no network calls), but reaffirmed.
- **The Playwright `design-system` project's auto-`webServer` block** boots a fresh Vite dev server on `localhost:5173` and reuses it across tests. The bilingual-smoke spec leverages this — no extra wiring needed.
- **The `import.meta.env.DEV` ternary in `routes.tsx`** is statically folded by Rolldown — the grep gate exits 1 for dev-only routes. The new `/permission-denied` + `path: '*'` routes are PRODUCTION-ELIGIBLE, NOT dev-gated. They appear in the dist bundle (verify via the same grep pattern reversed).
- **The 1-7b ESLint rule (AC8) bans raw `fetch`/`axios` in `src/features/**` and `src/hooks/**`** — `usePolling` lives in `src/hooks/` and does NOT call `fetch`. Verify the lint stays green.
- **1-7b's `app.errorFallback` key was the minimal stop-gap.** This story REMOVES it because the polished `ErrorBoundary` uses `app.errorBoundary.*` keys instead. Grep for `app.errorFallback` after the rename and confirm zero references remain.
- **The 1-7b language store ships a `reset()` action.** The 1-7c side-effect bridge does NOT call `reset()` — it calls `setLanguage(...)`. The store's `reset()` exists for test cleanup ONLY (1-7b TEST-FE-3 idiom).

### Git intelligence (recent commits relevant to this story)

- `4703b10 web: implement Story 1.7b app shell — router, 401 refresh, state mgmt` — the immediate baseline. Read its file list for what's in place.
- `457aea5 web: drop tsconfig baseUrl + ignoreDeprecations bandaid; include configs in node project` — the tsconfig fix landed mid-1-7b. `npx tsc -b` is now a clean reference point.
- `5a741ff web: implement Story 1.7a design system + shadcn theme bridge` — the design tokens + shadcn `button.tsx` + the dev-only `/__theme-resolution` route. The new components in 1-7c consume the tokens; nothing else.
- `21541ff test: close Story 1.6 with code review, TA expansion, and Epic 1B gate` — the Go API auth surface (`/api/auth/refresh` etc.). 1-7c does NOT touch the Go API.
- `def9158 docs: scaffold Epic 1D component library` — confirms Epic 1D is scoped + scheduled AFTER Epic 1C. The 1.7c shells will be REFACTORED by 1d-3 when 1d-3 lands.

### Latest tech information

- **`vitest-axe` v0.1.x** (latest). API: `import { axe } from 'vitest-axe'` + `import * as matchers from 'vitest-axe/matchers'` + `expect.extend(matchers)`. Usage: `expect(await axe(container)).toHaveNoViolations()`. Compatible with axe-core v4.10. Tiny package; no peer-dep complications.
- **`axe-core` v4.10** (current as of January 2026). WCAG 2.1 AA + 2.2 rules supported. Configurable via `axe.configure(...)` if rule subsets are needed (not used here).
- **`@axe-core/playwright` v4.10.** API: `new AxeBuilder({ page }).analyze()` returns `{ violations, passes, incomplete, inapplicable }`. Assert `violations === []`. The allowlist mechanism uses `.disableRules(['rule-id'])` — only use when reviewed and recorded in `axe.allowlist.json`.
- **React Router v7 `path: '*'`** — catches everything that doesn't match a more specific route. Order matters: the catch-all MUST be the last entry of `baseRoutes` for production correctness. In dev, the dev-only routes are spread AFTER `baseRoutes` so they still match before the catch-all in dev's array order. (RR v7 matches in array order, not by path specificity.)
- **`document.cookie` parsing** — no library needed. The regex `new RegExp(\`(?:^|;\\s*)${COOKIE_NAME}=([^;]+)\`)` handles the SOMETIMES-leading-space delimiter pattern. Don't write to `document.cookie` in jsdom without the `SameSite=Lax` attribute or jsdom emits a warning. Don't rely on `expires` — `Max-Age` is simpler and more reliable across browsers.
- **`useEffect` for the language subscription** — runs ONCE (empty dep array) and the cleanup runs on unmount. The `seeded.current` ref guards against React 19 StrictMode's double-invocation behavior (the effect fires twice on mount in dev StrictMode; without the ref guard, the cookie would be seeded twice).
- **React 19 + class component error boundaries** — `getDerivedStateFromError` runs before paint and updates state synchronously; `componentDidCatch` runs after with the component stack. Sentry's `captureException` returns the event ID synchronously (as of @sentry/react v10); the `setState({ eventId })` in `componentDidCatch` causes a second render to display the ID. This is intentional — the FIRST fallback render is the immediate one without the ID; the SECOND render adds the ID once Sentry returns it. Users see no flicker because the render gap is < 1 frame.

## Project Context Reference

Mandatory reading before coding (do not skim — these are the rules that fail PR review when broken):
- **`docs/project-context.md`** — the master rules file. Specifically: FW-4 (useEffect permitted exceptions), FW-5 (Zustand stores isolated), FW-6 (Zustand never triggers Query invalidation), FW-7 (component placement three tiers), TS-5 (401 in fetch layer — context for what NOT to do in ErrorBoundary), TS-6 (ISO date strings — context for future i18n date interpolation), TEST-FE-1 (MSW is the only mock seam — not used here), TEST-FE-2 (Loading/Empty/Error trilogy — not applicable here), TEST-FE-3 (Zustand reset via `reset()` action), TEST-FE-4 (i18n key resolution in tests), TEST-FE-5 (axe + role queries), TEST-FE-6 (role-based rendering — test absence), TEST-UX-1 (i18n test coverage both locales), TEST-UX-2 (keyboard navigation flows), UX-1 (loading/empty/error trilogy — defer), UX-2 (i18n co-primary — the core focus), UX-3 (role-based separate components), CQ-1 (dead code rejected), CQ-3 (no magic values).
- **`_bmad-output/planning-artifacts/architecture.md` lines 76–80, 165–170, 187–188, 250–260, 437–501, 519–521, 597–598, 736–903** — the canonical Frontend Architecture + Auth Token Lifecycle + Frontend Error Display + Request ID propagation + complete classlite-web/ tree. Every code-level decision traces here.
- **`_bmad-output/planning-artifacts/epics/epic-01c-frontend-landing.md` lines 133–186** — the canonical Story 1.7c ACs.
- **`_bmad-output/planning-artifacts/ux-design-specification.md` §4.2 lines 132–143, §4.3 lines 145–151, §6.4 line 391, §10.4 line 587** — App Shell layout + role-protection routing + permission-denied as orientation + silent-refresh failure flow.
- **`_bmad-output/test-artifacts/test-design/classlite_new-handoff.md` lines 40, 56, 59, 113–117, 162** — Epic 1C gate + R38 ownership.

Cross-references that MAY become relevant if surprises emerge:
- **`_bmad-output/test-artifacts/test-design/test-design-qa.md` lines 165, 256–257, 299** — R38 P0 test bucket + visual regression baseline.
- **`_bmad-output/implementation-artifacts/1-7b-app-shell-routing-and-state-management.md`** — the immediately prior story. Read its Change Log (lines 1138–1142) for the 16 review patches that shaped 1-7b's final shape; read its File List (lines 1054–1117) for the exact shape of files this story extends.
- **`_bmad-output/implementation-artifacts/1-7a-design-system-and-component-library.md`** — read its file list for the design tokens, the existing `button.tsx`, the `tokens.css` consumer pattern. Specifically the `--cl-*` tokens for `--cl-paper`, `--cl-ink`, `--cl-accent`, `--cl-sidebar-bg`, `--cl-line` used throughout this story's components.
- **`_bmad-output/implementation-artifacts/1d-3-app-shell-stack.md`** — Epic 1D's pending replacement for the layout primitives. When that story lands, it WILL refactor 1-7c's `Sidebar` / `TopBar` / `UserPill` placeholders to consume role-variant primitives in `components/domain/`. The boundary contract is intentional; do not pre-empt 1d-3 here.
- **`_bmad-output/implementation-artifacts/deferred-work.md` W1 entry** — the NotFound catch-all deferred from 1-7b. This story closes it.

## Dev Agent Record

### Agent Model Used

Claude Opus 4.7 (1M context)

### Debug Log References

- **`vitest-axe` 0.1.0 ships an empty `dist/extend-expect.js`.** The package's documented side-effect import is a runtime no-op against this build. Worked around with explicit `expect.extend(axeMatchers)` in `src/test/vitest-setup.ts` AND a manual TS-augmentation file at `src/test/vitest-axe.d.ts` that re-augments the modern `vitest` module's `Assertion<T>` interface. The package's stock `extend-expect.d.ts` augments the legacy `global Vi.Assertion` namespace from Vitest 0.x / 1.x which Vitest 4.x no longer exposes.
- **`@testing-library/react` cleanup not auto-registering with `globals: false`.** RTL's `afterEach(cleanup)` global hook only fires when Vitest's `globals` flag is enabled. With `globals: false` (per existing project convention), successive `render()` calls in the same test file leave previous DOM trees mounted and `screen.getByRole(...)` finds multiple matches. Manually registered `afterEach(cleanup)` in `src/test/vitest-setup.ts`.
- **`fnRef.current = fn` during render trips `react-hooks/refs` in `eslint-plugin-react-hooks` v7.** Refactored `usePolling` to assign the ref inside a separate `useEffect(() => { fnRef.current = fn }, [fn])` — the React-19-canonical pattern. The `react-hooks/set-state-in-effect` warning on the `isPolling` setter inside the same hook is acknowledged via per-line disable comment because `isPolling` IS effect-derived state mirroring the interval lifecycle.
- **React Router v7 `HydrateFallback` warning.** RR v7 logs `No HydrateFallback element provided to render during initial hydration` on every navigation in dev. Already documented in 1-7b — polished hydrate fallback is downstream.
- **Playwright skip-to-content focus test needed an explicit wait.** `page.goto('/dashboard')` returns when `load` fires but the lazy AppLayout chunk hasn't finished hydrating yet. Pressing Tab immediately moves focus to `<body>` (no focusable elements in DOM yet). Added `await page.locator('a[href="#main-content"]').waitFor({ state: 'attached' })` before the keypress.
- **`/login` placeholder H1 swap from `app.welcome` → `auth.login.title`.** Bilingual smoke spec asserts the localized login title; the 1-7b `LoginPagePlaceholder` was rendering `app.welcome` ("Welcome to ClassLite"). One-line swap unblocks the assertion without dragging Story 1-8's real LoginPage forward.
- **`/dashboard` route wrap in `<AppLayout>` via pathless lazy layout route.** The story spec said "no route mounts AppLayout today" but the bilingual-smoke skip-link test required the layout to be reachable on `/dashboard`. Minimal-scope change: pathless lazy route with `AppLayout` as `Component` and `/student` + `/dashboard` as children. Student/Teacher placeholder dashboards no longer need their own `min-h-screen` since they're now inside AppLayout's `<main>`.

### Completion Notes List

- **AC1 (R38 — i18n keys + parity coverage):** 35 new keys seeded in both `en.json` and `vi.json`, structured by surface (app.layout.*, app.errorBoundary.*, app.permissionDenied.*, app.notFound.*, auth.*). Legacy `app.errorFallback` from 1-7b deleted. Parity-coverage RED specimen from `/bmad-tea AT` activated; `npm run i18n-parity` reports OK 37 keys. **Vietnamese reviewer note:** values for `app.errorBoundary.*`, `app.permissionDenied.*`, `app.notFound.*` flagged in PR description for Vietnamese-fluent review — currently seeded by dev with confident but unverified translations.
- **AC2 (AppLayout + sidebar + topbar + skip-to-content):** five `components/shared/` files (Sidebar, TopBar, UserPill, LanguageToggle, AppLayout). AppLayout composes the four children + a skip-to-content `<a href="#main-content">` as the FIRST focusable element + `<main id="main-content" role="main" tabIndex={-1}>` hosting `<Outlet />`. AppLayout mounted on `/dashboard` + `/student` via a pathless lazy layout route in `routes.tsx`.
- **AC3 (polished ErrorBoundary):** replaces 1-7b's minimal `RootErrorBoundary`. Class component, `componentDidCatch` reports to Sentry with `componentStack` context, captures the event ID (Sentry React SDK v10 returns it synchronously), renders monospace span + i18n label. Retry CTA clears `state.hasError` so children re-mount; if the error was transient, the recovery path is one click. Home link as the lower-stakes escape per UX-DR16. Old `RootErrorBoundary.tsx` + its test deleted; old `app.errorFallback` i18n key removed (zero remaining references).
- **AC4 (PermissionDenied):** `s67` orientation screen per UX-DR16. Two body-copy variants gated on the `requiredRoles` prop (`['owner', 'admin']` vs `['owner']`). Three CTAs (message-owner button, dashboard link, role-requirement summary). Mounted via `/permission-denied` lazy route in `routes.tsx`. Story 2-6 will wire per-route `errorElement` for actual role gating.
- **AC5 (NotFound + catch-all):** localized 404 screen with `<main role="main">` + H1 + body + home link. Mounted via `path: '*'` lazy route as the LAST entry of `baseRoutes` — closes 1-7b's W1 deferral.
- **AC6 (language cookie bridge + LanguageToggle):** `lib/language-cookie.ts` ships `readLanguageCookie` / `writeLanguageCookie` / `languageCookieDomain` + `Language` type. `hooks/useLanguageInit.ts` seeds the store from the cookie on mount AND subscribes to subsequent `setLanguage` mutations → writes cookie + calls `i18n.changeLanguage`. `lib/i18n.ts` rewired to seed `lng` from the cookie at module-load (synchronous `document.cookie` access — avoids first-paint flicker). `App.tsx` calls `useLanguageInit()` once at top. `LanguageToggle.tsx` is the two-button pill renderer; the side-effect bridge stays separate per FW-5 + FW-6.
- **AC7 (vitest-axe + axe-core + @axe-core/playwright wiring):** three devDeps installed during `/bmad-tea AT`. `src/test/vitest-setup.ts` extends Vitest's `expect` with `axeMatchers` manually (vitest-axe 0.1.0's `extend-expect.js` is empty — package bug). `src/test/vitest-axe.d.ts` adds TS module augmentation for Vitest 4's `Assertion<T>` interface. `classlite-web/axe.allowlist.json` ships as governance stub with empty `rules: []`. Every component test from AC2/AC3/AC4/AC5/AC6 includes one `vitest-axe` axe assertion.
- **AC8 (bilingual smoke + cross-subdomain dashboard-boots-in-vi):** both RED scaffolds from `/bmad-tea AT` activated. Required `LoginPagePlaceholder.tsx` H1 rewire to `auth.login.title` AND `routes.tsx` AppLayout wrap so the skip-link test on `/dashboard` is satisfiable. Bilingual smoke ships 10 tests (5 × 2 locales): /login H1 + axe + raw-key scan, /permission-denied H1 + axe + raw-key scan, /not-found H1 + raw-key scan, /dashboard skip-link first-Tab focus, /dashboard full-page axe. Cross-subdomain spec ships 2 tests: dashboard boots in vi when cookie is set at `.classlite.localhost`, fallback to en when cookie is absent.
- **AC9 (CI guard):** `.github/workflows/ci-web.yml` extended with `i18n parity (Story 1.7c AC9 — R38 mitigation)` step between `Test` and `Build`. Force-fail dry-run performed locally: deleted `app.notFound.body` from vi.json → script exits 1 with diff report; restored vi.json → script reports OK 37 keys. PR description will flag the new step for the human reviewer to enable as a required status check in GitHub repo settings.
- **AC10 (four stub hooks):** `useAuth` / `useCurrentCenter` / `useRole` return canned no-session shapes with typed return values. `usePolling` is a real implementation (Story 1-9a is the first consumer) — `useEffect`-driven interval, ref-captured latest fn (no stale closure), cleanup on unmount AND on `enabled` flip. 9 tests covering all four hooks.
- **CQ-1 / dead code cleanup:** `RootErrorBoundary.tsx` + its test + the `app.errorFallback` i18n key all deleted. No dead code shipped.
- **Out-of-spec micro-additions documented:** (a) `LoginPagePlaceholder` H1 swap (1-line UX-aligned tweak — `app.welcome` → `auth.login.title`); (b) Student/Teacher placeholder dashboards lost their own `min-h-screen` + `bg-paper` since AppLayout's `<main>` now owns those. Both noted in Debug Log References above.
- **Manual verifications deferred:** Task 11.12 (manual cross-domain DevTools observation) deferred to the reviewer — the Playwright `dashboard-boots-in-vi.spec.ts` covers the same invariant headlessly.

### File List

**New files (28):**

```
.github/workflows/ci-web.yml                     (extended — i18n parity step + existing 1-7a hand-edit guards preserved)

classlite-web/
  axe.allowlist.json                             (NEW — governance stub for known axe false positives)
  e2e/bilingual-smoke.spec.ts                    (NEW — AC8 bilingual + axe + skip-link, generated by /bmad-tea AT, activated this story)
  src/
    components/shared/
      AppLayout.tsx                              (NEW — AC2)
      ErrorBoundary.tsx                          (NEW — AC3 polished)
      LanguageToggle.tsx                         (NEW — AC6)
      NotFound.tsx                               (NEW — AC5)
      PermissionDenied.tsx                       (NEW — AC4)
      Sidebar.tsx                                (NEW — AC2 non-variant placeholder)
      TopBar.tsx                                 (NEW — AC2)
      UserPill.tsx                               (NEW — AC2)
      __tests__/
        AppLayout.test.tsx                       (NEW — AC2)
        ErrorBoundary.test.tsx                   (NEW — AC3)
        LanguageToggle.test.tsx                  (NEW — AC6)
        NotFound.test.tsx                        (NEW — AC5)
        PermissionDenied.test.tsx                (NEW — AC4)
    hooks/
      useAuth.ts                                 (NEW — AC10 stub)
      useCurrentCenter.ts                        (NEW — AC10 stub)
      useLanguageInit.ts                         (NEW — AC6 bridge)
      usePolling.ts                              (NEW — AC10 real impl)
      useRole.ts                                 (NEW — AC10 stub)
      __tests__/
        useAuth.test.tsx                         (NEW — AC10)
        useCurrentCenter.test.tsx                (NEW — AC10)
        useLanguageInit.test.tsx                 (NEW — AC6)
        usePolling.test.tsx                      (NEW — AC10)
        useRole.test.tsx                         (NEW — AC10)
    lib/
      language-cookie.ts                         (NEW — AC6)
      __tests__/
        language-cookie.test.ts                  (NEW — AC6)
    lib/test/__tests__/
      i18n-parity-coverage.test.ts               (NEW — AC1 ATDD RED specimen, activated this story)
    test/
      vitest-axe.d.ts                            (NEW — Vitest 4 type augmentation for vitest-axe matchers)
  tests/e2e/cross-subdomain/
    dashboard-boots-in-vi.spec.ts                (NEW — AC8 cross-subdomain, generated by /bmad-tea AT, activated this story)
```

**Modified files (10):**

```
classlite-web/
  package.json                                   (devDeps — vitest-axe, axe-core, @axe-core/playwright)
  package-lock.json                              (lockfile sync)
  src/
    App.tsx                                      (ErrorBoundary swap + useLanguageInit mount)
    features/auth/LoginPagePlaceholder.tsx       (H1 t() key — app.welcome → auth.login.title)
    features/dashboard/StudentDashboard.tsx      (drop self-min-h-screen — now inside AppLayout main)
    features/dashboard/TeacherDashboard.tsx      (drop self-min-h-screen — now inside AppLayout main)
    lib/i18n.ts                                  (lng seed from readLanguageCookie())
    locales/en.json                              (+35 new keys, -1 legacy app.errorFallback)
    locales/vi.json                              (+35 new keys, -1 legacy app.errorFallback)
    routes.tsx                                   (AppLayout pathless layout wrapping dashboard+student; /permission-denied lazy route; path:* catch-all)
    test/vitest-setup.ts                         (vitest-axe matcher registration + RTL cleanup)
```

**Deleted files (2):**

```
classlite-web/src/components/shared/RootErrorBoundary.tsx          (replaced by ErrorBoundary.tsx)
classlite-web/src/components/shared/__tests__/RootErrorBoundary.test.tsx  (replaced by ErrorBoundary.test.tsx)
```

### Verification Summary

| Gate | Status |
|---|---|
| `npm run dev` boots | ✅ |
| `npm test` | ✅ 149/149 across 25 files (1-7b baseline: 100/100; +49 new) |
| `npm run lint` | ✅ clean |
| `npm run lint:css` | ✅ clean |
| `npx tsc -b` | ✅ exit 0 |
| `npm run i18n-parity` | ✅ 37 keys both en + vi |
| `npm run build` | ✅ 7 lazy chunks emitted (AuthLayout, LoginPagePlaceholder, StudentDashboard, TeacherDashboard, AppLayout, PermissionDenied, NotFound) |
| `grep -r __theme-resolution dist/` | ✅ exit 1 |
| `grep -r __multi-tab-test-bait dist/` | ✅ exit 1 |
| `grep -r ThemeResolutionPage dist/` | ✅ exit 1 |
| `grep -r MultiTabTestPage dist/` | ✅ exit 1 |
| `bash scripts/sync-tokens.sh && git diff --exit-code -- classlite-landing/src/styles/tokens.css` | ✅ exit 0 |
| `npx playwright test --project=design-system` | ✅ 23/23 (1-7a 9 + 1-7b 4 + 1-7c 10) |
| `npx playwright test --project=cross-subdomain` | ✅ 6/6 (1-5/Phase 0.4 3 + setup + 1-7c 2) |
| Force-fail dry-run of `i18n-parity` script | ✅ exit 1 with diff report; restore green |

## Change Log

| Date | Change |
|------|--------|
| 2026-06-12 | Story implemented and transitioned in-progress → review. All 11 tasks + 50 subtasks complete. Final test matrix: Vitest 149/149 across 25 files (1-7b baseline: 100/100, +49 new — i18n-parity-coverage 2, AppLayout 4, LanguageToggle 7, ErrorBoundary 7, PermissionDenied 5, NotFound 4, language-cookie 11, useLanguageInit 3, useAuth 2, useCurrentCenter 1, useRole 1, usePolling 5); Playwright design-system 23/23 (+10 from bilingual-smoke); Playwright cross-subdomain 6/6 (+2 from dashboard-boots-in-vi); `npx tsc -b`, `npm run lint`, `npm run lint:css`, `npm run i18n-parity`, `npm run build` all clean; build emits 7 lazy chunks; 4 dev-route grep gates exit 1; tokens.css parity holds. Out-of-spec micro-additions documented in Debug Log: (a) `LoginPagePlaceholder.tsx` H1 swap from `app.welcome` → `auth.login.title` so the bilingual smoke `/login` assertion is satisfiable without dragging Story 1-8 forward, (b) `routes.tsx` wraps `/dashboard` + `/student` in `<AppLayout>` via a pathless lazy layout route so the skip-link test is reachable on `/dashboard` (the AC8 contract requires AppLayout to be mounted on /dashboard). Implementation choices worth flagging for review: (i) `vitest-axe@0.1.0` ships an empty `dist/extend-expect.js` — worked around with manual `expect.extend(axeMatchers)` in `vitest-setup.ts` + custom TS augmentation file at `src/test/vitest-axe.d.ts` re-augmenting the modern Vitest 4 `Assertion<T>` interface; (ii) RTL auto-cleanup doesn't fire when Vitest `globals: false` — added explicit `afterEach(cleanup)` in `vitest-setup.ts`; (iii) `usePolling` refactored to assign `fnRef.current` inside a separate `useEffect(..., [fn])` to satisfy `react-hooks/refs` (React 19 + eslint-plugin-react-hooks v7); (iv) Vietnamese values for `app.errorBoundary.*`, `app.permissionDenied.*`, `app.notFound.*` flagged for reviewer-level Vietnamese review in PR description. CI workflow `.github/workflows/ci-web.yml` extended with the `i18n parity` step BETWEEN `Test` and `Build`; force-fail dry-run confirmed exit 1 on key drift. Task 11.12 (manual cross-domain DevTools observation) deferred to reviewer — Playwright spec covers headlessly. |
| 2026-06-11 | Story drafted in ready-for-dev shape: comprehensive context engine closing the Epic 1C foundation triple. Owns R38 (i18n parity, score 6) — WF-8 ATDD red phase MANDATORY, satisfied by the four-layer mitigation (assertI18nParity helper in every component test, i18n-parity-coverage.test.ts as the ATDD red specimen, `npm run i18n-parity` CI step wired into `.github/workflows/ci-web.yml`, Playwright bilingual-smoke spec walking `/login` `/permission-denied` `/not-found` `/dashboard` in BOTH locales with axe-core full-page audits). Scope: AppLayout + Sidebar + TopBar + UserPill placeholders in `components/shared/` (non-role-variant — Epic 1D Story 1d-3 will refactor); polished ErrorBoundary REPLACING 1-7b's minimal RootErrorBoundary with Sentry event ID + retry CTA + UX-DR16 three-part recovery copy; PermissionDenied with two body-copy variants (Owner+Admin / Owner-only) per UX-3; NotFound + `path: '*'` catch-all closing 1-7b's W1 defer; LanguageToggle + `lib/language-cookie.ts` + `hooks/useLanguageInit.ts` cookie-driven UX-DR17 cross-subdomain handoff (dashboard half only — landing half ships with Story 1.10); ~35 new i18n keys with parity-enforced en + vi; vitest-axe + axe-core + @axe-core/playwright devDeps; axe.allowlist.json governance stub; four stub hooks (useAuth, useCurrentCenter, useRole, usePolling). Scaffold reality: 1-7b's RootErrorBoundary + `app.errorFallback` key DELETED; `App.tsx` rewires wrapper; `routes.tsx` extends with two new routes + catch-all; `lib/i18n.ts` rewires `lng` seed from cookie. Risk-score ≥6 check: ONE owned (R38). Out of scope (explicit deferrals): role-variant Sidebar / TopBar / UserPill / SearchPalette / Mobile Tab Bar → Epic 1D Story 1d-3; real useAuth/useCurrentCenter/useRole behavior → Story 1-8 / 2-2 / 2-6; Astro landing → Story 1.10; full classlite.app → my.classlite.app E2E (needs landing live) → Story 1.10; EmptyState → Epic 10 Story 10-3/10-4 (Path B re-scope); additional shadcn primitives → Epic 1D Story 1d-2. Scaffold reality documented end-to-end against 4703b10 baseline. |
