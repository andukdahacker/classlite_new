// Story 4.3a — the AI content-generation endpoints.
//
//	POST /api/exercises/{id}/ai-generate → 202 {data:{jobId}}   (enqueue)
//	GET  /api/jobs/{jobId}               → 200 {data:{job...}}   (poll)
//
// Both ride the same authenticated chain as the exercise routes (extractTenant →
// requireVerified → requireCenter → ErrorMapper). Enqueue validates the typed
// {mode, params} body (unknown mode / missing params → 422), builds the canonical
// path-derived job payload (the request cannot smuggle a tenant), and delegates
// the scope gate + single-tx {job insert + -1 deduction} to the service. Enqueue
// never calls Gemini (PERF-3). The 402 insufficient-credits gate is Story 6.5 —
// 4.3a records the -1 without blocking on balance.
package handler

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/model"
	"github.com/ducdo/classlite-api/internal/service"
	"github.com/ducdo/classlite-api/internal/store/generated"
	"github.com/jackc/pgx/v5/pgtype"
)

const (
	// maxAIGenerateBodyBytes bounds the tiny enqueue body (mode + a few params).
	maxAIGenerateBodyBytes = 16 * 1024
	// minGenerationCount / maxGenerationCount bound the questions/distractors count
	// so an absurd (or negative) count cannot enqueue a paid job (CQ-3).
	minGenerationCount = 1
	maxGenerationCount = 20
)

// AIGenerationHandler serves the enqueue + poll endpoints.
type AIGenerationHandler struct {
	svc *service.AIGenerationService
	clk clock.Clock
}

// NewAIGenerationHandler constructs the handler.
func NewAIGenerationHandler(svc *service.AIGenerationService, clk clock.Clock) *AIGenerationHandler {
	return &AIGenerationHandler{svc: svc, clk: clk}
}

// --- wire shapes ---

type enqueueResponse struct {
	JobID string `json:"jobId"`
}

type jobResponse struct {
	ID           string          `json:"id"`
	Type         string          `json:"type"`
	Status       string          `json:"status"`
	Result       json.RawMessage `json:"result"`
	ErrorDetails *string         `json:"errorDetails"`
	CreatedAt    string          `json:"createdAt"`
	StartedAt    *string         `json:"startedAt"`
	CompletedAt  *string         `json:"completedAt"`
}

type enqueueRequestBody struct {
	Mode   string          `json:"mode"`
	Params json.RawMessage `json:"params"`
}

// --- handlers ---

// Enqueue validates the body, builds the path-derived job payload, and returns
// 202 with the new job id.
func (h *AIGenerationHandler) Enqueue(w http.ResponseWriter, r *http.Request) error {
	tc, err := requireOwnerTenant(r)
	if err != nil {
		return err
	}
	exerciseID, err := parseSettingsPathID(r, "id", "EXERCISE_NOT_FOUND", "exercise")
	if err != nil {
		return err
	}

	r.Body = http.MaxBytesReader(w, r.Body, maxAIGenerateBodyBytes)
	var body enqueueRequestBody
	if err := decodeAIGenerateBody(r.Body, &body); err != nil {
		return err
	}

	jobType, ok := model.AIGenerationModeToJobType[body.Mode]
	if !ok {
		return validationError("mode", "INVALID_MODE", "mode must be one of section, questions, distractors")
	}
	if len(body.Params) == 0 {
		return validationError("params", "MISSING_PARAMS", "params is required")
	}
	params, err := buildJobParams(body.Mode, body.Params, exerciseID.String())
	if err != nil {
		return err
	}

	jobID, err := h.svc.EnqueueGeneration(r.Context(), tc, exerciseID, jobType, params)
	if err != nil {
		return err
	}
	WriteEnvelope(w, http.StatusAccepted, h.clk, enqueueResponse{JobID: jobID.String()})
	return nil
}

// PollJob returns the typed job envelope for a job the caller's tenant owns.
func (h *AIGenerationHandler) PollJob(w http.ResponseWriter, r *http.Request) error {
	tc, err := requireOwnerTenant(r)
	if err != nil {
		return err
	}
	jobID, err := parseSettingsPathID(r, "jobId", "JOB_NOT_FOUND", "job")
	if err != nil {
		return err
	}
	job, err := h.svc.GetJob(r.Context(), tc, jobID)
	if err != nil {
		return err
	}
	WriteEnvelope(w, http.StatusOK, h.clk, jobToResponse(job))
	return nil
}

// --- helpers ---

