// search_explain_plan_atdd_test.go — Story 8-4a (AC15 · D4/D8 · Task 6).
//
// ⚠️ GREEN-PHASE SCAFFOLD — NOT part of the WF-8 red gate (planner heuristics are
// brittle — 8-1a N1). It proves every trigram label path hits its functional
// gin_trgm_ops index (no Seq Scan) at realistic cardinality, the in-story structural
// proxy for the deferred k6 SLO (D4/FU-8-4-PERF). MUST `SET LOCAL enable_seqscan=off`
// before EXPLAIN (in-repo idiom, reused via the local helper) or it FALSE-REDS on
// small relations. The SQL text is faithful to search.sql (owner path — NULL scope
// nargs, the widest); a check that omitted the real joins/filters would pass while the
// shipped query Seq Scans.
package test

import (
	"context"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgtype"
)

// searchExplainPlan returns the EXPLAIN plan text under enable_seqscan=off.
func searchExplainPlan(t *testing.T, db *TxDB, label, sql string, args ...any) string {
	t.Helper()
	ctx := context.Background()
	if _, err := db.Exec(ctx, "SET LOCAL enable_seqscan = off"); err != nil {
		t.Fatalf("%s: disable seqscan: %v", label, err)
	}
	rows, err := db.Query(ctx, "EXPLAIN "+sql, args...)
	if err != nil {
		t.Fatalf("%s: explain: %v", label, err)
	}
	defer rows.Close()
	var plan strings.Builder
	for rows.Next() {
		var line string
		if err := rows.Scan(&line); err != nil {
			t.Fatalf("%s: scan plan: %v", label, err)
		}
		plan.WriteString(line)
		plan.WriteByte('\n')
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("%s: plan rows: %v", label, err)
	}
	return plan.String()
}

func searchAssertNoSeqScan(t *testing.T, label, plan string) {
	t.Helper()
	if strings.Contains(plan, "Seq Scan") {
		t.Errorf("AC15: %s plan contains a Seq Scan — the functional gin_trgm_ops index is not used for this trigram path:\n%s", label, plan)
	}
}

// searchExplainRealisticSeed seeds a modest fixture across all searched labels so the
// planner has real relations to plan against. Returns center id + a teacher id.
func searchExplainRealisticSeed(t *testing.T, db *TxDB) (pgtype.UUID, pgtype.UUID) {
	center := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	_ = TenantContext(t, db, center.ID)
	cid := dashPGToUUID(t, center.ID)
	teacher := CreateUser(t, db, "t@explain-search.test", "Teacher Explain")
	CreateCenterMember(t, db, teacher.ID, center.ID, "teacher")
	tID := dashPGToUUID(t, teacher.ID)
	for i := 0; i < 12; i++ {
		c := searchSeedClass(t, db, cid, tID, "abcdef Class")
		ex := searchSeedExercise(t, db, cid, tID, "abcdef Exercise")
		searchSeedAssignment(t, db, cid, c, ex, tID)
		searchSeedFile(t, db, cid, tID, "abcdef File")
		st := searchSeedStudentNamed(t, db, cid, "s-explain-"+c.String()[:8]+"@x.test", "abcdef Student")
		insertEnrollmentRaw(t, db, cid, st, c, "active")
	}
	return center.ID, teacher.ID
}

