// dashboard_cross_tenant_rls_atdd_test.go — Story 8-1a ATDD red-phase (AC17 ·
// risk=7 · WF-8 HARD GATE). Cross-tenant read isolation on GET /api/dashboard —
// the J15 grid idiom, both directions, on the payload's tenant-scoped tables.
//
// Deterministic tenant IDs TenantAID / TenantBID (fixtures.go). Never
// `DISABLE ROW LEVEL SECURITY` — SetupDB runs under SET LOCAL ROLE classlite_app
// so RLS is actually enforced.
//
// GRID-HELPER CAVEAT (Murat, party-mode): `SET LOCAL app.current_tenant_id`
// SURVIVES `RELEASE SAVEPOINT`, so a second dashboard call in the same SetupDB
// outer tx would inherit the first call's tenant if the handler didn't re-SET.
// It does, per-request (ExtractTenant → the service's SetTenantContext inside its
// own tx). This test exercises that by issuing the A-caller and B-caller requests
// back-to-back on the SAME outer tx: if isolation held only because the tenant
// was never switched, the mirror direction would catch it.
//
// RED: real `//go:build atdd_red_phase`; excluded from `go test ./...`. Under
// `-tags=atdd_red_phase` compile-fails ONLY on NewDashboardTestServerForRole
// (dashboard_role_branch_atdd_test.go). All seed helpers are shipped;
// dashSeedAtRiskStudent / dashAtRiskHas / dashPGToUUID live in
// dashboard_scope_atdd_test.go (same package).
package test

import (
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
)

func TestDashboard_CrossTenantIsolation_BothDirections_ATDD(t *testing.T) {
	db := SetupDB(t)

	centerA := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	centerB := CreateCenterWithID(t, db, TenantBID, "Center B", "center-b")

	// ── seed Center A (under A's RLS context) ──
	_ = TenantContext(t, db, centerA.ID)
	cidA := dashPGToUUID(t, centerA.ID)
	teacherA := CreateUser(t, db, "ta@center-a.test", "Teacher A")
	CreateCenterMember(t, db, teacherA.ID, centerA.ID, "teacher")
	classA := seedClassWithTeacher(t, db, cidA, dashPGToUUID(t, teacherA.ID))
	studentA := dashSeedAtRiskStudent(t, db, cidA, classA, dashPGToUUID(t, teacherA.ID),
		"ar@center-a.test", "AR_ALPHA_CENTER_A")

	// ── seed Center B (under B's RLS context) ──
	_ = TenantContext(t, db, centerB.ID)
	cidB := dashPGToUUID(t, centerB.ID)
	teacherB := CreateUser(t, db, "tb@center-b.test", "Teacher B")
	CreateCenterMember(t, db, teacherB.ID, centerB.ID, "teacher")
	classB := seedClassWithTeacher(t, db, cidB, dashPGToUUID(t, teacherB.ID))
	studentB := dashSeedAtRiskStudent(t, db, cidB, classB, dashPGToUUID(t, teacherB.ID),
		"ar@center-b.test", "AR_BRAVO_CENTER_B")

	// ── Direction 1: caller in Center A ──
	srvA := NewDashboardTestServerForRole(t, db, teacherA.ID, TenantAID, "teacher")
	recA, respA := dashGet(t, srvA)
	if recA.Code != 200 || respA.Data.Teacher == nil {
		t.Fatalf("center-A caller: want 200 + teacher block, got %d (body=%s)", recA.Code, recA.Body.String())
	}
	if !dashAtRiskHas(respA.Data.Teacher.AtRiskStudents.Items, studentA) {
		t.Errorf("AC17 positive: center-A caller must see own Center-A at-risk student %s", studentA)
	}
	if dashAtRiskHas(respA.Data.Teacher.AtRiskStudents.Items, studentB) {
		t.Errorf("AC17 CROSS-TENANT LEAK: center-A caller must NOT see Center-B student %s", studentB)
	}

	// ── Direction 2: caller in Center B (same outer tx — proves per-request re-SET) ──
	srvB := NewDashboardTestServerForRole(t, db, teacherB.ID, TenantBID, "teacher")
	recB, respB := dashGet(t, srvB)
	if recB.Code != 200 || respB.Data.Teacher == nil {
		t.Fatalf("center-B caller: want 200 + teacher block, got %d (body=%s)", recB.Code, recB.Body.String())
	}
	if !dashAtRiskHas(respB.Data.Teacher.AtRiskStudents.Items, studentB) {
		t.Errorf("AC17 positive (mirror): center-B caller must see own Center-B at-risk student %s", studentB)
	}
	if dashAtRiskHas(respB.Data.Teacher.AtRiskStudents.Items, studentA) {
		t.Errorf("AC17 CROSS-TENANT LEAK (mirror): center-B caller must NOT see Center-A student %s", studentA)
	}
}

// dashCrossTenantSeed is the per-center fixture for the owner+student cross-tenant
// scan: distinctive sentinel names on the payload's name/text-bearing tables so any
// cross-center leak into ANY rail of ANY caller trips the raw-body scan below.
type dashCrossTenantSeed struct {
	callerOwner   pgtype.UUID
	callerStudent pgtype.UUID
	tenantID      string
	teacherName   string // → owner todaySessions[].teacherName (sessions/classes/users)
	unassignedNm  string // → owner needsAttention.unassignedStudents (center_members/enrollments)
	atRiskName    string // → owner+teacher atRiskStudents (students/attendance)
	sentinels     []string
}

