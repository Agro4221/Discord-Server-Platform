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
- Live Windows runtime and actual Sea of Thieves + OBS + multi-RTMP load still require validation on the user's PC.


## 2026-10-03 — Kick stream alerts
- Added Kick as a stream-alert provider on `feature/music-v2`.
- Added optional `KICK_CLIENT_ID` / `KICK_CLIENT_SECRET` configuration and cached OAuth 2.1 App Access Tokens.
- Added Kick channel/live polling through the public API, including slug or broadcaster-user-ID targets and stream-start deduplication.
- Added `/streamalert create` and Dashboard support for Kick alongside the existing Twitch/YouTube/VK alert flow.
- Migration 62 extends the persistent stream-alert platform constraint to include Kick.
- Added deterministic tests for Kick target normalization; live provider behavior still requires real Kick developer credentials and a live channel.


## 2026-10-03 — Security response policy controls
- Added persistent Security response policy flags for Anti-Raid quarantine, destructive role removal and destructive quarantine.
- Exposed the same controls in Dashboard module settings and optional `/security setup` flags.
- Existing defaults preserve the previous behavior (all three response actions enabled).
- Added pure helper coverage for policy defaults; full live Discord response and lockdown behavior remain release-gate validation.


## 2026-10-03 — Music node failover
- Kept lavalink-client's built-in `autoMove` enabled and added an explicit fallback on node disconnect/destroy.
- Players still bound to a failed node are moved to another connected node with an active session; player state is persisted afterwards.
- Added a pure failover availability predicate test.
- Live two-node outage/recovery remains a release-gate drill because it requires real Lavalink + Discord voice traffic.


## 2026-10-03 — Product backlog reset: Music-first advanced feature roadmap
- Product direction clarified: Kick stream alerts are not a current priority. Existing Twitch, YouTube and VK Live notifications already cover the stream-alert use case used by the project; Kick remains optional/deferred rather than a reason to divert development effort.
- The persistent backlog in `docs/FEATURE-MATRIX.md` now explicitly captures the requested advanced Discord/music functionality and is the source of truth for the next implementation passes.
- Mandatory Music controller requirements recorded: persistent player message, compact emoji-based player controls/labels, clear state refresh after actions, and a **separate Loop One / зацикливание одного трека button** distinct from queue repeat.
- Advanced Music search/queue roadmap recorded: multi-result search picker, remove/range removal, reorder/move, insert-to-front, skip-to-track, queue clear, history/recent tracks, requester display, queue export/share, save queue as playlist and playlist shuffle loading.
- Advanced Music permissions/anti-abuse roadmap recorded: per-action DJ permissions, queue add/remove/move permissions, vote-skip, request cooldowns, per-user queue limits, fair requester rotation, max queue size and optional request approval/moderation mode.
- Advanced playlist/state roadmap recorded: shared/server playlists, individual track management, imports where supported, save queue, playlist/favorites shortcuts and richer pagination/management UI.
- Advanced audio roadmap recorded: Karaoke, pitch/speed, tremolo/other Lavalink effects, custom EQ editor, named effect profiles and persistence/restoration of effect state.
- Advanced autoplay/radio roadmap recorded: recent-track avoidance, artist/similarity-aware autoplay, radio mode, playlist continuation, and richer Dashboard controls.
- Advanced lyrics roadmap recorded: pagination, navigation buttons, synced lyrics where timing data exists and provider/status diagnostics.
- Provider expansion is explicitly a product requirement: Spotify, Apple Music, Deezer, **Yandex Music**, VK Music, Tidal, Qobuz, yt-dlp and JioSaavn are tracked as Music work, with the existing YouTube/SoundCloud path preserved. Provider readiness must be based on actual source-adapter/credential validation, not merely configuration presence.
- Product principle recorded: bring premium-like Music capabilities into the common self-hosted product without an artificial Premium wall; do not divert the roadmap into provider-count vanity work or unrelated integrations.
- Documentation update commit: `7dd1faaa3cb5b9c812a77acfe29e931f0f451c6b`.


## 2026-10-03 — Product scope correction: all-in-one Discord platform, not music-first
- Corrected the roadmap direction: Music is a major module, but it is **not** the product's center of gravity.
- The actual product target is a self-hosted all-in-one Discord platform intended to cover the practical capabilities of premium/mature multipurpose bots across administration, moderation, AutoMod/Security, logging, custom commands/autoresponders, roles/onboarding, tickets/forms, automation, community/engagement, notifications/integrations, analytics and Music.
- Current public Dyno/Carl-bot materials confirm the benchmark is broader than Music: AutoMod, action logging, autoroles, custom commands/autoresponders, automessages/autopurge, forms, tickets, embeds, reaction roles, feeds, leveling and related server-management tooling are part of the mature all-in-one feature set, with some features/limits placed behind commercial tiers. 
- Updated `docs/FEATURE-MATRIX.md` with a master all-in-one backlog spanning Administration, Moderation/AutoMod/Security, Server utilities, Roles/Onboarding, Tickets/Forms, Community, Automation, Notifications/Integrations and Analytics, while retaining the detailed Music roadmap as one module.
- Release order is now platform-wide: core/admin -> moderation/security -> utilities/roles/onboarding -> tickets/automation -> community -> notifications/analytics -> advanced Music -> Music providers/saved state -> whole-platform E2E/chaos/soak -> stable release.
- Product principle: reproduce useful premium-grade functionality as common self-hosted features without an artificial Premium wall; do not optimize for provider count or turn the project into a music-only bot.
- This correction is based on the current project direction and public competitor feature documentation, not on copying proprietary code or closed implementation details.
- Commits for this correction: `b2770f1c`, `d2ff12a7`.


