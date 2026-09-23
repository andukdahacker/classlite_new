// analytics_class_performance_test.go — Story 8-2a green-phase correctness (Task 8).
//
// Service-level aggregation correctness with a fixed injected clock (deterministic
// weeks + trend windows, DR-B) and a UTC center tz (week math aligns with the UTC
// clock). Plus the serialized-null wire shape (D15c) through the real handler, and the
// per-read-source cross-tenant RLS grid (AC14 / TEST-BE-1). These need the green
// service to assert VALUES, so they are Task-8 inline tests, not ATDD reds.
package test

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/model"
	"github.com/ducdo/classlite-api/internal/service"
	"github.com/ducdo/classlite-api/internal/store/generated"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

// anTestNow is the fixed clock instant for the correctness cases. Week + trend windows
// derive from it; the center tz is forced to UTC so buckets align.
var anTestNow = time.Date(2026, 6, 17, 12, 0, 0, 0, time.UTC)

// setCenterTZUTC forces the center's timezone to UTC so the service's Monday-week
// bucketing aligns with the UTC anTestNow (centers is a global, non-RLS table).
func setCenterTZUTC(t *testing.T, db *TxDB, centerID uuid.UUID) {
	t.Helper()
	if _, err := db.Exec(context.Background(), `UPDATE centers SET timezone = 'UTC' WHERE id = $1`, centerID); err != nil {
		t.Fatalf("set center tz UTC: %v", err)
	}
}

