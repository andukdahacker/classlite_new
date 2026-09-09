-- Migration: add_enrollments_status_withdrawn_at_check
-- Story 7.3a (AC9 · CR-3-4-5-1) — couple enrollments.status to withdrawn_at.
-- Story 3.4.5 shipped enrollments with only status='active'/withdrawn_at NULL, so
-- the coupling was unreachable there and deferred to 7.3, which introduces the
-- withdraw/transfer transitions that make a terminal status possible. Without this
-- CHECK a `withdrawn` row with NULL withdrawn_at (or an `active` row with a stray
-- timestamp) would be a silent integrity hole in the audit spine.
--
-- NEW migration pair — never edit 20260722120000 (WF-2). Existing rows (all
-- active, withdrawn_at NULL) satisfy it, so a plain ADD CONSTRAINT is safe.

ALTER TABLE enrollments
    ADD CONSTRAINT enrollments_status_withdrawal_coupled
    CHECK (
        (status = 'active' AND withdrawn_at IS NULL)
        OR (status IN ('withdrawn', 'transferred') AND withdrawn_at IS NOT NULL)
    );
