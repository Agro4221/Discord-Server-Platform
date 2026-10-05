# Test Matrix

This is the master index for verification work. New subsystems must add cases here.

| Area | Normal | Negative | Permissions | Persistence | Restart | Concurrency | Dependency failure | Security |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Core interactions | ☐ | ☐ | ☐ | n/a | ☐ | ☐ | ☐ | ☐ |
| Dashboard | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| Temporary Voice | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| Moderation | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| AutoMod | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| Security / anti-raid | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| Roles | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| Welcome / verification | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| Leveling | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| Tickets / Forms | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| Giveaways | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| Starboard | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| Economy | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| Reminders / utility | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| Notifications | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| Automation | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| Music / Lavalink | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| Multi-bot voice | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| Analytics | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| Import / export | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |
| Backup / restore | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ | ☐ |

Status key: ☐ not run, ✅ passed, ⚠ known limitation, ❌ failed.


## Verification snapshots

### 2026-09-19
- **Giveaways:** CI regression coverage now verifies the participation button is actually wired to the platform event bus and that entry is rejected after the Giveaway is no longer running.
- **CI run #277:** passed on branch `development`; source hygiene, bot typecheck, bot tests, bot build and Dashboard build were successful.
- The matrix below intentionally remains unchecked for live Discord behavior until the full release-gate suite is executed with real Discord/PostgreSQL/Lavalink dependencies.


### 2026-09-19 — AutoMod hardening snapshot
- Added deterministic detector tests covering the implemented AutoMod rules.
- Added audit-event coverage for handled violations.
- Fixed channel/role exemption ID parsing.
- Live Discord matrix remains intentionally unchecked until the release-gate environment is exercised.


### 2026-09-19 — Local deployment UX
- Windows local launcher contract added and checked statically.
- Actual Windows/Docker Desktop runtime execution remains a user-side/live validation task.


### 2026-09-19 — Music reliability snapshot
- Autoplay eligibility and Lavalink node-health helpers are covered by deterministic tests.
- Live playback, node failover and session-resume behavior remain live-environment checks.


### 2026-09-19 — Music resume continuity
- Resume/autoplay continuity is covered in code path review; full Lavalink restart/resume remains a live validation case.


### 2026-09-19 — Ticket / Temporary Voice lifecycle snapshot
- Temporary Voice ClientReady activation and occupied-room cleanup rules are regression-tested.
- Ticket stale-closure recovery is now invoked at startup and periodically; live Discord cleanup remains a live-environment validation item.


### 2026-09-19 — Ticket concurrency snapshot
- Concurrent-open-ticket database conflict classification is regression-tested.
- Full two-browser/modal race and Discord channel rollback remain live integration validation.


### 2026-09-19 — Multi-bot Music routing snapshot
- Secondary Music interactions now have a single shared Event Bus routing path.
- Duplicate command/reply behavior remains a live multi-bot Discord validation case.


### 2026-09-19 — Ticket rollback snapshot
- Discord publication failure now has regression coverage for channel + database rollback.


### 2026-09-19 — Starboard rollback snapshot
- Publication rollback decision is regression-tested.
- Live Discord + PostgreSQL failure injection remains a release-gate test.


### 2026-09-19 — Role Panel rollback snapshot
- Same-channel publication rollback is regression-tested.
- Live Discord message edit failure and DB outage injection remain release-gate validation.


### 2026-09-19 — Security audit-window snapshot
- Destructive-burst audit-log executor lookup now uses the configured destructive window and is covered by deterministic cutoff tests.
- Live destructive-event/audit-log correlation remains a release-gate validation case.


### 2026-09-19 — Moderation unban coverage
- Added slash-command shape coverage for /moderate unban.
- Added service-level regression coverage for the Discord unban action and moderation-case persistence.
- Live banned-user/unban behavior remains part of the Discord smoke test.
### 2026-10-03 — AFK/away snapshot
- Added deterministic coverage for AFK reason normalization, clear keywords and Discord relative-time notice formatting.
- AFK persistence, mention notifications and automatic return clearing are wired through the Reminders module.
- Live Discord behavior (message-volume interaction, permission/resource edge cases and restart persistence against a live PostgreSQL instance) remains part of the release-gate suite.
### 2026-10-03 — AutoMod rule editor snapshot
- Dashboard CRUD now exposes the existing persistent AutoMod detector-rule contract with resource pickers for roles/channels.
- Rule actions support delete, timeout, warn and log; warn is routed through the existing Moderation case/escalation path.
- Deterministic coverage confirms per-rule cooldown activation boundaries.
- Backend validation rejects unsupported actions and non-finite/out-of-range per-rule numeric values.
- Live Discord behavior, role hierarchy and provider/resource failure paths remain release-gate validation.

