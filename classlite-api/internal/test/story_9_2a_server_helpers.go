// Story 9-2a — green-phase test harness: the FU-9-CONTRACT-402 armed-gate probe server.
//
// NewBillingTestServerWithWrites mounts POST /api/billing/contract-probe on the EXACT production
// billingChain MINUS the owner-only RequireRole edge gate (extractTenant → requireVerified →
// requireCenter → ErrorMapper), so BOTH an owner and a teacher reach the plan/credit/addon gate
// and the emitted `canManageBilling` reflects the caller's REAL role (AC22/D14/D28). It runs the
// SAME 9-1a/9-2a Check*/CreateCheckout path the real endpoints run — it only removes the edge
// RBAC so the wire contract is reachable for both roles (no new emitter).
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

// NewBillingTestServerWithWrites builds the contract-probe harness around the production chain.
func NewBillingTestServerWithWrites(t *testing.T, db storyDB, userID pgtype.UUID, centerID, role string) http.Handler {
	t.Helper()
	markUserVerified(t, db, userID)

	billingSvc := service.NewBillingService(db)
	billingHandler := handler.NewBillingHandler(billingSvc, clock.NewMockClock(billingEpoch))

	extractTenant := middleware.ExtractTenant(db, jwtSigner())
	requireVerified := middleware.RequireVerifiedEmail()
	requireCenter := middleware.RequireCenterContext()
	// NO RequireRole — the probe must be reachable by both owner and teacher so the emitted
	// canManageBilling (tc.Role == owner) is exercised on both paths (D28).
	chain := func(h middleware.HandlerWithError) http.Handler {
		return extractTenant(requireVerified(requireCenter(http.HandlerFunc(middleware.ErrorMapper(h)))))
	}
	mux := http.NewServeMux()
	mux.Handle("POST /api/billing/contract-probe", chain(billingHandler.ContractProbe))

	tok := SignAccessTokenForRole(t, userID, centerID, role)
	return &authInjectingHandler{next: mux, token: tok}
}
