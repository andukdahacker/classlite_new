// seed_destructive_guard_atdd_test.go — Story 11-1a ATDD (AC5 ·
// R-11-4 score 6 · Mary · DD13). The destructive dev-DB reset guard is
// POSITIVE-PROOF, NOT prod-shape URL detection.
//
// "Refuses a prod-shaped URL" is an allowlist pretending to be a denylist; it
// fails OPEN the first time staging looks local-ish or a tunnel maps prod to
// localhost. Invert it: the target must PROVE it is disposable before any
// destructive op — ALL THREE positive assertions about the TARGET:
//   (1) the database name is literally classlite_test (or an explicit test allowlist),
//   (2) a sentinel object exists (a __disposable_fixture_db__ table/row prod can never contain),
//   (3) an explicit opt-in is set (ALLOW_DESTRUCTIVE_RESET=1 / APP_ENV in {dev,test}).
// A prod DB cannot grow a sentinel; a staging DB that "looks local" has none and
// is refused. Abort non-zero otherwise.
//
// RED: `//go:build atdd_red_phase`; compile-fails on the GREENFIELD internal/seed
// seams (DestructiveReset, DestructiveOptions).
//
// GREEN SEAMS (dev — Task 5):
//
//	seed.DestructiveOptions{ Pool *pgxpool.Pool, DatabaseName string,
//	                         SentinelPresent bool, OptIn bool }
//	seed.DestructiveReset(ctx, opts seed.DestructiveOptions) error
//	  — returns a non-nil error (no deletion) UNLESS all three proofs hold.
package test

import (
	"context"
	"testing"

	"github.com/ducdo/classlite-api/internal/seed"
)

// AC5 — the guard refuses UNLESS all three positive proofs hold; it is not a
// prod-shape denylist.
func TestDestructiveReset_RequiresAllThreePositiveProofs(t *testing.T) {
	ctx := context.Background()

	cases := []struct {
		name    string
		opts    seed.DestructiveOptions
		wantErr bool
	}{
		{
			name:    "all three proofs present → proceeds",
			opts:    seed.DestructiveOptions{DatabaseName: "classlite_test", SentinelPresent: true, OptIn: true},
			wantErr: false,
		},
		{
			name:    "missing db-name proof (prod-named) → refused",
			opts:    seed.DestructiveOptions{DatabaseName: "classlite_prod", SentinelPresent: true, OptIn: true},
			wantErr: true,
		},
		{
			name:    "missing sentinel object → refused (staging that LOOKS local has none)",
			opts:    seed.DestructiveOptions{DatabaseName: "classlite_test", SentinelPresent: false, OptIn: true},
			wantErr: true,
		},
		{
			name:    "missing explicit opt-in → refused",
			opts:    seed.DestructiveOptions{DatabaseName: "classlite_test", SentinelPresent: true, OptIn: false},
			wantErr: true,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := seed.DestructiveReset(ctx, tc.opts)
			if tc.wantErr && err == nil {
				t.Errorf("DestructiveReset should have REFUSED (non-zero) but returned nil — fails open (DD13)")
			}
			if !tc.wantErr && err != nil {
				t.Errorf("DestructiveReset should have proceeded on a proven-disposable target, got: %v", err)
			}
		})
	}
}
