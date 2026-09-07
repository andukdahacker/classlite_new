// Package service — Story 7.2a StudentService: the role-scoped student roster
// read model (list + detail composition) and the teacher-notes surface
// (create/list/flag/soft-delete). There is NO students table — students are
// center_members rows with role='student' joined to users (D2).
//
// Seams honored:
//   - Every read/write runs inside a `SET LOCAL app.current_tenant_id` tx so RLS
//     tenant-scopes every joined table (GO-1 / PERF-1). A cross-tenant target is
//     invisible → 404 / empty / 0-row no-op (AC15).
//   - Role-scope (D3/D11, the R-SEC axis) is service-layer: admin/owner see the
//     whole center; a teacher sees ONLY students enrolled in a class they teach.
//     An out-of-scope student → 404 STUDENT_NOT_FOUND (non-disclosure, never 403).
//   - Note WRITES re-validate the caller's center_members.role from the DB (SEC-1)
//     and the author-or-owner delete guard — the JWT claim is never trusted for a
//     mutating call.
//   - At-risk is the clock-injected AtRiskDetector (D4): the roster classifies the
//     whole page from per-row INPUT columns — NO per-row N+1.
package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/model"
	"github.com/ducdo/classlite-api/internal/store"
	"github.com/ducdo/classlite-api/internal/store/generated"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

// Pagination bounds for the roster reads (CQ-3, XL-2). Reused for both the new
// GET /api/students and the paginated enrollment roster (D10).
const (
	// DefaultPageSize is the page size when the caller omits page_size.
	DefaultPageSize = 20
	// MaxPageSize caps page_size so a caller cannot request an unbounded page.
	MaxPageSize = 100
)

const (
	studentNotFoundCode = "STUDENT_NOT_FOUND"
	noteNotFoundCode    = "NOTE_NOT_FOUND"

	studentNoteCreatedAction = "student.note_created"
	studentNoteFlaggedAction = "student.note_flagged"
	studentNoteDeletedAction = "student.note_deleted"
	studentNoteAuditEntity   = "student_note"
)

// PageResult is the pagination meta the handler renders into meta.pagination.
type PageResult struct {
	Page       int
	PageSize   int
	Total      int
	TotalPages int
}

// clampPagination normalizes page/pageSize to the app bounds (XL-2) and returns
// the SQL OFFSET. page<1→1; pageSize→[1, MaxPageSize] with DefaultPageSize when 0.
func clampPagination(page, pageSize int) (int, int, int) {
	if page < 1 {
		page = 1
	}
	if pageSize < 1 {
		pageSize = DefaultPageSize
	}
	if pageSize > MaxPageSize {
		pageSize = MaxPageSize
	}
	return page, pageSize, (page - 1) * pageSize
}

// pageResult builds the pagination meta from a total row count.
func pageResult(page, pageSize int, total int64) PageResult {
	totalPages := 0
	if pageSize > 0 {
		totalPages = int((total + int64(pageSize) - 1) / int64(pageSize))
	}
	return PageResult{Page: page, PageSize: pageSize, Total: int(total), TotalPages: totalPages}
}

// StudentEnrolledClassLite is one class in a roster row (D3). TeacherID is
// internal (dedup key for Teachers[]) — a nil teacher_id means the class has no
// assigned teacher.
type StudentEnrolledClassLite struct {
	ClassID     uuid.UUID
	ClassName   string
	TeacherID   *string
	TeacherName *string
}

// StudentListItem is one roster row (D3).
type StudentListItem struct {
	StudentID             uuid.UUID
	Name                  string
	Email                 string
	AvatarURL             *string
	EnrolledClasses       []StudentEnrolledClassLite
	Teachers              []string
	OverallBand           *float64
	AtRiskStatus          string
	AtRiskReasons         []string
	ActiveEnrollmentCount int
	ArchivedAt            *time.Time
	JoinedAt              time.Time
}

// StudentProfile is the detail profile block (D12).
type StudentProfile struct {
	StudentID    uuid.UUID
	Name         string
	Email        string
	AvatarURL    *string
	LanguagePref string
	JoinedAt     time.Time
}

