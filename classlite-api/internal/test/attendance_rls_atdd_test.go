// Story 3.5b (AC1/AC2/AC6/AC9/AC11 · D3/D6/D10/D14 · risk=6) — the NEW
// `attendance` table: RLS grid (read + write isolation, both directions), the
// UNIQUE(session_id,student_id) UPSERT idempotency, and the tenant-tx read.
//
// Real DB in tx under SET LOCAL ROLE classlite_app so FORCE RLS is enforced (a
// superuser bypasses it). Mirrors enrollments_rls_test.go (the 3.4.5 sibling —
// same 4-policy center-scoped grid, no dual-scope, no trigger) + the ★ Murat
// house rule from staff_roster_rls_atdd_test.go: a 0-row cross-tenant write is
// NOT proof on its own — re-read AS TENANT B and assert the value is byte-
// unchanged.
//
// GREEN (Story 3.5b landed): the build tag was removed once the store seams
// (generated.UpsertAttendance / generated.ListAttendanceRosterBySession) + the
// Task-1 migration `20260903120000_create_attendance` shipped, so these run in
// normal CI as the permanent RLS + UPSERT regression suite (was red-phase behind
// `//go:build atdd_red_phase`).
//
// SEAMS this suite locks (dev — Task 1 migration + Task 2 queries/attendance.sql):
//
//	Table attendance(id, center_id, session_id, student_id, status
//	  CHECK IN ('present','late','absent'), marked_by, created_at, updated_at),
//	  UNIQUE(session_id, student_id), idx_attendance_center_session,
//	  session_id/center_id FK ON DELETE CASCADE, marked_by → users ON DELETE
//	  RESTRICT NOT NULL, 4-policy center-scoped RLS grid (mirror enrollments).
//	UpsertAttendance(ctx, UpsertAttendanceParams{SessionID, StudentID, CenterID,
//	  Status, MarkedBy}) → Attendance   -- ON CONFLICT (session_id,student_id)
//	  DO UPDATE SET status, marked_by, updated_at = now()
//	ListAttendanceRosterBySession(ctx, ListAttendanceRosterBySessionParams{
//	  ClassID, SessionID}) → []ListAttendanceRosterBySessionRow  -- enrollments
//	  (active) LEFT JOIN attendance, status/marked_at nullable, ORDER BY full_name

package test

import (
	"context"
	"testing"
	"time"

	"github.com/ducdo/classlite-api/internal/store/generated"
	"github.com/google/uuid"
)

// insertAttendanceRaw inserts an attendance row via raw SQL. Tenant context must
// be set by the caller. Runtime-red until the Task-1 migration ships the table.
func insertAttendanceRaw(t *testing.T, db *TxDB, centerID, sessionID, studentID, markedBy uuid.UUID, status string) uuid.UUID {
	t.Helper()
	id := uuid.New()
	_, err := db.Exec(context.Background(),
		`INSERT INTO attendance (id, center_id, session_id, student_id, status, marked_by)
		 VALUES ($1, $2, $3, $4, $5, $6)`,
		id, centerID, sessionID, studentID, status, markedBy,
	)
	if err != nil {
		t.Fatalf("insert attendance row: %v", err)
	}
	return id
}

// seedAttendanceDeps creates (class, session, student, marker) a well-formed
// attendance row needs in the current tenant. Tenant context must be set.
func seedAttendanceDeps(t *testing.T, db *TxDB, centerID uuid.UUID) (sessionID, studentID, markerID uuid.UUID) {
	t.Helper()
	classID := insertClassRaw(t, db, centerID, "Attendance Parent Class")
	sessionID = insertSessionRaw(t, db, centerID, classID, time.Now().Add(-1*time.Hour), nil)
	studentID = insertUserRaw(t, db, "att-student-"+uuid.NewString()[:8]+"@example.com", "Student S")
	markerID = insertUserRaw(t, db, "att-marker-"+uuid.NewString()[:8]+"@example.com", "Teacher T")
	return sessionID, studentID, markerID
}

// -----------------------------------------------------------------------------
// AC2 — Pattern 1: CrossTenantRead (RLS read isolation)
// -----------------------------------------------------------------------------
func TestRLS_Attendance_CrossTenantRead(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()

	centerA := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	centerB := CreateCenterWithID(t, db, TenantBID, "Center B", "center-b")

	TenantContext(t, db, centerB.ID)
	centerBUUID := uuid.UUID(centerB.ID.Bytes)
	sessB, studentB, markerB := seedAttendanceDeps(t, db, centerBUUID)
	insertAttendanceRaw(t, db, centerBUUID, sessB, studentB, markerB, "present")

	TenantContext(t, db, centerA.ID)
	var visible int
	if err := db.QueryRow(ctx,
		"SELECT count(*) FROM attendance WHERE center_id = $1", centerB.ID,
	).Scan(&visible); err != nil {
		t.Fatalf("broad count as tenant A: %v", err)
	}
	if visible != 0 {
		t.Errorf("RLS VIOLATION: tenant A saw %d tenant B attendance rows, expected 0", visible)
	}
}

