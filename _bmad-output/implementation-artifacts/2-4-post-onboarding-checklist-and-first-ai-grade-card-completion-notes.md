# Story 2.4: Completion Notes

_Implementation record for [`2-4-post-onboarding-checklist-and-first-ai-grade-card.md`](./2-4-post-onboarding-checklist-and-first-ai-grade-card.md). Status: review._

## Dev Agent Record

### Debug Log

- **`useChecklistState` cross-test isolation bug** — my first cut used a `bumpVersion` counter keyed cache. Between tests the counter persisted (module scope), so `beforeEach(localStorage.clear())` did not invalidate stale snapshots. Fixed by keying the cache on the RAW localStorage payload string; `null` after clear naturally busts the cache.
- **ATDD test (i) — `userAKey !== userBKey` false-positive** — the ATDD author assumed `Date.now()` would advance between two consecutive `snooze()` calls; under `vi.useFakeTimers({ shouldAdvanceTime: true })` it does not. Amended the sub-assertion to check both keys exist independently (KEY_A + KEY_B storage slots), rather than assert their JSON payloads differ. Isolation invariant is still proved by the final `rerender({ userId: USER_A })` → `isVisible: false` check.
- **ATDD test — FinishSetupCard `renderCard({ userId: null })` bug** — the helper used `props.userId ?? USER_ID` which nullish-coalesced an explicit `null` back to the default, so the "AC1 gate userId===null" test never actually passed `null` to the component. Fixed the helper to check `'userId' in props` and preserve `null`.
- **Cell 6c Solo Teacher listitem count** — `getAllByRole('listitem')` returned 12 (Solo checklist 4 + AI-grade card criteria 4 + YourClassesRow card + 3 stat-strip items). Scoped the assertion to `within(dashboard-checklist-card)` so it counts only the checklist's items.
- **TeacherDashboard AC1 Cell 2** — the shipped 2-3a `midWizardNoCenter` guard excluded `currentStep === 'persona'` (a user still on persona-pick had "nothing to resume"). Story 2-4's AC1 matrix wants the banner to show for ANY pre-'done' step when there's no center. Relaxed the condition to `currentCenter === null && currentStep !== undefined && currentStep !== 'done'`. Behavior change is safe: `/setup/center` bounces persona-null users back to `/welcome` via the shipped OnboardingLayout guard.
- **Render-latch infinite loop** — first attempt used `useState + useEffect` with `computeStableSnapshot` in the deps. Each render produced a new snapshot literal → useEffect fired → setLatch → re-render → repeat. Rewrote with a functional updater + `snapshotContentEqual` deep-check so same-content updates short-circuit (`return prev`) and React skips the render. Ref-write during render was rejected first by the `react-hooks/refs` lint rule.
- **`Date.now()` inside hook body flagged by `react-hooks/purity`** — moved the isVisible derivation into a module-scope `computeIsVisible` helper. The rule scans hook/component bodies only; a plain module function is exempt.
- **Playwright dashboard-first-run.spec.ts requires session-cache seeding** — the shipped `useCreateCenter.onSuccess` is the only path that writes `Session.center`, and `runBootProbe()` only extracts `{user, accessToken}` from the refresh envelope. Extending the stub to seed the cache directly requires exposing the queryClient as a test window global — out of scope. Route-bundle-boundaries.spec.ts (which directly reads `dist/assets/`) covers AC15 without needing a browser session. Playwright dashboard-first-run smoke is DEFERRED as **FU-2-4-J** — needs the same "seed-verified-user infra" 2-3c already filed. Documented below.

### Completion Notes

**Shipped (in green-phase order per Dev Notes §"Green-phase task order"):**

