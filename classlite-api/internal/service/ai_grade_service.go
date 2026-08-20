// Story 6.2a — the enqueue service for the AI Writing-grade pipeline. It mirrors the
// 4.3a AIGenerationService single-tx shape (InsertJob + -1 job_deduction in ONE
// tenant tx) but gates on the 6.1 grading authz (teacher-of-class) + Writing/gradable
// guards BEFORE the job insert (D9/SEC-1), and is IDEMPOTENT: the partial unique
// index uq_jobs_ai_grade_inflight makes a second in-flight enqueue for the same
// submission a 23505 that rolls the whole tx back (the -1 deduct included — no second
// charge, the money bug) and returns the EXISTING in-flight job (D6). It NEVER calls
// Gemini (PERF-3) and NEVER writes a grade (D1) — the durable worker produces the
// suggestion; the teacher commits via the 6.1 grade path.
package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/ducdo/classlite-api/internal/model"
	"github.com/ducdo/classlite-api/internal/service/grading"
	"github.com/ducdo/classlite-api/internal/store"
	"github.com/ducdo/classlite-api/internal/store/generated"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// inflightJobUniqueIndex is the partial unique index that enforces at-most-one
// in-flight ai_grade_writing job per submission (migration 20260819120000, D6). A
// 23505 naming it is the idempotency signal, not an error.
const inflightJobUniqueIndex = "uq_jobs_ai_grade_inflight"

// AIGradeService enqueues ai_grade_writing jobs.
type AIGradeService struct {
	db AuthDB
}

// NewAIGradeService constructs the service bound to the DB pool.
func NewAIGradeService(db AuthDB) *AIGradeService {
	return &AIGradeService{db: db}
}

// EnqueueAIGrade gate-checks the submission (teacher-of-class authz + Writing +
// gradable status, all BEFORE the job insert — D9), then in a SINGLE tenant tx
// inserts the pending ai_grade_writing job and its -1 job_deduction. Returns the new
// job id and existing=false on a fresh enqueue.
//
// Idempotency (D6): if an ai_grade_writing job for this submission is already
// pending/processing, InsertJob hits uq_jobs_ai_grade_inflight → 23505 → the whole
// tx rolls back (the -1 deduct included, so there is NO second charge) → the method
// returns the EXISTING in-flight job id with existing=true (the handler maps that to
// 200 vs 202). A re-run AFTER a completed/failed run is allowed (the prior job is no
// longer in the partial index). There is NO 402 balance gate (Story 6.5).
func (s *AIGradeService) EnqueueAIGrade(
	ctx context.Context, tc model.TenantContext, submissionID uuid.UUID,
) (uuid.UUID, bool, error) {
	centerUUID, err := uuid.Parse(tc.CenterID)
	if err != nil {
		return uuid.Nil, false, fmt.Errorf("enqueue ai grade: parse center id: %w", err)
	}

	var jobID uuid.UUID
	err = s.mutateInTenantTx(ctx, tc, func(q *generated.Queries) error {
		userID, role, rerr := revalidateStaffRole(ctx, q, tc)
		if rerr != nil {
			return rerr
		}
		sub, gerr := q.GetSubmissionByID(ctx, pgUUID(submissionID))
		if gerr != nil {
			if errors.Is(gerr, pgx.ErrNoRows) {
				return gradingSubmissionNotFound(submissionID)
			}
			return fmt.Errorf("enqueue ai grade: get submission: %w", gerr)
		}
		assignment, aerr := loadAssignmentForGrading(ctx, q, sub)
		if aerr != nil {
			return aerr
		}
		// D9: teacher-of-class + Writing + gradable gates run BEFORE InsertJob, inside
		// the tx, so a rejected enqueue commits ZERO side effects (no job, no deduct).
		if serr := assertTeacherOfSubmissionClass(ctx, q, role, userID.String(), assignment); serr != nil {
			return serr
		}
		if serr := assertWritingExercise(ctx, q, assignment); serr != nil {
			return serr
		}
		switch sub.Status {
		case submissionStatusSubmitted, submissionStatusGraded:
			// gradable
		default: // in_progress / ai_processing
			return model.ConflictError{
				Resource: "submission", ID: submissionID.String(),
				Code: "SUBMISSION_NOT_GRADABLE", Message: "submission is not ready to grade",
			}
		}
		// An empty/unparseable essay body would spend a credit on an empty Gemini prompt
		// and store analyzedWordCount:0 as a "valid" complete suggestion (no refund fires
		// on completion). Reject BEFORE InsertJob — same grading.EssayText the worker reads.
		if strings.TrimSpace(grading.EssayText(sub.Content)) == "" {
			return model.ConflictError{
				Resource: "submission", ID: submissionID.String(),
				Code: "SUBMISSION_NOT_GRADABLE", Message: "submission has no essay content to grade",
			}
		}

		// SEC-7: the payload carries ONLY the submission id — the center is never read
		// from it; the job-row center_id (from tc) is the tenant anchor.
		params, merr := json.Marshal(model.AIGradeWritingParams{SubmissionID: submissionID.String()})
		if merr != nil {
			return fmt.Errorf("enqueue ai grade: marshal params: %w", merr)
		}
		job, jerr := q.InsertJob(ctx, generated.InsertJobParams{
			CenterID:            pgUUID(centerUUID),
			CreatedBy:           pgUUID(userID),
			Type:                string(model.JobTypeAIGradeWriting),
			Params:              params,
			ParamsSchemaVersion: model.AIJobParamsSchemaVersion,
		})
		if jerr != nil {
			// A 23505 on the in-flight index bubbles up untranslated so EnqueueAIGrade
			// can resolve the existing job after the tx rolls back (D6).
			return jerr
		}
		jobID = uuidFromPg(job.ID)

		if derr := q.InsertJobDeduction(ctx, generated.InsertJobDeductionParams{
			CenterID: pgUUID(centerUUID),
			UserID:   pgUUID(userID),
			RefJobID: job.ID,
		}); derr != nil {
			return fmt.Errorf("enqueue ai grade: deduct credit: %w", derr)
		}
		return nil
	})
	if err != nil {
		if isInflightIndexViolation(err) {
			existingID, ferr := s.findInflightJob(ctx, tc, submissionID)
			if ferr != nil {
				return uuid.Nil, false, ferr
			}
			return existingID, true, nil
		}
		return uuid.Nil, false, err
	}
	return jobID, false, nil
}

