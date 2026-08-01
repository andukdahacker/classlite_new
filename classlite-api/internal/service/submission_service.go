// Package service — Story 5.1 SubmissionService.
//
// The submission lifecycle (FR-27, FR-31): start/resume → save-progress → submit,
// with server-side deadline + time-limit enforcement. 5.1 drives only
// in_progress → submitted; ai_processing/graded are Epic 6.
//
// Authz (SEC-1, service-layer — never RLS):
//   - Every write re-validates the caller is a `student` center-member (NOT the
//     ≤15-min-stale JWT) AND is actively enrolled in the assignment's class
//     (re-checked on start, progress, AND submit — a withdrawn student cannot
//     submit a stale in_progress row). Non-student → 403 INSUFFICIENT_ROLE;
//     not-enrolled → 403 NOT_ENROLLED.
//   - A student only ever touches their OWN submission (student_id = self); a
//     mismatch is 404 SUBMISSION_NOT_FOUND (no cross-student oracle).
//
// Concurrency (D10): submit takes GetAssignmentForUpdate (FOR UPDATE) to serialize
// against a concurrent close; start takes the SAME advisory lock the exercise-edit
// guard takes (keyed on exercise_id) to close the create-during-PATCH TOCTOU.
package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/model"
	"github.com/ducdo/classlite-api/internal/store"
	"github.com/ducdo/classlite-api/internal/store/generated"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

const (
	submissionCreatedAction    = "submission.created"
	submissionSubmittedAction  = "submission.submitted"
	submissionAuditEntity      = "submission"
	submissionNotFoundCode     = "SUBMISSION_NOT_FOUND"
	submissionStatusInProgress = "in_progress"

	// submissionTimeGrace is the slack added to the exercise time limit before a
	// /progress write is rejected (AC10) — absorbs network + clock skew so an
	// honest client saving at 0:00 is not spuriously blocked. Small on purpose:
	// the point is to stop a devtools/laggy-tab student editing long past the cap.
	submissionTimeGrace = 5 * time.Second
	// uniqueViolationPgErrorCode ("23505") is declared in auth.go (same package).
)

// SubmissionService owns the submission lifecycle.
type SubmissionService struct {
	db    AuthDB
	audit AuditLogger
	clk   clock.Clock
}

// NewSubmissionService constructs a SubmissionService.
func NewSubmissionService(db AuthDB, audit AuditLogger, clk clock.Clock) *SubmissionService {
	return &SubmissionService{db: db, audit: audit, clk: clk}
}

// SubmissionResult is the domain view returned to the handler: the row plus the
// server-anchored time budget (nil = untimed exercise) and, for Start, whether a
// fresh row was created (201) vs an existing in_progress resumed (200).
type SubmissionResult struct {
	Row               generated.Submission
	Content           json.RawMessage
	TimeBudgetSeconds *int
	Created           bool
}

func submissionNotFound(id uuid.UUID) error {
	return model.NotFoundError{Resource: "submission", ID: id.String(), Code: submissionNotFoundCode}
}

// submissionContentJSON runs the stored blob through the read-path ladder (AC19,
// D6 — read-transform-only, never written back for terminal rows) and returns the
// wire JSON. A corrupt blob is a 500 (default mapper arm), never a panic.
func submissionContentJSON(row generated.Submission) (json.RawMessage, error) {
	content, err := store.UnmarshalSubmissionContent(row.Content, int(row.SchemaVersion))
	if err != nil {
		return nil, fmt.Errorf("decode submission %s content: %w", uuidStringFromPg(row.ID), err)
	}
	return content.RawJSON(), nil
}

// takeExerciseEditLock serializes exercise-content edits against start-submission
// (D10 TOCTOU). Both paths hash the SAME exercise-id string, so they contend on
// one advisory lock held to tx end. Mirrors file_service's per-center lock form.
func takeExerciseEditLock(ctx context.Context, tx pgx.Tx, exerciseID uuid.UUID) error {
	if _, err := tx.Exec(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", exerciseID.String()); err != nil {
		return fmt.Errorf("exercise edit advisory lock: %w", err)
	}
	return nil
}

