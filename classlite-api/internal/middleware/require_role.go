// Package middleware — Story 1.6 RequireRole gate.
//
// RequireRole guards admin endpoints by inspecting the DB-resolved role
// already injected by ExtractTenant. ExtractTenant overwrites the JWT's
// role claim with whatever the center_members row says — the EDGE-2
// staleness defense from Story 1.5. RequireRole consumes that
// authoritative value; never re-reads the JWT claim.
//
// Design boundary: this middleware is a thin gatekeeper. The downstream
// service layer (AuthService.ForceLogout, etc.) STILL re-validates the
// role from DB inside its own tx — that's defense-in-depth against the
// (vanishingly unlikely) case where someone bypasses this middleware by
// wiring the route incorrectly. The middleware exists to fail fast at
// the HTTP edge so a misconfigured route doesn't reach the service at
// all on a non-Owner request.
package middleware

import (
	"context"
	"net/http"

	"github.com/ducdo/classlite-api/internal/model"
)

// WithTenantContext is the in-package re-export of model.WithTenantContext
// kept for ATDD callsites. New code should call model.WithTenantContext.
func WithTenantContext(ctx context.Context, tc model.TenantContext) context.Context {
	return model.WithTenantContext(ctx, tc)
}

// RequireRole rejects requests whose ExtractTenant-populated
// TenantContext.Role is not in the allowed list. Missing TenantContext
// (programming bug — the chain was wired without ExtractTenant) is a
// 500 so the misconfiguration surfaces loudly instead of silently
// passing the request through.
func RequireRole(allowed ...string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			tc, ok := TenantFromContext(r.Context())
			if !ok {
				writeMiddlewareJSON(w, r, http.StatusInternalServerError,
					"INTERNAL_ERROR", "An unexpected error occurred.")
				return
			}
			for _, role := range allowed {
				if tc.Role == role {
					next.ServeHTTP(w, r)
					return
				}
			}
			writeMiddlewareJSON(w, r, http.StatusForbidden,
				"INSUFFICIENT_ROLE", "Insufficient role to access this resource.")
		})
	}
}
