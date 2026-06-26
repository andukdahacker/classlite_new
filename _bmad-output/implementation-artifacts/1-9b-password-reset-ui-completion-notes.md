# Story 1-9b: Completion Notes

_Implementation record for [`1-9b-password-reset-ui.md`](./1-9b-password-reset-ui.md). Status: review._

## Dev Agent Record

### Debug Log

- **LSP path-alias false positives** on `@/...` imports — repeated diagnostic noise in new files. Confirmed harmless: vitest + tsc -b + production build all resolve cleanly via the project's tsconfig path map. No action.
- **shadcn Button has no `asChild` prop** — the project's `@/components/ui/button.tsx` wraps `base-ui/react/button` with no Radix-style slot. Initial ResetPasswordPage Expired/Consumed/Invalid CTAs rendered `<Button asChild><Link>` which produced an invalid nested `<button><a>` and broke navigation. Fixed by switching to `<Link className={cn(buttonVariants(...))}>` (precedent set by other Link CTAs in the auth surface).
- **jest-dom matchers absent in vitest-setup** — the project does NOT register `toBeInTheDocument` / `toBeDisabled`. Rewrote both new test files to use `.toBeTruthy()` / `.toBeNull()` and direct `.disabled` boolean checks (the existing LoginPage / RegisterPage tests follow the same convention).
- **Banner re-derivation clobbered initial paint** — first cut of the LoginPage `bannerKey` re-derivation effect ran AFTER the URL-clear effect, read the now-empty searchParams, and unset bannerKey to null before the user could see the banner. Fixed with additive-only semantics: the effect early-returns when `next === null`, matching the original 1-9a "signals are sticky once shown" contract.
- **PasswordStrengthBar veryStrong threshold** — the strength scorer caps at 3 ("strong") for passwords under 12 chars regardless of character-class diversity. Test fixture updated from `abcDEF123!` (10 chars → strong) to `bcDEF123!XYZ` (12 chars → very strong).

### Completion Notes

All 9 ACs satisfied:

1. **AC1** — `/forgot-password` + `/reset-password` lazy routes added to AuthLayout children; bundle-boundary spec extended with the explicit iteration shape (4 vacuous-pass guards + 2 iterated negative loops); 5 Playwright tests green.
2. **AC2** — 28 new i18n keys in BOTH `en.json` + `vi.json`; `STORY_1_9B_KEYS` block + `describe('Story 1-9b i18n parity (R38)', ...)` appended to `i18n-parity-coverage.test.ts` (8/8 green); `npm run i18n-parity` clean. The 4 ★ REVIEWER-MANDATORY vi keys (forgotPassword.sentBody / forgotPassword.error.generic / resetPassword.body / login.banner.reset) seeded with Sally's 2026-06-26 rewrites and flagged in PR description for VN-fluent reviewer pass.
3. **AC3** — ForgotPasswordPage form mode + anti-enum confirmation with bolded email + spam hint + typo-escape ("Wrong email?") button + Resend button with 60s countdown. 12 pinned tests green including the anti-enum coupling regression guard and the deep-equal resend body assertion.
4. **AC4** — 429 surfaces `ApiError.retryAfterSeconds` clamped to MAX_COUNTDOWN_SECONDS; 422 / 5xx fall to the generic alert with the form staying in input mode.
5. **AC5** — ResetPasswordPage reads `token` reactively via `useSearchParams()` inside `useMemo`; null/empty/whitespace token → invalid state with zero MSW request count. RHF uses `reValidateMode: 'onChange'` per Winston amendment. Stale-refine ATDD specimen + email-leak rejection ratchet ATDD specimen both green (written BEFORE the green implementation per Murat's discipline-ratchet rationale).
6. **AC6** — 410 / 409 / 404 each swap to the right region with TEST-FE-6 compliance (every state-region test asserts the OTHER three regions ABSENT); 422 / 5xx keep the form in input mode.
7. **AC7** — LoginPage refactored: three competing `useState` slots collapsed into ONE derived `bannerKey: 'reset' | 'verified' | 'oauth-error' | null` selector with priority `reset > verified > oauth-error`. Inline 16×16 checkmark SVG with `aria-hidden="true"` on the reset banner. Session-cache invalidation fires synchronously on `?reset=1` lazy-init mount via `queryClient.removeQueries({ queryKey: authKeys.session() })`. URL-clear effect renamed scope (drops error / verified / reset atomically). 4 new tests green (23/23 LoginPage total).
8. **AC8** — 11 ForgotPasswordPage stories + 9 ResetPasswordPage stories + 1 LoginPage `ResetBanner` variant created. `npm run storybook:build` clean.

**Pragmatic deviation acknowledged**: epic AC for "pre-fill email on expired-CTA" rejected on security grounds (anti-enum attack surface + email-preview leak via email-client tooling). Per [[feedback_pragmatic_interpretation_of_spec_absolutes]] Winston framed this as an Epic AC defect (not a story-level deviation); the PR description flags John's pending Epic 1c amendment.

**Out-of-scope deferrals** all preserved verbatim from the story file (polished error-recovery screens → 1.9d; email pre-fill → Epic 1c amendment; auth-route guard → 1.9d; BroadcastChannel cross-tab → 1.9d revisit-trigger; lockout-screen forgot-CTA → 1.9d; `i18n-parity.mjs` namespace coverage → 1.9d; `useLoginBanner` discriminated-union refactor → 1.9d pre-work mandate, with 1.9b shipping the single `bannerKey` selector as scaffolding).

**Test totals delta**: +28 ForgotPasswordPage + ResetPasswordPage page tests (12 + 17) + 8 schema tests (3 + 4 — one extra fired by zod) + 6 mutation hook tests + 4 LoginPage `?reset=1` tests + 2 authKeys factory tests + 1 i18n parity describe block + 2 Playwright bundle-boundary contract = ~50 new test assertions on top of the existing 444-test baseline.

**Chunk-size budget green**: ForgotPasswordPage-*.js = 1.68 KB gzipped; ResetPasswordPage-*.js = 1.88 KB gzipped — both well under the 8 KB ceiling.

**Definition-of-done deferral**: the Definition of Done line "John has filed the Epic 1c AC amendment removing the email-pre-fill requirement" is OUTSIDE this implementation's scope (John's PM filing). PR description flags the pending amendment for John.

