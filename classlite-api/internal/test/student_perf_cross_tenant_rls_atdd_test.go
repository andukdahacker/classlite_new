// student_perf_cross_tenant_rls_atdd_test.go — Story 8-3a ATDD (green)
// (AC22c/AC22d · risk=8 · R-1/R26 · WF-8 HARD GATE). Cross-tenant read isolation on
// the student-analytics endpoints — the J15 both-directions grid applied to
// GET /api/analytics/students/{id} + the `/me` self-only guarantee.
//
// Deterministic tenant IDs TenantAID / TenantBID; SetupDB runs under SET LOCAL ROLE
// classlite_app so RLS is enforced (never DISABLE ROW LEVEL SECURITY).
//
// RE-SET-PER-CALL PROOF (Murat): `SET LOCAL app.current_tenant_id` survives RELEASE
// SAVEPOINT, so a second call in the same SetupDB outer tx inherits the first
// caller's tenant unless the service re-SETs per request (ExtractTenant →
// SetTenantContext in its own tx). Issuing the A-caller then the B-caller
// back-to-back on the SAME outer tx exercises that: a leak in the mirror direction
// means the re-SET failed.
//
// SENTINEL = the student's NAME, surfaced in StudentPerformance.studentName. A
// whole-body scan catches ANY read source that leaks a cross-tenant name-bearing row.
//
// RED: real `//go:build atdd_red_phase`. Under `-tags=atdd_red_phase` compile-fails
// ONLY on NewStudentPerfTestServerForRole (student_perf_role_scope_atdd_test.go).
package test

