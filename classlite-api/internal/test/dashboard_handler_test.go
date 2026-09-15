// dashboard_handler_test.go — Story 8-1a handler integration (Task 7, TEST-BE-3).
// Complements the ATDD red files: asserts the full {data, meta} envelope shape,
// the empty-state discipline (AC5/AC10 — count 0 / [] never null), the owner
// capacity/pulse defaults, and a GENUINE unauthenticated 401 (AC1) through the real
// ungated chain (no RequireRole). Drives the production middleware chain via
// NewDashboardTestServerForRole / newDashboardSrv.
package test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// ── AC1/AC3 — full {data, meta.serverTime} envelope ──────────────────────────

func TestDashboard_EnvelopeShape(t *testing.T) {
	db := SetupDB(t)
	center := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	_ = TenantContext(t, db, center.ID)
	teacher := CreateUser(t, db, "t@env.test", "Teacher")
	CreateCenterMember(t, db, teacher.ID, center.ID, "teacher")

	srv := NewDashboardTestServerForRole(t, db, teacher.ID, TenantAID, "teacher")
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/dashboard", nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d (body=%s)", rec.Code, rec.Body.String())
	}
	// Raw envelope assertions (TEST-BE-3): both data and meta.serverTime present.
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(rec.Body.Bytes(), &raw); err != nil {
		t.Fatalf("decode envelope: %v", err)
	}
	if _, ok := raw["data"]; !ok {
		t.Error("envelope missing `data`")
	}
	metaRaw, ok := raw["meta"]
	if !ok {
		t.Fatal("envelope missing `meta`")
	}
	var meta dashMeta
	if err := json.Unmarshal(metaRaw, &meta); err != nil {
		t.Fatalf("decode meta: %v", err)
	}
	if _, err := time.Parse(time.RFC3339Nano, meta.ServerTime); err != nil {
		t.Errorf("meta.serverTime %q is not an RFC3339 timestamp: %v", meta.ServerTime, err)
	}
}

// ── AC5 — teacher empty state: count 0 + [] arrays, never null, not an error ──

func TestDashboard_TeacherEmptyState(t *testing.T) {
	db := SetupDB(t)
	center := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	_ = TenantContext(t, db, center.ID)
	teacher := CreateUser(t, db, "t@empty.test", "Teacher")
	CreateCenterMember(t, db, teacher.ID, center.ID, "teacher")

	srv := NewDashboardTestServerForRole(t, db, teacher.ID, TenantAID, "teacher")
	rec, resp := dashGet(t, srv)
	if rec.Code != http.StatusOK || resp.Data.Teacher == nil {
		t.Fatalf("want 200 + teacher block, got %d (body=%s)", rec.Code, rec.Body.String())
	}
	tb := resp.Data.Teacher
	if tb.NeedsGrading.Count != 0 || tb.UnansweredQuestions.Count != 0 || tb.AtRiskStudents.Count != 0 {
		t.Errorf("empty teacher: all rail counts must be 0, got grading=%d questions=%d atRisk=%d",
			tb.NeedsGrading.Count, tb.UnansweredQuestions.Count, tb.AtRiskStudents.Count)
	}
	// Arrays present as [] (never null): raw body must contain the empty arrays.
	body := rec.Body.String()
	for _, key := range []string{`"weekSessions":[]`, `"items":[]`} {
		if !strings.Contains(body, key) {
			t.Errorf("empty teacher: expected %s in body (arrays are [] never null, GO-5): %s", key, body)
		}
	}
}

// ── AC6/AC7 — owner empty state: pulse zeros + storage-only capacity defaults ──

