---
stepsCompleted: ['step-01-preflight-and-context', 'step-02-generation-mode', 'step-03-test-strategy']
lastStep: 'step-03-test-strategy'
lastSaved: '2026-09-22'
storyId: '8.3a'
storyKey: '8-3a-student-performance-views-backend'
storyFile: '_bmad-output/implementation-artifacts/8-3a-student-performance-views-backend.md'
atddChecklistPath: '_bmad-output/test-artifacts/atdd-checklist-8-3a-student-performance-views-backend.md'
generatedTestFiles: []
inputDocuments:
  - '_bmad-output/implementation-artifacts/8-3a-student-performance-views-backend.md'
  - 'docs/project-context.md'
  - 'classlite-api/internal/test/analytics_query_count_atdd_test.go'
  - 'classlite-api/internal/test/analytics_cross_tenant_rls_atdd_test.go'
  - 'classlite-api/internal/test/analytics_home_role_scope_atdd_test.go'
  - 'classlite-api/internal/test/analytics_class_nondisclosure_atdd_test.go'
  - 'classlite-api/internal/test/dashboard_explain_plan_atdd_test.go'
  - '.claude/skills/bmad-tea/resources/knowledge/test-priorities-matrix.md'
  - '.claude/skills/bmad-tea/resources/knowledge/test-levels-framework.md'
detectedStack: 'backend'
---

# ATDD Checklist — Story 8-3a: Student Performance Views (Backend)

_Master Test Architect (Murat) · WF-8 HARD GATE · risk 8 (R-1 student-privacy authz, R-2 immutable-grade regression). Red-first `//go:build atdd_red_phase` tagged-compile-fail per [[reference_atdd_red_convention]]; de-tag per file during `/bmad-dev-story`._

## Step 1 — Preflight & Context

**Stack:** backend (Go · pgx v5 · sqlc · `go test`). No web code (8-3b owns FE).
**Prereqs:** ✅ story `ready-for-dev` with 23 BDD ACs · ✅ Go test infra (`classlite-api/internal/test`, `test.SetupDB`, `NewAnalyticsTestServerForRole`) · ✅ dev env.

**Reuse targets (grep before generating):**
- `analytics_query_count_atdd_test.go` — `CountingDBTX` (counting boundary = the service tx, NOT the pool) + size-invariance `count(small)==count(large)` + synthetic-N+1 proofs.
- `analytics_cross_tenant_rls_atdd_test.go` — both-directions sentinel grid, same-outer-tx re-SET, `NewAnalyticsTestServerForRole(t, db, callerID, tenantID, role)`.
- `analytics_home_role_scope_atdd_test.go` + `analytics_class_nondisclosure_atdd_test.go` — the `an*` parse structs (`anGetHome`/`anGetClass`/`anErrCode`), the 403-vs-404 distinct-code pin idiom.
- `dashboard_explain_plan_atdd_test.go` — `dashExplainNoSeqScan` (GREEN-phase helper, reused not red).
- `internal/test/query_counter.go` — `NewCountingDBTX`, `isTxPlumbing` filter.

**Risk→priority map:** P0 = AC7 peer-strip, AC13 JSONB-crash guard, AC16/17 immutable release+UPDATE-denied, AC22 privacy grid. P1 = AC8-12 reads, AC14 class symmetry, AC18 contract, AC19-20 query-count. EXPLAIN (AC21) = green-phase (not the red gate).

## Step 2 — Generation Mode

**AI generation** (backend rule — no browser recording). Scaffolds derived from the story spec + the existing analytics/dashboard ATDD source. `tea_browser_automation` N/A for Go.

## Step 3 — Test Strategy (AC → level → priority → red file)

**Levels per the project mock-boundary rules (TEST-BE-1..4):** store = real DB in a rollback tx (`test.SetupDB`), service business-rules = mock store interface, handler = real middleware chain (`httptest`). No E2E (pure backend). EXPLAIN is a GREEN-phase helper, never the red gate (planner heuristics are brittle — Murat standing rule).

