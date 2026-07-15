// Package service — Story 2.5b RoomService.
// Owner-only CRUD on the `rooms` table.
//
// AC6: The DB layer enforces UNIQUE(center_id, LOWER(name)) via a unique
// index. sqlc surfaces the collision as *pgconn.PgError with Code=="23505";
// we map it to RoomNameTakenError → 409 ROOM_NAME_TAKEN in the mapper.
package service

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"unicode/utf8"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/model"
	"github.com/ducdo/classlite-api/internal/store"
	"github.com/ducdo/classlite-api/internal/store/generated"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"time"
)

const (
	auditActionRoomCreated = "center.room.created"
	auditActionRoomUpdated = "center.room.updated"
	auditActionRoomDeleted = "center.room.deleted"
	auditEntityTypeRoom    = "room"

	roomNameMaxLen        = 80
	roomDescriptionMaxLen = 240
	roomCapacityMin       = 1
	roomCapacityMax       = 500

	pgUniqueViolationCode = "23505"
)

type RoomService struct {
	db    AuthDB
	audit AuditLogger
	clk   clock.Clock
}

func NewRoomService(db AuthDB, audit AuditLogger, clk clock.Clock) *RoomService {
	return &RoomService{db: db, audit: audit, clk: clk}
}

type Room struct {
	ID          uuid.UUID
	CenterID    uuid.UUID
	Name        string
	Description *string
	Capacity    int32
	CreatedAt   time.Time
}

type CreateRoomInput struct {
	Name        string
	Description *string
	Capacity    int32
}

type UpdateRoomInput struct {
	Name        *string
	Description *string
	Capacity    *int32
	ClearFields []string // e.g. []string{"description"} to force description to NULL
}

