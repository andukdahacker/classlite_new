# Story 8-3a: Completion Notes

_Implementation record for [`8-3a-student-performance-views-backend.md`](./8-3a-student-performance-views-backend.md). Status: review._

## Dev Agent Record

### Debug Log

- **ATDD scaffold state.** All 6 red files were already authored (by a background `bmad-tea` agent) under `//go:build atdd_red_phase`; verified the seam-only red gate (`go vet -tags=atdd_red_phase` fails on exactly `store.AnswerError`, `GetStudentPerformance`, `GetMyPerformance`, `GetStudent`, `Me`) before writing any production code. De-tagged each file as its production seam landed.
- **sqlc column-order trap (Task 2).** `ADD COLUMN answer_errors` appends the column LAST physically; listing it mid-list in `InsertGrade`/`GetCurrentGrade`/`ListGradeVersions` made sqlc emit per-query row structs (`InsertGradeRow`, `GetCurrentGradeRow`) instead of the shared `generated.Grade`, breaking every existing caller. Fix: list `answer_errors` LAST (after `created_at`) in all three queries so they keep mapping to `generated.Grade`.
- **sqlc aggregate-FILTER over a UNION'd CTE (Task 3/4).** `count(*) FILTER (WHERE released_at >= …)` over a UNION ALL CTE is unresolvable by sqlc's analyzer (`column reference "released_at" is ambiguous`, then `table alias … does not exist` when qualified). Fix: compute per-row `recent_flag`/`prior_flag` 0/1 CASE columns INSIDE each branch and `sum()` them in the outer query.
- **Query name collision.** `GetStudentSubmissionStats` already exists in `students.sql`; renamed the analytics one to `GetStudentAnalyticsSubmissionStats`.
- **Query budget = 6 (measured).** Folded the center tz into `GetStudentForAnalytics` (no separate `GetCenterTimezone`) so both endpoints run exactly 6 business queries — size-invariant, confirmed via `CountingDBTX` (small==large==6).
- **`tsc -b` contract churn.** Making `MistakePattern.patternSource` REQUIRED broke 8-2b's shipped MSW mock. Made it schema-OPTIONAL (additive — the backend always emits it; 8-3b promotes at co-finalize), avoiding a WF-4 churn of shipped FE.
- **EXPLAIN — no index needed.** `TestStudentPerf_ExplainNoSeqScan` at 720+ submission cardinality plans without a Seq Scan on any per-student driver (the driving table is the indexed `grades`; `submissions.student_id` filters after the PK join). No WF-2 index migration required (AC21).

### Completion Notes

Shipped the student-analytics backend slice over the done 8-2a spine — two READ endpoints, the FU-8-2-A immutable-grade snapshot, the D12 class retrofit, and the PROVISIONAL contract. All 23 ACs green; 16 8-3a ATDD tests + the updated 8-2a suite pass; full backend suite green under `-race -p 1`.

- **FU-8-2-A (Task 1+2) — self-contained grades-ledger unit (John J2).** Additive nullable `grades.answer_errors jsonb` + `current_grades` view extension (down migration recreates the view before dropping the column — tested). Snapshot at `AutoGradeService.Release` of the definitive-incorrect answers (incl. `needs_review`→wrong, Winston C3) as typed `[]store.AnswerError{questionRef, questionType, schemaVersion}` — NO skill baked in (derived by JOIN at mine-time, Winston C2), resolved via the newly-exported `grading.QuestionTypesByRef`. Writing/Speaking write SQL NULL (T6). Append-only preserved (table-level REVOKE, no trigger). 6.1/6.4a/6.4b release + immutability suites stay green (R-2).
- **Per-student SQL family + service (Task 3/5).** 6 set-based queries; `GetStudentPerformance` (owner/admin center-wide, teacher `analyticsTeacherScope`→404 non-disclosure, student→403) + `GetMyPerformance` (student self, non-student→403) share `buildStudentPerformance(framing)`. `framing=="student"` STRIPS `classAvgBand` + `affectedStudentCount` (FR-50 DATA guarantee, D5/D11). Per-skill band progression densified onto the shared 12-week axis; skill breakdown (latest overall + per-criterion avgs W/S only) + cohort `classAvgBand` (D11); submission/graded/pin stats + per-zone `hasData`; 4-skill mistake mining (comments ∪ guarded answer_errors, student gate = instanceCount-only since affectedStudentCount is trivially 1 for one student).
- **D12 class retrofit (Task 4).** `ListClassMistakePatterns` now UNION ALLs the guarded `answer_errors` unnest; class `excludedSources`→`[]`; both Mistakes surfaces symmetric. `MistakePattern` widened (`skillSource`→4 skills, +`patternSource`, `affectedStudentCount`→nullable pointer for /me stripping).
- **Contract (Task 6).** api.yaml: 2 paths + 6 new PROVISIONAL schemas (GO-5 nulls); reused `BandOverTimePoint`/`SubmissionRate`; `MistakePattern` widened. `go build` + `tsc -b` clean.
- **WF-8 gate (Task 7).** 6 red files greened; `dashExplainNoSeqScan` extended (green-phase); `evidence/analytics-query-count.json` itemizes the 6-query budget for both endpoints.

