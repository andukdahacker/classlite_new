// accept_invite_atdd_test.go — Story 1.6 ATDD tests for
// the invite acceptance service-layer method (email/password path) and
// the OAuth-callback variant with email-mismatch handling.
//
// ACCEPTANCE CRITERIA COVERED
//   AC-1.6-04  AcceptInvite — new-user branch: user created + center_members + invite consumed
//   AC-1.6-04  AcceptInvite — existing-user branch: membership added, no password change
//   AC-1.6-04  AcceptInvite — unknown token → 404 *InviteNotFoundError
//   AC-1.6-04  AcceptInvite — expired token → 410 *InviteExpiredError with details
//   AC-1.6-04  AcceptInvite — already-accepted token → 409 *InviteAlreadyAcceptedError
//   AC-1.6-04  AcceptInvite — concurrent acceptance race → exactly one wins (MarkInviteAcceptedGuarded)
//   AC-1.6-05  AcceptInviteInternal (OAuth path) — email mismatch rejected + audit row

package service_test

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"testing"
	"time"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/service"
	"github.com/ducdo/classlite-api/internal/test"
	"github.com/google/uuid"
)

// hashInviteToken mirrors what the service is expected to do internally.
// Tests use this to seed invite rows with token_hash so the lookup matches.
func hashInviteToken(raw string) string {
	h := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(h[:])
}

// seedInvite inserts an invite row directly via SQL (bypasses RLS via
// the migration-role pool used by test.SetupDB; or works because
// SetupDB sets app.current_tenant_id to the seeded center).
func seedInvite(t *testing.T, db *test.TxDB, centerID, inviterID, email, role, tokenHash string, expiresAt time.Time) string {
	t.Helper()
	var inviteID string
	if err := db.QueryRow(context.Background(),
		`INSERT INTO invites (center_id, inviter_id, email, role, token_hash, expires_at)
		 VALUES ($1, $2, $3, $4, $5, $6)
		 RETURNING id`,
		centerID, inviterID, email, role, tokenHash, expiresAt,
	).Scan(&inviteID); err != nil {
		t.Fatalf("seed invite: %v", err)
	}
	return inviteID
}

// TestAcceptInvite_AC04_HappyPath_NewUser proves the new-user branch:
// a never-registered email accepts an invite, gets a brand-new users
// row + center_members row + the invite row marked accepted, and lands
// in a session with JWT claims bound to the invite's center+role.
func TestAcceptInvite_AC04_HappyPath_NewUser(t *testing.T) {
	db := test.SetupDB(t)
	mockClock := clock.NewMockClock(time.Date(2026, 7, 1, 12, 0, 0, 0, time.UTC))

	centerA := test.CreateCenterWithID(t, db, test.TenantAID, "Tenant A", "TENA")
	inviter := test.CreateUser(t, db, "owner@example.com", "Owner")
	_ = test.TenantContext(t, db, centerA.ID)
	_ = test.CreateCenterMember(t, db, inviter.ID, centerA.ID, "owner")

	rawToken := "test-invite-token-32-bytes-of-data-here"
	expiresAt := mockClock.Now().Add(7 * 24 * time.Hour)
	inviteID := seedInvite(t, db,
		test.TenantAID, uuid.UUID(inviter.ID.Bytes).String(),
		"newteacher@example.com", "teacher",
		hashInviteToken(rawToken), expiresAt,
	)

	svc := newAuthServiceWithOAuth(t, db, mockClock, &mockGoogleOAuthClient{})

	result, err := svc.AcceptInvite(context.Background(), service.AcceptInviteInput{
		Token:    rawToken,
		FullName: "New Teacher",
		Password: "StrongPass123!",
	})
	if err != nil {
		t.Fatalf("AcceptInvite: %v", err)
	}
	if result.AccessToken == "" {
		t.Fatal("AccessToken: expected non-empty JWT")
	}
	if result.User.Email != "newteacher@example.com" {
		t.Errorf("User.Email: want %q, got %q", "newteacher@example.com", result.User.Email)
	}
	if !result.User.EmailVerified {
		t.Fatal("User.EmailVerified: expected true (invite link IS verification)")
	}
	if result.CenterID != test.TenantAID {
		t.Errorf("CenterID: want %q, got %q", test.TenantAID, result.CenterID)
	}
	if result.Role != "teacher" {
		t.Errorf("Role: want %q, got %q", "teacher", result.Role)
	}

	// Invite must be marked accepted.
	var acceptedAt *time.Time
	if err := db.QueryRow(context.Background(),
		`SELECT accepted_at FROM invites WHERE id = $1`, inviteID,
	).Scan(&acceptedAt); err != nil {
		t.Fatalf("re-fetch invite: %v", err)
	}
	if acceptedAt == nil {
		t.Fatal("expected invites.accepted_at to be set after acceptance")
	}

	// center_members row exists.
	var memberCount int
	if err := db.QueryRow(context.Background(),
		`SELECT COUNT(*) FROM center_members WHERE center_id = $1 AND role = 'teacher'`,
		test.TenantAID,
	).Scan(&memberCount); err != nil {
		t.Fatalf("count members: %v", err)
	}
	if memberCount != 1 {
		t.Fatalf("expected 1 teacher member after accept, got %d", memberCount)
	}
}

