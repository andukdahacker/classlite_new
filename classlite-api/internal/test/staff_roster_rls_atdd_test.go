// Story 7.1a (AC1/AC3/AC17/AC18/AC28 · D3/D4/D17c · risk=7) — the staff roster
// read model RLS grid + write-isolation + segregation + double-archive execrows.
// Real DB in tx under SET LOCAL ROLE classlite_app so FORCE RLS is enforced (a
// superuser bypasses it). Mirrors auto_grade_results_rls_atdd_test.go (the fresh
// 6-4a sibling): the ★ Murat house rule is that a 0-row cross-tenant write is NOT
// proof on its own — re-read AS TENANT B and assert the value is byte-unchanged.
//
// RED (`//go:build atdd_red_phase`, quarantined): compile-fails on GREENFIELD store
// seams only — generated.ListStaffMembers / GetStaffMember / ArchiveCenterMember
// (+ the Row.Status field). Task-2 migration adds center_members.archived_at; the
// archived_at raw writes here only matter at green (the tag stops these from running).
//
// GREEN SEAMS (dev — Task 3 queries/staff.sql):
//
//	ListStaffMembers(ctx, ListStaffMembersParams{CenterID, Now}) → []ListStaffMembersRow
//	  Row: UserID · Role · Status string ('active'|'archived') · NextSevenDaysSessionCount · Heavy · LastActiveAt
//	  — role IN ('admin','teacher') ONLY; owners EXCLUDED (D3/D11). status='archived'
//	    iff archived_at IS NOT NULL (D4).
//	GetStaffMember(ctx, GetStaffMemberParams{CenterID, UserID}) → row, pgx.ErrNoRows
//	  when not a center member / student / owner (drives 404 STAFF_NOT_FOUND).
//	ArchiveCenterMember(ctx, ArchiveCenterMemberParams{CenterID, UserID}) → int64
//	  (:execrows) — SET archived_at=@now WHERE archived_at IS NULL; 0 rows on
//	  double-archive drives 409 STAFF_ALREADY_ARCHIVED (AC28).
package test