### 2026-10-03 — Custom Commands module snapshot
- Custom Commands now participates in the shared module toggle contract.
- Dashboard CRUD covers response, alias and role actions, Prefix/Slash flags and cooldowns.
- Existing API audit events remain the durable change trail.
- Live Discord registration/execution and role hierarchy remain release-gate validation.


### 2026-10-03 — Custom Commands / Dashboard builder
- Verified backend/shared-module work remains covered by existing bot typecheck/test gates.
- Dashboard-specific builder follows existing functional-panel patterns; live browser CRUD and Discord registration remain release-gate validation.


### 2026-10-03 — AutoResponder / keyword triggers
- Pure matcher coverage added for exact/contains/starts-with/regex semantics and template rendering.
- PostgreSQL migration coverage now includes autoresponder_rules.
- Live Discord trigger delivery, permissions and role/channel scoping remain release-gate validation.

- AutoResponder cache reuse is covered by deterministic bot tests; live message throughput remains a runtime validation target.

### 2026-10-03 — Ticket Intake Forms
- Migration coverage now checks the ticket form/data schema additions.
- Ticket unit coverage verifies form-field normalization and Discord limits.
- Live modal submission, permissions and transcript delivery remain release-gate validation.

### 2026-10-03 — Utility info suite
- Command schema coverage verifies all four utility commands.
- Live Discord rendering/resource resolution remains release-gate validation.


### 2026-10-04 — Function-level command permission editor
- Dashboard now exposes all persisted command-policy scope fields: allowed/denied roles and channels, cooldown, Prefix/Slash, enabled and help visibility.
- Backend already persists and enforces these fields through the shared command-policy guard and Management API.
- CI remains the static/build gate; live browser edits plus real Discord permission/scope behavior remain release-gate validation.


### 2026-10-04 — AutoMod ban action
- Added deterministic unit coverage that the rule builder persists `ban` as a valid action.
- Migration 67 updates the database check constraint for persisted AutoMod actions.
- Live ban execution, role hierarchy and notification/resource behavior remain release-gate validation.


### 2026-10-04 — Help policy defaults
- Help command now honors persisted `enabled`, `slash_enabled` and `help_visible` overrides while using command-definition defaults for commands without a stored row.
- Live Discord rendering remains release-gate validation.


### 2026-10-04 — Ticket customization
- Added unit coverage for Ticket customization normalization and a migration gate for version 68.
- Dashboard/API contract covers panel text and create/claim/close button labels; live Discord component rendering remains release-gate validation.


### 2026-10-04 — Automation moderation actions
- Added regression coverage for warn/kick/ban action validation and invalid ban duration.
- Management API validation is aligned with delay/webhook/branch actions and nested branch depth.


### 2026-10-04 — Automation event context
- Added regression coverage for moderation event conditions using `action` and `caseId` fields.
- Expanded field catalog alignment between engine, Management API and Dashboard.


### 2026-10-04 — Automation dry-run
- Added unit coverage for matching + rendered previews and non-matching rules.
- Dry-run remains intentionally side-effect-free; live execution is covered by existing runtime pathways and remains part of release-gate validation.


## 2026-10-04 — Music history / skip-to gate
- Migration 79 must create music_history and remain idempotent.
- Unit test verifies one-based skip-to semantics and leaves the queue unchanged for invalid positions.
- Live Discord/Lavalink gate must verify skip-to and history against a real playback session.

## 2026-10-04 — Automation richer conditions/actions gate
- Unit test must validate all new condition/action variants.
- Dry-run must evaluate user/bot and channel-type context and render new action previews without side effects.
- Browser release gate: Dashboard Builder can create/save the new condition/action variants.
## 2026-10-04 — Automation workflow preset gate
- Migration 70 must create the preset table/index.
- Unit/API contract: preset names and workflow definitions use the same validation limits as Automation rules.
- Integration: Config Export/Import round-trip preserves a workflow preset.
- Dashboard: save/load/delete behavior remains a browser release-gate check.

