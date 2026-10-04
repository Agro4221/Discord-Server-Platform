# Local Setup

This project is local-first. The supported everyday setup is Docker Compose on the user's PC; the same topology can later move to a VPS.

## Native Windows mode

For a gaming/streaming PC, Docker Desktop is optional. Use the native launcher:

    .\start-native.bat

The default native mode starts one Lavalink node and the compiled bot. The Dashboard is off until you add -Dashboard. See docs/NATIVE-SETUP.md for PostgreSQL, Java and Lavalink JAR prerequisites.

Use -Lavalink2 only when you explicitly need a second Lavalink node for redundancy.

## Windows: one-command local start

Install Docker Desktop, clone the repository, and from the repository directory run:

    powershell -ExecutionPolicy Bypass -File .\scripts\start-local.ps1

On the first launch the script creates `.env` and generates the local management/database/Lavalink secrets. Discord credentials and user login are not requested by the launcher; register the bot in Control Center → Bot Fleet.

After the services become healthy it opens the local Control Center automatically:

    http://127.0.0.1:3000/

The Management API remains bound to loopback and is not intended to be exposed directly to the internet.

## Useful launcher options

    powershell -ExecutionPolicy Bypass -File .\scripts\start-local.ps1 -Rebuild

Rebuild images before starting the stack.

    powershell -ExecutionPolicy Bypass -File .\scripts\start-local.ps1 -NoOpen

Start everything without opening the browser.

    powershell -ExecutionPolicy Bypass -File .\scripts\start-local.ps1 -Down

Stop the local stack.

## What runs locally

Docker Compose starts PostgreSQL, two Lavalink nodes, the bot and the Next.js Control Center. Persistent PostgreSQL data is stored in the `dsp-postgres` Docker volume.

The bot exposes health and Management API ports only on `127.0.0.1`. The Dashboard is also loopback-only by default.

## First Discord setup

Create a Discord application and bot in the Discord Developer Portal. Open Control Center → Bot Fleet and enter the bot Application / Client ID and Bot Token; the token is stored encrypted locally and is never returned to the Dashboard. Enable the Gateway intents required by the bot, then invite the bot to the test server with the permissions needed by the modules you plan to use.

For command development, set `DISCORD_TEST_GUILD_ID` in `.env` so slash commands register to the test guild instead of waiting for global propagation.

## Troubleshooting

See container state with:

    docker compose ps

See bot logs with:

    docker compose logs -f bot

See Dashboard logs with:

    docker compose logs -f dashboard

Restart the stack with:

    docker compose restart

Remove containers without deleting the PostgreSQL volume with:

    docker compose down

Do not commit `.env`. Secrets stay in the local environment.

## VPS

VPS deployment uses the same application architecture. See `scripts/install-vps.sh` and `scripts/upgrade.sh` for the Docker-based deployment path.


## VPS deployment with protected public Dashboard

For a VPS deployment, use the installer from a clean Ubuntu/Debian-style host:

    sudo bash scripts/install-vps.sh

The installer creates Docker configuration, generates database/Lavalink/Management API secrets, asks for the Dashboard domain and a dedicated Basic Auth credential, generates a Caddy password hash and starts the VPS Compose overlay.

The installer does not ask for the Discord bot token. After the Dashboard is available at https://<your-domain>/, authenticate with the Basic Auth credential and register the bot through Control Center -> Bot Fleet. The bot token remains encrypted by the application and is not returned to the browser.

The VPS overlay exposes only Caddy on ports 80/443. Bot health, Management API and the direct Dashboard port remain private.

For upgrades:

    sudo bash scripts/upgrade.sh

The upgrade script detects the generated infrastructure/caddy/Caddyfile and automatically uses docker-compose.vps.yml.

Before deployment, make sure the DNS A/AAAA record for the chosen domain points to the VPS and that ports 80/443 are reachable so Caddy can obtain and renew TLS certificates.