import (
	"context"
	"errors"
	"testing"

	"github.com/ducdo/classlite-api/internal/store/generated"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

// setArchivedAt soft-archives a center_members row (Task-2 column). Raw so the
// red does not depend on the greenfield ArchiveCenterMember for SETUP.
func setArchivedAt(t *testing.T, db *TxDB, centerID, userID uuid.UUID) {
	t.Helper()
	if _, err := db.Exec(context.Background(),
		`UPDATE center_members SET archived_at = now() WHERE center_id = $1 AND user_id = $2`,
		centerID, userID); err != nil {
		t.Fatalf("set archived_at: %v", err)
	}
}

// AC17/F — cross-tenant READ isolation: tenant A's roster omits tenant B members,
// and GetStaffMember(Buser) under A's context returns no row.
func TestRLS_StaffRoster_CrossTenantRead_ATDD(t *testing.T) {
	db := SetupDB(t)
	centerA := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	centerB := CreateCenterWithID(t, db, TenantBID, "Center B", "center-b")
	teacherB := CreateUser(t, db, "teacherb@example.com", "Teacher B")
	TenantContext(t, db, centerB.ID)
	CreateCenterMember(t, db, teacherB.ID, centerB.ID, "teacher")

	TenantContext(t, db, centerA.ID)
	rows, err := generated.New(db).ListStaffMembers(context.Background(), staffRosterParams(centerA.ID, loadNowArg()))
	if err != nil {
		t.Fatalf("ListStaffMembers as A: %v", err)
	}
	for _, r := range rows {
		if r.UserID == teacherB.ID {
			t.Errorf("RLS VIOLATION: tenant A roster contains tenant B member %s", UUIDString(teacherB.ID))
		}
	}

	_, err = generated.New(db).GetStaffMember(context.Background(), generated.GetStaffMemberParams{CenterID: centerA.ID, UserID: teacherB.ID})
	if !errors.Is(err, pgx.ErrNoRows) {
		t.Errorf("GetStaffMember(Buser) under A: want pgx.ErrNoRows (→404), got %v", err)
	}
}

// AC17/F — ★ cross-tenant WRITE isolation on archive: A archiving B's member is a
// 0-row no-op AND the re-read AS B proves archived_at is still NULL.
func TestRLS_StaffArchive_CrossTenant_NoMutation_ATDD(t *testing.T) {
	db := SetupDB(t)
	centerA := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	centerB := CreateCenterWithID(t, db, TenantBID, "Center B", "center-b")
	teacherB := CreateUser(t, db, "victimb@example.com", "Victim B")
	TenantContext(t, db, centerB.ID)
	CreateCenterMember(t, db, teacherB.ID, centerB.ID, "teacher")

	TenantContext(t, db, centerA.ID)
	rows, err := generated.New(db).ArchiveCenterMember(context.Background(), generated.ArchiveCenterMemberParams{
		CenterID: centerA.ID, UserID: teacherB.ID,
	})
	if err != nil {
		t.Logf("cross-tenant ArchiveCenterMember returned %v (0-row no-op expected)", err)
	}
	if rows != 0 {
		t.Errorf("cross-tenant archive affected %d rows, want 0", rows)
	}

	// Re-read AS B — archived_at must still be NULL.
	TenantContext(t, db, centerB.ID)
	var archived pgtype.Timestamptz
	if err := db.QueryRow(context.Background(),
		`SELECT archived_at FROM center_members WHERE center_id = $1 AND user_id = $2`,
		centerB.ID, teacherB.ID).Scan(&archived); err != nil {
		t.Fatalf("re-read as B: %v", err)
	}
	if archived.Valid {
		t.Errorf("RLS WRITE VIOLATION: cross-tenant archive set archived_at on B's member")
	}
}

// AC17/F — ★ cross-tenant WRITE isolation on assign-class: A reassigning B's class
// teacher is a 0-row no-op AND the re-read AS B proves teacher_id is unchanged.
func TestRLS_StaffAssignClass_CrossTenant_NoMutation_ATDD(t *testing.T) {
	db := SetupDB(t)
	centerA := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	centerB := CreateCenterWithID(t, db, TenantBID, "Center B", "center-b")
	teacherB := CreateUser(t, db, "tb@example.com", "Teacher B")
	attacker := CreateUser(t, db, "attacker@example.com", "Attacker")
	TenantContext(t, db, centerB.ID)
	CreateCenterMember(t, db, teacherB.ID, centerB.ID, "teacher")
	classB := insertClassRaw(t, db, uuid.UUID(centerB.ID.Bytes), "B Class")
	assignClassToTeacher(t, db, classB, uuid.UUID(teacherB.ID.Bytes))

	// Attacker in A tries to reassign B's class to themselves.
	TenantContext(t, db, centerA.ID)
	tag, err := db.Exec(context.Background(),
		`UPDATE classes SET teacher_id = $1 WHERE id = $2`, attacker.ID, classB)
	if err != nil {
		t.Logf("cross-tenant class UPDATE returned %v (0-row no-op expected)", err)
	}
	if tag.RowsAffected() != 0 {
		t.Errorf("cross-tenant class reassignment affected %d rows, want 0", tag.RowsAffected())
	}

	TenantContext(t, db, centerB.ID)
	var teacherID pgtype.UUID
	if err := db.QueryRow(context.Background(),
		`SELECT teacher_id FROM classes WHERE id = $1`, classB).Scan(&teacherID); err != nil {
		t.Fatalf("re-read class as B: %v", err)
	}
	if teacherID != teacherB.ID {
		t.Errorf("RLS WRITE VIOLATION: cross-tenant assign changed teacher_id to %v, want %v", teacherID, teacherB.ID)
	}
}

// AC1/AC3/D3 — segregation: archived member surfaces in members with status='archived';
// the owner is EXCLUDED entirely; an active teacher is status='active'; the admin is present.
func TestStaffRoster_SegregatesArchivedPendingExcludesOwner_ATDD(t *testing.T) {
	db := SetupDB(t)
	centerA := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	owner := CreateUser(t, db, "owner@example.com", "Owner")
	admin := CreateUser(t, db, "admin@example.com", "Admin")
	active := CreateUser(t, db, "active@example.com", "Active Teacher")
	archived := CreateUser(t, db, "archived@example.com", "Archived Teacher")
	TenantContext(t, db, centerA.ID)
	CreateCenterMember(t, db, owner.ID, centerA.ID, "owner")
	CreateCenterMember(t, db, admin.ID, centerA.ID, "admin")
	CreateCenterMember(t, db, active.ID, centerA.ID, "teacher")
	CreateCenterMember(t, db, archived.ID, centerA.ID, "teacher")
	setArchivedAt(t, db, uuid.UUID(centerA.ID.Bytes), uuid.UUID(archived.ID.Bytes))

	rows, err := generated.New(db).ListStaffMembers(context.Background(), staffRosterParams(centerA.ID, loadNowArg()))
	if err != nil {
		t.Fatalf("ListStaffMembers: %v", err)
	}
	byUser := map[pgtype.UUID]generated.ListStaffMembersRow{}
	for _, r := range rows {
		byUser[r.UserID] = r
	}
	if _, ok := byUser[owner.ID]; ok {
		t.Error("D3 VIOLATION: owner present in members roster, want excluded")
	}
	if r, ok := byUser[archived.ID]; !ok || r.Status != "archived" {
		t.Errorf("archived member: present=%v status=%q, want present/archived", ok, r.Status)
	}
	if r, ok := byUser[active.ID]; !ok || r.Status != "active" {
		t.Errorf("active member: present=%v status=%q, want present/active", ok, r.Status)
	}
	if _, ok := byUser[admin.ID]; !ok {
		t.Error("admin member missing from roster")
	}
}

// AC28 — ★ double-archive: the first ArchiveCenterMember affects 1 row, the second
// affects 0 (WHERE archived_at IS NULL) → drives 409 STAFF_ALREADY_ARCHIVED.
func TestStaffArchive_DoubleArchiveExecRowsZero_ATDD(t *testing.T) {
	db := SetupDB(t)
	centerA := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	teacher := CreateUser(t, db, "arch@example.com", "Teacher")
	TenantContext(t, db, centerA.ID)
	CreateCenterMember(t, db, teacher.ID, centerA.ID, "teacher")

	first, err := generated.New(db).ArchiveCenterMember(context.Background(), generated.ArchiveCenterMemberParams{CenterID: centerA.ID, UserID: teacher.ID})
	if err != nil {
		t.Fatalf("first archive: %v", err)
	}
	if first != 1 {
		t.Errorf("first archive affected %d rows, want 1", first)
	}
	second, err := generated.New(db).ArchiveCenterMember(context.Background(), generated.ArchiveCenterMemberParams{CenterID: centerA.ID, UserID: teacher.ID})
	if err != nil {
		t.Fatalf("second archive: %v", err)
	}
	if second != 0 {
		t.Errorf("double-archive affected %d rows, want 0 (→409 STAFF_ALREADY_ARCHIVED)", second)
	}
}
