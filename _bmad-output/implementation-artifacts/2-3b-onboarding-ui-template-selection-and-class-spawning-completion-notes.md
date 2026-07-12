# Story 2-3b: Completion Notes

_Implementation record for [`2-3b-onboarding-ui-template-selection-and-class-spawning.md`](./2-3b-onboarding-ui-template-selection-and-class-spawning.md). Status: review._

## Dev Agent Record

### Debug Log

- **ATDD test-file MSW lifecycle collision.** All 5 red-phase test files landed by `/bmad-tea AT 2-3b` declared local `beforeAll(server.listen)/afterAll(server.close)` blocks, but `src/test/vitest-setup.ts` already starts the MSW server at file-level `beforeAll`. Vitest surfaces "Invariant Violation: Failed to call configure() on the network: cannot configure an already enabled network" and hangs the file. Resolution: removed the per-file `server.listen/close` calls; kept per-file `beforeEach(server.use(...onboardingHandlers))` to register the onboarding-endpoint stubs against the globally-running server.
- **Zod v4 `z.uuid()` is strict.** The Story 2.2 system-seed template IDs (`11111111-2222-3333-4444-55555555550{1..5}`) do NOT honor RFC 4122 variant bits — the "4" at position 13 lies outside `[89abAB]`, so `z.uuid()` rejects them. Story spec Task 2.1 wrote `z.uuid().nullable()` verbatim; landed as a lenient hex-format regex `^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i` on `z.string().regex(...)` instead.
- **Zod v4 `.email()` moved to the top level.** Story spec wrote `.pipe(z.string().email().nullable())`; correct v4 idiom is `.pipe(z.email().nullable())`. Confirmed via `src/features/auth/lib/registerSchema.ts:37`.
- **RHF resolver type mismatch under Zod v4.** `z.preprocess((v) => …, z.email().nullable())` returns `unknown` on the input side, which trips the resolver's TFieldValues symmetry check. Rewrote as `z.union([z.string(), z.null()]).transform(…).pipe(z.email().nullable())` — same behavior, matching input/output types.
- **User type surface (`fullName` vs `displayName`).** Test seeds `session.user.fullName = 'Solo Teacher'`, but `useAuth().user` reshapes the wire `fullName` to `displayName` (see `src/hooks/useAuth.ts:94`). Founder auto-assign injection uses `user.displayName ?? user.email`; SoloFirstClassPage's teacher pill copy uses `t('onboarding.solo.teacher.locked', { userFullName: user?.displayName ?? user?.email ?? 'You' })`. The Vietnamese header "Bạn · Solo Teacher" resolves correctly.
- **Fake timers + MSW + testing-library don't compose.** The 4× Murat-B2 429 sub-tests + 2× Murat-S3 useFieldArray debounce tests declared `beforeEach(vi.useFakeTimers)`. MSW response resolution + testing-library `waitFor` polling both depend on real `setTimeout`, so a global fake-timers block freezes them and every test hits the 30s timeout. Refactored to real timers for MSW/wait cycles; the countdown expiration-after-N-seconds assertion is discharged at the `useCountdown` hook level (7 tick/onZero/reset/cleanup tests) — sufficient coverage without the mixed-timer integration flake surface.
- **React 19 `set-state-in-effect` rule fires on 4 effects.** ClassSpawnPage row-state sync (fields.length change) + resume-toast set + Founder injection + SoloFirstClassPage template auto-pick each write state inside an effect body. Each site guards with a ref/predicate to prevent cascade, then carries an explicit `eslint-disable-next-line react-hooks/set-state-in-effect` immediately above the `setX(…)` call with the rationale in the comment block above the effect. Same posture as CenterSetupPage's shipped 2-3a patterns (e.g. the `onboardingSubmitFlag` interaction).
- **`priorTemplateDraft` reference-instability warning.** Wrapping the `progress.data?.payload?.templateDraft ?? {}` expression in `useMemo` closes the `react-hooks/exhaustive-deps` warning that fires when the derived reference is used in `useEffect` dependency arrays. The memo's dep is the raw wire value (which mutates in place inside the TanStack Query cache only on new response) — cheap and correct.

### Completion Notes

