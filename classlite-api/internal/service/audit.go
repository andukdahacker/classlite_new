// Package service exposes the AuditService which records append-only audit
// entries for sensitive mutations (billing, enrollment, role changes, …).
package service

import (
	"context"
	"encoding/json"
	"fmt"
	"reflect"

	"github.com/ducdo/classlite-api/internal/model"
	"github.com/ducdo/classlite-api/internal/store"
	"github.com/ducdo/classlite-api/internal/store/generated"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

// Changes is the canonical payload shape persisted into audit_logs.changes.
// Include only the fields that actually changed — not the entire entity.
type Changes struct {
	Before any `json:"before"`
	After  any `json:"after"`
}

// txBeginner is the minimal Begin surface satisfied by both *pgxpool.Pool
// (production opens a real top-level transaction) and *test.TxDB (integration
// tests open a savepoint inside the outer test transaction). Beware: savepoint
// commits do NOT preserve the SET LOCAL set inside them once released — the
// outer transaction loses the value. Production paths are unaffected because
// the pool opens a fresh top-level tx per Log call.
type txBeginner interface {
	Begin(ctx context.Context) (pgx.Tx, error)
}

// AuditService writes audit entries within a per-call transaction so RLS
// (SET LOCAL app.current_tenant_id) is enforced (PERF-1, GO-1).
type AuditService struct {
	pool txBeginner
}

// NewAuditService constructs an AuditService bound to a transaction-capable
// database handle.
func NewAuditService(pool txBeginner) *AuditService {
	return &AuditService{pool: pool}
}

// Log persists a single audit entry. It opens its own transaction, sets the
// tenant context, and inserts under RLS. The caller supplies the changed
// fields; passing a typed Changes{Before, After} is recommended but any value
// that marshals to JSON is accepted.
func (s *AuditService) Log(
	ctx context.Context,
	tc model.TenantContext,
	action string,
	entityType string,
	entityID uuid.UUID,
	changes any,
) error {
	if action == "" {
		return model.ValidationError{Fields: []model.FieldError{{Field: "action", Message: "action is required"}}}
	}
	if entityType == "" {
		return model.ValidationError{Fields: []model.FieldError{{Field: "entity_type", Message: "entity_type is required"}}}
	}
	if tc.UserID == "" {
		return model.ValidationError{Fields: []model.FieldError{{Field: "user_id", Message: "user_id is required"}}}
	}

	userUUID, err := uuid.Parse(tc.UserID)
	if err != nil {
		return model.ValidationError{Fields: []model.FieldError{{Field: "user_id", Message: "user_id must be a valid UUID"}}}
	}
	centerUUID, err := uuid.Parse(tc.CenterID)
	if err != nil {
		return model.ValidationError{Fields: []model.FieldError{{Field: "center_id", Message: "center_id must be a valid UUID"}}}
	}

	changes = coalesceChanges(changes)
	changesJSON, err := json.Marshal(changes)
	if err != nil {
		return fmt.Errorf("audit log: marshal changes: %w", err)
	}

	ipAddress, _ := ctx.Value(model.IPAddress).(string)
	ipParam := pgtype.Text{}
	if ipAddress != "" {
		ipParam = pgtype.Text{String: ipAddress, Valid: true}
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("audit log: begin tx: %w", err)
	}
	// Rollback must succeed even if the request context is canceled — otherwise
	// pgx destroys the connection instead of returning it to the pool.
	defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }()

	if err := store.SetTenantContext(ctx, tx, tc); err != nil {
		return fmt.Errorf("audit log: %w", err)
	}

	queries := generated.New(tx)
	_, err = queries.InsertAuditLog(ctx, generated.InsertAuditLogParams{
		CenterID:   uuidToPg(centerUUID),
		UserID:     uuidToPg(userUUID),
		Action:     action,
		EntityType: entityType,
		EntityID:   uuidToPg(entityID),
		Changes:    changesJSON,
		IpAddress:  ipParam,
	})
	if err != nil {
		return fmt.Errorf("audit log: insert: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("audit log: commit: %w", err)
	}
	return nil
}

// coalesceChanges replaces both untyped nil and typed-nil pointers with an
// empty Changes value, so the persisted JSONB is always an object (`{}`),
// never the literal `null`.
func coalesceChanges(c any) any {
	if c == nil {
		return Changes{}
	}
	v := reflect.ValueOf(c)
	if v.Kind() == reflect.Ptr && v.IsNil() {
		return Changes{}
	}
	return c
}

func uuidToPg(id uuid.UUID) pgtype.UUID {
	return pgtype.UUID{Bytes: id, Valid: true}
}
