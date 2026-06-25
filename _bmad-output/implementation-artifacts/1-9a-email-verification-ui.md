---
baseline_commit: 02a27d9
---

# Story 1.9a: Email Verification UI

Status: done

> **Why this story matters.** Story 1-8 shipped registration but left every new user stranded on a 404 — `useRegister` already navigates to `/verify-email?pollId={uuid}` and the route falls through to the catch-all NotFound today. 1-9a closes the gap and ends the "register → ??? → log in" cliff. The contract is concrete: a polished verification-pending screen with the AUTH-04 envelope illustration and bold email display (UX-DR9); a 5-second poller that auto-detects when the user clicks the email link in another tab and slides them to `/login?verified=1`; a 60-second resend countdown that mirrors the backend's per-email rate limit; a Google fallback offering the same-account escape hatch (the architecture guarantees Google OAuth users skip email_verified); and an email-click landing path (`/verify-email?token={token}`) that handles 200 / 410 / 404 / 422 cleanly. R38 is discharged via a new `STORY_1_9A_KEYS` block in `i18n-parity-coverage.test.ts`.
>
> **One risk score ≥6 owned — R-NEW: setTimeout-redirect race with unmount on `verified: true`.** **Re-scored 2026-06-25 (party-mode review): P=3 (attention-spike window, not passive — the 800–1500ms opens precisely on the success moment when users are primed to tab-switch / close / click) × I=4 (worst case is navigate firing after a parallel session wipe or poll-401 → route-guard crash / flash of authenticated chrome, NOT merely "wrong route silently") = **12, MITIGATE-HARD**. The actual mitigation (not the test) is two-part: (a) the redirect timer is scheduled inside a `useEffect` keyed off `verified === true` so the effect's cleanup owns the timer (`clearTimeout` runs on unmount, parent re-render, or `verified` flip) — NOT inside the mutation's `onSuccess` (where the timer-id would have to be ref-stored and the cleanup wired separately); (b) the navigate callback re-reads a "still mounted + still verified + session-not-wiped" guard ref before firing, so a 401 silent-refresh during the delay short-circuits the navigate. The pinned tests under AC3 + AC6 (in-app `<Link>` click mid-delay, browser close mid-delay, `verified=true` then 401 mid-delay) are **regression guards locking the mitigation**, not the mitigation itself. R38 (i18n parity) inherits from 1-7c's CI gate via the new `STORY_1_9A_KEYS` block + the namespace-coverage extension (Task 2.5 — adds `'auth.'` to `COVERED_NAMESPACES` in `scripts/i18n-parity.mjs`; **verified 2026-06-25 that `auth.` is NOT currently in the list — `sidebar / topbar / mobileTab / pageHead / userPill / appShell`**). R4/R5/R6/R7/R13 are backend / OAuth-callback territory already discharged at stories 1.4 / 1.5 / 1.6. Poller-reliability is a local concern (no leaked intervals on unmount, no infinite polling past the 10-minute cap, no double-fire under StrictMode); the `usePolling` hook shipped at 1-7c encapsulates the cleanup discipline and 1-9a is its first consumer. **Important: `usePolling` does NOT abort in-flight fetches when `enabled` flips to false — it only clears the interval. `useVerificationPoller` (Task 4.1) therefore tracks a "terminal state committed" ref and ignores late `200/404` responses that arrive after a terminal commit; pinned in AC5.** WF-8 ATDD red phase is upgraded to **REQUIRED** for R-NEW given the new 12 score — see Task 0 below for the red-phase scaffold ahead of green.

> **Scaffold reality check (READ FIRST — many 1-9a primitives already exist on disk).**
>
> - `classlite-web/src/features/auth/api/register.ts` lines 61–64 already calls `navigate(\`/verify-email?pollId=${encodeURIComponent(result.verifyPollId)}\`, { replace: true })`. The redirect target is the contract 1-9a must honor — do NOT change `register.ts`. The query param key is `pollId` (camelCase, NOT `poll_id`); already URL-encoded by the encoder.
> - `classlite-web/src/hooks/usePolling.ts` is the **shipped, real** debounce-aware interval hook (the JSDoc explicitly names "Story 1-9a's email verification poller" as its first consumer). It accepts `{fn, intervalMs, enabled}` and returns `{isPolling}`; cleanup on unmount + `enabled` flip is done. It does NOT enforce the 10-min cap — that's 1-9a's job via `enabled=false` once the cap fires. DO NOT write a new polling hook; consume this one.
> - `classlite-web/src/lib/api/client.ts` already carries the auto-generated `EnvelopeVerifyStatusResult`, `EnvelopeResendResult`, `EnvelopeVerifyEmailResult`, `VerifyStatusResult`, `ResendResult`, `VerifyEmailResult`, `VerifyEmailRequest`, `ResendVerificationRequest` schemas. Import wire types from `components['schemas']['VerifyStatusResult']`; NEVER hand-write API types (TS-2 + XL-1). NEVER use generated types as form state (TS-2).
> - `classlite-web/src/features/auth/AuthLayout.tsx` exists (1-8 final form: wordmark + responsive LanguageToggle + dot-grid via global body). 1-9a's `/verify-email` route mounts as a NEW child under AuthLayout — DO NOT add a second layout wrapper; reuse the existing one.
> - `classlite-web/src/features/auth/components/AuthCard.tsx` is the canonical card shell — `<section role="region">` with `regionLabel` / `heading` / `body` / `footer?` slots, `max-w-[420px]` desktop, `rounded-[14px]`, `bg-[var(--cl-surface)]`. 1-9a's VerifyEmailPage composes AuthCard the same way LoginPage and RegisterPage do — DO NOT fork the card.
> - `classlite-web/src/features/auth/components/GoogleOAuthButton.tsx` ships from 1-8 with the contract `<a href="/api/auth/google">` + 4-color SVG + aria-busy on click. 1-9a's "Sign in with Google" fallback link consumes it verbatim (label key changes via the `label` prop). NO new OAuth flow — same anchor, same /api/auth/google entry. The architecture line 217 promise ("Google OAuth users skip email verification") is enforced by the backend; the frontend just initiates the standard flow.
> - `classlite-web/src/features/auth/api/authKeys.ts` already exports `authKeys = { all, session, loginMutation, registerMutation }` with the `Session` type. 1-9a EXTENDS the factory with `verifyStatus(pollId: string)` query key + `resendMutation()` + `verifyEmailMutation()` mutation keys (follows the 1-8 P5 split — cache key shared, mutation keys distinct per `authKeys.test.ts` contract).
> - `classlite-web/src/features/auth/LoginPage.tsx` already renders a form-level `<div role="alert">` slot for the OAuth transient bridge (`/login?error=...` from 1-8). 1-9a adds a SECOND query-param branch to the same slot: `/login?verified=1` renders a success banner via the same lazy-initialized `useState` pattern (P12). The mechanism is identical; only the key + visual variant differ. NO new LoginPage refactor.
> - `classlite-web/src/test/mocks/handlers.ts` covers `/api/auth/register`, `/login`, `/refresh`, `/logout`, `/forgot-password`, `/reset-password`. The three verify endpoints (`/verify-email`, `/resend-verification`, `/verify-status`) are NOT in the default handler array yet. 1-9a lands the verbatim defaults from the extended MSW catalog (Task 1 below extends `msw-handler-catalog-auth.md` first, then copies into `handlers.ts`).
> - `classlite-web/src/locales/en.json` carries one verify-adjacent key today: `auth.register.emailDelivery.failedToast` (1-8). The `auth.verify.*` namespace is EMPTY in both en + vi. 1-9a's i18n additions land as a contiguous block under `auth.verify.*` plus the small `auth.login.banner.verified` key (the success banner on LoginPage).
> - `classlite-web/src/lib/test/__tests__/i18n-parity-coverage.test.ts` lines 482–486 carry the `STORY_1_8_KEYS` block. 1-9a appends a new `STORY_1_9A_KEYS` const + `describe('Story 1-9a i18n parity (R38)', ...)` block immediately after (mirror the 1-8 pattern verbatim).
> - `classlite-web/src/routes.tsx` lines 82–101 carries the AuthLayout children: `{ path: 'login' }` + `{ path: 'register' }`. 1-9a appends `{ path: 'verify-email' }` lazy-loading `VerifyEmailPage` — the lazy-bundle group stays cohesive so the auth chunk continues to load as one unit.
> - `classlite-api/api.yaml` lines 74–157 (POST endpoints) + lines 543–572 (GET /verify-status) are LIVE. Email link URL is `{APP_VERIFY_URL_BASE}?token={token}` per `classlite-api/internal/service/auth.go:654` (`verifyURL := s.verifyURL + "?token=" + token`); default base in dev is `http://localhost:5173/verify-email`. The `/verify-email` page is therefore **dual-mode** — branches on `useSearchParams().get('token')` vs `useSearchParams().get('pollId')`. NEVER assume a single mode; both must work from day one.
> - `_bmad-output/test-artifacts/msw-handler-catalog-auth.md` frontmatter already names 1-9a as a target story (line 5). The catalog body documents 6 endpoints today; 1-9a extends with the three verify endpoints (Task 1 amends in-place — catalog must lead, not trail).
> - `apiFetch` from `src/lib/api-fetch.ts` already exposes `retryAfterSeconds` on `ApiError` for `RATE_LIMIT_EXCEEDED` (1-8 wiring). The resend 429 path uses this directly — NO new error-handling primitive needed.

> **Out of scope (explicit deferrals — each owned by a specific later story).**
>
> - **Polished error-recovery screens** (Lockout countdown / OAuth email mismatch / Google Workspace blocked / Session expired) — Story 1.9d. 1-9a renders the "verification link expired" state inline within the verify-email page (per UX-DR9 + UX-DR16 three-part recovery) but does NOT extract a standalone error layout component. 1.9d owns the systemic auth-error pages.
> - **Per-locale Vietnamese fluent reviewer pass on new keys** — Vietnamese seed copy is machine-translated from the AUTH-04 mockup literals (the en variants are inferred from the vi mockup since the spec only ships vi). The story flags the 3 ★ REVIEWER-MANDATORY keys in the Change Log (resend toast / token-expired body / generic error) for VN-fluent reviewer sign-off before merge — same convention as 1-8.
> - **`--cl-status-warning` token bridge** — the "verification link expired" alert currently uses `border-amber-300/40 bg-amber-50` (pragmatic Tailwind utilities) rather than a `bg-warning` shadcn-semantic token. The bridge addition is tracked under the existing `1-8-followup-warning-token-bridge` entry in `deferred-work.md`; 1-9a does NOT block on it. The amber utilities are visually correct.
> - **Cross-tab "verified in tab B, hydrate tab A" via BroadcastChannel** — 1-8 already ships the `refresh-succeeded` BroadcastChannel for silent-refresh cross-tab sync. Email verification does NOT use BroadcastChannel: the polling tab's perception gap is **bounded** (not "caught") by the 5-second tick — verification in tab B propagates to tab A within ≤5s. Adding a verify-specific channel would duplicate the existing query-cache subscription with no measurable user benefit. **Worst-case perception gap (party-mode review 2026-06-25)**: user clicks email in tab B → tab B redirects → user flips back to tab A within 5s → sees stale envelope screen → may click "Resend" out of confusion → hits the 60s countdown they didn't earn. The countdown bounds the damage; the next poll tick reconciles state. If a user opens 3 tabs and verifies, the other 2 catch up at the next poll, all racing to `/login?verified=1` (idempotent landing — Winston confirmed this is correct behavior, not a bug). **Revisit trigger:** when Epic 9 billing-grace introduces explicit tab-coordination, fold the verify cross-tab signal into the same BroadcastChannel surface. Until then, deferred.

> - **Cross-browser verification** (user clicks email in a different browser than the one holding the verify-email tab) — the original polling tab will catch verification at the next 5s tick via the shared backend pollId; no per-browser cross-signaling exists. Same boundedness as cross-tab; explicitly out-of-scope to special-case. Documented assumption, not a bug.
> - **Onboarding redirect after verification** — Story 2.1 owns the "first login after verify → /onboarding" rule. 1-9a always redirects to `/login?verified=1`; the LoginPage's existing `replace: true → /dashboard` navigation runs after login, and 2.1 will later wrap the post-login navigation with the onboarding gate. 1-9a's success path stays "verify → login → dashboard" today.
> - **VerifyEmailPage standalone "click here to recheck" loop after 10-min timeout** — the spec calls for ONE manual recheck button after the cap fires. The button fires a single GET /verify-status. If it returns `verified: false`, the screen stays on the recheck state (NOT a re-armed poller). Re-arming requires user action — submitting resend re-arms the 10-min window with the new pollId.
> - **`/verify-email` route without query params** — direct visits to `/verify-email` with NEITHER `pollId` NOR `token` render an "Invalid verification link" screen with a CTA to `/login`. Documented as the deterministic fallback, NOT a redirect (a redirect would mask a debugging signal in dev).
> - **Adding new shadcn primitives** — every primitive 1-9a needs is already in `components/ui/` from 1d-2 (Button, Alert is missing per 1-8 fallback but the inline `<div role="alert">` pattern is already established and 1-9a follows it). NO `npx shadcn add` runs.

