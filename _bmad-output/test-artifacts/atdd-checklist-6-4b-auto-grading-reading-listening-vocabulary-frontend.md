---
stepsCompleted: ['step-01-preflight-and-context', 'step-02-generation-mode', 'step-03-test-strategy', 'step-04c-aggregate', 'step-05-validate-and-complete']
lastStep: 'step-05-validate-and-complete'
lastSaved: '2026-08-27'
generatedTestFiles:
  - 'classlite-web/src/features/grading/__tests__/ObjectiveGradingPage.test.tsx'
  - 'classlite-web/src/features/grading/__tests__/story-6-4b-i18n.test.ts'
  - 'classlite-api/internal/test/auto_grade_e2e_6_4b_atdd_test.go'
  - 'classlite-web/e2e/objective-grading-6-4b.spec.ts'
storyId: '6.4b'
storyKey: '6-4b-auto-grading-reading-listening-vocabulary-frontend'
storyFile: '_bmad-output/implementation-artifacts/6-4b-auto-grading-reading-listening-vocabulary-frontend.md'
atddChecklistPath: '_bmad-output/test-artifacts/atdd-checklist-6-4b-auto-grading-reading-listening-vocabulary-frontend.md'
inputDocuments:
  - '_bmad-output/implementation-artifacts/6-4b-auto-grading-reading-listening-vocabulary-frontend.md'
  - '_bmad-output/project-context.md'
  - 'classlite-web/vitest.config.ts'
  - 'classlite-web/playwright.config.ts'
  - 'classlite-api/internal/test/ (package test seeders)'
detectedStack: 'fullstack'
riskScore: 6
riskId: 'R16 (DATA immutability)'
wf8Gate: 'MANDATORY — red-first required before in-progress (risk score >= 6)'
---

# ATDD Checklist — Story 6.4b (Auto-Grading objective sections · Frontend)

## Step 1 — Preflight & Context

### Stack detection
- **Detected stack:** `fullstack` (web = React 19 / Vite / TanStack Query / Playwright / Vitest; api = Go `net/http` + pgx).
- This story is **frontend-led thin full-stack**: net-new page + 2 hooks + 1 dispatch branch on web, plus ONE additive Go field (`AutoGradeView.releasedProjection`) on api.

### Prerequisites (hard requirements) — ALL MET
- ✅ Story approved, `ready-for-dev`, 17 explicit ACs with Given/When/Then.
- ✅ Web test framework: `playwright.config.ts` + `vitest.config.ts` present; MSW, `vitest-axe`, `@testing-library/react`, `@axe-core/playwright` installed.
- ✅ Api test framework: `package test` in `classlite-api/internal/test/` with `SetupDB` (`helpers.go`), `fixtures.go`, existing `auto_grade_*_atdd_test.go`.
- ✅ Dev environment available (monorepo, docker-compose for Postgres).

### TEA config flags
- `tea_use_playwright_utils: true` — **NOTE / divergence:** this repo does NOT consume `playwright-utils`. E2E uses raw `@playwright/test` with `page.route('**/api/...')` mocking; component tests use MSW at the HTTP boundary (TEST-FE-1). Scaffolds honor the **repo's actual conventions**, not the util library. Flagged, not silently overridden.
- `tea_use_pactjs_utils: false`, `tea_pact_mcp: none` — no contract-testing tooling; the real-handler contract check is the AC17a Go integration test (per story Contract-drift note).
- `tea_browser_automation: auto`, `test_stack_type: auto` → resolved to `fullstack`.

### Story context (extracted)
- **17 ACs**, grouped: A. Dispatch (1,2,16) · B. Summary band (3,4) · C. Answer table (5,6,7) · D. Override (8,9) · E. Release (10,11,12) · F. i18n/a11y/tests (13,14,15,16,17).
- **Risk:** `risk_score: 6` — **R16 DATA immutability**. WF-8 HARD RULE → red-first FE component tests (`tsc -b` red) + the R16 proof legs land on the branch BEFORE `in-progress`. **ATDD is MANDATORY here, not skippable.**
- **The R16 immutability E2E leg rides THIS story** (6-4a covered DB-trigger + Go unit/integration; 6-4a Dev Notes:178 deferred the end-to-end leg here).
- Consumes 6-4a's FROZEN contract; co-finalizes it (D7) + adds ONE field (`releasedProjection`, RESOLVED #1=A).

