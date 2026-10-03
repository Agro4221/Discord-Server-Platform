# Project State

## Target
Self-hosted Discord Server Platform: local-first, resilient, modular, no artificial premium wall, simple UX, optional VPS deployment, optional multi-bot scaling for multiple voice channels.

## Current branch
development

## Current phase
Release candidate — code/CI verified, ready for live Discord validation.

## Working subsystems
- Discord Core with typed event bus and module lifecycle.
- PostgreSQL persistence + versioned migrations + advisory migration lock.
- Health/readiness endpoint and Discord connection supervision.
- Durable audit log.
- Local protected Management API.
- Schema-driven Next.js Control Center with session auth, functional-area navigation, capability/function index, module toggles, Discord channel/role selectors, grouped settings forms, import/export, backup management, module actions and specialized admin panels.
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
- Native Windows local runtime for low-overhead gaming/streaming, with single-Lavalink default and opt-in Dashboard/second Lavalink.

## Still under development
- Full AutoMod rule editor and richer response policies beyond the current persisted rule set.
- Full Security response workflow beyond the current anti-raid/quarantine/destructive-burst response.
- Full Automation condition/action catalog beyond the currently supported safe builder.
- Music provider breadth and multi-node failover validation beyond the current Lavalink foundation.
- Full multi-bot fleet orchestration beyond automatic stale-guild failover, persisted assignments and health UI.
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


## 2026-09-19 — Music resume/autoplay continuity
- Restored Lavalink players now repopulate the in-memory last-track marker from the resumed current track.
- This preserves the project's Autoplay chain across a process restart instead of requiring a fresh `trackStart` event.


## 2026-09-19 — Ticket and Temporary Voice lifecycle hardening
- Temporary Voice is now activated from the actual Discord ClientReady lifecycle instead of leaving its internal readiness gate permanently false.
- Disabling Temporary Voice now defers cleanup for occupied rooms; the durable room record remains so the normal leave handler can remove the room when it becomes empty.
- Tickets now run stale `closing` recovery at startup and every 60 seconds with safe error logging.
- Added regression coverage for the Temporary Voice lifecycle/cleanup rule and Ticket recovery startup path.


## 2026-09-19 — Ticket creation race UX
- Concurrent Ticket creation now recognizes PostgreSQL unique-open-ticket conflicts and reports that an existing ticket is already open instead of presenting a generic internal failure.
- The newly created Discord channel is still rolled back before returning the conflict response.


## 2026-09-19 — Multi-bot Music duplicate-handler fix
- Removed the secondary-identity direct `interactionCreate` Music handler.
- Music commands and buttons now use the shared Platform Event Bus, whose guild filter already enforces bot-identity ownership.
- This prevents duplicate Music command execution and duplicate interaction replies on secondary identities.


## 2026-09-19 — Ticket publication rollback consistency
- Ticket creation rollback now deletes the persisted `tickets` row when Discord channel publication fails after the row was inserted.
- This prevents a deleted Discord channel from leaving an `open` ticket that blocks future creation through the unique open-ticket index.
- Regression coverage exercises the failure path with a Discord publication error.


## 2026-09-19 — Starboard publication rollback
- Newly published Starboard messages are now deleted if the following database transaction fails before the `starboard_entries` row is committed.
- This prevents Discord messages from becoming orphaned when SQL persistence fails.


## 2026-09-19 — Role Panel update rollback
- Same-channel Role Panel edits now restore the previous Discord message when the following PostgreSQL update fails.
- This prevents the Dashboard/Discord state from diverging after an SQL failure.
- Added a regression fixture for the rollback sequence.


## 2026-09-19 — Security audit-window consistency
- Destructive-burst executor lookup now uses the configured `destructiveWindowSeconds` (clamped to the same 5–300 second range as configuration) instead of a fixed 30-second window.
- Added deterministic regression coverage for the lookback calculation.


