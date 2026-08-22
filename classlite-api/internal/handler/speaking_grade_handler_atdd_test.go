// Story 6.3a (AC5/AC11 · D2 / SEC-7). The handler decode-order refactor
// at the HTTP boundary. D2 flags this as the biggest rework risk: today
// POST /api/submissions/{id}/grade STRICT-decodes the writing-shaped body
// (DisallowUnknownFields) BEFORE any DB access, so a speaking body would 422 as an
// unknown field before the skill is ever resolved. The handler MUST become:
//   raw json.RawMessage → resolve exercise.skill (RLS-scoped) → strict-decode into
//   the skill's struct → dispatch GradeWriting / GradeSpeaking.
//
// SEC-7: the branch is chosen from the submission's DB skill, NEVER a client field —
// a client cannot force the branch. A body whose SHAPE does not match the resolved
// skill → 409 SUBMISSION_SKILL_MISMATCH (a clean conflict, not a 422 unknown-field),
// and NOTHING is persisted (no text-anchored comments smuggled onto a speaking grade).
//
// Build-tagged `atdd_red_phase`; run with
//   go test -tags=atdd_red_phase ./internal/handler/...
// FAILS TO COMPILE today (no grading-handler test server; no speaking pool seed).
//
// SEAMS (dev, green phase — mirror story_4_3a_helpers.go's bare-mux pattern):
//   - test.NewGradingHandlerTestServer(t, pool) http.Handler — wires
//       extractTenant→requireVerified→requireCenter→ErrorMapper over the grade +
//       grade/revise + grading-read + teacher-audio routes.
//   - test.SeedSpeakingSubmissionOnPool(t, pool, centerID, classTeacherID, studentID)
//       (assignmentID, submissionID string) — committed speaking submission
//       (content.audioKey + content.durationSec), status submitted.
//   - test.SeedWritingSubmissionOnPool(...) — committed writing submission.
//   - The error-mapper maps model.ConflictError{Code:"SUBMISSION_SKILL_MISMATCH"} → 409.
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
)

type gradeErrEnvelope struct {
	Error struct {
		Code    string `json:"code"`
		Message string `json:"message"`
	} `json:"error"`
}

type speakingGradeHandlerEnv struct {
	srv             http.Handler
	pool            interface{}
	speakingSubID   string
	writingSubID    string
	classTeacherTok string
}

func setupSpeakingGradeHandlerTest(t *testing.T) speakingGradeHandlerEnv {
	t.Helper()
	pool := test.SetupRawPool(t)
	sfx := uuid.NewString()[:8]

	owner := test.CreateUserOnPool(t, pool, "owner-"+sfx+"@example.com", "Owner")
	student := test.CreateUserOnPool(t, pool, "stu-"+sfx+"@example.com", "Student")
	for _, u := range []test.User{owner, student} {
		test.MarkUserEmailVerifiedOnPool(t, pool, u.ID)
	}
	centerPg := test.CreateCenterForOwner(t, pool, owner.ID)
	centerID := test.UUIDString(centerPg)
	test.AddCenterMember(t, pool, centerPg, student.ID, "student")

	_, speakingSubID := test.SeedSpeakingSubmissionOnPool(t, pool, centerID, test.UUIDString(owner.ID), test.UUIDString(student.ID))
	_, writingSubID := test.SeedWritingSubmissionOnPool(t, pool, centerID, test.UUIDString(owner.ID), test.UUIDString(student.ID))

	return speakingGradeHandlerEnv{
		srv:             test.NewGradingHandlerTestServer(t, pool),
		pool:            pool,
		speakingSubID:   speakingSubID,
		writingSubID:    writingSubID,
		classTeacherTok: test.SignAccessTokenForRole(t, owner.ID, centerID, "owner"),
	}
}

func gradeReq(t *testing.T, env speakingGradeHandlerEnv, subID, tok string, body map[string]any) *httptest.ResponseRecorder {
	t.Helper()
	raw, _ := json.Marshal(body)
	req := httptest.NewRequest("POST", "/api/submissions/"+subID+"/grade", bytes.NewReader(raw))
	if tok != "" {
		req.Header.Set("Authorization", "Bearer "+tok)
	}
	rec := httptest.NewRecorder()
	env.srv.ServeHTTP(rec, req)
	return rec
}

