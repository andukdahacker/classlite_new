// Story 4.3a, AC9 (jobs RLS isolation) — GREEN (T1 migration landed).
//
// Adversarial cross-tenant grid for the `jobs` table, mirroring
// exercises_rls_test.go and the _TEMPLATE_rls_test.go 6-pattern shape. Uses raw
// SQL (stable across sqlc codegen). The `jobs` RLS policy is keyed on center_id
// with the null-guard (0 rows when app.current_tenant_id is unset), mirroring
// `exercises`.
package test

import (
	"context"
	"testing"

	"github.com/google/uuid"
)

// insertJobRaw inserts a jobs row under the current tenant context. Returns id.
func insertJobRaw(t *testing.T, db *TxDB, centerID uuid.UUID, jobType string) uuid.UUID {
	t.Helper()
	id := uuid.New()
	_, err := db.Exec(context.Background(),
		`INSERT INTO jobs (id, center_id, type, status, params, params_schema_version)
		 VALUES ($1, $2, $3, 'pending', '{}'::jsonb, 1)`,
		id, centerID, jobType,
	)
	if err != nil {
		t.Fatalf("insert jobs row: %v", err)
	}
	return id
}

// Pattern 1 — CrossTenantRead: tenant A cannot SELECT tenant B's jobs.
func TestRLS_Job_CrossTenantRead(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()

	centerA := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	centerB := CreateCenterWithID(t, db, TenantBID, "Center B", "center-b")

	TenantContext(t, db, centerB.ID)
	insertJobRaw(t, db, uuid.UUID(centerB.ID.Bytes), "ai_generate_section")

	TenantContext(t, db, centerA.ID)
	var visible int
	if err := db.QueryRow(ctx, "SELECT count(*) FROM jobs WHERE center_id = $1", centerB.ID).Scan(&visible); err != nil {
		t.Fatalf("broad count as tenant A: %v", err)
	}
	if visible != 0 {
		t.Errorf("RLS VIOLATION: tenant A saw %d tenant B jobs, expected 0", visible)
	}
}

// Pattern 2 — CrossTenantInsert: WITH CHECK rejects a center_id spoof.
func TestRLS_Job_CrossTenantInsert(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()

	centerA := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	centerB := CreateCenterWithID(t, db, TenantBID, "Center B", "center-b")

	TenantContext(t, db, centerA.ID)
	id := uuid.New()
	_, err := db.Exec(ctx,
		`INSERT INTO jobs (id, center_id, type, status, params, params_schema_version)
		 VALUES ($1, $2, 'ai_generate_section', 'pending', '{}'::jsonb, 1)`,
		id, centerB.ID, // writing into tenant B while in tenant A context
	)
	AssertRLSViolation(t, err, "jobs cross-tenant INSERT")
}

// Pattern 3 — CrossTenantWrite: tenant A's UPDATE against tenant B's row is a
// silent 0-row no-op (PG does not error); B's row is unchanged.
func TestRLS_Job_CrossTenantWrite(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()

	centerA := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	centerB := CreateCenterWithID(t, db, TenantBID, "Center B", "center-b")

	TenantContext(t, db, centerB.ID)
	jobID := insertJobRaw(t, db, uuid.UUID(centerB.ID.Bytes), "ai_generate_section")

	TenantContext(t, db, centerA.ID)
	_, _ = db.Exec(ctx, "UPDATE jobs SET status = 'complete' WHERE id = $1", jobID)

	TenantContext(t, db, centerB.ID)
	var status string
	if err := db.QueryRow(ctx, "SELECT status FROM jobs WHERE id = $1", jobID).Scan(&status); err != nil {
		t.Fatalf("re-read job as tenant B: %v", err)
	}
	if status != "pending" {
		t.Errorf("RLS VIOLATION: cross-tenant UPDATE mutated tenant B job (status now %q, want pending)", status)
	}
}

