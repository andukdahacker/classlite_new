// Regression: login/refresh must resolve a single-membership user's center + role
// from the PRE-TENANT context (no app.current_tenant_id GUC) even though
// center_members is FORCE RLS. buildAccessToken previously used a plain
// `SELECT ... FROM center_members` which RLS silently returns 0 rows for under the
// non-superuser classlite_app role with no GUC — so EVERY onboarded user got
// `center: null` + no JWT tenant claim → 403 on every scoped route. The fix routes
// the lookup through the count_center_members_for_user / single_center_membership_for_user
// SECURITY DEFINER functions (owned by the BYPASSRLS migrator).
//
// This test runs as classlite_app with the tenant GUC CLEARED — the exact
// condition that detonated in prod — so it FAILS against the old plain-query code
// and PASSES with the SECURITY DEFINER fix. The existing login tests never created a
// center_members row, so this path had zero coverage.

package service_test

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/service"
	"github.com/ducdo/classlite-api/internal/test"
)

func TestLogin_ResolvesSingleMembershipCenter_FromPreTenantContext(t *testing.T) {
	db := test.SetupDB(t) // classlite_app, RLS enforced, no tenant GUC
	clk := clock.NewMockClock(time.Date(2026, 10, 16, 12, 0, 0, 0, time.UTC))

	user := test.CreateUser(t, db, "owner@example.com", "Center Owner")
	centerIDStr := uuid.NewString()
	centerID := test.NewPGUUIDFromString(centerIDStr)
	_ = test.CreateCenterWithID(t, db, centerIDStr, "Tenant A", "TENA-"+centerIDStr[:4])

	// Inserting a center_members row needs the tenant GUC (RLS INSERT policy). Set it
	// for the insert, then CLEAR it so Login runs from the real pre-tenant context —
	// otherwise the old plain query would see the row (GUC match) and mask the bug.
	ctx := test.TenantContext(t, db, centerID)
	_ = test.CreateCenterMember(t, db, user.ID, centerID, "owner")
	// Unset the GUC entirely (not = '') so the session matches the real pre-tenant login
	// context exactly: current_setting(..., true) returns NULL, as in the passing login tests.
	if _, err := db.Exec(ctx, `RESET app.current_tenant_id`); err != nil {
		t.Fatalf("reset tenant GUC: %v", err)
	}

	svc := newAuthServiceWithClock(t, db, clk)
	if err := svc.SetPassword(context.Background(), user.ID, "ValidPass123!"); err != nil {
		t.Fatalf("SetPassword: %v", err)
	}

	result, err := svc.Login(context.Background(), service.LoginInput{
		Email:      "owner@example.com",
		Password:   "ValidPass123!",
		RememberMe: false,
	})
	if err != nil {
		t.Fatalf("Login: %v", err)
	}

	// THE regression assertion: center + role resolve despite FORCE RLS + no GUC.
	if result.Center == nil {
		t.Fatal("LoginResult.Center is nil — buildAccessToken failed to resolve the single membership under RLS (the plain-query bug: the frontend gets center:null, the JWT has no tenant, and every scoped route 403s)")
	}
	if got := test.UUIDString(centerID); result.Center.ID != got {
		t.Errorf("Center.ID = %q, want %q", result.Center.ID, got)
	}
	if result.Role != "owner" {
		t.Errorf("Role = %q, want owner", result.Role)
	}
}
