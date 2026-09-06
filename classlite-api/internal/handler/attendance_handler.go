// Package handler — Story 3.5b AttendanceHandler.
//
// Three session-scoped, teacher-facing endpoints on the existing sessionChain
// (extractTenant → requireVerified → requireCenter → ErrorMapper — NOT
// owner-gated). Role + tenant + teacher-scope are enforced in the service
// (student → 403; cross-teacher / cross-tenant session → 404). Bodies decode
// strictly; responses use the {data,meta} envelope with explicit nulls (GO-5).
// Attendance is recordable on past AND cancelled sessions — no time/status gate.
package handler

import (
	"net/http"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/model"
	"github.com/ducdo/classlite-api/internal/service"
	"github.com/google/uuid"
)

type AttendanceHandler struct {
	svc *service.AttendanceService
	clk clock.Clock
}

func NewAttendanceHandler(svc *service.AttendanceService, clk clock.Clock) *AttendanceHandler {
	return &AttendanceHandler{svc: svc, clk: clk}
}

// --- wire DTOs (GO-5 explicit nulls) ---

type attendanceRosterEntryResponse struct {
	StudentID string  `json:"studentId"`
	Name      string  `json:"name"`
	Email     string  `json:"email"`
	Status    *string `json:"status"`
	MarkedAt  *string `json:"markedAt"`
}

type attendanceRosterResponse struct {
	Roster []attendanceRosterEntryResponse `json:"roster"`
}

func attendanceEntryToResponse(e service.AttendanceEntry) attendanceRosterEntryResponse {
	return attendanceRosterEntryResponse{
		StudentID: uuidPgToString(e.StudentID),
		Name:      e.Name,
		Email:     e.Email,
		Status:    textPgToPtr(e.Status),
		MarkedAt:  tstzPgToPtr(e.MarkedAt),
	}
}

func rosterToResponse(entries []service.AttendanceEntry) attendanceRosterResponse {
	out := make([]attendanceRosterEntryResponse, len(entries))
	for i, e := range entries {
		out[i] = attendanceEntryToResponse(e)
	}
	return attendanceRosterResponse{Roster: out}
}

// --- request bodies ---

type setAttendanceRequestBody struct {
	Status string `json:"status"`
}

type bulkAttendanceRequestBody struct {
	Status     string   `json:"status"`
	StudentIds []string `json:"studentIds"`
}

// validAttendanceStatus reports whether s is one of the three recordable states.
func validAttendanceStatus(s string) bool {
	return s == "present" || s == "late" || s == "absent"
}

func attendanceStatusError() error {
	return model.ValidationError{Fields: []model.FieldError{{Field: "status", Message: "status must be one of present, late, absent"}}}
}

func (h *AttendanceHandler) decodeBody(w http.ResponseWriter, r *http.Request, dst any) error {
	r.Body = http.MaxBytesReader(w, r.Body, maxSessionBodyBytes)
	return decodeClassJSONBody(r.Body, dst)
}

// tenantAndSession resolves the tenant context + the {id} session path param
// common to every attendance endpoint.
func (h *AttendanceHandler) tenantAndSession(r *http.Request) (model.TenantContext, uuid.UUID, error) {
	tc, err := requireOwnerTenant(r)
	if err != nil {
		return model.TenantContext{}, uuid.UUID{}, err
	}
	sessionID, err := parseSettingsPathID(r, "id", "SESSION_NOT_FOUND", "session")
	if err != nil {
		return model.TenantContext{}, uuid.UUID{}, err
	}
	return tc, sessionID, nil
}

// GetRoster — GET /api/sessions/{id}/attendance (AC4).
func (h *AttendanceHandler) GetRoster(w http.ResponseWriter, r *http.Request) error {
	tc, sessionID, err := h.tenantAndSession(r)
	if err != nil {
		return err
	}
	entries, err := h.svc.GetRoster(r.Context(), tc, sessionID)
	if err != nil {
		return err
	}
	WriteEnvelope(w, http.StatusOK, h.clk, rosterToResponse(entries))
	return nil
}

// SetOne — PUT /api/sessions/{id}/attendance/{studentId} (AC6/AC7).
func (h *AttendanceHandler) SetOne(w http.ResponseWriter, r *http.Request) error {
	tc, sessionID, err := h.tenantAndSession(r)
	if err != nil {
		return err
	}
	studentID, err := parseAttendanceStudentID(r)
	if err != nil {
		return err
	}
	var body setAttendanceRequestBody
	if err := h.decodeBody(w, r, &body); err != nil {
		return err
	}
	if !validAttendanceStatus(body.Status) {
		return attendanceStatusError()
	}
	entry, err := h.svc.SetOne(r.Context(), tc, sessionID, studentID, body.Status)
	if err != nil {
		return err
	}
	WriteEnvelope(w, http.StatusOK, h.clk, attendanceEntryToResponse(entry))
	return nil
}

// BulkMark — POST /api/sessions/{id}/attendance/bulk (AC8/AC9).
func (h *AttendanceHandler) BulkMark(w http.ResponseWriter, r *http.Request) error {
	tc, sessionID, err := h.tenantAndSession(r)
	if err != nil {
		return err
	}
	var body bulkAttendanceRequestBody
	if err := h.decodeBody(w, r, &body); err != nil {
		return err
	}
	if !validAttendanceStatus(body.Status) {
		return attendanceStatusError()
	}
	studentIDs, err := parseAttendanceStudentIDs(body.StudentIds)
	if err != nil {
		return err
	}
	entries, err := h.svc.BulkMark(r.Context(), tc, sessionID, body.Status, studentIDs)
	if err != nil {
		return err
	}
	WriteEnvelope(w, http.StatusOK, h.clk, rosterToResponse(entries))
	return nil
}

// parseAttendanceStudentID parses the {studentId} path param; a malformed uuid
// is a 422 VALIDATION_ERROR (the caller sent bad input, not a missing resource).
func parseAttendanceStudentID(r *http.Request) (uuid.UUID, error) {
	raw := r.PathValue("studentId")
	id, err := uuid.Parse(raw)
	if err != nil {
		return uuid.UUID{}, model.ValidationError{Fields: []model.FieldError{{Field: "studentId", Message: "studentId must be a valid UUID"}}}
	}
	return id, nil
}

// parseAttendanceStudentIDs parses the optional bulk studentIds array. A nil/
// empty slice stays nil (→ apply to all active students); any malformed uuid is
// a 422 VALIDATION_ERROR.
func parseAttendanceStudentIDs(raw []string) ([]uuid.UUID, error) {
	if len(raw) == 0 {
		return nil, nil
	}
	out := make([]uuid.UUID, 0, len(raw))
	for _, s := range raw {
		id, err := uuid.Parse(s)
		if err != nil {
			return nil, model.ValidationError{Fields: []model.FieldError{{Field: "studentIds", Message: "studentIds must all be valid UUIDs"}}}
		}
		out = append(out, id)
	}
	return out, nil
}
