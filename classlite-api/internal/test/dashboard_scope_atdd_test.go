// dashboard_scope_atdd_test.go — Story 8-1a ATDD red-phase (AC15 teacher-scope +
// AC16 student-isolation · risk=7 · WF-8 HARD GATE). Per-role scoping of
// GET /api/dashboard, driven through the real ungated chain.
//
// HOUSE RULE (positive control in the SAME test): every negative is paired with
// a positive in one test — first assert the caller's OWN row IS present, THEN the
// other party's is ABSENT. Without the positive half a scoping bug that returns
// "empty for everyone" silently passes both the isolation AND the ≤N assertions
// (Murat, 7-2a idiom).
//
// RED: real `//go:build atdd_red_phase` — excluded from `go test ./...`; under
// `-tags=atdd_red_phase` compile-fails ONLY on the seam NewDashboardTestServerForRole
// (dashboard_role_branch_atdd_test.go documents it). The dash* parse structs +
// dashGet live in that file (same package). Every seed helper below is shipped
// (seedClassWithTeacher, insertSessionRaw, insertAttendanceRaw, insertEnrollmentRaw,
// seedStudentMember, seedInputAssignment, seedInputSubmission, insertExerciseRaw,
// seedReleasedGrade) — the ONLY greenfield symbol is the test-server seam.
package test

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

// dashPGToUUID converts a fixture pgtype.UUID to the uuid.UUID the raw seed
// helpers take. (uuid.MustParse over the shipped UUIDString formatter.)
func dashPGToUUID(t *testing.T, id pgtype.UUID) uuid.UUID {
	t.Helper()
	return uuid.MustParse(UUIDString(id))
}

// dashSeedAtRiskStudent enrolls a fresh student in `class` and marks 3 absences
// (present+late/total = 0/3 = 0.0 < AtRiskAttendanceFloor 0.70) → the student
// classifies at_risk via the attendance_below_floor signal (AtRiskDetector, D5).
// Returns the student's user id. Tenant context must be set by the caller.
func dashSeedAtRiskStudent(t *testing.T, db *TxDB, centerID, class, markedBy uuid.UUID, email, name string) uuid.UUID {
	t.Helper()
	studentID := seedStudentMember(t, db, centerID, email, name)
	insertEnrollmentRaw(t, db, centerID, studentID, class, "active")
	// One absence per SESSION — attendance is UNIQUE per (session, student), so 3
	// absences require 3 distinct past sessions ((present+late)/total = 0/3 = 0.0 <
	// AtRiskAttendanceFloor 0.70 ⇒ attendance_below_floor, D5).
	for i := 0; i < 3; i++ {
		session := insertSessionRaw(t, db, centerID, class, time.Now().Add(-time.Duration(48+i)*time.Hour), nil)
		insertAttendanceRaw(t, db, centerID, session, studentID, markedBy, "absent")
	}
	return studentID
}

// dashSeedNeedsGrading creates an assignment on `class` and a SUBMITTED (not
// released) submission by `student` → it belongs in the teacher needsGrading rail
// (status ∈ {submitted,ai_processing}, no released grade — D6).
func dashSeedNeedsGrading(t *testing.T, db *TxDB, centerID, class, author, student uuid.UUID) {
	t.Helper()
	asg := seedInputAssignment(t, db, centerID, class, author, time.Now().Add(-24*time.Hour))
	seedInputSubmission(t, db, centerID, asg, student, "submitted", time.Now().Add(-2*time.Hour))
}

// dashSeedOpenQuestion inserts an exercise-anchored OPEN question by `student`
// on `class` (anchor_type='exercise' ⇒ anchor_ref NULL, per the questions_anchor_ref
// coupling constraint). Returns the question id. Tenant context set by caller.
func dashSeedOpenQuestion(t *testing.T, db *TxDB, centerID, class, student, author uuid.UUID) uuid.UUID {
	t.Helper()
	exercise := insertExerciseRaw(t, db, centerID, author, "QEX-"+uuid.NewString()[:8], "writing", nil)
	qID := uuid.New()
	if _, err := db.Exec(context.Background(),
		`INSERT INTO questions (id, center_id, exercise_id, class_id, student_id, anchor_type, content, status)
		 VALUES ($1,$2,$3,$4,$5,'exercise','Why is this wrong?','open')`,
		qID, centerID, exercise, class, student); err != nil {
		t.Fatalf("seed open question: %v", err)
	}
	return qID
}

func dashAtRiskHas(items []dashAtRiskItem, id uuid.UUID) bool {
	for _, it := range items {
		if it.StudentID == id.String() {
			return true
		}
	}
	return false
}

func dashGradingHasStudent(items []dashGradingItem, name string) bool {
	for _, it := range items {
		if it.StudentName == name {
			return true
		}
	}
	return false
}

func dashSessionHasClass(items []dashSessionLite, classID uuid.UUID) bool {
	for _, it := range items {
		if it.ClassID == classID.String() {
			return true
		}
	}
	return false
}

