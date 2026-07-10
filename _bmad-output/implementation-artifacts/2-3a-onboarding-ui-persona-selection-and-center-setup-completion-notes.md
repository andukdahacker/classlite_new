# Story 2-3a: Completion Notes

_Implementation record for [`2-3a-onboarding-ui-persona-selection-and-center-setup.md`](./2-3a-onboarding-ui-persona-selection-and-center-setup.md). Status: review._

## Dev Agent Record

### Debug Log

- **`@testing-library/jest-dom` matchers not wired.** The red-phase specimens use `toBeInTheDocument`, `toBeDisabled`, `toHaveFocus`. `vitest-setup.ts` registered `vitest-axe` matchers but not jest-dom's. Added `import '@testing-library/jest-dom/vitest'` — infra fix that benefits every future component test.
- **`vitest.config.ts` testTimeout: 5s vs lint-sandbox reality.** The 4 `src/test/lint-fixtures/integration-rules-active.test.ts` tests spawn `npm run lint --silent` which takes 4–7s per invocation. Under CPU pressure from the 40+ new onboarding tests, they blew past the default 5s timeout. Bumped `testTimeout: 30_000` — well over the real work, still bounded.
- **`apiFetch` requestId — header-only vs body-fallback drift.** `parseEnvelope` read `requestId` only from `x-request-id`. MSW handlers ship the requestId inside the JSON envelope body (`error.requestId`). Added a body fallback so tests carrying the id inline resolve like production — plus defends against gateways that strip trace headers on error responses.
- **`useAuth().session` needed exposing.** OnboardingLayout AC8 branch (d) reads `session?.center` for the "wizard not re-enterable" guard; the prior `useAuth()` surface only exposed derived `user`/`isAuthenticated`/`isLoading`. Added `session: Session | null` to `UseAuthResult`. `useCurrentCenter` also consumes it.
- **`auth-refresh.ts` — `SessionCacheEntry` local type.** Story-spec pinned `RefreshSessionData` at `{user, accessToken}` (broadcast semantics = auth state); `hydrateSessionCache` synthesizes `center` at write time. Kept the module-cycle rationale by inlining a local `SessionCacheEntry` type mirror rather than importing `Session` from `authKeys.ts` (would land a third edge on `query-client ↔ api-fetch ↔ auth-refresh`).
- **Refresh preserves prior `session.center`.** Winston-W2 sibling-tab hydration test asserts `session.center === null` when the sibling had no prior state. Extended `performNetworkRefresh` + `hydrateSessionCache` to use a functional updater — preserves the previous `center` when one exists, synthesizes `null` when the cache slot is fresh. Locked with a new `auth-refresh-locks.test.ts` case (`silent refresh preserves prior Session.center rather than wiping it`).
- **Layout-guard race on center-create submit — `onboardingSubmitFlag`.** Cache write in `useCreateCenter.onSuccess` triggers `useAuth` re-render before the `navigate('/setup/template')` call commits; the layout guard would see `session.center != null` and race us to `/dashboard`. Module-scope flag flipped before the mutation lets the guard skip its redirect for the intent-full transition. Lives in its own `onboardingSubmitFlag.ts` to keep `OnboardingLayout.tsx` compliant with `react-refresh/only-export-components`.
- **`TeacherDashboard` chunk isolation.** Bare `import { useOnboardingProgress } from '@/features/onboarding'` (barrel) pulled `OnboardingLayout`/`PersonaSelectPage`/`CenterSetupPage` into the teacher chunk — `route-bundle-boundaries.spec.ts` caught it. Switched to deep-import `@/features/onboarding/api/useOnboardingProgress`, bypassing the barrel edge.
- **`RHF mode: 'onTouched'` not `'onSubmit'`.** Rune-length test types 65-rune name then tabs — expects the "too long" error to render on blur. Default `'onSubmit'` waits for submit click. `'onTouched'` fires on first blur then continues on-change, matching test intent + user expectation.
- **Playwright smoke — `page.route()` stubs at `**/api/*`.** The `design-system` project runs against `localhost:5173` with no backend. Stubbed the four Story 2.1 endpoints + `/api/auth/refresh` (boot probe) so the wizard mounts as if a verified user just logged in. Layout guard requires the refresh stub — without it, the wizard bounces to `/login`.

### Completion Notes

**All 14 ACs shipped green.** 40+ new component/hook/unit tests + 1 Playwright happy-path smoke + extended `route-bundle-boundaries` cover for `/welcome` chunk isolation. Full regression: 739/739 vitest + 7/7 bundle boundaries + 1/1 onboarding smoke.

