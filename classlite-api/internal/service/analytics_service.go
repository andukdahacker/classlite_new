// Package service — Story 8.2a AnalyticsService: the two role-scoped analytics
// reads. The SECOND consumer of the Epic-8 R31/PERF-2 keystone (CountingDBTX +
// dashExplainNoSeqScan, built in 8-1a) — it reuses the harnesses UNCHANGED and the
// dashboard's role-branch-in-service + teacherScope + center-tz week-bucketing
// idioms.
//
//	GET /api/analytics                 GetHome           — analyzable class list + mini-stats
//	GET /api/analytics/classes/{id}    GetClassPerformance — cohort perf payload
//
// Seams honored:
//   - ONE tx per request with SET LOCAL app.current_tenant_id BEFORE the first
//     current_grades touch, so RLS tenant-scopes every joined table (GO-1 / PERF-1 /
//     W2 — the security_invoker view returns empty otherwise). Reads only.
//   - Role/scope enforced IN the service (D4): home student → 403 INSUFFICIENT_ROLE;
//     class student / teacher-not-owner → 404 CLASS_NOT_FOUND (non-disclosure), and
//     the 404 PRECEDES any aggregation (AC13). teacherScope narg: teacher ⇒ own
//     classes; owner/admin ⇒ NULL (center-wide) — the exact 8-1a branch.
//   - At-risk is the clock-injected AtRiskDetector, reused UNCHANGED (D5): the whole
//     student set is classified in Go from the LATERAL input columns — NO per-student
//     N+1 (PERF-2/W2).
//   - Every week/window binds the injected clock (D8); week boundaries are bucketed
//     in centers.timezone (never UTC), computed in Go and passed as sargable UTC
//     instants. @now is ALWAYS a bound arg, never SQL now().
package service

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/model"
	"github.com/ducdo/classlite-api/internal/service/grading"
	"github.com/ducdo/classlite-api/internal/store"
	"github.com/ducdo/classlite-api/internal/store/generated"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

// Analytics tuning constants (CQ-3 — no magic values; the ≤N query-count harness and
// the aggregates read these).
const (
	// AnalyticsWeekWindow is the length of the dense, contiguous Monday-anchored week
	// axis shared by bandOverTime and skillHeatmap (D15b). 12 weeks ≈ a term.
	AnalyticsWeekWindow = 12
	// AnalyticsAtRiskScanCap bounds how many of a class's students the at-risk query
	// scans and classifies in one set-based pass (W2). atRiskCount is the at-risk
	// total within this scan scope (AC9).
	AnalyticsAtRiskScanCap = 500
	// AnalyticsHomeClassCap bounds the home class list for a center (D10). A center
	// beyond this cap is a future pagination concern (mirrors 8-1a's scan caps).
	AnalyticsHomeClassCap = 200
	// MinPatternInstances is the instanceCount floor a mistake group must reach to
	// surface (D11/DR-A).
	MinPatternInstances = 3
	// MinPatternStudents is the distinct-student floor a mistake group must reach to
	// surface — "class-wide" means genuinely multi-student, not one chatty student
	// (DR-A).
	MinPatternStudents = 2
	// mistakeSourceAutoGraded is the patternSource value for objective (reading/listening)
	// answer_errors rows; the criterion alias carries the questionType for these (D-COFINAL).
	mistakeSourceAutoGraded = "auto_graded"
	// AnalyticsTrendWindowWeeks is the recent/prior window size for the mistake trend
	// (DR-B): recent = [now-4wk, now), prior = [now-8wk, now-4wk).
	AnalyticsTrendWindowWeeks = 4
)

// Mistake trend values (DR-B) and mined-source labels (D16).
const (
	MistakeTrendImproving = "improving"
	MistakeTrendWorsening = "worsening"
	MistakeTrendStable    = "stable"
)

// analyticsCoveredSources / analyticsExcludedSources label the mistake basis (D16/D12)
// so the FE knows which skills the Mistakes surface mines. Since D12 both endpoints now
// UNION the auto_graded answer_errors source (reading/listening) alongside the
// human-comment source (writing/speaking), so ALL four skills are covered and NOTHING
// is excluded — both Mistakes surfaces report identical coverage (AC14, no two-truths
// asymmetry). excludedSources is a non-nil empty slice so it marshals to `[]`, not null.
var (
	analyticsCoveredSources  = []string{"writing", "speaking", "reading", "listening"}
	analyticsExcludedSources = []string{}
)

// analyticsWritingCriteria is the four Writing criterion keys, in the heatmap row
// order (D2). Single-sourced from the grading domain (criterion_scores JSONB keys).
var analyticsWritingCriteria = []string{
	grading.CriterionTaskResponse,
	grading.CriterionCoherenceCohesion,
	grading.CriterionLexicalResource,
	grading.CriterionGrammaticalRange,
}

// analyticsSpeakingCriteria is the four Speaking criterion keys (8-3a skill breakdown).
// Single-sourced from the grading domain (LexicalResource/GrammaticalRange are shared
// with Writing; FluencyCoherence/Pronunciation are Speaking-only).
var analyticsSpeakingCriteria = []string{
	grading.CriterionFluencyCoherence,
	grading.CriterionLexicalResource,
	grading.CriterionGrammaticalRange,
	grading.CriterionPronunciation,
}

// ---------------- Response DTOs (camelCase; GO-5 explicit null; D9 PROVISIONAL) ----------------

// AnalyticsHome is the role-scoped analytics home (AC2/AC3). Role ∈ {teacher, admin,
// owner}; a student never reaches this shape (403, D4).
type AnalyticsHome struct {
	Role    string                  `json:"role"`
	Classes []AnalyticsClassSummary `json:"classes"`
}

// AnalyticsClassSummary is one analyzable class + mini-stats.
type AnalyticsClassSummary struct {
	ClassID      string   `json:"classId"`
	ClassName    string   `json:"className"`
	StudentCount int      `json:"studentCount"`
	AvgBand      *float64 `json:"avgBand"`
	AtRiskCount  int      `json:"atRiskCount"`
	OnTimeRate   *float64 `json:"onTimeRate"`
}