### Existing patterns to mirror (recon'd)
- **Web components:** `SpeakingGradingPage.tsx` (1260-line single-file sibling), `SpeakingGradingPage.test.tsx`, `WritingGradingPage.test.tsx`.
- **Web i18n story tests:** `story-6-3c-i18n.test.ts` (per-story parity test template).
- **Web api hooks/keys:** `api/gradingKeys.ts`, `api/useGradeSpeaking.ts`, `api/useGradingSubmission.ts`.
- **Web MSW:** `src/test/msw-server.ts`, `src/test/mocks/handlers.ts`, feature-local `api/__tests__/handlers.ts` pattern.
- **Web E2E:** `e2e/*.spec.ts` mocked-API convention; `e2e/route-role-gate.spec.ts` for role-gate assertion pattern.
- **Api Go:** `auto_grade_submit_hook_atdd_test.go` (the only real-submit-hook seed — yields `correct`; the near-miss `needs_review` recipe is net-new), `auto_grade_override_release_atdd_test.go`, `helpers.go` (`SetupDB`), `fixtures.go` (`CreateCenterWithID`, `CreateCenterMember`).

### Red convention (per `reference_atdd_red_convention`)
- **FE red:** component tests `import { ObjectiveGradingPage }` (not-yet-built) → `tsc -b` fails (compile-red) until it exists. Green-phase SEAMS documented in a header block.
- **Go red:** `//go:build atdd_red_phase` tagged-compile-fail for the net-new AC17a integration test until the `releasedProjection` field + handler path exist.
- **Typecheck gate is `tsc -b`** (checks test files), NOT `tsc --noEmit` (per `reference_web_typecheck_gate_is_tsc_b`).

## Step 2 — Generation Mode

- **Chosen mode: AI Generation** (no browser recording).
- **Why:** ACs are fully specified with Given/When/Then + line-level file references; the frozen 6-4a contract + reuse map give deterministic inputs. Live recording is impossible — recon confirmed the Playwright harness mocks the API (`page.route`) and real login is deferred to Story 1.5, so there is no running screen to snapshot. `tea_browser_automation: auto` → recording skipped as inapplicable.

## Step 3 — Test Strategy (coverage matrix)

### Level-assignment principle (prefer the lowest level that proves the AC)
- **Component (Vitest + MSW)** — carries the bulk: dispatch, summary band, breakdown rendering, override recompute/seed, error-code discrimination, release reckoning dialog, post-release read-only, i18n parity, a11y, role-absent. The one FE mock seam is MSW at the HTTP boundary (TEST-FE-1). **Red via `import { ObjectiveGradingPage }` (compile-red until built).**
- **Go integration (`package test`, real DB in tx)** — carries the **substantive R16 proof AND the real-handler contract check** (AC17a): submit→autograde-`needs_review`→override→release→re-release-409→`releasedProjection` JSON. This is the ONLY leg touching real handler JSON (component MSW fixtures re-encode the same OpenAPI, so they cannot validate the contract — story Contract-drift note). **Red via `//go:build atdd_red_phase` tag until the field + path exist.**
- **E2E (Playwright, mocked API)** — carries ONLY "the UI *drives* the flow correctly" (AC17b): override + release → composite-key remount → read-only, reckoning dialog, mocked-409 toast. Deliberately thin — it does NOT re-assert component-level behavior and does NOT prove immutability through real infra (that's the Go leg + 6-4a's trigger).
- **No duplication:** the six error codes are asserted ONCE at component level (AC9/AC15); the release-409 *trigger* is proven ONCE in Go (AC17a); the Playwright leg mocks a single 409 to prove toast wiring, not the full matrix.

### AC → scenario → level → priority

