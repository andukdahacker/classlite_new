# Story 6.4b: Completion Notes

_Implementation record for [`6-4b-auto-grading-reading-listening-vocabulary-frontend.md`](./6-4b-auto-grading-reading-listening-vocabulary-frontend.md). Status: review._

## Dev Agent Record

### Debug Log

- **`releasedProjection` shape mismatch (Task 1 ↔ Task 8).** The api.yaml/#1=A wire contract is `{rawScore, band}`, but the AC17a Go red test asserts a **pointer** `*AutoGradeReleasedProjection` with `{RawScore, MaxScore, Percentage, Band}` (it uses `== nil` checks + reads `.MaxScore`). Resolved by making the **service** struct the richer pointer shape (satisfies the red test) while the **handler** serializes only `{rawScore, band}` to the wire (satisfies #1=A / the FE type). Both the projection unit test and the e2e integration test pass.
- **`onUnhandledRequest: 'error'` + the grading queue.** The ATDD component test deliberately does not mock `/api/classes/*/grading-queue`. With the strict MSW policy, wiring `useGradingQueue` into the objective page would fail every test. No AC covers queue nav → the page omits the QueueBar (documented deviation; the shared bar can layer in later once the test seeds the queue).
- **AC16 overturns a stale 6.3a dispatcher test.** `SpeakingGradingPage.test.tsx` asserted `reading` + no autoGrade → `unsupportedSkill`; AC16/D1 intentionally reclassifies that as `autoGradeUnavailable`. Retargeted the stale case to a genuinely-unsupported `general` skill so it still exercises the P4 unsupported path.
- **Band rendering `9.0`→`"9"`.** i18next interpolates numbers with their default `toString` (9.0 → "9"), which broke the E2E's `/9\.0/` matchers and read poorly. Added a `formatBand(n) => n.toFixed(1)` helper (IELTS half-band grid); component tests stay green (their fixtures use `5.5`/`6.5`).
- **AC17b Playwright cannot run in the mocked harness.** Removing `test.fixme()` and running `--project=design-system` showed all 4 tests fail — the staff `RouteRoleGate` withholds the grading surface because the mocked harness has no way to seed the `['auth','session']` role slot (a stubbed `/api/auth/refresh` alone does not admit it). This is the FU-2-5-N session-cache gap + Story-1.5 deferred login, both this story's Out of Scope. Restored to `test.describe.skip()` (correct-by-construction bodies retained) matching the ratified `route-role-gate.spec.ts` / `dashboard-first-run.spec.ts` precedent → **4 skipped, exit 0**.
- **`jsonbmigrate` parallel-run flake.** `go test ./...` flagged one FAIL in `tools/jsonbmigrate` (a package this story never touches); it passes fresh in isolation. Same DB-contention flake class the 6-4a notes document ("passes in isolation").

### Completion Notes

Shipped the s25 teacher objective-grading review surface as a thin full-stack slice over 6-4a's frozen contract, plus the one additive server field (`releasedProjection`, #1=A):

- **Backend (Task 1):** stripped the `[PROVISIONAL]`/D16 markers from api.yaml; added `AutoGradeReleasedProjection` + populated it unconditionally with the definitive as-if-released score/band in `buildAutoGradeView` (so both the override-returned view and the grading read carry it). Handler serializes `{rawScore, band}`. `codegen.sh` diff on `client.ts` is exactly 3 comment strips + the one additive field + its nested schema.
- **Frontend (Tasks 2–7):** two hooks (`useOverrideAutoGradeAnswer` seeds `gradingKeys.detail` on success + invalidates `detail` only; `useReleaseAutoGrade` invalidates `detail` + `all`); `gradingKeys` gained `overrideMutation`/`releaseMutation`; `GradingRoute` gained the objective branch (dispatch on `autoGrade != null` before the skill check) + the AC16 `autoGradeUnavailable` fall-through keyed on `OBJECTIVE_SKILLS`; `ObjectiveGradingPage` (+ `AutoGradeAnswerRow`, `ReleaseReckoningDialog`) renders the summary band, `flattenQuestions`-ordered breakdown, single-click override with in-flight disable + per-code error toasts, the D9 release reckoning reading `releasedProjection` verbatim, and the post-release read-only remount; flat `objectiveGrading.*` keys in both locales.
- **Tests (Task 8):** AC17a Go integration test de-redded and green (the substantive R16 + D7 contract proof); 33 component + 34 i18n MSW tests green; full web suite 2895/210 with zero regressions.

