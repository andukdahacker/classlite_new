# Story 8-3b: Completion Notes

_Implementation record for [`8-3b-student-performance-views-frontend.md`](./8-3b-student-performance-views-frontend.md). Status: review._

## Dev Agent Record

### Debug Log

- **B1 (backend population pin) — class endpoint empty on first run.** `buildMistakePatterns` (class) applies the co-gate `affectedStudentCount >= MinPatternStudents` (=2); the scaffold seeded ONE student, so every class pattern was filtered and the auto_graded lookup failed. Fixed the fixture by seeding a **second enrolled student** with the same Writing-error + Reading-answer-error patterns so the class co-gate clears — the per-student endpoint has no multi-student gate, so it passed with one. (A faithful fixture fix, not a production change.)
- **F1 AC19a value-scan — `String(6.0)` JS quirk.** The scaffold asserted `container.textContent` not-contain `String(LEAKED_PEER_BAND)` where `LEAKED_PEER_BAND = 6.0` → `String(6.0)` is `"6"`, which collides with the legitimately-rendered `targetBand` aspiration ("your goal: 6.5") and contradicts AC7. The leaked `classAvgBand` actually renders (on the teacher positive control) as the FORMATTED band `"6.0"` (`formatBandOrDash` → 1 fixed decimal). Corrected the assertion to `not.toContain(formatBandOrDash(LEAKED_PEER_BAND))` = `"6.0"` — exactly AC19's stated "value-strings 6.0/7" and the real defence-in-depth check. Verified the softened student view genuinely omits the leaked `classAvgBand` (no `6.0`, locator absent). Documented inline in the test.
- **`MistakePatternRow` skill tag not `getByText`-able (F3).** The shipped row combined skillSource + criterion in ONE span ("Reading · Matching headings"); the retrofit test needs the skillSource findable on its own. Wrapped the skillSource in its own inner `<span>`.
- **sqlc typing of the mined `example_quote`.** `max(example_quote)::text` typed as non-nullable `string` (breaks scanning NULL for the all-NULL auto_graded group); dropping the `::text` cast made sqlc emit `interface{}` (nullable-safe: `string` for text, `nil` for NULL via pgx). Converted to `*string` in Go with `mistakeExampleQuote`.
- **Stale LSP diagnostics during codegen.** The editor tsserver reported a flood of phantom "Property … does not exist on … 293 more" errors mid-`openapi-typescript` regen (client.ts momentarily partial). `client.ts` verified intact (13305 lines, all schemas present); `tsc -b` = 0 confirmed the phantoms were stale.

### Completion Notes

- **All 7 tasks / 24 ACs implemented; Status → review.** All 4 P0 gates green (B1 backend population, F1 framing-privacy, F2 share-egress-model, F3 class-tab retrofit + key-collision) plus the full P1 set (F4-F10).
- **Task execution order deviated from the written 1→7 sequence (recorded):** Task 6's contract co-finalize + codegen + backend mining ran FIRST because the generated `MistakePattern` fields (`questionType`/`exampleQuote`/`exampleNote`) and the new i18n keys are a hard type/resolution prerequisite for Tasks 1-5 (and for the P0 red tests to compile). Order run: Task 6 (contract→codegen→backend→i18n→fixtures→shipped-FE edits) → Task 1 (keys/hooks/route) → Task 2 (Overview) → Task 3 (Mistakes) → Task 4 (Patterns/container/detail) → Task 5 (mobile/share) → Task 7 (P1 tests + gates). Every task's ACs are satisfied.
- **WF-4 atomic cross-service** (`classlite-api` + `classlite-web` in one change, NOT API-first): api.yaml PROVISIONAL stripped, `patternSource`→required, `questionType`/`exampleQuote`/`exampleNote` added (nullable, GO-5 present); `criterion` stays required non-nullable, auto_graded emits `""`. `codegen.sh` ran last (WF-3).
- **Backend `MistakePattern` change is a self-contained reviewable unit (John J2):** SQL exemplar mining (`max(elem.value->>'text')` per human_comment group, `NULL` for auto_graded) added to BOTH `ListStudentMistakePatterns` + `ListClassMistakePatterns`; `mistakeCriterionSplit` + `mistakeExampleQuote` applied in BOTH `buildStudentMistakePatterns` + `buildMistakePatterns`. `exampleNote` is always `nil` — the v1 grade-comment JSONB has only `{type,criterion,anchorStart,anchorEnd,text}`, no per-comment note field (contract is nullable; the FE renders it only when present). Not a deferral of required behavior — there is no note source to mine.
- **D-SOFTEN reaches the charts:** `StudentPerformanceOverview` passes `targetBand`/`currentVsFirstDelta` as `null` to `BandScoreChart` on `framing==='student'` (suppressing the red ▼ vs-target delta) and renders a muted "your goal" aspiration pill instead; `PerfPill` at-risk (red) is never used on a student surface. Fail-safe: peer/red treatments render only on an explicit `framing==='teacher'`.
- **D2 honored:** `s47` ships EXACTLY 2 tabs (Overview + Mistakes) — no coming-soon Recommendations headstone. FR-49 remains PARTIAL pending 8-3c; FR-50 fully closes.
- **D-SHARE (flipped):** clipboard text + `window.print()` over a self-contained `@media print` overlay — ZERO new dependency, renders Vietnamese natively. jsPDF NOT added.
- **D12:** `analytics.skillSource.reading`/`.listening` + `analytics.questionType.*` keys added → light up the student Mistakes tab AND the shipped 8-2b class Mistakes tab; the stale 8-2b MSW `excludedSources` default flipped `['auto_graded']` → `[]` (the two 8-2b tests that exercise the excluded-note branch now pass an explicit `['auto_graded']` override to preserve branch coverage).
- **AC7 no-projection** honored: raw per-skill trend + class-target reference only.

