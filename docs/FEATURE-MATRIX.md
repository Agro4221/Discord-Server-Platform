# Feature Matrix / Product Backlog

Этот документ — единый backlog продукта **Discord Server Platform — self-hosted бот-платформа для Discord-серверов**. Он собирает текущую реализацию и целевой набор функций, который должен заменить несколько специализированных ботов без платных ограничений.

Принцип: сначала надёжная базовая функция, затем UX, затем расширенные сценарии. Для каждого модуля Dashboard и Discord должны использовать одну и ту же модель настроек и прав.

## Core / Platform

| Функция | Состояние |
|---|---|
| Slash commands | ✅ |
| Prefix commands | ✅ |
| Unified permissions / cooldowns | ✅ | Central command policy guard + Dashboard editor |
| Module lifecycle / health | ✅ |
| PostgreSQL + migrations | ✅ |
| Audit log | ✅ |
| Dashboard | ✅ |
| Backups / import / export | ✅ |
| Multi-bot identities | ✅ | Fleet identities, guild assignment, Music voice assignment, heartbeats and Dashboard controls |
| Native Windows runtime | ✅ |
| Docker / VPS | 🟡 |
| RU / EN localization | 🟡 |

## Moderation

| Функция | Состояние |
|---|---|
| Warn / timeout / kick / ban / unban | ✅ |
| Case history | ✅ |
| Timed punishments | ✅ |
| Purge | ✅ |
| Slowmode | ✅ |
| Lock / unlock | ✅ |
| Mod notes | ✅ |
| Escalation rules | ✅ | Warning thresholds can trigger timeout/ban automatically |
| Permission / role hierarchy diagnostics | ✅ |
| Moderation dashboard | ✅ | Moderation operations + escalation rules in Control Center |

## AutoMod / Security

| Функция | Состояние |
|---|---|
| Blocked words | ✅ |
| Link / invite detection | ✅ |
| Spam / repeated messages | ✅ |
| Mention / caps / emoji limits | ✅ |
| Per-channel / per-role exclusions | ✅ |
| Auto timeout / delete | ✅ |
| Anti-raid | ✅ |
| Anti-nuke / destructive burst | ✅ |
| Quarantine / lockdown workflow | ✅ | Response actions can be independently enabled/disabled in persisted Security policy |
| Scam / phishing heuristics | ✅ |
| Security incident dashboard | ✅ | `/security status` + Dashboard incident drilldown
| Honeypot / advanced detectors | ✅ | Configurable rule pipeline now activates honeypot/scam/zalgo/count detectors with scopes and actions |

## Community

| Функция | Состояние |
|---|---|
| Welcome / goodbye | ✅ |
| Verification | ✅ |
| Autoroles / starter roles | ✅ |
| Restore roles on return | ✅ |
| Reaction roles | ✅ |
| Button / select-menu role panels | ✅ |
| Timed / exclusive / max-selection role modes | ✅ | Toggle/exclusive/max + timed assignments
| Leveling / XP | ✅ |
| Text + voice XP | ✅ |
| XP exclusions / anti-abuse | ✅ |
| Rank / leaderboard | ✅ |
| Rank cards | ✅ |
| Giveaways | ✅ |
| Giveaway requirements / templates | ✅ | Required role, minimum level, announcement template |
| Starboard | ✅ |
| Economy / shop / ledger | ✅ |
| Reputation / social profiles | ✅ |
| Polls / suggestions | ✅ | Polls + Suggestions implemented
| Birthdays / achievements | ✅ |
| Invite tracking | ✅ |
| AutoResponder / keyword triggers | ✅ | Dashboard CRUD, persistent rules, scopes, cooldown and template rendering |
| Server statistics / counters | ✅ | Live `/stats` + persistent message/member/voice counters |
| Embed builder | ✅ | `/embed` с title, description, URL, color, footer, image и thumbnail |
| Sticky messages / scheduled messages | ✅ | `/schedule` + persistent `/sticky` messages with automatic refresh |

## Tickets / Support

| Функция | Состояние |
|---|---|
| Ticket panels | ✅ |
| Claim / close / reopen | ✅ |
| Staff roles / category routing | ✅ |
| HTML transcripts | ✅ |
| Auto-close | ✅ |
| Per-user limits | ✅ |
| Dashboard ticket operations | ✅ |

