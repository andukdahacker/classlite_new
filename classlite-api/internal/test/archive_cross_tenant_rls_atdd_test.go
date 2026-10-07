// archive_cross_tenant_rls_atdd_test.go — Story 10-2 ATDD red-phase (AC6 · WF-8
// HARD GATE · SEC-9). Cross-TENANT isolation on GET /api/archive, through the real
// request chain, BOTH directions. The reversed filters (deleted_at IS NOT NULL /
// status='ended') must NOT widen past the tenant boundary — the classic SEC-9
// soft-delete+RLS trap where a reversed predicate leaks another tenant's hidden
// rows.
//
// Two tenants, each with their own archived exercise + ended class. A caller in
// tenant A must see ONLY tenant A's archived items; tenant B's are absent — and
// the mirror. Per-request middleware re-SETs app.current_tenant_id, so both halves
// run against the same server within one outer test tx (SET LOCAL reverts at the
// savepoint boundary, it does not leak — the 10-1a R3 lesson).
//
// RED: compile-fails ONLY on the newArchiveSrv seam (story_10_2_helpers_test.go).
package test

import (
	"context"
	"net/http"
	"testing"
	"time"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/store/generated"
	"github.com/jackc/pgx/v5/pgtype"
)

func TestArchive_CrossTenantRLS_ATDD(t *testing.T) {
	db := SetupDB(t)
	clk := clock.NewMockClock(time.Date(2026, 10, 7, 12, 0, 0, 0, time.UTC))
	longAgo := clk.Now().Add(-90 * 24 * time.Hour)

	centerA := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	centerB := CreateCenterWithID(t, db, TenantBID, "Center B", "center-b")

	// ── Seed tenant A (owner sees center-wide; use owner callers to isolate the
	//    TENANT boundary from the teacher-scope boundary tested in the scope red) ──
	TenantContext(t, db, centerA.ID)
	cidA := qaUUIDFromPg(centerA.ID)
	ownerA := CreateUser(t, db, "owner@center-a.test", "Owner A")
	CreateCenterMember(t, db, ownerA.ID, centerA.ID, "owner")
	n101VerifyCenterMembers(t, db, centerA.ID)
	oaID := qaUUIDFromPg(ownerA.ID)
	const exTitleA = "Exercise TEN-EX-A"
	const clTitleA = "TEN_CLASS_A"
	arSeedArchivedExercise(t, db, cidA, oaID, "TEN-EX-A", "reading")
	arInsertClass(t, db, cidA, oaID, clTitleA, "ended", &longAgo)

	// ── Seed tenant B ──
	TenantContext(t, db, centerB.ID)
	cidB := qaUUIDFromPg(centerB.ID)
	ownerB := CreateUser(t, db, "owner@center-b.test", "Owner B")
	CreateCenterMember(t, db, ownerB.ID, centerB.ID, "owner")
	n101VerifyCenterMembers(t, db, centerB.ID)
	obID := qaUUIDFromPg(ownerB.ID)
	const exTitleB = "Exercise TEN-EX-B"
	const clTitleB = "TEN_CLASS_B"
	arSeedArchivedExercise(t, db, cidB, obID, "TEN-EX-B", "reading")
	arInsertClass(t, db, cidB, obID, clTitleB, "ended", &longAgo)

	srv := newArchiveSrv(t, db, clk)

	// ── Tenant A owner: sees A's archived items, NONE of B's ──
	tokA := SignAccessTokenForRole(t, ownerA.ID, UUIDString(centerA.ID), "owner")
	codeA, envA := arGet(t, srv, tokA, "page=1&page_size=50")
	if codeA != http.StatusOK {
		t.Fatalf("tenant A archive status = %d, want 200", codeA)
	}
	if !arHasTitle(envA.Data, exTitleA) || !arHasTitle(envA.Data, clTitleA) {
		t.Errorf("AC6 positive: tenant A must see its OWN archived items (%q / %q)", exTitleA, clTitleA)
	}
	if arHasTitle(envA.Data, exTitleB) || arHasTitle(envA.Data, clTitleB) {
		t.Errorf("AC6 SEC-9 CROSS-TENANT LEAK: tenant A saw tenant B's archived items (reversed filter widened past RLS)")
	}

	// ── Tenant B owner: mirror ──
	tokB := SignAccessTokenForRole(t, ownerB.ID, UUIDString(centerB.ID), "owner")
	codeB, envB := arGet(t, srv, tokB, "page=1&page_size=50")
	if codeB != http.StatusOK {
		t.Fatalf("tenant B archive status = %d, want 200", codeB)
	}
	if !arHasTitle(envB.Data, exTitleB) || !arHasTitle(envB.Data, clTitleB) {
		t.Errorf("AC6 positive (mirror): tenant B must see its OWN archived items (%q / %q)", exTitleB, clTitleB)
	}
	if arHasTitle(envB.Data, exTitleA) || arHasTitle(envB.Data, clTitleA) {
		t.Errorf("AC6 SEC-9 CROSS-TENANT LEAK (mirror): tenant B saw tenant A's archived items")
	}
}

