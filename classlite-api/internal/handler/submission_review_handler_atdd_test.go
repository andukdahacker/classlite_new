// Story 5.5a — student submission-review HTTP surface ATDD (TEST-BE-3: real
// middleware chain + real service + real DB via the committed raw pool + signed
// bearer tokens). Two new student routes:
//
//	GET /api/assignments/{assignmentId}/result          → pending shell / read-back
//	GET /api/assignments/{assignmentId}/submission/audio → fresh 5-min GET presign
//
// Covers:
//   P1-3  result envelope + status: owner-terminal → 200 {data:{submission,
//         assignment,exercise,released,audioUrl}}; failures → {error:{code,
//         message,requestId}}
//   P0-5  (handler) non-student → 403 INSUFFICIENT_ROLE
//   404   no-submission / cross-student → 404 SUBMISSION_NOT_FOUND (no oracle)
//   P1-1  (handler) in_progress → 200 CTA payload (no strip, no presign)
//   P0-13 audio endpoint rides the SAME gate ladder: owner-terminal speaking →
//         200 {data:{url}} fresh GET; EVERY gated failure → error status + zero mint
//
// RED-PHASE (Story 5.5a, WF-8 risk-6). Build-tagged `atdd_red_phase`: excluded
// from normal `go test ./...`; `go test -tags=atdd_red_phase ./...` fails to
// compile on the undefined Story-5.5a DI seam. Dev removes the tag per-file as
// each contract lands (red→green).
//
// DEV SEAM (green phase): `test.NewSubmissionReviewTestServerBareMux(t, pool)`
// wires extractTenant→requireVerified→requireCenter→ErrorMapper over the two new
// routes (mirror internal/test/story_5_2a_helpers.go NewStudentAttemptTestServer-
// BareMux) and returns BOTH the handler AND the *service.MockStorageService the
// submission service was built WITH (via .WithStorage), so a test can assert on
// the presign spy. Create it in a story_5_5a_helpers.go alongside the routes.
package handler_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/ducdo/classlite-api/internal/service"
	"github.com/ducdo/classlite-api/internal/test"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

// -----------------------------------------------------------------------------
// env + file-local superuser seeders (mirror internal/test/attempt_read_test.go).
// -----------------------------------------------------------------------------

type reviewHTTPEnv struct {
	srv        http.Handler
	storage    *service.MockStorageService
	centerID   pgtype.UUID
	ownerID    pgtype.UUID
	studentA   pgtype.UUID
	studentB   pgtype.UUID
	classID    uuid.UUID
	speakingEx uuid.UUID
	studentTok string // studentA
	studentBTk string
	ownerTok   string
}

func revPg(id uuid.UUID) pgtype.UUID { return pgtype.UUID{Bytes: id, Valid: true} }

func revSeedClass(t *testing.T, centerID, teacherID pgtype.UUID) uuid.UUID {
	t.Helper()
	sp := test.SuperuserPool(t)
	id := uuid.New()
	if _, err := sp.Exec(context.Background(),
		`INSERT INTO classes (id, center_id, name, status, teacher_id) VALUES ($1,$2,'C','active',$3)`,
		id, centerID, teacherID); err != nil {
		t.Fatalf("seed class: %v", err)
	}
	return id
}

func revSeedSpeakingExercise(t *testing.T, centerID, creatorID pgtype.UUID) uuid.UUID {
	t.Helper()
	sp := test.SuperuserPool(t)
	id := uuid.New()
	content := `{"sections":[{"type":"speaking","title":"S","content":"Describe your day","questionGroups":[]}],"settings":{"timeLimitEnabled":false,"timeLimitMinutes":0,"caseSensitive":false}}`
	if _, err := sp.Exec(context.Background(),
		`INSERT INTO exercises (id, center_id, created_by, code, title, skill, content, schema_version)
		 VALUES ($1,$2,$3,$4,'Speaking Ex','speaking',$5,1)`,
		id, centerID, creatorID, "EX-"+id.String()[:8], content); err != nil {
		t.Fatalf("seed exercise: %v", err)
	}
	return id
}

