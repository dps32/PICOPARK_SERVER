#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
if [[ -d "$PROJECT_DIR/PICOPARK_APP" ]]; then
  CLIENT_DIR="$PROJECT_DIR/PICOPARK_APP"
elif [[ -d "$PROJECT_DIR/client_flutter" ]]; then
  CLIENT_DIR="$PROJECT_DIR/client_flutter"
else
  echo "Error: no s'ha trobat el client Flutter a $PROJECT_DIR/PICOPARK_APP ni a $PROJECT_DIR/client_flutter"
  exit 1
fi
PUBLIC_DIR="$SCRIPT_DIR/public"
STATIC_PUBLIC_DIR="$SCRIPT_DIR/static_public"

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

# Try to compile, but fall back to copying from build/web if on WSL
if [[ -f /proc/version ]] && grep -qi microsoft /proc/version; then
  # Running on WSL - Flutter for Linux not available, use pre-built web
  if [[ -d "$CLIENT_DIR/build/web" ]]; then
    echo "WSL detectat. Copiant build web precompilada..."
    cp -r "$CLIENT_DIR/build/web"/* "$PUBLIC_DIR/" 2>/dev/null || true
  else
    echo "Error: No s'ha trobat build web precompilada a $CLIENT_DIR/build/web"
    exit 1
  fi
else
  # Running on Windows - compile normally
  cd "$CLIENT_DIR"
  flutter pub get
  flutter build web --release --base-href / --output "$PUBLIC_DIR"
fi

if [[ -d "$STATIC_PUBLIC_DIR" ]]; then
  cp -R "$STATIC_PUBLIC_DIR"/. "$PUBLIC_DIR"/
else
  echo "Avis: no s'ha trobat $STATIC_PUBLIC_DIR. No s'afegiran arxius estatics personalitzats."
fi