## 2026-10-03 — Premium benchmark broadened across the Discord bot ecosystem
- Corrected the benchmark methodology: the project must not optimize against Carl-bot alone or treat one bot's Premium catalog as the definition of parity.
- `docs/FEATURE-MATRIX.md` now records a multi-bot benchmark set spanning MEE6, JuniperBot, ProBot, Dyno and Jockie Music, plus specialized bots where a focused module has deeper capabilities.
- MEE6 is used as a reference for broad plugin coverage including automations, moderator, custom commands, welcome/goodbye, levels, economy, giveaways, polls, invite tracking, reaction roles, social alerts, AI and Bot Maker. citeturn368099search1turn368099search17turn368099search11
- JuniperBot is used as a reference for deep AutoMod filters/exemptions/templates, custom commands/message templates, ranking, subscriptions, audit/logging, welcome/role restore and forms/components. citeturn510043search0turn510043search2turn510043search5
- ProBot is used as a reference for protection/anti-raid, logging, variables, autoroles/self-roles, starboard, server statistics, Twitch/YouTube notifications and custom-bot capabilities. citeturn410738search3turn410738search6
- Dyno is used as a reference for configurable AutoMod, custom commands, autoresponders, automessages, autodelete, forms, tickets, giveaways, reaction roles, embedder, feeds, AFK and larger/expanded module limits. citeturn410738search0turn410738search4turn410738search1
- Jockie Music is used specifically for advanced music architecture: multiple dedicated music bots, deep queue/collection handling, permission/session ownership, Spotify/Apple Music support, large collections and 24/7 behavior. citeturn410738search2turn410738search7
- Product principle: combine the strongest useful capabilities across these ecosystems while keeping one coherent permission/persistence/audit/Dashboard architecture. Premium parity means broad and deep functionality, not reproducing any single vendor's monetization model or copying proprietary code.
- Documentation commit for the broadened benchmark: `3569375679263c235be134696174146dec0e32e8`.


## 2026-10-03 — Canonical cross-chat handoff added
- Added **docs/PROJECT-HANDOFF.md** as the canonical continuity document for future chats.
- The handoff records: product goal, all-in-one scope, multi-bot benchmark methodology, implemented baseline across modules, complete high-level backlog, detailed Music backlog, provider requirements, priorities, explicit anti-drift rules, current branch/PR state, validation status and the exact procedure for continuing in a new chat.
- New chats must read `docs/PROJECT-HANDOFF.md` first, then `docs/PROJECT-STATE.md`, recent `docs/WORK-LOG.md` entries and `docs/TEST-MATRIX.md` before proposing new work.
- This is intended to prevent repeated re-explanation of the product goal and previously accepted decisions, especially the distinction between the all-in-one platform goal and the Music module.
- Handoff creation commit: `cee66211`; wording fix commit: `c9c5dbe4`.
## 2026-10-03 — AFK / away lifecycle
- Implemented persistent AFK state in migration 64 (`afk_users`) inside the existing Reminders module.
- Added `/afk [reason]` and prefix `!afk [reason]`; `off`, `clear`, `remove` and `unset` clear the current status.
- Setting AFK persists a reason and start time; a message mentioning an AFK user produces a relative-time notice.
- The first non-bot message sent after setting AFK atomically clears the sender's state and posts a short return notice.
- Added command-policy registration so AFK is visible/configurable in the existing Dashboard command policy editor without introducing a second permissions model.
- Added deterministic helper/command-schema regressions.
- Live Discord and restart validation remain release-gate checks.
## 2026-10-03 — AutoMod rule editor
- Exposed the existing `automod_rules` backend through a dedicated Dashboard editor instead of creating a parallel configuration model.
- Added CRUD UI for detector, action, threshold, window, timeout, role/channel scopes, moderator exemption and response template.
- Hardened per-rule validation for supported actions and numeric ranges; Dashboard deletions now write audit events.
- AutoMod `warn` now creates a real moderation warning through the existing warning/escalation pipeline.
- Activated the `emotes` detector alias so it behaves consistently with emoji-count detection.
- Added per-user/per-detector cooldown enforcement using the rule window so repeated matches do not spam sanctions.
- CI is the release gate for this increment; live Discord/resource hierarchy remains environment-dependent.

## 2026-10-03 — Custom Commands first-class module
- Promoted Custom Commands into the shared Module Catalog with a persistent module toggle.
- Existing execution now respects module state; creating a command enables the module for the guild.
- Added dedicated Dashboard CRUD for Prefix/Slash mode, aliases, response/alias/role actions and cooldowns.
- Reused the existing Management API and durable audit events instead of creating a parallel backend.


## 2026-10-03 — Continue platform expansion after Custom Commands CI regression
- Rechecked branch feature/music-v2 and PR #3.
- Current CI run 37141114378 has bot typecheck/tests and domain/bot builds green; only Dashboard build fails.
- Refactored the new Custom Commands Dashboard panel toward the established panel implementation pattern: optional async audit callback, no redundant client-side memoization, and hierarchy-safe role display.
- Added Custom Commands metadata to the Control Center catalog and included it in panel-aware rendering.
- Updated Feature Matrix / Handoff / State / Test Matrix so the current UI contract is documented and resumable from a fresh chat.
- Next engineering pass remains focused on platform breadth (not music-only), after restoring Dashboard CI.


## 2026-10-03 — AutoResponder / keyword triggers
- Implemented a dedicated `autoresponder` platform module on the shared PlatformEventBus.
- Added migration 65 with persistent rules, scopes, priority, cooldown and delete-source policy.
- Added Management API CRUD with audit events and Dashboard editor.
- Added exact/contains/starts-with/regex matching plus `{user}`, `{mention}`, `{server}`, `{channel}` templates.
- Added per-user cooldown and guild module lifecycle integration.
- Updated migration integration checks and canonical project logs.


## 2026-10-03 — AutoResponder performance hardening
- Added a short per-guild rule cache so message processing does not query PostgreSQL for the full rule list on every message.
- Cache entries are invalidated by create/update/delete and cleared on module shutdown.
- Added deterministic test coverage for cache reuse.

## 2026-10-03 — Ticket Intake Forms
- Added migration 66 for persistent ticket form definitions and per-ticket form data.
- Added TicketFormField normalization and dynamic Discord Modal generation with a maximum of five fields.
- Added Management API GET/PUT /api/guilds/:guildId/tickets/form with durable audit events.
- Added Dashboard Ticket Intake Form editor.
- Kept automatic legacy fallback to subject + description when no custom form exists.

## 2026-10-03 — Utility info suite
- Added `serverinfo`, `userinfo`, `roleinfo` and `channelinfo` to the shared command policy.
- Added Slash and Prefix implementations using Discord-native member, role and channel resolution.
- Added command-schema coverage and updated the product matrix.