## Automation

| Функция | Состояние |
|---|---|
| Event → conditions → actions | ✅ |
| ALL / ANY conditions | ✅ |
| Cooldowns | ✅ |
| Message / role / moderation actions | ✅ | Includes warn/kick/ban routed through shared Moderation case + audit pipeline |
| Schedule trigger | ✅ |
| DM / webhook actions | ✅ | DM + hardened webhook action
| Conditional branches | ✅ | Nested if/else action branches up to 2 levels |
| Delay / queue semantics | ✅ | Durable delayed-action queue with lease/retry and restart recovery
| Template variables / reusable snippets | ✅ | Event + case/ticket/role/moderation context variables plus persistent named templates via `{template:name}` |
| Visual automation builder | ✅ |
| Automation dry-run / test execution | ✅ | Dashboard simulates condition matching and rendered actions without executing side effects |

## Notifications / Integrations

| Функция | Состояние |
|---|---|
| RSS / Atom | ✅ |
| Twitch start alerts | ✅ |
| YouTube start alerts | ✅ |
| VK Video Live alerts | ✅ |
| Stream alert templates | ✅ |
| Multiple provider credentials per guild | 🟡 |
| Reddit / TikTok / Kick adapters | 🟡 |
| GitHub notifications | ✅ | `/feed github` для releases и commits через существующий RSS/Atom worker |
| Twitch / YouTube / VK stream alerts | ✅ | Dashboard + persistent polling |
| Kick stream alerts | 🟡 | Реализовано, но интеграция сознательно не является приоритетом следующего Music/Discord инкремента |
| Secure feed validation / SSRF protection | ✅ |

## Music

### Current baseline

| Функция | Состояние |
|---|---|
| YouTube playback | ✅ |
| Queue persistence | ✅ |
| Playlist loading до 500 треков | ✅ |
| Pause / resume / skip / stop | ✅ |
| Shuffle | ✅ |
| Repeat off / track / queue | ✅ |
| Autoplay | ✅ |
| Seek | ✅ |
| Volume | ✅ |
| Now Playing | ✅ |
| Persistent player/controller message | ✅ |
| Emoji-based player controls + emoji labels | ✅ | Controller actions use emojis; visual labels must remain compact and understandable |
| Dedicated request/controller channel | ✅ |
| Per-voice bot identity routing | ✅ |
| Lavalink node health / reconnect | ✅ |
| Multi-node failover fallback | ✅ | Built-in autoMove + explicit migration fallback; live outage drill remains release validation |

### Mandatory next Music roadmap

Это приоритетный продуктовый backlog. Эти функции должны развивать существующий Music v2, а не заменяться новыми интеграциями ради количества галочек.

#### Search / queue UX

| Функция | План |
|---|---|
| Multi-result search picker | 🟡 | Search returns several candidates with buttons/select instead of silently choosing the first result |
| Queue remove by track | 🟡 |
| Queue remove by range | 🟡 |
| Queue move/reorder | 🟡 |
| Queue insert / add to front | 🟡 |
| Skip-to track | 🟡 |
| Clear queue without destroying player | 🟡 |
| Queue history / recently played | 🟡 |
| Show requester per queued track | 🟡 |
| Queue export / share | 🟡 |
| Save current queue as playlist | 🟡 |
| Load playlist with optional shuffle | 🟡 |

#### Player / controller

| Функция | План |
|---|---|
| Emoji-only compact controls where appropriate | 🟡 |
| Explicit **Loop One / Зациклить трек** button | 🟡 | Separate controller button; must clearly distinguish from queue repeat |
| Visual progress / elapsed time in controller | 🟡 |
| Previous / rewind / forward controls | ✅ |
| Queue / lyrics / favorite controls | ✅ |
| Filters / FX quick-access button | 🟡 |
| Save queue button | 🟡 |
| Radio/autoplay button | 🟡 |
| Controller state refresh after every action | 🟡 |

#### DJ / permissions / anti-abuse

| Функция | План |
|---|---|
| Separate permissions for play / skip / stop / seek / volume / filters | 🟡 |
| Separate queue add / remove / move permissions | 🟡 |
| DJ role policy | ✅ |
| Vote skip | 🟡 |
| Per-user request cooldown | 🟡 |
| Per-user queued-track limit | 🟡 |
| Fair queue / requester rotation | 🟡 |
| Max guild queue size | 🟡 |
| Optional approval/moderation mode for requests | 🟡 |

