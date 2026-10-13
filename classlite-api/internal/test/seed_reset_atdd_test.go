// seed_reset_atdd_test.go — Story 11-1a ATDD (AC3 · DD5). Per-tenant
// reset leaves OTHER tenants byte-identical.
//
// reset(centerID) is the PurgeUserAndOwnedCenters cascade scoped to ONE center
// (superuser cascade), and is itself subject to the DD13 positive-proof guard
// (cannot run against a non-disposable target). The proof that it is correctly
// scoped is the OTHER tenant's content hash being unchanged — not merely "A has
// fewer rows".
//
// RED: `//go:build atdd_red_phase`; compile-fails on the GREENFIELD
// internal/seed seams (Run, Reset, ContentHash).
//
// GREEN SEAMS (dev — Task 5):
//
//	seed.Reset(ctx, pool, centerID pgtype.UUID) error
//	  — superuser cascade scoped by center_id (the PurgeUserAndOwnedCenters +
//	    prePurgeHooks pattern, one center); leaves all other centers untouched.
package test

import (
	"context"
	"testing"

	"github.com/ducdo/classlite-api/internal/seed"
)

// AC3 — reset(A) removes A and leaves B's content hash byte-identical.
func TestReset_LeavesOtherTenantByteIdentical(t *testing.T) {
	cleanupSeedTenants(t)
	pool := SetupRawPool(t)
	ctx := context.Background()
	if _, err := seed.Run(ctx, pool, seed.Options{Clean: true}); err != nil {
		t.Fatalf("seed run: %v", err)
	}

	centerA := mustPgUUID(t, seed.CenterAID)
	centerB := mustPgUUID(t, seed.CenterBID)

	hashBBefore, err := seed.ContentHash(ctx, pool, centerB)
	if err != nil {
		t.Fatalf("content hash B before: %v", err)
	}

	if err := seed.Reset(ctx, pool, centerA); err != nil {
		t.Fatalf("reset A: %v", err)
	}

	// A is gone.
	if n := CountRows(t, SuperuserPool(t),
		`SELECT count(*) FROM center_members WHERE center_id=$1`, seed.CenterAID); n != 0 {
		t.Errorf("reset(A) left %d A rows behind", n)
	}
	// B is byte-identical.
	hashBAfter, err := seed.ContentHash(ctx, pool, centerB)
	if err != nil {
		t.Fatalf("content hash B after: %v", err)
	}
	if hashBBefore != hashBAfter {
		t.Errorf("reset(A) mutated tenant B: hash %s -> %s (DD5 violation)", hashBBefore, hashBAfter)
	}
}
