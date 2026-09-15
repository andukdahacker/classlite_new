# Story 8-1a: Completion Notes

_Implementation record for [`8-1a-role-specific-dashboards-backend.md`](./8-1a-role-specific-dashboards-backend.md). Status: review._

## Dev Agent Record

### Debug Log

- **ATDD seed scaffold bug (fixed, green-phase finalize).** `dashSeedAtRiskStudent` (`dashboard_scope_atdd_test.go`) inserted 3 attendance rows against ONE session for the same student → `uq_attendance_session_student` unique-constraint violation (SQLSTATE 23505). Attendance is unique per (session, student); 3 absences require 3 distinct past sessions. Fixed the helper to create one session per absence (present+late/total = 0/3 = 0.0 < AtRiskAttendanceFloor 0.70). This is the only ATDD-body change beyond un-tagging.
- **Query-count boundary (harness keystone).** Implemented exactly per D7(1): `CountingDBTX.Begin()` returns a `countingTx` (embeds `pgx.Tx`, overrides Exec/Query/QueryRow) that increments the parent counter, filtering tx plumbing (`BEGIN`/`COMMIT`/`ROLLBACK`/`SAVEPOINT`/`RELEASE`/`SET …`). The synthetic-N+1 proof test passes → the counter is not a no-op. Measured counts: teacher 7, owner 9, student 5 (ceilings 8/13/8) — see `evidence/query-count.json`.
- **Full Go race suite — pre-existing date-bomb, NOT a regression.** `internal/handler/template_handler_atdd_test.go` + `internal/service/class_atdd_test.go` (Story 3.1/2.3b spawn) FAIL with `startDate must not be more than 30 days in the past`: they seed hardcoded `StartDate: "2026-08-01"`, which is 43 days before the run date (2026-09-13) → trips the >30-days-past validation. These files are untouched by 8-1a; the story's Task 9 pre-identified this exact date-bomb. The `internal/test` package (all dashboard tests) is fully green.
- **Web ESLint — pre-existing, unrelated.** 5 errors / 4 warnings are all in `AIGenerateDialog.tsx` (4.3b) + `TeacherQuestionCard.tsx`/`QuestionsConsolePage.tsx` (7.4b) — `react-hooks/incompatible-library` on RHF `watch()`. None are in files 8-1a touched; the only web artifact changed is the additive generated `client.ts` (+228 lines), which is lint-clean.

### Completion Notes

- **Endpoint:** net-new `GET /api/dashboard` on the ungated Q&A-style chain (`extractTenant → requireVerified → requireCenter → ErrorMapper`, NO `RequireRole`, D2), role-branched in `DashboardService.GetDashboard` (D3/D4). One tx, `SetTenantContext`, injected clock (D8/D9/PERF-1). `WriteEnvelope` → `{data, meta.serverTime}` (D10, GO-5 explicit nulls).
- **Payloads:** teacher (weekSessions + needsGrading + unansweredQuestions + atRiskStudents), owner/admin (pulse + todaySessions + needsAttention{unassigned, at-risk, storage-capacity, pendingInvites} — NO Q&A, NO plan/seat), student (upcomingSessions + dueSoon + recentFeedback + myQuestions — no class avgs / other students). Exactly one role block non-null (AC2).
- **Reuse:** `AtRiskDetector.Classify` UNCHANGED (D5, thresholds imported, set-based classify — no N+1). Reused `ListSessionsByRange`, `ListStudents`, `Count/ListQuestionsForReader`, `ListStudentAssignments`, `Count/ListUnassignedStudents`, `SumFileSizeByCenter`, `GetCenterStorageLimit`. New aggregates in `queries/dashboard.sql`: `GetCenterTimezone`, `Count/ListGradingBacklog`, `ListStudentRecentFeedback`, `GetOwnerPulse`, `ListTodaySessionsForCenter`, `CountPendingInvites`, `ListStudentUpcomingSessions`. Every top-N rail carries a `, id` tiebreak (AC11).
- **Timezone bucketing (D8):** `GetDashboard` loads `centers.timezone` and computes day/week boundaries in that tz (Monday-based week), passing absolute instants as args. Student upcoming/due windows are relative (`[now, now+7d)`) — TZ-agnostic, per D8.
- **Keystone harness (D7):** `internal/test/query_counter.go` (`CountingDBTX`) is the reusable R31 query-count helper 8.2/8.4 inherit; `dashExplainNoSeqScan` (in the ATDD explain file) is the reusable EXPLAIN-under-`enable_seqscan=off` helper. Both green.
- **Deviations / provisional deferrals (D12, for the 8-1b co-finalize):**
  - `DashboardAtRiskItem.pendingCount` (listed in AC4 prose) is OMITTED — not cheaply derivable from `ListStudents` without an N+1 or a shipped-query change. Item carries studentId, name, attendanceRate, overallBand, reasons. Pragmatic-over-literal (per `[[feedback_pragmatic_interpretation_of_spec_absolutes]]`); 8-1b can source it from `GetStudentSubmissionStats` if the UI needs it.
  - `className` on the teacher unanswered-question rail and on `DueItem` is OMITTED — not returned by the reused `ListQuestionsForReader` / `ListStudentAssignments`; `classId` is provided. Deferred to co-finalize (or a join then).
  - Owner over-capacity classes (AC8 "MAY", dev discretion) NOT included — keeps the contract tight and the owner query budget low; can be added in 8-1b if the UI surfaces it.