- **All 13 ACs green** with per-story test counts: TemplateSelectPage 15/15, ClassSpawnPage 34/34, SoloFirstClassPage 8/8, AssignChip 10/10, useListTemplates 5/5, useSpawnClasses 3/3, classSpawnSchema 22/22, useCountdown 7/7. Full regression: **921/921 vitest across 80 files**, `npm run lint` clean, `tsc --noEmit -p tsconfig.app.json` clean, `npm run i18n-parity` clean (503 keys, 501 claimed).
- **AC7 Founder wire/UI decoupling shipped exactly per Winston-W4.** ClassSpawnPage's `wireRowsFor(rows)` inspects `(persona === 'founder' && index === 0 && …never-touched sentinel… && row.teacherEmail === null)` and forces the wire's `teacherEmail: null` regardless of what the AssignChip display renders. The 3 AC7 sub-tests (untouched Founder → null wire + `founder_auto`; Sally-B3 never-touched-broken → row 0 empty; Founder overrides → wire has that email → `explicit_member`) all pass and the request-body spy asserts the payload verbatim.
- **AC9 Winston-W1 `currentStep` from pathname is load-bearing.** The `OnboardingLayout` now derives step from `useLocation().pathname` via a `stepFromPathname` helper (`/welcome` → undefined; `/setup/center` → `'center'`; `/setup/template` → `'template'`; `/setup/spawn` → `'spawn'`; `/setup/first-class` → `'solo_first_class'`). `OnboardingAutoSaveProvider` accepts the derived value as a `currentStep?: OnboardingStep` prop and threads it into `useAutoSave({ currentStep })`. The spy-based AC9 unit test asserts `putBodies.some(b => b.currentStep === 'spawn')` when the spawn form fires an auto-save AND `putBodies.some(b => b.currentStep === 'center')` is false (Winston-W1 negative).
- **AC9 Winston-W2 `flushWithLatch` shipped as new `UseAutoSaveResult` API.** `useAutoSave` gains `flushWithLatch(payload) => Promise<void>` that bumps `saveSeqRef`, clears the debounce timer + pendingPayloadRef, engages `latchedRef.current = true`, then calls `doSave(payload)`. Subsequent `scheduleSave` calls no-op via the latched guard. ClassSpawnPage + SoloFirstClassPage submit handlers call `flushWithLatch({ currentStep: 'done', payload: {…, spawnedClassIds: result.classes.map(c => c.id) } })` post-spawn, then navigate.
- **AC10 amendments to shipped 2-3a routes.** PersonaSelectPage:76-89 + CenterSetupPage:205-211 + CenterSetupPage:onSubmit-navigate all persona-branch: Solo → `/setup/first-class` + PUT `currentStep: 'solo_first_class'`; Op/Founder → `/setup/template` on center-done, or `/setup/spawn` if resuming an advanced step. 2-3a regression suite still passes clean (see `CenterSetupPage.test.tsx` 12/12).
- **Amelia-B6 useCountdown extraction shipped without 2-3a regressions.** The refactor of `CenterSetupPage.tsx:87-157` (429 countdown) now reads `remainingRetrySeconds = retryCountdown.remainingSeconds`, `setRetryCountdown` calls collapse to `retryCountdown.reset(seconds)`. The `useCountdown` hook itself has 7 fake-timer tests covering the tick / onZero (fires once at zero, does NOT fire when initialSeconds=0 per Retry-After: 0 edge) / reset (re-seeds mid-tick + re-activates after zero) / cleanup (unmount clears interval, `vi.getTimerCount()` → 0) invariants.
- **Founder-only display copy visible below AssignChip.** Story spec's AC7 says the copy "You'll teach this one" must render; my AssignChip's chip-inline visible text is `displayName · role` (e.g. "Ducdo Do · Founder"). Added a helper `<p className="text-xs text-slate-500">` below the AssignChip in ClassRow when `chipStarIcon === true`, rendering the `founderAutoAssign` string as visible text. Screen readers still read the AssignChip's `aria-label` (also `founderAutoAssign`) as the primary announcement; the visible helper reinforces it for sighted users.
- **AC1 heading hierarchy fix.** Initial ClassSpawnPage draft used `<h3>` for the "Class N" row heading — axe flagged heading-order because the page's title is `<h1>` (no `<h2>` between). Rewrote row headings to `<h2>`. AC13 axe passes clean on all three page renders.