### Implementation Plan (as executed)

1. **Contract (Task 6a):** api.yaml MistakePattern + strip PROVISIONAL → `codegen.sh` (sqlc + openapi-typescript).
2. **Backend mining (Task 6b):** analytics.sql `example_quote` in both queries → `sqlc generate`; `analytics_service.go` struct fields + `mistakeCriterionSplit`/`mistakeExampleQuote` in both build fns; de-tag B1; `go build`/`vet`/`gofmt` + full backend suite green.
3. **i18n + fixtures + shipped FE (Task 6c):** 72 `analytics.*` keys en+vi + `STORY_8_3B_KEYS` + parity wiring; `handlers.ts` `mistakePattern()` new fields + `excludedSources`→`[]`; `MistakePatternRow` + `ClassPerformanceView:256` edits; fixed the two 8-2b excluded-note tests.
4. **Task 1:** `analyticsKeys.student/.me`, `useStudentPerformance`/`useMyPerformance`, `/analytics/student/:id` route.
5. **Tasks 2-4:** `StudentPerformanceOverview`, `StudentMistakesList`, `StudentPatternsList`, `patternLabels` helper, `StudentPerformanceDetail` (teacher shell), `MyPerformanceContainer` + `MyPerformancePage` body replacement.
6. **Task 5:** `buildShareSummaryModel`/`buildShareSummaryText` + `ShareSummaryButton`; mobile glance / desktop-hint.
7. **Task 7:** F4-F9 authored; F1 assertion corrected; all gates run.

### Gates (evidence)

- Backend: `go build ./...` clean; `go vet ./internal/service/...` clean; `gofmt -l` clean; **full backend suite green** (`go test ./... -p 1`), incl. `TestStudentMistakes_QuestionTypeAndExampleQuote_Populated_ATDD`.
- Frontend: `tsc -b` exit 0; **full web vitest 254 files / 3472 tests pass** (0 regressions); ESLint clean on all changed files; i18n-parity + interpolation ratchet green over `STORY_8_3B_KEYS`.
- codegen ran last (WF-3): sqlc + openapi-typescript.

## File List

### Added

