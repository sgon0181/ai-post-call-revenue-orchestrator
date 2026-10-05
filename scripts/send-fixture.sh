#!/usr/bin/env bash
# Replay an Aircall-compatible webhook fixture against your n8n instance.
#   ./scripts/send-fixture.sh call-ended-sales
#   N8N_URL=https://you.app.n8n.cloud ./scripts/send-fixture.sh call-ended-support
#   ./scripts/send-fixture.sh call-ended-sales --test   # uses /webhook-test (editor "Listen for test event")
set -euo pipefail
cd "$(dirname "$0")/.."
NAME="${1:?usage: send-fixture.sh <fixture-name> [--test]   (see fixtures/webhooks/)}"
FILE="fixtures/webhooks/${NAME%.json}.json"
[[ -f "$FILE" ]] || { echo "No fixture $FILE"; ls fixtures/webhooks; exit 1; }
BASE="${N8N_URL:-http://localhost:5678}"
PATH_PREFIX="webhook"; [[ "${2:-}" == "--test" ]] && PATH_PREFIX="webhook-test"
echo "→ POST $BASE/$PATH_PREFIX/aircall-events  ($FILE)"
# shift the fixture's timestamps so the call "ended 30 seconds ago"
BODY=$(node -e '
const f = JSON.parse(require("fs").readFileSync(process.argv[1]));
const shift = Math.floor(Date.now() / 1000) - 30 - (f.data.ended_at ?? f.timestamp);
for (const k of ["started_at", "answered_at", "ended_at"]) if (f.data[k]) f.data[k] += shift;
f.timestamp += shift;
process.stdout.write(JSON.stringify(f));' "$FILE")
curl -sS -X POST "$BASE/$PATH_PREFIX/aircall-events" -H 'content-type: application/json' --data "$BODY"
echo
