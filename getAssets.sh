#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ -d "$SCRIPT_DIR/../PICOPARK_APP/assets" ]]; then
  SOURCE_DIR="$SCRIPT_DIR/../PICOPARK_APP/assets"
elif [[ -d "$SCRIPT_DIR/../client_flutter/assets" ]]; then
  SOURCE_DIR="$SCRIPT_DIR/../client_flutter/assets"
else
  echo "Error: source assets directory not found at $SCRIPT_DIR/../PICOPARK_APP/assets or $SCRIPT_DIR/../client_flutter/assets" >&2
  exit 1
fi
TARGET_DIR="$SCRIPT_DIR/server/assets"

if [[ ! -d "$SOURCE_DIR" ]]; then
  echo "Error: source assets directory not found at $SOURCE_DIR" >&2
  exit 1
fi

mkdir -p "$TARGET_DIR"
find "$TARGET_DIR" -mindepth 1 -delete
cp -R "$SOURCE_DIR"/. "$TARGET_DIR"

echo "Assets copied from $SOURCE_DIR to $TARGET_DIR"
