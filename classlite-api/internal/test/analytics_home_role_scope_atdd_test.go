// analytics_home_role_scope_atdd_test.go — Story 8-2a ATDD (green)
// (AC2/AC3/AC4 · risk=7 · WF-8 HARD GATE). Role-branching of GET /api/analytics
// (the "analytics home"), driven through the REAL ungated chain
// (extractTenant → requireVerified → requireCenter → ErrorMapper, NO RequireRole,
// D6a — the same shape as GET /api/dashboard). Role/scope is enforced IN the
// service: teacher = own classes; owner/admin = center-wide; student = 403
// (NOT a role-scoped payload — D4, distinct from the dashboard which serves
// students). This is the ONE place a student is refused at the analytics home.
//
// FALSIFIABILITY (Murat house rule — positive control in the SAME test): every
// "teacher sees only own" is paired with "teacher owns X, does NOT own Y (same
// center) → X present AND Y absent". A negative-only assertion false-passes when
// the teacher owns zero classes. The owner cross-check proves the same X+Y set is
// center-wide-visible (so "empty for everyone" cannot pass).
//
// ─────────────────────────────────────────────────────────────────────────────
// RED: real `//go:build atdd_red_phase`. Excluded from `go test ./...`. Under
// `-tags=atdd_red_phase` compile-fails ONLY on the ONE greenfield seam below.
//
// GREEN SEAM (dev — Task 4 + Task 7):
//
//	internal/test/story_8_2_helpers.go:
//	  func NewAnalyticsTestServerForRole(t *testing.T, db storyDB,
//	      userID pgtype.UUID, centerID string, role string) http.Handler
//	    — model on NewDashboardTestServerForRole (story_8_1_helpers.go): the
//	      UNGATED dashboardChain shape (NO RequireRole — a student reaches the
//	      handler and the SERVICE returns 403, D4/D6a); marks the caller
//	      email_verified + injects the Bearer token; the caller's center_members
//	      row (its DB role) is created by the test via CreateCenterMember.
//	    — mounts BOTH:
//	        mux.Handle("GET /api/analytics", chain(analyticsHandler.Home))
//	        mux.Handle("GET /api/analytics/classes/{id}", chain(analyticsHandler.GetClass))
//
// SERVICE ERROR CONTRACT the mapper renders (dev — Task 3):
//
//	home  student  → &service.ForbiddenError{...}                         → 403 INSUFFICIENT_ROLE
//	class miss/scope→ model.NotFoundError{Resource:"class", Code:"CLASS_NOT_FOUND"} → 404 CLASS_NOT_FOUND
//
// The an* JSON-parse structs + an* helpers below are LOCAL test types (PROVISIONAL
// D9 contract, camelCase). Shared by the AC11-14 red files in this package. If
// 8-2b churns the contract at co-finalize (D9), update them in one place here.
package test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/jackc/pgx/v5/pgtype"
)

// ── shared parse contract (PROVISIONAL, D9; camelCase) ──────────────────────

type anHomeResp struct {
	Data anHome `json:"data"`
}

type anHome struct {
	Role    string           `json:"role"`
	Classes []anClassSummary `json:"classes"`
}

type anClassSummary struct {
	ClassID      string   `json:"classId"`
	ClassName    string   `json:"className"`
	StudentCount int      `json:"studentCount"`
	AvgBand      *float64 `json:"avgBand"`
	AtRiskCount  int      `json:"atRiskCount"`
	OnTimeRate   *float64 `json:"onTimeRate"`
}

func anClassSummaryHas(classes []anClassSummary, classID string) bool {
	for _, c := range classes {
		if c.ClassID == classID {
			return true
		}
	}
	return false
}

// anGetHome drives GET /api/analytics and decodes the envelope on 200.
func anGetHome(t *testing.T, srv http.Handler) (*httptest.ResponseRecorder, *anHomeResp) {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/api/analytics", nil)
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, req)
	var out anHomeResp
	if rec.Code == http.StatusOK {
		if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
			t.Fatalf("decode analytics-home envelope: %v (body=%s)", err, rec.Body.String())
		}
	}
	return rec, &out
}

// anGetClass drives GET /api/analytics/classes/{id} (raw recorder — callers scan
// the status/error-code or the raw body for sentinels).
func anGetClass(t *testing.T, srv http.Handler, classID string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/api/analytics/classes/"+classID, nil)
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, req)
	return rec
}

