#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
CLIENT_DIR="$PROJECT_DIR/client_flutter"
PUBLIC_DIR="$SCRIPT_DIR/public"

if ! command -v flutter >/dev/null 2>&1; then
  echo "Error: flutter no esta instal·lat o no és al PATH."
  exit 1
fi

if [[ ! -d "$CLIENT_DIR" ]]; then
  echo "Error: no s'ha trobat el client Flutter a $CLIENT_DIR"
  exit 1
fi

mkdir -p "$PUBLIC_DIR"
find "$PUBLIC_DIR" -mindepth 1 -maxdepth 1 \
  ! -name 'admin.html' \
  ! -name 'keep' \
  -exec rm -rf {} +

echo "Compilant Flutter web release a $PUBLIC_DIR..."
cd "$CLIENT_DIR"
flutter pub get
flutter build web --release --base-href / --output "$PUBLIC_DIR"
