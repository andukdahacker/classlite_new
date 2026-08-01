// Package service — Story 5.1 AssignmentService.
//
// Assignments bind an exercise to a class with a deadline (FR-27). This service
// ships create + get + list + close/reopen. The submission lifecycle lives in
// SubmissionService; the FR-23 exercise lock lives in ExerciseService.
//
// Authz (SEC-1, service-layer — never RLS):
//   - Every mutating op re-validates the caller's role from center_members (NOT
//     the ≤15-min-stale JWT claim). Teacher/Admin/Owner may create + manage;
//     student → 403 INSUFFICIENT_ROLE.
//   - assertTeacherScope: a teacher touching a class they do not own gets 404
//     CLASS_NOT_FOUND (teacher-sees-nothing). Owner/Admin may assign any class.
//
// Reference validation (AC2): exerciseId/classId must resolve to live rows in the
// caller's center → 422 INVALID_REFERENCE (pre-checked; the FK 23503 is the belt).
package service

import (
	"context"
	"errors"
	"fmt"
	"math"
	"time"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/event"
	"github.com/ducdo/classlite-api/internal/model"
	"github.com/ducdo/classlite-api/internal/store"
	"github.com/ducdo/classlite-api/internal/store/generated"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
)

const (
	assignmentCreatedAction   = "assignment.created"
	assignmentStatusAction    = "assignment.status_changed"
	assignmentAuditEntity     = "assignment"
	assignmentNotFoundCode    = "ASSIGNMENT_NOT_FOUND"
	assignmentConflictCode    = "CONFLICT"
	assignmentStatusOpen      = "open"
	assignmentStatusClosed    = "closed"
	assignmentDefaultPageSize = 20
	assignmentMaxPageSize     = 100
	// assignmentMaxLatePenalty is the ceiling implied by the DB column type
	// late_penalty numeric(3,1) (max magnitude 99.9). Validated in-service so an
	// over-range value is a typed 422 rather than a Postgres 22003 → generic 500.
	assignmentMaxLatePenalty = 99.9
	// fkViolationPgErrorCode ("23503") is declared in class_crud.go (same package).
	// uniqueViolationPgErrorCode ("23505") is declared in auth.go (same package).
)

var validAssignmentStatuses = map[string]bool{
	assignmentStatusOpen:   true,
	assignmentStatusClosed: true,
}

// AssignmentService owns assignment CRUD + close/reopen.
type AssignmentService struct {
	db     AuthDB
	audit  AuditLogger
	events *event.Bus
	clk    clock.Clock
}

// NewAssignmentService constructs an AssignmentService. events may be nil (a
// nil-safe Publish is skipped) — production wires a shared bus in main.go.
func NewAssignmentService(db AuthDB, audit AuditLogger, events *event.Bus, clk clock.Clock) *AssignmentService {
	return &AssignmentService{db: db, audit: audit, events: events, clk: clk}
}

// --- inputs / outputs ---

// CreateAssignmentInput is the decoded create payload (AC1).
type CreateAssignmentInput struct {
	ExerciseID     uuid.UUID
	ClassID        uuid.UUID
	DeadlineAt     time.Time
	HardDeadlineAt *time.Time
	Instructions   *string
	LatePenalty    *float64
}

// assignmentNotFound is the 404 for an absent/cross-tenant/out-of-scope row.
func assignmentNotFound(id uuid.UUID) error {
	return model.NotFoundError{Resource: "assignment", ID: id.String(), Code: assignmentNotFoundCode}
}

