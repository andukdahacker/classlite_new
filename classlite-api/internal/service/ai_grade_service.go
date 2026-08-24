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

// inflightJobUniqueIndex / inflightSpeakingJobUniqueIndex are the partial unique
// indexes that enforce at-most-one in-flight ai_grade_writing / ai_grade_speaking job
// per submission (migrations 20260819120000 / 20260824120000, D6/D9). A 23505 naming
// EITHER is the idempotency signal, not an error.
const (
	inflightJobUniqueIndex         = "uq_jobs_ai_grade_inflight"
	inflightSpeakingJobUniqueIndex = "uq_jobs_ai_grade_speaking_inflight"
)

// maxAIGradeAudioDurationMs is the AI-gradable recording ceiling (D12): 20 minutes,
// which dwarfs any real IELTS speaking answer while rejecting an absurd upload upfront
// at enqueue (before the credit deduct) rather than three transcode retries deep.
const maxAIGradeAudioDurationMs = 20 * 60 * 1000

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
	// resolvedSkill is HOISTED to the outer scope (D16) so the post-tx 23505 handler
	// picks the SPEAKING twin query + speaking index name — else a 2nd in-flight
	// speaking enqueue's 23505 escapes the reconcile (surfaces as an error) or, worse,
	// double-charges. It is set inside the tx from the DB exercise skill (SEC-7).
	var resolvedSkill string
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
		// D9: teacher-of-class + skill + gradable gates run BEFORE InsertJob, inside the
		// tx, so a rejected enqueue commits ZERO side effects (no job, no deduct).
		if serr := assertTeacherOfSubmissionClass(ctx, q, role, userID.String(), assignment); serr != nil {
			return serr
		}
		// SEC-7: the skill is resolved from the DB exercise, NEVER a client field. It
		// selects the job type + guards below and (hoisted) the 23505 reconcile query.
		exRow, xerr := q.GetExerciseForAttempt(ctx, assignment.ExerciseID)
		if xerr != nil {
			if errors.Is(xerr, pgx.ErrNoRows) {
				return fmt.Errorf("enqueue ai grade: exercise %s missing for assignment %s",
					uuidStringFromPg(assignment.ExerciseID), uuidStringFromPg(assignment.ID))
			}
			return fmt.Errorf("enqueue ai grade: get exercise skill: %w", xerr)
		}
		resolvedSkill = exRow.Skill

		switch sub.Status {
		case submissionStatusSubmitted, submissionStatusGraded:
			// gradable
		default: // in_progress / ai_processing
			return model.ConflictError{
				Resource: "submission", ID: submissionID.String(),
				Code: "SUBMISSION_NOT_GRADABLE", Message: "submission is not ready to grade",
			}
		}

		var jobType model.JobType
		var params []byte
		var merr error
		switch resolvedSkill {
		case skillWriting:
			// An empty/unparseable essay body would spend a credit on an empty Gemini
			// prompt and store analyzedWordCount:0 as a "valid" complete suggestion (no
			// refund fires on completion). Reject BEFORE InsertJob.
			if strings.TrimSpace(grading.EssayText(sub.Content)) == "" {
				return model.ConflictError{
					Resource: "submission", ID: submissionID.String(),
					Code: "SUBMISSION_NOT_GRADABLE", Message: "submission has no essay content to grade",
				}
			}
			jobType = model.JobTypeAIGradeWriting
			params, merr = json.Marshal(model.AIGradeWritingParams{SubmissionID: submissionID.String()})
		case skillSpeaking:
			// D8: empty-audioKey guard. A keyless recording cannot be downloaded — reject
			// upfront (the worker WOULD refund, but the guard avoids a pointless
			// deduct+refund+job round-trip; the reason differs from writing's empty essay).
			if grading.SpeakingAudioKeyFromContent(sub.Content) == "" {
				return model.ConflictError{
					Resource: "submission", ID: submissionID.String(),
					Code: "SUBMISSION_NOT_GRADABLE", Message: "submission has no recording to grade",
				}
			}
			// D12: enqueue-time duration guard. Reject an over-long recording synchronously
			// (before the deduct), not deduct→enqueue→download→transcode→dead-end in the worker.
			if grading.SpeakingDurationMsFromContent(sub.Content) > maxAIGradeAudioDurationMs {
				return model.ConflictError{
					Resource: "submission", ID: submissionID.String(),
					Code: "SUBMISSION_TOO_LONG", Message: "recording is too long for AI grading",
				}
			}
			jobType = model.JobTypeAIGradeSpeaking
			params, merr = json.Marshal(model.AIGradeSpeakingParams{SubmissionID: submissionID.String()})
		default:
			// Dead-defense: the grade path only supports writing/speaking today.
			return model.ConflictError{
				Resource: "submission", ID: submissionID.String(),
				Code: "SUBMISSION_NOT_GRADABLE", Message: "this exercise skill cannot be AI graded",
			}
		}
		// SEC-7: the payload carries ONLY the submission id — the center is never read
		// from it; the job-row center_id (from tc) is the tenant anchor.
		if merr != nil {
			return fmt.Errorf("enqueue ai grade: marshal params: %w", merr)
		}
		job, jerr := q.InsertJob(ctx, generated.InsertJobParams{
			CenterID:            pgUUID(centerUUID),
			CreatedBy:           pgUUID(userID),
			Type:                string(jobType),
			Params:              params,
			ParamsSchemaVersion: model.AIJobParamsSchemaVersion,
		})
		if jerr != nil {
			// A 23505 on EITHER in-flight index bubbles up untranslated so EnqueueAIGrade
			// can resolve the existing job after the tx rolls back (D6/D9).
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
			existingID, ferr := s.findInflightJob(ctx, tc, submissionID, resolvedSkill)
			if ferr != nil {
				return uuid.Nil, false, ferr
			}
			return existingID, true, nil
		}
		return uuid.Nil, false, err
	}
	return jobID, false, nil
}

