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
type AuthAuditEntry struct {
	UserID     uuid.UUID
	Action     string
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
	err = queries.InsertAuthAuditLog(ctx, generated.InsertAuthAuditLogParams{
		UserID:     pgtype.UUID{Bytes: entry.UserID, Valid: true},
		Action:     entry.Action,
		EntityType: entry.EntityType,
		EntityID:   pgtype.UUID{Bytes: entry.EntityID, Valid: true},
		Changes:    changesJSON,
		IpAddress:  ipParam,
	})
	if err != nil {
		return fmt.Errorf("auth audit log: insert: %w", err)
	}
	return nil
}

