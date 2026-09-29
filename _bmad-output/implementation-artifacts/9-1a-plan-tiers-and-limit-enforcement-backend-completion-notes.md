# Story 9-1a: Completion Notes

_Implementation record for [`9-1a-plan-tiers-and-limit-enforcement-backend.md`](./9-1a-plan-tiers-and-limit-enforcement-backend.md). Status: review._

## Dev Agent Record

### Debug Log

- **Ledger `balance_after` ordering (D14) — the silent-money trap.** `now()` is transaction-constant in Postgres, so the `monthly_grant` + `job_deduction` rows a single consume writes shared a timestamp, and the ATDD helpers' `ORDER BY created_at DESC, id DESC` tie-broke on a random UUID → `latestLedgerBalanceAfter` non-deterministically returned the wrong row and chain-integrity flapped. Fixed by writing the credit ledger rows with `created_at = clock_timestamp()` (advances within a tx) so insertion order is stable.
- **Refund cross-reset bucketing (D17) needs a period marker.** With a MockClock, the ledger `created_at` (real `now()`) can't distinguish which monthly period a deduction belonged to. Added a nullable `ai_credit_ledger.period_end` column (migration 20260929120300) that records the `reset_at` in effect for a monthly-bucket spend; refund credits `addon_remaining` when the deduction's `period_end` ≠ the current `reset_at` (prior period), else decrements `monthly_used` — never underflows.
- **Ledger `user_id` FK vs center-scoped accounting.** 9-1a's credit rows are center-scoped, but `ai_credit_ledger.user_id` is `NOT NULL`. Rather than alter the append-only 4.3a table, `newBillingCenter` seeds an owner user and the consume/refund/grant rows carry `tc.UserID`. No schema change to the ledger's NOT NULL / RLS / REVOKE.
- **Flag guard lives at the WIRING layer, not in the billing methods.** The credit reds call `CheckAndConsumeCredit` directly and expect enforcement without setting the flag; the seat-race red sets it and goes through `CreateEnrollment`. So `BILLING_ENFORCEMENT_ENABLED` is checked at each resource-service call site (`billingEnforcementEnabled()`), and the billing methods always enforce when invoked. `EnsureBillingRows`/`SetPlan`/reads are NOT flag-guarded (the rows + read API always ship live — D19).
- **No-lock control (Murat/D15) run + reverted.** Temporarily neutralized `acquireLock` → the credit race, concurrent-reset, and seat race all produced 2 successes / 2 grants (proving the `pg_advisory_xact_lock(hashtext(center), class)` is load-bearing), then restored.
- **Pre-existing dev-DB pollution.** `TestAdversarial_TokenEntropy` failed (201 vs 200) on a stray `email_verifications` row for `duc.do@kovernow.com` seeded **2026-09-27** (before this story) — unrelated to 9-1a; the test assumes an empty table. Deleted the orphan; the test passes and my tests don't write `email_verifications`. Also fixed a `seedFreeClass` helper leak (student users weren't cleaned up).

### Completion Notes

