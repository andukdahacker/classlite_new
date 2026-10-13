package test

import (
	"context"
	"fmt"
	"net/url"
	"os"
	"os/exec"
	"strings"
	"sync"

	"github.com/ducdo/classlite-api/internal/seed"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Test-DB lifecycle constants (Story 11-1a / AC6 / DD16). The suite runs against
// a dedicated DISPOSABLE database, migrated by a NON-superuser role so the test
// environment exercises the same privilege model production will.
const (
	// TestDBName is the dedicated disposable test database.
	TestDBName = "classlite_test"
	// throwawayDevDB exists purely so the immutable 20260601110000 migration's
	// hardcoded `GRANT CONNECT ON DATABASE classlite_dev` replays clean on a fresh
	// cluster (DD16d). An applied migration can never be edited (WF-2), so we make
	// the database it names exist rather than touch the migration.
	throwawayDevDB = "classlite_dev"
	// migratorRole is the dedicated NON-superuser role that applies migrations,
	// standing in for the prod migration role (11-8a). Migrating as a superuser
	// would let a superuser-only migration pass in CI and detonate only in prod.
	//
	// It is granted BYPASSRLS (but NOT superuser). This is a REAL constraint the
	// codebase imposes, surfaced by DD16b: the Epic-9 polar tenant-resolution
	// functions (polar_center_by_subscription_id / _checkout_id, migrations
	// 20260930120600/700) are SECURITY DEFINER and must resolve an event to a
	// center ACROSS tenants. They relied on their owner (the migration role) being
	// a superuser to bypass RLS. Migrating as a plain non-superuser makes the
	// migrator the owner WITHOUT RLS bypass, so cross-tenant resolution silently
	// falls back to the request's (spoofable) metadata — a confused-deputy
	// (SEC-7) leak that would detonate only in a non-superuser prod. The prod
	// migration role (11-8a) therefore needs BYPASSRLS too; see FU-11-1A-MIGRATOR-BYPASSRLS.
	migratorRole     = "classlite_migrator"
	migratorPassword = "classlite_migrator_dev_password"
	// appRole/appPassword mirror 20260601110000_create_app_role — the non-superuser
	// RLS-enforcing role the test suite connects as.
	appRole     = "classlite_app"
	appPassword = "classlite_dev_password"
)

var (
	ensureOnce sync.Once
	ensureErr  error
)

// EnsureTestDB ensures the disposable classlite_test database exists and is
// migrated by the non-superuser migration role, then points the suite's env at
// it. It is owned by TestMain (so local == CI runs the same lifecycle) and is
// idempotent: the heavy bootstrap runs exactly once per test binary.
//
// Steps (all admin DDL via a superuser bootstrap connection — the irreducible
// infra ops; the SCHEMA migration itself runs as the non-superuser migrator):
//  1. ensure the migrator role (NOSUPERUSER, CREATEROLE, owns the test DBs);
//  2. ensure the throwaway classlite_dev (immutable-GRANT replay, DD16d);
//  3. ensure classlite_test owned by the migrator;
//  4. grant the migrator CONNECT-with-grant-option on classlite_dev so the
//     immutable cross-DB grant replays as the migrator;
//  5. `migrate up` as the migrator against classlite_test;
//  6. plant the disposable sentinel (DD13 proof #2);
//  7. export DATABASE_URL (app role) + MIGRATION_DATABASE_URL (superuser) for
//     the suite's getPool / SuperuserPool / seed.Reset.
func EnsureTestDB() error {
	ensureOnce.Do(func() { ensureErr = ensureTestDB() })
	return ensureErr
}

func ensureTestDB() error {
	ctx := context.Background()

	// Escape hatch: when the DB is already prepared externally (e.g. a CI step
	// that bootstrapped + migrated classlite_test, or a developer pointing the
	// suite at an arbitrary prepared DB for diagnostics), skip the bootstrap and
	// trust the pre-set DATABASE_URL / MIGRATION_DATABASE_URL.
	if os.Getenv("SKIP_TEST_DB_BOOTSTRAP") == "1" {
		return nil
	}

	admin, err := adminURL()
	if err != nil {
		return err
	}
	host, superUser, superPass, err := splitURL(admin)
	if err != nil {
		return err
	}

	// --- 1-4: superuser bootstrap (CREATE ROLE/DATABASE are superuser infra) ---
	adminPool, err := pgxpool.New(ctx, admin)
	if err != nil {
		return fmt.Errorf("ensure test db: connect admin: %w", err)
	}
	if err := bootstrapRolesAndDatabases(ctx, adminPool); err != nil {
		adminPool.Close()
		return err
	}
	adminPool.Close()

	// --- 5: migrate classlite_test AS THE NON-SUPERUSER MIGRATOR (DD16b) ---
	migratorURL := buildURL(migratorRole, migratorPassword, host, TestDBName)
	if err := migrateUp(migratorURL); err != nil {
		return err
	}

	// --- 6: plant the disposable sentinel on the test DB (superuser) ---
	superTestURL := buildURL(superUser, superPass, host, TestDBName)
	superTestPool, err := pgxpool.New(ctx, superTestURL)
	if err != nil {
		return fmt.Errorf("ensure test db: connect superuser@%s: %w", TestDBName, err)
	}
	if err := seed.InstallSentinel(ctx, superTestPool); err != nil {
		superTestPool.Close()
		return err
	}
	superTestPool.Close()

	// --- 7: point the suite at the disposable DB ---
	// DATABASE_URL  → app role (getPool / SetupDB / SetupRawPool), RLS enforced.
	// MIGRATION_DATABASE_URL → superuser@classlite_test (SuperuserPool + seed.Reset).
	if err := os.Setenv("DATABASE_URL", buildURL(appRole, appPassword, host, TestDBName)); err != nil {
		return fmt.Errorf("ensure test db: set DATABASE_URL: %w", err)
	}
	if err := os.Setenv("MIGRATION_DATABASE_URL", superTestURL); err != nil {
		return fmt.Errorf("ensure test db: set MIGRATION_DATABASE_URL: %w", err)
	}
	return nil
}

// clearSeedTenants removes the committed deterministic seed tenants (A & B).
// The seed commits rows under the fixture tenant ids (TenantAID/TenantBID, which
// AC1 requires it to reuse); the vast majority of RLS adversarial tests create
// centers with those SAME ids inside rollback transactions. Persistent seed rows
// would collide on centers_pkey. Clearing them here (TestMain start) + via each
// seed test's t.Cleanup keeps committed seed data from leaking into sibling
// tests — the AC7 "committed rows get deterministic teardown" discipline.
func clearSeedTenants(ctx context.Context) error {
	// seed.Reset derives its RLS-bypassing superuser pool from the database this
	// seed pool targets (same host/port/db, superuser creds swapped in), so pass
	// the app pool on classlite_test (DATABASE_URL, set by EnsureTestDB). Opened
	// once and closed here — clearSeedTenants runs at TestMain start only.
	appURL := os.Getenv("DATABASE_URL")
	if appURL == "" {
		return fmt.Errorf("clear seed tenants: DATABASE_URL unset (EnsureTestDB must run first)")
	}
	pool, err := pgxpool.New(ctx, appURL)
	if err != nil {
		return fmt.Errorf("clear seed tenants: open app pool: %w", err)
	}
	defer pool.Close()
	for _, id := range []string{seed.CenterAID, seed.CenterBID} {
		var u pgtype.UUID
		if err := u.Scan(id); err != nil {
			return err
		}
		if err := seed.Reset(ctx, pool, u); err != nil {
			return err
		}
	}
	return nil
}

// bootstrapRolesAndDatabases runs the superuser-only infra DDL. Each step is
// guarded so it is safe to re-run and safe whether the objects pre-exist (local
// dev) or not (CI's ephemeral cluster).
func bootstrapRolesAndDatabases(ctx context.Context, admin *pgxpool.Pool) error {
	var roleExists bool
	if err := admin.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname=$1)`, migratorRole).Scan(&roleExists); err != nil {
		return fmt.Errorf("bootstrap: check migrator role: %w", err)
	}
	if !roleExists {
		if _, err := admin.Exec(ctx,
			fmt.Sprintf(`CREATE ROLE %s LOGIN PASSWORD %s NOSUPERUSER CREATEROLE BYPASSRLS`,
				migratorRole, quoteLiteral(migratorPassword))); err != nil {
			return fmt.Errorf("bootstrap: create migrator role: %w", err)
		}
	} else {
		// Keep the attributes + password deterministic across runs even if the role lingers.
		if _, err := admin.Exec(ctx,
			fmt.Sprintf(`ALTER ROLE %s LOGIN PASSWORD %s NOSUPERUSER CREATEROLE BYPASSRLS`,
				migratorRole, quoteLiteral(migratorPassword))); err != nil {
			return fmt.Errorf("bootstrap: alter migrator role: %w", err)
		}
	}

	if err := ensureDatabase(ctx, admin, throwawayDevDB, ""); err != nil {
		return err
	}
	if err := ensureDatabase(ctx, admin, TestDBName, migratorRole); err != nil {
		return err
	}
	// The migrator owns classlite_test (full DDL). Reassign ownership defensively
	// in case it pre-existed under another owner (CI's POSTGRES_DB).
	if _, err := admin.Exec(ctx, fmt.Sprintf(`ALTER DATABASE %s OWNER TO %s`, TestDBName, migratorRole)); err != nil {
		return fmt.Errorf("bootstrap: chown %s: %w", TestDBName, err)
	}
	// Let the migrator replay the immutable cross-DB GRANT on classlite_dev.
	if _, err := admin.Exec(ctx,
		fmt.Sprintf(`GRANT CONNECT ON DATABASE %s TO %s WITH GRANT OPTION`, throwawayDevDB, migratorRole)); err != nil {
		return fmt.Errorf("bootstrap: grant connect-on-dev to migrator: %w", err)
	}
	return nil
}

// ensureDatabase creates db (optionally OWNER owner) if it does not already
// exist. CREATE DATABASE cannot run in a transaction, so it is issued directly.
func ensureDatabase(ctx context.Context, admin *pgxpool.Pool, db, owner string) error {
	var exists bool
	if err := admin.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname=$1)`, db).Scan(&exists); err != nil {
		return fmt.Errorf("bootstrap: check database %s: %w", db, err)
	}
	if exists {
		return nil
	}
	stmt := fmt.Sprintf(`CREATE DATABASE %s`, db)
	if owner != "" {
		stmt += fmt.Sprintf(` OWNER %s`, owner)
	}
	if _, err := admin.Exec(ctx, stmt); err != nil {
		return fmt.Errorf("bootstrap: create database %s: %w", db, err)
	}
	return nil
}

