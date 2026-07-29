// Story 4.3a — the enqueue + poll service for the AI content-generation
// pipeline. EnqueueGeneration OWNS its tx (BC-1): scope-gate the exercise (reuse
// 4.1's assertClassRole + assertExerciseTeacherScope — student → 403,
// cross-teacher/missing → 404 EXERCISE_NOT_FOUND, no oracle), then in ONE tx
// insert the pending job AND the -1 job_deduction (R23/A6). It NEVER calls Gemini
// (PERF-3) — the durable worker does. GetJob is the RLS-scoped poll read; a job
// in another tenant returns 404 JOB_NOT_FOUND.
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

// AIGenerationService enqueues generation jobs and reads job state.
type AIGenerationService struct {
	db AuthDB
}

// NewAIGenerationService constructs the service bound to the DB pool.
func NewAIGenerationService(db AuthDB) *AIGenerationService {
	return &AIGenerationService{db: db}
}

func jobNotFound(id uuid.UUID) error {
	return model.NotFoundError{Resource: "job", ID: id.String(), Code: "JOB_NOT_FOUND"}
}

// EnqueueGeneration scope-gates the target exercise, then in a single tx inserts
// the pending job and the -1 job_deduction, returning the new job id. It does not
// call Gemini. jobType is the resolved model.JobType (the handler mapped the
// request `mode`); params is the canonical, path-derived job payload (the request
// cannot smuggle a tenant — CenterIDClaim is stripped by the handler and ignored
// by the worker regardless).
func (s *AIGenerationService) EnqueueGeneration(
	ctx context.Context, tc model.TenantContext, exerciseID uuid.UUID, jobType model.JobType, params []byte,
) (uuid.UUID, error) {
	if err := assertClassRole(tc); err != nil {
		return uuid.Nil, err
	}
	centerUUID, err := uuid.Parse(tc.CenterID)
	if err != nil {
		return uuid.Nil, fmt.Errorf("enqueue generation: parse center id: %w", err)
	}
	userUUID, err := uuid.Parse(tc.UserID)
	if err != nil {
		return uuid.Nil, fmt.Errorf("enqueue generation: parse user id: %w", err)
	}

	var jobID uuid.UUID
	err = s.mutateInTenantTx(ctx, tc, func(q *generated.Queries) error {
		exercise, err := q.GetExerciseByID(ctx, pgUUID(exerciseID))
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return model.NotFoundError{Resource: "exercise", ID: exerciseID.String(), Code: "EXERCISE_NOT_FOUND"}
			}
			return fmt.Errorf("enqueue generation: get exercise: %w", err)
		}
		if err := assertExerciseTeacherScope(tc, exercise.CreatedBy, exerciseID); err != nil {
			return err
		}

		job, err := q.InsertJob(ctx, generated.InsertJobParams{
			CenterID:            pgUUID(centerUUID),
			CreatedBy:           pgUUID(userUUID),
			Type:                string(jobType),
			Params:              params,
			ParamsSchemaVersion: model.AIJobParamsSchemaVersion,
		})
		if err != nil {
			return fmt.Errorf("enqueue generation: insert job: %w", err)
		}
		jobID = uuidFromPg(job.ID)

		if err := q.InsertJobDeduction(ctx, generated.InsertJobDeductionParams{
			CenterID: pgUUID(centerUUID),
			UserID:   pgUUID(userUUID),
			RefJobID: job.ID,
		}); err != nil {
			return fmt.Errorf("enqueue generation: deduct credit: %w", err)
		}
		return nil
	})
	if err != nil {
		return uuid.Nil, err
	}
	return jobID, nil
}

// GetJob returns the RLS-scoped job for the caller's tenant, or 404
// JOB_NOT_FOUND when the id is unknown or belongs to another tenant.
func (s *AIGenerationService) GetJob(
	ctx context.Context, tc model.TenantContext, jobID uuid.UUID,
) (generated.Job, error) {
	// Creator-scoped (D4): GetJobByID filters created_by = the caller, so only the
	// enqueuing user reads the job's AI result — a different user in the same
	// tenant (incl. a student) gets 404 JOB_NOT_FOUND, no oracle.
	userUUID, err := uuid.Parse(tc.UserID)
	if err != nil {
		return generated.Job{}, jobNotFound(jobID)
	}
	var job generated.Job
	err = s.readInTenantTx(ctx, tc, func(q *generated.Queries) error {
		row, err := q.GetJobByID(ctx, generated.GetJobByIDParams{
			ID:        pgUUID(jobID),
			CreatedBy: pgUUID(userUUID),
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return jobNotFound(jobID)
			}
			return fmt.Errorf("get job: %w", err)
		}
		job = row
		return nil
	})
	return job, err
}

func (s *AIGenerationService) readInTenantTx(
	ctx context.Context, tc model.TenantContext, fn func(*generated.Queries) error,
) error {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return fmt.Errorf("ai generation read tx: begin: %w", err)
	}
	defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }()

	if err := store.SetTenantContext(ctx, tx, tc); err != nil {
		return fmt.Errorf("ai generation read tx: %w", err)
	}
	if err := fn(generated.New(tx)); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (s *AIGenerationService) mutateInTenantTx(
	ctx context.Context, tc model.TenantContext, fn func(*generated.Queries) error,
) error {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return fmt.Errorf("ai generation mutate tx: begin: %w", err)
	}
	defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }()

	if err := store.SetTenantContext(ctx, tx, tc); err != nil {
		return fmt.Errorf("ai generation mutate tx: %w", err)
	}
	if err := fn(generated.New(tx)); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
