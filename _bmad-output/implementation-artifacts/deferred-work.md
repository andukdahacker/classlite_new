# Deferred Work

## Deferred from: code review of story-2-5b (2026-07-15)

- **CR-2-5B-1** — DisallowUnknownFields + JSON UnmarshalTypeError → 422 field-level for all settings handlers. Currently `decodeSettingsJSONBody` swallows type errors as generic "invalid JSON" and accepts extra fields. Same pre-existing gap as CR-2-5A-3 (2-5a) — worth a dedicated cross-handler pass. Priority: **P3**.
- **CR-2-5B-2** — SEC-1 role revalidation on mutating operations. All 2-5b mutating routes (POST/PATCH/DELETE × terms/holidays/rooms — 9 endpoints) trust JWT `role` claim via `RequireRole("owner")` middleware; a revoked owner's still-valid JWT (up to 15-min TTL) can still mutate. Project-wide gap documented as EDGE-2. Fix requires per-request `userStore.GetByID` in service layer. Priority: **P2**.
- **CR-2-5B-3** — Backend error-mapper i18n. `ROOM_NAME_TAKEN` mapper emits hardcoded English "A room with this name already exists in this center." + English `details[0].message`. Frontend discriminates on `code` so cosmetic-only in the happy path, but breaks non-English direct-API consumers. Broader fix should i18n every mapped error message via `Accept-Language` header resolution. Priority: **P4**.
- **CR-2-5B-4** — `TermCalendarTab.tsx` currently at 660 lines (added ~185 for P1 SaveErrorAlert helpers), exceeding the 600-line convention. This is the FU-2-5b-B activation trigger. Extract dialogs + rows to standalone files in a follow-up. Priority: **P3** (bumped from P4).
- **FU-2-5b-F** — Client-side term overlap advisory warning (AC16 test-coverage bullet). Copy key `settings.terms.overlapAdvisory` was shipped in en+vi + STORY_2_5B_KEYS at green-phase but removed at code review Round 1 D3 (keeping dead copy in parity is misleading). Implement in the TermFormDialog: on submit, if any existing term's date range intersects the new range, render a warning banner (non-blocking — save still succeeds). Owner may proceed knowingly. Priority: **P4**.

## Deferred from: green-phase of story-2-5b (2026-07-15)

- **FU-2-5b-A** — Flaky vitest `RoomsTab.test.tsx > AC5 CRUD via shadcn Dialog > capacity outside 1..500 surfaces inline Zod error`. `roomSchema` DOES enforce `.number().int().min(1).max(500)` with the `settings.rooms.form.capacity.errors.range` copy on all four Zod branches; the failure appears to be in the jsdom + userEvent + RHF `valueAsNumber` sequence not stabilizing the field state before `waitFor` fires. Manual browser test confirms the range validation renders correctly. Retry at code-review time with `fireEvent.change` or `screen.debug()`. Priority: **P4**.
- **FU-2-5b-B** — Component extraction (7 files): `TermFormDialog`, `HolidayFormDialog`, `RoomFormDialog`, `TermRow`, `HolidayRow`, `RoomRow`, `DeleteConfirmDialog` currently inlined into `TermCalendarTab.tsx` / `RoomsTab.tsx`. Story spec's file inventory lists 7 separate component files. Extract when a third consumer emerges or if the parent files cross the 600-line convention threshold. Priority: **P4**.
- **FU-2-5b-C** — Per-hook unit tests: `useTerms.test.ts` / `useMutateTerm.test.ts` (and holiday/room variants) folded into tab tests. The tab tests already exercise mutation optimistic triple + cache invalidation flows end-to-end via MSW. Add separate hook tests only if a hook grows non-CRUD logic (WebSocket integration, cross-sibling optimistic reconciliation). Priority: **P4**.
- **FU-2-5b-D** — Storybook variants for `TermCalendarTab` + `RoomsTab` (≥3 each per DoD-6) — deferred to Round 1 code review, mirrors Story 2-5a's P4 fold pattern. Priority: **P3**.
- **FU-2-5b-E** — Playwright smoke for full CRUD flow — session-cache seeding still outstanding per FU-2-4-J; blocked on infra not this story. Priority: **P3**.

## Deferred from: code review of story-2-3c Chunk 1 (2026-07-12)

- R1-C1-W1 Storybook `CENTER` fixture `brandColor: '#1e3a8a' as string | null` with `eslint-disable no-restricted-syntax` comment (`classlite-web/src/features/onboarding/OnboardingDonePage.stories.tsx:445-446`) — fixture-side smell; upstream type or lint rule needs tightening but low impact.
- R1-C1-W2 `type Persona = DoneHeroPersona` alias conflates wizard-level and display-component persona unions (`classlite-web/src/features/onboarding/OnboardingDonePage.tsx:51`) — cleaner with explicit narrowing at render boundary. Nice-to-have.
- R1-C1-W3 Storybook missing dedicated resume-routing variants for Branch 1 (persona null → /welcome), Branch 2 (session.center null → /setup/center), Branch 3 (currentStep not done → step-specific) — enumerated ladder states never visually reviewed. Test-side already covers M-B2's 12-permutation `test.each`.
- R1-C1-W4 `seedAuthenticatedSession` Storybook helper may not set `emailVerified: true` + `accessToken` cleanly for cold-cache first-render — could bounce to /login before boot-probe warms cache (`classlite-web/src/features/onboarding/OnboardingDonePage.stories.tsx:451-470`). Storybook-only concern.
- R1-C1-W5 [Subsumed by P23] `step === 'persona'` corrupt-state routing folded into P23's "route to /welcome for logically-impossible persona × step combos" patch after D2 resolution.
- R1-C1-W6 [FU-2-3c-E filed] SetupIncompleteAlert "Try again" (branch 4) extension to the 3-attempt persistent-failure ratchet (`classlite-web/src/features/onboarding/OnboardingDonePage.tsx:117-148, 359-368`) — AC9/M-B3 scope ratchet to isError only. Revisit if telemetry shows setup-incomplete retry loops.
- R1-C1-W7 [FU-2-3c-F filed, reclassified from P11] Type assertions `as { persona: Persona | null; currentStep: CurrentStep }` on `progress.data` (`classlite-web/src/features/onboarding/OnboardingDonePage.tsx:253-256, 336-342`) — full fix requires narrowing `useOnboardingProgress` return type via generated OpenAPI types + a hook-level generic parameter; out of scope for this chunk.

## Deferred from: code review of story-2-3c Chunk 2 (2026-07-12)

- R1-C2-W1 [FU-2-3c-G filed] `AutoSaveIndicator` visibility guard is an inverted exclude-list (`classlite-web/src/features/onboarding/OnboardingLayout.tsx:212-215`) — cleaner model derives from `stepFromPathname()` result. Every future non-form route silently reintroduces the misleading indicator. Architectural refactor, low priority.
- R1-C2-W2 [FU-2-3c-H filed] `TemplateSelectPage.tsx` "Save and finish later" placement — when `TemplatePreview` renders (template selected), the effective Continue CTA lives INSIDE `<TemplatePreview>`, so the affordance sits below the preview drawer instead of `mt-3` under the actual CTA. Fix requires refactoring `TemplatePreview` to receive footer content OR duplicating the affordance.
- R1-C2-W3 Vietnamese subtitle keys don't personalize with `{{centerName}}` (`classlite-web/src/locales/vi.json:522-524`) — English title does personalize; not required by spec but potential future polish.
- R1-C2-W4 [FU-2-3c-I filed] Path-normalization corner cases — trailing slash, query string, hash bypass the exact-match layout guards + `stepFromPathname` map (`classlite-web/src/features/onboarding/OnboardingLayout.tsx:47-54, 74-80, 217-220`). React Router v7 normalizes trailing slashes on internal navigation but external links can carry them. Low real-world hit rate.
- R1-C2-W5 [FU-2-3c-J filed, resolved from D1] `/setup/center` in `POST_CENTER_WIZARD_PATHS` widens the layout guard — an onboarded user visiting `/setup/center` briefly sees CenterSetupPage form before 409 recovery redirects (`classlite-web/src/features/onboarding/OnboardingLayout.tsx:95-99`). Kept as green-phase fold; backstopped by CenterSetupPage's 409 recovery. Revisit if telemetry shows real users hit the flash.
- R1-C2-W6 [resolved from D2] `replace: true` on 4 "Save and finish later" navigations — kept. Matches shipped 2-3a `CenterSetupPage` pattern (`classlite-web/src/features/onboarding/TemplateSelectPage.tsx:241`, `ClassSpawnPage.tsx:644 + 759`, `SoloFirstClassPage.tsx:502`). Back button cannot return to paused wizard step by design — user chose to pause via TeacherDashboard's welcome-back banner path.

## Deferred from: code review of story-2-3c Chunk 3 (2026-07-12)