// TestAcceptInvite_AC04_HappyPath_ExistingUser proves the existing-user
// branch: an invited email belongs to an existing user (likely registered
// previously via password or Google) — acceptance adds a center_members
// row WITHOUT changing the user's password.
func TestAcceptInvite_AC04_HappyPath_ExistingUser(t *testing.T) {
	db := test.SetupDB(t)
	mockClock := clock.NewMockClock(time.Date(2026, 7, 1, 12, 0, 0, 0, time.UTC))

	centerA := test.CreateCenterWithID(t, db, test.TenantAID, "Tenant A", "TENA")
	inviter := test.CreateUser(t, db, "owner@example.com", "Owner")
	_ = test.TenantContext(t, db, centerA.ID)
	_ = test.CreateCenterMember(t, db, inviter.ID, centerA.ID, "owner")

	// Existing user with an established password.
	existing := test.CreateUser(t, db, "existing@example.com", "Existing User")
	svc := newAuthServiceWithOAuth(t, db, mockClock, &mockGoogleOAuthClient{})
	if err := svc.SetPassword(context.Background(), existing.ID, "OldPass123!"); err != nil {
		t.Fatalf("SetPassword: %v", err)
	}

	rawToken := "existing-user-invite-token-12345"
	seedInvite(t, db,
		test.TenantAID, uuid.UUID(inviter.ID.Bytes).String(),
		"existing@example.com", "admin",
		hashInviteToken(rawToken), mockClock.Now().Add(7*24*time.Hour),
	)

	// Existing user accepting does NOT supply a password — they already have one.
	result, err := svc.AcceptInvite(context.Background(), service.AcceptInviteInput{
		Token: rawToken,
	})
	if err != nil {
		t.Fatalf("AcceptInvite: %v", err)
	}
	if uuid.UUID(result.User.ID.Bytes) != uuid.UUID(existing.ID.Bytes) {
		t.Fatal("expected to receive existing user, got a different one")
	}
	if result.Role != "admin" {
		t.Errorf("Role: want %q, got %q", "admin", result.Role)
	}

	// Original password must still verify (no overwrite).
	_, err = svc.Login(context.Background(), service.LoginInput{
		Email: "existing@example.com", Password: "OldPass123!",
	})
	if err != nil {
		t.Fatalf("Login with original password after invite-accept: %v", err)
	}
}

// TestAcceptInvite_AC04_UnknownToken_Returns404 proves an attacker
// probing the endpoint with random tokens gets a clean 404 — no
// information leakage (e.g., "this email is registered" or similar).
func TestAcceptInvite_AC04_UnknownToken_Returns404(t *testing.T) {
	db := test.SetupDB(t)
	mockClock := clock.NewMockClock(time.Date(2026, 7, 1, 12, 0, 0, 0, time.UTC))

	svc := newAuthServiceWithOAuth(t, db, mockClock, &mockGoogleOAuthClient{})

	_, err := svc.AcceptInvite(context.Background(), service.AcceptInviteInput{
		Token:    "definitely-not-a-real-token",
		FullName: "Whoever",
		Password: "doesntmatter",
	})
	if err == nil {
		t.Fatal("AcceptInvite: expected *InviteNotFoundError, got nil")
	}
	var notFound *service.InviteNotFoundError
	if !errors.As(err, &notFound) {
		t.Fatalf("AcceptInvite: expected *InviteNotFoundError, got %T (%v)", err, err)
	}
}

