-- Reverse 20261006120000_alter_invoices_declined_updatable.
DROP POLICY IF EXISTS invoices_update ON invoices;
ALTER TABLE invoices DROP COLUMN IF EXISTS updated_at;