## 2026-10-04 — Function-level command permission editor
- Expanded apps/dashboard/app/command-policy-panel.tsx from partial policy controls to the complete persisted command-policy surface.
- Added allowed-role, denied-role, allowed-channel and denied-channel editors plus help visibility; retained Prefix/Slash, enabled and cooldown controls.
- Kept the existing command_policies backend and shared guard; no duplicate permission architecture or migration added.
- Updated Feature Matrix / Project State / Test Matrix / Handoff for cross-chat continuity.


## 2026-10-04 — AutoMod ban action
- Extended the existing AutoMod rule builder with a first-class `ban` action.
- Routed AutoMod bans through `Moderation.applyAutomodBan()` for shared hierarchy validation, `moderation.ban.applied` audit and moderation-case persistence.
- Added migration 67 for the `automod_rules.action` constraint and Dashboard action selection.
- Added deterministic unit coverage and updated the canonical project logs.


## 2026-10-04 — Help policy defaults
- Fixed `/help` to merge persisted command policies over the shared `COMMAND_DEFINITIONS` defaults instead of showing only commands with existing DB rows.
- This makes newly introduced commands visible by default and keeps function-level help visibility consistent with the policy editor.


## 2026-10-04 — Ticket customization
- Extended Ticket settings with persistent panel title/description and create/claim/close button labels.
- Reused the existing Ticket module, form editor and Management API surface; no second ticket subsystem was introduced.
- Applied customization to prefix quick-panel plus create/reopen ticket controls.
- Added migration 68, Dashboard editor, API audit event and deterministic normalization tests.


## 2026-10-04 — Automation moderation depth
- Added warn/kick/ban Automation actions through the shared Moderation service with `automation` as actor.
- Fixed Management API validation mismatch for Dashboard-supported delay/webhook/branch actions; validation is now recursive.
- Added regression tests for moderation action validation.


## 2026-10-04 — Automation event context
- Expanded runtime event context so moderation/role/ticket workflows expose useful fields to conditions and templates.
- Added action/reason/moderator/role/case/ticket context without introducing a second event system.
- Kept existing event names and persistence contracts stable.


## 2026-10-04 — Automation dry-run
- Added `AutomationEngine.dryRun()` and Management API `/automation/dry-run` for safe preflight testing.
- Dashboard can test the current unsaved rule against synthetic event fields and inspect rendered action previews.
- No Discord mutation, webhook call or database write is performed by dry-run.


## 2026-10-04 — Music history / skip-to
- Persistent music_history stores the latest 200 played tracks per guild/bot identity.
- Added /music history and prefix !history.
- Added /music skip-to position and prefix !skip-to position, preserving the selected queued track at the front before skipping the current track.
- Migration/test gate advanced to schema version 79.

## 2026-10-04 — Automation richer conditions/actions
- Expanded Automation condition catalog with not-has-role, user-is-bot, channel-type-is and has-permission.
- Expanded action catalog with set-nickname and react-message.
- Kept dry-run, API validation, Dashboard builder and runtime execution on the same contract.
## 2026-10-04 — Automation workflow presets
- Added migration 70 with durable per-guild workflow presets storing event, ALL/ANY conditions, actions and cooldown.
- Added AutomationEngine preset CRUD with normalized names and the same validation contract as live rules.
- Added Management API CRUD with audit events and Dashboard save/load/delete controls.
- Included workflow presets in the existing Config Export/Import path with validation and safe ordering.
- Loading a preset only populates the Builder; it does not execute or publish the workflow automatically.

## 2026-10-04 — Automation retries and dead-letter
- Added migration 69 with durable dead-letter state for automation_delayed_jobs.
- Delayed jobs now execute in fail-fast mode so actual action exceptions leave the job eligible for retry instead of being marked completed.
- Retry policy uses bounded exponential backoff (5s, 10s, 20s, 40s, then dead-letter on the fifth failed attempt).
- Delayed jobs preserve originating rule_id across delay chaining for diagnostics.
- Invalid queued payloads are quarantined directly into dead-letter state.
- Dashboard diagnostics now surface dead-letter counts/status alongside pending, processing and error counts.
- Existing immediate Automation execution remains tolerant of individual action failures; retry behavior is scoped to durable delayed jobs.

## 2026-10-04 — Automation operational diagnostics
- Added AutomationEngine.diagnostics(guildId) over the existing automation_delayed_jobs and rule/template persistence.
- Diagnostics expose rule totals/event distribution, delayed-job pending/processing/error/completed-24h counts, oldest pending timestamp, recent job metadata and in-memory runtime counters.
- Management API exposes GET /api/guilds/:guildId/automation/diagnostics; route ordering keeps it distinct from rule item routes.
- Dashboard Automation Builder now shows a compact diagnostics section with manual refresh and recent delayed-job status/attempts/errors.
- Event payloads and action definitions are intentionally not returned by diagnostics to avoid exposing message/request content in an operational view.
- Added regression coverage for diagnostics aggregation and safe job metadata.
- This increment does not alter Automation execution semantics or introduce a second queue/logging system.


### 2026-10-04 — Welcome/goodbye embed images
- Welcome now supports optional persistent HTTPS image URLs for both welcome and goodbye embeds.
- The Dashboard exposes both image URLs with bounded length and HTTPS-only validation; slash `/welcome setup` accepts the same two options.
- Config export/import carries the new fields, and migration 80 adds the persistent columns.
- Added regression coverage for accepted, empty, malformed, non-HTTPS and oversized image URLs.


### 2026-10-04 — Welcome/Verification operational preview
- Welcome now exposes a Dashboard-safe preview action that renders the current configured welcome message/embed without assigning roles or touching a real member.
- Verification panel copy (title, description and both button labels) is now persisted and configurable from the generic Dashboard settings and `/verify setup`.
\n\n### 2026-10-04 — Universal Forms
- Added a first-class `forms` module for server owners: persistent form definitions with up to five short/paragraph fields, required/min/max validation and bounded labels/placeholders.
- Dashboard now provides form CRUD, channel selection, enable/disable, field editing and panel publishing.
- Discord exposes `/form publish`; public users launch the saved form through a button and submit answers through a Discord Modal.
- Answers are persisted separately and can be delivered to a configured response channel; configuration participates in export/import.
- Generic select-menu tooling remains outside this increment.


### 2026-10-04 — Role Panel select menus
- Role Panels now support both button and Discord select-menu components using the same persistent role definitions and selection modes.
- Select menus preserve toggle-style multi-selection, exclusive one-role selection and bounded max-selection behavior; timed role assignments continue to use the existing expiration worker.
- Dashboard editor and `/roles panel` expose the component choice, while config export/import preserves it.
- Legacy role panels default to buttons through migration compatibility.


