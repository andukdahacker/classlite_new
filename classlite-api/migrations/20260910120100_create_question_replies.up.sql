-- Migration: create_question_replies
-- Story 7.4a — a teacher's reply to a question. visibility governs who reads it:
--   'shared'   → the whole class (teacher of the class, the asker, and every
--                student CURRENTLY actively enrolled in the question's class);
--   'personal' → only the asking student + the replying teacher (author).
-- The read scoping lives in the ListRepliesForReader query, not RLS (RLS only
-- isolates tenants). UX labels map "Private"→personal, "Shared with your
-- class"→shared (D5).
--
-- No UPDATE/DELETE endpoint ships in v1 (reply edit/delete deferred, FU-7-4-C) —
-- replies are effectively append-only from the API surface, but this is enforced
-- by ABSENCE of an endpoint, NOT the audit_logs REVOKE lock. This is still a
-- mutable domain table (standard 4-policy FORCE-RLS grid), leaving room for the
-- deferred edit path without a schema change.
--
-- center_id is denormalized onto the reply row (NOT derived via the question FK
-- join) so the RLS predicate is a direct column comparison — same idiom as every
-- other tenant-scoped table.
--
-- FK policy:
--   center_id   → centers   ON DELETE CASCADE.
--   question_id → questions ON DELETE RESTRICT (a thread cannot be purged out
--                 from under its replies).
--   author_id   → users     ON DELETE RESTRICT.

CREATE TABLE question_replies (
    id          uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    center_id   uuid          NOT NULL REFERENCES centers (id) ON DELETE CASCADE,
    question_id uuid          NOT NULL REFERENCES questions (id) ON DELETE RESTRICT,
    author_id   uuid          NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    content     text          NOT NULL,
    visibility  text          NOT NULL CHECK (visibility IN ('personal','shared')),
    created_at  timestamptz   NOT NULL DEFAULT now()
);

-- Thread read path — replies for one question, tenant-scoped by RLS.
CREATE INDEX idx_question_replies_question ON question_replies (question_id);

ALTER TABLE question_replies ENABLE ROW LEVEL SECURITY;
ALTER TABLE question_replies FORCE ROW LEVEL SECURITY;

CREATE POLICY question_replies_select ON question_replies
    FOR SELECT
    USING (center_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

CREATE POLICY question_replies_insert ON question_replies
    FOR INSERT
    WITH CHECK (center_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

CREATE POLICY question_replies_update ON question_replies
    FOR UPDATE
    USING (center_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
    WITH CHECK (center_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

CREATE POLICY question_replies_delete ON question_replies
    FOR DELETE
    USING (center_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
