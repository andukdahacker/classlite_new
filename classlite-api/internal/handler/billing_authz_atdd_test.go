// Story 9-1a, AC16 — the billing read surface is OWNER-ONLY (dep 2.6 RequireRole).
// GET /api/billing and GET /api/billing/plans return 403 INSUFFICIENT_ROLE to
// admin / teacher / student (the non-disclosure edge — a teacher who hits an
// enrolment wall cannot even see the billing page, which is exactly why the 409
// carries canManageBilling, D23). Owner → 200.
//
// Rides the shipped RequireRole middleware (proven by Story 2.6) around the
// net-new billing routes; the substance is that the routes are wired to the RIGHT
// gate.
//
// GREEN SEAM (dev, Task 5 — mirrors test.NewStaffTestServerForRole):
//
//	test.NewBillingTestServerForRole(t, db, callerUserID pgtype.UUID, centerID, role string) http.Handler
//	  mounts GET /api/billing + GET /api/billing/plans (RequireRole "owner") with
//	  the production ExtractTenant → Require* chain and the caller's JWT injected.
//
// RED: compile-fails on test.NewBillingTestServerForRole.
package handler_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/ducdo/classlite-api/internal/test"
)

// AC16 — admin / teacher / student are 403 INSUFFICIENT_ROLE on BOTH billing reads.
func TestBillingHandler_ReadAuthzGrid_NonOwner403_ATDD(t *testing.T) {
	for _, role := range []string{"admin", "teacher", "student"} {
		t.Run(role, func(t *testing.T) {
			db := test.SetupDB(t)
			centerA := test.CreateCenterWithID(t, db, test.TenantAID, "Center A", "center-a")
			test.TenantContext(t, db, centerA.ID)
			caller := test.CreateUser(t, db, role+"-billing@example.com", "Billing "+role)
			test.CreateCenterMember(t, db, caller.ID, centerA.ID, role)
			srv := test.NewBillingTestServerForRole(t, db, caller.ID, test.TenantAID, role)

			for _, path := range []string{"/api/billing", "/api/billing/plans"} {
				req := newReqWithRequestID(http.MethodGet, path, "")
				rec := httptest.NewRecorder()
				srv.ServeHTTP(rec, req)
				if rec.Code != http.StatusForbidden {
					t.Fatalf("%s as %s: want 403, got %d (body=%q)", path, role, rec.Code, rec.Body.String())
				}
				var env errorEnvelope
				if err := json.NewDecoder(rec.Body).Decode(&env); err != nil {
					t.Fatalf("decode: %v", err)
				}
				if env.Error.Code != "INSUFFICIENT_ROLE" {
					t.Errorf("%s as %s: error.code want INSUFFICIENT_ROLE, got %q", path, role, env.Error.Code)
				}
			}
		})
	}
}

// Positive control — an owner gets 200 on both reads (without it, a route that
// 403s EVERYONE would leave the grid above green).
func TestBillingHandler_ReadAuthzGrid_Owner200_ATDD(t *testing.T) {
	db := test.SetupDB(t)
	centerA := test.CreateCenterWithID(t, db, test.TenantAID, "Center A", "center-a")
	test.TenantContext(t, db, centerA.ID)
	owner := test.CreateUser(t, db, "owner-billing@example.com", "Billing owner")
	test.CreateCenterMember(t, db, owner.ID, centerA.ID, "owner")
	srv := test.NewBillingTestServerForRole(t, db, owner.ID, test.TenantAID, "owner")

	for _, path := range []string{"/api/billing", "/api/billing/plans"} {
		req := newReqWithRequestID(http.MethodGet, path, "")
		rec := httptest.NewRecorder()
		srv.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("%s as owner: want 200, got %d (body=%q)", path, rec.Code, rec.Body.String())
		}
	}
}