// ClassPerformance is the role-agnostic class-performance payload (AC5). Access is
// gated at the endpoint, not by shape.
type ClassPerformance struct {
	ClassID              string                `json:"classId"`
	ClassName            string                `json:"className"`
	TargetBand           *float64              `json:"targetBand"`
	CohortAvgBand        *float64              `json:"cohortAvgBand"`
	CohortAvgDelta       *float64              `json:"cohortAvgDelta"`
	OnTimeSubmissionRate *float64              `json:"onTimeSubmissionRate"`
	AtRiskCount          int                   `json:"atRiskCount"`
	HasWritingContent    bool                  `json:"hasWritingContent"`
	BandOverTime         []BandOverTimePoint   `json:"bandOverTime"`
	SkillHeatmap         SkillHeatmap          `json:"skillHeatmap"`
	MistakePatterns      MistakePatterns       `json:"mistakePatterns"`
	AtRiskStudents       []AnalyticsAtRiskItem `json:"atRiskStudents"`
	SubmissionRate       SubmissionRate        `json:"submissionRate"`
}

// BandOverTimePoint is one week on the dense cohort band sparkline (D15b).
type BandOverTimePoint struct {
	WeekStart       string   `json:"weekStart"`
	AvgBand         *float64 `json:"avgBand"`
	SubmissionCount int      `json:"submissionCount"`
}

// SkillHeatmap is the Writing-criteria × week matrix (D2). NO colour in the payload.
type SkillHeatmap struct {
	Criteria []string           `json:"criteria"`
	Weeks    []string           `json:"weeks"`
	Cells    []SkillHeatmapCell `json:"cells"`
}

// SkillHeatmapCell is one (criterion, week) cell. Empty/invalid → AvgBand nil,
// SampleCount 0 (D13/D15a — never 0-band).
type SkillHeatmapCell struct {
	Criterion   string   `json:"criterion"`
	WeekStart   string   `json:"weekStart"`
	AvgBand     *float64 `json:"avgBand"`
	SampleCount int      `json:"sampleCount"`
}

// MistakePatterns is the labeled mistake block (D16).
type MistakePatterns struct {
	CoveredSources  []string         `json:"coveredSources"`
	ExcludedSources []string         `json:"excludedSources"`
	Patterns        []MistakePattern `json:"patterns"`
}

// MistakePattern is one repetitive-mistake group past the co-gate (DR-A). Reused by the
// class endpoint (8-2a) AND the per-student endpoints (8-3a). SkillSource widens to
// writing|speaking|reading|listening (D7/D12). PatternSource discriminates the mining
// basis: "human_comment" (writing/speaking teacher comments) vs "auto_graded"
// (reading/listening answer_errors — quote-less, so the FE renders warm generic copy).
// AffectedStudentCount is a teacher-only peer field: present on the class endpoint and
// the teacher /students/{id} view, STRIPPED (nil) on /me (FR-50 — D5/D11).
type MistakePattern struct {
	SkillSource          string  `json:"skillSource"`
	Criterion            string  `json:"criterion"`
	QuestionType         string  `json:"questionType"`
	Type                 string  `json:"type"`
	InstanceCount        int     `json:"instanceCount"`
	AffectedStudentCount *int    `json:"affectedStudentCount"`
	Trend                string  `json:"trend"`
	PatternSource        string  `json:"patternSource"`
	ExampleQuote         *string `json:"exampleQuote"`
	ExampleNote          *string `json:"exampleNote"`
}

// mistakeCriterionSplit reinterprets the SQL `criterion` alias per patternSource
// (D-COFINAL). The SQL puts the IELTS criterion there for human_comment rows and the
// objective questionType there for auto_graded rows; the wire contract splits them into
// two fields so the FE label falls back to questionType when criterion is "" (Winston #2).
// Go-only — no SQL/sqlc change to the alias.
func mistakeCriterionSplit(patternSource, aliasCriterion string) (criterion, questionType string) {
	if patternSource == mistakeSourceAutoGraded {
		return "", aliasCriterion
	}
	return aliasCriterion, ""
}

// mistakeExampleQuote converts the sqlc-untyped example_quote aggregate (interface{} —
// max() over a UNION-derived text column; a string for a mined human_comment body, nil for
// the all-NULL auto_graded group) into a nullable string pointer (GO-5 null on absence).
func mistakeExampleQuote(raw interface{}) *string {
	if s, ok := raw.(string); ok && s != "" {
		return &s
	}
	return nil
}

// AnalyticsAtRiskItem is one at-risk student in the class (D5).
type AnalyticsAtRiskItem struct {
	StudentID      string   `json:"studentId"`
	Name           string   `json:"name"`
	AttendanceRate *float64 `json:"attendanceRate"`
	OverallBand    *float64 `json:"overallBand"`
	Reasons        []string `json:"reasons"`
}

// SubmissionRate is the class-wide on-time rate (AC10). Rate is nil when TotalDue is 0.
type SubmissionRate struct {
	OnTimeCount int      `json:"onTimeCount"`
	TotalDue    int      `json:"totalDue"`
	Rate        *float64 `json:"rate"`
}

// ---------------- Student performance DTOs (8-3a; camelCase; GO-5 null; D7 PROVISIONAL) ----------------

// Framing discriminates the two views over the SAME builder (D5): "teacher" carries the
// peer fields (classAvgBand, affectedStudentCount); "student" (/me) STRIPS them (FR-50).
const (
	framingTeacher = "teacher"
	framingStudent = "student"
)

// StudentPerformance is the per-student analytics payload (FR-49/FR-50, D7 PROVISIONAL).
// The teacher /students/{id} and the student /me views share this shape; /me sets
// framing "student" and strips every peer/class-average field (a DATA guarantee, not a
// UI concern). NO recommendations field (deferred to 8-3c, D2).
type StudentPerformance struct {
	StudentID       string                 `json:"studentId"`
	StudentName     string                 `json:"studentName"`
	Framing         string                 `json:"framing"`
	ClassID         *string                `json:"classId"`
	TargetBand      *float64               `json:"targetBand"`
	SubmissionStats StudentSubmissionStats `json:"submissionStats"`
	SkillBreakdown  []SkillBreakdown       `json:"skillBreakdown"`
	BandProgression []SkillBandSeries      `json:"bandProgression"`
	MistakePatterns MistakePatterns        `json:"mistakePatterns"`
}

// SkillBandSeries is one skill's dense weekly overall-band progression (AC8). Points
// reuse BandOverTimePoint (dense weeks, avgBand null on an empty week). A skill with no
// released grades is omitted entirely (not a zero series).
type SkillBandSeries struct {
	Skill  string              `json:"skill"`
	Points []BandOverTimePoint `json:"points"`
}

