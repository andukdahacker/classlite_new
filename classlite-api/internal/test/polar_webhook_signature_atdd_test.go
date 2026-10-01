// Story 9-2a — AC4/AC5/AC23/AC38 (D2/D27, R11 score-6 SEC — the WF-8 gate).
// Standard-Webhooks HMAC verification for POST /api/webhooks/polar. A forged/replayed/
// stale event must NEVER reach a plan/credit write. Roll-our-own, stdlib crypto/hmac.
//
// GREEN-PHASE SEAMS (RED compile-fails on these):
//   · internal/polarwebhook.Verify(secret, prevSecret string, headers http.Header,
//       body []byte, now time.Time) error
//   · sentinel/typed errors polarwebhook.ErrSignatureInvalid, polarwebhook.ErrTimestampStale
//       mapped by the handler to 401 WEBHOOK_SIGNATURE_INVALID / WEBHOOK_TIMESTAMP_STALE.
//   · Verify MUST NOT panic on malformed/missing headers (a panicking public verifier is a
//       DoS — D27); it returns a typed error the handler maps to 400/401.
//
// This is a pure unit red (no DB) — the verifier is a stdlib function. The routing/DoS
// behaviour (origin bypass, body-cap-before-HMAC) is in polar_webhook_origin_bypass_atdd_test.go.
//
// RED: compile-fails on the missing internal/polarwebhook package.

package test

import (
	"errors"
	"net/http"
	"strconv"
	"testing"
	"time"

	"github.com/ducdo/classlite-api/internal/polarwebhook"
)

// verifyHeaders builds the header set Verify reads, from a signed request's fields.
func verifyHeaders(id string, ts int64, sig string) http.Header {
	h := http.Header{}
	h.Set("webhook-id", id)
	h.Set("webhook-timestamp", strconv.FormatInt(ts, 10))
	h.Set("webhook-signature", sig)
	return h
}

func TestPolarWebhook_ValidCurrentSecret_Accepts(t *testing.T) {
	now := billingEpoch
	body := []byte(`{"type":"order.paid"}`)
	id, ts := newWebhookEventID(), now.Unix()
	sig := signPolarWebhook(polarTestSecret, id, ts, body)

	if err := polarwebhook.Verify(polarTestSecret, "", verifyHeaders(id, ts, sig), body, now); err != nil {
		t.Fatalf("valid current-secret signature must verify, got %v", err)
	}
}

func TestPolarWebhook_WrongSecret_Rejects(t *testing.T) {
	now := billingEpoch
	body := []byte(`{"type":"order.paid"}`)
	id, ts := newWebhookEventID(), now.Unix()
	sig := signPolarWebhook(polarWrongSecret, id, ts, body) // signed with a secret the server doesn't hold

	err := polarwebhook.Verify(polarTestSecret, polarTestPrevSecret, verifyHeaders(id, ts, sig), body, now)
	if !errors.Is(err, polarwebhook.ErrSignatureInvalid) {
		t.Fatalf("wrong-secret must be ErrSignatureInvalid (→401), got %v", err)
	}
}

func TestPolarWebhook_ValidPreviousSecret_AcceptsDuringRotation(t *testing.T) {
	now := billingEpoch
	body := []byte(`{"type":"subscription.updated"}`)
	id, ts := newWebhookEventID(), now.Unix()
	sig := signPolarWebhook(polarTestPrevSecret, id, ts, body) // signed under the PREVIOUS secret

	if err := polarwebhook.Verify(polarTestSecret, polarTestPrevSecret, verifyHeaders(id, ts, sig), body, now); err != nil {
		t.Fatalf("previous-secret signature must verify during the rotation window, got %v", err)
	}
}

func TestPolarWebhook_BodyTamperedAfterSign_Rejects(t *testing.T) {
	now := billingEpoch
	body := []byte(`{"type":"order.paid","amount":399000}`)
	id, ts := newWebhookEventID(), now.Unix()
	sig := signPolarWebhook(polarTestSecret, id, ts, body) // signature over the ORIGINAL body

	tampered := []byte(`{"type":"order.paid","amount":9999999}`) // attacker rewrites the amount
	err := polarwebhook.Verify(polarTestSecret, polarTestPrevSecret, verifyHeaders(id, ts, sig), tampered, now)
	if !errors.Is(err, polarwebhook.ErrSignatureInvalid) {
		t.Fatalf("body tampered after signing must be ErrSignatureInvalid (the core HMAC guarantee), got %v", err)
	}
}

