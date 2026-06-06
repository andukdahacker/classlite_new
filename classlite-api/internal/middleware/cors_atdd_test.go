// cors_test_atdd.go — Story 1.5 ATDD red-phase scaffolds.
//
// ACCEPTANCE CRITERIA COVERED
//   AC-1.5-11  CORS:
//                - allowlist exact match + dynamic tenant subdomain pattern
//                - never `*` with credentials
//                - Vary: Origin always emitted
//
// Risk: R8 + SEC-5 from project-context.

package middleware_test

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/ducdo/classlite-api/internal/middleware"
)

func newCORSHandler() http.Handler {
	cfg := middleware.CORSConfig{
		AllowedOrigins: []string{
			"https://classlite.app",
			"https://my.classlite.app",
			"https://*.classlite.app",
		},
		AllowCredentials: true,
	}
	mw := middleware.NewCORS(cfg)
	return mw(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
}

func TestCORS_AC11_AllowlistMatch_ReflectsOriginAndCredentials(t *testing.T) {
	h := newCORSHandler()
	req := httptest.NewRequest(http.MethodGet, "/api/health", nil)
	req.Header.Set("Origin", "https://my.classlite.app")
	rec := httptest.NewRecorder()

	h.ServeHTTP(rec, req)

	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "https://my.classlite.app" {
		t.Fatalf("Access-Control-Allow-Origin: expected exact reflection, got %q", got)
	}
	if got := rec.Header().Get("Access-Control-Allow-Credentials"); got != "true" {
		t.Fatalf("Access-Control-Allow-Credentials: expected 'true', got %q", got)
	}
	if got := rec.Header().Get("Vary"); !strings.Contains(got, "Origin") {
		t.Fatalf("Vary header MUST include Origin (Cloudflare cache safety), got %q", got)
	}
}

func TestCORS_AC11_AllowlistMiss_NoReflection(t *testing.T) {
	h := newCORSHandler()
	req := httptest.NewRequest(http.MethodGet, "/api/health", nil)
	req.Header.Set("Origin", "https://attacker.example.com")
	rec := httptest.NewRecorder()

	h.ServeHTTP(rec, req)

	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "" {
		t.Fatalf("Access-Control-Allow-Origin: expected empty for unmatched origin, got %q", got)
	}
	if got := rec.Header().Get("Access-Control-Allow-Credentials"); got != "" {
		t.Fatalf("Access-Control-Allow-Credentials: expected empty for unmatched origin, got %q", got)
	}
	if got := rec.Header().Get("Vary"); !strings.Contains(got, "Origin") {
		t.Fatalf("Vary header MUST still include Origin even on miss, got %q", got)
	}
}

// The single most important CORS assertion: never combine wildcard
// with credentials. Browsers reject this combination outright, but if
// the server ever returned it, the bug is silent in non-browser
// clients (curl, mobile webview).
func TestCORS_AC11_NeverWildcardWithCredentials(t *testing.T) {
	// Even if a deployment misconfiguration sets AllowedOrigins to ["*"]
	// the middleware must NOT emit `*` with credentials. It either drops
	// credentials, drops the wildcard reflection, or panics at startup —
	// implementation choice, but the runtime invariant holds.
	cfg := middleware.CORSConfig{
		AllowedOrigins:   []string{"*"},
		AllowCredentials: true,
	}
	mw := middleware.NewCORS(cfg)
	h := mw(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodGet, "/api/health", nil)
	req.Header.Set("Origin", "https://anywhere.example.com")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	allowOrigin := rec.Header().Get("Access-Control-Allow-Origin")
	allowCreds := rec.Header().Get("Access-Control-Allow-Credentials")

	if allowOrigin == "*" && allowCreds == "true" {
		t.Fatalf("CRITICAL SEC-5 violation: Access-Control-Allow-Origin=* with Access-Control-Allow-Credentials=true. " +
			"This combination is invalid per CORS spec and would break auth for browsers while leaking for non-browser clients.")
	}
}

// Tenant subdomain pattern matches dynamically via the wildcard rule.
func TestCORS_AC11_TenantSubdomainPattern_Matches(t *testing.T) {
	h := newCORSHandler()
	req := httptest.NewRequest(http.MethodGet, "/api/health", nil)
	req.Header.Set("Origin", "https://acme.classlite.app")
	rec := httptest.NewRecorder()

	h.ServeHTTP(rec, req)

	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "https://acme.classlite.app" {
		t.Fatalf("tenant subdomain: expected exact reflection, got %q", got)
	}
}
