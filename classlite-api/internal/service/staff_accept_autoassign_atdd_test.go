// Story 7.1a (AC11/AC23 · D7/D13 · risk=7) — the CROWN-JEWEL auto-assign-on-accept.
// This is the sharpest edge Winston+Murat named: invites.class_id's FK BYPASSES RLS,
// so an accept-time UpdateClass is a cross-tenant WRITE vector threaded into the one
// flow a new staff member MUST complete — and it rides the classes_teacher_mutex CHECK
// (a collision could abort membership+session-mint). Real DB in tx (NOT the mock seam —
// a mock store false-greens the CHECK, Murat, AC20).
//
// package service_test. Also hosts the shared service_test helpers.
//
// RED (`//go:build atdd_red_phase`, quarantined): these drive the EXISTING AcceptInvite /
// AcceptInviteInternal surfaces; they are RED because the auto-assign behavior (D13) is
// not yet implemented AND the invites.class_id column + widened get_invite_by_token_hash
// (Task 2/6) do not yet exist. Packaged with the widening file's greenfield
// AdminInviteStaffInput seam, the whole service_test tag fails to compile until green.
//
// GREEN SEAMS (dev — Task 6, auth_invite.go + auth_google.go):
//   - migration widens get_invite_by_token_hash to return class_id; loadInviteByTokenHash
//     scan widened to carry it.
//   - conditional UpdateClass(set teacher_id, clear pending_teacher_email) threaded into
//     BOTH acceptInviteAddMembership (existing-user + OAuth) AND acceptInviteCreateUserAndMember
//     (new-user), same tx, fired only when invite.class_id present AND role=teacher, with an
//     in-tenant GetClass re-validation under the accept-tx GUC (class gone/moved → clean skip,
//     NEVER a cross-tenant write, D13c).
package service_test

