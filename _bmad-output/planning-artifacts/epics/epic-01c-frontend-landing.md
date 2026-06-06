# Epic 1C: Frontend Foundation & Landing Page

## Description

React dashboard scaffolded with design tokens, component library, i18n, routing, state management, error tracking. Auth UI screens for registration, login, verification, reset, invites, and error recovery. Astro landing page with pricing and bilingual support.

Split from the original Epic 1. Contains the decomposed Story 1.7 (split into 1.7a/1.7b/1.7c), Story 1.8 (kept as-is), the decomposed Story 1.9 (split into 1.9a/1.9b/1.9c/1.9d), and Story 1.10 (kept as-is).

## Screen References

- s00: Persona selection
- s22: Class creation
- s33: Student attempt
- s67: Permission denied

## Functional Requirements

- **FR-71:** Public landing page with hero, feature highlights, social proof, pricing, footer; bilingual, SEO-optimized
- **FR-72:** Pricing section displaying three tiers in VND with annual/monthly toggle and tier-specific CTAs
- **FR-73:** Authenticated redirect: logged-in users visiting landing page redirected to role-appropriate dashboard
- **FR-74:** Landing page fully responsive at mobile breakpoints (390x844 reference)

## UX Design Rules

- **UX-DR1:** Shared design token file (`tokens.css`) with CSS custom properties — single source of truth consumed by both Astro landing and React dashboard codebases; lint rule enforcing no raw hex values
- **UX-DR2:** Accessibility token fixes — darken `--cl-muted` to `#595c66` (5.1:1 on paper), create `--cl-accent-2-text` (`#7c4309`) for text-safe amber, `--cl-accent-2-btn` (`#92500a`) for button-safe amber, `--cl-line-interactive` (`#a8a095`) for interactive input borders
- **UX-DR3:** Landing page design — hero with pain articulation headline (Fraunces 44px), calculator visual, feature showcase cards, Vietnamese-register social proof, pricing comparison, navy footer mirroring sidebar
- **UX-DR4:** StickyHeader component — transparent to solid on scroll past 400px; CTA transitions from secondary to primary style; respects `prefers-reduced-motion`
- **UX-DR5:** AuthCard layout component — centered card (max-width 420px, 14px radius), ClassLite wordmark above card, paper background with dot grid pattern
- **UX-DR6:** GoogleOAuthButton — Google ToS-compliant branded styling; visually dominant on all auth screens
- **UX-DR7:** CollapsibleEmailForm — Google-first pattern; email/password form collapsed by default on register and login screens
- **UX-DR8:** PasswordInput + PasswordStrengthBar — eye toggle with aria-label, 4-segment strength bar, aria-live strength announcements
- **UX-DR9:** VerificationPending + useVerificationPoller hook — polls every 5s, auto-redirect on verified, 10-min timeout, Google fallback link
- **UX-DR10:** InviteCard + useInviteToken hook — 6 states covering new user, existing logged in, existing not logged in, expired, already accepted, not found
- **UX-DR11:** PainCalculator component — static stat display with Geist Mono values; pure HTML/CSS
- **UX-DR12:** PricingCard component — tier cards with popular variant (amber border + badge); prices hardcoded in Astro
- **UX-DR13:** SocialProofCard component — Vietnamese-register social proof with named center archetypes
- **UX-DR14:** FeatureCard component — tinted cards with title, description, and preview area
- **UX-DR15:** Mobile auth layout — one action per screen, full-width buttons, 48px minimum touch targets, thumb-zone primary CTA
- **UX-DR16:** Failure state design — three-part recovery pattern (what happened + why + what to do next)
- **UX-DR17:** Language continuity across domains — shared cookie carries preference from landing to auth to product
- **UX-DR18:** Logged-in redirect from landing page — non-httpOnly hint cookie; stale cookie loop broken via session_expired redirect
- **UX-DR19:** Multi-tab refresh coordination — `navigator.locks` + `BroadcastChannel` to prevent concurrent refresh token rotation races
- **UX-DR20:** OAuth email mismatch recovery screen — shows expected vs. actual email with two recovery paths

## Non-Functional Requirements Addressed

