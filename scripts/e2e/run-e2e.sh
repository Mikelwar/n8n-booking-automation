#!/usr/bin/env sh
# End-to-end test in a throwaway, network-isolated n8n container.
#  - never touches the live instance, its container or its volume
#  - --network none: any attempted external call would fail the run
#  - runs the workflow twice: demo mode (default) and production mode with integrations still disabled
# Usage (from the project root):  sh scripts/e2e/run-e2e.sh
set -eu
IMAGE="${N8N_IMAGE:-n8n-ffmpeg:2.37.10}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="$ROOT/scripts/e2e/output"
mkdir -p "$OUT"

# Git Bash on Windows: keep paths untouched and use a Windows-style mount path.
export MSYS_NO_PATHCONV=1
MOUNT_ROOT="$ROOT"; MOUNT_OUT="$OUT"
if command -v cygpath >/dev/null 2>&1; then MOUNT_ROOT="$(cygpath -m "$ROOT")"; MOUNT_OUT="$(cygpath -m "$OUT")"; fi

docker run --rm --network none \
  --name "n8n-booking-e2e-$$" \
  -e N8N_DIAGNOSTICS_ENABLED=false \
  -e N8N_VERSION_NOTIFICATIONS_ENABLED=false \
  -v "$MOUNT_ROOT:/project:ro" \
  -v "$MOUNT_OUT:/out" \
  --entrypoint sh "$IMAGE" -c '
    set -e
    node /project/scripts/e2e/prepare-variants.js /project/workflows/ai-booking-automation.json /tmp
    n8n import:workflow --input=/tmp/wf-demo.json >/dev/null 2>&1
    n8n import:workflow --input=/tmp/wf-prod.json >/dev/null 2>&1
    n8n execute --id=bookingDemoE2E01 --rawOutput > /tmp/demo.raw 2>/tmp/demo.err || true
    n8n execute --id=bookingProdE2E01 --rawOutput > /tmp/prod.raw 2>/tmp/prod.err || true
    cp /tmp/demo.raw /out/demo-execution.raw; cp /tmp/prod.raw /out/prod-execution.raw
    node /project/scripts/e2e/assert-results.js /tmp/demo.raw /tmp/prod.raw /project /out
  '
