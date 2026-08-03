// Story 5.2a — student attempt-read ATDD (TEST-BE-3: real middleware chain, real
// service, real DB under RLS via the committed pool + signed bearer tokens).
// WF-8 (risk 7): the answer-leak golden test (AC11) is the BLOCKING gate — it
// asserts on the RAW serialized JSON body across all five question-group types.
// For every 0-rows / 404 assertion the caller's-nothing is proven (not another
// tenant's row).
//
// Covers: AC1-4 (enrollment-scoped list, ordering, submission summary, non-student
// 403, isolation), AC5-9 (bundle owner+enrolled 200, not-owner 404, withdrawn 403,
// closed/past-hard-deadline still 200), AC10-12 (answer strip, all types), AC13
// (cross-tenant id → 404).
package test

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

// --- answer-key sentinels: distinctive so a raw-body grep is unambiguous ---
const (
	sentinelCorrectAnswer = "ZZZ_CORRECT_ANSWER_KEY"
	sentinelVariant       = "ZZZ_ACCEPTED_VARIANT"
	sentinelOption        = "OPT_STUDENT_VISIBLE"
	sentinelPassage       = "PASSAGE_STUDENT_VISIBLE"
	sentinelPrompt        = "PROMPT_STUDENT_VISIBLE"
	sentinelQuestionText  = "QTEXT_STUDENT_VISIBLE"
)

// fullExerciseContentJSON is a content blob with all five group types, each
// carrying the correctAnswer/acceptedVariants sentinels, plus a prompt-only
// writing section (AC11,12).
func fullExerciseContentJSON() string {
	q := func(gtype string) string {
		return fmt.Sprintf(`{"text":"%s","type":"%s","options":["%s","B"],"correctAnswer":"%s","acceptedVariants":["%s"]}`,
			sentinelQuestionText, gtype, sentinelOption, sentinelCorrectAnswer, sentinelVariant)
	}
	group := func(gtype string) string {
		return fmt.Sprintf(`{"type":"%s","instructions":"do it","questions":[%s]}`, gtype, q(gtype))
	}
	groups := strings.Join([]string{
		group("multiple_choice"), group("true_false_not_given"), group("fill_in_blank"),
		group("short_answer"), group("matching"),
	}, ",")
	reading := fmt.Sprintf(`{"type":"reading","title":"R","content":"%s","questionGroups":[%s]}`, sentinelPassage, groups)
	writing := fmt.Sprintf(`{"type":"writing","title":"W","content":"%s","questionGroups":[]}`, sentinelPrompt)
	return fmt.Sprintf(`{"sections":[%s,%s],"settings":{"timeLimitEnabled":true,"timeLimitMinutes":60,"caseSensitive":false}}`, reading, writing)
}

// --- file-local superuser seeders (bypass RLS; explicit center_id) ---

func seedClass(t *testing.T, centerID, teacherID pgtype.UUID) uuid.UUID {
	t.Helper()
	sp := SuperuserPool(t)
	id := uuid.New()
	if _, err := sp.Exec(context.Background(),
		`INSERT INTO classes (id, center_id, name, status, teacher_id) VALUES ($1,$2,'C','active',$3)`,
		id, centerID, teacherID); err != nil {
		t.Fatalf("seed class: %v", err)
	}
	return id
}

func seedExercise(t *testing.T, centerID, creatorID pgtype.UUID, contentJSON string) uuid.UUID {
	t.Helper()
	sp := SuperuserPool(t)
	id := uuid.New()
	if _, err := sp.Exec(context.Background(),
		`INSERT INTO exercises (id, center_id, created_by, code, title, skill, content, schema_version)
		 VALUES ($1,$2,$3,$4,'Ex Title','reading',$5,1)`,
		id, centerID, creatorID, "EX-"+id.String()[:8], contentJSON); err != nil {
		t.Fatalf("seed exercise: %v", err)
	}
	return id
}

