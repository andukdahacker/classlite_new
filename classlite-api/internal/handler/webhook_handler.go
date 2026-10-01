// Package handler — Story 9.2a Polar webhook receiver (AC7/AC23/AC38, D2/D27 — R11 score-6
// SEC, the WF-8 gate). POST /api/webhooks/polar is PUBLIC: it authenticates by Standard-
// Webhooks SIGNATURE, not JWT/RLS, so it is mounted OUTSIDE the JWT/tenant chain AND outside
// the shared originMW + global RateLimit (main.go — a Polar server-to-server POST carries no
// Origin, which originMW would 403 before the verifier ever ran, D27).
//
// The receiver: caps the request body via io.LimitReader BEFORE computing the HMAC (an
// HMAC-over-10MB flood is a CPU DoS, D27); verifies the signature (dual-secret rotation);
// then hands the raw body to BillingService.ProcessPolarEvent (the one-tx dedup + dispatch).
// A forged/replayed/stale event never reaches a plan/credit write (R11). Malformed headers →
// 400/401, never a 500/panic.
package handler

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/polarwebhook"
	"github.com/ducdo/classlite-api/internal/service"
)

// maxWebhookBodyBytes caps the request body read BEFORE the HMAC compute (D27). Polar event
// payloads are small JSON; anything larger is rejected 413 pre-HMAC (no CPU spent hashing it).
const maxWebhookBodyBytes = 1 << 20 // 1 MiB

// PolarWebhookHandler is the signature-verified Polar receiver.
type PolarWebhookHandler struct {
	svc        *service.BillingService
	secret     string
	prevSecret string
	clk        clock.Clock
}

// NewPolarWebhookHandler builds the receiver. secret/prevSecret are POLAR_WEBHOOK_SECRET (+
// its rotation predecessor); clk drives the replay-window check deterministically in tests.
func NewPolarWebhookHandler(svc *service.BillingService, secret, prevSecret string, clk clock.Clock) http.Handler {
	if clk == nil {
		clk = clock.RealClock{}
	}
	return &PolarWebhookHandler{svc: svc, secret: secret, prevSecret: prevSecret, clk: clk}
}

func (h *PolarWebhookHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// Body cap BEFORE HMAC (D27). Read cap+1 so an over-cap body is detected without hashing it.
	limited := io.LimitReader(r.Body, maxWebhookBodyBytes+1)
	body, err := io.ReadAll(limited)
	if err != nil {
		WriteError(w, r, http.StatusBadRequest, "WEBHOOK_BODY_INVALID", "Could not read the webhook body.", nil)
		return
	}
	if len(body) > maxWebhookBodyBytes {
		WriteError(w, r, http.StatusRequestEntityTooLarge, "WEBHOOK_BODY_TOO_LARGE", "Webhook body exceeds the size limit.", nil)
		return
	}

	// Signature verification (never panics on malformed headers — D27).
	if err := polarwebhook.Verify(h.secret, h.prevSecret, r.Header, body, h.clk.Now()); err != nil {
		switch {
		case errors.Is(err, polarwebhook.ErrTimestampStale):
			WriteError(w, r, http.StatusUnauthorized, "WEBHOOK_TIMESTAMP_STALE", "Webhook timestamp outside the accepted window.", nil)
		default:
			WriteError(w, r, http.StatusUnauthorized, "WEBHOOK_SIGNATURE_INVALID", "Webhook signature verification failed.", nil)
		}
		return
	}

	// Verified. eventID is the Standard-Webhooks webhook-id; eventType is the event envelope's
	// `type`. Both feed the dedup + dispatch (D19/D23).
	eventID := r.Header.Get("webhook-id")
	var envelope struct {
		Type string `json:"type"`
	}
	_ = json.Unmarshal(body, &envelope) // a verified body that won't parse is handled inside ProcessPolarEvent

	if err := h.svc.ProcessPolarEvent(r.Context(), eventID, envelope.Type, body); err != nil {
		// A processing error → 500 so Polar retries (the dedup makes the retry safe).
		WriteError(w, r, http.StatusInternalServerError, "WEBHOOK_PROCESSING_FAILED", "Failed to process the webhook event.", nil)
		return
	}
	WriteEnvelope(w, http.StatusOK, h.clk, map[string]any{"received": true})
}
