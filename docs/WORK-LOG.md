# Engineering Work Log

This file is the persistent continuity record for development across chats.

## 2026-09-19 — Repository bootstrap
- Confirmed private repository: Agro4221/Discord-Server-Platform.
- Development branch created from main.
- Product scope fixed as one coherent full build followed by continuous verification and later full stabilization.
- Quality standard: happy path is never sufficient; test negative paths, permissions, persistence, restarts, dependency failure, concurrency, security and cross-module behavior.
- Secrets must never be stored in the repository.
- Project is intended to run locally first and later move to VPS without architectural rewrite.

## 2026-09-19 — Foundation implementation started
- Current branch: development
- Latest known commit before this log entry: 07482375e87f0e6c1ba97af7a04439f0729dda29
- Implemented: bot workspace, config validation, JSON logger, health endpoint, PostgreSQL pool/transactions, migration runner with advisory locking, Discord command registration, connection health supervision, Temporary Voice persistence/reconciliation, moderation commands/case storage, module catalog/settings, local dashboard shell, worker shell and Docker Compose services.
- Continuous verification rule: every subsystem is checked while being built; defects should be fixed and regression-covered immediately rather than intentionally accumulated.
- Current stack verification from official/current sources: discord.js 14.x and @discordjs/voice currently require Node.js 24.17+; Lavalink 4.2.2 is the current release observed and 4.2.0+ includes DAVE support.
- Constraint: the execution environment currently has Node.js 22.16.0 and package installation from the network timed out, so live dependency compilation has not yet been performed here. The repository targets Node.js >=24.17.0.
- GitHub repository remains private.

## Continuity protocol
At the end of substantial work, update this file with:
- current branch and commit
- what was implemented
- what was verified
- known failures/blockers
- next concrete work
- architecture decisions that changed

Never write credentials, tokens or private user data here.
## 2026-09-19 — Continuous build phase: Control Center completion pass
- Branch HEAD: 1f55be443aa2736fb72d8d4431baff6d3a2e6095
- Completed Dashboard admin layers for Role Panels, Giveaways, Analytics, Automation and backup management.
- Added guild-scoped backup restore/delete and rejected cross-guild imports without explicit resource remapping.
- Added persisted Lavalink session-resume restoration and fixed current lavalink-client API compatibility.
- Added complete settings coverage for Verification, Leveling and Security destructive thresholds in config transfer.
- Replaced the Security hierarchy demo action with a real bot-permission/role-hierarchy check.
- Latest CI run #273 on this exact HEAD passed: dependency install, source hygiene, bot typecheck, bot tests, bot build and dashboard build.
- Bot regression suite currently reports 10/10 passing tests.
- Remaining engineering scope: AutoMod/Security depth, Music provider breadth + multi-node failover, multi-bot fleet orchestration/routing, remote backup retention, VPS install/upgrade tooling, and full live E2E/chaos/soak/security validation.
- Do not declare release complete until those remaining areas are either implemented or explicitly accepted as known limitations and the broader release-gate tests are run.


## 2026-09-19 — Release hardening: Giveaway lifecycle
- Branch HEAD after this pass: d5d0ca40b7e3841049c6b74e46a6822a8aeed882
- Found and fixed a functional gap where Giveaway participation buttons were rendered but never connected to the platform interaction event bus.
- Hardened entry insertion to be atomic with the Giveaway `running` state, removing a timing race with finalization.
- Hardened creation rollback so a Discord send or database message-id update failure does not leave a live orphan Giveaway.
- Giveaway completion now disables the original participation button and leaves a final result message.
- Added `apps/bot/test/giveaways.test.ts` covering event-bus wiring and rejection after the Giveaway stops running.
- CI run #277 passed with bot tests/typecheck/build and dashboard build.
- Remaining release-gate work is unchanged: full live Discord E2E/chaos/soak/security validation, broader AutoMod/Security/Automation depth, Music multi-node failover/provider breadth, multi-bot fleet orchestration/routing, remote backup retention, and VPS install/upgrade tooling.