**Deferrals / follow-ups** registered in `deferred-work.md`: FU-8-3-B (band projection, D9); the Go-derived `hasData` conflation (P3, 8-3b co-finalize); PROVISIONAL contract notes (patternSource optional, criterion overload). Epic FR-49 traceability marked **PARTIAL** (Recommendations pending 8-3c, John J4). FU-8-2-A + ex-FU-8-3-C registered as BUILT.

### Implementation Plan (as executed)

1. Task 1 — migration `20260922120000_add_grades_answer_errors` (+ view); migrate up/down/up cycle verified.
2. Task 2 — `store.AnswerError`, `grading.QuestionTypesByRef`, `grades.sql` InsertGrade+reads, `Release` snapshot, W/S SQL NULL; greened `grades_answer_errors_immutable_atdd_test.go` + added release-path exact-set test; R-2 regression green.
3. Task 3 — 6 per-student queries in `analytics.sql`; sqlc generate.
4. Task 4 — `ListClassMistakePatterns` UNION retrofit; `MistakePattern` struct + covered/excluded; updated 8-2a class-perf test; analytics suite green.
5. Task 5 — student DTOs + `GetStudentPerformance`/`GetMyPerformance`/`buildStudentPerformance` + builders; greened query-count test (size-invariant 6, 4 N+1 probes).
6. Task 6 — api.yaml paths + PROVISIONAL schemas; `codegen.sh`; `AnalyticsHandler.GetStudent`/`Me`; routes on `dashboardChain`; `tsc -b` green.
7. Task 7 — de-tagged + greened the remaining 4 reds; `student_perf_explain_plan_test.go` (green-phase, no Seq Scan → no index); evidence JSON.
8. Task 8 — build/vet/gofmt clean; full suite `-race -p 1` EXIT=0; `codegen.sh` last; docs back-filled.

## File List

### Added
- `classlite-api/migrations/20260922120000_add_grades_answer_errors.up.sql` — FU-8-2-A additive column + `current_grades` view extension.
- `classlite-api/migrations/20260922120000_add_grades_answer_errors.down.sql` — view-dependency-ordered reverse (recreate view → drop column).
- `classlite-api/internal/store/answer_error.go` — `store.AnswerError` typed JSONB element (GO-7).
- `classlite-api/internal/test/grades_answer_errors_immutable_atdd_test.go` — AC15-17 (greened + release-path exact-set test added).
- `classlite-api/internal/test/student_perf_role_scope_atdd_test.go` — AC1-6/22a/22b (owns shared `sp*` parse + server seam).
- `classlite-api/internal/test/student_perf_me_peer_strip_atdd_test.go` — AC5/7 peer-strip positive-control.
- `classlite-api/internal/test/student_perf_cross_tenant_rls_atdd_test.go` — AC22c/22d cross-tenant + /me self-only.
- `classlite-api/internal/test/student_mistakes_union_shape_atdd_test.go` — AC11-14 R-4 guard + D12 symmetry.
- `classlite-api/internal/test/student_perf_query_count_atdd_test.go` — AC19/20 size-invariance + 4 N+1 probes.
- `classlite-api/internal/test/student_perf_explain_plan_test.go` — AC21 EXPLAIN no-Seq-Scan (green-phase).

### Modified
- `classlite-api/api.yaml` — 2 paths + 6 PROVISIONAL schemas; `MistakePattern` widened (skillSource, patternSource, nullable affectedStudentCount).
- `classlite-api/internal/store/queries/grades.sql` — `answer_errors` in InsertGrade (param + RETURNING) + the two reads (LAST, to keep `generated.Grade`).
- `classlite-api/internal/store/queries/analytics.sql` — 6 new per-student queries + `ListClassMistakePatterns` UNION retrofit (flag-then-sum).
- `classlite-api/internal/service/auto_grade_service.go` — `marshalObjectiveAnswerErrors` + Release snapshot.
- `classlite-api/internal/service/grading/autograde.go` — exported `QuestionTypesByRef`.
- `classlite-api/internal/service/grading_service.go` — Writing/Speaking InsertGrade `AnswerErrors: nil` (SQL NULL).
- `classlite-api/internal/service/analytics_service.go` — student DTOs, 2 methods + `buildStudentPerformance` + builders; `MistakePattern` struct + covered/excluded (D12); speaking criteria var.
- `classlite-api/internal/handler/analytics_handler.go` — `GetStudent` + `Me`.
- `classlite-api/cmd/api/main.go` — 2 routes on `dashboardChain`.
- `classlite-api/internal/test/analytics_class_performance_test.go` — D12/D7 assertion updates (excludedSources `[]`, affectedStudentCount pointer, patternSource).
- `classlite-api/evidence/analytics-query-count.json` — student endpoints (6-query budget itemized).
- `classlite-web/src/lib/api/client.ts` — regenerated (openapi-typescript).
- `_bmad-output/implementation-artifacts/deferred-work.md` — 8-3a follow-up register.
- `_bmad-output/planning-artifacts/epics.md` — FR-49 traceability PARTIAL.

### Generated (gitignored — regenerated by `scripts/codegen.sh` in CI)
- `classlite-api/internal/store/generated/*` — sqlc output for the new/changed queries.
