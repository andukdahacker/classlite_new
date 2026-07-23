// Package service — Story 1.5 RefreshTokens (AC2, AC8, AC9).
//
// Rotation contract: every successful refresh DELETEs the presented row
// and INSERTs a fresh one with the same family id, preserving the
// original session's remember_me window. Reuse — a presented token whose
// row was already deleted but whose family still has at least one sibling
// — REVOKES the entire family.
//
// The atomicity guarantee for the concurrent race comes from PostgreSQL's
// row-level lock on `DELETE ... RETURNING`: exactly one of two concurrent
// statements removes the row. The race loser sees 0 rows returned, finds
// the winner's freshly inserted sibling, and triggers family revocation.
package service

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/ducdo/classlite-api/internal/store/generated"
)

// RefreshTokens implements AC2 / AC8 / AC9.
func (s *AuthService) RefreshTokens(ctx context.Context, rawToken string) (*LoginResult, error) {
	familyID, err := parseRefreshTokenFamily(rawToken)
	if err != nil {
		return nil, &RefreshTokenInvalidError{}
	}
	tokenHash := HashRefreshToken(rawToken)
	now := s.clk.Now()

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("begin refresh tx: %w", err)
	}
	defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }()

	q := generated.New(tx)

	// why: RotateRefreshToken does NOT filter on expires_at. An expired-
	// but-uncleaned row that hashes to the presented token must surface
	// as RefreshTokenInvalidError, NOT trigger family revocation. The
	// expiry check happens in Go after DELETE ... RETURNING succeeds.
	rotated, err := q.RotateRefreshToken(ctx, tokenHash)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			// Zero rows means either reuse (rotated-out token replayed) or
			// truly unknown token. Distinguish by checking the family.
			return s.handleRefreshMiss(ctx, tx, familyID)
		}
		return nil, fmt.Errorf("rotate refresh: %w", err)
	}

	// Explicit expiry check (P1): the row was atomically deleted, but if
	// it had already expired we treat it as invalid without revoking the
	// rest of the family.
	if !rotated.ExpiresAt.Valid || !rotated.ExpiresAt.Time.After(now) {
		if err := tx.Commit(ctx); err != nil {
			return nil, fmt.Errorf("commit expired-rotate tx: %w", err)
		}
		return nil, &RefreshTokenInvalidError{}
	}

	// Happy path: generate a new raw token + insert in same family.
	newRaw, newHash, err := rotateRefreshTokenValue(uuid.UUID(rotated.FamilyID.Bytes))
	if err != nil {
		return nil, err
	}
	newRefreshExpiry := s.computeRefreshExpiry(now, rotated.RememberMe)
	if _, err := q.CreateRefreshToken(ctx, generated.CreateRefreshTokenParams{
		UserID:     rotated.UserID,
		TokenHash:  newHash,
		FamilyID:   rotated.FamilyID,
		ExpiresAt:  pgtype.Timestamptz{Time: newRefreshExpiry, Valid: true},
		RememberMe: rotated.RememberMe,
	}); err != nil {
		return nil, fmt.Errorf("insert rotated refresh: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit refresh tx: %w", err)
	}

	user, err := generated.New(s.db).GetUserByID(ctx, rotated.UserID)
	if err != nil {
		return nil, fmt.Errorf("get user after refresh: %w", err)
	}

	access, accessExp, role, center, err := s.buildAccessToken(ctx, rotated.UserID)
	if err != nil {
		return nil, fmt.Errorf("sign access token: %w", err)
	}

	userUUID, _ := pgUUIDToGoogle(rotated.UserID)
	s.logAuthAuditBestEffort(context.WithoutCancel(ctx), AuthAuditEntry{
		UserID:     userUUID,
		Event:      "session.refreshed",
		EntityType: "session",
		EntityID:   userUUID,
	})

	refreshTTL := RefreshTokenTTLDefault
	if rotated.RememberMe {
		refreshTTL = RefreshTokenTTLRememberMe
	}
	return &LoginResult{
		AccessToken:      access,
		RefreshToken:     newRaw,
		AccessExpiresAt:  accessExp,
		RefreshExpiresAt: newRefreshExpiry,
		RefreshTTL:       refreshTTL,
		User:             user,
		Role:             role,
		Center:           center,
	}, nil
}

// handleRefreshMiss runs when RotateRefreshToken returned 0 rows. Family
// with ≥1 sibling → reuse detection; family with no rows → unknown token.
func (s *AuthService) handleRefreshMiss(ctx context.Context, tx pgx.Tx, familyID uuid.UUID) (*LoginResult, error) {
	q := generated.New(tx)
	siblingCount, err := q.CountSiblingsInFamily(ctx, pgtype.UUID{Bytes: familyID, Valid: true})
	if err != nil {
		return nil, fmt.Errorf("count siblings: %w", err)
	}
	if siblingCount == 0 {
		// Truly unknown token — no family to revoke. Roll back the tx
		// (nothing to commit) and return invalid.
		return nil, &RefreshTokenInvalidError{}
	}

	// Reuse detected. Revoke everything in the family, including the
	// rotated-in successor that a legitimate browser tab might still hold.
	// DELETE ... RETURNING (id, user_id) so we can attribute the audit
	// row to the user whose session was just blown up (P20).
	deleted, err := q.DeleteRefreshTokensByFamily(ctx, pgtype.UUID{Bytes: familyID, Valid: true})
	if err != nil {
		return nil, fmt.Errorf("delete family on reuse: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit reuse-revoke tx: %w", err)
	}

	var revokedUserUUID uuid.UUID
	if len(deleted) > 0 {
		revokedUserUUID, _ = pgUUIDToGoogle(deleted[0].UserID)
	}
	s.logAuthAuditBestEffort(context.WithoutCancel(ctx), AuthAuditEntry{
		UserID:     revokedUserUUID,
		Event:      "session.family_revoked",
		EntityType: "session_family",
		EntityID:   revokedUserUUID,
		Changes: Changes{After: map[string]any{
			"reason":   "reuse_detected",
			"familyId": familyID.String(),
		}},
	})

	return nil, &TokenReuseDetectedError{FamilyID: familyID.String()}
}

// computeRefreshExpiry picks the TTL based on the originating session's
// remember_me flag — rotation preserves the session window per AC2.
func (s *AuthService) computeRefreshExpiry(now time.Time, rememberMe bool) time.Time {
	if rememberMe {
		return now.Add(RefreshTokenTTLRememberMe)
	}
	return now.Add(RefreshTokenTTLDefault)
}