func (s *RoomService) List(ctx context.Context, tc model.TenantContext) ([]Room, error) {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("list rooms: begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }()
	if err := store.SetTenantContext(ctx, tx, tc); err != nil {
		return nil, fmt.Errorf("list rooms: set tenant context: %w", err)
	}
	rows, err := generated.New(tx).ListRoomsByTenant(ctx)
	if err != nil {
		return nil, fmt.Errorf("list rooms: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("list rooms: commit: %w", err)
	}
	out := make([]Room, len(rows))
	for i, r := range rows {
		out[i] = roomRowToWire(r)
	}
	return out, nil
}

func (s *RoomService) Create(ctx context.Context, tc model.TenantContext, in CreateRoomInput) (*Room, error) {
	if err := validateRoomName(in.Name); err != nil {
		return nil, err
	}
	if err := validateRoomDescriptionAndCapacity(in.Description, &in.Capacity); err != nil {
		return nil, err
	}
	centerUUID, err := uuid.Parse(tc.CenterID)
	if err != nil {
		return nil, fmt.Errorf("create room: parse tenant center id: %w", err)
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("create room: begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }()
	if err := store.SetTenantContext(ctx, tx, tc); err != nil {
		return nil, fmt.Errorf("create room: set tenant context: %w", err)
	}

	q := generated.New(tx)
	newID := uuid.New()
	row, err := q.CreateRoom(ctx, generated.CreateRoomParams{
		ID:          pgUUID(newID),
		CenterID:    pgUUID(centerUUID),
		Name:        strings.TrimSpace(in.Name),
		Description: optionalTextTrim(in.Description),
		Capacity:    in.Capacity,
	})
	if err != nil {
		return nil, mapRoomWriteError(err, in.Name)
	}
	if err := s.audit.LogWithinTx(ctx, tx, tc,
		auditActionRoomCreated, auditEntityTypeRoom,
		newID, Changes{After: roomRowToAuditSnapshot(row)}); err != nil {
		return nil, fmt.Errorf("create room: audit: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("create room: commit: %w", err)
	}
	out := roomRowToWire(row)
	return &out, nil
}

func (s *RoomService) Update(ctx context.Context, tc model.TenantContext, id uuid.UUID, in UpdateRoomInput) (*Room, error) {
	// Nil name = PATCH omitted the field; non-nil-but-empty name is validated
	// as "at least 1 character" by validateRoomName (previously fell through
	// to the DB CHECK as a generic 500 via the `if name != ""` guard).
	// Amended /bmad-code-review 2-5b Round 1 P5 (2026-07-15).
	if in.Name != nil {
		if err := validateRoomName(*in.Name); err != nil {
			return nil, err
		}
	}
	if err := validateRoomDescriptionAndCapacity(in.Description, in.Capacity); err != nil {
		return nil, err
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("update room: begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }()
	if err := store.SetTenantContext(ctx, tx, tc); err != nil {
		return nil, fmt.Errorf("update room: set tenant context: %w", err)
	}

	q := generated.New(tx)
	before, err := q.GetRoomByID(ctx, pgUUID(id))
	if err != nil {
		return nil, mapRoomFetchError(err)
	}

	row, err := q.UpdateRoom(ctx, generated.UpdateRoomParams{
		ID:          pgUUID(id),
		ClearFields: in.ClearFields,
		Name:        optionalTextTrim(in.Name),
		Description: optionalTextTrim(in.Description),
		Capacity:    optionalInt4(in.Capacity),
	})
	if err != nil {
		return nil, mapRoomWriteError(err, strDeref(in.Name))
	}

	if err := s.audit.LogWithinTx(ctx, tx, tc,
		auditActionRoomUpdated, auditEntityTypeRoom,
		id, Changes{Before: roomRowToAuditSnapshot(before), After: roomRowToAuditSnapshot(row)}); err != nil {
		return nil, fmt.Errorf("update room: audit: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("update room: commit: %w", err)
	}
	out := roomRowToWire(row)
	return &out, nil
}

func (s *RoomService) Delete(ctx context.Context, tc model.TenantContext, id uuid.UUID) error {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return fmt.Errorf("delete room: begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }()
	if err := store.SetTenantContext(ctx, tx, tc); err != nil {
		return fmt.Errorf("delete room: set tenant context: %w", err)
	}

	q := generated.New(tx)
	before, err := q.GetRoomByID(ctx, pgUUID(id))
	if err != nil {
		return mapRoomFetchError(err)
	}

	// TODO(story-3-2): reject if referenced by sessions — return 409 ROOM_IN_USE.
	// Planted marker per Story 2-5b AC7. v1 always allows delete.
	rows, err := q.DeleteRoom(ctx, pgUUID(id))
	if err != nil {
		return fmt.Errorf("delete room: %w", err)
	}
	if rows == 0 {
		return model.NotFoundError{Code: "ROOM_NOT_FOUND", Resource: "room"}
	}
	if err := s.audit.LogWithinTx(ctx, tx, tc,
		auditActionRoomDeleted, auditEntityTypeRoom,
		id, Changes{Before: roomRowToAuditSnapshot(before)}); err != nil {
		return fmt.Errorf("delete room: audit: %w", err)
	}
	return tx.Commit(ctx)
}

func roomRowToWire(row generated.Room) Room {
	return Room{
		ID:          uuidFromPg(row.ID),
		CenterID:    uuidFromPg(row.CenterID),
		Name:        row.Name,
		Description: nullableTextPtr(row.Description),
		Capacity:    row.Capacity,
		CreatedAt:   row.CreatedAt.Time,
	}
}

type roomAuditSnapshot struct {
	Name        string  `json:"name"`
	Description *string `json:"description"`
	Capacity    int32   `json:"capacity"`
}

func roomRowToAuditSnapshot(row generated.Room) roomAuditSnapshot {
	return roomAuditSnapshot{
		Name:        row.Name,
		Description: nullableTextPtr(row.Description),
		Capacity:    row.Capacity,
	}
}

// validateRoomName rejects empty/whitespace-only names and overlength. Split
// out from the previous validateRoomInput so PATCH callers can invoke it
// only when Name is non-nil (nil = "leave column unchanged") without
// skipping the empty-string case. Amended /bmad-code-review 2-5b Round 1 P5.
func validateRoomName(name string) error {
	trimmed := strings.TrimSpace(name)
	count := utf8.RuneCountInString(trimmed)
	switch {
	case count < 1:
		return model.ValidationError{Fields: []model.FieldError{{Field: "name", Message: "must be at least 1 character"}}}
	case count > roomNameMaxLen:
		return model.ValidationError{Fields: []model.FieldError{{Field: "name", Message: fmt.Sprintf("must be at most %d characters", roomNameMaxLen)}}}
	}
	return nil
}

func validateRoomDescriptionAndCapacity(description *string, capacity *int32) error {
	var fields []model.FieldError
	if description != nil && *description != "" {
		trimmed := strings.TrimSpace(*description)
		if utf8.RuneCountInString(trimmed) > roomDescriptionMaxLen {
			fields = append(fields, model.FieldError{Field: "description", Message: fmt.Sprintf("must be at most %d characters", roomDescriptionMaxLen)})
		}
	}
	if capacity != nil {
		if *capacity < roomCapacityMin || *capacity > roomCapacityMax {
			fields = append(fields, model.FieldError{Field: "capacity", Message: fmt.Sprintf("must be between %d and %d", roomCapacityMin, roomCapacityMax)})
		}
	}
	if len(fields) > 0 {
		return model.ValidationError{Fields: fields}
	}
	return nil
}

func mapRoomFetchError(err error) error {
	if errors.Is(err, pgx.ErrNoRows) {
		return model.NotFoundError{Code: "ROOM_NOT_FOUND", Resource: "room"}
	}
	return fmt.Errorf("room fetch: %w", err)
}

// mapRoomWriteError catches SQLSTATE 23505 (unique_violation) from the
// UNIQUE(center_id, LOWER(name)) index and maps to RoomNameTakenError.
func mapRoomWriteError(err error, name string) error {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == pgUniqueViolationCode {
		return &RoomNameTakenError{Name: name}
	}
	if errors.Is(err, pgx.ErrNoRows) {
		return model.NotFoundError{Code: "ROOM_NOT_FOUND", Resource: "room"}
	}
	return fmt.Errorf("room write: %w", err)
}
