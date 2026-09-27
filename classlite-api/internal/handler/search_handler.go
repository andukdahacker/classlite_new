// Package handler — Story 8.4a SearchHandler.
//
// One endpoint:
//
//	GET /api/search?q=   role-scoped grouped command-palette search (FR-67)
//
// The chain is UNGATED (no RequireRole, D5) — every authenticated, verified,
// center-scoped role reaches here and the service returns its own scoped payload
// (owner/admin center-wide, teacher own, student classes+assignments only). The
// handler is a thin HTTP binding: pull the tenant from context (GFW-3), read the raw
// `q` query param (the service trims + applies the 3-rune floor), call the service,
// write the {data, meta} envelope (GFW-5, GO-5 explicit nulls).
package handler

import (
	"net/http"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/model"
	"github.com/ducdo/classlite-api/internal/service"
)

// SearchHandler serves the role-scoped global search read.
type SearchHandler struct {
	svc *service.SearchService
	clk clock.Clock
}

// NewSearchHandler constructs a SearchHandler.
func NewSearchHandler(svc *service.SearchService, clk clock.Clock) *SearchHandler {
	return &SearchHandler{svc: svc, clk: clk}
}

// Search handles GET /api/search. Role branching + scoping live in the service; the
// handler never role-gates (a student must reach it — D5).
func (h *SearchHandler) Search(w http.ResponseWriter, r *http.Request) error {
	tc, ok := model.TenantFromContext(r.Context())
	if !ok || tc.UserID == "" || tc.CenterID == "" {
		return ErrTenantContextMissing
	}
	results, err := h.svc.Search(r.Context(), tc, r.URL.Query().Get("q"))
	if err != nil {
		return err
	}
	WriteEnvelope(w, http.StatusOK, h.clk, results)
	return nil
}