### Implementation Plan (summary)

Executed in spec-mandated order (i18n → API → schemas → pages+routes → banner → storybook → catalog/spec → CI):

1. **Task 1** — Added 28 new keys to `en.json` + `vi.json`, appended `STORY_1_9B_KEYS` + describe block to `i18n-parity-coverage.test.ts`. Ran `npm test -- i18n-parity-coverage` (8/8 green) + `npm run i18n-parity` (clean).
2. **Task 2** — Extended `authKeys` with `forgotPasswordMutation` / `resetPasswordMutation` (+4 contract tests). Created `useForgotPassword` + `useResetPassword` mutation hooks (page owns response UX — no onSuccess/onError). Extracted `MSW_FORGOT_PASSWORD_DEFAULT` / `MSW_RESET_PASSWORD_DEFAULT` constants with `satisfies` typecheck. Authored 6 co-located mutation tests.
3. **Task 3** — Created `useForgotPasswordSchema` + `useResetPasswordSchema` builder hooks following the `useRegisterSchema` precedent. Reset schema uses `.refine` on equality with `path: ['confirmPassword']`. 8 schema tests green.
4. **Task 4** — Authored ForgotPasswordPage with two visual modes (form / sent), typo-escape button, resend countdown, sentinel-split bolded-email rendering. Added route entry to `routes.tsx` in the SAME commit. 12 page tests green including the anti-enum coupling regression guard.
5. **Task 5** — Authored ResetPasswordPage with reactive token read via `useSearchParams + useMemo`, RHF `reValidateMode: 'onChange'`, three error-state regions (expired / consumed / invalid), and Link-styled CTAs (no shadcn `asChild`). Added route entry to `routes.tsx`. 17 page tests green including both ATDD specimens.
6. **Task 7** — Refactored LoginPage to single derived `bannerKey` selector with priority `reset > verified > oauth-error`, lazy-init session-cache wipe on `?reset=1`, and the inline checkmark SVG on the reset variant. Renamed the URL-clear effect's scope (drops error / verified / reset). 23/23 LoginPage tests green.
7. **Task 6** — Authored 11 ForgotPasswordPage stories + 9 ResetPasswordPage stories + 1 LoginPage `ResetBanner` variant. Each story has a `play()` assertion locking the right `data-testid` region. `npm run storybook:build` clean.
8. **Task 8** — Bumped `msw-handler-catalog-auth.md` frontmatter `last_updated` + appended Change Log row. Extended `route-bundle-boundaries.spec.ts` with the Story 1-9b boundary contract (4 vacuous-pass guards + 4 cross-chunk leak assertions). 5/5 Playwright tests green.
9. **Task 9** — Full CI matrix: `npm run lint` clean, `npx tsc -b` clean (exit 0), `npm run lint:css` clean, `npm test` 444/445 (1 flake = known lint-fixtures sandbox timeout issue from project memory; passes at 60s testTimeout), `npm run build` clean (chunk budget: 1.68 + 1.88 KB gzipped), `npx playwright test route-bundle-boundaries` 5/5 green, `npm run storybook:build` clean.

