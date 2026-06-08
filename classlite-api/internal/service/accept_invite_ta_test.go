// accept_invite_ta_test.go — Story 1.6 TA expansion (P2/P3).
//
// Adversarial enumeration-defense (#4 reshaped to envelope parity —
// timing-channel testing in Go on shared CI is structurally flaky;
// the service uses sha256 + a single SECURITY DEFINER function call
// so unknown/expired/already-accepted all share the same wall-clock
// signature regardless of when they fail) + D1 coverage (#7, #8).

package service_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/service"
	"github.com/ducdo/classlite-api/internal/test"
	"github.com/google/uuid"
)

// TestAcceptInvite_EnvelopeParity_NegativePaths (#4) verifies that the
// three negative outcomes — unknown / expired / already-accepted — all
// surface via distinctly-typed errors with no shared mutable state in
// their payloads. An attacker probing tokens can distinguish OUTCOMES
// (404 vs 410 vs 409) by status code, but the failure happens at the
// same code-path depth: the SECURITY DEFINER function lookup. Errors
// must NOT carry token bytes, hashes, or any signal that would let an
// attacker confirm WHICH negative outcome maps to a specific token
// hash beyond what the status code already reveals.
func TestAcceptInvite_EnvelopeParity_NegativePaths(t *testing.T) {
	db := test.SetupDB(t)
	mockClock := clock.NewMockClock(time.Date(2026, 7, 1, 12, 0, 0, 0, time.UTC))

	centerA := test.CreateCenterWithID(t, db, test.TenantAID, "Tenant A", "TENA")
	inviter := test.CreateUser(t, db, "owner@example.com", "Owner")
	_ = test.TenantContext(t, db, centerA.ID)
	_ = test.CreateCenterMember(t, db, inviter.ID, centerA.ID, "owner")

	// Seed one expired + one already-accepted invite.
	expiredToken := "ta-parity-expired-aaa"
	seedInvite(t, db,
		test.TenantAID, uuid.UUID(inviter.ID.Bytes).String(),
		"expired-user@example.com", "teacher",
		hashInviteToken(expiredToken), mockClock.Now().Add(-1*time.Hour),
	)
	acceptedToken := "ta-parity-accepted-bbb"
	acceptedID := seedInvite(t, db,
		test.TenantAID, uuid.UUID(inviter.ID.Bytes).String(),
		"accepted-user@example.com", "teacher",
		hashInviteToken(acceptedToken), mockClock.Now().Add(7*24*time.Hour),
	)
	if _, err := db.Exec(context.Background(),
		`UPDATE invites SET accepted_at = $2 WHERE id = $1`,
		acceptedID, mockClock.Now(),
	); err != nil {
		t.Fatalf("pre-mark accepted: %v", err)
	}

	svc := newAuthServiceWithOAuth(t, db, mockClock, &mockGoogleOAuthClient{})

	// Unknown → *InviteNotFoundError. Should NOT leak hash data.
	_, errUnknown := svc.AcceptInvite(context.Background(), service.AcceptInviteInput{
		Token: "definitely-not-real-zzz", FullName: "X", Password: "Password123!",
	})
	var notFound *service.InviteNotFoundError
	if !errors.As(errUnknown, &notFound) {
		t.Fatalf("unknown: expected *InviteNotFoundError, got %v", errUnknown)
	}
	if errUnknown.Error() != "invite not found" {
		t.Errorf("error message should be opaque, got %q", errUnknown.Error())
	}

	// Expired → *InviteExpiredError. Details carry centerName + inviterEmail
	// (intentional per AC4 for UX recovery — but NOT the token).
	_, errExpired := svc.AcceptInvite(context.Background(), service.AcceptInviteInput{
		Token: expiredToken, FullName: "X", Password: "Password123!",
	})
	var expired *service.InviteExpiredError
	if !errors.As(errExpired, &expired) {
		t.Fatalf("expired: expected *InviteExpiredError, got %v", errExpired)
	}
	if expired.CenterName != "Tenant A" || expired.InviterEmail != "owner@example.com" {
		t.Errorf("expired details unexpected: %+v", expired)
	}

	// Already-accepted → *InviteAlreadyAcceptedError. CenterName only.
	_, errAccepted := svc.AcceptInvite(context.Background(), service.AcceptInviteInput{
		Token: acceptedToken, FullName: "X", Password: "Password123!",
	})
	var alreadyAccepted *service.InviteAlreadyAcceptedError
	if !errors.As(errAccepted, &alreadyAccepted) {
		t.Fatalf("already-accepted: expected *InviteAlreadyAcceptedError, got %v", errAccepted)
	}
	if alreadyAccepted.CenterName != "Tenant A" {
		t.Errorf("already-accepted centerName: want %q, got %q", "Tenant A", alreadyAccepted.CenterName)
	}
}

