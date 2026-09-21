// analytics_class_nondisclosure_atdd_test.go — Story 8-2a ATDD (green)
// (AC11/AC12/AC13 · risk=7 · WF-8 HARD GATE). Role/ownership scoping of
// GET /api/analytics/classes/{id} via NON-DISCLOSURE 404 (never 403, never leak
// that the class exists) — the 7-2a/7-4a teacher-scope idiom applied to analytics.
//
// THE DISTINCTION THIS FILE PINS (Murat, party-mode BLOCKER): the SAME actor (a
// student) gets TWO DIFFERENT rejection codes across the two analytics endpoints:
//   - GET /api/analytics          → 403 INSUFFICIENT_ROLE  (role refused — home file)
//   - GET /api/analytics/classes/X → 404 CLASS_NOT_FOUND    (existence hidden — here)
//
// A lazy impl that returns 403 for BOTH leaks "this class exists but you can't see
// it". Each is a separate red asserting the EXACT status + code.
//
// HOUSE RULE: every 404 negative carries a positive control in the SAME test — the
// legitimate caller (class's own teacher / owner) gets 200 with a non-empty body
// for that SAME class id — else "class seeded wrong → everyone 404s" false-passes.
//
// RED: real `//go:build atdd_red_phase`. Under `-tags=atdd_red_phase` compile-fails
// ONLY on NewAnalyticsTestServerForRole (analytics_home_role_scope_atdd_test.go).
// an*/anGetClass/anErrCode + all seed helpers are shipped in this package.
package test

import (
	"net/http"
	"strings"
	"testing"
)

// ── AC11 — teacher requesting a class they do NOT teach → 404 (positive control) ──

func TestAnalyticsClass_TeacherNotOwner_404_ATDD(t *testing.T) {
	db := SetupDB(t)
	center := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	_ = TenantContext(t, db, center.ID)
	cid := dashPGToUUID(t, center.ID)

	teacherA := CreateUser(t, db, "ta@center-a.test", "Teacher A")
	teacherB := CreateUser(t, db, "tb@center-a.test", "Teacher B")
	CreateCenterMember(t, db, teacherA.ID, center.ID, "teacher")
	CreateCenterMember(t, db, teacherB.ID, center.ID, "teacher")

	classA := seedClassWithTeacher(t, db, cid, dashPGToUUID(t, teacherA.ID))
	sA := dashSeedAtRiskStudent(t, db, cid, classA, dashPGToUUID(t, teacherA.ID), "sa@center-a.test", "OWN_SENTINEL_A")
	seedReleasedGrade(t, db, cid, classA, sA, dashPGToUUID(t, teacherA.ID), "writing", 6.0)

	// Negative: teacher B (does NOT teach classA) → 404 CLASS_NOT_FOUND.
	srvB := NewAnalyticsTestServerForRole(t, db, teacherB.ID, TenantAID, "teacher")
	recB := anGetClass(t, srvB, classA.String())
	if recB.Code != http.StatusNotFound {
		t.Fatalf("AC11: teacher-not-owner must be 404, got %d (body=%s)", recB.Code, recB.Body.String())
	}
	if code := anErrCode(t, recB.Body.Bytes()); code != "CLASS_NOT_FOUND" {
		t.Errorf("AC11: teacher-not-owner code = %q, want CLASS_NOT_FOUND (non-disclosure — never 403)", code)
	}

	// Positive control (SAME class id): teacher A (owner) → 200 non-empty.
	srvA := NewAnalyticsTestServerForRole(t, db, teacherA.ID, TenantAID, "teacher")
	recA := anGetClass(t, srvA, classA.String())
	if recA.Code != http.StatusOK {
		t.Fatalf("AC11 positive control: class's own teacher must get 200 for %s, got %d (body=%s)",
			classA, recA.Code, recA.Body.String())
	}
	if !strings.Contains(recA.Body.String(), "OWN_SENTINEL_A") {
		t.Errorf("AC11 positive control: teacher A's class-perf body must be non-empty (own at-risk sentinel present)")
	}
}

// ── AC12 — student → 404 CLASS_NOT_FOUND (DISTINCT from the home 403) ────────