func seedAssignment(t *testing.T, centerID, exerciseID pgtype.UUID, classID uuid.UUID, creatorID pgtype.UUID, status string, deadline time.Time, hard *time.Time) uuid.UUID {
	t.Helper()
	sp := SuperuserPool(t)
	id := uuid.New()
	if _, err := sp.Exec(context.Background(),
		`INSERT INTO assignments (id, center_id, exercise_id, class_id, created_by, status, deadline_at, hard_deadline_at, late_penalty)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,1.5)`,
		id, centerID, exerciseID, classID, creatorID, status, deadline, hard); err != nil {
		t.Fatalf("seed assignment: %v", err)
	}
	return id
}

func seedEnrollment(t *testing.T, centerID, studentID pgtype.UUID, classID uuid.UUID, status string) {
	t.Helper()
	sp := SuperuserPool(t)
	if _, err := sp.Exec(context.Background(),
		`INSERT INTO enrollments (id, center_id, student_id, class_id, status) VALUES ($1,$2,$3,$4,$5)`,
		uuid.New(), centerID, studentID, classID, status); err != nil {
		t.Fatalf("seed enrollment: %v", err)
	}
}

func seedSubmission(t *testing.T, centerID, assignmentID pgtype.UUID, studentID pgtype.UUID, status, contentJSON string) uuid.UUID {
	t.Helper()
	sp := SuperuserPool(t)
	id := uuid.New()
	now := time.Now().UTC()
	if _, err := sp.Exec(context.Background(),
		`INSERT INTO submissions (id, center_id, assignment_id, student_id, status, content, schema_version, started_at, created_at, updated_at)
		 VALUES ($1,$2,$3,$4,$5,$6,1,$7,$7,$7)`,
		id, centerID, assignmentID, studentID, status, contentJSON, now); err != nil {
		t.Fatalf("seed submission: %v", err)
	}
	return id
}

// --- env: one center, owner + teacher + two students ---

type attemptEnv struct {
	srv        http.Handler
	centerID   pgtype.UUID
	ownerID    pgtype.UUID
	studentA   pgtype.UUID
	studentB   pgtype.UUID
	studentTok string // studentA's token
	studentBTk string
	ownerTok   string
	teacherTok string
	adminTok   string
}

// nonStudentTokens returns the three non-student role tokens the AC3/AC8 403 gate
// must reject (owner/teacher/admin), keyed by role for a table-driven assertion.
func (e attemptEnv) nonStudentTokens() map[string]string {
	return map[string]string{"owner": e.ownerTok, "teacher": e.teacherTok, "admin": e.adminTok}
}

func setupAttemptEnv(t *testing.T) attemptEnv {
	t.Helper()
	pool := SetupRawPool(t)
	sfx := uuid.NewString()[:8]

	owner := CreateUserOnPool(t, pool, "owner-"+sfx+"@example.com", "Owner")
	studentA := CreateUserOnPool(t, pool, "sa-"+sfx+"@example.com", "Student A")
	studentB := CreateUserOnPool(t, pool, "sb-"+sfx+"@example.com", "Student B")
	teacher := CreateUserOnPool(t, pool, "te-"+sfx+"@example.com", "Teacher")
	admin := CreateUserOnPool(t, pool, "ad-"+sfx+"@example.com", "Admin")
	for _, u := range []User{owner, studentA, studentB, teacher, admin} {
		MarkUserEmailVerifiedOnPool(t, pool, u.ID)
	}

	centerPg := CreateCenterForOwner(t, pool, owner.ID)
	centerID := UUIDString(centerPg)
	AddCenterMember(t, pool, centerPg, studentA.ID, "student")
	AddCenterMember(t, pool, centerPg, studentB.ID, "student")
	AddCenterMember(t, pool, centerPg, teacher.ID, "teacher")
	AddCenterMember(t, pool, centerPg, admin.ID, "admin")

	t.Cleanup(func() {
		sp := SuperuserPool(t)
		ctx := context.Background()
		_, _ = sp.Exec(ctx, `DELETE FROM submissions WHERE center_id = $1`, centerPg)
		_, _ = sp.Exec(ctx, `DELETE FROM assignments WHERE center_id = $1`, centerPg)
		_, _ = sp.Exec(ctx, `DELETE FROM enrollments WHERE center_id = $1`, centerPg)
		_, _ = sp.Exec(ctx, `DELETE FROM exercises WHERE center_id = $1`, centerPg)
		_, _ = sp.Exec(ctx, `DELETE FROM classes WHERE center_id = $1`, centerPg)
		_, _ = sp.Exec(ctx, `DELETE FROM center_members WHERE center_id = $1`, centerPg)
		_, _ = sp.Exec(ctx, `DELETE FROM centers WHERE id = $1`, centerPg)
		for _, u := range []User{owner, studentA, studentB, teacher, admin} {
			PurgeUserAndOwnedCenters(t, pool, u.ID)
		}
	})

	return attemptEnv{
		srv:        NewStudentAttemptTestServerBareMux(t, pool),
		centerID:   centerPg,
		ownerID:    owner.ID,
		studentA:   studentA.ID,
		studentB:   studentB.ID,
		studentTok: SignAccessTokenForRole(t, studentA.ID, centerID, "student"),
		studentBTk: SignAccessTokenForRole(t, studentB.ID, centerID, "student"),
		ownerTok:   SignAccessTokenForRole(t, owner.ID, centerID, "owner"),
		teacherTok: SignAccessTokenForRole(t, teacher.ID, centerID, "teacher"),
		adminTok:   SignAccessTokenForRole(t, admin.ID, centerID, "admin"),
	}
}

