// Story 3.4.5 — Enrollment test-server helper. Mirrors NewClassTestServerBareMux:
// the enrollmentChain (extractTenant → requireVerified → requireCenter →
// ErrorMapper — NOT owner-gated) + the 2 enrollment routes over db WITHOUT auth
// injection, so one test can exercise owner/admin/teacher/student roles by
// supplying its own bearer token. Role (Admin/Owner create) + teacher-scope are
// enforced in the service.
package test

import (
	"net/http"
	"testing"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/event"
	"github.com/ducdo/classlite-api/internal/handler"
	"github.com/ducdo/classlite-api/internal/middleware"
	"github.com/ducdo/classlite-api/internal/service"
)

func NewEnrollmentTestServerBareMux(t *testing.T, db storyDB) http.Handler {
	t.Helper()
	auditSvc := service.NewAuditService(db)
	// Story 7.3a — real event bus (zero subscribers) + nil email queue: the bare-mux
	// harness exercises the action endpoints; email delivery is out of its scope.
	enrollmentSvc := service.NewEnrollmentService(db, auditSvc, clock.RealClock{}, event.NewBus(), nil)
	enrollmentHandler := handler.NewEnrollmentHandler(enrollmentSvc, clock.RealClock{})

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
	// No RequireRole on this bare mux (unlike production, story_7_3a) — the SERVICE
	// authz (SEC-1 DB role re-fetch on the action; assertAdminOrOwner on the reads)
	// is what these tests assert, so the edge gate is intentionally omitted.
	mux.Handle("POST /api/enrollments", chain(enrollmentHandler.Action))
	mux.Handle("GET /api/enrollments/history", chain(enrollmentHandler.ListHistory))
	mux.Handle("GET /api/enrollments/attention", chain(enrollmentHandler.Attention))
	mux.Handle("GET /api/classes/{classId}/enrollments", chain(enrollmentHandler.ListByClass))
	return mux
}
