// Package workers test file. Demonstrates the 3 mandatory adversarial
// test patterns every worker job type must implement, using a minimal
// inspectHandler that reads app.current_tenant_id from the connection
// state so the assertion is direct and database-real.
package workers_test

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/jackc/pgx/v5"

	"github.com/ducdo/classlite-api/internal/model"
	testpkg "github.com/ducdo/classlite-api/internal/test"
	"github.com/ducdo/classlite-api/internal/test/workers"
)

// inspectHandler is a minimal JobHandler used to demonstrate the harness
// patterns. It reads the connection's app.current_tenant_id setting and
// returns it in a sentinel error so tests can assert what RLS context
// the handler actually saw.
type inspectHandler struct {
	db *testpkg.TxDB
}

func (h *inspectHandler) ProcessTask(ctx context.Context, tc model.TenantContext, payload json.RawMessage) error {
	var observed string
	err := h.db.QueryRow(ctx, "SELECT current_setting('app.current_tenant_id', true)").Scan(&observed)
	if err != nil {
		return err
	}

	// Decode payload to demonstrate payload-vs-row separation.
	var p struct {
		PayloadCenterID string `json:"center_id_in_payload"`
	}
	_ = json.Unmarshal(payload, &p)

	return &inspectResult{
		ObservedTenantID:  observed,
		TenantCtxCenterID: tc.CenterID,
		PayloadCenterID:   p.PayloadCenterID,
	}
}

type inspectResult struct {
	ObservedTenantID  string // what SET LOCAL actually set on the connection
	TenantCtxCenterID string // what model.TenantContext.CenterID held
	PayloadCenterID   string // what the payload tried to claim
}

func (r *inspectResult) Error() string { return "inspect-result" }

// Pattern 1: Happy path — handler runs with tenant context set from the
// job row's CenterID.
func TestInspect_HappyPath(t *testing.T) {
	h := workers.SetupWorkerHarness(t)
	// Create center A so app.current_tenant_id can validly reference it.
	_ = testpkg.CreateCenterWithID(t, h.DB, testpkg.TenantAID, "Tenant A", "TENA")

	jobID := h.EnqueueJob(t, testpkg.TenantAID, "inspect", map[string]any{})

	err := h.ProcessSpecific(context.Background(), t, jobID, &inspectHandler{db: h.DB})

	result, ok := err.(*inspectResult)
	if !ok {
		t.Fatalf("expected *inspectResult, got %T: %v", err, err)
	}
	if result.ObservedTenantID != testpkg.TenantAID {
		t.Fatalf("expected observed tenant %s, got %q", testpkg.TenantAID, result.ObservedTenantID)
	}
	if result.TenantCtxCenterID != testpkg.TenantAID {
		t.Fatalf("expected TenantContext.CenterID %s, got %q", testpkg.TenantAID, result.TenantCtxCenterID)
	}
	if status := h.JobStatus(t, jobID); status != workers.StatusFailed {
		// inspectHandler always returns inspectResult-as-error, so job
		// flips to failed — this is fine for the demo.
		t.Logf("inspectHandler returns sentinel error; status=%s (expected failed)", status)
	}
}

