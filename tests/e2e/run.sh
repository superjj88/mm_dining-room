#!/usr/bin/env bash
# Run the Phase 6 vertical slice test inside the Frappe container.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
CONTAINER="devcontainer-frappe-1"
VENV_PYTHON="/workspace/frappe-bench/env/bin/python"

echo "==> Copying updated app code into container..."
rtk docker cp "$REPO_ROOT/apps/kibbutz_dining/." "$CONTAINER:/workspace/frappe-bench/apps/kibbutz_dining/"

echo "==> Copying E2E test into container..."
rtk docker exec "$CONTAINER" rm -rf /tmp/e2e
rtk docker cp "$REPO_ROOT/tests/e2e" "$CONTAINER:/tmp/e2e"

echo "==> Copying socket.io-client modules..."
rtk docker exec "$CONTAINER" bash -c "rm -rf /tmp/e2e/node_modules && cp -r /tmp/socktest/node_modules /tmp/e2e/node_modules"

echo "==> Starting socket.io listener..."
rtk docker exec -d "$CONTAINER" bash -c "cd /tmp/e2e && node socket_listener.mjs > /tmp/e2e_listener.log 2>&1"
sleep 2

echo "==> Running vertical slice (price propagation + overdraft)..."
rtk docker exec "$CONTAINER" bash -c "cd /workspace/frappe-bench && $VENV_PYTHON /tmp/e2e/vertical_slice.py"

echo "==> Waiting for realtime events..."
sleep 2

echo "==> Stopping listener..."
rtk docker exec "$CONTAINER" bash -c "pkill -f 'node socket_listener.mjs' || true"

echo ""
echo "==> Socket events received:"
rtk docker exec "$CONTAINER" bash -c "cat /tmp/e2e_socket_events.jsonl 2>/dev/null || echo '(none)'"

echo ""
echo "==> Listener log tail:"
rtk docker exec "$CONTAINER" bash -c "tail -20 /tmp/e2e_listener.log 2>/dev/null || echo '(no log)'"
