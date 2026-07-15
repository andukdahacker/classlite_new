// Story 2.1 test helpers.
//
// The ATDD specimens in internal/handler/*_atdd_test.go reference a
// green-phase harness that mounts the four onboarding + center routes and
// pre-signs an access token for a specified user. This file provides that
// harness plus the fixture verbs the ATDD tests call out: MarkUserEmailVerified,
// SeedOnboardingProgress, SetUserPersona, LatestAuditLogForUser,
// VerifyAccessToken, and their raw-pool siblings.

package test

import (
	"context"
	"hash/fnv"
	"net/http"
	"net/http/httptest"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/handler"
	"github.com/ducdo/classlite-api/internal/middleware"
	"github.com/ducdo/classlite-api/internal/service"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/time/rate"
)

// TestJWTSecret is the fixed HS256 key every Story 2.1 test uses. Must be
// >= 32 bytes so hmacJWTSigner.Sign happily generates a token.
const TestJWTSecret = "test-signing-key-at-least-256-bits-long-12345678"

// RealClock is a re-export of clock.RealClock so ATDD tests don't need to
// import the internal clock package themselves.
type RealClock = clock.RealClock

// MockAccessTokenIssuer is the stub accessTokenIssuer used by ATDD tests
// that inject their own AuditLogger (see brokenAuditLogger). It returns a
// deterministic token so callers can assert on it without a real signer.
type MockAccessTokenIssuer struct{}

// MintAccessToken satisfies the accessTokenIssuer interface (private to
// service package) by matching its method set.
func (MockAccessTokenIssuer) MintAccessToken(
	_ context.Context, _ uuid.UUID, _ *uuid.UUID, _ string,
) (string, time.Time, error) {
	return "mock-access-token", time.Now().Add(15 * time.Minute), nil
}

// jwtSigner is the shared signer bound to TestJWTSecret. Callers use it via
// SignAccessTokenForUser + VerifyAccessToken.
func jwtSigner() service.JWTSigner {
	return service.NewJWTSignerWithClock([]byte(TestJWTSecret), clock.RealClock{})
}

// SignAccessTokenForUser mints a Bearer token whose UserID claim points at
// the given user. CenterID + Role are left empty (pre-center state).
func SignAccessTokenForUser(t *testing.T, userID pgtype.UUID) string {
	t.Helper()
	tok, err := jwtSigner().SignAccess(service.AccessClaims{UserID: UUIDString(userID)}, 900)
	if err != nil {
		t.Fatalf("sign access token: %v", err)
	}
	return tok
}

// VerifyAccessToken returns the claims embedded in the token. The ATDD
// test asserts CenterID + Role claims round-trip after CreateCenter.
func VerifyAccessToken(t *testing.T, token string) *service.AccessClaims {
	t.Helper()
	claims, err := jwtSigner().VerifyAccess(token)
	if err != nil {
		t.Fatalf("verify access token: %v", err)
	}
	return claims
}

// storyDB is the union of TxDB + pool required by the harness. Both
// satisfy service.AuthDB.
type storyDB = service.AuthDB

// newStorySrv wires the four Story 2.1 routes against db + returns an
// http.Handler with the middleware chain mounted. Callers can then attach
// a JWT via req.Header.Set. Wall clock — the tests don't exercise time.
func newStorySrv(t *testing.T, db storyDB) http.Handler {
	t.Helper()
	auditSvc := service.NewAuditService(db)
	onboardingSvc := service.NewOnboardingService(db)
	authSvc := service.NewAuthService(db, service.BcryptHasher{Cost: 4},
		&service.MockEmailSender{}, service.NewPgAuthAuditLogger(db),
		service.NewEmailRetryQueue(&service.MockEmailSender{}, 4),
		"http://localhost/verify")
	authSvc.SetJWTSigner(jwtSigner())
	centerSvc := service.NewCenterService(db, auditSvc, authSvc, clock.RealClock{})

	onboardingHandler := handler.NewOnboardingHandler(onboardingSvc, clock.RealClock{})
	centerHandler := handler.NewCenterHandler(centerSvc, clock.RealClock{})

	onboardingLimit := middleware.RateLimitByKey(
		"onboarding-test-"+uuid.NewString(), // unique so limiter state is per-test
		rate.Every(60*time.Second), 20, middleware.IPKeyFn,
	)
	requireVerified := middleware.RequireVerifiedEmail()
	extractTenant := middleware.ExtractTenant(db, jwtSigner())

	chain := func(h middleware.HandlerWithError) http.Handler {
		return extractTenant(
			requireVerified(
				onboardingLimit(http.HandlerFunc(middleware.ErrorMapper(h))),
			),
		)
	}

	mux := http.NewServeMux()
	mux.Handle("POST /api/onboarding/persona", chain(onboardingHandler.SetPersona))
	mux.Handle("GET /api/onboarding/progress", chain(onboardingHandler.GetProgress))
	mux.Handle("PUT /api/onboarding/progress", chain(onboardingHandler.PutProgress))
	mux.Handle("POST /api/centers", chain(centerHandler.Create))
	return mux
}

