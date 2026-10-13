package seed

import (
	"context"
	"fmt"
	"os"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

// disposableDBAllowlist is the set of database names a destructive reset will
// ever touch. A production DB name is never on it (DD13).
var disposableDBAllowlist = map[string]bool{
	"classlite_test": true,
}

// DestructiveOptions are the three POSITIVE proofs a target must present before
// any destructive op (DD13). A prod DB cannot grow a sentinel; a staging DB that
// "looks local" has none and is refused.
type DestructiveOptions struct {
	// Pool is the connection to wipe. When nil, DestructiveReset only validates
	// the guard and performs no deletion (used by the guard unit test).
	Pool *pgxpool.Pool
	// DatabaseName must be on the disposable allowlist (literally classlite_test).
	DatabaseName string
	// SentinelPresent asserts a __disposable_fixture_db__ object a prod DB can
	// never contain exists.
	SentinelPresent bool
	// OptIn is the explicit human/CI opt-in (ALLOW_DESTRUCTIVE_RESET=1 / APP_ENV ∈ {dev,test}).
	OptIn bool
}

// DestructiveReset wipes all application data from opts.Pool, but ONLY when the
// target PROVES it is disposable via all three positive assertions. It returns a
// non-nil error (and deletes nothing) otherwise — it fails CLOSED, never open.
// This is the inversion of "refuse a prod-shaped URL" (an allowlist pretending
// to be a denylist that fails open the first time staging looks local-ish).
func DestructiveReset(ctx context.Context, opts DestructiveOptions) error {
	if !disposableDBAllowlist[opts.DatabaseName] {
		return fmt.Errorf("destructive reset refused: database %q is not a proven-disposable target (DD13)", opts.DatabaseName)
	}
	if !opts.SentinelPresent {
		return fmt.Errorf("destructive reset refused: disposable sentinel object absent — target is not proven disposable (DD13)")
	}
	if !opts.OptIn {
		return fmt.Errorf("destructive reset refused: explicit opt-in (ALLOW_DESTRUCTIVE_RESET=1 / APP_ENV∈{dev,test}) not set (DD13)")
	}
	if opts.Pool == nil {
		// Guard satisfied but no connection to act on — nothing to wipe.
		return nil
	}
	return truncateAllAppTables(ctx, opts.Pool)
}

// truncateAllAppTables TRUNCATEs every base table in the public schema except
// the migration bookkeeping table, discovered dynamically so no hardcoded list
// can drift. CASCADE handles FK order; RESTART IDENTITY resets sequences.
func truncateAllAppTables(ctx context.Context, pool *pgxpool.Pool) error {
	rows, err := pool.Query(ctx,
		`SELECT tablename FROM pg_tables
		  WHERE schemaname = 'public' AND tablename <> 'schema_migrations'
		  ORDER BY tablename`)
	if err != nil {
		return fmt.Errorf("destructive reset: list tables: %w", err)
	}
	var tables []string
	for rows.Next() {
		var t string
		if err := rows.Scan(&t); err != nil {
			rows.Close()
			return fmt.Errorf("destructive reset: scan table: %w", err)
		}
		tables = append(tables, `public.`+quoteIdent(t))
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return fmt.Errorf("destructive reset: iterate tables: %w", err)
	}
	if len(tables) == 0 {
		return nil
	}
	if _, err := pool.Exec(ctx,
		`TRUNCATE TABLE `+strings.Join(tables, ", ")+` RESTART IDENTITY CASCADE`); err != nil {
		return fmt.Errorf("destructive reset: truncate: %w", err)
	}
	return nil
}

// Reset removes one tenant's data via a superuser cascade scoped by center_id,
// leaving every other tenant byte-identical (AC3/DD5). grades is append-only
// with UPDATE/DELETE revoked from classlite_app, so the delete MUST run as a
// superuser — the passed seed pool (often the app role) cannot delete grades.
// The superuser pool is derived from the SAME database seedPool writes to (same
// host/port/database, superuser credentials only) so the destructive cascade can
// never target a divergent database (see superuserPoolForSeed).
func Reset(ctx context.Context, seedPool *pgxpool.Pool, centerID pgtype.UUID) error {
	sp, err := superuserPoolForSeed(ctx, seedPool)
	if err != nil {
		return err
	}
	defer sp.Close()

	idStr := uuidStr(centerID)

	// Collect this center's member user ids before the cascade removes the
	// center_members rows (users are GLOBAL — not cascaded by the center delete).
	var userIDs []string
	rows, err := sp.Query(ctx, `SELECT user_id::text FROM center_members WHERE center_id=$1`, centerID)
	if err != nil {
		return fmt.Errorf("reset %s: list members: %w", idStr, err)
	}
	for rows.Next() {
		var uid string
		if err := rows.Scan(&uid); err != nil {
			rows.Close()
			return fmt.Errorf("reset %s: scan member: %w", idStr, err)
		}
		userIDs = append(userIDs, uid)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return fmt.Errorf("reset %s: iterate members: %w", idStr, err)
	}

	// Delete the ON DELETE RESTRICT / NO ACTION chain before the center delete can
	// cascade the rest (classes/enrollments/exercises/assignments/attendance/files/…
	// via ON DELETE CASCADE). Order matters: auto_grade_results RESTRICT-references
	// both submissions and centers, grades RESTRICT-references submissions, and
	// invites/center_members reference centers with NO ACTION — all must go first.
	// The seed itself creates none of auto_grade_results/invites, but Reset is also
	// the repo-wide residue teardown (clearSeedTenants), where a crashed test may
	// have left committed rows under these tenants; deleting them is a safe no-op
	// otherwise. audit_logs/notifications stay empty (store-only seed, DD1).
	for _, stmt := range []string{
		`DELETE FROM auto_grade_results WHERE center_id=$1`,
		`DELETE FROM grades WHERE center_id=$1`,
		`DELETE FROM submissions WHERE center_id=$1`,
		`DELETE FROM sessions WHERE center_id=$1`,
		`DELETE FROM invites WHERE center_id=$1`,
		`DELETE FROM center_members WHERE center_id=$1`,
		`DELETE FROM centers WHERE id=$1`,
	} {
		if _, err := sp.Exec(ctx, stmt, centerID); err != nil {
			return fmt.Errorf("reset %s: %q: %w", idStr, firstLine(stmt), err)
		}
	}

	// Remove the (global) seed users this center owned.
	if len(userIDs) > 0 {
		if _, err := sp.Exec(ctx, `DELETE FROM users WHERE id = ANY($1::uuid[])`, userIDs); err != nil {
			return fmt.Errorf("reset %s: delete member users: %w", idStr, err)
		}
	}
	return nil
}

// superuserPoolForSeed opens a short-lived RLS-bypassing superuser pool that
// targets the SAME database the seed pool writes to. grades/auto_grade_results
// have UPDATE/DELETE revoked from classlite_app, so the per-tenant Reset cascade
// must run as a superuser — but it must NEVER target a different database than the
// one being seeded. We clone the seed pool's config (host/port/database) and swap
// in only the superuser credentials; a mismatched MIGRATION_DATABASE_URL can no
// longer silently redirect the destructive cascade at the wrong DB, which the old
// MIGRATION_DATABASE_URL → DATABASE_URL → hardcoded-localhost fallback allowed.
func superuserPoolForSeed(ctx context.Context, seedPool *pgxpool.Pool) (*pgxpool.Pool, error) {
	if seedPool == nil {
		return nil, fmt.Errorf("reset: seed pool is nil")
	}
	poolCfg := seedPool.Config().Copy()

	// Superuser credentials come from MIGRATION_DATABASE_URL when set (CI, or an
	// app-role DATABASE_URL); otherwise the seed pool's own credentials are reused
	// (local dev connects as the superuser). No hardcoded default — an unparseable
	// MIGRATION_DATABASE_URL is a loud error, never a silent fallback target.
	if raw := os.Getenv("MIGRATION_DATABASE_URL"); raw != "" {
		su, err := pgx.ParseConfig(raw)
		if err != nil {
			return nil, fmt.Errorf("reset: parse MIGRATION_DATABASE_URL: %w", err)
		}
		poolCfg.ConnConfig.User = su.User
		poolCfg.ConnConfig.Password = su.Password
	}

	sp, err := pgxpool.NewWithConfig(ctx, poolCfg)
	if err != nil {
		return nil, fmt.Errorf("reset: open superuser pool: %w", err)
	}

	// Prove the destructive cascade targets the database being seeded.
	var dbName string
	if err := sp.QueryRow(ctx, `SELECT current_database()`).Scan(&dbName); err != nil {
		sp.Close()
		return nil, fmt.Errorf("reset: verify superuser target database: %w", err)
	}
	if dbName != poolCfg.ConnConfig.Database {
		sp.Close()
		return nil, fmt.Errorf("reset: superuser pool connected to %q but the seed target is %q — refusing to reset a divergent database", dbName, poolCfg.ConnConfig.Database)
	}
	return sp, nil
}

// quoteIdent double-quotes a SQL identifier, escaping embedded quotes.
func quoteIdent(s string) string {
	return `"` + strings.ReplaceAll(s, `"`, `""`) + `"`
}
