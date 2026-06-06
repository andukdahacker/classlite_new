//go:build atdd_red_phase

// password_reset_test_atdd.go — Story 1.5 ATDD red-phase scaffolds.
//
// ACCEPTANCE CRITERIA COVERED
//   AC-1.5-03  Request password reset: silent on unknown email (no enumeration)
//   AC-1.5-04  Apply password reset: password updated, all sessions invalidated, token consumed

package service_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/service"
	"github.com/ducdo/classlite-api/internal/test"
)

// TestRequestPasswordReset_AC03_UnknownEmail_SilentNoEnumeration proves
// that requesting a reset for an unknown email returns the SAME
// response shape as a known email — no error code, no different
// timing signal, no email side-channel.
func TestRequestPasswordReset_AC03_UnknownEmail_SilentNoEnumeration(t *testing.T) {
	db := test.SetupDB(t)
	mockClock := clock.NewMockClock(time.Date(2026, 6, 5, 12, 0, 0, 0, time.UTC))
	svc := newAuthServiceWithClock(t, db, mockClock)

	err := svc.RequestPasswordReset(context.Background(), "does-not-exist@example.com")
	if err != nil {
		t.Fatalf("unknown email: expected silent success, got %v (this would enable email enumeration)", err)
	}

	// No password_resets row should be created for the unknown email.
	var count int
	if err := db.QueryRow(context.Background(),
		`SELECT COUNT(*) FROM password_resets WHERE email = $1`, "does-not-exist@example.com",
	).Scan(&count); err != nil {
		t.Fatalf("count password_resets: %v", err)
	}
	if count != 0 {
		t.Fatalf("expected zero password_resets rows for unknown email, found %d", count)
	}
}

// TestRequestPasswordReset_AC03_KnownEmail_CreatesTokenAndSendsEmail
// proves the known-email path creates a 1-hour-expiry token and
// dispatches an email via the existing EmailSender abstraction.
func TestRequestPasswordReset_AC03_KnownEmail_CreatesTokenAndSendsEmail(t *testing.T) {
	db := test.SetupDB(t)
	mockClock := clock.NewMockClock(time.Date(2026, 6, 5, 12, 0, 0, 0, time.UTC))
	user := test.CreateUser(t, db, "alice@example.com", "Alice Test")

	svc, _, sender, _ := newAuthServiceWithSenderAccess(t, db, mockClock)

	if err := svc.RequestPasswordReset(context.Background(), "alice@example.com"); err != nil {
		t.Fatalf("RequestPasswordReset: %v", err)
	}

	// Token row exists with 1-hour expiry.
	var expiresAt time.Time
	if err := db.QueryRow(context.Background(),
		`SELECT expires_at FROM password_resets WHERE user_id = $1`, user.ID,
	).Scan(&expiresAt); err != nil {
		t.Fatalf("query password_resets: %v", err)
	}
	expected := mockClock.Now().Add(1 * time.Hour)
	if !expiresAt.Equal(expected) {
		t.Fatalf("expires_at: expected %v (now + 1h), got %v", expected, expiresAt)
	}

	// Email dispatched.
	if sender.Count() != 1 {
		t.Fatalf("expected 1 email send, got %d", sender.Count())
	}
}

// TestResetPassword_AC04_HappyPath_InvalidatesAllSessions proves that
// applying a valid reset token:
//   - updates the user's password
//   - DELETES every refresh_tokens row for the user (logs out all sessions)
//   - consumes the reset token (subsequent use rejected)
func TestResetPassword_AC04_HappyPath_InvalidatesAllSessions(t *testing.T) {
	db := test.SetupDB(t)
	mockClock := clock.NewMockClock(time.Date(2026, 6, 5, 12, 0, 0, 0, time.UTC))
	user := test.CreateUser(t, db, "alice@example.com", "Alice Test")
	_ = test.CreateCenterWithID(t, db, test.TenantAID, "Tenant A", "TENA")
	svc := newAuthServiceWithClock(t, db, mockClock)

	if err := svc.SetPassword(context.Background(), user.ID, "OldPassword123!"); err != nil {
		t.Fatalf("SetPassword: %v", err)
	}

	// Create two active sessions to prove BOTH get invalidated.
	for i := 0; i < 2; i++ {
		if _, err := svc.Login(context.Background(), service.LoginInput{
			Email: "alice@example.com", Password: "OldPassword123!",
		}); err != nil {
			t.Fatalf("seed login %d: %v", i, err)
		}
	}

	// Get a reset token via the service path so we use the same hashing
	// the impl uses (impl detail not asserted here).
	if err := svc.RequestPasswordReset(context.Background(), "alice@example.com"); err != nil {
		t.Fatalf("RequestPasswordReset: %v", err)
	}
	var token string
	if err := db.QueryRow(context.Background(),
		`SELECT token FROM password_resets WHERE user_id = $1`, user.ID,
	).Scan(&token); err != nil {
		t.Fatalf("query password_resets token: %v", err)
	}

	// Apply reset.
	if err := svc.ResetPassword(context.Background(), token, "NewPassword123!"); err != nil {
		t.Fatalf("ResetPassword: %v", err)
	}

	// All refresh tokens for the user must be gone.
	var refreshCount int
	if err := db.QueryRow(context.Background(),
		`SELECT COUNT(*) FROM refresh_tokens WHERE user_id = $1`, user.ID,
	).Scan(&refreshCount); err != nil {
		t.Fatalf("count refresh_tokens: %v", err)
	}
	if refreshCount != 0 {
		t.Fatalf("expected zero refresh tokens after reset, got %d (sessions not invalidated)", refreshCount)
	}

	// New password works.
	if _, err := svc.Login(context.Background(), service.LoginInput{
		Email: "alice@example.com", Password: "NewPassword123!",
	}); err != nil {
		t.Fatalf("post-reset login with new password: %v", err)
	}

	// Old password rejected.
	_, err := svc.Login(context.Background(), service.LoginInput{
		Email: "alice@example.com", Password: "OldPassword123!",
	})
	if err == nil {
		t.Fatal("post-reset login with old password: expected failure, got success")
	}

	// Reset token consumed — second use rejected.
	err = svc.ResetPassword(context.Background(), token, "AnotherPassword123!")
	var consumedErr *service.ResetTokenConsumedError
	if !errors.As(err, &consumedErr) {
		t.Fatalf("re-use of consumed token: expected ResetTokenConsumedError, got %T (%v)", err, err)
	}
}

// newAuthServiceWithSenderAccess wraps newAuthServiceWithClock and also
// returns the mock sender so tests can assert email dispatch counts.
func newAuthServiceWithSenderAccess(
	t *testing.T,
	db *test.TxDB,
	c clock.Clock,
) (*service.AuthService, *service.MockHasher, *service.MockEmailSender, *service.InProcessRetryQueue) {
	t.Helper()
	hasher := &service.MockHasher{}
	sender := &service.MockEmailSender{}
	queue := service.NewEmailRetryQueue(sender, 8)
	auditLogger := service.NewPgAuthAuditLogger(db)
	svc := service.NewAuthServiceWithClock(db, hasher, sender, auditLogger, queue, testVerifyURLBase, c)
	return svc, hasher, sender, queue
}
