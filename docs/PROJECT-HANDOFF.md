# PROJECT HANDOFF — Discord Server Bot Platform

> Канонический файл непрерывности между чатами. Новый чат при продолжении разработки **обязан сначала прочитать этот файл**, затем `docs/PROJECT-STATE.md`, `docs/WORK-LOG.md` и `docs/TEST-MATRIX.md` перед тем, как предлагать новый план или задавать вопросы о уже зафиксированных решениях.

## 1. Что это за проект

**Discord Server Platform** — self-hosted all-in-one Discord platform/bot, который должен закрывать функциональность нескольких зрелых Discord-ботов одновременно.

Главная идея:
- не «музыкальный бот»;
- не «ещё один Carl-bot»;
- не набор разрозненных интеграций;
- а единая платформа, способная заменить несколько специализированных/all-in-one ботов на сервере;
- без искусственной Premium wall для возможностей, которые можно нормально реализовать в self-hosted продукте;
- с едиными permissions, persistence, audit, diagnostics, Dashboard и automation contracts.

Музыка — один крупный модуль. Она не должна поглощать roadmap.

## 2. Эталон функциональности

Не использовать один бот как единственный benchmark.

Основной benchmark set:
- **MEE6** — широкий plugin/ecosystem scope: automations, moderator, custom commands, welcome/goodbye, levels, economy, giveaways, polls, invite tracker, reaction roles, social alerts, AI/Bot Maker и т. п.
- **JuniperBot** — глубокий AutoMod/security, custom commands/templates, ranking/XP, subscriptions, logging/audit, welcome/role restore, forms/components.
- **ProBot** — moderation/logging, AutoMod/protection, anti-raid, variables, autoroles/self-roles, starboard, server statistics, Twitch/YouTube notifications и server-management tooling.
- **Dyno** — AutoMod, custom commands, autoresponders, automessages/autodelete, forms, tickets, giveaways, reaction roles, embeds, feeds, AFK и расширяемые лимиты.
- **Jockie Music** — benchmark именно для Music: multi-bot voice scaling, deep queue/collection management, permissions/session ownership, Spotify/Apple Music, large collections, 24/7.
- Другие специализированные боты — использовать там, где узкий бот объективно глубже all-in-one решения: Music, Tickets, Moderation, Statistics, Social Alerts, Games/Engagement и т. д.

Premium parity = **совокупность сильных функций разных экосистем**, а не копия Premium одного вендора.

Не копировать чужой код или закрытые implementation details.

## 3. Уже существующий функциональный baseline

На текущей ветке `feature/music-v2` уже реализованы/расширены:

### Core / Platform
- typed Discord event bus/module lifecycle;
- PostgreSQL persistence + versioned migrations + advisory migration lock;
- health/readiness endpoint;
- durable audit log;
- Management API;
- Dashboard / Control Center;
- configuration backup/import/export;
- multi-bot identities/fleet assignments;
- native Windows runtime;
- Docker/VPS foundation.

### Moderation
- warn / timeout / kick / ban / unban;
- case history;
- timed punishments;
- purge;
- slowmode;
- lock/unlock;
- moderation notes;
- warning escalation;
- permission/role hierarchy diagnostics;
- moderation Dashboard.

### AutoMod / Security
- blocked words;
- Dashboard AutoMod rule editor with per-detector actions, thresholds, scopes, exemptions and response templates;
- AutoMod rules enforce per-user/per-detector cooldown windows and route warning actions through Moderation.
- links/invites;
- spam/repeated messages;
- mention/caps/emoji limits;
- channel/role exemptions;
- delete/timeout actions;
- Anti-Raid;
- destructive burst / anti-nuke;
- quarantine/lockdown responses;
- scam/phishing heuristics;
- honeypot/advanced detectors;
- persistent response-policy controls;
- security status/incident diagnostics.

