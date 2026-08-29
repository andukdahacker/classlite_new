// Story 7.1a (AC13-17/AC24/AC25/AC28 · D8/D14/D15/D17c · risk=7) — the Owner-only
// staff ACTIONS at the SERVICE seam (service-direct, real DB). The headline is the
// ★ SEC-1 JWT-vs-DB gate: a real-middleware test seeded DB=admin/JWT=owner is blocked
// at RequireRole at the EDGE and NEVER reaches the service's DB role re-fetch (the
// load-bearing gate) — so we call the service with a hand-built TenantContext{Role:"owner"}
// over a DB member row that is 'admin' (E16, "a handler-only test can't reach this").
//
// package service_test.
//
// RED (`//go:build atdd_red_phase`, quarantined): compile-fails on the GREENFIELD
// service seam — service.StaffService / service.NewStaffService and the action methods.
//
// GREEN SEAMS (dev — Task 7):
//
//	NewStaffService(db, audit AuthAuditLogger, retry EmailRetryQueue, clk clock.Clock) *StaffService
//	(*StaffService).ArchiveStaff(ctx, tc, targetUserID uuid.UUID) (*ArchiveResult, error)
//	    ArchiveResult{ AssignedClassCount int } (D17c ghost-visibility)
//	(*StaffService).AssignClass(ctx, tc, targetUserID, classID uuid.UUID) error
//	(*StaffService).ResetStaffPassword(ctx, tc, targetUserID uuid.UUID) error
//	All three: RequireRole edge (handler) + a SERVICE-layer DB role re-fetch (SEC-1);
//	member/class guards → *model.NotFoundError (STAFF_NOT_FOUND / CLASS_NOT_FOUND);
//	audits via InsertAuditLog → audit_logs (entityType center_member), NOT auth_audit_logs (D15);
//	reset reuses the password-reset PRIMITIVES with NO verified-gate / silent / padToFloor (D14).
package service_test

import (
	"context"
	"errors"
	"testing"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/model"
	"github.com/ducdo/classlite-api/internal/service"
	"github.com/ducdo/classlite-api/internal/test"
	"github.com/google/uuid"
)

func newStaffService(db *test.TxDB) (*service.StaffService, *service.MockEmailSender, *service.InProcessRetryQueue) {
	sender := &service.MockEmailSender{}
	queue := service.NewEmailRetryQueue(sender, 8)
	svc := service.NewStaffService(db, service.NewPgAuthAuditLogger(db), queue, clock.RealClock{})
	return svc, sender, queue
}

func isForbidden(err error) bool {
	var sf *service.ForbiddenError
	if errors.As(err, &sf) {
		return true
	}
	var mf model.ForbiddenError
	return errors.As(err, &mf)
}

func isNotFound(err error) bool {
	var nf model.NotFoundError
	return errors.As(err, &nf)
}

// AC16/E16 — ★ SEC-1: caller's JWT claims owner but the DB row is 'admin' → 403 on every
// Owner-only action. DB wins over the stale claim.
func TestStaffService_SEC1_JWTOwnerDBAdmin_403_ATDD(t *testing.T) {
	db := test.SetupDB(t)
	staffSvc, _, _ := newStaffService(db)
	centerID, _ := seedStaffOwnerCenter(t, db, "SEC1 Center")
	adminCaller := test.CreateUser(t, db, "admincaller@example.com", "Admin Caller")
	target := test.CreateUser(t, db, "target@example.com", "Target Teacher")
	test.CreateCenterMember(t, db, adminCaller.ID, staffPgUUID(centerID), "admin")
	test.CreateCenterMember(t, db, target.ID, staffPgUUID(centerID), "teacher")

	// The JWT lies: Role="owner". The DB says admin. Every action must 403.
	staleTC := model.TenantContext{CenterID: centerID.String(), UserID: uuid.UUID(adminCaller.ID.Bytes).String(), Role: "owner"}
	targetID := uuid.UUID(target.ID.Bytes)

	if _, err := staffSvc.ArchiveStaff(context.Background(), staleTC, targetID); !isForbidden(err) {
		t.Errorf("ArchiveStaff SEC-1: want ForbiddenError (403), got %T: %v", err, err)
	}
	if err := staffSvc.AssignClass(context.Background(), staleTC, targetID, uuid.New()); !isForbidden(err) {
		t.Errorf("AssignClass SEC-1: want ForbiddenError (403), got %T: %v", err, err)
	}
	if err := staffSvc.ResetStaffPassword(context.Background(), staleTC, targetID); !isForbidden(err) {
		t.Errorf("ResetStaffPassword SEC-1: want ForbiddenError (403), got %T: %v", err, err)
	}
}

