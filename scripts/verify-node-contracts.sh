#!/bin/bash
# Verify node contracts and whether http_response can fire without inference.
# Run from repo root: ./scripts/verify-node-contracts.sh

set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "=== binary_intent ==="
rg -n "binary_intent" -S . 2>/dev/null || true

echo ""
echo "=== http_response ==="
rg -n "http_response" -S . 2>/dev/null || true

echo ""
echo "=== inference ==="
rg -n "inference" -S . 2>/dev/null || true

echo ""
echo "=== trigger (inference/node/schema) ==="
rg -n "trigger" -S ts/src/core/execution/nodes/ ts/src/core/types.ts 2>/dev/null || true

echo ""
echo "Done. See InferenceNode (trigger input) and HttpResponseNode JSDoc: http_response fires even when inference is skipped (trigger=false)."