- **Epic-9 keystone shipped.** `subscriptions` + `ai_credits` RLS tables (ENABLE+FORCE, tenant SELECT/INSERT/UPDATE, UNIQUE(center_id), CHECKs) + idempotent genesis backfill (per-center `set_config` loop, VN-local `reset_at`). `internal/plan` holds the locked Free/Pro/Studio catalog (NO `plan_limits` table — D2/FU-4-4-4) with round-half-up VAT.
- **`BillingService`** owns: the write-time seat/class/students-per-class gates (run inside the caller's tx under `(center, {1,2,3})` locks), the `CheckAndConsumeCredit` + `RefundCredit` credit engine (`(center, 4)` lock, monthly-then-addon spend, lazy Clock reset forfeiting the unused remainder, ledger-first idempotency, `ai_credits` as a typed projection of the ledger head), `SetPlan` (override seam + plan-driven `storage_limit_bytes`), `EnsureBillingRows` (on-center-create), and the Owner-only `GetUsageAndLimits` / `ListPlans` reads.
- **FU-11-CREDITCAP CLOSED** (token-bound per D18 — the 5 credit-consuming Gemini calls set `MaxOutputTokens`). Wired into `ai_grade_service` + `ai_generation_service` (flag-guarded).
- **Read API** `GET /api/billing` + `GET /api/billing/plans` on an Owner `RequireRole` chain; `Billing*`/`PlanCatalog*` schemas banner-marked PROVISIONAL (9-1b co-finalizes). `codegen.sh` regenerated Go + `client.ts`; `web tsc -b` = 0.
- **Enforcement dark-launched** (`BILLING_ENFORCEMENT_ENABLED` default OFF in prod — D19); arms at 9.2. High-water grandfather refinement deferred to FU-9-1-GRANDFATHER (9.2).

### Deferrals / follow-ups

- **FU-9-1-GRANDFATHER** (9.2): high-water "re-add up to prior level" needs a baseline captured at arming.
- **/bmad-tea TA candidates** (P2/P3, per the WF-8 protocol): dedicated end-to-end enqueue-gate integration for AC11/12 through `ai_grade`/`ai_generation` (the consume core is unit-tested directly); dedicated teacher-seat (AC7) + class-limit (AC8) green tests (the gate logic is shared with the tested students-per-class path); k6/perf.

### Test evidence

- 8 WF-8 ATDD reds green (18 fns): `subscriptions_rls` (5), `ai_credits_rls` (5), `credit_gate` (2), `credit_gate_race` (1), `credit_reset_reconcile` (2), `credit_refund` (3), `plan_limit_seat_race` (2), `billing_authz` (2). No-lock control proven.
- Green coverage: `plan` unit (locked numbers + VAT), `billing_green_test` (flag OFF/ON, monthly-then-addon, SetPlan storage, canManageBilling actor-context, EnsureBillingRows, DST/short-month reset), `billing_read_test` (genesis-Free envelope + plan catalog VAT), `error_mapper_billing_test` (409/402 details), `ai_max_tokens` (D18 both services).
- `go build ./...` + `go vet` clean; full backend suite `-p 1` green (0 fail/panic). Migrations up→down×4→up clean; backfill idempotent (N=N=N). `web tsc -b` = 0.

## File List

### Added
- `classlite-api/migrations/20260929120000_create_subscriptions.{up,down}.sql`
- `classlite-api/migrations/20260929120100_create_ai_credits.{up,down}.sql`
- `classlite-api/migrations/20260929120200_backfill_free_subscriptions.{up,down}.sql`
- `classlite-api/migrations/20260929120300_add_ai_credit_ledger_period_end.{up,down}.sql`
- `classlite-api/internal/plan/plan.go` (+ `plan_test.go`)
- `classlite-api/internal/service/billing_service.go`, `billing_read.go`, `billing_errors.go`
- `classlite-api/internal/store/queries/billing.sql` (+ generated `store/generated/billing.sql.go`)
- `classlite-api/internal/handler/billing_handler.go`
- ATDD reds + green tests: `internal/test/{subscriptions_rls,ai_credits_rls,credit_gate,credit_gate_race,credit_reset_reconcile,credit_refund,plan_limit_seat_race}_atdd_test.go`, `internal/test/story_9_1a_helpers.go`, `internal/test/billing_green_test.go`, `internal/handler/{billing_authz_atdd_test,billing_read_test}.go`, `internal/middleware/error_mapper_billing_test.go`, `internal/worker/ai_max_tokens_atdd_test.go`

### Modified
- `classlite-api/api.yaml` — GET /api/billing(+/plans) paths + PROVISIONAL Billing*/PlanCatalog* schemas
- `classlite-api/cmd/api/main.go` — construct `billingSvc`, wire into auth/center/class/enrollment/ai services, mount Owner-gated billing routes
- `classlite-api/internal/middleware/error_mapper.go` — PLAN_LIMIT_EXCEEDED (409) + INSUFFICIENT_CREDITS (402) mappings with typed `details`
- `classlite-api/internal/service/{enrollment_service,class,class_crud,auth,auth_admin,center,ai_grade_service,ai_generation_service}.go` — `SetBillingService` + gate call sites
- `classlite-api/internal/gemini/client.go` — `MaxOutputTokens` on the request + per-feature ceilings (D18)
- `classlite-api/internal/worker/{ai_generate,ai_grade_writing,ai_grade_speaking}.go` — bind the 5 Gemini calls to the ceilings
- `classlite-web/src/lib/api/client.ts` — regenerated (billing types)
- `docs/bmad-story-conventions.md`, `docs/manual-setup.md`, `_bmad-output/implementation-artifacts/deferred-work.md` — money boundary (D25), `BILLING_ENFORCEMENT_ENABLED`, FU-11-CREDITCAP CLOSED
