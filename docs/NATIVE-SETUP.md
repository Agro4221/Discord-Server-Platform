# Native Windows mode

For a gaming/streaming PC, Discord Server Platform can run without Docker Desktop. This keeps the bot, Dashboard and local yt-dlp + FFmpeg playback as ordinary Windows processes instead of placing the application stack inside the Docker/WSL layer.

## Full native launch

Use:

    .\start-native.bat

The default native launch starts the full local platform required for acceptance testing:
- PostgreSQL as the local database
- the compiled Discord Server Platform bot
- the Control Center Dashboard
- the native Fleet supervisor for registered secondary Bot Identities

The Dashboard opens automatically after it becomes ready. Use:

    .\start-native.bat -NoOpen

to keep the Dashboard running without opening a browser window.

After a successful native startup, the launcher batch terminates its console window. An error keeps the console open so the failure can be read.

The legacy `-Dashboard` switch remains accepted for compatibility; Dashboard is enabled by default.
Registered secondary Bot Identities are supervised natively by the launcher without Docker. Each secondary process uses its own `BOT_IDENTITY_ID`, reads its encrypted Discord token from PostgreSQL and writes its PID/logs under `.native-runtime/`.

For a single-PC gaming setup, yt-dlp + FFmpeg is the normal music path. Direct URLs can come from YouTube, TikTok, Yandex Music, VK, SoundCloud and other yt-dlp-supported extractors. Spotify track links are accepted through metadata bridging to an available playable source. There is no separate Lavalink service to keep running.

## Native first-run bootstrap

The normal native launcher is intentionally self-contained. On first run it:
- reuses PostgreSQL portable binaries from .\tools\pgsql when present
- downloads PostgreSQL portable binaries automatically when they are missing
- initializes .postgres-data as UTF-8 when no local cluster exists
- starts the local PostgreSQL server automatically when it is stopped
- creates the discord_platform database automatically
- installs Node.js 24.21.0 automatically through winget when the required runtime is missing
- installs yt-dlp and FFmpeg through winget when the music tools are missing

No Docker Desktop is involved.

The launcher keeps runtime dependencies local to the machine/project where practical. PostgreSQL data lives under:

    .\.postgres-data

A working internet connection is required on a first run that needs to bootstrap missing dependencies.

The native launcher still uses the .env DATABASE_URL; the database engine remains PostgreSQL.

## Build behavior

The first native start builds the domain package and bot. The Dashboard is built during the normal native launch. Later starts reuse the compiled output.

Use -Rebuild after source/dependency changes:

    .\start-native.bat -Rebuild
    .\start-native.bat -Rebuild

This prevents the normal gaming launch from performing a large TypeScript/Next.js build every time.

## Stop

Stop only the Discord Server Platform processes started by the native launcher:

    .\start-native.bat -Down

The launcher stores temporary PIDs and logs under .native-runtime/, which is ignored by Git.

## Native release gate

Run the non-destructive native preflight after startup:

    powershell -ExecutionPolicy Bypass -File .\scripts\release-gate-native.ps1

Add `-Dashboard` when the Control Center is expected to be running.

The native gate checks the primary Bot process, Bot health/readiness, Management API authentication, enabled Fleet identities, native secondary-process PID state, Dashboard reachability when requested, and the required yt-dlp/FFmpeg tooling.

## Docker mode

Docker Compose remains supported for reproducible deployments and VPS use:

    start-local.bat

The normal Docker launcher no longer rebuilds images on every start. Use -Rebuild when an image rebuild is actually needed.



## Native diagnostics

For a read-only snapshot of the native runtime:

    powershell -ExecutionPolicy Bypass -File .\scripts\native-diagnostics.ps1

Include Dashboard when it is expected:

    powershell -ExecutionPolicy Bypass -File .\scripts\native-diagnostics.ps1 -Dashboard

For machine-readable output:

    powershell -ExecutionPolicy Bypass -File .\scripts\native-diagnostics.ps1 -Json

The Control Center System page also provides a live bot log panel and a graceful "Выключить бота" control.

The diagnostic report checks process/PID state, Bot health, Management API authentication, Fleet identity state, Dashboard reachability and yt-dlp and FFmpeg versions. Tokens/passwords are never printed.
