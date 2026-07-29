// Story 4.3a — the durable job dispatcher. It claims jobs with SELECT … FOR
// UPDATE SKIP LOCKED, re-establishes tenant context from the CLAIMED ROW's
// center_id (SEC-6 — the async GO-1), dispatches to the registered handler, and
// on failure either reschedules with backoff (transient) or marks the job
// terminal + refunds the credit (idempotently). ProcessOnce / SweepStuckJobs are
// the deterministic testable units (driven by the harness against a single
// tenant-scoped tx); Start is the production loop wired in main.go, which
// discovers ready work across tenants via SECURITY DEFINER functions and runs
// each job in its own panic-recovered tx.
package worker

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/gemini"
	"github.com/ducdo/classlite-api/internal/model"
	"github.com/ducdo/classlite-api/internal/store/generated"
)

const (
	// workerPoolSize is the number of concurrent claim loops (NFR: pool 3).
	workerPoolSize = 3
	// claimInterval is how often each worker polls for a ready job.
	claimInterval = 1 * time.Second
	// sweepInterval is how often the stuck-sweep runs (the 5-minute threshold is
	// model.StuckJobTimeout — the interval is the check cadence, not the age).
	sweepInterval = 1 * time.Minute
	// maxJobsPerDrain bounds a single worker's drain so the sweep + shutdown are
	// never starved by an unbounded backlog.
	maxJobsPerDrain = 50
	// resultSchemaVersion stamps jobs.result_schema_version (GO-7).
	resultSchemaVersion = 1
)

// Dispatcher routes claimed jobs to their handlers. db is the direct-exec handle
// for the unit path (ProcessOnce/SweepStuckJobs run on the harness tx); pool is
// the production per-job tx source (nil in unit tests). clk drives all backoff /
// claim / stuck timing (BC-2 — never SQL now()).
type Dispatcher struct {
	db       generated.DBTX
	pool     *pgxpool.Pool
	gem      gemini.Client
	clk      clock.Clock
	handlers map[model.JobType]GenerationHandler
}

// NewDispatcher builds a dispatcher over a single DBTX for the unit/harness path
// (ProcessOnce / SweepStuckJobs run against it directly). The caller is expected
// to have the tenant context set on that handle before ProcessOnce.
func NewDispatcher(db generated.DBTX, gem gemini.Client, clk clock.Clock, handlers ...GenerationHandler) *Dispatcher {
	return &Dispatcher{db: db, gem: gem, clk: clk, handlers: indexHandlers(handlers)}
}

// NewPoolDispatcher builds the production dispatcher over a pool. Start opens a
// fresh tenant-scoped tx per job.
func NewPoolDispatcher(pool *pgxpool.Pool, gem gemini.Client, clk clock.Clock, handlers ...GenerationHandler) *Dispatcher {
	return &Dispatcher{pool: pool, gem: gem, clk: clk, handlers: indexHandlers(handlers)}
}

func indexHandlers(handlers []GenerationHandler) map[model.JobType]GenerationHandler {
	m := make(map[model.JobType]GenerationHandler, len(handlers))
	for _, h := range handlers {
		m[h.JobType()] = h
	}
	return m
}

// ProcessOnce claims and processes the next ready job for the tenant currently
// set on the dispatcher's DBTX. Returns nil when there is nothing to claim.
func (d *Dispatcher) ProcessOnce(ctx context.Context) error {
	return d.processOnce(ctx, d.db)
}

func (d *Dispatcher) processOnce(ctx context.Context, exec generated.DBTX) error {
	q := generated.New(exec)
	now := pgTime(d.clk.Now())

	job, err := q.ClaimNextJob(ctx, now)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil // nothing ready
	}
	if err != nil {
		return fmt.Errorf("claim next job: %w", err)
	}

	// SEC-6: re-establish tenant context from the JOB ROW before any handler DB
	// op. The RLS-scoped claim already guarantees job.center == the set tenant;
	// this makes the row the explicit, authoritative source.
	centerID := pgUUIDToString(job.CenterID)
	if err := setTenant(ctx, exec, centerID); err != nil {
		return fmt.Errorf("set tenant from job row: %w", err)
	}
	return d.dispatch(ctx, exec, job)
}

