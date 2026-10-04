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

## 2026-10-04 — Giveaway Control Center wiring
- Added contract coverage through the production Dashboard TypeScript build path by ensuring every current `GiveawaysPanel` call site supplies the required channel resources.
- Added the missing Giveaway panel label style constant.
- CI remains the automated gate; this checkpoint is not a substitute for live Discord permission/publication acceptance.

## 2026-10-04 — CI verification
- CI run **#1239** passed the full automated matrix on the Control Center giveaway wiring checkpoint, including Dashboard production TypeScript/build validation.
- Automated verification is green; live Discord permission, hierarchy, publication and interaction behavior remain environment-dependent acceptance checks.

## 2026-10-04 — AutoMod CRUD verification
- CI run **#1242** passed the full automated matrix after the AutoMod Control Center CRUD pass.
- Regression coverage includes unsupported-detector rejection before SQL writes; production Dashboard build also validates the new editor UI contracts.

## 2026-10-04 — Security Center verification
- CI run **#1245** passed the full automated matrix after adding the Security Control Center and local security snapshot route.
- Live Discord role hierarchy, permission, incident and quarantine restoration behavior still require the live acceptance environment.

## 2026-10-04 — Temporary Voice verification
- CI run **#1249** passed the full automated matrix after adding `/voice` and prefix room-control routing.
- Command registration and required option ordering are covered by the command contract tests; live Discord permission behavior remains an acceptance check.

## 2026-10-04 — Temporary Voice Control Center verification
- CI run **#1253** passed the full automated matrix, including bot typecheck, **78 passing tests**, domain/bot builds and Dashboard production build.
- Slash command registration coverage includes the `/voice` owner-control subcommands and required option ordering.
- Live Discord voice permissions, overwrites and member movement remain environment-dependent acceptance checks.

## 2026-10-04 — Welcome Control Center verification
- CI run **#1256** passed the full automated matrix, including bot typecheck/tests, domain and bot builds, and Dashboard production build.
- Welcome test delivery is covered by the Management API/route type and build path; live Discord permission and message-delivery behavior remains environment-dependent acceptance.

## 2026-10-04 — Community Tools poll creator verification
- CI run **#1260** passed the full automated matrix after adding Dashboard poll creation.
- Production Dashboard build validates the new poll form; live Discord publication permissions and interaction behavior remain environment-dependent acceptance checks.

## 2026-10-04 — Control Center contract audit verification
- CI run **#1262** passed the full automated matrix after correcting the AutoMod `PANEL_KEYS` contract.
- Static consistency check found zero `full` modules without a panel branch, zero panel branches without `PANEL_KEYS`, and zero extra panel keys.

## 2026-10-04 — Economy Admin verification
- CI run **#1268** passed the full automated matrix after adding Economy account management.
- Dashboard production build validates the account editor and route contracts; live authorization remains dependent on the protected local Control Center environment.

## 2026-10-04 — Command routing verification
- CI run **#1272** passed the full automated matrix after the Temporary Voice slash-command listener wiring fix.
- Existing command registration tests plus full build/typecheck validate the routing contract; live Discord interaction acceptance remains environment-dependent.

## 2026-10-04 — Local Dashboard authentication removal
- Local Control Center no longer has an end-user login/logout flow or dashboard admin password/session secret.
- Dashboard access remains local-first/loopback by default; server-side requests to the Management API remain protected by the internal bearer key.
- Legacy login routes and page were removed.

## 2026-10-04 — Bot Registry verification snapshot
- ✅ Credential encryption/decryption and plaintext-storage regression coverage.
- ✅ Registration input normalization and Discord-token validation path.
- ✅ Database migration is covered by the idempotent PostgreSQL migration test.
- ✅ DB-first runtime resolution; environment values are bootstrap-only.
- ✅ Fail-closed behavior for corrupted stored credentials.
- ✅ CI run #1590: **84/84 bot tests passed**, domain/bot/dashboard builds passed, deployment/observability contracts passed.
- ⚠ Live Discord credential registration still requires a real user-owned Discord application/token.
- ⚠ Additional Bot Identity registration does not yet spawn another process; Fleet orchestration remains the next module.


## 2026-10-04 — Local Bot Fleet orchestration snapshot
- ✅ Static deployment contract validates the Fleet reconciler and local launcher wiring.
- ✅ Secondary container lifecycle is driven by registered Bot Identity metadata and stored-credential presence.
- ✅ Cleanup path removes disabled/unregistered secondary containers.
- ⚠ Actual Windows/Docker Desktop multi-bot runtime remains a live local acceptance test.


## 2026-10-04 — Local Fleet orchestration CI verification
- ✅ CI run #1592 passed the complete automated pipeline.
- ✅ Fleet launcher/reconciler contract validation passed.
- ⚠ Real multi-bot Windows/Docker runtime and Discord Gateway behavior still require live acceptance with user-owned bot credentials.


## 2026-10-04 — Security anti-nuke event coverage
- ✅ Regression coverage added for channel/role create/delete audit-log mapping.
- ✅ Existing destructive-burst executor response pipeline remains reused.
- ⚠ Live Discord audit-log timing and real admin-action correlation require acceptance testing.


## 2026-10-04 — Security / Music release-gate checkpoints
- ✅ CI run #1596 verifies the Security anti-nuke event-mapping increment.
- ✅ CI run #1603 verifies Music provider-aware search routing, provider command registration and Control Center provider selection.
- ⚠ Live Security audit-log correlation, real Lavalink provider availability and real multi-node failover remain environment-dependent acceptance tests.
- ☐ Next: Music multi-node failover hardening with deterministic node-loss/recovery regression coverage.


## 2026-10-04 — Music multi-node failover snapshot
- ✅ CI run #1605 verifies failover event instrumentation and debug-event filtering.
- ✅ CI run #1606 verifies disconnect-time player persistence wiring.
- ✅ CI run #1607 verifies accurate persistence failure reporting.
- ✅ CI run #1608 verifies active-node visibility in the Control Center plus the complete automated matrix.
- ⚠ Live Lavalink node-loss/recovery, player migration, queue continuity and audio continuity remain environment-dependent release-gate tests.
- ☐ Next: live Music failover acceptance, then broader fleet/release-gate validation.


## 2026-10-04 — AutoMod log response verification
- ✅ CI run **#1617** passed the full automated matrix after fixing AutoMod rule-log typing and response-flow regression coverage.
- ✅ Persisted `automod_rules.log_channel_id` is covered by migration, CRUD, Management API validation and Dashboard contract paths.
- ✅ Rule log delivery is regression-tested with deterministic channel routing and final `logDelivered` audit metadata.
- ⚠ Live Discord channel permissions, deleted/missing log-channel handling and real message delivery remain environment-dependent acceptance cases.
- ☐ Next: continue richer AutoMod/Security response workflows, then broader Fleet/release-gate validation.
