# Multi-Bot Deployment

The platform supports multiple bot identities by running multiple copies of the bot service against the same PostgreSQL database.

Each process has its own Discord credentials and `BOT_IDENTITY_ID`, while sharing the same database and Lavalink cluster.

Secrets stay in environment variables. They are never stored in PostgreSQL or exposed to the dashboard.

Separate processes keep Gateway reconnect behaviour isolated. A broken identity therefore cannot take down the other bot instances.

Example primary identity:

```env
BOT_IDENTITY_ID=primary
DISCORD_TOKEN=...
DISCORD_CLIENT_ID=...
```

Example second identity:

```env
BOT_IDENTITY_ID=music2
DISCORD_TOKEN_MUSIC2=...
DISCORD_CLIENT_ID_MUSIC2=...
```

Secondary identities must use identity-specific credentials. They do not fall back to `DISCORD_TOKEN` / `DISCORD_CLIENT_ID`, preventing an accidental second process from logging in as the primary bot.

Both processes use the same `DATABASE_URL`. The persistent music state already carries `bot_identity_id`, so queues and players stay identity-safe.


## Music voice-channel routing

The general guild assignment remains the ownership boundary for the shared Platform Event Bus. Music has a separate routing table so one guild can use multiple bot identities in different voice channels without duplicating every non-Music module.

- `guild_music_bot_assignments` maps `guild_id + voice_channel_id` to one bot identity.
- A bot identity can own at most one Music voice channel in the same guild because one Discord bot cannot occupy multiple voice channels simultaneously.
- Primary identity remains the fallback for unassigned Music voice channels.
- A secondary identity registers only the `/music` command and Music button interactions, then serves only voice channels assigned to that identity.
- Dashboard Control Center exposes these assignments under Bot Fleet.
- Assignment changes are audited and persisted in PostgreSQL.


## Control plane and background workers

The primary bot process remains the local control plane for guilds it can see in Discord, even when event ownership is assigned to a secondary identity. This keeps Dashboard administration available after a fleet assignment changes.

Background workers use `guild_bot_assignments` as their ownership boundary. Reminders, Notifications, Giveaways and Automation schedule reloads only process guilds assigned to the current `BOT_IDENTITY_ID`, preventing duplicate delivery/finalization across processes.

Music assignment is independent from the general guild assignment because one guild can use multiple bot identities simultaneously in different voice channels. The Music assignment table enforces one identity per voice channel and one voice channel per identity within a guild.
