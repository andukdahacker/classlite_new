package test

import (
	"context"
	"strings"
	"testing"

	"github.com/ducdo/classlite-api/internal/store/generated"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

// insertAuditLog is a thin helper that bypasses the service layer so RLS
// tests can probe row-level isolation directly. Tenant context must already
// be set by the caller.
func insertAuditLog(t *testing.T, db *TxDB, centerID, userID pgtype.UUID, action, entityType string, entityID pgtype.UUID) generated.AuditLog {
	t.Helper()
	queries := generated.New(db)
	row, err := queries.InsertAuditLog(context.Background(), generated.InsertAuditLogParams{
		CenterID:   centerID,
		UserID:     userID,
		Action:     action,
		EntityType: entityType,
		EntityID:   entityID,
		Changes:    []byte(`{"before":{},"after":{}}`),
	})
	if err != nil {
		t.Fatalf("insert audit log: %v", err)
	}
	return row
}

func newEntityUUID(t *testing.T) pgtype.UUID {
	t.Helper()
	return pgtype.UUID{Bytes: uuid.New(), Valid: true}
}

// --- audit_logs RLS tests (Story 1.3b AC2) ---

func TestRLS_AuditLogs_CrossTenantRead(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()
	queries := generated.New(db)

	centerA := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	centerB := CreateCenterWithID(t, db, TenantBID, "Center B", "center-b")
	userA := CreateUser(t, db, "alice@example.com", "Alice")
	userB := CreateUser(t, db, "bob@example.com", "Bob")

	// Tenant A writes an audit row.
	TenantContext(t, db, centerA.ID)
	entityA := newEntityUUID(t)
	insertAuditLog(t, db, centerA.ID, userA.ID, "billing.update", "subscription", entityA)

	// Tenant B writes an audit row.
	TenantContext(t, db, centerB.ID)
	entityB := newEntityUUID(t)
	insertAuditLog(t, db, centerB.ID, userB.ID, "billing.update", "subscription", entityB)

	// Tenant A querying its own entity — must see exactly one row.
	TenantContext(t, db, centerA.ID)
	rowsA, err := queries.ListAuditLogsByEntity(ctx, generated.ListAuditLogsByEntityParams{
		CenterID:   centerA.ID,
		EntityType: "subscription",
		EntityID:   entityA,
	})
	if err != nil {
		t.Fatalf("list audit logs as tenant A: %v", err)
	}
	if len(rowsA) != 1 {
		t.Errorf("expected tenant A to see its own row, got %d", len(rowsA))
	}

	// Tenant A querying tenant B's entity — RLS must filter to zero.
	rowsBAsA, err := queries.ListAuditLogsByEntity(ctx, generated.ListAuditLogsByEntityParams{
		CenterID:   centerB.ID,
		EntityType: "subscription",
		EntityID:   entityB,
	})
	if err != nil {
		t.Fatalf("list tenant B audit logs as tenant A: %v", err)
	}
	if len(rowsBAsA) != 0 {
		t.Errorf("RLS VIOLATION: tenant A read %d tenant B audit rows", len(rowsBAsA))
	}

	// Cross-check broad SELECT to catch leakage even when entity_id differs.
	var visibleA int
	if err := db.QueryRow(ctx,
		"SELECT count(*) FROM audit_logs WHERE center_id IN ($1, $2)",
		centerA.ID, centerB.ID,
	).Scan(&visibleA); err != nil {
		t.Fatalf("count as tenant A: %v", err)
	}
	if visibleA != 1 {
		t.Errorf("RLS VIOLATION: tenant A saw %d audit rows across both tenants, expected 1", visibleA)
	}
}

func TestRLS_AuditLogs_CrossTenantInsert(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()

	centerA := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	centerB := CreateCenterWithID(t, db, TenantBID, "Center B", "center-b")
	userA := CreateUser(t, db, "alice@example.com", "Alice")

	queries := generated.New(db)

	// Set tenant A context, attempt INSERT into tenant B.
	TenantContext(t, db, centerA.ID)
	_, err := queries.InsertAuditLog(ctx, generated.InsertAuditLogParams{
		CenterID:   centerB.ID,
		UserID:     userA.ID,
		Action:     "billing.update",
		EntityType: "subscription",
		EntityID:   newEntityUUID(t),
		Changes:    []byte(`{}`),
	})
	if err == nil {
		t.Error("RLS VIOLATION: cross-tenant INSERT on audit_logs should have been rejected")
	}
}

func TestRLS_AuditLogs_InsertUnsetTenantRejected(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()

	center := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	user := CreateUser(t, db, "alice@example.com", "Alice")

	// Set up a user known to the centre, then clear tenant context entirely.
	TenantContext(t, db, center.ID)
	resetTenantContextToDefault(t, db)

	queries := generated.New(db)
	_, err := queries.InsertAuditLog(ctx, generated.InsertAuditLogParams{
		CenterID:   center.ID,
		UserID:     user.ID,
		Action:     "billing.update",
		EntityType: "subscription",
		EntityID:   newEntityUUID(t),
		Changes:    []byte(`{}`),
	})
	if err == nil {
		t.Error("RLS VIOLATION: INSERT with unset tenant context should have been rejected by WITH CHECK")
	}
}

func TestRLS_AuditLogs_NullTenant(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()

	center := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	user := CreateUser(t, db, "alice@example.com", "Alice")

	TenantContext(t, db, center.ID)
	insertAuditLog(t, db, center.ID, user.ID, "billing.update", "subscription", newEntityUUID(t))

	resetTenantContext(t, db)
	var count int
	if err := db.QueryRow(ctx, "SELECT count(*) FROM audit_logs WHERE center_id = $1", center.ID).Scan(&count); err != nil {
		t.Fatalf("count with null tenant: %v", err)
	}
	if count != 0 {
		t.Errorf("RLS VIOLATION: null tenant returned %d audit rows, expected 0", count)
	}
}

func TestRLS_AuditLogs_UnsetTenant(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()

	center := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	user := CreateUser(t, db, "alice@example.com", "Alice")

	TenantContext(t, db, center.ID)
	insertAuditLog(t, db, center.ID, user.ID, "billing.update", "subscription", newEntityUUID(t))

	resetTenantContextToDefault(t, db)
	var count int
	if err := db.QueryRow(ctx, "SELECT count(*) FROM audit_logs WHERE center_id = $1", center.ID).Scan(&count); err != nil {
		t.Fatalf("count with unset tenant: %v", err)
	}
	if count != 0 {
		t.Errorf("RLS VIOLATION: unset tenant returned %d audit rows, expected 0", count)
	}
}

// Append-only enforcement: the application role must not be able to mutate
// or wipe audit history, even when tenant context is correct. The migration
// REVOKEs UPDATE/DELETE/TRUNCATE on audit_logs from classlite_app so these
// should fail at the privilege layer (before RLS even runs).

func TestAuditLogs_AppendOnly_UpdateDenied(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()

	center := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	user := CreateUser(t, db, "alice@example.com", "Alice")

	TenantContext(t, db, center.ID)
	row := insertAuditLog(t, db, center.ID, user.ID, "billing.update", "subscription", newEntityUUID(t))

	_, err := db.Exec(ctx,
		"UPDATE audit_logs SET action = 'tampered' WHERE id = $1",
		row.ID,
	)
	if err == nil {
		t.Error("APPEND-ONLY VIOLATION: UPDATE on audit_logs should be rejected at the privilege layer")
	}
}

func TestAuditLogs_AppendOnly_DeleteDenied(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()

	center := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	user := CreateUser(t, db, "alice@example.com", "Alice")

	TenantContext(t, db, center.ID)
	row := insertAuditLog(t, db, center.ID, user.ID, "billing.update", "subscription", newEntityUUID(t))

	_, err := db.Exec(ctx, "DELETE FROM audit_logs WHERE id = $1", row.ID)
	if err == nil {
		t.Error("APPEND-ONLY VIOLATION: DELETE on audit_logs should be rejected at the privilege layer")
	}
}

func TestAuditLogs_AppendOnly_TruncateDenied(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()

	_, err := db.Exec(ctx, "TRUNCATE TABLE audit_logs")
	if err == nil {
		t.Error("APPEND-ONLY VIOLATION: TRUNCATE on audit_logs should be rejected at the privilege layer")
	}
}

// AC4: Verify the composite index (center_id, entity_type, created_at DESC)
// is selected by the planner. We force enable_seqscan = off so the test does
// not depend on row-count heuristics; the assertion proves the index exists
// AND is shaped to serve the canonical query, regardless of table size.
func TestAuditLogs_CompositeIndexUsed(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()

	center := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	user := CreateUser(t, db, "alice@example.com", "Alice")

	TenantContext(t, db, center.ID)
	insertAuditLog(t, db, center.ID, user.ID, "role.update", "center_member", newEntityUUID(t))

	// Disable seqscan for this transaction so the planner must use an index
	// path if one is applicable. SET LOCAL is scoped to the test transaction
	// and is reverted automatically on rollback.
	if _, err := db.Exec(ctx, "SET LOCAL enable_seqscan = off"); err != nil {
		t.Fatalf("disable seqscan: %v", err)
	}

	rows, err := db.Query(ctx,
		`EXPLAIN SELECT id FROM audit_logs
		 WHERE center_id = $1 AND entity_type = $2
		 ORDER BY created_at DESC LIMIT 5`,
		center.ID, "center_member",
	)
	if err != nil {
		t.Fatalf("explain: %v", err)
	}
	defer rows.Close()

	var plan strings.Builder
	for rows.Next() {
		var line string
		if err := rows.Scan(&line); err != nil {
			t.Fatalf("scan plan line: %v", err)
		}
		plan.WriteString(line)
		plan.WriteByte('\n')
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("read explain rows: %v", err)
	}

	planStr := plan.String()
	if !strings.Contains(planStr, "idx_audit_logs_center_entity_created") {
		t.Errorf("expected composite index in plan, got:\n%s", planStr)
	}
}
