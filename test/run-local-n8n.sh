#!/usr/bin/env bash
# Boots a throwaway n8n (no Docker) with the test build imported and activated.
#   N8N_DIR=/path/with/node_modules/.bin/n8n  ./test/run-local-n8n.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
: "${N8N_DIR:?set N8N_DIR to a folder where 'npm i node@22 n8n' was run}"
export PATH="$N8N_DIR/node_modules/.bin:$PATH"
# Each run owns a fresh directory. Never delete a caller-supplied data directory.
if [[ -n "${N8N_USER_FOLDER:-}" ]]; then
  echo "Unset N8N_USER_FOLDER; this test runner creates an isolated data directory." >&2
  exit 1
fi
export N8N_USER_FOLDER="$(mktemp -d "${TMPDIR:-/tmp}/post-call-n8n.XXXXXX")"
echo "Test data directory: $N8N_USER_FOLDER"
export N8N_ENCRYPTION_KEY=test-key-123 WEBHOOK_URL=http://localhost:5678/ N8N_DIAGNOSTICS_ENABLED=false \
       N8N_SECURE_COOKIE=false GENERIC_TIMEZONE=UTC N8N_PERSONALIZATION_ENABLED=false
(cd "$ROOT" && MOCK_HOST=localhost node src/build.mjs --test)
G="$ROOT/test/.generated"
n8n import:credentials --input="$G/credentials.json"
for f in "$G"/0*.json; do n8n import:workflow --input="$f"; done
for f in "$G"/01-*.json "$G"/02-*.json; do
  id=$(node -p "require('$f').id")
  n8n publish:workflow --id="$id" 2>/dev/null || n8n update:workflow --id="$id" --active=true
done
exec n8n start