// assertMutatingAssignmentRole re-fetches the caller's center-member role (SEC-1)
// and confirms it is owner/admin/teacher. A stale-JWT student or a demoted user
// is 403 INSUFFICIENT_ROLE. It RETURNS the revalidated DB role so the caller can
// scope-narrow on the authoritative role rather than the ≤15-min-stale JWT claim
// (a demoted admin→teacher must still be teacher-scoped; a promoted student→teacher
// must not retain student-wide access).
func assertMutatingAssignmentRole(ctx context.Context, txQ *generated.Queries, tc model.TenantContext) (model.Role, error) {
	centerUUID, err := uuid.Parse(tc.CenterID)
	if err != nil {
		return "", &ForbiddenError{Reason: "invalid tenant context"}
	}
	userUUID, err := uuid.Parse(tc.UserID)
	if err != nil {
		return "", &ForbiddenError{Reason: "invalid tenant context"}
	}
	member, err := txQ.GetCenterMemberByUserAndCenter(ctx, generated.GetCenterMemberByUserAndCenterParams{
		UserID:   pgUUID(userUUID),
		CenterID: pgUUID(centerUUID),
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return "", &ForbiddenError{Reason: "insufficient role"}
		}
		return "", fmt.Errorf("assignment role revalidation: %w", err)
	}
	switch member.Role {
	case model.RoleOwner, model.RoleAdmin, model.RoleTeacher:
		return member.Role, nil
	default:
		return "", &ForbiddenError{Reason: "insufficient role"}
	}
}

// Create inserts an assignment (AC1–4). One atomic tenant tx: role re-fetch →
// class-in-center + teacher-scope → exercise-in-center → insert → audit. The
// event fires after commit.
func (s *AssignmentService) Create(
	ctx context.Context, tc model.TenantContext, in CreateAssignmentInput,
) (generated.Assignment, error) {
	if err := assertClassRole(tc); err != nil {
		return generated.Assignment{}, err
	}
	// Deadline coherence (AC4) — mirrors the DB CHECK so the client gets a typed
	// 422 rather than a 500 off a constraint violation.
	if in.HardDeadlineAt != nil && in.HardDeadlineAt.Before(in.DeadlineAt) {
		return generated.Assignment{}, &InvalidDeadlineError{}
	}
	penalty := 0.0
	if in.LatePenalty != nil {
		penalty = *in.LatePenalty
	}
	if penalty < 0 {
		return generated.Assignment{}, model.ValidationError{Fields: []model.FieldError{{
			Field: "latePenalty", Code: "INVALID_LATE_PENALTY", Message: "late penalty must be >= 0",
		}}}
	}
	if penalty > assignmentMaxLatePenalty {
		// Bound the top end too: late_penalty numeric(3,1) overflows at 100 →
		// Postgres 22003, which is not a mapped arm → 500 on contract-valid input.
		return generated.Assignment{}, model.ValidationError{Fields: []model.FieldError{{
			Field: "latePenalty", Code: "INVALID_LATE_PENALTY", Message: "late penalty must be <= 99.9",
		}}}
	}
	penaltyNumeric, err := floatToNumeric(penalty)
	if err != nil {
		return generated.Assignment{}, fmt.Errorf("create assignment: penalty: %w", err)
	}
	centerUUID, err := uuid.Parse(tc.CenterID)
	if err != nil {
		return generated.Assignment{}, &ForbiddenError{Reason: "invalid tenant context"}
	}
	createdBy, err := uuid.Parse(tc.UserID)
	if err != nil {
		return generated.Assignment{}, &ForbiddenError{Reason: "invalid tenant context"}
	}

	var created generated.Assignment
	err = s.mutateInAssignmentTx(ctx, tc, func(tx pgx.Tx, txQ *generated.Queries) error {
		role, rerr := assertMutatingAssignmentRole(ctx, txQ, tc)
		if rerr != nil {
			return rerr
		}
		// Scope-narrow on the revalidated DB role, NOT the stale JWT claim (SEC-1).
		scopeTC := tc
		scopeTC.Role = role
		// classId must resolve in the caller's center (RLS scopes the read); a
		// miss is a bad reference (422), a teacher-scope miss is 404 (AC2/AC3).
		class, cerr := txQ.GetClassByID(ctx, pgUUID(in.ClassID))
		if cerr != nil {
			if errors.Is(cerr, pgx.ErrNoRows) {
				return &InvalidReferenceError{Field: "classId"}
			}
			return fmt.Errorf("create assignment: get class: %w", cerr)
		}
		if serr := assertTeacherScope(scopeTC, class, in.ClassID); serr != nil {
			return serr
		}
		// exerciseId must resolve to a non-deleted exercise in the center (AC2).
		if _, eerr := txQ.GetExerciseByID(ctx, pgUUID(in.ExerciseID)); eerr != nil {
			if errors.Is(eerr, pgx.ErrNoRows) {
				return &InvalidReferenceError{Field: "exerciseId"}
			}
			return fmt.Errorf("create assignment: get exercise: %w", eerr)
		}

		row, ierr := txQ.CreateAssignment(ctx, generated.CreateAssignmentParams{
			CenterID:       pgUUID(centerUUID),
			ExerciseID:     pgUUID(in.ExerciseID),
			ClassID:        pgUUID(in.ClassID),
			CreatedBy:      pgUUID(createdBy),
			DeadlineAt:     pgTimestamptz(in.DeadlineAt),
			HardDeadlineAt: optTimestamptz(in.HardDeadlineAt),
			Instructions:   optText(in.Instructions),
			LatePenalty:    penaltyNumeric,
		})
		if ierr != nil {
			// FK 23503 belt (a class/exercise deleted between the pre-check and the
			// insert) → typed 422, never a 500 (AC2).
			var pgErr *pgconn.PgError
			if errors.As(ierr, &pgErr) && pgErr.Code == fkViolationPgErrorCode {
				return &InvalidReferenceError{Field: "reference"}
			}
			return fmt.Errorf("create assignment: insert: %w", ierr)
		}
		changes := Changes{After: map[string]any{
			"exercise_id": in.ExerciseID.String(),
			"class_id":    in.ClassID.String(),
			"status":      row.Status,
			"deadline_at": row.DeadlineAt.Time,
		}}
		if aerr := s.audit.LogWithinTx(ctx, tx, tc, assignmentCreatedAction, assignmentAuditEntity, uuidFromPg(row.ID), changes); aerr != nil {
			return fmt.Errorf("create assignment: audit: %w", aerr)
		}
		created = row
		return nil
	})
	if err != nil {
		return generated.Assignment{}, err
	}
	s.publish(ctx, event.AssignmentCreated, tc, map[string]any{"assignmentId": uuidFromPg(created.ID).String()})
	return created, nil
}

