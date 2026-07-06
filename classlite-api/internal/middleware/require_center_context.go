// Package middleware — Story 2.2 RequireCenterContext gate.
//
// RequireCenterContext rejects requests whose ExtractTenant-populated
// TenantContext.CenterID is empty — the caller finished Story 2.1's persona
// pick but has not yet POSTed a center. The wizard's error router (Story
// 2.3b) keys on CENTER_REQUIRED to route to /setup/center.
//
// Order-of-403-checks discipline: RequireVerifiedEmail runs BEFORE
// RequireCenterContext, so verified-but-no-center → CENTER_REQUIRED,
// unverified (regardless of center state) → EMAIL_VERIFICATION_REQUIRED.
//
// Missing TenantContext (chain wired without ExtractTenant) surfaces as
// 500 so the misconfiguration is loud at deploy time — mirrors
// RequireVerifiedEmail's posture.
package middleware

import (
	"net/http"
)

// RequireCenterContext rejects requests from users without a center with
// 403 CENTER_REQUIRED. See package doc.
func RequireCenterContext() func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			tc, ok := TenantFromContext(r.Context())
			if !ok {
				writeMiddlewareJSON(w, r, http.StatusInternalServerError,
					"INTERNAL_ERROR", "An unexpected error occurred.")
				return
			}
			if tc.CenterID == "" {
				writeMiddlewareJSON(w, r, http.StatusForbidden,
					"CENTER_REQUIRED", "You must create a center before using this resource.")
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}
