// Story 2.2 test helpers.
//
// The ATDD specimens in internal/handler/template_handler_atdd_test.go and
// internal/service/class_atdd_test.go reference a green-phase harness that
// mounts the three template/spawn routes and pre-signs an access token for
// a specified user. This file provides that harness plus the fixture verbs
// the ATDD tests call out.
//
// Cleanup: PurgeUserAndOwnedCenters (from story_2_1_helpers.go) is extended
// via ExtendPurgeCascadeFor2_2 to purge class_templates + template_sessions
// + classes + invites for the owned centers before the CASCADE from centers
// takes the rest.

package test

import (
	"context"
	stderrors "errors"
	"log/slog"
	"net/http"
	"testing"
	"time"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/handler"
	"github.com/ducdo/classlite-api/internal/middleware"
	"github.com/ducdo/classlite-api/internal/service"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/time/rate"
)

var stderrorsAs = stderrors.As

// newStorySrv2_2 mounts the Story 2.2 template + spawn routes. Uses the
// same chain shape as Story 2.1's newStorySrv but layers RequireCenterContext
// between requireVerified and the handler (AC8). onboardingLimit sits BEFORE
// requireVerified per Winston-W-B3.
func newStorySrv2_2(t *testing.T, db storyDB) http.Handler {
	t.Helper()
	auditSvc := service.NewAuditService(db)
	// R2-P11 — the previous authSvc + SetJWTSigner lines were dead code:
	// this harness pre-signs the Bearer via signAccessTokenWithCenter and
	// injects it through authInjectingHandler, so the AuthService itself was
	// never wired into the mux. Removed to reduce test surface and misleading
	// setup noise.

	templateSvc := service.NewTemplateService(db, auditSvc, clock.RealClock{})
	inviter := service.NewEmailRetryQueue(&service.MockEmailSender{}, 8)
	classSvc := service.NewClassService(db, auditSvc, inviter, clock.RealClock{})
	templateHandler := handler.NewTemplateHandler(templateSvc, classSvc, clock.RealClock{})

	onboardingLimit := middleware.RateLimitByKey(
		"templates-test-"+uuid.NewString(),
		rate.Every(60*time.Second), 20, middleware.IPKeyFn,
	)
	requireVerified := middleware.RequireVerifiedEmail()
	requireCenter := middleware.RequireCenterContext()
	extractTenant := middleware.ExtractTenant(db, jwtSigner())

	chain := func(h middleware.HandlerWithError) http.Handler {
		return extractTenant(
			onboardingLimit(
				requireVerified(
					requireCenter(http.HandlerFunc(middleware.ErrorMapper(h))),
				),
			),
		)
	}

	// Story 3.3 — write chain gates owner+admin (mirrors main.go templateWriteChain).
	requireTemplateWriter := middleware.RequireRole("owner", "admin")
	writeChain := func(h middleware.HandlerWithError) http.Handler {
		return extractTenant(
			onboardingLimit(
				requireVerified(
					requireCenter(
						requireTemplateWriter(http.HandlerFunc(middleware.ErrorMapper(h))),
					),
				),
			),
		)
	}

	mux := http.NewServeMux()
	mux.Handle("GET /api/templates", chain(templateHandler.List))
	mux.Handle("POST /api/templates", chain(templateHandler.Create))
	mux.Handle("GET /api/templates/{id}", chain(templateHandler.GetByID))
	mux.Handle("PUT /api/templates/{id}", writeChain(templateHandler.Update))
	mux.Handle("DELETE /api/templates/{id}", writeChain(templateHandler.Delete))
	mux.Handle("POST /api/templates/{id}/spawn", chain(templateHandler.Spawn))
	return mux
}