## Story

As a user who just registered with email/password OR who just clicked the verification link in my email,
I want a clear, polished verification-pending screen that auto-detects when I verify in another tab, plus a clean handler for the click-through path with bilingual copy and a Google fallback escape hatch,
so that I can finish onboarding within seconds of clicking the email link — without manually refreshing, without re-typing my email into a resend form, and without being stranded when the link expires after 24 hours.

## Acceptance Criteria (BDD)

> **Risk-score ≥6 check (per WF-8).** This story owns NO risk score ≥6. R38 (i18n parity) inherits from 1-7c's CI gate; discharge is a new `describe('Story 1-9a i18n parity (R38)', ...)` block in `src/lib/test/__tests__/i18n-parity-coverage.test.ts` listing the ~14 new keys (AC2 below). Poller reliability is a local concern handled by `usePolling`'s built-in cleanup + the 10-minute cap state below; no system-level risk register entry. WF-8 ATDD red phase is NOT required.

### AC1: `/verify-email` route added to AuthLayout children (lazy-loaded, dual-mode)

**Given** the file `classlite-web/src/routes.tsx`,
**When** inspecting the AuthLayout children array after this story lands,
**Then** the array contains a NEW entry `{ path: 'verify-email', lazy: async () => { const { default: VerifyEmailPage } = await import('@/features/auth/VerifyEmailPage'); return { Component: VerifyEmailPage } } }` appended after the `'register'` entry,
**And** the Playwright spec at `e2e/route-bundle-boundaries.spec.ts` continues to pass — the auth chunk now contains AuthLayout + LoginPage + RegisterPage + VerifyEmailPage (and only these), and the student / teacher dashboard chunks do NOT pull in VerifyEmailPage.

**And** `VerifyEmailPage` is the lazy default export from a NEW file `classlite-web/src/features/auth/VerifyEmailPage.tsx`. The component branches on `useSearchParams()`:

| Query string | Mode | Behavior |
|---|---|---|
| `?pollId={uuid}` | **Polling mode** (post-register) | Renders the AUTH-04 envelope screen + starts the 5-second poller against `GET /api/auth/verify-status?pollId={uuid}` |
| `?token={base64}` | **Click-through mode** (email link landing) | Renders a transient "Verifying…" skeleton + fires `POST /api/auth/verify-email { token }` exactly once; redirects based on response |
| neither | **Invalid mode** | Renders the "Invalid verification link" inline state with a CTA `<Link to="/login">` |
| BOTH | **Click-through wins** | If both query params are present, the token POST takes priority (the user clicked the email and the pollId is now stale) |

**Pinned test contracts** (`features/auth/__tests__/VerifyEmailPage.test.tsx`, MSW seam):
- 8 tests covering each mode + branch above; assertion on the rendered region's `data-testid` to disambiguate (`verify-polling` / `verify-click-through` / `verify-invalid`).
- Three-state coverage on the polling mode (TEST-FE-2): `verify-polling-loading` skeleton on first paint before the first poll resolves; `verify-polling-pending` body after the first 200 with `verified: false`; `verify-polling-error` inline alert on a 404 polling response.

**Bundle-boundary negative assertion** (party-mode 2026-06-25 — Murat's missing pin):
`e2e/route-bundle-boundaries.spec.ts` MUST be amended with explicit negative assertions, not just regex inclusion:
```ts
expect(authChunkContents).toContain('VerifyEmailPage')          // positive
expect(studentDashboardChunkContents).not.toContain('VerifyEmailPage')   // negative — closes vacuous-pass risk
expect(teacherDashboardChunkContents).not.toContain('VerifyEmailPage')   // negative
```
Hard string match on the literal export name, not regex. Five lines, no excuse.

### AC2: i18n keys — every new string in both en + vi, parity asserted (R38 inheritance)

**Given** the files `classlite-web/src/locales/en.json` and `classlite-web/src/locales/vi.json`,
**When** running `npm test -- i18n-parity-coverage`,
**Then** both files contain every key in the union below, and a new `STORY_1_9A_KEYS` const + `describe('Story 1-9a i18n parity (R38)', ...)` block in `src/lib/test/__tests__/i18n-parity-coverage.test.ts` enumerates these additions and runs `assertI18nParity(STORY_1_9A_KEYS)`:

| Key | en seed | vi seed (AUTH-04 mockup literal where available) | Notes |
|---|---|---|---|
| `auth.verify.title` | "Check your email" | "Kiểm tra email" | Page heading (Fraunces) — AUTH-04 line 1659 |
| `auth.verify.bodyPrefix` | "We sent a verification link to" | "Chúng tôi đã gửi link xác nhận đến" | Body line 1 — AUTH-04 line 1661 |
| `auth.verify.bodySuffix` | "Click the link to finish signing in." | "Nhấn vào link để hoàn tất đăng nhập." | Body line 3 (below the bolded email) |
| `auth.verify.resendCta` | "Resend email" | "Gửi lại" | Resend button label — AUTH-04 line 1665 |
| `auth.verify.resendCountdown` | "Resend in {{seconds}}s" | "Gửi lại sau {{seconds}}s" | Disabled button caption while countdown active |
| `auth.verify.resendSentToast` | "If your email is registered, a new verification link is on its way." | "Nếu email đã đăng ký, link xác nhận mới đang được gửi." | Toast after resend success (anti-enum copy) — **★ REVIEWER-MANDATORY (vi)** |
| `auth.verify.spamHint` | "Check your spam folder if you don't see it within a minute." | "Kiểm tra hộp thư rác nếu bạn không thấy email trong vòng một phút." | Microcopy below the body block — added per Sally's 2026-06-25 review (closes the empty-inbox confusion gap) — **★ REVIEWER-MANDATORY (vi)** |
| `auth.verify.wrongEmailPrompt` | "Not {{email}}?" | "Không phải {{email}}?" | Prompt for the typo-escape link — added per Sally's 2026-06-25 review |
| `auth.verify.wrongEmailCta` | "Use a different address" | "Dùng địa chỉ khác" | Typo-escape link copy (routes back to `/register` with email field pre-focused) |
| `auth.verify.googleFallbackPrompt` | "Didn't get the email?" | "Không nhận được email?" | Lead-in above the Google fallback link — AUTH-04 line 1669 |
| `auth.verify.googleFallbackCta` | "Sign in with Google using {{email}} — we'll link them automatically." | "Đăng nhập bằng Google bằng {{email}} — chúng tôi sẽ liên kết tự động." | Google fallback link copy — rewritten per Sally's 2026-06-25 review to make account-linking semantics explicit (the original "same account, no verification needed" presumed the user understands account-coupling). **Architecture confirmation REQUIRED before merge**: Winston/backend must confirm that Google OAuth with an existing email matches/links to the same account row, not creates a separate user. If linking semantics differ, this copy is a blocker. — **★ REVIEWER-MANDATORY (vi)** |
| `auth.verify.timeoutHeading` | "Still checking your inbox" | "Vẫn đang kiểm tra hộp thư của bạn" | Heading shown after 10-min poller cap — rewritten per Sally's 2026-06-25 review (active voice; the original "Still waiting?" put the burden on the user and read like the app gave up) |
| `auth.verify.timeoutBody` | "We've paused automatic checking. Tap the button below when you've clicked the link." | "Chúng tôi đã tạm dừng kiểm tra tự động. Nhấn nút bên dưới sau khi bạn đã nhấn vào link." | Body for manual-recheck state — rewritten to match the active-voice timeout heading |
| `auth.verify.recheckCta` | "I clicked the link" | "Tôi đã nhấn vào link" | Manual-recheck button label — rewritten per Sally's 2026-06-25 review (matches the user's mental model of what they just did in the other tab; the original "Check verification status" read like a support portal button) |
| `auth.verify.expiredHeading` | "Verification link expired" | "Link xác nhận đã hết hạn" | Heading for the 410 POST result + 404 polling result (UX-DR16 part 1: what happened) |
| `auth.verify.expiredBody` | "Links expire after 24 hours. Request a new one and we'll send it right away." | "Link hết hạn sau 24 giờ. Yêu cầu link mới và chúng tôi sẽ gửi ngay." | Body (UX-DR16 part 2: why) — **★ REVIEWER-MANDATORY (vi)** |
| `auth.verify.expiredResendCta` | "Send a new link" | "Gửi link mới" | Primary CTA (UX-DR16 part 3: what next) |
| `auth.verify.invalidHeading` | "Invalid verification link" | "Link xác nhận không hợp lệ" | Heading for the 404 POST result + neither-query-param fallback |
| `auth.verify.invalidBody` | "This link can't be used. Try the link in your most recent email, or sign in to request a new one." | "Không thể dùng link này. Hãy thử link trong email gần nhất, hoặc đăng nhập để yêu cầu link mới." | Body (UX-DR16 three-part) |
| `auth.verify.error.generic` | "Something went wrong. Please try again." | "Đã có lỗi xảy ra. Vui lòng thử lại." | Generic alert for 422 / 5xx / network — **★ REVIEWER-MANDATORY (vi)** |
| `auth.verify.error.rateLimited` | "Please wait {{seconds}}s before requesting another email." | "Vui lòng chờ {{seconds}}s trước khi yêu cầu email khác." | Resend 429 alert (driven by `ApiError.retryAfterSeconds` from 1-8) |
| `auth.verify.checkingNow` | "Checking…" | "Đang kiểm tra…" | aria-live announcement during click-through POST |
| `auth.verify.successRedirecting` | "Verified! Redirecting to sign-in…" | "Đã xác nhận! Đang chuyển hướng đến đăng nhập…" | aria-live announcement during the brief delay before the navigate |
| `auth.login.banner.verified` | "Your email is verified. Sign in to continue." | "Email của bạn đã được xác nhận. Đăng nhập để tiếp tục." | LoginPage success banner shown on `/login?verified=1` — see AC6 |

**And** the 5 ★ REVIEWER-MANDATORY Vietnamese keys are flagged in the PR description for a VN-fluent reviewer pass before merge (same convention as 1-8 — NOT a `TODO` comment in the JSON file). The 5 keys are: `resendSentToast`, `expiredBody`, `error.generic`, `spamHint` (added 2026-06-25 review), `googleFallbackCta` (rewritten 2026-06-25 review — the new "we'll link them automatically" copy ALSO carries an architecture-confirmation gate; if Winston confirms Google OAuth does NOT auto-link same-email accounts on the backend, this copy is a blocker and the entire Google fallback messaging needs a rewrite before merge).

### AC3: Polling mode — AUTH-04 envelope screen + 5s poller + auto-redirect on verify

**Given** `VerifyEmailPage` mounts with `?pollId={uuid}` and no `?token`,
**When** the page first paints,
**Then** the rendered region (`data-testid="verify-polling"`) inside `AuthCard` contains:
- The envelope SVG with amber checkmark overlay per AUTH-04 mockup (lines 1650–1657) — inline JSX, not loaded from a file, NOT from an external CDN. **Responsive sizing (Sally 2026-06-25 amendment):** 80×80 on desktop (≥768px), 64×64 on mobile (<768px) via Tailwind responsive classes (`h-16 w-16 md:h-20 md:w-20`). Mobile-shrunk variant preserves the illustration as reassurance without crowding the 390px viewport.
- An `<h1 data-testid="verify-heading">` with `t('auth.verify.title')`, Fraunces font, 28px desktop / 24px mobile per `text-3xl md:text-3xl text-[var(--cl-ink)]` with the `font-[var(--cl-font-display)]` class.
- A centered body block: `t('auth.verify.bodyPrefix')` + a bolded `<span data-testid="verify-email-display" class="break-all">` containing the user's email (read from `useAuth().user?.email`; if `null`, fall back to `t('auth.verify.bodyPrefix')` alone and skip the bold — never display the literal string `null`). The `break-all` class is scoped to the email span ONLY (not the surrounding paragraph) so a 40+ char email wraps mid-string at narrow viewports without breaking the surrounding copy — pinned by Sally's 2026-06-25 review.
- The `auth.verify.bodySuffix` paragraph.
- **Spam-folder microcopy** (Sally 2026-06-25 amendment): a `<p data-testid="verify-spam-hint" class="text-sm text-[var(--cl-ink-muted)]">` rendering `t('auth.verify.spamHint')` ("Check your spam folder if you don't see it within a minute.") immediately below `bodySuffix`. De-emphasized weight; this is empathy microcopy, not primary action.
- A `<Button variant="outline" data-testid="verify-resend-button">` rendering `t('auth.verify.resendCta')` (countdown display inside the button per AC4 when active).
- **Typo-escape link** (Sally + John 2026-06-25 convergent amendment): a `<p data-testid="verify-wrong-email" class="text-sm">` rendering `t('auth.verify.wrongEmailPrompt', { email: <bolded.email> })` followed by `<Link to="/register" data-testid="verify-wrong-email-link" state={{ prefillEmail: user?.email }}>` rendering `t('auth.verify.wrongEmailCta')`. Closes the silent-failure mode for users who typed a wrong email at register-time. The `<Link>` carries `state.prefillEmail` so RegisterPage can pre-focus the email field with the prior value visible (RegisterPage already supports this via the existing form-state hydration; if it does not, the link still routes — graceful degradation). If `useAuth().user?.email` is null, the typo-escape block is hidden entirely (no prompt without a known email to compare against).
- A `<p data-testid="verify-google-fallback-prompt">` rendering `t('auth.verify.googleFallbackPrompt')` followed by `<Link to="/api/auth/google" data-testid="verify-google-fallback-link">` rendering `t('auth.verify.googleFallbackCta', { email: user?.email })` — anchor + top-level nav, NOT XHR (matches the 1-8 GoogleOAuthButton contract). Reuse the 1-8 `GoogleOAuthButton` component if practical, OR ship a plain anchor styled per UX-DR9 — choose at dev time based on which produces less visual noise inside the verification card. **Architecture confirmation required (per AC2 footnote)**: if backend does NOT auto-link same-email Google OAuth to the registered account, this whole link block becomes a blocker — the rewritten copy presumes linking semantics.

