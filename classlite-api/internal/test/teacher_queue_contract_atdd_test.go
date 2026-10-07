// teacher_queue_contract_atdd_test.go — Story 10-1c ATDD red-phase (AC1 envelope/
// link/overdue/pagination + AC2 release-exclusion matrix + AC5 late_only filter).
//
// AC2 is the grade-release correctness that makes a DERIVED read safe where a
// notification-row-per-submission would race release: the queue shows
//
//	status IN ('submitted','ai_processing') AND (cg.id IS NULL OR cg.released_at IS NULL)
//
// — exercised BEYOND the bare status filter by the ai_processing+unreleased-draft
// case (a draft grade must NOT drop the row) and the released case (must).
//
// overdue is a LIVE computation vs the injected clock (MockClock) — distinct from
// the is_late snapshot (AC5/DD6). Both are emitted and asserted independently.
//
// RED: compile-fails ONLY on newTeacherQueueSrv (→ handler.TeacherQueue). All seed
// helpers (seedInputAssignment/seedReleasedGrade/seedStudentMember) are shipped;
// tqInsertSubmission/tqInsertUnreleasedDraftGrade/tqGet live in the 10-1c helper.
package test

import (
	"net/http"
	"testing"
	"time"

	"github.com/ducdo/classlite-api/internal/clock"
)

