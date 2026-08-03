// Story 5.2a — the student attempt-READ surface (AC1-13). Read-only peer to the
// 5.1 write lifecycle: it assembles the answer-stripped attempt bundle and the
// enrollment-scoped student assignment list. Both methods hang off
// SubmissionService so they reuse its tenant-tx wrapper + the shared authz helpers
// (revalidateStudent, assertActiveEnrollment). NOTHING here mutates.
//
// Authz mirrors the 5.1 write paths: every call re-validates the caller is a
// `student` center-member (NOT the ≤15-min-stale JWT) and — for the bundle —
// re-checks active enrollment on READ (D5). A student only ever reads their OWN
// submission (a mismatch is 404, never a 403 that confirms existence).
//
// D6: the bundle read is NOT lock-gated — a closed assignment or a passed hard
// deadline still returns 200 so the FE can render the locked draft read-only. The
// write locks stay enforced by 5.1's start/progress/submit.
package service

import (
	"context"
	"errors"
	"fmt"
	"math"

	"github.com/ducdo/classlite-api/internal/model"
	"github.com/ducdo/classlite-api/internal/store"
	"github.com/ducdo/classlite-api/internal/store/generated"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// AttemptBundleResult is the domain view the handler serializes into an
// AttemptBundle: the caller's own submission (+ server-anchored time budget), the
// assignment row (mapped to the student-safe subset in the handler), and the
// answer-stripped exercise.
type AttemptBundleResult struct {
	Submission SubmissionResult
	Assignment generated.Assignment
	Exercise   AttemptExercise
}

// GetAttemptBundle assembles the read-only attempt payload for the owning,
// actively-enrolled student (AC5-9,13). Ownership + enrollment are re-checked on
// read; the exercise content is answer-stripped via toAttemptExercise. NOT
// lock-gated (D6). Assembled in a single tenant read tx (PERF-1).
func (s *SubmissionService) GetAttemptBundle(
	ctx context.Context, tc model.TenantContext, submissionID uuid.UUID,
) (AttemptBundleResult, error) {
	var result AttemptBundleResult
	err := s.readInSubmissionTx(ctx, tc, func(txQ *generated.Queries) error {
		studentID, rerr := revalidateStudent(ctx, txQ, tc)
		if rerr != nil {
			return rerr
		}
		sub, gerr := txQ.GetSubmissionByID(ctx, pgUUID(submissionID))
		if gerr != nil {
			if errors.Is(gerr, pgx.ErrNoRows) {
				return submissionNotFound(submissionID)
			}
			return fmt.Errorf("attempt bundle: get submission: %w", gerr)
		}
		// Ownership: a non-owner sees the same 404 as a missing row (no cross-student
		// oracle, AC8) — checked BEFORE enrollment so a non-owner never learns the
		// class exists.
		if uuidFromPg(sub.StudentID) != studentID {
			return submissionNotFound(submissionID)
		}
		assignment, aerr := txQ.GetAssignmentByID(ctx, sub.AssignmentID)
		if aerr != nil {
			if errors.Is(aerr, pgx.ErrNoRows) {
				// The submission's FK guarantees the assignment exists in-tenant; a
				// miss here is data corruption, not a client 404.
				return fmt.Errorf("attempt bundle: assignment %s missing for submission %s", uuidStringFromPg(sub.AssignmentID), submissionID)
			}
			return fmt.Errorf("attempt bundle: get assignment: %w", aerr)
		}
		// D5: re-check active enrollment on READ — a student withdrawn mid-attempt
		// loses read access to content too (403 NOT_ENROLLED). NOT lock-gated (D6).
		if eerr := assertActiveEnrollment(ctx, txQ, uuidFromPg(assignment.ClassID), studentID); eerr != nil {
			return eerr
		}
		exRow, xerr := txQ.GetExerciseForAttempt(ctx, assignment.ExerciseID)
		if xerr != nil {
			if errors.Is(xerr, pgx.ErrNoRows) {
				return fmt.Errorf("attempt bundle: exercise %s missing for assignment %s", uuidStringFromPg(assignment.ExerciseID), uuidStringFromPg(assignment.ID))
			}
			return fmt.Errorf("attempt bundle: get exercise: %w", xerr)
		}
		content, cerr := store.UnmarshalExerciseContent(exRow.Content, int(exRow.SchemaVersion))
		if cerr != nil {
			return fmt.Errorf("attempt bundle: decode exercise %s: %w", uuidStringFromPg(exRow.ID), cerr)
		}
		budget, berr := timeBudgetForAssignment(ctx, txQ, assignment)
		if berr != nil {
			return berr
		}
		result = AttemptBundleResult{
			Submission: SubmissionResult{Row: sub, TimeBudgetSeconds: budget},
			Assignment: assignment,
			Exercise:   toAttemptExercise(content, uuidFromPg(exRow.ID), exRow.Title, exRow.Skill),
		}
		return nil
	})
	if err != nil {
		return AttemptBundleResult{}, err
	}
	// Decode the student's own saved answers for the wire response (outside the tx —
	// pure transform of the already-loaded row).
	content, cerr := submissionContentJSON(result.Submission.Row)
	if cerr != nil {
		return AttemptBundleResult{}, cerr
	}
	result.Submission.Content = content
	return result, nil
}

// ListStudentAssignments returns the caller's enrollment-scoped assignment list
// (AC1-4). Student-only (non-student → 403 INSUFFICIENT_ROLE). Returns the rows,
// the total, and the CLAMPED page/pageSize so the handler builds its pagination
// meta from the effective values (carrying the 5.1 review fix forward).
func (s *SubmissionService) ListStudentAssignments(
	ctx context.Context, tc model.TenantContext, page, pageSize int,
) ([]generated.ListStudentAssignmentsRow, int, int, int, error) {
	page, pageSize = normalizeAssignmentPaging(page, pageSize)
	// int64 OFFSET clamped to int32 range: a huge page yields an empty page, never a
	// negative OFFSET → 500. Clamp `page` BEFORE the multiply — a crafted `?page` near
	// MaxInt64 would otherwise overflow the int64 product and wrap negative, slipping
	// past a post-multiply magnitude check into a negative OFFSET (5.1 review fix +
	// 5.2a code-review overflow fix). normalizeAssignmentPaging guarantees pageSize≥1.
	const maxOffset = int64(math.MaxInt32)
	if maxPage := maxOffset/int64(pageSize) + 1; int64(page) > maxPage {
		page = int(maxPage)
	}
	offset := int64(page-1) * int64(pageSize)
	if offset > maxOffset {
		offset = maxOffset
	}

	var rows []generated.ListStudentAssignmentsRow
	var total int64
	err := s.readInSubmissionTx(ctx, tc, func(txQ *generated.Queries) error {
		studentID, rerr := revalidateStudent(ctx, txQ, tc)
		if rerr != nil {
			return rerr
		}
		list, lerr := txQ.ListStudentAssignments(ctx, generated.ListStudentAssignmentsParams{
			StudentID:  pgUUID(studentID),
			PageLimit:  int32(pageSize),
			PageOffset: int32(offset),
		})
		if lerr != nil {
			return fmt.Errorf("list student assignments: query: %w", lerr)
		}
		count, cerr := txQ.CountStudentAssignments(ctx, pgUUID(studentID))
		if cerr != nil {
			return fmt.Errorf("list student assignments: count: %w", cerr)
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
