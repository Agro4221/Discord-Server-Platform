# Master Plan / Technical Specification

## Product goal
Build a self-hosted Discord Server Platform that replaces the need for several third-party bots for normal server administration, community features, temporary voice rooms, automation, support workflows, notifications, and music.

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
Search/play by text, URL handling where permitted, YouTube plus other supportable providers, queue/history/favorites/playlists, pause/resume/skip/stop/seek/volume/shuffle/repeat/autoplay, lyrics where available, Discord player UI, Lavalink backend, multiple guilds, and multiple voice channels in one guild through additional bot identities managed by the control plane.

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
Local: Docker Compose on the user's PC.
VPS: same topology with persistent volumes, reverse proxy, backups and monitoring.
No hard-coded host paths or OS-specific assumptions.
