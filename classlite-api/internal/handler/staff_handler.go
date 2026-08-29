// Package handler — Story 7.1a StaffHandler (AC1–AC16). PROVISIONAL wire
// shapes (D10) — 7-1b is the sole consumer and co-finalizes them.
//
// Routes (mounted in cmd/api/main.go on the production middleware chains):
//
//	GET  /api/staff                          RequireRole("owner","admin")
//	GET  /api/staff/{userId}                  RequireRole("owner","admin")
//	POST /api/staff/{userId}/assign-class     RequireRole("owner")  (+ SEC-1)
//	POST /api/staff/{userId}/archive          RequireRole("owner")  (+ SEC-1)
//	POST /api/staff/{userId}/reset-password   RequireRole("owner")  (+ SEC-1)
//
// HTTP status mapping is the handler's job (GO-3); the service returns typed
// errors and ErrorMapper renders the envelope.
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
	"github.com/google/uuid"
)

// StaffHandler wires StaffService to HTTP.
type StaffHandler struct {
	svc *service.StaffService
	clk clock.Clock
}

// NewStaffHandler constructs a StaffHandler.
func NewStaffHandler(svc *service.StaffService, clk clock.Clock) *StaffHandler {
	return &StaffHandler{svc: svc, clk: clk}
}

const maxStaffBodyBytes = 16 * 1024

// wireTime formats a timestamp as the api.yaml date-time (millis, UTC-Z).
func wireTime(t time.Time) string {
	return t.UTC().Format("2006-01-02T15:04:05.000Z07:00")
}

func wireTimePtr(t *time.Time) *string {
	if t == nil {
		return nil
	}
	s := wireTime(*t)
	return &s
}

// ---- wire shapes (GO-5: no omitempty; explicit null via pointers) ----

type staffLoadResponse struct {
	NextSevenDaysSessionCount int  `json:"nextSevenDaysSessionCount"`
	WeeklyCapacity            int  `json:"weeklyCapacity"`
	Heavy                     bool `json:"heavy"`
}

type staffMemberResponse struct {
	UserID          string            `json:"userId"`
	Name            string            `json:"name"`
	Email           string            `json:"email"`
	AvatarURL       *string           `json:"avatarUrl"`
	Role            string            `json:"role"`
	Status          string            `json:"status"`
	ClassesAssigned int               `json:"classesAssigned"`
	Load            staffLoadResponse `json:"load"`
	LastActiveAt    *string           `json:"lastActiveAt"`
}

type pendingInviteResponse struct {
	InviteID       string  `json:"inviteId"`
	Name           *string `json:"name"`
	Email          string  `json:"email"`
	Role           string  `json:"role"`
	InvitedAt      string  `json:"invitedAt"`
	ExpiresAt      string  `json:"expiresAt"`
	PendingClassID *string `json:"pendingClassId"`
}

type staffRosterResponse struct {
	Members        []staffMemberResponse   `json:"members"`
	PendingInvites []pendingInviteResponse `json:"pendingInvites"`
}

type staffAssignedClassResponse struct {
	ClassID string `json:"classId"`
	Name    string `json:"name"`
}

type staffScheduleGlanceResponse struct {
	SessionID string `json:"sessionId"`
	ClassID   string `json:"classId"`
	ClassName string `json:"className"`
	StartsAt  string `json:"startsAt"`
	EndsAt    string `json:"endsAt"`
}

type staffActivityResponse struct {
	Event      string `json:"event"`
	EntityType string `json:"entityType"`
	At         string `json:"at"`
}

type staffMemberDetailResponse struct {
	UserID          string                        `json:"userId"`
	Name            string                        `json:"name"`
	Email           string                        `json:"email"`
	AvatarURL       *string                       `json:"avatarUrl"`
	LanguagePref    string                        `json:"languagePref"`
	Role            string                        `json:"role"`
	Status          string                        `json:"status"`
	AssignedClasses []staffAssignedClassResponse  `json:"assignedClasses"`
	ScheduleGlance  []staffScheduleGlanceResponse `json:"scheduleGlance"`
	Load            staffLoadResponse             `json:"load"`
	LastActiveAt    *string                       `json:"lastActiveAt"`
	RecentActivity  []staffActivityResponse       `json:"recentActivity"`
}

type assignClassResultResponse struct {
	UserID  string `json:"userId"`
	ClassID string `json:"classId"`
}

type archiveStaffResultResponse struct {
	UserID             string `json:"userId"`
	Status             string `json:"status"`
	AssignedClassCount int    `json:"assignedClassCount"`
}

