// Story 6.2a — the ai_grade_writing job handler. It rides the SAME 4.3a dispatcher
// (jobs.type is free text, no migration) but, unlike the ai_generate_* handlers, it
// is a DB-READING handler (template: grade_release.go): it reads the student's essay
// through an RLS-scoped store query on the caller's tx and produces a reviewable
// AIWritingGradeResult SUGGESTION in jobs.result.
//
// It writes NOTHING but the job result (D1): no grades row, no submissions UPDATE.
// The teacher reviews the suggestion in 6.2b and commits the grade via the existing
// 6.1 POST /grade path — so the worker sidesteps the submission-immutability trigger
// (a re-run on a graded submission cannot 500) and the teacher stays the one who
// decides the grade.
//
// R3/A7 (the async GO-1): the job-row center_id, SET LOCAL by the dispatcher before
// this runs, is the SOLE tenant anchor. The essay fetch is a plain RLS-scoped store
// read, so a payload that references another tenant's submission physically returns
// 0 rows → NotFoundError, and Gemini is NEVER reached for an essay the job's tenant
// cannot see. The payload carries no center_id at all (AIGradeWritingParams).
package worker

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/gemini"
	"github.com/ducdo/classlite-api/internal/model"
	"github.com/ducdo/classlite-api/internal/service/grading"
	"github.com/ducdo/classlite-api/internal/store/generated"
)

// TerminalReasonError carries a DISTINCT terminal error_details label for an
// invalid-AI-response failure. It wraps ErrInvalidAIResponse so the dispatcher's
// TYPE-BASED classifier (errors.Is) still routes it terminal; the dispatcher reads
// Reason only AFTER classifying, to persist which sub-reason occurred (D8:
// invalid_band_scores vs invalid_ai_response). Classification never inspects the
// message text (a transient error whose text contains "invalid" must still retry).
type TerminalReasonError struct {
	Reason string
	err    error
}

// Error renders "<reason>: <wrapped>".
func (e *TerminalReasonError) Error() string { return e.Reason + ": " + e.err.Error() }

// Unwrap exposes the wrapped sentinel so errors.Is(err, ErrInvalidAIResponse) holds.
func (e *TerminalReasonError) Unwrap() error { return e.err }

// terminalReason builds a terminal failure carrying a distinct error_details label.
func terminalReason(reason string, err error) error {
	return &TerminalReasonError{Reason: reason, err: err}
}

// GradeWritingHandler runs AI over a Writing submission and produces a suggestion.
type GradeWritingHandler struct {
	db  generated.DBTX
	gem gemini.Client
	clk clock.Clock
}

// NewGradeWritingHandler builds the handler bound to db (the harness/per-job tx),
// the injected Gemini client, and the deterministic clock (latencyMs is measured
// off clk, never wall time, so the golden result is deterministic in tests — D12).
func NewGradeWritingHandler(db generated.DBTX, gem gemini.Client, clk clock.Clock) *GradeWritingHandler {
	return &GradeWritingHandler{db: db, gem: gem, clk: clk}
}

// JobType reports the AI writing-grade job type.
func (h *GradeWritingHandler) JobType() model.JobType { return model.JobTypeAIGradeWriting }

// ProcessTask satisfies the tenant-isolation harness — it runs the same logic
// against the handler's bound DB and discards the captured result fragment.
func (h *GradeWritingHandler) ProcessTask(ctx context.Context, tc model.TenantContext, payload json.RawMessage) error {
	_, err := h.generate(ctx, h.db, h.gem, tc, payload)
	return err
}

