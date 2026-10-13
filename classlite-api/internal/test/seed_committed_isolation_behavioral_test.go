// seed_committed_isolation_behavioral_test.go — Story 11-1a ATDD (AC2 ·
// R-11-5 score 6 · WF-8 HARD GATE · DD11). The BEHAVIORAL red (DD11): unlike the
// compile-fail reds (atdd_red_phase tag), this file COMPILES and RUNS against the
// CURRENT baseline using ONLY shipped helpers, and goes RED today / GREEN after
// the AC6/AC7 refactor — proving the assertion has teeth, which a compile-fail
// red (never executing the isolation assertion) cannot.
//
// Run it:  go test -run TestCommittedPath ./internal/test/
// This file carries NO build tag — it RUNS in the default `go test ./...` so the
// behavioral assertions stay live as regression locks (DD11).
//
// HONEST SCOPING (verified against the live schema, baseline 6a4eb4d):
// the RLS null-guard is `NULLIF(current_setting('app.current_tenant_id', true),
// ”)::uuid`, so an UNSET tenant denies ALL rows and a B-scoped read sees only B.
// Cross-tenant *read* isolation on the committed path therefore already HOLDS —
// those assertions below are GREEN-FROM-DAY-ONE REGRESSION LOCKS, honestly
// labelled, NOT the teeth. The genuine R-11-5 defect is residue accumulation on
// the SHARED, NON-DISPOSABLE classlite_dev ("485 centers"). The RED TEETH is
// therefore the disposable-DB assertion: the committed path must run against a
// per-run disposable classlite_test (AC6/DD16), FALSE today (pool → classlite_dev),
// TRUE after the refactor.
package test

import (
	"context"
	"fmt"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	syntheticCenterPrefix = "SEED_FAKE_"
)

// AC2 TEETH (RED today → GREEN after AC6/DD16): the committed raw-pool path runs
// against a per-run DISPOSABLE database (classlite_test), not the shared
// classlite_dev that accumulates cross-run / cross-worker residue (R-11-5).
func TestCommittedPath_RunsAgainstDisposableDB(t *testing.T) {
	pool := SetupRawPool(t)
	var dbName string
	if err := pool.QueryRow(context.Background(), `SELECT current_database()`).Scan(&dbName); err != nil {
		t.Fatalf("current_database: %v", err)
	}
	if dbName != "classlite_test" {
		t.Errorf("R-11-5 TEETH: committed path runs against %q — a shared, non-disposable DB that "+
			"accumulates residue across runs/workers. Must be the per-run disposable classlite_test (AC6/DD16).", dbName)
	}
}

// committedRLSTable is one of the five 8-4a RLS surfaces, with a count query that
// takes $1 = the target center id and runs under a connection's RLS tenant scope.
type committedRLSTable struct {
	name     string
	countSQL string
}

// committedRLSTables are the five 8-4a tables AC2/DD11 require proven on the
// COMMITTED path. `users` is GLOBAL/no-RLS, so the students path is proven via a
// JOIN gated by the RLS-scoped center_members.center_id — a tenant-A session must
// surface zero of tenant B's member NAMES even though users itself has no RLS.
var committedRLSTables = []committedRLSTable{
	{"classes", `SELECT count(*) FROM classes WHERE center_id = $1`},
	{"exercises", `SELECT count(*) FROM exercises WHERE center_id = $1`},
	{"assignments", `SELECT count(*) FROM assignments WHERE center_id = $1`},
	{"files", `SELECT count(*) FROM files WHERE center_id = $1`},
	// students: GLOBAL users gated via RLS-scoped center_members (DD11).
	{"center_members+users", `SELECT count(*) FROM center_members cm JOIN users u ON u.id = cm.user_id WHERE cm.center_id = $1`},
}

