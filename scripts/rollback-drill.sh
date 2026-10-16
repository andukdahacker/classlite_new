#!/usr/bin/env bash
# Story 11-8a — AC3. The "rollback exercised ONCE, re-runnably" proof. Proves traffic ACTUALLY
# reverted (not just that an API call ran), via a version oracle:
#   1. capture the serving deployment id (the version oracle),
#   2. rollback (redeploy the previous SUCCESS deployment),
#   3. assert the serving deployment id == the prior deployment id AND /health 200 from it.
#
# Run against the real Railway service and paste the output into docs/deploy-runbook.md so
# "once" does not rot. Re-runnable — it reverts to whatever is currently previous; pair runs to
# return to the original if needed.
#
# The KNOWN-BAD INJECTION half (deploy a smoke-failing image → assert auto-rollback fires AND
# live traffic never served the bad image) is a documented manual drill step in the runbook: it
# requires intentionally shipping a broken image, which must be done by a human watching prod,
# not scripted into an unattended run.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=scripts/railway-lib.sh
source "$SCRIPT_DIR/railway-lib.sh"

API_URL="${PROD_API_URL:-https://api.classlite.app}"

mapfile -t DEPLOYS < <(latest_success_deployments)
if [ "${#DEPLOYS[@]}" -lt 2 ]; then
  echo "drill: need ≥2 successful deployments to exercise a rollback; found ${#DEPLOYS[@]}." >&2
  exit 1
fi
BEFORE="${DEPLOYS[0]}"
TARGET="${DEPLOYS[1]}"
echo "drill: serving=$BEFORE  rollback-target=$TARGET"

redeploy "$TARGET"
poll_health "$API_URL" 30 || { echo "::error::drill: target image not healthy after rollback"; exit 1; }

# Version oracle: the serving deployment must now be the target (traffic actually reverted).
mapfile -t AFTER < <(latest_success_deployments)
SERVING="${AFTER[0]}"
if [ "$SERVING" != "$TARGET" ]; then
  echo "::error::drill FAILED: serving=$SERVING, expected the rollback target $TARGET — traffic did NOT revert."
  exit 1
fi
echo "drill PASS: serving deployment is now $SERVING (== rollback target) and /health is ok. Traffic reverted."