### Community
- welcome/goodbye;
- verification;
- autoroles;
- role restore;
- reaction/button/select roles;
- timed/exclusive/max-selection role modes;
- leveling / XP;
- text + voice XP;
- XP anti-abuse/exclusions;
- rank / leaderboard;
- giveaways + requirements/templates;
- starboard;
- economy/shop/ledger;
- reputation/profiles;
- polls/suggestions;
- birthdays/achievements;
- invite tracking;
- server counters/statistics;
- embed builder;
- sticky/scheduled messages.
- AFK / away status with persistent state, automatic return clearing and mention notices.

### Tickets
- ticket panels;
- claim / close / reopen;
- staff role/category routing;
- HTML transcripts;
- auto-close;
- per-user limits;
- Dashboard ticket operations;
- lifecycle/race/rollback hardening.

### Automation
- event -> conditions -> actions;
- ALL / ANY conditions;
- cooldowns;
- message/role/moderation actions;
- schedules;
- DM/webhook;
- conditional branches;
- durable delayed jobs with lease/retry/recovery;
- reusable templates/snippets;
- visual builder;
- cross-module expansion is planned.

### Notifications / Integrations
- RSS / Atom;
- Twitch stream alerts;
- YouTube stream alerts;
- VK Video Live alerts;
- templates;
- GitHub feeds;
- SSRF/HTTPS validation;
- Kick stream alerts were added but are explicitly **de-prioritized**.

### Music current baseline
- YouTube playback;
- SoundCloud;
- persistent queue;
- playlist loading up to 500 tracks;
- pause/resume/skip/stop;
- shuffle;
- repeat off/track/queue;
- autoplay;
- seek;
- volume up to 200;
- now playing;
- persistent controller/player message;
- dedicated request/controller channel;
- message -> play flow;
- multi-bot per-voice identity routing;
- Lavalink reconnect/session resume;
- multi-node failover fallback;
- favorites;
- personal saved playlists;
- queue pagination;
- previous track;
- lyrics lookup;
- EQ/filter presets;
- bassboost;
- nightcore;
- 8D rotation;
- 24/7;
- DJ queue-access policy;
- provider status;
- LavaSrc foundation.

## 4. Обязательный общий продуктовый backlog

### Administration / Dashboard
- function-level permission editor;
- richer previews/test actions;
- complete admin audit/activity timeline;
- per-module error/activity history;
- reusable server configuration presets;
- stronger import/export resource remapping;
- stronger multi-server/fleet administration;
- configurable bot identity/profile.

### Moderation / AutoMod / Security
- rule-specific punishments;
- per-rule rate limits;
- richer exemptions;
- autoban;
- scheduled cleanup/autopurge;
- lockdown presets;
- incident-response playbooks;
- moderation presets/templates;
- richer action logging;
- broader detectors.

### Server utilities
- Custom Commands now have a first-class module toggle plus Dashboard CRUD for prefix/Slash commands, aliases, role actions and cooldowns.
- Custom Commands;
- Autoresponder/keyword triggers;
- richer tags/templates;
- richer embed builder;
- automessages;
- forms;
- interactive buttons/selects/modals toolkit;
- custom help/menu pages;
- server/user/role/channel utility commands;

### Roles / Onboarding
- richer self-service role menus;
- joinable ranks;
- voice-role links;
- delayed autoroles;
- onboarding flow builder (implemented 2026-10-05);
- richer welcome/goodbye customization.

### Tickets / Forms
- intake forms;
- custom form fields and validation;
- customizable ticket buttons/messages;
- linked/related panels;
- ticket tags/priorities/assignment state;
- staff SLA/reminders/escalation.

### Community / Engagement
- social widgets;
- richer rewards/milestones;
- deeper engagement/gamification;
- expand existing leveling/economy/reputation/giveaway systems.

### Automation
- richer trigger catalog;
- richer conditions;
- richer actions;
- workflow retries/dead-letter diagnostics;
- reusable workflow presets;
- cross-module actions;
- stronger visual builder.

