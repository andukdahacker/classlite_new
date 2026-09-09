// Package service — Story 3.4.5 + 7.3a EnrollmentService.
//
// Enrollments are the student↔class linkage table. Story 3.4.5 shipped the Add
// case + the roster list; Story 7.3a adds the withdraw/transfer transitions, the
// immutable enrollment_history audit trail (one row per action, same tx), the
// enrollable-target guard (D3), best-effort notify email + the enrollment.changed
// event, and the s43 needs-attention reads.
//
// Authz (SEC-1, service-layer — never RLS):
//   - Every mutating action (Add/Transfer/Withdraw) is Admin/Owner ONLY,
//     re-validated from center_members (NOT the JWT claim, which can be up to 15
//     min stale, EDGE-2) — a Teacher/Student caller is 403 INSUFFICIENT_ROLE.
//   - ListEnrolledStudentsByClass allows owner/admin/teacher; a teacher may only
//     list a class assigned to them (cross-teacher → 404 CLASS_NOT_FOUND).
//
// Atomicity (R17): the enrollment state change + the enrollment_history INSERT +
// the audit row all ride ONE tenant tx; the email + event fire only AFTER commit
// (best-effort, never inside the tx).
package service

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/event"
	"github.com/ducdo/classlite-api/internal/model"
	"github.com/ducdo/classlite-api/internal/store"
	"github.com/ducdo/classlite-api/internal/store/generated"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
)

const (
	enrollmentCreatedAction     = "enrollment.created"
	enrollmentTransferredAction = "enrollment.transferred"
	enrollmentWithdrawnAction   = "enrollment.withdrawn"
	enrollmentAuditEntity       = "enrollment"

	alreadyEnrolledCode = "ALREADY_ENROLLED"

	// Enrollment action verbs (also the enrollment_history.action values). Exported
	// so the handler dispatches on the same constants.
	EnrollmentActionAdd      = "add"
	EnrollmentActionTransfer = "transfer"
	EnrollmentActionWithdraw = "withdraw"
)

// D3 enrollable target states — an Add/Transfer target must be one of these.
// classStatusUpcoming / classStatusActive are shared with student_import_service.go.

// EnrolledStudent is the enrichment of a single enrollment row with the joined
// student display fields — the shape both endpoints render into the api.yaml
// Enrollment (POST returns the affected row; the list JOINs directly).
type EnrolledStudent struct {
	Enrollment   generated.Enrollment
	StudentName  string
	StudentEmail string
}

// EnrollmentService owns the Add/Transfer/Withdraw actions, the class roster read,
// and the needs-attention reads.
type EnrollmentService struct {
	db         AuthDB
	audit      AuditLogger
	clk        clock.Clock
	events     *event.Bus
	emailQueue EmailRetryQueue
}

// NewEnrollmentService constructs an EnrollmentService bound to the given seams.
// events + emailQueue are the post-commit notify seams (AC14/AC15); both are
// nil-tolerant (a nil queue skips email, a nil bus skips the event) so lean test
// harnesses can omit them.
func NewEnrollmentService(db AuthDB, audit AuditLogger, clk clock.Clock, events *event.Bus, emailQueue EmailRetryQueue) *EnrollmentService {
	return &EnrollmentService{db: db, audit: audit, clk: clk, events: events, emailQueue: emailQueue}
}

// alreadyEnrolledConflict is the 409 raised when an active enrollment already
// exists for the (class, student) pair.
func alreadyEnrolledConflict() error {
	return model.ConflictError{Code: alreadyEnrolledCode, Message: "student is already enrolled in this class"}
}