func revSeedEnrollment(t *testing.T, centerID, studentID pgtype.UUID, classID uuid.UUID, status string) {
	t.Helper()
	sp := test.SuperuserPool(t)
	if _, err := sp.Exec(context.Background(),
		`INSERT INTO enrollments (id, center_id, student_id, class_id, status) VALUES ($1,$2,$3,$4,$5)`,
		uuid.New(), centerID, studentID, classID, status); err != nil {
		t.Fatalf("seed enrollment: %v", err)
	}
}

func revSeedAssignment(t *testing.T, centerID pgtype.UUID, exerciseID uuid.UUID, classID uuid.UUID, creatorID pgtype.UUID, status string) uuid.UUID {
	t.Helper()
	sp := test.SuperuserPool(t)
	id := uuid.New()
	if _, err := sp.Exec(context.Background(),
		`INSERT INTO assignments (id, center_id, exercise_id, class_id, created_by, status, deadline_at, late_penalty)
		 VALUES ($1,$2,$3,$4,$5,$6, now() + interval '1 day', 1.5)`,
		id, centerID, revPg(exerciseID), classID, creatorID, status); err != nil {
		t.Fatalf("seed assignment: %v", err)
	}
	return id
}

func revSeedSubmission(t *testing.T, centerID pgtype.UUID, assignmentID uuid.UUID, studentID pgtype.UUID, status, content string) uuid.UUID {
	t.Helper()
	sp := test.SuperuserPool(t)
	id := uuid.New()
	now := time.Now().UTC()
	if _, err := sp.Exec(context.Background(),
		`INSERT INTO submissions (id, center_id, assignment_id, student_id, status, content, schema_version, started_at, submitted_at, created_at, updated_at)
		 VALUES ($1,$2,$3,$4,$5,$6,1,$7,$7,$7,$7)`,
		id, centerID, revPg(assignmentID), studentID, status, content, now); err != nil {
		t.Fatalf("seed submission: %v", err)
	}
	return id
}

func revSpeakingContent(centerID pgtype.UUID) string {
	key := test.UUIDString(centerID) + "/speaking/" + uuid.NewString() + ".webm"
	return `{"schemaVersion":1,"audioKey":"` + key + `","contentType":"audio/webm","durationSec":12}`
}

func setupReviewHTTPEnv(t *testing.T) reviewHTTPEnv {
	t.Helper()
	pool := test.SetupRawPool(t)
	sfx := uuid.NewString()[:8]

	owner := test.CreateUserOnPool(t, pool, "owner-"+sfx+"@example.com", "Owner")
	studentA := test.CreateUserOnPool(t, pool, "sa-"+sfx+"@example.com", "Student A")
	studentB := test.CreateUserOnPool(t, pool, "sb-"+sfx+"@example.com", "Student B")
	for _, u := range []test.User{owner, studentA, studentB} {
		test.MarkUserEmailVerifiedOnPool(t, pool, u.ID)
	}

	centerPg := test.CreateCenterForOwner(t, pool, owner.ID)
	centerID := test.UUIDString(centerPg)
	test.AddCenterMember(t, pool, centerPg, studentA.ID, "student")
	test.AddCenterMember(t, pool, centerPg, studentB.ID, "student")

	classX := revSeedClass(t, centerPg, owner.ID)
	revSeedEnrollment(t, centerPg, studentA.ID, classX, "active")
	speakingEx := revSeedSpeakingExercise(t, centerPg, owner.ID)

	t.Cleanup(func() {
		sp := test.SuperuserPool(t)
		ctx := context.Background()
		_, _ = sp.Exec(ctx, `DELETE FROM submissions WHERE center_id = $1`, centerPg)
		_, _ = sp.Exec(ctx, `DELETE FROM assignments WHERE center_id = $1`, centerPg)
		_, _ = sp.Exec(ctx, `DELETE FROM enrollments WHERE center_id = $1`, centerPg)
		_, _ = sp.Exec(ctx, `DELETE FROM exercises WHERE center_id = $1`, centerPg)
		_, _ = sp.Exec(ctx, `DELETE FROM classes WHERE center_id = $1`, centerPg)
		_, _ = sp.Exec(ctx, `DELETE FROM center_members WHERE center_id = $1`, centerPg)
		_, _ = sp.Exec(ctx, `DELETE FROM centers WHERE id = $1`, centerPg)
		for _, u := range []test.User{owner, studentA, studentB} {
			test.PurgeUserAndOwnedCenters(t, pool, u.ID)
		}
	})

	// RED seam: undefined until the dev wires the two review routes. Returns the
	// handler AND the presign spy the submission service was built with.
	srv, storage := test.NewSubmissionReviewTestServerBareMux(t, pool)
	return reviewHTTPEnv{
		srv:        srv,
		storage:    storage,
		centerID:   centerPg,
		ownerID:    owner.ID,
		studentA:   studentA.ID,
		studentB:   studentB.ID,
		classID:    classX,
		speakingEx: speakingEx,
		studentTok: test.SignAccessTokenForRole(t, studentA.ID, centerID, "student"),
		studentBTk: test.SignAccessTokenForRole(t, studentB.ID, centerID, "student"),
		ownerTok:   test.SignAccessTokenForRole(t, owner.ID, centerID, "owner"),
	}
}