- **NFR-1 (i18n Foundation):** react-i18next with en.json + vi.json, runtime language switch, locale-aware formatting, language cookie shared across domains.
- **NFR-3 (Performance Baseline):** Lazy-loaded route chunks (student, teacher, auth), static Astro HTML for landing page, no JS required for PainCalculator.
- **NFR-5 (Accessibility Foundation):** WCAG-compliant contrast ratios via UX-DR2 token fixes, aria-live password strength announcements, 44x44px minimum touch targets, `prefers-reduced-motion` respect.

## Stories

---

### Story 1.7a: Design System & Component Library

**Size:** M | **Audience:** Frontend | **Dependencies:** None
**UX-DRs:** UX-DR1, UX-DR2

As a frontend developer,
I want a shared design token file and shadcn/ui configured with ClassLite tokens,
So that all UI components across both the React dashboard and Astro landing page render with a consistent visual language.

**Acceptance Criteria:**

**Given** the design token file `src/tokens.css`,
**When** inspecting the CSS custom properties,
**Then** all ClassLite tokens are defined:
- Surfaces: `--cl-paper`, `--cl-surface`, and related surface tokens
- Text: `--cl-ink`, `--cl-ink-soft`, `--cl-muted` at `#595c66` (5.1:1 contrast on paper)
- Accents: `--cl-accent`, `--cl-accent-2`, `--cl-accent-2-text` at `#7c4309` (text-safe amber), `--cl-accent-2-btn` at `#92500a` (button-safe amber)
- Borders: `--cl-line`, `--cl-line-soft`, `--cl-line-interactive` at `#a8a095`
- Status colors, tints, typography (Fraunces, Geist, Geist Mono), radius scale, shadows, sidebar tokens, and layout tokens

**Given** the `tokens.css` file exists in the React dashboard project,
**When** checking the Astro landing page project,
**Then** the same `tokens.css` file is committed to `classlite-landing/src/styles/` as a shared source of truth.

**Given** the shadcn/ui configuration (`components.json`),
**When** shadcn components are used in the React dashboard,
**Then** they are themed with ClassLite design tokens: `--cl-ink` for primary color, 6px radius for buttons and inputs, Geist as the base font.

**Given** the Tailwind configuration,
**When** a developer uses a raw hex color value instead of a token,
**Then** a lint rule flags the violation, enforcing token-only color usage across both codebases.

---

### Story 1.7b: App Shell, Routing & State Management

**Size:** L | **Audience:** Frontend | **Dependencies:** Story 1.7a
**UX-DRs:** UX-DR19

As a frontend developer,
I want React Router with lazy loading, TanStack Query with silent refresh, multi-tab coordination, and Zustand stores,
So that the application has performant routing, reliable data fetching with automatic auth recovery, and clean client-side state separation.

**Acceptance Criteria:**

**Given** the `classlite-web/` project,
**When** running `npm run dev`,
**Then** the Vite dev server starts with HMR and proxies `/api/*` to the Go API.

**Given** the `src/routes.tsx` file,
**When** inspecting route definitions,
**Then** routes are defined with React Router v7 and lazy loading,
**And** student-facing routes and teacher/admin routes are in separate code-split chunks,
**And** auth routes (login, register, verify, reset, invite) are in their own chunk.

**Given** the `src/lib/query-client.ts` file,
**When** TanStack Query is configured,
**Then** the global `onError` handler triggers a silent refresh attempt on 401 responses,
**And** on successful refresh, the original request is retried,
**And** on failed refresh, the user is redirected to `/login`.

**Given** multiple browser tabs are open,
**When** an access token expires and one tab initiates a refresh,
**Then** `navigator.locks.request('token_refresh')` prevents concurrent refresh token rotation,
**And** `BroadcastChannel` notifies other tabs of the new token so they do not independently attempt refresh (UX-DR19).

**Given** the `src/stores/` directory,
**When** inspecting Zustand stores,
**Then** `uiStore.ts` (sidebar state, modal state), `editorStore.ts`, and `languageStore.ts` exist,
**And** Zustand stores contain NO server-derived data (all server state lives in TanStack Query cache).

**Given** the Sentry SDK configuration,
**When** an unhandled error occurs in the frontend,
**Then** it is captured by Sentry with `request_id` breadcrumbs for cross-service correlation with the Go API.

---

### Story 1.7c: Shared Layout Components & i18n

**Size:** M | **Audience:** Frontend | **Dependencies:** Story 1.7a, Story 1.7b
**UX-DRs:** UX-DR17