- R1-C3-W1 [FU-2-3c-K filed] `route-bundle-boundaries.spec.ts` chunk-isolation regex `[\w-]+` fragile to Vite hash format changes + substring match (not import graph). Runtime `import()` leaks or shared vendor chunk paths wouldn't be caught. Requires parsing the module manifest for a real invariant check.
- R1-C3-W2 E2E welcome-back banner assertion lacks positive counterpart (`classlite-web/e2e/onboarding-template-spawn.spec.ts:1369-1372`) — testid typo would silently pass. Add companion test asserting banner renders for `currentStep !== 'done'`.
- R1-C3-W3 E2E "browser reload" test uses `page.goto('/welcome')` — doesn't simulate reload semantics (`classlite-web/e2e/onboarding-template-spawn.spec.ts:1407-1425`). Test title lies about what it tests.
- R1-C3-W4 E2E stat-strip plural distinction never asserted — `/classes ready/i` matches any count. "1 classes ready" regression invisible at e2e boundary.
- R1-C3-W5 `beforeEach` MSW handler-leak risk — tests layer `server.use(errorHandlers.X())` on top of the happy-handler `beforeEach` install. Cleaner pattern: `server.resetHandlers()` in `beforeEach` and install per-test explicitly.
- R1-C3-W6 Tailwind class-string assertions test implementation not behavior — `className.toMatch(/min-w-0/)` couples to Tailwind. Refactor to `getComputedStyle` for VN overflow discipline.
- R1-C3-W7 `DoneHeroPanel.test.tsx` shared `i18n.changeLanguage()` without `afterEach` restore — later tests inherit stale locale on test-order shuffle.
- R1-C3-W8 Save-and-finish-later 500 flush tests don't verify flush was ATTEMPTED — only navigate is asserted. Removing the `await autoSave.flush()` call would still pass. Add MSW handler-called-with spy.
- R1-C3-W9 `axe` matrix runs only on happy DoneHeroPanel render — never on `ErrorAlert`, `SetupIncompleteAlert`, `OnboardingDonePageSkeleton` layers. 3 error-state renders ship without a11y validation.
- R1-C3-W10 [FU-2-3c-L filed] `DoneHeroPanel` renders `<dd>{classCount}</dd>` (raw number) — Chunk 2 P7 `_one` plural keys are consumed only in i18n parity ratchet, never rendered. Runtime-verifying "1 class ready" vs "3 classes ready" requires refactoring `<dd>` to `t('classesReady', {count})` OR removing the `_one` keys entirely (spec S-S3 says vi doesn't distinguish plurals).

## Deferred from: code review of story-2-3b Chunk 3 (2026-07-12)

- R1-C3-W1 No component-level tests under `vi` locale — Playwright covers bilingual via LocaleEn + LocaleVi projects; per-component `vi` renders are follow-up hardening (TEST-UX-1).
- R1-C3-W2 `TemplateSelectPage` loading-skeleton test is jsdom-microtask dependent — no artificial MSW delay. Empirically passes; hardening could use `findByTestId` with explicit still-loading positive.
- R1-C3-W3 Test-file boilerplate — `<I18nextProvider><QueryClientProvider>` repeated 7+ times; a `renderOnboardingRoute()` helper would DRY.
- R1-C3-W4 Error-path tests use 3s findBy timeouts due to QueryClient retry — could speed up with `retry: false` on the test QueryClient.
- R1-C3-W5 `fixtures.ts` builder overrides not directly tested — exercised transitively through consumers.
- R1-C3-W6 `onboarding.spawn.teacher.assigned` interpolates {{name}}+{{role}} but no test exercises both tokens together — parity-check confirms en/vi match.
- R1-C3-W7 `SPAWN_PLACEHOLDER`/`FIRST_CLASS_PLACEHOLDER`/etc hard-coded in English in test scaffolding — test-only concern; destination pages render real content in production.
- R1-C3-W8 AC10 render-setup duplicated across 4 routing-row tests — `renderForRoutingRow` helper would DRY.
- R1-C3-W9 AC7 (iii) trigger click uses regex on `You'll teach...` — passes empirically; hardening could use `chipTriggerRefs`/testid scoped click.
- R1-C3-W10 401 variants absent from MSW inventory (Murat-B1 documented as 401/403/...) — 401 is architecturally unreachable from the onboarding wizard.
- R1-C3-W11 `mockSpawnedClass` id-shape prefix inconsistency — `class-` always applied; consistent but fragile.

## Deferred from: code review of story-2-3b Chunk 2 (2026-07-12)

- R1-C2-W1 `useCountdown` — `reset(N)` with same N no-ops the effect resubscription (`classlite-web/src/features/onboarding/hooks/useCountdown.ts:1075-1088`) — behavior is monotonic; documented in header. Not a bug.
- R1-C2-W2 `useListTemplates` — no `enabled` guard (`classlite-web/src/features/onboarding/api/useListTemplates.ts:1214-1228`) — callers gate at page mount; hardening.
- R1-C2-W3 `useCountdown` — 1-tick staleness in `onZeroRef` update ordering (`classlite-web/src/features/onboarding/hooks/useCountdown.ts:1069-1082`) — negligible at 1s interval.
- R1-C2-W4 `useAutoSave` — return shape drift on version skew (`classlite-web/src/features/onboarding/hooks/useAutoSave.ts:1173-1180`) — TS catches at compile.
- R1-C2-W5 `useListTemplates` — no retry on bare network error (`classlite-web/src/features/onboarding/api/useListTemplates.ts:1222-1227`) — retry only on `ApiError.status >= 500`; network hardening.
- R1-C2-W6 `classSpawnSchema` — no dedupe check on cohortName across rows (`classlite-web/src/features/onboarding/lib/classSpawnSchema.ts:1368-1407`) — server enforces; FE early-feedback nice-to-have.
- R1-C2-W7 `onboardingPayload.TemplateDraftPayload` — `spawnedClassIds` and `classesDraft` use `T | undefined` (not `T | null`) (`classlite-web/src/lib/onboardingPayload.ts:1461-1471`) — inconsistent with `buildFromScratch?: boolean | null`; header comment mitigates.
- R1-C2-W8 `useSpawnClasses` — no in-hook double-submit guard (`classlite-web/src/features/onboarding/api/useSpawnClasses.ts:1267-1276`) — callsite `submitDisabled` gates practically; belt-and-suspenders.
- R1-C2-W9 `classSpawnSchema.templateId` — lenient UUID regex accepts synthetic zeros (`classlite-web/src/features/onboarding/lib/classSpawnSchema.ts:1329-1332`) — justified for seeds.
- R1-C2-W10 `AssignTeacherComposer` — focus-return depends on parent contract (`classlite-web/src/features/onboarding/components/AssignTeacherComposer.tsx:442-446, 514-519`) — verified via `chipTriggerRefs` in Chunk 1.

## Deferred from: code review of story-2-3b Chunk 1 (2026-07-12)

- R1-C1-W1 `wireRowsFor` reads UI state (`rowStates[0]?.starIcon`) from render closure — submit logic coupled to display state (`classlite-web/src/features/onboarding/ClassSpawnPage.tsx:469-484`) — design concern, no concrete repro; refactor to derive from RHF form state requires spec alignment.
- R1-C1-W2 `TemplatePreview` invoked with `template={null}` when `buildFromScratchSelected` is true (`classlite-web/src/features/onboarding/TemplateSelectPage.tsx:186-192`) — verify at Chunk 2 review that prop type is `Template | null` and null-branch is handled.
- R1-C1-W3 `AssignChipValue` shape inconsistency — `handleAssignConfirmed` writes without `userId`; founder injection writes with `userId` (`classlite-web/src/features/onboarding/ClassSpawnPage.tsx:621-633` vs 415-428) — verify at Chunk 2 review that `userId` is optional and downstream consumers handle both.
- R1-C1-W4 `Array.from(v).length` grapheme-cluster limitation (`classlite-web/src/features/onboarding/SoloFirstClassPage.tsx:879-887`) — known accepted pattern from Story 2-3a Amelia-B1; family emoji miscounts. Non-blocking edge.
- R1-C1-W5 `retryCountdown` in `handleSpawnError` `useCallback` deps — memoization risk if `useCountdown` returns unstable object (`classlite-web/src/features/onboarding/ClassSpawnPage.tsx:486-567`) — verify at Chunk 2 review that hook's return object is memoized.
- R1-C1-W6 `stepFromPathname` no trailing-slash / query / hash normalization (`classlite-web/src/features/onboarding/OnboardingLayout.tsx:1222-1228`) — no known repro; non-blocking hardening.
- R1-C1-W7 `TeacherDashboard` banner CTA uses `navigate(..., { replace: true })` (`classlite-web/src/features/dashboard/TeacherDashboard.tsx:1470-1476`) — matches 2-3a `midWizardNoCenter` pattern; consistent, not a bug.
- R1-C1-W8 `CenterSetupPage` `setInterval` → `useCountdown` refactor cleanup regression risk (`classlite-web/src/features/onboarding/CenterSetupPage.tsx:1332-1373` deletion) — verify at Chunk 2 that `useCountdown` cleans up its interval on unmount.
- R1-C1-W9 `POST_CENTER_WIZARD_PATHS` missing `/setup/done` (`classlite-web/src/features/onboarding/OnboardingLayout.tsx:1236-1240`) — Story 2.3c owns `/setup/done`; add when that lands.
- R1-C1-W10 `TeacherDashboard` finish-setup CTA target ignores `currentStep` — Op/Founder mid-spawn double-navigates via TemplateSelectPage forward (`classlite-web/src/features/dashboard/TeacherDashboard.tsx:87-101`) — functional via double-navigate (both `replace: true`); minor UX flash. Align CTA target to `PersonaSelectPage.tsx:76-108` resume matrix.

## Deferred from: code review of story-2-3a (2026-07-09)

- Cross-tab `broadcastLoginSucceeded` omission from `useCreateCenter.onSuccess` (`classlite-web/src/features/onboarding/api/useCreateCenter.ts:46-65`) — sibling tab stays with `session.center = null` after Tab A creates a center; second create attempt from Tab B 409s. Deferred: FU-2-3a-D explicitly covers multi-tab reconciliation as out-of-scope.
- `route-bundle-boundaries.spec.ts` catches path references only (`classlite-web/e2e/route-bundle-boundaries.spec.ts:63-81`) — Rolldown might inline code without referencing the file path; the negative-`toContain(filename)` assertion only catches path-based leaks. Pre-existing spec pattern from Story 1-9a/b/c iterations — infra-level improvement is out of story scope.
- `api-fetch.ts` `parseEnvelope` body-fallback `requestId` not length-limited (`classlite-web/src/lib/api-fetch.ts:600-606`) — raw body string flows into Sentry tags + user-facing `onboarding.center.error.generic` interpolation. React's default escaping mitigates XSS; MSW-controlled inputs make this defense-in-depth only. Small hardening pass in a future story or infra sweep.
- `vitest.config.ts testTimeout: 30_000` global bump (`classlite-web/vitest.config.ts:1093-1098`) — justification is lint-fixture-specific but the timeout is global. Real component/integration tests regressing to 25s waits pass silently. Pre-existing infra concern; deferred to targeted per-suite timeout policy.

## Deferred from: code review of story-2-1 (2026-07-02)

- `idx_center_members_user_id` on `center_members` uses bare `CREATE UNIQUE INDEX` (ACCESS EXCLUSIVE for the duration of the build) — golang-migrate wraps every migration in a transaction so `CREATE INDEX CONCURRENTLY` cannot ship in the same file. Safe at first-launch (empty table), but before the table has meaningful production rows, ship a separate migration that runs `CREATE UNIQUE INDEX CONCURRENTLY` outside a tx (either bump golang-migrate to a version with driver-level tx-off, or execute the CONCURRENTLY create via a manual step). Migration file `20260702120200_add_center_members_user_unique.up.sql` carries the reminder inline.
- `json.NewDecoder` in handler bodies never calls `DisallowUnknownFields` and `Decode` accepts trailing garbage after a valid object (`{...}extraJson` is silently accepted). Codebase-wide pattern predating story 2-1. Consider a helper `strictJSONDecode(r, &v)` and a lint sweep as a hygiene pass.
- `WriteEnvelope` writes HTTP status via `w.WriteHeader(status)` before `json.NewEncoder(w).Encode(...)` runs — client disconnect mid-encode leaves a `201 Created` with a truncated body. Same pattern used across every 2xx handler that adopts the envelope. Consider `bytes.Buffer` marshal-first, write-second.
- `isConstraintViolation` does string-equality against hardcoded constraint names (`idx_centers_short_code`, `idx_center_members_user_id`). Renaming the DB constraint silently disables the retry loop and 409 remap. Compile-time enforcement (e.g., generated constants from schema) would prevent silent drift.
- `UpsertOnboardingProgress` advances `updated_at` on an identical-payload repeat PUT. Polling clients watching `updatedAt` for changes see a false "changed" signal. Consider `INSERT ... ON CONFLICT DO UPDATE SET ... WHERE current_step != EXCLUDED.current_step OR payload != EXCLUDED.payload`.
- Superuser cleanup pool (`internal/test/story_2_1_helpers.go` — `superuserPool`) has three issues: hardcoded `classlite_dev_password` in source, pool never closed for the life of the test binary, and `t.Fatalf` inside `sync.Once.Do` closes over the FIRST test's `t` — later tests calling in after the once has already fired won't get proper Fatalf propagation. Consider env-driven config + `pgxpool.Close` in test-main teardown + errgroup-style once construction.

## Deferred from: code review of story-1-9b (2026-06-26)

- Burned reset token persists in URL after consumed/expired/invalid landing (`ResetPasswordPage.tsx`) — low-leak surface; consider `setSearchParams({}, {replace:true})` on terminal-state set during a future polish pass.
- oauth-error banner not dismissible without leaving the page (`LoginPage.tsx`) — fold into Story 1-9d `useLoginBanner` discriminated-union refactor (already on its punch-list per story-1-9b Out of Scope block).
- Asymmetric countdown gate in `fireMutation` (countdown only checked when `isResend`) (`ForgotPasswordPage.tsx:73-75`) — defense-in-depth nit; the submit button's disabled prop is the live gate; harden if a programmatic-submit path is ever added.
- Clamped `MAX_COUNTDOWN_SECONDS` countdown vs unclamped server `Retry-After` display (`ForgotPasswordPage.tsx`) — related to the patched alert-freeze fix; clamping the displayed value to the local countdown is a UX-honest version.
- Reused `data-testid="login-form-banner"` across reset/verified banner variants (`LoginPage.tsx`) — add `data-banner-key={bannerKey}` when 1-9d refactors banner coordination, so structural-variant assertions don't rely on `textContent`.
- Reused `data-testid="forgot-back-link"` across form-mode + sent-mode footers (`ForgotPasswordPage.tsx`) — modes are mutually exclusive today; split testids if a future bug allows both modes simultaneously.
- `onResend` invariant (`submittedEmail` matches last successful submit) implicit in mode-pair coupling (`ForgotPasswordPage.tsx`) — encode as discriminated-union state (`{kind: 'sent', email} | {kind: 'form'}`) when "edit email in confirmation" is requested.
- Wrong-email click during in-flight resend → orphan `onSuccess` re-mounts sent state (`ForgotPasswordPage.tsx:108-123`) — low probability; guard with `if (isPending) return` in `onWrongEmail` if observed in production.
- Wrong-email click while countdown still active → countdown traps the new flow (`ForgotPasswordPage.tsx:114-123`) — low probability; needs `countdown.reset()` API on `useResendCountdown`.
- Component unmount mid-submit React warning (`ForgotPasswordPage.tsx`, `ResetPasswordPage.tsx`) — React 19 handles most cases; add `isMountedRef` if RUM warnings surface.
- Translator dropping `{{email}}` placeholder in `sentBody` silently omits email (`ForgotPasswordPage.tsx:140-145`) — translator hygiene; out of story scope; consider a `parity-sentinel-check.test.ts` lint guard in a future hygiene pass.
- Sentinel `'EMAIL'` literal collides if a future translator embeds the string in body copy (`ForgotPasswordPage.tsx:140`) — swap to Unicode PUA sentinel (e.g., `''`) when next touched.
- Multiple `?token=A&token=B` URL params — `URLSearchParams.get('token')` returns the first, may not match user intent (`ResetPasswordPage.tsx:92`) — malformed input; backend will reject either way.
- Locale switch mid-flow on expired/consumed/invalid states (`ResetPasswordPage.tsx`) — `AuthCard` regionLabel re-renders via `t()`; verify when language-switch UX lands in the shell.
- `useResendCountdown.start()` called twice in same tick — brief two-interval overlap (`useResendCountdown.ts:51-56`) — very narrow race; harden if observed.
- Tab backgrounded throttles `setInterval` — countdown drifts behind real wall-clock (`useResendCountdown.ts`) — switch to `Date.now() + duration` end-timestamp on next refactor.
- System clock jump desyncs countdown (`useResendCountdown.ts`) — same fix as the background-throttle drift.
- Double-click submit during RHF validation (`ResetPasswordPage.tsx:121-154`) — RHF `handleSubmit` awaits validation; race window is tight; `isPending` flips synchronously.
- Server returns 200 with `{reset: false}` / `{sent: false}` — defensive client guard absent (`ResetPasswordPage.tsx`, `ForgotPasswordPage.tsx`) — backend contract enforces; would require defensive guard only if backend semantics change.
- 72-byte bcrypt cap with multi-byte UTF-8 passwords (`resetPasswordSchema.ts:36-49`) — server catches; consider `new TextEncoder().encode(s).length <= 72` client check for UX-immediate feedback.
- Back-button after invalid-state CTA returns to form-mode with stale token (`ResetPasswordPage.tsx`) — router state nit; the stale-`errorState` patch already addresses the related re-entry path.
- `?token=%00` null bytes / control chars sent to backend, wastes a rate-limit slot (`ResetPasswordPage.tsx`) — backend rejects; consider regex sanity-check (`/^[A-Za-z0-9_-]+$/`) before submit.
- Stale `dist/` directory makes bundle-boundary test pass against old chunks (`route-bundle-boundaries.spec.ts`) — CI does fresh builds; local-dev runs are best-effort; document `rm -rf dist` before running the spec locally.
- Retry storm under flaky network — generic-error path has no client-side submit throttle (`ForgotPasswordPage.tsx:85-99`) — backend rate-limits, so blast radius is bounded.
- Frontend ignores 410/409/404 if `error.code` differs from expected literal — falls through to generic alert (`ResetPasswordPage.tsx:138-149`) — defensive relaxation (status-only check) would simplify but couples to backend contract drift.
- Frontend ignores 429 if `error.code !== 'RATE_LIMIT_EXCEEDED'` — countdown not started for other 429-code shapes (`ForgotPasswordPage.tsx:85-99`) — same as above.

## Deferred from: code review of 1d-2-shadcn-primitive-coverage (2026-06-17)

- Primitive-level hardcoded English aria-labels / sr-only text in `pagination.tsx:72,90` (`Go to previous page` / `Go to next page`), `breadcrumb.tsx:112` (`More`), `dialog.tsx:73` + `sheet.tsx:73` (`Close`) — known leak per spec Dev Notes line 384 ("primitives are presentational shells and do NOT consume i18n strings"). Vietnamese-locale screen-reader users will hear English on every overlay close + every pagination nav. 1d-3 domain wrappers (e.g., `BreadcrumbBar`, `PaginationBar`) override at the consumer layer; primitives themselves stay shadcn-stock per XL-1.
- `CommandDialog showCloseButton = false` at `command.tsx:1006` — touch-device users have no dismiss affordance without an Esc key. Lift in 1d-3 `CommandPalette` domain wrapper.
- `role="navigation"` redundant on `<nav>` in `pagination.tsx` — shadcn upstream output; tracked for upstream cleanup (XL-1 protects from hand-edit).
- `BreadcrumbPage` rendered as `<span role="link" aria-disabled="true" aria-current="page">` — bad ARIA on a non-link element; shadcn upstream pattern, XL-1 protected.
- `InputGroupAddon` click handler uses `parentElement.querySelector("input")` — fragile for textarea / nested input-group consumers; address in 1d-3 `CommandPalette` (the only known InputGroup consumer in Phase 1).
- Calendar `useEffect` focus-on-modifier-change without `focus({ preventScroll: true })` — shadcn upstream; scroll-jump risk during range drag.
- Calendar `String.raw` Tailwind v4 selector with `\_` escape for RTL chevron flip — needs browser test if RTL regression surfaces during Epic 1A i18n work.
- `PaginationLink` `<a>` without required `href` — type surface allows omission; shadcn upstream.
- `AvatarBadge` missing `aria-hidden` and missing fallback for empty contents — primitive-surface concern; consumer responsibility for accessible labeling.
- DropdownMenu Default `play` deferred — already documented inline in `DropdownMenu.stories.tsx:46-56` against Base UI test-runner production error #31. 1d-3 re-enables when Base UI stabilizes test-runner interop.
- `AlertDialogCancel` narrow type surface — exposes only `variant | size` from Button (drops `disabled`, `loading`, etc. on the cancel CTA); inconsistent with `AlertDialogAction` which forwards full `ComponentProps<typeof Button>`. Shadcn upstream.

## Deferred from: code review of story-1-7c (2026-06-12)

- `PermissionDenied` `sectionName?` prop not implemented (AC4 props contract line 377) — Story 2-6 (router-level role gating) is the first consumer and can ship it alongside the `errorElement` wiring.
- `Sidebar.tsx:51` uses `t('app.welcome')` as the placeholder nav anchor label — Epic 1D Story 1d-3 ships the role-aware nav set and will replace the placeholder.
- `app.layout.userPill.signOut` i18n key seeded but unreferenced — Story 1-8 fills `useAuth()` and the session-expired / sign-out affordance follows shortly after; key stays parity-checked in the meantime.
- `language-cookie.ts` doesn't expire prior host-scoped duplicates on subdomain migration — edge case only during a one-time `.localhost` → `.classlite.localhost` shift; address if cross-subdomain handoff regressions are observed in dev.
- `UserPill` `initials` derivation has no fallback for empty / whitespace-only `displayName`, and `t(ROLE_KEYS[role])` renders literal "undefined" for an out-of-allowlist role — harden when Story 1-8 wires real `useAuth()` and the API shape is known.
- `vitest-setup.ts` doesn't reset `document.cookie` between tests globally — current cookie-writing tests clean up locally; add a global reset if cookie leakage causes flakes in downstream suites.
- `dashboard-boots-in-vi.spec.ts:88-94` swallows errors from `context.clearCookies({name: 'lang'})` via `.catch(() => {})` for Playwright version-skew defense — revisit when the Playwright version is bumped or pinned.

## Deferred from: code review of story-1-1 (2026-05-29)

- No validation that critical config values (JWT_SECRET, DATABASE_URL) are set — server starts with empty strings. Wire startup validation in story 1.3 when DB pool is connected.
- Missing ESLint import boundary rules (`no-restricted-imports`) — no features exist yet to enforce boundaries on. Add when first cross-feature import is possible.
- Unpinned third-party GitHub Action `bervProject/railway-deploy@main` — pin to a specific commit SHA before first production deploy to prevent supply-chain attacks.

## Deferred from: code review of story-1-2a (2026-05-30)

- RateLimit cleanup goroutine has no shutdown mechanism (no context cancellation) — acceptable for MVP single-process lifetime, add when needed for test isolation or multi-instance.
- statusWriter doesn't implement http.Flusher/Hijacker interfaces — no SSE/WebSocket in MVP, revisit when streaming endpoints are added.
- 429 rate-limit response uses inline map[string]any instead of shared envelope type — shared response helpers will be created in story 1.2c; refactor to use them then.
- CORS middleware uses `Set("Vary", "Origin")` instead of `Add` — could overwrite other Vary headers; no other Vary sources exist currently, revisit when adding compression middleware.

## Deferred from: code review of story-1-2b (2026-05-30)

- Empty JWT secret silently accepted at startup — config validation deferred to story 1.2c.
- CORS wraps RateLimit, allowing unlimited preflight OPTIONS flood without rate limiting — architectural decision, reconsider if CORS abuse becomes a concern.
- `os.Exit` in ListenAndServe goroutine skips `defer` cleanup in main — pre-existing from story 1.1, refactor to channel-based error propagation when adding more cleanup logic.

## Deferred from: code review of story-1-2c (2026-05-31)

- Double WriteHeader if handler writes response then panics or returns error — needs tracked ResponseWriter wrapper; add when handler complexity warrants it.
- Config Validate allows arbitrary APP_ENV values (typos like "dev" or "prod" not caught) — add allowlist when more environments are defined.
- Empty CORS_ORIGINS env var edge case — already handled by CORS middleware parseOrigins which filters empty strings.

## Deferred from: code review of story-1-2d (2026-05-31)

- No context timeout in EmailSender.Send — caller responsibility; workers should set their own timeouts via context.WithTimeout.

## Deferred from: code review of story-1-2e (2026-05-31)

- HeadObject errors all mapped to 404 — should distinguish R2 network/auth errors from actual not-found; add S3 error type checking when needed.
- No max-size constraint on presigned PUT — R2/S3 doesn't enforce content-length in presigned URLs the same way; validate file size post-upload in confirm endpoint.

## Deferred from: code review of story-1-3 (2026-06-01)

- W1: `role` column on center_members/invites is unconstrained text — add CHECK constraint or enum when role definitions stabilize.
- W2: `short_code` on centers has no length/charset CHECK constraint — add validation when onboarding flow is built (story 2.1).
- W3: Users table allows both `password_hash` and `google_id` to be NULL (no auth method) — enforce at least one auth method at service layer in story 1.4.
- W4: Token-based queries (GetInviteByToken, GetEmailVerificationByToken, GetPasswordResetByToken) need to work outside tenant context for unauthenticated flows — design decision for invite acceptance (story 1.6) and verification (story 1.4).
- W5: password_resets/email_verifications queries don't filter on `expires_at` or `used_at`/`verified_at` — enforce at service layer in stories 1.4/1.5.
- W6: refresh_tokens has no revoke-by-setting-revoked_at query (only hard delete) — needed for token reuse detection family tracking in story 1.5.

## Deferred from: code review of story-1-3b (2026-06-03)

- W1 (HIGH): RateLimit middleware still keys on `r.RemoteAddr` instead of the new `model.IPAddress` context key — pre-existing bug exposed by adding ClientIP middleware. Behind Railway/Cloudflare every real user collapses into one rate-limit bucket per proxy egress IP. Fix in a follow-up that updates `internal/middleware/rate_limit.go` to read `r.Context().Value(model.IPAddress).(string)` first, fall back to `r.RemoteAddr`.
- W2 (MED): Composite index `(center_id, entity_type, created_at DESC)` does NOT include `entity_id`, so `ListAuditLogsByEntity` does a range scan + in-memory filter for high-volume entity types — within spec AC4, but a perf enhancement to add `(center_id, entity_type, entity_id, created_at DESC)` may be needed once audit volume grows.
- W3 (MED): Audit insert/commit has no idempotency key — if commit ack is lost the caller retries and produces a duplicate audit row. Add unique partial index on `(center_id, request_id)` and pass request_id through `AuditService.Log` when the rest of the request pipeline is fully wired.
- W4 (LOW): `audit_logs.ip_address` is `text`, not `inet` — spec explicitly says `text`, so code matches spec. Revisit if log-injection or IP-range queries become a need.

## Deferred from: code review of story-1-4 (2026-06-04)

- Resend constant-time floor is one-sided (DB-write path can exceed 200 ms while unknown-email path is padded to ~200 ms, leaving a statistical timing channel) — per-IP (burst 5, 1/2 min) and per-email (1/60 s) rate limits cap sampling rate; statistical separation needs hundreds-to-thousands of samples per address, making the residual timing leak impractical to exploit at scale. Revisit only if abuse is observed.
- Dual-clock between AuthService and EmailRetryQueue / floor test relies on real wall-clock — tests pass; a single shared `clock` interface across both layers would tighten the test seam (deterministic floor verification) but is not a bug today.
- `rate.Limit(0)` dead branch in `RateLimitByKey` / Retry-After overflow — no current caller passes zero rate; tighten when a new caller forces the issue.
- `mail.ParseAddress` accepts addresses like `foo@bar` (no TLD) — outside Story 1.4 scope (AC11 mandates ParseAddress). Add a `.`-in-domain check or MX-lookup when a real abuse case appears.
- `auth_audit_logs.entity_id` has no FK constraint and is nullable — no current writer passes nil EntityID; tighten to `NOT NULL` (and optionally a soft FK to users.id) in a follow-up schema migration.

## Deferred from: story-1-5 (2026-06-06)

- W1 (MED): Replace in-process token-bucket rate-limiter (`golang.org/x/time/rate` + per-process map) with a PG-backed implementation when ClassLite moves to multi-instance Railway deploys. Architecture spec: `rate_limits(key VARCHAR PK, count INTEGER, window_start TIMESTAMPTZ, expires_at TIMESTAMPTZ)` with periodic cleanup. Single-dyno MVP is unaffected.
- W2 (LOW): Single-membership auto-binding into JWT claims (`center_id`/`role` populated only when the user has exactly one active `center_members` row) is a stop-gap. Epic 2 introduces a real membership-select endpoint that replaces the heuristic; remove the inline `SELECT COUNT(*)` + `SELECT center_id, role` pair in `service.buildAccessToken` when that lands.
- W3 (LOW): Login attempt records on the success path INSERT a `success=true` row inside the same tx, then immediately `DeleteLoginAttemptsByEmail` removes BOTH success and failure rows — the success row is therefore effectively never persisted. Either remove the redundant insert OR keep success rows separately for analytics; revisit when login analytics ship.
- W4 (LOW): Password-reset email is sent synchronously via `s.email.Send` (not the retry queue) so the ATDD test sees the dispatch without driving a worker. If Resend throughput becomes a constraint, route this through `EmailRetryQueue` and update tests to drain explicitly.
- ~~W5: rate-limit burst masked ACCOUNT_LOCKED~~ — CLOSED 2026-06-06 by bumping `auth-login` burst from 5 to 8 in `cmd/api/main.go`. ACCOUNT_LOCKED now surfaces at the HTTP edge with `Retry-After: 900`; verified by re-running the lockout smoke test.

## Deferred from: code review of story-1-5 (2026-06-06)

- Client-disconnect during refresh rotation triggers family revocation on retry (`auth_refresh.go`) — design property of strict reuse detection; AC8 mandates "force re-login on every device." Add a grace window (keep rotated-out row revoked for ~30s, allow same-hash replay if successor was created within window) only if observed in prod.
- `OriginCheck` rejects every state-mutating POST without an `Origin` header (`middleware/origin_check.go`) — Story 1.5 has no native-mobile / S2S / monitoring surface so the rejection is invisible today. Revisit when those surfaces arrive; either accept empty Origin when a server-side trust signal is present (mTLS, API key), or carve out bearer-authed routes (no CSRF surface).
- `LastFailedLoginAttempt` SQL has no time bound (`internal/store/queries/login_attempts.sql`) — works today because lockout enforcement happens in Go. Add `AND attempted_at > $2` parameter when retention / cleanup cron arrives.
- CORS wildcard regex (`^https://[a-zA-Z0-9-]+\.classlite\.app$`) doesn't normalize default ports in Origin (`middleware/cors.go`) — rare browser behavior (some include `:443`); document and strip ports before match if observed.
- `CountSiblingsInFamily` doesn't filter `revoked_at IS NULL` (`internal/store/queries/refresh_tokens.sql`) — consistent with the hard-delete revocation pattern story 1.5 uses. Revisit if soft-delete-on-revoke is reintroduced.
- CORS wildcard accepts `http://*.classlite.app` (insecure scheme) (`middleware/cors.go`) — operator error in environment; tighten to `https://` only when `AllowCredentials=true`.
- `_ = err` swallowing across audit / login-attempt / logout / forgot-password paths reduces operational visibility — broad cleanup; add throttled `slog.Warn` on persistent failures so a DB / audit outage doesn't go unseen.
- `auth_p2_test.go` and `auth_role_negative_test.go` depend on ATDD-only helper functions (`newAuthServiceWithSenderAccess`, etc.) — test hygiene; consolidate when the helpers are extracted into a shared `internal/testsupport` package.

## Closed by story-1-5

- W5 from story-1-3 (`password_resets`/`email_verifications` need expires_at/used_at filter): `GetActivePasswordResetByToken` now filters in-SQL. `email_verifications` queries are scoped to their use cases.
- W6 from story-1-3 (refresh_tokens has no revoke-by-revoking-revoked_at query): closed via `DeleteRefreshTokensByFamily` — story 1.5 uses hard deletes to revoke, not the `revoked_at` column.

## Deferred from: code review of story-1-7b (2026-06-10)

- W1 (LOW): NotFound / catch-all route missing — React Router's default error UI bypasses the i18n `RootErrorBoundary` fallback when a user navigates to an unknown path. Explicitly out-of-scope for 1-7b per the spec's "Out of scope" list; 1-7c owns the polished error/NotFound/PermissionDenied screens. `classlite-web/src/routes.tsx` — add a catch-all `{ path: '*', Component: NotFoundPage }` and `errorElement` when 1-7c lands.

## Deferred from: code review of 1d-3-app-shell-stack (2026-06-22)

- Spec contract drift: `AppShell.mobileTabBar`, `SidebarNavItem.disabled`, `MobileTabBar.unreadByTab` not declared in their respective spec `Props` interfaces (AC1 / AC6 / AC7). Functional extensions that match story intent — spec should be amended in a follow-up to ratify the API surface; not a code change.
- DoD #28 (designer notified about Owner+Admin mobile tab extrapolation) + #22 (shadcn-base-nova primitive-quirk tracking issue) remain unchecked at review status. Both are non-code follow-ups already tracked in `1d-3-followup-designer-figma-comment.md` and `1d-followup-codeowners-and-shell-allowlist-rule.md`; close those artifacts to close these DoD items.
- `MobileTabBar` at 320px iPhone SE 1st gen (5 tabs × 44px min-width = 220px + horizontal padding) may overflow viewport. Project minimum supported viewport is 375px (per AC8) — 320px is out of scope; revisit if we ever explicitly support 320px devices.
- `SearchPill` renders `⌘K` Mac glyph on every platform and ships no actual keyboard accelerator. Spec explicitly says CommandPalette wiring is deferred to a future story (`Command` primitive consumer). Cross-platform glyph swap (⌘ vs Ctrl) and the actual handler land together when the palette ships.
- Playwright `design-system` project's `testIgnore /storybook\//` regex uses forward-slash only. No Windows CI/dev for this project today; tighten to `/[\\/]storybook[\\/]/` if Windows ever joins the supported dev OS list.
- `scripts/i18n-parity.mjs` `STORY_KEYS` extraction handles only flat string-array literals — computed values like `[...COMMON_KEYS, 'extra']` aren't traversed. Documented convention; no current consumer ships computed keys. Revisit if a story needs key-set composition.
- `scripts/lib/strip-comments-and-strings.mjs` regex-literal containing `//` (e.g. `/a\/\//`) may be mis-tokenized as a line comment. Documented limitation in the file; not a regression introduced by 1d-3. Replace with a proper tokenizer when a real false-positive surfaces.

## Deferred from: code review of 1d-4-phase4-visual-bridge (2026-06-24)

- `InboxRow` `row.type` runtime drift — `PRIMARY_ACTION_KEY`/`ROW_TONE` are `Record<InboxRowType, ...>` so TS catches missing keys at build; defensive `??` fallback deferred until API contract widens.
- `InboxRow` `mainTextVars` missing interpolation key would emit literal `{{var}}` — consumer responsibility; static shell trusts the caller.
- `ScopeBar` malformed `dateRange.startIso`/`endIso` falls through `.slice(0, 10)` to garbage text — fixture-driven; consumer must pass valid ISO.
- `ScopeBar` `activeScope` in `disabledScopes` contradictory state — consumer must avoid the pair; rare.
- `SpeakingGradingSurface` multiple comments with `timestamp > durationSec` all clamp to 100% and overlap — Epic 6 grading service validates real comments.
- `WritingGradingSurface` duplicate `criterionKey` triggers React key warning — consumer/data error upstream.
- `CommentCard` `testIdSlug` collision across surfaces — consumer responsibility; prefix at callsite.
- `.cl-anchor-*` nested `<mark>` compounding (padding-inline + underline doubling) — fixture-side constraint; documented at fixture-build in Epic 6.
- `AnchoredQuestionCard` textarea has no `maxLength` — Epic 7 Story 7-4 wires input limits and UX-2 length budget.
- `InboxListShell` LocaleVi stories use `string.replace('h ago', ' giờ trước')` — story-side fixture munging; real relative-time formatter lands with Epic 10 inbox consumer.
- `WriteDocSurface` `timeOnTaskSec >= 3600` formats as `77:30` — Epic 5 Story 5-3 wires the real timer and selects the right format band.
- `CommentCard` `'✎'` glyph (U+270E) may render as tofu on Windows font stacks — designer call; lucide swap requires Figma sign-off.

## Deferred from: code review of story 1-8-auth-ui-registration-and-login-screens (2026-06-25)

- W1 PasswordInput toggle breaks 1Password/LastPass autofill heuristics when toggled mid-fill — industry-standard pattern, password managers handle it gracefully. Tracking only.
- W2 GoogleOAuthButton `isNavigating` state stuck after back-cancelled top-level nav (bg-muted persists). Reset via `pageshow` listener.
- W3 BroadcastChannel `auth-refresh.ts` has no signature/origin check on incoming `refresh-succeeded` payload; hostile same-origin code (browser extension) could poison the session cache. Different threat level; acceptable for now.
- W4 Password client `.max(72)` counts UTF-16 code units; backend bcrypt 72-byte limit counts UTF-8 bytes. Multi-byte unicode (emoji) passwords can pass client validation but lose data at the bcrypt boundary.
- W5 `useAuth` `useSyncExternalStore` subscribes to the entire QueryCache; subscription overhead grows with #queries app-wide. React bails on stable snapshot reference so re-renders are O(1) in practice. Track for future perf audit.
- W6 AC8 stable testid `data-testid="google-oauth-cta"` is shipped on GoogleOAuthButton but the corresponding entry in `classlite-web/docs/storybook-conventions.md § stable testids appendix` is not in the diff. Doc-only follow-up.
- W7 `/login` and `/register` accessible while already authenticated — no router-level auth guard. Route gating explicitly deferred to Story 2.6.
- W8 AC pinned test contract enumerates "(isPending / isError / isSuccess)" trilogy by name; per-error-code tests cover the behavior but the literal `isError`-named test is absent. Naming pedantry only.
- W9 `RegisterPage` thumb-zone JSDoc is "see LoginPage JSDoc" rather than inline copy; Dev Notes mandates the full block in both files.
- W10 `PasswordInput.test.tsx` uses literal `aria-label="Password"` rather than `t('auth.common.password')`; the test exercises the wrapper not the i18n contract. Per TEST-FE-4.
- W11 MSW register handler always returns `emailDelivery: 'sent'`; the `failed` branch in RegisterPage `onSuccess` has no MSW default coverage. Tests can opt-in via `server.use(...)`.
- W12 `AuthExpiredError` doesn't invoke `Error.captureStackTrace` (pre-existing class in `lib/api-fetch.ts`; older Safari stack-trace loss).
- W13 No test exercises 422 VALIDATION_ERROR with `details=null` / `details=[]` / all-unknown-fields branch. Add when P2 patch lands.
- W14 `auth-refresh.ts` `refresh-succeeded` with `data: null` on debounce-hit can extend the cross-tab debounce window indefinitely under specific timing races. Existing lock + per-tab promise coalesce make this very unlikely.

## Deferred from: 1-8 D1 (PasswordStrengthBar warning-token bridge)

- 1-8-followup-warning-token-bridge: add `--cl-status-warning` token to `tokens.css` and corresponding `bg-warning` shadcn-semantic alias in `index.css @theme inline`, then migrate `PasswordStrengthBar.tsx` `bg-amber-500` (score 2, "fair") to `bg-warning` (or the arbitrary-value escape `bg-[color:var(--cl-status-warning)]`). Today the amber Tailwind utility is the pragmatic stand-in — the visual is correct, but it bypasses the token bridge AC1 mandates. Owner: any subsequent Epic 1 design-token PR.

## Deferred from: code review of 1-9a-email-verification-ui (2026-06-25)

- `deriveMode` whitespace pollId edge: `?pollId=%20` treated as valid; backend returns 404 → user sees "expired" UI for malformed URL. [VerifyEmailPage.tsx:70-77] — low-frequency edge.
- `useResendCountdown` start mid-tick / `tickToken` ghost-interval race: relies on React effect-cleanup ordering; fake-timer tests pass synchronously but production batching could allow a stale tick. [useResendCountdown.ts:46-67] — no observed regression.
- Success-then-cap race direction untested: hook tests cover cap-then-success drop; symmetric direction untested. [useVerificationPoller.test.tsx] — symmetric coverage gap, probability low.
- `pollerEnabled` two-render-window extra tick: one extra poll fires between `verified=true` and effect-driven `setPollerEnabled(false)`. [VerifyEmailPage.tsx:404-407] — subsumed by FW-4 pollerEnabled-derivation patch in same review.
- `?verified=1` non-strict equality: `=== '1'` check no-ops on `?verified=01` / `?verified=true`. URL generated by us; external manipulation possible. [LoginPage.tsx:94-98] — internal-URL contract holds.
- `__resetAuthRefreshStateForTests` missing `notifyBootProbeChange()`: tests calling reset see stale subscription state until next notify event. [auth-refresh.ts] — test-only path.
- AC1 bundle-boundary deviation from "hard string match": code uses filename-substring match because Rolldown minifies the identifier. Pragmatic. [route-bundle-boundaries.spec.ts:66-108] — acknowledged in completion notes; preserves contract spirit.
- `scripts/i18n-parity.mjs` `COVERED_NAMESPACES` not extended with `'auth.'`: per-key parity is clean via `STORY_1_9A_KEYS`, but namespace-level orphan-key gate for `auth.verify.*` is not active. [scripts/i18n-parity.mjs:51-58] — acknowledged in completion notes; one-line pickup.
- Default MSW verify-email handler always returns 200 success: tests forgetting to override get unrealistic happy path. [classlite-web/src/test/mocks/handlers.ts:127-136] — test-fixture quality.
- MSW verify-status handler ignores `pollId` query param: same response for any pollId; tests can't exercise wrong-pollId branch from default. [classlite-web/src/test/mocks/handlers.ts:155-164] — test-fixture quality.
- Safari private mode: no BroadcastChannel → sibling tabs sit on stale `/verify-email`. [auth-refresh.ts:357-364] — out-of-scope per spec; platform limitation.
- Untracked `_bmad-output/implementation-artifacts/1-9a-email-verification-ui*.md` files at review time — commit atomicity depends on operator. — operator responsibility.
- `commitTerminal` stability is an undocumented hidden contract: page's 10-min cap effect depends on `commitTerminal` referential stability; protected today by `useCallback([])` but no test re-renders parent mid-window. [useVerificationPoller.ts:73-77] — defensive test.
- Spec text inconsistency — `VERIFY_REDIRECT_DELAY_MS` 800ms (AC6 table line 238) vs 1500ms (Dev Notes line 479). Code shipped 1500ms (correct per amendment). — stale spec line cleanup.

## Deferred from: code review of story-1-9c (2026-06-29)

- LoginPage `?invited=true` check is case-sensitive (`?invited=TRUE` ignored) — Story 2-1 moves the banner ownership to dashboard; case-normalization can ride along. [`LoginPage.tsx`, `deriveBannerKey`]
- `useAcceptInvite` onSuccess hard-navigates to `/dashboard` for all roles — dashboard routing concern owned by Story 2-1; student/teacher/owner role-split lands when dashboard ships. [`classlite-web/src/features/auth/api/acceptInvite.ts`]
- `sanitizeCenterName` uses NFC normalization; NFKC would fold fullwidth/compatibility confusables and tighten phishing-string defense — security hardening, not a regression. [`classlite-web/src/features/auth/lib/sanitizeCenterName.ts`]
- `<TerminalRegion>` component refactor — 7 near-duplicate JSX blocks on `InviteAcceptancePage` mirror the anti-pattern the spec already flags as the 5-variant `<Banner variant>` 1-9d gate. Roll into the 1-9d refactor pass. [`InviteAcceptancePage.tsx`, all 7 terminal blocks]
- `forgotPassword.test.tsx` shows TS module-resolution diagnostics (`@/test/msw-server`, `@/lib/query-client`, etc.) — pre-existing from 1-9b, surfaced in the 1-9c diagnostic feed but not caused by 1-9c. [`classlite-web/src/features/auth/__tests__/forgotPassword.test.tsx`]
- `build:check` script not wired into `ci-web.yml` — acknowledged in completion notes; 1-line CI PR planned to ride with the codegen-drift CI gate (party-mode 2026-06-26 follow-up). [`.github/workflows/ci-web.yml`]
- BroadcastChannel `invite-accepted` cross-tab signal absent — spec explicit deferral; sibling tabs hydrate on next silent-refresh tick (same assumption as 1-9a verified-banner branch). [`classlite-web/src/features/auth/`]
- `passwordNotAllowed` terminal offers no "try email again" recovery path and no test pins the UX absence — intentional per spec design; pin contract only if 1-9d revisits the OAuth-mismatch recovery shape. [`InviteAcceptancePage.tsx`, passwordNotAllowed branch]

## Deferred from: code review of story-1-9d (2026-06-29)

- `useLockoutCountdown` StrictMode pass-2 resets `expiryHandledRef.current = false` on each effect run — harmless today (storage clear is idempotent), but a future refactor that makes `clearLockoutUntilMs()` side-effectful could regress. [`classlite-web/src/features/auth/hooks/useLockoutCountdown.ts`] — robustness, no functional bug.
- URL-clear preserves attacker-supplied `next=` payload in URL bar — `/login?session_expired=1&next=//evil` after URL-clear becomes `/login?next=//evil`; sanitizer catches it at navigation time but the user reads the URL bar and sees the attack payload echoed. Could strip rejected `next=` on mount. [`classlite-web/src/features/auth/LoginPage.tsx:347-354`] — UX polish, defense already in place.
- `WorkspaceBlockedState` `bodyKey` uses two hardcoded string literals — a typo would silently return the key as fallback text. i18n-parity catches missing keys but not typos at the call site. Const-extract or type-narrow. [`classlite-web/src/features/auth/components/WorkspaceBlockedState.tsx`] — defensive improvement.
- `sanitizeNextParam` double-decode rejects legitimate paths with raw `%` — `decodeURIComponent` runs twice (once via `searchParams.get`, once in the helper); a path like `/page/50%off` throws and falls back to `/dashboard`. Extreme edge case (raw `%` in real URLs is vanishingly rare); double-decode is intentional depth-defense against double-encoded `//evil`. [`classlite-web/src/features/auth/lib/sanitizeNextParam.ts:27`] — extreme edge, no production impact.
- Concurrent URL params `?session_expired=1&error=invite_email_mismatch` silently swallow the session-expired banner — `deriveReplacement` doesn't honor session-expired priority; mode flips to `oauthMismatch` and the banner is gated by `mode === 'default'`. Spec acknowledges this combination as "impossible in production" (session-expired only arrives via auth-refresh full-page nav). [`classlite-web/src/features/auth/LoginPage.tsx`] — spec-acknowledged impossible.
- `readLockoutUntilMs` rejects `envelope.version !== 1` and clears storage — future version bump silently loses every existing user's lockout state. Fine for lockout (UX-only) but the pattern should grow a forward-migrate path. [`classlite-web/src/features/auth/lib/lockoutStorage.ts`] — opportunistic when v2 lands.
- Duplicate clock SVG — `CLOCK_SVG` in `LockoutState.tsx` + `CLOCK_BANNER_SVG` in `LoginPage.tsx` are near-identical; opportunistic dedup via `src/features/auth/components/icons.tsx`. — cleanup, not a bug.
- `prefers-reduced-motion` not respected for per-second countdown updates — text updates 1Hz regardless of user motion preference. UX polish; could throttle to per-minute updates under `(prefers-reduced-motion: reduce)`. [`classlite-web/src/features/auth/components/LockoutState.tsx`] — a11y polish.

## Deferred from: code review of story-1-10-astro-landing-page (2026-06-30)

- `computeCookieDomain` returns null on bare `localhost` (dev-only edge; cross-subdomain handoff silently scoped to current host). [`classlite-web/src/hooks/useHintCookieWrite.ts:43-48`] — dev-only.
- Mobile `<details>` hamburger menu does not auto-close when the page scrolls past the sticky-header threshold; the open panel overlaps the stuck-header background. [`classlite-landing/src/components/landing/StickyHeader.astro`] — UX polish.
- Root `/` returns 404 if the CF Pages Function fails to deploy or is unregistered (no static `index.astro` fallback any more). — ops monitoring; not a code defect.
- Footer Zalo link is a hard-coded placeholder `https://zalo.me/0123456789` and lacks `target="_blank"`. [`classlite-landing/src/components/landing/Footer.astro:18`] — already tracked as followup `1-10-followup-zalo-link`.
- Playwright CLS test uses two `boundingBox` measurements 150 ms apart instead of `PerformanceObserver` LayoutShift entries; missed shifts at intermediate timestamps would pass. [`classlite-landing/e2e/landing.spec.ts:73-82`] — test-quality.
- StickyHeader `prefers-reduced-motion` evaluated once at mount; runtime OS toggle of the user preference has no effect on the header transition. [`classlite-landing/src/components/landing/StickyHeader.astro:1991-1993`] — a11y polish.
- AC8 Layer 3 ATDD specimen was authored green-from-start (no preserved red phase); R38 discharge is still defended by Layers 1+4 + helper test. — documentation gap.
- `check-cookie-domain-parity` whitespace normalisation regex hides differences inside comments; `check-landing-parity.mjs:importLocaleModule` uses fragile `} as const satisfies` substring markers plus `new Function` eval. Both work today but a future content shape with the marker in a string would false-fail. Rewrite via a `tsx` / vite-node loader. — scope-additive refactor.
- `LOCKED_PRICES` table does not handle locale-specific digit grouping (e.g. `399.000` vs `399,000`); fine while landing keeps VND for both locales — re-evaluate if EN ever switches to USD. — future, when prices diverge.
- Parity-coverage `collectReferencedKeys` regex misses bracket access (`strings['hero']`) and destructured access; scan is "informational" today. [`classlite-landing/src/lib/test/__tests__/landing-i18n-parity-coverage.test.ts:142-153`] — informational only.
- `hint-cookie-shape.test.ts` is a documentation grep against hard-coded literals — neither the dashboard writer nor the landing reader is exercised; defence it claims is illusory. [`classlite-landing/src/lib/test/__tests__/hint-cookie-shape.test.ts`] — improve to behavioural contract next touch.
- Bundle of minor defence-in-depth items deferred together: BaseLayout runtime `dashboardUrl` validation (validator covers); Hero.astro trailing-slash double-slash (validator forbids today); PricingCard unknown-tier `planParam` empty fall-through (type-constrained); `window.location.replace` try/catch wraps whole script block (rare); SessionExpiredBanner `display:none` if JS disabled / CSP-strict; `pickLocale` `q>1`/`q<0` accepted (not exploitable); no CI schedule trigger; envField `optional` default; `landing-i18n-parity.resolveDotPath` swallows sub-object case (developer-experience). — pre-existing or vanishingly rare.

## Deferred from: code review of story-2-2-class-template-and-spawning-api (2026-07-06)

- **R2-W1** — `DisallowUnknownFields()` applied only on Story 2.2 endpoints; Story 1.x handlers (onboarding, centers, auth) still silently accept unknown fields. Wizard router must code-path per endpoint whether "extra field → 422" or "extra field → 201 with server-ignore". File `FU-2-2-K` to sweep-apply on next-touch of each handler. Not a Story 2.2 regression.
- **R2-W2** — Trigger `sync_template_sessions_center_id` has no `IF NOT FOUND` guard; silently NULLs `NEW.center_id` on non-existent parent template (FK constraint pre-empts in practice). Fixing requires a new migration pair per WF-2 (never edit existing migrations). Defer to next `template_sessions` migration touch. [`classlite-api/migrations/20260703120100_create_template_sessions.up.sql:1631`]
- **R2-W3** — Same trigger silently overwrites `NEW.center_id` on explicit-value INSERT with no assertion of match — bugs pass unnoticed. Migration constraint applies. Defer with R2-W2.
- **R2-W4** — `classes.session_count` is nullable in schema; spawn always writes valid but a manual UPDATE could NULL it. Migration change needed. Defer to a Story 3.1+ migration touch. [`classlite-api/migrations/20260703120200_create_classes.up.sql`]
- **R2-W5** — Trigger function's `SET search_path = public, pg_temp` should follow best-practice `SET search_path = pg_catalog, public`. Cosmetic; needs new migration. Defer with R2-W2. [`classlite-api/migrations/20260703120100_create_template_sessions.up.sql`]
- **R2-W6** — `ExtractTenant` per-request tx-wrap doubles pool round-trips per authenticated request. C1-18 already deferred in Round 1 with post-launch monitoring; re-flagged by Round 2 but same acceptance rationale (fix was mandatory for Branch B RLS scoping). [`classlite-api/internal/middleware/auth.go:77-94`]
- **R2-W7** _(from R2-D4 decision resolution)_ — Seed migration `NO FORCE ROW LEVEL SECURITY` window races with concurrent tenant traffic on live-DB replay. Policy accepted: seed migration is replay-safe only during maintenance windows; the ~ms NO FORCE bookend is bounded by `golang-migrate`'s advisory lock but does not gate user traffic. No code change — future ops runbooks must enforce the maintenance-window-only replay rule. [`classlite-api/migrations/20260703120300_seed_class_templates.up.sql`]

## Deferred from: code review of story-2-4 (2026-07-14)

- **CR-2-4-K NEW (FU-2-4-K)** — `useChecklistState` module-scope `subscribers` Set broadcasts every bump to every mounted hook regardless of userId. Multi-user dashboards (impersonation split-screen, tenant switching) would waste renders across unaffected users. Currently single-user dashboards so no visible bug. Deferred perf cleanup: partition into `Map<userId, Set<() => void>>` and notify only the affected user's subscribers. [`classlite-web/src/features/dashboard/hooks/useChecklistState.ts:63,127`]
- **CR-2-4-1** — `useChecklistState.test.tsx` uses `expect.toBeCloseTo(parsed.snoozedUntil, -3)` to assert ±500ms tolerance while claiming "±1s tolerance" in the comment. Under fake timers `Date.now()` is frozen so comparison collapses to exact-equality; the tolerance is dead code. Cosmetic test-quality nit. [`classlite-web/src/features/dashboard/hooks/__tests__/useChecklistState.test.tsx`]
- **CR-2-4-2** — `getTimerCount()` fuzzy assertion in `useChecklistState.test.tsx` test (d.ii) passes as long as ANY timer was cleared during unmount — not necessarily the hook's setTimeout. Could false-positive if React clears its own microtask. Tighten by spying on `window.clearTimeout` with specific handle. [`classlite-web/src/features/dashboard/hooks/__tests__/useChecklistState.test.tsx`]
- **CR-2-4-3** — `checklistDefinition.test.ts` uses `null as never` cast on `currentCenter` — type is already `CenterSummary | null` so the cast is an unnecessary smell. Drop the cast; test passes without it. [`classlite-web/src/features/dashboard/lib/__tests__/checklistDefinition.test.ts`]
- **CR-2-4-4** — `DeadLinkTrigger` per-click Sentry breadcrumb fires unbounded — rage-click 1000× floods Sentry's 100-entry ring buffer, evicting other diagnostics. Real but adversarial-rare. Fix: throttle via `ref`-based debounce (once per 500ms per `targetPath`). [`classlite-web/src/features/dashboard/components/DeadLinkTrigger.tsx`]
- **CR-2-4-5** — `checklist-snoozed` Sentry breadcrumb fires from BOTH the hook (`{userId, snoozedUntil}`) AND the `FinishSetupCard` (`{userId, persona, completed, total}`). Two breadcrumbs under the same message name look like duplicates in Sentry triage. Design cleanup: rename hook-side to `checklist-snoozed-persisted` OR fold both into one via `snooze(context)` extension. [`useChecklistState.ts` + `FinishSetupCard.tsx`]
- **CR-2-4-6** — `FinishSetupCard` snooze click unmounts the card but focus falls back to `document.body`. Keyboard/SR users lose focus context. Fix requires a ref chain from parent to move focus to the dashboard heading before `snooze()`. [`FinishSetupCard.tsx`]
- **CR-2-4-7** — Storybook stories mutate the shared global `queryClient` singleton across variants without cleanup between story renders. Snoozed variants also lack a decorator that seeds `localStorage`. Story previews render inconsistent state depending on order visited. Fix: `createTestQueryClient()` + localStorage seed inside per-story decorator. [`TeacherDashboard.stories.tsx` + `FinishSetupCard.stories.tsx`]
- **CR-2-4-8** — `WelcomeBackBanner` uses `navigate('/setup/center', { replace: true })` for resume-banner CTA — browser back button can't return to dashboard. Shipped 2-3a/b baseline behavior (not this story's introduction); revisit if telemetry shows resume-back-to-dashboard need. [`classlite-web/src/features/dashboard/WelcomeBackBanner.tsx`]
- **CR-2-4-9** — `WelcomeBackBanner` `role="status"` on a div re-announces content on every branch/persona prop change. If banner branch flips during a refetch (`midWizardNoCenter` → `postCenterIncomplete`), SR announces both. Combined with any latch clear race, an announcement storm is possible. Shipped baseline pattern; consider `role="region"` + `aria-labelledby` instead. [`WelcomeBackBanner.tsx`]
- **CR-2-4-10** — `route-bundle-boundaries.spec.ts` asserts `existsSync(DIST_DIR)` with the message "run `npm run build` before this Playwright spec" — but doesn't check dist mtimes vs source mtimes. CI could run this test against stale dist from a prior branch and get a false-positive. Meta-concern; harden by comparing mtimes or force-building in `beforeAll`. [`classlite-web/e2e/route-bundle-boundaries.spec.ts`]
- **CR-2-4-11** — `dashboard-first-run.spec.ts` stubs `/api/onboarding/progress` non-GET with `route.fulfill(jsonEnvelope({}, 200))` — returns `data: {}`. If any mutation-side hook expects a specific shape (e.g. updated progress object), TanStack Query's `onSuccess` may crash. Snooze is client-only per spec so no active mutation touches this endpoint in v1. Deferred until FU-2-4-J unskips the spec. [`classlite-web/e2e/dashboard-first-run.spec.ts`]
- **CR-2-4-12** — `progressUnknownNoCenter` branch fires on ANY `progress.isError` — no `failureCount > 0` gate or backoff. Transient network blip during boot shows the resume banner immediately even for users who legitimately have a center in flight. Edge case; would need a small-backoff `failureCount > 0` guard. [`classlite-web/src/features/dashboard/TeacherDashboard.tsx`]
- **CR-2-4-13** — `stableProps` latch reset branch fires on any non-`done` currentStep OR persona-null progressData. Legitimate authoritative state changes correctly clear the latch, but Blind Hunter flagged concern about transient bad-data cache writes (optimistic mutation elsewhere writing invalid state) still causing body-unmount flash. Latch's design intent per party-mode fold is undefined-transient protection; documented pragmatic deviation. [`TeacherDashboard.tsx`]
- **CR-2-4-14** — `useEffect` on server-state derivation in `TeacherDashboard` (for the `stableProps` latch) violates the project rule against `useEffect` on server state. Single `react-hooks/set-state-in-effect` disable with justification. Ref-write during render was rejected first by the `react-hooks/refs` rule; latch requires state to persist across renders where `fresh` narrows to null. Documented pragmatic per `[[feedback_pragmatic_interpretation_of_spec_absolutes]]`. [`TeacherDashboard.tsx`]
- **CR-2-4-15** — `awaitingNextStep` reassigns `bannerBranch = 'postCenterIncomplete'` and then `WelcomeBackBanner` re-derives `isAwaitingNextStep = isPostCenterIncomplete && persona === null` to swap copy. Behavior correct (right copy + no CTA), but the branch discriminator loses the "awaitingNextStep" distinction the spec named. Future body-only check on `bannerBranch === 'postCenterIncomplete'` would misfire. Add a fourth `BannerBranch` value `'awaitingNextStep'` and dispatch explicitly. [`TeacherDashboard.tsx` + `WelcomeBackBanner.tsx`]