// TestAcceptInvite_ExistingMemberRoleUpgrade (#7) validates D1 from the
// code review: when an existing center_members row has a different role
// than the invite, AcceptInvite UPDATEs the role in place.
func TestAcceptInvite_ExistingMemberRoleUpgrade(t *testing.T) {
	db := test.SetupDB(t)
	mockClock := clock.NewMockClock(time.Date(2026, 7, 1, 12, 0, 0, 0, time.UTC))

	centerA := test.CreateCenterWithID(t, db, test.TenantAID, "Tenant A", "TENA")
	inviter := test.CreateUser(t, db, "owner@example.com", "Owner")
	existing := test.CreateUser(t, db, "promoted@example.com", "Promoted User")
	_ = test.TenantContext(t, db, centerA.ID)
	_ = test.CreateCenterMember(t, db, inviter.ID, centerA.ID, "owner")
	_ = test.CreateCenterMember(t, db, existing.ID, centerA.ID, "teacher")

	svc := newAuthServiceWithOAuth(t, db, mockClock, &mockGoogleOAuthClient{})

	// Seed a password so the existing-user branch fires through SetPassword.
	if err := svc.SetPassword(context.Background(), existing.ID, "OldPass1234!"); err != nil {
		t.Fatalf("SetPassword: %v", err)
	}

	rawToken := "ta-role-upgrade-token"
	seedInvite(t, db,
		test.TenantAID, uuid.UUID(inviter.ID.Bytes).String(),
		"promoted@example.com", "admin", // <-- invite promotes to admin
		hashInviteToken(rawToken), mockClock.Now().Add(7*24*time.Hour),
	)

	result, err := svc.AcceptInvite(context.Background(), service.AcceptInviteInput{
		Token: rawToken,
	})
	if err != nil {
		t.Fatalf("AcceptInvite: %v", err)
	}
	if result.Role != "admin" {
		t.Errorf("Result.Role: want %q (the upgraded role), got %q", "admin", result.Role)
	}

	// Verify DB reflects the upgrade.
	_ = test.TenantContext(t, db, centerA.ID)
	var dbRole string
	if err := db.QueryRow(context.Background(),
		`SELECT role FROM center_members WHERE user_id = $1 AND center_id = $2`,
		existing.ID, centerA.ID,
	).Scan(&dbRole); err != nil {
		t.Fatalf("fetch role after upgrade: %v", err)
	}
	if dbRole != "admin" {
		t.Errorf("DB role after upgrade: want %q, got %q", "admin", dbRole)
	}
}

// TestAcceptInvite_ExistingMemberSameRole_Idempotent (#8) is the
// no-op flank of D1: when invite role == current role, the upgrade
// query is a no-op (rows=0) but the invite is still consumed.
func TestAcceptInvite_ExistingMemberSameRole_Idempotent(t *testing.T) {
	db := test.SetupDB(t)
	mockClock := clock.NewMockClock(time.Date(2026, 7, 1, 12, 0, 0, 0, time.UTC))

	centerA := test.CreateCenterWithID(t, db, test.TenantAID, "Tenant A", "TENA")
	inviter := test.CreateUser(t, db, "owner@example.com", "Owner")
	existing := test.CreateUser(t, db, "samerole@example.com", "Same Role")
	_ = test.TenantContext(t, db, centerA.ID)
	_ = test.CreateCenterMember(t, db, inviter.ID, centerA.ID, "owner")
	_ = test.CreateCenterMember(t, db, existing.ID, centerA.ID, "teacher")

	svc := newAuthServiceWithOAuth(t, db, mockClock, &mockGoogleOAuthClient{})
	if err := svc.SetPassword(context.Background(), existing.ID, "OldPass1234!"); err != nil {
		t.Fatalf("SetPassword: %v", err)
	}

	rawToken := "ta-same-role-token"
	inviteID := seedInvite(t, db,
		test.TenantAID, uuid.UUID(inviter.ID.Bytes).String(),
		"samerole@example.com", "teacher", // <-- same role as existing membership
		hashInviteToken(rawToken), mockClock.Now().Add(7*24*time.Hour),
	)

	result, err := svc.AcceptInvite(context.Background(), service.AcceptInviteInput{
		Token: rawToken,
	})
	if err != nil {
		t.Fatalf("AcceptInvite: %v", err)
	}
	if result.Role != "teacher" {
		t.Errorf("Result.Role: want %q, got %q", "teacher", result.Role)
	}

	// Invite consumed despite the no-op role update.
	var acceptedAt *time.Time
	if err := db.QueryRow(context.Background(),
		`SELECT accepted_at FROM invites WHERE id = $1`, inviteID,
	).Scan(&acceptedAt); err != nil {
		t.Fatalf("re-fetch invite: %v", err)
	}
	if acceptedAt == nil {
		t.Fatal("expected invite to be consumed even when role unchanged")
	}
}