// revalidateStudent re-fetches the caller's center-member role (SEC-1) and
// confirms it is `student`, returning the student user UUID. A stale-JWT
// non-student (or a demoted user) is 403 INSUFFICIENT_ROLE.
func revalidateStudent(ctx context.Context, txQ *generated.Queries, tc model.TenantContext) (uuid.UUID, error) {
	centerUUID, err := uuid.Parse(tc.CenterID)
	if err != nil {
		return uuid.UUID{}, &ForbiddenError{Reason: "invalid tenant context"}
	}
	userUUID, err := uuid.Parse(tc.UserID)
	if err != nil {
		return uuid.UUID{}, &ForbiddenError{Reason: "invalid tenant context"}
	}
	member, err := txQ.GetCenterMemberByUserAndCenter(ctx, generated.GetCenterMemberByUserAndCenterParams{
		UserID:   pgUUID(userUUID),
		CenterID: pgUUID(centerUUID),
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return uuid.UUID{}, &ForbiddenError{Reason: "insufficient role"}
		}
		return uuid.UUID{}, fmt.Errorf("submission role revalidation: %w", err)
	}
	if member.Role != model.RoleStudent {
		return uuid.UUID{}, &ForbiddenError{Reason: "insufficient role"}
	}
	return userUUID, nil
}

// assertActiveEnrollment enforces the AC8 enrollment gate — the student must have
// an active enrollment in the assignment's class. Re-checked on every write.
func assertActiveEnrollment(ctx context.Context, txQ *generated.Queries, classID, studentID uuid.UUID) error {
	if _, err := txQ.GetActiveEnrollment(ctx, generated.GetActiveEnrollmentParams{
		ClassID:   pgUUID(classID),
		StudentID: pgUUID(studentID),
	}); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return &NotEnrolledError{}
		}
		return fmt.Errorf("enrollment gate: %w", err)
	}
	return nil
}

// assignmentLocked reports the AC13 write lock: a closed assignment OR an
// inclusive-passed hard deadline (now >= hard_deadline_at). A NULL hard deadline
// never hard-locks (D3) — late is accepted until close.
func (s *SubmissionService) assignmentLocked(a generated.Assignment, now time.Time) bool {
	if a.Status == assignmentStatusClosed {
		return true
	}
	if a.HardDeadlineAt.Valid && now.Compare(a.HardDeadlineAt.Time) >= 0 {
		return true
	}
	return false
}

// timeBudgetForAssignment reads the assignment's exercise settings and returns
// the total allowed seconds (server-anchored — the client computes remaining from
// startedAt + this - serverTime). nil = untimed. A since-deleted exercise or a
// disabled/zero limit is untimed.
func timeBudgetForAssignment(ctx context.Context, txQ *generated.Queries, a generated.Assignment) (*int, error) {
	row, err := txQ.GetExerciseContentByID(ctx, a.ExerciseID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("time budget: get exercise: %w", err)
	}
	content, err := store.UnmarshalExerciseContent(row.Content, int(row.SchemaVersion))
	if err != nil {
		return nil, fmt.Errorf("time budget: decode exercise: %w", err)
	}
	if !content.Settings.TimeLimitEnabled || content.Settings.TimeLimitMinutes <= 0 {
		return nil, nil
	}
	secs := content.Settings.TimeLimitMinutes * 60
	return &secs, nil
}