func (h *GradeWritingHandler) generate(
	ctx context.Context, db generated.DBTX, gem gemini.Client, tc model.TenantContext, payload json.RawMessage,
) (json.RawMessage, error) {
	var params model.AIGradeWritingParams
	if err := json.Unmarshal(payload, &params); err != nil {
		return nil, fmt.Errorf("%w: unmarshal ai_grade_writing params", ErrInvalidAIResponse)
	}
	logProcessing(tc, model.JobTypeAIGradeWriting)

	// RLS gate: read the essay BEFORE any Gemini call. A cross-tenant / missing /
	// null-tenant read returns 0 rows → NotFoundError, so Gemini never sees an essay
	// the job's tenant cannot see (R3/A7 — the load-bearing tripwire).
	essayText, err := h.readEssayForTenant(ctx, db, params.SubmissionID)
	if err != nil {
		return nil, err
	}

	start := h.clk.Now()
	raw, err := gem.Generate(ctx, gemini.GenerateRequest{Mode: "writing_grade", Prompt: buildWritingGradePrompt(essayText)})
	if err != nil {
		return nil, fmt.Errorf("%w: gemini", ErrTransientGeneration)
	}
	latencyMs := h.clk.Now().Sub(start).Milliseconds()

	var resp model.AIWritingGradeResponse
	if err := json.Unmarshal(raw, &resp); err != nil {
		return nil, fmt.Errorf("%w: parse writing grade response", ErrInvalidAIResponse)
	}

	result, err := buildWritingGradeResult(resp, essayText, latencyMs)
	if err != nil {
		return nil, err
	}
	return json.Marshal(result)
}

// readEssayForTenant reads the submission's essay text via an RLS-scoped store query
// on the caller's tx. 0 rows (cross-tenant / missing / null tenant) → NotFoundError.
func (h *GradeWritingHandler) readEssayForTenant(ctx context.Context, db generated.DBTX, submissionID string) (string, error) {
	id, err := uuid.Parse(submissionID)
	if err != nil {
		return "", submissionNotFound(submissionID)
	}
	sub, err := generated.New(db).GetSubmissionByID(ctx, pgUUID(id))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return "", submissionNotFound(submissionID)
		}
		return "", fmt.Errorf("read submission for ai grade: %w", err)
	}
	return grading.EssayText(sub.Content), nil
}

func submissionNotFound(id string) error {
	return model.NotFoundError{Resource: "submission", ID: id, Code: "SUBMISSION_NOT_FOUND"}
}

// validAIConfidence reports whether c is an accepted confidence level (high/medium).
func validAIConfidence(c string) bool {
	return c == model.AIConfidenceHigh || c == model.AIConfidenceMedium
}

// buildWritingGradeResult validates, completeness-checks, and normalizes the Gemini
// response into a stored AIWritingGradeResult. The seam invariant it guarantees:
// anything returned here is a fully-valid, gradeable suggestion (D10) — so 6.1's
// accept-path can trust it without re-deriving. Failure taxonomy (all terminal,
// TYPE-BASED via ErrInvalidAIResponse):
//   - a missing/null criterion band or confidence, or a bad comment confidence, or a
//     comment with an invalid type/criterion/blank text → invalid_ai_response (D10).
//   - a band out of 1.0–9.0 or off the 0.5 grid → invalid_band_scores (D8 label).
func buildWritingGradeResult(resp model.AIWritingGradeResponse, essayText string, latencyMs int64) (model.AIWritingGradeResult, error) {
	// (1) Criterion completeness: every criterion must carry a non-null band + a
	// valid confidence (a missing key unmarshals to a nil Band/Confidence — D10).
	criteria := []struct {
		key string
		cr  model.AIWritingCriterionResponse
	}{
		{grading.CriterionTaskResponse, resp.Criteria.TaskResponse},
		{grading.CriterionCoherenceCohesion, resp.Criteria.CoherenceCohesion},
		{grading.CriterionLexicalResource, resp.Criteria.LexicalResource},
		{grading.CriterionGrammaticalRange, resp.Criteria.GrammaticalRange},
	}
	for _, c := range criteria {
		if c.cr.Band == nil || c.cr.Confidence == nil || !validAIConfidence(*c.cr.Confidence) {
			return model.AIWritingGradeResult{}, fmt.Errorf("%w: criterion %s incomplete", ErrInvalidAIResponse, c.key)
		}
	}

	// (2) Band range/grid — reuse 6.1's validator verbatim (D5). Out of range /
	// off-grid → terminal, distinct error_details label invalid_band_scores (D8).
	scores := grading.CriterionScores{
		TaskResponse:      *resp.Criteria.TaskResponse.Band,
		CoherenceCohesion: *resp.Criteria.CoherenceCohesion.Band,
		LexicalResource:   *resp.Criteria.LexicalResource.Band,
		GrammaticalRange:  *resp.Criteria.GrammaticalRange.Band,
	}
	if err := grading.ValidateCriterionScores(scores); err != nil {
		return model.AIWritingGradeResult{}, terminalReason(model.JobErrorInvalidBandScores, ErrInvalidAIResponse)
	}

	// (3) Comment confidence completeness (before normalization, which is
	// confidence-agnostic). A null/invalid confidence → invalid_ai_response (D10).
	for i := range resp.Comments {
		if resp.Comments[i].Confidence == nil || !validAIConfidence(*resp.Comments[i].Confidence) {
			return model.AIWritingGradeResult{}, fmt.Errorf("%w: comment %d confidence invalid", ErrInvalidAIResponse, i)
		}
	}

	// (4) Anchor normalization — reuse 6.1's NormalizeComments verbatim (D5). It
	// validates type/criterion/text and DEMOTES out-of-range/surrogate-splitting
	// anchors to whole-essay (never drops). A structural error (bad type/criterion/
	// blank text) is a ValidationError → terminal invalid_ai_response (D10). On
	// success the output preserves order + length, so confidence zips back by index.
	inComments := make([]grading.Comment, len(resp.Comments))
	for i, c := range resp.Comments {
		inComments[i] = grading.Comment{
			Type: c.Type, Criterion: c.Criterion,
			AnchorStart: c.AnchorStart, AnchorEnd: c.AnchorEnd, Text: c.Text,
		}
	}
	normalized, err := grading.NormalizeComments(inComments, essayText)
	if err != nil {
		return model.AIWritingGradeResult{}, fmt.Errorf("%w: normalize comments", ErrInvalidAIResponse)
	}

	outComments := make([]model.AIWritingGradeComment, len(normalized))
	for i, c := range normalized {
		outComments[i] = model.AIWritingGradeComment{
			Type: c.Type, Criterion: c.Criterion,
			AnchorStart: c.AnchorStart, AnchorEnd: c.AnchorEnd, Text: c.Text,
			Confidence: *resp.Comments[i].Confidence,
		}
	}

	return model.AIWritingGradeResult{
		Criteria: model.AIWritingGradeCriteria{
			TaskResponse:      aiCriterion(resp.Criteria.TaskResponse),
			CoherenceCohesion: aiCriterion(resp.Criteria.CoherenceCohesion),
			LexicalResource:   aiCriterion(resp.Criteria.LexicalResource),
			GrammaticalRange:  aiCriterion(resp.Criteria.GrammaticalRange),
		},
		Comments:          outComments,
		OverallFeedback:   resp.OverallFeedback,
		AnalyzedWordCount: len(strings.Fields(essayText)),
		LatencyMs:         latencyMs,
	}, nil
}

