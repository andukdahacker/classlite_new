// GREEN (de-tagged 2026-09-10, Story 7.4a dev): ListRepliesForReader shipped in
// queries/questions.sql with the per-reply visibility predicate (shared→class
// teacher/asker/active-enrollee, personal→asker+author, owner/admin→never). See
// the GREEN SEAMS block below. Folded into the permanent suite.
//
// Story 7.4a (AC9/AC10 · R25 · risk=7 · WF-8 HARD GATE) — reply VISIBILITY scoping.
// `shared` reaches every student CURRENTLY (status='active') enrolled in the
// question's class (transfers gain/lose access); `personal` reaches only the
// asking student + the replying teacher (per-thread author binding, independent
// of who currently teaches the class). Real DB in tx under FORCE RLS. The read
// gate is a STORE query, ListRepliesForReader, taking a reader identity + role.
//
// ★ Murat house rule: every negative carries a positive control (an active
// classmate genuinely sees the shared reply; the asker genuinely sees the
// personal reply) so a zero is real scoping, not an empty thread.
//
// Shared qa* helpers live in question_role_scope_atdd_test.go.
//
// RED (`//go:build atdd_red_phase`): compile-fails on the greenfield seam —
// generated.ListRepliesForReader / ListRepliesForReaderParams / ListRepliesForReaderRow.
//
// GREEN SEAMS (dev — Task 3 queries/questions.sql):
//
//	ListRepliesForReader(ctx, ListRepliesForReaderParams{
//	    CenterID   pgtype.UUID,
//	    QuestionID pgtype.UUID,
//	    ReaderID   pgtype.UUID,
//	    ReaderRole string,   // DB-fetched (SEC-1)
//	}) → []ListRepliesForReaderRow      // Row: ReplyID · QuestionID · AuthorID · Content · Visibility · CreatedAt
//	  Per-reply visibility predicate:
//	    'shared'   ⇒ reader teaches q.class_id, OR reader = q.student_id (asker),
//	                 OR reader has an ACTIVE enrollment in q.class_id
//	    'personal' ⇒ reader = q.student_id (asker) OR reader = reply.author_id
//	    owner|admin ⇒ never (0 rows), regardless of visibility
package test

import (
	"context"
	"testing"

	"github.com/ducdo/classlite-api/internal/store/generated"
	"github.com/google/uuid"
)

func qaReplyParams(centerID, questionID, readerID uuid.UUID, role string) generated.ListRepliesForReaderParams {
	return generated.ListRepliesForReaderParams{
		CenterID:   qaPgUUID(centerID),
		QuestionID: qaPgUUID(questionID),
		ReaderID:   qaPgUUID(readerID),
		ReaderRole: role,
	}
}

func qaRepliesHave(rows []generated.ListRepliesForReaderRow, replyID uuid.UUID) bool {
	for _, r := range rows {
		if qaUUIDFromPg(r.ReplyID) == replyID {
			return true
		}
	}
	return false
}

func qaReassignClassTeacher(t *testing.T, db *TxDB, classID, newTeacherID uuid.UUID) {
	t.Helper()
	if _, err := db.Exec(context.Background(),
		`UPDATE classes SET teacher_id = $2 WHERE id = $1`, classID, newTeacherID); err != nil {
		t.Fatalf("reassign class teacher: %v", err)
	}
}

// ---------------------------------------------------------------------------
// AC9 — `shared` scopes to the CURRENT active enrollment of the question's class.
// ---------------------------------------------------------------------------

