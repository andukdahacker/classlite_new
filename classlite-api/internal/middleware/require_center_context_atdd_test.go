// ATDD specimen for Story 2.2 — RequireCenterContext middleware.
//
// Expected to FAIL against current codebase:
//   - middleware.RequireCenterContext does not exist yet
//   - The three endpoints that will compose it (GET /api/templates,
//     POST /api/templates, POST /api/templates/{id}/spawn) are not
//     wired in cmd/api/main.go
//
// Coverage: AC8 middleware contract per project-context GFW-1..7 + Task 4.1.
// Three canonical cases mirroring require_verified_email_atdd_test.go — pure
// context-check middleware, no DB dependency.

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
// AC8 / Task 4.1 — three canonical middleware cases.
// Order-of-403-checks discipline: RequireVerifiedEmail runs BEFORE
// RequireCenterContext, so this middleware only fires with a verified-email
// caller. The tests here focus on the CenterID discriminant only.
// -----------------------------------------------------------------------------

func TestRequireCenterContext_AC08_CenterPresent_Passes(t *testing.T) {
	handlerCalled := false
	downstream := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		handlerCalled = true
		w.WriteHeader(http.StatusNoContent)
	})

	// Green-phase: middleware.RequireCenterContext() takes no args
	// (pure context-check, no DB dependency).
	chain := middleware.RequireCenterContext()(downstream)

	req := httptest.NewRequest(http.MethodGet, "/api/templates", nil)
	ctx := model.WithTenantContext(req.Context(), model.TenantContext{
		UserID:        "00000000-0000-0000-0000-000000000042",
		CenterID:      "00000000-0000-0000-0000-000000000123",
		EmailVerified: true,
	})
	req = req.WithContext(ctx)
	rec := httptest.NewRecorder()

	chain.ServeHTTP(rec, req)

	if !handlerCalled {
		t.Fatalf("RequireCenterContext: caller with center MUST pass through")
	}
	if rec.Code != http.StatusNoContent {
		t.Errorf("downstream status leaked: got %d", rec.Code)
	}
}

func TestRequireCenterContext_AC08_MissingCenter_Returns403CenterRequired(t *testing.T) {
	// AC8 discriminant: a caller who finished Story 2.1's persona pick but
	// has NOT yet POSTed a center hits this middleware with CenterID="".
	// The wizard's error router (Story 2.3b) keys on CENTER_REQUIRED to
	// bounce them to /setup/center — mismatching this code breaks the
	// polished-screen route (Story 1.9d discipline).
	downstreamCalled := false
	downstream := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		downstreamCalled = true
	})
	chain := middleware.RequireCenterContext()(downstream)

	req := httptest.NewRequest(http.MethodGet, "/api/templates", nil)
	ctx := model.WithTenantContext(req.Context(), model.TenantContext{
		UserID:        "00000000-0000-0000-0000-000000000042",
		CenterID:      "", // ← the discriminant (post-2.1 persona pick, pre-center create)
		EmailVerified: true,
	})
	req = req.WithContext(ctx)
	rec := httptest.NewRecorder()

	chain.ServeHTTP(rec, req)

	if downstreamCalled {
		t.Fatalf("AC8: caller without center MUST be rejected — downstream MUST NOT run")
	}
	if rec.Code != http.StatusForbidden {
		t.Errorf("want 403 Forbidden, got %d", rec.Code)
	}

	var env struct {
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&env); err != nil {
		t.Fatalf("decode error envelope: %v", err)
	}
	if env.Error.Code != "CENTER_REQUIRED" {
		t.Errorf("AC13 error catalog: want error.code=CENTER_REQUIRED, got %q — wizard's Story 2.3b router keys on this exact string to route to /setup/center", env.Error.Code)
	}
}

func TestRequireCenterContext_AC08_MissingContext_Returns500(t *testing.T) {
	// Programming-error case: chain wired without ExtractTenant.
	// Mirrors RequireVerifiedEmail's posture at
	// internal/middleware/require_verified_email.go:26-30 — 500 makes the
	// misconfiguration surface loudly at deploy time rather than silently
	// passing every request through as "no center required".
	downstreamCalled := false
	downstream := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		downstreamCalled = true
	})
	chain := middleware.RequireCenterContext()(downstream)

	req := httptest.NewRequest(http.MethodGet, "/api/templates", nil)
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
