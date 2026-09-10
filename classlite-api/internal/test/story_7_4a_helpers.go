// Story 7.4a — Q&A test-server helper. Mirrors NewEnrollmentTestServerBareMux:
// the open questionChain (extractTenant → requireVerified → requireCenter →
// ErrorMapper — NO RequireRole, so Owner/Admin reach the handler for the R25/R26
// empty-list contract) + the 6 Q&A routes over db WITHOUT auth injection, so one
// test can exercise every role by supplying its own bearer token. Role scoping +
// SEC-1 DB-role re-validation are enforced in the service.
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

func NewQuestionTestServerBareMux(t *testing.T, db storyDB) http.Handler {
	t.Helper()
	questionSvc := service.NewQuestionService(db, clock.RealClock{}, event.NewBus())
	questionHandler := handler.NewQuestionHandler(questionSvc, clock.RealClock{})

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
	mux.Handle("POST /api/questions", chain(questionHandler.Ask))
	mux.Handle("GET /api/questions", chain(questionHandler.List))
	mux.Handle("GET /api/questions/{id}", chain(questionHandler.GetThread))
	mux.Handle("POST /api/questions/{id}/replies", chain(questionHandler.Reply))
	mux.Handle("PATCH /api/questions/{id}", chain(questionHandler.Resolve))
	mux.Handle("POST /api/questions/batch-reply", chain(questionHandler.BatchReply))
	return mux
}
