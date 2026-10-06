-- Story 9.1a — billing_service store queries. Two accounting surfaces:
--   subscriptions : one row/center, the plan tier + status + billing period.
--   ai_credits    : one row/center, the mutable credit balance (a typed projection of
--                   the ai_credit_ledger head, D14). available = (allocation-used)+addon.
-- Every credit mutation (consume/refund/lazy-reset) runs under the CENTER-ONLY
-- pg_advisory_xact_lock(hashtext(center), 4) (D13) so a read-then-write on the single
-- center row cannot lost-update. Seat/class/enrolment gates lock resource_class 1/2/3.
-- All statements are RLS-scoped on center_id (tenant tx sets app.current_tenant_id).

-- name: AcquireCenterResourceLock :exec
-- Per-center advisory lock, namespaced by resource_class (D13: seat=1, class=2,
-- enrollment=3, credit=4). Two int4 keys — hashtext(center)::int4 + the class — so two
-- centers only ever collide on a birthday-hash accident (worst case: they serialize;
-- correctness preserved). Tx-scoped: released at commit/rollback.
SELECT pg_advisory_xact_lock(hashtext(@center_id::text), @resource_class::int);

-- name: GetSubscription :one
-- Story 9.2a extends the SELECT list with the pending-downgrade columns (D9/D26) so the
-- generated row stays the full generated.Subscription (a subset SELECT would spawn a
-- distinct row struct and break every SetPlan/read caller). Story 9.3 (D8) appends the
-- grace-tracking columns for the same reason. No behavior change for 9-1a/9-2a readers.
SELECT id, center_id, plan, billing_cycle, status, polar_subscription_id,
       current_period_start, current_period_end, created_at, updated_at,
       pending_plan, pending_billing_cycle, pending_effective_at,
       payment_brand, payment_last4,
       grace_period_start, payment_failed_at, grace_retry_count, grace_last_tick_day
FROM subscriptions
WHERE center_id = @center_id;

-- name: InsertSubscriptionDefault :one
-- Defensive get-or-create half (D26c) + on-center-create (D7). Genesis Free, no Polar,
-- no billing period, no pending change. Idempotent via UNIQUE(center_id).
INSERT INTO subscriptions
    (id, center_id, plan, billing_cycle, status, polar_subscription_id,
     current_period_start, current_period_end)
VALUES
    (gen_random_uuid(), @center_id, 'free', 'monthly', 'active', NULL, now(), NULL)
ON CONFLICT (center_id) DO NOTHING
RETURNING id, center_id, plan, billing_cycle, status, polar_subscription_id,
          current_period_start, current_period_end, created_at, updated_at,
          pending_plan, pending_billing_cycle, pending_effective_at,
          payment_brand, payment_last4,
          grace_period_start, payment_failed_at, grace_retry_count, grace_last_tick_day;

-- name: SetPlan :exec
-- Override seam (D19) + the 9.2 plan-change write path. Callers pair this with
-- UpdateCenterStorageLimit in the SAME tx (D21). status/cycle/periods are explicit so a
-- Free→paid change writes a real period.
UPDATE subscriptions
SET plan = @plan,
    billing_cycle = @billing_cycle,
    status = @status,
    current_period_start = @current_period_start,
    current_period_end = @current_period_end,
    updated_at = now()
WHERE center_id = @center_id;

-- name: UpdateCenterStorageLimit :exec
-- D21 — the per-center storage ceiling is written FROM the plan (supersedes 4.4a's
-- static value). centers has no RLS, so this is scoped by explicit id.
UPDATE centers SET storage_limit_bytes = @storage_limit_bytes WHERE id = @id;

-- name: GetAICredits :one
SELECT id, center_id, monthly_allocation, monthly_used, addon_remaining, reset_at,
       created_at, updated_at
FROM ai_credits
WHERE center_id = @center_id;

-- name: InsertAICreditsDefault :one
-- Defensive get-or-create half (D26c) + on-center-create (D7). Genesis 0/0/0 with a
-- non-null reset_at (D26a — start of next month VN-local, computed by the caller).
INSERT INTO ai_credits
    (id, center_id, monthly_allocation, monthly_used, addon_remaining, reset_at)
VALUES
    (gen_random_uuid(), @center_id, @monthly_allocation, 0, 0, @reset_at)
ON CONFLICT (center_id) DO NOTHING
RETURNING id, center_id, monthly_allocation, monthly_used, addon_remaining, reset_at,
          created_at, updated_at;

-- name: UpdateAICreditsBuckets :exec
-- The single mutation for consume/refund/lazy-reset — always under the (center,4) lock.
UPDATE ai_credits
SET monthly_allocation = @monthly_allocation,
    monthly_used = @monthly_used,
    addon_remaining = @addon_remaining,
    reset_at = @reset_at,
    updated_at = now()
WHERE center_id = @center_id;

-- name: GetLatestLedgerBalanceAfter :one
-- The projection head (D14): the newest ledger row's balance_after, which ai_credits
-- .available must equal. Caller treats pgx.ErrNoRows as balance 0 (empty ledger).
SELECT balance_after
FROM ai_credit_ledger
WHERE center_id = @center_id
ORDER BY created_at DESC, id DESC
LIMIT 1;

