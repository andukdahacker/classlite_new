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
	"time"

	"github.com/ducdo/classlite-api/internal/model"
	"github.com/ducdo/classlite-api/internal/store"
	"github.com/ducdo/classlite-api/internal/store/generated"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// submissionAudioURLExpiry is the TTL of a presigned GET for a student's own
// speaking recording (Story 5.5a SEC-8). 5 minutes — the SEC-8 ceiling — kept
// short so a leaked URL ages out fast; the FE re-mints on play-intent (D8).
const submissionAudioURLExpiry = 5 * time.Minute

// StudentSubmissionReviewResult is the domain view for the "review my submission"
// read (Story 5.5a). A terminal submission carries the answer-stripped Exercise +
// (for speaking) a fresh presigned AudioURL; an in_progress submission short-
// circuits to InProgress=true with a ZERO Exercise and nil AudioURL (D10 — no
// strip, no presign). Released is always false pre-Epic-6 (5.5b fills the grade).
type StudentSubmissionReviewResult struct {
	Submission SubmissionResult
	Assignment generated.Assignment
	Exercise   AttemptExercise
	Released   bool
	AudioURL   *string
	InProgress bool
}

// GetStudentSubmissionReview assembles the pre-grade read-back for the caller's
// OWN submission to assignmentID (Story 5.5a AC3/AC4). It mirrors GetAttemptBundle's
// gate ladder via the SHARED helpers (revalidateStudent → caller-keyed resolve →
// active-enrollment) — no fork. Resolution is keyed on (assignmentID, principal
// studentID) so ownership is inherent: a caller with no row (including another
// student's assignment) gets the same 404 SUBMISSION_NOT_FOUND, never a cross-
// student oracle. NOT lock-gated (D6). An in_progress submission short-circuits to
// a resume-CTA result (D10 — SKIP strip + presign). The speaking AudioURL is
// minted OUTSIDE the read tx (D9/PERF-1 — never hold a PG tx across the R2 sign).
func (s *SubmissionService) GetStudentSubmissionReview(
	ctx context.Context, tc model.TenantContext, assignmentID uuid.UUID,
) (StudentSubmissionReviewResult, error) {
	var result StudentSubmissionReviewResult
	var audioKey string
	err := s.readInSubmissionTx(ctx, tc, func(txQ *generated.Queries) error {
		studentID, rerr := revalidateStudent(ctx, txQ, tc)
		if rerr != nil {
			return rerr
		}
		// Resolve the caller's OWN (assignment, student) submission. RLS scopes this
		// to the caller's tenant, so a cross-tenant assignmentId never matches (B-2).
		// No row → 404 (no cross-student existence oracle, B-1).
		sub, gerr := txQ.GetSubmissionByAssignmentStudent(ctx, generated.GetSubmissionByAssignmentStudentParams{
			AssignmentID: pgUUID(assignmentID),
			StudentID:    pgUUID(studentID),
		})
		if gerr != nil {
			if errors.Is(gerr, pgx.ErrNoRows) {
				return submissionNotFound(assignmentID)
			}
			return fmt.Errorf("submission review: get submission: %w", gerr)
		}
		// Load the assignment UNDER the same tenant tx (B-2 — a cross-tenant row would
		// already have failed the resolve above; this read stays RLS-scoped too).
		assignment, aerr := txQ.GetAssignmentByID(ctx, sub.AssignmentID)
		if aerr != nil {
			if errors.Is(aerr, pgx.ErrNoRows) {
				return fmt.Errorf("submission review: assignment %s missing for submission %s", uuidStringFromPg(sub.AssignmentID), uuidStringFromPg(sub.ID))
			}
			return fmt.Errorf("submission review: get assignment: %w", aerr)
		}
		// Re-check active enrollment on read (a withdrawn owner → 403 NOT_ENROLLED).
		if eerr := assertActiveEnrollment(ctx, txQ, uuidFromPg(assignment.ClassID), studentID); eerr != nil {
			return eerr
		}
		// The student's own saved content is always returned (own answers / draft).
		content, cerr := submissionContentJSON(sub)
		if cerr != nil {
			return cerr
		}
		result.Submission = SubmissionResult{Row: sub, Content: content}
		result.Assignment = assignment
		result.Released = false

		// D10: an in_progress submission is not a terminal artifact — short-circuit to
		// the resume CTA. NO answer-strip and NO presign (also defuses the partial-
		// content render trap, Murat B-4).
		if sub.Status == submissionStatusInProgress {
			result.InProgress = true
			return nil
		}

		// Terminal → answer-strip the exercise (correctAnswer/acceptedVariants are
		// structurally absent from AttemptExercise — the 5.2a whitelist mapper).
		exRow, xerr := txQ.GetExerciseForAttempt(ctx, assignment.ExerciseID)
		if xerr != nil {
			if errors.Is(xerr, pgx.ErrNoRows) {
				return fmt.Errorf("submission review: exercise %s missing for assignment %s", uuidStringFromPg(assignment.ExerciseID), uuidStringFromPg(assignment.ID))
			}
			return fmt.Errorf("submission review: get exercise: %w", xerr)
		}
		exContent, dcerr := store.UnmarshalExerciseContent(exRow.Content, int(exRow.SchemaVersion))
		if dcerr != nil {
			return fmt.Errorf("submission review: decode exercise %s: %w", uuidStringFromPg(exRow.ID), dcerr)
		}
		result.Exercise = toAttemptExercise(exContent, uuidFromPg(exRow.ID), exRow.Title, exRow.Skill)
		// Capture the speaking audioKey (if any) for the OUTSIDE-tx presign (D9).
		audioKey = speakingAudioKeyFromContent(content)
		return nil
	})
	if err != nil {
		return StudentSubmissionReviewResult{}, err
	}
	// D9/PERF-1 — the read tx has COMMITTED; only now sign the R2 GET. audioKey is ""
	// for non-speaking / nil-key / in_progress → AudioURL stays nil, zero mint (B-3).
	if audioKey != "" {
		url, perr := s.storage.PresignGetOwned(ctx, audioKey, tc, submissionAudioURLExpiry)
		if perr != nil {
			return StudentSubmissionReviewResult{}, fmt.Errorf("submission review: presign audio: %w", perr)
		}
		result.AudioURL = &url
	}
	return result, nil
}

