// Story 6.2a, AC11 + AC12 (AI writing-grade worker) — RED PHASE.
//
// TWO-PHASE RED CONVENTION (repo standard; see ai_generate_atdd_test.go):
//   Phase 1 (now, pre-dev): this file references DI seams that do not exist yet
//     (worker.NewGradeWritingHandler, model.JobTypeAIGradeWriting,
//     model.AIWritingGradeResult, gemini.MockValidWritingGrade/…, and
//     testpkg.SeedWritingSubmissionForTenant). The package therefore FAILS TO
//     COMPILE — an unambiguous red gate on the branch (WF-8, R3=9).
//   Phase 2 (dev): once the constructors/types/mock-modes land, the package
//     visibly PENDING, never false-green. Dev removes the skip for an AC as they
//     turn it green.
//
// WHAT THIS PROVES (R3/A7 = BLOCK(9), the async equivalent of GO-1)
//   The job row's center_id is the ONLY tenant trust anchor. This worker reads a
//   SUBMISSION (essay text) — a read the generic 3-pattern harness does NOT cover
//   (it proves a job read). A missing SET LOCAL or an honored payload center_id
//   must fail closed (0 rows → NotFoundError), and Gemini must NEVER see another
//   tenant's essay (CallCount()==0 is the load-bearing tripwire).
//
// SEAMS (dev confirms exact shapes in green phase — this is the ONE place to edit):
//   - worker.NewGradeWritingHandler(h.DB, gemini.Client, clock.Clock) workers.JobHandler
//   - model.JobTypeAIGradeWriting  model.JobType = "ai_grade_writing"
//   - model.AIGradeWritingParams { SubmissionID string `json:"submissionId"` }
//   - model.AIWritingGradeResult  (criteria{taskResponse,coherenceCohesion,
//       lexicalResource,grammaticalRange:{band,rationale,confidence}}, comments[],
//       overallFeedback, analyzedWordCount, latencyMs)
//   - gemini.MockValidWritingGrade / MockInvalidBandScores / MockIncompleteWritingGrade
//       (valid mode emits one orphan comment at len(essay)+5 and one emoji-straddling
//        comment so the demotion assertion is not vacuously green)
//   - testpkg.SeedWritingSubmissionForTenant(t, h.DB, centerID) (submissionID uuid.UUID)
//       — promote 6.1's local insertWritingSubmission to an exported testpkg helper
//         that seeds the class/exercise/assignment/student/submission chain under
//         centerID (mirror testpkg.SeedExerciseForWorker).
package worker_test

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/ducdo/classlite-api/internal/gemini"
	"github.com/ducdo/classlite-api/internal/model"
	testpkg "github.com/ducdo/classlite-api/internal/test"
	"github.com/ducdo/classlite-api/internal/test/workers"
	"github.com/ducdo/classlite-api/internal/worker"
)

// newGradeWritingHandler is the single DI reconciliation point for the writing
// grader. Intent: it depends on the tx-scoped DB, the injected gemini client, and
// the deterministic clock — nothing tenant-ish from the payload.
func newGradeWritingHandler(t *testing.T, h *workers.WorkerHarness, mock gemini.Client) workers.JobHandler {
	t.Helper()
	return worker.NewGradeWritingHandler(h.DB, mock, h.Clock)
}

// jobResultRaw reads jobs.result for a job under the current tenant context.
func jobResultRaw(t *testing.T, h *workers.WorkerHarness, jobID uuid.UUID) json.RawMessage {
	t.Helper()
	var raw json.RawMessage
	if err := h.DB.QueryRow(context.Background(),
		`SELECT result FROM jobs WHERE id = $1`, jobID,
	).Scan(&raw); err != nil {
		t.Fatalf("read job.result %s: %v", jobID, err)
	}
	return raw
}

// jobErrorDetails reads jobs.error_details for a terminally-failed job — the D8
// label (invalid_band_scores vs invalid_ai_response vs generation_failed) that 6.2b
// differentiates failure causes on. Returns "" when the column is NULL.
func jobErrorDetails(t *testing.T, h *workers.WorkerHarness, jobID uuid.UUID) string {
	t.Helper()
	var details *string
	if err := h.DB.QueryRow(context.Background(),
		`SELECT error_details FROM jobs WHERE id = $1`, jobID,
	).Scan(&details); err != nil {
		t.Fatalf("read job.error_details %s: %v", jobID, err)
	}
	if details == nil {
		return ""
	}
	return *details
}