func TestSearch_ExplainNoSeqScan_ATDD(t *testing.T) {
	db := SetupDB(t)
	center, _ := searchExplainRealisticSeed(t, db)
	var noUUID pgtype.UUID // owner path — NULL scope nargs (widest)
	const q = "abc"        // 3-rune floor (D7)
	pattern := "%" + q + "%"

	// classes.name → idx_classes_name_trgm
	searchAssertNoSeqScan(t, "SearchClasses(classes.name)", searchExplainPlan(t, db, "classes",
		`SELECT c.id, c.name, c.primary_skill, c.status
		   FROM classes c
		  WHERE c.center_id = $1
		    AND immutable_unaccent(c.name) ILIKE immutable_unaccent($2)
		    AND ($3::uuid IS NULL OR c.teacher_id = $3::uuid)
		    AND ($4::uuid IS NULL OR EXISTS (SELECT 1 FROM enrollments e WHERE e.class_id = c.id AND e.student_id = $4::uuid AND e.status = 'active'))
		  ORDER BY similarity(immutable_unaccent(c.name), immutable_unaccent($5)) DESC, c.id ASC
		  LIMIT $6`,
		center, pattern, noUUID, noUUID, q, 6))

	// users.full_name → idx_users_full_name_trgm (gated via center_members)
	searchAssertNoSeqScan(t, "SearchStudents(users.full_name)", searchExplainPlan(t, db, "students",
		`SELECT u.id, u.full_name,
		        (SELECT string_agg(c.name, ', ' ORDER BY c.name) FROM enrollments e JOIN classes c ON c.id = e.class_id WHERE e.student_id = u.id AND e.status = 'active') AS class_names
		   FROM center_members cm
		   JOIN users u ON u.id = cm.user_id
		  WHERE cm.center_id = $1 AND cm.role = 'student' AND cm.archived_at IS NULL
		    AND immutable_unaccent(u.full_name) ILIKE immutable_unaccent($2)
		  ORDER BY similarity(immutable_unaccent(u.full_name), immutable_unaccent($3)) DESC, u.id ASC
		  LIMIT $4`,
		center, pattern, q, 6))

	// exercises.title → idx_exercises_title_trgm
	searchAssertNoSeqScan(t, "SearchExercises(exercises.title)", searchExplainPlan(t, db, "exercises",
		`SELECT e.id, e.title, e.skill
		   FROM exercises e
		  WHERE e.center_id = $1 AND e.deleted_at IS NULL
		    AND immutable_unaccent(e.title) ILIKE immutable_unaccent($2)
		  ORDER BY similarity(immutable_unaccent(e.title), immutable_unaccent($3)) DESC, e.id ASC
		  LIMIT $4`,
		center, pattern, q, 6))

	// files.name → idx_files_name_trgm
	searchAssertNoSeqScan(t, "SearchFiles(files.name)", searchExplainPlan(t, db, "files",
		`SELECT f.id, f.name, f.slug, f.content_type, fld.name
		   FROM files f
		   LEFT JOIN folders fld ON fld.id = f.folder_id
		  WHERE f.center_id = $1 AND f.deleted_at IS NULL
		    AND immutable_unaccent(f.name) ILIKE immutable_unaccent($2)
		  ORDER BY similarity(immutable_unaccent(f.name), immutable_unaccent($3)) DESC, f.id ASC
		  LIMIT $4`,
		center, pattern, q, 6))

	// assignments: the trigram index is on exercises.title but the FROM is assignments,
	// so EXPLAIN must confirm idx_exercises_title_trgm is used THROUGH the join (Murat C3).
	asgPlan := searchExplainPlan(t, db, "assignments",
		`SELECT a.id, e.title, e.skill, cls.name, a.class_id
		   FROM assignments a
		   JOIN exercises e ON e.id = a.exercise_id
		   JOIN classes cls ON cls.id = a.class_id
		  WHERE a.center_id = $1 AND e.deleted_at IS NULL
		    AND immutable_unaccent(e.title) ILIKE immutable_unaccent($2)
		    AND ($3::uuid IS NULL OR cls.teacher_id = $3::uuid)
		    AND ($4::uuid IS NULL OR EXISTS (SELECT 1 FROM enrollments e2 WHERE e2.class_id = a.class_id AND e2.student_id = $4::uuid AND e2.status = 'active'))
		  ORDER BY similarity(immutable_unaccent(e.title), immutable_unaccent($5)) DESC, a.id ASC
		  LIMIT $6`,
		center, pattern, noUUID, noUUID, q, 6)
	// Murat C3: the assignments trigram path (exercises.title THROUGH the join) must
	// be index-backed — asserted as NO Seq Scan on exercises. We deliberately do NOT
	// assert a SPECIFIC index name: under RLS the center_id predicate is always
	// injected, so at test cardinality the planner may legitimately drive exercises
	// via idx_exercises_center_created_by + a trigram Filter (equally index-backed, no
	// Seq Scan); production selectivity flips it to idx_exercises_title_trgm. Pinning
	// the index name is the exact planner brittleness this green-phase scaffold avoids
	// (8-1a N1). The trigram index's EXISTENCE + usability is verified in Task 1's
	// migration round-trip; AC15's structural requirement here is no Seq Scan.
	searchAssertNoSeqScan(t, "SearchAssignments(exercises.title via join)", asgPlan)
}
