// Story 2.5c — R1 discharge (Task 3, AC13): RLS matrix for
// `center_integrations`. Three-row split per the story's minimum:
//
//   Pattern 1  CrossTenantRead   — tenant A cannot SELECT tenant B's rows.
//   Pattern 2  CrossTenantInsert — WITH CHECK guard on INSERT (SQLSTATE 42501).
//   Pattern 3  CrossTenantUpdate — WITH CHECK guard on UPDATE reparent
//                                  attempt (silent USING drop + WITH CHECK
//                                  on any surviving target UUID mutation).
//
// Migration: 20260714120400_create_center_integrations.up.sql (Task 1).
// UNIQUE(center_id, provider) covered in service/handler tests, not here.
//
// Encrypted token bytea payloads are opaque here — the test uses fixed
// 32-byte fillers. AES-GCM Seal/Open is exercised separately in
// integration_crypto_test.go.

package test

import (
	"bytes"
	"context"
	"testing"

	"github.com/google/uuid"
)

// insertCenterIntegrationRaw inserts a center_integrations row via raw SQL.
// Tenant context must already be set. Provider is fixed at 'google_meet'
// (the only shipped value per the AC6 CHECK constraint).
func insertCenterIntegrationRaw(t *testing.T, db *TxDB, centerID uuid.UUID, scope string) uuid.UUID {
	t.Helper()
	id := uuid.New()
	// 32-byte fillers matching AES-GCM ciphertext width; content is opaque here.
	accessTok := bytes.Repeat([]byte{0xA0}, 32)
	refreshTok := bytes.Repeat([]byte{0xB0}, 32)
	_, err := db.Exec(context.Background(),
		`INSERT INTO center_integrations (
		    id, center_id, provider,
		    access_token_encrypted, refresh_token_encrypted,
		    scope, expires_at
		 ) VALUES ($1, $2, 'google_meet', $3, $4, $5, now() + interval '1 hour')`,
		id, centerID, accessTok, refreshTok, scope,
	)
	if err != nil {
		t.Fatalf("insert center_integrations row: %v", err)
	}
	return id
}

// -----------------------------------------------------------------------------
// Pattern 1 — CrossTenantRead. Tenant A must not see Tenant B's integration row.
// -----------------------------------------------------------------------------
func TestRLS_CenterIntegration_CrossTenantRead(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()

	centerA := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	centerB := CreateCenterWithID(t, db, TenantBID, "Center B", "center-b")

	TenantContext(t, db, centerB.ID)
	insertCenterIntegrationRaw(t, db, uuid.UUID(centerB.ID.Bytes), "https://www.googleapis.com/auth/calendar.events")

	TenantContext(t, db, centerA.ID)
	var visibleB int
	if err := db.QueryRow(ctx,
		"SELECT count(*) FROM center_integrations WHERE center_id = $1",
		centerB.ID,
	).Scan(&visibleB); err != nil {
		t.Fatalf("broad count as tenant A: %v", err)
	}
	if visibleB != 0 {
		t.Errorf("RLS VIOLATION: tenant A saw %d tenant B center_integrations rows, expected 0", visibleB)
	}
}

// -----------------------------------------------------------------------------
// Pattern 2 — CrossTenantInsert. WITH CHECK on INSERT rejects any attempt by
// tenant A to plant a row scoped to tenant B's center_id.
// -----------------------------------------------------------------------------
func TestRLS_CenterIntegration_CrossTenantInsert(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()

	centerA := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	centerB := CreateCenterWithID(t, db, TenantBID, "Center B", "center-b")

	TenantContext(t, db, centerA.ID)
	id := uuid.New()
	accessTok := bytes.Repeat([]byte{0xC0}, 32)
	refreshTok := bytes.Repeat([]byte{0xD0}, 32)
	_, err := db.Exec(ctx,
		`INSERT INTO center_integrations (
		    id, center_id, provider,
		    access_token_encrypted, refresh_token_encrypted,
		    scope, expires_at
		 ) VALUES ($1, $2, 'google_meet', $3, $4, 'hostile', now() + interval '1 hour')`,
		id, centerB.ID, accessTok, refreshTok,
	)
	AssertRLSViolation(t, err,
		"center_integrations cross-tenant INSERT with WITH CHECK forced center_id=tenantB")
}

