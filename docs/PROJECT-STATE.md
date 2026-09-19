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
- Multi-bot identity persistence for separate-process fleet deployment.
- Config transfer and compressed local backups with guild-scoped restore/delete controls.
- Docker Compose / Dockerfiles for local-to-VPS topology.

## Still under development
- Full AutoMod rule editor beyond current core rules.
- Full Security response workflow beyond alert/quarantine.
- Full Automation condition/action catalog beyond the currently supported safe builder.
- Music provider breadth and multi-node failover validation.
- Multi-bot fleet orchestrator/health UI; current model is separate bot processes sharing DB/Lavalink.
- Production backup retention/remote backup integration.
- Full E2E/chaos/soak/security test suite.
- VPS installer/reverse-proxy/upgrade tooling.

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
