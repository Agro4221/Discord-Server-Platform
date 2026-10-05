# Local Setup

The supported everyday local mode is native Windows, without Docker Desktop. Docker is optional for reproducible deployment/VPS scenarios.

## One-click Windows startup

There is exactly one root launcher:

    start.bat

Normal first launch and all later launches use that same file. The default mode starts PostgreSQL, one Lavalink node, the Discord bot and the local Control Center.

The launcher automatically prepares missing local dependencies on first run when WinGet is available: Node.js LTS, PostgreSQL 17, Microsoft OpenJDK 17, npm dependencies and the pinned Lavalink 4.2.2 JAR.

The first run creates .env, generates local secrets, prepares the default PostgreSQL database, builds the project and opens the Control Center. Discord credentials are not requested before startup; register the bot in Control Center -> Bot Fleet.

Useful options, still through the same start.bat:

    start.bat -NoDashboard
    start.bat -Lavalink2
    start.bat -Rebuild
    start.bat -Down
    start.bat -Status

For details see docs/NATIVE-SETUP.md.

## Resource requirements

See docs/RESOURCE-REQUIREMENTS.md.

The resource tiers there describe only Discord Server Platform itself: PostgreSQL + one Lavalink + bot + local Control Center. Games, OBS, streaming software, browsers and other applications are intentionally excluded.

The practical target for a normal self-hosted installation is 8 GB RAM. 4 GB is the lower practical floor; 16 GB+ is headroom for much larger deployments and additional Lavalink/bot identities.

## First Discord setup

Create a Discord application and bot in the Discord Developer Portal. Open Control Center -> Bot Fleet and enter the Application / Client ID and Bot Token. The token is encrypted locally and is never returned to the Dashboard.

Enable the Gateway intents required by the bot and invite it to the test server with the permissions required by the modules you plan to use.

For command development, set DISCORD_TEST_GUILD_ID in .env so slash commands register to the test guild instead of waiting for global propagation.

## Runtime files

Native PID files and logs live under .native-runtime/, which is ignored by Git.

The launcher can report the tracked native process working set with:

    start.bat -Status

## Docker

Docker Compose remains supported as an optional deployment/reproducibility path. It is not required for the everyday Windows setup.

## VPS

VPS deployment continues to use the Docker-based path:

    sudo bash scripts/install-vps.sh

See scripts/install-vps.sh and scripts/upgrade.sh for the VPS deployment flow.