// GetByID returns a single assignment (AC6), center- + teacher-scoped.
func (s *AssignmentService) GetByID(
	ctx context.Context, tc model.TenantContext, id uuid.UUID,
) (generated.Assignment, error) {
	if err := assertClassRole(tc); err != nil {
		return generated.Assignment{}, err
	}
	var out generated.Assignment
	err := s.readInAssignmentTx(ctx, tc, func(txQ *generated.Queries) error {
		row, gerr := txQ.GetAssignmentByID(ctx, pgUUID(id))
		if gerr != nil {
			if errors.Is(gerr, pgx.ErrNoRows) {
				return assignmentNotFound(id)
			}
			return fmt.Errorf("get assignment: %w", gerr)
		}
		if serr := s.assertAssignmentTeacherScope(ctx, txQ, tc, row, id); serr != nil {
			return serr
		}
		out = row
		return nil
	})
	if err != nil {
		return generated.Assignment{}, err
	}
	return out, nil
}

// ListByClass returns a class's assignments, paginated (AC6).
func (s *AssignmentService) ListByClass(
	ctx context.Context, tc model.TenantContext, classID uuid.UUID, page, pageSize int,
) ([]generated.Assignment, int, int, int, error) {
	if err := assertClassRole(tc); err != nil {
		return nil, 0, 0, 0, err
	}
	// Normalize here and RETURN the clamped page/pageSize so the handler builds its
	// pagination meta from the effective values (an over-cap pageSize or a negative
	// page must not be echoed back verbatim in the meta / totalPages).
	page, pageSize = normalizeAssignmentPaging(page, pageSize)
	// Compute OFFSET in int64 and clamp to int32 range: a huge page must yield an
	// empty page, not overflow the int32 param into a negative OFFSET → 500.
	offset := int64(page-1) * int64(pageSize)
	if offset > math.MaxInt32 {
		offset = math.MaxInt32
	}

	var rows []generated.Assignment
	var total int64
	err := s.readInAssignmentTx(ctx, tc, func(txQ *generated.Queries) error {
		class, cerr := txQ.GetClassByID(ctx, pgUUID(classID))
		if cerr != nil {
			if errors.Is(cerr, pgx.ErrNoRows) {
				return classNotFound(classID)
			}
			return fmt.Errorf("list assignments: get class: %w", cerr)
		}
		if serr := assertTeacherScope(tc, class, classID); serr != nil {
			return serr
		}
		list, lerr := txQ.ListAssignmentsByClass(ctx, generated.ListAssignmentsByClassParams{
			ClassID:    pgUUID(classID),
			PageLimit:  int32(pageSize),
			PageOffset: int32(offset),
		})
		if lerr != nil {
			return fmt.Errorf("list assignments: query: %w", lerr)
		}
		count, cierr := txQ.CountAssignmentsByClass(ctx, pgUUID(classID))
		if cierr != nil {
			return fmt.Errorf("list assignments: count: %w", cierr)
		}
		rows = list
		total = count
		return nil
	})
	if err != nil {
		return nil, 0, 0, 0, err
	}
	return rows, int(total), page, pageSize, nil
}

