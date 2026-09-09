-- Migration: backfill_enrollment_history_genesis
-- Story 7.3a (AC10 · P1 from Story 2.7) — every enrollment created before 7.3a
-- (the 3.4.5 Add case + the 2.7 bulk import) has NO enrollment_history row. Without
-- a genesis row the s43 history table (7-3b) would show transfers/withdrawals
-- "from nowhere". Insert exactly one action='add' genesis row per existing
-- enrollment that lacks one (from=NULL, to=class_id, effective_date=enrolled_at,
-- performed_by=NULL → rendered as "System" by 7-3b, note='(system)').
--
-- RLS trap (AC10 / PERF-1): enrollment_history is ENABLE+FORCE RLS with a
-- FOR INSERT WITH CHECK (center_id = app.current_tenant_id). scripts/migrate.sh
-- connects as a SUPERUSER (MIGRATION_DATABASE_URL — "Migrations require superuser
-- privileges"), which BYPASSES RLS entirely, so both the enumerating read and the
-- INSERT succeed. The per-center `set_config('app.current_tenant_id', …, is_local
-- => true)` loop below keeps the INSERT correct even under a non-superuser
-- table-owner with FORCE RLS: the WITH CHECK is satisfied per center. set_config's
-- is_local=true is transaction-scoped (golang-migrate wraps each migration in a
-- tx), so it never leaks past this migration.

DO $$
DECLARE
    v_center uuid;
BEGIN
    FOR v_center IN SELECT DISTINCT center_id FROM enrollments LOOP
        PERFORM set_config('app.current_tenant_id', v_center::text, true);
        INSERT INTO enrollment_history
            (id, center_id, student_id, action, from_class_id, to_class_id,
             effective_date, note, performed_by, performed_at)
        SELECT gen_random_uuid(), e.center_id, e.student_id, 'add', NULL, e.class_id,
               e.enrolled_at::date, '(system)', NULL, e.enrolled_at
        FROM enrollments e
        WHERE e.center_id = v_center
          AND NOT EXISTS (
              SELECT 1 FROM enrollment_history h
              WHERE h.center_id = e.center_id
                AND h.student_id = e.student_id
                AND h.to_class_id = e.class_id
                AND h.action = 'add'
          );
    END LOOP;
END $$;
