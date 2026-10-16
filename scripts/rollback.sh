#!/usr/bin/env bash
# Story 11-8a — AC3. Auto-rollback invoked by smoke.yml when the post-deploy smoke fails.
# Reverts the IMAGE ONLY (redeploys the previous SUCCESS deployment); migrations are NOT
# reverted — the expand/contract rule (AC3/AC8) keeps the previous image compatible with the
# already-migrated schema. Fails LOUD (non-zero) if there is no prior deployment to fall back to
# or if the reverted image does not come back healthy, so a human is paged.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=scripts/railway-lib.sh
source "$SCRIPT_DIR/railway-lib.sh"

API_URL="${PROD_API_URL:-https://api.classlite.app}"

mapfile -t DEPLOYS < <(latest_success_deployments)
if [ "${#DEPLOYS[@]}" -lt 2 ]; then
  echo "::error::rollback: fewer than 2 successful deployments found — no prior image to revert to."
  exit 1
fi
CURRENT="${DEPLOYS[0]}"
PREVIOUS="${DEPLOYS[1]}"
echo "rollback: current=$CURRENT → reverting to previous=$PREVIOUS"

redeploy "$PREVIOUS"

if ! poll_health "$API_URL" 30; then
  echo "::error::rollback: reverted image did not become healthy within the poll window."
  exit 1
fi
echo "rollback complete: previous image ($PREVIOUS) is serving and /health is ok."
