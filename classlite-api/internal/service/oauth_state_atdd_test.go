//go:build atdd_red_phase

// oauth_state_atdd_test.go — Story 1.6 ATDD red-phase scaffolds.
//
// HOW TO USE THIS FILE
//
// Each test demonstrates an acceptance criterion that does NOT yet have
// implementation. The build tag at the top keeps these tests out of the
// normal `go test ./...` run so the suite stays green during ATDD red
// phase.
//
// To activate a test:
//   1. Remove the //go:build atdd_red_phase line.
//   2. Run `go test ./internal/service -run TestOAuthState` and observe
//      the compile failure — that tells you which type or function to
//      implement next (likely service.NewOAuthStateSigner +
//      service.OAuthStatePayload).
//   3. Implement the smallest thing that makes the test green. Repeat
//      until every test in this file is green, then move on.
//
// ACCEPTANCE CRITERIA COVERED
//   AC-1.6-01  Initiate Google OAuth signs a state payload (sign happy path)
//   AC-1.6-02  Callback rejects tampered / forged state (verify failure)
//   AC-1.6-02  Callback rejects state from a wrong secret (cross-secret attack)
//   AC-1.6-09  State TTL enforced (10 min) — expired state rejected
//   AC-1.6-09  State payload roundtrip preserves inviteTokenHash + redirectTo

package service_test

import (
	"errors"
	"testing"
	"time"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/service"
)

// testStateSecret is a deterministic 32-byte secret for OAuth state HMAC
// signing in tests. NEVER use this in production.
const testStateSecret = "test-oauth-state-secret-32-bytes!"

// TestOAuthStateSigner_SignVerify_HappyPath proves the foundation of
// AC1+AC2: a payload signed by the server can be verified by the same
// server with all fields preserved.
func TestOAuthStateSigner_SignVerify_HappyPath(t *testing.T) {
	mockClock := clock.NewMockClock(time.Date(2026, 7, 1, 12, 0, 0, 0, time.UTC))
	signer := service.NewOAuthStateSignerWithClock([]byte(testStateSecret), mockClock)

	payload := service.OAuthStatePayload{
		Nonce:           "nonce-32-bytes-of-cryptographic-randomness-1234",
		InviteTokenHash: "abc123deadbeef",
		RedirectTo:      "https://my.classlite.app/dashboard",
		IssuedAt:        mockClock.Now().Unix(),
	}

	token, err := signer.Sign(payload)
	if err != nil {
		t.Fatalf("Sign: %v", err)
	}
	if token == "" {
		t.Fatal("Sign: expected non-empty token")
	}

	verified, err := signer.Verify(token)
	if err != nil {
		t.Fatalf("Verify: %v", err)
	}
	if verified.Nonce != payload.Nonce {
		t.Errorf("Nonce: want %q, got %q", payload.Nonce, verified.Nonce)
	}
	if verified.InviteTokenHash != payload.InviteTokenHash {
		t.Errorf("InviteTokenHash: want %q, got %q", payload.InviteTokenHash, verified.InviteTokenHash)
	}
	if verified.RedirectTo != payload.RedirectTo {
		t.Errorf("RedirectTo: want %q, got %q", payload.RedirectTo, verified.RedirectTo)
	}
	if verified.IssuedAt != payload.IssuedAt {
		t.Errorf("IssuedAt: want %d, got %d", payload.IssuedAt, verified.IssuedAt)
	}
}

// TestOAuthStateSigner_TamperedPayload_Rejected proves AC2 step 2: a
// payload that has been modified after signing must fail verification.
// This is the HMAC defense against an XSS-style attacker who reads the
// cookie value but can't re-sign it without the secret.
func TestOAuthStateSigner_TamperedPayload_Rejected(t *testing.T) {
	mockClock := clock.NewMockClock(time.Date(2026, 7, 1, 12, 0, 0, 0, time.UTC))
	signer := service.NewOAuthStateSignerWithClock([]byte(testStateSecret), mockClock)

	token, err := signer.Sign(service.OAuthStatePayload{
		Nonce:    "honest-nonce",
		IssuedAt: mockClock.Now().Unix(),
	})
	if err != nil {
		t.Fatalf("Sign: %v", err)
	}

	// Flip the first character of the payload portion (before the '.').
	// Any sane format will have a separator; tampering before it changes
	// the signed bytes but leaves the signature intact.
	tampered := "X" + token[1:]

	_, err = signer.Verify(tampered)
	if err == nil {
		t.Fatal("Verify: expected error on tampered payload, got nil")
	}
	var invalid *service.OAuthStateInvalidError
	if !errors.As(err, &invalid) {
		t.Fatalf("Verify: expected *OAuthStateInvalidError, got %T (%v)", err, err)
	}
}