func TestDashboard_OwnerEmptyState(t *testing.T) {
	db := SetupDB(t)
	center := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	_ = TenantContext(t, db, center.ID)
	owner := CreateUser(t, db, "o@empty.test", "Owner")
	CreateCenterMember(t, db, owner.ID, center.ID, "owner")

	srv := NewDashboardTestServerForRole(t, db, owner.ID, TenantAID, "owner")
	rec, resp := dashGet(t, srv)
	if rec.Code != http.StatusOK || resp.Data.Owner == nil {
		t.Fatalf("want 200 + owner block, got %d (body=%s)", rec.Code, rec.Body.String())
	}
	ow := resp.Data.Owner
	if ow.Pulse.ActiveClasses != 0 || ow.Pulse.SessionsToday != 0 || ow.Pulse.StudentsEnrolled != 0 {
		t.Errorf("empty owner pulse must be zero, got %+v", ow.Pulse)
	}
	// Capacity is storage-% only (D-CAP): a fresh center has 0 used, the default
	// limit, 0% and not approaching. (Positive control that capacity IS populated.)
	if ow.NeedsAttention.Capacity.StorageLimitBytes <= 0 {
		t.Errorf("owner capacity.storageLimitBytes must be the center default (>0), got %d",
			ow.NeedsAttention.Capacity.StorageLimitBytes)
	}
	if ow.NeedsAttention.Capacity.Approaching {
		t.Errorf("empty owner capacity must not be `approaching` at 0%% used")
	}
	if ow.NeedsAttention.UnassignedStudents.Count != 0 || ow.NeedsAttention.PendingInvites.Count != 0 {
		t.Errorf("empty owner needsAttention counts must be 0, got unassigned=%d invites=%d",
			ow.NeedsAttention.UnassignedStudents.Count, ow.NeedsAttention.PendingInvites.Count)
	}
	// D-QA: no unanswered-Q&A element anywhere in the owner payload.
	if strings.Contains(rec.Body.String(), "unansweredQuestions") {
		t.Errorf("owner payload must have NO unansweredQuestions element (D-QA); body=%s", rec.Body.String())
	}
}

// ── AC10 — student empty state: [] arrays, never null ──

func TestDashboard_StudentEmptyState(t *testing.T) {
	db := SetupDB(t)
	center := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	_ = TenantContext(t, db, center.ID)
	student := CreateUser(t, db, "s@empty.test", "Student")
	CreateCenterMember(t, db, student.ID, center.ID, "student")

	srv := NewDashboardTestServerForRole(t, db, student.ID, TenantAID, "student")
	rec, resp := dashGet(t, srv)
	if rec.Code != http.StatusOK || resp.Data.Student == nil {
		t.Fatalf("want 200 + student block, got %d (body=%s)", rec.Code, rec.Body.String())
	}
	st := resp.Data.Student
	if len(st.UpcomingSessions) != 0 || len(st.DueSoon) != 0 || len(st.RecentFeedback) != 0 || len(st.MyQuestions) != 0 {
		t.Errorf("empty student: all rails must be empty, got upcoming=%d due=%d feedback=%d questions=%d",
			len(st.UpcomingSessions), len(st.DueSoon), len(st.RecentFeedback), len(st.MyQuestions))
	}
	body := rec.Body.String()
	for _, key := range []string{`"upcomingSessions":[]`, `"dueSoon":[]`, `"recentFeedback":[]`, `"myQuestions":[]`} {
		if !strings.Contains(body, key) {
			t.Errorf("empty student: expected %s in body (arrays [] never null): %s", key, body)
		}
	}
}

// ── AC1 — a GENUINE unauthenticated request → 401, never 403 for role ──

func TestDashboard_NoToken_401(t *testing.T) {
	db := SetupDB(t)
	center := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	_ = TenantContext(t, db, center.ID)

	// Bare server (no injected Bearer) — hit the real ungated chain directly.
	srv := newDashboardSrv(t, db)
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/dashboard", nil))

	if rec.Code != http.StatusUnauthorized {
		t.Errorf("no token → want 401, got %d (body=%s)", rec.Code, rec.Body.String())
	}
	if rec.Code == http.StatusForbidden {
		t.Errorf("must never be 403 purely for role — the chain is ungated (D2/AC1)")
	}
}
