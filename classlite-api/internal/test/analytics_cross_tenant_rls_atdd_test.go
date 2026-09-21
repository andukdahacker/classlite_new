// analytics_cross_tenant_rls_atdd_test.go — Story 8-2a ATDD (green) (AC14 ·
// risk=7 · WF-8 HARD GATE · R1 DATA/SEC score 9). Cross-tenant read isolation on
// GET /api/analytics/classes/{id} — the J15 grid idiom, BOTH directions, on the
// class-perf payload's tenant-scoped read sources.
//
// Deterministic tenant IDs TenantAID / TenantBID. Never DISABLE ROW LEVEL
// SECURITY — SetupDB runs under SET LOCAL ROLE classlite_app so RLS is enforced.
//
// RE-SET-PER-CALL PROOF (Murat): `SET LOCAL app.current_tenant_id` survives
// RELEASE SAVEPOINT, so a second class-perf call in the same SetupDB outer tx would
// inherit the first call's tenant if the handler didn't re-SET. It does, per-request
// (ExtractTenant → the service's SetTenantContext inside its own tx). Issuing the
// A-caller and B-caller requests back-to-back on the SAME outer tx exercises that:
// if isolation held only because the tenant was never switched, the mirror
// direction would catch it.
//
// PER-READ-SOURCE COVERAGE: the sentinel is an at-risk STUDENT NAME, which the
// class-perf payload surfaces in atRiskStudents — a join over students + attendance
// + current_grades (the sources most likely to fan out cross-tenant). A raw-body
// scan of the WHOLE class-perf response catches ANY source that leaks a name-bearing
// row. The exhaustive per-source store-level grid (grades / comments / submissions /
// attendance each seeded a sibling Center-B row) is a GREEN Task-8 store test
// (TEST-BE-1, real DB in tx) — the correct level for sub-query RLS; this HTTP red
// pins the gross-leak + both-directions + re-SET invariant.
//
// RED: real `//go:build atdd_red_phase`. Under `-tags=atdd_red_phase` compile-fails
// ONLY on NewAnalyticsTestServerForRole. All seed helpers + an* are shipped/local.
package test

