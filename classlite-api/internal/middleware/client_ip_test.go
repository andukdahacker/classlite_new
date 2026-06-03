package middleware_test

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/ducdo/classlite-api/internal/middleware"
	"github.com/ducdo/classlite-api/internal/model"
)

func runClientIP(t *testing.T, modify func(*http.Request)) string {
	t.Helper()
	var captured string
	handler := middleware.ClientIP(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		captured, _ = r.Context().Value(model.IPAddress).(string)
	}))

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	modify(req)
	handler.ServeHTTP(httptest.NewRecorder(), req)
	return captured
}

func TestClientIP_PrefersXForwardedFor(t *testing.T) {
	got := runClientIP(t, func(r *http.Request) {
		r.Header.Set("X-Forwarded-For", "203.0.113.7, 10.0.0.1")
		r.RemoteAddr = "10.0.0.1:54321"
	})
	if got != "203.0.113.7" {
		t.Errorf("expected first XFF hop, got %q", got)
	}
}

func TestClientIP_TrimsXForwardedForWhitespace(t *testing.T) {
	got := runClientIP(t, func(r *http.Request) {
		r.Header.Set("X-Forwarded-For", "   198.51.100.4   ")
	})
	if got != "198.51.100.4" {
		t.Errorf("expected trimmed IP, got %q", got)
	}
}

func TestClientIP_LeadingCommaXFFSkipsEmptyEntry(t *testing.T) {
	got := runClientIP(t, func(r *http.Request) {
		r.Header.Set("X-Forwarded-For", ", 203.0.113.7")
		r.RemoteAddr = "10.0.0.1:54321"
	})
	if got != "203.0.113.7" {
		t.Errorf("expected real client IP after leading comma, got %q", got)
	}
}

func TestClientIP_InvalidXFFFallsBack(t *testing.T) {
	got := runClientIP(t, func(r *http.Request) {
		r.Header.Set("X-Forwarded-For", "'; DROP TABLE--")
		r.RemoteAddr = "192.0.2.10:1234"
	})
	if got != "192.0.2.10" {
		t.Errorf("expected RemoteAddr fallback for garbage XFF, got %q", got)
	}
}

func TestClientIP_AllInvalidReturnsEmpty(t *testing.T) {
	got := runClientIP(t, func(r *http.Request) {
		r.Header.Set("X-Forwarded-For", "<script>alert(1)</script>")
		r.RemoteAddr = "not-an-ip"
	})
	if got != "" {
		t.Errorf("expected empty string when no valid IP available, got %q", got)
	}
}

func TestClientIP_IPv6BracketedHostPort(t *testing.T) {
	got := runClientIP(t, func(r *http.Request) {
		r.Header.Set("X-Forwarded-For", "[2001:db8::1]:443, 10.0.0.1")
	})
	if got != "2001:db8::1" {
		t.Errorf("expected bare IPv6, got %q", got)
	}
}

func TestClientIP_IPv6BareInRemoteAddr(t *testing.T) {
	got := runClientIP(t, func(r *http.Request) {
		r.RemoteAddr = "[::1]:8080"
	})
	if got != "::1" {
		t.Errorf("expected ::1 from bracketed RemoteAddr, got %q", got)
	}
}

func TestClientIP_FallsBackToRemoteAddr(t *testing.T) {
	got := runClientIP(t, func(r *http.Request) {
		r.RemoteAddr = "192.0.2.55:443"
	})
	if got != "192.0.2.55" {
		t.Errorf("expected host portion of RemoteAddr, got %q", got)
	}
}

func TestClientIP_RemoteAddrWithoutPort(t *testing.T) {
	got := runClientIP(t, func(r *http.Request) {
		r.RemoteAddr = "192.0.2.99"
	})
	if got != "192.0.2.99" {
		t.Errorf("expected raw RemoteAddr fallback, got %q", got)
	}
}

func TestClientIP_EmptyXForwardedForFallsBack(t *testing.T) {
	got := runClientIP(t, func(r *http.Request) {
		r.Header.Set("X-Forwarded-For", "")
		r.RemoteAddr = "192.0.2.10:1234"
	})
	if got != "192.0.2.10" {
		t.Errorf("expected RemoteAddr fallback when XFF empty, got %q", got)
	}
}