func jobToResponse(job generated.Job) jobResponse {
	result := json.RawMessage(job.Result)
	if len(result) == 0 {
		result = json.RawMessage("null")
	}
	return jobResponse{
		ID:           uuidPgToString(job.ID),
		Type:         job.Type,
		Status:       string(job.Status),
		Result:       result,
		ErrorDetails: textPgToPtr(job.ErrorDetails),
		CreatedAt:    job.CreatedAt.Time.UTC().Format(time.RFC3339Nano),
		StartedAt:    timestamptzPtr(job.StartedAt),
		CompletedAt:  timestamptzPtr(job.CompletedAt),
	}
}

func timestamptzPtr(ts pgtype.Timestamptz) *string {
	if !ts.Valid {
		return nil
	}
	s := ts.Time.UTC().Format(time.RFC3339Nano)
	return &s
}

// buildJobParams decodes the request params for the mode, forces the ExerciseID
// from the URL path, and strips any client-supplied tenant claim (SEC-7) — the
// worker ignores it regardless (R3/A7), but stripping it keeps the stored payload
// honest. Returns the canonical marshaled job payload.
func buildJobParams(mode string, raw json.RawMessage, exerciseID string) ([]byte, error) {
	switch mode {
	case "section":
		var p model.AIGenerateSectionParams
		if err := strictParamsDecode(raw, &p); err != nil {
			return nil, validationError("params", "INVALID_PARAMS", "invalid section params")
		}
		if strings.TrimSpace(p.Topic) == "" {
			return nil, validationError("params.topic", "MISSING_PARAMS", "topic is required")
		}
		p.ExerciseID = exerciseID
		p.CenterIDClaim = ""
		return json.Marshal(p)
	case "questions":
		var p model.AIGenerateQuestionsParams
		if err := strictParamsDecode(raw, &p); err != nil {
			return nil, validationError("params", "INVALID_PARAMS", "invalid questions params")
		}
		if strings.TrimSpace(p.SectionID) == "" {
			return nil, validationError("params.sectionId", "MISSING_PARAMS", "sectionId is required")
		}
		if err := validateGenerationCount(p.Count); err != nil {
			return nil, err
		}
		p.ExerciseID = exerciseID
		p.CenterIDClaim = ""
		return json.Marshal(p)
	case "distractors":
		var p model.AIGenerateDistractorsParams
		if err := strictParamsDecode(raw, &p); err != nil {
			return nil, validationError("params", "INVALID_PARAMS", "invalid distractors params")
		}
		if strings.TrimSpace(p.QuestionID) == "" {
			return nil, validationError("params.questionId", "MISSING_PARAMS", "questionId is required")
		}
		if err := validateGenerationCount(p.Count); err != nil {
			return nil, err
		}
		p.ExerciseID = exerciseID
		p.CenterIDClaim = ""
		return json.Marshal(p)
	default:
		return nil, validationError("mode", "INVALID_MODE", "unknown mode")
	}
}

// strictParamsDecode rejects unknown/misspelled param fields (parity with the
// outer body decoder), so a typo like {"tpoic":"x"} is a 422 rather than a
// silently-empty job that still burns a credit.
func strictParamsDecode(raw json.RawMessage, dst any) error {
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	return dec.Decode(dst)
}

// validateGenerationCount bounds the questions/distractors count so a malformed
// request cannot enqueue a paid job with a zero/negative/absurd count.
func validateGenerationCount(count int) error {
	if count < minGenerationCount || count > maxGenerationCount {
		return validationError("params.count", "INVALID_PARAMS",
			fmt.Sprintf("count must be between %d and %d", minGenerationCount, maxGenerationCount))
	}
	return nil
}

func validationError(field, code, message string) error {
	return model.ValidationError{Fields: []model.FieldError{{Field: field, Code: code, Message: message}}}
}

func decodeAIGenerateBody(r io.Reader, dst *enqueueRequestBody) error {
	dec := json.NewDecoder(r)
	dec.DisallowUnknownFields()
	if err := dec.Decode(dst); err != nil {
		var maxBytesErr *http.MaxBytesError
		if errors.As(err, &maxBytesErr) {
			return &service.PayloadTooLargeError{LimitBytes: maxBytesErr.Limit}
		}
		if errors.Is(err, io.EOF) || errors.Is(err, io.ErrUnexpectedEOF) {
			return validationError("body", "MISSING_BODY", "request body is required")
		}
		return validationError("body", "INVALID_BODY", "invalid JSON")
	}
	return nil
}
