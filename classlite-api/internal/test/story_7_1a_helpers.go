// Story 7.1a — staff roster + Owner-only actions test-server helper.
//
// Mounts the five staff routes on the EXACT production middleware chains
// (cmd/api/main.go): reads are RequireRole("owner","admin"); the three actions
// are RequireRole("owner"). Mirrors NewInvites2_6TestServerForRole — tests
// inject their caller via SignAccessTokenForRole and control the caller's DB
// role via CreateCenterMember (which is what ExtractTenant reads and RequireRole
// enforces). The caller is marked email_verified here because a real staff
// member reaching /api/staff has already accepted their invite (verified);
// RequireVerifiedEmail sits ahead of RequireRole in the production chain.
package test

import (
	"context"
	"net/http"
	"testing"
	"time"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/handler"
	"github.com/ducdo/classlite-api/internal/middleware"
	"github.com/ducdo/classlite-api/internal/service"
	"github.com/ducdo/classlite-api/internal/store/generated"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	"golang.org/x/time/rate"
)

// NewStaffTestServerForRole mounts the staff routes with a caller whose JWT
// claims match `role`. The caller's center_members row is created by the test
// (so it controls the DB-resolved role); this helper only marks the caller's
// user email_verified and injects the Bearer token.
func NewStaffTestServerForRole(
	t *testing.T,
	db storyDB,
	userID pgtype.UUID,
	centerID string,
	role string,
) http.Handler {
	t.Helper()
	markUserVerified(t, db, userID)
	tok := SignAccessTokenForRole(t, userID, centerID, role)
	return &authInjectingHandler{next: newStaffSrv(t, db), token: tok}
}

func newStaffSrv(t *testing.T, db storyDB) http.Handler {
	t.Helper()
	mux := http.NewServeMux()

	staffSvc := service.NewStaffService(db, service.NewPgAuthAuditLogger(db),
		service.NewEmailRetryQueue(&service.MockEmailSender{}, 4), clock.RealClock{})
	staffHandler := handler.NewStaffHandler(staffSvc, clock.RealClock{})

	extractTenant := middleware.ExtractTenant(db, jwtSigner())
	requireVerified := middleware.RequireVerifiedEmail()
	requireCenter := middleware.RequireCenterContext()
	requireOwnerOrAdmin := middleware.RequireRole("owner", "admin")
	requireOwner := middleware.RequireRole("owner")
	staffLimit := middleware.RateLimitByKey(
		"staff-7-1a-test-"+uuid.NewString(),
		rate.Every(60*time.Second),
		600,
		middleware.UserAndIPKeyFn,
	)
	readChain := func(h middleware.HandlerWithError) http.Handler {
		return extractTenant(
			requireVerified(
				requireCenter(
					requireOwnerOrAdmin(
						staffLimit(http.HandlerFunc(middleware.ErrorMapper(h))),
					),
				),
			),
		)
	}
	actionChain := func(h middleware.HandlerWithError) http.Handler {
		return extractTenant(
			requireVerified(
				requireCenter(
					requireOwner(
						staffLimit(http.HandlerFunc(middleware.ErrorMapper(h))),
					),
				),
			),
		)
	}
	mux.Handle("GET /api/staff", readChain(staffHandler.List))
	mux.Handle("GET /api/staff/{userId}", readChain(staffHandler.GetDetail))
	mux.Handle("POST /api/staff/{userId}/assign-class", actionChain(staffHandler.AssignClass))
	mux.Handle("POST /api/staff/{userId}/archive", actionChain(staffHandler.Archive))
	mux.Handle("POST /api/staff/{userId}/reset-password", actionChain(staffHandler.ResetPassword))
	return mux
}

// staffRosterParams builds ListStaffMembersParams with the production load
// constants (HeavyLoadThresholdSessionsPerWeek / LoadWindowDays), which the
// roster query now takes as bound args (CQ-3 — one source of truth). Store-level
// tests exercise the real boundary through these, matching the service.
func staffRosterParams(centerID pgtype.UUID, now pgtype.Timestamptz) generated.ListStaffMembersParams {
	return generated.ListStaffMembersParams{
		CenterID:       centerID,
		Now:            now,
		HeavyThreshold: service.HeavyLoadThresholdSessionsPerWeek,
		LoadWindowDays: service.LoadWindowDays,
	}
}

// markUserVerified flips users.email_verified so RequireVerifiedEmail passes —
// a staff member reaching these routes has already accepted their invite.
func markUserVerified(t *testing.T, db storyDB, userID pgtype.UUID) {
	t.Helper()
	if _, err := db.Exec(context.Background(),
		`UPDATE users SET email_verified = true WHERE id = $1`, userID); err != nil {
		t.Fatalf("mark user verified: %v", err)
	}
}