-- name: GetJobDeductionRow :one
-- Refund (D17) reads the deduction it reverses: its period_end decides monthly-vs-addon,
-- its user_id attributes the reversal to whoever was charged (so the worker refund path
-- needs no enqueuing-user context — code-review 2026-09-29 F1), and its existence gates
-- the refund (a never-deducted job is a no-op). Center-scoped.
SELECT balance_after, period_end, user_id
FROM ai_credit_ledger
WHERE center_id = @center_id AND ref_job_id = @ref_job_id AND reason = 'job_deduction';

-- name: InsertCreditLedgerRow :execrows
-- The center-scoped credit ledger append (9-1a writes its own rows; balance_after is the
-- CENTER available, not the 4.3a per-(center,user) sum). Idempotent on (ref_job_id,
-- reason) — a double consume/refund for one job collapses to one row. Returns rows
-- affected so refund can apply the ai_credits mutation ONLY when the row actually
-- landed (D17 ledger-insert-first ordering). period_end marks the monthly period for a
-- monthly-bucket deduction (NULL otherwise).
--
-- created_at is clock_timestamp() (NOT the now() default): now() is tx-constant, so the
-- grant + deduction rows a single consume writes would share a timestamp and the
-- ledger-head read (ORDER BY created_at DESC, id DESC) would tie-break on a random uuid
-- — non-deterministically returning the wrong balance_after (D14). clock_timestamp
-- advances within the tx, giving a stable insertion order.
INSERT INTO ai_credit_ledger
    (id, center_id, user_id, change, reason, ref_job_id, balance_after, period_end, created_at)
VALUES
    (gen_random_uuid(), @center_id, @user_id, @change, @reason, @ref_job_id,
     @balance_after, @period_end, clock_timestamp())
ON CONFLICT (ref_job_id, reason) DO NOTHING;

-- name: CountTeacherSeats :one
-- Teacher-seat consumption (AC7): active (archived_at IS NULL) staff members PLUS live
-- (unaccepted, unexpired) teacher-role invites. A pending invite RESERVES a seat, so N
-- outstanding invites to distinct emails cannot all accept past the cap (code-review
-- 2026-09-29 F7 — the gate ran only at invite-creation counting accepted members). owner,
-- admin AND teacher all consume a seat; students never do. A re-invite of an existing
-- member is a rare double-count that only makes the gate MORE conservative (fail-closed,
-- never overshoot). Live COUNT under the (center,1) lock — never a stored counter (D20).
SELECT (
    (SELECT count(*)
       FROM center_members cm
      WHERE cm.center_id = @center_id
        AND cm.archived_at IS NULL
        AND cm.role IN ('owner', 'admin', 'teacher'))
    +
    (SELECT count(*)
       FROM invites iv
      WHERE iv.center_id = @center_id
        AND iv.accepted_at IS NULL
        AND iv.expires_at > now()
        AND iv.role IN ('owner', 'admin', 'teacher'))
)::bigint AS seats;

-- name: CountCenterClasses :one
-- Class-limit consumption (AC8): live classes (not ended) in the center. Live COUNT
-- under the (center,2) lock.
SELECT count(*)
FROM classes
WHERE center_id = @center_id
  AND status <> 'ended';

-- name: CountActiveEnrollmentsInClass :one
-- Students-per-class consumption (AC9): active enrollments in one class. Live COUNT
-- under the (center,3) lock. Explicit center_id predicate (defense-in-depth, alongside
-- the tenant-tx RLS) — consistent with the teacher/class sibling counts (code-review
-- 2026-09-29 F10).
SELECT count(*)
FROM enrollments
WHERE center_id = @center_id
  AND class_id = @class_id
  AND status = 'active';

-- name: CountCenterTeacherSeats :one
-- Story 9.3 (C8a) — teacher-ROLE members only (NOT owner/admin), for the grace-downgrade
-- read-only seat lock. Distinct from CountTeacherSeats (which counts owner+admin+teacher +
-- live invites for the 9-1a ADD gate): R3's read-only lock keys off "the 2nd+ teacher seat"
-- — a Free center with more teacher members than the Free teacher cap locks seat management
-- (read-only) until it trims or re-upgrades. Live COUNT, RLS tenant-scoped.
SELECT count(*)
FROM center_members
WHERE center_id = @center_id
  AND archived_at IS NULL
  AND role = 'teacher';

-- Story 9.3 — grace-period state machine mutators (D8). All RLS tenant-scoped on
-- center_id; the webhook enter/recovery paths run under the dispatch tenant tx (SEC-6),
-- the grace tick under the worker's re-established tenant context.

-- name: SetPastDueWithGrace :exec
-- AC1 — enter grace on a Polar payment-failure event: flip to past_due and START the
-- 7-day clock (grace_period_start = clk.Now(), payment_failed_at = clk.Now()). Resets the
-- retry counter + the per-day high-water marker so a fresh clock begins at day -1. The
-- caller guards against a re-entry (already past_due) so this never restarts a live clock
-- (AC2 target-state idempotency).
UPDATE subscriptions
SET status = 'past_due',
    grace_period_start = @grace_period_start,
    payment_failed_at = @payment_failed_at,
    grace_retry_count = 0,
    grace_last_tick_day = -1,
    updated_at = now()
