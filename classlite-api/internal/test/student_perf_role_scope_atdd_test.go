// student_perf_role_scope_atdd_test.go — Story 8-3a ATDD (green)
// (AC1/2/3/4/5/6/22a/22b · risk=8 · R-1 student-privacy authz · WF-8 HARD GATE).
// Per-role scoping of the TWO new student-analytics endpoints, driven through the
// REAL ungated dashboardChain (extractTenant → requireVerified → requireCenter →
// ErrorMapper, NO RequireRole — D4/8-2a-D6a, the SERVICE decides access):
//
//	GET /api/analytics/students/{id}  owner/admin → any center student · teacher →
//	    own-class-only, out-of-scope REAL student → 404 STUDENT_NOT_FOUND
//	    (non-disclosure) · student → 403 INSUFFICIENT_ROLE (incl. their OWN id)
//	GET /api/analytics/me             student → self only · non-student → 403
//
// FALSIFIABILITY (Murat C1/C2 — the D4 top-risk pins): the teacher-out-of-scope
// negative is a REAL student enrolled in ANOTHER teacher's class in the SAME center
// (a random UUID passes 404 without ever exercising analyticsTeacherScope), and the
// 404 body carries NONE of that student's sentinel. The 403-vs-404 codes are
// asserted on the body error.code, not just the HTTP int (403-for-both leaks
// existence; 404-for-both over-hides). The student→/students 403 INCLUDES their own
// id (the classic "is this your own data?→allow" leak).
//
// ─────────────────────────────────────────────────────────────────────────────
// This file OWNS, for the whole 8-3a red suite, the shared PROVISIONAL `sp*` JSON
// parse contract (camelCase, pointers for nullable — D7/GO-5) + the `spGetStudent`/
// `spGetMe`/`spErrCode` helpers + the `NewStudentPerfTestServerForRole` seam. The
// other 8-3a red files reuse these — DO NOT redeclare them there.
//
// RED: real `//go:build atdd_red_phase`. `go build ./...` / `go test ./...` stay
// GREEN (the tag excludes this file). Under `-tags=atdd_red_phase` it compile-fails
// ONLY on the greenfield handler seams (dev — Task 6):
//
//	internal/handler/analytics_handler.go:
//	  func (h *AnalyticsHandler) GetStudent(w, r) error  // /students/{id}, uuid.Parse 422 guard
//	  func (h *AnalyticsHandler) Me(w, r) error          // /me, studentID := tc.UserID
//
// SERVICE ERROR CONTRACT the mapper renders (dev — Task 5):
//
//	students student            → &service.ForbiddenError{...}                              → 403 INSUFFICIENT_ROLE
//	students teacher-oos/unknown→ model.NotFoundError{Resource:"student",Code:"STUDENT_NOT_FOUND"} → 404 STUDENT_NOT_FOUND
//	me       non-student        → &service.ForbiddenError{...}                              → 403 INSUFFICIENT_ROLE
package test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/handler"
	"github.com/ducdo/classlite-api/internal/middleware"
	"github.com/ducdo/classlite-api/internal/service"
	"github.com/jackc/pgx/v5/pgtype"
)

// ── shared PROVISIONAL parse contract (D7; camelCase; pointers = nullable/strippable) ──

type spEnvelope struct {
	Data spStudentPerf `json:"data"`
}

type spStudentPerf struct {
	StudentID       string              `json:"studentId"`
	StudentName     string              `json:"studentName"`
	Framing         string              `json:"framing"`
	ClassID         *string             `json:"classId"`
	TargetBand      *float64            `json:"targetBand"`
	SubmissionStats spSubmissionStats   `json:"submissionStats"`
	SkillBreakdown  []spSkillBreakdown  `json:"skillBreakdown"`
	BandProgression []spSkillBandSeries `json:"bandProgression"`
	MistakePatterns spMistakePatterns   `json:"mistakePatterns"`
}

type spSkillBandSeries struct {
	Skill  string        `json:"skill"`
	Points []spBandPoint `json:"points"`
}

type spBandPoint struct {
	WeekStart string   `json:"weekStart"`
	AvgBand   *float64 `json:"avgBand"`
}

