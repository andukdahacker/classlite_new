// Story 2-5a — settings test-server helpers.
//
// Mirror of story_2_1_helpers.go's newStorySrv/NewTestServerForUser but
// mounts the two /api/centers/{id} routes with the full Owner-only chain:
//   ExtractTenant → RequireVerifiedEmail → RequireCenterContext →
//   RequireRole("owner") → settingsLimit → handler
//
// Callers pre-create the center (via CenterService.CreateCenter) and pass
// (userID, centerID). The helper signs a JWT carrying center + owner
// claims so the chain reaches SettingsHandler.
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

// SignAccessTokenForOwner mints a Bearer token whose UserID + CenterID +
// Role=owner claims mirror the post-CreateCenter state. Used by Story
// 2-5a settings tests that need the full RequireCenterContext +
// RequireRole("owner") chain to pass.
func SignAccessTokenForOwner(t *testing.T, userID pgtype.UUID, centerID string) string {
	t.Helper()
	tok, err := jwtSigner().SignAccess(service.AccessClaims{
		UserID:   UUIDString(userID),
		CenterID: centerID,
		Role:     "owner",
	}, 900)
	if err != nil {
		t.Fatalf("sign owner access token: %v", err)
	}
	return tok
}

// NewSettingsTestServerForUser returns an http.Handler that mounts BOTH
// the Story 2.1 routes (via newStorySrv) AND the Story 2-5a settings
// routes with the Owner-only middleware chain. The caller MUST have
// already created a center for this user (fixture step) so the JWT can
// carry the center claim.
func NewSettingsTestServerForUser(t *testing.T, db storyDB, userID pgtype.UUID, centerID string) http.Handler {
	t.Helper()
	tok := SignAccessTokenForOwner(t, userID, centerID)
	return &authInjectingHandler{next: newSettingsSrv(t, db), token: tok}
}

// NewSettingsTestServerRateLimited returns the same handler but with the
// settings rate limit tightened to 1 req/min so 429 assertions land
// deterministically without flooding a real 60-req bucket. Used only by
// the Retry-After header test.
//
// P9 (2026-07-15 code review): previously passed `rate.Limit(1)` which
// evaluates to 1 rps (60/min), not the documented 1/min. Under normal
// scheduling the two-shot test still tripped because burst=1 exhausted
// before refill; under >1s CI latency the second call could succeed
// (bucket refilled) and flake the assertion. `rate.Every(time.Minute)`
// with burst=1 pins the interval to 60s so the second call is
// deterministically denied and `Retry-After` is guaranteed to be ~60.
func NewSettingsTestServerRateLimited(t *testing.T, db storyDB, userID pgtype.UUID, centerID string) http.Handler {
	t.Helper()
	tok := SignAccessTokenForOwner(t, userID, centerID)
	return &authInjectingHandler{next: newSettingsSrvWithRate(t, db, rate.Every(time.Minute), 1), token: tok}
}

// newSettingsSrv wires the Story 2.1 routes + Story 2-5a settings routes
// with production-ish middleware chains. Rate limit is generous (60/min)
// so the assertion tests don't accidentally trip.
func newSettingsSrv(t *testing.T, db storyDB) http.Handler {
	t.Helper()
	return newSettingsSrvWithRate(t, db, rate.Every(60*time.Second), 60)
}

// newSettingsSrvWithRate lets the caller pin the settingsLimit knobs so
// the 429-with-Retry-After test can force a rate-limit response on the
// second call. All other tests use newSettingsSrv.
func newSettingsSrvWithRate(t *testing.T, db storyDB, rps rate.Limit, burst int) http.Handler {
	t.Helper()

	mux := newStorySrv(t, db).(*http.ServeMux)

	auditSvc := service.NewAuditService(db)
	settingsSvc := service.NewSettingsService(db, auditSvc, clock.RealClock{})
	settingsHandler := handler.NewSettingsHandler(settingsSvc, clock.RealClock{})

	extractTenant := middleware.ExtractTenant(db, jwtSigner())
	requireVerified := middleware.RequireVerifiedEmail()
	requireCenter := middleware.RequireCenterContext()
	requireOwner := middleware.RequireRole("owner")
	settingsLimit := middleware.RateLimitByKey(
		"settings-test-"+uuid.NewString(),
		rps,
		burst,
		middleware.UserAndIPKeyFn,
	)
	chain := func(h middleware.HandlerWithError) http.Handler {
		return extractTenant(
			requireVerified(
				requireCenter(
					requireOwner(
						settingsLimit(http.HandlerFunc(middleware.ErrorMapper(h))),
					),
				),
			),
		)
	}
	mux.Handle("GET /api/centers/{id}", chain(settingsHandler.Get))
	mux.Handle("PATCH /api/centers/{id}", chain(settingsHandler.Patch))
	return mux
}
