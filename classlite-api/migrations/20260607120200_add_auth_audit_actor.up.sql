-- Migration: add actor_user_id to auth_audit_logs
-- Story 1.6 — `user_id` describes the SUBJECT of an auth event (whose
-- sessions were revoked, whose role changed). `actor_user_id` describes
-- WHO triggered it. For self-initiated events (registration, password
-- reset) actor and subject coincide and actor stays NULL (logical
-- equivalent of "self"). For force-logout the actor is the Owner who
-- clicked the button; the subject is the staff member they revoked.
--
-- Added now (Story 1.6) so future event types (staff.role_changed,
-- enrollment.transferred, billing.plan_changed) don't need a retrofit.

ALTER TABLE auth_audit_logs ADD COLUMN actor_user_id uuid;

CREATE INDEX idx_auth_audit_logs_actor_user_id
    ON auth_audit_logs (actor_user_id) WHERE actor_user_id IS NOT NULL;
