#!/bin/bash
# ============================================================
# FitLog Deployment Script (Bare-metal + systemd)
# ============================================================
# Usage: ./deploy.sh [--skip-build] [--skip-backup]
# Requires: Node.js 20+, npm 10+, MySQL 8.0, Redis, Nginx, systemd

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
SERVER_DIR="$REPO_DIR/server"
CLIENT_DIR="$REPO_DIR/client"

DEPLOY_BASE="/opt/fitlog"
DEPLOY_SERVER="$DEPLOY_BASE/server"
DEPLOY_CLIENT="$DEPLOY_BASE/client"
DEPLOY_MEDIA="$DEPLOY_BASE/media"
BACKUP_DIR="$DEPLOY_BASE/backups/$(date +%Y%m%d_%H%M%S)"

SKIP_BUILD=false
SKIP_BACKUP=false

for arg in "$@"; do
    case $arg in
        --skip-build) SKIP_BUILD=true ;;
        --skip-backup) SKIP_BACKUP=true ;;
    esac
done

echo "=========================================="
echo " FitLog Bare-Metal Production Deployment"
echo " $(date '+%Y-%m-%d %H:%M:%S')"
echo "=========================================="

# ---- 1. Pre-flight checks ----
echo "[1/7] Running pre-flight checks..."

if ! command -v node &>/dev/null; then
    echo "ERROR: Node.js is not installed" && exit 1
fi

NODE_VER=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VER" -lt 18 ]; then
    echo "ERROR: Node.js 18+ required (recommend 20), found $NODE_VER" && exit 1
fi

# Ensure required deployment directories exist
sudo mkdir -p "$DEPLOY_SERVER" "$DEPLOY_CLIENT/dist" "$DEPLOY_MEDIA" "$DEPLOY_BASE/backups" /var/log/fitlog

# Check .env configuration file
if [ ! -f "$DEPLOY_SERVER/.env" ]; then
    echo "ERROR: Environment file $DEPLOY_SERVER/.env not found!"
    echo "Please copy .env.production.example to $DEPLOY_SERVER/.env and fill in real secrets."
    exit 1
fi

# ---- 2. Backup existing deployment ----
if [ "$SKIP_BACKUP" = false ]; then
    echo "[2/11] Creating backup of current deployment..."
    mkdir -p "$BACKUP_DIR"
    if [ -d "$DEPLOY_CLIENT/dist" ] && [ "$(ls -A "$DEPLOY_CLIENT/dist")" ]; then
        cp -r "$DEPLOY_CLIENT/dist" "$BACKUP_DIR/dist"
        echo "  Frontend backup saved to $BACKUP_DIR/dist"
    fi
else
    echo "[2/11] Skipping backup (--skip-backup)"
fi

# ---- 3. Git Status & Pull ----
echo "[3/11] Checking git status and pulling latest code..."
cd "$REPO_DIR"
git status -s
git pull origin main

# ---- 4. Backend Dependencies & Prisma ----
if [ "$SKIP_BUILD" = false ]; then
    echo "[4/11] Installing backend dependencies (npm ci)..."
    cd "$SERVER_DIR"
    npm ci --silent

    echo "[5/11] Generating Prisma Client..."
    npx prisma generate

    echo "[6/11] Deploying database migrations (safely, no db push)..."
    # Load production .env securely without losing special characters in password
    set -a
    # shellcheck disable=SC1090
    . "$DEPLOY_SERVER/.env"
    set +a
    npx prisma migrate deploy
    echo "  Database migration up to date!"
else
    echo "[4-6/11] Skipping backend build & migration (--skip-build)"
fi

# ---- 5. Build Frontend ----
if [ "$SKIP_BUILD" = false ]; then
    echo "[7/11] Building frontend (npm run build)..."
    cd "$CLIENT_DIR"
    npm ci --silent
    npx vite build
    echo "  Frontend built successfully"

    # Deploy frontend dist
    echo "[8/11] Publishing frontend artifacts to $DEPLOY_CLIENT/dist..."
    sudo rm -rf "$DEPLOY_CLIENT/dist"/*
    sudo cp -r "$CLIENT_DIR/dist"/* "$DEPLOY_CLIENT/dist/"
else
    echo "[7-8/11] Skipping frontend build (--skip-build)"
fi

# ---- 6. Permissions & Nginx ----
echo "[9/11] Setting permissions and updating systemd service..."
sudo chown -R fitlog:fitlog "$DEPLOY_BASE" /var/log/fitlog
sudo chmod 750 "$DEPLOY_BASE"
sudo chmod 600 "$DEPLOY_SERVER/.env"

# Install or sync systemd service unit
if [ -f "$REPO_DIR/deploy/fitlog.service" ]; then
    sudo cp "$REPO_DIR/deploy/fitlog.service" /etc/systemd/system/fitlog.service
    sudo systemctl daemon-reload
    sudo systemctl enable fitlog
fi

if [ -f "/etc/nginx/sites-enabled/fitlog" ]; then
    sudo nginx -t && sudo systemctl reload nginx
    echo "  Nginx reloaded successfully"
else
    echo "  NOTE: /etc/nginx/sites-enabled/fitlog not enabled yet."
    echo "  Enable with: sudo ln -sf /etc/nginx/sites-available/fitlog /etc/nginx/sites-enabled/ && sudo systemctl reload nginx"
fi

# ---- 7. Restart Service & Health Check ----
echo "[10/11] Restarting FitLog systemd service..."
sudo systemctl daemon-reload
sudo systemctl restart fitlog
sudo systemctl status fitlog --no-pager -l

echo "[11/11] Performing service health check..."
sleep 3
if curl -s http://127.0.0.1:3001/health/ready | grep -q '"status":"ready"'; then
    echo "SUCCESS: FitLog backend is healthy and ready!"
else
    echo "WARNING: Backend did not return ready status immediately, check logs with: journalctl -u fitlog -f -n 50"
fi

echo ""
echo "=========================================="
echo " FitLog Deployment Complete!"
echo " Local Backend: http://127.0.0.1:3001"
echo " Local Frontend: $DEPLOY_CLIENT/dist (via Nginx :80)"
echo " Cloudflare Tunnel: https://fitlog.yourdomain.com"
echo "=========================================="