- **AtRiskScanCap:** the at-risk rail scans up to `DashboardAtRiskScanCap = 200` students per invocation and classifies them in Go; `count` is the at-risk total within that scan. Documented cap (a center with >200 students would under-count the rail total — acceptable for the dashboard summary; the roster page is the authoritative list).

### Implementation Plan (as executed)

1. Recon: ATDD seams (5 files), reference code (at_risk_detector, response envelope, store db, student_service tx/teacherScope, main.go questionChain, test infra), SQL shapes + table columns (Explore agent).
2. Task 1 — `api.yaml`: `GET /api/dashboard` + `Dashboard*` schemas (PROVISIONAL, GO-5 nullable). 
3. Task 2 — `queries/dashboard.sql` (8 new queries). Ran `codegen.sh` (sqlc + openapi-typescript) once for Tasks 1+2.
4. Task 3 — `dashboard_service.go` (DTOs + role branches + rail builders + tz bucketing).
5. Task 4 — `dashboard_handler.go` + `main.go` route on the ungated chain.
6. Task 5 — `query_counter.go` (CountingDBTX keystone).
7. Task 7 — `story_8_1_helpers.go` (test server), un-tagged the 5 ATDD files, fixed the seed bug; added `dashboard_handler_test.go` (envelope + empty-state + genuine 401) and `dashboard_aggregation_test.go` (overdue flag, feedback band).
8. Task 6 — EXPLAIN harness green (no partial index needed; `idx_submissions_status_created_at` covers the status driver).
9. Task 8 — RLS/per-role adversarial grid green (AC15/16/17).
10. Task 9 — verify: `go build`/`go vet` clean, web `tsc -b`=0, dashboard suite green, evidence emitted. Documented the pre-existing spawn date-bomb + web-lint findings.

## File List

### Added
- `classlite-api/internal/store/queries/dashboard.sql` — 8 new dashboard aggregates
- `classlite-api/internal/store/generated/dashboard.sql.go` — sqlc-generated (do not edit)
- `classlite-api/internal/service/dashboard_service.go` — DashboardService + response DTOs
- `classlite-api/internal/handler/dashboard_handler.go` — GET /api/dashboard handler
- `classlite-api/internal/test/query_counter.go` — R31 CountingDBTX keystone (8.2/8.4 reuse)
- `classlite-api/internal/test/story_8_1_helpers.go` — NewDashboardTestServerForRole (ungated chain)
- `classlite-api/internal/test/dashboard_handler_test.go` — envelope + empty-state + genuine-401
- `classlite-api/internal/test/dashboard_aggregation_test.go` — overdue flag + feedback band
- `classlite-api/internal/test/dashboard_query_count_evidence_test.go` — P0 evidence emitter
- `classlite-api/evidence/query-count.json` — P0 evidence (measured teacher 7 / owner 9 / student 5)

### Modified
- `classlite-api/api.yaml` — dashboard path + `Dashboard*` schemas (PROVISIONAL, GO-5 nullable)
- `classlite-api/cmd/api/main.go` — dashboardSvc/handler + ungated dashboardChain + route
- `classlite-web/src/lib/api/client.ts` — generated (+228, additive Dashboard* types)
- `classlite-api/internal/test/dashboard_role_branch_atdd_test.go` — un-tagged (seam landed)
- `classlite-api/internal/test/dashboard_scope_atdd_test.go` — un-tagged + fixed `dashSeedAtRiskStudent` unique-constraint bug (one session per absence)
- `classlite-api/internal/test/dashboard_cross_tenant_rls_atdd_test.go` — un-tagged
- `classlite-api/internal/test/dashboard_query_count_atdd_test.go` — un-tagged
- `classlite-api/internal/test/dashboard_explain_plan_atdd_test.go` — un-tagged (green-phase)

### Deleted
- None.
