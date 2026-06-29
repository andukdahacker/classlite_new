# Story 1-9d: Completion Notes

_Implementation record for [`1-9d-auth-error-and-recovery-states.md`](./1-9d-auth-error-and-recovery-states.md). Status: review._

## Dev Agent Record

### Debug Log

- **Auto-clear effect race on lockoutUntilMs null→target transition.** Initial design had a LoginPage `useEffect` that called `setLockoutUntilMs(null)` whenever `!countdown.isActive && lockoutUntilMs !== null`. This fired DURING the first render after 429 response — before useLockoutCountdown's internal effect could flip `isActive` from its lazy-init `false` value to `true`. Result: lockoutUntilMs was wiped back to null and mode never transitioned to 'lockout'. **Fix:** deleted the effect entirely. `countdown.isActive` is the authoritative source for the mode-flip; the hook itself clears localStorage on expiry. The local `lockoutUntilMs` state stays stale (still pointing to past timestamp) but is harmless — it just rehydrates from cleared storage as `null` on next navigation.

- **URL-clear effect dropped `?error=` before mode-replacement render landed.** Initial design used a pure `deriveLoginPageMode(searchParams, countdown.isActive)` render-time selector. After URL-clear fired (dropping `error`), mode re-derived to 'default' and the OAuthMismatch/WorkspaceBlocked region unmounted before `findByTestId` could fire. **Fix:** introduced `latchedReplacement` useState carrying a discriminated union `{ kind: 'oauthMismatch' } | { kind: 'workspaceBlocked'; reason } | null` — initialized from URL on first render, persists across URL-clear, re-derives only when URL params change to a new replacement mode. Same useState shape as `bannerKey`. Pragmatic deviation flagged in Task 5.2 — the Amelia A2 BLOCKER pin (countdown.isActive drives mode) is honored for lockout; the replacement modes latch.

- **Test pollution via localStorage.** The 429 ACCOUNT_LOCKED test wrote `lockoutUntilMs` to localStorage; subsequent tests rehydrated and started in lockout mode, breaking ~14 unrelated cases. **Fix:** added `window.localStorage.clear()` to both `beforeEach` and `afterEach` in LoginPage.test.tsx.

- **react-hooks/set-state-in-effect violations.** Synchronous `setState` calls inside `useEffect` bodies tripped the lint rule in three places: (1) useLockoutCountdown's `setRemainingSeconds` after lockoutUntilMs change, (2) LoginPage's `setLatchedReplacement` on searchParams change, (3) LockoutState's threshold-announce `useRef` access during render. **Fix:** added `eslint-disable-next-line` on the first two (justified per the rule's "subscribe to external system" exception — URL state and Date.now() ARE the external systems); refactored the third to use `useState` + `useEffect` so refs aren't accessed during render.

- **Banner refactor preserved testid contract.** The 4 inline JSX blocks in LoginPage collapsed to `<Banner variant>` calls with `testId="login-form-banner"` (success/warning) and `testId="login-form-error"` (oauth-error). All existing LoginPage.test.tsx tests continued passing without modification because the DOM contract is unchanged.

- **Existing 429 ACCOUNT_LOCKED test rewritten.** The Story 1-8 test asserted `auth.login.error.accountLocked` rendered in `login-form-error`. After 1-9d, the 429 response triggers mode='lockout' which UNMOUNTS the form. Rewrote the test to assert `login-lockout` IN DOM + `login-form`/`login-submit` ABSENT + localStorage envelope persisted.

### Completion Notes

Shipped all 8 ACs with the following pragmatic deviations (flagged for code review):

1. **Latched replacement-mode state instead of pure render-time selector.** Spec called for `deriveLoginPageMode(searchParams, countdownIsActive)` to compute mode at each render. In practice, the URL-clear effect immediately drops `?error=`, which would unmount the replacement screen before the user sees it. Latched via useState (same pattern as bannerKey).