### 2026-10-04 — Forms audit hardening
- Forms CRUD/publish operations keep one audit record per administrative path; Dashboard actions are logged by Management API, while Discord `/form publish` is actor-aware.
- Successful form submissions are audited without storing answer contents; processing and staff-channel delivery failures are logged and audited separately.
- Failed panel publication rolls the Discord message back if persistence fails.
- Corrected Discord snowflake validation and added regression coverage for form-field bounds, duplicate IDs, required/min/max validation and the five-field limit.


## 2026-10-04 — Local Control Center / bot registration
- Removed the local Dashboard user-login surface: login page and login/logout API routes are deleted, and the home page no longer redirects through a user session.
- Kept same-origin validation for mutating Dashboard requests; the bot Management API remains loopback-oriented for local-first operation.
- Added primary bot registration to Control Center/Fleet: Discord Application/Client ID, Bot Token, enabled state and presence text can be stored and updated from the local admin.
- Bot tokens are encrypted at rest with AES-256-GCM and are never returned by the Dashboard GET endpoint or written to audit metadata.
- Added reconnect-on-save and explicit audit logging for credential updates and connection failures.
- Bootstrap can now start the local Control Center without Discord credentials; environment credentials remain supported as a migration/bootstrap path.
- Added migration 84 for encrypted bot credentials and regression coverage for credential round-trip/encryption plus credential-less bootstrap.
- Known validation status at the end of this increment: CI run for the latest test-fix commit is in progress; the preceding run passed Typecheck but failed three stale/regression tests, which were corrected in this increment.
- Architecture decision: the first registered identity is the existing `primary` bot identity; secondary identities remain fleet infrastructure and are not exposed as a new registration flow in this increment.


## 2026-10-04 — Audit activity center
- Restored the missing Dashboard proxy for the existing Management API audit endpoint.
- Added filtered audit queries by source, action substring, actor user ID and cursor timestamp without changing the durable `audit_events` schema.
- Dashboard Audit page now shows source/actor/target context, filter controls, refresh/reset and cursor-based "load more" pagination.
- Added regression coverage for the filtered audit query and legacy bounded `recent()` behavior.
- Audit remains DB-backed source of truth; Discord channel delivery is still best-effort and separately observable.
- Current increment is limited to Administration/Audit; no other module feature work was introduced.


## 2026-10-05 — Onboarding Flow Builder
- Branch: `feature/music-v2`.
- Added first-class Onboarding module without duplicating Welcome, Verification or Role Panel responsibilities.
- Triggers: `member.join`, `verification.passed`.
- Steps: role assignment, channel message, DM; maximum 10 ordered steps.
- Added migration 85 and atomic durable flow/module configuration.
- Verification emits `verification.passed`; Onboarding handles the event via the shared Event Bus.
- Added hierarchy checks, per-step failure isolation, template rendering and aggregated audit events without storing message contents.
- Added Management API and Control Center builder.
- Added deterministic tests and PostgreSQL persistence coverage.
- Source implementation checkpoint: `f772b0503f3f5e5b9f9abb5f30625bacf5801068`.
- CI #1854 is the verification gate for this slice; no adjacent feature work was added.

    
## 2026-10-05 — Onboarding Flow Builder CI verification
- Final source HEAD: `de06195a8d70c18a01536231f3b587008f1309ba`.
- CI `#1857` completed successfully.
- Automated result: 123 tests passed; bot typecheck, domain build, bot build and Dashboard production build passed.
- The only CI correction after feature implementation was the pre-existing Audit Center `buttonStyle` function misuse exposed by the PR merge build; fixed with a one-line style-factory call.
- Onboarding slice is closed. Next work must start from exactly one next backlog module.


## 2026-10-05 — Dashboard previews / test actions
- Added Onboarding dry-run validation as a real read-only Dashboard test action.
- Validation checks flow enabled state, trigger dependencies, role existence/manageability/hierarchy, text-channel existence and bot ViewChannel + SendMessages permissions.
- DM steps are rendered as previews but explicitly reported as runtime-dependent because Discord user privacy/settings can block delivery.
- Dashboard displays structured issues and a rendered step preview.
- CI `#1862` passed: 123 tests, bot typecheck, domain build, bot build and Dashboard production build.
- Dashboard preview/test-actions backlog item is now considered implemented; future modules may add their own test surfaces using the same Management API/action conventions.


## 2026-10-05 — Per-module activity/error history
- Extended the existing AuditLog query contract with action-prefix and target filters.
- Added a whitelisted module-to-action-prefix mapping so module pages can retrieve their operational history without accepting arbitrary prefix queries from the browser.
- Added Management API module activity endpoint with bounded cursor pagination.
- Added a reusable Dashboard Module Activity panel to every module page.
- Error-like actions are highlighted when audit actions contain fail/error/denied/blocked; this is an audit-derived operational signal, not a replacement for internal structured error telemetry.
- Added regression coverage for prefix query construction and wildcard escaping.
- CI `#1873` passed.


## 2026-10-05 — Server configuration presets
- Implemented `ServerConfigPresetService` on top of the existing `ConfigTransferService`.
- Migration 86 added `server_config_presets` with per-guild unique names and indexed update time.
- Added Management API CRUD/apply endpoints and Control Center panel.
- Added preset name validation and database migration coverage.
- CI #1883 passed.


## 2026-10-05 — Configurable bot identity/profile
- Extended existing Fleet bot registration rather than introducing another identity system.
- Bot profile controls now include optional username and local avatar/banner file selection plus existing presence.
- Management API validates profile payloads, keeps the general JSON request limit at 64 KiB, and raises it to 8 MiB only for the bot profile endpoint.
- Discord profile changes are applied through the current logged-in bot user; avatar/banner payloads are transient and not persisted in the database.
- CI #1889 passed completely.


