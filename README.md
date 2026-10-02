# Discord Server Platform

> **RU:** Самостоятельно размещаемая платформа для управления Discord-серверами: модерация, временные голосовые комнаты, автоматизация, сообщество, музыка, уведомления и административная панель.
>
> **EN:** A self-hosted Discord server platform for moderation, temporary voice rooms, automation, community features, music, notifications and centralized administration.

> **🚧 Status / Статус:** Release Candidate / кандидат в релиз для live-проверки. Автоматические проверки покрывают реализованную часть, но реальный Discord-сервер, Windows и VPS ещё требуют окруженческой валидации.

## 🗺️ Platform overview / Общая схема

~~~mermaid
flowchart TB
    U["Admin / User"] --> D["Next.js Control Center"]
    D --> API["Protected Management API"]
    API --> C["Discord Core"]

    C --> MOD["Moderation"]
    C --> TV["Temporary Voice"]
    C --> AUTO["Automation"]
    C --> COM["Community"]
    C --> TICK["Tickets"]
    C --> MUSIC["Music / Lavalink"]
    C --> NOTIFY["Notifications"]
    C --> SEC["Security / Anti-Raid"]

    C --> BUS["Event Bus + Module Registry"]
    C --> DB["PostgreSQL"]
    C --> AUD["Audit Log"]
    W["Background Workers"] --> DB
~~~

## 🏗️ Architecture / Архитектура

~~~mermaid
graph LR
    BOT["apps/bot"] --> DOMAIN["packages/domain"]
    DASH["apps/dashboard"] --> API["Management API"]
    API --> BOT
    WORK["apps/worker"] --> BOT
    BOT --> PG["PostgreSQL"]
    BOT --> DC["Discord Gateway / REST"]
    BOT --> LV["Lavalink"]
    INF["infrastructure/docker"] --> BOT
    DOC["docs"] -. design .-> BOT
~~~

## ✅ Implemented / Реализовано

| Area / Область | State | Details / Детали |
|---|---|---|
| Discord Core | ✅ | Event bus, lifecycle, health and supervision |
| PostgreSQL | ✅ | Durable state + versioned migrations |
| Control Center | ✅ | Authenticated dashboard and functional navigation |
| Moderation | ✅ | Cases, warnings, timeout, kick, ban, unban |
| Temporary Voice | ✅ | Ownership, idempotency and reconciliation |
| Tickets | ✅ | Intake, claim, close and transcript |
| Role Panels | ✅ | CRUD, hierarchy checks and publishing |
| Giveaways | ✅ | Durable entries, scheduling, finish/reroll |
| Economy | ✅ | Economy, shop and transaction ledger |
| Reminders | ✅ | Retry/lease semantics |
| Starboard | ✅ | Durable publishing |
| Notifications | ✅ | HTTPS validation and SSRF protections |
| Analytics | ✅ | Persistent metrics and dashboard reporting |
| Backups | ✅ | Local compressed backups and scoped restore |
| Docker topology | ✅ | Local-to-VPS architecture |
| Native Windows runtime | ✅ | Low-overhead launcher |

## 🟡 In progress / В работе

| Area / Область | State | Remaining work / Осталось |
|---|---|---|
| AutoMod | 🟡 | Richer editor and response policies |
| Security | 🟡 | Full response/quarantine workflow |
| Automation | 🟡 | Wider condition/action catalog |
| Music | 🟡 | More providers and failover validation |
| Multi-bot fleet | 🟡 | Full orchestration/failover |
| E2E / chaos / soak | 🟡 | Full live and long-running tests |
| VPS | 🟡 | Clean-host acceptance drill |
| Windows UX | 🟡 | Real desktop validation |

## 🔄 Typical request / Типичный поток

~~~mermaid
sequenceDiagram
    participant U as User
    participant D as Dashboard
    participant A as Management API
    participant C as Discord Core
    participant DB as PostgreSQL
    participant G as Discord

    U->>D: Action / настройка
    D->>A: Authenticated request
    A->>C: Validate + execute
    C->>DB: Persist + audit
    C->>G: Discord API
    G-->>C: Result
    C-->>D: Status
    D-->>U: Result + diagnostics
~~~

## 🧪 Verification / Проверка

~~~mermaid
flowchart LR
    SRC["Source"] --> H["Hygiene checks"]
    H --> T["Typecheck"]
    T --> UT["Unit / regression tests"]
    UT --> B["Builds"]
    B --> LIVE["Live Discord"]
    LIVE --> CHAOS["E2E / chaos / soak"]
~~~

GitHub Actions covers the automated stages. Live Discord credentials and clean-host Windows/VPS testing remain external validation steps.

## 🧑‍💻 About the author / Об авторе

**RU:** Я пока новичок в разработке и учусь прямо на этом проекте. Здесь я осваиваю TypeScript, Node.js, Discord API, PostgreSQL, веб-разработку, архитектуру больших приложений, тестирование и деплой. Поэтому проект для меня одновременно рабочая система, эксперимент и учебная площадка.

**EN:** I am still a beginner developer and I am learning by building this project. It is my practical playground for TypeScript, Node.js, the Discord API, PostgreSQL, web development, larger application architecture, testing and deployment.

## 📚 Documentation / Документация

- docs/MASTER-PLAN.md — architecture / архитектура
- docs/PROJECT-STATE.md — current state / состояние
- docs/ADMIN-GUIDE.md — administration / администрирование
- docs/LOCAL-SETUP.md — local setup / локальный запуск
- docs/TEST-STRATEGY.md — testing / стратегия тестирования
- docs/TEST-MATRIX.md — verification matrix / матрица проверок

## 🚀 Local deployment / Локальный запуск

~~~powershell
scripts/start-local.ps1
~~~

Docker Compose is the main service topology; native Windows mode is intended for low-overhead local use.

---

**RU:** README намеренно показывает не только готовую функциональность, но и границы текущей реализации.

**EN:** The README intentionally documents both implemented functionality and the current limits of the project.
