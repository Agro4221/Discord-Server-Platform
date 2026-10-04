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


## 2026-10-04 — Command routing and multi-bot failover hardening
- Development head for this pass: `6c74c0f68e621ff44d7cbdf0089407f46a5b1301`.
- Command-policy registry is now unique and covers every registered top-level slash command; the root `/leveling` command was added to policy control.
- Prefix routing now has bidirectional regression coverage against `COMMAND_DEFINITIONS`; `!economy` and `!music` were added to the built-in router allowlist so all policy-declared prefix commands reach the dispatcher.
- Custom-command slash aliases now route the root `/leveling` command through the shared dispatcher.
- Secondary bot identities with `failover_enabled=true` now periodically claim stale guild assignments they are connected to, using the existing atomic `FOR UPDATE SKIP LOCKED` claim path; each fleet cycle refreshes assignments and still attempts the heartbeat when assignment refresh fails.
- Added regression coverage for failover guard/claim behavior and guild filtering across passive Event Bus events.
- CI run #1195 on the preceding command-policy/prefix-routing head passed. The final failover/alias head requires its own fresh green CI run before it is marked fully verified.


## 2026-10-04 — Local Control Center expansion
- Local-first operating model confirmed: Windows/local Control Center is the primary administration surface; VPS remains a future deployment target only.
- Added persistent Logging dashboard storage parity for message bulk-delete, reactions, channel-update and role-update switches, with schema/storage contract regression coverage.
- Added Economy Shop management, Leveling rewards/exclusions, Starboard configuration, Server Settings, Command Policies, Discord permission diagnostics and Moderation channel operations to the local Control Center.
- Moderation channel operations reuse Core-side Discord permission checks and support clear, slowmode, lock and unlock with audit records.
- Command Policies moved into System Center because they are a cross-cutting access-control service rather than a runtime module.
- Added Community Tools administration for sticky messages, poll closing and suggestion approve/deny workflows.
- Added Giveaway creation from Control Center with channel/host/prize/duration/winner validation, Discord publication and database rollback on publish failure.
- Added Verification Center panel publishing from Control Center.
- Current development head: `ab1f67805e8a164782e935c2422724a55f1c221f`.
- Automated CI remains the verification gate for the latest head; live Discord behavior, real bot permissions, hierarchy and PostgreSQL failure injection remain environment-dependent acceptance tests.

## 2026-10-04 — Control Center build-fix checkpoint
- Atomic development head: `486e82260afa751c74bdcc305eea0a923f26c7eb`.
- Fixed Giveaway Control Center wiring after Dashboard production-build validation: all existing `GiveawaysPanel` call sites now provide the text-channel resource list, and the panel label style is defined locally.
- The same atomic change keeps the Dashboard capability metadata aligned with the existing AutoMod and Music operational panels.
- CI run #1237 on the previous head failed only in Dashboard TypeScript/build validation because these exact Giveaway props/label contracts were not updated at all call sites; bot typecheck, 76 bot tests, domain build and bot build were successful.
- The new atomic head is the next automated verification target. No live Discord acceptance is implied by CI.

## 2026-10-04 — Control Center giveaway wiring verified
- CI run **#1239** (`37150661360`) on development head `1007677fc855a8ea6b62ff1fa8274294a9db96d0` passed all automated stages.
- Verified: dependency audit, source/deployment/observability checks, bot typecheck, **76/76 bot tests**, domain build, bot build and Dashboard production build.
- The Giveaway panel prop/label fixes are therefore CI-verified; this still does not replace live Discord acceptance with real permissions and messages.

## 2026-10-04 — AutoMod Control Center CRUD verified
- CI run **#1242** (`37150878597`) passed on development head `0e79a64ab1cb0aa2c70ead8ae98b4950f2764b2a`.
- AutoMod Rule Builder now supports rule editing, enable/disable toggles, validated threshold/window/timeout input and the complete detector set supported by Core.
- Dashboard deletion of AutoMod rules now creates a durable `automod.rule.deleted` audit event.
- Added regression coverage that unsupported rule detectors are rejected before database writes.

## 2026-10-04 — Security Center verified
- CI run **#1245** (`37151126039`) passed the full automated pipeline on development head `7ac4f4505479d518f8c55847466111124ca0ea6d`.
- Security now has a dedicated Control Center surface with active-incident visibility, hierarchy/readiness diagnostics and guarded incident-closing operations.
- Security snapshot access is exposed through the Management API and local Dashboard proxy; existing generic configuration remains available alongside the operational panel.

## 2026-10-04 — Temporary Voice controls verified
- CI run **#1249** (`37151439742`) passed on development head `9a442b65c77a3cabc497f94635ef4efc6bfd6527`.
- Temporary Voice now exposes `/voice` and prefix controls for room info, lock/unlock, user limit, rename, ownership transfer and permit/reject access.
- Command policy and prefix routing include the new `voice` command; slash command contract coverage was added.