### Notifications / Integrations
- additional social/feed adapters;
- per-feed filters/keywords;
- richer embeds/templates;
- multiple credentials/providers per guild;
- integration test/diagnostics UI.

### Analytics / Observability
- audit/activity timeline;
- configurable counters;
- exportable analytics;
- retention/history controls;
- stronger per-module diagnostics.

## 5. Music roadmap — крупный модуль, но НЕ центр проекта

Обязательные Music-функции:

### Controller
- emoji-centric compact controls/labels;
- persistent player state;
- clear controller refresh after actions;
- **отдельная кнопка Loop One / «зациклить один трек»**, отличная от queue repeat;
- progress/elapsed display;
- queue / lyrics / favorite / FX / save-queue / radio quick actions.

### Search / Queue
- multi-result search picker;
- remove track;
- remove range;
- reorder/move;
- insert/add to front;
- skip-to;
- clear queue without destroying player;
- history/recent;
- requester display;
- queue export/share;
- save queue as playlist;
- playlist shuffle loading.

### Music permissions / anti-abuse
- separate permissions for play/skip/stop/seek/volume/filter;
- separate queue add/remove/move permissions;
- vote-skip;
- per-user cooldown;
- per-user queue limits;
- fair requester rotation;
- max guild queue size;
- optional request approval/moderation mode.

### Playlists / saved state
- shared/server playlists;
- per-track add/remove/reorder;
- supported playlist imports;
- save queue;
- play-favorites/play-playlist shortcuts;
- richer pagination/management.

### Effects
- Karaoke;
- pitch;
- speed;
- tremolo/other Lavalink effects;
- custom EQ editor;
- named profiles (Gaming/Anime/Chill/Party etc.);
- persist/restore effect state.

### Autoplay / Radio
- recent-track avoidance;
- artist/similarity-aware autoplay;
- radio mode;
- playlist continuation;
- richer Dashboard controls.

### Lyrics
- pagination;
- navigation buttons;
- synced lyrics where timing exists;
- source/status diagnostics.

### Providers
Обязательное расширение источников:
- YouTube / YouTube Music;
- SoundCloud;
- Spotify;
- Apple Music;
- Deezer;
- **Yandex Music**;
- VK Music;
- Tidal;
- Qobuz;
- yt-dlp;
- JioSaavn.

Важно: provider не считается готовым только потому, что его добавили в конфиг. Готовность подтверждается реальным adapter/source + credentials + playback/search validation. Некоторые источники могут быть metadata/search/mirror sources, а не прямым audio source.

## 6. Приоритет разработки

Текущий принцип:

1. **All-in-one foundation / admin contracts**
2. **Moderation + AutoMod + Security parity**
3. **Server utilities + Roles + Onboarding**
4. **Tickets / Forms + Automation parity**
5. **Community / Engagement parity**
6. **Notifications / Integrations + Analytics**
7. **Advanced Music UX**
8. **Music provider expansion + saved state/effects/autoplay**
9. **Whole-platform E2E / chaos / soak / clean-host**
10. **Stable release**

Не возвращаться к «Music-first» порядку.

## 7. Что НЕ делать без явной причины

- Не тратить основной development на количество интеграций ради красивой Feature Matrix.
- Не превращать проект в music-only bot.
- Не считать один конкретный бот единственным эталоном.
- Не объявлять функцию готовой только потому, что есть строка в конфиге или Dashboard.
- Не ломать уже работающий YouTube/Twitch/VK baseline ради новых провайдеров.
- Не переписывать работающие подсистемы ради косметической архитектуры.
- Не копировать proprietary/closed code.
- Не создавать artificial Premium wall.
- Не спрашивать пользователя заново о решениях, которые уже записаны в этом handoff и work log.
- Не менять приоритет на новую красивую интеграцию, если существует незакрытый высокоценный общий Discord backlog.
- Не объявлять release complete только по unit/CI; live Discord, Lavalink, Windows, E2E, chaos, soak и clean-host проверки отдельный gate.

