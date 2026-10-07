# Master Plan / Technical Specification

## Product goal
Build a self-hosted Discord Server Platform whose primary purpose is to **replace the typical stack of third-party Discord bots and paid premium subscriptions** with one first-party bot/platform under our control.

The target is to combine the strongest useful functionality commonly found across products such as **Carl-bot, Juniper, MEE6, ProBot, Jockie Music and similar Discord bots**: moderation, automations, community tools, tickets, roles, utilities, notifications, music, security, analytics and administration — while avoiding artificial premium walls for functionality that should belong to the platform itself.

The project should not copy proprietary code or closed implementations. We implement equivalent or better capabilities in our own modular architecture, with a single configuration model, shared persistence, consistent permissions, diagnostics, recovery and one Control Center.

### Product principles
- **One platform instead of a pile of bots.** Prefer integrating a useful feature into the platform instead of requiring another external bot.
- **No mandatory paid subscription for core functionality.** The platform is self-hosted and should not depend on third-party premium plans for its intended feature set.
- **Best-of-breed feature selection.** Pull the strongest practical ideas from the ecosystem rather than blindly copying one bot's feature list.
- **Own the full stack.** Configuration, persistence, automation, moderation, music, security and administration remain under our control.
- **Better integration over feature accumulation.** Cross-module workflows, shared permissions, auditability, recovery and a unified UI are part of the product, not afterthoughts.


## Operating model
The same deployment must run on a local PC and later on a small VPS without changing application architecture. Dockerized services and persistent volumes are part of the design from the beginning.

## Reliability
- Module errors must not terminate the whole process where isolation is feasible.
- Restarts preserve durable configuration and reconstruct recoverable state.
- Discord Gateway disconnects use reconnection/backoff and health reporting.
- Temporary resources are reconciled against Discord state after restart.
- Music queue/history remains durable even when active playback cannot resume.
- Dashboard exposes component health and recent errors locally.
- Database migrations are versioned and repeatable.
- Logs distinguish recoverable external failures from programmer errors.

## UX
- Common actions discoverable without documentation.
- Prefer slash commands, buttons, select menus, modals, context commands and autocomplete.
- Simple actions stay visible; advanced actions go into menus.
- Dashboard uses toggles, guided forms and previews.
- Permission diagnostics explain exactly what is missing.
- RU and EN localization from the start.

## Modules
### Core
Command routing, module lifecycle, permissions abstraction, configuration, event bus, structured logging, health/readiness, database/migrations, recovery/reconciliation.

### Administration & Security
Warnings/infractions, timeout/kick/ban/unban, case history, moderation logs, AutoMod, anti-spam/flood/mention abuse, anti-raid/lockdown, anti-nuke, permission diagnostics and audit-log correlation.

### Temporary Voice
Create-on-join rooms, ownership/transfer, rename, user limit, privacy, allow/deny lists, category/name templates, auto-delete when empty, recovery/orphan cleanup.

### Community
Leveling, XP, ranks, leaderboards, role panels, giveaways, starboard, economy, reminders, AFK/utility, welcome/goodbye/verification, embeds and forms.

### Support
Tickets, claim/close/reopen/archive, transcripts, staff permissions, auto-close policies.

### Automation
Event -> conditions -> actions engine. Initial actions include messages, role changes, moderation actions, channel operations where permitted, temporary voice actions, logging, DM and webhook dispatch where appropriate.

### Notifications
YouTube, Twitch, Reddit, RSS, TikTok/Kick where stable and permitted, optional GitHub notifications. Providers are adapters and no single provider is a platform dependency.

### Music
Search/play by text, YouTube URLs and playlists through yt-dlp, queue/history/favorites/playlists, pause/resume/skip/stop/seek/volume/shuffle/repeat/autoplay, Discord player UI with FFmpeg decoding, durable state/recovery, multiple guilds, and multiple voice channels in one guild through additional bot identities managed by the control plane.

### Dashboard
Local web UI, health, guild/module toggles, guided setup, configuration forms, previews, logs/diagnostics, export/import, bot identity management and music node/session status.

## Architecture
Monorepo:
- apps/bot
- apps/dashboard
- apps/worker
- packages/config
- packages/database
- packages/discord
- packages/logger
- packages/permissions
- packages/events
- packages/automation
- packages/music
- infrastructure/docker
- docs

## Security
- No Administrator requirement by default.
- Secrets never committed.
- Server-side validation for Dashboard requests.
- Local Control Center is loopback/local-first and has no end-user login/session layer.
- Management API is protected by an internal bearer key and rate-limited.
- Rate-limit sensitive endpoints.
- Audit configuration changes.
- Never log credentials or OAuth secrets.
- Provider adapters have a narrow failure/credential blast radius.

## Data
PostgreSQL is the source of truth for configuration and durable state; in-memory caches are disposable.

## Deployment
Local: native Windows processes on the user's PC (PostgreSQL + yt-dlp + FFmpeg + Bot + optional Control Center + native Fleet supervisor), with no Docker Desktop/WSL requirement.
VPS: Docker-based topology with persistent volumes, reverse proxy, backups and monitoring.
The application architecture stays shared between native local and Docker/VPS deployment paths; runtime launch tooling may be OS-specific where required.
