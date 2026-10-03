# Project State

## Target
Self-hosted Discord Server Platform: local-first, resilient, modular, no artificial premium wall, simple UX, optional VPS deployment, optional multi-bot scaling for multiple voice channels.

## Current branch
feature/music-v2

## Current phase
Release candidate — code/CI verified, ready for live Discord validation.

## Working subsystems
- Discord Core with typed event bus and module lifecycle.
- PostgreSQL persistence + versioned migrations + advisory migration lock.
- Health/readiness endpoint and Discord connection supervision.
- Durable audit log.
- Local protected Management API.
- Schema-driven Next.js Control Center with session auth, functional-area navigation, capability/function index, module toggles, Discord channel/role selectors, grouped settings forms, import/export, backup management, module actions and specialized admin panels. Custom Commands and AutoMod have dedicated CRUD editors.
- Moderation with case history.
- Temporary Voice with idempotency, ownership and reconciliation.
- AutoMod with persistent baseline settings plus Dashboard-managed detector rules, per-rule actions/scopes and audit logging. Per-rule cooldown windows and warning escalation are included.
- Tickets with modal intake, staff claim, close and transcript.
- Role Panels with role hierarchy/tamper checks and Dashboard CRUD/publishing editor.
- Giveaways with durable entries, scheduled finishing, Dashboard history/end/reroll operations.
- Economy with daily/pay/leaderboard, shop and transaction ledger.
- Reminders with retry/lease semantics, sticky messages and persistent AFK/away state.
- Starboard.
- Automation engine with persisted rules/cooldowns and a constrained Dashboard builder.
- Security/Anti-Raid and destructive burst detection.
- Notifications with HTTPS feed validation and SSRF protections.
- Stream alerts for Twitch, YouTube, VK Видео Live and Kick with persistent schedules and templates.
- Analytics minute buckets with Dashboard reporting.
- Music/Lavalink foundation with persistent queue store and bot identity namespace.
- Multi-bot identity persistence for separate-process fleet deployment, per-voice Music routing and identity-scoped background workers.
- Config transfer and compressed local backups with guild-scoped restore/delete controls, including local/remote retention enforcement.
- Docker Compose / Dockerfiles for local-to-VPS topology.
- Native Windows local runtime for low-overhead gaming/streaming, with single-Lavalink default and opt-in Dashboard/second Lavalink.

## Still under development
- Full AutoMod rule editor and richer response policies beyond the current persisted rule set.
- Full Security response workflow beyond the current anti-raid/quarantine/destructive-burst response; core response actions are now individually configurable and persisted.
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
**First read `docs/PROJECT-HANDOFF.md` in full.** It is the canonical cross-chat project context and records the product goal, benchmark, implemented baseline, backlog, priorities and anti-drift rules.
Then read `docs/PROJECT-STATE.md`, recent `docs/WORK-LOG.md` entries and `docs/TEST-MATRIX.md` before declaring a subsystem complete.
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
- Live Windows launcher behavior (real browser open + terminal close) still requires validation on Windows; automated CI cannot validate desktop UX.


## 2026-10-03 — Product direction: Music-first advanced backlog
- Next product work is explicitly Music-first rather than expanding low-priority stream providers.
- Mandatory controller UX: emoji-centric compact controls/labels, persistent player state, and a dedicated Loop One button for repeating exactly the current track.
- Planned advanced Music capabilities include search result selection, full queue editing/history/export, granular DJ permissions, vote-skip, request fairness/anti-spam, shared playlists, save-queue, richer effects/custom EQ, improved autoplay/radio and richer lyrics UX.
- Planned provider breadth includes Spotify, Apple Music, Deezer, Yandex Music, VK Music, Tidal, Qobuz, yt-dlp and JioSaavn in addition to the already working YouTube/SoundCloud path. Provider readiness requires real adapter/credential validation.
- Kick stream alerts are implemented but explicitly de-prioritized; the existing Twitch/YouTube/VK stream-alert functionality remains the practical baseline.
- See `docs/FEATURE-MATRIX.md` for the complete persistent roadmap and `docs/WORK-LOG.md` for the decision record.


