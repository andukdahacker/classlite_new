// Story 4.5 — HARDENED batch-tool integration tests (R20b = 8, authored
// red-first: preservation, guard, and concurrency scenarios). Real DB
// (TEST-BE-2 — never mock pgx). Never t.Parallel on DB tests.
//
// Two harnesses, by necessity:
//   - Most tests run inside a SUPERUSER OUTER TX (RLS bypassed → cross-tenant;
//     the tool's per-batch pool.Begin() becomes a savepoint whose Commit is a
//     RELEASE, so batch commit/rollback is modeled while the whole thing rolls
//     back at t.Cleanup — isolation without residue).
//   - The xmin lost-update test needs COMMITTED rows + a separate connection,
//     because xmin only changes across real transactions. It uses SuperuserPool
//     directly with explicit row cleanup.
package jsonbmigrate_test

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"strings"
	"testing"

	"github.com/ducdo/classlite-api/internal/model"
	"github.com/ducdo/classlite-api/internal/store"
	"github.com/ducdo/classlite-api/internal/store/generated"
	"github.com/ducdo/classlite-api/internal/test"
	"github.com/ducdo/classlite-api/tools/jsonbmigrate"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
)

const toolSentinelMinutes = 777

func silentLogger() *slog.Logger { return slog.New(slog.NewTextHandler(io.Discard, nil)) }

func zeroAfterID() pgtype.UUID { return pgtype.UUID{Bytes: uuid.Nil, Valid: true} }

// dbConn is the minimal surface the test seeding/counting needs; both *test.TxDB
// and *pgxpool.Pool satisfy it.
type dbConn interface {
	Exec(context.Context, string, ...interface{}) (pgconn.CommandTag, error)
	QueryRow(context.Context, string, ...interface{}) pgx.Row
}

// superuserTxPool wraps a rolled-back superuser outer tx as a batch-tool pool.
func superuserTxPool(t *testing.T) *test.TxDB {
	t.Helper()
	sp := test.SuperuserPool(t)
	outer, err := sp.Begin(context.Background())
	if err != nil {
		t.Fatalf("begin superuser outer tx: %v", err)
	}
	t.Cleanup(func() { _ = outer.Rollback(context.Background()) })
	return &test.TxDB{Tx: outer}
}

// installSentinelV2 overrides the exercise schema to a synthetic current = 2 whose
// 1→2 rung stamps an observable sentinel into settings — a real version bump with
// NO speculative production v2. Returns a restore func to defer.
func installSentinelV2(t *testing.T) func() {
	t.Helper()
	return store.OverrideExerciseSchemaForTest(2, map[int]model.UpgradeFunc{
		1: func(raw json.RawMessage) (json.RawMessage, error) {
			var c store.ExerciseContent
			if err := json.Unmarshal(raw, &c); err != nil {
				return nil, err
			}
			c.Settings.TimeLimitEnabled = true
			c.Settings.TimeLimitMinutes = toolSentinelMinutes
			return c.Marshal()
		},
	})
}

func seedCenterAndUser(t *testing.T, db *test.TxDB, sfx string) (center, user uuid.UUID) {
	t.Helper()
	c := test.CreateCenter(t, db, "Tool "+sfx, "tl-"+sfx)
	u := test.CreateUser(t, db, "tool-"+sfx+"@example.com", "Tool User")
	return uuid.UUID(c.ID.Bytes), uuid.UUID(u.ID.Bytes)
}

// seedExercises inserts n exercises in a center at the given schema_version with
// the given content blob, returning their ids.
func seedExercises(t *testing.T, ctx context.Context, db dbConn, center, user uuid.UUID, n, version int, content string) []uuid.UUID {
	t.Helper()
	ids := make([]uuid.UUID, n)
	for i := 0; i < n; i++ {
		id := uuid.New()
		ids[i] = id
		if _, err := db.Exec(ctx,
			`INSERT INTO exercises (id, center_id, created_by, code, title, skill, tags, content, schema_version)
			 VALUES ($1,$2,$3,$4,'Seed','reading','{}',$5::jsonb,$6)`,
			id, center, user, "EX-"+id.String()[:10], content, version,
		); err != nil {
			t.Fatalf("seed exercise %d: %v", i, err)
		}
	}
	return ids
}

func countExercises(t *testing.T, ctx context.Context, db dbConn, center uuid.UUID, version int) int {
	t.Helper()
	var n int
	if err := db.QueryRow(ctx,
		`SELECT count(*) FROM exercises WHERE center_id=$1 AND schema_version=$2`, center, version,
	).Scan(&n); err != nil {
		t.Fatalf("count exercises: %v", err)
	}
	return n
}