func reviewGet(t *testing.T, srv http.Handler, path, token string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, path, nil)
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, req)
	return rec
}

func revAssertErrEnvelope(t *testing.T, rec *httptest.ResponseRecorder, wantCode string) {
	t.Helper()
	var env struct {
		Error struct {
			Code      string `json:"code"`
			Message   string `json:"message"`
			RequestID string `json:"requestId"`
		} `json:"error"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
		t.Fatalf("decode error envelope: %v (body: %s)", err, rec.Body.String())
	}
	if env.Error.Code != wantCode {
		t.Errorf("error code = %q, want %q (body: %s)", env.Error.Code, wantCode, rec.Body.String())
	}
	if env.Error.Message == "" || env.Error.RequestID == "" {
		t.Errorf("error envelope must carry message + requestId, got %+v", env.Error)
	}
}

// -----------------------------------------------------------------------------
// P1-3 — result envelope + status (owner-terminal 200; failure error envelope).
// -----------------------------------------------------------------------------

func TestSubmissionReview_Result_Envelope_And_Status(t *testing.T) {
	e := setupReviewHTTPEnv(t)
	aid := revSeedAssignment(t, e.centerID, e.speakingEx, e.classID, e.ownerID, "open")
	revSeedSubmission(t, e.centerID, aid, e.studentA, "submitted", revSpeakingContent(e.centerID))

	rec := reviewGet(t, e.srv, "/api/assignments/"+aid.String()+"/result", e.studentTok)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body: %s)", rec.Code, rec.Body.String())
	}
	var env struct {
		Data struct {
			Submission struct {
				ID     string `json:"id"`
				Status string `json:"status"`
			} `json:"submission"`
			Assignment struct {
				ID string `json:"id"`
			} `json:"assignment"`
			Exercise struct {
				ID       string          `json:"id"`
				Sections json.RawMessage `json:"sections"`
			} `json:"exercise"`
			Released bool    `json:"released"`
			AudioURL *string `json:"audioUrl"`
		} `json:"data"`
		Meta json.RawMessage `json:"meta"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
		t.Fatalf("decode result envelope: %v (body: %s)", err, rec.Body.String())
	}
	if env.Data.Submission.ID == "" || env.Data.Assignment.ID == "" || env.Data.Exercise.ID == "" {
		t.Errorf("result data must carry submission+assignment+exercise ids: %s", rec.Body.String())
	}
	if env.Data.Released {
		t.Error("5.5a is pre-grade: released must be false")
	}
	if env.Data.AudioURL == nil || *env.Data.AudioURL == "" {
		t.Error("speaking read-back must carry an audioUrl")
	}
	if len(env.Meta) == 0 {
		t.Error("full {data,meta} envelope expected (meta present)")
	}

	// Failure path shares the full {error:{code,message,requestId}} envelope.
	other := revSeedAssignment(t, e.centerID, e.speakingEx, e.classID, e.ownerID, "open") // no submission
	recErr := reviewGet(t, e.srv, "/api/assignments/"+other.String()+"/result", e.studentTok)
	if recErr.Code != http.StatusNotFound {
		t.Fatalf("no-submission status = %d, want 404 (body: %s)", recErr.Code, recErr.Body.String())
	}
	revAssertErrEnvelope(t, recErr, "SUBMISSION_NOT_FOUND")
}

