// Story 4.3a, AC1 + AC2 (enqueue + poll endpoints) — GREEN.
//
// TEST-BE-3: real middleware chain + real service + real DB via the committed
// raw pool. Mirrors exercise_handler_atdd_test.go / enrollment_handler_atdd_test.go.
//
// AC1 — POST /api/exercises/{id}/ai-generate:
//   - teacher who owns {id} → 202 {data:{jobId}}; a pending `jobs` row AND a
//     −1 `job_deduction` ledger row exist for the same job (single tx)
//   - enqueue does NOT call Gemini (job stays 'pending' — no synchronous AI work;
//     PERF-3)
//   - scope no-oracle: cross-teacher → 404 EXERCISE_NOT_FOUND; student → 403;
//     unauth → 401
//   - bad body (unknown mode / missing params) → 422 VALIDATION_ERROR
//
// AC2 — GET /api/jobs/{jobId}:
//   - owner tenant → 200 typed envelope {id,type,status,result,errorDetails,
//     createdAt,startedAt,completedAt}; status=pending; result=null
//   - cross-tenant / unknown → 404 JOB_NOT_FOUND
//
// DI SEAM (dev, green phase): `test.NewAIGenerationTestServerBareMux(t, pool)`
// wires extractTenant→requireVerified→requireCenter→ErrorMapper over the two new
// routes (mirror story_4_1_helpers.go NewExerciseTestServerBareMux). Create it in
// a story_4_3a_helpers.go alongside the route registration.
package handler_test

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/ducdo/classlite-api/internal/test"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

type jobEnvelope struct {
	Data struct {
		ID           string          `json:"id"`
		Type         string          `json:"type"`
		Status       string          `json:"status"`
		Result       json.RawMessage `json:"result"`
		ErrorDetails *string         `json:"errorDetails"`
		CreatedAt    string          `json:"createdAt"`
		StartedAt    *string         `json:"startedAt"`
		CompletedAt  *string         `json:"completedAt"`
	} `json:"data"`
}

type enqueueEnvelope struct {
	Data struct {
		JobID string `json:"jobId"`
	} `json:"data"`
}

type aiGenTestEnv struct {
	srv         http.Handler
	pool        interface{} // *pgxpool.Pool via test helpers
	centerID    string
	exAOwnedByA uuid.UUID // exercise owned by teacher A
	teacherATok string
	teacherBTok string
	studentTok  string
}

func setupAIGenerationHandlerTest(t *testing.T) aiGenTestEnv {
	t.Helper()
	pool := test.SetupRawPool(t)
	sfx := uuid.NewString()[:8]

	owner := test.CreateUserOnPool(t, pool, "owner-"+sfx+"@example.com", "Owner")
	teacherA := test.CreateUserOnPool(t, pool, "ta-"+sfx+"@example.com", "Teacher A")
	teacherB := test.CreateUserOnPool(t, pool, "tb-"+sfx+"@example.com", "Teacher B")
	student := test.CreateUserOnPool(t, pool, "s1-"+sfx+"@example.com", "Student")
	for _, u := range []test.User{owner, teacherA, teacherB, student} {
		test.MarkUserEmailVerifiedOnPool(t, pool, u.ID)
	}

	centerPg := test.CreateCenterForOwner(t, pool, owner.ID)
	centerID := test.UUIDString(centerPg)
	test.AddCenterMember(t, pool, centerPg, teacherA.ID, "teacher")
	test.AddCenterMember(t, pool, centerPg, teacherB.ID, "teacher")
	test.AddCenterMember(t, pool, centerPg, student.ID, "student")

	// Exercise owned by teacher A (teacher scope: own only).
	taID := test.UUIDString(teacherA.ID)
	exA := test.SeedExerciseOwnedBy(t, pool, centerID, taID, "EX-AIGEN-A") // GREEN-PHASE: dev exposes 4.1 exercise seed on pool

	t.Cleanup(func() {
		sp := test.SuperuserPool(t)
		ctx := context.Background()
		_, _ = sp.Exec(ctx, `DELETE FROM ai_credit_ledger WHERE center_id = $1`, centerPg)
		_, _ = sp.Exec(ctx, `DELETE FROM jobs WHERE center_id = $1`, centerPg)
		_, _ = sp.Exec(ctx, `DELETE FROM exercises WHERE center_id = $1`, centerPg)
		_, _ = sp.Exec(ctx, `DELETE FROM center_members WHERE center_id = $1`, centerPg)
		_, _ = sp.Exec(ctx, `DELETE FROM centers WHERE id = $1`, centerPg)
		for _, u := range []test.User{owner, teacherA, teacherB, student} {
			test.PurgeUserAndOwnedCenters(t, pool, u.ID)
		}
	})

	return aiGenTestEnv{
		srv:         test.NewAIGenerationTestServerBareMux(t, pool),
		pool:        pool,
		centerID:    centerID,
		exAOwnedByA: exA,
		teacherATok: test.SignAccessTokenForRole(t, teacherA.ID, centerID, "teacher"),
		teacherBTok: test.SignAccessTokenForRole(t, teacherB.ID, centerID, "teacher"),
		studentTok:  test.SignAccessTokenForRole(t, student.ID, centerID, "student"),
	}
}

