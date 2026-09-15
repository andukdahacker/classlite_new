// Story 8.1a — dashboard test-server helper.
//
// Mounts GET /api/dashboard on the EXACT production middleware chain
// (cmd/api/main.go): the UNGATED Q&A-style chain — extractTenant → requireVerified
// → requireCenter → ErrorMapper, with NO RequireRole (D2), so a student reaches the
// handler and gets a role-scoped payload (never a 403 at the edge). Role branching +
// scoping live in the service. Mirrors NewStudentTestServerForRole
// (story_7_2a_helpers.go): the test controls the caller's DB role via
// CreateCenterMember (what ExtractTenant reads); this helper only marks the caller
// email_verified and injects the Bearer token.
package test

import (
	"net/http"
	"testing"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/handler"
	"github.com/ducdo/classlite-api/internal/middleware"
	"github.com/ducdo/classlite-api/internal/service"
	"github.com/jackc/pgx/v5/pgtype"
)

// NewDashboardTestServerForRole mounts GET /api/dashboard with a caller whose JWT
// claims match `role`. The caller's center_members row is created by the test.
func NewDashboardTestServerForRole(
	t *testing.T,
	db storyDB,
	userID pgtype.UUID,
	centerID string,
	role string,
) http.Handler {
	t.Helper()
	markUserVerified(t, db, userID)
	tok := SignAccessTokenForRole(t, userID, centerID, role)
	return &authInjectingHandler{next: newDashboardSrv(t, db), token: tok}
}

func newDashboardSrv(t *testing.T, db storyDB) http.Handler {
	t.Helper()
	mux := http.NewServeMux()

	dashboardSvc := service.NewDashboardService(db, clock.RealClock{})
	dashboardHandler := handler.NewDashboardHandler(dashboardSvc, clock.RealClock{})

	extractTenant := middleware.ExtractTenant(db, jwtSigner())
	requireVerified := middleware.RequireVerifiedEmail()
	requireCenter := middleware.RequireCenterContext()
	dashboardChain := func(h middleware.HandlerWithError) http.Handler {
		return extractTenant(
			requireVerified(
				requireCenter(http.HandlerFunc(middleware.ErrorMapper(h))),
			),
		)
	}
	mux.Handle("GET /api/dashboard", dashboardChain(dashboardHandler.Get))
	return mux
}
