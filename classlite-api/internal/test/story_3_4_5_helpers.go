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
	"github.com/ducdo/classlite-api/internal/handler"
	"github.com/ducdo/classlite-api/internal/middleware"
	"github.com/ducdo/classlite-api/internal/service"
)

func NewEnrollmentTestServerBareMux(t *testing.T, db storyDB) http.Handler {
	t.Helper()
	auditSvc := service.NewAuditService(db)
	enrollmentSvc := service.NewEnrollmentService(db, auditSvc, clock.RealClock{})
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
	mux.Handle("POST /api/enrollments", chain(enrollmentHandler.Create))
	mux.Handle("GET /api/classes/{classId}/enrollments", chain(enrollmentHandler.ListByClass))
	return mux
}