## 2026-10-05 — Docker / VPS foundation
- Removed obsolete VPS Dashboard admin-password handling from scripts/install-vps.sh.
- Added docker-compose.vps.yml with Caddy public reverse proxy and persistent Caddy data/config volumes.
- Updated infrastructure/caddy/Caddyfile.example to require hashed Basic Auth before reverse-proxying the Dashboard.
- VPS installer now prompts for domain + Basic Auth credentials, generates an Argon2id Caddy hash, writes literal quoted Compose env values, creates the local Caddyfile and starts the secure overlay.
- VPS upgrades automatically reuse the overlay when the generated Caddyfile exists.
- Generated Caddyfile is ignored by git.
- Strengthened scripts/check-deployment-contract.mjs with shell syntax and Docker Compose overlay validation.
- CI #1899 passed completely.


## 2026-10-05 — RU/EN localization foundation
- Added apps/bot/src/localization.ts with Locale, normalized locale selection and typed message keys.
- Migrated core /help and /embed responses plus the Discord command error boundary to the configured guild locale.
- Added deterministic localization tests covering RU/EN values and Russian fallback.
- CI #1904 passed completely.


## 2026-10-05 — Per-guild integration credentials
- Completed the per-guild credentials slice for Stream Alerts.
- Added encrypted PostgreSQL storage for Twitch, YouTube and Kick credentials with metadata-only GET responses.
- Added Management API CRUD, credential selection on Stream Alerts and foreign-key cleanup when credentials are deleted.
- Stream Alerts now resolves provider secrets per alert and caches Twitch/Kick OAuth tokens per credential instead of sharing one global token.
- Added Dashboard credential management and per-alert credential selection.
- CI #1917 is the final complete automated gate for this slice.
- Final code checkpoint before diagnostics work: `81dcc01269d34c90af9091d59d32c521d56dec98`.


## 2026-10-05 — Integration diagnostics
- Completed the Notifications/Integrations credential diagnostics slice.
- Added provider health-checks for stored Twitch, YouTube and Kick credentials without exposing secret values in API responses or audit metadata.
- Management API exposes `POST /api/guilds/:guildId/integration-credentials/:id/test` with safe status/latency output.
- Stream Alerts Dashboard lists credentials, supports test action, shows bounded diagnostic result and lets each alert select its own credential.
- Added deterministic diagnostics test with injected fetcher.
- CI #1923 passed completely.
- Final source checkpoint: `22f8e4856ef83120a5ebd2f678b826cad712c869`.
- Next single backlog slice: **Configurable analytics counters**.


## 2026-10-05 — Configurable Analytics counters
- Completed Analytics configurability on top of the existing persistent analytics system.
- Existing Dashboard settings now remain the source of truth for visible counters and retention; Discord `/analytics` now honors the same `visibleCounters` selection.
- Added exported normalization contract with whitelist/deduplication, bounded retention (1–3650 days) and safe fallback when an empty counter set is supplied.
- Added dedicated regression tests for counter normalization, retention bounds and custom visibility selections.
- CI #1926 passed completely.
- Final source checkpoint: `efd8eeef4505e5cf2d21d50c79e792ba83eb4637`.
- Analytics counters and retention/history settings are now considered implemented; live browser/Discord rendering remains a release-gate check.
- Next single backlog area: **Tickets / linked-related panels**.


## 2026-10-05 — Ticket Panels / linked entry points
- Completed the `Linked/related panels` ticket slice as persistent multi-panel Ticket entry points.
- Added migration 88 with durable `ticket_panels` and nullable `tickets.panel_id`.
- Panels support create/update/delete, enable/disable, channel move and Discord message refresh through Management API and Control Center.
- Panel buttons open the existing Ticket form/lifecycle; the source panel is persisted on created tickets.
- Config Export/Import preserves panel IDs and ticket-to-panel links.
- Added schema, normalization and config round-trip regression coverage.
- CI #1949 passed completely.
- Final source checkpoint: `879b684c418fda2d2e2ceaebd38852e9341feaa0`.
- Next single backlog slice: **Custom member rewards / milestones**.


## 2026-10-05 — Custom member rewards / milestones
- Verified the existing Leveling reward runtime and completed its missing administrative surface.
- Control Center now exposes a dedicated Level Rewards & Milestones builder using the existing persistent `leveling_rewards` table and Leveling runtime.
- Builder supports level, manageable role, previous-reward removal, optional DM and milestone message with `{level}`.
- Existing server-side hierarchy and bounds validation remain authoritative.
- CI #1955 passed completely.
- Final source checkpoint: `856e11e84539ed8c66a899bc792e9dc8bf45b832`.
- Next single backlog slice: **Community social widgets / engagement depth**.


## 2026-10-05 — Community social engagement hub
- Added a read-only Community Hub to the server Overview.
- Aggregates existing Reputation leaderboard, Leveling leaderboard, active Giveaways and open Polls; no parallel social data store was introduced.
- Added Management API `GET /api/guilds/:guildId/community/overview`.
- Added snapshot methods to Reputation and Polls and a Dashboard Community Hub panel with manual refresh.
- CI #1964 passed completely.
- Final source checkpoint: `2c1502e441097c40bbde9d431d1059b8d5a1855a`.
- Next single backlog slice: **Additional social feeds**.


## 2026-10-05 — Documentation reconciliation
- Reconciled stale Matrix rows for per-guild provider credentials and Additional social feeds; both were already implemented and CI-verified.
- Current code checkpoint before the next Music slice: `0056f930327f06c23f567ac81229617b4b79dd40`.


## 2026-10-05 — Music queue parity reconciliation
- CI #1982 verified the multi-result music search picker.
- CI #1986 verified Queue Export/Share and the current queue-control path.
- Reconciled Feature Matrix rows that were stale versus the actual Music implementation: search picker, queue remove/range/move/front/clear, skip-to, history, requester display, export/share, compact controls, Loop One, progress and controller refresh.
- Final source checkpoint: cd08f1b967030663d735da3b8f9d7c41cd5bbd17.
- Next single Music slice: Filters / FX quick-access button.


## 2026-10-05 — Music Filters / FX quick-access
- Added a dedicated Filters button to the Music controller.
- Quick palette reuses the existing filter manager: Clear, Bassboost presets, Rock, Classic, Pop, Electronic, Full Sound, Gaming, Nightcore and 8D.
- Filter actions enforce the same Music control permissions, persist state and refresh the controller.
- Added a whitelist contract test for filter actions.
- CI #1990 passed completely.
- Final source checkpoint: 6952f255a82af69702fe11e2ce11535052776192.
- Next single Music slice: Save queue button.


