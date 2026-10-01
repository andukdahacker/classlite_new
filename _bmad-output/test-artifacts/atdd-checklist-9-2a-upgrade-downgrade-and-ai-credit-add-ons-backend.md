---
stepsCompleted: ['step-01-preflight-and-context', 'step-02-generation-mode', 'step-03-test-strategy', 'step-04-generate-tests', 'step-05-finalize']
lastStep: 'step-05-finalize'
lastSaved: '2026-09-30'
generationMode: 'ai-generation (backend — no browser recording; from OpenAPI/source/story ACs)'
redVerified: true
redVerifyCommand: 'cd classlite-api && go test -tags atdd_red_phase ./internal/test/  (compile-fails ONLY on documented product seams; normal untagged build + vet GREEN)'
generatedTestFiles:
  - 'classlite-api/internal/test/story_9_2a_helpers.go'
  - 'classlite-api/internal/test/polar_webhook_signature_atdd_test.go'
  - 'classlite-api/internal/test/polar_webhook_dedup_race_atdd_test.go'
  - 'classlite-api/internal/test/polar_webhook_origin_bypass_atdd_test.go'
  - 'classlite-api/internal/test/polar_setplanfrompolar_atdd_test.go'
  - 'classlite-api/internal/test/polar_multi_event_idempotency_atdd_test.go'
  - 'classlite-api/internal/test/addon_purchase_idempotency_race_atdd_test.go'
  - 'classlite-api/internal/test/addon_tier_gate_atdd_test.go'
  - 'classlite-api/internal/test/downgrade_no_delete_atdd_test.go'
  - 'classlite-api/internal/test/polar_checkout_reconcile_atdd_test.go'
  - 'classlite-api/internal/test/polar_tenant_resolution_atdd_test.go'
  - 'classlite-api/internal/test/billing_mutation_contract_402_atdd_test.go'
  - 'classlite-api/internal/test/billing_polar_rls_atdd_test.go'
storyId: '9.2a'
storyKey: '9-2a-upgrade-downgrade-and-ai-credit-add-ons-backend'
storyFile: '_bmad-output/implementation-artifacts/9-2a-upgrade-downgrade-and-ai-credit-add-ons-backend.md'
atddChecklistPath: '_bmad-output/test-artifacts/atdd-checklist-9-2a-upgrade-downgrade-and-ai-credit-add-ons-backend.md'
inputDocuments:
  - '_bmad-output/implementation-artifacts/9-2a-upgrade-downgrade-and-ai-credit-add-ons-backend.md'
  - '_bmad-output/implementation-artifacts/9-1a-plan-tiers-and-limit-enforcement-backend.md'
  - 'docs/project-context.md'
  - 'classlite-api/internal/test/story_9_1a_helpers.go'
  - 'classlite-api/internal/test/credit_gate_race_atdd_test.go'
  - 'classlite-api/internal/test/plan_limit_seat_race_atdd_test.go'
  - 'classlite-api/internal/test/subscriptions_rls_atdd_test.go'
  - 'classlite-api/internal/test/helpers.go'
detectedStack: 'backend'
testFramework: 'go test (stdlib) + pgx v5 real-DB integration'
redPhaseConvention: '//go:build atdd_red_phase — compile-fail against not-yet-existing seams; verify RED via `go test -tags atdd_red_phase ./internal/test/`; tag stripped at green'
---

# ATDD Checklist — Story 9-2a (Upgrade, Downgrade & AI Credit Add-ons — Backend / Polar keystone)

## Step 1 — Preflight & Context

### Stack
`backend` (Go 1.25, `net/http` · pgx v5 · sqlc · RLS · stdlib `crypto/hmac`). Module `github.com/ducdo/classlite-api`. No frontend in scope (9-2b).

### Prerequisites — PASS
- Story approved, `ready-for-dev`, **40 clear ACs** (27 v0.1 + 13 party-mode hardening D17–D29).
- Go test infra present: `internal/test/` package with real-DB integration harness.
- `risk_score 8` → **WF-8 HARD ATDD gate fires**: red-first mandatory before backlog→in-progress.

### Red-phase convention (from 9-1a precedent — VERIFIED in-repo)
- Tag: `//go:build atdd_red_phase` on line 1 → excluded from the normal `go test` build (main suite stays green while reds exist).
- Verify RED: `cd classlite-api && go test -tags atdd_red_phase ./internal/test/` → **compile failure** on not-yet-existing seams (`internal/polar`, `internal/polarwebhook`, `SetPlanFromPolar`, `billing_checkout_intents`, etc.).
- Green: dev removes the tag as each seam lands; the file joins the normal build.
- Header block documents the GREEN-PHASE SEAMS each red will compile against.

