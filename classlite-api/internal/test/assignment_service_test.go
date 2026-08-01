// Story 5.1 (AC1–6) — assignment creation + close/reopen behavior at the service
// layer. Reuses setupSubEnv (owner teacherTC; the class teacher_id is the owner).
package test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/model"
	"github.com/ducdo/classlite-api/internal/service"
	"github.com/google/uuid"
)

func TestCreateAssignment_Open201(t *testing.T) {
	e := setupSubEnv(t, clock.NewMockClock(mockBase), 0)
	row, err := e.assignmentSvc.Create(context.Background(), e.teacherTC, service.CreateAssignmentInput{
		ExerciseID: e.exerciseID,
		ClassID:    e.classID,
		DeadlineAt: mockBase.Add(24 * time.Hour),
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if row.Status != "open" {
		t.Errorf("status=%q, want open", row.Status)
	}
}

func TestCreateAssignment_HardBeforeSoft_422(t *testing.T) {
	e := setupSubEnv(t, clock.NewMockClock(mockBase), 0)
	hard := mockBase.Add(1 * time.Hour)
	_, err := e.assignmentSvc.Create(context.Background(), e.teacherTC, service.CreateAssignmentInput{
		ExerciseID:     e.exerciseID,
		ClassID:        e.classID,
		DeadlineAt:     mockBase.Add(2 * time.Hour),
		HardDeadlineAt: &hard,
	})
	var invalid *service.InvalidDeadlineError
	if !errors.As(err, &invalid) {
		t.Fatalf("AC4 VIOLATION: expected INVALID_DEADLINE, got %v", err)
	}
}

func TestCreateAssignment_BadExercise_422InvalidReference(t *testing.T) {
	e := setupSubEnv(t, clock.NewMockClock(mockBase), 0)
	_, err := e.assignmentSvc.Create(context.Background(), e.teacherTC, service.CreateAssignmentInput{
		ExerciseID: uuid.New(), // not in center
		ClassID:    e.classID,
		DeadlineAt: mockBase.Add(24 * time.Hour),
	})
	var invalid *service.InvalidReferenceError
	if !errors.As(err, &invalid) || invalid.Field != "exerciseId" {
		t.Fatalf("AC2 VIOLATION: expected INVALID_REFERENCE(exerciseId), got %v", err)
	}
}

func TestCreateAssignment_BadClass_422InvalidReference(t *testing.T) {
	e := setupSubEnv(t, clock.NewMockClock(mockBase), 0)
	_, err := e.assignmentSvc.Create(context.Background(), e.teacherTC, service.CreateAssignmentInput{
		ExerciseID: e.exerciseID,
		ClassID:    uuid.New(), // not in center
		DeadlineAt: mockBase.Add(24 * time.Hour),
	})
	var invalid *service.InvalidReferenceError
	if !errors.As(err, &invalid) || invalid.Field != "classId" {
		t.Fatalf("AC2 VIOLATION: expected INVALID_REFERENCE(classId), got %v", err)
	}
}

func TestCreateAssignment_Student_403(t *testing.T) {
	e := setupSubEnv(t, clock.NewMockClock(mockBase), 0)
	_, err := e.assignmentSvc.Create(context.Background(), e.studentTC, service.CreateAssignmentInput{
		ExerciseID: e.exerciseID,
		ClassID:    e.classID,
		DeadlineAt: mockBase.Add(24 * time.Hour),
	})
	var forbidden *service.ForbiddenError
	if !errors.As(err, &forbidden) {
		t.Fatalf("AC1 VIOLATION: student could create an assignment (got %v)", err)
	}
}

func TestCreateAssignment_TeacherScope_404(t *testing.T) {
	e := setupSubEnv(t, clock.NewMockClock(mockBase), 0)
	// A second user who is a `teacher` (not the class's teacher — the owner is).
	TenantContext(t, e.db, pgUUIDFromGo(e.centerID))
	otherTeacher := rlsInsertUserAS(t, e.db, "t2-"+uuid.NewString()+"@example.com")
	CreateCenterMember(t, e.db, pgUUIDFromGo(otherTeacher), pgUUIDFromGo(e.centerID), "teacher")
	otherTC := model.TenantContext{CenterID: e.centerID.String(), UserID: otherTeacher.String(), Role: model.RoleTeacher, EmailVerified: true}

	_, err := e.assignmentSvc.Create(context.Background(), otherTC, service.CreateAssignmentInput{
		ExerciseID: e.exerciseID,
		ClassID:    e.classID,
		DeadlineAt: mockBase.Add(24 * time.Hour),
	})
	var notFound model.NotFoundError
	if !errors.As(err, &notFound) || notFound.Code != "CLASS_NOT_FOUND" {
		t.Fatalf("AC3 VIOLATION: expected 404 CLASS_NOT_FOUND for a non-owning teacher, got %v", err)
	}
}

func TestUpdateStatus_CloseThenReopen(t *testing.T) {
	e := setupSubEnv(t, clock.NewMockClock(mockBase), 0)
	created, err := e.assignmentSvc.Create(context.Background(), e.teacherTC, service.CreateAssignmentInput{
		ExerciseID: e.exerciseID, ClassID: e.classID, DeadlineAt: mockBase.Add(24 * time.Hour),
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	id := uuid.UUID(created.ID.Bytes)

	closed, err := e.assignmentSvc.UpdateStatus(context.Background(), e.teacherTC, id, "closed")
	if err != nil {
		t.Fatalf("close: %v", err)
	}
	if closed.Status != "closed" {
		t.Fatalf("status=%q, want closed", closed.Status)
	}
	reopened, err := e.assignmentSvc.UpdateStatus(context.Background(), e.teacherTC, id, "open")
	if err != nil {
		t.Fatalf("reopen: %v", err)
	}
	if reopened.Status != "open" {
		t.Fatalf("status=%q, want open", reopened.Status)
	}
	// Reopen never mutated the deadline (D11).
	if !reopened.DeadlineAt.Time.Equal(created.DeadlineAt.Time) {
		t.Errorf("D11 VIOLATION: reopen changed deadline_at (%v → %v)", created.DeadlineAt.Time, reopened.DeadlineAt.Time)
	}
}

func TestUpdateStatus_NoOp_409Conflict(t *testing.T) {
	e := setupSubEnv(t, clock.NewMockClock(mockBase), 0)
	created, err := e.assignmentSvc.Create(context.Background(), e.teacherTC, service.CreateAssignmentInput{
		ExerciseID: e.exerciseID, ClassID: e.classID, DeadlineAt: mockBase.Add(24 * time.Hour),
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	// open → open is a no-op → 409 CONFLICT (AC5).
	_, err = e.assignmentSvc.UpdateStatus(context.Background(), e.teacherTC, uuid.UUID(created.ID.Bytes), "open")
	var conflict model.ConflictError
	if !errors.As(err, &conflict) {
		t.Fatalf("AC5 VIOLATION: expected 409 CONFLICT on a no-op status flip, got %v", err)
	}
}

func TestListByClass_Paginates(t *testing.T) {
	e := setupSubEnv(t, clock.NewMockClock(mockBase), 0)
	for i := 0; i < 3; i++ {
		e.insertAssignment(t, mockBase.Add(time.Duration(i+1)*time.Hour), nil, 0, "open")
	}
	rows, total, page, pageSize, err := e.assignmentSvc.ListByClass(context.Background(), e.teacherTC, e.classID, 1, 2)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if total != 3 {
		t.Errorf("total=%d, want 3", total)
	}
	if len(rows) != 2 {
		t.Errorf("page 1 size=%d, want 2 (pageSize=2)", len(rows))
	}
	if page != 1 || pageSize != 2 {
		t.Errorf("normalized page/pageSize = %d/%d, want 1/2", page, pageSize)
	}

	// Over-cap pageSize + out-of-range page must come back CLAMPED so the handler's
	// pagination meta reflects effective values, not the raw request (review patch).
	_, _, normPage, normPageSize, err := e.assignmentSvc.ListByClass(context.Background(), e.teacherTC, e.classID, -5, 500)
	if err != nil {
		t.Fatalf("list clamp: %v", err)
	}
	if normPage != 1 {
		t.Errorf("clamped page=%d, want 1 (page<1 floored)", normPage)
	}
	if normPageSize != 100 {
		t.Errorf("clamped pageSize=%d, want 100 (assignmentMaxPageSize)", normPageSize)
	}
}
