# Story 1-8: Completion Notes

_Implementation record for [`1-8-auth-ui-registration-and-login-screens.md`](./1-8-auth-ui-registration-and-login-screens.md). Status: review._

## Dev Agent Record

### Debug Log

- **MSW handler default-import side-effect.** Initial `src/test/vitest-setup.ts` change imported `@/lib/query-client` at top level so the `afterEach(queryClient.clear())` (Murat #1 mandate) could close over the singleton. That pre-resolved the `query-client → auth-refresh → @sentry/react` chain BEFORE individual test files' `vi.mock('@sentry/react', ...)` hoists ran, breaking `sentry-breadcrumb.test.ts`. Fix: swap the top-level import for a dynamic `await import('@/lib/query-client')` inside the `afterEach`. The singleton stays singleton (modules cache) and the test-file mocks fire first.
- **Base UI Collapsible `Panel` unmounts when closed.** First-pass tests asserted `data-state="closed"|"open"` on a `data-testid="collapsible-email-content"` element that only exists when the panel is open. Rewrote `CollapsibleEmailForm` + page tests to assert via the trigger's `aria-expanded` attribute (always present) and child-content presence (`queryByTestId(...)` returns null when collapsed). RegisterPage 409 path test got the same treatment.
- **`useQuery` with `enabled: false` + `initialData: null` did not re-render siblings on `setQueryData`.** The 5th `useAuth` test (Murat #5 cross-component subscription contract) failed against `useQuery` even after removing `enabled: false`. Switched `useAuth` to `useSyncExternalStore` subscribed directly to `queryClient.getQueryCache().subscribe(...)`. Subscription now fires for any write to `['auth', 'session']` regardless of which component tree wrote it. JSDoc on `useAuth` records the rationale + the abandoned `useQuery` attempt so a future refactor doesn't reintroduce the regression.
- **`skipAuthRefresh: true` clobbered 401 ApiError.** First wiring of `useLogin` passed `skipAuthRefresh: true` so the mutation didn't enter the refresh coordinator. But that path throws `AuthExpiredError` immediately and the page lost the `INVALID_CREDENTIALS` code it needs for the inline copy. Added a new `surfaceAuthError?: boolean` option to `apiFetch` — when true, a 401 falls through to `parseEnvelope()` and surfaces as the original `ApiError(401, code, ...)`. `useLogin` now uses it.
- **CollapsibleEmailForm stories TS strict-types complaint.** Storybook 10's strict `StoryObj<typeof meta>` propagates required props from `meta`; a `render-only` story without explicit `args` failed to type-check even though `meta.args` carried the required fields. Workaround: explicit `args: inheritedArgs` on each `render`-only story (verbose but localized).
- **Storybook required-exports rule.** New `*.stories.tsx` files in `src/features/auth/components/` failed the three-state lint because they aren't data-rendering components. Added `// storybook-rule: no-three-state` opt-out directive to each of the 5 component story files with a one-line justification per file (matches the documented escape hatch in `required-exports.ts` line 19-21).
- **Lint hex-color rule on Google logo SVG.** ESLint `no-restricted-syntax` flagged the 4 Google brand colors (`#4285F4`, `#34A853`, `#FBBC05`, `#EA4335`). These ARE Google's trademark spec; can't tokenize. Added `eslint-disable-next-line no-restricted-syntax -- Google brand color (trademark spec)` per path + a module-level JSDoc explaining why.
- **AuthLayout DoD grep tripwire.** The `grep -nE 'dot-grid|cl-dot-grid' AuthLayout.tsx` DoD check matched my own JSDoc comment that referenced the rule. Rewrote the comment without the literal substrings so the grep returns zero.

### Completion Notes

All 8 ACs satisfied with executable proof. 14-task plan landed verbatim plus Task 15 (boot-time refresh probe lifted from Out of Scope per Ducdo decision 2026-06-25).

- **Vitest 336/336 across 43 files** (was 251/251 + 85 new = 336): authKeys (3), passwordStrength (8), PasswordStrengthBar (6), PasswordInput (5), CollapsibleEmailForm (4), GoogleOAuthButton (5), AuthCard (3), login mutation (5), register mutation (4), useAuth subscription (5), LoginPage (12 incl. axe), RegisterPage (11 incl. axe×2), AuthLayout (5), api-fetch Retry-After + 422 sweeps (4), auth-refresh body-parse + broadcast hydration (4 new + 1 amended), App boot-probe (3).
- **i18n parity clean — 272 keys** (was 240; +32 from STORY_1_8_KEYS): `npm run i18n-parity` exits 0, namespace coverage clean (270 claimed; only `app.name` + `app.welcome` legacy un-claimed which is fine — not under any covered namespace).
- **Lint + lint:css + tsc -b + build + storybook:build all clean.**
- **Storybook test-runner: 60 suites / 303 tests axe-zero** in ~20s. New auth component stories all pass.
- **Playwright design-system 27/27 + cross-subdomain 6/6 + setup** all pass. The 4 new bilingual-smoke scenarios I added (`/login` form labels en+vi + `/register` H1 en+vi) are green. One in-session fix: `getByLabel(passwordLabel)` needed `{ exact: true }` — the eye-toggle's aria-label "Show or hide password" / "Hiện hoặc ẩn mật khẩu" partial-matched the bare "Password" / "Mật khẩu" FormLabel and Playwright's strict-mode flagged the ambiguity. Trivial spec fix; no production change.
- **AuthLayout DoD grep returns zero** for `dot-grid|cl-dot-grid`.
- **LoginPagePlaceholder.tsx deleted** and `e2e/route-bundle-boundaries.spec.ts:36-38` regex updated from `LoginPagePlaceholder-[\w-]+\.js` to `LoginPage-[\w-]+\.js` per Amelia #2 amendment.
- **`useAuth` graduated** from no-session stub to cache-subscribing hook via `useSyncExternalStore` (NOT `useQuery` — see Debug Log). `isAuthenticated` derived from `user.emailVerified`, NOT `accessToken` (Winston #5 contract).
- **`auth-refresh.ts` refactored** per Winston #1 + Amelia #1: `performNetworkRefresh` parses `EnvelopeLoginResult`, `RefreshResult` carries `data` on success, cache write uses literal `['auth', 'session']` key (avoids `lib/ → features/` import cycle; locked by `authKeys.test.ts` contract assertion), BroadcastChannel `refresh-succeeded` payload carries `data` so sibling tabs hydrate via `setQueryData` (NOT `invalidateQueries`), malformed body stays `ok: true` to avoid downgrading flaky-gateway to logout.
- **`apiFetch` `ApiError.retryAfterSeconds`** sibling readonly property per Winston #3 (NOT spread into `details` — that would corrupt the 422 `[{field, message}]` array). New `surfaceAuthError?: boolean` option for the LoginPage 401 INVALID_CREDENTIALS path (see Debug Log).
- **MSW handler catalog renamed** `msw-handler-catalog-1-5.md` → `msw-handler-catalog-auth.md` with new `POST /api/auth/register` section appended (happy + 409 + 422 + 429 variants) and `target_stories` broadened to all of 1-9a..d per Murat #4 amendment.
- **`vitest-setup.ts`** gains the `afterEach(queryClient.clear())` safety net per Murat #1 — with the dynamic-import workaround documented inline for the `@sentry/react` mock-hoist ordering issue.
- **App.tsx boot-time refresh probe** lands per Task 15 — `useRef(false)` latch + `refreshAccessToken()` on first mount when cache is empty.
- **AuthLayout polish** per Sally: wordmark left, language toggle right, mobile collapses to 32×32 icon-only (globe + 2-letter locale chip) that expands on tap with click-outside collapse.
- **LoginPage `surfaceAuthError`** for 401 INVALID_CREDENTIALS — bypasses the refresh coordinator so the inline copy gets the actual ApiError. RegisterPage does NOT use it (api.yaml doesn't return 401 from /register).

**Deferred (carry-over by spec design)**:
- VerificationPending + useVerificationPoller → Story 1.9a (LoginPage/RegisterPage already navigate to `/verify-email?pollId=...` — destination is 1.9a's responsibility).
- ForgotPassword + ResetPassword screens → 1.9b (links shipped, destinations 1.9b).
- InviteCard / `inviteToken` query plumbing → 1.9c (`searchParams` prop on GoogleOAuthButton ships in the type signature but no consumer passes it).
- Polished Lockout countdown screen / per-code OAuth error decoder → 1.9d (the generic `oauthGeneric` transient bridge on LoginPage covers the gap until then).
- Role-aware post-login redirect → Story 2.6.
- Onboarding redirect after first login → Epic 2 Story 2.1.

**Deviations from spec** (none material — all reviewer-resolved at scaffold time):
- No `Alert` component exists in `src/components/ui/` (1d-2 shipped 38 primitives but Alert was NOT one of them). Form-level error rendering uses an inline `<div role="alert">` styled with destructive tokens. Consistent with the spec contract (`<Alert variant="destructive">`) — the visible behavior + accessibility tree match.
- `rememberMe` defaults to `false` per spec (deviation from AUTH-03 mockup, security-first for shared-phone Vietnamese students — documented in `LoginPage.tsx` JSDoc).
- The OAuth transient bridge test (`renders oauthGeneric transient when /login?error=foo lands AND clears the query param`) is intentionally light — sonner toasts are fire-and-forget; the load-bearing contract (query param clear) is verified.

**Reviewer-mandatory keys still need a Vietnamese-fluent reviewer pass before merge** (per AC2 ★):
- `auth.login.error.accountLocked` (with `{{minutes}}` interpolation — machine translation likely to produce ungrammatical "trong vòng X phút" — current seed: "Tài khoản tạm khóa. Thử lại sau {{minutes}} phút.")
- `auth.login.error.rateLimited`
- `auth.login.error.generic`
- `auth.login.error.oauthGeneric`

**Tracked follow-up**:
- ESLint `no-restricted-imports` config carve-out for `hooks/useAuth.ts` → `features/auth/api/authKeys`. Not flagged in CI today (the cross-feature direction isn't enforced yet) but worth a one-line entry in the rule config when the next person edits ESLint.
- **Dev-server noise from boot probe.** With no Go API running, `npm run dev` + every page load fires the boot probe which hits `/api/auth/refresh` → vite proxy → `ECONNREFUSED`. The probe handles the failure silently (per Task 15 design — the user stays unauthenticated, which is the correct end state), so no functional bug; but the noisy `http proxy error` line in the dev terminal is visible. Possible enhancement: short-circuit the probe when `import.meta.env.DEV && !navigator.onLine` OR cache a 401 result for N seconds so the probe doesn't refire per-route. Not worth blocking this story on.

### Implementation Plan (summary)

1. **Task 1** — i18n keys (32 new) into `en.json` + `vi.json`, `STORY_1_8_KEYS` block appended to `i18n-parity-coverage.test.ts`. Verified `npm run i18n-parity` green.
2. **Task 2** — `src/test/mocks/handlers.ts` with 6 default handlers; `msw-server.ts` wired with spread; `vitest-setup.ts` gains `afterEach(queryClient.clear())` (dynamic-import workaround); catalog renamed + register section + frontmatter update.
3. **Task 3** — `authKeys.ts` factory + `Session` interface + contract test.
4. **Task 4** — `useAuth.ts` rewritten to `useSyncExternalStore` subscription; `auth-refresh.ts` body-parse refactor + BroadcastChannel hydration; tests updated.
5. **Task 5-9** — Five shared components (PasswordStrengthBar + PasswordInput + CollapsibleEmailForm + GoogleOAuthButton + AuthCard) with co-located stories + tests + `// storybook-rule: no-three-state` opt-outs.
6. **Task 10** — `useLogin` + `useRegister` mutations + `apiFetch` `retryAfterSeconds` sibling readonly property + `surfaceAuthError` option + tests.
7. **Task 11** — `loginSchema.ts` (`useLoginSchema` builder-hook with `z.string().pipe(z.email(...))` pattern); `LoginPage.tsx` with full error branch coverage; `LoginPagePlaceholder.tsx` deleted; `routes.tsx` switched; bundle-boundary spec regex updated.
8. **Task 12** — `registerSchema.ts`; `RegisterPage.tsx` with 409 force-expand + 422 per-field setError + 429 / generic + email-delivery failed toast; `/register` lazy route added.
9. **Task 13** — `AuthLayout.tsx` enriched with wordmark + responsive LanguageToggle; tests + DoD grep verified.
10. **Task 14** — `bilingual-smoke.spec.ts` extended with `/register` H1 + `/login` form-label scenarios; lint + tests + build + storybook:build + storybook:test:ci all green.
11. **Task 15** — boot-time refresh probe in `App.tsx` with `useRef(false)` latch + 3 pinned tests.

## File List

### Added

- `classlite-web/src/features/auth/LoginPage.tsx`
- `classlite-web/src/features/auth/RegisterPage.tsx`
- `classlite-web/src/features/auth/api/authKeys.ts`
- `classlite-web/src/features/auth/api/login.ts`
- `classlite-web/src/features/auth/api/register.ts`
- `classlite-web/src/features/auth/api/__tests__/authKeys.test.ts`
- `classlite-web/src/features/auth/api/__tests__/login.test.tsx`
- `classlite-web/src/features/auth/api/__tests__/register.test.tsx`
- `classlite-web/src/features/auth/components/AuthCard.tsx`
- `classlite-web/src/features/auth/components/AuthCard.stories.tsx`
- `classlite-web/src/features/auth/components/CollapsibleEmailForm.tsx`
- `classlite-web/src/features/auth/components/CollapsibleEmailForm.stories.tsx`
- `classlite-web/src/features/auth/components/GoogleOAuthButton.tsx`
- `classlite-web/src/features/auth/components/GoogleOAuthButton.stories.tsx`
- `classlite-web/src/features/auth/components/PasswordInput.tsx`
- `classlite-web/src/features/auth/components/PasswordInput.stories.tsx`
- `classlite-web/src/features/auth/components/PasswordStrengthBar.tsx`
- `classlite-web/src/features/auth/components/PasswordStrengthBar.stories.tsx`
- `classlite-web/src/features/auth/components/__tests__/AuthCard.test.tsx`
- `classlite-web/src/features/auth/components/__tests__/CollapsibleEmailForm.test.tsx`
- `classlite-web/src/features/auth/components/__tests__/GoogleOAuthButton.test.tsx`
- `classlite-web/src/features/auth/components/__tests__/PasswordInput.test.tsx`
- `classlite-web/src/features/auth/components/__tests__/PasswordStrengthBar.test.tsx`
- `classlite-web/src/features/auth/lib/loginSchema.ts`
- `classlite-web/src/features/auth/lib/passwordStrength.ts`
- `classlite-web/src/features/auth/lib/registerSchema.ts`
- `classlite-web/src/features/auth/lib/__tests__/passwordStrength.test.ts`
- `classlite-web/src/features/auth/__tests__/AuthLayout.test.tsx`
- `classlite-web/src/features/auth/__tests__/LoginPage.test.tsx`
- `classlite-web/src/features/auth/__tests__/RegisterPage.test.tsx`
- `classlite-web/src/test/mocks/handlers.ts`
- `classlite-web/src/__tests__/App-boot-probe.test.tsx`
- `_bmad-output/implementation-artifacts/1-8-auth-ui-registration-and-login-screens-completion-notes.md` (this file)

### Modified

- `classlite-web/src/App.tsx` — boot-time refresh probe `useEffect` + `useRef(false)` latch.
- `classlite-web/src/features/auth/AuthLayout.tsx` — wordmark + responsive LanguageToggle; the mobile control collapses to a 32×32 globe button that expands on tap.
- `classlite-web/src/hooks/useAuth.ts` — graduated from stub to `useSyncExternalStore` subscription; `isAuthenticated` derived from `user.emailVerified`.
- `classlite-web/src/hooks/__tests__/useAuth.test.tsx` — 5 new tests covering the cache-subscription contract + isAuthenticated gating.
- `classlite-web/src/lib/api-fetch.ts` — `ApiError.retryAfterSeconds` sibling readonly property; `parseRetryAfter` RFC 9110 helper; `surfaceAuthError?: boolean` option.
- `classlite-web/src/lib/__tests__/api-fetch.test.ts` — 4 new tests (Retry-After parse for 429 ACCOUNT_LOCKED / RATE_LIMIT_EXCEEDED, null for non-rate-limit, 422 details preservation).
- `classlite-web/src/lib/auth-refresh.ts` — `performNetworkRefresh` body-parse refactor; `RefreshResult.data`; literal `['auth', 'session']` cache writes; BroadcastChannel payload carries `data`.
- `classlite-web/src/lib/__tests__/auth-refresh-locks.test.ts` — invalidate→setQueryData swap; new tests for malformed-body resilience + sibling-tab hydration + 200-with-valid-body cache hydration.
- `classlite-web/src/lib/test/__tests__/i18n-parity-coverage.test.ts` — `STORY_1_8_KEYS` block + describe + 32 enumerated keys.
- `classlite-web/src/locales/en.json` — 32 new auth keys (placeholders, strength labels, validation messages, error envelopes).
- `classlite-web/src/locales/vi.json` — same 32 keys, Vietnamese seeds. 4 keys (login error variants) flagged ★ REVIEWER-MANDATORY in the story file.
- `classlite-web/src/routes.tsx` — `/login` switched from placeholder to real `LoginPage`; new `/register` lazy route added under `AuthLayout`.
- `classlite-web/src/test/msw-server.ts` — `setupServer(...handlers)` (was bare `setupServer()`).
- `classlite-web/src/test/vitest-setup.ts` — `afterEach` global `queryClient.clear()` safety net (dynamic-import to avoid `@sentry/react` mock-hoist ordering issue).
- `classlite-web/e2e/bilingual-smoke.spec.ts` — `/register` H1 scenario + `/login` form-label scenario per AC8. Password label uses `getByLabel(..., { exact: true })` so the eye-toggle's aria-label doesn't collide.
- `classlite-web/e2e/route-bundle-boundaries.spec.ts` — `LoginPagePlaceholder` → `LoginPage` regex update per Amelia #2 amendment.
- `_bmad-output/test-artifacts/msw-handler-catalog-auth.md` (renamed from `msw-handler-catalog-1-5.md`) — `POST /api/auth/register` section appended; frontmatter `target_stories` broadened to 1-9a..d; Change Log entry.
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — story-status flipped ready-for-dev → in-progress → review with `last_updated` comment prepended.

### Deleted

- `classlite-web/src/features/auth/LoginPagePlaceholder.tsx` — replaced by `LoginPage.tsx`. The H1 contract `t('auth.login.title')` is preserved verbatim so the 1-7c bilingual smoke spec stays green.
