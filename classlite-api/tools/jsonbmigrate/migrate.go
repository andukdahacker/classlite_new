// Package jsonbmigrate is the HARDENED operator batch tool for Story 4.5's JSONB
// schema-migration strategy. It sweeps rows still at an old `schema_version`,
// upgrading each through the SAME model.MigrateJSONB ladder the read path uses,
// and stamping the current version — so a schema shape can eventually drop its
// old rungs without paying lazy-upgrade cost forever.
//
// ─────────────────────────────────────────────────────────────────────────────
// THE GOVERNING INVARIANT (read before touching this tool OR the read path):
//
//	The lazy read-path ladder IS the correctness guarantee. This batch tool is an
//	OPTIMIZATION.
//
// Every row is upgraded on read through its store choke point, from its own
// stored version, with no assumption it is already current. This tool exists only
// so the system needn't pay that lazy cost forever. THEREFORE this tool is
// ALLOWED to skip rows — soft-deleted (deleted_at), freshly inserted at an old
// version, or concurrently modified (the xmin guard) — because a skipped row is
// harmless: it upgrades on its next read. A *clobbered* row is not harmless.
// NOBODY may ever "optimize" the read path by dropping the lazy upgrade because
// "the batch tool handled everything" — restored/soft-deleted rows would break
// silently. This invariant justifies the deleted_at skip and the concurrent-write
// (xmin) tolerance below.
// ─────────────────────────────────────────────────────────────────────────────
//
// Connection: this tool runs on a SUPERUSER MIGRATION_DATABASE_URL pool that
// bypasses RLS, sweeping every tenant in one pass. That is sound because every
// operation is a same-row read-modify-write keyed by id (no join, no cross-row
// copy), so RLS is not the correctness boundary — the monotonic ladder + the
// `schema_version` + `xmin` guards are. Keep the pool ephemeral to the CLI and
// the admin queries isolated; never hand either to request-serving code.
package jsonbmigrate

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/ducdo/classlite-api/internal/store"
	"github.com/ducdo/classlite-api/internal/store/generated"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

// DefaultBatchSize is the per-transaction batch size (CQ-3). One tx per batch —
// never one giant tx (long locks + WAL bloat + not resumable).
const DefaultBatchSize = 100

// MaxBatchSize caps --batch-size. A pathologically large value (e.g. 100_000_000)
// would issue one LIMIT that sweeps the whole table in a single transaction,
// collapsing the per-batch design (long row locks, WAL bloat, non-resumable) —
// exactly what batching prevents. An over-cap request is clamped to this ceiling.
const MaxBatchSize = 10_000

// txBeginner is the minimal pool surface the tool needs: begin a transaction per
// batch. Both *pgxpool.Pool (production, superuser) and *test.TxDB (tests, where
// per-batch "commits" are savepoint releases inside a rolled-back outer tx)
// satisfy it — which is what lets the batch loop be exercised in isolation.
type txBeginner interface {
	Begin(ctx context.Context) (pgx.Tx, error)
}

// MigrationRow is one row the tool reads for migration: its PK, its read-time
// xmin (the whole-row MVCC version token for the lost-update guard), the stored
// blob, and its stored version (== the `from` the row is being migrated off).
type MigrationRow struct {
	ID      pgtype.UUID
	Xmin    string
	Content []byte
	Version int
}

// EntityMigrator describes one column-versioned JSONB entity the tool can sweep.
// Register a new one when a future entity gets a versioned blob; today only
// `exercises` is live. Tests build a synthetic-v2 variant by taking
// ExercisesMigrator() and overriding CurrentVersion + Upgrade (via the store
// schema seam), reusing the real keyset/xmin SQL.
type EntityMigrator struct {
	Name           string
	CurrentVersion int
	// Upgrade decodes a stored blob at fromVersion, walks the ladder to current,
	// and returns the re-marshaled blob. It MUST fail (→ poison-row abort) on a
	// NULL/empty/undecodable blob.
	Upgrade func(raw []byte, fromVersion int) ([]byte, error)
	// ListPage reads up to limit rows at fromVersion with id > afterID, keyset
	// ordered by id (NEVER offset).
	ListPage func(ctx context.Context, q *generated.Queries, fromVersion int, afterID pgtype.UUID, limit int) ([]MigrationRow, error)
	// UpdateRow writes the upgraded blob to toVersion, guarded by the row's stored
	// version AND its read xmin, and returns rows-affected (0 = concurrent-skip).
	UpdateRow func(ctx context.Context, tx pgx.Tx, row MigrationRow, newContent []byte, toVersion int) (int64, error)
	// ValidateChain checks (without touching a row) that every rung in [from, to)
	// is registered, so RunMigration can fail a chain gap as a pre-flight config
	// error instead of a per-row poison-row abort.
	ValidateChain func(from, to int) error
}

