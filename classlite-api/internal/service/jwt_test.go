package service_test

import (
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/service"
)

const testJWTSecret = "test-signing-key-at-least-256-bits-long-12345678"

func TestJWTSigner_SignVerify_HappyPath(t *testing.T) {
	c := clock.NewMockClock(time.Date(2026, 6, 5, 12, 0, 0, 0, time.UTC))
	signer := service.NewJWTSignerWithClock([]byte(testJWTSecret), c)

	tok, err := signer.SignAccess(service.AccessClaims{UserID: "user-1"}, 900)
	if err != nil {
		t.Fatalf("sign: %v", err)
	}
	claims, err := signer.VerifyAccess(tok)
	if err != nil {
		t.Fatalf("verify: %v", err)
	}
	if claims.UserID != "user-1" {
		t.Errorf("user_id = %q, want user-1", claims.UserID)
	}
}

func TestJWTSigner_ForgedSignatureRejected(t *testing.T) {
	signer := service.NewJWTSigner([]byte(testJWTSecret))
	tok, err := signer.SignAccess(service.AccessClaims{UserID: "x"}, 900)
	if err != nil {
		t.Fatalf("sign: %v", err)
	}
	// Substitute the last block to break the HMAC.
	parts := strings.Split(tok, ".")
	if len(parts) != 3 {
		t.Fatalf("malformed JWT: %s", tok)
	}
	parts[2] = "AAAAAAAAAAAAAAAAAAAA"
	forged := strings.Join(parts, ".")

	if _, err := signer.VerifyAccess(forged); err == nil {
		t.Fatal("expected verify to reject forged signature")
	}
}

func TestJWTSigner_AlgNoneRejected(t *testing.T) {
	// Construct an alg=none token by hand: header.payload.signature where
	// header is {"alg":"none","typ":"JWT"} and signature is empty.
	signer := service.NewJWTSigner([]byte(testJWTSecret))
	// header: base64url eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0
	// payload: eyJ1c2VyX2lkIjoieCJ9   (= {"user_id":"x"})
	bogus := "eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJ1c2VyX2lkIjoieCJ9."

	if _, err := signer.VerifyAccess(bogus); err == nil {
		t.Fatal("expected verify to reject alg=none token")
	}
}

func TestJWTSigner_ExpiredTokenReturnsSentinel(t *testing.T) {
	c := clock.NewMockClock(time.Date(2026, 6, 5, 12, 0, 0, 0, time.UTC))
	signer := service.NewJWTSignerWithClock([]byte(testJWTSecret), c)

	tok, err := signer.SignAccess(service.AccessClaims{UserID: "x"}, 1) // 1-second TTL
	if err != nil {
		t.Fatalf("sign: %v", err)
	}
	c.Advance(2 * time.Second)
	_, err = signer.VerifyAccess(tok)
	if !errors.Is(err, service.ErrJWTExpired) {
		t.Errorf("expected ErrJWTExpired, got %v", err)
	}
}

func TestJWTSigner_DifferentJtiPerSign(t *testing.T) {
	c := clock.NewMockClock(time.Date(2026, 6, 5, 12, 0, 0, 0, time.UTC))
	signer := service.NewJWTSignerWithClock([]byte(testJWTSecret), c)
	a, _ := signer.SignAccess(service.AccessClaims{UserID: "x"}, 900)
	b, _ := signer.SignAccess(service.AccessClaims{UserID: "x"}, 900)
	if a == b {
		t.Fatal("expected two signs at same clock to differ (jti uniqueness)")
	}
}