// AC15/AC24/D14 — ★ Owner reset for an UNVERIFIED member creates a password_resets row
// and enqueues the email (NO verified-gate / silent-return / padToFloor).
func TestStaffService_ResetUnverifiedMember_CreatesRowAndEmail_ATDD(t *testing.T) {
	db := test.SetupDB(t)
	staffSvc, sender, queue := newStaffService(db)
	centerID, ownerID := seedStaffOwnerCenter(t, db, "Reset Center")
	// A pre-provisioned, UNVERIFIED member (email_verified stays false).
	member := test.CreateUser(t, db, "unverified@example.com", "Unverified Member")
	test.CreateCenterMember(t, db, member.ID, staffPgUUID(centerID), "teacher")

	ownerTC := model.TenantContext{CenterID: centerID.String(), UserID: ownerID.String(), Role: "owner"}
	if err := staffSvc.ResetStaffPassword(context.Background(), ownerTC, uuid.UUID(member.ID.Bytes)); err != nil {
		t.Fatalf("Owner reset on unverified member must succeed (D14 bypass), got: %v", err)
	}

	var resets int
	if err := db.QueryRow(context.Background(),
		`SELECT count(*) FROM password_resets WHERE user_id=$1`, member.ID).Scan(&resets); err != nil {
		t.Fatalf("count password_resets: %v", err)
	}
	if resets != 1 {
		t.Errorf("password_resets rows for unverified member: got %d, want 1 (D14 no silent no-op)", resets)
	}
	drainQueueOnce(t, queue, sender, 1)
	if sender.Count() != 1 {
		t.Errorf("reset email sent: got %d, want 1", sender.Count())
	}
}

// AC17 — ★ cross-tenant reset sends NOTHING: an Owner in A resetting a B member 404s
// and the email seam received nothing.
func TestStaffService_CrossTenantReset_NoEmail_ATDD(t *testing.T) {
	db := test.SetupDB(t)
	staffSvc, sender, _ := newStaffService(db)
	centerA := test.CreateCenterWithID(t, db, test.TenantAID, "Center A", "center-a")
	centerB := test.CreateCenterWithID(t, db, test.TenantBID, "Center B", "center-b")
	ownerA := test.CreateUser(t, db, "ownera@example.com", "Owner A")
	memberB := test.CreateUser(t, db, "memberb@example.com", "Member B")
	test.TenantContext(t, db, centerA.ID)
	test.CreateCenterMember(t, db, ownerA.ID, centerA.ID, "owner")
	test.TenantContext(t, db, centerB.ID)
	test.CreateCenterMember(t, db, memberB.ID, centerB.ID, "teacher")

	ownerTC := model.TenantContext{CenterID: uuid.UUID(centerA.ID.Bytes).String(), UserID: uuid.UUID(ownerA.ID.Bytes).String(), Role: "owner"}
	err := staffSvc.ResetStaffPassword(context.Background(), ownerTC, uuid.UUID(memberB.ID.Bytes))
	if !isNotFound(err) {
		t.Errorf("cross-tenant reset: want NotFoundError (404 STAFF_NOT_FOUND), got %T: %v", err, err)
	}
	if sender.Count() != 0 {
		t.Errorf("cross-tenant reset sent %d emails, want 0", sender.Count())
	}
	var resets int
	if err := db.QueryRow(context.Background(), `SELECT count(*) FROM password_resets WHERE user_id=$1`, memberB.ID).Scan(&resets); err != nil {
		t.Fatalf("count password_resets: %v", err)
	}
	if resets != 0 {
		t.Errorf("cross-tenant reset created %d password_resets rows for B, want 0", resets)
	}
}

// AC25/D15 — a staff action audit lands in audit_logs (entityType center_member),
// NOT in auth_audit_logs (else invisible in the detail recentActivity block).
func TestStaffService_AuditWritesAuditLogsNotAuthAudit_ATDD(t *testing.T) {
	db := test.SetupDB(t)
	staffSvc, _, _ := newStaffService(db)
	centerID, ownerID := seedStaffOwnerCenter(t, db, "Audit Center")
	target := test.CreateUser(t, db, "audittarget@example.com", "Audit Target")
	test.CreateCenterMember(t, db, target.ID, staffPgUUID(centerID), "teacher")

	ownerTC := model.TenantContext{CenterID: centerID.String(), UserID: ownerID.String(), Role: "owner"}
	if _, err := staffSvc.ArchiveStaff(context.Background(), ownerTC, uuid.UUID(target.ID.Bytes)); err != nil {
		t.Fatalf("ArchiveStaff: %v", err)
	}

	var inAuditLogs int
	if err := db.QueryRow(context.Background(),
		`SELECT count(*) FROM audit_logs WHERE entity_type='center_member' AND action LIKE 'staff.%'`).Scan(&inAuditLogs); err != nil {
		t.Fatalf("count audit_logs: %v", err)
	}
	if inAuditLogs < 1 {
		t.Errorf("staff.archived audit in audit_logs: got %d, want >=1 (D15 — feeds recentActivity)", inAuditLogs)
	}
	var inAuthAudit int
	if err := db.QueryRow(context.Background(),
		`SELECT count(*) FROM auth_audit_logs WHERE event LIKE 'staff.%'`).Scan(&inAuthAudit); err != nil {
		t.Fatalf("count auth_audit_logs: %v", err)
	}
	if inAuthAudit != 0 {
		t.Errorf("staff action leaked into auth_audit_logs: got %d, want 0 (D15)", inAuthAudit)
	}
}