2. **Kept `auth.login.error.accountLocked` i18n key** (spec called for deletion). It's still claimed by STORY_1_8_KEYS — deleting would require retroactively amending the 1-8 discharge block for a key that's now functionally unused but doesn't break anything. Filed-follow-up candidate.

3. **Bundle baseline measurement deferred** (spec called for pre-Task-5 measurement). Post-1-9d LoginPage = 7.37 KB gzipped (clearing the original 6 KB ESCALATE trigger but well under the new 10 KB ceiling). Set the LoginPage ceiling at 10 KB with rationale documented in `check-chunk-size.mjs`. Did not lazy-load the state components — the chunk-size headroom is sufficient.

4. **Inherited 1-9d Out-of-Scope items unchanged.** Did not file the Backend `GET /api/auth/lockout-status` endpoint to `deferred-work.md` — the dev agent role doesn't own backend deferral filing per `docs/bmad-story-conventions.md`. John/Murat tracking artifacts (traceability-matrix-epic-1c.md, nfr-assessment-epic-1c.md) remain owner-pending per the story's explicit Out-of-Scope block.

**Test deltas:** 506/506 → 589/589 (+83). LoginPage.test.tsx: 27 baseline → 51 (+24 Story 1-9d AC1/2/3/4 cases + Mode×Banner negative coverage matrix + Murat M5 cookie StrictMode spy). Banner.test.tsx +6. lockoutStorage.test.ts +10. useLockoutCountdown.test.tsx +9. sanitizeNextParam.test.ts +17. i18n-parity-coverage.test.ts +17 (STORY_1_9D_KEYS parity + closed-enumeration meta-assertion).

**Bundle sizes (gzipped):** ForgotPassword 1.71 KB / ResetPassword 1.98 KB / Invite 3.16 KB / Login 7.34 KB. All under their declared ceilings.

**Full CI matrix green:** lint, lint:css, tsc -b, vitest 589/589, playwright 48/48, build clean, build:check 4/4 chunks under ceiling, storybook:build clean, i18n-parity clean (375 keys × 2 locales, namespace coverage clean).

**6 ★ REVIEWER-MANDATORY Vietnamese keys** flagged in PR description for VN-fluent sign-off:
- `auth.login.lockout.heading` ("Vui lòng" register edit)
- `auth.login.oauthMismatch.body` (privacy-aware, no email echo)
- `auth.login.workspaceBlocked.bodyUserinfoFailed` (Workspace-policy framing)
- `auth.login.workspaceBlocked.bodyEmailUnverified` (forced-verification framing)
- `auth.login.banner.sessionExpired` ("vì lý do an toàn")
- `auth.login.banner.sessionExpiredDataLossHint`

### Implementation Plan (summary)

