package middleware

import (
	"encoding/json"
	"log/slog"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/ducdo/classlite-api/internal/model"
	"golang.org/x/time/rate"
)

type visitor struct {
	limiter  *rate.Limiter
	lastSeen time.Time
}

// RateLimit returns middleware that limits requests per IP using a token bucket.
// rate is requests per second; burst is the maximum burst size.
// Stale entries are cleaned up every minute.
func RateLimit(rps rate.Limit, burst int) func(http.Handler) http.Handler {
	var mu sync.Mutex
	visitors := make(map[string]*visitor)

	// Cleanup stale entries every minute.
	go func() {
		for {
			time.Sleep(1 * time.Minute)
			mu.Lock()
			for ip, v := range visitors {
				if time.Since(v.lastSeen) > 3*time.Minute {
					delete(visitors, ip)
				}
			}
			mu.Unlock()
		}
	}()

	getVisitor := func(ip string) *rate.Limiter {
		mu.Lock()
		defer mu.Unlock()
		v, exists := visitors[ip]
		if !exists {
			limiter := rate.NewLimiter(rps, burst)
			visitors[ip] = &visitor{limiter: limiter, lastSeen: time.Now()}
			return limiter
		}
		v.lastSeen = time.Now()
		return v.limiter
	}

	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ip := extractIP(r)
			limiter := getVisitor(ip)

			if !limiter.Allow() {
				requestID, _ := r.Context().Value(model.RequestID).(string)
				slog.Warn("rate limit exceeded", "ip", ip, "request_id", requestID)

				w.Header().Set("Content-Type", "application/json")
				w.Header().Set("Retry-After", "60")
				w.WriteHeader(http.StatusTooManyRequests)
				if err := json.NewEncoder(w).Encode(map[string]any{
					"error": map[string]any{
						"code":      "RATE_LIMIT_EXCEEDED",
						"message":   "Too many requests. Please try again later.",
						"requestId": requestID,
						"details":   nil,
					},
				}); err != nil {
					slog.Warn("rate limit response write failed", "error", err)
				}
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}

func extractIP(r *http.Request) string {
	// X-Forwarded-For behind Railway proxy — comma-separated list of IPs, no port.
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		// Take the first (leftmost) entry — the original client IP.
		first := strings.SplitN(xff, ",", 2)[0]
		return strings.TrimSpace(first)
	}
	// RemoteAddr is host:port.
	ip, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return ip
}
