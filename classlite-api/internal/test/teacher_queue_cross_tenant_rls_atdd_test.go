// teacher_queue_cross_tenant_rls_atdd_test.go — Story 10-1c ATDD red-phase (AC4 ·
// WF-8 HARD GATE). Cross-tenant read isolation on GET /api/inbox/teacher-queue —
// the J15 grid idiom, both directions, over the derived read's tenant-scoped tables
// (submissions ⋈ assignments ⋈ classes ⋈ current_grades).
//
// Deterministic tenant IDs TenantAID / TenantBID (fixtures). Never
// `DISABLE ROW LEVEL SECURITY` — SetupDB runs under SET LOCAL ROLE classlite_app so
// RLS is actually enforced; the `current_grades` view is security_invoker so it does
// NOT bypass tenant isolation.
//
// GRID CAVEAT (Murat): `SET LOCAL app.current_tenant_id` survives RELEASE SAVEPOINT,
// so both callers are issued back-to-back on the SAME outer tx — if isolation held
// only because the tenant was never switched, the mirror direction would catch it
// (the handler re-SETs per request via ExtractTenant → the service's own tenant tx).
//
// RED: compile-fails ONLY on newTeacherQueueSrv (→ handler.TeacherQueue). All seed
// helpers are shipped; tqInsertSubmission/tqHasStudent live in the 10-1c helper file.
package test

import (
	"net/http"
	"testing"
	"time"

	"github.com/ducdo/classlite-api/internal/clock"
)

func TestTeacherQueue_CrossTenantIsolation_BothDirections_ATDD(t *testing.T) {
	db := SetupDB(t)
	clk := clock.NewMockClock(time.Date(2026, 10, 6, 12, 0, 0, 0, time.UTC))
	now := clk.Now()

	centerA := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	centerB := CreateCenterWithID(t, db, TenantBID, "Center B", "center-b")

	// ── seed Center A under A's RLS context ──
	TenantContext(t, db, centerA.ID)
	cidA := qaUUIDFromPg(centerA.ID)
	teacherA := CreateUser(t, db, "ta@center-a.test", "Teacher A")
	CreateCenterMember(t, db, teacherA.ID, centerA.ID, "teacher")
	n101VerifyCenterMembers(t, db, centerA.ID)
	const nameA = "TQ_XT_STUDENT_ALPHA"
	studentA := seedStudentMember(t, db, cidA, "sa@center-a.test", nameA)
	classA := seedClassWithTeacher(t, db, cidA, qaUUIDFromPg(teacherA.ID))
	asgA := seedInputAssignment(t, db, cidA, classA, qaUUIDFromPg(teacherA.ID), now.Add(-24*time.Hour))
	tqInsertSubmission(t, db, cidA, asgA, studentA, "submitted", now.Add(-2*time.Hour), false)

	// ── seed Center B under B's RLS context ──
	TenantContext(t, db, centerB.ID)
	cidB := qaUUIDFromPg(centerB.ID)
	teacherB := CreateUser(t, db, "tb@center-b.test", "Teacher B")
	CreateCenterMember(t, db, teacherB.ID, centerB.ID, "teacher")
	n101VerifyCenterMembers(t, db, centerB.ID)
	const nameB = "TQ_XT_STUDENT_BRAVO"
	studentB := seedStudentMember(t, db, cidB, "sb@center-b.test", nameB)
	classB := seedClassWithTeacher(t, db, cidB, qaUUIDFromPg(teacherB.ID))
	asgB := seedInputAssignment(t, db, cidB, classB, qaUUIDFromPg(teacherB.ID), now.Add(-24*time.Hour))
	tqInsertSubmission(t, db, cidB, asgB, studentB, "submitted", now.Add(-2*time.Hour), false)

	srv := newTeacherQueueSrv(t, db, clk)

	// ── Direction 1: caller in Center A ──
	tokA := SignAccessTokenForRole(t, teacherA.ID, UUIDString(centerA.ID), "teacher")
	codeA, envA := tqGet(t, srv, tokA, "page=1&page_size=50")
	if codeA != http.StatusOK {
		t.Fatalf("center-A caller status = %d, want 200", codeA)
	}
	if !tqHasStudent(envA.Data, nameA) {
		t.Errorf("AC4 positive: center-A teacher must see own Center-A submission (student %q)", nameA)
	}
	if tqHasStudent(envA.Data, nameB) {
		t.Errorf("AC4 CROSS-TENANT LEAK: center-A teacher must NOT see Center-B submission (student %q)", nameB)
	}

	// ── Direction 2: caller in Center B (same outer tx — proves per-request re-SET) ──
	tokB := SignAccessTokenForRole(t, teacherB.ID, UUIDString(centerB.ID), "teacher")
	codeB, envB := tqGet(t, srv, tokB, "page=1&page_size=50")
	if codeB != http.StatusOK {
		t.Fatalf("center-B caller status = %d, want 200", codeB)
	}
	if !tqHasStudent(envB.Data, nameB) {
		t.Errorf("AC4 positive (mirror): center-B teacher must see own Center-B submission (student %q)", nameB)
	}
	if tqHasStudent(envB.Data, nameA) {
		t.Errorf("AC4 CROSS-TENANT LEAK (mirror): center-B teacher must NOT see Center-A submission (student %q)", nameA)
	}
}
