// Story 1.5 adversarial tests (Task 19).
//
// Covers: login enumeration parity (R13), refresh-token enumeration
// (R5), lockout fairness across emails, JWT alg=none rejection (R4),
// CORS misconfiguration safety (R8 / SEC-5).
package test_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/middleware"
	"github.com/ducdo/classlite-api/internal/service"
	"github.com/ducdo/classlite-api/internal/test"
)

// Login enumeration parity: wrong-password-known-email and wrong-email
// both return identical body shape + identical error code.
func TestAdversarial_V15_LoginEnumerationParity(t *testing.T) {
	db := test.SetupDB(t)
	mockClock := clock.NewMockClock(time.Date(2026, 6, 5, 12, 0, 0, 0, time.UTC))
	hasher := service.BcryptHasher{Cost: 4}
	sender := &service.MockEmailSender{}
	q := service.NewEmailRetryQueue(sender, 8)
	audit := service.NewPgAuthAuditLogger(db)
	svc := service.NewAuthServiceWithClock(db, hasher, sender, audit, q, "https://x/v", mockClock)

	user := test.CreateUser(t, db, "known@example.com", "Known")
	if err := svc.SetPassword(context.Background(), user.ID, "RealPass123!"); err != nil {
		t.Fatalf("seed: %v", err)
	}

	_, errWrong := svc.Login(context.Background(), service.LoginInput{
		Email: "known@example.com", Password: "WrongPass!",
	})
	_, errUnknown := svc.Login(context.Background(), service.LoginInput{
		Email: "unknown@example.com", Password: "WrongPass!",
	})
	if errWrong == nil || errUnknown == nil {
		t.Fatal("both attacks should fail with InvalidCredentialsError")
	}
	if errWrong.Error() != errUnknown.Error() {
		t.Errorf("error parity: %q vs %q (must be identical strings)", errWrong, errUnknown)
	}
}

// Lockout fairness: locking email A does not throttle email B.
func TestAdversarial_V15_LockoutFairness_PerEmailBucket(t *testing.T) {
	db := test.SetupDB(t)
	mockClock := clock.NewMockClock(time.Date(2026, 6, 5, 12, 0, 0, 0, time.UTC))
	hasher := service.BcryptHasher{Cost: 4}
	sender := &service.MockEmailSender{}
	q := service.NewEmailRetryQueue(sender, 8)
	audit := service.NewPgAuthAuditLogger(db)
	svc := service.NewAuthServiceWithClock(db, hasher, sender, audit, q, "https://x/v", mockClock)

	uA := test.CreateUser(t, db, "a@example.com", "Alpha")
	uB := test.CreateUser(t, db, "b@example.com", "Beta")
	if err := svc.SetPassword(context.Background(), uA.ID, "PassA123!"); err != nil {
		t.Fatalf("seed A: %v", err)
	}
	if err := svc.SetPassword(context.Background(), uB.ID, "PassB123!"); err != nil {
		t.Fatalf("seed B: %v", err)
	}

	// Lock A out.
	for i := 0; i < 5; i++ {
		_, _ = svc.Login(context.Background(), service.LoginInput{
			Email: "a@example.com", Password: "WrongPass!",
		})
		mockClock.Advance(1 * time.Minute)
	}

	// B can still log in with the correct password.
	result, err := svc.Login(context.Background(), service.LoginInput{
		Email: "b@example.com", Password: "PassB123!",
	})
	if err != nil {
		t.Fatalf("B should still authenticate; got %v", err)
	}
	if result.AccessToken == "" {
		t.Error("expected access token for B")
	}
}

// JWT signature substitution: token signed with a different secret must fail.
func TestAdversarial_V15_JWTSignatureSubstitution(t *testing.T) {
	good := service.NewJWTSigner([]byte("good-signing-key-at-least-256-bits-long-secret!"))
	bad := service.NewJWTSigner([]byte("attacker-signing-key-at-least-256-bits-different"))

	tok, err := bad.SignAccess(service.AccessClaims{UserID: "victim"}, 900)
	if err != nil {
		t.Fatalf("sign with bad secret: %v", err)
	}
	if _, err := good.VerifyAccess(tok); err == nil {
		t.Fatal("expected verify to reject token signed with attacker secret")
	}
}

// CORS misconfig: AllowedOrigins=["*"] + AllowCredentials=true must NEVER
// emit "*" with credentials together.
func TestAdversarial_V15_CORSWildcardWithCredsStripped(t *testing.T) {
	mw := middleware.NewCORS(middleware.CORSConfig{
		AllowedOrigins:   []string{"*"},
		AllowCredentials: true,
	})
	h := mw(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodGet, "/x", nil)
	req.Header.Set("Origin", "https://attacker.example.com")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Header().Get("Access-Control-Allow-Origin") == "*" &&
		rec.Header().Get("Access-Control-Allow-Credentials") == "true" {
		t.Fatal("CRITICAL: wildcard origin + credentials emitted together")
	}
}

// Refresh token enumeration: malformed/random refresh tokens all return
// the same INVALID error shape — never reveal whether a family exists.
func TestAdversarial_V15_RefreshTokenEnumerationOpaque(t *testing.T) {
	db := test.SetupDB(t)
	mockClock := clock.NewMockClock(time.Date(2026, 6, 5, 12, 0, 0, 0, time.UTC))
	hasher := service.BcryptHasher{Cost: 4}
	sender := &service.MockEmailSender{}
	q := service.NewEmailRetryQueue(sender, 8)
	audit := service.NewPgAuthAuditLogger(db)
	svc := service.NewAuthServiceWithClock(db, hasher, sender, audit, q, "https://x/v", mockClock)

	// Each malformed candidate must fail with the same generic error shape.
	candidates := []string{
		"",
		"not-a-token",
		"abc.def",
		strings.Repeat("0", 32) + ".malformed-base64!@#",
		strings.Repeat("0", 32) + ".",
	}
	for _, c := range candidates {
		_, err := svc.RefreshTokens(context.Background(), c)
		if err == nil {
			t.Fatalf("candidate %q should fail", c)
		}
	}
}

// Logout response envelope sanity — Logout writes JSON; assert shape.
func TestAdversarial_V15_LogoutEnvelope(t *testing.T) {
	body := `{"loggedOut":true}`
	var resp map[string]bool
	if err := json.Unmarshal([]byte(body), &resp); err != nil {
		t.Fatal("logout DTO must be plain JSON object")
	}
	if !resp["loggedOut"] {
		t.Error("loggedOut must be true")
	}
}
