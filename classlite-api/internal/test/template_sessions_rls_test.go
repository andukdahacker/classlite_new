// Story 2.2 — R1 discharge: J15 6-pattern grid for template_sessions.
//
// Six mandatory patterns + 3 named extensions (Murat-M-B1, story AC10):
//   Pattern 1..6                                — standard J15 grid.
//   Extension 1 TriggerReconcilesToParentTenancy — BEFORE trigger rewrites
//                                                  center_id to parent's
//                                                  center_id at insert time.
//   Extension 2 ParentTenantMismatchRejectedByWithCheck — trigger rewrites
//                                                        row.center_id to
//                                                        parent's tenancy;
//                                                        WITH CHECK then
//                                                        rejects if that
//                                                        differs from the
//                                                        current tenant.
//   Extension 3 UserCannotPlantSessionUnderSystemSeed — same trigger + RLS
//                                                       interplay, protecting
//                                                       system-seed templates
//                                                       from user-planted
//                                                       sessions.
//
// Migrations:
//   20260703120100_create_template_sessions.up.sql (Task 2.2) — table + trigger.
//   20260703120000_create_class_templates.up.sql   (Task 2.1) — parent table.
//
// Expected RED phase: template_sessions relation does not exist yet.

package test

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

// insertTemplateSessionRaw inserts a template_sessions row via raw SQL.
// Tenant context must already be set by the caller. Returns row id.
func insertTemplateSessionRaw(t *testing.T, db *TxDB, templateID uuid.UUID, sessionOrder int, title string) uuid.UUID {
	t.Helper()
	id := uuid.New()
	_, err := db.Exec(context.Background(),
		`INSERT INTO template_sessions (id, template_id, center_id, session_order, title)
		 VALUES ($1, $2, NULL, $3, $4)`,
		id, templateID, sessionOrder, title,
	)
	if err != nil {
		t.Fatalf("insert template_sessions row (%s): %v", title, err)
	}
	return id
}

// -----------------------------------------------------------------------------
// Pattern 1 — CrossTenantRead
// -----------------------------------------------------------------------------
func TestRLS_TemplateSession_CrossTenantRead(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()

	centerA := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	centerB := CreateCenterWithID(t, db, TenantBID, "Center B", "center-b")

	// Tenant B creates a class_template and a template_sessions row.
	TenantContext(t, db, centerB.ID)
	centerBUUID := uuid.UUID(centerB.ID.Bytes)
	templateBID := insertClassTemplateRaw(t, db, &centerBUUID, "B Template")
	insertTemplateSessionRaw(t, db, templateBID, 0, "B session 1")

	// Tenant A queries — must not see tenant B's session.
	TenantContext(t, db, centerA.ID)
	var visible int
	if err := db.QueryRow(ctx,
		"SELECT count(*) FROM template_sessions WHERE center_id = $1",
		centerB.ID,
	).Scan(&visible); err != nil {
		t.Fatalf("broad count as tenant A: %v", err)
	}
	if visible != 0 {
		t.Errorf("RLS VIOLATION: tenant A saw %d tenant B template_sessions rows, expected 0", visible)
	}
}

// -----------------------------------------------------------------------------
// Pattern 2 — CrossTenantInsert
// Tenant A context set; INSERT names an explicit center_id = tenant B. The
// BEFORE trigger rewrites center_id from the parent template — but the parent
// template lookup is scoped by RLS to tenant A, so if template_id belongs to
// tenant B, GetTemplateForTrigger returns no row and INSERT fails. If the
// trigger is naive and reads WITHOUT RLS, WITH CHECK still catches it.
// -----------------------------------------------------------------------------
func TestRLS_TemplateSession_CrossTenantInsert(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()

	centerA := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	centerB := CreateCenterWithID(t, db, TenantBID, "Center B", "center-b")

	// Tenant B creates the parent template.
	TenantContext(t, db, centerB.ID)
	centerBUUID := uuid.UUID(centerB.ID.Bytes)
	templateBID := insertClassTemplateRaw(t, db, &centerBUUID, "B parent template")

	// Tenant A attempts to plant a session under tenant B's template.
	TenantContext(t, db, centerA.ID)
	id := uuid.New()
	_, err := db.Exec(ctx,
		`INSERT INTO template_sessions (id, template_id, center_id, session_order, title)
		 VALUES ($1, $2, $3, 0, 'hostile plant')`,
		id, templateBID, centerB.ID,
	)
	// C3-03 review fix — assert real 42501 rather than any error.
	AssertRLSViolation(t, err, "template_sessions cross-tenant INSERT")
}

