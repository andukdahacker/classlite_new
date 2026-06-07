// Package handler — Story 1.6 admin endpoints (authenticated).
//
// AdminHandler is separate from AuthHandler because admin endpoints sit
// behind the ExtractTenant + RequireRole middleware chain; mixing them
// into AuthHandler would force every public auth endpoint to consult an
// admin-only dependency surface.
package handler

import (
	"net/http"

	"github.com/ducdo/classlite-api/internal/model"
	"github.com/ducdo/classlite-api/internal/service"
	"github.com/google/uuid"
)

// AdminHandler wraps AuthService for admin endpoints (force-logout,
// future Epic 7+ admin surfaces).
type AdminHandler struct {
	svc *service.AuthService
}

// NewAdminHandler constructs an AdminHandler.
func NewAdminHandler(svc *service.AuthService) *AdminHandler {
	return &AdminHandler{svc: svc}
}

// forceLogoutResponseBody is the GO-5 envelope payload.
type forceLogoutResponseBody struct {
	ForcedLogout    bool `json:"forcedLogout"`
	SessionsRevoked int  `json:"sessionsRevoked"`
}

// ForceLogout implements POST /api/admin/users/{userId}/force-logout (AC6).
// Goes through ErrorMapper so failures map to canonical JSON envelopes.
func (h *AdminHandler) ForceLogout(w http.ResponseWriter, r *http.Request) error {
	targetRaw := r.PathValue("userId")
	targetUUID, err := uuid.Parse(targetRaw)
	if err != nil {
		return model.ValidationError{Fields: []model.FieldError{{Field: "userId", Message: "must be a valid UUID"}}}
	}

	tc, ok := model.TenantFromContext(r.Context())
	if !ok {
		// Defensive: middleware chain should have rejected before us.
		// Surface as 500 (programming bug) rather than 401, so the
		// misconfiguration is loud in logs.
		WriteError(w, r, http.StatusInternalServerError,
			"INTERNAL_ERROR", "An unexpected error occurred.", nil)
		return nil
	}

	res, err := h.svc.ForceLogout(r.Context(), tc, targetUUID)
	if err != nil {
		return err
	}
	WriteJSON(w, http.StatusOK, forceLogoutResponseBody{
		ForcedLogout:    true,
		SessionsRevoked: res.SessionsRevoked,
	})
	return nil
}
