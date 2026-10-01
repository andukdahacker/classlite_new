// Package polarwebhook is the roll-our-own Standard-Webhooks HMAC verifier for the Polar
// receiver (Story 9.2a, AC4/AC5/AC23/AC38 — R11 score-6 SEC, the WF-8 gate). It is stdlib-
// only (crypto/hmac + crypto/sha256, ~one function) and NEVER panics on malformed/missing
// headers — a panicking public verifier is a DoS (D27). A forged/replayed/stale event MUST
// be rejected here before the receiver ever reaches a plan/credit write.
//
// Standard Webhooks (https://www.standardwebhooks.com/): the signed payload is
// `{webhook-id}.{webhook-timestamp}.{raw-body}`; the signature header carries a
// space-separated list of `v1,<base64(HMAC-SHA256)>` tokens (one per active secret during a
// rotation). We verify against the current secret and, when set, the previous secret (a 24h
// zero-downtime rotation window, D2/AC5). The timestamp must be within ±maxSkew of now
// (replay window). All comparisons are constant-time (crypto/hmac.Equal).
package polarwebhook

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// maxSkewSeconds is the accept window in BOTH directions (AC38 pins the edges: 299s accepts,
// 301s rejects). |now - webhook-timestamp| must be <= this.
const maxSkewSeconds = 300

// Sentinel errors the handler maps to 401 WEBHOOK_SIGNATURE_INVALID / WEBHOOK_TIMESTAMP_STALE.
var (
	// ErrSignatureInvalid — missing/malformed headers or a signature that matches neither the
	// current nor the previous secret (→ 401 WEBHOOK_SIGNATURE_INVALID).
	ErrSignatureInvalid = errors.New("webhook signature invalid")
	// ErrTimestampStale — the webhook-timestamp is outside the ±maxSkew replay window, in
	// either direction (→ 401 WEBHOOK_TIMESTAMP_STALE).
	ErrTimestampStale = errors.New("webhook timestamp stale")
)

// Verify checks the Standard-Webhooks signature over body using secret (and prevSecret, when
// non-empty, for a rotation window). It returns nil on success, ErrTimestampStale for a
// replay-window violation, or ErrSignatureInvalid for any missing/malformed header or a
// non-matching signature. It NEVER panics (D27) — every header read is guarded.
func Verify(secret, prevSecret string, headers http.Header, body []byte, now time.Time) error {
	id := headers.Get("webhook-id")
	tsStr := headers.Get("webhook-timestamp")
	sigHeader := headers.Get("webhook-signature")
	if id == "" || tsStr == "" || sigHeader == "" {
		return ErrSignatureInvalid
	}

	// Timestamp first (Standard-Webhooks order): a stale-but-well-signed event is rejected as
	// stale, not laundered into a signature check. An unparseable timestamp is treated as a
	// replay-window violation (a typed error, never a panic).
	ts, err := strconv.ParseInt(strings.TrimSpace(tsStr), 10, 64)
	if err != nil {
		return ErrTimestampStale
	}
	delta := now.Unix() - ts
	if delta < 0 {
		delta = -delta
	}
	if delta > maxSkewSeconds {
		return ErrTimestampStale
	}

	// Signed payload: {id}.{ts}.{body}. Compute the expected MAC under each active secret and
	// constant-time compare against every v1 token in the header.
	message := id + "." + tsStr + "." + string(body)
	provided := parseV1Signatures(sigHeader)
	if len(provided) == 0 {
		return ErrSignatureInvalid
	}
	secrets := []string{secret}
	if prevSecret != "" {
		secrets = append(secrets, prevSecret)
	}
	for _, s := range secrets {
		if s == "" {
			continue
		}
		mac := hmac.New(sha256.New, webhookKey(s))
		_, _ = mac.Write([]byte(message))
		expected := mac.Sum(nil)
		for _, sig := range provided {
			if hmac.Equal(sig, expected) {
				return nil
			}
		}
	}
	return ErrSignatureInvalid
}

// webhookKey derives the HMAC key from a configured secret per Standard-Webhooks: secrets are
// distributed as `whsec_<base64>` and the key is the base64-decoded bytes, NOT the literal
// string. The optional `whsec_` prefix is stripped; if the remainder is valid standard base64
// the decoded bytes are used, otherwise the raw secret is used verbatim (tolerates a non-standard
// / already-raw secret in dev + the test fixtures, whose suffix is not valid base64). Keeping the
// raw fallback on the ORIGINAL (un-stripped) string preserves byte-identical behavior for any
// secret that is not a real `whsec_<base64>` key.
func webhookKey(secret string) []byte {
	if raw, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(secret, "whsec_")); err == nil && len(raw) > 0 {
		return raw
	}
	return []byte(secret)
}

// parseV1Signatures extracts the raw HMAC bytes from each `v1,<base64>` token in a
// space-separated Standard-Webhooks signature header. Malformed or non-v1 tokens are skipped
// (never a panic); an all-malformed header yields an empty slice → ErrSignatureInvalid.
func parseV1Signatures(header string) [][]byte {
	var out [][]byte
	for _, tok := range strings.Fields(header) {
		version, b64, ok := strings.Cut(tok, ",")
		if !ok || version != "v1" || b64 == "" {
			continue
		}
		raw, err := base64.StdEncoding.DecodeString(b64)
		if err != nil || len(raw) == 0 {
			continue
		}
		out = append(out, raw)
	}
	return out
}
