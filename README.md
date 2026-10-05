# 🤖 Discord Server Platform

> Самостоятельно размещаемая Discord bot platform для Discord-серверов: модерация, временные голосовые комнаты, автоматизация, тикеты, роли, розыгрыши, экономика, уведомления, музыка и единый Control Center.
>
> Идея проекта — собрать не набор разрозненных Discord-команд, а **модульную серверную платформу**, которую можно запускать локально на Windows или разворачивать в Docker/VPS-сценарии.

![TypeScript](https://img.shields.io/badge/TypeScript-Node.js-3178C6?logo=typescript&logoColor=white)
![Discord](https://img.shields.io/badge/Discord-API-5865F2?logo=discord&logoColor=white)
![Next.js](https://img.shields.io/badge/Next.js-Control%20Center-000000?logo=next.js&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-Database-4169E1?logo=postgresql&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-supported-2496ED?logo=docker&logoColor=white)
![Windows](https://img.shields.io/badge/Windows-native-0078D6?logo=windows&logoColor=white)

> 🚧 **Статус:** **Release Candidate / Кандидат в релиз для live-проверки**
>
> Основная серверная часть, Control Center, база данных, модули и CI-проверки уже собраны. При этом полноценная live-проверка Discord, длительные тесты, clean-host Windows/VPS и часть advanced-сценариев ещё требуют отдельной валидации.

## ✨ Что уже есть

| Возможность | Статус |
|---|---|
| 🤖 Discord Core | ✅ |
| 🗄️ PostgreSQL + migrations | ✅ |
| 🖥️ Next.js Control Center | ✅ |
| 🛡️ Moderation cases | ✅ |
| 🔊 Temporary Voice | ✅ |
| 🎫 Tickets + transcripts | ✅ |
| 🎭 Role Panels | ✅ |
| 🎁 Giveaways | ✅ |
| 💰 Economy + shop + ledger | ✅ |
| ⏰ Reminders | ✅ |
| ⭐ Starboard | ✅ |
| 🔔 Notifications | ✅ |
| 📊 Analytics | ✅ |
| 💾 Backups / restore | ✅ |
| 🐳 Docker topology | ✅ |
| 🪟 Native Windows runtime | ✅ |

## 🟡 Что ещё развивается

| Компонент | Статус | Что осталось |
|---|---|---|
| AutoMod | 🟡 | Более гибкий editor и policy workflow |
| Security / Anti-Raid | 🟡 | Полный response / quarantine workflow |
| Automation | 🟡 | Более широкий набор условий и действий |
| Music / Lavalink | 🟡 | Дополнительные providers и failover validation |
| Multi-bot fleet | 🟡 | Полная оркестрация и failover |
| E2E / chaos / soak | 🟡 | Полный live и long-running цикл |
| VPS | 🟡 | Clean-host acceptance |
| Windows UX | 🟡 | Реальная desktop-валидация |

## 🏗️ Архитектура

~~~text
              ┌────────────────────────────┐
              │     Next.js Control Center │
              └─────────────┬──────────────┘
                            │
                            ▼
              ┌────────────────────────────┐
              │  Protected Management API  │
              └─────────────┬──────────────┘
                            │
                            ▼
              ┌────────────────────────────┐
              │        Discord Core        │
              └─────┬───────┬───────┬──────┘
                    │       │       │
              ┌─────▼─┐ ┌───▼───┐ ┌─▼─────────┐
              │Modules│ │Event  │ │Background │
              │       │ │Bus    │ │Workers    │
              └─────┬─┘ └───┬───┘ └────┬──────┘
                    │       │          │
                    └───────┴────┬─────┘
                                 ▼
                         ┌──────────────┐
                         │  PostgreSQL  │
                         └──────────────┘
~~~

## 🧩 Platform overview

~~~mermaid
flowchart TB
    ADMIN["Admin / User"] --> DASH["Next.js Control Center"]
    DASH --> API["Protected Management API"]
    API --> CORE["Discord Core"]

    CORE --> MOD["Moderation"]
    CORE --> VOICE["Temporary Voice"]
    CORE --> AUTO["Automation"]
    CORE --> COMMUNITY["Community"]
    CORE --> TICKETS["Tickets"]
    CORE --> MUSIC["Music / Lavalink"]
    CORE --> NOTIFY["Notifications"]
    CORE --> SECURITY["Security / Anti-Raid"]

    CORE --> REG["Module Registry + Event Bus"]
    CORE --> DB["PostgreSQL"]
    CORE --> AUDIT["Audit Log"]
    WORKERS["Background Workers"] --> DB
~~~

## 📦 Repository structure

~~~text
apps/
├─ bot/              # Discord runtime
├─ dashboard/        # Next.js Control Center
└─ worker/           # background jobs

packages/
└─ domain/           # shared domain logic

infrastructure/
└─ docker/           # container topology

docs/
└─ ...               # architecture, setup and testing docs
~~~

## 🔄 Типичный сценарий

~~~mermaid
sequenceDiagram
    participant U as User
    participant D as Dashboard
    participant A as Management API
    participant C as Discord Core
    participant DB as PostgreSQL
    participant G as Discord

    U->>D: Изменение настройки
    D->>A: Authenticated request
    A->>C: Validate + execute
    C->>DB: Persist + audit
    C->>G: Discord API
    G-->>C: Result
    C-->>D: Status
    D-->>U: Result + diagnostics
~~~

## 🛠️ Основные подсистемы

**Moderation** — кейсы, предупреждения, timeout, kick, ban, unban и история.

**Temporary Voice** — временные голосовые комнаты с ownership/idempotency и reconciliation.

**Community** — tickets, role panels, giveaways, economy, reminders, starboard и другие серверные функции.

**Automation** — событийно-условная система для автоматизации действий.

**Security / Anti-Raid** — защитные сценарии вокруг подозрительной активности и ограничений действий.

**Notifications** — внешние feed/webhook-сценарии с HTTPS/SSRF-проверками. Stream alerts поддерживают Twitch, YouTube, VK Видео Live и Kick; Twitch/YouTube/Kick используют внешние API credentials, а настройки хранятся в PostgreSQL.

**Music** — интеграция через Lavalink. Модуль умеет persistent queue/player state, request channel, playlist loading до 500 треков, repeat/autoplay, previous/seek, pagination, emoji-controller, favorites, saved playlists и EQ/effects. Для текстов подключён LavaLyrics. Для дополнительных источников подключён LavaSrc: Spotify, Apple Music, Deezer, Yandex Music, VK Music, Tidal, Qobuz, yt-dlp и JioSaavn доступны как opt-in источники после настройки credentials.

**Control Center** — локальное управление сервером, конфигурацией, модулями, ролями, каналами, backup/import/export, диагностикой и регистрацией Discord-бота.

## 🚀 Быстрый старт

Основной локальный сценарий:

~~~powershell
scripts/start-local.ps1
~~~

Также доступна Docker-топология проекта.

Перед первым live-запуском необходимо подготовить собственные Discord credentials и локальное окружение. Рекомендуется сначала пройти автоматические проверки, затем выполнить live-проверку на тестовом сервере.

## 🧪 Проверка

~~~mermaid
flowchart LR
    SRC["Source"] --> H["Secret / hygiene checks"]
    H --> TYPE["Typecheck"]
    TYPE --> TEST["Unit / regression tests"]
    TEST --> BUILD["Builds"]
    BUILD --> LIVE["Live Discord validation"]
    LIVE --> SOAK["E2E / chaos / soak"]
~~~

GitHub Actions покрывает автоматические этапы. Реальная Discord-аутентификация и длительные сценарии зависят от пользовательского сервера и окружения.

## 🔐 Безопасность

Проект предполагает, что внешний Discord-контент, webhook/feed-данные и пользовательский ввод недоверен.

Отдельное внимание уделено:

- защищённому Management API;
- audit log;
- проверкам внешних URL;
- SSRF-защите для notification/feed сценариев;
- валидации конфигурации;
- разделению административных действий и Discord runtime.

Секреты и локальные credentials не должны попадать в Git.

## 🗺️ Roadmap

~~~mermaid
flowchart LR
    A["Release candidate"] --> B["Live Discord validation"]
    B --> C["E2E / chaos / soak"]
    C --> D["Cleaner Windows deployment"]
    D --> E["VPS acceptance"]
    E --> F["Stable platform release"]
~~~

Долгосрочная цель — получить модульную Discord-платформу, которую можно запускать локально, переносить на сервер и расширять без превращения проекта в монолит.

## 👤 Об авторе / About the author

Я **Jostik (GitHub: [@Agro4221](https://github.com/Agro4221))**, начинающий разработчик, который учится через реальные проекты. Мне интересны **AI, нейростримеры, автоматизация, стриминг, Discord/Telegram и создание собственных инструментов**.

Сейчас я постепенно набираюсь опыта в Python, TypeScript, API, LLM, базах данных, асинхронности, аудио/видео и архитектуре приложений. Эти проекты — часть моего практического обучения: я стараюсь не просто повторять готовые примеры, а разбираться, как всё работает, и собирать собственные системы.

## 🔗 Ссылки / Links

- 💬 **Discord-сервер:** [присоединиться](https://discord.gg/ZK38tXnhhq) — сервер ещё находится в разработке.
- 📣 **Telegram:** [анонсы стримов и новости](https://t.me/+zb5pGLoWFbhhMTYy)
- 💜 **DonatePay:** [поддержать автора](https://new.donatepay.ru/@Jostik001)
- ❤️ **DonationAlerts:** [поддержать автора](https://www.donationalerts.com/r/i_jostik_i)

Поддержка не обязательна, но помогает продолжать разработку и эксперименты с проектами.

## 📚 Документация

~~~text
docs/MASTER-PLAN.md
docs/PROJECT-STATE.md
docs/ADMIN-GUIDE.md
docs/LOCAL-SETUP.md
docs/TEST-STRATEGY.md
docs/TEST-MATRIX.md
~~~

## 👤 Об авторе / About the author

Я **Jostik (GitHub: [@Agro4221](https://github.com/Agro4221))**, начинающий разработчик, который учится через реальные проекты. Мне интересны **AI, нейростримеры, автоматизация, стриминг, Discord/Telegram и создание собственных инструментов**.

Сейчас я постепенно набираюсь опыта в Python, TypeScript, API, LLM, базах данных, асинхронности, аудио/видео и архитектуре больших приложений. Эти репозитории — часть этого пути: я стараюсь не просто повторять готовые примеры, а разбираться, как всё работает, и собирать собственные системы.

## 🔗 Ссылки / Links

- 💬 **Discord-сервер:** [присоединиться](https://discord.gg/ZK38tXnhhq) — сервер ещё находится в разработке.
- 📣 **Telegram:** [анонсы стримов и новости](https://t.me/+zb5pGLoWFbhhMTYy)
- 💜 **DonatePay:** [поддержать автора](https://new.donatepay.ru/@Jostik001)
- ❤️ **DonationAlerts:** [поддержать автора](https://www.donationalerts.com/r/i_jostik_i)

Поддержка не обязательна, но помогает продолжать разработку и эксперименты с проектами.


---

**Jostik**