---
stepsCompleted: ['step-01-preflight-and-context', 'step-02-generation-mode', 'step-03-test-strategy', 'step-04-generate-tests']
lastStep: 'step-04-generate-tests'
lastSaved: '2026-09-23'
storyId: '8.3b'
storyKey: '8-3b-student-performance-views-frontend'
storyFile: '_bmad-output/implementation-artifacts/8-3b-student-performance-views-frontend.md'
atddChecklistPath: '_bmad-output/test-artifacts/atdd-checklist-8-3b-student-performance-views-frontend.md'
generatedTestFiles:
  - 'classlite-web/src/features/analytics/__tests__/student_perf_framing_privacy.test.tsx'
  - 'classlite-web/src/features/analytics/__tests__/share_summary_model.test.ts'
  - 'classlite-web/src/features/analytics/__tests__/analytics_class_mistakes_retrofit.test.tsx'
  - 'classlite-api/internal/test/student_mistakes_example_quote_atdd_test.go'
inputDocuments:
  - '_bmad-output/implementation-artifacts/8-3b-student-performance-views-frontend.md'
  - '_bmad-output/implementation-artifacts/8-3a-student-performance-views-backend.md'
  - '_bmad-output/implementation-artifacts/8-2b-analytics-home-and-class-performance-frontend.md'
  - 'docs/project-context.md'
  - 'classlite-web/src/features/analytics/__tests__/AnalyticsRoute.test.tsx (red-phase precedent)'
  - 'classlite-api/internal/test/student_perf_role_scope_atdd_test.go (BE red-phase precedent)'
detectedStack: 'fullstack'
---

# ATDD Red-Phase Scaffold — Story 8-3b (Student Performance Views — Frontend)

## Step 1 — Preflight & Context

### Stack & framework
- **Detected stack:** `fullstack` — frontend-primary (React 19 · Vite/Rolldown · TanStack Query · Vitest + MSW) + a bounded backend slice (Go 1.22 · the D-COFINAL WF-4 `questionType`/`exampleQuote`/`exampleNote` population — AC21).
- **FE framework:** Vitest + React Testing Library + MSW. **NO Playwright/Cypress** (`vitest.config.ts`; no `playwright.config.*`/`cypress.config.*`). Generic Playwright-utils knowledge fragments do NOT apply.
- **BE framework:** Go `testing` + the real DB-in-tx harness (`test.SetupDB`), the `internal/test/` integration suite.

### Red-phase convention (project-specific — [[reference_atdd_red_convention]])
- **FE red = compile/import-fail.** Each test imports the not-yet-existing production module (e.g. `@/features/analytics/useStudentPerformance`) → `tsc -b` / Vitest import failure. Every OTHER symbol is real. **No `test.skip()`.** A header block documents the green-phase SEAMS the dev must expose.
- **BE red = `//go:build atdd_red_phase`** tagged-compile-fail on the not-yet-existing seam (e.g. `MistakePattern.QuestionType`/`ExampleQuote` fields). De-tag as each production seam lands.

### FE test harness (mirror the shipped 8-2b analytics tests)
- `render` from `@testing-library/react`; `server` from `@/test/msw-server` (the ONE mock seam — TEST-FE-1, never mock `useQuery`).
- `queryClient` (module-singleton, seed role via `setQueryData(authKeys.session(), …)`) + a separate `createTestQueryClient()` provider for the view's own queries — both from `@/lib/query-client`.
- `authKeys`/`Role`/`Session`/`UserSummary` from `@/features/auth/api/authKeys`; `i18n` from `@/lib/i18n`; `MemoryRouter`/`Routes`/`Route` from `react-router`.
- MSW fixtures/handlers extend `src/features/analytics/api/__tests__/handlers.ts`; i18n ratchet via a new `STORY_8_3B_KEYS` (mirror `analyticsI18nKeys.ts`).
- `axe` via `vitest-axe` (TEST-FE-5).

### Prerequisites — MET
- Story `ready-for-dev`, v0.2 (party-mode hardened), 24 ACs with a split P0/P1 gate (AC23).
- FE + BE test frameworks configured; dev env available.