// GetStudentSubmissionAudioURL mints a FRESH 5-min presigned GET for the caller's
// own speaking recording (Story 5.5a AC10 — on-demand play-intent refresh). It
// rides the SAME gate ladder as GetStudentSubmissionReview; every gated failure
// returns before any presign (zero mint). A submission with no audioKey (non-
// speaking / in_progress) → 404 SUBMISSION_NOT_FOUND (no audio to serve). The
// presign runs OUTSIDE the read tx (D9/PERF-1).
func (s *SubmissionService) GetStudentSubmissionAudioURL(
	ctx context.Context, tc model.TenantContext, assignmentID uuid.UUID,
) (string, error) {
	var audioKey string
	err := s.readInSubmissionTx(ctx, tc, func(txQ *generated.Queries) error {
		studentID, rerr := revalidateStudent(ctx, txQ, tc)
		if rerr != nil {
			return rerr
		}
		sub, gerr := txQ.GetSubmissionByAssignmentStudent(ctx, generated.GetSubmissionByAssignmentStudentParams{
			AssignmentID: pgUUID(assignmentID),
			StudentID:    pgUUID(studentID),
		})
		if gerr != nil {
			if errors.Is(gerr, pgx.ErrNoRows) {
				return submissionNotFound(assignmentID)
			}
			return fmt.Errorf("submission audio: get submission: %w", gerr)
		}
		assignment, aerr := txQ.GetAssignmentByID(ctx, sub.AssignmentID)
		if aerr != nil {
			if errors.Is(aerr, pgx.ErrNoRows) {
				return fmt.Errorf("submission audio: assignment %s missing for submission %s", uuidStringFromPg(sub.AssignmentID), uuidStringFromPg(sub.ID))
			}
			return fmt.Errorf("submission audio: get assignment: %w", aerr)
		}
		if eerr := assertActiveEnrollment(ctx, txQ, uuidFromPg(assignment.ClassID), studentID); eerr != nil {
			return eerr
		}
		// D10: an in_progress submission is not a terminal artifact — it has no
		// recording to serve. Match GetStudentSubmissionReview's short-circuit and
		// the api.yaml contract ("non-speaking / in_progress → 404"): a draft that
		// happens to carry an autosaved audioKey must NOT mint a presign here.
		if sub.Status == submissionStatusInProgress {
			return submissionNotFound(assignmentID)
		}
		content, cerr := submissionContentJSON(sub)
		if cerr != nil {
			return cerr
		}
		audioKey = speakingAudioKeyFromContent(content)
		return nil
	})
	if err != nil {
		return "", err
	}
	if audioKey == "" {
		return "", submissionNotFound(assignmentID) // no recording to serve
	}
	url, perr := s.storage.PresignGetOwned(ctx, audioKey, tc, submissionAudioURLExpiry)
	if perr != nil {
		return "", fmt.Errorf("submission audio: presign: %w", perr)
	}
	return url, nil
}

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
