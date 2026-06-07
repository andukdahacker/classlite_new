//go:build atdd_red_phase

// require_role_atdd_test.go — Story 1.6 ATDD red-phase scaffolds for
// the new RequireRole middleware (Task 8). RequireRole reads the
// DB-resolved tc.Role injected by ExtractTenant and rejects any
// caller whose role is not in the allowlist.
//
// The middleware is a thin gatekeeper: by the time it runs,
// ExtractTenant has already (a) verified the JWT signature, (b)
// looked up the membership row, (c) overwritten tc.Role with the
// DB-resolved value. RequireRole MUST consume that authoritative
// role — never re-read JWT claims (per EDGE-2 / SEC-1).
//
// ACCEPTANCE CRITERIA COVERED
//   Task 8 — RequireRole("owner") passes Owners, rejects everyone else
//   Task 8 — Missing TenantContext (programming bug) → 500
//   Task 8 — Error envelope shape matches the canonical inline middleware writer

package middleware_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/ducdo/classlite-api/internal/middleware"
	"github.com/ducdo/classlite-api/internal/model"
)

// withTenantContext is a test-only middleware that injects a
// pre-built model.TenantContext into the request context. Production
// uses middleware.ExtractTenant; these tests skip the JWT verification
// step so we can isolate RequireRole behavior.
//
// IMPLEMENTATION NOTE FOR DEV: this calls middleware.WithTenantContext,
// a new exported helper that pairs with the existing unexported
// TenantFromContext read path. Add it to middleware/auth.go as:
//
//	func WithTenantContext(ctx context.Context, tc model.TenantContext) context.Context {
//	    return context.WithValue(ctx, tenantContextKey{}, tc)
//	}
//
// Keeps the typed key unexported (good encapsulation) while giving
// tests a clean write seam.
func withTenantContext(tc model.TenantContext, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ctx := middleware.WithTenantContext(r.Context(), tc)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// TestRequireRole_OwnerPasses proves the happy path: a TenantContext
// carrying Role="owner" reaches the downstream handler unmolested.
func TestRequireRole_OwnerPasses(t *testing.T) {
	called := false
	downstream := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		w.WriteHeader(http.StatusOK)
	})

	chain := withTenantContext(
		model.TenantContext{Role: "owner", UserID: "user-1", CenterID: "center-1"},
		middleware.RequireRole("owner")(downstream),
	)

	req := httptest.NewRequest(http.MethodPost, "/api/admin/whatever", nil)
	rec := httptest.NewRecorder()
	chain.ServeHTTP(rec, req)

	if !called {
		t.Fatal("downstream handler was not invoked despite caller being owner")
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("status: want 200, got %d", rec.Code)
	}
}

// TestRequireRole_Teacher_Returns403 proves the rejection path: a
// non-Owner caller is rejected BEFORE the downstream handler runs.
// The envelope shape mirrors the canonical inline middleware writer
// (no error_mapper involvement since middleware emits the response
// directly).
func TestRequireRole_Teacher_Returns403(t *testing.T) {
	called := false
	downstream := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
	})

	chain := withTenantContext(
		model.TenantContext{Role: "teacher", UserID: "user-1", CenterID: "center-1"},
		middleware.RequireRole("owner")(downstream),
	)

	req := httptest.NewRequest(http.MethodPost, "/api/admin/whatever", nil)
	rec := httptest.NewRecorder()
	chain.ServeHTTP(rec, req)

	if called {
		t.Fatal("downstream handler was invoked despite caller being teacher")
	}
	if rec.Code != http.StatusForbidden {
		t.Fatalf("status: want 403, got %d", rec.Code)
	}
	if body := rec.Body.String(); !strings.Contains(body, "INSUFFICIENT_ROLE") {
		t.Fatalf("expected error code INSUFFICIENT_ROLE in body, got %q", body)
	}

	// Full envelope assertion — error.code, error.message, error.requestId, error.details=null
	var env struct {
		Error struct {
			Code      string  `json:"code"`
			Message   string  `json:"message"`
			RequestID string  `json:"requestId"`
			Details   *string `json:"details"`
		} `json:"error"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
		t.Fatalf("decode error envelope: %v (body=%q)", err, rec.Body.String())
	}
	if env.Error.Code != "INSUFFICIENT_ROLE" {
		t.Errorf("error.code: want %q, got %q", "INSUFFICIENT_ROLE", env.Error.Code)
	}
	if env.Error.Message == "" {
		t.Error("error.message: want non-empty, got empty")
	}
	if env.Error.Details != nil {
		t.Errorf("error.details: want null, got %v", env.Error.Details)
	}
}

// TestRequireRole_MultipleAllowedRoles proves the variadic API works:
// RequireRole("owner", "admin") accepts either role.
func TestRequireRole_MultipleAllowedRoles(t *testing.T) {
	for _, role := range []string{"owner", "admin"} {
		t.Run(role, func(t *testing.T) {
			called := false
			downstream := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { called = true })
			chain := withTenantContext(
				model.TenantContext{Role: role, UserID: "u", CenterID: "c"},
				middleware.RequireRole("owner", "admin")(downstream),
			)
			rec := httptest.NewRecorder()
			chain.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil))
			if !called {
				t.Fatalf("role %q expected to pass RequireRole, but downstream was not called", role)
			}
		})
	}
}

// TestRequireRole_NoTenantContext_Returns500 proves the programming-bug
// path: if RequireRole runs without ExtractTenant having injected a
// TenantContext (i.e., a developer wired the middleware chain wrong),
// the response is 500 — surface loudly rather than silently allow.
func TestRequireRole_NoTenantContext_Returns500(t *testing.T) {
	called := false
	downstream := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { called = true })

	// Direct wire — NO ExtractTenant / withTenantContext upstream.
	chain := middleware.RequireRole("owner")(downstream)

	req := httptest.NewRequest(http.MethodPost, "/api/admin/whatever", nil)
	rec := httptest.NewRecorder()
	chain.ServeHTTP(rec, req)

	if called {
		t.Fatal("downstream handler was invoked despite missing TenantContext")
	}
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status: want 500, got %d", rec.Code)
	}
}
