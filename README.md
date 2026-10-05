# Discord Server Platform

> 🎯 **Главная цель проекта:** создать собственного универсального Discord-бота/платформу, которая объединяет лучшие полезные возможности обычных и премиум-ботов вроде **Carl-bot, Juniper, MEE6, ProBot, Jockie Music** и аналогичных решений — чтобы серверу не требовалась куча сторонних ботов и тем более платные подписки за базовые/расширенные функции.
>
> При этом проект не копирует чужой код или закрытые реализации: мы собираем собственную единую архитектуру и реализуем нужные возможности самостоятельно, добавляя нормальную интеграцию, настройки, безопасность, persistence и Control Center.

Self-hosted Discord server platform for administration, moderation, community features, automation, temporary voice rooms, notifications and music.

> Current state: release candidate for live validation. CI/typecheck/tests/builds cover the implemented feature set, including the native Windows runtime path; live Discord/Windows acceptance and optional VPS validation remain environment-dependent.

## Implemented

- Discord core with typed event bus and module lifecycle.
- PostgreSQL persistence and versioned migrations.
- Health/readiness endpoint and Gateway connection supervision.
- Durable audit logging.
- Protected local Management API.
- Next.js local Control Center without end-user login, with functional navigation, module settings, capability/function index, Bot Fleet management, import/export and backup management.
- Moderation with case history, warnings, timeout, kick, ban and unban.
- Temporary Voice with ownership, idempotency and restart reconciliation.
- AutoMod, Welcome, Verification and Leveling.
- Tickets with modal intake, staff claim, close and transcript.
- Role Panels with hierarchy/tamper checks and dashboard CRUD/publishing.
- Giveaways with durable entries, scheduling, history, end/reroll operations and rollback handling.
- Economy, Reminders and Starboard.
- Automation engine with persisted rules/cooldowns and a constrained dashboard builder.
- Security / Anti-Raid and destructive-burst detection.
- Notifications with HTTPS feed validation and SSRF protections.
- Analytics with durable minute buckets and dashboard reporting.
- Music/Lavalink foundation with persistent queue state.
- Multi-bot identity persistence, per-voice Music routing and optional atomic guild failover.
- Custom Commands with prefix/slash configuration, aliases, role actions and Dashboard CRUD.
- Community Tools with polls, suggestions, sticky messages and fun commands.
- Stream Alerts Dashboard operations for Twitch, YouTube and VK Video Live.
- Config import/export and compressed local backups.
- Docker Compose plus Dockerfiles for local-to-VPS topology.
- Native Windows startup scripts for a low-overhead local runtime.

## Still under development / needs live validation

| Area | Status | What is missing |
|---|---|---|
| AutoMod | ✅ | Rule builder and persisted rule execution implemented; live Discord validation remains |
| Security | ✅ | Persistent incident lifecycle, quarantine recovery and manual clear implemented; live validation remains |
| Automation | ✅ | Expanded event catalog and bounded execution guard implemented; live validation remains |
| Music | 🟡 | More providers and multi-node failover validation |
| Multi-bot fleet | 🟡 | Live Windows/Docker acceptance; launcher orchestration and DB-backed credentials implemented |
| E2E / chaos / soak | 🟡 | Full live and long-running validation |
| VPS deployment | 🟡 | Clean-host installer/reverse-proxy acceptance drill |
| Windows UX | 🟡 | Real launcher/browser behavior validation |
| Live Discord integrations | 🟡 | Requires user-owned Discord test environment |

## Architecture

~~~text
apps/
├── bot
├── dashboard
└── worker

packages/
├── domain
└── ...

infrastructure/
└── docker

docs/
└── architecture, setup, operations and test strategy
~~~

The detailed design is documented in docs/MASTER-PLAN.md, docs/IMPLEMENTATION-ORDER.md, docs/QUALITY-BAR.md and docs/TEST-STRATEGY.md.

## Security

Real credentials belong only in .env or another secret store.

Never commit:

- Discord bot tokens;
- OAuth client secrets;
- database passwords;
- provider API keys;
- Management API bearer keys;
- backup credentials;
- runtime databases or user data.

The repository includes an automated source-hygiene check for obvious credential patterns.

## Verification

The project uses GitHub Actions for dependency installation/audit, source/deployment/observability checks, bot typecheck/tests/build, domain build and dashboard build.

Automated verification is not a substitute for a live Discord server, real provider credentials or a clean-host VPS/Windows acceptance test.

## Local deployment

The primary local workflow is the native Windows launcher, designed to avoid Docker Desktop/WSL overhead on a gaming or streaming PC:

~~~powershell
.\start-native.bat
~~~

Add `-Dashboard` for the local Control Center or `-Lavalink2` for a second Lavalink node. Docker Compose remains an optional deployment topology for reproducible environments and VPS use. See docs/LOCAL-SETUP.md and docs/NATIVE-SETUP.md.

## Public snapshot

This repository is prepared as an engineering project, with secrets, runtime state and historical private repository history removed from the public Git graph. The code and documentation intentionally distinguish implemented behavior from planned or environment-dependent functionality.
