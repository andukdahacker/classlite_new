// GREEN (de-tagged 2026-09-10, Story 7.4a dev): NewQuestionService /
// (*QuestionService).Reply / .Resolve + ReplyInput shipped in question_service.go
// with the SEC-1 DB-role re-validation (authorizeTeacherOfQuestion). FIND-1 ruled
// by Ducdo: student reply → 403 INSUFFICIENT_ROLE (owner/admin/non-teaching-teacher
// → 404 QUESTION_NOT_FOUND). See the GREEN SEAMS block below. Folded into the suite.
//
// Story 7.4a (AC8/AC11/AC13 · R15-style SEC-1 + FR-46 authz · risk=7 · WF-8 HARD
// GATE) — the Q&A REPLY/RESOLVE authorization at the SERVICE seam (service-direct,
// real DB). The headline is the ★ SEC-1 gate: reply/resolve are teacher-of-the-
// question's-class only, re-validated from the DB `center_members.role`, NOT the
// JWT `tc.Role` — so a hand-built TenantContext{Role:"teacher"} over a DB member
// row that is 'student' (a demoted teacher on a stale 15-min token) must be
// rejected even when that user is still the class's teacher_id.
//
// Owner/Admin and non-teaching teachers get 404 QUESTION_NOT_FOUND (non-
// disclosure) — a handler-only test can't reach the service's DB re-fetch, so we
// call the service directly (the staff_service_atdd_test.go E16 pattern).
//
// package service_test. Reuses isForbidden / isNotFound from staff_service_atdd_test.go.
//
// RED (`//go:build atdd_red_phase`): compile-fails on the greenfield service seam —
// service.NewQuestionService / service.ReplyInput / (*service.QuestionService).Reply
// / .Resolve.
//
// GREEN SEAMS (dev — Task 5 question_service.go):
//
//	NewQuestionService(db AuthDB, clk clock.Clock, events *event.Bus) *QuestionService
//	  (nil-tolerant events; NO emailQueue — D4 event-only notify)
//	(*QuestionService).Reply(ctx, tc model.TenantContext, questionID uuid.UUID, in ReplyInput) (*QuestionReply, error)
//	  ReplyInput{ Content string; Visibility string /* 'personal'|'shared' */; Resolve bool }
//	  authz: teacher-of-q.class_id gate re-validated from DB center_members.role (SEC-1).
//	    student → rejected (FIND-1: 403 INSUFFICIENT_ROLE or 404 — Ducdo decides at green);
//	    owner|admin|non-teaching-teacher → *model.NotFoundError{Code:"QUESTION_NOT_FOUND"};
//	  Resolve=true flips questions.status open→resolved in the same tx.
//	(*QuestionService).Resolve(ctx, tc, questionID uuid.UUID) error   // same authz; one-way open→resolved
package service_test