type spSkillBreakdown struct {
	Skill        string           `json:"skill"`
	OverallBand  *float64         `json:"overallBand"`
	ClassAvgBand *float64         `json:"classAvgBand"` // D11 — teacher view only; STRIPPED on /me
	Criteria     []spCriterionAvg `json:"criteria"`
}

type spCriterionAvg struct {
	Criterion string   `json:"criterion"`
	AvgBand   *float64 `json:"avgBand"`
}

type spSubmissionStats struct {
	SubmissionRate        spSubmissionRate `json:"submissionRate"`
	TotalSubmissionCount  int              `json:"totalSubmissionCount"`
	GradedSubmissionCount int              `json:"gradedSubmissionCount"` // Sally — ghosted-frame "≥3 graded"
	PraisePinCount        int              `json:"praisePinCount"`
	ErrorPinCount         int              `json:"errorPinCount"`
	HasData               map[string]bool  `json:"hasData"`
}

type spSubmissionRate struct {
	OnTimeCount int      `json:"onTimeCount"`
	TotalDue    int      `json:"totalDue"`
	Rate        *float64 `json:"rate"`
}

type spMistakePatterns struct {
	CoveredSources  []string           `json:"coveredSources"`
	ExcludedSources []string           `json:"excludedSources"`
	Patterns        []spMistakePattern `json:"patterns"`
}

type spMistakePattern struct {
	SkillSource          string `json:"skillSource"`
	Criterion            string `json:"criterion"`
	Type                 string `json:"type"`
	InstanceCount        int    `json:"instanceCount"`
	AffectedStudentCount *int   `json:"affectedStudentCount"` // D11 — teacher view only; STRIPPED on /me
	Trend                string `json:"trend"`
	PatternSource        string `json:"patternSource"` // "human_comment" | "auto_graded" (D7)
}

// NewStudentPerfTestServerForRole mounts the two new student-analytics routes on the
// EXACT ungated dashboardChain (mirrors NewAnalyticsTestServerForRole / newAnalyticsSrv,
// story_8_2_helpers.go) with a caller whose JWT claims match `role`. The caller's
// center_members row (its DB role) is created by the test.
func NewStudentPerfTestServerForRole(
	t *testing.T,
	db storyDB,
	userID pgtype.UUID,
	centerID string,
	role string,
) http.Handler {
	t.Helper()
	markUserVerified(t, db, userID)
	tok := SignAccessTokenForRole(t, userID, centerID, role)
	return &authInjectingHandler{next: newStudentPerfSrv(t, db), token: tok}
}

func newStudentPerfSrv(t *testing.T, db storyDB) http.Handler {
	t.Helper()
	mux := http.NewServeMux()

	analyticsSvc := service.NewAnalyticsService(db, clock.RealClock{})
	analyticsHandler := handler.NewAnalyticsHandler(analyticsSvc, clock.RealClock{})

	extractTenant := middleware.ExtractTenant(db, jwtSigner())
	requireVerified := middleware.RequireVerifiedEmail()
	requireCenter := middleware.RequireCenterContext()
	chain := func(h middleware.HandlerWithError) http.Handler {
		return extractTenant(
			requireVerified(
				requireCenter(http.HandlerFunc(middleware.ErrorMapper(h))),
			),
		)
	}
	// SEAMS (dev — Task 6): analyticsHandler.GetStudent / .Me do not exist yet.
	mux.Handle("GET /api/analytics/students/{id}", chain(analyticsHandler.GetStudent))
	mux.Handle("GET /api/analytics/me", chain(analyticsHandler.Me))
	return mux
}

// spGetStudent drives GET /api/analytics/students/{id}; decodes the envelope on 200.
func spGetStudent(t *testing.T, srv http.Handler, studentID string) (*httptest.ResponseRecorder, *spStudentPerf) {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/api/analytics/students/"+studentID, nil)
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, req)
	return rec, spDecode(t, rec)
}

// spGetMe drives GET /api/analytics/me; decodes the envelope on 200.
func spGetMe(t *testing.T, srv http.Handler) (*httptest.ResponseRecorder, *spStudentPerf) {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/api/analytics/me", nil)
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, req)
	return rec, spDecode(t, rec)
}

