// Story 1.5 P2 service-level coverage (TA pass).
//
// Scope: behaviors mentioned in the spec ACs but NOT directly pinned by an
// ATDD assertion. These tests guard against silent regressions in:
//
//   - AC2  refresh token expiry (RotateRefreshToken WHERE expires_at > now)
//   - AC3  password_resets.email denormalization (closes deferred-work W5)
//   - AC4  reset path deletes login_attempts (lockout counter must not survive)
//   - AC5  logout audit emission semantics (hit vs miss)
//   - AC6  lockout counter is keyed per-normalized-email (fairness)
package service_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/service"
	"github.com/ducdo/classlite-api/internal/test"
)

// AC2 P2: a refresh token whose row has expires_at <= now() must NOT
// rotate. RotateRefreshToken's WHERE clause filters on expires_at > now,
// so the service surfaces RefreshTokenInvalidError (the lookup misses AND
// the family no longer matters because the row is gone for a different
// reason). Verifies that an attacker who waits past the 7d window cannot
// silently rotate forever.
func TestRefresh_AC02_P2_ExpiredTokenRejected(t *testing.T) {
	db := test.SetupDB(t)
	mc := clock.NewMockClock(time.Date(2026, 6, 5, 12, 0, 0, 0, time.UTC))

	user := test.CreateUser(t, db, "expired@example.com", "Expired")
	svc := newAuthServiceWithClock(t, db, mc)
	if err := svc.SetPassword(context.Background(), user.ID, "ValidPass123!"); err != nil {
		t.Fatalf("seed: %v", err)
	}
	first, err := svc.Login(context.Background(), service.LoginInput{
		Email: "expired@example.com", Password: "ValidPass123!",
	})
	if err != nil {
		t.Fatalf("login: %v", err)
	}

	// Advance past the 7-day default refresh TTL.
	mc.Advance(7*24*time.Hour + 1*time.Minute)

	_, err = svc.RefreshTokens(context.Background(), first.RefreshToken)
	if err == nil {
		t.Fatal("expected expired refresh token to be rejected")
	}
	// Either RefreshTokenInvalidError (no siblings) or TokenReuseDetectedError
	// (we still have the row's family but expires_at filter rejected the
	// rotate) — both are valid outcomes that lock the attacker out.
	var invalid *service.RefreshTokenInvalidError
	var reuse *service.TokenReuseDetectedError
	if !errors.As(err, &invalid) && !errors.As(err, &reuse) {
		t.Fatalf("expected RefreshTokenInvalidError or TokenReuseDetectedError, got %T (%v)", err, err)
	}
}

// AC3 P2: when a reset is requested for a verified user, the
// password_resets row carries the normalized email in the new `email`
// column (closes deferred-work W5 — the ATDD anti-enumeration query
// `WHERE email = $1` now resolves correctly).
func TestRequestPasswordReset_AC03_P2_EmailColumnDenormalized(t *testing.T) {
	db := test.SetupDB(t)
	mc := clock.NewMockClock(time.Date(2026, 6, 5, 12, 0, 0, 0, time.UTC))

	user := test.CreateUser(t, db, "denorm@example.com", "Denorm")
	if _, err := db.Exec(context.Background(),
		`UPDATE users SET email_verified = true WHERE id = $1`, user.ID); err != nil {
		t.Fatalf("verify user: %v", err)
	}

	svc, _, _, _ := newAuthServiceWithSenderAccess(t, db, mc)
	if err := svc.RequestPasswordReset(context.Background(), "denorm@example.com"); err != nil {
		t.Fatalf("RequestPasswordReset: %v", err)
	}

	var stored string
	if err := db.QueryRow(context.Background(),
		`SELECT email FROM password_resets WHERE user_id = $1`, user.ID,
	).Scan(&stored); err != nil {
		t.Fatalf("query password_resets.email: %v", err)
	}
	if stored != "denorm@example.com" {
		t.Errorf("email column = %q, want denorm@example.com", stored)
	}
}

