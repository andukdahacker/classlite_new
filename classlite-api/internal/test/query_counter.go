// Story 8.1a — R31/PERF-2 KEYSTONE query-count harness (D7(1)). The reusable infra
// Stories 8.2 & 8.4 inherit (test-design-architecture R31 item #5: "a hook used in
// EVERY service-layer test").
//
// COUNTING BOUNDARY = the tx the SERVICE runs on, NOT the pool (party-mode BLOCKER,
// Winston+Murat). A DashboardService does `tx,_ := s.db.Begin(ctx); q := generated.New(tx)`
// — every business query runs on that tx. A decorator wrapping only the pool /
// TxDB.Exec sees ZERO business queries (TxDB.Begin returns the raw nested pgx.Tx),
// so "≤N" would false-pass. NewCountingDBTX therefore wraps the AuthDB the service
// holds; its Begin() hands back a pgx.Tx whose Exec/Query/QueryRow increment a
// business-query counter, FILTERING tx plumbing (BEGIN/SAVEPOINT/SET LOCAL/RELEASE/
// COMMIT/ROLLBACK). Net count = the sqlc business queries only.
//
// N is documented per role as "1 (the SET LOCAL app.current_tenant_id Exec) + k
// sqlc calls"; SET LOCAL is filtered here, so the asserted count is the k sqlc
// calls. sqlc pgx-v5 emits exactly one Exec/Query/QueryRow per generated method
// (no implicit batching) → "≤N" is a stable, meaningful O(1)-in-rows bound.
package test

import (
	"context"
	"strings"
	"sync"

	"github.com/ducdo/classlite-api/internal/service"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// CountingDBTX wraps a service.AuthDB and counts the business queries issued on the
// tx its Begin() returns. It satisfies service.AuthDB so it can stand in wherever a
// service takes its db (NewDashboardService(counter, clk)).
type CountingDBTX struct {
	inner service.AuthDB
	mu    sync.Mutex
	n     int
}

// NewCountingDBTX wraps inner (a *TxDB / *pgxpool.Pool — anything AuthDB and the
// service accept). Counting happens on the tx returned by Begin, not on inner.
func NewCountingDBTX(inner service.AuthDB) *CountingDBTX {
	return &CountingDBTX{inner: inner}
}

// Begin returns a counting pgx.Tx: every Exec/Query/QueryRow on it increments the
// business-query counter unless the statement is tx plumbing.
func (c *CountingDBTX) Begin(ctx context.Context) (pgx.Tx, error) {
	tx, err := c.inner.Begin(ctx)
	if err != nil {
		return nil, err
	}
	return &countingTx{Tx: tx, parent: c}, nil
}

// Exec/Query/QueryRow satisfy generated.DBTX (via service.AuthDB). The service
// always Begins first, so these top-level calls are not on the counted path; they
// delegate to inner without counting.
func (c *CountingDBTX) Exec(ctx context.Context, sql string, args ...interface{}) (pgconn.CommandTag, error) {
	return c.inner.Exec(ctx, sql, args...)
}

func (c *CountingDBTX) Query(ctx context.Context, sql string, args ...interface{}) (pgx.Rows, error) {
	return c.inner.Query(ctx, sql, args...)
}

func (c *CountingDBTX) QueryRow(ctx context.Context, sql string, args ...interface{}) pgx.Row {
	return c.inner.QueryRow(ctx, sql, args...)
}

// Count returns the business queries counted since the last Reset.
func (c *CountingDBTX) Count() int {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.n
}

// Reset zeroes the counter.
func (c *CountingDBTX) Reset() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.n = 0
}

func (c *CountingDBTX) record(sql string) {
	if isTxPlumbing(sql) {
		return
	}
	c.mu.Lock()
	c.n++
	c.mu.Unlock()
}

// countingTx decorates a pgx.Tx, counting each business statement on the parent.
// Embedding delegates Commit/Rollback/Conn/CopyFrom/SendBatch/LargeObjects/Prepare/
// Begin (savepoint) to the inner tx unchanged.
type countingTx struct {
	pgx.Tx
	parent *CountingDBTX
}

func (t *countingTx) Exec(ctx context.Context, sql string, args ...interface{}) (pgconn.CommandTag, error) {
	t.parent.record(sql)
	return t.Tx.Exec(ctx, sql, args...)
}

func (t *countingTx) Query(ctx context.Context, sql string, args ...interface{}) (pgx.Rows, error) {
	t.parent.record(sql)
	return t.Tx.Query(ctx, sql, args...)
}

func (t *countingTx) QueryRow(ctx context.Context, sql string, args ...interface{}) pgx.Row {
	t.parent.record(sql)
	return t.Tx.QueryRow(ctx, sql, args...)
}

// isTxPlumbing reports whether sql is transaction plumbing (not a business query):
// BEGIN/COMMIT/ROLLBACK/SAVEPOINT/RELEASE and the SET LOCAL app.current_tenant_id
// Exec. sqlc statements start with SELECT/INSERT/UPDATE/DELETE/WITH and are counted.
func isTxPlumbing(sql string) bool {
	s := strings.ToUpper(strings.TrimSpace(sql))
	for _, prefix := range []string{"BEGIN", "COMMIT", "ROLLBACK", "SAVEPOINT", "RELEASE", "SET "} {
		if strings.HasPrefix(s, prefix) {
			return true
		}
	}
	return false
}