// UpdateStatus closes or reopens an assignment (AC5). Compare-and-swap on the
// current status; a no-op transition or a lost race → 409 CONFLICT. Reopen never
// touches the deadlines (the query SETs status + updated_at only — D11).
func (s *AssignmentService) UpdateStatus(
	ctx context.Context, tc model.TenantContext, id uuid.UUID, target string,
) (generated.Assignment, error) {
	if err := assertClassRole(tc); err != nil {
		return generated.Assignment{}, err
	}
	if !validAssignmentStatuses[target] {
		return generated.Assignment{}, model.ValidationError{Fields: []model.FieldError{{
			Field: "status", Code: "INVALID_STATUS", Message: "status must be open or closed",
		}}}
	}
	var updated generated.Assignment
	err := s.mutateInAssignmentTx(ctx, tc, func(tx pgx.Tx, txQ *generated.Queries) error {
		role, rerr := assertMutatingAssignmentRole(ctx, txQ, tc)
		if rerr != nil {
			return rerr
		}
		// Scope-narrow on the revalidated DB role, NOT the stale JWT claim (SEC-1).
		scopeTC := tc
		scopeTC.Role = role
		current, gerr := txQ.GetAssignmentByID(ctx, pgUUID(id))
		if gerr != nil {
			if errors.Is(gerr, pgx.ErrNoRows) {
				return assignmentNotFound(id)
			}
			return fmt.Errorf("update assignment status: get: %w", gerr)
		}
		if serr := s.assertAssignmentTeacherScope(ctx, txQ, scopeTC, current, id); serr != nil {
			return serr
		}
		if current.Status == target {
			// No-op flip (open→open / closed→closed) → 409 (AC5).
			return model.ConflictError{Resource: "assignment", ID: id.String(), Code: assignmentConflictCode,
				Message: "assignment is already in the requested status"}
		}
		row, uerr := txQ.UpdateAssignmentStatus(ctx, generated.UpdateAssignmentStatusParams{
			ID:             pgUUID(id),
			NewStatus:      target,
			ExpectedStatus: current.Status,
		})
		if uerr != nil {
			if errors.Is(uerr, pgx.ErrNoRows) {
				// Lost the compare-and-swap race to a concurrent transition.
				return model.ConflictError{Resource: "assignment", ID: id.String(), Code: assignmentConflictCode,
					Message: "assignment status changed concurrently; reload and retry"}
			}
			return fmt.Errorf("update assignment status: swap: %w", uerr)
		}
		changes := Changes{
			Before: map[string]any{"status": current.Status},
			After:  map[string]any{"status": row.Status},
		}
		if aerr := s.audit.LogWithinTx(ctx, tx, tc, assignmentStatusAction, assignmentAuditEntity, uuidFromPg(row.ID), changes); aerr != nil {
			return fmt.Errorf("update assignment status: audit: %w", aerr)
		}
		updated = row
		return nil
	})
	if err != nil {
		return generated.Assignment{}, err
	}
	return updated, nil
}

