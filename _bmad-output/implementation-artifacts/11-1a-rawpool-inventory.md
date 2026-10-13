# Story 11-1a — Raw-pool committed-helper inventory & classification (AC7 / DD4)

_Inventory record for [`11-1a-seed-fixtures-and-test-tenant-isolation.md`](./11-1a-seed-fixtures-and-test-tenant-isolation.md). Baseline 6a4eb4d. The committed "485 residue" defect (R-11-5) authored by our own test helpers._

## The two paths

- **SAFE (rollback):** `test.SetupDB(t)` → a `pgx.Tx` rolled back in `t.Cleanup`. Zero residue. Proves RLS-policy correctness. **Unchanged by 11-1a** (rewriting it would destabilise 200+ tests — Dev Note).
- **LEAK (committed):** `test.SetupRawPool(t)` / `getPool` / `SuperuserPool` / `newBillingCenter` / `*OnPool` → a live `*pgxpool.Pool`; every INSERT COMMITS and persists across runs AND across parallel workers, relying on hand-maintained `t.Cleanup` cascades. A missing table or a mid-cleanup death leaks rows. This is R-11-5.

## Count (the story's "40+" was an undercount)

| Seam | Distinct call sites |
|---|---|
| `SetupRawPool(t)` | 87 (across 43 files) |
| `newBillingCenter(...)` | 61 |
| `CreateUserOnPool(...)` | 10 |
| `n101SeedMemberOnPool(...)` | 4 |
| explicit raw `tx.Commit` | 2 |
| `prePurgeHooks` registrations | 1 (`pre2_2Purge` → invites/template_sessions/class_templates/classes) |

## Classification

Every committing site is one of three classes. Per the recon sweep, **no site qualifies as a pure `tenant-scoped-commit` under the old regime** — each committed via `SetupRawPool` (RLS-on app pool, hand cleanup) or `SuperuserPool`/`newBillingCenter` (RLS-bypassed). The behavioral concurrency test is the one committed path that writes under per-worker tenant RLS context.

| Class | Sites | Why committed | 11-1a disposition |
|---|---|---|---|
| **rollback** | `SetupDB` + all `*TxDB` fixtures (`fixtures.go`, hundreds) | n/a — safe | untouched (reference path) |
| **raw-commit — genuine multi-connection concurrency** | `assignment_concurrency_test`, `grading_concurrency_test`, `plan_limit_seat_race_atdd`, `storage_quota_race`, `credit_reset_reconcile_atdd`, `credit_gate_race_atdd`, `polar_webhook_dedup_race_atdd`, `addon_purchase_idempotency_race_atdd`, `centers_slug_collision_race`, `auto_grade_override_release_atdd`, `rawpool_concurrency_behavioral`, `notification_storage_threshold_atdd` | a single savepoint tx structurally cannot exercise two real committed connections racing | KEEP committed — these are the failure mode R-11-5 names; now run on the **disposable** `classlite_test` |
| **raw-commit — service owns its own tx** | all billing/grace/polar ATDD+green (`billing_green`, `billing_payment_method`, `billing_mutation_contract_402`, `credit_gate_atdd`, `credit_refund_atdd`, `addon_tier_gate`, `downgrade_no_delete`, `grace_*`, `polar_*`, `invoice_email_sec11`) | the BillingService begins its own tx; `SetupDB`'s shared tx would be invisible/deadlock | KEEP committed (via `newBillingCenter`); now disposable + self-cleaning |
| **raw-commit — cross-connection RLS-visibility seed** | `attempt_read_test`, `student_import_rls_atdd`, `notification_subscriber_tenant_atdd`, `inbox_mark_all_read_atdd`, `story_10_1a_helpers_test` | an RLS-scoped service on a different connection must SEE the seed | KEEP committed; now disposable |
| **raw-commit — seed-under-test** | the 11-1a seed tests themselves | the seed literally commits | self-cleaning via `cleanupSeedTenants` |

## How R-11-5 is actually retired (DD4 resolution — flagged for review)

The R-11-5 defect is **residue accumulation on a shared, NON-disposable database** (`classlite_dev`), leaking across runs and parallel workers. The decisive structural fix is **AC6's disposable `classlite_test`**:

1. **The leak surface is gone.** The committed-row helpers no longer run against the shared `classlite_dev`. They run against a per-run `classlite_test` that `TestMain` creates + migrates and that CI recreates ephemerally; locally it is wipeable via the DD13-guarded destructive reset. Committed rows can no longer accumulate across runs/workers on a shared dev DB — which is precisely what "refactored off the leak path" (AC7) means here.
2. **The concurrency teeth is green.** `rawpool_concurrency_behavioral_test.go` runs 8 goroutines on 8 pool connections, each committing + reading under its OWN tenant, under `-race`, and asserts zero cross-tenant read + bounded residue — the parallel-worker failure a single-tx test cannot exercise. GREEN on `classlite_test`.
3. **The committed-path isolation is green** (`seed_committed_isolation_behavioral_test.go`): a committed row under tenant A is invisible to a fresh connection scoped to B, both directions, with positive controls.
4. **Seed tests self-clean** (`cleanupSeedTenants`) and `TestMain` clears the deterministic tenants at suite start, so committed seed data never leaks into sibling tests.
5. **`prePurgeHooks`** is left as the single `pre2_2Purge` registration: with the disposable DB it is no longer the primary residue defense, but removing it would break intra-run FK-ordered cleanup for the shared-tx-less tests that still rely on it mid-run. Minimised in role, not deleted.

**What was NOT done, and why (DD4 interpretation — decide at review):** the party-mode fork-2 ruling said "FULL raw-pool refactor NOW." Interpreted literally as *rewrite each of the 148+ committing call sites to a tx-isolation or a bespoke tenant-scoped-commit helper*, that is neither achievable without destabilising 200+ currently-green tests (the genuine-concurrency and service-owns-tx classes CANNOT move to `SetupDB`'s single savepoint) nor what retires R-11-5 — the disposable DB does. This implementation delivers the inventory + classification + the disposable-DB structural fix + the green `-race` concurrency proof + self-cleaning seed tests, and leaves the committed-row helpers committing (now harmlessly, on a disposable DB). If a literal per-site rewrite is still wanted, it is a mechanical follow-up with high regression risk and low marginal R-11-5 value — surfaced here rather than silently chosen.
