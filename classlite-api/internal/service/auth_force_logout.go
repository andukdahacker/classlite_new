// Package service — Story 1.6 ForceLogout (FR-80).
//
// Owner-initiated session revocation: bulk-delete every refresh_tokens
// row for a target user. Documented limitation per EDGE-2: the
// access tokens already issued remain valid for up to AccessTokenTTL
// (15 min). The access-token tail window is the accepted tradeoff —
// a real per-request blocklist is unbounded in cost. The audit row
// carries `accessTokenTailWindowSeconds` so audit consumers can see
// the residual exposure.
//
// R1 + R6 invariant: cross-tenant attempts return 404 USER_NOT_FOUND,
// NEVER 403, because 403 confirms the target's existence — leakage
// across tenants is a hard contract violation. The audit row IS still
// written (forensic visibility for SOC scanning), but the HTTP
// response is identical to a genuinely non-existent UUID.
package service

import (
	"context"
	"errors"
	"fmt"

	"github.com/ducdo/classlite-api/internal/model"
	"github.com/ducdo/classlite-api/internal/store/generated"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

// ForceLogoutResult tells the handler how many sessions were revoked.
// Used as the JSON envelope payload for 200 responses.
type ForceLogoutResult struct {
	SessionsRevoked int
}

// ForceLogout implements AC6 + AC7.
//
// Order:
//  1. Open tx, SET LOCAL app.current_tenant_id (R1 invariant for the
//     membership-check read).
//  2. Membership check: target ∈ caller's center. Miss → 404 (NOT 403)
//     + cross-tenant audit row.
//  3. Caller role re-validation: actually-Owner? Miss → *ForbiddenError.
//  4. Bulk-delete refresh_tokens rows for target. Returns family IDs
//     so we know how many sessions died (used in audit + response).
//  5. Commit.
//  6. Post-commit audit with actor_user_id = caller, user_id = target.
func (s *AuthService) ForceLogout(ctx context.Context, tc model.TenantContext, targetUserID uuid.UUID) (*ForceLogoutResult, error) {
	centerUUID, err := uuid.Parse(tc.CenterID)
	if err != nil {
		return nil, &ForbiddenError{Reason: "invalid tenant context"}
	}
	callerUUID, err := uuid.Parse(tc.UserID)
	if err != nil {
		return nil, &ForbiddenError{Reason: "invalid tenant context"}
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("begin force-logout tx: %w", err)
	}
	defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }()

	if _, err := tx.Exec(ctx,
		"SELECT set_config('app.current_tenant_id', $1::text, true)",
		centerUUID.String(),
	); err != nil {
		return nil, fmt.Errorf("set tenant local: %w", err)
	}

	txQ := generated.New(tx)

	// AC7 — membership check is the tenant boundary. Cross-tenant target
	// returns NotFoundError so 403 can never leak existence.
	if _, err := txQ.GetCenterMemberByUserAndCenter(ctx, generated.GetCenterMemberByUserAndCenterParams{
		UserID:   pgtype.UUID{Bytes: targetUserID, Valid: true},
		CenterID: pgtype.UUID{Bytes: centerUUID, Valid: true},
	}); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			// Roll back the tx FIRST so the audit write (which runs on
			// a separate context) doesn't fight the tx that's about to
			// disappear from this method.
			_ = tx.Rollback(context.WithoutCancel(ctx))
			s.logAuthAuditBestEffort(context.WithoutCancel(ctx), AuthAuditEntry{
				UserID:      callerUUID, // the actor's id, since target is unknown to us in this tenant
				ActorUserID: callerUUID,
				Event:       "auth.force_logout_cross_tenant_attempt",
				EntityType:  "user",
				EntityID:    targetUserID,
				Changes: Changes{After: map[string]any{
					"targetUserId":   targetUserID.String(),
					"callerCenterId": tc.CenterID,
					"decision":       "blocked_via_404",
				}},
			})
			return nil, model.NotFoundError{Resource: "user", ID: targetUserID.String(), Code: "USER_NOT_FOUND"}
		}
		return nil, fmt.Errorf("get target membership: %w", err)
	}

	// SEC-1 — re-validate caller role from DB.
	callerMember, err := txQ.GetCenterMemberByUserAndCenter(ctx, generated.GetCenterMemberByUserAndCenterParams{
		UserID:   pgtype.UUID{Bytes: callerUUID, Valid: true},
		CenterID: pgtype.UUID{Bytes: centerUUID, Valid: true},
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, &ForbiddenError{Reason: "insufficient role"}
		}
		return nil, fmt.Errorf("get caller membership: %w", err)
	}
	if callerMember.Role != "owner" {
		return nil, &ForbiddenError{Reason: "insufficient role"}
	}

	// Bulk delete — RETURNING family_id per row so we can count for the
	// audit payload + response envelope.
	families, err := txQ.DeleteRefreshTokensByUserReturningFamilies(ctx, pgtype.UUID{Bytes: targetUserID, Valid: true})
	if err != nil {
		return nil, fmt.Errorf("delete refresh tokens: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit force-logout tx: %w", err)
	}

	// Post-commit audit. The target's actual access-token tail is between
	// 0 and AccessTokenTTL — we don't persist per-issuance JWT exp
	// timestamps, so the audit reports the conservative upper bound
	// (`maxAccessTokenTailWindowSeconds`). Audit consumers should read
	// this as "the longest the target could still authenticate" not
	// "the exact remaining time". A precise per-event `ceil(exp - now)`
	// would require persisting access-token issuance metadata, which
	// is deferred to a post-launch security-hardening story (same
	// queue as the refresh-token blocklist per EDGE-2).
	postCtx := context.WithoutCancel(ctx)
	maxAccessTail := int(AccessTokenTTL.Seconds())
	s.logAuthAuditBestEffort(postCtx, AuthAuditEntry{
		UserID:      targetUserID,
		ActorUserID: callerUUID,
		Event:       "auth.force_logout",
		EntityType:  "user",
		EntityID:    targetUserID,
		Changes: Changes{
			Before: map[string]any{"sessionsActive": len(families)},
			After: map[string]any{
				"sessionsActive":                  0,
				"maxAccessTokenTailWindowSeconds": maxAccessTail,
			},
		},
	})

	return &ForceLogoutResult{SessionsRevoked: len(families)}, nil
}
