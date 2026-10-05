-- Story 9.2a — Polar integration store queries (webhook dedup, invoices snapshot, add-on
-- ledger idempotency, Polar-driven plan apply, checkout-intent reconcile, grandfather
-- baselines, owner attribution). All tenant-scoped statements run inside the webhook
-- receiver's tenant tx (SET LOCAL app.current_tenant_id, SEC-6) or the owner's request tx;
-- polar_webhook_events is the ONE deliberately global (no-RLS) table (D12).

-- name: InsertWebhookEvent :execrows
-- The D23 outer dedup: the polar_webhook_events PK serializes two concurrent same-event_id
-- deliveries. ON CONFLICT DO NOTHING + the rows-affected return lets the receiver run the
-- INSERT and the dispatch in ONE tx — rows==0 means a duplicate (whole dispatch is skipped,
-- zero mutation). No RLS on this table (dedup is pre-tenant, global).
INSERT INTO polar_webhook_events (event_id, event_type, payload_hash)
VALUES (@event_id, @event_type, @payload_hash)
ON CONFLICT (event_id) DO NOTHING;

-- name: InsertInvoice :execrows
-- D10/D19 charge snapshot. UNIQUE(polar_order_id) + ON CONFLICT DO NOTHING makes a
-- re-delivered order.paid snapshot exactly one invoice. SNAPSHOTS its own amount/subtotal/
-- vat/currency from the Polar charge (D25 — never re-read from the plan catalog). `id` is
-- caller-supplied so it can equal the add-on ledger row's ref_purchase_id (D8 linkage).
INSERT INTO invoices
    (id, center_id, polar_invoice_id, polar_order_id, kind, amount_vnd, subtotal_vnd,
     vat_vnd, currency, status, description, issued_at)
VALUES
    (@id, @center_id, @polar_invoice_id, @polar_order_id, @kind, @amount_vnd, @subtotal_vnd,
     @vat_vnd, @currency, @status, @description, @issued_at)
ON CONFLICT (polar_order_id) DO NOTHING;

-- name: GetLatestInvoice :one
-- The single "next invoice" projection input for the extended GET /api/billing (D-DASH).
-- The service pairs the newest snapshot with the subscription period for display. Newest
-- first; caller treats pgx.ErrNoRows as "no invoice yet".
SELECT id, center_id, polar_invoice_id, polar_order_id, kind, amount_vnd, subtotal_vnd,
       vat_vnd, currency, status, description, issued_at, created_at
FROM invoices
WHERE center_id = @center_id
ORDER BY issued_at DESC NULLS LAST, created_at DESC
LIMIT 1;

-- name: InsertAddonPurchaseLedgerRow :execrows
-- D22 (Murat) — the add-on grant idempotency guard, SEPARATE from the 9-1a
-- InsertCreditLedgerRow (whose ON CONFLICT (ref_job_id, reason) NEVER fires for an addon row
-- with a NULL ref_job_id). Ledger-FIRST: the receiver inserts this, checks rows-affected, and
-- touches addon_remaining + invoices ONLY if a row landed — so a bypassed-dedup replay is a
-- balance no-op. ON CONFLICT (ref_purchase_id, reason) infers the FULL unique index. change is
-- +credits; balance_after is the new center available (D14 chain). clock_timestamp() (not the
-- tx-constant now()) keeps a stable ledger insertion order like InsertCreditLedgerRow.
INSERT INTO ai_credit_ledger
    (id, center_id, user_id, change, reason, ref_job_id, ref_purchase_id, balance_after, created_at)
VALUES
    (gen_random_uuid(), @center_id, @user_id, @change, 'addon_purchase', NULL,
     @ref_purchase_id, @balance_after, clock_timestamp())
ON CONFLICT (ref_purchase_id, reason) DO NOTHING;

-- name: GetCenterOwnerUserID :one
-- D24 — webhook-written ledger rows attribute to the center OWNER (the webhook re-establishes
-- CENTER context with no user; ai_credit_ledger.user_id is NOT NULL). Runs under the tenant tx
-- (center_members is RLS-scoped). A center with no owner is a handled typed error, not a
-- uuid.Nil FK-violation 500 retry loop.
SELECT user_id
FROM center_members
WHERE center_id = @center_id AND role = 'owner' AND archived_at IS NULL
ORDER BY created_at
LIMIT 1;

-- name: UpdateSubscriptionFromPolar :exec
-- D17 — the Polar-driven plan apply (SEPARATE from the genesis/override SetPlan). Writes the
-- period bounds FROM the Polar payload (honors annual), persists polar_subscription_id, and
-- CLEARS any pending downgrade (D26 — an intervening upgrade cancels a scheduled downgrade so
-- it never fires at renewal; a renewal apply clears the pending it just applied). Called only
-- on a genuine plan-change/period-rollover (the service gates the credit grant separately).
UPDATE subscriptions
SET plan = @plan,
    billing_cycle = @billing_cycle,
    status = @status,
    polar_subscription_id = @polar_subscription_id,
    current_period_start = @current_period_start,
    current_period_end = @current_period_end,
    pending_plan = NULL,
    pending_billing_cycle = NULL,
    pending_effective_at = NULL,
    updated_at = now()
WHERE center_id = @center_id;