// AC28/D17c — archive of a teacher who still owns N classes SUCCEEDS (classes NOT
// auto-unassigned) and returns assignedClassCount=N (ghost visibility for the UI warn).
func TestStaffService_ArchiveAssignedClassCountGhost_ATDD(t *testing.T) {
	db := test.SetupDB(t)
	staffSvc, _, _ := newStaffService(db)
	centerID, ownerID := seedStaffOwnerCenter(t, db, "Ghost Center")
	teacher := test.CreateUser(t, db, "ghost@example.com", "Ghost Teacher")
	test.CreateCenterMember(t, db, teacher.ID, staffPgUUID(centerID), "teacher")
	for i := 0; i < 2; i++ {
		c := insertClassInTenant(t, db, centerID, "Ghost Class")
		if _, err := db.Exec(context.Background(), `UPDATE classes SET teacher_id=$1 WHERE id=$2`, teacher.ID, c); err != nil {
			t.Fatalf("assign class: %v", err)
		}
	}

	ownerTC := model.TenantContext{CenterID: centerID.String(), UserID: ownerID.String(), Role: "owner"}
	res, err := staffSvc.ArchiveStaff(context.Background(), ownerTC, uuid.UUID(teacher.ID.Bytes))
	if err != nil {
		t.Fatalf("ArchiveStaff: %v", err)
	}
	if res.AssignedClassCount != 2 {
		t.Errorf("ghost assignedClassCount: got %d, want 2", res.AssignedClassCount)
	}
	// Classes are NOT auto-unassigned.
	test.TenantContext(t, db, staffPgUUID(centerID))
	var stillOwned int
	if err := db.QueryRow(context.Background(), `SELECT count(*) FROM classes WHERE teacher_id=$1`, teacher.ID).Scan(&stillOwned); err != nil {
		t.Fatalf("count owned classes: %v", err)
	}
	if stillOwned != 2 {
		t.Errorf("classes auto-unassigned on archive: %d still owned, want 2 (out of scope — must NOT unassign)", stillOwned)
	}
}

// AC13/14/15 — member/class guards: assign a non-teacher-member → 404 STAFF_NOT_FOUND;
// class not in center → 404 CLASS_NOT_FOUND; reset a non-member → 404.
func TestStaffService_ActionMemberClassGuards_404_ATDD(t *testing.T) {
	db := test.SetupDB(t)
	staffSvc, _, _ := newStaffService(db)
	centerID, ownerID := seedStaffOwnerCenter(t, db, "Guards Center")
	ownerTC := model.TenantContext{CenterID: centerID.String(), UserID: ownerID.String(), Role: "owner"}

	// assign to a user who is not a member at all → STAFF_NOT_FOUND.
	stranger := uuid.New()
	realClass := insertClassInTenant(t, db, centerID, "Real Class")
	if err := staffSvc.AssignClass(context.Background(), ownerTC, stranger, realClass); !isNotFound(err) {
		t.Errorf("assign to non-member: want NotFoundError (404 STAFF_NOT_FOUND), got %T: %v", err, err)
	}

	// assign a real teacher a class that is not in the center → CLASS_NOT_FOUND.
	teacher := test.CreateUser(t, db, "guardteacher@example.com", "Guard Teacher")
	test.CreateCenterMember(t, db, teacher.ID, staffPgUUID(centerID), "teacher")
	if err := staffSvc.AssignClass(context.Background(), ownerTC, uuid.UUID(teacher.ID.Bytes), uuid.New()); err == nil {
		t.Error("assign class not-in-center: want CLASS_NOT_FOUND (404), got nil")
	}

	// reset a non-member → STAFF_NOT_FOUND.
	if err := staffSvc.ResetStaffPassword(context.Background(), ownerTC, stranger); !isNotFound(err) {
		t.Errorf("reset non-member: want NotFoundError (404), got %T: %v", err, err)
	}
}