// ===========================================================================
// S1 — Pattern 1: HappyPath (row tenant set; result shape + demotion asserted)
// ===========================================================================

func TestGradeWriting_HappyPath(t *testing.T) {

	h := workers.SetupWorkerHarness(t)
	_ = testpkg.CreateCenterWithID(t, h.DB, testpkg.TenantAID, "Tenant A", "TENA")
	subID := testpkg.SeedWritingSubmissionForTenant(t, h.DB, uuid.MustParse(testpkg.TenantAID))

	mock := gemini.NewMockClient(gemini.MockConfig{Mode: gemini.MockValidWritingGrade})
	jobID := h.EnqueueJob(t, testpkg.TenantAID, string(model.JobTypeAIGradeWriting),
		model.AIGradeWritingParams{SubmissionID: subID.String()})

	// Drive through the dispatcher (not h.ProcessSpecific): the harness's ProcessTask
	// path discards the result fragment, whereas the dispatcher persists it to
	// jobs.result via MarkJobComplete — which is exactly what this test asserts.
	d := newGradeDispatcher(t, h, mock)
	if err := d.ProcessOnce(context.Background()); err != nil {
		t.Fatalf("happy path returned error: %v", err)
	}
	if got := h.JobStatus(t, jobID); got != workers.StatusComplete {
		t.Fatalf("job status = %q, want %q", got, workers.StatusComplete)
	}
	if mock.CallCount() != 1 {
		t.Errorf("gemini.Generate called %d times, want exactly 1", mock.CallCount())
	}

	// Seam invariant (D10): a complete result is fully valid + gradeable.
	var res model.AIWritingGradeResult
	if err := json.Unmarshal(jobResultRaw(t, h, jobID), &res); err != nil {
		t.Fatalf("job.result is not a valid AIWritingGradeResult: %v", err)
	}
	// All four criteria present, each band on the 1.0–9.0 0.5 grid, confidence valid.
	for name, cr := range map[string]model.AIWritingGradeCriterion{
		"taskResponse":      res.Criteria.TaskResponse,
		"coherenceCohesion": res.Criteria.CoherenceCohesion,
		"lexicalResource":   res.Criteria.LexicalResource,
		"grammaticalRange":  res.Criteria.GrammaticalRange,
	} {
		if cr.Band < 1.0 || cr.Band > 9.0 || cr.Band*2 != float64(int(cr.Band*2)) {
			t.Errorf("criterion %s band %.2f out of range / off the 0.5 grid", name, cr.Band)
		}
		if cr.Confidence != "high" && cr.Confidence != "medium" {
			t.Errorf("criterion %s confidence %q not in {high, medium}", name, cr.Confidence)
		}
	}
	// The ORPHAN comment (seeded at len(essay)+5) and the emoji-straddling comment
	// were DEMOTED to whole-essay (null/null), never dropped (D5/D10); the valid
	// anchor survives; every comment type is lowercase.
	var sawOrphanDemoted, sawEmojiDemoted, sawValidAnchor bool
	for _, c := range res.Comments {
		if c.Type != strings.ToLower(c.Type) {
			t.Errorf("comment type %q is not lowercase", c.Type)
		}
		switch {
		case strings.Contains(c.Text, "ORPHAN"):
			if c.AnchorStart != nil || c.AnchorEnd != nil {
				t.Errorf("orphan comment not demoted: anchors=%v/%v", c.AnchorStart, c.AnchorEnd)
			}
			sawOrphanDemoted = true
		case strings.Contains(c.Text, "EMOJI"):
			if c.AnchorStart != nil || c.AnchorEnd != nil {
				t.Errorf("emoji-straddling comment not demoted: anchors=%v/%v", c.AnchorStart, c.AnchorEnd)
			}
			sawEmojiDemoted = true
		default:
			if c.AnchorStart != nil && c.AnchorEnd != nil {
				sawValidAnchor = true
			}
		}
	}
	if !sawOrphanDemoted {
		t.Error("expected the orphan comment present-and-demoted, not dropped")
	}
	if !sawEmojiDemoted {
		t.Error("expected the emoji-straddling comment present-and-demoted, not dropped")
	}
	if !sawValidAnchor {
		t.Error("expected the valid-anchored comment to retain its anchors")
	}
}

