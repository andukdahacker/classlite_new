package middleware

import (
	"net/http"
	"strings"
)

// CORS returns middleware that handles Cross-Origin Resource Sharing.
// Origins are checked against the allowlist. Preflight OPTIONS requests
// receive a 204 response. Credentials are always allowed for matched origins.
// Wildcard origin is never used with credentials (SEC-5).
func CORS(allowedOrigins string) func(http.Handler) http.Handler {
	allowed := parseOrigins(allowedOrigins)

	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			origin := r.Header.Get("Origin")

			// Always set Vary: Origin so Cloudflare doesn't cache wrong origin.
			w.Header().Set("Vary", "Origin")

			if origin == "" || !allowed[origin] {
				next.ServeHTTP(w, r)
				return
			}

			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Access-Control-Allow-Credentials", "true")

			if r.Method == http.MethodOptions {
				w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
				w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Request-ID")
				w.Header().Set("Access-Control-Max-Age", "86400")
				w.WriteHeader(http.StatusNoContent)
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}

func parseOrigins(raw string) map[string]bool {
	origins := make(map[string]bool)
	for _, o := range strings.Split(raw, ",") {
		trimmed := strings.TrimSpace(o)
		if trimmed != "" {
			origins[trimmed] = true
		}
	}
	return origins
}