## 2026-10-05 — Music Save Queue
- Added a Save Queue button to the persistent Music controller.
- Button opens a Discord modal for playlist name and stores the current track plus pending queue using the existing music_playlists persistence.
- Playlist names are normalized and existing names are never overwritten silently.
- Added regression coverage for playlist-name normalization and unresolved queue-track serialization.
- CI #1997 passed completely.
- Final source checkpoint: 6f2d6b57ec49336eb96a6ba24975476e4bc413f3.
- Next single Music slice: Load playlist with optional shuffle.


## 2026-10-05 — Music playlist shuffle
- Added optional shuffle to saved playlist loading.
- Shuffle operates on a copy of stored playlist tracks, so persisted playlist order remains unchanged.
- Added regression coverage for non-mutating shuffle behavior.
- CI #2004 passed completely.
- Final source checkpoint: 7ff06bf24613e8efc9d24fd95bcd214138c24e79.
- Next single Music slice: Vote skip.


## 2026-10-05 — Music Vote Skip
- Added Vote Skip as a separate Music action while preserving DJ/Manage Server direct skip.
- Votes are short-lived, bound to the current track identifier and de-duplicated by user.
- Threshold is 60% of active human listeners in the current voice channel, with a minimum of one vote.
- Added /vote-skip and /music vote-skip plus regression coverage for the threshold contract.
- CI #2012 passed completely.
- Final source checkpoint: a87bc7803d200b371332b136e7bfe732b03bbdfe.
- Next single Music slice: Per-user request cooldown.


## 2026-10-05 — Music per-user request cooldown
- Added a five-second per-user/server cooldown after successful queue additions.
- Applied consistently to slash /play and the configured text request channel.
- Cooldown is in-memory, cleared on module shutdown and does not punish empty/failed searches.
- Added a deterministic remaining-time helper test.
- CI #2020 passed completely.
- Final source checkpoint: 04cb2828e9b112ec1212c09972582992b1dd9d4f.
- Next single Music slice: Per-user queued-track limit.


## 2026-10-05 — Music per-user queued-track limit
- Added migration 89 with max_queued_per_user on music_settings; default 10, range 0–100.
- Added /queue-limit and /music queue-limit management command.
- Enforced pending-track limits on play/request channel, search picker and saved playlist load; system autoplay remains exempt.
- Added pure helper tests for limit normalization, requester counting and remaining slots.
- CI #2034 passed completely.
- Final source checkpoint: c18f1de1a0a404531f1686e363cfa060c6232293.
- Next single Music slice: Max guild queue size.


## 2026-10-05 — Music controller permissions + autoplay
- Completed the Music controller permission parity slice and autoplay controller quick action.
- Persistent controller now has an Autoplay On/Off button; state is read from the existing guild autoplay setting.
- Controller actions map to the existing CommandPolicyService, so configured per-command role/channel restrictions apply to buttons as well as Slash/Prefix execution.
- Added shared member-action policy API and regression coverage for default allow, role/channel denies and disabled commands.
- CI #2056 passed completely.
- Reconciled stale matrix state for Max guild queue size, which was already implemented before this slice.
- Final source checkpoint: `af87eaa40211d33f2b49879c3ee210c9f6b266ac`.
- Next single Music slice: **separate queue add/remove/move permissions**.


## 2026-10-05 — Music queue permissions
- Completed separate Music queue mutation permissions.
- Added synthetic Command Policy keys: `queue-add`, `queue-remove`, `queue-move`.
- Queue-add policy is enforced on play/request-channel/saved-playlist/search-picker insertion paths.
- Queue-remove and queue-move policies are enforced on queue mutations; when no special policy is stored, existing DJ/Manage Server behavior remains the fallback.
- Control Center Command Policy can configure these scopes without a second permission store.
- CI #2063 passed completely.
- Source checkpoint for this slice: `cb859ef8abd6f44c8e34510f4c2db6ebcf77f512`.

## 2026-10-05 — Music Fair Queue / requester rotation
- Completed Fair Queue requester rotation for Music v2.
- Added deterministic round-robin balancing that preserves each requester's own FIFO order and groups unknown requesters together.
- Fair Queue is applied after manual queue additions, search-picker selection and saved-playlist loading when the persisted guild setting is enabled.
- Dashboard already exposes the persisted `fairQueueEnabled` setting; no second configuration store was introduced.
- Added regression coverage for multiple requesters, a single requester and unknown requesters.
- Repaired the migration tail while closing this slice: guild queue size is migration 90, Fair Queue is migration 91, and the previously missing vote-skip settings schema is migration 92.
- CI #2081 passed completely: deployment contract, typecheck, 155 tests, domain build, bot build and Dashboard build.
- Final source checkpoint: `c83d17491ce47aea11cabf214d4383032f5c3404`.
- Next single Music slice: **Optional approval/moderation mode for requests**.

## 2026-10-05 — Music Request Approval / moderation mode
- Completed the optional Music request approval mode for user requests.
- Added persisted `requestApprovalMode` setting with `off` (legacy immediate queueing) and `approval` modes; Dashboard and Config Export/Import expose the same setting.
- Added durable `music_request_approvals` storage with expiry, processing claim, resolver and result metadata so pending requests survive bot restarts.
- In approval mode, manual `play`, request-channel submissions and search-picker selections create moderation requests instead of directly mutating the queue.
- DJ-role or Manage Server members can Approve/Reject directly from the Discord request card; approval preserves the original requester identity.
- Approval rechecks voice ownership and current per-user/server queue limits before insertion, then applies Fair Queue when enabled.
- Added audit events for request creation, approval, rejection and processing failure without exposing secrets or full track payloads.
- Added regression coverage for approval-mode normalization and PostgreSQL request persistence.
- CI #2093 passed completely: deployment contract, Typecheck, Test bot, domain build, bot build and Dashboard build.
- Final code checkpoint: `9b412a48945a1c24693aa4bb60dfce5384ad6368`.
- Next single Music slice: **Server/shared playlists**.