// ===========================================================================
// S2 — Pattern 2: PayloadCenterIdIgnored (job row=A; payload smuggles B)
// ===========================================================================

func TestGradeWriting_PayloadCenterIdIgnored(t *testing.T) {

	h := workers.SetupWorkerHarness(t)
	_ = testpkg.CreateCenterWithID(t, h.DB, testpkg.TenantAID, "Tenant A", "TENA")
	_ = testpkg.CreateCenterWithID(t, h.DB, testpkg.TenantBID, "Tenant B", "TENB")

	// A B-owned submission the attacker's payload will try to reach.
	bSub := testpkg.SeedWritingSubmissionForTenant(t, h.DB, uuid.MustParse(testpkg.TenantBID))

	// Job row says A; payload smuggles B's submission id (centerId, if ever added,
	// is ignored — the submissionId alone must resolve under A's RLS → 0 rows).
	jobID := h.EnqueueJob(t, testpkg.TenantAID, string(model.JobTypeAIGradeWriting),
		model.AIGradeWritingParams{SubmissionID: bSub.String()})

	mock := gemini.NewMockClient(gemini.MockConfig{Mode: gemini.MockValidWritingGrade})
	err := h.ProcessSpecific(context.Background(), t, jobID, newGradeWritingHandler(t, h, mock))

	var nf model.NotFoundError
	if !errors.As(err, &nf) {
		t.Fatalf("RLS VIOLATION (R3): payload submissionId=B honored under tenant A — want NotFoundError, got %v", err)
	}
	if mock.CallCount() != 0 {
		t.Errorf("gemini.Generate called %d times on a cross-tenant miss, want 0 — B's essay must never reach the model", mock.CallCount())
	}
}

// ===========================================================================
// S3 — Pattern 3: NullTenantContextRejected (simulate the SET LOCAL bug)
// ===========================================================================

func TestGradeWriting_NullTenantContextRejected(t *testing.T) {

	h := workers.SetupWorkerHarness(t)
	center := testpkg.CreateCenterWithID(t, h.DB, testpkg.TenantAID, "Tenant A", "TENA")
	_ = testpkg.TenantContext(t, h.DB, center.ID)
	subID := testpkg.SeedWritingSubmissionForTenant(t, h.DB, uuid.MustParse(testpkg.TenantAID))

	jobID := h.EnqueueJob(t, testpkg.TenantAID, string(model.JobTypeAIGradeWriting),
		model.AIGradeWritingParams{SubmissionID: subID.String()})

	mock := gemini.NewMockClient(gemini.MockConfig{Mode: gemini.MockValidWritingGrade})
	if err := h.ProcessWithoutTenantContext(context.Background(), t, jobID, newGradeWritingHandler(t, h, mock)); err == nil {
		t.Fatal("RLS VIOLATION (SEC-6/GO-1): grader succeeded with NO tenant context set")
	}
	if mock.CallCount() != 0 {
		t.Errorf("gemini.Generate called %d times without tenant context, want 0", mock.CallCount())
	}
}

// ===========================================================================
// S4 — R3-submission cross-tenant read + Gemini-never-invoked (AC12; R3=9)
// The generic grid tests a JOB read; THIS proves the SUBMISSION read fails
// closed. This is the R3=9 headline miss the party review surfaced.
// ===========================================================================

