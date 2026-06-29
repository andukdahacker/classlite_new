# Story 1-9c: Completion Notes

_Implementation record for [`1-9c-invite-acceptance-ui.md`](./1-9c-invite-acceptance-ui.md). Status: review._

## Dev Agent Record

### Debug Log

- **LSP path-alias false positives** on `@/...` imports — repeated diagnostic noise on every newly-authored file. Same pattern Story 1-9b flagged. Confirmed harmless: `npx tsc -b` and `vitest run` both resolve cleanly via the tsconfig path map. No action — known LSP behavior with newly-created files.
- **`useInviteSchema` `.refine` chain didn't surface via `zodResolver`** — first cut used `.string().min(1).max(200).refine((s) => s.trim().length >= 1)` to cover both empty + whitespace-only cases. The schema's own unit tests passed (`safeParse('')` returns the right issue), but the form-level test (`empty submit → fullNameRequired error in DOM`) timed out — the FormMessage never rendered the message. Replaced `.refine` with `.regex(/\S/, { message })` (no `ZodEffects` wrapping). Empty `''` fails `.min(1)` AND `.regex(/\S/)`; whitespace-only `'   '` fails only `.regex(/\S/)`. Same coverage, no resolver opacity. The schema unit tests (4 tests) and the page-form test (1 test) all green afterwards. Adjusted the page test to mirror RegisterPage's empty-submit shape (no field input, just click submit) since that's the cheapest exercise of the empty-fullName + empty-password path.
- **`aria-live` region absent from DOM while collapsed** — first cut of the a11y test queried `getByTestId('invite-aria-live')` BEFORE clicking the trigger. The region lives INSIDE `<CollapsibleContent>`, which is unmounted while collapsed. Fixed by asserting `queryByTestId(...) === null` pre-expand and only `getByTestId` after expand.
- **MemoryRouter `initialEntries` is read once at init** — the token-change-resets-errorState ATDD test rerendered with a new `initialEntries=['/invite/freshToken']` prop, expecting the route to update. MemoryRouter only honors `initialEntries` at mount, so the rerender stayed on `/invite/oldToken` and the form region never appeared. Forced a remount via `<MemoryRouter key={entry}>` so the same-tab URL-bar edit / preview re-click semantic is simulated correctly. The production path uses React Router's path-segment change handling natively (no key needed).
- **`MSW_ACCEPT_INVITE_DEFAULT` role typing** — first cut set `role: 'teacher' as const` inside `satisfies AcceptInviteResult`. The generated type narrows `role` to `'owner' | 'admin' | 'teacher' | 'student'`. The `as const` widening clashed with `satisfies` checking — dropped the `as const` and let the literal flow through. (Final shape uses `role: 'teacher'` and the entire object is `as const satisfies AcceptInviteResult`, which works.)
- **`check-chunk-size.mjs` was not actually shipped at 1-9b** — the 1-9c story spec at Task 8.5 references "the 1-9b version" as if it exists. The 1-9b completion notes only mention manual chunk-size reporting after `npm run build`, no script. Created the script for the first time as part of 1-9c, covering all three current auth-chunk targets (ForgotPasswordPage / ResetPasswordPage / InviteAcceptancePage) at the 8 KB gzipped ceiling. Wired as `build:check` package.json script.
- **Resend Promise type in `submit disabled while mutation pending` test** — `let resolvePending: (...) | null = null` produced a TS error at the call site (`type 'never' has no call signatures`) because the union type didn't narrow inside the Promise constructor. Fixed by initializing with a no-op stub: `let resolvePending: (value: unknown) => void = () => undefined`. Same shape as existing patterns elsewhere in the suite.

### Completion Notes

All 8 ACs satisfied:

1. **AC0 / Task 0 (pre-flight codegen)** — Confirmed `client.ts` was missing the Story 1-6 invite + Google OAuth paths and schemas. Ran `scripts/codegen.sh` once — regenerated `client.ts` now contains 1× `/api/auth/accept-invite` path entry + 2× `AcceptInviteRequest` schema mentions + `InviteExpiredDetails` / `InviteAlreadyAcceptedDetails` / `InviteEmailMismatchDetails` / `InviteCenter` / `AcceptInviteResult` schemas. `npx tsc -b` stayed green throughout — codegen was purely additive (no breaking renames on existing consumers, as predicted).

