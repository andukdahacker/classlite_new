// Story 1.5 P2 OriginCheck coverage: PATCH + DELETE + missing-Origin
// negative paths. The ATDD covers POST hit, POST miss, GET pass, and one
// wildcard match — this file fills the remaining mutating methods.
package middleware_test

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/ducdo/classlite-api/internal/middleware"
)

func newOriginGuard(t *testing.T) http.Handler {
	t.Helper()
	mw := middleware.NewOriginCheck([]string{
		"https://classlite.app",
		"https://my.classlite.app",
		"https://*.classlite.app",
	})
	return mw(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
}

// AC12 P2: PATCH with bad Origin rejected with the same envelope as POST.
func TestOriginCheck_AC12_P2_PatchBadOrigin_Rejected(t *testing.T) {
	h := newOriginGuard(t)
	req := httptest.NewRequest(http.MethodPatch, "/api/users/me", strings.NewReader(`{}`))
	req.Header.Set("Origin", "https://attacker.example.com")
	rec := httptest.NewRecorder()

	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("PATCH bad origin: expected 403, got %d", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "ORIGIN_NOT_ALLOWED") {
		t.Errorf("body missing ORIGIN_NOT_ALLOWED: %s", rec.Body.String())
	}
}

// AC12 P2: DELETE with bad Origin rejected.
func TestOriginCheck_AC12_P2_DeleteBadOrigin_Rejected(t *testing.T) {
	h := newOriginGuard(t)
	req := httptest.NewRequest(http.MethodDelete, "/api/classes/123", nil)
	req.Header.Set("Origin", "https://attacker.example.com")
	rec := httptest.NewRecorder()

	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("DELETE bad origin: expected 403, got %d", rec.Code)
	}
}

// AC12 P2: PUT with bad Origin rejected — completes the
// POST/PATCH/PUT/DELETE matrix.
func TestOriginCheck_AC12_P2_PutBadOrigin_Rejected(t *testing.T) {
	h := newOriginGuard(t)
	req := httptest.NewRequest(http.MethodPut, "/api/users/me", strings.NewReader(`{}`))
	req.Header.Set("Origin", "https://attacker.example.com")
	rec := httptest.NewRecorder()

	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("PUT bad origin: expected 403, got %d", rec.Code)
	}
}

// AC12 P2: POST with NO Origin header at all is rejected. A missing
// header is functionally identical to a fabricated wrong origin — the
// middleware can't distinguish "same-origin" from "attacker-with-curl",
// so it defaults to deny for mutating methods.
func TestOriginCheck_AC12_P2_PostNoOrigin_Rejected(t *testing.T) {
	h := newOriginGuard(t)
	req := httptest.NewRequest(http.MethodPost, "/api/auth/login", strings.NewReader(`{}`))
	// Note: no req.Header.Set("Origin", ...) — intentional.
	rec := httptest.NewRecorder()

	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("POST without Origin: expected 403, got %d", rec.Code)
	}
}

// AC12 P2: HEAD (safe method) bypasses the Origin check, same as GET.
func TestOriginCheck_AC12_P2_HeadPassesThrough(t *testing.T) {
	h := newOriginGuard(t)
	req := httptest.NewRequest(http.MethodHead, "/api/health", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("HEAD without Origin: expected 200, got %d", rec.Code)
	}
}

// AC12 P2: an envelope-shape sanity check on the 403 body so the
// frontend's error parser can lock the contract.
func TestOriginCheck_AC12_P2_ErrorEnvelopeShape(t *testing.T) {
	h := newOriginGuard(t)
	req := httptest.NewRequest(http.MethodPost, "/x", strings.NewReader(`{}`))
	req.Header.Set("Origin", "https://attacker.example.com")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	body := rec.Body.String()
	for _, field := range []string{`"code":"ORIGIN_NOT_ALLOWED"`, `"message"`, `"requestId"`, `"details":null`} {
		if !strings.Contains(body, field) {
			t.Errorf("envelope missing %s in body %s", field, body)
		}
	}
}
