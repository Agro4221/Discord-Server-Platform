# CHAT-CONTEXT.md

> Живой контекст для переноса проекта в новый чат. Обновляй после существенных feature-slice.
> Сюда нельзя записывать токены, ключи, пароли и приватные данные.

## 1. ПРОЕКТ

Репозиторий: `Agro4221/Discord-Server-Platform`
Ветка: `development`
Последний известный HEAD на момент обновления этого файла: `4c69d5644b5e35fd5497619c008642c74ece02dd`
Тип: self-hosted Discord Server Platform / единый Discord-бот.
Основной локальный runtime: Native Windows.
Docker: дополнительный путь для локального/VPS-развёртывания.

### NORTH STAR — НЕ ТЕРЯТЬ

Мы делаем **своего Discord-бота/платформу**, чтобы сервер мог заменить набор сторонних ботов и их платные Premium-подписки.

Ориентир по функционалу:
Carl-bot, Juniper, MEE6, ProBot, Jockie Music и похожие боты.

Мы не копируем проприетарный код. Мы независимо реализуем лучшие полезные возможности и объединяем их в:
- один бот/платформу;
- единую модель конфигурации;
- PostgreSQL persistence;
- общие permissions/audit;
- единый локальный Control Center;
- общие automation/security/recovery-механизмы;
- при необходимости — multi-bot Fleet.

Ключевое правило: **«модуль существует» != «задача завершена»**. Нужно закрывать реальные функциональные пробелы, пока платформа действительно не сможет заменить задуманный стек сторонних ботов в рамках нашего scope.

Не делать искусственные Premium-wall для возможностей self-hosted платформы.

## 2. КАК ПРОДОЛЖАТЬ РАБОТУ

Пользователь ожидает:
- реальное кодирование, а не бесконечные аудиты и документацию вместо разработки;
- работу небольшими модулями/feature-slice, чтобы снижать ошибки, таймауты и расход токенов;
- логирование всего важного: что сделано, что проверено, что не прошло, что осталось;
- переносимость контекста между чатами без повторного объяснения проекта;
- минимум лишних вопросов.

Старт нового чата:
1. Прочитать этот файл.
2. Прочитать `docs/WORK-LOG.md`.
3. Прочитать `docs/PROJECT-STATE.md`.
4. Перед объявлением подсистемы готовой сверить `docs/TEST-MATRIX.md`.
5. Проверить текущий GitHub HEAD и актуальное состояние файлов.
6. Сразу взять один конкретный feature-slice и кодить.
7. Добавить regression tests.
8. Обновить continuity-документы.
9. Проверить GitHub Actions и сообщить фактический статус.
10. Идти дальше, не переоткрывая уже подтверждённые контракты без причины.

## 3. АРХИТЕКТУРНЫЕ ПРАВИЛА

- Local-first, затем VPS без переписывания архитектуры.
- PostgreSQL + versioned migrations + advisory migration lock.
- Management API — защищённая внутренняя control plane.
- Локальный Control Center **не имеет end-user login/session UI**. Не возвращать удалённые login/logout/OAuth/CSRF ожидания.
- Discord commands — пользовательские/fallback entry points; Control Center — основной локальный админ-интерфейс.
- Никогда не коммитить secrets.
- Для pure logic/validator/helper — детерминированные regression tests.
- Discord/Lavalink/Windows/VPS live-поведение считать отдельным environment-dependent acceptance.
- Проверять не только happy path: permissions, invalid input, persistence failure, restart/recovery, dependency failure, concurrency, hierarchy, cross-module behavior.

## 4. ЧТО УЖЕ ЕСТЬ

Крупные функциональные области:
- Discord Core, typed Event Bus, module lifecycle
- PostgreSQL persistence/migrations
- Control Center / Management API
- Moderation + case history
- Temporary Voice
- Tickets + transcripts
- Role Panels
- Giveaways
- Starboard
- Economy / shop / ledger
- Reminders / AFK / Utility
- Leveling
- Welcome / Verification
- Notifications
- Analytics
- Backup / restore / import / export
- Automation
- AutoMod
- Security / Anti-Raid / Anti-Nuke
- Music / Lavalink
- multi-bot Fleet + per-voice Music routing
- Bot credential registration
- Native Windows runtime / diagnostics / release gate
- Docker Compose / VPS-oriented topology

## 5. ПОСЛЕДНИЕ ВАЖНЫЕ FEATURE-SLICE

### Automation
Последний срез добавил строгие числовые условия `number-gt` и `number-lt`, а также исправил Dashboard-рендеринг `number-eq` в ALL/ANY builder. Management API, Core и Dashboard остаются синхронизированы.

Добавлены:
- conditions: `starts-with`, `ends-with`, `number-eq`;
- event-relative `@event` для `has-role` и `send-message`;
- message actions: `add-reaction`, `remove-reaction`, `pin-message`, `unpin-message`;
- channel actions: `set-slowmode`, `set-channel-topic`, `set-channel-name`;
- events: `reaction.remove`, `channel.update`, `role.update`;
- event fields: `previousChannelId`, `attachmentCount`, `embedCount`, `stickerCount`;
- Core / Management API / Dashboard каталоги синхронизированы;
- добавлены validator/runtime regression tests.

