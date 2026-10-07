# Local Setup

This project is local-first. The supported everyday setup is native Windows without Docker Desktop; the same application architecture can later move to a VPS. Docker Compose remains an optional deployment path.

## Native Windows mode

For a gaming/streaming PC, Docker Desktop is optional. Use the native launcher:

    .\start-native.bat

The default native mode starts PostgreSQL, the compiled bot and local yt-dlp + FFmpeg music tooling. The Dashboard is off until you add -Dashboard. See docs/NATIVE-SETUP.md for the local prerequisites.

There is no separate Lavalink node in the current Music architecture.

## Windows: one-command local start

Install Node.js 24.17+, PostgreSQL, yt-dlp and FFmpeg. Clone the repository, then run:

    .\start-native.bat

Use `-Dashboard` when you need the local Control Center.

On the first launch the native launcher creates `.env`, asks only for the Discord bot token and Discord client ID, then generates the Management API key and bot-credential encryption key. Missing yt-dlp/FFmpeg are installed through winget when available. The local Control Center has no end-user login.

When `-Dashboard` is requested and the services become healthy, it opens the local Control Center automatically:

    http://127.0.0.1:3000/

The Management API and Dashboard are bound to loopback in native mode and are not intended to be exposed directly to the internet.

After startup, run the read-only native release gate:

    powershell -ExecutionPolicy Bypass -File .\scripts\release-gate-native.ps1

## Useful launcher options

    .\start-native.bat -Dashboard

Start the Control Center.


    .\start-native.bat -Rebuild

Rebuild native domain/bot output before starting.

    .\start-native.bat -Down

Stop the native Bot, Fleet supervisor and Dashboard processes started by the launcher.

## What runs locally

Native mode uses PostgreSQL, Node.js, local yt-dlp + FFmpeg tooling, the Bot process, optional Next.js Control Center and a lightweight PowerShell Fleet supervisor. No Docker Desktop or WSL layer is required.

## First Discord setup

Create a Discord application and bot in the Discord Developer Portal and put its token/client ID into the first-run prompts. Enable the Gateway intents required by the bot, then invite the bot to the test server with the permissions needed by the modules you plan to use.

For command development, set `DISCORD_TEST_GUILD_ID` in `.env` so slash commands register to the test guild instead of waiting for global propagation.

## Troubleshooting

Native process state and logs are stored under `.native-runtime/`.

Bot logs:

    .native-runtime/logs/bot.out.log
    .native-runtime/logs/bot.err.log

Fleet logs:

    .native-runtime/logs/fleet-reconciler.log

Run the read-only release gate to identify which prerequisite is failing.

Do not commit `.env`. Secrets stay in the local environment.

## VPS

VPS deployment uses the same application architecture. See `scripts/install-vps.sh` and `scripts/upgrade.sh` for the Docker-based deployment path.

## Docker optional failover node

The normal Docker start runs PostgreSQL, Bot and Dashboard; Music runs inside the Bot container with yt-dlp + FFmpeg:

    .\start-local.bat

For a two-node Docker run:


Run the native release gate after startup to verify Bot health, Fleet state and the yt-dlp/FFmpeg tooling.