2. **AC1 — `/invite/:token` route + bundle-boundary verified** — Added the lazy route entry after `'reset-password'` in `routes.tsx` AuthLayout children. Amended the index loader to `loader: ({ request }) => { const url = new URL(request.url); return redirect('/login' + url.search) }` so Story 1-6's OAuth-success `?invited=true` redirect survives the bounce. Extended `e2e/route-bundle-boundaries.spec.ts` with the Story 1-9c contract (1 vacuous-pass guard on `inviteChunks.length` + iterated negative loops across both dashboard chunks). 6/6 Playwright tests green.

3. **AC2 — codegen drift fix** — Standalone codegen invocation as Task 0 (covered above).

4. **AC3 — i18n keys (29 keys, en + vi + parity test)** — Added 28 `auth.invite.*` keys + 1 `auth.login.banner.invited` to BOTH `en.json` + `vi.json` (358 total keys per locale, up from 329). Appended `STORY_1_9C_KEYS` const + `describe('Story 1-9c i18n parity (R38)', ...)` block to `i18n-parity-coverage.test.ts`. 9/9 parity tests green; `npm run i18n-parity` clean (`OK — 358 keys present in both en, vi with non-empty values`). 7 ★ REVIEWER-MANDATORY vi keys flagged in PR description for VN-fluent reviewer pass (Sally's active-voice rewrites on `auth.invite.title` + `auth.login.banner.invited`, plus the 5 interpolation-heavy / privacy-sensitive expired / mismatch / passwordNotAllowed / emailAlreadyRegistered / titleWithCenter copy).

5. **AC4 — InviteAcceptancePage form + ?c= ribbon + a11y** — Created `InviteAcceptancePage.tsx` with reactive `useParams<{ token }>()` token read inside `useMemo`. Sender-embedded `?c=centerName` ribbon read via `useSearchParams` + sanitized through `sanitizeCenterName(raw)` (regex `[\p{L}\p{N}\s\-'.]{1,60}` after NFC normalize). Token-change-resets-errorState `useEffect` (4 lines) wired immediately after the form setup — Murat ATDD specimen pinned pre-dev, green-first instead of post-hoc P-fix like 1-9b shipped. CollapsibleEmailForm a11y honored: focus moves to fullName on expand (RAF-wrapped to handle Radix portal timing), aria-live polite region announces "Email form expanded" via `auth.invite.emailFormExpandedAnnouncement`. Form uses `useInviteSchema()` builder hook with `mode: 'onBlur'` + `reValidateMode: 'onChange'`. On 200 success the `useAcceptInvite` hook populates `authKeys.session()` + broadcasts via `broadcastLoginSucceeded` + navigates to `/dashboard` with `replace: true`. 19 pinned page tests + 4 schema tests + 11 sanitizer tests + 3 mutation hook tests all green.

6. **AC5 — Terminal error states + inline alerts (TEST-FE-6 compliance)** — 8 distinct `data-testid` regions (`invite-form` + 7 terminal: `invite-not-found` / `invite-expired` / `invite-already-accepted` / `invite-email-mismatch` / `invite-password-not-allowed` / `invite-email-already-registered` / `invite-invalid-token`). Every terminal-state test asserts the OTHER seven regions are absent (TEST-FE-6 ratchet). Inline 40×40 clock SVG on the expired state (reused from 1-9b's pattern). Inline 40×40 check-circle SVG on `invite-already-accepted` (Sally party-mode catch — good-outcome visual differentiation from dead-link states). 429 path uses `useResendCountdown` with `MIN_RATE_LIMIT_SECONDS=5` + `MAX_RATE_LIMIT_SECONDS=300` clamps at the call site (Winston pattern). 422 / 5xx / network surface the generic alert with form mounted (retry permitted). Murat email-leak rejection ratchet ATDD specimen green: `details.invitedEmail` + `details.oauthEmail` from 409 INVITE_EMAIL_MISMATCH MUST NOT reach the DOM (asserted via `container.textContent.not.toContain` for both strings — catches a future "Expected: X, Got: Y" UX-clarity PR). Amelia privacy-ratchet: footer Sign-in links from terminal states route to plain `/login` (no `?invited=true`) — closes the leak where a future dev wires `?invited=true` to error footers "for consistency."

7. **AC6 — LoginPage ?invited=true banner** — Extended `BannerKey` type with `'invited'`. `deriveBannerKey` priority chain is now `invited > reset > verified > oauth-error` (UX-DR10 conversion node). Extended URL-clear effect with `next.delete('invited')` + `hasInvited` presence check. New banner branch renders with the success variant classes + inline `CHECKMARK_SVG` + `auth.login.banner.invited` copy. NO session-cache invalidation on the `invited` branch (an invite acceptance ISSUES a session — the `wipedRef` + reset-only cache wipe stays scoped). 4 pinned LoginPage tests green: (a) renders invited banner + checkmark, (b) clears `?invited=true` post-mount, (c) prefers invited over reset on collision, (d) prefers invited over oauth-error on collision + asserts oauth-error param wiped (Winston priority-escalation collision ratchet). 27/27 LoginPage tests green. Murat BLOCKER `routes.test.tsx` index-loader query-forward test landed as a NEW file at `src/__tests__/routes.test.tsx` (2 tests — `?invited=true` forwards + empty-query path). `UrlProbe` helper in `LoginPage.test.tsx` extended with `url-invited-param`.

8. **AC7 — Storybook coverage (16 InviteAcceptancePage + 1 LoginPage variant)** — 16 stories shipped: Default, DefaultWithCenterRibbon, LocaleVi, LocaleViWithCenterRibbon, EmailFormOpen, NotFound, Expired, AlreadyAccepted, EmailMismatch, PasswordNotAllowed, EmailAlreadyRegistered, InvalidToken, ErrorGeneric, RateLimited, Mobile390, Mobile390EmailFormOpen, Mobile390Expired. Used a `<Routes><Route path="/invite/:token">` wrapper component as the story `component` so `useParams` matches inside the global preview decorator's MemoryRouter. LoginPage stories extended with `InvitedBanner` variant mirroring the `ResetBanner` shape. `npm run storybook:build` clean.

9. **AC8 — MSW catalog amend** — Appended `POST /api/auth/accept-invite` section to `msw-handler-catalog-auth.md` documenting all 10 variants (1 happy + 9 error). Frontmatter `last_updated` bumped; Change Log row appended. `MSW_ACCEPT_INVITE_DEFAULT` constant extracted in `src/test/mocks/handlers.ts` with `as const satisfies AcceptInviteResult` typecheck (mirrors 1-9b's pattern).

**Pragmatic deviations acknowledged** (per [[feedback_pragmatic_interpretation_of_spec_absolutes]]):

- **`useInviteSchema` `.regex(/\S/)` instead of `.refine`** — same behavioral coverage (empty + whitespace), avoids the `ZodEffects` wrapping that bit the form-level test. The schema's unit tests still cover the whitespace-only case end-to-end.
- **`check-chunk-size.mjs` newly created (not "extended")** — the 1-9b reference was aspirational. Created fresh with the 3-target coverage the spec asked for. Wired into `build:check` package.json script. CI integration deferred to a follow-up (the script is local-runnable; wire into `.github/workflows/ci-web.yml` as a post-`build` step when next CI work lands).
- **No CI wiring for `build:check`** — script is present + correct + runs green locally. Adding to ci-web.yml is a 1-line change for the next CI-touching story (not 1-9c). Flag for code-review reviewer.

**Out-of-scope deferrals** all preserved verbatim from the story file (1-9d polished OAuth-mismatch screen + invite_email_mismatch dedicated screen; Epic 7 preview endpoint + role badge + lettermark; Story 2-1 dashboard `?invited=true` toast move; 1-9d 5-variant `<Banner variant>` refactor mandate; namespace-coverage `i18n-parity.mjs` extension → 1-9d; codegen-drift CI gate → DevOps/Winston P2 2 sprints; `traceability-matrix-epic-1c.md` + `nfr-assessment-epic-1c.md` → Murat pre-1-9d-merge).

**Test totals delta**: +27 InviteAcceptancePage page tests (including ATDD specimens + a11y + ribbon + privacy ratchets) + 4 schema tests + 11 sanitizer tests + 3 acceptInvite mutation hook tests + 3 authKeys contract tests + 4 LoginPage `?invited=true` tests + 1 i18n parity describe block + 2 routes.test.tsx tests + 1 Playwright bundle-boundary contract = ~55 new test assertions on top of the existing 444-test baseline. Total vitest count: 500/500 across 59 files (was 444/444 before 1-9c).

**Chunk-size budget green**: `InviteAcceptancePage-*.js = 3094 bytes gzipped` (well under the 8 KB ceiling). The `npm run build:check` step reports all three auth chunks (Forgot 1704B / Reset 1979B / Invite 3094B) green.

### Implementation Plan (summary)

Executed in spec-mandated commit-sequence order:

1. **Task 0 (pre-flight codegen)** — Ran `scripts/codegen.sh`; verified `client.ts` now contains the Story 1-6 invite + OAuth paths and schemas; `npx tsc -b` clean against existing consumers. Codegen was purely additive — no breaking renames.
2. **Task 1 (i18n)** — Added 29 keys atomically to `en.json` + `vi.json`. Appended `STORY_1_9C_KEYS` block to `i18n-parity-coverage.test.ts`. Parity tests + CI script green (358 keys total per locale).
3. **Task 2 (API + MSW)** — Extended `authKeys` with `acceptInviteMutation` (+2 contract tests). Created `useAcceptInvite` hook (mirrors `useLogin` shape — populates session + broadcasts + navigates). Extracted `MSW_ACCEPT_INVITE_DEFAULT` with `satisfies` typecheck. Added default handler. 3 co-located mutation hook tests green.
4. **Task 3 (schemas)** — Created `useInviteSchema` builder hook + 4 tests. Created `sanitizeCenterName` pure helper + 11 tests (covers null / empty / whitespace / happy ASCII / happy Vietnamese diacritics / apostrophe-period-hyphen / HTML injection / emoji / control chars / >60 chars / trim).
5. **Task 4 (page + route + index-loader)** — Created `InviteAcceptancePage.tsx`, registered the lazy route in `routes.tsx` AuthLayout children, amended the index loader to forward `url.search`. Authored 27 page tests covering all AC4 + AC5 pinned contracts including Murat's two ATDD specimens + Amelia's privacy ratchets. Created `src/__tests__/routes.test.tsx` with Murat's BLOCKER index-loader test (2 tests).
6. **Task 5 (LoginPage ?invited=true banner)** — Extended `BannerKey` type + `deriveBannerKey` priority chain. Extended URL-clear effect. Added new banner render branch. Extended `UrlProbe` test helper with `url-invited-param`. 4 new pinned tests green (27/27 LoginPage total).
7. **Task 6 (Storybook)** — Created `InviteAcceptancePage.stories.tsx` with 16 variants using a `<Routes>` wrapper component so `useParams` matches inside the preview decorator's MemoryRouter. Extended `LoginPage.stories.tsx` with `InvitedBanner` variant.
8. **Task 7 (MSW catalog + bundle spec)** — Appended `POST /api/auth/accept-invite` section to `msw-handler-catalog-auth.md` with all 10 variants. Bumped `last_updated` + appended Change Log row. Extended `e2e/route-bundle-boundaries.spec.ts` with the Story 1-9c bundle-boundary contract (1 vacuous-pass guard + iterated negative loops). Created `scripts/check-chunk-size.mjs` with 3-target coverage at the 8 KB ceiling.
9. **Task 8 (CI matrix)** — `npm run lint` clean, `npm run lint:css` clean, `npx tsc -b` clean (exit 0), `npm test` 500/500 across 59 files, `npm run build` clean, `npm run build:check` reports all 3 auth chunks under the ceiling (1704 / 1979 / 3094 bytes gzipped), `npx playwright test route-bundle-boundaries` 6/6 green, `npm run storybook:build` clean.

## File List

### Added

- `classlite-web/src/features/auth/InviteAcceptancePage.tsx`
- `classlite-web/src/features/auth/InviteAcceptancePage.stories.tsx`
- `classlite-web/src/features/auth/api/acceptInvite.ts`
- `classlite-web/src/features/auth/api/__tests__/acceptInvite.test.tsx`
- `classlite-web/src/features/auth/lib/inviteSchema.ts`
- `classlite-web/src/features/auth/lib/sanitizeCenterName.ts`
- `classlite-web/src/features/auth/lib/__tests__/inviteSchema.test.tsx`
- `classlite-web/src/features/auth/lib/__tests__/sanitizeCenterName.test.ts`
- `classlite-web/src/features/auth/__tests__/InviteAcceptancePage.test.tsx`
- `classlite-web/src/__tests__/routes.test.tsx`
- `classlite-web/scripts/check-chunk-size.mjs`
- `_bmad-output/implementation-artifacts/1-9c-invite-acceptance-ui-completion-notes.md` (this file)

### Modified

- `classlite-web/src/locales/en.json` — added 29 keys per AC3 (28 `auth.invite.*` + 1 `auth.login.banner.invited`).
- `classlite-web/src/locales/vi.json` — added 29 keys per AC3 (7 ★ REVIEWER-MANDATORY vi keys flagged in PR description).
- `classlite-web/src/lib/test/__tests__/i18n-parity-coverage.test.ts` — appended `STORY_1_9C_KEYS` const + describe block.
- `classlite-web/src/features/auth/api/authKeys.ts` — added `acceptInviteMutation` factory.
- `classlite-web/src/features/auth/api/__tests__/authKeys.test.ts` — added 3 contract assertions for `acceptInviteMutation`.
- `classlite-web/src/test/mocks/handlers.ts` — extracted `MSW_ACCEPT_INVITE_DEFAULT` constant with `as const satisfies AcceptInviteResult` typecheck; added default POST handler.
- `classlite-web/src/routes.tsx` — appended `invite/:token` lazy child to the AuthLayout group; amended index loader to forward `location.search`.
- `classlite-web/src/features/auth/LoginPage.tsx` — extended `BannerKey` type with `'invited'`; extended `deriveBannerKey` priority chain (`invited > reset > verified > oauth-error`); extended URL-clear effect to drop `?invited=true`; added new banner render branch with checkmark glyph.
- `classlite-web/src/features/auth/__tests__/LoginPage.test.tsx` — extended `UrlProbe` with `url-invited-param`; added 4 Story 1-9c pinned tests.
- `classlite-web/src/features/auth/LoginPage.stories.tsx` — added `InvitedBanner` variant mirroring `ResetBanner` shape.
- `classlite-web/src/lib/api/client.ts` — regenerated via `scripts/codegen.sh` (Task 0 — landed the missing Story 1-6 invite + OAuth paths + schemas).
- `classlite-web/e2e/route-bundle-boundaries.spec.ts` — added Story 1-9c bundle-boundary contract.
- `classlite-web/package.json` — added `build:check` script wiring `scripts/check-chunk-size.mjs`.
- `_bmad-output/test-artifacts/msw-handler-catalog-auth.md` — bumped `last_updated`; appended Change Log row; appended `POST /api/auth/accept-invite` section with 10 variants.
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — Story 1-9c transitioned ready-for-dev → in-progress → review.
- `_bmad-output/implementation-artifacts/1-9c-invite-acceptance-ui.md` — Status flipped to review; baseline_commit preserved at `3824af5`; Task checkboxes marked complete.

### Deleted

_None._