// isInflightIndexViolation reports whether err is a 23505 on EITHER the writing or the
// speaking partial in-flight unique index (D6/D9) — the idempotency signal, distinct
// from any other unique violation (which stays a real error). Covering BOTH names is
// load-bearing: a miss on the speaking index = a double-charge (D16).
func isInflightIndexViolation(err error) bool {
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) || pgErr.Code != "23505" {
		return false
	}
	return pgErr.ConstraintName == inflightJobUniqueIndex || pgErr.ConstraintName == inflightSpeakingJobUniqueIndex
}

// findInflightJob returns the id of the existing in-flight (pending/processing)
// ai_grade_{writing,speaking} job for a submission, in a fresh tenant-scoped read tx
// (the enqueue tx has rolled back). The resolvedSkill (hoisted from the enqueue, D16)
// selects the SPEAKING twin query so a speaking 23505 resolves the speaking job — not
// the writing one. At most one such row exists (the partial index).
func (s *AIGradeService) findInflightJob(
	ctx context.Context, tc model.TenantContext, submissionID uuid.UUID, resolvedSkill string,
) (uuid.UUID, error) {
	var jobID uuid.UUID
	err := s.readInTenantTx(ctx, tc, func(q *generated.Queries) error {
		var row generated.Job
		var qerr error
		if resolvedSkill == skillSpeaking {
			row, qerr = q.GetInflightAISpeakingGradeJobForSubmission(ctx, []byte(submissionID.String()))
		} else {
			row, qerr = q.GetInflightAIGradeJobForSubmission(ctx, []byte(submissionID.String()))
		}
		if qerr != nil {
			if errors.Is(qerr, pgx.ErrNoRows) {
				// The in-flight job completed/failed between the 23505 and this read —
				// nothing to return; surface a conflict so the caller can retry.
				return model.ConflictError{
					Resource: "submission", ID: submissionID.String(),
					Code: "AI_GRADE_ENQUEUE_CONFLICT", Message: "an AI grade for this submission changed state; retry",
				}
			}
			return fmt.Errorf("enqueue ai grade: find in-flight job: %w", qerr)
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
