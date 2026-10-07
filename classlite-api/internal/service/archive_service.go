// Package service — Story 10.2 ArchiveService.
//
// The /archive read model: ONE role-scoped, honestly-DB-paginated read over the
// REVERSED filters of the shipped library/class reads — soft-deleted exercises
// (`deleted_at IS NOT NULL`, the inverse of every exercise read) and ended-≥30-
// days classes (`status='ended' AND ended_at <= now()-30d`). See archive.sql.
//
// Authz (SEC-1, service-layer — never RLS):
//   - assertClassRole gates owner/admin/teacher; a student → 403 INSUFFICIENT_ROLE
//     (defense-in-depth; the prod route also sits on the staff chain).
//   - Role SCOPE is a service invariant, NOT RLS (DD5): two teachers in one center
//     share center_id, so RLS does not isolate them. A teacher binds its own
//     per-branch predicate (exercises.created_by / classes.teacher_id = caller)
//     via @teacher_id; owner/admin pass NULL (center-wide). A cross-teacher item is
//     ABSENT by construction (and a cross-teacher Duplicate hits the shipped 404).
//   - The tenant boundary rides the existing classes/exercises FORCE-RLS grids:
//     every read runs inside a SET LOCAL app.current_tenant_id tx (GO-1/PERF-1).
//
// No new table, no new RLS policy — the archive is a live reversed filter (DD7),
// not a frozen snapshot.
package service

import (
	"context"
	"fmt"
	"math"
	"time"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/model"
	"github.com/ducdo/classlite-api/internal/store"
	"github.com/ducdo/classlite-api/internal/store/generated"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

const (
	// archiveClassGraceDays is the window a class stays in the ACTIVE list after
	// ending before it "moves to archive" (FR-14 + the PRD 30-day assumption, D2).
	// A configurable per-center period is FU-10-2-ARCHIVE-PERIOD-CONFIG.
	archiveClassGraceDays = 30 * 24 * time.Hour

	archiveTypeClass    = "class"
	archiveTypeExercise = "exercise"
)

// ArchiveService owns the role-scoped reversed-filter archive read.
type ArchiveService struct {
	db  AuthDB
	clk clock.Clock
}

// NewArchiveService wires the archive read service.
func NewArchiveService(db AuthDB, clk clock.Clock) *ArchiveService {
	return &ArchiveService{db: db, clk: clk}
}

// ArchiveListFilter carries the request inputs the handler parsed. Page/PageSize
// are clamped here (not trusted from the edge).
type ArchiveListFilter struct {
	Type     string // "" | "class" | "exercise"
	Page     int
	PageSize int
}

// ArchiveItem is one archived row (class or exercise), discriminated by Type.
// Per-type fields are nil for the other type (GO-5 explicit null on the wire via
// the handler response struct). ArchivedAt is the unified sort key (DD8): an
// exercise's deleted_at, a class's ended_at.
type ArchiveItem struct {
	Type        string
	ID          string
	Title       string
	Subtitle    string
	ArchivedAt  time.Time
	ClassStatus *string
	Skill       *string
	TargetBand  *float64
	Link        string
}

// List returns a role-scoped, UNION-paginated page of archived items plus
// pagination totals. An invalid Type → 422; a student → 403.
func (s *ArchiveService) List(
	ctx context.Context, tc model.TenantContext, f ArchiveListFilter,
) ([]ArchiveItem, PageResult, error) {
	if err := assertClassRole(tc); err != nil {
		return nil, PageResult{}, err
	}
	switch f.Type {
	case "", archiveTypeClass, archiveTypeExercise:
		// ok
	default:
		// A non-empty ?type must be a known archive type — an unknown value (e.g.
		// the deferred "session", Ducdo D1) is a 422, not a silent empty page.
		return nil, PageResult{}, model.ValidationError{
			Fields: []model.FieldError{{Field: "type", Message: "unknown archive type"}},
		}
	}

	// Clamp page BEFORE clampPagination's multiply so a crafted ?page=<huge> cannot
	// overflow, then clamp the resulting OFFSET into int32 range (sqlc Offset is
	// int32). The ListInbox / Story 5-2a guard; a page past any real archive simply
	// returns an empty page.
	page := f.Page
	if page > math.MaxInt32 {
		page = math.MaxInt32
	}
	page, pageSize, offset := clampPagination(page, f.PageSize)
	if offset > math.MaxInt32 {
		offset = math.MaxInt32
	}

	// Role branch (DD5): teacher → own only; owner/admin → NULL (center-wide).
	var teacherID pgtype.UUID // zero value Valid=false ⇒ @teacher_id IS NULL
	if tc.Role == model.RoleTeacher {
		uid, err := uuid.Parse(tc.UserID)
		if err != nil {
			return nil, PageResult{}, fmt.Errorf("list archive: parse user id: %w", err)
		}
		teacherID = pgUUID(uid)
	}
	cutoff := pgtype.Timestamptz{Time: s.clk.Now().Add(-archiveClassGraceDays), Valid: true}

	var items []ArchiveItem
	var total int64
	err := s.readInTenantTx(ctx, tc, func(q *generated.Queries) error {
		rows, lerr := q.ListArchive(ctx, generated.ListArchiveParams{
			TeacherID:  teacherID,
			TypeFilter: f.Type,
			Cutoff:     cutoff,
			PageLimit:  int32(pageSize),
			PageOffset: int32(offset),
		})
		if lerr != nil {
			return fmt.Errorf("list archive: %w", lerr)
		}
		total, lerr = q.CountArchive(ctx, generated.CountArchiveParams{
			TeacherID:  teacherID,
			TypeFilter: f.Type,
			Cutoff:     cutoff,
		})
		if lerr != nil {
			return fmt.Errorf("count archive: %w", lerr)
		}
		items = make([]ArchiveItem, len(rows))
		for i, r := range rows {
			items[i] = archiveItemFromRow(r)
		}
		return nil
	})
	if err != nil {
		return nil, PageResult{}, err
	}
	return items, pageResult(page, pageSize, total), nil
}

// archiveItemFromRow maps a generated UNION row to the service DTO. The exercise
// link is the Edit-a-copy / detail target /exercises/{id}/edit (AC1); classes are
// read-only and carry no link. skill is ” for class rows (archive.sql) → nil.
func archiveItemFromRow(r generated.ListArchiveRow) ArchiveItem {
	item := ArchiveItem{
		Type:        r.Type,
		ID:          uuidStringFromPg(r.ID),
		Title:       r.Title,
		Subtitle:    r.Subtitle,
		ClassStatus: pgTextToPtr(r.ClassStatus),
		TargetBand:  numericToFloatPtr(r.TargetBand),
	}
	if r.ArchivedAt.Valid {
		item.ArchivedAt = r.ArchivedAt.Time
	}
	if r.Skill != "" {
		skill := r.Skill
		item.Skill = &skill
	}
	if r.Type == archiveTypeExercise {
		item.Link = "/exercises/" + item.ID + "/edit"
	}
	return item
}

// readInTenantTx runs fn inside a SET LOCAL app.current_tenant_id tx so RLS
// tenant-scopes both the exercises and classes branches of the archive read.
func (s *ArchiveService) readInTenantTx(
	ctx context.Context, tc model.TenantContext, fn func(*generated.Queries) error,
) error {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return fmt.Errorf("archive read tx: begin: %w", err)
	}
	defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }()

	if err := store.SetTenantContext(ctx, tx, tc); err != nil {
		return fmt.Errorf("archive read tx: %w", err)
	}
	if err := fn(generated.New(tx)); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