## 2026-10-04 — Automation retry/dead-letter gate
- Migration 69 must create durable dead-letter state and retry-state indexing.
- Unit: bounded exponential backoff and dead-letter threshold; diagnostics status mapping includes dead-lettered jobs.
- Runtime: delayed action failures must retry with backoff and move to dead letter on the fifth failed attempt; successful delayed jobs must still complete normally.
- Live Discord failure injection remains a release-gate validation case because retrying a partially completed action sequence has at-least-once semantics.

## 2026-10-04 — Automation diagnostics gate
- Unit: rule/event aggregation and delayed-job status mapping.
- API contract: diagnostics endpoint returns bounded operational metadata without event/action payloads.
- Dashboard: diagnostics section loads beside Automation rules/templates and supports refresh.
- Release gate still requires live Discord execution checks for Automation actions and delayed-job behavior; CI does not replace that validation.


## 2026-10-05 — Onboarding Flow Builder gate
- Deterministic coverage: trigger validation, ordered step normalization, duplicate-role rejection and ten-step limit.
- Database integration: migration 85 and flow persistence round-trip.
- Verification emits `verification.passed`; Onboarding consumes it through the shared Event Bus.
- Management API exposes GET/PUT `/api/guilds/:guildId/onboarding`; Control Center exposes the Flow Builder.
- Live release gate remains for Discord role hierarchy, channel permissions, DM failures, lifecycle ordering and restart behavior.

    
## 2026-10-05 — Onboarding automated gate passed
- CI `#1857`: 123 bot tests passed; bot typecheck, domain build, bot build and Dashboard production build passed.
- Migration 85 and onboarding persistence coverage are part of the passing suite.
- Remaining unchecked items are intentionally live Discord validation: permissions/hierarchy, DM failure handling, lifecycle timing and restart behavior.


## 2026-10-05 — Dashboard previews / test actions verified
- CI `#1862` passed after adding the Onboarding dry-run surface.
- The current platform now has multiple read-only/testable Dashboard operations: Automation dry-run, Onboarding flow validation/dry-run, plus existing Welcome preview and Security hierarchy diagnostics.
- The Onboarding dry-run checks live guild resources, role hierarchy, channel send permissions and Verification dependency without performing member changes or message delivery.
- Remaining module-specific preview UX can be extended later without changing the shared action/API contract.


## 2026-10-05 — Per-module activity/error history verified
- CI `#1873` passed: bot typecheck and tests, domain/bot/dashboard builds all green.
- Audit Log now supports bounded action-prefix queries plus target filters and a module activity helper.
- Management API exposes `GET /api/guilds/:guildId/modules/:moduleKey/activity`.
- Control Center shows module-scoped activity with pagination and error-like action highlighting.
- This intentionally reuses the durable Audit Log rather than introducing another event store.


## 2026-10-05 — Server configuration presets verified
- CI `#1883` passed: migration, tests, typecheck and all builds.
- Named per-guild presets persist the full existing ConfigTransfer payload and can be repeatedly applied to the same guild.
- Dashboard provides save/apply/delete operations; no second configuration model was introduced.


## 2026-10-05 — Configurable bot identity/profile verified
- CI `#1889` passed: typecheck, 123 bot tests, domain build, bot build and Dashboard production build.
- Fleet registration now accepts optional bot username plus local PNG/JPEG/GIF avatar and banner data.
- Management API applies the profile through the current Discord ClientUser after credential reconnect; secrets remain hidden and avatar/banner files are not stored in PostgreSQL.
- Username changes remain subject to Discord's external rate limits.
- Live validation remains necessary for real Discord profile editing and permission/account-specific restrictions.


## 2026-10-05 — Docker / VPS foundation verified
- CI #1899 passed the strengthened deployment gate.
- VPS installer now follows the current Control Center model: Discord bot credentials are registered from Bot Fleet instead of being collected by the installer.
- Public VPS Dashboard access is protected at the Caddy edge with Basic Auth; the application and Management API remain private.
- bash -n validation covers VPS install/upgrade scripts and deployment contract validates the VPS Compose overlay.
- Local Windows Docker flow remains unchanged.
- Live VPS DNS, TLS issuance, firewall policy and full clean-host deployment remain environment-dependent release-gate checks.


## 2026-10-05 — RU/EN localization foundation verified
- CI #1904 passed: source/deployment/observability contracts, bot typecheck/tests and all builds.
- Added shared LocalizationService-style dictionary with ru/en normalization and guild locale lookup from existing guild_settings.locale.
- Core Help/Embed responses and the global command error boundary now honor the configured guild locale.
- The locale architecture is intentionally incremental: module-specific responses can migrate to the same keys without another translation framework.