#### Playlists / saved state

| Функция | План |
|---|---|
| Favorites | ✅ |
| Personal saved playlists | ✅ |
| Server/shared playlists | 🟡 |
| Playlist add/remove/reorder individual tracks | 🟡 |
| Import playlists from supported URLs | 🟡 |
| Save queue as playlist | 🟡 |
| Play favorites / play playlist shortcuts | 🟡 |
| Playlist pagination and richer management UI | 🟡 |

#### Audio effects

| Функция | План |
|---|---|
| EQ presets | ✅ |
| Bassboost / Rock / Pop / Classic / Electronic / FullSound / Gaming | ✅ |
| Nightcore | ✅ |
| 8D rotation | ✅ |
| Karaoke | 🟡 |
| Pitch control | 🟡 |
| Speed control | 🟡 |
| Tremolo / rotation / other Lavalink effects | 🟡 |
| Custom EQ editor | 🟡 |
| Named effect profiles | 🟡 | e.g. Gaming / Anime / Chill / Party |
| Persist and restore effect state | 🟡 |

#### Autoplay / radio

| Функция | План |
|---|---|
| Current simple autoplay | ✅ |
| Duplicate/recent-track avoidance | 🟡 |
| Artist-aware / similar-track autoplay | 🟡 |
| Radio mode by artist/genre/search seed | 🟡 |
| Playlist continuation after queue end | 🟡 |
| Autoplay profile/settings in Dashboard | 🟡 |

#### Lyrics

| Функция | План |
|---|---|
| Current-track lyrics lookup | ✅ |
| Paginated lyrics UI | 🟡 |
| Lyrics navigation buttons | 🟡 |
| Synced lyrics when source provides timing | 🟡 |
| Lyrics source/status diagnostics | 🟡 |

### Music provider expansion

Другие музыкальные источники — **обязательная часть Music roadmap**, а не случайные отдельные интеграции. Нельзя ломать работающий YouTube default ради provider expansion.

| Источник | План |
|---|---|
| YouTube / YouTube Music | ✅ |
| SoundCloud | ✅ |
| Spotify | 🟡 |
| Apple Music | 🟡 |
| Deezer | 🟡 |
| **Yandex Music** | 🟡 |
| VK Music | 🟡 |
| Tidal | 🟡 |
| Qobuz | 🟡 |
| yt-dlp | 🟡 |
| JioSaavn | 🟡 |

Важно: часть сервисов может использоваться как metadata/search/mirror источник, а часть — как прямой audio source. Реальную поддержку проверяем по конкретному LavaSrc/source adapter и credentials; не считаем provider готовым только потому, что он появился в списке конфигурации.

### Music product principle

Music должен стремиться к функциональности сильных платных музыкальных ботов без искусственного Premium wall: расширенное управление очередью, DJ permissions, vote-skip, полноценный controller, loop-one, фильтры, autoplay/radio, lyrics, saved/shared playlists, fairness/anti-spam и широкая поддержка музыкальных источников относятся к общему продукту.

Новые музыкальные функции должны проходить через общие permissions, persistence, audit/diagnostics и Dashboard contract.

## Dashboard

Каждый модуль должен иметь:
- enable/disable рядом с заголовком;
- понятные группированные настройки;
- Discord resource pickers вместо сырых ID;
- preview там, где есть визуальный результат;
- permission diagnostics;
- test action для внешних интеграций;
- журнал ошибок и последнюю активность.

Для Music Dashboard целевой набор:
- request/controller channel;
- announcement channel;
- provider status;
- Lavalink node status;
- volume / autoplay / repeat defaults;
- DJ policy;
- 24/7 / auto-leave;
- saved playlists / favorites;
- filters;
- lyrics;
- multi-bot voice assignments.

## All-in-one / Premium parity

Модель parity должна учитывать различия между ботами: отдельные проекты могут быть лучшими в конкретном узком модуле. Поэтому сравниваем не только наличие функции, но и глубину настройки, лимиты, permission model, UX, persistence, integrations и automation hooks.

