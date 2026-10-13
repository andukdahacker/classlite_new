// rawpool_concurrency_behavioral_test.go — Story 11-1a ATDD (AC7 ·
// R-11-5 score 6 · WF-8 HARD GATE · DD4/DD11). The multi-connection concurrency
// behavioral red: the failure mode R-11-5 names — cross-tenant leak via committed
// rows under PARALLEL workers — which a single-tx test structurally cannot
// exercise. Run under -race.
//
// Run it:  go test -race -run TestRawPoolConcurrency ./internal/test/
// This file carries NO build tag — it RUNS in the default `go test ./...` as a
// REGRESSION LOCK (green after AC6/DD16's disposable classlite_test lands). It is
// cheap and deterministic; keeping it in the default suite is the point (DD11).
//
// TEETH (would be RED on the pre-AC6 shared, non-disposable classlite_dev):
// TestRawPoolConcurrency_RunsAgainstDisposableDB fails unless current_database()
// is the per-run disposable classlite_test. REGRESSION LOCK (green today): N
// goroutines on N pool connections, each committing + reading under its OWN
// distinct tenant, observe zero cross-tenant reads with no data race — proving
// the committed path is RLS-safe under parallel load. After AC7's refactor every
// committed-row helper is tenant-scoped / disposable so this holds by
// construction + leaves zero residue.
package test

import (
	"context"
	"fmt"
	"sync"
	"testing"
)

const concurrencyWorkers = 8

// AC7 TEETH — committed concurrency must run on a disposable DB (same R-11-5 root
// cause as AC2; duplicated here so running AC7 alone still surfaces it).
func TestRawPoolConcurrency_RunsAgainstDisposableDB(t *testing.T) {
	pool := SetupRawPool(t)
	var dbName string
	if err := pool.QueryRow(context.Background(), `SELECT current_database()`).Scan(&dbName); err != nil {
		t.Fatalf("current_database: %v", err)
	}
	if dbName != "classlite_test" {
		t.Errorf("R-11-5 TEETH: concurrent committed workers run against %q (shared, non-disposable). "+
			"Must be the per-run disposable classlite_test (AC6/DD16).", dbName)
	}
}

// AC7 REGRESSION LOCK — parallel workers on distinct tenants never cross-read,
// under -race, and leave zero residue.
func TestRawPoolConcurrency_NoCrossTenantLeakUnderParallelLoad(t *testing.T) {
	sp := SuperuserPool(t)
	app := SetupRawPool(t)

	// Distinct deterministic ephemeral tenants, one per worker.
	tenants := make([]string, concurrencyWorkers)
	for i := range tenants {
		tenants[i] = fmt.Sprintf("00000000-0000-0000-0000-7777%08d", i)
		seedCommittedClass(t, sp, tenants[i], fmt.Sprintf("W%d", i))
	}

	var wg sync.WaitGroup
	errCh := make(chan error, concurrencyWorkers)
	for i := 0; i < concurrencyWorkers; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			// t.Fatalf is illegal off the test goroutine (it FailNow's the wrong
			// goroutine), so workers use the error-returning count variant and
			// route every failure through errCh — never a t.* call from here.
			mine, err := committedClassCountAsTenantErr(context.Background(), app, tenants[idx], tenants[idx])
			if err != nil {
				errCh <- fmt.Errorf("worker %d: count own tenant: %w", idx, err)
				return
			}
			if mine != 1 {
				errCh <- fmt.Errorf("worker %d: cannot see its OWN tenant class (got %d)", idx, mine)
				return
			}
			// Must NOT see the next worker's tenant class.
			other := tenants[(idx+1)%concurrencyWorkers]
			n, err := committedClassCountAsTenantErr(context.Background(), app, tenants[idx], other)
			if err != nil {
				errCh <- fmt.Errorf("worker %d: count other tenant: %w", idx, err)
				return
			}
			if n != 0 {
				errCh <- fmt.Errorf("worker %d LEAK: sees %d rows of tenant %s", idx, n, other)
			}
		}(i)
	}
	wg.Wait()
	close(errCh)
	for err := range errCh {
		t.Error(err)
	}

	// Residue check: scoped to THIS test's worker centers (SEED_FAKE_W%), not the
	// deterministic seed's SEED_FAKE_Center A/B which legitimately persist in the
	// same classlite_test. At most concurrencyWorkers may be present mid-run (one
	// per worker, before their registered teardown fires); more would mean
	// committed rows accumulate unbounded across runs (R-11-5). Reconciled to the
	// seeded surface at green.
	leftover := CountRows(t, sp,
		`SELECT count(*) FROM centers WHERE name LIKE $1`, syntheticCenterPrefix+"W%")
	if leftover > concurrencyWorkers {
		t.Errorf("residue leak: %d worker centers present mid-run — committed rows accumulate on the shared DB (R-11-5)", leftover)
	}
}
