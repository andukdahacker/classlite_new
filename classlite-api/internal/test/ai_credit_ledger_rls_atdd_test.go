// Story 4.3a, AC9 + AC7/AC8 SQL-layer invariants for the `ai_credit_ledger`
// table — GREEN (T2 migration landed).
//
// Covers, at the store/SQL seam (stable across sqlc codegen):
//   - RLS cross-tenant read/insert isolation + null-guard (AC9)
//   - APPEND-ONLY policy: UPDATE and DELETE must be rejected (mirror
//     auth_audit_logs, Story 1.3b) (AC9)
//   - IDEMPOTENCY: the unique index (ref_job_id, reason) collapses a
//     double-refund to a no-op via ON CONFLICT DO NOTHING (AC7/AC8 R23/A6)
//   - the −1 job_deduction / +1 job_failed_refund balance math
package test

import (
	"context"
	"testing"

	"github.com/google/uuid"
)

// insertLedgerRaw inserts a ledger row under the current tenant. `refJob` may be
// uuid.Nil to represent a NULL ref_job_id (grant/purchase reasons).
func insertLedgerRaw(t *testing.T, db *TxDB, centerID, userID, refJob uuid.UUID, change int, reason string, balanceAfter int) error {
	t.Helper()
	var refArg any
	if refJob == uuid.Nil {
		refArg = nil
	} else {
		refArg = refJob
	}
	_, err := db.Exec(context.Background(),
		`INSERT INTO ai_credit_ledger (id, center_id, user_id, change, reason, ref_job_id, balance_after)
		 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
		uuid.New(), centerID, userID, change, reason, refArg, balanceAfter,
	)
	return err
}

// seedLedgerActor makes a center + a user in it, returns their uuids and sets
// tenant context to that center.
func seedLedgerActor(t *testing.T, db *TxDB, tenantID, name, code string) (center, user uuid.UUID) {
	t.Helper()
	c := CreateCenterWithID(t, db, tenantID, name, code)
	TenantContext(t, db, c.ID)
	u := insertUserRaw(t, db, "ledger-"+uuid.NewString()[:8]+"@example.com", "Ledger Actor")
	return uuid.UUID(c.ID.Bytes), u
}

// -----------------------------------------------------------------------------
// AC9 — RLS isolation
// -----------------------------------------------------------------------------

func TestRLS_AICreditLedger_CrossTenantRead(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()

	centerB, userB := seedLedgerActor(t, db, TenantBID, "Center B", "center-b")
	if err := insertLedgerRaw(t, db, centerB, userB, uuid.New(), -1, "job_deduction", -1); err != nil {
		t.Fatalf("seed tenant B ledger row: %v", err)
	}

	centerA := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	TenantContext(t, db, centerA.ID)
	var visible int
	if err := db.QueryRow(ctx, "SELECT count(*) FROM ai_credit_ledger WHERE center_id = $1", centerB).Scan(&visible); err != nil {
		t.Fatalf("broad count as tenant A: %v", err)
	}
	if visible != 0 {
		t.Errorf("RLS VIOLATION: tenant A saw %d tenant B ledger rows, expected 0", visible)
	}
}

func TestRLS_AICreditLedger_CrossTenantInsert(t *testing.T) {
	db := SetupDB(t)

	centerB, userB := seedLedgerActor(t, db, TenantBID, "Center B", "center-b")
	centerA := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")

	TenantContext(t, db, centerA.ID)
	err := insertLedgerRaw(t, db, centerB, userB, uuid.New(), -1, "job_deduction", -1) // spoof into B
	AssertRLSViolation(t, err, "ai_credit_ledger cross-tenant INSERT")
}

func TestRLS_AICreditLedger_NullTenant(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()

	center, user := seedLedgerActor(t, db, TenantAID, "Center A", "center-a")
	if err := insertLedgerRaw(t, db, center, user, uuid.New(), -1, "job_deduction", -1); err != nil {
		t.Fatalf("seed ledger row: %v", err)
	}

	resetTenantContext(t, db)
	var count int
	if err := db.QueryRow(ctx, "SELECT count(*) FROM ai_credit_ledger WHERE center_id = $1", center).Scan(&count); err != nil {
		t.Fatalf("count with null tenant: %v", err)
	}
	if count != 0 {
		t.Errorf("RLS VIOLATION: null tenant returned %d ledger rows, expected 0", count)
	}
}

// TestRLS_AICreditLedger_UnsetTenant — Pattern 6: never-set (RESET) tenant
// context → null-guard → zero rows. Complements NullTenant (empty string) so the
// current_setting(..., true) NULL-vs-” branch is proven for this table too,
// matching the jobs suite. Added 2026-07-29 code review (P3).
func TestRLS_AICreditLedger_UnsetTenant(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()

	center, user := seedLedgerActor(t, db, TenantAID, "Center A", "center-a")
	if err := insertLedgerRaw(t, db, center, user, uuid.New(), -1, "job_deduction", -1); err != nil {
		t.Fatalf("seed ledger row: %v", err)
	}

	resetTenantContextToDefault(t, db)
	var count int
	if err := db.QueryRow(ctx, "SELECT count(*) FROM ai_credit_ledger WHERE center_id = $1", center).Scan(&count); err != nil {
		t.Fatalf("count with unset tenant: %v", err)
	}
	if count != 0 {
		t.Errorf("RLS VIOLATION: unset tenant returned %d ledger rows, expected 0", count)
	}
}

// TestRLS_AICreditLedger_SameTenantVisible — positive control. Without it, a
// policy misconfigured to block ALL reads would leave the expect-zero isolation
// tests green. Added 2026-07-29 code review (P5).
func TestRLS_AICreditLedger_SameTenantVisible(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()

	center, user := seedLedgerActor(t, db, TenantAID, "Center A", "center-a")
	if err := insertLedgerRaw(t, db, center, user, uuid.New(), -1, "job_deduction", -1); err != nil {
		t.Fatalf("seed ledger row: %v", err)
	}

	var visible int
	if err := db.QueryRow(ctx, "SELECT count(*) FROM ai_credit_ledger WHERE center_id = $1", center).Scan(&visible); err != nil {
		t.Fatalf("count own-tenant ledger rows: %v", err)
	}
	if visible != 1 {
		t.Errorf("RLS OVER-RESTRICTION: own tenant saw %d of its own ledger rows, expected 1", visible)
	}
}

// -----------------------------------------------------------------------------
// AC9 — APPEND-ONLY: UPDATE and DELETE must be rejected (mirror auth_audit_logs)
// -----------------------------------------------------------------------------

func TestAICreditLedger_UpdateRejected(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()

	center, user := seedLedgerActor(t, db, TenantAID, "Center A", "center-a")
	refJob := uuid.New()
	if err := insertLedgerRaw(t, db, center, user, refJob, -1, "job_deduction", -1); err != nil {
		t.Fatalf("seed ledger row: %v", err)
	}

	_, err := db.Exec(ctx, "UPDATE ai_credit_ledger SET change = 999 WHERE ref_job_id = $1", refJob)
	if err == nil {
		t.Error("APPEND-ONLY VIOLATION: UPDATE on ai_credit_ledger succeeded — INSERT-only policy must reject it")
	}
}

func TestAICreditLedger_DeleteRejected(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()

	center, user := seedLedgerActor(t, db, TenantAID, "Center A", "center-a")
	refJob := uuid.New()
	if err := insertLedgerRaw(t, db, center, user, refJob, -1, "job_deduction", -1); err != nil {
		t.Fatalf("seed ledger row: %v", err)
	}

	_, err := db.Exec(ctx, "DELETE FROM ai_credit_ledger WHERE ref_job_id = $1", refJob)
	if err == nil {
		t.Error("APPEND-ONLY VIOLATION: DELETE on ai_credit_ledger succeeded — INSERT-only policy must reject it")
	}
}

// -----------------------------------------------------------------------------
// AC7/AC8 — IDEMPOTENCY: unique (ref_job_id, reason) collapses a double-refund
// -----------------------------------------------------------------------------

func TestAICreditLedger_DoubleRefundIsNoOp(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()

	center, user := seedLedgerActor(t, db, TenantAID, "Center A", "center-a")
	refJob := uuid.New()

	// −1 deduction, then two refund attempts for the same (ref_job_id, reason).
	if err := insertLedgerRaw(t, db, center, user, refJob, -1, "job_deduction", -1); err != nil {
		t.Fatalf("deduction insert: %v", err)
	}
	// The production refund query is INSERT ... ON CONFLICT (ref_job_id, reason)
	// DO NOTHING. Simulate that here to prove the unique index makes #2 a no-op.
	insertRefundOnConflict := func() error {
		_, err := db.Exec(ctx,
			`INSERT INTO ai_credit_ledger (id, center_id, user_id, change, reason, ref_job_id, balance_after)
			 VALUES ($1, $2, $3, 1, 'job_failed_refund', $4, 0)
			 ON CONFLICT (ref_job_id, reason) DO NOTHING`,
			uuid.New(), center, user, refJob,
		)
		return err
	}
	if err := insertRefundOnConflict(); err != nil {
		t.Fatalf("first refund insert: %v", err)
	}
	if err := insertRefundOnConflict(); err != nil {
		t.Fatalf("second refund insert (should be a silent no-op): %v", err)
	}

	var refunds, sum int
	if err := db.QueryRow(ctx,
		`SELECT count(*), COALESCE(SUM(change),0) FROM ai_credit_ledger WHERE ref_job_id = $1 AND reason = 'job_failed_refund'`,
		refJob,
	).Scan(&refunds, &sum); err != nil {
		t.Fatalf("count refunds: %v", err)
	}
	if refunds != 1 || sum != 1 {
		t.Errorf("DOUBLE REFUND: refund rows = %d sum = %d, want exactly 1 row of +1 (unique (ref_job_id, reason) idempotency)", refunds, sum)
	}

	// Net balance for the job is 0: −1 deduction + 1 refund.
	var net int
	_ = db.QueryRow(ctx, `SELECT COALESCE(SUM(change),0) FROM ai_credit_ledger WHERE ref_job_id = $1`, refJob).Scan(&net)
	if net != 0 {
		t.Errorf("net balance for refunded job = %d, want 0", net)
	}
}