// AddEnrollment links an existing student member to a class (AC2, retrofit of the
// 3.4.5 Add). One atomic tenant tx: role re-fetch → target enrollable → is-student
// -member → not-already-active → insert → enrollment_history 'add' row → audit.
// Email + event fire post-commit.
func (s *EnrollmentService) AddEnrollment(
	ctx context.Context, tc model.TenantContext, studentID, toClassID uuid.UUID, effectiveDate time.Time, note *string,
) (EnrolledStudent, error) {
	tx, txQ, centerUUID, performerUUID, err := s.beginEnrollmentWrite(ctx, tc)
	if err != nil {
		return EnrolledStudent{}, err
	}
	defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }()

	toClass, err := resolveEnrollmentClass(ctx, txQ, toClassID)
	if err != nil {
		return EnrolledStudent{}, err
	}
	if err := assertEnrollable(toClass.ClassStatus); err != nil {
		return EnrolledStudent{}, err
	}

	// studentId must be a `student` center-member of this center (AC2).
	isStudent, err := txQ.IsStudentMemberOfCenter(ctx, generated.IsStudentMemberOfCenterParams{
		CenterID: pgUUID(centerUUID),
		UserID:   pgUUID(studentID),
	})
	if err != nil {
		return EnrolledStudent{}, fmt.Errorf("add enrollment: is student member: %w", err)
	}
	if !isStudent {
		return EnrolledStudent{}, &NotAStudentMemberError{StudentID: studentID.String()}
	}

	enrollment, err := insertActiveEnrollment(ctx, txQ, centerUUID, studentID, toClassID)
	if err != nil {
		return EnrolledStudent{}, err
	}

	student, err := txQ.GetUserByID(ctx, pgUUID(studentID))
	if err != nil {
		return EnrolledStudent{}, fmt.Errorf("add enrollment: get student: %w", err)
	}

	toID := toClassID
	if err := s.insertHistory(ctx, txQ, centerUUID, studentID, performerUUID, EnrollmentActionAdd, nil, &toID, effectiveDate, note); err != nil {
		return EnrolledStudent{}, fmt.Errorf("add enrollment: history: %w", err)
	}
	if err := s.audit.LogWithinTx(ctx, tx, tc, enrollmentCreatedAction, enrollmentAuditEntity, uuidFromPg(enrollment.ID),
		Changes{After: map[string]any{"student_id": studentID.String(), "class_id": toClassID.String(), "status": enrollment.Status}}); err != nil {
		return EnrolledStudent{}, fmt.Errorf("add enrollment: audit: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return EnrolledStudent{}, fmt.Errorf("add enrollment: commit: %w", err)
	}

	s.notify(ctx, tc, enrollmentNotice{
		action:            EnrollmentActionAdd,
		studentName:       student.FullName,
		studentEmail:      student.Email,
		toClassName:       toClass.ClassName,
		teacherRecipients: teacherRecipientsOf(toClass),
		enrollmentID:      uuidFromPg(enrollment.ID).String(),
		studentID:         studentID.String(),
		toClassID:         ptrUUIDString(toClassID),
	})
	return EnrolledStudent{Enrollment: enrollment, StudentName: student.FullName, StudentEmail: student.Email}, nil
}

// CreateEnrollment is the back-compat entry point for the legacy 3.4.5 Add body
// ({studentId, classId}); it routes through the full AddEnrollment path (history +
// notify + event + enrollable guard) with a server-today effective date.
func (s *EnrollmentService) CreateEnrollment(
	ctx context.Context, tc model.TenantContext, studentID, classID uuid.UUID,
) (EnrolledStudent, error) {
	return s.AddEnrollment(ctx, tc, studentID, classID, s.clk.Now(), nil)
}

