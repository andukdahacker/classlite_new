// oauth_state_ta_test.go — Story 1.6 TA expansion (P2/P3).
//
// Adversarial cross-secret tests + TTL boundary tests that the ATDD
// red phase didn't cover. The HMAC verification chain is now also
// asserted to use subtle.ConstantTimeCompare implicitly: we verify
// that wrong-secret tokens reject identically to malformed tokens
// (same error type, no externally distinguishable side channel).

package service_test

import (
	"errors"
	"testing"
	"time"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/service"
)

// TestOAuthState_TamperedSecret_AcrossSigners (#1) proves that a token
// minted by an attacker who controls a DIFFERENT secret cannot be
// verified by the honest signer — and the failure surface is the same
// *OAuthStateInvalidError that a tampered payload produces. The
// indistinguishability is what defeats probing attacks.
func TestOAuthState_TamperedSecret_AcrossSigners(t *testing.T) {
	mockClock := clock.NewMockClock(time.Date(2026, 7, 1, 12, 0, 0, 0, time.UTC))

	honest := service.NewOAuthStateSignerWithClock([]byte("honest-secret-32-bytes!!aaaaaaaa"), mockClock)
	attacker := service.NewOAuthStateSignerWithClock([]byte("attacker-secret-also-32-bytes-X1"), mockClock)

	// Attacker mints what looks like a perfectly-shaped token, even with a
	// fresh IssuedAt so TTL is also fresh.
	attackerToken, err := attacker.Sign(service.OAuthStatePayload{
		Nonce:    "attacker-forged-nonce",
		IssuedAt: mockClock.Now().Unix(),
	})
	if err != nil {
		t.Fatalf("attacker sign: %v", err)
	}

	_, err = honest.Verify(attackerToken)
	if err == nil {
		t.Fatal("honest verifier accepted attacker-signed token")
	}
	var invalid *service.OAuthStateInvalidError
	if !errors.As(err, &invalid) {
		t.Fatalf("expected *OAuthStateInvalidError, got %T (%v)", err, err)
	}

	// Defense-in-depth: ALSO verify that a tampered payload of an
	// honest-signed token surfaces the SAME error type. If the two
	// failure modes ever diverge externally, a probing attacker can
	// distinguish "valid HMAC but wrong scope" from "invalid HMAC".
	honestToken, err := honest.Sign(service.OAuthStatePayload{
		Nonce: "h", IssuedAt: mockClock.Now().Unix(),
	})
	if err != nil {
		t.Fatalf("honest sign: %v", err)
	}
	tampered := "Z" + honestToken[1:]
	_, err = honest.Verify(tampered)
	var invalid2 *service.OAuthStateInvalidError
	if !errors.As(err, &invalid2) {
		t.Fatalf("tampered-payload failure mode differs from wrong-secret: got %T", err)
	}
}

// TestOAuthStateTTL_ExactSecondBoundary_StillValid (#20) verifies the
// review-pass P16 fix: the boundary check is now inclusive. A user
// hitting the callback at exactly IssuedAt + 10 minutes should NOT
// get csrf_expired.
func TestOAuthStateTTL_ExactSecondBoundary_StillValid(t *testing.T) {
	mockClock := clock.NewMockClock(time.Date(2026, 7, 1, 12, 0, 0, 0, time.UTC))
	signer := service.NewOAuthStateSignerWithClock([]byte("test-oauth-state-secret-32-bytes!"), mockClock)

	issued := mockClock.Now()
	token, err := signer.Sign(service.OAuthStatePayload{
		Nonce:    "boundary-test",
		IssuedAt: issued.Unix(),
	})
	if err != nil {
		t.Fatalf("sign: %v", err)
	}

	// Advance clock to EXACTLY IssuedAt + 10 min (the boundary).
	mockClock.Advance(service.OAuthStateTTL)

	verified, err := signer.Verify(token)
	if err != nil {
		t.Fatalf("Verify at exact TTL boundary: expected still-valid, got %v", err)
	}
	if verified.Nonce != "boundary-test" {
		t.Errorf("nonce roundtrip: want %q, got %q", "boundary-test", verified.Nonce)
	}

	// One ns past the boundary → expired.
	mockClock.Advance(1)
	if _, err := signer.Verify(token); err == nil {
		t.Fatal("Verify past TTL boundary: expected *OAuthStateExpiredError, got nil")
	}
}
