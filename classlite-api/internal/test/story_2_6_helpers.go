// Story 2.6 — invites test-server helper.
//
// Mounts POST /api/centers/{id}/invites on top of the 2-5b/c settings mux
// with the exact production chain (RequireRole widened to {owner, admin}).
// Tests inject their own caller via SignAccessTokenForRole and assert the
// full HTTP envelope + audit row shape per AC9.
package test

import (
	"net/http"
	"testing"
	"time"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/handler"
	"github.com/ducdo/classlite-api/internal/middleware"
	"github.com/ducdo/classlite-api/internal/service"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	"golang.org/x/time/rate"
)

// SignAccessTokenForRole mints a Bearer JWT with an arbitrary role claim.
// Story 2.6 handler tests need this for the Teacher-caller middleware-block
// case (RequireRole("owner","admin") must 403 before the service runs),
// and for Admin callers on the FR-11 envelope test.
func SignAccessTokenForRole(t *testing.T, userID pgtype.UUID, centerID, role string) string {
	t.Helper()
	tok, err := jwtSigner().SignAccess(service.AccessClaims{
		UserID:   UUIDString(userID),
		CenterID: centerID,
		Role:     role,
	}, 900)
	if err != nil {
		t.Fatalf("sign access token (role=%s): %v", role, err)
	}
	return tok
}

// NewInvites2_6TestServerBareMux mounts the invite route WITHOUT the
// authInjectingHandler wrapper so tests can drive the raw ExtractTenant
// middleware with their own (or missing) Authorization header. Mirrors
// the 2-5b P14 fix pattern — the previous 2-5b unauth test wrapped its
// bare bearer with the auth-injecting handler and thereby exercised the
// authenticated code path instead of the AUTH_REQUIRED one.
func NewInvites2_6TestServerBareMux(t *testing.T, db storyDB) http.Handler {
	t.Helper()
	return newInvites2_6Srv(t, db, rate.Every(60*time.Second), 60)
}

// NewInvites2_6TestServerForRole mounts the invite route with a caller
// whose JWT claims match the given role. The DB row for the caller is NOT
// created here — the test does that so it can control the caller's DB
// role (which is what ExtractTenant reads and RequireRole enforces).
func NewInvites2_6TestServerForRole(
	t *testing.T,
	db storyDB,
	userID pgtype.UUID,
	centerID string,
	role string,
) http.Handler {
	t.Helper()
	tok := SignAccessTokenForRole(t, userID, centerID, role)
	return &authInjectingHandler{next: newInvites2_6Srv(t, db, rate.Every(60*time.Second), 60), token: tok}
}

func newInvites2_6Srv(t *testing.T, db storyDB, rps rate.Limit, burst int) http.Handler {
	t.Helper()

	// Reuse the 2-5b mux so downstream tests can share fixtures. The 2-5b
	// mux stacks 2-5a's settings routes on top of 2-1's onboarding routes.
	mux := newSettings2_5BSrv(t, db, rate.Every(60*time.Second), 60).(*http.ServeMux)

	authSvc := service.NewAuthService(db, service.BcryptHasher{Cost: 4},
		&service.MockEmailSender{}, service.NewPgAuthAuditLogger(db),
		service.NewEmailRetryQueue(&service.MockEmailSender{}, 4),
		"http://localhost/verify")
	authSvc.SetJWTSigner(jwtSigner())
	invitesHandler := handler.NewInvitesHandler(authSvc, clock.RealClock{})

	extractTenant := middleware.ExtractTenant(db, jwtSigner())
	requireVerified := middleware.RequireVerifiedEmail()
	requireCenter := middleware.RequireCenterContext()
	requireOwnerOrAdmin := middleware.RequireRole("owner", "admin")
	inviteLimit := middleware.RateLimitByKey(
		"invites-2-6-test-"+uuid.NewString(),
		rps,
		burst,
		middleware.UserAndIPKeyFn,
	)
	chain := func(h middleware.HandlerWithError) http.Handler {
		return extractTenant(
			requireVerified(
				requireCenter(
					requireOwnerOrAdmin(
						inviteLimit(http.HandlerFunc(middleware.ErrorMapper(h))),
					),
				),
			),
		)
	}
	mux.Handle("POST /api/centers/{id}/invites", chain(invitesHandler.Post))
	return mux
}