// TransferEnrollment moves a student from an active source enrollment to a new
// active target enrollment (AC3). One atomic tenant tx: role re-fetch → target
// enrollable → flip source to 'transferred' → create target active (a target
// collision → 409 rolls the whole tx back, restoring the source) → one
// enrollment_history 'transfer' row → audit. Email (student + both teachers) +
// event fire post-commit.
func (s *EnrollmentService) TransferEnrollment(
	ctx context.Context, tc model.TenantContext, studentID, fromClassID, toClassID uuid.UUID, effectiveDate time.Time, note *string,
) (EnrolledStudent, error) {
	// A same-class transfer would flip the active row to 'transferred' and then
	// insert a fresh active row in the SAME class (the just-flipped row no longer
	// blocks the uq_enrollments_active pre-check) — corrupting the audit trail with
	// a from=to no-op reported as a 200. Reject before any writes.
	if fromClassID == toClassID {
		return EnrolledStudent{}, model.ValidationError{Fields: []model.FieldError{{
			Field: "toClassId", Message: "transfer target must differ from the source class",
		}}}
	}
	tx, txQ, centerUUID, performerUUID, err := s.beginEnrollmentWrite(ctx, tc)
	if err != nil {
		return EnrolledStudent{}, err
	}
	defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }()

	toClass, err := resolveEnrollmentClass(ctx, txQ, toClassID)
	if err != nil {
		return EnrolledStudent{}, err
	}
	if err := assertEnrollable(toClass.ClassStatus); err != nil {
		return EnrolledStudent{}, err
	}

	// Resolve the source class best-effort for the notify body/teacher. A missing
	// source class is NOT a 404 here — the source-UPDATE 0-rows path below is the
	// authoritative "no active enrollment in source" → 422 NOT_ENROLLED_IN_SOURCE.
	fromClass, fromErr := txQ.GetEnrollmentClass(ctx, pgUUID(fromClassID))
	if fromErr != nil && !errors.Is(fromErr, pgx.ErrNoRows) {
		return EnrolledStudent{}, fmt.Errorf("transfer enrollment: get source class: %w", fromErr)
	}

	// Flip the source's active enrollment to 'transferred' (0 rows → no active source).
	if _, err := txQ.TransferEnrollmentSource(ctx, generated.TransferEnrollmentSourceParams{
		ClassID:     pgUUID(fromClassID),
		StudentID:   pgUUID(studentID),
		WithdrawnAt: pgTimestamptz(effectiveDate),
	}); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return EnrolledStudent{}, &NotEnrolledInSourceError{}
		}
		return EnrolledStudent{}, fmt.Errorf("transfer enrollment: source: %w", err)
	}

	// Create the target active enrollment. A collision (already active in target)
	// → 409 ALREADY_ENROLLED, which rolls back the source flip above (atomicity).
	enrollment, err := insertActiveEnrollment(ctx, txQ, centerUUID, studentID, toClassID)
	if err != nil {
		return EnrolledStudent{}, err
	}

	student, err := txQ.GetUserByID(ctx, pgUUID(studentID))
	if err != nil {
		return EnrolledStudent{}, fmt.Errorf("transfer enrollment: get student: %w", err)
	}

	fromID, toID := fromClassID, toClassID
	if err := s.insertHistory(ctx, txQ, centerUUID, studentID, performerUUID, EnrollmentActionTransfer, &fromID, &toID, effectiveDate, note); err != nil {
		return EnrolledStudent{}, fmt.Errorf("transfer enrollment: history: %w", err)
	}
	if err := s.audit.LogWithinTx(ctx, tx, tc, enrollmentTransferredAction, enrollmentAuditEntity, uuidFromPg(enrollment.ID),
		Changes{After: map[string]any{"student_id": studentID.String(), "from_class_id": fromClassID.String(), "to_class_id": toClassID.String(), "status": enrollment.Status}}); err != nil {
		return EnrolledStudent{}, fmt.Errorf("transfer enrollment: audit: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return EnrolledStudent{}, fmt.Errorf("transfer enrollment: commit: %w", err)
	}

	s.notify(ctx, tc, enrollmentNotice{
		action:            EnrollmentActionTransfer,
		studentName:       student.FullName,
		studentEmail:      student.Email,
		fromClassName:     classNameOrEmpty(fromClass, fromErr),
		toClassName:       toClass.ClassName,
		teacherRecipients: append(teacherRecipientsOf(fromClass), teacherRecipientsOf(toClass)...),
		enrollmentID:      uuidFromPg(enrollment.ID).String(),
		studentID:         studentID.String(),
		fromClassID:       ptrUUIDString(fromClassID),
		toClassID:         ptrUUIDString(toClassID),
	})
	return EnrolledStudent{Enrollment: enrollment, StudentName: student.FullName, StudentEmail: student.Email}, nil
}

