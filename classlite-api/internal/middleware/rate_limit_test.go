package middleware_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/ducdo/classlite-api/internal/middleware"
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
