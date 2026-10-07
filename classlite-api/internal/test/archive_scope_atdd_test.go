// archive_scope_atdd_test.go — Story 10-2 ATDD red-phase (AC5 · WF-8 HARD GATE).
// Teacher role-scope on GET /api/archive: a teacher sees ONLY their OWN archived
// items (exercises.created_by = caller / classes.teacher_id = caller); owner/admin
// see center-wide; a student is forbidden.
//
// WHY THIS IS A ≥6 RISK (the 7-2a lesson): RLS does NOT isolate two teachers in the
// SAME center (they share center_id) — isolation here rests entirely on the
// service-layer per-branch predicates (Ducdo D4/D5). So this needs its own
// adversarial proof, distinct from the cross-tenant RLS red.
//
// HOUSE RULE: positive (own) THEN negative (other teacher) in one test, so an
// "empty-for-everyone" scope bug can't false-pass.
//
// RED: compile-fails ONLY on the newArchiveSrv seam (→ ArchiveService/ArchiveHandler),
// documented in story_10_2_helpers_test.go. All seed helpers are shipped.
package test

import (
	"net/http"
	"testing"
	"time"

	"github.com/ducdo/classlite-api/internal/clock"
)

func TestArchive_TeacherScope_OwnItemsOnly_ATDD(t *testing.T) {
	db := SetupDB(t)
	clk := clock.NewMockClock(time.Date(2026, 10, 7, 12, 0, 0, 0, time.UTC))
	longAgo := clk.Now().Add(-90 * 24 * time.Hour) // comfortably past the 30-day cutoff

	center := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	TenantContext(t, db, center.ID)
	cid := qaUUIDFromPg(center.ID)

	teacherA := CreateUser(t, db, "arc-ta@center-a.test", "Teacher A")
	teacherB := CreateUser(t, db, "arc-tb@center-a.test", "Teacher B")
	CreateCenterMember(t, db, teacherA.ID, center.ID, "teacher")
	CreateCenterMember(t, db, teacherB.ID, center.ID, "teacher")
	n101VerifyCenterMembers(t, db, center.ID)
	taID := qaUUIDFromPg(teacherA.ID)
	tbID := qaUUIDFromPg(teacherB.ID)

	// Distinctively-titled archived items per teacher so a leak is detectable.
	const exTitleA = "Exercise ARC-EX-A" // insertExerciseRaw sets title = "Exercise "+code
	const exTitleB = "Exercise ARC-EX-B"
	const clTitleA = "ARC_CLASS_ALPHA"
	const clTitleB = "ARC_CLASS_BRAVO"
	arSeedArchivedExercise(t, db, cid, taID, "ARC-EX-A", "reading")
	arSeedArchivedExercise(t, db, cid, tbID, "ARC-EX-B", "reading")
	arInsertClass(t, db, cid, taID, clTitleA, "ended", &longAgo)
	arInsertClass(t, db, cid, tbID, clTitleB, "ended", &longAgo)

	srv := newArchiveSrv(t, db, clk)

	// ── Teacher A: own exercise + own class present, teacher B's absent ──
	tokA := SignAccessTokenForRole(t, teacherA.ID, UUIDString(center.ID), "teacher")
	code, env := arGet(t, srv, tokA, "page=1&page_size=50")
	if code != http.StatusOK {
		t.Fatalf("teacher A archive status = %d, want 200", code)
	}
	if !arHasTitle(env.Data, exTitleA) || !arHasTitle(env.Data, clTitleA) {
		t.Errorf("AC5 positive: teacher A must see OWN archived exercise %q AND class %q", exTitleA, clTitleA)
	}
	if arHasTitle(env.Data, exTitleB) || arHasTitle(env.Data, clTitleB) {
		t.Errorf("AC5 SCOPE LEAK: teacher A must NOT see teacher B's archived items (%q / %q)", exTitleB, clTitleB)
	}

	// ── Teacher B: mirror image ──
	tokB := SignAccessTokenForRole(t, teacherB.ID, UUIDString(center.ID), "teacher")
	codeB, envB := arGet(t, srv, tokB, "page=1&page_size=50")
	if codeB != http.StatusOK {
		t.Fatalf("teacher B archive status = %d, want 200", codeB)
	}
	if !arHasTitle(envB.Data, exTitleB) || !arHasTitle(envB.Data, clTitleB) {
		t.Errorf("AC5 positive (mirror): teacher B must see OWN archived items (%q / %q)", exTitleB, clTitleB)
	}
	if arHasTitle(envB.Data, exTitleA) || arHasTitle(envB.Data, clTitleA) {
		t.Errorf("AC5 SCOPE LEAK (mirror): teacher B must NOT see teacher A's archived items")
	}

	// ── Owner: center-wide — sees BOTH teachers' archived items ──
	owner := CreateUser(t, db, "arc-owner@center-a.test", "Owner")
	CreateCenterMember(t, db, owner.ID, center.ID, "owner")
	n101VerifyCenterMembers(t, db, center.ID)
	tokO := SignAccessTokenForRole(t, owner.ID, UUIDString(center.ID), "owner")
	codeO, envO := arGet(t, srv, tokO, "page=1&page_size=50")
	if codeO != http.StatusOK {
		t.Fatalf("owner archive status = %d, want 200", codeO)
	}
	if !arHasTitle(envO.Data, exTitleA) || !arHasTitle(envO.Data, exTitleB) ||
		!arHasTitle(envO.Data, clTitleA) || !arHasTitle(envO.Data, clTitleB) {
		t.Errorf("AC5: owner must see CENTER-WIDE archived items from both teachers (D4)")
	}

	// ── Student: forbidden (defense-in-depth service guard; the prod route also
	//    sits on the staff-gated chain) ──
	student := CreateUser(t, db, "arc-stu@center-a.test", "ARC_STUDENT")
	CreateCenterMember(t, db, student.ID, center.ID, "student")
	n101VerifyCenterMembers(t, db, center.ID)
	tokS := SignAccessTokenForRole(t, student.ID, UUIDString(center.ID), "student")
	codeS, _ := arGet(t, srv, tokS, "page=1&page_size=50")
	if codeS != http.StatusForbidden {
		t.Errorf("AC5/AC8: a student must be FORBIDDEN from the archive, got status %d, want 403", codeS)
	}
}
