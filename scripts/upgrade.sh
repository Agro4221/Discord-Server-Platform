#!/usr/bin/env bash
set -Eeuo pipefail

INSTALL_DIR="${INSTALL_DIR:-/opt/discord-server-platform}"
BRANCH="${BRANCH:-development}"

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this upgrade as root or via sudo." >&2
  exit 1
fi

cd "${INSTALL_DIR}"
git fetch origin "${BRANCH}"
git checkout "${BRANCH}"
git pull --ff-only origin "${BRANCH}"

docker compose config >/dev/null
docker compose up -d --build

for _ in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:${HEALTH_PORT:-3001}/health" >/dev/null; then
    echo "Upgrade completed."
    exit 0
  fi
  sleep 2
done

echo "Health check after upgrade failed." >&2
docker compose ps
exit 1
