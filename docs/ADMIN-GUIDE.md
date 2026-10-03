# Administrator Guide

Практическая инструкция по Discord Server Platform: первый запуск, Control Center, slash-команды и проверка сервера.

## 1. Первый запуск на Windows

Из корня репозитория:

    powershell -ExecutionPolicy Bypass -File .\scripts\start-local.ps1

На первом запуске launcher создаёт .env и попросит только:

- Discord Bot Token
- Discord Client ID
- Dashboard admin password

Остальные локальные секреты генерируются автоматически.

После запуска автоматически открывается:

    http://127.0.0.1:3000/

При успешном запуске `start-local.bat` закрывает окно launcher после открытия Control Center. При ошибке окно остаётся открытым, чтобы сообщение можно было прочитать.

По умолчанию Dashboard и Management API доступны только с локального компьютера.

## 2. Control Center

После входа выбери сервер слева.

Control Center разделён на функциональные области, а не только на список модулей:

- Обзор — состояние сервера, активные функции и последние действия;
- Модерация и безопасность — Moderation, AutoMod, Security;
- Сервер — Temporary Voice, Welcome, Verification, Roles, Tickets;
- Сообщество — Leveling, Giveaways, Starboard, Economy, Reminders;
- Автоматизация — Automation и её builder;
- Интеграции и медиа — Notifications, Music, Analytics;
- Система — Bot Fleet, Health, Backups и Audit Log;
- Все функции — единый индекс команд и возможностей бота.

Внутри каждого модуля теперь отдельно отображаются функционал, команды/точки входа, операционная панель и сгруппированные настройки. Переключатель ON/OFF остаётся на уровне модуля.

### Обычные страницы настроек

Temporary Voice:
- trigger channel;
- category;
- лимит участников;
- private rooms;
- reconcile.

AutoMod:
- blocked words;
- mentions;
- CAPS;
- repeated messages;
- links и invites;
- emoji;
- максимальная длина строки;
- channel/role exemptions;
- delete;
- timeout.

Verification:
- verification channel;
- verified role;
- quarantine role;
- log channel;
- TTL кода.

Welcome:
- channel;
- message;
- DM;
- embed.

Security:
- Anti-Raid thresholds;
- destructive thresholds;
- quarantine role;
- log channel;
- role hierarchy check.

Leveling:
- XP;
- cooldown;
- level-up announcements.

Tickets:
- category;
- staff role;
- transcript channel.

Starboard:
- channel;
- threshold;
- ignore-self;
- ignore-bots.

Music:
- announcement channel;
- default volume;
- track announcements;
- autoplay.

### Специализированные панели

Role Panels — CRUD и публикация role panels.

Giveaways — история, завершение и reroll.

Analytics — отчёты.

Automation — визуальное редактирование правил.

Notifications — управление feeds.

Bot Fleet — bot identities и Music voice assignments.

Backups — создание, список, retention, restore/delete.

## 3. Slash-команды

### Проверка платформы

    /ping

Показывает Gateway latency и состояние PostgreSQL.

### Moderation

    /moderate warn user reason
    /moderate timeout user minutes reason
    /moderate kick user reason
    /moderate ban user reason
    /moderate unban user reason
    /moderate history user limit

Permissions:
- warn/history: Moderate Members или Manage Server для history;
- timeout: Moderate Members;
- kick: Kick Members;
- ban/unban: Ban Members.

Для timeout/kick/ban дополнительно действует Discord role hierarchy.

### Temporary Voice

    /setup temp-voice trigger category limit private

После настройки вход в trigger voice channel создаёт временную комнату.

### Tickets

    /ticket create
    /ticket setup category staff-role transcript-channel

Пользователь создаёт ticket, staff claim/close его внутри канала, transcript сохраняется по настройке.

### Role Panels

    /roles panel channel role label

Для сложного редактирования используй Control Center.

### Giveaways

    /giveaway create minutes winners prize
    /giveaway end id
    /giveaway reroll id

Участие происходит кнопкой под giveaway.

### Economy

    /economy balance user
    /economy daily
    /economy leaderboard
    /economy pay user amount

Магазин:

    /shop list
    /shop buy item
    /shop create name description price role stock

Создание товара требует Manage Server.

### Reminders

    /remind minutes text

### Starboard

    /starboard setup channel threshold

### Verification

    /verify setup channel verified-role quarantine-role log-channel ttl
    /verify panel channel

### Analytics

    /analytics

### AutoMod

    /automod setup ...

Большинство AutoMod настроек удобнее менять через Dashboard.

### Welcome

    /welcome setup ...

### Leveling

    /leveling setup xp cooldown announce
    /leveling rank user
    /leveling top

### Security

    /security setup max-joins window max-destructive destructive-window quarantine-role log-channel

