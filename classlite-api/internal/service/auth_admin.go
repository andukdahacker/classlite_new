// Package service — Story 1.5 AdminInviteStaff: canonical role
// re-validation guard (AC13 / SEC-1).
//
// AdminInviteStaff is the smallest mutating service method that exercises
// the "re-validate role from DB before mutating" pattern. Future mutating
// services (Epic 7 enrollment, Epic 9 billing, etc.) follow the same
// shape: read the membership row, return *ForbiddenError on miss /
// demotion, and audit the rejection.
//
// Why: a JWT's `role` claim can be up to 15 minutes stale relative to
// the DB (access-token TTL window per EDGE-2). Owner demotions take
// effect immediately on mutating endpoints because of this guard.
package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"time"

	"github.com/ducdo/classlite-api/internal/model"
	"github.com/ducdo/classlite-api/internal/store/generated"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

// inviteTTL is the placeholder lifetime applied to invite rows written by
// the AdminInviteStaff role-revalidation hook. The real invite flow
// (Epic 7) will replace this; until then the value just needs to be a
// realistic 7-day duration so dependent code doesn't immediately observe
// the row as expired.
const inviteTTL = 7 * 24 * time.Hour

// AdminInviteStaff inserts an invites row for `email` with `role`. The
// real invite flow (email delivery, accept endpoint, etc.) lands in
// Epic 7; this method exists so Story 1.5 can lock in the role
// re-validation pattern with a tested ATDD case.
func (s *AuthService) AdminInviteStaff(ctx context.Context, tc model.TenantContext, email, role string) error {
	// Parse the JWT-provided IDs. Validation errors here are programming
	// errors (middleware should never inject malformed strings), so map
	// them to 403 rather than 422 to be defensive.
	centerUUID, err := uuid.Parse(tc.CenterID)
	if err != nil {
		return &ForbiddenError{Reason: "invalid tenant context"}
	}
	userUUID, err := uuid.Parse(tc.UserID)
	if err != nil {
		return &ForbiddenError{Reason: "invalid tenant context"}
	}

	// Open the tx FIRST, then SET LOCAL app.current_tenant_id, then do
	// the role re-validation READ inside the tenant-scoped session. The
	// previous shape called GetCenterMemberByUserAndCenter via the bare
	// pool — relying on permissive RLS for the read — which would silently
	// start failing when policies tighten.
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin invite tx: %w", err)
	}
	defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }()

	// Use set_config(name, value, is_local) with a real parameter bind so
	// the value never reaches the SQL parser as concatenated string —
	// future copies of this pattern can't accidentally introduce an
	// injection vector even if the value isn't pre-validated as UUID.
	if _, err := tx.Exec(ctx,
		"SELECT set_config('app.current_tenant_id', $1::text, true)",
		centerUUID.String()); err != nil {
		return fmt.Errorf("set tenant local: %w", err)
	}

	txQ := generated.New(tx)
	member, err := txQ.GetCenterMemberByUserAndCenter(ctx, generated.GetCenterMemberByUserAndCenterParams{
		UserID:   pgtype.UUID{Bytes: userUUID, Valid: true},
		CenterID: pgtype.UUID{Bytes: centerUUID, Valid: true},
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			// Best-effort audit BEFORE rolling back the tx. We don't want
			// to keep the tx open while we wait on a network round-trip
			// to the audit subsystem.
			_ = tx.Rollback(context.WithoutCancel(ctx))
			s.auditRoleRevalidationBlocked(ctx, userUUID, tc.Role, "")
			return &ForbiddenError{Reason: "insufficient role"}
		}
		return fmt.Errorf("get center member: %w", err)
	}
	if member.Role != "owner" {
		_ = tx.Rollback(context.WithoutCancel(ctx))
		s.auditRoleRevalidationBlocked(ctx, userUUID, tc.Role, member.Role)
		return &ForbiddenError{Reason: "insufficient role"}
	}

	// Genuinely owner → write the invite. Token + expiry are placeholder
	// values — Epic 7 owns the real invite flow (email send + raw token
	// echo). Story 1.6 migrated invites.token → invites.token_hash so we
	// persist the sha256-hex; the raw token is currently discarded
	// because this synthetic hook doesn't email anyone.
	rawToken, err := newPasswordResetToken() // 32 random bytes, reuse helper
	if err != nil {
		return fmt.Errorf("invite token: %w", err)
	}
	tokenHashBytes := sha256.Sum256([]byte(rawToken))
	tokenHash := hex.EncodeToString(tokenHashBytes[:])
	now := s.clk.Now()
	if _, err := tx.Exec(ctx,
		`INSERT INTO invites (center_id, inviter_id, email, role, token_hash, expires_at)
		 VALUES ($1, $2, $3, $4, $5, $6)`,
		centerUUID, userUUID, email, role, tokenHash, now.Add(inviteTTL),
	); err != nil {
		return fmt.Errorf("insert invite: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit invite tx: %w", err)
	}
	return nil
}

// auditRoleRevalidationBlocked writes the rejection audit row.
func (s *AuthService) auditRoleRevalidationBlocked(ctx context.Context, userUUID uuid.UUID, jwtRole, dbRole string) {
	after := map[string]any{}
	if dbRole == "" {
		after["dbRole"] = nil
	} else {
		after["dbRole"] = dbRole
	}
	s.logAuthAuditBestEffort(context.WithoutCancel(ctx), AuthAuditEntry{
		UserID:     userUUID,
		Event:      "auth.role_revalidation_blocked",
		EntityType: "user",
		EntityID:   userUUID,
		Changes: Changes{
			Before: map[string]any{"jwtRole": jwtRole},
			After:  after,
		},
	})
}