// AC2 REGRESSION LOCK (expected GREEN today): a committed row in each of the FIVE
// 8-4a RLS surfaces under tenant A is invisible to a fresh connection scoped to
// tenant B, in BOTH directions, incl. the GLOBAL/no-RLS users table reached via
// the center_members join (the students path the "485 residue" most endangered);
// each negative pairs a positive control so an empty-for-everyone false pass is
// caught. Proves RLS holds on COMMITTED rows, not only inside SetupDB's rollback
// tx. NOTE: `centers` is the tenant ROOT and is NOT center_id-scoped, so it is not
// one of the five.
func TestCommittedPath_CrossTenantReadIsolation(t *testing.T) {
	sp := SuperuserPool(t) // RLS-bypassing: setup + teardown of committed fixtures.
	seedCommittedTenantFixture(t, sp, TenantAID, "A", 1)
	seedCommittedTenantFixture(t, sp, TenantBID, "B", 2)

	app := SetupRawPool(t)
	ctx := context.Background()

	// >=1, not ==1, on positive controls: the deterministic seed (which runs in the
	// same classlite_test) also commits rows for TenantAID/BID across these tables,
	// so each own-count is whatever the seed left plus this fixture's one. The
	// isolation TEETH is the negative (other tenant sees exactly 0); the positive
	// control only guards an empty-for-everyone false pass.
	for _, tbl := range committedRLSTables {
		// Positive controls — each tenant sees its OWN committed rows.
		if got := committedCountAsTenant(t, app, ctx, TenantAID, tbl.countSQL, TenantAID); got < 1 {
			t.Errorf("positive control failed [%s]: tenant A cannot see its OWN committed rows (got %d)", tbl.name, got)
		}
		if got := committedCountAsTenant(t, app, ctx, TenantBID, tbl.countSQL, TenantBID); got < 1 {
			t.Errorf("positive control failed [%s]: tenant B cannot see its OWN committed rows (got %d)", tbl.name, got)
		}
		// Negatives — neither tenant sees the other's committed rows (both directions).
		if got := committedCountAsTenant(t, app, ctx, TenantBID, tbl.countSQL, TenantAID); got != 0 {
			t.Errorf("RLS VIOLATION (committed path) [%s]: tenant B sees %d rows of tenant A", tbl.name, got)
		}
		if got := committedCountAsTenant(t, app, ctx, TenantAID, tbl.countSQL, TenantBID); got != 0 {
			t.Errorf("RLS VIOLATION (committed path) [%s]: tenant A sees %d rows of tenant B", tbl.name, got)
		}
	}
}

// seedCommittedClass inserts a committed center (tenant root, for the FK) and a
// committed class under it (RLS-bypassing superuser pool), with a synthetic name,
// and registers teardown (center DELETE cascades the class) so this behavioral
// test leaves ZERO residue — the very discipline AC7 enforces repo-wide.
func seedCommittedClass(t *testing.T, sp *pgxpool.Pool, centerID, suffix string) {
	t.Helper()
	ctx := context.Background()
	if _, err := sp.Exec(ctx,
		`INSERT INTO centers (id, name, short_code) VALUES ($1, $2, $3)
		   ON CONFLICT (id) DO NOTHING`,
		centerID, syntheticCenterPrefix+suffix, "SEEDFAKE"+suffix); err != nil {
		t.Fatalf("seed committed center %s: %v", centerID, err)
	}
	if _, err := sp.Exec(ctx,
		`INSERT INTO classes (center_id, name) VALUES ($1, $2)`,
		centerID, syntheticCenterPrefix+"CLASS_"+suffix); err != nil {
		t.Fatalf("seed committed class for center %s: %v", centerID, err)
	}
	t.Cleanup(func() {
		_, _ = sp.Exec(context.Background(), `DELETE FROM centers WHERE id = $1`, centerID)
	})
}

// committedCountAsTenantErr opens a short committed tx on the app (non-superuser)
// pool, sets the RLS tenant context to asTenant (PERF-1: SET LOCAL needs a tx;
// set_config(...,true) is the parameterized, injection-safe form of SET LOCAL),
// and runs countSQL with $1 = forCenterID under that scope. It returns an error
// instead of calling t.Fatalf, so it is SAFE to call from a worker goroutine
// (t.FailNow off the test goroutine is illegal).
func committedCountAsTenantErr(ctx context.Context, pool *pgxpool.Pool, asTenant, countSQL, forCenterID string) (int, error) {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return 0, fmt.Errorf("begin committed tx: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if _, err := tx.Exec(ctx, "SET LOCAL ROLE classlite_app"); err != nil {
		return 0, fmt.Errorf("set role: %w", err)
	}
	if _, err := tx.Exec(ctx, "SELECT set_config('app.current_tenant_id', $1, true)", asTenant); err != nil {
		return 0, fmt.Errorf("set tenant %s: %w", asTenant, err)
	}
	var n int
	if err := tx.QueryRow(ctx, countSQL, forCenterID).Scan(&n); err != nil {
		return 0, fmt.Errorf("count as tenant %s: %w", asTenant, err)
	}
	return n, nil
}

// committedCountAsTenant is the t.Fatalf wrapper for direct (non-goroutine) test
// callers. NEVER call it from a goroutine — use committedCountAsTenantErr there.
func committedCountAsTenant(t *testing.T, pool *pgxpool.Pool, ctx context.Context, asTenant, countSQL, forCenterID string) int {
	t.Helper()
	n, err := committedCountAsTenantErr(ctx, pool, asTenant, countSQL, forCenterID)
	if err != nil {
		t.Fatalf("%v", err)
	}
	return n
}

