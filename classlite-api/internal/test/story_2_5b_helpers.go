// Story 2.5b — extended settings test-server helper.
//
// Layers the 12 new terms/holidays/rooms routes on top of the 2-5a settings
// mux, using the same middleware chain (ExtractTenant → RequireVerifiedEmail
// → RequireCenterContext → RequireRole("owner") → settingsLimit → handler).
//
// Two constructors:
//   - NewSettings2_5BTestServerForUser — generous rate limit (60/min),
//     appropriate for functional CRUD assertions.
//   - NewSettings2_5BTestServerRateLimited — rate limit pinned to 1/min so
//     the 429-with-Retry-After test lands deterministically. Mirrors
//     Story 2-5a's NewSettingsTestServerRateLimited (P9 fold — rate.Every
//     over rate.Limit(1) for accurate interval semantics).
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

func NewSettings2_5BTestServerForUser(t *testing.T, db storyDB, userID pgtype.UUID, centerID string) http.Handler {
	t.Helper()
	tok := SignAccessTokenForOwner(t, userID, centerID)
	return &authInjectingHandler{next: newSettings2_5BSrv(t, db, rate.Every(60*time.Second), 60), token: tok}
}

func NewSettings2_5BTestServerRateLimited(t *testing.T, db storyDB, userID pgtype.UUID, centerID string) http.Handler {
	t.Helper()
	tok := SignAccessTokenForOwner(t, userID, centerID)
	return &authInjectingHandler{next: newSettings2_5BSrv(t, db, rate.Every(time.Minute), 1), token: tok}
}

// NewSettings2_5BTestServerBareMux returns the settings mux WITHOUT the
// authInjectingHandler wrapper — used by negative auth tests that need the
// caller's own Authorization header to reach the ExtractTenant middleware
// unmodified. Amended /bmad-code-review 2-5b Round 1 P14 (2026-07-15) —
// the previous 401 test wrapped the mux in authInjectingHandler, which
// overwrote the test's fake bearer with a valid signed token and thereby
// failed to exercise the unauthenticated code path at all.
func NewSettings2_5BTestServerBareMux(t *testing.T, db storyDB) http.Handler {
	t.Helper()
	return newSettings2_5BSrv(t, db, rate.Every(60*time.Second), 60)
}

func newSettings2_5BSrv(t *testing.T, db storyDB, rps rate.Limit, burst int) http.Handler {
	t.Helper()

	mux := newStorySrv(t, db).(*http.ServeMux)

	auditSvc := service.NewAuditService(db)
	termSvc := service.NewTermService(db, auditSvc, clock.RealClock{})
	termHandler := handler.NewTermHandler(termSvc, clock.RealClock{})
	holidaySvc := service.NewHolidayService(db, auditSvc, clock.RealClock{})
	holidayHandler := handler.NewHolidayHandler(holidaySvc, clock.RealClock{})
	roomSvc := service.NewRoomService(db, auditSvc, clock.RealClock{})
	roomHandler := handler.NewRoomHandler(roomSvc, clock.RealClock{})

	extractTenant := middleware.ExtractTenant(db, jwtSigner())
	requireVerified := middleware.RequireVerifiedEmail()
	requireCenter := middleware.RequireCenterContext()
	requireOwner := middleware.RequireRole("owner")
	settingsLimit := middleware.RateLimitByKey(
		"settings-2-5b-test-"+uuid.NewString(),
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

	mux.Handle("GET /api/terms", chain(termHandler.List))
	mux.Handle("POST /api/terms", chain(termHandler.Create))
	mux.Handle("PATCH /api/terms/{id}", chain(termHandler.Update))
	mux.Handle("DELETE /api/terms/{id}", chain(termHandler.Delete))
	mux.Handle("GET /api/holidays", chain(holidayHandler.List))
	mux.Handle("POST /api/holidays", chain(holidayHandler.Create))
	mux.Handle("PATCH /api/holidays/{id}", chain(holidayHandler.Update))
	mux.Handle("DELETE /api/holidays/{id}", chain(holidayHandler.Delete))
	mux.Handle("GET /api/rooms", chain(roomHandler.List))
	mux.Handle("POST /api/rooms", chain(roomHandler.Create))
	mux.Handle("PATCH /api/rooms/{id}", chain(roomHandler.Update))
	mux.Handle("DELETE /api/rooms/{id}", chain(roomHandler.Delete))
	return mux
}