func spDecode(t *testing.T, rec *httptest.ResponseRecorder) *spStudentPerf {
	t.Helper()
	var out spEnvelope
	if rec.Code == http.StatusOK {
		if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
			t.Fatalf("decode student-performance envelope: %v (body=%s)", err, rec.Body.String())
		}
	}
	return &out.Data
}

// spErrCode parses the {error:{code}} envelope (the body-code pin the D4 grid asserts).
func spErrCode(t *testing.T, body []byte) string {
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

// ── AC1 — owner/admin → 200 for ANY student in their center; framing "teacher" ──

func TestStudentPerf_OwnerAndAdmin_AnyCenterStudent_200_ATDD(t *testing.T) {
	db := SetupDB(t)
	center := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	_ = TenantContext(t, db, center.ID)
	cid := dashPGToUUID(t, center.ID)

	teacher := CreateUser(t, db, "t@center-a.test", "Teacher")
	CreateCenterMember(t, db, teacher.ID, center.ID, "teacher")
	class := seedClassWithTeacher(t, db, cid, dashPGToUUID(t, teacher.ID))
	studentID := dashSeedAtRiskStudent(t, db, cid, class, dashPGToUUID(t, teacher.ID), "s@center-a.test", "Subject Student")
	seedReleasedGrade(t, db, cid, class, studentID, dashPGToUUID(t, teacher.ID), "writing", 6.0)
	sidStr := studentID.String()

	for _, role := range []string{"owner", "admin"} {
		caller := CreateUser(t, db, role+"@center-a.test", "Caller "+role)
		CreateCenterMember(t, db, caller.ID, center.ID, role)
		srv := NewStudentPerfTestServerForRole(t, db, caller.ID, TenantAID, role)

		rec, resp := spGetStudent(t, srv, sidStr)
		if rec.Code != http.StatusOK {
			t.Fatalf("AC1: %s → /students/{id} must be 200, got %d (body=%s)", role, rec.Code, rec.Body.String())
		}
		if resp.Framing != "teacher" {
			t.Errorf("AC1: %s view framing = %q, want \"teacher\"", role, resp.Framing)
		}
		if resp.StudentID != sidStr {
			t.Errorf("AC1: %s view studentId = %q, want %q", role, resp.StudentID, sidStr)
		}
	}
}

// ── AC2 / AC22b — teacher own-class → 200; REAL other-teacher's student → 404 no-leak ──

func TestStudentPerf_TeacherScope_OwnStudent200_OtherTeacherStudent404_ATDD(t *testing.T) {
	db := SetupDB(t)
	center := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	_ = TenantContext(t, db, center.ID)
	cid := dashPGToUUID(t, center.ID)

	teacherA := CreateUser(t, db, "ta@center-a.test", "Teacher A")
	teacherB := CreateUser(t, db, "tb@center-a.test", "Teacher B")
	CreateCenterMember(t, db, teacherA.ID, center.ID, "teacher")
	CreateCenterMember(t, db, teacherB.ID, center.ID, "teacher")

	classA := seedClassWithTeacher(t, db, cid, dashPGToUUID(t, teacherA.ID))
	classB := seedClassWithTeacher(t, db, cid, dashPGToUUID(t, teacherB.ID))

	ownStudent := dashSeedAtRiskStudent(t, db, cid, classA, dashPGToUUID(t, teacherA.ID), "own@center-a.test", "OwnClassStudent")
	seedReleasedGrade(t, db, cid, classA, ownStudent, dashPGToUUID(t, teacherA.ID), "writing", 6.0)

	// A REAL student in teacher B's class in the SAME center (Murat C1 — not a random UUID).
	otherStudent := dashSeedAtRiskStudent(t, db, cid, classB, dashPGToUUID(t, teacherB.ID), "other@center-a.test", "OTHER_TEACHER_SENTINEL")
	seedReleasedGrade(t, db, cid, classB, otherStudent, dashPGToUUID(t, teacherB.ID), "writing", 7.0)

	srvA := NewStudentPerfTestServerForRole(t, db, teacherA.ID, TenantAID, "teacher")

	// Positive: teacher A's own-class student → 200.
	if rec, _ := spGetStudent(t, srvA, ownStudent.String()); rec.Code != http.StatusOK {
		t.Fatalf("AC2 positive: teacher A must get 200 for own-class student, got %d (body=%s)", rec.Code, rec.Body.String())
	}

	// Negative: a real out-of-scope student → 404 STUDENT_NOT_FOUND, no sentinel leak.
	recOOS, _ := spGetStudent(t, srvA, otherStudent.String())
	if recOOS.Code != http.StatusNotFound {
		t.Fatalf("AC2/AC22b: teacher A → other teacher's REAL student must be 404 (non-disclosure), got %d (body=%s)",
			recOOS.Code, recOOS.Body.String())
	}
	if code := spErrCode(t, recOOS.Body.Bytes()); code != "STUDENT_NOT_FOUND" {
		t.Errorf("AC2/AC22b: out-of-scope code = %q, want STUDENT_NOT_FOUND (never 403 — that would confirm existence)", code)
	}
	if strings.Contains(recOOS.Body.String(), "OTHER_TEACHER_SENTINEL") {
		t.Errorf("AC22b LEAK: the 404 body must contain NONE of the out-of-scope student's data — sentinel surfaced")
	}
}

// ── AC3 / AC22a — student → 403 INSUFFICIENT_ROLE for ANY id, INCLUDING their own ──

func TestStudentPerf_Student_Forbidden403_InclOwnId_ATDD(t *testing.T) {
	db := SetupDB(t)
	center := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	_ = TenantContext(t, db, center.ID)
	cid := dashPGToUUID(t, center.ID)

	teacher := CreateUser(t, db, "t@center-a.test", "Teacher")
	CreateCenterMember(t, db, teacher.ID, center.ID, "teacher")
	class := seedClassWithTeacher(t, db, cid, dashPGToUUID(t, teacher.ID))

	student := CreateUser(t, db, "s@center-a.test", "Student")
	CreateCenterMember(t, db, student.ID, center.ID, "student")
	insertEnrollmentRaw(t, db, cid, dashPGToUUID(t, student.ID), class, "active")

	other := CreateUser(t, db, "s2@center-a.test", "Other")
	CreateCenterMember(t, db, other.ID, center.ID, "student")

	srv := NewStudentPerfTestServerForRole(t, db, student.ID, TenantAID, "student")

	for _, tc := range []struct {
		name string
		id   string
	}{
		{"another student's id", UUIDString(other.ID)},
		{"their OWN id", UUIDString(student.ID)}, // AC3 — the "is this your own data?→allow" leak
	} {
		rec, _ := spGetStudent(t, srv, tc.id)
		if rec.Code != http.StatusForbidden {
			t.Fatalf("AC3/AC22a: student → /students/%s must be 403, got %d (body=%s)", tc.name, rec.Code, rec.Body.String())
		}
		if code := spErrCode(t, rec.Body.Bytes()); code != "INSUFFICIENT_ROLE" {
			t.Errorf("AC3/AC22a: student → /students/%s code = %q, want INSUFFICIENT_ROLE", tc.name, code)
		}
	}
}

// ── AC5 / AC6 — /me: student → 200 self (framing "student"); non-student → 403 ──

func TestStudentPerf_Me_StudentSelf200_NonStudent403_ATDD(t *testing.T) {
	db := SetupDB(t)
	center := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	_ = TenantContext(t, db, center.ID)
	cid := dashPGToUUID(t, center.ID)

	teacher := CreateUser(t, db, "t@center-a.test", "Teacher")
	CreateCenterMember(t, db, teacher.ID, center.ID, "teacher")
	class := seedClassWithTeacher(t, db, cid, dashPGToUUID(t, teacher.ID))
	student := dashSeedAtRiskStudent(t, db, cid, class, dashPGToUUID(t, teacher.ID), "s@center-a.test", "Self Student")
	seedReleasedGrade(t, db, cid, class, student, dashPGToUUID(t, teacher.ID), "writing", 6.5)

	// AC5: student /me → 200, framing "student", own id.
	sPG := pgtype.UUID{Bytes: student, Valid: true}
	srvS := NewStudentPerfTestServerForRole(t, db, sPG, TenantAID, "student")
	recS, respS := spGetMe(t, srvS)
	if recS.Code != http.StatusOK {
		t.Fatalf("AC5: student /me must be 200, got %d (body=%s)", recS.Code, recS.Body.String())
	}
	if respS.Framing != "student" {
		t.Errorf("AC5: /me framing = %q, want \"student\"", respS.Framing)
	}
	if respS.StudentID != student.String() {
		t.Errorf("AC5: /me studentId = %q, want self %q", respS.StudentID, student.String())
	}

	// AC6: non-student (teacher/owner/admin) /me → 403 INSUFFICIENT_ROLE.
	for _, role := range []string{"teacher", "owner", "admin"} {
		caller := CreateUser(t, db, "me-"+role+"@center-a.test", "Caller "+role)
		CreateCenterMember(t, db, caller.ID, center.ID, role)
		srv := NewStudentPerfTestServerForRole(t, db, caller.ID, TenantAID, role)
		rec, _ := spGetMe(t, srv)
		if rec.Code != http.StatusForbidden {
			t.Fatalf("AC6: %s /me must be 403, got %d (body=%s)", role, rec.Code, rec.Body.String())
		}
		if code := spErrCode(t, rec.Body.Bytes()); code != "INSUFFICIENT_ROLE" {
			t.Errorf("AC6: %s /me code = %q, want INSUFFICIENT_ROLE", role, code)
		}
	}
}

// ── AC4 — non-UUID {id} → 422 (handler uuid.Parse guard, mirrors 8-2a GetClass) ──

func TestStudentPerf_NonUUID_422_ATDD(t *testing.T) {
	db := SetupDB(t)
	center := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	_ = TenantContext(t, db, center.ID)

	owner := CreateUser(t, db, "owner@center-a.test", "Owner")
	CreateCenterMember(t, db, owner.ID, center.ID, "owner")
	srv := NewStudentPerfTestServerForRole(t, db, owner.ID, TenantAID, "owner")

	rec, _ := spGetStudent(t, srv, "not-a-uuid")
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("AC4: non-UUID id must be 422, got %d (body=%s)", rec.Code, rec.Body.String())
	}
}

