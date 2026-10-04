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


## 2026-10-04 — AutoMod timeout moderation verification
- ✅ CI run **#1623** passed the complete automated matrix.
- ✅ Rule-based `timeout` actions are regression-tested for successful Discord timeout, persisted moderation case, reason and expiration.
- ✅ Base AutoMod timeout enforcement is regression-tested for durable `timeout` case creation.
- ✅ Existing warn-case behavior remains covered and uses the same moderation event bus path.
- ⚠ Real Discord moderation hierarchy, timeout permission and enforcement behavior remain live acceptance cases.
- ☐ Next: continue richer AutoMod/Security response workflows, then broader Fleet/release-gate validation.

## 2026-10-04 — AutoMod/Security consistency verification
- ✅ Repeated-text rule window behavior is regression-tested for messages inside and outside the configured rule window.
- ✅ Security partial incident cleanup is regression-tested; only the successfully resolved incident is counted.
- ⚠ Latest development HEAD `83755f29b9ac747b278bce919d97397441a96d00` currently has no attached CI status, so full pipeline verification is pending.
- ☐ Next: AutoMod log-action contract/warn semantics, Security executor-role lifecycle, then broader Music/Fleet failure and live release-gate validation.

## 2026-10-04 — AutoMod/Security response contract verification
- ✅ Repeated-text per-rule window regression coverage.
- ✅ Log-action missing-channel rejection regression coverage.
- ✅ Security partial incident-resolution count regression coverage.
- ⚠ Latest development HEAD `7121d7557063772d712c47006bdbb9845c99d1b9` has no attached CI status yet.
- ☐ Remaining: AutoMod warn semantics/response edge cases; Security executor-role lifecycle/restart semantics; Music/Fleet failure-path coverage; live Discord/Lavalink/Windows/VPS release gates.

## 2026-10-04 — Security window verification
- ✅ Regression coverage confirms Security window bounds: 5 seconds minimum, 3600 seconds maximum, deterministic fallback for invalid values.
- ✅ Cache retention no longer truncates events at the old five-minute ceiling.
- ⚠ Latest development HEAD `a915418cab191a58100849aff95264b49311fb74` still awaits an attached CI check.
- ☐ Next: Security executor-role lifecycle, AutoMod response edge cases, then Music/Fleet failure-path and live acceptance work.

## 2026-10-04 — AutoMod/Security CI incident log
- ✅ AutoMod repeated-text per-rule window regression coverage added.
- ✅ AutoMod log-action missing-channel contract regression coverage added.
- ✅ Security partial-resolution count regression coverage added.
- ✅ Security detection-window bound/lookback coverage added.
- ✅ CI #1647: static checks passed through deployment/observability, then failed at bot typecheck on `security.ts:767` due malformed helper text; fixed before continuing.
- ✅ CI #1651: typecheck passed; test suite ran **94 tests / 93 pass / 1 fail** because `clampSecurityIncidentDuration` was imported by `security.test.ts` but not exported by `security.ts`; fixed in `f079a866aa2294ad211d7234fa6396c8c052e643`.
- ⚠ Fresh CI for the fixed code is currently in progress; full green verification remains pending.
- ☐ Next: AutoMod warn/response semantics, Security executor-role lifecycle, then Music/Fleet failure paths and live release gates.

## 2026-10-04 — Dashboard/CI verification
- ✅ AutoMod log-rule UI requires a log channel when `action=log`.
- ✅ AutoMod response template field is present and editable.
- ✅ CI #1657 passed all automated stages: dependency audit, source/deployment/observability contracts, bot typecheck/tests, domain build, bot build and Dashboard build.
- ☐ Next: Security executor-role lifecycle; then Music/Fleet failure-path depth and live release-gate validation.

