// Story 9-2a — AC38 (D27, R11 score-6 SEC — the WF-8 gate). Amelia's code-verified blocker:
// the whole mux is wrapped (main.go:981) RequestID → ClientIP → Logger → CORS → OriginCheck
// → global RateLimit → mux, and NewOriginCheck 403s every POST whose Origin isn't
// allow-listed. A Polar server-to-server POST carries NO Origin → 403 ORIGIN_NOT_ALLOWED
// BEFORE the signature verifier ever runs. The webhook route MUST bypass OriginCheck (and
// the shared RateLimit bucket), cap the request body before HMAC, and never 500/panic.
//
// GREEN-PHASE SEAMS (RED compile-fails on these):
//   · handler.NewPolarWebhookHandler(svc *service.BillingService, secret, prevSecret string,
//       clk clock.Clock) http.Handler  — verifies (polarwebhook.Verify) then dedups+dispatches;
//       returns 401 WEBHOOK_SIGNATURE_INVALID on bad sig regardless of Origin, and rejects an
//       oversized body (io.LimitReader) with a 4xx BEFORE computing HMAC.
//   · main.go must mount this handler OUTSIDE the OriginCheck + shared RateLimit wrappers
//       (skip-prefix /api/webhooks/ or a separate mux) — this test asserts the required shape.
//
// RED: compile-fails on handler.NewPolarWebhookHandler.

package test

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/handler"
	"github.com/ducdo/classlite-api/internal/middleware"
	"github.com/ducdo/classlite-api/internal/service"
)

var webhookAllowedOrigins = []string{"https://app.classlite.app"}

// TestWebhook_OriginWall_BaselineBlocksNoOrigin proves the wall is real: a POST with no
// Origin through the SAME OriginCheck main.go uses returns 403 ORIGIN_NOT_ALLOWED. If the
// webhook route were mounted behind it (the bug), Polar would be 403'd before the verifier.
func TestWebhook_OriginWall_BaselineBlocksNoOrigin(t *testing.T) {
	dummy := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) })
	guarded := middleware.NewOriginCheck(webhookAllowedOrigins)(dummy)

	req := httptest.NewRequest(http.MethodPost, "/api/anything", strings.NewReader(`{}`)) // no Origin header
	rec := httptest.NewRecorder()
	guarded.ServeHTTP(rec, req)

	if rec.Code != http.StatusForbidden || !strings.Contains(rec.Body.String(), "ORIGIN_NOT_ALLOWED") {
		t.Fatalf("baseline: no-Origin POST behind OriginCheck must be 403 ORIGIN_NOT_ALLOWED, got %d %s", rec.Code, rec.Body.String())
	}
}

// TestWebhook_BypassesOrigin_ReachesVerifier is the AC38 assertion: the webhook handler,
// mounted the way main.go SHOULD (OUTSIDE OriginCheck), receives a no-Origin S2S POST and
// returns 401 on a bad signature — NOT 403 ORIGIN_NOT_ALLOWED. i.e. the request reached the
// verifier.
func TestWebhook_BypassesOrigin_ReachesVerifier(t *testing.T) {
	pool := SetupRawPool(t)
	svc := service.NewBillingServiceWithClock(pool, clock.NewMockClock(billingEpoch))
	webhookHandler := handler.NewPolarWebhookHandler(svc, polarTestSecret, polarTestPrevSecret, clock.NewMockClock(billingEpoch))

	// A genuine Polar shape: no Origin, valid headers, but signed with the WRONG secret.
	body := []byte(`{"type":"order.paid"}`)
	req := newSignedWebhookRequest(t, polarWrongSecret, newWebhookEventID(), billingEpoch.Unix(), body)
	rec := httptest.NewRecorder()
	webhookHandler.ServeHTTP(rec, req)

	if rec.Code == http.StatusForbidden && strings.Contains(rec.Body.String(), "ORIGIN_NOT_ALLOWED") {
		t.Fatalf("webhook route must BYPASS OriginCheck — got 403 ORIGIN_NOT_ALLOWED (D27 blocker)")
	}
	if rec.Code != http.StatusUnauthorized || !strings.Contains(rec.Body.String(), "WEBHOOK_SIGNATURE_INVALID") {
		t.Fatalf("bad-signature S2S POST must reach the verifier → 401 WEBHOOK_SIGNATURE_INVALID, got %d %s", rec.Code, rec.Body.String())
	}
}

// TestWebhook_OversizedBody_RejectedPreHMAC proves the request body is io.LimitReader-capped
// BEFORE the HMAC compute (D27/Murat F8 — an HMAC-over-10MB flood is a CPU DoS). An
// over-cap body returns a 4xx and never 500/panics.
func TestWebhook_OversizedBody_RejectedPreHMAC(t *testing.T) {
	pool := SetupRawPool(t)
	svc := service.NewBillingServiceWithClock(pool, clock.NewMockClock(billingEpoch))
	webhookHandler := handler.NewPolarWebhookHandler(svc, polarTestSecret, polarTestPrevSecret, clock.NewMockClock(billingEpoch))

	huge := bytes.Repeat([]byte("A"), 11<<20) // 11 MiB — over any sane webhook cap
	req := newSignedWebhookRequest(t, polarTestSecret, newWebhookEventID(), billingEpoch.Unix(), huge)
	rec := httptest.NewRecorder()
	webhookHandler.ServeHTTP(rec, req)

	if rec.Code < 400 || rec.Code >= 500 {
		t.Fatalf("oversized body must be rejected pre-HMAC with a 4xx (never 2xx/5xx), got %d", rec.Code)
	}
}
