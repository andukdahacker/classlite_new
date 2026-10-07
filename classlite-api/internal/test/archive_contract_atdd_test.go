// archive_contract_atdd_test.go — Story 10-2 ATDD red-phase (AC1 envelope · AC2
// exercise reversed-soft-delete filter · AC3 class ended+30-day cutoff via
// MockClock · AC4 type filter + 422 · huge-page clamp). API-level contract over
// the real request chain for ONE owner (center-wide), so the TYPE/CORRECTNESS
// behavior is isolated from the scope/tenant isolation reds.
//
// RED: compile-fails ONLY on the newArchiveSrv seam (story_10_2_helpers_test.go).
package test

import (
	"net/http"
	"testing"
	"time"

	"github.com/ducdo/classlite-api/internal/clock"
)

func TestArchive_Contract_ReversedFilters_And_Cutoff_ATDD(t *testing.T) {
	db := SetupDB(t)
	clk := clock.NewMockClock(time.Date(2026, 10, 7, 12, 0, 0, 0, time.UTC))
	now := clk.Now()
	longAgo := now.Add(-90 * 24 * time.Hour) // > 30 days → archived
	recent := now.Add(-5 * 24 * time.Hour)   // ended < 30 days ago → NOT yet archived

	center := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	TenantContext(t, db, center.ID)
	cid := qaUUIDFromPg(center.ID)
	owner := CreateUser(t, db, "owner@center-a.test", "Owner")
	CreateCenterMember(t, db, owner.ID, center.ID, "owner")
	n101VerifyCenterMembers(t, db, center.ID)
	oid := qaUUIDFromPg(owner.ID)

	// Exercises: one archived (present), one active (absent).
	archivedEx := arSeedArchivedExercise(t, db, cid, oid, "CON-EX-ARCH", "writing")
	activeEx := arSeedActiveExercise(t, db, cid, oid, "CON-EX-LIVE", "writing")

	// Classes: ended-long-ago (present), ended-recently (absent, inside the 30d
	// grace), ended-but-NULL-ended_at (absent — the read requires a stamped date),
	// and active (absent).
	endedOld := arInsertClass(t, db, cid, oid, "CON_CLASS_OLD", "ended", &longAgo)
	endedRecent := arInsertClass(t, db, cid, oid, "CON_CLASS_RECENT", "ended", &recent)
	endedNull := arInsertClass(t, db, cid, oid, "CON_CLASS_NULL", "ended", nil)
	activeClass := arInsertClass(t, db, cid, oid, "CON_CLASS_ACTIVE", "active", nil)

	srv := newArchiveSrv(t, db, clk)
	tok := SignAccessTokenForRole(t, owner.ID, UUIDString(center.ID), "owner")

	// ── AC1 + AC2 + AC3: the unfiltered archive ──
	code, env := arGet(t, srv, tok, "page=1&page_size=50")
	if code != http.StatusOK {
		t.Fatalf("archive status = %d, want 200", code)
	}

	// AC2: archived exercise present, active absent.
	if it, ok := arFindByID(env.Data, archivedEx.String()); !ok {
		t.Errorf("AC2 positive: soft-deleted exercise must be PRESENT in the archive")
	} else {
		if it.Type != "exercise" {
			t.Errorf("AC1: archived exercise item type = %q, want \"exercise\"", it.Type)
		}
		if it.Link != "/exercises/"+archivedEx.String()+"/edit" {
			t.Errorf("AC1: exercise link = %q, want /exercises/{id}/edit", it.Link)
		}
		if it.ArchivedAt == nil {
			t.Errorf("AC1: exercise item must carry archivedAt (= deleted_at), got nil")
		}
	}
	if _, ok := arFindByID(env.Data, activeEx.String()); ok {
		t.Errorf("AC2 negative: an ACTIVE (deleted_at IS NULL) exercise must be ABSENT from the archive")
	}

	// AC3: ended-long-ago present; ended-recent / ended-null / active absent.
	if cl, ok := arFindByID(env.Data, endedOld.String()); !ok {
		t.Errorf("AC3 positive: a class ended > 30 days ago must be PRESENT")
	} else if cl.Type != "class" {
		t.Errorf("AC1: archived class item type = %q, want \"class\"", cl.Type)
	}
	if _, ok := arFindByID(env.Data, endedRecent.String()); ok {
		t.Errorf("AC3 negative: a class ended < 30 days ago must be ABSENT (still inside the grace window)")
	}
	if _, ok := arFindByID(env.Data, endedNull.String()); ok {
		t.Errorf("AC3 negative: an ended class with NULL ended_at must be ABSENT (read requires a stamped date)")
	}
	if _, ok := arFindByID(env.Data, activeClass.String()); ok {
		t.Errorf("AC3 negative: a non-ended (active) class must be ABSENT")
	}

	// AC1: pagination meta coherent (2 archived items total: 1 exercise + 1 class).
	if env.Meta.Pagination.Total != 2 {
		t.Errorf("AC1: unfiltered archive total = %d, want 2 (1 archived exercise + 1 ended-long-ago class)", env.Meta.Pagination.Total)
	}
	if env.Meta.Pagination.Page != 1 || env.Meta.Pagination.PageSize != 50 {
		t.Errorf("AC1: pagination echo page=%d pageSize=%d, want 1/50", env.Meta.Pagination.Page, env.Meta.Pagination.PageSize)
	}

	// ── AC4: type filter ──
	_, exOnly := arGet(t, srv, tok, "type=exercise&page=1&page_size=50")
	if exOnly.Meta.Pagination.Total != 1 || !arHasID(exOnly.Data, archivedEx.String()) {
		t.Errorf("AC4: ?type=exercise must return ONLY the archived exercise (total=%d)", exOnly.Meta.Pagination.Total)
	}
	for _, it := range exOnly.Data {
		if it.Type != "exercise" {
			t.Errorf("AC4: ?type=exercise leaked a %q item", it.Type)
		}
	}
	_, clOnly := arGet(t, srv, tok, "type=class&page=1&page_size=50")
	if clOnly.Meta.Pagination.Total != 1 || !arHasID(clOnly.Data, endedOld.String()) {
		t.Errorf("AC4: ?type=class must return ONLY the ended-long-ago class (total=%d)", clOnly.Meta.Pagination.Total)
	}

	// AC4: invalid type → 422 (not a silent empty). "session" is NOT a valid v1
	// archive type (Ducdo D1 deferred sessions).
	if bad, _ := arGet(t, srv, tok, "type=session"); bad != http.StatusUnprocessableEntity {
		t.Errorf("AC4: ?type=session must be 422 (sessions deferred), got %d", bad)
	}
	if bad, _ := arGet(t, srv, tok, "type=bogus"); bad != http.StatusUnprocessableEntity {
		t.Errorf("AC4: an unknown ?type must be 422, got %d", bad)
	}

	// ── Huge page / page_size must clamp, never 500 (the math.MaxInt32 guard,
	//    the ListInbox / 5-2a class) ──
	if huge, _ := arGet(t, srv, tok, "page=99999999999999&page_size=99999999"); huge == http.StatusInternalServerError {
		t.Errorf("AC1: a crafted huge page/page_size must be clamped, not 500")
	}
}
