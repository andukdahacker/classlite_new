// Story 8.2a — analytics test-server helper.
//
// Mounts BOTH analytics routes on the EXACT production middleware chain
// (cmd/api/main.go): the UNGATED dashboardChain shape — extractTenant →
// requireVerified → requireCenter → ErrorMapper, with NO RequireRole (D6a), so a
// student reaches the handler and the SERVICE returns 403 (home) / 404 (class,
// non-disclosure). Role branching + scoping live in the service. Mirrors
// NewDashboardTestServerForRole (story_8_1_helpers.go): the test controls the caller's
// DB role via CreateCenterMember (what ExtractTenant reads); this helper only marks
// the caller email_verified and injects the Bearer token.
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

// NewAnalyticsTestServerForRole mounts GET /api/analytics + GET
// /api/analytics/classes/{id} with a caller whose JWT claims match `role`. The
// caller's center_members row is created by the test.
func NewAnalyticsTestServerForRole(
	t *testing.T,
	db storyDB,
	userID pgtype.UUID,
	centerID string,
	role string,
) http.Handler {
	t.Helper()
	markUserVerified(t, db, userID)
	tok := SignAccessTokenForRole(t, userID, centerID, role)
	return &authInjectingHandler{next: newAnalyticsSrv(t, db), token: tok}
}

func newAnalyticsSrv(t *testing.T, db storyDB) http.Handler {
	t.Helper()
	mux := http.NewServeMux()

	analyticsSvc := service.NewAnalyticsService(db, clock.RealClock{})
	analyticsHandler := handler.NewAnalyticsHandler(analyticsSvc, clock.RealClock{})

	extractTenant := middleware.ExtractTenant(db, jwtSigner())
	requireVerified := middleware.RequireVerifiedEmail()
	requireCenter := middleware.RequireCenterContext()
	analyticsChain := func(h middleware.HandlerWithError) http.Handler {
		return extractTenant(
			requireVerified(
				requireCenter(http.HandlerFunc(middleware.ErrorMapper(h))),
			),
		)
	}
	mux.Handle("GET /api/analytics", analyticsChain(analyticsHandler.Home))
	mux.Handle("GET /api/analytics/classes/{id}", analyticsChain(analyticsHandler.GetClass))
	return mux
}