// -----------------------------------------------------------------------------
// P0-5 (handler) — non-student principal → 403 INSUFFICIENT_ROLE.
// -----------------------------------------------------------------------------

func TestSubmissionReview_NonStudent_403_INSUFFICIENT_ROLE(t *testing.T) {
	e := setupReviewHTTPEnv(t)
	aid := revSeedAssignment(t, e.centerID, e.speakingEx, e.classID, e.ownerID, "open")
	revSeedSubmission(t, e.centerID, aid, e.studentA, "submitted", revSpeakingContent(e.centerID))

	rec := reviewGet(t, e.srv, "/api/assignments/"+aid.String()+"/result", e.ownerTok)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403 (non-student)", rec.Code)
	}
	revAssertErrEnvelope(t, rec, "INSUFFICIENT_ROLE")
}

// -----------------------------------------------------------------------------
// 404 — no submission OR another student's submission → 404 SUBMISSION_NOT_FOUND
// (the caller-keyed resolve gives no cross-student oracle).
// -----------------------------------------------------------------------------

func TestSubmissionReview_NoSubmissionOrCrossStudent_404(t *testing.T) {
	e := setupReviewHTTPEnv(t)
	revSeedEnrollment(t, e.centerID, e.studentB, e.classID, "active")
	aid := revSeedAssignment(t, e.centerID, e.speakingEx, e.classID, e.ownerID, "open")
	revSeedSubmission(t, e.centerID, aid, e.studentB, "submitted", revSpeakingContent(e.centerID))

	// studentA (enrolled, but owns no submission for this assignment) → 404, not 403.
	rec := reviewGet(t, e.srv, "/api/assignments/"+aid.String()+"/result", e.studentTok)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("cross-student status = %d, want 404 (no oracle)", rec.Code)
	}
	revAssertErrEnvelope(t, rec, "SUBMISSION_NOT_FOUND")
}

// -----------------------------------------------------------------------------
// P1-1 (handler) — in_progress → 200 CTA payload (no strip, no presign, D10).
// -----------------------------------------------------------------------------