import (
	"net/http"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

// anSeedClassInCenter seeds, under `centerID`'s RLS context, a teacher + a class +
// a distinctively-named at-risk student (the cross-tenant tripwire). Returns the
// teacher's pgtype.UUID (caller), the class id string, and the sentinel name.
func anSeedClassInCenter(t *testing.T, db *TxDB, centerID pgtype.UUID, emailTag, sentinel string) (pgtype.UUID, string, string) {
	t.Helper()
	_ = TenantContext(t, db, centerID)
	cid := dashPGToUUID(t, centerID)
	teacher := CreateUser(t, db, "t-"+emailTag+"@x.test", "Teacher "+emailTag)
	CreateCenterMember(t, db, teacher.ID, centerID, "teacher")
	class := seedClassWithTeacher(t, db, cid, dashPGToUUID(t, teacher.ID))
	s := dashSeedAtRiskStudent(t, db, cid, class, dashPGToUUID(t, teacher.ID), "ar-"+emailTag+"@x.test", sentinel)
	seedReleasedGrade(t, db, cid, class, s, dashPGToUUID(t, teacher.ID), "writing", 6.0)
	return teacher.ID, class.String(), sentinel
}

func TestAnalyticsClass_CrossTenant_BothDirections_ATDD(t *testing.T) {
	db := SetupDB(t)
	centerA := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	centerB := CreateCenterWithID(t, db, TenantBID, "Center B", "center-b")

	teacherA, classA, sentinelA := anSeedClassInCenter(t, db, centerA.ID, "alpha", "XSENTINEL_CENTER_A")
	teacherB, classB, sentinelB := anSeedClassInCenter(t, db, centerB.ID, "bravo", "XSENTINEL_CENTER_B")

	// ── Direction 1: caller in Center A ──
	srvA := NewAnalyticsTestServerForRole(t, db, teacherA, TenantAID, "teacher")

	// A requesting B's class id → 404 (RLS + scope both hide it, non-disclosure).
	if rec := anGetClass(t, srvA, classB); rec.Code != http.StatusNotFound {
		t.Errorf("AC14: center-A caller requesting center-B class %s must be 404, got %d", classB, rec.Code)
	}
	// A requesting OWN class → 200, own sentinel present, B's sentinel absent.
	recAown := anGetClass(t, srvA, classA)
	if recAown.Code != http.StatusOK {
		t.Fatalf("AC14 positive: center-A caller must get 200 for own class %s, got %d (body=%s)",
			classA, recAown.Code, recAown.Body.String())
	}
	if !strings.Contains(recAown.Body.String(), sentinelA) {
		t.Errorf("AC14 positive: own-center sentinel absent — empty-for-everyone would false-pass isolation")
	}
	if strings.Contains(recAown.Body.String(), sentinelB) {
		t.Errorf("AC14 CROSS-TENANT LEAK: center-B sentinel %q surfaced in center-A's class-perf", sentinelB)
	}

	// ── Direction 2: caller in Center B (SAME outer tx — proves per-request re-SET) ──
	srvB := NewAnalyticsTestServerForRole(t, db, teacherB, TenantBID, "teacher")
	if rec := anGetClass(t, srvB, classA); rec.Code != http.StatusNotFound {
		t.Errorf("AC14 (mirror): center-B caller requesting center-A class %s must be 404, got %d", classA, rec.Code)
	}
	recBown := anGetClass(t, srvB, classB)
	if recBown.Code != http.StatusOK {
		t.Fatalf("AC14 positive (mirror): center-B caller must get 200 for own class %s, got %d", classB, recBown.Code)
	}
	if !strings.Contains(recBown.Body.String(), sentinelB) {
		t.Errorf("AC14 positive (mirror): center-B own sentinel absent")
	}
	if strings.Contains(recBown.Body.String(), sentinelA) {
		t.Errorf("AC14 CROSS-TENANT LEAK (mirror): center-A sentinel %q surfaced in center-B's class-perf "+
			"(the second call inherited center-A's tenant GUC — the handler failed to re-SET per request)", sentinelA)
	}
}

// TestAnalyticsHome_CrossTenant_BothDirections_ATDD closes the AC14 gap the class
// test left open: the HOME endpoint's two read sources (ListAnalyticsHomeClasses +
// ListAnalyticsHomeAtRiskInputs) must also be tenant-isolated both directions. Owners
// drive the center-wide branch (teacher_id narg NULL) — the widest cross-tenant
// surface. Same outer tx across both directions proves per-request re-SET (a leak in
// the mirror would mean the second call inherited the first tenant's GUC).
func TestAnalyticsHome_CrossTenant_BothDirections_ATDD(t *testing.T) {
	db := SetupDB(t)
	centerA := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	centerB := CreateCenterWithID(t, db, TenantBID, "Center B", "center-b")

	_, classA, _ := anSeedClassInCenter(t, db, centerA.ID, "home-alpha", "XSENTINEL_HOME_A")
	_, classB, _ := anSeedClassInCenter(t, db, centerB.ID, "home-bravo", "XSENTINEL_HOME_B")

	_ = TenantContext(t, db, centerA.ID)
	ownerA := CreateUser(t, db, "owner-a@x.test", "Owner A")
	CreateCenterMember(t, db, ownerA.ID, centerA.ID, "owner")
	_ = TenantContext(t, db, centerB.ID)
	ownerB := CreateUser(t, db, "owner-b@x.test", "Owner B")
	CreateCenterMember(t, db, ownerB.ID, centerB.ID, "owner")

	// ── Direction 1: owner in Center A ──
	srvA := NewAnalyticsTestServerForRole(t, db, ownerA.ID, TenantAID, "owner")
	recA, respA := anGetHome(t, srvA)
	if recA.Code != http.StatusOK {
		t.Fatalf("AC14 home: center-A owner want 200, got %d (body=%s)", recA.Code, recA.Body.String())
	}
	if !anClassSummaryHas(respA.Data.Classes, classA) {
		t.Errorf("AC14 home positive: center-A owner must see own class %s (empty-for-everyone would false-pass)", classA)
	}
	if anClassSummaryHas(respA.Data.Classes, classB) {
		t.Errorf("AC14 home CROSS-TENANT LEAK: center-A owner's home listed center-B class %s", classB)
	}
	// Belt-and-suspenders: no center-B class id anywhere in the payload (the per-class
	// atRiskCount comes from ListAnalyticsHomeAtRiskInputs — a leak there would surface
	// a center-B class id).
	if strings.Contains(recA.Body.String(), classB) {
		t.Errorf("AC14 home LEAK: center-B class id %s appeared anywhere in center-A's home payload", classB)
	}

	// ── Direction 2: owner in Center B (SAME outer tx — per-request re-SET) ──
	srvB := NewAnalyticsTestServerForRole(t, db, ownerB.ID, TenantBID, "owner")
	recB, respB := anGetHome(t, srvB)
	if recB.Code != http.StatusOK {
		t.Fatalf("AC14 home (mirror): center-B owner want 200, got %d", recB.Code)
	}
	if !anClassSummaryHas(respB.Data.Classes, classB) {
		t.Errorf("AC14 home positive (mirror): center-B owner must see own class %s", classB)
	}
	if anClassSummaryHas(respB.Data.Classes, classA) {
		t.Errorf("AC14 home CROSS-TENANT LEAK (mirror): center-B owner's home listed center-A class %s "+
			"(the second call may have inherited center-A's tenant GUC — the handler failed to re-SET)", classA)
	}
	if strings.Contains(recB.Body.String(), classA) {
		t.Errorf("AC14 home LEAK (mirror): center-A class id %s appeared in center-B's home payload", classA)
	}
}

var _ = uuid.UUID{} // keep the import stable across green-phase edits
