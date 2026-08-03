// Story 5.2a — the student attempt-READ handlers. Thin HTTP binding over the
// SubmissionService read methods: GET /api/submissions/{id}/attempt (the
// answer-stripped attempt bundle) and GET /api/assignments (the student's
// enrollment-scoped assignment list). Authz + the answer strip live in the
// service; these handlers map the domain result into the api.yaml wire shapes
// (all fields present, nulls explicit — GO-5) and write the {data, meta} envelope.
package handler

import (
	"net/http"
	"time"

	"github.com/ducdo/classlite-api/internal/service"
	"github.com/ducdo/classlite-api/internal/store/generated"
)

// --- wire shapes ---

// studentAssignmentView is the AC7 whitelist — the student-safe subset of an
// assignment (omits centerId + createdBy). Nulls explicit; no omitempty.
type studentAssignmentView struct {
	ID             string  `json:"id"`
	ExerciseID     string  `json:"exerciseId"`
	ClassID        string  `json:"classId"`
	Status         string  `json:"status"`
	DeadlineAt     string  `json:"deadlineAt"`
	HardDeadlineAt *string `json:"hardDeadlineAt"`
	Instructions   *string `json:"instructions"`
	LatePenalty    float64 `json:"latePenalty"`
	CreatedAt      string  `json:"createdAt"`
	UpdatedAt      string  `json:"updatedAt"`
}

func studentAssignmentViewFromRow(a generated.Assignment) studentAssignmentView {
	return studentAssignmentView{
		ID:             uuidPgToString(a.ID),
		ExerciseID:     uuidPgToString(a.ExerciseID),
		ClassID:        uuidPgToString(a.ClassID),
		Status:         a.Status,
		DeadlineAt:     a.DeadlineAt.Time.UTC().Format(time.RFC3339Nano),
		HardDeadlineAt: timestamptzPtr(a.HardDeadlineAt),
		Instructions:   textPgToPtr(a.Instructions),
		LatePenalty:    numericPgToFloat(a.LatePenalty),
		CreatedAt:      a.CreatedAt.Time.UTC().Format(time.RFC3339Nano),
		UpdatedAt:      a.UpdatedAt.Time.UTC().Format(time.RFC3339Nano),
	}
}

// attemptBundleResponse is the api.yaml AttemptBundle: the student's own
// submission + the student-safe assignment subset + the answer-stripped exercise.
type attemptBundleResponse struct {
	Submission submissionResponse      `json:"submission"`
	Assignment studentAssignmentView   `json:"assignment"`
	Exercise   service.AttemptExercise `json:"exercise"`
}

func attemptBundleToResponse(res service.AttemptBundleResult) attemptBundleResponse {
	return attemptBundleResponse{
		Submission: submissionToResponse(res.Submission),
		Assignment: studentAssignmentViewFromRow(res.Assignment),
		Exercise:   res.Exercise,
	}
}

// studentAssignmentListItem is a studentAssignmentView + the exercise header + the
// caller's own submission summary (nullable when not started).
type studentAssignmentListItem struct {
	ID               string  `json:"id"`
	ExerciseID       string  `json:"exerciseId"`
	ClassID          string  `json:"classId"`
	Status           string  `json:"status"`
	DeadlineAt       string  `json:"deadlineAt"`
	HardDeadlineAt   *string `json:"hardDeadlineAt"`
	Instructions     *string `json:"instructions"`
	LatePenalty      float64 `json:"latePenalty"`
	CreatedAt        string  `json:"createdAt"`
	UpdatedAt        string  `json:"updatedAt"`
	ExerciseTitle    string  `json:"exerciseTitle"`
	ExerciseSkill    string  `json:"exerciseSkill"`
	SubmissionID     *string `json:"submissionId"`
	SubmissionStatus *string `json:"submissionStatus"`
}

func studentAssignmentListItemFromRow(row generated.ListStudentAssignmentsRow) studentAssignmentListItem {
	return studentAssignmentListItem{
		ID:               uuidPgToString(row.ID),
		ExerciseID:       uuidPgToString(row.ExerciseID),
		ClassID:          uuidPgToString(row.ClassID),
		Status:           row.Status,
		DeadlineAt:       row.DeadlineAt.Time.UTC().Format(time.RFC3339Nano),
		HardDeadlineAt:   timestamptzPtr(row.HardDeadlineAt),
		Instructions:     textPgToPtr(row.Instructions),
		LatePenalty:      numericPgToFloat(row.LatePenalty),
		CreatedAt:        row.CreatedAt.Time.UTC().Format(time.RFC3339Nano),
		UpdatedAt:        row.UpdatedAt.Time.UTC().Format(time.RFC3339Nano),
		ExerciseTitle:    row.ExerciseTitle,
		ExerciseSkill:    row.ExerciseSkill,
		SubmissionID:     uuidPgToPtr(row.SubmissionID),
		SubmissionStatus: textPgToPtr(row.SubmissionStatus),
	}
}

// --- handlers ---

// GetAttempt — GET /api/submissions/{id}/attempt (AC5-12). Student-only,
// owner+enrolled; the answer-stripped bundle. NOT lock-gated (D6). Role +
// ownership + enrollment gates live in the service.
func (h *SubmissionHandler) GetAttempt(w http.ResponseWriter, r *http.Request) error {
	tc, err := requireOwnerTenant(r)
	if err != nil {
		return err
	}
	id, err := parseSettingsPathID(r, "id", "SUBMISSION_NOT_FOUND", "submission")
	if err != nil {
		return err
	}
	res, err := h.svc.GetAttemptBundle(r.Context(), tc, id)
	if err != nil {
		return err
	}
	WriteEnvelope(w, http.StatusOK, h.clk, attemptBundleToResponse(res))
	return nil
}

// ListStudentAssignments — GET /api/assignments (AC1-4). The STUDENT collection
// (D4): student-only, enrollment-scoped. Teachers use the class-scoped list. Meta
// is built from the service's CLAMPED page/pageSize, not the raw query params.
func (h *SubmissionHandler) ListStudentAssignments(w http.ResponseWriter, r *http.Request) error {
	tc, err := requireOwnerTenant(r)
	if err != nil {
		return err
	}
	page, pageSize := parsePageParams(r)
	rows, total, page, pageSize, err := h.svc.ListStudentAssignments(r.Context(), tc, page, pageSize)
	if err != nil {
		return err
	}
	out := make([]studentAssignmentListItem, len(rows))
	for i, row := range rows {
		out[i] = studentAssignmentListItemFromRow(row)
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
