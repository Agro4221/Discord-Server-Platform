# CHAT-CONTEXT.md

> Живой контекст для продолжения проекта в новом чате. Не записывать сюда токены, ключи, пароли и приватные данные.

## Проект

Repository: `Agro4221/Discord-Server-Platform`  
Branch: `development`  
Latest cleanup baseline: `78a14d4cbb6b15ade0e7111e266eeff970a674e4`  
Current phase: **Release candidate / live acceptance**  
Primary local runtime: **native Windows**. Docker remains an optional deployment path.

## NORTH STAR

Мы делаем **своего Discord-бота/платформу**, чтобы серверу не требовался набор сторонних ботов и их Premium-подписки.

Ориентиры: Carl-bot, Juniper, MEE6, ProBot, Jockie Music и аналогичные решения.

Ключевые принципы:
- один интегрированный self-hosted стек;
- собственная реализация без копирования закрытого кода;
- единая конфигурация, PostgreSQL, permissions, audit и recovery;
- локальный Control Center как основной административный интерфейс;
- без искусственных Premium-wall;
- при необходимости multi-bot Fleet для нескольких voice-каналов.

## Что уже есть

Core / infrastructure:
- typed Discord Event Bus и module lifecycle;
- PostgreSQL, versioned migrations, advisory migration lock;
- Management API с внутренним bearer key;
- health/readiness и Gateway supervision;
- durable audit;
- native Windows launcher, diagnostics и release gate;
- Docker Compose/VPS topology.

Административные и серверные функции:
- Moderation + cases;
- AutoMod;
- Security / Anti-Raid / Anti-Nuke;
- Temporary Voice + reconciliation;
- Welcome / Verification;
- Role Panels;
- Tickets + transcripts;
- Leveling;
- Giveaways;
- Starboard;
- Economy / shop / ledger;
- Reminders / AFK / Utility;
- Custom Commands;
- Community Tools;
- Automation;
- Notifications / Stream Alerts;
- Analytics;
- Backup / restore / import / export.

Music / Fleet:
- yt-dlp + FFmpeg;
- persistent queue/player recovery;
- search до 100 треков;
- repeat/autoplay/shuffle/seek/filters;
- provider fallback;
- per-voice Music routing;
- registered Bot Identities;
- encrypted secondary credentials;
- native/Docker fleet supervision.

## Control Center

Новая админка — не старая панель на три функции. Она объединяет:
- Обзор;
- Модерация и безопасность;
- Настройку сервера;
- Сообщество;
- Автоматизацию;
- Интеграции и медиа;
- Систему.

Есть настройки модулей, специализированные operational panels, guild/resource selectors, audit, backups, diagnostics и Bot Fleet.

**End-user login/session UI отсутствует.** Локальный доступ ограничен loopback/local-first режимом, а Management API защищён внутренним bearer key.

Bot Fleet позволяет зарегистрировать Discord-бота через Control Center; plaintext token не возвращается в UI.

## Текущий статус

Pre-cleanup CI baseline: **#2398 — success** on `80ee35ae005d356142f47d08da6ab998367386a2`. Cleanup baseline is `78a14d4cbb6b15ade0e7111e266eeff970a674e4`; its fresh CI run is the verification gate.

Последний подтверждённый performance pass:
- кэширование hot-path module/config checks;
- batching Analytics;
- event-index для Automation;
- сниженная частота не критичных polling workers;
- bounded AutoMod repeat history;
- reduced native desktop runtime overhead by removing the JVM/Lavalink layer;
- regression coverage для новых оптимизаций.

## Что осталось

Release-gate:
- live Discord E2E на реальном тестовом сервере;
- yt-dlp stream resolution + FFmpeg decode, with persisted player/queue resume;
- multi-bot takeover на реальных identities;
- native Windows runtime acceptance;
- VPS clean-host acceptance;
- controlled chaos/soak/security.

Post-RC functional depth:
- более глубокий AutoMod/Security;
- более широкий Automation catalog;
- Music provider breadth, YouTube edge cases and stream/recovery validation;
- Fleet orchestration depth.

## Как продолжать

Работать маленькими самостоятельными feature-slice:
**код → regression test → CI → лог → следующий slice.**

Не делать массовую перепись рабочего кода и не возвращать удалённую Dashboard-аутентификацию.

После существенного slice обновлять:
- `docs/WORK-LOG.md`;
- `docs/PROJECT-STATE.md`;
- `docs/TEST-MATRIX.md`, если изменились тестовые границы.

Перед объявлением подсистемы законченной сверять `docs/TEST-MATRIX.md`.