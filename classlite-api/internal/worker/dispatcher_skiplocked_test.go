// Story 4.3a — green-phase concurrency companion (out of the ATDD gate). Proves
// ClaimNextJob's SELECT … FOR UPDATE SKIP LOCKED gives two concurrent workers
// DISJOINT rows: no job is ever claimed twice. Needs committed rows + real
// concurrent connections, so it uses SetupRawPool (not the single-tx harness).
package worker_test

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/ducdo/classlite-api/internal/store/generated"
	testpkg "github.com/ducdo/classlite-api/internal/test"
)

func TestClaimNextJob_SkipLockedDisjoint(t *testing.T) {
	pool := testpkg.SetupRawPool(t)
	sp := testpkg.SuperuserPool(t)
	ctx := context.Background()

	// Seed a committed center + two pending jobs (superuser bypasses RLS).
	centerID := uuid.New()
	if _, err := sp.Exec(ctx,
		`INSERT INTO centers (id, name, short_code) VALUES ($1, $2, $3)`,
		centerID, "SkipLocked", "skl-"+centerID.String()[:6],
	); err != nil {
		t.Fatalf("seed center: %v", err)
	}
	job1, job2 := uuid.New(), uuid.New()
	for _, j := range []uuid.UUID{job1, job2} {
		if _, err := sp.Exec(ctx,
			`INSERT INTO jobs (id, center_id, type, status, params, params_schema_version)
			 VALUES ($1, $2, 'ai_generate_section', 'pending', '{}'::jsonb, 1)`,
			j, centerID,
		); err != nil {
			t.Fatalf("seed job: %v", err)
		}
	}
	t.Cleanup(func() {
		_, _ = sp.Exec(ctx, `DELETE FROM jobs WHERE center_id = $1`, centerID)
		_, _ = sp.Exec(ctx, `DELETE FROM centers WHERE id = $1`, centerID)
	})

	// Future clock so both jobs are unconditionally ready to claim.
	now := pgtype.Timestamptz{Time: time.Now().Add(time.Hour), Valid: true}

	type result struct {
		id  uuid.UUID
		err error
	}
	results := make(chan result, 2)
	start := make(chan struct{})
	var wg sync.WaitGroup

	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			tx, err := pool.Begin(ctx)
			if err != nil {
				results <- result{err: err}
				return
			}
			defer func() { _ = tx.Rollback(ctx) }() // undo the 'processing' mark
			if _, err := tx.Exec(ctx, `SELECT set_config('app.current_tenant_id', $1, true)`, centerID.String()); err != nil {
				results <- result{err: err}
				return
			}
			<-start // release both goroutines together
			job, err := generated.New(tx).ClaimNextJob(ctx, now)
			if err != nil {
				results <- result{err: err}
				return
			}
			results <- result{id: uuid.UUID(job.ID.Bytes)}
			// Hold the row lock while the sibling claims, forcing it to SKIP.
			time.Sleep(100 * time.Millisecond)
		}()
	}
	close(start)
	wg.Wait()
	close(results)

	claimed := map[uuid.UUID]bool{}
	for r := range results {
		if r.err != nil {
			t.Fatalf("concurrent claim errored: %v", r.err)
		}
		if claimed[r.id] {
			t.Fatalf("SKIP LOCKED VIOLATION: job %s was claimed by BOTH workers", r.id)
		}
		claimed[r.id] = true
	}
	if !claimed[job1] || !claimed[job2] || len(claimed) != 2 {
		t.Fatalf("expected the two seeded jobs claimed disjointly, got %v", claimed)
	}
}