func attemptGet(t *testing.T, srv http.Handler, path, token string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, path, nil)
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, req)
	return rec
}

// ===================== C. Answer-strip — BLOCKING (AC10,11) =====================

func TestAttemptBundle_NeverLeaksAnswers_AllQuestionTypes(t *testing.T) {
	e := setupAttemptEnv(t)
	classX := seedClass(t, e.centerID, e.ownerID)
	seedEnrollment(t, e.centerID, e.studentA, classX, "active")
	ex := seedExercise(t, e.centerID, e.ownerID, fullExerciseContentJSON())
	aid := seedAssignment(t, e.centerID, pgFromGoUUID(ex), classX, e.ownerID, "open", time.Now().Add(24*time.Hour), nil)
	sid := seedSubmission(t, e.centerID, pgFromGoUUID(aid), e.studentA, "in_progress", `{"answers":{"1":"foo"}}`)

	rec := attemptGet(t, e.srv, "/api/submissions/"+sid.String()+"/attempt", e.studentTok)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body: %s)", rec.Code, rec.Body.String())
	}
	body := rec.Body.String()

	// BLOCKING: no answer key anywhere on the wire (keys AND values), across all types.
	for _, banned := range []string{"correctAnswer", "acceptedVariants", sentinelCorrectAnswer, sentinelVariant} {
		if strings.Contains(body, banned) {
			t.Errorf("AC11 VIOLATION: raw response body leaks %q\nbody: %s", banned, body)
		}
	}
	// Student-visible content IS carried.
	for _, want := range []string{"options", sentinelOption, sentinelPassage, sentinelPrompt, sentinelQuestionText} {
		if !strings.Contains(body, want) {
			t.Errorf("expected student-visible %q present in body, absent\nbody: %s", want, body)
		}
	}
	// Structural: all five groups round-tripped (5 in the reading section) + the
	// prompt-only writing section carried (empty questionGroups).
	var env struct {
		Data struct {
			Exercise struct {
				Sections []struct {
					Type           string `json:"type"`
					QuestionGroups []struct {
						Type string `json:"type"`
					} `json:"questionGroups"`
				} `json:"sections"`
			} `json:"exercise"`
		} `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(env.Data.Exercise.Sections) != 2 {
		t.Fatalf("sections = %d, want 2", len(env.Data.Exercise.Sections))
	}
	if got := len(env.Data.Exercise.Sections[0].QuestionGroups); got != 5 {
		t.Errorf("reading section groups = %d, want 5", got)
	}
	if env.Data.Exercise.Sections[1].Type != "writing" || len(env.Data.Exercise.Sections[1].QuestionGroups) != 0 {
		t.Errorf("prompt-only writing section not preserved: %+v", env.Data.Exercise.Sections[1])
	}
}

// ===================== B. Attempt bundle gates (AC5,8,9) =====================

func TestAttemptBundle_StillEnrolled_200(t *testing.T) {
	e := setupAttemptEnv(t)
	classX := seedClass(t, e.centerID, e.ownerID)
	seedEnrollment(t, e.centerID, e.studentA, classX, "active")
	ex := seedExercise(t, e.centerID, e.ownerID, minimalContentJSON())
	aid := seedAssignment(t, e.centerID, pgFromGoUUID(ex), classX, e.ownerID, "open", time.Now().Add(24*time.Hour), nil)
	sid := seedSubmission(t, e.centerID, pgFromGoUUID(aid), e.studentA, "in_progress", `{"answers":{}}`)

	rec := attemptGet(t, e.srv, "/api/submissions/"+sid.String()+"/attempt", e.studentTok)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body: %s)", rec.Code, rec.Body.String())
	}
}

func TestAttemptBundle_NotOwner_404(t *testing.T) {
	e := setupAttemptEnv(t)
	classX := seedClass(t, e.centerID, e.ownerID)
	// Both students enrolled in the same class so the ONLY thing that differs is
	// ownership — proves 404-not-owner, not 403-not-enrolled.
	seedEnrollment(t, e.centerID, e.studentA, classX, "active")
	seedEnrollment(t, e.centerID, e.studentB, classX, "active")
	ex := seedExercise(t, e.centerID, e.ownerID, minimalContentJSON())
	aid := seedAssignment(t, e.centerID, pgFromGoUUID(ex), classX, e.ownerID, "open", time.Now().Add(24*time.Hour), nil)
	sidA := seedSubmission(t, e.centerID, pgFromGoUUID(aid), e.studentA, "in_progress", `{"answers":{}}`)

	// Student B (enrolled, but not the owner of A's submission) → 404, not 403.
	rec := attemptGet(t, e.srv, "/api/submissions/"+sidA.String()+"/attempt", e.studentBTk)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404 (no cross-student oracle)", rec.Code)
	}
	assertErrorCode(t, rec, "SUBMISSION_NOT_FOUND")
}

func TestAttemptBundle_WithdrawnMidAttempt_403NotEnrolled(t *testing.T) {
	e := setupAttemptEnv(t)
	classX := seedClass(t, e.centerID, e.ownerID)
	// Withdrawn enrollment — the student owns the submission but is no longer active.
	seedEnrollment(t, e.centerID, e.studentA, classX, "withdrawn")
	ex := seedExercise(t, e.centerID, e.ownerID, minimalContentJSON())
	aid := seedAssignment(t, e.centerID, pgFromGoUUID(ex), classX, e.ownerID, "open", time.Now().Add(24*time.Hour), nil)
	sid := seedSubmission(t, e.centerID, pgFromGoUUID(aid), e.studentA, "in_progress", `{"answers":{}}`)

	rec := attemptGet(t, e.srv, "/api/submissions/"+sid.String()+"/attempt", e.studentTok)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403 (withdrawn mid-attempt)", rec.Code)
	}
	assertErrorCode(t, rec, "NOT_ENROLLED")
}

// AC9 / D6: read is NOT lock-gated — closed OR past hard deadline still 200.
func TestAttemptBundle_ClosedOrPastHardDeadline_Still200(t *testing.T) {
	e := setupAttemptEnv(t)
	classX := seedClass(t, e.centerID, e.ownerID)
	seedEnrollment(t, e.centerID, e.studentA, classX, "active")
	ex := seedExercise(t, e.centerID, e.ownerID, minimalContentJSON())

	past := time.Now().Add(-48 * time.Hour)
	pastHard := time.Now().Add(-24 * time.Hour)

	// (a) closed assignment.
	aClosed := seedAssignment(t, e.centerID, pgFromGoUUID(ex), classX, e.ownerID, "closed", past, nil)
	sClosed := seedSubmission(t, e.centerID, pgFromGoUUID(aClosed), e.studentA, "in_progress", `{"answers":{}}`)
	if rec := attemptGet(t, e.srv, "/api/submissions/"+sClosed.String()+"/attempt", e.studentTok); rec.Code != http.StatusOK {
		t.Fatalf("closed: status = %d, want 200 (D6 — read not lock-gated); body: %s", rec.Code, rec.Body.String())
	}

	// (b) open but past hard deadline.
	aHard := seedAssignment(t, e.centerID, pgFromGoUUID(ex), classX, e.ownerID, "open", past, &pastHard)
	sHard := seedSubmission(t, e.centerID, pgFromGoUUID(aHard), e.studentA, "in_progress", `{"answers":{}}`)
	rec := attemptGet(t, e.srv, "/api/submissions/"+sHard.String()+"/attempt", e.studentTok)
	if rec.Code != http.StatusOK {
		t.Fatalf("past-hard-deadline: status = %d, want 200 (D6); body: %s", rec.Code, rec.Body.String())
	}
	// submission.status + the deadline fields are present so the FE renders read-only.
	var env struct {
		Data struct {
			Submission struct {
				Status string `json:"status"`
			} `json:"submission"`
			Assignment struct {
				HardDeadlineAt *string `json:"hardDeadlineAt"`
			} `json:"assignment"`
		} `json:"data"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &env)
	if env.Data.Submission.Status != "in_progress" {
		t.Errorf("submission.status = %q, want in_progress (read-only render field)", env.Data.Submission.Status)
	}
	if env.Data.Assignment.HardDeadlineAt == nil {
		t.Error("assignment.hardDeadlineAt must be present for the read-only strip")
	}
}

