---
stepsCompleted: ['step-01-preflight-and-context', 'step-02-generation-mode', 'step-03-test-strategy', 'step-04-generate-tests', 'step-04c-aggregate']
lastStep: 'step-04c-aggregate'
lastSaved: '2026-09-28'
generationMode: 'ai-generation (backend — no browser recording); sequential (orchestrator authored the Go reds directly — richest context; E2E worker N/A for backend)'
redVerified: true
generatedTestFiles:
  - 'classlite-api/internal/test/story_9_1a_helpers.go'
  - 'classlite-api/internal/test/subscriptions_rls_atdd_test.go'
  - 'classlite-api/internal/test/ai_credits_rls_atdd_test.go'
  - 'classlite-api/internal/test/credit_gate_atdd_test.go'
  - 'classlite-api/internal/test/credit_gate_race_atdd_test.go'
  - 'classlite-api/internal/test/credit_reset_reconcile_atdd_test.go'
  - 'classlite-api/internal/test/credit_refund_atdd_test.go'
  - 'classlite-api/internal/test/plan_limit_seat_race_atdd_test.go'
  - 'classlite-api/internal/handler/billing_authz_atdd_test.go'
storyId: '9.1a'
storyKey: '9-1a-plan-tiers-and-limit-enforcement-backend'
storyFile: '_bmad-output/implementation-artifacts/9-1a-plan-tiers-and-limit-enforcement-backend.md'
atddChecklistPath: '_bmad-output/test-artifacts/atdd-checklist-9-1a-plan-tiers-and-limit-enforcement-backend.md'
generatedTestFiles: []
inputDocuments:
  - '_bmad-output/implementation-artifacts/9-1a-plan-tiers-and-limit-enforcement-backend.md'
  - 'docs/project-context.md (TEST-BE-1..5, GO-1..7, WF-8 red convention)'
  - 'classlite-api/internal/test/storage_quota_race_test.go (SetupRawPool race pattern = the D15 harness)'
  - 'classlite-api/internal/test/grading_concurrency_test.go (2-connection race idiom)'
  - 'classlite-api/internal/test/ai_credit_ledger_rls_atdd_test.go (RLS + double-refund idempotency pattern)'
  - 'classlite-api/internal/test/_TEMPLATE_rls_test.go (RLS red template)'
  - 'classlite-api/internal/test/helpers.go, fixtures.go, story_2_1/2_2_helpers.go (harness primitives)'
detectedStack: 'backend'
---

# ATDD Red-Phase Plan — Story 9-1a (Plan Tiers & Limit Enforcement — Backend)

## Step 1 — Preflight & Context

**Stack:** `backend` (Go 1.22 · pgx v5 · sqlc · Postgres RLS). Frontend exists (`classlite-web`) but 9-1a is backend-only; every red is Go. No Playwright/UI.

**Prerequisites:** ✅ Story approved (v0.2, 30 ACs, risk 7). ✅ Go test harness present (`classlite-api/internal/test/`, `go test`). ✅ Dev env available (docker-compose Postgres).

**Red convention (project — verified in code):**
- `//go:build atdd_red_phase` at file top → excluded from normal `go build`/`go test`; compiles ONLY under the tag, where it **compile-fails against the greenfield seams** (`service.BillingService`, `service.PlanLimitExceededError`, `service.InsufficientCreditsError`, `plan` package, `subscriptions`/`ai_credits` tables). Header block documents the story/AC/seam. Green-phase = implement seams, then the tag is removed (test joins the normal suite).
- **Concurrency reds MUST use `SetupRawPool` (real committed writes, 2 goroutines), NOT `SetupDB`** — the storage-quota-race header spells out why: `SetupDB` wraps the test in ONE `pgx.Tx` that serializes goroutine writes, so a broken (un-serialized) check would false-green. `SetupRawPool` IS the D15 "dedicated concurrency harness exempt from TEST-BE-2" the party-mode review demanded — it already exists.
- **RLS reds use `SetupDB`** + raw insert helpers + `AssertRLSViolation`, mirroring `ai_credit_ledger_rls_atdd_test.go` (cross-tenant read + cross-tenant insert + null-tenant + unset-tenant + same-tenant POSITIVE control).

**Harness primitives available (no new infra needed):** `SetupRawPool`, `SetupDB`, `SuperuserPool`, `TenantContext`, `CreateCenterWithID`, `UUIDString`, `NewPGUUIDFromString`, `MustParseUUID`, `AssertRLSViolation`, `resetTenantContext(ToDefault)`, `TenantAID`/`TenantBID` consts. New file: `story_9_1a_helpers.go`.