As a frontend developer,
I want shared layout components, error boundaries, and a fully configured i18n system,
So that every page has a consistent shell, errors are caught gracefully, and the product supports Vietnamese and English with seamless language continuity across domains.

**Acceptance Criteria:**

**Given** the `src/components/shared/` directory,
**When** inspecting shared layout components,
**Then** the following exist:
- `AppLayout.tsx`: sidebar + topbar shell that wraps authenticated pages
- `ErrorBoundary.tsx`: top-level error boundary that displays a Sentry event ID for support reference
- `PermissionDenied.tsx`: role-gated access denied screen
- `NotFound.tsx`: 404 screen for unmatched routes

**Given** the `src/locales/` directory,
**When** react-i18next is initialized,
**Then** `en.json` and `vi.json` translation files exist with initial keys for auth screens,
**And** the language can be switched at runtime via a toggle without a page reload,
**And** date, time, and number formatting respects the active locale.

**Given** a user switches language on any screen,
**When** the preference is stored,
**Then** a cookie on `.classlite.app` domain persists the choice so it carries from the landing page to auth screens to the product without re-selection at transition points (UX-DR17).

**Given** the `src/hooks/` directory,
**When** inspecting app-wide hooks,
**Then** `useAuth.ts`, `useCurrentCenter.ts`, `useRole.ts`, and `usePolling.ts` exist as stubs ready for implementation in subsequent stories.

**Given** the i18n parity CI step (`pnpm run i18n-parity`),
**When** a developer adds a translation key to either `en.json` or `vi.json` and forgets the matching key in the other file,
**Then** the CI step fails the build with a diff report listing missing keys per locale. R38 (Vietnamese-user-sees-raw-key) is mitigated at PR-time. The check runs in the PR pipeline and blocks merge.

**Given** the `assertI18nParity(keysUsed, ['en','vi'])` test helper,
**When** any component test runs against `react-i18next`,
**Then** the helper asserts every key the component renders exists in BOTH `en.json` AND `vi.json`. Used in every component test that calls `t(...)` (project-context TEST-FE-4).

**Given** every public React route,
**When** axe-core CLI runs in CI (or `vitest-axe` runs in component tests),
**Then** zero WCAG 2.1 AA violations are reported. Any violation fails the build. Allowlist for known false positives lives in `axe.allowlist.json` with documented justification per entry.

**Given** every component that fetches server data,
**When** its test suite is reviewed,
**Then** the Loading / Empty / Error trilogy is implemented and verified by three named test cases per component (project-context TEST-FE-2): skeleton state during fetch, success state with rendered data, error state with retry CTA. MSW is the only mock seam (TEST-FE-1).

**Given** the cross-subdomain cookie auth flow,
**When** the user logs in on `classlite.app` (Astro landing) and clicks "Open Dashboard",
**Then** they are redirected to `my.classlite.app` and the dashboard recognizes them via the shared `.classlite.app` Domain cookie — no second login required. Playwright cross-domain E2E project (two projects: `landing` + `dashboard` sharing `storageState`) asserts this end-to-end. (A3 mitigation.)

---

### Story 1.8: Auth UI -- Registration & Login Screens

**Size:** L | **Audience:** Frontend | **Dependencies:** Story 1.7c
**UX-DRs:** UX-DR5, UX-DR6, UX-DR7, UX-DR8, UX-DR15

As a new or returning user,
I want to see polished registration and login screens with Google OAuth as the primary action,
So that I can create an account or sign in quickly with minimal friction.

**Acceptance Criteria:**

**Given** the `features/auth/` directory,
**When** inspecting auth components,
**Then** the following shared components exist:
- `AuthCard.tsx`: centered card (max-width 420px, 14px radius, `--cl-shadow-card`), ClassLite wordmark (Fraunces 22px italic + amber dot) above card, paper background with dot grid pattern (UX-DR5)
- `GoogleOAuthButton.tsx`: white background, line border, colored Google SVG logo, ToS-compliant; states: default, hover, loading (spinner replaces logo), disabled (UX-DR6)
- `CollapsibleEmailForm.tsx`: collapsed by default behind a link trigger, dashed-to-solid border on expand (UX-DR7)
- `PasswordInput.tsx`: eye toggle with aria-label for show/hide
- `PasswordStrengthBar.tsx`: 4 segments (red/amber/gold/green), aria-live="polite" strength announcements (UX-DR8)

