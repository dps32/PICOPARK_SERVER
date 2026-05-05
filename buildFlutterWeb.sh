#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

if [[ -d "$PROJECT_DIR/PICOPARK_APP" ]]; then
  CLIENT_DIR="$PROJECT_DIR/PICOPARK_APP"
elif [[ -d "$PROJECT_DIR/client_flutter" ]]; then
  CLIENT_DIR="$PROJECT_DIR/client_flutter"
else
  echo "Error: no s'ha trobat el client Flutter a $PROJECT_DIR/PICOPARK_APP ni a $PROJECT_DIR/client_flutter" >&2
  exit 1
fi

PUBLIC_DIR="$SCRIPT_DIR/public"
STATIC_PUBLIC_DIR="$SCRIPT_DIR/static_public"

if [[ ! -d "$CLIENT_DIR" ]]; then
  echo "Error: no s'ha trobat el client Flutter a $CLIENT_DIR" >&2
  exit 1
fi

mkdir -p "$PUBLIC_DIR"

find "$PUBLIC_DIR" -mindepth 1 -maxdepth 1 \
  ! -name 'admin.html' \
  ! -name 'keep' \
  -exec rm -rf {} +

echo "Compilant Flutter web release a $PUBLIC_DIR..."

# On WSL, reuse a prebuilt web output when Linux Flutter is not available.
if [[ -f /proc/version ]] && grep -qi microsoft /proc/version; then
  if [[ -d "$CLIENT_DIR/build/web" ]]; then
    echo "WSL detectat. Copiant build web precompilada..."
    cp -R "$CLIENT_DIR/build/web"/. "$PUBLIC_DIR"/
  else
    echo "Error: No s'ha trobat build web precompilada a $CLIENT_DIR/build/web" >&2
    exit 1
  fi
else
  if ! command -v flutter >/dev/null 2>&1; then
    echo "Error: flutter no esta instal.lat o no es al PATH." >&2
    exit 1
  fi

  cd "$CLIENT_DIR"
  flutter pub get
  flutter build web --release --base-href / --output "$PUBLIC_DIR"
fi

if [[ -d "$STATIC_PUBLIC_DIR" ]]; then
  cp -R "$STATIC_PUBLIC_DIR"/. "$PUBLIC_DIR"/
else
  echo "Avis: no s'ha trobat $STATIC_PUBLIC_DIR. No s'afegiran arxius estatics personalitzats."
fi
