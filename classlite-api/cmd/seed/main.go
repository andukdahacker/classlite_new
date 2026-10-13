// Command seed builds the deterministic, idempotent, confessed-synthetic
// Epics 1–8 dataset (Story 11-1a) and emits the e2e credentials file. It is the
// Go entry point scripts/seed.sh and dev.sh --seed delegate to (DD1): a
// migration would ship to prod (R-11-4) and be immutable; bash+psql cannot do
// bcrypt / JSONB / FK ordering / RLS windows cleanly.
//
// Usage:
//
//	go run ./cmd/seed                 # clean seed + write credentials.json
//	go run ./cmd/seed -clean=false    # idempotent upsert (no reset first)
//	go run ./cmd/seed -destructive    # positive-proof-guarded full wipe (DD13)
package main

import (
	"context"
	"flag"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"

	"github.com/ducdo/classlite-api/internal/seed"
	"github.com/ducdo/classlite-api/internal/store"
	"github.com/jackc/pgx/v5/pgxpool"
)

func main() {
	clean := flag.Bool("clean", true, "reset the deterministic tenants before seeding")
	destructive := flag.Bool("destructive", false, "wipe ALL app data (positive-proof guarded; DD13)")
	flag.Parse()

	if err := run(*clean, *destructive); err != nil {
		slog.Error("seed failed", "error", err)
		os.Exit(1)
	}
}

func run(clean, destructive bool) error {
	ctx := context.Background()
	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		return fmt.Errorf("DATABASE_URL not set")
	}
	pool, err := store.NewPool(ctx, databaseURL)
	if err != nil {
		return err
	}
	defer pool.Close()

	if destructive {
		return runDestructive(ctx, pool)
	}

	result, err := seed.Run(ctx, pool, seed.Options{Clean: clean})
	if err != nil {
		return err
	}

	root, err := seed.FindRepoRoot()
	if err != nil {
		return err
	}
	credPath := filepath.Join(root, seed.DefaultCredentialsPath)
	if err := seed.WriteCredentials(result, credPath); err != nil {
		return err
	}
	slog.Info("seed complete",
		"tenants", len(result.Centers),
		"credentials", credPath)
	return nil
}

// runDestructive gathers the three DD13 positive proofs about the connected
// target and delegates to seed.DestructiveReset, which fails closed unless all
// three hold. Opt-in is ALLOW_DESTRUCTIVE_RESET=1 or APP_ENV ∈ {dev,test}.
func runDestructive(ctx context.Context, pool *pgxpool.Pool) error {
	dbName, err := seed.CurrentDatabase(ctx, pool)
	if err != nil {
		return err
	}
	sentinel, err := seed.HasSentinel(ctx, pool)
	if err != nil {
		return err
	}
	optIn := os.Getenv("ALLOW_DESTRUCTIVE_RESET") == "1" ||
		os.Getenv("APP_ENV") == "dev" || os.Getenv("APP_ENV") == "test"

	if err := seed.DestructiveReset(ctx, seed.DestructiveOptions{
		Pool:            pool,
		DatabaseName:    dbName,
		SentinelPresent: sentinel,
		OptIn:           optIn,
	}); err != nil {
		return err
	}
	slog.Warn("destructive reset complete — all app data wiped", "database", dbName)
	return nil
}
