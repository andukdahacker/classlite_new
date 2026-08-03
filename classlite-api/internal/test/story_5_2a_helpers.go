// Story 5.2a — student attempt-read test-server helper. Mirrors
// NewExerciseTestServerBareMux: the assignmentChain (extractTenant →
// requireVerified → requireCenter → ErrorMapper — NOT role-gated) over the two
// student read routes on db WITHOUT auth injection, so one test can exercise
// student vs non-student roles by supplying its own bearer token. Role +
// ownership + enrollment are enforced in the service.
package test

import (
	"net/http"
	"testing"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/handler"
	"github.com/ducdo/classlite-api/internal/middleware"
	"github.com/ducdo/classlite-api/internal/service"
)

// NewStudentAttemptTestServerBareMux wires the two Story 5.2a read routes over db:
//
//	GET /api/assignments                    → student enrollment-scoped list
//	GET /api/submissions/{id}/attempt       → answer-stripped attempt bundle
func NewStudentAttemptTestServerBareMux(t *testing.T, db storyDB) http.Handler {
	t.Helper()
	auditSvc := service.NewAuditService(db)
	submissionSvc := service.NewSubmissionService(db, auditSvc, clock.RealClock{})
	submissionHandler := handler.NewSubmissionHandler(submissionSvc, clock.RealClock{})

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
	mux.Handle("GET /api/assignments", chain(submissionHandler.ListStudentAssignments))
	mux.Handle("GET /api/submissions/{id}/attempt", chain(submissionHandler.GetAttempt))
	return mux
}