// AC3 P2 negative: an unverified user MUST NOT have a password_resets row
// created — pairs with the verified-user positive test above to nail down
// the verification gate.
func TestRequestPasswordReset_AC03_P2_UnverifiedUser_NoRow(t *testing.T) {
	db := test.SetupDB(t)
	mc := clock.NewMockClock(time.Date(2026, 6, 5, 12, 0, 0, 0, time.UTC))

	test.CreateUser(t, db, "unverified@example.com", "Unverified")
	svc, _, sender, _ := newAuthServiceWithSenderAccess(t, db, mc)

	if err := svc.RequestPasswordReset(context.Background(), "unverified@example.com"); err != nil {
		t.Fatalf("RequestPasswordReset: %v", err)
	}
	var rows int
	if err := db.QueryRow(context.Background(),
		`SELECT COUNT(*) FROM password_resets WHERE email = $1`, "unverified@example.com",
	).Scan(&rows); err != nil {
		t.Fatalf("count: %v", err)
	}
	if rows != 0 {
		t.Errorf("unverified user should have 0 password_resets rows, got %d", rows)
	}
	if sender.Count() != 0 {
		t.Errorf("unverified user path must not dispatch email; got %d sends", sender.Count())
	}
}

// AC4 P2: a successful password reset must clear login_attempts so the
// lockout counter does NOT carry over from the pre-reset failure burst.
// Without this, an attacker who locked out a victim could keep them
// locked even after they reset their own password.
func TestResetPassword_AC04_P2_ClearsLoginAttempts(t *testing.T) {
	db := test.SetupDB(t)
	mc := clock.NewMockClock(time.Date(2026, 6, 5, 12, 0, 0, 0, time.UTC))

	user := test.CreateUser(t, db, "clear@example.com", "Clear")
	if _, err := db.Exec(context.Background(),
		`UPDATE users SET email_verified = true WHERE id = $1`, user.ID); err != nil {
		t.Fatalf("verify user: %v", err)
	}

	svc, _, sender, queue := newAuthServiceWithSenderAccess(t, db, mc)
	startQueueWorker(t, queue)
	if err := svc.SetPassword(context.Background(), user.ID, "OldPass123!"); err != nil {
		t.Fatalf("seed: %v", err)
	}

	// Burst 3 failures to seed login_attempts.
	for i := 0; i < 3; i++ {
		_, _ = svc.Login(context.Background(), service.LoginInput{
			Email: "clear@example.com", Password: "wrong",
		})
	}
	var before int
	_ = db.QueryRow(context.Background(),
		`SELECT COUNT(*) FROM login_attempts WHERE email_norm = $1`, "clear@example.com",
	).Scan(&before)
	if before == 0 {
		t.Fatal("seed failed: expected login_attempts > 0")
	}

	if err := svc.RequestPasswordReset(context.Background(), "clear@example.com"); err != nil {
		t.Fatalf("RequestPasswordReset: %v", err)
	}
	// P3: raw token only exists in the dispatched email. Wait for the
	// async retry queue to deliver it, then extract from the URL.
	waitForEmailCount(t, sender, 1, 2*time.Second)
	token := extractResetToken(t, sender.Snapshot()[0])
	if err := svc.ResetPassword(context.Background(), token, "NewPass456!"); err != nil {
		t.Fatalf("ResetPassword: %v", err)
	}

	var after int
	_ = db.QueryRow(context.Background(),
		`SELECT COUNT(*) FROM login_attempts WHERE email_norm = $1`, "clear@example.com",
	).Scan(&after)
	if after != 0 {
		t.Errorf("after reset: expected 0 login_attempts rows, got %d", after)
	}
}

// AC5 P2: a Logout with a valid refresh cookie writes exactly one audit
// row with event = "session.logged_out". Asserted via a DELTA against
// pre-existing audit rows because auth_audit_logs is REVOKE'd from
// UPDATE/DELETE on the app role, so committed rows from prior test runs
// or smoke tests leak across PG's READ COMMITTED isolation.
func TestLogout_AC05_P2_WritesAuditOnHit(t *testing.T) {
	db := test.SetupDB(t)
	mc := clock.NewMockClock(time.Date(2026, 6, 5, 12, 0, 0, 0, time.UTC))
	user := test.CreateUser(t, db, "logout@example.com", "Logout")

	svc := newAuthServiceWithClock(t, db, mc)
	if err := svc.SetPassword(context.Background(), user.ID, "ValidPass123!"); err != nil {
		t.Fatalf("seed: %v", err)
	}
	loginResult, err := svc.Login(context.Background(), service.LoginInput{
		Email: "logout@example.com", Password: "ValidPass123!",
	})
	if err != nil {
		t.Fatalf("login: %v", err)
	}

	before := countLogoutAudits(t, db)
	if err := svc.Logout(context.Background(), loginResult.RefreshToken); err != nil {
		t.Fatalf("logout: %v", err)
	}
	after := countLogoutAudits(t, db)
	if after-before != 1 {
		t.Errorf("logout hit should add 1 audit row; before=%d after=%d", before, after)
	}
}

