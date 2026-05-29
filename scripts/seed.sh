#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

source "$ROOT_DIR/.env" 2>/dev/null || true

if [ -z "${DATABASE_URL:-}" ]; then
  echo "ERROR: DATABASE_URL not set. Copy .env.example to .env and configure it." >&2
  exit 1
fi

echo "==> Seeding local database..."
echo "    (No seed data defined yet — add SQL statements below as needed)"

# Example:
# psql "$DATABASE_URL" <<SQL
#   INSERT INTO ...
# SQL

echo "==> Seed complete."