// aiCriterion collapses a validated response criterion to its stored value shape.
// Precondition: cr passed the completeness check (Band + Confidence non-nil).
func aiCriterion(cr model.AIWritingCriterionResponse) model.AIWritingGradeCriterion {
	return model.AIWritingGradeCriterion{Band: *cr.Band, Rationale: cr.Rationale, Confidence: *cr.Confidence}
}

// buildWritingGradePrompt embeds the IELTS Writing rubric + the student essay into a
// single instruction (there is no structured-schema param — the client pins
// responseMimeType: application/json). The prompt asks for the exact
// AIWritingGradeResponse shape the worker unmarshals.
func buildWritingGradePrompt(essayText string) string {
	var b strings.Builder
	b.WriteString("You are an experienced IELTS Writing examiner. Grade the essay below against the four IELTS Writing criteria: ")
	b.WriteString("taskResponse, coherenceCohesion, lexicalResource, grammaticalRange. ")
	b.WriteString("For each criterion return a band from 1.0 to 9.0 on a 0.5 grid, a short rationale, and a confidence of \"high\" or \"medium\". ")
	b.WriteString("Also return anchored comments — each with a type (error|praise|suggestion), a criterion, a UTF-16 code-unit anchorStart/anchorEnd into the essay text (or null/null for whole-essay), the comment text, and a confidence. ")
	b.WriteString("Optionally return overallFeedback (or null). ")
	b.WriteString("Respond ONLY with JSON matching: {\"criteria\":{\"taskResponse\":{\"band\":number,\"rationale\":string,\"confidence\":string}, ...for all four}, \"comments\":[{\"type\":string,\"criterion\":string,\"anchorStart\":number|null,\"anchorEnd\":number|null,\"text\":string,\"confidence\":string}], \"overallFeedback\":string|null}.\n\n")
	b.WriteString("ESSAY:\n")
	b.WriteString(essayText)
	return b.String()
}
