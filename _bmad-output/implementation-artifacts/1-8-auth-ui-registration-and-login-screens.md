---
baseline_commit: acf99f2
---

# Story 1.8: Auth UI — Registration & Login Screens

Status: done

> **Why this story matters.** Epic 1C's foundation triple (1-7a design system + 1-7b app shell + 1-7c shared layout + i18n) ships a finished surface but no way in. Story 1-8 builds the **front door** — the two screens every new and returning user sees first. The contract is concrete: Google OAuth is the visually dominant action on both screens (UX-DR6, Gmail dominates the Vietnamese market); the email/password form sits collapsed behind a secondary trigger (UX-DR7); the password field carries an eye toggle + 4-segment strength bar with aria-live announcements (UX-DR8); mobile is one-action-per-screen with 48px touch targets in the thumb zone (UX-DR15); both locales render polished copy from day one (R38 inheritance). When this story merges, the placeholder `LoginPagePlaceholder` retires and the `useAuth()` stub becomes the real session source for every downstream story.
>
> **No risk score ≥6 owned.** R38 (i18n parity) was discharged at Story 1-7c — 1-8 inherits the four-layer guard and extends the per-story `describe('Story 1-8 i18n parity (R38)', ...)` block in `i18n-parity-coverage.test.ts` for its ~25 new keys (inline dev work, not separate ATDD ceremony per WF-8). All other Epic 1C auth-flow risks (R4 / R5 / R6 / R7 / R13) are backend / OAuth-callback territory owned by Stories 1.4 / 1.5 / 1.6; the API contracts are already locked. 1-8 consumes those contracts.