// ── AC8/AC9/AC10 + R-6 — Overview-zone VALUES, not just JSON shape (Review P2) ──
// The zone was previously verified only by the sp* structs parsing; this drives the
// actual numbers: a dense per-skill band series whose gaps are null (NEVER 0), skill
// omission for un-graded skills, per-criterion null averages, gradedSubmissionCount,
// the per-zone hasData flags (content-driven after P6), and rate:null on zero past-due.
// Shares the suite's RealClock + fixedLoadNow(2026-09-01) seed window (grade at ~-23h is
// inside the dense 12-week axis).
func TestStudentPerf_OverviewZoneBehavior_ATDD(t *testing.T) {
	db := SetupDB(t)
	center := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	_ = TenantContext(t, db, center.ID)
	cid := dashPGToUUID(t, center.ID)

	teacher := CreateUser(t, db, "t@center-a.test", "Teacher")
	CreateCenterMember(t, db, teacher.ID, center.ID, "teacher")
	tID := dashPGToUUID(t, teacher.ID)
	class := seedClassWithTeacher(t, db, cid, tID)
	student := dashSeedAtRiskStudent(t, db, cid, class, tID, "s@center-a.test", "Subject")
	// Exactly ONE released Writing grade (band 6.0); NO reading grade, NO comments.
	const seededBand = 6.0
	seedReleasedGrade(t, db, cid, class, student, tID, "writing", seededBand)

	owner := CreateUser(t, db, "owner@center-a.test", "Owner")
	CreateCenterMember(t, db, owner.ID, center.ID, "owner")
	srv := NewStudentPerfTestServerForRole(t, db, owner.ID, TenantAID, "owner")

	rec, resp := spGetStudent(t, srv, student.String())
	if rec.Code != http.StatusOK {
		t.Fatalf("overview: /students/{id} must be 200, got %d (body=%s)", rec.Code, rec.Body.String())
	}

	// AC8 + R-6 — the Writing series is present and DENSE; the single graded week carries
	// the band, every OTHER week is null (never 0), and the un-graded Reading skill is
	// OMITTED (not a zero series).
	var writing *spSkillBandSeries
	for i := range resp.BandProgression {
		if resp.BandProgression[i].Skill == "writing" {
			writing = &resp.BandProgression[i]
		}
		if resp.BandProgression[i].Skill == "reading" {
			t.Errorf("AC8: an un-graded skill (reading) must be OMITTED from bandProgression, not a zero series")
		}
	}
	if writing == nil {
		t.Fatalf("AC8: bandProgression must contain the graded Writing skill series")
	}
	if len(writing.Points) < 2 {
		t.Fatalf("AC8: band series must be DENSE (multi-week axis), got %d point(s)", len(writing.Points))
	}
	nonNil := 0
	for _, p := range writing.Points {
		if p.AvgBand != nil {
			nonNil++
			if *p.AvgBand != seededBand {
				t.Errorf("AC8: graded week avgBand = %v, want %v", *p.AvgBand, seededBand)
			}
		}
	}
	// R-6: exactly ONE non-null week (the graded one); the rest null, NEVER 0 — a 0-fill
	// bug would make nonNil == len(points).
	if nonNil != 1 {
		t.Errorf("R-6/AC8: want exactly 1 non-null week (rest null, never 0), got %d of %d", nonNil, len(writing.Points))
	}

	// AC10 — gradedSubmissionCount is the released-grade count (the s37 "≥3 graded"
	// quantity, Sally), distinct from totalSubmissionCount.
	if resp.SubmissionStats.GradedSubmissionCount != 1 {
		t.Errorf("AC10: gradedSubmissionCount = %d, want 1", resp.SubmissionStats.GradedSubmissionCount)
	}

	// AC10 + P6 — per-zone hasData: grade-driven zones with data → true; the pattern zone
	// has NO comments/answer_errors → false (content-driven, not count-driven).
	hd := resp.SubmissionStats.HasData
	if !hd["bandProgression"] {
		t.Errorf("AC10: hasData.bandProgression must be true (a graded Writing week exists)")
	}
	if !hd["skillBreakdown"] {
		t.Errorf("AC10: hasData.skillBreakdown must be true (a released grade exists)")
	}
	if hd["mistakePatterns"] {
		t.Errorf("AC10/P6: hasData.mistakePatterns must be false (no comments/answer_errors seeded)")
	}

	// AC9 + R-6 — the Writing breakdown carries overallBand and its 4 criterion keys, each
	// with a NULL average (criterion_scores '{}' — null, never 0).
	var wb *spSkillBreakdown
	for i := range resp.SkillBreakdown {
		if resp.SkillBreakdown[i].Skill == "writing" {
			wb = &resp.SkillBreakdown[i]
		}
	}
	if wb == nil {
		t.Fatalf("AC9: skillBreakdown must contain the Writing skill")
	}
	if wb.OverallBand == nil || *wb.OverallBand != seededBand {
		t.Errorf("AC9: Writing overallBand = %v, want %v", wb.OverallBand, seededBand)
	}
	if len(wb.Criteria) != 4 {
		t.Errorf("AC9: Writing must carry its 4 criterion keys, got %d", len(wb.Criteria))
	}
	for _, c := range wb.Criteria {
		if c.AvgBand != nil {
			t.Errorf("R-6/AC9: criterion %q avg must be NULL (empty criterion_scores), got %v", c.Criterion, *c.AvgBand)
		}
	}

	// R-6 — rate is NULL when there is no past-due assignment (never 0.0).
	if resp.SubmissionStats.SubmissionRate.TotalDue == 0 && resp.SubmissionStats.SubmissionRate.Rate != nil {
		t.Errorf("R-6/AC10: submissionRate.rate must be NULL when totalDue==0, got %v", *resp.SubmissionStats.SubmissionRate.Rate)
	}
}