// StudentDetailClass is one enrolled class in the detail (D12).
type StudentDetailClass struct {
	ClassID     uuid.UUID
	ClassName   string
	TeacherName *string
	TargetBand  *float64
}

// StudentPerSkill is the 4-box IELTS breakdown (D6).
type StudentPerSkill struct {
	Reading   *float64
	Listening *float64
	Writing   *float64
	Speaking  *float64
}

// StudentPerformanceSummary is the detail performance block (D12).
type StudentPerformanceSummary struct {
	OverallBand         *float64
	PerSkill            StudentPerSkill
	AttendanceRate      *float64
	PendingCount        int
	MissingCount        int
	OnTimeRate          *float64
	CurrentVsFirstDelta *float64
}

// StudentAtRisk is the detail at-risk block (D12).
type StudentAtRisk struct {
	Status  string
	Reasons []string
}

// StudentNoteView is one note in a read (D12/D7).
type StudentNoteView struct {
	NoteID     uuid.UUID
	AuthorName string
	Content    string
	Flagged    bool
	CreatedAt  time.Time
}

// StudentDetail is the s10 detail composition (D12).
type StudentDetail struct {
	Profile            StudentProfile
	EnrolledClasses    []StudentDetailClass
	PerformanceSummary StudentPerformanceSummary
	AtRisk             StudentAtRisk
	Notes              []StudentNoteView
}

// StudentService orchestrates the roster reads + notes surface.
type StudentService struct {
	db       AuthDB
	audit    *AuditService
	clk      clock.Clock
	detector *AtRiskDetector
}

// NewStudentService constructs a StudentService.
func NewStudentService(db AuthDB, clk clock.Clock) *StudentService {
	if clk == nil {
		clk = clock.RealClock{}
	}
	return &StudentService{
		db:       db,
		audit:    NewAuditService(db),
		clk:      clk,
		detector: NewAtRiskDetector(clk),
	}
}

// ---------------- Reads ----------------

// ListStudentsFilter carries the parsed + clamped query params.
type ListStudentsFilter struct {
	Page      int
	PageSize  int
	ClassID   *uuid.UUID // nil ⇒ all classes
	TeacherID *uuid.UUID // admin/owner-only teacher_id filter (nil for teachers)
}