const v1Content = `{"sections":[],"settings":{}}`

// TestRunMigration_AllRowsAcrossBatchesAndTenants proves keyset (not OFFSET)
// migrates ALL 250 rows across ≥3 batches and ≥2 tenants, with per-tenant counts
// preserved exactly (no cross-tenant blast radius) — and the returned count ==
// rows actually touched (AC2a, progress-count).
func TestRunMigration_AllRowsAcrossBatchesAndTenants(t *testing.T) {
	defer installSentinelV2(t)()
	db := superuserTxPool(t)
	ctx := context.Background()

	// Global v1 baseline (defensive against any pre-existing committed v1 rows).
	var globalV1Before int
	if err := db.QueryRow(ctx, `SELECT count(*) FROM exercises WHERE schema_version=1`).Scan(&globalV1Before); err != nil {
		t.Fatalf("baseline count: %v", err)
	}

	centerA, userA := seedCenterAndUser(t, db, "a"+uuid.NewString()[:6])
	centerB, userB := seedCenterAndUser(t, db, "b"+uuid.NewString()[:6])
	seedExercises(t, ctx, db, centerA, userA, 150, 1, v1Content)
	seedExercises(t, ctx, db, centerB, userB, 100, 1, v1Content)

	m := jsonbmigrate.ExercisesMigrator()
	migrated, skipped, err := jsonbmigrate.RunMigration(ctx, db, m, 1, 2, 100, zeroAfterID(), silentLogger())
	if err != nil {
		t.Fatalf("RunMigration: %v", err)
	}
	if want := globalV1Before + 250; migrated != want {
		t.Fatalf("migrated = %d, want %d (baseline %d + 250) — a lost batch or OFFSET-skip", migrated, want, globalV1Before)
	}
	if skipped != 0 {
		t.Fatalf("skipped = %d, want 0 (no concurrent writers — a clean sweep leaves nothing at from)", skipped)
	}

	// Per-tenant preservation: every seeded row now v2, none left at v1, counts
	// exact per center (no cross-tenant leakage).
	if got := countExercises(t, ctx, db, centerA, 2); got != 150 {
		t.Fatalf("centerA v2 = %d, want 150", got)
	}
	if got := countExercises(t, ctx, db, centerA, 1); got != 0 {
		t.Fatalf("centerA v1 = %d, want 0 (all swept)", got)
	}
	if got := countExercises(t, ctx, db, centerB, 2); got != 100 {
		t.Fatalf("centerB v2 = %d, want 100", got)
	}
	if got := countExercises(t, ctx, db, centerB, 1); got != 0 {
		t.Fatalf("centerB v1 = %d, want 0 (all swept)", got)
	}

	// Spot-check the upgraded shape actually ran (sentinel present).
	var raw []byte
	if err := db.QueryRow(ctx, `SELECT content FROM exercises WHERE center_id=$1 LIMIT 1`, centerA).Scan(&raw); err != nil {
		t.Fatalf("read upgraded content: %v", err)
	}
	var c store.ExerciseContent
	if err := json.Unmarshal(raw, &c); err != nil {
		t.Fatalf("decode upgraded content: %v", err)
	}
	if c.Settings.TimeLimitMinutes != toolSentinelMinutes {
		t.Fatalf("upgraded content missing sentinel: %+v", c.Settings)
	}
}