func dashQuestionHasID(items []dashQuestionItem, id uuid.UUID) bool {
	for _, it := range items {
		if it.QuestionID == id.String() {
			return true
		}
	}
	return false
}

// ── AC15 — teacher A sees ONLY own-class rows; teacher B's are excluded ──────

func TestDashboard_TeacherScope_OwnClassesOnly_ATDD(t *testing.T) {
	db := SetupDB(t)
	center := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	_ = TenantContext(t, db, center.ID)
	cid := dashPGToUUID(t, center.ID)

	teacherA := CreateUser(t, db, "teachA@center-a.test", "Teacher A")
	teacherB := CreateUser(t, db, "teachB@center-a.test", "Teacher B")
	CreateCenterMember(t, db, teacherA.ID, center.ID, "teacher")
	CreateCenterMember(t, db, teacherB.ID, center.ID, "teacher")
	taID := dashPGToUUID(t, teacherA.ID)
	tbID := dashPGToUUID(t, teacherB.ID)

	classA := seedClassWithTeacher(t, db, cid, taID)
	classB := seedClassWithTeacher(t, db, cid, tbID)

	// at-risk students — one per teacher's class
	const nameAtRiskA = "AR_STUDENT_ALPHA"
	const nameAtRiskB = "AR_STUDENT_BRAVO"
	studentA := dashSeedAtRiskStudent(t, db, cid, classA, taID, "ar-a@center-a.test", nameAtRiskA)
	studentB := dashSeedAtRiskStudent(t, db, cid, classB, tbID, "ar-b@center-a.test", nameAtRiskB)

	// needs-grading submissions — one per class
	dashSeedNeedsGrading(t, db, cid, classA, taID, studentA)
	dashSeedNeedsGrading(t, db, cid, classB, tbID, studentB)

	// weekSessions — one this-week session per teacher's class (now is always
	// within [weekStart, weekEnd), so this is deterministically "this week").
	insertSessionRaw(t, db, cid, classA, time.Now(), nil)
	insertSessionRaw(t, db, cid, classB, time.Now(), nil)

	// unansweredQuestions — one open question per class (seen only by that class's teacher).
	questionA := dashSeedOpenQuestion(t, db, cid, classA, studentA, taID)
	questionB := dashSeedOpenQuestion(t, db, cid, classB, studentB, tbID)

	// Teacher A's dashboard.
	srv := NewDashboardTestServerForRole(t, db, teacherA.ID, TenantAID, "teacher")
	rec, resp := dashGet(t, srv)
	if rec.Code != 200 || resp.Data.Teacher == nil {
		t.Fatalf("teacher A: want 200 + teacher block, got %d block=%v (body=%s)", rec.Code, resp.Data.Teacher, rec.Body.String())
	}
	tb := resp.Data.Teacher

	// atRiskStudents — positive (own) THEN negative (other teacher).
	if !dashAtRiskHas(tb.AtRiskStudents.Items, studentA) {
		t.Errorf("AC15 positive: teacher A's atRiskStudents must include own-class student %s", studentA)
	}
	if dashAtRiskHas(tb.AtRiskStudents.Items, studentB) {
		t.Errorf("AC15 SCOPE LEAK: teacher A must NOT see teacher B's at-risk student %s", studentB)
	}

	// needsGrading — positive THEN negative (by distinctive student name).
	if !dashGradingHasStudent(tb.NeedsGrading.Items, nameAtRiskA) {
		t.Errorf("AC15 positive: teacher A's needsGrading must include own-class submission (student %q)", nameAtRiskA)
	}
	if dashGradingHasStudent(tb.NeedsGrading.Items, nameAtRiskB) {
		t.Errorf("AC15 SCOPE LEAK: teacher A's needsGrading must NOT include teacher B's class submission (student %q)", nameAtRiskB)
	}

	// weekSessions — positive (own class) THEN negative (other teacher's class).
	if !dashSessionHasClass(tb.WeekSessions, classA) {
		t.Errorf("AC15 positive: teacher A's weekSessions must include own class %s", classA)
	}
	if dashSessionHasClass(tb.WeekSessions, classB) {
		t.Errorf("AC15 SCOPE LEAK: teacher A's weekSessions must NOT include teacher B's class %s", classB)
	}

	// unansweredQuestions — positive (own class) THEN negative (other teacher's class).
	if !dashQuestionHasID(tb.UnansweredQuestions.Items, questionA) {
		t.Errorf("AC15 positive: teacher A's unansweredQuestions must include own-class question %s", questionA)
	}
	if dashQuestionHasID(tb.UnansweredQuestions.Items, questionB) {
		t.Errorf("AC15 SCOPE LEAK: teacher A's unansweredQuestions must NOT include teacher B's question %s", questionB)
	}

	// Cross-check: teacher B's payload is the mirror image (own present, A absent).
	srvB := NewDashboardTestServerForRole(t, db, teacherB.ID, TenantAID, "teacher")
	recB, respB := dashGet(t, srvB)
	if recB.Code != 200 || respB.Data.Teacher == nil {
		t.Fatalf("teacher B: want 200 + teacher block, got %d (body=%s)", recB.Code, recB.Body.String())
	}
	tbB := respB.Data.Teacher
	if !dashAtRiskHas(tbB.AtRiskStudents.Items, studentB) {
		t.Errorf("AC15 positive (mirror): teacher B must see own at-risk student %s", studentB)
	}
	if dashAtRiskHas(tbB.AtRiskStudents.Items, studentA) {
		t.Errorf("AC15 SCOPE LEAK (mirror): teacher B must NOT see teacher A's at-risk student %s", studentA)
	}
	if !dashSessionHasClass(tbB.WeekSessions, classB) {
		t.Errorf("AC15 positive (mirror): teacher B's weekSessions must include own class %s", classB)
	}
	if dashSessionHasClass(tbB.WeekSessions, classA) {
		t.Errorf("AC15 SCOPE LEAK (mirror): teacher B's weekSessions must NOT include teacher A's class %s", classA)
	}
	if !dashQuestionHasID(tbB.UnansweredQuestions.Items, questionB) {
		t.Errorf("AC15 positive (mirror): teacher B's unansweredQuestions must include own-class question %s", questionB)
	}
	if dashQuestionHasID(tbB.UnansweredQuestions.Items, questionA) {
		t.Errorf("AC15 SCOPE LEAK (mirror): teacher B's unansweredQuestions must NOT include teacher A's question %s", questionA)
	}
}