- `classlite-web/src/features/analytics/api/useStudentPerformance.ts` — teacher `/students/{id}` aggregate hook.
- `classlite-web/src/features/analytics/api/useMyPerformance.ts` — student `/me` aggregate hook.
- `classlite-web/src/features/analytics/lib/patternLabels.ts` — shared criterion/questionType label + skill-source helpers.
- `classlite-web/src/features/analytics/lib/buildShareSummaryModel.ts` — pure own-data-only share projection (R-C by construction).
- `classlite-web/src/features/analytics/lib/buildShareSummaryText.ts` — locale-aware plain-text share block.
- `classlite-web/src/features/analytics/components/StudentPerformanceOverview.tsx` — framing-aware Overview tab.
- `classlite-web/src/features/analytics/components/StudentMistakesList.tsx` — teacher Mistakes tab (skill filter + expandable quote/note).
- `classlite-web/src/features/analytics/components/StudentPatternsList.tsx` — softened student Patterns tab.
- `classlite-web/src/features/analytics/components/StudentPerformanceDetail.tsx` — teacher `/analytics/student/:id` route view (2-tab shell + trilogy + 404/403).
- `classlite-web/src/features/analytics/components/MyPerformanceContainer.tsx` — student `/my-performance` fetch + trilogy + tabs.
- `classlite-web/src/features/analytics/components/ShareSummaryButton.tsx` — share affordance (clipboard + window.print overlay).
- `classlite-api/internal/test/student_mistakes_example_quote_atdd_test.go` — B1 P0 population pin (de-tagged; +2nd student).
- `classlite-web/src/features/analytics/__tests__/student_perf_framing_privacy.test.tsx` — F1 P0 (AC19a assertion corrected).
- `classlite-web/src/features/analytics/__tests__/share_summary_model.test.ts` — F2 P0 share egress.
- `classlite-web/src/features/analytics/__tests__/analytics_class_mistakes_retrofit.test.tsx` — F3 P0 class-tab retrofit.
- `classlite-web/src/features/analytics/__tests__/student_perf_routing.test.tsx` — F4 P1.
- `classlite-web/src/features/analytics/__tests__/student_perf_overview.test.tsx` — F5 P1.
- `classlite-web/src/features/analytics/__tests__/student_mistakes_list.test.tsx` — F6 P1.
- `classlite-web/src/features/analytics/__tests__/student_patterns_softened.test.tsx` — F7 P1.
- `classlite-web/src/features/analytics/__tests__/student_perf_mobile.test.tsx` — F8 P1.
- `classlite-web/src/features/analytics/__tests__/student_perf_states_a11y.test.tsx` — F9 P1 (states + axe + share).

### Modified

- `classlite-api/api.yaml` — MistakePattern co-finalize (questionType/exampleQuote/exampleNote; patternSource required; PROVISIONAL stripped).
- `classlite-api/internal/store/queries/analytics.sql` — `example_quote` mining in both mistake queries.
- `classlite-api/internal/service/analytics_service.go` — MistakePattern struct fields + `mistakeCriterionSplit`/`mistakeExampleQuote` + population in both build fns.
- `classlite-web/src/lib/api/client.ts` — regenerated (openapi-typescript; do not hand-edit — XL-1).
- `classlite-api/internal/store/generated/analytics.sql.go` — regenerated (sqlc; do not hand-edit).
- `classlite-web/src/features/analytics/MyPerformancePage.tsx` — placeholder body → real `MyPerformanceContainer`.
- `classlite-web/src/features/analytics/components/MistakePatternRow.tsx` — questionType label fallback + quote/note reveal + affected-suppress-on-null + own skill-source span.
- `classlite-web/src/features/analytics/components/ClassPerformanceView.tsx` — list key (`:256`) incorporates questionType.
- `classlite-web/src/features/analytics/api/analyticsKeys.ts` — `student(id)` + `me()` keys.
- `classlite-web/src/features/analytics/api/__tests__/handlers.ts` — MistakePattern new fields, `excludedSources`→`[]` default, student-perf + `/me` fixtures/handlers.
- `classlite-web/src/features/analytics/__tests__/ClassPerformanceView.test.tsx` — excluded-note branch tests pass explicit `['auto_graded']` override.
- `classlite-web/src/features/analytics/__tests__/analyticsI18nKeys.ts` — `STORY_8_3B_KEYS`.
- `classlite-web/src/lib/test/__tests__/i18n-parity-coverage.test.ts` — wired `STORY_8_3B_KEYS` into the ratchet.
- `classlite-web/src/locales/en.json`, `classlite-web/src/locales/vi.json` — 72 new `analytics.*` keys each.
- `classlite-web/src/routes.tsx` — `/analytics/student/:id` lazy route.

### Deleted

- None. (The 8-2b `analytics.myPerformance.empty.*` keys are retained in both locales — inert but harmless; kept to avoid churning the shipped `STORY_8_2B_KEYS` ratchet.)