// -----------------------------------------------------------------------------
// Pattern 3 — CrossTenantWrite (UPDATE title)
// Trigger fires only on UPDATE OF template_id, so a title-only UPDATE goes
// straight to the RLS UPDATE policy. Tenant A's USING clause excludes the
// row → 0 rows affected, silent success — Pattern 3 verifies row unchanged.
// -----------------------------------------------------------------------------
func TestRLS_TemplateSession_CrossTenantWrite(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()

	centerA := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	centerB := CreateCenterWithID(t, db, TenantBID, "Center B", "center-b")

	TenantContext(t, db, centerB.ID)
	centerBUUID := uuid.UUID(centerB.ID.Bytes)
	templateBID := insertClassTemplateRaw(t, db, &centerBUUID, "B parent")
	sessionID := insertTemplateSessionRaw(t, db, templateBID, 0, "Original Title")

	TenantContext(t, db, centerA.ID)
	tag, err := db.Exec(ctx,
		`UPDATE template_sessions SET title = 'Hacked' WHERE id = $1`, sessionID,
	)
	if err != nil {
		t.Fatalf("UPDATE returned error (expected silent 0-rows): %v", err)
	}
	// C3-04 review fix — assert 0 rows affected.
	if rows := tag.RowsAffected(); rows != 0 {
		t.Errorf("RLS VIOLATION: tenant A UPDATE affected %d template_sessions rows on tenant B, expected 0", rows)
	}

	TenantContext(t, db, centerB.ID)
	var title string
	if err := db.QueryRow(ctx,
		`SELECT title FROM template_sessions WHERE id = $1`, sessionID,
	).Scan(&title); err != nil {
		t.Fatalf("re-read as tenant B: %v", err)
	}
	if title != "Original Title" {
		t.Errorf("RLS VIOLATION: tenant A UPDATE against tenant B template_sessions row succeeded (title=%q)", title)
	}
}

// -----------------------------------------------------------------------------
// Pattern 4 — CrossTenantDelete
// -----------------------------------------------------------------------------
func TestRLS_TemplateSession_CrossTenantDelete(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()

	centerA := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	centerB := CreateCenterWithID(t, db, TenantBID, "Center B", "center-b")

	TenantContext(t, db, centerB.ID)
	centerBUUID := uuid.UUID(centerB.ID.Bytes)
	templateBID := insertClassTemplateRaw(t, db, &centerBUUID, "B parent")
	sessionID := insertTemplateSessionRaw(t, db, templateBID, 0, "Delete Target")

	TenantContext(t, db, centerA.ID)
	delTag, err := db.Exec(ctx, `DELETE FROM template_sessions WHERE id = $1`, sessionID)
	if err != nil {
		t.Fatalf("DELETE returned error (expected silent 0-rows): %v", err)
	}
	// C3-04 review fix — assert 0 rows affected.
	if rows := delTag.RowsAffected(); rows != 0 {
		t.Errorf("RLS VIOLATION: tenant A DELETE affected %d template_sessions rows on tenant B, expected 0", rows)
	}

	TenantContext(t, db, centerB.ID)
	var stillExists int
	if err := db.QueryRow(ctx,
		"SELECT count(*) FROM template_sessions WHERE id = $1", sessionID,
	).Scan(&stillExists); err != nil {
		t.Fatalf("count target row as tenant B: %v", err)
	}
	if stillExists != 1 {
		t.Errorf("RLS VIOLATION: cross-tenant DELETE succeeded — tenant B template_sessions row is gone")
	}
}