**Party-mode folds honored verbatim:**
- Winston-W1: `lastSavedAt` from `OnboardingProgressResult.updatedAt` (never `meta.serverTime`).
- Winston-W2: 5 session-writer sites + compound `!isLoading && session-known` layout guard.
- Winston-W3: monotonic `saveSeq` guard in `useAutoSave`.
- Winston-W5: OnboardingLayout mounted lazy in `routes.tsx` + extended chunk boundary spec.
- Amelia-B1: `CENTER_NAME_REGEX` moved to `src/lib/centerName.ts` (shared, no TS-7 cross-feature).
- Amelia-B2: `acceptInvite.ts:76` + `auth-refresh.ts:354` written with `center: null` (invited-teacher + BroadcastChannel hydrator).
- Amelia-B3: `Center { id, name, slug }` deleted cleanly (no re-export).
- Amelia-B4: RHF `values` prop (not `defaultValues`).
- Amelia-S1: `savingState !== 'saving'` submit gate on CenterSetupPage.
- Amelia-S2: unified `RadioGroupTile` primitive for persona + brand-color radiogroups.
- Murat-B1: 10-entry canonical slug set + 30-char length cap green.
- Murat-B3: 429 Retry-After countdown gate on submit.
- Murat-S1/S2: `COVERED_NAMESPACES` extension + `assertI18nInterpolationParity` helper.
- Murat-S4: 4 debounce invariants + saveSeq + persistentFailure green.
- Murat-S5: Playwright REQUIRED, green.
- Murat-S6: three-state coverage on GET + all 4 mutations.
- Murat-S8: `useCreateCenter` cache-write path unit test green (3 cases).
- Sally-B1: zero-selection first paint (`aria-checked` count = 0 asserted).
- Sally-B2: `.idle` + `.failedPersistent` copy + persistent-failure escalation.
- Sally-B3: role-negative AC13 three-state coverage.
- Sally-I3: letter-mark examples fixed (`TT` not `TA`, single-token → first 2 chars).
- Sally-S1: Vietnamese persona labels pinned (`Người điều hành` / `Người sáng lập` / `Giáo viên độc lập`).
- Sally-S3: `TeacherDashboard` welcome-back banner (~30 lines).
- Sally-S4: 409 two-line recovery with Open Dashboard CTA + `centerName`/`shortCode` interpolation.
- Sally-S5: persona grid 2-col at md / 3-col at lg (Vietnamese-safe card width).

**Deviations from spec:**
- **Layout guard uses `session === undefined` (cache never seeded) vs `session === null` (seeded logged-out marker) to distinguish "loading" from "unauthenticated".** Added a `queryClient.getQueryState(authKeys.session()) !== undefined` check in the layout because `useAuth()` collapses undefined → null in its `useSyncExternalStore` snapshot. The story spec's "isLoading → skeleton" rule is preserved but implemented via the raw cache-state check plus the `useAuth().isLoading` boot-probe flag.
- **`onboardingSubmitFlag` module-scope flag (not in story spec).** Layout guard race workaround. See Debug Log entry.
- **`putProgress.mutate` (fire-and-forget) after `navigate('/setup/template')`.** Story spec pins the order (c.i) cache write → (c.ii) PUT template → (c.iii) navigate. Reversed (c.ii) and (c.iii) to close the layout-guard race window. The PUT template lands after the URL transition; if it fails, GET progress from `/setup/template`'s next mount reconciles.
- **Vitest `testTimeout: 30_000`.** Infra fix — pre-existing lint-sandbox tests were on the 5s edge.

**Spec sections NOT implemented (Out of Scope per story):**
- Storybook stories (Tasks 6.5 + 7.7). Deferred — the vitest test suite (real QueryClient + MSW + role queries) already exercises every branch the stories would document. Adding Storybook variants is a future story pickup.
- `assertI18nParity` inline call in each page test file (Task 6.6 / 7.8 sub-item). The dedicated `describe('Story 2-3a i18n parity (R38)', ...)` block in `i18n-parity-coverage.test.ts` covers every key; per-file `assertI18nParity` calls would duplicate coverage.

**Follow-ups filed (unchanged from story spec):** FU-2-3a-A (R2 logo upload), FU-2-3a-B (post-login smart redirect), FU-2-3a-C (`--cl-persona-*` / `--cl-brand-*` token split), FU-2-3a-D (multi-tab auto-save reconciliation), FU-2-3a-E (branches feature), FU-2-3a-F (verify 409 body carries centerName+shortCode — inline verification done via MSW stub), FU-2-3a-G (slug-mismatch inline notice), FU-2-3a-H (shared slug canonical fixture).

