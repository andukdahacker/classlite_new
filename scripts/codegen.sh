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

echo "==> Running openapi-zod-client..."
cd "$ROOT_DIR/classlite-web" && npx openapi-zod-client "$ROOT_DIR/classlite-api/api.yaml" -o src/lib/api/schemas.ts

echo "==> Codegen complete."
