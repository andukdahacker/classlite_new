//go:build atdd_red_phase

// RED-PHASE ATDD specimen for Story 2.1 — RequireVerifiedEmail middleware.
//
// Expected to FAIL against current codebase:
//   - middleware.RequireVerifiedEmail does not exist
//   - model.TenantContext has no EmailVerified field (Task 5.0 adds it)
//
// Coverage: AC8 middleware contract per project-context GFW-1..7 + Task 5.1.
// Three cases only — no DB call (pure context-check middleware per Winston-B1
// = Amelia-B1 fold that extends ExtractTenant to populate the field).

package middleware_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/ducdo/classlite-api/internal/middleware"
	"github.com/ducdo/classlite-api/internal/model"
)

// -----------------------------------------------------------------------------
// AC8 / Task 5.1 — three canonical middleware cases.
// -----------------------------------------------------------------------------

func TestRequireVerifiedEmail_AC08_VerifiedContext_Passes(t *testing.T) {
	handlerCalled := false
	downstream := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		handlerCalled = true
		w.WriteHeader(http.StatusNoContent)
	})

	// Green-phase: middleware.RequireVerifiedEmail() takes no args
	// (pure context-check, no DB dependency).
	chain := middleware.RequireVerifiedEmail()(downstream)

	req := httptest.NewRequest(http.MethodGet, "/some/protected/path", nil)
	ctx := model.WithTenantContext(req.Context(), model.TenantContext{
		UserID:        "00000000-0000-0000-0000-000000000042",
		EmailVerified: true,
	})
	req = req.WithContext(ctx)
	rec := httptest.NewRecorder()

	chain.ServeHTTP(rec, req)

	if !handlerCalled {
		t.Fatalf("RequireVerifiedEmail: verified user MUST pass through")
	}
	if rec.Code != http.StatusNoContent {
		t.Errorf("downstream status leaked: got %d", rec.Code)
	}
}

func TestRequireVerifiedEmail_AC08_UnverifiedContext_Returns403(t *testing.T) {
	downstreamCalled := false
	downstream := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		downstreamCalled = true
	})
	chain := middleware.RequireVerifiedEmail()(downstream)

	req := httptest.NewRequest(http.MethodGet, "/some/protected/path", nil)
	ctx := model.WithTenantContext(req.Context(), model.TenantContext{
		UserID:        "00000000-0000-0000-0000-000000000042",
		EmailVerified: false, // ← the discriminant
	})
	req = req.WithContext(ctx)
	rec := httptest.NewRecorder()

	chain.ServeHTTP(rec, req)

	if downstreamCalled {
		t.Fatalf("AC8: unverified user MUST be rejected — downstream MUST NOT run")
	}
	if rec.Code != http.StatusForbidden {
		t.Errorf("want 403 Forbidden, got %d", rec.Code)
	}

	var env struct {
		Error struct{ Code string `json:"code"` } `json:"error"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&env); err != nil {
		t.Fatalf("decode error envelope: %v", err)
	}
	if env.Error.Code != "EMAIL_VERIFICATION_REQUIRED" {
		t.Errorf("want error.code=EMAIL_VERIFICATION_REQUIRED, got %q — Story 1.9d says specific codes are load-bearing", env.Error.Code)
	}
}

func TestRequireVerifiedEmail_AC08_MissingContext_Returns500(t *testing.T) {
	// Programming-error case: chain wired without ExtractTenant.
	// Mirrors RequireRole's posture at internal/middleware/require_role.go:40-44 —
	// 500 makes the misconfiguration surface loudly at deploy time rather than
	// silently passing every request through as unverified.
	downstreamCalled := false
	downstream := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		downstreamCalled = true
	})
	chain := middleware.RequireVerifiedEmail()(downstream)

	req := httptest.NewRequest(http.MethodGet, "/some/protected/path", nil)
	// Deliberately NO WithTenantContext — simulates a chain wiring bug.
	rec := httptest.NewRecorder()

	chain.ServeHTTP(rec, req)

	if downstreamCalled {
		t.Fatalf("AC8: missing TenantContext MUST NOT reach downstream")
	}
	if rec.Code != http.StatusInternalServerError {
		t.Errorf("want 500 (programming error, not 401/403), got %d", rec.Code)
	}
}