// -----------------------------------------------------------------------------
// Pattern 5 — NullTenant
// -----------------------------------------------------------------------------
func TestRLS_TemplateSession_NullTenant(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()

	center := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	TenantContext(t, db, center.ID)
	centerUUID := uuid.UUID(center.ID.Bytes)
	templateID := insertClassTemplateRaw(t, db, &centerUUID, "Parent")
	insertTemplateSessionRaw(t, db, templateID, 0, "Session")

	resetTenantContext(t, db)
	var count int
	if err := db.QueryRow(ctx,
		"SELECT count(*) FROM template_sessions WHERE center_id = $1", center.ID,
	).Scan(&count); err != nil {
		t.Fatalf("count with null tenant: %v", err)
	}
	if count != 0 {
		t.Errorf("RLS VIOLATION: null tenant returned %d tenant-scoped template_sessions rows, expected 0", count)
	}
}

// -----------------------------------------------------------------------------
// Pattern 6 — UnsetTenant
// -----------------------------------------------------------------------------
func TestRLS_TemplateSession_UnsetTenant(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()

	center := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	TenantContext(t, db, center.ID)
	centerUUID := uuid.UUID(center.ID.Bytes)
	templateID := insertClassTemplateRaw(t, db, &centerUUID, "Parent")
	insertTemplateSessionRaw(t, db, templateID, 0, "Session")

	resetTenantContextToDefault(t, db)
	var count int
	if err := db.QueryRow(ctx,
		"SELECT count(*) FROM template_sessions WHERE center_id = $1", center.ID,
	).Scan(&count); err != nil {
		t.Fatalf("count with unset tenant: %v", err)
	}
	if count != 0 {
		t.Errorf("RLS VIOLATION: unset tenant returned %d tenant-scoped template_sessions rows, expected 0", count)
	}
}

// -----------------------------------------------------------------------------
// Extension 1 — TriggerReconcilesToParentTenancy (Murat-M-B1 positive path)
// SET LOCAL tenantA; INSERT with center_id = NULL; BEFORE trigger rewrites
// center_id from parent template. Post-insert row must have center_id = tenantA.
// -----------------------------------------------------------------------------
func TestRLS_TemplateSession_TriggerReconcilesToParentTenancy(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()

	centerA := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	TenantContext(t, db, centerA.ID)
	centerAUUID := uuid.UUID(centerA.ID.Bytes)
	templateID := insertClassTemplateRaw(t, db, &centerAUUID, "A parent")

	id := uuid.New()
	// Note: insertTemplateSessionRaw uses center_id = NULL by design so the
	// trigger has to reconcile.
	_, err := db.Exec(ctx,
		`INSERT INTO template_sessions (id, template_id, center_id, session_order, title)
		 VALUES ($1, $2, NULL, 0, 'reconciled by trigger')`,
		id, templateID,
	)
	if err != nil {
		t.Fatalf("insert with NULL center_id (trigger should reconcile): %v", err)
	}

	// Post-insert: row's center_id must equal parent's center_id (tenant A).
	// C3-09 review fix — scan into a typed pgtype.UUID and assert the exact
	// value equals centerA.ID. Previously the scan target was `any` and only
	// the nil-check was performed, so a trigger that wrote the WRONG tenant's
	// UUID (or a hardcoded UUID) would silently pass.
	var gotCenterID pgtype.UUID
	if err := db.QueryRow(ctx,
		`SELECT center_id FROM template_sessions WHERE id = $1`, id,
	).Scan(&gotCenterID); err != nil {
		t.Fatalf("re-read row: %v", err)
	}
	if !gotCenterID.Valid {
		t.Errorf("Murat-M-B1 VIOLATION: BEFORE trigger did not populate center_id — got NULL, expected tenant A's UUID")
	} else if gotCenterID != centerA.ID {
		t.Errorf("Murat-M-B1 VIOLATION: trigger wrote wrong center_id (got %v, expected %v) — cross-tenant leakage via trigger writing wrong UUID", gotCenterID, centerA.ID)
	}
}

