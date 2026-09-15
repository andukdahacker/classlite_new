// Package handler — Story 8.1a DashboardHandler.
//
// One endpoint:
//
//	GET /api/dashboard   role-scoped aggregate (teacher | owner+admin | student)
//
// The chain is UNGATED (no RequireRole, D2) — every authenticated, verified,
// center-scoped role reaches here and the service returns its own role block
// (exactly one of teacher/owner/student non-null, D3). The handler is a thin HTTP
// binding: pull the tenant from context (GFW-3), call the service, write the
// {data, meta} envelope with meta.serverTime (WriteEnvelope, GO-5 explicit nulls).
package handler

import (
	"net/http"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/model"
	"github.com/ducdo/classlite-api/internal/service"
)

// DashboardHandler serves the role-scoped dashboard read.
type DashboardHandler struct {
	svc *service.DashboardService
	clk clock.Clock
}

// NewDashboardHandler constructs a DashboardHandler.
func NewDashboardHandler(svc *service.DashboardService, clk clock.Clock) *DashboardHandler {
	return &DashboardHandler{svc: svc, clk: clk}
}

// Get handles GET /api/dashboard. Role branching + scoping live in the service; the
// handler never role-gates (a student must reach it — D2/AC1).
func (h *DashboardHandler) Get(w http.ResponseWriter, r *http.Request) error {
	tc, ok := model.TenantFromContext(r.Context())
	if !ok || tc.UserID == "" || tc.CenterID == "" {
		return ErrTenantContextMissing
	}
	data, err := h.svc.GetDashboard(r.Context(), tc)
	if err != nil {
		return err
	}
	WriteEnvelope(w, http.StatusOK, h.clk, data)
	return nil
}