// TestRunMigration_XminGuardSkipsConcurrentlyModifiedRow is the highest-severity
// correctness test (AC2b, Murat #3 / Winston #1): a row a concurrent live writer
// touched between the tool's read and write matches ZERO rows and is skipped —
// the user's edit is NEVER clobbered. Needs committed rows + a second connection.
func TestRunMigration_XminGuardSkipsConcurrentlyModifiedRow(t *testing.T) {
	sp := test.SuperuserPool(t)
	ctx := context.Background()

	sfx := "x" + uuid.NewString()[:8]
	center := uuid.New()
	user := uuid.New()
	if _, err := sp.Exec(ctx, `INSERT INTO centers (id,name,short_code) VALUES ($1,$2,$3)`,
		center, "Xmin "+sfx, "xm-"+sfx[:6]); err != nil {
		t.Fatalf("seed center: %v", err)
	}
	if _, err := sp.Exec(ctx, `INSERT INTO users (id,email,full_name) VALUES ($1,$2,$3)`,
		user, "xmin-"+sfx+"@example.com", "Xmin User"); err != nil {
		t.Fatalf("seed user: %v", err)
	}
	exID := uuid.New()
	if _, err := sp.Exec(ctx,
		`INSERT INTO exercises (id,center_id,created_by,code,title,skill,tags,content,schema_version)
		 VALUES ($1,$2,$3,$4,'Original','reading','{}',$5::jsonb,1)`,
		exID, center, user, "EX-"+exID.String()[:10], v1Content); err != nil {
		t.Fatalf("seed exercise: %v", err)
	}
	t.Cleanup(func() {
		_, _ = sp.Exec(context.Background(), `DELETE FROM exercises WHERE center_id=$1`, center)
		_, _ = sp.Exec(context.Background(), `DELETE FROM centers WHERE id=$1`, center)
		_, _ = sp.Exec(context.Background(), `DELETE FROM users WHERE id=$1`, user)
	})

	defer installSentinelV2(t)()
	m := jsonbmigrate.ExercisesMigrator()

	// Read the row as the tool would (captures the read-time xmin).
	tx, err := sp.Begin(ctx)
	if err != nil {
		t.Fatalf("begin read tx: %v", err)
	}
	rows, err := m.ListPage(ctx, generated.New(tx), 1, zeroAfterID(), 10)
	_ = tx.Rollback(ctx)
	if err != nil {
		t.Fatalf("list page: %v", err)
	}
	var staleRow jsonbmigrate.MigrationRow
	for _, r := range rows {
		if uuid.UUID(r.ID.Bytes) == exID {
			staleRow = r
		}
	}
	if staleRow.Version != 1 {
		t.Fatalf("did not read the seeded row (got version %d)", staleRow.Version)
	}

	// Concurrent live writer changes CONTENT but leaves schema_version = 1 — this
	// bumps xmin, invalidating the tool's read-time token.
	if _, err := sp.Exec(ctx, `UPDATE exercises SET title='Edited By User', updated_at=now() WHERE id=$1`, exID); err != nil {
		t.Fatalf("concurrent write: %v", err)
	}

	// The tool now attempts its guarded write with the STALE xmin → 0 rows.
	upgraded := []byte(`{"sections":[],"settings":{"timeLimitEnabled":true,"timeLimitMinutes":777,"caseSensitive":false}}`)
	wtx, err := sp.Begin(ctx)
	if err != nil {
		t.Fatalf("begin write tx: %v", err)
	}
	affected, err := m.UpdateRow(ctx, wtx, staleRow, upgraded, 2)
	if err != nil {
		_ = wtx.Rollback(ctx)
		t.Fatalf("UpdateRow: %v", err)
	}
	if err := wtx.Commit(ctx); err != nil {
		t.Fatalf("commit write tx: %v", err)
	}
	if affected != 0 {
		t.Fatalf("guarded UPDATE affected %d rows, want 0 (concurrent write must be skipped, not clobbered)", affected)
	}

	// The user's edit survived; the row is untouched by the tool.
	var title string
	var version int32
	var content []byte
	if err := sp.QueryRow(ctx, `SELECT title, schema_version, content FROM exercises WHERE id=$1`, exID).
		Scan(&title, &version, &content); err != nil {
		t.Fatalf("re-read row: %v", err)
	}
	if title != "Edited By User" {
		t.Fatalf("title = %q, want the user's concurrent edit (the tool clobbered it)", title)
	}
	if version != 1 {
		t.Fatalf("schema_version = %d, want 1 (tool must not have written)", version)
	}
}

// TestRunMigration_ResumableAfterMidRunFailure proves per-batch commit +
// resumability (AC2c): a failure mid-batch-3 leaves batches 1-2 at `to` and the
// rest at `from`; a re-run sweeps only the remaining `from` rows (the version
// predicate makes this automatic).
func TestRunMigration_ResumableAfterMidRunFailure(t *testing.T) {
	defer installSentinelV2(t)()
	db := superuserTxPool(t)
	ctx := context.Background()

	center, user := seedCenterAndUser(t, db, "r"+uuid.NewString()[:6])
	seedExercises(t, ctx, db, center, user, 250, 1, v1Content)

	// A migrator that fails on the 201st upgrade (first row of batch 3 at size 100).
	failing := jsonbmigrate.ExercisesMigrator()
	real := failing.Upgrade
	calls := 0
	failing.Upgrade = func(raw []byte, from int) ([]byte, error) {
		calls++
		if calls == 201 {
			return nil, fmt.Errorf("injected mid-run failure")
		}
		return real(raw, from)
	}

	migrated, _, err := jsonbmigrate.RunMigration(ctx, db, failing, 1, 2, 100, zeroAfterID(), silentLogger())
	if err == nil {
		t.Fatal("expected the injected failure to abort the run")
	}
	if migrated != 200 {
		t.Fatalf("migrated before failure = %d, want 200 (batches 1-2 committed)", migrated)
	}
	if got := countExercises(t, ctx, db, center, 2); got != 200 {
		t.Fatalf("committed v2 rows = %d, want 200", got)
	}
	if got := countExercises(t, ctx, db, center, 1); got != 50 {
		t.Fatalf("remaining v1 rows = %d, want 50 (batch 3+ rolled back)", got)
	}

	// Re-run with the real migrator from the start: the version predicate selects
	// only the remaining 50 v1 rows; the already-migrated 200 are untouched.
	rerun, _, err := jsonbmigrate.RunMigration(ctx, db, jsonbmigrate.ExercisesMigrator(), 1, 2, 100, zeroAfterID(), silentLogger())
	if err != nil {
		t.Fatalf("re-run: %v", err)
	}
	if rerun != 50 {
		t.Fatalf("re-run migrated = %d, want 50 (only the remainder)", rerun)
	}
	if got := countExercises(t, ctx, db, center, 1); got != 0 {
		t.Fatalf("v1 rows after re-run = %d, want 0 (all swept)", got)
	}
	if got := countExercises(t, ctx, db, center, 2); got != 250 {
		t.Fatalf("v2 rows after re-run = %d, want 250", got)
	}
}

