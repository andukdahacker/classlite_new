package middleware

import (
	"log/slog"
	"net/http"
	"regexp"
	"strings"
)

// CORSConfig drives the new wildcard-aware CORS middleware (Story 1.5
// task 12). AllowedOrigins entries may be either exact strings
// ("https://classlite.app") or single-label wildcards on .classlite.app
// ("https://*.classlite.app" matches "https://tenant.classlite.app"). The
// literal "*" entry is treated as a misconfiguration when
// AllowCredentials=true (SEC-5) — the wildcard is stripped from the
// active allowlist at construction time and slog.Error is emitted.
type CORSConfig struct {
	AllowedOrigins   []string
	AllowCredentials bool
}

// compiledCORS holds the precompiled form of CORSConfig: O(1) exact lookup
// + a small slice of regexps for wildcard patterns.
type compiledCORS struct {
	exact     map[string]struct{}
	wildcards []*regexp.Regexp
	allowCred bool
}

var (
	// wildcardSubdomainPattern matches "https://*.classlite.app" entries.
	// EDGE-3: only single-label subdomains; tenant slugs cannot contain dots.
	wildcardSubdomainPattern = regexp.MustCompile(`^(https?)://\*\.([A-Za-z0-9.-]+)$`)
)

func compileCORS(cfg CORSConfig) *compiledCORS {
	exact := make(map[string]struct{}, len(cfg.AllowedOrigins))
	wildcards := make([]*regexp.Regexp, 0)
	for _, entry := range cfg.AllowedOrigins {
		trimmed := strings.TrimSpace(entry)
		if trimmed == "" {
			continue
		}
		if trimmed == "*" {
			if cfg.AllowCredentials {
				slog.Error("CORS_MISCONFIGURATION_WILDCARD_WITH_CREDENTIALS",
					"hint", "removed '*' from active allowlist; credentialed responses cannot legally use a wildcard origin")
				continue
			}
			// Wildcard without credentials is permissible (rare) but
			// outside Story 1.5's scope — drop it for safety.
			continue
		}
		if m := wildcardSubdomainPattern.FindStringSubmatch(trimmed); m != nil {
			// Escape the literal dots in the suffix.
			suffix := strings.ReplaceAll(m[2], ".", `\.`)
			// Tighten the label rule: RFC 952/1123 hostnames must start
			// and end with alphanumeric and may contain hyphens in the
			// middle (max 63 chars). Previously `[a-zA-Z0-9-]+` allowed
			// leading/trailing hyphens (`-evil.classlite.app`), giving
			// an attacker who could register such a name CORS clearance.
			pat := "^" + m[1] + `://[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.` + suffix + "$"
			re, err := regexp.Compile(pat)
			if err != nil {
				slog.Error("CORS_WILDCARD_COMPILE_FAILED", "pattern", trimmed, "error", err)
				continue
			}
			wildcards = append(wildcards, re)
			continue
		}
		exact[trimmed] = struct{}{}
	}
	return &compiledCORS{exact: exact, wildcards: wildcards, allowCred: cfg.AllowCredentials}
}

func (c *compiledCORS) match(origin string) bool {
	if _, ok := c.exact[origin]; ok {
		return true
	}
	for _, re := range c.wildcards {
		if re.MatchString(origin) {
			return true
		}
	}
	return false
}

// NewCORS returns Story 1.5's wildcard-aware CORS middleware. Always emits
// Vary: Origin (SEC-5 — Cloudflare caches wrong origin otherwise). On a
// matched origin, reflects the origin verbatim (NEVER "*") and emits
// Access-Control-Allow-Credentials when configured. Preflight OPTIONS
// requests are answered with 204 + the standard headers.
func NewCORS(cfg CORSConfig) func(http.Handler) http.Handler {
	compiled := compileCORS(cfg)
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			// Why Add (not Set): compression / session middleware may set
			// Vary: Accept-Encoding / Vary: Cookie. Overwriting that with
			// Vary: Origin alone makes Cloudflare cache encoding-mismatched
			// responses. Add appends per RFC 7231 §7.1.4.
			w.Header().Add("Vary", "Origin")
			origin := r.Header.Get("Origin")
			if origin == "" || !compiled.match(origin) {
				next.ServeHTTP(w, r)
				return
			}
			w.Header().Set("Access-Control-Allow-Origin", origin)
			if compiled.allowCred {
				w.Header().Set("Access-Control-Allow-Credentials", "true")
			}
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

// CORS is the Story 1.4 string-config wrapper, kept for backward compat.
// New callers should use NewCORS(CORSConfig{...}).
func CORS(allowedOrigins string) func(http.Handler) http.Handler {
	cfg := CORSConfig{AllowedOrigins: parseOriginsList(allowedOrigins), AllowCredentials: true}
	return NewCORS(cfg)
}

// ParseOrigins splits a comma-separated env var into a slice. Empty
// entries are dropped. Exported so cmd/api/main.go can construct a
// CORSConfig from the existing CORS_ORIGINS env var without duplicating
// the parser.
func ParseOrigins(raw string) []string {
	return parseOriginsList(raw)
}

func parseOriginsList(raw string) []string {
	if raw == "" {
		return nil
	}
	parts := strings.Split(raw, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if v := strings.TrimSpace(p); v != "" {
			out = append(out, v)
		}
	}
	return out
}