import (
	"context"
	"testing"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/model"
	"github.com/ducdo/classlite-api/internal/service"
	"github.com/ducdo/classlite-api/internal/test"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

func qaNewQuestionService(db *test.TxDB) *service.QuestionService {
	return service.NewQuestionService(db, clock.RealClock{}, nil)
}

func qaSvcTC(centerID pgtype.UUID, userID uuid.UUID, role string) model.TenantContext {
	return model.TenantContext{
		CenterID: uuid.UUID(centerID.Bytes).String(),
		UserID:   userID.String(),
		Role:     role,
	}
}

func qaSvcInsertExercise(t *testing.T, db *test.TxDB, centerID, createdBy uuid.UUID) uuid.UUID {
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

func qaSvcInsertClass(t *testing.T, db *test.TxDB, centerID, teacherID uuid.UUID) uuid.UUID {
	t.Helper()
	id := uuid.New()
	if _, err := db.Exec(context.Background(),
		`INSERT INTO classes (id, center_id, name, target_band, primary_skill, session_count, status, start_date, teacher_id)
		 VALUES ($1, $2, 'QA Class', 6.5, 'writing', 12, 'active', current_date, $3)`,
		id, centerID, teacherID); err != nil {
		t.Fatalf("seed class: %v", err)
	}
	return id
}

func qaSvcInsertActiveEnrollment(t *testing.T, db *test.TxDB, centerID, studentID, classID uuid.UUID) {
	t.Helper()
	if _, err := db.Exec(context.Background(),
		`INSERT INTO enrollments (id, center_id, student_id, class_id, status) VALUES ($1,$2,$3,$4,'active')`,
		uuid.New(), centerID, studentID, classID); err != nil {
		t.Fatalf("seed enrollment: %v", err)
	}
}

func qaSvcInsertQuestion(t *testing.T, db *test.TxDB, centerID, exerciseID, classID, studentID uuid.UUID) uuid.UUID {
	t.Helper()
	id := uuid.New()
	if _, err := db.Exec(context.Background(),
		`INSERT INTO questions
		   (id, center_id, exercise_id, class_id, student_id, anchor_type, anchor_ref, anchor_excerpt, content, status)
		 VALUES ($1,$2,$3,$4,$5,'item',
		   '{"schemaVersion":1,"sectionIndex":0,"questionGroupIndex":0,"questionIndex":0}'::jsonb,
		   'the wisdom of crowds', 'Why is the answer B?', 'open')`,
		id, centerID, exerciseID, classID, studentID); err != nil {
		t.Fatalf("insert question (is the create_questions migration applied?): %v", err)
	}
	return id
}

func qaSvcQuestionStatus(t *testing.T, db *test.TxDB, questionID uuid.UUID) string {
	t.Helper()
	var status string
	if err := db.QueryRow(context.Background(), "SELECT status FROM questions WHERE id = $1", questionID).Scan(&status); err != nil {
		t.Fatalf("read question status: %v", err)
	}
	return status
}

// qaSvcThread seeds a center with class C1 taught by teacherT1, student S1
// enrolled + asking Q1 on C1. Returns the actors.
type qaSvcGraph struct {
	center    pgtype.UUID
	teacherT1 uuid.UUID
	studentS1 uuid.UUID
	classC1   uuid.UUID
	question  uuid.UUID
}

func qaSvcThread(t *testing.T, db *test.TxDB) qaSvcGraph {
	t.Helper()
	c := test.CreateCenterWithID(t, db, test.TenantAID, "Center A", "center-a")
	test.TenantContext(t, db, c.ID)
	cID := uuid.UUID(c.ID.Bytes)

	author := test.CreateUser(t, db, "qas-author-"+uuid.NewString()[:8]+"@example.com", "Author")
	test.CreateCenterMember(t, db, author.ID, c.ID, "admin")
	ex := qaSvcInsertExercise(t, db, cID, uuid.UUID(author.ID.Bytes))

	teacher := test.CreateUser(t, db, "qas-t1-"+uuid.NewString()[:8]+"@example.com", "Teacher One")
	test.CreateCenterMember(t, db, teacher.ID, c.ID, "teacher")
	t1 := uuid.UUID(teacher.ID.Bytes)
	class := qaSvcInsertClass(t, db, cID, t1)

	student := test.CreateUser(t, db, "qas-s1-"+uuid.NewString()[:8]+"@example.com", "Student One")
	test.CreateCenterMember(t, db, student.ID, c.ID, "student")
	s1 := uuid.UUID(student.ID.Bytes)
	qaSvcInsertActiveEnrollment(t, db, cID, s1, class)

	q1 := qaSvcInsertQuestion(t, db, cID, ex, class, s1)
	return qaSvcGraph{c.ID, t1, s1, class, q1}
}

func qaReplyIn(resolve bool) service.ReplyInput {
	return service.ReplyInput{Content: "Look at the second paragraph.", Visibility: "shared", Resolve: resolve}
}

// ---------------------------------------------------------------------------
// AC8 — teacher-of-class happy path + "Send & resolve" (AC11).
// ---------------------------------------------------------------------------

func TestQuestionReply_TeacherOfClass_Succeeds_AndResolves_ATDD(t *testing.T) {
	db := test.SetupDB(t)
	svc := qaNewQuestionService(db)
	g := qaSvcThread(t, db)

	tc := qaSvcTC(g.center, g.teacherT1, "teacher")
	reply, err := svc.Reply(context.Background(), tc, g.question, qaReplyIn(true))
	if err != nil {
		t.Fatalf("class teacher Reply must succeed: %v", err)
	}
	if reply == nil {
		t.Fatalf("Reply returned nil reply on success")
	}
	if got := qaSvcQuestionStatus(t, db, g.question); got != "resolved" {
		t.Errorf("Send & resolve (AC11): question status = %q, want 'resolved'", got)
	}
}

// ---------------------------------------------------------------------------
// AC13 — ★ SEC-1: JWT says teacher, DB member row is 'student' (demoted). Even
// though this user is still the class's teacher_id, the DB role wins → rejected.
// ---------------------------------------------------------------------------

func TestQuestionReply_SEC1_JWTTeacherDBStudent_Rejected_ATDD(t *testing.T) {
	db := test.SetupDB(t)
	svc := qaNewQuestionService(db)

	c := test.CreateCenterWithID(t, db, test.TenantAID, "Center A", "center-a")
	test.TenantContext(t, db, c.ID)
	cID := uuid.UUID(c.ID.Bytes)

	author := test.CreateUser(t, db, "sec1-author@example.com", "Author")
	test.CreateCenterMember(t, db, author.ID, c.ID, "admin")
	ex := qaSvcInsertExercise(t, db, cID, uuid.UUID(author.ID.Bytes))

	// The demoted user: DB member role is 'student', yet they are the class teacher_id.
	demoted := test.CreateUser(t, db, "sec1-demoted@example.com", "Demoted Teacher")
	test.CreateCenterMember(t, db, demoted.ID, c.ID, "student")
	demotedID := uuid.UUID(demoted.ID.Bytes)
	class := qaSvcInsertClass(t, db, cID, demotedID)

	student := test.CreateUser(t, db, "sec1-student@example.com", "Student")
	test.CreateCenterMember(t, db, student.ID, c.ID, "student")
	s1 := uuid.UUID(student.ID.Bytes)
	qaSvcInsertActiveEnrollment(t, db, cID, s1, class)
	q1 := qaSvcInsertQuestion(t, db, cID, ex, class, s1)

	// Stale JWT claims teacher; the DB says student. DB must win.
	staleTC := qaSvcTC(c.ID, demotedID, "teacher")
	if _, err := svc.Reply(context.Background(), staleTC, q1, qaReplyIn(false)); err == nil {
		t.Errorf("SEC-1 VIOLATION: reply succeeded for a JWT-teacher whose DB role is 'student' — DB role must win")
	}
	if err := svc.Resolve(context.Background(), staleTC, q1); err == nil {
		t.Errorf("SEC-1 VIOLATION: resolve succeeded for a demoted (DB-student) caller on a stale teacher token")
	}
	// The question must remain open (no mutation slipped through).
	if got := qaSvcQuestionStatus(t, db, q1); got != "open" {
		t.Errorf("SEC-1 VIOLATION: question status changed to %q despite a rejected demoted caller", got)
	}
}

// ---------------------------------------------------------------------------
// AC8 — Owner/Admin reply → 404 QUESTION_NOT_FOUND (Q&A non-disclosure, R25).
// ---------------------------------------------------------------------------

func TestQuestionReply_OwnerAndAdmin_404NotFound_ATDD(t *testing.T) {
	db := test.SetupDB(t)
	svc := qaNewQuestionService(db)
	g := qaSvcThread(t, db)

	owner := test.CreateUser(t, db, "q-owner@example.com", "The Owner")
	test.CreateCenterMember(t, db, owner.ID, g.center, "owner")
	admin := test.CreateUser(t, db, "q-admin@example.com", "The Admin")
	test.CreateCenterMember(t, db, admin.ID, g.center, "admin")

	ownerTC := qaSvcTC(g.center, uuid.UUID(owner.ID.Bytes), "owner")
	if _, err := svc.Reply(context.Background(), ownerTC, g.question, qaReplyIn(false)); !isNotFound(err) {
		t.Errorf("Owner reply: want NotFoundError (QUESTION_NOT_FOUND, non-disclosure), got %T: %v", err, err)
	}
	adminTC := qaSvcTC(g.center, uuid.UUID(admin.ID.Bytes), "admin")
	if _, err := svc.Reply(context.Background(), adminTC, g.question, qaReplyIn(false)); !isNotFound(err) {
		t.Errorf("Admin reply: want NotFoundError (QUESTION_NOT_FOUND, non-disclosure), got %T: %v", err, err)
	}
}

// ---------------------------------------------------------------------------
// AC8 — a teacher who does NOT teach the question's class → 404 (non-disclosure).
// ---------------------------------------------------------------------------

func TestQuestionReply_NonTeachingTeacher_404NotFound_ATDD(t *testing.T) {
	db := test.SetupDB(t)
	svc := qaNewQuestionService(db)
	g := qaSvcThread(t, db)

	// A second teacher who teaches a DIFFERENT class — must not learn Q1 exists.
	otherTeacher := test.CreateUser(t, db, "q-otherteacher@example.com", "Other Teacher")
	test.CreateCenterMember(t, db, otherTeacher.ID, g.center, "teacher")
	otherID := uuid.UUID(otherTeacher.ID.Bytes)
	qaSvcInsertClass(t, db, uuid.UUID(g.center.Bytes), otherID) // their own class, not Q1's

	tc := qaSvcTC(g.center, otherID, "teacher")
	if _, err := svc.Reply(context.Background(), tc, g.question, qaReplyIn(false)); !isNotFound(err) {
		t.Errorf("non-teaching teacher reply: want NotFoundError (QUESTION_NOT_FOUND, non-disclosure), got %T: %v", err, err)
	}
}

// ---------------------------------------------------------------------------
// AC8 — a Student cannot reply. FIND-1: the exact code (403 INSUFFICIENT_ROLE vs
// 404 QUESTION_NOT_FOUND for the asking student) is a Ducdo ruling at green, so
// this asserts an authz rejection without pinning the code.
// ---------------------------------------------------------------------------

func TestQuestionReply_Student_RejectedAsAuthz_ATDD(t *testing.T) {
	db := test.SetupDB(t)
	svc := qaNewQuestionService(db)
	g := qaSvcThread(t, db)

	// The asking student themselves attempts to reply.
	tc := qaSvcTC(g.center, g.studentS1, "student")
	_, err := svc.Reply(context.Background(), tc, g.question, qaReplyIn(false))
	if err == nil {
		t.Fatalf("student reply must be rejected (replying is a teacher-only capability)")
	}
	if !isForbidden(err) && !isNotFound(err) {
		t.Errorf("student reply: want an authz rejection (ForbiddenError or NotFoundError), got %T: %v", err, err)
	}
	if got := qaSvcQuestionStatus(t, db, g.question); got != "open" {
		t.Errorf("a rejected student reply must not mutate the question (status=%q)", got)
	}
}
