// Story 7.1a (AC9/AC10/AC21/AC22 · D2/D7/D12/D17b · risk=7) — the invite WIDENING:
// real email delivery (the shipped hook DISCARDS the raw token, auth_admin.go:194-198),
// name/classId/welcomeNote persistence, D12 expired-supersede, classId-requires-teacher,
// FR-11, and the ★ TOKEN ROUND-TRIP (mint → email → hash == persisted → raw feeds
// AcceptInvite → membership) that proves the LINK WORKS, not just "enqueued".
//
// package service_test — reuses newAuthService + drainQueueOnce (auth_test.go).
//
// RED (`//go:build atdd_red_phase`, quarantined): compile-fails on the GREENFIELD
// invite seam only — service.AdminInviteStaffInput and the widened
// (*AuthService).AdminInviteStaff(ctx, tc, AdminInviteStaffInput) signature. The
// shipped signature is AdminInviteStaff(ctx, tc, email, role string).
//
// GREEN SEAMS (dev — Task 5, auth_admin.go):
//
//	type AdminInviteStaffInput struct { Email, Role string; Name, WelcomeNote *string; ClassID *uuid.UUID }
//	AdminInviteStaff(ctx, tc, AdminInviteStaffInput) (*InviteResult, error):
//	  - stop discarding the raw token: mint → build acceptURL carrying `?token=<raw>`
//	    → RenderInviteEmail(stripCRLFAndControls(centerName), inviter, role, acceptURL)
//	    (+ welcomeNote, HTML-escaped) → retry.Enqueue BEST-EFFORT (failure never fails write).
//	  - persist name + class_id; classId accepted ONLY when role=teacher (422 else),
//	    class must resolve in-tenant (404 CLASS_NOT_FOUND else).
//	  - D12: if the sole unaccepted invite for (center, LOWER(email)) is EXPIRED,
//	    refresh it in place (new token/expiry/role/name/class_id) instead of 409;
//	    a NON-expired unaccepted invite still 409s INVITE_EMAIL_TAKEN.
package service_test

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/ducdo/classlite-api/internal/model"
	"github.com/ducdo/classlite-api/internal/service"
	"github.com/ducdo/classlite-api/internal/test"
	"github.com/google/uuid"
)

func ownerTC(centerID, userID uuid.UUID) model.TenantContext {
	return model.TenantContext{CenterID: centerID.String(), UserID: userID.String(), Role: "owner"}
}

func sha256Hex(raw string) string {
	sum := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(sum[:])
}

// extractInviteToken pulls the raw token from the last sent invite email.
// SEAM: the acceptURL must carry the raw token as `?token=<raw>` (D2).
func extractInviteToken(t *testing.T, sender *service.MockEmailSender) string {
	t.Helper()
	emails := sender.Snapshot()
	if len(emails) == 0 {
		t.Fatal("no invite email recorded")
	}
	html := emails[len(emails)-1].HTML
	m := regexp.MustCompile(`token=([A-Za-z0-9_.\-]+)`).FindStringSubmatch(html)
	if m == nil {
		t.Fatalf("no token= in invite email body: %q", html)
	}
	return m[1]
}

// seedStaffOwnerCenter creates center A + an owner member and returns the ids.
func seedStaffOwnerCenter(t *testing.T, db *test.TxDB, centerName string) (centerID, ownerID uuid.UUID) {
	t.Helper()
	centerA := test.CreateCenterWithID(t, db, test.TenantAID, centerName, "center-a")
	owner := test.CreateUser(t, db, "owner@example.com", "Owner")
	test.TenantContext(t, db, centerA.ID)
	test.CreateCenterMember(t, db, owner.ID, centerA.ID, "owner")
	return uuid.UUID(centerA.ID.Bytes), uuid.UUID(owner.ID.Bytes)
}

func strptr(s string) *string { return &s }

