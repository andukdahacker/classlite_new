// Package middleware — Story 2.1 RequireVerifiedEmail gate.
//
// RequireVerifiedEmail rejects requests whose ExtractTenant-populated
// TenantContext.EmailVerified is false. ExtractTenant reads
// users.email_verified during its GetUserByID pass and copies it into the
// tenant context, so this middleware needs no DB dependency — a pure
// context check that mirrors RequireRole's shape.
//
// Missing TenantContext (programming bug — the chain was wired without
// ExtractTenant) is a 500 so the misconfiguration surfaces loudly at
// deploy time instead of silently passing every request through as
// unverified.
package middleware

import (
	"net/http"
)

// RequireVerifiedEmail rejects requests from users whose email is not
// verified with 403 EMAIL_VERIFICATION_REQUIRED. See package doc for the
// EmailVerified sourcing story.
func RequireVerifiedEmail() func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			tc, ok := TenantFromContext(r.Context())
			if !ok {
				writeMiddlewareJSON(w, r, http.StatusInternalServerError,
					"INTERNAL_ERROR", "An unexpected error occurred.")
				return
			}
			if !tc.EmailVerified {
				writeMiddlewareJSON(w, r, http.StatusForbidden,
					"EMAIL_VERIFICATION_REQUIRED", "Email verification required to access this resource.")
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}
