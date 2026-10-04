# Implementation Strategy

## Product north star
The development target is not merely "a Discord bot with many commands". We are building a **self-contained replacement for the usual multi-bot stack**: combine the best useful functionality from bots such as **Carl-bot, Juniper, MEE6, ProBot, Jockie Music and similar products** into one platform so server owners do not need to depend on numerous third-party bots or pay multiple premium subscriptions.

Feature prioritization therefore follows this rule: **replace a dependency first, then improve the integration.** A feature counts as complete only when its core behavior is implemented in our platform and fits the shared permission, persistence, audit, dashboard and recovery model. We can be inspired by public product behavior, but implementation and architecture remain our own.


The product is intentionally developed as one large coherent private build. We do not optimize for many public mini-releases.

## Development phase — build the whole product

Implement the complete planned feature set and shared architecture before entering the formal stabilization cycle:

- Core Discord platform
- Local dashboard
- Temporary Voice
- Moderation and infractions
- AutoMod
- Security / anti-raid / anti-nuke
- Roles and role panels
- Welcome / verification
- Leveling
- Tickets and forms
- Giveaways
- Starboard
- Economy
- Reminders / utility
- Notifications / feeds
- Automation engine
- Music platform
- Lavalink integration
- YouTube and other provider adapters
- Multi-guild music
- Multi-bot identity management for multiple voice channels in one guild
- Analytics
- Export/import
- Recovery/reconciliation
- Backup/restore tooling
- VPS/Docker deployment path

Verification is continuous and aggressive throughout development. Every subsystem gets static checks, unit tests, integration tests where applicable, negative-path tests, permission tests, persistence/restart checks, and regression coverage as soon as its behavior exists. We still keep a later feature-freeze stabilization phase, but defects are fixed immediately rather than deliberately accumulated. The final QA phase is for exhaustive cross-module, adversarial, chaos, soak, security and recovery verification across the complete product.

## Stabilization phase — test everything

After the feature set is functionally complete, freeze feature work and run a dedicated QA/stabilization pass.

### Functional testing
Test every module through its normal UI and commands.

### Integration testing
Test cross-module workflows such as:
- member joins -> verification -> role assignment
- temporary voice -> ownership -> cleanup -> restart recovery
- moderation -> infraction history -> escalation -> logging
- ticket -> claim -> transcript -> close
- music -> provider -> Lavalink -> player controls -> recovery
- automation -> event -> conditions -> actions -> audit log

### Failure testing
Intentionally:
- kill/restart bot
- disconnect Discord Gateway
- disconnect database
- stop/restart Lavalink
- remove managed Discord resources
- remove required permissions
- provide malformed dashboard input
- cause provider timeouts/errors
- simulate stale/orphaned state

### Security testing
- Discord permission boundaries and role hierarchy
- Management API bearer authentication and guild-access boundaries
- stale/replayed dashboard action rejection
- rate limits
- secret leakage checks
- log redaction
- dangerous automation combinations

### Performance testing
Measure:
- startup
- command latency
- dashboard response times
- DB query behavior
- memory growth
- concurrent guild activity
- multiple music sessions

### Recovery testing
Verify the system can reconstruct durable state after process/service restarts and degrade gracefully when an external provider is unavailable.

## Finalization

Only after the stabilization cycle:
1. Fix discovered defects.
2. Re-run the affected and full regression suites.
3. Run backup/restore drill.
4. Produce local installation documentation.
5. Produce optional VPS deployment documentation.
6. Tag the first release candidate.
7. Decide whether/when the project should become public.

The first public version should be a coherent product, not a snapshot of unfinished development.
