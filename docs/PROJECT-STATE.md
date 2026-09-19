# Project State

## Target
Self-hosted Discord Server Platform: local-first, resilient, modular, no artificial premium wall, simple UX, optional VPS deployment, optional multi-bot scaling for multiple voice channels.

## Current branch
development

## Current phase
Full build — implementation + continuous verification.

## Working subsystems
- Discord Core with typed event bus and module lifecycle.
- PostgreSQL persistence + versioned migrations + advisory migration lock.
- Health/readiness endpoint and Discord connection supervision.
- Durable audit log.
- Local protected Management API.
- Schema-driven Next.js Control Center with session auth, module toggles, Discord channel/role selectors, settings forms, import/export, backup management, module actions and specialized admin panels.
- Moderation with case history.
- Temporary Voice with idempotency, ownership and reconciliation.
- AutoMod, Welcome, Verification, Leveling.
- Tickets with modal intake, staff claim, close and transcript.
- Role Panels with role hierarchy/tamper checks and Dashboard CRUD/publishing editor.
- Giveaways with durable entries, scheduled finishing, Dashboard history/end/reroll operations.
- Economy with daily/pay/leaderboard, shop and transaction ledger.
- Reminders with retry/lease semantics.
- Starboard.
- Automation engine with persisted rules/cooldowns and a constrained Dashboard builder.
- Security/Anti-Raid and destructive burst detection.
- Notifications with HTTPS feed validation and SSRF protections.
- Analytics minute buckets with Dashboard reporting.
- Music/Lavalink foundation with persistent queue store and bot identity namespace.
- Multi-bot identity persistence for separate-process fleet deployment, per-voice Music routing and identity-scoped background workers.
- Config transfer and compressed local backups with guild-scoped restore/delete controls, including local/remote retention enforcement.
- Docker Compose / Dockerfiles for local-to-VPS topology.

## Still under development
- Full AutoMod rule editor and richer response policies beyond the current persisted rule set.
- Full Security response workflow beyond the current anti-raid/quarantine/destructive-burst response.
- Full Automation condition/action catalog beyond the currently supported safe builder.
- Music provider breadth and multi-node failover validation beyond the current Lavalink foundation.
- Full multi-bot fleet orchestration/failover automation beyond persisted assignments and health UI.
- Full E2E/chaos/soak/security test suite and live Discord validation.
- VPS installer/reverse-proxy production drill and clean-host acceptance.

## Verification
- GitHub Actions CI runs on Node.js 24.17.
- Source secret hygiene check is active.
- Unit regression tests exist for health, module registry, event bus and dashboard schema.
- Full dependency compilation is delegated to CI because this execution environment has Node.js 22.16.
- Discord live E2E requires user-owned Discord test credentials and has not been run here.

## Continuity
Read docs/WORK-LOG.md before continuing work in a new chat.
Read docs/TEST-MATRIX.md before declaring a subsystem complete.
Never commit credentials, bot tokens, provider secrets or private user data.


## 2026-09-19 — Giveaway lifecycle hardening
- Fixed Giveaway participation buttons by subscribing the module to the shared `interaction` event.
- Entry insertion is now atomic against the `running` status, preventing a late click from entering during/after finalization.
- Failed giveaway publication now rolls the database row back and removes a partially created Discord message.
- Giveaway completion disables the original participation button and posts the final result.
- Regression coverage added for button wiring and post-finalization rejection.
- Latest relevant CI run: #277 on commit d5d0ca40b7e3841049c6b74e46a6822a8aeed882 passed typecheck, bot tests, bot build and dashboard build.


## 2026-09-19 — Multi-bot Music routing hardening
- Added migration 19 with persistent per-guild, per-voice-channel Music bot assignments.
- Added repository and Management API support for assigning/unassigning Music identities.
- Control Center Bot Fleet now manages Music assignments alongside identity health.
- Secondary bot identities register only Music commands and handle only Music interactions for assigned voice channels; the shared Platform Event Bus remains scoped by general guild ownership.
- Removed premature fleet `ready` heartbeat before Discord Gateway login.
- Added Music `shuffle` and `seek` controls with voice-channel / Manage Server authorization.


## 2026-09-19 — Verified fleet/Music hardening
- CI run 35436484093 passed on HEAD 670231a88e88d954ac44a01ca36c969c301a19e2.
- 23 bot tests passed, including AutoMod persistence, Security burst latch, Notifications SSRF filtering, Music repeat/control helpers, config-import validation, migration 20, backup retention and background worker guild isolation.
- Multi-bot Music routing now has persistent voice-channel assignments, Management API, Dashboard controls and secondary-identity Music-only command handling.
- Background workers are identity-scoped through guild_bot_assignments so only the assigned bot process processes reminders, feeds, giveaways and Automation schedule rules.
- Music repeat/autoplay is persisted and restored through player state / guild settings.


## 2026-09-19 — AutoMod detection/audit hardening
- Extracted AutoMod violation detection into a deterministic helper so content rules can be regression-tested without a live Discord message.
- Added coverage for blocked words, mentions, links/invites, emoji spam, line length, excessive caps and repeated messages.
- AutoMod violations now write durable `audit_events` entries with the rule, message ID and whether configured delete/timeout actions actually succeeded.
- Fixed exemption ID parsing so comma-, whitespace-, newline- and tab-separated channel/role IDs are handled correctly.


## 2026-09-19 — Local-first Windows launcher
- Added `scripts/start-local.ps1` for the primary local-PC workflow.
- First launch bootstraps `.env`, prompts only for Discord credentials and Dashboard admin password, generates local secrets, validates Compose, waits for bot + Dashboard health and opens Control Center.
- `-Rebuild`, `-NoOpen` and `-Down` cover the common local lifecycle without requiring manual Docker commands.
- Local ports remain loopback-only by default.
- Windows runtime validation is not available in this execution environment; CI validates the surrounding deployment contract and the launcher is intentionally dependency-light.


## 2026-09-19 — Music autoplay and Lavalink health hardening
- Wired the existing persisted Autoplay setting into the actual queue lifecycle; queue-end now searches for and appends a follow-up track when repeat is off.
- Added an in-flight guard so concurrent queue-end events cannot launch duplicate autoplay searches for one guild.
- Music now reports dynamic module health from Lavalink node connectivity: one connected node keeps Music ready, while loss of every node degrades only the Music module.
- Added reconnect/disconnect/destroy node lifecycle logging and regression helpers for autoplay eligibility and node health.
