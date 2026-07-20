// ATDD RED-PHASE — Story 3.1, Tasks 0/4 (unconditionally-mandatory per WF-8).
//
// Scope: AC4 (lifecycle transition enforcement — the FIRST state machine in the
// codebase; full illegal-move matrix + compare-and-swap concurrency + audit-not-
// written on rejection) and AC5 (role-scoped listing at the service layer:
// owner/admin see ALL center classes; a teacher sees ONLY teacher_id=caller, and
// another teacher's class is ABSENT).
//
// These tests reference service methods that DO NOT EXIST YET:
//   - (*service.ClassService).TransitionStatus
//   - (*service.ClassService).List
//   - (*service.ClassService).ListForTeacher
// so this file is COMPILE-RED until Story 3.1 Task 4 lands them. That build
// failure (undefined method) IS the red signal — verified in the ATDD checklist.
//
// This suite follows the SHIPPED service-ATDD pattern (class_atdd_test.go):
// real committed pool via test.SetupRawPool, real audit via realAuditLogger, and
// SuperuserPool/CountRows for commit-visible assertions. It deliberately does NOT
// use a mocked store seam — the shipped ClassService takes AuthDB (a db handle),
// not a store interface, so there is no seam to mock (documented deviation from
// the story's aspirational "TEST-BE-4 mock store" wording).
//
// realAuditLogger, MockInviteSender and strPtr are defined in class_atdd_test.go
// (same package service_test) and are reused here — do NOT redeclare them.
package service_test

