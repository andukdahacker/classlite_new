#!/usr/bin/env bash
# Story 11-8a — AC2 / Task 2 (DF-B, Murat score-9): the fail-closed migrate-gate PROOF.
#
# This is NOT the prod migrate. It is the behavioral red-phase test the WF-8 infra
# exception explicitly does NOT cover: it runs against a THROWAWAY database and asserts the
# two load-bearing behaviors the prod gate rests on —
#
#   PHASE A  the FULL migration set applies from scratch AS THE NON-SUPERUSER MIGRATOR ROLE
#            (NOSUPERUSER BYPASSRLS) and exits 0 — exercising real DDL under the real prod
#            privilege model, unlike the idempotent no-op the first prod `migrate up` will be.
#   PHASE B  a deliberately-FAILING migration makes `migrate up` exit NON-ZERO — the signal
#            `deploy.yml`'s migrate job turns into a red check, so Railway's "Wait for CI"
#            never cuts traffic over to the new image and `smoke.yml` is never eligible
#            (fail-closed). This script exiting non-zero == the CI job failing == every
#            downstream `needs:` job skipped.
#
# Runnable locally against the docker-compose Postgres:
#   docker compose up -d postgres
#   scripts/migrate-gate-test.sh
# Or in CI with a service Postgres, pass the superuser URL via GATE_TEST_ADMIN_URL.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
MIGRATIONS_DIR="$ROOT_DIR/classlite-api/migrations"

# Superuser/bootstrap connection to a maintenance DB (CREATE ROLE/DATABASE need it). Local
# default mirrors docker-compose.yml; CI overrides with its service-Postgres superuser.
ADMIN_URL="${GATE_TEST_ADMIN_URL:-postgres://classlite:classlite_dev_password@localhost:5432/postgres?sslmode=disable}"

# Unique throwaway identifiers so parallel/retry runs never collide (and never touch a real DB).
SUFFIX="$(date +%s)_$$"
DB_A="gate_full_${SUFFIX}"
DB_B="gate_fail_${SUFFIX}"
MIGRATOR="gate_migrator_${SUFFIX}"
MIGRATOR_PW="gate_migrator_pw_${SUFFIX}"
SSLMODE="$(printf '%s' "$ADMIN_URL" | grep -oE 'sslmode=[a-z]+' || echo 'sslmode=disable')"

# Derive host[:port] from the admin URL so the migrator URL points at the same server.
HOSTPORT="$(printf '%s' "$ADMIN_URL" | sed -E 's#^[a-z]+://[^@]+@([^/?]+).*#\1#')"

PSQL=(psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -q)

cleanup() {
  "${PSQL[@]}" -c "DROP DATABASE IF EXISTS ${DB_A}" >/dev/null 2>&1 || true
  "${PSQL[@]}" -c "DROP DATABASE IF EXISTS ${DB_B}" >/dev/null 2>&1 || true
  # The migrator holds a CONNECT grant on classlite_dev (a dependency) — revoke it before
  # DROP ROLE or the drop fails and the role leaks across re-runs.
  "${PSQL[@]}" -c "REVOKE GRANT OPTION FOR ALL ON DATABASE classlite_dev FROM ${MIGRATOR} CASCADE" >/dev/null 2>&1 || true
  "${PSQL[@]}" -c "REVOKE ALL ON DATABASE classlite_dev FROM ${MIGRATOR} CASCADE" >/dev/null 2>&1 || true
  "${PSQL[@]}" -c "DROP ROLE IF EXISTS ${MIGRATOR}" >/dev/null 2>&1 || true
  [ -n "${TMP_MIG_DIR:-}" ] && rm -rf "$TMP_MIG_DIR" || true
}
trap cleanup EXIT

echo "== 11-8a AC2 fail-closed migrate-gate test =="

