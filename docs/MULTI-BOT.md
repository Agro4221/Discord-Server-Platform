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
DISCORD_TOKEN=...
DISCORD_CLIENT_ID=...
```

Both processes use the same `DATABASE_URL`. The persistent music state already carries `bot_identity_id`, so queues and players stay identity-safe.