// assertAssignmentTeacherScope 404s a teacher touching an assignment whose class
// they do not own (teacher-sees-nothing). Owner/Admin pass. It looks the class up
// (RLS-scoped) to read teacher_id.
func (s *AssignmentService) assertAssignmentTeacherScope(
	ctx context.Context, txQ *generated.Queries, tc model.TenantContext, a generated.Assignment, id uuid.UUID,
) error {
	if tc.Role != model.RoleTeacher {
		return nil
	}
	class, err := txQ.GetClassByID(ctx, a.ClassID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return assignmentNotFound(id)
		}
		return fmt.Errorf("assignment teacher scope: get class: %w", err)
	}
	if !class.TeacherID.Valid || uuidStringFromPg(class.TeacherID) != tc.UserID {
		return assignmentNotFound(id)
	}
	return nil
}

// pgTimestamptz wraps a non-null time. optTimestamptz maps a nil *time.Time to a
// SQL NULL. Shared across the assignment + submission services (same package).
func pgTimestamptz(t time.Time) pgtype.Timestamptz {
	return pgtype.Timestamptz{Time: t, Valid: true}
}

func optTimestamptz(t *time.Time) pgtype.Timestamptz {
	if t == nil {
		return pgtype.Timestamptz{Valid: false}
	}
	return pgtype.Timestamptz{Time: *t, Valid: true}
}

func normalizeAssignmentPaging(page, pageSize int) (int, int) {
	if page < 1 {
		page = 1
	}
	if pageSize < 1 {
		pageSize = assignmentDefaultPageSize
	}
	if pageSize > assignmentMaxPageSize {
		pageSize = assignmentMaxPageSize
	}
	return page, pageSize
}

func (s *AssignmentService) publish(ctx context.Context, eventType string, tc model.TenantContext, payload any) {
	if s.events == nil {
		return
	}
	s.events.Publish(ctx, event.Event{
		Type:      eventType,
		CenterID:  tc.CenterID,
		UserID:    tc.UserID,
		Payload:   payload,
		Timestamp: s.clk.Now(),
	})
}

func (s *AssignmentService) readInAssignmentTx(
	ctx context.Context, tc model.TenantContext, fn func(*generated.Queries) error,
) error {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return fmt.Errorf("assignment read tx: begin: %w", err)
	}
	defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }()
	if err := store.SetTenantContext(ctx, tx, tc); err != nil {
		return fmt.Errorf("assignment read tx: %w", err)
	}
	if err := fn(generated.New(tx)); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (s *AssignmentService) mutateInAssignmentTx(
	ctx context.Context, tc model.TenantContext, fn func(tx pgx.Tx, txQ *generated.Queries) error,
) error {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return fmt.Errorf("assignment mutate tx: begin: %w", err)
	}
	defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }()
	if err := store.SetTenantContext(ctx, tx, tc); err != nil {
		return fmt.Errorf("assignment mutate tx: %w", err)
	}
	if err := fn(tx, generated.New(tx)); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