func TestPolarWebhook_StaleTimestamp_Rejects(t *testing.T) {
	now := billingEpoch
	body := []byte(`{"type":"order.paid"}`)
	id := newWebhookEventID()
	staleTs := now.Add(-(webhookMaxSkewSeconds + 31) * time.Second).Unix() // 331s in the past
	sig := signPolarWebhook(polarTestSecret, id, staleTs, body)

	err := polarwebhook.Verify(polarTestSecret, "", verifyHeaders(id, staleTs, sig), body, now)
	if !errors.Is(err, polarwebhook.ErrTimestampStale) {
		t.Fatalf("timestamp 331s old must be ErrTimestampStale (→401), got %v", err)
	}
}

func TestPolarWebhook_FutureTimestamp_Rejects(t *testing.T) {
	now := billingEpoch
	body := []byte(`{"type":"order.paid"}`)
	id := newWebhookEventID()
	futureTs := now.Add((webhookMaxSkewSeconds + 31) * time.Second).Unix() // 331s in the FUTURE
	sig := signPolarWebhook(polarTestSecret, id, futureTs, body)

	err := polarwebhook.Verify(polarTestSecret, "", verifyHeaders(id, futureTs, sig), body, now)
	if !errors.Is(err, polarwebhook.ErrTimestampStale) {
		t.Fatalf("future-skewed timestamp must be ErrTimestampStale (both directions rejected), got %v", err)
	}
}

// TestPolarWebhook_SkewBoundaries pins the exact accept/reject edges (Murat F7a — an
// ambiguous boundary is an un-testable AC). 299s → accept; 301s → reject.
func TestPolarWebhook_SkewBoundaries(t *testing.T) {
	now := billingEpoch
	body := []byte(`{"type":"order.paid"}`)
	cases := []struct {
		name       string
		offsetSecs int64
		wantOK     bool
	}{
		{"299s-past-accepts", -299, true},
		{"301s-past-rejects", -301, false},
		{"299s-future-accepts", 299, true},
		{"301s-future-rejects", 301, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			id := newWebhookEventID()
			ts := now.Add(time.Duration(tc.offsetSecs) * time.Second).Unix()
			sig := signPolarWebhook(polarTestSecret, id, ts, body)
			err := polarwebhook.Verify(polarTestSecret, "", verifyHeaders(id, ts, sig), body, now)
			if tc.wantOK && err != nil {
				t.Fatalf("%s: want accept, got %v", tc.name, err)
			}
			if !tc.wantOK && !errors.Is(err, polarwebhook.ErrTimestampStale) {
				t.Fatalf("%s: want ErrTimestampStale, got %v", tc.name, err)
			}
		})
	}
}

// TestPolarWebhook_MalformedHeaders_NoPanic proves the ~50 LOC verifier degrades to a
// typed error (never a panic) on missing/garbage headers — a panicking public endpoint is
// a DoS (D27/Murat F7d). A panic here fails the test via the recover.
func TestPolarWebhook_MalformedHeaders_NoPanic(t *testing.T) {
	now := billingEpoch
	body := []byte(`{"type":"order.paid"}`)
	cases := map[string]http.Header{
		"no-headers-at-all":       {},
		"missing-signature":       verifyHeaders(newWebhookEventID(), now.Unix(), ""),
		"missing-timestamp":       {"webhook-id": {newWebhookEventID()}, "webhook-signature": {"v1,AAAA"}},
		"garbage-timestamp":       verifyHeaders(newWebhookEventID(), 0, "v1,AAAA"),
		"malformed-signature-fmt": verifyHeaders(newWebhookEventID(), now.Unix(), "not-a-valid-format"),
	}
	for name, h := range cases {
		t.Run(name, func(t *testing.T) {
			defer func() {
				if r := recover(); r != nil {
					t.Fatalf("Verify PANICKED on %s (public-endpoint DoS): %v", name, r)
				}
			}()
			if err := polarwebhook.Verify(polarTestSecret, polarTestPrevSecret, h, body, now); err == nil {
				t.Fatalf("%s must be rejected with a typed error, got nil", name)
			}
		})
	}
}
