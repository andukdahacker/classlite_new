// Package workers provides the worker tenant-context test harness.
//
// # WHY THIS EXISTS
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
// # MANDATORY ADVERSARIAL PATTERN PER JOB TYPE
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
// EPIC 4 MIGRATION (Story 4.3a — DONE)
//
// The real `jobs` table now backs the harness: EnqueueJob INSERTs a row
// (RLS-scoped, tenant set from the enqueue tenant), ProcessSpecific SET
// LOCALs the tenant from the ROW's center_id before calling the handler and
// persists the terminal status, and JobStatus reads status back from the
// table. The public API (SetupWorkerHarness, EnqueueJob, ProcessSpecific,
// ProcessWithoutTenantContext, JobStatus, JobPayload) is unchanged — only the
// backing store moved from an in-memory map to the table. The map is retained
// purely as a test-side (id → center/type/payload) index so ProcessSpecific
// can establish tenant from the row without a bootstrap read.
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
	"github.com/ducdo/classlite-api/internal/store/generated"
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

// jobMeta is the test-side index of an enqueued job so ProcessSpecific can
// establish tenant from the row's center_id (and read the payload) without a
// bootstrap DB read. The authoritative status lives in the jobs table.
type jobMeta struct {
	CenterID string
	JobType  string
	Payload  json.RawMessage
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
	jobs map[uuid.UUID]*jobMeta
}

// SetupWorkerHarness mirrors test.SetupDB(t). Transaction-wrapped DB,
// auto-rollback on t.Cleanup. Returns a ready-to-use harness with an empty
// job index and a fresh MockClock.
func SetupWorkerHarness(t *testing.T) *WorkerHarness {
	t.Helper()
	return &WorkerHarness{
		DB:    testpkg.SetupDB(t),
		Clock: clock.NewMockClock(time.Date(2026, 6, 5, 0, 0, 0, 0, time.UTC)),
		jobs:  make(map[uuid.UUID]*jobMeta),
	}
}

// EnqueueJob INSERTs a new job scoped to tenantID into the real jobs table
// (RLS WITH CHECK requires the tenant be set, so this sets it first). The job
// row's CenterID is THE tenant trust anchor — payload-supplied tenant fields are
// ignored at dequeue time.
//
// tenantID must be a valid UUID string referencing an existing center. Use the
// deterministic test tenant constants from package test (test.TenantAID,
// test.TenantBID) for adversarial cross-tenant scenarios.
func (h *WorkerHarness) EnqueueJob(t *testing.T, tenantID, jobType string, payload any) uuid.UUID {
	t.Helper()

	centerUUID, err := uuid.Parse(tenantID)
	if err != nil {
		t.Fatalf("EnqueueJob: tenantID %q is not a valid UUID: %v", tenantID, err)
	}
	raw, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("EnqueueJob: marshal payload: %v", err)
	}

	centerPg := pgtype.UUID{Bytes: centerUUID, Valid: true}
	ctx := testpkg.TenantContext(t, h.DB, centerPg) // RLS: set tenant for the INSERT
	job, err := generated.New(h.DB).InsertJob(ctx, generated.InsertJobParams{
		CenterID:            centerPg,
		Type:                jobType,
		Params:              raw,
		ParamsSchemaVersion: 1,
	})
	if err != nil {
		t.Fatalf("EnqueueJob: insert job: %v", err)
	}
	id := uuid.UUID(job.ID.Bytes)

	h.mu.Lock()
	h.jobs[id] = &jobMeta{CenterID: tenantID, JobType: jobType, Payload: raw}
	h.mu.Unlock()
	return id
}

// ProcessSpecific dequeues the given job, establishes tenant context from
// the JOB ROW (not payload), calls the handler, and persists the terminal
// status. This is the primary path for HappyPath and PayloadCenterIdIgnored.
func (h *WorkerHarness) ProcessSpecific(ctx context.Context, t *testing.T, jobID uuid.UUID, handler JobHandler) error {
	t.Helper()

	meta := h.getMeta(t, jobID, "ProcessSpecific")

	// Establish tenant context from the JOB ROW center_id — the single most
	// important invariant for R3 mitigation.
	centerPg, err := parsePgxUUID(meta.CenterID)
	if err != nil {
		t.Fatalf("ProcessSpecific: parse center %q: %v", meta.CenterID, err)
	}
	ctx = testpkg.TenantContext(t, h.DB, centerPg)
	tc := model.TenantContext{CenterID: meta.CenterID}

	handlerErr := handler.ProcessTask(ctx, tc, meta.Payload)
	status := StatusComplete
	if handlerErr != nil {
		status = StatusFailed
	}
	h.setTableStatus(ctx, t, jobID, status)
	return handlerErr
}

// ProcessWithoutTenantContext dequeues the job and calls the handler WITHOUT
// setting app.current_tenant_id (it is explicitly cleared first). Use this ONLY
// in the Test<Worker>_NullTenantContextRejected pattern — every DB op the
// handler attempts must return 0 rows, never all rows.
func (h *WorkerHarness) ProcessWithoutTenantContext(ctx context.Context, t *testing.T, jobID uuid.UUID, handler JobHandler) error {
	t.Helper()
	if ctx == nil {
		ctx = context.Background()
	}

	meta := h.getMeta(t, jobID, "ProcessWithoutTenantContext")

	// Explicitly clear tenant context — simulates a worker that forgot SET LOCAL.
	if _, err := h.DB.Exec(ctx, "SET LOCAL app.current_tenant_id = ''"); err != nil {
		t.Fatalf("ProcessWithoutTenantContext: reset tenant context: %v", err)
	}
	tc := model.TenantContext{CenterID: meta.CenterID}
	return handler.ProcessTask(ctx, tc, meta.Payload)
}

// JobStatus returns the current status of a job, read back from the table. For a
// harness-enqueued job the tenant is (re)set from its known center so the RLS
// read is reliable; externally-seeded jobs rely on the ambient tenant.
func (h *WorkerHarness) JobStatus(t *testing.T, jobID uuid.UUID) string {
	t.Helper()
	h.mu.Lock()
	meta, ok := h.jobs[jobID]
	h.mu.Unlock()
	if ok {
		if centerPg, err := parsePgxUUID(meta.CenterID); err == nil {
			_ = testpkg.TenantContext(t, h.DB, centerPg)
		}
	}
	var status string
	if err := h.DB.QueryRow(context.Background(),
		"SELECT status FROM jobs WHERE id = $1", jobID,
	).Scan(&status); err != nil {
		t.Fatalf("JobStatus: job %s: %v", jobID, err)
	}
	return status
}

// JobPayload returns the raw payload bytes for the given job.
func (h *WorkerHarness) JobPayload(t *testing.T, jobID uuid.UUID) json.RawMessage {
	t.Helper()
	return h.getMeta(t, jobID, "JobPayload").Payload
}

func (h *WorkerHarness) getMeta(t *testing.T, jobID uuid.UUID, caller string) *jobMeta {
	t.Helper()
	h.mu.Lock()
	defer h.mu.Unlock()
	meta, ok := h.jobs[jobID]
	if !ok {
		t.Fatalf("%s: job %s not found in harness index", caller, jobID)
	}
	return meta
}

func (h *WorkerHarness) setTableStatus(ctx context.Context, t *testing.T, jobID uuid.UUID, status string) {
	t.Helper()
	if _, err := h.DB.Exec(ctx,
		"UPDATE jobs SET status = $2::job_status WHERE id = $1", jobID, status,
	); err != nil {
		t.Fatalf("setTableStatus %s: %v", status, err)
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
