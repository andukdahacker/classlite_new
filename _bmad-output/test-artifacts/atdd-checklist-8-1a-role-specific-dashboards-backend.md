---
stepsCompleted: ['step-01-preflight-and-context', 'step-02-generation-mode', 'step-03-test-strategy', 'step-04-generate-tests', 'step-04c-aggregate', 'step-05-validate-and-complete']
lastStep: 'step-05-validate-and-complete'
lastSaved: '2026-09-12'
generationMode: 'ai-generation'
redScope: 'story-pinned-only (AC2, AC15/16/17, AC13 + synthetic-N+1; AC14 EXPLAIN scaffolded green-phase untagged)'
queryCountBoundary: 'DBTX decorator (test.NewCountingDBTX wrapping generated.DBTX)'
storyId: '8.1a'
storyKey: '8-1a-role-specific-dashboards-backend'
storyFile: '_bmad-output/implementation-artifacts/8-1a-role-specific-dashboards-backend.md'
atddChecklistPath: '_bmad-output/test-artifacts/atdd-checklist-8-1a-role-specific-dashboards-backend.md'
generatedTestFiles:
  - 'classlite-api/internal/test/dashboard_role_branch_atdd_test.go'
  - 'classlite-api/internal/test/dashboard_scope_atdd_test.go'
  - 'classlite-api/internal/test/dashboard_cross_tenant_rls_atdd_test.go'
  - 'classlite-api/internal/test/dashboard_query_count_atdd_test.go'
  - 'classlite-api/internal/test/dashboard_explain_plan_atdd_test.go'
inputDocuments:
  - '_bmad-output/implementation-artifacts/8-1a-role-specific-dashboards-backend.md'
  - '_bmad-output/project-context.md'
  - 'classlite-api/internal/test/helpers.go'
  - 'classlite-api/internal/test/story_7_2a_helpers.go'
  - 'classlite-api/internal/test/story_2_1_helpers.go'
  - 'classlite-api/internal/test/fixtures.go'
  - 'classlite-api/internal/test/staff_load_aggregate_atdd_test.go'
  - 'classlite-api/internal/test/audit_logs_rls_test.go'
  - 'classlite-api/internal/service/at_risk_detector.go'
  - 'classlite-api/cmd/api/main.go'
  - '.claude/skills/bmad-testarch-atdd/resources/knowledge/{test-quality,test-levels-framework,test-priorities-matrix,data-factories,test-healing-patterns}.md'
---

# ATDD Checklist — Story 8-1a (Role-Specific Dashboards, Backend)

## Step 1 — Preflight & Context

- **Detected stack:** `backend` (Go 1.22 · pgx v5 · sqlc · net/http). Repo is fullstack but this story is backend-only ("Backend slice only").
- **Test framework:** Go `testing` + real-DB-in-tx (`internal/test/helpers.go` `SetupDB`), pgx v5.9.2 `QueryTracer` available (go.mod).
- **Prerequisites:** ✅ Story `ready-for-dev`, 19 ACs, risk_score 7 → WF-8 HARD ATDD gate fires.
- **RED convention (repo-ratified `[[reference-atdd-red-convention]]`):** compile-fail red via `//go:build atdd_red_phase`, NOT `test.skip()`. `go test ./...` stays green (tag excluded); `go test -tags=atdd_red_phase ./...` fails to compile on the not-yet-existing seams. Each red file carries a `SEAMS (dev, green phase)` header.

### Story-pinned RED set (WF-8, red-first before in-progress)
| AC | Red target | Level |
|---|---|---|
| AC2 | each role → exactly one block non-null + other two explicit `null` | handler integration |
| AC15 | teacher-A vs teacher-B scope (positive control + negative, same test) | store/service adversarial |
| AC16 | student sees own only; no class averages / other students | store/service adversarial |
| AC17 | cross-tenant A↔B isolation, both directions, re-SET per call | store adversarial |
| AC13 | query-count ≤N per role, proven-fails-on-synthetic-N+1 | perf harness (keystone) |

AC14 (EXPLAIN no-SeqScan) is GREEN-phase per the story (plan tests are environment-brittle) — scaffold but NOT in the red gate.