| AC | Scenario | Level | Priority | Red mechanism |
|---|---|---|---|---|
| 1 | Objective submission (`autoGrade!=null`) dispatches to ObjectiveGradingPage before the skill check | Component | **P0** | import missing page |
| 1 | Regression: writing/speaking still dispatch to their pages | Component | P1 | import missing page |
| 1 | Genuinely-unsupported skill (no autoGrade, not w/s, not objective) still shows `unsupportedSkill` | Component | P1 | import missing page |
| 2 | UX-1 trilogy by reuse — loading `role="status"`, error `role="alert"`+retry, not-desktop seam | Component | P1 | import missing page |
| 3 | Summary band renders server `rawScore/maxScore`, `provisionalBand`, live "After-overrides" — UI computes nothing (D3) | Component | P1 | import missing page |
| 4 | **needs_review count + "counts as wrong on release" note + resolve-nudge (Jump to first)** | Component | **P0** | import missing page |
| 5 | Answer row: q#+text, studentAnswer, correctAnswer only when wrong/needs_review, result chip by `effectiveMark`, studentFlagged, **"edited" affordance when `overrideMark!=null` (D10)**, override buttons | Component | P1 | import missing page |
| 6 | needs_review row = first-class resolution affordance (side-by-side answer/variants, Accept/Mark-wrong, one-way consume); **negative:** correctAnswer/variants only in teacher view | Component | P1 | import missing page |
| 7 | Rows in document order grouped by section+group via `flattenQuestions(view.exercise)` keyed by colon `questionRef` | Component | P1 | import missing page |
| 8 | Override success → `effectiveMark`/`overrideMark`/After-overrides reflect recomputed view, **seed renders before invalidation refetch**, invalidate `detail` ONLY (D2) | Component | **P1** | import missing page |
| 8 | In-flight: that row's buttons disabled during round-trip (D5) | Component | P1 | import missing page |
| 9 | **Cache-integrity-after-failed-override** — failed override leaves prior view standing, no dangling write | Component | **P0** | import missing page |
| 9 | **Six error codes → six DISTINCT i18n toasts** (409×3 discriminate on `code` not status, 422, 404) | Component | **P1** | import missing page |
| 10 | Release confirm dialog: emails student note; **when needs_review>0 shows reckoning (provisional→`releasedProjection` delta, released number last)**; confirm→POST release (no body)→success toast + composite-key remount re-seeds released:true | Component | P1 | import missing page |
| 11 | Release failure (409 trio) → non-blocking toast; page stays usable | Component | P1 | import missing page |
| 12 | **Post-release read-only** — override controls disabled/absent, release CTA gone, definitive band shown; re-open renders read-only not fresh-editable | Component | **P1** | import missing page |
| 13 | `objectiveGrading.*` flat keys in BOTH `en.json`+`vi.json`; shared `grading.*` reused verbatim; assert key existence both locales (TEST-FE-4) | Component (i18n parity) | P1 | assert missing keys |
| 14 | TEST-FE-1..6 hold: MSW boundary, three-state named cases, axe+role queries, role-absent negative | Component | P1 | import missing page |
| 15 | WF-8 risk-6 red set present on branch before in-progress (meta-AC — satisfied by the P0/P1 component reds above) | Component | **P0 (gate)** | all of the above |
| 16 | Objective skill + `autoGrade==null` (submit-time grade failure) → `autoGradeUnavailable` state, NOT `unsupportedSkill`; negative-assert reading never shows unsupported copy (D1/Winston) | Component | **P0** | import missing page |
| 17a | **Go integration**: submit→autograde-needs_review(near-miss `necessary`/`nesessary`)→override→release→re-release-409→grading-read JSON incl. `releasedProjection` (real handler, the R16 + contract proof) | Go integration | **P0** | `atdd_red_phase` tag |
| 17b | **Playwright (mocked API)**: drive override+release → composite-key remount read-only + reckoning dialog + mocked-409 toast | E2E | P1 | drives missing route/page |

### Red-phase design confirmation
- **Every FE scenario is compile-red** until `ObjectiveGradingPage` (and its hooks/keys) exist — the file imports the not-yet-built module, so `tsc -b` (the gate) fails. This is the `reference_atdd_red_convention` FE pattern.
- **The i18n parity test is assertion-red** — `objectiveGrading.*` keys don't exist yet in `en.json`/`vi.json`, so key-existence assertions fail.
- **The Go integration test is compile-red** behind `//go:build atdd_red_phase` — it references `releasedProjection` (net-new field) and the near-miss end-to-end seed that no current test produces; the tag keeps CI green until de-redded at green phase.
- **The Playwright leg is red** — it navigates the objective grading screen / drives override+release, which don't render until the page ships.

### Flake pins baked into the scaffolds (Murat)
1. Composite-key remount → assert post-remount tree with `findBy*`, never the pre-remount tree.
2. The override MSW handler AND the subsequent `detail` refetch return the SAME recomputed `AutoGradeView` (divergence oscillates the seed-vs-refetch test).
3. Toasts via `findBy*` + `waitFor`/fake-timers (never race auto-dismiss).
4. `retry:false` + one `QueryClient` per test (TEST-FE-1).