// TestRunMigration_PoisonRowAborts proves AC2d: a row whose blob fails to decode
// at its version aborts the run, surfaces the PK, and commits nothing past it.
func TestRunMigration_PoisonRowAborts(t *testing.T) {
	defer installSentinelV2(t)()
	db := superuserTxPool(t)
	ctx := context.Background()

	center, user := seedCenterAndUser(t, db, "p"+uuid.NewString()[:6])
	// A handful of good rows + one poison row (valid JSONB, invalid ExerciseContent)
	// all within a single batch, so the abort rolls the whole batch back.
	seedExercises(t, ctx, db, center, user, 3, 1, v1Content)
	poison := seedExercises(t, ctx, db, center, user, 1, 1, `"not an exercise object"`)
	seedExercises(t, ctx, db, center, user, 3, 1, v1Content)

	migrated, _, err := jsonbmigrate.RunMigration(ctx, db, jsonbmigrate.ExercisesMigrator(), 1, 2, 100, zeroAfterID(), silentLogger())
	if err == nil {
		t.Fatal("expected a poison-row abort, got nil error")
	}
	if !containsUUID(err.Error(), poison[0]) {
		t.Fatalf("error must surface the offending PK %s, got: %v", poison[0], err)
	}
	if migrated != 0 {
		t.Fatalf("migrated = %d, want 0 (the whole batch rolls back on abort — no partial commit past the bad row)", migrated)
	}
	if got := countExercises(t, ctx, db, center, 2); got != 0 {
		t.Fatalf("v2 rows = %d, want 0 (nothing committed past the poison row)", got)
	}
	if got := countExercises(t, ctx, db, center, 1); got != 7 {
		t.Fatalf("v1 rows = %d, want 7 (all still at from)", got)
	}
}

// TestRunMigration_GuardsRejectWithZeroWrites proves AC2e/AC4: unknown entity,
// to≠current, from≥to, and from<1 each error with ZERO writes.
func TestRunMigration_GuardsRejectWithZeroWrites(t *testing.T) {
	defer installSentinelV2(t)() // current = 2
	db := superuserTxPool(t)
	ctx := context.Background()

	center, user := seedCenterAndUser(t, db, "g"+uuid.NewString()[:6])
	seedExercises(t, ctx, db, center, user, 5, 1, v1Content)

	if _, err := jsonbmigrate.Resolve("widgets"); err == nil {
		t.Fatal("unknown entity: expected an error")
	}

	m := jsonbmigrate.ExercisesMigrator() // CurrentVersion = 2
	cases := []struct {
		name     string
		from, to int
	}{
		{"to != current", 1, 3},
		{"from == to", 2, 2},
		{"from > to", 3, 2},
		{"from < 1", 0, 2},
	}
	for _, c := range cases {
		migrated, _, err := jsonbmigrate.RunMigration(ctx, db, m, c.from, c.to, 100, zeroAfterID(), silentLogger())
		if err == nil {
			t.Fatalf("%s: expected a guard error", c.name)
		}
		if migrated != 0 {
			t.Fatalf("%s: migrated = %d, want 0", c.name, migrated)
		}
	}
	// Zero writes: every seeded row is still at v1.
	if got := countExercises(t, ctx, db, center, 1); got != 5 {
		t.Fatalf("v1 rows after guard rejects = %d, want 5 (zero writes)", got)
	}
	if got := countExercises(t, ctx, db, center, 2); got != 0 {
		t.Fatalf("v2 rows after guard rejects = %d, want 0", got)
	}
}

func containsUUID(s string, id uuid.UUID) bool {
	return strings.Contains(s, id.String())
}