### Verified idioms to model on (recon 2026-09-12)
- `NewStudentTestServerForRole` (`story_7_2a_helpers.go`) → model `story_8_1_helpers.go` `NewDashboardTestServerForRole`. Uses ungated `questionChain` shape (NO `RequireRole`) per D2.
- `questionChain` (`cmd/api/main.go:644-651`): `extractTenant → requireVerified → requireCenter → ErrorMapper`.
- `AtRiskDetector.Classify(AtRiskInputs) AtRiskResult` + consts (`at_risk_detector.go`) — reuse UNCHANGED (D5).
- EXPLAIN idiom: `SET LOCAL enable_seqscan = off` then `EXPLAIN` (`audit_logs_rls_test.go:243-262`).
- Substrate: `SetupDB`/`TxDB`/`TenantContext`/`SetupRawPool` (`helpers.go`); `CreateUser`/`CreateCenterWithID`/`CreateCenterMember` + `TenantAID`/`TenantBID` (`fixtures.go`); `authInjectingHandler`/`storyDB`/`SignAccessTokenForRole`/`markUserVerified` (`story_2_1/2_6/7_1a_helpers.go`).
- Query-count harness: NONE exists — net-new keystone (D7). Counting boundary = the tx the service runs on (decorate `generated.DBTX` OR a dedicated `ConnConfig.Tracer` pool), NOT `SetupRawPool`/`TxDB.Exec` (false-green).

## Step 2 — Generation Mode
- **Mode:** AI generation (backend → no browser recording, per step-02 backend rule).
- **DEVIATION (ratified):** red mechanism is repo-convention **compile-fail `//go:build atdd_red_phase`**, NOT the skill's generic `test.skip()`. `test.skip()` is inert; compile-red is the real WF-8 gate. `[[reference-atdd-red-convention]]` + `[[feedback-pragmatic-interpretation-of-spec-absolutes]]`.
- **DEVIATION:** no E2E worker (backend Go; E2E N/A). Integration/service Go reds generated directly (sequential — full context held in-agent).

## Step 3 — Test Strategy (AC → level → priority)

Mock seams honored: TEST-BE-1 (RLS adversarial real-DB-in-tx), TEST-BE-3 (handler integration = real middleware chain), TEST-BE-4 (service business rules). No `t.Parallel()` on shared-tx DB tests.

| AC | Scenario | Level | Priority | RED? | Compile-red seam(s) |
|---|---|---|---|---|---|
| AC2 | Each of 4 roles → exactly one block non-null + other two **explicit null** | Handler integration (HTTP, real chain) | P0 | ✅ tag | `NewDashboardTestServerForRole` |
| AC15 | Teacher-A own-class rows present (positive control) + teacher-B excluded (negative) | Handler integration | P0 | ✅ tag | `NewDashboardTestServerForRole` |
| AC16 | Student sees own sessions/grades/questions (positive) + no class avgs / no other student (negative) | Handler integration | P0 | ✅ tag | `NewDashboardTestServerForRole` |
| AC17 | Cross-tenant A↔B, both directions, re-SET per call | Handler integration (grid) | P0 | ✅ tag | `NewDashboardTestServerForRole` |
| AC13 | Query-count ≤N per role + **proven-fails-on-synthetic-N+1**; counting boundary = service tx via DBTX decorator | Service + counting DBTX | P0 | ✅ tag | `test.NewCountingDBTX`, `service.NewDashboardService`, `(*DashboardService).GetDashboard` |
| AC14 | EXPLAIN no-SeqScan on center_id/class_id/teacher_id + submissions grading-backlog driver (`SET LOCAL enable_seqscan=off`) | Store EXPLAIN | P1 | ⚠️ tagged, **NOT red-gate** (green-phase; plan tests env-brittle) | new grading-backlog SQL (runtime, not compile) |

**Red-gate = AC2 + AC13 + AC15 + AC16 + AC17.** AC14 is scaffolded behind the same tag ONLY to keep `go test ./...` green until the new queries land; its header states it is a green-phase deliverable, not part of the gate proof.

### File plan (all `internal/test/`, all `//go:build atdd_red_phase`)
1. `dashboard_role_branch_atdd_test.go` — AC2
2. `dashboard_scope_atdd_test.go` — AC15 + AC16
3. `dashboard_cross_tenant_rls_atdd_test.go` — AC17
4. `dashboard_query_count_atdd_test.go` — AC13 (+ synthetic-N+1 proof)
5. `dashboard_explain_plan_atdd_test.go` — AC14 (green-phase scaffold)

### Green-phase seams the dev reconciles (documented in each file header)
- `internal/test/story_8_1_helpers.go` → `NewDashboardTestServerForRole(t, db, userID, centerID, role)` — model on `story_7_2a_helpers.go`, but wire the **ungated `questionChain` shape** (NO `RequireRole`, D2).
- `internal/test/query_counter.go` → `NewCountingDBTX(inner generated.DBTX) (*CountingDBTX)` with `.Count()` / `.Reset()` / business-vs-plumbing filter — the reusable R31 keystone (8.2/8.4 inherit).
- `internal/service/dashboard_service.go` → `NewDashboardService(db, clk)` + `(*DashboardService).GetDashboard(ctx, tc) (*model.DashboardData, error)` (or generated type per api.yaml D3).
- `internal/handler/dashboard_handler.go` + route in `cmd/api/main.go`.
- `queries/dashboard.sql` new aggregates (D6) + `codegen.sh`.

