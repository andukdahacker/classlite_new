// Story 7.3a (AC7 · R17 · risk=7 · WF-8 HARD GATE) — the enrollment_history row
// is written in the SAME transaction as the enrollment state change, so:
//   - a successful action writes EXACTLY ONE history row (correct action / from /
//     to / performer), and
//   - if the state change rolls back, NO history row persists (atomicity).
//
// Atomicity is proven with a NATURAL mid-transaction failure rather than an
// injected fault: a transfer whose TARGET already holds an active enrollment for
// the student must 409 ALREADY_ENROLLED after the source has been flipped to
// 'transferred' inside the tx — the whole tx rolls back, leaving the source row
// still 'active' and the history table with zero new rows. This exercises the
// real one-tx contract the audit spine (R17) depends on.
//
// De-tagged at green (7-3a shipped the one-tx state-change + InsertEnrollmentHistory
// + audit contract); now part of the permanent suite.
//
// GREEN SEAMS (Task 1 migration + Task 4 service):
//
//	EnrollmentService.WithdrawEnrollment / TransferEnrollment run
//	  state-change → InsertEnrollmentHistory → audit.LogWithinTx in ONE tenant tx;
//	  transfer flips the source to 'transferred' THEN creates the target (a target
//	  collision → 409 rolls the whole tx back). exactly one history row per commit.
package handler_test

import (
	"context"
	"net/http"
	"testing"

	"github.com/ducdo/classlite-api/internal/test"
	"github.com/google/uuid"
)

// ownerUserID resolves the center's owner user_id via the superuser pool (the env
// exposes the owner's token but not its id; performed_by must equal this).
func ownerUserID(t *testing.T, centerID string) uuid.UUID {
	t.Helper()
	sp := test.SuperuserPool(t)
	var id uuid.UUID
	if err := sp.QueryRow(context.Background(),
		`SELECT user_id FROM center_members WHERE center_id = $1 AND role = 'owner' LIMIT 1`,
		centerID,
	).Scan(&id); err != nil {
		t.Fatalf("resolve owner user_id: %v", err)
	}
	return id
}

// countHistory counts enrollment_history rows for a student (optionally filtered
// by action). Runtime-red until the create_enrollment_history migration lands.
func countHistory(t *testing.T, studentID uuid.UUID, action string) int {
	t.Helper()
	sp := test.SuperuserPool(t)
	var n int
	q := `SELECT count(*) FROM enrollment_history WHERE student_id = $1`
	args := []any{studentID}
	if action != "" {
		q += ` AND action = $2`
		args = append(args, action)
	}
	if err := sp.QueryRow(context.Background(), q, args...).Scan(&n); err != nil {
		t.Fatalf("count enrollment_history (greenfield — is create_enrollment_history applied?): %v", err)
	}
	return n
}

// -----------------------------------------------------------------------------
// AC7 — a successful withdraw writes EXACTLY ONE history row with the correct
// action / from / to / performer.
// -----------------------------------------------------------------------------

func TestEnrollmentHistory_Withdraw_ExactlyOneRow(t *testing.T) {
	env := setupEnrollmentHandlerTest(t)
	studentUUID := uuid.MustParse(test.UUIDString(env.student1ID))
	ownerID := ownerUserID(t, env.centerID)

	// Arrange: owner adds student1 to class A (legacy Add body still valid).
	add := classReq(t, env.srv, http.MethodPost, "/api/enrollments", env.ownerTok,
		createBody(env, env.student1ID, env.classAID))
	if add.Code != http.StatusCreated {
		t.Fatalf("arrange add → %d, want 201 (body: %s)", add.Code, add.Body.String())
	}

	// Act: withdraw student1 from class A.
	rec := classReq(t, env.srv, http.MethodPost, "/api/enrollments", env.ownerTok,
		withdrawBody(env, test.UUIDString(env.student1ID), env.classAID.String()))
	if rec.Code != http.StatusOK {
		t.Fatalf("withdraw → %d, want 200 (body: %s)", rec.Code, rec.Body.String())
	}

	// Assert: exactly one withdraw history row, correct from/to/performer.
	if n := countHistory(t, studentUUID, "withdraw"); n != 1 {
		t.Fatalf("withdraw history rows = %d, want exactly 1 (R17: one row per op)", n)
	}
	sp := test.SuperuserPool(t)
	var fromClass, toClass, performedBy *uuid.UUID
	if err := sp.QueryRow(context.Background(),
		`SELECT from_class_id, to_class_id, performed_by FROM enrollment_history
		 WHERE student_id = $1 AND action = 'withdraw'`, studentUUID,
	).Scan(&fromClass, &toClass, &performedBy); err != nil {
		t.Fatalf("read withdraw history row: %v", err)
	}
	if fromClass == nil || *fromClass != env.classAID {
		t.Errorf("withdraw from_class_id = %v, want %s", fromClass, env.classAID)
	}
	if toClass != nil {
		t.Errorf("withdraw to_class_id = %v, want NULL", toClass)
	}
	if performedBy == nil || *performedBy != ownerID {
		t.Errorf("withdraw performed_by = %v, want acting owner %s", performedBy, ownerID)
	}
}

// -----------------------------------------------------------------------------
// AC7 — a rolled-back transfer (target already enrolled → 409) leaves NO new
// history row and leaves the source enrollment still 'active'.
// -----------------------------------------------------------------------------

func TestEnrollmentHistory_TransferRollback_LeavesNoRow(t *testing.T) {
	env := setupEnrollmentHandlerTest(t)
	studentUUID := uuid.MustParse(test.UUIDString(env.student1ID))

	// Arrange: student1 is active in BOTH class A and class B.
	for _, cid := range []uuid.UUID{env.classAID, env.classBID} {
		add := classReq(t, env.srv, http.MethodPost, "/api/enrollments", env.ownerTok,
			createBody(env, env.student1ID, cid))
		if add.Code != http.StatusCreated {
			t.Fatalf("arrange add to %s → %d, want 201 (body: %s)", cid, add.Code, add.Body.String())
		}
	}
	before := countHistory(t, studentUUID, "")

	// Act: transfer A → B, but student1 is already active in B → 409, whole tx rolls back.
	rec := classReq(t, env.srv, http.MethodPost, "/api/enrollments", env.ownerTok,
		transferBody(env, test.UUIDString(env.student1ID), env.classAID.String(), env.classBID.String()))
	if rec.Code != http.StatusConflict {
		t.Fatalf("transfer into an already-enrolled target → %d, want 409 (body: %s)", rec.Code, rec.Body.String())
	}
	if code := errCodeOf(t, rec.Body.Bytes()); code != "ALREADY_ENROLLED" {
		t.Errorf("error code = %q, want ALREADY_ENROLLED", code)
	}

	// Assert: no history row was written by the rolled-back transfer.
	if after := countHistory(t, studentUUID, ""); after != before {
		t.Errorf("history rows after rolled-back transfer = %d, want %d (atomicity: partial write leaked)", after, before)
	}
	// Assert: the source enrollment is still active (the 'transferred' flip rolled back).
	sp := test.SuperuserPool(t)
	var status string
	if err := sp.QueryRow(context.Background(),
		`SELECT status FROM enrollments WHERE student_id = $1 AND class_id = $2`,
		studentUUID, env.classAID,
	).Scan(&status); err != nil {
		t.Fatalf("read source enrollment status: %v", err)
	}
	if status != "active" {
		t.Errorf("source enrollment status = %q, want active (rollback must restore it)", status)
	}
}
