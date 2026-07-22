// Story 3.4 — Session test-server helper. Mirrors NewClassTestServerBareMux:
// the sessionChain (extractTenant → requireVerified → requireCenter →
// ErrorMapper — NOT owner-gated) + the 6 session routes over db WITHOUT auth
// injection, so one test can exercise owner/admin/teacher/student roles by
// supplying its own bearer token. clk is the frozen clock the service's
// now()-floor reads (deterministic past/future boundary).
package test

import (
	"net/http"
	"testing"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/handler"
	"github.com/ducdo/classlite-api/internal/middleware"
	"github.com/ducdo/classlite-api/internal/service"
)

func NewSessionTestServerBareMux(t *testing.T, db storyDB, clk clock.Clock) http.Handler {
	t.Helper()
	auditSvc := service.NewAuditService(db)
	sessionSvc := service.NewSessionService(db, auditSvc, clk)
	sessionHandler := handler.NewSessionHandler(sessionSvc, clk)

	extractTenant := middleware.ExtractTenant(db, jwtSigner())
	requireVerified := middleware.RequireVerifiedEmail()
	requireCenter := middleware.RequireCenterContext()
	chain := func(h middleware.HandlerWithError) http.Handler {
		return extractTenant(
			requireVerified(
				requireCenter(http.HandlerFunc(middleware.ErrorMapper(h))),
			),
		)
	}
	mux := http.NewServeMux()
	mux.Handle("GET /api/sessions", chain(sessionHandler.List))
	mux.Handle("POST /api/sessions", chain(sessionHandler.Create))
	mux.Handle("GET /api/sessions/{id}", chain(sessionHandler.Get))
	mux.Handle("PATCH /api/sessions/{id}", chain(sessionHandler.Update))
	mux.Handle("DELETE /api/sessions/{id}", chain(sessionHandler.Delete))
	mux.Handle("POST /api/sessions/{id}/cancel", chain(sessionHandler.Cancel))
	return mux
}