Цель проекта — **не музыкальный бот с несколькими дополнительными модулями**, а самостоятельная self-hosted all-in-one Discord platform. Music — один из крупных модулей наряду с Moderation, AutoMod/Security, Community, Tickets/Forms, Roles, Automation, Notifications, Analytics и Administration.

Поведенческие ориентиры берём у распространённых многофункциональных ботов. В актуальных материалах Dyno и Carl-bot среди таких возможностей фигурируют AutoMod, action/logging, autoroles, custom commands/autoresponders, automessages/autopurge, forms, tickets, embeds, reaction roles, feeds/notifications, leveling и другие server-management функции; часть из них у коммерческих ботов ограничена Premium-подпиской. citeturn795228search0turn795228search2turn795228search12

### Competitor benchmark set

Не привязываемся к одному боту. Для product parity используем **несколько независимых эталонов** и объединяем полезные возможности:

| Эталон | Основные области, которые изучаем |
|---|---|
| **MEE6** | Automations, Moderator, Custom Commands, Welcome/Goodbye, Levels, Economy, Giveaways, Polls, Invite Tracker, Reaction Roles, Bot Personalizer, Social Alerts, AI, Bot Maker |
| **JuniperBot** | Auto-Moderation, custom commands, message-template engine, subscriptions, ranking/XP, welcome/role restore, audit/logging, forms/components |
| **ProBot** | Moderation/logging, AutoMod, anti-raid/protection, variables, autoroles/self-roles, starboard, server statistics, Twitch/YouTube notifications, custom bot controls |
| **Dyno** | AutoMod, custom commands, autoresponders, automessages, autodelete, forms, tickets, giveaways, reaction roles, message embedder, feeds, AFK and configurable module limits |
| **Jockie Music** | Multi-bot voice scaling, deep queue/collection management, permissions/session ownership, Spotify/Apple Music sources, large playlists/collections, 24/7 |
| **Другие специализированные боты** | Берём сильные узкие функции там, где all-in-one боты обычно слабее: music, tickets, moderation, statistics, social alerts, games/engagement |

Таким образом, **Premium parity означает совокупность сильных возможностей экосистемы**, а не копирование Premium-функций Carl-bot или любого другого одного проекта. Источники для текущего benchmark: официальные материалы MEE6, JuniperBot, ProBot, Dyno и Jockie Music. citeturn368099search1turn368099search17turn510043search2turn410738search3turn410738search0turn410738search2turn410738search7

### Master backlog — не только Music

#### Administration / Dashboard
| Функция | План |
|---|---|
| Полный module/function catalog | ✅ / расширять |
| Единые permissions per command/action | ✅ |
| Function-level permission editor | ✅ | Full command-level allow/deny scopes for roles/channels, Prefix/Slash, cooldown and help visibility in Dashboard |
| Dashboard previews и test actions | ✅ | Welcome preview, Automation dry-run, Onboarding flow dry-run и operational hierarchy test actions; дополнительные module-specific previews могут расширяться дальше |
| Permission / hierarchy diagnostics | ✅ |
| Audit trail / activity viewer | ✅ | Durable audit storage with Dashboard filtering and cursor pagination; remaining gap is auditing any future mutation paths before release.
| Per-module activity/error history | 🟡 | Central audit viewer is ready; module-specific operational histories remain deeper follow-up.
| Mass configuration / reusable server presets | 🟡 |
| Import/export с корректным resource remapping | ✅ / расширять |
| Multi-server / fleet administration | ✅ / расширять |
| Configurable bot identity (name/avatar/status/banner где разрешено) | 🟡 |

#### Moderation / AutoMod / Security
| Функция | План |
|---|---|
| Warn / timeout / kick / ban / unban + cases | ✅ |
| Timed punishments | ✅ |
| Escalation policies | ✅ |
| Mod notes / history | ✅ |
| Full action logging | 🟡 |
| Rule-specific AutoMod punishments | ✅ |
| Rate limits per rule | ✅ |
| Channel / role / user exemptions | ✅ / расширять |
| Attachments / URL / invite / mention / emoji / caps / spam controls | ✅ / расширять |
| Anti-raid / anti-nuke / quarantine | ✅ / расширять |
| Scam / phishing / honeypot detectors | ✅ / расширять |
| Autoban rules | ✅ | AutoMod rules can directly apply a ban through the existing Moderation case/audit pipeline |
| Auto-purge / scheduled cleanup | ✅ | Persistent per-channel cleanup schedules with bounded bulk deletion, worker claiming and Dashboard controls |
| Lockdown presets / incident response playbooks | ✅ | Manual all-text incident lockdown with persistent restoration state, audit and Dashboard controls |
| Moderation presets/templates | ✅ |

