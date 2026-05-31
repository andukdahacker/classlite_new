package store

import (
	"context"
	"fmt"

	"github.com/ducdo/classlite-api/internal/model"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// NewPool creates a pgx v5 connection pool from a database URL.
func NewPool(ctx context.Context, databaseURL string) (*pgxpool.Pool, error) {
	if databaseURL == "" {
		return nil, fmt.Errorf("database URL is required")
	}

	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		return nil, fmt.Errorf("create connection pool: %w", err)
	}

	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("ping database: %w", err)
	}

	return pool, nil
}

// SetTenantContext executes SET LOCAL app.current_tenant_id within a transaction.
// This MUST be called within an active transaction — SET LOCAL has no effect outside one (PERF-1).
// Uses parameterized query to prevent SQL injection.
func SetTenantContext(ctx context.Context, tx pgx.Tx, tc model.TenantContext) error {
	if tx == nil {
		return fmt.Errorf("set tenant context: tx is nil")
	}
	if tc.CenterID == "" {
		return fmt.Errorf("set tenant context: center_id is required")
	}
	_, err := tx.Exec(ctx, "SET LOCAL app.current_tenant_id = $1", tc.CenterID)
	if err != nil {
		return fmt.Errorf("set tenant context: %w", err)
	}
	return nil
}