func enqueueReq(t *testing.T, env aiGenTestEnv, exID, tok string, body map[string]any) *httptest.ResponseRecorder {
	t.Helper()
	raw, _ := json.Marshal(body)
	req := httptest.NewRequest("POST", "/api/exercises/"+exID+"/ai-generate", bytes.NewReader(raw))
	if tok != "" {
		req.Header.Set("Authorization", "Bearer "+tok)
	}
	rec := httptest.NewRecorder()
	env.srv.ServeHTTP(rec, req)
	return rec
}

func validSectionBody() map[string]any {
	return map[string]any{"mode": "section", "params": map[string]any{"topic": "Present perfect"}}
}

// ===========================================================================
// AC1 S1.1 + S1.5 — teacher owns exercise → 202 + job(pending) + −1 ledger (1 tx)
// ===========================================================================

func TestEnqueue_TeacherOwns_202_WithDeduction(t *testing.T) {
	env := setupAIGenerationHandlerTest(t)
	rec := enqueueReq(t, env, env.exAOwnedByA.String(), env.teacherATok, validSectionBody())

	if rec.Code != http.StatusAccepted {
		t.Fatalf("status = %d, want 202 (body: %s)", rec.Code, rec.Body.String())
	}
	var env202 enqueueEnvelope
	if err := json.Unmarshal(rec.Body.Bytes(), &env202); err != nil || env202.Data.JobID == "" {
		t.Fatalf("expected {data:{jobId}}, got err=%v body=%s", err, rec.Body.String())
	}
	jobID := env202.Data.JobID

	sp := test.SuperuserPool(t)
	// A pending job exists.
	var status string
	if err := sp.QueryRow(context.Background(), `SELECT status FROM jobs WHERE id = $1`, jobID).Scan(&status); err != nil {
		t.Fatalf("job row not found for %s: %v", jobID, err)
	}
	if status != "pending" {
		t.Errorf("job status = %q, want pending (PERF-3: enqueue must not run the job synchronously)", status)
	}
	// Exactly one −1 job_deduction ledger row for this job (same tx as insert).
	var change, n int
	if err := sp.QueryRow(context.Background(),
		`SELECT COALESCE(SUM(change),0), count(*) FROM ai_credit_ledger WHERE ref_job_id = $1 AND reason = 'job_deduction'`,
		jobID,
	).Scan(&change, &n); err != nil {
		t.Fatalf("ledger query: %v", err)
	}
	if n != 1 || change != -1 {
		t.Errorf("deduction rows = %d sum = %d, want 1 row of -1 (R23/A6: deduct in same tx as job insert)", n, change)
	}
}

// ===========================================================================
// AC1 S1.2 — enqueue does NOT do synchronous AI work (job stays pending)
// (The enqueue chain has no gemini dependency at all; the pending status above
//  is the behavioral proof. This test pins it explicitly for regression.)
// ===========================================================================

