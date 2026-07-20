// Package handler — Story 3.1 ClassHandler.
//
// Five endpoints on the classChain (extractTenant → requireVerified →
// requireCenter → ErrorMapper — NOT owner-gated, so teachers reach it). List
// branches on the DB-authoritative tc.Role (owner/admin = all center classes;
// teacher = own only) — the role branch lives here, never in RLS (SEC-1,
// PERF-2). Cross-teacher access on {id} endpoints returns 404 CLASS_NOT_FOUND
// (teacher-sees-nothing, AC6), enforced in the service. Bodies decode strictly
// (DisallowUnknownFields). All responses use the {data,meta} envelope with
// explicit nulls (GO-5).
package handler

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"time"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/model"
	"github.com/ducdo/classlite-api/internal/service"
	"github.com/ducdo/classlite-api/internal/store/generated"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

const maxClassBodyBytes = 16 * 1024

type ClassHandler struct {
	svc *service.ClassService
	clk clock.Clock
}

func NewClassHandler(svc *service.ClassService, clk clock.Clock) *ClassHandler {
	return &ClassHandler{svc: svc, clk: clk}
}

// classResponse is the api.yaml Class wire shape — every field explicit,
// nullables as pointers (GO-5: no omitempty, explicit null for absent values).
type classResponse struct {
	ID                  string   `json:"id"`
	CenterID            string   `json:"centerId"`
	TemplateID          *string  `json:"templateId"`
	Name                string   `json:"name"`
	Description         *string  `json:"description"`
	TargetBand          *float64 `json:"targetBand"`
	PrimarySkill        *string  `json:"primarySkill"`
	SessionCount        *int32   `json:"sessionCount"`
	Capacity            *int32   `json:"capacity"`
	Status              string   `json:"status"`
	TeacherID           *string  `json:"teacherId"`
	PendingTeacherEmail *string  `json:"pendingTeacherEmail"`
	StartDate           *string  `json:"startDate"`
	EndDate             *string  `json:"endDate"`
	Color               *string  `json:"color"`
	DueDatesEnabled     bool     `json:"dueDatesEnabled"`
	CreatedAt           string   `json:"createdAt"`
	UpdatedAt           string   `json:"updatedAt"`
}

func classToResponse(c generated.Class) classResponse {
	return classResponse{
		ID:                  uuidPgToString(c.ID),
		CenterID:            uuidPgToString(c.CenterID),
		TemplateID:          uuidPgToPtr(c.TemplateID),
		Name:                c.Name,
		Description:         textPgToPtr(c.Description),
		TargetBand:          numericPgToPtr(c.TargetBand),
		PrimarySkill:        textPgToPtr(c.PrimarySkill),
		SessionCount:        int4PgToPtr(c.SessionCount),
		Capacity:            int4PgToPtr(c.Capacity),
		Status:              c.Status,
		TeacherID:           uuidPgToPtr(c.TeacherID),
		PendingTeacherEmail: textPgToPtr(c.PendingTeacherEmail),
		StartDate:           datePgToPtr(c.StartDate),
		EndDate:             datePgToPtr(c.EndDate),
		Color:               textPgToPtr(c.Color),
		DueDatesEnabled:     c.DueDatesEnabled,
		CreatedAt:           c.CreatedAt.Time.Format("2006-01-02T15:04:05Z07:00"),
		UpdatedAt:           c.UpdatedAt.Time.Format("2006-01-02T15:04:05Z07:00"),
	}
}

// List returns classes scoped to the caller role (AC5). owner/admin → all;
// teacher → own; any other role (e.g. student) → 403.
func (h *ClassHandler) List(w http.ResponseWriter, r *http.Request) error {
	tc, err := requireOwnerTenant(r) // pure tenant extractor (role gating is middleware)
	if err != nil {
		return err
	}

	var rows []generated.Class
	switch tc.Role {
	case model.RoleOwner, model.RoleAdmin:
		rows, err = h.svc.List(r.Context(), tc)
	case model.RoleTeacher:
		uid, uerr := userIDFromContext(r)
		if uerr != nil {
			return uerr
		}
		rows, err = h.svc.ListForTeacher(r.Context(), tc, uid)
	default:
		return &service.ForbiddenError{Reason: "insufficient role"}
	}
	if err != nil {
		return err
	}

	out := make([]classResponse, len(rows))
	for i, x := range rows {
		out[i] = classToResponse(x)
	}
	WriteEnvelope(w, http.StatusOK, h.clk, out)
	return nil
}