## 2026-10-05 — Music Server / shared playlists
- Completed server-shared Music playlists on top of the existing `music_playlists` storage.
- Added persisted `visibility` with `personal` and `shared` modes plus a guild-wide unique name constraint for shared playlists.
- Shared playlists are visible to all members of the guild; personal playlists remain visible only to their owner.
- Creating a shared playlist and editing/deleting a shared playlist created by another user require DJ or Manage Server; loading shared playlists remains available to regular queue users under the existing Music queue policy.
- Existing personal playlist behavior was preserved, including current-track additions, 500-track cap and optional shuffle on load.
- Added command support through the existing `/music playlist` flow with a `shared` creation option.
- Added deterministic visibility normalization, migration smoke coverage and PostgreSQL scope regression tests.
- CI #2098 passed completely: deployment contract, Typecheck, Test bot, domain build, bot build and Dashboard build.
- Final source checkpoint: `e512c4f57fd23df31934cefd192cd46fe7ffbe5d`.
- Next single Music slice: **Playlist add/remove/reorder individual tracks**.

## 2026-10-05 — Music playlist track management
- Completed individual track management for Music playlists.
- Extended the existing `/music playlist` command with `view`, `remove` and `move` actions; track positions are 1-based and bounded to the existing 500-track playlist limit.
- `view` shows numbered track entries and safely bounds output for Discord message limits, making later remove/reorder actions practical from Discord itself.
- Personal and shared playlist permissions remain consistent with the previous slice: owners can edit their own playlists, while DJ or Manage Server can edit shared playlists owned by others.
- Removal and reordering use immutable helper functions with regression coverage, preserving the original array and rejecting invalid positions.
- CI #2103 passed completely: deployment/observability contracts, Typecheck, Test bot, domain build, bot build and Dashboard build.
- Final source checkpoint: `ba9114b24b5c759237623a8a4d028402fc0b8a62`.
- Next single Music slice: **Playlist search/filtering**.

## 2026-10-05 — Music playlist search / filtering
- Completed Music playlist search and filtering.
- Added `Search` to the existing `/music playlist` command with normalized text search, up to 25 displayed matches and a `shared-only` filter.
- Search respects the existing personal/shared visibility rules, so personal playlists remain private and shared playlists remain guild-visible.
- Playlist capacity remains `MAX_PLAYLIST_TRACKS = 500`; the 25-result limit only bounds Discord's displayed search/view output.
- Added unit coverage for search normalization and PostgreSQL coverage for personal/shared search scope.
- CI #2110 passed completely: observability/deployment contracts, Typecheck, Test bot, domain build, bot build and Dashboard build.
- Final source checkpoint: `0244df329476e9ed9f0922d9b6ec98473d8dff57`.
- Next single Music slice: **Import playlists from supported URLs**.

## 2026-10-05 — Music playlist URL import
- Completed importing Music playlists from supported HTTP(S) URLs through the existing `/music playlist` command.
- Added `Import URL` action with a destination playlist name; imported tracks are stored in their source order and capped at the existing 500-track playlist capacity.
- Duplicate track identifiers are removed during import while preserving the first occurrence.
- Personal imports remain private; shared imports use the existing DJ / Manage Server permission gate for shared playlists.
- URL input is validated as HTTP(S) before it reaches the Music resolver. The current Lavalink-backed resolver supplies the track list; this slice does not add a second provider-specific importer.
- Added regression coverage for import URL validation.
- CI #2114 passed completely: observability/deployment contracts, Typecheck, Test bot, domain build, bot build and Dashboard build.
- Final source checkpoint: `a7a2bb3a9325ebe0fb7c04feed9558f66cad2330`.
- Next single Music slice: **Save queue as playlist improvements**.

## 2026-10-05 — Music save queue as playlist improvements
- Completed the broader Save Queue → Playlist flow for Music.
- Added `Save current queue` to the `/music playlist` command, alongside the existing controller `💾` action.
- Queue saving can now target either a personal playlist or a server-shared playlist; shared creation uses the existing DJ / Manage Server permission gate.
- Both slash-command and controller queue saving use the same queue snapshot helper, preserving the current track first and capping the stored playlist at the existing 500-track capacity.
- Added regression coverage proving the snapshot keeps order, does not mutate the source queue and caps oversized queues at 500 tracks.
- CI #2119 passed completely: observability/deployment contracts, Typecheck, Test bot, domain build, bot build and Dashboard build.
- Final source checkpoint: `383453f3d99a4417a57f0a0a9ff3885f66cad2330`.
- Next single Music slice: **Play favorites / play playlist shortcuts**.

## 2026-10-05 — Music play favorites / playlist shortcuts
- Completed quick playback shortcuts for saved Music state.
- Added `Play` to `/music favorite`, using a 1-based favorite position (1–25) and the existing Music queue path so request cooldowns, queue policy and optional approval mode continue to apply.
- Added explicit `Play` to `/music playlist`; it reuses the existing saved-playlist loading path and therefore supports personal/shared visibility, shuffle and queue limits without duplicating playback logic.
- Added runtime validation for favorite positions and regression coverage for the visible 25-item favorite range.
- CI #2125 passed completely: observability/deployment contracts, Typecheck, Test bot, domain build, bot build and Dashboard build.
- Final source checkpoint: `81a484619fd88aea937d85b7c2fe04db82c26da1`.
- Next single Music slice: **Playlist pagination and richer management UI**.

## 2026-10-05 — Music playlist pagination / richer management UI
- Completed paginated Music playlist management UI.
- `List`, `Search` and `View tracks` now use temporary user-scoped Discord sessions with Previous / page / Next buttons instead of a hard 25-item display ceiling.
- Personal/shared visibility is rechecked from PostgreSQL on every page change, so deleted, moved or newly updated playlists/tracks are not served from a stale snapshot.
- A 500-track playlist can be viewed across 20 pages of 25 tracks; the 500-track storage capacity is unchanged.
- Pagination controls are handled before the active-player guard, so browsing saved playlists does not require Music playback to be running.
- Added pagination helper regression coverage and fixed the CI-discovered handler restoration issue before the final green run.
- CI #2135 passed completely: observability/deployment contracts, Typecheck, Test bot, domain build, bot build and Dashboard build.
- Final source checkpoint: `0403a96d5d67acc1a603b58048ff8476e4cceb6c`.
- Next single Music slice: **Playlist continuation after queue end**.