## 2026-10-04 — Security response verification
- ✅ Successful executor-role removals are counted accurately.
- ✅ Failed Discord role-removal operations are excluded from `removedRoles`.
- ✅ `removedRoleIds` is included in response audit/event metadata.
- ✅ CI #1663 passed typecheck, all bot tests, dependency audit, source/deployment/observability checks, domain/bot builds and Dashboard build.
- ☐ Next: Security executor-role lifecycle/restart semantics; then Music/Fleet failure paths and live release-gate validation.

## 2026-10-04 — Security restart verification
- ✅ Active raid/destructive incidents restore from durable PostgreSQL state.
- ✅ Latest active incident per type is selected deterministically after restart.
- ✅ CI #1667 passed all automated checks and builds.
- ☐ Next: Security executor-role lifecycle/restart policy; then Music/Fleet failure-path depth and live release gates.


## 2026-10-04 — Security executor-role lifecycle / durable history verification
- ✅ Executor role-removal policy is pinned as non-reversible automatic mitigation; incident clear/expiry continues to restore only quarantine assignments.
- ✅ Each successful executor-role removal is durably recorded with incident/user/role metadata.
- ✅ Destructive-action history is restored from durable `security_events` across process restart for the supported one-hour detection horizon.
- ✅ Regression tests cover both restart reconstruction and durable executor-role removal recording.
- ⚠ Real Discord role hierarchy, malicious-executor behavior and manual post-incident role reconciliation remain live acceptance cases.
- ✅ CI #1675 passed the complete automated pipeline: typecheck, 105/105 bot tests, dependency/source/deployment/observability checks, and domain/bot/Dashboard builds.
- ☐ Next: AutoMod response-delivery edge cases, then Music/Fleet failure paths and live release-gate validation.


## 2026-10-04 — Music failover durable-state verification
- ✅ Current-track and queued-track player destruction retains durable `music_players` state.
- ✅ Empty-player destruction still clears durable player state.
- ✅ Regression coverage added for all three retention/cleanup cases.
- ✅ CI #1677 passed typecheck, 105/105 bot tests, dependency/source/deployment/observability checks, and domain/bot/Dashboard builds.
- ⚠ Real Lavalink node loss, migration timing and audio continuity remain live release-gate cases.
- ☐ Next: Music resume/current-position/queue reconciliation; then Fleet failure paths and live release gates.


## 2026-10-04 — Music cold-recovery + Fleet heartbeat verification
- ✅ Durable Music players are reconciled after startup/node connection when no active Lavalink-resumed player exists.
- ✅ Resume position advances only for active playback and stays bounded to track duration.
- ✅ Queue-only durable sessions are considered restorable; empty snapshots are ignored.
- ✅ Stale Fleet `starting`/ `ready` heartbeats become `degraded` and are eligible for container restart by the local reconciler.
- ✅ CI #1682 passed typecheck, bot tests, domain/bot/Dashboard builds and all static contracts.
- ⚠ Real Lavalink node loss/session expiry and Windows/Docker secondary-process restart remain live acceptance tests.
- ☐ Next: Music multi-session/node-loss reconciliation, AutoMod final response edges, then live release gates.


## 2026-10-04 — Music recovery + AutoMod response verification
- ✅ Failed Lavalink resume no longer deletes recoverable durable Music state.
- ✅ Cold Music recovery reconstructs current/queued playback and bounded resume position.
- ✅ Queue-only Music sessions are considered recoverable after restart.
- ✅ AutoMod `warn` does not delete or timeout, creates a moderation case, and reports warning-response delivery success/failure.
- ✅ Response delivery failure is regression-tested without losing the moderation case.
- ✅ Fleet stale heartbeat classification and reconciler restart path are covered by regression checks.
- ✅ CI #1687 passed typecheck, bot tests, dependency/source/deployment/observability checks, and all domain/bot/Dashboard builds.
- ⚠ Real Lavalink session expiry, simultaneous node loss, Windows/Docker multi-bot restart and Discord permission behavior remain live release-gate cases.
- ☐ Next: Fleet failure injection and Music multi-session/node-loss reconciliation.


