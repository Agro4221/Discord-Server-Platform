# Multi-Bot Deployment

The platform supports multiple bot identities by running multiple copies of the bot service against the same PostgreSQL database.

The **primary** identity is bootstrapped from `.env` with `DISCORD_TOKEN` and `DISCORD_CLIENT_ID`.

Secondary identities are registered through **Control Center → System → Bot Fleet**. Their Discord token is validated through the Management API and stored encrypted at rest in PostgreSQL. The plaintext token is never returned to the Dashboard and is not required in a secondary identity `.env` file.

Separate processes keep Gateway reconnect behaviour isolated. A broken identity therefore cannot take down the other bot instances.

## Identity model

Example primary bootstrap:

```env
BOT_IDENTITY_ID=primary
DISCORD_TOKEN=...
DISCORD_CLIENT_ID=...
```

For a secondary identity, use the Control Center registration form:

- identity ID;
- Discord client ID;
- Discord bot token;
- optional presence name.

After registration, PostgreSQL is authoritative for that identity's credential. Changing the token in Control Center marks the identity for restart; stale environment values do not overwrite the stored credential.

Secondary identities must use identity-specific credentials and never fall back to the primary `DISCORD_TOKEN` / `DISCORD_CLIENT_ID`.

Both processes use the same `DATABASE_URL`. Persistent Music state carries `bot_identity_id`, so queues and players remain identity-safe.

## Music voice-channel routing

The general guild assignment remains the ownership boundary for the shared Platform Event Bus. Music has a separate routing table so one guild can use multiple bot identities in different voice channels without duplicating every non-Music module.

- `guild_music_bot_assignments` maps `guild_id + voice_channel_id` to one bot identity.
- A bot identity can own at most one Music voice channel in the same guild because one Discord bot cannot occupy multiple voice channels simultaneously.
- Primary identity remains the fallback for unassigned Music voice channels.
- A secondary identity registers only the `/music` command and Music button interactions, then serves only voice channels assigned to that identity.
- Control Center exposes these assignments under Bot Fleet.
- Assignment changes are audited and persisted in PostgreSQL.

## Control plane and background workers

The primary bot process remains the local control plane for guilds it can see in Discord, even when event ownership is assigned to a secondary identity. This keeps Dashboard administration available after a fleet assignment changes.

Background workers use `guild_bot_assignments` as their ownership boundary. Reminders, Notifications, Giveaways and Automation schedule reloads only process guilds assigned to the current `BOT_IDENTITY_ID`, preventing duplicate delivery/finalization across processes.

Music assignment is independent from the general guild assignment because one guild can use multiple bot identities simultaneously in different voice channels. The Music assignment table enforces one identity per voice channel and one voice channel per identity within a guild.