## 2026-10-03 — Product scope correction
- Product target is a **full all-in-one Discord platform**, not a music-first bot. Music is a major subsystem alongside Administration, Moderation, AutoMod/Security, Logging, Server utilities, Roles/Onboarding, Tickets/Forms, Automation, Community/Engagement, Notifications/Integrations and Analytics.
- Premium/mature multipurpose bot capabilities are the broad product benchmark; no artificial Premium wall is planned for the self-hosted product.
- Music advanced work remains on the roadmap, including emoji controller controls, dedicated Loop One, queue/DJ/fairness features and broad provider support, but Music work must not displace unfinished high-value Discord platform capabilities.
- Updated release order in docs/FEATURE-MATRIX.md to enforce platform-wide parity before the final advanced Music passes and whole-platform release validation.
- Recent scope-correction commits: b2770f1c, d2ff12a7, cf2877e0.

## 2026-10-03 — Benchmark methodology broadened
- Premium parity is benchmarked against a **set of mature Discord bots**, not Carl-bot alone: MEE6, JuniperBot, ProBot, Dyno, Jockie Music and relevant specialized bots.
- Functional coverage is evaluated across administration, moderation/AutoMod/security, logging, custom commands and templates, roles/onboarding, tickets/forms, automation, community/engagement, notifications/integrations, analytics and Music.
- The benchmark also considers feature depth, configurable limits, permissions, UX, persistence, integrations and cross-module automation hooks rather than a simple checkbox list.
- Official/current references used for this benchmark include MEE6 Support, JuniperBot Documentation, ProBot Premium, Dyno Documentation/Premium and Jockie Music FAQ/site. This is an external product benchmark; no proprietary implementation or closed code is being copied.


## 2026-10-03 — Canonical handoff protocol
- `docs/PROJECT-HANDOFF.md` is now the first-read continuity source for new chats.
- It exists specifically so development can continue without repeatedly re-explaining the project's all-in-one goal, benchmark set, completed capabilities, backlog, Music requirements, priorities and accepted architectural/product decisions.
- `docs/WORK-LOG.md` remains the chronological engineering record; `docs/PROJECT-STATE.md` remains the current-state summary; `docs/TEST-MATRIX.md` remains the validation gate reference.


- Control Center catalog now includes a dedicated Custom Commands module entry alongside its CRUD panel.


- AutoResponder is now a first-class module with persistent rules, scoped matching, cooldown, template rendering and dedicated Dashboard CRUD.

- AutoResponder rule cache limits PostgreSQL reads to a short per-guild TTL and is invalidated on rule mutations.

- Tickets now have a dedicated Dashboard Intake Form editor with persistent form fields and ticket answer storage.

- Utility info suite (`serverinfo/userinfo/roleinfo/channelinfo`) is available through Prefix/Slash and the shared command policy.


## 2026-10-04 — Function-level command permissions
- Expanded the existing Command Policy Dashboard editor to expose the full persisted policy scope: enable/Prefix/Slash, cooldown, allowed/denied roles, allowed/denied channels and help visibility.
- Reused the existing command_policies API and policy guard; no new permission model or migration was introduced.
- Browser editing and live Discord authorization remain release-gate validation; CI validates TypeScript/build contracts.


## 2026-10-04 — AutoMod ban action
- Added `ban` as a rule action for the existing AutoMod rule builder.
- AutoMod bans are routed through Moderation so the action receives the common Discord role-hierarchy check, audit event and moderation case persistence.
- Migration 67 widens the persistent AutoMod action constraint to include `ban`.
- Dashboard exposes the ban action; unit coverage verifies rule persistence. Live Discord hierarchy/ban behavior remains release-gate validation.