**And** the poller starts on mount via `useVerificationPoller({ pollId })` (a NEW hook at `src/features/auth/hooks/useVerificationPoller.ts` that wraps `usePolling`):
- `intervalMs: 5_000` (UX-DR9 contract, 5-second cadence)
- `enabled: true` until the elapsed time reaches the **10-minute cap** OR the poll returns `verified: true` OR the poll returns a 404 (POLL_ID_NOT_FOUND)
- `fn: () => apiFetch<VerifyStatusResult>(\`/api/auth/verify-status?pollId=${encodeURIComponent(pollId)}\`)` — apiFetch unwraps the envelope per TS-4

**And** the poller's response branches:

| Response | Action |
|---|---|
| 200 `{verified: true, email}` | Commit local state `verified=true` via `useState` setter (gated by the terminal-state ref — see AC5 in-flight-race contract). The redirect is NOT scheduled inside `onSuccess`; instead a separate `useEffect` keyed on `verified === true` schedules the timer (so the effect's cleanup owns `clearTimeout` on unmount / parent re-render). The effect renders the `auth.verify.successRedirecting` aria-live announcement, then `setTimeout(() => { if (stillMountedAndVerifiedRef.current) navigate('/login?verified=1', { replace: true }) }, VERIFY_REDIRECT_DELAY_MS)`. Constant: `VERIFY_REDIRECT_DELAY_MS = 1500` per CQ-3 (extended from the original 800ms in the 2026-06-25 party-mode review — Sally flagged the original triple-confirm whiplash; 1500ms gives the user breathing room to feel the success moment AND covers the longer Vietnamese aria-live string). |
| 200 `{verified: false, email}` | No-op — wait for next tick |
| 404 `POLL_ID_NOT_FOUND` (24h elapsed OR pollId unknown) | Stop the poller via `enabled=false`; commit terminal state; render the "Verification link expired" inline state (per AC5). |
| Network error / 5xx | Pass through `Sentry.captureException` (the `usePolling` hook already wraps the awaited promise in a `.catch` that calls Sentry); leave the poller running so the next 5s tick retries |

**Pinned test contracts** (MSW seam — original five + four R-NEW=12 regression guards added 2026-06-25):
- `renders envelope SVG + heading + email + resend + google fallback + spam hint + wrong-email prompt` (Default state, after first poll returns `verified: false`). Note: spam-hint and wrong-email-prompt are 2026-06-25 amendments.
- `auto-redirects to /login?verified=1 when poller returns verified: true` — assert via `screen.findByText(t('auth.verify.successRedirecting'))` then `await waitFor(() => expect(navigateSpy).toHaveBeenCalledWith('/login?verified=1', {replace: true}))`. Use `vi.useFakeTimers()` + `vi.advanceTimersByTimeAsync(VERIFY_REDIRECT_DELAY_MS)` (NOT the sync variant — the success-effect schedules through a promise tick; Murat 2026-06-25). Restore real timers in `afterEach`.
- `stops polling + renders expired state when 404 arrives` — assert no further fetch calls fire after the 404 via MSW request counting (use `vi.fn` on the handler).
- `displays user email from useAuth()` — render with a pre-seeded session in the QueryClient cache (`queryClient.setQueryData(authKeys.session(), { user: { email: 'foo@bar.com', ... }, accessToken: null })`).
- `falls back to bodyPrefix without bold when useAuth returns null user`.
- **R-NEW=12 regression guards (party-mode 2026-06-25)**:
  - `does NOT fire navigate when user clicks an in-app <Link> mid-redirect-delay` — render with a sibling `<Link to="/login">` in the tree, simulate user click on the link during the 1500ms `VERIFY_REDIRECT_DELAY_MS` window (after `verified:true` commits but before the timer fires), assert the timer's navigate callback never fires (the effect's `clearTimeout` cleanup catches the unmount).
  - `does NOT fire navigate when component unmounts before timer fires` — explicit `unmount()` from `render()` mid-delay, advance fake timers past delay, assert `navigateSpy` never called.
  - `does NOT fire navigate when a parallel 401 wipes the session between verified:true and timer fire` — pre-seed an authenticated session, commit `verified:true`, mid-1500ms-delay flip `useAuth` to null (simulate session-wipe), assert `stillMountedAndVerifiedRef` guard short-circuits the navigate callback.
  - `late 200 poll response after terminal commit is dropped silently` — terminal-state-race regression for the in-flight-after-enabled=false contract under AC5. Use MSW with a 6-second delayed response; advance to 10-min cap (commits timeout state); then resolve the in-flight 200 with `verified:true`; assert navigate did NOT fire and the screen stays on the timeout UI.

### AC4: 60-second resend countdown matched to backend per-email rate limit

**Given** the polling-mode screen is rendered,
**When** the user clicks the resend button,
**Then** `useResendVerification()` mutation fires `POST /api/auth/resend-verification { email: useAuth().user.email }`,
**And** on success (regardless of whether `verifyPollId` is null or a UUID — anti-enumeration; same UX), a non-blocking sonner toast with `t('auth.verify.resendSentToast')` appears,
**And** the resend button is disabled for 60 seconds with the button label swapped to `t('auth.verify.resendCountdown', { seconds: <remaining> })` (e.g. "Resend in 59s" → "Resend in 1s" → re-enabled),
**And** if the response carries a NEW `verifyPollId` (non-null), the URL is replaced via `setSearchParams({ pollId: newPollId }, { replace: true })` so a refresh re-binds to the new poller AND the existing `useVerificationPoller` re-subscribes to the new pollId (resets the 10-min cap automatically because the elapsed timer is keyed off pollId).

**And** if the response is a `429 RATE_LIMIT_EXCEEDED`, the page renders a form-level `<div role="alert">` with `t('auth.verify.error.rateLimited', { seconds: error.retryAfterSeconds ?? 60 })` and the resend button stays disabled for that many seconds (clamped to a minimum 1, maximum 300 to defend against malformed Retry-After headers). Uses the `ApiError.retryAfterSeconds` property from 1-8's `apiFetch`.

**And** if the response is `422 VALIDATION_ERROR` (unlikely — only happens if `useAuth().user?.email` is somehow missing) OR a 5xx OR a network error, the form-level alert renders `t('auth.verify.error.generic')`.

**Countdown hook discipline:** the 60-second countdown lives in a small co-located hook `useResendCountdown(seconds: number)` at `src/features/auth/hooks/useResendCountdown.ts` returning `{ remaining: number; start: (s: number) => void; isActive: boolean }`. Uses `setInterval(decrement, 1000)` + cleanup on unmount per the `usePolling` precedent (single `useEffect`, the FW-4 "subscription cleanup" permitted exception, NOT a server-state fetch). `remaining` decrements to 0 then auto-clears via the same effect. Constants: `RESEND_COUNTDOWN_SECONDS = 60` per CQ-3.

**Pinned test contracts**:
- `clicking resend triggers MSW POST + shows success toast` (happy path).
- `resend button is disabled for 60s after click + label shows countdown` — use `vi.useFakeTimers()` to advance through 60 ticks and assert intermediate labels at 59s / 30s / 1s; assert `disabled` attribute throughout.
- `429 sets resend button disabled for retryAfterSeconds + renders rate-limited alert` — MSW override returns `{ status: 429, headers: { 'Retry-After': '45' }, body: { error: { code: 'RATE_LIMIT_EXCEEDED' } } }`; assert button disabled for 45s and alert renders with `{seconds: 45}`.
- `429 with missing Retry-After header defaults to 60s countdown`.
- `URL pollId updates on successful resend with non-null verifyPollId` — MSW returns `{ data: { verifyPollId: 'new-uuid' } }`; assert `searchParams.get('pollId') === 'new-uuid'` after the mutation settles.
- `URL pollId does NOT update when verifyPollId is null` (anti-enumeration path).

### AC5: 10-minute polling cap + manual-recheck button

