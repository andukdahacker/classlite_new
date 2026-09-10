// GREEN (de-tagged 2026-09-10, Story 7.4a dev): ListQuestionsForReader /
// CountQuestionsForReader shipped in queries/questions.sql with the role-scope
// elision encoded in SQL (student→own, teacher→own-classes, owner/admin→0). See
// the GREEN SEAMS block below. Folded into the permanent suite.
//
// Story 7.4a (AC6/AC7 · R25/R26 · risk=7 · WF-8 HARD GATE) — the Q&A read-scope
// ELISION, the headline gate. Real DB in tx under FORCE RLS. This is the R25/R26
// risk driver: Q&A is teacher↔student ONLY, and a "Shared with your class" thread
// leaking to an Owner or Admin (or across teachers/students) is the exact failure
// the epic forbids ("empty list — NEVER null, NEVER 403, NEVER error").
//
// The scope lives in the STORE query (like 7.2a ListStudents' teacher_id narg),
// but INVERTED: owner/admin do NOT map to center-wide — they map to a predicate
// that matches NOTHING. The service passes the DB-fetched role as ReaderRole
// (SEC-1 is proven separately in service/question_authz_atdd_test.go).
//
// ★ Murat house rule (student_roster_rls_atdd_test.go:5-7): a reader seeing ZERO
// is only proof when another reader genuinely CAN see the row — every negative
// carries a positive control.
//
// This file also owns the shared qa* seed helpers reused by
// questions_rls_atdd_test.go and question_visibility_atdd_test.go. All names are
// qa-prefixed: the 7.1a/7.2a/7.3a reds are DE-TAGGED now and own pgUUID /
// seedActiveEnrollment / seedClassWithTeacher in the default `test` build, so a
// tagged file compiled alongside them must not collide.
//
// RED (`//go:build atdd_red_phase`, quarantined): compile-fails on the GREENFIELD
// store seams — generated.ListQuestionsForReader / ListQuestionsForReaderParams /
// ListQuestionsForReaderRow / CountQuestionsForReader. Task 3 builds
// queries/questions.sql.
//
// GREEN SEAMS (dev — Task 3 queries/questions.sql):
//
//	ListQuestionsForReader(ctx, ListQuestionsForReaderParams{
//	    CenterID   pgtype.UUID,
//	    ReaderID   pgtype.UUID,
//	    ReaderRole string,       // DB-fetched (SEC-1). SCOPE, encoded IN SQL:
//	                             //   'student' ⇒ q.student_id = ReaderID
//	                             //   'teacher' ⇒ q.class_id IN (SELECT id FROM classes WHERE teacher_id = ReaderID)
//	                             //   owner|admin (anything else) ⇒ matches NOTHING (0 rows) — R25/R26 elision
//	    ExerciseID pgtype.UUID,  // narg (Valid=false ⇒ all exercises)
//	    ClassID    pgtype.UUID,  // narg (Valid=false ⇒ all classes)
//	    Status     pgtype.Text,  // narg ('open'|'resolved')
//	    Unanswered pgtype.Bool,  // narg (true ⇒ status='open')
//	    Limit      int32,
//	    Offset     int32,
//	}) → []ListQuestionsForReaderRow
//	  Row exposes at least: QuestionID · ExerciseID · ClassID · StudentID ·
//	    AnchorType · AnchorRef(nullable jsonb) · AnchorExcerpt(nullable) · Content · Status · CreatedAt
//	CountQuestionsForReader(ctx, CountQuestionsForReaderParams{CenterID, ReaderID, ReaderRole, ...nargs}) → int64
package test

