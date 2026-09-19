# VPS Installation

The production Compose topology contains PostgreSQL, two Lavalink nodes, the bot, and the Dashboard.

## Fresh install

The installer expects Git access to this private repository.

    sudo INSTALL_DIR=/opt/discord-server-platform REPO_URL=git@github.com:Agro4221/Discord-Server-Platform.git BRANCH=development bash scripts/install-vps.sh

It installs Docker when needed, prepares .env, prompts for the Discord credentials and dashboard password, generates server secrets, validates Compose, starts the stack, and waits for the bot health endpoint.

## Upgrade

    sudo INSTALL_DIR=/opt/discord-server-platform BRANCH=development bash scripts/upgrade.sh

The upgrade is fast-forward-only and stops with a non-zero exit code if the post-upgrade health check fails.

## Reverse proxy

Use infrastructure/caddy/Caddyfile.example with a real DOMAIN. Only the Dashboard is public. Keep ports 3001 and 3002 private.

## Remote backups

Set BACKUP_S3_ENDPOINT, BACKUP_S3_REGION, BACKUP_S3_BUCKET, BACKUP_S3_PREFIX, BACKUP_S3_ACCESS_KEY_ID, BACKUP_S3_SECRET_ACCESS_KEY and BACKUP_S3_FORCE_PATH_STYLE to enable optional S3-compatible backup storage. BACKUP_RETENTION_COUNT controls local retention.