## 2026-09-19 — Release-candidate clarification
- Added the administrator guide at docs/ADMIN-GUIDE.md.
- Added /moderate unban as a fully wired Discord command and regression-covered Moderation operation.
- Final automated CI run #553 was green before this command/documentation pass; a fresh CI run is required after these new changes.
- The project is ready for live server testing within the implemented feature set, but it is not a claim of total feature parity with every mature Discord multipurpose bot.


## 2026-09-19 — Control Center functional admin redesign
- Development HEAD: `829fb90678834f13bc210efe4e5fc7fe0373c32f`.
- The Dashboard primary entrypoint now uses `apps/dashboard/app/control-center.tsx` instead of the previous flat module presentation.
- Admin navigation is split into functional areas: Модерация и безопасность, Сервер, Сообщество, Автоматизация, Интеграции и медиа, Система, plus Обзор and a unified Все функции index.
- Module pages expose capabilities, command entry points, operational panels where available and logically grouped configuration sections while reusing existing Management API/Core handlers.
- Existing specialized panels for Role Panels, Giveaways, Analytics, Automation, Notifications, Bot Fleet and Backups remain integrated.
- Windows launcher `start-local.bat` closes automatically after a successful dashboard launch; failed startup still pauses to preserve diagnostics.
- CI run #603 on this code state passed all stages: dependency install/audit, source/deployment/observability checks, bot typecheck/tests/build, domain build and Dashboard production build.
- Live Windows launcher behavior (real browser open + terminal close) still requires validation on Windows; automated CI cannot validate desktop UX.## 2026-10-03 — Utility / AFK integration
- The Core now contains a `utility` module covering server/member information, avatar/role/channel inspection and persistent AFK.
- AFK state is durable in PostgreSQL and restored into an in-memory active-key cache on startup; normal messages clear the caller's AFK and mentions surface the stored reason.
- Utility commands are included in the module catalog and command-policy definitions, and Control Center has a dedicated Utility entry under the Community area.
- Added migration 40 (`persistent_afk`) and regression tests for utility command shapes and AFK helper behavior.
- This is a feature addition, not a live Discord acceptance result; real Discord behavior still belongs to the live release-gate suite.

## 2026-10-03 — AFK audit hardening
- Utility AFK set/clear operations feed the durable audit log without making user-facing operations depend on audit persistence success.
- AFK mention output is bounded and uses explicit user-only allowed mentions so stored reasons cannot trigger @everyone/@here/role notifications.
- Final feature-pass head: `c554a216bccd56a16ee9965a57031663ca877dd0`; automated CI on this final head remains the verification gate.

## 2026-10-03 — Next.js security update
- Dashboard dependency `next` was updated from `16.3.3` to `16.3.8` after CI's high-severity dependency audit rejected the previous version.
- No lockfile is tracked in the repository, so CI's `npm install` will resolve the patched version from the updated workspace manifest.

## 2026-10-03 — Community Tools
- Core now includes a Community Tools module for polls, suggestions, sticky messages and small fun commands.
- Poll/suggestion state is persisted in PostgreSQL; poll timers are reconstructed at startup.
- Community Tools is enabled by default in the catalog and can be disabled per guild like other modules.

## 2026-10-03 — Discord event logging
- Added the Logging module with persistent per-guild settings.
- Passive Discord events can now be routed to a dedicated log channel while remaining available in durable audit history.

## 2026-10-04 — Command routing / fleet continuity pass
- Latest development code head: `6c74c0f68e621ff44d7cbdf0089407f46a5b1301`.
- Added centralized command-policy parity checks, complete prefix allowlist coverage, root `/leveling` alias routing and automatic secondary-identity stale-guild failover.
- Deterministic regression coverage was added for command registry consistency, failover guard/claim behavior and passive-event guild isolation.
- CI on the preceding head passed; CI for the latest failover/alias head remains the active verification gate.


