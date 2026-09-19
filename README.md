# Discord Server Platform

Self-hosted Discord server platform focused on reliability, simple UX, local administration, modular features and optional multi-bot voice scaling.

## Principles
- Self-hosted first; VPS/cloud is optional.
- No artificial premium wall in the self-hosted build.
- Local dashboard is the primary configuration surface.
- Modules fail independently where practical.
- Persistent state lives outside process memory.
- No default Administrator requirement.
- One coherent private full build, with internal engineering checkpoints instead of many tiny public releases.

## Planned stack
- TypeScript / Node.js 24+
- discord.js
- Next.js dashboard
- PostgreSQL
- Docker Compose
- Lavalink 4.x

## Project status
Repository bootstrap is complete. Full product scope is fixed; implementation starts with the reliability-critical foundation, then expands without changing the core architecture.

See:
- docs/MASTER-PLAN.md
- docs/IMPLEMENTATION-ORDER.md
- docs/FIRST-FUNCTIONS.md
- docs/TEST-STRATEGY.md

## Security
Never commit bot tokens, OAuth client secrets, provider secrets or database credentials.