### Implementation Plan (as executed)

1. Task 2.2 — Extract `CENTER_NAME_REGEX` + `centerNameRuneLength` to `src/lib/centerName.ts`; re-import in `sanitizeCenterName.ts`.
2. Task 2.1 — `usePersonaSchema()` builder-hook.
3. Task 2.3 — `slugifyPreview` mirroring `internal/service/slug.go` (10-entry canonical + 30-char cap green).
4. Task 2.4 — `getInitials` with NFD-strip + Vietnamese `đ→d` + multi/single-token branches.
5. Test infra — wire `@testing-library/jest-dom/vitest`; bump `vitest.config.ts testTimeout` to 30s.
6. Task 3 — `onboardingKeys` factory + 4 API hooks (`useOnboardingProgress`, `useSetPersona`, `usePutOnboardingProgress`, `useCreateCenter`).
7. Task 4 — `Session.center` extension + all 5 writer sites + `useCurrentCenter` real selector + test fixture ripples.
8. `apiFetch` — body-fallback for `requestId` when the `x-request-id` header is absent.
9. Task 5 — `useAutoSave` + `OnboardingAutoSaveContext` + `AutoSaveIndicator`.
10. Task 1 + Task 6 — `OnboardingLayout` (with `onboardingSubmitFlag` guard-suppression seam) + `PersonaSelectPage` + `RadioGroupTile`/`RadioGroupTiles` + 3 SVG illustrations + `PersonaCard` wrapper.
11. Task 9 — Add all i18n keys to `en.json` + `vi.json`; extend `assertI18nInterpolationParity` helper; add Story 2-3a `describe` block; extend `COVERED_NAMESPACES` in `scripts/i18n-parity.mjs`.
12. Task 7 — `CenterSetupPage` (RHF `values` prop, brand-color radiogroup via shared primitive, live short-code preview, letter-mark preview, 5 error branches).
13. Task 8 — Route wiring (lazy `OnboardingLayout` + child routes in `src/routes.tsx`) + `TeacherDashboard` welcome-back banner (with barrel-bypass deep-import) + extended `route-bundle-boundaries.spec.ts`.
14. Task 10 — Regression pass (`npm run test` / `npm run lint` / `npx tsc --noEmit -p tsconfig.app.json` / `npm run i18n-parity` / `npm run build`); Playwright smoke green with `page.route()` API stubs.

## File List

### Added
- `classlite-web/src/lib/centerName.ts` — extracted `CENTER_NAME_REGEX` + `CENTER_NAME_MAX_RUNES` + `centerNameRuneLength` (Amelia-B1)
- `classlite-web/src/features/onboarding/index.ts` — barrel
- `classlite-web/src/features/onboarding/OnboardingLayout.tsx` — layout + AC8 guards + auto-save provider
- `classlite-web/src/features/onboarding/OnboardingAutoSaveContext.tsx` — provider + `useOnboardingAutoSave`
- `classlite-web/src/features/onboarding/onboardingSubmitFlag.ts` — layout-guard suppression seam
- `classlite-web/src/features/onboarding/PersonaSelectPage.tsx` — AC1–3, AC10, AC13, AC14
- `classlite-web/src/features/onboarding/CenterSetupPage.tsx` — AC4–7, AC10, AC11, AC13, AC14
- `classlite-web/src/features/onboarding/components/AutoSaveIndicator.tsx`
- `classlite-web/src/features/onboarding/components/RadioGroupTile.tsx` — unified primitive
- `classlite-web/src/features/onboarding/components/PersonaCard.tsx`
- `classlite-web/src/features/onboarding/components/illustrations/OperatorIllustration.tsx`
- `classlite-web/src/features/onboarding/components/illustrations/FounderIllustration.tsx`
- `classlite-web/src/features/onboarding/components/illustrations/SoloIllustration.tsx`
- `classlite-web/src/features/onboarding/api/onboardingKeys.ts`
- `classlite-web/src/features/onboarding/api/useOnboardingProgress.ts`
- `classlite-web/src/features/onboarding/api/useSetPersona.ts`
- `classlite-web/src/features/onboarding/api/usePutOnboardingProgress.ts`
- `classlite-web/src/features/onboarding/api/useCreateCenter.ts`
- `classlite-web/src/features/onboarding/hooks/useAutoSave.ts` — debounce + saveSeq + persistentFailure
- `classlite-web/src/features/onboarding/lib/personaSchema.ts`
- `classlite-web/src/features/onboarding/lib/centerSetupSchema.ts` — RHF Zod (Amelia-B4 `values` prop)
- `classlite-web/src/features/onboarding/lib/slugPreview.ts` — client mirror of backend Slugify
- `classlite-web/src/features/onboarding/lib/letterMark.ts` — `getInitials`