// WithdrawEnrollment sets a student's active enrollment in a class to 'withdrawn'
// (AC4). One atomic tenant tx: role re-fetch → withdraw (0 rows → 422
// NOT_ENROLLED_IN_SOURCE) → one enrollment_history 'withdraw' row → audit. Email
// (student + source teacher) + event fire post-commit.
func (s *EnrollmentService) WithdrawEnrollment(
	ctx context.Context, tc model.TenantContext, studentID, fromClassID uuid.UUID, effectiveDate time.Time, note *string,
) (EnrolledStudent, error) {
	tx, txQ, centerUUID, performerUUID, err := s.beginEnrollmentWrite(ctx, tc)
	if err != nil {
		return EnrolledStudent{}, err
	}
	defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }()

	fromClass, fromErr := txQ.GetEnrollmentClass(ctx, pgUUID(fromClassID))
	if fromErr != nil && !errors.Is(fromErr, pgx.ErrNoRows) {
		return EnrolledStudent{}, fmt.Errorf("withdraw enrollment: get class: %w", fromErr)
	}

	enrollment, err := txQ.WithdrawEnrollment(ctx, generated.WithdrawEnrollmentParams{
		ClassID:     pgUUID(fromClassID),
		StudentID:   pgUUID(studentID),
		WithdrawnAt: pgTimestamptz(effectiveDate),
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return EnrolledStudent{}, &NotEnrolledInSourceError{}
		}
		return EnrolledStudent{}, fmt.Errorf("withdraw enrollment: update: %w", err)
	}

	student, err := txQ.GetUserByID(ctx, pgUUID(studentID))
	if err != nil {
		return EnrolledStudent{}, fmt.Errorf("withdraw enrollment: get student: %w", err)
	}

	fromID := fromClassID
	if err := s.insertHistory(ctx, txQ, centerUUID, studentID, performerUUID, EnrollmentActionWithdraw, &fromID, nil, effectiveDate, note); err != nil {
		return EnrolledStudent{}, fmt.Errorf("withdraw enrollment: history: %w", err)
	}
	if err := s.audit.LogWithinTx(ctx, tx, tc, enrollmentWithdrawnAction, enrollmentAuditEntity, uuidFromPg(enrollment.ID),
		Changes{After: map[string]any{"student_id": studentID.String(), "from_class_id": fromClassID.String(), "status": enrollment.Status}}); err != nil {
		return EnrolledStudent{}, fmt.Errorf("withdraw enrollment: audit: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return EnrolledStudent{}, fmt.Errorf("withdraw enrollment: commit: %w", err)
	}

	s.notify(ctx, tc, enrollmentNotice{
		action:            EnrollmentActionWithdraw,
		studentName:       student.FullName,
		studentEmail:      student.Email,
		fromClassName:     classNameOrEmpty(fromClass, fromErr),
		teacherRecipients: teacherRecipientsOf(fromClass),
		enrollmentID:      uuidFromPg(enrollment.ID).String(),
		studentID:         studentID.String(),
		fromClassID:       ptrUUIDString(fromClassID),
	})
	return EnrolledStudent{Enrollment: enrollment, StudentName: student.FullName, StudentEmail: student.Email}, nil
}

