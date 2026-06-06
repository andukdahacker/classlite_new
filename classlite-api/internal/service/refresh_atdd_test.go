//go:build atdd_red_phase

// refresh_test_atdd.go — Story 1.5 ATDD red-phase scaffolds.
//
// ACCEPTANCE CRITERIA COVERED
//   AC-1.5-02  Refresh rotation: new tokens issued, old token DELETED in same tx
//   AC-1.5-08  Refresh reuse detection: replay revokes the entire family (R5)
//   AC-1.5-09  Concurrent refresh race: exactly one call wins (R5)
//
// IMPL HINTS
//   - refresh_tokens table needs a `family_id uuid NOT NULL` column
//     (new migration). Reuse detection deletes all rows with that
//     family_id; future refresh attempts using rotated-out tokens hit
//     this path and force re-login.
//   - The deletion of the old token + insert of the new must happen in
//     the same transaction as the access token issuance — otherwise a
//     crash between steps leaves the user with no valid token.

package service_test

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/service"
	"github.com/ducdo/classlite-api/internal/test"
)

// TestRefresh_AC02_HappyPath_RotatesTokensAtomically proves a normal
// refresh issues new access + refresh tokens and deletes the old refresh
// row in the same transaction.
func TestRefresh_AC02_HappyPath_RotatesTokensAtomically(t *testing.T) {
	db := test.SetupDB(t)
	mockClock := clock.NewMockClock(time.Date(2026, 6, 5, 12, 0, 0, 0, time.UTC))

	user := test.CreateUser(t, db, "alice@example.com", "Alice Test")
	_ = test.CreateCenterWithID(t, db, test.TenantAID, "Tenant A", "TENA")
	svc := newAuthServiceWithClock(t, db, mockClock)
	if err := svc.SetPassword(context.Background(), user.ID, "ValidPass123!"); err != nil {
		t.Fatalf("SetPassword: %v", err)
	}

	loginResult, err := svc.Login(context.Background(), service.LoginInput{
		Email:    "alice@example.com",
		Password: "ValidPass123!",
	})
	if err != nil {
		t.Fatalf("Login: %v", err)
	}
	oldRefresh := loginResult.RefreshToken

	// Rotate.
	rotated, err := svc.RefreshTokens(context.Background(), oldRefresh)
	if err != nil {
		t.Fatalf("RefreshTokens: %v", err)
	}

	if rotated.AccessToken == loginResult.AccessToken {
		t.Fatal("AccessToken: expected new value after rotation, got same")
	}
	if rotated.RefreshToken == oldRefresh {
		t.Fatal("RefreshToken: expected new value after rotation, got same")
	}

	// Old refresh token row MUST be gone from refresh_tokens.
	var count int
	row := db.QueryRow(context.Background(),
		`SELECT COUNT(*) FROM refresh_tokens WHERE token_hash = $1`,
		hashOf(t, oldRefresh),
	)
	if err := row.Scan(&count); err != nil {
		t.Fatalf("count old refresh: %v", err)
	}
	if count != 0 {
		t.Fatalf("expected old refresh row deleted in rotation tx, found %d rows", count)
	}
}