**Deviations (all documented, none violate an AC):**
1. QueueBar/`useGradingQueue` not wired (ATDD test omits the queue mock under strict MSW; no AC covers it).
2. AC17b Playwright left `describe.skip` (FU-2-5-N infra gap, Out of Scope) — the substantive proof is the green AC17a Go leg + the reliable MSW component suite.
3. `flattenQuestions`/`parseHandle`/`buildHandle`/`FlatQuestion` promoted to the `quiz-attempt` barrel (were deep-only) so the grading feature reuses them via the barrel (TS-7).
4. `formatBand` one-decimal display added (IELTS grid + i18next number rendering).

### Implementation Plan (as executed)

1. Task 1 — api.yaml strip + `releasedProjection` (service + handler) → `codegen.sh` → client.ts diff verified → projection unit test.
2. Task 2 — `gradingKeys` members + `useOverrideAutoGradeAnswer` + `useReleaseAutoGrade` + barrels.
3. Task 3 — `GradingRoute` objective branch + `autoGradeUnavailable` fall-through.
4. Tasks 4–6 — `ObjectiveGradingPage` (shell + summary band + breakdown table + override interaction + release reckoning dialog).
5. Task 7 — `objectiveGrading.*` keys in en.json + vi.json.
6. Task 8 — de-red Go integration (pointer-widen `ReleasedProjection`) + component/i18n green; retarget stale 6.3a dispatcher test; `formatBand`; E2E de-red attempt → `describe.skip` (FU-2-5-N); full verify (tsc -b, vitest, eslint, both backend legs).

## File List

### Added

- `classlite-api/internal/service/auto_grade_projection_test.go` — unit proof that `ReleasedProjection` == `definitiveScore` pre/post release.
- `classlite-web/src/features/grading/ObjectiveGradingPage.tsx` — the s25 objective review page (+ `AutoGradeAnswerRow`, `ReleaseReckoningDialog`, states).
- `classlite-web/src/features/grading/api/useOverrideAutoGradeAnswer.ts` — override hook (seed detail on success, invalidate detail only).
- `classlite-web/src/features/grading/api/useReleaseAutoGrade.ts` — release hook (no body; invalidate detail + all).

### Added (ATDD artifacts, de-redded this story)

- `classlite-api/internal/test/auto_grade_e2e_6_4b_atdd_test.go` — AC17a Go integration (build tag removed → green).
- `classlite-web/src/features/grading/__tests__/ObjectiveGradingPage.test.tsx` — 33 component tests (green).
- `classlite-web/src/features/grading/__tests__/story-6-4b-i18n.test.ts` — 34 i18n parity tests (green).
- `classlite-web/e2e/objective-grading-6-4b.spec.ts` — AC17b mocked Playwright (`describe.skip`, FU-2-5-N).

### Modified

- `classlite-api/api.yaml` — stripped PROVISIONAL/D16 markers; added `AutoGradeReleasedProjection` + required `releasedProjection` on `AutoGradeView`.
- `classlite-api/internal/service/auto_grade_service.go` — `AutoGradeView.ReleasedProjection *AutoGradeReleasedProjection` + populate in `buildAutoGradeView`.
- `classlite-api/internal/handler/auto_grade_handler.go` — wire `{rawScore, band}` projection (nil-guarded).
- `classlite-web/src/lib/api/client.ts` — regenerated (comment strips + 1 additive field + nested schema).
- `classlite-web/src/features/grading/GradingRoute.tsx` — objective dispatch branch + `autoGradeUnavailable` fall-through + `OBJECTIVE_SKILLS`.
- `classlite-web/src/features/grading/api/gradingKeys.ts` — `overrideMutation` + `releaseMutation` members.
- `classlite-web/src/features/grading/index.ts` — export page + hooks + types.
- `classlite-web/src/features/quiz-attempt/index.ts` — export `flattenQuestions`/`parseHandle`/`buildHandle`/`FlatQuestion` (TS-7 barrel reuse).
- `classlite-web/src/locales/en.json`, `vi.json` — flat `objectiveGrading.*` keys.
- `classlite-web/src/features/grading/__tests__/SpeakingGradingPage.test.tsx` — retargeted the stale 6.3a `reading→unsupported` dispatcher case to `general` (AC16 overturns the old behavior).

### Deleted

- None.
