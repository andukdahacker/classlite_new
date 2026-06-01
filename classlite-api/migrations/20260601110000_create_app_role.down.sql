-- Reverse: revoke grants and drop application role.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM classlite_app;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM classlite_app;
REVOKE USAGE ON SCHEMA public FROM classlite_app;
REVOKE CONNECT ON DATABASE classlite_dev FROM classlite_app;
DROP ROLE IF EXISTS classlite_app;
