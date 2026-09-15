// Package service — Story 8.1a DashboardService: the role-scoped GET /api/dashboard
// read model. ONE endpoint, role-branched INSIDE the service (D2 — the chain is
// ungated; every authenticated role reaches here and gets its OWN payload, never a
// 403 for role). A single DashboardData object carries a `role` discriminator plus
// three nullable role blocks of which EXACTLY ONE is non-null (D3, an AC2 runtime
// invariant the schema cannot express).
//
// Seams honored:
//   - ONE tx per request with SET LOCAL app.current_tenant_id, so RLS tenant-scopes
//     every joined table (GO-1 / PERF-1 / D9). Reads only.
//   - Role scope (D4) via teacherScope: teacher ⇒ own userId (own classes only);
//     owner/admin ⇒ NULL narg (center-wide); student ⇒ keyed on tc.UserID.
//   - At-risk is the clock-injected AtRiskDetector, reused UNCHANGED (D5): the whole
//     student set is classified in Go from the ListStudents INPUT columns — NO
//     per-student N+1 (PERF-2).
//   - Every day/week/"today" boundary is bucketed in centers.timezone (D8); the
//     injected clock supplies @now to every window (GO-4 — the incoming ctx flows
//     through, no context.Background()).
package service

import (
	"context"
	"fmt"
	"time"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/model"
	"github.com/ducdo/classlite-api/internal/store"
	"github.com/ducdo/classlite-api/internal/store/generated"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

// Dashboard tuning constants (CQ-3 — no magic values; the single source of truth
// the ≤N query-count harness and the rails read).
const (
	// DashboardRailLimit caps every top-N rail (needsGrading, unansweredQuestions,
	// atRiskStudents, dueSoon, recentFeedback).
	DashboardRailLimit = 5
	// DashboardAtRiskScanCap bounds how many students the at-risk rail scans and
	// classifies in one set-based query (D5) — the rail shows the first
	// DashboardRailLimit at-risk of these; count is the at-risk total within the scan.
	DashboardAtRiskScanCap = 200
	// DashboardUpcomingWindowDays is the rolling look-ahead for upcoming sessions.
	DashboardUpcomingWindowDays = 7
	// StorageApproachingThreshold is the storage-% at/above which the owner capacity
	// item flags `approaching` (D-CAP — storage-% ONLY; plan/seat → Epic 9).
	StorageApproachingThreshold = 0.80
	// DashboardDefaultTimezone is the D8 fallback when centers.timezone is empty. It
	// matches the centers.timezone column default; time.LoadLocation("") resolves to
	// UTC (not an error), so an empty string must be defaulted explicitly or day/week
	// windows silently shift off the intended local day.
	DashboardDefaultTimezone = "Asia/Ho_Chi_Minh"
)

// ---------------- Response DTOs (PROVISIONAL, D12; camelCase; GO-5 explicit null) ----------------

// DashboardData is the single role-branched payload. Exactly one of Teacher/Owner/
// Student is non-null, chosen by Role (AC2 runtime invariant, D3).
type DashboardData struct {
	Role    string        `json:"role"`
	Teacher *TeacherDash  `json:"teacher"`
	Owner   *OwnerDash    `json:"owner"`
	Student *StudentDash  `json:"student"`
}

// DashboardSessionLite is one session in a rail. TeacherName/EnrolledCount are
// populated ONLY for the owner todaySessions list (AC6); null on teacher/student lists.
type DashboardSessionLite struct {
	SessionID     string    `json:"sessionId"`
	ClassID       string    `json:"classId"`
	ClassName     string    `json:"className"`
	Color         *string   `json:"color"`
	Topic         *string   `json:"topic"`
	StartsAt      time.Time `json:"startsAt"`
	EndsAt        time.Time `json:"endsAt"`
	Status        string    `json:"status"`
	TeacherName   *string   `json:"teacherName"`
	EnrolledCount *int      `json:"enrolledCount"`
}

// DashboardAtRiskItem is one at-risk student (D5). PendingCount is intentionally
// omitted from v1 (not cheaply derivable from ListStudents without an N+1 or a
// shipped-query change) — a PROVISIONAL deferral for the 8-1b co-finalize.
type DashboardAtRiskItem struct {
	StudentID      string   `json:"studentId"`
	Name           string   `json:"name"`
	AttendanceRate *float64 `json:"attendanceRate"`
	OverallBand    *float64 `json:"overallBand"`
	Reasons        []string `json:"reasons"`
}

// DashboardAtRiskBlock is a count + top-N at-risk rail.
type DashboardAtRiskBlock struct {
	Count int                   `json:"count"`
	Items []DashboardAtRiskItem `json:"items"`
}

// DashboardGradingItem is one submission awaiting grading.
type DashboardGradingItem struct {
	SubmissionID    string `json:"submissionId"`
	StudentName     string `json:"studentName"`
	AssignmentTitle string `json:"assignmentTitle"`
	ClassName       string `json:"className"`
	Overdue         bool   `json:"overdue"`
}

// DashboardGradingBlock is a count + top-N grading backlog.
type DashboardGradingBlock struct {
	Count int                    `json:"count"`
	Items []DashboardGradingItem `json:"items"`
}

// DashboardQuestionRailItem is one unanswered question (teacher rail).
type DashboardQuestionRailItem struct {
	QuestionID    string  `json:"questionId"`
	Content       string  `json:"content"`
	AnchorExcerpt *string `json:"anchorExcerpt"`
	ClassID       string  `json:"classId"`
	CreatedAt     time.Time `json:"createdAt"`
}

// DashboardQuestionBlock is a count + top-N unanswered-questions rail.
type DashboardQuestionBlock struct {
	Count int                         `json:"count"`
	Items []DashboardQuestionRailItem `json:"items"`
}

// TeacherDash is the teacher payload (FR-52, s06).
type TeacherDash struct {
	WeekSessions        []DashboardSessionLite `json:"weekSessions"`
	NeedsGrading        DashboardGradingBlock  `json:"needsGrading"`
	UnansweredQuestions DashboardQuestionBlock `json:"unansweredQuestions"`
	AtRiskStudents      DashboardAtRiskBlock   `json:"atRiskStudents"`
}

// DashboardOwnerPulse is the center pulse (day/week bucketed in centers.timezone, D8).
type DashboardOwnerPulse struct {
	ActiveClasses    int `json:"activeClasses"`
	StudentsEnrolled int `json:"studentsEnrolled"`
	StaffActiveToday int `json:"staffActiveToday"`
	SessionsThisWeek int `json:"sessionsThisWeek"`
	SessionsToday    int `json:"sessionsToday"`
}

// DashboardUnassignedItem is one student with no active enrollment.
type DashboardUnassignedItem struct {
	StudentID string `json:"studentId"`
	Name      string `json:"name"`
}

// DashboardUnassignedBlock is a count + top-N unassigned-students rail.
type DashboardUnassignedBlock struct {
	Count int                       `json:"count"`
	Items []DashboardUnassignedItem `json:"items"`
}

// DashboardCapacity is the storage-only capacity signal (D-CAP).
type DashboardCapacity struct {
	StorageUsedBytes  int64   `json:"storageUsedBytes"`
	StorageLimitBytes int64   `json:"storageLimitBytes"`
	PercentUsed       float64 `json:"percentUsed"`
	Approaching       bool    `json:"approaching"`
}

// DashboardPendingInvites is the count of un-accepted, un-expired invites.
type DashboardPendingInvites struct {
	Count int `json:"count"`
}

// DashboardNeedsAttention is the owner needs-attention card (no Q&A, no plan/seat — D-QA/D-CAP).
type DashboardNeedsAttention struct {
	UnassignedStudents DashboardUnassignedBlock `json:"unassignedStudents"`
	AtRiskStudents     DashboardAtRiskBlock     `json:"atRiskStudents"`
	Capacity           DashboardCapacity        `json:"capacity"`
	PendingInvites     DashboardPendingInvites  `json:"pendingInvites"`
}

// OwnerDash is the owner/admin payload (FR-51, s48).
type OwnerDash struct {
	Pulse          DashboardOwnerPulse     `json:"pulse"`
	TodaySessions  []DashboardSessionLite  `json:"todaySessions"`
	NeedsAttention DashboardNeedsAttention `json:"needsAttention"`
}

// DashboardDueItem is one due-soon assignment (s74 "Continue writing" resume via SubmissionID).
// Skill is always present — exercises.skill is NOT NULL (a CHECK-constrained enum) — so
// it is a non-nullable string, not a pointer (matching the api.yaml contract).
type DashboardDueItem struct {
	AssignmentID     string    `json:"assignmentId"`
	Title            string    `json:"title"`
	Skill            string    `json:"skill"`
	DeadlineAt       time.Time `json:"deadlineAt"`
	SubmissionID     *string   `json:"submissionId"`
	SubmissionStatus *string   `json:"submissionStatus"`
}

// DashboardFeedbackItem is one recently-released grade (own submission).
type DashboardFeedbackItem struct {
	SubmissionID    string    `json:"submissionId"`
	AssignmentTitle string    `json:"assignmentTitle"`
	OverallBand     *float64  `json:"overallBand"`
	ReleasedAt      time.Time `json:"releasedAt"`
}

// DashboardQuestionThreadLite is one of the student's own open question threads.
type DashboardQuestionThreadLite struct {
	QuestionID string    `json:"questionId"`
	Content    string    `json:"content"`
	Status     string    `json:"status"`
	CreatedAt  time.Time `json:"createdAt"`
}

// StudentDash is the student payload (FR-53, s29) — no class averages, no other
// students' data (FR-50, AC16).
type StudentDash struct {
	UpcomingSessions []DashboardSessionLite        `json:"upcomingSessions"`
	DueSoon          []DashboardDueItem            `json:"dueSoon"`
	RecentFeedback   []DashboardFeedbackItem       `json:"recentFeedback"`
	MyQuestions      []DashboardQuestionThreadLite `json:"myQuestions"`
}

// ---------------- Service ----------------

// DashboardService composes the role-scoped dashboard read.
type DashboardService struct {
	db       AuthDB
	clk      clock.Clock
	detector *AtRiskDetector
}

// NewDashboardService constructs a DashboardService. The detector shares the
// injected clock so a fixed test clock drives every window deterministically (D8).
func NewDashboardService(db AuthDB, clk clock.Clock) *DashboardService {
	if clk == nil {
		clk = clock.RealClock{}
	}
	return &DashboardService{
		db:       db,
		clk:      clk,
		detector: NewAtRiskDetector(clk),
	}
}

// dayWeekBounds holds the tz-bucketed boundaries (D8), all as absolute instants.
type dayWeekBounds struct {
	now       time.Time
	dayStart  time.Time
	dayEnd    time.Time
	weekStart time.Time
	weekEnd   time.Time
}

// GetDashboard opens ONE tx, sets the tenant context, and returns the role-branched
// payload (AC1-AC12). Exactly one role block is non-null (AC2).
func (s *DashboardService) GetDashboard(ctx context.Context, tc model.TenantContext) (*DashboardData, error) {
	centerUUID, err := uuid.Parse(tc.CenterID)
	if err != nil {
		return nil, &ForbiddenError{Reason: "invalid tenant context"}
	}
	callerUUID, err := uuid.Parse(tc.UserID)
	if err != nil {
		return nil, &ForbiddenError{Reason: "invalid tenant context"}
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("dashboard: begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }()
	if err := store.SetTenantContext(ctx, tx, tc); err != nil {
		return nil, fmt.Errorf("dashboard: %w", err)
	}
	q := generated.New(tx)
	centerPg := pgUUID(centerUUID)

	// Timezone-bucketed day/week boundaries (D8). centers is a global table; the id
	// is the caller's own center. An empty tz defaults to Asia/Ho_Chi_Minh; a
	// non-empty-but-unloadable tz falls back to UTC.
	tz, err := q.GetCenterTimezone(ctx, centerPg)
	if err != nil {
		return nil, fmt.Errorf("dashboard: center timezone: %w", err)
	}
	bounds := s.computeBounds(tz)

	data := &DashboardData{Role: tc.Role}
	switch tc.Role {
	case model.RoleStudent:
		student, berr := s.buildStudent(ctx, q, centerPg, pgUUID(callerUUID), bounds)
		if berr != nil {
			return nil, berr
		}
		data.Student = student
	case model.RoleTeacher:
		teacher, berr := s.buildTeacher(ctx, q, centerPg, pgUUID(callerUUID), bounds)
		if berr != nil {
			return nil, berr
		}
		data.Teacher = teacher
	case model.RoleOwner, model.RoleAdmin:
		owner, berr := s.buildOwner(ctx, q, centerPg, bounds)
		if berr != nil {
			return nil, berr
		}
		data.Owner = owner
	default:
		return nil, &ForbiddenError{Reason: "unknown role"}
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("dashboard: commit: %w", err)
	}
	return data, nil
}

// computeBounds derives the tz-bucketed day/week boundaries from the injected clock
// (D8). Week starts Monday. All returned instants are absolute (midnight in loc).
func (s *DashboardService) computeBounds(tz string) dayWeekBounds {
	now := s.clk.Now()
	if tz == "" {
		tz = DashboardDefaultTimezone
	}
	loc, err := time.LoadLocation(tz)
	if err != nil || loc == nil {
		loc = time.UTC
	}
	local := now.In(loc)
	dayStart := time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, loc)
	dayEnd := dayStart.AddDate(0, 0, 1)
	// Monday-based week start: Sunday(0) is 6 days after Monday.
	daysSinceMonday := (int(local.Weekday()) + 6) % 7
	weekStart := dayStart.AddDate(0, 0, -daysSinceMonday)
	weekEnd := weekStart.AddDate(0, 0, 7)
	return dayWeekBounds{now: now, dayStart: dayStart, dayEnd: dayEnd, weekStart: weekStart, weekEnd: weekEnd}
}

// ---------------- Teacher ----------------

func (s *DashboardService) buildTeacher(
	ctx context.Context, q *generated.Queries, centerPg, callerPg pgtype.UUID,
	b dayWeekBounds,
) (*TeacherDash, error) {
	teacherScope := callerPg // teacher ⇒ own classes only (D4)

	// weekSessions — teacher's own-class sessions this week (tz-bucketed, D8).
	sessions, err := q.ListSessionsByRange(ctx, generated.ListSessionsByRangeParams{
		FromTs:    dashTS(b.weekStart),
		ToTs:      dashTS(b.weekEnd),
		ClassID:   pgtype.UUID{Valid: false},
		TeacherID: teacherScope,
	})
	if err != nil {
		return nil, fmt.Errorf("teacher dashboard: week sessions: %w", err)
	}
	week := make([]DashboardSessionLite, 0, len(sessions))
	for _, r := range sessions {
		week = append(week, sessionFromRange(r))
	}

	grading, err := s.gradingBacklog(ctx, q, centerPg, teacherScope, b.now)
	if err != nil {
		return nil, err
	}
	questions, err := s.unansweredQuestions(ctx, q, centerPg, callerPg, model.RoleTeacher)
	if err != nil {
		return nil, err
	}
	atRisk, err := s.atRiskRail(ctx, q, centerPg, teacherScope, b.now)
	if err != nil {
		return nil, err
	}

	return &TeacherDash{
		WeekSessions:        week,
		NeedsGrading:        grading,
		UnansweredQuestions: questions,
		AtRiskStudents:      atRisk,
	}, nil
}

// ---------------- Owner / Admin ----------------

func (s *DashboardService) buildOwner(
	ctx context.Context, q *generated.Queries, centerPg pgtype.UUID, b dayWeekBounds,
) (*OwnerDash, error) {
	pulseRow, err := q.GetOwnerPulse(ctx, generated.GetOwnerPulseParams{
		CenterID:  centerPg,
		DayStart:  dashTS(b.dayStart),
		DayEnd:    dashTS(b.dayEnd),
		WeekStart: dashTS(b.weekStart),
		WeekEnd:   dashTS(b.weekEnd),
	})
	if err != nil {
		return nil, fmt.Errorf("owner dashboard: pulse: %w", err)
	}

	todayRows, err := q.ListTodaySessionsForCenter(ctx, generated.ListTodaySessionsForCenterParams{
		CenterID: centerPg,
		DayStart: dashTS(b.dayStart),
		DayEnd:   dashTS(b.dayEnd),
	})
	if err != nil {
		return nil, fmt.Errorf("owner dashboard: today sessions: %w", err)
	}
	today := make([]DashboardSessionLite, 0, len(todayRows))
	for _, r := range todayRows {
		today = append(today, sessionFromTodayCenter(r))
	}

	// needsAttention.unassignedStudents
	unassignedCount, err := q.CountUnassignedStudents(ctx, centerPg)
	if err != nil {
		return nil, fmt.Errorf("owner dashboard: unassigned count: %w", err)
	}
	unassignedRows, err := q.ListUnassignedStudents(ctx, generated.ListUnassignedStudentsParams{
		CenterID: centerPg,
		Limit:    DashboardRailLimit,
		Offset:   0,
	})
	if err != nil {
		return nil, fmt.Errorf("owner dashboard: unassigned list: %w", err)
	}
	unassignedItems := make([]DashboardUnassignedItem, 0, len(unassignedRows))
	for _, r := range unassignedRows {
		unassignedItems = append(unassignedItems, DashboardUnassignedItem{
			StudentID: uuidFromPg(r.StudentID).String(),
			Name:      r.StudentName,
		})
	}

	// needsAttention.atRiskStudents — center-wide (NULL scope, D5)
	atRisk, err := s.atRiskRail(ctx, q, centerPg, pgtype.UUID{Valid: false}, b.now)
	if err != nil {
		return nil, err
	}

	// needsAttention.capacity — storage-% ONLY (D-CAP)
	usedBytes, err := q.SumFileSizeByCenter(ctx, centerPg)
	if err != nil {
		return nil, fmt.Errorf("owner dashboard: storage used: %w", err)
	}
	limitBytes, err := q.GetCenterStorageLimit(ctx, centerPg)
	if err != nil {
		return nil, fmt.Errorf("owner dashboard: storage limit: %w", err)
	}
	percent := 0.0
	if limitBytes > 0 {
		percent = float64(usedBytes) / float64(limitBytes)
	}

	// needsAttention.pendingInvites
	pending, err := q.CountPendingInvites(ctx, generated.CountPendingInvitesParams{
		CenterID: centerPg,
		Now:      dashTS(b.now),
	})
	if err != nil {
		return nil, fmt.Errorf("owner dashboard: pending invites: %w", err)
	}

	return &OwnerDash{
		Pulse: DashboardOwnerPulse{
			ActiveClasses:    int(pulseRow.ActiveClasses),
			StudentsEnrolled: int(pulseRow.StudentsEnrolled),
			StaffActiveToday: int(pulseRow.StaffActiveToday),
			SessionsThisWeek: int(pulseRow.SessionsThisWeek),
			SessionsToday:    int(pulseRow.SessionsToday),
		},
		TodaySessions: today,
		NeedsAttention: DashboardNeedsAttention{
			UnassignedStudents: DashboardUnassignedBlock{Count: int(unassignedCount), Items: unassignedItems},
			AtRiskStudents:     atRisk,
			Capacity: DashboardCapacity{
				StorageUsedBytes:  usedBytes,
				StorageLimitBytes: limitBytes,
				PercentUsed:       percent,
				Approaching:       percent >= StorageApproachingThreshold,
			},
			PendingInvites: DashboardPendingInvites{Count: int(pending)},
		},
	}, nil
}

// ---------------- Student ----------------

func (s *DashboardService) buildStudent(
	ctx context.Context, q *generated.Queries, centerPg, callerPg pgtype.UUID, b dayWeekBounds,
) (*StudentDash, error) {
	// upcomingSessions — rolling [now, now+7d) window (relative, TZ-agnostic, D8).
	upcomingRows, err := q.ListStudentUpcomingSessions(ctx, generated.ListStudentUpcomingSessionsParams{
		StudentID: callerPg,
		CenterID:  centerPg,
		FromTs:    dashTS(b.now),
		ToTs:      dashTS(b.now.AddDate(0, 0, DashboardUpcomingWindowDays)),
	})
	if err != nil {
		return nil, fmt.Errorf("student dashboard: upcoming sessions: %w", err)
	}
	upcoming := make([]DashboardSessionLite, 0, len(upcomingRows))
	for _, r := range upcomingRows {
		upcoming = append(upcoming, sessionFromStudentUpcoming(r))
	}

	// dueSoon — the student's OPEN assignments only, soonest deadline first. The
	// open-status filter lives in SQL (ListStudentDueSoon) so the fixed LIMIT never
	// drops open work behind older closed assignments (the prior reuse of the
	// all-status ListStudentAssignments + Go-side filter over a capped scan did).
	dueRows, err := q.ListStudentDueSoon(ctx, generated.ListStudentDueSoonParams{
		StudentID: callerPg,
		CenterID:  centerPg,
		ItemLimit: DashboardRailLimit,
	})
	if err != nil {
		return nil, fmt.Errorf("student dashboard: due soon: %w", err)
	}
	due := make([]DashboardDueItem, 0, len(dueRows))
	for _, r := range dueRows {
		due = append(due, DashboardDueItem{
			AssignmentID:     uuidFromPg(r.ID).String(),
			Title:            r.ExerciseTitle,
			Skill:            r.ExerciseSkill,
			DeadlineAt:       r.DeadlineAt.Time,
			SubmissionID:     uuidPtrFromPg(r.SubmissionID),
			SubmissionStatus: pgTextToPtr(r.SubmissionStatus),
		})
	}

	// recentFeedback — most-recent RELEASED grades (own submissions).
	feedbackRows, err := q.ListStudentRecentFeedback(ctx, generated.ListStudentRecentFeedbackParams{
		CenterID:  centerPg,
		StudentID: callerPg,
		ItemLimit: DashboardRailLimit,
	})
	if err != nil {
		return nil, fmt.Errorf("student dashboard: recent feedback: %w", err)
	}
	feedback := make([]DashboardFeedbackItem, 0, len(feedbackRows))
	for _, r := range feedbackRows {
		feedback = append(feedback, DashboardFeedbackItem{
			SubmissionID:    uuidFromPg(r.SubmissionID).String(),
			AssignmentTitle: r.AssignmentTitle,
			OverallBand:     numericToFloatPtr(r.OverallBand),
			ReleasedAt:      r.ReleasedAt.Time,
		})
	}

	// myQuestions — the student's own open threads awaiting reply.
	unanswered := pgtype.Bool{Bool: true, Valid: true}
	qRows, err := q.ListQuestionsForReader(ctx, generated.ListQuestionsForReaderParams{
		CenterID:   centerPg,
		ReaderRole: model.RoleStudent,
		ReaderID:   callerPg,
		Unanswered: unanswered,
		Limit:      DashboardRailLimit,
		Offset:     0,
	})
	if err != nil {
		return nil, fmt.Errorf("student dashboard: my questions: %w", err)
	}
	myQuestions := make([]DashboardQuestionThreadLite, 0, len(qRows))
	for _, r := range qRows {
		myQuestions = append(myQuestions, DashboardQuestionThreadLite{
			QuestionID: uuidFromPg(r.QuestionID).String(),
			Content:    r.Content,
			Status:     r.Status,
			CreatedAt:  r.CreatedAt.Time,
		})
	}

	return &StudentDash{
		UpcomingSessions: upcoming,
		DueSoon:          due,
		RecentFeedback:   feedback,
		MyQuestions:      myQuestions,
	}, nil
}

// ---------------- Shared rail builders ----------------

// gradingBacklog builds the count + top-N needs-grading rail (teacher-scoped or
// center-wide via the teacherScope narg).
func (s *DashboardService) gradingBacklog(
	ctx context.Context, q *generated.Queries, centerPg, teacherScope pgtype.UUID, now time.Time,
) (DashboardGradingBlock, error) {
	count, err := q.CountGradingBacklog(ctx, generated.CountGradingBacklogParams{
		CenterID:  centerPg,
		TeacherID: teacherScope,
	})
	if err != nil {
		return DashboardGradingBlock{}, fmt.Errorf("dashboard: grading backlog count: %w", err)
	}
	rows, err := q.ListGradingBacklog(ctx, generated.ListGradingBacklogParams{
		Now:       dashTS(now),
		CenterID:  centerPg,
		TeacherID: teacherScope,
		ItemLimit: DashboardRailLimit,
	})
	if err != nil {
		return DashboardGradingBlock{}, fmt.Errorf("dashboard: grading backlog list: %w", err)
	}
	items := make([]DashboardGradingItem, 0, len(rows))
	for _, r := range rows {
		items = append(items, DashboardGradingItem{
			SubmissionID:    uuidFromPg(r.SubmissionID).String(),
			StudentName:     r.StudentName,
			AssignmentTitle: r.AssignmentTitle,
			ClassName:       r.ClassName,
			Overdue:         r.Overdue,
		})
	}
	return DashboardGradingBlock{Count: int(count), Items: items}, nil
}

// unansweredQuestions builds the count + top-N unanswered-questions rail. Owner/
// admin never call this (D-QA); the reader query returns 0 rows for them anyway.
func (s *DashboardService) unansweredQuestions(
	ctx context.Context, q *generated.Queries, centerPg, readerPg pgtype.UUID, role string,
) (DashboardQuestionBlock, error) {
	unanswered := pgtype.Bool{Bool: true, Valid: true}
	count, err := q.CountQuestionsForReader(ctx, generated.CountQuestionsForReaderParams{
		CenterID:   centerPg,
		ReaderRole: role,
		ReaderID:   readerPg,
		Unanswered: unanswered,
	})
	if err != nil {
		return DashboardQuestionBlock{}, fmt.Errorf("dashboard: unanswered count: %w", err)
	}
	rows, err := q.ListQuestionsForReader(ctx, generated.ListQuestionsForReaderParams{
		CenterID:   centerPg,
		ReaderRole: role,
		ReaderID:   readerPg,
		Unanswered: unanswered,
		Limit:      DashboardRailLimit,
		Offset:     0,
	})
	if err != nil {
		return DashboardQuestionBlock{}, fmt.Errorf("dashboard: unanswered list: %w", err)
	}
	items := make([]DashboardQuestionRailItem, 0, len(rows))
	for _, r := range rows {
		items = append(items, DashboardQuestionRailItem{
			QuestionID:    uuidFromPg(r.QuestionID).String(),
			Content:       r.Content,
			AnchorExcerpt: pgTextToPtr(r.AnchorExcerpt),
			ClassID:       uuidFromPg(r.ClassID).String(),
			CreatedAt:     r.CreatedAt.Time,
		})
	}
	return DashboardQuestionBlock{Count: int(count), Items: items}, nil
}

// atRiskRail scans up to DashboardAtRiskScanCap students (teacher-scoped or center-
// wide), classifies the whole set in Go via the reused AtRiskDetector (D5, no N+1),
// and returns the at-risk count + first DashboardRailLimit items.
func (s *DashboardService) atRiskRail(
	ctx context.Context, q *generated.Queries, centerPg, teacherScope pgtype.UUID, now time.Time,
) (DashboardAtRiskBlock, error) {
	rows, err := q.ListStudents(ctx, generated.ListStudentsParams{
		CenterID:  centerPg,
		TeacherID: teacherScope,
		ClassID:   pgtype.UUID{Valid: false},
		Now:       dashTS(now),
		Limit:     DashboardAtRiskScanCap,
		Offset:    0,
	})
	if err != nil {
		return DashboardAtRiskBlock{}, fmt.Errorf("dashboard: at-risk scan: %w", err)
	}
	items := make([]DashboardAtRiskItem, 0, DashboardRailLimit)
	count := 0
	for _, r := range rows {
		result := s.detector.Classify(AtRiskInputs{
			AttendancePresentLate: int(r.AttendancePresentLate),
			AttendanceTotalMarked: int(r.AttendanceTotalMarked),
			ConsecutiveMissed:     int(r.ConsecutiveMissed),
			RecentReleasedBands:   r.RecentReleasedBands,
			OverallBand:           numericToFloatPtr(r.OverallBand),
			ClassTargetBand:       numericToFloatPtr(r.ClassTargetBand),
		})
		if result.Status != AtRiskStatusAtRisk {
			continue
		}
		count++
		if len(items) < DashboardRailLimit {
			items = append(items, DashboardAtRiskItem{
				StudentID:      uuidFromPg(r.StudentID).String(),
				Name:           r.Name,
				AttendanceRate: attendanceRate(r.AttendancePresentLate, r.AttendanceTotalMarked),
				OverallBand:    numericToFloatPtr(r.OverallBand),
				Reasons:        result.Reasons,
			})
		}
	}
	return DashboardAtRiskBlock{Count: count, Items: items}, nil
}

// ---------------- mapping helpers ----------------

// dashTS wraps a time as a Valid pgtype.Timestamptz arg.
func dashTS(t time.Time) pgtype.Timestamptz {
	return pgtype.Timestamptz{Time: t, Valid: true}
}

// uuidPtrFromPg returns a *string uuid (nil when the pg uuid is NULL) — for GO-5
// explicit-null nullable id fields.
func uuidPtrFromPg(u pgtype.UUID) *string {
	if !u.Valid {
		return nil
	}
	s := uuidFromPg(u).String()
	return &s
}

// attendanceRate is (present+late)/total_marked, nil when nothing is marked.
func attendanceRate(presentLate, totalMarked int64) *float64 {
	if totalMarked <= 0 {
		return nil
	}
	r := float64(presentLate) / float64(totalMarked)
	return &r
}

func sessionFromRange(r generated.ListSessionsByRangeRow) DashboardSessionLite {
	return DashboardSessionLite{
		SessionID: uuidFromPg(r.ID).String(),
		ClassID:   uuidFromPg(r.ClassID).String(),
		ClassName: r.ClassName,
		Color:     pgTextToPtr(r.ClassColor),
		Topic:     pgTextToPtr(r.Topic),
		StartsAt:  r.StartsAt.Time,
		EndsAt:    r.EndsAt.Time,
		Status:    r.Status,
	}
}

func sessionFromStudentUpcoming(r generated.ListStudentUpcomingSessionsRow) DashboardSessionLite {
	return DashboardSessionLite{
		SessionID: uuidFromPg(r.SessionID).String(),
		ClassID:   uuidFromPg(r.ClassID).String(),
		ClassName: r.ClassName,
		Color:     pgTextToPtr(r.ClassColor),
		Topic:     pgTextToPtr(r.Topic),
		StartsAt:  r.StartsAt.Time,
		EndsAt:    r.EndsAt.Time,
		Status:    r.Status,
	}
}

func sessionFromTodayCenter(r generated.ListTodaySessionsForCenterRow) DashboardSessionLite {
	teacherName := pgTextToPtr(r.TeacherName)
	enrolled := int(r.EnrolledCount)
	return DashboardSessionLite{
		SessionID:     uuidFromPg(r.SessionID).String(),
		ClassID:       uuidFromPg(r.ClassID).String(),
		ClassName:     r.ClassName,
		Color:         pgTextToPtr(r.ClassColor),
		Topic:         pgTextToPtr(r.Topic),
		StartsAt:      r.StartsAt.Time,
		EndsAt:        r.EndsAt.Time,
		Status:        r.Status,
		TeacherName:   teacherName,
		EnrolledCount: &enrolled,
	}
}
