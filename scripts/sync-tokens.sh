#!/usr/bin/env bash
# sync-tokens.sh — copy the canonical design-token file from the dashboard
# (source of truth) to the Astro landing site.
#
# Per Story 1.7a AC2: the dashboard's `src/tokens.css` is canonical. Drift
# is detected in CI via:
#
#     bash scripts/sync-tokens.sh
#     git diff --exit-code -- classlite-landing/src/styles/tokens.css
#
# Run this locally after editing the dashboard tokens, then commit the
# resulting change to the landing copy in the same PR.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/classlite-web/src/tokens.css"
DEST="$ROOT/classlite-landing/src/styles/tokens.css"

if [ ! -f "$SRC" ]; then
  echo "sync-tokens: canonical source not found at $SRC" >&2
  exit 1
fi

mkdir -p "$(dirname "$DEST")"
cp -f "$SRC" "$DEST"
echo "synced tokens.css → $DEST"