// ListEnrollmentHistory returns the center-wide immutable history, newest-first,
// paginated (AC11). Admin/Owner only. Optional student/class filters.
func (s *EnrollmentService) ListEnrollmentHistory(
	ctx context.Context, tc model.TenantContext, page, pageSize int, studentID, classID *uuid.UUID,
) ([]generated.ListEnrollmentHistoryPagedRow, PageResult, error) {
	if err := assertAdminOrOwner(tc); err != nil {
		return nil, PageResult{}, err
	}
	page, pageSize, offset := clampPagination(page, pageSize)

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, PageResult{}, fmt.Errorf("list history: begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }()
	if err := store.SetTenantContext(ctx, tx, tc); err != nil {
		return nil, PageResult{}, fmt.Errorf("list history: %w", err)
	}
	txQ := generated.New(tx)

	rows, err := txQ.ListEnrollmentHistoryPaged(ctx, generated.ListEnrollmentHistoryPagedParams{
		StudentID: pgUUIDPtr(studentID),
		ClassID:   pgUUIDPtr(classID),
		Limit:     int32(pageSize),
		Offset:    int32(offset),
	})
	if err != nil {
		return nil, PageResult{}, fmt.Errorf("list history: query: %w", err)
	}
	total, err := txQ.CountEnrollmentHistory(ctx, generated.CountEnrollmentHistoryParams{
		StudentID: pgUUIDPtr(studentID),
		ClassID:   pgUUIDPtr(classID),
	})
	if err != nil {
		return nil, PageResult{}, fmt.Errorf("list history: count: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, PageResult{}, fmt.Errorf("list history: commit: %w", err)
	}
	return rows, pageResult(page, pageSize, total), nil
}

// NeedsAttention is the s43 needs-attention data (D4): unassigned students +
// over-capacity classes.
type NeedsAttention struct {
	Unassigned       []generated.ListUnassignedStudentsRow
	UnassignedPage   PageResult
	OverCapacity     []generated.ListOverCapacityClassesRow
	OverCapacityPage PageResult
}

// GetNeedsAttention returns the unassigned-student + over-capacity-class data for
// the console (AC12). Admin/Owner only. Both reads are SQL-aggregated (PERF-2).
func (s *EnrollmentService) GetNeedsAttention(
	ctx context.Context, tc model.TenantContext,
	unassignedPage, unassignedPageSize, overCapacityPage, overCapacityPageSize int,
) (NeedsAttention, error) {
	if err := assertAdminOrOwner(tc); err != nil {
		return NeedsAttention{}, err
	}
	centerUUID, err := uuid.Parse(tc.CenterID)
	if err != nil {
		return NeedsAttention{}, &ForbiddenError{Reason: "invalid tenant context"}
	}

	// Each zone paginates independently (XL-2) — a large center never returns an
	// unbounded payload (Ducdo ruling 2026-09-09, DN2).
	uPage, uPageSize, uOffset := clampPagination(unassignedPage, unassignedPageSize)
	oPage, oPageSize, oOffset := clampPagination(overCapacityPage, overCapacityPageSize)

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return NeedsAttention{}, fmt.Errorf("needs attention: begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }()
	if err := store.SetTenantContext(ctx, tx, tc); err != nil {
		return NeedsAttention{}, fmt.Errorf("needs attention: %w", err)
	}
	txQ := generated.New(tx)

	unassigned, err := txQ.ListUnassignedStudents(ctx, generated.ListUnassignedStudentsParams{
		CenterID: pgUUID(centerUUID),
		Limit:    int32(uPageSize),
		Offset:   int32(uOffset),
	})
	if err != nil {
		return NeedsAttention{}, fmt.Errorf("needs attention: unassigned: %w", err)
	}
	unassignedTotal, err := txQ.CountUnassignedStudents(ctx, pgUUID(centerUUID))
	if err != nil {
		return NeedsAttention{}, fmt.Errorf("needs attention: unassigned count: %w", err)
	}
	overCapacity, err := txQ.ListOverCapacityClasses(ctx, generated.ListOverCapacityClassesParams{
		Limit:  int32(oPageSize),
		Offset: int32(oOffset),
	})
	if err != nil {
		return NeedsAttention{}, fmt.Errorf("needs attention: over capacity: %w", err)
	}
	overCapacityTotal, err := txQ.CountOverCapacityClasses(ctx)
	if err != nil {
		return NeedsAttention{}, fmt.Errorf("needs attention: over capacity count: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return NeedsAttention{}, fmt.Errorf("needs attention: commit: %w", err)
	}
	return NeedsAttention{
		Unassigned:       unassigned,
		UnassignedPage:   pageResult(uPage, uPageSize, unassignedTotal),
		OverCapacity:     overCapacity,
		OverCapacityPage: pageResult(oPage, oPageSize, overCapacityTotal),
	}, nil
}

// ListEnrolledStudentsByClass returns the active roster for a class (AC3),
// PAGINATED (CR-3-4-5-3, Story 7.2a D10). Reads run inside a tenant-scoped tx
// (RLS needs it — PERF-1). Role gate allows owner/admin/teacher; a teacher may
// only list a class assigned to them (cross-teacher → 404, teacher-sees-nothing).
func (s *EnrollmentService) ListEnrolledStudentsByClass(
	ctx context.Context, tc model.TenantContext, classID uuid.UUID, page, pageSize int,
) ([]generated.ListEnrolledStudentsByClassPagedRow, PageResult, error) {
	if err := assertClassRole(tc); err != nil {
		return nil, PageResult{}, err
	}
	page, pageSize, offset := clampPagination(page, pageSize)

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, PageResult{}, fmt.Errorf("list enrollments: begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }()

	if err := store.SetTenantContext(ctx, tx, tc); err != nil {
		return nil, PageResult{}, fmt.Errorf("list enrollments: %w", err)
	}
	txQ := generated.New(tx)

	current, err := txQ.GetClassByID(ctx, pgUUID(classID))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, PageResult{}, classNotFound(classID)
		}
		return nil, PageResult{}, fmt.Errorf("list enrollments: get class: %w", err)
	}
	if err := assertTeacherScope(tc, current, classID); err != nil {
		return nil, PageResult{}, err
	}

	rows, err := txQ.ListEnrolledStudentsByClassPaged(ctx, generated.ListEnrolledStudentsByClassPagedParams{
		ClassID: pgUUID(classID),
		Limit:   int32(pageSize),
		Offset:  int32(offset),
	})
	if err != nil {
		return nil, PageResult{}, fmt.Errorf("list enrollments: query: %w", err)
	}
	total, err := txQ.CountEnrolledStudentsByClass(ctx, pgUUID(classID))
	if err != nil {
		return nil, PageResult{}, fmt.Errorf("list enrollments: count: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, PageResult{}, fmt.Errorf("list enrollments: commit: %w", err)
	}
	return rows, pageResult(page, pageSize, total), nil
}

// --- shared internals ---

// beginEnrollmentWrite opens a tenant-scoped tx and re-validates the caller's DB
// role is Admin/Owner (SEC-1 — never tc.Role). Returns the tx (open on success;
// rolled back on its own error paths), the tenant-bound queries, the center UUID,
// and the acting user's UUID (the enrollment_history performer).
func (s *EnrollmentService) beginEnrollmentWrite(
	ctx context.Context, tc model.TenantContext,
) (pgx.Tx, *generated.Queries, uuid.UUID, uuid.UUID, error) {
	centerUUID, err := uuid.Parse(tc.CenterID)
	if err != nil {
		return nil, nil, uuid.Nil, uuid.Nil, &ForbiddenError{Reason: "invalid tenant context"}
	}
	userUUID, err := uuid.Parse(tc.UserID)
	if err != nil {
		return nil, nil, uuid.Nil, uuid.Nil, &ForbiddenError{Reason: "invalid tenant context"}
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, nil, uuid.Nil, uuid.Nil, fmt.Errorf("enrollment write: begin tx: %w", err)
	}
	if err := store.SetTenantContext(ctx, tx, tc); err != nil {
		_ = tx.Rollback(context.WithoutCancel(ctx))
		return nil, nil, uuid.Nil, uuid.Nil, fmt.Errorf("enrollment write: %w", err)
	}
	txQ := generated.New(tx)

	member, err := txQ.GetCenterMemberByUserAndCenter(ctx, generated.GetCenterMemberByUserAndCenterParams{
		UserID:   pgUUID(userUUID),
		CenterID: pgUUID(centerUUID),
	})
	if err != nil {
		_ = tx.Rollback(context.WithoutCancel(ctx))
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil, uuid.Nil, uuid.Nil, &ForbiddenError{Reason: "insufficient role"}
		}
		return nil, nil, uuid.Nil, uuid.Nil, fmt.Errorf("enrollment write: get member: %w", err)
	}
	if member.Role != model.RoleOwner && member.Role != model.RoleAdmin {
		_ = tx.Rollback(context.WithoutCancel(ctx))
		return nil, nil, uuid.Nil, uuid.Nil, &ForbiddenError{Reason: "insufficient role"}
	}
	return tx, txQ, centerUUID, userUUID, nil
}

// assertAdminOrOwner gates the read endpoints (history, attention) on the JWT role
// (read-only — SEC-1 allows JWT role for reads). Teacher/Student → 403.
func assertAdminOrOwner(tc model.TenantContext) error {
	if tc.Role == model.RoleOwner || tc.Role == model.RoleAdmin {
		return nil
	}
	return &ForbiddenError{Reason: "insufficient role"}
}

// resolveEnrollmentClass loads a class for an action; a miss (or teacher-invisible
// row) is 404 CLASS_NOT_FOUND.
func resolveEnrollmentClass(ctx context.Context, txQ *generated.Queries, classID uuid.UUID) (generated.GetEnrollmentClassRow, error) {
	row, err := txQ.GetEnrollmentClass(ctx, pgUUID(classID))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return generated.GetEnrollmentClassRow{}, classNotFound(classID)
		}
		return generated.GetEnrollmentClassRow{}, fmt.Errorf("resolve class: %w", err)
	}
	return row, nil
}

// assertEnrollable enforces D3 — an Add/Transfer target must be upcoming or active;
// paused/ended → 422 CLASS_NOT_ENROLLABLE.
func assertEnrollable(status string) error {
	if status == classStatusUpcoming || status == classStatusActive {
		return nil
	}
	return &ClassNotEnrollableError{Status: status}
}

// insertActiveEnrollment creates an active enrollment (shared by Add + Transfer's
// target). The not-already-active pre-check is the belt; the uq_enrollments_active
// unique violation is the suspenders — both map to 409 ALREADY_ENROLLED.
func insertActiveEnrollment(ctx context.Context, txQ *generated.Queries, centerUUID, studentID, classID uuid.UUID) (generated.Enrollment, error) {
	if _, err := txQ.GetActiveEnrollment(ctx, generated.GetActiveEnrollmentParams{
		ClassID:   pgUUID(classID),
		StudentID: pgUUID(studentID),
	}); err == nil {
		return generated.Enrollment{}, alreadyEnrolledConflict()
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return generated.Enrollment{}, fmt.Errorf("active pre-check: %w", err)
	}

	enrollment, err := txQ.CreateEnrollment(ctx, generated.CreateEnrollmentParams{
		ID:        pgUUID(uuid.New()),
		CenterID:  pgUUID(centerUUID),
		StudentID: pgUUID(studentID),
		ClassID:   pgUUID(classID),
	})
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == pgUniqueViolationCode {
			return generated.Enrollment{}, alreadyEnrolledConflict()
		}
		return generated.Enrollment{}, fmt.Errorf("insert enrollment: %w", err)
	}
	return enrollment, nil
}