// authInjectingHandler wraps an underlying handler and attaches a Bearer
// token to every incoming request.
type authInjectingHandler struct {
	next  http.Handler
	token string
}

func (h *authInjectingHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	r.Header.Set("Authorization", "Bearer "+h.token)
	h.next.ServeHTTP(w, r)
}

// NewTestServerForUser returns an http.Handler that automatically attaches
// an access token for userID to every request. Used by the ATDD specimens
// that shouldn't have to sign their own tokens for each call.
func NewTestServerForUser(t *testing.T, db storyDB, userID pgtype.UUID) http.Handler {
	t.Helper()
	tok := SignAccessTokenForUser(t, userID)
	return &authInjectingHandler{next: newStorySrv(t, db), token: tok}
}

// NewTestServerUnauthenticated returns an http.Handler that does NOT
// attach any Authorization header — the ATDD tests use it to prove 401.
func NewTestServerUnauthenticated(t *testing.T, db storyDB) http.Handler {
	t.Helper()
	return newStorySrv(t, db)
}

// NewTestServerForUserOnPool is the raw-pool variant used by the concurrent
// double-post ATDD test. Same shape as NewTestServerForUser.
func NewTestServerForUserOnPool(t *testing.T, pool *pgxpool.Pool, userID pgtype.UUID) http.Handler {
	t.Helper()
	tok := SignAccessTokenForUser(t, userID)
	return &authInjectingHandler{next: newStorySrv(t, pool), token: tok}
}

// -----------------------------------------------------------------------------
// Fixture verbs
// -----------------------------------------------------------------------------

// MarkUserEmailVerified flips users.email_verified to true for the given
// user. Used by every ATDD specimen whose caller must survive the
// RequireVerifiedEmail middleware.
func MarkUserEmailVerified(t *testing.T, db *TxDB, userID pgtype.UUID) {
	t.Helper()
	if _, err := db.Exec(context.Background(),
		`UPDATE users SET email_verified = true WHERE id = $1`, userID,
	); err != nil {
		t.Fatalf("mark user verified: %v", err)
	}
}

// MarkUserEmailVerifiedOnPool is the raw-pool variant.
func MarkUserEmailVerifiedOnPool(t *testing.T, pool *pgxpool.Pool, userID pgtype.UUID) {
	t.Helper()
	if _, err := pool.Exec(context.Background(),
		`UPDATE users SET email_verified = true WHERE id = $1`, userID,
	); err != nil {
		t.Fatalf("mark user verified: %v", err)
	}
}

// SeedOnboardingProgress inserts a row into onboarding_progress. Payload
// is the raw JSONB string.
func SeedOnboardingProgress(t *testing.T, db *TxDB, userID pgtype.UUID, step, payload string) {
	t.Helper()
	if _, err := db.Exec(context.Background(),
		`INSERT INTO onboarding_progress (user_id, current_step, payload)
		 VALUES ($1, $2, $3::jsonb)
		 ON CONFLICT (user_id) DO UPDATE
		 SET current_step = EXCLUDED.current_step, payload = EXCLUDED.payload`,
		userID, step, payload,
	); err != nil {
		t.Fatalf("seed onboarding progress: %v", err)
	}
}

