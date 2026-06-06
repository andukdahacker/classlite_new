// Package service — Story 1.5 password reset (AC3, AC4).
//
// AC3 anti-enumeration: every 200 response is padded to ≥ 200ms via the
// same clock.Sleep floor used by Story 1.4 resend-verification, so the
// known-vs-unknown email branches cannot be distinguished by wall-clock
// timing. The known-email branch additionally writes an audit row + an
// email enqueue; the unknown branch is silent — but both spend the same
// minimum wall time, and the email send is async so it cannot leak
// network-latency to the response timing.
//
// AC4 invalidates all sessions on success: a successful reset DELETEs
// every refresh_tokens row for the user and clears the login_attempts
// counter, so the user is forced to re-login everywhere and the lockout
// state cannot survive the reset.
package service

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"net/mail"
	"strings"
	"time"

	"github.com/ducdo/classlite-api/internal/model"
	"github.com/ducdo/classlite-api/internal/store/generated"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

// RequestPasswordReset implements AC3.
func (s *AuthService) RequestPasswordReset(ctx context.Context, email string) error {
	startedAt := s.clk.Now()
	defer s.padToFloor(startedAt)

	parsed, err := mail.ParseAddress(strings.TrimSpace(email))
	if err != nil {
		return model.ValidationError{Fields: []model.FieldError{{Field: "email", Message: "invalid email format"}}}
	}
	normalized := normalizeEmail(parsed.Address)

	preTxQ := generated.New(s.db)
	user, err := preTxQ.GetUserByEmail(ctx, normalized)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			s.logAuthAuditBestEffort(context.WithoutCancel(ctx), AuthAuditEntry{
				Event:      "password.reset_requested.miss",
				EntityType: "password_reset",
				Changes:    Changes{After: map[string]any{"reason": "unknown_email"}},
			})
			return nil
		}
		return fmt.Errorf("get user by email: %w", err)
	}
	if !user.EmailVerified {
		// Per AC3: unverified users also get the silent path so the
		// verification-state of an account isn't a side channel either.
		userUUID, _ := pgUUIDToGoogle(user.ID)
		s.logAuthAuditBestEffort(context.WithoutCancel(ctx), AuthAuditEntry{
			UserID:     userUUID,
			Event:      "password.reset_requested.miss",
			EntityType: "password_reset",
			EntityID:   userUUID,
			Changes:    Changes{After: map[string]any{"reason": "unverified_user"}},
		})
		return nil
	}

	rawToken, err := newPasswordResetToken()
	if err != nil {
		return fmt.Errorf("generate reset token: %w", err)
	}
	tokenHash := HashResetToken(rawToken)

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin reset request tx: %w", err)
	}
	defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }()

	q := generated.New(tx)
	now := s.clk.Now()
	if _, err := q.CreatePasswordReset(ctx, generated.CreatePasswordResetParams{
		UserID:    user.ID,
		TokenHash: tokenHash,
		ExpiresAt: pgtype.Timestamptz{Time: now.Add(PasswordResetTTL), Valid: true},
		Email:     pgtype.Text{String: normalized, Valid: true},
	}); err != nil {
		return fmt.Errorf("create password reset: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit reset request tx: %w", err)
	}

	// why async: synchronous Send round-trips are slow enough (200-400 ms)
	// to defeat the padToFloor anti-enumeration defense — the known-email
	// branch would visibly outrun the unknown-email branch. Enqueueing
	// onto the same retry queue used by registration / verification keeps
	// the response time constant regardless of email-send latency.
	resetURL := s.resetURL + "?token=" + rawToken
	subject, body := RenderPasswordResetEmail(user.FullName, resetURL)
	if s.retry != nil {
		_ = s.retry.Enqueue(EmailJob{To: user.Email, Subject: subject, HTML: body})
	}

	userUUID, _ := pgUUIDToGoogle(user.ID)
	s.logAuthAuditBestEffort(context.WithoutCancel(ctx), AuthAuditEntry{
		UserID:     userUUID,
		Event:      "password.reset_requested.hit",
		EntityType: "password_reset",
		EntityID:   userUUID,
		Changes:    Changes{After: map[string]any{"tokenIssuedAt": now.UTC().Format("2006-01-02T15:04:05Z")}},
	})
	return nil
}

