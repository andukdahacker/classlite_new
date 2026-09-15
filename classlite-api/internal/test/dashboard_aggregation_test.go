// dashboard_aggregation_test.go — Story 8-1a positive data-path assertions (Task 7,
// TEST-BE-4). Beyond presence/scoping: proves the value-bearing SQL — the
// needs-grading `overdue` flag (COALESCE(hard_deadline_at, deadline_at) < @now) and
// the student recentFeedback released-band join (current_grades released_at IS NOT
// NULL). Complements the empty-state tests (which prove the zero path).
package test

import (
	"net/http"
	"testing"
	"time"
)

// AC4 — a submission past its deadline surfaces in needsGrading with overdue=true.
func TestDashboard_TeacherNeedsGrading_OverdueFlag(t *testing.T) {
	db := SetupDB(t)
	center := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	_ = TenantContext(t, db, center.ID)
	cid := dashPGToUUID(t, center.ID)

	teacher := CreateUser(t, db, "t@agg.test", "Teacher")
	CreateCenterMember(t, db, teacher.ID, center.ID, "teacher")
	tID := dashPGToUUID(t, teacher.ID)
	class := seedClassWithTeacher(t, db, cid, tID)

	student := seedStudentMember(t, db, cid, "s@agg.test", "AGG_STUDENT")
	insertEnrollmentRaw(t, db, cid, student, class, "active")
	// dashSeedNeedsGrading uses a deadline 24h in the past → overdue.
	dashSeedNeedsGrading(t, db, cid, class, tID, student)

	srv := NewDashboardTestServerForRole(t, db, teacher.ID, TenantAID, "teacher")
	rec, resp := dashGet(t, srv)
	if rec.Code != http.StatusOK || resp.Data.Teacher == nil {
		t.Fatalf("want 200 + teacher block, got %d (body=%s)", rec.Code, rec.Body.String())
	}
	tb := resp.Data.Teacher
	if tb.NeedsGrading.Count < 1 || len(tb.NeedsGrading.Items) < 1 {
		t.Fatalf("needsGrading must include the seeded submission, got count=%d items=%d",
			tb.NeedsGrading.Count, len(tb.NeedsGrading.Items))
	}
	var found bool
	for _, it := range tb.NeedsGrading.Items {
		if it.StudentName == "AGG_STUDENT" {
			found = true
			if !it.Overdue {
				t.Errorf("submission past its deadline must have overdue=true")
			}
		}
	}
	if !found {
		t.Errorf("needsGrading items must contain the seeded student's submission")
	}
}

// AC9 — a released grade surfaces in the student's recentFeedback with its band.
func TestDashboard_StudentRecentFeedback_Band(t *testing.T) {
	db := SetupDB(t)
	center := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	_ = TenantContext(t, db, center.ID)
	cid := dashPGToUUID(t, center.ID)

	teacher := CreateUser(t, db, "t@fb.test", "Teacher")
	CreateCenterMember(t, db, teacher.ID, center.ID, "teacher")
	class := seedClassWithTeacher(t, db, cid, dashPGToUUID(t, teacher.ID))
	author := dashPGToUUID(t, teacher.ID)

	student := CreateUser(t, db, "s@fb.test", "Student")
	CreateCenterMember(t, db, student.ID, center.ID, "student")
	sID := dashPGToUUID(t, student.ID)
	insertEnrollmentRaw(t, db, cid, sID, class, "active")
	seedReleasedGrade(t, db, cid, class, sID, author, "writing", 6.5)

	srv := NewDashboardTestServerForRole(t, db, student.ID, TenantAID, "student")
	rec, resp := dashGet(t, srv)
	if rec.Code != http.StatusOK || resp.Data.Student == nil {
		t.Fatalf("want 200 + student block, got %d (body=%s)", rec.Code, rec.Body.String())
	}
	fb := resp.Data.Student.RecentFeedback
	if len(fb) < 1 {
		t.Fatalf("recentFeedback must include the released grade")
	}
	if fb[0].OverallBand == nil || *fb[0].OverallBand != 6.5 {
		t.Errorf("recentFeedback overallBand = %v, want 6.5", fb[0].OverallBand)
	}
}

// AC6 — a staff member (teacher/admin) with a refresh token created today counts in
// pulse.staffActiveToday. Positive control: the OwnerEmptyState test only proves the
// zero path, so a silently-zeroed join/RLS on this sub-select would pass unnoticed.
func TestDashboard_OwnerPulse_StaffActiveToday(t *testing.T) {
	db := SetupDB(t)
	center := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	_ = TenantContext(t, db, center.ID)

	teacher := CreateUser(t, db, "staff@pulse.test", "Staff Teacher")
	CreateCenterMember(t, db, teacher.ID, center.ID, "teacher")
	// A refresh token created today ⇒ the teacher is "active today" (7.1a login/rotation proxy).
	seedRefreshTokenAt(t, db, dashPGToUUID(t, teacher.ID), time.Now())

	owner := CreateUser(t, db, "owner@pulse.test", "Owner")
	CreateCenterMember(t, db, owner.ID, center.ID, "owner")

	srv := NewDashboardTestServerForRole(t, db, owner.ID, TenantAID, "owner")
	rec, resp := dashGet(t, srv)
	if rec.Code != http.StatusOK || resp.Data.Owner == nil {
		t.Fatalf("want 200 + owner block, got %d (body=%s)", rec.Code, rec.Body.String())
	}
	if resp.Data.Owner.Pulse.StaffActiveToday < 1 {
		t.Errorf("AC6 positive: staffActiveToday must count the teacher with a refresh token today, got %d",
			resp.Data.Owner.Pulse.StaffActiveToday)
	}
}
