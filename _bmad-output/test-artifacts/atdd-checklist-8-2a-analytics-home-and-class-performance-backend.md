---
stepsCompleted: ['step-01-preflight-and-context', 'step-02-generation', 'step-03-red-verification']
lastStep: 'step-03-red-verification'
lastSaved: '2026-09-18'
storyId: '8.2a'
storyKey: '8-2a-analytics-home-and-class-performance-backend'
storyFile: '_bmad-output/implementation-artifacts/8-2a-analytics-home-and-class-performance-backend.md'
atddChecklistPath: '_bmad-output/test-artifacts/atdd-checklist-8-2a-analytics-home-and-class-performance-backend.md'
detectedStack: 'backend'
generatedTestFiles:
  - 'classlite-api/internal/test/analytics_home_role_scope_atdd_test.go'
  - 'classlite-api/internal/test/analytics_class_nondisclosure_atdd_test.go'
  - 'classlite-api/internal/test/analytics_cross_tenant_rls_atdd_test.go'
  - 'classlite-api/internal/test/analytics_query_count_atdd_test.go'
inputDocuments:
  - '_bmad-output/implementation-artifacts/8-2a-analytics-home-and-class-performance-backend.md'
  - 'docs/project-context.md'
  - 'classlite-api/internal/test/story_8_1_helpers.go'
  - 'classlite-api/internal/test/dashboard_query_count_atdd_test.go'
  - 'classlite-api/internal/test/dashboard_scope_atdd_test.go'
  - 'classlite-api/internal/test/dashboard_cross_tenant_rls_atdd_test.go'
  - 'classlite-api/internal/test/dashboard_role_branch_atdd_test.go'
  - '.claude/skills/bmad-tea/resources/knowledge/test-priorities-matrix.md'
  - '.claude/skills/bmad-tea/resources/knowledge/test-levels-framework.md'
---

# ATDD Red-Phase Checklist — Story 8-2a (Analytics Home & Class Performance — Backend)

**Author:** Murat (Test Architect) · `/bmad-tea AT 8-2a` · 2026-09-18
**Gate:** WF-8 HARD ATDD gate (risk_score 7). These reds MUST be on-branch and RED **before** the story transitions to `in-progress`. Story stays `ready-for-dev` until dev picks it up.

## Red convention (repo standard — [[reference_atdd_red_convention]])

Backend red = **tagged-compile-fail**, NOT `t.Skip()`. Every file carries `//go:build atdd_red_phase`:

- `go build ./...` → **green** (tagged files excluded). ✅ verified.
- `go test ./...` → tagged files **excluded**, suite unaffected. ✅ verified (untagged `go vet ./internal/test/` clean).
- `go test -tags=atdd_red_phase ./internal/test/` → **compile-fails on the documented greenfield seams ONLY**. ✅ verified — the complete undefined-symbol set is exactly:
  - `NewAnalyticsTestServerForRole` (12 refs)
  - `service.AnalyticsService` / `service.NewAnalyticsService` (the type + ctor; `GetHome`/`GetClassPerformance` are methods on the not-yet-existing type)
  - **Zero** other undefined symbols, **zero** non-undefined compile errors → no accidental reference to a mistyped shipped helper.
- `gofmt -l` on the 4 files → clean. ✅

## Generated red files (4) — P0/P1 AC → test map

| File | ACs | What it pins |
|---|---|---|
| `analytics_home_role_scope_atdd_test.go` | AC2, AC3, AC4 | Home role-branch: teacher owns X-not-Y (**X present AND Y absent** + mirror); owner center-wide (both present); **student → 403 `INSUFFICIENT_ROLE`** (exact code). |
| `analytics_class_nondisclosure_atdd_test.go` | AC11, AC12, AC13 | Class endpoint non-disclosure **404 `CLASS_NOT_FOUND`** with a positive control in every test; the **403-home-vs-404-class DISTINCTION** pinned in one test (same student, two endpoints, two codes); SEC-1 DB-authoritative ownership (no rows computed for a non-owner). |
| `analytics_cross_tenant_rls_atdd_test.go` | AC14 | Cross-tenant BOTH directions on the **same outer tx** (proves per-request re-SET of `app.current_tenant_id`); Center-A→Center-B class id → 404; whole-body sentinel scan (own present, other-center absent). |
| `analytics_query_count_atdd_test.go` | AC15 | **Size-invariance** `count(small)==count(large)≤N` for `GetClassPerformance` (cohort 2 vs 12) and `GetHome` (2 vs 8 classes); **3 synthetic-N+1** counter proofs (per-student / per-week / per-grade surfaces) reusing the shipped 8-1a `CountingDBTX`. |

**Scope note (honest red boundary):** EXPLAIN no-Seq-Scan (AC16) is **green-phase**, NOT in this red gate (environment-brittle; 8-1a precedent). The per-read-source RLS grid (AC14) is pinned at the HTTP level here (gross-leak, both-directions, re-SET); the **exhaustive per-source store-level grid** (each read source seeded a sibling Center-B row) is a **green Task-8 store test** (TEST-BE-1, real DB in tx — the correct level for sub-query RLS). Aggregation-correctness table-cases (partial-criterion week, null-vs-0, threshold + `affectedStudentCount≥2` co-gate boundary, clock-injected trend boundary, `totalDue=0→null`, mixed Writing+Speaking) are **green Task-8** inline service tests — not ATDD reds (they need the green service to assert values).