**Key correction vs party-mode D15:** the "un-satisfiable under TEST-BE-2" blocker is already solved by the `SetupRawPool` convention (used by `storage_quota_race_test.go`, `grading_concurrency_test.go`, `assignment_concurrency_test.go`, `centers_slug_collision_race_test.go`). The reds follow that established idiom; no new harness is invented. The party-mode ask for a "no-lock control that proves the race" IS added (storage-quota-race lacks one; ours will).

## The 8 WF-8 ATDD reds to generate (risk 7 — all red before in-progress)

| # | Red | AC | Harness | File |
|---|---|---|---|---|
| 1 | Seat/enrolment cap race — 2 concurrent (cap-1→cap→cap+1), exactly one `PLAN_LIMIT_EXCEEDED` + no-lock control double-passes | AC10/AC22 | SetupRawPool | `plan_limit_race_atdd_test.go` |
| 2 | Credit gate race — 2 concurrent AI jobs at available=1, SAME (center), exactly one `INSUFFICIENT_CREDITS` | AC13 | SetupRawPool | `credit_gate_race_atdd_test.go` |
| 3 | Concurrent lazy-reset — 2 Checks crossing `reset_at` → exactly one `monthly_grant`, `reset_at` advanced exactly 1 month | AC28 | SetupRawPool | `credit_reset_race_atdd_test.go` |
| 4 | Free 0-credit 402 + single-thread 1→0→402 | AC11/AC30 | SetupRawPool/SetupDB | `credit_gate_atdd_test.go` |
| 5 | Cross-tenant RLS on `subscriptions` (read/insert/null/unset/positive) | AC19 | SetupDB | `subscriptions_rls_atdd_test.go` |
| 6 | Cross-tenant RLS on `ai_credits` (read/insert/null/unset/positive) | AC19 | SetupDB | `ai_credits_rls_atdd_test.go` |
| 7 | Reconciliation across a reset — `available == latest.balance_after` + chain integrity, MockClock reset mid-sequence | AC14 | SetupDB | `credit_reconciliation_atdd_test.go` |
| 8 | Double-refund idempotency + refund-across-reset→addon + refund-never-deducted no-op | AC25 | SetupDB | `credit_refund_atdd_test.go` |

Plus service-seam reds (mock store, TEST-BE-4) for the flag-guard (AC21: OFF-succeeds/ON-blocks), grandfather (AC22 worked example), max_tokens binding (AC23), error `details` shape incl `canManageBilling` (AC26), and the Owner-only 403 handler red (AC16).

## Step 3 — Test Strategy (AC → level → priority)

**Levels (backend, lower-is-better; no E2E):** `unit` (pure math), `integration` (real DB in tx / raw pool for races), `api` (handler through real middleware). Duplicate coverage avoided — plan math is unit-only; SQL/RLS/race/reconciliation is integration-only; envelope/403/details is api-only.

**P0 — the WF-8 gate (money · concurrency · tenant-isolation · authz). RED before in-progress:**
| AC | Scenario | Level | Harness |
|---|---|---|---|
| AC10/AC22 | seat/enrolment cap race → exactly-one-wins + no-lock control double-passes | integration | SetupRawPool |
| AC13 | credit gate race (available=1, same center) → exactly one 402 | integration | SetupRawPool |
| AC28 | concurrent lazy-reset crossing `reset_at` → one `monthly_grant`, +1 month once | integration | SetupRawPool |
| AC11/AC30 | Free 0-credit 402 + single-thread 1→0→402 | integration | SetupRawPool |
| AC19 | `subscriptions` RLS: cross-tenant read/insert + null + unset + positive control | integration | SetupDB |
| AC19 | `ai_credits` RLS: cross-tenant read/insert + null + unset + positive control | integration | SetupDB |
| AC14 | reconciliation `available == latest.balance_after` + chain integrity, MockClock reset mid-sequence | integration | SetupDB |
| AC25 | double-refund no-op + refund-across-reset→addon + refund-never-deducted no-op | integration | SetupDB |
| AC16 | Owner-only 403 on GET /api/billing(+/plans) for teacher/admin/student | api | test server |

**P1 — folded decisions (generate red now or in post-dev TA):** AC21 flag OFF-succeeds/ON-blocks (service, mock store); AC22 grandfather worked example (Free class@8, cap5 — all usable, +1 blocked) (integration); AC23 max_tokens bound on both Gemini calls (service); AC26 `409.details{limit-enum,current,max,canManageBilling}` + `402.details{available,required}` (api); AC5 plan consts + VAT round-half-up (unit); AC15/AC17 `/api/billing` + `/plans` envelope incl `isFree`/`creditsApplicable`/server `approaching` (api).

