package test

import (
	"context"
	"fmt"
	"os"
	"testing"
)

// TestMain owns the test-DB lifecycle for the internal/test package (Story
// 11-1a / AC6 / DD16a): it ensures the disposable classlite_test database exists
// and is migrated by the non-superuser migrator, and points the suite's env at
// it, BEFORE any test calls getPool. Running the ensure here (not only in CI
// yaml) keeps local == CI.
func TestMain(m *testing.M) {
	if err := EnsureTestDB(); err != nil {
		fmt.Fprintf(os.Stderr, "TestMain: ensure test db failed: %v\n", err)
		os.Exit(1)
	}
	// Start from a clean slate: clear any committed seed residue from a prior
	// run so the rollback-based RLS fixtures (which reuse TenantAID/BID) do not
	// collide on centers_pkey.
	if err := clearSeedTenants(context.Background()); err != nil {
		fmt.Fprintf(os.Stderr, "TestMain: clear seed tenants failed: %v\n", err)
		os.Exit(1)
	}
	os.Exit(m.Run())
}