## GREEN SEAMS — the exact symbols dev creates to turn these red → green

### 1. `internal/test/story_8_2_helpers.go` (NEW — Task 4/7)
Model on `story_8_1_helpers.go` `NewDashboardTestServerForRole`. The UNGATED `dashboardChain` shape (NO `RequireRole` — a student reaches the handler; the SERVICE returns 403, D4/D6a):
```go
func NewAnalyticsTestServerForRole(t *testing.T, db storyDB,
    userID pgtype.UUID, centerID string, role string) http.Handler
```
Mount BOTH routes on the chain:
```go
mux.Handle("GET /api/analytics", chain(analyticsHandler.Home))
mux.Handle("GET /api/analytics/classes/{id}", chain(analyticsHandler.GetClass))
```

### 2. `internal/service/analytics_service.go` (NEW — Task 3)
```go
func NewAnalyticsService(db <same db-interface NewDashboardService takes>, clk clock.Clock) *AnalyticsService
func (s *AnalyticsService) GetHome(ctx, tc model.TenantContext) (*AnalyticsHome, error)
func (s *AnalyticsService) GetClassPerformance(ctx, tc model.TenantContext, classID uuid.UUID) (*ClassPerformance, error)
```
- `GetHome`: student → `&service.ForbiddenError{...}` (→ 403 `INSUFFICIENT_ROLE`); teacher = own-scope; owner/admin = NULL scope.
- `GetClassPerformance`: not-found OR (teacher AND `class.teacher_id != caller`) → `model.NotFoundError{Resource:"class", Code:"CLASS_NOT_FOUND"}` (→ 404). The 404 must PRECEDE any aggregation (AC13 — no rows for a non-owner).
- Must accept the shipped `*CountingDBTX` (same db-interface) so the AC15 tests wrap it — the counting boundary is **the tx the service runs on, NOT the pool** (the 8-1a false-pass; W1).

### 3. `internal/handler/analytics_handler.go` + `cmd/api/main.go` (Task 4)
`Home` / `GetClass` methods (thin: TenantFromContext, `PathValue("id")` parse→422, call svc, `WriteEnvelope`); wire the `analyticsChain` (= dashboardChain shape) + both routes.

### Error contract the mapper already renders (verified)
- `service.ForbiddenError` → 403 `INSUFFICIENT_ROLE` (`error_mapper.go`).
- `model.NotFoundError{Code:"CLASS_NOT_FOUND"}` → 404 `CLASS_NOT_FOUND` (Code overrides the default `NOT_FOUND`).

## Query-count ceilings (dev tunes in green; single source of truth = CQ-3 named consts)
```go
maxAnalyticsHomeQueriesTeacher = 6   // placeholder — tune to itemized budget
maxAnalyticsHomeQueriesOwner   = 6
maxAnalyticsClassQueries       = 9   // e.g. 1 SET LOCAL + 1 class-auth + 1 bandOverTime
                                     //      + 1 heatmap + 1 mistakes + 1 atRisk-batch + 1 submissionRate = 7
```
Emit `evidence/analytics-query-count.json` (P0) with the **itemized** per-(endpoint,role) budget.

## Shipped helpers reused (verified — de-tagged/green from 8-1a & earlier)
`SetupDB`, `CreateCenterWithID`, `TenantContext`, `TenantAID`/`TenantBID`, `CreateUser`, `CreateCenterMember`, `seedClassWithTeacher`, `insertEnrollmentRaw`, `seedReleasedGrade`, `seedStudentMember`, `dashSeedAtRiskStudent`, `dashPGToUUID`, `UUIDString`, `NewCountingDBTX` (8-1a keystone). The `an*` parse structs / `anGetHome` / `anGetClass` / `anErrCode` are local to `analytics_home_role_scope_atdd_test.go` (shared in-package under the tag).

## Fixture traps flagged for green (Task 8)
- **`uq_attendance_session_student`** — `dashSeedAtRiskStudent` already seeds one session per absence (the 8-1a canary); any NEW submissionRate/attendance seed must use DISTINCT sessions.
- **Partial/non-numeric `criterion_scores` JSONB** — the heatmap null-cell + D13 type-guard correctness cases need a seed that emits a grade with only 2 of 4 criterion keys and/or a non-numeric value (no shipped helper yet → dev adds `seedReleasedGradeWithCriteria`).
- **Comment-bearing grades** — the mistake-mining correctness + per-source RLS store tests need a grade with `comments` JSONB (error/praise + criterion); no shipped helper → dev adds one in green.

## Handoff
- Turn red → green: `/bmad-dev-story 8-2a`. Un-tag each file as its seam lands (drop the `//go:build atdd_red_phase` line), per the 8-1a green-phase flow.
- Post-dev: `/bmad-tea TA 8-2a` (P2/P3 expansion, MSW/fault injection N/A backend, the green Task-8 correctness table-cases) then `/bmad-tea RV 8-2a`.
