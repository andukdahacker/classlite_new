-- Migration: create_invoices
-- Story 9.2a (AC18/D10/D25) — a charge-snapshot row written at charge time. Because
-- every charge now flows through the 9-2a webhook receiver (`order.paid`), the write
-- belongs here; the s70 invoice-history read/export UI is 9.3.
--
-- MONEY BOUNDARY (D25): each row SNAPSHOTS its own amount/subtotal/vat/currency from
-- the Polar charge — it NEVER re-reads the internal/plan catalog. Polar is the amount
-- authority. Money is integer VND. subtotal_vnd/vat_vnd are nullable (a proration or
-- add-on charge may or may not carry a Polar-provided split; when present it is the
-- Polar value verbatim, D6/D28b).
--
-- IDEMPOTENCY (D19): UNIQUE(polar_order_id) + the app-side `ON CONFLICT DO NOTHING`
-- makes a re-delivered `order.paid` snapshot exactly one invoice. NULLs are distinct,
-- so a row without an order id (defensive) never collides.
--
-- kind is nullable with a CHECK admitting only the two known kinds — a NULL passes the
-- CHECK (unknown), so a bare RLS-isolation insert need not carry it; every real write
-- sets it. Same RLS shape as subscriptions/ai_credits (append-oriented: SELECT+INSERT
-- policies only — no UPDATE policy, invoices are effectively immutable).

CREATE TABLE invoices (
    id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    center_id        uuid        NOT NULL REFERENCES centers (id) ON DELETE CASCADE,
    polar_invoice_id text,
    polar_order_id   text,
    kind             text        CHECK (kind IN ('subscription', 'addon')),
    amount_vnd       integer     NOT NULL,
    subtotal_vnd     integer,
    vat_vnd          integer,
    currency         text        NOT NULL DEFAULT 'VND',
    status           text        NOT NULL,
    description      text,
    issued_at        timestamptz,
    created_at       timestamptz NOT NULL DEFAULT now()
);

-- D19 charge-snapshot idempotency key (NULLs distinct — a null order never collides).
CREATE UNIQUE INDEX uq_invoices_polar_order_id ON invoices (polar_order_id);

-- Read path: a center's invoices newest-first (the "next invoice" projection + 9.3 history).
CREATE INDEX idx_invoices_center_issued
    ON invoices (center_id, issued_at DESC);

ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices FORCE ROW LEVEL SECURITY;

CREATE POLICY invoices_select ON invoices
    FOR SELECT
    USING (center_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
CREATE POLICY invoices_insert ON invoices
    FOR INSERT
    WITH CHECK (center_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