#### Server utilities / customisation
| Функция | План |
|---|---|
| Custom commands | ✅ |
| Autoresponder / keyword triggers | ✅ |
| Reusable tags/templates/snippets | ✅ / расширять |
| Rich embed builder | ✅ / расширять |
| Scheduled messages / automessages | ✅ / расширять |
| Sticky messages | ✅ |
| Reminders | ✅ |
| Channel tools / lock / slowmode / cleanup | ✅ |
| Forms | ✅ | Универсальный Forms-модуль: Dashboard builder, Discord Modal, persistent answers и staff response channel; cross-module component orchestration remains a separate backlog item.
| Interactive buttons/selects/modals toolkit | ✅ | Buttons, select menus and Discord modals are implemented across reusable Forms and Role Panels; broader component orchestration remains backlog.
| Custom help/menu pages | ✅ |
| Server info / user info / role/channel utility suite | ✅ |
| AFK / away system | ✅ |

#### Roles / onboarding
| Функция | План |
|---|---|
| Autoroles | ✅ |
| Restore roles on return | ✅ |
| Reaction roles | ✅ |
| Button/select role panels | ✅ |
| Timed roles | ✅ |
| Exclusive/max-selection role groups | ✅ |
| Joinable ranks / self-service role menus | ✅ | Role Panels support persistent self-service role selection through buttons or select menus, with exclusive/max modes and timed assignments.
| Voice-role links | ✅ |
| Delayed autoroles | ✅ |
| Onboarding / verification flow builder | ✅ | Configurable member.join / verification.passed triggers with ordered role, channel-message and DM steps |
| Welcome/goodbye customization and images | ✅ |

#### Tickets / Support / Forms
| Функция | План |
|---|---|
| Ticket panels | ✅ |
| Claim / close / reopen | ✅ |
| Staff roles / category routing | ✅ |
| HTML transcripts | ✅ |
| Auto-close | ✅ |
| Per-user limits | ✅ |
| Intake forms | ✅ | Up to 5 Discord modal fields with persistent answers and Dashboard editor | |
| Custom form fields / validation | ✅ | Per-field required/min/max length validation with server-side submit checks.
| Custom ticket buttons/messages | ✅ | Dashboard-configurable panel title/description and create/claim/close button labels, used by ticket flows |
| Linked/related panels | 🟡 |
| Ticket tags / priorities / assignment state | ✅ | Persistent priority/tags with staff queue, existing claim/status state and Dashboard editing |
| Staff SLA / reminders / escalation | ✅ | Durable SLA timestamps, periodic worker processing and optional escalation role.

#### Community / Engagement
| Функция | План |
|---|---|
| Welcome/goodbye | ✅ |
| Verification | ✅ |
| Leveling / XP / rank / leaderboard | ✅ |
| Text + voice XP | ✅ |
| XP anti-abuse/exclusions | ✅ |
| Giveaways + requirements | ✅ |
| Polls | ✅ |
| Suggestions + moderation workflow | ✅ |
| Starboard | ✅ |
| Reputation / profiles | ✅ |
| Birthdays / achievements | ✅ |
| Invite tracking | ✅ |
| Server counters / statistics | ✅ |
| Economy / shop / ledger | ✅ |
| Social/community engagement widgets | 🟡 |
| Custom member rewards / milestones | 🟡 |

#### Automation / workflows
| Функция | План |
|---|---|
| Event → conditions → actions | ✅ |
| ALL / ANY conditions | ✅ |
| Cooldowns | ✅ |
| Schedule trigger | ✅ |
| Delay / durable delayed jobs | ✅ |
| DM / webhook actions | ✅ |
| Branches / if-else | ✅ |
| Templates | ✅ |
| Visual automation builder | ✅ |
| Richer trigger catalog | ✅ | Added reaction.remove, channel.delete, role.delete and member.ban triggers through the existing PlatformEventBus |
| Richer condition catalog | ✅ | Added role absence, bot identity, channel type and permission conditions |
| Richer action catalog | ✅ | Added nickname management and message reaction actions |
| Workflow retries / dead-letter diagnostics | ✅ | Durable delayed jobs retry with bounded exponential backoff and move to a persistent dead-letter state after five failed attempts; Dashboard diagnostics exposes the state |
| Reusable workflow presets | ✅ | Per-guild workflow presets can be saved/loaded/deleted in Dashboard and are included in Config Export/Import |
| Cross-module actions (tickets, roles, giveaway, moderation, music, notifications) | ✅ | Automation can invoke Tickets close, Giveaway end/reroll, Notification feed toggle and Music controls through module services; roles/moderation already use shared services |

