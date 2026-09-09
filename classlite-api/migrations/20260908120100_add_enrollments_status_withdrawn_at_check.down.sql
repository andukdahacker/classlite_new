-- Down: drop the status↔withdrawn_at coupling CHECK.
ALTER TABLE enrollments DROP CONSTRAINT IF EXISTS enrollments_status_withdrawal_coupled;