// isInflightIndexViolation reports whether err is a 23505 on the partial in-flight
// unique index (D6) — the idempotency signal, distinct from any other unique
// violation (which stays a real error).
func isInflightIndexViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505" && pgErr.ConstraintName == inflightJobUniqueIndex
}

// findInflightJob returns the id of the existing in-flight (pending/processing)
// ai_grade_writing job for a submission, in a fresh tenant-scoped read tx (the
// enqueue tx has rolled back). At most one such row exists (the partial index).
func (s *AIGradeService) findInflightJob(
	ctx context.Context, tc model.TenantContext, submissionID uuid.UUID,
) (uuid.UUID, error) {
	var jobID uuid.UUID
	err := s.readInTenantTx(ctx, tc, func(q *generated.Queries) error {
		row, err := q.GetInflightAIGradeJobForSubmission(ctx, []byte(submissionID.String()))
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				// The in-flight job completed/failed between the 23505 and this read —
				// nothing to return; surface a conflict so the caller can retry.
				return model.ConflictError{
					Resource: "submission", ID: submissionID.String(),
					Code: "AI_GRADE_ENQUEUE_CONFLICT", Message: "an AI grade for this submission changed state; retry",
				}
			}
			return fmt.Errorf("enqueue ai grade: find in-flight job: %w", err)
		}
		jobID = uuidFromPg(row.ID)
		return nil
	})
	return jobID, err
}

func (s *AIGradeService) mutateInTenantTx(
	ctx context.Context, tc model.TenantContext, fn func(*generated.Queries) error,
) error {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return fmt.Errorf("ai grade mutate tx: begin: %w", err)
	}
	defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }()

	if err := store.SetTenantContext(ctx, tx, tc); err != nil {
		return fmt.Errorf("ai grade mutate tx: %w", err)
	}
	if err := fn(generated.New(tx)); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (s *AIGradeService) readInTenantTx(
	ctx context.Context, tc model.TenantContext, fn func(*generated.Queries) error,
) error {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return fmt.Errorf("ai grade read tx: begin: %w", err)
	}
	defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }()

	if err := store.SetTenantContext(ctx, tx, tc); err != nil {
		return fmt.Errorf("ai grade read tx: %w", err)
	}
	if err := fn(generated.New(tx)); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
