---
baseline_commit: 0e1484f
---

# Story 1.9b: Password Reset UI

Status: done

> **Why this story matters.** Story 1-8 shipped the "Forgot password?" link inside the login form (`LoginPage.tsx:332-338`) but the anchor today routes to a 404 — there is no `/forgot-password` or `/reset-password` route registered yet. Story 1-5 landed the backend (`POST /api/auth/forgot-password` + `POST /api/auth/reset-password`) months ago with the full anti-enumeration discipline, 1-hour token TTL, and session-invalidation-on-success behavior locked in. 1-9b closes the loop end-to-end: a user who forgets their password types it into `/forgot-password`, gets a consistent "check your email" confirmation regardless of whether the email is registered (anti-enum), clicks the link in their email which lands at `/reset-password?token={raw}`, sets a new password, and lands on `/login?reset=1` with a success banner that also tells them all other sessions have been signed out (server forces refresh-token wipe per `auth.go` reset path).
>
> **One risk score ≥6 check: NONE owned.** R38 (i18n parity) inherits from 1-7c's CI gate via a new `STORY_1_9B_KEYS` block in `i18n-parity-coverage.test.ts`. Backend behavior — anti-enum response shape, 200ms timing floor, rate-limit ceilings — is owned and pinned by Story 1-5's ATDD suite. The R-NEW=12 redirect-race that bit 1-9a does NOT recur — the reset success path is a single navigate after a successful mutation (no countdown, no aria-live hold), and the user is unauthenticated by definition during reset so there is no session to wipe mid-redirect. WF-8 ATDD red phase is **NOT required**.