### Security
Добавлена опциональная реакция executorTimeoutMinutes для подтверждённого destructive executor; успешный timeout создаёт moderation case, неуспешный не создаёт ложную запись.

Audit-log ingestion расширен для:
- member kicks;
- webhooks create/delete/update;
- emojis create/delete/update;
- stickers create/delete/update;
- channel permission overwrites create/update/delete;
- member prune;
- integrations create/delete/update.

Не дублировать уже отдельные high-level handlers для channel/role create-delete и member ban.

Текущая Security-основа:
- durable incidents;
- configurable destructive thresholds/windows;
- incident duration;
- auto-quarantine;
- quarantine assignment tracking/restoration;
- optional removal of manageable executor roles;
- hierarchy/log diagnostics;
- audit event ingestion.

### Music
Есть:
- multi-track search enqueue с лимитом 100;
- auto fallback YouTube -> YouTube Music -> SoundCloud;
- queue remove/move/clear;
- filters: off, nightcore, vaporwave, karaoke, rotation/8D, tremolo, vibrato, lowpass;
- repeat modes;
- autoplay на queue-end;
- persistent/resumable player/queue state;
- shuffle/seek;
- multi-bot/per-voice routing;
- dynamic Lavalink health;
- recovery concurrency gate.

Важно для lavalink-client 2.11:
- использовать `queue.remove(index)`;
- использовать `queue.splice(index, amount, ...)`;
- **не добавлять** `queue.move` или `queue.clear`, пока API установленной версии не будет заново проверен.

### Fleet / Runtime
Есть:
- persistent bot identities;
- secondary Bot Identity process model;
- stale-heartbeat failover;
- durable `restart_required`;
- Management API restart request;
- native Windows Fleet supervisor;
- Docker reconciliation failure propagation;
- ownership revalidation с short-lived cache;
- release-gate/diagnostics scripts;
- Native Windows как основной локальный путь, Docker как optional.

## 6. ЧТО ЕЩЁ ДЕЛАТЬ

Основной остаток — **не переписывание с нуля, а закрытие глубины/широты**:

1. Security / Anti-Nuke / AutoMod response-policy depth.
2. Более широкий Automation condition/action catalog.
3. Music provider breadth + полноценный multi-node failover.
4. Более глубокий Fleet orchestration/failover + failure injection.
5. Полный VPS installer/upgrade/production drill.
6. Финальные live E2E / chaos / soak / security / clean-host tests.

Рекомендуемый следующий feature-slice: **Security/AutoMod response-policy depth**, если текущая проверка репозитория не покажет более срочный regression/blocker.

## 7. CI / ВЕРИФИКАЦИЯ

На момент создания контекста:
- HEAD: `79dfbb13e33fe9b63c26fbf7bc84b744e6867f2b`
- CI #1764 для предыдущего HEAD завершён успешно.
- Для текущего дерева активен CI #1783; его нельзя считать green до завершения.

Последний предыдущий подтверждённо зелёный baseline: CI #1757.

В новом чате сначала перепроверить CI #1764 и текущий HEAD.

## 8. ВАЖНЫЕ SECURITY-ДЕТАЛИ ДЛЯ СЛЕДУЮЩЕЙ ЗАДАЧИ

`apps/bot/src/modules/security.ts` содержит:
- `enabled`
- `maxJoins`
- `windowSeconds`
- `maxDestructiveActions`
- `destructiveWindowSeconds`
- `quarantineRoleId`
- `logChannelId`
- `incidentDurationSeconds`
- `autoQuarantine`
- `removeExecutorRoles`
- `executorTimeoutMinutes`

`respondToExecutor` сейчас:
- загружает executor member;
- не трогает owner/admin/non-manageable;
- после response threshold может снять управляемые роли ниже highest role бота;
- tracks quarantine assignments;
- пишет response-applied events;
- снятие ролей сейчас считается необратимым.

Любое усиление наказаний должно строго учитывать Discord hierarchy и не создавать privilege escalation.

## 9. CONTINUITY CONTRACT

После каждого существенного slice обновлять:
- `docs/WORK-LOG.md`
- `docs/PROJECT-STATE.md`
- `docs/TEST-MATRIX.md` при изменении test coverage/status

Этот файл обновлять, когда меняются:
- north star;
- branch/HEAD;
- current phase;
- крупные implemented feature families;
- remaining scope;
- next recommended slice;
- CI status;
- architecture decisions.

## 10. ГОТОВАЯ ФРАЗА ДЛЯ НОВОГО ЧАТА

Продолжаем `Agro4221/Discord-Server-Platform`. Это живой контекст проекта. Сверь его с текущим GitHub HEAD и `docs/WORK-LOG.md` / `docs/PROJECT-STATE.md`, после чего сразу бери следующий конкретный модульный feature-slice: кодируй, тестируй и логируй. Не уходи в бесконечные аудиты и не останавливайся на планировании.

## 11. ПОСЛЕДНИЙ NEXT STEP

Перепроверить CI #1764, затем продолжить с конкретной Security/AutoMod response-policy задачей и последовательно закрывать оставшиеся функциональные breadth gaps.