WHERE center_id = @center_id;

-- name: ClearGrace :exec
-- AC9 recovery — a payment recovered within the window: return to active and NULL the
-- grace-tracking columns (the clock stops). Status-based (the caller detects past_due),
-- independent of the genuine plan-change gate (BLOCKER-1). The plan/period are untouched
-- (recovery keeps the current paid plan); pending grace ticks are cancelled separately.
UPDATE subscriptions
SET status = 'active',
    grace_period_start = NULL,
    payment_failed_at = NULL,
    grace_retry_count = 0,
    grace_last_tick_day = -1,
    updated_at = now()
WHERE center_id = @center_id;

-- name: ExpireGraceToFree :exec
-- AC6 day-7 auto-downgrade: flip plan→free + status→cancelled and NULL the grace columns.
-- A DISTINCT write from setPlanFromPolarTx (which hardcodes status='active' + 422s on an
-- empty cycle — review M1): the service pairs this with the discrete zero-deletion helpers
-- (CaptureResourceBaselines high-water, storage re-point to the Free ceiling, credit cap)
-- so NOT ONE content row is deleted (R24). billing_cycle/period are left as-is (a cancelled
-- Free center has no live period meaning; the next re-upgrade rewrites them).
-- Code-review P4 (2026-10-06): also CLEAR any scheduled-downgrade columns — a center that had
-- a pending downgrade queued when it entered grace would otherwise show a phantom "downgrade
-- scheduled to free" in the owner summary (GetUsageAndLimits derives pendingDowngrade from
-- pending_plan) on an already-free/cancelled center until a later re-upgrade clears them.
UPDATE subscriptions
SET plan = 'free',
    status = 'cancelled',
    grace_period_start = NULL,
    payment_failed_at = NULL,
    grace_retry_count = 0,
    grace_last_tick_day = -1,
    pending_plan = NULL,
    pending_billing_cycle = NULL,
    pending_effective_at = NULL,
    updated_at = now()
WHERE center_id = @center_id;

-- name: IncrementGraceRetry :exec
-- AC4 — record one Polar re-collect request (days 3 & 5). Provider-agnostic counter: it
-- increments whether Polar exposes a manual re-collect call or auto-retries (D2). Gated by
-- the per-day marker in the service so a re-run tick never double-increments.
UPDATE subscriptions
SET grace_retry_count = grace_retry_count + 1,
    updated_at = now()
WHERE center_id = @center_id;

-- name: InsertDeclinedInvoice :execrows
-- AC14/AC15 (R2, code-review D3 2026-10-06) — snapshot the FAILED subscription charge as a
-- 'declined' invoice when the center enters grace, so the s70 history + the declined-only Retry
-- action render a real row (previously the declined/refunded pills were dead — no producer).
-- id + polar_order_id are derived from the failed-charge id (D8 linkage); UNIQUE(polar_order_id)
-- + ON CONFLICT DO NOTHING dedups a re-delivered payment-failure event. Amount is snapshotted
-- VERBATIM from the Polar failure payload (D25 — never the plan catalog); 0 when Polar omits it.
INSERT INTO invoices
    (id, center_id, polar_invoice_id, polar_order_id, kind, amount_vnd, subtotal_vnd,
     vat_vnd, currency, status, description, issued_at)
VALUES
    (@id, @center_id, NULL, @polar_order_id, 'subscription', @amount_vnd, NULL,
     NULL, @currency, 'declined', NULL, @issued_at)
ON CONFLICT (polar_order_id) DO NOTHING;

-- name: MarkLatestDeclinedInvoicePaid :execrows
-- AC9 (R2, code-review D3 2026-10-06) — on recovery WITHIN the grace window, transition the
-- center's most-recent 'declined' invoice → 'paid' (the retry charge succeeded). Scoped to the
-- newest declined row so a later distinct failure's declined row is untouched; a no-op (0 rows)
-- when no declined row exists (recovery of a center whose failure predated the producer, or a
-- recovery driven by a fresh order.paid that already wrote its own paid row). RLS-scoped — relies
-- on the invoices_update policy added in 20261006120000 (invoices were append-only before 9.3).
UPDATE invoices
SET status = 'paid',
    updated_at = now()
WHERE id = (
    SELECT i.id FROM invoices i
    WHERE i.center_id = @center_id AND i.status = 'declined'
    ORDER BY i.issued_at DESC NULLS LAST, i.id DESC
    LIMIT 1
);

-- name: AdvanceGraceTickDay :exec
-- AC5 — advance the per-day high-water marker to the elapsed day a tick just acted on.
-- Written in the SAME service tx as the day's effect so a re-run of that day (elapsedDay
-- <= grace_last_tick_day) is a pure no-op — fixes the days-0/6 double-send (BLOCKER-4).
UPDATE subscriptions
SET grace_last_tick_day = @grace_last_tick_day,
    updated_at = now()
WHERE center_id = @center_id;