// Start creates or resumes a submission (AC7,8,13). Idempotent: a fresh row →
// 201; an existing in_progress → 200 resume (started_at never reset); a terminal
// row → 409 SUBMISSION_EXISTS.
func (s *SubmissionService) Start(
	ctx context.Context, tc model.TenantContext, assignmentID uuid.UUID,
) (SubmissionResult, error) {
	now := s.clk.Now()
	var result SubmissionResult
	err := s.mutateInSubmissionTx(ctx, tc, func(tx pgx.Tx, txQ *generated.Queries) error {
		studentID, rerr := revalidateStudent(ctx, txQ, tc)
		if rerr != nil {
			return rerr
		}
		// FOR UPDATE holds the assignment row so a concurrent close (UpdateStatus)
		// cannot commit between this lock check and the insert — otherwise an
		// in_progress attempt could be created under a just-closed assignment (AC13).
		assignment, aerr := txQ.GetAssignmentForUpdate(ctx, pgUUID(assignmentID))
		if aerr != nil {
			if errors.Is(aerr, pgx.ErrNoRows) {
				return assignmentNotFound(assignmentID)
			}
			return fmt.Errorf("start submission: get assignment: %w", aerr)
		}
		if eerr := assertActiveEnrollment(ctx, txQ, uuidFromPg(assignment.ClassID), studentID); eerr != nil {
			return eerr
		}
		if s.assignmentLocked(assignment, now) {
			return &SubmissionLockedError{}
		}
		// D10: serialize with the exercise-edit guard so a PATCH cannot mutate the
		// exercise between our lock check and the insert.
		if lerr := takeExerciseEditLock(ctx, tx, uuidFromPg(assignment.ExerciseID)); lerr != nil {
			return lerr
		}

		// Idempotency probe.
		existing, perr := txQ.GetSubmissionByAssignmentStudent(ctx, generated.GetSubmissionByAssignmentStudentParams{
			AssignmentID: pgUUID(assignmentID),
			StudentID:    pgUUID(studentID),
		})
		if perr == nil {
			if existing.Status == submissionStatusInProgress {
				budget, berr := timeBudgetForAssignment(ctx, txQ, assignment)
				if berr != nil {
					return berr
				}
				result = SubmissionResult{Row: existing, TimeBudgetSeconds: budget, Created: false}
				return nil
			}
			return &SubmissionExistsError{} // terminal row exists
		} else if !errors.Is(perr, pgx.ErrNoRows) {
			return fmt.Errorf("start submission: probe: %w", perr)
		}

		shell, serr := store.NewSubmissionContentShell().Marshal()
		if serr != nil {
			return fmt.Errorf("start submission: shell: %w", serr)
		}
		// Wrap the insert in a savepoint: a UNIQUE-violation aborts the surrounding
		// tx, so without this the resume re-probe below would run in an aborted tx
		// and error (500) instead of returning the existing row (200). (Belt: the
		// exercise-edit advisory lock already serializes same-assignment starts, so
		// this branch is near-unreachable — but it must be correct if it does fire.)
		if _, sperr := tx.Exec(ctx, "SAVEPOINT start_submission"); sperr != nil {
			return fmt.Errorf("start submission: savepoint: %w", sperr)
		}
		created, cerr := txQ.StartSubmission(ctx, generated.StartSubmissionParams{
			CenterID:      assignment.CenterID,
			AssignmentID:  pgUUID(assignmentID),
			StudentID:     pgUUID(studentID),
			Content:       shell,
			SchemaVersion: int32(store.ActiveSubmissionSchemaVersion()),
			StartedAt:     pgTimestamptz(now),
		})
		if cerr != nil {
			// Concurrent double-start: the UNIQUE(assignment_id, student_id) fired.
			// Re-probe and resume the surviving row (Murat #4 — exactly one row).
			var pgErr *pgconn.PgError
			if errors.As(cerr, &pgErr) && pgErr.Code == uniqueViolationPgErrorCode {
				// Undo the failed insert so the tx is usable for the re-probe.
				if _, rberr := tx.Exec(ctx, "ROLLBACK TO SAVEPOINT start_submission"); rberr != nil {
					return fmt.Errorf("start submission: rollback savepoint: %w", rberr)
				}
				winner, werr := txQ.GetSubmissionByAssignmentStudent(ctx, generated.GetSubmissionByAssignmentStudentParams{
					AssignmentID: pgUUID(assignmentID),
					StudentID:    pgUUID(studentID),
				})
				if werr != nil {
					return fmt.Errorf("start submission: post-race probe: %w", werr)
				}
				if winner.Status != submissionStatusInProgress {
					return &SubmissionExistsError{}
				}
				budget, berr := timeBudgetForAssignment(ctx, txQ, assignment)
				if berr != nil {
					return berr
				}
				result = SubmissionResult{Row: winner, TimeBudgetSeconds: budget, Created: false}
				return nil
			}
			return fmt.Errorf("start submission: insert: %w", cerr)
		}
		changes := Changes{After: map[string]any{
			"assignment_id": assignmentID.String(),
			"status":        created.Status,
		}}
		if lerr := s.audit.LogWithinTx(ctx, tx, tc, submissionCreatedAction, submissionAuditEntity, uuidFromPg(created.ID), changes); lerr != nil {
			return fmt.Errorf("start submission: audit: %w", lerr)
		}
		budget, berr := timeBudgetForAssignment(ctx, txQ, assignment)
		if berr != nil {
			return berr
		}
		result = SubmissionResult{Row: created, TimeBudgetSeconds: budget, Created: true}
		return nil
	})
	if err != nil {
		return SubmissionResult{}, err
	}
	if result.Content, err = submissionContentJSON(result.Row); err != nil {
		return SubmissionResult{}, err
	}
	return result, nil
}