// A writing-shaped body: text-offset anchored comments + writing criterion keys.
func writingShapedBody() map[string]any {
	return map[string]any{
		"criterionScores": map[string]any{"taskResponse": 6, "coherenceCohesion": 6, "lexicalResource": 6, "grammaticalRange": 6},
		"comments": []map[string]any{
			{"type": "error", "criterion": "taskResponse", "anchorStart": 0, "anchorEnd": 5, "text": "x"},
		},
	}
}

// A speaking-shaped body: timestamp-pinned comments + speaking criterion keys.
func speakingShapedBody() map[string]any {
	return map[string]any{
		"criterionScores": map[string]any{"fluencyCoherence": 6, "lexicalResource": 6, "grammaticalRange": 6, "pronunciation": 6},
		"comments": []map[string]any{
			{"type": "error", "criterion": "pronunciation", "timestampMs": 12000, "text": "x"},
		},
	}
}

// -----------------------------------------------------------------------------
// AC11/AC5 — happy: a speaking submission + speaking body → 200/201 (branch by DB skill).
// -----------------------------------------------------------------------------

func TestGradeHandler_SpeakingSubmission_SpeakingBody_OK_ATDD(t *testing.T) {
	env := setupSpeakingGradeHandlerTest(t)
	rec := gradeReq(t, env, env.speakingSubID, env.classTeacherTok, speakingShapedBody())
	if rec.Code != http.StatusOK && rec.Code != http.StatusCreated {
		t.Fatalf("speaking body on speaking submission → status %d, want 2xx (body: %s)", rec.Code, rec.Body.String())
	}
}

// -----------------------------------------------------------------------------
// SEC-7 — a client cannot force the branch: a WRITING-shaped body on a SPEAKING
// submission → 409 SUBMISSION_SKILL_MISMATCH (NOT a 422 unknown-field), nothing
// persisted. This is the decode-raw → resolve-skill → strict-decode contract (D2).
// -----------------------------------------------------------------------------

func TestGradeHandler_SpeakingSubmission_WritingBody_409_SkillMismatch_ATDD(t *testing.T) {
	env := setupSpeakingGradeHandlerTest(t)
	rec := gradeReq(t, env, env.speakingSubID, env.classTeacherTok, writingShapedBody())

	if rec.Code != http.StatusConflict {
		t.Fatalf("writing body on speaking submission → status %d, want 409 (must resolve skill BEFORE strict-decode, not 422 unknown-field — D2). body: %s", rec.Code, rec.Body.String())
	}
	var e gradeErrEnvelope
	if err := json.Unmarshal(rec.Body.Bytes(), &e); err != nil || e.Error.Code != "SUBMISSION_SKILL_MISMATCH" {
		t.Fatalf("want error.code SUBMISSION_SKILL_MISMATCH, got err=%v body=%s", err, rec.Body.String())
	}
	// Nothing persisted: the submission stays submitted (no grade smuggled in).
	sp := test.SuperuserPool(t)
	var n int
	if err := sp.QueryRow(context.Background(), `SELECT count(*) FROM grades WHERE submission_id=$1`, env.speakingSubID).Scan(&n); err != nil {
		t.Fatalf("count grades: %v", err)
	}
	if n != 0 {
		t.Errorf("SEC-7 leak: %d grade rows persisted on a skill-mismatched request, want 0", n)
	}
}

// The mirror direction — a SPEAKING body on a WRITING submission → 409 too (the
// writing path is not weakened by the branch; regression guard).
func TestGradeHandler_WritingSubmission_SpeakingBody_409_ATDD(t *testing.T) {
	env := setupSpeakingGradeHandlerTest(t)
	rec := gradeReq(t, env, env.writingSubID, env.classTeacherTok, speakingShapedBody())
	if rec.Code != http.StatusConflict {
		t.Fatalf("speaking body on writing submission → status %d, want 409 (regression). body: %s", rec.Code, rec.Body.String())
	}
}
