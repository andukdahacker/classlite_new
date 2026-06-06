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
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	"golang.org/x/crypto/bcrypt"
)

// TestRefresh_AC02_HappyPath_RotatesTokensAtomically proves a normal
// refresh issues new access + refresh tokens and deletes the old refresh
// row in the same transaction.
func TestRefresh_AC02_HappyPath_RotatesTokensAtomically(t *testing.T) {
	db := test.SetupDB(t)
	mockClock := clock.NewMockClock(time.Date(2026, 6, 5, 12, 0, 0, 0, time.UTC))

	user := test.CreateUser(t, db, "alice@example.com", "Alice Test")
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

// TestRefresh_AC09_LostRaceTreatedAsReuse proves R5 the concurrency
// variant: when two rotation attempts race on the same refresh token,
// PostgreSQL's row-level lock on `DELETE ... RETURNING` guarantees that
// exactly one statement matches the row. The loser sees 0 rows returned,
// finds the winner's freshly-inserted sibling in the same family, and
// triggers reuse detection — revoking the entire family.
//
// WHY THIS TEST IS SINGLE-THREADED: the underlying DB guarantee
// (one-winner-per-row on concurrent DELETE...RETURNING) is provided by
// PostgreSQL itself and does not need re-verification at the service
// layer. What the SERVICE owns is: "given my DELETE returned 0 rows but
// the family has a sibling, treat this as reuse." That invariant is
// fully deterministic and verifiable from a single goroutine.
//
// A true concurrent test using two physical pool connections is deferred
// to the TA pass via a future `test.SetupRawDB(t)` helper. The shared
// savepoint-backed TxDB used here is NOT goroutine-safe (pgx.Tx serializes
// statements per transaction), so a goroutine-based test against TxDB
// would either deadlock or false-positive.
func TestRefresh_AC09_LostRaceTreatedAsReuse(t *testing.T) {
	db := test.SetupDB(t)
	mockClock := clock.NewMockClock(time.Date(2026, 6, 5, 12, 0, 0, 0, time.UTC))

	user := test.CreateUser(t, db, "alice@example.com", "Alice Test")
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

	// Simulate the race winner finishing first: a normal rotation that
	// deletes `oldRefresh` and inserts a sibling in the same family.
	winner, err := svc.RefreshTokens(context.Background(), oldRefresh)
	if err != nil {
		t.Fatalf("winner RefreshTokens: %v", err)
	}

	// The race loser now arrives with `oldRefresh`. Its DELETE matches 0
	// rows (winner already removed it). The service must:
	//   - inspect the family,
	//   - find the winner's freshly-inserted token as a sibling,
	//   - treat this as reuse and revoke the entire family.
	_, err = svc.RefreshTokens(context.Background(), oldRefresh)
	var reuseErr *service.TokenReuseDetectedError
	if !errors.As(err, &reuseErr) {
		t.Fatalf("loser RefreshTokens: expected TokenReuseDetectedError, got %T (%v). "+
			"This means the service did NOT treat 'zero rows from DELETE + sibling in family' as reuse.", err, err)
	}

	// The winner's token MUST also be gone — family-wide revocation per AC8.
	_, err = svc.RefreshTokens(context.Background(), winner.RefreshToken)
	if err == nil {
		t.Fatal("winner's token still valid after family revoke — family revocation broken")
	}

	// DB invariant: zero rows remain for this user's refresh_tokens.
	var count int
	if err := db.QueryRow(context.Background(),
		`SELECT COUNT(*) FROM refresh_tokens WHERE user_id = $1`, user.ID,
	).Scan(&count); err != nil {
		t.Fatalf("count user refresh tokens: %v", err)
	}
	if count != 0 {
		t.Fatalf("expected zero rows after lost-race family revoke, got %d", count)
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

// TestRefresh_AC09_ConcurrentRotation_ExactlyOneWins is the true concurrent
// counterpart to the single-threaded TestRefresh_AC09_LostRaceTreatedAsReuse
// above. It uses a raw *pgxpool.Pool (instead of the transaction-wrapped
// TxDB) so two goroutines can each acquire their own pool connection and
// race their `DELETE ... RETURNING` against the same token row.
//
// Spec contract: exactly ONE of the two RefreshTokens calls returns a fresh
// LoginResult; the other returns *TokenReuseDetectedError. After the race,
// refresh_tokens for the user MUST be empty — the loser's family revocation
// deletes both the original row (already gone — winner deleted it) and the
// winner's freshly-inserted successor.
//
// Cleanup is manual because the pool persists across tests: the test deletes
// every refresh_tokens / login_attempts row keyed on the synthetic user, and
// finally the synthetic user itself.
func TestRefresh_AC09_ConcurrentRotation_ExactlyOneWins(t *testing.T) {
	pool := test.SetupRawPool(t)
	ctx := context.Background()

	// Synthetic email/user — uuid-tagged to keep parallel-running tests
	// from colliding on the unique-email constraint.
	email := "ac09-race-" + uuid.NewString() + "@example.com"
	fullName := "AC9 Race Subject"
	password := "ValidPass123!"

	passwordHash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.MinCost)
	if err != nil {
		t.Fatalf("bcrypt: %v", err)
	}
	var userID pgtype.UUID
	if err := pool.QueryRow(ctx,
		`INSERT INTO users (email, full_name, password_hash, email_verified)
		 VALUES ($1, $2, $3, true)
		 RETURNING id`,
		email, fullName, string(passwordHash),
	).Scan(&userID); err != nil {
		t.Fatalf("insert user: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, `DELETE FROM refresh_tokens WHERE user_id = $1`, userID)
		_, _ = pool.Exec(ctx, `DELETE FROM login_attempts WHERE email_norm = $1`, email)
		_, _ = pool.Exec(ctx, `DELETE FROM auth_audit_logs WHERE user_id = $1`, userID)
		_, _ = pool.Exec(ctx, `DELETE FROM users WHERE id = $1`, userID)
	})

	// Wire the service against the raw pool. Wall clock — concurrent
	// behavior is what's being tested, not time-dependent expiry.
	hasher := service.BcryptHasher{Cost: bcrypt.MinCost}
	sender := &service.MockEmailSender{}
	queue := service.NewEmailRetryQueue(sender, 8)
	auditLogger := service.NewPgAuthAuditLogger(pool)
	svc := service.NewAuthService(pool, hasher, sender, auditLogger, queue, testVerifyURLBase)

	first, err := svc.Login(ctx, service.LoginInput{Email: email, Password: password})
	if err != nil {
		t.Fatalf("Login: %v", err)
	}
	oldRefresh := first.RefreshToken

	// Race start: both goroutines call RefreshTokens with the same raw
	// token. PostgreSQL row-locks the DELETE ... RETURNING so exactly one
	// statement removes the row.
	type outcome struct {
		result *service.LoginResult
		err    error
	}
	var (
		wg       sync.WaitGroup
		outcomes [2]outcome
	)
	wg.Add(2)
	for i := 0; i < 2; i++ {
		i := i
		go func() {
			defer wg.Done()
			r, e := svc.RefreshTokens(ctx, oldRefresh)
			outcomes[i] = outcome{result: r, err: e}
		}()
	}
	wg.Wait()

	winners := 0
	reuseLosers := 0
	for _, o := range outcomes {
		if o.err == nil && o.result != nil {
			winners++
			continue
		}
		var reuse *service.TokenReuseDetectedError
		if errors.As(o.err, &reuse) {
			reuseLosers++
			continue
		}
		// Anything else is unexpected. The race must produce exactly one
		// winner and one reuse-detected loser.
		t.Fatalf("unexpected outcome: result=%v err=%v", o.result, o.err)
	}
	if winners != 1 || reuseLosers != 1 {
		t.Fatalf("AC9 violated: expected exactly 1 winner + 1 reuse-loser, got winners=%d reuseLosers=%d", winners, reuseLosers)
	}

	// Family revocation must leave the user with zero refresh-token rows.
	var remaining int
	if err := pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM refresh_tokens WHERE user_id = $1`, userID,
	).Scan(&remaining); err != nil {
		t.Fatalf("count remaining tokens: %v", err)
	}
	if remaining != 0 {
		t.Fatalf("AC9 violated: refresh_tokens for user should be 0 after race, got %d", remaining)
	}
}
