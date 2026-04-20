#!/bin/bash
set -e

cleanup() {
  ssh-agent -k 2>/dev/null || true
  cd "$ORIGINAL_DIR" 2>/dev/null || true
}
trap cleanup EXIT

ORIGINAL_DIR=$(pwd)
source ./config.env

USER=${1:-$DEFAULT_USER}
RSA_PATH=${2:-"$DEFAULT_RSA_PATH"}
SERVER_PORT=${3:-$DEFAULT_SERVER_PORT}
RSA_PATH="${RSA_PATH%$'\r'}"

HOST="ieticloudpro.ieti.cat"
PORT_SSH="20127"
ZIP_NAME="server-package.zip"

if [[ ! -f "$RSA_PATH" ]]; then
  echo "Error: No s'ha trobat la clau privada: $RSA_PATH"
  exit 1
fi

bash ../buildFlutterWeb.sh

cd ..
./getAssets.sh
rm -f "$ZIP_NAME"
zip -r "$ZIP_NAME" . -x "proxmox/*" "node_modules/*" "data" "data/*" ".gitignore"

eval "$(ssh-agent -s)" >/dev/null
ssh-add "$RSA_PATH"

scp -P "$PORT_SSH" "$ZIP_NAME" "$USER@$HOST:~/server-package.zip"
rm -f "$ZIP_NAME"

ssh -tt -p "$PORT_SSH" -o UpdateHostKeys=no \
  "$USER@$HOST" \
  bash -s -- "$SERVER_PORT" << 'EOF'
set -e

SERVER_PORT="$1"
APP_DIR="$HOME/nodejs_server"
PKG="$HOME/server-package.zip"
TMP_DIR="$(mktemp -d)"

export PATH="$HOME/.npm-global/bin:/usr/local/bin:$PATH"


mkdir -p "$APP_DIR"
cd "$APP_DIR"

# Stop only our app
if command -v pm2 >/dev/null 2>&1; then
  pm2 delete app >/dev/null 2>&1 || true
fi

# Wait for port to be free
for i in {1..10}; do
  ss -tln | grep -q ":$SERVER_PORT " && sleep 1 || break
done

# Clean app dir (keep data if needed)
find "$APP_DIR" -mindepth 1 -maxdepth 1 -name "data" -prune -o -exec rm -rf {} + 2>/dev/null || true

# Unzip safely
test -f "$PKG"
unzip -q -o "$PKG" -d "$TMP_DIR"
rm -f "$PKG"

# Detect project root
if [[ -f "$TMP_DIR/package.json" ]]; then
  rsync -a --delete --exclude 'data/' "$TMP_DIR/" "$APP_DIR/"
elif [[ -f "$TMP_DIR/nodejs_server/package.json" ]]; then
  rsync -a --delete --exclude 'data/' "$TMP_DIR/nodejs_server/" "$APP_DIR/"
elif [[ -f "$TMP_DIR/nodejs_web/package.json" ]]; then
  rsync -a --delete --exclude 'data/' "$TMP_DIR/nodejs_web/" "$APP_DIR/"
else
  echo "Error: no trobo package.json dins del zip"
  exit 1
fi

rm -rf "$TMP_DIR"

cd "$APP_DIR"
test -f package.json

npm install --omit=dev

# Start app with global pm2
pm2 start server/app.js --name app --update-env
pm2 save

echo "✔️  Deploy correcte. Estat PM2:"
pm2 status
exit
EOF