// GetByID returns the caller's own submission + the server-anchored time budget
// (AC10). Ownership is enforced (a non-owner → 404).
func (s *SubmissionService) GetByID(
	ctx context.Context, tc model.TenantContext, id uuid.UUID,
) (SubmissionResult, error) {
	var result SubmissionResult
	err := s.readInSubmissionTx(ctx, tc, func(txQ *generated.Queries) error {
		studentID, rerr := revalidateStudent(ctx, txQ, tc)
		if rerr != nil {
			return rerr
		}
		sub, gerr := txQ.GetSubmissionByID(ctx, pgUUID(id))
		if gerr != nil {
			if errors.Is(gerr, pgx.ErrNoRows) {
				return submissionNotFound(id)
			}
			return fmt.Errorf("get submission: %w", gerr)
		}
		if uuidFromPg(sub.StudentID) != studentID {
			return submissionNotFound(id) // no cross-student oracle
		}
		assignment, aerr := txQ.GetAssignmentByID(ctx, sub.AssignmentID)
		if aerr != nil {
			return fmt.Errorf("get submission: get assignment: %w", aerr)
		}
		budget, berr := timeBudgetForAssignment(ctx, txQ, assignment)
		if berr != nil {
			return berr
		}
		result = SubmissionResult{Row: sub, TimeBudgetSeconds: budget}
		return nil
	})
	if err != nil {
		return SubmissionResult{}, err
	}
	if result.Content, err = submissionContentJSON(result.Row); err != nil {
		return SubmissionResult{}, err
	}
	return result, nil
}

// SaveProgress persists in-progress attempt content (AC9,10). in_progress only
// (DB-guarded), enrollment re-checked, write-locked, and time-limit enforced.
func (s *SubmissionService) SaveProgress(
	ctx context.Context, tc model.TenantContext, id uuid.UUID, contentRaw []byte,
) (SubmissionResult, error) {
	now := s.clk.Now()
	content, cerr := store.NewSubmissionContentFromRaw(contentRaw)
	if cerr != nil {
		return SubmissionResult{}, model.ValidationError{Fields: []model.FieldError{{
			Field: "content", Code: "INVALID_CONTENT", Message: cerr.Error(),
		}}}
	}
	contentBytes, merr := content.Marshal()
	if merr != nil {
		return SubmissionResult{}, fmt.Errorf("save progress: marshal: %w", merr)
	}

	var result SubmissionResult
	err := s.mutateInSubmissionTx(ctx, tc, func(tx pgx.Tx, txQ *generated.Queries) error {
		studentID, rerr := revalidateStudent(ctx, txQ, tc)
		if rerr != nil {
			return rerr
		}
		sub, gerr := txQ.GetSubmissionByID(ctx, pgUUID(id))
		if gerr != nil {
			if errors.Is(gerr, pgx.ErrNoRows) {
				return submissionNotFound(id)
			}
			return fmt.Errorf("save progress: get submission: %w", gerr)
		}
		if uuidFromPg(sub.StudentID) != studentID {
			return submissionNotFound(id)
		}
		assignment, aerr := txQ.GetAssignmentByID(ctx, sub.AssignmentID)
		if aerr != nil {
			return fmt.Errorf("save progress: get assignment: %w", aerr)
		}
		if eerr := assertActiveEnrollment(ctx, txQ, uuidFromPg(assignment.ClassID), studentID); eerr != nil {
			return eerr
		}
		if s.assignmentLocked(assignment, now) {
			return &SubmissionLockedError{}
		}
		budget, berr := timeBudgetForAssignment(ctx, txQ, assignment)
		if berr != nil {
			return berr
		}
		if exceededTimeLimit(now, sub.StartedAt.Time, budget) {
			return &TimeExpiredError{}
		}
		updated, uerr := txQ.SaveSubmissionProgress(ctx, generated.SaveSubmissionProgressParams{
			ID:            pgUUID(id),
			StudentID:     pgUUID(studentID),
			Content:       contentBytes,
			SchemaVersion: int32(store.ActiveSubmissionSchemaVersion()),
			UpdatedAt:     pgTimestamptz(now),
		})
		if uerr != nil {
			if errors.Is(uerr, pgx.ErrNoRows) {
				return &SubmissionNotEditableError{} // not in_progress (0 rows)
			}
			return fmt.Errorf("save progress: update: %w", uerr)
		}
		result = SubmissionResult{Row: updated, TimeBudgetSeconds: budget}
		return nil
	})
	if err != nil {
		return SubmissionResult{}, err
	}
	if result.Content, err = submissionContentJSON(result.Row); err != nil {
		return SubmissionResult{}, err
	}
	return result, nil
}

