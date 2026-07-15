// Package service — Story 2.5b TermService.
//
// Owner-only CRUD on the `terms` table. All queries run under
// SET LOCAL app.current_tenant_id so RLS filters cross-tenant reads and
// WITH CHECK enforces cross-tenant writes at the DB layer (Winston-B2).
//
// Every mutating op emits a `center.term.{created,updated,deleted}` audit
// row via AuditLogger.LogWithinTx in the SAME tx as the write (Story 2.1
// pattern; TEST-BE-4 discipline).
package service

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/model"
	"github.com/ducdo/classlite-api/internal/store"
	"github.com/ducdo/classlite-api/internal/store/generated"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

const (
	auditActionTermCreated = "center.term.created"
	auditActionTermUpdated = "center.term.updated"
	auditActionTermDeleted = "center.term.deleted"
	auditEntityTypeTerm    = "term"

	termNameMaxLen = 120
)

// TermService owns the four /api/terms endpoints for a single Owner.
type TermService struct {
	db    AuthDB
	audit AuditLogger
	clk   clock.Clock
}

// NewTermService constructs a TermService bound to the shared pool + audit.
func NewTermService(db AuthDB, audit AuditLogger, clk clock.Clock) *TermService {
	return &TermService{db: db, audit: audit, clk: clk}
}

// Term is the wire shape returned by list/get/create/update.
type Term struct {
	ID           uuid.UUID
	CenterID     uuid.UUID
	Name         string
	StartDate    time.Time
	EndDate      time.Time
	SessionCount *int32
	CreatedAt    time.Time
}

// CreateTermInput carries the caller's request body.
type CreateTermInput struct {
	Name         string
	StartDate    time.Time
	EndDate      time.Time
	SessionCount *int32
}

// UpdateTermInput carries the caller's partial-update request body. Nil
// pointers mean "leave the column unchanged" (COALESCE pattern in SQL).
// ClearFields (currently only "session_count") lets the handler distinguish
// wire-null from absent — the SQL query forces the column to NULL when the
// field name is present in the slice. Matches 2-5a rooms.description tri-
// state pattern amended by /bmad-code-review 2-5b Round 1 P12.
type UpdateTermInput struct {
	Name         *string
	StartDate    *time.Time
	EndDate      *time.Time
	SessionCount *int32
	ClearFields  []string
}

