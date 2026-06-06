// Package service — pre-tenant auth audit logger.
//
// Registration, email verification, and resend happen BEFORE a user has joined
// any center, so they cannot use the center-scoped AuditService (which requires
// a non-empty tenant context and writes to the RLS-protected audit_logs table).
// Story 1.4 AC13 / Option D introduces a separate auth_audit_logs table + this
// AuthAuditLogger interface for those events. Tenant-scoped events continue to
// use AuditService.
package service

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/ducdo/classlite-api/internal/model"
	"github.com/ducdo/classlite-api/internal/store/generated"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

// AuthAuditEntry is the input shape for AuthAuditLogger.Log.
// Changes reuses service.Changes from audit.go so the wire shape matches the
// tenant-scoped audit_logs table exactly — frontends can render either.
//
// Controlled event vocabulary (Story 1.4 + Story 1.5 — keep this list in sync
// with new emitters so the audit downstream knows every value to expect):
//
//	user.registered                 — Story 1.4 Register
//	user.email_verified             — Story 1.4 VerifyEmail
//	user.verification_resent        — Story 1.4 ResendVerification
//	login.failed                    — Story 1.5 Login wrong-password / unknown
//	login.locked_out                — Story 1.5 Login lockout rejection
//	login.succeeded                 — Story 1.5 Login success
//	session.refreshed               — Story 1.5 RefreshTokens success
//	session.logged_out              — Story 1.5 Logout
//	session.family_revoked          — Story 1.5 reuse-detection family revoke
//	password.reset_requested.hit    — Story 1.5 RequestPasswordReset known
//	password.reset_requested.miss   — Story 1.5 RequestPasswordReset unknown
//	password.reset_applied          — Story 1.5 ResetPassword
//	auth.role_revalidation_blocked  — Story 1.5 AdminInviteStaff blocked
//	invalid_tenant_claim            — Story 1.5 ExtractTenant forged center
type AuthAuditEntry struct {
	UserID     uuid.UUID
	Event      string
	EntityType string
	EntityID   uuid.UUID
	Changes    Changes
}

// AuthAuditLogger persists pre-tenant auth events. Errors must be tolerated by
// callers (audit is best-effort; user-facing requests succeed regardless).
type AuthAuditLogger interface {
	Log(ctx context.Context, entry AuthAuditEntry) error
}

// pgAuthAuditLogger writes to the auth_audit_logs table via sqlc-generated queries.
// No transaction is opened because the target table is NOT RLS-protected and the
// insert is a single round-trip (no PERF-1 concern). The db dependency uses the
// sqlc-generated DBTX interface, which is satisfied by *pgxpool.Pool (production)
// and *test.TxDB (integration tests).
type pgAuthAuditLogger struct {
	db generated.DBTX
}

// NewPgAuthAuditLogger constructs the production logger.
func NewPgAuthAuditLogger(db generated.DBTX) *pgAuthAuditLogger {
	return &pgAuthAuditLogger{db: db}
}

// Log persists one auth audit entry. The IP address is read from the request
// context (model.IPAddress key, set by middleware.ClientIP).
func (l *pgAuthAuditLogger) Log(ctx context.Context, entry AuthAuditEntry) error {
	changesJSON, err := json.Marshal(entry.Changes)
	if err != nil {
		return fmt.Errorf("auth audit log: marshal changes: %w", err)
	}

	ipParam := pgtype.Text{}
	if ip, ok := ctx.Value(model.IPAddress).(string); ok && ip != "" {
		ipParam = pgtype.Text{String: ip, Valid: true}
	}

	queries := generated.New(l.db)
	// Why: pre-user audit events (login.failed for unknown email, locked_out
	// before user lookup) have no user_id. Writing zero-UUID would violate
	// the auth_audit_logs.user_id FK; write NULL instead.
	var userParam pgtype.UUID
	if entry.UserID != uuid.Nil {
		userParam = pgtype.UUID{Bytes: entry.UserID, Valid: true}
	}
	var entityParam pgtype.UUID
	if entry.EntityID != uuid.Nil {
		entityParam = pgtype.UUID{Bytes: entry.EntityID, Valid: true}
	}
	err = queries.InsertAuthAuditLog(ctx, generated.InsertAuthAuditLogParams{
		UserID:     userParam,
		Event:      entry.Event,
		EntityType: entry.EntityType,
		EntityID:   entityParam,
		Changes:    changesJSON,
		IpAddress:  ipParam,
	})
	if err != nil {
		return fmt.Errorf("auth audit log: insert: %w", err)
	}
	return nil
}

