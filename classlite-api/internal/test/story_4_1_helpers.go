// Story 4.1 — exercise-library test-server helper. Mirrors
// NewEnrollmentTestServerBareMux: the exerciseChain (extractTenant →
// requireVerified → requireCenter → ErrorMapper — NOT owner-gated) + the 6
// exercise routes over db WITHOUT auth injection, so one test can exercise
// owner/admin/teacher/student roles by supplying its own bearer token. Role +
// teacher-scope are enforced in the service.
package test

import (
	"net/http"
	"testing"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/handler"
	"github.com/ducdo/classlite-api/internal/middleware"
	"github.com/ducdo/classlite-api/internal/service"
)

func NewExerciseTestServerBareMux(t *testing.T, db storyDB) http.Handler {
	t.Helper()
	auditSvc := service.NewAuditService(db)
	exerciseSvc := service.NewExerciseService(db, auditSvc, clock.RealClock{})
	exerciseHandler := handler.NewExerciseHandler(exerciseSvc, clock.RealClock{})

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
	mux.Handle("GET /api/exercises", chain(exerciseHandler.List))
	mux.Handle("POST /api/exercises", chain(exerciseHandler.Create))
	mux.Handle("GET /api/exercises/{id}", chain(exerciseHandler.Get))
	mux.Handle("PATCH /api/exercises/{id}", chain(exerciseHandler.Update))
	mux.Handle("DELETE /api/exercises/{id}", chain(exerciseHandler.Delete))
	mux.Handle("POST /api/exercises/{id}/duplicate", chain(exerciseHandler.Duplicate))
	return mux
}
