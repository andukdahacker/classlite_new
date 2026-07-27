// Story 3.5 — RLS + isolation grid for the three session-content tables
// (session_notes, session_materials, session_exercises). Each table carries its
// OWN center_id and the verbatim 4-policy grid cloned from sessions; this file
// is the mandatory ×3 null-guard regression (maps to R2, score 6) plus the
// FK-cascade and same-tenant cross-session correctness guards RLS cannot catch.
//
// The grid is parametrized over the three tables via t.Run subtests so a policy
// dropped from ANY of the three fails loudly, without three copies of each case.
package test

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
)

// contentTableSpec drives the parametrized grid: a table name, a mutable column
// used by the cross-tenant write test, and an INSERT (sql, args) builder shared
// by the happy-path inserter and the null-guard rejection cases.
type contentTableSpec struct {
	name      string
	writeCol  string
	insertSQL func(id, centerID, sessionID uuid.UUID) (string, []any)
}

func contentSpecs() []contentTableSpec {
	return []contentTableSpec{
		{
			name:     "session_notes",
			writeCol: "body",
			insertSQL: func(id, centerID, sessionID uuid.UUID) (string, []any) {
				return `INSERT INTO session_notes (id, center_id, session_id, body) VALUES ($1, $2, $3, 'Original')`,
					[]any{id, centerID, sessionID}
			},
		},
		{
			name:     "session_materials",
			writeCol: "title",
			insertSQL: func(id, centerID, sessionID uuid.UUID) (string, []any) {
				return `INSERT INTO session_materials (id, center_id, session_id, title, url) VALUES ($1, $2, $3, 'Original', 'https://example.com')`,
					[]any{id, centerID, sessionID}
			},
		},
		{
			name:     "session_exercises",
			writeCol: "title",
			insertSQL: func(id, centerID, sessionID uuid.UUID) (string, []any) {
				return `INSERT INTO session_exercises (id, center_id, session_id, title) VALUES ($1, $2, $3, 'Original')`,
					[]any{id, centerID, sessionID}
			},
		},
	}
}

// seedContentParent creates a center + class + session under the given tenant
// (caller must have set the tenant context) and returns the session id. The
// parent session is the FK anchor for every content row.
func seedContentParent(t *testing.T, db *TxDB, centerID uuid.UUID) uuid.UUID {
	t.Helper()
	class := seedClassForSession(t, db, centerID)
	return insertSessionRaw(t, db, centerID, class, time.Now().Add(24*time.Hour), nil)
}

// insertContentRaw inserts one content row via the spec builder, failing on error.
func insertContentRaw(t *testing.T, db *TxDB, spec contentTableSpec, centerID, sessionID uuid.UUID) uuid.UUID {
	t.Helper()
	id := uuid.New()
	sql, args := spec.insertSQL(id, centerID, sessionID)
	if _, err := db.Exec(context.Background(), sql, args...); err != nil {
		t.Fatalf("insert %s row: %v", spec.name, err)
	}
	return id
}

// -----------------------------------------------------------------------------
// Pattern 1 — CrossTenantRead: tenant A sees zero of tenant B's content rows.
// -----------------------------------------------------------------------------
func TestRLS_SessionContent_CrossTenantRead(t *testing.T) {
	for _, spec := range contentSpecs() {
		t.Run(spec.name, func(t *testing.T) {
			db := SetupDB(t)
			ctx := context.Background()
			centerA := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
			centerB := CreateCenterWithID(t, db, TenantBID, "Center B", "center-b")

			TenantContext(t, db, centerB.ID)
			centerBUUID := uuid.UUID(centerB.ID.Bytes)
			sessionB := seedContentParent(t, db, centerBUUID)
			insertContentRaw(t, db, spec, centerBUUID, sessionB)

			TenantContext(t, db, centerA.ID)
			var visible int
			if err := db.QueryRow(ctx,
				"SELECT count(*) FROM "+spec.name+" WHERE center_id = $1", centerB.ID,
			).Scan(&visible); err != nil {
				t.Fatalf("broad count as tenant A: %v", err)
			}
			if visible != 0 {
				t.Errorf("RLS VIOLATION: tenant A saw %d tenant B %s rows, expected 0", visible, spec.name)
			}
		})
	}
}