**Given** an unauthenticated user navigating to `/register`,
**When** the registration page renders,
**Then** they see the AuthCard with Fraunces heading conveying "create account" in the active locale,
**And** the Google OAuth button is the largest, most prominent element,
**And** below a divider with localized "or" text, a link to expand the CollapsibleEmailForm is visible,
**And** the expanded form shows: full name input, email input, password input with eye toggle and strength bar,
**And** a primary submit button for account creation,
**And** a link below the card directing to the login screen for users who already have an account,
**And** all labels are visible above fields (Geist Mono 10px uppercase), not placeholder-only.

**Given** the registration form,
**When** the user fills in fields and blurs,
**Then** inline validation runs: email format check, password minimum 8 characters,
**And** password strength bar updates in real time (weak/medium/strong levels displayed via aria-live),
**And** all validation errors are shown simultaneously on submit attempt.

**Given** a successful registration submission,
**When** the API returns 201,
**Then** the user is redirected to the verification pending screen.

**Given** a duplicate email error (409),
**When** the API returns the error,
**Then** an inline error appears on the email field indicating the email is already registered.

**Given** an unauthenticated user navigating to `/login`,
**When** the login page renders,
**Then** they see the AuthCard with Google OAuth button (primary), a collapse trigger for the email form, email + password form, a remember-me checkbox, and a forgot-password link,
**And** failed login shows a form-level alert indicating incorrect credentials.

**Given** a successful login,
**When** the API sets auth cookies,
**Then** the user is redirected to their dashboard (or onboarding if new, per role).

**Given** auth screens at mobile breakpoint (at or below 640px),
**When** rendered on a 390px viewport,
**Then** the card is full-width with 20px horizontal padding,
**And** all buttons are full-width at 48px height,
**And** all inputs are 48px height,
**And** touch targets are minimum 44x44px (UX-DR15).

**Given** the language toggle on auth screens,
**When** the user switches language,
**Then** the entire auth screen re-renders in the selected language,
**And** the language preference is stored in a cookie that persists across domains (UX-DR17).

---

### Story 1.9a: Email Verification UI

**Size:** S | **Audience:** Frontend | **Dependencies:** Story 1.7c, Story 1.8
**UX-DRs:** UX-DR9

As a user who just registered with email,
I want a clear verification-pending screen that automatically detects when I verify,
So that I can seamlessly proceed to onboarding without manually refreshing or navigating.

**Acceptance Criteria:**

**Given** an unverified user redirected after registration,
**When** the verification pending screen renders,
**Then** they see an envelope illustration (80x80), a Fraunces heading conveying "check your email" in the active locale, their email address displayed in bold, and a resend button with a 60-second countdown between resend attempts,
**And** a Google fallback link offering the option to sign in with Google using the same account to bypass email verification.

**Given** the `useVerificationPoller` hook is active,
**When** the hook polls `GET /auth/verify-status` every 5 seconds,
**Then** it monitors the response status continuously.

**Given** the verification poller detects `status: verified`,
**When** the poll response arrives,
**Then** the user is automatically redirected to onboarding without any manual action.

**Given** the verification poller has been running for 10 minutes,
**When** the timeout is reached,
**Then** polling stops and a manual button appears allowing the user to re-check verification status.

**Given** the verification poller detects `status: token_expired`,
**When** the response arrives,
**Then** the screen displays a message indicating the link has expired with a CTA to request a new verification email.

---

### Story 1.9b: Password Reset UI

**Size:** S | **Audience:** Frontend | **Dependencies:** Story 1.7c, Story 1.8
**UX-DRs:** None

As a user who forgot their password,
I want to request a reset link and set a new password,
So that I can regain access to my account without contacting support.

**Acceptance Criteria:**

**Given** a user navigating to `/forgot-password`,
**When** the page renders,
**Then** they see an email input and a submit button,
**And** on submission, a confirmation message is shown regardless of whether the email exists in the system (preventing email enumeration),
**And** a hint about checking the spam folder is visible below the submit area,
**And** after submission, the screen displays instructions to check their email.

