// login_test_atdd.go — Story 1.5 ATDD red-phase scaffolds.
//
// HOW TO USE THIS FILE
//
// Each test demonstrates an acceptance criterion that does NOT yet have
// implementation. The build tag at the top keeps these tests out of the
// normal `go test ./...` run so the suite stays green during ATDD red
// phase.
//
// To activate a test:
//   1. Remove the //go:build atdd_red_phase line from this file (or move
//      the test into a new file without the tag)
//   2. Run `go test ./internal/service -run TestLogin_AC` and observe the
//      compile failure — that tells you which AuthService method or type
//      to implement next.
//   3. Implement the smallest thing that makes the test green. Repeat
//      until every test in this file is green, then move on.
//
// ACCEPTANCE CRITERIA COVERED
//   AC-1.5-01  Valid login → access + refresh tokens issued
//   AC-1.5-06  Lockout after 5 failed logins in 10 min (R13)
//   AC-1.5-07  Lockout clears after 15 min (R13)

package service_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/model"
	"github.com/ducdo/classlite-api/internal/service"
	"github.com/ducdo/classlite-api/internal/test"
)

// TestLogin_AC01_ValidCredentials_IssuesAccessAndRefreshTokens proves
// that a valid (email, password) pair produces:
//   - a signed JWT access token with a 15-minute expiry
//   - a refresh token persisted to refresh_tokens
//   - both tokens echoed in the LoginResult so the handler can set the
//     httpOnly cookie + return the access token to the client
//
// Risk: foundation for R7 (cookie attrs are asserted at handler level).
func TestLogin_AC01_ValidCredentials_IssuesAccessAndRefreshTokens(t *testing.T) {
	db := test.SetupDB(t)
	mockClock := clock.NewMockClock(time.Date(2026, 6, 5, 12, 0, 0, 0, time.UTC))

	user := test.CreateUser(t, db, "alice@example.com", "Alice Test")
	_ = test.CreateCenterWithID(t, db, test.TenantAID, "Tenant A", "TENA")

	svc := newAuthServiceWithClock(t, db, mockClock)
	// Seed the password so Login can verify it. The actual API is
	// not yet defined; this call must succeed before Login is meaningful.
	if err := svc.SetPassword(context.Background(), user.ID, "ValidPass123!"); err != nil {
		t.Fatalf("SetPassword: %v", err)
	}

	result, err := svc.Login(context.Background(), service.LoginInput{
		Email:      "alice@example.com",
		Password:   "ValidPass123!",
		RememberMe: false,
	})
	if err != nil {
		t.Fatalf("Login: expected success, got %v", err)
	}

	if result.AccessToken == "" {
		t.Fatal("AccessToken: expected non-empty JWT")
	}
	if result.RefreshToken == "" {
		t.Fatal("RefreshToken: expected non-empty token")
	}
	if expectedExpiry := mockClock.Now().Add(15 * time.Minute); !result.AccessExpiresAt.Equal(expectedExpiry) {
		t.Fatalf("AccessExpiresAt: expected %v (now + 15m), got %v", expectedExpiry, result.AccessExpiresAt)
	}
	if expectedExpiry := mockClock.Now().Add(7 * 24 * time.Hour); !result.RefreshExpiresAt.Equal(expectedExpiry) {
		t.Fatalf("RefreshExpiresAt (no Remember Me): expected %v (now + 7d), got %v", expectedExpiry, result.RefreshExpiresAt)
	}
}

// TestLogin_AC01_RememberMe_30DayRefreshExpiry proves the 30-day refresh
// TTL when RememberMe is set.
func TestLogin_AC01_RememberMe_30DayRefreshExpiry(t *testing.T) {
	db := test.SetupDB(t)
	mockClock := clock.NewMockClock(time.Date(2026, 6, 5, 12, 0, 0, 0, time.UTC))

	user := test.CreateUser(t, db, "alice@example.com", "Alice Test")
	_ = test.CreateCenterWithID(t, db, test.TenantAID, "Tenant A", "TENA")

	svc := newAuthServiceWithClock(t, db, mockClock)
	if err := svc.SetPassword(context.Background(), user.ID, "ValidPass123!"); err != nil {
		t.Fatalf("SetPassword: %v", err)
	}

	result, err := svc.Login(context.Background(), service.LoginInput{
		Email:      "alice@example.com",
		Password:   "ValidPass123!",
		RememberMe: true,
	})
	if err != nil {
		t.Fatalf("Login: %v", err)
	}

	if expectedExpiry := mockClock.Now().Add(30 * 24 * time.Hour); !result.RefreshExpiresAt.Equal(expectedExpiry) {
		t.Fatalf("RefreshExpiresAt (RememberMe): expected %v (now + 30d), got %v", expectedExpiry, result.RefreshExpiresAt)
	}
}

