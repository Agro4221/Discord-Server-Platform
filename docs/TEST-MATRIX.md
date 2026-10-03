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
