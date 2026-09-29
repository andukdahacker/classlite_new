-- Reverse 20260929120200_backfill_free_subscriptions. The genesis rows are dropped
-- with their tables by the two preceding create migrations' down steps; there is no
-- clean per-row reversal (a center may have legitimately changed plan by rollback
-- time). Data-only backfills are conventionally no-op-on-down here — the table DROPs
-- own the teardown. Left intentionally empty (WF-2: never edit an applied migration).
SELECT 1;