#### Notifications / integrations
| Функция | План |
|---|---|
| RSS / Atom | ✅ |
| Twitch / YouTube / VK Live alerts | ✅ |
| Stream templates | ✅ |
| GitHub feeds | ✅ |
| Secure feed validation / SSRF protection | ✅ |
| Additional social feeds | 🟡 |
| Per-feed filters / keywords | ✅ | Include/exclude title keyword filters with bounded persisted lists and Dashboard controls |
| Rich notification templates / embeds | ✅ | Persisted feed templates support {title}, {url} and {timestamp}; embed composer remains outside this increment |
| Multiple credentials/providers per guild | 🟡 |
| Integration test/diagnostics UI | 🟡 |

#### Analytics / observability
| Функция | План |
|---|---|
| Server stats | ✅ |
| Persistent counters | ✅ |
| Analytics dashboard | ✅ |
| Moderation/security incident drilldown | ✅ |
| Per-module health | ✅ |
| Music/Lavalink health | ✅ |
| Audit/activity timeline | ✅ | Dashboard exposes recent audit activity with timestamps/source and scoped targets |
| Configurable metrics/counters | 🟡 |
| Exportable analytics | ✅ | Dashboard provides authenticated CSV export for selected analytics window |
| Retention/history settings | 🟡 |

#### Music
Music остаётся отдельным крупным направлением внутри общей платформы. Полный backlog описан выше в разделе **Music**, включая advanced queue management, granular DJ permissions, vote-skip/fair queue, emoji-controller, **Loop One**, effects, autoplay/radio, lyrics, shared playlists и расширение источников (Spotify, Apple Music, Deezer, **Yandex Music**, VK Music, Tidal, Qobuz, yt-dlp, JioSaavn).

### Product principle

**Не строим “ещё один музыкальный бот”.** Строим self-hosted замену нескольким Discord-ботам одновременно.

Premium-функции коммерческих ботов используем как внешний ориентир функциональности и UX, но:
- не копируем закрытый код;
- не переносим искусственные платные ограничения;
- не делаем Music единственным центром разработки;
- каждая возможность должна иметь понятные Discord permissions, persistence, audit/diagnostics и Dashboard-представление;
- приоритет определяется пользой для полноценного сервера, а не количеством поддерживаемых внешних сервисов.

## Release order

1. **All-in-one foundation** — command/permission contracts, persistence, Dashboard, audit, module lifecycle and reusable configuration.
2. **Moderation / AutoMod / Security parity** — richer rule actions, logging, exemptions, autoban, cleanup and incident workflows.
3. **Server utilities + Roles + Onboarding** — custom commands, autoresponders, forms, role systems, welcome/verification and utility coverage.
4. **Tickets / Support + Automation parity** — forms, ticket customization, workflow depth, reusable automation and cross-module actions.
5. **Community / Engagement parity** — leveling, rewards, reputation, giveaways, suggestions, statistics, counters and engagement tooling.
6. **Notifications / Integrations + Analytics** — broader feeds, filters/templates, provider diagnostics and richer analytics.
7. **Music advanced UX** — search picker, queue management, detailed DJ permissions, vote-skip/fair queue, controller overhaul, emoji controls and **Loop One**.
8. **Music provider expansion + saved state** — Spotify/Apple/Deezer/**Yandex Music**/VK/Tidal/Qobuz/yt-dlp/JioSaavn, shared playlists, save queue, effects, radio, improved autoplay and lyrics.
9. **Full E2E / chaos / soak / clean-host validation** across the whole platform.
10. **Stable release**.

Основное правило: уже работающие функции не переписываем ради красивой архитектуры. Новая функциональность должна проходить через общие permissions, persistence, audit и Dashboard contract.