func TestTeacherQueue_Contract_ReleaseMatrix_Overdue_LateFilter_ATDD(t *testing.T) {
	db := SetupDB(t)
	clk := clock.NewMockClock(time.Date(2026, 10, 6, 12, 0, 0, 0, time.UTC))
	now := clk.Now()

	center := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	TenantContext(t, db, center.ID)
	cid := qaUUIDFromPg(center.ID)

	teacher := CreateUser(t, db, "tqc@center-a.test", "Teacher C")
	CreateCenterMember(t, db, teacher.ID, center.ID, "teacher")
	n101VerifyCenterMembers(t, db, center.ID)
	tid := qaUUIDFromPg(teacher.ID)
	class := seedClassWithTeacher(t, db, cid, tid)

	// Two assignments on the teacher's class: one past-due (overdue), one future.
	asgPast := seedInputAssignment(t, db, cid, class, tid, now.Add(-24*time.Hour))
	asgFuture := seedInputAssignment(t, db, cid, class, tid, now.Add(24*time.Hour))

	// ── The release/status/late matrix (distinct student names) ──
	// 1. PRESENT — submitted, no grade, past-due, on-time. (link/overdue probe)
	sNoGrade := seedStudentMember(t, db, cid, "nograde@center-a.test", "TQ_C_NOGRADE")
	subNoGrade := tqInsertSubmission(t, db, cid, asgPast, sNoGrade, "submitted", now.Add(-2*time.Hour), false)
	// 2. PRESENT — ai_processing + UNRELEASED draft grade (release-oracle branch).
	sDraft := seedStudentMember(t, db, cid, "draft@center-a.test", "TQ_C_DRAFT")
	subDraft := tqInsertSubmission(t, db, cid, asgPast, sDraft, "ai_processing", now.Add(-3*time.Hour), false)
	tqInsertUnreleasedDraftGrade(t, db, cid, subDraft, tid)
	// 3. PRESENT — submitted, LATE (is_late snapshot).
	sLate := seedStudentMember(t, db, cid, "late@center-a.test", "TQ_C_LATE")
	tqInsertSubmission(t, db, cid, asgPast, sLate, "submitted", now.Add(-1*time.Hour), true)
	// 4. PRESENT — submitted, no grade, FUTURE deadline → overdue=false.
	sFuture := seedStudentMember(t, db, cid, "future@center-a.test", "TQ_C_FUTURE")
	subFuture := tqInsertSubmission(t, db, cid, asgFuture, sFuture, "submitted", now.Add(-30*time.Minute), false)
	// 5. ABSENT — graded + RELEASED (seedReleasedGrade creates its own graded submission).
	sReleased := seedStudentMember(t, db, cid, "released@center-a.test", "TQ_C_RELEASED")
	seedReleasedGrade(t, db, cid, class, sReleased, tid, "writing", 6.5)
	// 6. ABSENT — in_progress (never submitted).
	sInProgress := seedStudentMember(t, db, cid, "wip@center-a.test", "TQ_C_INPROGRESS")
	tqInsertSubmission(t, db, cid, asgPast, sInProgress, "in_progress", now.Add(-10*time.Minute), false)

	srv := newTeacherQueueSrv(t, db, clk)
	tok := SignAccessTokenForRole(t, teacher.ID, UUIDString(center.ID), "teacher")

	// ── Default queue (no late_only): the 4 ungraded present, the 2 absent ──
	code, env := tqGet(t, srv, tok, "page=1&page_size=20")
	if code != http.StatusOK {
		t.Fatalf("teacher-queue status = %d, want 200", code)
	}
	// AC2 present
	if !tqHasStudent(env.Data, "TQ_C_NOGRADE") {
		t.Errorf("AC2: submitted + no grade must be PRESENT in the queue")
	}
	if !tqHasStudent(env.Data, "TQ_C_DRAFT") {
		t.Errorf("AC2 release-oracle: ai_processing + UNRELEASED draft grade must stay PRESENT (cg.released_at IS NULL)")
	}
	if !tqHasStudent(env.Data, "TQ_C_LATE") {
		t.Errorf("AC2: a late ungraded submission must be PRESENT")
	}
	if !tqHasStudent(env.Data, "TQ_C_FUTURE") {
		t.Errorf("AC2: an ungraded submission with a future deadline must be PRESENT")
	}
	// AC2 absent
	if tqHasStudent(env.Data, "TQ_C_RELEASED") {
		t.Errorf("AC2 RELEASE RACE: a graded+RELEASED submission must be ABSENT from the queue")
	}
	if tqHasStudent(env.Data, "TQ_C_INPROGRESS") {
		t.Errorf("AC2: an in_progress submission must be ABSENT (never submitted)")
	}
	// AC1 pagination total = 4 ungraded.
	if env.Meta.Pagination.Total != 4 {
		t.Errorf("AC1 pagination.total = %d, want 4 (the ungraded set)", env.Meta.Pagination.Total)
	}
	if env.Meta.Pagination.Page != 1 || env.Meta.Pagination.PageSize != 20 {
		t.Errorf("AC1 pagination page/pageSize = %d/%d, want 1/20", env.Meta.Pagination.Page, env.Meta.Pagination.PageSize)
	}

	// AC1 — the link + field shape on the no-grade row (overdue=true, not late).
	item, ok := tqFindBySubmission(env.Data, subNoGrade.String())
	if !ok {
		t.Fatalf("AC1: the submitted no-grade row (%s) must be in the queue", subNoGrade)
	}
	wantLink := "/classes/" + class.String() + "/grading/" + asgPast.String() + "/" + subNoGrade.String()
	if item.Link != wantLink {
		t.Errorf("AC1 link = %q, want the exact grading deep-link %q", item.Link, wantLink)
	}
	if item.ClassID != class.String() || item.AssignmentID != asgPast.String() {
		t.Errorf("AC1 ids: classId/assignmentId = %q/%q, want %q/%q", item.ClassID, item.AssignmentID, class.String(), asgPast.String())
	}
	if !item.Overdue {
		t.Errorf("AC1 overdue: a past-deadline ungraded row must be overdue=true vs the injected clock")
	}
	if item.IsLate {
		t.Errorf("AC1 isLate: an on-time submission must be isLate=false (distinct from overdue)")
	}
	if item.SubmittedAt == nil {
		t.Errorf("AC1: submittedAt must be present (non-null) on a submitted row")
	}
	if item.StudentName == "" || item.AssignmentTitle == "" || item.ClassName == "" {
		t.Errorf("AC1: studentName/assignmentTitle/className must all be populated (denormalized at read)")
	}

	// AC1 overdue=false — the future-deadline row.
	if fut, ok := tqFindBySubmission(env.Data, subFuture.String()); ok {
		if fut.Overdue {
			t.Errorf("AC1 overdue: a future-deadline row must be overdue=false")
		}
	} else {
		t.Errorf("AC1: the future-deadline ungraded row must be present")
	}

	// AC5 — the late row carries isLate=true in the default view.
	for _, it := range env.Data {
		if it.StudentName == "TQ_C_LATE" && !it.IsLate {
			t.Errorf("AC5: the late submission must carry isLate=true")
		}
	}

	// ── AC5 — late_only=true returns ONLY the is_late row; total reflects the
	//    filtered set (server-side filter, not a client slice of a full page) ──
	lcode, lenv := tqGet(t, srv, tok, "page=1&page_size=20&late_only=true")
	if lcode != http.StatusOK {
		t.Fatalf("late_only status = %d, want 200", lcode)
	}
	if !tqHasStudent(lenv.Data, "TQ_C_LATE") {
		t.Errorf("AC5: late_only must include the late submission")
	}
	if tqHasStudent(lenv.Data, "TQ_C_NOGRADE") || tqHasStudent(lenv.Data, "TQ_C_FUTURE") || tqHasStudent(lenv.Data, "TQ_C_DRAFT") {
		t.Errorf("AC5: late_only must EXCLUDE on-time ungraded rows")
	}
	if lenv.Meta.Pagination.Total != 1 {
		t.Errorf("AC5 pagination.total under late_only = %d, want 1 (filtered total, pagination stays honest)", lenv.Meta.Pagination.Total)
	}

	// ── AC1 — a crafted huge page/page_size must clamp, never 500 (the ListInbox
	//    int32 overflow-guard class) ──
	ccode, cenv := tqGet(t, srv, tok, "page=100000000000&page_size=100000000000")
	if ccode != http.StatusOK {
		t.Fatalf("crafted huge pagination status = %d, want 200 (clamped, no 500)", ccode)
	}
	if cenv.Meta.Pagination.PageSize > 100 {
		t.Errorf("AC1: page_size must clamp to MaxPageSize (100), got %d", cenv.Meta.Pagination.PageSize)
	}
}