## File List

### Added

- `classlite-web/src/features/auth/ForgotPasswordPage.tsx`
- `classlite-web/src/features/auth/ResetPasswordPage.tsx`
- `classlite-web/src/features/auth/LoginPage.stories.tsx` (new — Default + ResetBanner)
- `classlite-web/src/features/auth/ForgotPasswordPage.stories.tsx`
- `classlite-web/src/features/auth/ResetPasswordPage.stories.tsx`
- `classlite-web/src/features/auth/api/forgotPassword.ts`
- `classlite-web/src/features/auth/api/resetPassword.ts`
- `classlite-web/src/features/auth/api/__tests__/forgotPassword.test.tsx`
- `classlite-web/src/features/auth/api/__tests__/resetPassword.test.tsx`
- `classlite-web/src/features/auth/lib/forgotPasswordSchema.ts`
- `classlite-web/src/features/auth/lib/resetPasswordSchema.ts`
- `classlite-web/src/features/auth/lib/__tests__/forgotPasswordSchema.test.tsx`
- `classlite-web/src/features/auth/lib/__tests__/resetPasswordSchema.test.tsx`
- `classlite-web/src/features/auth/__tests__/ForgotPasswordPage.test.tsx`
- `classlite-web/src/features/auth/__tests__/ResetPasswordPage.test.tsx`
- `_bmad-output/implementation-artifacts/1-9b-password-reset-ui-completion-notes.md` (this file)

### Modified

- `classlite-web/src/locales/en.json` — added 28 new keys per AC2.
- `classlite-web/src/locales/vi.json` — added 28 new keys per AC2 (5 Sally rewrites locked in).
- `classlite-web/src/lib/test/__tests__/i18n-parity-coverage.test.ts` — appended `STORY_1_9B_KEYS` + describe block.
- `classlite-web/src/features/auth/api/authKeys.ts` — added `forgotPasswordMutation` + `resetPasswordMutation` factories.
- `classlite-web/src/features/auth/api/__tests__/authKeys.test.ts` — added 4 contract assertions for the new mutation keys.
- `classlite-web/src/test/mocks/handlers.ts` — extracted `MSW_FORGOT_PASSWORD_DEFAULT` + `MSW_RESET_PASSWORD_DEFAULT` constants with `satisfies` typecheck; updated the two default handlers to consume them.
- `classlite-web/src/routes.tsx` — appended `forgot-password` + `reset-password` lazy children to the AuthLayout group.
- `classlite-web/src/features/auth/LoginPage.tsx` — single derived `bannerKey` selector replaces 1-8 `oauthError` + 1-9a `verifiedBanner` slots; session-cache wipe on `?reset=1`; inline checkmark SVG; URL-clear effect scope renamed to cover all three signals.
- `classlite-web/src/features/auth/__tests__/LoginPage.test.tsx` — added 4 Story 1-9b pinned tests (reset banner + checkmark, URL-clear, priority collision, session-cache invalidation).
- `classlite-web/e2e/route-bundle-boundaries.spec.ts` — added Story 1-9b chunk-boundary contract with 4 vacuous-pass guards + 4 cross-chunk leak assertions.
- `_bmad-output/test-artifacts/msw-handler-catalog-auth.md` — bumped `last_updated`; appended Change Log row documenting the satisfies-typed constants extraction.
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — Story 1-9b transitioned ready-for-dev → in-progress → review.
- `_bmad-output/implementation-artifacts/1-9b-password-reset-ui.md` — Status flipped to review; baseline_commit preserved.

### Deleted

_None._
