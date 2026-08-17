// Story 5.5a — submission-review test-server helper. Mirrors
// NewStudentAttemptTestServerBareMux: the assignmentChain (extractTenant →
// requireVerified → requireCenter → ErrorMapper — NOT role-gated) over the two
// new student review routes on db WITHOUT auth injection, so one test can
// exercise student vs non-student roles by supplying its own bearer token. Role
// + ownership + enrollment + the SEC-8 audio presign are enforced in the service.
//
// Unlike the 5.2a helper it also returns the *service.MockStorageService the
// submission service was built WITH (via WithStorage), so a handler test can
// assert on the presign spy (PresignGetKeys) — the zero-mint-on-gated-failure
// reds (P0-13).
package test

import (
	"net/http"
	"testing"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/handler"
	"github.com/ducdo/classlite-api/internal/middleware"
	"github.com/ducdo/classlite-api/internal/service"
)

// NewSubmissionReviewTestServerBareMux wires the two Story 5.5a review routes over db:
//
//	GET /api/assignments/{assignmentId}/result          → pre-grade read-back / resume CTA
//	GET /api/assignments/{assignmentId}/submission/audio → fresh 5-min GET presign
//
// It returns the handler AND the MockStorageService the submission service was
// built with, so a test can assert the presign spy.
func NewSubmissionReviewTestServerBareMux(t *testing.T, db storyDB) (http.Handler, *service.MockStorageService) {
	t.Helper()
	auditSvc := service.NewAuditService(db)
	storage := service.NewMockStorageService()
	submissionSvc := service.NewSubmissionService(db, auditSvc, clock.RealClock{}).WithStorage(storage)
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
	mux.Handle("GET /api/assignments/{assignmentId}/result", chain(submissionHandler.GetSubmissionResult))
	mux.Handle("GET /api/assignments/{assignmentId}/submission/audio", chain(submissionHandler.GetSubmissionAudio))
	// RequestID (outermost, as in production) so the error envelope carries a
	// non-empty requestId — the review reds assert on the full {code,message,requestId}.
	return middleware.RequestID(mux), storage
}
