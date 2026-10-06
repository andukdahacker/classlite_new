// Story 9.4 test helpers — mount the self-profile routes (GET/PUT /api/users/me
// + change-password) on the real verified-gated, center-OPTIONAL chain (the
// onboardingChain shape, no requireCenter) with a pre-signed token for a user.
// Mirrors NewTestServerForUser but for the 9.4 routes.

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

// Story94AvatarBase is the public avatar base the 9.4 handler tests wire so a
// persisted avatar renders as a stable full URL.
const Story94AvatarBase = "https://cdn.example.com"

// newUserProfileSrv mounts the three 9.4 routes against db. changePasswordBurst
// lets the SEC-10 rate-limit test exhaust the tighter bucket deterministically.
func newUserProfileSrv(t *testing.T, db storyDB, changePasswordBurst int) http.Handler {
	t.Helper()
	userSvc := service.NewUserService(db, service.BcryptHasher{Cost: 4}, NewMockStorage94(), Story94AvatarBase, clock.RealClock{})
	userHandler := handler.NewUserHandler(userSvc)

	extractTenant := middleware.ExtractTenant(db, jwtSigner())
	requireVerified := middleware.RequireVerifiedEmail()
	profileLimit := middleware.RateLimitByKey(
		"user-profile-test-"+uuid.NewString(), rate.Every(60*time.Second), 120, middleware.UserAndIPKeyFn,
	)
	changePasswordLimit := middleware.RateLimitByKey(
		"user-change-password-test-"+uuid.NewString(), rate.Every(60*time.Second), changePasswordBurst, middleware.UserAndIPKeyFn,
	)
	chain := func(limit func(http.Handler) http.Handler, h middleware.HandlerWithError) http.Handler {
		return extractTenant(requireVerified(limit(http.HandlerFunc(middleware.ErrorMapper(h)))))
	}

	mux := http.NewServeMux()
	mux.Handle("GET /api/users/me", chain(profileLimit, userHandler.GetMe))
	mux.Handle("PUT /api/users/me", chain(profileLimit, userHandler.UpdateMe))
	mux.Handle("POST /api/users/me/change-password", chain(changePasswordLimit, userHandler.ChangePassword))
	return mux
}

// NewMockStorage94 exposes a MockStorageService for 9.4 handler tests to seed
// avatar HeadObject metadata (package test cannot import service_test helpers).
func NewMockStorage94() *service.MockStorageService {
	return service.NewMockStorageService()
}

// NewTestServerForProfile returns a handler that auto-attaches a Bearer token
// for userID to every 9.4 self-profile request (generous change-password bucket).
func NewTestServerForProfile(t *testing.T, db storyDB, userID pgtype.UUID) http.Handler {
	t.Helper()
	return &authInjectingHandler{next: newUserProfileSrv(t, db, 60), token: SignAccessTokenForUser(t, userID)}
}

// NewTestServerForProfileTightCP is the SEC-10 variant whose change-password
// bucket has the given small burst so the 429 path is reachable in a test.
func NewTestServerForProfileTightCP(t *testing.T, db storyDB, userID pgtype.UUID, burst int) http.Handler {
	t.Helper()
	return &authInjectingHandler{next: newUserProfileSrv(t, db, burst), token: SignAccessTokenForUser(t, userID)}
}
