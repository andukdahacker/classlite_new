package test

import (
	"context"
	"testing"
)

// cleanupSeedTenants registers a t.Cleanup that clears the committed
// deterministic seed tenants (A & B) after a seed test. Seed tests commit rows
// under the fixture tenant ids; without teardown those persist in the shared
// classlite_test and collide with the rollback-based RLS fixtures that reuse the
// same ids. This is the AC7 discipline applied to the seed tests themselves.
func cleanupSeedTenants(t *testing.T) {
	t.Helper()
	t.Cleanup(func() {
		if err := clearSeedTenants(context.Background()); err != nil {
			t.Logf("cleanup seed tenants: %v", err)
		}
	})
}