// SetUserPersona writes users.persona for the given user.
func SetUserPersona(t *testing.T, db *TxDB, userID pgtype.UUID, persona string) {
	t.Helper()
	if _, err := db.Exec(context.Background(),
		`UPDATE users SET persona = $2 WHERE id = $1`, userID, persona,
	); err != nil {
		t.Fatalf("set user persona: %v", err)
	}
}

// CreateUserOnPool inserts a user against the raw pool AND registers a
// t.Cleanup that purges it plus any centers it created. This is the
// difference between "test leaves residue if it fails between insert and
// t.Cleanup registration in the caller" and "test never leaks a user."
//
// Go's default per-package test parallelism runs multiple test binaries
// concurrently against the same shared DB. Tests that hardcode a stable
// email (e.g. "owner@example.com" in a spawn-flow request payload where
// the service resolves the email back to the fixture user) used to
// collide on the `idx_users_email` unique index when two packages hit
// this helper at the same moment. We serialize concurrent calls for the
// same email via a session-scoped PostgreSQL advisory lock, held for the
// test lifetime. Callers still see the original email in User.Email and
// can pass it into downstream request bodies verbatim.
func CreateUserOnPool(t *testing.T, pool *pgxpool.Pool, email, name string) User {
	t.Helper()

	// Acquire a dedicated connection so the advisory lock survives across
	// the test — pool.Exec() would return the connection to the pool and
	// release the lock immediately.
	conn, err := pool.Acquire(context.Background())
	if err != nil {
		t.Fatalf("acquire conn for advisory lock: %v", err)
	}
	lockKey := advisoryLockKeyForEmail(email)
	if _, err := conn.Exec(
		context.Background(),
		`SELECT pg_advisory_lock($1)`,
		lockKey,
	); err != nil {
		conn.Release()
		t.Fatalf("pg_advisory_lock(%d) for %q: %v", lockKey, email, err)
	}

	var id pgtype.UUID
	if err := pool.QueryRow(context.Background(),
		`INSERT INTO users (email, full_name, email_verified) VALUES ($1, $2, false) RETURNING id`,
		email, name,
	).Scan(&id); err != nil {
		_, _ = conn.Exec(context.Background(), `SELECT pg_advisory_unlock($1)`, lockKey)
		conn.Release()
		t.Fatalf("create user on pool: %v", err)
	}

	t.Cleanup(func() {
		// Purge FIRST (row must be gone before we release the lock,
		// otherwise a waiting caller sees the row and fails on the unique
		// index), THEN release the lock, THEN return the connection.
		PurgeUserAndOwnedCenters(t, pool, id)
		_, _ = conn.Exec(context.Background(), `SELECT pg_advisory_unlock($1)`, lockKey)
		conn.Release()
	})
	return User{ID: id, Email: email, FullName: name}
}

// advisoryLockKeyForEmail hashes an email into a stable int64 for use as
// a PostgreSQL advisory-lock key. fnv-1a is fast, deterministic across
// processes, and — crucially — DOESN'T need to be cryptographic. Same
// email → same key → concurrent CreateUserOnPool calls serialize.
func advisoryLockKeyForEmail(email string) int64 {
	h := fnv.New64a()
	_, _ = h.Write([]byte("classlite-test-createuseronpool:"))
	_, _ = h.Write([]byte(email))
	return int64(h.Sum64()) // wraps into negatives — pg accepts full bigint
}

// User is a stripped user shape returned by CreateUserOnPool so callers
// can pass .ID into subsequent helpers without lugging around the full
// generated.User struct.
type User struct {
	ID       pgtype.UUID
	Email    string
	FullName string
}

// prePurgeHooks is a registry populated by init() in sibling
// story_2_X_helpers.go files so those stories can chain their owned-resource
// cleanup BEFORE this cascade drops centers. Registered hooks run under the
// same superuser pool as the shared cleanup.
var prePurgeHooks []func(sp *pgxpool.Pool, userID pgtype.UUID)

// registerPre2_2Purge lets story_2_2_helpers.go (init) chain its resource
// cleanup into PurgeUserAndOwnedCenters. Kept generic so future stories can
// add their own registry function (e.g. registerPre3_1Purge) without
// touching this file.
func registerPre2_2Purge(fn func(sp *pgxpool.Pool, userID pgtype.UUID)) {
	prePurgeHooks = append(prePurgeHooks, fn)
}

