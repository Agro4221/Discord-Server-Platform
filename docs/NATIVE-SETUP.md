# Native Windows mode

Native Windows is the primary local mode for a gaming/streaming PC. Docker Desktop is not required and is not started by the native launcher.

## One-click startup

Use exactly one file:

    start.bat

By default it starts the complete local stack:
- an already installed local PostgreSQL service/process (or installs PostgreSQL 17 on first run);
- one Lavalink node (the 4.2.2 JAR is downloaded and SHA-256 checked on first run);
- the compiled Discord Server Platform bot;
- the local Control Center.

Discord credentials are optional at process startup. The first run can therefore reach Control Center → Bot Fleet before a Discord bot is registered.

Optional arguments use the same `start.bat` file:
- `start.bat -NoDashboard` — bot + PostgreSQL + Lavalink without Dashboard;
- `start.bat -Lavalink2` — add the second Lavalink node;
- `start.bat -Rebuild` — rebuild application artifacts;
- `start.bat -Down` — stop the native processes started by the launcher;
- `start.bat -Status` — show the machine RAM/CPU and tracked native process working set.

## First run

The launcher checks for Node.js 24.17+, Java 17+, PostgreSQL 17 and the native npm dependency tree. Missing Node.js, Microsoft OpenJDK 17 and PostgreSQL 17 can be installed automatically through WinGet; the launcher then refreshes PATH and continues.

On a fresh configuration it also:
1. creates `.env` from `.env.example`;
2. generates local Management API/Lavalink/PostgreSQL secrets;
3. installs npm dependencies;
4. installs/starts PostgreSQL and creates the default `discord_platform` database;
5. downloads Lavalink 4.2.2;
6. builds the domain, bot and Control Center;
7. starts the native processes and opens the local Control Center.

WinGet must be present on Windows. The launcher fails with an explicit message rather than silently falling back to Docker if App Installer/WinGet is unavailable.

## Native requirements

Supported runtime target:
- Windows x64;
- Node.js 24.17+;
- PostgreSQL 17;
- Java 17+;
- enough free SSD for dependencies, build output, PostgreSQL data and Lavalink.

Lavalink v4 officially requires Java 17 or newer and provides a standalone JAR release. The project pins Lavalink 4.2.2 for native startup. See https://lavalink.dev/ and https://github.com/lavalink-devs/Lavalink/releases/tag/4.2.2.

## Resource limits

Default native caps are intentionally conservative:
- Lavalink JVM: `-Xms128m -Xmx512m`;
- bot Node.js old-space: 768 MiB;
- Dashboard Node.js old-space: 512 MiB.

These are ceilings for the respective runtimes, not the total RSS of the processes. See `docs/RESOURCE-REQUIREMENTS.md` for the DSP-only hardware tiers.

## Runtime files

PID files and logs are kept under `.native-runtime/`, which is ignored by Git.
stdout/stderr logs rotate at 10 MiB and keep one previous copy.

## Docker

Docker remains supported as an optional reproducible deployment path and for VPS. It is not the everyday local launcher.
