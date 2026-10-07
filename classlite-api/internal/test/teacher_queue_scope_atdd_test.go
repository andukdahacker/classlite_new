// teacher_queue_scope_atdd_test.go — Story 10-1c ATDD red-phase (AC3 · WF-8 HARD
// GATE). Teacher role-scope on GET /api/inbox/teacher-queue: a teacher sees the
// ungraded submissions of ONLY the classes they teach (classes.teacher_id = caller).
//
// WHY THIS IS A ≥6 RISK (the 7-2a lesson): RLS does NOT isolate two teachers in the
// SAME center (they share center_id) — isolation here rests entirely on the
// service-layer `teacher_id = tc.UserID` predicate (Ducdo Q4, teacher-scoped-only).
// So this needs its own adversarial proof, distinct from the cross-tenant RLS red.
//
// HOUSE RULE: positive (own) THEN negative (other teacher) in one test, so an
// "empty-for-everyone" scope bug can't false-pass.
//
// RED: compile-fails ONLY on the newTeacherQueueSrv seam (→ handler.TeacherQueue),
// documented in story_10_1c_helpers_test.go. All seed helpers are shipped.
package test

import (
	"net/http"
	"testing"
	"time"

	"github.com/ducdo/classlite-api/internal/clock"
)

func TestTeacherQueue_TeacherScope_OwnClassesOnly_ATDD(t *testing.T) {
	db := SetupDB(t)
	clk := clock.NewMockClock(time.Date(2026, 10, 6, 12, 0, 0, 0, time.UTC))
	now := clk.Now()

	center := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	TenantContext(t, db, center.ID)
	cid := qaUUIDFromPg(center.ID)

	teacherA := CreateUser(t, db, "tqa@center-a.test", "Teacher A")
	teacherB := CreateUser(t, db, "tqb@center-a.test", "Teacher B")
	CreateCenterMember(t, db, teacherA.ID, center.ID, "teacher")
	CreateCenterMember(t, db, teacherB.ID, center.ID, "teacher")
	n101VerifyCenterMembers(t, db, center.ID) // the queue requires a verified caller
	taID := qaUUIDFromPg(teacherA.ID)
	tbID := qaUUIDFromPg(teacherB.ID)

	classA := seedClassWithTeacher(t, db, cid, taID)
	classB := seedClassWithTeacher(t, db, cid, tbID)

	// One ungraded (submitted, no released grade) submission per teacher's class,
	// each by a distinctively-named student so a leak is detectable by name.
	const nameA = "TQ_STUDENT_ALPHA"
	const nameB = "TQ_STUDENT_BRAVO"
	studentA := seedStudentMember(t, db, cid, "sa@center-a.test", nameA)
	studentB := seedStudentMember(t, db, cid, "sb@center-a.test", nameB)
	asgA := seedInputAssignment(t, db, cid, classA, taID, now.Add(-24*time.Hour))
	asgB := seedInputAssignment(t, db, cid, classB, tbID, now.Add(-24*time.Hour))
	tqInsertSubmission(t, db, cid, asgA, studentA, "submitted", now.Add(-2*time.Hour), false)
	tqInsertSubmission(t, db, cid, asgB, studentB, "submitted", now.Add(-2*time.Hour), false)

	srv := newTeacherQueueSrv(t, db, clk)

	// ── Teacher A: own-class submission present, teacher B's absent ──
	tokA := SignAccessTokenForRole(t, teacherA.ID, UUIDString(center.ID), "teacher")
	code, env := tqGet(t, srv, tokA, "page=1&page_size=20")
	if code != http.StatusOK {
		t.Fatalf("teacher A queue status = %d, want 200", code)
	}
	if !tqHasStudent(env.Data, nameA) {
		t.Errorf("AC3 positive: teacher A's queue must include own-class submission (student %q)", nameA)
	}
	if tqHasStudent(env.Data, nameB) {
		t.Errorf("AC3 SCOPE LEAK: teacher A must NOT see teacher B's class submission (student %q)", nameB)
	}

	// ── Teacher B: mirror image ──
	tokB := SignAccessTokenForRole(t, teacherB.ID, UUIDString(center.ID), "teacher")
	codeB, envB := tqGet(t, srv, tokB, "page=1&page_size=20")
	if codeB != http.StatusOK {
		t.Fatalf("teacher B queue status = %d, want 200", codeB)
	}
	if !tqHasStudent(envB.Data, nameB) {
		t.Errorf("AC3 positive (mirror): teacher B must see own-class submission (student %q)", nameB)
	}
	if tqHasStudent(envB.Data, nameA) {
		t.Errorf("AC3 SCOPE LEAK (mirror): teacher B must NOT see teacher A's class submission (student %q)", nameA)
	}

	// ── Non-teacher caller (owner teaching no class) → empty, never another
	//    teacher's rows (DD5 non-disclosure by construction; teacher_id=caller
	//    matches no class for the owner). ──
	owner := CreateUser(t, db, "owner@center-a.test", "Owner")
	CreateCenterMember(t, db, owner.ID, center.ID, "owner")
	n101VerifyCenterMembers(t, db, center.ID)
	tokO := SignAccessTokenForRole(t, owner.ID, UUIDString(center.ID), "owner")
	codeO, envO := tqGet(t, srv, tokO, "page=1&page_size=20")
	if codeO != http.StatusOK {
		t.Fatalf("owner queue status = %d, want 200", codeO)
	}
	if len(envO.Data) != 0 || envO.Meta.Pagination.Total != 0 {
		t.Errorf("AC3: non-teacher caller must get an EMPTY queue (teacher_id=caller matches no class), got %d rows total=%d",
			len(envO.Data), envO.Meta.Pagination.Total)
	}
}
