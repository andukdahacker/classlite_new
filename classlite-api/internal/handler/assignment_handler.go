// Story 5.1 — AssignmentHandler. Thin HTTP binding over AssignmentService: decode
// + validate the wire shape, map the domain row into the api.yaml Assignment
// (all fields present, nulls explicit — GO-5), and write the {data, meta}
// envelope. Authz + business rules live in the service.
package handler

import (
	"net/http"
	"strconv"
	"time"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/model"
	"github.com/ducdo/classlite-api/internal/service"
	"github.com/ducdo/classlite-api/internal/store/generated"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

const maxAssignmentBodyBytes = 16 * 1024

// AssignmentHandler serves the assignment-management routes.
type AssignmentHandler struct {
	svc *service.AssignmentService
	clk clock.Clock
}

// NewAssignmentHandler constructs an AssignmentHandler.
func NewAssignmentHandler(svc *service.AssignmentService, clk clock.Clock) *AssignmentHandler {
	return &AssignmentHandler{svc: svc, clk: clk}
}

// --- wire shapes ---

type assignmentResponse struct {
	ID             string  `json:"id"`
	CenterID       string  `json:"centerId"`
	ExerciseID     string  `json:"exerciseId"`
	ClassID        string  `json:"classId"`
	CreatedBy      *string `json:"createdBy"`
	Status         string  `json:"status"`
	DeadlineAt     string  `json:"deadlineAt"`
	HardDeadlineAt *string `json:"hardDeadlineAt"`
	Instructions   *string `json:"instructions"`
	LatePenalty    float64 `json:"latePenalty"`
	CreatedAt      string  `json:"createdAt"`
	UpdatedAt      string  `json:"updatedAt"`
}

func assignmentToResponse(a generated.Assignment) assignmentResponse {
	return assignmentResponse{
		ID:             uuidPgToString(a.ID),
		CenterID:       uuidPgToString(a.CenterID),
		ExerciseID:     uuidPgToString(a.ExerciseID),
		ClassID:        uuidPgToString(a.ClassID),
		CreatedBy:      uuidPgToPtr(a.CreatedBy),
		Status:         a.Status,
		DeadlineAt:     a.DeadlineAt.Time.UTC().Format(time.RFC3339Nano),
		HardDeadlineAt: timestamptzPtr(a.HardDeadlineAt),
		Instructions:   textPgToPtr(a.Instructions),
		LatePenalty:    numericPgToFloat(a.LatePenalty),
		CreatedAt:      a.CreatedAt.Time.UTC().Format(time.RFC3339Nano),
		UpdatedAt:      a.UpdatedAt.Time.UTC().Format(time.RFC3339Nano),
	}
}

type createAssignmentRequestBody struct {
	ExerciseID     string   `json:"exerciseId"`
	ClassID        string   `json:"classId"`
	DeadlineAt     string   `json:"deadlineAt"`
	HardDeadlineAt *string  `json:"hardDeadlineAt"`
	Instructions   *string  `json:"instructions"`
	LatePenalty    *float64 `json:"latePenalty"`
}

func (b createAssignmentRequestBody) parse() (service.CreateAssignmentInput, error) {
	var fields []model.FieldError
	exerciseID, err := uuid.Parse(b.ExerciseID)
	if err != nil {
		fields = append(fields, model.FieldError{Field: "exerciseId", Message: "expected a UUID"})
	}
	classID, err := uuid.Parse(b.ClassID)
	if err != nil {
		fields = append(fields, model.FieldError{Field: "classId", Message: "expected a UUID"})
	}
	deadlineAt, err := time.Parse(time.RFC3339, b.DeadlineAt)
	if err != nil {
		fields = append(fields, model.FieldError{Field: "deadlineAt", Message: "expected an RFC3339 timestamp"})
	}
	var hardDeadline *time.Time
	if b.HardDeadlineAt != nil {
		hd, herr := time.Parse(time.RFC3339, *b.HardDeadlineAt)
		if herr != nil {
			fields = append(fields, model.FieldError{Field: "hardDeadlineAt", Message: "expected an RFC3339 timestamp"})
		} else {
			hardDeadline = &hd
		}
	}
	if len(fields) > 0 {
		return service.CreateAssignmentInput{}, model.ValidationError{Fields: fields}
	}
	return service.CreateAssignmentInput{
		ExerciseID:     exerciseID,
		ClassID:        classID,
		DeadlineAt:     deadlineAt,
		HardDeadlineAt: hardDeadline,
		Instructions:   b.Instructions,
		LatePenalty:    b.LatePenalty,
	}, nil
}

type updateAssignmentRequestBody struct {
	Status string `json:"status"`
}

// --- handlers ---

// Create — POST /api/assignments (AC1).
func (h *AssignmentHandler) Create(w http.ResponseWriter, r *http.Request) error {
	tc, err := requireOwnerTenant(r)
	if err != nil {
		return err
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxAssignmentBodyBytes)
	var body createAssignmentRequestBody
	if err := decodeClassJSONBody(r.Body, &body); err != nil {
		return err
	}
	in, verr := body.parse()
	if verr != nil {
		return verr
	}
	created, err := h.svc.Create(r.Context(), tc, in)
	if err != nil {
		return err
	}
	WriteEnvelope(w, http.StatusCreated, h.clk, assignmentToResponse(created))
	return nil
}

// Get — GET /api/assignments/{id} (AC6).
func (h *AssignmentHandler) Get(w http.ResponseWriter, r *http.Request) error {
	tc, err := requireOwnerTenant(r)
	if err != nil {
		return err
	}
	id, err := parseSettingsPathID(r, "id", "ASSIGNMENT_NOT_FOUND", "assignment")
	if err != nil {
		return err
	}
	row, err := h.svc.GetByID(r.Context(), tc, id)
	if err != nil {
		return err
	}
	WriteEnvelope(w, http.StatusOK, h.clk, assignmentToResponse(row))
	return nil
}

// UpdateStatus — PATCH /api/assignments/{id} (AC5).
func (h *AssignmentHandler) UpdateStatus(w http.ResponseWriter, r *http.Request) error {
	tc, err := requireOwnerTenant(r)
	if err != nil {
		return err
	}
	id, err := parseSettingsPathID(r, "id", "ASSIGNMENT_NOT_FOUND", "assignment")
	if err != nil {
		return err
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxAssignmentBodyBytes)
	var body updateAssignmentRequestBody
	if err := decodeClassJSONBody(r.Body, &body); err != nil {
		return err
	}
	updated, err := h.svc.UpdateStatus(r.Context(), tc, id, body.Status)
	if err != nil {
		return err
	}
	WriteEnvelope(w, http.StatusOK, h.clk, assignmentToResponse(updated))
	return nil
}

// ListByClass — GET /api/classes/{classId}/assignments (AC6).
func (h *AssignmentHandler) ListByClass(w http.ResponseWriter, r *http.Request) error {
	tc, err := requireOwnerTenant(r)
	if err != nil {
		return err
	}
	classID, err := parseSettingsPathID(r, "classId", "CLASS_NOT_FOUND", "class")
	if err != nil {
		return err
	}
	page, pageSize := parsePageParams(r)
	// The service returns the clamped page/pageSize; build the meta from those so an
	// over-cap pageSize or out-of-range page is not echoed back with wrong totals.
	rows, total, page, pageSize, err := h.svc.ListByClass(r.Context(), tc, classID, page, pageSize)
	if err != nil {
		return err
	}
	out := make([]assignmentResponse, len(rows))
	for i, row := range rows {
		out[i] = assignmentToResponse(row)
	}
	totalPages := 0
	if pageSize > 0 {
		totalPages = (total + pageSize - 1) / pageSize
	}
	meta := listPaginatedMeta{
		ServerTime: h.clk.Now().UTC().Format(time.RFC3339Nano),
		Pagination: PaginationMeta{Page: page, PageSize: pageSize, Total: total, TotalPages: totalPages},
	}
	WriteEnvelopeWithMeta(w, http.StatusOK, out, meta)
	return nil
}

// listPaginatedMeta is the {serverTime, pagination} meta for plain paginated
// lists (api.yaml EnvelopeMetaListPaginated).
type listPaginatedMeta struct {
	ServerTime string         `json:"serverTime"`
	Pagination PaginationMeta `json:"pagination"`
}

// parsePageParams reads page/pageSize query params (XL-2); invalid/absent values
// fall back to the service defaults (which it clamps).
func parsePageParams(r *http.Request) (int, int) {
	page := 1
	pageSize := 20
	if v := r.URL.Query().Get("page"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			page = n
		}
	}
	if v := r.URL.Query().Get("pageSize"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			pageSize = n
		}
	}
	return page, pageSize
}

// numericPgToFloat is numericPgToPtr with a 0 fallback for a NOT NULL numeric
// column (latePenalty / appliedPenalty).
func numericPgToFloat(n pgtype.Numeric) float64 {
	if p := numericPgToPtr(n); p != nil {
		return *p
	}
	return 0
}