-- name: SetSubscriptionPaymentMethod :exec
-- Story 9.2b (Task 11, AC12) — persist the Polar card-on-file ({brand, last4}, the MASKED
-- descriptor — never raw card data, epic:127-130). SEPARATE from UpdateSubscriptionFromPolar
-- because a payment-method edit arrives as a NON-genuine subscription.updated (same
-- plan/cycle/period → the D17 no-op branch); the caller runs this on BOTH the genuine and
-- no-op paths whenever the payload carries a card. RLS tenant-scoped (webhook tenant tx, SEC-6).
UPDATE subscriptions
SET payment_brand = @payment_brand,
    payment_last4 = @payment_last4,
    updated_at = now()
WHERE center_id = @center_id;

-- name: SetPolarSubscriptionID :exec
-- D20 first-event binding on an otherwise no-op subscription.updated: record the Polar
-- subscription id if not yet bound, without touching plan/period/credits. Idempotent (only
-- binds when currently NULL — a later confused-deputy event can never rebind it).
UPDATE subscriptions
SET polar_subscription_id = @polar_subscription_id,
    updated_at = now()
WHERE center_id = @center_id AND polar_subscription_id IS NULL;

-- name: SetPendingDowngrade :exec
-- D9/D26 — record the SINGLE pending downgrade intent (a second schedule REPLACES the first).
-- The current plan/limits stay active until pending_effective_at (= current_period_end).
UPDATE subscriptions
SET pending_plan = @pending_plan,
    pending_billing_cycle = @pending_billing_cycle,
    pending_effective_at = @pending_effective_at,
    updated_at = now()
WHERE center_id = @center_id;

-- name: ClearPendingDowngrade :exec
-- D9 — cancel a scheduled downgrade before renewal (POST /api/billing/downgrade/cancel).
UPDATE subscriptions
SET pending_plan = NULL,
    pending_billing_cycle = NULL,
    pending_effective_at = NULL,
    updated_at = now()
WHERE center_id = @center_id;

-- name: InsertCheckoutIntent :one
-- D18 — persist the pending checkout BEFORE returning the hosted URL, so a lost webhook is
-- recoverable (reconcile on GET /api/billing) and the first subscription event can resolve
-- the tenant via polar_checkout_id (D20). RLS tenant-scoped.
INSERT INTO billing_checkout_intents
    (id, center_id, kind, target_plan, target_billing_cycle, addon_pack_id, polar_checkout_id, status)
VALUES
    (gen_random_uuid(), @center_id, @kind, @target_plan, @target_billing_cycle,
     @addon_pack_id, @polar_checkout_id, 'pending')
RETURNING id;

-- name: PolarCenterBySubscriptionID :one
-- D20/SEC-6 — pre-tenant tenant resolution for the webhook receiver. Wraps the SECURITY
-- DEFINER polar_center_by_subscription_id() so a signed subscription.updated whose data.id is
-- a persisted polar_subscription_id resolves its center ACROSS the FORCE-RLS subscriptions
-- table (the receiver runs before any tenant GUC). Returns a NULL uuid when the id is not yet
-- bound (the first-ever event for a new subscription → the receiver falls back to metadata).
SELECT polar_center_by_subscription_id(@polar_sub_id::text) AS center_id;

-- name: PolarCenterByCheckoutID :one
-- D20/SEC-6 (code-review D-3) — the FIRST-EVENT tenant-resolution anchor. Wraps the SECURITY
-- DEFINER polar_center_by_checkout_id() so the first-ever subscription.updated for a new
-- subscription (no polar_subscription_id bound yet) resolves its center from the checkout WE
-- planted at create time, across the FORCE-RLS billing_checkout_intents table (the receiver runs
-- before any tenant GUC). Returns a NULL uuid when the checkout id is unknown (→ the receiver
-- falls back to the signed metadata.center_id).
SELECT polar_center_by_checkout_id(@polar_checkout_id::text) AS center_id;

-- name: ListPendingCheckoutIntents :many
-- D18 reconcile scan: a center's pending checkout intents. RLS tenant-scoped — a center only
-- ever reconciles its own intents. (No time-throttle predicate: the apply is idempotent via
-- MarkCheckoutIntentApplied + the invoice UNIQUE + target-state plan-apply, so reconciling on
-- every GET is safe; a ≈60s poll-throttle is a documented future perf refinement, not
-- correctness — and a mock-clock test drives it immediately.)
SELECT id, kind, target_plan, target_billing_cycle, addon_pack_id, polar_checkout_id, created_at
FROM billing_checkout_intents
WHERE center_id = @center_id AND status = 'pending'
ORDER BY created_at;

-- name: MarkCheckoutIntentApplied :exec
-- D18/D19 — close a reconciled (or webhook-applied) intent so a second GET is a pure no-op.
UPDATE billing_checkout_intents
SET status = 'applied', updated_at = now()
WHERE id = @id AND center_id = @center_id;

-- name: InsertResourceBaseline :exec
-- D13 (FU-9-1-GRANDFATHER) — one-time high-water capture at arming. ON CONFLICT DO NOTHING:
-- the baseline is frozen at the first capture (never lowered by a later re-arm). RLS-scoped.
INSERT INTO center_resource_baselines (center_id, resource_class, high_water_count, captured_at)
VALUES (@center_id, @resource_class, @high_water_count, now())
ON CONFLICT (center_id, resource_class) DO NOTHING;

-- name: GetResourceBaseline :one
-- D13 — the frozen high-water ceiling for max(planMax, baseline) in the Check* gates. Caller
-- treats pgx.ErrNoRows as "no baseline" (unarmed center → plain planMax gate). RLS-scoped.
SELECT high_water_count
FROM center_resource_baselines
WHERE center_id = @center_id AND resource_class = @resource_class;
