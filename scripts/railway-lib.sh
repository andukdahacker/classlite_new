#!/usr/bin/env bash
# Story 11-8a — shared Railway GraphQL helpers for the deploy pipeline's rollback + drill.
#
# ⚠ LIVE-VALIDATION REQUIRED (DF-C pre-merge spike): the exact Railway GraphQL field names
# below (`deployments`, `deploymentRedeploy`, node fields) must be confirmed against the live
# backboard.railway.com/graphql/v2 schema before this story closes — a wrong field name fails
# the rollback OPEN. Record the confirmed shapes in docs/deploy-runbook.md. Everything else
# (polling, oracle comparison, exit codes) is provider-agnostic.
#
# Required env: RAILWAY_API_TOKEN, RAILWAY_SERVICE_ID, RAILWAY_ENVIRONMENT_ID.
set -euo pipefail

RAILWAY_GQL="${RAILWAY_GQL:-https://backboard.railway.com/graphql/v2}"

# railway_gql <query-json> — POSTs a GraphQL request, echoes the raw JSON response.
railway_gql() {
  curl -fsS --max-time 30 "$RAILWAY_GQL" \
    -H "Authorization: Bearer ${RAILWAY_API_TOKEN}" \
    -H 'Content-Type: application/json' \
    --data "$1"
}

# latest_success_deployments — prints deployment ids (newest first) with status SUCCESS, one
# per line. The FIRST line is the currently-serving build; the SECOND is the rollback target.
latest_success_deployments() {
  local q
  q="$(python3 - "$RAILWAY_SERVICE_ID" "$RAILWAY_ENVIRONMENT_ID" <<'PY'
import json,sys
service,env=sys.argv[1],sys.argv[2]
query="""query($service:String!,$env:String!){
  deployments(input:{serviceId:$service,environmentId:$env}, first:20){
    edges{ node{ id status createdAt } }
  }
}"""
print(json.dumps({"query":query,"variables":{"service":service,"env":env}}))
PY
)"
  railway_gql "$q" | python3 -c '
import sys,json
d=json.load(sys.stdin)
edges=d.get("data",{}).get("deployments",{}).get("edges",[])
for e in edges:
    n=e.get("node",{})
    if n.get("status")=="SUCCESS":
        print(n["id"])
'
}

# redeploy <deployment-id> — redeploys a prior deployment (the rollback action).
redeploy() {
  local id="$1" q
  q="$(python3 - "$id" <<'PY'
import json,sys
print(json.dumps({"query":"mutation($id:String!){ deploymentRedeploy(id:$id){ id } }","variables":{"id":sys.argv[1]}}))
PY
)"
  railway_gql "$q" >/dev/null
}

# poll_health <api-url> <attempts> — returns 0 once /health reports ok+connected, else 1.
poll_health() {
  local url="$1" attempts="${2:-30}" i body
  for i in $(seq 1 "$attempts"); do
    if body="$(curl -fsS --max-time 10 "$url/health" 2>/dev/null)" \
        && echo "$body" | grep -q '"status":"ok"' \
        && echo "$body" | grep -q '"db":"connected"'; then
      return 0
    fi
    sleep 10
  done
  return 1
}