### Reusable harness & helpers (do NOT reinvent — TEST-BE-1/2, D15)
- `test.SetupDB(t) *TxDB` — single shared tx, auto-rollback (standard RLS/logic reds).
- `test.SetupRawPool(t) *pgxpool.Pool` — **two real committed txns** — the D15 concurrency harness (`credit_gate_race_atdd_test.go`, `plan_limit_seat_race_atdd_test.go`, `storage_quota_race_test.go` precedent). REQUIRED for every double-delivery / event-PK race red + the no-dedup/no-lock control.
- `newBillingCenter(t, planName, allocation, used, addon, resetAt) (pgtype.UUID, model.TenantContext)` — seeds center + subscription + ai_credits + **owner user + owner center_member** (the owner id is `tc.UserID` — load-bearing for the D24 ledger `user_id` FK).
- `billingEpoch` (fixed MockClock epoch) + `clock.NewMockClock(billingEpoch)`.
- `NewBillingTestServerForRole(...)` — real-middleware httptest server (TEST-BE-3) for the origin-bypass + owner-only + FU-9-CONTRACT-402 reds.
- New: **`story_9_2a_helpers.go`** (tagged red) — Polar mock event builders, signed-webhook request builder (Standard-Webhooks HMAC), checkout-intent seeder, `newBillingCenter` extensions for pending-downgrade / addon state.

### Generation plan — SUBSTRATE-FIRST (per D-fold-all sequencing + Ducdo directive)

**Wave 1 — Substrate / R11 (reds land + verify RED first):**
1. `polar_webhook_signature_atdd_test.go` — AC4/5/23/38/D27: unsigned→401, wrong-secret→401, stale(>300s)→401 `WEBHOOK_TIMESTAMP_STALE`, valid-current→pass, valid-previous(rotation)→pass, third-secret→401, **skew boundaries** (299s accept / 301s / 330s / 331s reject), **body-tamper-after-sign**→401, **future-timestamp** skew→401, **malformed/missing headers→400/401 NEVER panic**, rotation+tamper→401.
2. `polar_webhook_dedup_race_atdd_test.go` — AC6/34/D23 (SetupRawPool): two concurrent same-`event_id` deliveries → exactly ONE mutation, loser's whole tx rolls back (assert balance/plan/invoice untouched). **No-dedup control** proven to double-mutate.
3. `polar_webhook_origin_bypass_atdd_test.go` — AC38/D27 (NewBillingTestServer, REAL stack): a Polar S2S POST with no `Origin` reaches the verifier → 401 on bad-sig (NOT 403 `ORIGIN_NOT_ALLOWED`); oversized body rejected pre-HMAC; malformed → no 500/panic.

**Wave 2 — Money-movement business handlers:**
4. `polar_setplanfrompolar_atdd_test.go` — AC28/D17: mid-cycle upgrade preserves `monthly_used` + adopts Polar `period_end` (annual honored); unrelated `subscription.updated` = credit/period NO-OP.
5. `polar_multi_event_idempotency_atdd_test.go` — AC30/14/D19: `order.paid` + `subscription.updated` for ONE upgrade → exactly one invoice / grant / plan-change (`UNIQUE(polar_order_id)` + target-state).
6. `addon_purchase_idempotency_race_atdd_test.go` — AC33/24/D22 (SetupRawPool): ledger-FIRST via `InsertAddonPurchaseLedgerRow` (FULL `(ref_purchase_id,reason)` index); **dual control** — (A) event-dedup off → still ONE top-up; (B) both off → double-grant. Assert `addon_remaining` **value delta == pack.credits exactly once** (value-scan).
7. `addon_tier_gate_atdd_test.go` — AC36/9/D25: Free + `addon_remaining=500` → AI job **denied** (tier eligibility before balance) + `addon_remaining` intact; re-upgrade → 500 usable. Free add-on purchase → **403 `ADDON_NOT_AVAILABLE`** (no Polar call). 9-1a credit regression stays green.
8. `downgrade_no_delete_atdd_test.go` — AC25/39/D28/D26 (MockClock→renewal): **PK-set snapshot** per table (classes/exercises/submissions/enrollments/files/ai_credit_ledger + subscriptions UPDATE-only + ai_credits addon-survives + center_resource_baselines survives + invoices append-only) → zero deletions; re-upgrade restores. Upgrade **cancels** a pending downgrade; second downgrade **replaces** the first.
9. `polar_checkout_reconcile_atdd_test.go` — AC29/D18: checkout → drop webhook → `GET /api/billing` reconciles the paid intent via the Polar mock + applies **exactly once**; intent → `applied`.
10. `polar_tenant_resolution_atdd_test.go` — AC31/D20 (SEC-6/7 confused-deputy): first `subscription.updated` binds tenant via `billing_checkout_intents` + sets `polar_subscription_id`; a signed event with `metadata.center_id=B` but `polar_subscription_id ∈ A` writes to **A** (or rejects) — NEVER B.