## 2026-10-04 — Temporary Voice Control Center verified
- CI run **#1253** (`37151805934`) passed on development head `076a56031ca692f19b22fe98b7d91188c16a1541`.
- Temporary Voice Control Center now shows active tracked rooms, owners and occupancy, and exposes manual reconciliation from the local Control Center.
- Fixed the Dashboard JSX rendering of owner mentions; the production Dashboard build now passes.
- Backend verification included **78/78 tests passing**, domain build and bot build.

## 2026-10-04 — Welcome Control Center verified
- CI run **#1256** (`37152023248`) passed on development head `b9d3ac96021adc3f5c45dd9c81c1a34c327beacd`.
- Welcome now has a dedicated Control Center panel with Welcome/Goodbye template preview and test delivery to a selected or configured text channel.
- Test delivery validates bot `ViewChannel`, `SendMessages` and `EmbedLinks` permissions and records `welcome.test.sent` in the audit log.
- Preview/test placeholders use `@example-user`, so the test path does not ping a real member.

## 2026-10-04 — Community Tools poll creator verified
- CI run **#1260** (`37152201261`) passed on development head `9be19adc51f501af87057178a1689f51414c2e01`.
- Community Tools Control Center now creates polls directly: target channel, question, 2–5 options and 1–10080 minute duration.
- Core validates the target text/announcement channel and bot `ViewChannel`, `SendMessages`, and `EmbedLinks` permissions, rolls back the database row if Discord publication fails, and keeps the existing poll close timer.
- Dashboard creation is audited as `poll.created`; existing close/status/sticky administration remains intact.

## 2026-10-04 — Control Center consistency audit verified
- CI run **#1262** (`37152334156`) passed on development head `c9fd897e4a5574119480e4dfc6fd7d434a20cae3` after adding `automod` to `PANEL_KEYS`.
- Cross-module audit confirmed every `full` module has both a rendered operational branch and a `PANEL_KEYS` entry; there are no extra panel keys and no missing panel branches.
- Community Tools poll creation remains CI-verified by run **#1260** (`37152201261`) on its feature head.

## 2026-10-04 — Economy Admin verified
- CI run **#1268** (`37153371438`) passed on development head `c8188f61840235c784560f7507d8276dee5acf59`.
- Economy Control Center now exposes the top 100 persisted economy accounts and a protected admin balance editor.
- Core validates Discord user IDs and PostgreSQL bigint-compatible non-negative balances before upserting; Dashboard writes are audited as `economy.balance.updated`.

## 2026-10-04 — Command routing audit verified
- CI run **#1272** (`37153758025`) passed on development head `e709c239a4bc3a852e7f55f719f47ba43e9cc54e`.
- Routing audit caught a concrete Temporary Voice gap: `/voice` was implemented but not subscribed to the `interaction.command` event. The module now registers and removes that listener with its lifecycle.
- Notification feed channel preflight and Role Panel channel permission preflight are also part of the hardened Core path.

## 2026-10-04 — Local Dashboard authentication removal
- Local Control Center no longer has an end-user login/logout flow or dashboard admin password/session secret.
- Dashboard access remains local-first/loopback by default; server-side requests to the Management API remain protected by the internal bearer key.
- Legacy login routes and page were removed.

## 2026-10-04 — Bot Registry verified
- Module 2A/2B complete.
- Added encrypted Bot Identity credential storage, Control Center registration, Discord token validation and safe metadata-only Fleet responses.
- PostgreSQL is now authoritative for runtime credentials; stale .env values cannot overwrite an existing stored credential.
- CI run #1590 passed with 84/84 bot tests and all build/contract stages.
- Next module: local Bot Fleet process orchestration so additional registered identities can actually run concurrently.


## 2026-10-04 — Local Bot Fleet orchestration
- Added `scripts/reconcile-fleet.ps1` for local Windows Fleet lifecycle.
- Startup reconciles enabled secondary identities with stored credentials into `dsp-bot-fleet-<identity>` containers.
- Down cleanup removes secondary fleet containers before Docker Compose shutdown.
- Fleet reconciler logs lifecycle events to `data/logs/fleet-reconciler.log` without logging credentials.


## 2026-10-04 — Local Fleet orchestration CI verified
- CI run #1592 passed on `03ad5eec1c186b4a76af0cf7c7775457ba3bf4d4`.
- Fleet launcher/reconciler static contract and all backend/frontend automated checks are green.
- Documentation now explicitly distinguishes implemented local orchestration from live Windows/Discord acceptance.


