// grades_answer_errors_immutable_atdd_test.go — Story 8-3a ATDD (green)
// (AC15/AC16/AC17 · risk=8 · R-2 immutable-grade regression · WF-8 HARD GATE).
// FU-8-2-A: the additive, immutable `grades.answer_errors jsonb` snapshot written at
// objective Release + surfaced through the `current_grades` (security_invoker) view.
//
// This is the store/SQL-layer half of FU-8-2-A (John J2 — reviewable in isolation
// from the analytics read side). It pins, against the greenfield column + the
// `store.AnswerError` typed element (GO-7):
//   - the column round-trips the EXACT typed `[]AnswerError{questionRef,questionType,
//     schemaVersion}` set through the security_invoker view (AC16);
//   - a Writing/Speaking release leaves it SQL NULL — NOT '[]', NOT 'null'::jsonb —
//     keeping the R-4 mine-time union safe by construction (AC16/T6);
//   - `UPDATE grades SET answer_errors=…` is REJECTED (append-only = table-level
//     REVOKE UPDATE/DELETE + no UPDATE policy; there is NO trigger on grades) (AC17/T5);
//   - the column is tenant-isolated through current_grades (cross-tenant read → none) (AC17).
//
// SCAFFOLD NOTE (TODO green — Task 2): AC16's "definitive-incorrect incl needs_review→
// wrong" set is PRODUCED by AutoGradeService.Release (auto_grade_service.go:361) via
// effectiveMark + the exported grading.questionType resolver. Driving a full objective
// Release is heavy for a red scaffold; these tests assert the column/view/immutability
// CONTRACT at the SQL layer against the store.AnswerError seam. The dev wires Release
// to emit exactly this typed set and adds the release-path integration assertion.
//
// RED: real `//go:build atdd_red_phase`. Under `-tags=atdd_red_phase` compile-fails
// ONLY on the greenfield seam store.AnswerError (Task 2). The grades.answer_errors
// column + the view extension are runtime seams (this file's SQL exercises them once
// the migration + codegen land). Owns spSeedObjectiveGrade, reused by file 5.
package test

import (
	"context"
	"encoding/json"
	"reflect"
	"testing"
	"time"

	"github.com/ducdo/classlite-api/internal/store"
	"github.com/google/uuid"
)

