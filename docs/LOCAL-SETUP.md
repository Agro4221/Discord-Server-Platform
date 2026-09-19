# Local Setup

## Requirements

- Node.js 24.17+
- Docker Desktop / Docker Engine
- A Discord Application with a Bot user
- A private Discord test server

## 1. Create local environment

Copy `.env.example` to `.env`.

Generate a management key:

~~~bash
node scripts/generate-secret.mjs
~~~

Fill in:
- `DISCORD_CLIENT_ID`
- `DISCORD_TOKEN`
- `DISCORD_TEST_GUILD_ID`
- `DATABASE_URL`
- `MANAGEMENT_API_KEY`

Do not commit `.env`.

## 2. Start local infrastructure

~~~bash
docker compose up -d postgres lavalink
~~~

## 3. Install dependencies

~~~bash
npm install
~~~

## 4. Start bot

~~~bash
node --env-file=.env --import=tsx apps/bot/src/main.ts
~~~

## 5. Start dashboard

The dashboard runs locally on `http://127.0.0.1:3000`. Its server-side proxy talks to the local management API.

## Discord permissions

Do not grant Administrator by default. Temporary Voice needs View Channel, Connect, Manage Channels and Move Members; role hierarchy must also permit the bot to manage target members/resources.

## Test environment

Use a disposable private guild. Keep production servers out of the initial failure-injection cycle.

## Current limitation

The dashboard UI has working module toggles, but full authentication/RBAC, audit UI, setup wizard and complete module settings are still under development.