func TestGradeWriting_SubmissionCrossTenant_GeminiNeverInvoked(t *testing.T) {

	h := workers.SetupWorkerHarness(t)
	_ = testpkg.CreateCenterWithID(t, h.DB, testpkg.TenantAID, "Tenant A", "TENA")
	_ = testpkg.CreateCenterWithID(t, h.DB, testpkg.TenantBID, "Tenant B", "TENB")

	// Seed submission S under tenant B.
	bSub := testpkg.SeedWritingSubmissionForTenant(t, h.DB, uuid.MustParse(testpkg.TenantBID))

	// Job ROW is tenant A, referencing B's submission.
	jobID := h.EnqueueJob(t, testpkg.TenantAID, string(model.JobTypeAIGradeWriting),
		model.AIGradeWritingParams{SubmissionID: bSub.String()})

	mock := gemini.NewMockClient(gemini.MockConfig{Mode: gemini.MockValidWritingGrade})
	err := h.ProcessSpecific(context.Background(), t, jobID, newGradeWritingHandler(t, h, mock))

	var nf model.NotFoundError
	if !errors.As(err, &nf) {
		t.Fatalf("R3 BREACH: essay fetch under A returned B's row — want NotFoundError, got %v", err)
	}
	// Load-bearing tripwire: tenant B's essay never reached the model.
	if mock.CallCount() != 0 {
		t.Errorf("R3 BREACH: gemini.Generate called %d times — B's essay reached Gemini, want 0", mock.CallCount())
	}
	// No result may be written for a cross-tenant miss.
	if raw := jobResultRaw(t, h, jobID); len(raw) != 0 && string(raw) != "null" {
		t.Errorf("R3 BREACH: job.result was written (%s) on a cross-tenant miss, want NULL", string(raw))
	}
}

// ===========================================================================
// S14 — Completeness → terminal invalid_ai_response (D10 seam invariant)
// A parseable-but-incomplete Gemini result (missing criterion / null field /
// comment missing type|criterion|text) is TERMINAL, not a stored partial.
// ===========================================================================

func TestGradeWriting_IncompleteResult_Terminal(t *testing.T) {

	h := workers.SetupWorkerHarness(t)
	_ = testpkg.CreateCenterWithID(t, h.DB, testpkg.TenantAID, "Tenant A", "TENA")
	subID := testpkg.SeedWritingSubmissionForTenant(t, h.DB, uuid.MustParse(testpkg.TenantAID))

	mock := gemini.NewMockClient(gemini.MockConfig{Mode: gemini.MockIncompleteWritingGrade}) // missing a criterion key
	jobID := h.EnqueueJob(t, testpkg.TenantAID, string(model.JobTypeAIGradeWriting),
		model.AIGradeWritingParams{SubmissionID: subID.String()})

	err := h.ProcessSpecific(context.Background(), t, jobID, newGradeWritingHandler(t, h, mock))
	if err == nil {
		t.Fatal("incomplete AI result must be a terminal error, got nil")
	}
	if got := h.JobStatus(t, jobID); got != workers.StatusFailed {
		t.Fatalf("job status = %q, want failed (terminal)", got)
	}
	// D8: classification is TYPE-BASED — errors.Is on ErrInvalidAIResponse holds, and
	// the incomplete case carries NO distinct terminal reason (unlike the band-scores
	// case), so the dispatcher labels it with the DEFAULT invalid_ai_response. This
	// test drives the handler via ProcessSpecific, which surfaces the terminal error
	// directly; the *persisted* error_details label is asserted through the real
	// dispatcher in the refund suite (invalid_band_scores + invalid_ai_response).
	if !errors.Is(err, worker.ErrInvalidAIResponse) {
		t.Errorf("err = %v, want errors.Is ErrInvalidAIResponse (D8 type-based classification)", err)
	}
	var tr *worker.TerminalReasonError
	if errors.As(err, &tr) {
		t.Errorf("incomplete result must NOT carry a distinct terminal reason (got %q); it defaults to invalid_ai_response", tr.Reason)
	}
	if raw := jobResultRaw(t, h, jobID); len(raw) != 0 && string(raw) != "null" {
		t.Errorf("incomplete result was stored (%s), want NULL — seam invariant: complete ⇒ gradeable", string(raw))
	}
}

// ===========================================================================
// S16 — Zero-writes immutability (R16=6, D1): a successful job writes NEITHER a
// grades row NOR a submissions UPDATE. Positive proof via pre/post read-back.
// ===========================================================================

