# Feature Matrix / Product Backlog

Этот документ — единый backlog Discord Server Platform. Он собирает текущую реализацию и целевой набор функций, который должен заменить несколько специализированных ботов без платных ограничений.

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
| Message / role / moderation actions | ✅ |
| Schedule trigger | ✅ |
| DM / webhook actions | ✅ | DM + hardened webhook action
| Conditional branches | ✅ | Nested if/else action branches up to 2 levels |
| Delay / queue semantics | ✅ | Durable delayed-action queue with lease/retry and restart recovery
| Template variables / reusable snippets | ✅ | Event variables + persistent named templates via `{template:name}` |
| Visual automation builder | ✅ |

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

## Admin / UX parity

Функциональность, которую берём как поведенческие ориентиры у распространённых all-in-one ботов:
- подробный moderation/audit;
- AutoMod с исключениями и action policy;
- reaction/button/select roles;
- leveling с текстовым и voice XP;
- welcome/goodbye и role restore;
- tickets/transcripts;
- custom commands and templates;
- automation builder;
- stream/social notifications;
- embeds;
- reminders / scheduled messages;
- statistics / counters;
- music controller and provider breadth;
- anti-raid / anti-nuke;
- backups / import-export.

Не переносим чужой код или закрытые implementation details — реализуем собственное поведение на основе публично описанных функций.

## Release order

1. **Music v2 foundation** — текущий инкремент.
2. **Moderation / roles / tickets / automation depth** — текущий рабочий инкремент.
3. **Music advanced UX** — search picker, queue management, detailed DJ permissions, vote-skip/fair queue, controller overhaul и loop-one.
4. **Music provider expansion** — Spotify/Apple/Deezer/**Yandex Music**/VK/Tidal/Qobuz, затем остальные.
5. **Music saved state / effects / autoplay 2.0** — shared playlists, save queue, custom effects, radio, improved autoplay and lyrics.
6. **Community expansion** — polls/suggestions, birthdays, invites, counters, richer embeds.
7. **Notifications / analytics expansion**.
8. **Full E2E / chaos / soak / clean-host validation**.
9. **Stable release**.

Основное правило: уже работающие функции не переписываем ради красивой архитектуры. Новая функциональность должна проходить через общие permissions, persistence, audit и Dashboard contract.
