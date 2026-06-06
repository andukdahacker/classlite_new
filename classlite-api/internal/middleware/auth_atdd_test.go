// auth_test_atdd.go — Story 1.5 ATDD red-phase scaffolds.
//
// ACCEPTANCE CRITERIA COVERED
//   AC-1.5-14  Forged JWT with valid signature but spoofed center_id
//              rejected by extractTenant; audit_logs entry created (R4)
//   AC-1.5-16  Valid JWT signature for deleted user_id → 401 (not 500)

package middleware_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/ducdo/classlite-api/internal/middleware"
	"github.com/ducdo/classlite-api/internal/service"
	"github.com/ducdo/classlite-api/internal/test"
)

// TestExtractTenant_AC14_ForgedJWT_WrongCenterID_Rejected proves R4:
// a JWT with a valid cryptographic signature but a `center_id` claim
// that does not match any active center_members row for that user must
// be rejected with 403 INVALID_TENANT_CLAIM, NOT silently honored.
func TestExtractTenant_AC14_ForgedJWT_WrongCenterID_Rejected(t *testing.T) {
	db := test.SetupDB(t)

	// Set up two centers; user belongs ONLY to A.
	centerA := test.CreateCenterWithID(t, db, test.TenantAID, "Tenant A", "TENA")
	centerB := test.CreateCenterWithID(t, db, test.TenantBID, "Tenant B", "TENB")
	user := test.CreateUser(t, db, "alice@example.com", "Alice")
	_ = test.TenantContext(t, db, centerA.ID)
	_ = test.CreateCenterMember(t, db, user.ID, centerA.ID, "owner")
	_ = centerB // for clarity in the assertion below

	// Mint a JWT that claims access to center B (where user has no
	// membership). The signature is valid; the claim is the forgery.
	jwtSvc := service.NewJWTSigner([]byte("test-signing-key-at-least-256-bits-long-12345678"))
	token, err := jwtSvc.SignAccess(service.AccessClaims{
		UserID:   uuidToString(user.ID),
		CenterID: test.TenantBID, // forged — user has no membership here
		Role:     "owner",        // also forged
	}, 15*60)
	if err != nil {
		t.Fatalf("sign forged token: %v", err)
	}

	mw := middleware.ExtractTenant(db, jwtSvc)
	called := false
	handler := mw(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodGet, "/api/whatever", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if called {
		t.Fatal("downstream handler called with forged center_id JWT — R4 violation")
	}
	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected 403 Forbidden, got %d", rec.Code)
	}
	if body := rec.Body.String(); !strings.Contains(body, "INVALID_TENANT_CLAIM") {
		t.Fatalf("expected error code INVALID_TENANT_CLAIM, got body %q", body)
	}

	// audit_logs entry must record the attempt for forensics.
	var attemptCount int
	_ = test.TenantContext(t, db, centerB.ID)
	if err := db.QueryRow(context.Background(),
		`SELECT COUNT(*) FROM auth_audit_logs WHERE event = 'invalid_tenant_claim' AND user_id = $1`,
		user.ID,
	).Scan(&attemptCount); err != nil {
		t.Fatalf("count audit log entries: %v", err)
	}
	if attemptCount == 0 {
		t.Fatal("expected auth_audit_logs entry for invalid_tenant_claim attempt, got none")
	}
}

// TestExtractTenant_AC16_ValidJWT_DeletedUser_Returns401 covers the
// edge case where the JWT signature is valid but the user_id references
// a row that no longer exists. Must return 401 (not 500).
func TestExtractTenant_AC16_ValidJWT_DeletedUser_Returns401(t *testing.T) {
	db := test.SetupDB(t)
	center := test.CreateCenterWithID(t, db, test.TenantAID, "Tenant A", "TENA")
	user := test.CreateUser(t, db, "alice@example.com", "Alice")
	_ = test.TenantContext(t, db, center.ID)
	_ = test.CreateCenterMember(t, db, user.ID, center.ID, "owner")

	jwtSvc := service.NewJWTSigner([]byte("test-signing-key-at-least-256-bits-long-12345678"))
	token, err := jwtSvc.SignAccess(service.AccessClaims{
		UserID:   uuidToString(user.ID),
		CenterID: test.TenantAID,
		Role:     "owner",
	}, 15*60)
	if err != nil {
		t.Fatalf("sign token: %v", err)
	}

	// Delete the user. The `users` row is FK-referenced by `center_members`
	// (no ON DELETE CASCADE), so clear the membership row first or the user
	// DELETE fails on FK violation before we reach the assertion.
	if _, err := db.Exec(context.Background(),
		`DELETE FROM center_members WHERE user_id = $1`, user.ID); err != nil {
		t.Fatalf("clear center_members FK before user delete: %v", err)
	}
	if _, err := db.Exec(context.Background(), `DELETE FROM users WHERE id = $1`, user.ID); err != nil {
		t.Fatalf("delete user: %v", err)
	}

	mw := middleware.ExtractTenant(db, jwtSvc)
	called := false
	handler := mw(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodGet, "/api/whatever", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if called {
		t.Fatal("downstream handler called with valid JWT for deleted user")
	}
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 Unauthorized for deleted user, got %d (must not be 500)", rec.Code)
	}
}

// uuidToString helper (shared with role_revalidation_test_atdd.go).
func uuidToString(u interface{ MarshalJSON() ([]byte, error) }) string {
	b, _ := u.MarshalJSON()
	if len(b) >= 2 {
		return string(b[1 : len(b)-1])
	}
	return ""
}