## 8. Текущие важные решения

- Stream alerts Twitch/YouTube/VK уже являются практическим baseline; Kick остаётся optional/deferred.
- Multi-bot/fleet нужен прежде всего для независимого обслуживания нескольких voice channels и масштабирования.
- Dashboard и Discord commands должны использовать одну модель настроек/прав.
- Automation должна оставаться durable/persistent, а не только in-memory.
- Security response policies должны быть настраиваемыми и сохраняться.
- Music controller должен быть визуально удобным и управляться в основном кнопками/эмодзи.
- Loop One — отдельный UX элемент, а не просто ещё один скрытый repeat mode.
- Provider expansion обязателен, но provider readiness требует реальной проверки.
- Основная ценность продукта — объединение сильных возможностей разных Discord bots в едином self-hosted продукте.

## 9. Последнее состояние разработки

Репозиторий: `Agro4221/Discord-Server-Platform`
Рабочая ветка: `feature/music-v2`
PR: **#3** — `feat: Discord platform expansion + Music v2`
PR остаётся **draft**.

Текущий source checkpoint:
`9ca8b24d022ee4494873da651162ccba583d3f53`

Branch HEAD is tracked by the PR/branch ref; the source checkpoint above identifies the last code-changing commit.

Последние bounded срезы:
- исправлен Dashboard TikTok OAuth import blocker;
- добавлен Dashboard local-import CI contract;
- выровнена Apple Music readiness;
- усилен Music/Lavalink failover target selection;
- выровнена credential-aware readiness для Deezer/Yandex/VK/Tidal/Qobuz/JioSaavn;
- добавлены детерминированные regression tests.

Последний доступный CI #2369 относится к старому checkpoint и после наших последующих изменений не является доказательством текущего состояния. Текущий HEAD считать **не CI-verified**, пока новый Actions run явно не появится.

Feature Matrix полностью reconciled: все строки ✅.

Следующий инженерный приоритет: продолжать release-gate hardening одним bounded срезом, затем live validation (Discord/Lavalink, Windows, E2E/chaos/soak/security, clean-host/VPS и внешние провайдеры).
## 10. Как продолжать в новом чате

1. Прочитать **этот файл полностью**.
2. Прочитать `docs/PROJECT-STATE.md`.
3. Прочитать последние записи `docs/WORK-LOG.md`.
4. Прочитать `docs/TEST-MATRIX.md` перед объявлением подсистемы complete.
5. Проверить фактический HEAD/CI/PR state.
6. Продолжать с самого высокого незакрытого приоритетного backlog, не изобретая заново цель проекта.
7. При существенной разработке сразу дописывать сюда/в Work Log: что сделано, что проверено, какие решения приняты, что осталось.

Цель следующего чата: **продолжать разработку, а не заново выяснять, что именно мы строим.**


### 2026-10-03 — Custom Commands / Dashboard follow-up
- Control Center now exposes Custom Commands as a first-class module entry.
- The specialized builder remains API/audit backed and accepts async audit refresh callbacks.
- Dashboard panel was simplified to match established panel patterns and avoid redundant client-side memoization.


### 2026-10-03 — AutoResponder module
- Added first-class `autoresponder` module with persistent keyword/phrase rules and Dashboard CRUD.
- Matching supports exact, contains, starts-with and regex, with role/channel scopes, per-user cooldown and optional source-message deletion.
- Runtime delivery and configuration changes are written to the durable audit log.


### 2026-10-03 — Ticket Intake Forms
- Tickets now support persistent custom intake fields (up to five Discord modal inputs).
- Dashboard configures field ID, label, input type, required state, placeholder and max length.
- Submitted answers are persisted with the ticket and included in ticket presentation/transcript.
- Legacy servers without custom fields automatically use the existing subject + description form.


