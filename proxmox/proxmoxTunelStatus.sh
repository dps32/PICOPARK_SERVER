#!/bin/bash
set -eu

source ./config.env

USER=${1:-$DEFAULT_USER}

SSH_OPTS='-oHostKeyAlgorithms=+ssh-rsa -oPubkeyAcceptedAlgorithms=+ssh-rsa'
CTRL_DIR="${TMPDIR:-/tmp}"
CTRL_SOCK="$CTRL_DIR/proxmox_mysql_tunnel_3307.sock"

if ssh -S "$CTRL_SOCK" -p 20127 $SSH_OPTS -O check "$USER@ieticloudpro.ieti.cat" >/dev/null 2>&1; then
  echo "Tunnel: ON (127.0.0.1:3307)"
  exit 0
fi

echo "Tunnel: OFF"
exit 1