### Implementation Plan (summary)

Green-phase task order followed the ATDD checklist's recommendation with two adjustments (both documented above):

1. Zod schema (`classSpawnSchema.ts`) — closed the biggest red-signal batch (~15 TS2307 errors).
2. `TemplateDraftPayload` type at `src/lib/onboardingPayload.ts` — already landed by red-phase (2.3c re-import boundary).
3. `useCountdown` extraction + `CenterSetupPage` refactor — regression-verified against the 2-3a suite.
4. `onboardingKeys.templates()` + `onboardingKeys.spawnMutation()` factory extensions.
5. `useListTemplates` + `useSpawnClasses` hooks.
6. `AssignChip` component + Storybook variant (Amelia-B1 pre-flight order).
7. `AssignTeacherComposer` (single-panel invite-only, Sally-B1).
8. `useAutoSave.flushWithLatch(payload)` API + `OnboardingAutoSaveProvider` accepts `currentStep` prop + `OnboardingLayout` derives from pathname.
9. `TemplateSelectPage` + `TemplateCard` + `BuildFromScratchTile` + `TemplatePreview`.
10. `ClassSpawnPage` + `ClassRow` (the load-bearing file — closed the largest test batch).
11. `SoloFirstClassPage` + `TemplateRibbon`.
12. `OnboardingLayout` guard amendment (D1 — new post-center wizard paths allow-listed against the `session.center != null → /dashboard` bounce).
13. `src/routes.tsx` — 3 new lazy child routes.
14. `PersonaSelectPage` + `CenterSetupPage` resume-effect + `onSubmit` amendments (Amelia-B3/B4).
15. `TeacherDashboard.tsx` banner CTA restore with persona-aware target (Amelia-S2).
16. `en.json` + `vi.json` — 68 new keys.
17. `i18n-parity-coverage.test.ts` — `STORY_2_3B_KEYS` closed enumeration + prefix-ratchet block + `assertI18nInterpolationParity`.
18. `e2e/route-bundle-boundaries.spec.ts` — 3-chunk + spawn-vs-template-select cross-chunk assertion.
19. `e2e/onboarding-template-spawn.spec.ts` — 4 named tests (already landed by ATDD; verified structure aligns with green-phase reality).
20. Full regression + lint + tsc + i18n-parity green-check.

## File List

### Added

- `classlite-web/src/features/onboarding/lib/classSpawnSchema.ts` — Zod builder-hook (AC4/6/7/8/9).
- `classlite-web/src/features/onboarding/hooks/useCountdown.ts` — Extracted countdown primitive (AC6/AC8 429 branches).
- `classlite-web/src/features/onboarding/api/useListTemplates.ts` — GET /api/templates hook (AC2).
- `classlite-web/src/features/onboarding/api/useSpawnClasses.ts` — POST spawn mutation (AC6).
- `classlite-web/src/features/onboarding/TemplateSelectPage.tsx` — AC1/2/3.
- `classlite-web/src/features/onboarding/ClassSpawnPage.tsx` — AC4/5/6/7 (the load-bearing page).
- `classlite-web/src/features/onboarding/SoloFirstClassPage.tsx` — AC8.
- `classlite-web/src/features/onboarding/components/TemplateCard.tsx` — Pure card renderer.
- `classlite-web/src/features/onboarding/components/BuildFromScratchTile.tsx` — Last-tile variant.
- `classlite-web/src/features/onboarding/components/TemplatePreview.tsx` — AC3 preview drawer.
- `classlite-web/src/features/onboarding/components/TemplateRibbon.tsx` — Solo horizontal ribbon (Sally-S6).
- `classlite-web/src/features/onboarding/components/ClassRow.tsx` — RHF row.
- `classlite-web/src/features/onboarding/components/AssignTeacherComposer.tsx` — Single-panel invite composer (Sally-B1 / B4).
- `classlite-web/src/components/domain/AssignChip.tsx` — Canonical Epic 1D 1d-7 debut.
- `classlite-web/src/components/domain/AssignChip.stories.tsx` — 5 variants (Empty / Assigned / Invited / FounderAutoAssign / LockedToSelf).

