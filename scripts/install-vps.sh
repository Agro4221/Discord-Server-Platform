#!/usr/bin/env bash
set -Eeuo pipefail

INSTALL_DIR="${INSTALL_DIR:-/opt/discord-server-platform}"
REPO_URL="${REPO_URL:-https://github.com/Agro4221/Discord-Server-Platform.git}"
BRANCH="${BRANCH:-development}"

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this installer as root or via sudo." >&2
  exit 1
fi

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || { echo "Missing command: $1" >&2; exit 1; }
}
need_cmd git
need_cmd curl
need_cmd openssl

if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
fi
systemctl enable --now docker

if [[ ! -d "${INSTALL_DIR}/.git" ]]; then
  mkdir -p "$(dirname "${INSTALL_DIR}")"
  git clone --branch "${BRANCH}" "${REPO_URL}" "${INSTALL_DIR}"
fi

cd "${INSTALL_DIR}"
git fetch origin "${BRANCH}"
git checkout "${BRANCH}"
git pull --ff-only origin "${BRANCH}"

[[ -f .env ]] || cp .env.example .env

read -r -p "Discord bot token: " DISCORD_TOKEN
read -r -p "Discord client ID: " DISCORD_CLIENT_ID

set_env() {
  local key="$1" value="$2" escaped
  escaped="$(printf '%s' "${value}" | sed 's/[\\&|]/\\&/g')"
  if grep -qE "^${key}=" .env; then
    sed -i "s|^${key}=.*|${key}=${escaped}|" .env
  else
    printf '%s=%s\n' "${key}" "${value}" >> .env
  fi
}

set_env DISCORD_TOKEN "${DISCORD_TOKEN}"
set_env DISCORD_CLIENT_ID "${DISCORD_CLIENT_ID}"
set_env MANAGEMENT_API_KEY "$(openssl rand -hex 32)"
set_env BOT_CREDENTIALS_ENCRYPTION_KEY "$(openssl rand -hex 32)"
set_env POSTGRES_PASSWORD "$(openssl rand -hex 24)"
set_env LAVALINK_PASSWORD "$(openssl rand -hex 24)"

chmod 600 .env
docker compose config >/dev/null
docker compose up -d --build


for _ in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:${HEALTH_PORT:-3001}/health" >/dev/null; then
    echo "Discord Server Platform is running."
    echo "Control Center: http://127.0.0.1:${DASHBOARD_PORT:-3000}/"
    exit 0
  fi
  sleep 2
done

echo "Health check failed." >&2
docker compose ps
exit 1