import (
	"net/http"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

// spSeedCenterWithStudent seeds, under `centerID`'s RLS context, an owner (caller) +
// a teacher + a class + a distinctively-named student with a released grade. Returns
// the owner's pgtype.UUID (caller), the student id string, and the sentinel name.
func spSeedCenterWithStudent(t *testing.T, db *TxDB, centerID pgtype.UUID, tag, sentinel string) (pgtype.UUID, string, string) {
	t.Helper()
	_ = TenantContext(t, db, centerID)
	cid := dashPGToUUID(t, centerID)
	owner := CreateUser(t, db, "owner-"+tag+"@x.test", "Owner "+tag)
	CreateCenterMember(t, db, owner.ID, centerID, "owner")
	teacher := CreateUser(t, db, "t-"+tag+"@x.test", "Teacher "+tag)
	CreateCenterMember(t, db, teacher.ID, centerID, "teacher")
	class := seedClassWithTeacher(t, db, cid, dashPGToUUID(t, teacher.ID))
	student := dashSeedAtRiskStudent(t, db, cid, class, dashPGToUUID(t, teacher.ID), "s-"+tag+"@x.test", sentinel)
	seedReleasedGrade(t, db, cid, class, student, dashPGToUUID(t, teacher.ID), "writing", 6.0)
	return owner.ID, student.String(), sentinel
}

// ── AC22c — cross-tenant both-directions on /students/{id}, same-outer-tx re-SET ──

func TestStudentPerf_CrossTenant_BothDirections_ATDD(t *testing.T) {
	db := SetupDB(t)
	centerA := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	centerB := CreateCenterWithID(t, db, TenantBID, "Center B", "center-b")

	ownerA, studentA, sentinelA := spSeedCenterWithStudent(t, db, centerA.ID, "alpha", "XSENTINEL_STUDENT_A")
	ownerB, studentB, sentinelB := spSeedCenterWithStudent(t, db, centerB.ID, "bravo", "XSENTINEL_STUDENT_B")

	// ── Direction 1: caller in Center A ──
	srvA := NewStudentPerfTestServerForRole(t, db, ownerA, TenantAID, "owner")
	if rec, _ := spGetStudent(t, srvA, studentB); rec.Code != http.StatusNotFound {
		t.Errorf("AC22c: center-A owner → center-B student %s must be 404, got %d", studentB, rec.Code)
	}
	recAown, _ := spGetStudent(t, srvA, studentA)
	if recAown.Code != http.StatusOK {
		t.Fatalf("AC22c positive: center-A owner must get 200 for own-center student %s, got %d (body=%s)",
			studentA, recAown.Code, recAown.Body.String())
	}
	if !strings.Contains(recAown.Body.String(), sentinelA) {
		t.Errorf("AC22c positive: own-center sentinel absent — empty-for-everyone would false-pass isolation")
	}
	if strings.Contains(recAown.Body.String(), sentinelB) {
		t.Errorf("AC22c CROSS-TENANT LEAK: center-B sentinel %q surfaced in center-A's student view", sentinelB)
	}

	// ── Direction 2: caller in Center B (SAME outer tx — proves per-request re-SET) ──
	srvB := NewStudentPerfTestServerForRole(t, db, ownerB, TenantBID, "owner")
	if rec, _ := spGetStudent(t, srvB, studentA); rec.Code != http.StatusNotFound {
		t.Errorf("AC22c (mirror): center-B owner → center-A student %s must be 404, got %d", studentA, rec.Code)
	}
	recBown, _ := spGetStudent(t, srvB, studentB)
	if recBown.Code != http.StatusOK {
		t.Fatalf("AC22c positive (mirror): center-B owner must get 200 for own student %s, got %d", studentB, recBown.Code)
	}
	if !strings.Contains(recBown.Body.String(), sentinelB) {
		t.Errorf("AC22c positive (mirror): center-B own sentinel absent")
	}
	if strings.Contains(recBown.Body.String(), sentinelA) {
		t.Errorf("AC22c CROSS-TENANT LEAK (mirror): center-A sentinel %q surfaced in center-B's view "+
			"(the second call inherited center-A's tenant GUC — the handler failed to re-SET per request)", sentinelA)
	}
}

// ── AC22d — /me returns ONLY self: a second same-class student's sentinel never appears ──

func TestStudentPerf_Me_SelfOnly_ATDD(t *testing.T) {
	db := SetupDB(t)
	center := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	_ = TenantContext(t, db, center.ID)
	cid := dashPGToUUID(t, center.ID)

	teacher := CreateUser(t, db, "t@center-a.test", "Teacher")
	CreateCenterMember(t, db, teacher.ID, center.ID, "teacher")
	tID := dashPGToUUID(t, teacher.ID)
	class := seedClassWithTeacher(t, db, cid, tID)

	// Two students in the SAME class; each with a distinctive name sentinel + a grade.
	self := dashSeedAtRiskStudent(t, db, cid, class, tID, "self@center-a.test", "XSELF_SENTINEL")
	classmate := dashSeedAtRiskStudent(t, db, cid, class, tID, "mate@center-a.test", "XCLASSMATE_SENTINEL")
	seedReleasedGrade(t, db, cid, class, self, tID, "writing", 6.0)
	seedReleasedGrade(t, db, cid, class, classmate, tID, "writing", 7.0)

	selfPG := pgtype.UUID{Bytes: self, Valid: true}
	srv := NewStudentPerfTestServerForRole(t, db, selfPG, TenantAID, "student")
	rec, resp := spGetMe(t, srv)
	if rec.Code != http.StatusOK {
		t.Fatalf("AC22d: student /me must be 200, got %d (body=%s)", rec.Code, rec.Body.String())
	}
	if resp.StudentID != self.String() {
		t.Errorf("AC22d: /me studentId = %q, want self %q", resp.StudentID, self.String())
	}
	if !strings.Contains(rec.Body.String(), "XSELF_SENTINEL") {
		t.Errorf("AC22d positive: /me must carry the caller's OWN data (self sentinel absent)")
	}
	if strings.Contains(rec.Body.String(), "XCLASSMATE_SENTINEL") {
		t.Errorf("AC22d SELF-ONLY LEAK: a same-class classmate's sentinel surfaced on /me — /me must be scoped to tc.UserID alone")
	}
}

var _ = uuid.UUID{} // keep the import stable across green-phase edits
