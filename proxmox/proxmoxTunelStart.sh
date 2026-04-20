#!/bin/bash
set -eu

source ./config.env

USER=${1:-$DEFAULT_USER}
RSA_PATH=${2:-"$DEFAULT_RSA_PATH"}
RSA_PATH="${RSA_PATH%$'\r'}"

LOCAL_PORT=3307
REMOTE_HOST=127.0.0.1
REMOTE_PORT=3306

SSH_OPTS='-oHostKeyAlgorithms=+ssh-rsa -oPubkeyAcceptedAlgorithms=+ssh-rsa -oExitOnForwardFailure=yes'

CTRL_DIR="${TMPDIR:-/tmp}"
CTRL_SOCK="$CTRL_DIR/proxmox_mysql_tunnel_3307.sock"

if [[ ! -f "${RSA_PATH}" ]]; then
  echo "Private key not found: $RSA_PATH"
  exit 1
fi

# If already running, exit nicely
if ssh -S "$CTRL_SOCK" -p 20127 $SSH_OPTS -O check "$USER@ieticloudpro.ieti.cat" >/dev/null 2>&1; then
  echo "Tunnel already running on 127.0.0.1:${LOCAL_PORT}"
  exit 0
fi

# Start tunnel in background with control socket
ssh -f -N -T \
  -M -S "$CTRL_SOCK" \
  -i "${RSA_PATH}" \
  -p 20127 \
  $SSH_OPTS \
  -L ${LOCAL_PORT}:${REMOTE_HOST}:${REMOTE_PORT} \
  "$USER@ieticloudpro.ieti.cat"

echo "Tunnel started on 127.0.0.1:${LOCAL_PORT}"
echo "Connect to remote MySQL server at ${REMOTE_HOST}:${REMOTE_PORT} via local port ${LOCAL_PORT}"
echo "To stop the tunnel, run: ./proxmoxTunelStop.sh [user]"
