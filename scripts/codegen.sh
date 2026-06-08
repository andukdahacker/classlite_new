#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

echo "==> Running sqlc generate..."
cd "$ROOT_DIR/classlite-api" && sqlc generate

echo "==> Ensuring API client output directory exists..."
mkdir -p "$ROOT_DIR/classlite-web/src/lib/api"

echo "==> Running openapi-typescript..."
cd "$ROOT_DIR/classlite-web" && npx openapi-typescript "$ROOT_DIR/classlite-api/api.yaml" -o src/lib/api/client.ts

# TODO(story-1-8): re-enable openapi-zod-client once the Zodios runtime dep
# is resolved. The default emitter imports @zodios/core, which requires
# zod@^3 but the project pins zod@4 — `npm install @zodios/core` fails with
# an ERESOLVE peer-dep conflict. Until then, schemas.ts is intentionally
# absent (no consumer in the tree yet). Story 1-8 (Auth UI) is the first
# story to need it; that story decides the migration path (install with
# --legacy-peer-deps, switch to a zod-only emitter, or pin zod@3).
# echo "==> Running openapi-zod-client..."
# cd "$ROOT_DIR/classlite-web" && npx openapi-zod-client "$ROOT_DIR/classlite-api/api.yaml" -o src/lib/api/schemas.ts

echo "==> Codegen complete."