// seedDashCrossTenant seeds one center's owner+student payload surface under its own
// RLS context and returns the callers + the sentinel set to assert-absent elsewhere.
func seedDashCrossTenant(t *testing.T, db *TxDB, centerID pgtype.UUID, tenantID, tag string) dashCrossTenantSeed {
	t.Helper()
	_ = TenantContext(t, db, centerID)
	cid := dashPGToUUID(t, centerID)

	teacherName := "XTEACHER_" + tag
	unassignedNm := "XUNASSIGNED_" + tag
	atRiskName := "XATRISK_" + tag

	teacher := CreateUser(t, db, "t-"+strings.ToLower(tag)+"@x.test", teacherName)
	CreateCenterMember(t, db, teacher.ID, centerID, "teacher")
	class := seedClassWithTeacher(t, db, cid, dashPGToUUID(t, teacher.ID))
	// A session TODAY so the owner todaySessions rail (with teacherName) populates.
	insertSessionRaw(t, db, cid, class, time.Now(), nil)

	// An unassigned student (member, zero active enrollments) → owner unassignedStudents.
	seedStudentMember(t, db, cid, "unassigned-"+strings.ToLower(tag)+"@x.test", unassignedNm)
	// An at-risk student → owner + teacher atRiskStudents.
	dashSeedAtRiskStudent(t, db, cid, class, dashPGToUUID(t, teacher.ID), "ar-"+strings.ToLower(tag)+"@x.test", atRiskName)

	// The owner caller.
	owner := CreateUser(t, db, "owner-"+strings.ToLower(tag)+"@x.test", "Owner "+tag)
	CreateCenterMember(t, db, owner.ID, centerID, "owner")

	// A student caller with own feedback + open question (own block non-empty).
	student := CreateUser(t, db, "student-"+strings.ToLower(tag)+"@x.test", "Student "+tag)
	CreateCenterMember(t, db, student.ID, centerID, "student")
	sid := dashPGToUUID(t, student.ID)
	insertEnrollmentRaw(t, db, cid, sid, class, "active")
	seedReleasedGrade(t, db, cid, class, sid, dashPGToUUID(t, teacher.ID), "writing", 6.5)
	dashSeedOpenQuestion(t, db, cid, class, sid, dashPGToUUID(t, teacher.ID))

	return dashCrossTenantSeed{
		callerOwner:   owner.ID,
		callerStudent: student.ID,
		tenantID:      tenantID,
		teacherName:   teacherName,
		unassignedNm:  unassignedNm,
		atRiskName:    atRiskName,
		sentinels:     []string{teacherName, unassignedNm, atRiskName},
	}
}

// TestDashboard_CrossTenant_OwnerAndStudentPayloads_BothDirections_ATDD extends AC17
// beyond the teacher at-risk rail to the OWNER payload tables (sessions/classes/users
// via todaySessions, center_members/enrollments via unassignedStudents, attendance via
// atRiskStudents) and the STUDENT payload — both directions. Any cross-center row that
// leaked into any rail of any caller would surface as an other-center sentinel name in
// the raw response body.
func TestDashboard_CrossTenant_OwnerAndStudentPayloads_BothDirections_ATDD(t *testing.T) {
	db := SetupDB(t)
	centerA := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	centerB := CreateCenterWithID(t, db, TenantBID, "Center B", "center-b")

	seedA := seedDashCrossTenant(t, db, centerA.ID, TenantAID, "ALPHA")
	seedB := seedDashCrossTenant(t, db, centerB.ID, TenantBID, "BRAVO")

	// bodyFor drives one caller and returns (statusOK, rawBody).
	bodyFor := func(caller pgtype.UUID, tenantID, role string) (bool, string) {
		srv := NewDashboardTestServerForRole(t, db, caller, tenantID, role)
		rec, _ := dashGet(t, srv)
		return rec.Code == 200, rec.Body.String()
	}

	// assertScoped: caller's body MUST contain at least one own sentinel (owner) and
	// MUST NOT contain any of the other center's sentinels.
	assertScoped := func(label string, body string, own, other dashCrossTenantSeed, expectOwn bool) {
		if expectOwn {
			found := false
			for _, s := range own.sentinels {
				if strings.Contains(body, s) {
					found = true
					break
				}
			}
			if !found {
				t.Errorf("AC17 positive (%s): own-center sentinel absent — payload empty-for-everyone would false-pass isolation (body=%s)", label, body)
			}
		}
		for _, s := range other.sentinels {
			if strings.Contains(body, s) {
				t.Errorf("AC17 CROSS-TENANT LEAK (%s): other-center sentinel %q leaked into the payload", label, s)
			}
		}
	}

	// ── Owner callers, both directions ──
	if ok, body := bodyFor(seedA.callerOwner, TenantAID, "owner"); ok {
		assertScoped("owner A", body, seedA, seedB, true)
	} else {
		t.Fatalf("owner A: want 200")
	}
	if ok, body := bodyFor(seedB.callerOwner, TenantBID, "owner"); ok {
		assertScoped("owner B", body, seedB, seedA, true)
	} else {
		t.Fatalf("owner B: want 200")
	}

	// ── Student callers, both directions (tripwire: no other-center sentinel anywhere) ──
	if ok, body := bodyFor(seedA.callerStudent, TenantAID, "student"); ok {
		assertScoped("student A", body, seedA, seedB, false)
	} else {
		t.Fatalf("student A: want 200")
	}
	if ok, body := bodyFor(seedB.callerStudent, TenantBID, "student"); ok {
		assertScoped("student B", body, seedB, seedA, false)
	} else {
		t.Fatalf("student B: want 200")
	}
}