## Step 4 — Red-Phase Scaffolds Generated (TDD RED)

**Execution mode:** subagent (2 parallel workers) — Worker A = classlite-web Vitest; Worker B = Go integration + Playwright.

### Red-mechanism note (deviation from the generic skill default — intentional, ratified)
The generic ATDD worker default is `test.skip()`. This project's **ratified** convention (`reference_atdd_red_convention` + story AC15/AC17) uses stronger, CI-appropriate red mechanisms instead. TDD-red compliance is satisfied by these — NOT by `test.skip()`:

| File | Red mechanism | Why this and not `test.skip()` |
|---|---|---|
| `ObjectiveGradingPage.test.tsx` | **compile-red** — imports missing `../ObjectiveGradingPage` + 2 hooks + reads `AutoGradeView.releasedProjection` | WF-8 gate wants `tsc -b` red on the branch until the page ships; skip would false-green the gate |
| `story-6-4b-i18n.test.ts` | **assertion-red** — asserts `objectiveGrading.*` keys absent from both locales | keys genuinely don't exist; the assertion IS the red |
| `auto_grade_e2e_6_4b_atdd_test.go` | **`//go:build atdd_red_phase` compile-red** — references `service.AutoGradeView.ReleasedProjection` (not yet a field) | tag keeps `go build ./...` green NOW (file excluded), red when enabled at green phase |
| `objective-grading-6-4b.spec.ts` | **`test.fixme()`** — full flow authored, fixme'd | keeps `playwright test` CI green; the page doesn't render yet so an active spec would hard-fail CI |

### Generated files (all on disk, RED)

| # | File | Tests | ACs | Priority | Level |
|---|---|---|---|---|---|
| 1 | `classlite-web/src/features/grading/__tests__/ObjectiveGradingPage.test.tsx` | 33 | 1,2,3,4,5,6,7,8,9,10,11,12,14,16 | P0×6, P1×27 | Component (MSW) |
| 2 | `classlite-web/src/features/grading/__tests__/story-6-4b-i18n.test.ts` | 34 | 13 | P1×34 | Component (i18n parity) |
| 3 | `classlite-api/internal/test/auto_grade_e2e_6_4b_atdd_test.go` | 1 | 17a | P0×1 | Go integration (real DB, real handler) |
| 4 | `classlite-web/e2e/objective-grading-6-4b.spec.ts` | 4 | 17b | P1×4 | E2E (Playwright, mocked API) |

**Total: 72 red test assertions across 5 conceptual suites.**

### Red evidence (intended seams only — no accidental reds)
- **Web `tsc -b`** fails ONLY on: `../ObjectiveGradingPage`, `../api/useOverrideAutoGradeAnswer`, `../api/useReleaseAutoGrade` (TS2307 ×3) + `AutoGradeView.releasedProjection` (TS2339). The stray unused-`beforeEach` was removed. i18n file has zero tsc errors (runtime assertion-red).
- **Go `go vet -tags atdd_red_phase ./internal/test/`** fails ONLY on `service.AutoGradeView.ReleasedProjection undefined` (7 occurrences). **`go build ./...` (untagged) exits 0** — CI stays green now.
- **Playwright** `--list` enumerates 4 fixme'd cases; the spec type-checks.
- Other repo diagnostics (`speakingOverallBand`, `computePeaks`, `WritingGradingPage`, `useAiGradeSpeakingJob`, `AudioWaveformPlayer`) are **pre-existing / unrelated to 6-4b** (files unmodified by this run; their source modules exist on disk — IDE TS-server staleness).