## 2026-10-04 — Fleet credential-rotation verification
- ✅ Secondary credential rotation sets a durable restart request.
- ✅ Existing heartbeat updates cannot accidentally clear the restart request.
- ✅ New process startup explicitly clears the restart request.
- ✅ Fleet status becomes `degraded` while restart is pending, driving local reconciler restart.
- ✅ Dashboard exposes the pending restart state.
- ✅ Migration 48 and regression coverage passed in CI #1689.
- ⚠ Real Docker container restart and live Discord token rotation remain environment-dependent acceptance cases.
- ☐ Next: Fleet restart/start failure injection and stale-heartbeat race coverage.


## 2026-10-04 — Fleet reconciler failure verification
- ✅ Docker remove/start failures are accumulated and returned as a non-zero reconciliation result.
- ✅ Failed container removal does not trigger a conflicting second start attempt.
- ✅ `-Down` reports cleanup failure through its exit status.
- ✅ CI #1691 passed all static checks, typecheck, bot tests and builds.
- ⚠ Real Docker Desktop failure injection remains a live acceptance test.
- ☐ Next: concurrent Fleet failover ownership / split-brain coverage.


## 2026-10-04 — Distributed Fleet ownership verification
- ✅ Async durable guild ownership verification is applied after the fast local filter.
- ✅ Ownership verification is cached for 1 second per guild to limit database load.
- ✅ Regression coverage proves stale local ownership can be rejected without removing the existing fast filter.
- ✅ CI #1693 passed typecheck, bot tests, static contracts, and all domain/bot/Dashboard builds.
- ⚠ Exact simultaneous assignment changes across multiple live processes remain an environment-dependent acceptance case.
- ☐ Next: Music simultaneous node/session failure recovery and de-duplication.


## 2026-10-04 — Music recovery concurrency verification
- ✅ Per-guild recovery lock covers both resumed-player and cold-recovery paths.
- ✅ Same-guild duplicate recovery is rejected while independent guilds remain concurrent.
- ✅ Regression coverage added for recovery lock acquisition/release semantics.
- ✅ CI #1697 passed the complete automated pipeline.
- ⚠ Real simultaneous Lavalink node reconnect/cold-start behavior remains a live acceptance case.
- ☐ Next: live release-gate prerequisites and operational acceptance.


## 2026-10-04 — Local shutdown verification
- ✅ `start-local.ps1 -Down` preserves Fleet reconciler failure status.
- ✅ `start-local.ps1 -Down` propagates Compose shutdown failure when Fleet cleanup succeeds.
- ✅ CI #1699 passed all automated checks, 105/105 bot tests and all builds.
- ⚠ Actual Docker Desktop shutdown-failure injection remains live acceptance.
- ☐ Next: static release-gate audit and live-test boundary cleanup.


## 2026-10-04 — Local release-gate preflight verification
- ✅ Non-destructive local release gate checks Docker Compose availability.
- ✅ Gate checks Bot health/readiness, Discord and database readiness, and module down-state absence.
- ✅ Gate checks authenticated Fleet state, credential readiness and pending-restart state.
- ✅ Gate checks Dashboard and both local Lavalink nodes.
- ✅ Deployment contract covers the gate script and CI #1702 passed all automated stages.
- ⚠ Real Discord/Lavalink/Windows-Docker runtime behavior remains live acceptance.
- ☐ Next: run the gate on the actual local host, then execute the live failure/soak matrix.


## 2026-10-04 — Fleet Management API failure verification
- ✅ Reconciler returns exit code 1 when the local Management API is unavailable.
- ✅ Deployment contract explicitly checks the fail-closed API outage path.
- ⚠ Real Management API outage injection on Windows/Docker remains a live acceptance case.
- ☐ Fresh CI for this checkpoint is pending.