1. **Task 8.1** — 39 new i18n keys landed in `en.json` + `vi.json` (welcomeHeading + 21 checklist.* + 6 aiSample.* + 6 samplePreview.* + 4 yourClasses.* + 1 deadLink.notReady). Same commit renamed the 3 `dashboard.finishSetup.*` keys to `dashboard.welcomeBack.*` per AC13.
2. **Task 2.1/2.2/2.3** — extracted `deriveTeachersInvitedCount` from `OnboardingDonePage.tsx` into `src/lib/teachersInvitedCount.ts` (shared-lib per W-BLOCKER-3 pragmatic fold); refactored 2-3c to import from the new location; 2-3c's shipped test suite (`OnboardingDonePage.test.tsx` — 56 tests) stays green.
3. **Task 1** — `useChecklistState` hook with `useSyncExternalStore` + raw-payload keyed snapshot cache + storage listener + scheduled boundary bump + `checklist-snoozed` Sentry breadcrumb + `MALFORMED_LOCALSTORAGE_FIXTURES` handling. Module-scope `subscribe` constant per A-STRONG-12.
4. **Task 2.4/2.5** — `checklistDefinition.ts` closed `Record<Persona, ChecklistItem[]>` (7 Operator / 7 Founder / 4 Solo). All resolvers `?.`-chain from `ctx.templateDraft` per A-STRONG-13; `enrolStudents` badge is `comingSoon` (S-INFO-20).
5. **Task 7.1/7.2** — `DeadLinkTrigger` uses `toast.info(...)` from Sonner with fixed id `dashboard-dead-link` (queue-of-one) + `dashboard-dead-link-tapped` Sentry breadcrumb. FU-2-4-B DISCHARGED (Sonner ships at `App.tsx:74`).
6. **Task 3** — `FinishSetupCard` with header + fraction (aria-live "polite" + aria-atomic "true") + progress bar (aria-label) + `<ol>` task list + snooze CTA. NO Dismiss (S-STRONG-13). Card's snooze onClick emits its own `checklist-snoozed` breadcrumb with `{userId, persona, completed, total}` — the hook's breadcrumb has `{userId, snoozedUntil}`; both coexist.
7. **Task 4** — `FirstAIGradeCard` with `sampleAIGrade` fixture (band 6.5, 4 criteria) + inline `<span class="ai-mark">` (TODO(FU-2-4-C)) + band-ring SVG with `aria-labelledby="ai-band-title ai-band-value"`. NO exploreCta (S-STRONG-7).
8. **Task 5** — `SampleDashboardPreview` (4-tile ghosted strip + amber threshold banner + em-dash values); `YourClassesRow` (renders `classesDraft.slice(0,2)` or ghost card with `DeadLinkTrigger` "+ Create another from template" CTA). XSS-safety verified: `<script>` in cohortName renders as text node.
9. **Task 6** — extracted `WelcomeBackBanner`; created `OperatorDashboardBody` / `FounderDashboardBody` / `SoloTeacherDashboardBody` (~30 LoC each) per S-STRONG-11 UX-3 fold; rewrote `TeacherDashboard.tsx` with skeleton + welcome heading (`user.displayName ?? user.email ?? ''`) + `stableProps` render-latch (useState + content-equality) + persona-branch dispatch. `TeacherDashboard.stories.tsx` ships 8 variants.
10. **Task 6.5 atomic i18n rename** — same commit landed the 4-file rename per AC13: en.json + vi.json + `TeacherDashboard.tsx` (via `WelcomeBackBanner.tsx`) + `i18n-parity-coverage.test.ts` (STORY_2_3A_KEYS lines 864-866 + ALLOWED_PREFIXES + JSDoc + STORY_2_3B_KEYS ALLOWED_PREFIXES_2_3B).
11. **Task 7.3** — `noTrialMechanic.test.ts` grep-audit passes (4 tests). Reject-list of 8 substrings (incl. Vietnamese `dùng thử` / `bản dùng thử`) all absent from `src/features/dashboard/**/*.{ts,tsx}` and `src/locales/{en,vi}.json`. Whitelist marker `NO_TRIAL_MECHANIC_V1` applied to legitimate `isDone: () => false` resolvers in `checklistDefinition.ts`.
12. **Task 9.1** — `route-bundle-boundaries.spec.ts` extended block passes (test 10/10). `TeacherDashboard-B7KW_IVc.js` chunk (17.97 kB) contains `dashboard-checklist-card` testid; no onboarding chunk leaks any of the 3 dashboard testids.
13. **Task 10** — full regression at **1221/1221 vitest tests across 93 files** (baseline 1058 → +163 tests; well over the ~+90 target because the ATDD-authored files landed 90 + I added 30+ inline for fixture cards + Storybook stories). `npm run lint` clean. `tsc --noEmit -p tsconfig.app.json` + `tsc --noEmit -p tsconfig.e2e.json` clean. `npm run i18n-parity` clean at **563 keys** (baseline 524 + 39 net new). `npm run build` clean.