## 2026-10-04 — Security anti-nuke response expansion
- Security module pass: extended anti-nuke event coverage to `channel.create` and `role.create`.
- Kept the existing `destructive-burst` incident model to avoid unnecessary schema churn; event type is retained in incident/security-event metadata.
- Added regression coverage for audit-log event mapping.


## 2026-10-04 — Security anti-nuke checkpoint verified
- Development HEAD at checkpoint: `9069f68ec96bd4e6d0a2efc96da9625d719b3399`.
- CI run **#1596** passed the complete automated verification pipeline.
- Security anti-nuke event coverage now includes channel/role creation as well as deletion and member bans; regression coverage verifies the audit-log event mapping.
- Known limitation remains live Discord audit-log timing/permission/hierarchy validation.

## 2026-10-04 — Music provider-aware search checkpoint
- Development HEAD at current feature checkpoint: `035e23cc163871172cba9e0298d824876a74387c`.
- Added a shared provider-aware search path for Dashboard and Discord Music play flows.
- Supported search providers are `auto`, `youtube`, `youtube_music` and `soundcloud`; direct URLs remain passed through unchanged.
- Added provider choices to `/play`, `/music play` and the local Music Control Center.
- Added regression coverage for provider normalization, query construction and command registration.
- CI run **#1603** passed typecheck, bot tests, domain/bot builds and Dashboard build.
- Known limitation remains actual provider/plugin availability and live Lavalink behavior in the user's local runtime.

### Next concrete work
- Music — multi-node failover hardening: verify and strengthen automatic player migration/recovery when an active Lavalink node disconnects, including persistent player state and regression coverage.


## 2026-10-04 — Music multi-node failover hardening checkpoint verified
- Development HEAD: `7d62d0421d31ab3deebbca29d3c9412908b41543`.
- CI run **#1608** passed the full automated pipeline.
- Music failover now logs the relevant player node-change success/failure events from `lavalink-client`.
- Active players are persisted when a Lavalink node disconnects, with explicit success/failure logging for the persistence attempt.
- Control Center now exposes the player's active Lavalink node alongside total connected nodes.
- Automatic player migration remains delegated to `lavalink-client`'s built-in node-migration mechanism; the platform layer adds state durability and observability around it.
- Live node-loss/migration, queue continuity and audio continuity remain environment-dependent release-gate tests.
### Next concrete work
- Release-gate validation of Music multi-node failover: live node loss/recovery with queue, current track position and player state continuity.
- Then continue the remaining broader fleet/release-gate validation without reopening already verified Music slices.


## 2026-10-04 — AutoMod rule log-channel checkpoint verified
- Development HEAD: `3a61ed05f3042a80eb60d5005eccc1ee7c5e1ff4`.
- CI run **#1617** passed the full automated pipeline.
- AutoMod rules now support an optional persisted log channel for `action=log`, with Management API validation that the target is text-based and sendable.
- Control Center exposes the log-channel selector only for log actions.
- Rule log delivery renders `{mention}`, `{user}` and `{channel}` with allowed mentions restricted to the triggering user.
- Audit telemetry records the final `logDelivered` result once, after the delivery attempt; delivery failure is logged without breaking rule handling.
- Live Discord permission/channel-delivery behavior remains an environment-dependent acceptance test.
### Next concrete work
- Continue the remaining AutoMod/Security response workflow depth, then return to the broader Fleet/release-gate matrix.


## 2026-10-04 — AutoMod timeout moderation-case checkpoint verified
- Development HEAD: `73af83405195e2c94c44f1f1740fe74ac2c66f76`.
- CI run **#1623** passed the full automated pipeline.
- AutoMod rule `action=timeout` now records a `moderation_cases` timeout case only after the Discord timeout succeeds, including an `expires_at` timestamp.
- Base AutoMod detections configured with a timeout now use the same durable moderation-case path.
- Both paths emit the existing `moderation.case` event after successful persistence; failed Discord timeouts do not create false cases.
### Next concrete work
- Continue the remaining AutoMod/Security response workflow depth, then return to broader Fleet/release-gate validation.

## 2026-10-04 — AutoMod/Security consistency hardening
- Development HEAD for this checkpoint: `83755f29b9ac747b278bce919d97397441a96d00`.
- AutoMod rule-based `repeated-text` now honors `windowSeconds` for its effective detection window instead of counting every retained repeat equally.
- The AutoMod repeated-text rule uses timestamped recent messages and keeps the existing guild-wide `repeatedWindowSeconds` as the safe upper bound; per-rule windows may narrow it.
- Added deterministic regression coverage for repeated-text inside/outside the rule window.
- Security incident resolution now returns an explicit success/failure result; `clearIncidents` reports only incidents that were actually marked resolved.
- Added regression coverage for partial cleanup failure so the Control Center/command result cannot over-report closed incidents.
- Verification state: fresh GitHub commit status currently exposes no checks for the latest direct development HEAD, so this checkpoint is **not** marked CI-verified yet.
### Next concrete work
- AutoMod: tighten the `action=log` configuration contract and review `warn` action semantics.
- Security: decide/pin the intended lifecycle for executor roles removed by anti-nuke response and add persistence/restoration if the intended behavior is reversible.
- Then deepen Music/Fleet failure-path coverage and move through the live Discord/Windows/Lavalink release-gate matrix.