// ResetPassword implements AC4.
func (s *AuthService) ResetPassword(ctx context.Context, rawToken, newPassword string) error {
	if len(newPassword) < MinPasswordLength {
		return model.ValidationError{Fields: []model.FieldError{{Field: "newPassword", Message: fmt.Sprintf("must be at least %d characters", MinPasswordLength)}}}
	}
	if strings.TrimSpace(newPassword) == "" {
		return model.ValidationError{Fields: []model.FieldError{{Field: "newPassword", Message: "must not be whitespace-only"}}}
	}
	if len([]byte(newPassword)) > MaxPasswordBytes {
		return model.ValidationError{Fields: []model.FieldError{{Field: "newPassword", Message: fmt.Sprintf("must be at most %d bytes", MaxPasswordBytes)}}}
	}

	tokenHash := HashResetToken(rawToken)
	preTxQ := generated.New(s.db)
	existing, err := preTxQ.GetPasswordResetByTokenHash(ctx, tokenHash)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return model.NotFoundError{
				Resource: "password_reset",
				Code:     "RESET_TOKEN_INVALID",
			}
		}
		return fmt.Errorf("get password reset: %w", err)
	}
	if existing.UsedAt.Valid {
		return &ResetTokenConsumedError{}
	}
	now := s.clk.Now()
	if !existing.ExpiresAt.Valid || existing.ExpiresAt.Time.Before(now) {
		return model.GoneError{
			Code:   "RESET_TOKEN_EXPIRED",
			Reason: "This password reset link has expired.",
		}
	}

	// Hash OUTSIDE the tx (H1).
	hash, err := s.hasher.Hash([]byte(newPassword))
	if err != nil {
		return fmt.Errorf("hash new password: %w", err)
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin reset apply tx: %w", err)
	}
	defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }()

	q := generated.New(tx)
	if err := q.UpdateUserPassword(ctx, generated.UpdateUserPasswordParams{
		ID:           existing.UserID,
		PasswordHash: pgtype.Text{String: string(hash), Valid: true},
	}); err != nil {
		return fmt.Errorf("update user password: %w", err)
	}
	// why RowsAffected check: the UPDATE filters `used_at IS NULL`. Two
	// concurrent ResetPassword calls would both pass the earlier in-Go
	// `existing.UsedAt.Valid` check; only one wins this race, the other
	// gets 0 rows updated and must surface ResetTokenConsumedError.
	consumed, err := q.MarkPasswordResetUsed(ctx, generated.MarkPasswordResetUsedParams{
		ID:     existing.ID,
		UsedAt: pgtype.Timestamptz{Time: now, Valid: true},
	})
	if err != nil {
		return fmt.Errorf("mark reset used: %w", err)
	}
	if consumed == 0 {
		return &ResetTokenConsumedError{}
	}
	if err := q.DeleteAllRefreshTokensForUser(ctx, existing.UserID); err != nil {
		return fmt.Errorf("delete refresh tokens: %w", err)
	}
	if existing.Email.Valid && existing.Email.String != "" {
		if err := q.DeleteLoginAttemptsByEmail(ctx, existing.Email.String); err != nil {
			return fmt.Errorf("delete login attempts: %w", err)
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit reset apply tx: %w", err)
	}

	userUUID, _ := pgUUIDToGoogle(existing.UserID)
	s.logAuthAuditBestEffort(context.WithoutCancel(ctx), AuthAuditEntry{
		UserID:     userUUID,
		Event:      "password.reset_applied",
		EntityType: "user",
		EntityID:   userUUID,
	})
	return nil
}

// padToFloor sleeps until at least ResendConstantTimeFloor has elapsed
// since `start`. Reuse of the Story 1.4 floor — both branches of the
// forgot-password endpoint must hit the same minimum wall time.
func (s *AuthService) padToFloor(start time.Time) {
	if elapsed := s.clk.Now().Sub(start); elapsed < ResendConstantTimeFloor {
		s.clk.Sleep(ResendConstantTimeFloor - elapsed)
	}
}

// newPasswordResetToken returns 32 random bytes encoded as URL-safe base64
// without padding (43 characters).
func newPasswordResetToken() (string, error) {
	b := make([]byte, PasswordResetTokenBytes)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}