## 2026-09-19 — Reliability and fleet hardening
- Branch: `development`
- Fixed sparse Discord member event payload handling in the shared Event Bus.
- Fixed Dashboard Fleet API auth import that blocked production Dashboard builds.
- Fixed AutoMod extended settings persistence and added regression coverage.
- Hardened Security log-channel diagnostics and exposed destructive thresholds in slash setup.
- Added Music shuffle/seek controls with control-plane permission checks.
- Fixed Automation `contains` condition to use the configured event field.
- Hardened automation import validation so malformed imported rules are rejected transactionally.
- Added local and remote backup retention enforcement.
- Hardened Notifications SSRF network filtering and added regression coverage.
- Hardened VPS upgrade prerequisites and removed premature fleet readiness reporting.
- Updated GitHub Actions checkout/setup-node to current Node 24-based action majors.
- Added multi-bot Music routing: PostgreSQL assignment table, Management API, Dashboard controls, secondary-identity Music-only interaction routing and migration coverage.
- Latest full CI baseline before the newest fleet commit passed all checks on commit `9838005dd3b0d8d6b37c5b616b06c148636a567c`.
- Current fleet change still requires a complete CI run before being considered verified.
- Next concrete work: finish Music repeat/autoplay/provider breadth, deepen Security/AutoMod response workflows, then expand fleet health/failover and full E2E/chaos/soak validation.


## 2026-09-19 — Verified fleet/Music/security hardening
- Verified HEAD: `670231a88e88d954ac44a01ca36c969c301a19e2`
- GitHub Actions run `35436484093` passed every CI stage: Actions checkout/setup, source hygiene, deployment config, bot typecheck, 23 bot tests, bot build and Dashboard production build.
- Music now has persistent repeat modes (`off`, `track`, `queue`) and guild-scoped autoplay, including resume-state restoration and same-voice/Manage Server control checks.
- Multi-bot Music routing is persistent per guild + voice channel; secondary identities register only Music interactions; primary Dashboard access remains available across its visible guilds.
- Background reminders, giveaways, notifications and Automation schedule rules are scoped through `guild_bot_assignments`, preventing duplicate processing across bot processes.
- Security burst detection now latches incidents for the configured window instead of repeatedly applying destructive responses to every subsequent event.
- Notifications advance feed cursors only after successful Discord delivery; SSRF network filtering covers special/private/mapped address classes.
- AutoMod extended settings persistence is regression-covered.
- GitHub Actions workflow now uses current Node 24-based `checkout@v7` / `setup-node@v7` majors.
- Known limitation remains live Discord E2E/chaos/soak validation because it requires user-owned Discord/Lavalink infrastructure and credentials.
- Next engineering focus: deepen Security/AutoMod response workflows, expand Music provider/failover validation, strengthen full fleet orchestration and complete the release-gate E2E/chaos/security matrix.


## 2026-09-19 — AutoMod detection/audit hardening
- Branch remains `development`.
- Implemented deterministic `detectAutoModViolation` coverage for all currently implemented AutoMod rule families.
- Added durable audit logging for handled AutoMod violations without storing message content.
- Fixed the exemption parser to split IDs on real whitespace/newline/comma separators; the previous expression treated the escaped characters incorrectly.
- Added regression coverage for exemption parsing and audit-event emission.
- Live Discord behavior remains unverified here; CI must provide the Node 24.17 dependency/build/test environment.
- Next concrete focus remains richer AutoMod/Security response workflows, then Music provider/failover depth and broader fleet/release-gate validation.


## 2026-09-19 — Local-first Windows launcher
- Branch: `development`.
- Added `scripts/start-local.ps1` as the local-PC entrypoint.
- Updated README and LOCAL-SETUP to make the Windows local path the primary documented workflow.
- Launcher bootstraps `.env`, generates management/database/Lavalink/session secrets, waits for bot and Dashboard health and auto-opens the Control Center.
- Added static deployment-contract checks for the launcher.
- Windows execution itself is not available in this Linux environment; this remains an explicit validation limitation.


## 2026-09-19 — Music autoplay and Lavalink health hardening
- Branch: `development`.
- Found a real functional gap: `autoplayNext()` existed but was never invoked by the playback lifecycle.
- Wired autoplay to queue-end, guarded against repeat modes and duplicate concurrent autoplay searches, and retained durable player persistence.
- Added dynamic Music module health based on connected Lavalink nodes plus reconnect/disconnect/destroy diagnostics.
- Added deterministic regression tests for autoplay eligibility and node health.
- Current validation limitation: live Discord/Lavalink playback and failover still require user-owned local infrastructure/credentials.


## 2026-09-19 — Music resume/autoplay continuity
- Found a restart-only gap where resumed players had a current track but no `lastPlayedTracks` marker, so custom Autoplay could stop after that track.
- Restored current tracks now repopulate the marker before the player state is persisted.
- Live restart + Lavalink resume remains a live-environment validation item.