// AC8: the bundle role gate rejects EVERY non-student role (owner/teacher/admin),
// not just owner — each → 403 INSUFFICIENT_ROLE.
func TestAttemptBundle_NonStudent_403(t *testing.T) {
	e := setupAttemptEnv(t)
	classX := seedClass(t, e.centerID, e.ownerID)
	seedEnrollment(t, e.centerID, e.studentA, classX, "active")
	ex := seedExercise(t, e.centerID, e.ownerID, minimalContentJSON())
	aid := seedAssignment(t, e.centerID, pgFromGoUUID(ex), classX, e.ownerID, "open", time.Now().Add(24*time.Hour), nil)
	sid := seedSubmission(t, e.centerID, pgFromGoUUID(aid), e.studentA, "in_progress", `{"answers":{}}`)

	for role, tok := range e.nonStudentTokens() {
		t.Run(role, func(t *testing.T) {
			rec := attemptGet(t, e.srv, "/api/submissions/"+sid.String()+"/attempt", tok)
			if rec.Code != http.StatusForbidden {
				t.Fatalf("%s: status = %d, want 403 (non-student)", role, rec.Code)
			}
			assertErrorCode(t, rec, "INSUFFICIENT_ROLE")
		})
	}
}

// AC13: a cross-tenant submission id → 404 (never another tenant's row).
func TestAttemptBundle_CrossTenant_404(t *testing.T) {
	e := setupAttemptEnv(t)

	// Tenant B: its own owner/student/class/exercise/assignment/submission.
	pool := SetupRawPool(t)
	sfx := uuid.NewString()[:8]
	ownerB := CreateUserOnPool(t, pool, "ownerb-"+sfx+"@example.com", "Owner B")
	studentBt := CreateUserOnPool(t, pool, "sbt-"+sfx+"@example.com", "Student Bt")
	MarkUserEmailVerifiedOnPool(t, pool, ownerB.ID)
	MarkUserEmailVerifiedOnPool(t, pool, studentBt.ID)
	centerBPg := CreateCenterForOwner(t, pool, ownerB.ID)
	AddCenterMember(t, pool, centerBPg, studentBt.ID, "student")
	classB := seedClass(t, centerBPg, ownerB.ID)
	seedEnrollment(t, centerBPg, studentBt.ID, classB, "active")
	exB := seedExercise(t, centerBPg, ownerB.ID, minimalContentJSON())
	aidB := seedAssignment(t, centerBPg, pgFromGoUUID(exB), classB, ownerB.ID, "open", time.Now().Add(24*time.Hour), nil)
	sidB := seedSubmission(t, centerBPg, pgFromGoUUID(aidB), studentBt.ID, "in_progress", `{"answers":{}}`)
	t.Cleanup(func() {
		sp := SuperuserPool(t)
		ctx := context.Background()
		_, _ = sp.Exec(ctx, `DELETE FROM submissions WHERE center_id = $1`, centerBPg)
		_, _ = sp.Exec(ctx, `DELETE FROM assignments WHERE center_id = $1`, centerBPg)
		_, _ = sp.Exec(ctx, `DELETE FROM enrollments WHERE center_id = $1`, centerBPg)
		_, _ = sp.Exec(ctx, `DELETE FROM exercises WHERE center_id = $1`, centerBPg)
		_, _ = sp.Exec(ctx, `DELETE FROM classes WHERE center_id = $1`, centerBPg)
		_, _ = sp.Exec(ctx, `DELETE FROM center_members WHERE center_id = $1`, centerBPg)
		_, _ = sp.Exec(ctx, `DELETE FROM centers WHERE id = $1`, centerBPg)
		PurgeUserAndOwnedCenters(t, pool, ownerB.ID)
		PurgeUserAndOwnedCenters(t, pool, studentBt.ID)
	})

	// Tenant A's student A asks for tenant B's submission id → RLS hides it → 404.
	rec := attemptGet(t, e.srv, "/api/submissions/"+sidB.String()+"/attempt", e.studentTok)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("cross-tenant: status = %d, want 404 (RLS hides tenant B's row)", rec.Code)
	}
	assertErrorCode(t, rec, "SUBMISSION_NOT_FOUND")
}