// Pattern 2: PayloadCenterIdIgnored — payload claims tenant B but the
// job row is for tenant A. Handler must see tenant A on the connection.
// This is the R3 mitigation in code form.
func TestInspect_PayloadCenterIdIgnored(t *testing.T) {
	h := workers.SetupWorkerHarness(t)
	_ = testpkg.CreateCenterWithID(t, h.DB, testpkg.TenantAID, "Tenant A", "TENA")
	_ = testpkg.CreateCenterWithID(t, h.DB, testpkg.TenantBID, "Tenant B", "TENB")

	// Job row says A, payload tries to claim B.
	jobID := h.EnqueueJob(t, testpkg.TenantAID, "inspect", map[string]any{
		"center_id_in_payload": testpkg.TenantBID,
	})

	err := h.ProcessSpecific(context.Background(), t, jobID, &inspectHandler{db: h.DB})

	result, ok := err.(*inspectResult)
	if !ok {
		t.Fatalf("expected *inspectResult, got %T: %v", err, err)
	}

	// The CRITICAL assertion: the connection's tenant id matches the JOB
	// ROW, NOT the payload. Payload-supplied tenant id is informational
	// at best, attacker-controlled at worst.
	if result.ObservedTenantID != testpkg.TenantAID {
		t.Fatalf("RLS VIOLATION: observed tenant %q should be %s (job row), payload tried %s",
			result.ObservedTenantID, testpkg.TenantAID, result.PayloadCenterID)
	}
	if result.PayloadCenterID != testpkg.TenantBID {
		t.Fatalf("payload integrity: expected payload to carry %s, got %q", testpkg.TenantBID, result.PayloadCenterID)
	}
}

// Pattern 3: NullTenantContextRejected — simulate the bug where the worker
// forgets to SET LOCAL. The connection's app.current_tenant_id is empty,
// and any RLS-protected query the handler attempts must return 0 rows.
//
// We probe against audit_logs which is RLS-enabled with the null-tenant
// guard from Story 1.3b. centers itself is intentionally NOT RLS-scoped
// because it is the tenant-identity root looked up by middleware before
// any tenant context exists.
func TestInspect_NullTenantContextRejected(t *testing.T) {
	h := workers.SetupWorkerHarness(t)

	// Seed a center + user + an audit_logs row scoped to the center.
	// We set the tenant context manually to insert the audit row, then
	// clear it before processing the job.
	center := testpkg.CreateCenterWithID(t, h.DB, testpkg.TenantAID, "Tenant A", "TENA")
	user := testpkg.CreateUser(t, h.DB, "probe@example.com", "Probe User")
	_ = testpkg.TenantContext(t, h.DB, center.ID)
	if _, err := h.DB.Exec(context.Background(),
		`INSERT INTO audit_logs (center_id, user_id, action, entity_type, entity_id, changes)
		 VALUES ($1, $2, 'test.seed', 'test', $1, '{}'::jsonb)`,
		center.ID, user.ID,
	); err != nil {
		t.Fatalf("seed audit_logs row: %v", err)
	}

	jobID := h.EnqueueJob(t, testpkg.TenantAID, "rls-probe", map[string]any{})

	probe := &rlsProbeHandler{db: h.DB}
	err := h.ProcessWithoutTenantContext(context.Background(), t, jobID, probe)

	// Expect pgx.ErrNoRows: RLS filtered the seeded audit_logs row out
	// because the connection has no tenant context.
	if err == nil {
		t.Fatalf("RLS VIOLATION: handler returned no error — tenant-scoped audit_logs returned rows without tenant context. " +
			"This means a worker that forgets SET LOCAL in production would leak data across tenants.")
	}
	if !isNoRows(err) {
		t.Logf("handler returned non-ErrNoRows error: %v (acceptable as long as no row was actually read)", err)
	}
}

// rlsProbeHandler performs a SELECT on audit_logs (RLS-protected) and
// returns whatever pgx reports. With tenant context cleared, RLS must
// filter the row out and pgx returns ErrNoRows.
type rlsProbeHandler struct {
	db *testpkg.TxDB
}

func (h *rlsProbeHandler) ProcessTask(ctx context.Context, _ model.TenantContext, _ json.RawMessage) error {
	var action string
	return h.db.QueryRow(ctx, "SELECT action FROM audit_logs LIMIT 1").Scan(&action)
}

func isNoRows(err error) bool {
	for e := err; e != nil; e = unwrap(e) {
		if e == pgx.ErrNoRows {
			return true
		}
	}
	return false
}

func unwrap(err error) error {
	type wrapper interface {
		Unwrap() error
	}
	w, ok := err.(wrapper)
	if !ok {
		return nil
	}
	return w.Unwrap()
}
