// Package service — Story 3.4.5 EnrollmentService.
//
// Enrollments are the student↔class linkage table (keystone extracted from Epic
// 7 Story 7.3). This story ships ONLY the Add case + the roster list; the
// withdraw/transfer transitions, enrollment_history, and notifications stay in
// 7.3. The service never writes anything but status='active'.
//
// Authz (SEC-1, service-layer — never RLS):
//   - CreateEnrollment is Admin/Owner ONLY, re-validated from center_members
//     (NOT the JWT claim, which can be up to 15 min stale) — a Teacher/Student
//     caller is 403 INSUFFICIENT_ROLE.
//   - ListEnrolledStudentsByClass allows owner/admin/teacher; a teacher may only
//     list a class assigned to them (cross-teacher → 404 CLASS_NOT_FOUND,
//     reusing the class_lifecycle teacher-scope pattern).
//
// 7.3: emit EnrollmentChanged once the event bus is wired (unwired today).
package service

import (
	"context"
	"errors"
	"fmt"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/model"
	"github.com/ducdo/classlite-api/internal/store"
	"github.com/ducdo/classlite-api/internal/store/generated"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

const (
	enrollmentCreatedAction = "enrollment.created"
	enrollmentAuditEntity   = "enrollment"

	alreadyEnrolledCode = "ALREADY_ENROLLED"
)

// EnrolledStudent is the enrichment of a single enrollment row with the joined
// student display fields — the shape both endpoints render into the api.yaml
// Enrollment (POST returns the just-created row; the list JOINs directly).
type EnrolledStudent struct {
	Enrollment   generated.Enrollment
	StudentName  string
	StudentEmail string
}

// EnrollmentService owns the Add case + the class roster read.
type EnrollmentService struct {
	db    AuthDB
	audit AuditLogger
	clk   clock.Clock
}

// NewEnrollmentService constructs an EnrollmentService bound to the given seams.
func NewEnrollmentService(db AuthDB, audit AuditLogger, clk clock.Clock) *EnrollmentService {
	return &EnrollmentService{db: db, audit: audit, clk: clk}
}

// alreadyEnrolledConflict is the 409 raised when an active enrollment already
// exists for the (class, student) pair.
func alreadyEnrolledConflict() error {
	return model.ConflictError{Code: alreadyEnrolledCode, Message: "student is already enrolled in this class"}
}

// CreateEnrollment links an existing student member to a class (AC2). Admin/Owner
// only, re-validated from center_members (SEC-1). Runs as one atomic tenant tx:
// role re-fetch → class-in-center → is-student-member → not-already-active →
// insert → audit.
func (s *EnrollmentService) CreateEnrollment(
	ctx context.Context, tc model.TenantContext, studentID, classID uuid.UUID,
) (EnrolledStudent, error) {
	centerUUID, err := uuid.Parse(tc.CenterID)
	if err != nil {
		return EnrolledStudent{}, &ForbiddenError{Reason: "invalid tenant context"}
	}
	userUUID, err := uuid.Parse(tc.UserID)
	if err != nil {
		return EnrolledStudent{}, &ForbiddenError{Reason: "invalid tenant context"}
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return EnrolledStudent{}, fmt.Errorf("create enrollment: begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }()

	if err := store.SetTenantContext(ctx, tx, tc); err != nil {
		return EnrolledStudent{}, fmt.Errorf("create enrollment: %w", err)
	}
	txQ := generated.New(tx)

	// SEC-1 / R15 — re-validate role from center_members, not the JWT claim.
	// Admin/Owner only; a stale-JWT teacher/student (or a demoted admin) is 403.
	member, err := txQ.GetCenterMemberByUserAndCenter(ctx, generated.GetCenterMemberByUserAndCenterParams{
		UserID:   pgUUID(userUUID),
		CenterID: pgUUID(centerUUID),
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return EnrolledStudent{}, &ForbiddenError{Reason: "insufficient role"}
		}
		return EnrolledStudent{}, fmt.Errorf("create enrollment: get member: %w", err)
	}
	if member.Role != model.RoleOwner && member.Role != model.RoleAdmin {
		return EnrolledStudent{}, &ForbiddenError{Reason: "insufficient role"}
	}

	// Class must resolve in the caller's center (RLS scopes the read).
	if _, err := txQ.GetClassByID(ctx, pgUUID(classID)); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return EnrolledStudent{}, classNotFound(classID)
		}
		return EnrolledStudent{}, fmt.Errorf("create enrollment: get class: %w", err)
	}

	// studentId must be a `student` center-member of this center (AC2).
	isStudent, err := txQ.IsStudentMemberOfCenter(ctx, generated.IsStudentMemberOfCenterParams{
		CenterID: pgUUID(centerUUID),
		UserID:   pgUUID(studentID),
	})
	if err != nil {
		return EnrolledStudent{}, fmt.Errorf("create enrollment: is student member: %w", err)
	}
	if !isStudent {
		return EnrolledStudent{}, &NotAStudentMemberError{StudentID: studentID.String()}
	}

	// Not-already-active pre-check (belt; uq_enrollments_active is the suspenders).
	if _, err := txQ.GetActiveEnrollment(ctx, generated.GetActiveEnrollmentParams{
		ClassID:   pgUUID(classID),
		StudentID: pgUUID(studentID),
	}); err == nil {
		return EnrolledStudent{}, alreadyEnrolledConflict()
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return EnrolledStudent{}, fmt.Errorf("create enrollment: active pre-check: %w", err)
	}

	enrollment, err := txQ.CreateEnrollment(ctx, generated.CreateEnrollmentParams{
		ID:        pgUUID(uuid.New()),
		CenterID:  pgUUID(centerUUID),
		StudentID: pgUUID(studentID),
		ClassID:   pgUUID(classID),
	})
	if err != nil {
		// Belt-and-suspenders: a concurrent enroll for the same (class, student)
		// can slip past the pre-check and collide on uq_enrollments_active. Map
		// the unique violation to the same 409 rather than leaking a 500.
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == pgUniqueViolationCode {
			return EnrolledStudent{}, alreadyEnrolledConflict()
		}
		return EnrolledStudent{}, fmt.Errorf("create enrollment: insert: %w", err)
	}

	// Denormalize the student's display fields for the response (users is a
	// global table — no RLS — so this read is safe inside the tenant tx).
	student, err := txQ.GetUserByID(ctx, pgUUID(studentID))
	if err != nil {
		return EnrolledStudent{}, fmt.Errorf("create enrollment: get student: %w", err)
	}

	enrollmentID := uuidFromPg(enrollment.ID)
	changes := Changes{After: map[string]any{
		"student_id": studentID.String(),
		"class_id":   classID.String(),
		"status":     enrollment.Status,
	}}
	if err := s.audit.LogWithinTx(ctx, tx, tc, enrollmentCreatedAction, enrollmentAuditEntity, enrollmentID, changes); err != nil {
		return EnrolledStudent{}, fmt.Errorf("create enrollment: audit: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return EnrolledStudent{}, fmt.Errorf("create enrollment: commit: %w", err)
	}
	// 7.3: emit EnrollmentChanged once the bus is wired.
	return EnrolledStudent{
		Enrollment:   enrollment,
		StudentName:  student.FullName,
		StudentEmail: student.Email,
	}, nil
}

// ListEnrolledStudentsByClass returns the active roster for a class (AC3). Reads
// run inside a tenant-scoped tx (RLS needs it — PERF-1). Role gate allows
// owner/admin/teacher; a teacher may only list a class assigned to them
// (cross-teacher → 404, teacher-sees-nothing).
func (s *EnrollmentService) ListEnrolledStudentsByClass(
	ctx context.Context, tc model.TenantContext, classID uuid.UUID,
) ([]generated.ListEnrolledStudentsByClassRow, error) {
	if err := assertClassRole(tc); err != nil {
		return nil, err
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("list enrollments: begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }()

	if err := store.SetTenantContext(ctx, tx, tc); err != nil {
		return nil, fmt.Errorf("list enrollments: %w", err)
	}
	txQ := generated.New(tx)

	current, err := txQ.GetClassByID(ctx, pgUUID(classID))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, classNotFound(classID)
		}
		return nil, fmt.Errorf("list enrollments: get class: %w", err)
	}
	if err := assertTeacherScope(tc, current, classID); err != nil {
		return nil, err
	}

	rows, err := txQ.ListEnrolledStudentsByClass(ctx, pgUUID(classID))
	if err != nil {
		return nil, fmt.Errorf("list enrollments: query: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("list enrollments: commit: %w", err)
	}
	return rows, nil
}
