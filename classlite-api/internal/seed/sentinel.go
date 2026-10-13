package seed

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
)

// SentinelTable is the disposable-DB sentinel object (DD13 proof #2). It is
// planted ONLY on a disposable test database (by EnsureTestDB); a production
// database can never grow it, so its presence is a positive proof that a
// destructive op is safe.
const SentinelTable = "__disposable_fixture_db__"

// InstallSentinel idempotently creates the disposable-DB sentinel. Call it only
// against a database you intend to mark disposable (the test DB lifecycle).
func InstallSentinel(ctx context.Context, pool *pgxpool.Pool) error {
	if _, err := pool.Exec(ctx,
		`CREATE TABLE IF NOT EXISTS `+quoteIdent(SentinelTable)+` (marker text NOT NULL DEFAULT 'disposable')`); err != nil {
		return fmt.Errorf("install disposable sentinel: %w", err)
	}
	return nil
}

// HasSentinel reports whether the disposable-DB sentinel object exists.
func HasSentinel(ctx context.Context, pool *pgxpool.Pool) (bool, error) {
	var present bool
	if err := pool.QueryRow(ctx,
		`SELECT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename=$1)`,
		SentinelTable).Scan(&present); err != nil {
		return false, fmt.Errorf("check disposable sentinel: %w", err)
	}
	return present, nil
}

// CurrentDatabase returns the name of the database pool is connected to.
func CurrentDatabase(ctx context.Context, pool *pgxpool.Pool) (string, error) {
	var name string
	if err := pool.QueryRow(ctx, `SELECT current_database()`).Scan(&name); err != nil {
		return "", fmt.Errorf("current database: %w", err)
	}
	return name, nil
}