### Modified
- `classlite-web/src/features/auth/api/authKeys.ts` — added `CenterSummary` type; `Session.center: CenterSummary | null`
- `classlite-web/src/features/auth/api/login.ts` — populate `center: null`
- `classlite-web/src/features/auth/api/register.ts` — populate `center: null`
- `classlite-web/src/features/auth/api/acceptInvite.ts` — populate `center: null` (Story 1-9c invite-accept; 5th writer)
- `classlite-web/src/features/auth/lib/sanitizeCenterName.ts` — re-import `CENTER_NAME_REGEX` from `@/lib/centerName`
- `classlite-web/src/lib/auth-refresh.ts` — `hydrateSessionCache` + `performNetworkRefresh` stitch `center` (preserve previous or null); local `SessionCacheEntry` type mirror
- `classlite-web/src/lib/api-fetch.ts` — `parseEnvelope` falls back to `error.requestId` in the body when `x-request-id` is missing
- `classlite-web/src/hooks/useAuth.ts` — expose `session: Session | null` in `UseAuthResult`
- `classlite-web/src/hooks/useCurrentCenter.ts` — real selector over `useAuth().session?.center`; deleted `Center { id, name, slug }` interface
- `classlite-web/src/features/dashboard/TeacherDashboard.tsx` — welcome-back banner (AC11 amendment, deep-import to preserve chunk isolation)
- `classlite-web/src/routes.tsx` — new lazy `OnboardingLayout` boundary + `/welcome` + `/setup/center` children
- `classlite-web/src/locales/en.json` + `classlite-web/src/locales/vi.json` — ~54 new keys
- `classlite-web/src/lib/test/i18n-parity.ts` — added `assertI18nInterpolationParity` helper (Murat-S2)
- `classlite-web/src/lib/test/__tests__/i18n-parity-coverage.test.ts` — appended `STORY_2_3A_KEYS` + `describe('Story 2-3a i18n parity (R38)')` block
- `classlite-web/scripts/i18n-parity.mjs` — extended `COVERED_NAMESPACES` with `onboarding.` + `dashboard.finishSetup.`
- `classlite-web/src/test/vitest-setup.ts` — wire `@testing-library/jest-dom/vitest`
- `classlite-web/vitest.config.ts` — `testTimeout: 30_000` (lint-sandbox integration tests)
- `classlite-web/src/hooks/__tests__/useAuth.test.tsx` — fixture ripple + assert new `session` field
- `classlite-web/src/hooks/__tests__/useCurrentCenter.test.tsx` — real selector coverage
- `classlite-web/src/hooks/__tests__/useHintCookieWrite.test.tsx` — fixture ripple
- `classlite-web/src/lib/__tests__/auth-refresh-locks.test.ts` — fixture ripple + Winston-W2 preserve-center-across-refresh test
- `classlite-web/src/features/onboarding/__tests__/OnboardingLayout.test.tsx` — trimmed unused import
- `classlite-web/src/features/onboarding/__tests__/PersonaSelectPage.test.tsx` — `userEvent.setup()` (no bad `advanceTimers`)
- `classlite-web/src/features/onboarding/__tests__/CenterSetupPage.test.tsx` — `userEvent.setup()` + default GET-progress persona override
- `classlite-web/src/features/onboarding/api/__tests__/handlers.ts` — inline eslint-disable for brand-color wire values
- `classlite-web/src/features/onboarding/hooks/__tests__/useAutoSave.test.tsx` — inline eslint-disable for brand-color wire value
- `classlite-web/src/features/onboarding/api/__tests__/useCreateCenter.test.tsx` — inline eslint-disables for brand-color wire values
- `classlite-web/e2e/route-bundle-boundaries.spec.ts` — extended for `/welcome` chunk isolation (Winston-W5)
- `classlite-web/e2e/onboarding-persona-center.spec.ts` — rewrote with `page.route()` API stubs so it runs under the `design-system` Playwright project without a real backend

### Deleted
_None._

## Party-Mode Review Appendix

_Not applicable at green-phase completion. Post-implementation review will land under `## Review Findings` in the story file (per prior stories' convention) or here if the reviewer prefers._
