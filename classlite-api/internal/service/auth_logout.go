// Package service — Story 1.5 Logout (AC5).
//
// Idempotent contract: the response is identical (200 + clearing cookie)
// whether the presented refresh token existed, was already revoked, or was
// never present at all. Clients should not learn whether their token was
// server-side-valid.
package service

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

// Logout implements AC5. The handler always emits a clearing Set-Cookie
// regardless of the service result.
//
// Error semantics:
//   - Unknown / already-revoked / missing-cookie token → returns nil
//     (idempotent silence; no audit row).
//   - Known token deleted successfully → returns nil; emits the
//     session.logged_out audit row attributed to the deleted row's user_id
//     (P26 — previously the audit row had user_id = uuid.Nil).
//   - Any other DB error → returned to the caller (P16 — previously
//     swallowed, which meant a pool failure made the client think they
//     were signed out while the server still trusted the token).
func (s *AuthService) Logout(ctx context.Context, rawRefresh string) error {
	if rawRefresh == "" {
		return nil
	}
	hash := HashRefreshToken(rawRefresh)
	var userID pgtype.UUID
	err := s.db.QueryRow(ctx,
		`DELETE FROM refresh_tokens WHERE token_hash = $1 RETURNING user_id`, hash,
	).Scan(&userID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			// Unknown / already-revoked token. Idempotent silence; skip the
			// audit row to avoid log spam on bot traffic that fires logout
			// with stale cookies.
			return nil
		}
		// Surface real DB errors so the user (and operators) learn that the
		// server-side state was not actually mutated. Cookie-clearing in the
		// handler still runs because that lives in the response path.
		return fmt.Errorf("logout delete: %w", err)
	}
	userUUID, _ := pgUUIDToGoogle(userID)
	if userUUID == uuid.Nil {
		userUUID = uuid.UUID(userID.Bytes)
	}
	s.logAuthAuditBestEffort(context.WithoutCancel(ctx), AuthAuditEntry{
		UserID:     userUUID,
		Event:      "session.logged_out",
		EntityType: "session",
		EntityID:   userUUID,
	})
	return nil
}
