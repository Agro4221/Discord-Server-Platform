# Native Windows mode

For a gaming/streaming PC, Vexa can run without Docker Desktop. This keeps the bot, Dashboard and Lavalink as ordinary Windows processes instead of placing the application stack inside the Docker/WSL layer.

## Everyday gaming launch

Use:

    start-native.bat

This intentionally starts only:
- PostgreSQL as the separately installed local database
- one Lavalink process
- the compiled Vexa bot

The Dashboard stays off to keep the background footprint low. When the Dashboard is needed:

    start-native.bat -Dashboard

The second Lavalink node is optional:

    start-native.bat -Lavalink2

Registered secondary Bot Identities are supervised natively by the launcher without Docker. Each secondary process uses its own `BOT_IDENTITY_ID`, reads its encrypted Discord token from PostgreSQL and writes its PID/logs under `.native-runtime/`.

For a single-PC gaming setup, the default one-node mode is the normal choice. The second node exists for redundancy/failover scenarios and is not required for ordinary music playback.

## Native requirements

Install these on Windows:
- Node.js 24.17+
- PostgreSQL with psql.exe and pg_isready.exe available in PATH
- Java runtime compatible with the Lavalink version used by the repository
- A Lavalink JAR downloaded separately

Set LAVALINK_JAR_PATH in .env to the Lavalink JAR location. The launcher defaults to:

    .\infrastructure\lavalink\lavalink.jar

The repository does not commit a Lavalink JAR.

The native launcher uses the existing .env DATABASE_URL. The database itself remains PostgreSQL; native mode does not replace it with a different database engine.

## Build behavior

The first native start builds the domain package and bot. The Dashboard is built only when -Dashboard is requested. Later starts reuse the compiled output.

Use -Rebuild after source/dependency changes:

    start-native.bat -Rebuild
    start-native.bat -Dashboard -Rebuild

This prevents the normal gaming launch from performing a large TypeScript/Next.js build every time.

## Stop

Stop only the Vexa processes started by the native launcher:

    start-native.bat -Down

The launcher stores temporary PIDs and logs under .native-runtime/, which is ignored by Git.

## Native release gate

Run the non-destructive native preflight after startup:

    powershell -ExecutionPolicy Bypass -File .\scripts\release-gate-native.ps1

Add `-Dashboard` when the Control Center is expected to be running. Add `-RequireLavalink2` only for a two-node acceptance run.

The native gate checks the primary Bot process, Bot health/readiness, Management API authentication, enabled Fleet identities, native secondary-process PID state, Dashboard reachability when requested and the configured Lavalink nodes.

## Docker mode

Docker Compose remains supported for reproducible deployments and VPS use:

    start-local.bat

The normal Docker launcher no longer rebuilds images on every start. Use -Rebuild when an image rebuild is actually needed.