// anErrCode parses the {error:{code}} envelope (internal/test has no shared
// error-code helper; internal/handler's errCodeOf is a different package).
func anErrCode(t *testing.T, body []byte) string {
	t.Helper()
	var e struct {
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	if err := json.Unmarshal(body, &e); err != nil {
		t.Fatalf("decode error envelope: %v (body=%s)", err, string(body))
	}
	return e.Error.Code
}

// ── AC2/AC3 — teacher sees ONLY own classes; owner/admin see center-wide ─────

func TestAnalyticsHome_TeacherOwnClassesOnly_ATDD(t *testing.T) {
	db := SetupDB(t)
	center := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	_ = TenantContext(t, db, center.ID)
	cid := dashPGToUUID(t, center.ID)

	teacherA := CreateUser(t, db, "teachA@center-a.test", "Teacher A")
	teacherB := CreateUser(t, db, "teachB@center-a.test", "Teacher B")
	CreateCenterMember(t, db, teacherA.ID, center.ID, "teacher")
	CreateCenterMember(t, db, teacherB.ID, center.ID, "teacher")

	classA := seedClassWithTeacher(t, db, cid, dashPGToUUID(t, teacherA.ID))
	classB := seedClassWithTeacher(t, db, cid, dashPGToUUID(t, teacherB.ID))

	// Give each class a released grade so mini-stats (avgBand) populate — the
	// list-membership is the AC2 assertion, the stats prove a non-empty branch.
	sA := dashSeedAtRiskStudent(t, db, cid, classA, dashPGToUUID(t, teacherA.ID), "sa@center-a.test", "SA")
	sB := dashSeedAtRiskStudent(t, db, cid, classB, dashPGToUUID(t, teacherB.ID), "sb@center-a.test", "SB")
	seedReleasedGrade(t, db, cid, classA, sA, dashPGToUUID(t, teacherA.ID), "writing", 6.0)
	seedReleasedGrade(t, db, cid, classB, sB, dashPGToUUID(t, teacherB.ID), "writing", 7.0)

	// SEAM: NewAnalyticsTestServerForRole (ungated chain, D6a).
	srvA := NewAnalyticsTestServerForRole(t, db, teacherA.ID, TenantAID, "teacher")
	rec, resp := anGetHome(t, srvA)
	if rec.Code != http.StatusOK {
		t.Fatalf("teacher A home: want 200, got %d (body=%s)", rec.Code, rec.Body.String())
	}
	if resp.Data.Role != "teacher" {
		t.Errorf("teacher A home: data.role = %q, want %q", resp.Data.Role, "teacher")
	}
	// Positive: own class present. Negative: other teacher's class absent.
	if !anClassSummaryHas(resp.Data.Classes, classA.String()) {
		t.Errorf("AC2 positive: teacher A's home must include own class %s", classA)
	}
	if anClassSummaryHas(resp.Data.Classes, classB.String()) {
		t.Errorf("AC2 SCOPE LEAK: teacher A's home must NOT include teacher B's class %s", classB)
	}

	// Mirror: teacher B sees own, not A's.
	srvB := NewAnalyticsTestServerForRole(t, db, teacherB.ID, TenantAID, "teacher")
	recB, respB := anGetHome(t, srvB)
	if recB.Code != http.StatusOK {
		t.Fatalf("teacher B home: want 200, got %d", recB.Code)
	}
	if !anClassSummaryHas(respB.Data.Classes, classB.String()) {
		t.Errorf("AC2 positive (mirror): teacher B's home must include own class %s", classB)
	}
	if anClassSummaryHas(respB.Data.Classes, classA.String()) {
		t.Errorf("AC2 SCOPE LEAK (mirror): teacher B's home must NOT include teacher A's class %s", classA)
	}

	// AC3: owner sees BOTH classes center-wide (proves the set is not empty-for-everyone).
	owner := CreateUser(t, db, "owner@center-a.test", "Owner")
	CreateCenterMember(t, db, owner.ID, center.ID, "owner")
	srvO := NewAnalyticsTestServerForRole(t, db, owner.ID, TenantAID, "owner")
	recO, respO := anGetHome(t, srvO)
	if recO.Code != http.StatusOK {
		t.Fatalf("owner home: want 200, got %d", recO.Code)
	}
	if respO.Data.Role != "owner" {
		t.Errorf("AC3: owner home data.role = %q, want owner", respO.Data.Role)
	}
	if !anClassSummaryHas(respO.Data.Classes, classA.String()) || !anClassSummaryHas(respO.Data.Classes, classB.String()) {
		t.Errorf("AC3: owner home must be center-wide — both classes %s and %s present", classA, classB)
	}
}

// ── AC4 — student is REFUSED at the analytics home: 403 INSUFFICIENT_ROLE ────
//
// D4: the student has NO analytics home (the FE redirects them to /my-performance,
// Story 8.3). This is DISTINCT from the class endpoint's 404 non-disclosure
// (analytics_class_nondisclosure_atdd_test.go) — same actor, two endpoints, two
// codes. A lazy impl that returns 404 (or a role-scoped 200) for the home fails here.

func TestAnalyticsHome_Student_Forbidden403_ATDD(t *testing.T) {
	db := SetupDB(t)
	center := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	_ = TenantContext(t, db, center.ID)

	student := CreateUser(t, db, "s@center-a.test", "Student")
	CreateCenterMember(t, db, student.ID, center.ID, "student")

	srv := NewAnalyticsTestServerForRole(t, db, student.ID, TenantAID, "student")
	rec, _ := anGetHome(t, srv)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("AC4: student GET /api/analytics must be 403, got %d (body=%s)", rec.Code, rec.Body.String())
	}
	if code := anErrCode(t, rec.Body.Bytes()); code != "INSUFFICIENT_ROLE" {
		t.Errorf("AC4: student home error code = %q, want INSUFFICIENT_ROLE "+
			"(service.ForbiddenError → 403; distinct from the class endpoint's 404 CLASS_NOT_FOUND)", code)
	}
}

var _ = pgtype.UUID{} // keep the import stable across green-phase edits