// insertHistory appends the single enrollment_history row for an action (R17).
// performed_at is clock-injected; from/to are nil-tolerant.
func (s *EnrollmentService) insertHistory(
	ctx context.Context, txQ *generated.Queries, centerUUID, studentID, performerUUID uuid.UUID,
	action string, fromClassID, toClassID *uuid.UUID, effectiveDate time.Time, note *string,
) error {
	_, err := txQ.InsertEnrollmentHistory(ctx, generated.InsertEnrollmentHistoryParams{
		CenterID:      pgUUID(centerUUID),
		StudentID:     pgUUID(studentID),
		Action:        action,
		FromClassID:   pgUUIDPtr(fromClassID),
		ToClassID:     pgUUIDPtr(toClassID),
		EffectiveDate: pgDate(effectiveDate),
		Note:          pgTextFromPtr(note),
		PerformedBy:   pgUUID(performerUUID),
		PerformedAt:   pgTimestamptz(s.clk.Now()),
	})
	return err
}

// --- notify (post-commit, best-effort) ---

type teacherRecipient struct {
	name  string
	email string
}

// enrollmentNotice is the post-commit notify payload (email + event).
type enrollmentNotice struct {
	action            string
	studentName       string
	studentEmail      string
	fromClassName     string
	toClassName       string
	teacherRecipients []teacherRecipient
	enrollmentID      string
	studentID         string
	fromClassID       *string
	toClassID         *string
}

