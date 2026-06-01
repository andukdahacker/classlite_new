// Package test provides test helpers for integration tests.
// SetupDB returns a transaction-wrapped DB; TenantContext sets RLS context.
package test

import (
	"context"
	"fmt"
	"os"
	"sync"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

// DBTX matches the sqlc-generated interface so both pool and tx satisfy it.
type DBTX interface {
	Exec(context.Context, string, ...interface{}) (pgconn.CommandTag, error)
	Query(context.Context, string, ...interface{}) (pgx.Rows, error)
	QueryRow(context.Context, string, ...interface{}) pgx.Row
}

// TxDB wraps a pgx.Tx to satisfy pgxpool.Pool-like usage in tests.
// It also provides Begin() that returns a savepoint (nested transaction).
type TxDB struct {
	Tx pgx.Tx
}

func (d *TxDB) Exec(ctx context.Context, sql string, args ...interface{}) (pgconn.CommandTag, error) {
	return d.Tx.Exec(ctx, sql, args...)
}

func (d *TxDB) Query(ctx context.Context, sql string, args ...interface{}) (pgx.Rows, error) {
	return d.Tx.Query(ctx, sql, args...)
}

func (d *TxDB) QueryRow(ctx context.Context, sql string, args ...interface{}) pgx.Row {
	return d.Tx.QueryRow(ctx, sql, args...)
}

// Begin returns a savepoint-based nested transaction.
func (d *TxDB) Begin(ctx context.Context) (pgx.Tx, error) {
	return d.Tx.Begin(ctx)
}

var (
	pool     *pgxpool.Pool
	poolOnce sync.Once
	poolErr  error
)

func getPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	poolOnce.Do(func() {
		databaseURL := os.Getenv("DATABASE_URL")
		if databaseURL == "" {
			// Default to non-superuser role so RLS is enforced in tests.
			databaseURL = "postgres://classlite_app:classlite_dev_password@localhost:5432/classlite_dev?sslmode=disable"
		}
		pool, poolErr = pgxpool.New(context.Background(), databaseURL)
	})
	if poolErr != nil {
		t.Fatalf("connect to test database: %v", poolErr)
	}
	return pool
}

// SetupDB returns a transaction-wrapped DB handle. The transaction is
// automatically rolled back via t.Cleanup, so each test gets a clean slate
// without mutating the database.
func SetupDB(t *testing.T) *TxDB {
	t.Helper()

	p := getPool(t)
	tx, err := p.Begin(context.Background())
	if err != nil {
		t.Fatalf("begin test transaction: %v", err)
	}

	// Switch to non-superuser role so RLS policies are enforced.
	// Superusers bypass RLS even with FORCE ROW LEVEL SECURITY.
	_, err = tx.Exec(context.Background(), "SET LOCAL ROLE classlite_app")
	if err != nil {
		_ = tx.Rollback(context.Background())
		t.Fatalf("set role classlite_app: %v", err)
	}

	t.Cleanup(func() {
		_ = tx.Rollback(context.Background())
	})

	return &TxDB{Tx: tx}
}

// UUIDString converts a pgtype.UUID to its string representation.
func UUIDString(u pgtype.UUID) string {
	b := u.Bytes
	return fmt.Sprintf("%08x-%04x-%04x-%04x-%012x",
		b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}

// TenantContext executes SET LOCAL app.current_tenant_id within the test
// transaction and returns a context. This sets RLS context for subsequent queries.
// SET does not support parameterized queries — UUID format validation prevents injection.
func TenantContext(t *testing.T, db *TxDB, centerID pgtype.UUID) context.Context {
	t.Helper()

	ctx := context.Background()
	idStr := UUIDString(centerID)
	_, err := db.Tx.Exec(ctx, fmt.Sprintf("SET LOCAL app.current_tenant_id = '%s'", idStr))
	if err != nil {
		t.Fatalf("set tenant context for %s: %v", idStr, err)
	}
	return ctx
}