# --- bootstrap: throwaway migrator role + throwaway classlite_dev (AC6 replay landmine) ---
# NOSUPERUSER BYPASSRLS mirrors the prod classlite_migrator (AC5). CREATEDB is required so the
# role can create the throwaway classlite_dev in-band (AC6 reconcile). CREATEROLE mirrors CI.
"${PSQL[@]}" -c "DROP ROLE IF EXISTS ${MIGRATOR}"
"${PSQL[@]}" -c "CREATE ROLE ${MIGRATOR} LOGIN PASSWORD '${MIGRATOR_PW}' NOSUPERUSER CREATEDB CREATEROLE BYPASSRLS"
# The immutable 20260601110000 migration hardcodes GRANT CONNECT ON DATABASE classlite_dev —
# ensure it exists so the GRANT replays clean (no CREATE DATABASE IF NOT EXISTS in Postgres).
"${PSQL[@]}" -tc "SELECT 1 FROM pg_database WHERE datname='classlite_dev'" | grep -q 1 \
  || "${PSQL[@]}" -c "CREATE DATABASE classlite_dev"
"${PSQL[@]}" -c "GRANT CONNECT ON DATABASE classlite_dev TO ${MIGRATOR} WITH GRANT OPTION"

"${PSQL[@]}" -c "CREATE DATABASE ${DB_A} OWNER ${MIGRATOR}"
"${PSQL[@]}" -c "CREATE DATABASE ${DB_B} OWNER ${MIGRATOR}"

MIGRATOR_URL_A="postgres://${MIGRATOR}:${MIGRATOR_PW}@${HOSTPORT}/${DB_A}?${SSLMODE}"
MIGRATOR_URL_B="postgres://${MIGRATOR}:${MIGRATOR_PW}@${HOSTPORT}/${DB_B}?${SSLMODE}"

# --- PHASE A: full set from scratch AS THE MIGRATOR → must exit 0 -------------------------
echo "-- Phase A: full migration set as ${MIGRATOR} (NOSUPERUSER BYPASSRLS)"
if ! migrate -path "$MIGRATIONS_DIR" -database "$MIGRATOR_URL_A" up; then
  echo "::error::FAIL-OPEN: the full migration set did NOT apply from scratch as the non-superuser migrator role."
  echo "   A migration that only works as a superuser would pass the idempotent prod no-op and detonate here. Fix it before shipping."
  exit 1
fi
echo "   Phase A OK: full schema applied under the real prod privilege model."

# --- PHASE B: full set + a deliberately-failing migration → must exit NON-ZERO -----------
echo "-- Phase B: full set + deliberately-failing migration (must abort non-zero)"
TMP_MIG_DIR="$(mktemp -d)"
cp "$MIGRATIONS_DIR"/*.sql "$TMP_MIG_DIR"/
cat > "$TMP_MIG_DIR/99999999999999_deploy_gate_deliberate_fail.up.sql" <<'SQL'
-- DELIBERATE FAILURE (11-8a AC2). Proves `migrate up` exits non-zero on a bad migration so the
-- deploy gate is fail-closed. This file lives ONLY in the throwaway test's temp dir, never in
-- classlite-api/migrations.
DO $$ BEGIN RAISE EXCEPTION 'deploy-gate deliberate failure (11-8a AC2 fail-closed proof)'; END $$;
SQL
cat > "$TMP_MIG_DIR/99999999999999_deploy_gate_deliberate_fail.down.sql" <<'SQL'
SELECT 1;
SQL

set +e
migrate -path "$TMP_MIG_DIR" -database "$MIGRATOR_URL_B" up
RC=$?
set -e

if [ "$RC" -eq 0 ]; then
  echo "::error::FAIL-OPEN: a deliberately-failing migration did NOT make migrate exit non-zero — the gate would ship a broken schema."
  exit 1
fi
echo "   Phase B OK: migrate exited ${RC} (non-zero) on the bad migration → gate is fail-closed (downstream cutover/smoke never eligible)."

echo "== PASS: migrate gate is fail-closed =="