import (
	"context"
	"testing"

	"github.com/ducdo/classlite-api/internal/store/generated"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

// ---------------------------------------------------------------------------
// shared qa* helpers (this file owns them; F1/F3 reuse)
// ---------------------------------------------------------------------------

func qaPgUUID(id uuid.UUID) pgtype.UUID    { return pgtype.UUID{Bytes: id, Valid: true} }
func qaUUIDFromPg(x pgtype.UUID) uuid.UUID { return uuid.UUID(x.Bytes) }

// qaSeedMember creates a user + a center_members row with the given role in the
// current tenant. Tenant context must be set by the caller.
func qaSeedMember(t *testing.T, db *TxDB, centerID uuid.UUID, email, name, role string) uuid.UUID {
	t.Helper()
	u := CreateUser(t, db, email, name)
	CreateCenterMember(t, db, u.ID, qaPgUUID(centerID), role)
	return qaUUIDFromPg(u.ID)
}

// qaSeedClassWithTeacher inserts a class owned by teacherID (teacher_id set →
// pending_teacher_email NULL, honoring the classes_teacher_mutex CHECK).
func qaSeedClassWithTeacher(t *testing.T, db *TxDB, centerID, teacherID uuid.UUID) uuid.UUID {
	t.Helper()
	id := uuid.New()
	if _, err := db.Exec(context.Background(),
		`INSERT INTO classes (id, center_id, name, target_band, primary_skill, session_count, status, start_date, teacher_id)
		 VALUES ($1, $2, 'QA Class', 6.5, 'writing', 12, 'active', current_date, $3)`,
		id, centerID, teacherID); err != nil {
		t.Fatalf("seed class w/ teacher: %v", err)
	}
	return id
}

// qaSeedEnrollment inserts an enrollments row with the given status (a terminal
// status carries withdrawn_at, per the 7.3a coupling CHECK).
func qaSeedEnrollment(t *testing.T, db *TxDB, centerID, studentID, classID uuid.UUID, status string) {
	t.Helper()
	if _, err := db.Exec(context.Background(),
		`INSERT INTO enrollments (id, center_id, student_id, class_id, status, withdrawn_at)
		 VALUES ($1, $2, $3, $4, $5, CASE WHEN $5 <> 'active' THEN now() ELSE NULL END)`,
		uuid.New(), centerID, studentID, classID, status); err != nil {
		t.Fatalf("seed enrollment (%s): %v", status, err)
	}
}

func qaSeedActiveEnrollment(t *testing.T, db *TxDB, centerID, studentID, classID uuid.UUID) {
	t.Helper()
	qaSeedEnrollment(t, db, centerID, studentID, classID, "active")
}

// qaSeedExercise inserts a center-library exercise (the FK anchor for a question).
func qaSeedExercise(t *testing.T, db *TxDB, centerID, createdBy uuid.UUID) uuid.UUID {
	t.Helper()
	id := uuid.New()
	if _, err := db.Exec(context.Background(),
		`INSERT INTO exercises (id, center_id, created_by, code, title, skill, tags)
		 VALUES ($1, $2, $3, $4, 'QA Exercise', 'reading', '{}')`,
		id, centerID, createdBy, "QA-"+uuid.NewString()[:8]); err != nil {
		t.Fatalf("seed exercise: %v", err)
	}
	return id
}

// qaInsertQuestion inserts a questions row (anchorType 'item' carries a positional
// anchor_ref + excerpt snapshot; 'exercise' leaves both NULL). status='open'.
// The column list here IS the migration contract (Task 1 must match).
func qaInsertQuestion(t *testing.T, db *TxDB, centerID, exerciseID, classID, studentID uuid.UUID, anchorType string) uuid.UUID {
	t.Helper()
	id := uuid.New()
	if _, err := db.Exec(context.Background(),
		`INSERT INTO questions
		   (id, center_id, exercise_id, class_id, student_id, anchor_type, anchor_ref, anchor_excerpt, content, status)
		 VALUES ($1, $2, $3, $4, $5, $6,
		   CASE WHEN $6 = 'item' THEN '{"schemaVersion":1,"sectionIndex":0,"questionGroupIndex":0,"questionIndex":0}'::jsonb ELSE NULL END,
		   CASE WHEN $6 = 'item' THEN 'the wisdom of crowds' ELSE NULL END,
		   'Why is the answer B and not C?', 'open')`,
		id, centerID, exerciseID, classID, studentID, anchorType); err != nil {
		t.Fatalf("insert question (anchor=%s — is the create_questions migration applied?): %v", anchorType, err)
	}
	return id
}

// qaInsertReply inserts a question_replies row with the given visibility
// ('personal'|'shared'). The column list here IS the migration contract.
func qaInsertReply(t *testing.T, db *TxDB, centerID, questionID, authorID uuid.UUID, visibility string) uuid.UUID {
	t.Helper()
	id := uuid.New()
	if _, err := db.Exec(context.Background(),
		`INSERT INTO question_replies (id, center_id, question_id, author_id, content, visibility)
		 VALUES ($1, $2, $3, $4, 'Look again at the second paragraph.', $5)`,
		id, centerID, questionID, authorID, visibility); err != nil {
		t.Fatalf("insert question_reply (visibility=%s): %v", visibility, err)
	}
	return id
}

func qaReaderParams(centerID, readerID uuid.UUID, role string) generated.ListQuestionsForReaderParams {
	return generated.ListQuestionsForReaderParams{
		CenterID:   qaPgUUID(centerID),
		ReaderID:   qaPgUUID(readerID),
		ReaderRole: role,
		ExerciseID: pgtype.UUID{Valid: false},
		ClassID:    pgtype.UUID{Valid: false},
		Status:     pgtype.Text{Valid: false},
		Unanswered: pgtype.Bool{Valid: false},
		Limit:      50,
		Offset:     0,
	}
}

func qaRowsHaveQuestion(rows []generated.ListQuestionsForReaderRow, qid uuid.UUID) bool {
	for _, r := range rows {
		if qaUUIDFromPg(r.QuestionID) == qid {
			return true
		}
	}
	return false
}

// qaScopeGraph seeds a two-teacher, two-student center in the current tenant:
//
//	teacherT1 teaches classC1; studentS1 enrolled C1, asks Q1 on C1.
//	teacherT2 teaches classC2; studentS2 enrolled C2, asks Q2 on C2.
//
// Returns the actors + questions so a caller can assert cross-reader isolation.
type qaScope struct {
	centerID             uuid.UUID
	teacherT1, teacherT2 uuid.UUID
	studentS1, studentS2 uuid.UUID
	classC1, classC2     uuid.UUID
	q1, q2               uuid.UUID
}

func qaScopeGraph(t *testing.T, db *TxDB, centerID uuid.UUID) qaScope {
	t.Helper()
	author := qaSeedMember(t, db, centerID, "qa-author-"+uuid.NewString()[:8]+"@example.com", "Exercise Author", "admin")
	ex := qaSeedExercise(t, db, centerID, author)

	t1 := qaSeedMember(t, db, centerID, "qa-t1-"+uuid.NewString()[:8]+"@example.com", "Teacher One", "teacher")
	t2 := qaSeedMember(t, db, centerID, "qa-t2-"+uuid.NewString()[:8]+"@example.com", "Teacher Two", "teacher")
	c1 := qaSeedClassWithTeacher(t, db, centerID, t1)
	c2 := qaSeedClassWithTeacher(t, db, centerID, t2)

	s1 := qaSeedMember(t, db, centerID, "qa-s1-"+uuid.NewString()[:8]+"@example.com", "Student One", "student")
	s2 := qaSeedMember(t, db, centerID, "qa-s2-"+uuid.NewString()[:8]+"@example.com", "Student Two", "student")
	qaSeedActiveEnrollment(t, db, centerID, s1, c1)
	qaSeedActiveEnrollment(t, db, centerID, s2, c2)

	q1 := qaInsertQuestion(t, db, centerID, ex, c1, s1, "item")
	q2 := qaInsertQuestion(t, db, centerID, ex, c2, s2, "exercise")

	return qaScope{centerID, t1, t2, s1, s2, c1, c2, q1, q2}
}

// ---------------------------------------------------------------------------
// AC7 — R25/R26 role-scope elision. Owner=0, Admin=0, Teacher=own-class-only,
// Student=own-only. Each negative carries a positive control.
// ---------------------------------------------------------------------------

func TestQuestionScope_Student_SeesOwnOnly_ATDD(t *testing.T) {
	db := SetupDB(t)
	center := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	TenantContext(t, db, center.ID)
	g := qaScopeGraph(t, db, qaUUIDFromPg(center.ID))

	rows, err := generated.New(db).ListQuestionsForReader(context.Background(), qaReaderParams(g.centerID, g.studentS1, "student"))
	if err != nil {
		t.Fatalf("ListQuestionsForReader(student): %v", err)
	}
	if !qaRowsHaveQuestion(rows, g.q1) {
		t.Errorf("student S1 must see own question Q1 (positive control failed)")
	}
	if qaRowsHaveQuestion(rows, g.q2) {
		t.Errorf("SCOPE LEAK (R25): student S1 saw another student's question Q2")
	}
}

func TestQuestionScope_Teacher_SeesOwnClassOnly_ATDD(t *testing.T) {
	db := SetupDB(t)
	center := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	TenantContext(t, db, center.ID)
	g := qaScopeGraph(t, db, qaUUIDFromPg(center.ID))

	q := generated.New(db)
	rowsT1, err := q.ListQuestionsForReader(context.Background(), qaReaderParams(g.centerID, g.teacherT1, "teacher"))
	if err != nil {
		t.Fatalf("ListQuestionsForReader(teacherT1): %v", err)
	}
	if !qaRowsHaveQuestion(rowsT1, g.q1) {
		t.Errorf("teacher T1 must see Q1 (their class C1) — positive control failed")
	}
	if qaRowsHaveQuestion(rowsT1, g.q2) {
		t.Errorf("SCOPE LEAK (R26): teacher T1 saw Q2 (teacher T2's class C2)")
	}

	// positive control: T2 genuinely sees Q2 → proves T1's zero above is real isolation.
	rowsT2, err := q.ListQuestionsForReader(context.Background(), qaReaderParams(g.centerID, g.teacherT2, "teacher"))
	if err != nil {
		t.Fatalf("ListQuestionsForReader(teacherT2): %v", err)
	}
	if !qaRowsHaveQuestion(rowsT2, g.q2) {
		t.Errorf("teacher T2 must see Q2 (their class C2) — positive control failed")
	}
}

func TestQuestionScope_OwnerAndAdmin_SeeZero_ATDD(t *testing.T) {
	db := SetupDB(t)
	center := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	TenantContext(t, db, center.ID)
	g := qaScopeGraph(t, db, qaUUIDFromPg(center.ID))

	owner := qaSeedMember(t, db, g.centerID, "qa-owner@example.com", "The Owner", "owner")
	admin := qaSeedMember(t, db, g.centerID, "qa-admin@example.com", "The Admin", "admin")
	q := generated.New(db)

	ownerRows, err := q.ListQuestionsForReader(context.Background(), qaReaderParams(g.centerID, owner, "owner"))
	if err != nil {
		t.Fatalf("ListQuestionsForReader(owner) must NOT error — Q&A elides to empty, never errors (R25): %v", err)
	}
	if len(ownerRows) != 0 {
		t.Errorf("R25 VIOLATION: Owner saw %d Q&A rows, must be 0 (Q&A is teacher↔student only)", len(ownerRows))
	}

	adminRows, err := q.ListQuestionsForReader(context.Background(), qaReaderParams(g.centerID, admin, "admin"))
	if err != nil {
		t.Fatalf("ListQuestionsForReader(admin) must NOT error — Q&A elides to empty, never errors (R25): %v", err)
	}
	if len(adminRows) != 0 {
		t.Errorf("R25 VIOLATION: Admin saw %d Q&A rows, must be 0", len(adminRows))
	}

	// positive control: the questions genuinely exist and are visible to their author →
	// owner/admin zero is real elision, not an empty center.
	sRows, err := q.ListQuestionsForReader(context.Background(), qaReaderParams(g.centerID, g.studentS1, "student"))
	if err != nil {
		t.Fatalf("ListQuestionsForReader(student control): %v", err)
	}
	if !qaRowsHaveQuestion(sRows, g.q1) {
		t.Errorf("positive control failed: the seeded Q1 must be visible to its author S1")
	}
}

// CountQuestionsForReader mirrors the same scope (meta.total must not leak either).
func TestQuestionScope_Count_ElidesForOwner_ATDD(t *testing.T) {
	db := SetupDB(t)
	center := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	TenantContext(t, db, center.ID)
	g := qaScopeGraph(t, db, qaUUIDFromPg(center.ID))
	owner := qaSeedMember(t, db, g.centerID, "qa-owner2@example.com", "Owner Two", "owner")

	n, err := generated.New(db).CountQuestionsForReader(context.Background(), generated.CountQuestionsForReaderParams{
		CenterID:   qaPgUUID(g.centerID),
		ReaderID:   qaPgUUID(owner),
		ReaderRole: "owner",
		ExerciseID: pgtype.UUID{Valid: false},
		ClassID:    pgtype.UUID{Valid: false},
		Status:     pgtype.Text{Valid: false},
		Unanswered: pgtype.Bool{Valid: false},
	})
	if err != nil {
		t.Fatalf("CountQuestionsForReader(owner): %v", err)
	}
	if n != 0 {
		t.Errorf("R25 VIOLATION: Owner count = %d, must be 0", n)
	}
}
