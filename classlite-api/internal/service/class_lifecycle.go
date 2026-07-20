// Class lifecycle state machine (Story 3.1, AC4).
//
// This is the FIRST state machine in the codebase — no precedent to copy. The
// allowed-transition set is the epic-AC arrow set EXACTLY ("no other
// transitions allowed"):
//
//	upcoming → active
//	active   → paused | ended
//	paused   → active
//	ended    → (terminal)
//
// paused→ended is DISALLOWED (resume then end): the terminal path is
// paused→active→ended (Open-Q1 CLOSED 2026-07-19). Any other move — including
// a same-state no-op — is INVALID_STATUS_TRANSITION (422) and writes NO audit.
package service

import (
	"context"
	"errors"
	"fmt"

	"github.com/ducdo/classlite-api/internal/model"
	"github.com/ducdo/classlite-api/internal/store"
	"github.com/ducdo/classlite-api/internal/store/generated"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// Class status values — mirror the classes.status CHECK + api.yaml ClassStatus.
const (
	ClassStatusUpcoming = "upcoming"
	ClassStatusActive   = "active"
	ClassStatusPaused   = "paused"
	ClassStatusEnded    = "ended"

	classCreatedAction  = "class.created"
	classUpdatedAction  = "class.updated"
	classStatusAction   = "class.status_changed"
	classAuditEntity    = "class"
	classNotFoundCode   = "CLASS_NOT_FOUND"
	invalidTransitionCd = "INVALID_STATUS_TRANSITION"
)

// classTransitions is the single source of truth for legal lifecycle moves.
// CQ-3 — named, not inlined at the callsite. The client mirror in
// classesKeys/ClassStatusPill is advisory; this map is authoritative.
var classTransitions = map[string][]string{
	ClassStatusUpcoming: {ClassStatusActive},
	ClassStatusActive:   {ClassStatusPaused, ClassStatusEnded},
	ClassStatusPaused:   {ClassStatusActive},
	ClassStatusEnded:    {},
}

// isLegalTransition reports whether from→to is in the allowed-transition set.
// A same-state move (from == to) is never in the set, so it is illegal (AC4).
func isLegalTransition(from, to string) bool {
	for _, allowed := range classTransitions[from] {
		if allowed == to {
			return true
		}
	}
	return false
}

// invalidStatusTransitionError builds the AC4 422 payload naming current+target.
func invalidStatusTransitionError(from, to string) model.ValidationError {
	return model.ValidationError{Fields: []model.FieldError{{
		Field:   "status",
		Code:    invalidTransitionCd,
		Message: fmt.Sprintf("cannot transition class from %q to %q", from, to),
	}}}
}

// classNotFound is the canonical 404 for an absent OR teacher-invisible class.
func classNotFound(classID uuid.UUID) error {
	return model.NotFoundError{Resource: "class", ID: classID.String(), Code: classNotFoundCode}
}

// assertClassRole enforces AC1's role allowlist for every class CRUD/lifecycle
// endpoint. classChain is intentionally NOT owner-gated at the middleware
// (teachers must reach it), so the allowlist lives here in the service (SEC-1 —
// role authorization is service-layer). Any role outside {owner, admin,
// teacher} — e.g. student — is 403 INSUFFICIENT_ROLE. List gates the same set
// via its handler switch.
func assertClassRole(tc model.TenantContext) error {
	switch tc.Role {
	case model.RoleOwner, model.RoleAdmin, model.RoleTeacher:
		return nil
	default:
		return &ForbiddenError{Reason: "insufficient role"}
	}
}

// assertTeacherScope enforces AC6: a teacher may only see/mutate a class
// assigned to them. Cross-teacher (or unassigned) access returns 404
// CLASS_NOT_FOUND — teacher-sees-nothing, never 403. Owner/admin may touch any
// class in their center. RLS has already tenant-scoped the row.
func assertTeacherScope(tc model.TenantContext, current generated.Class, classID uuid.UUID) error {
	if tc.Role != model.RoleTeacher {
		return nil
	}
	if !current.TeacherID.Valid || uuidStringFromPg(current.TeacherID) != tc.UserID {
		return classNotFound(classID)
	}
	return nil
}

// TransitionStatus validates a lifecycle move against classTransitions and
// applies it via a compare-and-swap UPDATE inside one tenant-scoped tx (AC4).
//
// Concurrency: the map check is NOT a bare read-then-write. UpdateClassStatus
// issues `UPDATE ... WHERE id=$1 AND status=$expected RETURNING`; a 0-row
// result (pgx.ErrNoRows) means the row moved under a concurrent transition →
// INVALID_STATUS_TRANSITION. Two racing legal moves from the same state cannot
// both commit — the second UPDATE re-evaluates its predicate against the
// winner's committed status and matches 0 rows.
func (s *ClassService) TransitionStatus(
	ctx context.Context, tc model.TenantContext, classID uuid.UUID, target string,
) (generated.Class, error) {
	if err := assertClassRole(tc); err != nil {
		return generated.Class{}, err
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return generated.Class{}, fmt.Errorf("transition status: begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }()

	if err := store.SetTenantContext(ctx, tx, tc); err != nil {
		return generated.Class{}, fmt.Errorf("transition status: %w", err)
	}
	txQ := generated.New(tx)

	current, err := txQ.GetClassByID(ctx, pgUUID(classID))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return generated.Class{}, classNotFound(classID)
		}
		return generated.Class{}, fmt.Errorf("transition status: get class: %w", err)
	}

	if err := assertTeacherScope(tc, current, classID); err != nil {
		return generated.Class{}, err
	}

	if !isLegalTransition(current.Status, target) {
		return generated.Class{}, invalidStatusTransitionError(current.Status, target)
	}

	updated, err := txQ.UpdateClassStatus(ctx, generated.UpdateClassStatusParams{
		ID:             pgUUID(classID),
		NewStatus:      target,
		ExpectedStatus: current.Status,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			// Row moved under a concurrent transition (compare-and-swap lost).
			// Re-fetch to report the actual current state in the message.
			actual := current.Status
			if latest, gerr := txQ.GetClassByID(ctx, pgUUID(classID)); gerr == nil {
				actual = latest.Status
			}
			return generated.Class{}, invalidStatusTransitionError(actual, target)
		}
		return generated.Class{}, fmt.Errorf("transition status: update: %w", err)
	}

	changes := Changes{
		Before: map[string]any{"status": current.Status},
		After:  map[string]any{"status": updated.Status},
	}
	if err := s.audit.LogWithinTx(ctx, tx, tc, classStatusAction, classAuditEntity, classID, changes); err != nil {
		return generated.Class{}, fmt.Errorf("transition status: audit: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return generated.Class{}, fmt.Errorf("transition status: commit: %w", err)
	}
	return updated, nil
}