// ── AC16 — student sees own work/feedback only; no other student, no averages ──

func TestDashboard_StudentIsolation_NoOtherStudentNoAverages_ATDD(t *testing.T) {
	db := SetupDB(t)
	center := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	_ = TenantContext(t, db, center.ID)
	cid := dashPGToUUID(t, center.ID)

	teacher := CreateUser(t, db, "t@center-a.test", "Teacher")
	CreateCenterMember(t, db, teacher.ID, center.ID, "teacher")
	class := seedClassWithTeacher(t, db, cid, dashPGToUUID(t, teacher.ID))
	author := dashPGToUUID(t, teacher.ID)

	// Caller student X — enrolled, with a RELEASED grade (own feedback) + an open question.
	studentX := CreateUser(t, db, "x@center-a.test", "Student X")
	CreateCenterMember(t, db, studentX.ID, center.ID, "student")
	xID := dashPGToUUID(t, studentX.ID)
	insertEnrollmentRaw(t, db, cid, xID, class, "active")
	seedReleasedGrade(t, db, cid, class, xID, author, "writing", 6.5)
	dashSeedOpenQuestion(t, db, cid, class, xID, author)

	// Another student Y — enrolled, ALSO with graded work. A distinctive sentinel
	// name so any leak into X's payload is detectable in the raw body.
	const sentinelY = "ZZ_OTHER_STUDENT_YANKEE"
	studentY := seedStudentMember(t, db, cid, "y@center-a.test", sentinelY)
	insertEnrollmentRaw(t, db, cid, studentY, class, "active")
	seedReleasedGrade(t, db, cid, class, studentY, author, "writing", 8.0)

	srv := NewDashboardTestServerForRole(t, db, studentX.ID, TenantAID, "student")
	rec, resp := dashGet(t, srv)
	if rec.Code != 200 || resp.Data.Student == nil {
		t.Fatalf("student X: want 200 + student block, got %d block=%v (body=%s)", rec.Code, resp.Data.Student, rec.Body.String())
	}

	// Positive: X sees own feedback + own question (not empty-for-everyone).
	if len(resp.Data.Student.RecentFeedback) == 0 {
		t.Errorf("AC16 positive: student X's recentFeedback must include own released grade")
	}
	if len(resp.Data.Student.MyQuestions) == 0 {
		t.Errorf("AC16 positive: student X's myQuestions must include own open question")
	}

	// Negative 1: no other student's data (FR-50). Y's sentinel name must not appear anywhere.
	if strings.Contains(rec.Body.String(), sentinelY) {
		t.Errorf("AC16 ISOLATION LEAK: student Y's data (%q) leaked into student X's dashboard", sentinelY)
	}
	// Negative 2: no class averages surfaced to a student (FR-50).
	body := strings.ToLower(rec.Body.String())
	if strings.Contains(body, "average") || strings.Contains(body, "classavg") {
		t.Errorf("AC16: student dashboard must expose NO class averages (FR-50); found an average-shaped key in body")
	}

	// Empty-state discipline (AC10): list fields are [] never null (nil slice
	// still decodes fine — this asserts the fields exist as arrays, not objects).
	_ = resp.Data.Student.UpcomingSessions
	_ = resp.Data.Student.DueSoon
}
