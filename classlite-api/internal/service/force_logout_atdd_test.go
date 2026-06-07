//go:build atdd_red_phase

// force_logout_atdd_test.go — Story 1.6 ATDD red-phase scaffolds for
// the Owner-initiated force-logout primitive (FR-80).
//
// ACCEPTANCE CRITERIA COVERED
//   AC-1.6-06  ForceLogout deletes every refresh_tokens row for target,
//              writes audit row with actor_user_id = caller, returns sessionsRevoked count
//   AC-1.6-06  Caller role re-validated from DB (Admin JWT but no Owner row → 403)
//   AC-1.6-06  Target with zero sessions → 200 sessionsRevoked=0 (idempotent)
//   AC-1.6-07  Cross-tenant force-logout returns *model.NotFoundError (→ 404, NOT 403)
//   AC-1.6-07  Cross-tenant attempt audited as auth.force_logout_cross_tenant_attempt
//   AC-1.6-07  Target's refresh tokens in OTHER tenant remain intact
//
// RISK MAP
//   R1 (score 9) — cross-tenant data leakage; force-logout MUST 404 not 403
//   R5 (score 6) — refresh-token family revocation works via bulk delete

package service_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/model"
	"github.com/ducdo/classlite-api/internal/service"
	"github.com/ducdo/classlite-api/internal/test"
	"github.com/google/uuid"
)

// seedRefreshTokensForUser inserts N refresh-token rows for a user.
// Used to assert ForceLogout actually deletes them.
func seedRefreshTokensForUser(t *testing.T, db *test.TxDB, userID, familyID string, count int, expiresAt time.Time) {
	t.Helper()
	for i := 0; i < count; i++ {
		if _, err := db.Exec(context.Background(),
			`INSERT INTO refresh_tokens (user_id, token_hash, family_id, expires_at, remember_me)
			 VALUES ($1, $2, $3, $4, false)`,
			userID, "hash-"+familyID+"-"+itoa(i), familyID, expiresAt,
		); err != nil {
			t.Fatalf("seed refresh_token: %v", err)
		}
	}
}

func itoa(i int) string {
	if i == 0 {
		return "0"
	}
	const digits = "0123456789"
	var buf [20]byte
	pos := len(buf)
	neg := i < 0
	if neg {
		i = -i
	}
	for i > 0 {
		pos--
		buf[pos] = digits[i%10]
		i /= 10
	}
	if neg {
		pos--
		buf[pos] = '-'
	}
	return string(buf[pos:])
}

// TestForceLogout_AC06_HappyPath_RevokesAllRefreshTokens proves the
// core contract: an Owner calling ForceLogout on a staff member in
// their own center deletes every refresh_tokens row for that user
// and returns the count.
func TestForceLogout_AC06_HappyPath_RevokesAllRefreshTokens(t *testing.T) {
	db := test.SetupDB(t)
	mockClock := clock.NewMockClock(time.Date(2026, 7, 1, 12, 0, 0, 0, time.UTC))

	centerA := test.CreateCenterWithID(t, db, test.TenantAID, "Tenant A", "TENA")
	owner := test.CreateUser(t, db, "owner@example.com", "Owner")
	target := test.CreateUser(t, db, "teacher@example.com", "Teacher")
	_ = test.TenantContext(t, db, centerA.ID)
	_ = test.CreateCenterMember(t, db, owner.ID, centerA.ID, "owner")
	_ = test.CreateCenterMember(t, db, target.ID, centerA.ID, "teacher")

	// Seed THREE refresh tokens on the target — they should all die.
	seedRefreshTokensForUser(t, db,
		uuid.UUID(target.ID.Bytes).String(),
		"family-aaa", 3, mockClock.Now().Add(7*24*time.Hour),
	)

	svc := newAuthServiceWithOAuth(t, db, mockClock, &mockGoogleOAuthClient{})

	tc := model.TenantContext{
		CenterID: test.TenantAID,
		UserID:   uuid.UUID(owner.ID.Bytes).String(),
		Role:     "owner",
	}
	result, err := svc.ForceLogout(context.Background(), tc, uuid.UUID(target.ID.Bytes))
	if err != nil {
		t.Fatalf("ForceLogout: %v", err)
	}
	if result.SessionsRevoked != 3 {
		t.Errorf("SessionsRevoked: want 3, got %d", result.SessionsRevoked)
	}

	// All target refresh tokens must be gone.
	var remaining int
	if err := db.QueryRow(context.Background(),
		`SELECT COUNT(*) FROM refresh_tokens WHERE user_id = $1`, target.ID,
	).Scan(&remaining); err != nil {
		t.Fatalf("count refresh_tokens after ForceLogout: %v", err)
	}
	if remaining != 0 {
		t.Errorf("expected 0 refresh_tokens for target after ForceLogout, got %d", remaining)
	}

	// Audit row must be written with actor_user_id = caller.
	var actorIDPg uuid.UUID
	if err := db.QueryRow(context.Background(),
		`SELECT actor_user_id FROM auth_audit_logs
		 WHERE event = 'auth.force_logout' AND user_id = $1`,
		target.ID,
	).Scan(&actorIDPg); err != nil {
		t.Fatalf("fetch audit actor: %v", err)
	}
	if actorIDPg != uuid.UUID(owner.ID.Bytes) {
		t.Errorf("audit actor_user_id: want %v, got %v", uuid.UUID(owner.ID.Bytes), actorIDPg)
	}
}

