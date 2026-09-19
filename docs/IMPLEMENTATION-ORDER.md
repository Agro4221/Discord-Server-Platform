# Implementation Order

The whole product is in scope. We will not publish a sequence of tiny feature releases. Internally we still build in dependency order so each slice can be completed and tested before the next.

## Slice A — Platform foundation
- Monorepo/bootstrap
- TypeScript build
- Environment/config validation
- PostgreSQL + migrations
- Logger and error boundaries
- Health/readiness
- Discord client and interaction registry
- Module lifecycle
- Local dashboard shell/auth
- CI checks

## Slice B — Reliability-critical server controls
This is the first operational milestone because it directly addresses the original pain.
- Temporary Voice
- Restart reconciliation
- Discord reconnect handling
- Permission diagnostics
- Basic guild configuration in dashboard
- Moderation cases + audit log

Acceptance target: restart the bot, break/recover the Gateway, remove managed resources, and return to a sane state without corrupting durable configuration.

## Slice C — Music platform
- Lavalink integration
- Player/queue state model
- YouTube adapter
- Additional provider adapters after validation
- Discord player controls
- Multi-guild playback
- Multi-identity voice sessions
- Music recovery and diagnostics

## Slice D — Community/support
AutoMod, welcome/verification, role panels, tickets/forms, leveling, giveaways, starboard, reminders/utility and economy.

## Slice E — Automation/integrations/security
Automation engine, notification adapters, advanced anti-raid/anti-nuke and analytics.

## Slice F — Hardening/release candidate
Full integration matrix, failure injection, performance checks, backup/restore drill, packaging, local installer/docs and optional VPS deployment.

Feature completion means happy path + permission failure + persistence + restart behavior + documented external failure handling, where applicable.
