// Package workers provides the worker tenant-context test harness.
//
// WHY THIS EXISTS
//
// Workers are peer entry points to handlers. They pull jobs via
// SELECT … FOR UPDATE SKIP LOCKED. Each job row carries a center_id, and
// the worker MUST execute SET LOCAL app.current_tenant_id = '<center_id>'
// from the row inside the same transaction as any DB op the handler makes.
// Missing this step is the async equivalent of GO-1 — cross-tenant data
// leakage that compiles clean and silently uses whatever tenant id the
// connection happened to hold last. This is risk R3 from the test design,
// scored BLOCK (9).
//
// MANDATORY ADVERSARIAL PATTERN PER JOB TYPE
//
// Every worker job type ships with three tests using this harness:
//
//  1. Test<Worker>_HappyPath
//     ProcessSpecific — happy path, asserts downstream effects.
//
//  2. Test<Worker>_PayloadCenterIdIgnored
//     EnqueueJob with a payload whose center_id field references tenant B
//     while the job row's CenterID is tenant A. The handler must read from
//     the row, not the payload. RLS returns 0 rows → NotFoundError.
//
//  3. Test<Worker>_NullTenantContextRejected
//     ProcessWithoutTenantContext — simulates the SET LOCAL bug. Every DB
//     op the handler attempts must return 0 rows, NEVER all rows.
//
// EPIC 4 MIGRATION NOTE
//
// The job storage is currently in-memory because the real `jobs` table
// lands in Epic 4 Story 4.3. When that ships, EnqueueJob will INSERT into
// the table and ProcessSpecific/ProcessNext will SELECT … FOR UPDATE
// SKIP LOCKED inside the test transaction. The public API
// (SetupWorkerHarness, EnqueueJob, ProcessSpecific,
// ProcessWithoutTenantContext, JobStatus) stays stable — only the
// implementation backing changes.
package workers

import (
	"context"
	"encoding/json"
	"fmt"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/model"
	testpkg "github.com/ducdo/classlite-api/internal/test"
)

// JobHandler is implemented by every worker job type. ProcessTask is called
// by the harness in tests AND by the real production worker loop. The
// TenantContext is established from the job row's CenterID BEFORE this
// method is invoked. Handlers MUST NOT re-derive tenant identity from the
// payload — payload fields that look tenant-ish are untrusted user input.
type JobHandler interface {
	ProcessTask(ctx context.Context, tc model.TenantContext, payload json.RawMessage) error
}

// JobStatus values mirror the production jobs.status enum.
const (
	StatusPending    = "pending"
	StatusProcessing = "processing"
	StatusComplete   = "complete"
	StatusFailed     = "failed"
)

// jobRow mirrors the production jobs-table row in-memory until Epic 4 ships
// the real table. Fields match the planned schema.
type jobRow struct {
	ID        uuid.UUID
	CenterID  string
	JobType   string
	Payload   json.RawMessage
	Status    string
	CreatedAt time.Time
}

// WorkerHarness is the test infrastructure for worker job types. Mirrors
// the ergonomics of test.SetupDB: transaction-wrapped, auto-rollback on
// test cleanup, deterministic clock.
type WorkerHarness struct {
	// DB is the transaction-wrapped test DB. Use it to seed fixtures and
	// to assert downstream DB effects after a handler runs.
	DB *testpkg.TxDB

	// Clock is a deterministic mock clock seeded at 2026-06-05 00:00 UTC.
	// Handlers that depend on time should accept a clock.Clock dependency
	// and the test should inject h.Clock.
	Clock *clock.MockClock

	mu   sync.Mutex
	jobs map[uuid.UUID]*jobRow
}

// SetupWorkerHarness mirrors test.SetupDB(t). Transaction-wrapped DB,
// auto-rollback on t.Cleanup. Returns a ready-to-use harness with an empty
// job map and a fresh MockClock.
func SetupWorkerHarness(t *testing.T) *WorkerHarness {
	t.Helper()
	return &WorkerHarness{
		DB:    testpkg.SetupDB(t),
		Clock: clock.NewMockClock(time.Date(2026, 6, 5, 0, 0, 0, 0, time.UTC)),
		jobs:  make(map[uuid.UUID]*jobRow),
	}
}

// EnqueueJob inserts a new job scoped to tenantID. The job row's CenterID
// is THE tenant trust anchor — payload-supplied tenant fields are ignored
// at dequeue time.
//
// tenantID must be a valid UUID string. Use the deterministic test tenant
// constants from package test (test.TenantAID, test.TenantBID) for
// adversarial cross-tenant scenarios.
func (h *WorkerHarness) EnqueueJob(t *testing.T, tenantID, jobType string, payload any) uuid.UUID {
	t.Helper()

	if _, err := uuid.Parse(tenantID); err != nil {
		t.Fatalf("EnqueueJob: tenantID %q is not a valid UUID: %v", tenantID, err)
	}

	raw, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("EnqueueJob: marshal payload: %v", err)
	}

	job := &jobRow{
		ID:        uuid.New(),
		CenterID:  tenantID,
		JobType:   jobType,
		Payload:   raw,
		Status:    StatusPending,
		CreatedAt: h.Clock.Now(),
	}

	h.mu.Lock()
	h.jobs[job.ID] = job
	h.mu.Unlock()

	return job.ID
}