func TestGradeWriting_Success_WritesNoGradeNorSubmission(t *testing.T) {

	h := workers.SetupWorkerHarness(t)
	_ = testpkg.CreateCenterWithID(t, h.DB, testpkg.TenantAID, "Tenant A", "TENA")
	subID := testpkg.SeedWritingSubmissionForTenant(t, h.DB, uuid.MustParse(testpkg.TenantAID))

	// Snapshot the submission row + grades count BEFORE.
	beforeSub := submissionRowFingerprint(t, h, subID)
	beforeGrades := gradesCountForSubmission(t, h, subID)

	mock := gemini.NewMockClient(gemini.MockConfig{Mode: gemini.MockValidWritingGrade})
	jobID := h.EnqueueJob(t, testpkg.TenantAID, string(model.JobTypeAIGradeWriting),
		model.AIGradeWritingParams{SubmissionID: subID.String()})
	if err := h.ProcessSpecific(context.Background(), t, jobID, newGradeWritingHandler(t, h, mock)); err != nil {
		t.Fatalf("happy path error: %v", err)
	}

	if after := submissionRowFingerprint(t, h, subID); after != beforeSub {
		t.Errorf("D1 VIOLATION: submission row mutated by the AI grader\n before=%s\n after =%s", beforeSub, after)
	}
	if after := gradesCountForSubmission(t, h, subID); after != beforeGrades {
		t.Errorf("D1 VIOLATION: grades rows changed %d→%d — the worker inserted a grade", beforeGrades, after)
	}
}

// submissionRowFingerprint captures the fields the grader must never touch.
func submissionRowFingerprint(t *testing.T, h *workers.WorkerHarness, subID uuid.UUID) string {
	t.Helper()
	var status string
	var content json.RawMessage
	if err := h.DB.QueryRow(context.Background(),
		`SELECT status, content FROM submissions WHERE id = $1`, subID,
	).Scan(&status, &content); err != nil {
		t.Fatalf("read submission %s: %v", subID, err)
	}
	return status + "|" + string(content)
}

func gradesCountForSubmission(t *testing.T, h *workers.WorkerHarness, subID uuid.UUID) int {
	t.Helper()
	var n int
	if err := h.DB.QueryRow(context.Background(),
		`SELECT count(*) FROM grades WHERE submission_id = $1`, subID,
	).Scan(&n); err != nil {
		t.Fatalf("count grades for %s: %v", subID, err)
	}
	return n
}

// ===========================================================================
// S21 — Secret / prompt / essay (PII) never logged (R49; AC12)
// ===========================================================================

func TestGradeWriting_SecretsPromptAndEssay_NeverLogged(t *testing.T) {

	const secretKeyValue = "AIzaSy-DEADBEEF-super-secret-gemini-key-do-not-log"
	const promptMarker = "SENSITIVE_PROMPT_MARKER_should_never_be_logged"
	const responseMarker = "SENSITIVE_RESPONSE_MARKER_should_never_be_logged"

	// Route ALL slog output produced during this test into a buffer.
	var buf bytes.Buffer
	prev := slog.Default()
	slog.SetDefault(slog.New(slog.NewJSONHandler(&buf, &slog.HandlerOptions{Level: slog.LevelDebug})))
	t.Cleanup(func() { slog.SetDefault(prev) })

	h := workers.SetupWorkerHarness(t)
	_ = testpkg.CreateCenterWithID(t, h.DB, testpkg.TenantAID, "Tenant A", "TENA")
	subID := testpkg.SeedWritingSubmissionForTenant(t, h.DB, uuid.MustParse(testpkg.TenantAID))

	mock := gemini.NewMockClient(gemini.MockConfig{
		Mode:           gemini.MockValidWritingGrade,
		APIKey:         secretKeyValue,
		PromptMarker:   promptMarker,
		ResponseMarker: responseMarker,
	})
	jobID := h.EnqueueJob(t, testpkg.TenantAID, string(model.JobTypeAIGradeWriting),
		model.AIGradeWritingParams{SubmissionID: subID.String()})
	_ = h.ProcessSpecific(context.Background(), t, jobID, newGradeWritingHandler(t, h, mock))

	logs := buf.String()
	for _, forbidden := range []string{secretKeyValue, promptMarker, responseMarker} {
		if strings.Contains(logs, forbidden) {
			t.Errorf("R49 VIOLATION: forbidden value %q leaked into logs.\n---LOGS---\n%s", forbidden, logs)
		}
	}
	// Positive control so the negative check is not vacuous.
	if !strings.Contains(logs, testpkg.TenantAID) && !strings.Contains(logs, jobID.String()) {
		t.Error("expected job_id/center_id correlation fields in logs; buffer had neither")
	}
}