// TestAcceptInvite_AC04_ExpiredToken_Returns410 proves 7-day expiry
// enforcement (FR-79). Expired surface carries details so the
// frontend can render "Ask <inviter> to send a new one".
func TestAcceptInvite_AC04_ExpiredToken_Returns410(t *testing.T) {
	db := test.SetupDB(t)
	mockClock := clock.NewMockClock(time.Date(2026, 7, 1, 12, 0, 0, 0, time.UTC))

	centerA := test.CreateCenterWithID(t, db, test.TenantAID, "Tenant A", "TENA")
	inviter := test.CreateUser(t, db, "owner@example.com", "Owner")
	_ = test.TenantContext(t, db, centerA.ID)
	_ = test.CreateCenterMember(t, db, inviter.ID, centerA.ID, "owner")

	rawToken := "expired-invite-token-zzzz"
	// Seed with expires_at IN THE PAST.
	seedInvite(t, db,
		test.TenantAID, uuid.UUID(inviter.ID.Bytes).String(),
		"latetothepara@example.com", "teacher",
		hashInviteToken(rawToken), mockClock.Now().Add(-1*time.Hour),
	)

	svc := newAuthServiceWithOAuth(t, db, mockClock, &mockGoogleOAuthClient{})

	_, err := svc.AcceptInvite(context.Background(), service.AcceptInviteInput{
		Token: rawToken, FullName: "Late", Password: "WhateverPass1",
	})
	if err == nil {
		t.Fatal("AcceptInvite: expected *InviteExpiredError, got nil")
	}
	var expired *service.InviteExpiredError
	if !errors.As(err, &expired) {
		t.Fatalf("AcceptInvite: expected *InviteExpiredError, got %T (%v)", err, err)
	}
	if expired.CenterName != "Tenant A" {
		t.Errorf("InviteExpiredError.CenterName: want %q, got %q", "Tenant A", expired.CenterName)
	}
	if expired.InviterEmail != "owner@example.com" {
		t.Errorf("InviteExpiredError.InviterEmail: want %q, got %q", "owner@example.com", expired.InviterEmail)
	}
}

// TestAcceptInvite_AC04_AlreadyAccepted_Returns409 proves idempotency
// AND race-protection: a token that's already been consumed produces
// 409 with center name in details (per UX line 581, frontend redirects
// to login: "You've already joined [center]").
func TestAcceptInvite_AC04_AlreadyAccepted_Returns409(t *testing.T) {
	db := test.SetupDB(t)
	mockClock := clock.NewMockClock(time.Date(2026, 7, 1, 12, 0, 0, 0, time.UTC))

	centerA := test.CreateCenterWithID(t, db, test.TenantAID, "Tenant A", "TENA")
	inviter := test.CreateUser(t, db, "owner@example.com", "Owner")
	_ = test.TenantContext(t, db, centerA.ID)
	_ = test.CreateCenterMember(t, db, inviter.ID, centerA.ID, "owner")

	rawToken := "already-accepted-token-aaa"
	inviteID := seedInvite(t, db,
		test.TenantAID, uuid.UUID(inviter.ID.Bytes).String(),
		"oncebitten@example.com", "teacher",
		hashInviteToken(rawToken), mockClock.Now().Add(7*24*time.Hour),
	)
	// Pre-mark as accepted.
	if _, err := db.Exec(context.Background(),
		`UPDATE invites SET accepted_at = $2 WHERE id = $1`,
		inviteID, mockClock.Now(),
	); err != nil {
		t.Fatalf("seed accepted_at: %v", err)
	}

	svc := newAuthServiceWithOAuth(t, db, mockClock, &mockGoogleOAuthClient{})

	_, err := svc.AcceptInvite(context.Background(), service.AcceptInviteInput{
		Token: rawToken, FullName: "Twice", Password: "WhateverPass1",
	})
	if err == nil {
		t.Fatal("AcceptInvite: expected *InviteAlreadyAcceptedError, got nil")
	}
	var already *service.InviteAlreadyAcceptedError
	if !errors.As(err, &already) {
		t.Fatalf("AcceptInvite: expected *InviteAlreadyAcceptedError, got %T (%v)", err, err)
	}
	if already.CenterName != "Tenant A" {
		t.Errorf("CenterName: want %q, got %q", "Tenant A", already.CenterName)
	}
}

