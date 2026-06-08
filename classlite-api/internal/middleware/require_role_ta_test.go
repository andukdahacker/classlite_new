// require_role_ta_test.go — Story 1.6 TA expansion (P2/P3).
//
// Role-negative breadth: the ATDD red phase covered owner-passes,
// teacher-blocked, missing-context-500, and the multi-role variadic
// API. This TA pass adds admin-only, student-blocked, and the
// owner-OR-admin grid so every role × every gate is exercised.

package middleware_test

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/ducdo/classlite-api/internal/middleware"
	"github.com/ducdo/classlite-api/internal/model"
)

// TestRequireRole_AdminOnly_RejectsTeacher (#15) — RequireRole("admin")
// against a teacher TC must 403 INSUFFICIENT_ROLE.
func TestRequireRole_AdminOnly_RejectsTeacher(t *testing.T) {
	called := false
	downstream := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { called = true })

	chain := withTenantContext(
		model.TenantContext{Role: "teacher", UserID: "u", CenterID: "c"},
		middleware.RequireRole("admin")(downstream),
	)
	rec := httptest.NewRecorder()
	chain.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/api/admin/x", nil))

	if called {
		t.Fatal("teacher reached downstream of RequireRole('admin')")
	}
	if rec.Code != http.StatusForbidden {
		t.Fatalf("status: want 403, got %d", rec.Code)
	}
}

// TestRequireRole_OwnerOrAdmin_AcceptsBoth (#16) — the variadic
// allowlist works for either role; non-listed roles still reject.
func TestRequireRole_OwnerOrAdmin_AcceptsBoth(t *testing.T) {
	for _, tc := range []struct {
		role     string
		wantCode int
	}{
		{"owner", http.StatusOK},
		{"admin", http.StatusOK},
		{"teacher", http.StatusForbidden},
		{"student", http.StatusForbidden},
	} {
		t.Run(tc.role, func(t *testing.T) {
			called := false
			downstream := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				called = true
				w.WriteHeader(http.StatusOK)
			})
			chain := withTenantContext(
				model.TenantContext{Role: tc.role, UserID: "u", CenterID: "c"},
				middleware.RequireRole("owner", "admin")(downstream),
			)
			rec := httptest.NewRecorder()
			chain.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil))

			if rec.Code != tc.wantCode {
				t.Fatalf("role=%s: status want %d, got %d", tc.role, tc.wantCode, rec.Code)
			}
			wantCalled := tc.wantCode == http.StatusOK
			if called != wantCalled {
				t.Fatalf("role=%s: downstream called=%v, want %v", tc.role, called, wantCalled)
			}
		})
	}
}

// TestRequireRole_StudentRole_BlockedFromAdminRoutes (#17) — explicit
// student-rejection assertion. Student role is the highest-population
// role in prod; rejecting it from admin routes is the load-bearing
// behavior under the volume the system actually sees.
func TestRequireRole_StudentRole_BlockedFromAdminRoutes(t *testing.T) {
	called := false
	downstream := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { called = true })

	chain := withTenantContext(
		model.TenantContext{Role: "student", UserID: "u", CenterID: "c"},
		middleware.RequireRole("owner")(downstream),
	)
	rec := httptest.NewRecorder()
	chain.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/api/admin/users/x/force-logout", nil))

	if called {
		t.Fatal("student reached downstream of RequireRole('owner')")
	}
	if rec.Code != http.StatusForbidden {
		t.Fatalf("status: want 403, got %d", rec.Code)
	}
	// Defense-in-depth: response envelope shape parity with other roles.
	if body := rec.Body.String(); !contains(body, "INSUFFICIENT_ROLE") {
		t.Errorf("body should contain INSUFFICIENT_ROLE, got %q", body)
	}
}

// contains is a local helper avoiding an extra import.
func contains(haystack, needle string) bool {
	return len(haystack) >= len(needle) && indexOf(haystack, needle) >= 0
}

func indexOf(s, sub string) int {
	n := len(sub)
	if n == 0 {
		return 0
	}
	for i := 0; i+n <= len(s); i++ {
		if s[i:i+n] == sub {
			return i
		}
	}
	return -1
}