// NewTestServerFor2_2ForUser returns an http.Handler with the Story 2.2
// route chain wired and a pre-signed Bearer token for userID attached to
// every request. Accepts anything that satisfies service.AuthDB (either
// TxDB via SetupDB, or *pgxpool.Pool via SetupRawPool).
//
// Story 2.2 wrinkle: the RequireCenterContext middleware fires 403
// CENTER_REQUIRED unless the JWT carries CenterID + Role claims. This
// helper looks up the user's center at token-mint time and inlines the
// claims. If the user has NO center_members row, the test t.Fatalf's
// (C3-11 review fix — previously the empty-claim silent mint made positive
// tests fail as 403 CENTER_REQUIRED for the wrong reason). Use
// `NewTestServerFor2_2ForUserNoCenter` for the CENTER_REQUIRED negative.
func NewTestServerFor2_2ForUser(t *testing.T, db storyDB, userID pgtype.UUID) http.Handler {
	t.Helper()
	tok := signAccessTokenWithCenter(t, db, userID)
	return &authInjectingHandler{next: newStorySrv2_2(t, db), token: tok}
}

// NewTestServerFor2_2ForUserNoCenter is the explicit escape hatch used by
// CENTER_REQUIRED negative tests — mints a valid-signature token with no
// CenterID claim so the request hits RequireCenterContext with an empty
// tenant context.
func NewTestServerFor2_2ForUserNoCenter(t *testing.T, db storyDB, userID pgtype.UUID) http.Handler {
	t.Helper()
	tok := signAccessTokenWithCenterAllowEmpty(t, db, userID)
	return &authInjectingHandler{next: newStorySrv2_2(t, db), token: tok}
}

// signAccessTokenWithCenter looks up the user's center membership through the
// SAME db handle the request will be routed against. This is load-bearing
// for TxDB tests: SeedCenterForUser (TxDB variant) inserts under the outer
// tx that superuserPool cannot see. Real-pool tests fall through to the
// superuser lookup for the same visibility reason (pool + RLS can't see
// center_members without SET LOCAL first).
//
// The `allowEmpty` parameter forces callers to opt into the empty-claim
// fallback that CENTER_REQUIRED negative tests need — everyone else gets
// `t.Fatalf` so a positive-path fixture failure isn't misdiagnosed as a
// handler bug (C3-11 review fix — the silent empty-claim mint had masked
// missing center_members fixtures, producing bogus 403 CENTER_REQUIRED
// responses on positive tests).
func signAccessTokenWithCenter(t *testing.T, db storyDB, userID pgtype.UUID) string {
	return signAccessTokenWithCenterOpts(t, db, userID, false)
}

// signAccessTokenWithCenterAllowEmpty is the explicit escape hatch used by
// CENTER_REQUIRED negative tests to mint a valid-signature token with no
// CenterID claim.
func signAccessTokenWithCenterAllowEmpty(t *testing.T, db storyDB, userID pgtype.UUID) string {
	return signAccessTokenWithCenterOpts(t, db, userID, true)
}

func signAccessTokenWithCenterOpts(t *testing.T, db storyDB, userID pgtype.UUID, allowEmpty bool) string {
	t.Helper()

	// Try via the passed handle first — works for TxDB when
	// SeedCenterForUser (or TenantContext) already set SET LOCAL.
	var (
		centerID pgtype.UUID
		role     string
	)
	// R2-P7 — add ORDER BY created_at ASC so the query is deterministic when
	// a user has multiple memberships (e.g., attacker/victim fixtures in AC11
	// share test users across subtests). Without the sort, LIMIT 1 could
	// return either row nondeterministically and mint a token for the wrong
	// center.
	err := db.QueryRow(context.Background(),
		`SELECT center_id, role FROM center_members WHERE user_id = $1 ORDER BY created_at ASC LIMIT 1`, userID,
	).Scan(&centerID, &role)
	if err != nil {
		// Fall through to superuser pool for pool-backed tests where the
		// classlite_app connection has no SET LOCAL.
		sp := superuserPool(t)
		err = sp.QueryRow(context.Background(),
			`SELECT center_id, role FROM center_members WHERE user_id = $1 ORDER BY created_at ASC LIMIT 1`, userID,
		).Scan(&centerID, &role)
	}
	if err != nil {
		if !allowEmpty {
			t.Fatalf("signAccessTokenWithCenter: no center_members row for user %s — fixture bug or missing CreateCenterForOwner call (use signAccessTokenWithCenterAllowEmpty for CENTER_REQUIRED negative tests): %v", UUIDString(userID), err)
		}
		tok, err := jwtSigner().SignAccess(service.AccessClaims{UserID: UUIDString(userID)}, 900)
		if err != nil {
			t.Fatalf("sign empty-claim access token: %v", err)
		}
		return tok
	}
	tok, err := jwtSigner().SignAccess(service.AccessClaims{
		UserID:   UUIDString(userID),
		CenterID: UUIDString(centerID),
		Role:     role,
	}, 900)
	if err != nil {
		t.Fatalf("sign access token with center: %v", err)
	}
	return tok
}