// -----------------------------------------------------------------------------
// Pattern 2 — CrossTenantInsert: WITH CHECK rejects a center_id spoof.
// -----------------------------------------------------------------------------
func TestRLS_SessionContent_CrossTenantInsert(t *testing.T) {
	for _, spec := range contentSpecs() {
		t.Run(spec.name, func(t *testing.T) {
			db := SetupDB(t)
			ctx := context.Background()
			centerA := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
			centerB := CreateCenterWithID(t, db, TenantBID, "Center B", "center-b")

			// Parent session must exist in B for the FK; seed as B.
			TenantContext(t, db, centerB.ID)
			centerBUUID := uuid.UUID(centerB.ID.Bytes)
			sessionB := seedContentParent(t, db, centerBUUID)

			// As tenant A, try to write a row stamped with B's center_id.
			TenantContext(t, db, centerA.ID)
			sql, args := spec.insertSQL(uuid.New(), centerBUUID, sessionB)
			_, err := db.Exec(ctx, sql, args...)
			AssertRLSViolation(t, err, spec.name+" cross-tenant INSERT")
		})
	}
}

// -----------------------------------------------------------------------------
// Pattern 3 — CrossTenantWrite: silent 0-rows, target unchanged (the
// "UPDATE-0-rows-is-not-an-error" Postgres trap — verified by re-fetch).
// -----------------------------------------------------------------------------
func TestRLS_SessionContent_CrossTenantWrite(t *testing.T) {
	for _, spec := range contentSpecs() {
		t.Run(spec.name, func(t *testing.T) {
			db := SetupDB(t)
			ctx := context.Background()
			centerA := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
			centerB := CreateCenterWithID(t, db, TenantBID, "Center B", "center-b")

			TenantContext(t, db, centerB.ID)
			centerBUUID := uuid.UUID(centerB.ID.Bytes)
			sessionB := seedContentParent(t, db, centerBUUID)
			rowID := insertContentRaw(t, db, spec, centerBUUID, sessionB)

			TenantContext(t, db, centerA.ID)
			tag, err := db.Exec(ctx, "UPDATE "+spec.name+" SET "+spec.writeCol+" = 'Hacked' WHERE id = $1", rowID)
			if err != nil {
				t.Fatalf("UPDATE returned error (expected silent 0-rows): %v", err)
			}
			if rows := tag.RowsAffected(); rows != 0 {
				t.Errorf("RLS VIOLATION: tenant A UPDATE affected %d %s rows on tenant B, expected 0", rows, spec.name)
			}

			TenantContext(t, db, centerB.ID)
			var value string
			if err := db.QueryRow(ctx, "SELECT "+spec.writeCol+" FROM "+spec.name+" WHERE id = $1", rowID).Scan(&value); err != nil {
				t.Fatalf("re-read as tenant B: %v", err)
			}
			if value != "Original" {
				t.Errorf("RLS VIOLATION: tenant A UPDATE against tenant B %s row succeeded (%s=%q)", spec.name, spec.writeCol, value)
			}
		})
	}
}

// -----------------------------------------------------------------------------
// Pattern 4 — CrossTenantDelete: silent 0-rows, target survives.
// -----------------------------------------------------------------------------
func TestRLS_SessionContent_CrossTenantDelete(t *testing.T) {
	for _, spec := range contentSpecs() {
		t.Run(spec.name, func(t *testing.T) {
			db := SetupDB(t)
			ctx := context.Background()
			centerA := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
			centerB := CreateCenterWithID(t, db, TenantBID, "Center B", "center-b")

			TenantContext(t, db, centerB.ID)
			centerBUUID := uuid.UUID(centerB.ID.Bytes)
			sessionB := seedContentParent(t, db, centerBUUID)
			targetID := insertContentRaw(t, db, spec, centerBUUID, sessionB)

			TenantContext(t, db, centerA.ID)
			delTag, err := db.Exec(ctx, "DELETE FROM "+spec.name+" WHERE id = $1", targetID)
			if err != nil {
				t.Fatalf("DELETE returned error (expected silent 0-rows): %v", err)
			}
			if rows := delTag.RowsAffected(); rows != 0 {
				t.Errorf("RLS VIOLATION: tenant A DELETE affected %d %s rows on tenant B, expected 0", rows, spec.name)
			}

			TenantContext(t, db, centerB.ID)
			var stillExists int
			if err := db.QueryRow(ctx, "SELECT count(*) FROM "+spec.name+" WHERE id = $1", targetID).Scan(&stillExists); err != nil {
				t.Fatalf("count target row as tenant B: %v", err)
			}
			if stillExists != 1 {
				t.Errorf("RLS VIOLATION: cross-tenant DELETE succeeded — tenant B %s row is gone", spec.name)
			}
		})
	}
}

