// Package service — Story 3.4 SessionService.
//
// Sessions are center-scoped calendar events with optional recurrence
// (materialized on create). The R19 mandate lives here: every MUTATION
// (update/cancel/delete) ANDs a `starts_at >= clk.Now()` floor onto its scope
// WHERE so past/completed occurrences are IMMUTABLE under every scope — reads
// still show history. Concurrency is optimistic: each mutation re-reads the
// target's updated_at in-tx and 409s on a stale expectedUpdatedAt; the whole
// scope op is one atomic tx.
//
// Authz (SEC-1, service-layer — never RLS): assertClassRole gates
// owner/admin/teacher (students → 403). A teacher may only touch sessions of a
// class assigned to them (classes.teacher_id = tc.UserID); otherwise 404
// SESSION_NOT_FOUND (teacher-sees-nothing, never 403).
package service

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/model"
	"github.com/ducdo/classlite-api/internal/store"
	"github.com/ducdo/classlite-api/internal/store/generated"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

const (
	sessionCreatedAction   = "session.created"
	sessionUpdatedAction   = "session.updated"
	sessionCancelledAction = "session.cancelled"
	sessionDeletedAction   = "session.deleted"
	sessionAuditEntity     = "session"

	sessionNotFoundCode = "SESSION_NOT_FOUND"
	sessionConflictCode = "SESSION_CONFLICT"

	scopeThis   = "this"
	scopeFuture = "future"
	scopeAll    = "all"

	sessionTopicMaxLen = 200
	// maxScheduleRangeDays caps a list window (Winston — no unbounded month×JOIN).
	maxScheduleRangeDays = 92
	// sessionMaxDurationMinutes caps a single session at 24h — an upper bound so
	// an absurd durationMinutes can't derive a far-future ends_at (CR-3-4 P11).
	sessionMaxDurationMinutes = 24 * 60
)

// SessionService owns the session CRUD + recurrence + scoped mutations.
type SessionService struct {
	db    AuthDB
	audit AuditLogger
	clk   clock.Clock
}

// NewSessionService constructs a SessionService. clk is the now()-floor source
// (deterministic in tests) that makes past sessions immutable.
func NewSessionService(db AuthDB, audit AuditLogger, clk clock.Clock) *SessionService {
	return &SessionService{db: db, audit: audit, clk: clk}
}

// --- inputs ---

// RecurrenceInput is the decoded recurrence sub-object of a create request.
type RecurrenceInput struct {
	Pattern  string
	Weekdays []int
	EndDate  *time.Time
}

// CreateSessionInput is the decoded POST body.
type CreateSessionInput struct {
	ClassID         uuid.UUID
	Topic           *string
	StartsAt        time.Time
	DurationMinutes int32
	Recurrence      RecurrenceInput
}

// UpdateSessionInput is the decoded PATCH body (field edits + scope + optimistic guard).
type UpdateSessionInput struct {
	Topic             *string
	StartsAt          *time.Time
	DurationMinutes   *int32
	ClassID           *uuid.UUID
	ApplyScope        string
	ExpectedUpdatedAt time.Time
}

// CancelSessionInput is the decoded cancel body.
type CancelSessionInput struct {
	ApplyScope        string
	ExpectedUpdatedAt time.Time
}

// --- results ---

// CreateSessionsResult is the POST /api/sessions payload. First is re-read with
// the class JOIN so the wire Session carries className/classColor.
type CreateSessionsResult struct {
	RecurrenceGroupID *uuid.UUID
	Count             int
	First             generated.GetSessionByIDRow
}

// SeriesCounts is the GET /{id} scope-UI oracle.
type SeriesCounts struct {
	GroupID   *uuid.UUID
	Total     int64
	Upcoming  int64
	Completed int64
}

// --- helpers ---

// sessionNotFound is the canonical 404 for an absent OR teacher-invisible session.
func sessionNotFound(id uuid.UUID) error {
	return model.NotFoundError{Resource: "session", ID: id.String(), Code: sessionNotFoundCode}
}

// sessionConflict is the 409 raised when a mutation's expectedUpdatedAt is stale.
func sessionConflict() error {
	return model.ConflictError{Code: sessionConflictCode, Message: "session was modified by someone else"}
}