// dispatch runs the handler for an already-claimed job (tenant context already
// set on exec) and writes the terminal/complete outcome. It is shared by the unit
// path (processOnce, single tx) and the production tx2 (processClaimed). It does
// NOT claim — the row is already 'processing'.
func (d *Dispatcher) dispatch(ctx context.Context, exec generated.DBTX, job generated.Job) error {
	q := generated.New(exec)
	now := pgTime(d.clk.Now())
	centerID := pgUUIDToString(job.CenterID)
	tc := model.TenantContext{CenterID: centerID}

	// AC3: the payload center_id is IGNORED for tenancy (row is the sole anchor);
	// a mismatch against the row is logged as a discrepancy/attack signal.
	logCenterDiscrepancy(job)

	handler := d.handlers[model.JobType(job.Type)]
	if handler == nil {
		// No handler for this type — terminal (a misrouted job won't self-heal).
		return d.terminalFail(ctx, q, job, now, "unknown_job_type")
	}

	result, genErr := handler.generate(ctx, exec, d.gem, tc, job.Params)
	if genErr != nil {
		return d.handleFailure(ctx, q, job, now, genErr)
	}
	rows, err := q.MarkJobComplete(ctx, generated.MarkJobCompleteParams{
		Result:              result,
		ResultSchemaVersion: pgInt4(resultSchemaVersion),
		Now:                 now,
		ID:                  job.ID,
	})
	if err != nil {
		return fmt.Errorf("mark complete: %w", err)
	}
	if rows == 0 {
		// The row was already terminal (e.g. a slow job the stuck-sweep failed +
		// refunded before this completed). The status='processing' guard made the
		// complete a no-op; the generated result is discarded (do NOT overwrite a
		// refunded terminal state). Not an error — nothing to retry.
		slog.Warn("ai_generation_result_discarded_already_terminal",
			"center_id", centerID, "job_id", pgUUIDToString(job.ID), "type", job.Type)
		return nil
	}
	slog.Info("ai_generation_complete",
		"center_id", centerID, "job_id", pgUUIDToString(job.ID), "type", job.Type)
	return nil
}

// handleFailure classifies a generation error and either reschedules with backoff
// or marks the job terminal + refunds. Retryable (AC5): a transient Gemini failure
// OR an unexpected infra/store error (e.g. a transient DB blip on the exercise
// read) — a momentary failure must not permanently kill a viable job. Terminal:
// an invalid_ai_response (AC6, never retried) or a missing target (retry can't
// help). Terminal on retry exhaustion refunds the credit (AC7).
func (d *Dispatcher) handleFailure(ctx context.Context, q *generated.Queries, job generated.Job, now pgtype.Timestamptz, genErr error) error {
	// Invalid AI response → terminal immediately, never retried (AC6).
	if errors.Is(genErr, ErrInvalidAIResponse) {
		return d.terminalFail(ctx, q, job, now, model.JobErrorInvalidAIResponse)
	}
	// Missing/cross-tenant target → terminal; a retry cannot make it appear.
	var notFound model.NotFoundError
	if errors.As(genErr, &notFound) {
		return d.terminalFail(ctx, q, job, now, "generation_failed")
	}
	// Transient Gemini failure OR an unexpected infra error → retry with backoff.
	if job.RetryCount < job.MaxRetries {
		// Bound the index by the backoff slice, not just the DB-controlled
		// max_retries column, so a row with max_retries > len(JobRetryBackoffs)
		// clamps to the last backoff instead of panicking (chunk-1 DF2).
		i := int(job.RetryCount)
		if i >= len(model.JobRetryBackoffs) {
			i = len(model.JobRetryBackoffs) - 1
		}
		backoff := model.JobRetryBackoffs[i]
		next := pgTime(d.clk.Now().Add(backoff))
		if err := q.RescheduleJob(ctx, generated.RescheduleJobParams{
			ErrorDetails:  pgText("transient_failure"),
			NextAttemptAt: next,
			ID:            job.ID,
		}); err != nil {
			return fmt.Errorf("reschedule: %w", err)
		}
		slog.Warn("ai_generation_retry_scheduled",
			"center_id", pgUUIDToString(job.CenterID), "job_id", pgUUIDToString(job.ID),
			"retry_count", job.RetryCount+1, "backoff", backoff.String())
		return nil
	}
	return d.terminalFail(ctx, q, job, now, model.JobErrorMaxRetries)
}