func TestAnalyticsClass_Student_404_DistinctFromHome403_ATDD(t *testing.T) {
	db := SetupDB(t)
	center := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	_ = TenantContext(t, db, center.ID)
	cid := dashPGToUUID(t, center.ID)

	teacher := CreateUser(t, db, "t@center-a.test", "Teacher")
	CreateCenterMember(t, db, teacher.ID, center.ID, "teacher")
	class := seedClassWithTeacher(t, db, cid, dashPGToUUID(t, teacher.ID))

	student := CreateUser(t, db, "s@center-a.test", "Student")
	CreateCenterMember(t, db, student.ID, center.ID, "student")
	// enrolled in the class — still no analytics access (D4).
	insertEnrollmentRaw(t, db, cid, dashPGToUUID(t, student.ID), class, "active")

	srvS := NewAnalyticsTestServerForRole(t, db, student.ID, TenantAID, "student")
	recClass := anGetClass(t, srvS, class.String())
	if recClass.Code != http.StatusNotFound {
		t.Fatalf("AC12: student class-perf must be 404 (non-disclosure), got %d (body=%s)",
			recClass.Code, recClass.Body.String())
	}
	if code := anErrCode(t, recClass.Body.Bytes()); code != "CLASS_NOT_FOUND" {
		t.Errorf("AC12: student class code = %q, want CLASS_NOT_FOUND", code)
	}

	// The DISTINCTION: same student on the HOME endpoint → 403 (not 404). This
	// asserts the two endpoints do NOT collapse to one rejection code.
	recHome, _ := anGetHome(t, srvS)
	if recHome.Code != http.StatusForbidden {
		t.Errorf("AC12/AC4 DISTINCTION: student home must be 403 while class is 404 — got home=%d class=404",
			recHome.Code)
	}

	// Positive control: owner → 200 for the SAME class id.
	owner := CreateUser(t, db, "o@center-a.test", "Owner")
	CreateCenterMember(t, db, owner.ID, center.ID, "owner")
	srvO := NewAnalyticsTestServerForRole(t, db, owner.ID, TenantAID, "owner")
	if rec := anGetClass(t, srvO, class.String()); rec.Code != http.StatusOK {
		t.Errorf("AC12 positive control: owner must get 200 for class %s, got %d", class, rec.Code)
	}
}

// ── AC13 — SEC-1: DB-authoritative ownership, not the JWT claim ──────────────
//
// A caller whose JWT says "teacher" but whose DB center_members role is teacher of
// a DIFFERENT class must be judged on the DB class.teacher_id, not the token. Here
// teacher B holds a valid teacher token but does not teach classA → 404, and NO
// analytics rows are computed (the 404 precedes aggregation). Positive control: the
// true class teacher gets 200. (This overlaps AC11's shape but pins the SEC-1
// intent — ownership is re-derived from the DB, never trusted from the claim.)

func TestAnalyticsClass_SEC1_DBAuthoritativeOwnership_ATDD(t *testing.T) {
	db := SetupDB(t)
	center := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	_ = TenantContext(t, db, center.ID)
	cid := dashPGToUUID(t, center.ID)

	trueTeacher := CreateUser(t, db, "true@center-a.test", "True Teacher")
	otherTeacher := CreateUser(t, db, "other@center-a.test", "Other Teacher")
	CreateCenterMember(t, db, trueTeacher.ID, center.ID, "teacher")
	CreateCenterMember(t, db, otherTeacher.ID, center.ID, "teacher")

	class := seedClassWithTeacher(t, db, cid, dashPGToUUID(t, trueTeacher.ID))
	s := dashSeedAtRiskStudent(t, db, cid, class, dashPGToUUID(t, trueTeacher.ID), "s@center-a.test", "SEC1_SENTINEL")
	seedReleasedGrade(t, db, cid, class, s, dashPGToUUID(t, trueTeacher.ID), "writing", 6.5)

	// Other teacher holds a genuine teacher JWT but does not teach `class` → 404.
	srvOther := NewAnalyticsTestServerForRole(t, db, otherTeacher.ID, TenantAID, "teacher")
	rec := anGetClass(t, srvOther, class.String())
	if rec.Code != http.StatusNotFound {
		t.Fatalf("AC13/SEC-1: a valid-teacher-token caller who does NOT teach the class must be 404, got %d", rec.Code)
	}
	if strings.Contains(rec.Body.String(), "SEC1_SENTINEL") {
		t.Errorf("AC13/SEC-1: no analytics rows must be computed for a non-owning caller — sentinel leaked into a 404 body")
	}

	// Positive control: true teacher → 200 non-empty.
	srvTrue := NewAnalyticsTestServerForRole(t, db, trueTeacher.ID, TenantAID, "teacher")
	if recT := anGetClass(t, srvTrue, class.String()); recT.Code != http.StatusOK ||
		!strings.Contains(recT.Body.String(), "SEC1_SENTINEL") {
		t.Errorf("AC13 positive control: true class teacher must get 200 with own data, got %d", recT.Code)
	}
}