// TestLogin_AC06_FiveFailedAttempts_TriggersLockout proves R13: after 5
// failed login attempts within 10 minutes, the 6th attempt is rejected
// with a LockedError and a Retry-After hint.
func TestLogin_AC06_FiveFailedAttempts_TriggersLockout(t *testing.T) {
	db := test.SetupDB(t)
	mockClock := clock.NewMockClock(time.Date(2026, 6, 5, 12, 0, 0, 0, time.UTC))

	user := test.CreateUser(t, db, "bob@example.com", "Bob Test")
	_ = test.CreateCenterWithID(t, db, test.TenantAID, "Tenant A", "TENA")

	svc := newAuthServiceWithClock(t, db, mockClock)
	if err := svc.SetPassword(context.Background(), user.ID, "RealPassword123!"); err != nil {
		t.Fatalf("SetPassword: %v", err)
	}

	// Five wrong-password attempts, advancing the clock by 1 minute each
	// so they all land inside the 10-minute window.
	for i := 1; i <= 5; i++ {
		_, err := svc.Login(context.Background(), service.LoginInput{
			Email:    "bob@example.com",
			Password: "WrongPassword",
		})
		if err == nil {
			t.Fatalf("attempt %d: expected InvalidCredentialsError, got success", i)
		}
		var invalidErr *service.InvalidCredentialsError
		if !errors.As(err, &invalidErr) {
			t.Fatalf("attempt %d: expected InvalidCredentialsError, got %T", i, err)
		}
		mockClock.Advance(1 * time.Minute)
	}

	// 6th attempt MUST be locked, even with the correct password.
	_, err := svc.Login(context.Background(), service.LoginInput{
		Email:    "bob@example.com",
		Password: "RealPassword123!",
	})
	var lockedErr *service.AccountLockedError
	if !errors.As(err, &lockedErr) {
		t.Fatalf("6th attempt: expected AccountLockedError, got %T (%v)", err, err)
	}
	if lockedErr.RetryAfter <= 0 {
		t.Fatalf("AccountLockedError.RetryAfter: expected positive duration, got %v", lockedErr.RetryAfter)
	}
	if lockedErr.RetryAfter > 15*time.Minute {
		t.Fatalf("AccountLockedError.RetryAfter: expected ≤15m, got %v", lockedErr.RetryAfter)
	}
}

// TestLogin_AC07_LockoutExpiry_Allows15MinLaterLogin proves R13 the
// other half: after a 15-minute lockout, the user can log in normally
// with correct credentials and the failure counter is reset.
func TestLogin_AC07_LockoutExpiry_Allows15MinLaterLogin(t *testing.T) {
	db := test.SetupDB(t)
	mockClock := clock.NewMockClock(time.Date(2026, 6, 5, 12, 0, 0, 0, time.UTC))

	user := test.CreateUser(t, db, "carol@example.com", "Carol Test")
	_ = test.CreateCenterWithID(t, db, test.TenantAID, "Tenant A", "TENA")

	svc := newAuthServiceWithClock(t, db, mockClock)
	if err := svc.SetPassword(context.Background(), user.ID, "RealPassword123!"); err != nil {
		t.Fatalf("SetPassword: %v", err)
	}

	// Trigger lockout.
	for i := 0; i < 5; i++ {
		_, _ = svc.Login(context.Background(), service.LoginInput{
			Email:    "carol@example.com",
			Password: "WrongPassword",
		})
	}

	// Time-travel past the 15-minute lockout window.
	mockClock.Advance(16 * time.Minute)

	// Correct credentials should now succeed and the counter resets.
	result, err := svc.Login(context.Background(), service.LoginInput{
		Email:    "carol@example.com",
		Password: "RealPassword123!",
	})
	if err != nil {
		t.Fatalf("post-lockout login: expected success, got %v", err)
	}
	if result.AccessToken == "" {
		t.Fatal("post-lockout login: expected access token")
	}
}

// newAuthServiceWithClock is the test-helper factory used by Story 1.5
// scaffolds. Uses BcryptHasher{Cost: 4} (real bcrypt) so the Login path's
// CompareHashAndPassword check verifies — MockHasher's "mock-hash" string
// fails bcrypt validation.
func newAuthServiceWithClock(t *testing.T, db *test.TxDB, c clock.Clock) *service.AuthService {
	t.Helper()
	_ = model.TenantContext{} // keep import live; real impl uses TC in mutating ops
	hasher := service.BcryptHasher{Cost: 4}
	sender := &service.MockEmailSender{}
	queue := service.NewEmailRetryQueue(sender, 8)
	auditLogger := service.NewPgAuthAuditLogger(db)

	return service.NewAuthServiceWithClock(db, hasher, sender, auditLogger, queue, testVerifyURLBase, c)
}