// ===================== A. Student assignment list (AC1-4) =====================

func TestListStudentAssignments_EnrollmentScoped(t *testing.T) {
	e := setupAttemptEnv(t)
	classX := seedClass(t, e.centerID, e.ownerID)
	classY := seedClass(t, e.centerID, e.ownerID)
	classW := seedClass(t, e.centerID, e.ownerID) // withdrawn from this one
	seedEnrollment(t, e.centerID, e.studentA, classX, "active")
	seedEnrollment(t, e.centerID, e.studentB, classY, "active") // B's class
	seedEnrollment(t, e.centerID, e.studentA, classW, "withdrawn")
	ex := seedExercise(t, e.centerID, e.ownerID, minimalContentJSON())

	// Two assignments in A's active class, out of deadline order, + one in B's class
	// + one in A's withdrawn class.
	soon := time.Now().Add(6 * time.Hour)
	later := time.Now().Add(48 * time.Hour)
	aLater := seedAssignment(t, e.centerID, pgFromGoUUID(ex), classX, e.ownerID, "open", later, nil)
	aSoon := seedAssignment(t, e.centerID, pgFromGoUUID(ex), classX, e.ownerID, "open", soon, nil)
	_ = seedAssignment(t, e.centerID, pgFromGoUUID(ex), classY, e.ownerID, "open", soon, nil) // B's — must be absent
	_ = seedAssignment(t, e.centerID, pgFromGoUUID(ex), classW, e.ownerID, "open", soon, nil) // withdrawn — absent
	// Start an attempt on the soon one so submissionStatus is set for that row only.
	seedSubmission(t, e.centerID, pgFromGoUUID(aSoon), e.studentA, "in_progress", `{"answers":{}}`)

	rec := attemptGet(t, e.srv, "/api/assignments", e.studentTok)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body: %s)", rec.Code, rec.Body.String())
	}
	var env struct {
		Data []struct {
			ID               string  `json:"id"`
			DeadlineAt       string  `json:"deadlineAt"`
			ExerciseTitle    string  `json:"exerciseTitle"`
			ExerciseSkill    string  `json:"exerciseSkill"`
			SubmissionID     *string `json:"submissionId"`
			SubmissionStatus *string `json:"submissionStatus"`
		} `json:"data"`
		Meta struct {
			Pagination struct {
				Total int `json:"total"`
			} `json:"pagination"`
		} `json:"meta"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
		t.Fatalf("decode: %v", err)
	}
	// Only A's two active-class assignments (B's class + withdrawn class absent).
	if len(env.Data) != 2 {
		t.Fatalf("rows = %d, want 2 (only A's active class); body: %s", len(env.Data), rec.Body.String())
	}
	if env.Meta.Pagination.Total != 2 {
		t.Errorf("total = %d, want 2", env.Meta.Pagination.Total)
	}
	// Ordered by deadline ASC: the soon one first.
	if env.Data[0].ID != aSoon.String() || env.Data[1].ID != aLater.String() {
		t.Errorf("ordering wrong: got [%s, %s], want [aSoon=%s, aLater=%s]", env.Data[0].ID, env.Data[1].ID, aSoon.String(), aLater.String())
	}
	// Row shape: exercise title/skill carried.
	if env.Data[0].ExerciseTitle == "" || env.Data[0].ExerciseSkill != "reading" {
		t.Errorf("exercise header not carried: title=%q skill=%q", env.Data[0].ExerciseTitle, env.Data[0].ExerciseSkill)
	}
	// submissionStatus set for the started (soon) row, null for the not-started (later) row.
	if env.Data[0].SubmissionStatus == nil || *env.Data[0].SubmissionStatus != "in_progress" {
		t.Errorf("started row submissionStatus = %v, want in_progress", env.Data[0].SubmissionStatus)
	}
	if env.Data[0].SubmissionID == nil {
		t.Error("started row submissionId must be set")
	}
	if env.Data[1].SubmissionStatus != nil {
		t.Errorf("not-started row submissionStatus = %v, want null", *env.Data[1].SubmissionStatus)
	}
	if env.Data[1].SubmissionID != nil {
		t.Errorf("not-started row submissionId = %v, want null", *env.Data[1].SubmissionID)
	}
}

// AC3: GET /api/assignments is the STUDENT collection — every non-student role
// (owner/teacher/admin) is rejected 403 INSUFFICIENT_ROLE (teachers use the
// class-scoped list). Table-driven so the gate is proven for all three, not owner alone.
func TestListStudentAssignments_NonStudent_403(t *testing.T) {
	e := setupAttemptEnv(t)
	for role, tok := range e.nonStudentTokens() {
		t.Run(role, func(t *testing.T) {
			rec := attemptGet(t, e.srv, "/api/assignments", tok)
			if rec.Code != http.StatusForbidden {
				t.Fatalf("%s: status = %d, want 403 (non-student)", role, rec.Code)
			}
			assertErrorCode(t, rec, "INSUFFICIENT_ROLE")
		})
	}
}

// AC4/AC13: the student list NEVER returns cross-tenant rows — student A (tenant A)
// sees only tenant A's assignment; a tenant B assignment (even for B's own actively
// enrolled student) is absent via RLS.
func TestListStudentAssignments_CrossTenant_Excluded(t *testing.T) {
	e := setupAttemptEnv(t)

	// Tenant A: student A actively enrolled in class X with one assignment.
	classX := seedClass(t, e.centerID, e.ownerID)
	seedEnrollment(t, e.centerID, e.studentA, classX, "active")
	exA := seedExercise(t, e.centerID, e.ownerID, minimalContentJSON())
	aidA := seedAssignment(t, e.centerID, pgFromGoUUID(exA), classX, e.ownerID, "open", time.Now().Add(24*time.Hour), nil)

	// Tenant B: its own owner/student/class/enrollment/exercise/assignment.
	pool := SetupRawPool(t)
	sfx := uuid.NewString()[:8]
	ownerB := CreateUserOnPool(t, pool, "ownerb-"+sfx+"@example.com", "Owner B")
	studentBt := CreateUserOnPool(t, pool, "sbt-"+sfx+"@example.com", "Student Bt")
	MarkUserEmailVerifiedOnPool(t, pool, ownerB.ID)
	MarkUserEmailVerifiedOnPool(t, pool, studentBt.ID)
	centerBPg := CreateCenterForOwner(t, pool, ownerB.ID)
	AddCenterMember(t, pool, centerBPg, studentBt.ID, "student")
	classB := seedClass(t, centerBPg, ownerB.ID)
	seedEnrollment(t, centerBPg, studentBt.ID, classB, "active")
	exB := seedExercise(t, centerBPg, ownerB.ID, minimalContentJSON())
	aidB := seedAssignment(t, centerBPg, pgFromGoUUID(exB), classB, ownerB.ID, "open", time.Now().Add(24*time.Hour), nil)
	t.Cleanup(func() {
		sp := SuperuserPool(t)
		ctx := context.Background()
		_, _ = sp.Exec(ctx, `DELETE FROM assignments WHERE center_id = $1`, centerBPg)
		_, _ = sp.Exec(ctx, `DELETE FROM enrollments WHERE center_id = $1`, centerBPg)
		_, _ = sp.Exec(ctx, `DELETE FROM exercises WHERE center_id = $1`, centerBPg)
		_, _ = sp.Exec(ctx, `DELETE FROM classes WHERE center_id = $1`, centerBPg)
		_, _ = sp.Exec(ctx, `DELETE FROM center_members WHERE center_id = $1`, centerBPg)
		_, _ = sp.Exec(ctx, `DELETE FROM centers WHERE id = $1`, centerBPg)
		PurgeUserAndOwnedCenters(t, pool, ownerB.ID)
		PurgeUserAndOwnedCenters(t, pool, studentBt.ID)
	})

	rec := attemptGet(t, e.srv, "/api/assignments", e.studentTok)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body: %s)", rec.Code, rec.Body.String())
	}
	var env struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
		Meta struct {
			Pagination struct {
				Total int `json:"total"`
			} `json:"pagination"`
		} `json:"meta"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(env.Data) != 1 || env.Data[0].ID != aidA.String() {
		t.Fatalf("rows = %d, want exactly tenant A's assignment %s; body: %s", len(env.Data), aidA.String(), rec.Body.String())
	}
	if env.Meta.Pagination.Total != 1 {
		t.Errorf("total = %d, want 1 (tenant B row must not inflate the count)", env.Meta.Pagination.Total)
	}
	for _, row := range env.Data {
		if row.ID == aidB.String() {
			t.Errorf("RLS VIOLATION: student A's list leaked tenant B assignment %s", aidB.String())
		}
	}
}

