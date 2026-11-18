#!/bin/bash
# Setup script for the Kibbutz Dining Hall Platform
# Run INSIDE the frappe devcontainer:
#   docker compose -f .devcontainer/docker-compose.yml up -d
#   docker exec -it <frappe-container> bash scripts/setup.sh
#
# Or if using VS Code Dev Containers: reopen in container, then run in terminal:
#   bash scripts/setup.sh

set -e

BENCH_NAME="${BENCH_NAME:-frappe-bench}"
SITE_NAME="${SITE_NAME:-development.localhost}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-admin}"
FRAPPE_BRANCH="${FRAPPE_BRANCH:-version-16}"
ERPNEXT_BRANCH="${ERPNEXT_BRANCH:-version-16}"

echo "=== Dining Hall Platform Setup ==="
echo "Bench: $BENCH_NAME, Site: $SITE_NAME, Branches: Frappe $FRAPPE_BRANCH / ERPNext $ERPNEXT_BRANCH"

cd /workspace

# 1. Init bench if not exists
if [ ! -d "$BENCH_NAME" ]; then
    echo "[1/7] Initializing bench ($FRAPPE_BRANCH)..."
    bench init --skip-redis-config-generation --frappe-branch "$FRAPPE_BRANCH" "$BENCH_NAME"
else
    echo "[1/7] Bench already exists, skipping init"
fi

cd /workspace/$BENCH_NAME

# 2. Configure db/redis hosts
echo "[2/7] Configuring database and Redis hosts..."
bench set-config -g db_host mariadb || true
bench set-config -g redis_cache redis://redis-cache:6379 || true
bench set-config -g redis_queue redis://redis-queue:6379 || true
bench set-config -g redis_socketio redis://redis-queue:6379 || true

# 3. Create site if not exists
if [ ! -d "sites/$SITE_NAME" ]; then
    echo "[3/7] Creating site $SITE_NAME..."
    bench new-site --db-root-password 123 --admin-password "$ADMIN_PASSWORD" --mariadb-user-host-login-scope=% "$SITE_NAME"
else
    echo "[3/7] Site already exists, skipping"
fi

# 4. Enable developer mode
echo "[4/7] Enabling developer mode..."
bench --site "$SITE_NAME" set-config developer_mode 1
bench --site "$SITE_NAME" clear-cache

# 5. Install ERPNext
if [ ! -d "apps/erpnext" ]; then
    echo "[5/7] Getting ERPNext ($ERPNEXT_BRANCH)..."
    bench get-app --branch "$ERPNEXT_BRANCH" --resolve-deps erpnext
fi
if ! bench --site "$SITE_NAME" list-apps | grep -q erpnext; then
    bench --site "$SITE_NAME" install-app erpnext
    echo "ERPNext installed"
else
    echo "[5/7] ERPNext already installed"
fi

# 6. Get / update custom app
APP_PATH="/workspace/apps/kibbutz_dining"
if [ -d "$APP_PATH" ]; then
    echo "[6/7] Custom app kibbutz_dining found at $APP_PATH"
    if [ ! -d "apps/kibbutz_dining" ]; then
        ln -s "$APP_PATH" apps/kibbutz_dining
    fi
else
    echo "[6/7] Creating custom app kibbutz_dining..."
    bench get-app --skip-requirements kibbutz_dining "$APP_PATH" || \
    mkdir -p apps/kibbutz_dining
fi

if [ -d "apps/kibbutz_dining" ] && ! bench --site "$SITE_NAME" list-apps | grep -q kibbutz_dining; then
    bench --site "$SITE_NAME" install-app kibbutz_dining
    echo "kibbutz_dining installed"
else
    echo "[6/7] kibbutz_dining already installed or not present"
fi

# 7. Start bench
echo "[7/7] Starting bench..."
bench start &
echo ""
echo "=== Setup complete ==="
echo "Open http://development.localhost:8000 (add to /etc/hosts: 127.0.0.1 development.localhost)"
echo "Login: Administrator / $ADMIN_PASSWORD"