// AC9/D2 — ★ token round-trip: invite → email → hash == persisted token_hash →
// raw token feeds AcceptInvite → membership created.
func TestStaffInvite_TokenRoundTripToMembership_ATDD(t *testing.T) {
	db := test.SetupDB(t)
	svc, _, sender, queue := newAuthService(db)
	centerID, ownerID := seedStaffOwnerCenter(t, db, "Round Trip Center")

	_, err := svc.AdminInviteStaff(context.Background(), ownerTC(centerID, ownerID), service.AdminInviteStaffInput{
		Email: "newteacher@example.com",
		Role:  "teacher",
	})
	if err != nil {
		t.Fatalf("AdminInviteStaff: %v", err)
	}
	drainQueueOnce(t, queue, sender, 1)

	raw := extractInviteToken(t, sender)

	var persisted string
	if err := db.QueryRow(context.Background(),
		`SELECT token_hash FROM invites WHERE center_id=$1 AND LOWER(email)=LOWER($2) AND accepted_at IS NULL`,
		centerID, "newteacher@example.com").Scan(&persisted); err != nil {
		t.Fatalf("read persisted token_hash: %v", err)
	}
	if persisted != sha256Hex(raw) {
		t.Fatalf("TOKEN MISMATCH: email token hashes to %s, persisted %s", sha256Hex(raw), persisted)
	}

	// The raw token must actually accept.
	if _, err := svc.AcceptInvite(context.Background(), service.AcceptInviteInput{
		Token: raw, FullName: "New Teacher", Password: "StrongPass123!",
	}); err != nil {
		t.Fatalf("AcceptInvite with round-tripped token: %v", err)
	}
	var members int
	if err := db.QueryRow(context.Background(),
		`SELECT count(*) FROM center_members cm JOIN users u ON u.id=cm.user_id
		 WHERE cm.center_id=$1 AND LOWER(u.email)=LOWER($2)`,
		centerID, "newteacher@example.com").Scan(&members); err != nil {
		t.Fatalf("count membership: %v", err)
	}
	if members != 1 {
		t.Errorf("round-trip membership: got %d, want 1", members)
	}
}

// AC22/D17b — welcomeNote HTML escaped in the body; centerName CRLF stripped.
func TestStaffInvite_WelcomeNoteEscaped_CenterNameStripped_ATDD(t *testing.T) {
	db := test.SetupDB(t)
	svc, _, sender, queue := newAuthService(db)
	// centers.name has no CRLF ban — the service must strip it before rendering.
	centerID, ownerID := seedStaffOwnerCenter(t, db, "Evil\r\nBcc: attacker@example.com")

	_, err := svc.AdminInviteStaff(context.Background(), ownerTC(centerID, ownerID), service.AdminInviteStaffInput{
		Email:       "note@example.com",
		Role:        "teacher",
		WelcomeNote: strptr(`<script>alert(1)</script>`),
	})
	if err != nil {
		t.Fatalf("AdminInviteStaff: %v", err)
	}
	drainQueueOnce(t, queue, sender, 1)
	html := sender.Snapshot()[0].HTML

	if strings.Contains(html, "<script>alert(1)</script>") {
		t.Error("XSS: raw <script> welcomeNote survived into the email body unescaped")
	}
	if strings.Contains(html, "\r") {
		t.Error("SMTP-INJECTION: carriage return from centerName survived into the email body")
	}
}

// AC22 — email best-effort: an injected send failure must NOT fail the invite write.
func TestStaffInvite_EmailFailure_InviteStillCommitted_ATDD(t *testing.T) {
	db := test.SetupDB(t)
	svc, _, sender, _ := newAuthService(db)
	sender.SendError = errors.New("resend down") // enqueue path must swallow this
	centerID, ownerID := seedStaffOwnerCenter(t, db, "Best Effort Center")

	res, err := svc.AdminInviteStaff(context.Background(), ownerTC(centerID, ownerID), service.AdminInviteStaffInput{
		Email: "besteffort@example.com",
		Role:  "teacher",
	})
	if err != nil {
		t.Fatalf("invite must succeed despite email failure, got: %v", err)
	}
	if res == nil {
		t.Fatal("invite result nil despite committed write")
	}
	var n int
	if err := db.QueryRow(context.Background(),
		`SELECT count(*) FROM invites WHERE center_id=$1 AND LOWER(email)=LOWER($2) AND accepted_at IS NULL`,
		centerID, "besteffort@example.com").Scan(&n); err != nil {
		t.Fatalf("count invites: %v", err)
	}
	if n != 1 {
		t.Errorf("invite row committed=%d, want 1 (best-effort email must not roll back the write)", n)
	}
}