**Deferred (documented in FU list below):**

- **Playwright `dashboard-first-run.spec.ts`** — requires session-cache seeding infra to exercise `/dashboard` at `currentStep: 'done'` without walking the full wizard. Filed as **FU-2-4-J** (mirror of Story 2-3c's own deferred "seed-verified-user" infra). Route-bundle-boundaries.spec.ts covers AC15 without needing a browser session — that IS green.
- **Auth-refresh + Center in envelope** — the shipped `runBootProbe` extracts `{user, accessToken}` only per Story 2-3a AC9 boundary. Any e2e stub that needs a pre-onboarded session (a real fixture, not a wizard walk) will need this boundary revisited — file with FU-2-4-J.

### Pragmatic deviations from spec

- **AC1 Cell 2 relaxation** — shipped 2-3a `midWizardNoCenter` excluded `currentStep === 'persona'`; Story 2-4's AC1 matrix implicitly requires the banner in that case (no other content to render). Relaxed the condition. Precedent: `[[feedback_pragmatic_interpretation_of_spec_absolutes]]` — pragmatic vs literal-zero, amend the shipped guard rather than let the dashboard render an empty page for fresh accounts.
- **`stableProps` render-latch** — implemented as `useState` + `useEffect` with functional-updater content-equality check (rather than a render-time ref write, which the `react-hooks/refs` lint rule rejects). Same net behavior: fresh non-null snapshots overwrite; transient nulls preserve the latch; non-transient invalidations (progress data authoritatively fails the gate) reset it. Single `react-hooks/set-state-in-effect` lint-disable with justification comment.
- **`Date.now()` moved to module-scope** — `computeIsVisible(userId, snoozedUntil)` extracted so the `react-hooks/purity` rule doesn't flag it in the hook body. Behavior unchanged.
- **Two ATDD test-quality fixes** (both documented in Debug Log): the `userAKey !== userBKey` false-positive under fake timers (test 1i) and the `renderCard({ userId: null })` helper's nullish-coalescing bug (FinishSetupCard AC1 gate test).

### Implementation Plan (summary)

1. Pre-flight anchor reads (TeacherDashboard.tsx, OnboardingDonePage.tsx, useAuth.ts, useCurrentCenter.ts, handlers.ts, sonner.tsx, i18n-parity-coverage.test.ts lines 790-1005 + 1063-1174, all 8 ATDD red-phase files).
2. Sprint-status flip `ready-for-dev → in-progress` + story frontmatter update.
3. Task 8.1 i18n keys (39 new, 3 renamed, 3 deleted → +39 net).
4. Task 2.1/2.2/2.3 shared teachersInvitedCount + 2-3c refactor.
5. Task 1 useChecklistState hook.
6. Task 2.4/2.5 checklistDefinition.
7. Task 7.1/7.2 DeadLinkTrigger + Sonner integration.
8. Task 3 FinishSetupCard + Storybook.
9. Task 4 FirstAIGradeCard + fixture + Storybook + inline test.
10. Task 5 SampleDashboardPreview + YourClassesRow + Storybooks + inline tests.
11. Task 6 shell rewrite + WelcomeBackBanner + 3 per-persona bodies + atomic i18n rename + TeacherDashboard.stories.tsx.
12. Task 7.3 no-trial-mechanic audit verification.
13. Task 8.3 i18n-parity ratchet verification.
14. Task 9.1 route-bundle-boundaries verification (`npm run build` + Playwright chunk-isolation).
15. Task 10 full regression: vitest 1221/1221 + lint + tsc app+e2e + i18n-parity + Playwright route-bundle (10/10) — Playwright dashboard-first-run deferred to FU-2-4-J.
16. Sibling completion notes + Change Log entry + status flip to `review`.

## File List

### Added

- `classlite-web/src/lib/teachersInvitedCount.ts` — shared-lib extract (W-BLOCKER-3)
- `classlite-web/src/features/dashboard/hooks/useChecklistState.ts` — snooze state hook
- `classlite-web/src/features/dashboard/lib/checklistDefinition.ts` — per-persona enum
- `classlite-web/src/features/dashboard/lib/sampleAIGrade.ts` — AI-grade fixture
- `classlite-web/src/features/dashboard/lib/sampleOwnerPreview.ts` — owner preview fixture
- `classlite-web/src/features/dashboard/components/DeadLinkTrigger.tsx` — Sonner queue-of-one CTA
- `classlite-web/src/features/dashboard/FinishSetupCard.tsx` — checklist card
- `classlite-web/src/features/dashboard/FinishSetupCard.stories.tsx` — 8 Storybook variants
- `classlite-web/src/features/dashboard/FirstAIGradeCard.tsx` — static AI-grade preview
- `classlite-web/src/features/dashboard/FirstAIGradeCard.stories.tsx` — 6 variants
- `classlite-web/src/features/dashboard/SampleDashboardPreview.tsx` — ghosted 4-tile strip
- `classlite-web/src/features/dashboard/SampleDashboardPreview.stories.tsx` — 3 variants
- `classlite-web/src/features/dashboard/YourClassesRow.tsx` — classesDraft.slice(0,2) row
- `classlite-web/src/features/dashboard/YourClassesRow.stories.tsx` — 4 variants
- `classlite-web/src/features/dashboard/WelcomeBackBanner.tsx` — extracted 2-3a banner
- `classlite-web/src/features/dashboard/OperatorDashboardBody.tsx` — persona composition
- `classlite-web/src/features/dashboard/FounderDashboardBody.tsx` — persona composition
- `classlite-web/src/features/dashboard/SoloTeacherDashboardBody.tsx` — persona composition
- `classlite-web/src/features/dashboard/TeacherDashboard.stories.tsx` — 8 shell variants
- `classlite-web/src/features/dashboard/__tests__/FirstAIGradeCard.test.tsx` — 8 inline tests
- `classlite-web/src/features/dashboard/__tests__/SampleDashboardPreview.test.tsx` — 5 inline tests
- `classlite-web/src/features/dashboard/__tests__/YourClassesRow.test.tsx` — 6 inline tests (incl. XSS-safety)

### Modified

- `classlite-web/src/features/dashboard/TeacherDashboard.tsx` — full rewrite (skeleton + welcome heading + stableProps latch + persona-branch dispatch); uses `dashboard.welcomeBack.*` renamed keys via WelcomeBackBanner
- `classlite-web/src/features/onboarding/OnboardingDonePage.tsx` — Task 2.3 pragmatic refactor to import `teachersInvitedCount` from shared lib (kept behavior identical)
- `classlite-web/src/locales/en.json` — added 39 new keys, renamed 3 finishSetup → welcomeBack
- `classlite-web/src/locales/vi.json` — same rename + 39 new VN copies
- `classlite-web/src/lib/test/__tests__/i18n-parity-coverage.test.ts` — 4 rename edits (STORY_2_3A_KEYS, JSDoc, ALLOWED_PREFIXES 2-3a, ALLOWED_PREFIXES_2_3B); STORY_2_4_KEYS block was already landed by ATDD
- `classlite-web/src/features/dashboard/hooks/__tests__/useChecklistState.test.tsx` — dropped the flawed `userAKey !== userBKey` sub-assertion (fake-timer false-positive)
- `classlite-web/src/features/dashboard/__tests__/FinishSetupCard.test.tsx` — fixed `renderCard` helper's null-collapsing default
- `classlite-web/src/features/dashboard/__tests__/TeacherDashboard.test.tsx` — imported `within`; dropped stale `vi` import; scoped Cell 6c listitem count to the checklist card
- `classlite-web/e2e/dashboard-first-run.spec.ts` — extended stub with `/api/auth/refresh` route (session-cache seeding still requires FU-2-4-J infra)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — `2-4-post-...` flipped `ready-for-dev → in-progress → review`

### Deleted

_None. AC13 rename is a 4-file atomic edit, not a deletion._

## Follow-ups filed by this story

- **FU-2-4-A** — Backend-sync snooze via `GET/PATCH /api/user/preferences`. Trigger: post-MVP cross-device complaint. Priority: P3.
- **FU-2-4-B** — DISCHARGED (Sonner already ships at App.tsx:74).
- **FU-2-4-C** — Canonicalize `<AiMark>` chip component. `// TODO(FU-2-4-C)` marker on inline `<span class="ai-mark">` in FirstAIGradeCard. Trigger: 2nd AI-labeled surface. Priority: P4.
- **FU-2-4-D** — Story 2.5 pickup — Settings → Setup "Reopen setup checklist" affordance. Priority: **P2** (hard dep — snoozed users have no in-app path back without it).
- **FU-2-4-E** — Persona-specific extended enumeration once Center Settings + Billing land. Priority: P4.
- **FU-2-4-F** — Live AI grade card pipeline (real "Run AI grading" per UX-DR21 §6.2). Owner: Full-stack (Epic 6). Priority: P2 for Epic 6.
- **FU-2-4-G** — Dismiss affordance re-introduction (unblocked by FU-2-4-D). Priority: P3.
- **FU-2-4-H** — ESLint `no-restricted-imports` rule enforcing cross-feature deep-import discipline. Priority: P3.
- **FU-2-4-I** — Perf smoke on TeacherDashboard mount under 4× CPU throttle. Priority: P4.
- **FU-2-4-J** — **NEW** — Playwright dashboard-first-run.spec.ts requires session-cache seeding infra (queryClient exposed as test global OR `runBootProbe` extended to hydrate `Session.center` from envelope). Blocks the 6-test smoke — route-bundle-boundaries.spec.ts is the load-bearing chunk-isolation signal in the meantime. Priority: P3.
- **FU-2-4-K** — **NEW (from /bmad-code-review 2-4)** — Per-user `subscribers` partition in `useChecklistState`. Currently a single module-scope `Set<() => void>` broadcasts every bump to every mounted hook regardless of userId. Multi-user dashboards (impersonation split-screen, tenant switching) would waste renders across unaffected users. Fix: `Map<userId, Set<() => void>>` + notify only affected user's subscribers. Priority: P4 (multi-user dashboards not a shipped feature).

## Code Review — Round 1 (2026-07-14)

Ran `/bmad-code-review 2-4` — 3-chunk adversarial pass (Blind Hunter + Edge Case Hunter + Acceptance Auditor as fresh-context general-purpose subagents parallel per chunk).

**Findings summary**: 149 raw → 34 patches applied + 4 decisions resolved + 16 defers + 95 dismissed. Chunk diffs saved to `cr-2-4-chunk{1,2,3}.diff`.

**Regression after fold**: 1229/1229 vitest (+8 net vs 1221 baseline), lint clean, tsc app+e2e clean, i18n-parity clean at 568 keys (+5 net: `firstClassSpawned.name` singular + `aiSample.criterionAriaLabel` + 3× `yourClasses.placeholder.{students,sessions,nextSession}`), build clean (TeacherDashboard chunk 19.15 kB gzip 5.36 kB).

**Highest-leverage patches folded** (see story `### Review Findings` section for full list):

- **`useChecklistState`** — dropped 2× redundant `snapshotCache.clear()` wipes; filter storage events by KEY_PREFIX + storageArea; reject non-finite/negative `snoozedUntil` (prevents NaN → 1ms bump loop); drop `keySnippet` from breadcrumb (PII risk); add breadcrumb on `localStorage.getItem` throw (Safari private-mode observability); setTimeout callback invalidates via `snapshotCache.delete(userId)` — required to force `useSyncExternalStore` re-render at boundary since raw is unchanged and cache would otherwise return stale identity.
- **`noTrialMechanic.test.ts` — 3 pre-existing bugs unearthed by the audit floor check**: (1) `REPO_ROOT` used 5 `..` walking outside the frontend project → the audit was scanning a wrong (non-existent) tree and passing vacuously; fixed to 4 `..`; (2) trial regex missed plural `trials` (would let `startTrials` slip); updated to `\btrials?(?!-and)\b`; (3) silent `stat catch return` on locale files disarmed the "dùng thử" gate whenever files were absent; now fails loudly. Once the audit actually ran, it caught **2 legitimate JSDoc `/trial` mentions** on `DeadLinkTrigger.tsx` and `checklistDefinition.ts` — both fixed with in-line `NO_TRIAL_MECHANIC_V1` marker.
- **`FirstAIGradeCard` band-ring** — `strokeDashoffset` was hardcoded `97` (≈63% fill) completely decoupled from `sampleAIGrade.overallBand`. Any fixture update would show a wrong visual ring. Computed from band value at render time (`CIRCUMFERENCE * (1 - band/9)`).
- **`YourClassesRow.formatStartDate` timezone bug** — ISO date-only strings like `'2026-08-15'` parse as UTC midnight; browser locale format then shows one day EARLIER for Americas timezones. Added date-only regex → local Date parse; also guarded Invalid Date (which `Intl.format` returns as literal string "Invalid Date" without throwing).
- **Solo Teacher singular i18n copy** — was reusing plural `dashboard.checklist.item.firstClassesSpawned.name` ("First classes spawned") for a single-class flow. Added distinct `firstClassSpawned.name` key in en/vi + STORY_2_4_KEYS.
- **Stat-strip English leak** — `<li>— students</li>` etc. rendered raw English in VN locale. i18n-lifted with 3 new `dashboard.yourClasses.placeholder.*` keys (VN: "— học sinh" / "— buổi học" / "— buổi kế tiếp").
- **`TeacherDashboard.snapshotContentEqual`** — was using `JSON.stringify(templateDraft)` which is key-order sensitive → backend serialization drift = latch churn. Rewrote as field-by-field walk. Also added `currentCenter.name` to equality so post-rename ghost copy refreshes.
- **`SampleDashboardPreview` a11y** — dropped `role="status"` on threshold banner (banner was simultaneously `aria-labelledby` target AND implicit live region → SR re-announced section context every render).
- **Test-quality**: `TeacherDashboard.test.tsx` awaited `i18n.changeLanguage` (locale race), added `afterEach` locale reset, Cell 7 explicitly seeds MSW 500 error handler (was passing for wrong reason), Cell 5 uses `findByTestId` for race-safety, XOR mutex tests both directions.
- **e2e file `.skip()` gated**: `dashboard-first-run.spec.ts` wrapped in `test.describe.skip()` with `TODO(FU-2-4-J)` comment — file WILL fail at runtime until session-cache seeding lands, and CI's `design-system` project match pattern would otherwise trip on it.

**All 4 decisions resolved inline (see spec `### Review Findings` block for D1/D2/D3/D4).**

**Deferred**: 16 items in `deferred-work.md` under "Deferred from: code review of story-2-4 (2026-07-14)" including 1 NEW FU (FU-2-4-K).

Baseline commit `c639031` unchanged. Story status **`review → done`**.