## 2026-10-05 — Ticket Panels automated gate
- CI #1949 passed: typecheck, tests, domain build, bot build and Dashboard production build.
- Migration 88 and ticket panel config round-trip coverage are included in the passing suite.
- Remaining live validation is Discord-side panel permissions, message refresh/deletion behavior and real ticket creation from multiple panels.


## 2026-10-05 — Custom rewards automated gate
- CI #1955 passed: typecheck, tests, domain build, bot build and Dashboard production build.
- Leveling reward builder uses the existing reward application path; live Discord role hierarchy and DM delivery remain environment-dependent.


## 2026-10-05 — Community Hub automated gate
- CI #1964 passed: typecheck, tests, domain build, bot build and Dashboard production build.
- Live browser freshness and live Discord-backed community data remain environment-dependent validation items.


## 2026-10-05 — Music controller permission gate
- CI #2056 passed: typecheck, tests, domain build, bot build and Dashboard build.
- Live validation remains for real Discord role/channel policy behavior on controller buttons.


## 2026-10-05 — Music queue permission gate
- CI #2063 passed: typecheck, tests, domain build, bot build and Dashboard production build.
- Live Discord validation remains for actual role/channel policy behavior on queue mutations.

### 2026-10-05 — Backup/restore scope snapshot
- Database integration coverage now exercises BackupService guild-ID validation plus cross-guild isolation for read/restore/delete operations.
- Invalid backup filenames are rejected before filesystem access.
- Live remote-S3 failure/recovery behavior and clean-host restore remain environment-dependent release-gate checks.

### 2026-10-05 — VPS deployment smoke snapshot
- Static deployment verification now requires installer/upgrade runtime probes for bot health, Dashboard readiness and Caddy Basic Auth edge behavior.
- Actual VPS install/upgrade on a clean host, DNS/TLS issuance and external client access remain live release-gate cases.

### 2026-10-05 — VPS reinstall/recovery snapshot
- Deployment contract now covers preservation of existing installer-generated secrets across reruns.
- Live release-gate case: rerun installer against an existing PostgreSQL volume and confirm bot/API/database continuity without secret rotation.

### 2026-10-05 — VPS upgrade configuration snapshot
- Static deployment verification now requires the upgrade path to reject missing critical runtime secrets before starting containers.
- Live release-gate case: remove/blank one critical secret in a disposable installation and verify the upgrade fails before Compose startup.

### 2026-10-05 — VPS domain validation snapshot
- Deployment contract now requires the upgrade path to reject a missing or malformed configured domain before HTTPS smoke probing.
- Live release-gate case: corrupt `DOMAIN` in a disposable existing installation and verify the upgrade fails before service restart.

### 2026-10-05 — Upgrade path regression snapshot
- Deployment validation distinguishes local upgrades from VPS/Caddy upgrades; public `DOMAIN` is required only when the Caddy overlay exists.
- Live regression case: run a local upgrade without `DOMAIN` and a VPS upgrade with valid `DOMAIN`/Basic Auth settings.

### 2026-10-05 — VPS reinstall configuration snapshot
- Static deployment verification requires the installer to preserve an existing Caddyfile.
- Live release-gate case: modify a disposable Caddyfile, rerun the installer, and verify the file remains intact while the stack upgrades successfully.

### 2026-10-05 — Management API security snapshot
- Configuration regression coverage now rejects empty and whitespace-only Management API keys before the server can start.
- Live release-gate case: verify unauthenticated Management API requests still receive 401 and that the configured bearer key is required in local/VPS deployments.

### 2026-10-05 — Management API authorization snapshot
- Dedicated regression tests cover Management API authentication failure/success cases at the pure authorization-contract level.
- Live release-gate case remains: unauthenticated HTTP request must return 401; exact configured Bearer key must authorize; malformed/expired deployment configuration must not expose mutations.

### 2026-10-05 — Dashboard mutation security snapshot
- Static coverage now enforces that POST/PUT/PATCH/DELETE Dashboard API routes include the shared same-origin check.
- Live release-gate case remains: cross-origin/browser mutation attempts must return 403 while same-origin Dashboard mutations continue to reach the authenticated Management API.