// List returns every term visible to the caller's tenant.
func (s *TermService) List(ctx context.Context, tc model.TenantContext) ([]Term, error) {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("list terms: begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }()

	if err := store.SetTenantContext(ctx, tx, tc); err != nil {
		return nil, fmt.Errorf("list terms: set tenant context: %w", err)
	}

	rows, err := generated.New(tx).ListTermsByTenant(ctx)
	if err != nil {
		return nil, fmt.Errorf("list terms: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("list terms: commit: %w", err)
	}

	out := make([]Term, len(rows))
	for i, r := range rows {
		out[i] = termRowToWire(r)
	}
	return out, nil
}

// Create validates + inserts + audits atomically.
func (s *TermService) Create(ctx context.Context, tc model.TenantContext, in CreateTermInput) (*Term, error) {
	// Create requires all three shape checks + cross-field date order.
	namePtr := in.Name
	if err := validateTermShape(&namePtr); err != nil {
		return nil, err
	}
	if in.EndDate.Before(in.StartDate) {
		return nil, model.ValidationError{Fields: []model.FieldError{{Field: "endDate", Message: "must be on or after startDate"}}}
	}
	centerUUID, err := uuid.Parse(tc.CenterID)
	if err != nil {
		return nil, fmt.Errorf("create term: parse tenant center id: %w", err)
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("create term: begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }()

	if err := store.SetTenantContext(ctx, tx, tc); err != nil {
		return nil, fmt.Errorf("create term: set tenant context: %w", err)
	}

	q := generated.New(tx)
	newID := uuid.New()
	row, err := q.CreateTerm(ctx, generated.CreateTermParams{
		ID:           pgUUID(newID),
		CenterID:     pgUUID(centerUUID),
		Name:         strings.TrimSpace(in.Name),
		StartDate:    pgDate(in.StartDate),
		EndDate:      pgDate(in.EndDate),
		SessionCount: optionalInt4(in.SessionCount),
	})
	if err != nil {
		return nil, fmt.Errorf("create term: insert: %w", err)
	}

	if err := s.audit.LogWithinTx(
		ctx, tx, tc,
		auditActionTermCreated, auditEntityTypeTerm,
		newID, Changes{After: termRowToAuditSnapshot(row)},
	); err != nil {
		return nil, fmt.Errorf("create term: audit: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("create term: commit: %w", err)
	}

	out := termRowToWire(row)
	return &out, nil
}

// Update fetches the pre-update snapshot, applies the partial update,
// writes an audit row, and returns the fresh row.
//
// Validation runs in two passes:
//   (1) shape checks on the provided fields alone (name length, non-empty
//       when present) — cheap, fails fast, no DB roundtrip;
//   (2) cross-field checks against the merged result — needs the pre-fetched
//       `before` so partial-updates that shift only startDate against a
//       persisted endDate (or vice-versa) still surface as 422 rather than
//       falling through to the DB CHECK as a generic 500.
// Amended /bmad-code-review 2-5b Round 1 P4 + P5 (2026-07-15).
func (s *TermService) Update(ctx context.Context, tc model.TenantContext, id uuid.UUID, in UpdateTermInput) (*Term, error) {
	// Pass 1 — shape checks on the fields the client actually sent.
	if err := validateTermShape(in.Name); err != nil {
		return nil, err
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("update term: begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }()

	if err := store.SetTenantContext(ctx, tx, tc); err != nil {
		return nil, fmt.Errorf("update term: set tenant context: %w", err)
	}

	q := generated.New(tx)
	before, err := q.GetTermByID(ctx, pgUUID(id))
	if err != nil {
		return nil, mapTermFetchError(err)
	}

	// Pass 2 — cross-field check on the merged view of the row post-update.
	mergedStart := before.StartDate.Time
	if in.StartDate != nil {
		mergedStart = *in.StartDate
	}
	mergedEnd := before.EndDate.Time
	if in.EndDate != nil {
		mergedEnd = *in.EndDate
	}
	if mergedEnd.Before(mergedStart) {
		return nil, model.ValidationError{Fields: []model.FieldError{{Field: "endDate", Message: "must be on or after startDate"}}}
	}

	row, err := q.UpdateTerm(ctx, generated.UpdateTermParams{
		ID:           pgUUID(id),
		ClearFields:  in.ClearFields,
		Name:         optionalTextTrim(in.Name),
		StartDate:    optionalDate(in.StartDate),
		EndDate:      optionalDate(in.EndDate),
		SessionCount: optionalInt4(in.SessionCount),
	})
	if err != nil {
		return nil, mapTermFetchError(err)
	}

	if err := s.audit.LogWithinTx(
		ctx, tx, tc,
		auditActionTermUpdated, auditEntityTypeTerm,
		id, Changes{Before: termRowToAuditSnapshot(before), After: termRowToAuditSnapshot(row)},
	); err != nil {
		return nil, fmt.Errorf("update term: audit: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("update term: commit: %w", err)
	}

	out := termRowToWire(row)
	return &out, nil
}

// Delete removes the row and writes an audit entry atomically.
func (s *TermService) Delete(ctx context.Context, tc model.TenantContext, id uuid.UUID) error {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return fmt.Errorf("delete term: begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }()

	if err := store.SetTenantContext(ctx, tx, tc); err != nil {
		return fmt.Errorf("delete term: set tenant context: %w", err)
	}

	q := generated.New(tx)
	before, err := q.GetTermByID(ctx, pgUUID(id))
	if err != nil {
		return mapTermFetchError(err)
	}
	rows, err := q.DeleteTerm(ctx, pgUUID(id))
	if err != nil {
		return fmt.Errorf("delete term: %w", err)
	}
	if rows == 0 {
		return model.NotFoundError{Code: "TERM_NOT_FOUND", Resource: "term"}
	}

	if err := s.audit.LogWithinTx(
		ctx, tx, tc,
		auditActionTermDeleted, auditEntityTypeTerm,
		id, Changes{Before: termRowToAuditSnapshot(before)},
	); err != nil {
		return fmt.Errorf("delete term: audit: %w", err)
	}
	return tx.Commit(ctx)
}

// -----------------------------------------------------------------------------
// Wire mapping + validation helpers
// -----------------------------------------------------------------------------

func termRowToWire(row generated.Term) Term {
	return Term{
		ID:           uuidFromPg(row.ID),
		CenterID:     uuidFromPg(row.CenterID),
		Name:         row.Name,
		StartDate:    row.StartDate.Time,
		EndDate:      row.EndDate.Time,
		SessionCount: nullableInt4Ptr(row.SessionCount),
		CreatedAt:    row.CreatedAt.Time,
	}
}

type termAuditSnapshot struct {
	Name         string  `json:"name"`
	StartDate    string  `json:"start_date"`
	EndDate      string  `json:"end_date"`
	SessionCount *int32  `json:"session_count"`
}

func termRowToAuditSnapshot(row generated.Term) termAuditSnapshot {
	return termAuditSnapshot{
		Name:         row.Name,
		StartDate:    row.StartDate.Time.Format("2006-01-02"),
		EndDate:      row.EndDate.Time.Format("2006-01-02"),
		SessionCount: nullableInt4Ptr(row.SessionCount),
	}
}

// validateTermShape checks the `name` field alone — reject empty (nil-safe
// for PATCH where name is optional), whitespace-only, and overlength. When
// name is nil the check is a no-op (PATCH omitted the field). Amended
// /bmad-code-review 2-5b Round 1 P5 (2026-07-15) — previously the empty
// string branch fell through to the DB CHECK as a generic 500 because the
// old `name != ""` guard skipped the length check for `{"name": ""}`.
func validateTermShape(name *string) error {
	if name == nil {
		return nil
	}
	trimmed := strings.TrimSpace(*name)
	count := utf8.RuneCountInString(trimmed)
	switch {
	case count < 1:
		return model.ValidationError{Fields: []model.FieldError{{Field: "name", Message: "must be at least 1 character"}}}
	case count > termNameMaxLen:
		return model.ValidationError{Fields: []model.FieldError{{Field: "name", Message: fmt.Sprintf("must be at most %d characters", termNameMaxLen)}}}
	}
	return nil
}

func mapTermFetchError(err error) error {
	if errors.Is(err, pgx.ErrNoRows) {
		return model.NotFoundError{Code: "TERM_NOT_FOUND", Resource: "term"}
	}
	return fmt.Errorf("term fetch: %w", err)
}

// -----------------------------------------------------------------------------
// pgtype helpers shared across Story 2-5b entities
// -----------------------------------------------------------------------------

func pgDate(t time.Time) pgtype.Date {
	return pgtype.Date{Time: t, Valid: true}
}

func optionalDate(p *time.Time) pgtype.Date {
	if p == nil {
		return pgtype.Date{Valid: false}
	}
	return pgtype.Date{Time: *p, Valid: true}
}

func optionalInt4(p *int32) pgtype.Int4 {
	if p == nil {
		return pgtype.Int4{Valid: false}
	}
	return pgtype.Int4{Int32: *p, Valid: true}
}

func nullableInt4Ptr(v pgtype.Int4) *int32 {
	if !v.Valid {
		return nil
	}
	x := v.Int32
	return &x
}

func optionalTextTrim(p *string) pgtype.Text {
	if p == nil {
		return pgtype.Text{Valid: false}
	}
	return pgtype.Text{String: strings.TrimSpace(*p), Valid: true}
}

func strDeref(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}