**Wave 3 — Contract + RLS:**
11. `billing_mutation_contract_402_atdd_test.go` — AC22/39/D28 (FU-9-CONTRACT-402): armed-flag drives a REAL 409/402/403 rejection; assert `details` matches the openapi/golden contract — `409 {limit,current,max,canManageBilling}` (typed bool on owner+teacher), `402 {available,required}`, `403 ADDON_NOT_AVAILABLE`; document `max:null` rejection-unreachable.
12. `billing_polar_rls_atdd_test.go` — AC26: cross-tenant READ+WRITE isolation both directions on `invoices` / `subscriptions`(new cols) / `center_resource_baselines` / `billing_checkout_intents`; `polar_webhook_events` documented global/no-RLS (dedup pre-tenant).

### Notes / non-negotiables carried into generation
- Mock seams honored: `internal/polar.MockClient` for the Polar API (real calls BANNED in CI — FU-9-POLAR-CONTRACT); real DB in tx (TEST-BE-1/2); store-interface seam in service unit tests (TEST-BE-4); webhook receiver as integration (TEST-BE-3, real verifier/middleware).
- Every race red needs a rendezvous barrier + a proven-failing no-guard control (D15/Murat).
- Value-scan not key-scan on privacy/idempotency asserts (project memory; GO-5 keeps nulled keys present).
- MockClock for all renewal/reset time-travel — never `time.Sleep` (TEST-BE-5).

Confirmed inputs. Proceeding to generation-mode selection (step-02).

## Step 3 — Test Strategy (AC → level → priority)

Backend levels only: **Unit** (pure logic — HMAC verify, VAT/pack catalog, tier-eligibility branch), **Integration** (real-DB service + tx + RLS + advisory-lock races), **API-Contract** (endpoint envelope/status/details through the real middleware chain). No E2E.

| # | Red file | ACs | Level | Prio | Risk | Harness | Falsification / no-guard control |
|---|----------|-----|-------|------|------|---------|----------------------------------|
| **W1-1** | `polar_webhook_signature_atdd_test.go` | 4,5,23,38 | Unit + Integration | **P0** | R11 (6) | direct verifier + `NewBillingTestServer` | tamper/stale/future/malformed each rejected; **no crash** on missing header |
| **W1-2** | `polar_webhook_dedup_race_atdd_test.go` | 6,34 (D23) | Integration | **P0** | 7 (money) | `SetupRawPool` (2 conns, barrier) | **no-dedup control** → double-mutate; loser tx rolls back (balance/plan/invoice untouched) |
| **W1-3** | `polar_webhook_origin_bypass_atdd_test.go` | 38 (D27) | API-Contract | **P0** | R11 (6) | `NewBillingTestServer` (REAL stack) | asserts 401 not 403 `ORIGIN_NOT_ALLOWED`; oversized body rejected pre-HMAC |
| **W2-4** | `polar_setplanfrompolar_atdd_test.go` | 28 (D17) | Integration | **P0** | 8 (money) | `SetupDB` + MockClock | mid-cycle upgrade must NOT re-zero `monthly_used`; unrelated `subscription.updated` = no-op |
| **W2-5** | `polar_multi_event_idempotency_atdd_test.go` | 30,14 (D19) | Integration | **P0** | 8 (money) | `SetupDB` | `order.paid`+`subscription.updated` for one upgrade → 1 invoice/grant/plan-change (not 2) |
| **W2-6** | `addon_purchase_idempotency_race_atdd_test.go` | 33,24 (D22) | Integration | **P0** | R23 (6) | `SetupRawPool` (2 conns) | **dual control** A(event-dedup off→1) + B(both off→2); assert `addon_remaining` value delta once |
| **W2-7** | `addon_tier_gate_atdd_test.go` | 36,9 (D25) | Integration | **P0** | 6 (money) | `SetupDB` | Free+addon=500 → AI **denied** (not allowed by balance>0); 9-1a credit regression green |
| **W2-8** | `downgrade_no_delete_atdd_test.go` | 25,39,37 (D26/D28) | Integration | **P0** | R24 (6) | `SetupDB` + MockClock | **PK-set snapshot** zero-delete; upgrade cancels pending downgrade; re-upgrade restores |
| **W2-9** | `polar_checkout_reconcile_atdd_test.go` | 29 (D18) | Integration | **P1** | 7 (money) | `SetupDB` + Polar mock | drop webhook → GET /api/billing applies exactly once; 2nd GET = no-op |
| **W2-10** | `polar_tenant_resolution_atdd_test.go` | 31 (D20) | Integration | **P0** | R11 (6, SEC) | `SetupDB` | confused-deputy: metadata.center=B, sub∈A → writes A never B; first-event binds tenant |
| **W3-11** | `billing_mutation_contract_402_atdd_test.go` | 22,39 (D28) | API-Contract | **P1** | 5 (drift) | `NewBillingTestServer` armed | 409{limit,current,max,canManageBilling}/402{available,required}/403 ADDON_NOT_AVAILABLE exact; typed bool both roles |
| **W3-12** | `billing_polar_rls_atdd_test.go` | 26 (D20) | Integration | **P0** | 8 (tenant) | `SetupDB` (deterministic tenant IDs) | cross-tenant R+W both dirs on invoices/subscriptions/baselines/checkout_intents; webhook_events global no-RLS documented |

