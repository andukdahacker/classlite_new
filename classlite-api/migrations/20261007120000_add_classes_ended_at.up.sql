-- Story 10.2 (Archive) D2 — authoritative "ended" timestamp.
--
-- The archive surfaces classes that ended >= 30 days ago, but `status='ended'`
-- carries no timestamp today: `updated_at` churns on every edit and `end_date`
-- is an unvalidated user-entered date. This additive, nullable column is stamped
-- on the →ended transition (UpdateClassStatus) and genesis-backfilled here for
-- rows that already reached `ended` before this migration.
--
-- Additive + nullable (WF-2): every pre-existing class read/write is unaffected.
-- `ended` is terminal (Story 3.1) so there is no un-stamp path.
ALTER TABLE classes ADD COLUMN ended_at timestamptz;

-- Genesis backfill (7-3a idiom): for each already-ended class, recover the moment
-- it reached `ended` from the latest class.status_changed→ended audit row; fall
-- back to updated_at when no such audit exists (pre-audit or imported rows).
UPDATE classes c
SET ended_at = COALESCE(
    (SELECT max(a.created_at)
     FROM audit_logs a
     WHERE a.entity_id = c.id
       AND a.entity_type = 'class'
       AND a.action = 'class.status_changed'
       AND a.changes -> 'after' ->> 'status' = 'ended'),
    c.updated_at
)
WHERE c.status = 'ended' AND c.ended_at IS NULL;