// ProcessSpecific dequeues the given job, establishes tenant context from
// the JOB ROW (not payload), and calls the handler. This is the primary
// path for HappyPath and PayloadCenterIdIgnored test patterns.
func (h *WorkerHarness) ProcessSpecific(ctx context.Context, t *testing.T, jobID uuid.UUID, handler JobHandler) error {
	t.Helper()
	if ctx == nil {
		ctx = context.Background()
	}

	job := h.getJob(t, jobID, "ProcessSpecific")
	h.setStatus(jobID, StatusProcessing)

	// Establish tenant context from the JOB ROW. This is the single most
	// important invariant for R3 mitigation.
	centerPgUUID, err := parsePgxUUID(job.CenterID)
	if err != nil {
		t.Fatalf("ProcessSpecific: parse job.CenterID %q: %v", job.CenterID, err)
	}
	ctx = testpkg.TenantContext(t, h.DB, centerPgUUID)

	tc := model.TenantContext{
		CenterID: job.CenterID,
		// UserID and Role intentionally left zero. Real workers populate
		// these from job metadata fields when applicable; the harness
		// stays minimal so tests can opt in.
	}

	handlerErr := handler.ProcessTask(ctx, tc, job.Payload)
	if handlerErr != nil {
		h.setStatus(jobID, StatusFailed)
	} else {
		h.setStatus(jobID, StatusComplete)
	}
	return handlerErr
}

// ProcessWithoutTenantContext dequeues the job and calls the handler
// WITHOUT setting app.current_tenant_id (it is explicitly cleared first).
// Use this ONLY in the Test<Worker>_NullTenantContextRejected adversarial
// pattern. Every DB op the handler attempts must return 0 rows, never
// all rows.
//
// The expected outcome is that the handler returns a NotFoundError (or
// equivalent typed error) because RLS filtered every row out. The test
// asserts that — never asserts a successful path here.
func (h *WorkerHarness) ProcessWithoutTenantContext(ctx context.Context, t *testing.T, jobID uuid.UUID, handler JobHandler) error {
	t.Helper()
	if ctx == nil {
		ctx = context.Background()
	}

	job := h.getJob(t, jobID, "ProcessWithoutTenantContext")
	h.setStatus(jobID, StatusProcessing)

	// Explicitly clear tenant context. This simulates the bug where a
	// worker forgets to call SET LOCAL after dequeue.
	if _, err := h.DB.Tx.Exec(ctx, "SET LOCAL app.current_tenant_id = ''"); err != nil {
		t.Fatalf("ProcessWithoutTenantContext: reset tenant context: %v", err)
	}

	tc := model.TenantContext{CenterID: job.CenterID}
	return handler.ProcessTask(ctx, tc, job.Payload)
}

// JobStatus returns the current status of a job. Useful for assertions
// like require.Equal(t, workers.StatusFailed, h.JobStatus(t, jobID)).
func (h *WorkerHarness) JobStatus(t *testing.T, jobID uuid.UUID) string {
	t.Helper()
	return h.getJob(t, jobID, "JobStatus").Status
}

// JobPayload returns the raw payload bytes for the given job. Useful for
// asserting payload integrity after a handler runs (e.g., refund paths
// that update payload metadata).
func (h *WorkerHarness) JobPayload(t *testing.T, jobID uuid.UUID) json.RawMessage {
	t.Helper()
	return h.getJob(t, jobID, "JobPayload").Payload
}

func (h *WorkerHarness) getJob(t *testing.T, jobID uuid.UUID, caller string) *jobRow {
	t.Helper()
	h.mu.Lock()
	defer h.mu.Unlock()
	job, ok := h.jobs[jobID]
	if !ok {
		t.Fatalf("%s: job %s not found in harness", caller, jobID)
	}
	return job
}

func (h *WorkerHarness) setStatus(jobID uuid.UUID, status string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if job, ok := h.jobs[jobID]; ok {
		job.Status = status
	}
}

// parsePgxUUID converts a UUID string to pgtype.UUID for use with the
// existing test.TenantContext helper.
func parsePgxUUID(id string) (pgtype.UUID, error) {
	parsed, err := uuid.Parse(id)
	if err != nil {
		return pgtype.UUID{}, fmt.Errorf("parse uuid %q: %w", id, err)
	}
	return pgtype.UUID{Bytes: parsed, Valid: true}, nil
}
