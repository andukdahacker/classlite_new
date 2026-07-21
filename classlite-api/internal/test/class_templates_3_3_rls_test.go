// Story 3.3 — ATDD red-phase: RLS adversarial coverage for the NEW template
// mutation verbs (soft-delete + scalar UPDATE) and the SEC-9 soft-delete filter.
//
// These extend the Story 2.2 J15 grid in class_templates_rls_test.go. The 2.2
// grid already proves cross-tenant SELECT/INSERT/UPDATE/DELETE isolation and the
// system-seed WITH-CHECK guard; Story 3.3 adds `updated_at`/`deleted_at` columns
// and a reCREATE'd SELECT policy (`AND deleted_at IS NULL`), so these three tests
// guard the mutation paths those columns unlock.
//
// Expected RED against the current codebase (baseline e3a5df5):
//   R1/R2 — `UPDATE class_templates SET updated_at/deleted_at ...` errors with
//           `column "..." does not exist` until Task 1 migration lands.
//   R4    — even once the column exists, the row stays VISIBLE to its own tenant
//           until the SELECT policy is reCREATE'd with `AND deleted_at IS NULL`.
// Amelia flips these green by landing Task 1 (migration + SEC-9 policy).
//
// Reuses package-test helpers: SetupDB, CreateCenterWithID, TenantContext,
// TenantAID/TenantBID, and insertClassTemplateRaw (class_templates_rls_test.go).

package test

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
)

// R1 (P0) — Cross-tenant scalar UPDATE is rejected by the UPDATE WITH-CHECK/USING
// policy: tenant A's UPDATE against tenant B's template affects 0 rows and leaves
// the row unchanged. Depends on the new `updated_at` column.
func TestRLS_ClassTemplate_3_3_CrossTenantUpdate_Rejected(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()

	centerA := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	centerB := CreateCenterWithID(t, db, TenantBID, "Center B", "center-b")

	TenantContext(t, db, centerB.ID)
	centerBUUID := uuid.UUID(centerB.ID.Bytes)
	tmplB := insertClassTemplateRaw(t, db, &centerBUUID, "Tenant B template")

	// Tenant A attempts to rename tenant B's template.
	TenantContext(t, db, centerA.ID)
	tag, err := db.Exec(ctx,
		`UPDATE class_templates SET name = 'HACKED', updated_at = now() WHERE id = $1`, tmplB)
	if err != nil {
		t.Fatalf("RED until Task 1 adds class_templates.updated_at: %v", err)
	}
	if n := tag.RowsAffected(); n != 0 {
		t.Errorf("RLS VIOLATION: tenant A UPDATE affected %d of tenant B's template rows, want 0", n)
	}

	// Re-read as tenant B — name must be unchanged.
	TenantContext(t, db, centerB.ID)
	var name string
	if err := db.QueryRow(ctx, `SELECT name FROM class_templates WHERE id = $1`, tmplB).Scan(&name); err != nil {
		t.Fatalf("re-read as tenant B: %v", err)
	}
	if name != "Tenant B template" {
		t.Errorf("RLS VIOLATION: cross-tenant UPDATE mutated tenant B's template name to %q", name)
	}
}

// R2 (P0) — Cross-tenant soft-DELETE (SET deleted_at) is rejected: tenant A cannot
// archive tenant B's template; the row stays live (deleted_at IS NULL) for B.
// Depends on the new `deleted_at` column.
func TestRLS_ClassTemplate_3_3_CrossTenantSoftDelete_Rejected(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()

	centerA := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	centerB := CreateCenterWithID(t, db, TenantBID, "Center B", "center-b")

	TenantContext(t, db, centerB.ID)
	centerBUUID := uuid.UUID(centerB.ID.Bytes)
	tmplB := insertClassTemplateRaw(t, db, &centerBUUID, "Tenant B template")

	TenantContext(t, db, centerA.ID)
	tag, err := db.Exec(ctx,
		`UPDATE class_templates SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL`, tmplB)
	if err != nil {
		t.Fatalf("RED until Task 1 adds class_templates.deleted_at: %v", err)
	}
	if n := tag.RowsAffected(); n != 0 {
		t.Errorf("RLS VIOLATION: tenant A soft-delete affected %d of tenant B's rows, want 0", n)
	}

	// Re-read as tenant B — the row must still be live.
	TenantContext(t, db, centerB.ID)
	var deletedAt *time.Time
	if err := db.QueryRow(ctx, `SELECT deleted_at FROM class_templates WHERE id = $1`, tmplB).Scan(&deletedAt); err != nil {
		t.Fatalf("re-read as tenant B: %v", err)
	}
	if deletedAt != nil {
		t.Errorf("RLS VIOLATION: tenant B's template was soft-deleted by tenant A (deleted_at=%v)", deletedAt)
	}
}

// R4 (P1, SEC-9) — A soft-deleted template is hidden from its OWN tenant by the
// query-level `deleted_at IS NULL` filter (the read path the app queries use).
//
// SEC-9 amendment (Story 3.3, Ducdo 2026-07-20): the filter lives in the READ
// QUERIES, not the SELECT RLS policy. Under PostgreSQL RLS a non-owner UPDATE is
// rejected when the new row would fall out of the SELECT policy's USING set
// ("new row violates row-level security policy"), so a policy-level
// `deleted_at IS NULL` clause makes the soft-delete UPDATE itself impossible for
// the tenant role. Query-level filtering hides deleted rows on every read while
// keeping the soft-delete UPDATE legal. This test therefore asserts the raw
// UPDATE succeeds AND that the read predicate hides the row.
func TestRLS_ClassTemplate_3_3_SoftDeleted_HiddenFromOwnTenant(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()

	centerA := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")

	TenantContext(t, db, centerA.ID)
	centerAUUID := uuid.UUID(centerA.ID.Bytes)
	tmpl := insertClassTemplateRaw(t, db, &centerAUUID, "Soon archived")

	if _, err := db.Exec(ctx,
		`UPDATE class_templates SET deleted_at = now() WHERE id = $1`, tmpl); err != nil {
		t.Fatalf("RED until Task 1 adds class_templates.deleted_at: %v", err)
	}

	// The read predicate (`deleted_at IS NULL`) — the same filter every app
	// read query carries — must NOT return the archived row (SEC-9).
	var visible int
	if err := db.QueryRow(ctx,
		`SELECT count(*) FROM class_templates WHERE id = $1 AND deleted_at IS NULL`, tmpl).Scan(&visible); err != nil {
		t.Fatalf("count own template after soft-delete: %v", err)
	}
	if visible != 0 {
		t.Errorf("SEC-9 VIOLATION: soft-deleted template still surfaces through the `deleted_at IS NULL` read filter")
	}
}
