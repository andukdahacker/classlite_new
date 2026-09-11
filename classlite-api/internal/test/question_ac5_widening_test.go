// Story 7.4b Task 1 (AC5 · FU-7-4-E) — the GetQuestionForReader student-branch
// WIDENING. 7-4a scoped a student's single-thread read to their OWN questions
// only; 7-4b widens it so an actively-enrolled CLASSMATE of the asker can open a
// thread that carries at least one 'shared' reply (a shared answer reaches the
// class). The non-disclosure guarantee is preserved: a personal-only or
// unanswered thread STILL returns 0 rows (→ 404) to a non-asker classmate, and
// the asker + teacher paths are unchanged.
//
// Real DB in tx under FORCE RLS. Shared qa* helpers live in
// question_role_scope_atdd_test.go. ★ Murat house rule: every negative carries a
// positive control (an active classmate genuinely reaches the shared thread; the
// asker genuinely reaches their personal-only thread) so a zero is real scoping,
// not an empty result.
package test

import (
	"context"
	"errors"
	"testing"

	"github.com/ducdo/classlite-api/internal/store/generated"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

func qaSingleReaderParams(centerID, questionID, readerID uuid.UUID, role string) generated.GetQuestionForReaderParams {
	return generated.GetQuestionForReaderParams{
		CenterID:   qaPgUUID(centerID),
		QuestionID: qaPgUUID(questionID),
		ReaderID:   qaPgUUID(readerID),
		ReaderRole: role,
	}
}

// qaCanReadThread reports whether GetQuestionForReader returns the row (true) or
// elides it to ErrNoRows (false → the service maps 404 non-disclosure).
func qaCanReadThread(t *testing.T, db *TxDB, centerID, questionID, readerID uuid.UUID, role string) bool {
	t.Helper()
	q := generated.New(db)
	row, err := q.GetQuestionForReader(context.Background(), qaSingleReaderParams(centerID, questionID, readerID, role))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return false
		}
		t.Fatalf("GetQuestionForReader(%s): %v", role, err)
	}
	return qaUUIDFromPg(row.QuestionID) == questionID
}

