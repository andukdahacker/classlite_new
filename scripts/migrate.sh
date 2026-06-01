#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

source "$ROOT_DIR/.env" 2>/dev/null || true

# Migrations require superuser privileges (CREATE TABLE, CREATE ROLE, etc.).
# Use MIGRATION_DATABASE_URL if set, otherwise fall back to DATABASE_URL.
MIGRATE_URL="${MIGRATION_DATABASE_URL:-${DATABASE_URL:-}}"

if [ -z "$MIGRATE_URL" ]; then
  echo "ERROR: Neither MIGRATION_DATABASE_URL nor DATABASE_URL is set. Copy .env.example to .env and configure it." >&2
  exit 1
fi

MIGRATIONS_DIR="$ROOT_DIR/classlite-api/migrations"

case "${1:-up}" in
  up)     migrate -path "$MIGRATIONS_DIR" -database "$MIGRATE_URL" up ;;
  down)   migrate -path "$MIGRATIONS_DIR" -database "$MIGRATE_URL" down 1 ;;
  create)
    if [ -z "${2:-}" ]; then
      echo "Usage: $0 create <name>" >&2
      exit 1
    fi
    migrate create -ext sql -dir "$MIGRATIONS_DIR" -seq "$2"
    ;;
  *)      echo "Usage: $0 {up|down|create <name>}" && exit 1 ;;
esac