// Regression (code-review patch): a crafted `?page` near MaxInt64 must NOT overflow
// the int64 OFFSET multiply into a negative OFFSET → Postgres 500. It returns an
// empty page (200), never a 500.
func TestListStudentAssignments_HugePage_NoOverflow500(t *testing.T) {
	e := setupAttemptEnv(t)
	classX := seedClass(t, e.centerID, e.ownerID)
	seedEnrollment(t, e.centerID, e.studentA, classX, "active")
	ex := seedExercise(t, e.centerID, e.ownerID, minimalContentJSON())
	seedAssignment(t, e.centerID, pgFromGoUUID(ex), classX, e.ownerID, "open", time.Now().Add(24*time.Hour), nil)

	rec := attemptGet(t, e.srv, "/api/assignments?page=9223372036854775807&pageSize=100", e.studentTok)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (huge page must not overflow into a 500); body: %s", rec.Code, rec.Body.String())
	}
	var env struct {
		Data []json.RawMessage `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(env.Data) != 0 {
		t.Errorf("huge page rows = %d, want 0 (empty page)", len(env.Data))
	}
}

// --- helpers ---

func minimalContentJSON() string {
	return `{"sections":[{"type":"reading","title":"R","content":"passage","questionGroups":[]}],"settings":{"timeLimitEnabled":false,"timeLimitMinutes":0,"caseSensitive":false}}`
}

func pgFromGoUUID(id uuid.UUID) pgtype.UUID {
	return pgtype.UUID{Bytes: id, Valid: true}
}

func assertErrorCode(t *testing.T, rec *httptest.ResponseRecorder, want string) {
	t.Helper()
	var env struct {
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
		t.Fatalf("decode error envelope: %v (body: %s)", err, rec.Body.String())
	}
	if env.Error.Code != want {
		t.Errorf("error code = %q, want %q (body: %s)", env.Error.Code, want, rec.Body.String())
	}
}