// committedClassCountAsTenantErr counts classes for forCenterID under asTenant's
// RLS scope, returning an error (goroutine-safe — see committedCountAsTenantErr).
func committedClassCountAsTenantErr(ctx context.Context, pool *pgxpool.Pool, asTenant, forCenterID string) (int, error) {
	return committedCountAsTenantErr(ctx, pool, asTenant, `SELECT count(*) FROM classes WHERE center_id = $1`, forCenterID)
}

// seedCommittedTenantFixture commits one row in EACH of the five 8-4a RLS tables
// (a user+center_member, class, exercise, assignment, file) under centerID via
// the RLS-bypassing superuser pool, mirroring the deterministic seed's column
// shapes, and registers teardown. `slot` (1/2) namespaces the deterministic UUIDs
// so A and B never collide. The center row is upserted (it already exists from the
// deterministic seed) so only the per-table children are new. This gives AC2 a
// committed positive control on every surface — including the GLOBAL users table
// reached via center_members.
func seedCommittedTenantFixture(t *testing.T, sp *pgxpool.Pool, centerID, suffix string, slot int) {
	t.Helper()
	ctx := context.Background()
	id := func(prefix rune) string {
		return fmt.Sprintf("00000000-0000-0000-0000-%c00000000%03d", prefix, slot)
	}
	uid, clID, exID, asID, flID := id('a'), id('c'), id('e'), id('f'), id('b')

	exec := func(label, sql string, args ...any) {
		if _, err := sp.Exec(ctx, sql, args...); err != nil {
			t.Fatalf("seed committed %s (%s): %v", label, suffix, err)
		}
	}
	exec("center", `INSERT INTO centers (id, name, short_code) VALUES ($1,$2,$3) ON CONFLICT (id) DO NOTHING`,
		centerID, syntheticCenterPrefix+suffix, "SEEDFAKE"+suffix)
	exec("user", `INSERT INTO users (id, email, password_hash, full_name, email_verified)
		VALUES ($1,$2,$3,$4,true) ON CONFLICT (id) DO NOTHING`,
		uid, syntheticCenterPrefix+"committed-"+suffix+"@example.test", "x", syntheticCenterPrefix+"Member "+suffix)
	exec("center_member", `INSERT INTO center_members (user_id, center_id, role)
		VALUES ($1,$2,'teacher') ON CONFLICT (user_id, center_id) DO NOTHING`, uid, centerID)
	exec("class", `INSERT INTO classes (id, center_id, name, target_band, primary_skill, status, teacher_id, start_date)
		VALUES ($1,$2,$3,'6.5'::numeric,'writing','active',$4,'2026-01-06'::date) ON CONFLICT (id) DO NOTHING`,
		clID, centerID, syntheticCenterPrefix+"CLASS_"+suffix, uid)
	exec("exercise", `INSERT INTO exercises (id, center_id, created_by, code, title, skill, content)
		VALUES ($1,$2,$3,$4,$5,'writing','{}'::jsonb) ON CONFLICT (id) DO NOTHING`,
		exID, centerID, uid, syntheticCenterPrefix+"EX_"+suffix, syntheticCenterPrefix+"Exercise "+suffix)
	exec("assignment", `INSERT INTO assignments (id, center_id, exercise_id, class_id, created_by, deadline_at, instructions)
		VALUES ($1,$2,$3,$4,$5,now() + interval '7 days',$6) ON CONFLICT (id) DO NOTHING`,
		asID, centerID, exID, clID, uid, syntheticCenterPrefix+"Instructions "+suffix)
	exec("file", `INSERT INTO files (id, center_id, name, slug, object_key, content_type, size_bytes, uploaded_by)
		VALUES ($1,$2,$3,$4,$5,'text/plain',1,$6) ON CONFLICT (id) DO NOTHING`,
		flID, centerID, syntheticCenterPrefix+"Handout "+suffix, syntheticCenterPrefix+"handout-"+suffix,
		centerID+"/committed/"+suffix+".txt", uid)

	t.Cleanup(func() {
		// Child-first teardown (FKs); the center row is left to the deterministic
		// seed / Reset — it pre-existed this fixture.
		bg := context.Background()
		_, _ = sp.Exec(bg, `DELETE FROM files WHERE id=$1`, flID)
		_, _ = sp.Exec(bg, `DELETE FROM assignments WHERE id=$1`, asID)
		_, _ = sp.Exec(bg, `DELETE FROM exercises WHERE id=$1`, exID)
		_, _ = sp.Exec(bg, `DELETE FROM classes WHERE id=$1`, clID)
		_, _ = sp.Exec(bg, `DELETE FROM center_members WHERE user_id=$1 AND center_id=$2`, uid, centerID)
		_, _ = sp.Exec(bg, `DELETE FROM users WHERE id=$1`, uid)
	})
}
