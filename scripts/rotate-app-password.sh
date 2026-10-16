#!/usr/bin/env bash
# Story 11-8a — AC7. One-time rotation of the prod classlite_app password OFF the dev default
# (`classlite_dev_password`, hardcoded in the immutable 20260601110000 migration).
#
# This is a DELIBERATE one-time OPERATIONAL action, NOT part of the recurring deploy pipeline:
# updating the Railway DATABASE_URL var (step 2, done by the operator) itself triggers a Railway
# redeploy, so it must be sequenced by a human with a cutover, never fired silently on every push.
#
# Sequence (AC7 — rotate first, then update the var; existing pooled connections survive a
# password change, only NEW connections with the stale password fail — keep the gap minimal):
#   1. this script:  ALTER ROLE classlite_app PASSWORD '<new>'   (idempotent — guarded by a
#      COMMENT ON ROLE sentinel so a re-run is a safe no-op, never a churn)
#   2. operator:      set Railway DATABASE_URL to the new password  → triggers a safe redeploy
#      (same already-migrated schema → safe under the expand/contract rule, AC3)
#
# Required env: ADMIN_URL (a privileged connection that can ALTER ROLE classlite_app),
#               NEW_APP_PASSWORD (the new secret — never a committed literal).
set -euo pipefail

: "${ADMIN_URL:?set ADMIN_URL (privileged connection, e.g. the migrator via the TCP proxy)}"
: "${NEW_APP_PASSWORD:?set NEW_APP_PASSWORD (the new classlite_app password secret)}"

SENTINEL="classlite_app password rotated off dev default (11-8a)"

current="$(psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -tA -c \
  "SELECT shobj_description(oid, 'pg_authid') FROM pg_authid WHERE rolname='classlite_app'")"

if [ "$current" = "$SENTINEL" ]; then
  echo "classlite_app password already rotated (sentinel present) — no-op."
  exit 0
fi

# :'var' makes psql quote the value as a safe SQL literal (handles special chars).
psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -v pw="$NEW_APP_PASSWORD" <<'SQL'
ALTER ROLE classlite_app PASSWORD :'pw';
COMMENT ON ROLE classlite_app IS 'classlite_app password rotated off dev default (11-8a)';
SQL

echo "classlite_app password rotated."
echo "NEXT (operator): update the Railway classlite-api DATABASE_URL var to the new password."
echo "  That var update triggers a Railway redeploy of the SAME already-migrated schema (safe, AC3)."