// SkillBreakdown is one skill's current standing (AC9). OverallBand = the latest released
// overall band for the skill. ClassAvgBand = the cohort average for the student's resolved
// class (D11) — a teacher-only peer field, STRIPPED (nil) on /me. Criteria = per-criterion
// averages for Writing/Speaking only (reading/listening → empty).
type SkillBreakdown struct {
	Skill        string              `json:"skill"`
	OverallBand  *float64            `json:"overallBand"`
	ClassAvgBand *float64            `json:"classAvgBand"`
	Criteria     []SkillCriterionAvg `json:"criteria"`
}

// SkillCriterionAvg is one IELTS criterion's average band for a skill (AC9). AvgBand null
// when no numeric criterion value was recorded.
type SkillCriterionAvg struct {
	Criterion string   `json:"criterion"`
	AvgBand   *float64 `json:"avgBand"`
}

// StudentSubmissionStats is the student's own submission zone (AC10). GradedSubmissionCount
// (released grades) is the s37 ghosted-frame "≥3 graded" threshold quantity — DISTINCT from
// TotalSubmissionCount (Sally). HasData carries per-zone flags so the FE dims each ghosted
// zone independently rather than inferring emptiness.
type StudentSubmissionStats struct {
	SubmissionRate        SubmissionRate  `json:"submissionRate"`
	TotalSubmissionCount  int             `json:"totalSubmissionCount"`
	GradedSubmissionCount int             `json:"gradedSubmissionCount"`
	PraisePinCount        int             `json:"praisePinCount"`
	ErrorPinCount         int             `json:"errorPinCount"`
	HasData               map[string]bool `json:"hasData"`
}

// ---------------- Service ----------------

// AnalyticsService composes the role-scoped analytics reads.
type AnalyticsService struct {
	db       AuthDB
	clk      clock.Clock
	detector *AtRiskDetector
}

// NewAnalyticsService constructs an AnalyticsService. The detector shares the injected
// clock so a fixed test clock drives every window deterministically (D8/DR-B).
func NewAnalyticsService(db AuthDB, clk clock.Clock) *AnalyticsService {
	if clk == nil {
		clk = clock.RealClock{}
	}
	return &AnalyticsService{
		db:       db,
		clk:      clk,
		detector: NewAtRiskDetector(clk),
	}
}

