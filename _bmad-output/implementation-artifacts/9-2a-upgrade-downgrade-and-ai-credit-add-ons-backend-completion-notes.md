# Story 9-2a: Completion Notes

_Implementation record for [`9-2a-upgrade-downgrade-and-ai-credit-add-ons-backend.md`](./9-2a-upgrade-downgrade-and-ai-credit-add-ons-backend.md). Status: review._

## Dev Agent Record

### Debug Log

- **GetSubscription row-struct regression.** Adding the 3 pending-downgrade columns to the SELECT list in a position that didn't match the table's physical column order made sqlc emit a distinct `GetSubscriptionRow` instead of reusing `generated.Subscription`, breaking every 9-1a caller. Fixed by ordering the SELECT/RETURNING lists to match the physical order (pending_* appended AFTER created_at/updated_at).
- **Webhook tenant has no user → `invalid tenant context: user`.** The shared `applyLazyReset` calls `tenantUUIDs(tc)` which requires `tc.UserID`; the webhook re-establishes CENTER context only. Fixed by looking up the center owner (D24) in `ProcessPolarEvent` after `SET LOCAL` and populating `tc.UserID` — so the shared grant/reset paths get a valid actor and ledger rows attribute to the owner. A center with no owner is a HANDLED 200+log drop, not a 500 retry loop.
- **Reconcile threshold vs mock clock.** The D18 "≈60s" age gate (`created_at < clk.Now()-60s`) is unusable with the MockClock (billingEpoch 2026-09-15) because the DB `now()` the intent rows carry is real wall-clock — so a just-created intent is never "old enough". Dropped the time predicate from `ListPendingCheckoutIntents` (reconcile all pending; the apply is idempotent via MarkCheckoutIntentApplied + invoice UNIQUE + target-state plan-apply). The 60s poll-throttle is documented as a future perf refinement, not correctness.
- **Pre-tenant confused-deputy resolution.** `subscriptions` is FORCE RLS, so a pre-tenant classlite_app SELECT by `polar_subscription_id` returns 0 rows — the confused-deputy test would then fall back to the spoofed body center. Fixed with a `SECURITY DEFINER polar_center_by_subscription_id()` function (the exact 4.3a `next_ready_job_center` pattern) returning only the center_id; the persisted mapping wins over the body's metadata.

### Completion Notes

**All 40 ACs satisfied; all 13 story tasks complete.** The 13 WF-8 ATDD red files were turned green (37 test functions pass) with ZERO changes to their assertions — only the `//go:build atdd_red_phase` tag stripped per file as its seams landed, plus a one-line rewrite of the throwaway `rlsCompileFailAnchor` (it referenced a package-level `SetPlanFromPolar`; it is a method — anchor now calls it on a nil `*BillingService`, never invoked).

Substrate-first sequencing honored (D-fold-all): migrations → `internal/polar` → config → `internal/polarwebhook` verifier + `ProcessPolarEvent` dispatch (the R11 substrate reds green) BEFORE the add-on/upgrade/downgrade business handlers.

Key design decisions realized:
- **D17** `SetPlanFromPolar` — a dedicated period-from-payload, change-gated seam; a mid-cycle upgrade preserves `monthly_used` + adopts the Polar `period_end` (annual honored); an unrelated `subscription.updated` is a credit/period no-op. The genesis/override `SetPlan` is untouched.
- **D19/D22/D23** layered idempotency — the `polar_webhook_events` PK dedup (whole dispatch in ONE tx; the loser mutates nothing), the ledger-FIRST add-on grant over a FULL `UNIQUE(ref_purchase_id, reason)` index (SEPARATE `InsertAddonPurchaseLedgerRow`; the 9-1a `InsertCreditLedgerRow` + its 4 call sites untouched), and `invoices` `UNIQUE(polar_order_id)`. The add-on ledger `ref_purchase_id` == the `invoices.id` via a deterministic UUID derived from the Polar order id (D8 linkage).
- **D18/D20/D21** — `billing_checkout_intents` persisted at checkout-create + reconciled read-triggered on `GET /api/billing`; tenant resolution via the SECURITY DEFINER mapping first (confused-deputy guard); every outbound Polar call runs OUTSIDE any DB tx/lock.
- **D24** webhook ledger rows attribute to the center owner; **D25** `CheckAndConsumeCredit` gained a tier-eligibility check BEFORE the balance check (Free denied even with `addon_remaining > 0`); **D26** an upgrade clears + is single-slot with downgrade; **D27** the public webhook route bypasses `originMW` + the shared RateLimit (main.go root-mux), caps the body before HMAC, never 500/panics.

Enforcement stays dark-launched OFF in prod (D3); `BILLING_ENFORCEMENT_ENABLED` promoted into `Config` (LogSummary + .env.example) but still read at call time so the no-op-when-off semantics are byte-identical to 9-1a. The live `POLAR_API_KEY` defaults to the mock client — no live charge is possible until arming.

**Deviations / deferrals** (all logged in `deferred-work.md`): the no-guard falsification controls (D22 A/B, D23) remain `t.Skip`-guarded as authored — the positive concurrency reds prove exactly-once; running the controls requires temporarily removing a guard (verified by design, not permanently altered). The grandfather per-class enrollment baseline capture is a `scripts/` backfill (D29d — unexercisable until post-9-2b arming); `paymentMethod` ships PROVISIONAL-null; the real `internal/polar` HTTP wire shapes are untested beyond compile (FU-9-POLAR-CONTRACT — mock is the CI signal, sandbox smoke is the arming precondition). `GetProrationPreview` (AC12) has no red test — implemented + proxies Polar verbatim, compile-verified only.