type assignClassRequestBody struct {
	ClassID string `json:"classId"`
}

// ---- handlers ----

// List handles GET /api/staff.
func (h *StaffHandler) List(w http.ResponseWriter, r *http.Request) error {
	tc, err := requireStaffTenant(r)
	if err != nil {
		return err
	}
	roster, err := h.svc.ListStaff(r.Context(), tc)
	if err != nil {
		return err
	}
	WriteEnvelope(w, http.StatusOK, h.clk, staffRosterToResponse(roster))
	return nil
}

// GetDetail handles GET /api/staff/{userId}.
func (h *StaffHandler) GetDetail(w http.ResponseWriter, r *http.Request) error {
	tc, err := requireStaffTenant(r)
	if err != nil {
		return err
	}
	targetID, ok := parseStaffTargetID(r)
	if !ok {
		// A malformed id can address no member — 404 (non-disclosure), not 400.
		return model.NotFoundError{Resource: "staff member", Code: "STAFF_NOT_FOUND"}
	}
	detail, err := h.svc.GetStaffMemberDetail(r.Context(), tc, targetID)
	if err != nil {
		return err
	}
	WriteEnvelope(w, http.StatusOK, h.clk, staffMemberDetailToResponse(detail))
	return nil
}

// AssignClass handles POST /api/staff/{userId}/assign-class.
func (h *StaffHandler) AssignClass(w http.ResponseWriter, r *http.Request) error {
	tc, err := requireStaffTenant(r)
	if err != nil {
		return err
	}
	targetID, ok := parseStaffTargetID(r)
	if !ok {
		return model.NotFoundError{Resource: "staff member", Code: "STAFF_NOT_FOUND"}
	}
	r.Body = http.MaxBytesReader(nil, r.Body, maxStaffBodyBytes)
	body, decodeErr := decodeAssignClassBody(r.Body)
	if decodeErr != nil {
		return decodeErr
	}
	classID, parseErr := uuid.Parse(body.ClassID)
	if parseErr != nil {
		return model.ValidationError{Fields: []model.FieldError{{Field: "classId", Message: "must be a valid UUID"}}}
	}
	if err := h.svc.AssignClass(r.Context(), tc, targetID, classID); err != nil {
		return err
	}
	WriteEnvelope(w, http.StatusOK, h.clk, assignClassResultResponse{
		UserID:  targetID.String(),
		ClassID: classID.String(),
	})
	return nil
}

// Archive handles POST /api/staff/{userId}/archive.
func (h *StaffHandler) Archive(w http.ResponseWriter, r *http.Request) error {
	tc, err := requireStaffTenant(r)
	if err != nil {
		return err
	}
	targetID, ok := parseStaffTargetID(r)
	if !ok {
		return model.NotFoundError{Resource: "staff member", Code: "STAFF_NOT_FOUND"}
	}
	res, err := h.svc.ArchiveStaff(r.Context(), tc, targetID)
	if err != nil {
		return err
	}
	WriteEnvelope(w, http.StatusOK, h.clk, archiveStaffResultResponse{
		UserID:             targetID.String(),
		Status:             "archived",
		AssignedClassCount: res.AssignedClassCount,
	})
	return nil
}