import (
	"context"
	"errors"
	"sync"
	"testing"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/model"
	"github.com/ducdo/classlite-api/internal/service"
	"github.com/ducdo/classlite-api/internal/test"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

const classStatusChangedAction = "class.status_changed"

// seedClassRaw inserts a class row directly via the superuser pool (bypassing
// RLS), using only columns present in the shipped base schema
// (20260703120200_create_classes) so the insert stays valid before Story 3.1's
// column-adding migration. Honors the classes_teacher_mutex CHECK: pass exactly
// one of teacherID / pendingEmail non-nil.
func seedClassRaw(
	t *testing.T,
	pool *pgxpool.Pool,
	centerID string,
	name string,
	status string,
	teacherID *string,
	pendingEmail *string,
) uuid.UUID {
	t.Helper()
	// classes has FORCE ROW LEVEL SECURITY, so a raw INSERT through the
	// non-superuser SetupRawPool is rejected (no app.current_tenant_id set).
	// Insert via the superuser pool to bypass RLS, matching this helper's
	// stated intent and the project fixture convention (CreateCenterForOwner
	// et al.). The passed pool is ignored for the write.
	_ = pool
	id := uuid.New()
	_, err := test.SuperuserPool(t).Exec(context.Background(),
		`INSERT INTO classes
		   (id, center_id, name, target_band, primary_skill, session_count,
		    status, teacher_id, pending_teacher_email, start_date)
		 VALUES ($1, $2::uuid, $3, 6.5, 'writing', 12,
		    $4, $5::uuid, $6, current_date + interval '30 days')`,
		id, centerID, name, status, teacherID, pendingEmail,
	)
	if err != nil {
		t.Fatalf("seedClassRaw(%s, status=%s): %v", name, status, err)
	}
	return id
}

func classStatusRaw(t *testing.T, pool *pgxpool.Pool, classID uuid.UUID) string {
	t.Helper()
	var status string
	if err := pool.QueryRow(context.Background(),
		`SELECT status FROM classes WHERE id = $1`, classID,
	).Scan(&status); err != nil {
		t.Fatalf("classStatusRaw(%s): %v", classID, err)
	}
	return status
}

func statusChangeAuditCount(t *testing.T, pool *pgxpool.Pool, classID uuid.UUID) int {
	t.Helper()
	// entity_id::text comparison is agnostic to whether audit_logs.entity_id is
	// uuid- or text-typed.
	return test.CountRows(t, pool,
		`SELECT count(*) FROM audit_logs WHERE action = $1 AND entity_id::text = $2`,
		classStatusChangedAction, classID.String(),
	)
}

// newClassServiceForTest wires a ClassService over the real pool with a real
// audit logger, mirroring class_atdd_test.go's Branch-A construction.
func newClassServiceForTest(t *testing.T, pool *pgxpool.Pool) *service.ClassService {
	t.Helper()
	auditSvc := service.NewAuditService(pool)
	inviter := &MockInviteSender{Accepted: true}
	return service.NewClassService(pool, &realAuditLogger{inner: auditSvc}, inviter, clock.RealClock{})
}

// ---------------------------------------------------------------------------
// AC4 — legal transitions: succeed, advance status, write ONE audit row.
// ---------------------------------------------------------------------------

func TestClassService_TransitionStatus_AC04_LegalMoves(t *testing.T) {
	legal := []struct {
		name string
		from string
		to   string
	}{
		{"upcoming_to_active", "upcoming", "active"},
		{"active_to_paused", "active", "paused"},
		{"active_to_ended", "active", "ended"},
		{"paused_to_active", "paused", "active"},
	}

	for _, tc := range legal {
		t.Run(tc.name, func(t *testing.T) {
			pool := test.SetupRawPool(t)
			owner := test.CreateUserOnPool(t, pool, "owner-"+tc.name+"@example.com", "Owner")
			test.MarkUserEmailVerifiedOnPool(t, pool, owner.ID)
			centerID := test.CreateCenterForOwner(t, pool, owner.ID)
			t.Cleanup(func() { test.PurgeUserAndOwnedCenters(t, pool, owner.ID) })

			classID := seedClassRaw(t, pool, test.UUIDString(centerID), "Cohort "+tc.name, tc.from,
				strPtr(test.UUIDString(owner.ID)), nil)

			svc := newClassServiceForTest(t, pool)
			ownerTC := model.TenantContext{
				CenterID:      test.UUIDString(centerID),
				UserID:        test.UUIDString(owner.ID),
				Role:          "owner",
				EmailVerified: true,
			}

			superPool := test.SuperuserPool(t)
			before := statusChangeAuditCount(t, superPool, classID)

			_, err := svc.TransitionStatus(context.Background(), ownerTC, classID, tc.to)
			if err != nil {
				t.Fatalf("AC4 legal %s→%s: unexpected error: %v", tc.from, tc.to, err)
			}

			if got := classStatusRaw(t, superPool, classID); got != tc.to {
				t.Errorf("AC4 legal %s→%s: status = %q, want %q", tc.from, tc.to, got, tc.to)
			}
			if after := statusChangeAuditCount(t, superPool, classID); after != before+1 {
				t.Errorf("AC4 legal %s→%s: class.status_changed audit rows = %d, want %d",
					tc.from, tc.to, after, before+1)
			}
		})
	}
}

// ---------------------------------------------------------------------------
// AC4 — illegal transitions: reject with INVALID_STATUS_TRANSITION and write
// NO audit row (a rejected transition must not emit class.status_changed).
// ---------------------------------------------------------------------------

func TestClassService_TransitionStatus_AC04_IllegalMoves_RejectAndNoAudit(t *testing.T) {
	illegal := []struct {
		name string
		from string
		to   string
	}{
		{"upcoming_to_ended", "upcoming", "ended"},
		{"upcoming_to_paused", "upcoming", "paused"},
		{"active_to_active_same_state", "active", "active"},
		{"paused_to_ended", "paused", "ended"},
		{"ended_to_active", "ended", "active"},
		{"ended_to_paused", "ended", "paused"},
		{"ended_to_ended", "ended", "ended"},
	}

	for _, tc := range illegal {
		t.Run(tc.name, func(t *testing.T) {
			pool := test.SetupRawPool(t)
			owner := test.CreateUserOnPool(t, pool, "owner-"+tc.name+"@example.com", "Owner")
			test.MarkUserEmailVerifiedOnPool(t, pool, owner.ID)
			centerID := test.CreateCenterForOwner(t, pool, owner.ID)
			t.Cleanup(func() { test.PurgeUserAndOwnedCenters(t, pool, owner.ID) })

			classID := seedClassRaw(t, pool, test.UUIDString(centerID), "Cohort "+tc.name, tc.from,
				strPtr(test.UUIDString(owner.ID)), nil)

			svc := newClassServiceForTest(t, pool)
			ownerTC := model.TenantContext{
				CenterID:      test.UUIDString(centerID),
				UserID:        test.UUIDString(owner.ID),
				Role:          "owner",
				EmailVerified: true,
			}

			superPool := test.SuperuserPool(t)

			_, err := svc.TransitionStatus(context.Background(), ownerTC, classID, tc.to)
			if err == nil {
				t.Fatalf("AC4 illegal %s→%s: expected error, got nil", tc.from, tc.to)
			}

			var ve model.ValidationError
			if !errors.As(err, &ve) {
				t.Fatalf("AC4 illegal %s→%s: error = %T (%v), want model.ValidationError",
					tc.from, tc.to, err, err)
			}
			if !hasFieldCode(ve, "status", "INVALID_STATUS_TRANSITION") {
				t.Errorf("AC4 illegal %s→%s: ValidationError.Fields = %+v, want a {field:status, code:INVALID_STATUS_TRANSITION}",
					tc.from, tc.to, ve.Fields)
			}

			// Status unchanged.
			if got := classStatusRaw(t, superPool, classID); got != tc.from {
				t.Errorf("AC4 illegal %s→%s: status mutated to %q, want unchanged %q",
					tc.from, tc.to, got, tc.from)
			}
			// No audit row emitted for a rejected transition.
			if n := statusChangeAuditCount(t, superPool, classID); n != 0 {
				t.Errorf("AC4 illegal %s→%s: wrote %d class.status_changed audit rows, want 0",
					tc.from, tc.to, n)
			}
		})
	}
}

func hasFieldCode(ve model.ValidationError, field, code string) bool {
	for _, f := range ve.Fields {
		if f.Field == field && f.Code == code {
			return true
		}
	}
	return false
}

// ---------------------------------------------------------------------------
// AC4 — compare-and-swap concurrency: two racing LEGAL moves from the same
// state must NOT both commit; exactly one wins, the loser gets
// INVALID_STATUS_TRANSITION, and exactly one audit row is written.
// ---------------------------------------------------------------------------

func TestClassService_TransitionStatus_AC04_ConcurrentRace_ExactlyOneCommits(t *testing.T) {
	pool := test.SetupRawPool(t)
	owner := test.CreateUserOnPool(t, pool, "owner-race@example.com", "Owner")
	test.MarkUserEmailVerifiedOnPool(t, pool, owner.ID)
	centerID := test.CreateCenterForOwner(t, pool, owner.ID)
	t.Cleanup(func() { test.PurgeUserAndOwnedCenters(t, pool, owner.ID) })

	// active → {paused, ended} are both legal from 'active'.
	classID := seedClassRaw(t, pool, test.UUIDString(centerID), "Race Cohort", "active",
		strPtr(test.UUIDString(owner.ID)), nil)

	svc := newClassServiceForTest(t, pool)
	ownerTC := model.TenantContext{
		CenterID:      test.UUIDString(centerID),
		UserID:        test.UUIDString(owner.ID),
		Role:          "owner",
		EmailVerified: true,
	}

	targets := []string{"paused", "ended"}
	errs := make([]error, len(targets))
	var wg sync.WaitGroup
	start := make(chan struct{})
	for i, target := range targets {
		wg.Add(1)
		go func(i int, target string) {
			defer wg.Done()
			<-start
			_, errs[i] = svc.TransitionStatus(context.Background(), ownerTC, classID, target)
		}(i, target)
	}
	close(start)
	wg.Wait()

	nSuccess := 0
	for _, e := range errs {
		if e == nil {
			nSuccess++
		} else {
			var ve model.ValidationError
			if !errors.As(e, &ve) || !hasFieldCode(ve, "status", "INVALID_STATUS_TRANSITION") {
				t.Errorf("AC4 race: loser error = %T (%v), want INVALID_STATUS_TRANSITION ValidationError", e, e)
			}
		}
	}
	if nSuccess != 1 {
		t.Fatalf("AC4 race: %d transitions committed, want exactly 1 (compare-and-swap violated)", nSuccess)
	}

	superPool := test.SuperuserPool(t)
	final := classStatusRaw(t, superPool, classID)
	if final != "paused" && final != "ended" {
		t.Errorf("AC4 race: final status = %q, want paused or ended", final)
	}
	if n := statusChangeAuditCount(t, superPool, classID); n != 1 {
		t.Errorf("AC4 race: wrote %d class.status_changed audit rows, want exactly 1", n)
	}
}

// ---------------------------------------------------------------------------
// AC5 — role-scoped listing at the service layer.
//   owner/admin  → List: ALL center classes (incl. another teacher's).
//   teacher      → ListForTeacher: ONLY teacher_id = caller; another teacher's
//                  class and an unassigned (pending-email) class are ABSENT.
// ---------------------------------------------------------------------------

func TestClassService_List_AC05_RoleScopedVisibility(t *testing.T) {
	pool := test.SetupRawPool(t)
	owner := test.CreateUserOnPool(t, pool, "owner-scope@example.com", "Owner")
	test.MarkUserEmailVerifiedOnPool(t, pool, owner.ID)
	centerID := test.CreateCenterForOwner(t, pool, owner.ID)

	teacherA := test.CreateUserOnPool(t, pool, "teacher-a-scope@example.com", "Teacher A")
	teacherB := test.CreateUserOnPool(t, pool, "teacher-b-scope@example.com", "Teacher B")
	test.AddCenterMember(t, pool, centerID, teacherA.ID, "teacher")
	test.AddCenterMember(t, pool, centerID, teacherB.ID, "teacher")

	// Full teardown: this center has THREE members (owner + 2 teachers) and
	// seeded classes, so the shared owner-only PurgeUserAndOwnedCenters alone
	// FK-blocks on the center delete (teacher memberships) and leaks the two
	// teacher users → duplicate-email failures on re-run. Clear classes + all
	// memberships + the center via the superuser pool (bypasses RLS), then
	// purge every user. Order-independent.
	t.Cleanup(func() {
		sp := test.SuperuserPool(t)
		ctx := context.Background()
		_, _ = sp.Exec(ctx, `DELETE FROM classes WHERE center_id = $1`, centerID)
		_, _ = sp.Exec(ctx, `DELETE FROM center_members WHERE center_id = $1`, centerID)
		_, _ = sp.Exec(ctx, `DELETE FROM centers WHERE id = $1`, centerID)
		test.PurgeUserAndOwnedCenters(t, pool, owner.ID)
		test.PurgeUserAndOwnedCenters(t, pool, teacherA.ID)
		test.PurgeUserAndOwnedCenters(t, pool, teacherB.ID)
	})

	center := test.UUIDString(centerID)
	const (
		nameA          = "Teacher A Cohort"
		nameB          = "Teacher B Cohort"
		nameUnassigned = "Unassigned Cohort"
	)
	seedClassRaw(t, pool, center, nameA, "active", strPtr(test.UUIDString(teacherA.ID)), nil)
	seedClassRaw(t, pool, center, nameB, "active", strPtr(test.UUIDString(teacherB.ID)), nil)
	seedClassRaw(t, pool, center, nameUnassigned, "upcoming", nil, strPtr("invited@example.com"))

	svc := newClassServiceForTest(t, pool)

	ownerTC := model.TenantContext{
		CenterID: center, UserID: test.UUIDString(owner.ID), Role: "owner", EmailVerified: true,
	}
	teacherATC := model.TenantContext{
		CenterID: center, UserID: test.UUIDString(teacherA.ID), Role: "teacher", EmailVerified: true,
	}

	// Owner sees ALL three (element type inferred as generated.Class; .Name is a
	// plain string, so no generated import is needed).
	ownerClasses, err := svc.List(context.Background(), ownerTC)
	if err != nil {
		t.Fatalf("AC5 owner List: unexpected error: %v", err)
	}
	ownerNames := map[string]bool{}
	for _, c := range ownerClasses {
		ownerNames[c.Name] = true
	}
	for _, want := range []string{nameA, nameB, nameUnassigned} {
		if !ownerNames[want] {
			t.Errorf("AC5 owner List: %q missing; owner must see ALL center classes", want)
		}
	}

	// Teacher A sees ONLY nameA; nameB (other teacher) and unassigned ABSENT.
	teacherAUUID := test.MustParseUUID(t, test.UUIDString(teacherA.ID))
	teacherClasses, err := svc.ListForTeacher(context.Background(), teacherATC, teacherAUUID)
	if err != nil {
		t.Fatalf("AC5 teacher ListForTeacher: unexpected error: %v", err)
	}
	teacherNames := map[string]bool{}
	for _, c := range teacherClasses {
		teacherNames[c.Name] = true
	}
	if !teacherNames[nameA] {
		t.Errorf("AC5 teacher ListForTeacher: own class %q missing", nameA)
	}
	if teacherNames[nameB] {
		t.Errorf("AC5 LEAK: teacher A can see teacher B's class %q (must be absent)", nameB)
	}
	if teacherNames[nameUnassigned] {
		t.Errorf("AC5 LEAK: teacher A can see unassigned class %q (must be absent)", nameUnassigned)
	}
}
