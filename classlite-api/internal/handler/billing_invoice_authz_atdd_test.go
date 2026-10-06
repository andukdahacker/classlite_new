// Story 9-3 — AC16 / Dev-Notes l.132-133: the invoice read + email-to-accountant endpoints are
// OWNER-ONLY. Added per the 2026-10-05 party-mode review HIGH finding: the only invoice-endpoint
// coverage was client-side FE gating, so a dev who wires these without the owner billingChain
// gate would let any teacher/admin/student read the owner's full financial history (amounts,
// VAT, PDF links) or trigger accountant emails — a financial-data leak with zero gate signal.
//
// Mirrors the shipped billing_authz_atdd_test.go (GET /api/billing owner-gate), extended to the
// two net-new invoice paths.
//
// GREEN SEAM: the invoice routes are mounted under the SAME owner RequireRole gate used by
// GET /api/billing — i.e. test.NewBillingTestServerForRole (Story 9-1a) learns:
//     GET  /api/billing/invoices        (RequireRole "owner")
//     POST /api/billing/invoices/email  (RequireRole "owner")
// Until they are mounted, a non-owner request returns 404 (route absent) ≠ 403 → the red fails
// (runtime). At green the gate returns 403 INSUFFICIENT_ROLE for non-owners.
//
// RED: fails until the invoice routes are mounted under the owner gate on NewBillingTestServerForRole.

package handler_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/ducdo/classlite-api/internal/test"
)

// TestBillingInvoiceHandler_NonOwner403_ATDD — admin/teacher/student are 403 INSUFFICIENT_ROLE
// on BOTH invoice endpoints (read + email-to-accountant).
func TestBillingInvoiceHandler_NonOwner403_ATDD(t *testing.T) {
	type route struct {
		method string
		path   string
	}
	routes := []route{
		{http.MethodGet, "/api/billing/invoices"},
		{http.MethodPost, "/api/billing/invoices/email"},
	}
	for _, role := range []string{"admin", "teacher", "student"} {
		t.Run(role, func(t *testing.T) {
			db := test.SetupDB(t)
			centerA := test.CreateCenterWithID(t, db, test.TenantAID, "Center A", "center-a")
			test.TenantContext(t, db, centerA.ID)
			caller := test.CreateUser(t, db, role+"-invoice@example.com", "Invoice "+role)
			test.CreateCenterMember(t, db, caller.ID, centerA.ID, role)
			srv := test.NewBillingTestServerForRole(t, db, caller.ID, test.TenantAID, role)

			for _, rt := range routes {
				req := newReqWithRequestID(rt.method, rt.path, `{"recipient":"accountant@example.com"}`)
				rec := httptest.NewRecorder()
				srv.ServeHTTP(rec, req)
				if rec.Code != http.StatusForbidden {
					t.Fatalf("%s %s as %s: want 403, got %d (body=%q)", rt.method, rt.path, role, rec.Code, rec.Body.String())
				}
				var env errorEnvelope
				if err := json.NewDecoder(rec.Body).Decode(&env); err != nil {
					t.Fatalf("decode: %v", err)
				}
				if env.Error.Code != "INSUFFICIENT_ROLE" {
					t.Errorf("%s %s as %s: error.code want INSUFFICIENT_ROLE, got %q", rt.method, rt.path, role, env.Error.Code)
				}
			}
		})
	}
}

// TestBillingInvoiceHandler_OwnerNot403_ATDD — positive control: an owner is NOT 403 on either
// invoice endpoint (without it, a route that 403s EVERYONE would leave the grid above green).
func TestBillingInvoiceHandler_OwnerNot403_ATDD(t *testing.T) {
	db := test.SetupDB(t)
	centerA := test.CreateCenterWithID(t, db, test.TenantAID, "Center A", "center-a")
	test.TenantContext(t, db, centerA.ID)
	owner := test.CreateUser(t, db, "owner-invoice@example.com", "Invoice Owner")
	test.CreateCenterMember(t, db, owner.ID, centerA.ID, "owner")
	srv := test.NewBillingTestServerForRole(t, db, owner.ID, test.TenantAID, "owner")

	req := newReqWithRequestID(http.MethodGet, "/api/billing/invoices", "")
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, req)
	if rec.Code == http.StatusForbidden {
		t.Fatalf("GET /api/billing/invoices as owner: got 403, want non-403 (owner is permitted)")
	}
}