### 2026-10-05 — Dashboard mutation-route gate follow-up
- Fixed the Integration Credentials credential-test POST mutation, which was missed because the first static checker only validated that the file contained some assertSameOrigin() call.
- Static gate is now per-handler for POST/PUT/PATCH/DELETE, preventing sibling mutations in the same route file from being masked by one protected handler.
- Fresh CI is still required; live browser cross-origin mutation testing remains a release-gate validation case.
### 2026-10-05 — Backup configuration contract snapshot
- Removed the unused BACKUP_ENCRYPTION_KEY example setting so deployment configuration matches implemented backup behavior.
- Config export excludes bot/integration credential ciphertext; optional remote S3 uploads request AES256 server-side encryption.
- Live release-gate case remains: verify local backup permissions and remote S3 recovery/retention on a disposable environment.
## 2026-10-05 — Compose deployment snapshot
- Static deployment validation now rejects change-me PostgreSQL/Lavalink secret fallbacks and supplies ephemeral secrets for Compose config checks.
- Live release-gate case remains: start the platform from a fresh local/VPS .env, verify generated secrets are non-default, and confirm service startup/restart continuity.

## 2026-10-05 — Source hygiene snapshot
- Repaired secret-scanner regex boundaries and added GitHub fine-grained token/AWS access-key patterns.
- Positive/negative synthetic fixtures passed locally against the scanner logic.
- CI verification remains pending for the branch head.

## 2026-10-05 — Configuration validation snapshot
- Added automated negative coverage for blank/whitespace critical DB and Lavalink configuration plus custom Lavalink node passwords.
- Live deployment still needs a disposable startup test with malformed .env values to confirm fail-fast behavior.
## 2026-10-05 — Docker runtime contract snapshot
- Static deployment coverage now verifies that all Compose secret fallbacks are removed and the container-internal Management API remains on port 3002.
- Live release-gate case: start from the standard .env.example flow with MANAGEMENT_API_PORT=39001, then confirm Dashboard management requests reach the bot successfully through bot:3002.
## 2026-10-05 — First-run Control Center snapshot
- Automated health tests now cover the distinction between control-plane liveness and full bot readiness.
- Live release-gate case: fresh local/VPS deployment with empty Discord credentials must bring up Dashboard and Bot Fleet registration; after credentials are added, /ready should become 200.
## 2026-10-05 — Health deployment contract snapshot
- Deployment contract now checks the intended /health liveness and /ready readiness semantics in addition to unit-level health tests.
- Environment limitation: this session cannot execute Docker/network smoke tests due unavailable outbound DNS.
## 2026-10-05 — Lavalink secret configuration snapshot
- Deployment contract now rejects the predictable Lavalink password fallback and verifies the explicit environment binding.
- Live release-gate case: start both Lavalink nodes with the launcher-generated secret and verify authenticated /version healthchecks succeed.
## 2026-10-05 — Configuration validation snapshot
- Existing config tests cover blank MANAGEMENT_API_KEY, DATABASE_URL and LAVALINK_PASSWORD values; the implementation is now aligned with those tests.
## 2026-10-05 — VPS secret validation snapshot
- Static deployment validation protects whitespace-aware critical secret handling in installer and upgrade scripts.
- Live release-gate case: pre-seed a VPS .env with whitespace-only critical secrets and verify install regenerates them / upgrade rejects them before compose startup.
## 2026-10-05 — Native Windows launcher snapshot
- Static deployment contract now protects the native first-run launcher, loopback Dashboard, configurable Management API port, resource caps and convenience entrypoints.
- Live release-gate: clean Windows machine with Node.js, PostgreSQL and Java/Lavalink installed; run start.bat with no Discord credentials, then register through Control Center → Bot Fleet.
- Live resource-gate: capture native-status.bat at idle, during music playback, Dashboard use, simultaneous guild/music activity and with game + OBS running.
## 2026-10-05 — Native local acceptance gate
- Static contract covers native launcher, loopback Dashboard, dynamic local API port, memory caps, log rotation and convenience entrypoints.
- Live gate remains: clean Windows setup → start.bat → native Dashboard via control-center.bat → Bot Fleet registration → music/playback → native-status.bat measurements under game + OBS load.
## 2026-10-05 — Single native launcher acceptance
- Static contract verifies exactly one root BAT, native launcher parameters, automatic dependency bootstrap hooks and loopback Dashboard binding.
- Live clean-PC gate: double-click start.bat on Windows with missing Node/PostgreSQL/Java/JAR and verify bootstrap, build, Control Center startup and Bot Fleet registration.
- Live resource gate: measure the native DSP-only working set with start.bat -Status under idle and real Discord/Music workloads, without mixing unrelated applications into the DSP budget.