### AC coverage roll-up (all 17 ACs have red coverage)
- **A. Dispatch:** AC1 (dispatch + writing/speaking regression + unsupported), AC2 (UX-1 trilogy), AC16 (`autoGradeUnavailable` vs `unsupportedSkill`, negative-assert) — component.
- **B. Summary band:** AC3 (server numbers, no client math), AC4 (**P0** needs_review reckoning note + resolve-nudge) — component.
- **C. Answer table:** AC5 (row incl. "edited" affordance + conditional correctAnswer), AC6 (needs_review resolution row + teacher-only negative), AC7 (flattenQuestions document order vs scrambled array) — component.
- **D. Override:** AC8 (seed-vs-refetch flake-pinned + in-flight disable), AC9 (**P0** cache-integrity-after-failed-override + six distinct error codes) — component.
- **E. Release:** AC10 (reckoning dialog with provisional→releasedProjection delta + remount re-seed), AC11 (409-trio toast), AC12 (post-release read-only negative-render) — component.
- **F. i18n/a11y/tests:** AC13 (i18n parity both locales), AC14 (MSW boundary + three-state + axe + role-absent), AC15 (the risk-6 red set = satisfied by the P0/P1 component reds above), **AC17a (P0 Go integration — the substantive R16 immutability proof AND the real-handler `releasedProjection` contract check)**, AC17b (Playwright mocked UI flow).

### Green-phase activation (task-by-task — de-red as each ships)
1. **Task 1 (contract):** add `AutoGradeView.releasedProjection {rawScore, band}` to `api.yaml`, run `codegen.sh`, populate it in `buildAutoGradeView`/`populateAutoGrade` (Go). → clears the `releasedProjection` compile-reds (web TS2339 + Go field-undefined) and lets the Go test compile.
2. **Task 2 (hooks):** create `useOverrideAutoGradeAnswer.ts` (seed `gradingKeys.detail` + invalidate `detail` ONLY) + `useReleaseAutoGrade.ts` (invalidate `detail`+`all`). → clears 2 of the 3 web TS2307s.
3. **Task 3–4 (page + dispatch):** create `ObjectiveGradingPage.tsx` + the objective branch in `GradingRoute`. → clears the last TS2307; `vitest run` now executes the 33-test suite (turn each green).
4. **Task 7 (i18n):** add the `objectiveGrading.*` closed key set to `en.json` + `vi.json`. → turns `story-6-4b-i18n.test.ts` green.
5. **Task 8 (de-red the proof legs):** remove `//go:build atdd_red_phase` from the Go test (run it real); un-`fixme` the Playwright spec.

### TDD-red compliance: PASS (project convention)
- ✅ All suites assert EXPECTED behavior (no placeholder assertions).
- ✅ All marked `expected_to_fail`; all fail today via the documented mechanism.
- ✅ CI stays green NOW for the build-tag (Go) and fixme (Playwright) legs; the web `tsc -b`/`vitest` reds are the intended WF-8 branch gate.
- ✅ Mock seams honored: MSW at the FE HTTP boundary (TEST-FE-1); real DB in tx + real handler for the Go leg (TEST-BE-2/3); no `useQuery` mocking.

### Handoff notes for the dev (Amelia)
- **Branch first.** These reds currently sit on `main`'s working tree (uncommitted). WF-8 wants them on a `web/feat/6-4b-*` branch BEFORE `in-progress`. Recommend branching, then committing the 4 test files (+ this checklist) as the red-phase baseline.
- **Fixture consistency (AC8 flake pin):** the override MSW handler AND the subsequent `detail` refetch must return the SAME recomputed `AutoGradeView` — the suite already encodes this; keep it when wiring the real hook.
- **The Go leg is the ONLY contract check.** Types-compile + MSW-green + Playwright-green do NOT validate the real handler JSON (they all re-encode the same OpenAPI). Do not treat them as contract validation — only AC17a touches real handler JSON (`releasedProjection`, envelope `.data`, `null`-vs-absent `overrideMark`).

## Step 5 — Validation & Completion

### Checklist validation (against generic ATDD checklist, project-conventions applied)
- ✅ **Prerequisites** — story approved w/ 17 testable ACs; web + api frameworks configured; deps installed.
- ✅ **Story context** — AC extracted, affected components + constraints documented, sibling patterns recon'd.
- ✅ **Test-level selection** — E2E/Go-integration/Component mapped; duplicate coverage explicitly avoided (error matrix once at component; 409-trigger once in Go; Playwright thin).
- ✅ **P0–P3 prioritization** — from the story's risk-6 set + AC17 split.
- ✅ **Red-phase scaffolds generated** at all levels; **RED verified** via red evidence (intended seams only).
- ✅ **Given/When/Then** — test names carry AC numbers; suites mirror the sibling GWT style.
- ✅ **Checklist doc** created at `{test_artifacts}` with story metadata + generated paths in frontmatter; **artifacts linked back into the story** (Dev Notes → ATDD Artifacts).
- ✅ **No flaky patterns** — 3 flake pins baked in (composite-key `findBy`, seed==refetch view, toasts via `findBy`+timers); `retry:false` + one QueryClient/test; Go test in tx rollback.