// AC5 — a classmate with a CURRENT active enrollment reaches a thread that has a
// 'shared' reply; a personal-only / unanswered thread still 404s the classmate;
// the asker and teacher paths are unaffected by the widening.
func TestGetQuestionForReader_ClassmateSharedThread_Widening(t *testing.T) {
	db := SetupDB(t)
	center := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	TenantContext(t, db, center.ID)
	cID := qaUUIDFromPg(center.ID)

	author := qaSeedMember(t, db, cID, "w5-author@example.com", "Author", "admin")
	ex := qaSeedExercise(t, db, cID, author)
	t1 := qaSeedMember(t, db, cID, "w5-t1@example.com", "Teacher One", "teacher")
	c1 := qaSeedClassWithTeacher(t, db, cID, t1)
	otherTeacher := qaSeedMember(t, db, cID, "w5-t2@example.com", "Teacher Two", "teacher")
	c2 := qaSeedClassWithTeacher(t, db, cID, otherTeacher)

	asker := qaSeedMember(t, db, cID, "w5-asker@example.com", "Asker S1", "student")
	classmate := qaSeedMember(t, db, cID, "w5-mate@example.com", "Classmate S3", "student")
	otherClassStudent := qaSeedMember(t, db, cID, "w5-other@example.com", "Other S4", "student")
	transferredOut := qaSeedMember(t, db, cID, "w5-gone@example.com", "Gone S5", "student")

	qaSeedActiveEnrollment(t, db, cID, asker, c1)
	qaSeedActiveEnrollment(t, db, cID, classmate, c1)
	qaSeedActiveEnrollment(t, db, cID, otherClassStudent, c2)
	qaSeedEnrollment(t, db, cID, transferredOut, c1, "withdrawn")

	// A thread WITH a shared reply.
	shared := qaInsertQuestion(t, db, cID, ex, c1, asker, "item")
	qaInsertReply(t, db, cID, shared, t1, "shared")

	// A thread with only a PERSONAL reply (no shared).
	personalOnly := qaInsertQuestion(t, db, cID, ex, c1, asker, "item")
	qaInsertReply(t, db, cID, personalOnly, t1, "personal")

	// An UNANSWERED thread (no replies at all).
	unanswered := qaInsertQuestion(t, db, cID, ex, c1, asker, "item")

	// --- shared thread ---
	// positive controls: asker + teacher always reach their own thread.
	if !qaCanReadThread(t, db, cID, shared, asker, "student") {
		t.Errorf("asker S1 must reach their own shared thread (positive control)")
	}
	if !qaCanReadThread(t, db, cID, shared, t1, "teacher") {
		t.Errorf("class teacher T1 must reach the shared thread (positive control)")
	}
	// AC5 widening: an active classmate reaches the shared thread.
	if !qaCanReadThread(t, db, cID, shared, classmate, "student") {
		t.Errorf("AC5 VIOLATION: an active classmate could NOT reach a thread with a shared reply")
	}
	// negatives on the shared thread.
	if qaCanReadThread(t, db, cID, shared, otherClassStudent, "student") {
		t.Errorf("R25 VIOLATION: a student enrolled only in another class (C2) reached the shared thread")
	}
	if qaCanReadThread(t, db, cID, shared, transferredOut, "student") {
		t.Errorf("AC5 VIOLATION: a student withdrawn from C1 still reached the shared thread (must scope by CURRENT active enrollment)")
	}

	// --- personal-only thread — classmate still 404s (non-disclosure) ---
	if !qaCanReadThread(t, db, cID, personalOnly, asker, "student") {
		t.Errorf("asker S1 must reach their own personal-only thread (positive control)")
	}
	if qaCanReadThread(t, db, cID, personalOnly, classmate, "student") {
		t.Errorf("AC5 VIOLATION: an active classmate reached a PERSONAL-ONLY thread (only shared answers reach the class)")
	}

	// --- unanswered thread — classmate still 404s ---
	if !qaCanReadThread(t, db, cID, unanswered, asker, "student") {
		t.Errorf("asker S1 must reach their own unanswered thread (positive control)")
	}
	if qaCanReadThread(t, db, cID, unanswered, classmate, "student") {
		t.Errorf("AC5 VIOLATION: an active classmate reached an UNANSWERED thread (nothing shared to reach the class)")
	}

	// owner/admin still elide entirely (R25/R26 unchanged by the widening).
	owner := qaSeedMember(t, db, cID, "w5-owner@example.com", "Owner", "owner")
	if qaCanReadThread(t, db, cID, shared, owner, "owner") {
		t.Errorf("R25/R26 VIOLATION: an owner reached a Q&A thread")
	}
}

// The widening enriches the read shape too (D5): the asker's display name +
// avatar are denormalized onto the row via LEFT JOIN users.
func TestGetQuestionForReader_EnrichesStudentDisplayFields(t *testing.T) {
	db := SetupDB(t)
	center := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	TenantContext(t, db, center.ID)
	cID := qaUUIDFromPg(center.ID)

	author := qaSeedMember(t, db, cID, "en-author@example.com", "Author", "admin")
	ex := qaSeedExercise(t, db, cID, author)
	t1 := qaSeedMember(t, db, cID, "en-t1@example.com", "Teacher One", "teacher")
	c1 := qaSeedClassWithTeacher(t, db, cID, t1)
	asker := qaSeedMember(t, db, cID, "en-asker@example.com", "Asker S1", "student")
	qaSeedActiveEnrollment(t, db, cID, asker, c1)
	q1 := qaInsertQuestion(t, db, cID, ex, c1, asker, "item")

	q := generated.New(db)
	row, err := q.GetQuestionForReader(context.Background(), qaSingleReaderParams(cID, q1, asker, "student"))
	if err != nil {
		t.Fatalf("GetQuestionForReader: %v", err)
	}
	if !row.StudentName.Valid || row.StudentName.String != "Asker S1" {
		t.Errorf("expected denormalized studentName 'Asker S1', got valid=%v value=%q", row.StudentName.Valid, row.StudentName.String)
	}
}
