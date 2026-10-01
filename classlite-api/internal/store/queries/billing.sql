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
-- distinct row struct and break every SetPlan/read caller). No behavior change for 9-1a.
SELECT id, center_id, plan, billing_cycle, status, polar_subscription_id,
       current_period_start, current_period_end, created_at, updated_at,
       pending_plan, pending_billing_cycle, pending_effective_at
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
          pending_plan, pending_billing_cycle, pending_effective_at;

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
