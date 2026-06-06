// Package middleware — Story 1.5 OriginCheck (AC12).
//
// Defense-in-depth alongside CORS: even when CORS preflight passes, the
// downstream handler should reject a state-mutating request whose Origin
// header does not match the allowlist. CORS is a browser-side defense;
// OriginCheck is a server-side defense against non-browser clients and
// cache poisoning.
package middleware

import (
	"encoding/json"
	"net/http"

	"github.com/ducdo/classlite-api/internal/model"
)

// NewOriginCheck returns middleware that rejects POST/PUT/DELETE/PATCH
// requests when the Origin header does not match the allowlist (same
// wildcard rules as CORS). GET/HEAD/OPTIONS pass through unconditionally.
func NewOriginCheck(allowedOrigins []string) func(http.Handler) http.Handler {
	compiled := compileCORS(CORSConfig{AllowedOrigins: allowedOrigins})
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			switch r.Method {
			case http.MethodGet, http.MethodHead, http.MethodOptions:
				next.ServeHTTP(w, r)
				return
			}
			origin := r.Header.Get("Origin")
			if compiled.match(origin) {
				next.ServeHTTP(w, r)
				return
			}
			writeOriginRejection(w, r)
		})
	}
}

func writeOriginRejection(w http.ResponseWriter, r *http.Request) {
	requestID, _ := r.Context().Value(model.RequestID).(string)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusForbidden)
	_ = json.NewEncoder(w).Encode(map[string]any{
		"error": map[string]any{
			"code":      "ORIGIN_NOT_ALLOWED",
			"message":   "Origin not permitted for state-changing requests.",
			"requestId": requestID,
			"details":   nil,
		},
	})
}
