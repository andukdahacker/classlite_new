// Story 1.5 P2 CORS coverage: preflight OPTIONS path, methods+headers
// negotiation, Vary header invariants. The ATDD already locks the
// happy/miss/wildcard-with-creds invariants — this file adds the
// preflight-specific behaviors.
package middleware_test

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/ducdo/classlite-api/internal/middleware"
)

func newCORSHandlerWithMethods() http.Handler {
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

// AC11 P2: OPTIONS preflight with a matched origin returns 204 +
// Allow-Methods + Allow-Headers + Max-Age. The downstream handler is NOT
// invoked because the preflight short-circuits.
func TestCORS_AC11_P2_Preflight_MatchedOrigin_Returns204(t *testing.T) {
	h := newCORSHandlerWithMethods()
	req := httptest.NewRequest(http.MethodOptions, "/api/auth/login", nil)
	req.Header.Set("Origin", "https://my.classlite.app")
	req.Header.Set("Access-Control-Request-Method", "POST")
	req.Header.Set("Access-Control-Request-Headers", "Content-Type, Authorization")
	rec := httptest.NewRecorder()

	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusNoContent {
		t.Fatalf("preflight matched origin: expected 204, got %d", rec.Code)
	}
	if got := rec.Header().Get("Access-Control-Allow-Methods"); !strings.Contains(got, "POST") {
		t.Errorf("Allow-Methods missing POST: %q", got)
	}
	if got := rec.Header().Get("Access-Control-Allow-Headers"); !strings.Contains(got, "Content-Type") {
		t.Errorf("Allow-Headers missing Content-Type: %q", got)
	}
	if got := rec.Header().Get("Access-Control-Max-Age"); got == "" {
		t.Errorf("Max-Age must be set on preflight; got empty")
	}
	if got := rec.Header().Get("Access-Control-Allow-Credentials"); got != "true" {
		t.Errorf("Allow-Credentials = %q, want true", got)
	}
}

// AC11 P2: OPTIONS preflight with NO Origin header passes through to the
// downstream handler (it's not a real CORS request — a same-origin
// OPTIONS would arrive without Origin).
func TestCORS_AC11_P2_Preflight_NoOrigin_PassesThrough(t *testing.T) {
	called := false
	cfg := middleware.CORSConfig{AllowedOrigins: []string{"https://classlite.app"}, AllowCredentials: true}
	h := middleware.NewCORS(cfg)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodOptions, "/x", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if !called {
		t.Fatal("OPTIONS without Origin must reach downstream")
	}
	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "" {
		t.Errorf("no Origin → no Allow-Origin header, got %q", got)
	}
}

// AC11 P2: an unmatched Origin on a real request (not preflight) must
// NOT receive the Allow-Origin reflection, but Vary: Origin MUST still
// be emitted so caches key correctly even on the miss path.
func TestCORS_AC11_P2_MissPath_AlwaysEmitsVary(t *testing.T) {
	h := newCORSHandlerWithMethods()
	req := httptest.NewRequest(http.MethodGet, "/api/health", nil)
	req.Header.Set("Origin", "https://attacker.example.com")
	rec := httptest.NewRecorder()

	h.ServeHTTP(rec, req)

	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "" {
		t.Errorf("miss path: Allow-Origin must be empty, got %q", got)
	}
	if got := rec.Header().Get("Vary"); !strings.Contains(got, "Origin") {
		t.Errorf("miss path: Vary must still include Origin, got %q", got)
	}
}

// AC11 P2: the wildcard pattern is STRICTLY single-label per EDGE-3.
// `https://acme.bad.classlite.app` (two labels before .classlite.app)
// MUST NOT match `https://*.classlite.app` — tenant slugs can't contain
// dots, and matching multi-label would let *.bad.classlite.app
// subdomains spoof the auth cookie.
func TestCORS_AC11_P2_WildcardSingleLabelOnly(t *testing.T) {
	h := newCORSHandlerWithMethods()
	req := httptest.NewRequest(http.MethodGet, "/x", nil)
	req.Header.Set("Origin", "https://acme.bad.classlite.app")
	rec := httptest.NewRecorder()

	h.ServeHTTP(rec, req)

	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "" {
		t.Errorf("multi-label subdomain must NOT match wildcard; got %q", got)
	}
}