// -----------------------------------------------------------------------------
// AC2 — Pattern 2: CrossTenantWrite (RLS write isolation + ★re-read-as-B)
// -----------------------------------------------------------------------------
func TestRLS_Attendance_CrossTenantWrite(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()

	centerA := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	centerB := CreateCenterWithID(t, db, TenantBID, "Center B", "center-b")

	TenantContext(t, db, centerB.ID)
	centerBUUID := uuid.UUID(centerB.ID.Bytes)
	sessB, studentB, markerB := seedAttendanceDeps(t, db, centerBUUID)
	rowB := insertAttendanceRaw(t, db, centerBUUID, sessB, studentB, markerB, "present")

	// Tenant A attempts to overwrite B's row → must affect 0 rows (RLS UPDATE).
	TenantContext(t, db, centerA.ID)
	tag, err := db.Exec(ctx,
		"UPDATE attendance SET status = 'absent' WHERE id = $1", rowB,
	)
	if err != nil {
		t.Fatalf("cross-tenant update errored (expected 0-rows, not error): %v", err)
	}
	if tag.RowsAffected() != 0 {
		t.Errorf("RLS VIOLATION: tenant A UPDATE affected %d tenant B rows, expected 0", tag.RowsAffected())
	}

	// ★ Murat house rule: 0-rows is not proof. Re-read AS TENANT B, assert unchanged.
	TenantContext(t, db, centerB.ID)
	var status string
	if err := db.QueryRow(ctx,
		"SELECT status FROM attendance WHERE id = $1", rowB,
	).Scan(&status); err != nil {
		t.Fatalf("re-read as tenant B: %v", err)
	}
	if status != "present" {
		t.Errorf("RLS VIOLATION: tenant B row mutated to %q by tenant A, expected 'present'", status)
	}
}

// -----------------------------------------------------------------------------
// AC6 — UPSERT idempotency: mark → re-mark → exactly one row, status updated
// -----------------------------------------------------------------------------
func TestStore_Attendance_UpsertIdempotent(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()

	center := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	TenantContext(t, db, center.ID)
	centerUUID := uuid.UUID(center.ID.Bytes)
	sess, student, marker := seedAttendanceDeps(t, db, centerUUID)

	q := generated.New(db)
	// GREEN SEAM — UpsertAttendance does not exist yet (compile-red).
	first, err := q.UpsertAttendance(ctx, generated.UpsertAttendanceParams{
		SessionID: pgUUIDForTest(sess), StudentID: pgUUIDForTest(student),
		CenterID: center.ID, Status: "present", MarkedBy: pgUUIDForTest(marker),
	})
	if err != nil {
		t.Fatalf("first upsert: %v", err)
	}
	// Re-mark the SAME (session, student) → UPDATE, not a second row.
	if _, err := q.UpsertAttendance(ctx, generated.UpsertAttendanceParams{
		SessionID: pgUUIDForTest(sess), StudentID: pgUUIDForTest(student),
		CenterID: center.ID, Status: "absent", MarkedBy: pgUUIDForTest(marker),
	}); err != nil {
		t.Fatalf("second upsert: %v", err)
	}

	var count int
	if err := db.QueryRow(ctx,
		"SELECT count(*) FROM attendance WHERE session_id = $1 AND student_id = $2",
		sess, student,
	).Scan(&count); err != nil {
		t.Fatalf("count rows: %v", err)
	}
	if count != 1 {
		t.Errorf("UPSERT VIOLATION: got %d rows for (session,student), expected 1 (UNIQUE + ON CONFLICT)", count)
	}
	var status string
	if err := db.QueryRow(ctx,
		"SELECT status FROM attendance WHERE id = $1", first.ID,
	).Scan(&status); err != nil {
		t.Fatalf("re-read status: %v", err)
	}
	if status != "absent" {
		t.Errorf("re-mark did not UPDATE status: got %q, expected 'absent'", status)
	}
}

// -----------------------------------------------------------------------------
// AC11 — the roster read returns active enrollments LEFT-JOINed to attendance,
// with status NULL for unmarked students, under a tenant tx (PERF-1).
// -----------------------------------------------------------------------------
func TestStore_Attendance_RosterLeftJoinUnmarkedNull(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()

	center := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	TenantContext(t, db, center.ID)
	centerUUID := uuid.UUID(center.ID.Bytes)

	classID := insertClassRaw(t, db, centerUUID, "Roster Class")
	sess := insertSessionRaw(t, db, centerUUID, classID, time.Now().Add(-1*time.Hour), nil)
	marked := insertUserRaw(t, db, "marked-"+uuid.NewString()[:8]+"@example.com", "Marked Student")
	unmarked := insertUserRaw(t, db, "unmarked-"+uuid.NewString()[:8]+"@example.com", "Unmarked Student")
	insertEnrollmentRaw(t, db, centerUUID, marked, classID, "active")
	insertEnrollmentRaw(t, db, centerUUID, unmarked, classID, "active")
	insertAttendanceRaw(t, db, centerUUID, sess, marked, marked, "late")

	q := generated.New(db)
	// GREEN SEAM — ListAttendanceRosterBySession does not exist yet (compile-red).
	roster, err := q.ListAttendanceRosterBySession(ctx, generated.ListAttendanceRosterBySessionParams{
		ClassID: pgUUIDForTest(classID), SessionID: pgUUIDForTest(sess),
	})
	if err != nil {
		t.Fatalf("roster read: %v", err)
	}
	if len(roster) != 2 {
		t.Fatalf("roster returned %d entries, expected 2 active enrollments", len(roster))
	}
	// Exactly one entry has a non-null status ('late'); the other is unmarked (null).
	var withStatus, withoutStatus int
	for _, r := range roster {
		if r.Status.Valid {
			withStatus++
		} else {
			withoutStatus++
		}
	}
	if withStatus != 1 || withoutStatus != 1 {
		t.Errorf("expected 1 marked + 1 unmarked(null), got %d marked / %d unmarked", withStatus, withoutStatus)
	}
}