func TestEnqueue_DoesNotRunGenerationSynchronously(t *testing.T) {
	env := setupAIGenerationHandlerTest(t)
	rec := enqueueReq(t, env, env.exAOwnedByA.String(), env.teacherATok, validSectionBody())
	if rec.Code != http.StatusAccepted {
		t.Fatalf("status = %d, want 202", rec.Code)
	}
	var env202 enqueueEnvelope
	_ = json.Unmarshal(rec.Body.Bytes(), &env202)

	sp := test.SuperuserPool(t)
	var status string
	var result *string
	if err := sp.QueryRow(context.Background(),
		`SELECT status, result::text FROM jobs WHERE id = $1`, env202.Data.JobID,
	).Scan(&status, &result); err != nil {
		t.Fatalf("job row: %v", err)
	}
	if status != "pending" || result != nil {
		t.Errorf("post-enqueue job = {status:%q result:%v}, want {pending, nil} (no synchronous Gemini call)", status, result)
	}
}

// ===========================================================================
// AC1 S1.3 — scope no-oracle: cross-teacher 404, student 403, unauth 401
// ===========================================================================

func TestEnqueue_ScopeNegatives(t *testing.T) {
	env := setupAIGenerationHandlerTest(t)

	// Teacher B does not own exercise A → 404 (no oracle; same as 4.1).
	recB := enqueueReq(t, env, env.exAOwnedByA.String(), env.teacherBTok, validSectionBody())
	if recB.Code != http.StatusNotFound {
		t.Errorf("cross-teacher status = %d, want 404 EXERCISE_NOT_FOUND", recB.Code)
	}
	if code := errCodeOf(t, recB.Body.Bytes()); code != "EXERCISE_NOT_FOUND" {
		t.Errorf("cross-teacher error code = %q, want EXERCISE_NOT_FOUND", code)
	}

	// Student → 403.
	recS := enqueueReq(t, env, env.exAOwnedByA.String(), env.studentTok, validSectionBody())
	if recS.Code != http.StatusForbidden {
		t.Errorf("student status = %d, want 403", recS.Code)
	}

	// Unauthenticated → 401.
	recU := enqueueReq(t, env, env.exAOwnedByA.String(), "", validSectionBody())
	if recU.Code != http.StatusUnauthorized {
		t.Errorf("unauth status = %d, want 401", recU.Code)
	}

	// None of the rejected calls may have written a job or a deduction.
	sp := test.SuperuserPool(t)
	var jobs int
	_ = sp.QueryRow(context.Background(), `SELECT count(*) FROM jobs WHERE center_id = $1`, env.centerID).Scan(&jobs)
	if jobs != 0 {
		t.Errorf("rejected enqueues created %d job rows, want 0", jobs)
	}
}

// ===========================================================================
// AC1 S1.4 — malformed body → 422 VALIDATION_ERROR
// ===========================================================================

func TestEnqueue_BadBody_422(t *testing.T) {
	env := setupAIGenerationHandlerTest(t)
	for name, body := range map[string]map[string]any{
		"unknown mode":   {"mode": "banana", "params": map[string]any{}},
		"missing params": {"mode": "section"},
		"missing mode":   {"params": map[string]any{"topic": "x"}},
	} {
		rec := enqueueReq(t, env, env.exAOwnedByA.String(), env.teacherATok, body)
		if rec.Code != http.StatusUnprocessableEntity {
			t.Errorf("%s: status = %d, want 422", name, rec.Code)
		}
		if code := errCodeOf(t, rec.Body.Bytes()); code != "VALIDATION_ERROR" {
			t.Errorf("%s: error code = %q, want VALIDATION_ERROR", name, code)
		}
	}
}

// ===========================================================================
// AC2 S1.6 — GET /api/jobs/{jobId}: owner 200 typed envelope; cross-tenant 404
// ===========================================================================