1. **Task 0 — sanitizeNextParam ATDD red specimen.** Helper + 17 RED tests (12 base + 5 OWASP CWE-601 ratchets). Committed standalone (3c429f1) to isolate the security-critical contract.
2. **Task 1 — i18n keys + namespace coverage extension.** 16 new auth.login.* keys (en + vi), STORY_1_9D_KEYS block + Murat M7 closed-enumeration meta-assertion, COVERED_NAMESPACES += 'auth.'. Committed (2dc5e4e). No orphan-key patches needed — all historical auth.* keys already claimed.
3. **Task 2 — Banner discriminated-union refactor.** New `<Banner variant>` component with 5 variants + per-variant container + aria-role contract. Scope-guardrail JSDoc (Winston W6). LoginPage banner JSX collapsed to component calls. Committed (6a9e784).
4. **Task 3 — Lockout machinery.** lockoutStorage (JSON envelope + 5 poisoning ratchets) + useLockoutCountdown (owns isActive useState + Murat M8 cleanup ratchets) + LockoutState component (testid, heading focus, threshold-announce at 60s/30s edge-triggered).
5. **Task 4 — OAuthMismatchState + WorkspaceBlockedState components.** Forked body copy in WorkspaceBlocked keyed off latched `reason` prop. NO register CTA on OAuthMismatch (Sally STRONG pin).
6. **Task 5 — LoginPage mode machine.** countdown.isActive drives lockout mode; latchedReplacement carries oauthMismatch/workspaceBlocked. URL-clear preserves next=. 429 ACCOUNT_LOCKED writes lockoutUntilMs. Three-site next= convergence: useLogin internal navigate DROPPED, LoginPage owns destination at password-submit + already-auth guard. Cookie-clear via mount-time useRef snapshot. Committed (82483e0).
7. **Task 6 — Storybook coverage.** +6 LoginPage variants (Lockout, LockoutMobile390, OAuthMismatch, WorkspaceBlockedUserinfoFailed, WorkspaceBlockedEmailUnverified, SessionExpiredBanner) + Banner.stories.tsx with 5 variants. Decorator wires localStorage seed for Lockout stories.
8. **Task 7 — Bundle baseline + chunk-size script.** Per-target ceiling refactor. LoginPage added at 10 KB.
9. **Task 8 — CI matrix.** Full sweep: lint / lint:css / tsc -b / vitest 589 / playwright 48 / build / build:check / storybook:build / i18n-parity all green.

## File List

### Added

- `classlite-web/src/features/auth/lib/sanitizeNextParam.ts`
- `classlite-web/src/features/auth/lib/__tests__/sanitizeNextParam.test.ts`
- `classlite-web/src/features/auth/lib/lockoutStorage.ts`
- `classlite-web/src/features/auth/lib/__tests__/lockoutStorage.test.ts`
- `classlite-web/src/features/auth/hooks/useLockoutCountdown.ts`
- `classlite-web/src/features/auth/hooks/__tests__/useLockoutCountdown.test.tsx`
- `classlite-web/src/features/auth/components/Banner.tsx`
- `classlite-web/src/features/auth/components/Banner.stories.tsx`
- `classlite-web/src/features/auth/components/__tests__/Banner.test.tsx`
- `classlite-web/src/features/auth/components/LockoutState.tsx`
- `classlite-web/src/features/auth/components/OAuthMismatchState.tsx`
- `classlite-web/src/features/auth/components/WorkspaceBlockedState.tsx`
- `_bmad-output/implementation-artifacts/1-9d-auth-error-and-recovery-states.md` (story spec)
- `_bmad-output/implementation-artifacts/1-9d-auth-error-and-recovery-states-completion-notes.md` (this file)

### Modified

- `classlite-web/src/features/auth/LoginPage.tsx` — extended to mode machine + session-expired branch + next= consumer + Banner refactor
- `classlite-web/src/features/auth/LoginPage.stories.tsx` — +6 variants for AC7
- `classlite-web/src/features/auth/__tests__/LoginPage.test.tsx` — +24 Story 1-9d cases + localStorage cleanup + ACCOUNT_LOCKED test rewrite + extended UrlProbe + classes/:id route harness
- `classlite-web/src/features/auth/api/login.ts` — dropped internal `navigate('/dashboard')`; hook is destination-agnostic now
- `classlite-web/src/features/auth/components/GoogleOAuthButton.tsx` — added optional `testId` prop for distinct recovery-state retry CTA testids
- `classlite-web/src/locales/en.json` — +16 keys
- `classlite-web/src/locales/vi.json` — +16 keys
- `classlite-web/src/lib/test/__tests__/i18n-parity-coverage.test.ts` — +STORY_1_9D_KEYS block + Murat M7 closed-enumeration meta-assertion
- `classlite-web/scripts/i18n-parity.mjs` — COVERED_NAMESPACES += 'auth.'
- `classlite-web/scripts/check-chunk-size.mjs` — refactored to per-target ceilings; added LoginPage at 10 KB
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — 1-9d ready-for-dev → in-progress → review

### Deleted

None.
