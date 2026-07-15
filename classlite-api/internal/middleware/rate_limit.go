package middleware

import (
	"encoding/json"
	"log/slog"
	"math"
	"net"
	"net/http"
	"strconv"
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

// RateLimit returns the existing global token-bucket middleware (one bucket per IP).
// Behavior preserved from story 1.2a: IP key, hard-coded Retry-After: 60.
func RateLimit(rps rate.Limit, burst int) func(http.Handler) http.Handler {
	return rateLimitByKeyInternal("global", rps, burst, IPKeyFn, false)
}

// RateLimitByKey returns a token-bucket middleware keyed by an arbitrary
// per-request function. Story 1.4 task 8.
//
// Empty key sentinel: if keyFn returns "" the request is passed through
// WITHOUT consuming a token. This is the spec'd behavior for the per-email
// limiter when the body is malformed (Task 8 / H3) — incoherent bodies have
// no key to bucket by.
//
// name appears in slog log fields ("limiter": name) for correlation. The
// Retry-After header is computed from limiter.Reserve().Delay() rounded UP
// to seconds, not the hard-coded "60" of the global limiter.
func RateLimitByKey(name string, rps rate.Limit, burst int, keyFn func(*http.Request) string) func(http.Handler) http.Handler {
	return rateLimitByKeyInternal(name, rps, burst, keyFn, true)
}

func rateLimitByKeyInternal(name string, rps rate.Limit, burst int, keyFn func(*http.Request) string, computedRetryAfter bool) func(http.Handler) http.Handler {
	var mu sync.Mutex
	visitors := make(map[string]*visitor)

	go func() {
		for {
			time.Sleep(1 * time.Minute)
			mu.Lock()
			for k, v := range visitors {
				if time.Since(v.lastSeen) > 3*time.Minute {
					delete(visitors, k)
				}
			}
			mu.Unlock()
		}
	}()

	getLimiter := func(key string) *rate.Limiter {
		mu.Lock()
		defer mu.Unlock()
		v, exists := visitors[key]
		if !exists {
			l := rate.NewLimiter(rps, burst)
			visitors[key] = &visitor{limiter: l, lastSeen: time.Now()}
			return l
		}
		v.lastSeen = time.Now()
		return v.limiter
	}

	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			key := keyFn(r)
			if key == "" {
				// Spec'd skip-the-limiter path (Task 8 / H3 — keyFn signalled
				// "no key" because the body couldn't be parsed). The global IP
				// limiter still applies to this request, but operators need
				// visibility into how often per-key buckets are bypassed.
				requestID, _ := r.Context().Value(model.RequestID).(string)
				slog.Debug("rate_limit_skipped_empty_key",
					"limiter", name,
					"request_id", requestID,
				)
				next.ServeHTTP(w, r)
				return
			}
			limiter := getLimiter(key)

			reservation := limiter.Reserve()
			if !reservation.OK() {
				// limiter never allows this rate — should not happen with non-zero rps.
				reservation.Cancel()
			}
			delay := reservation.Delay()
			if delay > 0 {
				reservation.Cancel()
				requestID, _ := r.Context().Value(model.RequestID).(string)
				retryAfter := "60"
				if computedRetryAfter {
					retryAfter = strconv.Itoa(int(math.Ceil(delay.Seconds())))
					if retryAfter == "0" {
						retryAfter = "1"
					}
				}
				slog.Warn("rate_limit_exceeded",
					"limiter", name,
					"key", key,
					"retry_after", retryAfter,
					"request_id", requestID,
				)

				w.Header().Set("Content-Type", "application/json")
				w.Header().Set("Retry-After", retryAfter)
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

// IPKeyFn is the default IP-based key function for RateLimitByKey. Closes
// deferred-work W1 from story 1.3b by preferring the ClientIP middleware's
// context value over re-reading X-Forwarded-For. Falls back to the legacy
// logic when the context value is absent (so this middleware still works in
// isolation). Exported so cmd/api/main.go can share the same key function
// across global and per-route limiters without duplicating the logic.
func IPKeyFn(r *http.Request) string {
	if ip, ok := r.Context().Value(model.IPAddress).(string); ok && ip != "" {
		return ip
	}
	return extractIPFromRequest(r)
}

// CenterAndIPKeyFn keys by `centerID:ip` for authenticated + center-scoped
// endpoints (Story 2.2 spawn). C1-10 review fix — pure IP keying is trivially
// bypassed via a botnet and hurts users on shared NAT; center-scoped costs
// (Resend spend, DB writes) should be capped per tenant, not per network.
// Falls back to pure IP when no TenantContext (e.g., pre-auth path).
func CenterAndIPKeyFn(r *http.Request) string {
	ip := IPKeyFn(r)
	if tc, ok := model.TenantFromContext(r.Context()); ok && tc.CenterID != "" {
		return tc.CenterID + ":" + ip
	}
	return ip
}

// UserAndIPKeyFn keys by `userID:ip` for authenticated user-scoped endpoints
// (Story 2-5a settings). Per-user because tab-switching bursts are personal,
// not per-tenant, and shared-NAT users shouldn't compete on the same bucket.
// Falls back to pure IP when no TenantContext (already rejected upstream).
func UserAndIPKeyFn(r *http.Request) string {
	ip := IPKeyFn(r)
	if tc, ok := model.TenantFromContext(r.Context()); ok && tc.UserID != "" {
		return tc.UserID + ":" + ip
	}
	return ip
}

// extractIPFromRequest is the legacy fallback used when ClientIP middleware
// did not run (e.g., standalone middleware tests).
func extractIPFromRequest(r *http.Request) string {
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		first := strings.SplitN(xff, ",", 2)[0]
		return strings.TrimSpace(first)
	}
	ip, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return ip
}