// migrateUp shells out to the golang-migrate CLI (the project's migration tool,
// used by scripts/migrate.sh — no new Go dependency), applying the chain as the
// non-superuser migrator against classlite_test.
func migrateUp(databaseURL string) error {
	root, err := seed.FindRepoRoot()
	if err != nil {
		return fmt.Errorf("migrate up: %w", err)
	}
	migrationsDir := root + "/classlite-api/migrations"
	cmd := exec.Command("migrate", "-path", migrationsDir, "-database", databaseURL, "up")
	if out, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("migrate up (as %s): %w\n%s", migratorRole, err, out)
	}
	return nil
}

// adminURL resolves the superuser bootstrap connection (to a maintenance DB) for
// CREATE ROLE/DATABASE. TEST_ADMIN_DATABASE_URL wins; otherwise the local-dev
// superuser default. It must point at a maintenance DB (not classlite_test),
// since CREATE DATABASE cannot target the connected database.
func adminURL() (string, error) {
	if u := os.Getenv("TEST_ADMIN_DATABASE_URL"); u != "" {
		return u, nil
	}
	return "postgres://classlite:classlite_dev_password@localhost:5432/postgres?sslmode=disable", nil
}

// splitURL extracts host[:port], username, and password from a postgres URL.
func splitURL(raw string) (host, user, pass string, err error) {
	u, err := url.Parse(raw)
	if err != nil {
		return "", "", "", fmt.Errorf("parse database url: %w", err)
	}
	pw, _ := u.User.Password()
	return u.Host, u.User.Username(), pw, nil
}

// buildURL assembles a postgres URL for the given role against db on host.
func buildURL(user, pass, host, db string) string {
	return fmt.Sprintf("postgres://%s:%s@%s/%s?sslmode=disable",
		url.QueryEscape(user), url.QueryEscape(pass), host, db)
}

// quoteLiteral single-quotes a SQL string literal (for role passwords, which
// cannot be parameterized in CREATE/ALTER ROLE).
func quoteLiteral(s string) string {
	return "'" + strings.ReplaceAll(s, "'", "''") + "'"
}