// TestForceLogout_AC06_TargetWithZeroSessions_Idempotent proves the
// Owner clicking "Force logout" on a user who hasn't been seen in a
// while still returns 200 — no `not found` surface (that would
// expose session activity to other Owners).
func TestForceLogout_AC06_TargetWithZeroSessions_Idempotent(t *testing.T) {
	db := test.SetupDB(t)
	mockClock := clock.NewMockClock(time.Date(2026, 7, 1, 12, 0, 0, 0, time.UTC))

	centerA := test.CreateCenterWithID(t, db, test.TenantAID, "Tenant A", "TENA")
	owner := test.CreateUser(t, db, "owner@example.com", "Owner")
	target := test.CreateUser(t, db, "ghost@example.com", "Ghost Teacher")
	_ = test.TenantContext(t, db, centerA.ID)
	_ = test.CreateCenterMember(t, db, owner.ID, centerA.ID, "owner")
	_ = test.CreateCenterMember(t, db, target.ID, centerA.ID, "teacher")
	// NO refresh_tokens seeded.

	svc := newAuthServiceWithOAuth(t, db, mockClock, &mockGoogleOAuthClient{})

	tc := model.TenantContext{
		CenterID: test.TenantAID,
		UserID:   uuid.UUID(owner.ID.Bytes).String(),
		Role:     "owner",
	}
	result, err := svc.ForceLogout(context.Background(), tc, uuid.UUID(target.ID.Bytes))
	if err != nil {
		t.Fatalf("ForceLogout (zero sessions): expected success, got %v", err)
	}
	if result.SessionsRevoked != 0 {
		t.Errorf("SessionsRevoked: want 0, got %d", result.SessionsRevoked)
	}
}

// TestForceLogout_AC06_DemotedCaller_Forbidden proves SEC-1: a JWT
// claiming "owner" but whose DB role row was deleted (or set to
// "teacher") must be rejected at the service layer. The middleware
// chain already runs RequireRole("owner") on the DB-resolved role,
// but a defense-in-depth service check is still required.
func TestForceLogout_AC06_DemotedCaller_Forbidden(t *testing.T) {
	db := test.SetupDB(t)
	mockClock := clock.NewMockClock(time.Date(2026, 7, 1, 12, 0, 0, 0, time.UTC))

	centerA := test.CreateCenterWithID(t, db, test.TenantAID, "Tenant A", "TENA")
	formerOwner := test.CreateUser(t, db, "demoted@example.com", "Demoted Owner")
	target := test.CreateUser(t, db, "victim@example.com", "Victim")
	_ = test.TenantContext(t, db, centerA.ID)
	// Demoted owner now has role = "teacher" in the DB; JWT still says "owner".
	_ = test.CreateCenterMember(t, db, formerOwner.ID, centerA.ID, "teacher")
	_ = test.CreateCenterMember(t, db, target.ID, centerA.ID, "student")

	svc := newAuthServiceWithOAuth(t, db, mockClock, &mockGoogleOAuthClient{})

	tc := model.TenantContext{
		CenterID: test.TenantAID,
		UserID:   uuid.UUID(formerOwner.ID.Bytes).String(),
		Role:     "owner", // stale JWT claim
	}
	_, err := svc.ForceLogout(context.Background(), tc, uuid.UUID(target.ID.Bytes))
	if err == nil {
		t.Fatal("ForceLogout: expected *ForbiddenError on demoted caller, got nil")
	}
	var forbidden *service.ForbiddenError
	if !errors.As(err, &forbidden) {
		t.Fatalf("ForceLogout: expected *ForbiddenError, got %T (%v)", err, err)
	}
}