// updateExerciseJSONBVersionSQL is the lost-update-guarded write. It is a raw
// pgx statement rather than a sqlc query because sqlc's static analyzer resolves
// the `xmin` system column in a SELECT target list but not in an UPDATE ... WHERE
// predicate (see internal/store/queries/exercise_jsonb_migration.sql). The tool
// runs on a raw pool, so this costs nothing but the typed wrapper.
//
// `updated_at` is intentionally NOT bumped: this is a background re-encode, not a
// content edit. `updated_at` is the editor's optimistic-concurrency token
// (exercises.sql: UpdateExercise `WHERE updated_at = precondition`) AND the
// library list sort key (`ORDER BY updated_at DESC`) — bumping it here would
// 409 every open editor's next autosave and reorder the library, violating the
// GOVERNING INVARIANT that the tool is a silent optimization that never disrupts
// a user. The `xmin` change (automatic on any UPDATE) is what powers the
// lost-update guard, not `updated_at`.
const updateExerciseJSONBVersionSQL = `
UPDATE exercises
SET content = $2, schema_version = $3
WHERE id = $1 AND schema_version = $4 AND xmin::text = $5`

// ExercisesMigrator builds the production exercises migrator. CurrentVersion is
// read from the store's ACTIVE schema (production = 1; a test override bumps it),
// and Upgrade is exactly the read-path decode+remarshal — so the tool and the
// lazy read path share one transform, and a poison row aborts identically.
func ExercisesMigrator() EntityMigrator {
	return EntityMigrator{
		Name:           "exercises",
		CurrentVersion: store.ActiveExerciseSchemaVersion(),
		Upgrade: func(raw []byte, fromVersion int) ([]byte, error) {
			content, err := store.UnmarshalExerciseContent(raw, fromVersion)
			if err != nil {
				return nil, err
			}
			upgraded, err := content.Marshal()
			if err != nil {
				return nil, err
			}
			// A field-adding rung can inflate a near-ceiling blob past the request-
			// path 413 cap. Refuse to write an over-cap blob (mirrors the service
			// PayloadTooLargeError guard); an over-cap row aborts the run (poison-
			// like) rather than silently landing a blob no editor could ever save.
			if len(upgraded) > store.MaxContentBytes {
				return nil, fmt.Errorf("upgraded content is %d bytes, over the %d-byte ceiling", len(upgraded), store.MaxContentBytes)
			}
			return upgraded, nil
		},
		ListPage: func(ctx context.Context, q *generated.Queries, fromVersion int, afterID pgtype.UUID, limit int) ([]MigrationRow, error) {
			rows, err := q.ListExercisesForJSONBMigration(ctx, generated.ListExercisesForJSONBMigrationParams{
				FromVersion: int32(fromVersion),
				AfterID:     afterID,
				PageLimit:   int32(limit),
			})
			if err != nil {
				return nil, err
			}
			out := make([]MigrationRow, len(rows))
			for i, r := range rows {
				out[i] = MigrationRow{ID: r.ID, Xmin: r.RowXmin, Content: r.Content, Version: int(r.SchemaVersion)}
			}
			return out, nil
		},
		UpdateRow: func(ctx context.Context, tx pgx.Tx, row MigrationRow, newContent []byte, toVersion int) (int64, error) {
			tag, err := tx.Exec(ctx, updateExerciseJSONBVersionSQL,
				row.ID, newContent, int32(toVersion), int32(row.Version), row.Xmin)
			if err != nil {
				return 0, err
			}
			return tag.RowsAffected(), nil
		},
		ValidateChain: store.ValidateExerciseUpgradeChain,
	}
}

// Resolve maps a --entity flag to its migrator (the unknown-entity guard, AC2e).
func Resolve(entity string) (EntityMigrator, error) {
	switch entity {
	case "exercises":
		return ExercisesMigrator(), nil
	default:
		return EntityMigrator{}, fmt.Errorf("unknown --entity %q (known: exercises)", entity)
	}
}