## Step 4 — Generated Red-Phase Scaffolds (compile-fail red, verified)

**TDD RED PHASE compliance (repo convention, not the skill's `test.skip()` default):**
- ✅ `go build ./...` (no tag) = **green** — all 5 files excluded via `//go:build atdd_red_phase`; the normal suite is unaffected.
- ✅ `go vet -tags=atdd_red_phase ./internal/test/` = **compile-RED on documented seams ONLY**: `NewDashboardTestServerForRole` (×7), `NewCountingDBTX` (×2), `service.NewDashboardService` (×1) [+`GetDashboard`, masked behind the constructor]. **Zero errors against any shipped helper** (verified by stubbing the test-package seams → only the service seam remained).
- ✅ Assertions state EXPECTED behavior (role-branch nulls, positive-control + negative scope, ≤N + synthetic-N+1), not placeholders.

| # | File | AC | Red seam(s) |
|---|---|---|---|
| 1 | `dashboard_role_branch_atdd_test.go` | AC2 (+AC1 no-403) | `NewDashboardTestServerForRole` |
| 2 | `dashboard_scope_atdd_test.go` | AC15 + AC16 | `NewDashboardTestServerForRole` |
| 3 | `dashboard_cross_tenant_rls_atdd_test.go` | AC17 | `NewDashboardTestServerForRole` |
| 4 | `dashboard_query_count_atdd_test.go` | AC13 (+synthetic-N+1 no-op proof) | `NewCountingDBTX`, `service.NewDashboardService`, `GetDashboard` |
| 5 | `dashboard_explain_plan_atdd_test.go` | AC14 (green-phase, NOT gate) | none (runtime plan check) |

### Acceptance-criteria coverage (red set)
- **AC1** — student not 403'd at the edge (ungated chain, D2). ✅ file 1
- **AC2** — role discriminator + exactly-one-block-non-null, other two explicit `null` (the null-half is the gate). ✅ file 1
- **AC13** — per-role query-count ≤N (O(1)-in-rows) + PROVEN-fails-on-synthetic-N+1 + no-op guard; counting boundary = the tx the service runs on (DBTX decorator). ✅ file 4
- **AC15** — teacher-A own-class rows present (positive control) + teacher-B excluded (negative), both directions. ✅ file 2
- **AC16** — student sees own feedback/questions (positive) + no other student's data (sentinel-name absence) + no class averages (FR-50). ✅ file 2
- **AC17** — cross-tenant A↔B isolation, both directions, per-request re-SET caveat exercised. ✅ file 3
- **AC14** — EXPLAIN no-SeqScan (`enable_seqscan=off`) on center_id/class_id/teacher_id + submissions grading-backlog driver. ⚠️ file 5 (green-phase scaffold, out of gate).

### GREEN-phase handoff (the ONE place the dev reconciles — see each file's SEAMS header)
1. `internal/test/story_8_1_helpers.go` → `NewDashboardTestServerForRole` (ungated `questionChain` shape, NO `RequireRole`, D2).
2. `internal/test/query_counter.go` → `CountingDBTX` / `NewCountingDBTX` / `Begin`(counting tx) / `Count` / `Reset` — the reusable R31 keystone (8.2/8.4 import it); filter tx plumbing or bake the SET-LOCAL offset.
3. `internal/service/dashboard_service.go` → `NewDashboardService(db, clk)` + `GetDashboard(ctx, tc)` (one tx, SetTenantContext, role-branch; reuse `AtRiskDetector` + `teacherScope`).
4. `internal/handler/dashboard_handler.go` + route in `cmd/api/main.go` (copy `questionChain`).
5. `queries/dashboard.sql` (D6 new aggregates, `, id` tiebreaks, `@now` bucketed in `centers.timezone`) → `codegen.sh`.
6. Per-role `maxDashboardQueries*` consts in file 4 are placeholder ceilings — tune to the exact composed query set (N = 1 SET LOCAL + k sqlc) in green.

### Activation (green phase, per-file un-tag)
Dev removes the `//go:build atdd_red_phase` directive from each file AS its seam lands (the landed-story convention — the header comment stays as history). Verify each activated test RED-then-GREEN. All must be un-tagged + green before 8-1a → done (WF-8 epic-boundary gate).
