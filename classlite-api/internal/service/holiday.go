// Package service — Story 2.5b HolidayService.
// Owner-only CRUD on the `holidays` table. Same pattern as TermService:
// SET LOCAL tenant → sqlc query → audit-in-tx. See term.go for shared
// pgtype helpers (pgDate, optionalDate, etc.).
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
)

const (
	auditActionHolidayCreated = "center.holiday.created"
	auditActionHolidayUpdated = "center.holiday.updated"
	auditActionHolidayDeleted = "center.holiday.deleted"
	auditEntityTypeHoliday    = "holiday"

	holidayNameMaxLen = 120
)

// HolidayService owns the four /api/holidays endpoints.
type HolidayService struct {
	db    AuthDB
	audit AuditLogger
	clk   clock.Clock
}

func NewHolidayService(db AuthDB, audit AuditLogger, clk clock.Clock) *HolidayService {
	return &HolidayService{db: db, audit: audit, clk: clk}
}

// Holiday is the wire shape.
type Holiday struct {
	ID        uuid.UUID
	CenterID  uuid.UUID
	Name      string
	Date      time.Time
	CreatedAt time.Time
}

type CreateHolidayInput struct {
	Name string
	Date time.Time
}

type UpdateHolidayInput struct {
	Name *string
	Date *time.Time
}

func (s *HolidayService) List(ctx context.Context, tc model.TenantContext) ([]Holiday, error) {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("list holidays: begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }()
	if err := store.SetTenantContext(ctx, tx, tc); err != nil {
		return nil, fmt.Errorf("list holidays: set tenant context: %w", err)
	}
	rows, err := generated.New(tx).ListHolidaysByTenant(ctx)
	if err != nil {
		return nil, fmt.Errorf("list holidays: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("list holidays: commit: %w", err)
	}
	out := make([]Holiday, len(rows))
	for i, r := range rows {
		out[i] = holidayRowToWire(r)
	}
	return out, nil
}

func (s *HolidayService) Create(ctx context.Context, tc model.TenantContext, in CreateHolidayInput) (*Holiday, error) {
	if err := validateHolidayName(in.Name); err != nil {
		return nil, err
	}
	centerUUID, err := uuid.Parse(tc.CenterID)
	if err != nil {
		return nil, fmt.Errorf("create holiday: parse tenant center id: %w", err)
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("create holiday: begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }()
	if err := store.SetTenantContext(ctx, tx, tc); err != nil {
		return nil, fmt.Errorf("create holiday: set tenant context: %w", err)
	}

	q := generated.New(tx)
	newID := uuid.New()
	row, err := q.CreateHoliday(ctx, generated.CreateHolidayParams{
		ID:       pgUUID(newID),
		CenterID: pgUUID(centerUUID),
		Name:     strings.TrimSpace(in.Name),
		Date:     pgDate(in.Date),
	})
	if err != nil {
		return nil, fmt.Errorf("create holiday: insert: %w", err)
	}
	if err := s.audit.LogWithinTx(ctx, tx, tc,
		auditActionHolidayCreated, auditEntityTypeHoliday,
		newID, Changes{After: holidayRowToAuditSnapshot(row)}); err != nil {
		return nil, fmt.Errorf("create holiday: audit: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("create holiday: commit: %w", err)
	}
	out := holidayRowToWire(row)
	return &out, nil
}

func (s *HolidayService) Update(ctx context.Context, tc model.TenantContext, id uuid.UUID, in UpdateHolidayInput) (*Holiday, error) {
	if in.Name != nil {
		if err := validateHolidayName(*in.Name); err != nil {
			return nil, err
		}
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("update holiday: begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }()
	if err := store.SetTenantContext(ctx, tx, tc); err != nil {
		return nil, fmt.Errorf("update holiday: set tenant context: %w", err)
	}

	q := generated.New(tx)
	before, err := q.GetHolidayByID(ctx, pgUUID(id))
	if err != nil {
		return nil, mapHolidayFetchError(err)
	}
	row, err := q.UpdateHoliday(ctx, generated.UpdateHolidayParams{
		ID:   pgUUID(id),
		Name: optionalTextTrim(in.Name),
		Date: optionalDate(in.Date),
	})
	if err != nil {
		return nil, mapHolidayFetchError(err)
	}
	if err := s.audit.LogWithinTx(ctx, tx, tc,
		auditActionHolidayUpdated, auditEntityTypeHoliday,
		id, Changes{Before: holidayRowToAuditSnapshot(before), After: holidayRowToAuditSnapshot(row)}); err != nil {
		return nil, fmt.Errorf("update holiday: audit: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("update holiday: commit: %w", err)
	}
	out := holidayRowToWire(row)
	return &out, nil
}

func (s *HolidayService) Delete(ctx context.Context, tc model.TenantContext, id uuid.UUID) error {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return fmt.Errorf("delete holiday: begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }()
	if err := store.SetTenantContext(ctx, tx, tc); err != nil {
		return fmt.Errorf("delete holiday: set tenant context: %w", err)
	}
	q := generated.New(tx)
	before, err := q.GetHolidayByID(ctx, pgUUID(id))
	if err != nil {
		return mapHolidayFetchError(err)
	}
	rows, err := q.DeleteHoliday(ctx, pgUUID(id))
	if err != nil {
		return fmt.Errorf("delete holiday: %w", err)
	}
	if rows == 0 {
		return model.NotFoundError{Code: "HOLIDAY_NOT_FOUND", Resource: "holiday"}
	}
	if err := s.audit.LogWithinTx(ctx, tx, tc,
		auditActionHolidayDeleted, auditEntityTypeHoliday,
		id, Changes{Before: holidayRowToAuditSnapshot(before)}); err != nil {
		return fmt.Errorf("delete holiday: audit: %w", err)
	}
	return tx.Commit(ctx)
}

func holidayRowToWire(row generated.Holiday) Holiday {
	return Holiday{
		ID:        uuidFromPg(row.ID),
		CenterID:  uuidFromPg(row.CenterID),
		Name:      row.Name,
		Date:      row.Date.Time,
		CreatedAt: row.CreatedAt.Time,
	}
}

type holidayAuditSnapshot struct {
	Name string `json:"name"`
	Date string `json:"date"`
}

func holidayRowToAuditSnapshot(row generated.Holiday) holidayAuditSnapshot {
	return holidayAuditSnapshot{Name: row.Name, Date: row.Date.Time.Format("2006-01-02")}
}

func validateHolidayName(name string) error {
	trimmed := strings.TrimSpace(name)
	count := utf8.RuneCountInString(trimmed)
	if count < 1 {
		return model.ValidationError{Fields: []model.FieldError{{Field: "name", Message: "must be at least 1 character"}}}
	}
	if count > holidayNameMaxLen {
		return model.ValidationError{Fields: []model.FieldError{{Field: "name", Message: fmt.Sprintf("must be at most %d characters", holidayNameMaxLen)}}}
	}
	return nil
}

func mapHolidayFetchError(err error) error {
	if errors.Is(err, pgx.ErrNoRows) {
		return model.NotFoundError{Code: "HOLIDAY_NOT_FOUND", Resource: "holiday"}
	}
	return fmt.Errorf("holiday fetch: %w", err)
}
