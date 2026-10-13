-- Migration: grant_connect_current_database (Story 11-1a / AC6 / DD16)
-- Make classlite_app's CONNECT grant portable across databases.
--
-- The immutable 20260601110000_create_app_role hardcoded
--   GRANT CONNECT ON DATABASE classlite_dev TO classlite_app
-- which is useless for a fresh classlite_test (the test-DB lifecycle, DD16).
-- An applied migration can never be edited (WF-2), so this NEW pair grants
-- CONNECT on whatever database the chain is being applied to, via
-- current_database(), so it is portable to classlite_test, classlite_dev, and
-- prod alike.
--
-- CREATE ROLE is cluster-global, so the IF NOT EXISTS guard lets the chain
-- replay against a second database (DD16d) without colliding on the role that
-- 20260601110000 already created. In the normal case the role already exists and
-- this block is a no-op. The fallback CREATE ROLE fires ONLY on a cluster where
-- the role is absent (e.g. a brand-new CI cluster that has not run 20260601110000
-- against any database yet); it deliberately mirrors 20260601110000's definition,
-- including the same committed dev password literal, so the role's shape is
-- identical no matter which migration minted it. (This literal is a dev/test
-- credential only — prod sets the role password out of band; see manual-setup.md.)

DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'classlite_app') THEN
        CREATE ROLE classlite_app LOGIN PASSWORD 'classlite_dev_password' NOSUPERUSER;
    END IF;
END
$$;

DO $$
BEGIN
    EXECUTE format('GRANT CONNECT ON DATABASE %I TO classlite_app', current_database());
END
$$;
