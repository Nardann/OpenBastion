#!/bin/sh
# Harden filesystem permissions for OpenBastion deployment.
# Run AS ROOT (or via sudo) on the host.
#   sudo ./scripts/harden-perms.sh
#
# This script tightens:
#   - .env             → 600 (secrets)
#   - certs/server.key → 600 (TLS private key)
#   - certs/server.crt → 644 (TLS public cert)
#   - certs/           → 700 (parent dir not world-traversable)
#   - pg_data/         → 700 owned by Postgres uid (70)
set -eu

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

# Refuse to run if we are not effectively root for the chown calls.
if [ "$(id -u)" -ne 0 ]; then
  echo "❌ This script must be run as root (use sudo)." >&2
  exit 1
fi

OWNER_UID="${SUDO_UID:-0}"
OWNER_GID="${SUDO_GID:-0}"

if [ -f .env ]; then
  chown "${OWNER_UID}:${OWNER_GID}" .env
  chmod 600 .env
  echo "✓ .env → 600 (uid=${OWNER_UID})"
fi

if [ -d certs ]; then
  chmod 700 certs
  [ -f certs/server.key ] && chmod 600 certs/server.key
  [ -f certs/server.crt ] && chmod 644 certs/server.crt
  echo "✓ certs/ tightened"
fi

# Postgres-alpine runs as UID 70 (postgres user inside the container).
# The pg_data dir must be owned by that UID so the container can read/write,
# while still being inaccessible to other host users. Mode 0700 + owner 70:70.
PG_UID=70
PG_GID=70
if [ -d pg_data ]; then
  chown -R "${PG_UID}:${PG_GID}" pg_data
  chmod 700 pg_data
  [ -d pg_data/data     ] && chmod 700 pg_data/data
  [ -d pg_data/data_v17 ] && chmod 700 pg_data/data_v17
  echo "✓ pg_data/ tightened (owner=${PG_UID}:${PG_GID}, mode=700)"
fi

echo
echo "Done. Verify with:"
echo "  stat -c '%a %U:%G %n' .env certs/server.key certs/server.crt pg_data"