func TestSubmissionReview_InProgress_200_CTA_Payload(t *testing.T) {
	e := setupReviewHTTPEnv(t)
	aid := revSeedAssignment(t, e.centerID, e.speakingEx, e.classID, e.ownerID, "open")
	revSeedSubmission(t, e.centerID, aid, e.studentA, "in_progress", revSpeakingContent(e.centerID))

	rec := reviewGet(t, e.srv, "/api/assignments/"+aid.String()+"/result", e.studentTok)
	if rec.Code != http.StatusOK {
		t.Fatalf("in_progress status = %d, want 200 CTA (body: %s)", rec.Code, rec.Body.String())
	}
	var env struct {
		Data struct {
			InProgress bool            `json:"inProgress"`
			AudioURL   *string         `json:"audioUrl"`
			Exercise   json.RawMessage `json:"exercise"`
		} `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
		t.Fatalf("decode CTA payload: %v (body: %s)", err, rec.Body.String())
	}
	if !env.Data.InProgress {
		t.Error("D10: in_progress result must be flagged inProgress (resume CTA)")
	}
	if env.Data.AudioURL != nil {
		t.Error("D10: CTA must NOT presign audio")
	}
	if len(e.storage.PresignGetKeys) != 0 {
		t.Errorf("D10: CTA short-circuit must not mint, got %d", len(e.storage.PresignGetKeys))
	}
}

// -----------------------------------------------------------------------------
// P0-13 — the audio endpoint rides the SAME gate ladder. Owner-terminal speaking
// → 200 {data:{url}} fresh 5-min GET (via PresignGet, not the PUT-style Presign).
// EVERY gated failure returns its error status AND mints nothing.
// -----------------------------------------------------------------------------

func TestSubmissionAudio_SameGateLadder_ZeroMintOnFailure(t *testing.T) {
	// Happy path: owner-terminal speaking → 200 {data:{url}} + exactly one GET mint.
	t.Run("owner_terminal_200_fresh_get", func(t *testing.T) {
		e := setupReviewHTTPEnv(t)
		aid := revSeedAssignment(t, e.centerID, e.speakingEx, e.classID, e.ownerID, "open")
		revSeedSubmission(t, e.centerID, aid, e.studentA, "submitted", revSpeakingContent(e.centerID))

		rec := reviewGet(t, e.srv, "/api/assignments/"+aid.String()+"/submission/audio", e.studentTok)
		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200 (body: %s)", rec.Code, rec.Body.String())
		}
		var env struct {
			Data struct {
				URL string `json:"url"`
			} `json:"data"`
		}
		if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
			t.Fatalf("decode audio envelope: %v (body: %s)", err, rec.Body.String())
		}
		if env.Data.URL == "" {
			t.Error("expected a non-empty presigned audio url")
		}
		// GET-not-PUT + a single mint (the mock stamps presigned=get on PresignGet).
		if len(e.storage.PresignGetKeys) != 1 {
			t.Fatalf("audio mint count = %d, want exactly 1 GET", len(e.storage.PresignGetKeys))
		}
	})

	// Gated failures: each returns its status and mints NOTHING.
	failures := []struct {
		name       string
		wantStatus int
		wantCode   string
		build      func(t *testing.T, e reviewHTTPEnv) (path, token string)
	}{
		{"non-student_403", http.StatusForbidden, "INSUFFICIENT_ROLE", func(t *testing.T, e reviewHTTPEnv) (string, string) {
			aid := revSeedAssignment(t, e.centerID, e.speakingEx, e.classID, e.ownerID, "open")
			revSeedSubmission(t, e.centerID, aid, e.studentA, "submitted", revSpeakingContent(e.centerID))
			return "/api/assignments/" + aid.String() + "/submission/audio", e.ownerTok
		}},
		{"cross-student_404", http.StatusNotFound, "SUBMISSION_NOT_FOUND", func(t *testing.T, e reviewHTTPEnv) (string, string) {
			revSeedEnrollment(t, e.centerID, e.studentB, e.classID, "active")
			aid := revSeedAssignment(t, e.centerID, e.speakingEx, e.classID, e.ownerID, "open")
			revSeedSubmission(t, e.centerID, aid, e.studentB, "submitted", revSpeakingContent(e.centerID))
			return "/api/assignments/" + aid.String() + "/submission/audio", e.studentTok // A owns nothing here
		}},
		{"not-enrolled_403", http.StatusForbidden, "NOT_ENROLLED", func(t *testing.T, e reviewHTTPEnv) (string, string) {
			sp := test.SuperuserPool(t)
			if _, err := sp.Exec(context.Background(),
				`UPDATE enrollments SET status='withdrawn' WHERE class_id=$1 AND student_id=$2`, e.classID, e.studentA); err != nil {
				t.Fatalf("withdraw: %v", err)
			}
			aid := revSeedAssignment(t, e.centerID, e.speakingEx, e.classID, e.ownerID, "open")
			revSeedSubmission(t, e.centerID, aid, e.studentA, "submitted", revSpeakingContent(e.centerID))
			return "/api/assignments/" + aid.String() + "/submission/audio", e.studentTok
		}},
	}
	for _, f := range failures {
		t.Run(f.name, func(t *testing.T) {
			e := setupReviewHTTPEnv(t)
			path, token := f.build(t, e)
			rec := reviewGet(t, e.srv, path, token)
			if rec.Code != f.wantStatus {
				t.Fatalf("status = %d, want %d (body: %s)", rec.Code, f.wantStatus, rec.Body.String())
			}
			revAssertErrEnvelope(t, rec, f.wantCode)
			if len(e.storage.PresignGetKeys) != 0 {
				t.Errorf("gated failure minted %d presigned URL(s), want 0", len(e.storage.PresignGetKeys))
			}
		})
	}
}