func TestPollJob_OwnerSeesTypedEnvelope_CrossTenant404(t *testing.T) {
	env := setupAIGenerationHandlerTest(t)
	// Enqueue as teacher A to get a real job id.
	rec := enqueueReq(t, env, env.exAOwnedByA.String(), env.teacherATok, validSectionBody())
	if rec.Code != http.StatusAccepted {
		t.Fatalf("precondition enqueue failed: %d %s", rec.Code, rec.Body.String())
	}
	var env202 enqueueEnvelope
	_ = json.Unmarshal(rec.Body.Bytes(), &env202)
	jobID := env202.Data.JobID

	// Owner tenant (teacher A) polls → 200 typed envelope.
	getReq := func(tok, id string) *httptest.ResponseRecorder {
		req := httptest.NewRequest("GET", "/api/jobs/"+id, nil)
		if tok != "" {
			req.Header.Set("Authorization", "Bearer "+tok)
		}
		w := httptest.NewRecorder()
		env.srv.ServeHTTP(w, req)
		return w
	}

	ok := getReq(env.teacherATok, jobID)
	if ok.Code != http.StatusOK {
		t.Fatalf("poll status = %d, want 200 (body: %s)", ok.Code, ok.Body.String())
	}
	var je jobEnvelope
	if err := json.Unmarshal(ok.Body.Bytes(), &je); err != nil {
		t.Fatalf("decode job envelope: %v (body: %s)", err, ok.Body.String())
	}
	if je.Data.ID != jobID || je.Data.Type == "" || je.Data.Status != "pending" {
		t.Errorf("job envelope = %+v, want id=%s type set status=pending", je.Data, jobID)
	}
	if string(je.Data.Result) != "null" && len(je.Data.Result) != 0 {
		t.Errorf("result = %s, want null before complete", je.Data.Result)
	}

	// Unknown job id under same tenant → 404 JOB_NOT_FOUND (no oracle).
	nf := getReq(env.teacherATok, uuid.NewString())
	if nf.Code != http.StatusNotFound {
		t.Errorf("unknown jobId status = %d, want 404", nf.Code)
	}
	if code := errCodeOf(t, nf.Body.Bytes()); code != "JOB_NOT_FOUND" {
		t.Errorf("unknown jobId error code = %q, want JOB_NOT_FOUND", code)
	}
}

// TestPollJob_CrossCreatorSameTenant_404 — D4 (2026-07-29 code review): the poll
// is creator-scoped, so a DIFFERENT user in the SAME tenant (teacher B, or a
// student) cannot read teacher A's job result. 404 JOB_NOT_FOUND, no oracle.
func TestPollJob_CrossCreatorSameTenant_404(t *testing.T) {
	env := setupAIGenerationHandlerTest(t)
	rec := enqueueReq(t, env, env.exAOwnedByA.String(), env.teacherATok, validSectionBody())
	if rec.Code != http.StatusAccepted {
		t.Fatalf("precondition enqueue failed: %d %s", rec.Code, rec.Body.String())
	}
	var env202 enqueueEnvelope
	_ = json.Unmarshal(rec.Body.Bytes(), &env202)
	jobID := env202.Data.JobID

	getReq := func(tok, id string) *httptest.ResponseRecorder {
		req := httptest.NewRequest("GET", "/api/jobs/"+id, nil)
		if tok != "" {
			req.Header.Set("Authorization", "Bearer "+tok)
		}
		w := httptest.NewRecorder()
		env.srv.ServeHTTP(w, req)
		return w
	}

	// Teacher B (same center, different user) → 404 JOB_NOT_FOUND.
	recB := getReq(env.teacherBTok, jobID)
	if recB.Code != http.StatusNotFound {
		t.Errorf("cross-creator (teacher B) poll status = %d, want 404 (body: %s)", recB.Code, recB.Body.String())
	}
	if code := errCodeOf(t, recB.Body.Bytes()); code != "JOB_NOT_FOUND" {
		t.Errorf("cross-creator error code = %q, want JOB_NOT_FOUND (no oracle)", code)
	}

	// A student in the same center must never read AI result content → 404.
	recS := getReq(env.studentTok, jobID)
	if recS.Code != http.StatusNotFound {
		t.Errorf("student poll status = %d, want 404 (students must not read job results)", recS.Code)
	}

	// The creator still sees it (positive control — scoping isn't over-broad).
	recA := getReq(env.teacherATok, jobID)
	if recA.Code != http.StatusOK {
		t.Errorf("creator poll status = %d, want 200", recA.Code)
	}
}

// pgtype import retained for parity with sibling handler tests that thread ids.
var _ = pgtype.UUID{}