## 2026-09-19 — Ticket and Temporary Voice lifecycle hardening
- Found that `TemporaryVoice.markReady()` was never called anywhere, so `handleVoiceState()` could remain permanently gated.
- Wired Temporary Voice activation to Discord ClientReady in `main.ts`.
- Fixed module-disable cleanup so occupied temporary rooms are not orphaned by deleting their DB record before the room empties.
- Found that `Tickets.recoverStaleClosures()` existed but was never invoked; added startup recovery plus a 60-second recurring sweep with caught errors.
- Added regression tests for both lifecycle paths.


## 2026-09-19 — Ticket creation race UX
- The existing partial unique index `uq_open_ticket_per_creator` already protects against two simultaneous ticket modals for one user.
- Hardened the error path so that conflict is identified explicitly after Discord channel rollback, giving the user a useful message instead of a generic creation failure.
- Added deterministic regression coverage for the PostgreSQL conflict classifier.


## 2026-09-19 — Multi-bot Music duplicate-handler fix
- Found that secondary identities registered Music interactions both directly on Discord Client and through the shared Platform Event Bus.
- Because secondary identities can own a guild in the Event Bus, the same Music interaction could be processed twice.
- Removed the direct handler and kept the Event Bus as the single routing path, preserving guild ownership filtering.
- Added regression coverage for the intended single-path routing invariant.


## 2026-09-19 — Ticket publication rollback consistency
- Found a consistency gap: channel creation succeeds, the ticket row is inserted, then the initial channel message can fail; the previous rollback deleted the channel but left the DB ticket row open.
- Added DB-row rollback keyed by ticket ID after Discord publication failure.
- Added a regression fixture covering channel deletion, user error response and persisted-row cleanup.


## 2026-09-19 — Starboard publication rollback
- Found a transaction-boundary gap: Starboard published the Discord message before persisting `starboard_entries`; a DB failure could leave an orphaned message.
- Added explicit rollback deletion for newly published messages when the transaction fails.
- Added deterministic coverage for the rollback decision.


## 2026-09-19 — Role Panel update rollback
- Found a transaction-boundary gap in same-channel Role Panel updates: Discord message edit happened before DB persistence, with no message rollback on SQL failure.
- Added explicit restoration of the previous panel content/components when the database update fails.
- Added regression coverage for the edit -> DB failure -> Discord rollback sequence.


## 2026-09-19 — Security configured audit-window consistency
- Fixed destructive-burst executor lookup to honor the guild's configured `destructiveWindowSeconds` instead of a hard-coded 30-second audit-log window.
- Added a bounded pure helper for the lookback cutoff and regression coverage for configured, clamped windows.
- Current code commits: `eeaa0fe3fbf20bcf16a36c612530c30631084dd4` and `94aa7f594f8c64f4424ab0bfcfc257864484ba36`.
- A fresh CI run should be treated as the verification gate for these changes; the connector does not expose push-triggered run listings for this private repository.


## 2026-09-19 — Final CI verification
- Current development HEAD before this log update: `506939661adc2b06038b0d2f1f0997269a52064f`.
- GitHub Actions run **#552** (`35442074459`) passed every stage: PostgreSQL service initialization, dependency install/audit, source hygiene, deployment/observability contracts, bot typecheck, bot tests, domain build, bot build and Dashboard build.
- Security configured audit-window hardening is therefore CI-verified on the current code state.
- Live Discord/Lavalink E2E, chaos, soak and clean-host VPS acceptance remain the only environment-dependent validation items; they require user-owned runtime credentials/infrastructure and are not reproducible inside this execution environment.


## 2026-09-19 — Control Center functional admin redesign
- Branch: `development`.
- Added `apps/dashboard/app/control-center.tsx` as the new primary Control Center UI and switched `apps/dashboard/app/page.tsx` to use it; the previous dashboard client remains in place as a fallback/source reference.
- Reworked the admin into functional areas: Обзор, Модерация и безопасность, Сервер, Сообщество, Автоматизация, Интеграции и медиа, Система, plus a unified Все функции index.
- Each module now exposes a visible capability/function list, command entry points, module state and (when available) an operational panel plus grouped configuration sections. Existing API endpoints and specialized panels are reused instead of duplicating backend logic.
- Preserved guild selector, search, module toggles, settings persistence, actions, audit log, import/export, Bot Fleet and backups.
- Updated `docs/ADMIN-GUIDE.md` to document the new admin layout.
- Restored Windows launcher behavior: successful `start-local.bat` execution now closes its launcher window after PowerShell finishes; failures still pause so the error remains visible.
- CI run #603 for the resulting code state passed all stages: dependency install/audit, source hygiene, deployment/observability contracts, bot typecheck/tests/build, domain build and Dashboard production build.
- Live Windows UX (auto-open + terminal close) still needs validation on a Windows machine.