## Deferred from: code review of story-2-5a (2026-07-15)

- **CR-2-5A-1** — AC14 cross-chunk sharpening asserted only via `settings-tab-strip` testid absence in dashboard/onboarding chunks. Spec asks for a code-overlap scan (settings-namespaced symbols not appearing in dashboard chunk). Weaker guard than spec envisioned; refine in a bundle-audit pass. [`classlite-web/e2e/route-bundle-boundaries.spec.ts:509-557`]
- **CR-2-5A-2** — WF-9 `docs/manual-setup.md` created wholesale in this diff with rows for prior/future stories (Google OAuth 1.6, Google Meet OAuth 2.5c, Resend 1.4, R2 1.2e, Railway, Cloudflare Pages, DNS). Story 2-5a introduces no external setup work — the doc's creation belongs to a docs-cleanup pass or 2-5c which owns the OAuth surface. Not blocking. [`docs/manual-setup.md`]
- **CR-2-5A-3** — PATCH `/api/centers/{id}` handler silently accepts unknown request fields (default `json.Decoder` behavior). An attacker sending `{"shortCode":"x","role":"admin"}` gets 200 + an audit log entry with identical before/after snapshots — no signal to operator that a probe happened. Fix: add `json.DisallowUnknownFields()` in a security-hardening pass. [`classlite-api/internal/handler/settings_handler.go:1520-1555`]
- **CR-2-5A-4** — Graduated `centerCreated` checklist row is a full-width `<button>` (targetShipped=true) that navigates to `/settings` even when `done: true` (currentCenter != null → always done for signed-in Owners). Neighboring done rows are inert. Inconsistent affordance — checkmarked item unexpectedly acts like a link. Design decision deferred to Story 3.x checklist-refresh. [`classlite-web/src/features/dashboard/FinishSetupCard.tsx:649-666`]
- **CR-2-5A-5** — Timezone parity regex `"([A-Z][a-zA-Z_]+/[A-Z][a-zA-Z_]+)"` captures IANA-shaped strings inside JSDoc / comments, not just inside the whitelist array. Fragile against future doc-comment additions. Fix: replace regex with a JS-side export manifest read via `go run` shim, or constrain regex scope to the array literal. [`classlite-api/internal/service/settings_timezone_parity_test.go:2565`]
- **CR-2-5A-6** — Graduated FinishSetupCard branch (targetShipped=true) fires no Sentry breadcrumb on click. Non-graduated items emit `dashboard-dead-link-tapped` with `{targetPath, targetSurface, epicNum}` for feature-demand analytics. Click-through funnel for shipped surfaces is invisible in Sentry. Add matching breadcrumb in the graduated branch during the checklist-refresh pass. [`classlite-web/src/features/dashboard/FinishSetupCard.tsx:649-666`]
- **CR-2-5A-7** _(demoted from Round-1 review P6)_ — Owner briefly sees PermissionDenied while `useRole()` returns null during auth boot. Currently `useRole()` returns null perpetually (Story 1-7c stub — `RoleContext.default = null` + no production provider wiring), so a null-loading guard would render an eternal skeleton for real users instead of the expected PermissionDenied. Real fix requires Story 2-6's role-aware auth wiring to introduce a distinct "role loading" state so `if (roleLoading) return <Skeleton /> else if (role !== 'owner') return <PermissionDenied />` distinguishes boot vs deny. Revisit inside Story 2-6's review pass. [`classlite-web/src/features/settings/SettingsPage.tsx:60`]

## Deferred from: code review of story-2-5a Round 1 — sqlc regen reminder (2026-07-15)

- **CR-2-5A-8 (Ops)** — The D4 patch modified `classlite-api/internal/store/queries/centers.sql UpdateCenter` (new `clear_fields text[]` param + `CASE WHEN … ANY($clear_fields)` branches on nullable columns) and hand-edited `classlite-api/internal/store/generated/centers.sql.go` to match. Before merging story-2-5a, **run `scripts/codegen.sh`** to canonicalize the generated file. The manual edit is minimal (add `ClearFields []string` to `UpdateCenterParams` + reorder call args to `arg.ID, arg.ClearFields, arg.Name, …`); running sqlc should produce an identical file modulo comment placement. Not blocking test execution — the hand-augmented file compiles and matches the SQL — but violates XL-1 read-only-generated-code rule until regenerated.
