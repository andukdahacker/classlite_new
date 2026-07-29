-- Reverse 20260728140000_create_job_dispatch_functions.
DROP FUNCTION IF EXISTS next_ready_job_center(timestamptz);
DROP FUNCTION IF EXISTS stuck_job_centers(timestamptz);