// -----------------------------------------------------------------------------
// Pattern 5 — NullTenant: SET LOCAL app.current_tenant_id = ” yields zero rows
// AND rejects INSERT (WITH CHECK). Mandatory ×3 null-guard (R2, score 6).
// -----------------------------------------------------------------------------
func TestRLS_SessionContent_NullTenant(t *testing.T) {
	for _, spec := range contentSpecs() {
		t.Run(spec.name, func(t *testing.T) {
			db := SetupDB(t)
			ctx := context.Background()
			center := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
			TenantContext(t, db, center.ID)
			centerUUID := uuid.UUID(center.ID.Bytes)
			sessionID := seedContentParent(t, db, centerUUID)
			insertContentRaw(t, db, spec, centerUUID, sessionID)

			resetTenantContext(t, db)
			var count int
			if err := db.QueryRow(ctx, "SELECT count(*) FROM "+spec.name+" WHERE center_id = $1", center.ID).Scan(&count); err != nil {
				t.Fatalf("count with null tenant: %v", err)
			}
			if count != 0 {
				t.Errorf("RLS VIOLATION: null tenant returned %d %s rows, expected 0", count, spec.name)
			}

			// INSERT under a null tenant must be rejected by WITH CHECK.
			sql, args := spec.insertSQL(uuid.New(), centerUUID, sessionID)
			_, insErr := db.Exec(ctx, sql, args...)
			AssertRLSViolation(t, insErr, spec.name+" null-tenant INSERT")
		})
	}
}

// -----------------------------------------------------------------------------
// Pattern 6 — UnsetTenant: RESET app.current_tenant_id yields zero rows AND
// rejects INSERT.
// -----------------------------------------------------------------------------
func TestRLS_SessionContent_UnsetTenant(t *testing.T) {
	for _, spec := range contentSpecs() {
		t.Run(spec.name, func(t *testing.T) {
			db := SetupDB(t)
			ctx := context.Background()
			center := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
			TenantContext(t, db, center.ID)
			centerUUID := uuid.UUID(center.ID.Bytes)
			sessionID := seedContentParent(t, db, centerUUID)
			insertContentRaw(t, db, spec, centerUUID, sessionID)

			resetTenantContextToDefault(t, db)
			var count int
			if err := db.QueryRow(ctx, "SELECT count(*) FROM "+spec.name+" WHERE center_id = $1", center.ID).Scan(&count); err != nil {
				t.Fatalf("count with unset tenant: %v", err)
			}
			if count != 0 {
				t.Errorf("RLS VIOLATION: unset tenant returned %d %s rows, expected 0", count, spec.name)
			}

			sql, args := spec.insertSQL(uuid.New(), centerUUID, sessionID)
			_, insErr := db.Exec(ctx, sql, args...)
			AssertRLSViolation(t, insErr, spec.name+" unset-tenant INSERT")
		})
	}
}

