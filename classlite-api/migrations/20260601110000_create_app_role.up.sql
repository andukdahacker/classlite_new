-- Migration: create_app_role
-- Creates a non-superuser application role for RLS enforcement.
-- Superusers bypass RLS even with FORCE ROW LEVEL SECURITY,
-- so the application must connect as a non-superuser role.

DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'classlite_app') THEN
        CREATE ROLE classlite_app LOGIN PASSWORD 'classlite_dev_password' NOSUPERUSER;
    END IF;
END
$$;

GRANT CONNECT ON DATABASE classlite_dev TO classlite_app;
GRANT USAGE ON SCHEMA public TO classlite_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO classlite_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO classlite_app;
