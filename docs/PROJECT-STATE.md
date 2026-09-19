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
- Schema-driven Next.js Control Center with session auth, module toggles, Discord channel/role selectors, settings forms, import/export and backups.
- Moderation with case history.
- Temporary Voice with idempotency, ownership and reconciliation.
- AutoMod, Welcome, Verification, Leveling.
- Tickets with modal intake, staff claim, close and transcript.
- Role Panels with role hierarchy/tamper checks.
- Giveaways with durable entries and scheduled finishing.
- Economy with daily/pay/leaderboard, shop and transaction ledger.
- Reminders with retry/lease semantics.
- Starboard.
- Automation engine with persisted rules and cooldowns.
- Security/Anti-Raid and destructive burst detection.
- Notifications with HTTPS feed validation and SSRF protections.
- Analytics minute buckets.
- Music/Lavalink foundation with persistent queue store and bot identity namespace.
- Multi-bot identity persistence for separate-process fleet deployment.
- Config transfer and compressed local backups.
- Docker Compose / Dockerfiles for local-to-VPS topology.

## Still under development
- Comprehensive multi-role panel editor and richer Dashboard action panels.
- Complete Giveaway admin UI/history/reroll UX.
- Full AutoMod rule editor beyond current core rules.
- Full Security response workflow beyond alert/quarantine.
- Full Automation condition/action catalog and visual builder.
- Music provider breadth, player resume restoration and multi-node failover validation.
- Multi-bot fleet orchestrator/health UI; current model is separate bot processes sharing DB/Lavalink.
- Full analytics Dashboard charts/reporting.
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