// -----------------------------------------------------------------------------
// WITH CHECK on UPDATE — a tenant cannot reparent its own content row to
// another center. Dropping WITH CHECK would pass every other RLS test silently.
// -----------------------------------------------------------------------------
func TestRLS_SessionContent_TenantCannotReparentOwnRow(t *testing.T) {
	for _, spec := range contentSpecs() {
		t.Run(spec.name, func(t *testing.T) {
			db := SetupDB(t)
			ctx := context.Background()
			centerA := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
			centerB := CreateCenterWithID(t, db, TenantBID, "Center B", "center-b")

			TenantContext(t, db, centerA.ID)
			centerAUUID := uuid.UUID(centerA.ID.Bytes)
			sessionA := seedContentParent(t, db, centerAUUID)
			rowID := insertContentRaw(t, db, spec, centerAUUID, sessionA)

			if _, err := db.Exec(ctx, "SAVEPOINT sp_content_reparent"); err != nil {
				t.Fatalf("savepoint: %v", err)
			}
			_, updateErr := db.Exec(ctx, "UPDATE "+spec.name+" SET center_id = $1 WHERE id = $2", centerB.ID, rowID)
			if updateErr != nil {
				if _, rbErr := db.Exec(ctx, "ROLLBACK TO SAVEPOINT sp_content_reparent"); rbErr != nil {
					t.Fatalf("rollback savepoint: %v", rbErr)
				}
			} else {
				if _, relErr := db.Exec(ctx, "RELEASE SAVEPOINT sp_content_reparent"); relErr != nil {
					t.Fatalf("release savepoint: %v", relErr)
				}
			}
			var storedCenter uuid.UUID
			if scanErr := db.QueryRow(ctx, "SELECT center_id FROM "+spec.name+" WHERE id = $1", rowID).Scan(&storedCenter); scanErr != nil {
				t.Fatalf("re-read after UPDATE (err=%v): %v", updateErr, scanErr)
			}
			if storedCenter != centerAUUID {
				t.Errorf("RLS VIOLATION: tenant A reparented own %s row to tenant B (stored=%v, expected=%v)", spec.name, storedCenter, centerAUUID)
			}
		})
	}
}

// -----------------------------------------------------------------------------
// FK cascade — deleting the parent session removes its content rows
// (ON DELETE CASCADE). Nothing else has a consumer to catch a broken cascade.
// -----------------------------------------------------------------------------
func TestSessionContent_SessionDeleteCascade(t *testing.T) {
	for _, spec := range contentSpecs() {
		t.Run(spec.name, func(t *testing.T) {
			db := SetupDB(t)
			ctx := context.Background()
			center := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
			TenantContext(t, db, center.ID)
			centerUUID := uuid.UUID(center.ID.Bytes)
			sessionID := seedContentParent(t, db, centerUUID)
			rowID := insertContentRaw(t, db, spec, centerUUID, sessionID)

			if _, err := db.Exec(ctx, `DELETE FROM sessions WHERE id = $1`, sessionID); err != nil {
				t.Fatalf("delete parent session: %v", err)
			}
			var stillExists int
			if err := db.QueryRow(ctx, "SELECT count(*) FROM "+spec.name+" WHERE id = $1", rowID).Scan(&stillExists); err != nil {
				t.Fatalf("count content after cascade: %v", err)
			}
			if stillExists != 0 {
				t.Errorf("CASCADE VIOLATION: %s row survived parent-session delete (ON DELETE CASCADE broken)", spec.name)
			}
		})
	}
}

// -----------------------------------------------------------------------------
// Same-tenant cross-session isolation — content written on session X must not
// surface when listing session Y (both in one center). This is WHERE-clause
// correctness, NOT RLS — RLS won't catch it.
// -----------------------------------------------------------------------------
func TestSessionContent_SameTenantCrossSession(t *testing.T) {
	for _, spec := range contentSpecs() {
		t.Run(spec.name, func(t *testing.T) {
			db := SetupDB(t)
			ctx := context.Background()
			center := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
			TenantContext(t, db, center.ID)
			centerUUID := uuid.UUID(center.ID.Bytes)
			class := seedClassForSession(t, db, centerUUID)
			sessionX := insertSessionRaw(t, db, centerUUID, class, time.Now().Add(24*time.Hour), nil)
			sessionY := insertSessionRaw(t, db, centerUUID, class, time.Now().Add(48*time.Hour), nil)
			insertContentRaw(t, db, spec, centerUUID, sessionX)

			var onY int
			if err := db.QueryRow(ctx, "SELECT count(*) FROM "+spec.name+" WHERE session_id = $1", sessionY).Scan(&onY); err != nil {
				t.Fatalf("count content on session Y: %v", err)
			}
			if onY != 0 {
				t.Errorf("WHERE-CLAUSE LEAK: %s written on session X surfaced when listing session Y (%d rows)", spec.name, onY)
			}
		})
	}
}