// TestRefresh_AC08_ReuseDetection_RevokesEntireFamily proves R5: if a
// rotated-out token is reused (replay or theft), every token in the
// same family is revoked. The user is forced to re-login.
func TestRefresh_AC08_ReuseDetection_RevokesEntireFamily(t *testing.T) {
	db := test.SetupDB(t)
	mockClock := clock.NewMockClock(time.Date(2026, 6, 5, 12, 0, 0, 0, time.UTC))

	user := test.CreateUser(t, db, "alice@example.com", "Alice Test")
	_ = test.CreateCenterWithID(t, db, test.TenantAID, "Tenant A", "TENA")
	svc := newAuthServiceWithClock(t, db, mockClock)
	if err := svc.SetPassword(context.Background(), user.ID, "ValidPass123!"); err != nil {
		t.Fatalf("SetPassword: %v", err)
	}

	first, err := svc.Login(context.Background(), service.LoginInput{
		Email: "alice@example.com", Password: "ValidPass123!",
	})
	if err != nil {
		t.Fatalf("Login: %v", err)
	}
	oldRefresh := first.RefreshToken

	// First rotation succeeds.
	second, err := svc.RefreshTokens(context.Background(), oldRefresh)
	if err != nil {
		t.Fatalf("first RefreshTokens: %v", err)
	}

	// Replay the old (rotated-out) refresh token. This must:
	//  - return TokenReuseDetectedError
	//  - revoke the entire family (the current refresh `second.RefreshToken` becomes invalid too)
	_, err = svc.RefreshTokens(context.Background(), oldRefresh)
	var reuseErr *service.TokenReuseDetectedError
	if !errors.As(err, &reuseErr) {
		t.Fatalf("replay: expected TokenReuseDetectedError, got %T (%v)", err, err)
	}

	// Subsequent attempts with the second (now-revoked) refresh token must also fail.
	_, err = svc.RefreshTokens(context.Background(), second.RefreshToken)
	if err == nil {
		t.Fatal("post-reuse: family should be fully revoked, but second refresh succeeded")
	}

	// DB invariant: zero refresh_tokens rows remain for this user.
	var count int
	if err := db.QueryRow(context.Background(),
		`SELECT COUNT(*) FROM refresh_tokens WHERE user_id = $1`, user.ID,
	).Scan(&count); err != nil {
		t.Fatalf("count user refresh tokens: %v", err)
	}
	if count != 0 {
		t.Fatalf("expected family revocation to delete all rows, found %d", count)
	}
}

// TestRefresh_AC09_ConcurrentRotation_ExactlyOneWins proves R5 the
// concurrency variant: two parallel refresh calls with the same old
// token result in exactly ONE success; the loser hits the reuse-detection
// path and revokes the family.
func TestRefresh_AC09_ConcurrentRotation_ExactlyOneWins(t *testing.T) {
	db := test.SetupDB(t)
	mockClock := clock.NewMockClock(time.Date(2026, 6, 5, 12, 0, 0, 0, time.UTC))

	user := test.CreateUser(t, db, "alice@example.com", "Alice Test")
	_ = test.CreateCenterWithID(t, db, test.TenantAID, "Tenant A", "TENA")
	svc := newAuthServiceWithClock(t, db, mockClock)
	if err := svc.SetPassword(context.Background(), user.ID, "ValidPass123!"); err != nil {
		t.Fatalf("SetPassword: %v", err)
	}
	first, err := svc.Login(context.Background(), service.LoginInput{
		Email: "alice@example.com", Password: "ValidPass123!",
	})
	if err != nil {
		t.Fatalf("Login: %v", err)
	}

	const concurrency = 2
	var wg sync.WaitGroup
	results := make([]error, concurrency)
	wg.Add(concurrency)
	for i := 0; i < concurrency; i++ {
		go func(idx int) {
			defer wg.Done()
			_, results[idx] = svc.RefreshTokens(context.Background(), first.RefreshToken)
		}(i)
	}
	wg.Wait()

	// Exactly one nil error, one TokenReuseDetectedError (or equivalent).
	var wins, losses int
	for _, r := range results {
		if r == nil {
			wins++
		} else {
			losses++
		}
	}
	if wins != 1 {
		t.Fatalf("expected exactly 1 winning rotation, got %d wins / %d losses", wins, losses)
	}

	// After the race, the family must be revoked because the loser
	// triggered the reuse-detection path. Zero refresh_tokens for the user.
	var count int
	if err := db.QueryRow(context.Background(),
		`SELECT COUNT(*) FROM refresh_tokens WHERE user_id = $1`, user.ID,
	).Scan(&count); err != nil {
		t.Fatalf("count user refresh tokens: %v", err)
	}
	if count != 0 {
		t.Fatalf("expected zero rows after concurrent-rotation family revoke, got %d", count)
	}
}

// hashOf computes the canonical refresh-token hash the impl will use.
// The exact hashing scheme is decided by impl; this test asserts the
// hash function is exposed as service.HashRefreshToken so the DB query
// above can match without leaking the raw token into the test.
func hashOf(t *testing.T, raw string) string {
	t.Helper()
	return service.HashRefreshToken(raw)
}