### Notifications

    /feed add url channel minutes

Используй HTTPS feed URL.

### Music

    /music play query
    /music pause
    /music resume
    /music skip
    /music stop
    /music shuffle
    /music repeat mode
    /music autoplay enabled
    /music seek seconds
    /music queue
    /music nowplaying
    /music volume value

### Automation

    /automation create ...

Dashboard является основным способом редактирования сложных automation rules.

## 4. Минимальный smoke-test на тестовом Discord-сервере

1. /ping.
2. Включить модуль в Dashboard и обновить страницу.
3. Temporary Voice: войти в trigger, получить комнату, выйти, проверить удаление пустой комнаты.
4. Moderation: warn, timeout, kick, ban, unban.
5. AutoMod: blocked word, invite/link, mention spam, repeat и exemption.
6. Role Panel: выдать и снять роль кнопкой.
7. Ticket: create, claim, close, transcript.
8. Giveaway: create, enter, end, reroll.
9. Starboard: достичь threshold.
10. Economy: daily, pay, shop list, buy.
11. Reminder: поставить короткое напоминание.
12. Music: play, pause, resume, seek, shuffle, repeat, stop.
13. Notifications: добавить безопасный HTTPS feed.
14. Automation: message.create -> contains -> send-message.
15. Backup: создать backup и проверить restore на тестовом сервере.

## 5. Когда что-то не работает

Сначала:

    docker compose ps
    docker compose logs -f bot
    docker compose logs -f dashboard

Потом в Dashboard проверь:

- Health;
- включён ли модуль;
- правильный ли channel/role выбран;
- role hierarchy;
- Discord permissions;
- audit events.

Безопасный restart:

    docker compose restart

Полный rebuild:

    powershell -ExecutionPolicy Bypass -File .\scripts\start-local.ps1 -Rebuild

## 6. Что не является «пропущенным» в Dashboard

Некоторые операции сознательно command-first:

- обычные moderation actions;
- Economy user actions;
+ управление shop items через Control Center; команда `/shop create` остаётся доступной как Discord fallback;
- Reminders;
- часть первичной настройки slash workflows.

Это функции бота, а не потерянная функциональность.

## 7. Что ещё требует живого окружения

Автоматическая проверка не заменяет реальный Discord/Lavalink runtime.

Остаются live-проверки:

- реальные Discord permissions и role hierarchy;
- полный Discord E2E;
- Lavalink restart/resume;
- multi-node failover;
- multi-bot routing;
- длительный chaos/soak тест;
- чистый VPS install/upgrade.

## 8. Важный статус feature coverage

Проект уже объединяет основные категории, ради которых обычно используют несколько multipurpose Discord bots: moderation, AutoMod, role panels, welcome/verification, leveling, tickets, giveaways, feeds, starboard, economy, reminders, automation, analytics и music.

При этом это ещё не буквальная feature-parity со всеми зрелыми ботами. Отдельно остаются более глубокие custom commands, расширенный logging, richer AutoMod policies, расширенный Automation catalog, более широкий Music provider/failover слой и fleet failover automation.

Главная архитектурная цель уже соблюдена: локальный self-hosted Core + PostgreSQL + Dashboard + Lavalink, без необходимости покупать premium-функции у внешнего bot provider. Сравнение с другими ботами нужно понимать как набор заимствованных продуктовых идей и UX-паттернов, а не как обещание полной копии каждого сервиса.## 2026-10-03 — Utility commands / AFK
- The Community area now includes a Utility module for lightweight everyday server operations:
  - Server/member information: `/serverinfo`, `/userinfo`, `/membercount`.
  - Media/structure inspection: `/avatar`, `/roleinfo`, `/channelinfo`.
  - AFK: `/afk set`, `/afk clear`, `/afk status`; prefix equivalents are also available.
- AFK is persistent across bot restarts and reports an AFK user's reason when they are mentioned.

### Utility / AFK hardening
- AFK changes are included in durable audit telemetry.
- AFK responses cap output and only explicitly allow mentions of affected users; stored reasons cannot create mass mentions.

### Community Tools
- Poll: /poll or !poll question | option1 | option2 | ...; supports 2-5 options and a configurable slash duration.
- Suggestions: /suggest text or prefix equivalent; moderators can approve or deny from the buttons.
- Sticky: /sticky set text /sticky clear; slash command also allows selecting a text channel.
- Fun: /8ball, /choose, /roll and corresponding prefix commands.

### Logging
- Configure with `/logging setup channel enabled` or `!logging setup #канал`.
- Dashboard exposes per-event switches for messages, members, voice, deleted channels/roles and bans.
- Events are retained in the durable audit store as well as sent to the configured Discord log channel.
