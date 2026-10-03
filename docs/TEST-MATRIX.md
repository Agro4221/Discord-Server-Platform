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


### 2026-10-04 — Command routing / multi-bot snapshot
- Command policy definitions are now unique and cover all registered top-level slash commands.
- Prefix allowlist parity is regression-tested in both directions, including the economy/music roots.
- Secondary bot automatic stale-guild failover is wired into the 15-second fleet maintenance cycle and covered by deterministic repository tests.
- Passive Event Bus guild filtering is regression-tested for bulk message deletion, channel/role create-update-delete, unban and Security incident events.
- Final head `6c74c0f68e621ff44d7cbdf0089407f46a5b1301` is awaiting its fresh CI result; live multi-bot Discord behavior remains an environment-dependent acceptance case.


### 2026-10-04 — Local Control Center coverage snapshot
- Logging dashboard field-to-storage parity is covered by deterministic schema/storage tests.
- Leveling rewards/exclusion API/UI wiring, Starboard configuration wiring, Server Settings wiring and Command Policies wiring were added; live Discord authorization remains release-gate validation.
- Moderation clear/slowmode/lock/unlock includes Core-side permission checks; live channel permission-overwrite and bulk-delete behavior remains a Discord smoke/chaos case.
- Community Tools sticky/poll/suggestion administrative operations are wired through Management API/Core; live message edits/deletions and suggestion-button updates remain environment-dependent.
- Giveaway creation includes DB-to-Discord publication rollback logic; live publication failure injection remains a release-gate test.
- Verification panel publication checks bot/channel permissions; live Discord interaction flow remains a release-gate case.
- Latest recorded development head: `ab1f67805e8a164782e935c2422724a55f1c221f`.