// terminalFail marks the job failed and refunds the credit. The refund fires ONLY
// when MarkJobFailedTerminal actually transitioned the row (rows affected == 1):
// the status='processing' guard makes it a 0-row no-op when the job already went
// terminal (e.g. it completed just before the stuck-sweep), and refunding on top
// of a delivered result would be free generation. The unique (ref_job_id, reason)
// index remains the second line of defense against a worker/sweep double-refund (AC7).
func (d *Dispatcher) terminalFail(ctx context.Context, q *generated.Queries, job generated.Job, now pgtype.Timestamptz, detail string) error {
	rows, err := q.MarkJobFailedTerminal(ctx, generated.MarkJobFailedTerminalParams{
		ErrorDetails: pgText(detail),
		Now:          now,
		ID:           job.ID,
	})
	if err != nil {
		return fmt.Errorf("mark failed: %w", err)
	}
	if rows == 0 {
		// Already terminal (completed or failed elsewhere) — do not refund.
		slog.Info("ai_generation_terminal_noop",
			"center_id", pgUUIDToString(job.CenterID), "job_id", pgUUIDToString(job.ID),
			"error_details", detail)
		return nil
	}
	if err := q.RefundJob(ctx, job.ID); err != nil {
		return fmt.Errorf("refund: %w", err)
	}
	slog.Info("ai_generation_failed",
		"center_id", pgUUIDToString(job.CenterID), "job_id", pgUUIDToString(job.ID),
		"error_details", detail)
	return nil
}

// logCenterDiscrepancy compares the UNTRUSTED payload center_id against the
// authoritative job-row center_id and logs a warning on mismatch (AC3 — the
// payload is ignored for tenancy but a mismatch is an attack/bug signal). Only
// non-sensitive ids are logged (R49).
func logCenterDiscrepancy(job generated.Job) {
	var claim struct {
		CenterID string `json:"centerId"`
	}
	if err := json.Unmarshal(job.Params, &claim); err != nil {
		return // unparseable params surface as invalid_ai_response in the handler
	}
	rowCenter := pgUUIDToString(job.CenterID)
	if claim.CenterID != "" && claim.CenterID != rowCenter {
		slog.Warn("ai_generation_center_id_discrepancy",
			"job_id", pgUUIDToString(job.ID),
			"row_center_id", rowCenter, "payload_center_id", claim.CenterID)
	}
}

// SweepStuckJobs marks every job stuck in 'processing' past the 5-minute
// threshold (for the tenant set on the dispatcher's DBTX) as failed + refunds it
// (AC7). Idempotent via the unique refund index.
func (d *Dispatcher) SweepStuckJobs(ctx context.Context) error {
	return d.sweepStuck(ctx, d.db)
}

func (d *Dispatcher) sweepStuck(ctx context.Context, exec generated.DBTX) error {
	q := generated.New(exec)
	threshold := pgTime(d.clk.Now().Add(-model.StuckJobTimeout))
	stuck, err := q.FindStuckProcessingJobs(ctx, threshold)
	if err != nil {
		return fmt.Errorf("find stuck jobs: %w", err)
	}
	now := pgTime(d.clk.Now())
	for _, s := range stuck {
		// terminalFail needs a Job; only ID/CenterID matter for the sweep path.
		job := generated.Job{ID: s.ID, CenterID: s.CenterID}
		if err := d.terminalFail(ctx, q, job, now, model.JobErrorStuckTimeout); err != nil {
			return err
		}
	}
	return nil
}

// Start runs the production dispatcher until ctx is cancelled — workerPoolSize
// claim loops plus one stuck-sweep loop, each honoring ctx.Done() so
// cancelWorker() drains cleanly. Cross-tenant readiness is discovered via
// SECURITY DEFINER functions (the dispatcher is infrastructure, so it crosses
// tenants to find work), then each job runs under its own tenant-scoped tx.
func (d *Dispatcher) Start(ctx context.Context) {
	if d.pool == nil {
		slog.Error("dispatcher Start called without a pool — did you use NewDispatcher instead of NewPoolDispatcher?")
		return
	}
	for i := 0; i < workerPoolSize; i++ {
		go d.claimLoop(ctx)
	}
	d.sweepLoop(ctx)
}

