-- Reverse: revoke the portable CONNECT grant applied to the current database.
-- The role itself is dropped by 20260601110000's down migration; this pair only
-- added the current_database() CONNECT grant, so it only revokes that.
--
-- EXCEPT on classlite_dev: 20260601110000 (immutable) ALSO granted CONNECT on
-- classlite_dev. CONNECT is not reference-counted, so an unconditional revoke here
-- would strip a grant 20260601110000 still intends, leaving classlite_app unable
-- to connect to classlite_dev after a partial `migrate down` to a version between
-- the two. Skip classlite_dev so this down reverses ONLY the grant it owns.

DO $$
BEGIN
    IF current_database() <> 'classlite_dev' THEN
        EXECUTE format('REVOKE CONNECT ON DATABASE %I FROM classlite_app', current_database());
    END IF;
END
$$;