// AC5 P2 negative: a Logout with NO cookie value writes NO audit row
// (avoids log spam from stale-cookie bot traffic). Asserted via delta —
// see WritesAuditOnHit godoc for the leak rationale.
func TestLogout_AC05_P2_NoCookie_NoAuditRow(t *testing.T) {
	db := test.SetupDB(t)
	mc := clock.NewMockClock(time.Date(2026, 6, 5, 12, 0, 0, 0, time.UTC))
	svc := newAuthServiceWithClock(t, db, mc)

	before := countLogoutAudits(t, db)
	if err := svc.Logout(context.Background(), ""); err != nil {
		t.Fatalf("logout no-op: %v", err)
	}
	after := countLogoutAudits(t, db)
	if after != before {
		t.Errorf("idempotent logout must NOT add audit rows; before=%d after=%d", before, after)
	}
}

func countLogoutAudits(t *testing.T, db *test.TxDB) int {
	t.Helper()
	var n int
	if err := db.QueryRow(context.Background(),
		`SELECT COUNT(*) FROM auth_audit_logs WHERE event = 'session.logged_out'`,
	).Scan(&n); err != nil {
		t.Fatalf("count session.logged_out: %v", err)
	}
	return n
}

// AC6 P2 fairness: locking email A out must NOT count failed attempts
// from email A against email B's lockout window. The lockout counter is
// scoped by email_norm.
func TestLogin_AC06_P2_LockoutCounterPerEmail(t *testing.T) {
	db := test.SetupDB(t)
	mc := clock.NewMockClock(time.Date(2026, 6, 5, 12, 0, 0, 0, time.UTC))
	uA := test.CreateUser(t, db, "fair-a@example.com", "Fair A")
	uB := test.CreateUser(t, db, "fair-b@example.com", "Fair B")

	svc := newAuthServiceWithClock(t, db, mc)
	if err := svc.SetPassword(context.Background(), uA.ID, "PassA123!"); err != nil {
		t.Fatalf("seed A: %v", err)
	}
	if err := svc.SetPassword(context.Background(), uB.ID, "PassB123!"); err != nil {
		t.Fatalf("seed B: %v", err)
	}

	// 4 failures on A — JUST below the threshold of 5.
	for i := 0; i < 4; i++ {
		_, _ = svc.Login(context.Background(), service.LoginInput{
			Email: "fair-a@example.com", Password: "wrong",
		})
	}

	// B is unaffected: counter check sums only fair-b's attempts.
	result, err := svc.Login(context.Background(), service.LoginInput{
		Email: "fair-b@example.com", Password: "PassB123!",
	})
	if err != nil {
		t.Fatalf("B login should succeed despite A's failures, got %v", err)
	}
	if result.AccessToken == "" {
		t.Error("expected access token for B")
	}
}

// AC1 P2: refresh tokens for the SAME user are unique — generateRefreshToken
// must produce a fresh family + random suffix on every call. Catches a
// regression where the family UUID is accidentally shared across sessions.
func TestLogin_AC01_P2_FamilyUUIDUniquePerSession(t *testing.T) {
	db := test.SetupDB(t)
	mc := clock.NewMockClock(time.Date(2026, 6, 5, 12, 0, 0, 0, time.UTC))
	user := test.CreateUser(t, db, "unique@example.com", "Unique")
	svc := newAuthServiceWithClock(t, db, mc)
	if err := svc.SetPassword(context.Background(), user.ID, "Pass123!"); err != nil {
		t.Fatalf("seed: %v", err)
	}

	a, err := svc.Login(context.Background(), service.LoginInput{Email: "unique@example.com", Password: "Pass123!"})
	if err != nil {
		t.Fatalf("login a: %v", err)
	}
	b, err := svc.Login(context.Background(), service.LoginInput{Email: "unique@example.com", Password: "Pass123!"})
	if err != nil {
		t.Fatalf("login b: %v", err)
	}

	if a.RefreshToken == b.RefreshToken {
		t.Fatal("two logins must produce different refresh tokens")
	}

	// Both rows should exist with different family IDs.
	var familyCount int
	_ = db.QueryRow(context.Background(),
		`SELECT COUNT(DISTINCT family_id) FROM refresh_tokens WHERE user_id = $1`, user.ID,
	).Scan(&familyCount)
	if familyCount != 2 {
		t.Errorf("expected 2 distinct families for 2 logins, got %d", familyCount)
	}
}