### Generic-checklist items marked N/A (superseded by ratified project conventions — `feedback_pragmatic_interpretation_of_spec_absolutes`)
- **`test.skip()` scaffolds** → N/A. Replaced by compile-red / build-tag / `test.fixme` / assertion-red per `reference_atdd_red_convention`. Stronger red: the WF-8 branch gate wants `tsc -b`/`vitest` red, not skipped-green.
- **`tests/e2e`, `tests/api`, `tests/component`, `tests/support` dirs** → N/A. Repo layout is `src/features/*/__tests__/` (Vitest colocated) + `e2e/` (Playwright) + `classlite-api/internal/test/` (Go). Followed.
- **faker factories in `tests/support/factories/`** → N/A. Repo uses deterministic inline fixtures (Vitest) and `package test` seeders (Go). Deterministic fixtures are correct here (the scoring-transition assertions need fixed numbers, not random).
- **`test.extend()` fixtures w/ teardown** → N/A for Vitest/MSW (teardown = QueryClient-per-test + `server.resetHandlers()`); Go uses `SetupDB` transaction auto-rollback (TEST-BE-2).
- **`data-testid`-only selectors** → partial. Component suite prefers role/text queries (TEST-FE-5 a11y); testids used for row-order (`questionRef`) assertions. Playwright uses `getByRole`/`getByText`.
- **CLI browser-session cleanup** → N/A. AI-generation mode; no `playwright-cli`/MCP sessions launched.
- **Temp-artifact location** → durable checklist in `{test_artifacts}` ✅; worker JSON manifests in the session scratchpad (not `/tmp`, per environment guidance) — transient, safe to discard.

### Completion Summary
- **Story:** 6.4b — Auto-Grading (objective sections) Frontend · **story_id** `6.4b` · **risk** 6 (R16 immutability) · WF-8 red-first: **MANDATORY, satisfied**.
- **Test files (4 on disk, RED):**
  1. `classlite-web/src/features/grading/__tests__/ObjectiveGradingPage.test.tsx` — 33 (component/MSW)
  2. `classlite-web/src/features/grading/__tests__/story-6-4b-i18n.test.ts` — 34 (i18n parity)
  3. `classlite-api/internal/test/auto_grade_e2e_6_4b_atdd_test.go` — 1 (Go integration, `atdd_red_phase`)
  4. `classlite-web/e2e/objective-grading-6-4b.spec.ts` — 4 (Playwright, mocked, `fixme`)
- **72 assertions; all 17 ACs covered.** P0×7 (AC4, AC9, AC16, AC17a + dispatch), P1 remainder.
- **Checklist:** `_bmad-output/test-artifacts/atdd-checklist-6-4b-auto-grading-reading-listening-vocabulary-frontend.md`
- **Story handoff:** `_bmad-output/implementation-artifacts/6-4b-auto-grading-reading-listening-vocabulary-frontend.md` (ATDD Artifacts subsection added).
- **Key assumptions/risks:**
  - `AutoGradeView.releasedProjection {rawScore, band}` is a NET-NEW additive field (Task 1) — three legs are red on it; it's the single intended structural contract change (RESOLVED #1=A).
  - The reds currently sit on **`main`'s working tree, uncommitted** — recommend a `web/feat/6-4b-*` branch before committing the red baseline (WF-8 wants them on-branch before `in-progress`).
  - Only AC17a validates real handler JSON — do not treat MSW/Playwright green as contract validation.
- **Next workflow:** `dev-story` (turn the reds green task-by-task, activation order in Step 4C) → then post-dev `/bmad-tea TA` (expand P2/P3 + fault injection) and `/bmad-tea RV` (test-quality review), per WF-8.
- **Knowledge applied:** test-priorities-matrix, test-levels-framework, test-quality, data-factories, selector-resilience, timing-debugging, confidence-gate; project TEST-FE-1..6 / TEST-BE-2/3 / WF-8 / `reference_atdd_red_convention` / `reference_web_typecheck_gate_is_tsc_b`.

**ATDD RED PHASE: COMPLETE ✅**