## 2026-10-05 — Music playlist continuation after queue end
- Completed automatic continuation for saved Music playlists when the initially loaded batch does not fit into the current queue limits.
- Added migration 95 with durable continuation state on `music_players`: playlist ID, next source index, optional saved shuffle order and original requester ID.
- Loading a playlist now stores continuation state when tracks remain beyond the first batch; when the queue reaches its end, the next batch is restored automatically from the same playlist.
- Saved shuffle order is reused for later batches instead of generating a new random order on every continuation.
- Continuation preserves the original requester identity and rechecks the current per-user/server queue limits plus Fair Queue before adding the next batch.
- Continuation state is restored after player recovery/restart and is cleared by explicit queue clearing, Stop, playlist completion or player destruction.
- Saved-playlist continuation takes priority over Autoplay so a partially loaded playlist finishes before radio-style Autoplay begins.
- Added unit coverage for continuation batching and PostgreSQL coverage for durable continuation state.
- CI #2147 passed completely: observability/deployment contracts, Typecheck, Test bot, domain build, bot build and Dashboard build.
- Final source checkpoint: `92ad5ef802a3a89cd7aac7831959228c77947add`.
- Next single Music slice: **Playlists — duplicate handling / merge**.


## 2026-10-05 — Music playlist duplicate handling / merge
- Completed the saved-playlist merge slice.
- Added /music playlist → Merge with name as the target playlist and source as the source playlist.
- Merge appends source tracks to the target in source order, preserves the existing target order and skips duplicate track identifiers already present in either playlist.
- Source playlist access follows the existing visibility rules: personal playlists are owner-only and shared playlists are guild-visible.
- The target playlist keeps the existing edit permissions; the source playlist is never deleted or modified by merge.
- Merge respects the existing 500-track playlist capacity and reports added, duplicate and truncated counts back to the user.
- Added regression coverage for order preservation, duplicate handling, source duplicates and the 500-track cap.
- CI #2152 validated the merge slice on the documentation-inclusive checkpoint ae94c38a050d2bff444104429acdc5779b3dcd34.
- Final source checkpoint for the merge slice: ae94c38a050d2bff444104429acdc5779b3dcd34.
- Next single Music slice: Playlist continuation after edits / stale continuation safety.


## 2026-10-05 — Music playlist continuation stale-state safety
- Completed stale-state protection for saved playlist continuation.
- Editing a playlist with an active continuation (add current, remove, move or merge into that playlist) now invalidates the in-memory continuation before the next queue-end cycle.
- Deleting a playlist with an active continuation also clears it; the persistent music_players continuation columns are cleared together, preventing the stale state from returning after a bot restart.
- Continuation state for an unrelated playlist is left untouched.
- Added a focused unit contract for playlist-id matching plus PostgreSQL coverage for clearing the persisted continuation state.
- CI #2156 passed completely: observability/deployment contracts, Typecheck, 171 tests, domain build, bot build and Dashboard build.
- Final source checkpoint: 36ba498f2446abf5e144bc88ba0d1f296374656c.
- Next single Music slice: **Autoplay duplicate/recent-track avoidance**.


## 2026-10-05 — Music Autoplay duplicate / recent-track avoidance
- Completed duplicate and recent-track protection for Music Autoplay.
- Added a persistent identifier field to music_history so Autoplay can reliably recognize tracks across bot restarts instead of relying only on in-memory state.
- Autoplay now excludes the track that just finished, tracks already waiting in the queue, and the last 20 historical plays for the same guild/bot identity.
- URL fallback is also checked for compatibility with older history rows that predate the identifier migration.
- Search results are filtered before insertion, so recent/duplicate candidates are never added merely because they were the first Lavalink result.
- Added unit coverage for identifier/URL exclusion and PostgreSQL migration coverage for the new history identifier column.
- CI #2161 passed completely: source/deployment/observability contracts, Typecheck, 171 tests, domain build, bot build and Dashboard build.
- Final source checkpoint for this slice: 6194b069485b84f7e1d3ebd81118a96a07e4e6aa.
- Next single Music slice: **Artist-aware / similar-track Autoplay**.


## 2026-10-05 — Music Autoplay artist-aware selection
- Completed the artist-aware Autoplay slice on top of duplicate/recent-track protection.
- When the last track has an artist, Autoplay first searches that artist and prefers an allowed different track by the same artist.
- The existing current-track, queued-track and recent-history exclusions remain authoritative for the artist-aware path as well.
- When no suitable same-artist result is available, Autoplay falls back to the existing title + artist search and keeps the same exclusion rules.
- Added deterministic helper coverage for normalized artist matching and safe fallback selection.
- CI #2166 passed completely: source/deployment/observability contracts, Typecheck, 171 tests, domain build, bot build and Dashboard build.
- Final source checkpoint for this slice: 36560ac76566f8eb6bc230feb684a81c9c1b3ed0.
- Next single Music slice: **Radio mode by artist/genre/search seed**.


## 2026-10-05 — Music Radio mode by artist / genre / search seed
- Completed the persistent Music Radio mode.
- Added /radio with Start, Stop and Status actions; the mode can be artist, genre or search, with a persistent seed.
- Artist radio can use the currently playing artist when no explicit seed is supplied; genre and search radio require a seed.
- Radio adds one next track when the queue ends, using the same current/queued/recent-track exclusion rules as Autoplay.
- While Radio is enabled it takes priority over generic Autoplay at queue end, preventing the two modes from fighting over the next track.
- Persistent radio settings were added to music_settings through migration 97: enabled flag, mode and seed.
- Added unit coverage for radio mode normalization and query construction plus PostgreSQL coverage for persistent radio settings.
- CI #2174 passed completely after fixing the Discord /music 25-subcommand limit by exposing Radio as a separate /radio command, and after normalizing the queue-end track type.
- Final source checkpoint for this slice: e5e1596fae8aca47e7751d6e302c5752c35b45b3.
- Next single Music slice: **Autoplay profile/settings in Dashboard**.


## 2026-10-05 — Dashboard Autoplay / Radio profile
- Completed the Music Autoplay / Radio settings slice in Dashboard.
- Extended the existing Music settings schema with persistent Radio enabled/mode/seed fields.
- The Music Dashboard now exposes Autoplay and Radio in one profile block, including artist/genre/search mode and a 200-character seed.
- Artist mode may keep the seed empty so runtime Radio can derive the artist from the currently playing track.
- Added schema-level test coverage for the Dashboard Music Autoplay / Radio profile.
- CI #2179 passed completely: source/deployment/observability contracts, Typecheck, tests, domain build, bot build and Dashboard build.
- Final source checkpoint for this slice: a291fc5159c41601c80cd140019578a1b4461c50.
- Next single Music slice: **Emoji controller / player message controls**.
