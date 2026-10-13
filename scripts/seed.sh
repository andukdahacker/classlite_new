#!/usr/bin/env bash
set -euo pipefail

# Thin wrapper over the Go seed entry point (Story 11-1a / DD1). The real seed is
# cmd/seed, which builds the deterministic Epics 1–8 dataset over the STORE layer
# and emits classlite-web/tests/e2e/.auth/credentials.json. A migration would
# ship to prod (R-11-4) and be immutable; bash+psql cannot do bcrypt / JSONB /
# FK ordering / RLS windows cleanly — hence Go.
#
# Flags pass through:  scripts/seed.sh            # clean seed + credentials
#                      scripts/seed.sh -clean=false  # idempotent upsert
#                      scripts/seed.sh -destructive  # positive-proof-guarded wipe (DD13)

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

source "$ROOT_DIR/.env" 2>/dev/null || true

if [ -z "${DATABASE_URL:-}" ]; then
  echo "ERROR: DATABASE_URL not set. Copy .env.example to .env and configure it." >&2
  exit 1
fi

echo "==> Seeding via cmd/seed..."
( cd "$ROOT_DIR/classlite-api" && go run ./cmd/seed "$@" )
echo "==> Seed complete."
