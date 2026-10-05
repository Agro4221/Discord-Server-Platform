#!/usr/bin/env bash
set -Eeuo pipefail

INSTALL_DIR="${INSTALL_DIR:-/opt/discord-server-platform}"
BRANCH="${BRANCH:-development}"
COMPOSE_ARGS=(-f docker-compose.yml)
if [[ -f infrastructure/caddy/Caddyfile ]]; then
  COMPOSE_ARGS=(-f docker-compose.yml -f docker-compose.vps.yml)
fi

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this upgrade as root or via sudo." >&2
  exit 1
fi

for command in git curl docker; do
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

get_env() {
  local key="$1" line value
  line="$(grep -E "^${key}=" .env | tail -n1 || true)"
  value="${line#*=}"
  value="${value#\'}"
  value="${value%\'}"
  printf "%s" "${value}"
}

is_blank() {
  local value="$1"
  [[ -z "${value//[[:space:]]/}" ]]
}

for required_secret in MANAGEMENT_API_KEY POSTGRES_PASSWORD LAVALINK_PASSWORD; do
  if is_blank "$(get_env "${required_secret}")"; then
    echo "Required secret is missing from .env: ${required_secret}" >&2
    exit 1
  fi
done
if [[ -f infrastructure/caddy/Caddyfile ]]; then
  for required_caddy_value in DOMAIN DASHBOARD_BASIC_AUTH_USER DASHBOARD_BASIC_AUTH_HASH; do
    if [[ -z "$(get_env "${required_caddy_value}")" ]]; then
      echo "Required Caddy setting is missing from .env: ${required_caddy_value}" >&2
      exit 1
    fi
  done
fi

docker compose "${COMPOSE_ARGS[@]}" config >/dev/null
docker compose "${COMPOSE_ARGS[@]}" up -d --build

if [[ -f infrastructure/caddy/Caddyfile ]]; then
  DOMAIN="$(grep -E '^DOMAIN=' .env | tail -n1 | cut -d= -f2-)"
  DOMAIN="${DOMAIN#\'}"
  DOMAIN="${DOMAIN%\'}"
  if [[ -z "${DOMAIN}" || ! "${DOMAIN}" =~ ^[A-Za-z0-9.-]+$ || "${DOMAIN}" != *.* ]]; then
    echo "DOMAIN is missing or invalid in .env." >&2
    exit 1
  fi
fi
for _ in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:${HEALTH_PORT:-3001}/health" >/dev/null; then
    dashboard_code="$(curl -sS -o /dev/null -w '%{http_code}' "http://127.0.0.1:${DASHBOARD_PORT:-3000}/" || true)"
    if [[ -f infrastructure/caddy/Caddyfile ]]; then
      caddy_code="$(curl -ksS -o /dev/null -w '%{http_code}' --resolve "${DOMAIN}:443:127.0.0.1" "https://${DOMAIN}/" || true)"
      if [[ "${dashboard_code}" == "200" && "${caddy_code}" == "401" ]]; then
        echo "Upgrade completed."
        exit 0
      fi
    elif [[ "${dashboard_code}" == "200" ]]; then
      echo "Upgrade completed."
      exit 0
    fi
  fi
  sleep 2
done

echo "Health check after upgrade failed." >&2
docker compose "${COMPOSE_ARGS[@]}" ps
exit 1