// assertSessionTeacherScope enforces cross-teacher isolation: a teacher may only
// touch sessions of a class assigned to them; else 404 (never 403). Owner/admin
// are center-wide. RLS has already tenant-scoped the row.
func assertSessionTeacherScope(tc model.TenantContext, classTeacherID pgtype.UUID, sessionID uuid.UUID) error {
	if tc.Role != model.RoleTeacher {
		return nil
	}
	if !classTeacherID.Valid || uuidStringFromPg(classTeacherID) != tc.UserID {
		return sessionNotFound(sessionID)
	}
	return nil
}

// validScope reports whether s is one of the three "Apply to…" scopes.
func validScope(s string) bool {
	return s == scopeThis || s == scopeFuture || s == scopeAll
}

// readInTenantTx opens a tenant-scoped tx (SET LOCAL app.current_tenant_id, a
// tx is required even for reads — PERF-1), runs fn, and commits.
func (s *SessionService) readInTenantTx(
	ctx context.Context, tc model.TenantContext, fn func(*generated.Queries) error,
) error {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return fmt.Errorf("session read tx: begin: %w", err)
	}
	defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }()

	if err := store.SetTenantContext(ctx, tx, tc); err != nil {
		return fmt.Errorf("session read tx: %w", err)
	}
	if err := fn(generated.New(tx)); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// mutateInTenantTx opens a tenant-scoped tx and runs fn with both the tx (for
// audit.LogWithinTx) and the tx-bound queries. Commits iff fn returns nil.
func (s *SessionService) mutateInTenantTx(
	ctx context.Context, tc model.TenantContext, fn func(tx pgx.Tx, txQ *generated.Queries) error,
) error {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return fmt.Errorf("session mutate tx: begin: %w", err)
	}
	defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }()

	if err := store.SetTenantContext(ctx, tx, tc); err != nil {
		return fmt.Errorf("session mutate tx: %w", err)
	}
	if err := fn(tx, generated.New(tx)); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// sessionRowSnapshot renders the forensically-useful fields of a session row for
// an audit entry (mirrors classAuditSnapshot).
func sessionRowSnapshot(r generated.GetSessionByIDRow) map[string]any {
	return map[string]any{
		"class_id":            uuidStringFromPg(r.ClassID),
		"topic":               textOrNil(r.Topic),
		"starts_at":           timestamptzOrNil(r.StartsAt),
		"ends_at":             timestamptzOrNil(r.EndsAt),
		"status":              r.Status,
		"recurrence_group_id": uuidOrNil(r.RecurrenceGroupID),
		"recurrence_pattern":  textOrNil(r.RecurrencePattern),
	}
}

func timestamptzOrNil(t pgtype.Timestamptz) any {
	if !t.Valid {
		return nil
	}
	return t.Time.Format(time.RFC3339Nano)
}

// loadTarget reads the mutation target inside tx, enforces teacher-scope, and
// applies the optimistic-concurrency guard. Returns the target row.
func (s *SessionService) loadTarget(
	ctx context.Context, txQ *generated.Queries, tc model.TenantContext,
	sessionID uuid.UUID, expectedUpdatedAt time.Time,
) (generated.GetSessionByIDRow, error) {
	// Take the row lock first so the guard re-read below is atomic against a
	// concurrent scope write (CR-3-4 P4).
	if _, err := txQ.LockSession(ctx, pgUUID(sessionID)); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return generated.GetSessionByIDRow{}, sessionNotFound(sessionID)
		}
		return generated.GetSessionByIDRow{}, fmt.Errorf("lock session target: %w", err)
	}
	row, err := txQ.GetSessionByID(ctx, pgUUID(sessionID))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return generated.GetSessionByIDRow{}, sessionNotFound(sessionID)
		}
		return generated.GetSessionByIDRow{}, fmt.Errorf("load session target: %w", err)
	}
	if err := assertSessionTeacherScope(tc, row.ClassTeacherID, sessionID); err != nil {
		return generated.GetSessionByIDRow{}, err
	}
	if !row.UpdatedAt.Valid || !row.UpdatedAt.Time.Equal(expectedUpdatedAt) {
		return generated.GetSessionByIDRow{}, sessionConflict()
	}
	return row, nil
}

// resolveScope collapses a non-recurring target to 'this' (scope is ignored for
// one-offs) and rejects a past 'this' target as immutable (422).
func resolveScope(row generated.GetSessionByIDRow, scope string, now time.Time) (string, error) {
	if !row.RecurrenceGroupID.Valid {
		scope = scopeThis
	}
	if scope == scopeThis && row.StartsAt.Valid && row.StartsAt.Time.Before(now) {
		return "", &SessionAlreadyStartedError{}
	}
	return scope, nil
}