### Test-priority framing (risk-based — the AC23 split gate)
- **P0 (blocking-merge):** AC19 framing-privacy positive-control-paired value/style/copy scans (R-A, top risk) · AC21 backend `questionType`/`exampleQuote` POPULATION pin (a partial ship is `tsc -b`-green) · AC14 share-egress asserts on the pure `buildShareSummaryModel` (R-C) · AC22 8-2b class-tab cross-render + the `ClassPerformanceView.tsx:256` key-collision.
- **P1:** null-gap chart rendering, mobile glance, desktop-hint-replaces-zones, per-zone ghosted-frame, three-state.

## Step 3 — Test Strategy (AC → level → priority → red seam)

**Levels available:** Component (Vitest+RTL+MSW), Unit (pure fns), Backend-Integration (Go, real DB in tx). **NO E2E** (no Playwright). Mock boundary: MSW at the HTTP edge on FE (never mock `useQuery`); real DB-in-tx on BE (never mock pgx). Red = FE import-fail / BE `//go:build atdd_red_phase`.

### P0 — blocking-merge (the AC23 split gate P0 set — a green P1 must NOT buy these down)

| # | File (red) | ACs | Level | What it pins / red seam |
|---|---|---|---|---|
| F1 | `student_perf_framing_privacy.test.tsx` | **AC19**, AC17 | Component | THE top-risk gate (R-A). (a) leaked-value VALUE-scan: `/me` fixture with a *leaked* `classAvgBand:6.0`/`affectedStudentCount:7` → assert `"6.0"`/`"7"` ABSENT from `container.textContent`, positive-control-paired with the teacher render showing them at named locators; (b) copy-scan PAIRED (regex matches teacher, not `/me`); (c) no-red STYLE scan (`not.toHaveClass` danger token + no `--cl-red`/▼ in student DOM, paired). Red: the framing-aware components + softened namespace don't exist. |
| F2 | `share_summary_model.test.ts` | **AC14**, AC14a | Unit (pure) | R-C egress by construction: `buildShareSummaryModel(perf,locale)` fed a *leaked* non-null peer value → assert own-data-only, no `classAvgBand`/`affectedStudentCount` in the model NOR in `buildShareSummaryText(model)`. Red: neither pure fn exists. |
| F3 | `analytics_class_mistakes_retrofit.test.tsx` | **AC22** | Component | D12 cross-tab + Winston's key-collision bug: shipped 8-2b `ClassPerformanceView`/`MistakePatternRow` on an `auto_graded` fixture (`questionType` set, `criterion:""`) renders the `questionType` label + `reading`/`listening` `skillSource` tag; TWO auto_graded reading/error patterns render DISTINCTLY (the `:256` key must incorporate `questionType` — else React collapses them); MSW `excludedSources` default now `[]`. Red: `MistakePattern.questionType` type field + the FE label/key edits don't exist. |
| B1 | `student_mistakes_example_quote_atdd_test.go` | **AC21** | Backend-Integration | The population proof the FE can't give (a partial ship is `tsc -b`-green): a released auto_graded R/L grade → mined pattern has `QuestionType` non-empty AND `Criterion==""` AND `ExampleQuote==nil`; a human_comment pattern → `QuestionType==""`, `Criterion` non-empty, `ExampleQuote`/`ExampleNote` non-nil. Asserted on BOTH `GetStudentPerformance` (buildStudentMistakePatterns) AND the class endpoint (buildMistakePatterns). Red: `//go:build atdd_red_phase` on the not-yet-existing `MistakePattern.QuestionType`/`ExampleQuote`/`ExampleNote` fields + mining. |

### P1 — non-blocking (chart/mobile/state rendering)