// NewTestServerFor2_2Unauthenticated returns an http.Handler that does not
// attach any Authorization header — the ATDD tests use it to prove 401.
func NewTestServerFor2_2Unauthenticated(t *testing.T, db storyDB) http.Handler {
	t.Helper()
	return newStorySrv2_2(t, db)
}

// -----------------------------------------------------------------------------
// Fixture verbs — Story 2.2
// -----------------------------------------------------------------------------

// CreateCenterForOwner inserts a centers row + a center_members(role=owner)
// row for the given userID via the superuser pool. Returns the new center's
// pgtype.UUID. Uses the superuser pool so the fixture bypasses RLS on
// center_members (the standard pool would need SET LOCAL app.current_tenant_id
// which is only useful inside a tx).
func CreateCenterForOwner(t *testing.T, _ *pgxpool.Pool, userID pgtype.UUID) pgtype.UUID {
	t.Helper()
	sp := superuserPool(t)
	ctx := context.Background()

	var centerID pgtype.UUID
	short := "test-" + uuid.NewString()[:8]
	if err := sp.QueryRow(ctx,
		`INSERT INTO centers (name, short_code) VALUES ($1, $2) RETURNING id`,
		"Test Center", short,
	).Scan(&centerID); err != nil {
		t.Fatalf("create center for owner: %v", err)
	}
	if _, err := sp.Exec(ctx,
		`INSERT INTO center_members (user_id, center_id, role) VALUES ($1, $2, 'owner')`,
		userID, centerID,
	); err != nil {
		t.Fatalf("create center_members for owner: %v", err)
	}
	return centerID
}

// SeedCenterForUser is the TxDB-scoped variant of CreateCenterForOwner used
// in negative-path handler tests. Inserts a centers row + owner membership
// under the given tx.
func SeedCenterForUser(t *testing.T, db *TxDB, userID pgtype.UUID) pgtype.UUID {
	t.Helper()
	ctx := context.Background()

	var centerID pgtype.UUID
	short := "test-" + uuid.NewString()[:8]
	if err := db.QueryRow(ctx,
		`INSERT INTO centers (name, short_code) VALUES ($1, $2) RETURNING id`,
		"Test Center", short,
	).Scan(&centerID); err != nil {
		t.Fatalf("seed center for user: %v", err)
	}
	// R2-P28 — use set_config with a bind param instead of string-concat SQL.
	// Matches the pattern used in middleware/auth.go and guards against future
	// paste-into-non-test-code + injection. Semantically identical (SET LOCAL
	// + set_config('...', $, true) both scope to the current tx).
	if _, err := db.Exec(ctx,
		`SELECT set_config('app.current_tenant_id', $1, true)`,
		UUIDString(centerID),
	); err != nil {
		t.Fatalf("set tenant context for seed: %v", err)
	}
	if _, err := db.Exec(ctx,
		`INSERT INTO center_members (user_id, center_id, role) VALUES ($1, $2, 'owner')`,
		userID, centerID,
	); err != nil {
		t.Fatalf("seed center_members: %v", err)
	}
	return centerID
}

// AddCenterMember inserts an additional center_members row via the superuser
// pool. role should be "owner" | "admin" | "teacher" | "student".
func AddCenterMember(t *testing.T, _ *pgxpool.Pool, centerID, userID pgtype.UUID, role string) {
	t.Helper()
	sp := superuserPool(t)
	if _, err := sp.Exec(context.Background(),
		`INSERT INTO center_members (user_id, center_id, role) VALUES ($1, $2, $3)`,
		userID, centerID, role,
	); err != nil {
		t.Fatalf("add center member: %v", err)
	}
}