// Pattern 4 — CrossTenantDelete: tenant A's DELETE against tenant B's row is a
// silent 0-row no-op (PG does not error on a USING-filtered DELETE); B's row
// survives. Added 2026-07-29 code review (P2) — the jobs_delete policy was
// previously untested.
func TestRLS_Job_CrossTenantDelete(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()

	centerA := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	centerB := CreateCenterWithID(t, db, TenantBID, "Center B", "center-b")

	TenantContext(t, db, centerB.ID)
	jobID := insertJobRaw(t, db, uuid.UUID(centerB.ID.Bytes), "ai_generate_section")

	TenantContext(t, db, centerA.ID)
	if _, err := db.Exec(ctx, "DELETE FROM jobs WHERE id = $1", jobID); err != nil {
		t.Fatalf("cross-tenant DELETE as tenant A errored (want silent no-op): %v", err)
	}

	TenantContext(t, db, centerB.ID)
	var survives int
	if err := db.QueryRow(ctx, "SELECT count(*) FROM jobs WHERE id = $1", jobID).Scan(&survives); err != nil {
		t.Fatalf("re-read job as tenant B: %v", err)
	}
	if survives != 1 {
		t.Errorf("RLS VIOLATION: cross-tenant DELETE removed tenant B job (rows now %d, want 1)", survives)
	}
}

// Pattern 3b — ReparentRejected: a tenant cannot UPDATE its OWN row's center_id
// to another tenant. The jobs_update USING clause admits the own row, but the
// WITH CHECK on the new center_id must reject the reparent with an error. Added
// 2026-07-29 code review (P4) — Pattern 3 only exercised USING, never WITH CHECK.
func TestRLS_Job_ReparentRejected(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()

	centerA := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	centerB := CreateCenterWithID(t, db, TenantBID, "Center B", "center-b")

	TenantContext(t, db, centerA.ID)
	jobID := insertJobRaw(t, db, uuid.UUID(centerA.ID.Bytes), "ai_generate_section")

	// Still in tenant A: try to move our own row into tenant B.
	_, err := db.Exec(ctx, "UPDATE jobs SET center_id = $1 WHERE id = $2", centerB.ID, jobID)
	AssertRLSViolation(t, err, "jobs UPDATE reparent (WITH CHECK)")
}

// Pattern 0 — SameTenantVisible: positive control. Without this, an RLS policy
// misconfigured to block ALL access would leave every adversarial (expect-zero)
// test green. Added 2026-07-29 code review (P5).
func TestRLS_Job_SameTenantVisible(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()

	center := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	TenantContext(t, db, center.ID)
	insertJobRaw(t, db, uuid.UUID(center.ID.Bytes), "ai_generate_section")

	var visible int
	if err := db.QueryRow(ctx, "SELECT count(*) FROM jobs WHERE center_id = $1", center.ID).Scan(&visible); err != nil {
		t.Fatalf("count own-tenant jobs: %v", err)
	}
	if visible != 1 {
		t.Errorf("RLS OVER-RESTRICTION: own tenant saw %d of its own jobs, expected 1", visible)
	}
}

// Pattern 5 — NullTenant: empty tenant context → null-guard → zero rows.
func TestRLS_Job_NullTenant(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()

	center := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	TenantContext(t, db, center.ID)
	insertJobRaw(t, db, uuid.UUID(center.ID.Bytes), "ai_generate_section")

	resetTenantContext(t, db)
	var count int
	if err := db.QueryRow(ctx, "SELECT count(*) FROM jobs WHERE center_id = $1", center.ID).Scan(&count); err != nil {
		t.Fatalf("count with null tenant: %v", err)
	}
	if count != 0 {
		t.Errorf("RLS VIOLATION: null tenant returned %d job rows, expected 0", count)
	}
}

// Pattern 6 — UnsetTenant: never-set (RESET) tenant context → zero rows.
func TestRLS_Job_UnsetTenant(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()

	center := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	TenantContext(t, db, center.ID)
	insertJobRaw(t, db, uuid.UUID(center.ID.Bytes), "ai_generate_section")

	resetTenantContextToDefault(t, db)
	var count int
	if err := db.QueryRow(ctx, "SELECT count(*) FROM jobs WHERE center_id = $1", center.ID).Scan(&count); err != nil {
		t.Fatalf("count with unset tenant: %v", err)
	}
	if count != 0 {
		t.Errorf("RLS VIOLATION: unset tenant returned %d job rows, expected 0", count)
	}
}
