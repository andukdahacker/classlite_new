// Package handler — Story 8.2a AnalyticsHandler.
//
// Two endpoints on the SAME ungated dashboardChain (no RequireRole, D6a):
//
//	GET /api/analytics                 role-scoped analytics home
//	GET /api/analytics/classes/{id}    class-performance read
//
// Role/scope is enforced IN the service (D4): a student reaches the handler and the
// service returns 403 (home) / 404 (class, non-disclosure). The handler is a thin HTTP
// binding: pull the tenant from context (GFW-3), parse the path id (→ 422 on a
// non-UUID), call the service, write the {data, meta} envelope (WriteEnvelope, GO-5
// explicit nulls, GFW-5).
package handler

import (
	"net/http"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/model"
	"github.com/ducdo/classlite-api/internal/service"
	"github.com/google/uuid"
)

// AnalyticsHandler serves the role-scoped analytics reads.
type AnalyticsHandler struct {
	svc *service.AnalyticsService
	clk clock.Clock
}

// NewAnalyticsHandler constructs an AnalyticsHandler.
func NewAnalyticsHandler(svc *service.AnalyticsService, clk clock.Clock) *AnalyticsHandler {
	return &AnalyticsHandler{svc: svc, clk: clk}
}

// Home handles GET /api/analytics. Role branching lives in the service (a student
// reaches here and the service returns 403 INSUFFICIENT_ROLE — D4).
func (h *AnalyticsHandler) Home(w http.ResponseWriter, r *http.Request) error {
	tc, ok := model.TenantFromContext(r.Context())
	if !ok || tc.UserID == "" || tc.CenterID == "" {
		return ErrTenantContextMissing
	}
	data, err := h.svc.GetHome(r.Context(), tc)
	if err != nil {
		return err
	}
	WriteEnvelope(w, http.StatusOK, h.clk, data)
	return nil
}

// GetClass handles GET /api/analytics/classes/{id}. A non-UUID id is 422
// VALIDATION_ERROR; ownership/existence scoping (404 CLASS_NOT_FOUND) lives in the
// service (D4).
func (h *AnalyticsHandler) GetClass(w http.ResponseWriter, r *http.Request) error {
	tc, ok := model.TenantFromContext(r.Context())
	if !ok || tc.UserID == "" || tc.CenterID == "" {
		return ErrTenantContextMissing
	}
	classID, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		return model.ValidationError{Fields: []model.FieldError{{
			Field:   "id",
			Message: "must be a valid UUID",
		}}}
	}
	data, err := h.svc.GetClassPerformance(r.Context(), tc, classID)
	if err != nil {
		return err
	}
	WriteEnvelope(w, http.StatusOK, h.clk, data)
	return nil
}