## 2026-10-04 — Control Center architecture checkpoint
- Control Center is now the intended local control plane for administrative operations; Discord commands remain fallback/user-facing entry points.
- Specialized operations currently surfaced include Moderation, Role Panels, Tickets, Leveling, Giveaways, Economy Shop, Starboard, Community Tools, Stream Alerts, Notifications, Automation, Custom Commands, Analytics and Music, plus system-level Server Settings, Command Policies, Diagnostics, Fleet and Backups.
- Generic module schemas continue to cover settings-heavy modules such as Temporary Voice, AutoMod, Welcome, Security, Verification, Logging and Music.
- Verification now has a dedicated operational panel for publishing the verification message; user verification itself remains an end-user Discord interaction.
- Giveaway creation is now available without Discord command entry; administrative giveaway lifecycle operations remain audited through Management API/Core.
- Current development head: `ab1f67805e8a164782e935c2422724a55f1c221f`.

## 2026-10-04 — Giveaway Dashboard wiring checkpoint
- Development head: `486e82260afa751c74bdcc305eea0a923f26c7eb`.
- Giveaway Control Center creation flow now has consistent channel-resource wiring across all Dashboard entrypoints.
- AutoMod and Music capability metadata is aligned with their already-existing operational UI.
- The preceding CI build failure was isolated to Dashboard TypeScript contracts around Giveaway panel props and a missing local style constant; backend typecheck/tests remained green.
- Fresh CI verification is pending for the atomic checkpoint head.

## 2026-10-04 — Control Center wiring verified
- Development head `1007677fc855a8ea6b62ff1fa8274294a9db96d0` passed CI run **#1239** across the full verification pipeline.
- Giveaway Control Center wiring is now confirmed by the production Dashboard build.
- Backend regression suite remains at 76 passing tests.

## 2026-10-04 — AutoMod CRUD verified
- Development head `0e79a64ab1cb0aa2c70ead8ae98b4950f2764b2a` passed CI run **#1242**.
- AutoMod is now a full Control Center surface: list, create/update, enable/disable and delete rules, with audit coverage for Dashboard deletion.

## 2026-10-04 — Security Center verified
- Development head `7ac4f4505479d518f8c55847466111124ca0ea6d` passed CI run **#1245**.
- Security is now a full Control Center module with active incident monitoring and Discord readiness checks.

## 2026-10-04 — Temporary Voice controls verified
- Development head `9a442b65c77a3cabc497f94635ef4efc6bfd6527` passed CI run **#1249**.
- Temporary Voice now supports user-facing room management through the Discord command surface while server setup remains Dashboard-configured.

## 2026-10-04 — Temporary Voice Control Center verified
- Development head `076a56031ca692f19b22fe98b7d91188c16a1541` passed CI run **#1253**.
- Temporary Voice is now a full Control Center module plus Discord `/voice` room-control commands.
- The local panel exposes active-room visibility and manual reconciliation; the runtime remains the source of truth for room ownership/state.

## 2026-10-04 — Welcome Control Center verified
- Development head `b9d3ac96021adc3f5c45dd9c81c1a34c327beacd` passed CI run **#1256**.
- Welcome is now a full Control Center module while its Discord `/welcome setup` command remains the fallback/user-facing configuration path.

## 2026-10-04 — Community Tools poll creator verified
- Development head `9be19adc51f501af87057178a1689f51414c2e01` passed CI run **#1260**.
- Community Tools is now a fuller Dashboard-first operational surface: create/close polls, moderate suggestions, and manage sticky messages.

## 2026-10-04 — Control Center consistency audit
- Development head `c9fd897e4a5574119480e4dfc6fd7d434a20cae3` passed CI run **#1262**.
- Operational module metadata, panel keys and rendered panel branches are now internally consistent for all `full` modules.

## 2026-10-04 — Economy Admin verified
- Development head `c8188f61840235c784560f7507d8276dee5acf59` passed CI run **#1268**.
- Economy is now a full operational module for both shop management and administrator balance control.

## 2026-10-04 — Command routing checkpoint
- Development head `e709c239a4bc3a852e7f55f719f47ba43e9cc54e` passed CI run **#1272**.
- Temporary Voice slash routing is now connected through the same event-bus lifecycle used by other command-driven modules.
