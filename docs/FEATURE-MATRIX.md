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
| Kick stream alerts | ✅ | Kick OAuth client-credentials + public channel API |
| Secure feed validation / SSRF protection | ✅ |

## Music

### Current baseline

| Функция | Состояние |
|---|---|
| YouTube playback | ✅ |
| Queue persistence | ✅ |
| Playlist loading | ✅, Music v2: до 500 треков за запрос |
| Pause / resume / skip / stop | ✅ |
| Shuffle | ✅ |
| Repeat off / track / queue | ✅ |
| Autoplay | ✅ |
| Seek | ✅ |
| Volume | ✅ |
| Now Playing | ✅ |
| Emoji controller | ✅, Music v2 |
| Dedicated request/controller channel | ✅, Music v2 |
| Per-voice bot identity routing | ✅ |
| Lavalink node health / reconnect | ✅ |

### Provider expansion

LavaSrc уже подключён. Следующий этап — включать и проверять провайдеры по одному, не ломая YouTube-only default:

| Источник | План |
|---|---|
| Spotify | 🟡 |
| Apple Music | 🟡 |
| Deezer | 🟡 |
| Yandex Music | 🟡 |
| VK Music | 🟡 |
| Tidal | 🟡 |
| Qobuz | 🟡 |
| yt-dlp | 🟡 |
| JioSaavn | 🟡 |
| SoundCloud | ✅ |

Важно: часть сервисов используется как metadata/search source и зеркалирование в другой источник, а часть умеет прямое воспроизведение. Это зависит от LavaSrc/source manager и конкретной конфигурации.

### Music UX

| Функция | План |
|---|---|
| Message → play by text/URL | ✅, Music v2 |
| Persistent player message | ✅ |
| Buttons: pause / skip / shuffle / repeat / stop | ✅, Music v2 |
| Buttons: volume / queue | ✅, Music v2 |
| Queue pagination | ✅ |
| Previous track | ✅ |
| Interactive seek | ✅ |
| Saved playlists | ✅ |
| Favorites | ✅ |
| Per-user queue permissions | ✅ | `everyone` / `dj` policy enforced for queue requests
| DJ role policy | ✅ |
| Lyrics | ✅ | LavaLyrics plugin + current-track lookup
| Filters / equalizer / 8D / nightcore / bassboost | ✅ |
| 24/7 mode | ✅ |
| Multi-node failover validation | 🟡 |

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
3. **Music provider validation** — Spotify/Apple/Deezer/Yandex/VK/Tidal/Qobuz, затем остальные.
4. **Music saved state** — favorites/playlists/queue pagination/lyrics/filters.
5. **Community expansion** — polls/suggestions, birthdays, invites, counters, richer embeds.
6. **Notifications / analytics expansion**.
7. **Full E2E / chaos / soak / clean-host validation**.
8. **Stable release**.

Основное правило: уже работающие функции не переписываем ради красивой архитектуры. Новая функциональность должна проходить через общие permissions, persistence, audit и Dashboard contract.