func (d *Dispatcher) claimLoop(ctx context.Context) {
	ticker := time.NewTicker(claimInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			d.drainReady(ctx)
		}
	}
}

func (d *Dispatcher) sweepLoop(ctx context.Context) {
	ticker := time.NewTicker(sweepInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			d.sweepAllTenants(ctx)
		}
	}
}

// drainReady processes ready jobs until none remain (bounded) or ctx is done.
// Each job is claimed in its OWN committed tx (claimJob) and then processed in a
// SEPARATE tx (processClaimed) — so a panic/error during processing leaves the
// row committed as 'processing' for the stuck-sweep to terminal-fail+refund,
// instead of rolling the claim back into an infinite re-claim loop. The recover
// guards the discovery/scan scaffolding (which runs outside processClaimed's
// per-job recover) so a panic there cannot crash the worker process.
func (d *Dispatcher) drainReady(ctx context.Context) {
	defer recoverLoop("drainReady")
	for i := 0; i < maxJobsPerDrain; i++ {
		if ctx.Err() != nil {
			return
		}
		center, ok := d.nextReadyCenter(ctx)
		if !ok {
			return
		}
		job, ok := d.claimJob(ctx, center)
		if !ok {
			// Nothing claimable in that center (another loop won the SKIP LOCKED
			// race, or it drained) — move on; the bounded loop guarantees progress.
			continue
		}
		d.processClaimed(ctx, job)
	}
}

func (d *Dispatcher) sweepAllTenants(ctx context.Context) {
	defer recoverLoop("sweepAllTenants")
	rows, err := d.pool.Query(ctx, `SELECT stuck_job_centers($1)`, pgTime(d.clk.Now().Add(-model.StuckJobTimeout)))
	if err != nil {
		slog.Error("stuck sweep: discover centers", "error", err)
		return
	}
	var centers []string
	for rows.Next() {
		var c pgtype.UUID
		if err := rows.Scan(&c); err != nil {
			slog.Error("stuck sweep: scan center", "error", err)
			continue
		}
		centers = append(centers, pgUUIDToString(c))
	}
	rows.Close()
	for _, center := range centers {
		if ctx.Err() != nil {
			return
		}
		d.runInTenantTx(ctx, center, d.sweepStuck)
	}
}

// claimJob claims the next ready job for centerID in its OWN committed tx, so the
// 'processing' state survives a later panic/crash (the stuck-sweep reclaims it)
// and is visible to next_ready_job_center (so sibling loops stop re-discovering
// it). Returns ok=false when nothing was claimable (empty / lost the SKIP LOCKED
// race / a DB error, which is logged). The claim commit uses the cancellable ctx:
// a shutdown between claim and process cleanly leaves the row 'pending'.
func (d *Dispatcher) claimJob(ctx context.Context, centerID string) (generated.Job, bool) {
	tx, err := d.pool.Begin(ctx)
	if err != nil {
		slog.Error("dispatcher: begin claim tx", "center_id", centerID, "error", err)
		return generated.Job{}, false
	}
	defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }()

	if err := setTenant(ctx, tx, centerID); err != nil {
		slog.Error("dispatcher: set tenant (claim)", "center_id", centerID, "error", err)
		return generated.Job{}, false
	}
	job, err := generated.New(tx).ClaimNextJob(ctx, pgTime(d.clk.Now()))
	if errors.Is(err, pgx.ErrNoRows) {
		return generated.Job{}, false
	}
	if err != nil {
		slog.Error("dispatcher: claim next job", "center_id", centerID, "error", err)
		return generated.Job{}, false
	}
	if err := tx.Commit(ctx); err != nil {
		slog.Error("dispatcher: commit claim", "center_id", centerID, "error", err)
		return generated.Job{}, false
	}
	return job, true
}