### 2026-10-04 — Command policy Dashboard completion
- Function-level permission editing is now represented as implemented: the Dashboard exposes enabled state, Prefix/Slash mode, cooldown, allowed/denied roles, allowed/denied channels and help visibility for every registered command.
- The implementation reuses the existing command_policies persistence/API and shared runtime enforcement; no second permissions model was introduced.
- Live browser CRUD and Discord authorization/resource-scope behavior remain release-gate validation items.


### 2026-10-04 — AutoMod ban action
- AutoMod rule actions now include `ban` in addition to delete/timeout/warn/log.
- The implementation reuses the existing Moderation service for role-hierarchy validation, audit and case persistence.
- Migration 67 updates the persistent action constraint; live Discord ban execution remains a release-gate check.


### 2026-10-04 — Ticket customization
- Ticket customization is now implemented alongside intake forms: panel title/description and the three primary button labels are persisted and used by Ticket UI flows.
- Migration 68 is the schema gate; API/Dashboard use the same normalized contract. Live Discord rendering remains release-gate validation.


### 2026-10-04 — Automation moderation depth
- Automation supports warn/kick/ban through the shared Moderation pipeline.
- Management API validation now covers the full existing Dashboard action catalog, including nested branches.
- Next automation focus: richer event context/variables and dry-run/test execution.


### 2026-10-04 — Automation event context
- Automation now exposes richer moderation/role/ticket context to conditions and templates while preserving the current event model.
- Next automation priority: operational dry-run/test execution and diagnostics before further action expansion.


### 2026-10-04 — Automation dry-run
- Safe dry-run/test execution is implemented through the existing Automation engine and Dashboard builder.
- It validates and previews rules without executing side effects; numeric/role event context can be supplied for deterministic tests.
- Next automation work can focus on richer operational diagnostics/observability rather than another execution path.


### 2026-10-05 — Latest implementation slice
- Onboarding Flow Builder is implemented on `feature/music-v2`.
- Do not reopen broad polish work before selecting the next single backlog module.
- Source checkpoint: `f772b0503f3f5e5b9f9abb5f30625bacf5801068`.
- CI #1854 is the automated verification gate; live Discord validation remains environment-dependent.

    
### 2026-10-05 — Onboarding slice closed
- Completed and CI-verified: configurable onboarding triggers, ordered role/channel/DM steps, persistence, export/import, Management API and Control Center builder.
- Final source HEAD: `de06195a8d70c18a01536231f3b587008f1309ba`; CI `#1857` passed.
- Do not reopen broad polish work before selecting exactly one next backlog module.


### 2026-10-05 — Dashboard previews / test actions closed
- Completed and CI-verified the next Administration slice.
- Current implementation checkpoint: `35660b0f5291104c4d66bc80463dfa768f2f2174`.
- Next unfinished high-priority item in Administration is **per-module activity/error history**; then reusable server configuration presets.


### 2026-10-05 — Per-module activity/error history closed
- Implemented and CI-verified module-scoped operational history on top of the existing Audit Log.
- Final code checkpoint: `2bdd9e7f092da349b8caed846459dc95fb9ffdd7`.
- Next single module: **Mass configuration / reusable server presets**.


### 2026-10-05 — Administration slices closed
- Reusable server presets and configurable bot identity/profile are now implemented and CI-verified.
- Final profile checkpoint: `b415110795afcc823ebffa64fdf54ca992757d94`.
- Next single backlog slice: **Docker / VPS foundation**.


### 2026-10-05 — Docker / VPS slice closed
- Docker/VPS foundation is implemented and CI-verified.
- Final source checkpoint: f466eddb5749c0044c7f1b9fce68b7dd4f9b412c.
- Next single backlog slice: RU / EN localization.