## 2026-10-04 — Help policy defaults
- `/help` now derives its built-in command list from `COMMAND_DEFINITIONS` and overlays any persisted per-guild policy.
- Commands without a stored policy therefore retain their declared defaults, while explicit enabled/slash/help visibility overrides are respected.


## 2026-10-04 — Ticket customization
- Added persistent Ticket customization for panel title/description and create/claim/close button labels.
- Configuration is normalized to Discord-safe lengths and applied consistently to the prefix quick-panel and ticket create/reopen controls.
- Management API and Dashboard now expose the customization contract beside intake-form editing.
- Migration 68 adds the five ticket customization columns; live Discord rendering remains release-gate validation.


## 2026-10-04 — Automation moderation actions and API contract
- Automation now supports warn/kick/ban through the existing Moderation service, preserving case history, hierarchy checks and audit behavior.
- Management API validation now accepts and recursively validates the existing Dashboard delay, webhook and branch action catalog.
- Added `@event` user references and bounded ban durations.


## 2026-10-04 — Automation event context
- Expanded Automation runtime context with moderation action/reason/caseId, moderator user, roleId and ticketId fields.
- Dashboard/API condition field catalog now exposes the additional string/numeric fields.
- Template rendering supports expanded moderation, role, ticket and giveaway variables.


## 2026-10-04 — Automation dry-run
- Added a side-effect-free Automation dry-run API and Dashboard test surface for current unsaved rule definitions.
- Dry-run validates conditions/actions, simulates ALL/ANY/branch matching and renders action previews without Discord sends, role changes, moderation calls, or webhooks.
- Supports synthetic content/channel/user/role and bounded numeric event context for reproducible testing.


## 2026-10-04 — Automation retries and dead-letter
- Durable delayed Automation jobs now have bounded exponential retry with a five-attempt limit and a persistent dead-letter state.
- Delayed execution propagates action errors instead of swallowing them, while non-delayed event execution retains its existing per-action best-effort behavior.
- Rule IDs are preserved on delayed jobs and diagnostics distinguish pending, processing, completed and dead-lettered jobs.

## 2026-10-04 — Music history / skip-to
- Queue editing, Loop One/Queue Loop, progress display, persistent recent history and skip-to are now implemented in Music v2.
- Recent history is bounded to 200 entries per guild/bot identity and is operational telemetry, not configuration.

## 2026-10-04 — Automation richer conditions/actions
- Automation conditions now cover role absence, bot identity, channel type and Discord permission checks.
- Actions now include managed nickname updates and message reactions, with dry-run previews and Dashboard controls.
- Runtime uses live GuildMember/permissions data when a dry-run context is not provided.
## 2026-10-04 — Automation workflow presets
- Automation now supports reusable per-guild workflow presets alongside text templates.
- Presets persist full workflow definitions and can be saved, loaded into the Dashboard Builder, deleted and transferred through Config Export/Import.
- Preset persistence reuses the existing Automation validation and audit contracts; no second workflow engine was introduced.

## 2026-10-04 — Automation diagnostics
- Automation now has an operational diagnostics surface backed by the existing delayed-job queue and rule/template state.
- Management API: GET /api/guilds/:guildId/automation/diagnostics.
- Dashboard shows rules/templates, delayed pending/processing/error/completed-24h counts, oldest pending job and recent job attempts/errors.
- Diagnostics deliberately omit event payloads and action bodies; runtime execution remains unchanged.
- Regression coverage was added for aggregation/status mapping.


### 2026-10-04 — Welcome/goodbye image customization
- Extended the existing Welcome module with optional HTTPS embed images for welcome and goodbye messages.
- The same settings are available through Dashboard generic module settings and `/welcome setup`; configuration transfer preserves them.
- URL normalization rejects malformed, non-HTTPS and oversized values; empty values disable the image.
- Added migration 80 and regression tests; live Discord embed rendering remains part of the live release gate.