// processClaimed runs an already-claimed (committed 'processing') job in a fresh
// panic-recovered tx and commits its outcome. On panic/error the tx rolls back
// but the CLAIM persists — the stuck-sweep will terminal-fail+refund the row, so
// there is no infinite re-claim (a claimed row is no longer 'pending', so it is
// not re-discovered). The outcome commit uses context.WithoutCancel so a job that
// finished generating at shutdown is not rolled back and re-run (double spend).
func (d *Dispatcher) processClaimed(ctx context.Context, job generated.Job) {
	centerID := pgUUIDToString(job.CenterID)
	tx, err := d.pool.Begin(ctx)
	if err != nil {
		slog.Error("dispatcher: begin process tx", "center_id", centerID, "error", err)
		return
	}
	defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }()

	// SEC-6: set tenant from the job ROW before any handler DB op.
	if err := setTenant(ctx, tx, centerID); err != nil {
		slog.Error("dispatcher: set tenant (process)", "center_id", centerID, "error", err)
		return
	}
	if err := runRecovered(func(c context.Context, exec generated.DBTX) error {
		return d.dispatch(c, exec, job)
	}, ctx, tx); err != nil {
		// Claim persists as committed 'processing'; the stuck-sweep terminal-fails
		// + refunds it (no poison-pill re-claim loop).
		slog.Error("dispatcher: process job", "center_id", centerID,
			"job_id", pgUUIDToString(job.ID), "error", err)
		return
	}
	if err := tx.Commit(context.WithoutCancel(ctx)); err != nil {
		slog.Error("dispatcher: commit", "center_id", centerID, "error", err)
	}
}

// nextReadyCenter asks the SECURITY DEFINER discovery function for the center of
// the next ready job (cross-tenant), returning ok=false when the queue is empty.
// A real DB error is logged (not silently indistinguishable from an idle queue).
func (d *Dispatcher) nextReadyCenter(ctx context.Context) (string, bool) {
	var center pgtype.UUID
	if err := d.pool.QueryRow(ctx, `SELECT next_ready_job_center($1)`, pgTime(d.clk.Now())).Scan(&center); err != nil {
		slog.Error("dispatcher: discover next ready center", "error", err)
		return "", false
	}
	if !center.Valid {
		return "", false // NULL = empty queue
	}
	return pgUUIDToString(center), true
}

// runInTenantTx opens a tenant-scoped tx, sets the tenant, runs fn with panic
// recovery, and commits with context.WithoutCancel so an in-flight sweep is not
// lost on shutdown. Used by the stuck-sweep (idempotent); the per-job path uses
// the claimJob/processClaimed split.
func (d *Dispatcher) runInTenantTx(ctx context.Context, centerID string, fn func(context.Context, generated.DBTX) error) {
	tx, err := d.pool.Begin(ctx)
	if err != nil {
		slog.Error("dispatcher: begin tx", "error", err)
		return
	}
	defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }()

	if err := setTenant(ctx, tx, centerID); err != nil {
		slog.Error("dispatcher: set tenant", "center_id", centerID, "error", err)
		return
	}
	if err := runRecovered(fn, ctx, tx); err != nil {
		slog.Error("dispatcher: process job", "center_id", centerID, "error", err)
		return
	}
	if err := tx.Commit(context.WithoutCancel(ctx)); err != nil {
		slog.Error("dispatcher: commit", "center_id", centerID, "error", err)
	}
}

// recoverLoop converts a panic in a discovery/scan loop body into a logged error
// so the worker process survives (the ticker fires the loop again next interval).
func recoverLoop(name string) {
	if rec := recover(); rec != nil {
		slog.Error("dispatcher: loop panic recovered", "loop", name, "panic", rec)
	}
}

// runRecovered wraps fn in panic recovery so a panicking handler is converted to
// an error rather than crashing the worker goroutine.
func runRecovered(fn func(context.Context, generated.DBTX) error, ctx context.Context, exec generated.DBTX) (err error) {
	defer func() {
		if rec := recover(); rec != nil {
			slog.Error("dispatcher: job panic recovered", "panic", rec)
			err = fmt.Errorf("job panic: %v", rec)
		}
	}()
	return fn(ctx, exec)
}

// --- small pg helpers ---

func setTenant(ctx context.Context, exec generated.DBTX, centerID string) error {
	// set_config(..., true) is transaction-local (PERF-1) and bind-param safe.
	_, err := exec.Exec(ctx, `SELECT set_config('app.current_tenant_id', $1, true)`, centerID)
	return err
}

func pgTime(t time.Time) pgtype.Timestamptz { return pgtype.Timestamptz{Time: t, Valid: true} }
func pgInt4(i int32) pgtype.Int4            { return pgtype.Int4{Int32: i, Valid: true} }
func pgText(s string) pgtype.Text           { return pgtype.Text{String: s, Valid: true} }
