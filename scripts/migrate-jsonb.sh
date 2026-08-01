#!/usr/bin/env bash
set -euo pipefail

# Story 4.5 — thin wrapper around the JSONB schema-migration batch tool
# (classlite-api/tools/jsonbmigrate). Sweeps rows of a column-versioned JSONB
# entity from an old schema_version to the current one, upgrading each through
# the same lazy-upgrade ladder the read path uses.
#
#   scripts/migrate-jsonb.sh --entity=exercises --from=1 --to=2
#
# The tool runs CROSS-TENANT on a SUPERUSER connection (RLS bypassed) — see the
# GOVERNING INVARIANT in the tool's package doc and docs/jsonb-schema-migration.md.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

source "$ROOT_DIR/.env" 2>/dev/null || true

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  cat <<'USAGE'
Usage: scripts/migrate-jsonb.sh --entity=<name> --from=<N> --to=<M> [--after-id=<uuid>] [--batch-size=<n>]

  --entity      JSONB entity to migrate (known: exercises)
  --from        source schema_version to sweep (>= 1)
  --to          target schema_version (must equal the entity's current version)
  --after-id    resume after this row id (keyset); default sweeps from the start
  --batch-size  rows per transaction (default 100)

Guards reject unknown --entity, --to != current, --from >= --to, or --from < 1
with a non-zero exit and ZERO writes. A poison row aborts the run (PK surfaced).
USAGE
  exit 0
fi

# The batch tool requires SUPERUSER privileges (cross-tenant, RLS-bypassing).
# Use MIGRATION_DATABASE_URL if set, otherwise fall back to DATABASE_URL — the
# same resolution as scripts/migrate.sh.
MIGRATE_URL="${MIGRATION_DATABASE_URL:-${DATABASE_URL:-}}"

if [ -z "$MIGRATE_URL" ]; then
  echo "ERROR: Neither MIGRATION_DATABASE_URL nor DATABASE_URL is set. Copy .env.example to .env and configure it." >&2
  exit 1
fi

export MIGRATION_DATABASE_URL="$MIGRATE_URL"

cd "$ROOT_DIR/classlite-api"
echo "==> Running JSONB migration: $*"
exec go run ./tools/jsonbmigrate/cmd/jsonbmigrate "$@"
