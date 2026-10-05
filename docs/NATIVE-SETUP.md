# Native Windows mode

Native Windows is the primary local mode for a gaming/streaming PC. Docker Desktop is not required and is not started by the native launcher.

## One-click startup

Use `start.bat` for the low-overhead everyday mode.

It starts:
- an already installed local PostgreSQL service/process;
- one Lavalink node;
- the compiled Discord Server Platform bot.

Dashboard is OFF by default to minimize background resource use.

Use `control-center.bat` when the web Control Center is needed.
Use `start.bat -Lavalink2` only when a second Lavalink node is actually needed for redundancy.
Use `stop.bat` to stop only the native processes tracked by this launcher.

Discord credentials are optional at process startup. The Management API and Control Center can start first; register the bot through Control Center → Bot Fleet. The bot token is stored encrypted by the application.

## Native requirements

Install these on Windows:
- Node.js 24.17+
- PostgreSQL with `psql.exe` and `pg_isready.exe` available in PATH;
- Java 17+ for the repository's Lavalink 4 runtime;
- a Lavalink JAR downloaded separately.

Lavalink officially supports standalone JAR execution and requires Java 17 or higher. citeturn374577search2turn374577search4

Set `LAVALINK_JAR_PATH` in `.env`. The default is `./infrastructure/lavalink/lavalink.jar`.
The repository does not commit a Lavalink JAR.

## Database

Native mode keeps PostgreSQL as the source of truth. The launcher uses `DATABASE_URL` from `.env`.

If PostgreSQL is installed as a Windows service but is stopped, the launcher attempts to start a local `postgresql*` service automatically. If the configured database is still unreachable, it asks for a working `DATABASE_URL` instead of modifying the database setup blindly.

## Resource caps

Default native limits are intentionally modest:
- Lavalink: `LAVALINK_JAVA_XMS=128m`, `LAVALINK_JAVA_XMX=512m`;
- Bot Node.js old-space: 768 MiB;
- Dashboard Node.js old-space: 512 MiB when Dashboard is enabled.

These are memory ceilings for the respective runtimes, not predictions of actual RSS.
See `docs/RESOURCE-REQUIREMENTS.md` for system tiers and the measurement procedure.

## Build behavior

The first native start builds the domain package and bot. Dashboard is built only when `control-center.bat` is used. Later starts reuse the compiled outputs.

Use `start.bat -Rebuild` after dependency/source changes when a clean rebuild is needed.

## Runtime files

PID files and logs are kept under `.native-runtime/`, which is ignored by Git.
Stdout/stderr logs are rotated when a log exceeds 10 MiB, keeping one previous copy.

Use `native-status.bat` to see the machine RAM/CPU information and current working set of tracked native processes.

## Docker

Docker remains supported as an optional reproducible deployment path and for VPS. It is not the everyday local launcher.