// RunMigration sweeps every row of m at `from`, upgrading to `to` in keyset
// batches of batchSize (one committed tx per batch). It returns the number of
// rows actually migrated (rows-affected > 0); concurrent-skipped rows are logged
// but not counted. Guards (AC2e/AC4) reject bad arguments with ZERO writes. A
// poison row (AC2d) aborts with the offending PK surfaced and no commit past it;
// already-committed batches stay migrated (AC2c resumability — a re-run picks up
// only the remaining `from` rows via the version predicate).
func RunMigration(ctx context.Context, pool txBeginner, m EntityMigrator, from, to, batchSize int, afterID pgtype.UUID, log *slog.Logger) (migrated, skipped int, err error) {
	if from < 1 {
		return 0, 0, fmt.Errorf("--from must be >= 1 (got %d)", from)
	}
	if from >= to {
		return 0, 0, fmt.Errorf("--from (%d) must be less than --to (%d)", from, to)
	}
	if to != m.CurrentVersion {
		return 0, 0, fmt.Errorf("--to (%d) must equal the current version of %q (%d)", to, m.Name, m.CurrentVersion)
	}
	// Pre-flight: fail a chain gap (a missing rung in [from, to)) here, before any
	// DB work, so it reads as a configuration error — not a per-row poison abort
	// that would mislabel it as data corruption (and re-report it for every row).
	if m.ValidateChain != nil {
		if verr := m.ValidateChain(from, to); verr != nil {
			return 0, 0, fmt.Errorf("upgrade chain for %q does not cover v%d→v%d: %w", m.Name, from, to, verr)
		}
	}
	if batchSize <= 0 {
		batchSize = DefaultBatchSize
	}
	if batchSize > MaxBatchSize {
		log.Warn("clamping --batch-size to MaxBatchSize", "requested", batchSize, "max", MaxBatchSize)
		batchSize = MaxBatchSize
	}

	lastID := afterID
	for {
		seen, batchMigrated, batchSkipped, newLast, berr := runBatch(ctx, pool, m, from, to, lastID, batchSize, log)
		if berr != nil {
			// The batch tx rolled back — its in-progress counts are NOT durable, so
			// they never join the totals (already-committed batches do).
			return migrated, skipped, berr
		}
		migrated += batchMigrated
		skipped += batchSkipped
		lastID = newLast
		if seen == 0 {
			break
		}
		log.Info("migrated batch",
			"entity", m.Name, "migrated", batchMigrated, "skipped", batchSkipped,
			"cumulative_migrated", migrated, "cumulative_skipped", skipped, "last_id", uuidString(lastID))
	}
	// Completeness signal: skipped rows (xmin lost-update guard) stay at `from` and
	// must be re-swept — otherwise an operator reading "complete" could wrongly drop
	// the old rung while `skipped` rows remain un-migrated. Surface it loudly.
	if skipped > 0 {
		log.Warn("sweep left rows at --from (concurrent-skip); re-run to migrate them",
			"entity", m.Name, "migrated", migrated, "remaining_at_from", skipped)
	}
	return migrated, skipped, nil
}

// runBatch processes one keyset page inside a single transaction. It advances
// lastID past EVERY row it saw (migrated or skipped) so the next page never
// re-selects a skipped row within this run. seen == 0 signals the sweep is done.
func runBatch(ctx context.Context, pool txBeginner, m EntityMigrator, from, to int, afterID pgtype.UUID, batchSize int, log *slog.Logger) (seen, migrated, skipped int, lastID pgtype.UUID, err error) {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return 0, 0, 0, afterID, fmt.Errorf("begin batch tx: %w", err)
	}
	committed := false
	defer func() {
		if !committed {
			_ = tx.Rollback(context.WithoutCancel(ctx))
		}
	}()

	rows, err := m.ListPage(ctx, generated.New(tx), from, afterID, batchSize)
	if err != nil {
		return 0, 0, 0, afterID, fmt.Errorf("list %s page (after_id=%s): %w", m.Name, uuidString(afterID), err)
	}
	if len(rows) == 0 {
		return 0, 0, 0, afterID, nil
	}

	last := afterID
	for _, row := range rows {
		newContent, uerr := m.Upgrade(row.Content, row.Version)
		if uerr != nil {
			// Poison row (AC2d): abort the run, surface the PK, no commit past it.
			// A silently-skipped bad row is a permanently-mixed-version table.
			return len(rows), migrated, skipped, last,
				fmt.Errorf("poison row %s %s (schema_version=%d) failed to upgrade — aborting: %w",
					m.Name, uuidString(row.ID), row.Version, uerr)
		}
		affected, uerr := m.UpdateRow(ctx, tx, row, newContent, to)
		if uerr != nil {
			return len(rows), migrated, skipped, last, fmt.Errorf("update %s %s: %w", m.Name, uuidString(row.ID), uerr)
		}
		if affected == 0 {
			// Concurrent live writer bumped xmin between our read and write (AC2b):
			// skip + log, never clobber. Harmless — the lazy read path upgrades it.
			skipped++
			log.Info("skipped concurrently-modified row", "entity", m.Name, "id", uuidString(row.ID))
		} else {
			migrated++
		}
		last = row.ID // advance keyset past skipped rows too (no re-select this run)
	}

	if err := tx.Commit(ctx); err != nil {
		return len(rows), migrated, skipped, last, fmt.Errorf("commit %s batch: %w", m.Name, err)
	}
	committed = true
	return len(rows), migrated, skipped, last, nil
}

func uuidString(id pgtype.UUID) string {
	return uuid.UUID(id.Bytes).String()
}
