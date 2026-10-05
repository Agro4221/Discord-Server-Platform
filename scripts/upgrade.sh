#!/usr/bin/env bash
set -Eeuo pipefail

INSTALL_DIR="${INSTALL_DIR:-/opt/discord-server-platform}"
BRANCH="${BRANCH:-development}"

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this upgrade as root or via sudo." >&2
  exit 1
fi

for command in git curl docker openssl; do
  command -v "${command}" >/dev/null 2>&1 || {
    echo "Missing command: ${command}" >&2
    exit 1
  }
done

if [[ ! -d "${INSTALL_DIR}/.git" ]]; then
  echo "Install directory is not a git checkout: ${INSTALL_DIR}" >&2
  exit 1
fi

cd "${INSTALL_DIR}"
git fetch origin "${BRANCH}"
git checkout "${BRANCH}"
git pull --ff-only origin "${BRANCH}"

[[ -f .env ]] || cp .env.example .env

set_env() {
  local key="$1" value="$2"
  if grep -qE "^${key}=" .env; then
    sed -i "s|^${key}=.*|${key}=${value}|" .env
  else
    printf "%s=%s\n" "${key}" "${value}" >> .env
  fi
}

if ! grep -qE "^MANAGEMENT_API_KEY=.+$" .env; then
  set_env MANAGEMENT_API_KEY "$(openssl rand -hex 32)"
fi
if ! grep -qE "^BOT_CREDENTIALS_ENCRYPTION_KEY=.+$" .env; then
  set_env BOT_CREDENTIALS_ENCRYPTION_KEY "$(openssl rand -hex 32)"
fi
if ! grep -qE "^LAVALINK_PASSWORD=.+$" .env; then
  set_env LAVALINK_PASSWORD "$(openssl rand -hex 24)"
fi

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
