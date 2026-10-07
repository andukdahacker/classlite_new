// archive_duplicate_atdd_test.go — Story 10-2 AC9 + AC5 clause 3 (code-review
// patch, 2026-10-07). The archive's ONLY reuse verb (Duplicate / Edit-a-copy)
// reuses the shipped POST /api/exercises/{id}/duplicate against a SOFT-DELETED
// (archived) source. Two things must hold and were previously unasserted:
//
//   1. (AC9, the review-decision fix) a teacher CAN duplicate their OWN archived
//      exercise → 201. Before the fix the source read filtered `deleted_at IS
//      NULL` (GetExerciseByID), so every archive duplicate 404'd — the feature
//      was non-functional against the exact rows it is offered on. The fix routes
//      Duplicate through GetExerciseByIDForDuplicate (no soft-delete filter).
//
//   2. (AC5 clause 3, WF-8) teacher A duplicating teacher B's archived exercise →
//      404 (cross-teacher non-disclosure). The soft-delete-inclusive read must
//      NOT widen the teacher scope: assertExerciseTeacherScope still guards it.
//      Positive-then-negative in one test so a blanket 404 can't false-pass the
//      cross-teacher half.
package test

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

// arDuplicate POSTs /api/exercises/{id}/duplicate with a bearer token and returns
// the status (the archive reuse verb calls this shipped endpoint verbatim).
func arDuplicate(t *testing.T, srv http.Handler, tok, exerciseID string) int {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/api/exercises/"+exerciseID+"/duplicate", nil)
	req.Header.Set("Authorization", "Bearer "+tok)
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, req)
	return rec.Code
}

func TestArchive_DuplicateArchivedExercise_OwnAndCrossTeacher_ATDD(t *testing.T) {
	db := SetupDB(t)

	center := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	TenantContext(t, db, center.ID)
	cid := qaUUIDFromPg(center.ID)

	teacherA := CreateUser(t, db, "arc-dup-ta@center-a.test", "Teacher A")
	teacherB := CreateUser(t, db, "arc-dup-tb@center-a.test", "Teacher B")
	CreateCenterMember(t, db, teacherA.ID, center.ID, "teacher")
	CreateCenterMember(t, db, teacherB.ID, center.ID, "teacher")
	n101VerifyCenterMembers(t, db, center.ID)
	taID := qaUUIDFromPg(teacherA.ID)
	tbID := qaUUIDFromPg(teacherB.ID)

	// An ARCHIVED (soft-deleted) exercise for each teacher.
	exA := arSeedArchivedExercise(t, db, cid, taID, "ARC-DUP-A", "reading")
	exB := arSeedArchivedExercise(t, db, cid, tbID, "ARC-DUP-B", "reading")

	srv := NewExerciseTestServerBareMux(t, db)

	// ── AC9 positive: teacher A duplicates their OWN archived exercise → 201.
	//    (Pre-fix this was 404 — the soft-deleted source was invisible to the
	//    Duplicate source read.) ──
	tokA := SignAccessTokenForRole(t, teacherA.ID, UUIDString(center.ID), "teacher")
	if code := arDuplicate(t, srv, tokA, exA.String()); code != http.StatusCreated {
		t.Errorf("AC9: teacher A duplicating OWN archived exercise = %d, want 201 (the soft-deleted source must be clonable)", code)
	}

	// ── AC5 clause 3 negative: teacher A duplicates teacher B's archived
	//    exercise → 404 (cross-teacher non-disclosure; the scope guard must still
	//    hold through the soft-delete-inclusive read). ──
	if code := arDuplicate(t, srv, tokA, exB.String()); code != http.StatusNotFound {
		t.Errorf("AC5: teacher A duplicating teacher B's archived exercise = %d, want 404 (cross-teacher non-disclosure)", code)
	}
}