| # | File (red) | ACs | Level | What it pins / red seam |
|---|---|---|---|---|
| F4 | `student_perf_routing.test.tsx` | AC1-4 | Component | `/analytics/student/:id` route + `useStudentPerformance`/`useMyPerformance` hooks + real `MyPerformancePage` body (placeholder testid gone); 404 non-disclosure + 403 states; student `/me` never calls `/students/{id}`. Red: the hooks + route don't exist. |
| F5 | `student_perf_overview.test.tsx` | AC5-7 | Component | Per-skill `BandTrendChart` null-gap; `SkillPerfBars`/`BandScoreChart`; stats strip via `submissionRate.rate` (NOT `onTimeRate`); every nullable→"—" never 0; teacher `classAvgBand` present / student absent; `targetBand` aspiration, `null`→caption; NO projection. (BandScoreChart no-red on student folds to F1.) Red: `StudentPerformanceOverview`. |
| F6 | `student_mistakes_list.test.tsx` | AC8-10 | Component | Expandable rows reveal `exampleQuote`/`exampleNote`; auto_graded label `questionType`+warm quote-less; `affectedStudentCount` SUPPRESSED (single-student); skill filter narrows by `skillSource`; `excludedSources:[]`→no note; deterministic order. Red: `StudentMistakesList` + framing-aware row. |
| F7 | `student_patterns_softened.test.tsx` | AC11-12 | Component | Coaching copy namespace, praise interleave, `exampleQuote` reveal, NO practice-links (out of scope), "own data only" note; mixed-grain ghosted-frame — global banner on `gradedSubmissionCount<3`, per-zone dim on `hasData.*` (fixture: `≥3` graded but a zone `hasData:false`). Red: softened render. |
| F8 | `student_perf_mobile.test.tsx` | AC13 | Component (structural) | Student mobile-real glance mechanism (above-fold band hero, `overflow-x-auto`); teacher desktop-hint REPLACES the dense zones on phone widths (assert the hint element present + the dense-chart testid ABSENT at narrow width). Pixel-exact → hand off to manual/TA (8-2b AC24 precedent). Red: the components. |
| F9 | `student_perf_states_a11y.test.tsx` | AC18, AC20, AC24 | Component | Three-state per zone via real MSW (single-aggregate → a 500 blanks the view + inline retry `refetch`; per-zone EMPTY from `hasData`, NOT partial-failure); `axe` no-violations per tab per role; keyboard/AT rows+tabs+accordion; "—" via i18n. Red: components. |
| F10 | i18n ratchet (`STORY_8_3B_KEYS`) | AC16 | Unit | `analytics.studentPerformance.*` + softened `analytics.myPerformance.*` + `analytics.skillSource.reading`/`.listening` en+vi parity; wire `STORY_8_3B_KEYS` into `i18n-parity-coverage.test.ts`. Red: the keys + array don't exist. |

### Coverage notes / anti-duplication
- **No double-coverage:** the no-red chart assertions live in F1 (the privacy gate), not repeated in F5; the exampleQuote *reveal* is F6/F7 (render), its *population* is B1 (backend) — different levels, no overlap.
- **AC23 gate mapping:** P0 = {F1, F2, F3, B1}; P1 = {F4–F10}. CI must fail the merge on any P0 red; a P1 chart failure is triaged, not merge-blocking.
- **Bundle budget (AC20)** = the existing e2e/bundle-boundary harness (no jsPDF now → assert no new lib on the initial `/analytics/student` + `/my-performance` chunk) — a build-time boundary check, not a Vitest test.

## Step 4 — Generated red-phase scaffolds (P0 gate) + red verification

> **Workflow deviation (recorded — [[feedback_pragmatic_interpretation_of_spec_absolutes]]):** the generic ATDD pipeline mandates `test.skip()` scaffolds via Playwright-shaped API/E2E JSON subagents. This repo's convention ([[reference_atdd_red_convention]]) is **compile/import-fail red (FE) + `//go:build atdd_red_phase` (BE), NOT `test.skip()`**, on a Vitest+MSW+Go stack (no Playwright). Generated the P0 red files directly in the repo idiom (as 8-1a/8-2a/8-3a were), overriding the skill's `test.skip()` + subagent-JSON mandate.

