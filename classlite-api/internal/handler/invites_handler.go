// Package handler — Story 2.6 InvitesHandler (AC8).
//
// One route: POST /api/centers/{id}/invites. Sits behind the shared
// settingsChain wiring except the RequireRole allowlist widens to
// {owner, admin} — see cmd/api/main.go for the exact chain composition.
//
// FR-11 defense-in-depth: the middleware `RequireRole("owner","admin")`
// is fail-fast at the HTTP edge (Teacher / Student callers 403 before
// this handler runs). The service layer's `model.OutranksOwner` guard
// then rejects the Admin-invites-Owner case that the middleware
// cannot distinguish. Both layers must be present.
package handler

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/model"
	"github.com/ducdo/classlite-api/internal/service"
)

// InvitesHandler wires AdminInviteStaff to HTTP.
type InvitesHandler struct {
	svc *service.AuthService
	clk clock.Clock
}

// NewInvitesHandler constructs an InvitesHandler.
func NewInvitesHandler(svc *service.AuthService, clk clock.Clock) *InvitesHandler {
	return &InvitesHandler{svc: svc, clk: clk}
}

// Same 16 KiB cap as SettingsHandler — invite body is 2 fields, but the
// shared cap keeps the story-2-5a defense (P14) uniform across the settings
// chain so a body-size probe surfaces the same PAYLOAD_TOO_LARGE code.
const maxInviteBodyBytes = 16 * 1024

type inviteStaffRequestBody struct {
	Email string `json:"email"`
	Role  string `json:"role"`
}

// inviteResultResponse mirrors api.yaml InviteResult. Never `omitempty`
// per GO-5 — all fields required.
type inviteResultResponse struct {
	ID        string `json:"id"`
	Email     string `json:"email"`
	Role      string `json:"role"`
	ExpiresAt string `json:"expiresAt"`
}

// Post creates an invite (201 on success). AC8 wire shape:
//
//	POST /api/centers/{id}/invites { email, role: 'owner'|'admin'|'teacher' }
//	→ 201 { data: { id, email, role, expiresAt } }
//	→ 403 ROLE_ASSIGNMENT_FORBIDDEN | INSUFFICIENT_ROLE | TENANT_MISMATCH
//	→ 409 INVITE_EMAIL_TAKEN
//	→ 422 VALIDATION_ERROR (bad email / bad role)
func (h *InvitesHandler) Post(w http.ResponseWriter, r *http.Request) error {
	tc, err := requireSettingsTenant(r)
	if err != nil {
		return err
	}

	// See SettingsHandler.Patch for the `nil` ResponseWriter rationale —
	// MaxBytesReader must not race the ErrorMapper's typed-error path.
	r.Body = http.MaxBytesReader(nil, r.Body, maxInviteBodyBytes)
	body, decodeErr := decodeInviteStaffBody(r.Body)
	if decodeErr != nil {
		return decodeErr
	}

	result, err := h.svc.AdminInviteStaff(r.Context(), tc, body.Email, body.Role)
	if err != nil {
		return err
	}

	WriteEnvelope(w, http.StatusCreated, h.clk, inviteResultResponse{
		ID:        result.ID.String(),
		Email:     result.Email,
		Role:      result.Role,
		ExpiresAt: result.ExpiresAt.UTC().Format("2006-01-02T15:04:05.000Z07:00"),
	})
	return nil
}

// decodeInviteStaffBody decodes the request body with the same MaxBytes /
// unknown-field discipline used across the settings chain.
func decodeInviteStaffBody(rc io.Reader) (inviteStaffRequestBody, error) {
	dec := json.NewDecoder(rc)
	dec.DisallowUnknownFields()
	var out inviteStaffRequestBody
	if err := dec.Decode(&out); err != nil {
		// MaxBytesReader surface — map to typed 413 so ErrorMapper picks
		// the right status per the story-2-5a P14 pattern.
		var maxBytes *http.MaxBytesError
		if errors.As(err, &maxBytes) {
			return inviteStaffRequestBody{}, &service.PayloadTooLargeError{
				LimitBytes: maxBytes.Limit,
			}
		}
		return inviteStaffRequestBody{}, model.ValidationError{Fields: []model.FieldError{
			{Field: "body", Message: "invalid JSON"},
		}}
	}
	return out, nil
}