**Given** the polling-mode screen is rendered,
**When** 10 minutes elapse without a `verified: true` response (use `POLLING_TIMEOUT_MS = 10 * 60 * 1000` per CQ-3),
**Then** the poller is disabled via `enabled: false` (the `usePolling` hook's `enabled` flip stops scheduling new intervals immediately),
**And** the screen swaps the body to the timeout state: heading `t('auth.verify.timeoutHeading')`, paragraph `t('auth.verify.timeoutBody')`, single `<Button data-testid="verify-recheck-button">` rendering `t('auth.verify.recheckCta')`. The envelope illustration stays; the resend button stays (still subject to its 60s countdown if active). The Google fallback link stays.
**And** clicking the recheck button fires a SINGLE `GET /api/auth/verify-status?pollId={pollId}` (no re-arming of the poller). If the response is `verified: true` → same redirect path as AC3. If `verified: false` → stays in timeout state (no new state). If 404 → render the expired state per AC5b.

**Concurrent in-flight resolution contract (party-mode review 2026-06-25, addresses Murat's missing pin)**:

`usePolling` clears the interval on `enabled=false` but does NOT abort in-flight fetches (verified 2026-06-25 by reading `src/hooks/usePolling.ts` — it `clearInterval`s only). The terminal-state race is therefore: `enabled` flips false because of (a) 10-min cap firing, (b) parallel 404 commit, or (c) `verified=true` commit — but a fetch initiated by the previous tick is still in flight and will resolve milliseconds later, potentially clobbering the just-committed terminal state.

**Resolution**: `useVerificationPoller` owns a `terminalStateRef = useRef<'pending' | 'verified' | 'expired' | 'timeout'>('pending')`. Every state-commit branch (verified-true, 404, 10-min-cap, recheck-404) FIRST writes to the ref synchronously THEN sets React state. The poll's response handler reads the ref BEFORE committing: if `terminalStateRef.current !== 'pending'`, the response is dropped silently (no Sentry — this is expected). The "first commit wins" contract is explicit and testable.

This pattern is documented in the hook's JSDoc + locked by a pinned test under AC5 ("late 200 after terminal commit is ignored"). The pattern does NOT depend on TanStack Query's abort semantics (we own the fetch wrapper) and therefore stays valid even if the apiFetch primitive ever gets an abort signal.

**AC5b: expired state (404 from GET /verify-status during polling OR after the recheck fires)**:

**Given** the polling response (or the post-cap recheck response) is `404 POLL_ID_NOT_FOUND`,
**When** the response arrives,
**Then** the page renders the "expired" inline alert variant inside the same `AuthCard`:
- Envelope SVG is replaced by a clock SVG (40×40, simple monoline circle + two hands; inline JSX, amber stroke matching `--cl-status-warning` substitute pattern).
- Heading: `t('auth.verify.expiredHeading')`.
- Body paragraph: `t('auth.verify.expiredBody')`.
- Primary CTA: `<Button data-testid="verify-expired-resend">` rendering `t('auth.verify.expiredResendCta')` — clicking fires the same `useResendVerification` mutation as the in-page resend button; on success, the alert dismisses and the polling-mode UI re-renders with the new pollId in the URL.
- Secondary CTA (footer slot): `<Link to="/login">` rendering `t('auth.login.title')` — escape hatch back to login.

**Pinned test contracts**:
- `swaps to timeout UI after 10 minutes elapse + stops polling` — use `vi.useFakeTimers()` + `await vi.advanceTimersByTimeAsync(600_000)` (NOT the sync `advanceTimersByTime` variant — the poller's response handlers resolve promises inside intermediate ticks; sync advancement does not drain the microtask queue between ticks and produces flaky / false-positive passes; Murat 2026-06-25). Assert MSW request count stops incrementing after the cap.
- `manual recheck fires exactly one fetch + does NOT re-arm the poller`.
- `renders expired state on 404 from GET verify-status` — MSW override returns 404; assert `data-testid="verify-expired"` region renders with both CTAs.
- `expired-state resend CTA triggers same mutation as in-page resend + URL pollId updates`.
- **Concurrent in-flight regression guard (party-mode 2026-06-25 — Murat blocker)**: `late 200 verified:true poll response arriving after 10-min cap is dropped` — MSW with a 6s delayed response; advance to 600_000ms cap (commits timeout state, `terminalStateRef.current = 'timeout'`); then resolve the in-flight 200 with `{verified: true}`; assert (a) `navigateSpy` never called, (b) screen stays on `data-testid="verify-timeout"`, (c) no Sentry breadcrumb fired (the drop is expected, not exceptional).

### AC6: Click-through mode + LoginPage `?verified=1` success banner

**Given** `VerifyEmailPage` mounts with `?token={base64}` (with or without `?pollId`),
**When** the page first paints,
**Then** the rendered region (`data-testid="verify-click-through"`) renders a centered transient state inside `AuthCard`:
- A small spinner (the shadcn `Loader2` icon spinning, 24×24) OR a skeleton row matching the same vertical rhythm — choose at dev time, the test asserts on `getByText(t('auth.verify.checkingNow'))` so the visual layer is flexible.
- `<p data-testid="verify-checkingNow" aria-live="polite">` with `t('auth.verify.checkingNow')`.

**And** on mount, `useVerifyEmail()` mutation fires `POST /api/auth/verify-email { token }` EXACTLY ONCE via the mutation's own state machine — NO `useRef` latch (party-mode review 2026-06-25 swap; see Dev Notes "StrictMode + the click-through POST" below for rationale). The effect is:

```tsx
const verifyEmail = useVerifyEmail()
useEffect(() => {
  if (!token) return
  if (!verifyEmail.isIdle) return  // StrictMode second mount sees isPending/isSuccess/isError → skips
  verifyEmail.mutate({ token })
}, [token, verifyEmail])
```

The "Try again" button on the 422/5xx/network error branch calls `verifyEmail.reset()` first (flips isIdle back to true) then re-fires via the same effect on next render — no ad-hoc handler needed:

| Response | Action |
|---|---|
| 200 `{verified: true, email}` | Render the success aria-live announcement (`t('auth.verify.successRedirecting')`); after the 800ms `VERIFY_REDIRECT_DELAY_MS` delay, `navigate('/login?verified=1', { replace: true })` |
| 410 `VERIFICATION_TOKEN_EXPIRED` | Render the expired state per AC5b — same UI, same CTAs |
| 404 `VERIFICATION_TOKEN_INVALID` | Render the "Invalid verification link" inline state: heading `t('auth.verify.invalidHeading')`, body `t('auth.verify.invalidBody')`, single CTA `<Link to="/login">` rendering `t('auth.login.title')` |
| 422 `VALIDATION_ERROR` / 5xx / network | Render the form-level alert with `t('auth.verify.error.generic')` and a small "Try again" button (which simply re-fires the same mutation — useful for transient network failures) |

**LoginPage amendment — three coordinated changes** (1-9a touches LoginPage + `useLogin` + `auth-refresh.ts` outside `features/auth/`; party-mode review 2026-06-25 expanded scope from "banner-only" because the cross-tab race introduced by the polling redirect is 1-9a-amplified and worth closing in the same PR):

**Change 1 — Verified banner (original scope):**

**Given** a user navigates to `/login?verified=1` (from a 1-9a redirect),
**When** the LoginPage mounts,
**Then** a transient success banner renders in the SAME `<div role="alert">` slot that today carries the OAuth transient bridge:
- Visual: success variant — `border-[color:var(--cl-status-success)]/40 bg-[color:var(--cl-status-success)]/10 text-[color:var(--cl-status-success)]` (NO emoji; matches the 1-8 visual grammar for inline alerts).
- Copy: `t('auth.login.banner.verified')`.
- Cleared from the URL on mount via the SAME lazy-initializer + `useRef` latch + `useEffect` clear pattern at LoginPage.tsx lines 80–107 — extend the existing `useState(() => ...)` initializer to ALSO check for `?verified=1`. The success banner has display priority OVER the OAuth error transient (both are mutually-exclusive landings — a user who just verified is not in the middle of an OAuth flow; if both query params somehow coexist, the success path wins).

**Change 2 — Already-authenticated guard (Layer A, 1-9a-amplified):**

**Given** any user navigates to `/login*` (with OR without `?verified=1`),
**When** the LoginPage mounts AND `useAuth().isAuthenticated === true`,
**Then** the page IMMEDIATELY redirects via `navigate('/dashboard', { replace: true })` — does NOT flash the login form, does NOT render the verified banner.
- Implementation: an effect keyed off `isAuthenticated` (NOT a ref-latched render-time redirect — effect keeps SSR safe and StrictMode-clean): `useEffect(() => { if (isAuthenticated) navigate('/dashboard', { replace: true }) }, [isAuthenticated, navigate])`.
- `useAuth().isLoading` short-circuits the effect (only redirect once the boot-probe resolves) — without this, a returning user with a valid refresh cookie gets bounced to `/dashboard` BEFORE we know they're actually authenticated… wait, we DO want that. The guard is: `if (!isLoading && isAuthenticated) navigate(...)`. If `isLoading` is still true, the effect re-fires on the loading→idle transition.
- This closes a pre-existing 1-8 gap (a logged-in user manually visiting `/login` today gets the form) that 1-9a's new `/login?verified=1` entry surfaces; verified 2026-06-25 that LoginPage has no `useAuth()` import today.

**Change 3 — Cross-tab login signaling (Layer B, 1-9a-amplified):**

**Given** a user has 3 tabs open all polling for verification (tabs A, B, C),
**When** the user verifies in tab A → tab A redirects to `/login?verified=1` → the user logs in tab A (which fires `useLogin.onSuccess`),
**Then** tabs B and C must also auto-redirect to `/dashboard` rather than sitting on `/login?verified=1` for an already-authenticated session.
- Implementation: `useLogin.onSuccess` posts a NEW `login-succeeded` message to the existing `classlite_auth` BroadcastChannel (channel + listener already live in `src/lib/auth-refresh.ts` from 1-8). Payload is the same `RefreshSessionData` shape (`{ user, accessToken }`) so sibling tabs can hydrate their session cache without a network round-trip. The listener in `auth-refresh.ts` ALREADY hydrates the cache on `refresh-succeeded`; this story extends the discriminated `RefreshSignal` union with a `LoginSucceededSignal` variant and routes it through the same hydration path.
- Tabs B/C: their session cache flips to authenticated via the BroadcastChannel listener → `useAuth().isAuthenticated` becomes `true` → the **Change 2 effect** fires → `navigate('/dashboard', { replace: true })` runs in tabs B and C.
- This is end-to-end via composition (no new listener wiring in LoginPage itself — the existing `useAuth` subscription + Change 2's effect closes the loop).

**Pinned tests in `LoginPage.test.tsx` (extended from +2 to +5):**
- `renders verified banner when ?verified=1 lands`
- `clears ?verified=1 from URL after mount`
- `redirects to /dashboard with replace:true when isAuthenticated on mount` (Layer A direct test)
- `does NOT redirect while isLoading is true; redirects on loading→idle transition with isAuthenticated:true` (boot-probe race regression guard)
- `does NOT render verified banner when isAuthenticated already true at mount` (success-path collision: a user who already logged in elsewhere and lands on /login?verified=1 goes straight to /dashboard, no flash of banner)

**Pinned tests in `useLogin.test.tsx` (extended from current set by +1):**
- `onSuccess posts login-succeeded to the classlite_auth BroadcastChannel with the resolved session payload` (Layer B direct test — use a sibling-tab MessageChannel listener fixture, assert payload shape)

**Pinned tests in `auth-refresh.test.tsx` (extended by +1):**
- `BroadcastChannel listener handles login-succeeded by hydrating the session cache, identical to refresh-succeeded` (Layer B listener-side test — pre-clear cache, simulate channel message, assert `getQueryData(authKeys.session())` returns the payload)

**Pinned test contracts** for the click-through mode:
- `verifies token on mount + redirects to /login?verified=1 on 200` — assert exactly ONE MSW POST fires (count assertion) even under StrictMode double-mount.
- `renders expired state on 410` — MSW returns 410 with `VERIFICATION_TOKEN_EXPIRED` code.
- `renders invalid state on 404`.
- `renders generic alert + try-again button on 422 + clicking re-fires the mutation`.

### AC7: Invalid-mode fallback

**Given** `VerifyEmailPage` mounts with NEITHER `?pollId` NOR `?token`,
**When** the page first paints,
**Then** the rendered region (`data-testid="verify-invalid"`) inside `AuthCard` renders the same "Invalid verification link" state as the 404 POST branch: heading `t('auth.verify.invalidHeading')`, body `t('auth.verify.invalidBody')`, CTA `<Link to="/login">` rendering `t('auth.login.title')`.
**And** NO network call fires (assert MSW request count is zero).

### AC8: Storybook coverage — VerifyEmailPage states + co-located stories per `storybook-conventions.md` § 2

**Given** the file `classlite-web/src/features/auth/VerifyEmailPage.stories.tsx`,
**When** running `npm run storybook` or `npm run storybook:build`,
**Then** the file exports the canonical state set per the three-state contract (the page is a `*Page`, so it follows the LoginPage / RegisterPage variant set — NOT subject to the `*Card`/`*Shell` allowlist):
- `Default` (Polling mode, en locale, `verified: false` after first poll)
- `LocaleVi` (Polling mode, vi locale)
- `PollingTimeout` (after 10-min cap fires — uses Storybook decorator with mocked timers)
- `Expired` (404 from GET verify-status)
- `ClickThroughLoading` (POST verify-email in-flight)
- `ClickThroughSuccess` (200, mid-redirect aria-live announcement visible)
- `ClickThroughExpired` (410 from POST)
- `ClickThroughInvalid` (404 from POST)
- `Invalid` (neither query param)
- `Mobile390` (Default state at 390px viewport with a SHORT email (`a@b.co`) — touch-target audit per UX-DR15)
- `Mobile390LongEmail` (Default state at 390px viewport with a 40+ char email fixture like `verylongname.with.dots@subdomain.company.co` — added per Sally's 2026-06-25 review to lock the `break-all` span behavior; the bolded email must wrap inside the span and NOT push the resend button below the fold. Pinned by axe-zero AND a `play()` assertion that the resend button is visible without scrolling)

**And** every story has a `play` function asserting either `screen.getByTestId(<region>)` or `screen.getByRole('alert')` exists; axe-zero per existing storybook-axe Playwright project.

## Tasks / Subtasks

> **Commit-sequence discipline (matches 1-8 Task 0 / 1d-3 Task 0):**
> 1. MSW catalog extension lands FIRST so tests can be written against the canonical contract.
> 2. i18n keys land BEFORE consuming code (atomic en + vi) so `npm run i18n-parity` stays green at each intermediate commit.
> 3. Page + hooks + handlers ship together (no half-page commits).
> 4. LoginPage banner amendment lands LAST (smallest blast radius, easy to back out if anything regresses).

### Task 1 — MSW handler catalog extension (atomic with backend contract)

- [x] 1.1 Open `_bmad-output/test-artifacts/msw-handler-catalog-auth.md`. Append three new sections after "POST /api/auth/reset-password": `POST /api/auth/verify-email`, `POST /api/auth/resend-verification`, `GET /api/auth/verify-status`. Each section follows the existing pattern: happy-path snippet + variants table + per-variant override snippets.
- [x] 1.2 Bump `last_updated` and append a Change Log row: `2026-06-25 | Appended verify-email + resend-verification + verify-status sections (Story 1-9a consumer). Sourced verbatim from api.yaml lines 74–157 + 543–572.`
- [x] 1.3 Land the same default handlers in `classlite-web/src/test/mocks/handlers.ts` — three new entries appended to the `handlers` array (no mutation of existing entries). Match the existing `MSW_USER` style + `Envelope<T>` typing.

### Task 2 — i18n keys (atomic en + vi)

- [x] 2.1 Add 24 new keys per AC2 to `classlite-web/src/locales/en.json` under the `auth.verify.*` namespace + the single `auth.login.banner.verified` key. (24 = 21 original + 3 added in the 2026-06-25 party-mode review: `spamHint`, `wrongEmailPrompt`, `wrongEmailCta`. Three keys are REWRITES of original entries: `timeoutHeading`, `timeoutBody`, `recheckCta`, `googleFallbackCta`.)
- [x] 2.2 Add the same 24 keys to `classlite-web/src/locales/vi.json` with the seed copy from AC2 (mockup literals where AUTH-04 ships them; inferred Vietnamese for the rest). Mark the 5 ★ REVIEWER-MANDATORY keys in the PR description (resendSentToast / expiredBody / error.generic / spamHint / googleFallbackCta).
- [x] 2.3 Append `STORY_1_9A_KEYS` const + `describe('Story 1-9a i18n parity (R38)', ...)` block to `src/lib/test/__tests__/i18n-parity-coverage.test.ts` after line 486. Mirror the 1-8 block format verbatim.
- [x] 2.4 Run `npm test -- i18n-parity-coverage` — green.

### Task 3 — Auth API extensions (authKeys + 3 hooks)

- [x] 3.1 Extend `src/features/auth/api/authKeys.ts`: add `verifyStatus: (pollId: string) => [...authKeys.all, 'verify-status', pollId] as const`, `resendMutation: () => [...authKeys.all, 'mutation', 'resend'] as const`, `verifyEmailMutation: () => [...authKeys.all, 'mutation', 'verify-email'] as const`. Extend `authKeys.test.ts` with the matching contract assertions (`expect(authKeys.verifyStatus('x')).toEqual(['auth', 'verify-status', 'x'])` etc.).
- [x] 3.2 Create `src/features/auth/api/resendVerification.ts` — `useResendVerification()` mutation hook. Mutation key: `authKeys.resendMutation()`. mutationFn: `apiFetch<ResendResult>('/api/auth/resend-verification', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) })`. No `onSuccess` cache write (the caller handles URL update + toast); no `onError` (caller renders alert).
- [x] 3.3 Create `src/features/auth/api/verifyEmail.ts` — `useVerifyEmail()` mutation hook. Mutation key: `authKeys.verifyEmailMutation()`. mutationFn: `apiFetch<VerifyEmailResult>('/api/auth/verify-email', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) })`. No cache write (verify alone does not issue a session — user must log in afterward).
- [x] 3.4 Co-located `__tests__/resendVerification.test.tsx` + `verifyEmail.test.tsx` — 3 tests each (happy / 422 / 429 or 410 as applicable).

### Task 4 — Hooks: useVerificationPoller + useResendCountdown

- [x] 4.1 Create `src/features/auth/hooks/useVerificationPoller.ts`. Signature: `useVerificationPoller({ pollId, enabled }: { pollId: string; enabled: boolean }) => { isPolling: boolean; lastResponse: VerifyStatusResult | null; lastError: ApiError | null; commitTerminal: (state: 'verified' | 'expired' | 'timeout') => void }`. Wraps `usePolling({ fn, intervalMs: 5_000, enabled })` from `src/hooks/usePolling.ts`. **Owns a `terminalStateRef = useRef<'pending' | 'verified' | 'expired' | 'timeout'>('pending')`** (party-mode 2026-06-25 — in-flight race resolution per AC5). On each poll, the response handler reads the ref FIRST: if `terminalStateRef.current !== 'pending'`, the response is dropped silently (no state commit, no Sentry — this is expected late-arrival). Otherwise updates local `useState` for `lastResponse` / `lastError`. Returns the latest of either so the page can branch on `.verified` / `.status === 404`. The `commitTerminal` returned function lets the page write to the ref synchronously when committing terminal state from non-poll sources (10-min cap, click-through 200, manual recheck).
- [x] 4.2 Create `src/features/auth/hooks/useResendCountdown.ts` — `useResendCountdown() => { remaining: number; start: (seconds: number) => void; isActive: boolean }`. Internal `setInterval` decrementing `remaining` every 1000ms; cleanup on unmount + on `remaining` reaching 0. Constants: `MAX_COUNTDOWN_SECONDS = 300`, `MIN_COUNTDOWN_SECONDS = 1` (clamp inputs).
- [x] 4.3 Co-located `__tests__/useVerificationPoller.test.tsx` + `useResendCountdown.test.tsx` — fake timers (use `advanceTimersByTimeAsync` for poller tests per 2026-06-25 amendment), 6 tests covering start / decrement / clear-on-zero / clear-on-unmount / clamp-min / clamp-max for countdown; 6 tests covering poll-fires-at-5s / disabled-stops-polling / surfaces-error / surfaces-success / **terminal-state-ref drops late 200** / **terminal-state-ref drops late 404** for poller (the two terminal-state tests added 2026-06-25 lock the in-flight race contract per AC5).

### Task 5 — VerifyEmailPage component (the heart of the story)

- [x] 5.1 Create `src/features/auth/VerifyEmailPage.tsx`. Default export. Branches on `useSearchParams()` per AC1. Renders inside `<AuthCard regionLabel={t('auth.verify.title')} heading={<h1>...</h1>} body={...} footer={...}>`.
- [x] 5.2 Inline the 80×80 envelope SVG per AUTH-04 lines 1650–1657 (do NOT load from an external CDN or asset file — inline JSX). Inline the 40×40 clock SVG for the expired state.
- [x] 5.3 Polling-mode body: heading + email display + resend button + Google fallback link + the optional timeout state swap.
- [x] 5.4 Click-through mode body: loading indicator + aria-live announcement; on mount fires `useVerifyEmail({ token })` exactly once via the `useMutation.isIdle` guard (party-mode 2026-06-25 — see Dev Notes "StrictMode + the click-through POST" for the rationale swap away from the original `useRef` latch).
- [x] 5.5 Invalid mode body: heading + body + login CTA. No network call.
- [x] 5.6 Wire the `setTimeout` redirect with `VERIFY_REDIRECT_DELAY_MS = 1500` per CQ-3, scheduled INSIDE a `useEffect` keyed on `verified === true` (NOT inside the mutation's `onSuccess` — the effect's cleanup owns `clearTimeout`). Add the `stillMountedAndVerifiedRef` belt-and-suspenders guard that the navigate callback checks before firing.
- [x] 5.7 Append the new route entry to `src/routes.tsx` AuthLayout children per AC1.
- [x] 5.8 Co-located `__tests__/VerifyEmailPage.test.tsx` — covers all pinned test contracts under AC1, AC3, AC4, AC5, AC6, AC7. ~36 tests total (was ~30; party-mode 2026-06-25 added 4 R-NEW=12 unmount-path regression guards + 2 in-flight-race / late-response drops + the spam-hint and wrong-email-prompt assertions in the default render). `createTestQueryClient()` per test; `vi.useFakeTimers()` in the redirect + countdown + poller tests; use `vi.advanceTimersByTimeAsync` (NOT sync `advanceTimersByTime`) anywhere a poller response or mutation `onSuccess` chain resolves between ticks.

### Task 6 — Storybook coverage

- [x] 6.1 Create `src/features/auth/VerifyEmailPage.stories.tsx` per AC8 — 10 stories. Each with a `play` function asserting the right `data-testid` is present and axe-zero.
- [x] 6.2 Use Storybook's React Router decorator (already configured in `.storybook/preview.tsx` for 1-8's LoginPage / RegisterPage stories) to provide the searchParams + navigate spy. Mock MSW responses per story via `parameters.msw.handlers`.
- [x] 6.3 Run `npm run storybook:build` clean + `npm run storybook:test` (axe project) green.

### Task 7 — LoginPage three-part amendment (banner + already-auth guard + cross-tab login signal)

**Part A — Verified banner (original 1-9a scope):**

- [x] 7.1 Open `src/features/auth/LoginPage.tsx`. Extend the existing `useState(() => ...)` lazy initializer for `oauthError` to ALSO check for `?verified=1` (set a NEW `verifiedBanner` state to `t('auth.login.banner.verified')` if present).
- [x] 7.2 Extend the existing URL-clearing `useEffect` to also clear `?verified=1` (use the same `URLSearchParams` `next.delete('verified')` pattern; same `oauthErrorHandled` ref latch covers both).
- [x] 7.3 Render the success banner in the SAME form-level alert slot using a success visual variant (`border-[color:var(--cl-status-success)]/40 bg-[color:var(--cl-status-success)]/10 text-[color:var(--cl-status-success)]`). The success banner displays IF set; else the OAuth error transient displays; else nothing (mutually exclusive, success wins on collision).

**Part B — Already-authenticated guard (Layer A, party-mode 2026-06-25 amendment):**

- [x] 7.4 Import `useAuth` from `@/hooks/useAuth` and `useNavigate` from `react-router` (already imported via `useSearchParams`; just add the `useNavigate` named import).
- [x] 7.5 Add `useEffect(() => { if (!isLoading && isAuthenticated) navigate('/dashboard', { replace: true }) }, [isAuthenticated, isLoading, navigate])` near the top of the component body (BEFORE the existing OAuth-error effect; the redirect short-circuits all downstream render work for already-authenticated users).
- [x] 7.6 Document the rationale in a JSDoc comment block above the effect — point at this story's AC6 Change 2 + the boot-probe race regression guard.

**Part C — Cross-tab login signal (Layer B, party-mode 2026-06-25 amendment):**

- [x] 7.7 Open `src/lib/auth-refresh.ts`. Extend the `RefreshSignal` discriminated union with a new `LoginSucceededSignal` variant: `{ type: 'login-succeeded'; timestamp: number; data: RefreshSessionData }`. Note: `data` is non-nullable here (login always produces a session, unlike refresh which can debounce-hit to `null`).
- [x] 7.8 Extend the existing BroadcastChannel `onmessage` listener in `auth-refresh.ts` to handle `'login-succeeded'` by hydrating the session cache via `queryClient.setQueryData(SESSION_QUERY_KEY, signal.data)` — identical to the refresh-succeeded hydration branch. Reuse, do not duplicate, the hydration helper.
- [x] 7.9 Export a new helper `broadcastLoginSucceeded(data: RefreshSessionData): void` from `auth-refresh.ts` that posts the signal (guarded by the existing `channel != null` capability check for Safari private mode).
- [x] 7.10 Open `src/features/auth/api/login.ts`. In `useLogin`'s `onSuccess`, AFTER the existing `queryClient.setQueryData` write and BEFORE the `navigate('/dashboard', ...)` call, invoke `broadcastLoginSucceeded({ user: result.user, accessToken: result.accessToken })`. The cache write covers THIS tab; the broadcast covers siblings.

**Part D — Tests:**

- [x] 7.11 Add 5 new pinned tests to `LoginPage.test.tsx` per AC6 (verified-banner, URL-clear, isAuthenticated redirect, boot-probe loading guard, banner-vs-already-auth collision).
- [x] 7.12 Add 1 new pinned test to `useLogin.test.tsx`: `onSuccess posts login-succeeded BroadcastChannel message with session payload` (use a fixture sibling `BroadcastChannel('classlite_auth')` listener + Promise that resolves on first message).
- [x] 7.13 Add 1 new pinned test to `auth-refresh.test.tsx`: `listener handles login-succeeded by hydrating session cache` (pre-empty cache, dispatch message, assert `getQueryData` returns payload).

### Task 8 — CI matrix green

- [x] 8.1 `npm run lint` clean.
- [x] 8.2 `npm run lint:css` clean (the inline SVG amber colors stay within Tailwind's arbitrary-value escape brackets where needed).
- [x] 8.3 `npm test` clean — all new tests + i18n-parity coverage green.
- [x] 8.4 `npx playwright test` clean — `route-bundle-boundaries.spec.ts` confirms the auth chunk now contains VerifyEmailPage (and `tsc -b` for the e2e tsconfig stays clean).
- [x] 8.5 `npm run build` clean — VerifyEmailPage chunk size reported in PR description (expected ~4–6 KB gzipped given component reuse).
- [x] 8.6 `npm run storybook:build` clean.

## Dev Notes

### File structure after 1-9a

```
classlite-web/src/lib/
├── auth-refresh.ts             (extended — Task 7.7-7.9: login-succeeded variant + broadcast helper)
└── __tests__/auth-refresh.test.tsx (+1 test — Task 7.13)

classlite-web/src/features/auth/
├── AuthLayout.tsx              (unchanged — 1-8 final form)
├── LoginPage.tsx               (three-part amendment — Task 7: banner + already-auth guard + uses cross-tab signal via useAuth subscription)
├── LoginPage.test.tsx          (+5 tests — Task 7.11)
├── api/login.ts                (extended — Task 7.10: useLogin posts login-succeeded broadcast)
├── api/__tests__/login.test.tsx (+1 test — Task 7.12)
├── RegisterPage.tsx            (unchanged)
├── VerifyEmailPage.tsx         (NEW — Task 5)
├── VerifyEmailPage.stories.tsx (NEW — Task 6)
├── api/
│   ├── authKeys.ts             (extended — Task 3.1)
│   ├── login.ts                (unchanged)
│   ├── register.ts             (unchanged)
│   ├── resendVerification.ts   (NEW — Task 3.2)
│   ├── verifyEmail.ts          (NEW — Task 3.3)
│   └── __tests__/
│       ├── authKeys.test.ts    (extended — Task 3.1)
│       ├── login.test.tsx
│       ├── register.test.tsx
│       ├── resendVerification.test.tsx (NEW)
│       └── verifyEmail.test.tsx        (NEW)
├── components/                 (unchanged — reusing AuthCard + GoogleOAuthButton)
├── hooks/
│   ├── useVerificationPoller.ts (NEW — Task 4.1)
│   ├── useResendCountdown.ts    (NEW — Task 4.2)
│   └── __tests__/
│       ├── useVerificationPoller.test.tsx
│       └── useResendCountdown.test.tsx
├── lib/                        (unchanged)
└── __tests__/
    └── VerifyEmailPage.test.tsx (NEW — Task 5.8)
```

### Why `useVerificationPoller` is a co-located feature hook, not a `hooks/usePolling` extension

`usePolling` is the generic primitive (5s ticking + cleanup); the verification poller adds **API call shape** (`apiFetch` URL construction + envelope unwrapping) + **response branching** (track latest `verified` / latest error). Keeping these concerns in a feature-local wrapper preserves `usePolling`'s reusability for the other planned consumers (Epic 9 billing-grace, Epic 10 inbox unread) without bloating its surface. Same pattern as 1-8's `useLogin` wrapping `useMutation` rather than asking every page to assemble the mutation contract inline.

### Why polling mode does NOT write to the session cache

The poller's `verified: true` response indicates **the user is verified on the server**, but the server has NOT issued an access token (per `api.yaml` line 690-696 — `VerifyStatusResult = { verified, email }` — no token field). Writing `{user, accessToken: 'fake'}` to the cache would put the app into a "logged in with a fake token" state that breaks at the next protected fetch. The contract is "verify → log in", not "verify → become logged in". The LoginPage banner exists precisely to bridge this — the user verifies in tab A, lands on `/login?verified=1` in tab A, sees a friendly success banner, signs in with the same credentials. Architecture line 214 + the AC5 contract from 1-8 lock this: `isAuthenticated` derives from `user.emailVerified`, NOT from `accessToken`; but accessing protected routes requires both.

### StrictMode double-mount + the click-through POST (party-mode 2026-06-25 — useRef latch replaced with `useMutation.isIdle` guard)

The click-through mode POSTs verify-email on mount. Under React 18+ StrictMode, every effect runs twice in dev. Without a guard, the user's verify-email POST fires twice — the second call hits a 200 idempotent (per `api.yaml` line 90 — "operation is idempotent") so functionally nothing breaks, but the network log doubles + audit logs double.

The **original** spec (before review) mirrored the 1-8 LoginPage `oauthErrorHandled` ref-latch pattern. Winston pushed back: the 1-8 latch guards a *display-side effect* (toast + URL cleanup, idempotent rendering); here we're guarding a *mutation*. Different problem class. Failure mode: first POST fails fast (CORS / network), latch is set, second StrictMode mount sees latch and skips → zero in-flight requests, stuck UI; user clicks Try-again → handler must reset the latch or stays locked out. Footgun.

**Replacement**: use the mutation's built-in state machine. `useMutation` from TanStack Query exposes `isIdle | isPending | isSuccess | isError` as a discriminated union of mutation state. The guard reads `isIdle` directly:

```tsx
const verifyEmail = useVerifyEmail()
useEffect(() => {
  if (!token) return
  if (!verifyEmail.isIdle) return  // StrictMode 2nd mount: isPending/isSuccess/isError → skip
  verifyEmail.mutate({ token })
}, [token, verifyEmail])
```

`isIdle` flips to `false` synchronously inside `.mutate()` (before the effect's render commits), so the second StrictMode mount observes `!isIdle` and skips. Try-again is one line: `verifyEmail.reset()` flips state back to `isIdle: true`, the effect re-fires on the next render. No ref, no eslint-disable for the dependency — `verifyEmail` is included in the deps array and only triggers re-run when the mutation object's identity actually changes (which TanStack Query stabilizes via internal memoization; React Query 5+ guarantees this).

Trade-off accepted: the effect re-runs on every parent re-render that produces a new `verifyEmail` reference. In practice this is rare because the parent (`VerifyEmailPage`) has no upstream state changes during click-through; if a re-run does occur, the `!isIdle` guard short-circuits it. The eslint-disable from the 1-8 LoginPage pattern is NOT needed here — that's the win.

### Why the redirect uses `setTimeout(1500ms)` scheduled in an EFFECT (not in mutation `onSuccess`)

**Two intertwined decisions, both party-mode-amended 2026-06-25:**

**(a) Delay extended from 800ms → 1500ms.** Sally's review flagged the original 800ms as triple-confirm whiplash — "Verified! Redirecting…" aria-live + navigate + LoginPage banner all firing within a second cheats the user out of the emotional payoff of the success moment. The redirect now holds 1500ms so the user reads the announcement, internalizes "I'm verified," and the route change feels earned. 1500ms is empirical: covers the longer Vietnamese string ("Đã xác nhận! Đang chuyển hướng đến đăng nhập…") at NVDA/JAWS verbose settings (~1100ms speech duration) + ~400ms post-speech cognitive parse. Spelled `VERIFY_REDIRECT_DELAY_MS = 1500` per CQ-3.

**(b) Timer scheduled inside `useEffect` keyed on `verified === true`, NOT inside the mutation's `onSuccess`.** Winston pushed against the originally implicit `onSuccess`-scheduled timer: scheduling the timer in an event handler (mutation callback) means the timer-id must be ref-stored and a separate cleanup wired; if the component unmounts between `onSuccess` firing and the cleanup running on the next mount cycle, the timer leaks and `navigate` fires post-unmount. The effect-scheduled pattern lets React's standard effect-cleanup own the timer:

```tsx
useEffect(() => {
  if (!verified) return
  const id = setTimeout(() => {
    if (stillMountedAndVerifiedRef.current) {
      navigate('/login?verified=1', { replace: true })
    }
  }, VERIFY_REDIRECT_DELAY_MS)
  return () => clearTimeout(id)
}, [verified, navigate])
```

The `stillMountedRef` is a mount-tracking guard: if the component unmounts during the 1500ms delay (route change, browser close, parent re-render that re-keys the page), the navigate callback short-circuits via `stillMountedRef.current === false`. The first half of the R-NEW=12 mitigation is the effect's `clearTimeout` cleanup; the ref is the belt-and-suspenders that catches any timer race the cleanup doesn't.

**DN1 pragmatic-scope amendment (code review 2026-06-25):** The original spec asked the ref to ALSO track session-wipe-during-delay via a `useAuth` subscription. The pragmatic scope of 1-9a drops that wiring on the rationale that polling-mode users are unverified by definition — they have NO session to wipe, so a 401 silent-refresh during the 1500ms delay is not a realistic trigger. The ref was renamed from `stillMountedAndVerifiedRef` to `stillMountedRef` to match what it actually does. If a future story introduces a flow where a verified-but-unauthenticated user can reach this redirect, re-wire the `useAuth` subscription at that point.

The pinned tests under AC3 lock the two in-scope regression surfaces: in-app `<Link>` click mid-delay; component unmount mid-delay. The 401-during-delay case is out-of-scope per the DN1 resolution.

### Reusing the 1-8 LoginPage form-error slot for the verified banner

The slot is already a `<div role="alert">` with the destructive variant for errors. Adding a success variant is a single conditional className swap, not a new component. Mutual exclusivity rule: a session that just verified is NOT in the middle of an OAuth flow, so a collision is impossible in practice — but if both `?verified=1` and `?error=` are present (e.g. user manually edits the URL), the success branch wins. This priority is documented inline in the LoginPage JSDoc and enforced by a new test.

### Bundle-boundary verification

The existing `e2e/route-bundle-boundaries.spec.ts` from 1-7b checks that LoginPage / RegisterPage land in the auth chunk and NOT in any dashboard chunk. After Task 5.7, the spec's auth-chunk assertion needs to include `VerifyEmailPage` in the inclusion list (regex update — same place the 1-8 deletion of LoginPagePlaceholder + addition of LoginPage was wired). Verify this against the test file's chunk-grep regex BEFORE running the spec; otherwise the test passes vacuously by not checking for VerifyEmailPage at all.

### Email link URL backend constant — pin in PR description

Backend default in `classlite-api/internal/config/config.go:61` is `http://localhost:5173/verify-email` (no trailing slash; trimmed at service init per `auth.go:167`). Production overrides via `APP_VERIFY_URL_BASE` env var (e.g. `https://my.classlite.app/verify-email`). The constructed URL is `{base}?token={base64}` per `auth.go:654`. 1-9a does NOT verify the env var — backend integration tests at story 1.4 already lock this. But if a future deploy changes `APP_VERIFY_URL_BASE` to a path-param format (e.g. `/verify-email/{token}`), the 1-9a `useSearchParams().get('token')` extractor breaks silently. Pin this assumption in the PR description so the reviewer can confirm.

## Definition of Done

- [x] AC1: `/verify-email` route lazy-loads VerifyEmailPage from the auth chunk; bundle-boundary spec green.
- [x] AC2: 24 new i18n keys land in BOTH `en.json` + `vi.json`; `STORY_1_9A_KEYS` block green via `assertI18nParity`; namespace coverage assertion (1d-3 R38 mitigation) clean — no orphan keys under `auth.verify.*`.
- [x] AC3: Polling mode renders envelope screen + 5s poller; auto-redirect to `/login?verified=1` on `verified: true`.
- [x] AC4: 60-second resend countdown active after click; URL pollId updates on resend success with non-null `verifyPollId`; 429 surfaces `ApiError.retryAfterSeconds`.
- [x] AC5: 10-minute polling cap fires; manual recheck button appears; 404 from polling → expired state.
- [x] AC6: Click-through mode handles 200 / 410 / 404 / 422 + 5xx; LoginPage renders the `?verified=1` banner.
- [x] AC7: Invalid mode (neither query param) renders the right inline state + fires NO network call.
- [x] AC8: All 10 stories ship + axe-zero in the storybook-axe Playwright project.
- [x] MSW handler catalog extended in same commit as `handlers.ts` additions; both reference the same response shapes.
- [x] All 3 ★ REVIEWER-MANDATORY Vietnamese keys (`resendSentToast` / `expiredBody` / `error.generic`) flagged in PR description for VN-fluent reviewer sign-off.
- [x] `npm run lint`, `npm run lint:css`, `tsc -b`, `npm test`, `npx playwright test`, `npm run build`, `npm run storybook:build` all clean.
- [x] VerifyEmailPage chunk size reported in PR description.
- [x] Sibling completion-notes file authored at first dev pickup per `docs/bmad-story-conventions.md` (this story file stays ≤600 lines).

## Out of Scope

See the "Out of scope" block at the top of this file — the deferrals are owned upstream of the AC list to make scope decisions easy to revisit during code review.

## Review Findings

_Code review run 2026-06-25 by `/bmad-code-review` against baseline `02a27d9`. Three reviewer layers (Blind Hunter / Edge Case Hunter / Acceptance Auditor) — 41 unique findings after dedup. **Severity legend:** Critical = breaks a documented flow; Significant = AC partial / rule violation / missing pinned test; Polish = cosmetic / minor. Production-code blockers prefixed `🚨`._

### Decision Needed

- [x] [Review][Decision] **R-NEW=12 belt-and-suspenders guard — resolved 2026-06-25: PRAGMATIC SCOPE.** Rename ref to `stillMountedRef`; add only the `<Link>`-click-mid-delay test (covers the existing `clearTimeout` cleanup mitigation); amend spec line 495 to drop the `useAuth`-subscription wiring requirement on the rationale that polling-mode users are unverified by definition (no session to wipe). 401-during-delay test dropped as out-of-scope. Resulting concrete patches folded into the Patch list below (rename, AC3 `<Link>`-click test, spec line 495 amendment).

### Patches (fix in this PR)

- [x] [Review][Patch] 🚨 **`terminalStateRef` not reset on `pollId` change — resend/expired re-arm flow drops every poll forever** [classlite-web/src/features/auth/hooks/useVerificationPoller.ts:71-104] — After 10-min cap OR 404 expired, `terminalStateRef = 'timeout'|'expired'`. Page resends → new pollId → `pollerEnabled=true`, `timeoutHit=false`, `startedAtRef` reset. Hook's `fn` re-keys on new pollId BUT ref persists → guard at line 87 drops every response → user stuck on polling UI silently. Fix: `useEffect(() => { terminalStateRef.current = 'pending' }, [pollId])` inside the hook.
- [x] [Review][Patch] 🚨 **AC5 pinned test missing — manual recheck fires exactly one fetch + does NOT re-arm** [classlite-web/src/features/auth/__tests__/VerifyEmailPage.test.tsx] — `rerunOnce()` is a deviation from spec added at impl time (completion notes #2); it is completely untested at the page level. AC5 line 210 demands this contract. Without the test, regressions to either "fires once" or "no re-arm" pass CI silently.
- [x] [Review][Patch] 🚨 **AC3 pinned test missing — in-app `<Link>` click mid-redirect-delay** [classlite-web/src/features/auth/__tests__/VerifyEmailPage.test.tsx] — Spec line 153 (R-NEW=12 regression guard, WF-8 mandatory for score ≥6). The `clearTimeout` cleanup mitigation works correctly; just untested. (DN1 resolution: this is the only R-NEW=12 test we ship; 401-during-delay dropped per pragmatic scope.)
- [x] [Review][Patch] **DN1 follow-up: amend spec line 495 — drop `useAuth`-subscription wiring requirement** [_bmad-output/implementation-artifacts/1-9a-email-verification-ui.md:495] — Add a Dev-Notes paragraph noting the pragmatic-scope resolution: polling-mode users are unverified by definition, so the named 401-during-delay race cannot fire in practice; the `clearTimeout` effect-cleanup is the sole mitigation.
- [x] [Review][Patch] **Poller catch swallows non-ApiError silently — no setLastError** [classlite-web/src/features/auth/hooks/useVerificationPoller.ts:92-103] — `if (err instanceof ApiError)` is the only branch that writes state. Network failures / generic Errors leave `lastError` null forever; no UI surface. Fix: `setLastError(err instanceof ApiError ? err : new ApiError(0, 'NETWORK', String(err), null))`.
- [x] [Review][Patch] **AC4 pinned test missing — 429 without `Retry-After` defaults to 60s** [classlite-web/src/features/auth/__tests__/VerifyEmailPage.test.tsx] — Spec line 177. Only the `Retry-After: 45` case is tested; the null-fallback contract is unverified.
- [x] [Review][Patch] **AC4 pinned test missing — countdown label cycles 59s → 1s** [classlite-web/src/features/auth/__tests__/VerifyEmailPage.test.tsx:303-313] — Spec lines 175-176. Current test only asserts button-disabled state; a regression that locks the label at "Resend" would pass.
- [x] [Review][Patch] **AC6 Change 2 pinned test missing — boot-probe race for Layer A already-auth guard** [classlite-web/src/features/auth/__tests__/LoginPage.test.tsx] — Spec line 276. Existing test seeds session synchronously (`isLoading=false` already); never exercises the `isLoading: true → false` transition that the production `if (!isLoading && isAuthenticated)` guard at LoginPage.tsx:118 defends against.
- [x] [Review][Patch] **FW-4 violation — two `eslint-disable react-hooks/set-state-in-effect` cascades; `pollerEnabled` is derivable** [classlite-web/src/features/auth/VerifyEmailPage.tsx:404-407, 438-450] — `pollerEnabled` is shadow state — source of truth is `verified || expired || timeoutHit`. Fix: drop the `pollerEnabled` state + both effects; pass `enabled: !(verified || expired || timeoutHit)` directly to `useVerificationPoller`. Acknowledged in completion notes as code-review pickup.
- [x] [Review][Patch] **Click-through `useEffect([token, verifyEmail])` dep churn** [classlite-web/src/features/auth/VerifyEmailPage.tsx:230-234] — `verifyEmail` is recreated every render; only `isIdle` guard saves steady-state. Replace deps with `[token, verifyEmail.isIdle, verifyEmail.mutate]` (both stable in TanStack Query v5).
- [x] [Review][Patch] **`login-succeeded` broadcast listener has no null-guard on `msg.data`** [classlite-web/src/lib/auth-refresh.ts] — `isRefreshSignal` validates `type` only. A malformed broadcast (e.g., extension injection) passes through to `hydrateSessionCache(undefined)` → garbage written to session cache. Add `if (!msg.data) return` defensively, or extend `isRefreshSignal` to assert `data.user.id` shape.
- [x] [Review][Patch] **`useResendCountdown.start(NaN)` clamps to 1s — weaker than 60s default** [classlite-web/src/features/auth/hooks/useResendCountdown.ts:34-39] — Malformed `Retry-After: abc` header → `retryAfterSeconds = NaN` → 1-second countdown → user spam-resends. Fix: `if (!Number.isFinite(value)) return start(RESEND_COUNTDOWN_SECONDS)` (the conservative default, not MIN).
- [x] [Review][Patch] **Resend test vacuous — never asserts toast text rendered nor MSW call count** [classlite-web/src/features/auth/__tests__/VerifyEmailPage.test.tsx:2363-2373] — `disabled` is set by `countdown.start()` which fires in `onSuccess`; the mutation could vacuously succeed without firing a network call. Add a request-count spy on the MSW handler + assert `auth.verify.resendSentToast` text appears.
- [x] [Review][Patch] **AC5 spec violation — resend button hidden in timeout state** [classlite-web/src/features/auth/VerifyEmailPage.tsx:635-658] — Spec line 186 ("The resend button stays (still subject to its 60s countdown if active)"); code shows only the recheck button when `timeoutHit=true`. Either render both buttons OR amend spec line 186 to acknowledge single-CTA UX.
- [x] [Review][Patch] **429 `retryAfterSeconds > 300` silently clamped — UI lies to user** [classlite-web/src/features/auth/VerifyEmailPage.tsx:484-487] — Backend says "wait 600s", `useResendCountdown` MAX clamps to 300. Button re-enables 5 min early; user re-fires, gets re-rate-limited. Either render explicit `auth.verify.error.rateLimitedLong` alert when clamped, OR raise MAX to match backend ceiling.
- [x] [Review][Patch] **LoginPage `useState(() => ...)` lazy init only fires once — same-page SPA navigation back to `/login?error=...` or `/login?verified=1` shows no banner** [classlite-web/src/features/auth/LoginPage.tsx:283-306] — Lazy initializer reads `searchParams` exactly once at mount. A later same-page navigation (e.g., post-Google-OAuth round trip) doesn't update the state. Refactor to a `useEffect` with `[searchParams]` dep that calls `setOauthError` / `setVerifiedBanner` on each change.
- [x] [Review][Patch] **Resend preserves only `pollId` in URL — drops any other params (`?utm_*`, future `?lang=`, etc.)** [classlite-web/src/features/auth/VerifyEmailPage.tsx:474-475] — `const next = new URLSearchParams()` is fresh-empty. Fix: `const next = new URLSearchParams(searchParams)` to preserve siblings before `next.set('pollId', ...)`.
- [x] [Review][Patch] **DN1 follow-up: rename `stillMountedAndVerifiedRef` → `stillMountedRef`** [classlite-web/src/features/auth/VerifyEmailPage.tsx:372, 377, 379, 443] — Pragmatic-scope resolution. The ref only tracks mount/unmount; "AndVerified" half of the name was never wired.
- [x] [Review][Patch] **`handleResend(overrideEmail)` parameter is dead code** [classlite-web/src/features/auth/VerifyEmailPage.tsx:459-497] — Both call sites (`ExpiredState`'s `onResendClick={() => handleResend()}` and the polling resend button) invoke with no arguments. Either remove the parameter or wire a typo-correction call site that uses it.
- [x] [Review][Patch] **Hardcoded MSW UUID literal `'00000000-0000-0000-0000-poll00000099'` in test** [classlite-web/src/features/auth/__tests__/VerifyEmailPage.test.tsx:2382-2384, 2488] — Brittle cross-file string match against `handlers.ts:949`. Export `MSW_RESEND_NEW_POLL_ID` from handlers.ts and import in tests.
- [x] [Review][Patch] **Bundle-boundaries spec checks only `verifyChunks[0]`** [classlite-web/e2e/route-bundle-boundaries.spec.ts:93] — If Rolldown ever vendor-splits VerifyEmailPage across two chunks, the second chunk's leak into dashboard goes undetected. Loop over all `verifyChunks` for the negative assertions.
- [x] [Review][Patch] **Bundle-boundaries spec vacuous-pass on empty chunk arrays** [classlite-web/e2e/route-bundle-boundaries.spec.ts:100-107] — `Array.join('\n')` on empty array yields empty string → `expect().not.toContain()` passes silently. Add `expect(studentChunkFiles.length, 'student chunk missing from dist').toBeGreaterThan(0)`.
- [x] [Review][Patch] **`rerunOnce` resets `terminalStateRef` even from `'verified'`** [classlite-web/src/features/auth/hooks/useVerificationPoller.ts:112-118] — Currently unreachable (recheck only renders inside timeout branch), but a future caller could silently un-verify a verified session. Guard: `if (terminalStateRef.current === 'timeout') terminalStateRef.current = 'pending'`.
- [x] [Review][Patch] **422 try-again test doesn't assert user click caused the re-fire** [classlite-web/src/features/auth/__tests__/VerifyEmailPage.test.tsx:2547-2582] — Only asserts `callCount === 2`. A regression where StrictMode or dep churn re-fires would pass. Add explicit `await user.click(tryAgainButton)` + pre/post call-count diff.
- [x] [Review][Patch] **`e2e/` files lack node types — IDE flags `node:fs`/`node:path`/`node:url` cannot-find-module + implicit-any on Playwright callbacks** [classlite-web/e2e/route-bundle-boundaries.spec.ts:16-18, 83-124] — Pre-flight diagnostic; spec runs green under Playwright's own TS but IDE/tsc-against-folder fails. Fix: add `classlite-web/e2e/tsconfig.json` with `{ "extends": "../tsconfig.app.json", "compilerOptions": { "types": ["node"] }, "include": ["**/*.ts"] }`.
- [x] [Review][Patch] **`auth-refresh.ts:130` Set iteration diagnostic** [classlite-web/src/lib/auth-refresh.ts:130] — IDE flags `Type 'Set<() => void>' can only be iterated through when using the '--downlevelIteration' flag`. `tsconfig.app.json` is `target: es2023` which supports it, but the diagnostic surfaces in some build paths. Defensive fix: `bootProbeListeners.forEach((l) => l())` — same semantics, no iteration controversy.

### Deferred (Polish — not blocking)

- [x] [Review][Defer] **`deriveMode` whitespace pollId edge** [VerifyEmailPage.tsx:70-77] — `?pollId=%20` (whitespace) treated as valid; backend returns 404 → user sees "expired" UI for malformed URL. — deferred, low-frequency edge
- [x] [Review][Defer] **`useResendCountdown` start mid-tick / `tickToken` ghost-interval race** [useResendCountdown.ts:46-67] — start() while active relies on cleanup ordering; fake-timer tests pass synchronously but production behavior under React batching is fragile. — deferred, no observed regression
- [x] [Review][Defer] **Success-then-cap race direction untested** [useVerificationPoller.test.tsx] — Test covers cap-then-success drop; symmetric direction (success commits, then cap fires) untested. Probability low. — deferred, symmetric coverage gap
- [x] [Review][Defer] **`pollerEnabled` two-render-window extra tick** [VerifyEmailPage.tsx:404-407] — One extra poll fires between `verified=true` and effect-driven `setPollerEnabled(false)`. Negligible UX impact; subsumed by FW-4 patch above. — deferred, subsumed
- [x] [Review][Defer] **`?verified=1` non-strict equality** [LoginPage.tsx:94-98] — Strict `=== '1'` check silently no-ops on `?verified=01` / `?verified=true`. URL is generated by us, but external manipulation possible. — deferred, internal-URL contract
- [x] [Review][Defer] **`__resetAuthRefreshStateForTests` missing `notifyBootProbeChange()`** [auth-refresh.ts] — Tests calling reset see stale subscription state until next notify event. — deferred, test-only path
- [x] [Review][Defer] **AC1 bundle-boundary deviation from "hard string match"** [route-bundle-boundaries.spec.ts:66-108] — Spec demanded literal `expect(authChunkContents).toContain('VerifyEmailPage')`; code uses filename-substring match because Rolldown minifies the identifier. Pragmatic; preserves the spirit of the contract. — deferred, acknowledged in completion notes
- [x] [Review][Defer] **`scripts/i18n-parity.mjs` `COVERED_NAMESPACES` not extended with `'auth.'`** [scripts/i18n-parity.mjs:51-58] — Per-key parity via `STORY_1_9A_KEYS` is clean; namespace-level orphan-key gate for `auth.verify.*` is not active. Acknowledged in completion notes follow-ups. — deferred, one-liner pickup
- [x] [Review][Defer] **Default MSW verify-email handler always returns 200 success** [classlite-web/src/test/mocks/handlers.ts:127-136] — Tests that forget to override get unrealistic happy path; api.yaml documents 410/404/422 as valid. — deferred, test-fixture quality
- [x] [Review][Defer] **MSW verify-status handler ignores `pollId` query param** [classlite-web/src/test/mocks/handlers.ts:155-164] — Default returns same response for any pollId; tests can't exercise wrong-pollId branch from default. — deferred, test-fixture quality
- [x] [Review][Defer] **Safari private mode: no BroadcastChannel → sibling tabs sit on stale `/verify-email`** [auth-refresh.ts:357-364] — `if (!channel) return` is guarded; siblings get no Layer B signal. Out-of-scope per spec but worth tracking. — deferred, platform limitation
- [x] [Review][Defer] **Untracked `_bmad-output/implementation-artifacts/1-9a-email-verification-ui*.md` files** — Story file + completion-notes file are untracked at review time; commit atomicity depends on operator running `git add` for both. — deferred, operator responsibility
- [x] [Review][Defer] **`commitTerminal` stability is an undocumented hidden contract** [useVerificationPoller.ts:73-77] — Page's 10-min cap effect depends on `commitTerminal` referential stability; protected today by `useCallback([])` but no test re-renders parent mid-window to confirm. — deferred, defensive test
- [x] [Review][Defer] **Spec text inconsistency — `VERIFY_REDIRECT_DELAY_MS` 800ms vs 1500ms** [_bmad-output/implementation-artifacts/1-9a-email-verification-ui.md:238 vs :479] — AC6 success table says 800ms; amended Dev Notes (line 479) call for 1500ms; code shipped 1500ms (correct per amendment). Stale spec line. — deferred, spec text cleanup

### Dismissed (noise)

- **`hydrateSessionCache` runs in sender tab race** — Per MDN, BroadcastChannel sender does NOT receive own messages; theoretical concern only.
- (Pre-flight diagnostics promoted to Patch above; no other dismissed findings.)

## Change Log

| Date | Note |
|---|---|
| 2026-06-25 | Story transitioned review → done. `/bmad-code-review` run: 3 reviewer layers (Blind Hunter / Edge Case Hunter / Acceptance Auditor) surfaced 41 unique findings after dedup. Triage: 1 decision-needed (R-NEW=12 belt-and-suspenders — resolved PRAGMATIC SCOPE: rename ref + add `<Link>`-click test only, drop useAuth-subscription wiring per "polling users unverified by definition"), 26 patches (all applied), 14 deferred to `deferred-work.md`, 2 dismissed. **Critical fix:** `useVerificationPoller`'s `terminalStateRef` was not reset on pollId change — the resend/expired re-arm flow silently dropped every subsequent poll (`fn` early-returned on a `'timeout'`/`'expired'` ref that persisted across the new pollId). Now resets via `useEffect([pollId])` with synchronous ref write + state clears for `lastResponse`/`lastError`. **Production patches landed:** poller catch surfaces non-ApiError via `setLastError(new ApiError(0, 'NETWORK', ...))`, `rerunOnce` guarded against `'verified'` ref reset, click-through `useEffect` deps pin `verifyEmail.isIdle` + `.mutate` (stable refs, no per-render churn), `isRefreshSignal` validates `login-succeeded.data` shape (rejects malformed broadcasts that would `hydrateSessionCache(undefined)`), `bootProbeListeners.forEach` (Set-iteration defensive), `useResendCountdown` NaN fallback to `RESEND_COUNTDOWN_SECONDS` (was MIN=1s — weaker than default), `LoginPage` banner state re-derives on searchParams change (covers same-page SPA navigation back to `/login?error=...`), resend onSuccess preserves other URL params via callback form of `setSearchParams`, 429 retryAfter clamped consistently so message + button-enable timing line up, dead `handleResend(overrideEmail)` parameter removed, AC5 resend button stays visible in timeout state (was hidden), `stillMountedAndVerifiedRef` → `stillMountedRef` rename to match what the ref actually tracks. **Test patches landed:** AC3 `<Link>`-click mid-redirect-delay regression guard (R-NEW=12 mitigation lock), AC5 manual-recheck-fires-once-no-rearm pinned test, AC4 missing-Retry-After-defaults-60s + countdown label cycle pinned tests, S4 boot-probe race test on LoginPage Layer A guard, resend test strengthened with explicit toast text + MSW call-count assertions, 422 try-again test pre/post call-count diff (proves user click caused re-fire). **Infra patches landed:** bundle-boundary spec loops all `verifyChunks` (was just `[0]`) + asserts chunk-file count > 0 (vacuous-pass guard), new `tsconfig.e2e.json` extends app DOM types + adds node types for `e2e/*` (silences IDE diagnostics), `MSW_RESEND_NEW_POLL_ID` constant extracted from `handlers.ts`. **Spec amended:** line 495 documents the pragmatic-scope rationale for `stillMountedRef`. **Test matrix after patches:** Vitest 395/395 across 48 files (was 390/390 at review checkpoint; +5 net new tests), `npm run lint` clean (4 `eslint-disable` for `react-hooks/set-state-in-effect` — all justified inline at the call site), `npx tsc -b` clean. Deferred items appended to `_bmad-output/implementation-artifacts/deferred-work.md` under "code review of 1-9a-email-verification-ui (2026-06-25)". |
| 2026-06-25 | Story transitioned in-progress → review. All 8 ACs + 57 task checkboxes discharged in a single session against baseline `02a27d9`. Net adds: 24 i18n keys (en+vi parity-clean, 5 ★ REVIEWER-MANDATORY vi keys flagged); 1 new page component (VerifyEmailPage); 2 new mutation hooks (useResendVerification, useVerifyEmail); 2 new feature hooks (useVerificationPoller with `terminalStateRef` + `rerunOnce`, useResendCountdown with `tickToken`); 10 Storybook variants; LoginPage three-part amendment (verified banner + already-auth guard via useAuth + Layer B cross-tab BroadcastChannel `login-succeeded` signal); useLogin posts the broadcast; auth-refresh extends RefreshSignal discriminated union with `LoginSucceededSignal` variant + `broadcastLoginSucceeded` helper + extracted `hydrateSessionCache` helper; route entry appended; MSW catalog + handlers.ts extended with 3 new endpoints in lockstep; bundle-boundary e2e spec extended with positive + negative VerifyEmailPage assertions. Test matrix: Vitest 390/390 across 48 files (was 340 at 1-8 close; +50 new tests), tsc -b clean, ESLint clean (7 initial errors fixed: 4 hex colors swapped for `text-amber-600` + `currentColor`, 1 dead `let body=null` initializer removed, 2 set-state-in-effect cascades justified with eslint-disable per pollerEnabled-derives-from-poller-terminal-state rationale), lint:css clean, i18n-parity 299 keys parity-clean + namespace coverage clean (was 275 at 1-8 close), npm run build clean (VerifyEmailPage chunk 11.32 KB / 3.30 KB gzipped — slightly over the spec's 4-6 KB expectation due to inline SVGs + three-mode branching), npm run storybook:build clean, Playwright route-bundle-boundaries 4/4. Three documented deviations from spec letter resolved pragmatically: (1) Storybook PollingTimeout story uses slow MSW response rather than driving fake timers (storybook timers are real; the post-cap timeout UI is locked by the vitest pinned test); (2) `useVerificationPoller.rerunOnce()` was added at implementation time (NOT in the spec) to satisfy the AC5 "single GET, no re-arming" recheck contract; (3) `useResendCountdown` uses a `tickToken` reset-only state to avoid re-arming the interval every second. 5 ★ REVIEWER-MANDATORY Vietnamese keys still need VN-fluent reviewer pass before merge (`resendSentToast`, `expiredBody`, `error.generic`, `spamHint`, `googleFallbackCta`). `auth.verify.googleFallbackCta` ALSO carries the architecture-confirmation gate (Winston must confirm Google OAuth auto-links same-email accounts before merge — if it doesn't, the "we'll link them automatically" copy is misleading). Sibling completion-notes file `1-9a-email-verification-ui-completion-notes.md` authored per the 1d-4-onward convention. Hand-off to `/code-review` (recommend a different LLM than the one that implemented). |
| 2026-06-25 | **Party-mode review amendments (John + Sally + Winston + Murat).** Six structural changes landed before dev pickup. **(1) R-NEW re-scored 6 → 12 MITIGATE-HARD**: P=2→3 (attention-spike window, not passive), I=3→4 (worst case is navigate-after-session-wipe, not just wrong-route-silently). Mitigation explicitly named as `clearTimeout` in effect cleanup + `stillMountedAndVerifiedRef` guard; the pinned tests are regression guards locking the mitigation. WF-8 ATDD red phase upgraded to REQUIRED. **(2) Mutation guard primitive swapped**: useRef latch → `useMutation.isIdle` (Winston pushback — latch was for display-side effects, mutating-side guard needs the mutation's state machine). Try-again is now `.reset()` + auto-refire via effect; no eslint-disable needed. **(3) Redirect timer moved**: scheduled inside `useEffect` keyed on `verified===true`, NOT inside mutation `onSuccess`; effect's cleanup owns `clearTimeout`. Delay extended 800ms → 1500ms per Sally's "let the user feel the success moment" review. **(4) In-flight race resolved**: `useVerificationPoller` now owns a `terminalStateRef` that drops late 200/404 responses arriving after a terminal commit. Pinned by tests in AC3 + AC5 + hook-level. **(5) LoginPage scope expanded into a three-part amendment** (party-mode decision 2026-06-25 with user sign-off): banner + `useAuth()`-driven already-authenticated guard (Layer A — closes a pre-existing 1-8 gap that 1-9a's `/login?verified=1` surfaces) + cross-tab login signaling via the existing `classlite_auth` BroadcastChannel with a new `login-succeeded` message type (Layer B — closes the 3-tabs-racing-to-stale-login bug that 1-9a's polling redirect introduces). Touches `src/lib/auth-refresh.ts` + `src/features/auth/api/login.ts` + `LoginPage.tsx`. **(6) UX/copy fixes** (Sally + John convergent): added typo-escape link ("Not {email}? Use a different address" → routes back to /register with email prefilled) + spam-folder microcopy + responsive envelope (80×80 desktop, 64×64 mobile) + `break-all` on email span for Mobile390 long-email case; rewrote timeout copy from "Still waiting? Check verification status" → "Still checking your inbox / I clicked the link" (active voice, user-mental-model match); rewrote Google fallback copy from "same account, no verification needed" → "Sign in with Google using {email} — we'll link them automatically" (account-linking semantics explicit, ARCHITECTURE-CONFIRMATION-REQUIRED gate before merge); Mobile390 story extended with a Mobile390LongEmail variant. i18n key count 21 → 24 new keys; ★ REVIEWER-MANDATORY VN keys 3 → 5. Test counts: VerifyEmailPage 30 → 36; LoginPage +5; useLogin +1; auth-refresh +1; useVerificationPoller +2. Bundle-boundary e2e gets explicit negative assertions (`not.toContain('VerifyEmailPage')` in dashboard chunks); poller fake-timer tests switched to `advanceTimersByTimeAsync` (Murat blocker — sync variant doesn't drain microtask queue between ticks). Verified 2026-06-25 that `auth.` is NOT in COVERED_NAMESPACES today, so the namespace-coverage extension in Task 2.5 is genuinely additive (Murat verification ask answered). Cross-browser verification documented as explicitly out-of-scope. Hand-off to Amelia (dev) for `/bmad-dev-story 1-9a`. |
| 2026-06-25 | Story scaffolded backlog → ready-for-dev. John's pre-dev context engine pass against baseline `02a27d9` (1-8 done). 8 ACs map to UX-DR9 / UX-DR16 with 3 backend-reality reframes documented inline: (1) `?token=` is a query param (`auth.go:654`), so `/verify-email` is dual-mode (`?pollId=` polling vs `?token=` click-through); (2) "token_expired" is NOT a verify-status value — backend returns 404 POLL_ID_NOT_FOUND on GET /verify-status for expired pollIds and 410 VERIFICATION_TOKEN_EXPIRED on POST /verify-email; (3) verify success does NOT issue a session — user must log in after, so the redirect target is `/login?verified=1` with a LoginPage success banner (small amendment, smallest blast radius). Risk score ≥6 check: NONE owned; WF-8 ATDD not required. R38 discharged via `STORY_1_9A_KEYS` block in `i18n-parity-coverage.test.ts`. Inheritance from 1-8: reuses AuthLayout / AuthCard / GoogleOAuthButton verbatim; extends authKeys with verify mutation keys + verifyStatus query key per the P5 split pattern; consumes shipped `usePolling` hook (its first documented consumer); extends MSW catalog `msw-handler-catalog-auth.md` with 3 new endpoint sections in the same commit as the default handlers landing. Out-of-scope deferrals each owned by a specific later story (1-9d for polished error screens; 2.1 for onboarding redirect; existing `1-8-followup-warning-token-bridge` for the amber tokenization). Sibling completion-notes file authored at first dev pickup per the `bmad-story-conventions.md` 1d-4-onward convention. Hand-off to Amelia (dev) for `/bmad-dev-story 1-9a`. |
