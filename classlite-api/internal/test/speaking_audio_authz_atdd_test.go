// Story 6.3a (AC2/AC10 · D5/D6). Teacher audio presign authz — the
// NOVEL R9 surface (WF-8 hard gate, risk 6). Two surfaces, one rule: only the
// class teacher may mint a GET presign for a speaking submission's audio, and a
// gated failure mints ZERO URLs.
//
//   Surface 1: the grading READ (GetSubmissionForGrading) sets AudioUrl+AudioStatus.
//   Surface 2: the on-demand teacher audio-REFRESH route (GetTeacherSubmissionAudioURL).
//
// Build-tagged `atdd_red_phase`; run with
//   go test -tags=atdd_red_phase ./internal/test/...
// FAILS TO COMPILE today (.WithStorage / TeacherGradingView.AudioUrl+AudioStatus /
// GetTeacherSubmissionAudioURL do not exist).
//
// DISCHARGE-BY-INHERITANCE (do NOT re-seed here):
//   - the SEC-8 prefix-guard PRIMITIVE (a foreign-CENTER key → KeyPrefixMismatch,
//     zero mint) is already adversarially tested at 5.5a
//     (storage_presign_owned_test.go). A cross-TENANT audioKey never even reaches
//     the guard here — GetSubmissionByID RLS-404s first. So the red-first surface is
//     SAME-TENANT, WRONG-TEACHER → 403 + zero mint, which the primitive test does
//     NOT cover.
//
// SEAMS (dev, green phase):
//   - GetSubmissionForGrading populates TeacherGradingView.AudioUrl *string +
//       AudioStatus string ("hasAudio" | "none"); the presign is minted OUTSIDE the
//       committed read tx (PERF-1 — mirror attempt_service.go:154-162). No HeadObject
//       (D6): AudioStatus is "hasAudio" iff a non-empty audioKey exists.
//   - (*GradingService).GetTeacherSubmissionAudioURL(ctx, tc, classID, assignmentID,
//       submissionID uuid.UUID) (string, error) — teacher-of-class authz
//       (assertTeacherOfSubmissionClass), 5-min GET presign; a same-tenant non-class
//       teacher → *service.ForbiddenError, zero mint. Wired to
//       GET /api/classes/{classId}/grading/{assignmentId}/{submissionId}/audio.
package test

import (
	"context"
	"errors"
	"testing"

	"github.com/ducdo/classlite-api/internal/service"
)

// -----------------------------------------------------------------------------
// AC10 — grading read (surface 1): owner class-teacher gets a minted URL + hasAudio.
// -----------------------------------------------------------------------------

func TestGradingRead_SpeakingAudio_OwnerTeacher_MintsUrl_hasAudio_ATDD(t *testing.T) {
	e := setupSpeakingGradingEnv(t)
	view, err := e.gradingSvc.GetSubmissionForGrading(context.Background(), e.ownerTC, e.submissionID)
	if err != nil {
		t.Fatalf("GetSubmissionForGrading: %v", err)
	}
	if view.AudioStatus != "hasAudio" {
		t.Errorf("AudioStatus = %q, want hasAudio (non-empty audioKey, no HeadObject — D6)", view.AudioStatus)
	}
	if view.AudioUrl == nil || *view.AudioUrl == "" {
		t.Error("owner class-teacher grading read must mint a presigned audioUrl")
	}
	if len(e.mock.PresignGetKeys) != 1 {
		t.Errorf("grading read minted %d presigns, want exactly 1", len(e.mock.PresignGetKeys))
	}
	if e.mock.LastPresignGetExpiry.Minutes() != 5 {
		t.Errorf("audio presign TTL = %v, want 5m (submissionAudioURLExpiry)", e.mock.LastPresignGetExpiry)
	}
}

// A writing submission → AudioStatus "none", no url, ZERO mint (no audioKey).
func TestGradingRead_WritingSubmission_AudioNone_ZeroMint_ATDD(t *testing.T) {
	e := setupSpeakingGradingEnv(t)
	view, err := e.gradingSvc.GetSubmissionForGrading(context.Background(), e.ownerTC, e.writingSubID)
	if err != nil {
		t.Fatalf("GetSubmissionForGrading (writing): %v", err)
	}
	if view.AudioStatus != "none" {
		t.Errorf("writing AudioStatus = %q, want none", view.AudioStatus)
	}
	if view.AudioUrl != nil {
		t.Errorf("writing submission must not mint an audioUrl, got %v", *view.AudioUrl)
	}
	if len(e.mock.PresignGetKeys) != 0 {
		t.Errorf("writing read minted %d presigns, want 0", len(e.mock.PresignGetKeys))
	}
}

// -----------------------------------------------------------------------------
// AC10 / R9-novel — grading read: SAME-TENANT WRONG-teacher → 403 + ZERO mint.
// The presign must never be minted for a teacher who does not own the class.
// -----------------------------------------------------------------------------

func TestGradingRead_SpeakingAudio_WrongTeacher_403_ZeroMint_ATDD(t *testing.T) {
	e := setupSpeakingGradingEnv(t)
	_, err := e.gradingSvc.GetSubmissionForGrading(context.Background(), e.otherTeacherTC, e.submissionID)
	var forbidden *service.ForbiddenError
	if !errors.As(err, &forbidden) {
		t.Fatalf("same-tenant non-class teacher grading read → want 403 ForbiddenError, got %v", err)
	}
	if len(e.mock.PresignGetKeys) != 0 {
		t.Errorf("R9 LEAK: a gated (403) read minted %d presigns, want 0 (authz before mint)", len(e.mock.PresignGetKeys))
	}
}

// -----------------------------------------------------------------------------
// AC2 / R9-novel — refresh route (surface 2): owner mints; wrong-teacher 403+zero-mint.
// -----------------------------------------------------------------------------

func TestTeacherAudioRefresh_OwnerTeacher_MintsUrl_ATDD(t *testing.T) {
	e := setupSpeakingGradingEnv(t)
	url, err := e.gradingSvc.GetTeacherSubmissionAudioURL(context.Background(), e.ownerTC, e.classID, e.assignmentID, e.submissionID)
	if err != nil {
		t.Fatalf("GetTeacherSubmissionAudioURL (owner): %v", err)
	}
	if url == "" {
		t.Error("owner class-teacher refresh must return a non-empty presigned url")
	}
	if len(e.mock.PresignGetKeys) != 1 {
		t.Errorf("refresh minted %d presigns, want exactly 1", len(e.mock.PresignGetKeys))
	}
}

func TestTeacherAudioRefresh_WrongTeacher_403_ZeroMint_ATDD(t *testing.T) {
	e := setupSpeakingGradingEnv(t)
	_, err := e.gradingSvc.GetTeacherSubmissionAudioURL(context.Background(), e.otherTeacherTC, e.classID, e.assignmentID, e.submissionID)
	var forbidden *service.ForbiddenError
	if !errors.As(err, &forbidden) {
		t.Fatalf("same-tenant non-class teacher refresh → want 403 ForbiddenError, got %v", err)
	}
	if len(e.mock.PresignGetKeys) != 0 {
		t.Errorf("R9 LEAK: a gated (403) refresh minted %d presigns, want 0 (authz before mint)", len(e.mock.PresignGetKeys))
	}
}
