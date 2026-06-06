// origin_test_atdd.go — Story 1.5 ATDD red-phase scaffolds.
//
// ACCEPTANCE CRITERIA COVERED
//   AC-1.5-12  Origin header check on POST/PUT/DELETE/PATCH —
//              defense in depth even when CORS preflight passed (R8)

package middleware_test

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/ducdo/classlite-api/internal/middleware"
)

func TestOriginCheck_AC12_MutatingPOST_AllowlistMatch_Passes(t *testing.T) {
	mw := middleware.NewOriginCheck([]string{
		"https://classlite.app",
		"https://my.classlite.app",
	})

	called := false
	handler := mw(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodPost, "/api/auth/login", strings.NewReader(`{}`))
	req.Header.Set("Origin", "https://my.classlite.app")
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if !called {
		t.Fatal("downstream handler not called — Origin allowlist match should pass through")
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK, got %d", rec.Code)
	}
}

func TestOriginCheck_AC12_MutatingPOST_AllowlistMiss_Rejected(t *testing.T) {
	mw := middleware.NewOriginCheck([]string{
		"https://classlite.app",
		"https://my.classlite.app",
	})

	called := false
	handler := mw(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodPost, "/api/auth/login", strings.NewReader(`{}`))
	req.Header.Set("Origin", "https://attacker.example.com")
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if called {
		t.Fatal("downstream handler called despite Origin allowlist miss — defense in depth broken")
	}
	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected 403 Forbidden, got %d", rec.Code)
	}
	if got := rec.Body.String(); !strings.Contains(got, "ORIGIN_NOT_ALLOWED") {
		t.Fatalf("expected error code ORIGIN_NOT_ALLOWED in body, got %q", got)
	}
}

// Safe HTTP methods (GET, HEAD, OPTIONS) bypass the Origin check — they
// can't mutate, so the CORS layer alone is sufficient defense.
func TestOriginCheck_AC12_SafeGET_PassesWithoutOriginHeader(t *testing.T) {
	mw := middleware.NewOriginCheck([]string{"https://classlite.app"})

	called := false
	handler := mw(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodGet, "/api/health", nil)
	// No Origin header at all.
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if !called {
		t.Fatal("GET without Origin should pass through (safe method)")
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK, got %d", rec.Code)
	}
}

// Subdomain-scoped tenant origin matches via dynamic pattern.
func TestOriginCheck_AC12_TenantSubdomain_Matches(t *testing.T) {
	mw := middleware.NewOriginCheck([]string{
		"https://classlite.app",
		"https://my.classlite.app",
		"https://*.classlite.app", // tenant slugs match the wildcard
	})

	called := false
	handler := mw(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodPost, "/api/whatever", strings.NewReader(`{}`))
	req.Header.Set("Origin", "https://acmecenter.classlite.app")
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if !called {
		t.Fatal("downstream handler should be called for valid tenant subdomain")
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
}
