package middleware

import (
	"context"
	"net"
	"net/http"
	"strings"

	"github.com/ducdo/classlite-api/internal/model"
)

// ClientIP extracts the originating client IP and injects it into the request
// context under model.IPAddress. It walks X-Forwarded-For left-to-right looking
// for the first syntactically valid IP, falling back to r.RemoteAddr.
//
// Trust of X-Forwarded-For itself depends on the deployment being behind a
// known proxy (Railway / Cloudflare). All extracted values are validated with
// net.ParseIP, so garbage / log-injection payloads land as "" instead of in
// the audit table.
func ClientIP(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ip := extractClientIP(r)
		ctx := context.WithValue(r.Context(), model.IPAddress, ip)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func extractClientIP(r *http.Request) string {
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		for _, entry := range strings.Split(xff, ",") {
			if ip := normalizeIP(strings.TrimSpace(entry)); ip != "" {
				return ip
			}
		}
	}
	if host, _, err := net.SplitHostPort(r.RemoteAddr); err == nil {
		if ip := normalizeIP(host); ip != "" {
			return ip
		}
	}
	return normalizeIP(r.RemoteAddr)
}

// normalizeIP strips a trailing :port (with or without IPv6 brackets), strips
// stray brackets that may remain on a bare bracketed IPv6 literal, then
// validates the remainder with net.ParseIP. Returns "" on validation failure.
func normalizeIP(s string) string {
	if s == "" {
		return ""
	}
	if host, _, err := net.SplitHostPort(s); err == nil {
		s = host
	}
	s = strings.TrimPrefix(s, "[")
	s = strings.TrimSuffix(s, "]")
	if ip := net.ParseIP(s); ip != nil {
		return ip.String()
	}
	return ""
}
