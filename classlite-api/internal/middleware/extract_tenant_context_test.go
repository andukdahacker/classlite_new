// Story 1.5 P2 ExtractTenant coverage: context-injection happy path.
// AC14/AC16 are pinned by ATDD; this file proves the downstream handler
// receives the populated model.TenantContext on the happy path so Epic
// 2+ stories can rely on the seam.
package middleware_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/middleware"
	"github.com/ducdo/classlite-api/internal/model"
	"github.com/ducdo/classlite-api/internal/service"
	"github.com/ducdo/classlite-api/internal/test"
)

// AC14 P2 happy path: a valid JWT carrying a center_id with an active
// membership injects model.TenantContext into the downstream context.
func TestExtractTenant_AC14_P2_ContextInjected(t *testing.T) {
	db := test.SetupDB(t)
	center := test.CreateCenterWithID(t, db, test.TenantAID, "Tenant A", "TENA")
	user := test.CreateUser(t, db, "ctx@example.com", "Ctx")
	_ = test.TenantContext(t, db, center.ID)
	_ = test.CreateCenterMember(t, db, user.ID, center.ID, "owner")

	jwt := service.NewJWTSignerWithClock([]byte("test-signing-key-at-least-256-bits-long-12345678"),
		clock.RealClock{})
	tok, err := jwt.SignAccess(service.AccessClaims{
		UserID:   test.UUIDString(user.ID),
		CenterID: test.TenantAID,
		Role:     "owner",
	}, 900)
	if err != nil {
		t.Fatalf("sign: %v", err)
	}

	var seenTC model.TenantContext
	var called bool
	mw := middleware.ExtractTenant(db, jwt)
	handler := mw(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		tc, ok := middleware.TenantFromContext(r.Context())
		if !ok {
			t.Fatal("TenantContext missing from downstream ctx")
		}
		seenTC = tc
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodGet, "/api/protected", nil)
	req.Header.Set("Authorization", "Bearer "+tok)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if !called {
		t.Fatal("downstream not invoked despite valid JWT")
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d (body=%q)", rec.Code, rec.Body.String())
	}
	if seenTC.CenterID != test.TenantAID {
		t.Errorf("CenterID = %q, want %q", seenTC.CenterID, test.TenantAID)
	}
	if seenTC.Role != "owner" {
		t.Errorf("Role = %q, want owner", seenTC.Role)
	}
}

// AC14 P2: a JWT WITHOUT a center_id claim (e.g., user with zero
// memberships) still passes through. Downstream sees a TenantContext
// with empty CenterID/Role — the membership-select endpoint (Epic 2)
// will bind one before any mutating call.
func TestExtractTenant_AC14_P2_EmptyCenterClaim_PassesThrough(t *testing.T) {
	db := test.SetupDB(t)
	user := test.CreateUser(t, db, "no-center@example.com", "No Center")

	jwt := service.NewJWTSignerWithClock([]byte("test-signing-key-at-least-256-bits-long-12345678"),
		clock.RealClock{})
	tok, err := jwt.SignAccess(service.AccessClaims{
		UserID: test.UUIDString(user.ID),
	}, 900)
	if err != nil {
		t.Fatalf("sign: %v", err)
	}

	var called bool
	mw := middleware.ExtractTenant(db, jwt)
	handler := mw(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		tc, ok := middleware.TenantFromContext(r.Context())
		if !ok {
			t.Fatal("TenantContext missing")
		}
		if tc.CenterID != "" {
			t.Errorf("expected empty CenterID for no-membership user, got %q", tc.CenterID)
		}
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodGet, "/api/protected", nil)
	req.Header.Set("Authorization", "Bearer "+tok)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if !called {
		t.Fatal("downstream not invoked for empty-center JWT")
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
}

// AC14 P2: missing Authorization header → 401 (not 500). The ATDD covers
// "Authorization present but bad" — this covers "Authorization absent".
func TestExtractTenant_AC14_P2_MissingAuthHeader_401(t *testing.T) {
	db := test.SetupDB(t)
	jwt := service.NewJWTSigner([]byte("test-signing-key-at-least-256-bits-long-12345678"))
	mw := middleware.ExtractTenant(db, jwt)

	handler := mw(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Fatal("downstream must not run without Authorization header")
	}))

	req := httptest.NewRequest(http.MethodGet, "/api/protected", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("missing Auth: expected 401, got %d", rec.Code)
	}
}

// AC14 P2: malformed Authorization (e.g., "Token xyz" instead of
// "Bearer xyz") → 401, not 500.
func TestExtractTenant_AC14_P2_MalformedAuthScheme_401(t *testing.T) {
	db := test.SetupDB(t)
	jwt := service.NewJWTSigner([]byte("test-signing-key-at-least-256-bits-long-12345678"))
	mw := middleware.ExtractTenant(db, jwt)
	handler := mw(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Fatal("downstream must not run with malformed Authorization")
	}))

	req := httptest.NewRequest(http.MethodGet, "/api/protected", nil)
	req.Header.Set("Authorization", "Token abc123")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("malformed Auth: expected 401, got %d", rec.Code)
	}
}

// Compile-time keepalive — the context-injection helper must keep the
// model import live across renames.
var _ = context.Background
var _ = model.TenantContext{}