// AC10/AC21/D12 — ★ an EXPIRED unaccepted invite is SUPERSEDED in place (no 409);
// a NON-expired unaccepted invite still 409s.
func TestStaffInvite_ExpiredSupersedes_NonExpired409_ATDD(t *testing.T) {
	db := test.SetupDB(t)
	svc, _, _, _ := newAuthService(db)
	centerID, ownerID := seedStaffOwnerCenter(t, db, "Supersede Center")
	email := "resend@example.com"

	// Seed an EXPIRED unaccepted invite directly.
	oldHash := sha256Hex("old-expired-token")
	if _, err := db.Exec(context.Background(),
		`INSERT INTO invites (center_id, inviter_id, email, role, token_hash, expires_at)
		 VALUES ($1, $2, $3, 'teacher', $4, now() - interval '1 hour')`,
		centerID, ownerID, email, oldHash); err != nil {
		t.Fatalf("seed expired invite: %v", err)
	}

	// Re-invite → SUPERSEDE in place: no 409, new token_hash, future expiry.
	if _, err := svc.AdminInviteStaff(context.Background(), ownerTC(centerID, ownerID), service.AdminInviteStaffInput{
		Email: email, Role: "teacher",
	}); err != nil {
		t.Fatalf("D12 supersede must succeed on expired invite, got: %v", err)
	}
	var rowCount int
	var tokenHash string
	var expiresAt time.Time
	if err := db.QueryRow(context.Background(),
		`SELECT count(*) OVER (), token_hash, expires_at FROM invites
		 WHERE center_id=$1 AND LOWER(email)=LOWER($2) AND accepted_at IS NULL LIMIT 1`,
		centerID, email).Scan(&rowCount, &tokenHash, &expiresAt); err != nil {
		t.Fatalf("read superseded invite: %v", err)
	}
	if rowCount != 1 {
		t.Errorf("supersede should keep ≤1 unaccepted row, got %d (partial-unique index invariant)", rowCount)
	}
	if tokenHash == oldHash {
		t.Error("supersede did not rotate the token_hash")
	}
	if !expiresAt.After(time.Now()) {
		t.Error("supersede did not refresh expires_at into the future")
	}

	// A NON-expired unaccepted invite still 409s.
	if _, err := svc.AdminInviteStaff(context.Background(), ownerTC(centerID, ownerID), service.AdminInviteStaffInput{
		Email: email, Role: "teacher",
	}); err == nil {
		t.Error("re-invite over a NON-expired unaccepted invite must 409 INVITE_EMAIL_TAKEN")
	} else {
		var taken *service.InviteEmailTakenError
		if !errors.As(err, &taken) {
			t.Errorf("want InviteEmailTakenError, got %T: %v", err, err)
		}
	}
}

// AC10/D7 — classId-requires-teacher (non-teacher+classId → 422); classId not in
// center → 404 CLASS_NOT_FOUND; FR-11 admin-invites-owner → 403.
func TestStaffInvite_ClassIdGuardsAndFR11_ATDD(t *testing.T) {
	db := test.SetupDB(t)
	svc, _, _, _ := newAuthService(db)
	centerID, ownerID := seedStaffOwnerCenter(t, db, "Guards Center")
	classA := insertClassInTenant(t, db, centerID, "Guard Class")

	// (a) non-teacher role + classId → 422.
	_, err := svc.AdminInviteStaff(context.Background(), ownerTC(centerID, ownerID), service.AdminInviteStaffInput{
		Email: "adminwithclass@example.com", Role: "admin", ClassID: &classA,
	})
	if !isValidationError(err) {
		t.Errorf("admin+classId: want ValidationError (422), got %T: %v", err, err)
	}

	// (b) classId not in this center → 404 CLASS_NOT_FOUND.
	foreign := uuid.New()
	_, err = svc.AdminInviteStaff(context.Background(), ownerTC(centerID, ownerID), service.AdminInviteStaffInput{
		Email: "teacherwithbadclass@example.com", Role: "teacher", ClassID: &foreign,
	})
	if err == nil || !strings.Contains(strings.ToUpper(err.Error()), "CLASS") {
		t.Errorf("teacher+foreign classId: want CLASS_NOT_FOUND (404), got %v", err)
	}

	// (c) FR-11 — an Admin caller assigning the Owner role → 403.
	admin := test.CreateUser(t, db, "adminctr@example.com", "Admin Caller")
	test.CreateCenterMember(t, db, admin.ID, staffPgUUID(centerID), "admin")
	adminTC := model.TenantContext{CenterID: centerID.String(), UserID: uuid.UUID(admin.ID.Bytes).String(), Role: "admin"}
	_, err = svc.AdminInviteStaff(context.Background(), adminTC, service.AdminInviteStaffInput{
		Email: "wannabeowner@example.com", Role: "owner",
	})
	var roleForbidden *service.RoleAssignmentForbiddenError
	if err == nil || !errors.As(err, &roleForbidden) {
		t.Errorf("FR-11 admin-invites-owner: want RoleAssignmentForbiddenError (403), got %T: %v", err, err)
	}
}
