# Local Setup

This project is local-first. The supported everyday setup is native Windows without Docker Desktop; the same application architecture can later move to a VPS. Docker Compose remains an optional deployment path.

## Native Windows mode

For a gaming/streaming PC, Docker Desktop is optional. Use the native launcher:

    .\start-native.bat

The default native mode starts one Lavalink node and the compiled bot. The Dashboard is off until you add -Dashboard. See docs/NATIVE-SETUP.md for PostgreSQL, Java and Lavalink JAR prerequisites.

Use -Lavalink2 only when you explicitly need a second Lavalink node for redundancy.

## Windows: one-command local start

Install Node.js 24.17+, PostgreSQL, Java compatible with the selected Lavalink release and a Lavalink JAR. Clone the repository, then run:

    .\start-native.bat

Use `-Dashboard` when you need the local Control Center and `-Lavalink2` only for a two-node redundancy run.

On the first launch the native launcher creates `.env`, asks only for the Discord bot token and Discord client ID, then generates the Management API key, bot-credential encryption key and Lavalink password. The local Control Center has no end-user login.

When `-Dashboard` is requested and the services become healthy, it opens the local Control Center automatically:

    http://127.0.0.1:3000/

The Management API and Dashboard are bound to loopback in native mode and are not intended to be exposed directly to the internet.

After startup, run the read-only native release gate:

    powershell -ExecutionPolicy Bypass -File .\scripts\release-gate-native.ps1

## Useful launcher options

    .\start-native.bat -Dashboard

Start the Control Center.

    .\start-native.bat -Lavalink2

Start the optional second Lavalink node.

    .\start-native.bat -Rebuild

Rebuild native domain/bot output before starting.

    .\start-native.bat -Down

Stop the native Bot, Fleet supervisor, Dashboard and Lavalink processes started by the launcher.

## What runs locally

Native mode uses the separately installed PostgreSQL service, Java/Lavalink process(es), Node.js Bot process, optional Next.js Control Center and a lightweight PowerShell Fleet supervisor. No Docker Desktop or WSL layer is required.

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