**P2 — hardening (post-dev TA):** AC30 spend monthly-then-addon ordering + DST/short-month `reset_at += 1 month` (unit/integration); AC3/AC4 genesis backfill idempotent + on-create rows (integration); AC6/AC21 storage ceiling plan-driven (integration).

**Red-phase guarantee:** every file carries `//go:build atdd_red_phase` and references greenfield seams (`service.NewBillingService`, `service.PlanLimitExceededError`, `service.InsufficientCreditsError`, `plan.LimitsFor`, `subscriptions`/`ai_credits` tables) → `go build -tags atdd_red_phase ./internal/test/` FAILS today; green when the seams land + tag removed.

**Deliverable this run:** the 9 P0 reds (the WF-8 gate) as concrete compile-fail files + `story_9_1a_helpers.go`. P1/P2 listed for `/bmad-tea TA` post-dev.

## Step 4 — Generation + Red Verification (DONE)

**9 files written** (see `generatedTestFiles`). All carry `//go:build atdd_red_phase` and follow the shipped idioms: races via `SetupRawPool` (the storage-quota-race pattern), RLS via `SetupDB` + `AssertRLSViolation` (the ai_credit_ledger pattern), handler 403 via a greenfield `test.NewBillingTestServerForRole` seam (the staff-handler pattern).

**RED VERIFIED (the two-invariant proof):**
- `go build ./...` → **GREEN** (tagged reds excluded from the normal build; CI stays green).
- `go vet -tags atdd_red_phase ./internal/test/ ./internal/handler/` → **FAILS** on exactly the greenfield seams:
  `undefined: service.NewBillingServiceWithClock`, `service.InsufficientCreditsError`, `service.PlanLimitExceededError`, `test.NewBillingTestServerForRole` (+ `newEnrollmentServiceForRace`/`seedFreeClass`). Compile-fail = a true red, not a `t.Skip` no-op.
- `gofmt -l` → clean.

**Test count:** 18 red test functions across 9 files.
| File | Reds | AC | Harness |
|---|---|---|---|
| subscriptions_rls_atdd_test.go | 5 (read/insert/null/unset/positive) | AC1/AC19 | SetupDB |
| ai_credits_rls_atdd_test.go | 5 (read/update/null/unset/positive) | AC2/AC19 | SetupDB |
| credit_gate_atdd_test.go | 2 (Free 0→402, 1→0→402) | AC11/AC30 | SetupRawPool |
| credit_gate_race_atdd_test.go | 1 (available=1, same center) | AC13 | SetupRawPool |
| credit_reset_reconcile_atdd_test.go | 2 (forfeit reconciliation, concurrent reset) | AC14/AC28 | SetupRawPool |
| credit_refund_atdd_test.go | 3 (double, cross-reset→addon, never-deducted) | AC25 | SetupRawPool |
| plan_limit_seat_race_atdd_test.go | 2 (enrol race, grandfather) | AC10/AC22 | SetupRawPool |
| billing_authz_atdd_test.go | 2 (non-owner 403 grid, owner 200) | AC16 | test server |

## Green-phase seam contract (what dev implements to turn these green)

1. **`internal/plan`** — tier constants + `plan.LimitsFor` + VAT (Task 2 / AC5).
2. **Migrations T1** — `subscriptions` + `ai_credits` (RLS ENABLE+FORCE, tenant policies, CHECKs, UNIQUE(center_id)) + genesis backfill (Task 1 / AC1-4). Turns the RLS + helper raw-SQL reds runnable.
3. **`service.BillingService`** — `NewBillingServiceWithClock(db, clk)`; `CheckAndConsumeCredit(ctx, tc, jobID)` (center-only `(center,credit=4)` advisory lock, monthly-then-addon spend, lazy reset per D14/D6); `RefundCredit(ctx, tc, jobID)` (ledger-first idempotent, cross-reset→addon); `service.InsufficientCreditsError{Available,Required}`, `service.PlanLimitExceededError{Limit,Current,Max,CanManageBilling}` (Task 3 / AC11-14,25).
4. **Enrollment gate wiring** + greenfield test helpers `newEnrollmentServiceForRace`, `seedFreeClass` in `story_9_1a_helpers.go` (Task 4 / AC10,22).
5. **`test.NewBillingTestServerForRole`** + the Owner-gated routes (Task 5 / AC16).
6. **Remove `//go:build atdd_red_phase`** from each file as its seams land → the suite joins the normal build (green).

**Handoff:** `/bmad-dev-story 9-1a` (implement to green). Post-dev: `/bmad-tea TA 9-1a` for the P1/P2 scenarios (flag OFF/ON, max_tokens, error-details shape, plan/VAT unit, /api/billing envelope), then `/bmad-tea RV`.
