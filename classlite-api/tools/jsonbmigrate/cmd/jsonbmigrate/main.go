// Command jsonbmigrate is the Story 4.5 operator batch tool that upgrades a
// column-versioned JSONB entity's rows to the current schema version. Invoke it
// via the repo-root wrapper (which resolves the superuser URL):
//
//	scripts/migrate-jsonb.sh --entity=exercises --from=1 --to=2
//
// or directly (from classlite-api/):
//
//	go run ./tools/jsonbmigrate/cmd/jsonbmigrate --entity=exercises --from=1 --to=2
//
// Connection = superuser MIGRATION_DATABASE_URL (fallback DATABASE_URL). Exits
// non-zero on any guard failure, poison row, or DB error (with ZERO writes on a
// guard failure). See package jsonbmigrate for THE GOVERNING INVARIANT.
package main

import (
	"context"
	"flag"
	"log/slog"
	"os"

	"github.com/ducdo/classlite-api/internal/store"
	"github.com/ducdo/classlite-api/tools/jsonbmigrate"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

func main() {
	entity := flag.String("entity", "", "JSONB entity to migrate (e.g. exercises)")
	from := flag.Int("from", 0, "source schema_version to sweep (>= 1)")
	to := flag.Int("to", 0, "target schema_version (must equal the entity's current version)")
	afterID := flag.String("after-id", "", "resume after this row id (keyset); default sweeps from the start")
	batchSize := flag.Int("batch-size", jsonbmigrate.DefaultBatchSize, "rows per transaction")
	flag.Parse()

	log := slog.New(slog.NewJSONHandler(os.Stderr, nil))

	url := os.Getenv("MIGRATION_DATABASE_URL")
	if url == "" {
		url = os.Getenv("DATABASE_URL")
	}
	if url == "" {
		log.Error("no database URL: set MIGRATION_DATABASE_URL (superuser) or DATABASE_URL")
		os.Exit(1)
	}

	after, err := parseAfterID(*afterID)
	if err != nil {
		log.Error("invalid --after-id", "value", *afterID, "error", err)
		os.Exit(1)
	}

	migrator, err := jsonbmigrate.Resolve(*entity)
	if err != nil {
		log.Error("resolve entity", "error", err)
		os.Exit(1)
	}

	ctx := context.Background()
	pool, err := store.NewPool(ctx, url)
	if err != nil {
		log.Error("connect", "error", err)
		os.Exit(1)
	}
	defer pool.Close()

	log.Info("starting JSONB migration",
		"entity", migrator.Name, "from", *from, "to", *to,
		"batch_size", *batchSize, "after_id", *afterID)

	migrated, skipped, err := jsonbmigrate.RunMigration(ctx, pool, migrator, *from, *to, *batchSize, after, log)
	if err != nil {
		log.Error("migration failed", "entity", migrator.Name, "migrated", migrated, "skipped", skipped, "error", err)
		os.Exit(1)
	}
	// `skipped` rows remain at --from (concurrent-skip); a non-zero count means the
	// sweep is NOT complete and must be re-run before the old rung can be dropped.
	log.Info("migration complete", "entity", migrator.Name, "from", *from, "to", *to,
		"migrated", migrated, "skipped_remaining_at_from", skipped, "fully_swept", skipped == 0)
}

// parseAfterID turns the --after-id flag into a pgtype.UUID; empty → the zero
// UUID, which sorts before every real id so the sweep starts from the beginning.
func parseAfterID(s string) (pgtype.UUID, error) {
	if s == "" {
		return pgtype.UUID{Bytes: uuid.Nil, Valid: true}, nil
	}
	parsed, err := uuid.Parse(s)
	if err != nil {
		return pgtype.UUID{}, err
	}
	return pgtype.UUID{Bytes: parsed, Valid: true}, nil
}
