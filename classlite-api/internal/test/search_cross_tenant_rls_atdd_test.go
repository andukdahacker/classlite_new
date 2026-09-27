// search_cross_tenant_rls_atdd_test.go — Story 8-4a (AC9/AC10 · D5/D10 · NFR-4/R26 ·
// R-1/R-7 · risk=8 · WF-8 HARD GATE). The 5-category J15 cross-tenant grid + the
// soft-delete guard.
//
// GREEN-PHASE (authored red-first per [[reference_atdd_red_convention]]; committed
// un-tagged like the 8-2a analytics_cross_tenant grid it models). Deterministic
// TenantAID/TenantBID; SetupDB runs under SET LOCAL ROLE classlite_app so RLS is
// enforced (never DISABLE ROW LEVEL SECURITY). Both directions run on the SAME outer
// tx — the re-SET-per-request proof (a leak in the mirror means the second request
// inherited the first tenant's GUC).
package test

import (
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

const searchSentinelToken = "Zsentinel"

// searchSeedSentinelCenter seeds a sentinel in ALL FIVE categories of `centerPg`,
// labeled "Zsentinel <side> <Type>". Returns the center's owner id + a class id.
func searchSeedSentinelCenter(t *testing.T, db *TxDB, centerPg pgtype.UUID, side string) (pgtype.UUID, uuid.UUID) {
	t.Helper()
	_ = TenantContext(t, db, centerPg)
	cid := dashPGToUUID(t, centerPg)

	teacher := CreateUser(t, db, "t-"+side+"@j15.test", "Teacher "+side)
	CreateCenterMember(t, db, teacher.ID, centerPg, "teacher")
	owner := CreateUser(t, db, "o-"+side+"@j15.test", "Owner "+side)
	CreateCenterMember(t, db, owner.ID, centerPg, "owner")
	tID := dashPGToUUID(t, teacher.ID)

	label := searchSentinelToken + " " + side + " "
	class := searchSeedClass(t, db, cid, tID, label+"Class")
	ex := searchSeedExercise(t, db, cid, tID, label+"Ex")
	searchSeedAssignment(t, db, cid, class, ex, tID)
	searchSeedFile(t, db, cid, tID, label+"File")
	st := searchSeedStudentNamed(t, db, cid, "s-"+side+"@j15.test", label+"Student")
	insertEnrollmentRaw(t, db, cid, st, class, "active")
	return owner.ID, class
}

// AC9 — the 5-category J15 grid, BOTH directions on the same outer tx. Owner is the
// widest caller (all 5 center-wide). The `users` global/no-RLS table is the sharpest
// cell: a students query not gated through center_members leaks names cross-tenant —
// the raw-body scan catches a leak in ANY category (Murat B5).
func TestSearch_CrossTenant_FiveCategory_J15_BothDirections_ATDD(t *testing.T) {
	db := SetupDB(t)
	centerA := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	centerB := CreateCenterWithID(t, db, TenantBID, "Center B", "center-b")

	ownerA, classA := searchSeedSentinelCenter(t, db, centerA.ID, "A")
	ownerB, classB := searchSeedSentinelCenter(t, db, centerB.ID, "B")

	aLabel := searchSentinelToken + " A "
	bLabel := searchSentinelToken + " B "

	// ── Direction 1: owner in Center A queries the shared token ──
	srvA := NewSearchTestServerForRole(t, db, ownerA, TenantAID, "owner")
	recA, envA := searchDo(t, srvA, searchSentinelToken)
	if recA.Code != 200 {
		t.Fatalf("owner A search want 200, got %d (body=%s)", recA.Code, recA.Body.String())
	}
	// Positive controls: A's own sentinel present in each category (guards against an
	// empty-for-everyone false pass).
	if !searchCategoryHasTitle(envA.Data.Classes, aLabel+"Class") {
		t.Errorf("AC9 positive: owner A must see own %sClass", aLabel)
	}
	if !searchCategoryHasTitle(envA.Data.Students, aLabel+"Student") {
		t.Errorf("AC9 positive: owner A must see own %sStudent (users gated via center_members)", aLabel)
	}
	if !searchCategoryHasTitle(envA.Data.Exercises, aLabel+"Ex") {
		t.Errorf("AC9 positive: owner A must see own %sEx", aLabel)
	}
	if !searchCategoryHasTitle(envA.Data.Files, aLabel+"File") {
		t.Errorf("AC9 positive: owner A must see own %sFile", aLabel)
	}
	if !searchAssignmentHasClass(envA.Data.Assignments, classA) {
		t.Errorf("AC9 positive: owner A must see own assignment (classId=%s)", classA)
	}
	// Isolation: NONE of Center B's five sentinels anywhere in A's raw payload.
	if strings.Contains(recA.Body.String(), bLabel) {
		t.Errorf("AC9 CROSS-TENANT LEAK: Center-B sentinel %q surfaced in owner-A's payload:\n%s", bLabel, recA.Body.String())
	}

	// ── Direction 2: owner in Center B (SAME outer tx — per-request re-SET proof) ──
	srvB := NewSearchTestServerForRole(t, db, ownerB, TenantBID, "owner")
	recB, envB := searchDo(t, srvB, searchSentinelToken)
	if recB.Code != 200 {
		t.Fatalf("owner B search want 200, got %d", recB.Code)
	}
	if !searchCategoryHasTitle(envB.Data.Classes, bLabel+"Class") {
		t.Errorf("AC9 positive (mirror): owner B must see own %sClass", bLabel)
	}
	if !searchAssignmentHasClass(envB.Data.Assignments, classB) {
		t.Errorf("AC9 positive (mirror): owner B must see own assignment (classId=%s)", classB)
	}
	if strings.Contains(recB.Body.String(), aLabel) {
		t.Errorf("AC9 CROSS-TENANT LEAK (mirror): Center-A sentinel %q surfaced in owner-B's payload "+
			"(the second request may have inherited Center-A's tenant GUC — the service failed to re-SET)", aLabel)
	}
}

// AC10 — soft-deleted exercises AND files NEVER surface even when their label matches
// q; an assignment whose JOINed exercise is soft-deleted also never surfaces (D10/R-7).
// Each is paired with a LIVE matching control present, asserted on the owner (center-
// wide) path (Murat C4).
func TestSearch_SoftDelete_Hidden_WithLiveControls_ATDD(t *testing.T) {
	db := SetupDB(t)
	center := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	_ = TenantContext(t, db, center.ID)
	cid := dashPGToUUID(t, center.ID)

	teacher := CreateUser(t, db, "t@soft.test", "Teacher Soft")
	CreateCenterMember(t, db, teacher.ID, center.ID, "teacher")
	owner := CreateUser(t, db, "o@soft.test", "Owner Soft")
	CreateCenterMember(t, db, owner.ID, center.ID, "owner")
	tID := dashPGToUUID(t, teacher.ID)
	class := searchSeedClass(t, db, cid, tID, "Zsoft Class")

	const tok = "Zsoft"
	// Exercises: one live (control), one soft-deleted (must be hidden).
	searchSeedExercise(t, db, cid, tID, tok+" Live Ex")
	searchSeedExerciseMaybeDeleted(t, db, cid, tID, tok+" Dead Ex", true)
	// Files: one live (control), one soft-deleted (must be hidden).
	searchSeedFile(t, db, cid, tID, tok+" Live File")
	searchSeedFileMaybeDeleted(t, db, cid, tID, tok+" Dead File", true)
	// Assignments: one bound to a LIVE exercise (control), one bound to a soft-deleted
	// exercise (must be hidden — the tombstoned title must not surface via the join).
	liveAsgEx := searchSeedExercise(t, db, cid, tID, tok+" Live Asg")
	searchSeedAssignment(t, db, cid, class, liveAsgEx, tID)
	deadAsgEx := searchSeedExerciseMaybeDeleted(t, db, cid, tID, tok+" Dead Asg", true)
	searchSeedAssignment(t, db, cid, class, deadAsgEx, tID)

	srv := NewSearchTestServerForRole(t, db, owner.ID, UUIDString(center.ID), "owner")
	rec, env := searchDo(t, srv, tok)
	if rec.Code != 200 {
		t.Fatalf("owner soft-delete search want 200, got %d (body=%s)", rec.Code, rec.Body.String())
	}

	// Exercises — live present, dead absent.
	if !searchCategoryHasTitle(env.Data.Exercises, tok+" Live Ex") {
		t.Errorf("AC10 control: live exercise %q Live Ex must be present", tok)
	}
	if searchCategoryHasTitle(env.Data.Exercises, tok+" Dead Ex") {
		t.Errorf("AC10 SOFT-DELETE LEAK: soft-deleted exercise %q Dead Ex surfaced", tok)
	}
	// Files — live present, dead absent.
	if !searchCategoryHasTitle(env.Data.Files, tok+" Live File") {
		t.Errorf("AC10 control: live file %q Live File must be present", tok)
	}
	if searchCategoryHasTitle(env.Data.Files, tok+" Dead File") {
		t.Errorf("AC10 SOFT-DELETE LEAK: soft-deleted file %q Dead File surfaced", tok)
	}
	// Assignments — live-exercise assignment present, soft-deleted-exercise absent.
	if !searchCategoryHasTitle(env.Data.Assignments, tok+" Live Asg") {
		t.Errorf("AC10 control: assignment on a live exercise (%q Live Asg) must be present", tok)
	}
	if searchCategoryHasTitle(env.Data.Assignments, tok+" Dead Asg") {
		t.Errorf("AC10 SOFT-DELETE LEAK (D10): assignment whose exercise is soft-deleted (%q Dead Asg) surfaced via the join", tok)
	}
}