### 2026-10-05 — RU/EN localization foundation closed
- Completed and CI-verified the shared localization foundation and first core command migrations.
- Source checkpoint: d871b56f36a91d15c07038ebf3122956d8d4e66a.
- Next single backlog selection should come from the next unfinished feature, not from broad UI translation cleanup.


### 2026-10-05 — Current development checkpoint
- Per-guild integration credentials for Twitch/YouTube/Kick are implemented and selected per Stream Alert.
- The next single backlog slice is **Integration test/diagnostics UI**.
- Continue from branch `feature/music-v2`; do not reopen completed credentials work.


### 2026-10-05 — Current checkpoint after integration diagnostics
- Current source HEAD: `22f8e4856ef83120a5ebd2f678b826cad712c869`.
- Per-guild integration credentials and provider diagnostics are complete and CI-verified (#1923).
- Next single module: **Configurable analytics counters**.


### 2026-10-05 — Current checkpoint after Analytics
- Analytics visible counters and retention/history configuration are complete and CI-verified (CI #1926).
- Next single module: **Tickets / linked-related panels**.
- Continue on `feature/music-v2`; do not reopen completed Analytics configuration work.

### 2026-10-05 — Current checkpoint after Ticket Panels
- Ticket linked/related panels are complete and CI-verified (#1949).
- Next single module: **Custom member rewards / milestones**.
- Do not reopen completed Ticket Panels or Analytics/Integration work.


### 2026-10-05 — Current checkpoint after Leveling rewards
- Custom member rewards / milestones are complete and CI-verified (#1955).
- Next single module: **Community social widgets / engagement depth**.
- Do not reopen completed rewards, Ticket Panels, Analytics or Integration work.


### 2026-10-05 — Current checkpoint after Community Hub
- Social/community engagement widgets are complete and CI-verified (#1964).
- Next single module: **Additional social feeds**.


### 2026-10-05 — Music phase begins after platform-wide parity pass
- Platform-wide unfinished non-Music high-value slices are now largely closed/reconciled.
- Next single implementation slice: **Music — skip-to track**.


### 2026-10-05 — Current checkpoint after Music Filters
- Filters / FX quick-access is complete and CI-verified (#1990).
- Next single module: Save queue button.


### 2026-10-05 — Current checkpoint after Save Queue
- Save Queue / Save current queue as playlist are complete and CI-verified (#1997).
- Next single module: Load playlist with optional shuffle.


### 2026-10-05 — Current checkpoint after playlist shuffle
- Load playlist with optional shuffle is complete and CI-verified (#2004).
- Next single module: Vote skip.


### 2026-10-05 — Current checkpoint after Vote Skip
- Vote Skip is complete and CI-verified (#2012).
- Next single module: Per-user request cooldown.


### 2026-10-05 — Current checkpoint after request cooldown
- Per-user request cooldown is complete and CI-verified (#2020).
- Next single module: Per-user queued-track limit.


### 2026-10-05 — Current checkpoint after per-user queue limit
- Per-user queued-track limit is complete and CI-verified (#2034).
- Next single module: Max guild queue size.


### 2026-10-05 — Current Music checkpoint
- Controller permissions now honor the shared Command Policy; Autoplay has a persistent quick toggle.
- Next single module: **separate queue add/remove/move permissions**.
- Do not reopen completed controller permission/autoplay work.


### 2026-10-05 — Current Music checkpoint
- Separate queue add/remove/move permissions are complete and CI-verified (#2063).
- Before the next Music slice, re-audit remaining TODOs against actual code because several Matrix rows are historical/stale.

### 2026-10-05 — Backup/restore hardening
- `BackupService` guild-scoped APIs now reject malformed guild IDs before backup filesystem/remote access.
- Added database-backed regression coverage for cross-guild read/restore/delete isolation and invalid backup filenames.
- Source checkpoint: `9ca8b24d022ee4494873da651162ccba583d3f53`.
- Fresh CI is not visible; do not mark this slice CI-verified yet.
- Next engineering focus remains one bounded release-gate slice at a time, followed by live Discord/Lavalink/Windows/E2E/chaos/soak/clean-host validation.

### 2026-10-05 — VPS runtime smoke-gate hardening
- VPS install/upgrade success criteria now cover bot health, direct Dashboard readiness and public Caddy Basic Auth protection rather than checking only the bot.
- The Caddy edge smoke test targets the configured domain through loopback with SNI/Host resolution and expects HTTP 401 without credentials.
- Deployment CI contract requires the smoke-check probes to remain present.
- Source checkpoint: `95877c00ac9fff5d1615d519f202a316ba403783`.
- Fresh CI is still not visible; live DNS/TLS and actual clean-host execution are release-gate tasks.

### 2026-10-05 — VPS reinstall safety
- Re-running the VPS installer no longer rotates existing Management API, PostgreSQL or Lavalink secrets.
- This preserves the existing PostgreSQL role/password relationship and Management API access across reinstall/repair operations while still auto-generating missing secrets on first install.
- Deployment contract checks for the preservation helpers.
- Source checkpoint: `73e5ebdf792f38ae2ab29fb0ba0adba7f224154f`.
- Fresh CI and actual existing-volume reinstall remain release-gate validation items.

### 2026-10-05 — VPS upgrade configuration guard
- `upgrade.sh` now fails before Compose startup when any critical secret is absent from `.env`.
- This complements installer secret preservation and prevents a damaged configuration from being presented as a successful upgrade.
- Deployment CI contract checks the guard textually; live upgrade/recovery is still a release-gate task.
- Source checkpoint: `67ed79823ca844e1daa088b9631f7a41a45c26be`.

### 2026-10-05 — VPS upgrade domain validation
- Existing VPS upgrades now validate `DOMAIN` from `.env` before public Caddy probing.
- Invalid/missing domain configuration fails early and explicitly.
- Deployment CI contract preserves this guard.
- Source checkpoint: `83f7e61bb7b9cfc25902effc011023ff8b5af288`.

### 2026-10-05 — Deployment guard reconciliation
- Keep VPS-specific domain and Caddy validation conditional on the actual Caddy overlay; do not impose VPS settings on the normal local upgrade path.
- Deployment contract currently covers migration continuity, Compose validity, VPS runtime smoke probes, installer secret preservation, upgrade secret checks and Caddy configuration checks.
- Upgrade source checkpoint: `dcd9476f76a01995f532dc69e24185079ec93d42`.
- The current PR head still reports zero GitHub check-runs in the available connector; do not mark these slices CI-verified.

### 2026-10-05 — VPS Caddy reinstall safety
- Installer-created Caddy configuration is now first-write-only: an existing `infrastructure/caddy/Caddyfile` is preserved across reruns.
- This complements secret preservation and prevents an installer rerun from silently discarding deliberate Caddy configuration changes.
- Deployment contract checks the preservation rule.
- Source checkpoint: `3b2f0de1bd925a87059cc8bd740a076dec084083`.

### 2026-10-05 — Management API secret guard
- The application still intentionally has no end-user Dashboard login, but its Management API cannot start with an empty or whitespace-only API key.
- `MANAGEMENT_API_KEY` is validated as non-blank during config loading and is covered by regression tests.
- Source checkpoint: `333ce7ca164fa0e0dd7c0ba776bc5315c0217924`.

### 2026-10-05 — Management API auth regression coverage
- Keep the local Control Center intentionally login-free while protecting every Management API request with the configured exact Bearer key.
- `isManagementApiAuthorizationValid()` is now directly regression-tested and rejects blank keys/headers, alternate auth schemes and non-exact credentials.
- Source checkpoint: `3211e31ed8e07d0b41b0d25995a81e45ebef5f91`.

### 2026-10-05 — Dashboard mutation security gate
- Dashboard API mutations must use the shared `assertSameOrigin()` protection; read-only GET routes do not require it.
- Fixed the discovered gaps in Help Pages deletion, Moderation Presets mutation and Role Automation creation.
- `scripts/check-dashboard-route-security.mjs` now enforces the mutation-route contract in CI.
- This complements the public VPS Caddy Basic Auth boundary and the internal Management API Bearer-key boundary without reintroducing end-user Dashboard login.

### 2026-10-05 — Dashboard mutation gate follow-up
- A second audit found one remaining concrete gap inside the Integration Credentials API: POST /test was missing assertSameOrigin even though DELETE was protected.
- Fixed the POST handler and upgraded the route-security checker to validate each exported mutating handler independently.
- Route checkpoint: 60b3a4ab7fd455fbe61bdcff6575c268f551666c; final checker checkpoint: 9fa32baf9c9522485b829c68a36675d191681492.
- Continue with the next bounded release-gate audit; do not reopen completed feature modules. Keep the no-login local Control Center and internal Management API Bearer-key model unchanged.
- Fresh CI remains unavailable in the current connector session; live Discord/Lavalink/Windows/E2E/chaos/soak/clean-host validation is still pending.
### 2026-10-05 — Backup configuration contract cleanup
- Removed the unused BACKUP_ENCRYPTION_KEY example entry after confirming the runtime never consumed it.
- Do not treat the platform as locally encrypted-backup capable; the current backup implementation provides filesystem permissions and optional S3 AES256 server-side encryption.
- Config export intentionally does not include bot/integration credential ciphertext.
- Continue with the next bounded release-gate audit; avoid turning this cleanup into a broad backup-format rewrite.
## 2026-10-05 — Compose secret hardening
- Direct Docker Compose startup no longer has predictable change-me fallbacks for PostgreSQL/Lavalink credentials.
- The supported local path remains scripts/start-local.ps1, which generates persistent secrets before Compose startup; CI uses ephemeral values only for static Compose validation.
- Treat this as release-gate hardening, not a new runtime feature.

## 2026-10-05 — Source hygiene gate follow-up
- Source hygiene was found to have a regex false-negative; keep the repaired patterns intact.
- The scanner now covers the existing token/private-key forms plus github_pat and AWS access-key IDs.
- Do not treat source hygiene as fully release-verified until CI runs against the current branch head.

## 2026-10-05 — Runtime secret validation follow-up
- Keep critical startup configuration strict: DATABASE_URL and Lavalink passwords must contain non-whitespace content.
- Custom Lavalink node passwords must also be non-blank.
- Do not loosen these checks back to truthiness-only validation.
## 2026-10-05 — Docker port/secret follow-up
- Preserve the split between host-published Management API port and container-internal port: external mapping is configurable, internal bot/Dashboard port is 3002.
- Do not reintroduce change-me credential fallbacks into any Compose service.
- This is runtime/recovery hardening; no new user-facing feature is being introduced.
## 2026-10-05 — First-run Control Center bootstrap fix
- Keep /health and /ready semantically separate: /health must permit the Control Center to come up after database readiness, while /ready represents full bot readiness.
- Do not restore strict Discord readiness semantics to the Docker healthcheck, because the supported first-run flow intentionally starts without Discord credentials.
## 2026-10-05 — Health gate contract
- Keep deployment-contract coverage for the /health vs /ready split; first-run Dashboard registration depends on this distinction.
## 2026-10-05 — Lavalink password follow-up
- Do not reintroduce a default password into infrastructure/lavalink/application.yml; the server secret must come from LAVALINK_SERVER_PASSWORD.
- Compose already injects the same secret into both Lavalink nodes.
## 2026-10-05 — Config validator checkpoint
- The required() helper was removed intentionally; keep requiredNonBlank() as the sole required secret validator.
## 2026-10-05 — VPS secret contract
- Keep critical secret checks whitespace-aware in both install-vps.sh and upgrade.sh; do not regress to plain -z checks.