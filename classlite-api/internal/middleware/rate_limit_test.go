package middleware_test

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"
	"time"

	"github.com/ducdo/classlite-api/internal/middleware"
	"github.com/ducdo/classlite-api/internal/model"
	"golang.org/x/time/rate"
)

func TestRateLimit_AllowsUnderLimit(t *testing.T) {
	handler := middleware.RateLimit(10, 10)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	req.RemoteAddr = "192.168.1.1:12345"
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", rec.Code)
	}
}

func TestRateLimit_BlocksOverLimit(t *testing.T) {
	// 1 request per second, burst of 1 — second request should be blocked.
	handler := middleware.RateLimit(1, 1)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	req.RemoteAddr = "10.0.0.1:12345"

	// First request — allowed.
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("first request should pass, got %d", rec.Code)
	}

	// Second request — should be rate limited.
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusTooManyRequests {
		t.Errorf("expected 429, got %d", rec.Code)
	}
	if rec.Header().Get("Retry-After") == "" {
		t.Error("expected Retry-After header")
	}

	// Verify error envelope structure.
	var body map[string]any
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatalf("failed to decode body: %v", err)
	}
	errObj, ok := body["error"].(map[string]any)
	if !ok {
		t.Fatal("expected error envelope")
	}
	if errObj["code"] != "RATE_LIMIT_EXCEEDED" {
		t.Errorf("expected code RATE_LIMIT_EXCEEDED, got %s", errObj["code"])
	}
}

func TestRateLimit_SeparateIPsSeparateLimits(t *testing.T) {
	handler := middleware.RateLimit(1, 1)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	// Exhaust IP 1.
	req1 := httptest.NewRequest(http.MethodGet, "/", nil)
	req1.RemoteAddr = "10.0.0.1:1111"
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req1)

	// IP 2 should still work.
	req2 := httptest.NewRequest(http.MethodGet, "/", nil)
	req2.RemoteAddr = "10.0.0.2:2222"
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req2)
	if rec.Code != http.StatusOK {
		t.Errorf("different IP should not be rate limited, got %d", rec.Code)
	}
}

func TestRateLimit_XForwardedFor(t *testing.T) {
	handler := middleware.RateLimit(rate.Limit(1), 1)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("X-Forwarded-For", "203.0.113.50")
	req.RemoteAddr = "127.0.0.1:9999"

	// First request — allowed.
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("first request should pass, got %d", rec.Code)
	}

	// Second request same XFF — should be rate limited.
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusTooManyRequests {
		t.Errorf("expected 429 for same XFF IP, got %d", rec.Code)
	}
}

// ---------- Story 1.4 Task 15: RateLimitByKey + extractIP refactor (closes 1.3b W1) ----------

func TestRateLimit_PrefersClientIPContextValue(t *testing.T) {
	// Closes deferred-work W1 from story 1.3b: the limiter must read
	// model.IPAddress from context (set by ClientIP middleware) rather than
	// re-extracting from X-Forwarded-For / RemoteAddr.
	handler := middleware.RateLimit(rate.Limit(1), 1)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	makeReq := func(ctxIP string) *http.Request {
		req := httptest.NewRequest(http.MethodGet, "/", nil)
		req.Header.Set("X-Forwarded-For", "shared.proxy.ip")
		req.RemoteAddr = "10.0.0.1:1111"
		ctx := context.WithValue(req.Context(), model.IPAddress, ctxIP)
		return req.WithContext(ctx)
	}

	// Two requests from different ctx IPs but identical XFF should be bucketed separately.
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, makeReq("203.0.113.1"))
	if rec.Code != http.StatusOK {
		t.Fatalf("ctx-IP-A first should pass, got %d", rec.Code)
	}
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, makeReq("203.0.113.2"))
	if rec.Code != http.StatusOK {
		t.Errorf("ctx-IP-B should NOT share bucket with ctx-IP-A, got %d", rec.Code)
	}

	// But ctx-IP-A repeated must hit the per-IP bucket.
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, makeReq("203.0.113.1"))
	if rec.Code != http.StatusTooManyRequests {
		t.Errorf("ctx-IP-A repeat should be limited, got %d", rec.Code)
	}
}

func TestRateLimitByKey_PerKeyBucketing(t *testing.T) {
	// Same name + different keys = independent buckets.
	// Same name + same key = shared bucket.
	keys := []string{"alpha"}
	keyFn := func(r *http.Request) string { return keys[0] }
	handler := middleware.RateLimitByKey("test", rate.Limit(1), 1, keyFn)(
		http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusOK) }),
	)

	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("first request: %d", rec.Code)
	}
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil))
	if rec.Code != http.StatusTooManyRequests {
		t.Errorf("expected 429 for same key, got %d", rec.Code)
	}

	// Switch keyFn to return a different key — fresh bucket.
	keys[0] = "beta"
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil))
	if rec.Code != http.StatusOK {
		t.Errorf("different key should be unlimited, got %d", rec.Code)
	}
}

