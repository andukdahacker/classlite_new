-- Migration: alter_invoices_declined_updatable
-- Story 9.3 code-review D3 (2026-10-06, Ducdo "patch now") — R2 requires that a payment
-- failure WRITE a 'declined' invoice row and that recovery WITHIN the grace window transition
-- that row 'declined' → 'paid'. The 9-2a invoices table was deliberately append-only (SELECT +
-- INSERT policies only; "effectively immutable"). R2 (authoritative v0.2) overrides that for the
-- single declined→paid transition: add an updated_at column + a tenant-scoped UPDATE policy so
-- MarkLatestDeclinedInvoicePaid can run under RLS. Zero data is deleted (R24 holds); this only
-- flips a status on the caller's own row.

ALTER TABLE invoices ADD COLUMN updated_at timestamptz;

-- Tenant-scoped UPDATE policy — same center-match shape as invoices_select/invoices_insert.
-- The app only ever flips a declined row to paid (MarkLatestDeclinedInvoicePaid); RLS guarantees
-- a center can never touch another tenant's invoice (USING + WITH CHECK both pin center_id).
CREATE POLICY invoices_update ON invoices
    FOR UPDATE
    USING (center_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
    WITH CHECK (center_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