// TestOAuthStateSigner_WrongSecret_Rejected proves an attacker who
// somehow obtains a state token but does NOT have the server secret
// cannot mint a valid one of their own.
func TestOAuthStateSigner_WrongSecret_Rejected(t *testing.T) {
	mockClock := clock.NewMockClock(time.Date(2026, 7, 1, 12, 0, 0, 0, time.UTC))
	honest := service.NewOAuthStateSignerWithClock([]byte(testStateSecret), mockClock)
	attacker := service.NewOAuthStateSignerWithClock([]byte("attacker-secret-also-32-bytes-XX"), mockClock)

	token, err := attacker.Sign(service.OAuthStatePayload{
		Nonce:    "attacker-forged-nonce",
		IssuedAt: mockClock.Now().Unix(),
	})
	if err != nil {
		t.Fatalf("attacker Sign: %v", err)
	}

	_, err = honest.Verify(token)
	if err == nil {
		t.Fatal("Verify: expected error on attacker-signed token, got nil")
	}
	var invalid *service.OAuthStateInvalidError
	if !errors.As(err, &invalid) {
		t.Fatalf("Verify: expected *OAuthStateInvalidError, got %T (%v)", err, err)
	}
}

// TestOAuthStateSigner_ExpiredState_Rejected proves AC9: state TTL is
// 10 minutes. After that window, the same token MUST fail verification
// even though the HMAC still matches.
func TestOAuthStateSigner_ExpiredState_Rejected(t *testing.T) {
	mockClock := clock.NewMockClock(time.Date(2026, 7, 1, 12, 0, 0, 0, time.UTC))
	signer := service.NewOAuthStateSignerWithClock([]byte(testStateSecret), mockClock)

	token, err := signer.Sign(service.OAuthStatePayload{
		Nonce:    "honest-but-stale",
		IssuedAt: mockClock.Now().Unix(),
	})
	if err != nil {
		t.Fatalf("Sign: %v", err)
	}

	// Advance clock past the 10-minute TTL.
	mockClock.Advance(11 * time.Minute)

	_, err = signer.Verify(token)
	if err == nil {
		t.Fatal("Verify: expected error on expired state, got nil")
	}
	var expired *service.OAuthStateExpiredError
	if !errors.As(err, &expired) {
		t.Fatalf("Verify: expected *OAuthStateExpiredError, got %T (%v)", err, err)
	}
}

// TestOAuthStateSigner_MalformedToken_Rejected proves that absurd
// inputs (empty string, missing separator, oversize payload) don't
// panic — they reject cleanly as *OAuthStateInvalidError.
func TestOAuthStateSigner_MalformedToken_Rejected(t *testing.T) {
	mockClock := clock.NewMockClock(time.Date(2026, 7, 1, 12, 0, 0, 0, time.UTC))
	signer := service.NewOAuthStateSignerWithClock([]byte(testStateSecret), mockClock)

	cases := []struct {
		name  string
		token string
	}{
		{"empty", ""},
		{"no separator", "nopayloadsep"},
		{"only separator", "."},
		{"junk", "not-base64-at-all!@#$%"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := signer.Verify(tc.token)
			if err == nil {
				t.Fatalf("Verify(%q): expected error, got nil", tc.token)
			}
			var invalid *service.OAuthStateInvalidError
			var expired *service.OAuthStateExpiredError
			if !errors.As(err, &invalid) && !errors.As(err, &expired) {
				t.Fatalf("Verify(%q): expected *OAuthStateInvalidError or *OAuthStateExpiredError, got %T (%v)", tc.token, err, err)
			}
		})
	}
}