// spSeedObjectiveGrade seeds exercise(skill)→assignment→submission(graded)→grade
// (released) with `answer_errors` = `answerErrorsJSON` (nil ⇒ SQL NULL) and returns
// the grade id. Tenant context set by the caller. References the FU-8-2-A greenfield
// grades.answer_errors column (runtime seam).
func spSeedObjectiveGrade(t *testing.T, db *TxDB, cid, class, student, author uuid.UUID, skill string, releasedAt time.Time, answerErrorsJSON *string) uuid.UUID {
	t.Helper()
	ctx := context.Background()
	exID, asID, subID, gID := uuid.New(), uuid.New(), uuid.New(), uuid.New()
	if _, err := db.Exec(ctx,
		`INSERT INTO exercises (id, center_id, created_by, code, title, skill) VALUES ($1,$2,$3,$4,'Ex',$5)`,
		exID, cid, author, "EX-"+uuid.NewString()[:8], skill); err != nil {
		t.Fatalf("spSeedObjectiveGrade exercise(%s): %v", skill, err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO assignments (id, center_id, exercise_id, class_id, created_by, deadline_at) VALUES ($1,$2,$3,$4,$5,$6)`,
		asID, cid, exID, class, author, releasedAt.Add(-24*time.Hour)); err != nil {
		t.Fatalf("spSeedObjectiveGrade assignment: %v", err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO submissions (id, center_id, assignment_id, student_id, status, submitted_at) VALUES ($1,$2,$3,$4,'graded',$5)`,
		subID, cid, asID, student, releasedAt.Add(-2*time.Hour)); err != nil {
		t.Fatalf("spSeedObjectiveGrade submission: %v", err)
	}
	if answerErrorsJSON == nil {
		if _, err := db.Exec(ctx,
			`INSERT INTO grades (id, submission_id, center_id, graded_by, version, criterion_scores, overall_band, answer_errors, released_at)
			 VALUES ($1,$2,$3,$4,1,'{}'::jsonb,$5,NULL,$6)`,
			gID, subID, cid, author, 6.0, releasedAt); err != nil {
			t.Fatalf("spSeedObjectiveGrade grade(NULL answer_errors): %v", err)
		}
	} else {
		if _, err := db.Exec(ctx,
			`INSERT INTO grades (id, submission_id, center_id, graded_by, version, criterion_scores, overall_band, answer_errors, released_at)
			 VALUES ($1,$2,$3,$4,1,'{}'::jsonb,$5,$6::jsonb,$7)`,
			gID, subID, cid, author, 6.0, *answerErrorsJSON, releasedAt); err != nil {
			t.Fatalf("spSeedObjectiveGrade grade(answer_errors): %v", err)
		}
	}
	return gID
}

func spSeedObjClassStudent(t *testing.T, db *TxDB, cid uuid.UUID) (class, student, author uuid.UUID) {
	t.Helper()
	teacher := CreateUser(t, db, "obj-t-"+uuid.NewString()[:8]+"@x.test", "Obj Teacher")
	CreateCenterMember(t, db, teacher.ID, pgUUID(cid), "teacher")
	author = uuidFromPg(teacher.ID)
	class = seedClassWithTeacher(t, db, cid, author)
	st := CreateUser(t, db, "obj-s-"+uuid.NewString()[:8]+"@x.test", "Obj Student")
	CreateCenterMember(t, db, st.ID, pgUUID(cid), "student")
	student = uuidFromPg(st.ID)
	insertEnrollmentRaw(t, db, cid, student, class, "active")
	return class, student, author
}

// ── AC16 — objective Release snapshots the EXACT typed []AnswerError through the view ──

func TestGradesAnswerErrors_ObjectiveSnapshot_ExactSet_ATDD(t *testing.T) {
	db := SetupDB(t)
	center := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	_ = TenantContext(t, db, center.ID)
	cid := dashPGToUUID(t, center.ID)
	class, student, author := spSeedObjClassStudent(t, db, cid)

	// The definitive-incorrect set FU-8-2-A snapshots at objective Release — q3 is the
	// needs_review→wrong path (Winston C3). NO `skill` in the JSONB (Winston C2).
	expected := []store.AnswerError{
		{QuestionRef: "q1", QuestionType: "gap_fill", SchemaVersion: 1},
		{QuestionRef: "q3", QuestionType: "multiple_choice", SchemaVersion: 1},
	}
	blob, err := json.Marshal(expected)
	if err != nil {
		t.Fatalf("marshal expected AnswerErrors: %v", err)
	}
	js := string(blob)
	gID := spSeedObjectiveGrade(t, db, cid, class, student, author, "reading", time.Now().Add(-24*time.Hour), &js)

	// Read back through current_grades (security_invoker) — the column must be in the
	// view SELECT list (AC15) and round-trip the exact typed set.
	var raw []byte
	if err := db.QueryRow(context.Background(),
		`SELECT answer_errors FROM current_grades WHERE id=$1`, gID).Scan(&raw); err != nil {
		t.Fatalf("read current_grades.answer_errors: %v", err)
	}
	var got []store.AnswerError
	if err := json.Unmarshal(raw, &got); err != nil {
		t.Fatalf("unmarshal answer_errors into []store.AnswerError: %v (raw=%s)", err, string(raw))
	}
	if !reflect.DeepEqual(got, expected) {
		t.Errorf("AC16: current_grades.answer_errors = %+v, want the exact definitive-incorrect set %+v", got, expected)
	}
}

// ── AC16 (release path) — a REAL AutoGradeService.Release snapshots the EXACT set,
//
//	including the needs_review→wrong path (Winston C3), with NO skill in the JSONB ──
//
// Drives the shipped objective-release fixture (setupAGReleaseEnv, auto_grade_override_
// release_atdd_test.go): 0:0:0 correct, 0:1:0 needs_review (unresolved). A direct Release
// counts the unresolved needs_review as wrong (definitiveScore), so the snapshot must carry
// exactly {0:1:0, fill_in_blank} — 0:0:0 (correct) excluded, no skill baked in.
func TestGradesAnswerErrors_ReleasePath_ExactSet_NeedsReviewWrong_ATDD(t *testing.T) {
	env := setupAGReleaseEnv(t)
	ctx := context.Background()

	if _, err := env.svc.Release(ctx, env.ownerTC, env.submissionID); err != nil {
		t.Fatalf("release: %v", err)
	}

	var raw []byte
	if err := env.db.QueryRow(ctx,
		`SELECT answer_errors FROM current_grades WHERE submission_id=$1`, env.submissionID).Scan(&raw); err != nil {
		t.Fatalf("read released answer_errors: %v", err)
	}
	var got []store.AnswerError
	if err := json.Unmarshal(raw, &got); err != nil {
		t.Fatalf("unmarshal released answer_errors: %v (raw=%s)", err, string(raw))
	}
	want := []store.AnswerError{{QuestionRef: "0:1:0", QuestionType: "fill_in_blank", SchemaVersion: 1}}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("AC16 release snapshot = %+v, want %+v (needs_review→wrong INCLUDED; correct excluded; NO skill in JSONB)", got, want)
	}
}