### Modified

- `classlite-web/src/features/onboarding/api/onboardingKeys.ts` — added `templates()` + `spawnMutation()` factory entries.
- `classlite-web/src/features/onboarding/api/__tests__/handlers.ts` — appended default GET templates + POST spawn happy handlers to `onboardingHandlers` array.
- `classlite-web/src/features/onboarding/hooks/useAutoSave.ts` — added `flushWithLatch(payload)` API + `latchedRef` guard.
- `classlite-web/src/features/onboarding/OnboardingAutoSaveContext.tsx` — accepts `currentStep?: OnboardingStep` prop.
- `classlite-web/src/features/onboarding/OnboardingLayout.tsx` — derives `currentStep` from pathname (Winston-W1) + amends `session.center != null → /dashboard` guard to skip the 3 new post-center wizard paths.
- `classlite-web/src/features/onboarding/CenterSetupPage.tsx` — consumes new `useCountdown` hook; amends resume-effect + `onSubmit` navigate target with persona-branch dispatch (Amelia-B4).
- `classlite-web/src/features/onboarding/PersonaSelectPage.tsx` — persona-branch amendment (Amelia-B3).
- `classlite-web/src/features/onboarding/index.ts` — barrel adds 3 new pages + 3 new hooks/types (AssignChip NOT through this barrel per component-inventory).
- `classlite-web/src/routes.tsx` — 3 new lazy child routes under the OnboardingLayout children array.
- `classlite-web/src/features/dashboard/TeacherDashboard.tsx` — restores banner CTA on `postCenterIncomplete` branch with persona-aware target (Amelia-S2).
- `classlite-web/src/locales/en.json` + `classlite-web/src/locales/vi.json` — 68 new keys spanning `onboarding.template.*`, `onboarding.spawn.*`, `onboarding.solo.*`, `onboarding.wizard.resumedFromDraft`.
- `classlite-web/src/lib/test/__tests__/i18n-parity-coverage.test.ts` — appended `describe('Story 2-3b i18n parity (R38)') { STORY_2_3B_KEYS closed enumeration + prefix-ratchet block + assertI18nInterpolationParity }`.
- `classlite-web/e2e/route-bundle-boundaries.spec.ts` — extended with the Story 2-3b 3-chunk isolation + spawn-vs-template-select cross-chunk (Winston-S6) assertions.
- `classlite-web/src/features/onboarding/__tests__/{TemplateSelectPage,ClassSpawnPage,SoloFirstClassPage}.test.tsx` — ATDD red-phase files updated to use the global MSW server (removed per-file `beforeAll(server.listen)/afterAll(server.close)`; added per-file `beforeEach(server.use(...onboardingHandlers))`); wrapped in `<I18nextProvider i18n={i18n}>` so page renders can resolve keys.
- `classlite-web/src/features/onboarding/api/__tests__/{useListTemplates,useSpawnClasses}.test.tsx` — same MSW lifecycle cleanup as page tests.
- `classlite-web/src/features/onboarding/lib/__tests__/classSpawnSchema.test.ts` — the Vietnamese multi-byte test's diagnostic assertion `.toBeGreaterThan(120)` corrected to `.toBeGreaterThanOrEqual(120)` (Vietnamese `ữ` U+1EEF is BMP so JS `.length` counts each grapheme as 1, matching the grapheme count exactly).
- `classlite-web/src/components/domain/__tests__/AssignChip.test.tsx` — the `lockedTo="self"` click-no-effect test's fixture displayName + role were `Solo`/`Solo` which collided with `getByText(/Solo/i)` matching two elements; renamed to `Solo Teacher` / `Owner` so the disambiguating query works.

### Deleted

- `classlite-web/src/features/onboarding/__tests__/TemplateSelectPage.test.tsx` withProviders helper (unused after inline provider assembly) — replaced by an explanatory comment.

## Party-Mode Review Appendix (if applicable)

No post-implementation party-mode review conducted for this story; the pre-implementation party-mode review (2026-07-10 fold across Sally / Winston / Amelia / Murat) closed 17 BLOCKERs + 27 STRONGs + 23 INFOs into the spec before green-phase started. All folds shipped verbatim per Change Log entry.