// CreateClassTemplate inserts a class_templates row scoped to the given
// center via the superuser pool. Returns the new template's pgtype.UUID.
func CreateClassTemplate(t *testing.T, _ *pgxpool.Pool, centerID pgtype.UUID, name string) pgtype.UUID {
	t.Helper()
	sp := superuserPool(t)
	var id pgtype.UUID
	if err := sp.QueryRow(context.Background(),
		`INSERT INTO class_templates (center_id, name, target_band, primary_skill, session_count, color)
		 VALUES ($1, $2, 6.5, 'writing', 12, '#f59e0b')
		 RETURNING id`,
		centerID, name,
	).Scan(&id); err != nil {
		t.Fatalf("create class template: %v", err)
	}
	return id
}

// SeedActiveInvite inserts an active (accepted_at NULL) invite row for the
// target email. Used by AC5 race retry-and-reuse test to simulate a prior
// concurrent spawn that already invited this teacher.
func SeedActiveInvite(t *testing.T, _ *pgxpool.Pool, centerID pgtype.UUID, email string, inviterID pgtype.UUID) {
	t.Helper()
	sp := superuserPool(t)
	// Token hash — deterministic sha256 of a fixed string is fine; the
	// spawn code path doesn't touch tokens on the reuse path.
	if _, err := sp.Exec(context.Background(),
		`INSERT INTO invites (center_id, inviter_id, email, role, token_hash, expires_at)
		 VALUES ($1, $2, $3, 'teacher', $4, now() + interval '7 days')`,
		centerID, inviterID, email,
		"seed-active-invite-token-hash-"+uuid.NewString(),
	); err != nil {
		t.Fatalf("seed active invite: %v", err)
	}
}

// SeedAcceptedInvite inserts an already-accepted invite row (accepted_at NOT
// NULL). Used by Murat-M-B3 post-accept re-invite test to prove Branch B
// wins over Branch C once the invited teacher joined.
func SeedAcceptedInvite(
	t *testing.T, _ *pgxpool.Pool,
	centerID pgtype.UUID, email string, inviterID, acceptedByID pgtype.UUID,
) {
	t.Helper()
	_ = acceptedByID // reserved for future audit reconciliation
	sp := superuserPool(t)
	if _, err := sp.Exec(context.Background(),
		`INSERT INTO invites (center_id, inviter_id, email, role, token_hash, expires_at, accepted_at)
		 VALUES ($1, $2, $3, 'teacher', $4, now() + interval '7 days', now())`,
		centerID, inviterID, email,
		"seed-accepted-invite-token-hash-"+uuid.NewString(),
	); err != nil {
		t.Fatalf("seed accepted invite: %v", err)
	}
}

// SetUserPersonaOnPool writes users.persona via the superuser pool. Sibling
// to SetUserPersona (TxDB variant) in story_2_1_helpers.go.
func SetUserPersonaOnPool(t *testing.T, pool *pgxpool.Pool, userID pgtype.UUID, persona string) {
	t.Helper()
	_ = pool // signature symmetry with SetUserPersona; superuser pool used to bypass RLS
	sp := superuserPool(t)
	if _, err := sp.Exec(context.Background(),
		`UPDATE users SET persona = $2 WHERE id = $1`, userID, persona,
	); err != nil {
		t.Fatalf("set user persona on pool: %v", err)
	}
}

// NewPGUUIDFromString parses a canonical UUID string into a pgtype.UUID.
// Used by AC12 error envelope shape test where a bogus template ID is
// injected. Panics on parse failure — callers pass literal test UUIDs.
func NewPGUUIDFromString(s string) pgtype.UUID {
	u, err := uuid.Parse(s)
	if err != nil {
		panic("NewPGUUIDFromString: " + err.Error())
	}
	return pgtype.UUID{Bytes: u, Valid: true}
}

// -----------------------------------------------------------------------------
// Extended cleanup — Story 2.2 owns class_templates + template_sessions + classes
// -----------------------------------------------------------------------------