// notify enqueues the best-effort emails (student + affected teacher(s)) and
// publishes enrollment.changed (AC14/AC15). A full/dropped queue never fails the
// request — the enrollment + history row are the durable contract. Recipients are
// deduped by email so a self-transfer within one teacher's classes emails once.
func (s *EnrollmentService) notify(ctx context.Context, tc model.TenantContext, n enrollmentNotice) {
	if s.emailQueue != nil {
		if n.studentEmail != "" {
			subject, body := RenderEnrollmentChangeStudentEmail(n.studentName, n.action, n.fromClassName, n.toClassName)
			s.emailQueue.Enqueue(EmailJob{To: n.studentEmail, Subject: subject, HTML: body, NextAttemptAt: s.clk.Now()})
		}
		seen := make(map[string]bool)
		for _, tr := range n.teacherRecipients {
			if tr.email == "" || seen[tr.email] {
				continue
			}
			seen[tr.email] = true
			subject, body := RenderEnrollmentChangeTeacherEmail(tr.name, n.studentName, n.action, n.fromClassName, n.toClassName)
			s.emailQueue.Enqueue(EmailJob{To: tr.email, Subject: subject, HTML: body, NextAttemptAt: s.clk.Now()})
		}
	}
	s.publish(ctx, tc, EnrollmentChangedPayload{
		EnrollmentID: n.enrollmentID,
		StudentID:    n.studentID,
		Action:       n.action,
		FromClassID:  n.fromClassID,
		ToClassID:    n.toClassID,
	})
}