// TestForceLogout_AC07_CrossTenant_Returns404_NotForbidden is the
// R1 + R6 mitigation: Owner of center A targeting a user who exists
// only in center B must see 404 USER_NOT_FOUND — never 403 — because
// 403 would confirm the target exists. The target's refresh tokens
// in center B MUST be untouched.
//
// Cross-tenant audit row MUST be written so SOC tooling can spot
// scanning attempts, but the HTTP response shape is identical to
// "genuinely non-existent user."
func TestForceLogout_AC07_CrossTenant_Returns404_NotForbidden(t *testing.T) {
	db := test.SetupDB(t)
	mockClock := clock.NewMockClock(time.Date(2026, 7, 1, 12, 0, 0, 0, time.UTC))

	centerA := test.CreateCenterWithID(t, db, test.TenantAID, "Tenant A", "TENA")
	centerB := test.CreateCenterWithID(t, db, test.TenantBID, "Tenant B", "TENB")
	ownerA := test.CreateUser(t, db, "owner-a@example.com", "Owner A")
	userInB := test.CreateUser(t, db, "user-in-b@example.com", "User In B")

	_ = test.TenantContext(t, db, centerA.ID)
	_ = test.CreateCenterMember(t, db, ownerA.ID, centerA.ID, "owner")
	_ = test.TenantContext(t, db, centerB.ID)
	_ = test.CreateCenterMember(t, db, userInB.ID, centerB.ID, "teacher")

	// User B has refresh tokens that MUST survive the cross-tenant call.
	seedRefreshTokensForUser(t, db,
		uuid.UUID(userInB.ID.Bytes).String(),
		"family-b-survives", 2, mockClock.Now().Add(7*24*time.Hour),
	)

	svc := newAuthServiceWithOAuth(t, db, mockClock, &mockGoogleOAuthClient{})

	tc := model.TenantContext{
		CenterID: test.TenantAID, // Owner of A
		UserID:   uuid.UUID(ownerA.ID.Bytes).String(),
		Role:     "owner",
	}
	_, err := svc.ForceLogout(context.Background(), tc, uuid.UUID(userInB.ID.Bytes))
	if err == nil {
		t.Fatal("ForceLogout (cross-tenant): expected *model.NotFoundError, got nil")
	}
	var notFound model.NotFoundError
	if !errors.As(err, &notFound) {
		t.Fatalf("ForceLogout (cross-tenant): expected model.NotFoundError, got %T (%v)", err, err)
	}
	// IMPORTANT: forbidden would leak existence. Assert we did NOT get a forbidden.
	var forbidden *service.ForbiddenError
	if errors.As(err, &forbidden) {
		t.Fatal("ForceLogout (cross-tenant): got *ForbiddenError — that confirms target exists. R1 violation.")
	}

	// User B's refresh tokens MUST still exist.
	var remaining int
	if err := db.QueryRow(context.Background(),
		`SELECT COUNT(*) FROM refresh_tokens WHERE user_id = $1`, userInB.ID,
	).Scan(&remaining); err != nil {
		t.Fatalf("count user-B refresh_tokens: %v", err)
	}
	if remaining != 2 {
		t.Errorf("user-B refresh_tokens after cross-tenant attempt: want 2, got %d", remaining)
	}

	// Cross-tenant audit row must be present.
	var auditCount int
	if err := db.QueryRow(context.Background(),
		`SELECT COUNT(*) FROM auth_audit_logs
		 WHERE event = 'auth.force_logout_cross_tenant_attempt' AND user_id = $1`,
		ownerA.ID,
	).Scan(&auditCount); err != nil {
		t.Fatalf("count cross-tenant audit rows: %v", err)
	}
	if auditCount == 0 {
		t.Fatal("expected auth_audit_logs row for auth.force_logout_cross_tenant_attempt, got none")
	}
}