// TestArchive_CrossTenantRLS_StoreLevel_ATDD is the AC6 parenthetical the spec
// named explicitly: a STORE-LEVEL adversarial read (TEST-BE-2 — real DB in the
// test tx, generated queries directly, no HTTP chain) that sets a tenant-A
// context and runs ListArchive/CountArchive against crafted tenant-B ids. This
// is the tightest proof the reversed-filter reads ride RLS: it bypasses the
// handler/service entirely, so a leak can only come from the SQL + the SET LOCAL
// tenant scope. (The chain test above proves the same boundary end-to-end; this
// isolates it to the store seam, where TEST-BE-1 says RLS belongs.)
func TestArchive_CrossTenantRLS_StoreLevel_ATDD(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()
	queries := generated.New(db)
	// Cutoff well after the seeded ended classes (ended 90d before this instant),
	// so a leak — not the cutoff — is the only reason a tenant-B class is absent.
	cutoff := pgtype.Timestamptz{
		Time:  time.Date(2026, 10, 7, 12, 0, 0, 0, time.UTC).Add(-30 * 24 * time.Hour),
		Valid: true,
	}
	longAgo := time.Date(2026, 10, 7, 12, 0, 0, 0, time.UTC).Add(-90 * 24 * time.Hour)

	centerA := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	centerB := CreateCenterWithID(t, db, TenantBID, "Center B", "center-b")

	// Seed tenant B's archived exercise + ended class; capture their crafted ids.
	TenantContext(t, db, centerB.ID)
	cidB := qaUUIDFromPg(centerB.ID)
	ownerB := CreateUser(t, db, "store-owner@center-b.test", "Owner B")
	CreateCenterMember(t, db, ownerB.ID, centerB.ID, "owner")
	n101VerifyCenterMembers(t, db, centerB.ID)
	obID := qaUUIDFromPg(ownerB.ID)
	exB := arSeedArchivedExercise(t, db, cidB, obID, "STORE-TEN-EX-B", "reading")
	clB := arInsertClass(t, db, cidB, obID, "STORE_TEN_CLASS_B", "ended", &longAgo)

	// Switch to tenant A's context (owner scope → TeacherID NULL/center-wide).
	TenantContext(t, db, centerA.ID)
	params := generated.ListArchiveParams{
		TeacherID:  pgtype.UUID{}, // Valid=false ⇒ @teacher_id IS NULL ⇒ center-wide
		TypeFilter: "",
		Cutoff:     cutoff,
		PageLimit:  100,
		PageOffset: 0,
	}
	rows, err := queries.ListArchive(ctx, params)
	if err != nil {
		t.Fatalf("ListArchive as tenant A: %v", err)
	}
	for _, r := range rows {
		got := qaUUIDFromPg(r.ID)
		if got == exB || got == clB {
			t.Errorf("AC6 STORE-LEVEL SEC-9 LEAK: tenant A's ListArchive returned a tenant-B id %s (title %q)", got, r.Title)
		}
	}

	total, err := queries.CountArchive(ctx, generated.CountArchiveParams{
		TeacherID:  pgtype.UUID{},
		TypeFilter: "",
		Cutoff:     cutoff,
	})
	if err != nil {
		t.Fatalf("CountArchive as tenant A: %v", err)
	}
	if total != 0 {
		t.Errorf("AC6 STORE-LEVEL SEC-9 LEAK: tenant A's CountArchive = %d, want 0 (tenant B's archived rows must be invisible)", total)
	}
}
