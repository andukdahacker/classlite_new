// Story 5.1 — SubmissionHandler. Thin HTTP binding over SubmissionService. Maps
// the domain result into the api.yaml Submission (all fields present, nulls
// explicit — GO-5) and writes the {data, meta} envelope. Authz + lifecycle rules
// live in the service.
package handler

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/model"
	"github.com/ducdo/classlite-api/internal/service"
	"github.com/ducdo/classlite-api/internal/store"
	"github.com/google/uuid"
)

// SubmissionHandler serves the submission-lifecycle routes.
type SubmissionHandler struct {
	svc *service.SubmissionService
	clk clock.Clock
}

// NewSubmissionHandler constructs a SubmissionHandler.
func NewSubmissionHandler(svc *service.SubmissionService, clk clock.Clock) *SubmissionHandler {
	return &SubmissionHandler{svc: svc, clk: clk}
}

// --- wire shapes ---

type submissionResponse struct {
	ID                string          `json:"id"`
	CenterID          string          `json:"centerId"`
	AssignmentID      string          `json:"assignmentId"`
	StudentID         string          `json:"studentId"`
	Status            string          `json:"status"`
	IsLate            bool            `json:"isLate"`
	AppliedPenalty    float64         `json:"appliedPenalty"`
	StartedAt         string          `json:"startedAt"`
	SubmittedAt       *string         `json:"submittedAt"`
	TimeBudgetSeconds *int            `json:"timeBudgetSeconds"`
	SchemaVersion     int             `json:"schemaVersion"`
	Content           json.RawMessage `json:"content"`
	CreatedAt         string          `json:"createdAt"`
	UpdatedAt         string          `json:"updatedAt"`
}

func submissionToResponse(res service.SubmissionResult) submissionResponse {
	row := res.Row
	return submissionResponse{
		ID:                uuidPgToString(row.ID),
		CenterID:          uuidPgToString(row.CenterID),
		AssignmentID:      uuidPgToString(row.AssignmentID),
		StudentID:         uuidPgToString(row.StudentID),
		Status:            row.Status,
		IsLate:            row.IsLate,
		AppliedPenalty:    numericPgToFloat(row.AppliedPenalty),
		StartedAt:         row.StartedAt.Time.UTC().Format(time.RFC3339Nano),
		SubmittedAt:       timestamptzPtr(row.SubmittedAt),
		TimeBudgetSeconds: res.TimeBudgetSeconds,
		SchemaVersion:     int(row.SchemaVersion),
		Content:           res.Content,
		CreatedAt:         row.CreatedAt.Time.UTC().Format(time.RFC3339Nano),
		UpdatedAt:         row.UpdatedAt.Time.UTC().Format(time.RFC3339Nano),
	}
}

type createSubmissionRequestBody struct {
	AssignmentID string `json:"assignmentId"`
}

type saveSubmissionProgressRequestBody struct {
	Content json.RawMessage `json:"content"`
}

// --- handlers ---

// Start — POST /api/submissions (AC7). 201 for a fresh attempt, 200 to resume.
func (h *SubmissionHandler) Start(w http.ResponseWriter, r *http.Request) error {
	tc, err := requireOwnerTenant(r)
	if err != nil {
		return err
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxAssignmentBodyBytes)
	var body createSubmissionRequestBody
	if err := decodeClassJSONBody(r.Body, &body); err != nil {
		return err
	}
	assignmentID, perr := uuid.Parse(body.AssignmentID)
	if perr != nil {
		return model.ValidationError{Fields: []model.FieldError{{Field: "assignmentId", Message: "expected a UUID"}}}
	}
	res, err := h.svc.Start(r.Context(), tc, assignmentID)
	if err != nil {
		return err
	}
	status := http.StatusOK
	if res.Created {
		status = http.StatusCreated
	}
	WriteEnvelope(w, status, h.clk, submissionToResponse(res))
	return nil
}

// Get — GET /api/submissions/{id} (AC10).
func (h *SubmissionHandler) Get(w http.ResponseWriter, r *http.Request) error {
	tc, err := requireOwnerTenant(r)
	if err != nil {
		return err
	}
	id, err := parseSettingsPathID(r, "id", "SUBMISSION_NOT_FOUND", "submission")
	if err != nil {
		return err
	}
	res, err := h.svc.GetByID(r.Context(), tc, id)
	if err != nil {
		return err
	}
	WriteEnvelope(w, http.StatusOK, h.clk, submissionToResponse(res))
	return nil
}

// SaveProgress — PUT /api/submissions/{id}/progress (AC9,10). The body cap is
// MaxSubmissionContentBytes, enforced pre-decode via MaxBytesReader → 413.
func (h *SubmissionHandler) SaveProgress(w http.ResponseWriter, r *http.Request) error {
	tc, err := requireOwnerTenant(r)
	if err != nil {
		return err
	}
	id, err := parseSettingsPathID(r, "id", "SUBMISSION_NOT_FOUND", "submission")
	if err != nil {
		return err
	}
	r.Body = http.MaxBytesReader(w, r.Body, store.MaxSubmissionContentBytes)
	var body saveSubmissionProgressRequestBody
	if err := decodeClassJSONBody(r.Body, &body); err != nil {
		return err
	}
	if len(body.Content) == 0 {
		return model.ValidationError{Fields: []model.FieldError{{Field: "content", Message: "content is required"}}}
	}
	res, err := h.svc.SaveProgress(r.Context(), tc, id, body.Content)
	if err != nil {
		return err
	}
	WriteEnvelope(w, http.StatusOK, h.clk, submissionToResponse(res))
	return nil
}

// Submit — POST /api/submissions/{id}/submit (AC11,12).
func (h *SubmissionHandler) Submit(w http.ResponseWriter, r *http.Request) error {
	tc, err := requireOwnerTenant(r)
	if err != nil {
		return err
	}
	id, err := parseSettingsPathID(r, "id", "SUBMISSION_NOT_FOUND", "submission")
	if err != nil {
		return err
	}
	res, err := h.svc.Submit(r.Context(), tc, id)
	if err != nil {
		return err
	}
	WriteEnvelope(w, http.StatusOK, h.clk, submissionToResponse(res))
	return nil
}
