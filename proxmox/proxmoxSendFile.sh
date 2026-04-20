#!/bin/bash
set -e

cleanup() {
  ssh-agent -k 2>/dev/null || true
  cd "$ORIGINAL_DIR" 2>/dev/null || true
}
trap cleanup EXIT

ORIGINAL_DIR=$(pwd)
source ./config.env

FILE_TO_SEND="${1:-}"
USER=${2:-$DEFAULT_USER}
RSA_PATH=${3:-"$DEFAULT_RSA_PATH"}
RSA_PATH="${RSA_PATH%$'\r'}"

HOST="ieticloudpro.ieti.cat"
PORT_SSH="20127"

if [[ -z "$FILE_TO_SEND" ]]; then
  echo "Ús: $0 <fitxer_a_enviar> [user] [rsa_path]"
  exit 1
fi

if [[ ! -f "$FILE_TO_SEND" ]]; then
  echo "Error: No s'ha trobat el fitxer: $FILE_TO_SEND"
  exit 1
fi

if [[ ! -f "$RSA_PATH" ]]; then
  echo "Error: No s'ha trobat la clau privada: $RSA_PATH"
  exit 1
fi

eval "$(ssh-agent -s)" >/dev/null
ssh-add "$RSA_PATH" >/dev/null

REMOTE_NAME="$(basename "$FILE_TO_SEND")"
scp -P "$PORT_SSH" "$FILE_TO_SEND" "$USER@$HOST:~/$REMOTE_NAME"

echo "✔️  Fitxer enviat: $FILE_TO_SEND -> $USER@$HOST:~/$REMOTE_NAME"
