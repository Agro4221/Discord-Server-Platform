# Project State

## Target
Self-hosted Discord Server Platform: local-first, resilient, modular, no artificial premium wall, simple UX, optional VPS deployment, optional multi-bot scaling for multiple voice channels.

## Current branch
development

## Current phase
Full build — foundation implementation.

## Implemented
- Monorepo workspace skeleton.
- Environment/config validation.
- Structured JSON logging.
- Local health/readiness HTTP endpoint.
- PostgreSQL pool and transaction wrapper.
- Versioned migration runner with advisory lock.
- Discord client with required gateway intents and command registration.
- /ping.
- /setup temp-voice.
- Temporary Voice creation, owner persistence, cleanup and startup reconciliation.
- Discord connection supervision/health reporting.
- Moderation module with warn/timeout/kick/ban and durable case records.
- Module catalog/settings persistence.
- Initial local Next.js dashboard shell.
- Worker shell.
- Docker Compose for PostgreSQL and Lavalink 4.2.2.
- Persistent test/quality/continuity documentation.

## Not complete
- Full dashboard authentication/RBAC and write API.
- Full AutoMod/security/roles/welcome/verification/leveling/tickets/giveaways/starboard/economy/reminders/notifications/automation/music/analytics.
- Multi-bot identity/session manager.
- Full music provider adapters and recovery.
- Comprehensive unit/integration/e2e/chaos/soak/security tests.
- Automated backups/restore.
- VPS packaging and installation UX.

## Verification status
Static review is ongoing. Full dependency compilation and Discord E2E have not been run in this environment because the available runtime is Node.js 22.16.0 while the target stack requires Node.js 24.17+, and network package installation timed out.

## Immediate next work
1. Make the local management API/dashboard security model explicit.
2. Strengthen Temporary Voice idempotency and orphan-resource recovery.
3. Implement the remaining full product modules using shared infrastructure.
4. Add test harnesses and regression coverage continuously.
5. Run live verification on Node.js 24.17+ with the user's Discord test application/guild credentials.
