-- Migration: create_polar_webhook_events
-- Story 9.2a (AC6/D2/D23) — the GLOBAL webhook-delivery dedup table. Polar's
-- `webhook-id` (the Standard-Webhooks event id) is the PRIMARY KEY: a duplicate
-- delivery collides on the PK and the whole dispatch tx rolls back → zero double
-- mutation (D23). The INSERT + the state mutation run in ONE tx on ONE connection
-- so two concurrent same-event_id deliveries serialize on the PK.
--
-- NO RLS BY DESIGN (D12/SEC-6, epic:208): dedup runs BEFORE the tenant is resolved
-- (a webhook authenticates by signature, not a tenant GUC), so this table carries
-- no center_id and is deliberately global. A cross-tenant "leak" here is meaningless
-- — the row records only that an opaque event id was seen (payload_hash is a
-- forensic/spoof-detection fingerprint, never the raw body).

CREATE TABLE polar_webhook_events (
    event_id     text        PRIMARY KEY,
    event_type   text        NOT NULL,
    payload_hash text,
    received_at  timestamptz NOT NULL DEFAULT now()
);

-- Read path: purge/forensics by arrival time (a retention sweep is a later story).
CREATE INDEX idx_polar_webhook_events_received_at
    ON polar_webhook_events (received_at);