**RED gate files (authored red-first, `//go:build atdd_red_phase`, land BEFORE `in-progress`):**

| # | File | Level | ACs | Prio | Property it defends |
|---|---|---|---|---|---|
| 1 | `student_perf_role_scope_atdd_test.go` | handler | 1,2,3,4,5,6,22a,22b | P0 | per-role scope + exact 403/404 body-codes (student→403 incl OWN id; teacher-out-of-scope REAL-same-center student→404 STUDENT_NOT_FOUND with no body-leak). OWNS the shared `sp*` parse structs (`spGetStudent`/`spGetMe`/`spErrCode`) + the `NewStudentPerfTestServerForRole` seam. |
| 2 | `student_perf_me_peer_strip_atdd_test.go` | handler | 5,7 | P0 | **B-1 fix** — `classAvgBand` + `affectedStudentCount` PRESENT (non-null on a cohort'd class) on the teacher view, ABSENT on `/me`, positive-control-paired; + a structural key-scan asserting NO `average|cohort|peer`-matching key survives on `/me`. A byte-identical-payload impl FAILS. |
| 3 | `student_perf_cross_tenant_rls_atdd_test.go` | store | 22c,22d | P0 | cross-tenant both-directions (A→B student→404, own→200 sentinel present + B absent), same-outer-tx re-SET; `/me` self-only (a 2nd same-class student's sentinel never appears). |
| 4 | `grades_answer_errors_immutable_atdd_test.go` | store | 15,16,17 | P0 | **R-2** — migration additive + `current_grades` carries the column; objective Release writes the EXACT `[]AnswerError` set (incl. `needs_review`→wrong); Writing/Speaking write SQL NULL (not `'[]'`/`'null'`); `UPDATE answer_errors` REJECTED; tenant-isolation through `current_grades`. |
| 5 | `student_mistakes_union_shape_atdd_test.go` | store | 11,12,13,14 | P0 | **B-2** — the `answer_errors` UNION guarded `jsonb_typeof='array'` does NOT error on SQL NULL/`'[]'`/`'null'`/object/missing-questionType; 4-skill union surfaces R/L; `patternSource` set; `excludedSources` EMPTY on BOTH student AND class endpoints (D12 symmetry). |
| 6 | `student_perf_query_count_atdd_test.go` | harness | 19,20 | P0/P1 | `CountingDBTX` (boundary = service tx) size-invariance `count(small)==count(large)≤maxAnalyticsStudentQueries` on BOTH `/students/{id}` AND `/me`; 4 synthetic-N+1 probes (per-skill, per-week-densify, comments-unnest, answer_errors-unnest); single `UNION ALL`; itemized budget → `evidence/analytics-query-count.json`. |

**GREEN-phase (turned green during dev-story, NOT part of the red compile-fail gate):**
- AC8/9(non-peer)/10 read-shape correctness table-cases: band-progression dense + `avgBand:null`-not-0 + skill-omitted-when-no-grades; skill-breakdown criteria W/S-only; `gradedSubmissionCount` distinct from submission count; per-zone `hasData`; cohort `classAvgBand` value. (8-2a Task-8 precedent — happy-path shape, lower lazy-fake risk than the security surfaces.)
- AC18 contract: `go build ./...` + `tsc -b` on the regenerated client after the greenfield seams exist.
- AC21 EXPLAIN: extend `dashExplainNoSeqScan` with the per-student + cohort + `answer_errors`-mining queries; seed a many-objective-grades student; watch the `submissions.student_id` access path.

**Red-phase verification (per [[reference_atdd_red_convention]]):** default `go build ./...` CLEAN (tag excludes the files); `go build -tags=atdd_red_phase ./internal/test` compile-FAILS on documented seams ONLY — `service.AnalyticsService.{GetStudentPerformance,GetMyPerformance}`, `store.AnswerError`, `grades.AnswerErrors`/the new sqlc query methods, `NewStudentPerfTestServerForRole`, `maxAnalyticsStudentQueries` — zero unintended undefined symbols, gofmt clean, untagged suite unaffected.