// seedGradeAt builds exercise(skill)→assignment(deadline)→submission(graded,submitted)
// →grade(scores,comments,overall_band,released) with full control over the JSONB and
// the three timestamps. Tenant context set by the caller.
func seedGradeAt(
	t *testing.T, db *TxDB, centerID, classID, studentID, authorID uuid.UUID,
	skill string, overallBand float64, criterionScoresJSON, commentsJSON string,
	deadlineAt, submittedAt, releasedAt time.Time,
) {
	t.Helper()
	ctx := context.Background()
	exID, asID, subID := uuid.New(), uuid.New(), uuid.New()
	if _, err := db.Exec(ctx,
		`INSERT INTO exercises (id, center_id, created_by, code, title, skill) VALUES ($1,$2,$3,$4,'Ex',$5)`,
		exID, centerID, authorID, "EX-"+uuid.NewString()[:8], skill); err != nil {
		t.Fatalf("seedGradeAt exercise(%s): %v", skill, err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO assignments (id, center_id, exercise_id, class_id, created_by, deadline_at) VALUES ($1,$2,$3,$4,$5,$6)`,
		asID, centerID, exID, classID, authorID, deadlineAt); err != nil {
		t.Fatalf("seedGradeAt assignment: %v", err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO submissions (id, center_id, assignment_id, student_id, status, submitted_at) VALUES ($1,$2,$3,$4,'graded',$5)`,
		subID, centerID, asID, studentID, submittedAt); err != nil {
		t.Fatalf("seedGradeAt submission: %v", err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO grades (id, submission_id, center_id, graded_by, version, criterion_scores, overall_band, comments, released_at)
		 VALUES ($1,$2,$3,$4,1,$5::jsonb,$6,$7::jsonb,$8)`,
		uuid.New(), subID, centerID, authorID, criterionScoresJSON, overallBand, commentsJSON, releasedAt); err != nil {
		t.Fatalf("seedGradeAt grade: %v", err)
	}
}

// anClassPerf runs GetClassPerformance for `role` (own-class teacher) at the fixed
// clock and returns the payload.
func anClassPerf(t *testing.T, db *TxDB, userID, classID uuid.UUID, role string) *service.ClassPerformance {
	t.Helper()
	svc := service.NewAnalyticsService(db, clock.NewMockClock(anTestNow))
	tc := model.TenantContext{CenterID: TenantAID, UserID: userID.String(), Role: role, EmailVerified: true}
	cp, err := svc.GetClassPerformance(context.Background(), tc, classID)
	if err != nil {
		t.Fatalf("GetClassPerformance: %v", err)
	}
	return cp
}

func weeksAgo(n int) time.Time { return anTestNow.AddDate(0, 0, -7*n) }

// ── D15c — serialized-null wire shape (rate null, heatmap cell null, never 0) ──

func TestAnalyticsClass_SerializedNullShape(t *testing.T) {
	db := SetupDB(t)
	center := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	_ = TenantContext(t, db, center.ID)
	cid := dashPGToUUID(t, center.ID)
	setCenterTZUTC(t, db, cid)

	owner := CreateUser(t, db, "own@nullshape.test", "Owner")
	CreateCenterMember(t, db, owner.ID, center.ID, "owner")
	teacher := CreateUser(t, db, "t@nullshape.test", "Teacher")
	CreateCenterMember(t, db, teacher.ID, center.ID, "teacher")
	class := seedClassWithTeacher(t, db, cid, dashPGToUUID(t, teacher.ID))
	// Active student, but NO assignments/grades → totalDue 0, empty heatmap/bands.
	student := seedStudentMember(t, db, cid, "s@nullshape.test", "S")
	insertEnrollmentRaw(t, db, cid, student, class, "active")

	srv := NewAnalyticsTestServerForRole(t, db, owner.ID, TenantAID, "owner")
	rec := anGetClass(t, srv, class.String())
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d (%s)", rec.Code, rec.Body.String())
	}
	body := rec.Body.String()

	// D15/AC10 — explicit nulls, never 0, never omitted.
	if !strings.Contains(body, `"rate":null`) {
		t.Errorf("submissionRate.rate must serialize as null when totalDue=0 (division guard), body=%s", body)
	}
	if strings.Contains(body, `"rate":0`) {
		t.Errorf("submissionRate.rate must be null, NOT 0, at totalDue=0")
	}
	if !strings.Contains(body, `"onTimeSubmissionRate":null`) {
		t.Errorf("onTimeSubmissionRate must be null when totalDue=0")
	}
	// Heatmap dense cells present with null bands (never 0-band).
	if !strings.Contains(body, `"avgBand":null`) {
		t.Errorf("empty heatmap/band cells must carry avgBand:null (D15a), body=%s", body)
	}

	// Decode + structural checks: dense 12-week axis shared by bands + heatmap.
	var out struct {
		Data service.ClassPerformance `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode: %v", err)
	}
	cp := out.Data
	if len(cp.BandOverTime) != service.AnalyticsWeekWindow {
		t.Errorf("bandOverTime must be a dense %d-week axis, got %d", service.AnalyticsWeekWindow, len(cp.BandOverTime))
	}
	if len(cp.SkillHeatmap.Weeks) != service.AnalyticsWeekWindow {
		t.Errorf("heatmap weeks must be the dense %d-week axis, got %d", service.AnalyticsWeekWindow, len(cp.SkillHeatmap.Weeks))
	}
	// D15b — the SAME week axis for bands and heatmap.
	for i := range cp.BandOverTime {
		if cp.BandOverTime[i].WeekStart != cp.SkillHeatmap.Weeks[i] {
			t.Errorf("week axis mismatch at %d: band %q vs heatmap %q", i, cp.BandOverTime[i].WeekStart, cp.SkillHeatmap.Weeks[i])
		}
	}
	if len(cp.SkillHeatmap.Cells) != 4*service.AnalyticsWeekWindow {
		t.Errorf("heatmap must be a dense 4×%d grid, got %d cells", service.AnalyticsWeekWindow, len(cp.SkillHeatmap.Cells))
	}
	if cp.HasWritingContent {
		t.Errorf("hasWritingContent must be false — no Writing assignment (DR-D)")
	}
	if cp.CohortAvgBand != nil {
		t.Errorf("cohortAvgBand must be nil with no grades, got %v", *cp.CohortAvgBand)
	}
	// mistakePatterns block always labels covered sources (D16); D12 — auto_graded is now
	// mined too, so excludedSources is EMPTY (both Mistakes surfaces symmetric, AC14).
	if len(cp.MistakePatterns.CoveredSources) == 0 {
		t.Errorf("mistakePatterns must always label covered sources (D16)")
	}
	if len(cp.MistakePatterns.ExcludedSources) != 0 {
		t.Errorf("D12: class endpoint excludedSources must be [] now that auto_graded is mined, got %v", cp.MistakePatterns.ExcludedSources)
	}
}

// ── D13 — heatmap type-guard: a partial / non-numeric criterion never 500s ──

func TestAnalyticsClass_HeatmapTypeGuard(t *testing.T) {
	db := SetupDB(t)
	center := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	_ = TenantContext(t, db, center.ID)
	cid := dashPGToUUID(t, center.ID)
	setCenterTZUTC(t, db, cid)

	teacher := CreateUser(t, db, "t@guard.test", "Teacher")
	CreateCenterMember(t, db, teacher.ID, center.ID, "teacher")
	tID := dashPGToUUID(t, teacher.ID)
	class := seedClassWithTeacher(t, db, cid, tID)
	student := seedStudentMember(t, db, cid, "s@guard.test", "S")
	insertEnrollmentRaw(t, db, cid, student, class, "active")

	// A Writing grade with only 2 of 4 keys, one of them NON-NUMERIC (the D13 trap:
	// a bare ::numeric cast would throw 22P02 and 500 the whole heatmap).
	rel := weeksAgo(1)
	seedGradeAt(t, db, cid, class, student, tID, "writing", 6.0,
		`{"taskResponse":6.0,"coherenceCohesion":"N/A"}`,
		`[]`, rel.Add(-time.Hour), rel.Add(-2*time.Hour), rel)

	cp := anClassPerf(t, db, tID, class, "teacher") // must NOT 500/panic

	byKey := map[string]*service.SkillHeatmapCell{}
	for i := range cp.SkillHeatmap.Cells {
		c := &cp.SkillHeatmap.Cells[i]
		byKey[c.Criterion+"|"+c.WeekStart] = c
	}
	wk := cp.BandOverTime[len(cp.BandOverTime)-2].WeekStart // "one week ago" bucket
	// taskResponse present & numeric → avgBand 6.0, sample 1.
	if c := byKey["taskResponse|"+wk]; c == nil || c.AvgBand == nil || *c.AvgBand != 6.0 || c.SampleCount != 1 {
		t.Errorf("taskResponse cell should be 6.0/sample1, got %+v", c)
	}
	// coherenceCohesion present but NON-NUMERIC → null cell, sample 0 (survivor filter).
	if c := byKey["coherenceCohesion|"+wk]; c == nil || c.AvgBand != nil || c.SampleCount != 0 {
		t.Errorf("coherenceCohesion (non-numeric) must be null/sample0 (D13), got %+v", c)
	}
	// lexicalResource absent → null cell.
	if c := byKey["lexicalResource|"+wk]; c == nil || c.AvgBand != nil || c.SampleCount != 0 {
		t.Errorf("lexicalResource (absent) must be null/sample0, got %+v", c)
	}
	if !cp.HasWritingContent {
		t.Errorf("hasWritingContent must be true (a Writing assignment exists)")
	}
}

// ── DR-A — mistake co-gate: instanceCount>=3 AND affectedStudentCount>=2 ──

func TestAnalyticsClass_MistakeCoGateBoundary(t *testing.T) {
	db := SetupDB(t)
	center := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	_ = TenantContext(t, db, center.ID)
	cid := dashPGToUUID(t, center.ID)
	setCenterTZUTC(t, db, cid)

	teacher := CreateUser(t, db, "t@cogate.test", "Teacher")
	CreateCenterMember(t, db, teacher.ID, center.ID, "teacher")
	tID := dashPGToUUID(t, teacher.ID)
	class := seedClassWithTeacher(t, db, cid, tID)
	s1 := seedStudentMember(t, db, cid, "s1@cogate.test", "S1")
	s2 := seedStudentMember(t, db, cid, "s2@cogate.test", "S2")
	insertEnrollmentRaw(t, db, cid, s1, class, "active")
	insertEnrollmentRaw(t, db, cid, s2, class, "active")
	rel := weeksAgo(1)

	// Group A (lexicalResource/error): 2 instances / 2 students → instanceCount 2 (<3) → ABSENT.
	seedGradeAt(t, db, cid, class, s1, tID, "writing", 6.0, `{}`,
		`[{"type":"error","criterion":"lexicalResource","text":"a"}]`, rel, rel, rel)
	seedGradeAt(t, db, cid, class, s2, tID, "writing", 6.0, `{}`,
		`[{"type":"error","criterion":"lexicalResource","text":"a"}]`, rel, rel, rel)

	// Group B (taskResponse/error): 3 instances / 1 student → affectedStudentCount 1 (<2) → ABSENT.
	seedGradeAt(t, db, cid, class, s1, tID, "writing", 6.0, `{}`,
		`[{"type":"error","criterion":"taskResponse","text":"b"},{"type":"error","criterion":"taskResponse","text":"b"},{"type":"error","criterion":"taskResponse","text":"b"}]`,
		rel, rel, rel)

	// Group C (grammaticalRange/error): 4 instances / 2 students → SURFACED.
	seedGradeAt(t, db, cid, class, s1, tID, "writing", 6.0, `{}`,
		`[{"type":"error","criterion":"grammaticalRange","text":"c"},{"type":"error","criterion":"grammaticalRange","text":"c"}]`,
		rel, rel, rel)
	seedGradeAt(t, db, cid, class, s2, tID, "writing", 6.0, `{}`,
		`[{"type":"error","criterion":"grammaticalRange","text":"c"},{"type":"error","criterion":"grammaticalRange","text":"c"}]`,
		rel, rel, rel)

	cp := anClassPerf(t, db, tID, class, "teacher")
	if len(cp.MistakePatterns.Patterns) != 1 {
		t.Fatalf("co-gate: exactly 1 pattern (group C) should surface, got %d: %+v",
			len(cp.MistakePatterns.Patterns), cp.MistakePatterns.Patterns)
	}
	p := cp.MistakePatterns.Patterns[0]
	if p.Criterion != "grammaticalRange" || p.Type != "error" || p.SkillSource != "writing" {
		t.Errorf("surfaced pattern should be writing/grammaticalRange/error, got %+v", p)
	}
	// AffectedStudentCount is now a *int (teacher-only peer field, stripped on /me — D5/D11);
	// the class endpoint always populates it.
	if p.AffectedStudentCount == nil {
		t.Fatalf("class endpoint must expose affectedStudentCount (teacher peer field), got nil")
	}
	if p.InstanceCount != 4 || *p.AffectedStudentCount != 2 {
		t.Errorf("group C counts: want instance4/students2, got instance%d/students%d", p.InstanceCount, *p.AffectedStudentCount)
	}
	// D12 — the human-comment source is tagged patternSource.
	if p.PatternSource != "human_comment" {
		t.Errorf("writing/comment pattern patternSource = %q, want human_comment", p.PatternSource)
	}
}

// ── DR-B — trend: recent-4wk vs prior-4wk, clock-injected ──

func TestAnalyticsClass_MistakeTrend(t *testing.T) {
	db := SetupDB(t)
	center := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	_ = TenantContext(t, db, center.ID)
	cid := dashPGToUUID(t, center.ID)
	setCenterTZUTC(t, db, cid)

	teacher := CreateUser(t, db, "t@trend.test", "Teacher")
	CreateCenterMember(t, db, teacher.ID, center.ID, "teacher")
	tID := dashPGToUUID(t, teacher.ID)
	class := seedClassWithTeacher(t, db, cid, tID)
	s1 := seedStudentMember(t, db, cid, "s1@trend.test", "S1")
	s2 := seedStudentMember(t, db, cid, "s2@trend.test", "S2")
	insertEnrollmentRaw(t, db, cid, s1, class, "active")
	insertEnrollmentRaw(t, db, cid, s2, class, "active")

	recent := weeksAgo(1) // within [now-4wk, now)
	prior := weeksAgo(6)  // within [now-8wk, now-4wk)

	// worsening group (grammaticalRange/error): 2 recent (both students) + 1 prior → recent>prior.
	seedGradeAt(t, db, cid, class, s1, tID, "writing", 6.0, `{}`,
		`[{"type":"error","criterion":"grammaticalRange","text":"w"}]`, recent, recent, recent)
	seedGradeAt(t, db, cid, class, s2, tID, "writing", 6.0, `{}`,
		`[{"type":"error","criterion":"grammaticalRange","text":"w"}]`, recent, recent, recent)
	seedGradeAt(t, db, cid, class, s1, tID, "writing", 6.0, `{}`,
		`[{"type":"error","criterion":"grammaticalRange","text":"w"}]`, prior, prior, prior)

	// improving group (lexicalResource/error): 1 recent + 2 prior → recent<prior.
	seedGradeAt(t, db, cid, class, s1, tID, "writing", 6.0, `{}`,
		`[{"type":"error","criterion":"lexicalResource","text":"i"}]`, recent, recent, recent)
	seedGradeAt(t, db, cid, class, s1, tID, "writing", 6.0, `{}`,
		`[{"type":"error","criterion":"lexicalResource","text":"i"}]`, prior, prior, prior)
	seedGradeAt(t, db, cid, class, s2, tID, "writing", 6.0, `{}`,
		`[{"type":"error","criterion":"lexicalResource","text":"i"}]`, prior, prior, prior)

	cp := anClassPerf(t, db, tID, class, "teacher")
	got := map[string]string{}
	for _, p := range cp.MistakePatterns.Patterns {
		got[p.Criterion] = p.Trend
	}
	if got["grammaticalRange"] != service.MistakeTrendWorsening {
		t.Errorf("grammaticalRange trend: want worsening, got %q", got["grammaticalRange"])
	}
	if got["lexicalResource"] != service.MistakeTrendImproving {
		t.Errorf("lexicalResource trend: want improving, got %q", got["lexicalResource"])
	}
}

// ── D2/D3 — mixed Writing+Speaking: heatmap Writing-only, mistakes both ──

func TestAnalyticsClass_MixedWritingSpeaking(t *testing.T) {
	db := SetupDB(t)
	center := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	_ = TenantContext(t, db, center.ID)
	cid := dashPGToUUID(t, center.ID)
	setCenterTZUTC(t, db, cid)

	teacher := CreateUser(t, db, "t@mixed.test", "Teacher")
	CreateCenterMember(t, db, teacher.ID, center.ID, "teacher")
	tID := dashPGToUUID(t, teacher.ID)
	class := seedClassWithTeacher(t, db, cid, tID)
	s1 := seedStudentMember(t, db, cid, "s1@mixed.test", "S1")
	s2 := seedStudentMember(t, db, cid, "s2@mixed.test", "S2")
	insertEnrollmentRaw(t, db, cid, s1, class, "active")
	insertEnrollmentRaw(t, db, cid, s2, class, "active")
	rel := weeksAgo(1)

	// Writing grades with criterion scores + a writing mistake (3 instances / 2 students).
	seedGradeAt(t, db, cid, class, s1, tID, "writing", 6.5,
		`{"taskResponse":6.5,"coherenceCohesion":6.5,"lexicalResource":6.0,"grammaticalRange":6.5}`,
		`[{"type":"error","criterion":"taskResponse","text":"w"},{"type":"error","criterion":"taskResponse","text":"w"}]`,
		rel, rel, rel)
	seedGradeAt(t, db, cid, class, s2, tID, "writing", 6.0,
		`{"taskResponse":6.0,"coherenceCohesion":6.0,"lexicalResource":6.0,"grammaticalRange":6.0}`,
		`[{"type":"error","criterion":"taskResponse","text":"w"}]`,
		rel, rel, rel)

	// Speaking grades with a speaking mistake (3 instances / 2 students) — pronunciation
	// is NOT a Writing heatmap criterion, so it must be ABSENT from the heatmap.
	seedGradeAt(t, db, cid, class, s1, tID, "speaking", 7.0,
		`{"fluencyCoherence":7.0,"pronunciation":7.0}`,
		`[{"type":"error","criterion":"pronunciation","text":"s"},{"type":"error","criterion":"pronunciation","text":"s"}]`,
		rel, rel, rel)
	seedGradeAt(t, db, cid, class, s2, tID, "speaking", 6.5,
		`{"fluencyCoherence":6.5,"pronunciation":6.5}`,
		`[{"type":"error","criterion":"pronunciation","text":"s"}]`,
		rel, rel, rel)

	cp := anClassPerf(t, db, tID, class, "teacher")

	// Heatmap criteria = the 4 Writing keys ONLY (no pronunciation row).
	if strings.Join(cp.SkillHeatmap.Criteria, ",") != "taskResponse,coherenceCohesion,lexicalResource,grammaticalRange" {
		t.Errorf("heatmap criteria must be the 4 Writing keys, got %v", cp.SkillHeatmap.Criteria)
	}
	for _, c := range cp.SkillHeatmap.Cells {
		if c.Criterion == "pronunciation" || c.Criterion == "fluencyCoherence" {
			t.Errorf("Speaking criterion %q must NOT appear in the Writing heatmap", c.Criterion)
		}
	}
	// mistakePatterns includes BOTH sources.
	srcSeen := map[string]bool{}
	for _, p := range cp.MistakePatterns.Patterns {
		srcSeen[p.SkillSource] = true
	}
	if !srcSeen["writing"] || !srcSeen["speaking"] {
		t.Errorf("mistakePatterns must cover both writing and speaking, got %+v", cp.MistakePatterns.Patterns)
	}
}

// ── AC8 — deterministic total order (instanceCount DESC, skill, criterion, type) ──

func TestAnalyticsClass_MistakeDeterministicOrder(t *testing.T) {
	db := SetupDB(t)
	center := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	_ = TenantContext(t, db, center.ID)
	cid := dashPGToUUID(t, center.ID)
	setCenterTZUTC(t, db, cid)

	teacher := CreateUser(t, db, "t@order.test", "Teacher")
	CreateCenterMember(t, db, teacher.ID, center.ID, "teacher")
	tID := dashPGToUUID(t, teacher.ID)
	class := seedClassWithTeacher(t, db, cid, tID)
	s1 := seedStudentMember(t, db, cid, "s1@order.test", "S1")
	s2 := seedStudentMember(t, db, cid, "s2@order.test", "S2")
	insertEnrollmentRaw(t, db, cid, s1, class, "active")
	insertEnrollmentRaw(t, db, cid, s2, class, "active")
	rel := weeksAgo(1)

	comment := func(crit string, n int) string {
		parts := make([]string, n)
		for i := range parts {
			parts[i] = `{"type":"error","criterion":"` + crit + `","text":"x"}`
		}
		return "[" + strings.Join(parts, ",") + "]"
	}
	// grammaticalRange: 5 instances/2 students; taskResponse: 3 instances/2 students.
	seedGradeAt(t, db, cid, class, s1, tID, "writing", 6.0, `{}`, comment("grammaticalRange", 3), rel, rel, rel)
	seedGradeAt(t, db, cid, class, s2, tID, "writing", 6.0, `{}`, comment("grammaticalRange", 2), rel, rel, rel)
	seedGradeAt(t, db, cid, class, s1, tID, "writing", 6.0, `{}`, comment("taskResponse", 2), rel, rel, rel)
	seedGradeAt(t, db, cid, class, s2, tID, "writing", 6.0, `{}`, comment("taskResponse", 1), rel, rel, rel)

	cp := anClassPerf(t, db, tID, class, "teacher")
	if len(cp.MistakePatterns.Patterns) != 2 {
		t.Fatalf("want 2 patterns, got %d", len(cp.MistakePatterns.Patterns))
	}
	// instanceCount DESC → grammaticalRange (5) before taskResponse (3).
	if cp.MistakePatterns.Patterns[0].Criterion != "grammaticalRange" || cp.MistakePatterns.Patterns[1].Criterion != "taskResponse" {
		t.Errorf("deterministic order (instanceCount DESC) violated: %+v", cp.MistakePatterns.Patterns)
	}
}

// ── AC10 — submission rate: on-time strict, rate = onTime/totalDue ──

func TestAnalyticsClass_SubmissionRate(t *testing.T) {
	db := SetupDB(t)
	center := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	_ = TenantContext(t, db, center.ID)
	cid := dashPGToUUID(t, center.ID)
	setCenterTZUTC(t, db, cid)

	teacher := CreateUser(t, db, "t@rate.test", "Teacher")
	CreateCenterMember(t, db, teacher.ID, center.ID, "teacher")
	tID := dashPGToUUID(t, teacher.ID)
	class := seedClassWithTeacher(t, db, cid, tID)
	s1 := seedStudentMember(t, db, cid, "s1@rate.test", "S1")
	insertEnrollmentRaw(t, db, cid, s1, class, "active")
	rel := weeksAgo(1)
	deadline := rel
	// Enrolled BEFORE the assignment deadlines so the past-due assignments count
	// against the rate (P1: total_due guards deadline_at >= enrolled_at). The raw
	// helper defaults enrolled_at to wall-clock now(), which is after the mock clock.
	if _, err := db.Exec(context.Background(),
		`UPDATE enrollments SET enrolled_at = $1 WHERE student_id = $2 AND class_id = $3`,
		weeksAgo(4), s1, class); err != nil {
		t.Fatalf("backdate enrollment: %v", err)
	}

	// on-time (submitted before deadline).
	seedGradeAt(t, db, cid, class, s1, tID, "writing", 6.0, `{}`, `[]`, deadline, deadline.Add(-time.Hour), rel)
	// late (submitted after deadline) — counts in totalDue, NOT on-time.
	seedGradeAt(t, db, cid, class, s1, tID, "writing", 6.0, `{}`, `[]`, deadline, deadline.Add(time.Hour), rel)

	cp := anClassPerf(t, db, tID, class, "teacher")
	if cp.SubmissionRate.TotalDue != 2 || cp.SubmissionRate.OnTimeCount != 1 {
		t.Fatalf("want totalDue2/onTime1, got %+v", cp.SubmissionRate)
	}
	if cp.SubmissionRate.Rate == nil || *cp.SubmissionRate.Rate != 0.5 {
		t.Errorf("rate must be 0.5, got %v", cp.SubmissionRate.Rate)
	}
}

// ── AC14 / TEST-BE-1 — per-read-source cross-tenant isolation store grid ──
//
// Each analytics read source runs under Center A's tenant context against a Center B
// class id and must return ZERO rows (RLS blocks the sibling center's data) — a
// top-level 404 alone does not prove a sub-query cannot fan out cross-tenant. The
// positive control (Center A's own class) is asserted in the correctness tests above.

func TestAnalytics_CrossTenantPerReadSource(t *testing.T) {
	db := SetupDB(t)
	centerA := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	centerB := CreateCenterWithID(t, db, TenantBID, "Center B", "center-b")
	setCenterTZUTC(t, db, dashPGToUUID(t, centerA.ID))

	// Seed a fully-populated class in Center B (grades, criterion_scores, comments,
	// submissions, attendance) — every analytics read source has a sibling row.
	_ = TenantContext(t, db, centerB.ID)
	bcid := dashPGToUUID(t, centerB.ID)
	bTeacher := CreateUser(t, db, "t@b.test", "TB")
	CreateCenterMember(t, db, bTeacher.ID, centerB.ID, "teacher")
	bTID := dashPGToUUID(t, bTeacher.ID)
	classB := seedClassWithTeacher(t, db, bcid, bTID)
	bStudent := dashSeedAtRiskStudent(t, db, bcid, classB, bTID, "sb@b.test", "B_SENTINEL") // attendance rows
	rel := weeksAgo(1)
	seedGradeAt(t, db, bcid, classB, bStudent, bTID, "writing", 8.0,
		`{"taskResponse":8.0,"coherenceCohesion":8.0,"lexicalResource":8.0,"grammaticalRange":8.0}`,
		`[{"type":"error","criterion":"taskResponse","text":"b"},{"type":"error","criterion":"taskResponse","text":"b"},{"type":"error","criterion":"taskResponse","text":"b"}]`,
		rel, rel.Add(-time.Hour), rel)

	// Switch to Center A's tenant context and probe every source with Center B's class id.
	ctx := TenantContext(t, db, centerA.ID)
	q := generated.New(db)
	classBpg := pgUUIDForTest(classB)
	tz := "UTC"
	rangeStart := anPGTS(anTestNow.AddDate(0, 0, -13*7))
	rangeEnd := anPGTS(anTestNow.AddDate(0, 0, 7))
	now := anPGTS(anTestNow)

	if rows, err := q.ListClassBandOverTime(ctx, generated.ListClassBandOverTimeParams{
		Tz: tz, ClassID: classBpg, RangeStart: rangeStart, RangeEnd: rangeEnd,
	}); err != nil || len(rows) != 0 {
		t.Errorf("bandOverTime cross-tenant leak: err=%v rows=%d (want 0)", err, len(rows))
	}
	if rows, err := q.ListClassSkillHeatmap(ctx, generated.ListClassSkillHeatmapParams{
		Tz: tz, ClassID: classBpg, RangeStart: rangeStart, RangeEnd: rangeEnd,
	}); err != nil || len(rows) != 0 {
		t.Errorf("heatmap cross-tenant leak: err=%v rows=%d (want 0)", err, len(rows))
	}
	if rows, err := q.ListClassMistakePatterns(ctx, generated.ListClassMistakePatternsParams{
		RangeStart: rangeStart, RecentStart: rangeStart, PriorStart: rangeStart, ClassID: classBpg,
	}); err != nil || len(rows) != 0 {
		t.Errorf("mistakePatterns cross-tenant leak: err=%v rows=%d (want 0)", err, len(rows))
	}
	if row, err := q.GetClassSubmissionRate(ctx, generated.GetClassSubmissionRateParams{
		ClassID: classBpg, Now: now,
	}); err != nil || row.TotalDue != 0 {
		t.Errorf("submissionRate cross-tenant leak: err=%v totalDue=%d (want 0)", err, row.TotalDue)
	}
	if rows, err := q.ListClassStudentsAtRiskInputs(ctx, generated.ListClassStudentsAtRiskInputsParams{
		Now: now, ClassID: classBpg, ScanLimit: service.AnalyticsAtRiskScanCap,
	}); err != nil || len(rows) != 0 {
		t.Errorf("atRiskInputs cross-tenant leak: err=%v rows=%d (want 0)", err, len(rows))
	}
	// GetClassForAnalytics must also not disclose Center B's class (drives the 404).
	if _, err := q.GetClassForAnalytics(ctx, classBpg); err == nil {
		t.Errorf("GetClassForAnalytics cross-tenant leak: Center B class visible to Center A")
	}
}

// anPGTS wraps a time as a Valid pgtype.Timestamptz for the store-grid calls.
func anPGTS(tm time.Time) pgtype.Timestamptz { return pgtype.Timestamptz{Time: tm, Valid: true} }