// Submit finalizes an attempt (AC11,12). Atomic: a single guarded UPDATE flips to
// submitted, stamps submitted_at, computes is_late, and snapshots the point-in-
// time penalty. Serialized against close via GetAssignmentForUpdate (D10). Allowed
// after time expiry (the client auto-submits at 0:00).
func (s *SubmissionService) Submit(
	ctx context.Context, tc model.TenantContext, id uuid.UUID,
) (SubmissionResult, error) {
	now := s.clk.Now()
	var result SubmissionResult
	err := s.mutateInSubmissionTx(ctx, tc, func(tx pgx.Tx, txQ *generated.Queries) error {
		studentID, rerr := revalidateStudent(ctx, txQ, tc)
		if rerr != nil {
			return rerr
		}
		sub, gerr := txQ.GetSubmissionByID(ctx, pgUUID(id))
		if gerr != nil {
			if errors.Is(gerr, pgx.ErrNoRows) {
				return submissionNotFound(id)
			}
			return fmt.Errorf("submit: get submission: %w", gerr)
		}
		if uuidFromPg(sub.StudentID) != studentID {
			return submissionNotFound(id)
		}
		// D10: FOR UPDATE holds the assignment row so a concurrent close cannot
		// interleave between the lock check and the submit UPDATE.
		assignment, aerr := txQ.GetAssignmentForUpdate(ctx, sub.AssignmentID)
		if aerr != nil {
			return fmt.Errorf("submit: lock assignment: %w", aerr)
		}
		if eerr := assertActiveEnrollment(ctx, txQ, uuidFromPg(assignment.ClassID), studentID); eerr != nil {
			return eerr
		}
		if s.assignmentLocked(assignment, now) {
			return &SubmissionLockedError{}
		}
		submitted, uerr := txQ.SubmitSubmission(ctx, generated.SubmitSubmissionParams{
			ID:          pgUUID(id),
			StudentID:   pgUUID(studentID),
			SubmittedAt: pgTimestamptz(now),
		})
		if uerr != nil {
			if errors.Is(uerr, pgx.ErrNoRows) {
				return &SubmissionNotEditableError{} // not in_progress (0 rows)
			}
			return fmt.Errorf("submit: update: %w", uerr)
		}
		changes := Changes{
			Before: map[string]any{"status": sub.Status},
			After: map[string]any{
				"status":          submitted.Status,
				"is_late":         submitted.IsLate,
				"applied_penalty": submitted.AppliedPenalty,
			},
		}
		if lerr := s.audit.LogWithinTx(ctx, tx, tc, submissionSubmittedAction, submissionAuditEntity, uuidFromPg(submitted.ID), changes); lerr != nil {
			return fmt.Errorf("submit: audit: %w", lerr)
		}
		result = SubmissionResult{Row: submitted}
		return nil
	})
	if err != nil {
		return SubmissionResult{}, err
	}
	if result.Content, err = submissionContentJSON(result.Row); err != nil {
		return SubmissionResult{}, err
	}
	return result, nil
}

// exceededTimeLimit reports whether now is past started + budget + grace. An
// untimed exercise (nil budget) never expires.
func exceededTimeLimit(now, started time.Time, budgetSecs *int) bool {
	if budgetSecs == nil {
		return false
	}
	limit := started.Add(time.Duration(*budgetSecs)*time.Second + submissionTimeGrace)
	return now.After(limit)
}

func (s *SubmissionService) readInSubmissionTx(
	ctx context.Context, tc model.TenantContext, fn func(*generated.Queries) error,
) error {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return fmt.Errorf("submission read tx: begin: %w", err)
	}
	defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }()
	if err := store.SetTenantContext(ctx, tx, tc); err != nil {
		return fmt.Errorf("submission read tx: %w", err)
	}
	if err := fn(generated.New(tx)); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (s *SubmissionService) mutateInSubmissionTx(
	ctx context.Context, tc model.TenantContext, fn func(tx pgx.Tx, txQ *generated.Queries) error,
) error {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return fmt.Errorf("submission mutate tx: begin: %w", err)
	}
	defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }()
	if err := store.SetTenantContext(ctx, tx, tc); err != nil {
		return fmt.Errorf("submission mutate tx: %w", err)
	}
	if err := fn(tx, generated.New(tx)); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