func TestRateLimitByKey_EmptyKeyPassesThrough(t *testing.T) {
	// H3: malformed-body sentinel — keyFn returns "" → middleware passes through.
	keyFn := func(r *http.Request) string { return "" }
	handler := middleware.RateLimitByKey("h3", rate.Limit(0.01), 1, keyFn)(
		http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusOK) }),
	)

	for i := 0; i < 10; i++ {
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil))
		if rec.Code != http.StatusOK {
			t.Fatalf("request %d should pass through (empty key), got %d", i, rec.Code)
		}
	}
}

func TestRateLimitByKey_RetryAfterComputedFromReservation(t *testing.T) {
	// rate.Every(10s), burst 1 → after the first request, retry-after ≈ 10.
	keyFn := func(r *http.Request) string { return "k" }
	handler := middleware.RateLimitByKey("ra", rate.Every(10*time.Second), 1, keyFn)(
		http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusOK) }),
	)

	// Consume the burst.
	handler.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/", nil))

	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil))
	if rec.Code != http.StatusTooManyRequests {
		t.Fatalf("expected 429, got %d", rec.Code)
	}
	got := rec.Header().Get("Retry-After")
	if got == "" {
		t.Fatal("missing Retry-After header")
	}
	n, err := strconv.Atoi(got)
	if err != nil {
		t.Fatalf("Retry-After not integer: %q (%v)", got, err)
	}
	if n < 8 || n > 11 {
		t.Errorf("Retry-After = %d, expected ≈10s", n)
	}
}

// TestRateLimitByKey_WithIPKeyFn_PrefersClientIPContextValue asserts that
// RateLimitByKey + the exported IPKeyFn share the same context-IP preference
// as the global RateLimit middleware, closing the coverage gap noted in the
// code review for story 1.4 (the per-route limiter is what main.go actually
// uses for auth-register / auth-resend-ip).
func TestRateLimitByKey_WithIPKeyFn_PrefersClientIPContextValue(t *testing.T) {
	handler := middleware.RateLimitByKey("ip-key-test", rate.Limit(1), 1, middleware.IPKeyFn)(
		http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusOK) }),
	)

	makeReq := func(ctxIP string) *http.Request {
		req := httptest.NewRequest(http.MethodGet, "/", nil)
		req.Header.Set("X-Forwarded-For", "shared.proxy.ip")
		req.RemoteAddr = "10.0.0.1:1111"
		ctx := context.WithValue(req.Context(), model.IPAddress, ctxIP)
		return req.WithContext(ctx)
	}

	// Two different ctx IPs but identical XFF → independent buckets.
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, makeReq("203.0.113.10"))
	if rec.Code != http.StatusOK {
		t.Fatalf("ctx-IP-A first should pass, got %d", rec.Code)
	}
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, makeReq("203.0.113.11"))
	if rec.Code != http.StatusOK {
		t.Errorf("ctx-IP-B should NOT share bucket with ctx-IP-A, got %d", rec.Code)
	}

	// Same ctx IP repeated → bucket exhausted → 429.
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, makeReq("203.0.113.10"))
	if rec.Code != http.StatusTooManyRequests {
		t.Errorf("ctx-IP-A repeat should be limited, got %d", rec.Code)
	}
}

// TestRateLimitByKey_BodyReadingKeyFn_DownstreamHandlerCanDecode verifies the
// GFW-6 contract for the per-email limiter: a keyFn that consumes the body
// MUST restore it so the downstream handler can decode.
func TestRateLimitByKey_BodyReadingKeyFn_DownstreamHandlerCanDecode(t *testing.T) {
	// Mirrors the actual main.go pattern: the keyFn reads + restores the body.
	keyFn := func(r *http.Request) string {
		body, err := io.ReadAll(r.Body)
		if err != nil {
			return ""
		}
		// MUST restore.
		r.Body = io.NopCloser(bytes.NewBuffer(body))
		var decoded struct{ Email string }
		if err := json.Unmarshal(body, &decoded); err != nil {
			return ""
		}
		return decoded.Email
	}

	decoded := struct{ Email string }{}
	handler := middleware.RateLimitByKey("email", rate.Every(time.Hour), 1, keyFn)(
		http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if err := json.NewDecoder(r.Body).Decode(&decoded); err != nil {
				http.Error(w, "decode failed: "+err.Error(), http.StatusInternalServerError)
				return
			}
			w.WriteHeader(http.StatusOK)
		}),
	)

	req := httptest.NewRequest(http.MethodPost, "/api/auth/resend-verification",
		bytes.NewBufferString(`{"email":"x@y.com"}`))
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("downstream handler should succeed, got %d: %s", rec.Code, rec.Body.String())
	}
	if decoded.Email != "x@y.com" {
		t.Errorf("downstream decode failed: got %q", decoded.Email)
	}
}