// -----------------------------------------------------------------------------
// Extension 2 — ParentTenantMismatchRejectedByWithCheck (Murat-M-B1)
// Tenant A context; INSERT template_sessions with template_id = tenant B's
// template AND center_id = tenant A. BEFORE trigger rewrites center_id from
// the parent → tenant B. WITH CHECK re-evaluates: tenantB != current_tenant
// tenantA → rejected. This is the load-bearing R1 discharge for the trigger
// (a regression that swaps BEFORE→AFTER, or drops WITH CHECK, opens a
// cross-tenant plant vector via parent-template-ID confusion).
// -----------------------------------------------------------------------------
func TestRLS_TemplateSession_ParentTenantMismatchRejectedByWithCheck(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()

	centerA := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	centerB := CreateCenterWithID(t, db, TenantBID, "Center B", "center-b")

	// Tenant B creates parent template.
	TenantContext(t, db, centerB.ID)
	centerBUUID := uuid.UUID(centerB.ID.Bytes)
	templateBID := insertClassTemplateRaw(t, db, &centerBUUID, "B parent")

	// Tenant A tries to plant a session under tenant B's template.
	TenantContext(t, db, centerA.ID)
	id := uuid.New()
	_, err := db.Exec(ctx,
		`INSERT INTO template_sessions (id, template_id, center_id, session_order, title)
		 VALUES ($1, $2, $3, 0, 'planted via parent-id confusion')`,
		id, templateBID, centerA.ID,
	)
	if err == nil {
		t.Error("Murat-M-B1 VIOLATION: INSERT with parent-tenant mismatch should have been rejected by trigger+WITH CHECK combo — an attacker with valid tenant A context could otherwise plant sessions under tenant B's templates")
	}
}

// -----------------------------------------------------------------------------
// Extension 3 — UserCannotPlantSessionUnderSystemSeed (Murat-M-B1)
// Trigger copies parent's NULL into row.center_id; WITH CHECK rejects
// because NULL != tenantA. Load-bearing "system seed sessions catalog is
// unforgeable by users."
// -----------------------------------------------------------------------------
func TestRLS_TemplateSession_UserCannotPlantSessionUnderSystemSeed(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()

	// A system-seeded template with fixed UUID (per AC1b — Writing Bootcamp 6.5).
	// Seed migration runs during migrate-up on the test pool, so this UUID
	// already exists.
	seedTemplateID := uuid.MustParse("11111111-2222-3333-4444-555555555501")

	centerA := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	TenantContext(t, db, centerA.ID)

	id := uuid.New()
	_, err := db.Exec(ctx,
		`INSERT INTO template_sessions (id, template_id, center_id, session_order, title)
		 VALUES ($1, $2, $3, 99, 'user plant under system seed')`,
		id, seedTemplateID, centerA.ID,
	)
	if err == nil {
		t.Error("Murat-M-B1 VIOLATION: user planted a template_sessions row under a system seed template — trigger should rewrite center_id to NULL and WITH CHECK should reject")
	}
}

// -----------------------------------------------------------------------------
// C3-01 review fix — WITH CHECK on UPDATE (tenant-reparent).
// Direct UPDATE of center_id skips the sync trigger (trigger fires on INSERT
// only). Without WITH CHECK on the UPDATE policy, tenant A could silently
// reparent their own session row into tenant B's scope.
// -----------------------------------------------------------------------------
func TestRLS_TemplateSession_TenantCannotReparentOwnRow(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()

	centerA := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	centerB := CreateCenterWithID(t, db, TenantBID, "Center B", "center-b")

	TenantContext(t, db, centerA.ID)
	centerAUUID := uuid.UUID(centerA.ID.Bytes)
	templateAID := insertClassTemplateRaw(t, db, &centerAUUID, "A Template")
	sessionID := insertTemplateSessionRaw(t, db, templateAID, 0, "A session")

	// R2-P13 — always re-read regardless of updateErr. WITH CHECK on
	// template_sessions_update MAY raise (42501) OR silently reject (0 rows).
	// Either outcome is policy-compliant; row-still-tenant-A is what matters.
	// SAVEPOINT keeps the outer TxDB single-tx usable on raise (mirrors the
	// TenantCannotReparentViaTemplateIDSwap sibling test just below).
	if _, err := db.Exec(ctx, "SAVEPOINT sp_ts_reparent"); err != nil {
		t.Fatalf("savepoint: %v", err)
	}
	_, updateErr := db.Exec(ctx,
		`UPDATE template_sessions SET center_id = $1 WHERE id = $2`,
		centerB.ID, sessionID,
	)
	if updateErr != nil {
		if _, rbErr := db.Exec(ctx, "ROLLBACK TO SAVEPOINT sp_ts_reparent"); rbErr != nil {
			t.Fatalf("rollback savepoint after UPDATE raise: %v", rbErr)
		}
	} else {
		if _, relErr := db.Exec(ctx, "RELEASE SAVEPOINT sp_ts_reparent"); relErr != nil {
			t.Fatalf("release savepoint: %v", relErr)
		}
	}
	var storedCenter uuid.UUID
	if scanErr := db.QueryRow(ctx,
		`SELECT center_id FROM template_sessions WHERE id = $1`, sessionID,
	).Scan(&storedCenter); scanErr != nil {
		t.Fatalf("re-read after UPDATE (err=%v): %v", updateErr, scanErr)
	}
	if storedCenter != centerAUUID {
		t.Errorf("RLS VIOLATION: tenant A reparented own template_session row to tenant B (stored center_id=%v, expected=%v)", storedCenter, centerAUUID)
	}
}