## 2026-09-19 — CI verification after Control Center and launcher changes
- Verified development code state `829fb90678834f13bc210efe4e5fc7fe0373c32f`.
- GitHub Actions run **#603** (`35448567578`) passed every CI stage, including Dashboard production build after the Control Center rewrite and the launcher-contract checks after restoring successful-terminal-close behavior.
- This verifies that the repository still typechecks, tests and builds in the Node.js 24.17 CI environment after the changes.
- The remaining launcher-specific check is live Windows desktop behavior: confirm the browser opens and the launcher window then exits only on successful completion; failures should remain visible.

## 2026-09-19 — Native low-overhead Windows runtime
- Added start-native.bat / scripts/start-native.ps1 for a no-Docker local runtime.
- Default native gaming mode starts one Lavalink node and the compiled bot; the Dashboard is opt-in with -Dashboard, and the second Lavalink node is opt-in with -Lavalink2.
- Native Lavalink is explicitly capped to 128 MiB initial / 512 MiB maximum heap by default to avoid JVM auto-sizing consuming unnecessary desktop resources.
- Native builds run before Lavalink/bot startup so the first-run compiler spike is not concurrent with the runtime.
- Added docs/NATIVE-SETUP.md, native environment documentation and ignored .native-runtime/ launcher state.
- Docker local launcher now avoids image rebuilds on normal starts; -Rebuild performs an explicit no-cache image rebuild.
- Recommended single-PC gaming/streaming path: native mode, one Lavalink, Dashboard off except during administration.
- Live Windows runtime and actual Sea of Thieves + OBS + multi-RTMP load still require validation on the user's PC.## 2026-10-03 — Utility / AFK feature pass
- Added the new `utility` module to the Core module registry and Dashboard catalog; it is enabled by default unless explicitly disabled for a guild.
- Added `/serverinfo`, `/userinfo`, `/avatar`, `/membercount`, `/roleinfo`, `/channelinfo` plus `/afk set|clear|status`; matching prefix commands are wired through the existing command-policy router.
- Added persistent AFK storage in migration 40, automatic AFK removal on the user's next normal message, and AFK mention notifications.
- Added Utility metadata to Control Center so the module appears as a functional feature rather than an unclassified catalog item.
- Added deterministic tests for AFK formatting/reason normalization and slash-command registration.
- The container cannot resolve github.com, so local clone/build execution was unavailable. GitHub Actions CI for the immediately preceding test commit was observed in progress; the later cache-consistency fix requires a fresh green run before being called CI-verified.

## 2026-10-03 — AFK audit and notification hardening
- AFK state changes now use the existing durable audit pipeline as best-effort telemetry; an audit failure cannot turn a successful AFK operation into a command failure.
- AFK mention responses cap combined output and explicitly restrict allowed mentions to the AFK users, preventing stored reasons from producing unintended role/everyone/here pings.
- Final code head for this pass: `c554a216bccd56a16ee9965a57031663ca877dd0`.
- Local execution remains unavailable in this container because DNS cannot resolve github.com. A fresh GitHub Actions run on the final head is the authoritative automated verification gate.

## 2026-10-03 — Dashboard dependency security patch
- GitHub Actions dependency audit identified a critical Next.js vulnerability affecting the previously pinned Dashboard version `16.3.3`.
- Updated `apps/dashboard/package.json` to Next.js `16.3.8`, the patched version identified by the CI audit.
- The security patch is independent of the Utility/AFK implementation; the final green CI run is required before treating this combined code state as verified.

## 2026-10-03 — Community engagement feature pass
- Added the Community Tools module with persistent polls, suggestion workflow, sticky messages and lightweight fun commands.
- Polls support 2-5 options, one vote per user, live result refresh and automatic close/recovery after restart.
- Suggestions support moderator approval/rejection buttons and durable status history.
- Sticky messages persist across restart and are re-posted after new user messages in the configured channel.
- Added migration 41, command-policy entries, prefix routing, Control Center metadata and regression coverage.

## 2026-10-03 — Discord event logging
- Added a dedicated Logging module for configurable passive Discord event logging.
- Events covered: message delete/edit, member join/leave/update, voice joins/leaves/moves, channel deletion, role deletion and ban/unban.
- Logging is persisted through the existing audit event store and delivered to a configured dedicated Discord channel.
- Added migration 42, slash/prefix setup, Dashboard settings and Control Center metadata.