### Generated files (P0 blocking-merge set — the AC23 gate)
| # | File | ACs | Red verified |
|---|---|---|---|
| F1 | `classlite-web/src/features/analytics/__tests__/student_perf_framing_privacy.test.tsx` | AC19, AC17 | ✅ import-fail on `StudentPerformanceOverview`/`StudentMistakesList`/`StudentPatternsList` + new `MistakePattern` fields (LSP-confirmed) |
| F2 | `classlite-web/src/features/analytics/__tests__/share_summary_model.test.ts` | AC14, AC14a | ✅ import-fail on `buildShareSummaryModel`/`buildShareSummaryText` (LSP-confirmed) |
| F3 | `classlite-web/src/features/analytics/__tests__/analytics_class_mistakes_retrofit.test.tsx` | AC22 | ✅ `MistakePattern.questionType` field absent on generated type (LSP-confirmed) |
| B1 | `classlite-api/internal/test/student_mistakes_example_quote_atdd_test.go` | AC21 | ✅ **VERIFIED** `go vet -tags=atdd_red_phase` compile-fails ONLY on `service.MistakePattern.{QuestionType,ExampleQuote,ExampleNote}` undefined; normal build excludes the tagged file |

### Implementation checklist — seams the dev exposes to turn the P0 gate GREEN
- [ ] **Contract (Task 6, WF-4 atomic, web+API TOGETHER):** add `questionType:string|null` + `exampleQuote:string|null` + `exampleNote:string|null` to `MistakePattern` in `api.yaml`; promote `patternSource`→required; `scripts/codegen.sh`. → un-reds F1/F2/F3 typing + B1 field refs.
- [ ] **Backend mining (Task 6, reviewable unit):** in BOTH `buildStudentMistakePatterns`(:823) + `buildMistakePatterns`(:1003): auto_graded → `QuestionType` set, `Criterion=""`, `ExampleQuote=nil`; human_comment → `Criterion` set, `QuestionType=""`, `ExampleQuote`=mined comment text. → greens **B1** (de-tag it).
- [ ] **Shipped 8-2b FE edits (Task 6):** `MistakePatternRow.tsx:55` label→`questionType` when `criterion===""` + render `exampleQuote`/`exampleNote` body; `ClassPerformanceView.tsx:256` list key incorporates `questionType`; MSW `excludedSources` default→`[]`. → greens **F3**.
- [ ] **New presentational components (Tasks 2-4):** `StudentPerformanceOverview` (testid `student-perf-classavg-${skill}` teacher-only; BandScoreChart framing-gated no-red), `StudentMistakesList` (teacher, `student-mistake-affected-${i}`, `student-mistake-trend-${i}`), `StudentPatternsList` (student softened, `student-pattern-trend-${i}`, no peer/red, coaching namespace). → greens **F1**.
- [ ] **Share model (Task 5):** pure `buildShareSummaryModel` (own-data only, no peer read) + `buildShareSummaryText`. → greens **F2**.
- [ ] **i18n:** `analytics.studentPerformance.mistakes.recurringType`, `analytics.myPerformance.patterns.ownDataNote`, `analytics.skillSource.reading`/`.listening`, `analytics.questionType.*` in en+vi. → greens F1/F3 key resolution.

### P1 red files — the dev authors these during dev-story (seams in the Step-3 strategy table F4–F10)
Not generated here (scope: the P0 falsifiability pins are where ATDD-first earns its keep — the party-mode-critical privacy/egress/population gates. The P1 set is standard three-state/render/mobile coverage, fully specified in the Step-3 table + the story ACs). **NOT silently dropped** — they are required for DoD (AC18/20/24) and listed for authoring:
- [ ] F4 `student_perf_routing.test.tsx` (AC1-4) · F5 `student_perf_overview.test.tsx` (AC5-7) · F6 `student_mistakes_list.test.tsx` (AC8-10) · F7 `student_patterns_softened.test.tsx` (AC11-12) · F8 `student_perf_mobile.test.tsx` (AC13) · F9 `student_perf_states_a11y.test.tsx` (AC18/20/24) · F10 i18n ratchet `STORY_8_3B_KEYS` (AC16).

## Handoff
- Story: `_bmad-output/implementation-artifacts/8-3b-student-performance-views-frontend.md` (v0.2, ready-for-dev)
- P0 red gate authored + verified (B1 compile-fail proven). Next: `/bmad-dev-story 8-3b` — turn the P0 reds green (contract → backend mining → FE), then author the P1 set (F4–F10) following the seams.
- CI gate (AC23): P0 = {F1, F2, F3, B1} block merge; P1 triaged.