// ListStudents returns the role-scoped, paginated roster (AC1/AC2/AC5). A teacher
// is self-scoped (own classes only, the R-SEC axis); admin/owner see the center
// and may filter by teacher_id.
func (s *StudentService) ListStudents(
	ctx context.Context, tc model.TenantContext, filter ListStudentsFilter,
) ([]StudentListItem, PageResult, error) {
	if err := assertStudentReadRole(tc); err != nil {
		return nil, PageResult{}, err
	}
	centerUUID, err := uuid.Parse(tc.CenterID)
	if err != nil {
		return nil, PageResult{}, &ForbiddenError{Reason: "invalid tenant context"}
	}

	// Effective teacher-scope: a teacher is pinned to their own userId (any
	// teacher_id param is ignored, D3); admin/owner may pass a teacher_id filter.
	teacherScope := pgtype.UUID{Valid: false}
	if tc.Role == model.RoleTeacher {
		callerUUID, perr := uuid.Parse(tc.UserID)
		if perr != nil {
			return nil, PageResult{}, &ForbiddenError{Reason: "invalid tenant context"}
		}
		teacherScope = pgUUID(callerUUID)
	} else if filter.TeacherID != nil {
		teacherScope = pgUUID(*filter.TeacherID)
	}
	classScope := pgtype.UUID{Valid: false}
	if filter.ClassID != nil {
		classScope = pgUUID(*filter.ClassID)
	}

	page, pageSize, offset := clampPagination(filter.Page, filter.PageSize)

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, PageResult{}, fmt.Errorf("list students: begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }()
	if err := store.SetTenantContext(ctx, tx, tc); err != nil {
		return nil, PageResult{}, fmt.Errorf("list students: %w", err)
	}
	q := generated.New(tx)
	centerPg := pgUUID(centerUUID)
	nowPg := pgtype.Timestamptz{Time: s.clk.Now(), Valid: true}

	rows, err := q.ListStudents(ctx, generated.ListStudentsParams{
		CenterID:  centerPg,
		TeacherID: teacherScope,
		ClassID:   classScope,
		Now:       nowPg,
		Limit:     int32(pageSize),
		Offset:    int32(offset),
	})
	if err != nil {
		return nil, PageResult{}, fmt.Errorf("list students: query: %w", err)
	}
	total, err := q.CountStudents(ctx, generated.CountStudentsParams{
		CenterID:  centerPg,
		TeacherID: teacherScope,
		ClassID:   classScope,
	})
	if err != nil {
		return nil, PageResult{}, fmt.Errorf("list students: count: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, PageResult{}, fmt.Errorf("list students: commit: %w", err)
	}

	items := make([]StudentListItem, 0, len(rows))
	for _, r := range rows {
		items = append(items, s.rosterRowToItem(r))
	}
	return items, pageResult(page, pageSize, total), nil
}

// rosterRowToItem maps a ListStudentsRow → StudentListItem, batch-classifying via
// the detector from the row's at-risk INPUT columns (no N+1, D4).
func (s *StudentService) rosterRowToItem(r generated.ListStudentsRow) StudentListItem {
	classes := decodeEnrolledClasses(r.EnrolledClasses)
	teachers := distinctTeacherNames(classes)

	result := s.detector.Classify(AtRiskInputs{
		AttendancePresentLate: int(r.AttendancePresentLate),
		AttendanceTotalMarked: int(r.AttendanceTotalMarked),
		ConsecutiveMissed:     int(r.ConsecutiveMissed),
		RecentReleasedBands:   r.RecentReleasedBands,
		OverallBand:           numericToFloatPtr(r.OverallBand),
		ClassTargetBand:       numericToFloatPtr(r.ClassTargetBand),
	})

	item := StudentListItem{
		StudentID:             uuidFromPg(r.StudentID),
		Name:                  r.Name,
		Email:                 r.Email,
		AvatarURL:             pgTextToPtr(r.AvatarUrl),
		EnrolledClasses:       classes,
		Teachers:              teachers,
		OverallBand:           numericToFloatPtr(r.OverallBand),
		AtRiskStatus:          result.Status,
		AtRiskReasons:         result.Reasons,
		ActiveEnrollmentCount: int(r.ActiveEnrollmentCount),
		JoinedAt:              r.JoinedAt.Time,
	}
	if r.ArchivedAt.Valid {
		t := r.ArchivedAt.Time
		item.ArchivedAt = &t
	}
	return item
}

// GetStudentDetail composes the s10 detail (AC6/AC7). Role-scoped: a teacher only
// for a student in a class they teach — otherwise 404 STUDENT_NOT_FOUND (D11
// non-disclosure). A non-student / non-member id → 404.
func (s *StudentService) GetStudentDetail(
	ctx context.Context, tc model.TenantContext, studentID uuid.UUID,
) (*StudentDetail, error) {
	if err := assertStudentReadRole(tc); err != nil {
		return nil, err
	}
	centerUUID, err := uuid.Parse(tc.CenterID)
	if err != nil {
		return nil, &ForbiddenError{Reason: "invalid tenant context"}
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("student detail: begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }()
	if err := store.SetTenantContext(ctx, tx, tc); err != nil {
		return nil, fmt.Errorf("student detail: %w", err)
	}
	q := generated.New(tx)
	centerPg := pgUUID(centerUUID)
	studentPg := pgUUID(studentID)
	teacherScope, err := s.teacherScope(tc)
	if err != nil {
		return nil, err
	}
	nowPg := pgtype.Timestamptz{Time: s.clk.Now(), Valid: true}

	membership, err := q.GetStudentMembership(ctx, generated.GetStudentMembershipParams{
		CenterID:  centerPg,
		StudentID: studentPg,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, studentNotFound(studentID)
		}
		return nil, fmt.Errorf("student detail: membership: %w", err)
	}

	classesRows, err := q.ListStudentEnrolledClasses(ctx, generated.ListStudentEnrolledClassesParams{
		StudentID: studentPg,
		TeacherID: teacherScope,
	})
	if err != nil {
		return nil, fmt.Errorf("student detail: classes: %w", err)
	}
	// Teacher non-disclosure: a teacher with zero caller-visible enrolled classes
	// for this student cannot see them (D11) → 404, never 403.
	if tc.Role == model.RoleTeacher && len(classesRows) == 0 {
		return nil, studentNotFound(studentID)
	}

	perSkillRows, err := q.StudentPerSkillBands(ctx, generated.StudentPerSkillBandsParams{
		CenterID:  centerPg,
		StudentID: studentPg,
		TeacherID: teacherScope,
	})
	if err != nil {
		return nil, fmt.Errorf("student detail: per-skill: %w", err)
	}
	attendance, err := q.GetStudentAttendanceStats(ctx, generated.GetStudentAttendanceStatsParams{
		CenterID:  centerPg,
		StudentID: studentPg,
		TeacherID: teacherScope,
	})
	if err != nil {
		return nil, fmt.Errorf("student detail: attendance: %w", err)
	}
	subStats, err := q.GetStudentSubmissionStats(ctx, generated.GetStudentSubmissionStatsParams{
		CenterID:  centerPg,
		StudentID: studentPg,
		TeacherID: teacherScope,
		Now:       nowPg,
	})
	if err != nil {
		return nil, fmt.Errorf("student detail: submission stats: %w", err)
	}
	atRiskInputs, err := q.GetStudentAtRiskInputs(ctx, generated.GetStudentAtRiskInputsParams{
		StudentID: studentPg,
		TeacherID: teacherScope,
		Now:       nowPg,
	})
	if err != nil {
		return nil, fmt.Errorf("student detail: at-risk inputs: %w", err)
	}
	delta, err := q.GetStudentBandDelta(ctx, generated.GetStudentBandDeltaParams{
		StudentID: studentPg,
		TeacherID: teacherScope,
	})
	if err != nil {
		return nil, fmt.Errorf("student detail: band delta: %w", err)
	}
	noteRows, err := q.ListStudentNotes(ctx, generated.ListStudentNotesParams{
		CenterID:  centerPg,
		StudentID: studentPg,
	})
	if err != nil {
		return nil, fmt.Errorf("student detail: notes: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("student detail: commit: %w", err)
	}

	overallBand := numericToFloatPtr(atRiskInputs.OverallBand)
	atRisk := s.detector.Classify(AtRiskInputs{
		AttendancePresentLate: int(attendance.PresentLate),
		AttendanceTotalMarked: int(attendance.TotalMarked),
		ConsecutiveMissed:     int(atRiskInputs.ConsecutiveMissed),
		RecentReleasedBands:   atRiskInputs.RecentReleasedBands,
		OverallBand:           overallBand,
		ClassTargetBand:       numericToFloatPtr(atRiskInputs.ClassTargetBand),
	})

	detail := &StudentDetail{
		Profile: StudentProfile{
			StudentID:    studentID,
			Name:         membership.Name,
			Email:        membership.Email,
			AvatarURL:    pgTextToPtr(membership.AvatarUrl),
			LanguagePref: membership.LanguagePref,
			JoinedAt:     membership.JoinedAt.Time,
		},
		EnrolledClasses: make([]StudentDetailClass, 0, len(classesRows)),
		PerformanceSummary: StudentPerformanceSummary{
			OverallBand:         overallBand,
			PerSkill:            perSkillFromRows(perSkillRows),
			AttendanceRate:      ratePtr(attendance.PresentLate, attendance.TotalMarked),
			PendingCount:        int(subStats.PendingCount),
			MissingCount:        int(subStats.MissingCount),
			OnTimeRate:          ratePtr(subStats.OnTimeCount, subStats.SubmittedCount),
			CurrentVsFirstDelta: deltaPtr(delta.CurrentAvg, delta.FirstAvg),
		},
		AtRisk: StudentAtRisk{Status: atRisk.Status, Reasons: atRisk.Reasons},
		Notes:  make([]StudentNoteView, 0, len(noteRows)),
	}
	for _, c := range classesRows {
		detail.EnrolledClasses = append(detail.EnrolledClasses, StudentDetailClass{
			ClassID:     uuidFromPg(c.ClassID),
			ClassName:   c.ClassName,
			TeacherName: pgTextToPtr(c.TeacherName),
			TargetBand:  numericToFloatPtr(c.TargetBand),
		})
	}
	for _, n := range noteRows {
		detail.Notes = append(detail.Notes, noteRowToView(n))
	}
	return detail, nil
}

// ---------------- Notes ----------------

// ListNotes returns a student's non-deleted notes chronologically (AC13),
// role-scoped exactly as the detail read.
func (s *StudentService) ListNotes(
	ctx context.Context, tc model.TenantContext, studentID uuid.UUID,
) ([]StudentNoteView, error) {
	if err := assertStudentReadRole(tc); err != nil {
		return nil, err
	}
	centerUUID, err := uuid.Parse(tc.CenterID)
	if err != nil {
		return nil, &ForbiddenError{Reason: "invalid tenant context"}
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("list notes: begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }()
	if err := store.SetTenantContext(ctx, tx, tc); err != nil {
		return nil, fmt.Errorf("list notes: %w", err)
	}
	q := generated.New(tx)
	if err := s.assertStudentVisible(ctx, q, tc, centerUUID, studentID); err != nil {
		return nil, err
	}
	rows, err := q.ListStudentNotes(ctx, generated.ListStudentNotesParams{
		CenterID:  pgUUID(centerUUID),
		StudentID: pgUUID(studentID),
	})
	if err != nil {
		return nil, fmt.Errorf("list notes: query: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("list notes: commit: %w", err)
	}
	out := make([]StudentNoteView, 0, len(rows))
	for _, n := range rows {
		out = append(out, noteRowToView(n))
	}
	return out, nil
}

// CreateNote creates a staff note on a student (AC12). SEC-1: re-validate the
// caller's DB role (staff-only) + visibility inside the tx. Empty content → 422.
func (s *StudentService) CreateNote(
	ctx context.Context, tc model.TenantContext, studentID uuid.UUID, content string, flagged bool,
) (*StudentNoteView, error) {
	content = strings.TrimSpace(content)
	if content == "" {
		return nil, model.ValidationError{Fields: []model.FieldError{{Field: "content", Message: "content is required"}}}
	}
	centerUUID, callerUUID, err := parseTenantIDs(tc)
	if err != nil {
		return nil, err
	}
	tx, q, _, err := s.beginNoteWrite(ctx, tc, centerUUID, callerUUID, studentID)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }()

	note, err := q.InsertStudentNote(ctx, generated.InsertStudentNoteParams{
		CenterID:  pgUUID(centerUUID),
		StudentID: pgUUID(studentID),
		AuthorID:  pgUUID(callerUUID),
		Content:   content,
		Flagged:   flagged,
	})
	if err != nil {
		return nil, fmt.Errorf("create note: insert: %w", err)
	}
	author, err := q.GetUserByID(ctx, pgUUID(callerUUID))
	if err != nil {
		return nil, fmt.Errorf("create note: author: %w", err)
	}
	if err := s.audit.LogWithinTx(ctx, tx, tc, studentNoteCreatedAction, studentNoteAuditEntity, uuidFromPg(note.ID),
		Changes{After: map[string]any{"studentId": studentID.String(), "flagged": flagged}}); err != nil {
		return nil, fmt.Errorf("create note: audit: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("create note: commit: %w", err)
	}
	return &StudentNoteView{
		NoteID:     uuidFromPg(note.ID),
		AuthorName: author.FullName,
		Content:    note.Content,
		Flagged:    note.Flagged,
		CreatedAt:  note.CreatedAt.Time,
	}, nil
}

// SetNoteFlag toggles a note's flag (AC14). Staff-only + visibility (SEC-1). An
// unknown / deleted / cross-tenant note → 404 NOTE_NOT_FOUND.
func (s *StudentService) SetNoteFlag(
	ctx context.Context, tc model.TenantContext, studentID, noteID uuid.UUID, flagged bool,
) (*StudentNoteView, error) {
	centerUUID, callerUUID, err := parseTenantIDs(tc)
	if err != nil {
		return nil, err
	}
	tx, q, _, err := s.beginNoteWrite(ctx, tc, centerUUID, callerUUID, studentID)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }()

	if _, err := s.resolveNote(ctx, q, centerUUID, studentID, noteID); err != nil {
		return nil, err
	}
	updated, err := q.SetStudentNoteFlag(ctx, generated.SetStudentNoteFlagParams{
		CenterID: pgUUID(centerUUID),
		NoteID:   pgUUID(noteID),
		Flagged:  flagged,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, noteNotFound(noteID)
		}
		return nil, fmt.Errorf("set note flag: %w", err)
	}
	author, err := q.GetUserByID(ctx, updated.AuthorID)
	if err != nil {
		return nil, fmt.Errorf("set note flag: author: %w", err)
	}
	if err := s.audit.LogWithinTx(ctx, tx, tc, studentNoteFlaggedAction, studentNoteAuditEntity, noteID,
		Changes{After: map[string]any{"flagged": flagged}}); err != nil {
		return nil, fmt.Errorf("set note flag: audit: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("set note flag: commit: %w", err)
	}
	return &StudentNoteView{
		NoteID:     uuidFromPg(updated.ID),
		AuthorName: author.FullName,
		Content:    updated.Content,
		Flagged:    updated.Flagged,
		CreatedAt:  updated.CreatedAt.Time,
	}, nil
}

// DeleteNote soft-deletes a note (AC14). Author OR Owner/Admin only — a teacher
// deleting another author's note → 403 FORBIDDEN. Unknown note → 404.
func (s *StudentService) DeleteNote(
	ctx context.Context, tc model.TenantContext, studentID, noteID uuid.UUID,
) error {
	centerUUID, callerUUID, err := parseTenantIDs(tc)
	if err != nil {
		return err
	}
	tx, q, callerRole, err := s.beginNoteWrite(ctx, tc, centerUUID, callerUUID, studentID)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }()

	note, err := s.resolveNote(ctx, q, centerUUID, studentID, noteID)
	if err != nil {
		return err
	}
	// Author-or-owner/admin guard (D11/AC14). A teacher may delete only their own
	// note; owner/admin may delete any. SEC-1: the elevation is decided on the
	// DB-revalidated callerRole, NOT tc.Role — a demoted admin holding a stale
	// admin JWT must not retain delete-any within the 15-min token window.
	isAuthor := uuidFromPg(note.AuthorID) == callerUUID
	if !isAuthor && callerRole != model.RoleOwner && callerRole != model.RoleAdmin {
		return model.ForbiddenError{Reason: "only the author or an owner/admin can delete this note"}
	}
	rows, err := q.SoftDeleteStudentNote(ctx, generated.SoftDeleteStudentNoteParams{
		CenterID: pgUUID(centerUUID),
		NoteID:   pgUUID(noteID),
	})
	if err != nil {
		return fmt.Errorf("delete note: %w", err)
	}
	if rows == 0 {
		return noteNotFound(noteID)
	}
	if err := s.audit.LogWithinTx(ctx, tx, tc, studentNoteDeletedAction, studentNoteAuditEntity, noteID,
		Changes{After: map[string]any{"studentId": studentID.String()}}); err != nil {
		return fmt.Errorf("delete note: audit: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("delete note: commit: %w", err)
	}
	return nil
}

// ---------------- helpers ----------------

// beginNoteWrite opens a tenant-scoped tx, re-validates the caller's DB role is
// staff (SEC-1 — a stale-JWT student/demoted caller is 403), and asserts the
// target student is visible to the caller (else 404). The caller owns the tx.
func (s *StudentService) beginNoteWrite(
	ctx context.Context, tc model.TenantContext, centerUUID, callerUUID, studentID uuid.UUID,
) (pgx.Tx, *generated.Queries, model.Role, error) {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, nil, "",fmt.Errorf("note write: begin tx: %w", err)
	}
	if err := store.SetTenantContext(ctx, tx, tc); err != nil {
		_ = tx.Rollback(context.WithoutCancel(ctx))
		return nil, nil, "",fmt.Errorf("note write: %w", err)
	}
	q := generated.New(tx)

	// SEC-1 — re-validate the caller's role from center_members, not the JWT.
	member, err := q.GetCenterMemberByUserAndCenter(ctx, generated.GetCenterMemberByUserAndCenterParams{
		UserID:   pgUUID(callerUUID),
		CenterID: pgUUID(centerUUID),
	})
	if err != nil {
		_ = tx.Rollback(context.WithoutCancel(ctx))
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil, "",&ForbiddenError{Reason: "insufficient role"}
		}
		return nil, nil, "",fmt.Errorf("note write: re-validate role: %w", err)
	}
	if member.Role != model.RoleOwner && member.Role != model.RoleAdmin && member.Role != model.RoleTeacher {
		_ = tx.Rollback(context.WithoutCancel(ctx))
		return nil, nil, "",&ForbiddenError{Reason: "insufficient role"}
	}

	if err := s.assertStudentVisible(ctx, q, tc, centerUUID, studentID); err != nil {
		_ = tx.Rollback(context.WithoutCancel(ctx))
		return nil, nil, "", err
	}
	// Return the DB-revalidated role (SEC-1) so callers make privilege decisions
	// on it, never on the possibly-stale JWT tc.Role.
	return tx, q, member.Role, nil
}

// assertStudentVisible resolves student membership + teacher-scope. A non-student
// / non-member, or a student outside the teacher's classes → 404 STUDENT_NOT_FOUND
// (D11 non-disclosure). Runs on the caller-provided (already tenant-scoped) tx.
func (s *StudentService) assertStudentVisible(
	ctx context.Context, q *generated.Queries, tc model.TenantContext, centerUUID, studentID uuid.UUID,
) error {
	if _, err := q.GetStudentMembership(ctx, generated.GetStudentMembershipParams{
		CenterID:  pgUUID(centerUUID),
		StudentID: pgUUID(studentID),
	}); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return studentNotFound(studentID)
		}
		return fmt.Errorf("resolve student membership: %w", err)
	}
	if tc.Role != model.RoleTeacher {
		return nil
	}
	teacherScope, err := s.teacherScope(tc)
	if err != nil {
		return err
	}
	classes, err := q.ListStudentEnrolledClasses(ctx, generated.ListStudentEnrolledClassesParams{
		StudentID: pgUUID(studentID),
		TeacherID: teacherScope,
	})
	if err != nil {
		return fmt.Errorf("resolve teacher scope: %w", err)
	}
	if len(classes) == 0 {
		return studentNotFound(studentID)
	}
	return nil
}

// resolveNote fetches a non-deleted note in the tenant, scoped to the student.
// Absent / cross-tenant / deleted / wrong-student → 404 NOTE_NOT_FOUND.
func (s *StudentService) resolveNote(
	ctx context.Context, q *generated.Queries, centerUUID, studentID, noteID uuid.UUID,
) (generated.StudentNote, error) {
	note, err := q.GetStudentNote(ctx, generated.GetStudentNoteParams{
		CenterID: pgUUID(centerUUID),
		NoteID:   pgUUID(noteID),
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return generated.StudentNote{}, noteNotFound(noteID)
		}
		return generated.StudentNote{}, fmt.Errorf("resolve note: %w", err)
	}
	if uuidFromPg(note.StudentID) != studentID {
		return generated.StudentNote{}, noteNotFound(noteID)
	}
	return note, nil
}

// teacherScope returns a Valid teacher-id filter iff the caller is a teacher
// (their own userId), else an invalid pgtype.UUID (center-wide).
func (s *StudentService) teacherScope(tc model.TenantContext) (pgtype.UUID, error) {
	if tc.Role != model.RoleTeacher {
		return pgtype.UUID{Valid: false}, nil
	}
	callerUUID, err := uuid.Parse(tc.UserID)
	if err != nil {
		return pgtype.UUID{}, &ForbiddenError{Reason: "invalid tenant context"}
	}
	return pgUUID(callerUUID), nil
}

func assertStudentReadRole(tc model.TenantContext) error {
	switch tc.Role {
	case model.RoleOwner, model.RoleAdmin, model.RoleTeacher:
		return nil
	default:
		return &ForbiddenError{Reason: "insufficient role"}
	}
}

func parseTenantIDs(tc model.TenantContext) (center, caller uuid.UUID, err error) {
	center, err = uuid.Parse(tc.CenterID)
	if err != nil {
		return uuid.Nil, uuid.Nil, &ForbiddenError{Reason: "invalid tenant context"}
	}
	caller, err = uuid.Parse(tc.UserID)
	if err != nil {
		return uuid.Nil, uuid.Nil, &ForbiddenError{Reason: "invalid tenant context"}
	}
	return center, caller, nil
}

func studentNotFound(id uuid.UUID) error {
	return model.NotFoundError{Resource: "student", ID: id.String(), Code: studentNotFoundCode}
}

func noteNotFound(id uuid.UUID) error {
	return model.NotFoundError{Resource: "note", ID: id.String(), Code: noteNotFoundCode}
}

func noteRowToView(n generated.ListStudentNotesRow) StudentNoteView {
	return StudentNoteView{
		NoteID:     uuidFromPg(n.ID),
		AuthorName: n.AuthorName,
		Content:    n.Content,
		Flagged:    n.Flagged,
		CreatedAt:  n.CreatedAt.Time,
	}
}

// enrolledClassJSON is the jsonb_build_object shape from ListStudents.enrolled_classes.
type enrolledClassJSON struct {
	ClassID     string  `json:"classId"`
	ClassName   string  `json:"className"`
	TeacherID   *string `json:"teacherId"`
	TeacherName *string `json:"teacherName"`
}

func decodeEnrolledClasses(raw string) []StudentEnrolledClassLite {
	if raw == "" {
		return []StudentEnrolledClassLite{}
	}
	var decoded []enrolledClassJSON
	if err := json.Unmarshal([]byte(raw), &decoded); err != nil {
		return []StudentEnrolledClassLite{}
	}
	out := make([]StudentEnrolledClassLite, 0, len(decoded))
	for _, c := range decoded {
		id, err := uuid.Parse(c.ClassID)
		if err != nil {
			continue
		}
		out = append(out, StudentEnrolledClassLite{
			ClassID:     id,
			ClassName:   c.ClassName,
			TeacherID:   c.TeacherID,
			TeacherName: c.TeacherName,
		})
	}
	return out
}

// distinctTeacherNames returns each visible teacher once, deduplicated by teacher
// id (not display name) so two distinct teachers sharing a name are not collapsed.
func distinctTeacherNames(classes []StudentEnrolledClassLite) []string {
	seen := make(map[string]struct{}, len(classes))
	out := make([]string, 0, len(classes))
	for _, c := range classes {
		if c.TeacherID == nil || c.TeacherName == nil {
			continue
		}
		if _, ok := seen[*c.TeacherID]; ok {
			continue
		}
		seen[*c.TeacherID] = struct{}{}
		out = append(out, *c.TeacherName)
	}
	return out
}

func perSkillFromRows(rows []generated.StudentPerSkillBandsRow) StudentPerSkill {
	bySkill := make(map[string]*float64, len(rows))
	for _, r := range rows {
		bySkill[r.Skill] = numericToFloatPtr(r.AvgBand)
	}
	// Only the 4 IELTS skills are surfaced (D6); grammar/vocabulary/general are
	// excluded from the 4-box breakdown here (still counted in overallBand).
	return StudentPerSkill{
		Reading:   bySkill["reading"],
		Listening: bySkill["listening"],
		Writing:   bySkill["writing"],
		Speaking:  bySkill["speaking"],
	}
}

// ratePtr returns num/denom as a pointer, or nil when denom is 0 (insufficient
// data — never a misleading 0.0).
func ratePtr(num, denom int64) *float64 {
	if denom <= 0 {
		return nil
	}
	r := float64(num) / float64(denom)
	return &r
}

func deltaPtr(current, first pgtype.Numeric) *float64 {
	c := numericToFloatPtr(current)
	f := numericToFloatPtr(first)
	if c == nil || f == nil {
		return nil
	}
	d := *c - *f
	return &d
}

func numericToFloatPtr(n pgtype.Numeric) *float64 {
	if !n.Valid {
		return nil
	}
	v, err := n.Float64Value()
	if err != nil || !v.Valid {
		return nil
	}
	f := v.Float64
	return &f
}

func pgTextToPtr(t pgtype.Text) *string {
	if !t.Valid {
		return nil
	}
	v := t.String
	return &v
}