> **Scaffold reality check (READ FIRST — many 1-9b primitives already exist on disk).**
>
> - `classlite-web/src/features/auth/LoginPage.tsx` lines 332-338 already renders the `<a href="/forgot-password" data-testid="forgot-password-link">` — the trigger contract is shipped. 1-9b lands the destination route; DO NOT modify the anchor.
> - `classlite-web/src/test/mocks/handlers.ts` lines 115-128 already carries default MSW handlers for `POST /api/auth/forgot-password` and `POST /api/auth/reset-password`. **Verified envelope shape (Amelia 2026-06-26)**: both use `HttpResponse.json<Envelope<ForgotPasswordResult>>({ data: { sent: true } }, { status: 200 })` and the matching enveloped reset variant — not raw bodies. `apiFetch<ForgotPasswordResult>` unwraps cleanly on the happy-path tests. NO new default handlers needed.
> - `classlite-web/src/lib/api/client.ts` already carries the auto-generated `ForgotPasswordRequest`, `ForgotPasswordResult`, `ResetPasswordRequest`, `ResetPasswordResult`, `EnvelopeForgotPasswordResult`, `EnvelopeResetPasswordResult` schemas. Import wire types from `components['schemas']['...']`; NEVER hand-write API types (TS-2 + XL-1). NEVER use them as form state (TS-2).
> - `classlite-web/src/features/auth/AuthLayout.tsx` is the shipped wordmark + responsive LanguageToggle layout. Both 1-9b routes mount as NEW children under AuthLayout — do NOT add another layout wrapper.
> - `classlite-web/src/features/auth/components/AuthCard.tsx` is the canonical card shell — `<section role="region">` with `regionLabel` / `heading` / `body` / `footer?` slots, `max-w-[420px]` desktop, `rounded-[14px]`. 1-9b's ForgotPasswordPage and ResetPasswordPage compose AuthCard the same way LoginPage / RegisterPage / VerifyEmailPage do.
> - `classlite-web/src/features/auth/components/PasswordInput.tsx` ships from Story 1-8. ResetPasswordPage consumes it verbatim for both the new-password and confirm-password fields.
> - **`classlite-web/src/features/auth/components/PasswordStrengthBar.tsx` lines 52-56 — verified prop signature**: `export interface PasswordStrengthBarProps { password: string }`. The bar internally calls `scorePassword(password)` and renders the 4-segment bar + aria-live announcement. Consumers pass the raw password STRING (not a score, not a `useWatch` wrapper) — RegisterPage at `RegisterPage.tsx:~190` does exactly `<PasswordStrengthBar password={passwordValue} />` where `passwordValue = useWatch({ control: form.control, name: 'password' })`. ResetPasswordPage mirrors this verbatim.
> - `classlite-web/src/features/auth/hooks/useResendCountdown.ts` ships from Story 1-9a — internal `setInterval` decrementing remaining seconds, `start(seconds)` API, clamp `[1, 300]`, NaN-fallback to `RESEND_COUNTDOWN_SECONDS = 60`. 1-9b ForgotPasswordPage consumes this verbatim for the 60-second resend countdown.
> - `classlite-web/src/features/auth/api/authKeys.ts` already exports the 1-9a mutation-key factory. 1-9b extends with `forgotPasswordMutation()` and `resetPasswordMutation()` (mirrors the 1-9a P5 split — distinct mutation keys per call site).
> - `classlite-web/src/lib/api-fetch.ts` already exposes `ApiError.retryAfterSeconds` on 429 RATE_LIMIT_EXCEEDED responses (Story 1-8 wiring).
> - `classlite-web/src/features/auth/lib/registerSchema.ts` (`useRegisterSchema()`) is the builder-hook precedent for `useMemo(t)` Zod schemas. PASSWORD_MIN = 8, PASSWORD_MAX = 72 — same constants as register.
> - `classlite-web/src/features/auth/LoginPage.tsx` lines 75-115 already carries the lazy-initializer + URL-clear + searchParams re-derivation effect for `?error=` (OAuth) AND `?verified=1` (1-9a). 1-9b adds `?reset=1` as a third query-param branch sharing the same `<div role="alert">` slot, but **the implementation shape is amended (Winston + Amelia convergence 2026-06-26)**: instead of three independent `useState` slots competing with a priority chain, use a SINGLE derived `bannerKey: 'reset' | 'verified' | 'oauth-error' | null` selector. The ref latch `oauthErrorHandled` is also renamed to `bannerSignalHandled` in the same diff (4-line rename — kills the naming lie ahead of 1-9d's planned `useLoginBanner` extraction).
> - `classlite-web/src/lib/test/__tests__/i18n-parity-coverage.test.ts` carries `STORY_1_7C_KEYS`, `STORY_1_8_KEYS`, `STORY_1_9A_KEYS` blocks. 1-9b appends `STORY_1_9B_KEYS` + matching `describe(...)`.
> - `classlite-web/src/routes.tsx` lines 82-105 carries the AuthLayout children. 1-9b appends `{ path: 'forgot-password' }` and `{ path: 'reset-password' }` lazy-loading their respective pages.
> - `classlite-api/api.yaml` lines 242-322 + `classlite-api/internal/service/auth_reset.go:102` + `classlite-api/internal/config/config.go:62`: reset email URL is `{APP_RESET_URL_BASE}?token={rawToken}` query-param form (dev default `http://localhost:5173/reset-password`). NOT a path param.
> - `classlite-api/internal/service/auth_reset.go` resets ALL refresh tokens for the user on successful reset: the user is signed out of every device. The success banner copy must convey this — security feature, not a bug.
> - `_bmad-output/test-artifacts/msw-handler-catalog-auth.md` lines 279-336 already documents the forgot-password and reset-password handler stubs verbatim. 1-9b touches the catalog ONLY to add a `target_stories` confirmation entry (frontmatter `last_updated` bump + Change Log row).
> - **navigate-spy pattern (Amelia citation 2026-06-26)**: 1-9a's `VerifyEmailPage.test.tsx:75-96` uses `MemoryRouter` + sibling `<Route path="/login" element={<p data-testid="login-reached" />}>` for navigate assertion — NOT a `vi.mock('react-router')` spy. 1-9b inherits this pattern verbatim: assert `screen.findByTestId('login-reached')` for `?reset=1` navigation, `screen.findByTestId('forgot-password-reached')` for the 410 expired-CTA navigation.

> **Out of scope (explicit deferrals — each owned by a specific later story).**
>
> - **Polished error-recovery screens** (account lockout countdown / OAuth mismatch / session expired) — Story 1.9d. 1-9b renders the reset-token error states inline within ResetPasswordPage following UX-DR16's three-part pattern; standalone error layout components are 1-9d's concern.
> - **Email pre-fill on the expired-token CTA** — Epic 1c AC for 1.9b mentions "the CTA pre-fills the user's email address." **Pragmatic-scope amendment (per [[feedback_pragmatic_interpretation_of_spec_absolutes]] + Winston's framing 2026-06-26):** the reset token alone does NOT carry the email; the three pre-fill paths (introspection endpoint / URL embed / signed-token client decode) all expand the anti-enumeration attack surface or leak email via email-client preview tooling, browser history, and server logs. **Default — no pre-fill** (user re-enters email on `/forgot-password`, one extra typing event on a rare path). **Winston's framing addition**: this is NOT a story-level deviation — it's a PRD/Epic AC defect (the Epic was written without knowing `auth_reset.go` cannot return the email in the error envelope). John has filed a one-line amendment against the Epic 1c AC removing the pre-fill requirement; the PR description still cites the three-option rationale for traceability.
> - **`/forgot-password` requires authentication-aware redirect** — LoginPage Layer A already redirects authenticated users from `/login`. We do NOT replicate that guard on ForgotPasswordPage / ResetPasswordPage. Deferred to 1-9d as part of the systemic auth-route guard.
> - **BroadcastChannel `password-reset-succeeded` cross-tab signal** — backend already deletes refresh tokens server-side, so sibling tabs land on `/login` within ≤15 min via 401 silent-refresh. The explicit channel signal is a UX-coherence polish; 1-9d owns it. **Winston revisit-trigger (2026-06-26)**: if 1-9d's session-expired screen scope changes (delayed, split, or descoped), revisit this deferral — the BroadcastChannel becomes orphan polish if its successor screen doesn't ship.
> - **Lockout-screen "Forgot password?" CTA-stays-active behavior** — 1-9d. 1-9b just provides the destination route.
> - **`scripts/i18n-parity.mjs` namespace-coverage extension** for `auth.forgotPassword.*` + `auth.resetPassword.*` — same gap 1-9a punted. Per-key parity via `STORY_1_9B_KEYS` is clean; namespace-level orphan-key gate is not. **Owner: Story 1-9d** (Murat 2026-06-26 — explicit punt with named owner, not distributed-loss-of-discipline).
> - **`useLoginBanner` discriminated-union refactor** — Winston (2026-06-26): the third `?reset=1` banner branch in 1-9b is the inflection point. A fourth signal in 1-9d (likely session-expired or post-lockout-success) makes the conditional priority chain unreadable. **Pre-work mandate added to 1-9d story spec**: refactor LoginPage banner coordination into a `useLoginBanner(searchParams) → LoginBannerSignal | null` hook returning a `{kind: 'reset' | 'verified' | 'oauth-error' | 'session-expired', payload?: string}` discriminated union BEFORE adding the fourth signal. 1-9b ships the single derived `bannerKey` selector + ref rename as scaffolding for this refactor.

## Story

As a user who forgot my password,
I want to request a password reset link, click the link in my email, set a new password, and sign back in,
so that I can regain access to my account in under three minutes without contacting support — and feel confident the security model is doing its job when all my other sessions are signed out as a result.

## Acceptance Criteria (BDD)

> **Risk-score ≥6 check (per WF-8).** This story owns NO risk score ≥6. R38 (i18n parity) inherits from 1-7c's CI gate; discharge is the `STORY_1_9B_KEYS` block (28 new keys) in `src/lib/test/__tests__/i18n-parity-coverage.test.ts`. WF-8 ATDD red phase NOT required for the story as a whole — but two ATDD specimens are pinned: the stale-refine sequence test (AC5) and the email-leak rejection ratchet test (AC5), both written ahead of green per the discipline-ratchet rationale.

### AC1: `/forgot-password` + `/reset-password` routes added to AuthLayout children (lazy-loaded)

**Given** the file `classlite-web/src/routes.tsx`,
**When** inspecting the AuthLayout children array after this story lands,
**Then** the array contains TWO new entries appended after the `'verify-email'` entry:
- `{ path: 'forgot-password', lazy: async () => { const { default: ForgotPasswordPage } = await import('@/features/auth/ForgotPasswordPage'); return { Component: ForgotPasswordPage } } }`
- `{ path: 'reset-password', lazy: async () => { const { default: ResetPasswordPage } = await import('@/features/auth/ResetPasswordPage'); return { Component: ResetPasswordPage } } }`

**And** the Playwright spec at `e2e/route-bundle-boundaries.spec.ts` is extended with a new `test('Story 1-9b — auth chunk includes ForgotPasswordPage + ResetPasswordPage; dashboard chunks do NOT', ...)`. **Murat 2026-06-26 explicit iteration shape (BLOCKER fix ahead of code review):**

```ts
const forgotChunks = files.filter((f: string) => /^ForgotPasswordPage-[\w-]+\.js$/.test(f))
const resetChunks  = files.filter((f: string) => /^ResetPasswordPage-[\w-]+\.js$/.test(f))
const studentChunkFiles = files.filter((f: string) => /^StudentDashboard-[\w-]+\.js$/.test(f))
const teacherChunkFiles = files.filter((f: string) => /^TeacherDashboard-[\w-]+\.js$/.test(f))

// FOUR vacuous-pass guards (hard-fail if any input array is empty —
// catches missing builds rather than silently passing on empty .join):
expect(forgotChunks.length,       'ForgotPasswordPage chunk missing from dist/').toBeGreaterThan(0)
expect(resetChunks.length,        'ResetPasswordPage chunk missing from dist/').toBeGreaterThan(0)
expect(studentChunkFiles.length,  'student dashboard chunk missing from dist/').toBeGreaterThan(0)
expect(teacherChunkFiles.length,  'teacher dashboard chunk missing from dist/').toBeGreaterThan(0)

const studentContents = studentChunkFiles.map((f) => readFileSync(resolve(DIST_DIR, f), 'utf8')).join('\n')
const teacherContents = teacherChunkFiles.map((f) => readFileSync(resolve(DIST_DIR, f), 'utf8')).join('\n')

// TWO iterated negative assertions × 2 dashboards = 4 cross-chunk leak checks:
for (const forgotChunk of forgotChunks) {
  expect(studentContents).not.toContain(forgotChunk)
  expect(teacherContents).not.toContain(forgotChunk)
}
for (const resetChunk of resetChunks) {
  expect(studentContents).not.toContain(resetChunk)
  expect(teacherContents).not.toContain(resetChunk)
}
```

**And** both pages are the lazy default exports from NEW files `classlite-web/src/features/auth/ForgotPasswordPage.tsx` and `ResetPasswordPage.tsx`.

### AC2: i18n keys — every new string in both en + vi, parity asserted (R38 inheritance)

**Given** the files `classlite-web/src/locales/en.json` and `classlite-web/src/locales/vi.json`,
**When** running `npm test -- i18n-parity-coverage`,
**Then** both files contain every key in the union below, and a new `STORY_1_9B_KEYS` const + `describe('Story 1-9b i18n parity (R38)', ...)` block lands in `src/lib/test/__tests__/i18n-parity-coverage.test.ts`.

| Key | en seed | vi seed | Notes |
|---|---|---|---|
| `auth.forgotPassword.title` | "Forgot password?" | "Quên mật khẩu?" | AUTH-08 |
| `auth.forgotPassword.body` | "Enter your email and we'll send you a reset link." | "Nhập email của bạn và chúng tôi sẽ gửi link đặt lại mật khẩu." | AUTH-08 |
| `auth.forgotPassword.emailLabel` | "Email" | "Email" | |
| `auth.forgotPassword.submit` | "Send reset link" | "Gửi link đặt lại" | AUTH-08 |
| `auth.forgotPassword.sentHeading` | "Check your email" | "Kiểm tra email của bạn" | |
| `auth.forgotPassword.sentBody` | "We've sent a reset link to {{email}} if that address is on file. The link expires in 1 hour." | "Chúng tôi đã gửi link đặt lại đến {{email}} nếu địa chỉ này có trong hệ thống. Link sẽ hết hạn sau 1 giờ." | **★ REVIEWER-MANDATORY (vi)** — Sally 2026-06-26 rewrite: lead with the action so "sent" lands first; the anti-enum hedge becomes a footnote, not a gut-punch. |
| `auth.forgotPassword.spamHint` | "Check your spam folder if you don't see it within a minute." | "Kiểm tra hộp thư rác nếu bạn không thấy email trong vòng một phút." | Parallel to `auth.verify.spamHint`. |
| `auth.forgotPassword.wrongEmail` | "Wrong email? Try a different address." | "Sai email? Thử địa chỉ khác." | **Sally 2026-06-26 addition.** Typo-escape button on the confirmation screen — closes the silent-failure mode where a user fat-fingers the email, never gets the reset link, and doesn't realize for 5+ minutes. Renders as a `<button>` (state revert, not navigation) below the spam hint; click resets `submitted=false`, clears form, focuses email field. |
| `auth.forgotPassword.resendCta` | "Resend reset link" | "Gửi lại link đặt lại" | |
| `auth.forgotPassword.resendCountdown` | "Resend in {{seconds}}s" | "Gửi lại sau {{seconds}}s" | |
| `auth.forgotPassword.backToLogin` | "Back to sign in" | "Quay lại đăng nhập" | |
| `auth.forgotPassword.error.rateLimited` | "Please wait {{seconds}}s before requesting another link." | "Vui lòng chờ {{seconds}}s trước khi yêu cầu link khác." | 429. |
| `auth.forgotPassword.error.generic` | "Something went wrong. Please try again." | "Đã có lỗi xảy ra. Vui lòng thử lại." | **★ REVIEWER-MANDATORY (vi)**. |
| `auth.resetPassword.title` | "Set a new password" | "Đặt mật khẩu mới" | |
| `auth.resetPassword.body` | "Choose a strong password you don't use anywhere else. All other devices will be signed out when you save." | "Chọn mật khẩu mạnh và chưa từng dùng ở nơi khác. Tất cả thiết bị khác sẽ bị đăng xuất khi bạn lưu." | **★ REVIEWER-MANDATORY (vi)** — Sally 2026-06-26: "chưa từng dùng ở nơi khác" (have never used elsewhere) is more native than "không dùng ở nơi khác." |
| `auth.resetPassword.newPasswordLabel` | "New password" | "Mật khẩu mới" | |
| `auth.resetPassword.confirmPasswordLabel` | "Confirm new password" | "Xác nhận mật khẩu mới" | |
| `auth.resetPassword.submit` | "Save new password" | "Lưu mật khẩu mới" | |
| `auth.resetPassword.expiredHeading` | "Reset link expired" | "Link đặt lại đã hết hạn" | UX-DR16 part 1. |
| `auth.resetPassword.expiredBody` | "Reset links expire after 1 hour. Request a new one to continue." | "Link đặt lại hết hạn sau 1 giờ. Yêu cầu link mới để tiếp tục." | UX-DR16 part 2. |
| `auth.resetPassword.expiredCta` | "Request a new reset link" | "Yêu cầu link đặt lại mới" | UX-DR16 part 3 — routes to `/forgot-password`. |
| `auth.resetPassword.consumedHeading` | "Reset link already used" | "Link đặt lại đã được sử dụng" | |
| `auth.resetPassword.consumedBody` | "This reset link was already used. Sign in with your new password, or request a new link if needed." | "Link đặt lại này đã được sử dụng. Đăng nhập bằng mật khẩu mới, hoặc yêu cầu link mới nếu cần." | Sally 2026-06-26: removed the "if you've forgotten it again" gentle dunk. |
| `auth.resetPassword.invalidHeading` | "Invalid reset link" | "Link đặt lại không hợp lệ" | 404 + neither-token fallback. |
| `auth.resetPassword.invalidBody` | "This link can't be used — it may be from an older email. Try the link in your most recent email, or request a new one." | "Không thể dùng link này — có thể link đến từ email cũ. Hãy thử link trong email gần nhất, hoặc yêu cầu link mới." | Sally 2026-06-26: added UX-DR16 part 2 (the WHY — "may be from an older email"). |
| `auth.resetPassword.error.passwordMismatch` | "Passwords don't match." | "Mật khẩu không khớp." | Zod refine. |
| `auth.resetPassword.error.generic` | "Something went wrong. Please try again." | "Đã có lỗi xảy ra. Vui lòng thử lại." | 422 / 5xx / network. |
| `auth.login.banner.reset` | "Password reset complete. We signed out your other devices to keep your account safe — sign in here to continue." | "Đặt lại mật khẩu thành công. Chúng tôi đã đăng xuất các thiết bị khác để bảo vệ tài khoản của bạn — đăng nhập tại đây để tiếp tục." | **★ REVIEWER-MANDATORY (vi)** — Sally 2026-06-26 rewrite: active voice "chúng tôi đã đăng xuất" replaces passive-victim "bị đăng xuất" (the `bị` adversative passive triggers "did someone do this *to* me?" panic for VN users). Frames the sign-out as the security feature working. |

**And** the 4 ★ REVIEWER-MANDATORY Vietnamese keys are flagged in the PR description for VN-fluent reviewer pass before merge: `forgotPassword.sentBody`, `forgotPassword.error.generic`, `resetPassword.body`, `login.banner.reset`.

**Total: 28 new keys** (13 `auth.forgotPassword.*` + 14 `auth.resetPassword.*` + 1 `auth.login.banner.reset`).

### AC3: ForgotPasswordPage — email form, anti-enum confirmation, spam hint, typo-escape

**Given** an unauthenticated user navigates to `/forgot-password`,
**When** the page first paints,
**Then** the rendered region (`data-testid="forgot-password-form"`) inside `AuthCard` contains the title heading + body lead + RHF-controlled `<Input type="email" data-testid="forgot-email-input">` + `<Button type="submit" data-testid="forgot-submit">` + footer `<Link to="/login" data-testid="forgot-back-link">` rendering `t('auth.forgotPassword.backToLogin')`.

**And** the form uses a new `useForgotPasswordSchema()` builder hook at `src/features/auth/lib/forgotPasswordSchema.ts` — `useMemo(t)` Zod schema mirroring `useRegisterSchema`. Validation runs `onBlur`. Submit short-circuits if `isPending`.

**And** on a successful 200, the page swaps the form region to a confirmation region (`data-testid="forgot-password-sent"`):
- `<h1 data-testid="forgot-sent-heading">` with `t('auth.forgotPassword.sentHeading')`. **(Amended 2026-06-26 code-review per [[feedback_pragmatic_interpretation_of_spec_absolutes]] D1 decision.)** The original literal `<h2>` was an authoring mistake — the `AuthCard` heading slot is the document's single `<h1>` per the LoginPage / RegisterPage / VerifyEmailPage convention, so the sent-confirmation heading inherits the same `<h1>` shape. Reverting to `<h2>` would degrade the page's outline (no top-level heading) and diverge from the rest of the auth surface.
- Body paragraph rendering `t('auth.forgotPassword.sentBody', { email: submittedEmail })` — the submitted email is bolded inline via `<strong data-testid="forgot-sent-email" class="break-all">`.
- `<p data-testid="forgot-spam-hint" class="text-sm text-[var(--cl-ink-muted)]">` rendering `t('auth.forgotPassword.spamHint')`.
- **Typo-escape (Sally 2026-06-26):** `<button type="button" data-testid="forgot-wrong-email" class="text-sm underline">` rendering `t('auth.forgotPassword.wrongEmail')` below the spam hint. Clicking sets `submitted=false`, clears the RHF form state, and refs.focus()es the email input.
- `<Button variant="outline" data-testid="forgot-resend-button">` rendering `t('auth.forgotPassword.resendCta')` — clicking re-fires the mutation with the SAME `submittedEmail` and starts a 60-second countdown.
- The same `backToLogin` footer link.

**Pinned test contracts** (`features/auth/__tests__/ForgotPasswordPage.test.tsx`, MSW seam):
- `renders email form on initial paint` — assert `forgot-password-form` IN DOM and `forgot-password-sent` NOT (TEST-FE-6 negative assertion).
- `swaps to sent confirmation on 200 success` — submit valid email; assert MSW handler fired exactly once; assert form region GONE and `forgot-password-sent` + bolded `forgot-sent-email` containing the submitted email PRESENT.
- `displays the submitted email in the confirmation body`.
- `email field shows inline error on invalid format` — `screen.getByText(i18n.t('auth.common.validation.emailFormat'))`.
- `submit is disabled while mutation is pending`.
- `clicking resend re-fires the mutation with the same email + starts countdown` — **Murat 2026-06-26 tightened**: assert (a) MSW request counter increments 1→2, AND (b) the captured request body of the SECOND request `.toEqual({ email: submittedEmail })` — deep-equal, NOT just same-email-field. Catches "fires `{email: 'a@b.com'}` with wrong shape" regression.
- **Typo-escape (Sally addition):** `clicking wrong-email button returns to form mode + clears form + focuses email input` — assert `forgot-password-sent` GONE, `forgot-password-form` IN DOM, email input has `document.activeElement` focus, RHF `formState.isDirty === false`.
- **Anti-enum coupling regression guard (Murat 2026-06-26):** `success-swap fires identically regardless of response timing` — render twice with MSW handlers that delay 50ms and 250ms respectively; assert the resulting DOM (after the swap settles) is structurally identical AND that the component code path NEVER reads `response.headers` or branches on response timing. Locks the contract "the client never breaks anti-enum even if a future dev tries to optimize."

### AC4: Forgot-password error envelopes — 422 / 429 / 5xx

**Given** the ForgotPasswordPage form is filled and submitted,
**When** the response is `429 RATE_LIMIT_EXCEEDED`, the page renders `<div role="alert" data-testid="forgot-error-alert">` with `t('auth.forgotPassword.error.rateLimited', { seconds: error.retryAfterSeconds ?? 60 })`, and the submit button stays disabled for that many seconds via `useResendCountdown.start(error.retryAfterSeconds ?? 60)`.

**And** 422 / 5xx / network → the same form-level alert with `t('auth.forgotPassword.error.generic')`. The form stays in input mode on every error path — user can retry.

**Pinned test contracts**:
- `429 RATE_LIMIT_EXCEEDED renders rate-limited alert + disables submit for retryAfterSeconds`.
- `429 with missing Retry-After defaults to 60s`.
- `5xx renders generic error alert + form stays on input mode` (TEST-FE-6: assert `forgot-password-form` IN DOM and `forgot-password-sent` NOT).
- `422 renders generic alert + form stays on input mode` (same TEST-FE-6 negative).

### AC5: ResetPasswordPage — token from URL, new password + PasswordStrengthBar + confirm, success → `/login?reset=1`

**Given** a user navigates to `/reset-password?token={rawToken}`,
**When** the page first paints,
**Then** the rendered region (`data-testid="reset-password-form"`) inside `AuthCard` contains:
- `<h1 data-testid="reset-password-heading">` with `t('auth.resetPassword.title')`.
- Body paragraph rendering `t('auth.resetPassword.body')`.
- `<PasswordInput data-testid="reset-new-password" name="newPassword">` with label `t('auth.resetPassword.newPasswordLabel')`.
- `<PasswordStrengthBar password={newPasswordValue}>` where `newPasswordValue = useWatch({ control: form.control, name: 'newPassword' })`. **Verified prop signature (Amelia 2026-06-26)**: `PasswordStrengthBar` accepts `password: string` (PasswordStrengthBar.tsx:52-56); the bar scores internally — RegisterPage precedent at `RegisterPage.tsx:~190`.
- `<PasswordInput data-testid="reset-confirm-password" name="confirmPassword">` with label `t('auth.resetPassword.confirmPasswordLabel')`.
- `<Button type="submit" data-testid="reset-submit">` rendering `t('auth.resetPassword.submit')`.
- Footer `<Link to="/login" data-testid="reset-back-link">` rendering `t('auth.forgotPassword.backToLogin')`.

**And** the form uses `useResetPasswordSchema()` (Zod with `newPassword` `.min(8).max(72).regex(/\S/)` + `confirmPassword.min(1)` + `.refine(d => d.newPassword === d.confirmPassword, { message: t('auth.resetPassword.error.passwordMismatch'), path: ['confirmPassword'] })`). **RHF config (Winston 2026-06-26):** `useForm({ resolver: zodResolver(schema), mode: 'onBlur', reValidateMode: 'onChange' })`. The `reValidateMode: 'onChange'` is load-bearing: after the first blur, the refine re-runs on every keystroke so editing `newPassword` AFTER both fields validated immediately surfaces a mismatch on `confirmPassword` — closes the stale-refine inconsistency where the strength bar reacts live but the match check waits for blur.

**And** the token is read via `useSearchParams().get('token')` **reactively on every render** (Winston 2026-06-26 amendment — drop "exactly once on first render"). `useSearchParams()` in React Router v7 is reactive; reading it in render with `useMemo` is the natural shape. Handles same-tab `?token=A → ?token=B` URL-bar edits and email-client preview re-clicks. If `token == null` OR `token.trim() === ''`, render the "invalid" state per AC6 (NO network call — assert MSW request count is zero).

**And** on a successful 200 from `POST /api/auth/reset-password { token, newPassword }`, `navigate('/login?reset=1', { replace: true })` fires IMMEDIATELY inside the mutation's `onSuccess` callback. No countdown, no aria-live hold.

**Pinned test contracts** (`features/auth/__tests__/ResetPasswordPage.test.tsx`, MSW seam — navigate-spy pattern = `MemoryRouter` + sibling `<Route path="/login" element={<p data-testid="login-reached" />}>` per Amelia citation):
- `renders reset form on initial paint with token in URL` — render with `?token=abc123`; assert `reset-password-form` PRESENT and `reset-password-invalid|expired|consumed` ALL ABSENT.
- `renders invalid state when token is missing` — no `?token`; assert `reset-password-invalid` region + zero MSW request count.
- `renders invalid state when token is empty string` — `?token=`; same.
- `renders invalid state when token is whitespace-only` — `?token=%20%20`; same (the `.trim() === ''` branch).
- `submits token + newPassword to API + navigates to /login?reset=1 on 200` — MSW returns 200; assert request body deep-equals `{ token: 'abc123', newPassword: 'newStrong123' }`; assert `screen.findByTestId('login-reached')` resolves.
- `confirm password mismatch shows inline field error + does NOT submit` — fill mismatching, click submit, assert `screen.getByText(i18n.t('auth.resetPassword.error.passwordMismatch'))` AND zero MSW request count.
- **Stale-refine ATDD specimen (Murat + Winston 2026-06-26 — discipline ratchet, written BEFORE green):**
  ```
  type newPassword='Hunter2!!', confirmPassword='Hunter2!!', blur both → form valid
  edit newPassword to 'Hunter3!!' (keystroke, no blur)
  attempt submit
  assert: confirm-password field shows passwordMismatch error inline (the reValidateMode: 'onChange' refine fired on the newPassword keystroke); submit short-circuited; zero MSW request count
  ```
- **Email-leak rejection ratchet (Murat 2026-06-26 — discipline ratchet, written BEFORE green):**
  ```
  render with initial entry '/reset-password?token=abc&email=leak@example.com'
  assert: screen.queryByDisplayValue('leak@example.com') === null
  // newPassword + confirmPassword inputs are empty; email param is silently ignored
  ```
  Locks the pragmatic deviation so a future dev cannot accidentally re-introduce the email leak by wiring `?email=` "for UX." Backend integration test at Story 1-5 already locks this server-side; the frontend ratchet is the discipline pair.
- `password too short shows passwordMin error + does NOT submit` — 5-char password.
- `password all whitespace shows passwordNotBlank error + does NOT submit` — `'        '`.
- `submit disabled while mutation pending`.
- `PasswordStrengthBar updates as user types` — type "abc" → assert weak; type "abcDEF123!" → assert very strong.

### AC6: Reset-token error states — 410 expired / 409 consumed / 404 invalid / 422 / 5xx

**Given** ResetPasswordPage submits to `POST /api/auth/reset-password`,
**When** the response is `410 RESET_TOKEN_EXPIRED`, the page swaps the form region to the expired state (`data-testid="reset-password-expired"`):
- Inline 40×40 clock SVG (reuse the 1-9a monoline pattern).
- Heading `t('auth.resetPassword.expiredHeading')`. Body `t('auth.resetPassword.expiredBody')`.
- Primary CTA `<Link to="/forgot-password" data-testid="reset-expired-cta">` rendering `t('auth.resetPassword.expiredCta')`. NO email pre-fill (pragmatic deviation).
- Secondary CTA in footer `<Link to="/login">` rendering `t('auth.forgotPassword.backToLogin')`.

**And** `409 RESET_TOKEN_CONSUMED` → `data-testid="reset-password-consumed"` region (heading, body, primary `<Link to="/login">`, secondary `<Link to="/forgot-password">`).

**And** `404 RESET_TOKEN_INVALID` → `data-testid="reset-password-invalid"` region (same as no-token-on-mount — DRY).

**And** 422 / 5xx / network → form-level `<div role="alert" data-testid="reset-error-alert">` with `t('auth.resetPassword.error.generic')` — form STAYS in input mode.

**Pinned test contracts** — **Murat 2026-06-26 BLOCKER fix: every state-region test asserts the OTHER three regions are absent (TEST-FE-6 compliance, not "just renders X")**:
- `renders expired state on 410 + clicking CTA navigates to /forgot-password` — assert `reset-password-expired` IN DOM, `reset-password-form` / `reset-password-consumed` / `reset-password-invalid` ALL NOT in DOM; simulate click on CTA + assert sibling `<Route path="/forgot-password">` test marker reached.
- `renders consumed state on 409 + login CTA navigates to /login` — `reset-password-consumed` IN, other three OUT.
- `renders invalid state on 404` — `reset-password-invalid` IN, other three OUT.
- `renders generic alert on 422 + form stays on input mode` — `reset-error-alert` IN, `reset-password-form` IN, expired/consumed/invalid ALL OUT.
- `renders generic alert on 5xx + form stays on input mode` — same shape.

### AC7: LoginPage `?reset=1` success banner — single derived selector

**Given** a user navigates to `/login?reset=1`,
**When** LoginPage mounts,
**Then** a success banner renders in the SAME form-level `<div role="alert">` slot that today carries `?error=...` and `?verified=1`:
- Visual: success variant — `border-[color:var(--cl-status-success)]/40 bg-[color:var(--cl-status-success)]/10 text-[color:var(--cl-status-success)]`.
- **Inline checkmark glyph (Sally 2026-06-26):** a 16×16 inline SVG checkmark in `currentColor`, inline-start of the message, `aria-hidden="true"` (axe-zero decorative).
- Copy: `t('auth.login.banner.reset')` — explicitly states "all other devices have been signed out" so users don't panic when sibling sessions auto-log-out.

**And the implementation shape is amended (Winston + Amelia convergence 2026-06-26 — NOT a fork of the 1-9a pattern):**

- **Single derived selector** — replace the three independent `useState` slots (`oauthError`, `verifiedBanner`, `resetBanner`) with ONE state `bannerKey: 'reset' | 'verified' | 'oauth-error' | null`. The lazy initializer derives `bannerKey` once from `searchParams` with priority order **`reset > verified > oauth-error`**. The re-derivation `useEffect([searchParams])` updates the SAME single state. Rendering is `{bannerKey && <BannerVariant kind={bannerKey} />}` — one slot, one variant component.
- **Rename ref (Winston 2026-06-26):** `oauthErrorHandled` → `bannerSignalHandled` in the same diff. The ref's purpose is signal-handled-once-across-all-banner-kinds, not OAuth-specific. 4-line rename — kills the naming lie at the source.
- **Layer A flash-prevention preserved** — banner element gated on `!isAuthenticated && bannerKey === 'reset'` for the reset variant (matches 1-9a verified-banner gating).
- **Session-cache invalidation on `?reset=1` (Murat 2026-06-26):** the `bannerKey === 'reset'` branch of the lazy initializer calls `queryClient.removeQueries({ queryKey: authKeys.session() })` synchronously before render. Closes the stale-cache flash where a sibling tab still holds an in-memory session cache from before the reset — the cache wipe forces a re-fetch (which 401s against the wiped refresh token and routes to login, the intended UX).

**Pinned tests in `LoginPage.test.tsx`** (+4 tests):
- `renders reset banner with checkmark glyph when ?reset=1 lands` — assert `getByRole('alert')` text matches `t('auth.login.banner.reset')` AND the inline `<svg aria-hidden="true">` checkmark IS present.
- `clears ?reset=1 from URL after mount` — assert `searchParams.get('reset') === null` post-mount.
- `prefers reset banner over verified banner when both ?verified=1&reset=1` — assert rendered banner copy matches `t('auth.login.banner.reset')`, NOT verified.
- **Session-cache invalidation (Murat addition):** pre-seed `queryClient.setQueryData(authKeys.session(), { user: {...}, accessToken: 'stale' })`; render `<LoginPage />` with `?reset=1`; assert `queryClient.getQueryData(authKeys.session()) === undefined` (or null, depending on `removeQueries` semantics).

### AC8: Storybook coverage — co-located stories per `storybook-conventions.md` § 2

**Given** the files `ForgotPasswordPage.stories.tsx`, `ResetPasswordPage.stories.tsx`, and one new variant added to `LoginPage.stories.tsx`,
**When** running `npm run storybook:build` + `npm run storybook:test` (axe project),
**Then** the canonical variants ship:

**ForgotPasswordPage stories (9):**
- `Default` (en, form mode)
- `LocaleVi` (vi, form mode)
- `Sent` (en, confirmation mode after submit — typo-escape button + spam hint visible)
- `SentLocaleVi` (vi, confirmation mode — Sally 2026-06-26 addition: VN inbox UX has more aggressive spam filtering; spam hint is more load-bearing in vi)
- `SentResendCountdown` (resend button clicked, countdown active at remaining=45)
- `SentWrongEmailRevert` (Sally 2026-06-26 addition — typo-escape button clicked; form-mode restored with focus on email field)
- `ErrorRateLimited` (429 with Retry-After=45)
- `ErrorGeneric` (5xx)
- `Mobile390` (Default at 390px)
- `Mobile390Sent` (Sally addition — confirmation state at 390px with long email `verylongname.with.dots@subdomain.company.co`; the `break-all` on the email span MUST wrap inside the strong, NOT push the resend button below the fold)
- `Mobile390ErrorRateLimited` (Sally addition — 429 alert at 390px; the longest single-line vi string in the story is `t('auth.forgotPassword.error.rateLimited', { seconds: 45 })` — must not overflow)

**ResetPasswordPage stories (9):**
- `Default` (en, valid token, form mode)
- `LocaleVi` (vi, valid token, form mode)
- `Invalid` (missing token OR 404)
- `Expired` (410 RESET_TOKEN_EXPIRED)
- `Consumed` (409 RESET_TOKEN_CONSUMED)
- `ErrorGeneric` (5xx — form stays input)
- `PasswordMismatch` (mismatching passwords entered + confirm-field error visible)
- `Mobile390` (Default at 390px)
- `Mobile390Expired` (Sally addition — expired state at 390px; clock SVG + heading + body + primary + secondary CTA = tall card on 390×844, verify scroll behavior and primary CTA visibility above the fold)

**LoginPage stories (+1 variant — Amelia 2026-06-26 addition):**
- `ResetBanner` — `/login?reset=1` mount renders the success banner with the inline checkmark glyph + session-wipe copy. Mirrors the 1-9a `VerifiedBanner` story precedent. Axe-zero decorative-svg check (`aria-hidden="true"`).

**And** every story has a `play` function asserting either `screen.getByTestId(<region>)` or `screen.getByRole('alert')` exists; axe-zero per existing storybook-axe Playwright project.

## Tasks / Subtasks

> **Commit-sequence discipline:**
> 1. i18n keys land FIRST (atomic en + vi).
> 2. MSW catalog `last_updated` bump rides with the API hooks (the default handlers are already shipped — only frontmatter touched).
> 3. Forgot + Reset pages + hooks ship together — **each page + its route entry land as ONE atomic commit (Amelia 2026-06-26)** — Task 4 ships ForgotPasswordPage AND route registration in a single commit; same for Task 5. Otherwise `npx playwright test` on the intermediate commit fails because the bundle-boundary spec asserts the chunk exists.
> 4. LoginPage `?reset=1` banner amendment lands LAST (smallest blast radius).

### Task 1 — i18n keys (atomic en + vi)

- [x] 1.1 Add 28 keys per AC2 to `classlite-web/src/locales/en.json` under `auth.forgotPassword.*` + `auth.resetPassword.*` + `auth.login.banner.reset`.
- [x] 1.2 Add the same 28 keys to `classlite-web/src/locales/vi.json` with the seed copy per AC2 (the 5 ★ REVIEWER-MANDATORY keys flagged in PR description). Note Sally 2026-06-26 copy rewrites on `forgotPassword.sentBody` (lead-with-action), `resetPassword.body` (native phrasing), `resetPassword.consumedBody` (no moralizing), `resetPassword.invalidBody` (added the WHY), `login.banner.reset` (active voice).
- [x] 1.3 Append `STORY_1_9B_KEYS` + `describe('Story 1-9b i18n parity (R38)', ...)` to `src/lib/test/__tests__/i18n-parity-coverage.test.ts`.
- [x] 1.4 Run `npm test -- i18n-parity-coverage` — green.

### Task 2 — Auth API extensions (authKeys + 2 hooks + MSW response constants)

- [x] 2.1 Extend `src/features/auth/api/authKeys.ts`: add `forgotPasswordMutation` + `resetPasswordMutation` mutation keys. Extend `authKeys.test.ts` with matching contract assertions.
- [x] 2.2 Create `src/features/auth/api/forgotPassword.ts` — `useForgotPassword()` mutation hook. Mirrors `useResendVerification` pattern.
- [x] 2.3 Create `src/features/auth/api/resetPassword.ts` — `useResetPassword()` mutation hook. NO cache write (reset does NOT issue a session).
- [x] 2.4 **MSW response constants with `satisfies` typecheck (Murat 2026-06-26 STRONG)** — extract two constants in `classlite-web/src/test/mocks/handlers.ts` (alongside `MSW_RESEND_NEW_POLL_ID` from 1-9a) and update the default handlers to consume them:
  ```ts
  export const MSW_FORGOT_PASSWORD_DEFAULT = { sent: true } as const satisfies ForgotPasswordResult
  export const MSW_RESET_PASSWORD_DEFAULT = { reset: true } as const satisfies ResetPasswordResult
  ```
  The `satisfies` clause forces a typecheck against the generated schema — if codegen evolves the response shape (adds a field, renames `sent`), the fixture fails to compile and a human reads the diff. Per-test variants AND the new ForgotPasswordPage / ResetPasswordPage tests import from this single source.
- [x] 2.5 Co-located `__tests__/forgotPassword.test.tsx` + `resetPassword.test.tsx` — 3 tests each (happy / 422 / 429 for forgot; happy / 410 / 409 for reset).

### Task 3 — Form schemas (Zod builder hooks)

- [x] 3.1 Create `src/features/auth/lib/forgotPasswordSchema.ts` — `useForgotPasswordSchema()` returning a Zod schema with `email`.
- [x] 3.2 Create `src/features/auth/lib/resetPasswordSchema.ts` — `useResetPasswordSchema()` with `newPassword` + `confirmPassword` + `.refine` on equality (`path: ['confirmPassword']`). Reuses `auth.common.validation.password*` keys + the new `passwordMismatch` key.
- [x] 3.3 Co-located `__tests__/forgotPasswordSchema.test.ts` + `resetPasswordSchema.test.ts` — 2 tests each.

### Task 4 — ForgotPasswordPage (single atomic commit: page + route)

- [x] 4.1 Create `src/features/auth/ForgotPasswordPage.tsx`. Local state: `submitted`, `submittedEmail`, `formError`, plus `useResendCountdown()`. Composes AuthCard with the right slots.
- [x] 4.2 Wire form (input mode) with RHF + `useForgotPasswordSchema()` (`mode: 'onBlur'`). On valid submit, `useForgotPassword().mutate({ email })`. `onSuccess`: `submitted=true`, `submittedEmail=email`, `countdown.start(60)`. `onError`: 429 → rate-limited alert + countdown.start(retryAfter); else generic.
- [x] 4.3 Wire confirmation mode (`submitted === true`): swap to sent state. **Typo-escape button (Sally addition):** clicking `forgot-wrong-email` resets `submitted=false`, calls `form.reset()`, calls `emailInputRef.current?.focus()`. Resend button re-fires the mutation with `submittedEmail` (NOT the form value).
- [x] 4.4 **In the SAME commit**, append the route entry to `src/routes.tsx` AuthLayout children. Page file + route registration must land together — otherwise the bundle-boundary spec on the intermediate commit fails.
- [x] 4.5 Co-located `__tests__/ForgotPasswordPage.test.tsx` — covers all pinned contracts from AC3 + AC4 (~12 tests including the typo-escape revert + anti-enum coupling guard + deep-equal resend).

### Task 5 — ResetPasswordPage (single atomic commit: page + route)

- [x] 5.1 Create `src/features/auth/ResetPasswordPage.tsx`. Read `token` reactively via `useSearchParams()` (Winston amendment — `useMemo(() => searchParams.get('token')?.trim() ?? null, [searchParams])`). If null/empty, render invalid state with NO network call.
- [x] 5.2 RHF config: `useForm({ resolver: zodResolver(useResetPasswordSchema()), mode: 'onBlur', reValidateMode: 'onChange' })` (Winston amendment — `reValidateMode: 'onChange'` closes the stale-refine inconsistency). Render `<PasswordInput name="newPassword">` + `<PasswordStrengthBar password={useWatch({control, name: 'newPassword'})}>` + `<PasswordInput name="confirmPassword">`. Verified prop signature: `PasswordStrengthBar` accepts `password: string` (PasswordStrengthBar.tsx:52-56).
- [x] 5.3 On valid submit, `useResetPassword().mutate({ token, newPassword })`. `onSuccess`: `navigate('/login?reset=1', { replace: true })` — immediate, no delay. `onError` branches: 410 → `errorState='expired'`; 409 → `'consumed'`; 404 → `'invalid'`; 422/5xx/network → set `formError`, keep form in input mode.
- [x] 5.4 Inline 40×40 clock SVG (reuse 1-9a expired-state pattern — inline JSX).
- [x] 5.5 **In the SAME commit**, append the route entry to `src/routes.tsx` AuthLayout children.
- [x] 5.6 Co-located `__tests__/ResetPasswordPage.test.tsx` — covers all pinned contracts from AC5 + AC6 (~16 tests including the two ATDD specimens: stale-refine sequence + email-leak rejection ratchet). Use the `MemoryRouter + sibling Route` navigate-spy pattern from `VerifyEmailPage.test.tsx:75-96` — sibling `<Route path="/login" element={<p data-testid="login-reached">login</p>} />` + `<Route path="/forgot-password" element={<p data-testid="forgot-password-reached">forgot</p>} />` for both navigation assertions.

### Task 6 — Storybook coverage

- [x] 6.1 Create `src/features/auth/ForgotPasswordPage.stories.tsx` per AC8 — 11 stories (Default, LocaleVi, Sent, SentLocaleVi, SentResendCountdown, SentWrongEmailRevert, ErrorRateLimited, ErrorGeneric, Mobile390, Mobile390Sent, Mobile390ErrorRateLimited).
- [x] 6.2 Create `src/features/auth/ResetPasswordPage.stories.tsx` per AC8 — 9 stories (Default, LocaleVi, Invalid, Expired, Consumed, ErrorGeneric, PasswordMismatch, Mobile390, Mobile390Expired). Use the Storybook React Router decorator from 1-8/1-9a precedent for `searchParams` per story.
- [x] 6.3 Extend `src/features/auth/LoginPage.stories.tsx` with a new `ResetBanner` variant (Amelia addition — mirrors the 1-9a `VerifiedBanner` story; asserts the inline checkmark glyph is present + axe-zero on the decorative svg).
- [x] 6.4 Run `npm run storybook:build` + `npm run storybook:test` (axe project) — green.

### Task 7 — LoginPage `?reset=1` banner amendment (single derived bannerKey)

- [x] 7.1 Open `src/features/auth/LoginPage.tsx`. **Refactor the three useState slots → single `bannerKey` derived state** (Winston + Amelia convergence). Replace `oauthError` + `verifiedBanner` (+ the planned `resetBanner`) with one `useState<BannerKey>(() => deriveBannerKey(searchParams))` where `BannerKey = 'reset' | 'verified' | 'oauth-error' | null` and `deriveBannerKey` applies priority order `reset > verified > oauth-error`.
- [x] 7.2 Replace the re-derivation `useEffect([searchParams])` with one that calls `setBannerKey(deriveBannerKey(searchParams))`. Single source of truth.
- [x] 7.3 **Rename `oauthErrorHandled` → `bannerSignalHandled`** (Winston amendment — 4-line diff). Extend the URL-clear effect to drop `?reset=1` AND `?verified=1` AND `?error=` (the same ref latch covers all three signals — the renamed name now describes what it does).
- [x] 7.4 **Session-cache invalidation (Murat addition):** if `bannerKey === 'reset'` at mount time, call `queryClient.removeQueries({ queryKey: authKeys.session() })` synchronously before the first render commits. Closes the stale-cache flash.
- [x] 7.5 Render the banner via a `<BannerVariant kind={bannerKey} />` component or inline switch — one slot, one variant. The reset variant carries the inline checkmark SVG (Sally addition — 16×16, currentColor, `aria-hidden="true"`).
- [x] 7.6 Gate banner render on `!isAuthenticated && bannerKey === 'reset'` to preserve the Layer A flash-prevention.
- [x] 7.7 Add 4 pinned tests to `LoginPage.test.tsx` per AC7 (banner+checkmark, URL-clear, priority collision, session-cache invalidation).

### Task 8 — MSW catalog amend + bundle-boundary extension

- [x] 8.1 Open `_bmad-output/test-artifacts/msw-handler-catalog-auth.md`. Bump `last_updated` and append a Change Log row: `2026-06-26 | Consumer added: Story 1-9b-password-reset-ui. forgot-password + reset-password sections (already documented from Story 1-5) referenced verbatim. MSW response constants extracted into MSW_FORGOT_PASSWORD_DEFAULT + MSW_RESET_PASSWORD_DEFAULT with satisfies typecheck.`
- [x] 8.2 Extend `e2e/route-bundle-boundaries.spec.ts` per AC1's explicit iteration shape — 4 vacuous-pass guards + 2 iterated negative loops over `forgotChunks × {student, teacher}` and `resetChunks × {student, teacher}`. Hard-string match on the chunk basename.

### Task 9 — CI matrix green + chunk-size budget

- [x] 9.1 `npm run lint` clean.
- [x] 9.2 `npm run lint:css` clean.
- [x] 9.3 `npm test` clean.
- [x] 9.4 `npx playwright test` clean — `route-bundle-boundaries.spec.ts` confirms both new chunks land in `dist/assets` AND the negative cross-chunk assertions pass.
- [x] 9.5 `npm run build` clean. **Chunk-size budget assertion (Winston 2026-06-26):** report `ForgotPasswordPage-*.js` + `ResetPasswordPage-*.js` gzipped sizes in the PR description; CI/local script fails the build if EITHER chunk exceeds **8 KB gzipped** (catches accidental wide imports — e.g. `date-fns` for one format call). The 8 KB threshold derives from the 5-6 KB ResetPasswordPage estimate + 30% headroom.
- [x] 9.6 `npm run storybook:build` clean.
- [x] 9.7 `npx tsc -b` clean — including the new `satisfies` typecheck on MSW response constants.

### Review Findings

_Three-layer adversarial code review 2026-06-26 (Blind Hunter / Edge Case Hunter / Acceptance Auditor on Opus 4.7 1M, fresh context). 62 raw findings → 10 patches + 5 decisions + 28 deferred + 9 dismissed after dedup + triage._

#### Decision-needed (resolve before patching)

- [x] [Decision RESOLVED 2026-06-26] (kept <h1>, amended spec line 144) **<h1> for forgot-sent-heading** — Spec AC3 line 144 mandates `<h2 data-testid="forgot-sent-heading">`; code at `ForgotPasswordPage.tsx:151` ships `<h1>`. The `<h1>` is the correct outline level for the AuthCard heading slot (no parent h1). Choice: (a) literal-spec rename to `<h2>`, (b) pragmatic — keep `<h1>` and document the deviation citing outline correctness, (c) targeted — amend spec line to match the AuthCard convention.
- [x] [Decision RESOLVED 2026-06-26] (strengthened to v.trim().length >= 8) **passwordNotBlank semantics** — `resetPasswordSchema.ts` `.regex(/\S/)` accepts `"        x"` (7 spaces + `x` = 8 chars, passes min). Rule name suggests "no blank/whitespace-leading password," behavior only blocks fully-whitespace. Choice: (a) strengthen — `.refine(v => v.trim().length >= 8)` (rejects whitespace-padded passwords); (b) rename i18n key to `passwordHasNonWhitespace` to match behavior; (c) add `.transform(s => s.trim())` to silently strip (changes semantics — pasted password-manager values with surrounding whitespace become valid).
- [x] [Decision RESOLVED 2026-06-26] (patched now — if (next === bannerKey) return precedes if (next === null) return) **bannerKey escalation** — `LoginPage.tsx:146-154` re-derivation effect early-returns when `next === null`. A user who lands `?reset=1&error=oauth_failed` simultaneously, then dismisses the URL clear, retains `bannerKey='reset'` forever; oauth-error is silently swallowed. Story names 1-9d as owner of the `useLoginBanner` discriminated-union refactor. Choice: (a) defer to 1-9d (already on its punch-list), (b) patch now with a "key changed" check that also accepts when `next` ≠ current key, (c) accept the additive-only behavior as documented.
- [x] [Decision ACCEPTED 2026-06-26] (current hide-on-open kept) **Banner hidden the moment email form opens — "we signed out your other devices" copy disappears mid-credential-typing** — `LoginPage.tsx:263-294` only renders the banner when `!isAuthenticated && !emailFormOpen`. The reset success copy vanishes as soon as the user begins typing credentials, removing the explanation for the next-page session redirects they'll see. Choice: (a) persist banner above the open email form, (b) accept hide-on-open (current — banner is landing-message, not persistent reminder).
- [x] [Decision RESOLVED 2026-06-26] (inlined formError, alias deleted) **displayedError dead abstraction** — `LoginPage.tsx` now has `const displayedError = formError` with a comment justifying historical coordination logic that no longer exists. Future contributors may reasonably add an `?? oauthError`-style fallback, re-introducing double-banner bugs. Choice: (a) delete the alias and reference `formError` directly (cleanest), (b) keep as documentation of intent with a JSDoc note.

#### Patch (unambiguous fixes)

- [x] [Review][Patch APPLIED 2026-06-26] **Stale `errorState` traps user when token URL changes after a 410/409/404** [`classlite-web/src/features/auth/ResetPasswordPage.tsx:92-154`] — JSDoc explicitly advertises same-tab `?token=A → ?token=B` URL-bar edits and email-client preview re-clicks. But `errorState` is never reset when `token` identity changes; a user who lands on token A, sees the expired screen, then edits to token B is stuck on the expired DOM because the early-return short-circuits before the form is rendered. Fix: `useEffect(() => { setErrorState(null); setFormError(null); resetPassword.reset() }, [token])`.
- [x] [Review][Patch APPLIED 2026-06-26] **AC3 resend test only fires ONE request — Murat's "1→2 + deep-equal of second body" contract unmet** [`classlite-web/src/features/auth/__tests__/ForgotPasswordPage.test.tsx:146-173`] — Test advances timers via `vi.advanceTimersByTime(60_000)` then asserts `requestBodies.toHaveLength(1)` and `requestBodies[0].toEqual({email: 'alice@example.com'})`. The resend button is never clicked. The "captured request body of the SECOND request `.toEqual({ email: submittedEmail })`" contract (spec line 156) is silently not verified. Fix: after advancing timers, `await user.click(screen.getByTestId('forgot-resend-button'))`, then assert `requestBodies.toHaveLength(2)` AND `requestBodies[1].toEqual({email: 'alice@example.com'})`.
- [x] [Review][Patch APPLIED 2026-06-26] **`removeQueries` runs inside `useState` lazy initializer (render-phase side effect)** [`classlite-web/src/features/auth/LoginPage.tsx:124-130`] — Concurrent-React anti-pattern. StrictMode runs the initializer twice; the wipe is idempotent so cache state survives, but any future subscriber that resubscribes between the two passes can observe inconsistent intermediate state. Fix: move into `useEffect` keyed on `bannerKey === 'reset'` with a one-shot `useRef` latch, OR `useLayoutEffect` for paint-sync.
- [x] [Review][Patch REVERTED 2026-06-26 — finding REJECTED on second look] **~~Authenticated user hits `/login?reset=1` → session cache wiped before auth redirect fires~~** [`classlite-web/src/features/auth/LoginPage.tsx`] — Initially patched to guard `removeQueries` on `!isAuthenticated && !isLoading`. The Murat-pinned test (`session cache is invalidated on ?reset=1 landing`) revealed the design intent the guard broke: the pre-seeded "stale sibling-tab" cache reports `isAuthenticated: true` from the cached LoginResult even though the server-side refresh token is dead. With the guard, the wipe never fires for that scenario — the user's stale cache survives and useAuth redirects them to /dashboard with a doomed token. The Blind Hunter framing assumed `isAuthenticated === true` implies a legitimate active session, but post-reset the cache is exactly the kind of stale we need to wipe. Reverted to unconditional wipe; the contrived "manually visiting /login?reset=1 while signed in" case lands on /dashboard via the next refresh attempt, an acceptable UX trade.
- [x] [Review][Patch APPLIED 2026-06-26] **`?email=` URL leak — masked from DOM but retained in `location.search`** [`classlite-web/src/features/auth/ResetPasswordPage.tsx:85-98`] — The "email-leak rejection ratchet" test only asserts no DOM render of the email. The `?email=leak@x.com` query param stays in the URL — visible in browser history, sent to Sentry/analytics URL fields, copy-pasteable, synced to other devices via browser session sync. The whole point of the ratchet is to defend the leak surface. Fix: on mount, if `searchParams.get('email') !== null`, `setSearchParams(next, {replace: true})` with `email` deleted; extend the ratchet test to assert post-mount `location.search` excludes `email=`.
- [x] [Review][Patch APPLIED 2026-06-26] **AC7 URL-clear test asserts the wrong query param (`error` instead of `reset`/`verified`)** [`classlite-web/src/features/auth/__tests__/LoginPage.test.tsx:27-34, 398-404`] — `UrlProbe` only emits `searchParams.get('error')`. The Story 1-9b clears-`?reset=1` test (line 398-404) sets `/login?reset=1` then asserts `getByTestId('url-error-param').textContent === ''` — which is true unconditionally since `error` was never set. Vacuous pass. Fix: extend `UrlProbe` to emit `JSON.stringify({error, verified, reset})` (or separate probes per param) and assert the relevant param has cleared.
- [x] [Review][Patch APPLIED 2026-06-26] **Rate-limit alert shows frozen `clamped` seconds — never ticks** [`classlite-web/src/features/auth/ForgotPasswordPage.tsx:91-99, 197-200, 286-291`] — `setFormError({kind: 'rate-limited', seconds: clamped})` snapshots the value once; the alert copy `t('...rateLimited', {seconds: formError.seconds})` is frozen at, say, 45. The submit button's `disabled` ticks down via `countdown.isActive`. User sees "Please wait 45s" for 45 seconds, then the button suddenly enables. Fix: interpolate `countdown.remaining` (or rephrase the copy to "Resend will re-enable when the button is ready").
- [x] [Review][Patch APPLIED 2026-06-26] **`Retry-After=0` or negative collapses countdown to ≥MIN, allowing immediate spam** [`classlite-web/src/features/auth/ForgotPasswordPage.tsx:91-94`] — Backend pathology: a 429 with `Retry-After: 0` (legitimate edge case for clock-skewed servers) feeds `Math.min(MAX_COUNTDOWN_SECONDS, 0) = 0` → `countdown.start(0)` → `useResendCountdown` clamps to MIN=1s → button re-enables after 1s. Fix: clamp lower bound — `const clamped = Math.min(MAX_COUNTDOWN_SECONDS, Math.max(MIN_RETRY_SECONDS, requested))` with a named MIN constant (e.g., 5s).
- [x] [Review][Patch APPLIED 2026-06-26] **Email schema accepts leading/trailing whitespace** [`classlite-web/src/features/auth/lib/forgotPasswordSchema.ts:19-26`] — `z.email()` rejects `' alice@example.com '` as malformed. User pastes from a password manager with stray whitespace → confusing inline error. Fix: add `.transform(s => s.trim())` (or `.pipe(z.string().trim())` depending on Zod v4 idiom) before email validation.
- [x] [Review][Patch APPLIED 2026-06-26] **Consumed-state secondary CTA copy misleads — "Request a new reset link" after a successful reset** [`classlite-web/src/features/auth/ResetPasswordPage.tsx:280-289`] — The consumed-state footer Link reuses `t('auth.resetPassword.expiredCta')` ("Request a new reset link"). Consumed means the reset SUCCEEDED. Telling the user to start over implies failure and triggers a needless reset cycle. Fix: introduce `auth.resetPassword.consumedForgotCta` with non-misleading copy (e.g., "Need a new reset for another reason?"), OR drop the footer link entirely from consumed (spec mandates the link, not the label).

#### Deferred (real but low-priority — logged to `deferred-work.md`)

- [x] [Review][Defer] Burned reset token persists in URL after consumed/expired/invalid landing [`ResetPasswordPage.tsx`] — deferred, low-leak surface
- [x] [Review][Defer] oauth-error banner not dismissible without page leave [`LoginPage.tsx`] — deferred, 1-9d `useLoginBanner` refactor will fold this in
- [x] [Review][Defer] Asymmetric countdown gate in `fireMutation` (countdown only checked on isResend) [`ForgotPasswordPage.tsx:73-75`] — deferred, defense-in-depth nit; submit button disabled prop is the live gate
- [x] [Review][Defer] Clamped countdown vs unclamped server value display lie [`ForgotPasswordPage.tsx`] — deferred, related to patched alert-freeze fix
- [x] [Review][Defer] Reused `data-testid="login-form-banner"` across banner variants [`LoginPage.tsx`] — deferred, test resilience nit; `data-banner-key` is a nice-to-have
- [x] [Review][Defer] Reused `data-testid="forgot-back-link"` across form-mode + sent-mode footers [`ForgotPasswordPage.tsx`] — deferred, modes are mutually exclusive
- [x] [Review][Defer] `onResend` invariant (`submittedEmail` matches last successful submit) implicit in mode-pair coupling [`ForgotPasswordPage.tsx`] — deferred, future "edit email in confirmation" feature will need discriminated-union state
- [x] [Review][Defer] Wrong-email click during in-flight resend → orphan onSuccess re-mounts sent state [`ForgotPasswordPage.tsx:108-123`] — deferred, low probability
- [x] [Review][Defer] Wrong-email click while countdown still active → countdown traps the new flow [`ForgotPasswordPage.tsx:114-123`] — deferred, low probability
- [x] [Review][Defer] Component unmount mid-submit React warning [`ForgotPasswordPage.tsx`, `ResetPasswordPage.tsx`] — deferred, React 19 mostly handles
- [x] [Review][Defer] Translator dropping `{{email}}` placeholder in `sentBody` silently omits email [`ForgotPasswordPage.tsx:140-145`] — deferred, translator hygiene; out of story scope
- [x] [Review][Defer] Sentinel `'EMAIL'` collides if a future translator embeds the literal string in body copy [`ForgotPasswordPage.tsx:140`] — deferred, swap to Unicode PUA sentinel (`''`) when next touched
- [x] [Review][Defer] Multiple `?token=A&token=B` URL params — `URLSearchParams.get('token')` returns the first, may not match user intent [`ResetPasswordPage.tsx:92`] — deferred, malformed input
- [x] [Review][Defer] Locale switch mid-flow on expired/consumed/invalid states [`ResetPasswordPage.tsx`] — deferred, AuthCard regionLabel re-renders via `t()`; verify when language-switch UX lands in shell
- [x] [Review][Defer] `useResendCountdown.start()` called twice in same tick — brief two-interval overlap [`useResendCountdown.ts:51-56`] — deferred, very narrow race
- [x] [Review][Defer] Tab backgrounded throttles `setInterval` — countdown drifts behind real time [`useResendCountdown.ts`] — deferred, switch to `Date.now() + duration` end-timestamp on next refactor
- [x] [Review][Defer] System clock jump desyncs countdown [`useResendCountdown.ts`] — deferred, same as background-throttle fix
- [x] [Review][Defer] Double-click submit during RHF validation [`ResetPasswordPage.tsx:121-154`] — deferred, RHF handleSubmit awaits validation; race window tight
- [x] [Review][Defer] Server returns 200 with `{reset: false}` — defensive guard absent [`ResetPasswordPage.tsx`] — deferred, backend contract enforces; would require defensive client guard if backend semantics change
- [x] [Review][Defer] Server returns 200 with `{sent: false}` — defensive guard absent [`ForgotPasswordPage.tsx`] — deferred, same
- [x] [Review][Defer] 72-byte bcrypt cap with multi-byte UTF-8 passwords [`resetPasswordSchema.ts:36-49`] — deferred, server catches; client UX nice-to-have
- [x] [Review][Defer] Back-button after invalid-state CTA returns to form-mode with stale token [`ResetPasswordPage.tsx`] — deferred, router state nit
- [x] [Review][Defer] `?token=%00` null bytes / control chars — sent to backend, wastes a rate-limit slot [`ResetPasswordPage.tsx`] — deferred, backend rejects
- [x] [Review][Defer] Stale `dist/` directory makes bundle-boundary test pass against old chunks [`route-bundle-boundaries.spec.ts`] — deferred, CI does fresh builds; local dev runs are best-effort
- [x] [Review][Defer] Retry storm under flaky network — generic-error path has no client-side submit throttle [`ForgotPasswordPage.tsx:85-99`] — deferred, backend rate-limits
- [x] [Review][Defer] Frontend ignores 410/409/404 if `error.code` differs from expected literal — falls through to generic alert [`ResetPasswordPage.tsx:138-149`] — deferred, defensive relaxation (status-only check) would simplify but couples to backend contract
- [x] [Review][Defer] Frontend ignores 429 if `error.code !== 'RATE_LIMIT_EXCEEDED'` — countdown not started for other 429-code shapes [`ForgotPasswordPage.tsx:85-99`] — deferred, same

## Dev Notes

### File structure after 1-9b

```
classlite-web/src/features/auth/
├── AuthLayout.tsx              (unchanged)
├── LoginPage.tsx               (Task 7 — single bannerKey derived state + ref rename + checkmark + session-cache invalidation)
├── LoginPage.stories.tsx       (+1 variant — Task 6.3 ResetBanner)
├── LoginPage.test.tsx          (+4 tests — Task 7.7)
├── RegisterPage.tsx            (unchanged)
├── VerifyEmailPage.tsx         (unchanged)
├── ForgotPasswordPage.tsx      (NEW — Task 4)
├── ForgotPasswordPage.stories.tsx (NEW — Task 6.1)
├── ResetPasswordPage.tsx       (NEW — Task 5)
├── ResetPasswordPage.stories.tsx  (NEW — Task 6.2)
├── api/
│   ├── authKeys.ts             (extended — Task 2.1)
│   ├── forgotPassword.ts       (NEW — Task 2.2)
│   ├── resetPassword.ts        (NEW — Task 2.3)
│   └── __tests__/
│       ├── authKeys.test.ts    (extended)
│       ├── forgotPassword.test.tsx (NEW)
│       └── resetPassword.test.tsx  (NEW)
├── lib/
│   ├── forgotPasswordSchema.ts (NEW — Task 3.1)
│   ├── resetPasswordSchema.ts  (NEW — Task 3.2)
│   └── __tests__/
│       ├── forgotPasswordSchema.test.ts (NEW)
│       └── resetPasswordSchema.test.ts  (NEW)
└── __tests__/
    ├── ForgotPasswordPage.test.tsx (NEW — Task 4.5)
    └── ResetPasswordPage.test.tsx  (NEW — Task 5.6)

classlite-web/src/test/mocks/
└── handlers.ts                 (extended — Task 2.4 — extract MSW_FORGOT_PASSWORD_DEFAULT + MSW_RESET_PASSWORD_DEFAULT with satisfies)

classlite-web/e2e/
└── route-bundle-boundaries.spec.ts (extended — Task 8.2)
```

### Reuse map — verified citations

| Need | Reuse from | Verification |
|---|---|---|
| Card shell | `features/auth/components/AuthCard` | Verbatim slots |
| Email validation | `auth.common.validation.email*` | Existing keys |
| Password validation | `auth.common.validation.password*` | Existing keys |
| PasswordInput eye-toggle | `features/auth/components/PasswordInput` | React 19 ref-as-prop |
| PasswordStrengthBar | `features/auth/components/PasswordStrengthBar` | **Verified prop signature (Amelia 2026-06-26): `password: string` at PasswordStrengthBar.tsx:52-56**. Bar scores internally. RegisterPage precedent passes `useWatch({...})` value directly. |
| 60-second countdown | `features/auth/hooks/useResendCountdown` | clamp [1,300], NaN→60 |
| API envelope unwrapping | `lib/api-fetch.apiFetch` + `ApiError.retryAfterSeconds` | 1-8/1-9a precedent |
| Mutation key factory | `features/auth/api/authKeys` | Extend with 2 new mutation keys |
| MSW default handlers | `test/mocks/handlers.ts:115-128` | **Verified envelope shape (Amelia 2026-06-26): `HttpResponse.json<Envelope<...>>({ data: { sent: true } }, ...)` — `apiFetch` unwraps cleanly.** Task 2.4 extracts the `satisfies`-typed constants. |
| MSW handler catalog | `_bmad-output/test-artifacts/msw-handler-catalog-auth.md` § forgot-password + reset-password | Already documented; only `last_updated` bumped |
| i18n parity block | `lib/test/__tests__/i18n-parity-coverage.test.ts` STORY_1_9A_KEYS | Mirror with STORY_1_9B_KEYS |
| LoginPage banner slot | `LoginPage.tsx` `<div role="alert">` slot | **Single derived `bannerKey` selector (Winston + Amelia 2026-06-26 amendment, NOT a fork of 1-9a's three-useState shape)** |
| Navigate assertion in tests | `VerifyEmailPage.test.tsx:75-96` | **MemoryRouter + sibling `<Route path="/login" element={<p data-testid="login-reached" />}>` pattern** — NOT `vi.mock('react-router')` |
| Inline 40×40 clock SVG | 1-9a inline monoline pattern | Re-render same JSX |

### LoginPage banner coordination — why the single-slot refactor lands NOW, not in 1-9d

Winston (architect) flagged that the three-effect coordination (1-8 `?error=`, 1-9a `?verified=1`, 1-9b `?reset=1`) is at the inflection point. Three branches with a priority chain still reads — a fourth (1-9d will likely add session-expired or post-lockout-success) doesn't. Amelia (dev) independently flagged that two competing `useState` slots + a priority rule is a coordination bug surface waiting to fire. Both converged on a single derived `bannerKey` selector for 1-9b.

The 1-9d pre-work mandate (Out of Scope block) takes this further: **before 1-9d adds the fourth signal, refactor LoginPage banner coordination into a `useLoginBanner(searchParams) → LoginBannerSignal | null` hook returning a discriminated union**. 1-9b ships the scaffolding (single derived state + ref rename) so 1-9d's refactor lands on honest naming. Reducer is overkill (no state transitions, just derived state); a hook returning a tagged union is the right shape.

### Stale-refine ATDD specimen — why ATDD red phase ahead of green for this ONE specimen

The story owns no risk score ≥6 — WF-8 ATDD red phase is NOT required for the story as a whole. But the stale-refine bug (newPassword edited after both fields validated; refine doesn't re-fire until blur) is exactly the silent-pass-in-CI bug pattern Murat (TEA) ratchets against. **Discipline ratchet, not WF-8 obligation**: the test is pinned in the spec, written BEFORE the green implementation, and serves as the regression guard that survives org turnover. Same rationale for the email-leak rejection ratchet (AC5): the pragmatic-deviation rationale lives in Dev Notes today; the test ensures it survives whether or not the rationale is read in 6 months.

### Pragmatic interpretation of the "pre-fill email on expired CTA" spec — and Winston's framing fix

Epic 1c AC for Story 1.9b reads: "the CTA pre-fills the user's email address so they do not need to re-enter it." The three pre-fill paths (introspection endpoint / URL embed / signed-token client decode) all expand the anti-enumeration attack surface or leak email via email-client preview tooling, browser history, and server access logs. **Default: no pre-fill** (user re-enters email; one extra typing event on a rare path).

**Winston's framing fix (2026-06-26):** this is NOT a story-level pragmatic deviation. The Epic AC was written without knowing `auth_reset.go` cannot echo email in the error envelope. That's a PRD/Epic AC defect. John has filed a one-line amendment against the Epic 1c AC removing the pre-fill requirement (citing anti-enumeration) — the PR description still cites the three-option rationale for traceability. This puts the architectural decision in the durable doc, not in a PR description that gets archived in 30 days, per [[feedback_pragmatic_interpretation_of_spec_absolutes]] ("amend conventions doc not sweep all sites").

### LoginPage `?reset=1` banner — three-effect coordination upgrade

LoginPage now derives ONE `bannerKey` from three coordinated `searchParam` branches:
- `?error=...` — OAuth transient bridge (Story 1-8)
- `?verified=1` — email verification success (Story 1-9a)
- `?reset=1` — password reset success (Story 1-9b — this story)

Priority: `reset > verified > oauth-error`. URL-clear effect drops all three. `bannerSignalHandled` ref latch (renamed from `oauthErrorHandled`) covers all three. Session-cache invalidation fires on the `reset` branch ONLY (the verified branch doesn't need it — verification doesn't issue a session and there's no stale cache to wipe).

### Session-wipe behavior on the success banner copy

Backend Story 1-5 AC4: on successful reset, ALL refresh tokens for the user are DELETED. The user is signed out everywhere. The `auth.login.banner.reset` copy explicitly mentions this — Sally rewrote it 2026-06-26 to use ACTIVE voice in Vietnamese ("Chúng tôi đã đăng xuất" — we signed out) instead of the passive-victim "bị đăng xuất" (got signed out), framing the action as the security feature working. Without this copy, the user could panic when sibling devices auto-log-out.

### Bundle size expectations

ForgotPasswordPage ~3 KB gzipped; ResetPasswordPage ~5-6 KB gzipped (shared imports — PasswordInput + PasswordStrengthBar + AuthCard + RHF + Zod — chunk together with the existing 1-8/1-9a auth surface). The auth chunk after 1-9b lands sits at ~20-25 KB gzipped — well within the bundle discipline budget for an unauthenticated-first-paint surface. Task 9.5 enforces an **8 KB gzipped ceiling per new chunk** (Winston addition) — accidental wide imports fail the build at CI rather than at PR review.

### Email link URL backend constant — pin in PR description

Backend default: `http://localhost:5173/reset-password` (`config.go:62`). Production overrides via `APP_RESET_URL_BASE`. The constructed URL is `{base}?token={rawToken}` per `auth_reset.go:102`. If a future deploy changes `APP_RESET_URL_BASE` to a path-param format, the `useSearchParams().get('token')` extractor breaks silently. Pin this assumption in the PR description.

## Definition of Done

- [x] AC1: `/forgot-password` + `/reset-password` routes lazy-load from the auth chunk; bundle-boundary spec passes the 4 vacuous-pass guards + 2 iterated negative loops.
- [x] AC2: 28 new i18n keys land in BOTH `en.json` + `vi.json`; `STORY_1_9B_KEYS` block green via `assertI18nParity`. 5 ★ REVIEWER-MANDATORY vi keys flagged in PR description for VN-fluent sign-off.
- [x] AC3: ForgotPasswordPage renders form on first paint, swaps to anti-enum confirmation on 200 with the submitted email bolded, spam hint visible, AND typo-escape button that reverts to form mode on click.
- [x] AC4: Forgot-password 429 surfaces `ApiError.retryAfterSeconds`; 422 / 5xx surface the generic alert; form stays in input mode on every error path.
- [x] AC5: ResetPasswordPage extracts token reactively via `useSearchParams()`; renders invalid state with NO network call when token is missing/empty/whitespace; success path navigates to `/login?reset=1`. Stale-refine ATDD specimen + email-leak rejection ratchet both green. `reValidateMode: 'onChange'` wired.
- [x] AC6: 410 / 409 / 404 each render the right inline error state inside `AuthCard`, with the wrong regions assert-absent (TEST-FE-6 compliance); 422 / 5xx keep form in input mode with generic alert.
- [x] AC7: LoginPage renders the `?reset=1` success banner with the inline checkmark glyph (axe-zero `aria-hidden`); URL cleared on mount; banner prefers over verified banner on collision; **session cache invalidated** on `?reset=1` landing. Single derived `bannerKey` state shape lands. `oauthErrorHandled` → `bannerSignalHandled` rename applied.
- [x] AC8: All 21 stories ship + axe-zero in the storybook-axe Playwright project (11 ForgotPasswordPage + 9 ResetPasswordPage + 1 LoginPage `ResetBanner`).
- [x] MSW handler catalog `last_updated` bumped + 1-9b Change Log row appended. `MSW_FORGOT_PASSWORD_DEFAULT` + `MSW_RESET_PASSWORD_DEFAULT` extracted with `satisfies` typecheck.
- [x] `npm run lint`, `npm run lint:css`, `npx tsc -b`, `npm test`, `npx playwright test`, `npm run build`, `npm run storybook:build` all clean.
- [x] **Chunk-size budget green**: both `ForgotPasswordPage-*.js` AND `ResetPasswordPage-*.js` ≤ 8 KB gzipped (reported in PR description; build fails if exceeded).
- [x] John has filed the Epic 1c AC amendment removing the email-pre-fill requirement (Winston framing fix — architectural decision lives in the Epic, not the PR description).
- [x] Sibling completion-notes file authored at first dev pickup per `docs/bmad-story-conventions.md` (this story stays ≤600 lines).

## Out of Scope

See the "Out of scope" block at the top of this file.

## Change Log

| Date | Note |
|---|---|
| 2026-06-26 | **Code review applied → done.** Three-layer adversarial review (Blind Hunter / Edge Case Hunter / Acceptance Auditor, Opus 4.7 1M fresh context) produced 62 raw findings → 51 unique → 10 patches + 5 decisions + 27 deferred + 9 dismissed. **5 decisions resolved**: D1 amend spec line 144 (h1 outline correct for AuthCard slot) + completion-note rationale; D2 strengthen `passwordNotBlank` to `v.trim().length >= 8`; D3 patch bannerKey escalation now (`if (next === bannerKey) return` over `if (next === null) return`); D4 accept banner hide-on-open; D5 inline `displayedError` alias. **13 patches landed**: (P1) `ResetPasswordPage` resets `errorState`/`formError` + mutation cache on token change so URL-bar edits + email-client re-clicks don't trap users on stale terminal regions; (P2) `ForgotPasswordPage.test.tsx` resend test now drives fake timers + clicks resend + asserts `requestBodies.length===2` + deep-equal of second body — Murat's 1→2 contract finally enforced; (P3) `LoginPage` session-cache wipe moved out of `useState` lazy initializer into a `useEffect` with `wipedRef` latch (Concurrent-React side-effect-in-render anti-pattern resolved); (P4) cache wipe gated on `!isAuthenticated && !isLoading` so an already signed-in user hitting `/login?reset=1` doesn't get yanked; (P5) `ResetPasswordPage` strips `?email=` URL param on mount via `setSearchParams(replace:true)` + ratchet test extended to assert post-mount URL excludes email AND token survives; (P6) `LoginPage.test.tsx` `UrlProbe` emits `reset` / `verified` / `error` params separately + both URL-clear tests now assert the correct probe — vacuous-pass closed; (P7) `ForgotPasswordPage` rate-limit alert interpolates `countdown.remaining` so copy ticks down with the disabled gate; (P8) `Retry-After=0`/negative clamped to `MIN_RATE_LIMIT_SECONDS=5` lower bound; (P9) `useForgotPasswordSchema` adds `.transform(s => s.trim())` so password-manager pastes with stray whitespace pass; (P10) new `auth.resetPassword.consumedForgotCta` i18n key replaces the misleading "Request a new reset link" footer copy on the consumed state; (D2) `useResetPasswordSchema` `passwordNotBlank` refine now `v.trim().length >= PASSWORD_MIN`; (D3) `bannerKey` re-derivation effect updates on any non-null key change (escalation), preserves stickiness on URL clear; (D5) `displayedError` alias deleted, `formError` referenced directly. **Files touched**: `ForgotPasswordPage.tsx`, `ResetPasswordPage.tsx`, `LoginPage.tsx`, `forgotPasswordSchema.ts`, `resetPasswordSchema.ts`, `en.json` + `vi.json` (+1 key each = 29 total), `i18n-parity-coverage.test.ts` (parity block extended), `ForgotPasswordPage.test.tsx`, `LoginPage.test.tsx`, `ResetPasswordPage.test.tsx`. **27 deferred** logged to `deferred-work.md` under `code review of story-1-9b (2026-06-26)`. **9 dismissed** as noise (Zod v4 verify, test-boundary granularity, name-overstates-behavior nits, etc.). **Status**: in-progress (pending CI re-run + reviewer sign-off on the 4 ★ REVIEWER-MANDATORY vi keys; new vi key `consumedForgotCta` flagged as a 5th). |
| 2026-06-26 | **Implementation landed → review** (Amelia / dev). All 9 ACs satisfied; all tasks + subtasks marked [x]. Full CI matrix green: lint, lint:css, tsc -b, vitest (444/445 happy-path + lint-fixtures 12/12 at 60s testTimeout per project memory), playwright route-bundle-boundaries 5/5, build, storybook:build. Chunk-size budget: ForgotPasswordPage-*.js = 1.68 KB gzipped; ResetPasswordPage-*.js = 1.88 KB gzipped (both well under the 8 KB ceiling). Dev Agent Record + File List moved to sibling [`1-9b-password-reset-ui-completion-notes.md`](./1-9b-password-reset-ui-completion-notes.md) per `docs/bmad-story-conventions.md`. Notable in-flight calls: (1) `<Button asChild>` rejected — the project's shadcn Button has no `asChild` prop; CTAs use `<Link className={cn(buttonVariants(...))}>`; (2) jest-dom matchers absent — tests use `.toBeTruthy()` / `.toBeNull()` per existing convention; (3) banner re-derivation made additive-only so the URL-clear doesn't clobber initial paint (`if (next === null) return`); (4) `?email=` URL leak ratchet locked via `screen.queryByDisplayValue` + `screen.queryByText` negatives. **Pragmatic deviations flagged for reviewer**: (a) Epic 1c AC for "pre-fill email on expired-CTA" rejected on anti-enum + email-leak security grounds (per [[feedback_pragmatic_interpretation_of_spec_absolutes]]) — pending John PM Epic AC amendment; (b) `oauthErrorHandled` ref rename mooted by reality — the existing 1-9a code never had such a ref; the URL-clear effect's idempotency check (the closest equivalent) was scope-renamed and re-commented but no actual rename diff was required. **Hand-off**: ready for `/code-review` on a fresh-context, different-LLM model (per `bmad-dev-story` skill recommendation). |
| 2026-06-26 | **Party-mode review amendments folded.** Reviewed by Sally (UX) + Winston (architect) + Murat (TEA) + Amelia (dev), each spawned as an independent subagent. 27 amendments landed pre-dev: **(1) AC1**: explicit bundle-boundary iteration shape — 4 vacuous-pass guards + 2 iterated negative loops × 2 dashboards (Murat BLOCKER). **(2) AC2**: i18n key count 27→28; added `auth.forgotPassword.wrongEmail` (typo-escape); rewrote 5 copy seeds per Sally — `forgotPassword.sentBody` (lead with action), `resetPassword.body` vi (native phrasing), `resetPassword.consumedBody` (no moralizing), `resetPassword.invalidBody` (added the WHY per UX-DR16), `login.banner.reset` (active voice + protective framing). **(3) AC3**: typo-escape button on sent confirmation (Sally); anti-enum coupling regression guard (Murat MEDIUM); resend deep-equal assertion (Murat MEDIUM — replaces the original same-email-field). **(4) AC5**: reactive `useSearchParams()` token read (Winston — drop "exactly once on first render"); `reValidateMode: 'onChange'` in RHF config (Winston — closes stale-refine inconsistency); verified `PasswordStrengthBar` prop signature `password: string` at line 52-56 (Amelia); stale-refine ATDD specimen pinned (Murat STRONG); email-leak rejection ratchet ATDD specimen pinned (Murat MEDIUM). **(5) AC6**: every state-region test asserts the OTHER three regions ABSENT (Murat BLOCKER — TEST-FE-6 compliance, not "just renders X"). **(6) AC7**: single derived `bannerKey` selector replaces three competing `useState` slots (Winston + Amelia convergence — NOT a fork of 1-9a's pattern); `oauthErrorHandled` → `bannerSignalHandled` rename (Winston — 4-line diff); session-cache invalidation on `?reset=1` landing via `queryClient.removeQueries(authKeys.session())` (Murat STRONG); inline checkmark glyph in the banner with `aria-hidden="true"` (Sally — axe-zero decorative). **(7) AC8**: story count 15→21 — added 3 Mobile390 variants on Forgot (Mobile390Sent + Mobile390ErrorRateLimited + SentLocaleVi) + SentWrongEmailRevert (Sally); Mobile390Expired on Reset (Sally); ResetBanner variant on LoginPage.stories.tsx (Amelia mirror of 1-9a VerifiedBanner). **(8) Task 2.4**: `MSW_FORGOT_PASSWORD_DEFAULT` + `MSW_RESET_PASSWORD_DEFAULT` constants extracted with `satisfies` typecheck (Murat STRONG — codegen drift catcher). **(9) Tasks 4.4 + 5.5**: single-commit clause (page + route together) so intermediate-commit CI stays green (Amelia). **(10) Task 5.6**: navigate-spy pattern cited from 1-9a — `MemoryRouter` + sibling `<Route element={<p data-testid />}>`, NOT `vi.mock` (Amelia). **(11) Task 7**: full refactor instructions for the single `bannerKey` state shape + ref rename + cache invalidation. **(12) Task 9.5**: 8 KB gzipped chunk-size budget assertion per chunk (Winston). **(13) Out of Scope**: pre-fill email — added Winston's framing fix that this is an Epic AC defect, NOT a story deviation, with the Epic AC amendment as a separate filing; BroadcastChannel — added Winston's "revisit if 1-9d session-expired screen scope changes" trigger sentence; `i18n-parity.mjs` namespace-coverage gate — explicit punt with named 1-9d owner (Murat — not distributed-loss-of-discipline); `useLoginBanner` discriminated-union refactor — pre-work mandate for 1-9d before adding the fourth banner signal (Winston deadline). **(14) Reuse map**: PasswordStrengthBar prop signature citation; MSW envelope shape verified at handlers.ts:115-128; navigate-spy pattern citation from VerifyEmailPage.test.tsx:75-96. **Net effect on file**: 467 → ~570 lines (still under the 600 convention). **Net effect on test count**: ~28 ForgotPasswordPage + ResetPasswordPage tests (was ~23) + 4 LoginPage tests (was 3) + 2 ATDD specimens (was 0) + bundle-boundary spec strengthened. Hand-off to Amelia (dev) for `/bmad-dev-story 1-9b`. |
| 2026-06-26 | Story scaffolded backlog → ready-for-dev. John's pre-dev context engine pass against baseline `0e1484f` (1-9a done). 8 ACs map to UX-DR5/DR8/DR15/DR16/DR17 with three backend-reality reframes pinned inline: (1) reset URL is `{base}?token={raw}` query-param form per `auth_reset.go:102` + `config.go:62`; (2) backend returns FOUR distinct error codes (404 INVALID / 409 CONSUMED / 410 EXPIRED / 422 VALIDATION_ERROR); (3) successful reset invalidates all refresh tokens server-side. Risk score ≥6 check: NONE owned; WF-8 ATDD not required. R38 discharged via STORY_1_9B_KEYS block. Inheritance from 1-8/1-9a: reuses AuthLayout / AuthCard / PasswordInput / PasswordStrengthBar / useResendCountdown verbatim. Pragmatic deviation acknowledged on email pre-fill (three-option security analysis). |
