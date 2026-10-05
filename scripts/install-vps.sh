#!/usr/bin/env bash
set -Eeuo pipefail

INSTALL_DIR="${INSTALL_DIR:-/opt/discord-server-platform}"
REPO_URL="${REPO_URL:-https://github.com/Agro4221/Discord-Server-Platform.git}"
BRANCH="${BRANCH:-development}"
COMPOSE_ARGS=(-f docker-compose.yml -f docker-compose.vps.yml)

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
need_cmd docker

if ! docker compose version >/dev/null 2>&1; then
  echo "Docker Compose plugin is unavailable." >&2
  exit 1
fi

if [[ ! -d "${INSTALL_DIR}/.git" ]]; then
  mkdir -p "$(dirname "${INSTALL_DIR}")"
  git clone --branch "${BRANCH}" "${REPO_URL}" "${INSTALL_DIR}"
fi

cd "${INSTALL_DIR}"
git fetch origin "${BRANCH}"
git checkout "${BRANCH}"
git pull --ff-only origin "${BRANCH}"

[[ -f .env ]] || cp .env.example .env
mkdir -p infrastructure/caddy
cp infrastructure/caddy/Caddyfile.example infrastructure/caddy/Caddyfile

read -r -p "Dashboard domain (DNS A/AAAA must point to this VPS): " DOMAIN
if [[ ! "${DOMAIN}" =~ ^[A-Za-z0-9.-]+$ || "${DOMAIN}" != *.* ]]; then
  echo "Invalid domain name." >&2
  exit 1
fi

read -r -p "Dashboard Basic Auth username [admin]: " DASHBOARD_BASIC_AUTH_USER
DASHBOARD_BASIC_AUTH_USER="${DASHBOARD_BASIC_AUTH_USER:-admin}"
if [[ ! "${DASHBOARD_BASIC_AUTH_USER}" =~ ^[A-Za-z0-9._-]{1,64}$ ]]; then
  echo "Invalid Dashboard Basic Auth username." >&2
  exit 1
fi

read -r -s -p "Dashboard Basic Auth password (min 12 chars): " DASHBOARD_BASIC_AUTH_PASSWORD
echo
if [[ "${#DASHBOARD_BASIC_AUTH_PASSWORD}" -lt 12 || "${DASHBOARD_BASIC_AUTH_PASSWORD}" == *$'\n'* || "${DASHBOARD_BASIC_AUTH_PASSWORD}" == *$'\r'* ]]; then
  echo "Dashboard password must be at least 12 characters and contain no line breaks." >&2
  exit 1
fi

DASHBOARD_BASIC_AUTH_HASH="$(docker run --rm caddy:2-alpine caddy hash-password --algorithm argon2id --plaintext "${DASHBOARD_BASIC_AUTH_PASSWORD}")"

set_env() {
  local key="$1" value="$2"
  if grep -qE "^${key}=" .env; then
    sed -i "s|^${key}=.*|${key}='${value}'|" .env
  else
    printf "%s='%s'\n" "${key}" "${value}" >> .env
  fi
}

set_env DOMAIN "${DOMAIN}"
set_env DASHBOARD_BASIC_AUTH_USER "${DASHBOARD_BASIC_AUTH_USER}"
set_env DASHBOARD_BASIC_AUTH_HASH "${DASHBOARD_BASIC_AUTH_HASH}"
set_env MANAGEMENT_API_KEY "$(openssl rand -hex 32)"
set_env POSTGRES_PASSWORD "$(openssl rand -hex 24)"
set_env LAVALINK_PASSWORD "$(openssl rand -hex 24)"

chmod 600 .env infrastructure/caddy/Caddyfile
docker compose "${COMPOSE_ARGS[@]}" config >/dev/null
docker compose "${COMPOSE_ARGS[@]}" up -d --build

for _ in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:${HEALTH_PORT:-3001}/health" >/dev/null; then
    echo ""
    echo "Discord Server Platform is running."
    echo "Public Control Center: https://${DOMAIN}/"
    echo "Register the Discord bot in Control Center -> Bot Fleet."
    exit 0
  fi
  sleep 2
done

echo "Health check failed." >&2
docker compose "${COMPOSE_ARGS[@]}" ps
exit 1