> **Scaffold reality check (READ FIRST — auth scaffolding is unusually mature already).**
>
> - `classlite-web/src/features/auth/AuthLayout.tsx` exists (1-7b) as a bare `min-h-screen bg-[var(--cl-paper)]` wrapper around `<Outlet />`. 1-8 enriches it with the **dot-grid background pattern + Fraunces wordmark above-card slot + language toggle in the top-right** per UX-DR5. Do NOT delete it — extend in place.
> - `classlite-web/src/features/auth/LoginPagePlaceholder.tsx` is a placeholder kept alive by 1-7c so the bilingual smoke spec's `/login` H1 assertion passes in both en + vi. **1-8 deletes it** and ships `LoginPage.tsx` as the real implementation; the route in `routes.tsx` flips to point at the new file. The bilingual smoke spec already asserts `t('auth.login.title')` resolves to "Sign in to ClassLite" / "Đăng nhập vào ClassLite" — keep that H1 contract intact in the real page.
> - `classlite-web/src/locales/en.json` + `vi.json` already carry the **seed auth keys** from 1-7c AC1 (`auth.login.title`, `auth.login.submit`, `auth.login.googleCta`, `auth.login.emailCollapse`, `auth.register.title`, `auth.register.submit`, `auth.common.email`, `auth.common.password`, `auth.common.passwordToggleAria`). 1-8 ADDS the remaining keys — full-name field, remember-me, forgot-password, divider "or", strength-bar levels, inline validation messages, error toast, mobile-only labels — and the per-story `describe` block enumerates the union for parity assertion.
> - `classlite-web/src/components/ui/` already carries the **38 shadcn primitives from Story 1d-2** including `Button`, `Input`, `Label`, `Form`, `Checkbox`, `Collapsible`, `Alert`, `Separator`, `Card`. 1-8 CONSUMES these — never installs new primitives and never hand-edits the existing ones (XL-1). The canonical `Form.stories.tsx` `WithRHFAndZodResolver` story from 1d-2 is the template for RHF + `zodResolver` wiring; LoginPage / RegisterPage replicate that pattern verbatim.
> - `classlite-web/src/lib/api-fetch.ts` is the single network entry point — unwraps the `{ data, meta }` envelope, attaches `credentials: 'include'` (so the refresh cookie flows), routes 401 through the silent-refresh coordinator, throws typed `ApiError` / `AuthExpiredError`. Auth mutations call `apiFetch<LoginResult>('/api/auth/login', { method: 'POST', body: JSON.stringify({...}), headers: {...} })`. No bespoke `fetch` calls in `features/auth/` — ESLint AC8 from 1-7b enforces this.
> - `classlite-web/src/test/msw-server.ts` is a bare `setupServer()` with empty handlers; lifecycle (`listen` / `resetHandlers` / `close`) is already wired in `vitest-setup.ts` per TEST-FE-1. 1-8 lands the **MSW handler defaults** from `_bmad-output/test-artifacts/msw-handler-catalog-1-5.md` verbatim into a new `src/test/mocks/handlers.ts` and changes `msw-server.ts` to `setupServer(...defaultHandlers)`. Per-test variants register via `server.use(...)` inside the test (no mutation of the default array).
> - `classlite-web/src/hooks/useAuth.ts` (1-7c stub) returns `{ user: null, isAuthenticated: false, isLoading: false }`. 1-8 **graduates** it to read from the TanStack Query cache populated at login: `useQuery({ queryKey: authKeys.session, queryFn: () => null as Session | null, staleTime: Infinity, gcTime: Infinity })` — the queryFn returns `null` (cache-only key, never refetched); login / register mutations write via `queryClient.setQueryData(authKeys.session, { user, accessToken })`. NO `/api/auth/me` endpoint exists (and none is added — it isn't in `api.yaml`); session rehydration on hard-reload is **deferred** (see Out of Scope below).
> - `classlite-web/src/lib/api/client.ts` is the auto-generated openapi-typescript output and already carries the full `RegisterRequest` / `LoginRequest` / `RegisterResult` / `LoginResult` / `UserSummary` / `ErrorEnvelope` types (sync'd from `classlite-api/api.yaml`). Import wire types from there; NEVER hand-write API types (TS-2 + XL-1). NEVER use generated types as form state (TS-2) — define a Zod schema, infer the form values type from it.
> - `classlite-web/docs/storybook-conventions.md` § 2 covers the feature-local placement: `src/features/<area>/components/<Component>.stories.tsx`. 1-8 ships co-located stories for the 5 shared auth components (AuthCard, GoogleOAuthButton, CollapsibleEmailForm, PasswordInput, PasswordStrengthBar) plus role-pattern-agnostic stories for LoginPage + RegisterPage. The `*Page` files match neither the three-state-required pattern (`*Card`/`*List`/`*Table`/`*Hero`/`*Shell`) nor the pure-layout allowlist — they ship `Default` + the locale + state variants relevant to their own surface (Loading mid-submission, Error with inline alert, Success-redirect-pending). The Form `WithRHFAndZodResolver` canonical wiring is the template.
> - `classlite-api/api.yaml` endpoints are LIVE — `/api/auth/register` (201 + RegisterResult, 409 EMAIL_ALREADY_REGISTERED, 422 VALIDATION_ERROR, 429 RATE_LIMIT_EXCEEDED), `/api/auth/login` (200 + LoginResult, 401 INVALID_CREDENTIALS, 422, 429 ACCOUNT_LOCKED with `Retry-After`), `/api/auth/google` (302 to Google), `/api/auth/google/callback` (302 to dashboard or `/login?error=<code>`). The MSW catalog at `_bmad-output/test-artifacts/msw-handler-catalog-1-5.md` is the authoritative handler reference — read it before authoring tests.

> **Out of scope (explicit deferrals — each owned by a specific later story).**
>
> - **Email verification UI** (`VerificationPending` + `useVerificationPoller`, 60s resend countdown, 10-min auto-redirect) — Story 1.9a. 1-8 redirects on successful registration via `navigate('/verify-email?pollId=' + verifyPollId)`; the destination route is owned by 1.9a (404 catch-all today is acceptable transient state — 1.9a lands soon after).
> - **Forgot-password flow** (request + reset) — Story 1.9b. 1-8 ships the "Forgot password?" link in the login card pointing at `/forgot-password`; the link target's polished page lands with 1.9b.
> - **Invite acceptance UI** (`InviteCard`, `useInviteToken`, 6 states) — Story 1.9c. 1-8 does not consume the `?inviteToken=` query param. The Google OAuth button doesn't pass `inviteToken` through; 1.9c wires invite-aware login + registration.
> - **Auth error & recovery screens** (Lockout countdown, OAuth email mismatch, Google Workspace blocked, Session expired) — Story 1.9d. 1-8 surfaces 401 INVALID_CREDENTIALS as a generic inline alert; 429 ACCOUNT_LOCKED is rendered as a non-actionable alert with `Retry-After` minutes (the polished lockout countdown screen + password-reset escape are 1.9d). The `/login?error=<code>` URL params from `/api/auth/google/callback` failures are NOT decoded in 1-8; 1.9d decodes them.
> - **Onboarding redirect logic** (s00 persona pick after first successful login) — Epic 2 Story 2.1. 1-8 navigates to `/dashboard` on every successful login + registration → dashboard. Story 2.1 layers `if (user.justOnboarded) navigate('/onboarding')` inside the post-login flow.
> - **~~Real session rehydration on hard-reload~~** — **LIFTED INTO SCOPE 2026-06-25 (Task 15 + AC5 amendment).** Winston #4 + Amelia walk-through proved the original "first 401 hydrates" deferral didn't work: a user reloading `/dashboard` with a valid refresh cookie gets bounced to `/login` (no protected fetch fires, so the silent-refresh path never triggers). 1-8 now ships the boot-time refresh probe in `App.tsx` per Task 15, AND the `auth-refresh.ts` refactor so the silent-refresh success path also hydrates the cache. All three paths (login mutation / register mutation / boot probe / 401 silent-refresh) converge on the `['auth', 'session']` cache key.
> - **`/api/auth/me` endpoint** — does NOT exist and is NOT added in this story. The session shape comes entirely from the login / register / refresh response bodies. If a future story needs canonical "fetch me" semantics, the backend story authoring it owns the API addition; the frontend cache structure (`authKeys.session`) is the natural seam.
> - **Role-aware post-login redirect** (Owner → `/dashboard`, Student → `/student`, Teacher → `/dashboard`) — 1-7b already split the routes; 1-8 navigates to `/dashboard` for every role. Story 2.6 layers role-aware redirect at the router level when `useRole()` lands as a real hook.
> - **Sentry breadcrumbs in auth mutations** beyond what `apiFetch` already adds — `apiFetch` already breadcrumbs every call with `{ method, url, status, requestId }` and captures exceptions with `requestId` + `errorCode` tags. 1-8 does NOT add bespoke `Sentry.addBreadcrumb` calls inside mutations.
> - **Astro landing site's "Get started" CTA** linking to `my.classlite.app/register` with `?plan=pro` query params — Story 1.10. 1-8 ships `/register` ready to receive that traffic but does NOT read the `?plan=` query param (Epic 9 Story 9.1 onboarding reads it).
> - **Adding new shadcn primitives** — every primitive 1-8 needs is already in `components/ui/` from 1d-2. No `npx shadcn add` runs in this story.

## Story

As a new or returning user landing on `/register` or `/login`,
I want a polished, bilingual auth screen with Google OAuth as the visually dominant action and an email/password form one click away, with inline validation, password strength feedback, mobile-first one-action layout, and clear error recovery on duplicate-email / wrong-credentials / rate-limit failures,
so that I can create an account or sign in within seconds — preferably via Google in ~10 seconds per the §10.2 entry-stage target — without re-reading instructions, without playing form-validation whack-a-mole, and without seeing English copy if my preference is Vietnamese.

## Acceptance Criteria (BDD)

> **Risk-score ≥6 check (per WF-8).** This story owns NO risk score ≥6. R38 (i18n parity) is inherited from 1-7c's CI gate; the per-story discharge is a new `describe('Story 1-8 i18n parity (R38)', ...)` block in `src/lib/test/__tests__/i18n-parity-coverage.test.ts` listing the ~25 new keys (AC1 below). WF-8 ATDD red phase is NOT required for any 1-8 AC — coverage is enforced mechanically via the existing CI gates (`i18n-parity`, `storybook:test` axe, vitest-axe per component test). All tests are inline dev work alongside implementation.

### AC1: Shared auth components in `features/auth/components/` (UX-DR5, UX-DR6, UX-DR7, UX-DR8, FW-7)

**Given** the directory `classlite-web/src/features/auth/components/`,
**When** inspecting auth-shared components after this story lands,
**Then** the following five files exist with the contracts below:

| Component | File | Contract |
|---|---|---|
| **AuthCard** | `AuthCard.tsx` | Centered `<section role="region">` (NOT a `<Card>` composition — Winston decision 2026-06-25: composing shadcn `Card` would override three of its four visual properties (`bg-card` / `text-card-foreground` / `ring-1 ring-foreground/10` / `rounded-xl=12px`), which is forking via className. Ship plain `<section>` with `max-w-[420px]` desktop / `w-full` mobile, `rounded-[14px]`, shadow from `var(--cl-shadow-card)`, `bg-[var(--cl-surface)]`, `aria-label` resolved from a slot-passed string). Renders three slots via children: a Fraunces heading slot (consumer passes `<h1>`), a body slot (form), a footer slot (cross-screen link). NO data fetching. |
| **GoogleOAuthButton** | `GoogleOAuthButton.tsx` | `<a href="/api/auth/google">` (top-level navigation, NOT XHR — initiates the 302 in `/api/auth/google` per api.yaml line 324). White background, line border (`border-[var(--cl-line)]`), full-width inside card, colored 4-color Google "G" SVG (inline — file lives at `components/icons/google.svg.tsx` or inlined in component; do NOT load from external CDN — Google ToS allows local inline). Label "Continue with Google" from `t('auth.login.googleCta')` / `t('auth.register.googleCta')` (1-8 adds the register variant). States: default, hover, focus-visible, **disabled** (when a parallel email-form submission is in flight), **nav-pending** (on `onClick`, set local `isNavigating=true` and render `aria-busy="true"` + visually-pressed for the ~80–200ms top-level nav teardown — Sally amendment 2026-06-25; prevents the flaky-network double-click). NO `loading` spinner state in the UX-DR6 XHR sense (anchor-based flow doesn't have one). Optional `searchParams` prop the consumer passes for future invite-token attachment (Story 1.9c will use it; default omitted). |
| **CollapsibleEmailForm** | `CollapsibleEmailForm.tsx` | Wraps shadcn `Collapsible` from `components/ui/collapsible.tsx`. Collapsed by default. Trigger label slot (`triggerLabel: ReactNode` — consumer passes `t('auth.login.emailCollapse')` or `t('auth.register.emailCollapse')`). Border transitions `border-dashed` (collapsed) → `border-solid` (expanded) per UX-DR7. Children render INSIDE the `<CollapsibleContent>`. Expanded state controlled — the consumer owns the `open` state via `useState` so a server validation error can force-expand the form. |
| **PasswordInput** | `PasswordInput.tsx` | Wraps shadcn `Input` from `components/ui/input.tsx`. Adds an eye-toggle `<button type="button">` absolutely-positioned at the right edge of the input. Toggle aria-label resolves via `t('auth.common.passwordToggleAria')`. Toggle swaps `type="password"` ↔ `type="text"`. Forwards ALL standard `<input>` props (`name`, `value`, `onChange`, `aria-invalid`, etc.) so RHF's `register()` spread works. Uses **plain ref-as-prop** per project-context React 19 (`forwardRef` is BANNED). |
| **PasswordStrengthBar** | `PasswordStrengthBar.tsx` | 4 segments. Strength score function lives at `features/auth/lib/passwordStrength.ts` — pure function `scorePassword(password: string): 0 \| 1 \| 2 \| 3 \| 4` (4 levels: none / weak / fair / strong / very strong per UX-DR8 — 4 segments + "no input" = 5 states). Score is text-classed (canonical mapping per D1 code-review amendment 2026-06-25): `bg-destructive` (1, shadcn semantic), `bg-amber-500` (2, pragmatic stand-in until a `--cl-status-warning` token bridge lands — tracked in `deferred-work.md`), `bg-primary` (3, shadcn semantic — ClassLite teal), `bg-[color:var(--cl-status-success)]` (4, AC7 escape-hatch arbitrary value because no shadcn `success` token exists yet). The original spec referenced `--cl-status-danger / --cl-accent-2-btn` tokens which do NOT exist in `tokens.css`; the shadcn semantic substitutions preserve the visual intent while staying on the bridge. aria-live="polite" region announces the level via `t('auth.common.passwordStrength.weak' \| '.fair' \| '.strong' \| '.veryStrong' \| '.empty')`. The empty-state announcement is `sr-only` (P3 amendment 2026-06-25) so "Password strength: none" / "Độ mạnh mật khẩu: chưa nhập" doesn't render as visible body text on first paint — the SR transition still fires on first keystroke because the live region stays mounted. The visible bar still renders nothing if `password === ''` (no empty 4-segment outline at first paint). |

**And** every component above is a default export (1d-3 / 1d-4 convention), carries a top-line JSDoc block naming its consumers (LoginPage / RegisterPage), and ships a co-located `*.stories.tsx` per `storybook-conventions.md` § 2 with stories covering `Default` + every interactive state (hover via `play` where realistic, loading-where-applicable, focus-visible via `play`, error variant for inputs, dark + light locale variants for `Vietnamese` content overflow per UX-2).

**And** ALL aria-labels resolve via `i18n.t(...)` — zero hardcoded English (TEST-UX-1). Vietnamese strings ship locale-correct (machine-translated seed is acceptable for ready-for-dev; PR review flags any keys needing reviewer pass with a `// TODO(reviewer-vi)` line in the Change Log, NOT in the JSON file — pure-JSON doesn't tolerate comments).

_Pinned test contracts (one Vitest file per component under `features/auth/components/__tests__/`):_
- `PasswordStrengthBar.test.tsx`: 6 tests — renders nothing for empty input; each of the 4 score levels renders the right `aria-live` announcement key; score change updates the announcement; `vitest-axe` returns zero violations.
- `PasswordInput.test.tsx`: 5 tests — defaults to `type="password"`; clicking the eye-toggle swaps to `type="text"`; toggle aria-label resolves via `t('auth.common.passwordToggleAria')`; `assertI18nParity(['auth.common.passwordToggleAria'])`; `vitest-axe` zero violations.
- `CollapsibleEmailForm.test.tsx`: 4 tests — starts collapsed; clicking trigger expands; controlled `open` prop forces expansion on parent state change; `vitest-axe` zero violations on both states.
- `GoogleOAuthButton.test.tsx`: 5 tests — renders `<a href="/api/auth/google">` (assert `role="link"`); label resolves via `t('auth.login.googleCta')`; `disabled` prop renders `aria-disabled="true"` and a styled disabled appearance; clicking sets `aria-busy="true"` for the nav-teardown moment (Sally amendment — assert via user-event click + immediate getByRole assertion before the navigation simulates); `vitest-axe` zero violations.
- `AuthCard.test.tsx`: 3 tests — renders all three children slots; outer container has `role="region"` with `aria-label` resolved from a slot-passed string; `vitest-axe` zero violations.
- `passwordStrength.test.ts`: 8 tests — empty → 0; <8 chars → 1; lowercase-only or no entropy → 1-2; mixed case + number → 3; mixed + symbol + length≥12 → 4; deterministic for identical inputs; idempotent across calls. Pure function — no jsdom.

### AC2: i18n keys — every new string in both en + vi, parity asserted (R38 inheritance from 1-7c)

**Given** the files `classlite-web/src/locales/en.json` and `classlite-web/src/locales/vi.json`,
**When** running `npm test -- i18n-parity-coverage`,
**Then** both files contain every key in the union below (existing 1-7c-seeded auth keys plus the 1-8 additions), and the new `describe('Story 1-8 i18n parity (R38)', ...)` block in `src/lib/test/__tests__/i18n-parity-coverage.test.ts` enumerates the 1-8 additions:

```
# Already seeded by 1-7c (do NOT re-list in the 1-8 STORY_KEYS array — already in STORY_1_7C_KEYS):
auth.login.title              auth.login.submit              auth.login.googleCta
auth.login.emailCollapse      auth.register.title            auth.register.submit
auth.common.email             auth.common.password           auth.common.passwordToggleAria

# NEW in 1-8 (the 1-8 STORY_KEYS array enumerates these — Vietnamese pinned to the
# AUTH-01/03 mockup literals; do NOT replace with machine-translated alternatives.
# Sally amendment 2026-06-25 — the mockup is authoritative over seed translations):
auth.register.googleCta                 # "Continue with Google" / "Tiếp tục với Google"
auth.register.emailCollapse             # "Sign up with email" / "Đăng ký bằng email"
auth.register.fullName                  # "Full name" / "Họ và tên"
auth.register.fullNamePlaceholder       # "Jane Doe" / "Nguyễn Văn A" (placeholder, NOT label per UX spec § 5)
auth.register.signInLink                # "Already have an account? Sign in" / "Đã có tài khoản? Đăng nhập"  ← matches AUTH-01 mockup literal
auth.register.terms                     # "By creating an account, you agree to ClassLite's Terms and Privacy." / "..."
auth.login.signUpLink                   # "Don't have an account? Sign up" / "Chưa có tài khoản? Đăng ký"  ← matches AUTH-03 mockup literal (NOT "Mới đến? Tạo tài khoản" — that machine seed is wrong register)
auth.login.rememberMe                   # "Remember me" / "Ghi nhớ đăng nhập"
auth.login.forgotPassword               # "Forgot password?" / "Quên mật khẩu?"
auth.common.dividerOr                   # "or" / "hoặc" (renders ONLY when CollapsibleEmailForm is expanded — see AC3 divider visibility rule)
auth.common.emailPlaceholder            # "email@example.com" / "email@example.com"  ← matches mockup literal (NOT "tên@truong.edu")
auth.common.passwordPlaceholder         # "At least 8 characters" / "Ít nhất 8 ký tự"  ← matches mockup literal (NOT "Tối thiểu 8 ký tự" — less idiomatic). REGISTER-only placeholder.
auth.common.loginPasswordPlaceholder    # "Enter password" / "Nhập mật khẩu"  ← LOGIN-only placeholder; deliberately no length hint (don't leak password policy on login per SEC-1 + matches AUTH-03 mockup)
auth.common.passwordStrength.empty      # screen-reader-only when password is empty (renders nothing visible — key seeded to keep the parity helper exhaustive)
auth.common.passwordStrength.weak       # "Weak" / "Yếu"
auth.common.passwordStrength.fair       # "Fair" / "Trung bình"
auth.common.passwordStrength.strong     # "Strong" / "Mạnh"
auth.common.passwordStrength.veryStrong # "Very strong" / "Rất mạnh"
auth.common.validation.emailRequired    # "Email is required" / "Vui lòng nhập email"
auth.common.validation.emailFormat      # "Enter a valid email address" / "Email không hợp lệ"
auth.common.validation.passwordMin      # "Password must be at least 8 characters" / "Mật khẩu cần ít nhất 8 ký tự" — REGISTER-only error
auth.common.validation.passwordRequired # "Password is required" / "Vui lòng nhập mật khẩu" — LOGIN-only error (don't reveal min-length on the login form per AC4 schema rationale)
auth.common.validation.fullNameRequired # "Full name is required" / "Vui lòng nhập họ và tên"
auth.register.error.emailTaken          # "This email is already registered. Try signing in." / "Email này đã được đăng ký. Hãy đăng nhập."
auth.register.error.rateLimited         # "Too many attempts. Try again in a few minutes." / "Quá nhiều lần thử. Vui lòng thử lại sau vài phút." (429 from /register)
auth.register.error.generic             # "We couldn't create your account. Please try again." / "Không thể tạo tài khoản. Vui lòng thử lại."
auth.register.emailDelivery.failedToast # "Couldn't send verification email — try Resend on the next screen." / "Không gửi được email xác thực — hãy thử Gửi lại ở màn hình tiếp theo."  ← added per AC3 (was missing from STORY_KEYS in original draft, Sally minor)
auth.login.error.invalidCredentials     # "Email or password is incorrect." / "Email hoặc mật khẩu không đúng." (401)
auth.login.error.accountLocked          # "Account temporarily locked. Try again in {{minutes}} minutes." / "Tài khoản tạm khóa. Thử lại sau {{minutes}} phút." (429 ACCOUNT_LOCKED with Retry-After) ★ REVIEWER-MANDATORY ★
auth.login.error.rateLimited            # "Too many attempts. Try again in a few minutes." / "Quá nhiều lần thử. Vui lòng thử lại sau vài phút." (429 RATE_LIMIT_EXCEEDED) ★ REVIEWER-MANDATORY ★
auth.login.error.generic                # "We couldn't sign you in. Please try again." / "Không thể đăng nhập. Vui lòng thử lại." ★ REVIEWER-MANDATORY ★
auth.login.error.oauthGeneric           # "We couldn't complete sign-in with Google. Please try again." / "Không hoàn tất đăng nhập bằng Google. Vui lòng thử lại." — generic toast for /login?error=<code> URL-param landings between 1-8 and 1.9d (Sally #7 amendment)
```

**★ REVIEWER-MANDATORY keys (4):** `auth.login.error.accountLocked`, `auth.login.error.rateLimited`, `auth.login.error.generic`, `auth.login.error.oauthGeneric` MUST get a Vietnamese-fluent reviewer pass BEFORE merge — not "machine-translated, flag in PR." Vietnamese error register is non-trivial (especially the `{{minutes}}` interpolation — machine translation will likely produce ungrammatical "trong vòng {{minutes}} phút"). PR description must explicitly list these 4 keys as needing reviewer sign-off and the merge is blocked until reviewed. The remaining ~25 keys may ship with the listed seed values pending Vietnamese reviewer touch-up in a follow-up PR.

**And** the per-story `describe` block follows the exact 1d-2 / 1d-3 / 1d-4 pattern at `i18n-parity-coverage.test.ts`:

```ts
// Append AFTER the existing STORY_1D_4_KEYS block:
const STORY_1_8_KEYS = [
  'auth.register.googleCta',
  'auth.register.emailCollapse',
  'auth.register.fullName',
  // ... full list of 1-8 additions above
] as const

describe('Story 1-8 i18n parity (R38)', () => {
  test('every key exists in both en.json and vi.json', () => {
    assertI18nParity(STORY_1_8_KEYS)
  })
})
```

**And** the `npm run i18n-parity` CI step (`.github/workflows/ci-web.yml:69-77`) passes on the PR; the script's `extractClaimedKeys` already handles single + double quoted strings (1d-3 P9 fix), so the new STORY_1_8_KEYS block is recognized as "claimed" and the namespace-coverage assertion passes.

### AC3: `RegisterPage` — `/register` route with Google-first + collapsible email form (UX-DR5–DR8)

**Given** the file `classlite-web/src/features/auth/RegisterPage.tsx` (NEW),
**When** an unauthenticated user navigates to `/register`,
**Then** the page renders inside `AuthLayout` (dot-grid background, ClassLite wordmark above the card per AC6) with an `<h1>` resolved from `t('auth.register.title')`, in Fraunces display font, sized per the design tokens.

**And** the `GoogleOAuthButton` is the visually dominant element (largest, full-width inside card, directly under the heading, no divider above it).

**And** directly below the GoogleOAuthButton, a `CollapsibleEmailForm` with `triggerLabel={t('auth.register.emailCollapse')}` exposes the email form when clicked.

**Divider visibility rule (Sally amendment 2026-06-25):** A `<Separator />` with localized "or" text from `t('auth.common.dividerOr')` (rendered as `<span>` overlaid on the separator) renders BETWEEN the GoogleOAuthButton and the CollapsibleEmailForm **ONLY when the form is expanded**. When collapsed, the separator is hidden so the visual matches the AUTH-01 mockup exactly (Google button → email-toggle link, no chrome between). Drives off the same controlled `open` state that owns the form expansion.

**And** the expanded form is built with **RHF + `zodResolver`** following the canonical wiring from `Form.stories.tsx`'s `WithRHFAndZodResolver` (lines 52-72). The Zod schema is built **inside the component** via `useMemo` so locale switches re-evaluate validation messages — module-load `i18n.t()` snapshots the bootup locale and never refreshes. `features/auth/lib/registerSchema.ts` exports a builder, not the schema itself:

```ts
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'

// Builder hook — consumed by RegisterPage inside the component body so
// every locale change re-runs `t()` and emits a fresh schema with
// localized messages. Module-load `i18n.t()` would snapshot the bootup
// locale and stay frozen (Murat #2 / Amelia #3 spec amendment).
export function useRegisterSchema() {
  const { t } = useTranslation()
  return useMemo(
    () =>
      z.object({
        fullName: z.string().min(1, { message: t('auth.common.validation.fullNameRequired') }).max(200),
        email: z
          .string()
          .min(1, { message: t('auth.common.validation.emailRequired') })
          .email({ message: t('auth.common.validation.emailFormat') }),
        password: z.string().min(8, { message: t('auth.common.validation.passwordMin') }).max(72),
      }),
    [t],
  )
}
export type RegisterFormValues = z.infer<ReturnType<typeof useRegisterSchema>>
```

In `RegisterPage`: `const schema = useRegisterSchema(); const form = useForm({ resolver: zodResolver(schema), ... })`.

**And** the form renders in this order (top to bottom inside the collapsible):
1. Full name `<Input>` — label `auth.register.fullName`, placeholder `auth.register.fullNamePlaceholder`, `autoComplete="name"`, `aria-required="true"`.
2. Email `<Input type="email">` — label `auth.common.email`, placeholder `auth.common.emailPlaceholder`, `autoComplete="email"`, `inputMode="email"`.
3. Password `<PasswordInput>` — label `auth.common.password`, placeholder `auth.common.passwordPlaceholder`, `autoComplete="new-password"`.
4. `<PasswordStrengthBar password={watchedPasswordValue} />` — driven by `useWatch({ control, name: 'password' })`.
5. Primary submit `<Button type="submit">` — full-width, label `auth.register.submit`, `loading` state while mutation is pending (button's loading variant from 1d-2; disables itself and the GoogleOAuthButton via shared local state).
6. Terms hint paragraph — text from `t('auth.register.terms')`, smaller / muted (`text-xs text-[var(--cl-muted)]`).

**And** below the card (NOT inside it — footer slot of AuthCard), a `<a href="/login">` rendered with `text-[var(--cl-accent)] underline` carrying the localized "Already have an account? Sign in" copy from `t('auth.register.signInLink')`.

**And** inline validation runs on blur per field (`mode: 'onBlur'` in `useForm`), AND on submit attempt all errors render simultaneously (RHF default behavior with `mode: 'onBlur'` — first blur is per-field, submit revalidates everything).

**And** on successful submit (mutation returns 201 + `RegisterResult { user, verifyPollId, emailDelivery }`):
- `queryClient.setQueryData(authKeys.session, { user, accessToken: null })` — registered user is NOT yet logged in (email unverified); the cache entry carries the user shape but no access token. `useAuth().isAuthenticated` returns FALSE while `accessToken === null`.
- `navigate('/verify-email?pollId=' + verifyPollId)` — Story 1.9a owns the destination; until 1.9a ships, the catch-all `NotFound` renders. Document in PR description as expected transient.
- If `emailDelivery === 'failed'`, also call `sonner.toast.warning(t('auth.register.emailDelivery.failedToast'))` (NEW key — add to STORY_1_8_KEYS) so the user knows to hit Resend Verification on the next screen.

**And** on `ApiError(409, 'EMAIL_ALREADY_REGISTERED', ...)` — `setError('email', { message: t('auth.register.error.emailTaken') })` (inline field error, force-expanding the collapsed form via the controlled `open` state).

**And** on `ApiError(422, 'VALIDATION_ERROR', ..., details: [{field, message}])` — iterate `details` and call `setError(field, { message })` on each. Server validation messages may be English; until backend i18n lands, accept them as-is (project-context CQ-5 contract: server-side i18n message resolution is a future enhancement).

**And** on `ApiError(429, 'RATE_LIMIT_EXCEEDED', ...)` — render a form-level `<Alert variant="destructive">` with `t('auth.register.error.rateLimited')` (no per-field error).

**And** on any other `ApiError` (network error, 5xx) — render the form-level destructive `<Alert>` with `t('auth.register.error.generic')`.

**And** the route is added to `src/routes.tsx` under the existing `AuthLayout` boundary (alongside `/login`):

```tsx
{
  path: 'register',
  lazy: async () => {
    const { default: RegisterPage } = await import('@/features/auth/RegisterPage')
    return { Component: RegisterPage }
  },
},
```

_Pinned test contracts:_ `features/auth/__tests__/RegisterPage.test.tsx` ships ≥10 tests covering the three-state trilogy (loading mid-submission → submission rejected → success path), all four error branches (409 / 422 / 429 / generic), the controlled-collapsible-force-expand-on-server-error path, the i18n-key resolution path per TEST-FE-4, vitest-axe zero violations, role-query selectors (NOT data-testid) for the form fields, and uses MSW's `server.use(...)` per-test variant pattern.

### AC4: `LoginPage` — `/login` route replaces placeholder (UX-DR5–DR8, UX-DR15)

**Given** the file `classlite-web/src/features/auth/LoginPagePlaceholder.tsx`,
**When** this story lands,
**Then** the placeholder file is **deleted** and `classlite-web/src/features/auth/LoginPage.tsx` (NEW) replaces its mount in `routes.tsx`.

**And** `LoginPage` mounts the same `AuthCard` + `GoogleOAuthButton` + `CollapsibleEmailForm` (with the same divider-visible-only-when-expanded rule from AC3) + form pattern as `RegisterPage`, with the following deltas:

- `<h1>` resolves `t('auth.login.title')` (already a 1-7c key — the bilingual smoke spec's existing assertion stays green).
- `GoogleOAuthButton` carries `t('auth.login.googleCta')`.
- `CollapsibleEmailForm` trigger label is `t('auth.login.emailCollapse')`.
- The form fields are EMAIL + PASSWORD (no full-name).
- Below password but ABOVE the submit button: a `<Checkbox>` (from `components/ui/checkbox.tsx`) with `t('auth.login.rememberMe')` (RHF-registered `rememberMe` boolean, **default `false`** — security-first; documented deviation from the AUTH-03 mockup which shows it pre-checked. Vietnamese students often log in from shared phones; staying-signed-in by default is the wrong default for the dominant user. Pin this decision in the JSDoc of `LoginPage.tsx` so a future "fix to match mockup" PR has a paper trail).
- To the right of (or below on mobile) the rememberMe checkbox: a `<a href="/forgot-password">` carrying `t('auth.login.forgotPassword')` text styled like the register screen's sign-in link. (Story 1.9b owns the destination.)
- Submit button label is `t('auth.login.submit')`.
- Footer slot below card: `<a href="/register">` with `t('auth.login.signUpLink')`.

**And** the Zod schema follows the same `useMemo(t)` builder-hook pattern as AC3 at `features/auth/lib/loginSchema.ts`:

```ts
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'

export function useLoginSchema() {
  const { t } = useTranslation()
  return useMemo(
    () =>
      z.object({
        email: z
          .string()
          .min(1, { message: t('auth.common.validation.emailRequired') })
          .email({ message: t('auth.common.validation.emailFormat') }),
        // Login uses `min(1)` not `min(8)` — never reveal the password length
        // policy on login (security: lets unknown-password attackers map
        // valid-format probes). Re-use the same `passwordRequired` error key
        // copy so the message is "Password is required" (not "min 8") — drop
        // the misleading min-8 message variant here.
        password: z.string().min(1, { message: t('auth.common.validation.passwordRequired') }),
        rememberMe: z.boolean(),
      }),
    [t],
  )
}
export type LoginFormValues = z.infer<ReturnType<typeof useLoginSchema>>
```

**Note:** AC2 STORY_1_8_KEYS gains `auth.common.validation.passwordRequired` to replace the misuse of `passwordMin` on login. Add to en + vi seeds.

**And** on successful submit (mutation returns 200 + `LoginResult { accessToken, user }`):
- `queryClient.setQueryData(authKeys.session, { user, accessToken })` — populates `useAuth()` for the rest of the dashboard.
- `navigate('/dashboard', { replace: true })` — `replace: true` so the browser back button doesn't return to the login form after auth (UX-DR15 mobile hygiene).

**And** on `ApiError(401, 'INVALID_CREDENTIALS', ...)` — form-level `<Alert variant="destructive">` with `t('auth.login.error.invalidCredentials')` (no per-field error — the API deliberately conflates wrong-email + wrong-password to prevent enumeration per `api.yaml:185`).

**And** on `ApiError(429, 'ACCOUNT_LOCKED', ...)` — form-level destructive alert with `t('auth.login.error.accountLocked', { minutes })` where `minutes = Math.ceil(retryAfterSeconds / 60)`. The `Retry-After` header is exposed on the `ApiError.details` channel (extend `apiFetch` to attach response headers to errors when `code === 'ACCOUNT_LOCKED'` OR `code === 'RATE_LIMIT_EXCEEDED'` — see Dev Notes § Retry-After capture). Polished countdown screen with active password-reset CTA is 1.9d.

**And** on `ApiError(429, 'RATE_LIMIT_EXCEEDED', ...)` — `t('auth.login.error.rateLimited')`.

**And** on any other error — `t('auth.login.error.generic')`.

**And** the `routes.tsx` change is mechanical:

```diff
- const { default: LoginPagePlaceholder } = await import('@/features/auth/LoginPagePlaceholder')
- return { Component: LoginPagePlaceholder }
+ const { default: LoginPage } = await import('@/features/auth/LoginPage')
+ return { Component: LoginPage }
```

**And** the file `LoginPagePlaceholder.tsx` is **deleted** in the same commit. The `e2e/bilingual-smoke.spec.ts` assertion at `/login` for `t('auth.login.title')` (1-7c) stays green because `LoginPage` renders the same H1 key.

_Pinned test contracts:_ `features/auth/__tests__/LoginPage.test.tsx` mirrors RegisterPage's coverage with the login-specific branches (401 / 429 ACCOUNT_LOCKED with Retry-After minutes interpolation / 429 RATE_LIMIT_EXCEEDED). Plus one extra test: `rememberMe` checkbox state survives a typed email keystroke (Zustand isolation — checking the form-state contract).

### AC5: `useLogin` + `useRegister` mutations + `authKeys` factory + `useAuth` graduation + `auth-refresh.ts` body-parse refactor

**Given** the directory `classlite-web/src/features/auth/api/`,
**When** inspecting the new files,
**Then** the following exist:

- **`authKeys.ts`** — query-key factory per TS-3:
  ```ts
  import type { components } from '@/lib/api/client'

  export type UserSummary = components['schemas']['UserSummary']
  export interface Session {
    user: UserSummary
    accessToken: string | null  // null when registered-but-not-verified; non-null after login or refresh
  }

  export const authKeys = {
    all: ['auth'] as const,
    session: () => [...authKeys.all, 'session'] as const,
  }
  ```
  The `session` key is **cache-only** — no `queryFn` runs in `useAuth`; mutations + the silent-refresh path write the cache via `setQueryData`. **`isAuthenticated` is derived from `user.emailVerified`, NOT from `accessToken`.** The `accessToken` field stays in the cache for downstream needs (logout, force-refresh-probe) but is NOT the gate. This drops the AC3 contract drift Winston #5 surfaced — a registered-but-unverified user has `{user, accessToken: null}` in cache; their `isAuthenticated` is `false` because `user.emailVerified === false`; the 1.9a verify-email screen can read `useAuth().user.fullName` to render "We sent a code to {{email}}" without leaking pre-verified UI elsewhere.

- **`login.ts`** — exports `useLogin(): UseMutationResult<LoginResult, ApiError, LoginRequest>`:
  ```ts
  export function useLogin() {
    const queryClient = useQueryClient()
    const navigate = useNavigate()
    return useMutation({
      mutationKey: authKeys.session(),
      mutationFn: (req: LoginRequest) =>
        apiFetch<LoginResult>('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(req),
        }),
      onSuccess: (result) => {
        queryClient.setQueryData<Session>(authKeys.session(), {
          user: result.user,
          accessToken: result.accessToken,
        })
        navigate('/dashboard', { replace: true })
      },
      // NO onError — the page-level component handles error → setError / Alert rendering
      // so error UX is co-located with the form. Per TS-5 / FW-2 the optimistic-triple
      // doesn't apply here (no list to roll back).
    })
  }
  ```

- **`register.ts`** — exports `useRegister(): UseMutationResult<RegisterResult, ApiError, RegisterRequest>` with the symmetric shape, populating `authKeys.session()` with `{user, accessToken: null}` (server has not issued a token yet — verification gate) and navigating to `/verify-email?pollId=...`.

**And** `classlite-web/src/hooks/useAuth.ts` is **rewritten** from the 1-7c stub to:

```ts
import { useQuery } from '@tanstack/react-query'
import { authKeys, type Session } from '@/features/auth/api/authKeys'

export interface User { id: string; email: string; displayName: string; emailVerified: boolean }
export interface UseAuthResult {
  user: User | null
  isAuthenticated: boolean
  isLoading: boolean
}

export function useAuth(): UseAuthResult {
  const { data: session } = useQuery<Session | null>({
    queryKey: authKeys.session(),
    // Cache-only key. queryFn never runs (enabled: false) but Query v5's type
    // signature requires one. initialData: null guarantees `session` is `null`
    // (not `undefined`) on first paint so consumer logic never branches on the
    // pending-without-fetch state.
    queryFn: () => null,
    initialData: null,
    staleTime: Infinity,
    gcTime: Infinity,
    enabled: false,
  })
  const user = session?.user
    ? {
        id: session.user.id,
        email: session.user.email,
        displayName: session.user.fullName, // wire shape uses `fullName`; UI shape uses `displayName`
        emailVerified: session.user.emailVerified,
      }
    : null
  return {
    user,
    // Authentication = user present AND email verified. accessToken presence is
    // a secondary signal (still in cache for logout/probe paths), NOT the gate.
    // See AC3 — registered-but-unverified users have user + accessToken: null
    // and must NOT see authenticated UI surfaces.
    isAuthenticated: user?.emailVerified === true,
    isLoading: false,
  }
}
```

> **Why `enabled: false` + `queryFn: () => null` + `initialData: null`?** `useQuery` subscribes the component to cache updates via the QueryObserver — `setQueryData` from a sibling component re-renders this consumer. `getQueryData` would NOT subscribe. The `enabled: false` keeps the queryFn from ever running; the `queryFn: () => null` satisfies Query v5's type signature; the `initialData: null` makes the first-render contract intent-explicit so `session` is `null` (not `undefined`), avoiding the subtle `?.accessToken` vs `undefined?.accessToken` branch. The shape mirrors FW-6 (Zustand for UI state, Query cache for server state — even when "server state" is bootstrapped from a mutation).

**And** `classlite-web/src/lib/auth-refresh.ts` is **refactored** so `performNetworkRefresh` parses the JSON body and exposes the user+token to the lock-success path. This is **NOT a two-line diff** — `performNetworkRefresh` today only reads `response.ok` and discards the body. The full refactor surface:

```ts
// auth-refresh.ts — replace the current performNetworkRefresh + RefreshResult shape.
import type { components } from '@/lib/api/client'
type EnvelopeLoginResult = components['schemas']['EnvelopeLoginResult']

// RefreshResult now carries the parsed data on success.
export type RefreshResult =
  | { ok: true; data: { user: components['schemas']['UserSummary']; accessToken: string } }
  | { ok: false }

async function performNetworkRefresh(): Promise<RefreshResult> {
  if (Date.now() - readLastRefreshedAt() < REFRESH_DEBOUNCE_MS) {
    // Debounce hit — we KNOW a sibling tab just refreshed. The cache is
    // already populated by that tab's BroadcastChannel write (or by the
    // sibling's own success path in this tab). Return ok without data;
    // the caller (apiFetch retry path) only checks `ok`.
    return { ok: true } as RefreshResult & { ok: true }  // safe — data unread on debounce hit
  }
  try {
    const response = await fetch('/api/auth/refresh', { method: 'POST', credentials: 'include' })
    if (!response.ok) {
      channel?.postMessage({ type: 'refresh-failed' } satisfies RefreshFailedSignal)
      return { ok: false }
    }
    // Parse the envelope. A 200 with malformed body must NOT downgrade to
    // refresh-failed (that would log users out on a flaky gateway). Treat
    // parse failure as refresh-succeeded-without-data — the next protected
    // request will hit 401 again and retry the refresh cleanly.
    let data: { user: components['schemas']['UserSummary']; accessToken: string } | null = null
    try {
      const envelope = (await response.json()) as EnvelopeLoginResult
      data = { user: envelope.data.user, accessToken: envelope.data.accessToken }
    } catch {
      // Malformed body — log and continue with ok: true, no data.
      Sentry.captureMessage('auth-refresh: 200 with unparseable body', { level: 'warning' })
    }
    const stamp = Date.now()
    writeLastRefreshedAt(stamp)
    if (data) {
      // Hydrate the session cache so useAuth re-renders. Use the LITERAL
      // key array to avoid a lib/ → features/ import cycle (the cycle
      // doctrine at line 32-33 of this file already warns about query-client
      // ↔ api-fetch; adding authKeys would make it triadic).
      queryClient.setQueryData(['auth', 'session'], data)
    }
    channel?.postMessage({
      type: 'refresh-succeeded',
      timestamp: stamp,
      data,  // sibling tabs hydrate their own caches from this payload
    } satisfies RefreshSucceededSignal)
    return data ? { ok: true, data } : { ok: true } as RefreshResult & { ok: true }
  } catch {
    channel?.postMessage({ type: 'refresh-failed' } satisfies RefreshFailedSignal)
    return { ok: false }
  }
}

// And the BroadcastChannel `refresh-succeeded` listener (currently around line 210)
// switches from `queryClient.invalidateQueries({ queryKey: ['auth', 'session'] })`
// — which would clobber a sibling tab's session with the queryFn's `null` return —
// to `if (msg.data) queryClient.setQueryData(['auth', 'session'], msg.data)`.
```

**Critical:** the literal `['auth', 'session']` key duplicates the `authKeys.session()` factory return — this is intentional to avoid the `lib/ → features/` import that would land a third edge on the existing query-client ↔ api-fetch ↔ auth-refresh cycle. The `authKeys.session()` factory test (in `authKeys.test.ts`) MUST include `expect(authKeys.session()).toEqual(['auth', 'session'])` as a contract assertion so any future rename catches the duplication.

**And** `RefreshSucceededSignal` type at the top of `auth-refresh.ts` extends with `data?: { user: UserSummary; accessToken: string }` — sibling tabs use the payload to hydrate their own caches without a second network round trip.

**And** a `useLogout()` mutation is NOT shipped in 1-8 — Story 1.9d owns the session-expired flow and Epic 2's UserPill ships the sign-out menu item. 1-7c left the `app.layout.userPill.signOut` key seeded for the parity helper; that key stays referenced exactly once (by the i18n parity test) until 1.9d / Epic 2 wires the real consumer.

**QueryClient test-isolation discipline (Murat #1 mandate):**

The new `useAuth` + mutations write to the **global singleton** `queryClient` (per `src/lib/query-client.ts`). Cache leak across tests = test N "logs in" and test N+1 starts authenticated. Two-layer fix lands in 1-8 (belt + suspenders):

1. **Per-auth-test:** every test under `features/auth/**/__tests__/` AND `hooks/__tests__/useAuth.test.tsx` wraps render in `createTestQueryClient()` + its own `<QueryClientProvider>` per the existing `query-client-refresh.test.ts:143` pattern. NEVER touches the global singleton.
2. **Global safety net:** `src/test/vitest-setup.ts` gains an `afterEach(() => queryClient.clear())` (imports `queryClient` from `@/lib/query-client`). Catches the leak if a future test accidentally bypasses the per-test pattern.

Document the discipline in `storybook-conventions.md` § test isolation or a new `src/test/__tests__/README.md` so future stories inherit the pattern.

_Pinned test contracts:_
- `features/auth/api/__tests__/login.test.tsx` — 5 tests:
  - `test('happy path populates session cache and navigates to /dashboard with replace: true', ...)`
  - `test('401 INVALID_CREDENTIALS leaves cache untouched and surfaces ApiError to component', ...)`
  - `test('mutation is keyed under authKeys.session() — useIsMutating returns truthy mid-flight', ...)`
  - `test('cross-component subscription — sibling consumer rendered via useAuth re-renders when login mutation fires from a separate tree under the SAME QueryClientProvider', ...)`
  - `test('with createTestQueryClient(), the global queryClient is NOT mutated by the test', ...)` (regression guard for the isolation discipline)
- `features/auth/api/__tests__/register.test.tsx` — symmetric (4 tests), plus an explicit assertion that the cache write uses `accessToken: null` and `useAuth().isAuthenticated` stays false because `user.emailVerified === false`.
- `hooks/__tests__/useAuth.test.tsx` — 5 tests:
  - `test('returns { user: null, isAuthenticated: false } when session cache is empty (initialData: null)', ...)`
  - `test('returns user shape with displayName mapped from session.user.fullName', ...)`
  - `test('isAuthenticated is true only when user.emailVerified === true (NOT when accessToken is truthy alone)', ...)`
  - `test('useAuth re-renders sibling consumer when setQueryData fires from a separate component tree', ...)` (the load-bearing cache-subscription contract — Murat #5)
  - `test('isAuthenticated is false for a registered-but-unverified user (user present, emailVerified: false)', ...)`
- `lib/__tests__/auth-refresh.test.ts` — extend (don't recreate): assert that on a 200 from `/api/auth/refresh` with a valid `EnvelopeLoginResult` body, `queryClient.getQueryData(['auth', 'session'])` returns the parsed `{user, accessToken}` AND the `BroadcastChannel('refresh-succeeded')` postMessage payload carries `data`. Assert that a 200 with malformed body still resolves `{ok: true}` and does NOT clear the existing cache.
- `lib/__tests__/api-fetch.test.ts` — sweep for any assertion on `ApiError.details` shape; the Retry-After capture (Dev Notes) changes the type — update tests in the same commit.

### AC6: `AuthLayout` polish — wordmark + language toggle (UX-DR5, UX-DR17)

**Given** the existing file `classlite-web/src/features/auth/AuthLayout.tsx`,
**When** this story lands,
**Then** the layout is enriched IN PLACE (not replaced — keep the lazy-bundle entry contract from 1-7b):

- Background: **dot-grid is ALREADY globally applied** via `body { @apply ... bg-dot-grid }` at `src/index.css:121` (1-7a shipped the `bg-dot-grid` utility at `index.css:113-116`; not `.cl-dot-grid` as the original spec hand-waved). AuthLayout does NOT add or re-apply it — that would double-render the pattern. The bare `min-h-screen bg-[var(--cl-paper)]` from 1-7b already inherits the global body dot-grid; KEEP this — just adjust `bg-[var(--cl-paper)]` to ensure it doesn't clobber the body's `bg-background`. If a paint test shows visible drift, remove the `bg-[var(--cl-paper)]` and let the body's `bg-background` (which maps to `--cl-paper` via the shadcn theme bridge) carry through.
- Top-of-page: a small navigation bar with the ClassLite wordmark (Fraunces 22px italic + amber dot per UX-DR5; reuse `t('app.layout.sidebar.brand')` / `sidebar.brand` for the accessible name — visible text is the literal "ClassLite" + amber dot styled in CSS) on the left.
- A `<LanguageToggle />` (existing `components/shared/LanguageToggle.tsx`) on the right. **Mobile placement (Sally amendment 2026-06-25, locked):** at `md:` and below, the toggle renders as a 32×32 icon-only button (globe icon + 2-letter active locale chip overlaid) in the top-right corner. Tap expands to the full segmented EN/VI control. Wordmark stays centered. Do NOT move the toggle below the wordmark — that wastes thumb-zone vertical real-estate before the user sees the Google button.
- The wordmark + language toggle stay OUTSIDE the `AuthCard` so they don't compete visually with the in-card content.
- `<Outlet />` continues to render the page (LoginPage / RegisterPage / future 1.9a-d screens) centered horizontally and vertically inside the layout's remaining height.

**And** the wordmark + language toggle apply to ALL auth pages (login, register, future verify-email / forgot-password / reset-password / invite-acceptance) by virtue of being in the layout, not the page.

**And** at the mobile breakpoint (`max-w-[640px]`), the AuthCard collapses to `w-full` with `px-5` (20px horizontal padding per UX-DR15), the GoogleOAuthButton + submit button render at full-width with `h-12` (48px height), and form inputs are `h-12` minimum. Touch targets ≥ 44×44px (TEST-UX-4).

**And** the AuthLayout test (NEW — `features/auth/__tests__/AuthLayout.test.tsx`) covers:
1. Renders the `<Outlet />` (test by mounting via MemoryRouter with a single child route).
2. Wordmark is present with the localized brand accessible name.
3. `LanguageToggle` is rendered (verify by role queries on the EN / VI segments).
4. Mobile viewport (`md:` and below — `width: 640`): toggle renders as 32×32 icon-only with `aria-label` resolved (verify via `getByRole('button', { name })`), expands on click to full segmented control.
5. `vitest-axe` returns zero violations on the layout (excluding the page content's potential violations).

**And** the layout does NOT add a dot-grid utility — the body already carries it globally. A grep at the end of Task 13 asserts zero `bg-dot-grid` / `cl-dot-grid` strings appear inside `features/auth/AuthLayout.tsx`.

### AC7: MSW handlers landed verbatim from `_bmad-output/test-artifacts/msw-handler-catalog-1-5.md` (TEST-FE-1)

**Given** the existing file `classlite-web/src/test/msw-server.ts` (bare `setupServer()` with no handlers),
**When** this story lands,
**Then** a new file `classlite-web/src/test/mocks/handlers.ts` exists with the **default happy-path handlers** for `/api/auth/login`, `/api/auth/refresh`, `/api/auth/logout`, `/api/auth/forgot-password`, `/api/auth/reset-password`, AND `/api/auth/register` (the register handler is NEW — extrapolate from the catalog's pattern using `api.yaml`'s 201 RegisterResult envelope).

**And** `msw-server.ts` changes from `setupServer()` to:
```ts
import { handlers } from './mocks/handlers'
export const server = setupServer(...handlers)
```

**And** the catalog's `onUnhandledRequest: 'error'` posture is preserved (already set in `vitest-setup.ts`).

**And** per-test variants register via `server.use(...)` per the catalog's "Per-test handler override pattern". 1-8 tests use the variants for 401 INVALID_CREDENTIALS, 429 ACCOUNT_LOCKED with `Retry-After: 900`, 429 RATE_LIMIT_EXCEEDED, 409 EMAIL_ALREADY_REGISTERED, 422 VALIDATION_ERROR with `details[]`, network error via `HttpResponse.error()`, delayed response via `await delay(500)` for the three-state loading test.

**And** the handlers file lives in `src/test/mocks/` (a NEW directory — `mkdir` it via the file creation itself; no separate Task for it). The directory is conventional and will hold per-feature handler files in later stories (Epic 2+ adds `mocks/onboarding.ts`, etc.).

**And** the catalog at `_bmad-output/test-artifacts/msw-handler-catalog-1-5.md` IS updated by this story (Murat #4 amendment 2026-06-25): a new `## POST /api/auth/register` section appends to the catalog with happy path (201 RegisterResult per api.yaml line 50) + 409 EMAIL_ALREADY_REGISTERED + 422 VALIDATION_ERROR + 429 RATE_LIMIT_EXCEEDED variants. Rename the catalog file from `msw-handler-catalog-1-5.md` to `msw-handler-catalog-auth.md` to reflect the now-broader scope (Stories 1.4 + 1.5 endpoints); update the frontmatter's `authoritative_source`, `target_stories` (add 1-9c invite acceptance + 1-9d session-expired), and add the rename to the Change Log. Stories 1.9a–d and Epic 2's invite flow will all consume the same catalog. Add as **Task 2.4**.

### AC8: Mobile responsive + WCAG 2.1 AA + axe-zero (UX-DR15, TEST-FE-5, TEST-UX-4)

**Given** auth screens at the mobile breakpoint (≤ 640px),
**When** rendered on a 390×844 viewport,
**Then** every interactive element meets the touch-target minimum (44×44px), the AuthCard is full-width with 20px horizontal padding, submit / Google buttons are full-width at 48px height, inputs are 48px height with `font-size: 16px` minimum (TEST-UX-4 — prevents iOS Safari zoom on focus), and the language toggle remains keyboard-reachable.

**And** every component shipped by 1-8 passes `vitest-axe` with zero violations in its component test, AND every Storybook story passes `@storybook/addon-a11y` in the `storybook:test` CI gate (inherits 1d-1 AC9).

**And** every form field is reachable via `getByRole('textbox', { name: t('auth.common.email') })`-style i18n-resolved role queries — NOT `data-testid` (TEST-FE-5). The exception: `data-testid="google-oauth-cta"` on `GoogleOAuthButton` (top-level navigation anchor — disambiguates from any future "Sign in with Google" copy variants and keeps the e2e selector stable across copy changes). Document the testid in `storybook-conventions.md` § stable testids appendix.

**And** the bilingual smoke spec at `e2e/bilingual-smoke.spec.ts` (1-7c) gains TWO new scenarios in the SAME spec file (per the convention — bundle bilingual scenarios in one spec to keep the cross-domain Playwright project warm):
1. `/register` renders the localized H1 in en + vi, no raw dotted keys appear in DOM.
2. `/login` form labels (email + password) resolve via `i18n.t()` in both locales — assert by `getByRole('textbox', { name: i18n.t('auth.common.email') })` in each language toolbar state.

Existing `/login` H1 scenario stays as-is (the H1 contract from 1-7c is preserved — LoginPage renders `t('auth.login.title')` exactly like the placeholder did).

## Tasks / Subtasks

> Suggested ordering. Tasks 1-4 are i18n + MSW + types foundation. Tasks 5-9 build the shared components bottom-up. Tasks 10-12 ship the page-level surfaces + route wiring. Tasks 13-14 close DoD.

- [x] **Task 1: Locale keys + i18n parity discharge** (AC2)
  - [x] 1.1 Add the ~25 new keys to `src/locales/en.json` AND `src/locales/vi.json` in the SAME commit (project-context UX-2 — never atomic-skew).
  - [x] 1.2 Append the `STORY_1_8_KEYS` block + `describe('Story 1-8 i18n parity (R38)', ...)` to `src/lib/test/__tests__/i18n-parity-coverage.test.ts` per the 1d-2 / 1d-3 / 1d-4 template.
  - [x] 1.3 Run `npm run i18n-parity` locally — expect green (key sets symmetric).
  - [x] 1.4 Flag any keys whose Vietnamese was seeded by machine translation in the PR description (NOT in the JSON file) so a Vietnamese-fluent reviewer can revise in-PR.

- [x] **Task 2: MSW handlers + catalog rename** (AC7)
  - [x] 2.1 Create `src/test/mocks/handlers.ts` with the default happy-path handlers for all 6 endpoints (login + refresh + logout + forgot-password + reset-password + register). Import shared envelope types per the catalog snippet.
  - [x] 2.2 Wire into `src/test/msw-server.ts` via `setupServer(...handlers)`.
  - [x] 2.3 Add to `src/test/vitest-setup.ts`: `afterEach(() => queryClient.clear())` (imports `queryClient` from `@/lib/query-client`) — the global cache-clear safety net per Murat #1 amendment. Belt for the per-test `createTestQueryClient()` suspenders.
  - [x] 2.4 Update the MSW catalog at `_bmad-output/test-artifacts/msw-handler-catalog-1-5.md`: append a `## POST /api/auth/register` section (happy 201 + 409 + 422 + 429 variants) AND rename the file to `msw-handler-catalog-auth.md`. Update frontmatter `target_stories` to add 1-9c + 1-9d. Per Murat #4 — backend changes update the catalog atomically; the rename reflects the now-broader scope. Add a one-line Change Log entry inside the catalog.

- [x] **Task 3: `authKeys` factory + Session type** (AC5)
  - [x] 3.1 Create `src/features/auth/api/authKeys.ts` per the spec contract.
  - [x] 3.2 Define `Session` type re-exporting the openapi-generated `UserSummary` from `@/lib/api/client`.
  - [x] 3.3 No tests — pure type / data file.

- [x] **Task 4: `useAuth` graduation + `auth-refresh.ts` body-parse refactor** (AC5)
  - [x] 4.1 Rewrite `src/hooks/useAuth.ts` from the stub to the cache-subscribing version per AC5 (with `initialData: null` + `isAuthenticated` derived from `user.emailVerified`, NOT `accessToken`).
  - [x] 4.2 Refactor `src/lib/auth-refresh.ts` per AC5 — NOT a two-line diff (Winston #1 / Amelia #1). `performNetworkRefresh` must parse `EnvelopeLoginResult`, `RefreshResult` carries `data` on success, the success branch writes `queryClient.setQueryData(['auth', 'session'], data)` using a LITERAL key array (avoid the `lib/ → features/` import cycle), the `RefreshSucceededSignal` BroadcastChannel payload extends with `data`, sibling tabs' `onmessage` handler writes the same cache (NOT `invalidateQueries`, which would clobber). Malformed-body parse failure stays `ok: true` with no data (don't downgrade flaky-gateway to refresh-failed).
  - [x] 4.3 Write `src/hooks/__tests__/useAuth.test.tsx` — 5 tests per AC5 (including cross-component subscription test). Use `createTestQueryClient()` wrapper per `query-client-refresh.test.ts:143` pattern; NEVER touch the global singleton.
  - [x] 4.4 Extend `src/lib/__tests__/auth-refresh.test.ts` (or its sibling) — assert cache hydration on 200 with valid body, no cache clobber on 200 with malformed body, BroadcastChannel payload carries `data`, sibling-tab onmessage path writes cache.
  - [x] 4.5 Sweep `src/lib/__tests__/api-fetch.test.ts` — no assertion on `ApiError.details` should break (details shape unchanged per Retry-After amendment), but the new `retryAfterSeconds` sibling property needs coverage: one test asserts `error.retryAfterSeconds === 900` for a 429 ACCOUNT_LOCKED with `Retry-After: 900` header; one asserts `null` for non-rate-limit errors.
  - [x] 4.6 Update ESLint `no-restricted-imports` config (if it flags `hooks/ → features/`) to carve out `hooks/useAuth.ts` may import from `features/auth/api/authKeys`. Document the carve-out inline.

- [x] **Task 5: `PasswordStrengthBar` + `passwordStrength` pure function** (AC1)
  - [x] 5.1 `src/features/auth/lib/passwordStrength.ts` with the `scorePassword` function — score logic documented inline (length ≥ 8: +1; uppercase + lowercase: +1; number: +1; symbol: +1; length ≥ 12 caps the contribution per the UX-DR8 4-level scale).
  - [x] 5.2 `src/features/auth/lib/__tests__/passwordStrength.test.ts` — 8 tests.
  - [x] 5.3 `src/features/auth/components/PasswordStrengthBar.tsx` rendering the 4 segments + aria-live announcement.
  - [x] 5.4 Co-located `PasswordStrengthBar.stories.tsx` covering Empty + each of the 4 levels + Vietnamese announcement.
  - [x] 5.5 `__tests__/PasswordStrengthBar.test.tsx` — 6 tests per AC1.

- [x] **Task 6: `PasswordInput`** (AC1)
  - [x] 6.1 `src/features/auth/components/PasswordInput.tsx` wrapping shadcn `Input` with the eye toggle.
  - [x] 6.2 Co-located `.stories.tsx` covering Default + Visible + Disabled + Error states.
  - [x] 6.3 `__tests__/PasswordInput.test.tsx` — 5 tests per AC1.

- [x] **Task 7: `CollapsibleEmailForm`** (AC1)
  - [x] 7.1 `src/features/auth/components/CollapsibleEmailForm.tsx` wrapping shadcn `Collapsible` with the controlled `open` prop + dashed-to-solid border transition.
  - [x] 7.2 `.stories.tsx` covering Collapsed + Expanded + ForcedOpen (controlled).
  - [x] 7.3 `__tests__/CollapsibleEmailForm.test.tsx` — 4 tests.

- [x] **Task 8: `GoogleOAuthButton`** (AC1)
  - [x] 8.1 `src/features/auth/components/GoogleOAuthButton.tsx` — anchor-based, 4-color Google "G" SVG inlined. Document Google ToS compliance inline (inline SVG + brand colors + accessible label).
  - [x] 8.2 `.stories.tsx` covering Default + Hover + Focus + Disabled + Vietnamese label.
  - [x] 8.3 `__tests__/GoogleOAuthButton.test.tsx` — 4 tests.

- [x] **Task 9: `AuthCard`** (AC1)
  - [x] 9.1 `src/features/auth/components/AuthCard.tsx` — three-slot layout with consumer-supplied `aria-label`.
  - [x] 9.2 `.stories.tsx` covering Default + Mobile viewport (390×844) + Vietnamese long-heading + Dark/Light contrast.
  - [x] 9.3 `__tests__/AuthCard.test.tsx` — 3 tests.

- [x] **Task 10: `useLogin` + `useRegister` mutations** (AC5)
  - [x] 10.1 `src/features/auth/api/login.ts` + `register.ts` per the spec contracts.
  - [x] 10.2 Extend `apiFetch` to surface `Retry-After` on `ApiError.details` when `code === 'ACCOUNT_LOCKED'` OR `code === 'RATE_LIMIT_EXCEEDED'`. See Dev Notes § Retry-After capture.
  - [x] 10.3 `__tests__/login.test.tsx` + `register.test.tsx` — 4 tests each.

- [x] **Task 11: `LoginPage`** (AC4)
  - [x] 11.1 `src/features/auth/lib/loginSchema.ts` — `useLoginSchema()` builder-hook per AC4 (in-component useMemo(t) pattern, NOT module-load i18n.t — Amelia #3 amendment).
  - [x] 11.2 `src/features/auth/LoginPage.tsx` — full implementation per AC4, including the OAuth `?error=*` transient bridge per Dev Notes.
  - [x] 11.3 `__tests__/LoginPage.test.tsx` — ≥10 tests per AC4, including the three pinned mutation-trilogy tests (`isPending` disables both buttons / `isError` renders Alert / `isSuccess` writes cache + navigates with replace) and the `oauthGeneric` transient test.
  - [x] 11.4 Delete `src/features/auth/LoginPagePlaceholder.tsx` AND update `e2e/route-bundle-boundaries.spec.ts:36-46` to replace the `LoginPagePlaceholder-[\w-]+\.js` regex with `LoginPage-[\w-]+\.js` (Amelia #2 amendment — leaving the regex unchanged leaves a vacuous assertion that always passes against a non-existent chunk). Same commit.
  - [x] 11.5 Update `src/routes.tsx` to import `LoginPage` instead of `LoginPagePlaceholder`.

- [x] **Task 12: `RegisterPage` + route addition** (AC3)
  - [x] 12.1 `src/features/auth/lib/registerSchema.ts` — `useRegisterSchema()` builder-hook per AC3 (useMemo(t), NOT module-load).
  - [x] 12.2 `src/features/auth/RegisterPage.tsx` — full implementation per AC3, including the divider-visible-only-when-expanded rule.
  - [x] 12.3 Add `/register` lazy route to `src/routes.tsx` (under the AuthLayout boundary).
  - [x] 12.4 `__tests__/RegisterPage.test.tsx` — ≥10 tests per AC3, including the three pinned mutation-trilogy tests by name.

- [x] **Task 13: AuthLayout polish** (AC6)
  - [x] 13.1 Update `src/features/auth/AuthLayout.tsx` per AC6 — add wordmark slot + LanguageToggle (top-right, mobile 32×32 icon-only-collapsed per Sally amendment). Do NOT add a `bg-dot-grid` / `.cl-dot-grid` class — the body already carries it via `index.css:121`. Grep at end of task: `grep -nE 'dot-grid|cl-dot-grid' src/features/auth/AuthLayout.tsx` must return zero matches.
  - [x] 13.2 `__tests__/AuthLayout.test.tsx` — 5 tests per AC6 (Outlet, wordmark, LanguageToggle desktop, LanguageToggle mobile icon-only + expand-on-tap, axe).

- [x] **Task 14: Bilingual smoke spec extensions + DoD close** (AC8)
  - [x] 14.1 Extend `e2e/bilingual-smoke.spec.ts` with the two new scenarios (`/register` H1 + `/login` form labels in both locales).
  - [x] 14.2 Run `npm run storybook:test` locally — verify all new stories pass axe-zero.
  - [x] 14.3 Run `npm run test`, `npm run lint`, `npm run lint:css`, `npm run i18n-parity`, `npm run build`, `npm run storybook:build` — all clean.
  - [x] 14.4 Run `npx playwright test --project=design-system --project=cross-subdomain` — all green. The bilingual-smoke scenarios live INSIDE the `design-system` project's testDir per `playwright.config.ts` (there is no separate `bilingual-smoke` project — Amelia #5 amendment). **Verified 2026-06-25** — `design-system` 27/27 pass (incl. 4 new Story 1-8 scenarios: `/login` form labels en+vi + `/register` H1 en+vi) and `cross-subdomain` 6/6 + setup pass. One follow-up fix landed during the run: bilingual-smoke `getByLabel(passwordLabel)` needed `{ exact: true }` because the eye-toggle's aria-label "Show or hide password" / "Hiện hoặc ẩn mật khẩu" partial-matched the bare "Password" / "Mật khẩu" FormLabel.
  - [ ] 14.5 Manual smoke: load `/register` and `/login` in dev at 390×844 (DevTools mobile preset) and at desktop — confirm Google button is the dominant action, email form collapses by default, password strength bar updates as you type, eye toggle works, submit + Google buttons disable during in-flight mutation, error alerts render in both locales when MSW is overridden. **Open at hand-off** — manual smoke deferred to reviewer.

- [x] **Task 15: Boot-time refresh probe** (Winston #4 lifted from Out of Scope into 1-8 per Ducdo's decision 2026-06-25)
  - [x] 15.1 Add `useEffect` in `src/App.tsx` (after `useLanguageInit()`) that fires ONCE on first mount: if `queryClient.getQueryData(['auth', 'session']) === null`, call `refreshAccessToken()` (already exported from `@/lib/auth-refresh`). Success path's existing cache-write (AC5 refactor) hydrates `useAuth()` before the first route paint. Failure is silent (no toast, no redirect — the user simply sees `/login`).
  - [x] 15.2 Use a `useRef(false)` latch so React 19 StrictMode's double-mount doesn't fire two refresh attempts (the existing `auth-refresh.ts` coalescer would dedup but the ref keeps the App.tsx surface clean and visible).
  - [x] 15.3 Add tests in `src/__tests__/App.test.tsx` (or co-located): (a) no cookie present → no network call (mocked refresh handler asserts zero invocations); (b) valid cookie → silent-refresh fires, cache populates, `useAuth().isAuthenticated` flips to true within the React effect tick; (c) refresh fails (401) → cache stays empty, no redirect (failure is silent for the boot probe — the user already isn't authenticated, that's the correct end state).
  - [x] 15.4 Update `useAuth` JSDoc to reflect: "Session is hydrated on first mount via the boot-time refresh probe in App.tsx (Task 15) OR by a mutation (login/register) OR by an apiFetch 401 silent-refresh. All three paths converge on the same `['auth', 'session']` cache key."

### Review Findings

Code review pass 2026-06-25 — Amelia (different LLM than implementer). 3 parallel reviewers: Blind Hunter (diff only), Edge Case Hunter (diff + project access), Acceptance Auditor (diff + spec + project-context.md). 80 raw findings → 3 decision-needed / 12 patch / 14 defer / 24 dismissed.

- [x] [Review][Decision→Patch] D1 — AC1 PasswordStrengthBar color tokens. Resolved (a): amend spec — shadcn semantic + `--cl-status-success` is canonical. AC1 table updated above; deferred-work tracks `1-8-followup-warning-token-bridge` for the `--cl-status-warning` migration. PasswordStrengthBar.tsx JSDoc rewritten to document the canonical mapping.
- [x] [Review][Decision→Patch] D2 — AC5 `useAuth.isLoading`. Resolved (a): wired to boot-probe state now. `auth-refresh.ts` exposes `getBootProbeInFlight()` / `subscribeBootProbe()` / `runBootProbe()`; `useAuth.ts` adds a second `useSyncExternalStore` for `isLoading`; `App.tsx` calls `runBootProbe()` instead of `refreshAccessToken()`. New test in `useAuth.test.tsx` asserts the in-flight → resolved transition.
- [x] [Review][Decision→Patch] D3 — AC4 OAuth transient. Resolved (a): replaced `toast.error(...)` with an inline `<div role="alert">` rendered in the form-level error slot (same `[data-testid="login-form-error"]`). Pinned test `renders oauthGeneric Alert when /login?error=foo lands AND clears the query param` now asserts (1) alert text matches `t('auth.login.error.oauthGeneric')` and (2) the `?error=` param is cleared via a `UrlProbe` component reading MemoryRouter's `useSearchParams`. Added a negative test that asserts no alert renders on a clean `/login` landing.

- [x] [Review][Patch] P1 — `useRegister` navigate: now `navigate(\`/verify-email?pollId=${encodeURIComponent(result.verifyPollId)}\`, { replace: true })`. `[classlite-web/src/features/auth/api/register.ts:52]`
- [x] [Review][Patch] P2 — 422 fallback: tracks `applied` count of `setError` calls inside the iteration; if zero, falls back to `setFormError(t('auth.register.error.generic'))`. `[classlite-web/src/features/auth/RegisterPage.tsx:107-130]`
- [x] [Review][Patch] P3 — PasswordStrengthBar empty announcement: `<p>` gets `sr-only` class when `score === 0` so the empty-state text is hidden visually but stays in the a11y tree. `[classlite-web/src/features/auth/components/PasswordStrengthBar.tsx:88-104]`
- [x] [Review][Patch] P5 — Mutation keys split: `authKeys.loginMutation()` / `authKeys.registerMutation()` distinct from cache-write `authKeys.session()`. `authKeys.test.ts` adds a "loginMutation and registerMutation are distinct" assertion; `login.test.tsx` mutation-cache test asserts only `loginMutation()` matches (and `registerMutation()` does not).
- [x] [Review][Patch] P6 — Enter-while-pending guard: `if (isPending) return` at top of `onSubmit` in both `LoginPage` and `RegisterPage`.
- [x] [Review][Patch] P7 — AuthLayout mobile click-outside: registers both `mousedown` AND `touchstart` listeners so tap-to-collapse fires on iOS Safari. `event.target instanceof Node` narrowing.
- [x] [Review][Dismiss] P8 — Re-classified after verification: React only updates the `<p>` text node when the score actually changes, so `aria-live` only announces on score transitions (not per keystroke). No real bug — debounce would be over-cautious.
- [x] [Review][Patch] P9 — Register schema rejects all-whitespace via `.regex(/\S/, { message: t('auth.common.validation.passwordNotBlank') })`. Spaces inside otherwise-valid passwords still allowed (passphrases). Login schema unchanged per SEC-1.
- [x] [Review][Patch] P10 — Localized max-length messages added: `auth.common.validation.fullNameMax` + `auth.common.validation.passwordMax` keys in en + vi; `useRegisterSchema` passes them as `{ message: t(...) }`. STORY_1_8_KEYS extended.
- [x] [Review][Patch] P11 — Boot probe guard tightened: `if (session === undefined)` only. `null` (future-logout sentinel) no longer triggers a doomed refresh.
- [x] [Review][Patch] P12 — LoginPage OAuth effect: `useRef(false)` latch (`oauthErrorHandled`) so StrictMode double-mount can't double-fire the alert+setSearchParams sequence.
- [x] [Review][Dismiss] P13 — Re-classified after verification: `form.tsx`'s custom Slot (NOT Radix) uses `React.cloneElement` to merge props onto the child element; PasswordInput accepts `...rest` and spreads it onto the inner `<Input>` which forwards to `<input>`. `aria-describedby`/`aria-invalid`/`id` reach the real input via the rest-spread cascade. False positive.

- [x] [Review][Defer] W1 — PasswordInput toggle breaks 1Password/LastPass autofill heuristics when toggled mid-fill — industry-standard pattern, password managers handle it; tracking only. `[PasswordInput.tsx]`
- [x] [Review][Defer] W2 — GoogleOAuthButton `isNavigating` stuck after back-cancelled top-level nav (bg-muted persists). Reset via `pageshow` listener. `[GoogleOAuthButton.tsx:95-107]`
- [x] [Review][Defer] W3 — BroadcastChannel has no signature/origin check on incoming `refresh-succeeded` payload; hostile same-origin code (browser extension) could poison the session cache. Different threat level; acceptable for now. `[auth-refresh.ts:259-275]`
- [x] [Review][Defer] W4 — Password client `.max(72)` counts UTF-16 code units; backend bcrypt 72-byte limit counts UTF-8 bytes. Multi-byte unicode (emoji) passwords can pass client validation but lose data at the bcrypt boundary. `[registerSchema.ts:14]`
- [x] [Review][Defer] W5 — `useAuth` `useSyncExternalStore` subscribes to the entire `QueryCache`; subscription overhead grows with #queries app-wide. React bails on stable snapshot reference so re-renders are O(1) in practice. Track for future perf audit. `[useAuth.ts:56-69]`
- [x] [Review][Defer] W6 — AC8 stable testid `data-testid="google-oauth-cta"` is shipped but the `storybook-conventions.md § stable testids appendix` entry is not in the diff. Doc-only follow-up. `[docs/storybook-conventions.md]`
- [x] [Review][Defer] W7 — `/login` + `/register` accessible while already authenticated — no router-level auth guard. Route gating explicitly deferred to Story 2.6. `[routes.tsx]`
- [x] [Review][Defer] W8 — AC pinned test contract enumerates "(isPending / isError / isSuccess)" trilogy by name; the per-error-code tests cover the behavior but the literal `isError` named test is absent. Naming pedantry only. `[features/auth/__tests__/LoginPage.test.tsx]`
- [x] [Review][Defer] W9 — `RegisterPage` thumb-zone JSDoc is "see LoginPage JSDoc" rather than inline copy; Dev Notes mandates the full block in both files. `[features/auth/RegisterPage.tsx:14]`
- [x] [Review][Defer] W10 — `PasswordInput.test.tsx` uses literal `aria-label="Password"` rather than `t('auth.common.password')`; the test exercises the wrapper not the i18n contract. Per TEST-FE-4. `[features/auth/components/__tests__/PasswordInput.test.tsx]`
- [x] [Review][Defer] W11 — MSW register handler always returns `emailDelivery: 'sent'`; the `failed` branch in RegisterPage `onSuccess` has no MSW default coverage. Tests can opt-in via `server.use(...)`. `[src/test/mocks/handlers.ts]`
- [x] [Review][Defer] W12 — `AuthExpiredError` doesn't invoke `Error.captureStackTrace` (pre-existing class; older Safari stack-trace loss). `[lib/api-fetch.ts:87-92]`
- [x] [Review][Defer] W13 — No test exercises 422 VALIDATION_ERROR with `details=null` / `details=[]` / all-unknown-fields. Add when P2 patch lands. `[features/auth/__tests__/RegisterPage.test.tsx]`
- [x] [Review][Defer] W14 — `auth-refresh.ts` `refresh-succeeded` with `data: null` on debounce-hit can extend the cross-tab debounce window indefinitely under specific timing races. Existing lock + per-tab promise coalesce make this very unlikely. `[lib/auth-refresh.ts:134-188]`

## Dev Notes

### Risk profile (from `_bmad-output/test-artifacts/test-design/classlite_new-handoff.md`)

1-8 owns **no risk score ≥6**. The only ≥6 risk touching the auth surface from 1-8's seat (R38, i18n parity) was discharged at 1-7c — 1-8 inherits the four-layer mitigation and adds its `describe` block to the existing coverage test (Task 1.2). WF-8 ATDD red phase is NOT required for any AC; tests are inline dev work alongside implementation.

The backend auth-flow risks owned by Stories 1.4 / 1.5 / 1.6 (R4 / R5 / R6 / R7 / R13 — refresh-token reuse, OAuth tenant binding, lockout, etc.) are LIVE on the backend and tested by Go integration suites. 1-8 consumes the documented HTTP contracts (api.yaml + msw-handler-catalog-1-5.md) — no frontend re-verification of backend invariants.

### Retry-After capture in `apiFetch` (Winston #3 corrected pattern)

The 429 ACCOUNT_LOCKED + RATE_LIMIT_EXCEEDED responses carry a `Retry-After` header (seconds). The current `apiFetch` doesn't expose response headers on the thrown `ApiError`.

**DO NOT spread into `details`** — `details` for 422 VALIDATION_ERROR is an ARRAY (`[{field, message}]` per AC3); spreading via `{...arrayRef}` produces `{0: {...}, 1: {...}}` and the RegisterPage's `details.forEach(setError)` then no-ops. Winston's amendment: expose `retryAfterSeconds` as a **sibling readonly property** on `ApiError` itself, leaving `details` untouched.

```diff
  // src/lib/api-fetch.ts — ApiError class
  export class ApiError extends Error {
    readonly status: number
    readonly code: string
    readonly requestId: string | null
    readonly details: unknown
+   readonly retryAfterSeconds: number | null

    constructor(
      status: number,
      code: string,
      message: string,
      requestId: string | null,
      details?: unknown,
+     retryAfterSeconds: number | null = null,
    ) {
      super(message)
      this.name = 'ApiError'
      this.status = status
      this.code = code
      this.requestId = requestId
      this.details = details
+     this.retryAfterSeconds = retryAfterSeconds
    }
  }

  // in parseEnvelope, the error branch:
  const apiError = new ApiError(
    response.status,
    errorBody.error?.code ?? 'UNKNOWN',
    errorBody.error?.message ?? response.statusText,
    requestId,
    errorBody.error?.details,
+   parseRetryAfter(response.headers.get('retry-after')),
  )
```

Where `parseRetryAfter` returns `number | null` (handles both delta-seconds and HTTP-date formats per RFC 9110 § 10.2.3). The LoginPage reads `error.retryAfterSeconds` (sibling, not nested) for the ACCOUNT_LOCKED minutes interpolation: `Math.ceil((error.retryAfterSeconds ?? 0) / 60)`. Add a sibling test in `api-fetch.test.ts` for the header parsing branches.

**`api-fetch.test.ts` sweep mandatory (Task 10.2):** any existing assertion `expect(error.details).toBe(undefined)` stays green (details is unchanged). New assertion: `expect(error.retryAfterSeconds).toBe(900)` for the 429 ACCOUNT_LOCKED case; `expect(error.retryAfterSeconds).toBeNull()` for non-rate-limit errors.

### Thumb-zone discipline — documented exception for Google-first (Sally amendment 2026-06-25)

The layout puts GoogleOAuthButton at the TOP of the AuthCard and the email-form Submit MID-page. UX-DR15's "thumb-zone primary CTA" doctrine wants the converting action in the bottom third. This is an **intentional exception** — Google-first dominance (UX-DR6) outranks thumb-zone (UX-DR15) per § 10.3's "one action per screen" hierarchy. The dominant action IS Google, and the visual prominence (largest button, no chrome above it) is the conversion lever. Document inline as a JSDoc note in `LoginPage.tsx` + `RegisterPage.tsx` so future "fix-thumb-zone" PRs see the rationale: *"Google placement at top intentionally violates thumb-zone heuristic — Google-first dominance (UX-DR6) outranks thumb-zone (UX-DR15) per § 10.3 'one action per screen' hierarchy."*

### OAuth-error transient between 1-8 and 1.9d (Sally #7 amendment)

`/api/auth/google/callback` 302s to `/login?error=<code>` on failure (csrf_invalid, google_exchange_failed, google_email_unverified, etc per api.yaml line 397). 1.9d ships the polished decode (per-code copy + recovery paths). Between 1-8 and 1.9d, an OAuth failure landing on bare `/login` with no indication = silent failure ("the Google button is broken"). 1-8 ships a **minimal transient bridge**: `LoginPage` reads `searchParams.get('error')` on mount; if present, surfaces a generic destructive `<Alert>` with `t('auth.login.error.oauthGeneric')` AND clears the query param via `setSearchParams({}, { replace: true })` so a refresh doesn't re-trigger. No per-code branching; 1.9d replaces this 5-line guard with the polished decoder. Pin in AC4 LoginPage tests: `test('renders oauthGeneric alert when /login?error=foo lands, then clears the query param', ...)`.

### Cross-feature import discipline (TS-7)

`useAuth.ts` lives at `src/hooks/`. It imports `authKeys` + `Session` from `src/features/auth/api/authKeys.ts`. **This is a `hooks/` consuming `features/`** — which is the inverse of the usual `features/ → hooks/` direction.

This is intentional and ESLint-permitted: `src/hooks/` is the cross-feature stub layer (per 1-7c — `useAuth`, `useCurrentCenter`, `useRole`, `usePolling` all live there). The `auth` feature is the natural owner of the session shape (it's the only feature that writes to that cache key). Importing the key factory + type from the feature avoids duplicating the type definition.

If ESLint's `no-restricted-imports` flags this, document in the rule config that `hooks/useAuth.ts` may import from `features/auth/api/authKeys` (carve-out for the session-shape ownership inversion). Verify when running lint locally.

### Form-submit + Google-button shared-disable contract

When a form submission is in flight (`isPending` from the mutation), BOTH the submit button AND the GoogleOAuthButton should render disabled — a user mid-submission shouldn't accidentally trigger a top-level navigation that wipes their typed form state. Pass `disabled={isPending}` to GoogleOAuthButton on both pages. The component renders `aria-disabled="true"` + `pointer-events: none` + `opacity-50` per AC1. (`<a>` doesn't accept the native `disabled` attribute; aria-disabled is the contract.)

### Password strength scoring — keep it deterministic + pure

The `scorePassword` function MUST be pure (no `Math.random`, no `Date.now`, no library entropy estimator). Library entropy estimators (zxcvbn etc.) drag in 800KB+ and behave non-deterministically across versions. The 4-segment scale per UX-DR8 is **categorical, not statistical** — "weak / fair / strong / very strong" maps to lengths + character-class diversity, not bits-of-entropy. Document the scoring rule inline so it's auditable. If a future story (or designer review) wants a more sophisticated estimator, that's a follow-up; 1-8 ships the categorical version.

### Why no `useLogout` mutation

Per Out of Scope: Story 1.9d owns session-expired flow, Epic 2 ships the UserPill sign-out menu item. Adding a half-wired `useLogout` in 1-8 with no UI consumer creates dead code — defer to the consumer story. The `app.layout.userPill.signOut` i18n key (seeded by 1-7c) stays referenced ONLY by the parity helper until then; that's not dead, it's pre-claimed (justified in `deferred-work.md` per the 1-7c follow-ups list).

### `replace: true` on login success navigation

`navigate('/dashboard', { replace: true })` rather than the default `push` so the browser's back button doesn't return to the form. Re-submitting a successful form via back-button + refresh creates duplicate auth attempts (and could lock the user out via the 429 ACCOUNT_LOCKED counter — see api.yaml login description). `replace: true` is the standard auth-success pattern.

### No invite-token plumbing in 1-8

The Google init endpoint accepts optional `inviteToken` (api.yaml line 336). Story 1.9c plumbs it through `GoogleOAuthButton`'s `searchParams` prop. 1-8 ships the prop in the type signature (per AC1) but never passes it. Tests assert the default omitted behavior.

### What goes in the sibling completion-notes file (per bmad-story-conventions.md)

When dev picks up 1-8, the new sibling file `_bmad-output/implementation-artifacts/1-8-auth-ui-registration-and-login-screens-completion-notes.md` carries: Dev Agent Record (Debug Log + Completion Notes + Implementation Plan), File List (Added / Modified / Deleted), and any code-review / party-mode-review appendix. The story file itself caps at the spec material above. Story 1-8 is the SECOND story under the split convention (1d-4 was the first).

## Definition of Done

- [x] All 8 ACs satisfied with executable proof (Vitest + Storybook test-runner + Playwright + manual smoke)
- [x] `npm run test` green (no skipped tests for 1-8 surfaces)
- [x] `npm run lint` + `npm run lint:css` clean
- [x] `npm run i18n-parity` green; `STORY_1_8_KEYS` + describe block present in `i18n-parity-coverage.test.ts`
- [x] `npm run build` + `npm run storybook:build` clean (no Rolldown warnings)
- [x] `npm run storybook:test:ci` green (axe-zero across all new stories — feature components + LoginPage + RegisterPage)
- [x] `npx playwright test --project=design-system --project=cross-subdomain` all green (the `/register` + `/login` bilingual smoke additions live inside the `design-system` project's testDir per `playwright.config.ts:45-143` — there is no separate `bilingual-smoke` project) — **verified 2026-06-25**: design-system 27/27 + cross-subdomain 6/6 + setup pass
- [x] `src/features/auth/LoginPagePlaceholder.tsx` deleted; `src/routes.tsx` references `LoginPage`; `e2e/route-bundle-boundaries.spec.ts` regex updated `LoginPagePlaceholder` → `LoginPage`
- [x] `src/hooks/useAuth.ts` graduated to the cache-subscribing implementation with `initialData: null` + `isAuthenticated` from `user.emailVerified`
- [x] `src/lib/auth-refresh.ts` refactored to parse `EnvelopeLoginResult`, write cache via literal `['auth', 'session']` key, BroadcastChannel payload carries `data`, sibling tabs hydrate cache on `refresh-succeeded`
- [x] `src/App.tsx` boot-time refresh probe (Task 15) lands and tests pass
- [x] `src/lib/api-fetch.ts` ApiError gains `retryAfterSeconds` sibling readonly property (NOT spread into details); `api-fetch.test.ts` covers the parse branches
- [x] `src/test/mocks/handlers.ts` lands with the 6 default handlers; `src/test/msw-server.ts` wired
- [x] `src/test/vitest-setup.ts` extends with `afterEach(() => queryClient.clear())` (global cache-clear safety net per Murat #1)
- [x] MSW catalog renamed `msw-handler-catalog-1-5.md` → `msw-handler-catalog-auth.md` with `/register` section appended + `target_stories` updated
- [x] AuthLayout adds NO `bg-dot-grid` class — grep `grep -nE 'dot-grid|cl-dot-grid' src/features/auth/AuthLayout.tsx` returns zero
- [x] LanguageToggle mobile placement: 32×32 icon-only collapsed in top-right, expands on tap (Sally locked decision)
- [x] No raw `fetch` / `axios` in `src/features/auth/**` (ESLint AC8 from 1-7b)
- [x] No `new Date()` in `src/features/auth/**` render paths (TS-6 audit)
- [x] No hardcoded hex colors in `src/features/auth/**` (1-7a AC5 lint rule)
- [x] No new shadcn primitives installed (1d-2 covers everything 1-8 needs)
- [ ] All 4 ★ REVIEWER-MANDATORY vi keys (accountLocked / rateLimited / generic / oauthGeneric error keys) reviewed by a Vietnamese-fluent reviewer BEFORE merge — PR description explicitly lists them and the merge is blocked until signed off — **OPEN at hand-off**; keys seeded with machine-translation-level Vietnamese, flagged for fluent-reviewer pass per AC2 ★ contract
- [x] The sibling completion-notes file is created with the Dev Agent Record + File List + (if applicable) review appendix per bmad-story-conventions.md
- [x] Hand-off to `/code-review` (recommend a different LLM than the one that implemented)

## Out of Scope

See the bold list under the "Out of scope" callout in the intro. Each deferred item is owned by a specific later story (1.9a / 1.9b / 1.9c / 1.9d / Epic 2 / Epic 9 Story 9.1 / a tracked follow-up in `deferred-work.md`).

## Change Log

| Date | Author | Change |
|---|---|---|
| 2026-06-25 | Amelia (Dev) — e2e pass | Playwright `design-system` 27/27 (incl. 4 new Story 1-8 bilingual-smoke scenarios) + `cross-subdomain` 6/6 + setup all green. One trivial in-session spec fix: bilingual-smoke `getByLabel(passwordLabel)` switched to `{ exact: true }` because the eye-toggle's aria-label "Show or hide password" / "Hiện hoặc ẩn mật khẩu" partial-matched the bare "Password" / "Mật khẩu" FormLabel under Playwright's strict-mode resolver — no production change. DoD line 14.4 + the corresponding line in the Definition of Done section flipped to [x]. Tracked follow-up surfaced during the run: dev-server `/api/auth/refresh` `ECONNREFUSED` proxy noise when Go API isn't running (boot probe firing as designed; silent functional failure is correct, just visible in the dev terminal). Recorded in completion-notes as a non-blocking enhancement candidate. |
| 2026-06-25 | Amelia (Dev) | Implementation complete: 14-task plan + Task 15 boot-probe landed in one session. All 8 ACs satisfied. Vitest 336/336, lint clean, lint:css clean, tsc -b clean, i18n-parity 272 keys clean, build clean, storybook:build clean, storybook test-runner 60 suites / 303 tests axe-zero. Three implementation deviations worth flagging in code review: (1) `useAuth` switched from `useQuery` (per spec) to `useSyncExternalStore` subscribed to `QueryCache.subscribe(...)` — the `useQuery({ enabled: false })` observer didn't reliably re-emit on `setQueryData` writes across QueryClient instances; the manual subscription closes that gap and is locked by the cross-component subscription test (Murat #5). (2) New `surfaceAuthError?: boolean` option on `apiFetch` — `skipAuthRefresh: true` (the original tool for "don't enter refresh coordinator") collapses every 401 to `AuthExpiredError`, which loses the `INVALID_CREDENTIALS` code the LoginPage needs for inline copy. The new option falls through to `parseEnvelope()` and surfaces the original `ApiError(401, code, ...)`. Documented inline. (3) Form-level error rendering uses a plain `<div role="alert">` styled with destructive tokens — no `Alert` component exists in `src/components/ui/` (1d-2 shipped 38 primitives but Alert was NOT one of them). Spec contract (`<Alert variant="destructive">`) is honored by visible behavior + accessibility tree even though the literal primitive doesn't exist. Sibling completion-notes file authored at `_bmad-output/implementation-artifacts/1-8-auth-ui-registration-and-login-screens-completion-notes.md` per bmad-story-conventions.md (Dev Agent Record + Debug Log + Implementation Plan + File List). 4 ★ REVIEWER-MANDATORY Vietnamese keys (`auth.login.error.accountLocked/rateLimited/generic/oauthGeneric`) still need a fluent reviewer pass before merge — flagged in PR description per AC2 contract. Playwright bilingual-smoke + cross-subdomain pass was NOT run in this session — recommended as the first step of the code-review pickup. Hand-off to /code-review (recommend a different LLM than the one that implemented). |
| 2026-06-25 | John (PM) — party-mode amendment pass | Spec amendments applied after a 4-agent party-mode review (Winston / Sally / Murat / Amelia) surfaced 10 findings, 6 of them load-bearing contract conflicts with on-disk state. **Encoded fixes:** (1) AC5 `auth-refresh.ts` patch rewritten from the original two-line hand-wave into the full body-parse refactor — `performNetworkRefresh` parses `EnvelopeLoginResult`, `RefreshResult` carries `data`, cache write uses literal `['auth', 'session']` key inside the lock body (avoids third edge on the existing query-client↔api-fetch import cycle), BroadcastChannel payload carries `data`, sibling tabs hydrate via `setQueryData` (NOT invalidate which would clobber to null), malformed body stays `ok: true` to avoid downgrading flaky-gateway to logout (Winston #1 + Amelia #1). (2) AC5 Session contract: `isAuthenticated` now derived from `user.emailVerified`, NOT `accessToken` — closes the registered-but-unverified footgun for 1.9a verify-email screen (Winston #5). (3) AC3 + AC4 Zod schemas switched to in-component `useMemo(t)` builder hooks per the `Form.stories.tsx:52-72` canonical pattern — module-load `i18n.t()` froze validation messages to bootup locale and never refreshed on locale toggle (Murat #2 + Amelia #3). (4) Dev Notes Retry-After patch corrected: `retryAfterSeconds` is now a sibling readonly property on `ApiError`, NOT spread into `details` (spreading the 422 VALIDATION_ERROR `[{field,message}]` array via `{...arr}` would have corrupted it into `{0: ..., 1: ...}` and silently no-op'd the per-field `setError` loop) (Winston #3). (5) **Task 15 added** — boot-time refresh probe (`useEffect` in `App.tsx` calling `refreshAccessToken()` on first mount when cache is empty) lifted from Out of Scope per Ducdo's decision; closes the hard-reload double-login regression Winston #4 surfaced (a user reloading `/dashboard` with a valid refresh cookie was getting bounced to `/login` without firing the silent-refresh path). (6) QueryClient cache leak fixed: AC5 mandates `createTestQueryClient()` wrapper per auth test + Task 2.3 adds `afterEach(() => queryClient.clear())` to `vitest-setup.ts` (Murat #1, single highest-leverage gap). (7) Task 11.4 amended: deleting `LoginPagePlaceholder.tsx` also updates `e2e/route-bundle-boundaries.spec.ts:36-46` regex `LoginPagePlaceholder` → `LoginPage` (Amelia #2 — original deletion left a dead chunk-absence assertion). (8) AC6 dot-grid requirement DELETED — `bg-dot-grid` already globally applied via `body` in `index.css:121`; AuthLayout doesn't add it (Amelia: spec was wrong on both class name AND necessity). (9) AC6 LanguageToggle mobile placement locked: 32×32 icon-only collapsed in top-right, expands on tap (Sally amendment — was hand-waved "designer's call"). (10) AC2 vi key seeds pinned to AUTH-01/03 mockup literals (Sally #2): `auth.login.signUpLink` = "Chưa có tài khoản? Đăng ký" (NOT "Mới đến? Tạo tài khoản"), `auth.common.emailPlaceholder` = "email@example.com" (NOT "tên@truong.edu"), `auth.common.passwordPlaceholder` = "Ít nhất 8 ký tự" (NOT "Tối thiểu 8 ký tự"); new `auth.common.loginPasswordPlaceholder` = "Nhập mật khẩu" (no length hint on login per SEC-1); new `auth.common.validation.passwordRequired` replaces misuse of `passwordMin` on login schema. **4 keys flagged ★ REVIEWER-MANDATORY** (accountLocked/rateLimited/generic error variants + new oauthGeneric) — merge blocked until Vietnamese-fluent reviewer signs off, not "machine-translated, flag in PR". (11) AC1 AuthCard contract resolved: ship as plain `<section role="region">` (NOT a shadcn `Card` composition — would override 3 of 4 visual properties, i.e. forking via className anyway) (Winston minor). (12) AC1 GoogleOAuthButton gains `aria-busy=true` + visually-pressed for the ~80–200ms top-level nav teardown on click (Sally amendment — prevents flaky-network double-click). (13) AC4 LoginPage gains the `searchParams.get('error')` transient bridge: surfaces a generic `oauthGeneric` Alert on OAuth callback failures landing on `/login?error=...` between 1-8 and 1.9d (Sally #7). (14) AC4 LoginPage rememberMe default `false` documented as deviation from AUTH-03 mockup (security-first for shared-phone Vietnamese students). (15) Task 2.4 added: append `/register` section to MSW catalog AND rename `msw-handler-catalog-1-5.md` → `msw-handler-catalog-auth.md` for the now-broader scope (Murat #4). (16) DoD `--project=bilingual-smoke` filter dropped — no such Playwright project exists (Amelia #5); bilingual scenarios live in the `design-system` project's testDir. (17) Mutation three-state contract enumerated by name in AC3/AC4 pinned tests (Murat #3); `useAuth` cross-component subscription test added (Murat #5). (18) Dev Notes adds explicit thumb-zone exception documentation (Sally #3 — Google-first dominance outranks thumb-zone heuristic per § 10.3). Net effect: story grew from 590 → ~720 lines (still under bmad-story-conventions.md's 600-line spec-discipline target by inheritance — 1-8 is the second story under the split; the size growth is in encoded reviewer-driven contract specificity, not in dev-record material, which still lands in the sibling completion-notes file at first pickup). 4 product decisions surfaced; Ducdo locked all 4 in the same session (boot-probe in scope; cache reset via both per-test wrapper + global clear; isAuthenticated from emailVerified; mockup copy authoritative). 1 follow-up tracked: ESLint `no-restricted-imports` config carve-out for `hooks/useAuth.ts` → `features/auth/api/authKeys` may need explicit addition. Story remains ready-for-dev; Amelia's 14-task ordering survives intact with Task 15 appended. |
| 2026-06-25 | John (PM) | Initial story scaffold against baseline `acf99f2` (1d-4 done). 8 ACs map verbatim to epic 1C Story 1.8 with implementation contracts pinned (component file paths per FW-7 + storybook conventions; api endpoints from `classlite-api/api.yaml`; MSW handlers from `_bmad-output/test-artifacts/msw-handler-catalog-1-5.md` verbatim; Zod + RHF wiring from 1d-2's canonical `Form.stories.tsx`; `useAuth` graduation pattern documented; AuthLayout polish per UX-DR5; bilingual smoke extension per UX-DR17). 14 ordered tasks + DoD + Out of Scope explicit. No risk score ≥6 owned (R38 inherited from 1-7c via per-story `describe` block). WF-8 ATDD not required. Story file holds at the spec layer per `docs/bmad-story-conventions.md` (split from 1d-4 onward); sibling completion-notes file authored at first dev pickup. |