func (h *ClassHandler) Create(w http.ResponseWriter, r *http.Request) error {
	tc, err := requireOwnerTenant(r)
	if err != nil {
		return err
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxClassBodyBytes)
	var body createClassRequestBody
	if err := decodeClassJSONBody(r.Body, &body); err != nil {
		return err
	}
	in, verr := body.toCreateInput()
	if verr != nil {
		return verr
	}
	created, err := h.svc.Create(r.Context(), tc, in)
	if err != nil {
		return err
	}
	WriteEnvelope(w, http.StatusCreated, h.clk, classToResponse(created))
	return nil
}

func (h *ClassHandler) Get(w http.ResponseWriter, r *http.Request) error {
	tc, err := requireOwnerTenant(r)
	if err != nil {
		return err
	}
	id, err := parseSettingsPathID(r, "id", "CLASS_NOT_FOUND", "class")
	if err != nil {
		return err
	}
	row, err := h.svc.Get(r.Context(), tc, id)
	if err != nil {
		return err
	}
	WriteEnvelope(w, http.StatusOK, h.clk, classToResponse(row))
	return nil
}

func (h *ClassHandler) Update(w http.ResponseWriter, r *http.Request) error {
	tc, err := requireOwnerTenant(r)
	if err != nil {
		return err
	}
	id, err := parseSettingsPathID(r, "id", "CLASS_NOT_FOUND", "class")
	if err != nil {
		return err
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxClassBodyBytes)
	var body updateClassRequestBody
	if err := decodeClassJSONBody(r.Body, &body); err != nil {
		return err
	}
	in, verr := body.toUpdateInput()
	if verr != nil {
		return verr
	}
	updated, err := h.svc.Update(r.Context(), tc, id, in)
	if err != nil {
		return err
	}
	WriteEnvelope(w, http.StatusOK, h.clk, classToResponse(updated))
	return nil
}

func (h *ClassHandler) TransitionStatus(w http.ResponseWriter, r *http.Request) error {
	tc, err := requireOwnerTenant(r)
	if err != nil {
		return err
	}
	id, err := parseSettingsPathID(r, "id", "CLASS_NOT_FOUND", "class")
	if err != nil {
		return err
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxClassBodyBytes)
	var body struct {
		Status string `json:"status"`
	}
	if err := decodeClassJSONBody(r.Body, &body); err != nil {
		return err
	}
	// Garbage status (unknown/wrong-case/empty) → validation-422 at the
	// boundary, a DISTINCT shape from INVALID_STATUS_TRANSITION — it never
	// reaches the service transition map (party-mode risk).
	if !isValidClassStatus(body.Status) {
		return model.ValidationError{Fields: []model.FieldError{{
			Field: "status", Code: "INVALID_STATUS", Message: "unknown class status",
		}}}
	}
	updated, err := h.svc.TransitionStatus(r.Context(), tc, id, body.Status)
	if err != nil {
		return err
	}
	WriteEnvelope(w, http.StatusOK, h.clk, classToResponse(updated))
	return nil
}

func isValidClassStatus(s string) bool {
	switch s {
	case service.ClassStatusUpcoming, service.ClassStatusActive,
		service.ClassStatusPaused, service.ClassStatusEnded:
		return true
	}
	return false
}

// --- request bodies ---

type createClassRequestBody struct {
	TemplateID          *string  `json:"templateId"`
	Name                string   `json:"name"`
	Description         *string  `json:"description"`
	TargetBand          *float64 `json:"targetBand"`
	PrimarySkill        *string  `json:"primarySkill"`
	SessionCount        *int32   `json:"sessionCount"`
	Capacity            *int32   `json:"capacity"`
	TeacherID           *string  `json:"teacherId"`
	PendingTeacherEmail *string  `json:"pendingTeacherEmail"`
	StartDate           *string  `json:"startDate"`
	EndDate             *string  `json:"endDate"`
	Color               *string  `json:"color"`
}

func (b createClassRequestBody) toCreateInput() (service.CreateClassInput, error) {
	templateID, err := parseOptionalUUID(b.TemplateID, "templateId")
	if err != nil {
		return service.CreateClassInput{}, err
	}
	teacherID, err := parseOptionalUUID(b.TeacherID, "teacherId")
	if err != nil {
		return service.CreateClassInput{}, err
	}
	startDate, err := parseOptionalDate(b.StartDate, "startDate")
	if err != nil {
		return service.CreateClassInput{}, err
	}
	endDate, err := parseOptionalDate(b.EndDate, "endDate")
	if err != nil {
		return service.CreateClassInput{}, err
	}
	return service.CreateClassInput{
		TemplateID:          templateID,
		Name:                b.Name,
		Description:         b.Description,
		TargetBand:          b.TargetBand,
		PrimarySkill:        b.PrimarySkill,
		SessionCount:        b.SessionCount,
		Capacity:            b.Capacity,
		TeacherID:           teacherID,
		PendingTeacherEmail: b.PendingTeacherEmail,
		StartDate:           startDate,
		EndDate:             endDate,
		Color:               b.Color,
	}, nil
}