**Given** a user navigating to `/reset-password?token={token}`,
**When** the token is valid,
**Then** they see a new password input with the PasswordStrengthBar component and a confirm button,
**And** on successful reset, they are redirected to login with a success notification.

**Given** an expired reset token,
**When** the page renders,
**Then** the screen displays a message indicating the link has expired with a single-click CTA to request a new link,
**And** the CTA pre-fills the user's email address so they do not need to re-enter it.

---

### Story 1.9c: Invite Acceptance UI

**Size:** M | **Audience:** Frontend | **Dependencies:** Story 1.7c, Story 1.8
**UX-DRs:** UX-DR10

As a user who received an invite link from a center,
I want to see who invited me, which center, and my assigned role, and complete acceptance with minimal steps,
So that I feel expected and can join my center quickly.

**Acceptance Criteria:**

**Given** a user clicking an invite link to `/invite/{token}`,
**When** the invite is valid and they are a new user (no existing account),
**Then** the InviteCard shows:
- Center logo or auto-generated lettermark (56x56)
- A heading showing the inviter name and center name (e.g., "[Inviter] invited you to join [Center name]" in the active locale)
- A role badge in amber indicating the assigned role
- Google OAuth button as the primary action
- A collapsed email form with the email field locked to the invite address

**Given** a user clicking an invite link who is already logged in with a matching account,
**When** the invite page renders,
**Then** they see a single confirmation button to join the center (not auto-accepted, requiring explicit user action).

**Given** a user clicking an invite link who has an existing account but is not logged in,
**When** the invite page renders,
**Then** they see a login form to authenticate before accepting the invite.

**Given** an expired invite,
**When** the invite page renders,
**Then** the screen shows a clock illustration, a message indicating the invitation has expired, the center name, and a CTA with a mailto link to contact the inviter.

**Given** an already-accepted invite,
**When** the invite page renders,
**Then** the user is redirected to the dashboard with a notification confirming they have already joined the center.

**Given** an invalid or not-found invite token,
**When** the invite page renders,
**Then** the screen shows a distinct error message (clearly different from the expired state) indicating the link is invalid.

---

### Story 1.9d: Auth Error & Recovery States

**Size:** M | **Audience:** Frontend | **Dependencies:** Story 1.7c, Story 1.8
**UX-DRs:** UX-DR16, UX-DR18, UX-DR20

As a user encountering an authentication error,
I want clear, recovery-focused error screens that tell me what happened, why, and what to do next,
So that I always have a path forward and never hit a dead end.

All error screens in this story follow the three-part pattern mandated by UX-DR16: (1) what happened, (2) why it happened, (3) what the user can do next.

**Acceptance Criteria:**

**Lockout Screen:**

