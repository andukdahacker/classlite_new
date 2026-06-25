# Story 1-9a: Completion Notes

_Implementation record for [`1-9a-email-verification-ui.md`](./1-9a-email-verification-ui.md). Status: review._

_Authored under the convention introduced 2026-06-22 in [`docs/bmad-story-conventions.md`](../../docs/bmad-story-conventions.md). The story file holds the spec (AC, tasks, Dev Notes, DoD, Change Log); this file holds the implementation record._

## Dev Agent Record

### Debug Log

- **Spurious `Cannot find module '@/...'` TypeScript diagnostics throughout the run.** Every new file created during the session triggered "Cannot find module" diagnostics for the `@/lib`, `@/features`, `@/hooks`, etc. path aliases — even though `tsc --noEmit --project tsconfig.app.json` was clean and `npx vitest run` resolved them fine. The diagnostics came from the editor's TS server lagging behind file creations / edits within the session. Treated as noise; verified each new file with an actual `tsc` invocation before moving on.
- **`jest-dom`-style matcher in test file.** First pass of `VerifyEmailPage.test.tsx` used `expect(...).toBeInTheDocument()` from `@testing-library/jest-dom` — the project does not register that matcher pack (the vitest-setup only registers `vitest-axe`'s `toHaveNoViolations`). Replaced every `.toBeInTheDocument()` with `.not.toBeNull()`; the project pattern is `screen.getByTestId(...)` (which throws on absence) plus `.queryByTestId(...).toBeNull()` for the negative assertion.
- **`waitFor` + fake timers hang.** Initial draft of timing-sensitive tests used `await waitFor(() => ...)` after `vi.advanceTimersByTimeAsync(...)`. `waitFor` polls with REAL setTimeout, so when fake timers are active the poll never ticks — every test hung at the 5-second timeout. Replaced with the `await act(async () => { await vi.advanceTimersByTimeAsync(...) })` pattern + sync assertions. The `act` wrapper drains microtasks (state-commit propagation) inside the fake-timer slice.
- **`userEvent` interaction hangs under MSW + Toaster setup.** AC4 resend tests use real timers + userEvent. Default `userEvent.setup()` waited on its own internal delay schedule, which never resolved with the in-flight MSW request from `useResendVerification`. Switched to `userEvent.setup({ delay: null })` per test — runs interactions synchronously, so the click fires immediately and the mutation's `onSuccess` callback chain resolves cleanly.
- **R-NEW=12 late-200-after-cap test was actually testing the wrong race.** First version of the late-200 test used `delay(6_000)` on the MSW handler — but 6 seconds is way under the 10-minute cap, so the response resolved during the FIRST advance window (before the cap fired). The verified:true was committed legitimately and the navigate fired — not the dropped-late-response path I needed to test. Fixed by using `delay(700_000)` (700 seconds, longer than the 10-min cap), then advancing past the cap WITHOUT draining the response, then draining the response in a third advance. Now exercises the actual "in-flight response resolves after terminal commit" branch.
- **Polling continued indefinitely after 404 / verified:true.** The `useVerificationPoller` hook correctly sets `terminalStateRef.current = 'expired'` / `'verified'` on terminal responses — but the page-level `pollerEnabled` state was not flipped to `false` for the 404 / verified paths. The result: the next 5-second tick would re-fire `usePolling`'s `setInterval`, which would re-fire the fetch (since the terminal-state ref only drops the RESPONSE, not the FETCH itself). Added a dedicated effect that watches `verified || expired` and flips `pollerEnabled` to false. The redirect-effect's `setPollerEnabled(false)` is now redundant but retained as a documentation marker at the timing-critical point.
- **LoginPage "no flash of banner" race.** When LoginPage mounts already-authenticated (seeded session), the Layer A guard's `useEffect` fires AFTER the first paint — meaning the verified banner painted for one frame before the navigate to /dashboard. The pinned test "does NOT render verified banner when isAuthenticated already true at mount" failed because the URL-clear effect ALSO ran in the same render and called `setSearchParams(replace: true)` to /login, which canceled the navigate to /dashboard scheduled by Layer A. Fixed by: (a) gating the banner element's render on `!isAuthenticated && verifiedBanner`, and (b) early-returning the URL-clear effect when `isAuthenticated` is true (let Layer A's redirect own the navigation).
- **`route-bundle-boundaries.spec.ts` bundle-content assertion.** First pass used `expect(authChunkContents).toContain('VerifyEmailPage')` against the dist `.js` file contents — but Rolldown minifies the chunks, so the literal `VerifyEmailPage` identifier doesn't survive. Switched to asserting on the chunk FILE NAMES (Rolldown preserves the import-name in the file basename) plus dependency-check via reading the dashboard chunks and asserting they don't reference the verify chunk's basename. The negative contract still holds: if Rolldown silently merged VerifyEmailPage into a dashboard chunk, the dashboard chunk's static-import map would carry the verify chunk's filename and the assertion would fail.

### Completion Notes

- All 8 ACs discharged, all 8 task groups checked.
- 9 new test files, 8 new product files, 1 catalog file updated:
  - **product**: `VerifyEmailPage.tsx`, `VerifyEmailPage.stories.tsx`, `resendVerification.ts`, `verifyEmail.ts`, `useVerificationPoller.ts`, `useResendCountdown.ts`, plus extensions to `authKeys.ts`, `login.ts`, `auth-refresh.ts`, `LoginPage.tsx`, `routes.tsx`, `handlers.ts`, `en.json`, `vi.json`.
  - **test**: `VerifyEmailPage.test.tsx` (20 tests), `resendVerification.test.tsx` (3), `verifyEmail.test.tsx` (3), `useVerificationPoller.test.tsx` (6), `useResendCountdown.test.tsx` (6), plus extensions to `authKeys.test.ts` (+4), `LoginPage.test.tsx` (+5), `login.test.tsx` (+1), `auth-refresh-locks.test.ts` (+1), `i18n-parity-coverage.test.ts` (+STORY_1_9A_KEYS), `route-bundle-boundaries.spec.ts` (+1).
- **24 net-new i18n keys** added (en + vi parity-clean): 23 under the new `auth.verify.*` namespace + 1 under `auth.login.banner.verified`. Total i18n keys after this story: 299 (was 275 at 1-8 close).
- **3 ★ REVIEWER-MANDATORY Vietnamese keys** flagged in the AC2 contract (see story spec) for VN-fluent reviewer sign-off before merge: `resendSentToast`, `expiredBody`, `error.generic` — plus 2 added during the 2026-06-25 party-mode review (`spamHint`, `googleFallbackCta`). The `googleFallbackCta` key ALSO carries the architecture-confirmation gate (Winston must confirm Google OAuth auto-links same-email accounts on the backend; if it doesn't, the copy "we'll link them automatically" is misleading and the entire Google-fallback messaging needs a rewrite before merge).
- **Test matrix (final)**: Vitest 390/390 across 48 files (was 340 at 1-8 close; +50 new tests), tsc -b clean, ESLint clean, lint:css clean, i18n-parity 299 keys parity-clean + namespace coverage clean, npm run build clean (VerifyEmailPage chunk 11.32 KB / 3.30 KB gzipped — slightly over the spec's 4-6 KB expectation due to inline envelope+clock SVGs + the three-mode branch handler), npm run storybook:build clean.
- **Playwright route-bundle-boundaries spec**: extended with positive (VerifyEmailPage chunk exists) + negative (dashboard chunks don't import it) assertions per the party-mode 2026-06-25 amendment. All 4 tests in the spec pass.
- **Three documented deviations from the spec letter, all resolved pragmatically**:
    1. **Storybook `PollingTimeout` story** does NOT visually render the post-10-min timeout state — it shows the polling state with a slow MSW response. The full timeout UI is locked by `VerifyEmailPage.test.tsx`'s `vi.useFakeTimers()` pinned test (AC5). The storybook surface is informational; per-story timer mocking would require a story-only decorator we deferred.
    2. **`useVerificationPoller.rerunOnce()`** was added during implementation (NOT in the spec) to satisfy the AC5 "manual recheck fires a SINGLE GET, does NOT re-arm the poller" contract. The hook's spec API mentioned `commitTerminal` but not a one-shot fire helper; the page-level handler now calls `rerunOnce()` directly rather than the rejected "re-enable enable=true for one tick" pattern. The new helper resets `terminalStateRef.current = 'pending'` before firing so the response branches correctly. Documented in the hook JSDoc + tested in the page suite.
    3. **`useResendCountdown` ships with a `tickToken` reset-only state** to avoid re-arming the interval every second. The spec was ambiguous; the simpler version had a `useEffect` keyed off `remaining` that re-armed every tick. Refactored to keep the interval lifetime tied to the start call, not the per-second tick.
- **Out-of-scope items left for downstream stories** (each tracked in the story's "Out of Scope" block):
    - Polished error-recovery screens → Story 1.9d.
    - Vietnamese fluent reviewer pass on new keys → pre-merge.
    - `--cl-status-warning` token bridge → existing `1-8-followup-warning-token-bridge` entry in deferred-work.md (the amber utilities used for envelope checkmark + clock SVG are pragmatic Tailwind values: `text-amber-600`).
    - Cross-tab "verified in tab B, hydrate tab A" via BroadcastChannel for verify → documented non-deferral (5s poll catches it).
    - Cross-browser verification → explicitly out-of-scope per story Change Log.
    - Onboarding redirect after verification → Story 2.1.
    - Standalone "click here to recheck" loop after 10-min timeout → spec mandates ONE manual recheck button only; if the recheck returns 200 verified:false, the screen stays on the recheck state.

### Implementation Plan (as executed)

1. **Read-first sweep.** Loaded the story file (537 lines), bmad-story-conventions.md, project-context.md (1340+ lines), authKeys.ts, login.ts, register.ts, usePolling.ts, useAuth.ts, auth-refresh.ts, LoginPage.tsx, AuthCard.tsx, GoogleOAuthButton.tsx, msw-handler-catalog-auth.md (pre-1-9a state), api.yaml (verify endpoints), client.ts (verify schemas), i18n-parity-coverage.test.ts. Verified `baseline_commit: 02a27d9` matched HEAD.
2. **Sprint-status flip.** `1-9a-email-verification-ui: ready-for-dev → in-progress` in sprint-status.yaml.
3. **Task 1 — MSW catalog + handlers.** Appended verify-email / resend-verification / verify-status sections to the catalog. Landed the three new default handlers in `handlers.ts` per TEST-FE-1.
4. **Task 2 — i18n keys.** Added 24 keys to en.json + vi.json atomically. Appended `STORY_1_9A_KEYS` const + `describe('Story 1-9a i18n parity (R38)', ...)` block to the parity coverage test. Verified `npm test -- i18n-parity-coverage` green + `npm run i18n-parity` 299 keys parity-clean.
5. **Task 3 — Auth API extensions.** Extended `authKeys` with `verifyStatus(pollId)`, `resendMutation()`, `verifyEmailMutation()`. Created `resendVerification.ts` + `verifyEmail.ts` mutation hooks. Extended `authKeys.test.ts` with 4 new contract assertions. Wrote 3 tests each for the two new mutation hooks.
6. **Task 4 — Feature hooks.** Created `useVerificationPoller.ts` (wrapping `usePolling` with `terminalStateRef`) + `useResendCountdown.ts`. Wrote 6 tests each in co-located `__tests__/`. Caught the `tickToken` issue during the first test run (the initial useEffect re-armed every tick).
7. **Task 5 — VerifyEmailPage.** Built the dual-mode page with polling / click-through / invalid branches. Wired the 1500ms redirect via `useEffect` keyed on `verified === true` (R-NEW=12 mitigation) + the `stillMountedAndVerifiedRef` guard. Added the route entry to `routes.tsx`. Wrote 20 tests covering AC1, AC3, AC4, AC5, AC6, AC7 including the R-NEW=12 regression guards. Caught and fixed the polling-after-terminal-state bug during test development.
8. **Task 7 — LoginPage three-part amendment.** Layer A (verified banner) + Layer B (already-auth guard) + Layer C (cross-tab `login-succeeded` BroadcastChannel signal). Extended `auth-refresh.ts` with `LoginSucceededSignal` + `broadcastLoginSucceeded` helper. Wired `useLogin.onSuccess` to broadcast. Wrote +5 LoginPage tests, +1 useLogin test (fixture sibling BroadcastChannel listener), +1 auth-refresh test (sibling broadcast → cache hydration).
9. **Task 6 — Storybook stories.** Created `VerifyEmailPage.stories.tsx` with 10 variants per AC8. Each story has a `play()` function asserting the right `data-testid` renders. The PollingTimeout story uses a slow MSW response rather than driving fake timers (storybook timers are real).
10. **Task 8 — CI matrix.** Initial `npm run lint` flagged 7 errors: 4 raw hex colors (replaced `#d97706` with `currentColor` + Tailwind's `text-amber-600` on the SVG containers), 1 dead `let body: ReactNode = null` (removed initializer), 2 set-state-in-effect cascades (justified eslint-disable per the pollerEnabled state-derivation rationale). All gates green: vitest 390/390, tsc clean, eslint clean, stylelint clean, build clean (VerifyEmailPage 11.32 KB / 3.30 KB gzipped), storybook:build clean, i18n-parity 299 keys, playwright route-bundle-boundaries 4/4.
11. **Task 9 — finalize.** Sibling completion notes file authored (this file). Story file Change Log entry added. Sprint-status flipped `in-progress → review`. DoD checkboxes marked.

## File List

### Added

- `classlite-web/src/features/auth/VerifyEmailPage.tsx` — Task 5 page component.
- `classlite-web/src/features/auth/VerifyEmailPage.stories.tsx` — Task 6 Storybook variants (10 stories).
- `classlite-web/src/features/auth/__tests__/VerifyEmailPage.test.tsx` — Task 5.8 pinned tests (20 tests).
- `classlite-web/src/features/auth/api/resendVerification.ts` — Task 3.2 mutation hook.
- `classlite-web/src/features/auth/api/verifyEmail.ts` — Task 3.3 mutation hook.
- `classlite-web/src/features/auth/api/__tests__/resendVerification.test.tsx` — Task 3.4 hook tests (3 tests).
- `classlite-web/src/features/auth/api/__tests__/verifyEmail.test.tsx` — Task 3.4 hook tests (3 tests).
- `classlite-web/src/features/auth/hooks/useVerificationPoller.ts` — Task 4.1 poller wrapping `usePolling` with `terminalStateRef`.
- `classlite-web/src/features/auth/hooks/useResendCountdown.ts` — Task 4.2 countdown hook.
- `classlite-web/src/features/auth/hooks/__tests__/useVerificationPoller.test.tsx` — Task 4.3 hook tests (6 tests).
- `classlite-web/src/features/auth/hooks/__tests__/useResendCountdown.test.tsx` — Task 4.3 hook tests (6 tests).
- `_bmad-output/implementation-artifacts/1-9a-email-verification-ui-completion-notes.md` — this file.

### Modified

- `classlite-web/src/features/auth/api/authKeys.ts` — Task 3.1: appended `verifyStatus`, `resendMutation`, `verifyEmailMutation`.
- `classlite-web/src/features/auth/api/__tests__/authKeys.test.ts` — Task 3.1: +4 contract assertions.
- `classlite-web/src/features/auth/api/login.ts` — Task 7.10: posts `login-succeeded` BroadcastChannel signal in `onSuccess`.
- `classlite-web/src/features/auth/api/__tests__/login.test.tsx` — Task 7.12: +1 broadcast-receipt test.
- `classlite-web/src/features/auth/LoginPage.tsx` — Task 7.1-7.6: Layer A verified banner + Layer A already-auth guard via `useAuth`/`useNavigate`. Extended URL-clear effect to drop `?verified=1` alongside `?error=`. Banner gated on `!isAuthenticated` to prevent flash-of-banner before the Layer A redirect lands.
- `classlite-web/src/features/auth/__tests__/LoginPage.test.tsx` — Task 7.11: +5 pinned tests.
- `classlite-web/src/lib/auth-refresh.ts` — Task 7.7-7.9: added `LoginSucceededSignal` to the discriminated union, extended `handleChannelMessage` to handle it, extracted `hydrateSessionCache` helper for DRY between refresh-succeeded + login-succeeded paths, exported `broadcastLoginSucceeded`. Existing `isRefreshSignal` type guard updated for the new variant.
- `classlite-web/src/lib/__tests__/auth-refresh-locks.test.ts` — Task 7.13: +1 listener-side test.
- `classlite-web/src/routes.tsx` — Task 5.7: appended `{ path: 'verify-email' }` under AuthLayout children.
- `classlite-web/src/test/mocks/handlers.ts` — Task 1.3: appended 3 new MSW handlers for the verify endpoints.
- `classlite-web/src/locales/en.json` + `vi.json` — Task 2.1-2.2: 24 net-new keys atomically.
- `classlite-web/src/lib/test/__tests__/i18n-parity-coverage.test.ts` — Task 2.3: appended `STORY_1_9A_KEYS` const + describe block.
- `classlite-web/e2e/route-bundle-boundaries.spec.ts` — appended positive (verify chunk exists) + negative (dashboard chunks don't import verify chunk) assertions per AC1 party-mode 2026-06-25.
- `_bmad-output/test-artifacts/msw-handler-catalog-auth.md` — Task 1.1-1.2: appended verify-email / resend-verification / verify-status endpoint sections + bumped `last_updated` + Change Log row.
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — `1-9a-email-verification-ui: ready-for-dev → in-progress → review`.

### Deleted

_(none)_

## Open follow-ups for code review pickup

- **Architecture confirmation gate** (★ MANDATORY before merge): Winston confirms Google OAuth auto-links same-email accounts on the backend. If linking semantics differ from "we'll link them automatically", the `auth.verify.googleFallbackCta` copy is a blocker and the entire Google-fallback messaging needs a rewrite. The current copy presumes account-linking.
- **VN-fluent reviewer pass** (★ MANDATORY before merge) on 5 Vietnamese keys: `auth.verify.resendSentToast`, `auth.verify.spamHint`, `auth.verify.googleFallbackCta`, `auth.verify.expiredBody`, `auth.verify.error.generic`.
- **VerifyEmailPage chunk size** — 11.32 KB / 3.30 KB gzipped is slightly over the AC8 expectation (4-6 KB gzipped). Above the bar by ~50% — driven mainly by the inline envelope+clock SVGs and the three-mode branch handlers. Reviewer to confirm acceptable or extract SVGs to a separate asset bundle.
- **`useVerificationPoller.rerunOnce()`** is a hook-level API not present in the original story spec; the spec called for `commitTerminal` only. Reviewer to confirm the addition is acceptable (rationale: the AC5 "single GET, no re-arming" contract required a one-shot fetch primitive the spec didn't name explicitly).
- **The two `react-hooks/set-state-in-effect` eslint-disables** at VerifyEmailPage.tsx:399 + :431 — both justified per the pollerEnabled-derives-from-poller-terminal-state rationale, but the comments could be tightened for the reviewer.
- **Storybook `PollingTimeout`** does not visually exercise the post-cap UI (uses slow MSW response instead of timer mocking). The unit tests cover the timeout contract; the storybook surface is informational.
- **`auth.` is NOT in `COVERED_NAMESPACES`** at `scripts/i18n-parity.mjs` despite the story's AC1 risk text claim. The story's Task 2 has 2.1-2.4 only (no 2.5 listed); the AC1 commitment was inconsistent with the Task list. The current state — `STORY_1_9A_KEYS` block claims all 24 new keys directly — still satisfies traceability, but if the reviewer wants the namespace-coverage gate extended, it's a one-line addition to the `COVERED_NAMESPACES` array (all existing `auth.*` keys are already claimed by `STORY_1_7C_KEYS` + `STORY_1_8_KEYS`, so the addition is additive).
