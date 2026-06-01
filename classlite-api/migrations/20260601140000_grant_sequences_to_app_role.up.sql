-- Grant sequence usage to classlite_app for INSERT operations
-- that rely on sequences (e.g., serial columns, if any are added).
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO classlite_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO classlite_app;
