// Story 7.4a — QuestionService green-phase coverage (service-direct, real DB in a
// rolled-back tx). Complements the WF-8 authz reds (question_authz_atdd_test.go)
// with the ask-path gates (AC4/AC5), anchor validation (AC4), batch all-or-nothing
// atomicity (AC12), and resolve-drops-from-unanswered (AC11). Reuses the qaSvc*
// helpers + isNotFound/isForbidden from the same package.
package service_test

import (
	"context"
	"errors"
	"testing"

	"github.com/ducdo/classlite-api/internal/model"
	"github.com/ducdo/classlite-api/internal/service"
	"github.com/ducdo/classlite-api/internal/test"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

func isValidation(err error) bool {
	var ve model.ValidationError
	return errors.As(err, &ve)
}

// qaSvcInsertAssignment seeds an assignment bridging an exercise + class (the D3
// derivation source). deadline_at is required.
func qaSvcInsertAssignment(t *testing.T, db *test.TxDB, centerID, exerciseID, classID uuid.UUID) uuid.UUID {
	t.Helper()
	id := uuid.New()
	if _, err := db.Exec(context.Background(),
		`INSERT INTO assignments (id, center_id, exercise_id, class_id, deadline_at)
		 VALUES ($1, $2, $3, $4, now() + interval '7 days')`,
		id, centerID, exerciseID, classID); err != nil {
		t.Fatalf("seed assignment: %v", err)
	}
	return id
}

// qaSvcInsertSubmission seeds the student's attempt (submission) on an assignment.
func qaSvcInsertSubmission(t *testing.T, db *test.TxDB, centerID, assignmentID, studentID uuid.UUID) {
	t.Helper()
	if _, err := db.Exec(context.Background(),
		`INSERT INTO submissions (id, center_id, assignment_id, student_id) VALUES ($1, $2, $3, $4)`,
		uuid.New(), centerID, assignmentID, studentID); err != nil {
		t.Fatalf("seed submission: %v", err)
	}
}

func qaItemAnchor() *service.QuestionAnchor {
	gi, qi := 0, 0
	return &service.QuestionAnchor{SectionIndex: 0, QuestionGroupIndex: &gi, QuestionIndex: &qi}
}

// qaAskEnv seeds a center with class C1 (teacher T1), student S1 enrolled +
// holding an attempt on an assignment. Returns the actors + assignment.
type qaAskEnv struct {
	centerPg     pgtype.UUID
	center       model.TenantContext
	studentTC    model.TenantContext
	assignmentID uuid.UUID
	classID      uuid.UUID
}

func qaSeedAskEnv(t *testing.T, db *test.TxDB) qaAskEnv {
	t.Helper()
	c := test.CreateCenterWithID(t, db, test.TenantAID, "Center A", "center-a")
	test.TenantContext(t, db, c.ID)
	cID := uuid.UUID(c.ID.Bytes)

	author := test.CreateUser(t, db, "ask-author-"+uuid.NewString()[:8]+"@example.com", "Author")
	test.CreateCenterMember(t, db, author.ID, c.ID, "admin")
	ex := qaSvcInsertExercise(t, db, cID, uuid.UUID(author.ID.Bytes))

	teacher := test.CreateUser(t, db, "ask-t1-"+uuid.NewString()[:8]+"@example.com", "Teacher One")
	test.CreateCenterMember(t, db, teacher.ID, c.ID, "teacher")
	class := qaSvcInsertClass(t, db, cID, uuid.UUID(teacher.ID.Bytes))

	student := test.CreateUser(t, db, "ask-s1-"+uuid.NewString()[:8]+"@example.com", "Student One")
	test.CreateCenterMember(t, db, student.ID, c.ID, "student")
	s1 := uuid.UUID(student.ID.Bytes)
	qaSvcInsertActiveEnrollment(t, db, cID, s1, class)

	asg := qaSvcInsertAssignment(t, db, cID, ex, class)
	qaSvcInsertSubmission(t, db, cID, asg, s1)

	return qaAskEnv{
		centerPg:     c.ID,
		center:       qaSvcTC(c.ID, uuid.UUID(author.ID.Bytes), "admin"),
		studentTC:    qaSvcTC(c.ID, s1, "student"),
		assignmentID: asg,
		classID:      class,
	}
}

// qaSvcScope seeds a two-teacher, two-student center (service_test variant of the
// package-test qaScopeGraph): teacherT1→classC1←studentS1 asks q1; teacherT2→
// classC2←studentS2 asks q2. All actors are DB members with the right role.
type qaSvcScope struct {
	teacherT1, studentS1 uuid.UUID
	teacherT2, studentS2 uuid.UUID
	classC1, classC2     uuid.UUID
	exercise             uuid.UUID
	q1, q2               uuid.UUID
}

func qaScopeGraphSvc(t *testing.T, db *test.TxDB, centerPg pgtype.UUID) qaSvcScope {
	t.Helper()
	cID := uuid.UUID(centerPg.Bytes)

	author := test.CreateUser(t, db, "sc-author-"+uuid.NewString()[:8]+"@example.com", "Author")
	test.CreateCenterMember(t, db, author.ID, centerPg, "admin")
	ex := qaSvcInsertExercise(t, db, cID, uuid.UUID(author.ID.Bytes))

	mkTeacher := func(tag string) uuid.UUID {
		u := test.CreateUser(t, db, "sc-"+tag+"-"+uuid.NewString()[:8]+"@example.com", "Teacher "+tag)
		test.CreateCenterMember(t, db, u.ID, centerPg, "teacher")
		return uuid.UUID(u.ID.Bytes)
	}
	mkStudent := func(tag string) uuid.UUID {
		u := test.CreateUser(t, db, "sc-"+tag+"-"+uuid.NewString()[:8]+"@example.com", "Student "+tag)
		test.CreateCenterMember(t, db, u.ID, centerPg, "student")
		return uuid.UUID(u.ID.Bytes)
	}

	t1, t2 := mkTeacher("t1"), mkTeacher("t2")
	c1 := qaSvcInsertClass(t, db, cID, t1)
	c2 := qaSvcInsertClass(t, db, cID, t2)
	s1, s2 := mkStudent("s1"), mkStudent("s2")
	qaSvcInsertActiveEnrollment(t, db, cID, s1, c1)
	qaSvcInsertActiveEnrollment(t, db, cID, s2, c2)

	q1 := qaSvcInsertQuestion(t, db, cID, ex, c1, s1)
	q2 := qaSvcInsertQuestion(t, db, cID, ex, c2, s2)
	return qaSvcScope{t1, s1, t2, s2, c1, c2, ex, q1, q2}
}

// AC4 — the happy path: an enrolled student who owns the attempt asks.
func TestQuestionAsk_Student_Enrolled_OwnsAttempt_Succeeds(t *testing.T) {
	db := test.SetupDB(t)
	svc := qaNewQuestionService(db)
	env := qaSeedAskEnv(t, db)

	excerpt := "the wisdom of crowds"
	q, err := svc.Ask(context.Background(), env.studentTC, service.AskInput{
		AssignmentID:  env.assignmentID,
		AnchorType:    "item",
		AnchorRef:     qaItemAnchor(),
		AnchorExcerpt: &excerpt,
		Content:       "Why is the answer B?",
	})
	if err != nil {
		t.Fatalf("ask must succeed for an enrolled attempt owner: %v", err)
	}
	if q.Status != "open" {
		t.Errorf("new question status = %q, want open", q.Status)
	}
	if q.ClassID != env.classID.String() {
		t.Errorf("class_id = %q, want %q (derived from the assignment, D3)", q.ClassID, env.classID.String())
	}
	if q.AnchorRef == nil || q.AnchorRef.SchemaVersion != 1 {
		t.Errorf("anchor_ref must round-trip with schemaVersion=1, got %+v", q.AnchorRef)
	}
}

// AC5 — a non-student caller (here the admin) → 403 INSUFFICIENT_ROLE.
func TestQuestionAsk_NonStudent_403(t *testing.T) {
	db := test.SetupDB(t)
	svc := qaNewQuestionService(db)
	env := qaSeedAskEnv(t, db)

	_, err := svc.Ask(context.Background(), env.center, service.AskInput{
		AssignmentID: env.assignmentID,
		AnchorType:   "exercise",
		Content:      "admin cannot ask",
	})
	if !isForbidden(err) {
		t.Errorf("non-student ask: want ForbiddenError (INSUFFICIENT_ROLE), got %T: %v", err, err)
	}
}

// AC5 — a student who does NOT own an attempt → 404 QUESTION_TARGET_NOT_FOUND.
func TestQuestionAsk_NotAttemptOwner_404Target(t *testing.T) {
	db := test.SetupDB(t)
	svc := qaNewQuestionService(db)
	env := qaSeedAskEnv(t, db)

	// A second enrolled student with NO submission on the assignment.
	other := test.CreateUser(t, db, "ask-s2-"+uuid.NewString()[:8]+"@example.com", "Student Two")
	test.CreateCenterMember(t, db, other.ID, env.centerPg, "student")
	cID := uuid.UUID(env.centerPg.Bytes)
	qaSvcInsertActiveEnrollment(t, db, cID, uuid.UUID(other.ID.Bytes), env.classID)
	otherTC := qaSvcTC(env.centerPg, uuid.UUID(other.ID.Bytes), "student")

	_, err := svc.Ask(context.Background(), otherTC, service.AskInput{
		AssignmentID: env.assignmentID,
		AnchorType:   "exercise",
		Content:      "I never started this attempt",
	})
	if !isNotFound(err) {
		t.Errorf("non-owner ask: want NotFoundError (QUESTION_TARGET_NOT_FOUND), got %T: %v", err, err)
	}
}

// AC4 — anchor validation: item requires a ref; exercise forbids a ref.
func TestQuestionAsk_AnchorValidation_422(t *testing.T) {
	db := test.SetupDB(t)
	svc := qaNewQuestionService(db)
	env := qaSeedAskEnv(t, db)

	if _, err := svc.Ask(context.Background(), env.studentTC, service.AskInput{
		AssignmentID: env.assignmentID, AnchorType: "item", AnchorRef: nil, Content: "missing ref",
	}); !isValidation(err) {
		t.Errorf("item anchor without a ref: want ValidationError, got %T: %v", err, err)
	}
	if _, err := svc.Ask(context.Background(), env.studentTC, service.AskInput{
		AssignmentID: env.assignmentID, AnchorType: "exercise", AnchorRef: qaItemAnchor(), Content: "ref on exercise",
	}); !isValidation(err) {
		t.Errorf("exercise anchor WITH a ref: want ValidationError, got %T: %v", err, err)
	}
}

// AC12 — batch reply is all-or-nothing: if the teacher does not teach ONE listed
// question's class, the whole request fails with zero writes.
func TestQuestionBatchReply_AllOrNothing(t *testing.T) {
	db := test.SetupDB(t)
	svc := qaNewQuestionService(db)
	center := test.CreateCenterWithID(t, db, test.TenantAID, "Center A", "center-a")
	test.TenantContext(t, db, center.ID)

	g := qaScopeGraphSvc(t, db, center.ID) // t1→c1→q1, t2→c2→q2
	// teacher T1 teaches c1 (q1) but NOT c2 (q2) → batch of both must fail wholesale.
	t1TC := qaSvcTC(center.ID, g.teacherT1, "teacher")
	_, err := svc.BatchReply(context.Background(), t1TC, []uuid.UUID{g.q1, g.q2}, service.ReplyInput{
		Content: "batch", Visibility: "shared", Resolve: true,
	})
	if !isNotFound(err) {
		t.Fatalf("batch touching an un-taught question: want NotFoundError, got %T: %v", err, err)
	}
	// Zero writes: q1 got no reply and stayed open.
	if n := qaCountReplies(t, db, g.q1); n != 0 {
		t.Errorf("partial write leaked: q1 has %d replies after a failed batch, want 0", n)
	}
	if qaSvcQuestionStatus(t, db, g.q1) != "open" {
		t.Errorf("partial write leaked: q1 was resolved by a failed batch")
	}
}

// AC12 — batch succeeds when the teacher teaches every listed question's class.
func TestQuestionBatchReply_AllTaught_Succeeds(t *testing.T) {
	db := test.SetupDB(t)
	svc := qaNewQuestionService(db)
	center := test.CreateCenterWithID(t, db, test.TenantAID, "Center A", "center-a")
	test.TenantContext(t, db, center.ID)

	g := qaScopeGraphSvc(t, db, center.ID)
	// Give T1 a SECOND question on their own class c1.
	q1b := qaSvcInsertQuestion(t, db, uuid.UUID(center.ID.Bytes), g.exercise, g.classC1, g.studentS1)
	t1TC := qaSvcTC(center.ID, g.teacherT1, "teacher")

	replies, err := svc.BatchReply(context.Background(), t1TC, []uuid.UUID{g.q1, q1b}, service.ReplyInput{
		Content: "batch", Visibility: "shared", Resolve: true,
	})
	if err != nil {
		t.Fatalf("batch over own-class questions must succeed: %v", err)
	}
	if len(replies) != 2 {
		t.Errorf("batch replies = %d, want 2", len(replies))
	}
	if qaSvcQuestionStatus(t, db, g.q1) != "resolved" || qaSvcQuestionStatus(t, db, q1b) != "resolved" {
		t.Errorf("resolve=true must resolve every batched question")
	}
}

// AC11 — a resolved question is excluded from ?unanswered=true.
func TestQuestionList_UnansweredExcludesResolved(t *testing.T) {
	db := test.SetupDB(t)
	svc := qaNewQuestionService(db)
	center := test.CreateCenterWithID(t, db, test.TenantAID, "Center A", "center-a")
	test.TenantContext(t, db, center.ID)

	g := qaScopeGraphSvc(t, db, center.ID)
	t1TC := qaSvcTC(center.ID, g.teacherT1, "teacher")

	// Before resolve: teacher T1 sees q1 in the unanswered list.
	openList, _, err := svc.List(context.Background(), t1TC, service.QuestionListFilter{Unanswered: true})
	if err != nil {
		t.Fatalf("list unanswered: %v", err)
	}
	if !qaListHas(openList, g.q1) {
		t.Fatalf("q1 must appear in the unanswered list before resolve (positive control)")
	}

	if err := svc.Resolve(context.Background(), t1TC, g.q1); err != nil {
		t.Fatalf("resolve: %v", err)
	}
	resolvedList, _, err := svc.List(context.Background(), t1TC, service.QuestionListFilter{Unanswered: true})
	if err != nil {
		t.Fatalf("list unanswered after resolve: %v", err)
	}
	if qaListHas(resolvedList, g.q1) {
		t.Errorf("AC11 VIOLATION: a resolved question still appears in ?unanswered=true")
	}
}

func qaListHas(rows []service.Question, id uuid.UUID) bool {
	for _, r := range rows {
		if r.ID == id.String() {
			return true
		}
	}
	return false
}

func qaCountReplies(t *testing.T, db *test.TxDB, questionID uuid.UUID) int {
	t.Helper()
	var n int
	if err := db.QueryRow(context.Background(),
		"SELECT count(*) FROM question_replies WHERE question_id = $1", questionID).Scan(&n); err != nil {
		t.Fatalf("count replies: %v", err)
	}
	return n
}