// -----------------------------------------------------------------------------
// C3-08 review fix — UPDATE reparenting via template_id (cross-tenant plant
// via parent-template swap). The sync trigger fires on INSERT only per the
// current migration. If UPDATE isn't policed, tenant A can UPDATE own session's
// template_id to a different tenant's template — silently "moving" the row
// under someone else's template.
// -----------------------------------------------------------------------------
func TestRLS_TemplateSession_TenantCannotReparentViaTemplateIDSwap(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()

	centerA := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	centerB := CreateCenterWithID(t, db, TenantBID, "Center B", "center-b")

	// Tenant A has its own template + session.
	TenantContext(t, db, centerA.ID)
	centerAUUID := uuid.UUID(centerA.ID.Bytes)
	templateAID := insertClassTemplateRaw(t, db, &centerAUUID, "A parent")
	sessionID := insertTemplateSessionRaw(t, db, templateAID, 0, "A session")

	// Tenant B has its own template.
	TenantContext(t, db, centerB.ID)
	centerBUUID := uuid.UUID(centerB.ID.Bytes)
	templateBID := insertClassTemplateRaw(t, db, &centerBUUID, "B parent")

	// Tenant A tries to reparent own session under tenant B's template.
	// SAVEPOINT wraps the UPDATE so a raise-based rejection (WITH CHECK on
	// template_sessions, or FK-visibility failure) can be rolled back without
	// aborting the outer TxDB single-tx (25P02).
	TenantContext(t, db, centerA.ID)
	if _, err := db.Exec(ctx, "SAVEPOINT sp_swap"); err != nil {
		t.Fatalf("savepoint: %v", err)
	}
	tag, err := db.Exec(ctx,
		`UPDATE template_sessions SET template_id = $1 WHERE id = $2`,
		templateBID, sessionID,
	)
	if err != nil {
		// Raise-based rejection: roll back the savepoint so the outer tx is
		// still usable for the re-read assertion.
		if _, rbErr := db.Exec(ctx, "ROLLBACK TO SAVEPOINT sp_swap"); rbErr != nil {
			t.Fatalf("rollback savepoint after UPDATE raise: %v", rbErr)
		}
	} else {
		if _, err := db.Exec(ctx, "RELEASE SAVEPOINT sp_swap"); err != nil {
			t.Fatalf("release savepoint: %v", err)
		}
		if rows := tag.RowsAffected(); rows != 0 {
			t.Errorf("RLS VIOLATION: tenant A UPDATE affected %d template_sessions rows during template_id swap, expected 0 — cross-tenant plant vector open", rows)
		}
	}

	// Confirm the row's template_id was not silently updated.
	var stored pgtype.UUID
	if scanErr := db.QueryRow(ctx,
		`SELECT template_id FROM template_sessions WHERE id = $1`, sessionID,
	).Scan(&stored); scanErr != nil {
		t.Fatalf("re-read stored template_id: %v", scanErr)
	}
	if stored.Bytes != [16]byte(templateAID) {
		t.Errorf("RLS VIOLATION: tenant A silently reparented own session to tenant B's template (stored template_id=%v, expected=%v)", stored, templateAID)
	}
}