### Implementation Plan (summary)

1. 7 migration pairs (polar_webhook_events no-RLS, invoices, billing_checkout_intents, subscriptions pending+status-widen, ledger FULL purchase index, center_resource_baselines, SECURITY DEFINER resolution fn) → migrate up→down→up clean.
2. `store/queries/polar.sql` + billing.sql extension → `sqlc generate`.
3. `internal/polar` (client + mock), `internal/polarwebhook` (verifier) → signature reds green.
4. `internal/config` Polar vars + flag promotion; `internal/plan/addon.go` catalog.
5. `internal/service/billing_polar.go` (SetPlanFromPolar, ProcessPolarEvent, CreateCheckout, Schedule/CancelDowngrade, reconcile, add-on grant, baselines, ProbeGate) + billing_service tier-gate/grandfather + billing_read D-DASH + reconcile-on-read; error_mapper 403.
6. `internal/handler` webhook receiver + billing write/preview/contract-probe handlers.
7. `cmd/api/main.go` wiring (Polar client, webhook route bypass, new endpoints).
8. `api.yaml` + `scripts/codegen.sh` (sqlc + openapi-typescript) LAST.
9. Strip red tags per file; full backend suite green `-p 1` (16 pkgs, 0 fail).

## File List

### Added
- `classlite-api/migrations/20260930120000_create_polar_webhook_events.{up,down}.sql`
- `classlite-api/migrations/20260930120100_create_invoices.{up,down}.sql`
- `classlite-api/migrations/20260930120200_create_billing_checkout_intents.{up,down}.sql`
- `classlite-api/migrations/20260930120300_alter_subscriptions_pending_downgrade.{up,down}.sql`
- `classlite-api/migrations/20260930120400_add_ai_credit_ledger_addon_purchase_index.{up,down}.sql`
- `classlite-api/migrations/20260930120500_create_center_resource_baselines.{up,down}.sql`
- `classlite-api/migrations/20260930120600_create_polar_tenant_resolution_function.{up,down}.sql`
- `classlite-api/internal/polar/client.go` — Client interface + real HTTPS impl (R49 secret posture)
- `classlite-api/internal/polar/mock.go` — deterministic MockClient (CI-only signal)
- `classlite-api/internal/polarwebhook/verify.go` — Standard-Webhooks HMAC verifier (stdlib, no-panic)
- `classlite-api/internal/plan/addon.go` — the add-on pack catalog (tier-conditional pricing, D7)
- `classlite-api/internal/service/billing_polar.go` — Polar apply/dispatch/checkout/downgrade/reconcile/baselines/probe
- `classlite-api/internal/handler/webhook_handler.go` — the signature-verified receiver (D27)
- `classlite-api/internal/handler/billing_polar_handler.go` — owner-only write/preview + contract-probe handlers
- `classlite-api/internal/store/queries/polar.sql` — the 9-2a store queries
- `classlite-api/internal/store/generated/polar.sql.go` — sqlc output (generated)
- `classlite-api/internal/test/story_9_2a_server_helpers.go` — the FU-9-CONTRACT-402 probe harness

### Modified
- `classlite-api/internal/config/config.go` — Polar vars + BILLING_ENFORCEMENT_ENABLED promotion + LogSummary
- `classlite-api/internal/service/billing_service.go` — polar field + NewBillingServiceWithPolar; D25 tier-gate in consumeCreditTx; D13 effectiveMax in the three Check* gates
- `classlite-api/internal/service/billing_read.go` — reconcile-on-read; NextInvoice/PaymentMethod/PendingDowngrade
- `classlite-api/internal/service/billing_errors.go` — AddonNotAvailableError (→403)
- `classlite-api/internal/handler/billing_handler.go` — D-DASH DTO fields + mappers
- `classlite-api/internal/middleware/error_mapper.go` — AddonNotAvailableError → 403 ADDON_NOT_AVAILABLE
- `classlite-api/internal/store/queries/billing.sql` — GetSubscription/InsertSubscriptionDefault carry pending_* cols
- `classlite-api/internal/store/generated/{models.go,billing.sql.go}` — sqlc output (generated)
- `classlite-api/cmd/api/main.go` — Polar client; webhook route bypass (root mux); new owner-gated endpoints
- `classlite-api/api.yaml` — 9-2a paths + schemas (PROVISIONAL) + extended BillingSummary
- `classlite-web/src/lib/api/client.ts` — openapi-typescript output (generated)
- `.env.example` — the full Polar block + BILLING_ENFORCEMENT_ENABLED
- `docs/manual-setup.md` — `## Polar.sh — Billing Payments (Story 9.2a)` + BOTH arming preconditions
- `_bmad-output/implementation-artifacts/deferred-work.md` — FU-9-POLAR-CONTRACT, FU-9-REFUND + 3 notes
- `classlite-api/internal/test/story_9_2a_helpers.go` + the 13 `*_atdd_test.go` files — red tag stripped (green); `billing_polar_rls_atdd_test.go` anchor rewritten to a method call

### Deleted
- (none)