type updateClassRequestBody struct {
	Name                *string  `json:"name"`
	Description         *string  `json:"description"`
	TargetBand          *float64 `json:"targetBand"`
	PrimarySkill        *string  `json:"primarySkill"`
	SessionCount        *int32   `json:"sessionCount"`
	Capacity            *int32   `json:"capacity"`
	StartDate           *string  `json:"startDate"`
	EndDate             *string  `json:"endDate"`
	Color               *string  `json:"color"`
	DueDatesEnabled     *bool    `json:"dueDatesEnabled"`
	TeacherID           *string  `json:"teacherId"`
	PendingTeacherEmail *string  `json:"pendingTeacherEmail"`
}

func (b updateClassRequestBody) toUpdateInput() (service.UpdateClassInput, error) {
	teacherID, err := parseOptionalUUID(b.TeacherID, "teacherId")
	if err != nil {
		return service.UpdateClassInput{}, err
	}
	startDate, err := parseOptionalDate(b.StartDate, "startDate")
	if err != nil {
		return service.UpdateClassInput{}, err
	}
	endDate, err := parseOptionalDate(b.EndDate, "endDate")
	if err != nil {
		return service.UpdateClassInput{}, err
	}
	return service.UpdateClassInput{
		Name:                b.Name,
		Description:         b.Description,
		TargetBand:          b.TargetBand,
		PrimarySkill:        b.PrimarySkill,
		SessionCount:        b.SessionCount,
		Capacity:            b.Capacity,
		StartDate:           startDate,
		EndDate:             endDate,
		Color:               b.Color,
		DueDatesEnabled:     b.DueDatesEnabled,
		TeacherID:           teacherID,
		PendingTeacherEmail: b.PendingTeacherEmail,
	}, nil
}

// --- decode + parse helpers ---

// decodeClassJSONBody decodes strictly (DisallowUnknownFields) and maps decode
// failures to typed errors (413 on oversize, 422 otherwise).
func decodeClassJSONBody(r io.Reader, dst any) error {
	dec := json.NewDecoder(r)
	dec.DisallowUnknownFields()
	if err := dec.Decode(dst); err != nil {
		var maxBytesErr *http.MaxBytesError
		if errors.As(err, &maxBytesErr) {
			return &service.PayloadTooLargeError{LimitBytes: maxBytesErr.Limit}
		}
		if errors.Is(err, io.EOF) || errors.Is(err, io.ErrUnexpectedEOF) {
			return model.ValidationError{Fields: []model.FieldError{{Field: "body", Message: "request body is required"}}}
		}
		return model.ValidationError{Fields: []model.FieldError{{Field: "body", Message: "invalid JSON"}}}
	}
	return nil
}

func parseOptionalUUID(raw *string, field string) (*uuid.UUID, error) {
	if raw == nil {
		return nil, nil
	}
	id, err := uuid.Parse(*raw)
	if err != nil {
		return nil, model.ValidationError{Fields: []model.FieldError{{Field: field, Message: "expected a UUID"}}}
	}
	return &id, nil
}

func parseOptionalDate(raw *string, field string) (*time.Time, error) {
	if raw == nil {
		return nil, nil
	}
	t, err := time.Parse("2006-01-02", *raw)
	if err != nil {
		return nil, model.ValidationError{Fields: []model.FieldError{{Field: field, Message: "expected YYYY-MM-DD"}}}
	}
	return &t, nil
}

// --- pgtype → wire converters ---

func uuidPgToString(u pgtype.UUID) string {
	if !u.Valid {
		return ""
	}
	return uuid.UUID(u.Bytes).String()
}

func uuidPgToPtr(u pgtype.UUID) *string {
	if !u.Valid {
		return nil
	}
	s := uuid.UUID(u.Bytes).String()
	return &s
}

func textPgToPtr(t pgtype.Text) *string {
	if !t.Valid {
		return nil
	}
	return &t.String
}

func int4PgToPtr(i pgtype.Int4) *int32 {
	if !i.Valid {
		return nil
	}
	return &i.Int32
}

func datePgToPtr(d pgtype.Date) *string {
	if !d.Valid {
		return nil
	}
	s := d.Time.Format("2006-01-02")
	return &s
}

func numericPgToPtr(n pgtype.Numeric) *float64 {
	if !n.Valid {
		return nil
	}
	f, err := n.Float64Value()
	if err != nil || !f.Valid {
		return nil
	}
	return &f.Float64
}