// -----------------------------------------------------------------------------
// Pattern 4 — CrossTenantDelete. Tenant A tries to DELETE tenant B's
// integration row (must silently 0-row via USING). P7 fix (Round 1 code
// review Chunk 2, 2026-07-16, Edge Case #13): the migration defines a 4th
// center_integrations_delete policy that had NO adversarial test — this
// closes AC13's "read AND write isolation for ALL 4 policies" invariant.
//
// Positive control: tenant B deleting their own row succeeds. Without this
// control, "0 rows affected" for tenant A could mean either RLS working OR
// tenant A's WHERE clause matching nothing for an unrelated reason.
// -----------------------------------------------------------------------------
func TestRLS_CenterIntegration_CrossTenantDelete(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()

	centerA := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	centerB := CreateCenterWithID(t, db, TenantBID, "Center B", "center-b")

	// Tenant B seeds a row.
	TenantContext(t, db, centerB.ID)
	rowB := insertCenterIntegrationRaw(t, db, uuid.UUID(centerB.ID.Bytes), "scope-B-del")

	// Tenant A attempts DELETE of tenant B's row (id-targeted, no center_id
	// filter — proving RLS is the only guard).
	TenantContext(t, db, centerA.ID)
	tag, err := db.Exec(ctx,
		`DELETE FROM center_integrations WHERE id = $1`, rowB,
	)
	if err != nil {
		t.Fatalf("DELETE returned error (expected silent 0-rows via USING): %v", err)
	}
	if rows := tag.RowsAffected(); rows != 0 {
		t.Errorf("RLS VIOLATION: tenant A DELETE affected %d rows on tenant B's row, expected 0", rows)
	}

	// Positive control: tenant B can still DELETE own row (proving the row
	// wasn't already gone / the WHERE clause resolves under proper tenant).
	TenantContext(t, db, centerB.ID)
	tagB, err := db.Exec(ctx,
		`DELETE FROM center_integrations WHERE id = $1`, rowB,
	)
	if err != nil {
		t.Fatalf("tenant B DELETE of own row: %v", err)
	}
	if rows := tagB.RowsAffected(); rows != 1 {
		t.Errorf("positive control failed: tenant B DELETE affected %d rows, expected 1 — either the row was silently deleted by tenant A OR the test setup is broken", rows)
	}
}

// -----------------------------------------------------------------------------
// Pattern 3 — CrossTenantUpdate reparent attempt. Tenant A tries to UPDATE
// tenant B's row (must silently 0-row via USING) AND also tries to reparent
// their own row to tenant B (must reject via WITH CHECK on UPDATE per AC6 +
// Winston-B2 close-the-reparent-attack folded into center_integrations_update
// policy).
// -----------------------------------------------------------------------------
func TestRLS_CenterIntegration_CrossTenantUpdateReparent(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()

	centerA := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	centerB := CreateCenterWithID(t, db, TenantBID, "Center B", "center-b")

	// Tenant B owns integration row.
	TenantContext(t, db, centerB.ID)
	rowB := insertCenterIntegrationRaw(t, db, uuid.UUID(centerB.ID.Bytes), "scope-B")

	// Tenant A tries to UPDATE tenant B's row (silent 0-row expected via USING).
	TenantContext(t, db, centerA.ID)
	tag, err := db.Exec(ctx,
		`UPDATE center_integrations SET scope = 'Hacked' WHERE id = $1`, rowB,
	)
	if err != nil {
		t.Fatalf("UPDATE returned error (expected silent 0-rows): %v", err)
	}
	if rows := tag.RowsAffected(); rows != 0 {
		t.Errorf("RLS VIOLATION: tenant A UPDATE affected %d rows on tenant B's row, expected 0", rows)
	}

	// Confirm tenant B's row is untouched.
	TenantContext(t, db, centerB.ID)
	var scope string
	if err := db.QueryRow(ctx,
		`SELECT scope FROM center_integrations WHERE id = $1`, rowB,
	).Scan(&scope); err != nil {
		t.Fatalf("re-read as tenant B: %v", err)
	}
	if scope != "scope-B" {
		t.Errorf("RLS VIOLATION: tenant B's scope mutated to %q, expected 'scope-B'", scope)
	}

	// Tenant A owns their own row and tries to REPARENT it to tenant B via UPDATE.
	// WITH CHECK on UPDATE (mirrors class_templates policy 3) must reject.
	TenantContext(t, db, centerA.ID)
	rowA := insertCenterIntegrationRaw(t, db, uuid.UUID(centerA.ID.Bytes), "scope-A")
	_, err = db.Exec(ctx,
		`UPDATE center_integrations SET center_id = $1 WHERE id = $2`,
		centerB.ID, rowA,
	)
	AssertRLSViolation(t, err,
		"center_integrations UPDATE reparent to tenant B via WITH CHECK")
}