Helpers file: **`story_9_2a_helpers.go`** (tagged red) — signed-webhook request builder (Standard-Webhooks HMAC over `{id}.{ts}.{body}`), Polar event JSON builders (`order.paid`, `subscription.updated/active`), checkout-intent seeder, pending-downgrade/addon-state extensions to `newBillingCenter`, and the `internal/polar.MockClient` proration/charge canned-response setter.

### Red-phase design confirmation
Every file carries `//go:build atdd_red_phase` and compile-fails against the not-yet-existing green-phase seams, documented in each file's header block:
- `internal/polar` (Client interface, MockClient, NewClient) · `internal/polarwebhook` (Verify, the receiver handler) · `service.SetPlanFromPolar` · `service.PurchaseAddonCheckout` / add-on grant path · `service.AddonNotAvailableError` · the tier-eligibility branch in `CheckAndConsumeCredit` · `billing_checkout_intents` store queries · `InsertAddonPurchaseLedgerRow` · the new migrations (invoices/checkout_intents/baselines/status-widen/polar_webhook_events) · the extended `BillingSummary` fields · `NewBillingTestServer` webhook route + origin bypass.
Verify RED: `cd classlite-api && go test -tags atdd_red_phase ./internal/test/` → **compile failure** (the reds ARE the AC contract). Green: dev removes the tag per seam as it lands.

## Step 4/5 — Generation + RED Verification (COMPLETE)

**12 red-phase test files + 1 helpers file generated** in `classlite-api/internal/test/` (all `//go:build atdd_red_phase`). Substrate-first (Wave 1) authored directly; Waves 2–3 by parallel subagents against the locked helper contract; consolidated + reconciled.

### RED verified ✅
- `go test -tags atdd_red_phase ./internal/test/` → **compile-fails ONLY on documented product seams** (verified via a temporary empty-stub-package pass so all symbol errors surfaced at once; stubs removed). The NON-seam filter (redeclared / syntax / undefined-helper / unused / imported-not-used) returned **empty** → no cross-wave symbol collisions, no test-infra defects.
- **Normal (untagged) build + `go vet ./internal/test/` GREEN** — the reds are excluded from the main suite (tag stripped per-file at green).