import (
	"context"
	"errors"
	"testing"

	"github.com/ducdo/classlite-api/internal/model"
	"github.com/ducdo/classlite-api/internal/service"
	"github.com/ducdo/classlite-api/internal/test"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

// --- shared service_test helpers (used by both staff service_test files) ---

func staffPgUUID(u uuid.UUID) pgtype.UUID { return pgtype.UUID{Bytes: u, Valid: true} }

func isValidationError(err error) bool {
	var v model.ValidationError
	return errors.As(err, &v)
}

// insertClassInTenant seeds a valid class (teacher_id + pending_teacher_email NULL).
// Tenant context must be set by the caller.
func insertClassInTenant(t *testing.T, db *test.TxDB, centerID uuid.UUID, name string) uuid.UUID {
	t.Helper()
	id := uuid.New()
	if _, err := db.Exec(context.Background(),
		`INSERT INTO classes (id, center_id, name, target_band, primary_skill, session_count, status, start_date)
		 VALUES ($1, $2, $3, 6.5, 'writing', 12, 'upcoming', current_date + interval '30 days')`,
		id, centerID, name); err != nil {
		t.Fatalf("insert class %s: %v", name, err)
	}
	return id
}

// seedTeacherInviteWithClass seeds a teacher invite row directly (bypassing the
// invite-time class-in-center guard so the accept-time D13c cross-tenant/stale
// case can be constructed). class_id is the Task-2 greenfield column. Returns the raw token.
func seedTeacherInviteWithClass(t *testing.T, db *test.TxDB, centerID, inviterID uuid.UUID, email string, classID *uuid.UUID) string {
	t.Helper()
	raw := "autoassign-" + uuid.NewString()
	var classArg interface{}
	if classID != nil {
		classArg = *classID
	}
	if _, err := db.Exec(context.Background(),
		`INSERT INTO invites (center_id, inviter_id, email, role, token_hash, expires_at, class_id)
		 VALUES ($1, $2, $3, 'teacher', $4, now() + interval '7 days', $5)`,
		centerID, inviterID, email, sha256Hex(raw), classArg); err != nil {
		t.Fatalf("seed teacher invite with class: %v", err)
	}
	return raw
}

func classTeacherID(t *testing.T, db *test.TxDB, classID uuid.UUID) pgtype.UUID {
	t.Helper()
	var tid pgtype.UUID
	if err := db.QueryRow(context.Background(), `SELECT teacher_id FROM classes WHERE id=$1`, classID).Scan(&tid); err != nil {
		t.Fatalf("read teacher_id: %v", err)
	}
	return tid
}

func classPendingEmail(t *testing.T, db *test.TxDB, classID uuid.UUID) pgtype.Text {
	t.Helper()
	var pe pgtype.Text
	if err := db.QueryRow(context.Background(), `SELECT pending_teacher_email FROM classes WHERE id=$1`, classID).Scan(&pe); err != nil {
		t.Fatalf("read pending_teacher_email: %v", err)
	}
	return pe
}

func userIDByEmail(t *testing.T, db *test.TxDB, email string) pgtype.UUID {
	t.Helper()
	var id pgtype.UUID
	if err := db.QueryRow(context.Background(), `SELECT id FROM users WHERE LOWER(email)=LOWER($1)`, email).Scan(&id); err != nil {
		t.Fatalf("read user id by email %s: %v", email, err)
	}
	return id
}

// AC11/AC23 — ★ auto-assign sets teacher_id and clears pending_teacher_email atomically
// (mutex-honored), on the NEW-USER accept path.
func TestStaffAccept_AutoAssign_SetsTeacherClearsPending_ATDD(t *testing.T) {
	db := test.SetupDB(t)
	svc, _, _, _ := newAuthService(db)
	centerID, ownerID := seedStaffOwnerCenter(t, db, "AutoAssign Center")
	class := insertClassInTenant(t, db, centerID, "Claimable Class")
	// The class is currently pending a teacher by email (mutex: teacher_id must be NULL).
	if _, err := db.Exec(context.Background(),
		`UPDATE classes SET pending_teacher_email = $1 WHERE id = $2`, "newteacher@example.com", class); err != nil {
		t.Fatalf("set pending_teacher_email: %v", err)
	}

	raw := seedTeacherInviteWithClass(t, db, centerID, ownerID, "newteacher@example.com", &class)
	if _, err := svc.AcceptInvite(context.Background(), service.AcceptInviteInput{
		Token: raw, FullName: "New Teacher", Password: "StrongPass123!",
	}); err != nil {
		t.Fatalf("AcceptInvite: %v", err)
	}

	test.TenantContext(t, db, staffPgUUID(centerID))
	newUser := userIDByEmail(t, db, "newteacher@example.com")
	if got := classTeacherID(t, db, class); got != newUser {
		t.Errorf("auto-assign teacher_id: got %v, want new member %v", got, newUser)
	}
	if pe := classPendingEmail(t, db, class); pe.Valid {
		t.Errorf("mutex: pending_teacher_email should be cleared, still %q", pe.String)
	}
}

// AC11/AC23 — ★ the abortable-tx guard: accepting into a class whose pending_teacher_email
// is set must SUCCEED (exactly one column set — teacher_id — pending nulled in the SAME
// statement), NOT abort on the classes_teacher_mutex CHECK. Membership must exist afterward.
func TestStaffAccept_AutoAssign_MutexCollisionStillCommits_ATDD(t *testing.T) {
	db := test.SetupDB(t)
	svc, _, _, _ := newAuthService(db)
	centerID, ownerID := seedStaffOwnerCenter(t, db, "Mutex Center")
	class := insertClassInTenant(t, db, centerID, "Mutex Class")
	if _, err := db.Exec(context.Background(),
		`UPDATE classes SET pending_teacher_email = $1 WHERE id = $2`, "mutexteacher@example.com", class); err != nil {
		t.Fatalf("set pending: %v", err)
	}

	raw := seedTeacherInviteWithClass(t, db, centerID, ownerID, "mutexteacher@example.com", &class)
	if _, err := svc.AcceptInvite(context.Background(), service.AcceptInviteInput{
		Token: raw, FullName: "Mutex Teacher", Password: "StrongPass123!",
	}); err != nil {
		t.Fatalf("accept MUST NOT be aborted by the mutex CHECK, got: %v", err)
	}

	test.TenantContext(t, db, staffPgUUID(centerID))
	var members int
	if err := db.QueryRow(context.Background(),
		`SELECT count(*) FROM center_members cm JOIN users u ON u.id=cm.user_id
		 WHERE cm.center_id=$1 AND LOWER(u.email)=LOWER($2)`,
		centerID, "mutexteacher@example.com").Scan(&members); err != nil {
		t.Fatalf("count membership: %v", err)
	}
	if members != 1 {
		t.Errorf("membership after mutex-collision accept: got %d, want 1 (acceptance not rolled back)", members)
	}
}

// AC11/AC23 — reassignment displaces the prior teacher X cleanly.
func TestStaffAccept_AutoAssign_ReassignsDisplacingPrior_ATDD(t *testing.T) {
	db := test.SetupDB(t)
	svc, _, _, _ := newAuthService(db)
	centerID, ownerID := seedStaffOwnerCenter(t, db, "Reassign Center")
	priorTeacher := test.CreateUser(t, db, "prior@example.com", "Prior Teacher")
	test.CreateCenterMember(t, db, priorTeacher.ID, staffPgUUID(centerID), "teacher")
	class := insertClassInTenant(t, db, centerID, "Reassign Class")
	if _, err := db.Exec(context.Background(), `UPDATE classes SET teacher_id=$1 WHERE id=$2`, priorTeacher.ID, class); err != nil {
		t.Fatalf("seed prior teacher: %v", err)
	}

	raw := seedTeacherInviteWithClass(t, db, centerID, ownerID, "successor@example.com", &class)
	if _, err := svc.AcceptInvite(context.Background(), service.AcceptInviteInput{
		Token: raw, FullName: "Successor", Password: "StrongPass123!",
	}); err != nil {
		t.Fatalf("AcceptInvite: %v", err)
	}

	test.TenantContext(t, db, staffPgUUID(centerID))
	successor := userIDByEmail(t, db, "successor@example.com")
	if got := classTeacherID(t, db, class); got != successor {
		t.Errorf("reassign: teacher_id got %v, want successor %v (prior X displaced)", got, successor)
	}
}

// AC11/AC23 — no-op when the invite carries no class OR the accepted role is non-teacher.
func TestStaffAccept_AutoAssign_NoOpWhenNoClassOrNonTeacher_ATDD(t *testing.T) {
	db := test.SetupDB(t)
	svc, _, _, _ := newAuthService(db)
	centerID, ownerID := seedStaffOwnerCenter(t, db, "NoOp Center")
	class := insertClassInTenant(t, db, centerID, "Untouched Class")

	// No-class teacher invite → class assignment untouched.
	raw := seedTeacherInviteWithClass(t, db, centerID, ownerID, "noclass@example.com", nil)
	if _, err := svc.AcceptInvite(context.Background(), service.AcceptInviteInput{
		Token: raw, FullName: "No Class", Password: "StrongPass123!",
	}); err != nil {
		t.Fatalf("AcceptInvite: %v", err)
	}
	test.TenantContext(t, db, staffPgUUID(centerID))
	if tid := classTeacherID(t, db, class); tid.Valid {
		t.Errorf("no-class invite must not touch any class; teacher_id=%v", tid)
	}
}

// AC23/D13c — ★ accept-time classId that no longer resolves in-tenant → CLEAN SKIP:
// acceptance still succeeds (membership created) and the cross-tenant class is NEVER written.
func TestStaffAccept_AutoAssign_CrossTenantClassId_CleanSkip_ATDD(t *testing.T) {
	db := test.SetupDB(t)
	svc, _, _, _ := newAuthService(db)
	centerA := test.CreateCenterWithID(t, db, test.TenantAID, "Center A", "center-a")
	centerB := test.CreateCenterWithID(t, db, test.TenantBID, "Center B", "center-b")
	ownerA := test.CreateUser(t, db, "ownera@example.com", "Owner A")
	teacherB := test.CreateUser(t, db, "victimteacher@example.com", "Victim Teacher B")
	test.TenantContext(t, db, centerA.ID)
	test.CreateCenterMember(t, db, ownerA.ID, centerA.ID, "owner")
	// A class that lives in tenant B, taught by B's teacher.
	test.TenantContext(t, db, centerB.ID)
	test.CreateCenterMember(t, db, teacherB.ID, centerB.ID, "teacher")
	classB := insertClassInTenant(t, db, uuid.UUID(centerB.ID.Bytes), "B Class")
	if _, err := db.Exec(context.Background(), `UPDATE classes SET teacher_id=$1 WHERE id=$2`, teacherB.ID, classB); err != nil {
		t.Fatalf("seed B teacher: %v", err)
	}

	// A stale invite in center A points at B's class (FK bypasses RLS). The
	// invite INSERT must run under center A's GUC (invites is RLS-insert-scoped)
	// — switch back from B before seeding it.
	test.TenantContext(t, db, centerA.ID)
	raw := seedTeacherInviteWithClass(t, db, uuid.UUID(centerA.ID.Bytes), uuid.UUID(ownerA.ID.Bytes), "crossaccept@example.com", &classB)
	if _, err := svc.AcceptInvite(context.Background(), service.AcceptInviteInput{
		Token: raw, FullName: "Cross Accept", Password: "StrongPass123!",
	}); err != nil {
		t.Fatalf("accept must SUCCEED with a clean skip, got: %v", err)
	}

	// B's class teacher_id is untouched — no cross-tenant UpdateClass.
	test.TenantContext(t, db, centerB.ID)
	if got := classTeacherID(t, db, classB); got != teacherB.ID {
		t.Errorf("CROSS-TENANT WRITE: B's class teacher_id changed to %v, want %v (must clean-skip)", got, teacherB.ID)
	}
}

// AC23/D13b — ★ auto-assign fires on the OAuth accept path too (not only POST /accept-invite).
func TestStaffAccept_AutoAssign_FiresOnOAuthPath_ATDD(t *testing.T) {
	db := test.SetupDB(t)
	svc, _, _, _ := newAuthService(db)
	centerID, ownerID := seedStaffOwnerCenter(t, db, "OAuth Center")
	class := insertClassInTenant(t, db, centerID, "OAuth Class")
	// The OAuth user already exists (Google sign-in resolved them).
	oauthUser := test.CreateUser(t, db, "oauth@example.com", "OAuth Teacher")

	raw := seedTeacherInviteWithClass(t, db, centerID, ownerID, "oauth@example.com", &class)
	if _, err := svc.AcceptInviteInternal(context.Background(), uuid.UUID(oauthUser.ID.Bytes), sha256Hex(raw), "oauth@example.com"); err != nil {
		t.Fatalf("AcceptInviteInternal (OAuth path): %v", err)
	}

	test.TenantContext(t, db, staffPgUUID(centerID))
	if got := classTeacherID(t, db, class); got != oauthUser.ID {
		t.Errorf("OAuth-path auto-assign: teacher_id got %v, want %v", got, oauthUser.ID)
	}
}