// init hooks Story 2.2's owned-resource cleanup into the shared
// PurgeUserAndOwnedCenters cascade. Called from PurgeUserAndOwnedCenters
// before it drops centers, so the FK CASCADE from centers to
// class_templates + classes still fires cleanly — but this pre-purge also
// clears any invites + template_sessions that FKs alone would miss.
func init() {
	registerPre2_2Purge(pre2_2Purge)
}

// pre2_2Purge removes Story 2.2 rows before the shared cleanup drops centers.
// Runs under superuser to bypass RLS on invites + template_sessions.
//
// C3-20 review fix — errors are now surfaced via slog.Warn so intermittent
// test failures blamed on flakes can be traced to residue left behind by a
// silently-failed purge (FK block, permission drift, etc.). Slog output
// appears in `go test -v` runs; the purge cannot fatal because it runs in
// `t.Cleanup` on a pool that may already be closed.
func pre2_2Purge(sp *pgxpool.Pool, userID pgtype.UUID) {
	ctx := context.Background()
	// R2-P29 — scope to centers this user OWNS. Previously this SELECT
	// returned every center where userID was a member (any role); the AC11
	// attack-vector fixture registers the teacher as a member of the owner's
	// center, so purging teacher first was nuking owner's class_templates +
	// classes + invites before the owner's own cleanup even ran. Scoping to
	// role='owner' keeps the pre-purge idempotent per-user and stops one
	// user's cleanup from stomping another's data.
	rows, err := sp.Query(ctx,
		`SELECT center_id FROM center_members WHERE user_id = $1 AND role = 'owner'`, userID)
	if err != nil {
		slog.Warn("pre2_2Purge lookup center_members failed", "user_id", UUIDString(userID), "err", err)
		return
	}
	var centerIDs []pgtype.UUID
	for rows.Next() {
		var cid pgtype.UUID
		if scanErr := rows.Scan(&cid); scanErr == nil {
			centerIDs = append(centerIDs, cid)
		}
	}
	rows.Close()

	for _, cid := range centerIDs {
		if _, err := sp.Exec(ctx, `DELETE FROM invites WHERE center_id = $1`, cid); err != nil {
			slog.Warn("pre2_2Purge invites delete failed", "center_id", UUIDString(cid), "err", err)
		}
		if _, err := sp.Exec(ctx, `DELETE FROM classes WHERE center_id = $1`, cid); err != nil {
			slog.Warn("pre2_2Purge classes delete failed", "center_id", UUIDString(cid), "err", err)
		}
		if _, err := sp.Exec(ctx,
			`DELETE FROM template_sessions WHERE template_id IN (SELECT id FROM class_templates WHERE center_id = $1)`,
			cid); err != nil {
			slog.Warn("pre2_2Purge template_sessions delete failed", "center_id", UUIDString(cid), "err", err)
		}
		if _, err := sp.Exec(ctx, `DELETE FROM class_templates WHERE center_id = $1`, cid); err != nil {
			slog.Warn("pre2_2Purge class_templates delete failed", "center_id", UUIDString(cid), "err", err)
		}
	}
}

// AssertRLSViolation tightens Pattern-2 INSERT / promote-to-seed RLS tests
// (C3-03 review fix). The previous `if err == nil` check would pass on ANY
// error — including "relation does not exist" if the migration ever dropped
// the table by mistake. This helper asserts the error is a real Postgres
// row-security violation (SQLSTATE 42501) so the test fails loudly if the
// wrong path is exercised.
func AssertRLSViolation(t *testing.T, err error, ctx string) {
	t.Helper()
	if err == nil {
		t.Errorf("%s: expected RLS violation (SQLSTATE 42501), got nil", ctx)
		return
	}
	var pgErr *pgconn.PgError
	if !errorsAs(err, &pgErr) {
		t.Errorf("%s: expected *pgconn.PgError, got %T: %v", ctx, err, err)
		return
	}
	if pgErr.Code != "42501" {
		t.Errorf("%s: expected SQLSTATE 42501 (row_security_violation), got %s (%s)", ctx, pgErr.Code, pgErr.Message)
	}
}

// errorsAs is a small indirection so this file doesn't need to import
// errors just for one call.
func errorsAs(err error, target any) bool {
	return stderrorsAs(err, target)
}