### GREEN-PHASE SEAM CONTRACT (the reds ARE the AC contract — implement these to turn green)
| Seam | Kind | Story ref |
|------|------|-----------|
| `internal/polarwebhook.Verify(secret, prev string, h http.Header, body []byte, now time.Time) error` + `ErrSignatureInvalid` / `ErrTimestampStale` | package | AC4/5/23/38 · D2/D27 |
| `handler.NewPolarWebhookHandler(svc, secret, prev string, clk) http.Handler` (verify→dedup→dispatch; body-cap pre-HMAC; origin-bypassed mount) | handler | AC38 · D27 |
| `(*service.BillingService).ProcessPolarEvent(ctx, eventID, eventType string, body []byte) error` (one-tx dedup+dispatch) | service | AC6/14/30/34 · D19/D22/D23 |
| `service.SetPlanFromPolar(ctx, tc, tier plan.Tier, cycle, polarSubID string, periodStart, periodEnd time.Time) error` | service | AC28 · D17 |
| `(*service.BillingService).CreateCheckout(ctx, tc, kind, plan, cycle, addonPackID string) (url string, err error)` | service | AC10/13/29 · D5/D18 |
| `(*service.BillingService).ScheduleDowngrade / CancelDowngrade(ctx, tc, …)` | service | AC15/16/17/37 · D9/D26 |
| `service.AddonNotAvailableError` → 403 `ADDON_NOT_AVAILABLE` | typed err | AC9 · D7 |
| `plan.AddonPackByID(id)` / `plan.AddonPacks()` → `{ID, Credits, PriceVnd, SubtotalVnd, VatVnd, Tiers}` | catalog | AC8 · D7 |
| `internal/polar.Client` + `NewMockClient(polar.MockConfig)` (`MockOrder`/`MockSubscription`), `service.NewBillingServiceWithPolar(db, clk, polarClient)` | package + ctor | AC1/12/29 · D4/D6/D18 |
| store: `InsertAddonPurchaseLedgerRow` (FULL `(ref_purchase_id,reason)` idx) · `billing_checkout_intents` queries · migrations (invoices+UNIQUE polar_order_id, checkout_intents, center_resource_baselines, polar_webhook_events no-RLS, subscriptions pending_* + status-widen) | store/migration | AC1/6/18/26/29 · D8/D10/D11/D18 |
| `NewBillingTestServerWithWrites(...)` (test-infra harness for the armed mutation contract) | test helper | AC22/39 · D28 |

### File → AC → priority (all P0 unless noted)
1. `polar_webhook_signature_atdd_test.go` — AC4/5/23/38 (R11) — 8 sig tests incl. skew boundaries (299/301/future), body-tamper, malformed-no-panic.
2. `polar_webhook_dedup_race_atdd_test.go` — AC6/34 (D23) — two-conn barrier; one-mutation; no-guard control (skip).
3. `polar_webhook_origin_bypass_atdd_test.go` — AC38 (D27) — origin-wall baseline + bypass→401-not-403 + oversized-body pre-HMAC.
4. `polar_setplanfrompolar_atdd_test.go` — AC28 (D17) — mid-cycle preserves monthly_used + adopts annual period; unrelated event no-op.
5. `polar_multi_event_idempotency_atdd_test.go` — AC30/14 (D19) — order.paid+subscription.updated → 1 invoice/grant/plan.
6. `addon_purchase_idempotency_race_atdd_test.go` — AC33/24 (D22) — ledger-first, value-delta once, dual no-guard controls.
7. `addon_tier_gate_atdd_test.go` — AC36/9 (D25) — Free+addon denied; re-upgrade usable; Free purchase→403.
8. `downgrade_no_delete_atdd_test.go` — AC25/37/39 (D26/D28) — PK-set zero-delete; upgrade cancels pending; single-slot.
9. `polar_checkout_reconcile_atdd_test.go` — AC29 (D18, P1) — dropped webhook → GET reconciles once.
10. `polar_tenant_resolution_atdd_test.go` — AC31 (D20) — first-event binds; confused-deputy writes A never B.
11. `billing_mutation_contract_402_atdd_test.go` — AC22/39 (D28, P1) — 409/402/403 details exact; canManageBilling both roles.
12. `billing_polar_rls_atdd_test.go` — AC26 (D20) — cross-tenant R+W on 4 new tables; webhook_events no-RLS documented.

### Handoff → `/bmad-dev-story 9-2a`
The reds are the executable AC contract. Dev implements the seams (substrate first: `internal/polarwebhook` → `internal/polar` → webhook handler → `ProcessPolarEvent` → business paths), removing `//go:build atdd_red_phase` from each file as it goes green, then runs the no-guard controls (dedup/addon races) to prove the guards are load-bearing. Honor the mock seams (Polar mock only — real calls banned in CI, FU-9-POLAR-CONTRACT) and the D15 two-connection harness for races.
