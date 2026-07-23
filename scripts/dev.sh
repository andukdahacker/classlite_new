#!/usr/bin/env bash
#
# dev.sh — one-command local dev stack.
#
# Boots Postgres (+pgAdmin) in Docker, waits until it's actually accepting
# connections, applies migrations, then runs the Go API, the React web
# dashboard, and the Astro landing site concurrently with prefixed logs.
# Ctrl-C tears the whole thing down cleanly.
#
# Usage:
#   ./scripts/dev.sh               # DB + migrate + API + web + landing; stop containers on exit (keep data)
#   ./scripts/dev.sh --clean       # same, but WIPE the DB volume on exit (down -v)
#   ./scripts/dev.sh --seed        # also run scripts/seed.sh after migrating
#   ./scripts/dev.sh --no-web      # skip the web dashboard
#   ./scripts/dev.sh --no-landing  # skip the Astro landing site
#   ./scripts/dev.sh -h            # help
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

CLEAN=false
SEED=false
RUN_WEB=true
RUN_LANDING=true

for arg in "$@"; do
  case "$arg" in
    --clean)      CLEAN=true ;;
    --seed)       SEED=true ;;
    --no-web)     RUN_WEB=false ;;
    --no-landing) RUN_LANDING=false ;;
    -h|--help)
      sed -n '3,17p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) echo "Unknown option: $arg (try -h)" >&2; exit 1 ;;
  esac
done

log() { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
die() { printf '\033[1;31mERROR:\033[0m %s\n' "$*" >&2; exit 1; }

# --- preflight ------------------------------------------------------------
need() { command -v "$1" >/dev/null 2>&1 || die "'$1' not found on PATH. $2"; }
need docker  "Install Docker Desktop."
need go      "Install Go 1.25+."
need migrate "Install golang-migrate: https://github.com/golang-migrate/migrate"
if $RUN_WEB || $RUN_LANDING; then
  need npm "Install Node.js (needed for the frontends), or pass --no-web --no-landing."
fi

# docker compose v2 (plugin) vs legacy docker-compose v1
if docker compose version >/dev/null 2>&1; then
  DC=(docker compose)
else
  need docker-compose "Install the Docker Compose plugin."
  DC=(docker-compose)
fi
COMPOSE=("${DC[@]}" -f "$ROOT_DIR/docker-compose.yml" --project-directory "$ROOT_DIR")

# --- env ------------------------------------------------------------------
if [ ! -f "$ROOT_DIR/.env" ]; then
  log ".env missing — copying from .env.example (edit it, then re-run)"
  cp "$ROOT_DIR/.env.example" "$ROOT_DIR/.env"
fi
# The Go API reads os.Getenv directly (no .env autoload), so export everything.
set -a
# shellcheck disable=SC1091
source "$ROOT_DIR/.env"
set +a

BIN="$ROOT_DIR/classlite-api/bin/api"
API_PID=""
WEB_PID=""
LANDING_PID=""

# --- teardown -------------------------------------------------------------
cleanup() {
  trap - INT TERM EXIT
  echo
  log "Shutting down..."
  [ -n "$API_PID" ] && kill "$API_PID" 2>/dev/null || true
  # npm forwards signals, but pkill -P also reaps the vite/astro child directly
  for pid in "$WEB_PID" "$LANDING_PID"; do
    if [ -n "$pid" ]; then
      kill "$pid" 2>/dev/null || true
      pkill -P "$pid" 2>/dev/null || true
    fi
  done
  wait 2>/dev/null || true
  if $CLEAN; then
    log "Removing containers + DB volume (--clean)"
    "${COMPOSE[@]}" down -v
  else
    log "Stopping containers (data preserved)"
    "${COMPOSE[@]}" stop
  fi
  log "Done."
}
trap cleanup INT TERM EXIT

# prefix each backgrounded service's output with a colored tag
prefix() {
  local tag=$1 color=$2 line
  while IFS= read -r line; do
    printf '\033[1;%sm[%s]\033[0m %s\n' "$color" "$tag" "$line"
  done
}

# --- bring up Postgres ----------------------------------------------------
log "Starting Postgres + pgAdmin..."
"${COMPOSE[@]}" up -d

log "Waiting for Postgres to accept connections..."
CID="$("${COMPOSE[@]}" ps -q postgres)"
[ -n "$CID" ] || die "Postgres container did not start."
tries=0
until docker exec "$CID" pg_isready -U classlite -d classlite_dev >/dev/null 2>&1; do
  tries=$((tries + 1))
  [ "$tries" -ge 30 ] && die "Postgres not ready after 30s. Check: ${DC[*]} logs postgres"
  sleep 1
done
log "Postgres is ready."

# --- migrate + optional seed ---------------------------------------------
log "Applying migrations..."
"$SCRIPT_DIR/migrate.sh" up

if $SEED; then
  log "Seeding..."
  "$SCRIPT_DIR/seed.sh"
fi

# --- build + run API ------------------------------------------------------
log "Building API..."
( cd "$ROOT_DIR/classlite-api" && go build -o "$BIN" ./cmd/api )

log "Starting API on :${PORT:-8080}"
( cd "$ROOT_DIR/classlite-api" && exec "$BIN" ) > >(prefix api 32) 2>&1 &
API_PID=$!

# --- run web dashboard ----------------------------------------------------
if $RUN_WEB; then
  if [ ! -d "$ROOT_DIR/classlite-web/node_modules" ]; then
    log "Installing web dependencies (first run)..."
    ( cd "$ROOT_DIR/classlite-web" && npm install )
  fi
  log "Starting web dashboard..."
  ( cd "$ROOT_DIR/classlite-web" && exec npm run dev ) > >(prefix web 35) 2>&1 &
  WEB_PID=$!
fi

# --- run Astro landing ----------------------------------------------------
if $RUN_LANDING; then
  if [ ! -d "$ROOT_DIR/classlite-landing/node_modules" ]; then
    log "Installing landing dependencies (first run)..."
    ( cd "$ROOT_DIR/classlite-landing" && npm install )
  fi
  log "Starting Astro landing..."
  ( cd "$ROOT_DIR/classlite-landing" && exec npm run dev ) > >(prefix landing 33) 2>&1 &
  LANDING_PID=$!
fi

echo
log "Stack is up. Postgres :5432 · pgAdmin :5050 · API :${PORT:-8080}$($RUN_WEB && echo ' · web :5173')$($RUN_LANDING && echo ' · landing :4321')"
log "Press Ctrl-C to stop everything."
echo

# Wait on the service processes; Ctrl-C fires the trap.
wait