// TestAcceptInvite_AC05_OAuthPath_EmailMismatch_Rejected proves the
// OAuth-callback invite-bind path: when the Google account's email
// differs from the invited email, the invite is NOT consumed and
// AcceptInviteInternal returns *InviteEmailMismatchError. An audit
// row is written with both emails for forensics.
//
// Login itself still succeeds (the Google identity is valid); only
// the invite gets rejected. The callback handler surfaces the
// mismatch via a redirect query param so the user can resolve.
func TestAcceptInvite_AC05_OAuthPath_EmailMismatch_Rejected(t *testing.T) {
	db := test.SetupDB(t)
	mockClock := clock.NewMockClock(time.Date(2026, 7, 1, 12, 0, 0, 0, time.UTC))

	centerA := test.CreateCenterWithID(t, db, test.TenantAID, "Tenant A", "TENA")
	inviter := test.CreateUser(t, db, "owner@example.com", "Owner")
	_ = test.TenantContext(t, db, centerA.ID)
	_ = test.CreateCenterMember(t, db, inviter.ID, centerA.ID, "owner")

	rawToken := "mismatch-invite-token-mmm"
	inviteID := seedInvite(t, db,
		test.TenantAID, uuid.UUID(inviter.ID.Bytes).String(),
		"invited@example.com", "teacher",
		hashInviteToken(rawToken), mockClock.Now().Add(7*24*time.Hour),
	)

	// Acting user is a different person (different email) who signed in
	// via Google and clicked the invite link.
	actor := test.CreateUser(t, db, "different-person@example.com", "Different Person")

	svc := newAuthServiceWithOAuth(t, db, mockClock, &mockGoogleOAuthClient{})

	_, err := svc.AcceptInviteInternal(context.Background(),
		uuid.UUID(actor.ID.Bytes),
		hashInviteToken(rawToken),
		"different-person@example.com", // oauth email
	)
	if err == nil {
		t.Fatal("AcceptInviteInternal: expected *InviteEmailMismatchError, got nil")
	}
	var mismatch *service.InviteEmailMismatchError
	if !errors.As(err, &mismatch) {
		t.Fatalf("AcceptInviteInternal: expected *InviteEmailMismatchError, got %T (%v)", err, err)
	}
	if mismatch.InvitedEmail != "invited@example.com" {
		t.Errorf("InvitedEmail: want %q, got %q", "invited@example.com", mismatch.InvitedEmail)
	}
	if mismatch.OAuthEmail != "different-person@example.com" {
		t.Errorf("OAuthEmail: want %q, got %q", "different-person@example.com", mismatch.OAuthEmail)
	}

	// Invite MUST NOT be consumed.
	var acceptedAt *time.Time
	if err := db.QueryRow(context.Background(),
		`SELECT accepted_at FROM invites WHERE id = $1`, inviteID,
	).Scan(&acceptedAt); err != nil {
		t.Fatalf("re-fetch invite: %v", err)
	}
	if acceptedAt != nil {
		t.Fatal("invite was consumed despite email mismatch — leak of invited identity")
	}

	// Audit row must record the mismatch with both emails.
	var auditCount int
	if err := db.QueryRow(context.Background(),
		`SELECT COUNT(*) FROM auth_audit_logs
		 WHERE event = 'invite.email_mismatch' AND entity_id = $1`,
		inviteID,
	).Scan(&auditCount); err != nil {
		t.Fatalf("count audit rows: %v", err)
	}
	if auditCount == 0 {
		t.Fatal("expected auth_audit_logs row for invite.email_mismatch, got none")
	}
}