**Given** 5 failed login attempts triggering lockout,
**When** the lockout screen renders,
**Then** the heading conveys "try again later" in the active locale (recovery-focused, not punitive),
**And** a countdown timer shows the remaining lockout duration (initialized from the server's `retry_after` value),
**And** the primary CTA is a password reset link, which remains active and clickable during lockout (offering an immediate escape route),
**And** refreshing the page fetches the current remaining lockout duration from the API rather than restarting the timer client-side.

**OAuth Email Mismatch Screen (UX-DR20):**

**Given** a Google OAuth email mismatch during invite acceptance,
**When** the callback redirects with `?error=email_mismatch`,
**Then** the screen shows the expected email (from the invite) vs. the actual email (from Google),
**And** offers two recovery paths: one to try a different Google account (re-initiates OAuth flow) and one to fall back to email registration.

**Google Workspace Blocked Screen:**

**Given** a Google Workspace account that blocks OAuth for ClassLite,
**When** the error redirect arrives at `/login?error=google_blocked`,
**Then** the screen explains that the user's Google account does not allow sign-in to ClassLite,
**And** two alternatives are presented: trying a personal Gmail account, or registering with email/password.

**Session Expiry Screen (UX-DR18):**

**Given** a session expiry (silent refresh failure),
**When** the user is bounced to login,
**Then** a message indicating the session has expired is shown,
**And** the URL the user was trying to reach is preserved and restored after successful re-login,
**And** the stale hint cookie (`logged_in=1`) is cleared to prevent redirect loops between the landing page and the dashboard (UX-DR18).

---

### Story 1.10: Astro Landing Page

**Size:** L | **Audience:** Frontend | **Dependencies:** Story 1.7a (shared tokens)
**UX-DRs:** UX-DR3, UX-DR4, UX-DR11, UX-DR12, UX-DR13, UX-DR14, UX-DR15, UX-DR18

As a visitor discovering ClassLite,
I want a bilingual, SEO-optimized landing page that shows the value proposition, features, pricing, and a clear path to sign up,
So that I understand what ClassLite does and can start using it for free.

**Acceptance Criteria:**

**Given** a visitor landing on `classlite.app`,
**When** the page loads,
**Then** it is server-rendered static HTML (Astro output) with SEO meta tags and Open Graph data,
**And** the page loads without authentication,
**And** the default language is detected from the browser `Accept-Language` header and redirects to `/vi/` or `/en/`.

**Given** the landing page in Vietnamese (`/vi/`),
**When** scrolling through the page,
**Then** the following sections appear in order:
1. **Header** — logo, navigation, language toggle, CTA button
2. **Hero** — Fraunces 44px heading with pain articulation, eyebrow text identifying ClassLite as an IELTS center management platform, primary CTA linking to registration
3. **Pain Articulation** — PainCalculator component: a static calculator visual showing the cost of manual grading (e.g., 5 teachers x 3 hours/week x 48 weeks = 720 hours/year), rendered with Geist Mono 28px values, 11px units, and result in `--cl-accent-2-text` at 36px; pure HTML/CSS, no JavaScript required (UX-DR11)
4. **Feature Showcase** — 3-4 FeatureCard components with tinted backgrounds (blue/gold/green mapping to `--cl-tint-*` tokens), each with title, description, and 160px preview area; SVG via inline slot for token-colored strokes (UX-DR14)
5. **Social Proof** — SocialProofCard components with Vietnamese-register social proof: named center archetypes with outcome data, stats, quotes, and details; all content hardcoded in Astro (UX-DR13)
6. **Pricing** — three PricingCard components (Free/Pro/Studio) with locked VND prices: **Free 0 VND**, **Pro 399.000 VND/tháng** (or **3.990.000 VND/năm**), **Studio 999.000 VND/tháng** (or **9.990.000 VND/năm**); a small caption "*Giá đã bao gồm VAT 10%*" appears under each price; annual toggle shows "~2 tháng miễn phí" badge on annual prices; the Pro tier card has a `2px solid --cl-accent-2` border and a popular badge; Free CTA links to registration, Pro/Studio CTAs link to registration with `?plan=pro` or `?plan=studio`; a centered CTA appears below the pricing grid (UX-DR12)
7. **Footer** — background using `--cl-ink` (navy) mirroring the authenticated sidebar, links using `--cl-sidebar-text` color, legal links (Terms, Privacy), Fraunces wordmark

**Given** the StickyHeader component,
**When** the user scrolls past 400px from the top,
**Then** the header transitions from transparent background to `--cl-surface` with border and shadow,
**And** the CTA button transitions from secondary to primary style,
**And** the transition duration is 0.2s and respects `prefers-reduced-motion` (UX-DR4).

**Given** a user who is already logged in (hint cookie `logged_in=1` exists),
**When** they visit the landing page,
**Then** a client-side script detects the cookie and redirects to `my.classlite.app/dashboard` (FR-73).

**Given** a stale hint cookie (user's session actually expired),
**When** `my.classlite.app` detects a failed silent refresh,
**Then** the hint cookie is cleared and the user is redirected to `classlite.app?session_expired=true`,
**And** the landing page shows a subtle banner indicating the session has expired (UX-DR18).

**Given** the landing page at mobile breakpoint (at or below 640px),
**When** rendered on a 390x844 viewport,
**Then** hero, features, pricing, and footer stack vertically,
**And** CTA buttons are full-width,
**And** no horizontal scrolling occurs at any breakpoint,
**And** pricing cards stack to a single column (UX-DR15).

**Given** the language toggle in the header,
**When** a user switches from Vietnamese to English (or vice versa),
**Then** the page navigates from `/vi/` to `/en/` (or vice versa),
**And** the language preference is stored in a cookie on `.classlite.app` for continuity to `my.classlite.app` (UX-DR17).

**Given** all CTA buttons on the landing page,
**When** clicked,
**Then** they link to `my.classlite.app/register` (with tier-specific query parameters where applicable).
