# Discord Server Platform

Self-hosted, local-first Discord server platform with modular Core, PostgreSQL persistence, local Control Center and Lavalink music.

## Architecture

Discord Gateway -> Discord Core -> Typed Event Bus / Module Registry / Health & Recovery / Audit / Management API -> Next.js Control Center

Each feature module owns runtime logic and persistent settings. The dashboard receives field schemas from Core and renders the appropriate controls instead of hard-coding every module form.

## Control Center

- module switch = runtime enable/disable
- channel/role settings = Discord resource selectors
- numeric limits = constrained numeric inputs
- text = validated textareas
- dangerous actions = explicit action buttons / confirmation flows
- import/export = configuration payload
- backup = local compressed snapshot
- audit = persistent change history
- health = Discord / PostgreSQL / module state

The dashboard never receives bot tokens or provider secrets.

## Feature modules

- Moderation
- AutoMod
- Security / Anti-Raid
- Temporary Voice
- Welcome
- Verification
- Role Panels
- Leveling
- Tickets / Forms
- Giveaways
- Starboard
- Economy + Shop
- Reminders
- Notifications
- Automation
- Music / Lavalink
- Analytics

## Deployment

The same codebase supports local development, a single VPS deployment, and multiple bot identities as separate bot service instances sharing PostgreSQL/Lavalink.

See docs/LOCAL-SETUP.md, docs/MULTI-BOT.md, docs/TEST-MATRIX.md, docs/PROJECT-STATE.md and docs/WORK-LOG.md.

## Quality bar

A feature is not considered complete from a happy-path demo alone. Verification includes permissions, invalid input, persistence, restart recovery, dependency failure, concurrency, abuse/security cases and cross-module interactions.
