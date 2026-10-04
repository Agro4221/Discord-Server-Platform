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

Последний известный HEAD после документационного обновления:
`8764ce29e240c5813c6adf3e9388610ae2b26dfb`

Последний ранее подтверждённый полный CI на кодовом HEAD до текущего документционного прохода:
- dependency audit;
- source hygiene;
- deployment/observability checks;
- bot typecheck;
- bot tests: 66/66;
- domain build;
- bot build;
- Dashboard build;
- post checks — успешно.

Последующие изменения в основном были документационными, поэтому перед новым кодовым release-gate нужно дождаться/проверить новый CI.

Live validation, требующая пользовательского окружения:
- реальный Discord;
- Lavalink voice playback;
- multi-node outage/failover drill;
- Windows runtime UX;
- E2E/chaos/soak;
- clean-host/VPS acceptance.

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