## 2026-10-04 — AutoMod log-rule contract hardening
- Development HEAD for this feature checkpoint: `7121d7557063772d712c47006bdbb9845c99d1b9`.
- AutoMod `action=log` rules now require a configured log channel at the Core service boundary.
- Management API rejects `action=log` without a log channel with a deterministic HTTP 400 error before persistence.
- Added regression coverage proving an invalid log rule performs zero database writes.
- Previous AutoMod repeated-text window and Security partial-resolution fixes remain part of the same consistency-hardening pass.
- Verification state: the repository integration currently exposes no attached CI status for this direct `development` HEAD, so this checkpoint is not called CI-verified until Actions reports a run.
### Remaining after this slice
- AutoMod: review `warn` action semantics and complete response-workflow edge cases.
- Security: finalize executor-role removal/restoration semantics and durable restart behavior for destructive-burst history.
- Music: deeper failover/queue/current-position continuity and multi-session failure paths.
- Fleet: failover/reconciliation edge cases and multi-bot Windows/Docker acceptance.
- Final release gate: live Discord permissions/hierarchy, real Lavalink/provider behavior, soak/chaos/recovery, clean-host deployment.

## 2026-10-04 — Security detection-window hardening
- Development code checkpoint: `a915418cab191a58100849aff95264b49311fb74`.
- Security raid/destructive detection windows are now normalized to 5–3600 seconds when read from configuration, preventing invalid/oversized values from bypassing bounded cache retention.
- In-memory Security event buckets now retain up to the full supported one-hour detection horizon instead of a hard-coded five minutes.
- Added regression coverage for window lower/upper bounds and invalid values.
- CI verification is still pending for the latest direct development HEAD.

## 2026-10-04 — AutoMod independent rule windows + Security window hardening
- AutoMod rule-based `repeated-text` now has timestamp-aware history independent from the base detector window, up to the supported one-hour history horizon; added regression coverage for a rule window larger than the global base window.
- AutoMod `action=log` requires a configured log channel before persistence, with Management API rejection and zero-write regression coverage when missing.
- Security incident clearing now returns only successfully resolved incident count.
- Security raid/destructive detection windows are normalized to 5–3600 seconds; event-cache retention and audit-log lookback now cover the full supported hour instead of a hard five-minute ceiling.
- CI run #1647 exposed a genuine TypeScript syntax corruption in the Security helper area; it was repaired before the current checkpoint. CI run #1651 then reached 93/94 tests and exposed the missing export of `clampSecurityIncidentDuration`; the helper export was restored in commit `f079a866aa2294ad211d7234fa6396c8c052e643`.
- Latest code before this documentation checkpoint: `f079a866aa2294ad211d7234fa6396c8c052e643`.
- Current verification state: a fresh CI run is active on the latest documentation checkpoint; no green claim is made until it completes.
### Remaining after this pass
- AutoMod: response-workflow edge cases / final warn semantics review.
- Security: executor-role lifecycle semantics and durable destructive-history policy.
- Music: deeper multi-node queue/current-position continuity and provider/runtime failure paths.
- Fleet: reconciliation/failover failure paths and multi-bot Windows/Docker acceptance.
- Release gate: live Discord permissions/hierarchy, Lavalink/provider behavior, soak/chaos/recovery and clean-host deployment.

## 2026-10-04 — AutoMod Dashboard contract checkpoint
- Dashboard AutoMod Rules form is now aligned with the Core/API `action=log` contract: selecting a log channel is mandatory for log rules.
- Removed the stale `В текущий канал / только audit` option that contradicted the enforced persistence contract.
- Restored the actual response-message template editor where a placeholder literal had been rendered in the UI.
- Client-side validation now blocks saving a log rule without a log channel before making the request.
- CI run #1657 passed the full pipeline on commit `4c2ba68c0c45700a7f1f13f48942c9452de2c7dc`.
### Remaining after this checkpoint
- Security: define and implement executor-role removal lifecycle, including whether it is reversible and how restart/reconciliation should behave.
- AutoMod: richer response delivery/failure semantics and final warn behavior review.
- Music: deeper failover/queue/current-position edge coverage.
- Fleet: reconciliation/failover failure paths and multi-bot Windows/Docker acceptance.
- Final live release gate: Discord permissions/hierarchy, Lavalink/provider behavior, soak/chaos/recovery and clean-host deployment.
