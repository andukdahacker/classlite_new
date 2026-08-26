# Story 6-4a: Completion Notes

_Implementation record for [`6-4a-auto-grading-reading-listening-vocabulary-backend.md`](./6-4a-auto-grading-reading-listening-vocabulary-backend.md). Status: review._

## Dev Agent Record

### Debug Log

- **Duplicate declarations on first build.** My new-struct edit to `submission_service.go` left the original `WithStorage` method in place (my replacement re-added it), and I redeclared `gradeViewFromGrade` (already present at `grading_service.go:1180`). Removed both duplicates → clean build.
- **`generated/` is gitignored.** sqlc output (`auto_grade_results.sql.go`, `models.go` `AutoGradeResult`) is NOT tracked; CI regenerates via `codegen.sh`. Only the `.sql` source, migrations, api.yaml, `client.ts`, and hand-written Go are committed artifacts.
- **Stale IDE diagnostics vs the real gate.** The harness surfaced `client.ts`-adjacent TS errors after codegen (missing `computePeaks`/`AudioWaveformPlayer`/`useAiGradeSpeakingJob` modules, an `aiSpeakingSuggestion` undefined-vs-null fixture mismatch). The authoritative web gate `npx tsc -b` returns **0 errors**; the diagnostics were stale/incremental language-server noise, and my `client.ts` diff is purely additive (221 ins / 0 del). No frontend regression.
- **D6 golden-table arithmetic footnote.** The story's `necessary/nesessary` row annotates `d=2`; the actual Levenshtein is `d=1` (single `c→s` substitution). Immaterial — threshold is 2 either way, so the verdict is `needs_review` regardless. The ATDD asserts only the `AutoMark`, which is green.

### Completion Notes

- **All 20 ACs satisfied; all 10 tasks green.** The four ATDD suites (engine golden table, submit-hook D13 fault boundary, RLS + immutability trigger 3-twin, override/release/concurrency) pass, then were **de-tagged** (removed `//go:build atdd_red_phase`) so they run in the permanent `go test ./...` suite. Full backend suite green under `-race -count=1`.
- **D2 grades-at-release-only, honored end to end.** The provisional result + overrides live in the new mutable `auto_grade_results` working table; the submission stays `submitted` until `Release` appends the definitive grade to the immutable `grades` ledger (`kind:"objective"` discriminator) and flips `submitted → graded`, reusing the 6.1 atomic insert+flip+audit+outbox path. **No** system user, `grade_releases` table, `grades` migration, existing-trigger rework, snapshot table, or Gemini/ledger touch.
- **D13 fault boundary is the load-bearing safety property.** `runAutoGradeHook` wraps the synchronous grade in a `SAVEPOINT` with panic recovery: a returned error OR a recovered panic rolls back to the savepoint and lets the outer submit still commit `submitted`. Proven by injecting a panicking and an erroring `AutoGrader` double — the submission row lands with zero working rows in both cases.
- **D6/D7 scoring split.** Pre-release the provisional percentage EXCLUDES unresolved `needs_review` from the denominator (`resolvedCorrect / (maxScore − unresolvedNeedsReview)`); at release the definitive grade counts unresolved `needs_review` as WRONG over the full denominator (D10). Band is computed-only via a monotonic `PercentageToBand` ladder — no manual band-override field.
- **AC18 leak-guard.** The student `/result` path (`GetStudentSubmissionReview` → `StudentSubmissionReviewResult`) carries no `autoGrade` block at all, so the serialized student view contains none of `correctAnswer`/`acceptedVariants`/`autoMark`/`overrideMark`. Teacher-only breakdown rides the staff-gated grading read.

### Deviations from spec

- **4-policy RLS grid mirrors `submissions`, not `grades`.** The story text said "mirror `grades` RLS", but `grades` is append-only (2 policies + REVOKE). `auto_grade_results` is UPDATEd in place by the override path, so it needs the full SELECT/INSERT/UPDATE/DELETE FORCE grid — I mirrored `submissions`. Same fail-closed `NULLIF(current_setting(...))::uuid` predicate.
- **No `schema_version` column on `auto_grade_results`.** AC8's column list omits it and the ATDD INSERT helpers omit it; GO-7's intent (typed struct, never `map[string]interface{}`) is satisfied by the typed `store.AutoGradeAnswer` element. Pragmatic interpretation — matched the AC column list exactly rather than add a column the tests don't provide.