func TestQuestionVisibility_Shared_CurrentEnrollmentOnly_ATDD(t *testing.T) {
	db := SetupDB(t)
	center := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	TenantContext(t, db, center.ID)
	cID := qaUUIDFromPg(center.ID)

	author := qaSeedMember(t, db, cID, "vsh-author@example.com", "Author", "admin")
	ex := qaSeedExercise(t, db, cID, author)
	t1 := qaSeedMember(t, db, cID, "vsh-t1@example.com", "Teacher One", "teacher")
	c1 := qaSeedClassWithTeacher(t, db, cID, t1)
	otherTeacher := qaSeedMember(t, db, cID, "vsh-t2@example.com", "Teacher Two", "teacher")
	c2 := qaSeedClassWithTeacher(t, db, cID, otherTeacher)

	asker := qaSeedMember(t, db, cID, "vsh-asker@example.com", "Asker S1", "student")
	classmate := qaSeedMember(t, db, cID, "vsh-mate@example.com", "Classmate S3", "student")
	otherClassStudent := qaSeedMember(t, db, cID, "vsh-other@example.com", "Other S4", "student")
	transferredOut := qaSeedMember(t, db, cID, "vsh-gone@example.com", "Gone S5", "student")

	qaSeedActiveEnrollment(t, db, cID, asker, c1)
	qaSeedActiveEnrollment(t, db, cID, classmate, c1)
	qaSeedActiveEnrollment(t, db, cID, otherClassStudent, c2)
	qaSeedEnrollment(t, db, cID, transferredOut, c1, "withdrawn") // was in C1, now gone

	q1 := qaInsertQuestion(t, db, cID, ex, c1, asker, "item")
	sharedReply := qaInsertReply(t, db, cID, q1, t1, "shared")

	q := generated.New(db)
	see := func(reader uuid.UUID, role string) bool {
		rows, err := q.ListRepliesForReader(context.Background(), qaReplyParams(cID, q1, reader, role))
		if err != nil {
			t.Fatalf("ListRepliesForReader(%s): %v", role, err)
		}
		return qaRepliesHave(rows, sharedReply)
	}

	// positive controls
	if !see(asker, "student") {
		t.Errorf("asker S1 must see the shared reply (positive control)")
	}
	if !see(classmate, "student") {
		t.Errorf("active classmate S3 must see the shared reply (AC9 positive control)")
	}
	if !see(t1, "teacher") {
		t.Errorf("class teacher T1 must see their own shared reply")
	}
	// negatives
	if see(otherClassStudent, "student") {
		t.Errorf("R25 VIOLATION: a student in another class (C2) saw the shared reply")
	}
	if see(transferredOut, "student") {
		t.Errorf("AC9 VIOLATION: a student withdrawn from C1 still saw the shared reply (must scope by CURRENT active enrollment)")
	}
}

// ---------------------------------------------------------------------------
// AC10 — `personal` reaches only the asker + the replying teacher (author),
// independent of who currently teaches the class.
// ---------------------------------------------------------------------------

func TestQuestionVisibility_Personal_AskerAndAuthorOnly_ATDD(t *testing.T) {
	db := SetupDB(t)
	center := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	TenantContext(t, db, center.ID)
	cID := qaUUIDFromPg(center.ID)

	author := qaSeedMember(t, db, cID, "vp-author@example.com", "Author", "admin")
	ex := qaSeedExercise(t, db, cID, author)
	t1 := qaSeedMember(t, db, cID, "vp-t1@example.com", "Teacher One", "teacher")
	c1 := qaSeedClassWithTeacher(t, db, cID, t1)

	asker := qaSeedMember(t, db, cID, "vp-asker@example.com", "Asker S1", "student")
	classmate := qaSeedMember(t, db, cID, "vp-mate@example.com", "Classmate S3", "student")
	qaSeedActiveEnrollment(t, db, cID, asker, c1)
	qaSeedActiveEnrollment(t, db, cID, classmate, c1)

	q1 := qaInsertQuestion(t, db, cID, ex, c1, asker, "item")
	personalReply := qaInsertReply(t, db, cID, q1, t1, "personal") // T1 authored it

	q := generated.New(db)
	see := func(reader uuid.UUID, role string) bool {
		rows, err := q.ListRepliesForReader(context.Background(), qaReplyParams(cID, q1, reader, role))
		if err != nil {
			t.Fatalf("ListRepliesForReader(%s): %v", role, err)
		}
		return qaRepliesHave(rows, personalReply)
	}

	// positive controls: asker + author see it
	if !see(asker, "student") {
		t.Errorf("asker S1 must see the personal reply (positive control)")
	}
	if !see(t1, "teacher") {
		t.Errorf("replying teacher T1 (author) must see the personal reply (positive control)")
	}
	// negative: an active classmate (who WOULD see a shared reply) must NOT see personal
	if see(classmate, "student") {
		t.Errorf("AC10 VIOLATION: an active classmate saw a PERSONAL reply (personal ≠ shared)")
	}

	// ★ per-thread author binding independent of current class-teacher:
	// reassign C1 to a new teacher T1b. T1b now teaches C1 (would see a shared
	// reply) but is NOT the author → must NOT see this personal reply. The
	// original author T1 still sees it.
	t1b := qaSeedMember(t, db, cID, "vp-t1b@example.com", "Teacher One-B", "teacher")
	qaReassignClassTeacher(t, db, c1, t1b)

	if see(t1b, "teacher") {
		t.Errorf("AC10 VIOLATION: the reassigned class teacher T1b (not the author) saw a PERSONAL reply")
	}
	if !see(t1, "teacher") {
		t.Errorf("author binding VIOLATION: original author T1 lost visibility of their own personal reply after class reassignment")
	}
}
