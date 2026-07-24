// Package handler — Story 3.4.5 EnrollmentHandler.
//
// Two endpoints on the enrollmentChain (= classChain/sessionChain shape:
// extractTenant → requireVerified → requireCenter → ErrorMapper — NOT
// owner-gated, so teachers reach the roster read). Role + teacher-scope are
// enforced in the service (Create is Admin/Owner only, DB-revalidated; the
// roster is teacher-scoped → 404 off own classes). Responses use the {data,meta}
// envelope with explicit nulls (GO-5).
package handler

import (
	"net/http"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/model"
	"github.com/ducdo/classlite-api/internal/service"
	"github.com/ducdo/classlite-api/internal/store/generated"
	"github.com/google/uuid"
)

const maxEnrollmentBodyBytes = 16 * 1024

type EnrollmentHandler struct {
	svc *service.EnrollmentService
	clk clock.Clock
}

func NewEnrollmentHandler(svc *service.EnrollmentService, clk clock.Clock) *EnrollmentHandler {
	return &EnrollmentHandler{svc: svc, clk: clk}
}

// enrollmentResponse is the api.yaml Enrollment wire shape — every field
// explicit, nullables as pointers (GO-5).
type enrollmentResponse struct {
	ID           string  `json:"id"`
	CenterID     string  `json:"centerId"`
	StudentID    string  `json:"studentId"`
	ClassID      string  `json:"classId"`
	StudentName  string  `json:"studentName"`
	StudentEmail string  `json:"studentEmail"`
	EnrolledAt   string  `json:"enrolledAt"`
	WithdrawnAt  *string `json:"withdrawnAt"`
	Status       string  `json:"status"`
}

func enrolledStudentToResponse(e service.EnrolledStudent) enrollmentResponse {
	return enrollmentResponse{
		ID:           uuidPgToString(e.Enrollment.ID),
		CenterID:     uuidPgToString(e.Enrollment.CenterID),
		StudentID:    uuidPgToString(e.Enrollment.StudentID),
		ClassID:      uuidPgToString(e.Enrollment.ClassID),
		StudentName:  e.StudentName,
		StudentEmail: e.StudentEmail,
		EnrolledAt:   tstzToString(e.Enrollment.EnrolledAt),
		WithdrawnAt:  tstzPgToPtr(e.Enrollment.WithdrawnAt),
		Status:       e.Enrollment.Status,
	}
}

func rosterRowToResponse(r generated.ListEnrolledStudentsByClassRow) enrollmentResponse {
	return enrollmentResponse{
		ID:           uuidPgToString(r.ID),
		CenterID:     uuidPgToString(r.CenterID),
		StudentID:    uuidPgToString(r.StudentID),
		ClassID:      uuidPgToString(r.ClassID),
		StudentName:  r.StudentName,
		StudentEmail: r.StudentEmail,
		EnrolledAt:   tstzToString(r.EnrolledAt),
		WithdrawnAt:  tstzPgToPtr(r.WithdrawnAt),
		Status:       r.Status,
	}
}

// Create — POST /api/enrollments (story 3.4.5 AC2). Admin/Owner only (enforced
// in the service via a DB role re-fetch).
func (h *EnrollmentHandler) Create(w http.ResponseWriter, r *http.Request) error {
	// requireOwnerTenant only extracts/validates the tenant context — despite the
	// name it does NOT enforce an owner role. The real Admin/Owner gate is DB-side
	// in svc.CreateEnrollment (SEC-1, role re-fetched from center_members).
	tc, err := requireOwnerTenant(r)
	if err != nil {
		return err
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxEnrollmentBodyBytes)
	var body createEnrollmentRequestBody
	if err := decodeClassJSONBody(r.Body, &body); err != nil {
		return err
	}
	studentID, classID, verr := body.parse()
	if verr != nil {
		return verr
	}
	result, err := h.svc.CreateEnrollment(r.Context(), tc, studentID, classID)
	if err != nil {
		return err
	}
	WriteEnvelope(w, http.StatusCreated, h.clk, enrolledStudentToResponse(result))
	return nil
}

// ListByClass — GET /api/classes/{classId}/enrollments (story 3.4.5 AC3).
func (h *EnrollmentHandler) ListByClass(w http.ResponseWriter, r *http.Request) error {
	// Tenant-context extractor only (not an owner gate — see Create). The roster
	// is reachable by owner/admin/teacher; role + teacher-scope are enforced in
	// svc.ListEnrolledStudentsByClass.
	tc, err := requireOwnerTenant(r)
	if err != nil {
		return err
	}
	classID, err := parseSettingsPathID(r, "classId", "CLASS_NOT_FOUND", "class")
	if err != nil {
		return err
	}
	rows, err := h.svc.ListEnrolledStudentsByClass(r.Context(), tc, classID)
	if err != nil {
		return err
	}
	out := make([]enrollmentResponse, len(rows))
	for i, row := range rows {
		out[i] = rosterRowToResponse(row)
	}
	WriteEnvelope(w, http.StatusOK, h.clk, out)
	return nil
}

// --- request body ---

type createEnrollmentRequestBody struct {
	StudentID string `json:"studentId"`
	ClassID   string `json:"classId"`
}

func (b createEnrollmentRequestBody) parse() (uuid.UUID, uuid.UUID, error) {
	studentID, err := uuid.Parse(b.StudentID)
	if err != nil {
		return uuid.UUID{}, uuid.UUID{}, model.ValidationError{Fields: []model.FieldError{{Field: "studentId", Message: "expected a UUID"}}}
	}
	classID, err := uuid.Parse(b.ClassID)
	if err != nil {
		return uuid.UUID{}, uuid.UUID{}, model.ValidationError{Fields: []model.FieldError{{Field: "classId", Message: "expected a UUID"}}}
	}
	return studentID, classID, nil
}