// ── AC16/T6 — a Writing release leaves answer_errors SQL NULL (not '[]', not 'null') ──

func TestGradesAnswerErrors_WritingRelease_SqlNull_ATDD(t *testing.T) {
	db := SetupDB(t)
	center := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	_ = TenantContext(t, db, center.ID)
	cid := dashPGToUUID(t, center.ID)
	class, student, author := spSeedObjClassStudent(t, db, cid)

	gID := spSeedObjectiveGrade(t, db, cid, class, student, author, "writing", time.Now().Add(-24*time.Hour), nil)

	var isNull bool
	if err := db.QueryRow(context.Background(),
		`SELECT answer_errors IS NULL FROM current_grades WHERE id=$1`, gID).Scan(&isNull); err != nil {
		t.Fatalf("read answer_errors IS NULL: %v", err)
	}
	if !isNull {
		t.Errorf("AC16/T6: a Writing/Speaking release must write answer_errors = SQL NULL " +
			"(not '[]'::jsonb, not 'null'::jsonb) — keeps the R-4 union safe by construction")
	}
}

// ── AC17/T5 — append-only: UPDATE grades.answer_errors is REJECTED ──

func TestGradesAnswerErrors_UpdateDenied_AppendOnly_ATDD(t *testing.T) {
	db := SetupDB(t)
	center := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	_ = TenantContext(t, db, center.ID)
	cid := dashPGToUUID(t, center.ID)
	class, student, author := spSeedObjClassStudent(t, db, cid)

	js := `[{"questionRef":"q1","questionType":"gap_fill","schemaVersion":1}]`
	gID := spSeedObjectiveGrade(t, db, cid, class, student, author, "reading", time.Now().Add(-24*time.Hour), &js)

	// classlite_app holds no UPDATE on grades (table-level REVOKE, no UPDATE policy).
	if _, err := db.Exec(context.Background(),
		`UPDATE grades SET answer_errors = '[]'::jsonb WHERE id=$1`, gID); err == nil {
		t.Errorf("AC17/T5: UPDATE grades.answer_errors must be REJECTED (append-only — table-level REVOKE, no UPDATE policy, NO trigger)")
	}
}

// ── AC17 — the column is tenant-isolated through current_grades (cross-tenant → none) ──

func TestGradesAnswerErrors_CrossTenantIsolated_ATDD(t *testing.T) {
	db := SetupDB(t)
	centerA := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	centerB := CreateCenterWithID(t, db, TenantBID, "Center B", "center-b")

	// Seed a grade WITH answer_errors in Center B.
	_ = TenantContext(t, db, centerB.ID)
	cidB := dashPGToUUID(t, centerB.ID)
	classB, studentB, authorB := spSeedObjClassStudent(t, db, cidB)
	js := `[{"questionRef":"q1","questionType":"gap_fill","schemaVersion":1}]`
	_ = spSeedObjectiveGrade(t, db, cidB, classB, studentB, authorB, "reading", time.Now().Add(-24*time.Hour), &js)

	// Positive control: from Center B, the answer_errors row is visible.
	var nB int
	if err := db.QueryRow(context.Background(),
		`SELECT count(*) FROM current_grades WHERE answer_errors IS NOT NULL`).Scan(&nB); err != nil {
		t.Fatalf("count (center B): %v", err)
	}
	if nB < 1 {
		t.Fatalf("AC17 positive: center-B must see its own answer_errors row (got %d) — empty-for-everyone false-passes isolation", nB)
	}

	// Negative: from Center A, RLS hides the Center-B answer_errors row.
	_ = TenantContext(t, db, centerA.ID)
	var nA int
	if err := db.QueryRow(context.Background(),
		`SELECT count(*) FROM current_grades WHERE answer_errors IS NOT NULL`).Scan(&nA); err != nil {
		t.Fatalf("count (center A): %v", err)
	}
	if nA != 0 {
		t.Errorf("AC17 CROSS-TENANT LEAK: center-A saw %d center-B answer_errors rows through current_grades, want 0", nA)
	}
}