// PurgeUserAndOwnedCenters is the raw-pool cleanup counterpart to
// t.Cleanup in the concurrent tests. It uses a superuser pool (see
// superuserPool below) so it bypasses RLS on center_members + audit_logs
// during cleanup — without that bypass the SELECT returns 0 rows and the
// residue silently leaks between test runs.
//
// Cleanup errors are logged via t.Logf rather than silently swallowed: a
// FK constraint failure or table-not-found here means the test fixture
// left residue that will bleed into subsequent runs, and the previous
// silent-discard pattern hid exactly the failure mode this helper claims
// to prevent.
func PurgeUserAndOwnedCenters(t *testing.T, _ *pgxpool.Pool, userID pgtype.UUID) {
	t.Helper()
	ctx := context.Background()
	sp := superuserPool(t)

	// Story 2.2 (and beyond) pre-purge hooks run first so class_templates,
	// classes, invites, template_sessions get cleared before the shared
	// center delete would otherwise trip on the classes.teacher_id FK.
	for _, hook := range prePurgeHooks {
		hook(sp, userID)
	}

	rows, err := sp.Query(ctx, `SELECT center_id FROM center_members WHERE user_id = $1`, userID)
	if err != nil {
		t.Logf("purge: query memberships for user %s: %v", UUIDString(userID), err)
	}
	var centerIDs []pgtype.UUID
	if err == nil {
		for rows.Next() {
			var cid pgtype.UUID
			if scanErr := rows.Scan(&cid); scanErr == nil {
				centerIDs = append(centerIDs, cid)
			}
		}
		rows.Close()
	}

	if _, err := sp.Exec(ctx, `DELETE FROM audit_logs WHERE user_id = $1`, userID); err != nil {
		t.Logf("purge: delete audit_logs for user %s: %v", UUIDString(userID), err)
	}
	// auth_audit_logs FKs user_id — must clear before delete users. Story
	// 2.2 was the first to exercise the raw-pool + real-auth flow that
	// exposed this residue path.
	if _, err := sp.Exec(ctx, `DELETE FROM auth_audit_logs WHERE user_id = $1`, userID); err != nil {
		t.Logf("purge: delete auth_audit_logs for user %s: %v", UUIDString(userID), err)
	}
	if _, err := sp.Exec(ctx, `DELETE FROM email_verifications WHERE user_id = $1`, userID); err != nil {
		t.Logf("purge: delete email_verifications for user %s: %v", UUIDString(userID), err)
	}
	if _, err := sp.Exec(ctx, `DELETE FROM refresh_tokens WHERE user_id = $1`, userID); err != nil {
		t.Logf("purge: delete refresh_tokens for user %s: %v", UUIDString(userID), err)
	}
	if _, err := sp.Exec(ctx, `DELETE FROM password_resets WHERE user_id = $1`, userID); err != nil {
		t.Logf("purge: delete password_resets for user %s: %v", UUIDString(userID), err)
	}
	if _, err := sp.Exec(ctx, `DELETE FROM center_members WHERE user_id = $1`, userID); err != nil {
		t.Logf("purge: delete center_members for user %s: %v", UUIDString(userID), err)
	}
	for _, cid := range centerIDs {
		if _, err := sp.Exec(ctx, `DELETE FROM centers WHERE id = $1`, cid); err != nil {
			t.Logf("purge: delete center %s: %v", UUIDString(cid), err)
		}
	}
	if _, err := sp.Exec(ctx, `DELETE FROM onboarding_progress WHERE user_id = $1`, userID); err != nil {
		t.Logf("purge: delete onboarding_progress for user %s: %v", UUIDString(userID), err)
	}
	if _, err := sp.Exec(ctx, `DELETE FROM users WHERE id = $1`, userID); err != nil {
		t.Logf("purge: delete users row %s: %v", UUIDString(userID), err)
	}
}

// superuserPool returns a shared *pgxpool.Pool connected as the classlite
// superuser (bypasses RLS). Used only by cleanup helpers — the tests
// themselves ALWAYS run against the classlite_app pool so RLS coverage
// stays real.
var (
	superuserPoolInstance *pgxpool.Pool
	superuserPoolOnce     sync.Once
)

func superuserPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	superuserPoolOnce.Do(func() {
		url := os.Getenv("MIGRATION_DATABASE_URL")
		if url == "" {
			// Standard local-dev superuser URL. Mirrors docker-compose.yml.
			url = "postgres://classlite:classlite_dev_password@localhost:5432/classlite_dev?sslmode=disable"
		}
		var err error
		superuserPoolInstance, err = pgxpool.New(context.Background(), url)
		if err != nil {
			t.Fatalf("connect superuser pool: %v", err)
		}
	})
	return superuserPoolInstance
}

// CountRows executes SELECT count(*) via arbitrary SQL and returns the
// integer count. Used by the atomicity assertion in Task 11.2.
func CountRows(t *testing.T, pool *pgxpool.Pool, sql string, args ...any) int {
	t.Helper()
	var n int
	if err := pool.QueryRow(context.Background(), sql, args...).Scan(&n); err != nil {
		t.Fatalf("count rows (%s): %v", sql, err)
	}
	return n
}

// AuditRow is a stripped audit_logs row surface used by
// LatestAuditLogForUser callers. EntityType + EntityID are surfaced so AC6's
// audit-shape test can assert entity_type='center' and entity_id=<centerID>
// (spec pins the full row shape; without these columns a future regression
// swapping either field wouldn't be caught).
type AuditRow struct {
	Action     string
	EntityType string
	EntityID   pgtype.UUID
	Changes    []byte
}

// LatestAuditLogForUser returns the most-recent audit_logs row for the
// given user. Used by AC6's audit-shape assertion.
func LatestAuditLogForUser(t *testing.T, db *TxDB, userID pgtype.UUID) AuditRow {
	t.Helper()
	var row AuditRow
	err := db.QueryRow(context.Background(),
		`SELECT action, entity_type, entity_id, changes FROM audit_logs WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`,
		userID,
	).Scan(&row.Action, &row.EntityType, &row.EntityID, &row.Changes)
	if err != nil {
		t.Fatalf("latest audit log: %v", err)
	}
	return row
}

// Sanity assertion at compile time: httptest is what the ATDD tests use to
// wrap our returned http.Handler.
var _ = httptest.NewRecorder

// pgx import kept live so ATDD tests don't need to add it explicitly when
// referencing pgx.Tx via the AuditLogger interface.
var _ pgx.Tx

// -----------------------------------------------------------------------------
// Fixture helpers (added by /bmad-tea TA 2-1 — F1, F2).
// Rolls up two RV LOW findings into reusable seams before propagating them
// across the suite.
// -----------------------------------------------------------------------------

// MustParseUUID parses a canonical UUID string and t.Fatalf's on failure.
// Replaces the `uid, _ := uuid.Parse(...)` silent-discard pattern that RV
// flagged: on parse failure, the discard yields uuid.Nil and downstream tests
// fail with confusing "P1 VIOLATION" or "zero UUID" errors instead of the
// underlying malformed-input signal.
func MustParseUUID(t *testing.T, s string) uuid.UUID {
	t.Helper()
	u, err := uuid.Parse(s)
	if err != nil {
		t.Fatalf("MustParseUUID(%q): %v", s, err)
	}
	return u
}

// UniqueEmail returns a parallel-safe email for use in raw-pool tests (or
// anywhere hardcoded emails would collide across concurrent runs). The
// centers_slug_collision_race_test's per-run nonce pattern is generalized
// here so future raw-pool authors have one canonical helper to reach for.
//
// Format: "<prefix>-<uuid>@example.com". Prefix documents intent
// (e.g. "slug-race-a"); the full UUID guarantees uniqueness within the DB.
func UniqueEmail(prefix string) string {
	if prefix == "" {
		prefix = "unique"
	}
	return prefix + "-" + uuid.NewString() + "@example.com"
}

// SuperuserPool exposes the cleanup superuser pool for RLS-bypassing
// visibility checks in tests that assert on state across the transaction
// boundary. Rare use — most tests should stick to the classlite_app pool
// so RLS coverage stays real. Justified when a test needs to verify that
// data DID survive a Commit against a table with RLS (e.g. center_members)
// where the classlite_app connection would see 0 rows without SET LOCAL
// app.current_tenant_id. Used by INT-2-4 broken-token-issuer scenario.
func SuperuserPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	return superuserPool(t)
}