// GetHome returns the caller's analyzable class list + mini-stats (AC2/AC3/AC4). A
// student is refused with 403 INSUFFICIENT_ROLE (D4). Exactly two set-based queries,
// no per-class/per-student N+1 (W1).
func (s *AnalyticsService) GetHome(ctx context.Context, tc model.TenantContext) (*AnalyticsHome, error) {
	switch tc.Role {
	case model.RoleTeacher, model.RoleOwner, model.RoleAdmin:
		// proceed
	default:
		// Student (and any unknown role) → 403 INSUFFICIENT_ROLE (D4). The mapper
		// renders INSUFFICIENT_ROLE only for exactly this Reason string.
		return nil, &ForbiddenError{Reason: "insufficient role"}
	}

	centerUUID, callerUUID, err := parseTenant(tc)
	if err != nil {
		return nil, err
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("analytics home: begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }()
	if err := store.SetTenantContext(ctx, tx, tc); err != nil {
		return nil, fmt.Errorf("analytics home: %w", err)
	}
	q := generated.New(tx)

	teacherScope := analyticsTeacherScope(tc.Role, callerUUID)
	centerPg := pgUUID(centerUUID)
	nowTS := dashTS(s.clk.Now())

	classRows, err := q.ListAnalyticsHomeClasses(ctx, generated.ListAnalyticsHomeClassesParams{
		CenterID:   centerPg,
		TeacherID:  teacherScope,
		Now:        nowTS,
		ClassLimit: AnalyticsHomeClassCap,
	})
	if err != nil {
		return nil, fmt.Errorf("analytics home: classes: %w", err)
	}

	// atRiskCount per class — one set-based query over (class, student) at-risk inputs,
	// classified in Go and tallied per class (D5, no N+1). Per-class scan cap matches
	// the class endpoint so a class's atRiskCount agrees across both surfaces.
	atRiskRows, err := q.ListAnalyticsHomeAtRiskInputs(ctx, generated.ListAnalyticsHomeAtRiskInputsParams{
		Now:       nowTS,
		CenterID:  centerPg,
		TeacherID: teacherScope,
		ScanLimit: AnalyticsAtRiskScanCap,
	})
	if err != nil {
		return nil, fmt.Errorf("analytics home: at-risk inputs: %w", err)
	}
	atRiskByClass := make(map[string]int, len(classRows))
	for _, r := range atRiskRows {
		res := s.detector.Classify(AtRiskInputs{
			AttendancePresentLate: int(r.AttendancePresentLate),
			AttendanceTotalMarked: int(r.AttendanceTotalMarked),
			ConsecutiveMissed:     int(r.ConsecutiveMissed),
			RecentReleasedBands:   r.RecentReleasedBands,
			OverallBand:           numericToFloatPtr(r.OverallBand),
			ClassTargetBand:       numericToFloatPtr(r.ClassTargetBand),
		})
		if res.Status == AtRiskStatusAtRisk {
			atRiskByClass[uuidFromPg(r.ClassID).String()]++
		}
	}

	classes := make([]AnalyticsClassSummary, 0, len(classRows))
	for _, r := range classRows {
		classID := uuidFromPg(r.ClassID).String()
		classes = append(classes, AnalyticsClassSummary{
			ClassID:      classID,
			ClassName:    r.ClassName,
			StudentCount: int(r.StudentCount),
			AvgBand:      numericToFloatPtr(r.AvgBand),
			AtRiskCount:  atRiskByClass[classID],
			OnTimeRate:   safeRate(r.OnTimeCount, r.TotalDue),
		})
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("analytics home: commit: %w", err)
	}
	return &AnalyticsHome{Role: tc.Role, Classes: classes}, nil
}

// GetClassPerformance returns the class-performance payload (AC5-10). A student, or a
// teacher who does not teach the class, gets 404 CLASS_NOT_FOUND (non-disclosure, D4)
// — the 404 precedes all aggregation (AC13).
func (s *AnalyticsService) GetClassPerformance(ctx context.Context, tc model.TenantContext, classID uuid.UUID) (*ClassPerformance, error) {
	// A student has NO class analytics — 404 (non-disclosure) BEFORE any DB touch
	// (D4/AC12; distinct from the home's 403).
	if tc.Role == model.RoleStudent {
		return nil, model.NotFoundError{Resource: "class", ID: classID.String(), Code: "CLASS_NOT_FOUND"}
	}

	centerUUID, callerUUID, err := parseTenant(tc)
	if err != nil {
		return nil, err
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("analytics class: begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }()
	if err := store.SetTenantContext(ctx, tx, tc); err != nil {
		return nil, fmt.Errorf("analytics class: %w", err)
	}
	q := generated.New(tx)
	classPg := pgUUID(classID)

	// Class auth (SEC-1 — DB-authoritative ownership). RLS scopes classes to the
	// caller's center, so a cross-tenant id is already ErrNoRows → 404 (AC14).
	class, err := q.GetClassForAnalytics(ctx, classPg)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, model.NotFoundError{Resource: "class", ID: classID.String(), Code: "CLASS_NOT_FOUND"}
		}
		return nil, fmt.Errorf("analytics class: load class: %w", err)
	}
	switch tc.Role {
	case model.RoleTeacher:
		if !class.TeacherID.Valid || uuidFromPg(class.TeacherID) != callerUUID {
			// Teacher-not-owner → 404 (non-disclosure, AC11/AC13). No rows computed.
			return nil, model.NotFoundError{Resource: "class", ID: classID.String(), Code: "CLASS_NOT_FOUND"}
		}
	case model.RoleOwner, model.RoleAdmin:
		// any class in the center (RLS-scoped) is analyzable.
	default:
		// Unknown/future non-student role → 404 non-disclosure. Allowlist, mirroring
		// GetHome — never fall through to center-wide analytics for a role we do not
		// explicitly authorize (SEC-1). Student was already refused above.
		return nil, model.NotFoundError{Resource: "class", ID: classID.String(), Code: "CLASS_NOT_FOUND"}
	}

	tz, err := q.GetCenterTimezone(ctx, pgUUID(centerUUID))
	if err != nil {
		return nil, fmt.Errorf("analytics class: center timezone: %w", err)
	}
	axis := s.weekAxis(tz)

	// bandOverTime — cohort avg band per week, densified onto the shared axis (D15b).
	botRows, err := q.ListClassBandOverTime(ctx, generated.ListClassBandOverTimeParams{
		Tz:         axis.tz,
		ClassID:    classPg,
		RangeStart: dashTS(axis.rangeStart),
		RangeEnd:   dashTS(axis.rangeEnd),
	})
	if err != nil {
		return nil, fmt.Errorf("analytics class: band over time: %w", err)
	}
	bandOverTime, cohortAvgBand, cohortAvgDelta := s.densifyBandOverTime(axis, botRows)

	// skillHeatmap — Writing-criteria × week, densified onto the SAME axis (D2/D13/D15).
	heatRows, err := q.ListClassSkillHeatmap(ctx, generated.ListClassSkillHeatmapParams{
		Tz:         axis.tz,
		ClassID:    classPg,
		RangeStart: dashTS(axis.rangeStart),
		RangeEnd:   dashTS(axis.rangeEnd),
	})
	if err != nil {
		return nil, fmt.Errorf("analytics class: skill heatmap: %w", err)
	}
	heatmap := s.densifyHeatmap(axis, heatRows)

	// mistakePatterns — mined from released grades.comments (D3/D11/D14), co-gated (DR-A).
	mistakeRows, err := q.ListClassMistakePatterns(ctx, generated.ListClassMistakePatternsParams{
		RangeStart:  dashTS(axis.rangeStart),
		RecentStart: dashTS(axis.recentStart),
		PriorStart:  dashTS(axis.priorStart),
		ClassID:     classPg,
	})
	if err != nil {
		return nil, fmt.Errorf("analytics class: mistakes: %w", err)
	}
	mistakes := buildMistakePatterns(mistakeRows)

	// submissionRate — class-wide on-time (AC10). Rate nil when totalDue == 0.
	rateRow, err := q.GetClassSubmissionRate(ctx, generated.GetClassSubmissionRateParams{
		ClassID: classPg,
		Now:     dashTS(s.clk.Now()),
	})
	if err != nil {
		return nil, fmt.Errorf("analytics class: submission rate: %w", err)
	}
	submissionRate := SubmissionRate{
		OnTimeCount: int(rateRow.OnTimeCount),
		TotalDue:    int(rateRow.TotalDue),
		Rate:        safeRate(rateRow.OnTimeCount, rateRow.TotalDue),
	}

	// atRiskStudents — classify the class's students in Go (D5, no N+1).
	arRows, err := q.ListClassStudentsAtRiskInputs(ctx, generated.ListClassStudentsAtRiskInputsParams{
		Now:       dashTS(s.clk.Now()),
		ClassID:   classPg,
		ScanLimit: AnalyticsAtRiskScanCap,
	})
	if err != nil {
		return nil, fmt.Errorf("analytics class: at-risk: %w", err)
	}
	atRiskStudents, atRiskCount := s.buildAtRisk(arRows)

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("analytics class: commit: %w", err)
	}

	return &ClassPerformance{
		ClassID:              uuidFromPg(class.ClassID).String(),
		ClassName:            class.ClassName,
		TargetBand:           numericToFloatPtr(class.TargetBand),
		CohortAvgBand:        cohortAvgBand,
		CohortAvgDelta:       cohortAvgDelta,
		OnTimeSubmissionRate: submissionRate.Rate,
		AtRiskCount:          atRiskCount,
		HasWritingContent:    class.HasWritingContent,
		BandOverTime:         bandOverTime,
		SkillHeatmap:         heatmap,
		MistakePatterns:      mistakes,
		AtRiskStudents:       atRiskStudents,
		SubmissionRate:       submissionRate,
	}, nil
}

// ---------------- student performance (8-3a) ----------------

// GetStudentPerformance returns one student's performance for a teacher/owner/admin
// (AC1-4, D4). owner/admin → any student in the center; teacher → only students in their
// OWN classes (analyticsTeacherScope), an out-of-scope/unknown student → 404
// STUDENT_NOT_FOUND (non-disclosure); a student caller → 403 INSUFFICIENT_ROLE (they use
// /me — this endpoint never returns a body to a student, even for their own id). The
// framing is always "teacher": the peer fields (classAvgBand, affectedStudentCount) are
// present.
func (s *AnalyticsService) GetStudentPerformance(ctx context.Context, tc model.TenantContext, studentID uuid.UUID) (*StudentPerformance, error) {
	switch tc.Role {
	case model.RoleOwner, model.RoleAdmin, model.RoleTeacher:
		// proceed — the SERVICE resolves scope (owner/admin center-wide, teacher own-class).
	default:
		// Student (and any unknown role) → 403 INSUFFICIENT_ROLE, even for their OWN id
		// (they must use /me). No DB touch, no body (D4/AC3).
		return nil, &ForbiddenError{Reason: "insufficient role"}
	}

	_, callerUUID, err := parseTenant(tc)
	if err != nil {
		return nil, err
	}
	teacherScope := analyticsTeacherScope(tc.Role, callerUUID)

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("student perf: begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }()
	if err := store.SetTenantContext(ctx, tx, tc); err != nil {
		return nil, fmt.Errorf("student perf: %w", err)
	}
	q := generated.New(tx)

	perf, err := s.buildStudentPerformance(ctx, q, studentID, teacherScope, framingTeacher)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("student perf: commit: %w", err)
	}
	return perf, nil
}

// GetMyPerformance returns the calling student's OWN performance (AC5-7, D4/D5). A
// non-student caller → 403 INSUFFICIENT_ROLE. framing is "student": the peer fields
// (classAvgBand, affectedStudentCount) are STRIPPED (FR-50 — a DATA guarantee). The
// student can only ever be themselves (studentID := tc.UserID), so no other student's row
// is reachable by any path.
func (s *AnalyticsService) GetMyPerformance(ctx context.Context, tc model.TenantContext) (*StudentPerformance, error) {
	if tc.Role != model.RoleStudent {
		// teacher/owner/admin → 403 INSUFFICIENT_ROLE (they use /students/{id}).
		return nil, &ForbiddenError{Reason: "insufficient role"}
	}

	_, callerUUID, err := parseTenant(tc)
	if err != nil {
		return nil, err
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("my perf: begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }()
	if err := store.SetTenantContext(ctx, tx, tc); err != nil {
		return nil, fmt.Errorf("my perf: %w", err)
	}
	q := generated.New(tx)

	// teacherScope NULL: the student's own resolved class is their active enrollment.
	perf, err := s.buildStudentPerformance(ctx, q, callerUUID, pgtype.UUID{Valid: false}, framingStudent)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("my perf: commit: %w", err)
	}
	return perf, nil
}

// buildStudentPerformance is the SHARED assembler for both endpoints (AC7). It runs the
// exact 6-query budget (GetStudentForAnalytics → band → skill breakdown → cohort → stats
// → mistakes) — size-invariant, no per-skill/per-week/per-grade N+1 (R31). framing
// "student" STRIPS the peer fields inside buildStudentSkillBreakdown/
// buildStudentMistakePatterns (FR-50/D5/D11). A missing student (teacher-out-of-scope,
// unknown, non-student, or cross-tenant) → GetStudentForAnalytics ErrNoRows → 404
// STUDENT_NOT_FOUND (non-disclosure).
func (s *AnalyticsService) buildStudentPerformance(
	ctx context.Context, q *generated.Queries, studentID uuid.UUID, teacherScope pgtype.UUID, framing string,
) (*StudentPerformance, error) {
	meta, err := q.GetStudentForAnalytics(ctx, generated.GetStudentForAnalyticsParams{
		TeacherID: teacherScope,
		StudentID: pgUUID(studentID),
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, model.NotFoundError{Resource: "student", ID: studentID.String(), Code: "STUDENT_NOT_FOUND"}
		}
		return nil, fmt.Errorf("student perf: load student: %w", err)
	}

	axis := s.weekAxis(meta.Timezone)
	studentPg := pgUUID(studentID)

	// 1. per-skill band progression, densified per skill onto the shared axis (AC8).
	botRows, err := q.ListStudentBandProgression(ctx, generated.ListStudentBandProgressionParams{
		Tz:         axis.tz,
		StudentID:  studentPg,
		RangeStart: dashTS(axis.rangeStart),
		RangeEnd:   dashTS(axis.rangeEnd),
	})
	if err != nil {
		return nil, fmt.Errorf("student perf: band progression: %w", err)
	}
	bandProgression := s.densifyStudentBandProgression(axis, botRows)

	// 2. per-skill breakdown (latest overall + per-criterion avgs, W/S only) (AC9).
	sbRows, err := q.ListStudentSkillBreakdown(ctx, studentPg)
	if err != nil {
		return nil, fmt.Errorf("student perf: skill breakdown: %w", err)
	}
	// 3. cohort classAvgBand for the resolved class (D11) — ALWAYS issued (size-invariance);
	// meta.ClassID invalid (student in no class) ⇒ no rows ⇒ classAvgBand null everywhere.
	cohortRows, err := q.ListClassCohortSkillAvg(ctx, meta.ClassID)
	if err != nil {
		return nil, fmt.Errorf("student perf: cohort skill avg: %w", err)
	}
	skillBreakdown := buildStudentSkillBreakdown(sbRows, cohortRows, framing)

	// 4. submission/graded/pin stats + per-zone hasData (AC10).
	statRow, err := q.GetStudentAnalyticsSubmissionStats(ctx, generated.GetStudentAnalyticsSubmissionStatsParams{
		StudentID: studentPg,
		Now:       dashTS(s.clk.Now()),
	})
	if err != nil {
		return nil, fmt.Errorf("student perf: submission stats: %w", err)
	}
	submissionStats := buildStudentSubmissionStats(statRow)

	// 5. 4-skill mistake patterns (comments ∪ answer_errors), student-gated + framed (AC11-13).
	mistakeRows, err := q.ListStudentMistakePatterns(ctx, generated.ListStudentMistakePatternsParams{
		StudentID:   studentPg,
		RangeStart:  dashTS(axis.rangeStart),
		RecentStart: dashTS(axis.recentStart),
		PriorStart:  dashTS(axis.priorStart),
	})
	if err != nil {
		return nil, fmt.Errorf("student perf: mistakes: %w", err)
	}
	mistakes := buildStudentMistakePatterns(mistakeRows, framing)

	// [Review P6] The two 12-week-windowed zones flag hasData from RENDERABLE content
	// (a non-empty per-skill series / a surfaced pattern), NOT the all-time graded count —
	// else an inactive student whose only released grades predate the window would un-ghost
	// an empty chart. densifyStudentBandProgression only emits a series for a skill with an
	// in-window grade, so len>0 ⟺ there is in-window band data. skillBreakdown/submissionStats
	// stay count-driven (grain-consistent — their queries are all-time).
	submissionStats.HasData["bandProgression"] = len(bandProgression) > 0
	submissionStats.HasData["mistakePatterns"] = len(mistakes.Patterns) > 0

	var classID *string
	if meta.ClassID.Valid {
		cs := uuidFromPg(meta.ClassID).String()
		classID = &cs
	}

	return &StudentPerformance{
		StudentID:       studentID.String(),
		StudentName:     meta.StudentName,
		Framing:         framing,
		ClassID:         classID,
		TargetBand:      numericToFloatPtr(meta.TargetBand),
		SubmissionStats: submissionStats,
		SkillBreakdown:  skillBreakdown,
		BandProgression: bandProgression,
		MistakePatterns: mistakes,
	}, nil
}

// densifyStudentBandProgression groups the per-(skill,week) rows by skill and densifies
// each skill onto the shared dense axis (AC8): an empty week → avgBand null (never 0); a
// skill with no released grades never appears in the rows → omitted (not a zero series).
// Skill order follows the SQL's skill-ASC ordering (deterministic).
func (s *AnalyticsService) densifyStudentBandProgression(
	axis analyticsAxis, rows []generated.ListStudentBandProgressionRow,
) []SkillBandSeries {
	type weekAgg struct {
		avg   *float64
		count int64
	}
	bySkill := make(map[string]map[string]weekAgg)
	skillOrder := make([]string, 0)
	for _, r := range rows {
		if _, ok := bySkill[r.Skill]; !ok {
			bySkill[r.Skill] = make(map[string]weekAgg)
			skillOrder = append(skillOrder, r.Skill)
		}
		bySkill[r.Skill][axis.weekKey(r.WeekStart.Time)] = weekAgg{avg: numericToFloatPtr(r.AvgBand), count: r.SubmissionCount}
	}

	series := make([]SkillBandSeries, 0, len(skillOrder))
	for _, skill := range skillOrder {
		weekMap := bySkill[skill]
		points := make([]BandOverTimePoint, 0, len(axis.weeks))
		for _, w := range axis.weeks {
			key := axis.weekKey(w)
			agg := weekMap[key]
			points = append(points, BandOverTimePoint{
				WeekStart:       key,
				AvgBand:         agg.avg,
				SubmissionCount: int(agg.count),
			})
		}
		series = append(series, SkillBandSeries{Skill: skill, Points: points})
	}
	return series
}

// buildStudentSkillBreakdown maps the per-skill rows + the cohort avgs into the breakdown
// (AC9). classAvgBand comes from the cohort map (null when the skill has no cohort grades)
// and is STRIPPED (nil) when framing is "student" (FR-50/D11).
func buildStudentSkillBreakdown(
	rows []generated.ListStudentSkillBreakdownRow, cohortRows []generated.ListClassCohortSkillAvgRow, framing string,
) []SkillBreakdown {
	cohortBySkill := make(map[string]*float64, len(cohortRows))
	for _, cr := range cohortRows {
		cohortBySkill[cr.Skill] = numericToFloatPtr(cr.ClassAvgBand)
	}

	out := make([]SkillBreakdown, 0, len(rows))
	for _, r := range rows {
		var classAvg *float64
		if framing != framingStudent {
			classAvg = cohortBySkill[r.Skill] // teacher-only peer field
		}
		out = append(out, SkillBreakdown{
			Skill:        r.Skill,
			OverallBand:  numericToFloatPtr(r.OverallBand),
			ClassAvgBand: classAvg,
			Criteria:     studentSkillCriteria(r),
		})
	}
	return out
}

// studentSkillCriteria returns a skill's per-criterion averages from the flat row: the
// Writing subset for writing, the Speaking subset for speaking, empty for the objective
// reading/listening skills (no IELTS criteria). Criterion keys single-sourced from the
// grading domain (analyticsWritingCriteria / analyticsSpeakingCriteria).
func studentSkillCriteria(r generated.ListStudentSkillBreakdownRow) []SkillCriterionAvg {
	avgByCriterion := map[string]*float64{
		grading.CriterionTaskResponse:      numericToFloatPtr(r.TaskResponseAvg),
		grading.CriterionCoherenceCohesion: numericToFloatPtr(r.CoherenceCohesionAvg),
		grading.CriterionLexicalResource:   numericToFloatPtr(r.LexicalResourceAvg),
		grading.CriterionGrammaticalRange:  numericToFloatPtr(r.GrammaticalRangeAvg),
		grading.CriterionFluencyCoherence:  numericToFloatPtr(r.FluencyCoherenceAvg),
		grading.CriterionPronunciation:     numericToFloatPtr(r.PronunciationAvg),
	}
	var keys []string
	switch r.Skill {
	case "writing":
		keys = analyticsWritingCriteria
	case "speaking":
		keys = analyticsSpeakingCriteria
	default:
		return []SkillCriterionAvg{} // reading/listening: objective, no criteria
	}
	criteria := make([]SkillCriterionAvg, 0, len(keys))
	for _, k := range keys {
		criteria = append(criteria, SkillCriterionAvg{Criterion: k, AvgBand: avgByCriterion[k]})
	}
	return criteria
}

// buildStudentSubmissionStats maps the stats row + derives the per-zone hasData flags
// (AC10). The band/skill/mistake zones all gate on released grades (gradedSubmissionCount);
// the submission zone gates on any submission or any past-due assignment.
func buildStudentSubmissionStats(r generated.GetStudentAnalyticsSubmissionStatsRow) StudentSubmissionStats {
	graded := int(r.GradedSubmissionCount)
	totalSub := int(r.TotalSubmissionCount)
	totalDue := int(r.TotalDue)
	return StudentSubmissionStats{
		SubmissionRate: SubmissionRate{
			OnTimeCount: int(r.OnTimeCount),
			TotalDue:    totalDue,
			Rate:        safeRate(r.OnTimeCount, r.TotalDue),
		},
		TotalSubmissionCount:  totalSub,
		GradedSubmissionCount: graded,
		PraisePinCount:        int(r.PraisePinCount),
		ErrorPinCount:         int(r.ErrorPinCount),
		HasData: map[string]bool{
			"bandProgression": graded > 0,
			"skillBreakdown":  graded > 0,
			"mistakePatterns": graded > 0,
			"submissionStats": totalSub > 0 || totalDue > 0,
		},
	}
}

// buildStudentMistakePatterns applies the STUDENT gate (instanceCount >= MIN only — the
// multi-student co-gate is meaningless for one student's own mistakes, where
// affectedStudentCount is trivially 1) + the trend, and sets patternSource from the SQL.
// affectedStudentCount is STRIPPED (nil) when framing is "student" (FR-50/D5/D11).
// coveredSources/excludedSources match the class endpoint (D12 symmetry — excluded is []).
func buildStudentMistakePatterns(rows []generated.ListStudentMistakePatternsRow, framing string) MistakePatterns {
	patterns := make([]MistakePattern, 0, len(rows))
	for _, r := range rows {
		if r.InstanceCount < MinPatternInstances {
			continue
		}
		var affected *int
		if framing != framingStudent {
			a := int(r.AffectedStudentCount)
			affected = &a
		}
		criterion, questionType := mistakeCriterionSplit(r.PatternSource, r.Criterion)
		patterns = append(patterns, MistakePattern{
			SkillSource:          r.SkillSource,
			Criterion:            criterion,
			QuestionType:         questionType,
			Type:                 r.Type,
			InstanceCount:        int(r.InstanceCount),
			AffectedStudentCount: affected,
			Trend:                mistakeTrend(r.RecentCount, r.PriorCount),
			PatternSource:        r.PatternSource,
			ExampleQuote:         mistakeExampleQuote(r.ExampleQuote),
			ExampleNote:          nil, // no per-comment note field in the v1 grade comment shape
		})
	}
	return MistakePatterns{
		CoveredSources:  append([]string{}, analyticsCoveredSources...),
		ExcludedSources: append([]string{}, analyticsExcludedSources...),
		Patterns:        patterns,
	}
}

// ---------------- week axis (D8) ----------------

// analyticsAxis holds the dense Monday-anchored week axis (center tz) plus the
// mistake trend window boundaries, all as absolute instants + a display formatter.
type analyticsAxis struct {
	tz          string
	loc         *time.Location
	weeks       []time.Time // oldest → newest, AnalyticsWeekWindow entries
	rangeStart  time.Time   // weeks[0]
	rangeEnd    time.Time   // currentWeekStart + 7d
	recentStart time.Time   // now - TrendWindowWeeks
	priorStart  time.Time   // now - 2*TrendWindowWeeks
}

// weekAxis computes the tz-bucketed dense week axis + trend windows from the injected
// clock (D8/DR-B). Week starts Monday. An empty tz defaults to the center default; an
// unloadable tz falls back to UTC.
func (s *AnalyticsService) weekAxis(tz string) analyticsAxis {
	now := s.clk.Now()
	if tz == "" {
		tz = DashboardDefaultTimezone
	}
	loc, err := time.LoadLocation(tz)
	if err != nil || loc == nil {
		// Keep the SQL @tz consistent with the Go fallback: axis.tz is passed to
		// `AT TIME ZONE @tz`, which would raise 22023 (500) on an unparseable zone,
		// or silently bucket in a different zone than Go and yield all-empty weeks.
		loc = time.UTC
		tz = "UTC"
	}
	local := now.In(loc)
	dayStart := time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, loc)
	daysSinceMonday := (int(local.Weekday()) + 6) % 7
	currentWeekStart := dayStart.AddDate(0, 0, -daysSinceMonday)

	weeks := make([]time.Time, AnalyticsWeekWindow)
	for i := 0; i < AnalyticsWeekWindow; i++ {
		weeks[i] = currentWeekStart.AddDate(0, 0, -7*(AnalyticsWeekWindow-1-i))
	}
	windowDays := AnalyticsTrendWindowWeeks * 7
	return analyticsAxis{
		tz:          tz,
		loc:         loc,
		weeks:       weeks,
		rangeStart:  weeks[0],
		rangeEnd:    currentWeekStart.AddDate(0, 0, 7),
		recentStart: now.AddDate(0, 0, -windowDays),
		priorStart:  now.AddDate(0, 0, -2*windowDays),
	}
}

// weekKey formats a week-start instant as its local Monday date (YYYY-MM-DD) — the
// join key between the Go axis and the SQL-returned week_start (both the absolute
// instant of local Monday-midnight).
func (a analyticsAxis) weekKey(t time.Time) string {
	return t.In(a.loc).Format("2006-01-02")
}

// ---------------- densifiers ----------------

// densifyBandOverTime maps the sparse per-week rows onto the dense axis (D15b) and
// derives cohortAvgBand (submission-count-weighted) + cohortAvgDelta (vs the first
// non-empty week in range, DR-C). Empty weeks carry avgBand null / submissionCount 0.
func (s *AnalyticsService) densifyBandOverTime(
	axis analyticsAxis, rows []generated.ListClassBandOverTimeRow,
) ([]BandOverTimePoint, *float64, *float64) {
	type weekAgg struct {
		avg   *float64
		count int64
	}
	byWeek := make(map[string]weekAgg, len(rows))
	for _, r := range rows {
		byWeek[axis.weekKey(r.WeekStart.Time)] = weekAgg{avg: numericToFloatPtr(r.AvgBand), count: r.SubmissionCount}
	}

	points := make([]BandOverTimePoint, 0, len(axis.weeks))
	var weightedSum float64
	var totalCount int64
	var firstNonEmpty *float64
	for _, w := range axis.weeks {
		key := axis.weekKey(w)
		agg := byWeek[key]
		points = append(points, BandOverTimePoint{
			WeekStart:       key,
			AvgBand:         agg.avg,
			SubmissionCount: int(agg.count),
		})
		if agg.avg != nil && agg.count > 0 {
			weightedSum += *agg.avg * float64(agg.count)
			totalCount += agg.count
			if firstNonEmpty == nil {
				v := *agg.avg
				firstNonEmpty = &v
			}
		}
	}

	var cohortAvg, cohortDelta *float64
	if totalCount > 0 {
		v := weightedSum / float64(totalCount)
		cohortAvg = &v
		if firstNonEmpty != nil {
			d := v - *firstNonEmpty
			cohortDelta = &d
		}
	}
	return points, cohortAvg, cohortDelta
}

// densifyHeatmap fills the dense criteria × week grid (D2/D15). A (criterion, week)
// with no numeric survivor → avgBand null, sampleCount 0 (D13/D15a).
func (s *AnalyticsService) densifyHeatmap(
	axis analyticsAxis, rows []generated.ListClassSkillHeatmapRow,
) SkillHeatmap {
	type cellAgg struct {
		avg    *float64
		sample int64
	}
	byKey := make(map[string]cellAgg, len(rows))
	for _, r := range rows {
		byKey[r.Criterion+"|"+axis.weekKey(r.WeekStart.Time)] = cellAgg{avg: numericToFloatPtr(r.AvgBand), sample: r.SampleCount}
	}

	weeks := make([]string, 0, len(axis.weeks))
	for _, w := range axis.weeks {
		weeks = append(weeks, axis.weekKey(w))
	}

	cells := make([]SkillHeatmapCell, 0, len(analyticsWritingCriteria)*len(weeks))
	for _, crit := range analyticsWritingCriteria {
		for _, wk := range weeks {
			agg := byKey[crit+"|"+wk]
			cells = append(cells, SkillHeatmapCell{
				Criterion:   crit,
				WeekStart:   wk,
				AvgBand:     agg.avg,
				SampleCount: int(agg.sample),
			})
		}
	}
	return SkillHeatmap{
		Criteria: append([]string{}, analyticsWritingCriteria...),
		Weeks:    weeks,
		Cells:    cells,
	}
}

// ---------------- mistake patterns ----------------

// buildMistakePatterns applies the co-gate (DR-A) and computes the trend (DR-B). Input
// rows are already in the SQL total order (instanceCount DESC, skill, criterion, type);
// the co-gate filter preserves it.
func buildMistakePatterns(rows []generated.ListClassMistakePatternsRow) MistakePatterns {
	patterns := make([]MistakePattern, 0, len(rows))
	for _, r := range rows {
		if r.InstanceCount < MinPatternInstances || r.AffectedStudentCount < MinPatternStudents {
			continue
		}
		affected := int(r.AffectedStudentCount)
		criterion, questionType := mistakeCriterionSplit(r.PatternSource, r.Criterion)
		patterns = append(patterns, MistakePattern{
			SkillSource:          r.SkillSource,
			Criterion:            criterion,
			QuestionType:         questionType,
			Type:                 r.Type,
			InstanceCount:        int(r.InstanceCount),
			AffectedStudentCount: &affected, // class endpoint always exposes the peer count
			Trend:                mistakeTrend(r.RecentCount, r.PriorCount),
			PatternSource:        r.PatternSource,
			ExampleQuote:         mistakeExampleQuote(r.ExampleQuote),
			ExampleNote:          nil, // no per-comment note field in the v1 grade comment shape
		})
	}
	return MistakePatterns{
		CoveredSources:  append([]string{}, analyticsCoveredSources...),
		ExcludedSources: append([]string{}, analyticsExcludedSources...),
		Patterns:        patterns,
	}
}

// mistakeTrend compares the recent vs prior window counts (DR-B). Equal or insufficient
// data → stable.
func mistakeTrend(recent, prior int64) string {
	switch {
	case recent > prior:
		return MistakeTrendWorsening
	case recent < prior:
		return MistakeTrendImproving
	default:
		return MistakeTrendStable
	}
}

// ---------------- at-risk ----------------

// buildAtRisk classifies the class's students in Go (D5) and returns the at-risk items
// + the at-risk count within the scan scope (AC9).
func (s *AnalyticsService) buildAtRisk(rows []generated.ListClassStudentsAtRiskInputsRow) ([]AnalyticsAtRiskItem, int) {
	items := make([]AnalyticsAtRiskItem, 0)
	for _, r := range rows {
		res := s.detector.Classify(AtRiskInputs{
			AttendancePresentLate: int(r.AttendancePresentLate),
			AttendanceTotalMarked: int(r.AttendanceTotalMarked),
			ConsecutiveMissed:     int(r.ConsecutiveMissed),
			RecentReleasedBands:   r.RecentReleasedBands,
			OverallBand:           numericToFloatPtr(r.OverallBand),
			ClassTargetBand:       numericToFloatPtr(r.ClassTargetBand),
		})
		if res.Status != AtRiskStatusAtRisk {
			continue
		}
		items = append(items, AnalyticsAtRiskItem{
			StudentID:      uuidFromPg(r.StudentID).String(),
			Name:           r.Name,
			AttendanceRate: attendanceRate(r.AttendancePresentLate, r.AttendanceTotalMarked),
			OverallBand:    numericToFloatPtr(r.OverallBand),
			Reasons:        res.Reasons,
		})
	}
	return items, len(items)
}

// ---------------- shared helpers ----------------

// parseTenant validates the center + caller UUIDs from the tenant context.
func parseTenant(tc model.TenantContext) (uuid.UUID, uuid.UUID, error) {
	centerUUID, err := uuid.Parse(tc.CenterID)
	if err != nil {
		return uuid.Nil, uuid.Nil, &ForbiddenError{Reason: "invalid tenant context"}
	}
	callerUUID, err := uuid.Parse(tc.UserID)
	if err != nil {
		return uuid.Nil, uuid.Nil, &ForbiddenError{Reason: "invalid tenant context"}
	}
	return centerUUID, callerUUID, nil
}

// analyticsTeacherScope is the teacher_id narg: teacher ⇒ own userId (own classes);
// owner/admin ⇒ NULL (center-wide) — the 8-1a branch (D7).
func analyticsTeacherScope(role string, callerUUID uuid.UUID) pgtype.UUID {
	if role == model.RoleTeacher {
		return pgUUID(callerUUID)
	}
	return pgtype.UUID{Valid: false}
}

// safeRate is numerator/denominator as a *float64, nil when the denominator is 0
// (division guard — never 0, never NaN, AC10).
func safeRate(numerator, denominator int64) *float64 {
	if denominator <= 0 {
		return nil
	}
	r := float64(numerator) / float64(denominator)
	return &r
}
