// Story 7.4a — QuestionHandler integration tests (TEST-BE-3: real middleware,
// real service, real DB via the committed raw pool). Proves the R25/R26 elision
// and non-disclosure through the FULL stack (not just the store/service reds):
//   - teacher sees own-class questions in a {data,meta} envelope
//   - student sees own questions
//   - Owner/Admin reach the handler and get an EMPTY list (200, NOT 403) — the
//     elision is served by the service, not a RequireRole edge gate
//   - Owner GET /{id} → 404 QUESTION_NOT_FOUND (non-disclosure error shape)
//   - unauthenticated → 401
package handler_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/ducdo/classlite-api/internal/test"
	"github.com/google/uuid"
)

type questionListEnvelope struct {
	Data []map[string]any `json:"data"`
	Meta struct {
		ServerTime string `json:"serverTime"`
		Pagination struct {
			Total int `json:"total"`
		} `json:"pagination"`
	} `json:"meta"`
}

type questionThreadEnvelope struct {
	Data struct {
		Question map[string]any   `json:"question"`
		Replies  []map[string]any `json:"replies"`
	} `json:"data"`
}

func decodeQuestionList(t *testing.T, rec *httptest.ResponseRecorder) questionListEnvelope {
	t.Helper()
	var out questionListEnvelope
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode question list envelope: %v (body: %s)", err, rec.Body.String())
	}
	return out
}

type questionHandlerEnv struct {
	srv        http.Handler
	questionID uuid.UUID
	ownerTok   string
	teacherTok string
	studentTok string
}

func setupQuestionHandlerTest(t *testing.T) questionHandlerEnv {
	t.Helper()
	pool := test.SetupRawPool(t)
	sfx := uuid.NewString()[:8]

	owner := test.CreateUserOnPool(t, pool, "q-owner-"+sfx+"@example.com", "Owner")
	teacher := test.CreateUserOnPool(t, pool, "q-teacher-"+sfx+"@example.com", "Teacher")
	student := test.CreateUserOnPool(t, pool, "q-student-"+sfx+"@example.com", "Student")
	for _, u := range []test.User{owner, teacher, student} {
		test.MarkUserEmailVerifiedOnPool(t, pool, u.ID)
	}

	centerPg := test.CreateCenterForOwner(t, pool, owner.ID)
	centerID := test.UUIDString(centerPg)
	test.AddCenterMember(t, pool, centerPg, teacher.ID, "teacher")
	test.AddCenterMember(t, pool, centerPg, student.ID, "student")

	teacherID := test.UUIDString(teacher.ID)
	classID := test.SeedClass(t, centerID, "QA Class", "active", &teacherID, nil)

	// Seed an exercise + a question via the superuser pool (bypasses RLS/FORCE).
	sp := test.SuperuserPool(t)
	ctx := context.Background()
	exerciseID := uuid.New()
	if _, err := sp.Exec(ctx,
		`INSERT INTO exercises (id, center_id, created_by, code, title, skill, tags)
		 VALUES ($1, $2, $3, $4, 'QA Exercise', 'reading', '{}')`,
		exerciseID, centerPg, owner.ID, "QA-"+sfx); err != nil {
		t.Fatalf("seed exercise: %v", err)
	}
	questionID := uuid.New()
	if _, err := sp.Exec(ctx,
		`INSERT INTO questions
		   (id, center_id, exercise_id, class_id, student_id, anchor_type, anchor_ref, anchor_excerpt, content, status)
		 VALUES ($1, $2, $3, $4, $5, 'item',
		   '{"schemaVersion":1,"sectionIndex":0,"questionGroupIndex":0,"questionIndex":0}'::jsonb,
		   'the wisdom of crowds', 'Why is the answer B?', 'open')`,
		questionID, centerPg, exerciseID, classID, student.ID); err != nil {
		t.Fatalf("seed question: %v", err)
	}

	t.Cleanup(func() {
		csp := test.SuperuserPool(t)
		_, _ = csp.Exec(ctx, `DELETE FROM question_replies WHERE center_id = $1`, centerPg)
		_, _ = csp.Exec(ctx, `DELETE FROM questions WHERE center_id = $1`, centerPg)
		_, _ = csp.Exec(ctx, `DELETE FROM exercises WHERE center_id = $1`, centerPg)
		_, _ = csp.Exec(ctx, `DELETE FROM classes WHERE center_id = $1`, centerPg)
		_, _ = csp.Exec(ctx, `DELETE FROM center_members WHERE center_id = $1`, centerPg)
		_, _ = csp.Exec(ctx, `DELETE FROM centers WHERE id = $1`, centerPg)
		for _, u := range []test.User{owner, teacher, student} {
			test.PurgeUserAndOwnedCenters(t, pool, u.ID)
		}
	})

	return questionHandlerEnv{
		srv:        test.NewQuestionTestServerBareMux(t, pool),
		questionID: questionID,
		ownerTok:   test.SignAccessTokenForRole(t, owner.ID, centerID, "owner"),
		teacherTok: test.SignAccessTokenForRole(t, teacher.ID, centerID, "teacher"),
		studentTok: test.SignAccessTokenForRole(t, student.ID, centerID, "student"),
	}
}