### Implementation Plan (as executed)

1. Migrations: `create_auto_grade_results` (table + 4-policy FORCE RLS + D9 partial index) + `add_auto_grade_results_immutable_trigger` (WF-2, own migration) → `migrate.sh up` → down/up round-trip verified.
2. `queries/auto_grade_results.sql` (Insert/Get/Update).
3. api.yaml: additive `autoGrade` block + `AutoGradeView`/`AutoGradeAnswerView`/`AutoMark`/`OverrideAutoGradeAnswerRequest` + 2 provisional paths → `codegen.sh` (sqlc + openapi-typescript).
4. Pure engine `grading/autograde.go` → engine ATDD green.
5. `store.AutoGradeAnswer` persisted type.
6. Submit hook (`AutoGrader` + `submitAutoGrader` + `WithAutoGrade` + `runAutoGradeHook` SAVEPOINT) → submit-hook ATDD green.
7. `AutoGradeService.Override` / `Release` + helpers → override/release ATDD green.
8. Grading-read `autoGrade` extension (`populateAutoGrade`, `TeacherGradingView.AutoGrade`).
9. `AutoGradeHandler` (override/release) + response mapping + routes in `main.go`.
10. De-tag ATDD reds → full `go build && go vet && go test ./... -race -count=1` green; web `tsc -b` = 0.

## File List

### Added

- `classlite-api/migrations/20260826120000_create_auto_grade_results.up.sql` — table + 4-policy FORCE RLS grid + D9 partial index on `grades`.
- `classlite-api/migrations/20260826120000_create_auto_grade_results.down.sql`
- `classlite-api/migrations/20260826130000_add_auto_grade_results_immutable_trigger.up.sql` — 2nd immutability trigger (WF-2).
- `classlite-api/migrations/20260826130000_add_auto_grade_results_immutable_trigger.down.sql`
- `classlite-api/internal/store/queries/auto_grade_results.sql` — Insert / GetBySubmission / Update.
- `classlite-api/internal/store/auto_grade_result.go` — `store.AutoGradeAnswer` persisted type (GO-7).
- `classlite-api/internal/service/grading/autograde.go` — pure engine (Normalize/classify/Grade/PercentageToBand/HasGradableGroups).
- `classlite-api/internal/service/auto_grade_service.go` — `AutoGrader` + `submitAutoGrader` + `AutoGradeService` (Override/Release) + view/scoring/error helpers + `populateAutoGrade`.
- `classlite-api/internal/handler/auto_grade_handler.go` — override/release HTTP handlers + `autoGradeViewToResponse`.
- `classlite-api/internal/service/grading/autograde_engine_atdd_test.go` — engine golden-table suite (de-tagged, green).
- `classlite-api/internal/test/auto_grade_submit_hook_atdd_test.go` — D13 fault-boundary suite (de-tagged, green).
- `classlite-api/internal/test/auto_grade_results_rls_atdd_test.go` — RLS + immutability-trigger suite (de-tagged, green).
- `classlite-api/internal/test/auto_grade_override_release_atdd_test.go` — override/release/concurrency suite (de-tagged, green).

### Modified

- `classlite-api/api.yaml` — additive `autoGrade` block on `TeacherGradingView`; new schemas + 2 provisional paths (D16).
- `classlite-api/internal/service/submission_service.go` — `autoGrade` field, `WithAutoGrade` builder, default real grader wiring, `runAutoGradeHook` (SAVEPOINT, D13) call inside `Submit`.
- `classlite-api/internal/service/grading_service.go` — `TeacherGradingView.AutoGrade` field; `GetSubmissionForGrading` attaches the objective breakdown (restructured the current-grade block to compute `released` + call `populateAutoGrade`).
- `classlite-api/internal/handler/grading_handler.go` — `autoGrade` field on the grading-read response + mapper.
- `classlite-api/cmd/api/main.go` — construct `AutoGradeService` + `AutoGradeHandler`; register the override/release routes on the grading (staff) chain.
- `classlite-web/src/lib/api/client.ts` — regenerated (additive-only, 221 ins / 0 del).

### Deleted

_None._

### Regenerated (gitignored — CI rebuilds via `codegen.sh`, not committed)

- `classlite-api/internal/store/generated/auto_grade_results.sql.go`, `models.go` (`AutoGradeResult`) — sqlc output.