// ResetPassword handles POST /api/staff/{userId}/reset-password.
func (h *StaffHandler) ResetPassword(w http.ResponseWriter, r *http.Request) error {
	tc, err := requireStaffTenant(r)
	if err != nil {
		return err
	}
	targetID, ok := parseStaffTargetID(r)
	if !ok {
		return model.NotFoundError{Resource: "staff member", Code: "STAFF_NOT_FOUND"}
	}
	if err := h.svc.ResetStaffPassword(r.Context(), tc, targetID); err != nil {
		return err
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}

// ---- helpers ----

// requireStaffTenant extracts the DB-resolved tenant context. The centerID is
// the tenant's own — staff routes carry no path {id} to cross-check (unlike
// /api/centers/{id}/...).
func requireStaffTenant(r *http.Request) (model.TenantContext, error) {
	tc, ok := model.TenantFromContext(r.Context())
	if !ok || tc.UserID == "" || tc.CenterID == "" {
		return model.TenantContext{}, ErrTenantContextMissing
	}
	return tc, nil
}

func parseStaffTargetID(r *http.Request) (uuid.UUID, bool) {
	raw := r.PathValue("userId")
	if raw == "" {
		return uuid.Nil, false
	}
	id, err := uuid.Parse(raw)
	if err != nil {
		return uuid.Nil, false
	}
	return id, true
}

func decodeAssignClassBody(rc io.Reader) (assignClassRequestBody, error) {
	dec := json.NewDecoder(rc)
	dec.DisallowUnknownFields()
	var out assignClassRequestBody
	if err := dec.Decode(&out); err != nil {
		var maxBytes *http.MaxBytesError
		if errors.As(err, &maxBytes) {
			return assignClassRequestBody{}, &service.PayloadTooLargeError{LimitBytes: maxBytes.Limit}
		}
		return assignClassRequestBody{}, model.ValidationError{Fields: []model.FieldError{{Field: "body", Message: "invalid JSON"}}}
	}
	if out.ClassID == "" {
		return assignClassRequestBody{}, model.ValidationError{Fields: []model.FieldError{{Field: "classId", Message: "required"}}}
	}
	return out, nil
}

func staffRosterToResponse(roster *service.StaffRoster) staffRosterResponse {
	out := staffRosterResponse{
		Members:        make([]staffMemberResponse, 0, len(roster.Members)),
		PendingInvites: make([]pendingInviteResponse, 0, len(roster.PendingInvites)),
	}
	for _, m := range roster.Members {
		out.Members = append(out.Members, staffMemberToResponse(m))
	}
	for _, p := range roster.PendingInvites {
		resp := pendingInviteResponse{
			InviteID:  p.InviteID.String(),
			Name:      p.Name,
			Email:     p.Email,
			Role:      p.Role,
			InvitedAt: wireTime(p.InvitedAt),
			ExpiresAt: wireTime(p.ExpiresAt),
		}
		if p.PendingClassID != nil {
			s := p.PendingClassID.String()
			resp.PendingClassID = &s
		}
		out.PendingInvites = append(out.PendingInvites, resp)
	}
	return out
}

func staffMemberToResponse(m service.StaffMemberView) staffMemberResponse {
	return staffMemberResponse{
		UserID:          m.UserID.String(),
		Name:            m.Name,
		Email:           m.Email,
		AvatarURL:       m.AvatarURL,
		Role:            m.Role,
		Status:          m.Status,
		ClassesAssigned: m.ClassesAssigned,
		Load: staffLoadResponse{
			NextSevenDaysSessionCount: m.Load.NextSevenDaysSessionCount,
			WeeklyCapacity:            m.Load.WeeklyCapacity,
			Heavy:                     m.Load.Heavy,
		},
		LastActiveAt: wireTimePtr(m.LastActiveAt),
	}
}

func staffMemberDetailToResponse(d *service.StaffMemberDetail) staffMemberDetailResponse {
	out := staffMemberDetailResponse{
		UserID:          d.UserID.String(),
		Name:            d.Name,
		Email:           d.Email,
		AvatarURL:       d.AvatarURL,
		LanguagePref:    d.LanguagePref,
		Role:            d.Role,
		Status:          d.Status,
		AssignedClasses: make([]staffAssignedClassResponse, 0, len(d.AssignedClasses)),
		ScheduleGlance:  make([]staffScheduleGlanceResponse, 0, len(d.ScheduleGlance)),
		Load: staffLoadResponse{
			NextSevenDaysSessionCount: d.Load.NextSevenDaysSessionCount,
			WeeklyCapacity:            d.Load.WeeklyCapacity,
			Heavy:                     d.Load.Heavy,
		},
		LastActiveAt:   wireTimePtr(d.LastActiveAt),
		RecentActivity: make([]staffActivityResponse, 0, len(d.RecentActivity)),
	}
	for _, c := range d.AssignedClasses {
		out.AssignedClasses = append(out.AssignedClasses, staffAssignedClassResponse{ClassID: c.ClassID.String(), Name: c.Name})
	}
	for _, g := range d.ScheduleGlance {
		out.ScheduleGlance = append(out.ScheduleGlance, staffScheduleGlanceResponse{
			SessionID: g.SessionID.String(),
			ClassID:   g.ClassID.String(),
			ClassName: g.ClassName,
			StartsAt:  wireTime(g.StartsAt),
			EndsAt:    wireTime(g.EndsAt),
		})
	}
	for _, a := range d.RecentActivity {
		out.RecentActivity = append(out.RecentActivity, staffActivityResponse{Event: a.Event, EntityType: a.EntityType, At: wireTime(a.At)})
	}
	return out
}