// EnrollmentChangedPayload is the event.EnrollmentChanged payload (AC15). PII is
// never logged (the bus logs only type/center/user, EDGE-4).
type EnrollmentChangedPayload struct {
	EnrollmentID string  `json:"enrollmentId"`
	StudentID    string  `json:"studentId"`
	Action       string  `json:"action"`
	FromClassID  *string `json:"fromClassId"`
	ToClassID    *string `json:"toClassId"`
}

// publish fans out enrollment.changed to zero handlers today (Epic 10 subscribes
// later). Nil-tolerant for lean test harnesses.
func (s *EnrollmentService) publish(ctx context.Context, tc model.TenantContext, payload any) {
	if s.events == nil {
		return
	}
	s.events.Publish(ctx, event.Event{
		Type:      event.EnrollmentChanged,
		CenterID:  tc.CenterID,
		UserID:    tc.UserID,
		Payload:   payload,
		Timestamp: s.clk.Now(),
	})
}

// teacherRecipientsOf yields the class's teacher email recipient, or nil when the
// class has no assigned teacher (pending_teacher_email → teacher_email NULL).
func teacherRecipientsOf(c generated.GetEnrollmentClassRow) []teacherRecipient {
	if c.TeacherEmail.Valid && c.TeacherEmail.String != "" {
		name := ""
		if c.TeacherName.Valid {
			name = c.TeacherName.String
		}
		return []teacherRecipient{{name: name, email: c.TeacherEmail.String}}
	}
	return nil
}

// classNameOrEmpty returns the class name unless the class read missed (a
// since-deleted source), in which case the notify body omits it.
func classNameOrEmpty(c generated.GetEnrollmentClassRow, readErr error) string {
	if readErr != nil {
		return ""
	}
	return c.ClassName
}

// pgUUIDPtr converts an optional uuid to a pgtype.UUID (nil → invalid/NULL).
func pgUUIDPtr(id *uuid.UUID) pgtype.UUID {
	if id == nil {
		return pgtype.UUID{}
	}
	return pgtype.UUID{Bytes: *id, Valid: true}
}

// ptrUUIDString returns a pointer to the uuid's string form (for the event payload).
func ptrUUIDString(id uuid.UUID) *string {
	s := id.String()
	return &s
}