func TestQuestionHandler_List_TeacherSeesOwnClass_200Envelope(t *testing.T) {
	env := setupQuestionHandlerTest(t)
	rec := classReq(t, env.srv, http.MethodGet, "/api/questions", env.teacherTok, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("teacher GET → %d, want 200 (body: %s)", rec.Code, rec.Body.String())
	}
	got := decodeQuestionList(t, rec)
	if len(got.Data) != 1 {
		t.Fatalf("teacher list len = %d, want 1 (their class's question)", len(got.Data))
	}
	if got.Data[0]["id"] != env.questionID.String() {
		t.Errorf("listed question id = %v, want %s", got.Data[0]["id"], env.questionID.String())
	}
	if got.Meta.ServerTime == "" {
		t.Error("envelope missing meta.serverTime")
	}
	if got.Meta.Pagination.Total != 1 {
		t.Errorf("meta.pagination.total = %d, want 1", got.Meta.Pagination.Total)
	}
}

func TestQuestionHandler_List_StudentSeesOwn_200(t *testing.T) {
	env := setupQuestionHandlerTest(t)
	rec := classReq(t, env.srv, http.MethodGet, "/api/questions", env.studentTok, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("student GET → %d, want 200 (body: %s)", rec.Code, rec.Body.String())
	}
	if got := decodeQuestionList(t, rec); len(got.Data) != 1 {
		t.Errorf("student list len = %d, want 1 (their own question)", len(got.Data))
	}
}

// R25/R26 through the full stack: Owner reaches the handler (NOT 403) and gets an
// empty list — the elision is a service concern, not a RequireRole edge gate.
func TestQuestionHandler_List_OwnerGetsEmpty_200_NOT_403(t *testing.T) {
	env := setupQuestionHandlerTest(t)
	rec := classReq(t, env.srv, http.MethodGet, "/api/questions", env.ownerTok, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("owner GET → %d, want 200 (Q&A elides to empty, never 403) (body: %s)", rec.Code, rec.Body.String())
	}
	if got := decodeQuestionList(t, rec); len(got.Data) != 0 {
		t.Errorf("R25 VIOLATION: owner list len = %d, want 0", len(got.Data))
	}
}

// Non-disclosure: Owner GET a specific thread → 404 QUESTION_NOT_FOUND.
func TestQuestionHandler_GetThread_Owner_404(t *testing.T) {
	env := setupQuestionHandlerTest(t)
	rec := classReq(t, env.srv, http.MethodGet, "/api/questions/"+env.questionID.String(), env.ownerTok, nil)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("owner GET thread → %d, want 404 (body: %s)", rec.Code, rec.Body.String())
	}
	if code := errCodeOf(t, rec.Body.Bytes()); code != "QUESTION_NOT_FOUND" {
		t.Errorf("error code = %q, want QUESTION_NOT_FOUND", code)
	}
}

// A teacher of the class sees the thread (positive control for the 404 above).
func TestQuestionHandler_GetThread_Teacher_200(t *testing.T) {
	env := setupQuestionHandlerTest(t)
	rec := classReq(t, env.srv, http.MethodGet, "/api/questions/"+env.questionID.String(), env.teacherTok, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("teacher GET thread → %d, want 200 (body: %s)", rec.Code, rec.Body.String())
	}
	var out questionThreadEnvelope
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode thread: %v", err)
	}
	if out.Data.Question["id"] != env.questionID.String() {
		t.Errorf("thread question id = %v, want %s", out.Data.Question["id"], env.questionID.String())
	}
}

func TestQuestionHandler_List_Unauthenticated_401(t *testing.T) {
	env := setupQuestionHandlerTest(t)
	rec := classReq(t, env.srv, http.MethodGet, "/api/questions", "", nil)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated GET → %d, want 401 (body: %s)", rec.Code, rec.Body.String())
	}
}
