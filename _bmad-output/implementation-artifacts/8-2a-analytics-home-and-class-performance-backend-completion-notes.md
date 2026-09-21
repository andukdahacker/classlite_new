# Story 8-2a: Completion Notes

_Implementation record for [`8-2a-analytics-home-and-class-performance-backend.md`](./8-2a-analytics-home-and-class-performance-backend.md). Status: review._

## Dev Agent Record

### Debug Log

- **sqlc type inference — `tz` param.** `AT TIME ZONE $1` made sqlc infer `pgtype.Interval` (offset semantics). Cast every occurrence `sqlc.arg('tz')::text` so the arg is a `string` IANA zone name → correct named-zone bucketing.
- **sqlc type inference — mistake `criterion`/`type`.** `elem.value->>'criterion'` came out `interface{}`. Cast `::text` → `string`.
- **EXPLAIN seed CASE type.** Bulk-seeding assignments with `CASE WHEN … THEN $2 ELSE $3 END` failed `42804` (params inferred `text`, column `uuid`); cast `(CASE …)::uuid`.
- **D13 type-guard, the load-bearing choice.** The spec wrote `avg(...) FILTER (WHERE jsonb_typeof(...)='number')`, but a FILTER does NOT guarantee the aggregated `::numeric` cast is skipped for filtered-out rows — a non-numeric criterion could still throw `22P02`. Used `avg(CASE WHEN jsonb_typeof(...)='number' THEN (…)::numeric END)` instead: CASE short-circuits, so the cast is evaluated ONLY on jsonb `number` values. `sample_count` counts survivors via FILTER (no cast there). Proven by `TestAnalyticsClass_HeatmapTypeGuard` (a `"N/A"` criterion returns a null cell, not a 500).
- **W3 index — not needed.** `TestAnalytics_ExplainNoSeqScan` at ≈30×12×2 cardinality shows no Seq Scan on the current_grades/submissions/assignments class-scoped drivers under `enable_seqscan=off`; the existing `idx_grades_center_submission_version` serves `current_grades`' `DISTINCT ON`. D12 holds — NO migration.

### Completion Notes

- **Shipped:** two role-scoped read endpoints on the ungated `dashboardChain` (no `RequireRole`), role/scope enforced in-service. `GetHome` (2 queries) and `GetClassPerformance` (7 queries) over `current_grades`/`submissions`/`attendance`, reusing `AtRiskDetector.Classify` UNCHANGED and the center-tz Monday-week idiom.
- **Query budget (tight, TIGHT ceilings so a regression trips the gate):** home teacher/owner = 2 (`ListAnalyticsHomeClasses` + `ListAnalyticsHomeAtRiskInputs`); class = 7 (`GetClassForAnalytics` + `GetCenterTimezone` + `ListClassBandOverTime` + `ListClassSkillHeatmap` + `ListClassMistakePatterns` + `GetClassSubmissionRate` + `ListClassStudentsAtRiskInputs`). SIZE-INVARIANT across cohort sizes (`count(small)==count(large)`). Itemized in `evidence/analytics-query-count.json`.
- **Contract:** PROVISIONAL (D9) — 8-2b co-finalizes. GO-5 explicit nulls throughout (pointers → `null`, never `omitempty`). Dense shared week axis (`bandOverTime.weekStart ≡ skillHeatmap.weeks`, both `AnalyticsWeekWindow=12`).
- **Deferrals (registered, in Out of Scope):** FU-8-2-A (auto-graded answer-error mining — needs a schema change; labeled `excludedSources:["auto_graded"]`), FU-8-2-B (per-skill heatmaps beyond Writing — `hasWritingContent` flag ships). Student `/api/analytics/me` + `/my-performance` = Story 8.3 (D4). Frontend = 8-2b.
- **No deviations from spec.** All 4 party-mode BLOCKERS + 4 Ducdo product rulings implemented as written.

### Implementation Plan (as executed)

1. `api.yaml` — 2 paths + 11 schemas (PROVISIONAL, GO-5 nullable).
2. `internal/store/queries/analytics.sql` — 8 set-based aggregates (W2), D13 CASE type-guard, D14 `submissions.student_id` identity.
3. `scripts/codegen.sh` (sqlc + openapi-typescript) — fixed `::text` casts, re-ran.
4. `internal/service/analytics_service.go` — DTOs, constants, role-branch, week axis + densifiers, mistake co-gate/trend, at-risk classify.
5. `internal/handler/analytics_handler.go` + `cmd/api/main.go` route wiring.
6. `internal/test/story_8_2_helpers.go` — `NewAnalyticsTestServerForRole` green seam; un-tagged the 4 ATDD reds; tuned ceilings.
7. `internal/test/analytics_explain_plan_test.go` (Task 6) + `analytics_class_performance_test.go` (Task 8 correctness + per-source RLS grid) + `evidence/analytics-query-count.json` (Task 5).
8. Gates: build/vet/gofmt, full backend `-race -p 1`, web `tsc -b`.

## File List

### Added

- `classlite-api/internal/service/analytics_service.go` — AnalyticsService (GetHome, GetClassPerformance) + DTOs + tuning consts.
- `classlite-api/internal/handler/analytics_handler.go` — thin Home/GetClass HTTP bindings.
- `classlite-api/internal/store/queries/analytics.sql` — 8 set-based analytics aggregates.
- `classlite-api/internal/test/story_8_2_helpers.go` — `NewAnalyticsTestServerForRole` (green seam).
- `classlite-api/internal/test/analytics_explain_plan_test.go` — Task 6 EXPLAIN no-Seq-Scan (green-phase).
- `classlite-api/internal/test/analytics_class_performance_test.go` — Task 8 correctness table-cases + per-source cross-tenant RLS grid + `seedGradeAt` helper.
- `classlite-api/evidence/analytics-query-count.json` — itemized per-(endpoint, role) query budget.

### Modified

- `classlite-api/api.yaml` — 2 analytics paths + `Analytics*`/`Envelope*` schemas (additive).
- `classlite-api/cmd/api/main.go` — wired both routes on `dashboardChain`.
- `classlite-web/src/lib/api/client.ts` — regenerated (additive; new operations + schemas).
- `classlite-api/internal/test/analytics_home_role_scope_atdd_test.go` — un-tagged (`//go:build atdd_red_phase` dropped; red → green).
- `classlite-api/internal/test/analytics_class_nondisclosure_atdd_test.go` — un-tagged.
- `classlite-api/internal/test/analytics_cross_tenant_rls_atdd_test.go` — un-tagged.
- `classlite-api/internal/test/analytics_query_count_atdd_test.go` — un-tagged; ceilings tuned to the itemized budget (home=2, class=7).

### Generated (gitignored — regenerated by `scripts/codegen.sh`)

- `classlite-api/internal/store/generated/analytics.sql.go` — sqlc output for `analytics.sql`.

### Deleted

- none.
